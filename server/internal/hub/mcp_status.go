package hub

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/hubconfig"
)

type mcpRuntimeState string

const (
	mcpRuntimeStateDisabled   mcpRuntimeState = "disabled"
	mcpRuntimeStateNotStarted mcpRuntimeState = "not_started"
	mcpRuntimeStateStarting   mcpRuntimeState = "starting"
	mcpRuntimeStateConnected  mcpRuntimeState = "connected"
	mcpRuntimeStateFailed     mcpRuntimeState = "failed"
)

var validMCPRuntimeStates = map[mcpRuntimeState]struct{}{
	mcpRuntimeStateDisabled:   {},
	mcpRuntimeStateNotStarted: {},
	mcpRuntimeStateStarting:   {},
	mcpRuntimeStateConnected:  {},
	mcpRuntimeStateFailed:     {},
}

// MCPRuntimeServerStatus is transient runtime state for one configured MCP
// server. It is never written into HubConfig.
type MCPRuntimeServerStatus struct {
	ServerID  string `json:"serverId"`
	Name      string `json:"name"`
	State     string `json:"state"`
	Error     string `json:"error,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type MCPRuntimeStatusSnapshot struct {
	Servers []MCPRuntimeServerStatus `json:"servers"`
}

type mcpStatusStore struct {
	mu      sync.Mutex
	entries map[string]MCPRuntimeServerStatus
	now     func() time.Time
}

func newMCPStatusStore() *mcpStatusStore {
	return &mcpStatusStore{
		entries: make(map[string]MCPRuntimeServerStatus),
		now:     time.Now,
	}
}

func (s *mcpStatusStore) Sync(configs []hubconfig.MCPServerConfig) MCPRuntimeStatusSnapshot {
	if s == nil {
		return MCPRuntimeStatusSnapshot{Servers: []MCPRuntimeServerStatus{}}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries == nil {
		s.entries = make(map[string]MCPRuntimeServerStatus)
	}
	seen := make(map[string]struct{}, len(configs))
	now := s.nowTime()
	for _, config := range configs {
		id := strings.TrimSpace(config.ID)
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		entry, exists := s.entries[id]
		if !exists || entry.State == string(mcpRuntimeStateDisabled) && config.Enabled {
			entry = MCPRuntimeServerStatus{State: string(mcpRuntimeStateNotStarted)}
		}
		entry.ServerID = id
		entry.Name = config.Name
		if !config.Enabled {
			entry.State = string(mcpRuntimeStateDisabled)
			entry.Error = ""
		}
		if entry.State == "" {
			entry.State = string(mcpRuntimeStateNotStarted)
		}
		if entry.UpdatedAt == "" {
			entry.UpdatedAt = now.Format(time.RFC3339)
		}
		s.entries[id] = entry
	}
	for id := range s.entries {
		if _, ok := seen[id]; !ok {
			delete(s.entries, id)
		}
	}
	return s.snapshotLocked()
}

func (s *mcpStatusStore) Observe(configs []hubconfig.MCPServerConfig, names []string, state mcpRuntimeState, err error) MCPRuntimeStatusSnapshot {
	if s == nil {
		return MCPRuntimeStatusSnapshot{Servers: []MCPRuntimeServerStatus{}}
	}
	if _, ok := validMCPRuntimeStates[state]; !ok || state == mcpRuntimeStateDisabled {
		state = mcpRuntimeStateNotStarted
	}
	s.Sync(configs)
	nameSet := make(map[string]struct{}, len(names))
	for _, name := range names {
		nameSet[strings.ToLower(strings.TrimSpace(name))] = struct{}{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.nowTime().Format(time.RFC3339)
	for id, entry := range s.entries {
		if _, ok := nameSet[strings.ToLower(entry.Name)]; !ok {
			continue
		}
		if entry.State == string(mcpRuntimeStateDisabled) {
			continue
		}
		entry.State = string(state)
		entry.Error = ""
		if state == mcpRuntimeStateFailed && err != nil {
			entry.Error = sanitizeMCPError(err.Error(), configs)
		}
		entry.UpdatedAt = now
		s.entries[id] = entry
	}
	return s.snapshotLocked()
}

func (s *mcpStatusStore) Snapshot() MCPRuntimeStatusSnapshot {
	if s == nil {
		return MCPRuntimeStatusSnapshot{Servers: []MCPRuntimeServerStatus{}}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *mcpStatusStore) snapshotLocked() MCPRuntimeStatusSnapshot {
	servers := make([]MCPRuntimeServerStatus, 0, len(s.entries))
	for _, entry := range s.entries {
		servers = append(servers, entry)
	}
	sort.SliceStable(servers, func(i, j int) bool {
		return strings.ToLower(servers[i].Name) < strings.ToLower(servers[j].Name)
	})
	return MCPRuntimeStatusSnapshot{Servers: servers}
}

func (s *mcpStatusStore) nowTime() time.Time {
	if s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}

var (
	mcpCredentialURLPattern   = regexp.MustCompile(`(?i)(https?://)([^/\s@]+@)`)
	mcpQueryCredentialPattern = regexp.MustCompile(`(?i)([?&](?:token|password|secret|api[_-]?key|key)=[^&#\s]+)`)
	mcpBearerPattern          = regexp.MustCompile(`(?i)\bbearer\s+[^\s,;]+`)
	mcpAssignmentPattern      = regexp.MustCompile(`(?i)\b(password|passphrase|token|secret|authorization|api[_-]?key|credential)\b(\s*[:=]\s*|\s+)[^\s,;]+`)
)

func sanitizeMCPError(message string, configs []hubconfig.MCPServerConfig) string {
	for _, config := range configs {
		for _, value := range config.Env {
			message = redactMCPSecret(message, value.Value)
		}
		for _, value := range config.Headers {
			message = redactMCPSecret(message, value.Value)
		}
	}
	message = mcpCredentialURLPattern.ReplaceAllString(message, `$1[redacted]@`)
	message = mcpQueryCredentialPattern.ReplaceAllString(message, `[redacted]`)
	message = mcpBearerPattern.ReplaceAllString(message, `Bearer [redacted]`)
	message = mcpAssignmentPattern.ReplaceAllString(message, `$1=[redacted]`)
	message = strings.TrimSpace(message)
	if message == "" {
		return "MCP connection failed"
	}
	const maxMCPErrorRunes = 512
	runes := []rune(message)
	if len(runes) > maxMCPErrorRunes {
		return string(runes[:maxMCPErrorRunes]) + "…"
	}
	return message
}

func redactMCPSecret(message, secret string) string {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return message
	}
	return strings.ReplaceAll(message, secret, "[redacted]")
}
