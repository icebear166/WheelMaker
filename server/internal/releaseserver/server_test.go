package releaseserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHealthIsPublicAndReportsPublisherConfiguration(t *testing.T) {
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		OK                  bool `json:"ok"`
		PublisherConfigured bool `json:"publisherConfigured"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.PublisherConfigured {
		t.Fatalf("health = %+v", body)
	}
}

func TestPublishAuthenticationRunsBeforeRouting(t *testing.T) {
	for name, tc := range map[string]struct {
		tokenHash string
		header    string
		want      int
	}{
		"not configured": {want: http.StatusServiceUnavailable},
		"missing bearer": {tokenHash: sha256String("release-token"), want: http.StatusUnauthorized},
		"wrong bearer":   {tokenHash: sha256String("release-token"), header: "Bearer wrong", want: http.StatusUnauthorized},
		"valid bearer":   {tokenHash: sha256String("release-token"), header: "Bearer release-token", want: http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			handler, err := New(Config{
				Schema:      1,
				Listen:      "127.0.0.1:9680",
				PublicURL:   "https://release.example.com",
				DataRoot:    t.TempDir(),
				TokenSHA256: tc.tokenHash,
			})
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/publish/start", nil)
			if tc.header != "" {
				request.Header.Set("Authorization", tc.header)
			}
			handler.ServeHTTP(recorder, request)
			if recorder.Code != tc.want {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, tc.want, recorder.Body.String())
			}
			if recorder.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("Content-Type = %q", recorder.Header().Get("Content-Type"))
			}
			if recorder.Body.String() == tc.header {
				t.Fatal("response echoed authorization header")
			}
		})
	}
}

func TestPublicFilesSupportHomepageHeadRangeCORSAndCaching(t *testing.T) {
	dataRoot := t.TempDir()
	publicRoot := filepath.Join(dataRoot, "public")
	if err := os.MkdirAll(filepath.Join(publicRoot, "releases", "v1.2"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":                  "release-home",
		"deploy.mjs":                  "deploy-script",
		"stable.json":                 `{"schema":2}`,
		"releases/v1.2/asset.tar.zst": "abcdef",
	}
	for name, body := range files {
		path := filepath.Join(publicRoot, filepath.FromSlash(name))
		if err := os.WriteFile(path, []byte(body), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com", DataRoot: dataRoot})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name       string
		method     string
		path       string
		rangeValue string
		wantBody   string
		wantStatus int
		cachePart  string
	}{
		{name: "homepage", method: http.MethodGet, path: "/", wantStatus: http.StatusOK, wantBody: "release-home", cachePart: "no-store"},
		{name: "head", method: http.MethodHead, path: "/deploy.mjs", wantStatus: http.StatusOK, cachePart: "no-store"},
		{name: "range", method: http.MethodGet, path: "/releases/v1.2/asset.tar.zst", rangeValue: "bytes=1-2", wantStatus: http.StatusPartialContent, wantBody: "bc", cachePart: "immutable"},
		{name: "stable", method: http.MethodGet, path: "/stable.json", wantStatus: http.StatusOK, wantBody: `{"schema":2}`, cachePart: "no-store"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.rangeValue != "" {
				request.Header.Set("Range", tc.rangeValue)
			}
			handler.ServeHTTP(recorder, request)
			if recorder.Code != tc.wantStatus || recorder.Body.String() != tc.wantBody {
				t.Fatalf("status/body = %d %q", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
				t.Fatalf("CORS = %q", recorder.Header().Get("Access-Control-Allow-Origin"))
			}
			if !strings.Contains(recorder.Header().Get("Cache-Control"), tc.cachePart) {
				t.Fatalf("Cache-Control = %q", recorder.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestPublicFilesRejectMethodsDirectoriesTraversalAndAPIFallback(t *testing.T) {
	dataRoot := t.TempDir()
	publicRoot := filepath.Join(dataRoot, "public")
	if err := os.MkdirAll(filepath.Join(publicRoot, "directory"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(publicRoot, "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicRoot, "api", "hidden"), []byte("must-not-serve"), 0o640); err != nil {
		t.Fatal(err)
	}
	token := "release-token"
	handler, err := New(Config{
		Schema: 1, Listen: "127.0.0.1:9680", PublicURL: "https://release.example.com",
		DataRoot: dataRoot, TokenSHA256: sha256String(token),
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
		auth   bool
		want   int
	}{
		{method: http.MethodPost, path: "/stable.json", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/directory/", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/..%2fconfig.json", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/hidden", auth: true, want: http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(tc.method, tc.path, bytes.NewReader(nil))
		if tc.auth {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		handler.ServeHTTP(recorder, request)
		if recorder.Code != tc.want || recorder.Body.String() == "must-not-serve" {
			t.Fatalf("%s %s: status/body = %d %q", tc.method, tc.path, recorder.Code, recorder.Body.String())
		}
	}
}

func sha256String(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
