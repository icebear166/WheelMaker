package hubconfig

import (
	"bytes"
	"encoding/json"
	"path/filepath"
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
