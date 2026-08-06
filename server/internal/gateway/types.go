package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	GlobalSchemaVersion = 1
	SiteSchemaVersion   = 1
	DefaultLogLevel     = "INFO"

	SiteWorkspace     SiteKind = "workspace"
	SiteReleaseServer SiteKind = "release-server"
)

type SiteKind string

type GlobalConfig struct {
	Schema int         `json:"schema"`
	ACME   ACMEConfig  `json:"acme"`
	Log    LogConfig   `json:"log"`
	Relay  RelayConfig `json:"relay,omitempty"`
}

type RelayConfig struct {
	ListenPort int `json:"listenPort,omitempty"`
}

type ACMEConfig struct {
	Email string `json:"email"`
}

type LogConfig struct {
	Level string `json:"level"`
}

type TLSConfig struct {
	CertificateFile string `json:"certificateFile"`
	KeyFile         string `json:"keyFile"`
}

type SiteConfig struct {
	Schema    int       `json:"schema"`
	Kind      SiteKind  `json:"kind"`
	PublicURL string    `json:"publicUrl"`
	WebRoot   string    `json:"webRoot,omitempty"`
	Upstream  string    `json:"upstream"`
	TLS       TLSConfig `json:"tls"`
}

type Paths struct {
	Home                  string
	ConfigFile            string
	SitesDir              string
	WorkspaceSiteFile     string
	ReleaseServerSiteFile string
	GeneratedConfig       string
	StateRelease          string
	DataDir               string
	LogsDir               string
	DownloadsDir          string
	RollbackDir           string
}

func ResolvePaths(home string) Paths {
	home = filepath.Clean(home)
	return Paths{
		Home:                  home,
		ConfigFile:            filepath.Join(home, "config.json"),
		SitesDir:              filepath.Join(home, "sites"),
		WorkspaceSiteFile:     filepath.Join(home, "sites", "workspace.json"),
		ReleaseServerSiteFile: filepath.Join(home, "sites", "release-server.json"),
		GeneratedConfig:       filepath.Join(home, "generated", "caddy.json"),
		StateRelease:          filepath.Join(home, "state", "release.json"),
		DataDir:               filepath.Join(home, "data"),
		LogsDir:               filepath.Join(home, "logs"),
		DownloadsDir:          filepath.Join(home, "downloads"),
		RollbackDir:           filepath.Join(home, "rollback"),
	}
}

func LoadGlobal(reader io.Reader) (GlobalConfig, error) {
	var cfg GlobalConfig
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return GlobalConfig{}, fmt.Errorf("decode global config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return GlobalConfig{}, errors.New("decode global config: trailing data")
	}
	if cfg.Schema == 0 {
		cfg.Schema = GlobalSchemaVersion
	}
	if cfg.Schema != GlobalSchemaVersion {
		return GlobalConfig{}, fmt.Errorf("unsupported global config schema %d", cfg.Schema)
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = DefaultLogLevel
	}
	return cfg, nil
}

func LoadSite(reader io.Reader) (SiteConfig, error) {
	var site SiteConfig
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&site); err != nil {
		return SiteConfig{}, fmt.Errorf("decode site config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return SiteConfig{}, errors.New("decode site config: trailing data")
	}
	return site, nil
}

func ValidateGlobal(cfg GlobalConfig) error {
	if cfg.Schema != GlobalSchemaVersion {
		return fmt.Errorf("unsupported global config schema %d", cfg.Schema)
	}
	if cfg.Log.Level == "" {
		return fmt.Errorf("log level is required")
	}
	switch strings.ToUpper(cfg.Log.Level) {
	case "DEBUG", "INFO", "WARN", "ERROR":
		return validateRelayPort(cfg.Relay.ListenPort)
	default:
		return fmt.Errorf("unsupported log level %q", cfg.Log.Level)
	}
}

func validateRelayPort(port int) error {
	if port == 0 {
		return nil
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("relay listen port must be between 1 and 65535, got %d", port)
	}
	switch port {
	case 80, 443, 2019, 9630, 9680:
		return fmt.Errorf("relay listen port %d is reserved", port)
	default:
		return nil
	}
}

func ValidateSite(site SiteConfig) error {
	if site.Schema != SiteSchemaVersion {
		return fmt.Errorf("unsupported site schema %d", site.Schema)
	}
	if site.Kind != SiteWorkspace && site.Kind != SiteReleaseServer {
		return fmt.Errorf("unsupported site kind %q", site.Kind)
	}
	parsed, err := url.Parse(site.PublicURL)
	if err != nil {
		return fmt.Errorf("publicUrl: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("publicUrl scheme must be http or https")
	}
	if parsed.User != nil || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("publicUrl must contain only scheme, host, optional port, and / path")
	}
	if site.Upstream == "" {
		return fmt.Errorf("upstream is required")
	}
	upstream, err := url.Parse(site.Upstream)
	if err != nil || upstream.Scheme != "http" || upstream.User != nil || upstream.Hostname() == "" || (upstream.Path != "" && upstream.Path != "/") || upstream.RawQuery != "" || upstream.Fragment != "" {
		return fmt.Errorf("upstream must be a loopback http URL")
	}
	if !isLoopbackHost(upstream.Hostname()) {
		return fmt.Errorf("upstream must use a loopback address")
	}
	if site.Kind == SiteWorkspace && (site.WebRoot == "" || !filepath.IsAbs(site.WebRoot)) {
		return fmt.Errorf("static root must be an absolute path")
	}
	if site.Kind == SiteReleaseServer && site.WebRoot != "" {
		return fmt.Errorf("release-server site cannot set webRoot")
	}
	if (site.TLS.CertificateFile == "") != (site.TLS.KeyFile == "") {
		return fmt.Errorf("certificate and key must be provided as a pair")
	}
	if site.TLS.CertificateFile != "" {
		if !filepath.IsAbs(site.TLS.CertificateFile) || !filepath.IsAbs(site.TLS.KeyFile) {
			return fmt.Errorf("certificate and key paths must be absolute")
		}
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s SiteConfig) StaticRoot() string {
	return s.WebRoot
}

func (s SiteConfig) Host() string {
	parsed, _ := url.Parse(s.PublicURL)
	// Caddy's host matcher compares the hostname after stripping the port
	// from the incoming Host header. Keep external/NAT ports in publicUrl for
	// redirects, but compile only the hostname into route and TLS matchers.
	return parsed.Hostname()
}

func (s SiteConfig) HTTPS() bool {
	parsed, _ := url.Parse(s.PublicURL)
	return parsed.Scheme == "https"
}

func (s SiteConfig) UpstreamAddress() string {
	parsed, _ := url.Parse(s.Upstream)
	return parsed.Host
}

func EnsureHome(home string) error {
	if home == "" || !filepath.IsAbs(home) {
		return fmt.Errorf("gateway home must be an absolute path")
	}
	paths := ResolvePaths(home)
	for _, dir := range []string{paths.Home, paths.SitesDir, filepath.Dir(paths.GeneratedConfig), filepath.Dir(paths.StateRelease), paths.DataDir, paths.LogsDir, paths.DownloadsDir, paths.RollbackDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create gateway directory %s: %w", dir, err)
		}
	}
	return nil
}
