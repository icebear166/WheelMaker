package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
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
	sites, err := loadSiteFiles(paths)
	if err != nil {
		return ConfigBundle{}, err
	}
	compiled, err := CompileConfigAt(global, sites, paths.DataDir)
	if err != nil {
		return ConfigBundle{}, err
	}
	return ConfigBundle{Global: global, Sites: sites, JSON: compiled}, nil
}

func loadGlobalFile(path string) (GlobalConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: DefaultLogLevel}}, nil
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
	return global, nil
}

func loadSiteFiles(paths Paths) ([]SiteConfig, error) {
	sites := make([]SiteConfig, 0, 3)
	for _, path := range []string{paths.WorkspaceSiteFile, paths.ReleaseServerSiteFile} {
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read site config %s: %w", path, err)
		}
		site, err := LoadSite(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("site config %s: %w", path, err)
		}
		if err := ValidateSite(site); err != nil {
			return nil, fmt.Errorf("site config %s: %w", path, err)
		}
		if site.Kind == SiteShare {
			return nil, fmt.Errorf("site config %s: share sites are derived from the main config", path)
		}
		sites = append(sites, site)
	}
	if share, ok := loadShareSite(paths, sites); ok {
		sites = append(sites, share)
	}
	return sites, nil
}

type appShareConfig struct {
	Share struct {
		PublicURL string `json:"publicUrl"`
	} `json:"share"`
}

func loadShareSite(paths Paths, existing []SiteConfig) (SiteConfig, bool) {
	data, err := os.ReadFile(paths.AppConfigFile)
	if err != nil {
		return SiteConfig{}, false
	}
	var config appShareConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return SiteConfig{}, false
	}
	publicURL, err := normalizeShareSiteURL(config.Share.PublicURL)
	if err != nil || publicURL == "" {
		return SiteConfig{}, false
	}
	shareSite := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteShare,
		PublicURL: publicURL,
		WebRoot:   paths.SharePublicRoot,
	}
	for _, site := range existing {
		if strings.EqualFold(site.Host(), shareSite.Host()) {
			return SiteConfig{}, false
		}
	}
	if err := ValidateSite(shareSite); err != nil {
		return SiteConfig{}, false
	}
	return shareSite, true
}

func normalizeShareSiteURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if strings.ContainsAny(raw, "\r\n\t?#") {
		return "", fmt.Errorf("share publicUrl contains invalid characters")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.Opaque != "" || parsed.User != nil || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.ForceQuery || (parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" {
		return "", fmt.Errorf("share publicUrl must contain only scheme, host, optional port, and / path")
	}
	return strings.TrimSuffix(scheme+"://"+parsed.Host, "/"), nil
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
// semantic Gateway files. A valid change is compiled, written atomically, and
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
	parts := make([]string, 0, 4)
	for _, path := range []string{paths.ConfigFile, paths.WorkspaceSiteFile, paths.ReleaseServerSiteFile, paths.AppConfigFile} {
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
