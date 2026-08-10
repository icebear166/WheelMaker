package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
	shared "github.com/swm8023/wheelmaker/internal/shared"
)

type ConfigBundle struct {
	Global GlobalConfig
	Sites  []SiteConfig
	JSON   []byte
}

func LoadBundle(home string) (ConfigBundle, error) {
	if !filepath.IsAbs(home) {
		return ConfigBundle{}, fmt.Errorf("gateway home must be an absolute path")
	}
	paths := ResolvePaths(home)
	global, err := loadGlobalFile(paths.ConfigFile)
	if err != nil {
		return ConfigBundle{}, err
	}
	hub, err := loadHubConfig(paths.HubConfigFile)
	if err != nil {
		log.Printf("shared Hub config rejected; disabling Hub-derived Gateway routes: %v", err)
	} else {
		global = mergeHubConfig(global, hub)
	}
	if err := ValidateGlobal(global); err != nil {
		return ConfigBundle{}, fmt.Errorf("merged Gateway config: %w", err)
	}
	sites := sitesFromGlobal(global, paths)
	compiled, err := CompileConfigAt(global, sites, paths.DataDir)
	if err != nil {
		return ConfigBundle{}, err
	}
	return ConfigBundle{Global: global, Sites: sites, JSON: compiled}, nil
}

func loadGlobalFile(path string) (GlobalConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return DefaultGlobalConfig(filepath.Dir(path)), nil
	}
	if err != nil {
		return GlobalConfig{}, fmt.Errorf("read global config %s: %w", path, err)
	}
	global, err := LoadGlobal(bytes.NewReader(data))
	if err != nil {
		return GlobalConfig{}, fmt.Errorf("global config %s: %w", path, err)
	}
	if err := ValidateGlobal(global); err != nil {
		return GlobalConfig{}, fmt.Errorf("global config %s: %w", path, err)
	}
	global = applyGlobalDefaults(global, filepath.Dir(path))
	return global, nil
}

func loadHubConfig(path string) (*shared.AppConfig, error) {
	_, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Hub config %s: %w", path, err)
	}
	config, err := shared.LoadConfig(path)
	if err != nil {
		return nil, err
	}
	return config, nil
}

func mergeHubConfig(global GlobalConfig, hub *shared.AppConfig) GlobalConfig {
	if hub == nil {
		return global
	}

	global.WMSites.Registry.PublicURL = ""
	global.WMSites.Share.PublicURL = ""
	if hub.Registry.Listen && strings.TrimSpace(hub.PublicURL) != "" {
		publicURL := strings.TrimSpace(hub.PublicURL)
		if err := validateOptionalPublicURL(publicURL, "Hub publicUrl"); err != nil {
			log.Printf("Hub publicUrl rejected; disabling Gateway Registry route: %v", err)
		} else {
			global.WMSites.Registry.PublicURL = publicURL
		}
	}

	shareURL := strings.TrimSpace(hub.Registry.Share.PublicURL)
	if shareURL != "" {
		if err := validateOptionalPublicURL(shareURL, "Hub registry.share.publicUrl"); err != nil {
			log.Printf("Hub Share publicUrl rejected; disabling Gateway Share route: %v", err)
		} else {
			global.WMSites.Share.PublicURL = shareURL
		}
	}

	if err := validateRelayPort(hub.Registry.RelayPort); err != nil {
		log.Printf("Hub Relay port rejected; disabling Gateway Relay listener: %v", err)
		global.Relay.ListenPort = 0
	} else {
		global.Relay.ListenPort = hub.Registry.RelayPort
	}

	level := strings.TrimSpace(hub.Log.Level)
	if level == "" {
		level = DefaultLogLevel
	}
	switch strings.ToUpper(level) {
	case "DEBUG", "INFO", "WARN", "ERROR":
		global.Log.Level = level
	default:
		log.Printf("Hub log level rejected; using Gateway default %q", DefaultLogLevel)
		global.Log.Level = DefaultLogLevel
	}
	return global
}

func applyGlobalDefaults(global GlobalConfig, home string) GlobalConfig {
	defaults := DefaultGlobalConfig(home)
	if global.Schema == 0 {
		global.Schema = defaults.Schema
	}
	if global.Log.Level == "" {
		global.Log.Level = defaults.Log.Level
	}
	if global.WMSites.Registry.URLMode == "" {
		global.WMSites.Registry.URLMode = defaults.WMSites.Registry.URLMode
	}
	if global.WMSites.Share.URLMode == "" {
		global.WMSites.Share.URLMode = defaults.WMSites.Share.URLMode
	}
	if global.WMSites.Release.Listen == "" {
		global.WMSites.Release.Listen = defaults.WMSites.Release.Listen
	}
	if global.WMSites.Release.DataRoot == "" {
		global.WMSites.Release.DataRoot = defaults.WMSites.Release.DataRoot
	}
	return global
}

func sitesFromGlobal(global GlobalConfig, paths Paths) []SiteConfig {
	sites := make([]SiteConfig, 0, 3)
	if strings.TrimSpace(global.WMSites.Registry.PublicURL) != "" {
		sites = append(sites, SiteConfig{
			Schema:    SiteSchemaVersion,
			Kind:      SiteRegistry,
			PublicURL: global.WMSites.Registry.PublicURL,
			WebRoot:   paths.RegistryWebRoot,
			Upstream:  DefaultRegistryUpstream,
			TLS:       global.WMSites.TLS,
		})
	}
	if strings.TrimSpace(global.WMSites.Release.PublicURL) != "" {
		sites = append(sites, SiteConfig{
			Schema:    SiteSchemaVersion,
			Kind:      SiteRelease,
			PublicURL: global.WMSites.Release.PublicURL,
			Upstream:  "http://" + global.WMSites.Release.Listen,
			TLS:       global.WMSites.TLS,
		})
	}
	if strings.TrimSpace(global.WMSites.Share.PublicURL) != "" {
		sites = append(sites, SiteConfig{
			Schema:    SiteSchemaVersion,
			Kind:      SiteShare,
			PublicURL: global.WMSites.Share.PublicURL,
			WebRoot:   paths.SharePublicRoot,
			TLS:       global.WMSites.TLS,
		})
	}
	return sites
}

func ValidateJSON(configJSON []byte) error {
	var cfg caddy.Config
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("decode generated Caddy config: %w", err)
	}
	if err := caddy.Validate(&cfg); err != nil {
		return fmt.Errorf("validate generated Caddy config: %w", err)
	}
	return nil
}

// RunManaged starts Caddy with a valid generated configuration and watches the
// Gateway and parent Hub config files. A valid change is compiled, written atomically, and
// hot-loaded; an invalid change is ignored so the last valid configuration
// keeps serving. The polling interval intentionally avoids a filesystem
// watcher dependency on Windows, Linux, and macOS.
func RunManaged(ctx context.Context, home string, configJSON []byte) error {
	if err := ValidateJSON(configJSON); err != nil {
		return err
	}
	var cfg caddy.Config
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("decode generated Caddy config: %w", err)
	}
	if err := caddy.Run(&cfg); err != nil {
		return fmt.Errorf("start embedded Caddy: %w", err)
	}
	paths := ResolvePaths(home)
	lastFingerprint := semanticFingerprint(paths)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	defer caddy.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			fingerprint := semanticFingerprint(paths)
			if fingerprint == lastFingerprint {
				continue
			}
			bundle, err := LoadBundle(home)
			if err != nil {
				// Keep serving the previous valid config. The next poll retries
				// after the deployer finishes its atomic file write.
				log.Printf("gateway config change rejected: %v", err)
				continue
			}
			if err := WriteGenerated(paths.GeneratedConfig, bundle.JSON); err != nil {
				log.Printf("gateway generated config write failed: %v", err)
				continue
			}
			if err := Reload(bundle.JSON); err != nil {
				log.Printf("gateway config reload failed: %v", err)
				continue
			}
			lastFingerprint = fingerprint
		}
	}
}

func semanticFingerprint(paths Paths) string {
	parts := make([]string, 0, 1)
	for _, path := range []string{paths.ConfigFile, paths.HubConfigFile} {
		info, err := os.Stat(path)
		if err != nil {
			parts = append(parts, path+":missing")
			continue
		}
		parts = append(parts, fmt.Sprintf("%s:%d:%d", path, info.ModTime().UnixNano(), info.Size()))
	}
	sort.Strings(parts)
	return strings.Join(parts, "|")
}

func Reload(configJSON []byte) error {
	if err := ValidateJSON(configJSON); err != nil {
		return err
	}
	if err := caddy.Load(configJSON, true); err != nil {
		return fmt.Errorf("reload embedded Caddy: %w", err)
	}
	return nil
}

func WriteGenerated(path string, configJSON []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create generated config directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".caddy-*.json")
	if err != nil {
		return fmt.Errorf("create generated config temporary file: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure generated config temporary file: %w", err)
	}
	if _, err := temporary.Write(configJSON); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write generated config temporary file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("flush generated config temporary file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close generated config temporary file: %w", err)
	}
	if err := os.Rename(temporaryName, path); err != nil {
		return fmt.Errorf("replace generated config: %w", err)
	}
	return nil
}
