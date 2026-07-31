# Server-Owned Session Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the App-owned prompt/compact queue with a Hub `Session` in-memory queue that keeps draining without an attached App, exposes one `session.queue` API, and allows attachments while a prompt is running.

**Architecture:** Add provider-neutral queue wire types in `internal/protocol`, then give each Hub `Session` a queue state machine, scheduler, generation/revision projection, and enqueue idempotency map. Prompt, compact, cancel, and steer execution feed explicit outcomes back into that scheduler; Registry remains a stateless forwarder, while the App keeps only revision-checked server projections and sends queue actions.

**Tech Stack:** Go 1.26 Hub/Registry/ACP layer, React 19 + TypeScript, Jest, existing `SessionRecorder`, Registry WebSocket Protocol 2.6, Lexical composer and attachment upload APIs.

**Command convention:** Run every `go` command from `server/`, every `npm` command from `app/`, and every `git` command from the repository root. Keep Registry Protocol version `2.6`.

**Implementation status (2026-07-31): Complete.** The unified protocol, Hub-owned queue and scheduler, lifecycle handling, App projection, queue controls, and running-state attachment flow are implemented. Validation passed for all Go packages, all 250 App suites (1,482 tests), TypeScript, the production web build, the Registry 16 MiB boundary, and `go vet ./internal/hub/client`. The requested Go race run is unavailable in this Windows environment because CGO is disabled (`-race requires cgo`); the queue concurrency regression tests pass in the standard suite.

**Locked wire shape:**

```json
{
  "method": "session.queue",
  "projectId": "hub-a:WheelMaker",
  "payload": {
    "sessionId": "sess-1",
    "action": "enqueue",
    "item": {
      "itemId": "019b...",
      "kind": "prompt",
      "createdAt": "2026-07-31T10:00:00Z",
      "blocks": [{"type": "text", "text": "Fix it"}]
    }
  }
}
```

Non-enqueue actions use `{sessionId, action, itemId}`. Every successful response is `{ok:true, sessionId, session}` where `session.queue` is the latest full snapshot. `session.list` uses the same `queue` object but omits `activeItem` and `waitingItems`, leaving only `generation`, `revision`, `paused`, `activeKind`, and `waitingCount`.

---

### Task 1: Declare the hard-cut queue protocol

**Files:**
- Create: `server/internal/protocol/session_queue.go`
- Test: `server/internal/protocol/session_queue_test.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing queue contract and method-registration tests**

Create `session_queue_test.go` with JSON round-trip assertions and extend `registry_methods_test.go` so only the unified method is registered:

```go
func TestSessionQueueRequestRoundTrip(t *testing.T) {
	raw := []byte(`{"sessionId":"sess-1","action":"enqueue","item":{"itemId":"item-1","kind":"prompt","createdAt":"2026-07-31T10:00:00Z","blocks":[{"type":"text","text":"hello"}]}}`)
	var got SessionQueueRequest
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != "sess-1" || got.Action != SessionQueueActionEnqueue || got.Item == nil ||
		got.Item.ItemID != "item-1" || got.Item.Kind != SessionQueueItemKindPrompt ||
		len(got.Item.Blocks) != 1 || got.Item.Blocks[0].Text != "hello" {
		t.Fatalf("request = %#v", got)
	}
}

func TestRegistrySessionQueueReplacesLegacyMethods(t *testing.T) {
	desc, ok := RegistryMethod(RegistryMethodSessionQueue)
	if !ok {
		t.Fatal("session.queue descriptor missing")
	}
	if desc.Scope != RegistryScopeProject || desc.Route != RegistryRouteSessionForward {
		t.Fatalf("session.queue descriptor = %+v", desc)
	}
	for _, removed := range []string{"session.send", "session.compact", "session.cancel", "session.steer"} {
		if _, exists := RegistryMethod(removed); exists {
			t.Fatalf("%s must not remain registered", removed)
		}
	}
	if RegistryProtocolVersion != "2.6" {
		t.Fatalf("protocol version = %q, want 2.6", RegistryProtocolVersion)
	}
}
```

Update the Registry forwarding test to submit `session.queue` and assert the Hub receives the method and payload unchanged. Add negative cases for all four removed method names.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run from `server`:

```powershell
go test ./internal/protocol ./internal/registry -run 'TestSessionQueue|TestRegistrySessionQueue|TestServerForwardsSessionQueue'
```

Expected: build failure because the queue types and `RegistryMethodSessionQueue` do not exist.

- [ ] **Step 3: Add provider-neutral queue constants and payload types**

Create `server/internal/protocol/session_queue.go`:

```go
package protocol

const (
	SessionQueueActionEnqueue    = "enqueue"
	SessionQueueActionCancel     = "cancel"
	SessionQueueActionPrioritize = "prioritize"
	SessionQueueActionSteer      = "steer"
	SessionQueueActionRetry      = "retry"

	SessionQueueItemKindPrompt  = "prompt"
	SessionQueueItemKindCompact = "compact"

	SessionQueueItemStatusQueued     = "queued"
	SessionQueueItemStatusRunning    = "running"
	SessionQueueItemStatusCancelling = "cancelling"
	SessionQueueItemStatusSteering   = "steering"
	SessionQueueItemStatusFailed     = "failed"
)

type SessionQueueEnqueueItem struct {
	ItemID    string         `json:"itemId"`
	Kind      string         `json:"kind"`
	CreatedAt string         `json:"createdAt"`
	Blocks    []ContentBlock `json:"blocks,omitempty"`
}

type SessionQueueRequest struct {
	SessionID string                   `json:"sessionId"`
	Action    string                   `json:"action"`
	ItemID    string                   `json:"itemId,omitempty"`
	Item      *SessionQueueEnqueueItem `json:"item,omitempty"`
}

type SessionQueueItem struct {
	ItemID          string         `json:"itemId"`
	Kind            string         `json:"kind"`
	Status          string         `json:"status"`
	CreatedAt       string         `json:"createdAt"`
	Blocks          []ContentBlock `json:"blocks,omitempty"`
	CancelSupported bool           `json:"cancelSupported"`
	Error           string         `json:"error,omitempty"`
}

type SessionQueueSnapshot struct {
	Generation   string             `json:"generation"`
	Revision     uint64             `json:"revision"`
	Paused       bool               `json:"paused"`
	ActiveKind   string             `json:"activeKind,omitempty"`
	WaitingCount int                `json:"waitingCount"`
	ActiveItem   *SessionQueueItem  `json:"activeItem,omitempty"`
	WaitingItems []SessionQueueItem `json:"waitingItems,omitempty"`
}
```

`SessionQueueSnapshot` is used for both projections: list code constructs summary-only values, while read/event/action code includes live items.

- [ ] **Step 4: Register only `session.queue`**

In `registry_methods.go`, replace the four legacy constants/descriptors with:

```go
const RegistryMethodSessionQueue = "session.queue"

RegistryMethodSessionQueue: registryProjectMethod(
	RegistryMethodSessionQueue,
	RegistryRouteSessionForward,
),
```

Remove `RegistryMethodSessionSend`, `RegistryMethodSessionCompact`, `RegistryMethodSessionCancel`, and `RegistryMethodSessionSteer` from constants, descriptors, allowlists, and tests. Do not change `RegistryProtocolVersion`.

- [ ] **Step 5: Run protocol and Registry tests**

```powershell
go test ./internal/protocol ./internal/registry
```

Expected: PASS, including explicit rejection of the removed methods.

- [ ] **Step 6: Commit the protocol hard cut**

```powershell
git add server/internal/protocol/session_queue.go server/internal/protocol/session_queue_test.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/server_test.go
git commit -m "feat: define unified session queue protocol"
```

### Task 2: Build the Session queue state machine

**Files:**
- Create: `server/internal/hub/client/session_queue.go`
- Test: `server/internal/hub/client/session_queue_test.go`
- Modify: `server/internal/hub/client/session.go`

- [ ] **Step 1: Write failing state-machine tests**

Create table-driven tests that use a fresh `Session` without an Agent to verify enqueue order, deep-copy snapshots, revision changes, idempotency, conflicts, prioritize, waiting cancel, retry, and failed cancel:

```go
func TestSessionQueueEnqueueIsFIFOAndIdempotent(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-queue")
	first := promptQueueItem("item-1", "first")
	second := promptQueueItem("item-2", "second")

	if _, duplicate, err := s.enqueueQueueItem(first); err != nil || duplicate {
		t.Fatalf("first enqueue duplicate=%t err=%v", duplicate, err)
	}
	if _, duplicate, err := s.enqueueQueueItem(second); err != nil || duplicate {
		t.Fatalf("second enqueue duplicate=%t err=%v", duplicate, err)
	}
	if _, duplicate, err := s.enqueueQueueItem(first); err != nil || !duplicate {
		t.Fatalf("duplicate enqueue duplicate=%t err=%v", duplicate, err)
	}

	got := s.queueSnapshot(true)
	if got.Revision != 2 || len(got.WaitingItems) != 2 ||
		got.WaitingItems[0].ItemID != "item-1" || got.WaitingItems[1].ItemID != "item-2" {
		t.Fatalf("snapshot = %#v", got)
	}
}

func TestSessionQueueRejectsItemIDPayloadConflict(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-conflict")
	if _, _, err := s.enqueueQueueItem(promptQueueItem("item-1", "first")); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.enqueueQueueItem(promptQueueItem("item-1", "different"))
	if !errors.Is(err, errSessionQueueItemConflict) {
		t.Fatalf("error = %v, want conflict", err)
	}
}

func TestSessionQueueFailedCancelResumesWaitingItems(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-failed")
	s.queue.active = &sessionQueueItem{wire: promptQueueItem("failed", "one"), status: acp.SessionQueueItemStatusFailed}
	s.queue.waiting = []*sessionQueueItem{{wire: promptQueueItem("next", "two"), status: acp.SessionQueueItemStatusQueued}}
	s.queue.paused = true

	if err := s.cancelQueueItem("failed"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if got.Paused || got.ActiveItem != nil || len(got.WaitingItems) != 1 {
		t.Fatalf("snapshot = %#v", got)
	}
}
```

Also test:

- compact enqueue rejects blocks and prompt enqueue requires at least one block;
- missing/unknown action and missing item IDs return `CodeInvalidArgument`;
- `prioritize` affects waiting only;
- active compact cancel returns `agent.ErrSessionActionUnsupported`;
- `resetQueue()` clears waiting/failed/idempotency and changes generation;
- summary projection never contains blocks or live item objects.

- [ ] **Step 2: Run the state-machine tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestSessionQueue'
```

Expected: build failure because `Session.queue` and its mutation methods do not exist.

- [ ] **Step 3: Add private queue storage to `Session`**

Add focused private types to `session_queue.go`:

```go
var errSessionQueueItemConflict = errors.New("session queue item id conflicts with an existing payload")

type sessionQueueItem struct {
	wire        acp.SessionQueueEnqueueItem
	status      string
	errMessage  string
	payloadHash [sha256.Size]byte
}

type sessionQueueState struct {
	generation string
	revision   uint64
	paused     bool
	active     *sessionQueueItem
	waiting    []*sessionQueueItem
	outcomes   map[string][sha256.Size]byte
	draining   bool
}
```

Extend `Session` with a mutation serializer and state lock separate from `mu`:

```go
queueOpMu sync.Mutex
queueMu   sync.Mutex
queue     sessionQueueState
```

Initialize it in `newSession`:

```go
queue: sessionQueueState{
	generation: uuid.NewString(),
	outcomes:   make(map[string][sha256.Size]byte),
},
```

- [ ] **Step 4: Implement pure mutation and snapshot helpers**

Implement these methods in `session_queue.go`:

```go
func (s *Session) enqueueQueueItem(item acp.SessionQueueEnqueueItem) (acp.SessionQueueSnapshot, bool, error)
func (s *Session) cancelQueueItem(itemID string) error
func (s *Session) prioritizeQueueItem(itemID string) error
func (s *Session) retryQueueItem(itemID string) error
func (s *Session) resetQueue() acp.SessionQueueSnapshot
func (s *Session) queueSnapshot(full bool) acp.SessionQueueSnapshot
func (s *Session) queuePinsMemory() bool
func (s *Session) bumpQueueRevisionLocked()
```

Rules encoded by these methods:

- canonical payload hash is SHA-256 of `json.Marshal(SessionQueueEnqueueItem)` after trimming IDs/kind/time and cloning blocks;
- duplicate same-hash enqueue returns `duplicate=true` without revision change;
- conflicts return `CodeConflict`;
- live item blocks are cloned on ingress and egress;
- every observable status/order/pause change increments revision exactly once;
- failed retry changes `failed -> queued`, clears the error and pause, then places the item at the front;
- cancel of failed removes it and clears pause;
- no capacity counter or eviction is added to the queue.

- [ ] **Step 5: Run the queue state tests**

```powershell
go test ./internal/hub/client -run 'TestSessionQueue'
```

Expected: PASS.

- [ ] **Step 6: Run the race detector for the new state**

```powershell
go test -race ./internal/hub/client -run 'TestSessionQueue'
```

Expected: PASS with no race report.

- [ ] **Step 7: Commit the state machine**

```powershell
git add server/internal/hub/client/session.go server/internal/hub/client/session_queue.go server/internal/hub/client/session_queue_test.go
git commit -m "feat: add session queue state machine"
```

### Task 3: Feed prompt and compact outcomes into the scheduler

**Files:**
- Modify: `server/internal/hub/client/session_queue.go`
- Modify: `server/internal/hub/client/session.go`
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/session_queue_test.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing scheduler tests with controlled Agent channels**

Use `testInjectedInstance` channels to prove FIFO and pause semantics:

```go
func TestSessionQueueDrainsPromptCompactPromptInOrder(t *testing.T) {
	client, instance := newQueueExecutionClient(t)
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("p1", "first"))
	enqueueQueueRequest(t, client, "sess-1", compactQueueItem("c1"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("p2", "second"))

	instance.finishPrompt(acp.StopReasonEndTurn)
	instance.finishCompact(nil)
	instance.finishPrompt(acp.StopReasonEndTurn)

	eventually(t, func() bool {
		return reflect.DeepEqual(instance.executionOrder(), []string{"prompt:first", "compact:c1", "prompt:second"})
	})
	if got := queueSnapshotForTest(t, client, "sess-1"); got.ActiveItem != nil || len(got.WaitingItems) != 0 {
		t.Fatalf("queue = %#v", got)
	}
}

func TestSessionQueueFailurePausesUntilRetry(t *testing.T) {
	client, instance := newQueueExecutionClient(t)
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("p1", "first"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("p2", "second"))
	instance.failPrompt(errors.New("provider failed"))

	eventually(t, func() bool {
		got := queueSnapshotForTest(t, client, "sess-1")
		return got.Paused && got.ActiveItem != nil && got.ActiveItem.Status == acp.SessionQueueItemStatusFailed
	})
	if instance.promptCount() != 1 {
		t.Fatalf("prompt count = %d, want 1", instance.promptCount())
	}

	queueActionRequest(t, client, "sess-1", acp.SessionQueueActionRetry, "p1")
	instance.finishPrompt(acp.StopReasonEndTurn)
	instance.finishPrompt(acp.StopReasonEndTurn)
	eventually(t, func() bool { return instance.promptCount() == 3 })
}
```

Add tests for enqueue returning before execution completes, App-independent drain, active prompt cancelling, failed cancel continuing, active compact cancel unsupported, and concurrent enqueue executing every item exactly once.

- [ ] **Step 2: Run the scheduler tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestSessionQueue(Drains|Failure|EnqueueReturns|Cancel|Concurrent)'
```

Expected: FAIL because enqueue does not start a Hub-owned drain loop.

- [ ] **Step 3: Make prompt execution return an explicit outcome**

Add:

```go
type sessionExecutionOutcome struct {
	status string
	err    error
}

const (
	sessionExecutionCompleted = "completed"
	sessionExecutionCancelled = "cancelled"
	sessionExecutionFailed    = "failed"
)
```

Change the prompt path so `runPromptBlocks` returns:

```go
sessionExecutionOutcome{status: sessionExecutionCancelled}
```

for `context.Canceled` or `StopReasonCancelled`,

```go
sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
```

after recording a failed `prompt_done`, and completed otherwise. Keep all existing turn recording and permission cleanup. Remove public request reliance on `PromptToSession`; the queue scheduler becomes the only normal prompt caller.

- [ ] **Step 4: Make compact execution block until its official result**

Replace `StartCompaction` with a queue-facing method that assumes `beginExecution` already succeeded:

```go
func (s *Session) runCompactionExecution(ctx context.Context, operationID string) sessionExecutionOutcome {
	if err := s.ensureInstance(ctx); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	if err := s.ensureReadyAndNotify(ctx); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	s.mu.Lock()
	inst := s.instance
	sessionID := s.acpSessionID
	s.mu.Unlock()
	compactor, ok := inst.(agent.SessionCompactor)
	if !ok {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: agent.ErrSessionActionUnsupported}
	}
	recorder := s.viewSink
	if recorder == nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: errors.New("session operation recorder is required")}
	}
	started := acp.SessionOperationPayload{
		OperationID: operationID,
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusStarted,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	if err := recorder.RecordSessionOperation(ctx, sessionID, started); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	fail := func(err error) sessionExecutionOutcome {
		failed := started
		failed.Status = acp.SessionOperationStatusFailed
		failed.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		failed.Message = err.Error()
		_ = recorder.RecordSessionOperation(context.Background(), sessionID, failed)
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	done, err := compactor.CompactSession(ctx, sessionID)
	if err != nil {
		return fail(err)
	}
	if done == nil {
		return fail(errors.New("session compactor returned no completion channel"))
	}
	result, open := <-done
	if !open {
		return fail(errors.New("session compaction ended without a result"))
	}
	if result.Err != nil {
		return fail(result.Err)
	}
	completed := started
	completed.Status = acp.SessionOperationStatusCompleted
	completed.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	if err := recorder.RecordSessionOperation(context.Background(), sessionID, completed); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	return sessionExecutionOutcome{status: sessionExecutionCompleted}
}
```

Use the queue `itemId` as `operationId`, so retries preserve identity and the transcript has one stable correlation ID.

- [ ] **Step 5: Implement the asynchronous drain loop**

Add these scheduler methods:

```go
func (s *Session) scheduleQueueDrain()
func (s *Session) drainQueue()
func (s *Session) promoteNextQueueItem() (*sessionQueueItem, bool)
func (s *Session) finishActiveQueueItem(itemID string, outcome sessionExecutionOutcome)
func (s *Session) publishQueueSnapshot()
```

`scheduleQueueDrain` starts at most one goroutine. `drainQueue`:

1. stops when paused, empty, or another Session execution owns `promptMu`;
2. acquires execution before promoting a waiting item;
3. publishes `running`;
4. runs prompt or compact synchronously in the drain goroutine;
5. records the official turn/operation before removing completed/cancelled items;
6. leaves a failed item active, sets `paused=true`, and exits;
7. releases execution and continues the FIFO.

Update `endExecution` to call `scheduleQueueDrain()` after unlocking, so fork/Goal completion wakes a waiting queue without polling.

- [ ] **Step 6: Route active prompt cancel through the queue**

`cancelQueueItem` must:

```go
if active.Kind == acp.SessionQueueItemKindPrompt {
	active.status = acp.SessionQueueItemStatusCancelling
	s.bumpQueueRevisionLocked()
	go func() {
		if err := s.cancelPrompt(); err != nil {
			hubLogger(s.projectName).Warn("cancel queued prompt failed session=%s item=%s err=%v", s.acpSessionID, itemID, err)
		}
	}()
	return nil
}
```

The drain loop, not the cancel request, removes the item after the formal cancelled result. Active compact returns `agent.ErrSessionActionUnsupported` without changing revision.

- [ ] **Step 7: Run scheduler, existing prompt, compact, Goal, and permission tests**

```powershell
go test ./internal/hub/client -run 'TestSessionQueue|TestHandleSessionRequest_SessionCompact|TestSessionGoal|TestSessionRecorder|TestSessionPermission'
```

Expected: PASS. Update existing direct-send/compact tests to enqueue through `session.queue`; retain their original turn and operation assertions.

- [ ] **Step 8: Commit the scheduler**

```powershell
git add server/internal/hub/client/session.go server/internal/hub/client/session_queue.go server/internal/hub/client/session_queue_test.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat: drain session queue in hub"
```

### Task 4: Integrate steer with queue ownership

**Files:**
- Modify: `server/internal/hub/client/session_steer.go`
- Modify: `server/internal/hub/client/session_steer_test.go`
- Modify: `server/internal/hub/client/session_queue.go`
- Modify: `server/internal/hub/client/session.go`
- Test: `server/internal/hub/client/session_queue_test.go`

- [ ] **Step 1: Replace old fallback-owner tests with queue-owned steer tests**

Add tests for all three outcomes:

```go
func TestSessionQueueSteerWaitsForMatchingTranscript(t *testing.T) {
	client, instance := newQueueExecutionClient(t)
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("active", "first"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("steer-1", "change direction"))

	queueActionRequest(t, client, "sess-1", acp.SessionQueueActionSteer, "steer-1")
	got := queueSnapshotForTest(t, client, "sess-1")
	if got.WaitingItems[0].Status != acp.SessionQueueItemStatusSteering {
		t.Fatalf("queue = %#v", got)
	}

	instance.emitSteeredUserMessage("different")
	if len(queueSnapshotForTest(t, client, "sess-1").WaitingItems) != 1 {
		t.Fatal("unrelated transcript removed the item")
	}
	instance.emitSteeredUserMessage("steer-1")
	eventually(t, func() bool {
		return len(queueSnapshotForTest(t, client, "sess-1").WaitingItems) == 0
	})
}

func TestSessionQueueSteerInactiveMovesPromptToFront(t *testing.T) {
	client, instance := newQueueExecutionClient(t)
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("active", "first"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("before", "before"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("target", "target"))
	instance.setSteerError(agent.ErrSessionSteerInactive)

	queueActionRequest(t, client, "sess-1", acp.SessionQueueActionSteer, "target")
	got := queueSnapshotForTest(t, client, "sess-1")
	if len(got.WaitingItems) != 2 || got.WaitingItems[0].ItemID != "target" ||
		got.WaitingItems[0].Status != acp.SessionQueueItemStatusQueued {
		t.Fatalf("queue = %#v", got)
	}
}

func TestSessionQueueSteerFailureRestoresOriginalPosition(t *testing.T) {
	client, instance := newQueueExecutionClient(t)
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("active", "first"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("a", "a"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("target", "target"))
	enqueueQueueRequest(t, client, "sess-1", promptQueueItem("b", "b"))
	instance.setSteerError(agent.ErrSessionActionUnsupported)

	err := queueActionError(client, "sess-1", acp.SessionQueueActionSteer, "target")
	if !errors.Is(err, agent.ErrSessionActionUnsupported) {
		t.Fatalf("error = %v", err)
	}
	got := queueSnapshotForTest(t, client, "sess-1")
	if ids := queueItemIDs(got.WaitingItems); !reflect.DeepEqual(ids, []string{"a", "target", "b"}) ||
		got.WaitingItems[1].Status != acp.SessionQueueItemStatusQueued {
		t.Fatalf("queue = %#v", got)
	}
}
```

- [ ] **Step 2: Run steer tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestSessionQueueSteer|TestSessionSteer'
```

Expected: old `sessionSteerState.priority/outcomes` owns fallback work and the new queue item states are not updated.

- [ ] **Step 3: Reduce `sessionSteerState` to provider-turn coordination**

Keep prompt-generation coordination needed to close the race between `turn/steer` and prompt completion, but remove:

```go
priority     []sessionPriorityPrompt
outcomes     map[string]acp.SessionSteerAccepted
outcomeOrder []string
```

Replace `Session.Steer` with:

```go
type sessionSteerAttempt struct {
	outcome string
}

const (
	sessionSteerAttemptTranscript = "transcript"
	sessionSteerAttemptFallback   = "fallback"
)

func (s *Session) trySteerQueuePrompt(
	ctx context.Context,
	itemID string,
	blocks []acp.ContentBlock,
) (sessionSteerAttempt, error)
```

Return `transcript` after provider acceptance, `fallback` for an inactive/missed turn, and an error for unsupported/failed calls. Do not start a prompt or store fallback blocks in `session_steer.go`.

- [ ] **Step 4: Add queue steer mutation and transcript completion**

Implement:

```go
func (s *Session) steerQueueItem(ctx context.Context, itemID string) error
func (s *Session) completeSteeredQueueItem(clientMessageID string)
```

`steerQueueItem` stores the original index, marks the waiting prompt `steering`, publishes, releases `queueMu` while calling the provider, then:

- leaves it steering on `transcript`;
- restores `queued` at index 0 on `fallback`;
- restores `queued` at its original index on error.

In `SessionUpdate`, before forwarding the update to the recorder, call:

```go
if update.SessionUpdate == acp.SessionUpdateUserMessageChunk &&
	update.Steered && strings.TrimSpace(update.ClientMessageID) != "" {
	s.completeSteeredQueueItem(update.ClientMessageID)
}
```

This removes only the matching steering item and publishes the new revision.

- [ ] **Step 5: Run steer and queue tests under the race detector**

```powershell
go test -race ./internal/hub/client -run 'TestSessionQueueSteer|TestSessionSteer'
```

Expected: PASS with transcript-before-response, prompt-ending, and concurrent mutation cases.

- [ ] **Step 6: Commit queue-owned steer**

```powershell
git add server/internal/hub/client/session_steer.go server/internal/hub/client/session_steer_test.go server/internal/hub/client/session_queue.go server/internal/hub/client/session_queue_test.go server/internal/hub/client/session.go
git commit -m "feat: move steer fallback into session queue"
```

### Task 5: Expose queue actions, projections, and lifecycle semantics

**Files:**
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/session_attachments.go`
- Modify: `server/internal/hub/client/client_test.go`
- Modify: `server/internal/hub/client/session_queue_test.go`

- [ ] **Step 1: Write failing request/projection/lifecycle tests**

Add request tests that assert:

```go
func TestHandleSessionQueueReturnsLatestFullSnapshot(t *testing.T) {
	c := newQueueClient(t)
	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "project-1", mustRaw(map[string]any{
		"sessionId": "sess-1",
		"action":    "enqueue",
		"item": map[string]any{
			"itemId": "item-1", "kind": "prompt", "createdAt": "2026-07-31T10:00:00Z",
			"blocks": []any{map[string]any{"type": "text", "text": "hello"}},
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	body := resp.(map[string]any)
	session := body["session"].(sessionViewSummary)
	if session.Queue == nil || session.Queue.Generation == "" ||
		(session.Queue.ActiveItem == nil && len(session.Queue.WaitingItems) == 0) {
		t.Fatalf("response = %#v", body)
	}
}
```

Also assert:

- `session.read` and `session.updated` contain full queue items;
- `session.list` contains only summary fields and no blocks;
- same-ID same-payload retry does not execute twice and returns the current snapshot;
- attachments are validated and marked sent when a new prompt item is accepted;
- reload changes generation and clears waiting/failed/idempotency;
- archive/delete clear queue without a second confirmation when no execution is active;
- active execution still rejects reload/archive/delete;
- a nonempty queue prevents suspended-session eviction;
- constructing a new `Client` from the same SQLite store yields an empty queue.

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestHandleSessionQueue|TestSessionQueueProjection|TestSessionQueueLifecycle|TestSessionQueueAttachments|TestEvictSuspendedSessionWithQueue'
```

Expected: FAIL because request routing and summary enrichment are absent.

- [ ] **Step 3: Add one `session.queue` request case**

Decode `acp.SessionQueueRequest`, reject unknown fields through the existing strict decoder, validate action-specific fields, and route:

```go
case acp.RegistryMethodSessionQueue:
	var req acp.SessionQueueRequest
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.queue payload: %w", err)
	}
	return c.handleSessionQueueRequest(ctx, req)
```

`handleSessionQueueRequest` serializes mutations with `sess.queueOpMu`. For enqueue it:

1. validates prompt/compact union;
2. resolves project file blocks and validates uploaded attachment references;
3. enqueues the item;
4. marks newly accepted attachment sidecars sent;
5. schedules drain;
6. returns the latest full Session summary.

Delete the old send/compact/cancel/steer cases.

- [ ] **Step 4: Enrich Session summaries without persisting queue**

Add to `sessionViewSummary`:

```go
Queue *acp.SessionQueueSnapshot `json:"queue,omitempty"`
```

Give `SessionRecorder` a non-persisting projection hook:

```go
queueLookup func(sessionID string, full bool) *acp.SessionQueueSnapshot
```

Wire it from `Client` to an in-memory Session lookup. Use `full=false` only in `ListSessionViews`; use `full=true` for `ReadSessionSummary`, queue action responses, and `publishSessionUpdated`. Never add queue fields to `SessionRecord`, `sessionSyncProjection`, SQLite, WMT2, or archive manifests.

- [ ] **Step 5: Publish queue transitions through `session.updated`**

Make `Session.publishQueueSnapshot()` call the existing summary publisher:

```go
if publisher, ok := s.viewSink.(interface {
	PublishSessionSummary(context.Context, string) error
}); ok {
	if err := publisher.PublishSessionSummary(context.Background(), s.acpSessionID); err != nil {
		hubLogger(s.projectName).Warn("publish queue summary failed session=%s err=%v", s.acpSessionID, err)
	}
}
```

Always release `queueMu` before calling the recorder to keep the lock order one-way.

- [ ] **Step 6: Apply reload/archive/delete and eviction rules**

In `ReloadSession`, after active-execution rejection and before replay reset, call `sess.resetQueue()`. In delete/archive, clear queue before removing Session state; the active execution guard remains authoritative.

Change eviction selection to:

```go
if sess.Status == SessionSuspended &&
	!sess.queuePinsMemory() &&
	time.Since(sess.lastActiveAt) > timeout {
	toEvict = append(toEvict, sess)
}
```

Hub `Close` may clear/cancel queue because restart recovery is explicitly out of scope.

- [ ] **Step 7: Run Hub client tests**

```powershell
go test ./internal/hub/client
```

Expected: PASS, including existing archive, reload, attachment, Goal, permission, and compaction behavior.

- [ ] **Step 8: Commit Hub integration**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/session_recorder.go server/internal/hub/client/session_recovery.go server/internal/hub/client/session_attachments.go server/internal/hub/client/client_test.go server/internal/hub/client/session_queue_test.go
git commit -m "feat: expose hub-owned session queue"
```

### Task 6: Replace the App Registry client surface

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/__tests__/web-session-actions-service.test.ts`
- Modify: `app/__tests__/web-registry-protocol-domain-service.test.ts`
- Modify: `app/__tests__/web-session-list-schema.test.ts`

- [ ] **Step 1: Write failing App protocol/service tests**

Replace direct send/compact/steer/cancel expectations with action-union requests:

```ts
test('uses one session.queue method for every queue action', async () => {
  await service.enqueueProjectSessionItem('project-1', 'sess-1', {
    itemId: 'item-1',
    kind: 'prompt',
    createdAt: '2026-07-31T10:00:00Z',
    blocks: [{type: 'text', text: 'hello'}],
  });
  await service.cancelProjectSessionQueueItem('project-1', 'sess-1', 'item-1');
  await service.prioritizeProjectSessionQueueItem('project-1', 'sess-1', 'item-1');
  await service.steerProjectSessionQueueItem('project-1', 'sess-1', 'item-1');
  await service.retryProjectSessionQueueItem('project-1', 'sess-1', 'item-1');

  expect(requests.map(request => [request.method, request.payload])).toEqual([
    ['session.queue', {sessionId: 'sess-1', action: 'enqueue', item: expect.objectContaining({itemId: 'item-1'})}],
    ['session.queue', {sessionId: 'sess-1', action: 'cancel', itemId: 'item-1'}],
    ['session.queue', {sessionId: 'sess-1', action: 'prioritize', itemId: 'item-1'}],
    ['session.queue', {sessionId: 'sess-1', action: 'steer', itemId: 'item-1'}],
    ['session.queue', {sessionId: 'sess-1', action: 'retry', itemId: 'item-1'}],
  ]);
});
```

Add normalization assertions for a full snapshot, a list summary, invalid items, and unchanged protocol version `2.6`.

- [ ] **Step 2: Run focused Jest tests and verify they fail**

Run from `app`:

```powershell
npx jest __tests__/web-session-actions-service.test.ts __tests__/web-registry-protocol-domain-service.test.ts __tests__/web-session-list-schema.test.ts --runInBand
```

Expected: FAIL because the App still exports four legacy methods.

- [ ] **Step 3: Add queue wire types**

In `registryTypes.ts` add:

```ts
export type RegistrySessionQueueAction = 'enqueue' | 'cancel' | 'prioritize' | 'steer' | 'retry';
export type RegistrySessionQueueItemKind = 'prompt' | 'compact';
export type RegistrySessionQueueItemStatus = 'queued' | 'running' | 'cancelling' | 'steering' | 'failed';

export type RegistrySessionQueueEnqueueItem =
  | {
      itemId: string;
      kind: 'prompt';
      createdAt: string;
      blocks: RegistrySessionContentBlock[];
    }
  | {
      itemId: string;
      kind: 'compact';
      createdAt: string;
    };

export type RegistrySessionQueueItem = RegistrySessionQueueEnqueueItem & {
  status: RegistrySessionQueueItemStatus;
  cancelSupported: boolean;
  error?: string;
};

export interface RegistrySessionQueueSnapshot {
  generation: string;
  revision: number;
  paused: boolean;
  activeKind?: RegistrySessionQueueItemKind;
  waitingCount: number;
  activeItem?: RegistrySessionQueueItem;
  waitingItems?: RegistrySessionQueueItem[];
}

export interface RegistrySessionQueueResponse {
  ok: boolean;
  sessionId: string;
  session: RegistrySessionSummary;
}
```

Add `queue?: RegistrySessionQueueSnapshot` to `RegistrySessionSummary`. Remove `RegistrySessionCompactAccepted` and `RegistrySessionSteerAccepted`.

- [ ] **Step 4: Normalize queue projections defensively**

Add private normalizers in `RegistryRepository`:

```ts
private normalizeSessionQueueItem(raw: unknown): RegistrySessionQueueItem | null
private normalizeSessionQueue(raw: unknown): RegistrySessionQueueSnapshot | undefined
private normalizeSessionQueueResponse(raw: unknown, sessionId: string): RegistrySessionQueueResponse
```

Reject unknown kind/status combinations and prompt items without blocks. Clamp revision/waitingCount to nonnegative integers. Preserve absence of `activeItem`/`waitingItems` so list summaries cannot be mistaken for full snapshots.

- [ ] **Step 5: Replace repository and service methods**

Keep one repository method:

```ts
async mutateSessionQueue(
  projectId: string,
  payload:
    | {sessionId: string; action: 'enqueue'; item: RegistrySessionQueueEnqueueItem}
    | {sessionId: string; action: Exclude<RegistrySessionQueueAction, 'enqueue'>; itemId: string},
): Promise<RegistrySessionQueueResponse>
```

Expose five named `RegistryWorkspaceService` wrappers for call-site readability, all delegating to `mutateSessionQueue`. Remove `sendSessionMessage`, `steerSession`, `compactSession`, `cancelSession`, and their Workspace service wrappers. Set `RegistryMethods.SessionQueue = 'session.queue'` and delete the four old constants.

- [ ] **Step 6: Run App Registry tests and typecheck**

```powershell
npx jest __tests__/web-session-actions-service.test.ts __tests__/web-registry-protocol-domain-service.test.ts __tests__/web-session-list-schema.test.ts --runInBand
npm run tsc:web
```

Expected: focused tests PASS; typecheck may still fail only at Workspace queue call sites that Task 8 replaces.

- [ ] **Step 7: Commit the App protocol surface**

```powershell
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-registry-protocol-domain-service.test.ts app/__tests__/web-session-list-schema.test.ts
git commit -m "feat: switch app to session queue protocol"
```

### Task 7: Replace local queue ownership with a revision-checked projection

**Files:**
- Delete: `app/web/src/chat/session/chatPromptQueue.ts`
- Delete: `app/__tests__/web-chat-prompt-queue-state.test.ts`
- Create: `app/web/src/chat/session/chatSessionQueue.ts`
- Create: `app/__tests__/web-chat-session-queue-state.test.ts`
- Modify: `app/web/src/chat/session/chatSessionOrdering.ts`
- Modify: `app/__tests__/web-chat-session-ordering.test.ts`

- [ ] **Step 1: Write failing projection tests**

Create tests for generation/revision replacement and synthetic rendering only:

```ts
describe('mergeChatSessionQueueProjection', () => {
  const snapshot = (
    generation: string,
    revision: number,
    itemId = 'item-1',
  ): RegistrySessionQueueSnapshot => ({
    generation,
    revision,
    paused: false,
    activeKind: 'prompt',
    waitingCount: 1,
    waitingItems: [{
      itemId,
      kind: 'prompt',
      status: 'queued',
      createdAt: '2026-07-31T10:00:00Z',
      blocks: [{type: 'text', text: itemId}],
      cancelSupported: true,
    }],
  });

  test('rejects stale revisions in one generation', () => {
    expect(mergeChatSessionQueueProjection(snapshot('g1', 3), snapshot('g1', 2)))
      .toEqual(snapshot('g1', 3));
  });

  test('replaces all state on a new generation', () => {
    expect(mergeChatSessionQueueProjection(snapshot('g1', 9), snapshot('g2', 1, 'new')))
      .toEqual(snapshot('g2', 1, 'new'));
  });
});
```

Test that `queueDisplayItems()` returns active failed plus waiting prompt/compact in server order, clones blocks, and never exposes `shift`, `enqueue`, `move`, or `drain` helpers.

- [ ] **Step 2: Run projection tests and verify they fail**

```powershell
npx jest __tests__/web-chat-session-queue-state.test.ts __tests__/web-chat-session-ordering.test.ts --runInBand
```

Expected: missing `chatSessionQueue` module.

- [ ] **Step 3: Implement projection-only helpers**

Create `chatSessionQueue.ts`:

```ts
export type ChatSessionQueuesByKey = Record<string, RegistrySessionQueueSnapshot>;

export function mergeChatSessionQueueProjection(
  current: RegistrySessionQueueSnapshot | undefined,
  incoming: RegistrySessionQueueSnapshot | undefined,
): RegistrySessionQueueSnapshot | undefined {
  if (!incoming?.generation) return current;
  if (!current || current.generation !== incoming.generation) return cloneQueue(incoming);
  if (incoming.revision <= current.revision) return current;
  return cloneQueue(incoming);
}

export function fullQueueSnapshot(
  queue: RegistrySessionQueueSnapshot | undefined,
): RegistrySessionQueueSnapshot | undefined {
  if (!queue) return undefined;
  if (queue.activeItem || Array.isArray(queue.waitingItems) || queue.waitingCount === 0) {
    return cloneQueue(queue);
  }
  return undefined;
}

export function queueDisplayItems(
  queue: RegistrySessionQueueSnapshot | undefined,
): RegistrySessionQueueItem[] {
  const activeFailure = queue?.activeItem?.status === 'failed' ? [queue.activeItem] : [];
  return [...activeFailure, ...(queue?.waitingItems ?? [])].map(cloneQueueItem);
}
```

Also export `makeSessionQueueItemID()` using `crypto.randomUUID()` with the existing timestamp/random fallback, and `buildQueuePromptMessage()` for existing `ChatTurnView` rendering.

- [ ] **Step 4: Preserve full queue separately from list summaries**

`chatSessionOrdering.ts` should merge `session.queue` summary metadata normally, but it must not be the selected Session’s full-item store. Full projections live in `ChatSessionQueuesByKey`, updated only by `session.read`, `session.updated`, and queue action responses.

- [ ] **Step 5: Delete local ownership helpers and run tests**

Remove `chatPromptQueue.ts` and its mutation tests. Confirm no exported helper can locally enqueue, dequeue, prioritize, steer, or move queue items:

```powershell
npx jest __tests__/web-chat-session-queue-state.test.ts __tests__/web-chat-session-ordering.test.ts --runInBand
rg -n "shiftNextQueued|enqueueChatPrompt|moveQueuedChatPrompts|chatPromptQueue" web/src __tests__
```

Expected: tests PASS; `rg` returns no matches.

- [ ] **Step 6: Commit the projection reducer**

```powershell
git add -A app/web/src/chat/session app/__tests__/web-chat-prompt-queue-state.test.ts app/__tests__/web-chat-session-queue-state.test.ts app/__tests__/web-chat-session-ordering.test.ts
git commit -m "refactor: consume server session queue projections"
```

### Task 8: Rewire send, compact, stop, Goal, and attachment behavior

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/chat/session/chatSessionActions.ts`
- Modify: `app/__tests__/web-chat-session-actions.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-inline-composer-wiring.test.ts`
- Modify: `app/__tests__/web-voice-input-send-queue.test.ts`

- [ ] **Step 1: Write failing source/integration assertions**

Assert the App:

```ts
expect(workspace).toContain("service.enqueueProjectSessionItem(");
expect(workspace).toContain("await uploadChatAttachmentsForSend(");
expect(workspace.indexOf("await uploadChatAttachmentsForSend("))
  .toBeLessThan(workspace.indexOf("service.enqueueProjectSessionItem("));
expect(workspace).not.toContain("drainNextQueuedChatItem");
expect(workspace).not.toContain("chatQueuedPromptsByKeyRef");
expect(workspace).not.toContain("service.sendProjectSessionMessage");
expect(workspace).not.toContain("service.compactProjectSession");
expect(workspace).not.toContain("service.steerProjectSession");
expect(workspace).not.toContain("service.cancelProjectSession(");
expect(workspace).not.toContain("if (selectedChatPromptRunning) return;");
expect(workspace).not.toContain("setChatAttachmentTrayOpen(false);");
```

Add behavioral tests that `/goal ship it` resolves to `{kind:'goal', objective:'ship it'}`, while ordinary prompts and `/goal` with no objective do not enter the queue.

- [ ] **Step 2: Run focused Jest tests and verify they fail**

```powershell
npx jest __tests__/web-chat-session-actions.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-inline-composer-wiring.test.ts __tests__/web-voice-input-send-queue.test.ts --runInBand
```

Expected: FAIL on legacy local queue and Registry method calls.

- [ ] **Step 3: Store only full server projections**

Replace `chatQueuedPromptsByKey` with:

```ts
const [chatSessionQueuesByKey, setChatSessionQueuesByKey] =
  useState<ChatSessionQueuesByKey>({});
const chatSessionQueuesByKeyRef = useRef<ChatSessionQueuesByKey>({});

const applySessionQueueProjection = useCallback((
  projectId: string,
  session: RegistrySessionSummary | undefined,
) => {
  if (!session?.sessionId) return;
  const incoming = fullQueueSnapshot(session.queue);
  if (!incoming) return;
  const runtimeKey = buildChatRuntimeKey(projectId, session.sessionId);
  setChatSessionQueuesByKey(current => {
    const merged = mergeChatSessionQueueProjection(current[runtimeKey], incoming);
    if (!merged || merged === current[runtimeKey]) return current;
    const next = {...current, [runtimeKey]: merged};
    chatSessionQueuesByKeyRef.current = next;
    return next;
  });
  const pending = chatPendingPromptsByKeyRef.current[runtimeKey];
  const acceptedIDs = new Set([
    incoming.activeItem?.itemId,
    ...(incoming.waitingItems ?? []).map(item => item.itemId),
  ].filter((itemId): itemId is string => !!itemId));
  if (pending && acceptedIDs.has(pending.itemId)) {
    forgetPendingChatPrompt(runtimeKey);
  }
}, []);
```

Call it for `session.read`, `session.updated`, and every queue operation response. Do not clear this projection on Registry disconnect; reconnect/read replaces it by generation/revision.

- [ ] **Step 4: Make every prompt enqueue server-side**

Generate `itemId` before optimistic pending state and retain it in `PendingChatPrompt`. After draft Session resolution and attachment upload:

```ts
const itemId = options.itemIdOverride ?? makeSessionQueueItemID();
rememberPendingChatPrompt(runtimeKey, {
  itemId,
  sessionId,
  blocks: blocks.map(block => ({...block})),
  createdAt,
  turnIndex: nextPromptTurnIndex(chatMessageStoreRef.current[runtimeKey] ?? []),
  status: 'confirming',
});
const result = await service.enqueueProjectSessionItem(selectedProjectId, sessionId, {
  itemId,
  kind: 'prompt',
  createdAt,
  blocks,
});
if (!result.ok) throw new Error('session.queue enqueue returned ok=false');
applySessionQueueProjection(selectedProjectId, result.session);
forgetPendingChatPrompt(runtimeKey);
```

Retry an undelivered prompt with `itemIdOverride: pending.itemId`; this exercises Hub idempotency instead of creating another item. Upload exceptions happen before `rememberPendingChatPrompt` and before enqueue, so no queue item exists on failure.

- [ ] **Step 5: Enqueue compact and route controls through queue actions**

`/compact` always submits a compact item:

```ts
const result = await service.enqueueProjectSessionItem(projectId, sessionId, {
  itemId: makeSessionQueueItemID(),
  kind: 'compact',
  createdAt: new Date().toISOString(),
});
applySessionQueueProjection(projectId, result.session);
```

Queue row callbacks call cancel/prioritize/steer/retry service wrappers, then merge `result.session`. Stop calls queue cancel with `selectedQueue.activeItem.itemId`; active Goal continues to call `session.goal.stop`.

- [ ] **Step 6: Parse `/goal` into the existing Goal control API**

Extend `StandaloneSessionActionResolution`:

```ts
| {kind: 'goal'; objective: string}
| {kind: 'invalid'; command: '/status' | '/compact' | '/fast' | '/goal'}
```

Parse a nonempty `/goal <objective>` without attachments and call:

```ts
await service.createProjectSessionGoal(projectId, sessionId, nativeAction.objective);
```

This keeps Goal outside prompt/compact queue while preserving the slash insertion UI.

- [ ] **Step 7: Allow attachment entry during active execution**

Remove the running guard from the paperclip button, keep only `selectedChatSubmitPending`/upload guards, stop auto-closing the attachment tray when execution starts, and allow file picker, image picker, drag/drop, and paste during active prompt/compact. Upload still starts only when Send is pressed.

- [ ] **Step 8: Remove local drain and reconnect cleanup**

Delete:

- local enqueue/dequeue/move/reconcile callbacks;
- steer promise chains;
- the `drainNextQueuedChatItem` effect;
- queue migration in draft-to-real Session state;
- disconnect-time queue clearing.

Draft Session creation still resolves before upload/enqueue, so no server queue exists under a draft runtime key. Archive/delete removes the corresponding `chatSessionQueuesByKey[runtimeKey]`; reload keeps the old projection only until its forced `session.read` supplies the new generation.

- [ ] **Step 9: Run focused App tests and typecheck**

```powershell
npx jest __tests__/web-chat-session-actions.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-inline-composer-wiring.test.ts __tests__/web-voice-input-send-queue.test.ts --runInBand
npm run tsc:web
```

Expected: PASS with no legacy queue method references.

- [ ] **Step 10: Commit the App ownership switch**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/chat/session/chatSessionActions.ts app/__tests__/web-chat-session-actions.test.ts app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-inline-composer-wiring.test.ts app/__tests__/web-voice-input-send-queue.test.ts
git commit -m "feat: submit composer work to hub queue"
```

### Task 9: Render authoritative queue states and controls

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing rendering tests**

Add `react-test-renderer` cases for:

- queued prompt: Cancel, Prioritize, and Steer when supported;
- steering prompt: progress label plus Cancel, with Prioritize/Steer disabled;
- failed active item: error plus Retry and Cancel;
- waiting compact: Compact label plus Cancel/Prioritize;
- active compact: Running label and no cancel button because `cancelSupported=false`;
- cancelling prompt: Stop pill and row both show cancelling without issuing a second action.

Example:

```tsx
test('failed queue item exposes retry and skip-through-cancel', async () => {
  const onRetry = jest.fn();
  const onCancel = jest.fn();
  const tree = await render(
    <ChatQueueItemView
      item={queuePrompt({status: 'failed', error: 'provider failed'})}
      onRetry={onRetry}
      onCancel={onCancel}
    />,
  );
  expect(textOf(tree)).toContain('provider failed');
  expect(buttonLabels(tree)).toEqual(expect.arrayContaining(['Retry', 'Cancel']));
});
```

- [ ] **Step 2: Run rendering tests and verify they fail**

```powershell
npx jest __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-ui.test.ts --runInBand
```

Expected: existing rendering understands only local queued/steering prompts.

- [ ] **Step 3: Render queue prompt and compact projections**

Use `queueDisplayItems(selectedQueue)` to append stable virtualizer keys. Prompt items continue through a synthetic `RegistryChatMessage`; compact items render a compact `session_operation`-style row. Extend `ChatTurnView` props to explicit queue actions:

```ts
type ChatQueueActions = {
  cancel?: () => void;
  prioritize?: () => void;
  steer?: () => void;
  retry?: () => void;
};
```

Map controls from server state:

| State | Controls |
| --- | --- |
| waiting prompt `queued` | Cancel, Prioritize, Steer if capability supported |
| waiting compact `queued` | Cancel, Prioritize |
| prompt `steering` | Cancel; no second Steer or Prioritize |
| active prompt `cancelling` | none; show Cancelling |
| active prompt/compact `failed` | Retry, Cancel |
| active compact `running` | none (`cancelSupported=false`) |

Do not locally remove/reorder the row on click; wait for the operation response/event projection.

- [ ] **Step 4: Derive Stop and session status from queue**

The stop pill is visible for an active prompt in `running` or `cancelling`; Goal keeps its existing stop behavior. Active compact remains represented by operation/queue state but has no Stop affordance. Session list may use `queue.activeKind`, `queue.waitingCount`, and `queue.paused` without needing item blocks.

- [ ] **Step 5: Add state styles**

In `chat.css`, reuse existing tokens for `.queued`, `.steering`, `.cancelling`, and `.failed`; add a compact queue row variant and error text. Keep buttons keyboard-focusable and preserve reduced-motion behavior.

- [ ] **Step 6: Run queue UI tests, full App tests, and production build**

```powershell
npx jest __tests__/web-chat-turn-rendering.test.ts __tests__/web-chat-ui.test.ts --runInBand
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: all PASS; production webpack build completes.

- [ ] **Step 7: Commit queue UI**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/chat/ChatTurnView.tsx app/web/src/styles/chat.css app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat: render authoritative session queue"
```

### Task 10: Verify the synchronized hard cut and finish the branch

**Files:**
- Modify as needed from failures: files already listed in Tasks 1–9
- Verify: `docs/scope/2026-07-31-server-owned-session-queue/spec-server-owned-session-queue.md`
- Verify: `docs/wiki/architecture/session-management-and-sync.md`
- Verify: `docs/wiki/protocols/registry.md`
- Verify: `docs/wiki/frontend-interaction/composer.md`

- [ ] **Step 1: Scan for legacy API and local ownership**

From the repository root:

```powershell
rg -n "session\.(send|compact|cancel|steer)|RegistryMethodSession(Send|Compact|Cancel|Steer)|chatQueuedPromptsByKey|shiftNextQueued|drainNextQueued" server app
```

Expected: no production-code matches. Test fixtures that intentionally assert removed methods are rejected may remain.

- [ ] **Step 2: Verify the protocol version and non-persistence boundary**

```powershell
rg -n "RegistryProtocolVersion.*2\.6|RegistryProtocolVersion = '2\.6'" server/internal/protocol app/web/src/registry
rg -n "SessionQueue|sessionQueue|queue" server/internal/hub/client/sqlite_store.go server/internal/hub/client/session_turn_files.go server/internal/hub/client/session_archive.go
```

Expected: both version constants remain `2.6`; persistence files contain no queue storage fields or serialization.

- [ ] **Step 3: Reconfirm the existing 16 MiB transport boundary**

From `server`:

```powershell
go test ./internal/registry -run TestInputLimitBoundaries
```

Expected: PASS at exactly 16 MiB and rejection at 16 MiB + 1 byte. Do not add a queue-specific item, Session, or Hub memory limit.

- [ ] **Step 4: Run all Go tests and race-focused queue tests**

From `server`:

```powershell
go test ./...
go test -race ./internal/hub/client -run 'TestSessionQueue'
```

Expected: PASS.

- [ ] **Step 5: Run all App validation**

From `app`:

```powershell
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: PASS.

- [ ] **Step 6: Check docs and diff hygiene**

From the repository root:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; changes are limited to the approved spec/wiki, queue implementation, protocol, tests, and App integration.

- [ ] **Step 7: Commit any validation fixes**

If Steps 1–5 required fixes:

```powershell
git add -A
git commit -m "test: complete session queue hard cut"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 8: Complete the repository gate**

From the repository root, perform the required exact tail:

```powershell
git add -A
git commit -m "docs: finalize server-owned session queue"
git push origin feat/server-owned-session-queue
```

If the index is already clean because all content was committed in prior tasks, use the final documentation commit for the approved spec/wiki/plan before pushing; never manufacture an empty commit.
