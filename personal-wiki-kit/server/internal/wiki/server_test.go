package wiki

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateListenAddressAllowsOnlyLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:0", "[::1]:9765", "localhost:8080"} {
		if err := ValidateListenAddress(address); err != nil {
			t.Fatalf("ValidateListenAddress(%q) error = %v", address, err)
		}
	}
	for _, address := range []string{"0.0.0.0:9765", "192.0.2.10:9765", ":9765", "example.com:9765"} {
		if err := ValidateListenAddress(address); err == nil {
			t.Fatalf("ValidateListenAddress(%q) accepted a non-loopback address", address)
		}
	}
}

func TestLocalServerServesVerifiedSiteWithoutAuthentication(t *testing.T) {
	server, err := NewServer(ServerConfig{Root: createTestRelease(t), LocalNoAuth: true})
	if err != nil {
		t.Fatalf("NewServer(local) error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/data/catalog.json", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "articleCount") {
		t.Fatalf("local data = %d %q", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "http://127.0.0.1/logout", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/" {
		t.Fatalf("local logout = %d %q", response.Code, response.Header().Get("Location"))
	}
}

func TestServerRejectsAmbiguousAuthenticationModes(t *testing.T) {
	root := createTestRelease(t)
	if _, err := NewServer(ServerConfig{Root: root}); err == nil {
		t.Fatal("NewServer() accepted online mode without a password hash")
	}
	if _, err := NewServer(ServerConfig{Root: root, LocalNoAuth: true, PasswordHash: "not-empty"}); err == nil {
		t.Fatal("NewServer() accepted a password hash in local no-auth mode")
	}
}

func TestOnlineServerProtectsAssetsAndSupportsLogout(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple", argonParameters{
		memory: 8 * 1024, time: 1, threads: 1, keyLen: 32,
	})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerConfig{
		Root: createTestRelease(t), PasswordHash: encoded, SessionTTL: time.Hour,
		MaximumAttempts: 2, AttemptWindow: time.Minute, SecureCookie: true,
	})
	if err != nil {
		t.Fatalf("NewServer(online) error = %v", err)
	}
	handler := server.Handler()

	request := httptest.NewRequest(http.MethodGet, "https://wiki.example.com/data/catalog.json", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated data status = %d", response.Code)
	}

	form := url.Values{"password": {"correct horse battery staple"}}
	request = httptest.NewRequest(http.MethodPost, "https://wiki.example.com/login", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther {
		t.Fatalf("login status = %d", response.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("login cookies = %#v", cookies)
	}

	request = httptest.NewRequest(http.MethodGet, "https://wiki.example.com/data/catalog.json", nil)
	request.AddCookie(cookies[0])
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("authenticated data status = %d", response.Code)
	}
	if response.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("security headers are missing")
	}

	request = httptest.NewRequest(http.MethodPost, "https://wiki.example.com/logout", nil)
	request.AddCookie(cookies[0])
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/login" {
		t.Fatalf("logout response = %d %q", response.Code, response.Header().Get("Location"))
	}
}

func TestHealthResponseDoesNotExposeContent(t *testing.T) {
	server, err := NewServer(ServerConfig{Root: createTestRelease(t), LocalNoAuth: true})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/healthz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "ok\n" {
		t.Fatalf("health = %d %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "article") {
		t.Fatal("health response exposed content metadata")
	}
}

func TestOnlineServerRateLimitsFailedLogins(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple", argonParameters{
		memory: 8 * 1024, time: 1, threads: 1, keyLen: 32,
	})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(ServerConfig{
		Root: createTestRelease(t), PasswordHash: encoded,
		MaximumAttempts: 2, AttemptWindow: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	for attempt, expected := range []int{
		http.StatusUnauthorized,
		http.StatusUnauthorized,
		http.StatusTooManyRequests,
	} {
		form := url.Values{"password": {"wrong password"}}
		request := httptest.NewRequest(http.MethodPost, "https://wiki.example.com/login", strings.NewReader(form.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		request.RemoteAddr = "192.0.2.10:5000"
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != expected {
			t.Fatalf("attempt %d status = %d, want %d", attempt+1, response.Code, expected)
		}
	}
}

func createTestRelease(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	contents := map[string][]byte{
		"index.html":            []byte("<!doctype html><div id=\"root\"></div>"),
		"data/catalog.json":     []byte(`{"articleCount":1}`),
		"data/search.json":      []byte(`{"entries":[]}`),
		"release-metadata.json": []byte(`{"releaseId":"test-release"}`),
	}
	manifest := releaseManifest{Schema: 1, ReleaseID: "test-release"}
	for name, data := range contents {
		filename := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, data, 0o600); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		manifest.Files = append(manifest.Files, manifestFile{
			Path: name, Bytes: int64(len(data)), SHA256: hex.EncodeToString(digest[:]),
		})
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "release-manifest.json"), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}
