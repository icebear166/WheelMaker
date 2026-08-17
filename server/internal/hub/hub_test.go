package hub

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/hub/agent"
	clientpkg "github.com/swm8023/wheelmaker/internal/hub/client"
	"github.com/swm8023/wheelmaker/internal/hub/tools"
	"github.com/swm8023/wheelmaker/internal/hub/usage"
	"github.com/swm8023/wheelmaker/internal/hubconfig"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/registry"
	logger "github.com/swm8023/wheelmaker/internal/shared"
	"io"
	_ "modernc.org/sqlite"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBuildClient_DefaultConfigStartsSessionClient(t *testing.T) {
	h := New(&logger.AppConfig{}, t.TempDir()+"/db/client.sqlite3")
	c, err := h.buildClient(context.Background(), logger.ProjectConfig{
		Name: "p",
		Path: ".",
	})
	if err != nil {
		t.Fatalf("buildClient: %v", err)
	}
	if _, err := c.HandleSessionRequest(context.Background(), "session.list", "p", nil); err != nil {
		t.Fatalf("session.list: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
}

func TestHubPassesRestartRuntimeHandlerToReporter(t *testing.T) {
	h := newHubWithFactory(
		&logger.AppConfig{
			Token: "token", HubID: "hub-restart-handler",
			Registry: logger.RegistryConfig{Listen: true, Port: 9630},
		},
		filepath.Join(t.TempDir(), "db", "client.sqlite3"),
		agent.NewACPFactory(),
	)
	t.Cleanup(func() { _ = h.Close() })
	handler := func() error { return nil }
	h.SetRestartRuntimeHandler(handler)
	h.setupRegistrySync()

	if h.regSync == nil {
		t.Fatal("registry reporter was not created")
	}
	if h.regSync.cfg.RestartRuntime == nil {
		t.Fatal("reporter restart handler is nil")
	}
}

func TestStartExpandsHomeProjectPath(t *testing.T) {
	home := t.TempDir()
	projectRoot := filepath.Join(home, "WheelMaker")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	cfg := &logger.AppConfig{Projects: []logger.ProjectConfig{{
		Name: "WheelMaker",
		Path: "~/WheelMaker",
	}}}
	h := New(cfg, filepath.Join(t.TempDir(), "db", "client.sqlite3"))
	if err := h.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = h.Close() })

	if got := filepath.Clean(cfg.Projects[0].Path); got != filepath.Clean(projectRoot) {
		t.Fatalf("project path = %q, want expanded home path %q", got, projectRoot)
	}
}

func TestBuildClientStartsWithSessionTurnStore(t *testing.T) {
	baseDir := t.TempDir()
	dbPath := filepath.Join(baseDir, "db", "client.sqlite3")
	store, err := clientpkg.NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	ctx := context.Background()
	if err := store.SaveSession(ctx, &clientpkg.SessionRecord{
		ID:              "sess-1",
		ProjectName:     "proj1",
		Status:          clientpkg.SessionActive,
		AgentType:       "codex",
		SessionSyncJSON: `{"latestPersistedTurnIndex":1}`,
		CreatedAt:       time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC),
		LastActiveAt:    time.Date(2026, 5, 13, 10, 1, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	if _, err := clientpkg.WriteSessionTurnFiles(ctx, filepath.Join(baseDir, "db", "session"), "proj1", "sess-1", 1, []string{
		`{"method":"agent_message_chunk","param":{"text":"from-db-session"}}`,
	}); err != nil {
		t.Fatalf("WriteSessionTurnFiles: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	h := New(&logger.AppConfig{}, dbPath)
	c, err := h.buildClient(ctx, logger.ProjectConfig{Name: "proj1", Path: "."})
	if err != nil {
		t.Fatalf("buildClient: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	if _, err := os.Stat(filepath.Join(baseDir, "session")); err != nil && !os.IsNotExist(err) {
		t.Fatalf("stat session root: %v", err)
	}
	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("session.read: %v", err)
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	var body struct {
		Turns []struct {
			Content string `json:"content"`
		} `json:"turns"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(body.Turns) != 1 || !strings.Contains(body.Turns[0].Content, "from-db-session") {
		t.Fatalf("turns=%+v, want db/session turn", body.Turns)
	}
}

func TestStartRejectsSchemaMismatchWithDeleteHint(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "db", "client.sqlite3")

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatalf("mkdir db dir: %v", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE projects (
			project_name TEXT PRIMARY KEY,
			yolo INTEGER NOT NULL DEFAULT 0,
			agent_state_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`); err != nil {
		_ = db.Close()
		t.Fatalf("create legacy projects table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}

	h := New(&logger.AppConfig{}, dbPath)
	err = h.Start(context.Background())
	if err == nil {
		t.Fatal("Start() error = nil, want schema mismatch")
	}
	if !strings.Contains(err.Error(), "delete local db directory") {
		t.Fatalf("Start() err = %v, want delete local db directory hint", err)
	}
}

func TestReporterPortRelayHTTPAndWebSocketSmoke(t *testing.T) {
	var seenUserAgent string
	targetUpgrader := websocket.Upgrader{
		CheckOrigin:  func(_ *http.Request) bool { return true },
		Subprotocols: []string{"vite-hmr"},
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUserAgent = r.UserAgent()
		if r.URL.Path == "/ws" {
			conn, err := targetUpgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("target ws upgrade: %v", err)
			}
			defer conn.Close()
			for {
				messageType, payload, err := conn.ReadMessage()
				if err != nil {
					return
				}
				if err := conn.WriteMessage(messageType, append([]byte("echo:"), payload...)); err != nil {
					return
				}
			}
		}
		if r.URL.Path == "/echo" {
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("Cookie") == "" {
				http.Error(w, "missing target cookie", http.StatusUnauthorized)
				return
			}
			if _, err := r.Cookie("wm_port_relay"); err == nil {
				http.Error(w, "relay cookie leaked", http.StatusBadGateway)
				return
			}
			cookie, err := r.Cookie("breezecara_session")
			if err != nil {
				http.Error(w, "missing breezecara session", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("post:" + string(body) + "|cookie:" + cookie.Value))
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello through relay"))
	}))
	t.Cleanup(target.Close)
	targetURL, err := url.Parse(target.URL)
	if err != nil {
		t.Fatalf("parse target url: %v", err)
	}
	targetHost, targetPort := splitHostPortForTest(t, targetURL.Host)

	relayListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen fixed relay gateway: %v", err)
	}
	relayPort := relayListener.Addr().(*net.TCPAddr).Port
	reg := registry.New(registry.Config{RelayPortProvider: func() (int, error) { return relayPort, nil }})
	relayServer := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Del("X-WheelMaker-Relay")
		r.Header.Set("X-WheelMaker-Relay", "1")
		reg.Handler().ServeHTTP(w, r)
	})}
	go func() { _ = relayServer.Serve(relayListener) }()
	t.Cleanup(func() {
		_ = relayServer.Close()
		_ = relayListener.Close()
	})
	registryAddr := newRegistryServer(t, reg.Handler())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         registryAddr,
		HubID:             "hub-relay-smoke",
		ReconnectInterval: 50 * time.Millisecond,
	}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	waitForRelayHubOnline(t, registryAddr, "hub-relay-smoke")
	client := dialWS(t, "http://"+registryAddr+"/ws")
	defer client.Close()
	connectClient(t, client, "")
	var enableResp testEnvelope
	enableUp := false
	for attempt := 0; attempt < 10; attempt++ {
		if attempt > 0 {
			waitForRelayHubOnline(t, registryAddr, "hub-relay-smoke")
		}
		mustWriteJSON(t, client, testEnvelope{
			RequestID: int64(2 + attempt),
			Type:      "request",
			Method:    "registry.relay.enable",
			Payload: map[string]any{
				"listenPort": relayPort,
				"hubId":      "hub-relay-smoke",
				"targetHost": targetHost,
				"targetPort": targetPort,
				"accessCode": "483921",
			},
		})
		enableResp = mustReadEnvelope(t, client)
		if enableResp.Type == "response" && enableResp.Payload["status"] == "Up" {
			enableUp = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !enableUp {
		t.Fatalf("registry.relay.enable response=%#v, want Up", enableResp)
	}

	relayBase := "http://127.0.0.1:" + strconv.Itoa(relayPort)
	jarClient := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	unauthResp, err := jarClient.Get(relayBase + "/")
	if err != nil {
		t.Fatalf("unauth relay get: %v", err)
	}
	if unauthResp.StatusCode != http.StatusSeeOther {
		t.Fatalf("unauth status=%d, want 303", unauthResp.StatusCode)
	}
	if got := unauthResp.Header.Get("Location"); got != "/__wheelmaker/relay/login" {
		t.Fatalf("unauth Location=%q, want login page", got)
	}
	_ = unauthResp.Body.Close()

	loginRequest, err := http.NewRequest(http.MethodPost, relayBase+"/__wheelmaker/relay/login", strings.NewReader("code=483921"))
	if err != nil {
		t.Fatalf("new relay login request: %v", err)
	}
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginRequest.Header.Set("Origin", relayBase)
	loginResp, err := jarClient.Do(loginRequest)
	if err != nil {
		t.Fatalf("login relay: %v", err)
	}
	if loginResp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login status=%d, want 303", loginResp.StatusCode)
	}
	cookies := loginResp.Cookies()
	_ = loginResp.Body.Close()

	req, err := http.NewRequest(http.MethodGet, relayBase+"/", nil)
	if err != nil {
		t.Fatalf("new relay request: %v", err)
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	authedResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("authed relay get: %v", err)
	}
	body, _ := io.ReadAll(authedResp.Body)
	_ = authedResp.Body.Close()
	if authedResp.StatusCode != http.StatusOK || string(body) != "hello through relay" {
		t.Fatalf("authed status=%d body=%q", authedResp.StatusCode, string(body))
	}
	if !strings.Contains(seenUserAgent, "Mozilla/5.0") {
		t.Fatalf("target user-agent=%q, want browser-like agent", seenUserAgent)
	}

	postReq, err := http.NewRequest(http.MethodPost, relayBase+"/echo", strings.NewReader(`{"hello":"relay"}`))
	if err != nil {
		t.Fatalf("new relay post request: %v", err)
	}
	postReq.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		postReq.AddCookie(cookie)
	}
	postReq.AddCookie(&http.Cookie{Name: "breezecara_session", Value: "target-session"})
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		t.Fatalf("authed relay post: %v", err)
	}
	postBody, _ := io.ReadAll(postResp.Body)
	_ = postResp.Body.Close()
	if postResp.StatusCode != http.StatusOK || string(postBody) != `post:{"hello":"relay"}|cookie:target-session` {
		t.Fatalf("post status=%d body=%q", postResp.StatusCode, string(postBody))
	}

	wsHeader := http.Header{}
	for _, cookie := range cookies {
		wsHeader.Add("Cookie", cookie.String())
	}
	wsConn, _, err := websocket.DefaultDialer.Dial("ws://127.0.0.1:"+strconv.Itoa(relayPort)+"/ws", wsHeader)
	if err != nil {
		t.Fatalf("dial relay ws: %v", err)
	}
	defer wsConn.Close()
	if err := wsConn.WriteMessage(websocket.TextMessage, []byte("text")); err != nil {
		t.Fatalf("write relay ws text: %v", err)
	}
	messageType, payload, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("read relay ws text: %v", err)
	}
	if messageType != websocket.TextMessage || string(payload) != "echo:text" {
		t.Fatalf("ws text type=%d payload=%q", messageType, string(payload))
	}
	if err := wsConn.WriteMessage(websocket.BinaryMessage, []byte{1, 2, 3}); err != nil {
		t.Fatalf("write relay ws binary: %v", err)
	}
	messageType, payload, err = wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("read relay ws binary: %v", err)
	}
	if messageType != websocket.BinaryMessage || string(payload) != "echo:\x01\x02\x03" {
		t.Fatalf("ws binary type=%d payload=%v", messageType, payload)
	}

	subprotocolDialer := websocket.Dialer{Subprotocols: []string{"vite-hmr"}}
	subprotocolConn, _, err := subprotocolDialer.Dial("ws://127.0.0.1:"+strconv.Itoa(relayPort)+"/ws", wsHeader)
	if err != nil {
		t.Fatalf("dial relay ws subprotocol: %v", err)
	}
	defer subprotocolConn.Close()
	if got := subprotocolConn.Subprotocol(); got != "vite-hmr" {
		t.Fatalf("relay ws subprotocol=%q, want vite-hmr", got)
	}
}

func waitForRelayHubOnline(t *testing.T, addr string, hubID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ws := dialWS(t, "http://"+addr+"/ws")
		connectClient(t, ws, "")
		mustWriteJSON(t, ws, testEnvelope{RequestID: 2, Type: "request", Method: "registry.project.list", Payload: map[string]any{}})
		resp := mustReadEnvelope(t, ws)
		_ = ws.Close()
		hubs, _ := resp.Payload["hubs"].([]any)
		for _, raw := range hubs {
			hub, _ := raw.(map[string]any)
			if hub["hubId"] == hubID {
				return
			}
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatalf("hub %q not online before timeout", hubID)
}

func splitHostPortForTest(t *testing.T, hostport string) (string, int) {
	t.Helper()
	host, portText, err := net.SplitHostPort(hostport)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return host, port
}

type testEnvelope struct {
	RequestID int64          `json:"requestId,omitempty"`
	Type      string         `json:"type"`
	Method    string         `json:"method,omitempty"`
	HubID     string         `json:"hubId,omitempty"`
	ProjectID string         `json:"projectId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type stubSessionHandler struct {
	lastMethod  string
	lastProject string
	lastBody    string
	calls       int
}

type stubTerminalHandler struct {
	requests chan string
	inputs   chan rp.TerminalInputEvent
}

func (s *stubTerminalHandler) HandleTerminalRequest(_ context.Context, method, projectID string, payload json.RawMessage) (any, error) {
	if s.requests != nil {
		s.requests <- method + ":" + projectID + ":" + string(payload)
	}
	return rp.TerminalListResponse{Terminals: []rp.TerminalMetadata{{TerminalID: "term-1", HubID: "hub-terminal"}}}, nil
}

func (s *stubTerminalHandler) HandleTerminalInput(event rp.TerminalInputEvent) {
	if s.inputs != nil {
		s.inputs <- event
	}
}

func (s *stubSessionHandler) HandleSessionRequest(_ context.Context, method string, projectID string, payload json.RawMessage) (any, error) {
	s.calls++
	s.lastMethod = method
	s.lastProject = projectID
	s.lastBody = string(payload)
	return map[string]any{"ok": true, "sessionId": "sess-1"}, nil
}

type stubToolCommandHandler struct {
	mu       sync.Mutex
	method   string
	payload  string
	calls    []struct{ method, payload string }
	projects []ProjectInfo
	response any
	err      *tools.CommandError
}

func (s *stubToolCommandHandler) Handle(_ context.Context, method string, payload json.RawMessage) (any, *tools.CommandError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.method = method
	s.payload = string(payload)
	s.calls = append(s.calls, struct{ method, payload string }{method: method, payload: string(payload)})
	if s.response == nil {
		s.response = map[string]any{"ok": true}
	}
	return s.response, s.err
}

func (s *stubToolCommandHandler) SetProjects(projects []ProjectInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.projects = append([]ProjectInfo(nil), projects...)
}

func (s *stubToolCommandHandler) ApplyRelease(_ context.Context, _ string, _ string) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func (s *stubToolCommandHandler) HandleDebugWebTransfer(_ string, _ json.RawMessage) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func (s *stubToolCommandHandler) snapshot() (string, string, []ProjectInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.method, s.payload, append([]ProjectInfo(nil), s.projects...)
}

func (s *stubToolCommandHandler) callSnapshot() []struct{ method, payload string } {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]struct{ method, payload string }(nil), s.calls...)
}

type overlapDetectingToolCommandHandler struct {
	mu       sync.Mutex
	inFlight int
	overlap  bool
}

func (s *overlapDetectingToolCommandHandler) Handle(_ context.Context, _ string, _ json.RawMessage) (any, *tools.CommandError) {
	s.mu.Lock()
	s.inFlight++
	if s.inFlight > 1 {
		s.overlap = true
	}
	s.mu.Unlock()

	time.Sleep(25 * time.Millisecond)

	s.mu.Lock()
	s.inFlight--
	s.mu.Unlock()
	return map[string]any{"ok": true}, nil
}

func (s *overlapDetectingToolCommandHandler) SetProjects([]ProjectInfo) {}

func (s *overlapDetectingToolCommandHandler) ApplyRelease(_ context.Context, _ string, _ string) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func (s *overlapDetectingToolCommandHandler) HandleDebugWebTransfer(_ string, _ json.RawMessage) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func (s *overlapDetectingToolCommandHandler) sawOverlap() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.overlap
}

func TestReporterConfiguresUsageHistoryStore(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-usage-history", StateDir: t.TempDir()}, nil)
	if reporter.usageHistory == nil {
		t.Fatal("usage history store is nil")
	}
}

func TestProjectFileIndexRebuildNotifiesCompletionOnFailure(t *testing.T) {
	manager := newProjectFileIndexManager(t.TempDir())
	manager.scanFilesForTest = func(context.Context, projectFileIndexProject) ([]string, error) {
		return nil, errors.New("scan failed")
	}
	done := make(chan string, 1)
	manager.setOperationDoneHandler(func(projectID string) {
		done <- projectID
	})
	project := projectFileIndexProject{
		ProjectID: "hub-a:project",
		Name:      "project",
		Root:      t.TempDir(),
	}

	response := manager.startRebuild(context.Background(), project)
	if !response.Accepted {
		t.Fatalf("rebuild response = %#v", response)
	}
	select {
	case projectID := <-done:
		if projectID != project.ProjectID {
			t.Fatalf("projectID = %q, want %q", projectID, project.ProjectID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("file index completion callback not called")
	}
}

func TestReporterRespondsToHubStateGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := newFakeReporterRegistry(t, "hub-state-get", testEnvelope{
		RequestID: 100,
		Type:      "request",
		Method:    rp.RegistryMethodHubStateGet,
		HubID:     "hub-state-get",
		Payload:   map[string]any{},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-state-get",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodHubStateGet {
			t.Fatalf("unexpected hub.state.get response: %#v", resp)
		}
		state, ok := resp.Payload["state"].(map[string]any)
		if !ok {
			t.Fatalf("state missing from payload: %#v", resp.Payload)
		}
		if state["hubId"] != "hub-state-get" {
			t.Fatalf("state hubId=%v, want hub-state-get", state["hubId"])
		}
		if state["instanceId"] == "" {
			t.Fatalf("state instanceId missing: %#v", state)
		}
		sections, ok := state["sections"].(map[string]any)
		if !ok {
			t.Fatalf("state sections missing: %#v", state)
		}
		tokenStats, ok := sections[hubStateSectionTokenStats].(map[string]any)
		if !ok {
			t.Fatalf("tokenStats missing from state: %#v", sections)
		}
		if tokenStats["updateStatus"] != "updating" && tokenStats["updateStatus"] != "idle" {
			t.Fatalf("tokenStats updateStatus=%v, want startup limits scan", tokenStats["updateStatus"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive hub.state.get response from reporter")
	}
}

func TestReporterRespondsToUsageHistoryGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	now := time.Now().UTC().Truncate(time.Second)
	stateDir := t.TempDir()

	ts := newFakeReporterRegistry(t, "hub-usage-history-get", testEnvelope{
		RequestID: 101,
		Type:      "request",
		Method:    rp.RegistryMethodUsageHistoryGet,
		HubID:     "hub-usage-history-get",
		Payload: map[string]any{
			"providerId":     "codex",
			"accountLocalId": "account-1",
		},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-usage-history-get",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          stateDir,
	}, nil)
	resetAt := now.Add(24 * time.Hour)
	if err := reporter.usageHistory.Record(now.Add(-time.Hour), []usage.ProviderSnapshot{{
		ID: usage.ProviderCodex, Status: usage.ProviderOK, Accounts: []usage.Account{{
			LocalID: "account-1", Status: usage.ProviderOK, Limits: []usage.Limit{{
				ID: "weekly", Label: "W", RemainingPercent: 72,
				WindowKind: usage.WindowFixed, WindowDurationMins: 7 * 24 * 60, ResetsAt: &resetAt,
			}},
		}},
	}}); err != nil {
		t.Fatalf("record usage history: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodUsageHistoryGet {
			t.Fatalf("unexpected usage.history.get response: %#v", resp)
		}
		if resp.HubID != "hub-usage-history-get" || resp.Payload["hubId"] != "hub-usage-history-get" {
			t.Fatalf("response hub identity=%#v", resp)
		}
		if resp.Payload["providerId"] != "codex" || resp.Payload["accountLocalId"] != "account-1" {
			t.Fatalf("response account identity=%#v", resp.Payload)
		}
		limits, ok := resp.Payload["limits"].([]any)
		if !ok || len(limits) != 1 {
			t.Fatalf("response limits=%#v", resp.Payload["limits"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive usage.history.get response from reporter")
	}
}

func TestReporterRejectsInvalidUsageHistoryGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-usage-history-invalid", testEnvelope{
		RequestID: 102,
		Type:      "request",
		Method:    rp.RegistryMethodUsageHistoryGet,
		HubID:     "hub-usage-history-invalid",
		Payload: map[string]any{
			"providerId":     "unknown",
			"accountLocalId": "account-1",
		},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-usage-history-invalid",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "error" || resp.Payload["code"] != rp.CodeInvalidArgument {
			t.Fatalf("invalid request response=%#v", resp)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive invalid usage.history.get response")
	}
}

type deepSeekUsageStub struct {
	result usage.DeepSeekPlatformUsage
	err    error
}

func (s *deepSeekUsageStub) Get(ctx context.Context, year, month int, force bool) (usage.DeepSeekPlatformUsage, error) {
	return s.result, s.err
}

func (s *deepSeekUsageStub) SetToken(token string) {}

func TestReporterRespondsToDeepSeekUsageGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage", testEnvelope{
		RequestID: 201,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage",
		Payload:   map[string]any{"year": 2026, "month": 8},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	reporter.deepSeekUsage = &deepSeekUsageStub{result: usage.DeepSeekPlatformUsage{
		Status:  usage.DeepSeekPlatformOK,
		Month:   usage.DeepSeekPlatformMonth{Year: 2026, Month: 8},
		Balance: []usage.BalanceItem{{Currency: "CNY", Total: "3.24"}},
		Days: []usage.DeepSeekPlatformDay{{
			Date: "2026-08-01", Request: 3, OutputTokens: 120, HitTokens: 300, MissTokens: 100, TotalTokens: 520,
		}},
		Costs: []usage.DeepSeekPlatformCost{{
			Currency: "CNY", MonthlyCost: 8.8, TodayCost: 0.02,
			Daily: []usage.DeepSeekPlatformCostDay{{Date: "2026-08-01", Amount: 0.02}},
		}},
	}}

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodDeepSeekUsageGet {
			t.Fatalf("unexpected response: %#v", resp)
		}
		if resp.Payload["status"] != "ok" || resp.Payload["hubId"] != "hub-deepseek-usage" {
			t.Fatalf("response payload=%#v", resp.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive deepseek.usage.get response")
	}
}

func TestReporterRespondsToDeepSeekUsageGetErrorWithMessage(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage-error", testEnvelope{
		RequestID: 203,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage-error",
		Payload:   map[string]any{"year": 2026, "month": 8},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage-error",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	reporter.deepSeekUsage = &deepSeekUsageStub{result: usage.DeepSeekPlatformUsage{
		Status:  usage.DeepSeekPlatformError,
		Message: "platform request failed",
		Month:   usage.DeepSeekPlatformMonth{Year: 2026, Month: 8},
		Days: []usage.DeepSeekPlatformDay{{
			Date: "2026-07-31", Request: 267, OutputTokens: 213950, HitTokens: 84587904, MissTokens: 546731, TotalTokens: 85348585,
		}},
	}}

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Payload["status"] != "error" || resp.Payload["message"] != "platform request failed" {
			t.Fatalf("response payload=%#v", resp.Payload)
		}
		if days, ok := resp.Payload["days"].([]any); !ok || len(days) != 1 {
			t.Fatalf("stale days missing: %#v", resp.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive deepseek.usage.get response")
	}
}

func TestReporterRejectsInvalidDeepSeekUsageGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage-invalid", testEnvelope{
		RequestID: 202,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage-invalid",
		Payload:   map[string]any{"year": 1999, "month": 13},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage-invalid",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "error" || resp.Payload["code"] != rp.CodeInvalidArgument {
			t.Fatalf("invalid request response=%#v", resp)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive invalid deepseek.usage.get response")
	}
}

func TestReporterRejectsUnsupportedHubStateAction(t *testing.T) {
	cases := []struct {
		name    string
		section string
		action  string
	}{
		{name: "unsupported adapter action", section: "skills", action: "bogus"},
		{name: "section without actions", section: "tokenStats", action: "install"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			respSeen := make(chan testEnvelope, 1)
			errSeen := make(chan error, 1)

			ts := newFakeReporterRegistry(t, "hub-state-action", testEnvelope{
				RequestID: 100,
				Type:      "request",
				Method:    rp.RegistryMethodHubStateAction,
				HubID:     "hub-state-action",
				Payload: map[string]any{
					"section": tc.section,
					"action":  tc.action,
				},
			}, respSeen, errSeen)

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reporter := NewReporter(ReporterConfig{
				PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
				HubID:             "hub-state-action",
				ReconnectInterval: 50 * time.Millisecond,
				StateDir:          t.TempDir(),
			}, nil)

			done := make(chan error, 1)
			go func() { done <- reporter.Run(ctx) }()
			defer stopReporterForTest(t, cancel, done)

			select {
			case err := <-errSeen:
				t.Fatalf("fake registry error: %v", err)
			case resp := <-respSeen:
				if resp.Type != "error" {
					t.Fatalf("unexpected hub.state.action response: %#v", resp)
				}
				if resp.Payload["code"] != rp.CodeInvalidArgument {
					t.Fatalf("error code=%v, want %s (payload=%#v)", resp.Payload["code"], rp.CodeInvalidArgument, resp.Payload)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("did not receive hub.state.action error from reporter")
			}
		})
	}
}

func TestReporterAcceptsRestartAndRepliesBeforeSchedulingRuntime(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	callbackStarted := make(chan struct{})
	responseReleased := make(chan struct{})
	ts := newFakeReporterRegistry(t, "hub-restart", testEnvelope{
		RequestID: 101,
		Type:      "request",
		Method:    rp.RegistryMethodHubStateAction,
		HubID:     "hub-restart",
		Payload: map[string]any{
			"section": "wheelmakerUpdate",
			"action":  "restart",
			"params":  map[string]any{},
		},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-restart",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
		RestartRuntime: func() error {
			close(callbackStarted)
			<-responseReleased
			return errors.New("restart helper exited")
		},
	}, nil)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodHubStateAction {
			t.Fatalf("unexpected restart response: %#v", resp)
		}
		if resp.Payload["accepted"] != true {
			t.Fatalf("accepted=%v, want true", resp.Payload["accepted"])
		}
		result, ok := resp.Payload["result"].(map[string]any)
		if !ok {
			t.Fatalf("restart result=%#v, want object", resp.Payload["result"])
		}
		if result["ok"] != true || result["accepted"] != true ||
			result["status"] != "restart_pending" || result["hubId"] != "hub-restart" {
			t.Fatalf("restart result=%#v", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive restart response")
	}

	select {
	case <-callbackStarted:
		close(responseReleased)
	case <-time.After(2 * time.Second):
		t.Fatal("restart callback was not scheduled")
	}
}

func TestHubStateToolHandlingSerializesSharedHandler(t *testing.T) {
	toolHandler := &overlapDetectingToolCommandHandler{}
	reporter := NewReporter(ReporterConfig{HubID: "hub-state-serialized", StateDir: t.TempDir()}, nil)
	reporter.toolHandler = toolHandler

	errCh := make(chan error, 20)
	for i := 0; i < 20; i++ {
		go func() {
			_, err := reporter.runHubStateTool(context.Background(), hubToolMethodNPM, map[string]any{
				"action": "scan",
				"hubId":  "hub-state-serialized",
			})
			errCh <- err
		}()
	}

	for i := 0; i < 20; i++ {
		if err := <-errCh; err != nil {
			t.Fatalf("runHubStateTool error: %v", err)
		}
	}
	if toolHandler.sawOverlap() {
		t.Fatal("tool handler Handle calls overlapped; want serialized use")
	}
}

// methodConcurrencyToolCommandHandler tracks in-flight Handle calls per method
// to assert that same command types never overlap while distinct command types
// run concurrently.
type methodConcurrencyToolCommandHandler struct {
	mu                  sync.Mutex
	inFlight            map[string]int
	sameMethodOverlap   bool
	crossMethodParallel bool
}

func (h *methodConcurrencyToolCommandHandler) Handle(_ context.Context, method string, _ json.RawMessage) (any, *tools.CommandError) {
	h.mu.Lock()
	if h.inFlight[method] > 0 {
		h.sameMethodOverlap = true
	}
	for other, count := range h.inFlight {
		if other != method && count > 0 {
			h.crossMethodParallel = true
		}
	}
	h.inFlight[method]++
	h.mu.Unlock()

	time.Sleep(50 * time.Millisecond)

	h.mu.Lock()
	h.inFlight[method]--
	h.mu.Unlock()
	return map[string]any{"ok": true}, nil
}

func (h *methodConcurrencyToolCommandHandler) SetProjects([]ProjectInfo) {}

func (h *methodConcurrencyToolCommandHandler) ApplyRelease(_ context.Context, _ string, _ string) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func (h *methodConcurrencyToolCommandHandler) HandleDebugWebTransfer(_ string, _ json.RawMessage) (tools.ReleaseTargetStatus, *tools.CommandError) {
	return tools.ReleaseTargetStatus{Status: "accepted"}, nil
}

func TestHubStateToolHandlingParallelizesDistinctMethods(t *testing.T) {
	handler := &methodConcurrencyToolCommandHandler{inFlight: map[string]int{}}
	reporter := NewReporter(ReporterConfig{HubID: "hub-parallel-tools", StateDir: t.TempDir()}, nil)
	reporter.toolHandler = handler

	const workers = 4
	start := make(chan struct{})
	var wg sync.WaitGroup
	run := func(method string) {
		defer wg.Done()
		<-start
		_, _ = reporter.runHubStateTool(context.Background(), method, map[string]any{
			"action": "scan",
			"hubId":  "hub-parallel-tools",
		})
	}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go run(hubToolMethodNPM)
		wg.Add(1)
		go run(hubToolMethodSkills)
	}
	close(start)
	wg.Wait()

	if handler.sameMethodOverlap {
		t.Fatal("same command type calls overlapped; want per-type serialization")
	}
	if !handler.crossMethodParallel {
		t.Fatal("npm and skills did not run concurrently; want cross-type parallelism")
	}
}

func TestHubStateActionValidationMatchesAdapters(t *testing.T) {
	root := t.TempDir()
	reporter := NewReporter(
		ReporterConfig{
			HubID:    "hub-state-action-parity",
			StateDir: t.TempDir(),
			RestartRuntime: func() error {
				return nil
			},
		},
		[]ProjectInfo{{Name: "proj1", Path: root, Online: true}},
	)
	toolHandler := &stubToolCommandHandler{response: map[string]any{"ok": true}}
	reporter.toolHandler = toolHandler
	handlers := reporter.hubStateSectionHandlers()

	cases := []struct {
		section string
		action  string
		params  map[string]any
	}{
		{section: hubStateSectionAgentPackages, action: "install"},
		{section: hubStateSectionAgentPackages, action: "installMany"},
		{section: hubStateSectionAgentPackages, action: "uninstall"},
		{
			section: hubStateSectionAgentPackages,
			action:  "reinstall",
			params:  map[string]any{"packageName": "@openai/codex"},
		},
		{section: hubStateSectionWheelmakerUpdate, action: "requestUpdate"},
		{section: hubStateSectionWheelmakerUpdate, action: "restart"},
		{section: hubStateSectionGatewayUpdate, action: "requestUpdate"},
		{section: hubStateSectionSkills, action: "listSource"},
		{section: hubStateSectionSkills, action: "install"},
		{section: hubStateSectionSkills, action: "uninstall"},
		{section: hubStateSectionSkills, action: "update"},
		{section: hubStateSectionSkills, action: "previewSource"},
		{section: hubStateSectionSkills, action: "previewInstall"},
		{section: hubStateSectionSkills, action: "previewUpdate"},
		{section: hubStateSectionSkills, action: "previewDeleteSource"},
		{section: hubStateSectionSkills, action: "applyPreview"},
		{section: hubStateSectionSkills, action: "detail", params: map[string]any{"scope": "hub", "skillName": "debug"}},
		{section: hubStateSectionSkills, action: "reindex"},
		{section: "flickerBridge", action: "start"},
		{section: "flickerBridge", action: "stop"},
		{section: "flickerBridge", action: "restart"},
		{section: "flickerBridge", action: "switchMode", params: map[string]any{"mode": "v2"}},
		{
			section: hubStateSectionFileIndex,
			action:  "rebuild",
			params:  map[string]any{"projectId": rp.ProjectID("hub-state-action-parity", "proj1")},
		},
	}
	for _, tc := range cases {
		t.Run(tc.section+"/"+tc.action, func(t *testing.T) {
			if err := validateHubStateAction(tc.section, tc.action); err != nil {
				t.Fatalf("validateHubStateAction returned error: %v", err)
			}
			handler := handlers[tc.section]
			if handler.Action == nil {
				t.Fatalf("%s action handler missing", tc.section)
			}
			if tc.section == hubStateSectionFlickerBridge {
				return
			}
			if _, err := handler.Action(context.Background(), tc.action, tc.params); err != nil {
				t.Fatalf("adapter action returned error: %v", err)
			}
			if tc.section == hubStateSectionAgentPackages && tc.action == "reinstall" {
				var matched bool
				for _, call := range toolHandler.callSnapshot() {
					if call.method != hubToolMethodNPM {
						continue
					}
					var decoded map[string]any
					if err := json.Unmarshal([]byte(call.payload), &decoded); err != nil {
						t.Fatalf("decode reinstall payload: %v", err)
					}
					if decoded["action"] == "reinstall" && decoded["packageName"] == "@openai/codex" {
						matched = true
						break
					}
				}
				if !matched {
					t.Fatalf("reinstall call missing from %v", toolHandler.callSnapshot())
				}
			}
		})
	}

	invalidCases := []struct {
		section string
		action  string
	}{
		{section: hubStateSectionTokenStats, action: "install"},
		{section: hubStateSectionSkills, action: "bogus"},
		{section: "unknown", action: "install"},
	}
	for _, tc := range invalidCases {
		t.Run("invalid/"+tc.section+"/"+tc.action, func(t *testing.T) {
			if err := validateHubStateAction(tc.section, tc.action); err == nil {
				t.Fatal("validateHubStateAction error = nil, want error")
			}
		})
	}

	updateHandler := handlers[hubStateSectionWheelmakerUpdate]
	if _, err := updateHandler.Action(context.Background(), "requestUpdate", nil); err != nil {
		t.Fatalf("requestUpdate action: %v", err)
	}
	var requestCallFound bool
	for _, call := range toolHandler.callSnapshot() {
		if call.method != hubToolMethodUpdate {
			continue
		}
		var body map[string]any
		if err := json.Unmarshal([]byte(call.payload), &body); err != nil {
			t.Fatalf("payload json: %v", err)
		}
		if body["action"] == "request" {
			requestCallFound = true
			break
		}
	}
	if !requestCallFound {
		t.Fatalf("update request call missing from %v", toolHandler.callSnapshot())
	}

}

func TestSkillsStateBuildsLocationsSyncAndEffectiveSkills(t *testing.T) {
	root := t.TempDir()
	writeCanonicalSkillFixture(t, filepath.Join(root, ".agents", "skills", "scope"), "Scope", "shared description")
	writeCanonicalSkillFixture(t, filepath.Join(root, ".claude", "skills", "scope"), "Scope", "shared description")
	writeCanonicalSkillFixture(t, filepath.Join(root, ".agents", "skills", "codex-only"), "Codex", "codex description")

	state, err := scanProjectSkillsState(context.Background(), projectSkillsTarget{
		ProjectID: "hub-a:project",
		Path:      root,
		Agents:    []string{"codex", "claude"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Inventory["scope"].Sync.Status != skillSyncAligned {
		t.Fatalf("scope sync = %#v", state.Inventory["scope"].Sync)
	}
	if state.Inventory["codex-only"].Sync.Status != skillSyncUnknown {
		t.Fatalf("codex-only sync = %#v", state.Inventory["codex-only"].Sync)
	}
	if _, ok := state.EffectiveByAgent["codex"]["scope"]; !ok {
		t.Fatal("codex effective skills missing scope")
	}
	if _, ok := state.EffectiveByAgent["claude"]["scope"]; !ok {
		t.Fatal("claude effective skills missing scope")
	}
}

func TestSkillsStateAggregatesLinkedClaudeSkillDirectory(t *testing.T) {
	root := t.TempDir()
	agentsSkillDir := filepath.Join(root, ".agents", "skills", "scope")
	writeCanonicalSkillFixture(t, agentsSkillDir, "Scope", "shared description")
	claudeSkillsRoot := filepath.Join(root, ".claude", "skills")
	if err := os.MkdirAll(claudeSkillsRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	createDirLink(t, agentsSkillDir, filepath.Join(claudeSkillsRoot, "scope"))

	state, err := scanProjectSkillsState(context.Background(), projectSkillsTarget{
		ProjectID: "hub-a:project",
		Path:      root,
		Agents:    []string{"codex", "claude"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Inventory) != 1 {
		t.Fatalf("inventory = %#v, want one aggregated skill", state.Inventory)
	}
	skill := state.Inventory["scope"]
	if _, ok := skill.Locations["agents"]; !ok {
		t.Fatalf("locations = %#v, want agents location", skill.Locations)
	}
	if _, ok := skill.Locations["claude"]; !ok {
		t.Fatalf("locations = %#v, want claude location", skill.Locations)
	}
	if skill.Sync.Status != skillSyncAligned {
		t.Fatalf("sync = %#v, want aligned", skill.Sync)
	}
}

func TestSkillsStateScansNativeDiscoveryDirectoriesAndAggregatesSharedSources(t *testing.T) {
	root := t.TempDir()
	writeCanonicalSkillFixture(t, filepath.Join(root, ".agents", "skills", "shared"), "Shared", "shared description")
	writeCanonicalSkillFixture(t, filepath.Join(root, ".codebuddy", "skills", "native"), "Native", "native description")

	state, err := scanProjectSkillsState(context.Background(), projectSkillsTarget{
		ProjectID: "hub-a:project",
		Path:      root,
		Agents:    []string{"codex", "opencode", "codebuddy"},
	})
	if err != nil {
		t.Fatal(err)
	}
	shared := state.Inventory["shared"]
	if !containsFold(shared.Agents, "codex") || !containsFold(shared.Agents, "opencode") {
		t.Fatalf("shared skill agents = %v, want codex and opencode", shared.Agents)
	}
	if _, ok := shared.Locations["agents"]; !ok {
		t.Fatalf("shared locations = %#v, want agents location", shared.Locations)
	}
	native := state.Inventory["native"]
	if !containsFold(native.Agents, "codebuddy") {
		t.Fatalf("native skill agents = %v, want codebuddy", native.Agents)
	}
	if _, ok := native.Locations["codebuddy"]; !ok {
		t.Fatalf("native locations = %#v, want codebuddy location", native.Locations)
	}
}

func TestReporterDoesNotRetainSkillsWatcher(t *testing.T) {
	reporterType := reflect.TypeOf(Reporter{})
	for _, fieldName := range []string{"skillsWatcher", "skillsWatcherMu", "skillsWatcherOnce"} {
		if _, ok := reporterType.FieldByName(fieldName); ok {
			t.Fatalf("Reporter still retains Skills Watch field %q", fieldName)
		}
	}
}

func TestReadManagedSkillNamesUsesGlobalAgentsLock(t *testing.T) {
	stateHome := t.TempDir()
	t.Setenv("XDG_STATE_HOME", stateHome)
	lockPath := filepath.Join(stateHome, "skills", ".skill-lock.json")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lockPath, []byte(`{"version":1,"skills":{"scope":{"source":"owner/repo"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	managed := readManagedSkillNames("")

	if !managed["scope"] {
		t.Fatalf("global managed skills = %#v, want scope", managed)
	}
}

func TestHubSkillChangeReusesProjectLocalInventory(t *testing.T) {
	projectCalls := atomic.Int32{}
	coordinator := newSkillsStateCoordinator(skillsStateCoordinatorOptions{
		ScanHub: func(context.Context) (map[string]skillInventoryItem, error) {
			return map[string]skillInventoryItem{
				"hub-skill": {Name: "hub-skill", Agents: []string{"codex", "claude"}},
			}, nil
		},
		ScanProject: func(context.Context, projectSkillsTarget) (map[string]skillInventoryItem, error) {
			projectCalls.Add(1)
			return nil, errors.New("project scanner must not run")
		},
	})
	coordinator.seedProject("hub-a:p1", map[string]skillInventoryItem{
		"local-one": {Name: "local-one", Agents: []string{"codex"}},
	})
	coordinator.seedProject("hub-a:p2", map[string]skillInventoryItem{
		"local-two": {Name: "local-two", Agents: []string{"claude"}},
	})

	got, err := coordinator.RefreshHub(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if projectCalls.Load() != 0 {
		t.Fatalf("project scan calls = %d, want 0", projectCalls.Load())
	}
	assertCanonicalSkillNames(t, got.EffectiveSkills["hub-a:p1"]["codex"], "hub-skill", "local-one")
	assertCanonicalSkillNames(t, got.EffectiveSkills["hub-a:p2"]["claude"], "hub-skill", "local-two")
}

func TestSkillsStateAddsSourceCatalogsWithoutChangingEffectiveSkills(t *testing.T) {
	coordinator := newSkillsStateCoordinator(skillsStateCoordinatorOptions{
		ScanHub: func(context.Context) (map[string]skillInventoryItem, error) {
			return map[string]skillInventoryItem{
				"global": {Name: "global", Agents: []string{"codex"}},
			}, nil
		},
		ScanProject: func(context.Context, projectSkillsTarget) (map[string]skillInventoryItem, error) {
			return map[string]skillInventoryItem{
				"local": {Name: "local", Agents: []string{"codex"}},
			}, nil
		},
		ScanHubSources: func(context.Context, map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error) {
			return tools.SkillsSourceScopeSnapshot{Sources: []tools.SkillsSourceCatalogSnapshot{{
				SourceKey: "github.com/example/global", Status: "needs_refresh",
			}}}, nil
		},
		ScanProjectSources: func(_ context.Context, target projectSkillsTarget, _ map[string]skillInventoryItem) (tools.SkillsSourceScopeSnapshot, error) {
			return tools.SkillsSourceScopeSnapshot{Sources: []tools.SkillsSourceCatalogSnapshot{{
				SourceKey: "github.com/example/" + target.ProjectID, Status: "ready",
			}}}, nil
		},
	})
	coordinator.SetTargets([]projectSkillsTarget{{ProjectID: "p1", Agents: []string{"codex"}}})

	snapshot, err := coordinator.RefreshAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	assertCanonicalSkillNames(t, snapshot.EffectiveSkills["p1"]["codex"], "global", "local")
	if got := snapshot.HubSources.Sources[0].SourceKey; got != "github.com/example/global" {
		t.Fatalf("hub source=%q", got)
	}
	if got := snapshot.ProjectSources["p1"].Sources[0].SourceKey; got != "github.com/example/p1" {
		t.Fatalf("project source=%q", got)
	}
}

func writeCanonicalSkillFixture(t *testing.T, dir, name, description string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n", name, description)
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertCanonicalSkillNames(t *testing.T, skills []skillInventoryItem, want ...string) {
	t.Helper()
	got := make([]string, 0, len(skills))
	for _, skill := range skills {
		got = append(got, skill.Name)
	}
	slices.Sort(got)
	slices.Sort(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("skill names=%v, want %v", got, want)
	}
}

func TestReporterFlickerBridgeStateDoesNotExposeConfiguredKey(t *testing.T) {
	stateDir := t.TempDir()
	store := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
	if err := store.UpdateAPIKey(hubconfig.APIKeyFlicker, "set", "flicker-enable-key", time.Now()); err != nil {
		t.Fatal(err)
	}
	reporter := NewReporter(ReporterConfig{
		HubID:     "hub-flicker-bridge",
		StateDir:  stateDir,
		HubConfig: store,
	}, nil)
	if got := reporter.flickerBridge.localAPIKey(); got != "flicker-enable-key" {
		t.Fatalf("Flicker Bridge local key = %q, want configured key", got)
	}
	handler, ok := reporter.hubStateSectionHandlers()["flickerBridge"]
	if !ok || handler.Refresh == nil {
		t.Fatal("flickerBridge refresh handler is missing")
	}
	data, err := handler.Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-flicker-bridge"})
	if err != nil {
		t.Fatalf("refresh flickerBridge: %v", err)
	}
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal flickerBridge state: %v", err)
	}
	var state map[string]any
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("decode flickerBridge state: %v", err)
	}
	for _, field := range []string{"configured", "state", "endpoint", "port"} {
		if _, ok := state[field]; !ok {
			t.Fatalf("flickerBridge state missing %q: %s", field, raw)
		}
	}
	if strings.Contains(string(raw), "flicker-enable-key") || state["apiKey"] != nil {
		t.Fatalf("flickerBridge state leaked configured key: %s", raw)
	}
}

func TestReporterFlickerBridgeLifecycleReloadsAgentAvailability(t *testing.T) {
	reloaded := make(chan struct{}, 1)
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-flicker-agent-reload",
		StateDir: t.TempDir(),
		ReloadAgentRuntime: func(context.Context, map[hubconfig.APIKeyName]string) error {
			reloaded <- struct{}{}
			return nil
		},
	}, nil)

	reporter.updateFlickerBridgeLifecycleState(flickerBridgeStatus{State: "running"})

	select {
	case <-reloaded:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Flicker Bridge lifecycle change did not reload Agent availability")
	}
}

func TestReporterNPMMetadataChangeRefreshesPackagesWithoutReloadingAgents(t *testing.T) {
	refreshed := make(chan struct{}, 1)
	reloaded := make(chan struct{}, 1)
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-npm-metadata",
		StateDir: t.TempDir(),
		ReloadAgentRuntime: func(context.Context, map[hubconfig.APIKeyName]string) error {
			reloaded <- struct{}{}
			return nil
		},
	}, nil)
	reporter.hubStateManager = newHubStateManager(
		"hub-npm-metadata",
		"instance-a",
		map[string]hubStateSectionHandler{
			hubStateSectionAgentPackages: {
				Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
					refreshed <- struct{}{}
					return map[string]any{"ok": true}, nil
				},
			},
		},
		nil,
	)

	reporter.onNPMMetadataChanged()

	select {
	case <-refreshed:
	case <-time.After(time.Second):
		t.Fatal("NPM metadata change did not refresh agentPackages")
	}
	select {
	case <-reloaded:
		t.Fatal("NPM metadata change unexpectedly reloaded agent runtime")
	case <-time.After(20 * time.Millisecond):
	}
}

func TestReporterHubConfigAPIKeyUpdateAndSnapshot(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-config", StateDir: t.TempDir()}, nil)
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "apiKeys", Field: "kimi", Action: "set", Value: "sk-kimi-secret",
	}); err != nil {
		t.Fatalf("set apiKeys.kimi: %v", err)
	}
	snapshot, err := reporter.ensureHubConfigStore().Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.APIKeys["kimi"].Configured {
		t.Fatalf("kimi snapshot = %#v", snapshot.APIKeys["kimi"])
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-kimi-secret") {
		t.Fatalf("hub config snapshot leaked secret: %s", raw)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "apiKeys", Field: "kimi", Action: "clear",
	}); err != nil {
		t.Fatalf("clear apiKeys.kimi: %v", err)
	}
	snapshot, err = reporter.ensureHubConfigStore().Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.APIKeys["kimi"].Configured {
		t.Fatalf("kimi snapshot after clear = %#v", snapshot.APIKeys["kimi"])
	}
}

func TestReporterHubConfigMCPServerUpdatePersistsAndReloads(t *testing.T) {
	var reloadCalls int
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-mcp-config",
		StateDir: t.TempDir(),
		ReloadAgentRuntime: func(context.Context, map[hubconfig.APIKeyName]string) error {
			reloadCalls++
			return nil
		},
	}, nil)
	value, err := json.Marshal(hubconfig.MCPServerConfig{
		Name:      "neo4j",
		Enabled:   true,
		Transport: hubconfig.MCPTransportStdio,
		Command:   `C:\\Users\\test\\mcp-venvs\\neo4j\\Scripts\\python.exe`,
		Args:      []string{"-m", "neo4j_mcp_server"},
		Env: map[string]hubconfig.MCPValue{
			"NEO4J_URI":      {Value: "bolt://127.0.0.1:7687"},
			"NEO4J_PASSWORD": {Value: "secret", Secret: true},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers",
		Action:  "add",
		Value:   string(value),
	}); err != nil {
		t.Fatalf("applyHubConfigUpdate: %v", err)
	}
	if reloadCalls != 1 {
		t.Fatalf("reload calls = %d, want 1", reloadCalls)
	}
	snapshot, err := reporter.ensureHubConfigStore().Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snapshot.MCPServers) != 1 || snapshot.MCPServers[0].Name != "neo4j" {
		t.Fatalf("MCP snapshot = %#v", snapshot.MCPServers)
	}
	if got := snapshot.MCPServers[0].Env["NEO4J_PASSWORD"]; got.Value != "" || !got.Secret || !got.Configured {
		t.Fatalf("password snapshot = %#v, want redacted configured secret", got)
	}
	serverID := snapshot.MCPServers[0].ID
	updateValue, err := json.Marshal(hubconfig.MCPServerUpdate{
		ID:        serverID,
		Transport: hubconfig.MCPTransportStdio,
		Command:   "python3",
	})
	if err != nil {
		t.Fatalf("json.Marshal update: %v", err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers", Field: serverID, Action: "update", Value: string(updateValue),
	}); err != nil {
		t.Fatalf("update MCP server: %v", err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers", Field: serverID, Action: "disable",
	}); err != nil {
		t.Fatalf("disable MCP server: %v", err)
	}
	rawServers, err := reporter.ensureHubConfigStore().MCPServers()
	if err != nil || len(rawServers) != 1 || rawServers[0].Enabled {
		t.Fatalf("disabled MCP servers = %#v, %v", rawServers, err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers", Field: serverID, Action: "enable",
	}); err != nil {
		t.Fatalf("enable MCP server: %v", err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers", Field: serverID, Action: "delete",
	}); err != nil {
		t.Fatalf("delete MCP server: %v", err)
	}
	rawServers, err = reporter.ensureHubConfigStore().MCPServers()
	if err != nil || len(rawServers) != 0 {
		t.Fatalf("MCP servers after delete = %#v, %v", rawServers, err)
	}
	if reloadCalls != 5 {
		t.Fatalf("reload calls = %d, want one per MCP mutation", reloadCalls)
	}
}

func TestReporterHubConfigMCPImportAddsCodexEntriesWithoutOverwritingConflicts(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-mcp-import", StateDir: t.TempDir()}, nil)
	payload, err := json.Marshal(map[string]string{
		"source": "codex",
		"raw": `[mcp_servers.neo4j]
command = "python"
args = ["-m", "neo4j_mcp_server"]
env = { NEO4J_URI = "bolt://127.0.0.1:7687" }
`,
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers",
		Action:  "import",
		Value:   string(payload),
	}); err != nil {
		t.Fatalf("import: %v", err)
	}
	servers, err := reporter.ensureHubConfigStore().MCPServers()
	if err != nil {
		t.Fatalf("MCPServers: %v", err)
	}
	if len(servers) != 1 || servers[0].Name != "neo4j" || servers[0].ImportedFrom != "codex" {
		t.Fatalf("imported servers = %#v", servers)
	}

	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "mcpServers",
		Action:  "import",
		Value:   string(payload),
	}); err == nil || !strings.Contains(strings.ToLower(err.Error()), "conflict") {
		t.Fatalf("conflicting import error = %v, want explicit conflict", err)
	}
	servers, err = reporter.ensureHubConfigStore().MCPServers()
	if err != nil || len(servers) != 1 {
		t.Fatalf("servers after conflict = %#v, %v", servers, err)
	}
}

func TestReporterHubConfigMCPImportPreviewIsSanitized(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-mcp-preview", StateDir: t.TempDir()}, nil)
	payload, err := json.Marshal(map[string]string{
		"source": "codex",
		"raw": `[mcp_servers.neo4j]
command = "python"

[mcp_servers.neo4j.env]
NEO4J_PASSWORD = "preview-secret"

[mcp_servers.legacy]
type = "sse"
url = "https://example.test/sse"
`,
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	preview, err := reporter.previewMCPServers(string(payload))
	if err != nil {
		t.Fatalf("previewMCPServers: %v", err)
	}
	if len(preview.Servers) != 1 || len(preview.Issues) != 1 {
		t.Fatalf("preview = %#v", preview)
	}
	password := preview.Servers[0].Env["NEO4J_PASSWORD"]
	if password.Value != "" || !password.Secret || !password.Configured {
		t.Fatalf("preview password = %#v", password)
	}
}

func TestReporterHubConfigAPIKeyUpdateReloadsAgentsAndLimits(t *testing.T) {
	var reloaded map[hubconfig.APIKeyName]string
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-config-reload",
		StateDir: t.TempDir(),
		ReloadAgentRuntime: func(_ context.Context, keys map[hubconfig.APIKeyName]string) error {
			reloaded = keys
			return nil
		},
	}, nil)
	reporter.usageService = usage.NewService(usage.ServiceOptions{HubID: "hub-config-reload"})

	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "apiKeys", Field: "kimi", Action: "set", Value: "kimi-live-key",
	}); err != nil {
		t.Fatalf("set apiKeys.kimi: %v", err)
	}

	if reloaded[hubconfig.APIKeyKimi] != "kimi-live-key" {
		t.Fatalf("agent reload keys = %#v, want latest Kimi key", reloaded)
	}
	if kimi := reporter.usageCollector.KimiAPIKey; kimi != "kimi-live-key" {
		t.Fatalf("limits collector Kimi key = %q, want latest value", kimi)
	}
	deadline := time.Now().Add(time.Second)
	for reporter.usageService.Snapshot().Generation == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := reporter.usageService.Snapshot().Generation; got == 0 {
		t.Fatal("limits refresh was not triggered after API key update")
	}
}

func TestReporterHubConfigUpdateRejectsInvalidInput(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-config-invalid", StateDir: t.TempDir()}, nil)
	for name, payload := range map[string]hubConfigUpdatePayload{
		"unknown-section": {Section: "projects", Field: "kimi", Action: "set", Value: "x"},
		"unknown-key":     {Section: "apiKeys", Field: "openai", Action: "set", Value: "x"},
		"bad-action":      {Section: "apiKeys", Field: "kimi", Action: "replace", Value: "x"},
		"empty-value":     {Section: "apiKeys", Field: "kimi", Action: "set"},
		"bad-field":       {Section: "flickerBridge", Field: "mode", Action: "set", Value: "v2"},
		"bad-flag-action": {Section: "flickerBridge", Field: "enabled", Action: "toggle"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := reporter.applyHubConfigUpdate(payload); err == nil {
				t.Fatalf("payload %#v was accepted", payload)
			}
		})
	}
}

func TestReporterHubConfigFlickerEnabledPersists(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-config-flicker", StateDir: t.TempDir()}, nil)
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "flickerBridge", Field: "enabled", Action: "set",
	}); err != nil {
		t.Fatalf("enable flickerBridge: %v", err)
	}
	enabled, err := reporter.ensureHubConfigStore().FlickerBridgeEnabled()
	if err != nil || !enabled {
		t.Fatalf("enabled = %v, err = %v", enabled, err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "flickerBridge", Field: "enabled", Action: "clear",
	}); err != nil {
		t.Fatalf("disable flickerBridge: %v", err)
	}
	enabled, err = reporter.ensureHubConfigStore().FlickerBridgeEnabled()
	if err != nil || enabled {
		t.Fatalf("enabled after clear = %v, err = %v", enabled, err)
	}
}

func TestHubStartOnlyStartsFlickerBridgeWhenEnabled(t *testing.T) {
	for _, tt := range []struct {
		name       string
		enabled    bool
		wantStarts int32
	}{
		{name: "off", enabled: false, wantStarts: 0},
		{name: "enabled", enabled: true, wantStarts: 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			stateDir := t.TempDir()
			store := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
			if err := store.UpdateFlickerBridgeEnabled(tt.enabled); err != nil {
				t.Fatal(err)
			}
			manager := newFlickerBridgeManager(stateDir, defaultFlickerBridgeAPIKey, store)
			manager.supported = true
			manager.state = "stopped"
			manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
			manager.health = func(context.Context) error { return nil }
			var starts atomic.Int32
			manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
				starts.Add(1)
				return newFakeFlickerBridgeProcess(), nil
			}

			h := newHubWithFactory(
				&logger.AppConfig{Projects: []logger.ProjectConfig{}},
				filepath.Join(stateDir, "db", "client.sqlite3"),
				agent.NewACPFactory(),
			)
			h.hubConfig = store
			h.flickerBridge = manager
			defer h.Close()

			if err := h.Start(context.Background()); err != nil {
				t.Fatal(err)
			}
			if got := starts.Load(); got != tt.wantStarts {
				t.Fatalf("bridge starts = %d, want %d when enabled=%v", got, tt.wantStarts, tt.enabled)
			}
		})
	}
}

func TestReporterHubConfigKeyResolutionUsesHubConfigStore(t *testing.T) {
	stateDir := t.TempDir()
	store := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
	if err := store.UpdateAPIKey(hubconfig.APIKeyFlicker, "set", "db-flicker-key", time.Now()); err != nil {
		t.Fatal(err)
	}
	reporter := NewReporter(ReporterConfig{
		HubID:     "hub-config-resolution",
		StateDir:  stateDir,
		HubConfig: store,
	}, nil)
	if got := reporter.flickerBridge.localAPIKey(); got != "db-flicker-key" {
		t.Fatalf("Flicker Bridge local key = %q, want hub config store key", got)
	}
}

func TestReporterHubConfigKeyResolutionUsesBuiltInFlickerGate(t *testing.T) {
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-config-fallback",
		StateDir: t.TempDir(),
	}, nil)
	if got := reporter.flickerBridge.localAPIKey(); got != defaultFlickerBridgeAPIKey {
		t.Fatalf("Flicker Bridge local key = %q, want built-in local gate", got)
	}
}

func TestReporterHubConfigOverlayMarksBuiltInFlickerGate(t *testing.T) {
	reporter := NewReporter(ReporterConfig{
		HubID:    "hub-config-overlay",
		StateDir: t.TempDir(),
	}, nil)
	snapshot, err := reporter.ensureHubConfigStore().Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	reporter.overlayHubConfigDefaults(&snapshot)
	if snapshot.APIKeys["kimi"].Configured || !snapshot.APIKeys["flicker"].Configured {
		t.Fatalf("default key state is wrong: %#v", snapshot.APIKeys)
	}
	if snapshot.APIKeys["qwen"].Configured {
		t.Fatalf("qwen unexpectedly configured: %#v", snapshot.APIKeys["qwen"])
	}

	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "apiKeys", Field: "kimi", Action: "set", Value: "db-kimi-key",
	}); err != nil {
		t.Fatal(err)
	}
	if err := reporter.applyHubConfigUpdate(hubConfigUpdatePayload{
		Section: "apiKeys", Field: "kimi", Action: "clear",
	}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = reporter.ensureHubConfigStore().Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	reporter.overlayHubConfigDefaults(&snapshot)
	if snapshot.APIKeys["kimi"].Configured {
		t.Fatalf("cleared key should remain unset: %#v", snapshot.APIKeys["kimi"])
	}
}

type fakeFlickerBridgeProcess struct {
	done      chan struct{}
	killCount int
	mu        sync.Mutex
}

type fakeFlickerBridgeModeStore struct {
	mu        sync.Mutex
	mode      hubconfig.FlickerBridgeMode
	err       error
	updateErr error
}

func (s *fakeFlickerBridgeModeStore) FlickerBridgeMode() (hubconfig.FlickerBridgeMode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return "", s.err
	}
	if s.mode == "" {
		return hubconfig.FlickerBridgeModeV1, nil
	}
	return s.mode, nil
}

func (s *fakeFlickerBridgeModeStore) UpdateFlickerBridgeMode(mode hubconfig.FlickerBridgeMode) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.updateErr != nil {
		return s.updateErr
	}
	if s.err != nil {
		return s.err
	}
	s.mode = mode
	return nil
}

func TestFlickerBridgeManagerReportsConfiguredAndRunningModes(t *testing.T) {
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	status := manager.Status(context.Background())
	if status.Mode != flickerBridgeModeV1 || status.RunningMode != "" {
		t.Fatalf("status = %+v", status)
	}
	if !slices.Equal(status.AvailableModes, []flickerBridgeMode{flickerBridgeModeV1, flickerBridgeModeV2}) {
		t.Fatalf("available modes = %v", status.AvailableModes)
	}
}

func TestFlickerBridgeManagerStartsSelectedV2(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV2}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	process := newFakeFlickerBridgeProcess()
	var startedArgs []string
	var startedEnv []string
	manager.startProcess = func(_ string, args []string, environ []string, _ io.Writer) (flickerBridgeProcess, error) {
		startedArgs = append([]string(nil), args...)
		startedEnv = append([]string(nil), environ...)
		return process, nil
	}
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForFlickerBridgeState(t, manager, "running")
	if !slices.Contains(startedArgs, "--flicker-bridge-v2") {
		t.Fatalf("V2 args = %v", startedArgs)
	}
	if slices.Contains(startedEnv, "MYFLICKER_WANQING_PROXY_KEY=configured-flicker-key") {
		t.Fatalf("V2 environment leaked the V1 local key: %v", startedEnv)
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestFlickerBridgeManagerSwitchModeWhileStoppedOnlyPersists(t *testing.T) {
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		starts.Add(1)
		return newFakeFlickerBridgeProcess(), nil
	}
	status, err := manager.SwitchMode(context.Background(), flickerBridgeModeV2)
	if err != nil {
		t.Fatal(err)
	}
	if status.Mode != flickerBridgeModeV2 || status.RunningMode != "" || status.State != "stopped" {
		t.Fatalf("status = %+v", status)
	}
	if starts.Load() != 0 || store.mode != hubconfig.FlickerBridgeModeV2 {
		t.Fatalf("starts = %d, persisted = %q", starts.Load(), store.mode)
	}
}

func TestFlickerBridgeHubStateSwitchModeAction(t *testing.T) {
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	reporter := NewReporter(ReporterConfig{
		HubID:         "hub-flicker-switch",
		StateDir:      t.TempDir(),
		FlickerBridge: manager,
	}, nil)

	handler := reporter.hubStateSectionHandlers()[hubStateSectionFlickerBridge]
	result, err := handler.Action(context.Background(), "switchMode", map[string]any{"mode": "v2"})
	if err != nil {
		t.Fatal(err)
	}
	status, ok := result.(flickerBridgeStatus)
	if !ok || status.Mode != flickerBridgeModeV2 {
		t.Fatalf("switch result = %#v", result)
	}
}

func TestFlickerBridgeManagerSwitchModeFailureRollsBackV1(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		switch starts.Add(1) {
		case 1:
			return newFakeFlickerBridgeProcess(), nil
		case 2:
			return nil, errors.New("V2 start failed")
		default:
			return newFakeFlickerBridgeProcess(), nil
		}
	}
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForFlickerBridgeState(t, manager, "running")
	status, err := manager.SwitchMode(context.Background(), flickerBridgeModeV2)
	if err == nil || !strings.Contains(err.Error(), "V2 start failed") {
		t.Fatalf("SwitchMode() error = %v", err)
	}
	if status.Mode != flickerBridgeModeV1 || status.RunningMode != flickerBridgeModeV1 || status.State != "running" {
		t.Fatalf("rollback status = %+v", status)
	}
	if store.mode != hubconfig.FlickerBridgeModeV1 || starts.Load() != 3 {
		t.Fatalf("persisted = %q, starts = %d", store.mode, starts.Load())
	}
	if _, stopErr := manager.Stop(context.Background()); stopErr != nil {
		t.Fatal(stopErr)
	}
}

func TestFlickerBridgeManagerSwitchModeSuccessCommitsV2(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	first := newFakeFlickerBridgeProcess()
	second := newFakeFlickerBridgeProcess()
	processes := []*fakeFlickerBridgeProcess{first, second}
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		return processes[int(starts.Add(1))-1], nil
	}
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForFlickerBridgeState(t, manager, "running")

	status, err := manager.SwitchMode(context.Background(), flickerBridgeModeV2)
	if err != nil {
		t.Fatal(err)
	}
	if status.Mode != flickerBridgeModeV2 || status.RunningMode != flickerBridgeModeV2 || status.State != "running" {
		t.Fatalf("switch status = %+v", status)
	}
	if store.mode != hubconfig.FlickerBridgeModeV2 || starts.Load() != 2 || first.killed() != 1 {
		t.Fatalf("persisted=%q starts=%d firstKills=%d", store.mode, starts.Load(), first.killed())
	}
	if _, stopErr := manager.Stop(context.Background()); stopErr != nil {
		t.Fatal(stopErr)
	}
}

func TestFlickerBridgeManagerSwitchModePersistFailureRollsBackV1(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{
		mode:      hubconfig.FlickerBridgeModeV1,
		updateErr: errors.New("config disk unavailable"),
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		starts.Add(1)
		return newFakeFlickerBridgeProcess(), nil
	}
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForFlickerBridgeState(t, manager, "running")

	status, err := manager.SwitchMode(context.Background(), flickerBridgeModeV2)
	if err == nil || !strings.Contains(err.Error(), "config disk unavailable") {
		t.Fatalf("SwitchMode() error = %v", err)
	}
	if status.Mode != flickerBridgeModeV1 || status.RunningMode != flickerBridgeModeV1 || status.State != "running" {
		t.Fatalf("rollback status = %+v", status)
	}
	if store.mode != hubconfig.FlickerBridgeModeV1 || starts.Load() != 3 {
		t.Fatalf("persisted=%q starts=%d", store.mode, starts.Load())
	}
	if _, stopErr := manager.Stop(context.Background()); stopErr != nil {
		t.Fatal(stopErr)
	}
}

func TestFlickerBridgeManagerSwitchAndRollbackFailureRemainsFailedV1(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV1}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		switch starts.Add(1) {
		case 1:
			return newFakeFlickerBridgeProcess(), nil
		case 2:
			return nil, errors.New("target start failed")
		default:
			return nil, errors.New("rollback start failed")
		}
	}
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForFlickerBridgeState(t, manager, "running")

	status, err := manager.SwitchMode(context.Background(), flickerBridgeModeV2)
	if err == nil || !strings.Contains(err.Error(), "target start failed") || !strings.Contains(err.Error(), "rollback start failed") {
		t.Fatalf("SwitchMode() error = %v", err)
	}
	if status.Mode != flickerBridgeModeV1 || status.RunningMode != "" || status.State != "failed" {
		t.Fatalf("failed rollback status = %+v", status)
	}
	if store.mode != hubconfig.FlickerBridgeModeV1 {
		t.Fatalf("persisted mode = %q", store.mode)
	}
}

func TestFlickerBridgeManagerStartupRollbackFromV2PersistsV1(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	store := &fakeFlickerBridgeModeStore{mode: hubconfig.FlickerBridgeModeV2}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key", store)
	manager.modeAvailable = func(flickerBridgeMode) error { return nil }
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	manager.healthInterval = time.Millisecond
	var starts atomic.Int32
	manager.startProcess = func(string, []string, []string, io.Writer) (flickerBridgeProcess, error) {
		if starts.Add(1) == 1 {
			return nil, errors.New("V2 startup failed")
		}
		return newFakeFlickerBridgeProcess(), nil
	}

	status, err := manager.StartWithV2Fallback(context.Background())
	if err == nil || !strings.Contains(err.Error(), "V2 startup failed") {
		t.Fatalf("StartWithV2Fallback() error = %v", err)
	}
	if status.Mode != flickerBridgeModeV1 || status.RunningMode != flickerBridgeModeV1 || status.State != "running" {
		t.Fatalf("rollback status = %+v", status)
	}
	if store.mode != hubconfig.FlickerBridgeModeV1 || starts.Load() != 2 {
		t.Fatalf("persisted = %q, starts = %d", store.mode, starts.Load())
	}
	if _, stopErr := manager.Stop(context.Background()); stopErr != nil {
		t.Fatal(stopErr)
	}
}

func waitForFlickerBridgeState(t *testing.T, manager *flickerBridgeManager, expected string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		status := manager.Status(context.Background())
		if status.State == expected {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("Flicker Bridge state = %+v, want %s", status, expected)
		}
		time.Sleep(time.Millisecond)
	}
}

func newFakeFlickerBridgeProcess() *fakeFlickerBridgeProcess {
	return &fakeFlickerBridgeProcess{done: make(chan struct{})}
}

func (p *fakeFlickerBridgeProcess) PID() int {
	return 12345
}

func (p *fakeFlickerBridgeProcess) Kill() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.killCount++
	select {
	case <-p.done:
	default:
		close(p.done)
	}
	return nil
}

func (p *fakeFlickerBridgeProcess) Wait() error {
	<-p.done
	return nil
}

func (p *fakeFlickerBridgeProcess) killed() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.killCount
}

func TestFlickerBridgeManagerRejectsUnconfiguredStart(t *testing.T) {
	manager := newFlickerBridgeManager(t.TempDir(), "")
	status, err := manager.Start(context.Background())
	if err == nil {
		t.Fatal("Start() error = nil, want missing configuration error")
	}
	if status.Configured || status.State != "notConfigured" {
		t.Fatalf("status=%+v, want not configured", status)
	}
}

func TestFlickerBridgeManagerStartsOwnedChildAndStopsIt(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Flicker Bridge child process is Windows-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	process := newFakeFlickerBridgeProcess()
	var startedArgs []string
	var startedEnv []string
	var startedOutput io.Writer
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.startProcess = func(_ string, args []string, environ []string, output io.Writer) (flickerBridgeProcess, error) {
		startedArgs = append([]string(nil), args...)
		startedEnv = append([]string(nil), environ...)
		startedOutput = output
		return process, nil
	}
	manager.health = func(context.Context) error { return nil }

	status, err := manager.Start(context.Background())
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if status.State != "starting" || status.PID != 12345 {
		t.Fatalf("start status=%+v", status)
	}
	if !slices.Equal(startedArgs, []string{"--flicker-bridge", "--host", "127.0.0.1", "--port", "17999"}) {
		t.Fatalf("child args=%v", startedArgs)
	}
	if !slices.Contains(startedEnv, "MYFLICKER_BRIDGE_API_KEY=configured-flicker-key") {
		t.Fatalf("child environment does not contain the configured bridge key: %v", startedEnv)
	}
	if startedOutput != io.Discard {
		t.Fatalf("child bootstrap output = %T, want io.Discard because child owns its log", startedOutput)
	}

	deadline := time.Now().Add(2 * time.Second)
	for manager.Status(context.Background()).State != "running" {
		if time.Now().After(deadline) {
			t.Fatalf("bridge did not become running: %+v", manager.Status(context.Background()))
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, err = manager.Stop(context.Background())
	if err != nil {
		t.Fatalf("Stop() error: %v", err)
	}
	if status.State != "stopped" || process.killed() != 1 {
		t.Fatalf("stop status=%+v kills=%d", status, process.killed())
	}
}

func TestFlickerBridgeManagerDoesNotStartWithCanceledContext(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	var starts atomic.Int32
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
		starts.Add(1)
		return newFakeFlickerBridgeProcess(), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	status, err := manager.Start(ctx)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Start() error = %v, want context.Canceled", err)
	}
	if starts.Load() != 0 || status.State != "stopped" {
		t.Fatalf("Start() launched %d processes with status %+v", starts.Load(), status)
	}
}

func TestFlickerBridgeActionReturnsLifecycleStartFailure(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	manager.executable = func() (string, error) { return "", errors.New("executable lookup failed") }
	reporter := NewReporter(ReporterConfig{
		HubID:         "hub-flicker-action-error",
		StateDir:      t.TempDir(),
		FlickerBridge: manager,
	}, nil)

	state, err := reporter.ensureHubStateManager().action(
		context.Background(),
		hubStateSectionFlickerBridge,
		"start",
		nil,
	)

	if err == nil || !strings.Contains(err.Error(), "executable lookup failed") {
		t.Fatalf("action error = %v, state=%+v; want lifecycle start failure", err, state)
	}
}

func TestFlickerBridgeManagerSerializesConcurrentStarts(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.health = func(context.Context) error { return nil }
	release := make(chan struct{})
	entered := make(chan struct{}, 8)
	var starts atomic.Int32
	manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
		starts.Add(1)
		entered <- struct{}{}
		<-release
		return newFakeFlickerBridgeProcess(), nil
	}

	const callers = 5
	results := make(chan error, callers)
	for range callers {
		go func() {
			_, err := manager.Start(context.Background())
			results <- err
		}()
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("no start process call")
	}
	time.Sleep(30 * time.Millisecond)
	close(release)
	for range callers {
		if err := <-results; err != nil {
			t.Fatalf("Start() error: %v", err)
		}
	}
	if got := starts.Load(); got != 1 {
		t.Fatalf("start process calls = %d, want 1", got)
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestFlickerBridgeManagerHealthTimeoutKillsAndCanRestart(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.healthInterval = time.Millisecond
	manager.healthAttemptTimeout = 5 * time.Millisecond
	manager.healthTimeout = 25 * time.Millisecond
	first := newFakeFlickerBridgeProcess()
	second := newFakeFlickerBridgeProcess()
	processes := []*fakeFlickerBridgeProcess{first, second}
	var starts atomic.Int32
	manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
		index := int(starts.Add(1)) - 1
		return processes[index], nil
	}
	manager.health = func(context.Context) error { return errors.New("not ready") }

	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		status := manager.Status(context.Background())
		if status.State == "failed" && status.PID == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("health timeout did not reap process: %+v", status)
		}
		time.Sleep(time.Millisecond)
	}
	if first.killed() != 1 {
		t.Fatalf("timed out process kills = %d, want 1", first.killed())
	}

	manager.health = func(context.Context) error { return nil }
	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(time.Second)
	for manager.Status(context.Background()).State != "running" {
		if time.Now().After(deadline) {
			t.Fatalf("bridge did not recover: %+v", manager.Status(context.Background()))
		}
		time.Sleep(time.Millisecond)
	}
	if got := starts.Load(); got != 2 {
		t.Fatalf("start process calls = %d, want 2", got)
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestFlickerBridgeManagerPublishesLifecycleStateChanges(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.healthInterval = time.Millisecond
	manager.health = func(context.Context) error { return nil }
	process := newFakeFlickerBridgeProcess()
	manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
		return process, nil
	}
	states := make(chan flickerBridgeStatus, 8)
	manager.setStateChangeHandler(func(status flickerBridgeStatus) {
		states <- status
	})

	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"starting", "running"}
	for _, state := range want {
		select {
		case status := <-states:
			if status.State != state {
				t.Fatalf("state event = %+v, want %s", status, state)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %s event", state)
		}
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case status := <-states:
		if status.State != "stopped" {
			t.Fatalf("stop event = %+v", status)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for stopped event")
	}
}

func TestReporterTracksFlickerBridgeLifecycleWithoutRefreshPolling(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("Flicker Bridge child process is Windows x64-only")
	}
	manager := newFlickerBridgeManager(t.TempDir(), "configured-flicker-key")
	manager.executable = func() (string, error) { return "wheelmaker.exe", nil }
	manager.healthInterval = time.Millisecond
	manager.health = func(context.Context) error { return nil }
	manager.startProcess = func(_ string, _ []string, _ []string, _ io.Writer) (flickerBridgeProcess, error) {
		return newFakeFlickerBridgeProcess(), nil
	}
	reporter := NewReporter(ReporterConfig{
		HubID: "hub-flicker-lifecycle", StateDir: t.TempDir(), FlickerBridge: manager,
	}, nil)
	t.Cleanup(func() { _ = manager.Close() })

	if _, err := manager.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		state := reporter.ensureHubStateManager().get([]string{hubStateSectionFlickerBridge})
		section, ok := state.Sections[hubStateSectionFlickerBridge]
		raw, _ := json.Marshal(section.Data)
		if ok && strings.Contains(string(raw), `"state":"running"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("reporter state did not receive lifecycle transition: %+v", state)
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := manager.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestReporterNotifiesReleaseTargetThroughRegistry(t *testing.T) {
	server := registry.New(registry.Config{})
	ts := httptest.NewServer(server.Handler())
	t.Cleanup(ts.Close)

	target := dialWS(t, ts.URL+"/ws")
	defer target.Close()
	mustWriteJSON(t, target, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-hub", "clientVersion": "test", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "server-hub",
	}})
	init := mustReadEnvelope(t, target)
	principal := init.Payload["principal"].(map[string]any)
	mustWriteJSON(t, target, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodHubReportProjects, HubID: "server-hub", Payload: map[string]any{
		"connectionEpoch": int64(principal["connectionEpoch"].(float64)), "projects": []any{},
	}})
	_ = mustReadEnvelope(t, target)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{PublicURL: ts.URL, HubID: "publisher-hub", StateDir: t.TempDir(), ReconnectInterval: 10 * time.Millisecond}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)
	for deadline := time.Now().Add(time.Second); ; time.Sleep(time.Millisecond) {
		reporter.mu.RLock()
		connected := reporter.connectionEpoch != 0
		reporter.mu.RUnlock()
		if connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("publisher reporter did not connect")
		}
	}

	resultCh := make(chan struct {
		status tools.ReleaseTargetStatus
		err    error
	}, 1)
	go func() {
		status, err := reporter.NotifyRelease(context.Background(), "server-hub", "version", "https://release.wheelmaker.top")
		resultCh <- struct {
			status tools.ReleaseTargetStatus
			err    error
		}{status, err}
	}()
	_ = target.SetReadDeadline(time.Now().Add(time.Second))
	forwarded := mustReadEnvelope(t, target)
	if forwarded.Method != rp.RegistryMethodHubReleaseApply || forwarded.Payload["kind"] != "version" {
		t.Fatalf("forwarded=%#v", forwarded)
	}
	mustWriteJSON(t, target, testEnvelope{RequestID: forwarded.RequestID, Type: "response", Method: rp.RegistryMethodHubReleaseApply, HubID: "server-hub", Payload: map[string]any{"status": "accepted"}})
	result := <-resultCh
	if result.err != nil || result.status.Status != "accepted" {
		t.Fatalf("result=%#v", result)
	}
}

func TestReporterRejectsDebugWebReleaseNotification(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "publisher-hub"}, nil)
	_, err := reporter.NotifyRelease(context.Background(), "server-hub", "debugWeb", "https://release.wheelmaker.top")
	if err == nil || !strings.Contains(err.Error(), "version") {
		t.Fatalf("err=%v, want version-only validation error", err)
	}
}

func TestReporterOffersPerMessageDeflate(t *testing.T) {
	extensions := make(chan string, 1)
	upgrader := websocket.Upgrader{
		CheckOrigin:       func(_ *http.Request) bool { return true },
		EnableCompression: true,
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		extensions <- req.Header.Get("Sec-WebSocket-Extensions")
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{
		PublicURL: ts.URL, HubID: "compressed-hub", StateDir: t.TempDir(),
		ReconnectInterval: 10 * time.Millisecond,
	}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case extension := <-extensions:
		if !strings.Contains(extension, "permessage-deflate") {
			t.Fatalf("Sec-WebSocket-Extensions=%q, want permessage-deflate", extension)
		}
	case <-time.After(time.Second):
		t.Fatal("reporter did not connect")
	}
}

func TestReporterTransfersDebugWebInAcknowledgedChunks(t *testing.T) {
	server := registry.New(registry.Config{})
	ts := httptest.NewServer(server.Handler())
	t.Cleanup(ts.Close)
	target := dialWS(t, ts.URL+"/ws")
	defer target.Close()
	mustWriteJSON(t, target, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{"clientName": "wheelmaker-hub", "clientVersion": "test", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "web-hub"}})
	init := mustReadEnvelope(t, target)
	principal := init.Payload["principal"].(map[string]any)
	mustWriteJSON(t, target, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodHubReportProjects, HubID: "web-hub", Payload: map[string]any{"connectionEpoch": int64(principal["connectionEpoch"].(float64)), "projects": []any{}}})
	_ = mustReadEnvelope(t, target)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{PublicURL: ts.URL, HubID: "source-hub", StateDir: t.TempDir(), ReconnectInterval: 10 * time.Millisecond}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)
	for deadline := time.Now().Add(time.Second); ; time.Sleep(time.Millisecond) {
		reporter.mu.RLock()
		connected := reporter.connectionEpoch != 0
		reporter.mu.RUnlock()
		if connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("source reporter did not connect")
		}
	}

	archive := bytes.Repeat([]byte("z"), tools.DebugWebTransferChunkSize+3)
	archivePath := filepath.Join(t.TempDir(), "debug-web.zip")
	if err := os.WriteFile(archivePath, archive, 0o600); err != nil {
		t.Fatal(err)
	}
	digestBytes := sha256.Sum256(archive)
	digest := hex.EncodeToString(digestBytes[:])
	result := make(chan struct {
		status tools.ReleaseTargetStatus
		err    error
	}, 1)
	go func() {
		status, err := reporter.TransferDebugWeb(context.Background(), "web-hub", "transfer-1", archivePath, int64(len(archive)), digest)
		result <- struct {
			status tools.ReleaseTargetStatus
			err    error
		}{status: status, err: err}
	}()

	start := mustReadEnvelope(t, target)
	if start.Method != rp.RegistryMethodHubDebugWebReceiveStart || start.Payload["size"] != float64(len(archive)) || start.Payload["sha256"] != digest {
		t.Fatalf("start=%#v", start)
	}
	mustWriteJSON(t, target, testEnvelope{RequestID: start.RequestID, Type: "response", Method: start.Method, HubID: "web-hub", Payload: map[string]any{"status": "accepted"}})
	for sequence := 0; sequence < 2; sequence++ {
		chunk := mustReadEnvelope(t, target)
		if chunk.Method != rp.RegistryMethodHubDebugWebReceiveChunk || chunk.Payload["sequence"] != float64(sequence) {
			t.Fatalf("chunk=%#v", chunk)
		}
		decoded, err := base64.StdEncoding.DecodeString(chunk.Payload["data"].(string))
		if err != nil || len(decoded) == 0 || len(decoded) > tools.DebugWebTransferChunkSize {
			t.Fatalf("decoded chunk size=%d err=%v", len(decoded), err)
		}
		mustWriteJSON(t, target, testEnvelope{RequestID: chunk.RequestID, Type: "response", Method: chunk.Method, HubID: "web-hub", Payload: map[string]any{"status": "accepted"}})
	}
	finish := mustReadEnvelope(t, target)
	if finish.Method != rp.RegistryMethodHubDebugWebReceiveFinish {
		t.Fatalf("finish=%#v", finish)
	}
	mustWriteJSON(t, target, testEnvelope{RequestID: finish.RequestID, Type: "response", Method: finish.Method, HubID: "web-hub", Payload: map[string]any{"status": "success"}})
	transfer := <-result
	if transfer.err != nil || transfer.status.Status != "success" {
		t.Fatalf("transfer=%#v", transfer)
	}
}

func newFakeReporterRegistry(t *testing.T, hubID string, request testEnvelope, respSeen chan<- testEnvelope, errSeen chan<- error) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           hubID,
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		if reportReq.HubID != hubID {
			errSeen <- fmt.Errorf("report hubId=%q", reportReq.HubID)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload:   map[string]any{"ok": true},
		})

		mustWriteJSON(t, ws, request)
		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))
	t.Cleanup(ts.Close)
	return ts
}

func stopReporterForTest(t *testing.T, cancel context.CancelFunc, done <-chan error) {
	t.Helper()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("reporter did not stop")
	}
}

func TestHubStateToolAdaptersMapSectionsToExistingCommands(t *testing.T) {
	toolHandler := &stubToolCommandHandler{response: map[string]any{"ok": true}}
	reporter := NewReporter(ReporterConfig{HubID: "hub-state-adapter", StateDir: t.TempDir()}, nil)
	reporter.toolHandler = toolHandler

	handlers := reporter.hubStateSectionHandlers()
	cases := []struct {
		section string
		method  string
		action  string
	}{
		{section: hubStateSectionAgentPackages, method: hubToolMethodNPM, action: "scan"},
		{section: hubStateSectionWheelmakerUpdate, method: hubToolMethodUpdate, action: "query"},
		{section: hubStateSectionGatewayUpdate, method: hubToolMethodGatewayUpdate, action: "query"},
	}
	for _, tc := range cases {
		t.Run(tc.section, func(t *testing.T) {
			handler := handlers[tc.section]
			if handler.Refresh == nil {
				t.Fatalf("%s refresh handler missing", tc.section)
			}
			if _, err := handler.Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-state-adapter"}); err != nil {
				t.Fatalf("Refresh: %v", err)
			}
			method, payload, _ := toolHandler.snapshot()
			if method != tc.method {
				t.Fatalf("method=%q, want %q", method, tc.method)
			}
			var body map[string]any
			if err := json.Unmarshal([]byte(payload), &body); err != nil {
				t.Fatalf("payload json: %v", err)
			}
			if body["action"] != tc.action {
				t.Fatalf("action=%v, want %q (payload=%s)", body["action"], tc.action, payload)
			}
			if body["hubId"] != "hub-state-adapter" {
				t.Fatalf("hubId=%v, want hub-state-adapter (payload=%s)", body["hubId"], payload)
			}
		})
	}
}

func TestHubStateSkillsRefreshBuildsCanonicalProjectInventories(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	projectA := t.TempDir()
	projectB := t.TempDir()
	for root, skillName := range map[string]string{
		projectA: "project-a-skill",
		projectB: "project-b-skill",
	} {
		skillDir := filepath.Join(root, ".agents", "skills", skillName)
		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			t.Fatalf("MkdirAll(%s): %v", skillName, err)
		}
		if err := os.WriteFile(
			filepath.Join(skillDir, "SKILL.md"),
			[]byte("---\nname: "+skillName+"\n---\n"),
			0o644,
		); err != nil {
			t.Fatalf("WriteFile(%s): %v", skillName, err)
		}
	}

	reporter := NewReporter(
		ReporterConfig{HubID: "hub-skills-reindex", StateDir: t.TempDir()},
		[]ProjectInfo{
			{Name: "project-a", Path: projectA, Online: true, Agents: []string{"codex"}},
			{Name: "project-b", Path: projectB, Online: true, Agents: []string{"codex"}},
		},
	)
	handler := reporter.hubStateSectionHandlers()[hubStateSectionSkills]
	data, err := handler.Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-skills-reindex"})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	snapshot := data.(skillsStateSnapshot)
	for _, projectName := range []string{"project-a", "project-b"} {
		projectID := rp.ProjectID("hub-skills-reindex", projectName)
		wantSkill := projectName + "-skill"
		assertCanonicalSkillNames(t, snapshot.EffectiveSkills[projectID]["codex"], wantSkill)
	}
}

func TestHubStateSkillsActionPublishesRunningOperationWithoutReplacingInventory(t *testing.T) {
	reporter := NewReporter(
		ReporterConfig{HubID: "hub-skills-operation", StateDir: t.TempDir()},
		nil,
	)
	reporter.toolHandler = &stubToolCommandHandler{response: map[string]any{
		"ok":       true,
		"accepted": true,
		"hubId":    "hub-skills-operation",
		"operation": map[string]any{
			"running":   true,
			"action":    "install",
			"scope":     "hub",
			"status":    "running",
			"startedAt": "2026-07-31T00:00:00Z",
			"exitCode":  nil,
		},
	}}
	coordinator := reporter.ensureSkillsStateCoordinator()
	coordinator.seedProject("hub-skills-operation:project-a", map[string]skillInventoryItem{
		"existing": {Name: "existing"},
	})

	if _, err := reporter.actionHubStateSkills(
		context.Background(),
		"install",
		map[string]any{"scope": "hub", "source": "owner/repo", "skills": []string{"new"}},
	); err != nil {
		t.Fatal(err)
	}

	data, ok := reporter.ensureHubStateManager().
		get([]string{hubStateSectionSkills}).
		Sections[hubStateSectionSkills].
		Data.(skillsStateSnapshot)
	if !ok {
		t.Fatalf("skills data type = %T, want skillsStateSnapshot", data)
	}
	if data.Operation == nil || !data.Operation.Running || data.Operation.Action != "install" {
		t.Fatalf("operation = %+v, want running install", data.Operation)
	}
	if _, exists := data.ProjectLocalInventories["hub-skills-operation:project-a"]["existing"]; !exists {
		t.Fatalf("existing inventory was replaced: %+v", data.ProjectLocalInventories)
	}
}

func TestHubStateSkillsFailedPreviewRefreshesPublishedCatalogState(t *testing.T) {
	reporter := NewReporter(
		ReporterConfig{HubID: "hub-skills-preview", StateDir: t.TempDir()},
		nil,
	)
	reporter.toolHandler = &stubToolCommandHandler{err: &tools.CommandError{
		Code: rp.CodeInternal, Message: "source refresh failed",
	}}
	refreshCalls := atomic.Int32{}
	reporter.skillsState = newSkillsStateCoordinator(skillsStateCoordinatorOptions{
		ScanHub: func(context.Context) (map[string]skillInventoryItem, error) {
			refreshCalls.Add(1)
			return map[string]skillInventoryItem{}, nil
		},
	})

	_, err := reporter.actionHubStateSkills(
		context.Background(),
		"previewSource",
		map[string]any{
			"scope": "hub", "source": "https://github.com/example/catalog.git", "ref": "main",
		},
	)
	if err == nil {
		t.Fatal("previewSource error=nil, want tool failure")
	}
	if got := refreshCalls.Load(); got != 1 {
		t.Fatalf("skills refresh calls=%d, want 1 after failed preview", got)
	}
}

func TestHubStateFileIndexAdapterReturnsStatus(t *testing.T) {
	root := t.TempDir()
	reporter := NewReporter(
		ReporterConfig{HubID: "hub-file-index", StateDir: t.TempDir()},
		[]ProjectInfo{{Name: "proj1", Path: root, Online: true}},
	)

	handlers := reporter.hubStateSectionHandlers()
	handler := handlers[hubStateSectionFileIndex]
	if handler.Refresh == nil {
		t.Fatalf("%s refresh handler missing", hubStateSectionFileIndex)
	}
	data, err := handler.Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-file-index"})
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	resp, ok := data.(projectFileIndexStatusResponse)
	if !ok {
		t.Fatalf("data type=%T, want projectFileIndexStatusResponse", data)
	}
	if resp.HubID != "hub-file-index" {
		t.Fatalf("HubID=%q, want hub-file-index", resp.HubID)
	}
	if len(resp.Projects) != 1 {
		t.Fatalf("projects=%+v, want one project", resp.Projects)
	}
}

func TestReporterRun_RegistersAndServesFSRequests(t *testing.T) {
	ts := newRegistryServer(t, registry.New(registry.Config{}).Handler())

	base := t.TempDir()
	root := filepath.Join(base, "project")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	externalPath := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(externalPath, []byte("outside registry"), 0o644); err != nil {
		t.Fatalf("write external fixture: %v", err)
	}
	initGitRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello registry"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	linkedTarget := filepath.Join(root, "linked-target")
	if err := os.MkdirAll(linkedTarget, 0o755); err != nil {
		t.Fatalf("mkdir linked target: %v", err)
	}
	if err := os.WriteFile(filepath.Join(linkedTarget, "nested.txt"), []byte("nested"), 0o644); err != nil {
		t.Fatalf("write linked target fixture: %v", err)
	}
	createDirLink(t, linkedTarget, filepath.Join(root, "linked-dir"))
	runGitCmd(t, root, "add", ".")
	runGitCmd(t, root, "commit", "-m", "init")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewReporter(ReporterConfig{
		PublicURL:         ts,
		HubID:             "hub-test",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: root, Online: true}})

	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("reporter did not stop")
		}
	}()

	waitForProjectOnline(t, ts, rp.ProjectID("hub-test", "proj1"), "")

	app := dialWS(t, "http://"+ts+"/ws")
	defer app.Close()
	connectClient(t, app, "")

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "project.fs.list",
		ProjectID: rp.ProjectID("hub-test", "proj1"),
		Payload:   map[string]any{"path": ".", "limit": 50},
	})
	listResp := mustReadResponseEnvelope(t, app, 2)
	if listResp.Type != "response" || listResp.Method != "project.fs.list" {
		t.Fatalf("unexpected list response: %#v", listResp)
	}
	assertListEntryKind(t, listResp.Payload, "linked-dir", "dir")

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "project.fs.read",
		ProjectID: rp.ProjectID("hub-test", "proj1"),
		Payload:   map[string]any{"path": "hello.txt"},
	})
	readResp := mustReadEnvelope(t, app)
	if readResp.Type != "response" || readResp.Method != "project.fs.read" {
		t.Fatalf("unexpected read response: %#v", readResp)
	}
	if readResp.Payload["content"] != "hello registry" {
		t.Fatalf("content=%v, want hello registry", readResp.Payload["content"])
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "project.fs.external.info",
		ProjectID: rp.ProjectID("hub-test", "proj1"),
		Payload:   map[string]any{"path": externalPath},
	})
	externalInfo := mustReadEnvelope(t, app)
	if externalInfo.Payload["path"] != filepath.Clean(externalPath) ||
		externalInfo.Payload["kind"] != "file" {
		t.Fatalf("unexpected external info: %#v", externalInfo.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 5,
		Type:      "request",
		Method:    "project.fs.external.read",
		ProjectID: rp.ProjectID("hub-test", "proj1"),
		Payload:   map[string]any{"path": externalPath},
	})
	externalRead := mustReadEnvelope(t, app)
	if externalRead.Payload["path"] != filepath.Clean(externalPath) ||
		externalRead.Payload["content"] != "outside registry" ||
		externalRead.Payload["notModified"] != false {
		t.Fatalf("unexpected external read: %#v", externalRead.Payload)
	}

	for requestID, testCase := range []struct {
		path string
		code string
	}{
		{path: "outside.txt", code: rp.CodeInvalidArgument},
		{path: base, code: rp.CodeInvalidArgument},
		{path: filepath.Join(base, "missing.txt"), code: rp.CodeNotFound},
	} {
		mustWriteJSON(t, app, testEnvelope{
			RequestID: int64(6 + requestID),
			Type:      "request",
			Method:    "project.fs.external.info",
			ProjectID: rp.ProjectID("hub-test", "proj1"),
			Payload:   map[string]any{"path": testCase.path},
		})
		resp := mustReadEnvelope(t, app)
		if resp.Type != "error" || resp.Payload["code"] != testCase.code {
			t.Fatalf("external info path=%q response=%#v, want %s", testCase.path, resp, testCase.code)
		}
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 9,
		Type:      "request",
		Method:    "project.fs.external.read",
		ProjectID: rp.ProjectID("hub-test", "proj1"),
		Payload: map[string]any{
			"path":      externalPath,
			"knownHash": externalRead.Payload["hash"],
		},
	})
	externalReadWithHash := mustReadEnvelope(t, app)
	if externalReadWithHash.Payload["content"] != "outside registry" ||
		externalReadWithHash.Payload["notModified"] != false {
		t.Fatalf("external read should ignore knownHash: %#v", externalReadWithHash.Payload)
	}
}

func TestReporterRespondsToSessionPermissionRespondRequests(t *testing.T) {
	upgrader := websocket.Upgrader{}
	reqSeen := make(chan testEnvelope, 1)
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		request := testEnvelope{
			RequestID: 100,
			Type:      "request",
			Method:    rp.RegistryMethodSessionPermissionRespond,
			ProjectID: "hub-session:proj1",
			Payload: map[string]any{
				"sessionId":    "sess-1",
				"permissionId": "perm-1",
				"optionId":     "allow",
			},
		}
		mustWriteJSON(t, ws, request)
		reqSeen <- request

		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionPermissionRespond {
			t.Fatalf("unexpected permission response: %#v", resp)
		}
		if handler.lastMethod != rp.RegistryMethodSessionPermissionRespond || !strings.Contains(handler.lastBody, "\"permissionId\":\"perm-1\"") {
			t.Fatalf("handler saw method=%q body=%q", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.permission.respond response from reporter")
	}

}

func TestReporterForwardsSessionActionRequests(t *testing.T) {
	for _, method := range []string{
		rp.RegistryMethodSessionStatus,
		rp.RegistryMethodSessionQueue,
		rp.RegistryMethodSessionFork,
		rp.RegistryMethodSessionGoalCreate,
		rp.RegistryMethodSessionGoalGet,
		rp.RegistryMethodSessionGoalUpdate,
		rp.RegistryMethodSessionGoalStop,
		rp.RegistryMethodSessionGoalClear,
	} {
		t.Run(method, func(t *testing.T) {
			respSeen := make(chan testEnvelope, 1)
			errSeen := make(chan error, 1)
			server := newFakeReporterRegistry(t, "hub-session-actions", testEnvelope{
				RequestID: 100,
				Type:      rp.RegistryEnvelopeTypeRequest,
				Method:    method,
				ProjectID: rp.ProjectID("hub-session-actions", "proj1"),
				Payload:   map[string]any{"sessionId": "sess-1"},
			}, respSeen, errSeen)

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reporter := NewReporter(ReporterConfig{
				PublicURL:         strings.TrimPrefix(server.URL, "http://"),
				HubID:             "hub-session-actions",
				ReconnectInterval: 50 * time.Millisecond,
			}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
			handler := &stubSessionHandler{}
			reporter.RegisterSessionHandler(rp.ProjectID("hub-session-actions", "proj1"), handler)
			done := make(chan error, 1)
			go func() { done <- reporter.Run(ctx) }()
			defer stopReporterForTest(t, cancel, done)

			select {
			case err := <-errSeen:
				t.Fatalf("fake registry error: %v", err)
			case response := <-respSeen:
				if response.Type != rp.RegistryEnvelopeTypeResponse || response.Method != method {
					t.Fatalf("response=%#v, want response for %s", response, method)
				}
				if handler.lastMethod != method || !strings.Contains(handler.lastBody, `"sessionId":"sess-1"`) {
					t.Fatalf("handler saw method=%q body=%q", handler.lastMethod, handler.lastBody)
				}
			case <-time.After(2 * time.Second):
				t.Fatalf("did not receive %s response from reporter", method)
			}
		})
	}
}

func TestReporterRespondsToTerminalRequests(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-terminal", testEnvelope{
		RequestID: 101,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodTerminalList,
		HubID:     "hub-terminal",
		Payload:   map[string]any{},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{
		PublicURL: strings.TrimPrefix(ts.URL, "http://"), HubID: "hub-terminal", ReconnectInterval: 50 * time.Millisecond,
	}, nil)
	handler := &stubTerminalHandler{requests: make(chan string, 1)}
	reporter.SetTerminalHandler(handler)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatal(err)
	case request := <-handler.requests:
		if request != rp.RegistryMethodTerminalList+"::{ }" && !strings.HasPrefix(request, rp.RegistryMethodTerminalList+"::") {
			t.Fatalf("request=%q", request)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("terminal handler did not receive request")
	}
	select {
	case response := <-respSeen:
		if response.Type != rp.RegistryEnvelopeTypeResponse || response.Method != rp.RegistryMethodTerminalList {
			t.Fatalf("response=%+v", response)
		}
		terminals, ok := response.Payload["terminals"].([]any)
		if !ok || len(terminals) != 1 {
			t.Fatalf("payload=%+v", response.Payload)
		}
	case err := <-errSeen:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("terminal response was not sent")
	}
}

func TestReporterHandlesTerminalInputAndPublishesOutputEvents(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}
	outputSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()
		initReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{RequestID: initReq.RequestID, Type: "response", Method: initReq.Method, Payload: map[string]any{
			"ok": true, "principal": map[string]any{"role": "hub", "hubId": "hub-terminal-events", "connectionEpoch": 1},
			"serverInfo": map[string]any{"serverVersion": "test", "protocolVersion": rp.DefaultProtocolVersion},
			"features":   map[string]any{}, "hashAlgorithms": []string{"sha256"},
		}})
		reportReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{RequestID: reportReq.RequestID, Type: "response", Method: reportReq.Method, Payload: map[string]any{"ok": true}})
		mustWriteJSON(t, ws, testEnvelope{Type: "event", Method: rp.RegistryMethodTerminalInput, HubID: "hub-terminal-events", Payload: map[string]any{
			"terminalId": "term-1", "runId": "run-1", "data": "YQ==",
		}})
		_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
		outputSeen <- mustReadEnvelope(t, ws)
	}))
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithCancel(context.Background())
	reporter := NewReporter(ReporterConfig{
		PublicURL: strings.TrimPrefix(ts.URL, "http://"), HubID: "hub-terminal-events", ReconnectInterval: 50 * time.Millisecond,
	}, nil)
	handler := &stubTerminalHandler{inputs: make(chan rp.TerminalInputEvent, 1)}
	reporter.SetTerminalHandler(handler)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case input := <-handler.inputs:
		if input.TerminalID != "term-1" || input.RunID != "run-1" || input.Data != "YQ==" {
			t.Fatalf("input=%+v", input)
		}
	case err := <-errSeen:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("terminal input was not handled")
	}
	if err := reporter.PublishTerminalEvent(rp.RegistryMethodTerminalOutput, rp.TerminalOutputEvent{
		TerminalID: "term-1", RunID: "run-1", Seq: 1, Data: "Yg==",
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case output := <-outputSeen:
		if output.Type != rp.RegistryEnvelopeTypeEvent || output.RequestID != 0 || output.Method != rp.RegistryMethodTerminalOutput || output.HubID != "hub-terminal-events" {
			t.Fatalf("output=%+v", output)
		}
	case err := <-errSeen:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("terminal output event was not published")
	}
}

func TestReporterTerminalDebugEnvelopeRedactsDataAndSnapshot(t *testing.T) {
	var log strings.Builder
	reporter := NewReporter(ReporterConfig{HubID: "hub-terminal-log"}, nil)
	reporter.SetDebugLogger(&log)
	reporter.writeDebugEnvelope("->", envelope{
		Type: rp.RegistryEnvelopeTypeEvent, Method: rp.RegistryMethodTerminalOutput, HubID: "hub-terminal-log",
		Payload: rp.MustRaw(rp.TerminalOutputEvent{TerminalID: "term-1", RunID: "run-1", Seq: 9, Data: "c2VjcmV0LW91dHB1dA=="}),
	})
	reporter.writeDebugEnvelope("<-", envelope{
		Type: rp.RegistryEnvelopeTypeResponse, Method: rp.RegistryMethodTerminalGet, HubID: "hub-terminal-log",
		Payload: rp.MustRaw(rp.TerminalGetResponse{Terminal: rp.TerminalMetadata{TerminalID: "term-1", RunID: "run-1"}, Snapshot: "c2VjcmV0LXNuYXBzaG90"}),
	})
	got := log.String()
	if strings.Contains(got, "c2VjcmV0LW91dHB1dA==") || strings.Contains(got, "c2VjcmV0LXNuYXBzaG90") {
		t.Fatalf("terminal contents leaked into debug log: %s", got)
	}
	if !strings.Contains(got, `"terminalId":"term-1"`) || !strings.Contains(got, `"seq":9`) {
		t.Fatalf("terminal metadata missing from debug log: %s", got)
	}
}

func TestReporterDeepSeekSecretIsRedactedFromDebugEnvelope(t *testing.T) {
	var log strings.Builder
	reporter := NewReporter(ReporterConfig{HubID: "hub-deepseek-log"}, nil)
	reporter.SetDebugLogger(&log)
	reporter.writeDebugEnvelope("<-", envelope{
		Type: rp.RegistryEnvelopeTypeRequest, Method: rp.RegistryMethodHubStateAction, HubID: "hub-deepseek-log",
		Payload: rp.MustRaw(map[string]any{
			"section": "tokenStats",
			"action":  "providers",
			"params":  map[string]any{"apiKey": "backend-secret-in-envelope"},
		}),
	})
	got := log.String()
	if strings.Contains(got, "backend-secret-in-envelope") {
		t.Fatalf("secret leaked into debug log: %s", got)
	}
	if !strings.Contains(got, `"apiKey":"[redacted]"`) {
		t.Fatalf("redaction marker missing from debug log: %s", got)
	}
}

func TestReporterDebugEnvelopeRecursivelyRedactsSecretsForEveryMethod(t *testing.T) {
	var log strings.Builder
	reporter := NewReporter(ReporterConfig{HubID: "hub-recursive-redaction"}, nil)
	reporter.SetDebugLogger(&log)
	reporter.writeDebugEnvelope("<-", envelope{
		Type: rp.RegistryEnvelopeTypeRequest, Method: "connect.init", HubID: "hub-recursive-redaction",
		Payload: rp.MustRaw(map[string]any{
			"token":  "connect-secret",
			"nested": []any{map[string]any{"api_key": "nested-secret", "tokenCount": 7}},
		}),
	})
	got := log.String()
	for _, secret := range []string{"connect-secret", "nested-secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("secret %q leaked into debug log: %s", secret, got)
		}
	}
	if !strings.Contains(got, `"tokenCount":7`) {
		t.Fatalf("allowed statistics missing from debug log: %s", got)
	}
}

func TestReporterTerminalPublishQueueIsBounded(t *testing.T) {
	reporter := NewReporter(ReporterConfig{HubID: "hub-terminal-backlog"}, nil)
	sink := newHubEventSink()
	reporter.hubEventSink = sink
	for i := 0; i < cap(sink.events); i++ {
		if err := reporter.PublishTerminalEvent(rp.RegistryMethodTerminalOutput, rp.TerminalOutputEvent{
			TerminalID: "term-1", RunID: "run-1", Seq: uint64(i + 1), Data: "YQ==",
		}); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
	}
	if err := reporter.PublishTerminalEvent(rp.RegistryMethodTerminalOutput, rp.TerminalOutputEvent{
		TerminalID: "term-1", RunID: "run-1", Seq: 257, Data: "Yg==",
	}); !errors.Is(err, errTerminalPublishBacklog) {
		t.Fatalf("full queue err=%v", err)
	}
}

func TestHubSetupRegistrySharesHubConfigStoreWithReporter(t *testing.T) {
	projectRoot := t.TempDir()
	stateDir := t.TempDir()
	h := New(&logger.AppConfig{
		Projects: []logger.ProjectConfig{{Name: "proj1", Path: projectRoot}},
		HubID:    "hub-usage-keys",
		Registry: logger.RegistryConfig{Port: 9630},
	}, filepath.Join(stateDir, "db", "client.sqlite3"))
	h.setupRegistrySync()
	defer h.Close()
	if h.regSync == nil {
		t.Fatal("registry reporter was not created")
	}
	if h.regSync.hubConfig != h.hubConfig {
		t.Fatal("registry reporter does not share the Hub config store")
	}
}

func TestHubSetupRegistryUsesLoopbackWhenPublicURLIsOmitted(t *testing.T) {
	h := New(&logger.AppConfig{Token: "token", HubID: "loopback-hub"}, filepath.Join(t.TempDir(), "state.db"))
	h.setupRegistrySync()
	defer h.Close()
	if h.regSync == nil {
		t.Fatal("registry reporter was not created")
	}
	if h.regSync.cfg.PublicURL != "" || h.regSync.cfg.Port != 9630 {
		t.Fatalf("reporter config = %+v, want loopback fallback", h.regSync.cfg)
	}
}

func TestHubSetupRegistryCreatesTerminalManager(t *testing.T) {
	projectRoot := t.TempDir()
	h := New(&logger.AppConfig{
		Projects: []logger.ProjectConfig{{Name: "proj1", Path: projectRoot}},
		HubID:    "hub-terminal-setup",
		Registry: logger.RegistryConfig{Port: 9630},
	}, filepath.Join(t.TempDir(), "state.db"))
	h.setupRegistrySync()
	defer h.Close()
	if h.regSync == nil || h.terminalManager == nil {
		t.Fatalf("registry=%v terminalManager=%v", h.regSync, h.terminalManager)
	}
	if h.regSync.terminalHandler == nil {
		t.Fatal("Reporter terminal handler was not registered")
	}
}

func TestReporterVerboseEnvelopeLogsDoNotIncludePayloadOrTiming(t *testing.T) {
	var logs bytes.Buffer
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelVerbose}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	t.Cleanup(logger.Close)
	logger.SetOutput(&logs)

	upgrader := websocket.Upgrader{}
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session",
					"connectionEpoch": 1,
				},
				"serverInfo":     map[string]any{"serverVersion": "test", "protocolVersion": rp.DefaultProtocolVersion},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload:   map[string]any{"ok": true},
		})

		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 100,
			Type:      "request",
			Method:    rp.RegistryMethodSessionQueue,
			ProjectID: "hub-session:proj1",
			Payload: map[string]any{
				"sessionId": "sess-secret",
				"action":    "enqueue",
				"item": map[string]any{
					"itemId": "item-secret",
					"kind":   "prompt",
					"blocks": []map[string]any{{"type": "text", "text": "hello session"}},
				},
			},
		})
		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session", "proj1"), &stubSessionHandler{})

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionQueue {
			t.Fatalf("unexpected response: %#v", resp)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.queue response")
	}

	got := logs.String()
	for _, want := range []string{
		"envelope dir=in type=request requestId=100 method=session.queue projectId=hub-session:proj1",
		"envelope dir=out type=response requestId=100 method=session.queue projectId=hub-session:proj1",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"durationMs", "handlerDurationMs", "writeDurationMs", "sessionId", "sess-secret", "item-secret", "hello session"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("log contains forbidden %q in:\n%s", forbidden, got)
		}
	}
}

func TestReporterForwardsSessionSearchRequests(t *testing.T) {
	upgrader := websocket.Upgrader{}
	reqSeen := make(chan testEnvelope, 1)
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session-search",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		request := testEnvelope{
			RequestID: 101,
			Type:      "request",
			Method:    "session.search",
			ProjectID: "hub-session-search:proj1",
			Payload: map[string]any{
				"action":   "start",
				"searchId": "search-1",
				"query":    "deploy",
			},
		}
		mustWriteJSON(t, ws, request)
		reqSeen <- request

		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session-search",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-search", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.search request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != "session.search" {
			t.Fatalf("unexpected session.search response: %#v", resp)
		}
		if handler.lastMethod != "session.search" || !strings.Contains(handler.lastBody, "\"searchId\":\"search-1\"") {
			t.Fatalf("handler saw method=%q body=%q", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.search response from reporter")
	}
}

func TestReporterForwardsSessionArchiveRecoveryRequests(t *testing.T) {
	upgrader := websocket.Upgrader{}
	reqSeen := make(chan testEnvelope, 3)
	respSeen := make(chan testEnvelope, 3)
	errSeen := make(chan error, 1)
	methods := []string{
		rp.RegistryMethodSessionArchiveList,
		rp.RegistryMethodSessionArchiveRead,
		rp.RegistryMethodSessionArchiveRestore,
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session-archive",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		for index, method := range methods {
			request := testEnvelope{
				RequestID: int64(201 + index),
				Type:      "request",
				Method:    method,
				ProjectID: "hub-session-archive:proj1",
				Payload: map[string]any{
					"sessionId": "sess-archive",
				},
			}
			mustWriteJSON(t, ws, request)
			reqSeen <- request

			_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
			respSeen <- mustReadEnvelope(t, ws)
		}
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session-archive",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-archive", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	for _, method := range methods {
		select {
		case err := <-errSeen:
			t.Fatalf("fake registry error: %v", err)
		case <-reqSeen:
		case <-time.After(2 * time.Second):
			t.Fatalf("did not receive %s request", method)
		}

		select {
		case err := <-errSeen:
			t.Fatalf("fake registry error: %v", err)
		case resp := <-respSeen:
			if resp.Type != "response" || resp.Method != method {
				t.Fatalf("unexpected %s response: %#v", method, resp)
			}
			if handler.lastMethod != method || !strings.Contains(handler.lastBody, `"sessionId":"sess-archive"`) {
				t.Fatalf("handler saw method=%q body=%q, want %s payload", handler.lastMethod, handler.lastBody, method)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("did not receive %s response from reporter", method)
		}
	}
}

func TestReporterRespondsToSessionAttachmentRequests(t *testing.T) {
	addr := newRegistryServer(t, registry.New(registry.Config{}).Handler())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	reporter := NewReporter(ReporterConfig{
		PublicURL:         addr,
		HubID:             "hub-attachment",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-attachment", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	waitForProjectOnline(t, addr, "hub-attachment:proj1", "")
	app := dialWS(t, "http://"+addr+"/ws")
	defer app.Close()
	connectClient(t, app, "")

	cases := []struct {
		requestID int64
		method    string
		payload   map[string]any
		wantBody  string
	}{
		{
			requestID: 2,
			method:    rp.RegistryMethodSessionAttachmentStart,
			payload: map[string]any{
				"sessionId": "sess-1",
				"name":      "a.txt",
				"mimeType":  "text/plain",
				"size":      1,
			},
			wantBody: `"name":"a.txt"`,
		},
		{
			requestID: 3,
			method:    rp.RegistryMethodSessionAttachmentThumbnail,
			payload: map[string]any{
				"sessionId":    "sess-1",
				"attachmentId": "sha256-image",
			},
			wantBody: `"attachmentId":"sha256-image"`,
		},
		{
			requestID: 4,
			method:    rp.RegistryMethodSessionAttachmentRead,
			payload: map[string]any{
				"sessionId":    "sess-1",
				"attachmentId": "sha256-image",
			},
			wantBody: `"attachmentId":"sha256-image"`,
		},
	}
	for _, tc := range cases {
		mustWriteJSON(t, app, testEnvelope{
			RequestID: tc.requestID,
			Type:      "request",
			Method:    tc.method,
			ProjectID: "hub-attachment:proj1",
			Payload:   tc.payload,
		})
		resp := mustReadEnvelope(t, app)
		if resp.Type != "response" || resp.Method != tc.method {
			t.Fatalf("unexpected %s response: %#v", tc.method, resp)
		}
		if handler.lastMethod != tc.method || !strings.Contains(handler.lastBody, tc.wantBody) {
			t.Fatalf("handler saw method=%q body=%q, want %s payload", handler.lastMethod, handler.lastBody, tc.method)
		}
	}
}

func TestReporterForwardsSessionArtifactReadRequests(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := newFakeReporterRegistry(t, "hub-artifact-read", testEnvelope{
		RequestID: 100,
		Type:      "request",
		Method:    rp.RegistryMethodSessionArtifactRead,
		ProjectID: "hub-artifact-read:proj1",
		Payload: map[string]any{
			"sessionId":  "sess-1",
			"artifactId": "diff-1234",
		},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-artifact-read",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-artifact-read", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionArtifactRead {
			t.Fatalf("unexpected session.artifact.read response: %#v", resp)
		}
		if handler.lastMethod != rp.RegistryMethodSessionArtifactRead || !strings.Contains(handler.lastBody, `"artifactId":"diff-1234"`) {
			t.Fatalf("handler saw method=%q body=%q, want session.artifact.read payload", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.artifact.read response from reporter")
	}
}

func TestReporterRejectsPublicCmdRequests(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := newFakeReporterRegistry(t, "hub-cmd-reject", testEnvelope{
		RequestID: 100,
		Type:      "request",
		Method:    "cmd.npm",
		Payload: map[string]any{
			"action": "scan",
			"hubId":  "hub-cmd-reject",
		},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-cmd-reject",
		ReconnectInterval: 50 * time.Millisecond,
	}, nil)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "error" || resp.Method != "cmd.npm" {
			t.Fatalf("unexpected cmd.npm response: %#v", resp)
		}
		if resp.Payload["code"] != codeInvalidArgument {
			t.Fatalf("payload=%#v, want INVALID_ARGUMENT", resp.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive cmd.npm error from reporter")
	}
}

func TestReporterRespondsToSessionSetConfigRequests(t *testing.T) {
	reqSeen := make(chan testEnvelope, 1)
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		request := testEnvelope{
			RequestID: 101,
			Type:      "request",
			Method:    "session.config",
			ProjectID: "hub-session:proj1",
			Payload: map[string]any{
				"sessionId": "sess-1",
				"configId":  "model",
				"value":     "gpt-5",
			},
		}
		mustWriteJSON(t, ws, request)
		reqSeen <- request

		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.config request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != "session.config" {
			t.Fatalf("unexpected session.config response: %#v", resp)
		}
		if handler.lastMethod != "session.config" || !strings.Contains(handler.lastBody, "\"configId\":\"model\"") {
			t.Fatalf("handler saw method=%q body=%q", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.config response from reporter")
	}

}

func TestReporterForwardsSessionDeleteRequests(t *testing.T) {
	reqSeen := make(chan testEnvelope, 1)
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session-del",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		request := testEnvelope{
			RequestID: 102,
			Type:      "request",
			Method:    "session.delete",
			ProjectID: "hub-session-del:proj1",
			Payload: map[string]any{
				"sessionId": "sess-1",
			},
		}
		mustWriteJSON(t, ws, request)
		reqSeen <- request

		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session-del",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-del", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.delete request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != "session.delete" {
			t.Fatalf("unexpected session.delete response: %#v", resp)
		}
		if resp.Payload["ok"] != true || resp.Payload["sessionId"] != "sess-1" {
			t.Fatalf("session.delete response payload=%#v, want ok sessionId", resp.Payload)
		}
		if handler.lastMethod != "session.delete" || !strings.Contains(handler.lastBody, `"sessionId":"sess-1"`) {
			t.Fatalf("handler saw method=%q body=%q, want session.delete payload", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.delete response from reporter")
	}
}

func TestReporterForwardsSessionRenameRequests(t *testing.T) {
	reqSeen := make(chan testEnvelope, 1)
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session-rename",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload: map[string]any{
				"ok": true,
			},
		})

		request := testEnvelope{
			RequestID: 103,
			Type:      "request",
			Method:    "session.rename",
			ProjectID: "hub-session-rename:proj1",
			Payload: map[string]any{
				"sessionId": "sess-1",
				"title":     "Manual title",
			},
		}
		mustWriteJSON(t, ws, request)
		reqSeen <- request

		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session-rename",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
	handler := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-rename", "proj1"), handler)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.rename request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != "session.rename" {
			t.Fatalf("unexpected session.rename response: %#v", resp)
		}
		if resp.Payload["ok"] != true || resp.Payload["sessionId"] != "sess-1" {
			t.Fatalf("session.rename response payload=%#v, want ok sessionId", resp.Payload)
		}
		if handler.lastMethod != "session.rename" || !strings.Contains(handler.lastBody, `"title":"Manual title"`) {
			t.Fatalf("handler saw method=%q body=%q, want session.rename payload", handler.lastMethod, handler.lastBody)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.rename response from reporter")
	}
}

func TestReporterForwardsSessionPinAndMarkToProjectHandlerAndRequiresProjectID(t *testing.T) {
	reqSeen := make(chan struct{}, 1)
	respSeen := make(chan testEnvelope, 3)
	errSeen := make(chan error, 1)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			errSeen <- err
			return
		}
		defer ws.Close()

		initReq := mustReadEnvelope(t, ws)
		if initReq.Method != "connect.init" {
			errSeen <- fmt.Errorf("init method=%q", initReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type:      "response",
			Method:    "connect.init",
			Payload: map[string]any{
				"ok": true,
				"principal": map[string]any{
					"role":            "hub",
					"hubId":           "hub-session-pin",
					"connectionEpoch": 1,
				},
				"serverInfo": map[string]any{
					"serverVersion":   "test",
					"protocolVersion": rp.DefaultProtocolVersion,
				},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})

		reportReq := mustReadEnvelope(t, ws)
		if reportReq.Method != "hub.report.projects" {
			errSeen <- fmt.Errorf("report method=%q", reportReq.Method)
			return
		}
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: reportReq.RequestID,
			Type:      "response",
			Method:    "hub.report.projects",
			Payload:   map[string]any{"ok": true},
		})

		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 104,
			Type:      "request",
			Method:    rp.RegistryMethodSessionPin,
			ProjectID: "hub-session-pin:proj1",
			Payload: map[string]any{
				"sessionId": "sess-1",
				"pinned":    true,
			},
		})
		reqSeen <- struct{}{}
		_ = ws.SetReadDeadline(time.Now().Add(1500 * time.Millisecond))
		respSeen <- mustReadEnvelope(t, ws)

		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 105,
			Type:      "request",
			Method:    rp.RegistryMethodSessionMark,
			ProjectID: "hub-session-pin:proj1",
			Payload: map[string]any{
				"sessionId": "sess-1",
				"markColor": "blue",
			},
		})
		respSeen <- mustReadEnvelope(t, ws)

		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 106,
			Type:      "request",
			Method:    rp.RegistryMethodSessionMark,
			Payload: map[string]any{
				"sessionId": "sess-1",
				"markColor": "",
			},
		})
		respSeen <- mustReadEnvelope(t, ws)
	}))

	t.Cleanup(ts.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		PublicURL:         strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-session-pin",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{
		{Name: "proj1", Path: t.TempDir(), Online: true},
		{Name: "proj2", Path: t.TempDir(), Online: true},
	})
	target := &stubSessionHandler{}
	other := &stubSessionHandler{}
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-pin", "proj1"), target)
	reporter.RegisterSessionHandler(rp.ProjectID("hub-session-pin", "proj2"), other)

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("reporter did not stop")
		}
	}()

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case <-reqSeen:
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.pin request")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionPin || resp.ProjectID != "hub-session-pin:proj1" {
			t.Fatalf("unexpected session.pin response: %#v", resp)
		}
		if resp.Payload["ok"] != true || resp.Payload["sessionId"] != "sess-1" {
			t.Fatalf("session.pin response payload=%#v, want ok sessionId", resp.Payload)
		}
		if target.calls != 1 || target.lastMethod != rp.RegistryMethodSessionPin || target.lastProject != "hub-session-pin:proj1" || !strings.Contains(target.lastBody, `"pinned":true`) {
			t.Fatalf("target handler calls=%d method=%q project=%q body=%q", target.calls, target.lastMethod, target.lastProject, target.lastBody)
		}
		if other.calls != 0 {
			t.Fatalf("other project handler calls=%d, want 0", other.calls)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.pin response from reporter")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodSessionMark || resp.ProjectID != "hub-session-pin:proj1" {
			t.Fatalf("unexpected session.mark response: %#v", resp)
		}
		if target.calls != 2 || target.lastMethod != rp.RegistryMethodSessionMark ||
			target.lastProject != "hub-session-pin:proj1" || !strings.Contains(target.lastBody, `"markColor":"blue"`) {
			t.Fatalf("target handler calls=%d method=%q project=%q body=%q", target.calls, target.lastMethod, target.lastProject, target.lastBody)
		}
		if other.calls != 0 {
			t.Fatalf("other project handler calls=%d, want 0", other.calls)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive session.mark response from reporter")
	}

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "error" || resp.Payload["message"] != "projectId is required" {
			t.Fatalf("missing projectId response=%#v", resp)
		}
		if target.calls != 2 || other.calls != 0 {
			t.Fatalf("missing projectId routed to a handler: target=%d other=%d", target.calls, other.calls)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive missing projectId error")
	}
}

func TestReporterRunReturnsOnContextCancel(t *testing.T) {
	ts := newRegistryServer(t, registry.New(registry.Config{}).Handler())
	ctx, cancel := context.WithCancel(context.Background())
	r := NewReporter(ReporterConfig{
		PublicURL:         ts,
		HubID:             "hub-cancel",
		ReconnectInterval: 30 * time.Millisecond,
	}, []ProjectInfo{{Name: "server", Path: t.TempDir(), Online: true}})

	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	time.Sleep(60 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() err = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run() did not return after cancel")
	}
}

func TestReporterAuth(t *testing.T) {
	ts := newRegistryServer(t, registry.New(registry.Config{Token: "token-1"}).Handler())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewReporter(ReporterConfig{
		PublicURL:         ts,
		Token:             "token-1",
		HubID:             "hub-auth",
		ReconnectInterval: 30 * time.Millisecond,
	}, []ProjectInfo{{Name: "server", Path: t.TempDir(), Online: true}})
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	defer func() { cancel(); <-done }()

	waitForProjectOnline(t, ts, rp.ProjectID("hub-auth", "server"), "token-1")
}

func TestReporterGitRevisionOptionRejected(t *testing.T) {
	root := t.TempDir()
	initGitRepo(t, root)
	outputPath := filepath.Join(root, "injected-output.txt")
	for _, testCase := range []struct {
		name    string
		method  string
		payload map[string]any
	}{
		{name: "ref", method: "project.git.log", payload: map[string]any{"ref": "--output=" + outputPath}},
		{name: "refs", method: "project.git.log", payload: map[string]any{"refs": []string{"HEAD", "--help"}}},
		{name: "sha files", method: "project.git.commit.files", payload: map[string]any{"sha": "-cprotocol.file.allow=always"}},
		{name: "sha diff", method: "project.git.commit.fileDiff", payload: map[string]any{"sha": "--help", "path": "tracked.txt"}},
		{name: "commit diff", method: "project.git.commit.diff", payload: map[string]any{"sha": "--help"}},
		{name: "base", method: "project.git.diff", payload: map[string]any{"base": "--help", "head": "HEAD"}},
		{name: "head", method: "project.git.diff.fileDiff", payload: map[string]any{"base": "HEAD", "head": "--help", "path": "tracked.txt"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			respSeen := make(chan testEnvelope, 1)
			errSeen := make(chan error, 1)
			server := newFakeReporterRegistry(t, "hub-git-guard", testEnvelope{
				RequestID: 100,
				Type:      "request",
				Method:    testCase.method,
				ProjectID: rp.ProjectID("hub-git-guard", "proj1"),
				Payload:   testCase.payload,
			}, respSeen, errSeen)

			ctx, cancel := context.WithCancel(context.Background())
			reporter := NewReporter(ReporterConfig{
				PublicURL:         strings.TrimPrefix(server.URL, "http://"),
				HubID:             "hub-git-guard",
				ReconnectInterval: 50 * time.Millisecond,
			}, []ProjectInfo{{Name: "proj1", Path: root, Online: true}})
			done := make(chan error, 1)
			go func() { done <- reporter.Run(ctx) }()

			select {
			case err := <-errSeen:
				stopReporterForTest(t, cancel, done)
				t.Fatalf("fake registry error: %v", err)
			case response := <-respSeen:
				stopReporterForTest(t, cancel, done)
				if response.Type != "error" || response.Payload["code"] != rp.CodeInvalidArgument {
					t.Fatalf("response=%#v, want invalid_argument", response)
				}
			case <-time.After(2 * time.Second):
				stopReporterForTest(t, cancel, done)
				t.Fatal("did not receive git revision rejection")
			}
		})
	}
	if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
		t.Fatalf("malicious revision created %s: %v", outputPath, err)
	}
}

func TestReporterUpdateProjectRefreshesRegistrySnapshot(t *testing.T) {
	ts := newRegistryServer(t, registry.New(registry.Config{}).Handler())

	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewReporter(ReporterConfig{
		PublicURL:         ts,
		HubID:             "hub-update",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: root, Online: true, ProjectRev: "p1", Git: rp.ProjectGitState{GitRev: "g1", WorktreeRev: "w1"}}})

	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("reporter did not stop")
		}
	}()

	waitForProjectOnline(t, ts, rp.ProjectID("hub-update", "proj1"), "")

	if err := r.UpdateProject(ProjectInfo{
		Name:       "proj1",
		Path:       root,
		Online:     true,
		ProjectRev: "p2",
		Git: rp.ProjectGitState{
			GitRev:      "g2",
			WorktreeRev: "w2",
			Dirty:       true,
		},
	}); err != nil {
		t.Fatalf("UpdateProject() err = %v", err)
	}

	app := dialWS(t, "http://"+ts+"/ws")
	defer app.Close()
	connectClient(t, app, "")
	mustWriteJSON(t, app, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	resp := mustReadEnvelope(t, app)
	projects, ok := resp.Payload["projects"].([]any)
	if !ok || len(projects) != 1 {
		t.Fatalf("projects=%v, want 1 item", resp.Payload["projects"])
	}
	project, _ := projects[0].(map[string]any)
	if project["projectRev"] != "p2" {
		t.Fatalf("projectRev=%v, want p2", project["projectRev"])
	}
	gitState, _ := project["git"].(map[string]any)
	if gitState["gitRev"] != "g2" || gitState["dirty"] != true {
		t.Fatalf("git=%v, want updated rev/dirty", gitState)
	}
}

func TestReporterFSHashNegotiationAndGitStatus(t *testing.T) {
	ts := newRegistryServer(t, registry.New(registry.Config{}).Handler())

	root := t.TempDir()
	initGitRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("alpha\nbeta\n"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	runGitCmd(t, root, "add", ".")
	runGitCmd(t, root, "commit", "-m", "init")
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("alpha\nbeta\ngamma\n"), 0o644); err != nil {
		t.Fatalf("update fixture: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewReporter(ReporterConfig{
		PublicURL:         ts,
		HubID:             "hub-hash",
		ReconnectInterval: 50 * time.Millisecond,
	}, []ProjectInfo{{Name: "proj1", Path: root, Online: true}})

	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("reporter did not stop")
		}
	}()

	waitForProjectOnline(t, ts, rp.ProjectID("hub-hash", "proj1"), "")

	app := dialWS(t, "http://"+ts+"/ws")
	defer app.Close()
	connectClient(t, app, "")

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "project.fs.list",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"path": "."},
	})
	listResp := mustReadEnvelope(t, app)
	listHash, _ := listResp.Payload["hash"].(string)
	if listHash == "" || listResp.Payload["notModified"] != false {
		t.Fatalf("unexpected project.fs.list payload: %#v", listResp.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "project.fs.list",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"path": ".", "knownHash": listHash},
	})
	listCached := mustReadResponseEnvelope(t, app, 3)
	if listCached.Payload["notModified"] != true {
		t.Fatalf("expected notModified project.fs.list response: %#v", listCached.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "project.fs.read",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"path": "hello.txt"},
	})
	readResp := mustReadResponseEnvelope(t, app, 4)
	readHash, _ := readResp.Payload["hash"].(string)
	if readHash == "" || readResp.Payload["notModified"] != false {
		t.Fatalf("unexpected project.fs.read payload: %#v", readResp.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 5,
		Type:      "request",
		Method:    "project.fs.read",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"path": "hello.txt", "knownHash": readHash},
	})
	readCached := mustReadResponseEnvelope(t, app, 5)
	if readCached.Payload["notModified"] != true {
		t.Fatalf("expected notModified project.fs.read response: %#v", readCached.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 6,
		Type:      "request",
		Method:    "project.git.rev",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{},
	})
	revResp := mustReadResponseEnvelope(t, app, 6)
	expectedGitState := collectGitState(root)
	if got := revResp.Payload["gitRev"]; got != expectedGitState.GitRev {
		t.Fatalf("project.git.rev gitRev=%v, want %s", got, expectedGitState.GitRev)
	}
	if got := revResp.Payload["worktreeRev"]; got != expectedGitState.WorktreeRev {
		t.Fatalf("project.git.rev worktreeRev=%v, want %s", got, expectedGitState.WorktreeRev)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 7,
		Type:      "request",
		Method:    "project.git.status",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{},
	})
	statusResp := mustReadResponseEnvelope(t, app, 7)
	if statusResp.Payload["dirty"] != true {
		t.Fatalf("expected dirty project.git.status payload: %#v", statusResp.Payload)
	}
	if got, want := statusResp.Payload["worktreeRev"], collectGitState(root).WorktreeRev; got != want {
		t.Fatalf("project.git.status worktreeRev=%v, want reported normalized rev %s", got, want)
	}
	unstaged, _ := statusResp.Payload["unstaged"].([]any)
	if len(unstaged) == 0 {
		t.Fatalf("expected unstaged entries: %#v", statusResp.Payload)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 8,
		Type:      "request",
		Method:    "project.git.workingTree.fileDiff",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"path": "hello.txt", "scope": "unstaged", "contextLines": 2},
	})
	diffResp := mustReadResponseEnvelope(t, app, 8)
	diffText, _ := diffResp.Payload["diff"].(string)
	if !strings.Contains(diffText, "+gamma") {
		t.Fatalf("unexpected working tree diff: %q", diffText)
	}

	mustWriteJSON(t, app, testEnvelope{
		RequestID: 9,
		Type:      "request",
		Method:    "project.git.commit.diff",
		ProjectID: rp.ProjectID("hub-hash", "proj1"),
		Payload:   map[string]any{"sha": "HEAD", "contextLines": 2},
	})
	commitDiffResp := mustReadResponseEnvelope(t, app, 9)
	commitDiffText, _ := commitDiffResp.Payload["diff"].(string)
	if !strings.Contains(commitDiffText, "diff --git") || !strings.Contains(commitDiffText, "hello.txt") {
		t.Fatalf("unexpected commit diff: %q", commitDiffText)
	}
}

func TestBuildWSURLDefaults(t *testing.T) {
	got, err := buildWSURL("", 9630)
	if err != nil || got != "ws://127.0.0.1:9630/ws" {
		t.Fatalf("buildWSURL() = %q, err=%v", got, err)
	}
}

func TestBuildWSURLAbsoluteURL(t *testing.T) {
	got, err := buildWSURL("http://127.0.0.1:9630", 0)
	if err != nil || got != "ws://127.0.0.1:9630/ws" {
		t.Fatalf("buildWSURL() = %q, err=%v", got, err)
	}
}

func TestBuildWSURLCanonicalPublicURL(t *testing.T) {
	tests := []struct {
		name string
		base string
		want string
	}{
		{name: "remote https", base: "https://registry.example.com:28800", want: "wss://registry.example.com:28800/ws"},
		{name: "remote https with legacy ws path", base: "https://registry.example.com:28800/ws", want: "wss://registry.example.com:28800/ws"},
		{name: "loopback http", base: "http://localhost:9630", want: "ws://localhost:9630/ws"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := buildWSURL(tt.base, 0)
			if err != nil || got != tt.want {
				t.Fatalf("buildWSURL(%q) = %q, err=%v; want %q", tt.base, got, err, tt.want)
			}
		})
	}
}

func TestBuildWSURLRejectsNonOriginPath(t *testing.T) {
	if _, err := buildWSURL("https://registry.example.com/api", 0); err == nil {
		t.Fatal("buildWSURL() error=nil, want non-origin path rejection")
	}
}

func TestBuildWSURLRejectsBareRemoteHost(t *testing.T) {
	if _, err := buildWSURL("registry.example.com:28800", 0); err == nil {
		t.Fatal("buildWSURL() error=nil, want canonical origin requirement")
	}
}

func TestReporterDebugEnvelope_OneLineWithDirection(t *testing.T) {
	var sb strings.Builder
	r := NewReporter(ReporterConfig{}, nil)
	r.SetDebugLogger(&sb)

	r.writeDebugEnvelope("->", envelope{
		RequestID: 1,
		Type:      "request",
		Method:    "hub.report.projects",
		Payload:   []byte(`{"hubId":"hub-1","note":"hello\nworld"}`),
	})
	r.writeDebugEnvelope("<-", envelope{
		RequestID: 1,
		Type:      "response",
		Method:    "hub.report.projects",
		Payload:   []byte(`{"ok":true}`),
	})

	lines := strings.Split(strings.TrimSpace(sb.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("line count=%d, want 2; logs=%q", len(lines), sb.String())
	}
	if !strings.HasPrefix(lines[0], "->[registry] ") {
		t.Fatalf("first line prefix=%q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "<-[registry] ") {
		t.Fatalf("second line prefix=%q", lines[1])
	}
}

func newRegistryServer(t *testing.T, h http.Handler) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: h}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = ln.Close()
	})
	return ln.Addr().String()
}

func connectClient(t *testing.T, ws *websocket.Conn, token string) {
	t.Helper()
	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           token,
		},
	})
	_ = mustReadEnvelope(t, ws)
}

func waitForProjectOnline(t *testing.T, addr, projectID, token string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		ws := dialWS(t, "http://"+addr+"/ws")
		connectClient(t, ws, token)
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 2, Type: "request", Method: "registry.project.list", Payload: map[string]any{},
		})
		resp := mustReadEnvelope(t, ws)
		_ = ws.Close()
		projects, ok := resp.Payload["projects"].([]any)
		if ok {
			for _, pRaw := range projects {
				p, ok := pRaw.(map[string]any)
				if !ok {
					continue
				}
				if id, _ := p["projectId"].(string); id == projectID {
					return
				}
			}
		}
		time.Sleep(40 * time.Millisecond)
	}
	t.Fatalf("project %q not online before timeout", projectID)
}

func createDirLink(t *testing.T, target string, link string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "mklink", "/J", link, target)
		if _, err := cmd.CombinedOutput(); err == nil {
			return
		}
		t.Skipf("unable to create junction for test")
		return
	}
	if err := os.Symlink(target, link); err == nil {
		return
	}
	t.Skipf("unable to create directory link for test")
}

func assertListEntryKind(t *testing.T, payload map[string]any, name string, wantKind string) {
	t.Helper()
	entries, ok := payload["entries"].([]any)
	if !ok {
		t.Fatalf("entries missing in project.fs.list payload: %#v", payload)
	}
	for _, item := range entries {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		entryName, _ := entry["name"].(string)
		if entryName != name {
			continue
		}
		kind, _ := entry["kind"].(string)
		if kind != wantKind {
			t.Fatalf("entry %q kind=%q want %q (payload=%#v)", name, kind, wantKind, payload)
		}
		return
	}
	t.Fatalf("entry %q not found in project.fs.list payload: %#v", name, payload)
}

func initGitRepo(t *testing.T, dir string) {
	t.Helper()
	runGitCmd(t, dir, "init")
	runGitCmd(t, dir, "config", "user.email", "test@example.com")
	runGitCmd(t, dir, "config", "user.name", "Test User")
}

func runGitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
	}
}

func dialWS(t *testing.T, rawURL string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(rawURL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial ws: %v", err)
	}
	return conn
}

func mustWriteJSON(t *testing.T, ws *websocket.Conn, v any) {
	t.Helper()
	if err := ws.WriteJSON(v); err != nil {
		t.Fatalf("write json: %v", err)
	}
}

func mustReadEnvelope(t *testing.T, ws *websocket.Conn) testEnvelope {
	t.Helper()
	var out testEnvelope
	if err := ws.ReadJSON(&out); err != nil {
		t.Fatalf("read json: %v", err)
	}
	return out
}

func mustReadResponseEnvelope(t *testing.T, ws *websocket.Conn, requestID int64) testEnvelope {
	t.Helper()
	for {
		envelope := mustReadEnvelope(t, ws)
		if envelope.RequestID == requestID {
			return envelope
		}
	}
}

func TestProjectFileIndexRebuildWritesGitIgnoredLineIndexAndSearchesFuzzy(t *testing.T) {
	root := t.TempDir()
	writeProjectFileForFileIndexTest(t, root, ".gitignore", "node_modules/\n*.tmp\n")
	writeProjectFileForFileIndexTest(t, root, "src/MobileInstance.ts", "export const mobile = true;\n")
	writeProjectFileForFileIndexTest(t, root, "src/components/ProfileCard.tsx", "export const profile = true;\n")
	writeProjectFileForFileIndexTest(t, root, "node_modules/ignored.js", "ignored\n")
	writeProjectFileForFileIndexTest(t, root, "scratch.tmp", "ignored\n")
	runGitForFileIndexTest(t, root, "init")
	runGitForFileIndexTest(t, root, "add", ".gitignore", "src/MobileInstance.ts")

	baseDir := t.TempDir()
	manager := newProjectFileIndexManager(baseDir)
	project := projectFileIndexProject{ProjectID: "hub-a:My Project", Name: "My Project", Root: root}

	snapshot, err := manager.rebuildNow(context.Background(), project)
	if err != nil {
		t.Fatalf("rebuildNow: %v", err)
	}
	if snapshot.FileCount != 3 {
		t.Fatalf("FileCount=%d, want 3", snapshot.FileCount)
	}

	indexPath := filepath.Join(baseDir, "db", "ext", "My Project", "file-index.txt")
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(string(raw), "\r\n", "\n")), "\n")
	wantLines := []string{".gitignore", "src/MobileInstance.ts", "src/components/ProfileCard.tsx"}
	if strings.Join(lines, "\n") != strings.Join(wantLines, "\n") {
		t.Fatalf("index lines=%q, want %q", lines, wantLines)
	}

	resp, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query:          "MI",
		QuerySessionID: "session-1",
		QueryID:        1,
		Limit:          20,
	})
	if err != nil {
		t.Fatalf("search MI: %v", err)
	}
	if len(resp.Results) == 0 || resp.Results[0].Path != "src/MobileInstance.ts" || resp.Results[0].Name != "MobileInstance.ts" {
		t.Fatalf("MI results=%+v, want MobileInstance first", resp.Results)
	}

	resp, err = manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query:          "components",
		QuerySessionID: "session-1",
		QueryID:        2,
		Limit:          20,
	})
	if err != nil {
		t.Fatalf("search components: %v", err)
	}
	if len(resp.Results) != 1 || resp.Results[0].Path != "src/components/ProfileCard.tsx" {
		t.Fatalf("components results=%+v, want path-segment match", resp.Results)
	}
}

func TestProjectFileIndexQuerySessionNarrowsBeyondInitialTopSet(t *testing.T) {
	manager := newProjectFileIndexManager(t.TempDir())
	project := projectFileIndexProject{ProjectID: "hub-a:large", Name: "large", Root: t.TempDir()}
	initialMatchCount := 7000
	paths := make([]string, 0, initialMatchCount+1)
	for i := 0; i < initialMatchCount; i++ {
		paths = append(paths, fmt.Sprintf("src/m%04d.ts", i))
	}
	paths = append(paths, "src/MobileInstance.ts")
	manager.snapshots[project.ProjectID] = projectFileIndexSnapshot{
		ProjectID: project.ProjectID,
		Name:      project.Name,
		Path:      project.Root,
		Status:    projectFileIndexStatusIndexed,
		FileCount: len(paths),
		Paths:     paths,
	}

	first, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query:          "m",
		QuerySessionID: "session-large",
		QueryID:        1,
		Limit:          20,
	})
	if err != nil {
		t.Fatalf("search m: %v", err)
	}
	for _, result := range first.Results {
		if result.Path == "src/MobileInstance.ts" {
			t.Fatalf("first query unexpectedly returned target in capped UI results: %+v", first.Results)
		}
	}

	refined, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query:          "mi",
		QuerySessionID: "session-large",
		QueryID:        2,
		Limit:          20,
	})
	if err != nil {
		t.Fatalf("search mi: %v", err)
	}
	if len(refined.Results) == 0 || refined.Results[0].Path != "src/MobileInstance.ts" {
		t.Fatalf("refined results=%+v, want MobileInstance despite first query cap", refined.Results)
	}
}

func TestProjectFileIndexStatusDoesNotLoadSearchSnapshot(t *testing.T) {
	baseDir := t.TempDir()
	manager := newProjectFileIndexManager(baseDir)
	project := projectFileIndexProject{ProjectID: "hub-a:large-status", Name: "large-status", Root: t.TempDir()}
	if err := manager.writeIndexFile(project, []string{
		"src/MobileInstance.ts",
		"src/components/ProfileCard.tsx",
	}); err != nil {
		t.Fatalf("writeIndexFile: %v", err)
	}

	status := manager.status([]projectFileIndexProject{project})
	if len(status.Projects) != 1 {
		t.Fatalf("status projects=%+v, want one project", status.Projects)
	}
	if status.Projects[0].Status != projectFileIndexStatusIndexed || status.Projects[0].FileCount != 2 {
		t.Fatalf("status project=%+v, want indexed count 2", status.Projects[0])
	}

	manager.mu.Lock()
	snapshot := manager.snapshots[project.ProjectID]
	manager.mu.Unlock()
	if snapshot.Loaded || len(snapshot.Paths) != 0 || len(snapshot.Entries) != 0 {
		t.Fatalf("status loaded snapshot=%+v, want metadata only", snapshot)
	}

	resp, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query: "MI",
		Limit: 20,
	})
	if err != nil {
		t.Fatalf("search after metadata status: %v", err)
	}
	if len(resp.Results) == 0 || resp.Results[0].Path != "src/MobileInstance.ts" {
		t.Fatalf("search results=%+v, want MobileInstance after lazy load", resp.Results)
	}
}

func TestProjectFileIndexPrunesIdleAndLeastRecentlyUsedLoadedSnapshots(t *testing.T) {
	baseDir := t.TempDir()
	now := time.Date(2026, 6, 3, 12, 0, 0, 0, time.UTC)
	manager := newProjectFileIndexManager(baseDir)
	manager.now = func() time.Time { return now }

	projects := make([]projectFileIndexProject, 0, projectFileIndexMaxLoadedSnapshots+1)
	for i := 0; i < projectFileIndexMaxLoadedSnapshots+1; i++ {
		project := projectFileIndexProject{
			ProjectID: fmt.Sprintf("hub-a:lru-%d", i),
			Name:      fmt.Sprintf("lru-%d", i),
			Root:      t.TempDir(),
		}
		if err := manager.writeIndexFile(project, []string{fmt.Sprintf("src/Mobile%d.ts", i)}); err != nil {
			t.Fatalf("writeIndexFile %s: %v", project.ProjectID, err)
		}
		projects = append(projects, project)
	}

	for i, project := range projects {
		now = now.Add(time.Second)
		resp, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
			Query: "Mobile",
			Limit: 1,
		})
		if err != nil {
			t.Fatalf("search %s: %v", project.ProjectID, err)
		}
		if len(resp.Results) != 1 {
			t.Fatalf("search %s results=%+v, want one result", project.ProjectID, resp.Results)
		}
		if loaded := loadedFileIndexSnapshotCountForTest(manager); loaded > projectFileIndexMaxLoadedSnapshots {
			t.Fatalf("after search %d loaded snapshots=%d, want <= %d", i, loaded, projectFileIndexMaxLoadedSnapshots)
		}
	}

	manager.mu.Lock()
	oldest := manager.snapshots[projects[0].ProjectID]
	manager.mu.Unlock()
	if oldest.Loaded || len(oldest.Paths) != 0 || len(oldest.Entries) != 0 {
		t.Fatalf("oldest snapshot=%+v, want LRU metadata only", oldest)
	}

	now = now.Add(projectFileIndexSnapshotIdleTTL + time.Second)
	_ = manager.status(projects)
	if loaded := loadedFileIndexSnapshotCountForTest(manager); loaded != 0 {
		t.Fatalf("loaded snapshots after idle prune=%d, want 0", loaded)
	}

	resp, err := manager.search(context.Background(), projects[0], projectFileIndexSearchRequest{
		Query: "Mobile0",
		Limit: 1,
	})
	if err != nil {
		t.Fatalf("search reloaded snapshot: %v", err)
	}
	if len(resp.Results) != 1 || resp.Results[0].Path != "src/Mobile0.ts" {
		t.Fatalf("reload results=%+v, want Mobile0", resp.Results)
	}
}

func TestProjectFileIndexEntriesAvoidPathAndLowercaseStringCopies(t *testing.T) {
	entryType := reflect.TypeOf(projectFileIndexEntry{})
	for _, fieldName := range []string{"path", "lowerPath", "lowerName"} {
		if _, ok := entryType.FieldByName(fieldName); ok {
			t.Fatalf("projectFileIndexEntry should not keep %s string copies", fieldName)
		}
	}
	entries := buildProjectFileIndexEntries([]string{"Engine/Source/Runtime/MobileInstance.ts"})
	if len(entries) != 1 || entries[0].name != "MobileInstance.ts" {
		t.Fatalf("entries=%+v, want basename retained for search display", entries)
	}
}

func TestProjectFileIndexQuerySessionsUseCompactIndexesAndMemoryCaps(t *testing.T) {
	sessionType := reflect.TypeOf(projectFileIndexQuerySession{})
	indexesField, ok := sessionType.FieldByName("indexes")
	if !ok {
		t.Fatalf("projectFileIndexQuerySession missing indexes field")
	}
	if indexesField.Type.String() != "[]int32" {
		t.Fatalf("query session indexes type=%s, want []int32", indexesField.Type)
	}

	manager := newProjectFileIndexManager(t.TempDir())
	project := projectFileIndexProject{ProjectID: "hub-a:wide", Name: "wide", Root: t.TempDir()}
	paths := make([]string, 0, 100_001)
	for i := 0; i < 100_001; i++ {
		paths = append(paths, fmt.Sprintf("src/match-%06d.ts", i))
	}
	manager.snapshots[project.ProjectID] = projectFileIndexSnapshot{
		ProjectID: project.ProjectID,
		Name:      project.Name,
		Path:      project.Root,
		Status:    projectFileIndexStatusIndexed,
		FileCount: len(paths),
		Paths:     paths,
		Entries:   buildProjectFileIndexEntries(paths),
		Loaded:    true,
	}
	_, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
		Query:          "m",
		QuerySessionID: "too-wide",
		QueryID:        1,
		Limit:          1,
	})
	if err != nil {
		t.Fatalf("wide search: %v", err)
	}
	manager.mu.Lock()
	wideSession := manager.querySessions[project.ProjectID+"\x00too-wide"]
	manager.mu.Unlock()
	if !wideSession.all || len(wideSession.indexes) != 0 {
		t.Fatalf("wide session=%+v, want full-scan fallback instead of capped partial indexes", wideSession)
	}

	paths = paths[:90_000]
	manager.snapshots[project.ProjectID] = projectFileIndexSnapshot{
		ProjectID: project.ProjectID,
		Name:      project.Name,
		Path:      project.Root,
		Status:    projectFileIndexStatusIndexed,
		FileCount: len(paths),
		Paths:     paths,
		Entries:   buildProjectFileIndexEntries(paths),
		Loaded:    true,
	}
	for i := 0; i < 6; i++ {
		_, err := manager.search(context.Background(), project, projectFileIndexSearchRequest{
			Query:          "m",
			QuerySessionID: fmt.Sprintf("session-%d", i),
			QueryID:        1,
			Limit:          1,
		})
		if err != nil {
			t.Fatalf("session search %d: %v", i, err)
		}
	}
	if total := querySessionCandidateIndexCountForTest(manager); total > 500_000 {
		t.Fatalf("query session candidate indexes=%d, want <= 500000", total)
	}
}

func TestProjectFileIndexStartRebuildDedupesRunningProjectAndKeepsStatus(t *testing.T) {
	root := t.TempDir()
	writeProjectFileForFileIndexTest(t, root, "src/MobileInstance.ts", "export const mobile = true;\n")
	manager := newProjectFileIndexManager(t.TempDir())
	project := projectFileIndexProject{ProjectID: "hub-a:proj1", Name: "proj1", Root: root}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	manager.scanFilesForTest = func(context.Context, projectFileIndexProject) ([]string, error) {
		started <- struct{}{}
		<-release
		return []string{"src/MobileInstance.ts"}, nil
	}

	first := manager.startRebuild(context.Background(), project)
	if first.Accepted != true || first.Running != true {
		t.Fatalf("first rebuild=%+v, want accepted running", first)
	}
	<-started
	second := manager.startRebuild(context.Background(), project)
	if second.Accepted != true || second.AlreadyRunning != true || second.Running != true {
		t.Fatalf("second rebuild=%+v, want already-running response", second)
	}
	status := manager.status([]projectFileIndexProject{project})
	if len(status.Projects) != 1 || status.Projects[0].Status != "scanning" {
		t.Fatalf("status while running=%+v, want scanning", status)
	}
	close(release)

	waitForFileIndexStatusForTest(t, manager, project, "indexed")
	status = manager.status([]projectFileIndexProject{project})
	if status.Projects[0].FileCount != 1 || status.Projects[0].Running {
		t.Fatalf("status after rebuild=%+v, want one indexed file and not running", status.Projects[0])
	}
}

func writeProjectFileForFileIndexTest(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", rel, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func runGitForFileIndexTest(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func waitForFileIndexStatusForTest(t *testing.T, manager *projectFileIndexManager, project projectFileIndexProject, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status := manager.status([]projectFileIndexProject{project})
		if len(status.Projects) == 1 && status.Projects[0].Status == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	status := manager.status([]projectFileIndexProject{project})
	t.Fatalf("timed out waiting for index status %q, got %+v", want, status)
}

func loadedFileIndexSnapshotCountForTest(manager *projectFileIndexManager) int {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	count := 0
	for _, snapshot := range manager.snapshots {
		if snapshot.Loaded {
			count++
		}
	}
	return count
}

func querySessionCandidateIndexCountForTest(manager *projectFileIndexManager) int {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	total := 0
	for _, session := range manager.querySessions {
		total += len(session.indexes)
	}
	return total
}

func TestHubUsesOneConfiguredFactoryForProjectInfoAndClient(t *testing.T) {
	projectPath := t.TempDir()
	dbPath := filepath.Join(t.TempDir(), "db", "client.sqlite3")
	factory := agent.NewACPFactory()
	creator := func(context.Context, string) (agent.Instance, error) { return nil, nil }
	factory.Register(rp.ACPProviderClaude, creator)
	factory.Register(rp.ACPProviderCCGLM, creator)
	factory.Register(rp.ACPProviderCCKimi, creator)
	factory.Register(rp.ACPProviderCCQwen, creator)

	cfg := &logger.AppConfig{
		Projects: []logger.ProjectConfig{{Name: "project", Path: projectPath}},
	}
	h := newHubWithFactory(cfg, dbPath, factory)
	info := h.collectProjectInfo(cfg.Projects[0])

	if got, want := info.Agent, "claude"; got != want {
		t.Fatalf("ProjectInfo.Agent = %q, want %q", got, want)
	}
	if got, want := info.Agents, []string{"cc-glm", "cc-kimi", "cc-qwen", "claude"}; !equalStringsForClaudeTest(got, want) {
		t.Fatalf("ProjectInfo.Agents = %v, want %v", got, want)
	}
	encoded, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("json.Marshal(ProjectInfo): %v", err)
	}
	if strings.Contains(string(encoded), "kimi-test-key") || strings.Contains(string(encoded), "qwen-test-key") || strings.Contains(string(encoded), "zai-test-key") {
		t.Fatalf("ProjectInfo leaked API key: %s", encoded)
	}

	c, err := h.buildProjectClient(context.Background(), cfg.Projects[0], projectPath)
	if err != nil {
		t.Fatalf("buildProjectClient: %v", err)
	}
	defer c.Close()
	if c == nil {
		t.Fatal("buildProjectClient returned nil Client")
	}
}

func TestNewWiresHubConfigAPIKeysIntoHubFactory(t *testing.T) {
	binDir := t.TempDir()
	binaryName := "claude-agent-acp"
	if runtime.GOOS == "windows" {
		binaryName += ".cmd"
	}
	if err := os.WriteFile(filepath.Join(binDir, binaryName), []byte("@exit /b 0\n"), 0o755); err != nil {
		t.Fatalf("write fake claude-agent-acp: %v", err)
	}
	t.Setenv("PATH", binDir)

	stateDir := t.TempDir()
	store := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
	for name, value := range map[hubconfig.APIKeyName]string{
		hubconfig.APIKeyDeepSeek: "deepseek-hub-key",
		hubconfig.APIKeyKimi:     "kimi-hub-key",
		hubconfig.APIKeyQwen:     "qwen-hub-key",
		hubconfig.APIKeyZAI:      "zai-hub-key",
		hubconfig.APIKeyFlicker:  "flicker-hub-key",
	} {
		if err := store.UpdateAPIKey(name, "set", value, time.Now()); err != nil {
			t.Fatalf("set %s key: %v", name, err)
		}
	}

	projectPath := t.TempDir()
	cfg := &logger.AppConfig{
		Projects: []logger.ProjectConfig{{Name: "project", Path: projectPath}},
	}
	h := New(cfg, filepath.Join(stateDir, "db", "client.sqlite3"))
	names := h.agentFactory.Names()
	for _, want := range []string{"cc-deepseek", "cc-glm", "cc-kimi", "cc-qwen"} {
		if !slices.Contains(names, want) {
			t.Fatalf("factory names = %v, want %s from hub-config.json", names, want)
		}
	}
	if slices.Contains(names, "cc-flicker") {
		t.Fatalf("factory names = %v, cc-flicker must stay hidden while Bridge is off", names)
	}
	if got := h.flickerBridge.localAPIKey(); got != "flicker-hub-key" {
		t.Fatalf("Flicker Bridge local key = %q, want hub-config.json key", got)
	}
}

func TestNewUsesDefaultFlickerAPIKeyWhenHubConfigKeyIsUnset(t *testing.T) {
	binDir := t.TempDir()
	binaryName := "claude-agent-acp"
	if runtime.GOOS == "windows" {
		binaryName += ".cmd"
	}
	if err := os.WriteFile(filepath.Join(binDir, binaryName), []byte("@exit /b 0\n"), 0o755); err != nil {
		t.Fatalf("write fake claude-agent-acp: %v", err)
	}
	t.Setenv("PATH", binDir)

	stateDir := t.TempDir()
	cfg := &logger.AppConfig{
		Projects: []logger.ProjectConfig{{Name: "project", Path: t.TempDir()}},
	}
	h := New(cfg, filepath.Join(stateDir, "db", "client.sqlite3"))
	if got := h.flickerBridge.localAPIKey(); got != "00000000000000000000" {
		t.Fatalf("Flicker Bridge local key = %q, want built-in local gate", got)
	}
	if names := h.agentFactory.Names(); slices.Contains(names, "cc-flicker") {
		t.Fatalf("factory names = %v, cc-flicker must stay hidden while Bridge is off", names)
	}
}

func TestHubReloadAgentRuntimePublishesCCFlickerOnlyWhileBridgeIsReady(t *testing.T) {
	stateDir := t.TempDir()
	store := hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
	if err := store.UpdateFlickerBridgeEnabled(true); err != nil {
		t.Fatal(err)
	}
	bridge := newFlickerBridgeManager(stateDir, defaultFlickerBridgeAPIKey, store)
	bridge.supported = true
	bridge.state = "running"

	sharedFactory := agent.NewACPFactory()
	h := newHubWithFactory(&logger.AppConfig{}, filepath.Join(stateDir, "db", "client.sqlite3"), sharedFactory)
	h.hubConfig = store
	h.flickerBridge = bridge
	var options agent.ACPFactoryOptions
	h.agentFactoryBuilder = func(input agent.ACPFactoryOptions) *agent.ACPFactory {
		options = input
		factory := agent.NewACPFactory()
		if input.FlickerAPIKey != "" {
			factory.Register(rp.ACPProviderCCFlicker, func(context.Context, string) (agent.Instance, error) {
				return nil, nil
			})
		}
		return factory
	}

	if err := h.reloadAgentRuntime(context.Background(), map[hubconfig.APIKeyName]string{
		hubconfig.APIKeyKimi: "kimi-live-key",
	}); err != nil {
		t.Fatal(err)
	}
	if options.KimiAPIKey != "kimi-live-key" || options.FlickerAPIKey != defaultFlickerBridgeAPIKey {
		t.Fatalf("factory options = %+v, want latest Kimi key and ready Flicker gate", options)
	}
	if !slices.Contains(sharedFactory.Names(), "cc-flicker") {
		t.Fatalf("shared factory names = %v, want ready cc-flicker", sharedFactory.Names())
	}

	bridge.mu.Lock()
	bridge.state = "stopped"
	bridge.mu.Unlock()
	if err := h.reloadAgentRuntime(context.Background(), map[hubconfig.APIKeyName]string{}); err != nil {
		t.Fatal(err)
	}
	if options.FlickerAPIKey != "" || slices.Contains(sharedFactory.Names(), "cc-flicker") {
		t.Fatalf("stopped Bridge reload kept cc-flicker: options=%+v names=%v", options, sharedFactory.Names())
	}
}

func equalStringsForClaudeTest(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
