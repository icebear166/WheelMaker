# ACP Extension Boundary 2.7 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the capability-gating, strict-decoding, and diagnostic gaps without changing legacy Goal restoration or legacy transcript folding.

**Architecture:** Keep raw ACP `_meta` intact while carrying negotiated lifecycle authorization separately in the internal `AgentEvent`/WMT2 compatibility projection. Route all inbound ACP DTO decoding through one strict decoder, and preserve generic runtime errors instead of misclassifying them as invalid requests.

**Tech Stack:** Go 1.x, encoding/json, WheelMaker ACP/Registry types.

---

### Task 1: Gate lifecycle semantics while preserving raw metadata

**Files:**
- Modify: `server/internal/protocol/agent_event.go`
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing unnegotiated-lifecycle tests**

Add tests proving an Agent that did not negotiate lifecycle v1 retains raw `_meta`, but its `steered` and `messageComplete` values do not complete a queue item or finish a WMT2 message.

```go
event := received.AgentEvent
if !bytes.Equal(event.Update.(protocol.AgentMessageEvent).Meta, rawMeta) {
    t.Fatal("raw metadata was not preserved")
}
if event.MessageLifecycle {
    t.Fatal("unnegotiated lifecycle was authorized")
}
```

- [x] **Step 2: Run tests and verify RED**

```powershell
go test ./internal/hub/agent ./internal/hub/client -run 'UnnegotiatedMessageLifecycle|UnnegotiatedLifecycle' -count=1
```

Expected: FAIL because Session and Recorder currently interpret `_meta.wm` unconditionally.

- [x] **Step 3: Carry negotiated authorization in internal types**

```go
type AgentEvent struct {
    SessionID        string
    Update           AgentUpdate
    MessageLifecycle bool
}

type SessionUpdate struct {
    // Existing internal fields...
    MessageLifecycle *bool `json:"messageLifecycle,omitempty"`
}
```

`instance.HandleACPResponse` sets the event flag from `i.wmExtensions.MessageLifecycle`. `LegacySessionUpdate` writes the pointer while retaining `Update.Meta` unchanged. Nil means legacy WMT2; explicit false means preserve-only.

- [x] **Step 4: Gate Session and Recorder interpretation**

```go
interpretLifecycle := params.Update.MessageLifecycle == nil || *params.Update.MessageLifecycle
complete := interpretLifecycle && acp.SessionUpdateMetaMessageComplete(meta)
steered := params.Update.Steered || (interpretLifecycle && acp.SessionUpdateMetaSteered(meta))
```

Use the event flag for Steer queue completion. Do not delete or rewrite `_meta`.

- [x] **Step 5: Run lifecycle tests and verify GREEN**

```powershell
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client -run 'Lifecycle|MessagePhase|Steer' -count=1
```

Expected: PASS.

### Task 2: Make every inbound ACP DTO boundary strict

**Files:**
- Modify: `server/internal/protocol/acp_wire_update.go`
- Modify: `server/internal/protocol/acp_wire_update_test.go`
- Modify: `server/internal/hub/agent/conn_owned.go`
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing boundary tests**

```go
raw := json.RawMessage(`{"protocolVersion":1,"agentCapabilities":{},"legacy":true}`)
if err := protocol.DecodeStrictACPJSON(raw, &protocol.InitializeResult{}); err == nil {
    t.Fatal("unknown initialize result field was accepted")
}
```

Also send an unknown root field through `HandleACPRequest` and expect rejection.

- [x] **Step 2: Run tests and verify RED**

```powershell
go test ./internal/protocol ./internal/hub/agent -run 'StrictACP|RejectsUnknownCallback' -count=1
```

Expected: FAIL because the exported strict entrypoint does not exist and current boundaries use ordinary `json.Unmarshal`.

- [x] **Step 3: Export and apply the strict decoder**

```go
func DecodeStrictACPJSON(raw json.RawMessage, target any) error {
    return decodeStrict(raw, target)
}
```

Use it for owned-connection responses and envelopes, Instance callback params, and Codex bridge remarshal/result decoding. Existing custom `UnmarshalJSON` methods continue to validate discriminated unions.

- [x] **Step 4: Run strict-boundary tests and verify GREEN**

```powershell
go test ./internal/protocol ./internal/hub/agent -run 'StrictACP|RejectsUnknownCallback|Wire' -count=1
```

Expected: PASS.

### Task 3: Preserve diagnostics and runtime error classification

**Files:**
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [x] **Step 1: Write failing diagnostics/error tests**

Capture shared logger output and require invalid negotiated Goal notifications to emit a warning. Require generic runtime failures to remain generic while typed invalid errors receive `WMActionErrorInvalid`.

```go
if _, ok := protocol.WMActionErrorCode(codexappWMActionError(errors.New("runtime"))); ok {
    t.Fatal("runtime error was mislabeled as invalid input")
}
```

- [x] **Step 2: Run tests and verify RED**

```powershell
go test ./internal/hub/agent -run 'InvalidGoalNotificationDiagnostic|WMActionRuntimeError' -count=1
```

Expected: FAIL because invalid Goal payloads are silent and generic errors default to `invalid`.

- [x] **Step 3: Add warning and narrow error wrapping**

Log Goal decode failures through `agentLogger().Warn`. Update `codexappWMActionError` so only known typed action errors are wrapped; return unknown runtime errors unchanged, and explicitly map `ErrSessionActionInvalid` to `WMActionErrorInvalid`.

- [x] **Step 4: Run Agent tests and verify GREEN**

```powershell
go test ./internal/hub/agent -count=1
```

Expected: PASS.

### Task 4: Full verification and delivery

**Files:**
- Verify all modified files and the approved spec.

- [x] **Step 1: Run formatting**

```powershell
gofmt -w server/internal/protocol/agent_event.go server/internal/protocol/session_turn.go server/internal/protocol/acp_wire_update.go server/internal/hub/agent/instance.go server/internal/hub/agent/conn_owned.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go server/internal/hub/client/session.go server/internal/hub/client/session_recorder.go server/internal/hub/client/client_test.go
```

- [x] **Step 2: Run full Go and Web verification**

```powershell
Set-Location server
go test ./...
Set-Location ../app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [x] **Step 3: Review compatibility boundaries**

```powershell
git diff --check
git status --short --branch
git diff --stat
```

Confirm Registry remains 2.7, WMT2 remains v2, no legacy ACP root reader or dual-write was added, and Goal restoration/folding behavior is unchanged.

- [ ] **Step 4: Commit and push**

```powershell
git add -A
git commit -m "fix(acp): close extension boundary gaps"
git push origin feature/acp-extension-boundary-v27
```
