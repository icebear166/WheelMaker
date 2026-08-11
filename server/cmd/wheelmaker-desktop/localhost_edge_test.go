package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/registry"
)

func TestDesktopLocalhostStatePersistsPrivateBasePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".wheelmaker", "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)

	first, err := store.LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate first: %v", err)
	}
	if !validDesktopLocalhostBasePath(first.BasePath) {
		t.Fatalf("generated Base Path is invalid: %q", first.BasePath)
	}
	if first.SessionCookie != "" || !first.SessionExpiresAt.IsZero() {
		t.Fatalf("new state unexpectedly has a session: %+v", first)
	}

	restarted, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate()
	if err != nil {
		t.Fatalf("LoadOrCreate restart: %v", err)
	}
	if restarted.BasePath != first.BasePath {
		t.Fatalf("restart Base Path=%q, want %q", restarted.BasePath, first.BasePath)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("state mode=%#o, want 0600", info.Mode().Perm())
		}
	}
}

func TestDesktopLocalhostCredentialLifecycle(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "desktop", "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{
		Name:     desktopRegistrySessionCookieName,
		Value:    strings.Repeat("A", 43),
		Path:     state.BasePath,
		Expires:  now.Add(24 * time.Hour),
		MaxAge:   int((24 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
	if err := store.SaveSession(cookie); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != cookie.Value || !restored.SessionExpiresAt.Equal(cookie.Expires) {
		t.Fatalf("restored state=%+v", restored)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"registry-token", "csrf-secret", desktopRegistrySessionCookieName} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("state file contains forbidden value %q", forbidden)
		}
	}

	if err := store.ClearSession(); err != nil {
		t.Fatalf("ClearSession: %v", err)
	}
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.BasePath != state.BasePath || cleared.SessionCookie != "" || !cleared.SessionExpiresAt.IsZero() {
		t.Fatalf("cleared state=%+v", cleared)
	}

	if err := store.Delete(); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("state file still exists: %v", err)
	}
}

func TestDesktopLocalhostStateDropsExpiredSession(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("B", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)

	restored, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if restored.BasePath != state.BasePath || restored.SessionCookie != "" || !restored.SessionExpiresAt.IsZero() {
		t.Fatalf("expired session did not fail closed: %+v", restored)
	}
}

func TestDesktopLocalhostStateRejectsCorruptFiles(t *testing.T) {
	validBasePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	tests := []struct {
		name string
		raw  string
	}{
		{name: "malformed JSON", raw: "{"},
		{name: "unknown field", raw: `{"version":1,"basePath":"` + validBasePath + `","extra":true}`},
		{name: "wrong version", raw: `{"version":2,"basePath":"` + validBasePath + `"}`},
		{name: "unsafe Base Path", raw: `{"version":1,"basePath":"/../secret/"}`},
		{name: "partial session", raw: `{"version":1,"basePath":"` + validBasePath + `","sessionCookie":"` + strings.Repeat("A", 43) + `"}`},
		{name: "oversized", raw: strings.Repeat("x", desktopLocalhostStateMaxBytes+1)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "localhost-state.json")
			if err := os.WriteFile(path, []byte(tt.raw), 0o600); err != nil {
				t.Fatal(err)
			}
			if state, err := newFileDesktopLocalhostStateStore(path).LoadOrCreate(); err == nil {
				t.Fatalf("LoadOrCreate=%+v, want corrupt state rejection", state)
			}
		})
	}
}

func TestDesktopLocalhostCredentialRejectsInvalidCookies(t *testing.T) {
	now := time.Date(2026, time.August, 12, 8, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "localhost-state.json")
	store := newFileDesktopLocalhostStateStore(path)
	store.now = func() time.Time { return now }
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	valid := http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("C", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}
	tests := []struct {
		name   string
		mutate func(*http.Cookie)
	}{
		{name: "wrong name", mutate: func(cookie *http.Cookie) { cookie.Name = "other" }},
		{name: "wrong path", mutate: func(cookie *http.Cookie) { cookie.Path = "/" }},
		{name: "not secure", mutate: func(cookie *http.Cookie) { cookie.Secure = false }},
		{name: "not HTTP only", mutate: func(cookie *http.Cookie) { cookie.HttpOnly = false }},
		{name: "wrong SameSite", mutate: func(cookie *http.Cookie) { cookie.SameSite = http.SameSiteLaxMode }},
		{name: "deleted", mutate: func(cookie *http.Cookie) { cookie.MaxAge = -1 }},
		{name: "expired", mutate: func(cookie *http.Cookie) { cookie.Expires = now }},
		{name: "invalid value", mutate: func(cookie *http.Cookie) { cookie.Value = "bad\nvalue" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cookie := valid
			tt.mutate(&cookie)
			if err := store.SaveSession(&cookie); err == nil {
				t.Fatal("SaveSession accepted an invalid Registry cookie")
			}
		})
	}
}

func TestDesktopLocalhostStableOriginUsesFixedLoopbackPort(t *testing.T) {
	basePath := "/wm-local-" + strings.Repeat("A", 43) + "/"
	want := "http://127.0.0.1:9633" + basePath
	if desktopLocalhostListenAddress != "127.0.0.1:9633" {
		t.Fatalf("listen address=%q, want fixed loopback", desktopLocalhostListenAddress)
	}
	if got := desktopLocalhostFixedURL(basePath); got != want {
		t.Fatalf("desktopLocalhostFixedURL=%q, want %q", got, want)
	}
	if got := desktopLocalhostFixedURL(basePath); got != want {
		t.Fatalf("second startup URL=%q, want stable %q", got, want)
	}
}

func TestDesktopLocalhostStaticEdgeRequiresSecretHostAndPath(t *testing.T) {
	webRoot := writeDesktopLocalhostWebRoot(t)
	edge, targetURL := startDesktopLocalhostTestEdge(t, webRoot)
	client := &http.Client{Timeout: 3 * time.Second}

	tests := []struct {
		name        string
		path        string
		host        string
		wantStatus  int
		wantBody    string
		contentType string
	}{
		{name: "entry", wantStatus: http.StatusOK, wantBody: "LOCALHOST_DOCUMENT", contentType: "text/html"},
		{name: "hashed asset", path: "bundle.abcdef12.js", wantStatus: http.StatusOK, wantBody: "LOCALHOST_ASSET", contentType: "text/javascript"},
		{name: "SPA route", path: "projects/one", wantStatus: http.StatusOK, wantBody: "LOCALHOST_DOCUMENT", contentType: "text/html"},
		{name: "directory listing", path: "assets/", wantStatus: http.StatusNotFound},
		{name: "wrong Host", host: "localhost", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodGet, targetURL+tt.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tt.host != "" {
				request.Host = tt.host
			}
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tt.wantStatus || (tt.wantBody != "" && !strings.Contains(string(body), tt.wantBody)) {
				t.Fatalf("status=%d body=%q, want status=%d body containing %q", response.StatusCode, body, tt.wantStatus, tt.wantBody)
			}
			if tt.contentType != "" && !strings.HasPrefix(response.Header.Get("Content-Type"), tt.contentType) {
				t.Fatalf("Content-Type=%q, want prefix %q", response.Header.Get("Content-Type"), tt.contentType)
			}
			if response.StatusCode == http.StatusOK {
				if response.Header.Get("X-Content-Type-Options") != "nosniff" || response.Header.Get("X-Frame-Options") != "DENY" || response.Header.Get("Referrer-Policy") != "no-referrer" {
					t.Fatalf("missing static security headers: %v", response.Header)
				}
			}
		})
	}

	parsedTarget, err := url.Parse(targetURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, rawURL := range []string{
		parsedTarget.Scheme + "://" + parsedTarget.Host + "/",
		parsedTarget.Scheme + "://" + parsedTarget.Host + "/wm-local-" + strings.Repeat("B", 43) + "/",
		targetURL + "%2e%2e/local-index.html",
		targetURL + "missing.js",
	} {
		response, err := client.Get(rawURL)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("GET %q status=%d, want 404", rawURL, response.StatusCode)
		}
	}

	if err := edge.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

func TestDesktopLocalhostStartupFailsClosed(t *testing.T) {
	t.Run("missing local document", func(t *testing.T) {
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       t.TempDir(),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			t.Fatalf("Start=%q, want missing local-index rejection", target)
		}
	})

	t.Run("occupied port", func(t *testing.T) {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: listener.Addr().String(),
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			t.Fatalf("Start=%q, want occupied port rejection", target)
		}
	})
}

func TestDesktopLocalhostRegistrySessionLifecycle(t *testing.T) {
	const registryToken = "desktop-localhost-registry-token"
	registryServer := registry.New(registry.Config{Token: registryToken})
	upstream := httptest.NewServer(registryServer.Handler())
	defer upstream.Close()
	webRoot := writeDesktopLocalhostWebRoot(t)
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	edge, targetURL := startDesktopLocalhostEdgeWithRegistry(t, webRoot, upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, mustDesktopLocalhostBasePath(t, store))
	authURL := targetURL + "ws"

	status := doDesktopLocalhostRequest(t, http.MethodGet, authURL+"?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, false)

	loginBody := `{"token":"` + registryToken + `","deviceName":"Desktop Localhost"}`
	login := doDesktopLocalhostRequest(t, http.MethodPost, authURL+"?auth=login", origin, "", loginBody)
	if login.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(login.Body)
		login.Body.Close()
		t.Fatalf("login status=%d body=%q", login.StatusCode, body)
	}
	if cookies := login.Header.Values("Set-Cookie"); len(cookies) != 0 {
		login.Body.Close()
		t.Fatalf("WebView received Registry cookies: %v", cookies)
	}
	var loginPayload struct {
		Authenticated bool   `json:"authenticated"`
		CSRFToken     string `json:"csrfToken"`
	}
	if err := json.NewDecoder(login.Body).Decode(&loginPayload); err != nil {
		login.Body.Close()
		t.Fatal(err)
	}
	login.Body.Close()
	if !loginPayload.Authenticated || loginPayload.CSRFToken == "" {
		t.Fatalf("login payload=%+v", loginPayload)
	}
	persisted, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if !validDesktopLocalhostSessionValue(persisted.SessionCookie) || !persisted.SessionExpiresAt.After(time.Now()) {
		t.Fatalf("native session was not persisted: %+v", persisted)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(registryToken)) || bytes.Contains(raw, []byte(loginPayload.CSRFToken)) {
		t.Fatal("Desktop state persisted Token or CSRF")
	}

	status = doDesktopLocalhostRequest(t, http.MethodGet, authURL+"?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, true)
	connection, response, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(targetURL, "http")+"ws",
		http.Header{"Origin": []string{origin}},
	)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("dial real Registry through Desktop edge: %v", err)
	}
	connection.Close()

	if err := edge.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, restartedURL := startDesktopLocalhostEdgeWithRegistry(t, webRoot, upstream.URL, store)
	restartedOrigin := strings.TrimSuffix(restartedURL, mustDesktopLocalhostBasePath(t, store))
	status = doDesktopLocalhostRequest(t, http.MethodGet, restartedURL+"ws?auth=status", restartedOrigin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, true)

	logout := doDesktopLocalhostRequest(t, http.MethodPost, restartedURL+"ws?auth=logout", restartedOrigin, loginPayload.CSRFToken, "")
	assertDesktopLocalhostAuthStatus(t, logout, false)
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.SessionCookie != "" || !cleared.SessionExpiresAt.IsZero() {
		t.Fatalf("logout retained native session: %+v", cleared)
	}
	_ = restarted.Close()
}

func TestDesktopLocalhostRegistryUnauthenticatedStatusClearsPersistedSession(t *testing.T) {
	now := time.Now()
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: strings.Repeat("D", 43), Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"authenticated":false}`)
	}))
	defer upstream.Close()
	edge, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, state.BasePath)
	status := doDesktopLocalhostRequest(t, http.MethodGet, targetURL+"ws?auth=status", origin, "", "")
	assertDesktopLocalhostAuthStatus(t, status, false)
	cleared, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	if cleared.SessionCookie != "" {
		t.Fatal("unauthenticated Registry status retained native session")
	}
	_ = edge.Close()
}

func TestDesktopLocalhostProxyPreservesWebSocketDownloadAndPreview(t *testing.T) {
	now := time.Now()
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	cookieValue := strings.Repeat("E", 43)
	if err := store.SaveSession(&http.Cookie{
		Name: desktopRegistrySessionCookieName, Value: cookieValue, Path: state.BasePath,
		Expires: now.Add(time.Hour), MaxAge: 3600, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	}); err != nil {
		t.Fatal(err)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "" || r.Header.Get("Origin") == "" && r.URL.RawQuery == "" ||
			r.Header.Get("X-Forwarded-Proto") != "http" || r.Header.Get("X-Real-IP") != "127.0.0.1" ||
			r.Header.Get("X-WheelMaker-Relay") != "" {
			http.Error(w, "missing proxy metadata", http.StatusBadRequest)
			return
		}
		cookie, cookieErr := r.Cookie(desktopRegistrySessionCookieName)
		if cookieErr != nil || cookie.Value != cookieValue {
			http.Error(w, "missing native session", http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.RawQuery == "auth=status":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":true,"csrfToken":"test-only"}`)
		case strings.HasSuffix(r.URL.Path, "/ws/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"):
			w.Header().Set("Content-Disposition", `attachment; filename="file.txt"`)
			_, _ = io.WriteString(w, "DOWNLOAD_BODY")
		case strings.HasSuffix(r.URL.Path, "/ws/preview/"):
			w.Header().Set("Content-Security-Policy", "sandbox allow-scripts")
			w.Header().Set("X-Preview-Contract", "preserved")
			_, _ = io.WriteString(w, "PREVIEW_BODY")
		case strings.HasSuffix(r.URL.Path, "/ws"):
			connection, upgradeErr := upgrader.Upgrade(w, r, nil)
			if upgradeErr != nil {
				return
			}
			defer connection.Close()
			messageType, payload, readErr := connection.ReadMessage()
			if readErr == nil {
				_ = connection.WriteMessage(messageType, payload)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	_, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
	origin := strings.TrimSuffix(targetURL, state.BasePath)

	downloadRequest, err := http.NewRequest(http.MethodGet, targetURL+"ws/download/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789", nil)
	if err != nil {
		t.Fatal(err)
	}
	downloadRequest.Header.Set("Origin", origin)
	downloadRequest.Header.Set("Cookie", desktopRegistrySessionCookieName+"=client-controlled; foreign=value")
	downloadRequest.Header.Set("X-Forwarded-Proto", "https")
	downloadRequest.Header.Set("X-Real-IP", "203.0.113.8")
	downloadRequest.Header.Set("X-WheelMaker-Relay", "1")
	download, err := (&http.Client{Timeout: 3 * time.Second}).Do(downloadRequest)
	if err != nil {
		t.Fatal(err)
	}
	downloadBody, _ := io.ReadAll(download.Body)
	download.Body.Close()
	if download.StatusCode != http.StatusOK || string(downloadBody) != "DOWNLOAD_BODY" || !strings.Contains(download.Header.Get("Content-Disposition"), "file.txt") {
		t.Fatalf("download status=%d headers=%v body=%q", download.StatusCode, download.Header, downloadBody)
	}

	preview := doDesktopLocalhostRequest(t, http.MethodPost, targetURL+"ws/preview/", origin, "test-only", `{}`)
	previewBody, _ := io.ReadAll(preview.Body)
	preview.Body.Close()
	if preview.StatusCode != http.StatusOK || string(previewBody) != "PREVIEW_BODY" || preview.Header.Get("Content-Security-Policy") != "sandbox allow-scripts" || preview.Header.Get("X-Preview-Contract") != "preserved" || preview.Header.Get("X-Frame-Options") != "" {
		t.Fatalf("preview status=%d headers=%v body=%q", preview.StatusCode, preview.Header, previewBody)
	}

	wsURL := "ws" + strings.TrimPrefix(targetURL, "http") + "ws"
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{origin}})
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("WebSocket dial: %v", err)
	}
	defer connection.Close()
	if err := connection.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	_, payload, err := connection.ReadMessage()
	if err != nil || string(payload) != "ping" {
		t.Fatalf("WebSocket echo payload=%q err=%v", payload, err)
	}
}

func TestDesktopLocalhostProxyRejectsUnavailableRegistryAndInvalidLoginCookie(t *testing.T) {
	t.Run("Registry unavailable", func(t *testing.T) {
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   unavailableDesktopLocalhostRegistryURL(t),
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			_ = edge.Close()
			t.Fatalf("Start=%q, want unavailable Registry rejection", target)
		}
	})

	t.Run("Registry redirect", func(t *testing.T) {
		redirects := 0
		redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			redirects++
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":false}`)
		}))
		defer redirectTarget.Close()
		upstream := httptest.NewServer(http.RedirectHandler(redirectTarget.URL, http.StatusFound))
		defer upstream.Close()
		edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
			ListenAddress: "127.0.0.1:0",
			RegistryURL:   upstream.URL,
			WebRoot:       writeDesktopLocalhostWebRoot(t),
			StateStore:    newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json")),
		})
		if target, err := edge.Start(context.Background()); err == nil {
			_ = edge.Close()
			t.Fatalf("Start=%q, want Registry redirect rejection", target)
		}
		if redirects != 0 {
			t.Fatalf("Registry probe followed %d redirect(s)", redirects)
		}
	})

	t.Run("foreign login cookie", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.RawQuery == "auth=status" {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"authenticated":false}`)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "foreign", Value: "value", Path: "/", Secure: true, HttpOnly: true})
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":true,"csrfToken":"must-not-pass"}`)
		}))
		defer upstream.Close()
		store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
		_, targetURL := startDesktopLocalhostEdgeWithRegistry(t, writeDesktopLocalhostWebRoot(t), upstream.URL, store)
		basePath := mustDesktopLocalhostBasePath(t, store)
		origin := strings.TrimSuffix(targetURL, basePath)
		login := doDesktopLocalhostRequest(t, http.MethodPost, targetURL+"ws?auth=login", origin, "", `{"token":"not-persisted"}`)
		login.Body.Close()
		if login.StatusCode != http.StatusBadGateway || len(login.Header.Values("Set-Cookie")) != 0 {
			t.Fatalf("login status=%d cookies=%v, want fail closed", login.StatusCode, login.Header.Values("Set-Cookie"))
		}
		state, err := store.LoadOrCreate()
		if err != nil {
			t.Fatal(err)
		}
		if state.SessionCookie != "" {
			t.Fatal("foreign cookie was persisted")
		}
	})
}

func startDesktopLocalhostTestEdge(t *testing.T, webRoot string) (*desktopLocalhostEdge, string) {
	t.Helper()
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("auth") == "status" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"authenticated":false}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(registry.Close)
	store := newFileDesktopLocalhostStateStore(filepath.Join(t.TempDir(), "localhost-state.json"))
	return startDesktopLocalhostEdgeWithRegistry(t, webRoot, registry.URL, store)
}

func startDesktopLocalhostEdgeWithRegistry(t *testing.T, webRoot, registryURL string, store *fileDesktopLocalhostStateStore) (*desktopLocalhostEdge, string) {
	t.Helper()
	edge := newDesktopLocalhostEdge(desktopLocalhostEdgeOptions{
		ListenAddress: "127.0.0.1:0",
		RegistryURL:   registryURL,
		WebRoot:       webRoot,
		StateStore:    store,
	})
	targetURL, err := edge.Start(context.Background())
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = edge.Close() })
	return edge, targetURL
}

func mustDesktopLocalhostBasePath(t *testing.T, store *fileDesktopLocalhostStateStore) string {
	t.Helper()
	state, err := store.LoadOrCreate()
	if err != nil {
		t.Fatal(err)
	}
	return state.BasePath
}

func doDesktopLocalhostRequest(t *testing.T, method, rawURL, origin, csrf, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, rawURL, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		request.Header.Set("Sec-Fetch-Mode", "cors")
	}
	if csrf != "" {
		request.Header.Set("X-WheelMaker-CSRF", csrf)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: 3 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func assertDesktopLocalhostAuthStatus(t *testing.T, response *http.Response, authenticated bool) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("auth status=%d body=%q", response.StatusCode, body)
	}
	var payload struct {
		Authenticated bool `json:"authenticated"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Authenticated != authenticated {
		t.Fatalf("authenticated=%v, want %v", payload.Authenticated, authenticated)
	}
}

func writeDesktopLocalhostWebRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "local-index.html"), []byte("<!doctype html>LOCALHOST_DOCUMENT"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bundle.abcdef12.js"), []byte("LOCALHOST_ASSET"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	return root
}

func unavailableDesktopLocalhostRegistryURL(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return "http://" + address
}
