package hubconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type FlickerBridgeMode string

type APIKeyName string

const (
	FlickerBridgeModeV1 FlickerBridgeMode = "v1"
	FlickerBridgeModeV2 FlickerBridgeMode = "v2"

	APIKeyKimi     APIKeyName = "kimi"
	APIKeyQwen     APIKeyName = "qwen"
	APIKeyZAI      APIKeyName = "zai"
	APIKeyDeepSeek APIKeyName = "deepSeek"
	APIKeyFlicker  APIKeyName = "flicker"

	maxConfigBytes = 64 * 1024
	maxSecretBytes = 16 * 1024
	configVersion  = 1
)

// APIKeyNames lists every API key manageable through the hub config store.
var APIKeyNames = []APIKeyName{APIKeyKimi, APIKeyQwen, APIKeyZAI, APIKeyDeepSeek, APIKeyFlicker}

func ValidAPIKeyName(name APIKeyName) bool {
	for _, candidate := range APIKeyNames {
		if name == candidate {
			return true
		}
	}
	return false
}

type secretValue struct {
	Value     string    `json:"value,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type APIKeySnapshot struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

type FlickerBridgeSnapshot struct {
	Mode    FlickerBridgeMode `json:"mode"`
	Enabled bool              `json:"enabled"`
}

type DeepSeekPlatformSnapshot struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

// Snapshot is the sanitized view of the hub config: secret values never leave
// the store, only their configured/updatedAt markers.
type Snapshot struct {
	FlickerBridge    FlickerBridgeSnapshot     `json:"flickerBridge"`
	APIKeys          map[string]APIKeySnapshot `json:"apiKeys"`
	DeepSeekPlatform DeepSeekPlatformSnapshot  `json:"deepSeekPlatform"`
	MCPServers       []MCPServerSnapshot       `json:"mcpServers"`
}

type Store struct {
	mu        sync.Mutex
	path      string
	readFile  func(string) ([]byte, error)
	writeFile func(string, []byte) error
}

func New(path string) *Store {
	return &Store{
		path:      path,
		readFile:  os.ReadFile,
		writeFile: shared.WriteConfigFile,
	}
}

func (s *Store) FlickerBridgeMode() (FlickerBridgeMode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	return modeFromRoot(root)
}

func (s *Store) UpdateFlickerBridgeMode(mode FlickerBridgeMode) error {
	if !validMode(mode) {
		return fmt.Errorf("unsupported Flicker Bridge mode %q", mode)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	section, err := flickerBridgeSection(root)
	if err != nil {
		return err
	}
	rawMode, err := json.Marshal(mode)
	if err != nil {
		return fmt.Errorf("encode Flicker Bridge mode: %w", err)
	}
	section["mode"] = rawMode
	rawSection, err := json.Marshal(section)
	if err != nil {
		return fmt.Errorf("encode Flicker Bridge section: %w", err)
	}
	root["flickerBridge"] = rawSection
	return s.writeRootLocked(root)
}

func (s *Store) FlickerBridgeEnabled() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return false, err
	}
	return flickerBridgeEnabledFromRoot(root)
}

func (s *Store) UpdateFlickerBridgeEnabled(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	section, err := flickerBridgeSection(root)
	if err != nil {
		return err
	}
	rawEnabled, err := json.Marshal(enabled)
	if err != nil {
		return fmt.Errorf("encode Flicker Bridge enabled: %w", err)
	}
	section["enabled"] = rawEnabled
	rawSection, err := json.Marshal(section)
	if err != nil {
		return fmt.Errorf("encode Flicker Bridge section: %w", err)
	}
	root["flickerBridge"] = rawSection
	return s.writeRootLocked(root)
}

// APIKeyValue returns the stored secret for name, or "" when unset.
func (s *Store) APIKeyValue(name APIKeyName) (string, error) {
	if !ValidAPIKeyName(name) {
		return "", fmt.Errorf("unsupported API key %q", name)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	section, err := apiKeysSection(root)
	if err != nil {
		return "", err
	}
	return section[string(name)].Value, nil
}

// APIKeyValues returns every stored API key without exposing them through a
// serializable snapshot. Callers must keep the returned values inside the Hub.
func (s *Store) APIKeyValues() (map[APIKeyName]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	section, err := apiKeysSection(root)
	if err != nil {
		return nil, err
	}
	values := make(map[APIKeyName]string, len(APIKeyNames))
	for _, name := range APIKeyNames {
		values[name] = section[string(name)].Value
	}
	return values, nil
}

func (s *Store) UpdateAPIKey(name APIKeyName, action, value string, now time.Time) error {
	if !ValidAPIKeyName(name) {
		return fmt.Errorf("unsupported API key %q", name)
	}
	if action != "set" && action != "clear" {
		return fmt.Errorf("unsupported API key action %q", action)
	}
	if action == "set" {
		if value == "" {
			return fmt.Errorf("API key value is required")
		}
		if len(value) > maxSecretBytes {
			return fmt.Errorf("API key value exceeds 16 KiB")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	section, err := apiKeysSection(root)
	if err != nil {
		return err
	}
	if action == "clear" {
		delete(section, string(name))
	} else {
		section[string(name)] = secretValue{Value: value, UpdatedAt: now.UTC()}
	}
	rawSection, err := json.Marshal(section)
	if err != nil {
		return fmt.Errorf("encode apiKeys section: %w", err)
	}
	root["apiKeys"] = rawSection
	return s.writeRootLocked(root)
}

func (s *Store) Snapshot() (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return Snapshot{}, err
	}
	mode, err := modeFromRoot(root)
	if err != nil {
		return Snapshot{}, err
	}
	enabled, err := flickerBridgeEnabledFromRoot(root)
	if err != nil {
		return Snapshot{}, err
	}
	keys, err := apiKeysSection(root)
	if err != nil {
		return Snapshot{}, err
	}
	platformSection, err := deepSeekPlatformSection(root)
	if err != nil {
		return Snapshot{}, err
	}
	mcpServers, err := mcpServersFromRoot(root)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{
		FlickerBridge:    FlickerBridgeSnapshot{Mode: mode, Enabled: enabled},
		APIKeys:          make(map[string]APIKeySnapshot, len(APIKeyNames)),
		DeepSeekPlatform: DeepSeekPlatformSnapshot{},
		MCPServers:       make([]MCPServerSnapshot, 0, len(mcpServers)),
	}
	for _, name := range APIKeyNames {
		entry := keys[string(name)]
		keySnapshot := APIKeySnapshot{Configured: entry.Value != ""}
		if !entry.UpdatedAt.IsZero() {
			keySnapshot.UpdatedAt = entry.UpdatedAt.UTC().Format(time.RFC3339)
		}
		snapshot.APIKeys[string(name)] = keySnapshot
	}
	platformEntry := platformSection["token"]
	snapshot.DeepSeekPlatform = DeepSeekPlatformSnapshot{Configured: platformEntry.Value != ""}
	if !platformEntry.UpdatedAt.IsZero() {
		snapshot.DeepSeekPlatform.UpdatedAt = platformEntry.UpdatedAt.UTC().Format(time.RFC3339)
	}
	for _, server := range mcpServers {
		snapshot.MCPServers = append(snapshot.MCPServers, mcpServerSnapshot(server))
	}
	sort.SliceStable(snapshot.MCPServers, func(i, j int) bool {
		return strings.ToLower(snapshot.MCPServers[i].Name) < strings.ToLower(snapshot.MCPServers[j].Name)
	})
	return snapshot, nil
}

func (s *Store) writeRootLocked(root map[string]json.RawMessage) error {
	raw, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return fmt.Errorf("encode hub config: %w", err)
	}
	raw = append(raw, '\n')
	if len(raw) > maxConfigBytes {
		return fmt.Errorf("hub config exceeds 64 KiB")
	}
	if err := s.writeFile(s.path, raw); err != nil {
		return fmt.Errorf("write hub config: %w", err)
	}
	return nil
}

func (s *Store) loadLocked() (map[string]json.RawMessage, bool, error) {
	info, err := os.Stat(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			version, _ := json.Marshal(configVersion)
			return map[string]json.RawMessage{"version": version}, false, nil
		}
		return nil, false, fmt.Errorf("stat hub config: %w", err)
	}
	if info.Size() > maxConfigBytes {
		return nil, true, fmt.Errorf("hub config exceeds 64 KiB")
	}
	if err := shared.SecureConfigFile(s.path); err != nil {
		return nil, true, err
	}
	raw, err := s.readFile(s.path)
	if err != nil {
		return nil, true, fmt.Errorf("read hub config: %w", err)
	}
	if len(raw) > maxConfigBytes {
		return nil, true, fmt.Errorf("hub config exceeds 64 KiB")
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return nil, true, fmt.Errorf("parse hub config")
	}
	var version int
	if err := json.Unmarshal(root["version"], &version); err != nil {
		return nil, true, fmt.Errorf("parse hub config version")
	}
	if version != configVersion {
		return nil, true, fmt.Errorf("unsupported hub config version %d", version)
	}
	if _, err := modeFromRoot(root); err != nil {
		return nil, true, err
	}
	if _, err := mcpServersFromRoot(root); err != nil {
		return nil, true, err
	}
	return root, true, nil
}

func modeFromRoot(root map[string]json.RawMessage) (FlickerBridgeMode, error) {
	rawSection := root["flickerBridge"]
	if len(rawSection) == 0 || string(rawSection) == "null" {
		return FlickerBridgeModeV1, nil
	}
	var section map[string]json.RawMessage
	if err := json.Unmarshal(rawSection, &section); err != nil || section == nil {
		return "", fmt.Errorf("parse hub config flickerBridge section")
	}
	rawMode := section["mode"]
	if len(rawMode) == 0 || string(rawMode) == "null" {
		return FlickerBridgeModeV1, nil
	}
	var mode FlickerBridgeMode
	if err := json.Unmarshal(rawMode, &mode); err != nil {
		return "", fmt.Errorf("parse Flicker Bridge mode")
	}
	if !validMode(mode) {
		return "", fmt.Errorf("unsupported Flicker Bridge mode %q", mode)
	}
	return mode, nil
}

func validMode(mode FlickerBridgeMode) bool {
	return mode == FlickerBridgeModeV1 || mode == FlickerBridgeModeV2
}

func flickerBridgeSection(root map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	section := map[string]json.RawMessage{}
	if raw := root["flickerBridge"]; len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &section); err != nil || section == nil {
			return nil, fmt.Errorf("parse hub config flickerBridge section")
		}
	}
	return section, nil
}

func flickerBridgeEnabledFromRoot(root map[string]json.RawMessage) (bool, error) {
	section, err := flickerBridgeSection(root)
	if err != nil {
		return false, err
	}
	raw := section["enabled"]
	if len(raw) == 0 || string(raw) == "null" {
		return false, nil
	}
	var enabled bool
	if err := json.Unmarshal(raw, &enabled); err != nil {
		return false, fmt.Errorf("parse Flicker Bridge enabled")
	}
	return enabled, nil
}

func apiKeysSection(root map[string]json.RawMessage) (map[string]secretValue, error) {
	section := map[string]secretValue{}
	if raw := root["apiKeys"]; len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &section); err != nil || section == nil {
			return nil, fmt.Errorf("parse hub config apiKeys section")
		}
	}
	return section, nil
}

func deepSeekPlatformSection(root map[string]json.RawMessage) (map[string]secretValue, error) {
	section := map[string]secretValue{}
	if raw := root["deepSeekPlatform"]; len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &section); err != nil || section == nil {
			return nil, fmt.Errorf("parse hub config deepSeekPlatform section")
		}
	}
	return section, nil
}

// DeepSeekPlatformToken returns the stored platform session token, or "" when unset.
func (s *Store) DeepSeekPlatformToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	section, err := deepSeekPlatformSection(root)
	if err != nil {
		return "", err
	}
	return section["token"].Value, nil
}

// UpdateDeepSeekPlatformToken sets or clears the platform session token.
func (s *Store) UpdateDeepSeekPlatformToken(action, value string, now time.Time) error {
	if action != "set" && action != "clear" {
		return fmt.Errorf("unsupported deepSeekPlatform action %q", action)
	}
	if action == "set" {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > maxSecretBytes {
			return fmt.Errorf("deepSeekPlatform token is required and must not exceed 16 KiB")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	section, err := deepSeekPlatformSection(root)
	if err != nil {
		return err
	}
	if action == "clear" {
		delete(section, "token")
	} else {
		section["token"] = secretValue{Value: value, UpdatedAt: now.UTC()}
	}
	rawSection, err := json.Marshal(section)
	if err != nil {
		return fmt.Errorf("encode deepSeekPlatform section: %w", err)
	}
	root["deepSeekPlatform"] = rawSection
	return s.writeRootLocked(root)
}
