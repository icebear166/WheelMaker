package hubconfig

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"

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

// MCPImportPreview is safe to return to a frontend. Imported server values are
// sanitized in the same way as the persisted HubConfig snapshot.
type MCPImportPreview struct {
	Source    string              `json:"source"`
	Servers   []MCPServerSnapshot `json:"servers"`
	Issues    []MCPImportIssue    `json:"issues"`
	Conflicts []string            `json:"conflicts"`
}

type mcpImportEntry struct {
	Type              string            `json:"type" toml:"type"`
	Command           string            `json:"command" toml:"command"`
	Args              []string          `json:"args" toml:"args"`
	CWD               string            `json:"cwd" toml:"cwd"`
	Env               map[string]string `json:"env" toml:"env"`
	EnvVars           []string          `json:"env_vars" toml:"env_vars"`
	URL               string            `json:"url" toml:"url"`
	Headers           map[string]string `json:"headers" toml:"headers"`
	HTTPHeaders       map[string]string `json:"http_headers" toml:"http_headers"`
	EnvHTTPHeaders    map[string]string `json:"env_http_headers" toml:"env_http_headers"`
	BearerTokenEnvVar string            `json:"bearer_token_env_var" toml:"bearer_token_env_var"`
	Enabled           *bool             `json:"enabled" toml:"enabled"`
	Disabled          bool              `json:"disabled" toml:"disabled"`
	Unsupported       []string          `json:"-"`
}

func (e mcpImportEntry) enabled() bool {
	if e.Enabled != nil {
		return *e.Enabled
	}
	return !e.Disabled
}

func (e mcpImportEntry) toServer(name, source string) (MCPServerConfig, MCPImportIssue, bool) {
	name = strings.TrimSpace(name)
	unsupported := append([]string(nil), e.Unsupported...)
	if strings.EqualFold(source, "claude") && claudeMCPEntryUsesUnsupportedInterpolation(e) {
		unsupported = append(unsupported, "environment variable interpolation")
		sort.SliceStable(unsupported, func(i, j int) bool {
			return strings.ToLower(unsupported[i]) < strings.ToLower(unsupported[j])
		})
	}
	if len(unsupported) > 0 {
		return MCPServerConfig{}, MCPImportIssue{
			Name:   name,
			Reason: "unsupported MCP fields: " + strings.Join(unsupported, ", "),
		}, false
	}
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
			server.Headers[name] = importedMCPValue(name, value, source)
		}
		for name, value := range e.HTTPHeaders {
			server.Headers[name] = importedMCPValue(name, value, source)
		}
		for headerName, envName := range e.EnvHTTPHeaders {
			envName = strings.TrimSpace(envName)
			if envName == "" {
				continue
			}
			server.Headers[headerName] = MCPValue{Secret: true, EnvVar: envName}
		}
		if envName := strings.TrimSpace(e.BearerTokenEnvVar); envName != "" {
			server.Headers["Authorization"] = MCPValue{Secret: true, EnvVar: envName}
		}
	} else {
		server.Transport = MCPTransportStdio
		for name, value := range e.Env {
			server.Env[name] = importedMCPValue(name, value, source)
		}
		for _, envName := range e.EnvVars {
			envName = strings.TrimSpace(envName)
			if envName == "" {
				continue
			}
			server.Env[envName] = MCPValue{Secret: true, EnvVar: envName}
		}
	}
	if err := validateMCPServer(server); err != nil {
		return MCPServerConfig{}, MCPImportIssue{Name: name, Reason: err.Error()}, false
	}
	return server, MCPImportIssue{}, true
}

func importedMCPValue(name, value, source string) MCPValue {
	if strings.EqualFold(source, "claude") {
		if envName, ok := exactMCPEnvironmentReference(value); ok {
			return MCPValue{Secret: true, EnvVar: envName}
		}
	}
	return MCPValue{Value: value, Secret: sensitiveMCPName(name)}
}

func exactMCPEnvironmentReference(value string) (string, bool) {
	if len(value) < 4 || !strings.HasPrefix(value, "${") || !strings.HasSuffix(value, "}") {
		return "", false
	}
	name := value[2 : len(value)-1]
	if !validMCPEnvironmentReferenceName(name) {
		return "", false
	}
	return name, true
}

func validMCPEnvironmentReferenceName(name string) bool {
	if name == "" || name[0] >= '0' && name[0] <= '9' {
		return false
	}
	for index := 0; index < len(name); index++ {
		char := name[index]
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' {
			continue
		}
		return false
	}
	return true
}

func claudeMCPEntryUsesUnsupportedInterpolation(entry mcpImportEntry) bool {
	containsUnsupported := func(value string, exactReferenceAllowed bool) bool {
		if !strings.Contains(value, "${") {
			return false
		}
		return !exactReferenceAllowed || func() bool {
			_, ok := exactMCPEnvironmentReference(value)
			return !ok
		}()
	}
	if containsUnsupported(entry.Command, false) || containsUnsupported(entry.CWD, false) || containsUnsupported(entry.URL, false) {
		return true
	}
	for _, value := range entry.Args {
		if containsUnsupported(value, false) {
			return true
		}
	}
	for _, values := range []map[string]string{entry.Env, entry.Headers, entry.HTTPHeaders} {
		for _, value := range values {
			if containsUnsupported(value, true) {
				return true
			}
		}
	}
	return false
}

func sensitiveMCPName(name string) bool {
	name = strings.Map(func(char rune) rune {
		if unicode.IsLetter(char) || unicode.IsDigit(char) {
			return unicode.ToLower(char)
		}
		return '_'
	}, strings.TrimSpace(name))
	for _, marker := range []string{"password", "passwd", "token", "secret", "authorization", "api_key", "apikey", "access_token", "refresh_token", "credential", "private_key", "client_secret", "bearer"} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return name == "key" || strings.HasSuffix(name, "_key") || strings.HasPrefix(name, "key_")
}

var unsupportedMCPImportFields = map[string]struct{}{
	"auth":                {},
	"authorization":       {},
	"access_token":        {},
	"refresh_token":       {},
	"token":               {},
	"api_key":             {},
	"apikey":              {},
	"client_id":           {},
	"client_secret":       {},
	"oauth":               {},
	"oauth_client_id":     {},
	"oauth_client_secret": {},
	"oauth_scopes":        {},
	"required":            {},
	"startup_timeout_sec": {},
	"tool_timeout_sec":    {},
	"tools":               {},
	"allowed_tools":       {},
	"denied_tools":        {},
	"tool_allowlist":      {},
	"tool_denylist":       {},
}

func unsupportedMCPImportFieldNames(raw any) []string {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		return nil
	}
	unsupported := make([]string, 0)
	for name := range fields {
		normalized := strings.ToLower(strings.TrimSpace(name))
		if _, ok := unsupportedMCPImportFields[normalized]; ok {
			unsupported = append(unsupported, name)
		}
	}
	sort.SliceStable(unsupported, func(i, j int) bool {
		return strings.ToLower(unsupported[i]) < strings.ToLower(unsupported[j])
	})
	return unsupported
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
		entry.Unsupported = unsupportedMCPImportFieldNames(rawEntry)
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
		var rawFields map[string]json.RawMessage
		if err := json.Unmarshal(rawEntry, &rawFields); err == nil {
			entry.Unsupported = unsupportedMCPImportFieldNames(rawFields)
		}
		entries[name] = entry
	}
	return importMCPEntries(entries, "claude"), nil
}

// PreviewMCPImport parses a native config and reports importable entries,
// unsupported entries, and same-name conflicts without mutating the store.
func PreviewMCPImport(source string, raw []byte, existing []MCPServerConfig) (MCPImportPreview, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	var (
		result MCPImportResult
		err    error
	)
	switch source {
	case "codex":
		result, err = ImportCodexMCPConfig(raw)
	case "claude":
		result, err = ImportClaudeMCPConfig(raw)
	default:
		return MCPImportPreview{}, fmt.Errorf("unsupported MCP import source %q", source)
	}
	if err != nil {
		return MCPImportPreview{}, err
	}
	servers := make([]MCPServerSnapshot, 0, len(result.Servers))
	for _, server := range result.Servers {
		servers = append(servers, mcpServerSnapshot(server))
	}
	sort.SliceStable(servers, func(i, j int) bool {
		return strings.ToLower(servers[i].Name) < strings.ToLower(servers[j].Name)
	})
	conflicts := FindMCPImportConflicts(existing, result.Servers)
	conflictNames := make([]string, 0, len(conflicts))
	for _, conflict := range conflicts {
		conflictNames = append(conflictNames, conflict.Name)
	}
	return MCPImportPreview{
		Source:    source,
		Servers:   servers,
		Issues:    append([]MCPImportIssue(nil), result.Issues...),
		Conflicts: conflictNames,
	}, nil
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
		key := strings.ToLower(name)
		if _, ok := known[key]; ok {
			conflicts = append(conflicts, MCPImportConflict{Name: name})
			continue
		}
		known[key] = struct{}{}
	}
	sort.SliceStable(conflicts, func(i, j int) bool { return conflicts[i].Name < conflicts[j].Name })
	return conflicts
}
