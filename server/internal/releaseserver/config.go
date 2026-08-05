package releaseserver

import (
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

func (c Config) Validate() error {
	if c.Schema != configSchema {
		return fmt.Errorf("schema must be %d", configSchema)
	}
	if c.Listen != releaseServerListenAddress {
		return fmt.Errorf("listen must be %s", releaseServerListenAddress)
	}
	if _, err := normalizePublicURL(c.PublicURL); err != nil {
		return fmt.Errorf("publicUrl: %w", err)
	}
	if !filepath.IsAbs(c.DataRoot) {
		return errors.New("dataRoot must be absolute")
	}
	if c.TokenSHA256 != "" && !validLowerHex(c.TokenSHA256, 32) {
		return errors.New("tokenSha256 must be a 64-character lowercase SHA-256 digest")
	}
	return nil
}

func LoadConfig(path string) (Config, error) {
	cfg, err := decodeConfig(path)
	if err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("validate release server config: %w", err)
	}
	return cfg, nil
}

func decodeConfig(path string) (Config, error) {
	file, err := os.Open(path)
	if err != nil {
		return Config{}, fmt.Errorf("open release server config: %w", err)
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
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

func ConfigureTokenHash(path string, digest string) error {
	if !validLowerHex(digest, 32) {
		return errors.New("publisher token hash must be a 64-character lowercase SHA-256 digest")
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		return err
	}
	cfg.TokenSHA256 = digest
	return WriteConfig(path, cfg)
}

func ConfigurePublicURL(path string, value string) error {
	normalized, err := normalizePublicURL(value)
	if err != nil {
		return fmt.Errorf("public URL: %w", err)
	}
	cfg, err := decodeConfig(path)
	if err != nil {
		return err
	}
	cfg.PublicURL = normalized
	return WriteConfig(path, cfg)
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
