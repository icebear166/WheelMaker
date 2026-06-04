# HubState Protocol Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable HubState slice: protocol constants, envelope `hubId`, Registry forwarding, Hub-owned state manager, current-tool adapters, and App repository methods.

**Architecture:** Keep Registry as a router. Hub owns `HubState` through a focused `HubStateManager` with section handlers wired by `Reporter`. Old `cmd.*` and `fs.index.*` methods remain compatible while new App code can call `hub.state.*`.

**Tech Stack:** Go server (`internal/protocol`, `internal/registry`, `internal/hub`), React/TypeScript App registry layer, existing Go tests and App Jest tests.

---

## Scope Boundary

This plan implements the first independently testable slice of the spec:

- Add top-level `hubId` to Registry envelopes and batch subrequests.
- Add `hub.state.get`, `hub.state.refresh`, `hub.state.action`, and `hub.state.updated`.
- Route HubState requests through Registry by envelope `hubId`.
- Add Hub-owned in-memory `HubStateManager`.
- Wire HubState sections to existing NPM, update, skills, token, and file-index logic.
- Add App protocol constants and repository methods.

This plan does not migrate the Settings UI yet. After this lands, the next plan should migrate Update, Skills, Token Stats, and file-index UI flows onto the new repository methods.

## File Structure

- Modify `server/internal/protocol/registry.go`: add `HubID` to `Envelope`.
- Modify `server/internal/protocol/registry_methods.go`: register HubState methods and add route/helper support.
- Modify `server/internal/protocol/registry_methods_test.go`: descriptor coverage for HubState.
- Modify `server/internal/registry/server.go`: parse/write `hubId`, route `hub.state.*`, pass `hubId` through batch.
- Modify `server/internal/registry/server_test.go`: Registry forwarding tests for envelope `hubId`.
- Create `server/internal/hub/hub_state.go`: HubState types, section status aggregation, manager dispatch.
- Create `server/internal/hub/hub_state_test.go`: unit tests for manager behavior.
- Create `server/internal/hub/hub_state_adapters.go`: section handlers that reuse existing tools/file-index logic.
- Modify `server/internal/hub/reporter.go`: instantiate manager and handle `hub.state.*` requests.
- Modify `server/internal/hub/hub_test.go`: Reporter integration tests for HubState methods.
- Create `app/web/src/registry/registryMethods.ts`: App-side protocol constants.
- Modify `app/web/src/registry/registryTypes.ts`: add HubState types and envelope `hubId`.
- Modify `app/web/src/registry/RegistryClient.ts`: allow request-level `hubId`.
- Modify `app/web/src/registry/RegistryRepository.ts`: add HubState methods using constants.
- Create `app/__tests__/web-hub-state-service.test.ts`: App repository tests for HubState requests.

## Task 1: Protocol Constants And Envelope `hubId`

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`

- [ ] **Step 1: Write failing protocol descriptor tests**

Append this test to `server/internal/protocol/registry_methods_test.go`:

```go
func TestRegistryHubStateMethodsRequireHubID(t *testing.T) {
	methods := []string{
		RegistryMethodHubStateGet,
		RegistryMethodHubStateRefresh,
		RegistryMethodHubStateAction,
	}
	for _, method := range methods {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("method %q is not registered", method)
		}
		if desc.Route != RegistryRouteHubState {
			t.Fatalf("%s route=%q, want %q", method, desc.Route, RegistryRouteHubState)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s should require hubId", method)
		}
		if !RegistryMethodAllowed(string(RegistryRoleClient), method) {
			t.Fatalf("%s should allow client role", method)
		}
		if !desc.Batchable {
			t.Fatalf("%s should be batchable", method)
		}
	}

	updated, ok := RegistryMethod(RegistryMethodHubStateUpdated)
	if !ok {
		t.Fatal("hub.state.updated is not registered")
	}
	if updated.Route != RegistryRouteClientEvent {
		t.Fatalf("hub.state.updated route=%q, want client event", updated.Route)
	}
}
```

- [ ] **Step 2: Run the failing protocol test**

Run:

```powershell
cd server
go test ./internal/protocol -run TestRegistryHubStateMethodsRequireHubID -count=1
```

Expected: FAIL because `RegistryMethodHubStateGet` and `RegistryRouteHubState` are undefined.

- [ ] **Step 3: Add `HubID` to shared envelope**

In `server/internal/protocol/registry.go`, change `Envelope` to:

```go
type Envelope struct {
	RequestID int64           `json:"requestId,omitempty"`
	Type      string          `json:"type"`
	Method    string          `json:"method,omitempty"`
	HubID     string          `json:"hubId,omitempty"`
	ProjectID string          `json:"projectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}
```

- [ ] **Step 4: Add HubState method constants and descriptor helpers**

In `server/internal/protocol/registry_methods.go`, add route constant:

```go
RegistryRouteHubState RegistryRouteKind = "hub_state"
```

Add method constants near the other `hub.*` constants:

```go
RegistryMethodHubStateGet     = "hub.state.get"
RegistryMethodHubStateRefresh = "hub.state.refresh"
RegistryMethodHubStateAction  = "hub.state.action"
RegistryMethodHubStateUpdated = "hub.state.updated"
```

Register descriptors:

```go
RegistryMethodHubStateGet:     registryHubStateMethod(RegistryMethodHubStateGet),
RegistryMethodHubStateRefresh: registryHubStateMethod(RegistryMethodHubStateRefresh),
RegistryMethodHubStateAction:  registryHubStateMethod(RegistryMethodHubStateAction),
RegistryMethodHubStateUpdated: registryClientEventMethod(RegistryMethodHubStateUpdated),
```

Add helper:

```go
func registryHubStateMethod(method string) RegistryMethodDescriptor {
	desc := registryMethod(method, RegistryRouteHubState, []RegistryRole{RegistryRoleClient})
	desc.RequiresHubID = true
	desc.Batchable = true
	return desc
}
```

Add query helper:

```go
func RegistryHubStateMethod(method string) bool {
	return RegistryMethodHasRoute(method, RegistryRouteHubState)
}
```

- [ ] **Step 5: Run protocol tests**

Run:

```powershell
cd server
go test ./internal/protocol -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add server/internal/protocol/registry.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go
git commit -m "feat: add hub state protocol descriptors"
```

## Task 2: Registry Envelope Parsing, Batch `hubId`, And Forwarding

**Files:**
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing Registry tests**

Update `testEnvelope` at the top of `server/internal/registry/server_test.go`:

```go
type testEnvelope struct {
	RequestID int64          `json:"requestId,omitempty"`
	Type      string         `json:"type"`
	Method    string         `json:"method,omitempty"`
	HubID     string         `json:"hubId,omitempty"`
	ProjectID string         `json:"projectId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}
```

Append these tests to `server/internal/registry/server_test.go`:

```go
func TestHubStateGetForwardsByEnvelopeHubID(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-state")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.3",
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.state.get",
		HubID:     "hub-state",
		Payload:   map[string]any{"sections": []any{"agentPackages"}},
	})

	_ = hub.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Type != "request" || forwarded.Method != "hub.state.get" {
		t.Fatalf("forwarded=%#v, want hub.state.get request", forwarded)
	}
	if forwarded.HubID != "hub-state" {
		t.Fatalf("forwarded hubId=%q, want hub-state", forwarded.HubID)
	}
	if forwarded.ProjectID != "" {
		t.Fatalf("forwarded projectId=%q, want empty", forwarded.ProjectID)
	}

	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "hub.state.get",
		HubID:     "hub-state",
		Payload: map[string]any{
			"state": map[string]any{
				"hubId":    "hub-state",
				"status":   "empty",
				"sections": map[string]any{},
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
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.3",
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.state.get",
		Payload:   map[string]any{},
	})
	resp := mustReadEnvelope(t, client)
	if resp.Type != "error" || resp.Method != "hub.state.get" {
		t.Fatalf("response=%#v, want hub.state.get error", resp)
	}
	payload := resp.Payload
	if payload["code"] != "INVALID_ARGUMENT" {
		t.Fatalf("payload=%#v, want INVALID_ARGUMENT", payload)
	}
}

func TestBatchHubStateSubrequestCarriesEnvelopeHubID(t *testing.T) {
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	hub := dialReportedHub(t, ts.URL+"/ws", "hub-batch-state")
	defer hub.Close()

	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 1,
		Type:      "request",
		Method:    "connect.init",
		Payload: map[string]any{
			"clientName":      "wm-web",
			"clientVersion":   "0.1.0",
			"protocolVersion": "2.3",
			"role":            "client",
		},
	})
	_ = mustReadEnvelope(t, client)

	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "batch",
		Payload: map[string]any{
			"requests": []map[string]any{
				{
					"method": "hub.state.get",
					"hubId":  "hub-batch-state",
					"payload": map[string]any{
						"sections": []any{"tokenStats"},
					},
				},
			},
		},
	})

	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != "hub.state.get" || forwarded.HubID != "hub-batch-state" {
		t.Fatalf("forwarded=%#v, want hub.state.get with hubId", forwarded)
	}
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: forwarded.RequestID,
		Type:      "response",
		Method:    "hub.state.get",
		HubID:     "hub-batch-state",
		Payload: map[string]any{
			"state": map[string]any{"hubId": "hub-batch-state", "status": "empty", "sections": map[string]any{}},
		},
	})
	resp := mustReadEnvelope(t, client)
	responses, _ := resp.Payload["responses"].([]any)
	if len(responses) != 1 {
		t.Fatalf("responses=%#v, want one response", resp.Payload["responses"])
	}
	item := responses[0].(map[string]any)
	if item["hubId"] != "hub-batch-state" {
		t.Fatalf("batch item=%#v, want hubId", item)
	}
}
```

- [ ] **Step 2: Run the failing Registry tests**

Run:

```powershell
cd server
go test ./internal/registry -run "TestHubState(GetForwards|Missing|Batch)" -count=1
```

Expected: FAIL because `hubId` is not parsed or routed.

- [ ] **Step 3: Parse `hubId` in Registry envelopes**

In `server/internal/registry/server.go`, update `readEnvelope` raw struct and output:

```go
type rawEnvelope struct {
	RequestID json.RawMessage `json:"requestId,omitempty"`
	Type      string          `json:"type"`
	Method    string          `json:"method,omitempty"`
	HubID     string          `json:"hubId,omitempty"`
	ProjectID string          `json:"projectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}
```

Set output:

```go
out := envelope{
	Type:      raw.Type,
	Method:    raw.Method,
	HubID:     raw.HubID,
	ProjectID: raw.ProjectID,
	Payload:   raw.Payload,
}
```

- [ ] **Step 4: Route HubState requests through Registry**

In the main request switch in `server/internal/registry/server.go`, add before `RegistryHubCommandMethod`:

```go
case rp.RegistryHubStateMethod(in.Method):
	go s.handleHubStateForwardRequest(state.peer, state, in)
```

Add functions:

```go
func (s *Server) handleHubStateForwardRequest(clientPeer *peerConn, state *connectionState, in envelope) {
	resp := s.executeHubStateRequest(state, in)
	resp.RequestID = in.RequestID
	_ = clientPeer.write(resp)
}

func (s *Server) executeHubStateRequest(state *connectionState, in envelope) envelope {
	hubID := strings.TrimSpace(in.HubID)
	if hubID == "" {
		return s.errorEnvelope(in.Method, codeInvalidArgument, "hubId is required", nil)
	}
	if state.scopeHubID != "" && hubID != state.scopeHubID {
		return s.errorEnvelope(in.Method, codeForbidden, "hub out of client scope", map[string]any{"hubId": hubID})
	}

	s.mu.RLock()
	hub := s.hubs[hubID]
	hubPeer := s.hubPeers[hubID]
	s.mu.RUnlock()
	if hub.HubID == "" {
		return s.errorEnvelope(in.Method, codeNotFound, "hub not found", map[string]any{"hubId": hubID})
	}
	if hubPeer == nil {
		return s.errorEnvelope(in.Method, codeUnavailable, "hub offline", map[string]any{"hubId": hubID})
	}

	forwardID := s.nextForwardID.Add(1)
	waitCh := hubPeer.registerPending(forwardID)
	err := hubPeer.write(envelope{
		RequestID: forwardID,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    in.Method,
		HubID:     hubID,
		Payload:   in.Payload,
	})
	if err != nil {
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeInternal, "forward request write failed", nil)
	}

	select {
	case resp, ok := <-waitCh:
		if !ok {
			return s.errorEnvelope(in.Method, codeInternal, "hub disconnected", nil)
		}
		resp.HubID = hubID
		return resp
	case <-time.After(defaultRequestTimeout):
		hubPeer.resolvePending(forwardID, envelope{})
		return s.errorEnvelope(in.Method, codeTimeout, "hub response timeout", nil)
	}
}
```

- [ ] **Step 5: Add batch `hubId` support**

In `handleBatch`, add `HubID` to `batchItem`:

```go
type batchItem struct {
	Method    string          `json:"method"`
	HubID     string          `json:"hubId,omitempty"`
	ProjectID string          `json:"projectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}
```

When building the subrequest:

```go
subResp := s.executeBatchRequest(state, envelope{
	Type:      rp.RegistryEnvelopeTypeRequest,
	Method:    item.Method,
	HubID:     item.HubID,
	ProjectID: item.ProjectID,
	Payload:   item.Payload,
})
```

When appending response:

```go
"hubId": subResp.HubID,
```

In `executeBatchRequest`, add a `case`:

```go
case rp.RegistryHubStateMethod(in.Method):
	if state.role != string(rp.RegistryRoleClient) {
		return s.errorEnvelope(in.Method, codeForbidden, "method not allowed for role", map[string]any{"role": state.role})
	}
	return s.executeHubStateRequest(state, in)
```

- [ ] **Step 6: Run Registry tests**

Run:

```powershell
cd server
go test ./internal/registry -run "TestHubState(GetForwards|Missing|Batch)|TestCmd" -count=1
```

Expected: PASS, including existing `cmd.*` compatibility tests.

- [ ] **Step 7: Commit Task 2**

```powershell
git add server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat: route hub state by envelope hub id"
```

## Task 3: HubState Manager Core

**Files:**
- Create: `server/internal/hub/hub_state.go`
- Create: `server/internal/hub/hub_state_test.go`

- [ ] **Step 1: Write failing HubState manager tests**

Create `server/internal/hub/hub_state_test.go`:

```go
package hub

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestHubStateManagerGetStartsEmpty(t *testing.T) {
	manager := newHubStateManager("hub-a", nil)
	state := manager.get(nil)
	if state.HubID != "hub-a" || state.Status != hubStateStatusEmpty {
		t.Fatalf("state=%+v, want empty hub-a", state)
	}
	if len(state.Sections) != 0 {
		t.Fatalf("sections=%+v, want empty", state.Sections)
	}
}

func TestHubStateManagerRefreshUpdatesOneSection(t *testing.T) {
	now := time.Date(2026, 6, 5, 10, 0, 0, 0, time.UTC)
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]any{"ok": true, "providers": []any{}}, nil
			},
		},
	})
	manager.now = func() time.Time { return now }

	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	section := state.Sections[hubStateSectionTokenStats]
	if state.Status != hubStateStatusReady || section.Status != hubStateSectionStatusReady {
		t.Fatalf("state=%+v section=%+v, want ready", state, section)
	}
	if section.Data == nil || section.UpdatedAt != now.Format(time.RFC3339) {
		t.Fatalf("section=%+v, want data and updatedAt", section)
	}
}

func TestHubStateManagerRefreshFailureKeepsPreviousData(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]any{"ok": true}, nil
			},
		},
	})
	if _, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	manager.handlers[hubStateSectionTokenStats] = hubStateSectionHandler{
		Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
			return nil, errors.New("token scan failed")
		},
	}
	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("second refresh should return state, got err=%v", err)
	}
	section := state.Sections[hubStateSectionTokenStats]
	if section.Status != hubStateSectionStatusError || section.Data == nil || section.Error != "token scan failed" {
		t.Fatalf("section=%+v, want error with previous data", section)
	}
}

func TestHubStateManagerActionStoresActionResult(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(_ context.Context, action string, params map[string]any) (any, error) {
				if action != "install" || params["packageName"] != "@openai/codex" {
					t.Fatalf("action=%q params=%+v", action, params)
				}
				return map[string]any{"accepted": true}, nil
			},
		},
	})
	state, err := manager.action(context.Background(), hubStateSectionAgentPackages, "install", map[string]any{"packageName": "@openai/codex"})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	action := state.Sections[hubStateSectionAgentPackages].Action
	if action == nil || action.Name != "install" || action.Status != hubStateActionStatusSucceeded {
		t.Fatalf("action=%+v, want succeeded install", action)
	}
	if action.Result == nil {
		t.Fatalf("action=%+v, want result", action)
	}
}
```

- [ ] **Step 2: Run the failing manager tests**

Run:

```powershell
cd server
go test ./internal/hub -run TestHubStateManager -count=1
```

Expected: FAIL because `newHubStateManager` is undefined.

- [ ] **Step 3: Implement HubState types and manager**

Create `server/internal/hub/hub_state.go`:

```go
package hub

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

type hubStateStatus string

const (
	hubStateStatusEmpty      hubStateStatus = "empty"
	hubStateStatusReady      hubStateStatus = "ready"
	hubStateStatusRefreshing hubStateStatus = "refreshing"
	hubStateStatusPartial    hubStateStatus = "partial"
	hubStateStatusError      hubStateStatus = "error"
)

type hubStateSectionStatus string

const (
	hubStateSectionStatusEmpty      hubStateSectionStatus = "empty"
	hubStateSectionStatusReady      hubStateSectionStatus = "ready"
	hubStateSectionStatusRefreshing hubStateSectionStatus = "refreshing"
	hubStateSectionStatusError      hubStateSectionStatus = "error"
)

type hubStateActionStatus string

const (
	hubStateActionStatusRunning   hubStateActionStatus = "running"
	hubStateActionStatusSucceeded hubStateActionStatus = "succeeded"
	hubStateActionStatusFailed    hubStateActionStatus = "failed"
)

const (
	hubStateSectionAgentPackages    = "agentPackages"
	hubStateSectionWheelMakerUpdate = "wheelmakerUpdate"
	hubStateSectionSkills           = "skills"
	hubStateSectionTokenStats       = "tokenStats"
	hubStateSectionFileIndex        = "fileIndex"
)

type hubState struct {
	HubID     string                     `json:"hubId"`
	Status    hubStateStatus             `json:"status"`
	UpdatedAt string                     `json:"updatedAt,omitempty"`
	Sections  map[string]hubStateSection `json:"sections"`
}

type hubStateSection struct {
	Status    hubStateSectionStatus `json:"status"`
	UpdatedAt string                `json:"updatedAt,omitempty"`
	StartedAt string                `json:"startedAt,omitempty"`
	Error     string                `json:"error,omitempty"`
	Data      any                   `json:"data,omitempty"`
	Action    *hubStateAction       `json:"action,omitempty"`
}

type hubStateAction struct {
	ID         string               `json:"id"`
	Name       string               `json:"name"`
	Status     hubStateActionStatus `json:"status"`
	StartedAt  string               `json:"startedAt"`
	FinishedAt string               `json:"finishedAt,omitempty"`
	Error      string               `json:"error,omitempty"`
	Params     map[string]any       `json:"params,omitempty"`
	Result     any                  `json:"result,omitempty"`
}

type hubStateRefreshInput struct {
	HubID  string
	Force  bool
	Now    time.Time
	State  hubState
	Params map[string]any
}

type hubStateSectionHandler struct {
	Refresh func(context.Context, hubStateRefreshInput) (any, error)
	Action  func(context.Context, string, map[string]any) (any, error)
}

type HubStateManager struct {
	mu       sync.Mutex
	hubID    string
	state    hubState
	handlers map[string]hubStateSectionHandler
	now      func() time.Time
}

func newHubStateManager(hubID string, handlers map[string]hubStateSectionHandler) *HubStateManager {
	hubID = strings.TrimSpace(hubID)
	if hubID == "" {
		hubID = "wheelmaker-hub"
	}
	cp := make(map[string]hubStateSectionHandler, len(handlers))
	for key, handler := range handlers {
		key = strings.TrimSpace(key)
		if key != "" {
			cp[key] = handler
		}
	}
	return &HubStateManager{
		hubID:    hubID,
		handlers: cp,
		now:      func() time.Time { return time.Now().UTC() },
		state: hubState{
			HubID:    hubID,
			Status:   hubStateStatusEmpty,
			Sections: map[string]hubStateSection{},
		},
	}
}

func (m *HubStateManager) get(sections []string) hubState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked(normalizeHubStateSections(sections))
}

func (m *HubStateManager) refresh(ctx context.Context, sections []string, force bool) (hubState, error) {
	sections = normalizeHubStateSections(sections)
	if len(sections) == 0 {
		return hubState{}, fmt.Errorf("sections are required")
	}
	for _, sectionName := range sections {
		handler, ok := m.handlers[sectionName]
		if !ok || handler.Refresh == nil {
			return hubState{}, fmt.Errorf("unsupported hub state section %q", sectionName)
		}
		startedAt := m.now().UTC().Format(time.RFC3339)
		m.mu.Lock()
		current := m.state.Sections[sectionName]
		current.Status = hubStateSectionStatusRefreshing
		current.StartedAt = startedAt
		current.Error = ""
		m.state.Sections[sectionName] = current
		m.recomputeLocked()
		input := hubStateRefreshInput{HubID: m.hubID, Force: force, Now: m.now().UTC(), State: m.snapshotLocked(nil)}
		m.mu.Unlock()

		data, err := handler.Refresh(ctx, input)
		finishedAt := m.now().UTC().Format(time.RFC3339)
		m.mu.Lock()
		next := m.state.Sections[sectionName]
		next.UpdatedAt = finishedAt
		next.StartedAt = ""
		if err != nil {
			next.Status = hubStateSectionStatusError
			next.Error = err.Error()
		} else {
			next.Status = hubStateSectionStatusReady
			next.Error = ""
			next.Data = data
		}
		m.state.Sections[sectionName] = next
		m.recomputeLocked()
		m.mu.Unlock()
	}
	return m.get(nil), nil
}

func (m *HubStateManager) action(ctx context.Context, sectionName string, actionName string, params map[string]any) (hubState, error) {
	sectionName = strings.TrimSpace(sectionName)
	actionName = strings.TrimSpace(actionName)
	if sectionName == "" || actionName == "" {
		return hubState{}, fmt.Errorf("section and action are required")
	}
	handler, ok := m.handlers[sectionName]
	if !ok || handler.Action == nil {
		return hubState{}, fmt.Errorf("unsupported hub state action %s.%s", sectionName, actionName)
	}
	startedAt := m.now().UTC()
	action := &hubStateAction{
		ID:        fmt.Sprintf("%s-%d", actionName, startedAt.UnixNano()),
		Name:      actionName,
		Status:    hubStateActionStatusRunning,
		StartedAt: startedAt.Format(time.RFC3339),
		Params:    cloneHubStateParams(params),
	}
	m.mu.Lock()
	section := m.state.Sections[sectionName]
	section.Status = hubStateSectionStatusRefreshing
	section.StartedAt = action.StartedAt
	section.Error = ""
	section.Action = action
	m.state.Sections[sectionName] = section
	m.recomputeLocked()
	m.mu.Unlock()

	result, err := handler.Action(ctx, actionName, cloneHubStateParams(params))
	finishedAt := m.now().UTC().Format(time.RFC3339)
	m.mu.Lock()
	section = m.state.Sections[sectionName]
	section.StartedAt = ""
	if section.Action != nil {
		section.Action.FinishedAt = finishedAt
		section.Action.Result = result
		if err != nil {
			section.Action.Status = hubStateActionStatusFailed
			section.Action.Error = err.Error()
			section.Status = hubStateSectionStatusError
			section.Error = err.Error()
		} else {
			section.Action.Status = hubStateActionStatusSucceeded
			section.Status = hubStateSectionStatusReady
			section.Error = ""
			if result != nil {
				section.Data = result
			}
			section.UpdatedAt = finishedAt
		}
	}
	m.state.Sections[sectionName] = section
	m.recomputeLocked()
	m.mu.Unlock()
	return m.get(nil), nil
}

func (m *HubStateManager) snapshotLocked(sections []string) hubState {
	out := hubState{
		HubID:     m.state.HubID,
		Status:    m.state.Status,
		UpdatedAt: m.state.UpdatedAt,
		Sections:  map[string]hubStateSection{},
	}
	allowed := map[string]bool{}
	for _, section := range sections {
		allowed[section] = true
	}
	for name, section := range m.state.Sections {
		if len(allowed) > 0 && !allowed[name] {
			continue
		}
		out.Sections[name] = section
	}
	return out
}

func (m *HubStateManager) recomputeLocked() {
	m.state.Status = deriveHubStateStatus(m.state.Sections)
	m.state.UpdatedAt = newestHubStateUpdatedAt(m.state.Sections)
}

func deriveHubStateStatus(sections map[string]hubStateSection) hubStateStatus {
	if len(sections) == 0 {
		return hubStateStatusEmpty
	}
	ready := 0
	errorCount := 0
	for _, section := range sections {
		if section.Status == hubStateSectionStatusRefreshing || (section.Action != nil && section.Action.Status == hubStateActionStatusRunning) {
			return hubStateStatusRefreshing
		}
		switch section.Status {
		case hubStateSectionStatusReady:
			ready++
		case hubStateSectionStatusError:
			errorCount++
		}
	}
	if ready == len(sections) {
		return hubStateStatusReady
	}
	if errorCount == len(sections) {
		return hubStateStatusError
	}
	if ready > 0 || errorCount > 0 {
		return hubStateStatusPartial
	}
	return hubStateStatusEmpty
}

func newestHubStateUpdatedAt(sections map[string]hubStateSection) string {
	values := []string{}
	for _, section := range sections {
		if section.UpdatedAt != "" {
			values = append(values, section.UpdatedAt)
		}
	}
	sort.Strings(values)
	if len(values) == 0 {
		return ""
	}
	return values[len(values)-1]
}

func normalizeHubStateSections(sections []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, section := range sections {
		section = strings.TrimSpace(section)
		if section == "" || seen[section] {
			continue
		}
		seen[section] = true
		out = append(out, section)
	}
	return out
}

func cloneHubStateParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return nil
	}
	out := make(map[string]any, len(params))
	for key, value := range params {
		out[key] = value
	}
	return out
}
```

- [ ] **Step 4: Run HubState manager tests**

Run:

```powershell
cd server
go test ./internal/hub -run TestHubStateManager -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add server/internal/hub/hub_state.go server/internal/hub/hub_state_test.go
git commit -m "feat: add hub state manager"
```

## Task 4: HubState Section Adapters

**Files:**
- Create: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Add adapter tests**

Append to `server/internal/hub/hub_test.go`:

```go
func TestHubStateToolAdaptersMapSectionsToExistingCommands(t *testing.T) {
	toolHandler := &stubToolCommandHandler{response: map[string]any{"ok": true}}
	reporter := NewReporter(ReporterConfig{HubID: "hub-state-adapter", MonitorBaseDir: t.TempDir()}, nil)
	reporter.toolHandler = toolHandler

	handlers := reporter.hubStateSectionHandlers()
	refreshCases := []struct {
		section string
		method  string
		action  string
	}{
		{hubStateSectionAgentPackages, "cmd.npm", "scan"},
		{hubStateSectionWheelMakerUpdate, "cmd.update", "query"},
		{hubStateSectionSkills, "cmd.skills", "scan"},
		{hubStateSectionTokenStats, "cmd.token", "scan"},
	}
	for _, tc := range refreshCases {
		if _, err := handlers[tc.section].Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-state-adapter"}); err != nil {
			t.Fatalf("%s refresh: %v", tc.section, err)
		}
		method, payload, _ := toolHandler.snapshot()
		if method != tc.method || !strings.Contains(payload, `"action":"`+tc.action+`"`) || !strings.Contains(payload, `"hubId":"hub-state-adapter"`) {
			t.Fatalf("%s tool method=%q payload=%s", tc.section, method, payload)
		}
	}
}

func TestHubStateFileIndexAdapterReturnsStatus(t *testing.T) {
	root := t.TempDir()
	reporter := NewReporter(ReporterConfig{HubID: "hub-file-index", MonitorBaseDir: t.TempDir()}, []ProjectInfo{
		{Name: "proj1", Path: root, Online: true},
	})
	handlers := reporter.hubStateSectionHandlers()
	data, err := handlers[hubStateSectionFileIndex].Refresh(context.Background(), hubStateRefreshInput{HubID: "hub-file-index"})
	if err != nil {
		t.Fatalf("fileIndex refresh: %v", err)
	}
	payload, ok := data.(projectFileIndexStatusResponse)
	if !ok {
		t.Fatalf("data=%T, want projectFileIndexStatusResponse", data)
	}
	if payload.HubID != "hub-file-index" || len(payload.Projects) != 1 {
		t.Fatalf("payload=%+v, want one project for hub-file-index", payload)
	}
}
```

- [ ] **Step 2: Run failing adapter tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestHubStateToolAdapters|TestHubStateFileIndexAdapter" -count=1
```

Expected: FAIL because `hubStateSectionHandlers` is undefined.

- [ ] **Step 3: Implement adapter wiring**

Create `server/internal/hub/hub_state_adapters.go`:

```go
package hub

import (
	"context"
	"encoding/json"
	"fmt"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func (r *Reporter) hubStateSectionHandlers() map[string]hubStateSectionHandler {
	return map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Refresh: r.refreshAgentPackagesState,
			Action:  r.actionAgentPackagesState,
		},
		hubStateSectionWheelMakerUpdate: {
			Refresh: r.refreshWheelMakerUpdateState,
			Action:  r.actionWheelMakerUpdateState,
		},
		hubStateSectionSkills: {
			Refresh: r.refreshSkillsState,
			Action:  r.actionSkillsState,
		},
		hubStateSectionTokenStats: {
			Refresh: r.refreshTokenStatsState,
		},
		hubStateSectionFileIndex: {
			Refresh: r.refreshFileIndexState,
			Action:  r.actionFileIndexState,
		},
	}
}

func (r *Reporter) refreshAgentPackagesState(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, map[string]any{"action": "scan", "hubId": input.HubID})
}

func (r *Reporter) actionAgentPackagesState(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "install":
		params["action"] = "install"
	case "installMany":
		params["action"] = "install_many"
	case "uninstall":
		params["action"] = "uninstall"
	default:
		return nil, fmt.Errorf("unsupported agentPackages action %q", action)
	}
	params["hubId"] = r.cfg.HubID
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, params)
}

func (r *Reporter) refreshWheelMakerUpdateState(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdUpdate, map[string]any{"action": "query", "hubId": input.HubID, "force": input.Force})
}

func (r *Reporter) actionWheelMakerUpdateState(ctx context.Context, action string, params map[string]any) (any, error) {
	if action != "updatePublish" {
		return nil, fmt.Errorf("unsupported wheelmakerUpdate action %q", action)
	}
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdUpdate, map[string]any{"action": "update-publish", "hubId": r.cfg.HubID})
}

func (r *Reporter) refreshSkillsState(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, map[string]any{"action": "scan", "hubId": input.HubID})
}

func (r *Reporter) actionSkillsState(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "listSource":
		params["action"] = "list"
	case "install", "uninstall", "update":
		params["action"] = action
	default:
		return nil, fmt.Errorf("unsupported skills action %q", action)
	}
	params["hubId"] = r.cfg.HubID
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, params)
}

func (r *Reporter) refreshTokenStatsState(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdToken, map[string]any{"action": "scan", "hubId": input.HubID})
}

func (r *Reporter) refreshFileIndexState(_ context.Context, input hubStateRefreshInput) (any, error) {
	resp := r.ensureFileIndexManager().status(r.projectFileIndexProjects())
	resp.HubID = input.HubID
	return resp, nil
}

func (r *Reporter) actionFileIndexState(_ context.Context, action string, params map[string]any) (any, error) {
	if action != "rebuild" {
		return nil, fmt.Errorf("unsupported fileIndex action %q", action)
	}
	projectID, _ := params["projectId"].(string)
	project, err := r.projectFileIndexProject(projectID)
	if err != nil {
		return nil, err
	}
	return r.ensureFileIndexManager().startRebuild(context.Background(), project), nil
}

func (r *Reporter) runHubStateTool(ctx context.Context, method string, payload map[string]any) (any, error) {
	handler := r.ensureToolHandler()
	handler.SetProjects(r.projectsSnapshot())
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	out, cmdErr := handler.Handle(ctx, method, raw)
	if cmdErr != nil {
		return nil, cmdErr
	}
	return out, nil
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestHubStateToolAdapters|TestHubStateFileIndexAdapter" -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add server/internal/hub/hub_state_adapters.go server/internal/hub/hub_test.go
git commit -m "feat: wire hub state section adapters"
```

## Task 5: Reporter HubState Request Handling

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Add Reporter integration tests**

Append to `server/internal/hub/hub_test.go`:

```go
func TestReporterRespondsToHubStateGet(t *testing.T) {
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
					"hubId":           "hub-state-get",
					"connectionEpoch": 1,
				},
				"serverInfo":     map[string]any{"serverVersion": "test", "protocolVersion": rp.DefaultProtocolVersion},
				"features":       map[string]any{},
				"hashAlgorithms": []string{"sha256"},
			},
		})
		reportReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{RequestID: reportReq.RequestID, Type: "response", Method: reportReq.Method, Payload: map[string]any{"ok": true}})
		mustWriteJSON(t, ws, testEnvelope{RequestID: 100, Type: "request", Method: "hub.state.get", HubID: "hub-state-get", Payload: map[string]any{}})
		respSeen <- mustReadEnvelope(t, ws)
	}))
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{Server: strings.TrimPrefix(ts.URL, "http://"), HubID: "hub-state-get", ReconnectInterval: 50 * time.Millisecond}, nil)
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
		if resp.Type != "response" || resp.Method != "hub.state.get" {
			t.Fatalf("response=%#v, want hub.state.get response", resp)
		}
		state, _ := resp.Payload["state"].(map[string]any)
		if state["hubId"] != "hub-state-get" || state["status"] != "empty" {
			t.Fatalf("state=%#v, want empty hub-state-get", state)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive hub.state.get response")
	}
}

func TestReporterRespondsToHubStateRefresh(t *testing.T) {
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
		mustWriteJSON(t, ws, testEnvelope{RequestID: initReq.RequestID, Type: "response", Method: "connect.init", Payload: map[string]any{
			"ok": true,
			"principal": map[string]any{"role": "hub", "hubId": "hub-state-refresh", "connectionEpoch": 1},
			"serverInfo": map[string]any{"serverVersion": "test", "protocolVersion": rp.DefaultProtocolVersion},
			"features": map[string]any{}, "hashAlgorithms": []string{"sha256"},
		}})
		reportReq := mustReadEnvelope(t, ws)
		mustWriteJSON(t, ws, testEnvelope{RequestID: reportReq.RequestID, Type: "response", Method: reportReq.Method, Payload: map[string]any{"ok": true}})
		mustWriteJSON(t, ws, testEnvelope{
			RequestID: 100,
			Type: "request",
			Method: "hub.state.refresh",
			HubID: "hub-state-refresh",
			Payload: map[string]any{"sections": []any{"tokenStats"}},
		})
		respSeen <- mustReadEnvelope(t, ws)
	}))
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	toolHandler := &stubToolCommandHandler{response: map[string]any{"ok": true, "providers": []any{}}}
	reporter := NewReporter(ReporterConfig{Server: strings.TrimPrefix(ts.URL, "http://"), HubID: "hub-state-refresh", ReconnectInterval: 50 * time.Millisecond}, nil)
	reporter.toolHandler = toolHandler
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
		if resp.Type != "response" || resp.Method != "hub.state.refresh" {
			t.Fatalf("response=%#v, want hub.state.refresh response", resp)
		}
		method, payload, _ := toolHandler.snapshot()
		if method != "cmd.token" || !strings.Contains(payload, `"action":"scan"`) {
			t.Fatalf("tool method=%q payload=%s", method, payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive hub.state.refresh response")
	}
}
```

- [ ] **Step 2: Run failing Reporter tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestReporterRespondsToHubState" -count=1
```

Expected: FAIL because Reporter does not dispatch HubState methods.

- [ ] **Step 3: Add manager field and initialization to Reporter**

In `server/internal/hub/reporter.go`, add field to `Reporter`:

```go
hubStateManager *HubStateManager
```

In `NewReporter`, after `r` is created and its fields are initialized:

```go
r.hubStateManager = newHubStateManager(r.cfg.HubID, r.hubStateSectionHandlers())
```

If `NewReporter` currently returns directly, refactor it to assign to `r`, initialize `hubStateManager`, then `return r`.

- [ ] **Step 4: Dispatch HubState requests**

In `handleRegistryRequest`, add:

```go
case rp.RegistryMethodHubStateGet:
	r.replyHubStateGet(conn, in)
case rp.RegistryMethodHubStateRefresh:
	r.replyHubStateRefresh(conn, in)
case rp.RegistryMethodHubStateAction:
	r.replyHubStateAction(conn, in)
```

Add payload structs and reply methods near other reply helpers:

```go
type hubStateGetPayload struct {
	Sections []string `json:"sections,omitempty"`
}

type hubStateRefreshPayload struct {
	Sections []string `json:"sections"`
	Force    bool     `json:"force,omitempty"`
}

type hubStateActionPayload struct {
	Section string         `json:"section"`
	Action  string         `json:"action"`
	Params  map[string]any `json:"params,omitempty"`
}

func (r *Reporter) replyHubStateGet(conn *websocket.Conn, req envelope) {
	var payload hubStateGetPayload
	if len(req.Payload) > 0 {
		if err := decodePayload(req.Payload, &payload); err != nil {
			_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid hub.state.get payload")
			return
		}
	}
	state := r.ensureHubStateManager().get(payload.Sections)
	_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, HubID: r.cfg.HubID, Payload: rp.MustRaw(map[string]any{"state": state})})
}

func (r *Reporter) replyHubStateRefresh(conn *websocket.Conn, req envelope) {
	var payload hubStateRefreshPayload
	if err := decodePayload(req.Payload, &payload); err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid hub.state.refresh payload")
		return
	}
	state, err := r.ensureHubStateManager().refresh(context.Background(), payload.Sections, payload.Force)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, err.Error())
		return
	}
	_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, HubID: r.cfg.HubID, Payload: rp.MustRaw(map[string]any{"state": state, "sections": payload.Sections})})
}

func (r *Reporter) replyHubStateAction(conn *websocket.Conn, req envelope) {
	var payload hubStateActionPayload
	if err := decodePayload(req.Payload, &payload); err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid hub.state.action payload")
		return
	}
	state, err := r.ensureHubStateManager().action(context.Background(), payload.Section, payload.Action, payload.Params)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, err.Error())
		return
	}
	_ = r.writeJSON(conn, "->", envelope{RequestID: req.RequestID, Type: rp.RegistryEnvelopeTypeResponse, Method: req.Method, HubID: r.cfg.HubID, Payload: rp.MustRaw(map[string]any{"state": state, "section": payload.Section})})
}

func (r *Reporter) ensureHubStateManager() *HubStateManager {
	if r.hubStateManager == nil {
		r.hubStateManager = newHubStateManager(r.cfg.HubID, r.hubStateSectionHandlers())
	}
	return r.hubStateManager
}
```

- [ ] **Step 5: Run Reporter tests**

Run:

```powershell
cd server
go test ./internal/hub -run "TestReporterRespondsToHubState|TestHubState" -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat: handle hub state reporter requests"
```

## Task 6: App Protocol Constants And Repository Methods

**Files:**
- Create: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Create: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Write failing App repository tests**

Create `app/__tests__/web-hub-state-service.test.ts`:

```ts
import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {RegistryMethods} from '../web/src/registry/registryMethods';
import type {RegistryClient} from '../web/src/registry/RegistryClient';

describe('HubState registry service', () => {
  test('gets hub state with envelope hubId', async () => {
    const calls: unknown[] = [];
    const client = {
      request: async (args: unknown) => {
        calls.push(args);
        return {
          payload: {
            state: {
              hubId: 'hub-a',
              status: 'empty',
              sections: {},
            },
          },
        };
      },
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const state = await repository.getHubState('hub-a', ['agentPackages']);

    expect(state.hubId).toBe('hub-a');
    expect(calls[0]).toEqual({
      method: RegistryMethods.HubStateGet,
      hubId: 'hub-a',
      payload: {sections: ['agentPackages']},
      timeoutMs: 15000,
    });
  });

  test('refreshes selected hub state sections', async () => {
    const calls: unknown[] = [];
    const client = {
      request: async (args: unknown) => {
        calls.push(args);
        return {
          payload: {
            state: {
              hubId: 'hub-a',
              status: 'ready',
              sections: {
                tokenStats: {status: 'ready', data: {ok: true, providers: []}},
              },
            },
          },
        };
      },
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    const state = await repository.refreshHubState('hub-a', ['tokenStats'], {force: true});

    expect(state.status).toBe('ready');
    expect(calls[0]).toEqual({
      method: RegistryMethods.HubStateRefresh,
      hubId: 'hub-a',
      payload: {sections: ['tokenStats'], force: true},
      timeoutMs: 60000,
    });
  });

  test('runs hub state section action', async () => {
    const calls: unknown[] = [];
    const client = {
      request: async (args: unknown) => {
        calls.push(args);
        return {
          payload: {
            state: {
              hubId: 'hub-a',
              status: 'ready',
              sections: {
                agentPackages: {
                  status: 'ready',
                  action: {id: 'install-1', name: 'install', status: 'succeeded', startedAt: '2026-06-05T10:00:00Z'},
                },
              },
            },
          },
        };
      },
    } as unknown as RegistryClient;
    const repository = new RegistryRepository(client);

    await repository.runHubStateAction('hub-a', 'agentPackages', 'install', {packageName: '@openai/codex', version: 'latest'});

    expect(calls[0]).toEqual({
      method: RegistryMethods.HubStateAction,
      hubId: 'hub-a',
      payload: {
        section: 'agentPackages',
        action: 'install',
        params: {packageName: '@openai/codex', version: 'latest'},
      },
      timeoutMs: 60000,
    });
  });
});
```

- [ ] **Step 2: Run failing App test**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-hub-state-service.test.ts
```

Expected: FAIL because `registryMethods.ts` and repository methods do not exist.

- [ ] **Step 3: Add App protocol constants**

Create `app/web/src/registry/registryMethods.ts`:

```ts
export const RegistryMethods = {
  ConnectInit: 'connect.init',
  ProjectList: 'project.list',
  HubStateGet: 'hub.state.get',
  HubStateRefresh: 'hub.state.refresh',
  HubStateAction: 'hub.state.action',
  HubStateUpdated: 'hub.state.updated',
} as const;

export type RegistryMethod = typeof RegistryMethods[keyof typeof RegistryMethods];
```

- [ ] **Step 4: Add HubState and envelope types**

In `app/web/src/registry/registryTypes.ts`, add `hubId` to `RegistryEnvelope`:

```ts
export interface RegistryEnvelope<TPayload = unknown> {
  requestId?: number;
  type: RegistryMessageType;
  method?: string;
  hubId?: string;
  projectId?: string;
  payload?: TPayload;
}
```

Add HubState types near existing registry state types:

```ts
export type RegistryHubStateStatus = 'empty' | 'ready' | 'refreshing' | 'partial' | 'error' | string;
export type RegistryHubStateSectionStatus = 'empty' | 'ready' | 'refreshing' | 'error' | string;
export type RegistryHubStateActionStatus = 'running' | 'succeeded' | 'failed' | string;
export type RegistryHubStateSectionName =
  | 'agentPackages'
  | 'wheelmakerUpdate'
  | 'skills'
  | 'tokenStats'
  | 'fileIndex'
  | string;

export interface RegistryHubStateAction {
  id: string;
  name: string;
  status: RegistryHubStateActionStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

export interface RegistryHubStateSection<TData = unknown> {
  status: RegistryHubStateSectionStatus;
  updatedAt?: string;
  startedAt?: string;
  error?: string;
  data?: TData;
  action?: RegistryHubStateAction;
}

export interface RegistryHubState {
  hubId: string;
  status: RegistryHubStateStatus;
  updatedAt?: string;
  sections: Record<string, RegistryHubStateSection>;
}
```

- [ ] **Step 5: Allow RegistryClient request `hubId`**

In `app/web/src/registry/RegistryClient.ts`, update request args:

```ts
async request(args: {
  method: string;
  payload: unknown;
  hubId?: string;
  projectId?: string;
  timeoutMs?: number;
}): Promise<RegistryEnvelope> {
```

Add to envelope construction:

```ts
...(args.hubId ? {hubId: args.hubId} : {}),
```

- [ ] **Step 6: Add repository methods**

In `app/web/src/registry/RegistryRepository.ts`, import constants and HubState types:

```ts
import {RegistryMethods} from './registryMethods';
```

Add type imports from `registryTypes`:

```ts
  RegistryHubState,
  RegistryHubStateSectionName,
```

Add methods in `RegistryRepository`:

```ts
  private normalizeHubState(raw: unknown, fallbackHubId: string): RegistryHubState {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const sectionsInput = input.sections && typeof input.sections === 'object'
      ? input.sections as Record<string, unknown>
      : {};
    const sections: RegistryHubState['sections'] = {};
    Object.entries(sectionsInput).forEach(([name, value]) => {
      const section = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      sections[name] = {
        status: typeof section.status === 'string' ? section.status : 'empty',
        updatedAt: typeof section.updatedAt === 'string' ? section.updatedAt : undefined,
        startedAt: typeof section.startedAt === 'string' ? section.startedAt : undefined,
        error: typeof section.error === 'string' ? section.error : undefined,
        data: section.data,
        action: section.action && typeof section.action === 'object'
          ? section.action as RegistryHubState['sections'][string]['action']
          : undefined,
      };
    });
    return {
      hubId: typeof input.hubId === 'string' && input.hubId ? input.hubId : fallbackHubId,
      status: typeof input.status === 'string' ? input.status : 'empty',
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
      sections,
    };
  }

  async getHubState(hubId: string, sections?: RegistryHubStateSectionName[]): Promise<RegistryHubState> {
    const payload = sections && sections.length > 0 ? {sections} : {};
    const resp = await this.client.request({
      method: RegistryMethods.HubStateGet,
      hubId,
      payload,
      timeoutMs: 15000,
    });
    const body = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(body.state, hubId);
  }

  async refreshHubState(
    hubId: string,
    sections: RegistryHubStateSectionName[],
    options: {force?: boolean} = {},
  ): Promise<RegistryHubState> {
    const resp = await this.client.request({
      method: RegistryMethods.HubStateRefresh,
      hubId,
      payload: {
        sections,
        ...(options.force === true ? {force: true} : {}),
      },
      timeoutMs: 60000,
    });
    const body = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(body.state, hubId);
  }

  async runHubStateAction(
    hubId: string,
    section: RegistryHubStateSectionName,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<RegistryHubState> {
    const resp = await this.client.request({
      method: RegistryMethods.HubStateAction,
      hubId,
      payload: {section, action, params},
      timeoutMs: 60000,
    });
    const body = (resp.payload ?? {}) as {state?: unknown};
    return this.normalizeHubState(body.state, hubId);
  }
```

- [ ] **Step 7: Run App tests**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-hub-state-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```powershell
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryClient.ts app/web/src/registry/RegistryRepository.ts app/__tests__/web-hub-state-service.test.ts
git commit -m "feat: add app hub state registry methods"
```

## Task 7: Full Verification

**Files:**
- Verify all files touched in Tasks 1-6.

- [ ] **Step 1: Run server targeted tests**

Run:

```powershell
cd server
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
```

Expected: PASS.

- [ ] **Step 2: Run App targeted tests**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-hub-state-service.test.ts __tests__/web-agent-package-update-service.test.ts __tests__/web-skill-management-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run repo status check**

Run:

```powershell
git status --short --branch
```

Expected: clean working tree after all task commits, on the current branch.

- [ ] **Step 4: Final integration commit if needed**

If verification required small fixes after the task commits, commit them:

```powershell
git add -A
git commit -m "test: verify hub state protocol foundation"
```

If no files changed, do not create an empty commit.

## Self-Review

Spec coverage in this first slice:

- Covered: envelope `hubId`, HubState methods, Registry routing, Hub-owned cache manager, section adapters, App constants, App repository methods.
- Covered as compatibility: existing `cmd.*`, `fs.index.status`, and `fs.index.rebuild` remain available while HubState is introduced.
- Not in this plan: Settings UI migration, broad `project.*` and `session.*` rename rollout, relay rename rollout, and final deletion of old public methods.

Placeholder scan:

- This plan contains no unresolved placeholder markers.
- Every task has concrete files, test snippets, implementation snippets, commands, and expected results.

Type consistency:

- Server method names use `RegistryMethodHubStateGet`, `RegistryMethodHubStateRefresh`, `RegistryMethodHubStateAction`, and `RegistryMethodHubStateUpdated`.
- App method names use `RegistryMethods.HubStateGet`, `RegistryMethods.HubStateRefresh`, and `RegistryMethods.HubStateAction`.
- Section names use `agentPackages`, `wheelmakerUpdate`, `skills`, `tokenStats`, and `fileIndex` in both Go and TypeScript.
