package hubconfig

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	mcpServersSection = "mcpServers"

	MCPTransportStdio MCPTransport = "stdio"
	MCPTransportHTTP  MCPTransport = "http"
)

// MCPTransport is the provider-neutral transport supported by the first MCP
// integration slice.
type MCPTransport string

// MCPValue is an internal HubConfig value. Secret values never belong in a
// sanitized Snapshot, but remain available to the local runtime.
type MCPValue struct {
	Value     string    `json:"value,omitempty"`
	Secret    bool      `json:"secret,omitempty"`
	EnvVar    string    `json:"envVar,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type MCPValueRename struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// MCPValueSnapshot is the frontend-safe representation of an env/header value.
type MCPValueSnapshot struct {
	Value      string `json:"value,omitempty"`
	Secret     bool   `json:"secret,omitempty"`
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

// MCPServerConfig is the raw, Hub-owned MCP server configuration.
type MCPServerConfig struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	Enabled      bool                `json:"enabled"`
	Transport    MCPTransport        `json:"transport"`
	Command      string              `json:"command,omitempty"`
	Args         []string            `json:"args,omitempty"`
	CWD          string              `json:"cwd,omitempty"`
	Env          map[string]MCPValue `json:"env,omitempty"`
	URL          string              `json:"url,omitempty"`
	Headers      map[string]MCPValue `json:"headers,omitempty"`
	CreatedAt    time.Time           `json:"createdAt,omitempty"`
	UpdatedAt    time.Time           `json:"updatedAt,omitempty"`
	ImportedFrom string              `json:"importedFrom,omitempty"`
}

// MCPServerSnapshot is a sanitized frontend-facing MCP server entry.
type MCPServerSnapshot struct {
	ID           string                      `json:"id"`
	Name         string                      `json:"name"`
	Enabled      bool                        `json:"enabled"`
	Transport    MCPTransport                `json:"transport"`
	Command      string                      `json:"command,omitempty"`
	Args         []string                    `json:"args,omitempty"`
	CWD          string                      `json:"cwd,omitempty"`
	Env          map[string]MCPValueSnapshot `json:"env,omitempty"`
	URL          string                      `json:"url,omitempty"`
	Headers      map[string]MCPValueSnapshot `json:"headers,omitempty"`
	CreatedAt    string                      `json:"createdAt,omitempty"`
	UpdatedAt    string                      `json:"updatedAt,omitempty"`
	ImportedFrom string                      `json:"importedFrom,omitempty"`
}

// MCPServerUpdate replaces ordinary fields and merges supplied env/header
// values. Omitted values are preserved so a sanitized frontend can edit a
// server without receiving its existing secrets.
type MCPServerUpdate struct {
	ID            string              `json:"id"`
	Name          string              `json:"name,omitempty"`
	Enabled       *bool               `json:"enabled,omitempty"`
	Transport     MCPTransport        `json:"transport,omitempty"`
	Command       string              `json:"command,omitempty"`
	Args          []string            `json:"args,omitempty"`
	CWD           string              `json:"cwd,omitempty"`
	ClearCWD      bool                `json:"clearCwd,omitempty"`
	Env           map[string]MCPValue `json:"env,omitempty"`
	ClearEnv      []string            `json:"clearEnv,omitempty"`
	RenameEnv     []MCPValueRename    `json:"renameEnv,omitempty"`
	URL           string              `json:"url,omitempty"`
	Headers       map[string]MCPValue `json:"headers,omitempty"`
	ClearHeaders  []string            `json:"clearHeaders,omitempty"`
	RenameHeaders []MCPValueRename    `json:"renameHeaders,omitempty"`
	ImportedFrom  string              `json:"importedFrom,omitempty"`
}

func (s MCPServerConfig) normalized(now time.Time) (MCPServerConfig, error) {
	s.ID = strings.TrimSpace(s.ID)
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	s.Name = strings.TrimSpace(s.Name)
	s.Transport = MCPTransport(strings.ToLower(strings.TrimSpace(string(s.Transport))))
	s.Command = strings.TrimSpace(s.Command)
	s.CWD = strings.TrimSpace(s.CWD)
	s.URL = strings.TrimSpace(s.URL)
	s.ImportedFrom = strings.TrimSpace(s.ImportedFrom)
	s.Args = cloneStrings(s.Args)
	s.Env = cloneMCPValues(s.Env)
	s.Headers = cloneMCPValues(s.Headers)
	touchMCPValues(s.Env, now)
	touchMCPValues(s.Headers, now)
	if s.CreatedAt.IsZero() {
		s.CreatedAt = now.UTC()
	} else {
		s.CreatedAt = s.CreatedAt.UTC()
	}
	s.UpdatedAt = now.UTC()
	if err := validateMCPServer(s); err != nil {
		return MCPServerConfig{}, err
	}
	return s, nil
}

func validateMCPServer(s MCPServerConfig) error {
	if s.ID == "" {
		return fmt.Errorf("MCP server id is required")
	}
	if s.Name == "" {
		return fmt.Errorf("MCP server name is required")
	}
	switch s.Transport {
	case MCPTransportStdio:
		if s.Command == "" {
			return fmt.Errorf("MCP STDIO server %q command is required", s.Name)
		}
		if s.URL != "" || len(s.Headers) > 0 {
			return fmt.Errorf("MCP STDIO server %q cannot contain HTTP fields", s.Name)
		}
	case MCPTransportHTTP:
		if s.URL == "" {
			return fmt.Errorf("MCP HTTP server %q url is required", s.Name)
		}
		parsed, err := url.ParseRequestURI(s.URL)
		if err != nil || parsed.Scheme != "http" && parsed.Scheme != "https" || parsed.User != nil || mcpURLHasCredentialQuery(parsed) {
			return fmt.Errorf("MCP HTTP server %q url is invalid", s.Name)
		}
		if s.Command != "" || len(s.Args) > 0 || s.CWD != "" || len(s.Env) > 0 {
			return fmt.Errorf("MCP HTTP server %q cannot contain STDIO fields", s.Name)
		}
	default:
		return fmt.Errorf("unsupported MCP transport %q", s.Transport)
	}
	if err := validateMCPValues(s.Env, "env"); err != nil {
		return fmt.Errorf("MCP server %q: %w", s.Name, err)
	}
	return validateMCPValues(s.Headers, "headers")
}

func validateMCPValues(values map[string]MCPValue, field string) error {
	seenNames := make(map[string]string, len(values))
	for name, value := range values {
		if strings.TrimSpace(name) == "" || strings.ContainsAny(name, "=\x00\r\n \t") {
			return fmt.Errorf("invalid %s name", field)
		}
		nameKey := strings.ToLower(name)
		if previous, ok := seenNames[nameKey]; ok && previous != name {
			return fmt.Errorf("duplicate %s name %q conflicts with %q", field, name, previous)
		}
		seenNames[nameKey] = name
		if field == "headers" && !validMCPHeaderName(name) {
			return fmt.Errorf("invalid headers name %q", name)
		}
		if len(value.Value) > maxSecretBytes {
			return fmt.Errorf("%s %q exceeds 16 KiB", field, name)
		}
		if strings.Contains(value.Value, "\x00") || field == "headers" && strings.ContainsAny(value.Value, "\r\n") {
			return fmt.Errorf("invalid %s value for %q", field, name)
		}
		if value.EnvVar != "" {
			if !value.Secret || strings.ContainsAny(value.EnvVar, "=\x00\r\n \t") || strings.TrimSpace(value.EnvVar) == "" {
				return fmt.Errorf("invalid secret environment reference for %s %q", field, name)
			}
		}
	}
	return nil
}

func validMCPHeaderName(name string) bool {
	for index := 0; index < len(name); index++ {
		char := name[index]
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' {
			continue
		}
		switch char {
		case '!', '#', '$', '%', '&', '\'', '*', '+', '-', '.', '^', '_', '`', '|', '~':
			continue
		default:
			return false
		}
	}
	return name != ""
}

func mcpURLHasCredentialQuery(parsed *url.URL) bool {
	if parsed == nil {
		return false
	}
	for name, values := range parsed.Query() {
		normalized := strings.ToLower(strings.NewReplacer("-", "_", ".", "_").Replace(strings.TrimSpace(name)))
		for _, marker := range []string{"token", "access_token", "refresh_token", "password", "secret", "api_key", "apikey", "authorization", "bearer", "key"} {
			if strings.Contains(normalized, marker) {
				for _, value := range values {
					if strings.TrimSpace(value) != "" {
						return true
					}
				}
			}
		}
	}
	return false
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

func cloneMCPValues(values map[string]MCPValue) map[string]MCPValue {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]MCPValue, len(values))
	for name, value := range values {
		cloned[name] = value
	}
	return cloned
}

func touchMCPValues(values map[string]MCPValue, now time.Time) {
	for name, value := range values {
		if value.UpdatedAt.IsZero() {
			value.UpdatedAt = now.UTC()
		}
		values[name] = value
	}
}

func cloneMCPServer(server MCPServerConfig) MCPServerConfig {
	server.Args = cloneStrings(server.Args)
	server.Env = cloneMCPValues(server.Env)
	server.Headers = cloneMCPValues(server.Headers)
	return server
}

func cloneMCPServers(servers []MCPServerConfig) []MCPServerConfig {
	if len(servers) == 0 {
		return []MCPServerConfig{}
	}
	cloned := make([]MCPServerConfig, len(servers))
	for index, server := range servers {
		cloned[index] = cloneMCPServer(server)
	}
	return cloned
}

func (s *Store) MCPServers() ([]MCPServerConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	servers, err := mcpServersFromRoot(root)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(servers, func(i, j int) bool {
		return strings.ToLower(servers[i].Name) < strings.ToLower(servers[j].Name)
	})
	return cloneMCPServers(servers), nil
}

func (s *Store) AddMCPServer(server MCPServerConfig, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.addMCPServersLocked([]MCPServerConfig{server}, now)
}

// AddMCPServers persists a validated batch in one HubConfig write. Callers use
// this for imports so a later invalid or conflicting entry cannot leave a
// partially imported collection behind.
func (s *Store) AddMCPServers(incoming []MCPServerConfig, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.addMCPServersLocked(incoming, now)
}

func (s *Store) addMCPServersLocked(incoming []MCPServerConfig, now time.Time) error {
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	servers, err := mcpServersFromRoot(root)
	if err != nil {
		return err
	}
	for _, server := range incoming {
		normalized, err := server.normalized(now)
		if err != nil {
			return err
		}
		if mcpServerIndex(servers, normalized.ID, normalized.Name) >= 0 {
			return fmt.Errorf("MCP server %q already exists", normalized.Name)
		}
		servers = append(servers, normalized)
	}
	return s.writeMCPServersLocked(root, servers)
}

func (s *Store) UpdateMCPServer(update MCPServerUpdate, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	servers, err := mcpServersFromRoot(root)
	if err != nil {
		return err
	}
	index := mcpServerIndex(servers, strings.TrimSpace(update.ID), "")
	if index < 0 {
		return fmt.Errorf("MCP server %q not found", update.ID)
	}
	server := cloneMCPServer(servers[index])
	if update.Name != "" {
		server.Name = update.Name
	}
	if update.Enabled != nil {
		server.Enabled = *update.Enabled
	}
	if update.Transport != "" {
		if update.Transport != server.Transport {
			switch update.Transport {
			case MCPTransportStdio:
				server.URL = ""
				server.Headers = nil
			case MCPTransportHTTP:
				server.Command = ""
				server.Args = nil
				server.CWD = ""
				server.Env = nil
			}
		}
		server.Transport = update.Transport
	}
	if update.Command != "" {
		server.Command = update.Command
	}
	if update.Args != nil {
		server.Args = cloneStrings(update.Args)
	}
	if update.ClearCWD {
		server.CWD = ""
	} else if update.CWD != "" {
		server.CWD = update.CWD
	}
	if update.URL != "" {
		server.URL = update.URL
	}
	if update.ImportedFrom != "" {
		server.ImportedFrom = update.ImportedFrom
	}
	updateEnv := cloneMCPValues(update.Env)
	updateHeaders := cloneMCPValues(update.Headers)
	touchMCPValues(updateEnv, now)
	touchMCPValues(updateHeaders, now)
	var mergeErr error
	server.Env, mergeErr = mergeMCPValues(server.Env, updateEnv, update.ClearEnv, update.RenameEnv)
	if mergeErr != nil {
		return fmt.Errorf("MCP server %q env update: %w", server.Name, mergeErr)
	}
	server.Headers, mergeErr = mergeMCPValues(server.Headers, updateHeaders, update.ClearHeaders, update.RenameHeaders)
	if mergeErr != nil {
		return fmt.Errorf("MCP server %q header update: %w", server.Name, mergeErr)
	}
	server.UpdatedAt = now.UTC()
	if err := validateMCPServer(server); err != nil {
		return err
	}
	for otherIndex, other := range servers {
		if otherIndex != index && (strings.EqualFold(other.ID, server.ID) || strings.EqualFold(other.Name, server.Name)) {
			return fmt.Errorf("MCP server %q already exists", server.Name)
		}
	}
	servers[index] = server
	return s.writeMCPServersLocked(root, servers)
}

func mergeMCPValues(existing, updates map[string]MCPValue, clear []string, renames []MCPValueRename) (map[string]MCPValue, error) {
	merged := cloneMCPValues(existing)
	if merged == nil && len(updates) == 0 && len(clear) == 0 && len(renames) == 0 {
		return nil, nil
	}
	if merged == nil {
		merged = map[string]MCPValue{}
	}
	for _, name := range clear {
		delete(merged, name)
	}
	for _, rename := range renames {
		from := strings.TrimSpace(rename.From)
		to := strings.TrimSpace(rename.To)
		if from == "" || to == "" || strings.EqualFold(from, to) {
			continue
		}
		value, ok := merged[from]
		if !ok {
			continue
		}
		if _, exists := merged[to]; exists {
			return nil, fmt.Errorf("cannot rename %q to existing value %q", from, to)
		}
		delete(merged, from)
		merged[to] = value
	}
	for name, value := range updates {
		merged[name] = value
	}
	return merged, nil
}

func (s *Store) SetMCPServerEnabled(id string, enabled bool, now time.Time) error {
	return s.UpdateMCPServer(MCPServerUpdate{ID: id, Enabled: &enabled}, now)
}

func (s *Store) DeleteMCPServer(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	servers, err := mcpServersFromRoot(root)
	if err != nil {
		return err
	}
	index := mcpServerIndex(servers, strings.TrimSpace(id), "")
	if index < 0 {
		return fmt.Errorf("MCP server %q not found", id)
	}
	servers = append(servers[:index], servers[index+1:]...)
	return s.writeMCPServersLocked(root, servers)
}

func mcpServerIndex(servers []MCPServerConfig, id, name string) int {
	for index, server := range servers {
		if id != "" && strings.EqualFold(server.ID, id) {
			return index
		}
		if name != "" && strings.EqualFold(server.Name, name) {
			return index
		}
	}
	return -1
}

func mcpServersFromRoot(root map[string]json.RawMessage) ([]MCPServerConfig, error) {
	raw := root[mcpServersSection]
	if len(raw) == 0 || string(raw) == "null" {
		return []MCPServerConfig{}, nil
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("parse hub config MCP servers: %w", err)
	}
	servers := make([]MCPServerConfig, 0, len(entries))
	for _, entry := range entries {
		var server MCPServerConfig
		if err := json.Unmarshal(entry, &server); err != nil {
			return nil, fmt.Errorf("parse hub config MCP server: %w", err)
		}
		var enabled struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.Unmarshal(entry, &enabled); err != nil {
			return nil, fmt.Errorf("parse hub config MCP enabled: %w", err)
		}
		if enabled.Enabled == nil {
			server.Enabled = true
		}
		if err := validateMCPServer(server); err != nil {
			return nil, err
		}
		servers = append(servers, cloneMCPServer(server))
	}
	return servers, nil
}

func (s *Store) writeMCPServersLocked(root map[string]json.RawMessage, servers []MCPServerConfig) error {
	encoded, err := json.Marshal(servers)
	if err != nil {
		return fmt.Errorf("encode MCP servers: %w", err)
	}
	root[mcpServersSection] = encoded
	return s.writeRootLocked(root)
}

func mcpServerSnapshot(server MCPServerConfig) MCPServerSnapshot {
	snapshot := MCPServerSnapshot{
		ID:           server.ID,
		Name:         server.Name,
		Enabled:      server.Enabled,
		Transport:    server.Transport,
		Command:      server.Command,
		Args:         cloneStrings(server.Args),
		CWD:          server.CWD,
		Env:          mcpValueSnapshots(server.Env),
		URL:          server.URL,
		Headers:      mcpValueSnapshots(server.Headers),
		ImportedFrom: server.ImportedFrom,
	}
	if !server.CreatedAt.IsZero() {
		snapshot.CreatedAt = server.CreatedAt.UTC().Format(time.RFC3339)
	}
	if !server.UpdatedAt.IsZero() {
		snapshot.UpdatedAt = server.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return snapshot
}

func mcpValueSnapshots(values map[string]MCPValue) map[string]MCPValueSnapshot {
	if len(values) == 0 {
		return nil
	}
	snapshots := make(map[string]MCPValueSnapshot, len(values))
	for name, value := range values {
		entry := MCPValueSnapshot{
			Secret:     value.Secret,
			Configured: value.Value != "" || value.EnvVar != "",
		}
		if !value.Secret {
			entry.Value = value.Value
		}
		if !value.UpdatedAt.IsZero() {
			entry.UpdatedAt = value.UpdatedAt.UTC().Format(time.RFC3339)
		}
		snapshots[name] = entry
	}
	return snapshots
}
