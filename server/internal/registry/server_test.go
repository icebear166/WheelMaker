package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	logger "github.com/swm8023/wheelmaker/internal/shared"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type testEnvelope struct {
	RequestID int64          `json:"requestId,omitempty"`
	Type      string         `json:"type"`
	Method    string         `json:"method,omitempty"`
	HubID     string         `json:"hubId,omitempty"`
	ProjectID string         `json:"projectId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type blockingWebsocketWriter struct {
	started   chan struct{}
	release   chan struct{}
	writes    chan envelope
	closed    chan struct{}
	startOnce sync.Once
	closeOnce sync.Once
}

func newBlockingWebsocketWriter() *blockingWebsocketWriter {
	return &blockingWebsocketWriter{
		started: make(chan struct{}), release: make(chan struct{}),
		writes: make(chan envelope, 256), closed: make(chan struct{}),
	}
}

func (w *blockingWebsocketWriter) WriteJSON(value any) error {
	w.startOnce.Do(func() { close(w.started) })
	select {
	case <-w.release:
	case <-w.closed:
		return errors.New("closed")
	}
	env, ok := value.(envelope)
	if !ok {
		return errors.New("unexpected write type")
	}
	w.writes <- env
	return nil
}

func (w *blockingWebsocketWriter) Close() error {
	w.closeOnce.Do(func() { close(w.closed) })
	return nil
}

func TestPeerWriterPrioritizesControlOverTerminalOutput(t *testing.T) {
	writer := newBlockingWebsocketWriter()
	peer := newPeerConn(writer, "priority-peer")
	defer peer.close()
	if err := peer.writeTerminal(envelope{Type: "event", Method: rp.RegistryMethodTerminalOutput, Payload: rp.MustRaw(map[string]any{"seq": 1})}); err != nil {
		t.Fatal(err)
	}
	<-writer.started
	if err := peer.writeTerminal(envelope{Type: "event", Method: rp.RegistryMethodTerminalOutput, Payload: rp.MustRaw(map[string]any{"seq": 2})}); err != nil {
		t.Fatal(err)
	}
	controlDone := make(chan error, 1)
	go func() {
		controlDone <- peer.write(envelope{Type: "response", Method: rp.RegistryMethodTerminalList})
	}()
	deadline := time.Now().Add(time.Second)
	for len(peer.priorityWrites) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(writer.release)
	first := <-writer.writes
	second := <-writer.writes
	third := <-writer.writes
	if first.Method != rp.RegistryMethodTerminalOutput || second.Method != rp.RegistryMethodTerminalList || third.Method != rp.RegistryMethodTerminalOutput {
		t.Fatalf("write order=%s,%s,%s", first.Method, second.Method, third.Method)
	}
	if err := <-controlDone; err != nil {
		t.Fatal(err)
	}
}

func TestPeerWriterClosesSlowTerminalClientOnOverflow(t *testing.T) {
	writer := newBlockingWebsocketWriter()
	peer := newPeerConn(writer, "slow-terminal-peer")
	defer close(writer.release)
	if err := peer.writeTerminal(envelope{Type: "event", Method: rp.RegistryMethodTerminalOutput}); err != nil {
		t.Fatal(err)
	}
	<-writer.started
	for i := 0; i < terminalWriteQueueSize; i++ {
		if err := peer.writeTerminal(envelope{Type: "event", Method: rp.RegistryMethodTerminalOutput}); err != nil {
			t.Fatalf("fill %d: %v", i, err)
		}
	}
	if err := peer.writeTerminal(envelope{Type: "event", Method: rp.RegistryMethodTerminalOutput}); !errors.Is(err, errTerminalBacklog) {
		t.Fatalf("overflow err=%v", err)
	}
	select {
	case <-writer.closed:
	case <-time.After(time.Second):
		t.Fatal("slow client was not closed")
	}
}

func TestConnectInit(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "",
		},
	})

	resp := mustReadEnvelope(t, ws)
	if resp.Type != "response" || resp.Method != "connect.init" {
		t.Fatalf("unexpected response: %#v", resp)
	}
	if resp.RequestID != 1 {
		t.Fatalf("requestId=%d, want 1", resp.RequestID)
	}
	if resp.Payload["serverInfo"] == nil {
		t.Fatalf("missing serverInfo: %#v", resp.Payload)
	}
}

func TestVerboseEnvelopeLogsDoNotIncludePayloadOrTiming(t *testing.T) {
	var logs bytes.Buffer
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelVerbose}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	t.Cleanup(logger.Close)
	logger.SetOutput(&logs)

	s := New(Config{Token: "secret-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "secret-token",
		},
	})
	_ = mustReadEnvelope(t, ws)

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	_ = mustReadEnvelope(t, ws)

	got := logs.String()
	for _, want := range []string{
		"envelope dir=in peer=conn-1 role= type=request requestId=1 method=connect.init",
		"envelope dir=out peer=conn-1 role=client type=response requestId=1 method=connect.init",
		"envelope dir=in peer=conn-1 role=client type=request requestId=2 method=registry.project.list",
		"envelope dir=out peer=conn-1 role=client type=response requestId=2 method=registry.project.list",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("log missing %q in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"secret-token", "payload=", "durationMs", "sessionId"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("log contains forbidden %q in:\n%s", forbidden, got)
		}
	}
}

func TestDebugUploadLogWritesClientLog(t *testing.T) {
	logDir := t.TempDir()
	s := New(Config{LogDir: logDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "debug.uploadLog",
		Payload: map[string]any{
			"source": "web",
			"text":   "00:00:01.000 info workspace select_session durationMs=42\n",
		},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != "debug.uploadLog" {
		t.Fatalf("unexpected response: %#v", resp)
	}
	if resp.Payload["ok"] != true {
		t.Fatalf("ok=%v, want true", resp.Payload["ok"])
	}
	fileName, _ := resp.Payload["fileName"].(string)
	if fileName == "" || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
		t.Fatalf("unsafe fileName=%q", fileName)
	}
	data, err := os.ReadFile(filepath.Join(logDir, fileName))
	if err != nil {
		t.Fatalf("read uploaded log: %v", err)
	}
	if !strings.Contains(string(data), "workspace select_session durationMs=42") {
		t.Fatalf("uploaded log content=%q", string(data))
	}
}

func TestConnectInitRejectsLegacyProtocolVersion22(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.2",
			"role":            "client",
			"token":           "",
		},
	})

	resp := mustReadEnvelope(t, ws)
	message, _ := resp.Payload["message"].(string)
	if resp.Type != "error" || resp.Payload["code"] != "INVALID_ARGUMENT" || !strings.Contains(message, "unsupported protocolVersion") {
		t.Fatalf("response=%#v, want unsupported protocolVersion error", resp)
	}
}

func TestConnectInitRejectsLegacyProtocolVersion23(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.3",
			"role":            "client",
			"token":           "",
		},
	})

	resp := mustReadEnvelope(t, ws)
	message, _ := resp.Payload["message"].(string)
	if resp.Type != "error" || resp.Payload["code"] != "INVALID_ARGUMENT" || !strings.Contains(message, "unsupported protocolVersion") {
		t.Fatalf("response=%#v, want unsupported protocolVersion error", resp)
	}
}

func TestConnectInitRejectsLegacyProtocolVersion24(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.4",
			"role":            "client",
			"token":           "",
		},
	})

	resp := mustReadEnvelope(t, ws)
	message, _ := resp.Payload["message"].(string)
	if resp.Type != "error" || resp.Payload["code"] != "INVALID_ARGUMENT" || !strings.Contains(message, "unsupported protocolVersion") {
		t.Fatalf("response=%#v, want unsupported protocolVersion error", resp)
	}
}

func TestRegistryProtocolDomainAcceptsNewAndRejectsOldProjectRoutes(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	epoch := connectRegistryHub(t, hub, "hub-domain")

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.reportProjects",
		HubID:     "hub-domain",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"projects":        []map[string]any{},
		},
	})
	oldReportResp := mustReadEnvelope(t, hub)
	if oldReportResp.Type != "error" {
		t.Fatalf("old report response=%#v, want error", oldReportResp)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-domain",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p1", "git": map[string]any{"gitRev": "g1", "worktreeRev": "w1"}},
			},
		},
	})
	reportResp := mustReadEnvelope(t, hub)
	if reportResp.Type != "response" || reportResp.Method != "hub.report.projects" {
		t.Fatalf("new report response=%#v, want hub.report.projects response", reportResp)
	}

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "project.list",
		Payload:   map[string]any{},
	})
	oldListResp := mustReadEnvelope(t, client)
	if oldListResp.Type != "error" {
		t.Fatalf("old project.list response=%#v, want error", oldListResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	listResp := mustReadEnvelope(t, client)
	if listResp.Type != "response" || listResp.Method != "registry.project.list" {
		t.Fatalf("registry.project.list response=%#v", listResp)
	}
	projects, ok := listResp.Payload["projects"].([]any)
	if !ok || len(projects) != 1 {
		t.Fatalf("projects=%v, want one project", listResp.Payload["projects"])
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "fs.list",
		ProjectID: "hub-domain:server",
		Payload:   map[string]any{"path": "."},
	})
	oldFSResp := mustReadEnvelope(t, client)
	if oldFSResp.Type != "error" {
		t.Fatalf("old fs.list response=%#v, want error", oldFSResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 5,
		Type:      "request",
		Method:    "project.fs.list",
		ProjectID: "hub-domain:server",
		Payload:   map[string]any{"path": "."},
	})
	_ = hub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != "project.fs.list" {
		t.Fatalf("forwarded=%#v, want project.fs.list request", forwarded)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "project.fs.list",
		ProjectID: forwarded.ProjectID,
		Payload: map[string]any{
			"path":    ".",
			"entries": []map[string]any{{"name": "go.mod", "path": "go.mod", "type": "file"}},
		},
	})
	fsResp := mustReadEnvelope(t, client)
	if fsResp.Type != "response" || fsResp.Method != "project.fs.list" {
		t.Fatalf("project.fs.list response=%#v", fsResp)
	}
}

func TestRegistryProtocolDomainProjectReportEvent(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	epoch := connectRegistryHub(t, hub, "hub-report")

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-report",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p1", "git": map[string]any{"gitRev": "g1", "worktreeRev": "w1"}},
			},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "hub.report.project",
		HubID:     "hub-report",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"seq":             1,
			"project": map[string]any{
				"name":       "server",
				"path":       "D:/Code/WheelMaker/server",
				"online":     false,
				"agent":      "codex",
				"projectRev": "p2",
				"git":        map[string]any{"gitRev": "g2", "worktreeRev": "w2"},
			},
			"updatedAt": "2026-03-31T10:01:23Z",
		},
	})
	updateResp := mustReadEnvelope(t, hub)
	if updateResp.Type != "response" || updateResp.Method != "hub.report.project" {
		t.Fatalf("update response=%#v, want hub.report.project response", updateResp)
	}

	event := mustReadEnvelope(t, client)
	if event.Type != "event" || event.Method != "registry.project.report" {
		t.Fatalf("project event=%#v, want registry.project.report event", event)
	}
	project, _ := event.Payload["project"].(map[string]any)
	if project["name"] != "server" || project["online"] != false {
		t.Fatalf("project report payload=%#v", event.Payload)
	}
}

func TestRegistryProtocolDomainRelayMethods(t *testing.T) {
	if !methodAllowed("client", "registry.relay.status") {
		t.Fatal("client should be allowed to call registry.relay.status")
	}
	if methodAllowed("client", "relay.status") {
		t.Fatal("client should not be allowed to call old relay.status")
	}
	if methodAllowed("hub", "registry.relay.status") {
		t.Fatal("hub should not be allowed to call public registry.relay.status")
	}

	s := New(Config{})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "relay.status",
		Payload:   map[string]any{},
	})
	oldResp := mustReadEnvelope(t, client)
	if oldResp.Type != "error" {
		t.Fatalf("old relay.status response=%#v, want error", oldResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "registry.relay.status",
		Payload:   map[string]any{},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != "registry.relay.status" {
		t.Fatalf("registry.relay.status response=%#v", resp)
	}
}

func TestRegistryReportProjectsThenListProjects(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
			"token":           "",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "agents": []string{"codex", "claude", "copilot"}, "projectRev": "", "git": map[string]any{}},
				{"name": "app", "path": "D:/Code/WheelMaker/app", "online": true, "agent": "claude", "agents": []string{"claude", "codex"}, "projectRev": "", "git": map[string]any{}},
			},
		},
	})

	reportResp := mustReadEnvelope(t, hub)
	if reportResp.Type != "response" || reportResp.Method != "hub.report.projects" {
		t.Fatalf("unexpected report response: %#v", reportResp)
	}

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	listResp := mustReadEnvelope(t, client)
	if listResp.Type != "response" || listResp.Method != "registry.project.list" {
		t.Fatalf("unexpected registry.project.list response: %#v", listResp)
	}
	projects, ok := listResp.Payload["projects"].([]any)
	if !ok || len(projects) != 2 {
		t.Fatalf("projects=%v, want 2 items", listResp.Payload["projects"])
	}
	hubs, ok := listResp.Payload["hubs"].([]any)
	if !ok || len(hubs) != 1 {
		t.Fatalf("hubs=%v, want 1 item", listResp.Payload["hubs"])
	}
	firstHub, _ := hubs[0].(map[string]any)
	if firstHub["hubId"] != "hub-a" {
		t.Fatalf("hub=%v, want hub-a", firstHub)
	}
	if _, ok := firstHub["online"]; ok {
		t.Fatalf("hub should not expose online state: %v", firstHub)
	}
	first, _ := projects[0].(map[string]any)
	if _, ok := first["projectId"].(string); !ok {
		t.Fatalf("projectId missing: %v", first)
	}

	projectsByName := map[string]map[string]any{}
	for _, item := range projects {
		proj, _ := item.(map[string]any)
		name, _ := proj["name"].(string)
		projectsByName[name] = proj
	}
	serverProject := projectsByName["server"]
	if serverProject == nil {
		t.Fatalf("server project missing: %v", projects)
	}
	serverAgents, _ := serverProject["agents"].([]any)
	if !reflect.DeepEqual(serverAgents, []any{"codex", "claude", "copilot"}) {
		t.Fatalf("server agents=%v, want [codex claude copilot]", serverAgents)
	}
	appProject := projectsByName["app"]
	if appProject == nil {
		t.Fatalf("app project missing: %v", projects)
	}
	appAgents, _ := appProject["agents"].([]any)
	if !reflect.DeepEqual(appAgents, []any{"claude", "codex"}) {
		t.Fatalf("app agents=%v, want [claude codex]", appAgents)
	}
}

func TestProjectListIgnoresLegacyLocalReadCandidate(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-local-read",
			"token":           "",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-local-read",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"localRead": map[string]any{
				"endpointId":       "local-hub-1",
				"url":              "ws://127.0.0.1:53123/ws",
				"proofPublicKey":   "base64-public-key",
				"proofFingerprint": "sha256:fingerprint",
			},
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "", "git": map[string]any{}},
			},
		},
	})
	reportResp := mustReadEnvelope(t, hub)
	if reportResp.Type != "response" || reportResp.Method != "hub.report.projects" {
		t.Fatalf("unexpected report response: %#v", reportResp)
	}

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	listResp := mustReadEnvelope(t, client)
	hubs, ok := listResp.Payload["hubs"].([]any)
	if !ok || len(hubs) != 1 {
		t.Fatalf("hubs=%v, want one hub", listResp.Payload["hubs"])
	}
	firstHub, _ := hubs[0].(map[string]any)
	if _, exists := firstHub["localRead"]; exists {
		t.Fatalf("hub should not expose removed localRead metadata: %#v", firstHub)
	}

	projects, ok := listResp.Payload["projects"].([]any)
	if !ok || len(projects) != 1 {
		t.Fatalf("projects=%v, want one project", listResp.Payload["projects"])
	}
	project, _ := projects[0].(map[string]any)
	if _, exists := project["localRead"]; exists {
		t.Fatalf("project should not expose localRead: %#v", project)
	}
}

func TestRegistryReportProjectsRejectsStaleConnectionEpoch(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hubOld := dialWS(t, ts.URL+"/ws")
	defer hubOld.Close()
	mustWriteJSON(t, hubOld, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub-old",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
		},
	})
	oldInit := mustReadEnvelope(t, hubOld)
	oldPrincipal, _ := oldInit.Payload["principal"].(map[string]any)
	oldEpoch, _ := oldPrincipal["connectionEpoch"].(float64)

	hubNew := dialWS(t, ts.URL+"/ws")
	defer hubNew.Close()
	mustWriteJSON(t, hubNew, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub-new",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
		},
	})
	newInit := mustReadEnvelope(t, hubNew)
	newPrincipal, _ := newInit.Payload["principal"].(map[string]any)
	newEpoch, _ := newPrincipal["connectionEpoch"].(float64)

	mustWriteJSON(t, hubNew, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(newEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p2", "git": map[string]any{"gitRev": "g2", "worktreeRev": "w2"}},
			},
		},
	})
	_ = mustReadEnvelope(t, hubNew)

	mustWriteJSON(t, hubOld, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(oldEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p1", "git": map[string]any{"gitRev": "g1", "worktreeRev": "w1"}},
			},
		},
	})
	stale := mustReadEnvelope(t, hubOld)
	if stale.Type != "error" {
		t.Fatalf("stale response type=%q, want error", stale.Type)
	}
	if stale.Payload["code"] != "CONFLICT" {
		t.Fatalf("stale error code=%v, want CONFLICT", stale.Payload["code"])
	}
}

func TestConnectInitAuthRequired(t *testing.T) {
	s := New(Config{Token: "secret"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "wrong",
		},
	})
	unauthorized := mustReadEnvelope(t, ws)
	if unauthorized.Type != "error" {
		t.Fatalf("unexpected response: %#v", unauthorized)
	}
	payload := unauthorized.Payload
	if payload["code"] != "UNAUTHORIZED" {
		t.Fatalf("error.code=%v, want UNAUTHORIZED", payload["code"])
	}
}

func TestInvalidRequestIDReturnsErrorAndKeepsConnection(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "",
		},
	})
	_ = mustReadEnvelope(t, ws)

	mustWriteJSON(t, ws, map[string]any{
		"requestId": "bad-id",
		"type":      "request",
		"method":    "registry.project.list",
		"payload":   map[string]any{},
	})
	invalid := mustReadEnvelope(t, ws)
	if invalid.Type != "error" {
		t.Fatalf("unexpected invalid requestId response: %#v", invalid)
	}
	if invalid.Payload["code"] != "INVALID_ARGUMENT" {
		t.Fatalf("error.code=%v, want INVALID_ARGUMENT", invalid.Payload["code"])
	}

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})
	listResp := mustReadEnvelope(t, ws)
	if listResp.Type != "response" || listResp.Method != "registry.project.list" {
		t.Fatalf("unexpected registry.project.list response after invalid requestId: %#v", listResp)
	}
}

func TestBatchMethodIsRemoved(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "batch",
		Payload: map[string]any{
			"requests": []map[string]any{},
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "batch" {
		t.Fatalf("batch response=%#v, want unsupported method error", resp)
	}
	if resp.Payload["code"] != codeForbidden {
		t.Fatalf("batch error code=%v, want %s", resp.Payload["code"], codeForbidden)
	}
}

func TestRegistryUpdateProjectBroadcastsEvents(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p1", "git": map[string]any{"gitRev": "g1", "worktreeRev": "w1", "headSha": "h1", "dirty": false}},
			},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "hub.report.project",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"seq":             1,
			"project": map[string]any{
				"name":       "server",
				"path":       "D:/Code/WheelMaker/server",
				"online":     true,
				"agent":      "codex",
				"projectRev": "p2",
				"git": map[string]any{
					"gitRev":      "g2",
					"worktreeRev": "w2",
					"headSha":     "h2",
					"dirty":       true,
				},
			},
			"updatedAt": "2026-03-31T10:01:23Z",
		},
	})
	updateResp := mustReadEnvelope(t, hub)
	if updateResp.Type != "response" || updateResp.Method != "hub.report.project" {
		t.Fatalf("unexpected update response: %#v", updateResp)
	}
	updateEvent := mustReadEnvelope(t, client)
	if updateEvent.Type != "event" || updateEvent.Method != "registry.project.report" {
		t.Fatalf("unexpected update event: %#v", updateEvent)
	}

	if err := hub.Close(); err != nil {
		t.Fatalf("close hub: %v", err)
	}
	offline := mustReadEnvelope(t, client)
	if offline.Type != "event" || offline.Method != "registry.project.report" {
		t.Fatalf("unexpected offline event: %#v", offline)
	}
	project, _ := offline.Payload["project"].(map[string]any)
	if project["online"] != false {
		t.Fatalf("offline report payload=%#v", offline.Payload)
	}
}

func TestSessionForwardingAndSessionEventBroadcast(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "p1", "git": map[string]any{"gitRev": "g1", "worktreeRev": "w1"}},
			},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "session.send",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
			"text":      "hello registry session",
		},
	})

	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != "session.send" {
		t.Fatalf("forwarded.method=%q, want session.send", forwarded.Method)
	}
	if forwarded.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwarded.ProjectID)
	}
	forwardPayload := forwarded.Payload
	if forwardPayload["sessionId"] != "sess-1" || forwardPayload["text"] != "hello registry session" {
		t.Fatalf("forwarded payload=%v", forwardPayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "session.send",
		ProjectID: forwarded.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	sendResp := mustReadEnvelope(t, client)
	if sendResp.Type != "response" || sendResp.Method != "session.send" {
		t.Fatalf("unexpected session.send response: %#v", sendResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "session.config",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
			"configId":  "model",
			"value":     "gpt-5",
		},
	})

	forwardedConfig := mustReadEnvelope(t, hub)
	if forwardedConfig.Method != "session.config" {
		t.Fatalf("forwarded.method=%q, want session.config", forwardedConfig.Method)
	}
	if forwardedConfig.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedConfig.ProjectID)
	}
	forwardConfigPayload := forwardedConfig.Payload
	if forwardConfigPayload["sessionId"] != "sess-1" || forwardConfigPayload["configId"] != "model" || forwardConfigPayload["value"] != "gpt-5" {
		t.Fatalf("forwarded config payload=%v", forwardConfigPayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwardedConfig.RequestID,
		Type:      "response",
		Method:    "session.config",
		ProjectID: forwardedConfig.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	setConfigResp := mustReadEnvelope(t, client)
	if setConfigResp.Type != "response" || setConfigResp.Method != "session.config" {
		t.Fatalf("unexpected session.config response: %#v", setConfigResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "session.rename",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
			"title":     "Renamed session",
		},
	})

	forwardedRename := mustReadEnvelope(t, hub)
	if forwardedRename.Method != "session.rename" {
		t.Fatalf("forwarded.method=%q, want session.rename", forwardedRename.Method)
	}
	if forwardedRename.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedRename.ProjectID)
	}
	forwardRenamePayload := forwardedRename.Payload
	if forwardRenamePayload["sessionId"] != "sess-1" || forwardRenamePayload["title"] != "Renamed session" {
		t.Fatalf("forwarded rename payload=%v", forwardRenamePayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwardedRename.RequestID,
		Type:      "response",
		Method:    "session.rename",
		ProjectID: forwardedRename.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	renameResp := mustReadEnvelope(t, client)
	if renameResp.Type != "response" || renameResp.Method != "session.rename" {
		t.Fatalf("unexpected session.rename response: %#v", renameResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 5,
		Type:      "request",
		Method:    "session.archive",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
		},
	})

	forwardedArchive := mustReadEnvelope(t, hub)
	if forwardedArchive.Method != "session.archive" {
		t.Fatalf("forwarded.method=%q, want session.archive", forwardedArchive.Method)
	}
	if forwardedArchive.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedArchive.ProjectID)
	}
	forwardArchivePayload := forwardedArchive.Payload
	if forwardArchivePayload["sessionId"] != "sess-1" {
		t.Fatalf("forwarded archive payload=%v", forwardArchivePayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwardedArchive.RequestID,
		Type:      "response",
		Method:    "session.archive",
		ProjectID: forwardedArchive.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	archiveResp := mustReadEnvelope(t, client)
	if archiveResp.Type != "response" || archiveResp.Method != "session.archive" {
		t.Fatalf("unexpected session.archive response: %#v", archiveResp)
	}

	for index, archiveRecoveryMethod := range []string{"session.archive.list", "session.archive.read", "session.archive.restore"} {
		mustWriteJSON(t, client, testEnvelope{
			RequestID: 60 + int64(index),
			Type:      "request",
			Method:    archiveRecoveryMethod,
			ProjectID: "hub-a:server",
			Payload: map[string]any{
				"sessionId": "sess-1",
			},
		})

		forwardedArchiveRecovery := mustReadEnvelope(t, hub)
		if forwardedArchiveRecovery.Method != archiveRecoveryMethod {
			t.Fatalf("forwarded.method=%q, want %s", forwardedArchiveRecovery.Method, archiveRecoveryMethod)
		}
		if forwardedArchiveRecovery.ProjectID != "hub-a:server" {
			t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedArchiveRecovery.ProjectID)
		}

		mustWriteJSON(t, hub, testEnvelope{
			RequestID: forwardedArchiveRecovery.RequestID,
			Type:      "response",
			Method:    archiveRecoveryMethod,
			ProjectID: forwardedArchiveRecovery.ProjectID,
			Payload: map[string]any{
				"ok": true,
			},
		})
		archiveRecoveryResp := mustReadEnvelope(t, client)
		if archiveRecoveryResp.Type != "response" || archiveRecoveryResp.Method != archiveRecoveryMethod {
			t.Fatalf("unexpected %s response: %#v", archiveRecoveryMethod, archiveRecoveryResp)
		}
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 6,
		Type:      "request",
		Method:    "session.delete",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
		},
	})
	forwardedDelete := mustReadEnvelope(t, hub)
	if forwardedDelete.Method != "session.delete" {
		t.Fatalf("forwarded.method=%q, want session.delete", forwardedDelete.Method)
	}
	if forwardedDelete.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedDelete.ProjectID)
	}
	forwardDeletePayload := forwardedDelete.Payload
	if forwardDeletePayload["sessionId"] != "sess-1" {
		t.Fatalf("forwarded delete payload=%v", forwardDeletePayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwardedDelete.RequestID,
		Type:      "response",
		Method:    "session.delete",
		ProjectID: forwardedDelete.ProjectID,
		Payload: map[string]any{
			"ok":        true,
			"sessionId": "sess-1",
		},
	})
	deleteResp := mustReadEnvelope(t, client)
	if deleteResp.Type != "response" || deleteResp.Method != "session.delete" {
		t.Fatalf("unexpected session.delete response: %#v", deleteResp)
	}

	attachmentRequests := []struct {
		method  string
		payload map[string]any
	}{
		{method: "session.attachment.start", payload: map[string]any{"sessionId": "sess-1", "name": "a.txt", "mimeType": "text/plain", "size": 1}},
		{method: "session.attachment.chunk", payload: map[string]any{"sessionId": "sess-1", "uploadId": "upload-1", "offset": 0, "data": "YQ=="}},
		{method: "session.attachment.finish", payload: map[string]any{"sessionId": "sess-1", "uploadId": "upload-1", "sha256": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"}},
		{method: "session.attachment.cancel", payload: map[string]any{"sessionId": "sess-1", "uploadId": "upload-2"}},
		{method: "session.attachment.delete", payload: map[string]any{"sessionId": "sess-1", "attachmentId": "sha256-ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"}},
	}
	for i, request := range attachmentRequests {
		mustWriteJSON(t, client, testEnvelope{
			RequestID: int64(7 + i),
			Type:      "request",
			Method:    request.method,
			ProjectID: "hub-a:server",
			Payload:   request.payload,
		})
		forwardedAttachment := mustReadEnvelope(t, hub)
		if forwardedAttachment.Method != request.method {
			t.Fatalf("forwarded.method=%q, want %s", forwardedAttachment.Method, request.method)
		}
		if forwardedAttachment.ProjectID != "hub-a:server" {
			t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwardedAttachment.ProjectID)
		}
		if forwardedAttachment.Payload["sessionId"] != "sess-1" {
			t.Fatalf("forwarded attachment payload=%v", forwardedAttachment.Payload)
		}
		mustWriteJSON(t, hub, testEnvelope{
			RequestID: forwardedAttachment.RequestID,
			Type:      "response",
			Method:    request.method,
			ProjectID: forwardedAttachment.ProjectID,
			Payload: map[string]any{
				"ok": true,
			},
		})
		attachmentResp := mustReadEnvelope(t, client)
		if attachmentResp.Type != "response" || attachmentResp.Method != request.method {
			t.Fatalf("unexpected %s response: %#v", request.method, attachmentResp)
		}
	}
}

func TestChatSendIsUnsupportedAfterIMRemoval(t *testing.T) {
	s := New(Config{Token: "tok"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	method := "chat" + ".send"

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "tok",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    method,
		ProjectID: "hub-a:proj1",
		Payload: map[string]any{
			"chatId": "chat-1",
			"text":   "hello",
		},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" {
		t.Fatalf("response type = %q, want error", resp.Type)
	}
	if resp.Payload["code"] != codeInvalidArgument {
		t.Fatalf("code = %q, want %q", resp.Payload["code"], codeInvalidArgument)
	}
}

func TestMonitorRoleRejected(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()

	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-monitor",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "monitor",
			"token":           "",
		},
	})
	resp := mustReadEnvelope(t, ws)
	if resp.Type != "error" || resp.Payload["code"] != codeForbidden {
		t.Fatalf("monitor connect response=%#v, want forbidden", resp)
	}
}

func TestMonitorMethodRemoved(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           "hub-a",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-a",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects": []map[string]any{
				{"name": "server", "path": "D:/Code/WheelMaker/server", "online": true, "agent": "codex", "projectRev": "", "git": map[string]any{}},
			},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-client",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	prefix := "monitor."
	for requestID, method := range []string{prefix + "listHub", prefix + "status", prefix + "restart"} {
		mustWriteJSON(t, client, testEnvelope{RequestID: int64(requestID + 2), Type: "request", Method: method, Payload: map[string]any{"hubId": "hub-a"}})
		resp := mustReadEnvelope(t, client)
		if resp.Type != "error" || (resp.Payload["code"] != codeInvalidArgument && resp.Payload["code"] != codeForbidden) {
			t.Fatalf("method %q response=%#v, want unsupported/forbidden", method, resp)
		}
	}
}

func TestPublicCmdMethodsAreRejected(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	for index, method := range []string{"cmd.npm", "cmd.token", "cmd.update", "cmd.skills"} {
		mustWriteJSON(t, client, testEnvelope{
			RequestID: int64(2 + index),
			Type:      "request",
			Method:    method,
			Payload: map[string]any{
				"action": "scan",
				"hubId":  "hub-cmd",
			},
		})
		resp := mustReadEnvelope(t, client)
		if resp.Type != "error" {
			t.Fatalf("%s response=%#v, want error", method, resp)
		}
		if resp.Payload["code"] != codeForbidden {
			t.Fatalf("%s code=%v, want %s", method, resp.Payload["code"], codeForbidden)
		}
	}
}

func TestHubStateGetForwardsByEnvelopeHubID(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-state")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.state.get",
		HubID:     "hub-state",
		Payload: map[string]any{
			"sections": []string{"tokenStats"},
		},
	})

	_ = hub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != "hub.state.get" {
		t.Fatalf("forwarded=%#v, want hub.state.get request", forwarded)
	}
	if forwarded.HubID != "hub-state" {
		t.Fatalf("forwarded.hubId=%q, want hub-state", forwarded.HubID)
	}
	if forwarded.ProjectID != "" {
		t.Fatalf("forwarded.projectId=%q, want empty", forwarded.ProjectID)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "hub.state.get",
		HubID:     "hub-state",
		Payload: map[string]any{
			"sections": map[string]any{
				"tokenStats": map[string]any{"available": true},
			},
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != "hub.state.get" {
		t.Fatalf("client response=%#v, want hub.state.get response", resp)
	}
	if resp.HubID != "hub-state" {
		t.Fatalf("client response hubId=%q, want hub-state", resp.HubID)
	}
}

func TestHubStateMissingEnvelopeHubIDIsRejected(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.state.get",
		Payload: map[string]any{
			"sections": []string{"tokenStats"},
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "hub.state.get" {
		t.Fatalf("response=%#v, want hub.state.get error", resp)
	}
	if resp.Payload["code"] != "INVALID_ARGUMENT" {
		t.Fatalf("error code=%v, want INVALID_ARGUMENT", resp.Payload["code"])
	}
}

func TestProjectListRespondsWhileSameClientHasPendingHubStateRequest(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-async")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.state.refresh",
		HubID:     "hub-async",
		Payload: map[string]any{
			"sections": []string{"tokenStats"},
		},
	})

	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != "hub.state.refresh" {
		t.Fatalf("forwarded=%#v, want pending hub.state.refresh request", forwarded)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "registry.project.list",
		Payload:   map[string]any{},
	})

	_ = client.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	listResp := mustReadEnvelope(t, client)
	_ = client.SetReadDeadline(time.Time{})
	if listResp.RequestID != 3 || listResp.Type != "response" || listResp.Method != "registry.project.list" {
		t.Fatalf("project list response=%#v, want request 3 registry.project.list response", listResp)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "hub.state.refresh",
		HubID:     "hub-async",
		Payload: map[string]any{
			"state": map[string]any{"hubId": "hub-async", "sections": map[string]any{}},
		},
	})
	refreshResp := mustReadEnvelope(t, client)
	if refreshResp.RequestID != 2 || refreshResp.Type != "response" || refreshResp.Method != "hub.state.refresh" {
		t.Fatalf("refresh response=%#v, want request 2 hub.state.refresh response", refreshResp)
	}
}

func TestForwardRequestsToDifferentHubsDoNotShareClientQueue(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	slowHub := dialWS(t, ts.URL+"/ws")
	defer slowHub.Close()
	mustReportHubProjects(t, slowHub, "slow-hub", []map[string]any{
		{"name": "slow-project", "path": "D:/slow", "online": true, "agent": "codex"},
	})

	fastHub := dialWS(t, ts.URL+"/ws")
	defer fastHub.Close()
	mustReportHubProjects(t, fastHub, "fast-hub", []map[string]any{
		{"name": "fast-project", "path": "D:/fast", "online": true, "agent": "codex"},
	})

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "session.list",
		ProjectID: "slow-hub:slow-project",
		Payload:   map[string]any{},
	})
	slowForwarded := mustReadEnvelope(t, slowHub)
	if slowForwarded.Type != "request" || slowForwarded.Method != "session.list" {
		t.Fatalf("slow forwarded=%#v, want session.list request", slowForwarded)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "session.list",
		ProjectID: "fast-hub:fast-project",
		Payload:   map[string]any{},
	})

	_ = fastHub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	fastForwarded := mustReadEnvelope(t, fastHub)
	_ = fastHub.SetReadDeadline(time.Time{})
	if fastForwarded.Type != "request" || fastForwarded.Method != "session.list" {
		t.Fatalf("fast forwarded=%#v, want session.list request", fastForwarded)
	}

	mustWriteJSON(t, fastHub, testEnvelope{
		RequestID: fastForwarded.RequestID,
		Type:      "response",
		Method:    "session.list",
		ProjectID: fastForwarded.ProjectID,
		Payload: map[string]any{
			"sessions": []map[string]any{{"sessionId": "fast-session"}},
		},
	})
	fastResp := mustReadEnvelope(t, client)
	if fastResp.RequestID != 3 || fastResp.Type != "response" || fastResp.Method != "session.list" {
		t.Fatalf("fast response=%#v, want request 3 session.list response", fastResp)
	}

	mustWriteJSON(t, slowHub, testEnvelope{
		RequestID: slowForwarded.RequestID,
		Type:      "response",
		Method:    "session.list",
		ProjectID: slowForwarded.ProjectID,
		Payload: map[string]any{
			"sessions": []map[string]any{{"sessionId": "slow-session"}},
		},
	})
	slowResp := mustReadEnvelope(t, client)
	if slowResp.RequestID != 2 || slowResp.Type != "response" || slowResp.Method != "session.list" {
		t.Fatalf("slow response=%#v, want request 2 session.list response", slowResp)
	}
}

func TestHubStateForwardTimeoutsMatchOperationCost(t *testing.T) {
	tests := []struct {
		name   string
		method string
		want   time.Duration
	}{
		{
			name:   "get",
			method: rp.RegistryMethodHubStateGet,
			want:   defaultRequestTimeout,
		},
		{
			name:   "refresh",
			method: rp.RegistryMethodHubStateRefresh,
			want:   60 * time.Second,
		},
		{
			name:   "action",
			method: rp.RegistryMethodHubStateAction,
			want:   60 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hubStateRequestTimeout(tt.method); got != tt.want {
				t.Fatalf("hubStateRequestTimeout(%q)=%s, want %s", tt.method, got, tt.want)
			}
		})
	}
}

func TestProjectForwardTimeoutsMatchOperationCost(t *testing.T) {
	tests := []struct {
		name   string
		method string
		want   time.Duration
	}{
		{
			name:   "session list",
			method: rp.RegistryMethodSessionList,
			want:   defaultRequestTimeout,
		},
		{
			name:   "session create",
			method: rp.RegistryMethodSessionCreate,
			want:   120 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectForwardRequestTimeout(tt.method); got != tt.want {
				t.Fatalf("projectForwardRequestTimeout(%q)=%s, want %s", tt.method, got, tt.want)
			}
		})
	}
}

func TestCmdPrefixIsNotAllowedByWildcard(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "cmd.shell",
		Payload: map[string]any{
			"hubId": "hub-npm",
		},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" {
		t.Fatalf("resp=%#v, want error", resp)
	}
	if resp.Payload["code"] != codeForbidden {
		t.Fatalf("code=%v, want %s", resp.Payload["code"], codeForbidden)
	}

	if methodAllowed("client", "cmd.skills") {
		t.Fatal("cmd.skills should not be allowed")
	}
	if methodAllowed("client", "cmd.token") {
		t.Fatal("cmd.token should not be allowed")
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

func TestRegistryBasePath(t *testing.T) {
	tests := []struct {
		requestPath string
		basePath    string
		ok          bool
	}{
		{requestPath: "/ws", basePath: "/", ok: true},
		{requestPath: "/wheelmaker/ws", basePath: "/wheelmaker/", ok: true},
		{requestPath: "/teams/alpha/ws", basePath: "/teams/alpha/", ok: true},
		{requestPath: "/auth/login", ok: false},
		{requestPath: "/wheelmaker/not-ws", ok: false},
		{requestPath: "/foo/ws/extra", ok: false},
		{requestPath: "/foo//ws", ok: false},
		{requestPath: "/foo/../ws", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.requestPath, func(t *testing.T) {
			got, ok := registryBasePath(tt.requestPath)
			if ok != tt.ok || got != tt.basePath {
				t.Fatalf("registryBasePath(%q)=(%q, %t), want (%q, %t)", tt.requestPath, got, ok, tt.basePath, tt.ok)
			}
		})
	}
}

func TestRegistryBasePathRoutesWebSocketUpgrade(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/wheelmaker/ws", nil)
	if err != nil {
		t.Fatalf("dial base-path websocket: %v", err)
	}
	_ = conn.Close()
}

func TestAuthRoutesUseWSPath(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	loginReq, err := http.NewRequest(http.MethodPost, ts.URL+"/ws?auth=login", strings.NewReader(`{"token":"custom-token"}`))
	if err != nil {
		t.Fatalf("NewRequest(login): %v", err)
	}
	loginReq.Host = "wheelmaker.example.com"
	loginReq.Header.Set("Content-Type", "application/json")
	loginReq.Header.Set("Origin", "https://wheelmaker.example.com")
	loginReq.Header.Set("X-Forwarded-Proto", "https")
	loginResp, err := http.DefaultClient.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_ = loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /ws?auth=login status=%d, want 200", loginResp.StatusCode)
	}

	statusResp, err := http.Get(ts.URL + "/wheelmaker/ws?auth=status")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	_ = statusResp.Body.Close()
	if statusResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /wheelmaker/ws?auth=status status=%d, want 200", statusResp.StatusCode)
	}

	for _, request := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/auth/login"},
		{method: http.MethodGet, path: "/wheelmaker/not-ws"},
		{method: http.MethodGet, path: "/foo/ws/extra"},
		{method: http.MethodGet, path: "/ws?auth=unknown"},
		{method: http.MethodGet, path: "/ws?auth=login"},
		{method: http.MethodGet, path: "/ws?auth=status&extra=1"},
	} {
		req, err := http.NewRequest(request.method, ts.URL+request.path, nil)
		if err != nil {
			t.Fatalf("NewRequest(%s %s): %v", request.method, request.path, err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", request.method, request.path, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s status=%d, want 404", request.method, request.path, resp.StatusCode)
		}
	}
}

func TestWebSocketCrossOriginWithoutSessionUsesTokenAuthentication(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	header := http.Header{"Origin": []string{"https://appassets.androidplatform.net"}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
	if err != nil {
		t.Fatalf("dial cross-origin token client: %v", err)
	}
	defer conn.Close()
	mustWriteJSON(t, conn, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "custom-token",
		},
	})
	resp := mustReadEnvelope(t, conn)
	if resp.Type != "response" {
		t.Fatalf("connect response=%+v, want token-authenticated response", resp)
	}
}

func TestWebSocketNoOriginUsesTokenAuthentication(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial no-origin token client: %v", err)
	}
	defer conn.Close()
	mustWriteJSON(t, conn, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    rp.RegistryMethodConnectInit,
		Payload: map[string]any{
			"clientName":      "wheelmaker-native",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
			"token":           "custom-token",
		},
	})
	resp := mustReadEnvelope(t, conn)
	if resp.Type != "response" {
		t.Fatalf("connect response=%+v, want token-authenticated response", resp)
	}
}

func TestWebSocketRejectsCrossOriginSessionCookie(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	cookie := loginRegistryBrowser(t, ts.URL, "custom-token", ts.URL)
	header := http.Header{
		"Origin": []string{"https://attacker.example"},
		"Cookie": []string{cookie.String()},
	}
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("dial error=%v response=%v, want HTTP 403", err, resp)
	}
}

func TestWebLoginSetsSecureSessionCookie(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/ws?auth=login", strings.NewReader(`{"token":"custom-token"}`))
	if err != nil {
		t.Fatalf("NewRequest(): %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://wheelmaker.example.com")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Host = "wheelmaker.example.com"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status=%d", resp.StatusCode)
	}
	cookies := resp.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies=%v, want one session cookie", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != registrySessionCookieName || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unsafe session cookie: %+v", cookie)
	}
}

func TestWebAuthRejectsInvalidLoginRequests(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	tests := []struct {
		name      string
		body      string
		fetchSite string
		fetchMode string
	}{
		{name: "body over 4 KiB", body: `{"token":"` + strings.Repeat("x", 4097) + `"}`},
		{name: "second JSON value", body: `{"token":"custom-token"} {}`},
		{name: "unknown field", body: `{"token":"custom-token","unknown":true}`},
		{name: "empty token", body: `{"token":""}`},
		{name: "device name over 80 characters", body: `{"token":"custom-token","deviceName":"` + strings.Repeat("界", 81) + `"}`},
		{name: "cross site fetch", body: `{"token":"custom-token"}`, fetchSite: "cross-site"},
		{name: "navigate fetch", body: `{"token":"custom-token"}`, fetchSite: "same-origin", fetchMode: "navigate"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := sameOriginWebAuthHeaders(ts.URL)
			if tt.fetchSite != "" {
				headers.Set("Sec-Fetch-Site", tt.fetchSite)
			}
			if tt.fetchMode != "" {
				headers.Set("Sec-Fetch-Mode", tt.fetchMode)
			}
			resp := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, "/", "login", tt.body, headers, nil)
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				t.Fatalf("invalid login status=%d, want rejection", resp.StatusCode)
			}
			assertWebAuthSecurityHeaders(t, resp)
		})
	}
}

func TestWebAuthCookieStatusAndLogoutUseBasePath(t *testing.T) {
	tests := []struct {
		name       string
		basePath   string
		deviceName string
		wantName   string
	}{
		{name: "root", basePath: "/", deviceName: "   ", wantName: "Browser"},
		{name: "subpath", basePath: "/wheelmaker/", deviceName: "  Work Tablet  ", wantName: "Work Tablet"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := New(Config{Token: "x"})
			ts := httptest.NewServer(s.Handler())
			t.Cleanup(ts.Close)
			headers := sameOriginWebAuthHeaders(ts.URL)
			loginBody := `{"token":"x","deviceName":` + strconv.Quote(tt.deviceName) + `}`
			loginResp := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, tt.basePath, "login", loginBody, headers, nil)
			assertWebAuthSecurityHeaders(t, loginResp)
			var loginPayload struct {
				Authenticated bool   `json:"authenticated"`
				CSRFToken     string `json:"csrfToken"`
			}
			if err := json.NewDecoder(loginResp.Body).Decode(&loginPayload); err != nil {
				t.Fatalf("decode login: %v", err)
			}
			_ = loginResp.Body.Close()
			if loginResp.StatusCode != http.StatusOK || !loginPayload.Authenticated || loginPayload.CSRFToken == "" {
				t.Fatalf("login status=%d payload=%+v", loginResp.StatusCode, loginPayload)
			}
			cookies := loginResp.Cookies()
			if len(cookies) != 1 {
				t.Fatalf("login cookies=%v, want one", cookies)
			}
			cookie := cookies[0]
			if cookie.Domain != "" || cookie.Path != tt.basePath || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge != int(webSessionTTL.Seconds()) {
				t.Fatalf("login cookie=%+v", cookie)
			}

			statusResp := doRegistryWebAuthRequest(t, ts.URL, http.MethodGet, tt.basePath, "status", "", nil, cookie)
			assertWebAuthSecurityHeaders(t, statusResp)
			var statusPayload struct {
				Authenticated bool   `json:"authenticated"`
				CSRFToken     string `json:"csrfToken"`
				Device        struct {
					DeviceID   string    `json:"deviceId"`
					DeviceName string    `json:"deviceName"`
					BasePath   string    `json:"basePath"`
					CreatedAt  time.Time `json:"createdAt"`
					LastSeenAt time.Time `json:"lastSeenAt"`
					ExpiresAt  time.Time `json:"expiresAt"`
					Current    bool      `json:"current"`
				} `json:"device"`
			}
			if err := json.NewDecoder(statusResp.Body).Decode(&statusPayload); err != nil {
				t.Fatalf("decode status: %v", err)
			}
			_ = statusResp.Body.Close()
			if statusResp.StatusCode != http.StatusOK || !statusPayload.Authenticated || statusPayload.CSRFToken != loginPayload.CSRFToken {
				t.Fatalf("status=%d payload=%+v", statusResp.StatusCode, statusPayload)
			}
			if statusPayload.Device.DeviceID == "" || statusPayload.Device.DeviceName != tt.wantName || statusPayload.Device.BasePath != tt.basePath || statusPayload.Device.CreatedAt.IsZero() || statusPayload.Device.LastSeenAt.IsZero() || statusPayload.Device.ExpiresAt.IsZero() || !statusPayload.Device.Current {
				t.Fatalf("status device=%+v", statusPayload.Device)
			}
			encodedStatus, err := json.Marshal(statusPayload)
			if err != nil {
				t.Fatalf("marshal status: %v", err)
			}
			for _, forbidden := range []string{cookie.Value, `"digest"`, `"fingerprint"`, `"cookie"`, `"registryToken"`} {
				if bytes.Contains(encodedStatus, []byte(forbidden)) {
					t.Fatalf("status leaks %q: %s", forbidden, encodedStatus)
				}
			}

			wrongHeaders := sameOriginWebAuthHeaders(ts.URL)
			wrongHeaders.Set(registryCSRFHeaderName, "wrong")
			wrongLogout := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, tt.basePath, "logout", "", wrongHeaders, cookie)
			assertWebAuthSecurityHeaders(t, wrongLogout)
			_ = wrongLogout.Body.Close()
			if wrongLogout.StatusCode != http.StatusForbidden {
				t.Fatalf("wrong-CSRF logout status=%d, want 403", wrongLogout.StatusCode)
			}

			logoutHeaders := sameOriginWebAuthHeaders(ts.URL)
			logoutHeaders.Set(registryCSRFHeaderName, statusPayload.CSRFToken)
			logoutResp := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, tt.basePath, "logout", "", logoutHeaders, cookie)
			assertWebAuthSecurityHeaders(t, logoutResp)
			_ = logoutResp.Body.Close()
			if logoutResp.StatusCode != http.StatusOK {
				t.Fatalf("logout status=%d", logoutResp.StatusCode)
			}
			cleared := logoutResp.Cookies()
			if len(cleared) != 1 || cleared[0].Path != tt.basePath || cleared[0].MaxAge != -1 || !cleared[0].HttpOnly || !cleared[0].Secure || cleared[0].SameSite != http.SameSiteStrictMode {
				t.Fatalf("cleared cookies=%+v", cleared)
			}

			after := doRegistryWebAuthRequest(t, ts.URL, http.MethodGet, tt.basePath, "status", "", nil, cookie)
			defer after.Body.Close()
			var afterPayload map[string]any
			if err := json.NewDecoder(after.Body).Decode(&afterPayload); err != nil {
				t.Fatalf("decode status after logout: %v", err)
			}
			if afterPayload["authenticated"] != false {
				t.Fatalf("status after logout=%v", afterPayload)
			}
		})
	}
}

func TestWebAuthRejectsSessionFromDifferentBasePath(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	login := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, "/", "login", `{"token":"custom-token"}`, sameOriginWebAuthHeaders(ts.URL), nil)
	if login.StatusCode != http.StatusOK || len(login.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", login.StatusCode, login.Cookies())
	}
	cookie := login.Cookies()[0]
	_ = login.Body.Close()

	status := doRegistryWebAuthRequest(t, ts.URL, http.MethodGet, "/wheelmaker/", "status", "", nil, cookie)
	defer status.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(status.Body).Decode(&payload); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if payload["authenticated"] != false {
		t.Fatalf("cross-base status=%v, want unauthenticated", payload)
	}
}

func TestDeviceSessionListAndRevokeCloseTargetBrowser(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	firstCookie, firstDeviceID := loginRegistryBrowserDevice(t, ts.URL, "custom-token", "First")
	secondCookie, secondDeviceID := loginRegistryBrowserDevice(t, ts.URL, "custom-token", "Second")
	firstWS := connectRegistryBrowser(t, ts.URL, firstCookie)
	defer firstWS.Close()
	secondWS := connectRegistryBrowser(t, ts.URL, secondCookie)
	defer secondWS.Close()

	mustWriteJSON(t, firstWS, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodSecuritySessionList, Payload: map[string]any{}})
	listResp := mustReadEnvelope(t, firstWS)
	if listResp.Type != "response" || listResp.Method != rp.RegistryMethodSecuritySessionList {
		t.Fatalf("list response=%+v", listResp)
	}
	sessions, ok := listResp.Payload["sessions"].([]any)
	if !ok || len(sessions) != 2 {
		t.Fatalf("list payload=%+v", listResp.Payload)
	}
	encoded, err := json.Marshal(listResp.Payload)
	if err != nil {
		t.Fatalf("Marshal(list): %v", err)
	}
	for _, forbidden := range []string{firstCookie.Value, secondCookie.Value, "digest", "csrf", "fingerprint"} {
		if bytes.Contains(bytes.ToLower(encoded), bytes.ToLower([]byte(forbidden))) {
			t.Fatalf("list leaks %q: %s", forbidden, encoded)
		}
	}
	current := ""
	for _, raw := range sessions {
		item, _ := raw.(map[string]any)
		if item["current"] == true {
			current, _ = item["deviceId"].(string)
		}
	}
	if current != firstDeviceID {
		t.Fatalf("current device=%q, want %q", current, firstDeviceID)
	}

	mustWriteJSON(t, firstWS, testEnvelope{RequestID: 3, Type: "request", Method: rp.RegistryMethodSecuritySessionRevoke, Payload: map[string]any{"deviceId": secondDeviceID}})
	revokeResp := mustReadEnvelope(t, firstWS)
	if revokeResp.Type != "response" || revokeResp.Payload["revoked"] != true {
		t.Fatalf("revoke response=%+v", revokeResp)
	}
	if err := secondWS.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("SetReadDeadline(): %v", err)
	}
	if _, _, err := secondWS.ReadMessage(); err == nil {
		t.Fatal("revoked target browser remained connected")
	}

	mustWriteJSON(t, firstWS, testEnvelope{RequestID: 4, Type: "request", Method: rp.RegistryMethodSecuritySessionRevoke, Payload: map[string]any{"deviceId": firstDeviceID}})
	currentResp := mustReadEnvelope(t, firstWS)
	if currentResp.Type != "response" || currentResp.Payload["revoked"] != true {
		t.Fatalf("current revoke response=%+v", currentResp)
	}
	if err := firstWS.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("SetReadDeadline(): %v", err)
	}
	if _, _, err := firstWS.ReadMessage(); err == nil {
		t.Fatal("revoked current browser remained connected")
	}
}

func TestDeviceSessionRevokeAllClosesCurrentBrowser(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	cookie, _ := loginRegistryBrowserDevice(t, ts.URL, "custom-token", "Browser")
	ws := connectRegistryBrowser(t, ts.URL, cookie)
	defer ws.Close()
	mustWriteJSON(t, ws, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodSecuritySessionRevokeAll, Payload: map[string]any{}})
	resp := mustReadEnvelope(t, ws)
	if resp.Type != "response" || resp.Payload["revoked"] != float64(1) {
		t.Fatalf("revokeAll response=%+v", resp)
	}
	if err := ws.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("SetReadDeadline(): %v", err)
	}
	if _, _, err := ws.ReadMessage(); err == nil {
		t.Fatal("revokeAll left current browser connected")
	}
}

func loginRegistryBrowserDevice(t *testing.T, baseURL, token, deviceName string) (*http.Cookie, string) {
	t.Helper()
	login := doRegistryWebAuthRequest(t, baseURL, http.MethodPost, "/", "login", `{"token":`+strconv.Quote(token)+`,"deviceName":`+strconv.Quote(deviceName)+`}`, sameOriginWebAuthHeaders(baseURL), nil)
	if login.StatusCode != http.StatusOK || len(login.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", login.StatusCode, login.Cookies())
	}
	cookie := login.Cookies()[0]
	_ = login.Body.Close()
	status := doRegistryWebAuthRequest(t, baseURL, http.MethodGet, "/", "status", "", nil, cookie)
	defer status.Body.Close()
	var payload struct {
		Device struct {
			DeviceID string `json:"deviceId"`
		} `json:"device"`
	}
	if err := json.NewDecoder(status.Body).Decode(&payload); err != nil || payload.Device.DeviceID == "" {
		t.Fatalf("decode status deviceId=%q err=%v", payload.Device.DeviceID, err)
	}
	return cookie, payload.Device.DeviceID
}

func connectRegistryBrowser(t *testing.T, baseURL string, cookie *http.Cookie) *websocket.Conn {
	t.Helper()
	header := http.Header{"Origin": []string{baseURL}, "Cookie": []string{cookie.String()}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(baseURL, "http")+"/ws", header)
	if err != nil {
		t.Fatalf("dial browser websocket: %v", err)
	}
	mustWriteJSON(t, conn, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    rp.RegistryMethodConnectInit,
		Payload: map[string]any{
			"clientName":      "wheelmaker-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	if resp := mustReadEnvelope(t, conn); resp.Type != "response" {
		t.Fatalf("connect response=%+v", resp)
	}
	return conn
}

func sameOriginWebAuthHeaders(origin string) http.Header {
	return http.Header{
		"Content-Type":   []string{"application/json"},
		"Origin":         []string{origin},
		"Sec-Fetch-Site": []string{"same-origin"},
		"Sec-Fetch-Mode": []string{"cors"},
	}
}

func doRegistryWebAuthRequest(t *testing.T, serverURL, method, basePath, action, body string, headers http.Header, cookie *http.Cookie) *http.Response {
	t.Helper()
	requestURL := serverURL + strings.TrimSuffix(basePath, "/") + "/ws?auth=" + action
	req, err := http.NewRequest(method, requestURL, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest(%s): %v", action, err)
	}
	for name, values := range headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s: %v", action, err)
	}
	return resp
}

func assertWebAuthSecurityHeaders(t *testing.T, resp *http.Response) {
	t.Helper()
	if resp.Header.Get("Cache-Control") != "no-store" || resp.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("security headers=%v", resp.Header)
	}
}

func TestWebSocketWithoutSessionStillRequiresTokenInit(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	header := http.Header{"Origin": []string{ts.URL}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
	if err != nil {
		t.Fatalf("dial allowlisted browser: %v", err)
	}
	defer conn.Close()
	mustWriteJSON(t, conn, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	resp := mustReadEnvelope(t, conn)
	if resp.Type != "error" || resp.Payload["code"] != codeUnauthorized {
		t.Fatalf("connect response=%+v, want unauthorized", resp)
	}
}

func TestWebSocketSessionAllowsClientWithoutToken(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	cookie := loginRegistryBrowser(t, ts.URL, "custom-token", ts.URL)
	header := http.Header{
		"Origin": []string{ts.URL},
		"Cookie": []string{cookie.String()},
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
	if err != nil {
		t.Fatalf("dial authenticated browser: %v", err)
	}
	defer conn.Close()
	mustWriteJSON(t, conn, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "client",
		},
	})
	resp := mustReadEnvelope(t, conn)
	if resp.Type != "response" {
		t.Fatalf("connect response=%+v", resp)
	}
}

func loginRegistryBrowser(t *testing.T, baseURL, token, origin string) *http.Cookie {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, baseURL+"/ws?auth=login", strings.NewReader(`{"token":`+strconv.Quote(token)+`}`))
	if err != nil {
		t.Fatalf("NewRequest(): %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	if strings.HasPrefix(origin, "https://") {
		req.Header.Set("X-Forwarded-Proto", "https")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || len(resp.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", resp.StatusCode, resp.Cookies())
	}
	return resp.Cookies()[0]
}

func TestRunRejectsNonLoopbackAddress(t *testing.T) {
	s := New(Config{Addr: "0.0.0.0:0", Token: "custom-token"})
	err := s.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("Run() error=%v, want loopback rejection", err)
	}
}

func TestRunRegistryFailsClosedOnCorruptSessionFile(t *testing.T) {
	stateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(stateDir, "registry-sessions.json"), []byte(`{"version":99}`), 0o600); err != nil {
		t.Fatalf("WriteFile(): %v", err)
	}
	s := New(Config{Addr: "127.0.0.1:0", Token: "custom-token", StateDir: stateDir})
	err := s.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "registry sessions") {
		t.Fatalf("Run() error=%v, want registry sessions failure", err)
	}
}

func dialReportedHub(t *testing.T, rawURL string, hubID string) *websocket.Conn {
	t.Helper()
	hub := dialWS(t, rawURL)
	mustReportHubProjects(t, hub, hubID, []map[string]any{})
	return hub
}

func mustReportHubProjects(t *testing.T, hub *websocket.Conn, hubID string, projects []map[string]any) {
	t.Helper()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wheelmaker-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           hubID,
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     hubID,
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects":        projects,
		},
	})
	_ = mustReadEnvelope(t, hub)
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

func TestRelayStatusIsAllowedForClientOnly(t *testing.T) {
	if !methodAllowed("client", "registry.relay.status") {
		t.Fatal("client should be allowed to call registry.relay.status")
	}
	if methodAllowed("hub", "registry.relay.status") {
		t.Fatal("hub should not be allowed to call public registry.relay.status")
	}
	if methodAllowed("monitor", "registry.relay.enable") {
		t.Fatal("monitor should not be allowed to mutate relay slot")
	}
}

func TestRelayStatusReturnsDisabledSnapshot(t *testing.T) {
	s := New(Config{})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.relay.status",
		Payload:   map[string]any{},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != "registry.relay.status" {
		t.Fatalf("registry.relay.status response=%#v", resp)
	}
	if resp.Payload["status"] != "Disabled" || resp.Payload["enabled"] != false {
		t.Fatalf("registry.relay.status payload=%#v, want disabled snapshot", resp.Payload)
	}
}

func TestRelayEnableForwardsInternalOpenToHub(t *testing.T) {
	s := New(Config{})
	ts := httptestNewRegistryServer(t, s.Handler())

	hub := dialReportedHub(t, "http://"+ts+"/ws", "hub-relay")
	defer hub.Close()

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	listenPort := reserveTCPPort(t)
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "registry.relay.enable",
		Payload: map[string]any{
			"listenPort": listenPort,
			"hubId":      "hub-relay",
			"targetHost": "127.0.0.1",
			"targetPort": 43210,
			"accessCode": "483921",
		},
	})

	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != "hub.relay.open" {
		t.Fatalf("forwarded=%#v, want hub.relay.open request", forwarded)
	}
	if forwarded.Payload["targetHost"] != "127.0.0.1" || forwarded.Payload["targetPort"] != float64(43210) {
		t.Fatalf("forwarded payload=%#v", forwarded.Payload)
	}
	if forwarded.Payload["nonce"] == "" || forwarded.Payload["relayURL"] == "" {
		t.Fatalf("forwarded payload missing tunnel fields: %#v", forwarded.Payload)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "hub.relay.open",
		Payload: map[string]any{
			"ok": true,
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != "registry.relay.enable" {
		t.Fatalf("registry.relay.enable response=%#v", resp)
	}
	if resp.Payload["enabled"] != true || resp.Payload["status"] != "Opening" {
		t.Fatalf("registry.relay.enable payload=%#v, want opening snapshot", resp.Payload)
	}
}

func connectRegistryClient(t *testing.T, ws *websocket.Conn) {
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
		},
	})
	_ = mustReadEnvelope(t, ws)
}

func connectRegistryHub(t *testing.T, ws *websocket.Conn, hubID string) int64 {
	t.Helper()
	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wheelmaker-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           hubID,
		},
	})
	initResp := mustReadEnvelope(t, ws)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	return int64(connectionEpoch)
}

func TestTerminalRoutingForwardsControlAndBidirectionalEvents(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustReportHubProjects(t, hub, "hub-terminal", []map[string]any{{"name": "proj1", "path": `C:\src\proj1`, "online": true}})
	clientA := dialWS(t, ts.URL+"/ws")
	defer clientA.Close()
	connectRegistryClient(t, clientA)
	clientB := dialWS(t, ts.URL+"/ws")
	defer clientB.Close()
	connectRegistryClient(t, clientB)

	mustWriteJSON(t, clientA, testEnvelope{
		RequestID: 2, Type: "request", Method: rp.RegistryMethodTerminalCreate,
		ProjectID: "hub-terminal:proj1", Payload: map[string]any{"cols": 80, "rows": 24},
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	create := mustReadEnvelope(t, hub)
	if create.Type != "request" || create.Method != rp.RegistryMethodTerminalCreate || create.ProjectID != "hub-terminal:proj1" {
		t.Fatalf("create=%+v", create)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: create.RequestID, Type: "response", Method: create.Method,
		Payload: map[string]any{"terminal": map[string]any{"terminalId": "term-1", "runId": "run-1"}, "resizeToken": "private"},
	})
	if response := mustReadEnvelope(t, clientA); response.Type != "response" || response.RequestID != 2 {
		t.Fatalf("create response=%+v", response)
	}

	mustWriteJSON(t, clientA, testEnvelope{
		RequestID: 3, Type: "request", Method: rp.RegistryMethodTerminalList,
		HubID: "hub-terminal", Payload: map[string]any{},
	})
	list := mustReadEnvelope(t, hub)
	if list.Method != rp.RegistryMethodTerminalList || list.HubID != "hub-terminal" {
		t.Fatalf("list=%+v", list)
	}
	mustWriteJSON(t, hub, testEnvelope{RequestID: list.RequestID, Type: "response", Method: list.Method, Payload: map[string]any{"terminals": []any{}}})
	if response := mustReadEnvelope(t, clientA); response.Type != "response" || response.RequestID != 3 {
		t.Fatalf("list response=%+v", response)
	}

	mustWriteJSON(t, clientA, testEnvelope{
		Type: "event", Method: rp.RegistryMethodTerminalInput, HubID: "hub-terminal",
		Payload: map[string]any{"terminalId": "term-1", "runId": "run-1", "data": "YQ=="},
	})
	input := mustReadEnvelope(t, hub)
	if input.Type != "event" || input.Method != rp.RegistryMethodTerminalInput || input.RequestID != 0 {
		t.Fatalf("input=%+v", input)
	}

	mustWriteJSON(t, hub, testEnvelope{
		Type: "event", Method: rp.RegistryMethodTerminalOutput, HubID: "hub-terminal",
		Payload: map[string]any{"terminalId": "term-1", "runId": "run-1", "seq": 1, "data": "Yg=="},
	})
	for index, client := range []*websocket.Conn{clientA, clientB} {
		_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
		output := mustReadEnvelope(t, client)
		if output.Type != "event" || output.Method != rp.RegistryMethodTerminalOutput || output.HubID != "hub-terminal" {
			t.Fatalf("client %d output=%+v", index, output)
		}
	}
}

func TestTerminalRoutingRejectsWrongDirectionEvents(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	hub := dialReportedHub(t, ts.URL+"/ws", "hub-terminal-reject")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{Type: "event", Method: rp.RegistryMethodTerminalOutput, HubID: "hub-terminal-reject", Payload: map[string]any{}})
	clientError := mustReadEnvelope(t, client)
	if clientError.Type != "error" || clientError.Payload["code"] != codeForbidden {
		t.Fatalf("client error=%+v", clientError)
	}

	mustWriteJSON(t, hub, testEnvelope{Type: "event", Method: rp.RegistryMethodTerminalInput, HubID: "hub-terminal-reject", Payload: map[string]any{}})
	hubError := mustReadEnvelope(t, hub)
	if hubError.Type != "error" || hubError.Payload["code"] != codeForbidden {
		t.Fatalf("hub error=%+v", hubError)
	}
}

func httptestNewRegistryServer(t *testing.T, handler http.Handler) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen registry: %v", err)
	}
	srv := &http.Server{Handler: handler}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = ln.Close()
	})
	return ln.Addr().String()
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve tcp port: %v", err)
	}
	defer ln.Close()
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("reserved addr=%v is not tcp", ln.Addr())
	}
	return addr.Port
}
