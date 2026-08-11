package gateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
	shared "github.com/swm8023/wheelmaker/internal/shared"
)

type ConfigBundle struct {
	Global       GlobalConfig
	Sites        []SiteConfig
	JSON         []byte
	Source       []byte
	Warnings     []caddyconfig.Warning
	Dependencies []string
	Fingerprint  string
}

func LoadBundle(home string) (ConfigBundle, error) {
	if !filepath.IsAbs(home) {
		return ConfigBundle{}, fmt.Errorf("gateway home must be an absolute path")
	}
	paths := ResolvePaths(home)
	inputFingerprint := semanticFingerprint(paths)
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
	candidate, err := compileCaddyfileCandidate(global, sites, paths.DataDir, paths.CustomSitesRoot)
	if err != nil {
		return ConfigBundle{}, err
	}
	if currentFingerprint := semanticFingerprint(paths); currentFingerprint != inputFingerprint {
		return ConfigBundle{}, fmt.Errorf("Gateway configuration sources changed while the candidate was being built")
	}
	return ConfigBundle{
		Global:       global,
		Sites:        sites,
		JSON:         candidate.JSON,
		Source:       candidate.Source,
		Warnings:     candidate.Warnings,
		Dependencies: candidate.Dependencies,
		Fingerprint:  inputFingerprint,
	}, nil
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

var (
	managedRuntimeStart        = startCaddy
	managedRuntimeReload       = Reload
	managedRuntimeStop         = caddy.Stop
	managedRuntimeStage        = stageGenerated
	managedRuntimePromote      = promoteGenerated
	managedRuntimePollInterval = time.Second
)

// RunManaged starts Caddy with a valid candidate and promotes generated JSON
// only after the runtime accepts it. Later source changes follow the same
// load-before-promote rule; rejected candidates leave the prior runtime and
// generated artifact active.
func RunManaged(ctx context.Context, home string, initial ConfigBundle) error {
	if err := ValidateJSON(initial.JSON); err != nil {
		return err
	}
	paths := ResolvePaths(home)
	if initial.Fingerprint == "" {
		initial.Fingerprint = semanticFingerprint(paths)
	}
	if current := semanticFingerprint(paths); current != initial.Fingerprint {
		return fmt.Errorf("Gateway configuration sources changed before runtime start")
	}
	staged, err := managedRuntimeStage(paths.GeneratedConfig, initial.JSON)
	if err != nil {
		return err
	}
	if err := managedRuntimeStart(initial.JSON); err != nil {
		_ = os.Remove(staged)
		return err
	}
	if err := managedRuntimePromote(staged, paths.GeneratedConfig); err != nil {
		_ = os.Remove(staged)
		_ = managedRuntimeStop()
		return fmt.Errorf("promote initial generated Caddy config: %w", err)
	}
	defer func() {
		if err := managedRuntimeStop(); err != nil {
			log.Printf("stop embedded Caddy: %v", err)
		}
	}()

	acceptedJSON := append([]byte(nil), initial.JSON...)
	acceptedFingerprint := initial.Fingerprint
	ticker := time.NewTicker(managedRuntimePollInterval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			observedFingerprint := semanticFingerprint(paths)
			if observedFingerprint == acceptedFingerprint {
				continue
			}
			bundle, err := LoadBundle(home)
			if err != nil {
				log.Printf("gateway config change rejected: %v", err)
				continue
			}
			if bundle.Fingerprint != observedFingerprint {
				log.Printf("gateway config change deferred because sources changed during compilation")
				continue
			}
			for _, warning := range bundle.Warnings {
				log.Printf("gateway config warning: %s", warning.String())
			}
			staged, err := managedRuntimeStage(paths.GeneratedConfig, bundle.JSON)
			if err != nil {
				log.Printf("gateway generated config staging failed: %v", err)
				continue
			}
			if err := managedRuntimeReload(bundle.JSON); err != nil {
				_ = os.Remove(staged)
				log.Printf("gateway config reload failed: %v", err)
				continue
			}
			if err := managedRuntimePromote(staged, paths.GeneratedConfig); err != nil {
				_ = os.Remove(staged)
				rollbackErr := managedRuntimeReload(acceptedJSON)
				if rollbackErr != nil {
					return fmt.Errorf("promote generated Caddy config: %w; rollback runtime: %v", err, rollbackErr)
				}
				log.Printf("gateway generated config promotion failed; runtime rolled back: %v", err)
				continue
			}
			acceptedJSON = append(acceptedJSON[:0], bundle.JSON...)
			acceptedFingerprint = observedFingerprint
		}
	}
}

func startCaddy(configJSON []byte) error {
	var cfg caddy.Config
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return fmt.Errorf("decode generated Caddy config: %w", err)
	}
	if err := caddy.Run(&cfg); err != nil {
		return fmt.Errorf("start embedded Caddy: %w", err)
	}
	return nil
}

func semanticFingerprint(paths Paths) string {
	hash := sha256.New()
	fingerprintFile(hash, "gateway-config", paths.ConfigFile)
	fingerprintFile(hash, "hub-config", paths.HubConfigFile)
	fingerprintTree(hash, paths.CustomSitesRoot)
	return fmt.Sprintf("%x", hash.Sum(nil))
}

func fingerprintFile(hash io.Writer, label, path string) {
	_, _ = io.WriteString(hash, label+"\x00"+filepath.ToSlash(path)+"\x00")
	contents, err := os.ReadFile(path)
	if err != nil {
		_, _ = io.WriteString(hash, "error:"+err.Error()+"\x00")
		return
	}
	_, _ = hash.Write(contents)
	_, _ = io.WriteString(hash, "\x00")
}

func fingerprintTree(hash io.Writer, root string) {
	type treeFile struct {
		relative string
		path     string
	}
	files := make([]treeFile, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, treeFile{relative: filepath.ToSlash(relative), path: path})
		return nil
	})
	if err != nil {
		_, _ = io.WriteString(hash, "sites-error:"+err.Error()+"\x00")
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].relative < files[j].relative })
	for _, file := range files {
		fingerprintFile(hash, "site:"+file.relative, file.path)
	}
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
	staged, err := stageGenerated(path, configJSON)
	if err != nil {
		return err
	}
	defer os.Remove(staged)
	return promoteGenerated(staged, path)
}

func stageGenerated(path string, configJSON []byte) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create generated config directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".caddy-*.json")
	if err != nil {
		return "", fmt.Errorf("create generated config temporary file: %w", err)
	}
	temporaryName := temporary.Name()
	failed := true
	defer func() {
		if failed {
			_ = os.Remove(temporaryName)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("secure generated config temporary file: %w", err)
	}
	if _, err := temporary.Write(configJSON); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("write generated config temporary file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return "", fmt.Errorf("flush generated config temporary file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close generated config temporary file: %w", err)
	}
	failed = false
	return temporaryName, nil
}

func promoteGenerated(staged, path string) error {
	if err := os.Rename(staged, path); err != nil {
		return fmt.Errorf("replace generated config: %w", err)
	}
	return nil
}
