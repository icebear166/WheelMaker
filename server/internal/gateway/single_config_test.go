package gateway

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestLoadBundleBuildsAllRoutesFromHubAndGatewayConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	hubConfig := `{
  "publicUrl": "https://registry.example.com",
  "log": {"level": "warn"},
  "registry": {
    "listen": true,
    "relayPort": 28810,
    "share": {"publicUrl": "https://share.example.com"}
  }
}`
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(hubConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	config := `{
  "schema": 2,
  "acme": {"email": "ops@example.com"},
  "wm_sites": {
    "tls": {"certificateFile": "", "keyFile": ""},
    "registry": {"urlMode": "sync_hub"},
    "release": {
      "publicUrl": "https://release.example.com",
      "listen": "127.0.0.1:9680",
      "dataRoot": "` + filepath.ToSlash(filepath.Join(root, "release-data")) + `",
      "tokenSha256": ""
    },
    "share": {"urlMode": "sync_hub"}
  }
}`
	if err := os.WriteFile(paths.ConfigFile, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 3 {
		t.Fatalf("LoadBundle() built %d sites, want 3: %+v", len(bundle.Sites), bundle.Sites)
	}
	if bundle.Sites[0].PublicURL != "https://registry.example.com" {
		t.Fatalf("registry publicUrl = %q, want Hub value", bundle.Sites[0].PublicURL)
	}
	if bundle.Sites[2].PublicURL != "https://share.example.com" {
		t.Fatalf("share publicUrl = %q, want Hub value", bundle.Sites[2].PublicURL)
	}
	if bundle.Global.Relay.ListenPort != 28810 || bundle.Global.Log.Level != "warn" {
		t.Fatalf("shared runtime values = relay %d, log %q; want 28810 and warn", bundle.Global.Relay.ListenPort, bundle.Global.Log.Level)
	}
	wantKinds := []string{"registry", "release", "share"}
	for index, want := range wantKinds {
		if got := string(bundle.Sites[index].Kind); got != want {
			t.Errorf("site[%d].Kind = %q, want %q", index, got, want)
		}
	}
	if bundle.Sites[1].Upstream != "http://127.0.0.1:9680" {
		t.Fatalf("release upstream = %q, want loopback Release Server", bundle.Sites[1].Upstream)
	}
	if bundle.Sites[2].WebRoot != paths.SharePublicRoot {
		t.Fatalf("share web root = %q, want %q", bundle.Sites[2].WebRoot, paths.SharePublicRoot)
	}
}

func TestLoadBundleSharesOneTLSConfigAcrossAllSites(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(`{
  "publicUrl": "https://registry.example.com",
  "registry": {
    "listen": true,
    "share": {"publicUrl": "https://share.example.com"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	certificateFile := filepath.Join(root, "certs", "wm-sites.crt")
	keyFile := filepath.Join(root, "certs", "wm-sites.key")
	writeTestCertificate(t, certificateFile, keyFile)
	config := `{
  "schema": 2,
  "acme": {"email": "ops@example.com"},
  "wm_sites": {
    "tls": {
      "certificateFile": "` + filepath.ToSlash(certificateFile) + `",
      "keyFile": "` + filepath.ToSlash(keyFile) + `"
    },
    "registry": {"urlMode": "sync_hub"},
    "release": {
      "publicUrl": "https://release.example.com",
      "dataRoot": "` + filepath.ToSlash(filepath.Join(root, "release-data")) + `"
    },
    "share": {"urlMode": "sync_hub"}
  }
}`
	if err := os.WriteFile(paths.ConfigFile, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 3 {
		t.Fatalf("LoadBundle() built %d sites, want 3", len(bundle.Sites))
	}
	wantTLS := TLSConfig{CertificateFile: filepath.ToSlash(certificateFile), KeyFile: filepath.ToSlash(keyFile)}
	for index, site := range bundle.Sites {
		if site.TLS != wantTLS {
			t.Errorf("site[%d] TLS = %+v, want %+v", index, site.TLS, wantTLS)
		}
	}

	var document map[string]any
	if err := json.Unmarshal(bundle.JSON, &document); err != nil {
		t.Fatal(err)
	}
	loadFiles, ok := deepValue(document, "apps", "tls", "certificates", "load_files").([]any)
	if !ok || len(loadFiles) != 1 {
		t.Fatalf("shared TLS load_files = %#v, want one certificate pair", loadFiles)
	}
}

func writeTestCertificate(t *testing.T, certificateFile, keyFile string) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "registry.example.com"},
		DNSNames:     []string{"registry.example.com", "release.example.com", "share.example.com"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	certificateDER, err := x509.CreateCertificate(rand.Reader, template, template, publicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(certificateFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(certificateFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificateDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadBundleIncludesCustomCaddySites(t *testing.T) {
	home := customCaddyBundleHome(t)

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	for _, expected := range []string{
		"custom.example.com",
		"secure.example.com",
		"reverse_proxy",
		"file_server",
		"headers",
		"rewrite",
		`"module": "internal"`,
	} {
		if !bytes.Contains(bundle.JSON, []byte(expected)) {
			t.Errorf("compiled JSON missing %q", expected)
		}
	}
	if err := ValidateJSON(bundle.JSON); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(bundle.JSON, &document); err != nil {
		t.Fatal(err)
	}
	if got := deepString(document, "admin", "listen"); got != "127.0.0.1:2019" {
		t.Fatalf("admin listener = %q", got)
	}
	if got := deepString(document, "storage", "root"); filepath.Clean(got) != filepath.Clean(ResolvePaths(home).DataDir) {
		t.Fatalf("storage root = %q", got)
	}
	if got := deepString(document, "logging", "logs", "default", "level"); got != "INFO" {
		t.Fatalf("default log level = %q", got)
	}
	if len(bundle.Dependencies) != 4 {
		t.Fatalf("dependencies = %#v, want four custom Caddy files", bundle.Dependencies)
	}
	for index := 1; index < len(bundle.Dependencies); index++ {
		if bundle.Dependencies[index-1] >= bundle.Dependencies[index] {
			t.Fatalf("dependencies are not sorted: %#v", bundle.Dependencies)
		}
	}
}

func TestCustomCaddyCompilationIsDeterministic(t *testing.T) {
	home := customCaddyBundleHome(t)
	first, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.JSON, second.JSON) {
		t.Fatalf("compiled JSON changed for identical sources\nfirst: %s\nsecond: %s", first.JSON, second.JSON)
	}
	if !reflect.DeepEqual(first.Dependencies, second.Dependencies) {
		t.Fatalf("dependencies changed: %#v != %#v", first.Dependencies, second.Dependencies)
	}
	if first.Fingerprint == "" || first.Fingerprint != second.Fingerprint {
		t.Fatalf("fingerprint changed: %q != %q", first.Fingerprint, second.Fingerprint)
	}
}

func TestCustomCaddyRejectsManagedBoundariesAndInvalidSources(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string
		want  []string
	}{
		{
			name:  "global options",
			files: map[string]string{"global.caddy": "{\n\tadmin off\n}\n"},
			want:  []string{"global.caddy", "global"},
		},
		{
			name:  "unknown third party directive",
			files: map[string]string{"unknown.caddy": "unknown.example.com {\n\tnot_a_real_directive\n}\n"},
			want:  []string{"unknown.caddy", "not_a_real_directive"},
		},
		{
			name:  "managed hostname case scheme and port",
			files: map[string]string{"duplicate.caddy": "http://REGISTRY.EXAMPLE.COM:8080 {\n\trespond ok\n}\n"},
			want:  []string{"duplicate.caddy", "registry.example.com", "registry"},
		},
		{
			name:  "hostless http catch all",
			files: map[string]string{"catch-all.caddy": ":80 {\n\trespond ok\n}\n"},
			want:  []string{"catch-all.caddy", "80", "catch-all"},
		},
		{
			name:  "hostless https catch all",
			files: map[string]string{"catch-all.caddy": ":443 {\n\trespond ok\n}\n"},
			want:  []string{"catch-all.caddy", "443", "catch-all"},
		},
		{
			name:  "admin listener",
			files: map[string]string{"reserved.caddy": "custom.example.com:2019 {\n\trespond ok\n}\n"},
			want:  []string{"reserved.caddy", "2019", "admin"},
		},
		{
			name:  "hub listener",
			files: map[string]string{"reserved.caddy": "custom.example.com:9630 {\n\trespond ok\n}\n"},
			want:  []string{"reserved.caddy", "9630", "registry"},
		},
		{
			name:  "release listener",
			files: map[string]string{"reserved.caddy": "custom.example.com:9680 {\n\trespond ok\n}\n"},
			want:  []string{"reserved.caddy", "9680", "release"},
		},
		{
			name:  "relay listener",
			files: map[string]string{"reserved.caddy": "custom.example.com:28810 {\n\trespond ok\n}\n"},
			want:  []string{"reserved.caddy", "28810", "relay"},
		},
		{
			name: "escaping import",
			files: map[string]string{
				"escape.caddy":     "import ../outside.caddy\n",
				"../outside.caddy": "outside.example.com {\n\trespond ok\n}\n",
			},
			want: []string{"outside.caddy", "outside", "sites"},
		},
		{
			name:  "direct syntax error",
			files: map[string]string{"direct.caddy": "direct.example.com {\n\trespond ok\n"},
			want:  []string{"direct.caddy", "expecting"},
		},
		{
			name: "imported syntax error",
			files: map[string]string{
				"import.caddy":     "import nested/bad.caddy\n",
				"nested/bad.caddy": "nested.example.com {\n\trespond ok\n",
			},
			want: []string{"bad.caddy", "expecting"},
		},
	}

	linePattern := regexp.MustCompile(`:[1-9][0-9]*`)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			home := customBoundaryHome(t, test.files)
			_, err := LoadBundle(home)
			if err == nil {
				t.Fatal("LoadBundle() accepted a forbidden custom Caddy source")
			}
			message := strings.ToLower(filepath.ToSlash(err.Error()))
			for _, want := range test.want {
				if !strings.Contains(message, strings.ToLower(filepath.ToSlash(want))) {
					t.Errorf("error %q does not contain %q", err, want)
				}
			}
			if !linePattern.MatchString(message) {
				t.Errorf("error %q does not contain a positive source line", err)
			}
		})
	}
}

func TestCustomCaddyAllowsManagedLoopbackUpstream(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{
		"proxy.caddy": "custom.example.com {\n\treverse_proxy 127.0.0.1:9630\n}\n",
	})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() rejected a reserved service port used only as an upstream: %v", err)
	}
	if !bytes.Contains(bundle.JSON, []byte("127.0.0.1:9630")) {
		t.Fatalf("compiled config is missing custom upstream: %s", bundle.JSON)
	}
}

func customBoundaryHome(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.HubConfigFile, []byte(`{
  "publicUrl": "https://registry.example.com",
  "registry": {"listen": true, "relayPort": 28810}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 2,
  "wm_sites": {
    "tls": {},
    "registry": {"urlMode": "sync_hub"},
    "release": {},
    "share": {"urlMode": "sync_hub"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for relative, contents := range files {
		path := filepath.Join(paths.CustomSitesRoot, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func customCaddyBundleHome(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.HubConfigFile, []byte(`{
  "publicUrl": "https://registry.example.com",
  "registry": {"listen": true}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 2,
  "wm_sites": {
    "tls": {},
    "registry": {"urlMode": "sync_hub"},
    "release": {},
    "share": {"urlMode": "sync_hub"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	staticRoot := filepath.ToSlash(filepath.Join(root, "custom-static"))
	files := map[string]string{
		"00-snippets.caddy": `(custom_headers) {
	header X-WheelMaker-Custom "yes"
}
`,
		"10-app.caddy": `custom.example.com {
	import custom_headers
	@api path /api/*
	handle @api {
		reverse_proxy 127.0.0.1:3000
	}
	root * ` + staticRoot + `
	file_server
}
`,
		"20-import.caddy": "import nested/*.caddy\n",
		filepath.Join("nested", "secure.caddy"): `secure.example.com {
	tls internal
	rewrite /old /new
	respond "secure"
}
`,
	}
	for relative, contents := range files {
		path := filepath.Join(paths.CustomSitesRoot, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func TestSemanticFingerprintTracksHubAndGatewayConfig(t *testing.T) {
	root := t.TempDir()
	paths := ResolvePaths(filepath.Join(root, "gateway"))
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	first := semanticFingerprint(paths)
	hubConfig := filepath.Join(filepath.Dir(paths.Home), "config.json")
	if err := os.WriteFile(hubConfig, []byte(`{"registry":{"share":{"publicUrl":"https://share.example.com"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := semanticFingerprint(paths); got == first {
		t.Fatalf("semanticFingerprint did not change for Hub config: %q", got)
	}
}

func TestLoadBundleKeepsReleaseWhenHubShareIsInvalid(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 2,
  "wm_sites": {
    "tls": {"certificateFile": "", "keyFile": ""},
    "registry": {"urlMode": "sync_hub"},
    "release": {"publicUrl": "https://release.example.com"},
    "share": {"urlMode": "sync_hub"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(`{
  "publicUrl": "https://registry.example.com",
  "registry": {
    "listen": true,
    "share": {"publicUrl": "https://share.example.com/path"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 2 {
		t.Fatalf("LoadBundle() built %d sites, want registry and release: %+v", len(bundle.Sites), bundle.Sites)
	}
	if bundle.Sites[0].Kind != SiteRegistry || bundle.Sites[1].Kind != SiteRelease {
		t.Fatalf("sites = %+v, want registry and release", bundle.Sites)
	}
}

func TestLoadBundleSupportsReleaseOnlyWithoutHubConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 2,
  "wm_sites": {
    "tls": {"certificateFile": "", "keyFile": ""},
    "registry": {"urlMode": "sync_hub"},
    "release": {"publicUrl": "https://release.example.com"},
    "share": {"urlMode": "sync_hub"}
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 1 || bundle.Sites[0].Kind != SiteRelease {
		t.Fatalf("sites = %+v, want Release-only bundle", bundle.Sites)
	}
}

func TestLoadBundleRejectsSchemaOneGatewayConfig(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.ConfigFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{
  "schema": 1,
  "registry": {"tls": {"certificateFile": "", "keyFile": ""}},
  "release": {"publicUrl": "https://release.example.com"},
  "share": {"tls": {"certificateFile": "", "keyFile": ""}}
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := LoadBundle(home); err == nil {
		t.Fatal("LoadBundle() accepted schema 1 Gateway config")
	}
}

func TestGatewayConfigIncludesReleaseRuntimeFields(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	config, err := loadGlobalFile(paths.ConfigFile)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if got := document["schema"]; got != float64(2) {
		t.Fatalf("default Gateway schema = %#v, want 2", got)
	}
	wmSites, ok := document["wm_sites"].(map[string]any)
	if !ok {
		t.Fatalf("default Gateway config wm_sites = %#v", document["wm_sites"])
	}
	release, ok := wmSites["release"].(map[string]any)
	if !ok {
		t.Fatalf("default Gateway config wm_sites.release = %#v", wmSites["release"])
	}
	for _, field := range []string{"publicUrl", "listen", "dataRoot", "tokenSha256"} {
		if _, ok := release[field]; !ok {
			t.Errorf("default release config missing %q", field)
		}
	}
	for _, field := range []string{"log", "relay", "registry", "release", "share"} {
		if _, ok := document[field]; ok {
			t.Errorf("default Gateway config contains retired top-level field %q", field)
		}
	}
	if _, ok := wmSites["tls"].(map[string]any); !ok {
		t.Fatalf("default Gateway config wm_sites.tls = %#v", wmSites["tls"])
	}
	for section := range map[string]struct{}{"registry": {}, "share": {}} {
		value, ok := wmSites[section].(map[string]any)
		if !ok {
			t.Fatalf("default Gateway config wm_sites.%s = %#v", section, wmSites[section])
		}
		if value["urlMode"] != "sync_hub" {
			t.Errorf("default Gateway config wm_sites.%s.urlMode = %#v", section, value["urlMode"])
		}
	}
	if release["dataRoot"] != filepath.Join(filepath.Dir(home), "release-server", "data") {
		t.Errorf("default release dataRoot = %#v", release["dataRoot"])
	}
	_ = paths
}
