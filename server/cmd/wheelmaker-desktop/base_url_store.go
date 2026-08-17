package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type desktopConnectionMode string

const (
	desktopConnectionGateway   desktopConnectionMode = "gateway"
	desktopConnectionLocalhost desktopConnectionMode = "localhost"
)

type desktopPreviewWindowBounds struct {
	Left   int32 `json:"left"`
	Top    int32 `json:"top"`
	Width  int32 `json:"width"`
	Height int32 `json:"height"`
}

type desktopConfig struct {
	ConnectionMode      desktopConnectionMode       `json:"connectionMode,omitempty"`
	BaseURL             string                      `json:"baseUrl,omitempty"`
	PreviewWindowBounds *desktopPreviewWindowBounds `json:"previewWindowBounds,omitempty"`
}

func normalizeDesktopConfig(config desktopConfig) (desktopConfig, bool, error) {
	switch config.ConnectionMode {
	case "":
		if config.BaseURL == "" {
			return desktopConfig{}, false, nil
		}
		normalized, err := normalizeDesktopBaseURL(config.BaseURL)
		if err != nil {
			return desktopConfig{}, false, fmt.Errorf("invalid legacy Gateway base URL: %w", err)
		}
		return desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: normalized, PreviewWindowBounds: config.PreviewWindowBounds}, true, nil
	case desktopConnectionGateway:
		if config.BaseURL == "" {
			return desktopConfig{}, false, errors.New("Gateway connection requires a base URL")
		}
		normalized, err := normalizeDesktopBaseURL(config.BaseURL)
		if err != nil {
			return desktopConfig{}, false, fmt.Errorf("invalid Gateway base URL: %w", err)
		}
		result := desktopConfig{ConnectionMode: desktopConnectionGateway, BaseURL: normalized, PreviewWindowBounds: config.PreviewWindowBounds}
		return result, result != config, nil
	case desktopConnectionLocalhost:
		if config.BaseURL != "" {
			return desktopConfig{}, false, errors.New("Localhost connection must not define a base URL")
		}
		return config, false, nil
	default:
		return desktopConfig{}, false, fmt.Errorf("unsupported Desktop connection mode %q", config.ConnectionMode)
	}
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
	normalized, _, err := normalizeDesktopConfig(config)
	if err != nil {
		return err
	}
	config = normalized
	raw, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("encode desktop config: %w", err)
	}
	return shared.WriteConfigFile(s.path, append(raw, '\n'))
}
