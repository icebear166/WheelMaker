package main

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

type recordingLauncher struct {
	url  string
	opts desktopWindowOptions
	err  error
}

func (r *recordingLauncher) Launch(url string, opts desktopWindowOptions) error {
	r.url = url
	r.opts = opts
	return r.err
}

func TestRunDesktopAppLaunchesStableLoopbackStorageOrigin(t *testing.T) {
	launcher := &recordingLauncher{}
	err := runDesktopApp(fstest.MapFS{
		"index.html": {Data: []byte("<html>desktop</html>")},
	}, launcher)

	if err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if launcher.url != "http://127.0.0.1:9632/" {
		t.Fatalf("url=%q should use stable desktop storage origin", launcher.url)
	}
}

func TestRunDesktopAppLaunchesWithCustomTitleBarAndIcon(t *testing.T) {
	launcher := &recordingLauncher{}
	err := runDesktopApp(fstest.MapFS{
		"index.html": {Data: []byte("<html>desktop</html>")},
	}, launcher)

	if err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if launcher.opts.Title != "WheelMaker - Embedded" {
		t.Fatalf("title=%q, want WheelMaker - Embedded", launcher.opts.Title)
	}
	if !launcher.opts.CustomTitleBar {
		t.Fatal("expected custom title bar to be enabled")
	}
	if launcher.opts.IconID != desktopResourceIconID {
		t.Fatalf("IconID=%d, want %d", launcher.opts.IconID, desktopResourceIconID)
	}
	if launcher.opts.ThemeColor != desktopTitleBarThemeColor {
		t.Fatalf("ThemeColor=%q, want %q", launcher.opts.ThemeColor, desktopTitleBarThemeColor)
	}
	if launcher.opts.RemoteDebugEnabled {
		t.Fatal("remote debug should be disabled by default")
	}
}

func TestDesktopWindowOptionsUseRemoteDebugConfig(t *testing.T) {
	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
		RemoteDebugEnabled:  true,
	}}, nil)

	opts := desktopWindowOptionsForWebSource(runtime)

	if !opts.RemoteDebugEnabled {
		t.Fatal("expected remote debug launch option to be enabled")
	}
	if opts.RemoteDebugPort != desktopRemoteDebugPort {
		t.Fatalf("RemoteDebugPort=%d, want %d", opts.RemoteDebugPort, desktopRemoteDebugPort)
	}
}

func TestRunDesktopAppReturnsActionableWebViewError(t *testing.T) {
	launcher := &recordingLauncher{err: errWebView2Unavailable}
	err := runDesktopApp(fstest.MapFS{
		"index.html": {Data: []byte("<html>desktop</html>")},
	}, launcher)

	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "Microsoft Edge WebView2 Runtime") {
		t.Fatalf("error=%q should mention WebView2 runtime", err.Error())
	}
}

func TestRunDesktopAppReportsMissingIndex(t *testing.T) {
	launcher := &recordingLauncher{}
	err := runDesktopApp(fstest.MapFS{}, launcher)

	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("error=%v should wrap fs.ErrNotExist", err)
	}
}

func TestDesktopRuntimeInitScriptExposesWindowBridge(t *testing.T) {
	script := desktopRuntimeInitScript()

	for _, want := range []string{
		"window.WheelMakerDesktop",
		"enabled: true",
		desktopStartDragBinding,
		desktopMinimizeBinding,
		desktopToggleMaximizeBinding,
		desktopCloseBinding,
		desktopGetWebSourceBinding,
		desktopSetWebSourceBinding,
		desktopSetRemoteWebBinding,
		desktopSetRemoteDebugBinding,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("desktop runtime init script missing %q: %s", want, script)
		}
	}
}

func TestDesktopAssetHandlerServesRootIndex(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html": {Data: []byte("<html>WheelMaker</html>")},
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), "WheelMaker") {
		t.Fatalf("body=%q should include index content", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("Content-Type=%q should be text/html", got)
	}
}

func TestDesktopAssetHandlerServesStaticAsset(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html": {Data: []byte("<html></html>")},
		"bundle.js":  {Data: []byte("console.log('wm')")},
	})

	req := httptest.NewRequest(http.MethodGet, "/bundle.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); got != "console.log('wm')" {
		t.Fatalf("body=%q", got)
	}
}

func TestDesktopAssetHandlerSetsFreshWebCacheHeaders(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html":              {Data: []byte("<html></html>")},
		"service-worker.js":       {Data: []byte("self.addEventListener('install', () => {})")},
		"manifest.webmanifest":    {Data: []byte(`{"name":"real manifest"}`)},
		"bundle.abc123.js":        {Data: []byte("console.log('wm')")},
		"font.abc123.woff2":       {Data: []byte("font")},
		"codicon.abc123.ttf":      {Data: []byte("font")},
		"legacy.abc123.eot":       {Data: []byte("font")},
		"unexpected.abc123.asset": {Data: []byte("asset")},
	})

	tests := []struct {
		path string
		want string
	}{
		{path: "/", want: "no-cache, must-revalidate"},
		{path: "/index.html", want: "no-cache, must-revalidate"},
		{path: "/service-worker.js", want: "no-store"},
		{path: "/manifest.webmanifest", want: "no-store"},
		{path: "/bundle.abc123.js", want: "public, max-age=31536000, immutable"},
		{path: "/font.abc123.woff2", want: "public, max-age=31536000, immutable"},
		{path: "/codicon.abc123.ttf", want: "public, max-age=31536000, immutable"},
		{path: "/legacy.abc123.eot", want: "public, max-age=31536000, immutable"},
		{path: "/unexpected.abc123.asset", want: "public, max-age=31536000, immutable"},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != tt.want {
			t.Fatalf("%s Cache-Control=%q want %q", tt.path, got, tt.want)
		}
	}
}

func TestDesktopAssetHandlerServesNativeShellPWAStubs(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html":           {Data: []byte("<html></html>")},
		"service-worker.js":    {Data: []byte("self.addEventListener('install', () => {})")},
		"manifest.webmanifest": {Data: []byte(`{"name":"real manifest"}`)},
	})

	tests := []struct {
		path        string
		contentType string
		body        string
	}{
		{path: "/service-worker.js", contentType: "application/javascript", body: "disabled"},
		{path: "/manifest.webmanifest", contentType: "application/manifest+json", body: `"icons":[]`},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d want %d", tt.path, rec.Code, http.StatusOK)
		}
		if got := rec.Header().Get("Content-Type"); got != tt.contentType {
			t.Fatalf("%s Content-Type=%q want %q", tt.path, got, tt.contentType)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s Cache-Control=%q want no-store", tt.path, got)
		}
		if got := rec.Body.String(); !strings.Contains(got, tt.body) {
			t.Fatalf("%s body=%q should contain %q", tt.path, got, tt.body)
		}
	}
}

func TestDesktopAssetHandlerFallsBackToIndexForWorkspaceRoute(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html": {Data: []byte("<html>shell</html>")},
	})

	req := httptest.NewRequest(http.MethodGet, "/settings/skills", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); !strings.Contains(got, "shell") {
		t.Fatalf("body=%q should be index fallback", got)
	}
}

func TestDesktopAssetHandlerDoesNotFallbackForMissingFileAsset(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html": {Data: []byte("<html>shell</html>")},
	})

	req := httptest.NewRequest(http.MethodGet, "/missing.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want %d", rec.Code, http.StatusNotFound)
	}
}

func TestDesktopAssetHandlerDoesNotFallbackForRegistryWebSocketPath(t *testing.T) {
	handler := newDesktopAssetHandler(fstest.MapFS{
		"index.html": {Data: []byte("<html>shell</html>")},
	})

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want %d", rec.Code, http.StatusNotFound)
	}
}

func TestStartDesktopAssetServerUsesLoopback(t *testing.T) {
	srv, err := startDesktopAssetServer(fstest.MapFS{
		"index.html": {Data: []byte("<html>loopback</html>")},
	})
	if err != nil {
		t.Fatalf("startDesktopAssetServer: %v", err)
	}
	defer srv.Close()

	resp, err := http.Get(srv.URL())
	if err != nil {
		t.Fatalf("GET server root: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d want %d", resp.StatusCode, http.StatusOK)
	}
	if !strings.Contains(string(body), "loopback") {
		t.Fatalf("body=%q should include embedded index", string(body))
	}
	if srv.URL() != "http://127.0.0.1:9632/" {
		t.Fatalf("url=%q should use stable desktop storage origin", srv.URL())
	}
}

type memoryDesktopWebSourceConfigStore struct {
	config desktopWebSourceConfig
	saved  desktopWebSourceConfig
}

func (s *memoryDesktopWebSourceConfigStore) Load() (desktopWebSourceConfig, error) {
	return s.config, nil
}

func (s *memoryDesktopWebSourceConfigStore) Save(config desktopWebSourceConfig) error {
	s.saved = config
	s.config = config
	return nil
}

func TestDesktopWebSourceCandidateReplacesRemoteForSecureRegistry(t *testing.T) {
	store := &memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference:     desktopWebSourcePreferenceAuto,
		RemoteWebURL:            "https://old.example.com/",
		RemoteWebRegistryOrigin: "wss://old.example.com",
	}}
	runtime := newDesktopWebSourceRuntime(store, nil)
	runtime.SetActualSource(desktopWebSourceActualEmbedded)

	state, err := runtime.SetRemoteCandidate(desktopRemoteWebCandidate{
		RegistryAddress: "wss://new.example.com/ws",
		RemoteWebURL:    "https://new.example.com/",
	})
	if err != nil {
		t.Fatalf("SetRemoteCandidate: %v", err)
	}

	if store.saved.RemoteWebURL != "https://new.example.com/" {
		t.Fatalf("RemoteWebURL=%q", store.saved.RemoteWebURL)
	}
	if store.saved.RemoteWebRegistryOrigin != "wss://new.example.com" {
		t.Fatalf("RemoteWebRegistryOrigin=%q", store.saved.RemoteWebRegistryOrigin)
	}
	if state.RemoteHost != "new.example.com" {
		t.Fatalf("RemoteHost=%q", state.RemoteHost)
	}
	if state.ActualSource != desktopWebSourceActualEmbedded {
		t.Fatalf("ActualSource=%q should not change current window source", state.ActualSource)
	}
}

func TestDesktopWebSourceCandidateAcceptsPublicPlainHTTPRegistry(t *testing.T) {
	store := &memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}
	runtime := newDesktopWebSourceRuntime(store, nil)

	state, err := runtime.SetRemoteCandidate(desktopRemoteWebCandidate{
		RegistryAddress: "ws://47.86.63.26:28800/ws",
		RemoteWebURL:    "http://47.86.63.26:28800/",
	})
	if err != nil {
		t.Fatalf("SetRemoteCandidate: %v", err)
	}

	if store.saved.RemoteWebURL != "http://47.86.63.26:28800/" {
		t.Fatalf("RemoteWebURL=%q", store.saved.RemoteWebURL)
	}
	if store.saved.RemoteWebRegistryOrigin != "ws://47.86.63.26:28800" {
		t.Fatalf("RemoteWebRegistryOrigin=%q", store.saved.RemoteWebRegistryOrigin)
	}
	if state.RemoteHost != "47.86.63.26:28800" {
		t.Fatalf("RemoteHost=%q", state.RemoteHost)
	}
}

func TestDesktopAssetHandlerDoesNotUseNewRemoteCandidateUntilActualSourceChanges(t *testing.T) {
	remoteHits := 0
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remoteHits++
		_, _ = io.WriteString(w, "console.log('remote')")
	}))
	defer remote.Close()

	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}, remote.Client())
	runtime.mu.Lock()
	runtime.config.RemoteWebURL = remote.URL + "/"
	runtime.actual = desktopWebSourceActualEmbedded
	runtime.actualRemoteURL = ""
	runtime.mu.Unlock()

	handler := newDesktopAssetHandlerWithWebSource(fstest.MapFS{
		"index.html": {Data: []byte("<html>embedded</html>")},
		"bundle.js":  {Data: []byte("console.log('embedded')")},
	}, runtime)

	req := httptest.NewRequest(http.MethodGet, "/bundle.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Body.String(); got != "console.log('embedded')" {
		t.Fatalf("body=%q", got)
	}
	if remoteHits != 0 {
		t.Fatalf("remoteHits=%d, want 0", remoteHits)
	}
}

func TestDesktopWebSourceCandidateClearsRemoteForLocalRegistry(t *testing.T) {
	store := &memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference:     desktopWebSourcePreferenceAuto,
		RemoteWebURL:            "https://old.example.com/",
		RemoteWebRegistryOrigin: "wss://old.example.com",
	}}
	runtime := newDesktopWebSourceRuntime(store, nil)
	runtime.SetActualSource(desktopWebSourceActualEmbedded)

	state, err := runtime.SetRemoteCandidate(desktopRemoteWebCandidate{
		RegistryAddress: "ws://127.0.0.1:9630/ws",
		RemoteWebURL:    "",
	})
	if err != nil {
		t.Fatalf("SetRemoteCandidate: %v", err)
	}

	if store.saved.RemoteWebURL != "" {
		t.Fatalf("RemoteWebURL=%q, want cleared", store.saved.RemoteWebURL)
	}
	if store.saved.RemoteWebRegistryOrigin != "" {
		t.Fatalf("RemoteWebRegistryOrigin=%q, want cleared", store.saved.RemoteWebRegistryOrigin)
	}
	if state.ActualSource != desktopWebSourceActualEmbedded {
		t.Fatalf("ActualSource=%q", state.ActualSource)
	}
}

func TestDesktopWebSourcePreferencePersistsWithoutClearingRemoteURL(t *testing.T) {
	store := &memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference:     desktopWebSourcePreferenceAuto,
		RemoteWebURL:            "https://remote.example.com/",
		RemoteWebRegistryOrigin: "wss://remote.example.com",
	}}
	runtime := newDesktopWebSourceRuntime(store, nil)

	state, err := runtime.SetPreference(desktopWebSourcePreferenceEmbedded)
	if err != nil {
		t.Fatalf("SetPreference: %v", err)
	}

	if store.saved.WebSourcePreference != desktopWebSourcePreferenceEmbedded {
		t.Fatalf("WebSourcePreference=%q", store.saved.WebSourcePreference)
	}
	if store.saved.RemoteWebURL != "https://remote.example.com/" {
		t.Fatalf("RemoteWebURL=%q should be retained", store.saved.RemoteWebURL)
	}
	if state.Preference != desktopWebSourcePreferenceEmbedded {
		t.Fatalf("Preference=%q", state.Preference)
	}
	if state.ActualSource != desktopWebSourceActualEmbedded {
		t.Fatalf("ActualSource=%q", state.ActualSource)
	}
}

func TestDesktopRemoteDebugSettingPersistsAndReturnsStatus(t *testing.T) {
	store := &memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}
	runtime := newDesktopWebSourceRuntime(store, nil)

	state, err := runtime.SetRemoteDebugEnabled(true)
	if err != nil {
		t.Fatalf("SetRemoteDebugEnabled: %v", err)
	}

	if !store.saved.RemoteDebugEnabled {
		t.Fatal("RemoteDebugEnabled should be persisted")
	}
	if !state.RemoteDebugEnabled {
		t.Fatal("RemoteDebugEnabled should be reflected in state")
	}
	if state.RemoteDebugPort != desktopRemoteDebugPort {
		t.Fatalf("RemoteDebugPort=%d, want %d", state.RemoteDebugPort, desktopRemoteDebugPort)
	}
	if state.RemoteDebugURL != "http://127.0.0.1:9222/" {
		t.Fatalf("RemoteDebugURL=%q", state.RemoteDebugURL)
	}
}

func TestDesktopWebSourceRefreshActualSourceUsesEmbeddedWhenRemoteFails(t *testing.T) {
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "remote down", http.StatusInternalServerError)
	}))
	defer remote.Close()

	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}, remote.Client())
	runtime.mu.Lock()
	runtime.config.WebSourcePreference = desktopWebSourcePreferenceAuto
	runtime.config.RemoteWebURL = remote.URL + "/"
	runtime.actual = desktopWebSourceActualRemote
	runtime.actualRemoteURL = remote.URL + "/"
	runtime.mu.Unlock()

	state := runtime.RefreshActualSource()

	if state.ActualSource != desktopWebSourceActualEmbedded {
		t.Fatalf("ActualSource=%q", state.ActualSource)
	}
	if state.DisplayTitle != "WheelMaker - Embedded" {
		t.Fatalf("DisplayTitle=%q", state.DisplayTitle)
	}
}

func TestDesktopAssetHandlerPrefersRemoteAndFallsBackToEmbedded(t *testing.T) {
	remoteFails := false
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if remoteFails {
			http.Error(w, "remote down", http.StatusInternalServerError)
			return
		}
		if r.URL.Path == "/bundle.js" {
			w.Header().Set("Content-Type", "application/javascript")
			_, _ = io.WriteString(w, "console.log('remote')")
			return
		}
		http.NotFound(w, r)
	}))
	defer remote.Close()

	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
		RemoteWebURL:        remote.URL + "/",
	}}, remote.Client())
	runtime.mu.Lock()
	runtime.config.WebSourcePreference = desktopWebSourcePreferenceAuto
	runtime.config.RemoteWebURL = remote.URL + "/"
	runtime.actual = desktopWebSourceActualRemote
	runtime.actualRemoteURL = remote.URL + "/"
	runtime.mu.Unlock()
	handler := newDesktopAssetHandlerWithWebSource(fstest.MapFS{
		"index.html": {Data: []byte("<html>embedded</html>")},
		"bundle.js":  {Data: []byte("console.log('embedded')")},
	}, runtime)

	req := httptest.NewRequest(http.MethodGet, "/bundle.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Body.String(); got != "console.log('remote')" {
		t.Fatalf("remote body=%q", got)
	}
	if runtime.State().ActualSource != desktopWebSourceActualRemote {
		t.Fatalf("ActualSource=%q", runtime.State().ActualSource)
	}

	remoteFails = true
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Body.String(); !strings.Contains(got, "embedded") {
		t.Fatalf("fallback body=%q", got)
	}
	if runtime.State().ActualSource != desktopWebSourceActualEmbedded {
		t.Fatalf("ActualSource=%q", runtime.State().ActualSource)
	}
}

func TestDesktopAssetHandlerRemoteResponsesUseClientFreshnessHeaders(t *testing.T) {
	var pwaAssetRemoteRequests int
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/index.html":
			w.Header().Set("Cache-Control", "public, max-age=31536000")
			_, _ = io.WriteString(w, "<html>remote shell</html>")
		case "/service-worker.js", "/manifest.webmanifest":
			pwaAssetRemoteRequests++
			http.Error(w, "native shell should not request this asset", http.StatusInternalServerError)
		case "/bundle.abc123.js", "/bundle.abc123.css", "/font.abc123.woff2", "/codicon.abc123.ttf", "/logo.svg", "/misc.txt":
			w.Header().Set("Cache-Control", "no-store")
			_, _ = io.WriteString(w, "remote asset")
		default:
			http.NotFound(w, r)
		}
	}))
	defer remote.Close()

	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}, remote.Client())
	runtime.mu.Lock()
	runtime.config.WebSourcePreference = desktopWebSourcePreferenceAuto
	runtime.config.RemoteWebURL = remote.URL + "/"
	runtime.actual = desktopWebSourceActualRemote
	runtime.actualRemoteURL = remote.URL + "/"
	runtime.mu.Unlock()
	handler := newDesktopAssetHandlerWithWebSource(fstest.MapFS{
		"index.html": {Data: []byte("<html>embedded</html>")},
	}, runtime)

	tests := []struct {
		path       string
		cache      string
		wantPragma bool
	}{
		{path: "/", cache: "no-cache, must-revalidate", wantPragma: true},
		{path: "/index.html", cache: "no-cache, must-revalidate", wantPragma: true},
		{path: "/service-worker.js", cache: "no-store", wantPragma: true},
		{path: "/manifest.webmanifest", cache: "no-store", wantPragma: true},
		{path: "/bundle.abc123.js", cache: "public, max-age=31536000, immutable"},
		{path: "/bundle.abc123.css", cache: "public, max-age=31536000, immutable"},
		{path: "/font.abc123.woff2", cache: "public, max-age=31536000, immutable"},
		{path: "/codicon.abc123.ttf", cache: "public, max-age=31536000, immutable"},
		{path: "/logo.svg", cache: "public, max-age=31536000, immutable"},
		{path: "/misc.txt", cache: "public, max-age=31536000, immutable"},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != tt.cache {
			t.Fatalf("%s Cache-Control=%q want %q", tt.path, got, tt.cache)
		}
		if tt.wantPragma {
			if got := rec.Header().Get("Pragma"); got != "no-cache" {
				t.Fatalf("%s Pragma=%q want no-cache", tt.path, got)
			}
			if got := rec.Header().Get("Expires"); got != "0" {
				t.Fatalf("%s Expires=%q want 0", tt.path, got)
			}
		}
	}
	if pwaAssetRemoteRequests != 0 {
		t.Fatalf("native shell PWA assets reached remote server %d times", pwaAssetRemoteRequests)
	}
}

func TestDesktopAssetHandlerFallsBackToRemoteIndexForWorkspaceRoute(t *testing.T) {
	remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/index.html" || r.URL.Path == "/" {
			_, _ = io.WriteString(w, "<html>remote shell</html>")
			return
		}
		http.NotFound(w, r)
	}))
	defer remote.Close()

	runtime := newDesktopWebSourceRuntime(&memoryDesktopWebSourceConfigStore{config: desktopWebSourceConfig{
		WebSourcePreference: desktopWebSourcePreferenceAuto,
	}}, remote.Client())
	runtime.mu.Lock()
	runtime.config.WebSourcePreference = desktopWebSourcePreferenceAuto
	runtime.config.RemoteWebURL = remote.URL + "/"
	runtime.actual = desktopWebSourceActualRemote
	runtime.actualRemoteURL = remote.URL + "/"
	runtime.mu.Unlock()
	handler := newDesktopAssetHandlerWithWebSource(fstest.MapFS{
		"index.html": {Data: []byte("<html>embedded shell</html>")},
	}, runtime)

	req := httptest.NewRequest(http.MethodGet, "/settings/update", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Body.String(); !strings.Contains(got, "remote shell") {
		t.Fatalf("body=%q should use remote shell fallback", got)
	}
}
