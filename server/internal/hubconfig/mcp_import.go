package hubconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/google/uuid"
)

// MCPImportIssue explains an entry that could not be imported without
// changing its meaning.
type MCPImportIssue struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// MCPImportResult contains importable entries and non-fatal preview issues.
type MCPImportResult struct {
	Servers []MCPServerConfig `json:"servers"`
	Issues  []MCPImportIssue  `json:"issues"`
}

type mcpImportEntry struct {
	Type           string            `json:"type" toml:"type"`
	Command        string            `json:"command" toml:"command"`
	Args           []string          `json:"args" toml:"args"`
	CWD            string            `json:"cwd" toml:"cwd"`
	Env            map[string]string `json:"env" toml:"env"`
	EnvVars        []string          `json:"env_vars" toml:"env_vars"`
	URL            string            `json:"url" toml:"url"`
	Headers        map[string]string `json:"headers" toml:"headers"`
	HTTPHeaders    map[string]string `json:"http_headers" toml:"http_headers"`
	EnvHTTPHeaders map[string]string `json:"env_http_headers" toml:"env_http_headers"`
	Enabled        *bool             `json:"enabled" toml:"enabled"`
	Disabled       bool              `json:"disabled" toml:"disabled"`
}

func (e mcpImportEntry) enabled() bool {
	if e.Enabled != nil {
		return *e.Enabled
	}
	return !e.Disabled
}

func (e mcpImportEntry) toServer(name, source string) (MCPServerConfig, MCPImportIssue, bool) {
	name = strings.TrimSpace(name)
	typeName := strings.ToLower(strings.TrimSpace(e.Type))
	if typeName == "sse" || typeName == "websocket" || typeName == "ws" {
		return MCPServerConfig{}, MCPImportIssue{Name: name, Reason: fmt.Sprintf("%s transport is not supported in the first MCP release", strings.ToUpper(typeName))}, false
	}
	server := MCPServerConfig{
		ID:           uuid.NewString(),
		Name:         name,
		Enabled:      e.enabled(),
		Command:      strings.TrimSpace(e.Command),
		Args:         cloneStrings(e.Args),
		CWD:          strings.TrimSpace(e.CWD),
		URL:          strings.TrimSpace(e.URL),
		Env:          make(map[string]MCPValue),
		Headers:      make(map[string]MCPValue),
		ImportedFrom: source,
	}
	if server.URL != "" || typeName == "http" || typeName == "streamable-http" || typeName == "remote" {
		server.Transport = MCPTransportHTTP
		for name, value := range e.Headers {
			server.Headers[name] = MCPValue{Value: value, Secret: sensitiveMCPName(name)}
		}
		for name, value := range e.HTTPHeaders {
			server.Headers[name] = MCPValue{Value: value, Secret: sensitiveMCPName(name)}
		}
		for headerName, envName := range e.EnvHTTPHeaders {
			if value, ok := os.LookupEnv(strings.TrimSpace(envName)); ok {
				server.Headers[headerName] = MCPValue{Value: value, Secret: true}
			} else {
				server.Headers[headerName] = MCPValue{Secret: true}
			}
		}
	} else {
		server.Transport = MCPTransportStdio
		for name, value := range e.Env {
			server.Env[name] = MCPValue{Value: value, Secret: sensitiveMCPName(name)}
		}
		for _, envName := range e.EnvVars {
			envName = strings.TrimSpace(envName)
			if envName == "" {
				continue
			}
			value, _ := os.LookupEnv(envName)
			server.Env[envName] = MCPValue{Value: value, Secret: true}
		}
	}
	if err := validateMCPServer(server); err != nil {
		return MCPServerConfig{}, MCPImportIssue{Name: name, Reason: err.Error()}, false
	}
	return server, MCPImportIssue{}, true
}

func sensitiveMCPName(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, marker := range []string{"password", "passwd", "token", "secret", "authorization", "api_key", "apikey", "credential"} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}

// ImportCodexMCPConfig parses a Codex config.toml MCP section without writing
// the native file back.
func ImportCodexMCPConfig(raw []byte) (MCPImportResult, error) {
	var config map[string]any
	if _, err := toml.Decode(string(raw), &config); err != nil {
		return MCPImportResult{}, fmt.Errorf("parse Codex MCP config: %w", err)
	}
	section, ok := config["mcp_servers"].(map[string]any)
	if !ok {
		return MCPImportResult{Servers: []MCPServerConfig{}, Issues: []MCPImportIssue{}}, nil
	}
	entries := make(map[string]mcpImportEntry, len(section))
	for name, rawEntry := range section {
		encoded, err := json.Marshal(rawEntry)
		if err != nil {
			return MCPImportResult{}, fmt.Errorf("encode Codex MCP server %q: %w", name, err)
		}
		var entry mcpImportEntry
		if err := json.Unmarshal(encoded, &entry); err != nil {
			return MCPImportResult{}, fmt.Errorf("decode Codex MCP server %q: %w", name, err)
		}
		entries[name] = entry
	}
	return importMCPEntries(entries, "codex"), nil
}

type claudeMCPConfig struct {
	MCPServers map[string]json.RawMessage `json:"mcpServers"`
}

// ImportClaudeMCPConfig parses Claude user/project MCP JSON without writing
// the native file back.
func ImportClaudeMCPConfig(raw []byte) (MCPImportResult, error) {
	var config claudeMCPConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return MCPImportResult{}, fmt.Errorf("parse Claude MCP config: %w", err)
	}
	entries := make(map[string]mcpImportEntry, len(config.MCPServers))
	for name, rawEntry := range config.MCPServers {
		var entry mcpImportEntry
		if err := json.Unmarshal(rawEntry, &entry); err != nil {
			return MCPImportResult{}, fmt.Errorf("parse Claude MCP server %q: %w", name, err)
		}
		entries[name] = entry
	}
	return importMCPEntries(entries, "claude"), nil
}

func importMCPEntries(entries map[string]mcpImportEntry, source string) MCPImportResult {
	result := MCPImportResult{Servers: []MCPServerConfig{}, Issues: []MCPImportIssue{}}
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		server, issue, ok := entries[name].toServer(name, source)
		if ok {
			result.Servers = append(result.Servers, server)
		} else {
			result.Issues = append(result.Issues, issue)
		}
	}
	return result
}

type MCPImportConflict struct {
	Name string `json:"name"`
}

// FindMCPImportConflicts reports same-name entries before an import is saved.
func FindMCPImportConflicts(existing, imported []MCPServerConfig) []MCPImportConflict {
	known := make(map[string]struct{}, len(existing))
	for _, server := range existing {
		known[strings.ToLower(strings.TrimSpace(server.Name))] = struct{}{}
	}
	conflicts := make([]MCPImportConflict, 0)
	for _, server := range imported {
		name := strings.TrimSpace(server.Name)
		if _, ok := known[strings.ToLower(name)]; ok {
			conflicts = append(conflicts, MCPImportConflict{Name: name})
		}
	}
	sort.SliceStable(conflicts, func(i, j int) bool { return conflicts[i].Name < conflicts[j].Name })
	return conflicts
}
