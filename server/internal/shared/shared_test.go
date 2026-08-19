//go:build windows

package shared

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadConfigRejectsRemovedConfigFields(t *testing.T) {
	tests := []struct {
		name string
		data string
		want string
	}{
		{name: "im version", data: `{"projects":[{"name":"p","path":".","im":{"type":"feishu","version":2}}]}`, want: "im.version has been removed"},
		{name: "project debug", data: `{"projects":[{"name":"p","debug":true,"path":"."}]}`, want: "projects[].debug has been removed"},
		{name: "project client", data: `{"projects":[{"name":"p","path":".","client":{"agent":"codex"}}]}`, want: "projects[].client has been removed"},
		{name: "project im filter", data: `{"projects":[{"name":"p","path":".","imFilter":{"block":["tool"]}}]}`, want: "projects[].imFilter has been removed"},
		{name: "monitor", data: `{"monitor":{"server":"127.0.0.1","port":9631},"projects":[{"name":"p","path":"."}]}`, want: `unknown field "monitor"`},
		{name: "top-level share", data: `{"projects":[],"share":{"publicUrl":"https://legacy-share.example.com"}}`, want: `unknown field "share"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadConfig(writeTempConfig(t, tt.data))
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("LoadConfig() error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestLoadConfig_AllowsDebugLogLevel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"log":{"level":"debug"},"projects":[{"name":"p","path":"."}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Log.Level != "debug" {
		t.Fatalf("log level=%q, want %q", cfg.Log.Level, "debug")
	}
}

func TestLoadConfig_AllowsWorkspacePublicURL(t *testing.T) {
	path := writeTempConfig(t, `{"publicUrl":"https://workspace.example.com:8443","projects":[]}`)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.PublicURL != "https://workspace.example.com:8443" {
		t.Fatalf("publicUrl = %q", cfg.PublicURL)
	}
}

func TestLoadConfig_AllowsSharePublicURL(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"registry":{"share":{"publicUrl":"https://share.example.com"}}}`)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal(AppConfig) error = %v", err)
	}
	var decoded struct {
		Registry struct {
			Share ShareConfig `json:"share"`
		} `json:"registry"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode AppConfig = %v", err)
	}
	if decoded.Registry.Share.PublicURL != "https://share.example.com" {
		t.Fatalf("registry.share.publicUrl = %q, want %q", decoded.Registry.Share.PublicURL, "https://share.example.com")
	}
}

func TestLoadConfig_FeishuFieldIsAcceptedAsIgnoredLegacyConfig(t *testing.T) {
	path := writeTempConfig(t, `{
		"projects": [{
			"name": "proj",
			"path": "D:/repo",
			"feishu": {"app_id": "cli_xxx"}
		}]
	}`)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if len(cfg.Projects) != 1 {
		t.Fatalf("projects len = %d, want 1", len(cfg.Projects))
	}
	if cfg.Projects[0].Name != "proj" {
		t.Fatalf("project name = %q, want proj", cfg.Projects[0].Name)
	}
}

func TestLoadConfig_FeishuLegacyFieldVariantsAreAcceptedAsIgnoredConfig(t *testing.T) {
	tests := []struct {
		name   string
		config string
	}{
		{
			name: "camel case app credentials",
			config: `{
				"projects": [{
					"name": "proj",
					"path": "D:/repo",
					"feishu": {"appID": "cli_xxx", "appSecret": "secret"}
				}]
			}`,
		},
		{
			name: "historical typo secret",
			config: `{
				"projects": [{
					"name": "proj",
					"path": "D:/repo",
					"feishu": {"app_id": "cli_xxx", "app_secrect": "secret"}
				}]
			}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeTempConfig(t, tt.config)
			cfg, err := LoadConfig(path)
			if err != nil {
				t.Fatalf("LoadConfig() error = %v, want feishu legacy fields ignored", err)
			}
			if len(cfg.Projects) != 1 || cfg.Projects[0].Name != "proj" {
				t.Fatalf("projects=%+v, want parsed project", cfg.Projects)
			}
		})
	}
}

func TestLoadConfig_ConfigExampleIsValid(t *testing.T) {
	path := filepath.Join("..", "..", "config.example.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config.example.json: %v", err)
	}
	if bytes.Contains(raw, []byte(`"api_keys"`)) {
		t.Fatalf("config.example.json still contains removed api_keys field")
	}
	if _, err := LoadConfig(path); err != nil {
		t.Fatalf("LoadConfig(config.example.json) error = %v", err)
	}
}

func TestLoadConfigIgnoresDeprecatedAPIKeys(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"api_keys":{"deepseek":"deepseek-test-key","kimi":"kimi-test-key","qwen":"qwen-test-key","zai":"zai-test-key","flicker":"flicker-test-key"}}`)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v, want deprecated api_keys ignored", err)
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal(AppConfig) error = %v", err)
	}
	if strings.Contains(string(encoded), "api_keys") || strings.Contains(string(encoded), "test-key") {
		t.Fatalf("AppConfig retained deprecated API keys: %s", encoded)
	}
}

func TestAppConfigDoesNotMarshalAPIKeysField(t *testing.T) {
	encoded, err := json.Marshal(AppConfig{
		Projects: []ProjectConfig{},
	})
	if err != nil {
		t.Fatalf("json.Marshal(AppConfig) error = %v", err)
	}
	if strings.Contains(string(encoded), `"api_keys"`) || strings.Contains(string(encoded), `"apiKeys"`) {
		t.Fatalf("AppConfig JSON = %s, contains removed API keys field", encoded)
	}
}

func TestMigrateConfigCanonicalizesLegacyLayouts(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantPublic string
		wantToken  string
		wantHubID  string
		wantPort   int
		wantListen bool
		wantServer bool
	}{
		{
			name:       "entry loopback keeps local fallback",
			input:      `{"projects":[],"registry":{"listen":true,"port":9630,"server":"127.0.0.1","token":"old-token","hubId":"old-hub"}}`,
			wantToken:  "old-token",
			wantHubID:  "old-hub",
			wantPort:   9630,
			wantListen: true,
		},
		{
			name:       "worker server becomes public url without borrowing local port",
			input:      `{"projects":[],"registry":{"listen":false,"port":28800,"server":"registry.example.com","token":"t","hubId":"h"}}`,
			wantPublic: "https://registry.example.com",
			wantToken:  "t",
			wantHubID:  "h",
			wantPort:   28800,
			wantListen: false,
		},
		{
			name:       "worker server keeps its explicit public port",
			input:      `{"projects":[],"registry":{"listen":false,"port":9630,"server":"registry.example.com:28800","token":"t","hubId":"h"}}`,
			wantPublic: "https://registry.example.com:28800",
			wantToken:  "t",
			wantHubID:  "h",
			wantPort:   9630,
			wantListen: false,
		},
		{
			name:       "top level wins mixed values",
			input:      `{"publicUrl":"https://canonical.example.com","token":"top-token","hubId":"top-hub","projects":[],"registry":{"listen":false,"server":"https://legacy.example.com/ws","token":"nested-token","hubId":"nested-hub"}}`,
			wantPublic: "https://canonical.example.com",
			wantToken:  "top-token",
			wantHubID:  "top-hub",
			wantListen: false,
		},
		{
			name:       "loopback worker may omit public url",
			input:      `{"projects":[],"registry":{"listen":false,"port":9631,"server":"http://localhost:9631/ws","token":"t","hubId":"h"}}`,
			wantToken:  "t",
			wantHubID:  "h",
			wantPort:   9631,
			wantListen: false,
		},
		{
			name:       "public url wins conflicting legacy server",
			input:      `{"publicUrl":"https://canonical.example.com","projects":[],"registry":{"listen":false,"port":9630,"server":"https://other.example.com","token":"t","hubId":"h"}}`,
			wantPublic: "https://canonical.example.com",
			wantToken:  "t",
			wantHubID:  "h",
			wantPort:   9630,
			wantListen: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeTempConfig(t, tt.input)
			if err := MigrateConfig(path); err != nil {
				t.Fatalf("MigrateConfig() error = %v", err)
			}
			cfg, err := LoadConfig(path)
			if err != nil {
				t.Fatalf("LoadConfig() error = %v", err)
			}
			if cfg.PublicURL != tt.wantPublic || cfg.Token != tt.wantToken || cfg.HubID != tt.wantHubID {
				t.Fatalf("canonical identity/publicUrl = (%q, %q, %q), want (%q, %q, %q)", cfg.PublicURL, cfg.Token, cfg.HubID, tt.wantPublic, tt.wantToken, tt.wantHubID)
			}
			if cfg.Registry.Port != tt.wantPort || cfg.Registry.Listen != tt.wantListen {
				t.Fatalf("registry = %+v, want port=%d listen=%t", cfg.Registry, tt.wantPort, tt.wantListen)
			}
			var raw map[string]json.RawMessage
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read migrated config: %v", err)
			}
			if err := json.Unmarshal(data, &raw); err != nil {
				t.Fatalf("decode migrated config: %v", err)
			}
			var registry map[string]json.RawMessage
			if err := json.Unmarshal(raw["registry"], &registry); err != nil {
				t.Fatalf("decode migrated registry: %v", err)
			}
			for _, key := range []string{"server", "token", "hubId"} {
				if _, ok := registry[key]; ok {
					t.Fatalf("migrated registry still contains %q: %s", key, data)
				}
			}
		})
	}
}

func TestMigrateConfigMovesTopLevelShareIntoRegistry(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"share":{"publicUrl":"https://share.example.com"}}`)
	if err := MigrateConfig(path); err != nil {
		t.Fatalf("MigrateConfig() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config: %v", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatalf("decode migrated config: %v", err)
	}
	if _, ok := root["share"]; ok {
		t.Fatalf("migrated config retained top-level share: %s", data)
	}
	var registry struct {
		Share ShareConfig `json:"share"`
	}
	if err := json.Unmarshal(root["registry"], &registry); err != nil {
		t.Fatalf("decode migrated registry: %v", err)
	}
	if registry.Share.PublicURL != "https://share.example.com" {
		t.Fatalf("registry.share.publicUrl = %q, want %q", registry.Share.PublicURL, "https://share.example.com")
	}
}

func TestMigrateConfigNestedShareWinsTopLevelShare(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"share":{"publicUrl":"https://legacy-share.example.com"},"registry":{"share":{"publicUrl":"https://canonical-share.example.com"}}}`)
	if err := MigrateConfig(path); err != nil {
		t.Fatalf("MigrateConfig() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config: %v", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatalf("decode migrated config: %v", err)
	}
	if _, ok := root["share"]; ok {
		t.Fatalf("migrated config retained top-level share: %s", data)
	}
	var registry struct {
		Share ShareConfig `json:"share"`
	}
	if err := json.Unmarshal(root["registry"], &registry); err != nil {
		t.Fatalf("decode migrated registry: %v", err)
	}
	if registry.Share.PublicURL != "https://canonical-share.example.com" {
		t.Fatalf("registry.share.publicUrl = %q, want canonical value", registry.Share.PublicURL)
	}
}

func TestMigrateConfigRejectsInvalidRemoteServerWithoutChangingOriginal(t *testing.T) {
	original := `{"projects":[],"registry":{"listen":false,"port":9630,"server":"https://user:pass@example.com/ws?token=secret","token":"t","hubId":"h"}}`
	path := writeTempConfig(t, original)
	if err := MigrateConfig(path); err == nil {
		t.Fatal("MigrateConfig() error = nil, want invalid remote server error")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(data) != original {
		t.Fatalf("invalid migration changed config: %q", data)
	}
}

func TestMigrateConfigRejectsInvalidPublicURLWithoutChangingOriginal(t *testing.T) {
	original := `{"publicUrl":"https://registry.example.com/api","projects":[],"registry":{"listen":true,"port":9630}}`
	path := writeTempConfig(t, original)
	if err := MigrateConfig(path); err == nil {
		t.Fatal("MigrateConfig() error = nil, want invalid publicUrl error")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(data) != original {
		t.Fatalf("invalid publicUrl migration changed config: %q", data)
	}
	if _, err := os.Stat(MigrationBackupPath(path)); !os.IsNotExist(err) {
		t.Fatalf("invalid publicUrl migration left backup: %v", err)
	}
}

func TestMigrateConfigBackupLifecycleAndIdempotence(t *testing.T) {
	original := `{"projects":[],"registry":{"listen":true,"port":9630,"server":"127.0.0.1","token":"t","hubId":"h"}}`
	path := writeTempConfig(t, original)
	if err := MigrateConfig(path); err != nil {
		t.Fatalf("first MigrateConfig() error = %v", err)
	}
	backupPath := MigrationBackupPath(path)
	backup, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatalf("read migration backup: %v", err)
	}
	if string(backup) != original {
		t.Fatalf("backup = %q, want original %q", backup, original)
	}
	info, err := os.Stat(backupPath)
	if err != nil {
		t.Fatalf("stat migration backup: %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("migration backup mode=%o, want 0600", info.Mode().Perm())
	}
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config: %v", err)
	}
	if err := MigrateConfig(path); err != nil {
		t.Fatalf("second MigrateConfig() error = %v", err)
	}
	second, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read idempotent config: %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("second migration changed canonical bytes")
	}
	if err := FinalizeConfigMigration(path); err != nil {
		t.Fatalf("FinalizeConfigMigration() error = %v", err)
	}
	if _, err := os.Stat(backupPath); !os.IsNotExist(err) {
		t.Fatalf("migration backup still exists: %v", err)
	}
}

func TestMigrateConfigConcurrentCallersProduceValidConfig(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"registry":{"listen":true,"port":9630,"server":"127.0.0.1","token":"t","hubId":"h"}}`)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- MigrateConfig(path)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent MigrateConfig() error = %v", err)
		}
	}
	if _, err := LoadConfig(path); err != nil {
		t.Fatalf("LoadConfig() after concurrent migration: %v", err)
	}
}

func TestNormalizeRegistryOriginCanonicalizesTransportAndLoopback(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		port     int
		want     string
		loopback bool
	}{
		{name: "remote wss path", input: "wss://registry.example.com:28800/ws", want: "https://registry.example.com:28800"},
		{name: "remote ws path", input: "ws://registry.example.com:28800/ws", want: "https://registry.example.com:28800"},
		{name: "remote http root", input: "http://registry.example.com:28800/", want: "https://registry.example.com:28800"},
		{name: "loopback localhost", input: "https://localhost:9630/ws", want: "http://localhost:9630", loopback: true},
		{name: "loopback ipv4 range", input: "http://127.20.1.4:9630", want: "http://127.20.1.4:9630", loopback: true},
		{name: "bare remote with fallback port", input: "registry.example.com", port: 28800, want: "https://registry.example.com:28800"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, loopback, err := normalizeRegistryOrigin(tt.input, tt.port)
			if err != nil || got != tt.want || loopback != tt.loopback {
				t.Fatalf("normalizeRegistryOrigin(%q, %d) = (%q, %t, %v), want (%q, %t)", tt.input, tt.port, got, loopback, err, tt.want, tt.loopback)
			}
		})
	}
}

func TestNormalizeRegistryOriginRejectsNonOriginInputs(t *testing.T) {
	for _, input := range []string{
		"https://user:pass@example.com/ws",
		"https://registry.example.com/api",
		"https://registry.example.com/ws?token=secret",
		"https://registry.example.com:bad/ws",
	} {
		if _, _, err := normalizeRegistryOrigin(input, 0); err == nil {
			t.Fatalf("normalizeRegistryOrigin(%q) error=nil, want rejection", input)
		}
	}
}

func TestLoadConfigRejectsRemovedAPIKeysField(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"apiKeys":{"zai":"zai-test-key"}}`)
	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), `unknown field "apiKeys"`) {
		t.Fatalf("LoadConfig() error = %v, want removed apiKeys field rejected", err)
	}
}

func TestLoadConfigIgnoresUnknownDeprecatedAPIKeyField(t *testing.T) {
	path := writeTempConfig(t, `{"projects":[],"api_keys":{"unknown":"value"}}`)
	if _, err := LoadConfig(path); err != nil {
		t.Fatalf("LoadConfig() error = %v, want deprecated api_keys section ignored", err)
	}
}

func TestLoadConfigRejectsServerDataSecrets(t *testing.T) {
	path := writeTempConfig(t, `{
		"projects": [{"name": "p", "path": "."}],
		"secrets": {
			"deepseek": {"value": "deep-key", "updatedAt": "2026-07-13T00:00:00Z"},
			"volcengineAsr": {"value": "speech-key"},
			"mimoTts": {"value": "tts-key"}
		}
	}`)
	if _, err := LoadConfig(path); err == nil || !strings.Contains(err.Error(), `unknown field "secrets"`) {
		t.Fatalf("LoadConfig() error=%v, want secrets rejected", err)
	}
}

func TestWriteConfigFileAtomicallyReplacesContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatalf("write old config: %v", err)
	}
	if err := WriteConfigFile(path, []byte("new\n")); err != nil {
		t.Fatalf("WriteConfigFile(): %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(got) != "new\n" {
		t.Fatalf("config content=%q, want new content", got)
	}
}

type panicStringer struct{}

func (panicStringer) String() string {
	panic("String() should not be called for filtered logs")
}

type failWriter struct{}

func (failWriter) Write(p []byte) (int, error) {
	return 0, os.ErrInvalid
}

func TestLogger_FilteredLogsDoNotFormatArguments(t *testing.T) {
	var out bytes.Buffer
	if err := Setup(LoggerConfig{Level: LevelWarn}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	defer Close()
	SetOutput(&out)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("filtered log unexpectedly formatted arguments: %v", r)
		}
	}()

	Debug("%v", panicStringer{})
	Info("%v", panicStringer{})
}

func TestLoggerFanoutContinuesAfterWriterError(t *testing.T) {
	var out bytes.Buffer
	_, _ = writeAll{failWriter{}, &out}.Write([]byte("persisted\n"))

	if got := out.String(); got != "persisted\n" {
		t.Fatalf("fanout should keep writing after one writer fails, got %q", got)
	}
}

func TestLoggerVerboseLevelWritesVerboseButNotDebug(t *testing.T) {
	if got := ParseLevel("verbose"); got != LevelVerbose {
		t.Fatalf("ParseLevel(verbose)=%v, want %v", got, LevelVerbose)
	}

	var out bytes.Buffer
	if err := Setup(LoggerConfig{Level: LevelVerbose, DebugLogFile: filepath.Join(t.TempDir(), "debug.log")}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	defer Close()
	SetOutput(&out)

	Debug("debug hidden")
	Verbose("session forward request method=%s", "session.read")
	Info("info visible")

	got := out.String()
	if strings.Contains(got, "debug hidden") {
		t.Fatalf("verbose level wrote debug log: %q", got)
	}
	if !strings.Contains(got, "VERBOSE") || !strings.Contains(got, "session forward request method=session.read") {
		t.Fatalf("verbose log missing from output: %q", got)
	}
	if !strings.Contains(got, "INFO") || !strings.Contains(got, "info visible") {
		t.Fatalf("info log missing from output: %q", got)
	}
	if DebugWriter() != nil {
		t.Fatal("verbose level should not create debug writer")
	}
	if !VerboseEnabled() {
		t.Fatal("verbose level should report verbose enabled")
	}
}

func TestDeriveDebugLogPath(t *testing.T) {
	base := filepath.Join("tmp", "hub.log")
	got := deriveDebugLogPath(base)
	want := filepath.Join("tmp", "hub.debug.log")
	if got != want {
		t.Fatalf("deriveDebugLogPath(%q)=%q, want %q", base, got, want)
	}
}

func TestLoggerDebugRotator_RotateOnDayChange(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "hub.debug.log")

	now := time.Date(2026, 4, 8, 10, 0, 0, 0, time.UTC)
	r := newDebugDailyRotator(path, 1, func() time.Time { return now })
	defer r.Close()

	if _, err := r.Write([]byte("day1\n")); err != nil {
		t.Fatalf("write day1: %v", err)
	}
	now = now.Add(24 * time.Hour)
	if _, err := r.Write([]byte("day2\n")); err != nil {
		t.Fatalf("write day2: %v", err)
	}

	archived := filepath.Join(base, "hub.debug.2026-04-08.log")
	if _, err := os.Stat(archived); err != nil {
		t.Fatalf("expected archived file %s: %v", archived, err)
	}
}

func TestLoggerDebugRotator_KeepOneDay(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "hub.debug.log")
	now := time.Date(2026, 4, 8, 0, 0, 0, 0, time.UTC)
	r := newDebugDailyRotator(path, 1, func() time.Time { return now })
	defer r.Close()

	for i := 1; i <= 4; i++ {
		d := now.AddDate(0, 0, -i)
		p := filepath.Join(base, "hub.debug."+d.Format("2006-01-02")+".log")
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("write archive: %v", err)
		}
	}
	if err := r.cleanupOldArchives(); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	keep := filepath.Join(base, "hub.debug."+now.AddDate(0, 0, -1).Format("2006-01-02")+".log")
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("expected kept: %s", keep)
	}

	for i := 2; i <= 4; i++ {
		d := now.AddDate(0, 0, -i)
		p := filepath.Join(base, "hub.debug."+d.Format("2006-01-02")+".log")
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("expected removed: %s", p)
		}
	}
}

func TestLogRetentionKeepsSevenArchives(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "hub.debug.log")
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	rotator := newDebugDailyRotator(path, debugLogArchiveDays, func() time.Time { return now })
	defer rotator.Close()

	for daysAgo := 1; daysAgo <= debugLogArchiveDays+2; daysAgo++ {
		day := now.AddDate(0, 0, -daysAgo)
		archive := filepath.Join(base, "hub.debug."+day.Format(logDayLayout)+".log")
		if err := os.WriteFile(archive, []byte("archive"), 0o600); err != nil {
			t.Fatalf("write archive: %v", err)
		}
	}
	if err := rotator.cleanupOldArchives(); err != nil {
		t.Fatalf("cleanupOldArchives(): %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(base, "hub.debug.*.log"))
	if err != nil {
		t.Fatalf("Glob(): %v", err)
	}
	if len(matches) != debugLogArchiveDays {
		t.Fatalf("archive count=%d, want %d: %v", len(matches), debugLogArchiveDays, matches)
	}
}

func TestSecureConfigFileRestrictsWindowsDACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := SecureConfigFile(path); err != nil {
		t.Fatalf("SecureConfigFile(): %v", err)
	}

	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo(): %v", err)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatalf("descriptor.Control(): %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatal("config DACL inherits permissions")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatalf("descriptor.DACL(): %v", err)
	}
	if dacl == nil || dacl.AceCount != 2 {
		t.Fatalf("DACL ACE count=%v, want current user and SYSTEM only", dacl)
	}

	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatalf("GetTokenUser(): %v", err)
	}
	systemSID, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		t.Fatalf("StringToSid(SYSTEM): %v", err)
	}
	want := []*windows.SID{user.User.Sid, systemSID}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			t.Fatalf("GetAce(%d): %v", index, err)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		matched := false
		for expectedIndex, expectedSID := range want {
			if expectedSID != nil && sid.Equals(expectedSID) {
				want[expectedIndex] = nil
				matched = true
				break
			}
		}
		if !matched {
			t.Fatalf("DACL contains unexpected SID %s", sid.String())
		}
	}
}

func TestConfigureBackgroundCommandHidesConsoleWindow(t *testing.T) {
	cmd := exec.Command("powershell", "-NoProfile")

	ConfigureBackgroundCommand(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil, want hidden window settings")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow=false, want true")
	}
}
