package shared

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

// AppConfig is the top-level config.json structure.
type AppConfig struct {
	PublicURL string          `json:"publicUrl,omitempty"`
	Projects  []ProjectConfig `json:"projects"`
	Registry  RegistryConfig  `json:"registry,omitempty"`
	Log       LogConfig       `json:"log,omitempty"`
}

type appConfigInput struct {
	PublicURL         string          `json:"publicUrl,omitempty"`
	Projects          []ProjectConfig `json:"projects"`
	Registry          RegistryConfig  `json:"registry,omitempty"`
	Log               LogConfig       `json:"log,omitempty"`
	DeprecatedAPIKeys json.RawMessage `json:"api_keys,omitempty"`
}

type rawAppConfig struct {
	Version  json.RawMessage    `json:"version,omitempty"`
	Projects []rawProjectConfig `json:"projects"`
}

type rawProjectConfig struct {
	Debug          json.RawMessage `json:"debug,omitempty"`
	LegacyIM       json.RawMessage `json:"im,omitempty"`
	Client         json.RawMessage `json:"client,omitempty"`
	LegacyIMFilter json.RawMessage `json:"imFilter,omitempty"`
}

type rawLegacyIMConfig struct {
	Version json.RawMessage `json:"version,omitempty"`
}

// LogConfig controls the operational log system.
type LogConfig struct {
	// Level is the minimum log level to emit: "debug", "verbose", "info", "warn" (default), "error".
	Level string `json:"level,omitempty"`
}

// ProjectConfig describes one WheelMaker project.
type ProjectConfig struct {
	Name   string        `json:"name"`
	Path   string        `json:"path"`
	Feishu *FeishuConfig `json:"feishu,omitempty"`
}

// FeishuConfig is accepted only for parse-only legacy config compatibility.
type FeishuConfig struct {
	AppID     string `json:"app_id,omitempty"`
	AppSecret string `json:"app_secret,omitempty"`
}

type rawFeishuConfig struct {
	AppIDLegacy     string `json:"appID,omitempty"`
	AppSecretLegacy string `json:"appSecret,omitempty"`
	AppIDSnake      string `json:"app_id,omitempty"`
	AppSecretSnake  string `json:"app_secret,omitempty"`
	AppSecretTypo   string `json:"app_secrect,omitempty"`
}

func (c *FeishuConfig) UnmarshalJSON(data []byte) error {
	var raw rawFeishuConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	c.AppID = firstNonEmpty(raw.AppIDSnake, raw.AppIDLegacy)
	c.AppSecret = firstNonEmpty(raw.AppSecretSnake, raw.AppSecretTypo, raw.AppSecretLegacy)
	return nil
}

// RegistryConfig configures registry sync.
type RegistryConfig struct {
	Port   int    `json:"port,omitempty"`
	Listen bool   `json:"listen,omitempty"`
	Server string `json:"server,omitempty"`
	Token  string `json:"token,omitempty"`
	HubID  string `json:"hubId,omitempty"`
}

// LoadConfig reads and parses the config file at path.
func LoadConfig(path string) (*AppConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("config file not found at %s", path)
		}
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	if err := validateRemovedLegacyFields(path, data); err != nil {
		return nil, err
	}

	var input appConfigInput
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	if len(input.DeprecatedAPIKeys) != 0 {
		Warn("config api_keys is deprecated and ignored; configure Hub API keys in Hub settings")
	}
	return &AppConfig{
		PublicURL: input.PublicURL,
		Projects:  input.Projects,
		Registry:  input.Registry,
		Log:       input.Log,
	}, nil
}

func validateRemovedLegacyFields(path string, data []byte) error {
	var raw rawAppConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		// Let strict decode in LoadConfig return the canonical parse error.
		return nil
	}

	if len(raw.Version) != 0 {
		return fmt.Errorf("parse config %s: im.version has been removed; configure App sessions through registry settings", path)
	}
	for _, project := range raw.Projects {
		if len(project.Debug) != 0 {
			return fmt.Errorf("parse config %s: projects[].debug has been removed", path)
		}
		if len(project.LegacyIM) != 0 {
			var legacyIM rawLegacyIMConfig
			if err := json.Unmarshal(project.LegacyIM, &legacyIM); err == nil && len(legacyIM.Version) != 0 {
				return fmt.Errorf("parse config %s: projects[].im.version has been removed; configure App sessions through registry settings", path)
			}
			return fmt.Errorf("parse config %s: projects[].im has been removed; configure App sessions through registry settings", path)
		}
		if len(project.Client) != 0 {
			return fmt.Errorf("parse config %s: projects[].client has been removed; provider is auto-detected", path)
		}
		if len(project.LegacyIMFilter) != 0 {
			return fmt.Errorf("parse config %s: projects[].imFilter has been removed", path)
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
