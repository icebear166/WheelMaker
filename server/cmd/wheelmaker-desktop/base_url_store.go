package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type desktopConfig struct {
	BaseURL string `json:"baseUrl,omitempty"`
}

type desktopConfigStore interface {
	Load() (desktopConfig, error)
	Save(config desktopConfig) error
}

type fileDesktopConfigStore struct {
	path string
}

func newDefaultDesktopConfigStore() (*fileDesktopConfigStore, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user home: %w", err)
	}
	return newFileDesktopConfigStore(filepath.Join(home, ".wheelmaker", "desktop", "config.json")), nil
}

func newFileDesktopConfigStore(path string) *fileDesktopConfigStore {
	return &fileDesktopConfigStore{path: path}
}

func (s *fileDesktopConfigStore) Load() (desktopConfig, error) {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return desktopConfig{}, nil
	}
	if err != nil {
		return desktopConfig{}, err
	}
	var config desktopConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return desktopConfig{}, fmt.Errorf("decode desktop config: %w", err)
	}
	return config, nil
}

func (s *fileDesktopConfigStore) Save(config desktopConfig) error {
	raw, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("encode desktop config: %w", err)
	}
	return shared.WriteConfigFile(s.path, append(raw, '\n'))
}
