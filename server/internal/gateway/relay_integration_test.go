package gateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
	"github.com/gorilla/websocket"
)

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
		Kind:      SiteWorkspace,
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
