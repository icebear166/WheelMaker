package gateway

import (
	"bytes"
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
	GlobalSchemaVersion     = 2
	SiteSchemaVersion       = 1
	DefaultLogLevel         = "INFO"
	DefaultRegistryUpstream = "http://127.0.0.1:9630"
	DefaultReleaseListen    = "127.0.0.1:9680"
	URLModeSyncHub          = "sync_hub"

	SiteRegistry SiteKind = "registry"
	SiteRelease  SiteKind = "release"
	SiteShare    SiteKind = "share"
)

type SiteKind string

type GlobalConfig struct {
	Schema  int           `json:"schema"`
	ACME    ACMEConfig    `json:"acme"`
	Log     LogConfig     `json:"-"`
	Relay   RelayConfig   `json:"-"`
	WMSites WMSitesConfig `json:"wm_sites"`
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

type WMSitesConfig struct {
	TLS      TLSConfig           `json:"tls"`
	Registry HubSyncedSiteConfig `json:"registry"`
	Release  ReleaseConfig       `json:"release"`
	Share    HubSyncedSiteConfig `json:"share"`
}

type HubSyncedSiteConfig struct {
	URLMode   string `json:"urlMode"`
	PublicURL string `json:"-"`
}

type ReleaseConfig struct {
	PublicURL   string `json:"publicUrl"`
	Listen      string `json:"listen"`
	DataRoot    string `json:"dataRoot"`
	TokenSHA256 string `json:"tokenSha256"`
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
	Home            string
	ConfigFile      string
	HubConfigFile   string
	RegistryWebRoot string
	ReleaseDataRoot string
	SharePublicRoot string
	GeneratedConfig string
	StateRelease    string
	DataDir         string
	LogsDir         string
	DownloadsDir    string
	RollbackDir     string
}

func ResolvePaths(home string) Paths {
	home = filepath.Clean(home)
	stateRoot := filepath.Dir(home)
	return Paths{
		Home:            home,
		ConfigFile:      filepath.Join(home, "config.json"),
		HubConfigFile:   filepath.Join(stateRoot, "config.json"),
		RegistryWebRoot: filepath.Join(stateRoot, "web"),
		ReleaseDataRoot: filepath.Join(stateRoot, "release-server", "data"),
		SharePublicRoot: filepath.Join(stateRoot, "shares", "public"),
		GeneratedConfig: filepath.Join(home, "generated", "caddy.json"),
		StateRelease:    filepath.Join(home, "state", "release.json"),
		DataDir:         filepath.Join(home, "data"),
		LogsDir:         filepath.Join(home, "logs"),
		DownloadsDir:    filepath.Join(home, "downloads"),
		RollbackDir:     filepath.Join(home, "rollback"),
	}
}

func LoadGlobal(reader io.Reader) (GlobalConfig, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return GlobalConfig{}, fmt.Errorf("read global config: %w", err)
	}
	var header struct {
		Schema int `json:"schema"`
	}
	headerDecoder := json.NewDecoder(bytes.NewReader(data))
	if err := headerDecoder.Decode(&header); err == nil && header.Schema != 0 && header.Schema != GlobalSchemaVersion {
		return GlobalConfig{}, fmt.Errorf("unsupported global config schema %d", header.Schema)
	}

	var cfg GlobalConfig
	decoder := json.NewDecoder(bytes.NewReader(data))
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
	if cfg.WMSites.Registry.URLMode == "" {
		cfg.WMSites.Registry.URLMode = URLModeSyncHub
	}
	if cfg.WMSites.Share.URLMode == "" {
		cfg.WMSites.Share.URLMode = URLModeSyncHub
	}
	if err := validateURLMode(cfg.WMSites.Registry.URLMode, "wm_sites.registry"); err != nil {
		return GlobalConfig{}, err
	}
	if err := validateURLMode(cfg.WMSites.Share.URLMode, "wm_sites.share"); err != nil {
		return GlobalConfig{}, err
	}
	if cfg.WMSites.Release.Listen == "" {
		cfg.WMSites.Release.Listen = DefaultReleaseListen
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
	default:
		return fmt.Errorf("unsupported log level %q", cfg.Log.Level)
	}
	if err := validateRelayPort(cfg.Relay.ListenPort); err != nil {
		return err
	}
	if err := validateURLMode(cfg.WMSites.Registry.URLMode, "wm_sites.registry"); err != nil {
		return err
	}
	if err := validateURLMode(cfg.WMSites.Share.URLMode, "wm_sites.share"); err != nil {
		return err
	}
	if err := validateOptionalPublicURL(cfg.WMSites.Registry.PublicURL, "registry publicUrl"); err != nil {
		return err
	}
	if err := validateOptionalPublicURL(cfg.WMSites.Release.PublicURL, "release publicUrl"); err != nil {
		return err
	}
	if err := validateOptionalPublicURL(cfg.WMSites.Share.PublicURL, "share publicUrl"); err != nil {
		return err
	}
	if cfg.WMSites.Release.Listen != "" && cfg.WMSites.Release.Listen != DefaultReleaseListen {
		return fmt.Errorf("release listen must be %s", DefaultReleaseListen)
	}
	if cfg.WMSites.Release.DataRoot != "" && !filepath.IsAbs(cfg.WMSites.Release.DataRoot) {
		return fmt.Errorf("release dataRoot must be absolute")
	}
	if cfg.WMSites.Release.TokenSHA256 != "" && !validSHA256Digest(cfg.WMSites.Release.TokenSHA256) {
		return fmt.Errorf("release tokenSha256 must be a 64-character lowercase SHA-256 digest")
	}
	if err := validateTLSConfig(cfg.WMSites.TLS, "wm_sites"); err != nil {
		return err
	}
	return nil
}

func validateURLMode(mode, label string) error {
	if mode != "" && mode != URLModeSyncHub {
		return fmt.Errorf("%s urlMode must be %q", label, URLModeSyncHub)
	}
	return nil
}

func validateOptionalPublicURL(raw, label string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s scheme must be http or https", label)
	}
	if parsed.User != nil || parsed.Hostname() == "" || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("%s must contain only scheme, host, optional port, and / path", label)
	}
	return nil
}

func validateTLSConfig(tls TLSConfig, label string) error {
	if (tls.CertificateFile == "") != (tls.KeyFile == "") {
		return fmt.Errorf("%s certificate and key must be provided as a pair", label)
	}
	if tls.CertificateFile != "" && (!filepath.IsAbs(tls.CertificateFile) || !filepath.IsAbs(tls.KeyFile)) {
		return fmt.Errorf("%s certificate and key paths must be absolute", label)
	}
	return nil
}

func validSHA256Digest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') {
			return false
		}
	}
	return true
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
	if site.Kind != SiteRegistry && site.Kind != SiteRelease && site.Kind != SiteShare {
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
	switch site.Kind {
	case SiteRegistry:
		if err := validateSiteUpstream(site.Upstream); err != nil {
			return err
		}
		if site.WebRoot == "" || !filepath.IsAbs(site.WebRoot) {
			return fmt.Errorf("static root must be an absolute path")
		}
	case SiteRelease:
		if err := validateSiteUpstream(site.Upstream); err != nil {
			return err
		}
		if site.WebRoot != "" {
			return fmt.Errorf("release site cannot set webRoot")
		}
	case SiteShare:
		if site.Upstream != "" {
			return fmt.Errorf("share site cannot set upstream")
		}
		if site.WebRoot == "" || !filepath.IsAbs(site.WebRoot) {
			return fmt.Errorf("share static root must be an absolute path")
		}
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

func validateSiteUpstream(raw string) error {
	if raw == "" {
		return fmt.Errorf("upstream is required")
	}
	upstream, err := url.Parse(raw)
	if err != nil || upstream.Scheme != "http" || upstream.User != nil || upstream.Hostname() == "" || (upstream.Path != "" && upstream.Path != "/") || upstream.RawQuery != "" || upstream.Fragment != "" {
		return fmt.Errorf("upstream must be a loopback http URL")
	}
	if !isLoopbackHost(upstream.Hostname()) {
		return fmt.Errorf("upstream must use a loopback address")
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
	for _, dir := range []string{paths.Home, filepath.Dir(paths.GeneratedConfig), filepath.Dir(paths.StateRelease), paths.DataDir, paths.LogsDir, paths.DownloadsDir, paths.RollbackDir, paths.SharePublicRoot} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create gateway directory %s: %w", dir, err)
		}
	}
	return nil
}

func DefaultGlobalConfig(home string) GlobalConfig {
	paths := ResolvePaths(home)
	return GlobalConfig{
		Schema: GlobalSchemaVersion,
		ACME:   ACMEConfig{Email: ""},
		Log:    LogConfig{Level: DefaultLogLevel},
		Relay:  RelayConfig{ListenPort: 0},
		WMSites: WMSitesConfig{
			TLS: TLSConfig{},
			Registry: HubSyncedSiteConfig{
				URLMode: URLModeSyncHub,
			},
			Release: ReleaseConfig{
				PublicURL:   "",
				Listen:      DefaultReleaseListen,
				DataRoot:    paths.ReleaseDataRoot,
				TokenSHA256: "",
			},
			Share: HubSyncedSiteConfig{
				URLMode: URLModeSyncHub,
			},
		},
	}
}
