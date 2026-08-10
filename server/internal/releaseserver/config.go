package releaseserver

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const configSchema = 1
const releaseServerListenAddress = "127.0.0.1:9680"

type Config struct {
	Schema      int    `json:"schema"`
	Listen      string `json:"listen"`
	PublicURL   string `json:"publicUrl"`
	DataRoot    string `json:"dataRoot"`
	TokenSHA256 string `json:"tokenSha256"`
}

type gatewayTLSConfig struct {
	CertificateFile string `json:"certificateFile"`
	KeyFile         string `json:"keyFile"`
}

type gatewayReleaseConfig struct {
	PublicURL   string           `json:"publicUrl"`
	Listen      string           `json:"listen"`
	DataRoot    string           `json:"dataRoot"`
	TokenSHA256 string           `json:"tokenSha256"`
	TLS         gatewayTLSConfig `json:"tls"`
}

func (c Config) Validate() error {
	return c.validate(true)
}

func (c Config) validate(requirePublicURL bool) error {
	if c.Schema != configSchema {
		return fmt.Errorf("schema must be %d", configSchema)
	}
	if c.Listen != releaseServerListenAddress {
		return fmt.Errorf("listen must be %s", releaseServerListenAddress)
	}
	if requirePublicURL && c.PublicURL == "" {
		return errors.New("publicUrl: must be an HTTP(S) origin")
	}
	if c.PublicURL != "" {
		if _, err := normalizePublicURL(c.PublicURL); err != nil {
			return fmt.Errorf("publicUrl: %w", err)
		}
	}
	if c.DataRoot == "" {
		return errors.New("dataRoot must be absolute")
	}
	if !filepath.IsAbs(c.DataRoot) {
		return errors.New("dataRoot must be absolute")
	}
	if c.TokenSHA256 != "" && !validLowerHex(c.TokenSHA256, 32) {
		return errors.New("tokenSha256 must be a 64-character lowercase SHA-256 digest")
	}
	return nil
}

func validateConfigForUpdate(c Config) error {
	if c.Listen == "" {
		c.Listen = releaseServerListenAddress
	}
	if c.PublicURL != "" {
		if _, err := normalizePublicURL(c.PublicURL); err != nil {
			return fmt.Errorf("publicUrl: %w", err)
		}
	}
	return c.validate(false)
}

func LoadConfig(path string) (Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("open release server config: %w", err)
	}
	var cfg Config
	if hasGatewayReleaseSection(raw) {
		cfg, err = decodeGatewayRelease(raw)
	} else {
		cfg, err = decodeLegacyConfig(raw)
	}
	if err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("validate release server config: %w", err)
	}
	return cfg, nil
}

func decodeConfig(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("open release server config: %w", err)
	}
	return decodeLegacyConfig(data)
}

func decodeLegacyConfig(data []byte) (Config, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var cfg Config
	if err := decoder.Decode(&cfg); err != nil {
		return Config{}, fmt.Errorf("decode release server config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return Config{}, errors.New("decode release server config: multiple JSON values")
		}
		return Config{}, fmt.Errorf("decode release server config: %w", err)
	}
	return cfg, nil
}

func hasGatewayReleaseSection(data []byte) bool {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return false
	}
	_, ok := document["release"]
	return ok
}

func looksLikeGatewayConfig(data []byte) bool {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return false
	}
	for _, key := range []string{"acme", "log", "relay", "registry", "share"} {
		if _, ok := document[key]; ok {
			return true
		}
	}
	return false
}

func ensureGatewayReleaseSection(path, dataRoot string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if hasGatewayReleaseSection(data) {
		return nil
	}
	if dataRoot == "" {
		dataRoot = filepath.Join(filepath.Dir(filepath.Dir(path)), "release-server", "data")
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return fmt.Errorf("decode Gateway config: %w", err)
	}
	releaseRaw, err := json.Marshal(gatewayReleaseConfig{
		Listen:   releaseServerListenAddress,
		DataRoot: dataRoot,
	})
	if err != nil {
		return fmt.Errorf("encode Gateway release config: %w", err)
	}
	document["release"] = releaseRaw
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Gateway config: %w", err)
	}
	return atomicWrite(path, append(encoded, '\n'), 0o600, ".gateway-release-config-*.tmp")
}

func decodeGatewayRelease(data []byte) (Config, error) {
	cfg, err := decodeGatewayReleaseForUpdate(data)
	if err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func decodeGatewayReleaseForUpdate(data []byte) (Config, error) {
	var document map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&document); err != nil {
		return Config{}, fmt.Errorf("decode Gateway config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return Config{}, errors.New("decode Gateway config: multiple JSON values")
		}
		return Config{}, fmt.Errorf("decode Gateway config: %w", err)
	}
	releaseRaw, ok := document["release"]
	if !ok {
		return Config{}, errors.New("decode Gateway config: release section is required")
	}
	releaseDecoder := json.NewDecoder(bytes.NewReader(releaseRaw))
	releaseDecoder.DisallowUnknownFields()
	var release gatewayReleaseConfig
	if err := releaseDecoder.Decode(&release); err != nil {
		return Config{}, fmt.Errorf("decode Gateway release config: %w", err)
	}
	if err := releaseDecoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return Config{}, errors.New("decode Gateway release config: multiple JSON values")
		}
		return Config{}, fmt.Errorf("decode Gateway release config: %w", err)
	}
	return Config{
		Schema:      configSchema,
		Listen:      release.Listen,
		PublicURL:   release.PublicURL,
		DataRoot:    release.DataRoot,
		TokenSHA256: release.TokenSHA256,
	}, nil
}

func WriteConfig(path string, cfg Config) (retErr error) {
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("validate release server config: %w", err)
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode release server config: %w", err)
	}
	raw = append(raw, '\n')
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".release-server-config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary release server config: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o640); err != nil {
		return fmt.Errorf("set release server config mode: %w", err)
	}
	if _, err := temporary.Write(raw); err != nil {
		return fmt.Errorf("write release server config: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync release server config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close release server config: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace release server config: %w", err)
	}
	return nil
}

func writeGatewayReleaseConfig(path string, cfg Config) (retErr error) {
	if cfg.Listen == "" {
		cfg.Listen = releaseServerListenAddress
	}
	if err := validateConfigForUpdate(cfg); err != nil {
		return fmt.Errorf("validate Gateway release config: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read Gateway config: %w", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return fmt.Errorf("decode Gateway config: %w", err)
	}
	var existing gatewayReleaseConfig
	if raw, ok := document["release"]; ok {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&existing); err != nil {
			return fmt.Errorf("decode Gateway release config: %w", err)
		}
	}
	release := gatewayReleaseConfig{
		PublicURL:   cfg.PublicURL,
		Listen:      cfg.Listen,
		DataRoot:    cfg.DataRoot,
		TokenSHA256: cfg.TokenSHA256,
		TLS:         existing.TLS,
	}
	releaseRaw, err := json.Marshal(release)
	if err != nil {
		return fmt.Errorf("encode Gateway release config: %w", err)
	}
	document["release"] = releaseRaw
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Gateway config: %w", err)
	}
	encoded = append(encoded, '\n')
	return atomicWrite(path, encoded, 0o600, ".gateway-release-config-*.tmp")
}

func atomicWrite(path string, data []byte, mode os.FileMode, pattern string) (retErr error) {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return fmt.Errorf("set temporary config mode: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary config: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary config: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}

func ConfigureTokenHash(path string, digest string) error {
	if !validLowerHex(digest, 32) {
		return errors.New("publisher token hash must be a 64-character lowercase SHA-256 digest")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if hasGatewayReleaseSection(data) || looksLikeGatewayConfig(data) {
		if !hasGatewayReleaseSection(data) {
			if err := ensureGatewayReleaseSection(path, ""); err != nil {
				return err
			}
			data, err = os.ReadFile(path)
			if err != nil {
				return err
			}
		}
		cfg, err := decodeGatewayReleaseForUpdate(data)
		if err != nil {
			return err
		}
		cfg.TokenSHA256 = digest
		return writeGatewayReleaseConfig(path, cfg)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		return err
	}
	cfg.TokenSHA256 = digest
	return WriteConfig(path, cfg)
}

func ConfigurePublicURL(path string, value string) error {
	return ConfigurePublicURLWithDataRoot(path, value, "")
}

func ConfigurePublicURLWithDataRoot(path string, value, dataRoot string) error {
	normalized, err := normalizePublicURL(value)
	if err != nil {
		return fmt.Errorf("public URL: %w", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if hasGatewayReleaseSection(raw) || looksLikeGatewayConfig(raw) {
		if !hasGatewayReleaseSection(raw) {
			if err := ensureGatewayReleaseSection(path, dataRoot); err != nil {
				return err
			}
			raw, err = os.ReadFile(path)
			if err != nil {
				return err
			}
		}
		cfg, err := decodeGatewayReleaseForUpdate(raw)
		if err != nil {
			return err
		}
		cfg.PublicURL = normalized
		if dataRoot != "" {
			cfg.DataRoot = dataRoot
		}
		return writeGatewayReleaseConfig(path, cfg)
	}
	cfg, err := decodeLegacyConfig(raw)
	if err != nil {
		return err
	}
	cfg.PublicURL = normalized
	return WriteConfig(path, cfg)
}

func MigrateLegacyConfig(legacyPath, gatewayPath, dataRoot string) error {
	legacyRaw, err := os.ReadFile(legacyPath)
	if err != nil {
		return fmt.Errorf("read legacy release server config: %w", err)
	}
	legacy, err := decodeLegacyConfig(legacyRaw)
	if err != nil {
		return err
	}
	if legacy.Listen == "" {
		legacy.Listen = releaseServerListenAddress
	}
	if dataRoot != "" {
		legacy.DataRoot = dataRoot
	}
	if err := validateConfigForUpdate(legacy); err != nil {
		return fmt.Errorf("validate legacy release server config: %w", err)
	}
	if _, err := os.Stat(gatewayPath); err == nil {
		if !hasGatewayReleaseSectionFromPath(gatewayPath) {
			if err := ensureGatewayReleaseSection(gatewayPath, legacy.DataRoot); err != nil {
				return err
			}
		}
		return writeGatewayReleaseConfig(gatewayPath, legacy)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat Gateway config: %w", err)
	}
	document := map[string]any{
		"schema": 1,
		"acme":   map[string]string{"email": ""},
		"log":    map[string]string{"level": "info"},
		"relay":  map[string]int{"listenPort": 0},
		"registry": map[string]any{
			"publicUrl": "",
			"tls":       map[string]string{"certificateFile": "", "keyFile": ""},
		},
		"release": gatewayReleaseConfig{
			PublicURL:   legacy.PublicURL,
			Listen:      legacy.Listen,
			DataRoot:    legacy.DataRoot,
			TokenSHA256: legacy.TokenSHA256,
		},
		"share": map[string]any{
			"publicUrl": "",
			"tls":       map[string]string{"certificateFile": "", "keyFile": ""},
		},
	}
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Gateway config: %w", err)
	}
	return atomicWrite(gatewayPath, append(encoded, '\n'), 0o600, ".gateway-release-config-*.tmp")
}

func hasGatewayReleaseSectionFromPath(path string) bool {
	data, err := os.ReadFile(path)
	return err == nil && hasGatewayReleaseSection(data)
}

func normalizePublicURL(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil {
		return "", errors.New("must be a valid URL")
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", errors.New("must be an HTTP(S) origin")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("must contain only scheme, host, and optional port")
	}
	return strings.TrimSuffix(parsed.Scheme+"://"+parsed.Host, "/"), nil
}

func validLowerHex(value string, byteLength int) bool {
	if len(value) != byteLength*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != byteLength {
		return false
	}
	return hex.EncodeToString(decoded) == value
}
