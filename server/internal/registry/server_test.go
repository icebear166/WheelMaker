package registry

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/portrelay"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/security"
	"github.com/swm8023/wheelmaker/internal/serverdata"
	logger "github.com/swm8023/wheelmaker/internal/shared"
	speechprovider "github.com/swm8023/wheelmaker/internal/speech"
	ttsprovider "github.com/swm8023/wheelmaker/internal/tts"
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

func TestConnectInitRejectsLegacyProtocolVersions(t *testing.T) {
	for _, protocolVersion := range []string{"2.2", "2.3", "2.4"} {
		t.Run(protocolVersion, func(t *testing.T) {
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
					"protocolVersion": protocolVersion,
					"role":            "client",
					"token":           "",
				},
			})

			resp := mustReadEnvelope(t, ws)
			message, _ := resp.Payload["message"].(string)
			if resp.Type != "error" || resp.Payload["code"] != "INVALID_ARGUMENT" || !strings.Contains(message, "unsupported protocolVersion") {
				t.Fatalf("response=%#v, want unsupported protocolVersion error", resp)
			}
		})
	}
}

func TestCompareProtocolVersions(t *testing.T) {
	tests := []struct {
		name         string
		left         string
		right        string
		wantOrdering int
		wantOK       bool
	}{
		{name: "equal", left: "2.6", right: "2.6", wantOrdering: 0, wantOK: true},
		{name: "older", left: "2.5", right: "2.6", wantOrdering: -1, wantOK: true},
		{name: "numeric components", left: "2.10", right: "2.9", wantOrdering: 1, wantOK: true},
		{name: "trailing zero", left: "2.6.0", right: "2.6", wantOrdering: 0, wantOK: true},
		{name: "invalid", left: "2.x", right: "2.6", wantOrdering: 0, wantOK: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ordering, ok := compareProtocolVersions(tt.left, tt.right)
			if ordering != tt.wantOrdering || ok != tt.wantOK {
				t.Fatalf("compareProtocolVersions(%q, %q)=(%d, %v), want (%d, %v)",
					tt.left, tt.right, ordering, ok, tt.wantOrdering, tt.wantOK)
			}
		})
	}
}

func TestConnectInitAcceptsOlderHubProtocolOnly(t *testing.T) {
	s := New(Config{ProtocolVersion: "2.7"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	tests := []struct {
		name            string
		role            string
		protocolVersion string
		wantResponse    bool
	}{
		{name: "older hub", role: "hub", protocolVersion: "2.6", wantResponse: true},
		{name: "too old hub", role: "hub", protocolVersion: "2.5", wantResponse: false},
		{name: "newer hub", role: "hub", protocolVersion: "2.8", wantResponse: false},
		{name: "invalid hub", role: "hub", protocolVersion: "2.x", wantResponse: false},
		{name: "older client", role: "client", protocolVersion: "2.6", wantResponse: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ws := dialWS(t, ts.URL+"/ws")
			defer ws.Close()
			payload := map[string]any{
				"clientName":      "compat-test",
				"clientVersion":   "0.1.0",
				"protocolVersion": tt.protocolVersion,
				"role":            tt.role,
			}
			if tt.role == "hub" {
				payload["hubId"] = "hub-" + strings.ReplaceAll(tt.name, " ", "-")
			}
			mustWriteJSON(t, ws, testEnvelope{
				RequestID: 1,
				Type:      "request",
				Method:    rp.RegistryMethodConnectInit,
				Payload:   payload,
			})
			resp := mustReadEnvelope(t, ws)
			if tt.wantResponse {
				if resp.Type != rp.RegistryEnvelopeTypeResponse {
					t.Fatalf("response=%#v, want successful connect.init", resp)
				}
				return
			}
			message, _ := resp.Payload["message"].(string)
			if resp.Type != rp.RegistryEnvelopeTypeError || !strings.Contains(message, "unsupported protocolVersion") {
				t.Fatalf("response=%#v, want unsupported protocolVersion", resp)
			}
		})
	}
}

func TestUpdateOnlyHubReportsAreAcknowledgedAndDiscarded(t *testing.T) {
	s := New(Config{ProtocolVersion: "2.7"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodConnectInit,
		Payload: map[string]any{
			"clientName":      "wheelmaker-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.6",
			"role":            "hub",
			"hubId":           "hub-old",
		},
	})
	initResp := mustReadEnvelope(t, hub)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodHubReportProjects,
		HubID:     "hub-old",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects": []map[string]any{
				{"name": "secret-project", "path": "D:/secret", "online": true},
			},
		},
	})
	if resp := mustReadEnvelope(t, hub); resp.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("hub.report.projects response=%#v, want success", resp)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 3,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodHubReportProject,
		HubID:     "hub-old",
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"seq":             1,
			"updatedAt":       "2026-07-31T10:00:00Z",
			"project":         map[string]any{"name": "another-project", "path": "D:/another", "online": true},
		},
	})
	if resp := mustReadEnvelope(t, hub); resp.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("hub.report.project response=%#v, want success", resp)
	}

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryPeerVersion(t, client, "client", "", "2.7")
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodRegistryProjectList,
		Payload:   map[string]any{},
	})
	listResp := mustReadEnvelope(t, client)
	projects, _ := listResp.Payload["projects"].([]any)
	if len(projects) != 0 {
		t.Fatalf("projects=%#v, want no projects from update-only Hub", projects)
	}
	hubs, _ := listResp.Payload["hubs"].([]any)
	if len(hubs) != 1 {
		t.Fatalf("hubs=%#v, want one update-only Hub", hubs)
	}
	hubDescriptor, _ := hubs[0].(map[string]any)
	if hubDescriptor["hubId"] != "hub-old" || hubDescriptor["connectionMode"] != "update_only" {
		t.Fatalf("hub descriptor=%#v, want update_only hub-old", hubDescriptor)
	}

	mustWriteJSON(t, hub, testEnvelope{
		Type:   rp.RegistryEnvelopeTypeEvent,
		Method: rp.RegistryMethodHubStateUpdated,
		HubID:  "hub-old",
		Payload: map[string]any{
			"sections": []string{"skills"},
		},
	})
	_ = client.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var unexpected testEnvelope
	if err := client.ReadJSON(&unexpected); err == nil {
		t.Fatalf("received restricted Hub event: %#v", unexpected)
	}
}

func TestUpdateOnlyHubRequestAllowedRequiresExactUpdatePayload(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		payload map[string]any
		want    bool
	}{
		{
			name:    "refresh wheelmaker update",
			method:  rp.RegistryMethodHubStateRefresh,
			payload: map[string]any{"sections": []string{"wheelmakerUpdate"}},
			want:    true,
		},
		{
			name:   "request update",
			method: rp.RegistryMethodHubStateAction,
			payload: map[string]any{
				"section": "wheelmakerUpdate",
				"action":  "requestUpdate",
				"params":  map[string]any{},
			},
			want: true,
		},
		{
			name:    "refresh Gateway update",
			method:  rp.RegistryMethodHubStateRefresh,
			payload: map[string]any{"sections": []string{"gatewayUpdate"}},
			want:    true,
		},
		{
			name:   "request Gateway update",
			method: rp.RegistryMethodHubStateAction,
			payload: map[string]any{
				"section": "gatewayUpdate",
				"action":  "requestUpdate",
				"params":  map[string]any{},
			},
			want: true,
		},
		{
			name:    "get is not update query",
			method:  rp.RegistryMethodHubStateGet,
			payload: map[string]any{"sections": []string{"wheelmakerUpdate"}},
			want:    false,
		},
		{
			name:    "multiple refresh sections",
			method:  rp.RegistryMethodHubStateRefresh,
			payload: map[string]any{"sections": []string{"wheelmakerUpdate", "skills"}},
			want:    false,
		},
		{
			name:    "different refresh section",
			method:  rp.RegistryMethodHubStateRefresh,
			payload: map[string]any{"sections": []string{"skills"}},
			want:    false,
		},
		{
			name:   "different action",
			method: rp.RegistryMethodHubStateAction,
			payload: map[string]any{
				"section": "wheelmakerUpdate",
				"action":  "updatePublish",
				"params":  map[string]any{},
			},
			want: false,
		},
		{
			name:   "restart is not allowed",
			method: rp.RegistryMethodHubStateAction,
			payload: map[string]any{
				"section": "wheelmakerUpdate",
				"action":  "restart",
				"params":  map[string]any{},
			},
			want: false,
		},
		{
			name:   "request update with injected params",
			method: rp.RegistryMethodHubStateAction,
			payload: map[string]any{
				"section": "wheelmakerUpdate",
				"action":  "requestUpdate",
				"params":  map[string]any{"releaseURL": "https://example.invalid"},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := envelope{Method: tt.method, Payload: rp.MustRaw(tt.payload)}
			if got := updateOnlyHubRequestAllowed(in); got != tt.want {
				t.Fatalf("updateOnlyHubRequestAllowed(%s, %#v)=%v, want %v", tt.method, tt.payload, got, tt.want)
			}
		})
	}
}

func TestUpdateOnlyHubAllowsOnlyWheelMakerUpdateRequests(t *testing.T) {
	t.Run("forwards update refresh", func(t *testing.T) {
		s := New(Config{ProtocolVersion: "2.7"})
		ts := httptest.NewServer(s.Handler())
		t.Cleanup(ts.Close)

		hub := dialWS(t, ts.URL+"/ws")
		defer hub.Close()
		connectRegistryPeerVersion(t, hub, "hub", "hub-old", "2.6")

		client := dialWS(t, ts.URL+"/ws")
		defer client.Close()
		connectRegistryPeerVersion(t, client, "client", "", "2.7")
		mustWriteJSON(t, client, testEnvelope{
			RequestID: 2,
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodHubStateRefresh,
			HubID:     "hub-old",
			Payload:   map[string]any{"sections": []string{"wheelmakerUpdate"}},
		})
		forwarded := mustReadEnvelope(t, hub)
		if forwarded.Method != rp.RegistryMethodHubStateRefresh || forwarded.HubID != "hub-old" {
			t.Fatalf("forwarded=%#v, want wheelmaker update refresh", forwarded)
		}
		mustWriteJSON(t, hub, testEnvelope{
			RequestID: forwarded.RequestID,
			Type:      rp.RegistryEnvelopeTypeResponse,
			Method:    forwarded.Method,
			HubID:     "hub-old",
			Payload:   map[string]any{"state": map[string]any{"hubId": "hub-old"}},
		})
		if resp := mustReadEnvelope(t, client); resp.Type != rp.RegistryEnvelopeTypeResponse {
			t.Fatalf("client response=%#v, want update response", resp)
		}
	})

	t.Run("rejects other Hub request", func(t *testing.T) {
		s := New(Config{ProtocolVersion: "2.7"})
		ts := httptest.NewServer(s.Handler())
		t.Cleanup(ts.Close)

		hub := dialWS(t, ts.URL+"/ws")
		defer hub.Close()
		connectRegistryPeerVersion(t, hub, "hub", "hub-old", "2.6")

		client := dialWS(t, ts.URL+"/ws")
		defer client.Close()
		connectRegistryPeerVersion(t, client, "client", "", "2.7")
		mustWriteJSON(t, client, testEnvelope{
			RequestID: 2,
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodHubConfigGet,
			HubID:     "hub-old",
			Payload:   map[string]any{},
		})
		_ = client.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		var resp testEnvelope
		if err := client.ReadJSON(&resp); err != nil {
			t.Fatalf("read denied response: %v", err)
		}
		if resp.Type != rp.RegistryEnvelopeTypeError || resp.Payload["code"] != codeForbidden {
			t.Fatalf("response=%#v, want FORBIDDEN", resp)
		}
	})
}

func TestUpdateOnlyHubRejectsRelayForwarding(t *testing.T) {
	s := New(Config{})
	s.hubDescriptors["hub-old"] = rp.HubListItem{
		HubID:          "hub-old",
		ConnectionMode: rp.RegistryConnectionModeUpdateOnly,
	}

	result := s.forwardRelayHubRequest(
		context.Background(),
		"hub-old",
		rp.RegistryMethodHubRelayOpen,
		map[string]any{},
	)
	if result.Code != codeForbidden {
		t.Fatalf("relay result=%#v, want FORBIDDEN", result)
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

func TestServerForwardsSessionQueueAndSessionEventBroadcast(t *testing.T) {
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
		Method:    "session.queue",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
			"action":    "enqueue",
			"item": map[string]any{
				"itemId":    "item-1",
				"kind":      "prompt",
				"createdAt": "2026-07-31T10:00:00Z",
				"blocks":    []map[string]any{{"type": "text", "text": "hello registry session"}},
			},
		},
	})

	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != "session.queue" {
		t.Fatalf("forwarded.method=%q, want session.queue", forwarded.Method)
	}
	if forwarded.ProjectID != "hub-a:server" {
		t.Fatalf("forwarded.projectId=%q, want hub-a:server", forwarded.ProjectID)
	}
	forwardPayload := forwarded.Payload
	item, _ := forwardPayload["item"].(map[string]any)
	if forwardPayload["sessionId"] != "sess-1" || forwardPayload["action"] != "enqueue" ||
		item["itemId"] != "item-1" || item["kind"] != "prompt" {
		t.Fatalf("forwarded payload=%v", forwardPayload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "session.queue",
		ProjectID: forwarded.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	sendResp := mustReadEnvelope(t, client)
	if sendResp.Type != "response" || sendResp.Method != "session.queue" {
		t.Fatalf("unexpected session.queue response: %#v", sendResp)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 21,
		Type:      "request",
		Method:    "session.fork",
		ProjectID: "hub-a:server",
		Payload: map[string]any{
			"sessionId": "sess-1",
			"turnIndex": 7,
		},
	})
	forwardedFork := mustReadEnvelope(t, hub)
	if forwardedFork.Method != "session.fork" || forwardedFork.ProjectID != "hub-a:server" {
		t.Fatalf("unexpected session.fork forwarding: %#v", forwardedFork)
	}
	if forwardedFork.Payload["sessionId"] != "sess-1" || forwardedFork.Payload["turnIndex"] != float64(7) {
		t.Fatalf("forwarded fork payload=%v", forwardedFork.Payload)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwardedFork.RequestID,
		Type:      "response",
		Method:    "session.fork",
		ProjectID: forwardedFork.ProjectID,
		Payload: map[string]any{
			"ok": true,
		},
	})
	forkResp := mustReadEnvelope(t, client)
	if forkResp.Type != "response" || forkResp.Method != "session.fork" {
		t.Fatalf("unexpected session.fork response: %#v", forkResp)
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

func TestReleasePublishRequestRoutesToPublishingHub(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "publisher")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := map[string]any{"kind": "version", "sourcePath": "D:/Code/WheelMaker"}
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    rp.RegistryMethodReleasePublishStart,
		HubID:     "publisher",
		Payload:   payload,
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != rp.RegistryMethodReleasePublishStart || forwarded.HubID != "publisher" {
		t.Fatalf("forwarded = %#v", forwarded)
	}
	if !reflect.DeepEqual(forwarded.Payload, payload) {
		t.Fatalf("forwarded payload = %#v, want %#v", forwarded.Payload, payload)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodReleasePublishStart,
		HubID:     "publisher",
		Payload:   map[string]any{"accepted": true, "job": map[string]any{"id": "job-1"}},
	})
	response := mustReadEnvelope(t, client)
	if response.RequestID != 2 || response.Method != rp.RegistryMethodReleasePublishStart {
		t.Fatalf("response = %#v", response)
	}
	if response.Payload["accepted"] != true {
		t.Fatalf("response payload = %#v", response.Payload)
	}
}

func TestReleaseStorageRequestRoutesToPublishingHub(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "publisher")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := map[string]any{"sourcePath": "D:/Code/WheelMaker"}
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    rp.RegistryMethodReleaseStorageGet,
		HubID:     "publisher",
		Payload:   payload,
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != rp.RegistryMethodReleaseStorageGet || forwarded.HubID != "publisher" {
		t.Fatalf("forwarded = %#v", forwarded)
	}
	if !reflect.DeepEqual(forwarded.Payload, payload) {
		t.Fatalf("forwarded payload = %#v, want %#v", forwarded.Payload, payload)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodReleaseStorageGet,
		HubID:     "publisher",
		Payload:   map[string]any{"ok": true, "storage": map[string]any{"totalBytes": 600}},
	})
	response := mustReadEnvelope(t, client)
	if response.RequestID != 3 || response.Method != rp.RegistryMethodReleaseStorageGet {
		t.Fatalf("response = %#v", response)
	}
	if response.Payload["ok"] != true {
		t.Fatalf("response payload = %#v", response.Payload)
	}
}

func TestUsageHistoryGetForwardsByEnvelopeHubID(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-usage")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    rp.RegistryMethodUsageHistoryGet,
		HubID:     "hub-usage",
		Payload: map[string]any{
			"providerId":     "codex",
			"accountLocalId": "account-1",
		},
	})

	_ = hub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != rp.RegistryMethodUsageHistoryGet {
		t.Fatalf("forwarded=%#v, want usage.history.get request", forwarded)
	}
	if forwarded.HubID != "hub-usage" {
		t.Fatalf("forwarded.hubId=%q, want hub-usage", forwarded.HubID)
	}
	if forwarded.ProjectID != "" {
		t.Fatalf("forwarded.projectId=%q, want empty", forwarded.ProjectID)
	}
	if forwarded.Payload["providerId"] != "codex" || forwarded.Payload["accountLocalId"] != "account-1" {
		t.Fatalf("forwarded.payload=%#v", forwarded.Payload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodUsageHistoryGet,
		HubID:     "hub-usage",
		Payload: map[string]any{
			"hubId":          "hub-usage",
			"providerId":     "codex",
			"accountLocalId": "account-1",
			"limits":         []any{},
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != rp.RegistryMethodUsageHistoryGet {
		t.Fatalf("client response=%#v, want usage.history.get response", resp)
	}
	if resp.HubID != "hub-usage" || resp.Payload["providerId"] != "codex" {
		t.Fatalf("client response=%#v", resp)
	}
}

func TestDeepSeekUsageGetForwardsByEnvelopeHubID(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-deepseek-usage")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage",
		Payload: map[string]any{
			"year":  2026,
			"month": 8,
		},
	})

	_ = hub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != rp.RegistryMethodDeepSeekUsageGet {
		t.Fatalf("forwarded=%#v, want deepseek.usage.get request", forwarded)
	}
	if forwarded.HubID != "hub-deepseek-usage" {
		t.Fatalf("forwarded.hubId=%q, want hub-deepseek-usage", forwarded.HubID)
	}
	if forwarded.ProjectID != "" {
		t.Fatalf("forwarded.projectId=%q, want empty", forwarded.ProjectID)
	}
	if forwarded.Payload["year"] != float64(2026) || forwarded.Payload["month"] != float64(8) {
		t.Fatalf("forwarded.payload=%#v", forwarded.Payload)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage",
		Payload: map[string]any{
			"hubId":  "hub-deepseek-usage",
			"status": "ok",
			"month":  map[string]any{"year": 2026, "month": 8},
			"days":   []any{},
			"costs":  []any{},
		},
	})

	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" || resp.Method != rp.RegistryMethodDeepSeekUsageGet {
		t.Fatalf("client response=%#v, want deepseek.usage.get response", resp)
	}
	if resp.HubID != "hub-deepseek-usage" || resp.Payload["status"] != "ok" {
		t.Fatalf("client response=%#v", resp)
	}
}

func TestHubReleaseNotificationForwardsToTargetHub(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	publisher := dialReportedHub(t, ts.URL+"/ws", "publisher-hub")
	defer publisher.Close()
	target := dialReportedHub(t, ts.URL+"/ws", "server-hub")
	defer target.Close()

	mustWriteJSON(t, publisher, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    rp.RegistryMethodHubReleaseNotify,
		HubID:     "publisher-hub",
		Payload: map[string]any{
			"targetHubId": "server-hub",
			"kind":        "version",
			"baseUrl":     "https://release.wheelmaker.top",
		},
	})

	_ = target.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, target)
	if forwarded.Type != "request" || forwarded.Method != rp.RegistryMethodHubReleaseApply {
		t.Fatalf("forwarded=%#v, want hub.release.apply request", forwarded)
	}
	if forwarded.HubID != "server-hub" {
		t.Fatalf("forwarded.hubId=%q, want server-hub", forwarded.HubID)
	}
	if forwarded.Payload["kind"] != "version" || forwarded.Payload["baseUrl"] != "https://release.wheelmaker.top" {
		t.Fatalf("forwarded.payload=%#v", forwarded.Payload)
	}

	mustWriteJSON(t, target, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    rp.RegistryMethodHubReleaseApply,
		HubID:     "server-hub",
		Payload:   map[string]any{"status": "accepted"},
	})

	result := mustReadEnvelope(t, publisher)
	if result.Type != "response" || result.Method != rp.RegistryMethodHubReleaseNotify {
		t.Fatalf("result=%#v, want hub.release.notify response", result)
	}
	if result.Payload["status"] != "accepted" {
		t.Fatalf("result.payload=%#v", result.Payload)
	}
}

func TestHubReleaseNotificationRejectsNonHTTPSBaseURL(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	publisher := dialReportedHub(t, ts.URL+"/ws", "publisher-hub")
	defer publisher.Close()
	mustWriteJSON(t, publisher, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    rp.RegistryMethodHubReleaseNotify,
		HubID:     "publisher-hub",
		Payload: map[string]any{
			"targetHubId": "server-hub",
			"kind":        "version",
			"baseUrl":     "http://release.wheelmaker.top",
		},
	})

	response := mustReadEnvelope(t, publisher)
	if response.Type != "error" || response.Payload["code"] != codeInvalidArgument {
		t.Fatalf("response=%#v, want invalid argument error", response)
	}
}

func TestHubReleaseNotificationRejectsLegacyDebugWebPath(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	publisher := dialReportedHub(t, ts.URL+"/ws", "publisher-hub")
	defer publisher.Close()
	mustWriteJSON(t, publisher, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    rp.RegistryMethodHubReleaseNotify,
		HubID:     "publisher-hub",
		Payload: map[string]any{
			"targetHubId": "server-hub",
			"kind":        "debugWeb",
			"baseUrl":     "https://release.wheelmaker.top",
		},
	})

	response := mustReadEnvelope(t, publisher)
	if response.Type != "error" || response.Payload["code"] != codeInvalidArgument {
		t.Fatalf("response=%#v, want invalid argument error", response)
	}
}

func TestHubDebugWebTransferForwardsAcknowledgedChunks(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	source := dialReportedHub(t, ts.URL+"/ws", "source-hub")
	defer source.Close()
	target := dialReportedHub(t, ts.URL+"/ws", "web-hub")
	defer target.Close()

	transferID := "transfer-1"
	digest := strings.Repeat("a", 64)
	steps := []struct {
		method        string
		payload       map[string]any
		receiveMethod string
		status        string
	}{
		{rp.RegistryMethodHubDebugWebTransferStart, map[string]any{"transferId": transferID, "targetHubId": "web-hub", "size": 3, "sha256": digest}, rp.RegistryMethodHubDebugWebReceiveStart, "accepted"},
		{rp.RegistryMethodHubDebugWebTransferChunk, map[string]any{"transferId": transferID, "sequence": 0, "data": base64.StdEncoding.EncodeToString([]byte("zip"))}, rp.RegistryMethodHubDebugWebReceiveChunk, "accepted"},
		{rp.RegistryMethodHubDebugWebTransferFinish, map[string]any{"transferId": transferID}, rp.RegistryMethodHubDebugWebReceiveFinish, "success"},
	}
	for index, step := range steps {
		mustWriteJSON(t, source, testEnvelope{RequestID: int64(index + 10), Type: "request", Method: step.method, HubID: "source-hub", Payload: step.payload})
		forwarded := mustReadEnvelope(t, target)
		if forwarded.Method != step.receiveMethod || forwarded.HubID != "web-hub" || forwarded.Payload["transferId"] != transferID {
			t.Fatalf("forwarded=%#v", forwarded)
		}
		mustWriteJSON(t, target, testEnvelope{RequestID: forwarded.RequestID, Type: "response", Method: forwarded.Method, HubID: "web-hub", Payload: map[string]any{"status": step.status}})
		response := mustReadEnvelope(t, source)
		if response.Type != "response" || response.Payload["status"] != step.status {
			t.Fatalf("response=%#v", response)
		}
	}
}

func TestHubDebugWebTransferRejectsOutOfOrderChunk(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	source := dialReportedHub(t, ts.URL+"/ws", "source-hub")
	defer source.Close()
	target := dialReportedHub(t, ts.URL+"/ws", "web-hub")
	defer target.Close()

	mustWriteJSON(t, source, testEnvelope{RequestID: 10, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferStart, HubID: "source-hub", Payload: map[string]any{"transferId": "transfer-2", "targetHubId": "web-hub", "size": 3, "sha256": strings.Repeat("b", 64)}})
	start := mustReadEnvelope(t, target)
	mustWriteJSON(t, target, testEnvelope{RequestID: start.RequestID, Type: "response", Method: start.Method, HubID: "web-hub", Payload: map[string]any{"status": "accepted"}})
	_ = mustReadEnvelope(t, source)

	mustWriteJSON(t, source, testEnvelope{RequestID: 11, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferChunk, HubID: "source-hub", Payload: map[string]any{"transferId": "transfer-2", "sequence": 1, "data": base64.StdEncoding.EncodeToString([]byte("zip"))}})
	response := mustReadEnvelope(t, source)
	if response.Type != "error" || response.Payload["code"] != codeConflict {
		t.Fatalf("response=%#v, want conflict", response)
	}
}

func TestHubDebugWebTransferRejectsOfflineTarget(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	source := dialReportedHub(t, ts.URL+"/ws", "source-hub")
	defer source.Close()
	mustWriteJSON(t, source, testEnvelope{RequestID: 10, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferStart, HubID: "source-hub", Payload: map[string]any{
		"transferId": "transfer-offline", "targetHubId": "offline-hub", "size": 3, "sha256": strings.Repeat("d", 64),
	}})
	response := mustReadEnvelope(t, source)
	if response.Type != "error" || response.Payload["code"] != codeUnavailable {
		t.Fatalf("response=%#v, want unavailable", response)
	}
}

func TestHubDebugWebTransferReleasesSessionWhenReceiverRejectsStart(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	source := dialReportedHub(t, ts.URL+"/ws", "source-hub")
	defer source.Close()
	target := dialReportedHub(t, ts.URL+"/ws", "web-hub")
	defer target.Close()
	payload := map[string]any{"transferId": "transfer-retry", "targetHubId": "web-hub", "size": 3, "sha256": strings.Repeat("e", 64)}

	mustWriteJSON(t, source, testEnvelope{RequestID: 10, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferStart, HubID: "source-hub", Payload: payload})
	first := mustReadEnvelope(t, target)
	mustWriteJSON(t, target, testEnvelope{RequestID: first.RequestID, Type: "response", Method: first.Method, HubID: "web-hub", Payload: map[string]any{"status": "failed", "errorCode": "update_busy"}})
	if response := mustReadEnvelope(t, source); response.Type != "response" || response.Payload["status"] != "failed" {
		t.Fatalf("response=%#v, want receiver failure", response)
	}

	mustWriteJSON(t, source, testEnvelope{RequestID: 11, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferStart, HubID: "source-hub", Payload: payload})
	_ = target.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	second := mustReadEnvelope(t, target)
	if second.Method != rp.RegistryMethodHubDebugWebReceiveStart {
		t.Fatalf("second=%#v, want retried start", second)
	}
	mustWriteJSON(t, target, testEnvelope{RequestID: second.RequestID, Type: "response", Method: second.Method, HubID: "web-hub", Payload: map[string]any{"status": "failed", "errorCode": "update_busy"}})
	_ = mustReadEnvelope(t, source)
}

func TestHubDebugWebTransferAbortsReceiverWhenSourceDisconnects(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	source := dialReportedHub(t, ts.URL+"/ws", "source-hub")
	target := dialReportedHub(t, ts.URL+"/ws", "web-hub")
	defer target.Close()

	mustWriteJSON(t, source, testEnvelope{RequestID: 10, Type: "request", Method: rp.RegistryMethodHubDebugWebTransferStart, HubID: "source-hub", Payload: map[string]any{"transferId": "transfer-3", "targetHubId": "web-hub", "size": 3, "sha256": strings.Repeat("c", 64)}})
	start := mustReadEnvelope(t, target)
	mustWriteJSON(t, target, testEnvelope{RequestID: start.RequestID, Type: "response", Method: start.Method, HubID: "web-hub", Payload: map[string]any{"status": "accepted"}})
	_ = mustReadEnvelope(t, source)
	_ = source.Close()

	_ = target.SetReadDeadline(time.Now().Add(time.Second))
	abort := mustReadEnvelope(t, target)
	if abort.Method != rp.RegistryMethodHubDebugWebReceiveAbort || abort.Payload["transferId"] != "transfer-3" {
		t.Fatalf("abort=%#v", abort)
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

func TestHubStateDeepSeekSecretInjectionIsRemoved(t *testing.T) {
	s := New(Config{})
	original := rp.MustRaw(map[string]any{
		"section": "tokenStats",
		"action":  "deepseekStats",
		"params":  map[string]any{"rangeType": "month"},
	})
	prepared := s.prepareHubStatePayload(envelope{Method: rp.RegistryMethodHubStateAction, Payload: original})
	if !bytes.Equal(prepared, original) {
		t.Fatalf("Registry mutated HubState payload:\n got: %s\nwant: %s", prepared, original)
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
		{
			name:   "session read",
			method: rp.RegistryMethodSessionRead,
			want:   30 * time.Second,
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

func TestRegistryWebSocketNegotiatesPerMessageDeflate(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	dialer := websocket.Dialer{EnableCompression: true}
	conn, response, err := dialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial compressed websocket: %v", err)
	}
	defer conn.Close()

	if extension := response.Header.Get("Sec-WebSocket-Extensions"); !strings.Contains(extension, "permessage-deflate") {
		t.Fatalf("Sec-WebSocket-Extensions=%q, want permessage-deflate", extension)
	}
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

func TestWebSocketRejectsUnauthenticatedOrigins(t *testing.T) {
	for _, tt := range []struct {
		name       string
		origin     func(string) string
		wantStatus int
	}{
		{name: "cross origin", origin: func(string) string { return "https://appassets.androidplatform.net" }, wantStatus: http.StatusForbidden},
		{name: "same origin without session", origin: func(serverURL string) string { return serverURL }, wantStatus: http.StatusUnauthorized},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := New(Config{Token: "custom-token"})
			ts := httptest.NewServer(s.Handler())
			t.Cleanup(ts.Close)
			header := http.Header{"Origin": []string{tt.origin(ts.URL)}}
			conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
			if conn != nil {
				_ = conn.Close()
			}
			if err == nil || resp == nil || resp.StatusCode != tt.wantStatus {
				t.Fatalf("dial error=%v response=%v, want HTTP %d", err, resp, tt.wantStatus)
			}
		})
	}
}

func TestWebSocketBrowserSessionRejectsTokenAndHubRoles(t *testing.T) {
	for _, tt := range []struct {
		name    string
		payload map[string]any
	}{
		{name: "token", payload: map[string]any{"role": "client", "token": "custom-token"}},
		{name: "hub role", payload: map[string]any{"role": "hub", "hubId": "browser-hub"}},
		{name: "unknown role", payload: map[string]any{"role": "unknown"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := New(Config{Token: "custom-token"})
			ts := httptest.NewServer(s.Handler())
			t.Cleanup(ts.Close)
			cookie := loginRegistryBrowser(t, ts.URL, "custom-token", ts.URL)
			header := http.Header{"Origin": []string{ts.URL}, "Cookie": []string{cookie.String()}}
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
			if err != nil {
				t.Fatalf("dial browser session: %v", err)
			}
			defer conn.Close()
			payload := map[string]any{
				"clientName": "wheelmaker-web", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion,
			}
			for key, value := range tt.payload {
				payload[key] = value
			}
			mustWriteJSON(t, conn, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: payload})
			resp := mustReadEnvelope(t, conn)
			if resp.Type != "error" || resp.Payload["code"] != codeForbidden {
				t.Fatalf("connect response=%+v, want forbidden", resp)
			}
		})
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

func TestWebSocketNormalPayloadAboveOneMiBAllowed(t *testing.T) {
	server := New(Config{})
	address := httptestNewRegistryServer(t, server.Handler())
	client := dialWS(t, "http://"+address+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := `{"data":"` + strings.Repeat("x", 2*1024*1024) + `"}`
	message := `{"requestId":2,"type":"request","method":"registry.project.list","payload":` + payload + `}`
	if err := client.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
		t.Fatalf("WriteMessage(): %v", err)
	}
	response := mustReadEnvelope(t, client)
	if response.Type != "response" || response.Method != "registry.project.list" {
		t.Fatalf("response=%#v, want registry.project.list response", response)
	}
}

func TestWebSocketForwardsOneMiBAttachmentChunk(t *testing.T) {
	server := New(Config{})
	address := httptestNewRegistryServer(t, server.Handler())

	hub := dialWS(t, "http://"+address+"/ws")
	defer hub.Close()
	epoch := connectRegistryHub(t, hub, "hub-attachment")
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-attachment",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"projects":        []map[string]any{{"name": "project", "path": "D:/project", "online": true}},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, "http://"+address+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	data := base64.StdEncoding.EncodeToString(make([]byte, 1024*1024))
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    rp.RegistryMethodSessionAttachmentChunk,
		ProjectID: "hub-attachment:project",
		Payload: map[string]any{
			"sessionId": "session-1",
			"uploadId":  "upload-1",
			"offset":    0,
			"data":      data,
		},
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != rp.RegistryMethodSessionAttachmentChunk || forwarded.Payload["data"] != data {
		t.Fatalf("forwarded attachment chunk does not match request")
	}
}

func TestWebSocketMessageTooLargeClosesConnection(t *testing.T) {
	server := New(Config{})
	address := httptestNewRegistryServer(t, server.Handler())
	client := dialWS(t, "http://"+address+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	message := []byte(`{"type":"request","method":"speech.chunk","payload":"` + strings.Repeat("x", maxRegistryMessageBytes) + `"}`)
	_ = client.WriteMessage(websocket.TextMessage, message)
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := client.ReadMessage(); err == nil {
		t.Fatal("oversized wire message left connection open")
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

type recordingIPLocationResolver struct {
	ips []string
}

func (r *recordingIPLocationResolver) ResolveIPLocation(_ context.Context, ip string) string {
	r.ips = append(r.ips, ip)
	return "Shanghai, China"
}

func TestWebLoginStoresTrustedClientIPAndLocation(t *testing.T) {
	resolver := &recordingIPLocationResolver{}
	s := New(Config{Token: "token", IPLocationResolver: resolver})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	headers := sameOriginWebAuthHeaders(ts.URL)
	headers.Set("X-Real-IP", "203.0.113.9")

	failed := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, "/", "login", `{"token":"wrong","deviceName":"Browser"}`, headers, nil)
	_ = failed.Body.Close()
	if failed.StatusCode != http.StatusUnauthorized || len(resolver.ips) != 0 {
		t.Fatalf("failed login status=%d resolver=%v", failed.StatusCode, resolver.ips)
	}

	login := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, "/", "login", `{"token":"token","deviceName":"Browser"}`, headers, nil)
	_ = login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login status=%d", login.StatusCode)
	}
	if !reflect.DeepEqual(resolver.ips, []string{"203.0.113.9"}) {
		t.Fatalf("resolver ips=%v", resolver.ips)
	}
	items, err := s.webSessions.List("")
	if err != nil || len(items) != 1 {
		t.Fatalf("sessions=%+v err=%v", items, err)
	}
	if items[0].LastLoginIP != "203.0.113.9" || items[0].LastLoginLocation != "Shanghai, China" {
		t.Fatalf("session=%+v", items[0])
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

func TestWebSocketSubpathSessionAllowsClientWithoutToken(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	login := doRegistryWebAuthRequest(t, ts.URL, http.MethodPost, "/wheelmaker/", "login", `{"token":"custom-token"}`, sameOriginWebAuthHeaders(ts.URL), nil)
	if login.StatusCode != http.StatusOK || len(login.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", login.StatusCode, login.Cookies())
	}
	cookie := login.Cookies()[0]
	_ = login.Body.Close()
	header := http.Header{"Origin": []string{ts.URL}, "Cookie": []string{cookie.String()}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/wheelmaker/ws", header)
	if err != nil {
		t.Fatalf("dial authenticated subpath browser: %v", err)
	}
	defer conn.Close()
	mustWriteJSON(t, conn, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wm-web", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "client",
	}})
	if resp := mustReadEnvelope(t, conn); resp.Type != "response" {
		t.Fatalf("connect response=%+v", resp)
	}
}

func TestWebSocketTrustsForwardedHTTPSOnlyFromLoopbackProxy(t *testing.T) {
	s := New(Config{Token: "custom-token"})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	cookie := loginRegistryBrowser(t, ts.URL, "custom-token", ts.URL)
	host := strings.TrimPrefix(ts.URL, "http://")
	header := http.Header{
		"Origin":            []string{"https://" + host},
		"Cookie":            []string{cookie.String()},
		"X-Forwarded-Proto": []string{"https"},
	}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", header)
	if err != nil {
		t.Fatalf("dial forwarded HTTPS browser: %v", err)
	}
	_ = conn.Close()
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
	listenPort := reserveTCPPort(t)
	s := New(Config{RelayPortProvider: func() (int, error) { return listenPort, nil }})
	ts := httptestNewRegistryServer(t, s.Handler())

	hub := dialReportedHub(t, "http://"+ts+"/ws", "hub-relay")
	defer hub.Close()

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

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
	connectRegistryPeerVersion(t, ws, "client", "", rp.DefaultProtocolVersion)
}

func connectRegistryPeerVersion(t *testing.T, ws *websocket.Conn, role, hubID, protocolVersion string) int64 {
	t.Helper()
	payload := map[string]any{
		"clientName":      "compat-test",
		"clientVersion":   "0.1.0",
		"protocolVersion": protocolVersion,
		"role":            role,
	}
	if hubID != "" {
		payload["hubId"] = hubID
	}
	mustWriteJSON(t, ws, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload:   payload,
	})
	initResp := mustReadEnvelope(t, ws)
	principal, _ := initResp.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	return int64(connectionEpoch)
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

func TestHubStateUpdatedIsForwardedWithoutMutation(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	hub := dialReportedHub(t, ts.URL+"/ws", "hub-limits")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := map[string]any{
		"sections": []any{"tokenStats"},
		"reason":   "snapshot",
		"state": map[string]any{
			"hubId": "hub-limits",
			"sections": map[string]any{"tokenStats": map[string]any{
				"status": "ready",
				"data":   map[string]any{"hubId": "hub-limits", "generation": float64(2), "status": "ready", "providers": []any{}},
			}},
		},
	}
	mustWriteJSON(t, hub, testEnvelope{Type: "event", Method: rp.RegistryMethodHubStateUpdated, HubID: "hub-limits", Payload: payload})
	forwarded := mustReadEnvelope(t, client)
	if forwarded.Type != "event" || forwarded.Method != rp.RegistryMethodHubStateUpdated || forwarded.HubID != "hub-limits" {
		t.Fatalf("forwarded=%+v", forwarded)
	}
	if !reflect.DeepEqual(forwarded.Payload, payload) {
		t.Fatalf("Registry mutated HubState event:\n got: %#v\nwant: %#v", forwarded.Payload, payload)
	}
}

func TestReleasePublishUpdatedIsForwardedWithoutMutation(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	hub := dialReportedHub(t, ts.URL+"/ws", "publisher")
	defer hub.Close()
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := map[string]any{
		"job": map[string]any{"id": "job-1", "status": "success"},
	}
	mustWriteJSON(t, hub, testEnvelope{
		Type:    "event",
		Method:  rp.RegistryMethodReleasePublishUpdated,
		HubID:   "publisher",
		Payload: payload,
	})
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, client)
	if forwarded.Method != rp.RegistryMethodReleasePublishUpdated || forwarded.HubID != "publisher" {
		t.Fatalf("forwarded = %#v", forwarded)
	}
	if !reflect.DeepEqual(forwarded.Payload, payload) {
		t.Fatalf("forwarded payload = %#v, want %#v", forwarded.Payload, payload)
	}
}

func TestRelayMarkerDispatchesBeforeRegistryRoutes(t *testing.T) {
	server := New(Config{RelayPortProvider: func() (int, error) { return 28810, nil }})
	req := httptest.NewRequest(http.MethodGet, "http://relay.example.com/__wheelmaker/relay/status", nil)
	req.Header.Set(portrelay.RelayMarkerHeader, portrelay.RelayMarkerValue)
	resp := httptest.NewRecorder()
	server.Handler().ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("marked status code=%d, want 200", resp.Code)
	}
}

func TestUnmarkedRegistryRequestDoesNotEnterRelayDataPlane(t *testing.T) {
	server := New(Config{RelayPortProvider: func() (int, error) { return 28810, nil }})
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:9630/__wheelmaker/relay/status", nil)
	resp := httptest.NewRecorder()
	server.Handler().ServeHTTP(resp, req)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("unmarked status code=%d, want 404", resp.Code)
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

func TestRegistryDoesNotReadGatewayConfig(t *testing.T) {
	server := New(Config{RelayPort: 0})
	snapshot := server.relay.Status()
	if snapshot.ListenPortManaged || snapshot.Error != "" || snapshot.Enabled {
		t.Fatalf("registry snapshot=%+v, want disabled client-managed mode", snapshot)
	}
}

func TestRegistryHTMLPreviewBasePath(t *testing.T) {
	tests := []struct {
		path string
		want string
		ok   bool
	}{
		{path: "/ws/preview/", want: "/", ok: true},
		{path: "/wheelmaker/ws/preview/", want: "/wheelmaker/", ok: true},
		{path: "/ws/preview", ok: false},
		{path: "/ws/preview/extra", ok: false},
		{path: "/wheelmaker//ws/preview/", ok: false},
		{path: "/wheelmaker/../ws/preview/", ok: false},
		{path: `\ws\preview\`, ok: false},
	}
	for _, test := range tests {
		got, ok := registryHTMLPreviewBasePath(test.path)
		if got != test.want || ok != test.ok {
			t.Errorf(
				"registryHTMLPreviewBasePath(%q) = %q, %v; want %q, %v",
				test.path,
				got,
				ok,
				test.want,
				test.ok,
			)
		}
	}
}

func TestRegistryHTMLPreviewRequestAllowed(t *testing.T) {
	valid := httptest.NewRequest(http.MethodPost, "https://preview.example/ws/preview/", nil)
	valid.Host = "preview.example"
	valid.Header.Set("Origin", "https://preview.example")
	valid.Header.Set("Sec-Fetch-Site", "same-origin")
	valid.Header.Set("Sec-Fetch-Mode", "navigate")
	valid.Header.Set("Sec-Fetch-Dest", "iframe")

	if !registryHTMLPreviewRequestAllowed(valid) {
		t.Fatal("valid iframe navigation was rejected")
	}

	opaqueOrigin := valid.Clone(valid.Context())
	opaqueOrigin.Header = valid.Header.Clone()
	opaqueOrigin.Header.Set("Origin", "null")
	if !registryHTMLPreviewRequestAllowed(opaqueOrigin) {
		t.Fatal("sandboxed iframe navigation with an opaque origin was rejected")
	}

	for _, header := range []string{"Origin", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest"} {
		t.Run("missing_"+header, func(t *testing.T) {
			request := valid.Clone(valid.Context())
			request.Header = valid.Header.Clone()
			request.Header.Del(header)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatalf("request missing %s was accepted", header)
			}
		})
	}

	for name, mutate := range map[string]func(*http.Request){
		"cross_origin": func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") },
		"cross_site":   func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"cors":         func(r *http.Request) { r.Header.Set("Sec-Fetch-Mode", "cors") },
		"top_level":    func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "document") },
	} {
		t.Run(name, func(t *testing.T) {
			request := valid.Clone(valid.Context())
			request.Header = valid.Header.Clone()
			mutate(request)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatal("invalid browser provenance was accepted")
			}
		})
	}

	for name, mutate := range map[string]func(*http.Request){
		"missing_fetch_site": func(r *http.Request) { r.Header.Del("Sec-Fetch-Site") },
		"cross_site":         func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"cors":               func(r *http.Request) { r.Header.Set("Sec-Fetch-Mode", "cors") },
		"top_level":          func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "document") },
	} {
		t.Run("opaque_origin_"+name, func(t *testing.T) {
			request := opaqueOrigin.Clone(opaqueOrigin.Context())
			request.Header = opaqueOrigin.Header.Clone()
			mutate(request)
			if registryHTMLPreviewRequestAllowed(request) {
				t.Fatal("opaque origin without strict iframe provenance was accepted")
			}
		})
	}
}

func newHTMLPreviewFormRequest(values url.Values) (*httptest.ResponseRecorder, *http.Request) {
	body := values.Encode()
	request := httptest.NewRequest(
		http.MethodPost,
		"https://preview.example/ws/preview/",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
	return httptest.NewRecorder(), request
}

func cloneHTMLPreviewValues(values url.Values) url.Values {
	cloned := make(url.Values, len(values))
	for key, entries := range values {
		cloned[key] = append([]string(nil), entries...)
	}
	return cloned
}

func TestDecodeRegistryHTMLPreviewForm(t *testing.T) {
	tests := []struct {
		name        string
		values      url.Values
		wantMethod  string
		wantPayload map[string]string
	}{
		{
			name: "project file",
			values: url.Values{
				"source": {"project-file"}, "projectId": {"proj1"},
				"path": {"docs/demo.HTML"}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSRead,
			wantPayload: map[string]string{"path": "docs/demo.HTML"},
		},
		{
			name: "external Windows file",
			values: url.Values{
				"source": {"external-file"}, "projectId": {"proj1"},
				"path": {`C:\demo\page.htm`}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": `C:\demo\page.htm`},
		},
		{
			name: "external POSIX file",
			values: url.Values{
				"source": {"external-file"}, "projectId": {"proj1"},
				"path": {"/tmp/page.html"}, "csrfToken": {"csrf"},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": "/tmp/page.html"},
		},
		{
			name: "attachment id",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "attachmentId": "sha256-a",
			},
		},
		{
			name: "attachment uri",
			values: url.Values{
				"source": {"session-attachment"}, "projectId": {"proj1"},
				"sessionId": {"sess1"}, "uri": {"file:///attachment/page.html"}, "csrfToken": {"csrf"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "uri": "file:///attachment/page.html",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, request := newHTMLPreviewFormRequest(test.values)
			got, err := decodeRegistryHTMLPreviewForm(recorder, request)
			if err != nil {
				t.Fatal(err)
			}
			if got.Method != test.wantMethod {
				t.Fatalf("method = %q, want %q", got.Method, test.wantMethod)
			}
			var payload map[string]string
			if err := json.Unmarshal(got.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(payload, test.wantPayload) {
				t.Fatalf("payload = %#v, want %#v", payload, test.wantPayload)
			}
			if got.ProjectID != "proj1" || got.CSRFToken != "csrf" {
				t.Fatalf("common fields = %#v", got)
			}
		})
	}
}

func TestDecodeRegistryHTMLPreviewFormRejectsInvalidInput(t *testing.T) {
	valid := url.Values{
		"source": {"project-file"}, "projectId": {"proj1"},
		"path": {"page.html"}, "csrfToken": {"csrf"},
	}
	tests := map[string]func(url.Values, *http.Request){
		"unknown field": func(values url.Values, _ *http.Request) {
			values.Set("method", "project.delete")
		},
		"duplicate field": func(values url.Values, _ *http.Request) {
			values["path"] = []string{"a.html", "b.html"}
		},
		"missing project": func(values url.Values, _ *http.Request) {
			values.Del("projectId")
		},
		"empty csrf": func(values url.Values, _ *http.Request) {
			values.Set("csrfToken", "")
		},
		"wrong extension": func(values url.Values, _ *http.Request) {
			values.Set("path", "page.svg")
		},
		"relative external path": func(values url.Values, _ *http.Request) {
			values.Set("source", "external-file")
		},
		"empty extra field": func(values url.Values, _ *http.Request) {
			values.Set("sessionId", "")
		},
		"attachment identities": func(values url.Values, _ *http.Request) {
			values.Set("source", "session-attachment")
			values.Set("sessionId", "sess1")
			values.Set("attachmentId", "sha256-a")
			values.Set("uri", "file:///page.html")
			values.Del("path")
		},
		"attachment without identity": func(values url.Values, _ *http.Request) {
			values.Set("source", "session-attachment")
			values.Set("sessionId", "sess1")
			values.Del("path")
		},
		"unsupported media": func(_ url.Values, request *http.Request) {
			request.Header.Set("Content-Type", "application/json")
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			values := cloneHTMLPreviewValues(valid)
			recorder, request := newHTMLPreviewFormRequest(values)
			mutate(values, request)
			if request.Header.Get("Content-Type") != "application/json" {
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			}
			if _, err := decodeRegistryHTMLPreviewForm(recorder, request); err == nil {
				t.Fatal("invalid form was accepted")
			}
		})
	}
}

func TestDecodeRegistryHTMLPreviewFormLimitsDescriptorBody(t *testing.T) {
	values := url.Values{
		"source": {"project-file"}, "projectId": {"proj1"},
		"path": {"page.html"}, "csrfToken": {strings.Repeat("x", maxHTMLPreviewDescriptorBytes)},
	}
	recorder, request := newHTMLPreviewFormRequest(values)
	_, err := decodeRegistryHTMLPreviewForm(recorder, request)
	var maxBytesErr *http.MaxBytesError
	if !errors.As(err, &maxBytesErr) {
		t.Fatalf("error = %v, want *http.MaxBytesError", err)
	}
}

func TestRegistryHTMLPreviewRouteIsolation(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	tests := []struct {
		name      string
		method    string
		path      string
		want      int
		wantAllow string
	}{
		{
			name:      "canonical route rejects get",
			method:    http.MethodGet,
			path:      "/ws/preview/",
			want:      http.StatusMethodNotAllowed,
			wantAllow: http.MethodPost,
		},
		{
			name:   "query is not a preview route",
			method: http.MethodPost,
			path:   "/ws/preview/?source=project-file",
			want:   http.StatusNotFound,
		},
		{
			name:   "missing trailing slash is not a preview route",
			method: http.MethodPost,
			path:   "/ws/preview",
			want:   http.StatusNotFound,
		},
		{
			name:   "web auth route remains isolated",
			method: http.MethodGet,
			path:   "/ws?auth=status",
			want:   http.StatusOK,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, testServer.URL+test.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.want {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.want)
			}
			if got := response.Header.Get("Allow"); got != test.wantAllow {
				t.Fatalf("Allow = %q, want %q", got, test.wantAllow)
			}
		})
	}
}

func TestExecuteProjectRequestCancellationCleansPending(t *testing.T) {
	server := New(Config{})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHubProjects(t, hub, "hub-preview", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan envelope, 1)
	go func() {
		result <- server.executeProjectRequest(ctx, "", envelope{
			Type:      rp.RegistryEnvelopeTypeRequest,
			Method:    rp.RegistryMethodProjectFSRead,
			ProjectID: "hub-preview:proj1",
			Payload:   rp.MustRaw(map[string]string{"path": "page.html"}),
		})
	}()

	forwarded := mustReadEnvelope(t, hub)
	cancel()
	response := <-result
	var payload errorPayload
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != codeTimeout {
		t.Fatalf("code = %q, want %q", payload.Code, codeTimeout)
	}

	server.mu.RLock()
	peer := server.hubPeers["hub-preview"]
	server.mu.RUnlock()
	peer.pendingMu.Lock()
	_, pending := peer.pending[forwarded.RequestID]
	peer.pendingMu.Unlock()
	if pending {
		t.Fatal("cancelled request remained pending")
	}
}

func loginHTMLPreviewBrowser(
	t *testing.T,
	baseURL string,
	basePath string,
) (*http.Cookie, string) {
	t.Helper()
	login := doRegistryWebAuthRequest(
		t,
		baseURL,
		http.MethodPost,
		basePath,
		"login",
		`{"token":"custom-token","deviceName":"HTML preview test"}`,
		sameOriginWebAuthHeaders(baseURL),
		nil,
	)
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK || len(login.Cookies()) != 1 {
		t.Fatalf("login status=%d cookies=%v", login.StatusCode, login.Cookies())
	}
	var payload struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.NewDecoder(login.Body).Decode(&payload); err != nil || payload.CSRFToken == "" {
		t.Fatalf("decode login csrfToken=%q err=%v", payload.CSRFToken, err)
	}
	return login.Cookies()[0], payload.CSRFToken
}

func mustReportHTMLPreviewHub(
	t *testing.T,
	hub *websocket.Conn,
	hubID string,
	token string,
	projects []map[string]any,
) {
	t.Helper()
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 1,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodConnectInit,
		Payload: map[string]any{
			"clientName":      "wheelmaker-hub",
			"clientVersion":   "0.1.0",
			"protocolVersion": rp.DefaultProtocolVersion,
			"role":            "hub",
			"hubId":           hubID,
			"token":           token,
		},
	})
	initResponse := mustReadEnvelope(t, hub)
	principal, _ := initResponse.Payload["principal"].(map[string]any)
	connectionEpoch, _ := principal["connectionEpoch"].(float64)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodHubReportProjects,
		HubID:     hubID,
		Payload: map[string]any{
			"connectionEpoch": int64(connectionEpoch),
			"projects":        projects,
		},
	})
	if response := mustReadEnvelope(t, hub); response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("hub report response = %#v", response)
	}
}

func newHTMLPreviewHTTPRequest(
	t *testing.T,
	baseURL string,
	basePath string,
	cookie *http.Cookie,
	csrf string,
	values url.Values,
) *http.Request {
	t.Helper()
	values = cloneHTMLPreviewValues(values)
	values.Set("csrfToken", csrf)
	request, err := http.NewRequest(
		http.MethodPost,
		baseURL+strings.TrimSuffix(basePath, "/")+"/ws/preview/",
		strings.NewReader(values.Encode()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", baseURL)
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Dest", "iframe")
	return request
}

func TestRegistryHTMLPreviewForwardsSources(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	tests := []struct {
		name        string
		form        url.Values
		wantMethod  string
		wantPayload map[string]string
		response    map[string]any
		wantBody    string
	}{
		{
			name: "project",
			form: url.Values{
				"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
				"path": {"page.html"},
			},
			wantMethod:  rp.RegistryMethodProjectFSRead,
			wantPayload: map[string]string{"path": "page.html"},
			response: map[string]any{
				"content":  "<script>document.body.dataset.ready='yes'</script>",
				"encoding": "utf-8", "isBinary": false, "mimeType": "text/html",
			},
			wantBody: "<script>document.body.dataset.ready='yes'</script>",
		},
		{
			name: "external",
			form: url.Values{
				"source": {"external-file"}, "projectId": {"hub-preview:proj1"},
				"path": {`C:\preview\page.htm`},
			},
			wantMethod:  rp.RegistryMethodProjectFSExternalRead,
			wantPayload: map[string]string{"path": `C:\preview\page.htm`},
			response: map[string]any{
				"content": "<p>external</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/html",
			},
			wantBody: "<p>external</p>",
		},
		{
			name: "attachment",
			form: url.Values{
				"source": {"session-attachment"}, "projectId": {"hub-preview:proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"},
			},
			wantMethod: rp.RegistryMethodSessionAttachmentRead,
			wantPayload: map[string]string{
				"sessionId": "sess1", "attachmentId": "sha256-a",
			},
			response: map[string]any{
				"content": "<p>attachment</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/html; charset=utf-8",
			},
			wantBody: "<p>attachment</p>",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				cookie,
				csrf,
				test.form,
			)
			type result struct {
				response *http.Response
				err      error
			}
			resultChannel := make(chan result, 1)
			go func() {
				response, err := http.DefaultClient.Do(request)
				resultChannel <- result{response: response, err: err}
			}()

			if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			forwarded := mustReadEnvelope(t, hub)
			if err := hub.SetReadDeadline(time.Time{}); err != nil {
				t.Fatal(err)
			}
			if forwarded.Method != test.wantMethod ||
				forwarded.ProjectID != "hub-preview:proj1" {
				t.Fatalf("forwarded request = %#v", forwarded)
			}
			if !reflect.DeepEqual(forwarded.Payload, mapStringAny(test.wantPayload)) {
				t.Fatalf("payload = %#v, want %#v", forwarded.Payload, test.wantPayload)
			}
			mustWriteJSON(t, hub, testEnvelope{
				RequestID: forwarded.RequestID,
				Type:      rp.RegistryEnvelopeTypeResponse,
				Method:    forwarded.Method,
				ProjectID: forwarded.ProjectID,
				Payload:   test.response,
			})

			got := <-resultChannel
			if got.err != nil {
				t.Fatal(got.err)
			}
			defer got.response.Body.Close()
			body, err := io.ReadAll(got.response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if got.response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d body = %s", got.response.StatusCode, body)
			}
			if string(body) != test.wantBody {
				t.Fatalf("body = %q, want %q", body, test.wantBody)
			}
			assertHTMLPreviewSecurityHeaders(t, got.response, true)
			if got.response.Header.Get("Content-Type") != "text/html; charset=utf-8" {
				t.Fatalf("Content-Type = %q", got.response.Header.Get("Content-Type"))
			}
			if got.response.Header.Get("Content-Disposition") != "inline" {
				t.Fatalf("Content-Disposition = %q", got.response.Header.Get("Content-Disposition"))
			}
		})
	}
}

func mapStringAny(values map[string]string) map[string]any {
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func assertHTMLPreviewSecurityHeaders(t *testing.T, response *http.Response, success bool) {
	t.Helper()
	if got := response.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := response.Header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy = %q", got)
	}
	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := response.Header.Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options = %q, want absent", got)
	}
	csp := response.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors 'self'") ||
		!strings.Contains(csp, "sandbox") {
		t.Fatalf("CSP = %q", csp)
	}
	if !success {
		if strings.Contains(csp, "allow-scripts") {
			t.Fatalf("error CSP enables scripts: %s", csp)
		}
		return
	}
	for _, directive := range []string{
		"script-src 'unsafe-inline' https:",
		"style-src 'unsafe-inline' https:",
		"img-src data: blob: https:",
		"font-src data: https:",
		"media-src data: blob: https:",
		"connect-src 'none'",
		"frame-src 'none'",
		"worker-src 'none'",
		"form-action 'none'",
		"sandbox allow-scripts",
	} {
		if !strings.Contains(csp, directive) {
			t.Fatalf("CSP missing %q: %s", directive, csp)
		}
	}
	if strings.Contains(csp, "'unsafe-eval'") {
		t.Fatalf("CSP allows unsafe-eval: %s", csp)
	}
}

func TestDecodeRegistryHTMLPreviewResultRejectsInvalidUTF8(t *testing.T) {
	payload := append([]byte(`{"content":"`), byte(0xff))
	payload = append(payload, []byte(`","encoding":"utf-8","isBinary":false}`)...)
	if content, err := decodeRegistryHTMLPreviewResult("project-file", payload); err == nil {
		t.Fatalf("invalid UTF-8 content was accepted as %q", content)
	}
}

func TestDecodeRegistryHTMLPreviewResultRejectsUnsupportedContent(t *testing.T) {
	tests := []struct {
		name    string
		source  string
		payload map[string]any
	}{
		{
			name:   "binary",
			source: "project-file",
			payload: map[string]any{
				"content": "YWJj", "encoding": "base64", "isBinary": true,
			},
		},
		{
			name:   "missing binary flag",
			source: "project-file",
			payload: map[string]any{
				"content": "<p>page</p>", "encoding": "utf-8",
			},
		},
		{
			name:   "missing content",
			source: "project-file",
			payload: map[string]any{
				"encoding": "utf-8", "isBinary": false,
			},
		},
		{
			name:   "non html attachment",
			source: "session-attachment",
			payload: map[string]any{
				"content": "<p>page</p>", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/plain",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if content, err := decodeRegistryHTMLPreviewResult(
				test.source,
				rp.MustRaw(test.payload),
			); err == nil {
				t.Fatalf("unsupported content was accepted as %q", content)
			}
		})
	}
}

func TestRegistryHTMLPreviewResponseStatus(t *testing.T) {
	tests := []struct {
		name     string
		response envelope
		want     int
	}{
		{
			name: "success",
			response: envelope{
				Type: rp.RegistryEnvelopeTypeResponse,
			},
			want: http.StatusOK,
		},
		{
			name: "not found",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeNotFound}),
			},
			want: http.StatusNotFound,
		},
		{
			name: "offline",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeUnavailable}),
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name: "timeout",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeTimeout}),
			},
			want: http.StatusGatewayTimeout,
		},
		{
			name: "internal",
			response: envelope{
				Type:    rp.RegistryEnvelopeTypeError,
				Payload: rp.MustRaw(errorPayload{Code: codeInternal}),
			},
			want: http.StatusBadGateway,
		},
		{
			name: "invalid envelope type",
			response: envelope{
				Type: rp.RegistryEnvelopeTypeEvent,
			},
			want: http.StatusBadGateway,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := registryHTMLPreviewResponseStatus(test.response); got != test.want {
				t.Fatalf("status = %d, want %d", got, test.want)
			}
		})
	}
}

func TestRegistryHTMLPreviewSecurityFailures(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	valid := url.Values{
		"source": {"project-file"}, "projectId": {"missing:project"},
		"path": {`C:\private\page.html`},
	}

	tests := []struct {
		name   string
		cookie *http.Cookie
		csrf   string
		mutate func(*http.Request)
		want   int
	}{
		{
			name: "no session", csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Del("Cookie")
			},
			want: http.StatusUnauthorized,
		},
		{
			name: "wrong origin", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Origin", "https://evil.example")
			},
			want: http.StatusForbidden,
		},
		{
			name: "missing fetch site", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Del("Sec-Fetch-Site")
			},
			want: http.StatusForbidden,
		},
		{
			name: "top level navigation", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Sec-Fetch-Dest", "document")
			},
			want: http.StatusForbidden,
		},
		{
			name: "wrong csrf", cookie: cookie, csrf: "csrf-secret",
			want: http.StatusForbidden,
		},
		{
			name: "unsupported media", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				request.Header.Set("Content-Type", "application/json")
			},
			want: http.StatusUnsupportedMediaType,
		},
		{
			name: "invalid schema", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				values := url.Values{
					"source": {"project-file"}, "projectId": {"missing:project"},
					"path": {"page.svg"}, "csrfToken": {csrf},
				}
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			},
			want: http.StatusBadRequest,
		},
		{
			name: "descriptor too large", cookie: cookie, csrf: csrf,
			mutate: func(request *http.Request) {
				values := url.Values{
					"source": {"project-file"}, "projectId": {"missing:project"},
					"path":      {"page.html"},
					"csrfToken": {strings.Repeat("x", maxHTMLPreviewDescriptorBytes)},
				}
				encoded := values.Encode()
				request.Body = io.NopCloser(strings.NewReader(encoded))
				request.ContentLength = int64(len(encoded))
			},
			want: http.StatusRequestEntityTooLarge,
		},
		{
			name: "project not found", cookie: cookie, csrf: csrf,
			want: http.StatusNotFound,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				test.cookie,
				test.csrf,
				valid,
			)
			if test.mutate != nil {
				test.mutate(request)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != test.want {
				t.Fatalf("status = %d, want %d; body = %s", response.StatusCode, test.want, body)
			}
			assertHTMLPreviewSecurityHeaders(t, response, false)
			for _, secret := range []string{
				`C:\private\page.html`,
				"csrf-secret",
				"project not found",
			} {
				if strings.Contains(string(body), secret) {
					t.Fatalf("error body leaked %q: %s", secret, body)
				}
			}
		})
	}
}

func TestRegistryHTMLPreviewAllowsSandboxedOpaqueOrigin(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	request := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"missing:project"},
			"path": {"page.html"},
		},
	)
	request.Header.Set("Origin", "null")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	assertHTMLPreviewSecurityHeaders(t, response, false)
}

func TestRegistryHTMLPreviewBasePathSessionIsolation(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/wheelmaker/")
	values := url.Values{
		"source": {"project-file"}, "projectId": {"missing:project"},
		"path": {"page.html"},
	}

	subpathRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/wheelmaker/",
		cookie,
		csrf,
		values,
	)
	subpathResponse, err := http.DefaultClient.Do(subpathRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer subpathResponse.Body.Close()
	if subpathResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("subpath status = %d, want 404", subpathResponse.StatusCode)
	}

	rootRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		values,
	)
	rootResponse, err := http.DefaultClient.Do(rootRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer rootResponse.Body.Close()
	if rootResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("root status = %d, want 401", rootResponse.StatusCode)
	}
}

func TestRegistryHTMLPreviewHubRuntimeFailures(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	server.mu.Lock()
	server.projectToHub["offline:proj1"] = "offline-hub"
	server.mu.Unlock()
	offlineRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"offline:proj1"},
			"path": {"page.html"},
		},
	)
	offlineResponse, err := http.DefaultClient.Do(offlineRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer offlineResponse.Body.Close()
	if offlineResponse.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("offline status = %d, want 503", offlineResponse.StatusCode)
	}

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cancelledRequest := newHTMLPreviewHTTPRequest(
		t,
		testServer.URL,
		"/",
		cookie,
		csrf,
		url.Values{
			"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
			"path": {"page.html"},
		},
	)
	ctx, cancel := context.WithCancel(cancelledRequest.Context())
	cancel()
	recorder := httptest.NewRecorder()
	server.handleHTTP(recorder, cancelledRequest.WithContext(ctx))
	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("cancelled status = %d, want 504", recorder.Code)
	}
}

func TestRegistryHTMLPreviewRejectsUnsupportedHubContent(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-preview", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")

	tests := []struct {
		name     string
		form     url.Values
		response map[string]any
	}{
		{
			name: "binary file",
			form: url.Values{
				"source": {"project-file"}, "projectId": {"hub-preview:proj1"},
				"path": {"page.html"},
			},
			response: map[string]any{
				"content": "AAE=", "encoding": "base64",
				"isBinary": true, "mimeType": "application/octet-stream",
			},
		},
		{
			name: "non html attachment",
			form: url.Values{
				"source": {"session-attachment"}, "projectId": {"hub-preview:proj1"},
				"sessionId": {"sess1"}, "attachmentId": {"sha256-a"},
			},
			response: map[string]any{
				"content": "plain", "encoding": "utf-8",
				"isBinary": false, "mimeType": "text/plain",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := newHTMLPreviewHTTPRequest(
				t,
				testServer.URL,
				"/",
				cookie,
				csrf,
				test.form,
			)
			type result struct {
				response *http.Response
				err      error
			}
			resultChannel := make(chan result, 1)
			go func() {
				response, err := http.DefaultClient.Do(request)
				resultChannel <- result{response: response, err: err}
			}()

			if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatal(err)
			}
			forwarded := mustReadEnvelope(t, hub)
			if err := hub.SetReadDeadline(time.Time{}); err != nil {
				t.Fatal(err)
			}
			mustWriteJSON(t, hub, testEnvelope{
				RequestID: forwarded.RequestID,
				Type:      rp.RegistryEnvelopeTypeResponse,
				Method:    forwarded.Method,
				ProjectID: forwarded.ProjectID,
				Payload:   test.response,
			})
			got := <-resultChannel
			if got.err != nil {
				t.Fatal(got.err)
			}
			defer got.response.Body.Close()
			if got.response.StatusCode != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want 415", got.response.StatusCode)
			}
			assertHTMLPreviewSecurityHeaders(t, got.response, false)
		})
	}
}

func TestSpeechBackendSecretIsPassedOnlyToProvider(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{ServerData: writeSpeechServerData(t, "backend-speech-key")})
	s.speech.provider = provider
	ts := httptestNewRegistryServer(t, s.Handler())
	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	writeSpeechStartRequest(t, client, 2)
	resp := mustReadEnvelope(t, client)
	if resp.Type != "response" {
		t.Fatalf("speech start response=%#v", resp)
	}
	if provider.start.credential != "backend-speech-key" {
		t.Fatalf("provider credential was not resolved from backend")
	}
	encoded, _ := json.Marshal(resp)
	if bytes.Contains(encoded, []byte("backend-speech-key")) {
		t.Fatalf("response leaks backend key: %s", encoded)
	}
}

func TestSpeechRejectsAPIKeyFromClient(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{ServerData: writeSpeechServerData(t, "backend-key")})
	s.speech.provider = provider
	ts := httptestNewRegistryServer(t, s.Handler())
	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	mustWriteJSON(t, client, testEnvelope{RequestID: 2, Type: "request", Method: "speech.start", Payload: map[string]any{
		"provider": "volcengine", "apiKey": "client-key", "audio": map[string]any{"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
	}})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Payload["code"] != codeInvalidArgument {
		t.Fatalf("response=%#v, want invalid argument", resp)
	}
	if provider.stream != nil {
		t.Fatal("provider started for client-supplied apiKey")
	}
}

func TestSpeechNotConfiguredUsesStableCode(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{ServerData: writeSpeechServerData(t, "")})
	s.speech.provider = provider
	ts := httptestNewRegistryServer(t, s.Handler())
	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	writeSpeechStartRequest(t, client, 2)
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Payload["code"] != "not_configured" {
		t.Fatalf("response=%#v, want not_configured", resp)
	}
	if provider.stream != nil {
		t.Fatal("provider started without backend secret")
	}
}

func writeSpeechServerData(t *testing.T, value string) *serverdata.Store {
	t.Helper()
	store := serverdata.New(filepath.Join(t.TempDir(), "server-data.json"))
	if value != "" {
		if err := store.UpdateSecret(serverdata.SecretVolcengineASR, "set", value, time.Now()); err != nil {
			t.Fatalf("write server data: %v", err)
		}
	}
	return store
}

func TestSpeechMethodsAreClientOnly(t *testing.T) {
	for _, method := range []string{
		"speech.start",
		"speech.chunk",
		"speech.finish",
		"speech.cancel",
	} {
		if !methodAllowed("client", method) {
			t.Fatalf("client should be allowed to call %s", method)
		}
		if methodAllowed("hub", method) {
			t.Fatalf("hub should not be allowed to call %s", method)
		}
		if methodAllowed("monitor", method) {
			t.Fatalf("monitor should not be allowed to call %s", method)
		}
		if !isSpeechRequestMethod(method) {
			t.Fatalf("%s should be recognized as a speech request method", method)
		}
	}
}

func testSpeechSecretResolver() (string, error) { return "secret-key", nil }

func TestRedactSpeechPayloadHidesSecretsAndAudio(t *testing.T) {
	start := redactSpeechPayload("speech.start", speechStartPayload{
		Provider: "volcengine",
		Audio: speechAudioConfig{
			Format:  "pcm",
			Codec:   "raw",
			Rate:    16000,
			Bits:    16,
			Channel: 1,
		},
	})
	startPayload, ok := start.(speechStartPayload)
	if !ok {
		t.Fatalf("redacted start type=%T, want speechStartPayload", start)
	}
	if startPayload.Provider != "volcengine" || startPayload.Audio.Rate != 16000 {
		t.Fatalf("redaction should preserve non-secret metadata: %#v", startPayload)
	}

	chunk := redactSpeechPayload("speech.chunk", speechChunkPayload{
		StreamID: "speech-1",
		Seq:      12,
		PCM:      "AQIDBA==",
	})
	chunkPayload, ok := chunk.(speechChunkDebugPayload)
	if !ok {
		t.Fatalf("redacted chunk type=%T, want speechChunkDebugPayload", chunk)
	}
	if chunkPayload.PCM != "[base64 omitted]" {
		t.Fatalf("pcm=%q, want omitted marker", chunkPayload.PCM)
	}
	if chunkPayload.ByteCount != 4 {
		t.Fatalf("byteCount=%d, want 4", chunkPayload.ByteCount)
	}
}

func TestSpeechLifecycleUsesRegistryLocalProvider(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "speech.start",
		Payload: map[string]any{
			"provider": "volcengine",
			"audio": map[string]any{
				"format":  "pcm",
				"codec":   "raw",
				"rate":    16000,
				"bits":    16,
				"channel": 1,
			},
		},
	})
	startResp := mustReadEnvelope(t, client)
	if startResp.Type != "response" || startResp.Method != "speech.start" {
		t.Fatalf("speech.start response=%#v", startResp)
	}
	streamID, ok := startResp.Payload["streamId"].(string)
	if !ok || streamID == "" {
		t.Fatalf("missing streamId in response: %#v", startResp.Payload)
	}
	if provider.start.credential != "secret-key" || provider.start.Audio.Rate != 16000 {
		t.Fatalf("provider start=%#v", provider.start)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.chunk",
		Payload: map[string]any{
			"streamId": streamID,
			"seq":      1,
			"pcm":      "AQIDBA==",
		},
	})
	chunkResp := mustReadEnvelope(t, client)
	if chunkResp.Type != "response" || chunkResp.Method != "speech.chunk" {
		t.Fatalf("speech.chunk response=%#v", chunkResp)
	}
	if !bytes.Equal(provider.stream.writes[0], []byte{1, 2, 3, 4}) {
		t.Fatalf("provider audio=%v, want [1 2 3 4]", provider.stream.writes[0])
	}

	provider.stream.events.Transcript("你好", false)
	transcript := mustReadEnvelope(t, client)
	if transcript.Type != "event" || transcript.Method != "speech.transcript" {
		t.Fatalf("transcript event=%#v", transcript)
	}
	if transcript.Payload["streamId"] != streamID || transcript.Payload["text"] != "你好" || transcript.Payload["final"] != false {
		t.Fatalf("transcript payload=%#v", transcript.Payload)
	}

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	finishResp := mustReadEnvelope(t, client)
	if finishResp.Type != "response" || finishResp.Method != "speech.finish" {
		t.Fatalf("speech.finish response=%#v", finishResp)
	}
	if !provider.stream.finished {
		t.Fatal("provider stream should be finished")
	}
}

func TestSpeechChunkRejectsBadBase64(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStream(t, client)
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.chunk",
		Payload: map[string]any{
			"streamId": streamID,
			"seq":      1,
			"pcm":      "$$$",
		},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "speech.chunk" {
		t.Fatalf("speech.chunk bad base64 response=%#v", resp)
	}
	if resp.Payload["code"] != codeInvalidArgument {
		t.Fatalf("code=%#v, want %s", resp.Payload["code"], codeInvalidArgument)
	}
	if len(provider.stream.writes) != 0 {
		t.Fatalf("provider should not receive invalid audio: %#v", provider.stream.writes)
	}
}

func TestSpeechChunkPayloadTooLarge(t *testing.T) {
	server := New(Config{})
	address := httptestNewRegistryServer(t, server.Handler())
	client := dialWS(t, "http://"+address+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	payload := `{"streamId":"speech-1","seq":1,"pcm":"` + strings.Repeat("A", maxSpeechChunkPayloadBytes) + `"}`
	message := `{"requestId":2,"type":"request","method":"speech.chunk","payload":` + payload + `}`
	if err := client.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
		t.Fatalf("WriteMessage(): %v", err)
	}
	response := mustReadEnvelope(t, client)
	if response.Type != "error" || response.Payload["code"] != codePayloadTooLarge {
		t.Fatalf("response=%#v, want payload_too_large", response)
	}
}

func TestSpeechDisconnectCancelsActiveStreams(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	connectRegistryClient(t, client)
	_ = startFakeSpeechStream(t, client)

	_ = client.Close()
	select {
	case <-provider.stream.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("speech stream was not cancelled after client disconnect")
	}
}

func TestSpeechStartReplacesActiveStreamForSameConnection(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	firstStreamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	firstStream := provider.stream
	secondStreamID := startFakeSpeechStreamWithRequestID(t, client, 3)

	if secondStreamID == firstStreamID {
		t.Fatalf("replacement streamID=%q, want a new stream", secondStreamID)
	}
	if provider.stream == firstStream {
		t.Fatal("provider should receive a new speech stream")
	}
	select {
	case <-firstStream.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("old speech stream was not cancelled after replacement start")
	}
}

func TestSpeechFinishReleasesActiveStreamImmediately(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	firstStreamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	firstStream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": firstStreamID,
		},
	})
	finishResp := mustReadEnvelope(t, client)
	if finishResp.Type != "response" || finishResp.Method != "speech.finish" {
		t.Fatalf("speech.finish response=%#v", finishResp)
	}
	if !firstStream.finished {
		t.Fatal("provider stream should be finished")
	}

	secondStreamID := startFakeSpeechStreamWithRequestID(t, client, 4)
	if secondStreamID == firstStreamID {
		t.Fatalf("new streamID=%q, want a new stream", secondStreamID)
	}
}

func TestSpeechStartCancelsClosingStreamForConnection(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver:      testSpeechSecretResolver,
		idleTimeout:         time.Second,
		startTimeout:        time.Second,
		finishTimeout:       time.Second,
		closingRouteTimeout: time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	firstStreamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	firstStream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": firstStreamID,
		},
	})
	_ = mustReadEnvelope(t, client)

	secondStreamID := startFakeSpeechStreamWithRequestID(t, client, 4)
	if secondStreamID == firstStreamID {
		t.Fatalf("new streamID=%q, want a new stream", secondStreamID)
	}
	select {
	case <-firstStream.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("new speech.start did not cancel closing stream")
	}
}

func TestSpeechCancelCancelsClosingStream(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver:      testSpeechSecretResolver,
		idleTimeout:         time.Second,
		startTimeout:        time.Second,
		finishTimeout:       time.Second,
		closingRouteTimeout: time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	stream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 4,
		Type:      "request",
		Method:    "speech.cancel",
		Payload: map[string]any{
			"streamId": streamID,
			"reason":   "user",
		},
	})
	cancelResp := mustReadEnvelope(t, client)
	if cancelResp.Type != "response" || cancelResp.Method != "speech.cancel" {
		t.Fatalf("speech.cancel response=%#v", cancelResp)
	}
	select {
	case <-stream.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("speech.cancel did not cancel closing stream")
	}
}

func TestSpeechFinishKeepsClosingRouteForFinalTranscript(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver:      testSpeechSecretResolver,
		idleTimeout:         time.Second,
		startTimeout:        time.Second,
		finishTimeout:       time.Second,
		closingRouteTimeout: time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	stream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	finishResp := mustReadEnvelope(t, client)
	if finishResp.Type != "response" || finishResp.Method != "speech.finish" {
		t.Fatalf("speech.finish response=%#v", finishResp)
	}

	stream.events.Transcript("最终文本", true)
	finalEvent := mustReadEnvelope(t, client)
	if finalEvent.Type != "event" || finalEvent.Method != "speech.transcript" {
		t.Fatalf("final transcript event=%#v", finalEvent)
	}
	if finalEvent.Payload["streamId"] != streamID || finalEvent.Payload["text"] != "最终文本" || finalEvent.Payload["final"] != true {
		t.Fatalf("final transcript payload=%#v", finalEvent.Payload)
	}
}

func TestSpeechFinishClosingRouteForwardsInterimTranscript(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver:      testSpeechSecretResolver,
		idleTimeout:         time.Second,
		startTimeout:        time.Second,
		finishTimeout:       time.Second,
		closingRouteTimeout: time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	stream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	_ = mustReadEnvelope(t, client)

	stream.events.Transcript("中间文本", false)
	_ = client.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	var interim testEnvelope
	if err := client.ReadJSON(&interim); err != nil {
		t.Fatalf("read interim transcript after finish: %v", err)
	}
	_ = client.SetReadDeadline(time.Time{})
	if interim.Type != "event" || interim.Method != "speech.transcript" {
		t.Fatalf("interim transcript event=%#v", interim)
	}
	if interim.Payload["streamId"] != streamID || interim.Payload["text"] != "中间文本" || interim.Payload["final"] != false {
		t.Fatalf("interim transcript payload=%#v", interim.Payload)
	}
}

func TestSpeechFinishClosingRouteExpires(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver:      testSpeechSecretResolver,
		idleTimeout:         time.Second,
		startTimeout:        time.Second,
		finishTimeout:       time.Second,
		closingRouteTimeout: 20 * time.Millisecond,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	stream := provider.stream
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	_ = mustReadEnvelope(t, client)

	time.Sleep(60 * time.Millisecond)
	stream.events.Transcript("迟到文本", true)
	_ = client.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	var late testEnvelope
	if err := client.ReadJSON(&late); err == nil {
		t.Fatalf("late final transcript should be ignored: %#v", late)
	}
	_ = client.SetReadDeadline(time.Time{})
}

func TestSpeechProviderErrorReleasesActiveStream(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechService(provider, testSpeechSecretResolver)
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	provider.stream.events.Error(codeUnavailable, "speech provider disconnected", true)
	errEvent := mustReadEnvelope(t, client)
	if errEvent.Type != "event" || errEvent.Method != "speech.error" {
		t.Fatalf("speech.error event=%#v", errEvent)
	}
	if errEvent.Payload["streamId"] != streamID || errEvent.Payload["retryable"] != true {
		t.Fatalf("speech.error payload=%#v", errEvent.Payload)
	}

	nextStreamID := startFakeSpeechStreamWithRequestID(t, client, 3)
	if nextStreamID == streamID {
		t.Fatalf("new streamID=%q, want a new stream", nextStreamID)
	}
}

func TestSpeechIdleTimeoutCancelsStreamAndEmitsError(t *testing.T) {
	provider := newFakeSpeechProvider()
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver: testSpeechSecretResolver,
		idleTimeout:    20 * time.Millisecond,
		startTimeout:   time.Second,
		finishTimeout:  time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	errEvent := mustReadEnvelope(t, client)
	if errEvent.Type != "event" || errEvent.Method != "speech.error" {
		t.Fatalf("idle timeout event=%#v", errEvent)
	}
	if errEvent.Payload["streamId"] != streamID ||
		errEvent.Payload["code"] != codeUnavailable ||
		errEvent.Payload["message"] != "speech stream idle timeout" ||
		errEvent.Payload["retryable"] != true {
		t.Fatalf("idle timeout payload=%#v", errEvent.Payload)
	}
	select {
	case <-provider.stream.cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("idle timeout did not cancel provider stream")
	}
	_ = client.SetReadDeadline(time.Time{})

	nextStreamID := startFakeSpeechStreamWithRequestID(t, client, 3)
	if nextStreamID == streamID {
		t.Fatalf("new streamID=%q, want a new stream", nextStreamID)
	}
}

func TestSpeechProviderStartTimeoutReleasesActiveStream(t *testing.T) {
	provider := &timeoutFirstSpeechProvider{}
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver: testSpeechSecretResolver,
		idleTimeout:    time.Second,
		startTimeout:   20 * time.Millisecond,
		finishTimeout:  time.Second,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	writeSpeechStartRequest(t, client, 2)
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "speech.start" {
		t.Fatalf("speech.start timeout response=%#v", resp)
	}
	if resp.Payload["code"] != codeUnavailable {
		t.Fatalf("timeout code=%#v, want %s", resp.Payload["code"], codeUnavailable)
	}

	nextStreamID := startFakeSpeechStreamWithRequestID(t, client, 3)
	if nextStreamID == "" {
		t.Fatal("expected a new stream after start timeout")
	}
}

func TestSpeechProviderFinishTimeoutDoesNotRestoreActiveStream(t *testing.T) {
	provider := &blockingFinishSpeechProvider{}
	s := New(Config{})
	s.speech = newSpeechServiceWithOptions(provider, speechServiceOptions{
		secretResolver: testSpeechSecretResolver,
		idleTimeout:    time.Second,
		startTimeout:   time.Second,
		finishTimeout:  20 * time.Millisecond,
	})
	ts := httptestNewRegistryServer(t, s.Handler())

	client := dialWS(t, "http://"+ts+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)

	streamID := startFakeSpeechStreamWithRequestID(t, client, 2)
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 3,
		Type:      "request",
		Method:    "speech.finish",
		Payload: map[string]any{
			"streamId": streamID,
		},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "speech.finish" {
		t.Fatalf("speech.finish timeout response=%#v", resp)
	}
	if resp.Payload["code"] != codeUnavailable {
		t.Fatalf("timeout code=%#v, want %s", resp.Payload["code"], codeUnavailable)
	}

	nextStreamID := startFakeSpeechStreamWithRequestID(t, client, 4)
	if nextStreamID == streamID {
		t.Fatalf("new streamID=%q, want a new stream", nextStreamID)
	}
}

func startFakeSpeechStream(t *testing.T, client *websocket.Conn) string {
	t.Helper()
	return startFakeSpeechStreamWithRequestID(t, client, 2)
}

func startFakeSpeechStreamWithRequestID(t *testing.T, client *websocket.Conn, requestID int64) string {
	t.Helper()
	writeSpeechStartRequest(t, client, requestID)
	resp := mustReadEnvelope(t, client)
	streamID, _ := resp.Payload["streamId"].(string)
	if streamID == "" {
		t.Fatalf("missing streamId in response: %#v", resp)
	}
	return streamID
}

func writeSpeechStartRequest(t *testing.T, client *websocket.Conn, requestID int64) {
	t.Helper()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: requestID,
		Type:      "request",
		Method:    "speech.start",
		Payload: map[string]any{
			"provider": "volcengine",
			"audio": map[string]any{
				"format":  "pcm",
				"codec":   "raw",
				"rate":    16000,
				"bits":    16,
				"channel": 1,
			},
		},
	})
}

type fakeSpeechProvider struct {
	start  fakeSpeechStart
	stream *fakeSpeechStream
}

type fakeSpeechStart struct {
	credential string
	Audio      speechprovider.AudioConfig
}

func newFakeSpeechProvider() *fakeSpeechProvider {
	return &fakeSpeechProvider{}
}

func (p *fakeSpeechProvider) Start(_ context.Context, credential string, audio speechprovider.AudioConfig, events speechprovider.Events) (speechprovider.Stream, error) {
	p.start = fakeSpeechStart{credential: credential, Audio: audio}
	p.stream = &fakeSpeechStream{
		events:    events,
		cancelled: make(chan struct{}),
	}
	return p.stream, nil
}

type fakeSpeechStream struct {
	events    speechprovider.Events
	writes    [][]byte
	finished  bool
	cancelled chan struct{}
}

func (s *fakeSpeechStream) WriteAudio(_ context.Context, pcm []byte) error {
	s.writes = append(s.writes, append([]byte(nil), pcm...))
	return nil
}

func (s *fakeSpeechStream) Finish(_ context.Context) error {
	s.finished = true
	return nil
}

func (s *fakeSpeechStream) Cancel() {
	select {
	case <-s.cancelled:
	default:
		close(s.cancelled)
	}
}

type timeoutFirstSpeechProvider struct {
	calls  int
	stream *fakeSpeechStream
}

func (p *timeoutFirstSpeechProvider) Start(ctx context.Context, _ string, _ speechprovider.AudioConfig, events speechprovider.Events) (speechprovider.Stream, error) {
	p.calls++
	if p.calls == 1 {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	p.stream = &fakeSpeechStream{
		events:    events,
		cancelled: make(chan struct{}),
	}
	return p.stream, nil
}

type blockingFinishSpeechProvider struct {
	stream *blockingFinishSpeechStream
}

func (p *blockingFinishSpeechProvider) Start(_ context.Context, _ string, _ speechprovider.AudioConfig, _ speechprovider.Events) (speechprovider.Stream, error) {
	p.stream = &blockingFinishSpeechStream{
		cancelled: make(chan struct{}),
	}
	return p.stream, nil
}

type blockingFinishSpeechStream struct {
	writes    [][]byte
	cancelled chan struct{}
}

func (s *blockingFinishSpeechStream) WriteAudio(_ context.Context, pcm []byte) error {
	s.writes = append(s.writes, append([]byte(nil), pcm...))
	return nil
}

func (s *blockingFinishSpeechStream) Finish(ctx context.Context) error {
	<-ctx.Done()
	return ctx.Err()
}

func (s *blockingFinishSpeechStream) Cancel() {
	select {
	case <-s.cancelled:
	default:
		close(s.cancelled)
	}
}

const codexRadarEfficiencyCacheFixture = `{
	"schema": 2,
	"mode": "weighted_latest_3",
	"source_updated_at": "2026-08-13T04:00:24Z",
	"points": [
		{"model":"gpt-5.6-sol","effort":"low","iq":120,"average_price_usd":1,"average_minutes":2},
		{"model":"deepseek-v4-pro","effort":"max","iq":82.98,"average_price_usd":0.242751,"average_minutes":38.94},
		{"model":"deepseek-v4-flash","effort":"low","iq":null,"average_price_usd":null,"average_minutes":null}
	]
}`

func TestCodexRadarEfficiencyGetUsesOfficialPoints(t *testing.T) {
	server := New(Config{})
	server.codexRadarEfficiencyLoader = func(context.Context) (json.RawMessage, error) {
		return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
	}
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodCodexRadarEfficiencyGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("response=%+v", response)
	}
	var payload struct {
		SourceUpdatedAt string `json:"source_updated_at"`
		Points          []struct {
			Model           string  `json:"model"`
			Effort          string  `json:"effort"`
			IQ              float64 `json:"iq"`
			AveragePriceUSD float64 `json:"average_price_usd"`
			AverageMinutes  float64 `json:"average_minutes"`
		} `json:"points"`
	}
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.SourceUpdatedAt != "2026-08-13T04:00:24Z" {
		t.Fatalf("source_updated_at=%q", payload.SourceUpdatedAt)
	}
	if len(payload.Points) != 2 {
		t.Fatalf("points=%+v", payload.Points)
	}
	if payload.Points[0].Model != "gpt-5.6-sol" || payload.Points[0].Effort != "low" || payload.Points[0].IQ != 120 || payload.Points[0].AveragePriceUSD != 1 || payload.Points[0].AverageMinutes != 2 {
		t.Fatalf("gpt point=%+v", payload.Points[0])
	}
	if payload.Points[1].Model != "deepseek-v4-pro" || payload.Points[1].Effort != "max" || payload.Points[1].IQ != 82.98 || payload.Points[1].AveragePriceUSD != 0.242751 || payload.Points[1].AverageMinutes != 38.94 {
		t.Fatalf("deepseek point=%+v", payload.Points[1])
	}
}

func TestNewCodexRadarEfficiencyFetcherUsesOfficialEndpoint(t *testing.T) {
	fetcher := newCodexRadarEfficiencyFetcher()
	if fetcher.endpoint != "https://api.codexradar.com/api/v1/intelligence-efficiency?benchmark=deep-swe" {
		t.Fatalf("endpoint=%q", fetcher.endpoint)
	}
}

func TestCodexRadarEfficiencyFetcherLoadsLiveEndpoint(t *testing.T) {
	const body = `{"combos":[],"tasks":[],"cells":{}}`
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Errorf("method=%q, want GET", request.Method)
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept=%q", request.Header.Get("Accept"))
		}
		if request.Header.Get("Cache-Control") != "no-cache" {
			t.Errorf("Cache-Control=%q", request.Header.Get("Cache-Control"))
		}
		_, _ = w.Write([]byte(body))
	}))
	defer httpServer.Close()

	fetcher := &codexRadarEfficiencyFetcher{client: httpServer.Client(), endpoint: httpServer.URL}
	raw, err := fetcher.load(context.Background())
	if err != nil {
		t.Fatalf("load() error = %v", err)
	}
	if string(raw) != body {
		t.Fatalf("raw body = %q, want %q", raw, body)
	}
}

func TestCodexRadarEfficiencyCacheLimitsUpstreamRequestsAndServesStaleData(t *testing.T) {
	cache := codexRadarEfficiencyCache{}
	var calls int
	loader := func(context.Context) (json.RawMessage, error) {
		calls++
		if calls == 1 {
			return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
		}
		return nil, errors.New("upstream unavailable")
	}

	first, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("first get() error = %v", err)
	}
	second, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("second get() error = %v", err)
	}
	if calls != 1 || first.SourceUpdatedAt != second.SourceUpdatedAt {
		t.Fatalf("cache calls=%d first=%+v second=%+v", calls, first, second)
	}

	cache.cachedAt = time.Now().Add(-codexRadarEfficiencyCacheTTL - time.Second)
	cache.lastAttemptAt = cache.cachedAt
	stale, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("stale get() error = %v", err)
	}
	if calls != 2 || stale.SourceUpdatedAt != first.SourceUpdatedAt {
		t.Fatalf("stale fallback calls=%d stale=%+v", calls, stale)
	}
	if _, err := cache.get(context.Background(), loader); err != nil {
		t.Fatalf("cached failure get() error = %v", err)
	}
	if calls != 2 {
		t.Fatalf("cached failure retried upstream: calls=%d", calls)
	}
}

func TestCodexRadarEfficiencyCacheCoalescesConcurrentFetches(t *testing.T) {
	cache := codexRadarEfficiencyCache{}
	started := make(chan struct{})
	release := make(chan struct{})
	var calls int
	loader := func(context.Context) (json.RawMessage, error) {
		calls++
		close(started)
		<-release
		return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
	}

	results := make(chan error, 2)
	go func() {
		_, err := cache.get(context.Background(), loader)
		results <- err
	}()
	<-started
	go func() {
		_, err := cache.get(context.Background(), loader)
		results <- err
	}()
	close(release)

	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("concurrent get() error = %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("concurrent upstream calls=%d, want 1", calls)
	}
}

type fakeServerDataStore struct {
	mu            sync.Mutex
	snapshot      serverdata.Snapshot
	snapshotErr   error
	secrets       map[serverdata.SecretKind]string
	versions      map[serverdata.SecretKind]string
	secretReads   []serverdata.SecretKind
	secretUpdates []serverDataSecretUpdate
}

type serverDataSecretUpdate struct {
	kind   serverdata.SecretKind
	action string
	value  string
}

func (f *fakeServerDataStore) Snapshot() (serverdata.Snapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot, f.snapshotErr
}

func (f *fakeServerDataStore) UpdateSecret(kind serverdata.SecretKind, action, value string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secretUpdates = append(f.secretUpdates, serverDataSecretUpdate{kind: kind, action: action, value: value})
	return nil
}

func (f *fakeServerDataStore) UpdateVoiceInputModel(model string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapshot.VoiceInput.Model = model
	return nil
}

func (f *fakeServerDataStore) UpdateTTS(model, voice string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapshot.TextToSpeech.Model = model
	f.snapshot.TextToSpeech.Voice = voice
	return nil
}

func (f *fakeServerDataStore) Secret(kind serverdata.SecretKind) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secretReads = append(f.secretReads, kind)
	return f.secrets[kind], f.versions[kind], nil
}

type serverDataCaptureWriter struct {
	writes chan envelope
}

func (w *serverDataCaptureWriter) WriteJSON(value any) error {
	env, ok := value.(envelope)
	if !ok {
		return errors.New("unexpected write type")
	}
	w.writes <- env
	return nil
}

func (w *serverDataCaptureWriter) Close() error { return nil }

func invokeServerDataHandler(t *testing.T, server *Server, state *connectionState, request envelope) envelope {
	t.Helper()
	writer := &serverDataCaptureWriter{writes: make(chan envelope, 1)}
	peer := newPeerConn(writer, "server-data-test")
	defer peer.close()
	state.peer = peer
	server.handleServerDataRequest(peer, state, request)
	select {
	case response := <-writer.writes:
		return response
	case <-time.After(time.Second):
		t.Fatal("server data handler did not respond")
		return envelope{}
	}
}

func responseErrorCode(t *testing.T, response envelope) string {
	t.Helper()
	var payload rp.ErrorPayload
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return payload.Code
}

func TestServerConfigGetNeverReturnsSecretValues(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{
			VoiceInput:   serverdata.VoiceInputSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.VoiceInputModelDoubaoStreamingASR2},
			TextToSpeech: serverdata.TTSSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.TTSModelMiMoV25, Voice: serverdata.TTSVoiceMia},
			DeepSeek:     serverdata.FeatureSnapshot{Configured: true},
		},
		secrets: map[serverdata.SecretKind]string{
			serverdata.SecretVolcengineASR: "speech-key",
			serverdata.SecretMiMoTTS:       "tts-key",
			serverdata.SecretDeepSeek:      "deep-key",
		},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerConfigGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("response=%+v", response)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"speech-key", "tts-key", "deep-key", `"apiKey"`, `"accessToken"`} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("server config leaked %q: %s", forbidden, encoded)
		}
	}
	if len(store.secretReads) != 0 {
		t.Fatalf("server config read raw secrets: %v", store.secretReads)
	}
}

func TestServerConfigUpdateValidatesSectionFieldAndAction(t *testing.T) {
	store := &fakeServerDataStore{snapshot: serverdata.Snapshot{
		VoiceInput:   serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2},
		TextToSpeech: serverdata.TTSSnapshot{Model: serverdata.TTSModelMiMoV25, Voice: serverdata.TTSVoiceMia},
	}}
	server := New(Config{ServerData: store})
	state := &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}
	tests := []rp.ServerConfigUpdatePayload{
		{Section: "unknown", Field: "key", Action: "set", Value: "key"},
		{Section: "voiceInput", Field: "voice", Action: "set", Value: "Mia"},
		{Section: "deepSeek", Field: "key", Action: "clear", Value: "must-reject"},
		{Section: "textToSpeech", Field: "model", Action: "clear"},
		{Section: "deepSeek", Field: "key", Action: "replace", Value: "key"},
	}
	for index, payload := range tests {
		response := invokeServerDataHandler(t, server, state, envelope{RequestID: int64(index + 1), Method: rp.RegistryMethodServerConfigUpdate, Payload: rp.MustRaw(payload)})
		if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != codeInvalidArgument {
			t.Fatalf("case %d response=%+v", index, response)
		}
	}

	valid := rp.ServerConfigUpdatePayload{Section: "deepSeek", Field: "key", Action: "set", Value: "short"}
	response := invokeServerDataHandler(t, server, state, envelope{RequestID: 20, Method: rp.RegistryMethodServerConfigUpdate, Payload: rp.MustRaw(valid)})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("valid response=%+v", response)
	}
	if len(store.secretUpdates) != 1 || store.secretUpdates[0] != (serverDataSecretUpdate{kind: serverdata.SecretDeepSeek, action: "set", value: "short"}) {
		t.Fatalf("updates=%+v", store.secretUpdates)
	}
}

func TestAndroidSpeechCredentialRequiresAndroidClientName(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets:  map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "speech-key"},
		versions: map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "v1"},
	}
	server := New(Config{ServerData: store})
	states := []*connectionState{
		{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"},
		{browserSession: false, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"},
		{browserSession: true, role: string(rp.RegistryRoleHub), clientName: "wheelmaker-android"},
	}
	for index, state := range states {
		response := invokeServerDataHandler(t, server, state, envelope{RequestID: int64(index + 1), Method: rp.RegistryMethodServerAndroidSpeechCredentialGet, Payload: rp.MustRaw(map[string]any{})})
		if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != codeForbidden {
			t.Fatalf("case %d response=%+v", index, response)
		}
	}
	if len(store.secretReads) != 0 {
		t.Fatalf("rejected requests read secrets: %v", store.secretReads)
	}
}

func TestAndroidSpeechCredentialReturnsOnlyVolcengineValue(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets: map[serverdata.SecretKind]string{
			serverdata.SecretVolcengineASR: "speech-key",
			serverdata.SecretMiMoTTS:       "tts-key",
			serverdata.SecretDeepSeek:      "deep-key",
		},
		versions: map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "v1"},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerAndroidSpeechCredentialGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if response.Type != rp.RegistryEnvelopeTypeResponse || !strings.Contains(string(encoded), "speech-key") || !strings.Contains(string(encoded), "v1") {
		t.Fatalf("response=%s", encoded)
	}
	for _, forbidden := range []string{"tts-key", "deep-key"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("credential leaked %q: %s", forbidden, encoded)
		}
	}
	if len(store.secretReads) != 1 || store.secretReads[0] != serverdata.SecretVolcengineASR {
		t.Fatalf("secret reads=%v", store.secretReads)
	}
}

func TestAndroidSpeechCredentialReturnsNotConfiguredWithoutKey(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets:  map[serverdata.SecretKind]string{},
		versions: map[serverdata.SecretKind]string{},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerAndroidSpeechCredentialGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != "not_configured" {
		t.Fatalf("response=%+v", response)
	}
}

func TestConnectInitPersistsClientNameForServerDataGate(t *testing.T) {
	server := New(Config{ServerData: &fakeServerDataStore{}})
	tests := []struct {
		name       string
		clientName string
		wantType   string
		wantStored string
	}{
		{name: "android", clientName: "  wheelmaker-android  ", wantType: rp.RegistryEnvelopeTypeResponse, wantStored: "wheelmaker-android"},
		{name: "empty", clientName: "   ", wantType: rp.RegistryEnvelopeTypeError},
		{name: "too long", clientName: strings.Repeat("a", 81), wantType: rp.RegistryEnvelopeTypeError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			writer := &serverDataCaptureWriter{writes: make(chan envelope, 1)}
			peer := newPeerConn(writer, "connect-client-name")
			defer peer.close()
			state := &connectionState{browserSession: true, peer: peer}
			server.handleConnectInit(peer, state, envelope{RequestID: 1, Method: rp.RegistryMethodConnectInit, Payload: rp.MustRaw(rp.ConnectInitPayload{
				ClientName: tt.clientName, ProtocolVersion: rp.DefaultProtocolVersion, Role: string(rp.RegistryRoleClient),
			})})
			response := <-writer.writes
			if response.Type != tt.wantType || state.clientName != tt.wantStored {
				t.Fatalf("response=%+v state.clientName=%q", response, state.clientName)
			}
		})
	}
}

func TestFileDownloadCapabilityIsHighEntropySessionBoundAndSingleUse(t *testing.T) {
	now := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{
		Now:      func() time.Time { return now },
		TTL:      time.Minute,
		Capacity: 4,
	})
	task := fileDownloadTask{
		DeviceID:  "device-1",
		BasePath:  "/workspace/",
		ProjectID: "hub:project",
		Source:    fileDownloadSource{Kind: fileDownloadSourceProject, Path: "docs/report.txt"},
		FileName:  "report.txt",
		MimeType:  "text/plain",
		Size:      42,
		Identity:  "identity-1",
	}
	token, err := store.issue(task)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 {
		t.Fatalf("token entropy bytes=%d err=%v", len(decoded), err)
	}
	second, err := store.issue(task)
	if err != nil || second == token {
		t.Fatalf("second token=%q err=%v", second, err)
	}

	if _, err := store.claim(token, "wrong-device", "/workspace/"); err != errFileDownloadSessionMismatch {
		t.Fatalf("session mismatch err=%v", err)
	}
	claimed, err := store.claim(token, "device-1", "/workspace/")
	if err != nil || claimed.Source.Path != "docs/report.txt" || claimed.Identity != "identity-1" {
		t.Fatalf("claimed=%+v err=%v", claimed, err)
	}
	if _, err := store.claim(token, "device-1", "/workspace/"); err != errFileDownloadCapabilityMissing {
		t.Fatalf("second claim err=%v", err)
	}
}

func TestFileDownloadCapabilityExpiresAndEnforcesCapacity(t *testing.T) {
	now := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{
		Now:      func() time.Time { return now },
		TTL:      time.Second,
		Capacity: 1,
	})
	task := fileDownloadTask{DeviceID: "device", BasePath: "/", ProjectID: "hub:project"}
	token, err := store.issue(task)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.issue(task); err != errFileDownloadCapabilityBusy {
		t.Fatalf("capacity err=%v", err)
	}
	now = now.Add(2 * time.Second)
	if _, err := store.claim(token, "device", "/"); err != errFileDownloadCapabilityExpired {
		t.Fatalf("expiry err=%v", err)
	}
	if _, err := store.issue(task); err != nil {
		t.Fatalf("expired task should free capacity: %v", err)
	}
}

func TestFileDownloadCapabilityClaimIsAtomic(t *testing.T) {
	store := newFileDownloadCapabilityStore(fileDownloadCapabilityStoreOptions{Capacity: 2})
	token, err := store.issue(fileDownloadTask{DeviceID: "device", BasePath: "/"})
	if err != nil {
		t.Fatal(err)
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := store.claim(token, "device", "/"); err == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("successful claims=%d, want 1", successes.Load())
	}
}

func TestFileDownloadPrepareValidatesBrowserSessionAndProbesHub(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)

	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })

	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 20,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadPrepare,
		ProjectID: "hub-download:proj1",
		Payload: map[string]any{
			"csrfToken": csrf,
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "report.txt"},
		},
	})
	if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	open := mustReadEnvelope(t, hub)
	if open.Method != rp.RegistryMethodFileDownloadOpen || open.ProjectID != "hub-download:proj1" {
		t.Fatalf("open=%+v", open)
	}
	if source, _ := open.Payload["source"].(map[string]any); source["kind"] != fileDownloadSourceProject || source["path"] != "report.txt" {
		t.Fatalf("source=%+v", source)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    open.Method,
		ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "probe-transfer", "fileName": "report.txt",
			"mimeType": "text/plain", "size": 12, "identity": "identity-1",
		},
	})
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "probe-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    closeRequest.Method,
		ProjectID: closeRequest.ProjectID,
		Payload:   map[string]any{"ok": true},
	})

	prepared := mustReadEnvelope(t, browser)
	if prepared.Type != rp.RegistryEnvelopeTypeResponse || prepared.Method != rp.RegistryMethodFileDownloadPrepare {
		t.Fatalf("prepared=%+v", prepared)
	}
	if prepared.Payload["downloadPath"] == "" || prepared.Payload["fileName"] != "report.txt" || prepared.Payload["size"] != float64(12) {
		t.Fatalf("prepared payload=%+v", prepared.Payload)
	}
	if path := prepared.Payload["downloadPath"].(string); !strings.HasPrefix(path, "/ws/download/") || len(path) <= len("/ws/download/") {
		t.Fatalf("downloadPath=%q", path)
	}

	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 21,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodFileDownloadPrepare,
		ProjectID: "hub-download:proj1",
		Payload: map[string]any{
			"csrfToken": "wrong",
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "report.txt"},
		},
	})
	rejected := mustReadEnvelope(t, browser)
	if rejected.Type != rp.RegistryEnvelopeTypeError || rejected.Payload["code"] != codeForbidden {
		t.Fatalf("wrong CSRF response=%+v", rejected)
	}
}

func TestFileDownloadHTTPStreamsHubChunksOnce(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download-http", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })
	downloadPath := prepareFileDownloadCapabilityForTest(t, browser, hub, csrf, "hub-download-http:proj1")

	type httpResult struct {
		response *http.Response
		err      error
	}
	resultChannel := make(chan httpResult, 1)
	go func() {
		request, err := http.NewRequest(http.MethodGet, testServer.URL+downloadPath, nil)
		if err == nil {
			request.AddCookie(cookie)
		}
		response, requestErr := http.DefaultClient.Do(request)
		resultChannel <- httpResult{response: response, err: firstError(err, requestErr)}
	}()

	if err := hub.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	open := mustReadEnvelope(t, hub)
	if open.Method != rp.RegistryMethodFileDownloadOpen {
		t.Fatalf("open=%+v", open)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "stream-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})

	for index, chunk := range []string{"abc", "def"} {
		read := mustReadEnvelope(t, hub)
		if read.Method != rp.RegistryMethodFileDownloadRead || read.Payload["offset"] != float64(index*3) {
			t.Fatalf("read %d=%+v", index, read)
		}
		mustWriteJSON(t, hub, testEnvelope{
			RequestID: read.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
			Method: read.Method, ProjectID: read.ProjectID,
			Payload: map[string]any{
				"ok": true, "data": base64.StdEncoding.EncodeToString([]byte(chunk)),
				"nextOffset": (index + 1) * 3, "eof": index == 1,
			},
		})
	}
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "stream-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})

	got := <-resultChannel
	if got.err != nil {
		t.Fatal(got.err)
	}
	body, err := io.ReadAll(got.response.Body)
	got.response.Body.Close()
	if err != nil || string(body) != "abcdef" || got.response.StatusCode != http.StatusOK {
		t.Fatalf("status=%d body=%q err=%v", got.response.StatusCode, body, err)
	}
	for header, want := range map[string]string{
		"Content-Length":         "6",
		"Cache-Control":          "no-store",
		"Accept-Ranges":          "none",
		"X-Content-Type-Options": "nosniff",
		"Content-Type":           "text/plain",
	} {
		if value := got.response.Header.Get(header); value != want {
			t.Fatalf("%s=%q, want %q", header, value, want)
		}
	}
	disposition := got.response.Header.Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment;") || !strings.Contains(disposition, "filename*=UTF-8''r%C3%A9sum%C3%A9%202026.txt") || strings.ContainsAny(disposition, "\r\n") {
		t.Fatalf("Content-Disposition=%q", disposition)
	}

	repeat, err := http.NewRequest(http.MethodGet, testServer.URL+downloadPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	repeat.AddCookie(cookie)
	repeatResponse, err := http.DefaultClient.Do(repeat)
	if err != nil {
		t.Fatal(err)
	}
	defer repeatResponse.Body.Close()
	if repeatResponse.StatusCode != http.StatusGone {
		t.Fatalf("repeat status=%d, want 410", repeatResponse.StatusCode)
	}
}

func TestFileDownloadHTTPRejectsRange(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	cookie, _ := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	session, ok := server.webSessions.AuthenticateForBasePath(cookie.Value, "/")
	if !ok {
		t.Fatal("session not found")
	}
	token, err := server.fileDownloads.issue(fileDownloadTask{
		DeviceID: session.DeviceID, BasePath: "/", ProjectID: "hub:project",
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodGet, testServer.URL+"/ws/download/"+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	request.Header.Set("Range", "bytes=0-3")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestedRangeNotSatisfiable || response.Header.Get("Accept-Ranges") != "none" {
		t.Fatalf("status=%d Accept-Ranges=%q", response.StatusCode, response.Header.Get("Accept-Ranges"))
	}
}

func TestFileDownloadHTTPCancellationClosesHubTransfer(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	testServer := httptest.NewServer(server.Handler())
	t.Cleanup(testServer.Close)
	hub := dialWS(t, testServer.URL+"/ws")
	t.Cleanup(func() { _ = hub.Close() })
	mustReportHTMLPreviewHub(t, hub, "hub-download-cancel", "custom-token", []map[string]any{
		{"name": "proj1", "path": `C:\src\proj1`, "online": true},
	})
	cookie, csrf := loginHTMLPreviewBrowser(t, testServer.URL, "/")
	browser := connectRegistryBrowser(t, testServer.URL, cookie)
	t.Cleanup(func() { _ = browser.Close() })
	downloadPath := prepareFileDownloadCapabilityForTest(t, browser, hub, csrf, "hub-download-cancel:proj1")

	requestContext, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, testServer.URL+downloadPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	resultChannel := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		resultChannel <- requestErr
	}()

	open := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "cancel-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})
	read := mustReadEnvelope(t, hub)
	if read.Method != rp.RegistryMethodFileDownloadRead {
		t.Fatalf("read=%+v", read)
	}
	cancel()
	closeRequest := mustReadEnvelope(t, hub)
	if closeRequest.Method != rp.RegistryMethodFileDownloadClose || closeRequest.Payload["transferId"] != "cancel-transfer" {
		t.Fatalf("close=%+v", closeRequest)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})
	select {
	case <-resultChannel:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled HTTP request did not return")
	}
}

func TestRegistryFileDownloadRouteIsExact(t *testing.T) {
	token := strings.Repeat("A", 43)
	basePath, gotToken, ok := registryFileDownloadRoute("/wheelmaker/ws/download/" + token)
	if !ok || basePath != "/wheelmaker/" || gotToken != token {
		t.Fatalf("route=(%q, %q, %v)", basePath, gotToken, ok)
	}
	rootBasePath, rootToken, rootOK := registryFileDownloadRoute("/ws/download/" + token)
	if !rootOK || rootBasePath != "/" || rootToken != token {
		t.Fatalf("root route=(%q, %q, %v)", rootBasePath, rootToken, rootOK)
	}
	for _, requestPath := range []string{
		"/download/" + token,
		"/ws/download/short",
		"/wheelmaker/ws/download/" + token + "/extra",
		"/wheelmaker//ws/download/" + token,
		"/wheelmaker/../ws/download/" + token,
		"/wheelmaker\\ws\\download\\" + token,
	} {
		if _, _, accepted := registryFileDownloadRoute(requestPath); accepted {
			t.Fatalf("accepted malformed route %q", requestPath)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.com/ws/download/%41"+strings.Repeat("A", 42), nil)
	if request.URL.RawPath == "" {
		t.Fatal("encoded test URL did not retain RawPath")
	}
	recorder := httptest.NewRecorder()
	New(Config{}).handleHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("encoded capability status=%d, want 404", recorder.Code)
	}
}

func prepareFileDownloadCapabilityForTest(t *testing.T, browser, hub *websocket.Conn, csrf, projectID string) string {
	t.Helper()
	mustWriteJSON(t, browser, testEnvelope{
		RequestID: 30, Type: rp.RegistryEnvelopeTypeRequest,
		Method: rp.RegistryMethodFileDownloadPrepare, ProjectID: projectID,
		Payload: map[string]any{
			"csrfToken": csrf,
			"source":    map[string]any{"kind": fileDownloadSourceProject, "path": "résumé 2026.txt"},
		},
	})
	open := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: open.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: open.Method, ProjectID: open.ProjectID,
		Payload: map[string]any{
			"ok": true, "transferId": "probe-transfer", "fileName": "résumé 2026.txt",
			"mimeType": "text/plain", "size": 6, "identity": "identity-1",
		},
	})
	closeRequest := mustReadEnvelope(t, hub)
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: closeRequest.RequestID, Type: rp.RegistryEnvelopeTypeResponse,
		Method: closeRequest.Method, ProjectID: closeRequest.ProjectID,
		Payload: map[string]any{"ok": true},
	})
	prepared := mustReadEnvelope(t, browser)
	path, _ := prepared.Payload["downloadPath"].(string)
	if path == "" {
		t.Fatalf("prepared=%+v", prepared)
	}
	return path
}

func firstError(errorsToCheck ...error) error {
	for _, err := range errorsToCheck {
		if err != nil {
			return err
		}
	}
	return nil
}

func TestShareStoreCreatePublishesMetadataAndContent(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{
		stateDir: root,
		now:      func() time.Time { return now },
		random:   bytes.NewReader(bytes.Repeat([]byte{0x42}, shareTokenBytes)),
	})

	result, err := store.create(shareCreateInput{
		ProjectID: "hub:project",
		Path:      "docs/readme.md",
		Kind:      "markdown",
		Title:     "Readme",
		Expiry:    "1d",
		Encoding:  "gzip+base64",
		Content:   gzipBase64ForTest(t, "<html><body>hello</body></html>"),
	})
	if err != nil {
		t.Fatalf("create() error = %v", err)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(result.Record.Token) {
		t.Fatalf("token = %q, want 43-char base64url", result.Record.Token)
	}
	if result.Record.ExpiresAt == nil || !result.Record.ExpiresAt.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("expiresAt = %v, want %v", result.Record.ExpiresAt, now.Add(24*time.Hour))
	}
	publicPath := filepath.Join(root, "shares", "public", "s", result.Record.Token)
	content, err := os.ReadFile(publicPath)
	if err != nil {
		t.Fatalf("read public content: %v", err)
	}
	if string(content) != "<html><body>hello</body></html>" {
		t.Fatalf("public content = %q", content)
	}
	metadataPath := filepath.Join(root, "shares", "records", result.Record.Token+".json")
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var record shareRecord
	if err := json.Unmarshal(metadata, &record); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if record.Schema != shareRecordSchemaVersion || record.Token != result.Record.Token || record.SizeBytes != int64(len(content)) {
		t.Fatalf("metadata = %+v", record)
	}
}

func TestShareStoreSchema2Sources(t *testing.T) {
	now := time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC)
	tests := []struct {
		name       string
		input      shareCreateInput
		sourceType string
		sessionID  string
		turnIndex  int
	}{
		{
			name: "chat response",
			input: shareCreateInput{
				SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 9,
				Title: "Answer", Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>answer</p>"),
			},
			sourceType: "chat_response",
			sessionID:  "sess-1",
			turnIndex:  9,
		},
		{
			name: "chat session",
			input: shareCreateInput{
				SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-2",
				Title: "Session", Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>session</p>"),
			},
			sourceType: "chat_session",
			sessionID:  "sess-2",
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := newShareStore(shareStoreConfig{
				stateDir: t.TempDir(),
				now:      func() time.Time { return now },
				random:   bytes.NewReader(bytes.Repeat([]byte{byte(0x31 + index)}, shareTokenBytes)),
			})
			result, err := store.create(test.input)
			if err != nil {
				t.Fatalf("create() error = %v", err)
			}
			if result.Record.Schema != 2 || result.Record.SourceType != test.sourceType || result.Record.SessionID != test.sessionID || result.Record.TurnIndex != test.turnIndex {
				t.Fatalf("created record = %+v", result.Record)
			}
			if result.Record.Path != "" || result.Record.Kind != "" {
				t.Fatalf("chat record has project-document fields: %+v", result.Record)
			}
			page, err := store.list("", 10)
			if err != nil {
				t.Fatalf("list() error = %v", err)
			}
			if len(page.Items) != 1 || page.Items[0].SourceType != test.sourceType || page.Items[0].SessionID != test.sessionID || page.Items[0].TurnIndex != test.turnIndex {
				t.Fatalf("listed records = %+v", page.Items)
			}
		})
	}
}

func TestShareStoreRejectsInvalidSourceCombinations(t *testing.T) {
	validContent := gzipBase64ForTest(t, "<p>share</p>")
	tests := []struct {
		name  string
		input shareCreateInput
	}{
		{
			name:  "response missing session",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", TurnIndex: 1, Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "response non-positive turn",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "response with path",
			input: shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 1, Path: "chat.md", Title: "Answer", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "session with kind",
			input: shareCreateInput{SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-1", Kind: "html", Title: "Session", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "session with turn",
			input: shareCreateInput{SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 2, Title: "Session", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "project missing path",
			input: shareCreateInput{SourceType: "project_document", ProjectID: "hub:p", Kind: "markdown", Title: "Doc", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
		{
			name:  "legacy project with session",
			input: shareCreateInput{ProjectID: "hub:p", Path: "docs/a.md", Kind: "markdown", SessionID: "sess-1", Title: "Doc", Expiry: "1d", Encoding: "gzip+base64", Content: validContent},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
			if _, err := store.create(test.input); err == nil {
				t.Fatalf("create(%+v) succeeded, want invalid source error", test.input)
			}
		})
	}
}

func TestShareStorePreservesSchema1ProjectRecord(t *testing.T) {
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir(), now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("l", shareTokenLength)
	metadataPath := filepath.Join(store.recordsDir, token+".json")
	writeTestShareRecord(t, metadataPath, shareRecord{
		Schema: 1, Token: token, Title: "Legacy", ProjectID: "hub:p", Path: "docs/legacy.md", Kind: "markdown",
		CreatedAt: now.Add(-time.Hour), ExpiresAt: timePtr(now.Add(time.Hour)), SizeBytes: 6,
	})
	if err := os.WriteFile(store.publicPath(token), []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.repair(); err != nil {
		t.Fatalf("repair() error = %v", err)
	}
	page, err := store.list("", 10)
	if err != nil {
		t.Fatalf("list() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].Schema != 1 || page.Items[0].SourceType != "project_document" || page.Items[0].Path != "docs/legacy.md" || page.Items[0].Kind != "markdown" {
		t.Fatalf("legacy list = %+v", page.Items)
	}
	metadata, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatalf("read legacy metadata: %v", err)
	}
	if bytes.Contains(metadata, []byte(`"sourceType"`)) {
		t.Fatalf("legacy metadata was rewritten: %s", metadata)
	}
}

func TestShareStoreRejectsOversizedDecodedContent(t *testing.T) {
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
	content := strings.Repeat("x", maxShareHTMLBytes+1)
	_, err := store.create(shareCreateInput{
		ProjectID: "hub:project",
		Path:      "docs/readme.md",
		Kind:      "markdown",
		Title:     "Readme",
		Expiry:    "permanent",
		Encoding:  "gzip+base64",
		Content:   gzipBase64ForTest(t, content),
	})
	if err == nil || !strings.Contains(err.Error(), "16 MiB") {
		t.Fatalf("create() error = %v, want 16 MiB rejection", err)
	}
}

func TestShareStoreRetriesTokenCollision(t *testing.T) {
	root := t.TempDir()
	first := bytes.Repeat([]byte{0x11}, shareTokenBytes)
	second := bytes.Repeat([]byte{0x22}, shareTokenBytes)
	// First create consumes first; second create sees first again and must retry
	// before accepting the second token.
	randomBytes := append(append([]byte{}, first...), first...)
	randomBytes = append(randomBytes, second...)
	store := newShareStore(shareStoreConfig{stateDir: root, random: bytes.NewReader(randomBytes)})
	input := shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>x</p>"),
	}
	firstResult, err := store.create(input)
	if err != nil {
		t.Fatal(err)
	}
	secondResult, err := store.create(input)
	if err != nil {
		t.Fatalf("collision retry create: %v", err)
	}
	if firstResult.Record.Token == secondResult.Record.Token {
		t.Fatalf("collision retry reused token %q", firstResult.Record.Token)
	}
}

func TestParseShareExpiryDefaultAndPermanent(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	got, err := parseShareExpiry("", now)
	if err != nil || got == nil || !got.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("default expiry = %v, %v", got, err)
	}
	permanent, err := parseShareExpiry("permanent", now)
	if err != nil || permanent != nil {
		t.Fatalf("permanent expiry = %v, %v", permanent, err)
	}
}

func TestShareStoreRejectsInvalidUTF8(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte{0xff, 0xfe}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir()})
	_, err := store.create(shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: base64.StdEncoding.EncodeToString(compressed.Bytes()),
	})
	if err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("invalid UTF-8 error = %v", err)
	}
}

func TestShareStoreNextExpiryReturnsNearestDeadline(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	store := newShareStore(shareStoreConfig{stateDir: t.TempDir(), now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	for index, expiresAt := range []*time.Time{timePtr(now.Add(3 * time.Hour)), timePtr(now.Add(time.Hour))} {
		token := strings.Repeat(string(rune('a'+index)), shareTokenLength)
		if !validShareToken(token) {
			t.Fatalf("test token %q is invalid", token)
		}
		writeTestShareRecord(t, filepath.Join(store.recordsDir, token+".json"), shareRecord{
			Schema: shareRecordSchemaVersion, Token: token, Title: "share", ProjectID: "hub:p", Path: "docs/a.html", Kind: "html",
			CreatedAt: now, ExpiresAt: expiresAt, SizeBytes: 1,
		})
	}
	next, ok := store.nextExpiry()
	if !ok || !next.Equal(now.Add(time.Hour)) {
		t.Fatalf("next expiry = %v, %v", next, ok)
	}
}

func TestShareStoreListUsesCursorAndLimit(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	randomBytes := bytes.Repeat([]byte{0x7f}, shareTokenBytes)
	randomBytes = append(randomBytes, bytes.Repeat([]byte{0x7e}, shareTokenBytes)...)
	randomBytes = append(randomBytes, bytes.Repeat([]byte{0x7d}, shareTokenBytes)...)
	store := newShareStore(shareStoreConfig{stateDir: root, now: func() time.Time { return now }, random: bytes.NewReader(randomBytes)})
	for index, title := range []string{"first", "second", "third"} {
		created := now.Add(time.Duration(index) * time.Minute)
		store.now = func() time.Time { return created }
		if _, err := store.create(shareCreateInput{
			ProjectID: "hub:project", Path: "docs/readme.md", Kind: "markdown", Title: title,
			Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, title),
		}); err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
	}
	store.now = func() time.Time { return now.Add(10 * time.Minute) }
	page, err := store.list("", 2)
	if err != nil {
		t.Fatalf("list() error = %v", err)
	}
	if len(page.Items) != 2 || page.NextCursor == "" || page.Items[0].Title != "third" {
		t.Fatalf("first page = %+v", page)
	}
	page2, err := store.list(page.NextCursor, 2)
	if err != nil {
		t.Fatalf("list(cursor) error = %v", err)
	}
	if len(page2.Items) != 1 || page2.Items[0].Title != "first" || page2.NextCursor != "" {
		t.Fatalf("second page = %+v", page2)
	}
}

func TestShareStoreRepairRemovesExpiredAndOrphanedFiles(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{stateDir: root, now: func() time.Time { return now }})
	if err := store.ensure(); err != nil {
		t.Fatal(err)
	}
	expired := strings.Repeat("a", 43)
	orphan := strings.Repeat("b", 43)
	writeTestShareRecord(t, filepath.Join(root, "shares", "records", expired+".json"), shareRecord{
		Schema: shareRecordSchemaVersion, Token: expired, Title: "old", ProjectID: "hub:p", Path: "old.md", Kind: "markdown",
		CreatedAt: now.Add(-2 * time.Hour), ExpiresAt: timePtr(now.Add(-time.Hour)), SizeBytes: 3,
	})
	if err := os.WriteFile(filepath.Join(root, "shares", "public", "s", expired), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shares", "public", "s", orphan), []byte("orphan"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "shares", "records", ".share-temp"), []byte("temp"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.repair(); err != nil {
		t.Fatalf("repair() error = %v", err)
	}
	for _, path := range []string{
		filepath.Join(root, "shares", "records", expired+".json"),
		filepath.Join(root, "shares", "public", "s", expired),
		filepath.Join(root, "shares", "public", "s", orphan),
		filepath.Join(root, "shares", "records", ".share-temp"),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s still exists, stat error = %v", path, err)
		}
	}
}

func TestShareStoreDeleteIsIdempotent(t *testing.T) {
	root := t.TempDir()
	store := newShareStore(shareStoreConfig{stateDir: root})
	result, err := store.create(shareCreateInput{
		ProjectID: "hub:project", Path: "docs/readme.html", Kind: "html", Title: "Readme",
		Expiry: "permanent", Encoding: "gzip+base64", Content: gzipBase64ForTest(t, "<p>x</p>"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.delete(result.Record.Token); err != nil {
		t.Fatalf("delete() error = %v", err)
	}
	if err := store.delete(result.Record.Token); err != nil {
		t.Fatalf("second delete() error = %v", err)
	}
}

func gzipBase64ForTest(t *testing.T, content string) string {
	t.Helper()
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)
	if _, err := writer.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func writeTestShareRecord(t *testing.T, path string, record shareRecord) {
	t.Helper()
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func timePtr(value time.Time) *time.Time { return &value }

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

func TestShareRequestsChatSources(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"https://share.example.test"}}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	initShareClient(t, ws, "share-token")

	requests := []map[string]any{
		{
			"sourceType": "chat_response", "projectId": "hub:p", "sessionId": "sess-1", "turnIndex": 9,
			"title": "Answer", "expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "<p>answer</p>"),
		},
		{
			"sourceType": "chat_session", "projectId": "hub:p", "sessionId": "sess-1",
			"title": "Session", "expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "<p>session</p>"),
		},
	}
	for index, payload := range requests {
		mustWriteJSON(t, ws, testEnvelope{RequestID: int64(2 + index), Type: "request", Method: rp.RegistryMethodShareCreate, Payload: payload})
		created := mustReadEnvelope(t, ws)
		if created.Type != rp.RegistryEnvelopeTypeResponse {
			t.Fatalf("create %d response = %+v", index, created)
		}
	}

	mustWriteJSON(t, ws, testEnvelope{RequestID: 4, Type: "request", Method: rp.RegistryMethodShareList, Payload: map[string]any{}})
	listed := mustReadEnvelope(t, ws)
	if listed.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("list response = %+v", listed)
	}
	var response struct {
		Items []struct {
			SourceType string `json:"sourceType"`
			ProjectID  string `json:"projectId"`
			Path       string `json:"path"`
			Kind       string `json:"kind"`
			SessionID  string `json:"sessionId"`
			TurnIndex  int    `json:"turnIndex"`
		} `json:"items"`
	}
	if err := json.Unmarshal(mustJSON(t, listed.Payload), &response); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(response.Items) != 2 {
		t.Fatalf("list items = %+v", response.Items)
	}
	bySource := make(map[string]struct {
		ProjectID string
		Path      string
		Kind      string
		SessionID string
		TurnIndex int
	}, len(response.Items))
	for _, item := range response.Items {
		bySource[item.SourceType] = struct {
			ProjectID string
			Path      string
			Kind      string
			SessionID string
			TurnIndex int
		}{item.ProjectID, item.Path, item.Kind, item.SessionID, item.TurnIndex}
	}
	if got := bySource["chat_response"]; got.ProjectID != "hub:p" || got.SessionID != "sess-1" || got.TurnIndex != 9 || got.Path != "" || got.Kind != "" {
		t.Fatalf("chat_response item = %+v", got)
	}
	if got := bySource["chat_session"]; got.ProjectID != "hub:p" || got.SessionID != "sess-1" || got.TurnIndex != 0 || got.Path != "" || got.Kind != "" {
		t.Fatalf("chat_session item = %+v", got)
	}
}

func TestShareRequestsLegacyProjectSource(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"https://share.example.test"}}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	initShareClient(t, ws, "share-token")

	mustWriteJSON(t, ws, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodShareCreate, Payload: map[string]any{
		"projectId": "hub:p", "path": "docs/readme.md", "kind": "markdown", "title": "Readme",
		"expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "<p>readme</p>"),
	}})
	created := mustReadEnvelope(t, ws)
	if created.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("create response = %+v", created)
	}
	mustWriteJSON(t, ws, testEnvelope{RequestID: 3, Type: "request", Method: rp.RegistryMethodShareList, Payload: map[string]any{}})
	listed := mustReadEnvelope(t, ws)
	var response struct {
		Items []struct {
			SourceType string `json:"sourceType"`
			Path       string `json:"path"`
			Kind       string `json:"kind"`
			SessionID  string `json:"sessionId"`
			TurnIndex  int    `json:"turnIndex"`
		} `json:"items"`
	}
	if listed.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("list response = %+v", listed)
	}
	if err := json.Unmarshal(mustJSON(t, listed.Payload), &response); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(response.Items) != 1 || response.Items[0].SourceType != "project_document" || response.Items[0].Path != "docs/readme.md" || response.Items[0].Kind != "markdown" || response.Items[0].SessionID != "" || response.Items[0].TurnIndex != 0 {
		t.Fatalf("legacy project list = %+v", response.Items)
	}
}

func TestShareRequestsRejectInvalidSourceFields(t *testing.T) {
	stateDir := t.TempDir()
	writeShareConfigTest(t, stateDir, `{"projects":[],"registry":{"share":{"publicUrl":"https://share.example.test"}}}`)
	s := New(Config{Token: "share-token", StateDir: stateDir})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	ws := dialWS(t, ts.URL+"/ws")
	defer ws.Close()
	initShareClient(t, ws, "share-token")

	payloads := []map[string]any{
		{
			"sourceType": "chat_response", "projectId": "hub:p", "sessionId": "sess-1", "turnIndex": 3, "path": "chat.md",
			"title": "Answer", "expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "bad"),
		},
		{
			"sourceType": "chat_session", "projectId": "hub:p", "sessionId": "sess-1", "turnIndex": 3,
			"title": "Session", "expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "bad"),
		},
		{
			"sourceType": "project_document", "projectId": "hub:p", "path": "docs/a.md", "kind": "markdown", "sessionId": "sess-1",
			"title": "Doc", "expiry": "1d", "encoding": "gzip+base64", "content": gzipBase64ForTest(t, "bad"),
		},
	}
	for index, payload := range payloads {
		mustWriteJSON(t, ws, testEnvelope{RequestID: int64(2 + index), Type: "request", Method: rp.RegistryMethodShareCreate, Payload: payload})
		response := mustReadEnvelope(t, ws)
		if response.Type != rp.RegistryEnvelopeTypeError || response.Payload["code"] != codeInvalidArgument {
			t.Fatalf("invalid source %d response = %+v", index, response)
		}
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

type securityE2EProxy struct {
	t        *testing.T
	stateDir string
	target   atomic.Pointer[url.URL]
	backend  *httptest.Server
	public   *httptest.Server
}

func newSecurityE2EProxy(t *testing.T, token string) *securityE2EProxy {
	t.Helper()
	fixture := &securityE2EProxy{t: t, stateDir: t.TempDir()}
	fixture.startRegistry(token)

	proxy := &httputil.ReverseProxy{Director: func(request *http.Request) {
		target := fixture.target.Load()
		request.URL.Scheme = target.Scheme
		request.URL.Host = target.Host
		request.Header.Set("X-Forwarded-Proto", "https")
		request.Header.Set("X-Real-IP", "203.0.113.10")
	}}
	fixture.public = httptest.NewServer(proxy)
	t.Cleanup(fixture.public.Close)
	return fixture
}

func (f *securityE2EProxy) startRegistry(token string) {
	f.t.Helper()
	if f.backend != nil {
		f.backend.CloseClientConnections()
		f.backend.Close()
	}
	server := New(Config{Token: token, StateDir: f.stateDir})
	if err := server.webSessions.Load(); err != nil {
		f.t.Fatalf("load registry sessions: %v", err)
	}
	f.backend = httptest.NewServer(server.Handler())
	target, err := url.Parse(f.backend.URL)
	if err != nil {
		f.t.Fatalf("parse registry backend URL: %v", err)
	}
	f.target.Store(target)
	f.t.Cleanup(f.backend.Close)
}

func (f *securityE2EProxy) origin() string {
	return "https://" + strings.TrimPrefix(f.public.URL, "http://")
}

func (f *securityE2EProxy) authRequest(method, basePath, action, body, origin string, cookie *http.Cookie) *http.Response {
	f.t.Helper()
	requestURL := f.public.URL + strings.TrimSuffix(basePath, "/") + "/ws?auth=" + action
	request, err := http.NewRequest(method, requestURL, strings.NewReader(body))
	if err != nil {
		f.t.Fatalf("create %s request: %v", action, err)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		request.Header.Set("Sec-Fetch-Mode", "cors")
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		f.t.Fatalf("perform %s request: %v", action, err)
	}
	return response
}

type securityE2EAuthStatus struct {
	Authenticated bool   `json:"authenticated"`
	CSRFToken     string `json:"csrfToken"`
	Device        struct {
		DeviceID string `json:"deviceId"`
		BasePath string `json:"basePath"`
	} `json:"device"`
}

func securityE2EReadStatus(t *testing.T, response *http.Response) securityE2EAuthStatus {
	t.Helper()
	defer response.Body.Close()
	var status securityE2EAuthStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode auth status: %v", err)
	}
	return status
}

func securityE2ELogin(t *testing.T, fixture *securityE2EProxy, token, basePath, deviceName string) (*http.Cookie, securityE2EAuthStatus) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"token": token, "deviceName": deviceName})
	if err != nil {
		t.Fatalf("encode login request: %v", err)
	}
	response := fixture.authRequest(http.MethodPost, basePath, "login", string(body), fixture.origin(), nil)
	if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
		status := response.StatusCode
		_ = response.Body.Close()
		t.Fatalf("login status=%d cookies=%d", status, len(response.Cookies()))
	}
	cookie := response.Cookies()[0]
	_ = response.Body.Close()
	statusResponse := fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie)
	status := securityE2EReadStatus(t, statusResponse)
	if !status.Authenticated || status.CSRFToken == "" || status.Device.DeviceID == "" || status.Device.BasePath != basePath {
		t.Fatalf("login status payload=%+v", status)
	}
	return cookie, status
}

func securityE2EConnectBrowser(t *testing.T, fixture *securityE2EProxy, basePath string, cookie *http.Cookie) *websocket.Conn {
	t.Helper()
	wsURL := "ws://" + strings.TrimPrefix(fixture.public.URL, "http://") + strings.TrimSuffix(basePath, "/") + "/ws"
	header := http.Header{
		"Origin": []string{fixture.origin()},
		"Cookie": []string{cookie.String()},
	}
	connection, response, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if response != nil {
			t.Fatalf("dial browser websocket: status=%d err=%v", response.StatusCode, err)
		}
		t.Fatalf("dial browser websocket: %v", err)
	}
	mustWriteJSON(t, connection, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-web", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "client",
	}})
	if response := mustReadEnvelope(t, connection); response.Type != "response" {
		_ = connection.Close()
		t.Fatalf("connect.init response=%+v", response)
	}
	return connection
}

func securityE2ERandomToken(t *testing.T) string {
	t.Helper()
	token, err := security.NewRegistryToken(rand.Reader)
	if err != nil {
		t.Fatalf("generate test token: %v", err)
	}
	return token
}

func TestSecurityE2EProxySessionLifecycle(t *testing.T) {
	for _, basePath := range []string{"/", "/wheelmaker/"} {
		t.Run(basePath, func(t *testing.T) {
			token := securityE2ERandomToken(t)
			fixture := newSecurityE2EProxy(t, token)

			initial := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", nil))
			if initial.Authenticated {
				t.Fatal("fresh browser unexpectedly authenticated")
			}

			cookie, device := securityE2ELogin(t, fixture, token, basePath, "Security E2E")
			if cookie.Path != basePath || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
				t.Fatalf("login cookie=%+v", cookie)
			}
			firstSocket := securityE2EConnectBrowser(t, fixture, basePath, cookie)
			defer firstSocket.Close()

			fixture.startRegistry(token)
			afterRestart := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie))
			if !afterRestart.Authenticated || afterRestart.Device.DeviceID != device.Device.DeviceID {
				t.Fatalf("session did not survive restart: %+v", afterRestart)
			}
			restartedSocket := securityE2EConnectBrowser(t, fixture, basePath, cookie)
			mustWriteJSON(t, restartedSocket, testEnvelope{RequestID: 2, Type: "request", Method: rp.RegistryMethodSecuritySessionRevoke, Payload: map[string]any{
				"deviceId": afterRestart.Device.DeviceID,
			}})
			if response := mustReadEnvelope(t, restartedSocket); response.Type != "response" || response.Payload["revoked"] != true {
				t.Fatalf("device revoke response=%+v", response)
			}
			_ = restartedSocket.SetReadDeadline(time.Now().Add(time.Second))
			if _, _, err := restartedSocket.ReadMessage(); err == nil {
				t.Fatal("revoked browser websocket remained connected")
			}
			_ = restartedSocket.Close()
			afterRevoke := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", cookie))
			if afterRevoke.Authenticated {
				t.Fatal("revoked cookie remained authenticated")
			}

			firstRotatedCookie, _ := securityE2ELogin(t, fixture, token, basePath, "Before Rotation A")
			secondRotatedCookie, _ := securityE2ELogin(t, fixture, token, basePath, "Before Rotation B")
			rotatedToken := securityE2ERandomToken(t)
			fixture.startRegistry(rotatedToken)
			for _, staleCookie := range []*http.Cookie{firstRotatedCookie, secondRotatedCookie} {
				status := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, basePath, "status", "", "", staleCookie))
				if status.Authenticated {
					t.Fatal("token rotation left an old browser session authenticated")
				}
			}
			oldLoginBody, _ := json.Marshal(map[string]string{"token": token})
			oldLogin := fixture.authRequest(http.MethodPost, basePath, "login", string(oldLoginBody), fixture.origin(), nil)
			_ = oldLogin.Body.Close()
			if oldLogin.StatusCode != http.StatusUnauthorized {
				t.Fatalf("old token login status=%d, want 401", oldLogin.StatusCode)
			}
			newCookie, _ := securityE2ELogin(t, fixture, rotatedToken, basePath, "After Rotation")
			if newCookie.Value == "" {
				t.Fatal("rotated token did not establish a new session")
			}
		})
	}
}

func TestSecurityE2ERejectsProxyBoundaryViolations(t *testing.T) {
	token := securityE2ERandomToken(t)
	fixture := newSecurityE2EProxy(t, token)

	crossOriginBody, _ := json.Marshal(map[string]string{"token": token})
	crossOrigin := fixture.authRequest(http.MethodPost, "/", "login", string(crossOriginBody), "https://attacker.invalid", nil)
	_ = crossOrigin.Body.Close()
	if crossOrigin.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin login status=%d, want 403", crossOrigin.StatusCode)
	}

	oversized := fixture.authRequest(http.MethodPost, "/", "login", `{"token":"`+strings.Repeat("x", maxWebLoginBodyBytes)+`"}`, fixture.origin(), nil)
	_ = oversized.Body.Close()
	if oversized.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized login status=%d, want 413", oversized.StatusCode)
	}

	rootCookie, _ := securityE2ELogin(t, fixture, token, "/", "Root Device")
	wrongPath := securityE2EReadStatus(t, fixture.authRequest(http.MethodGet, "/wheelmaker/", "status", "", "", rootCookie))
	if wrongPath.Authenticated {
		t.Fatal("root cookie authenticated against a different Base Path")
	}

	for attempt := 1; attempt <= sourceLoginBurst+1; attempt++ {
		response := fixture.authRequest(http.MethodPost, "/", "login", `{"token":"incorrect"}`, fixture.origin(), nil)
		_ = response.Body.Close()
		want := http.StatusUnauthorized
		if attempt > sourceLoginBurst {
			want = http.StatusTooManyRequests
		}
		if response.StatusCode != want {
			t.Fatalf("login attempt %d status=%d, want %d", attempt, response.StatusCode, want)
		}
	}

	directServer := New(Config{Token: token})
	request := httptest.NewRequest(http.MethodPost, "http://registry.example/ws?auth=login", strings.NewReader(string(crossOriginBody)))
	request.Host = "registry.example"
	request.RemoteAddr = "198.51.100.7:4321"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://registry.example")
	request.Header.Set("X-Forwarded-Proto", "https")
	recorder := httptest.NewRecorder()
	directServer.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("untrusted forwarded HTTPS status=%d, want 403", recorder.Code)
	}
}

func TestSecurityE2EHubWithoutOriginRequiresToken(t *testing.T) {
	token := securityE2ERandomToken(t)
	fixture := newSecurityE2EProxy(t, token)
	wsURL := "ws://" + strings.TrimPrefix(fixture.public.URL, "http://") + "/ws"

	unauthenticated, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial unauthenticated hub: %v", err)
	}
	mustWriteJSON(t, unauthenticated, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-hub", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "hub-e2e",
	}})
	if response := mustReadEnvelope(t, unauthenticated); response.Type != "error" || response.Payload["code"] != codeUnauthorized {
		t.Fatalf("tokenless hub response=%+v", response)
	}
	_ = unauthenticated.Close()

	authenticated, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial authenticated hub: %v", err)
	}
	defer authenticated.Close()
	mustWriteJSON(t, authenticated, testEnvelope{RequestID: 1, Type: "request", Method: rp.RegistryMethodConnectInit, Payload: map[string]any{
		"clientName": "wheelmaker-hub", "clientVersion": "0.1.0", "protocolVersion": rp.DefaultProtocolVersion, "role": "hub", "hubId": "hub-e2e", "token": token,
	}})
	if response := mustReadEnvelope(t, authenticated); response.Type != "response" {
		t.Fatalf("authenticated hub response=%+v", response)
	}
}

func TestWebSessionRestartRestoresPrivateCredentials(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	token := "short-custom-token"
	source := strings.NewReader(strings.Repeat("a", 32) + strings.Repeat("b", 32))
	store := newWebSessionStore(source, func() time.Time { return now }, token, statePath)
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, csrf, err := store.CreateWithLoginMetadata("Work Laptop", "/wheelmaker/", "203.0.113.9", "Shanghai, China")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	if raw == "" || csrf == "" || raw == csrf {
		t.Fatalf("invalid session credentials raw=%q csrf=%q", raw, csrf)
	}

	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("ReadFile(): %v", err)
	}
	for _, secret := range []string{raw, csrf, token} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatalf("session file contains secret %q: %s", secret, data)
		}
	}
	var persisted persistedWebSessionFile
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("Unmarshal(): %v", err)
	}
	if len(persisted.Sessions) != 1 {
		t.Fatalf("persisted sessions=%d, want 1", len(persisted.Sessions))
	}
	record := persisted.Sessions[0]
	if record.Digest == "" || record.DeviceID == "" || record.DeviceName != "Work Laptop" || record.BasePath != "/wheelmaker/" || record.LastLoginIP != "203.0.113.9" || record.LastLoginLocation != "Shanghai, China" {
		t.Fatalf("persisted session=%+v", record)
	}

	restored := newWebSessionStore(strings.NewReader(""), func() time.Time { return now }, token, statePath)
	if err := restored.Load(); err != nil {
		t.Fatalf("restored Load(): %v", err)
	}
	session, ok := restored.Authenticate(raw)
	if !ok || session.CSRFToken != csrf || session.DeviceID != record.DeviceID || session.DeviceName != "Work Laptop" || session.BasePath != "/wheelmaker/" || session.LastLoginIP != "203.0.113.9" || session.LastLoginLocation != "Shanghai, China" {
		t.Fatalf("Authenticate() session=%+v ok=%v", session, ok)
	}
	if err := restored.Revoke(raw); err != nil {
		t.Fatalf("Revoke(): %v", err)
	}
	if _, ok := restored.Authenticate(raw); ok {
		t.Fatal("revoked session authenticated")
	}
}

func TestWebSessionSlidesExpirationAndCoalescesPersistence(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", statePath)
	writes := 0
	writeFile := store.writeFile
	store.writeFile = func(path string, data []byte) error {
		writes++
		return writeFile(path, data)
	}
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	createdWrites := writes

	now = now.Add(time.Minute)
	session, ok := store.Authenticate(raw)
	if !ok || !session.ExpiresAt.Equal(now.Add(webSessionTTL)) {
		t.Fatalf("Authenticate() session=%+v ok=%v", session, ok)
	}
	if writes != createdWrites {
		t.Fatalf("touch writes=%d, want coalesced count %d", writes, createdWrites)
	}

	now = now.Add(3 * time.Minute)
	if _, ok := store.Authenticate(raw); !ok {
		t.Fatal("session did not authenticate during coalescing window")
	}
	if writes != createdWrites {
		t.Fatalf("high-frequency touch writes=%d, want %d", writes, createdWrites)
	}

	now = now.Add(2 * time.Minute)
	if _, ok := store.Authenticate(raw); !ok {
		t.Fatal("session did not authenticate after persistence interval")
	}
	if writes != createdWrites+1 {
		t.Fatalf("post-interval touch writes=%d, want %d", writes, createdWrites+1)
	}
}

func TestWebSession180DaySlidingTTL(t *testing.T) {
	if webSessionTTL != 180*24*time.Hour {
		t.Fatalf("webSessionTTL=%s, want 180 days", webSessionTTL)
	}
}

func TestWebSessionStoreExpiresSession(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", "")
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}
	now = now.Add(webSessionTTL)
	if _, ok := store.Authenticate(raw); ok {
		t.Fatal("expired session authenticated")
	}
}

func TestWebSessionTokenRotationInvalidatesShortTokens(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "a", statePath)
	if err := store.Load(); err != nil {
		t.Fatalf("Load(): %v", err)
	}
	raw, _, err := store.Create("Browser", "/")
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}

	rotated := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "b", statePath)
	if err := rotated.Load(); err != nil {
		t.Fatalf("rotated Load(): %v", err)
	}
	if _, ok := rotated.Authenticate(raw); ok {
		t.Fatal("session survived registry token rotation")
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("ReadFile(): %v", err)
	}
	var persisted persistedWebSessionFile
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("Unmarshal(): %v", err)
	}
	if persisted.TokenFingerprint != registryTokenFingerprint("b") || len(persisted.Sessions) != 0 {
		t.Fatalf("rotated file=%+v", persisted)
	}
	if bytes.Contains(data, []byte(`"a"`)) || bytes.Contains(data, []byte(`"b"`)) {
		t.Fatalf("rotated file contains raw short token: %s", data)
	}
}

func TestWebSessionCapacityEvictsLeastRecentlySeen(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "token", "")
	var firstRaw, secondRaw string
	for i := 0; i < maxWebSessions; i++ {
		raw, _, err := store.Create("Browser", "/")
		if err != nil {
			t.Fatalf("Create(%d): %v", i, err)
		}
		if i == 0 {
			firstRaw = raw
		}
		if i == 1 {
			secondRaw = raw
		}
		now = now.Add(time.Minute)
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("touch first session")
	}
	now = now.Add(time.Minute)
	if _, _, err := store.Create("Overflow", "/"); err != nil {
		t.Fatalf("Create(overflow): %v", err)
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("recently touched session was evicted")
	}
	if _, ok := store.Authenticate(secondRaw); ok {
		t.Fatal("least recently seen session was not evicted")
	}
}

func TestWebSessionCorruptFilesFailClosed(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "oversize", data: bytes.Repeat([]byte("x"), (1<<20)+1)},
		{name: "unknown version", data: []byte(`{"version":99,"tokenFingerprint":"x","sessions":[]}`)},
		{name: "invalid json", data: []byte(`{"version":`)},
		{name: "invalid digest", data: []byte(`{"version":1,"tokenFingerprint":"` + registryTokenFingerprint("token") + `","sessions":[{"deviceId":"d","digest":"invalid","deviceName":"Browser","basePath":"/","createdAt":"2026-07-13T12:00:00Z","lastSeenAt":"2026-07-13T12:00:00Z","expiresAt":"2027-01-09T12:00:00Z"}]}`)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
			if err := os.WriteFile(statePath, tt.data, 0o600); err != nil {
				t.Fatalf("WriteFile(): %v", err)
			}
			store := newWebSessionStore(&sequenceReader{}, time.Now, "token", statePath)
			if err := store.Load(); err == nil {
				t.Fatal("Load() succeeded, want fail closed")
			}
			if len(store.sessions) != 0 {
				t.Fatalf("loaded sessions=%d after failure", len(store.sessions))
			}
		})
	}
}

func TestWebSessionPrivatePermissionRepairFailureFailsClosed(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "registry-sessions.json")
	if err := os.WriteFile(statePath, []byte(`{"version":1,"tokenFingerprint":"x","sessions":[]}`), 0o600); err != nil {
		t.Fatalf("WriteFile(): %v", err)
	}
	store := newWebSessionStore(&sequenceReader{}, time.Now, "token", statePath)
	want := errors.New("permission repair failed")
	store.secureFile = func(string) error { return want }
	if err := store.Load(); !errors.Is(err, want) {
		t.Fatalf("Load() error=%v, want %v", err, want)
	}
}

func TestWebSessionListAndRevokeExposeOnlyPublicDeviceIDs(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	store := newWebSessionStore(&sequenceReader{}, func() time.Time { return now }, "registry-token", "")
	firstRaw, _, err := store.Create("First", "/")
	if err != nil {
		t.Fatalf("Create(first): %v", err)
	}
	first, ok := store.Authenticate(firstRaw)
	if !ok {
		t.Fatal("authenticate first")
	}
	now = now.Add(time.Minute)
	secondRaw, _, err := store.Create("Second", "/wheelmaker/")
	if err != nil {
		t.Fatalf("Create(second): %v", err)
	}
	second, ok := store.Authenticate(secondRaw)
	if !ok {
		t.Fatal("authenticate second")
	}

	listed, err := store.List(first.DeviceID)
	if err != nil {
		t.Fatalf("List(): %v", err)
	}
	if len(listed) != 2 {
		t.Fatalf("List()=%+v, want two sessions", listed)
	}
	encoded, err := json.Marshal(listed)
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}
	for _, forbidden := range []string{firstRaw, secondRaw, first.CSRFToken, second.CSRFToken, "registry-token", "digest", "csrf", "token", "cookie", "fingerprint"} {
		if bytes.Contains(bytes.ToLower(encoded), bytes.ToLower([]byte(forbidden))) {
			t.Fatalf("List() leaks %q: %s", forbidden, encoded)
		}
	}
	if revoked, err := store.RevokeDevice(second.DeviceID); err != nil || !revoked {
		t.Fatalf("RevokeDevice() revoked=%t err=%v", revoked, err)
	}
	if _, ok := store.Authenticate(secondRaw); ok {
		t.Fatal("revoked device authenticated")
	}
	if _, ok := store.Authenticate(firstRaw); !ok {
		t.Fatal("unrelated device was revoked")
	}
	if revoked, err := store.RevokeAll(); err != nil || len(revoked) != 1 || revoked[0] != first.DeviceID {
		t.Fatalf("RevokeAll() revoked=%v err=%v", revoked, err)
	}
	if _, ok := store.Authenticate(firstRaw); ok {
		t.Fatal("revokeAll left a session active")
	}
}

type sequenceReader struct {
	next uint64
}

func (r *sequenceReader) Read(p []byte) (int, error) {
	r.next++
	for i := range p {
		p[i] = byte(r.next >> (8 * (i % 8)))
	}
	return len(p), nil
}

func TestLoginLimiterThrottlesSourceAndRefills(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })
	for attempt := 1; attempt <= 5; attempt++ {
		if allowed, _ := limiter.Allow("203.0.113.9"); !allowed {
			t.Fatalf("attempt %d denied", attempt)
		}
	}
	if allowed, retry := limiter.Allow("203.0.113.9"); allowed || retry <= 0 {
		t.Fatalf("sixth attempt allowed=%v retry=%v", allowed, retry)
	}
	now = now.Add(loginTokenRefill)
	if allowed, _ := limiter.Allow("203.0.113.9"); !allowed {
		t.Fatal("source did not refill")
	}
}

func TestLoginLimiterAppliesGlobalLimit(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })
	for attempt := 0; attempt < globalLoginBurst; attempt++ {
		if allowed, _ := limiter.Allow(string(rune('a' + attempt))); !allowed {
			t.Fatalf("global attempt %d denied", attempt+1)
		}
	}
	if allowed, _ := limiter.Allow("overflow"); allowed {
		t.Fatal("global overflow attempt allowed")
	}
}

func TestUploadQuotaEvictsOldestRegularFile(t *testing.T) {
	directory := t.TempDir()
	base := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	for index := 0; index < maxDebugUploadFiles; index++ {
		path := filepath.Join(directory, uploadTestFileName(index))
		file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatalf("create quota fixture: %v", err)
		}
		if err := file.Truncate(maxDebugUploadLogBytes); err != nil {
			_ = file.Close()
			t.Fatalf("truncate quota fixture: %v", err)
		}
		_ = file.Close()
		stamp := base.Add(time.Duration(index) * time.Second)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("Chtimes(): %v", err)
		}
	}

	newName := "web-diagnostics-new.log"
	if err := writeDebugUpload(directory, newName, []byte("new upload")); err != nil {
		t.Fatalf("writeDebugUpload(): %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, uploadTestFileName(0))); !os.IsNotExist(err) {
		t.Fatalf("oldest upload was not evicted: %v", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("ReadDir(): %v", err)
	}
	if len(entries) != maxDebugUploadFiles {
		t.Fatalf("entry count=%d, want %d", len(entries), maxDebugUploadFiles)
	}
	info, err := os.Stat(filepath.Join(directory, newName))
	if err != nil {
		t.Fatalf("stat new upload: %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("new upload mode=%#o, want private", info.Mode().Perm())
	}
}

func TestUploadQuotaRejectsNonRegularDirectoryEntry(t *testing.T) {
	directory := t.TempDir()
	unsafeName := "web-diagnostics-20260713-000000.000-1-1.log"
	if err := os.Mkdir(filepath.Join(directory, unsafeName), 0o700); err != nil {
		t.Fatalf("Mkdir(): %v", err)
	}
	if err := writeDebugUpload(directory, "web-diagnostics-new.log", []byte("content")); err == nil {
		t.Fatal("writeDebugUpload() accepted a non-regular directory entry")
	}
	if _, err := os.Stat(filepath.Join(directory, "web-diagnostics-new.log")); !os.IsNotExist(err) {
		t.Fatalf("upload was written despite unsafe directory: %v", err)
	}
}

func TestUploadQuotaPreservesUnrelatedServiceLogs(t *testing.T) {
	directory := t.TempDir()
	serviceLog := filepath.Join(directory, "hub.log")
	if err := os.WriteFile(serviceLog, []byte("must survive"), 0o600); err != nil {
		t.Fatalf("write service log: %v", err)
	}
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(serviceLog, old, old); err != nil {
		t.Fatalf("Chtimes service log: %v", err)
	}
	for index := 0; index < maxDebugUploadFiles; index++ {
		name := uploadTestFileName(index)
		path := filepath.Join(directory, name)
		if err := os.WriteFile(path, []byte("upload"), 0o600); err != nil {
			t.Fatalf("write upload fixture: %v", err)
		}
		stamp := old.Add(time.Duration(index+1) * time.Second)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("Chtimes upload: %v", err)
		}
	}
	if err := writeDebugUpload(directory, "web-diagnostics-new.log", []byte("new")); err != nil {
		t.Fatalf("writeDebugUpload(): %v", err)
	}
	if data, err := os.ReadFile(serviceLog); err != nil || string(data) != "must survive" {
		t.Fatalf("service log changed data=%q err=%v", data, err)
	}
}

func uploadTestFileName(index int) string {
	return "web-diagnostics-" + time.Unix(int64(index), 0).UTC().Format("20060102-150405.000000000") + ".log"
}

func TestRequestIDWindowEvictsOldestAtCapacity(t *testing.T) {
	window := newRequestIDWindow(maxSeenRequestIDs)
	for id := int64(1); id <= maxSeenRequestIDs; id++ {
		if duplicate := window.Add(id); duplicate {
			t.Fatalf("request ID %d unexpectedly duplicate", id)
		}
	}
	if duplicate := window.Add(maxSeenRequestIDs); !duplicate {
		t.Fatal("latest request ID was not detected as duplicate")
	}
	if duplicate := window.Add(maxSeenRequestIDs + 1); duplicate {
		t.Fatal("new request ID was detected as duplicate")
	}
	if window.Len() != maxSeenRequestIDs {
		t.Fatalf("window Len()=%d, want %d", window.Len(), maxSeenRequestIDs)
	}
	if duplicate := window.Add(1); duplicate {
		t.Fatal("oldest evicted request ID remained in the set")
	}
	if duplicate := window.Add(2); duplicate {
		t.Fatal("second request ID should have been evicted after ring advanced")
	}
}

func TestPendingLimitRejectsWithoutGrowingMap(t *testing.T) {
	peer := &peerConn{pending: make(map[int64]chan envelope)}
	for id := int64(1); id <= maxPendingForwards; id++ {
		if _, err := peer.registerPending(id); err != nil {
			t.Fatalf("registerPending(%d): %v", id, err)
		}
	}
	if _, err := peer.registerPending(maxPendingForwards + 1); err != errPendingFull {
		t.Fatalf("overflow err=%v, want errPendingFull", err)
	}
	if len(peer.pending) != maxPendingForwards {
		t.Fatalf("pending len=%d, want %d", len(peer.pending), maxPendingForwards)
	}
	if !peer.resolvePending(1, envelope{}) {
		t.Fatal("resolvePending(1) failed")
	}
	if _, err := peer.registerPending(maxPendingForwards + 1); err != nil {
		t.Fatalf("register after release: %v", err)
	}
}

func TestPendingLimitReturnsBusy(t *testing.T) {
	peer := &peerConn{pending: make(map[int64]chan envelope, maxPendingForwards)}
	for id := int64(1); id <= maxPendingForwards; id++ {
		peer.pending[id] = make(chan envelope, 1)
	}
	server := New(Config{})
	server.hubs["hub-1"] = rp.HubSnapshot{HubID: "hub-1"}
	server.projectToHub["hub-1:project"] = "hub-1"
	server.hubPeers["hub-1"] = peer
	response := server.executeClientRequest(&connectionState{}, envelope{
		RequestID: 1,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodProjectFSList,
		ProjectID: "hub-1:project",
	})
	if response.Type != rp.RegistryEnvelopeTypeError {
		t.Fatalf("response type=%q, want error", response.Type)
	}
	var failure errorPayload
	if err := decodePayload(response.Payload, &failure); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	if failure.Code != codeBusy {
		t.Fatalf("error code=%q, want %q", failure.Code, codeBusy)
	}
}

func TestQueueLimitRejectsWithoutBlocking(t *testing.T) {
	queue := make(chan envelope, asyncQueueBuffer)
	for index := 0; index < asyncQueueBuffer; index++ {
		if !tryEnqueueRequest(queue, envelope{RequestID: int64(index + 1)}) {
			t.Fatalf("queue rejected item %d before capacity", index)
		}
	}
	if tryEnqueueRequest(queue, envelope{RequestID: asyncQueueBuffer + 1}) {
		t.Fatal("queue accepted item beyond capacity")
	}
	if len(queue) != asyncQueueBuffer {
		t.Fatalf("queue len=%d, want %d", len(queue), asyncQueueBuffer)
	}
}

func TestInputLimitBoundaries(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		messageBytes int
		valid        bool
	}{
		{name: "limit minus one", messageBytes: 16*1024*1024 - 1, valid: true},
		{name: "limit", messageBytes: 16 * 1024 * 1024, valid: true},
		{name: "limit plus one", messageBytes: 16*1024*1024 + 1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			message := registryMessageWithBytes(t, testCase.messageBytes)
			_, _, err := decodeEnvelopeMessage(message)
			if testCase.valid && err != nil {
				t.Fatalf("decodeEnvelopeMessage() err=%v", err)
			}
			if !testCase.valid && !errors.Is(err, errRegistryInputTooLarge) {
				t.Fatalf("decodeEnvelopeMessage() err=%v, want too large", err)
			}
		})
	}
}

func registryMessageWithBytes(t *testing.T, messageBytes int) []byte {
	t.Helper()
	prefix := `{"type":"event","method":"registry.project.list","payload":{"data":"`
	suffix := `"}}`
	padding := messageBytes - len(prefix) - len(suffix)
	if padding < 0 {
		t.Fatalf("messageBytes=%d is too small", messageBytes)
	}
	return []byte(prefix + strings.Repeat("x", padding) + suffix)
}

func TestInputLimitRejectsSecondJSONAndTrailingGarbage(t *testing.T) {
	for _, message := range []string{
		`{"requestId":1,"type":"request","method":"connect.init","payload":{}} {}`,
		`{"requestId":1,"type":"request","method":"connect.init","payload":{}} trailing`,
	} {
		if _, _, err := decodeEnvelopeMessage([]byte(message)); err == nil {
			t.Fatalf("decodeEnvelopeMessage(%q) succeeded", message)
		}
	}
}

func TestInputLimitWebLoginIgnoresDeceptiveContentLength(t *testing.T) {
	server := New(Config{Token: "custom-token"})
	body := `{"token":"` + strings.Repeat("x", maxWebLoginBodyBytes+1) + `"}`
	request := httptest.NewRequest(http.MethodPost, "https://registry.example/ws?auth=login", strings.NewReader(body))
	request.Host = "registry.example"
	request.ContentLength = 1
	request.Header.Set("Origin", "https://registry.example")
	request.Header.Set("Sec-Fetch-Site", "same-origin")
	request.Header.Set("Sec-Fetch-Mode", "cors")
	response := httptest.NewRecorder()
	server.handleWebLogin(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d, want 413", response.Code)
	}
}

func TestInputLimitHTTPServerTimeouts(t *testing.T) {
	server := newRegistryHTTPServer("127.0.0.1:9630", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 15*time.Second || server.WriteTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second {
		t.Fatalf("registry server timeouts=%s/%s/%s/%s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
}

type recordingTTSClient struct {
	request  ttsprovider.Request
	response ttsprovider.Response
	err      error
}

func (c *recordingTTSClient) Synthesize(_ context.Context, request ttsprovider.Request) (ttsprovider.Response, error) {
	c.request = request
	return c.response, c.err
}

func TestTTSAdapterPassesBackendSecretOnlyToClient(t *testing.T) {
	client := &recordingTTSClient{response: ttsprovider.Response{AudioBase64: "UklGRg==", Format: "wav"}}
	service := newTTSService(client, func() (string, error) { return "backend-tts-key", nil })
	response, serviceErr := service.synthesize(context.Background(), rp.TTSSynthesizePayload{
		Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello",
	})
	if serviceErr != nil {
		t.Fatalf("synthesize: %v", serviceErr)
	}
	if client.request.APIKey != "backend-tts-key" || client.request.Model != "mimo-v2.5-tts" || client.request.Voice != "Mia" || client.request.Text != "hello" {
		t.Fatalf("request=%+v", client.request)
	}
	if response.AudioBase64 != "UklGRg==" || response.Format != "wav" {
		t.Fatalf("response=%+v", response)
	}
	encoded, _ := json.Marshal(response)
	if strings.Contains(string(encoded), "backend-tts-key") {
		t.Fatalf("response leaks secret: %s", encoded)
	}
}

func TestTTSAdapterMapsCredentialAndProviderErrors(t *testing.T) {
	payload := rp.TTSSynthesizePayload{Model: "mimo-v2.5-tts", Voice: "Mia", Text: "hello"}
	tests := []struct {
		name     string
		resolver func() (string, error)
		client   *recordingTTSClient
		wantCode string
	}{
		{name: "not configured", resolver: func() (string, error) { return "", errTTSSecretNotConfigured }, client: &recordingTTSClient{}, wantCode: "not_configured"},
		{name: "credential read", resolver: func() (string, error) { return "", errors.New("disk") }, client: &recordingTTSClient{}, wantCode: codeInternal},
		{name: "invalid request", resolver: func() (string, error) { return "key", nil }, client: &recordingTTSClient{err: ttsprovider.ErrInvalidRequest}, wantCode: codeInvalidArgument},
		{name: "upstream", resolver: func() (string, error) { return "key", nil }, client: &recordingTTSClient{err: ttsprovider.ErrUnavailable}, wantCode: codeUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := newTTSService(tt.client, tt.resolver)
			_, serviceErr := service.synthesize(context.Background(), payload)
			if serviceErr == nil || serviceErr.Code != tt.wantCode {
				t.Fatalf("error=%v, want code %s", serviceErr, tt.wantCode)
			}
		})
	}
}

func TestIPWhoisLocationResolverCachesSuccessfulLookup(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/8.8.8.8" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"success":true,"city":"Mountain View","region":"California","country":"United States"}`))
	}))
	defer server.Close()

	now := time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)
	resolver := newIPWhoisLocationResolver(server.Client(), server.URL, func() time.Time { return now })
	for range 2 {
		if got := resolver.ResolveIPLocation(context.Background(), "8.8.8.8"); got != "Mountain View, California, United States" {
			t.Fatalf("ResolveIPLocation()=%q", got)
		}
	}
	if calls != 1 {
		t.Fatalf("calls=%d, want one cached lookup", calls)
	}
}
