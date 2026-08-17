package hub

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/hubconfig"
)

func TestHubMCPServersReturnsOnlyEnabledEntries(t *testing.T) {
	store := hubconfig.New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.AddMCPServer(hubconfig.MCPServerConfig{
		Name:      "disabled",
		Enabled:   false,
		Transport: hubconfig.MCPTransportStdio,
		Command:   "disabled-mcp",
	}, testMCPNow()); err != nil {
		t.Fatal(err)
	}
	if err := store.AddMCPServer(hubconfig.MCPServerConfig{
		Name:      "neo4j",
		Enabled:   true,
		Transport: hubconfig.MCPTransportStdio,
		Command:   "python",
		Env: map[string]hubconfig.MCPValue{
			"NEO4J_URI": {Value: "bolt://127.0.0.1:7687"},
		},
	}, testMCPNow()); err != nil {
		t.Fatal(err)
	}

	servers, err := hubMCPServers(store)
	if err != nil {
		t.Fatalf("hubMCPServers: %v", err)
	}
	if len(servers) != 1 || servers[0].Name != "neo4j" {
		t.Fatalf("effective MCP servers = %#v, want only enabled neo4j", servers)
	}
}

func TestHubMCPServersResolvesEnvironmentReferencesAtRuntime(t *testing.T) {
	t.Setenv("REMOTE_MCP_TOKEN", "runtime-token")
	store := hubconfig.New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.AddMCPServer(hubconfig.MCPServerConfig{
		Name:      "remote",
		Enabled:   true,
		Transport: hubconfig.MCPTransportHTTP,
		URL:       "https://example.test/mcp",
		Headers: map[string]hubconfig.MCPValue{
			"Authorization": {Secret: true, EnvVar: "REMOTE_MCP_TOKEN"},
		},
	}, testMCPNow()); err != nil {
		t.Fatal(err)
	}
	servers, err := hubMCPServers(store)
	if err != nil {
		t.Fatalf("hubMCPServers: %v", err)
	}
	if len(servers) != 1 || len(servers[0].Headers) != 1 || servers[0].Headers[0].Value != "runtime-token" {
		t.Fatalf("effective MCP headers = %#v, want runtime environment reference", servers)
	}
}

func TestHubMCPServersOmitsUnsetEnvironmentReferences(t *testing.T) {
	store := hubconfig.New(filepath.Join(t.TempDir(), "hub-config.json"))
	if err := store.AddMCPServer(hubconfig.MCPServerConfig{
		Name: "remote", Enabled: true, Transport: hubconfig.MCPTransportHTTP,
		URL: "https://example.test/mcp",
		Headers: map[string]hubconfig.MCPValue{
			"Authorization": {Secret: true, EnvVar: "UNSET_REMOTE_MCP_TOKEN"},
		},
	}, testMCPNow()); err != nil {
		t.Fatal(err)
	}
	servers, err := hubMCPServers(store)
	if err != nil {
		t.Fatalf("hubMCPServers: %v", err)
	}
	if len(servers) != 1 || len(servers[0].Headers) != 0 {
		t.Fatalf("effective MCP headers = %#v, want unset reference omitted", servers)
	}
}

func testMCPNow() time.Time {
	return time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)
}
