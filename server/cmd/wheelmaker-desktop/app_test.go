package main

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestBootstrapAssetIsMinimalAndSelfContained(t *testing.T) {
	body, err := os.ReadFile("bootstrap/index.html")
	if err != nil {
		t.Fatalf("read bootstrap asset: %v", err)
	}
	if len(body) > 24*1024 {
		t.Fatalf("bootstrap size=%d, want at most 24 KiB", len(body))
	}

	html := string(body)
	for _, want := range []string{
		`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
		`runBootstrapAction('bootstrap.getState')`,
		`runBootstrapAction('bootstrap.saveBaseUrl', {baseUrl: input.value}, save)`,
		`runBootstrapAction('bootstrap.retry', {}, retry)`,
		`runBootstrapAction('bootstrap.reset', {}, reset)`,
		`id="titlebar"`,
		`id="minimize"`,
		`id="maximize"`,
		`id="close"`,
		`callWindow('startDrag')`,
		`callWindow('minimize')`,
		`callWindow('toggleMaximize')`,
		`callWindow('close')`,
		`const BRIDGE_TIMEOUT_MS = 30_000;`,
		`crypto.randomUUID?.() ||`,
		`const timeout = window.setTimeout(() => {`,
		`pending.delete(requestId);`,
		`bridge.postMessage(JSON.stringify({requestId, action, payload}))`,
		`finally {`,
		`type="text"`,
		`id="error"`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("bootstrap missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"Registry Token",
		"localStorage",
		"serviceWorker",
		"<script src=",
		"speech",
		"notification",
		"share",
		"update",
		"userGestureAt",
	} {
		if strings.Contains(html, forbidden) {
			t.Errorf("bootstrap contains forbidden capability %q", forbidden)
		}
	}
}

func TestBootstrapOnlyShowsWindowControlsForDesktopBridge(t *testing.T) {
	body, err := os.ReadFile("bootstrap/index.html")
	if err != nil {
		t.Fatalf("read bootstrap asset: %v", err)
	}
	html := string(body)
	for _, want := range []string{
		`id="window-controls" class="window-controls" hidden`,
		`const hasDesktopWindowControls = typeof window.wheelMakerBootstrap?.startDrag === 'function';`,
		`windowControls.hidden = !hasDesktopWindowControls;`,
		`const titlebar = document.getElementById('titlebar');`,
		`document.body.classList.toggle('android-bootstrap', !hasDesktopWindowControls);`,
		`titlebar.hidden = !hasDesktopWindowControls;`,
		`if (!hasDesktopWindowControls) return;`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("bootstrap missing desktop-only window control guard %q", want)
		}
	}
}

func TestDesktopBaseURLContract(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "domain without scheme", raw: "example.com", want: "https://example.com/"},
		{name: "domain", raw: "https://example.com", want: "https://example.com/"},
		{name: "ip", raw: "https://192.0.2.10", want: "https://192.0.2.10/"},
		{name: "port and subpath", raw: "https://example.com:8443/wheelmaker", want: "https://example.com:8443/wheelmaker/"},
		{name: "encoded path", raw: "https://example.com/a%20b", want: "https://example.com/a%20b/"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeDesktopBaseURL(tt.raw)
			if err != nil {
				t.Fatalf("normalizeDesktopBaseURL(%q): %v", tt.raw, err)
			}
			if got != tt.want {
				t.Fatalf("normalizeDesktopBaseURL(%q)=%q, want %q", tt.raw, got, tt.want)
			}
		})
	}

	for _, raw := range []string{
		"",
		"http://example.com/",
		"https://user@example.com/",
		"https://example.com/?token=secret",
		"https://example.com/#fragment",
		"javascript:alert(1)",
		"file:///tmp/index.html",
	} {
		t.Run("reject_"+raw, func(t *testing.T) {
			if got, err := normalizeDesktopBaseURL(raw); err == nil {
				t.Fatalf("normalizeDesktopBaseURL(%q)=%q, want rejection", raw, got)
			}
		})
	}
}

func TestDesktopUsesCustomTitleBar(t *testing.T) {
	if !defaultDesktopWindowOptions().CustomTitleBar {
		t.Fatal("desktop window must use the custom title bar")
	}
}

type recordingLauncher struct {
	target desktopLaunchTarget
	opts   desktopWindowOptions
	err    error
}

func (r *recordingLauncher) Launch(target desktopLaunchTarget, opts desktopWindowOptions) error {
	r.target = target
	r.opts = opts
	return r.err
}

type memoryDesktopConfigStore struct {
	config desktopConfig
	err    error
}

func (s *memoryDesktopConfigStore) Load() (desktopConfig, error) { return s.config, s.err }
func (s *memoryDesktopConfigStore) Save(config desktopConfig) error {
	s.config = config
	return s.err
}

type recordingDesktopProber struct {
	url string
	err error
}

func (p *recordingDesktopProber) Probe(_ context.Context, baseURL string) error {
	p.url = baseURL
	return p.err
}

func TestDesktopBootstrapLaunchWithoutConfig(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{}
	err := runDesktopApp(context.Background(), launcher, &memoryDesktopConfigStore{}, prober)
	if err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if launcher.target.HTML != desktopBootstrapHTML || launcher.target.URL != "" {
		t.Fatalf("target=%+v, want embedded Bootstrap HTML", launcher.target)
	}
	if prober.url != "" {
		t.Fatalf("unexpected probe for empty configuration: %q", prober.url)
	}
	if launcher.opts.BootstrapState.BaseURL != "" || launcher.opts.BootstrapState.Error != "" {
		t.Fatalf("bootstrap state=%+v", launcher.opts.BootstrapState)
	}
}

func TestDesktopLocalDevLaunchUsesFixedLoopbackWithoutProbing(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{}
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/"}}

	if err := runDesktopAppWithMode(context.Background(), launcher, store, prober, true); err != nil {
		t.Fatalf("runDesktopAppWithMode: %v", err)
	}
	if launcher.target.URL != desktopLocalDevURL || launcher.target.HTML != "" {
		t.Fatalf("target=%+v, want fixed Local Dev URL", launcher.target)
	}
	if prober.url != "" {
		t.Fatalf("local Dev launch unexpectedly probed %q", prober.url)
	}
	if launcher.opts.Runtime.security.Mode() != desktopTrustedLocalDevPage {
		t.Fatalf("mode=%v, want local Dev mode", launcher.opts.Runtime.security.Mode())
	}
}

func TestDesktopBootstrapInitScriptRecognizesEmbeddedDocument(t *testing.T) {
	script := desktopRuntimeInitScript()
	if !strings.Contains(script, desktopBootstrapDocumentURL()) {
		t.Fatal("desktop init script does not recognize the embedded bootstrap document URL")
	}
	if !strings.Contains(script, "window.wheelMakerBootstrap") {
		t.Fatal("desktop init script does not expose the bootstrap bridge")
	}
}

func TestDesktopInitScriptInjectsLaunchOverlayOnAppPages(t *testing.T) {
	script := desktopRuntimeInitScript()
	if !strings.Contains(script, "wm-launch-overlay") {
		t.Fatal("desktop init script does not inject the launch overlay")
	}
	if !strings.Contains(script, "location.protocol !== 'https:'") {
		t.Fatal("launch overlay must stay inert outside https app pages")
	}
	if !strings.Contains(script, "#root") {
		t.Fatal("launch overlay must dismiss when the app mounts content")
	}
}

func TestDesktopSavedServerLaunchesWithoutPreflightProbe(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{err: errors.New("probe should not run")}
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/app"}}

	if err := runDesktopApp(context.Background(), launcher, store, prober); err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if prober.url != "" {
		t.Fatalf("saved server was preflight-probed: %q", prober.url)
	}
	if launcher.target.URL != "https://example.com/app/" || launcher.target.HTML != "" {
		t.Fatalf("target=%+v, want direct remote URL", launcher.target)
	}
	if store.config.BaseURL != "https://example.com/app/" {
		t.Fatalf("stored base URL=%q, want normalized value", store.config.BaseURL)
	}
}

func TestDesktopBootstrapSaveProbeFailureShowsError(t *testing.T) {
	prober := &recordingDesktopProber{err: errors.New("certificate is not trusted")}
	store := &memoryDesktopConfigStore{}
	security, err := newDesktopWebViewSecurityState("", desktopBootstrapPage)
	if err != nil {
		t.Fatal(err)
	}
	runtime := newDesktopRuntime(store, prober, desktopConfig{}, desktopBootstrapState{}, security)
	surface := &recordingDesktopRuntimeSurface{}
	runtime.AttachSurface(surface)

	result := runtime.SaveBaseURL(context.Background(), "https://example.com/app/")

	if result.OK || !strings.Contains(result.Error, "certificate is not trusted") {
		t.Fatalf("result=%+v", result)
	}
	if prober.url != "https://example.com/app/" {
		t.Fatalf("probe URL=%q", prober.url)
	}
	if store.config.BaseURL != "" || surface.navigatedURL != "" {
		t.Fatalf("store=%q navigation=%q", store.config.BaseURL, surface.navigatedURL)
	}
}

func TestDesktopRemoteProbeRejectsBadStatusAndUntrustedCertificate(t *testing.T) {
	notFound := httptest.NewTLSServer(http.NotFoundHandler())
	defer notFound.Close()
	trustedTestClient := notFound.Client()
	trustedTestClient.Timeout = 3 * time.Second
	if err := (&httpDesktopBaseURLProber{client: trustedTestClient}).Probe(context.Background(), notFound.URL+"/"); err == nil {
		t.Fatal("expected non-2xx/3xx status rejection")
	}

	untrusted := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer untrusted.Close()
	if err := newDefaultDesktopBaseURLProber().Probe(context.Background(), untrusted.URL+"/"); err == nil {
		t.Fatal("expected system trust validation to reject the test certificate")
	}
}

func TestDesktopBaseURLProbeClientPolicy(t *testing.T) {
	client := newDesktopProbeHTTPClient()
	if client.Timeout != 3*time.Second {
		t.Fatalf("timeout=%s, want 3s", client.Timeout)
	}

	request, err := http.NewRequest(http.MethodGet, "https://example.com/app/", nil)
	if err != nil {
		t.Fatal(err)
	}
	for hop, target := range []string{
		"https://example.com/next/",
		"http://example.com/downgrade/",
		"https://example.com/too-many/",
	} {
		next, err := http.NewRequest(http.MethodGet, target, nil)
		if err != nil {
			t.Fatal(err)
		}
		via := make([]*http.Request, hop)
		for index := range via {
			via[index] = request
		}
		err = client.CheckRedirect(next, via)
		switch hop {
		case 0:
			if err != nil {
				t.Fatalf("HTTPS redirect rejected: %v", err)
			}
		case 1:
			if err == nil {
				t.Fatal("HTTP downgrade redirect was accepted")
			}
		case 2:
			// Replace the synthetic redirect history with five completed hops.
			via = make([]*http.Request, 6)
			for index := range via {
				via[index] = request
			}
			if err := client.CheckRedirect(next, via); err == nil {
				t.Fatal("sixth redirect was accepted")
			}
		}
	}
}

func TestDesktopConfigStoreUsesPrivateAtomicBaseURLFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".wheelmaker", "desktop", "config.json")
	store := newFileDesktopConfigStore(path)
	want := desktopConfig{BaseURL: "https://example.com/app/"}
	if err := store.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(raw) != "{\"baseUrl\":\"https://example.com/app/\"}\n" {
		t.Fatalf("config=%q, want only baseUrl", raw)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != want {
		t.Fatalf("Load=%+v, want %+v", got, want)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("config mode=%#o, want 0600", info.Mode().Perm())
		}
	}
}

func TestDesktopConfigMissingFileLoadsEmpty(t *testing.T) {
	store := newFileDesktopConfigStore(filepath.Join(t.TempDir(), "missing", "config.json"))
	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != (desktopConfig{}) {
		t.Fatalf("Load=%+v, want empty config", got)
	}
}

func TestDesktopNoAssetServerSource(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var source strings.Builder
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		body, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		source.Write(body)
	}
	for _, forbidden := range []string{
		"ListenAndServe",
		":9632",
		"webSourcePreference",
		"RemoteWebURL",
	} {
		if strings.Contains(source.String(), forbidden) {
			t.Errorf("desktop production source still contains %q", forbidden)
		}
	}
	for _, removed := range []string{"assets.go", "server.go", "web_source.go"} {
		if _, err := os.Stat(removed); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("legacy source %s still exists", removed)
		}
	}
}

func TestDesktopBootstrapLaunchReturnsActionableWebViewError(t *testing.T) {
	launcher := &recordingLauncher{err: errWebView2Unavailable}
	err := runDesktopApp(context.Background(), launcher, &memoryDesktopConfigStore{}, &recordingDesktopProber{})
	if err == nil || !strings.Contains(err.Error(), "Microsoft Edge WebView2 Runtime") {
		t.Fatalf("error=%v should mention WebView2 runtime", err)
	}
}
