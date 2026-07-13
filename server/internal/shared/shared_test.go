package shared

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadConfig_RejectsRemovedIMVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[{"name":"p","path":".","im":{"type":"feishu","version":2}}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), "im.version has been removed") {
		t.Fatalf("err=%v, want removed im.version error", err)
	}
}

func TestLoadConfig_RejectsRemovedProjectDebug(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[{"name":"p","debug":true,"path":"."}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), "projects[].debug has been removed") {
		t.Fatalf("err=%v, want removed project debug error", err)
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

func TestLoadConfig_RejectsRemovedMonitor(t *testing.T) {
	path := writeTempConfig(t, `{
		"monitor": {"server": "127.0.0.1", "port": 9631},
		"projects": [{"name": "p", "path": "."}]
	}`)
	if _, err := LoadConfig(path); err == nil || !strings.Contains(err.Error(), `unknown field "monitor"`) {
		t.Fatalf("LoadConfig() error = %v, want removed monitor field rejected", err)
	}
}

func TestLoadConfig_RejectsRemovedProjectClient(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[{"name":"p","path":".","client":{"agent":"codex"}}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), "projects[].client has been removed") {
		t.Fatalf("err=%v, want removed projects[].client error", err)
	}
}

func TestLoadConfig_RejectsRemovedProjectIMFilter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := []byte(`{"projects":[{"name":"p","path":".","imFilter":{"block":["tool"]}}]}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err := LoadConfig(path)
	if err == nil || !strings.Contains(err.Error(), "projects[].imFilter has been removed") {
		t.Fatalf("err=%v, want removed projects[].imFilter error", err)
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

func TestLoadConfig_FeishuDoesNotRequireCredentials(t *testing.T) {
	path := writeTempConfig(t, `{
		"projects": [{
			"name": "proj",
			"path": "D:/repo",
			"feishu": {}
		}]
	}`)
	if _, err := LoadConfig(path); err != nil {
		t.Fatalf("LoadConfig() error = %v, want feishu ignored", err)
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
	if _, err := LoadConfig(path); err != nil {
		t.Fatalf("LoadConfig(config.example.json) error = %v", err)
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
