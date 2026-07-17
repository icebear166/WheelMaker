package releaseserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthIsPublicAndReportsPublisherConfiguration(t *testing.T) {
	handler, err := New(Config{Schema: 1, Listen: "127.0.0.1:9680", DataRoot: t.TempDir()})
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

func sha256String(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
