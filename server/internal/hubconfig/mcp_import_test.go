package hubconfig

import (
	"strings"
	"testing"
)

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
