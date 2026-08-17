package hub

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/hubconfig"
)

func TestMCPStatusStoreTransitionsAndKeepsDisabledEntries(t *testing.T) {
	store := newMCPStatusStore()
	store.now = func() time.Time { return time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC) }
	configs := []hubconfig.MCPServerConfig{
		{ID: "neo4j-id", Name: "neo4j", Enabled: true, Transport: hubconfig.MCPTransportStdio, Command: "python"},
		{ID: "disabled-id", Name: "disabled", Enabled: false, Transport: hubconfig.MCPTransportHTTP, URL: "https://mcp.example.test"},
	}

	snapshot := store.Sync(configs)
	if got := mcpStatusState(snapshot, "neo4j"); got != mcpRuntimeStateNotStarted {
		t.Fatalf("initial neo4j state = %q, want %q", got, mcpRuntimeStateNotStarted)
	}
	if got := mcpStatusState(snapshot, "disabled"); got != mcpRuntimeStateDisabled {
		t.Fatalf("initial disabled state = %q, want %q", got, mcpRuntimeStateDisabled)
	}

	store.Observe(configs, []string{"neo4j"}, mcpRuntimeStateStarting, nil)
	if got := mcpStatusState(store.Snapshot(), "neo4j"); got != mcpRuntimeStateStarting {
		t.Fatalf("starting state = %q, want %q", got, mcpRuntimeStateStarting)
	}
	store.Observe(configs, []string{"neo4j"}, mcpRuntimeStateConnected, nil)
	if got := mcpStatusState(store.Snapshot(), "neo4j"); got != mcpRuntimeStateConnected {
		t.Fatalf("connected state = %q, want %q", got, mcpRuntimeStateConnected)
	}
	store.Observe(configs, []string{"neo4j"}, mcpRuntimeStateFailed, errors.New("failed to authenticate"))
	failed := mcpStatusStateEntry(store.Snapshot(), "neo4j")
	if mcpRuntimeState(failed.State) != mcpRuntimeStateFailed || failed.Error != "failed to authenticate" {
		t.Fatalf("failed entry = %#v", failed)
	}
}

func TestMCPStatusErrorRedactsCredentials(t *testing.T) {
	configs := []hubconfig.MCPServerConfig{
		{
			ID: "neo4j-id", Name: "neo4j", Enabled: true,
			Transport: hubconfig.MCPTransportHTTP,
			URL:       "https://mcp.example.test/mcp",
			Headers: map[string]hubconfig.MCPValue{
				"Authorization": {Value: "Bearer super-secret-token", Secret: true},
			},
			Env: map[string]hubconfig.MCPValue{
				"NEO4J_PASSWORD": {Value: "neo4j-password", Secret: true},
			},
		},
	}
	message := `request failed: https://user:pass@mcp.example.test/mcp?access_token=query-access-secret&refresh_token=query-refresh-secret Authorization: Bearer super-secret-token password=neo4j-password`
	got := sanitizeMCPError(message, configs)
	for _, secret := range []string{"user:pass", "query-access-secret", "query-refresh-secret", "super-secret-token", "neo4j-password"} {
		if strings.Contains(got, secret) {
			t.Fatalf("sanitized error contains %q: %q", secret, got)
		}
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("sanitized error = %q, want redaction marker", got)
	}
}

func TestMCPStatusErrorRedactsEnvironmentReferencedCredentials(t *testing.T) {
	t.Setenv("MCP_RUNTIME_TOKEN", "runtime-secret-token")
	configs := []hubconfig.MCPServerConfig{
		{
			ID: "remote-id", Name: "remote", Enabled: true,
			Transport: hubconfig.MCPTransportHTTP,
			URL:       "https://mcp.example.test/mcp",
			Headers: map[string]hubconfig.MCPValue{
				"Authorization": {Secret: true, EnvVar: "MCP_RUNTIME_TOKEN"},
			},
		},
	}
	got := sanitizeMCPError("remote rejected runtime-secret-token", configs)
	if strings.Contains(got, "runtime-secret-token") {
		t.Fatalf("sanitized error leaked environment secret: %q", got)
	}
}

func TestMCPStatusErrorRedactsEnvironmentReferencedCredentialWithDefault(t *testing.T) {
	t.Setenv("MCP_RUNTIME_TOKEN", "runtime-secret-token")
	configs := []hubconfig.MCPServerConfig{
		{
			ID: "remote-id", Name: "remote", Enabled: true,
			Transport: hubconfig.MCPTransportHTTP,
			URL:       "https://mcp.example.test/mcp",
			Headers: map[string]hubconfig.MCPValue{
				"Authorization": {Value: "fallback-token", Secret: true, EnvVar: "MCP_RUNTIME_TOKEN"},
			},
		},
	}
	got := sanitizeMCPError("remote rejected runtime-secret-token", configs)
	if strings.Contains(got, "runtime-secret-token") {
		t.Fatalf("sanitized error leaked environment secret with default: %q", got)
	}
}

func TestMCPStatusFailureOnlyMarksReportedServer(t *testing.T) {
	store := newMCPStatusStore()
	configs := []hubconfig.MCPServerConfig{
		{ID: "broken-id", Name: "broken", Enabled: true, Transport: hubconfig.MCPTransportStdio, Command: "broken"},
		{ID: "healthy-id", Name: "healthy", Enabled: true, Transport: hubconfig.MCPTransportStdio, Command: "healthy"},
	}
	store.Sync(configs)
	store.Observe(configs, []string{"broken"}, mcpRuntimeStateFailed, errors.New("broken MCP process"))
	if got := mcpStatusState(store.Snapshot(), "broken"); got != mcpRuntimeStateFailed {
		t.Fatalf("broken state = %q, want failed", got)
	}
	if got := mcpStatusState(store.Snapshot(), "healthy"); got != mcpRuntimeStateNotStarted {
		t.Fatalf("healthy state = %q, want not_started", got)
	}
}

func mcpStatusState(snapshot MCPRuntimeStatusSnapshot, name string) mcpRuntimeState {
	return mcpRuntimeState(mcpStatusStateEntry(snapshot, name).State)
}

func mcpStatusStateEntry(snapshot MCPRuntimeStatusSnapshot, name string) MCPRuntimeServerStatus {
	for _, entry := range snapshot.Servers {
		if strings.EqualFold(entry.Name, name) {
			return entry
		}
	}
	return MCPRuntimeServerStatus{}
}
