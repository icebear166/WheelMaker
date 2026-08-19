package hubconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStoreMCPAddReturnsSanitizedSnapshot(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "db", "hub-config.json"))
	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	server := MCPServerConfig{
		Name:      "neo4j",
		Transport: MCPTransportStdio,
		Command:   `C:\Users\test\.codex\mcp-venvs\neo4j\Scripts\python.exe`,
		Args:      []string{"-m", "neo4j_mcp_server"},
		Env: map[string]MCPValue{
			"NEO4J_URI":      {Value: "bolt://127.0.0.1:7687"},
			"NEO4J_PASSWORD": {Value: "neo4j-secret", Secret: true},
		},
	}
	if err := store.AddMCPServer(server, now); err != nil {
		t.Fatalf("AddMCPServer: %v", err)
	}

	servers, err := store.MCPServers()
	if err != nil {
		t.Fatalf("MCPServers: %v", err)
	}
	if len(servers) != 1 || servers[0].Name != "neo4j" || servers[0].ID == "" {
		t.Fatalf("stored servers = %#v", servers)
	}
	if got := servers[0].Env["NEO4J_PASSWORD"].Value; got != "neo4j-secret" {
		t.Fatalf("raw secret = %q", got)
	}

	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snapshot.MCPServers) != 1 {
		t.Fatalf("snapshot servers = %#v", snapshot.MCPServers)
	}
	entry := snapshot.MCPServers[0].Env["NEO4J_PASSWORD"]
	if !entry.Secret || !entry.Configured || entry.Value != "" {
		t.Fatalf("secret snapshot = %#v", entry)
	}
	if got := snapshot.MCPServers[0].Env["NEO4J_URI"].Value; got != "bolt://127.0.0.1:7687" {
		t.Fatalf("public env snapshot = %q", got)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if bytes.Contains(raw, []byte("neo4j-secret")) {
		t.Fatalf("snapshot leaked secret: %s", raw)
	}
}

func TestStoreMCPUpdatePreservesSecretWhenValueOmitted(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	now := time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
	if err := store.AddMCPServer(MCPServerConfig{
		Name:      "neo4j",
		Transport: MCPTransportStdio,
		Command:   "python",
		Env: map[string]MCPValue{
			"NEO4J_PASSWORD": {Value: "keep-me", Secret: true},
			"NEO4J_URI":      {Value: "bolt://old"},
		},
	}, now); err != nil {
		t.Fatal(err)
	}
	servers, err := store.MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("MCPServers = %#v, %v", servers, err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{
		ID:        servers[0].ID,
		Name:      "neo4j",
		Transport: MCPTransportStdio,
		Command:   "python3",
		Env: map[string]MCPValue{
			"NEO4J_URI": {Value: "bolt://new"},
		},
	}, now.Add(time.Minute)); err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}

	servers, err = store.MCPServers()
	if err != nil {
		t.Fatal(err)
	}
	if got := servers[0].Env["NEO4J_PASSWORD"].Value; got != "keep-me" {
		t.Fatalf("preserved secret = %q", got)
	}
	if got := servers[0].Env["NEO4J_URI"].Value; got != "bolt://new" {
		t.Fatalf("updated URI = %q", got)
	}
}

func TestStoreMCPUpdateClearSecret(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	now := time.Now().UTC()
	if err := store.AddMCPServer(MCPServerConfig{
		Name:      "neo4j",
		Transport: MCPTransportStdio,
		Command:   "python",
		Env:       map[string]MCPValue{"NEO4J_PASSWORD": {Value: "clear-me", Secret: true}},
	}, now); err != nil {
		t.Fatal(err)
	}
	servers, err := store.MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("MCPServers = %#v, %v", servers, err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{
		ID:        servers[0].ID,
		Name:      "neo4j",
		Transport: MCPTransportStdio,
		Command:   "python",
		ClearEnv:  []string{"NEO4J_PASSWORD"},
	}, now.Add(time.Minute)); err != nil {
		t.Fatalf("UpdateMCPServer clear: %v", err)
	}
	servers, err = store.MCPServers()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := servers[0].Env["NEO4J_PASSWORD"]; ok {
		t.Fatalf("secret survived clear: %#v", servers[0].Env)
	}
}

func TestStoreMCPUpdateSetWinsWhenClearAndSetUseSameKey(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "db", "hub-config.json"))
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "remote", Transport: MCPTransportStdio, Command: "python",
		Env: map[string]MCPValue{"TOKEN": {Value: "old", Secret: true}},
	}, time.Now()); err != nil {
		t.Fatal(err)
	}
	servers, err := store.MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("MCPServers = %#v, %v", servers, err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{
		ID:       servers[0].ID,
		ClearEnv: []string{"TOKEN"},
		Env:      map[string]MCPValue{"TOKEN": {Value: "replacement", Secret: true}},
	}, time.Now()); err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	servers, err = store.MCPServers()
	if err != nil {
		t.Fatal(err)
	}
	if got := servers[0].Env["TOKEN"].Value; got != "replacement" {
		t.Fatalf("TOKEN = %q, want replacement", got)
	}
}

func TestStoreMCPUpdateTransportClearsProviderSpecificFields(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	now := time.Now().UTC()
	if err := store.AddMCPServer(MCPServerConfig{
		Name:      "switchable",
		Transport: MCPTransportStdio,
		Command:   "python",
		Args:      []string{"server.py"},
		Env:       map[string]MCPValue{"TOKEN": {Value: "secret", Secret: true}},
	}, now); err != nil {
		t.Fatal(err)
	}
	servers, err := store.MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("MCPServers = %#v, %v", servers, err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{
		ID:        servers[0].ID,
		Name:      "switchable",
		Transport: MCPTransportHTTP,
		URL:       "https://example.test/mcp",
	}, now.Add(time.Minute)); err != nil {
		t.Fatalf("switch transport: %v", err)
	}
	servers, err = store.MCPServers()
	if err != nil {
		t.Fatal(err)
	}
	if servers[0].Command != "" || len(servers[0].Args) != 0 || len(servers[0].Env) != 0 {
		t.Fatalf("stdio fields survived HTTP switch: %#v", servers[0])
	}
}

func TestStoreMCPUpdateCanClearCWD(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "neo4j", Enabled: true, Transport: MCPTransportStdio,
		Command: "python", CWD: `C:\\mcp`,
	}, time.Now()); err != nil {
		t.Fatalf("AddMCPServer: %v", err)
	}
	servers, err := store.MCPServers()
	if err != nil {
		t.Fatalf("MCPServers: %v", err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{ID: servers[0].ID, ClearCWD: true}, time.Now()); err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	servers, err = store.MCPServers()
	if err != nil {
		t.Fatalf("MCPServers after clear: %v", err)
	}
	if servers[0].CWD != "" {
		t.Fatalf("CWD = %q, want empty", servers[0].CWD)
	}
}

func TestStoreMCPRejectsCredentialQueryURL(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	err := store.AddMCPServer(MCPServerConfig{
		Name:      "remote",
		Transport: MCPTransportHTTP,
		URL:       "https://example.test/mcp?access_token=query-secret",
	}, time.Now())
	if err == nil {
		t.Fatal("credential-bearing query URL was accepted")
	}
}

func TestStoreMCPAddServersIsAtomic(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	err := store.AddMCPServers([]MCPServerConfig{
		{Name: "valid", Transport: MCPTransportStdio, Command: "python"},
		{Name: "invalid", Transport: MCPTransportStdio},
	}, time.Now())
	if err == nil {
		t.Fatal("invalid batch was accepted")
	}
	servers, readErr := store.MCPServers()
	if readErr != nil {
		t.Fatalf("MCPServers: %v", readErr)
	}
	if len(servers) != 0 {
		t.Fatalf("partial batch persisted: %#v", servers)
	}
}

func TestStoreMCPUpdateRenamesSecretWithoutReturningItsValue(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.AddMCPServer(MCPServerConfig{
		Name:      "remote",
		Transport: MCPTransportStdio,
		Command:   "python",
		Env:       map[string]MCPValue{"OLD_TOKEN": {Value: "keep-secret", Secret: true}},
	}, time.Now()); err != nil {
		t.Fatalf("AddMCPServer: %v", err)
	}
	servers, err := store.MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("MCPServers = %#v, %v", servers, err)
	}
	if err := store.UpdateMCPServer(MCPServerUpdate{
		ID:        servers[0].ID,
		RenameEnv: []MCPValueRename{{From: "OLD_TOKEN", To: "NEW_TOKEN"}},
	}, time.Now()); err != nil {
		t.Fatalf("UpdateMCPServer: %v", err)
	}
	servers, err = store.MCPServers()
	if err != nil {
		t.Fatalf("MCPServers after rename: %v", err)
	}
	if _, ok := servers[0].Env["OLD_TOKEN"]; ok {
		t.Fatalf("old token key survived rename: %#v", servers[0].Env)
	}
	if got := servers[0].Env["NEW_TOKEN"]; got.Value != "keep-secret" || !got.Secret {
		t.Fatalf("renamed token = %#v", got)
	}
}

func TestStoreMCPRejectsInvalidTransportAndMissingCommand(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	now := time.Now().UTC()
	for name, server := range map[string]MCPServerConfig{
		"unknown transport":     {Name: "bad", Transport: MCPTransport("sse"), Command: "mcp"},
		"stdio missing command": {Name: "bad", Transport: MCPTransportStdio},
		"http missing url":      {Name: "bad", Transport: MCPTransportHTTP},
	} {
		t.Run(name, func(t *testing.T) {
			if err := store.AddMCPServer(server, now); err == nil {
				t.Fatal("invalid MCP server was accepted")
			}
		})
	}
}

func TestStoreMCPRejectsInvalidValueNamesAndHeaderLineBreaks(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "db", "hub-config.json"))
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "bad-env", Transport: MCPTransportStdio, Command: "python",
		Env: map[string]MCPValue{"BAD NAME": {Value: "value"}},
	}, time.Now()); err == nil {
		t.Fatal("environment name with spaces was accepted")
	}
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "bad-header", Transport: MCPTransportHTTP, URL: "https://example.test/mcp",
		Headers: map[string]MCPValue{"X-Trace": {Value: "first\r\nsecond"}},
	}, time.Now()); err == nil {
		t.Fatal("header line break was accepted")
	}
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "bad-header-name", Transport: MCPTransportHTTP, URL: "https://example.test/mcp",
		Headers: map[string]MCPValue{"X Trace": {Value: "value"}},
	}, time.Now()); err == nil {
		t.Fatal("invalid header name was accepted")
	}
	if err := store.AddMCPServer(MCPServerConfig{
		Name: "duplicate-env", Transport: MCPTransportStdio, Command: "python",
		Env: map[string]MCPValue{"TOKEN": {Value: "one"}, "token": {Value: "two"}},
	}, time.Now()); err == nil {
		t.Fatal("case-insensitive duplicate environment names were accepted")
	}
}

func TestStoreFlickerBridgeModeDefaultsToV1WithoutCreatingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	mode, err := store.FlickerBridgeMode()
	if err != nil {
		t.Fatal(err)
	}
	if mode != FlickerBridgeModeV1 {
		t.Fatalf("mode = %q, want v1", mode)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("default read created config: %v", err)
	}
}

func TestUpdateFlickerBridgeModeCreatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestUpdateFlickerBridgeModePreservesOtherSections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	writeHubConfigFixture(t, path, []byte(`{"version":1,"future":{"enabled":true},"flickerBridge":{"mode":"v1","futureField":7}}`))
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(readHubConfigFixture(t, path), &root); err != nil {
		t.Fatal(err)
	}
	future := root["future"].(map[string]any)
	if future["enabled"] != true {
		t.Fatalf("future section = %#v", future)
	}
	flicker := root["flickerBridge"].(map[string]any)
	if flicker["futureField"] != float64(7) || flicker["mode"] != "v2" {
		t.Fatalf("flickerBridge section = %#v", flicker)
	}
}

func TestUpdateFlickerBridgeModeRejectsInvalidMode(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.UpdateFlickerBridgeMode("v3"); err == nil {
		t.Fatal("invalid mode was accepted")
	}
}

func TestUpdateFlickerBridgeModeDoesNotRewriteInvalidInput(t *testing.T) {
	for name, original := range map[string][]byte{
		"corrupt":         []byte(`{"version":`),
		"unknown-version": []byte(`{"version":2,"flickerBridge":{"mode":"v1"}}`),
		"oversized":       bytes.Repeat([]byte("x"), maxConfigBytes+1),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "hub-config.json")
			writeHubConfigFixture(t, path, original)
			store := New(path)
			if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err == nil {
				t.Fatal("invalid input was accepted")
			}
			if got := readHubConfigFixture(t, path); !bytes.Equal(got, original) {
				t.Fatalf("invalid input was rewritten")
			}
		})
	}
}

func TestStoreSerializesConcurrentUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	var wait sync.WaitGroup
	for index := 0; index < 20; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			mode := FlickerBridgeModeV1
			if index%2 == 0 {
				mode = FlickerBridgeModeV2
			}
			if err := store.UpdateFlickerBridgeMode(mode); err != nil {
				t.Errorf("update: %v", err)
			}
		}(index)
	}
	wait.Wait()
	if _, err := store.FlickerBridgeMode(); err != nil {
		t.Fatal(err)
	}
}

func TestFlickerBridgeEnabledDefaultsToFalse(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "hub-config.json"))
	enabled, err := store.FlickerBridgeEnabled()
	if err != nil {
		t.Fatal(err)
	}
	if enabled {
		t.Fatal("enabled defaults to true")
	}
}

func TestUpdateFlickerBridgeEnabledPreservesMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateFlickerBridgeEnabled(true); err != nil {
		t.Fatal(err)
	}
	enabled, err := store.FlickerBridgeEnabled()
	if err != nil || !enabled {
		t.Fatalf("enabled = %v, err = %v", enabled, err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestUpdateAPIKeySetAndClear(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	if err := store.UpdateAPIKey(APIKeyKimi, "set", "sk-kimi-1", now); err != nil {
		t.Fatal(err)
	}
	if value, err := store.APIKeyValue(APIKeyKimi); err != nil || value != "sk-kimi-1" {
		t.Fatalf("value = %q, err = %v", value, err)
	}
	if err := store.UpdateAPIKey(APIKeyKimi, "clear", "", now); err != nil {
		t.Fatal(err)
	}
	if value, err := store.APIKeyValue(APIKeyKimi); err != nil || value != "" {
		t.Fatalf("value after clear = %q, err = %v", value, err)
	}
}

func TestUpdateAPIKeyRejectsInvalidInput(t *testing.T) {
	now := time.Now()
	for name, call := range map[string]func(*Store) error{
		"unknown-key": func(s *Store) error { return s.UpdateAPIKey("openai", "set", "x", now) },
		"bad-action":  func(s *Store) error { return s.UpdateAPIKey(APIKeyKimi, "replace", "x", now) },
		"empty-value": func(s *Store) error { return s.UpdateAPIKey(APIKeyKimi, "set", "", now) },
		"oversized": func(s *Store) error {
			return s.UpdateAPIKey(APIKeyKimi, "set", string(bytes.Repeat([]byte("x"), maxSecretBytes+1)), now)
		},
		"read-unknown": func(s *Store) error { _, err := s.APIKeyValue("openai"); return err },
	} {
		t.Run(name, func(t *testing.T) {
			store := New(filepath.Join(t.TempDir(), "hub-config.json"))
			if err := call(store); err == nil {
				t.Fatal("invalid input was accepted")
			}
		})
	}
}

func TestUpdateAPIKeyPreservesFlickerBridgeSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateFlickerBridgeMode(FlickerBridgeModeV2); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAPIKey(APIKeyQwen, "set", "sk-qwen-1", time.Now()); err != nil {
		t.Fatal(err)
	}
	if mode, err := store.FlickerBridgeMode(); err != nil || mode != FlickerBridgeModeV2 {
		t.Fatalf("mode = %q, err = %v", mode, err)
	}
}

func TestSnapshotReportsConfiguredFlagsOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	store := New(path)
	if err := store.UpdateAPIKey(APIKeyZAI, "set", "sk-zai-secret", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateFlickerBridgeEnabled(true); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.FlickerBridge.Enabled || snapshot.FlickerBridge.Mode != FlickerBridgeModeV1 {
		t.Fatalf("flickerBridge snapshot = %#v", snapshot.FlickerBridge)
	}
	if !snapshot.APIKeys["zai"].Configured || snapshot.APIKeys["zai"].UpdatedAt == "" {
		t.Fatalf("zai snapshot = %#v", snapshot.APIKeys["zai"])
	}
	if snapshot.APIKeys["kimi"].Configured {
		t.Fatalf("kimi snapshot = %#v", snapshot.APIKeys["kimi"])
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("sk-zai-secret")) {
		t.Fatalf("snapshot leaks secret value: %s", raw)
	}
}

func TestSnapshotLoadsLegacyConfigWithoutAPIKeysSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "hub-config.json")
	writeHubConfigFixture(t, path, []byte(`{"version":1,"flickerBridge":{"mode":"v2"}}`))
	store := New(path)
	snapshot, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.FlickerBridge.Mode != FlickerBridgeModeV2 || snapshot.FlickerBridge.Enabled {
		t.Fatalf("flickerBridge snapshot = %#v", snapshot.FlickerBridge)
	}
	if len(snapshot.APIKeys) != len(APIKeyNames) {
		t.Fatalf("apiKeys snapshot = %#v", snapshot.APIKeys)
	}
}

func writeHubConfigFixture(t *testing.T, path string, raw []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readHubConfigFixture(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestStoreDeepSeekPlatformTokenRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hub-config.json")
	store := New(path)
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	if err := store.UpdateDeepSeekPlatformToken("set", "ds-platform-session", now); err != nil {
		t.Fatalf("set token: %v", err)
	}
	token, err := store.DeepSeekPlatformToken()
	if err != nil || token != "ds-platform-session" {
		t.Fatalf("token=%q err=%v", token, err)
	}
	snapshot, err := store.Snapshot()
	if err != nil || !snapshot.DeepSeekPlatform.Configured || snapshot.DeepSeekPlatform.UpdatedAt == "" {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	if err := store.UpdateDeepSeekPlatformToken("clear", "", now); err != nil {
		t.Fatalf("clear token: %v", err)
	}
	if token, _ := store.DeepSeekPlatformToken(); token != "" {
		t.Fatalf("token after clear=%q", token)
	}
	if err := store.UpdateDeepSeekPlatformToken("bogus", "x", now); err == nil {
		t.Fatal("invalid action must fail")
	}
}

func TestImportCodexMCPConfigMapsNeo4jStdio(t *testing.T) {
	raw := []byte(`
[mcp_servers.neo4j]
command = 'C:\\Users\\test\\.codex\\mcp-venvs\\neo4j\\Scripts\\python.exe'
args = ["-m", "neo4j_mcp_server"]

[mcp_servers.neo4j.env]
NEO4J_DATABASE = "neo4j"
NEO4J_PASSWORD = "neo4j-secret"
NEO4J_READ_ONLY = "true"
NEO4J_URI = "bolt://172.20.5.10:7687"
NEO4J_USERNAME = "neo4j"
`)
	result, err := ImportCodexMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportCodexMCPConfig: %v", err)
	}
	if len(result.Servers) != 1 {
		t.Fatalf("servers = %#v, issues = %#v", result.Servers, result.Issues)
	}
	server := result.Servers[0]
	if server.Name != "neo4j" || server.Transport != MCPTransportStdio {
		t.Fatalf("server identity = %#v", server)
	}
	if server.Command == "" || len(server.Args) != 2 || server.Args[1] != "neo4j_mcp_server" {
		t.Fatalf("server launch = %#v", server)
	}
	if !server.Env["NEO4J_PASSWORD"].Secret || server.Env["NEO4J_PASSWORD"].Value != "neo4j-secret" {
		t.Fatalf("password import = %#v", server.Env["NEO4J_PASSWORD"])
	}
	if len(result.Issues) != 0 {
		t.Fatalf("unexpected import issues = %#v", result.Issues)
	}
}

func TestImportCodexMCPConfigTreatsAPIKeyHeaderAsSecret(t *testing.T) {
	raw := []byte(`
[mcp_servers.remote]
type = "http"
url = "https://example.test/mcp"
http_headers = { X-API-Key = "header-secret" }
`)
	result, err := ImportCodexMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportCodexMCPConfig: %v", err)
	}
	if len(result.Servers) != 1 || len(result.Issues) != 0 {
		t.Fatalf("result = %#v", result)
	}
	value := result.Servers[0].Headers["X-API-Key"]
	if !value.Secret || value.Value != "header-secret" {
		t.Fatalf("API key header = %#v", value)
	}
}

func TestImportCodexMCPConfigPreservesBearerEnvironmentReference(t *testing.T) {
	raw := []byte(`
[mcp_servers.remote]
type = "http"
url = "https://example.test/mcp"
bearer_token_env_var = "REMOTE_TOKEN"
`)
	result, err := ImportCodexMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportCodexMCPConfig: %v", err)
	}
	if len(result.Servers) != 1 || len(result.Issues) != 0 {
		t.Fatalf("result = %#v", result)
	}
	value := result.Servers[0].Headers["Authorization"]
	if !value.Secret || value.EnvVar != "REMOTE_TOKEN" || value.Value != "" {
		t.Fatalf("bearer header = %#v", value)
	}
}

func TestImportClaudeMCPConfigPreservesExactEnvironmentReference(t *testing.T) {
	raw := []byte(`{
  "mcpServers": {
    "remote": {
      "type": "http",
      "url": "https://example.test/mcp",
      "headers": {"Authorization": "${REMOTE_TOKEN}"}
    },
    "composite": {
      "type": "http",
      "url": "https://example.test/composite",
      "headers": {"Authorization": "Bearer ${REMOTE_TOKEN}"}
    }
  }
}`)
	result, err := ImportClaudeMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportClaudeMCPConfig: %v", err)
	}
	if len(result.Servers) != 1 || len(result.Issues) != 1 {
		t.Fatalf("result = %#v", result)
	}
	value := result.Servers[0].Headers["Authorization"]
	if !value.Secret || value.EnvVar != "REMOTE_TOKEN" || value.Value != "" {
		t.Fatalf("Claude environment reference = %#v", value)
	}
	if !strings.Contains(strings.ToLower(result.Issues[0].Reason), "interpolation") {
		t.Fatalf("composite interpolation issue = %#v", result.Issues[0])
	}
}

func TestImportMCPConfigReportsUnsupportedAuthFields(t *testing.T) {
	raw := []byte(`
[mcp_servers.remote]
type = "http"
url = "https://example.test/mcp"
auth = "oauth"
`)
	result, err := ImportCodexMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportCodexMCPConfig: %v", err)
	}
	if len(result.Servers) != 0 || len(result.Issues) != 1 || !strings.Contains(strings.ToLower(result.Issues[0].Reason), "auth") {
		t.Fatalf("result = %#v", result)
	}
}

func TestImportClaudeMCPConfigSkipsSSEWithReason(t *testing.T) {
	raw := []byte(`{
  "mcpServers": {
    "legacy": {"type": "sse", "url": "https://example.test/sse"},
    "docs": {"type": "http", "url": "https://example.test/mcp", "headers": {"X-Region": "test"}}
  }
}`)
	result, err := ImportClaudeMCPConfig(raw)
	if err != nil {
		t.Fatalf("ImportClaudeMCPConfig: %v", err)
	}
	if len(result.Servers) != 1 || result.Servers[0].Name != "docs" || result.Servers[0].Transport != MCPTransportHTTP {
		t.Fatalf("servers = %#v, issues = %#v", result.Servers, result.Issues)
	}
	if len(result.Issues) != 1 || !strings.Contains(result.Issues[0].Reason, "SSE") {
		t.Fatalf("issues = %#v", result.Issues)
	}
}

func TestImportMCPNameConflictRequiresResolution(t *testing.T) {
	existing := []MCPServerConfig{{ID: "existing", Name: "neo4j"}}
	imported := []MCPServerConfig{{Name: "neo4j"}, {Name: "docs"}}
	conflicts := FindMCPImportConflicts(existing, imported)
	if len(conflicts) != 1 || conflicts[0].Name != "neo4j" {
		t.Fatalf("conflicts = %#v", conflicts)
	}
}

func TestImportMCPNameConflictIncludesCaseInsensitiveDuplicates(t *testing.T) {
	imported := []MCPServerConfig{{Name: "neo4j"}, {Name: "Neo4j"}}
	conflicts := FindMCPImportConflicts(nil, imported)
	if len(conflicts) != 1 || conflicts[0].Name != "Neo4j" {
		t.Fatalf("conflicts = %#v", conflicts)
	}
}

func TestPreviewMCPImportSanitizesValuesAndReportsIssues(t *testing.T) {
	raw := []byte(`
[mcp_servers.neo4j]
command = "python"

[mcp_servers.neo4j.env]
NEO4J_PASSWORD = "preview-secret"

[mcp_servers.legacy]
type = "sse"
url = "https://example.test/sse"
`)
	preview, err := PreviewMCPImport("codex", raw, []MCPServerConfig{{ID: "existing", Name: "neo4j"}})
	if err != nil {
		t.Fatalf("PreviewMCPImport: %v", err)
	}
	if len(preview.Servers) != 1 || len(preview.Issues) != 1 || len(preview.Conflicts) != 1 || preview.Conflicts[0] != "neo4j" {
		t.Fatalf("preview = %#v", preview)
	}
	password := preview.Servers[0].Env["NEO4J_PASSWORD"]
	if password.Value != "" || !password.Secret || !password.Configured {
		t.Fatalf("preview secret = %#v", password)
	}
}
