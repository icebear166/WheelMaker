# Update-only Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated older Hub remain connected in a strictly update-only mode so the Web can query and trigger its existing updater without exposing Workspace capabilities.

**Architecture:** Keep Registry protocol `2.6` unchanged while adding maintenance protocol v1 as an additive contract. Registry negotiates `normal` versus `update_only`, owns a Hub directory independent from Project snapshots, and routes two dedicated maintenance methods; Hub Reporter skips normal startup in restricted mode and maps those methods to the existing UpdateCommand. The App consumes Hub directory descriptors/events, excludes restricted Hubs from every operational scan, and renders only the update action for them.

**Tech Stack:** Go 1.26, Gorilla WebSocket, existing Registry protocol descriptors, React 19, TypeScript, Jest, CSS.

---

## File structure

- `server/internal/protocol/registry.go`: shared maintenance version, connection-mode, handshake, Hub descriptor, and Hub directory event payload types.
- `server/internal/protocol/registry_methods.go`: maintenance route, two maintenance methods, and the Hub directory event descriptor.
- `server/internal/protocol/registry_methods_test.go`: lock the additive protocol contract without changing `DefaultProtocolVersion`.
- `server/internal/registry/hub_maintenance.go`: numeric protocol comparison, connection-mode negotiation, Hub directory mutation/events, and maintenance forwarding.
- `server/internal/registry/server.go`: store connection mode/version, invoke negotiation, apply the restricted method firewall, and route maintenance requests.
- `server/internal/registry/server_test.go`: WebSocket-level handshake, directory/event, firewall, and forwarding tests.
- `server/internal/hub/maintenance.go`: translate the two stable maintenance requests into the existing `cmd.update` query/request actions.
- `server/internal/hub/reporter.go`: return the negotiated mode from handshake, skip Project report/event sink in `update_only`, and dispatch maintenance requests.
- `server/internal/hub/hub_test.go`: Reporter handshake-mode and maintenance-handler tests using existing fake Registry/tool fixtures.
- `app/web/src/registry/registryMethods.ts`: App constants for the maintenance methods and Hub directory event.
- `app/web/src/registry/registryTypes.ts`: typed Hub connection descriptors and directory event payload.
- `app/web/src/registry/RegistryRepository.ts`: normalize Hub descriptors and use the dedicated maintenance methods for WheelMaker update calls.
- `app/web/src/settings/agentPackageUpdateView.ts`: distinguish all update-capable Hubs from normal operational Hubs and apply Hub directory events.
- `app/web/src/app/WorkspaceApp.tsx`: maintain the live Hub directory, query updates for both modes, and avoid all non-update scans for restricted Hubs.
- `app/web/src/app/ChatHubMenu.tsx`: render a restricted Hub row with incompatibility copy and only the update action.
- `app/web/src/styles/shell.css`: style the compact restricted-state label.
- Existing App tests: extend `app/__tests__/web-registry-protocol-domain-service.test.ts`, `app/__tests__/web-agent-package-update-service.test.ts`, `app/__tests__/web-agent-package-update-settings.test.ts`, `app/__tests__/web-agent-package-update-view.test.ts`, and `app/web/src/app/ChatHubMenu.test.tsx`.

### Task 1: Define the additive maintenance protocol contract

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/__tests__/web-registry-protocol-domain-service.test.ts`

- [ ] **Step 1: Write failing Go protocol tests**

Append focused assertions to `server/internal/protocol/registry_methods_test.go`:

```go
func TestMaintenanceV1ProtocolContractDoesNotChangeRegistryVersion(t *testing.T) {
	if DefaultProtocolVersion != "2.6" {
		t.Fatalf("DefaultProtocolVersion=%q, want 2.6", DefaultProtocolVersion)
	}
	if DefaultMaintenanceProtocolVersion != 1 {
		t.Fatalf("DefaultMaintenanceProtocolVersion=%d, want 1", DefaultMaintenanceProtocolVersion)
	}
	for _, method := range []string{
		RegistryMethodHubMaintenanceUpdateQuery,
		RegistryMethodHubMaintenanceUpdateRequest,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if desc.Route != RegistryRouteHubMaintenance || !desc.RequiresHubID {
			t.Fatalf("%s descriptor=%#v", method, desc)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("client must be allowed to request %s", method)
		}
	}
	event, ok := RegistryMethod(RegistryMethodRegistryHubUpdated)
	if !ok || event.Route != RegistryRouteClientEvent || len(event.Roles) != 0 {
		t.Fatalf("registry.hub.updated descriptor=%#v ok=%v", event, ok)
	}
}
```

- [ ] **Step 2: Run the Go protocol test and verify it fails**

Run from `server/`:

```powershell
go test ./internal/protocol -run '^TestMaintenanceV1ProtocolContractDoesNotChangeRegistryVersion$' -count=1
```

Expected: FAIL because the maintenance constant, route, and methods do not exist.

- [ ] **Step 3: Write the failing App protocol contract test**

Add this test to `app/__tests__/web-registry-protocol-domain-service.test.ts`:

```ts
test('keeps maintenance v1 additive to Registry 2.6', () => {
  const registryMethodsTs = readAppSource('web/src/registry/registryMethods.ts');

  expect(registryMethodsTs).toContain("RegistryProtocolVersion = '2.6'");
  expect(registryMethodsTs).toContain('RegistryMaintenanceProtocolVersion = 1');
  expect(registryMethodsTs).toContain("RegistryHubUpdated: 'registry.hub.updated'");
  expect(registryMethodsTs).toContain("HubMaintenanceUpdateQuery: 'hub.maintenance.update.query'");
  expect(registryMethodsTs).toContain("HubMaintenanceUpdateRequest: 'hub.maintenance.update.request'");
});
```

- [ ] **Step 4: Run the App protocol test and verify it fails**

Run from `app/`:

```powershell
npm test -- web-registry-protocol-domain-service.test.ts
```

Expected: FAIL because the App constants do not exist.

- [ ] **Step 5: Add the shared Go types and method descriptors**

In `server/internal/protocol/registry.go`, add:

```go
const DefaultMaintenanceProtocolVersion = 1

type RegistryConnectionMode string

const (
	RegistryConnectionModeNormal     RegistryConnectionMode = "normal"
	RegistryConnectionModeUpdateOnly RegistryConnectionMode = "update_only"
)

type HubListItem struct {
	HubID                    string                 `json:"hubId"`
	ConnectionMode           RegistryConnectionMode `json:"connectionMode"`
	ProtocolVersion          string                 `json:"protocolVersion"`
	SupportedProtocolVersion string                 `json:"supportedProtocolVersion"`
}

type RegistryHubUpdatedPayload struct {
	Online bool        `json:"online"`
	Hub    HubListItem `json:"hub"`
}
```

Extend the existing handshake structs:

```go
type ConnectInitPayload struct {
	ClientName                 string `json:"clientName"`
	ClientVersion              string `json:"clientVersion"`
	ProtocolVersion            string `json:"protocolVersion"`
	MaintenanceProtocolVersion int    `json:"maintenanceProtocolVersion,omitempty"`
	Role                       string `json:"role"`
	HubID                      string `json:"hubId,omitempty"`
	Token                      string `json:"token"`
	TS                         int64  `json:"ts,omitempty"`
	Nonce                      string `json:"nonce,omitempty"`
}

type ConnectServerInfo struct {
	ServerVersion              string `json:"serverVersion"`
	ProtocolVersion            string `json:"protocolVersion"`
	MaintenanceProtocolVersion int    `json:"maintenanceProtocolVersion"`
}

type ConnectInitResponsePayload struct {
	OK             bool                   `json:"ok"`
	ConnectionMode RegistryConnectionMode `json:"connectionMode"`
	Principal      ConnectPrincipal       `json:"principal"`
	ServerInfo     ConnectServerInfo      `json:"serverInfo"`
	Features       ConnectFeatures        `json:"features"`
	HashAlgorithms []string               `json:"hashAlgorithms"`
}
```

Replace the old one-field `HubListItem`; do not create a second type with the same name.

In `server/internal/protocol/registry_methods.go`, add `RegistryRouteHubMaintenance`, the three method constants, descriptors, and:

```go
func registryHubMaintenanceMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubMaintenance, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	return desc
}

func RegistryHubMaintenanceMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteHubMaintenance)
}
```

- [ ] **Step 6: Add matching App constants and types**

In `app/web/src/registry/registryMethods.ts`:

```ts
export const RegistryProtocolVersion = '2.6' as const;
export const RegistryMaintenanceProtocolVersion = 1 as const;
```

Add these properties to the existing `RegistryMethods` object:

```ts
RegistryHubUpdated: 'registry.hub.updated',
HubMaintenanceUpdateQuery: 'hub.maintenance.update.query',
HubMaintenanceUpdateRequest: 'hub.maintenance.update.request',
```

In `app/web/src/registry/registryTypes.ts`, replace the one-field Hub interface with:

```ts
export type RegistryHubConnectionMode = 'normal' | 'update_only';

export interface RegistryHub {
  hubId: string;
  connectionMode?: RegistryHubConnectionMode;
  protocolVersion?: string;
  supportedProtocolVersion?: string;
}

export interface RegistryHubUpdatedPayload {
  online: boolean;
  hub: RegistryHub;
}
```

- [ ] **Step 7: Run both focused protocol tests**

Run:

```powershell
Set-Location server
go test ./internal/protocol -run '^TestMaintenanceV1ProtocolContractDoesNotChangeRegistryVersion$' -count=1
Set-Location ../app
npm test -- web-registry-protocol-domain-service.test.ts
```

Expected: both PASS; the tests still assert Registry protocol `2.6`.

- [ ] **Step 8: Commit the protocol contract**

```powershell
git add server/internal/protocol/registry.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/__tests__/web-registry-protocol-domain-service.test.ts
git commit -m "feat(protocol): add maintenance v1 contract"
```

### Task 2: Negotiate connection mode and maintain a live Hub directory

**Files:**
- Create: `server/internal/registry/hub_maintenance.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing numeric negotiation tests**

Add to `server/internal/registry/server_test.go`:

```go
func TestNegotiateHubConnectionMode(t *testing.T) {
	tests := []struct {
		name        string
		role        string
		hubVersion  string
		maintenance int
		server      string
		want        rp.RegistryConnectionMode
		wantErr     bool
	}{
		{name: "same protocol", role: "hub", hubVersion: "2.6", maintenance: 1, server: "2.6", want: rp.RegistryConnectionModeNormal},
		{name: "older hub with maintenance", role: "hub", hubVersion: "2.6", maintenance: 1, server: "2.10", want: rp.RegistryConnectionModeUpdateOnly},
		{name: "older hub without maintenance", role: "hub", hubVersion: "2.6", server: "2.7", wantErr: true},
		{name: "newer hub", role: "hub", hubVersion: "2.10", maintenance: 1, server: "2.7", wantErr: true},
		{name: "client mismatch", role: "client", hubVersion: "2.6", maintenance: 1, server: "2.7", wantErr: true},
		{name: "malformed hub version", role: "hub", hubVersion: "2.x", maintenance: 1, server: "2.7", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := negotiateConnectionMode(tt.role, tt.hubVersion, tt.maintenance, tt.server)
			if (err != nil) != tt.wantErr || got != tt.want {
				t.Fatalf("mode=%q err=%v, want mode=%q wantErr=%v", got, err, tt.want, tt.wantErr)
			}
		})
	}
}
```

- [ ] **Step 2: Run the negotiation test and verify it fails**

Run from `server/`:

```powershell
go test ./internal/registry -run '^TestNegotiateHubConnectionMode$' -count=1
```

Expected: FAIL because `negotiateConnectionMode` does not exist.

- [ ] **Step 3: Implement strict numeric negotiation**

Create `server/internal/registry/hub_maintenance.go` with focused helpers:

```go
package registry

import (
	"fmt"
	"strconv"
	"strings"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func compareProtocolVersions(left, right string) (int, error) {
	parse := func(value string) ([]int, error) {
		parts := strings.Split(strings.TrimSpace(value), ".")
		if len(parts) < 2 {
			return nil, fmt.Errorf("invalid protocol version %q", value)
		}
		out := make([]int, len(parts))
		for index, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil || n < 0 {
				return nil, fmt.Errorf("invalid protocol version %q", value)
			}
			out[index] = n
		}
		return out, nil
	}
	leftParts, err := parse(left)
	if err != nil {
		return 0, err
	}
	rightParts, err := parse(right)
	if err != nil {
		return 0, err
	}
	length := max(len(leftParts), len(rightParts))
	for index := 0; index < length; index++ {
		var l, r int
		if index < len(leftParts) {
			l = leftParts[index]
		}
		if index < len(rightParts) {
			r = rightParts[index]
		}
		if l < r {
			return -1, nil
		}
		if l > r {
			return 1, nil
		}
	}
	return 0, nil
}

func negotiateConnectionMode(role, peerVersion string, maintenanceVersion int, serverVersion string) (rp.RegistryConnectionMode, error) {
	if peerVersion == serverVersion {
		return rp.RegistryConnectionModeNormal, nil
	}
	if role != string(rp.RegistryRoleHub) {
		return "", fmt.Errorf("client protocol version mismatch")
	}
	order, err := compareProtocolVersions(peerVersion, serverVersion)
	if err != nil || order >= 0 || maintenanceVersion != rp.DefaultMaintenanceProtocolVersion {
		return "", fmt.Errorf("unsupported protocol version")
	}
	return rp.RegistryConnectionModeUpdateOnly, nil
}
```

- [ ] **Step 4: Write failing WebSocket handshake and Hub directory tests**

Add `TestConnectInitAllowsOlderMaintenanceHub` and `TestRegistryHubUpdatedTracksRestrictedHub` to `server/internal/registry/server_test.go`. Use `Config{ProtocolVersion: "2.7"}` without changing the default constant. The core assertions must be:

```go
mustWriteJSON(t, hub, testEnvelope{
	RequestID: 1,
	Type:      rp.RegistryEnvelopeTypeRequest,
	Method:    rp.RegistryMethodConnectInit,
	Payload: map[string]any{
		"clientName": "wheelmaker-hub",
		"clientVersion": "test",
		"protocolVersion": "2.6",
		"maintenanceProtocolVersion": 1,
		"role": "hub",
		"hubId": "hub-old",
		"token": "secret",
	},
})
init := mustReadEnvelope(t, hub)
if init.Type != rp.RegistryEnvelopeTypeResponse || init.Payload["connectionMode"] != "update_only" {
	t.Fatalf("init=%#v", init)
}

mustWriteJSON(t, client, testEnvelope{
	RequestID: 2,
	Type: rp.RegistryEnvelopeTypeRequest,
	Method: rp.RegistryMethodRegistryProjectList,
	Payload: map[string]any{},
})
snapshot := mustReadEnvelope(t, client)
projects := snapshot.Payload["projects"].([]any)
hubs := snapshot.Payload["hubs"].([]any)
if len(projects) != 0 || len(hubs) != 1 {
	t.Fatalf("snapshot=%#v", snapshot)
}
```

Also assert an already-connected Client receives `registry.hub.updated` with `online:true`, and receives `online:false` after the Hub socket closes. Keep the existing Token test and add a case proving a bad Token is rejected before any update-only response.

- [ ] **Step 5: Run the handshake tests and verify they fail**

Run:

```powershell
go test ./internal/registry -run 'Test(ConnectInitAllowsOlderMaintenanceHub|RegistryHubUpdatedTracksRestrictedHub)' -count=1
```

Expected: FAIL because mismatch is still rejected and Hub descriptors/events do not exist.

- [ ] **Step 6: Store connection metadata independently from Projects**

In `server/internal/registry/server.go`:

```go
type connectionState struct {
	// existing fields
	connectionMode  rp.RegistryConnectionMode
	protocolVersion string
}

type Server struct {
	// existing fields
	hubConnections map[string]rp.HubListItem
}
```

Initialize `hubConnections` in `New`. In `handleConnectInit`, run all existing payload/role/Hub ID/Token checks first, then call `negotiateConnectionMode`. On success:

```go
state.connectionMode = connectionMode
state.protocolVersion = strings.TrimSpace(payload.ProtocolVersion)

resp := connectInitResponsePayload{
	OK:             true,
	ConnectionMode: connectionMode,
	Principal:      principal,
	ServerInfo: rp.ConnectServerInfo{
		ServerVersion:              s.cfg.ServerVersion,
		ProtocolVersion:            s.cfg.ProtocolVersion,
		MaintenanceProtocolVersion: rp.DefaultMaintenanceProtocolVersion,
	},
	Features:       features,
	HashAlgorithms: []string{"sha256"},
}
```

After writing the successful response, register Hub peers immediately for both modes through `registerHubConnection`. Move Hub directory listing to `hubConnections`, while `s.hubs` remains the Project snapshot owner. When a Hub disconnects, remove only the descriptor owned by the same peer, then emit `registry.hub.updated` with `online:false`. A normal Hub's later Project report may update Project maps but must not be required for Hub directory visibility.

- [ ] **Step 7: Enforce restricted inbound methods**

Replace the role-only check with:

```go
func methodAllowedForConnection(state *connectionState, method string) bool {
	if state.connectionMode == rp.RegistryConnectionModeUpdateOnly {
		return state.role == string(rp.RegistryRoleHub) && method == rp.RegistryMethodHubPing
	}
	return rp.RegistryMethodAllowed(state.role, method)
}
```

Use it for both request and event handling. Add an explicit guard at the start of `handleHubReportProjects` and `handleHubUpdateProject` returning `FORBIDDEN` when the connection is `update_only`; this keeps the invariant visible at the business handler boundary as well as the generic method firewall.

- [ ] **Step 8: Run the Registry handshake/directory suite**

Run:

```powershell
go test ./internal/registry -run 'Test(ConnectInit|RegistryHubUpdated|NegotiateHubConnectionMode)' -count=1
```

Expected: PASS, including existing legacy-version rejection tests and new update-only cases.

- [ ] **Step 9: Commit negotiation and directory behavior**

```powershell
git add server/internal/registry/hub_maintenance.go server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): negotiate update-only hub connections"
```

### Task 3: Route maintenance updates and serve them from Hub Reporter

**Files:**
- Modify: `server/internal/registry/hub_maintenance.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Create: `server/internal/hub/maintenance.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write a failing Registry forwarding/firewall test**

In `server/internal/registry/server_test.go`, connect a `2.6` maintenance Hub to a test Registry configured as `2.7`, then connect a current Client. Assert the maintenance query reaches the Hub with an empty payload and the response returns to the Client:

```go
mustWriteJSON(t, client, testEnvelope{
	RequestID: 21,
	Type:      rp.RegistryEnvelopeTypeRequest,
	Method:    rp.RegistryMethodHubMaintenanceUpdateQuery,
	HubID:     "hub-old",
	Payload:   map[string]any{},
})
forwarded := mustReadEnvelope(t, hub)
if forwarded.Method != rp.RegistryMethodHubMaintenanceUpdateQuery || forwarded.HubID != "hub-old" {
	t.Fatalf("forwarded=%#v", forwarded)
}
mustWriteJSON(t, hub, testEnvelope{
	RequestID: forwarded.RequestID,
	Type:      rp.RegistryEnvelopeTypeResponse,
	Method:    forwarded.Method,
	HubID:     "hub-old",
	Payload: map[string]any{
		"ok": true, "status": "installed", "hubId": "hub-old", "canRequestUpdate": true,
	},
})
response := mustReadEnvelope(t, client)
if response.RequestID != 21 || response.Payload["status"] != "installed" {
	t.Fatalf("response=%#v", response)
}
```

In the same test, send `hub.state.get`, `project.fs.list`, and `hub.config.get` to `hub-old` and assert each returns `FORBIDDEN` without a frame arriving at the Hub.

- [ ] **Step 2: Run the Registry maintenance route test and verify it fails**

Run:

```powershell
go test ./internal/registry -run '^TestUpdateOnlyHubMaintenanceForwardingAndFirewall$' -count=1
```

Expected: FAIL because maintenance requests are not routed.

- [ ] **Step 3: Implement the dedicated Registry route**

In `server/internal/registry/server.go`, include `rp.RegistryHubMaintenanceMethod(in.Method)` in asynchronous dispatch and route it before HubState:

```go
case rp.RegistryHubMaintenanceMethod(in.Method):
	s.handleHubMaintenanceRequest(state.peer, state, in)
```

In `server/internal/registry/hub_maintenance.go`, implement `handleHubMaintenanceRequest` by following the existing pending-request pattern in `executeHubStateRequest`: require top-level `hubId`, enforce Client scope, resolve `hubConnections[hubID]` and `hubPeers[hubID]`, forward only `{}` payload, wait up to 60 seconds, preserve the Client request ID on the response, and return `NOT_FOUND`, `UNAVAILABLE`, `BUSY`, `TIMEOUT`, or the Hub's error envelope unchanged as applicable.

Before any non-maintenance Hub forward in `executeHubStateRequest`, `executeClientRequest`, terminal routing, release routing, Relay routing, or Debug Web routing, call:

```go
func (s *Server) rejectUpdateOnlyHub(in envelope, hubID string) (envelope, bool) {
	s.mu.RLock()
	hub := s.hubConnections[hubID]
	s.mu.RUnlock()
	if hub.ConnectionMode == rp.RegistryConnectionModeUpdateOnly {
		resp := s.errorEnvelope(in.Method, codeForbidden, "hub is available for update only", map[string]any{"hubId": hubID})
		resp.HubID = hubID
		return resp, true
	}
	return envelope{}, false
}
```

Call the helper immediately after each existing route resolves its target Hub ID. If it returns `true`, write that envelope to the Client and return before registering a pending request or writing to the Hub. Apply it in `executeHubStateRequest`, `executeClientRequest`, terminal routing, release routing, Relay routing, and Debug Web routing. Do not depend only on the restricted Hub rejecting a forwarded request; Registry must never send it.

- [ ] **Step 4: Write failing Hub Reporter handshake and handler tests**

Add to `server/internal/hub/hub_test.go`:

```go
func TestReporterUpdateOnlyHandshakeSkipsProjectReport(t *testing.T) {
	requests := make(chan testEnvelope, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(_ *http.Request) bool { return true }}
		ws, err := upgrader.Upgrade(w, req, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer ws.Close()
		initReq := mustReadEnvelope(t, ws)
		requests <- initReq
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: initReq.RequestID,
			Type: rp.RegistryEnvelopeTypeResponse,
			Method: rp.RegistryMethodConnectInit,
			Payload: map[string]any{
				"ok": true,
				"connectionMode": "update_only",
				"principal": map[string]any{"role": "hub", "hubId": "hub-old", "connectionEpoch": 7},
				"serverInfo": map[string]any{"protocolVersion": "2.7", "maintenanceProtocolVersion": 1},
				"features": map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})
		ws.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		var next testEnvelope
		if err := ws.ReadJSON(&next); err == nil && next.Method == rp.RegistryMethodHubReportProjects {
			t.Errorf("update-only reporter sent project report: %#v", next)
		}
	}))
	defer server.Close()

	reporter := NewReporter(ReporterConfig{Server: strings.TrimPrefix(server.URL, "http"), HubID: "hub-old"}, []ProjectInfo{{Name: "project-a"}})
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	mode, err := reporter.handshake(conn)
	if err != nil || mode != rp.RegistryConnectionModeUpdateOnly {
		t.Fatalf("mode=%q err=%v", mode, err)
	}
	initReq := <-requests
	if initReq.Payload["maintenanceProtocolVersion"] != float64(1) {
		t.Fatalf("init=%#v", initReq)
	}
}
```

Add `TestReporterUpdateOnlyRejectsBusinessRequest` with the same fake handshake, but run `reporter.runSession(ctx)`. After returning `connectionMode:update_only`, send a `hub.state.get` request and assert the next Hub frame is:

```go
testEnvelope{
	RequestID: 12,
	Type:      rp.RegistryEnvelopeTypeError,
	Payload: map[string]any{
		"code":    rp.CodeForbidden,
		"message": "hub connection is available for update only",
	},
}
```

Set the fake Registry socket read deadline to two seconds and assert no `hub.report.projects` frame arrives before this error.

Also add `TestReporterMaintenanceUpdateMethodsUseUpdateCommand`. For each method, inject a fresh existing `stubToolCommandHandler`, send the maintenance request through `newFakeReporterRegistry`, read the Reporter response, and inspect `handler.snapshot()`:

```go
func TestReporterMaintenanceUpdateMethodsUseUpdateCommand(t *testing.T) {
	tests := []struct {
		method string
		action string
	}{
		{method: rp.RegistryMethodHubMaintenanceUpdateQuery, action: "query"},
		{method: rp.RegistryMethodHubMaintenanceUpdateRequest, action: "request"},
	}
	for _, tt := range tests {
		t.Run(tt.action, func(t *testing.T) {
			respSeen := make(chan testEnvelope, 1)
			errSeen := make(chan error, 1)
			ts := newFakeReporterRegistry(t, "hub-old", testEnvelope{
				RequestID: 11,
				Type:      rp.RegistryEnvelopeTypeRequest,
				Method:    tt.method,
				HubID:     "hub-old",
				Payload:   map[string]any{},
			}, respSeen, errSeen)
			reporter := NewReporter(ReporterConfig{
				Server: strings.TrimPrefix(ts.URL, "http://"), HubID: "hub-old",
				ReconnectInterval: 50 * time.Millisecond, StateDir: t.TempDir(),
			}, nil)
			handler := &stubToolCommandHandler{response: map[string]any{
				"ok": true, "status": "installed", "hubId": "hub-old", "canRequestUpdate": true,
			}}
			reporter.toolHandler = handler
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- reporter.Run(ctx) }()
			defer stopReporterForTest(t, cancel, done)

			select {
			case err := <-errSeen:
				t.Fatal(err)
			case resp := <-respSeen:
				if resp.Type != rp.RegistryEnvelopeTypeResponse || resp.Method != tt.method {
					t.Fatalf("response=%#v", resp)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("maintenance response timeout")
			}
			method, rawPayload, _ := handler.snapshot()
			var payload map[string]any
			if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil {
				t.Fatal(err)
			}
			if method != hubToolMethodUpdate || payload["action"] != tt.action || payload["hubId"] != "hub-old" {
				t.Fatalf("method=%q payload=%#v", method, payload)
			}
		})
	}
}
```

- [ ] **Step 5: Run the Hub tests and verify they fail**

Run:

```powershell
go test ./internal/hub -run 'TestReporter(UpdateOnlyHandshakeSkipsProjectReport|UpdateOnlyRejectsBusinessRequest|MaintenanceUpdateMethodsUseUpdateCommand)' -count=1
```

Expected: FAIL because handshake returns only an error, does not advertise maintenance v1, and has no maintenance handler.

- [ ] **Step 6: Implement the Reporter mode transition**

Change `handshake` to:

```go
func (r *Reporter) handshake(conn *websocket.Conn) (rp.RegistryConnectionMode, error)
```

Include `"maintenanceProtocolVersion": rp.DefaultMaintenanceProtocolVersion` in `connect.init`. Decode `ConnectionMode`; treat an empty mode as `normal` for additive compatibility with the current Registry response. Set `connectionEpoch` in both modes, but send `hub.report.projects` only in `normal`.

In `runSession`, keep keepalive and request processing for both modes. Create `hubEventSink` only for `normal`, so usage/HubState events cannot leak from a restricted connection. Pass the connection mode into the request dispatcher and enforce a second firewall inside Hub:

```go
func (r *Reporter) rejectUpdateOnlyRequest(conn *websocket.Conn, in envelope, mode rp.RegistryConnectionMode) bool {
	if mode == rp.RegistryConnectionModeUpdateOnly && !rp.RegistryHubMaintenanceMethod(in.Method) {
		_ = r.writeError(conn, in.RequestID, codeForbidden, "hub connection is available for update only")
		return true
	}
	return false
}
```

Pass `mode` from the read loop into `handleRegistryRequest` and call this helper at the top; return immediately when it returns `true`. Keep the existing normal-mode dispatcher body below the guard.

- [ ] **Step 7: Implement the Hub maintenance adapter**

Create `server/internal/hub/maintenance.go`:

```go
package hub

import (
	"context"

	"github.com/gorilla/websocket"
	"github.com/swm8023/wheelmaker/internal/hub/tools"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func (r *Reporter) replyMaintenanceUpdate(conn *websocket.Conn, req envelope) {
	action := ""
	switch req.Method {
	case rp.RegistryMethodHubMaintenanceUpdateQuery:
		action = "query"
	case rp.RegistryMethodHubMaintenanceUpdateRequest:
		action = "request"
	default:
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "unsupported maintenance update method")
		return
	}
	result, err := r.runHubStateTool(context.Background(), hubToolMethodUpdate, map[string]any{
		"action": action,
		"hubId":  r.cfg.HubID,
	})
	if err != nil {
		if commandErr, ok := err.(*tools.CommandError); ok {
			code := commandErr.Code
			if code == "" {
				code = codeInternal
			}
			_ = r.writeError(conn, req.RequestID, code, commandErr.Message)
			return
		}
		_ = r.writeError(conn, req.RequestID, codeInternal, err.Error())
		return
	}
	_ = r.writeJSON(conn, "->", envelope{
		RequestID: req.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    req.Method,
		HubID:     r.cfg.HubID,
		Payload:   rp.MustRaw(result),
	})
}
```

Dispatch both maintenance methods from `handleRegistryRequest`.

- [ ] **Step 8: Run focused Registry and Hub suites**

Run:

```powershell
go test ./internal/registry -run 'Test(UpdateOnlyHub|ConnectInit|RegistryHubUpdated)' -count=1
go test ./internal/hub -run 'TestReporter(UpdateOnly|Maintenance)' -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit the maintenance route and Hub adapter**

```powershell
git add server/internal/registry/hub_maintenance.go server/internal/registry/server.go server/internal/registry/server_test.go server/internal/hub/maintenance.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(hub): serve update-only maintenance requests"
```

### Task 4: Move App update calls to maintenance methods and track Hub modes

**Files:**
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-agent-package-update-service.test.ts`
- Modify: `app/__tests__/web-agent-package-update-view.test.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`

- [ ] **Step 1: Write failing repository tests for Hub descriptors and maintenance calls**

Update `app/__tests__/web-agent-package-update-service.test.ts` so the project-list fixture contains both modes and assert normalization:

```ts
expect(await repository.listProjectSnapshot()).toEqual({
  projects: [],
  hubs: [
    {
      hubId: 'hub-normal',
      connectionMode: 'normal',
      protocolVersion: '2.6',
      supportedProtocolVersion: '2.6',
    },
    {
      hubId: 'hub-old',
      connectionMode: 'update_only',
      protocolVersion: '2.5',
      supportedProtocolVersion: '2.6',
    },
  ],
});
```

Replace the old HubState update-call expectations with:

```ts
expect(client.request).toHaveBeenNthCalledWith(1, {
  method: RegistryMethods.HubMaintenanceUpdateQuery,
  hubId: 'hub-a',
  payload: {},
  timeoutMs: 60000,
});
expect(client.request).toHaveBeenNthCalledWith(2, {
  method: RegistryMethods.HubMaintenanceUpdateRequest,
  hubId: 'hub-a',
  payload: {},
  timeoutMs: 60000,
});
```

- [ ] **Step 2: Write failing pure Hub-list behavior tests**

In `app/__tests__/web-agent-package-update-view.test.ts`, add:

```ts
test('separates update-capable hubs from operational hubs', () => {
  const hubs: RegistryHub[] = [
    {hubId: 'hub-a', connectionMode: 'normal', protocolVersion: '2.6', supportedProtocolVersion: '2.6'},
    {hubId: 'hub-old', connectionMode: 'update_only', protocolVersion: '2.5', supportedProtocolVersion: '2.6'},
  ];
  expect(deriveUpdateHubIds(hubs, [])).toEqual(['hub-a', 'hub-old']);
  expect(deriveOperationalHubIds(hubs, [])).toEqual(['hub-a']);
});

test('applies online and offline hub directory events', () => {
  const restricted: RegistryHub = {
    hubId: 'hub-old',
    connectionMode: 'update_only',
    protocolVersion: '2.5',
    supportedProtocolVersion: '2.6',
  };
  expect(applyRegistryHubUpdated([], {online: true, hub: restricted})).toEqual([restricted]);
  expect(applyRegistryHubUpdated([restricted], {online: false, hub: restricted})).toEqual([]);
});
```

- [ ] **Step 3: Run the focused App tests and verify they fail**

Run from `app/`:

```powershell
npm test -- web-agent-package-update-service.test.ts web-agent-package-update-view.test.ts
```

Expected: FAIL because updates still use HubState and Hub mode helpers do not exist.

- [ ] **Step 4: Normalize descriptors and call maintenance methods**

In `RegistryRepository.listProjectSnapshot`, normalize every Hub:

```ts
const connectionMode = hub?.connectionMode === 'update_only' ? 'update_only' : 'normal';
return {
  hubId,
  connectionMode,
  protocolVersion: typeof hub?.protocolVersion === 'string' ? hub.protocolVersion : RegistryProtocolVersion,
  supportedProtocolVersion: typeof hub?.supportedProtocolVersion === 'string'
    ? hub.supportedProtocolVersion
    : RegistryProtocolVersion,
};
```

Change both update methods to return the direct response:

```ts
async queryWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
  const resp = await this.client.request({
    method: RegistryMethods.HubMaintenanceUpdateQuery,
    hubId,
    payload: {},
    timeoutMs: 60000,
  });
  return resp.payload as RegistryWheelMakerUpdateResponse;
}

async requestWheelMakerUpdate(hubId: string): Promise<RegistryWheelMakerUpdateResponse> {
  const resp = await this.client.request({
    method: RegistryMethods.HubMaintenanceUpdateRequest,
    hubId,
    payload: {},
    timeoutMs: 60000,
  });
  return resp.payload as RegistryWheelMakerUpdateResponse;
}
```

- [ ] **Step 5: Add pure Hub-mode helpers**

In `app/web/src/settings/agentPackageUpdateView.ts`:

```ts
export function deriveUpdateHubIds(
  hubs: RegistryHub[],
  projects: Array<Pick<RegistryProject, 'hubId' | 'online'>>,
): string[] {
  const hubIds = new Set(deriveRegistryHubIds(hubs));
  projects.forEach(project => {
    const hubId = (project.hubId || '').trim();
    if (project.online === true && hubId) hubIds.add(hubId);
  });
  return Array.from(hubIds).sort(compareHubIds);
}

export function deriveOperationalHubIds(
  hubs: RegistryHub[],
  projects: Array<Pick<RegistryProject, 'hubId' | 'online'>>,
): string[] {
  const hubIds = new Set(
    hubs
      .filter(hub => hub.connectionMode !== 'update_only')
      .map(hub => hub.hubId.trim())
      .filter(Boolean),
  );
  projects.forEach(project => {
    const hubId = (project.hubId || '').trim();
    if (project.online === true && hubId) hubIds.add(hubId);
  });
  return Array.from(hubIds).sort(compareHubIds);
}

export function deriveOperationalHubs(hubs: RegistryHub[]): RegistryHub[] {
  return hubs.filter(hub => hub.connectionMode !== 'update_only');
}

export function applyRegistryHubUpdated(
  hubs: RegistryHub[],
  payload: RegistryHubUpdatedPayload,
): RegistryHub[] {
  const withoutTarget = hubs.filter(hub => hub.hubId !== payload.hub.hubId);
  return payload.online
    ? [...withoutTarget, payload.hub].sort((left, right) => compareHubIds(left.hubId, right.hubId))
    : withoutTarget;
}
```

- [ ] **Step 6: Wire live events and split update scans from operational scans**

In `WorkspaceApp.tsx`, derive both lists:

```ts
const operationalHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));
const operationalHubIds = useMemo<string[]>(() => JSON.parse(operationalHubIdsKey), [operationalHubIdsKey]);
const updateHubIdsKey = JSON.stringify(deriveUpdateHubIds(registryHubs, projects));
const updateHubIds = useMemo<string[]>(() => JSON.parse(updateHubIdsKey), [updateHubIdsKey]);
const operationalRegistryHubs = useMemo(() => deriveOperationalHubs(registryHubs), [registryHubs]);
```

On Hub menu open, call WheelMaker update refresh with `updateHubIds`; call Flicker, HubConfig, NPM, Skills, and indexes with `operationalHubIds`.

Replace every non-update use of raw `registryHubs` with `operationalRegistryHubs`:

```ts
usageStore.retainHubs(operationalHubIds);
for (const hub of operationalRegistryHubs) {
  service.getHubState(hub.hubId, ['tokenStats']).then(state => {
    if (cancelled) return;
    const snapshot = parseHubSnapshot(state.sections.tokenStats?.data);
    if (snapshot) usageStore.replaceHub(hub.hubId, snapshot);
  }).catch(() => undefined);
}

const refreshUsageAcrossHubs = useCallback(
  () => Promise.allSettled(operationalRegistryHubs.map(hub =>
    service.refreshHubState(hub.hubId, ['tokenStats']).then(state => {
      const snapshot = parseHubSnapshot(state.sections.tokenStats?.data);
      if (snapshot) usageStore.replaceHub(hub.hubId, snapshot);
    }),
  )),
  [operationalRegistryHubs, usageStore],
);

refreshTerminalLists(deriveOperationalHubs(result.hubs)).catch(() => undefined);
const portRelayHubIds = deriveRegistryHubIds(operationalRegistryHubs);
```

Keep raw `registryHubs` only for Hub directory display, `chatHubTreeItems`, and `deriveUpdateHubIds`. This prevents restricted Hubs from entering usage, Terminal, Port Relay, config, Skills, NPM, index, release-target, or other operational selectors.

In the Registry event handler, before Project events:

```ts
if (event.method === RegistryMethods.RegistryHubUpdated) {
  const payload = event.payload as RegistryHubUpdatedPayload | undefined;
  if (!payload?.hub?.hubId || typeof payload.online !== 'boolean') return;
  setRegistryHubs(current => applyRegistryHubUpdated(current, payload));
  return;
}
```

When an accepted update causes an offline event, keep the existing per-Hub update view only while its job is active; remove all non-update cached views for that Hub. A later `online:true` descriptor drives either restricted retry UI or normal restoration.

- [ ] **Step 7: Add a source-structure regression test for scan separation**

In `app/__tests__/web-agent-package-update-settings.test.ts`, assert the Hub-menu effect contains:

```ts
expect(menuEffect).toContain('refreshWheelMakerUpdatesRef.current?.(updateHubIds, {silent: true})');
expect(menuEffect).toContain('refreshAgentPackagesRef.current?.(operationalHubIds, {silent: true})');
expect(menuEffect).toContain('refreshProjectFileIndexesRef.current?.(operationalHubIds, {silent: true})');
expect(menuEffect).not.toContain('refreshAgentPackagesRef.current?.(updateHubIds');
expect(mainTsx).toContain('for (const hub of operationalRegistryHubs)');
expect(mainTsx).toContain('refreshTerminalLists(deriveOperationalHubs(result.hubs))');
expect(mainTsx).toContain('deriveRegistryHubIds(operationalRegistryHubs)');
```

Also assert `RegistryHubUpdated` updates `registryHubs` through `applyRegistryHubUpdated`.

- [ ] **Step 8: Run the App data-flow tests**

Run:

```powershell
npm test -- web-agent-package-update-service.test.ts web-agent-package-update-view.test.ts web-agent-package-update-settings.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the App data path**

```powershell
git add app/web/src/registry/RegistryRepository.ts app/web/src/settings/agentPackageUpdateView.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-agent-package-update-service.test.ts app/__tests__/web-agent-package-update-view.test.ts app/__tests__/web-agent-package-update-settings.test.ts
git commit -m "feat(app): track update-only hub directory state"
```

### Task 5: Render restricted Hubs with only the update action

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/shell.css`

- [ ] **Step 1: Write the failing restricted-row component test**

Add to `app/web/src/app/ChatHubMenu.test.tsx`:

```tsx
test('update-only hub renders incompatibility state and only the update action', async () => {
  const {props, callbacks} = createHarness({
    hubIds: ['hub-old'],
    treeItems: [{
      hubId: 'hub-old',
      projects: [],
      connectionMode: 'update_only',
      protocolVersion: '2.5',
      supportedProtocolVersion: '2.6',
    }],
    opsByHubId: {'hub-old': opsView()},
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });

  expect(renderer.root.findByProps({className: 'chat-hub-restricted-state'}).children)
    .toEqual(['Version incompatible · update required']);
  expect(renderer.root.findAllByProps({className: 'chat-hub-expand-button'})).toHaveLength(0);
  expect(sectionHeaders(renderer.root)).toHaveLength(0);
  expect(renderer.root.findAllByProps({className: 'chat-hub-line-label'})).toHaveLength(0);

  act(() => {
    renderer.root.findByProps({className: 'chat-hub-action chat-hub-version-action'}).props.onClick();
  });
  expect(callbacks.onRequestWheelMakerUpdate).toHaveBeenCalledWith('hub-old');
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```powershell
npm test -- ChatHubMenu.test.tsx
```

Expected: FAIL because the tree item has no connection mode and the full Hub sections render.

- [ ] **Step 3: Pass Hub descriptor fields into tree items**

In `WorkspaceApp.tsx`, build a descriptor map and include mode/version fields:

```ts
const registryHubById = useMemo(
  () => new Map(registryHubs.map(hub => [hub.hubId, hub])),
  [registryHubs],
);

const chatHubTreeItems = useMemo(() => {
  return hubIds.map(hubId => {
    const descriptor = registryHubById.get(hubId);
    return {
      hubId,
      projects: sortedProjectItems.filter(projectItem => projectHubId(projectItem) === hubId),
      connectionMode: descriptor?.connectionMode ?? 'normal',
      protocolVersion: descriptor?.protocolVersion ?? RegistryProtocolVersion,
      supportedProtocolVersion: descriptor?.supportedProtocolVersion ?? RegistryProtocolVersion,
    };
  });
}, [registryHubById, sortedProjectItems]);
```

Do not include restricted Hub IDs in default expanded state.

- [ ] **Step 4: Render an early restricted branch**

Extend the `ChatHubTreeItem` type in `ChatHubMenu.tsx` with the descriptor fields. In `ChatHubBlock`, before normal settings/sections:

```tsx
if (treeItem.connectionMode === 'update_only') {
  return (
    <div className="chat-hub-tree chat-hub-tree-restricted" style={hubAccentStyle(hubId)}>
      <div className="chat-hub-row">
        <span className="chat-hub-row-name">{hubId}</span>
        <span className="chat-hub-restricted-state">Version incompatible · update required</span>
        <button
          type="button"
          className="chat-hub-action chat-hub-version-action"
          aria-label={`${ops.wheelMaker.actionLabel} ${ops.wheelMaker.currentVersion}`}
          disabled={!ops.wheelMaker.actionVisible || ops.wheelMaker.pending}
          onClick={() => onRequestWheelMakerUpdate(hubId)}
        >
          <span className="chat-hub-action-label">{ops.wheelMaker.currentVersion}</span>
          <Icon name={ops.wheelMaker.pending ? 'loader' : 'cloudDownload'} spin={ops.wheelMaker.pending} />
        </button>
      </div>
    </div>
  );
}
```

This early return must occur before color, expand, Settings, NPM, MCP, Skills, Project visibility, and index controls are created.

- [ ] **Step 5: Add restrained styling**

In `app/web/src/styles/shell.css`, next to existing `chat-hub-row` styles:

```css
.chat-hub-tree-restricted .chat-hub-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.chat-hub-restricted-state {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}
```

Reuse existing Hub row colors, button states, and update icon; do not add a modal or a second update surface.

- [ ] **Step 6: Run the focused UI tests**

Run:

```powershell
npm test -- ChatHubMenu.test.tsx web-agent-package-update-settings.test.ts
```

Expected: PASS; normal Hub row tests remain unchanged.

- [ ] **Step 7: Commit the restricted UI**

```powershell
git add app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css
git commit -m "feat(app): restrict incompatible hubs to update action"
```

### Task 6: Run cross-layer regression suites

**Files:**
- Verify: `server/internal/protocol`
- Verify: `server/internal/registry`
- Verify: `server/internal/hub`
- Verify: focused App Registry/update/Hub-menu tests
- Verify: approved spec and synchronized Wiki

- [ ] **Step 1: Format Go production and test files**

Run from repository root:

```powershell
gofmt -w server/internal/protocol/registry.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/hub_maintenance.go server/internal/registry/server.go server/internal/registry/server_test.go server/internal/hub/maintenance.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
```

Expected: command exits successfully and `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Run the complete affected Go package suites**

Run from `server/`:

```powershell
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
```

Expected: PASS.

- [ ] **Step 3: Run the complete focused App suite**

Run from `app/`:

```powershell
npm test -- web-registry-protocol-domain-service.test.ts web-agent-package-update-service.test.ts web-agent-package-update-view.test.ts web-agent-package-update-settings.test.ts ChatHubMenu.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run type checking and production build**

Run from `app/`:

```powershell
npm run tsc:web
npm run build:web
```

Expected: both commands succeed; build output goes to `~/.wheelmaker/web`, not `app/dist`.

- [ ] **Step 5: Verify protocol and scope invariants**

Run from repository root:

```powershell
rg -n \"DefaultProtocolVersion =|RegistryProtocolVersion =\" server/internal/protocol/registry.go app/web/src/registry/registryMethods.ts
rg -n \"maintenanceProtocolVersion|update_only|hub\\.maintenance\\.update|registry\\.hub\\.updated\" server app docs/wiki docs/scope/2026-07-31-update-only-hub --glob '!**/dist/**'
git diff --check
git status --short
```

Expected:

- Main protocol remains `2.6` in Go and TypeScript.
- Maintenance v1 and update-only symbols appear in implementation, tests, spec, and both approved Wiki pages.
- No source file grants restricted Hubs Project, Session, HubState, HubConfig, Skills, release, Debug Web, Relay, terminal, file, or Git forwarding.
- Only intended task files are modified.

- [ ] **Step 6: Commit any formatting-only changes**

If formatting changed tracked files after Task 5:

```powershell
git add server app
git commit -m "style: format update-only hub implementation"
```

If `git status --short` is clean, record this step as completed without creating an empty commit.

- [ ] **Step 7: Rebase, re-run smoke tests, and push**

```powershell
git fetch origin
git rebase origin/main
Set-Location server
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
Set-Location ../app
npm test -- web-registry-protocol-domain-service.test.ts web-agent-package-update-service.test.ts web-agent-package-update-view.test.ts web-agent-package-update-settings.test.ts ChatHubMenu.test.tsx
Set-Location ..
git push --force-with-lease origin feat/update-only-hub
```

Expected: rebase succeeds without semantic conflict, both smoke suites pass, and the feature branch is updated. If a conflict has ambiguous semantics, stop and ask the user rather than choosing a side.
