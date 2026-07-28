package hubconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type FlickerBridgeMode string

const (
	FlickerBridgeModeV1 FlickerBridgeMode = "v1"
	FlickerBridgeModeV2 FlickerBridgeMode = "v2"
	maxConfigBytes                        = 64 * 1024
	configVersion                         = 1
)

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
	section := map[string]json.RawMessage{}
	if raw := root["flickerBridge"]; len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &section); err != nil || section == nil {
			return fmt.Errorf("parse hub config flickerBridge section")
		}
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
