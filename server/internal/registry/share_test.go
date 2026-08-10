package registry

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestShareConfigIsReadAtCreateAndListBoundary(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"https://share.example.test"}}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	initShareClient(t, ws, "share-token")

	create := map[string]any{
		"projectId": "hub:project", "path": "docs/readme.md", "kind": "markdown", "title": "Readme",
		"expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "<p>readme</p>"),
	}
	mustWriteJSON(t, ws, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodShareCreate, Payload: create})
	created := mustReadEnvelope(t, ws)
	if created.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("create response = %+v", created)
	}
	var createResponse RegistryShareTestResponse
	if err := json.Unmarshal(mustJSON(t, created.Payload), &createResponse); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if createResponse.Token == "" || createResponse.URL != "https://share.example.test/s/"+createResponse.Token {
		t.Fatalf("create response = %+v", createResponse)
	}

	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":""}}}`)
	mustWriteJSON(t, ws, testEnvelope{RequestID: 3, Type: "request", Method: rp.RegistryMethodShareList, Payload: map[string]any{}})
	listed := mustReadEnvelope(t, ws)
	if listed.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("list response = %+v", listed)
	}
	var listResponse struct {
		Enabled bool `json:"enabled"`
		Items   []struct {
			Token string `json:"token"`
			URL   string `json:"url"`
		} `json:"items"`
	}
	if err := json.Unmarshal(mustJSON(t, listed.Payload), &listResponse); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if listResponse.Enabled || len(listResponse.Items) != 1 || listResponse.Items[0].URL != "" {
		t.Fatalf("disabled list response = %+v", listResponse)
	}
}

func TestShareRequestsCreateListDeleteAndInvalidPayload(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"http://share.example.test:8080"}}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	initShareClient(t, ws, "share-token")

	mustWriteJSON(t, ws, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodShareCreate, Payload: map[string]any{
		"projectId": "hub:project", "path": "docs/readme.txt", "kind": "markdown", "title": "Bad",
		"expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "bad"),
	}})
	bad := mustReadEnvelope(t, ws)
	if bad.Type != rp.RegistryEnvelopeTypeError || bad.Payload["code"] != codeInvalidArgument {
		t.Fatalf("invalid create response = %+v", bad)
	}

	mustWriteJSON(t, ws, testEnvelope{RequestID: 3, Type: "request", Method: rp.RegistryMethodShareList, Payload: map[string]any{"limit": 1000}})
	list := mustReadEnvelope(t, ws)
	if list.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("list response = %+v", list)
	}
	mustWriteJSON(t, ws, testEnvelope{RequestID: 4, Type: "request", Method: rp.RegistryMethodShareDelete, Payload: map[string]any{"token": strings.Repeat("x", 43)}})
	deleted := mustReadEnvelope(t, ws)
	if deleted.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("delete response = %+v", deleted)
	}
}

func TestShareConfigIgnoresGatewayConfig(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"https://same.example.test"}}}`)
	gatewayDir := filepath.Join(stateDir, "gateway")
	if err := os.MkdirAll(gatewayDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gatewayDir, "config.json"), []byte(`{"share":{"publicUrl":"https://SAME.example.test"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s := New(Config{Token: "share-token", StateDir: stateDir})
	state := s.currentShareConfig()
	if !state.enabled || state.publicURL != "https://same.example.test" {
		t.Fatalf("share config = %+v", state)
	}
}

func TestShareConfigIgnoresLegacyTopLevelShare(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"share":{"publicUrl":"https://legacy-share.example.test"}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	state := s.currentShareConfig()
	if state.enabled || state.publicURL != "" {
		t.Fatalf("legacy top-level Share config = %+v, want disabled", state)
	}
}

type RegistryShareTestResponse struct {
	Token     string  `json:"token"`
	URL       string  `json:"url"`
	CreatedAt string  `json:"createdAt"`
	ExpiresAt *string `json:"expiresAt"`
}

func initShareClient(t *testing.T, ws interface{ WriteJSON(any) error }, token string) {
	t.Helper()
	if err := ws.WriteJSON(testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wm-web", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion,
		"role": "client", "token": token,
	}}); err != nil {
		t.Fatal(err)
	}
	// The concrete websocket helper is used by all registry protocol tests; the
	// response is intentionally ignored after connect.init succeeds.
	if wsConn, ok := ws.(*websocket.Conn); ok {
		resp := mustReadEnvelope(t, wsConn)
		if resp.Type != rp.RegistryEnvelopeTypeResponse {
			t.Fatalf("connect response = %+v", resp)
		}
	}
}

func writeShareConfigTest(t *testing.T, stateDir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(stateDir, "config.json"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustJSON(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
