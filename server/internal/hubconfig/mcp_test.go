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
