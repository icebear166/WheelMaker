package gateway

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
	"github.com/gorilla/websocket"
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

func TestLoadBundlePreservesTLSPoliciesForCustomHTTPSHosts(t *testing.T) {
	home := customCaddyBundleHome(t)

	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(bundle.JSON, &document); err != nil {
		t.Fatal(err)
	}
	policies, ok := deepValue(document, "apps", "http", "servers", "https", "tls_connection_policies").([]any)
	if !ok {
		t.Fatalf("HTTPS TLS policies are missing: %s", bundle.JSON)
	}
	hosts := make(map[string]bool)
	for _, policy := range policies {
		for _, host := range deepValue(policy, "match", "sni").([]any) {
			hosts[host.(string)] = true
		}
	}
	for _, want := range []string{"registry.example.com", "custom.example.com", "secure.example.com"} {
		if !hosts[want] {
			t.Errorf("HTTPS TLS policies do not include %q: %#v", want, hosts)
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
			name: "escaping empty import",
			files: map[string]string{
				"escape-empty.caddy":     "import ../outside-empty.caddy\n",
				"../outside-empty.caddy": "",
			},
			want: []string{"escape-empty.caddy", "outside-empty.caddy", "sites"},
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

func TestSemanticFingerprintTracksCustomSiteTreeChanges(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{
		"entry.caddy": "import nested/*.caddy\n",
	})
	paths := ResolvePaths(home)
	previous := semanticFingerprint(paths)
	assertChanged := func(action func()) {
		t.Helper()
		action()
		next := semanticFingerprint(paths)
		if next == previous {
			t.Fatalf("semanticFingerprint did not change: %q", next)
		}
		previous = next
	}

	nested := filepath.Join(paths.CustomSitesRoot, "nested", "site.caddy")
	assertChanged(func() {
		if err := os.MkdirAll(filepath.Dir(nested), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(nested, []byte("one.example.com { respond ok }\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	})
	renamed := filepath.Join(filepath.Dir(nested), "renamed.caddy")
	assertChanged(func() {
		if err := os.Rename(nested, renamed); err != nil {
			t.Fatal(err)
		}
	})
	assertChanged(func() {
		if err := os.WriteFile(renamed, []byte("two.example.com { respond ok }\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	})
	assertChanged(func() {
		if err := os.Remove(renamed); err != nil {
			t.Fatal(err)
		}
	})
}

func TestRunManagedPromotesInitialCandidateOnlyAfterStart(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{
		"app.caddy": "app.example.com {\n\trespond ok\n}\n",
	})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	paths := ResolvePaths(home)
	if err := os.MkdirAll(filepath.Dir(paths.GeneratedConfig), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.GeneratedConfig, []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}

	context, cancel := context.WithCancel(context.Background())
	installManagedRuntimeFakes(t)
	started := false
	managedRuntimeStart = func(configJSON []byte) error {
		started = true
		cancel()
		return nil
	}
	managedRuntimePromote = func(staged, destination string) error {
		if !started {
			t.Fatal("generated config promoted before runtime start")
		}
		return promoteGenerated(staged, destination)
	}
	if err := RunManaged(context, home, bundle); err != nil {
		t.Fatalf("RunManaged() error = %v", err)
	}
	generated, err := os.ReadFile(paths.GeneratedConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(generated, bundle.JSON) {
		t.Fatal("cold start did not promote the accepted candidate")
	}
}

func TestRunManagedStartFailureKeepsGeneratedConfig(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{"app.caddy": "app.example.com {\n\trespond ok\n}\n"})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	paths := ResolvePaths(home)
	if err := WriteGenerated(paths.GeneratedConfig, []byte("previous")); err != nil {
		t.Fatal(err)
	}
	installManagedRuntimeFakes(t)
	managedRuntimeStart = func([]byte) error { return errors.New("bind failed") }
	if err := RunManaged(context.Background(), home, bundle); err == nil || !strings.Contains(err.Error(), "bind failed") {
		t.Fatalf("RunManaged() error = %v", err)
	}
	generated, err := os.ReadFile(paths.GeneratedConfig)
	if err != nil {
		t.Fatal(err)
	}
	if string(generated) != "previous" {
		t.Fatalf("failed cold start changed generated config: %q", generated)
	}
}

func TestRunManagedInitialPromotionFailureStopsRuntimeAndKeepsGeneratedConfig(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{"app.caddy": "app.example.com {\n\trespond ok\n}\n"})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	paths := ResolvePaths(home)
	if err := WriteGenerated(paths.GeneratedConfig, []byte("previous")); err != nil {
		t.Fatal(err)
	}
	installManagedRuntimeFakes(t)
	managedRuntimeStart = func([]byte) error { return nil }
	stopped := 0
	managedRuntimeStop = func() error {
		stopped++
		return nil
	}
	managedRuntimePromote = func(string, string) error { return errors.New("disk failed") }
	if err := RunManaged(context.Background(), home, bundle); err == nil || !strings.Contains(err.Error(), "disk failed") {
		t.Fatalf("RunManaged() error = %v", err)
	}
	if stopped != 1 {
		t.Fatalf("runtime stop count = %d, want 1", stopped)
	}
	generated, err := os.ReadFile(paths.GeneratedConfig)
	if err != nil {
		t.Fatal(err)
	}
	if string(generated) != "previous" {
		t.Fatalf("failed initial promotion changed generated config: %q", generated)
	}
}

func TestRunManagedRejectsInvalidChangeThenPromotesFixedCandidate(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{"app.caddy": "app.example.com {\n\trespond ok\n}\n"})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	installManagedRuntimeFakes(t)
	managedRuntimePollInterval = 5 * time.Millisecond
	context, cancel := context.WithCancel(context.Background())
	managedRuntimeStart = func([]byte) error { return nil }
	reloads := make(chan []byte, 4)
	managedRuntimeReload = func(configJSON []byte) error {
		reloads <- append([]byte(nil), configJSON...)
		cancel()
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- RunManaged(context, home, bundle) }()
	waitForFileContents(t, ResolvePaths(home).GeneratedConfig, bundle.JSON)

	sitePath := filepath.Join(home, "sites", "app.caddy")
	if err := os.WriteFile(sitePath, []byte("app.example.com {\n\trespond ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reloads:
		t.Fatal("invalid candidate reached the runtime reloader")
	case <-time.After(40 * time.Millisecond):
	}
	if generated, err := os.ReadFile(ResolvePaths(home).GeneratedConfig); err != nil || !bytes.Equal(generated, bundle.JSON) {
		t.Fatalf("invalid candidate changed generated config: %q, %v", generated, err)
	}
	if err := os.WriteFile(sitePath, []byte("fixed.example.com {\n\trespond ok\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var accepted []byte
	select {
	case accepted = <-reloads:
	case <-time.After(2 * time.Second):
		t.Fatal("fixed candidate was not reloaded")
	}
	if err := <-done; err != nil {
		t.Fatalf("RunManaged() error = %v", err)
	}
	generated, err := os.ReadFile(ResolvePaths(home).GeneratedConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(generated, accepted) || !bytes.Contains(generated, []byte("fixed.example.com")) {
		t.Fatalf("fixed candidate was not promoted: %s", generated)
	}
}

func TestRunManagedRetriesAfterReloadFailureWithoutPromotion(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{"app.caddy": "app.example.com {\n\trespond ok\n}\n"})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	installManagedRuntimeFakes(t)
	managedRuntimePollInterval = 5 * time.Millisecond
	context, cancel := context.WithCancel(context.Background())
	managedRuntimeStart = func([]byte) error { return nil }
	attempts := make(chan struct{}, 3)
	managedRuntimeReload = func([]byte) error {
		attempts <- struct{}{}
		if len(attempts) == 2 {
			cancel()
		}
		return errors.New("reload failed")
	}
	done := make(chan error, 1)
	go func() { done <- RunManaged(context, home, bundle) }()
	waitForFileContents(t, ResolvePaths(home).GeneratedConfig, bundle.JSON)
	if err := os.WriteFile(filepath.Join(home, "sites", "app.caddy"), []byte("changed.example.com {\n\trespond ok\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		select {
		case <-attempts:
		case <-time.After(2 * time.Second):
			t.Fatal("failed candidate was not retried")
		}
	}
	if err := <-done; err != nil {
		t.Fatalf("RunManaged() error = %v", err)
	}
	generated, err := os.ReadFile(ResolvePaths(home).GeneratedConfig)
	if err != nil || !bytes.Equal(generated, bundle.JSON) {
		t.Fatalf("failed reload changed generated config: %q, %v", generated, err)
	}
}

func TestRunManagedRollsBackRuntimeWhenPromotionFails(t *testing.T) {
	home := customBoundaryHome(t, map[string]string{"app.caddy": "app.example.com {\n\trespond ok\n}\n"})
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatal(err)
	}
	installManagedRuntimeFakes(t)
	managedRuntimePollInterval = 5 * time.Millisecond
	context, cancel := context.WithCancel(context.Background())
	managedRuntimeStart = func([]byte) error { return nil }
	var loaded [][]byte
	managedRuntimeReload = func(configJSON []byte) error {
		loaded = append(loaded, append([]byte(nil), configJSON...))
		if len(loaded) == 2 {
			cancel()
		}
		return nil
	}
	promotions := 0
	managedRuntimePromote = func(staged, destination string) error {
		promotions++
		if promotions > 1 {
			return errors.New("promotion failed")
		}
		return promoteGenerated(staged, destination)
	}
	done := make(chan error, 1)
	go func() { done <- RunManaged(context, home, bundle) }()
	waitForFileContents(t, ResolvePaths(home).GeneratedConfig, bundle.JSON)
	if err := os.WriteFile(filepath.Join(home, "sites", "app.caddy"), []byte("changed.example.com {\n\trespond ok\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunManaged() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runtime rollback did not complete")
	}
	if len(loaded) != 2 || bytes.Equal(loaded[0], bundle.JSON) || !bytes.Equal(loaded[1], bundle.JSON) {
		t.Fatalf("reload sequence does not contain candidate then rollback: %d configs", len(loaded))
	}
	generated, err := os.ReadFile(ResolvePaths(home).GeneratedConfig)
	if err != nil || !bytes.Equal(generated, bundle.JSON) {
		t.Fatalf("promotion failure changed generated config: %q, %v", generated, err)
	}
}

func installManagedRuntimeFakes(t *testing.T) {
	t.Helper()
	oldStart := managedRuntimeStart
	oldReload := managedRuntimeReload
	oldStop := managedRuntimeStop
	oldStage := managedRuntimeStage
	oldPromote := managedRuntimePromote
	oldInterval := managedRuntimePollInterval
	managedRuntimeStop = func() error { return nil }
	t.Cleanup(func() {
		managedRuntimeStart = oldStart
		managedRuntimeReload = oldReload
		managedRuntimeStop = oldStop
		managedRuntimeStage = oldStage
		managedRuntimePromote = oldPromote
		managedRuntimePollInterval = oldInterval
	})
}

func waitForFileContents(t *testing.T, path string, want []byte) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		contents, err := os.ReadFile(path)
		if err == nil && bytes.Equal(contents, want) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("file %s did not reach expected contents", path)
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

func TestResolvePathsUsesFixedGatewayHomeLayout(t *testing.T) {
	paths := ResolvePaths(`C:\Users\alice\.wheelmaker\gateway`)

	if paths.Home != `C:\Users\alice\.wheelmaker\gateway` {
		t.Fatalf("Home = %q", paths.Home)
	}
	if paths.ConfigFile != `C:\Users\alice\.wheelmaker\gateway\config.json` {
		t.Fatalf("ConfigFile = %q", paths.ConfigFile)
	}
	if paths.HubConfigFile != `C:\Users\alice\.wheelmaker\config.json` {
		t.Fatalf("HubConfigFile = %q", paths.HubConfigFile)
	}
	if paths.RegistryWebRoot != `C:\Users\alice\.wheelmaker\web` {
		t.Fatalf("RegistryWebRoot = %q", paths.RegistryWebRoot)
	}
	if paths.ReleaseDataRoot != `C:\Users\alice\.wheelmaker\release-server\data` {
		t.Fatalf("ReleaseDataRoot = %q", paths.ReleaseDataRoot)
	}
	if paths.GeneratedConfig != `C:\Users\alice\.wheelmaker\gateway\generated\caddy.json` {
		t.Fatalf("GeneratedConfig = %q", paths.GeneratedConfig)
	}
	if paths.CustomSitesRoot != `C:\Users\alice\.wheelmaker\gateway\sites` {
		t.Fatalf("CustomSitesRoot = %q", paths.CustomSitesRoot)
	}
}

func TestResolvePathsDerivesRuntimeRoots(t *testing.T) {
	paths := ResolvePaths(`C:\Users\alice\.wheelmaker\gateway`)
	if paths.SharePublicRoot != `C:\Users\alice\.wheelmaker\shares\public` {
		t.Fatalf("SharePublicRoot = %q", paths.SharePublicRoot)
	}
}

func TestEnsureHomeCreatesAndPreservesCustomSitesRoot(t *testing.T) {
	home := filepath.Join(t.TempDir(), "gateway")
	paths := ResolvePaths(home)
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(paths.CustomSitesRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatalf("CustomSitesRoot is not a directory: %s", paths.CustomSitesRoot)
	}

	sitePath := filepath.Join(paths.CustomSitesRoot, "existing.caddy")
	want := []byte("existing.example.com { respond \"ok\" }\n")
	if err := os.WriteFile(sitePath, want, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EnsureHome(home); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(sitePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("existing site bytes = %q, want %q", got, want)
	}
}

func TestValidateSiteRequiresHTTPSCertificatePair(t *testing.T) {
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   "C:\\Users\\alice\\.wheelmaker\\web",
		Upstream:  "http://127.0.0.1:9630",
		TLS:       TLSConfig{CertificateFile: "cert.pem"},
	}

	err := ValidateSite(site)
	if err == nil || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("ValidateSite error = %v, want certificate pair error", err)
	}
}

func TestValidateSiteAcceptsHTTPSAutomaticCertificate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   root,
		Upstream:  "http://127.0.0.1:9630",
	}

	if err := ValidateSite(site); err != nil {
		t.Fatalf("ValidateSite() error = %v", err)
	}
}

func TestValidateSiteRejectsUnsupportedUpstream(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "http://workspace.example.com",
		WebRoot:   root,
		Upstream:  "https://127.0.0.1:9630",
	}

	err := ValidateSite(site)
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("ValidateSite error = %v, want loopback error", err)
	}
}

func TestCompileConfigIncludesWorkspaceRoutesAndAutomaticTLS(t *testing.T) {
	root := filepath.Join(t.TempDir(), "web")
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   root,
		Upstream:  "http://127.0.0.1:9630",
	}

	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	if got := deepString(document, "apps", "tls", "automation", "policies", "0", "issuers", "0", "module"); got != "acme" {
		t.Fatalf("TLS issuer module = %q, want acme", got)
	}
	text := string(compiled)
	for _, want := range []string{"workspace.example.com", "127.0.0.1:9630", "file_server", "/ws*", "try_files"} {
		if !strings.Contains(text, want) {
			t.Errorf("compiled config does not contain %q", want)
		}
	}
}

func TestCompileConfigIncludesExactShareStaticRoute(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteShare,
		PublicURL: "https://share.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "shares", "public"),
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatal(err)
	}
	shareRoute := findRouteWithMatchValue(document, shareTokenRegexp)
	if shareRoute == nil || !containsDeepString(shareRoute["match"], "GET") || !containsDeepString(shareRoute["match"], "HEAD") {
		t.Fatalf("share token/method route is missing: %s", compiled)
	}
	if !containsHandler(shareRoute, "file_server") || !containsDeepString(shareRoute, filepath.ToSlash(site.WebRoot)) {
		t.Fatalf("share route does not serve the configured root: %#v", shareRoute)
	}
	fallback := findHandlerWithValue(document, "static_response", float64(404))
	if fallback == nil || fallback["status_code"] != float64(404) {
		t.Fatalf("share fallback = %#v, want status 404", fallback)
	}
	for _, want := range []string{"text/html; charset=utf-8", "inline", "no-store", "noindex, nofollow, noarchive", "no-referrer", "nosniff"} {
		if !strings.Contains(string(compiled), want) {
			t.Errorf("share route missing %q", want)
		}
	}
	if strings.Contains(string(compiled), "content_security_policy") || strings.Contains(string(compiled), "reverse_proxy") {
		t.Fatal("share route must not install CSP or reverse proxy")
	}
}

func TestLoadBundleReadsHubConfigAndIgnoresLegacySiteFiles(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "gateway")
	paths := ResolvePaths(home)
	legacySitePath := filepath.Join(home, "sites", "workspace.json")
	if err := os.MkdirAll(filepath.Dir(legacySitePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.ConfigFile, []byte(`{"schema":2,"wm_sites":{"tls":{"certificateFile":"","keyFile":""},"registry":{"urlMode":"sync_hub"},"release":{"publicUrl":""},"share":{"urlMode":"sync_hub"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	workspace := `{"schema":1,"kind":"workspace","publicUrl":"https://workspace.example.com","webRoot":"` + filepath.ToSlash(filepath.Join(root, "web")) + `","upstream":"http://127.0.0.1:9630","tls":{"certificateFile":"","keyFile":""}}`
	if err := os.WriteFile(legacySitePath, []byte(workspace), 0o600); err != nil {
		t.Fatal(err)
	}
	hubConfig := filepath.Join(filepath.Dir(home), "config.json")
	if err := os.WriteFile(hubConfig, []byte(`{"publicUrl":"https://registry.example.com","registry":{"listen":true,"share":{"publicUrl":"https://share.example.com"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := LoadBundle(home)
	if err != nil {
		t.Fatalf("LoadBundle() error = %v", err)
	}
	if len(bundle.Sites) != 2 || bundle.Sites[0].Kind != SiteRegistry || bundle.Sites[1].Kind != SiteShare {
		t.Fatalf("LoadBundle() sites = %+v, want Hub registry/share sites", bundle.Sites)
	}
}

func TestSemanticFingerprintTracksHubConfig(t *testing.T) {
	paths := ResolvePaths(filepath.Join(t.TempDir(), "gateway"))
	siblingAppConfig := filepath.Join(filepath.Dir(paths.Home), "config.json")
	if err := os.MkdirAll(filepath.Dir(siblingAppConfig), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(siblingAppConfig, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	first := semanticFingerprint(paths)
	if err := os.WriteFile(siblingAppConfig, []byte(`{"share":{"publicUrl":"https://share.example.com"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	second := semanticFingerprint(paths)
	if first == second {
		t.Fatalf("semanticFingerprint did not change for Hub config: %q", first)
	}
}

func TestCompileConfigAddsCompressionAndCacheHeadersToWorkspaceAssets(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	workspace := deepValue(document, "apps", "http", "servers", "https")
	wsRoute := findRouteWithMatchValue(workspace, "/ws*")
	if wsRoute == nil || !containsHandler(wsRoute, "reverse_proxy") {
		t.Fatalf("WebSocket route is missing: %s", compiled)
	}
	if containsHandler(wsRoute, "encode") {
		t.Fatal("WebSocket route must not install the encode handler")
	}
	immutable := findRouteWithMatchValue(workspace, immutableAssetRegexp)
	if immutable == nil {
		t.Fatalf("immutable asset route is missing: %s", compiled)
	}
	if !containsHandler(immutable, "encode") {
		t.Fatal("immutable asset route must install the encode handler")
	}
	encodings, ok := findHandler(immutable, "encode")["encodings"].(map[string]any)
	if !ok || len(encodings) != 2 {
		t.Fatalf("immutable encodings = %#v, want zstd and gzip", encodings)
	}
	for _, name := range []string{"zstd", "gzip"} {
		if _, ok := encodings[name]; !ok {
			t.Errorf("immutable encodings missing %q", name)
		}
	}
	if !containsDeepString(immutable, immutableCacheControl) {
		t.Fatalf("immutable Cache-Control is missing: %#v", immutable)
	}
	if handlerCount(workspace, "encode") < 3 || strings.Count(string(compiled), `"no-cache"`) < 2 {
		t.Fatalf("static and SPA routes must be compressed with no-cache: %s", compiled)
	}
}

func TestCompileConfigAddsCompressionToReleaseServerResponses(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	server := deepValue(document, "apps", "http", "servers", "https")
	if !containsHandler(server, "encode") || !containsHandler(server, "reverse_proxy") {
		t.Fatal("release server route must install the encode handler")
	}
}

func TestCompileConfigProducesCaddyValidHTTPSDocument(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON() error = %v", err)
	}
	if strings.Contains(string(compiled), "file_server") || !strings.Contains(string(compiled), "reverse_proxy") {
		t.Fatalf("Release Server route must be proxy-only: %s", compiled)
	}
}

func TestCompileConfigStripsExternalPortFromHostMatchers(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com:8443",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig() error = %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatal(err)
	}
	if got := deepString(document, "apps", "http", "servers", "https", "routes", "0", "match", "0", "host", "0"); got != "workspace.example.com" {
		t.Fatalf("HTTPS host matcher = %q", got)
	}
	if got := deepString(document, "apps", "http", "servers", "http", "routes", "0", "handle", "0", "routes", "0", "handle", "0", "headers", "Location", "0"); got != "https://workspace.example.com:8443{http.request.uri}" {
		t.Fatalf("redirect Location = %q", got)
	}
}

func TestLoadGlobalRejectsSharedRuntimeFields(t *testing.T) {
	for _, input := range []string{
		`{"schema":2,"log":{"level":"INFO"}}`,
		`{"schema":2,"relay":{"listenPort":28810}}`,
		`{"schema":2,"registry":{"publicUrl":"https://registry.example.com"}}`,
		`{"schema":2,"release":{"publicUrl":"https://release.example.com"}}`,
		`{"schema":2,"share":{"publicUrl":"https://share.example.com"}}`,
	} {
		if _, err := LoadGlobal(strings.NewReader(input)); err == nil {
			t.Fatalf("LoadGlobal(%s) accepted Gateway duplicate field", input)
		}
	}
}

func TestLoadGlobalRejectsSchemaOne(t *testing.T) {
	input := `{"schema":1,"registry":{"tls":{"certificateFile":"","keyFile":""}},"release":{"publicUrl":""},"share":{"tls":{"certificateFile":"","keyFile":""}}}`
	if _, err := LoadGlobal(strings.NewReader(input)); err == nil || !strings.Contains(err.Error(), "schema 1") {
		t.Fatalf("LoadGlobal(schema 1) error = %v, want unsupported schema", err)
	}
}

func TestLoadGlobalDefaultsSyncHubURLModes(t *testing.T) {
	global, err := LoadGlobal(strings.NewReader(`{"schema":2,"wm_sites":{"tls":{},"registry":{},"release":{},"share":{}}}`))
	if err != nil {
		t.Fatalf("LoadGlobal() error = %v", err)
	}
	raw, err := json.Marshal(global)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	for _, site := range []string{"registry", "share"} {
		if got := deepString(document, "wm_sites", site, "urlMode"); got != "sync_hub" {
			t.Errorf("wm_sites.%s.urlMode = %q, want sync_hub", site, got)
		}
	}
}

func TestLoadGlobalRejectsUnsupportedURLMode(t *testing.T) {
	input := `{"schema":2,"wm_sites":{"tls":{},"registry":{"urlMode":"manual"},"release":{},"share":{"urlMode":"sync_hub"}}}`
	if _, err := LoadGlobal(strings.NewReader(input)); err == nil || !strings.Contains(err.Error(), "urlMode") {
		t.Fatalf("LoadGlobal(manual urlMode) error = %v, want rejection", err)
	}
}

func TestValidateGlobalRejectsReservedRelayPorts(t *testing.T) {
	for _, port := range []int{80, 443, 9630, 9680, 2019, -1, 65536} {
		err := ValidateGlobal(GlobalConfig{
			Schema: GlobalSchemaVersion,
			Relay:  RelayConfig{ListenPort: port},
			Log:    LogConfig{Level: "INFO"},
		})
		if err == nil {
			t.Fatalf("ValidateGlobal(port=%d)=nil, want rejection", port)
		}
	}
}

func TestCompileConfigAddsFixedHTTPRelayServer(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "http://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(): %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	relay := deepValue(document, "apps", "http", "servers", "relay")
	if relay == nil {
		t.Fatalf("fixed relay server is missing from HTTP app: %s", compiled)
	}
	if got := deepString(relay, "listen", "0"); got != ":28810" {
		t.Fatalf("relay listen=%q, want :28810", got)
	}
	if got := deepString(relay, "routes", "0", "match", "0", "host", "0"); got != "workspace.example.com" {
		t.Fatalf("relay host matcher=%q", got)
	}
	deleteHeaders := findHandlerWithValue(relay, "headers", "X-WheelMaker-Relay")
	if deleteHeaders == nil || !containsString(deepValue(deleteHeaders, "request", "delete"), "X-WheelMaker-Relay") {
		t.Fatal("relay must delete an incoming marker before setting its own marker")
	}
	requestHeaders := findHandlerWithValue(relay, "headers", "1")
	if requestHeaders == nil {
		t.Fatal("relay must set its trusted marker")
	}
	if got := headerValue(requestHeaders, "request", "set", "X-WheelMaker-Relay"); got != "1" {
		t.Fatalf("relay marker=%q, want 1: %#v", got, requestHeaders)
	}
	proxy := findHandler(relay, "reverse_proxy")
	if got := deepString(proxy, "upstreams", "0", "dial"); got != "127.0.0.1:9630" {
		t.Fatalf("relay upstream=%q", got)
	}
	if containsHandler(relay, "file_server") {
		t.Fatal("fixed relay server must not contain Workspace static-file handlers")
	}
}

func TestCompileConfigAddsFixedHTTPSRelayServerWithTLSPolicy(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "https://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  "http://127.0.0.1:9630",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(): %v", err)
	}

	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	relay := deepValue(document, "apps", "http", "servers", "relay")
	if relay == nil {
		t.Fatalf("fixed relay server is missing from HTTPS Workspace config: %s", compiled)
	}
	if got := deepString(relay, "listen", "0"); got != ":28810" {
		t.Fatalf("relay listen=%q, want :28810", got)
	}
	if got := deepString(relay, "tls_connection_policies", "0", "match", "sni", "0"); got != "workspace.example.com" {
		t.Fatalf("relay TLS SNI=%q, want workspace.example.com", got)
	}
	if got := deepString(document, "apps", "http", "servers", "https", "tls_connection_policies", "0", "match", "sni", "0"); got != "workspace.example.com" {
		t.Fatalf("Workspace TLS SNI=%q, want workspace.example.com", got)
	}
}

func TestCompileConfigDoesNotAddRelayWithoutWorkspaceSite(t *testing.T) {
	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: 28810},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRelease,
		PublicURL: "https://release.example.com",
		Upstream:  "http://127.0.0.1:9680",
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("compiled JSON is invalid: %v", err)
	}
	servers, ok := deepValue(document, "apps", "http", "servers").(map[string]any)
	if !ok {
		t.Fatalf("HTTP servers=%#v, want server map", deepValue(document, "apps", "http", "servers"))
	}
	if _, ok := servers["relay"]; ok {
		t.Fatal("fixed relay server must require a Workspace site")
	}
}

func TestCompileConfigRejectsDuplicateHostnames(t *testing.T) {
	global := GlobalConfig{Schema: GlobalSchemaVersion, Log: LogConfig{Level: "INFO"}}
	sites := []SiteConfig{
		{Schema: SiteSchemaVersion, Kind: SiteRegistry, PublicURL: "https://SAME.example.com", WebRoot: filepath.Join(t.TempDir(), "web"), Upstream: "http://127.0.0.1:9630"},
		{Schema: SiteSchemaVersion, Kind: SiteRelease, PublicURL: "https://same.example.com", Upstream: "http://127.0.0.1:9680"},
	}
	if _, err := CompileConfig(global, sites); err == nil || !strings.Contains(err.Error(), "duplicate hostname") {
		t.Fatalf("CompileConfig() error = %v", err)
	}
}

func TestCompileConfigIsDeterministic(t *testing.T) {
	webRoot := filepath.Join(t.TempDir(), "web")
	global := GlobalConfig{Schema: GlobalSchemaVersion, ACME: ACMEConfig{Email: "ops@example.com"}, Log: LogConfig{Level: "INFO"}}
	sites := []SiteConfig{
		{Schema: SiteSchemaVersion, Kind: SiteRelease, PublicURL: "https://release.example.com", Upstream: "http://127.0.0.1:9680"},
		{Schema: SiteSchemaVersion, Kind: SiteRegistry, PublicURL: "https://workspace.example.com", WebRoot: webRoot, Upstream: "http://127.0.0.1:9630"},
	}

	first, err := CompileConfig(global, sites)
	if err != nil {
		t.Fatalf("first CompileConfig() error = %v", err)
	}
	second, err := CompileConfig(global, sites)
	if err != nil {
		t.Fatalf("second CompileConfig() error = %v", err)
	}
	if string(first) != string(second) {
		t.Fatalf("CompileConfig() is not deterministic\nfirst: %s\nsecond: %s", first, second)
	}
}

func TestLoadGlobalMissingUsesDefaults(t *testing.T) {
	global, err := LoadGlobal(strings.NewReader(`{"schema":2,"acme":{"email":"ops@example.com"},"wm_sites":{"registry":{},"release":{},"share":{}}}`))
	if err != nil {
		t.Fatalf("LoadGlobal() error = %v", err)
	}
	if global.Log.Level != "INFO" {
		t.Fatalf("LogLevel = %q, want INFO", global.Log.Level)
	}
}

func TestLoadConfigRejectsTrailingJSON(t *testing.T) {
	if _, err := LoadGlobal(strings.NewReader(`{"schema":2} {"schema":2}`)); err == nil {
		t.Fatal("LoadGlobal accepted trailing JSON")
	}
	if _, err := LoadSite(strings.NewReader(`{"schema":1} {"schema":1}`)); err == nil {
		t.Fatal("LoadSite accepted trailing JSON")
	}
}

func TestWriteGeneratedReplacesConfigAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "generated", "caddy.json")
	if err := WriteGenerated(path, []byte(`{"version":1}`)); err != nil {
		t.Fatalf("first WriteGenerated() error = %v", err)
	}
	if err := WriteGenerated(path, []byte(`{"version":2}`)); err != nil {
		t.Fatalf("second WriteGenerated() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(data) != `{"version":2}` {
		t.Fatalf("generated config = %q", data)
	}
}

func TestValidateJSONRejectsMalformedGeneratedConfig(t *testing.T) {
	if err := ValidateJSON([]byte(`{"apps":{"http":{"servers":{"bad":{"routes":[{"handle":[{"handler":"not-a-real-handler"}]}]}}}}}`)); err == nil {
		t.Fatal("ValidateJSON() accepted an unknown Caddy handler")
	}
}

func deepString(value any, path ...string) string {
	value = deepValue(value, path...)
	result, _ := value.(string)
	return result
}

func deepValue(value any, path ...string) any {
	for _, part := range path {
		switch current := value.(type) {
		case map[string]any:
			value = current[part]
		case []any:
			var index int
			if err := parseIndex(part, &index); err != nil || index < 0 || index >= len(current) {
				return nil
			}
			value = current[index]
		default:
			return nil
		}
	}
	return value
}

func containsHandler(value any, want string) bool {
	switch current := value.(type) {
	case map[string]any:
		if handler, ok := current["handler"].(string); ok && handler == want {
			return true
		}
		for _, child := range current {
			if containsHandler(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsHandler(child, want) {
				return true
			}
		}
	}
	return false
}

func findHandler(value any, want string) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == want {
			return current
		}
		for _, child := range current {
			if found := findHandler(child, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findHandler(child, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func findHandlerWithValue(value any, handler string, want any) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == handler && containsDeepValue(current, want) {
			return current
		}
		for _, child := range current {
			if found := findHandlerWithValue(child, handler, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findHandlerWithValue(child, handler, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func handlerCount(value any, want string) int {
	count := 0
	switch current := value.(type) {
	case map[string]any:
		if current["handler"] == want {
			count++
		}
		for _, child := range current {
			count += handlerCount(child, want)
		}
	case []any:
		for _, child := range current {
			count += handlerCount(child, want)
		}
	}
	return count
}

func findRouteWithMatchValue(value any, want string) map[string]any {
	switch current := value.(type) {
	case map[string]any:
		if _, ok := current["match"]; ok && containsDeepString(current["match"], want) {
			return current
		}
		for _, child := range current {
			if found := findRouteWithMatchValue(child, want); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findRouteWithMatchValue(child, want); found != nil {
				return found
			}
		}
	}
	return nil
}

func containsDeepString(value any, want string) bool {
	switch current := value.(type) {
	case string:
		return current == want
	case map[string]any:
		for _, child := range current {
			if containsDeepString(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsDeepString(child, want) {
				return true
			}
		}
	}
	return false
}

func containsDeepValue(value any, want any) bool {
	switch current := value.(type) {
	case string:
		return current == want
	case float64:
		return current == want
	case bool:
		return current == want
	}
	switch current := value.(type) {
	case map[string]any:
		for _, child := range current {
			if containsDeepValue(child, want) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if containsDeepValue(child, want) {
				return true
			}
		}
	}
	return false
}

func containsString(value any, want string) bool {
	values, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range values {
		if item == want {
			return true
		}
	}
	return false
}

func headerValue(value any, pathOne, pathTwo, wantName string) string {
	headers, _ := deepValue(value, pathOne, pathTwo).(map[string]any)
	for name, raw := range headers {
		if strings.EqualFold(name, wantName) {
			values, _ := raw.([]any)
			if len(values) > 0 {
				result, _ := values[0].(string)
				return result
			}
		}
	}
	return ""
}

func parseIndex(value string, target *int) (err error) {
	if value == "" {
		return errors.New("empty index")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return errors.New("invalid index")
		}
		*target = *target*10 + int(char-'0')
	}
	return nil
}

type capturedRelayRequest struct {
	path      string
	rawQuery  string
	headers   http.Header
	websocket bool
}

func TestGatewayFixedRelayIntegration(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve relay port: %v", err)
	}
	relayPort := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release relay port: %v", err)
	}

	requests := make(chan capturedRelayRequest, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured := capturedRelayRequest{
			path:      r.URL.Path,
			rawQuery:  r.URL.RawQuery,
			headers:   r.Header.Clone(),
			websocket: websocket.IsWebSocketUpgrade(r),
		}
		requests <- captured
		if !captured.websocket {
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("gateway relay http ok"))
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.WriteMessage(messageType, payload)
	}))
	defer upstream.Close()

	global := GlobalConfig{
		Schema: GlobalSchemaVersion,
		Relay:  RelayConfig{ListenPort: relayPort},
		Log:    LogConfig{Level: "INFO"},
	}
	site := SiteConfig{
		Schema:    SiteSchemaVersion,
		Kind:      SiteRegistry,
		PublicURL: "http://workspace.example.com",
		WebRoot:   filepath.Join(t.TempDir(), "web"),
		Upstream:  upstream.URL,
	}
	compiled, err := CompileConfig(global, []SiteConfig{site})
	if err != nil {
		t.Fatalf("CompileConfig(): %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(): %v", err)
	}

	// The production Gateway also owns :80. Keep this boundary test isolated to
	// the generated fixed Relay server so it does not depend on host port 80.
	var document map[string]any
	if err := json.Unmarshal(compiled, &document); err != nil {
		t.Fatalf("unmarshal compiled config: %v", err)
	}
	servers := document["apps"].(map[string]any)["http"].(map[string]any)["servers"].(map[string]any)
	delete(servers, "http")
	compiled, err = json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal isolated relay config: %v", err)
	}
	if err := ValidateJSON(compiled); err != nil {
		t.Fatalf("ValidateJSON(isolated relay): %v", err)
	}
	var caddyConfig caddy.Config
	if err := json.Unmarshal(compiled, &caddyConfig); err != nil {
		t.Fatalf("unmarshal Caddy config: %v", err)
	}
	if err := caddy.Run(&caddyConfig); err != nil {
		t.Fatalf("start embedded Caddy: %v", err)
	}
	t.Cleanup(func() { _ = caddy.Stop() })

	client := &http.Client{Timeout: 5 * time.Second}
	httpURL := fmt.Sprintf("http://127.0.0.1:%d/relay/check?from=test&n=1", relayPort)
	httpRequest, err := http.NewRequest(http.MethodGet, httpURL, nil)
	if err != nil {
		t.Fatalf("new HTTP request: %v", err)
	}
	httpRequest.Host = "workspace.example.com"
	httpRequest.Header.Set("X-WheelMaker-Relay", "spoofed")
	httpResponse, err := client.Do(httpRequest)
	if err != nil {
		t.Fatalf("HTTP through fixed Relay: %v", err)
	}
	body, err := io.ReadAll(httpResponse.Body)
	_ = httpResponse.Body.Close()
	if err != nil {
		t.Fatalf("read HTTP body: %v", err)
	}
	if httpResponse.StatusCode != http.StatusOK {
		t.Fatalf("HTTP status=%d, want 200 body=%q headers=%v", httpResponse.StatusCode, body, httpResponse.Header)
	}
	if string(body) != "gateway relay http ok" {
		t.Fatalf("HTTP body=%q", body)
	}
	httpCaptured := <-requests
	if httpCaptured.path != "/relay/check" || httpCaptured.rawQuery != "from=test&n=1" {
		t.Fatalf("HTTP upstream path/query=%s?%s", httpCaptured.path, httpCaptured.rawQuery)
	}
	if got := httpCaptured.headers.Get("X-WheelMaker-Relay"); got != "1" {
		t.Fatalf("HTTP marker=%q, want 1 headers=%v", got, httpCaptured.headers)
	}
	if got := httpCaptured.headers.Get("X-Forwarded-Proto"); got != "http" {
		t.Fatalf("HTTP forwarded proto=%q, want http", got)
	}

	wsURL := fmt.Sprintf("ws://127.0.0.1:%d/ws?channel=echo", relayPort)
	wsHeaders := http.Header{}
	wsHeaders.Set("Host", "workspace.example.com")
	wsHeaders.Set("X-WheelMaker-Relay", "spoofed")
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, wsHeaders)
	if err != nil {
		t.Fatalf("WebSocket through fixed Relay: %v", err)
	}
	defer ws.Close()
	if err := ws.WriteMessage(websocket.TextMessage, []byte("hello relay")); err != nil {
		t.Fatalf("write WebSocket message: %v", err)
	}
	messageType, payload, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read WebSocket echo: %v", err)
	}
	if messageType != websocket.TextMessage || string(payload) != "hello relay" {
		t.Fatalf("WebSocket echo type=%d payload=%q", messageType, payload)
	}
	wsCaptured := <-requests
	if !wsCaptured.websocket || wsCaptured.path != "/ws" || wsCaptured.rawQuery != "channel=echo" {
		t.Fatalf("WebSocket upstream request=%+v", wsCaptured)
	}
	if got := wsCaptured.headers.Get("X-WheelMaker-Relay"); got != "1" {
		t.Fatalf("WebSocket marker=%q, want 1", got)
	}
	if got := wsCaptured.headers.Get("X-Forwarded-Proto"); got != "http" {
		t.Fatalf("WebSocket forwarded proto=%q, want http", got)
	}
}
