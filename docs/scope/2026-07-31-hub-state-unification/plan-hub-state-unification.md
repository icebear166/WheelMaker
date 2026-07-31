# Hub State Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WheelMaker's split Hub operational state with one server-owned, atomically updated HubState that drives the Hub menu's Skills sections, Usage projection, and Composer suggestions without redundant polling or `agentProfiles`.

**Architecture:** Each HubState Section owns one active updater, one optional rerun, committed data, and a monotonic revision. Registry remains transport-only; Web consumes complete Section snapshots through a central HubStore. Usage keeps its domain-owned 10-minute scheduler, Skills adds targeted filesystem notifications, and Release Publishing moves to a separate Job protocol.

**Tech Stack:** Go 1.26, Gorilla WebSocket, fsnotify v1.10.1, React 19, TypeScript 5.8, Jest 30.

**Execution status:** review remediation verified; delivery pending

---

This is one coordinated plan because Server, Registry, and Web intentionally hard-cut the HubState payload while keeping Registry Protocol `2.6`. A temporary cross-version compatibility layer is not part of the deliverable.

### Task 1: Add the 2.6 HubState and Release Job wire contracts

**Files:**
- Create: `server/internal/protocol/hub_state.go`
- Modify: `server/internal/protocol/registry_methods.go:19-190`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/web/src/registry/registryMethods.ts:1-100`
- Modify: `app/web/src/registry/registryTypes.ts:111-220`
- Test: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Add failing Go protocol tests**

Add tests that keep protocol `2.6`, register the three Release Job methods, require `hubId`, and expose the new Section wire fields:

```go
func TestReleasePublishMethodsAreRegisteredWithoutVersionBump(t *testing.T) {
	for _, method := range []string{
		RegistryMethodReleasePublishStart,
		RegistryMethodReleasePublishGet,
		RegistryMethodReleasePublishUpdated,
	} {
		desc, ok := RegistryMethod(method)
		if !ok {
			t.Fatalf("%s is not registered", method)
		}
		if !desc.RequiresHubID {
			t.Fatalf("%s must require hubId", method)
		}
	}
	if DefaultProtocolVersion != "2.6" {
		t.Fatalf("protocol version = %q, want 2.6", DefaultProtocolVersion)
	}
}

func TestHubStateSectionWireShape(t *testing.T) {
	raw, err := json.Marshal(HubStateSection{
		Availability: HubStateAvailabilityReady,
		UpdateStatus: HubStateUpdateIdle,
		Revision:     4,
		Data:         map[string]any{"ok": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"availability":"ready"`, `"updateStatus":"idle"`, `"revision":4`} {
		if !bytes.Contains(raw, []byte(field)) {
			t.Fatalf("section missing %s: %s", field, raw)
		}
	}
}
```

- [ ] **Step 2: Run the focused Go test and verify failure**

Run:

```powershell
cd server
go test ./internal/protocol -run 'TestReleasePublishMethods|TestHubStateSectionWireShape' -count=1
```

Expected: FAIL because the Release Job constants and HubState wire types do not exist.

- [ ] **Step 3: Define the Go wire types and method descriptors**

Create `server/internal/protocol/hub_state.go` with concrete contract types:

```go
package protocol

type HubStateAvailability string
type HubStateUpdateStatus string

const (
	HubStateAvailabilityEmpty HubStateAvailability = "empty"
	HubStateAvailabilityReady HubStateAvailability = "ready"
	HubStateUpdateIdle        HubStateUpdateStatus = "idle"
	HubStateUpdateQueued      HubStateUpdateStatus = "queued"
	HubStateUpdateUpdating    HubStateUpdateStatus = "updating"
)

type HubStateSection struct {
	Availability HubStateAvailability `json:"availability"`
	UpdateStatus HubStateUpdateStatus  `json:"updateStatus"`
	Revision     uint64                `json:"revision"`
	UpdatedAt    string                `json:"updatedAt,omitempty"`
	LastAttemptAt string               `json:"lastAttemptAt,omitempty"`
	LastError    string                `json:"lastError,omitempty"`
	Data         any                   `json:"data,omitempty"`
}

type HubState struct {
	HubID     string                     `json:"hubId"`
	InstanceID string                    `json:"instanceId"`
	Sections  map[string]HubStateSection `json:"sections"`
}

type HubStateUpdateAck struct {
	Section  string `json:"section"`
	UpdateID string `json:"updateId"`
	Status   string `json:"status"`
}

type HubStateRefreshResponse struct {
	Accepted bool                `json:"accepted"`
	Updates  []HubStateUpdateAck `json:"updates"`
	State    HubState            `json:"state"`
}

type HubStateActionResponse struct {
	Accepted  bool `json:"accepted,omitempty"`
	Result    any  `json:"result,omitempty"`
	Operation any  `json:"operation,omitempty"`
}
```

Add `RegistryRouteReleasePublish`, constants `release.publish.start/get/updated`, client request descriptors for start/get, and a Hub-origin client event descriptor for updated. Do not change `DefaultProtocolVersion`.

- [ ] **Step 4: Replace the TypeScript HubState contract**

Update `registryTypes.ts` to match the Go contract and remove `releasePublish` from `RegistryHubStateSectionName`:

```ts
export type RegistryHubStateAvailability = 'empty' | 'ready';
export type RegistryHubStateUpdateStatus = 'idle' | 'queued' | 'updating';

export interface RegistryHubStateSection<TData = unknown> {
  availability: RegistryHubStateAvailability;
  updateStatus: RegistryHubStateUpdateStatus;
  revision: number;
  updatedAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  data?: TData;
}

export interface RegistryHubState {
  hubId: string;
  instanceId: string;
  sections: Record<string, RegistryHubStateSection>;
}

export interface RegistryHubStateRefreshResponse {
  accepted: boolean;
  updates: Array<{section: RegistryHubStateSectionName; updateId: string; status: string}>;
  state: RegistryHubState;
}
```

Add `ReleasePublishStart`, `ReleasePublishGet`, and `ReleasePublishUpdated` to `RegistryMethods`.

- [ ] **Step 5: Run protocol and TypeScript tests**

Run:

```powershell
cd server
go test ./internal/protocol -count=1
cd ..\app
npm test -- --runInBand __tests__/web-hub-state-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit the wire contract**

```powershell
git add server/internal/protocol/hub_state.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/__tests__/web-hub-state-service.test.ts
git commit -m "refactor(protocol): define unified hub state contract"
```

### Task 2: Replace HubStateManager with per-Section atomic queues

**Files:**
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_test.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go:54-70, 825-925, 983-990`

- [ ] **Step 1: Replace old manager tests with failing queue tests**

Keep clone-safety coverage and add deterministic channel-based tests:

```go
func TestHubStateRefreshReturnsBeforeUpdaterCompletesAndCoalesces(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	calls := atomic.Int32{}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"skills": []string{"scope"}}, nil
			},
		},
	}, nil)

	first, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false)
	if err != nil || !first.Accepted {
		t.Fatalf("first refresh = %#v, %v", first, err)
	}
	<-started
	second, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.Updates[0].UpdateID != second.Updates[0].UpdateID {
		t.Fatalf("duplicate refresh was not coalesced: %#v %#v", first, second)
	}
	close(release)
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
}

func TestHubStateForceDuringRunSchedulesOnlyOneRerun(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{}, 2)
	calls := atomic.Int32{}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				run := calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"run": run}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	<-started
	for range 2 {
		if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, true); err != nil {
			t.Fatal(err)
		}
	}
	release <- struct{}{}
	<-started
	release <- struct{}{}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2", calls.Load())
	}
}

func TestHubStateNotificationWinsOverOlderScan(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{}, 2)
	calls := atomic.Int32{}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				run := calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"source": "scan", "run": run}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	<-started
	manager.notify(
		hubStateSectionSkills,
		map[string]any{"source": "notification"},
		rp.HubStateAvailabilityReady,
		"",
		"skills-files-changed",
	)
	release <- struct{}{}
	<-started
	duringRerun := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got := duringRerun.Data.(map[string]any)["source"]; got != "notification" {
		t.Fatalf("data during rerun = %#v", duringRerun.Data)
	}
	release <- struct{}{}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	final := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got := final.Data.(map[string]any)["run"]; got != int32(2) {
		t.Fatalf("final data = %#v", final.Data)
	}
}

func TestHubStateRefreshFailureRetainsCommittedData(t *testing.T) {
	fail := atomic.Bool{}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				if fail.Load() {
					return nil, errors.New("scan failed")
				}
				return map[string]any{"version": 1}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	fail.Store(true)
	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, true); err != nil {
		t.Fatal(err)
	}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	got := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got.Availability != rp.HubStateAvailabilityReady ||
		got.UpdateStatus != rp.HubStateUpdateIdle ||
		got.LastError != "scan failed" {
		t.Fatalf("failed refresh state = %#v", got)
	}
	if got.Data.(map[string]any)["version"] != 1 {
		t.Fatalf("committed data was cleared: %#v", got.Data)
	}
}

func TestHubStateDifferentSectionsRunConcurrently(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})
	handler := func(section string) hubStateSectionHandler {
		return hubStateSectionHandler{
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				started <- section
				<-release
				return map[string]any{"section": section}, nil
			},
		}
	}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills:   handler(hubStateSectionSkills),
		hubStateSectionFileIndex: handler(hubStateSectionFileIndex),
	}, nil)

	if _, err := manager.enqueueRefresh(
		[]string{hubStateSectionSkills, hubStateSectionFileIndex},
		false,
	); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{
		waitHubStateStarted(t, started): true,
		waitHubStateStarted(t, started): true,
	}
	if !got[hubStateSectionSkills] || !got[hubStateSectionFileIndex] {
		t.Fatalf("started sections = %v", got)
	}
	close(release)
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	waitHubStateSectionIdle(t, manager, hubStateSectionFileIndex)
}
```

Add `waitHubStateSectionIdle` and `waitHubStateStarted` as test helpers that wait on manager/test channels with the test context deadline; do not use sleeps.

- [ ] **Step 2: Run the manager tests and verify failure**

Run:

```powershell
cd server
go test ./internal/hub -run 'TestHubState' -count=1
```

Expected: FAIL because the manager is synchronous and has no per-Section queue.

- [ ] **Step 3: Implement SectionController**

Replace the old aggregate status/action model with:

```go
type hubStateSectionController struct {
	mu            sync.Mutex
	section       rp.HubStateSection
	active        *hubStateUpdate
	pendingRerun  bool
	forceRerun    bool
	nextUpdateID  uint64
	handler       hubStateSectionHandler
}

type hubStateUpdate struct {
	id           string
	baseRevision uint64
	force        bool
}

type HubStateManager struct {
	hubID     string
	instanceID string
	sections  map[string]*hubStateSectionController
	now       func() time.Time
	publish   func(reason string, sections map[string]rp.HubStateSection)
}
```

`enqueueRefresh` validates all requested names, creates or reuses an active update, returns `rp.HubStateRefreshResponse` immediately, and launches each idle Section worker. A worker:

1. marks `updateStatus=updating` internally;
2. calls the handler outside the mutex;
3. commits a complete cloned `data` snapshot only when `baseRevision` still matches;
4. preserves old `data` on error;
5. starts one pending rerun when requested;
6. increments revision and publishes one terminal full Section on failure or when the successful business snapshot changed;
7. returns to idle without broadcasting when a successful snapshot is byte-equivalent to the committed canonical JSON and no externally visible error field changed.

Implement `notify(section, data, availability, lastError, reason)` as an immediate atomic commit that increments revision and marks any active update stale.

The manager is memory-only. Construct a new `instanceId` and empty Section controllers on every Hub process start; do not write HubState to HubConfig or disk.

- [ ] **Step 4: Adapt Reporter get/refresh/action handlers**

Change `replyHubStateRefresh` to return the immediate response:

```go
response, err := r.ensureHubStateManager().enqueueRefresh(payload.Sections, payload.Force)
if err != nil {
	_ = r.writeError(conn, req.RequestID, codeInvalidArgument, err.Error())
	return
}
_ = r.writeJSON(conn, "->", envelope{
	RequestID: req.RequestID,
	Type:      rp.RegistryEnvelopeTypeResponse,
	Method:    req.Method,
	HubID:     r.cfg.HubID,
	Payload:   rp.MustRaw(response),
})
```

Change get to return the new `rp.HubState`. Change action response handling so handler results are returned under `result/operation`; never assign them to Section `data`.

- [ ] **Step 5: Run focused Hub tests**

Run:

```powershell
cd server
go test ./internal/hub -run 'TestHubState|TestReporterHubState' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit the queue manager**

```powershell
git add server/internal/hub/hub_state.go server/internal/hub/hub_state_test.go server/internal/hub/hub_state_adapters.go server/internal/hub/reporter.go
git commit -m "refactor(hub): queue atomic section updates"
```

### Task 3: Make Reporter own bootstrap, reconnect snapshots, and terminal notifications

**Files:**
- Modify: `server/internal/hub/reporter.go:120-325, 1170-1290, 1540-1630`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/file_index.go:35-90, 145-210`
- Modify: `server/internal/hub/tools/manager.go:13-140`
- Modify: `server/internal/hub/tools/npm.go:61-100, 595-715`
- Modify: `server/internal/hub/tools/skills.go:90-155, 570-625`
- Test: `server/internal/hub/hub_test.go`
- Test: `server/internal/hub/tools/tools_test.go`

- [ ] **Step 1: Add failing lifecycle tests**

Add tests proving:

```go
func TestReporterBootstrapRefreshesOperationalSectionsOnce(t *testing.T) {
	h := newReporterHubStateHarness(t)
	for _, section := range bootstrapHubStateSections {
		h.stubSection(section, map[string]any{"section": section})
	}
	h.stubSection(hubStateSectionTokenStats, map[string]any{"unexpected": true})

	h.reporter.bootstrapHubState(context.Background())
	h.waitForPublish("bootstrap")

	for _, section := range bootstrapHubStateSections {
		if got := h.refreshCalls(section); got != 1 {
			t.Fatalf("%s refresh calls = %d, want 1", section, got)
		}
	}
	if got := h.refreshCalls(hubStateSectionTokenStats); got != 0 {
		t.Fatalf("tokenStats bootstrap calls = %d, want 0", got)
	}
	if got := h.publishCalls("bootstrap"); got != 1 {
		t.Fatalf("bootstrap publishes = %d, want 1", got)
	}
}

func TestReporterReconnectPublishesSnapshotWithoutRefreshing(t *testing.T) {
	h := newReporterHubStateHarness(t)
	h.seed(hubStateSectionSkills, map[string]any{"revision": "seed"})
	h.reporter.afterRegistryHandshake()
	h.waitForPublish("reconnect")
	firstRefreshes := h.totalRefreshCalls()

	h.reporter.afterRegistryHandshake()
	second := h.waitForPublish("reconnect")
	if h.totalRefreshCalls() != firstRefreshes {
		t.Fatalf("reconnect invoked refresh: before=%d after=%d", firstRefreshes, h.totalRefreshCalls())
	}
	if second.Sections[hubStateSectionSkills].Data.(map[string]any)["revision"] != "seed" {
		t.Fatalf("reconnect snapshot = %#v", second)
	}
}

func TestAsyncOperationCompletionRefreshesOneSection(t *testing.T) {
	for _, tc := range []struct {
		name    string
		section string
		invoke  func(*Reporter, tools.OperationDone)
	}{
		{"npm success", hubStateSectionAgentPackages, func(r *Reporter, done tools.OperationDone) { r.onNPMOperationDone(done) }},
		{"skills failure", hubStateSectionSkills, func(r *Reporter, done tools.OperationDone) { r.onSkillsOperationDone(done) }},
		{"file index failure", hubStateSectionFileIndex, func(r *Reporter, done tools.OperationDone) { r.onFileIndexOperationDone(done) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newReporterHubStateHarness(t)
			status := "succeeded"
			if strings.Contains(tc.name, "failure") {
				status = "failed"
			}
			tc.invoke(h.reporter, tools.OperationDone{Status: status, Scope: "project", Project: "hub-a:p1"})
			h.waitForSectionIdle(tc.section)
			if got := h.refreshedSections(); !reflect.DeepEqual(got, []string{tc.section}) {
				t.Fatalf("refreshed sections = %v, want [%s]", got, tc.section)
			}
		})
	}
}

func TestProjectTopologyChangeRefreshesSkillsAndFileIndex(t *testing.T) {
	h := newReporterHubStateHarness(t)
	h.reporter.replaceProjects([]ProjectInfo{{
		Name: "project",
		Path: t.TempDir(),
	}})
	h.waitForSectionsIdle(hubStateSectionSkills, hubStateSectionFileIndex)
	if got := h.refreshedSections(); !reflect.DeepEqual(
		got,
		[]string{hubStateSectionFileIndex, hubStateSectionSkills},
	) {
		t.Fatalf("add refreshed sections = %v", got)
	}

	h.resetRefreshCalls()
	h.reporter.replaceProjects([]ProjectInfo{{
		Name: "project",
		Path: t.TempDir(),
	}})
	h.waitForSectionsIdle(hubStateSectionSkills, hubStateSectionFileIndex)
	if got := h.refreshedSections(); !reflect.DeepEqual(
		got,
		[]string{hubStateSectionFileIndex, hubStateSectionSkills},
	) {
		t.Fatalf("path change refreshed sections = %v", got)
	}

	h.resetRefreshCalls()
	h.reporter.replaceProjects(nil)
	h.waitForSectionsIdle(hubStateSectionSkills, hubStateSectionFileIndex)
	if got := h.refreshedSections(); !reflect.DeepEqual(
		got,
		[]string{hubStateSectionFileIndex, hubStateSectionSkills},
	) {
		t.Fatalf("remove refreshed sections = %v", got)
	}
}

func TestWheelmakerUpdateRefreshCommitsInstalledVersion(t *testing.T) {
	h := newReporterHubStateHarness(t)
	h.stubTool(hubToolMethodUpdate, map[string]any{
		"ok":     true,
		"status": "ready",
		"hubId":  "hub-a",
		"installed": map[string]any{
			"version": "v1.2.3",
		},
	})
	if _, err := h.reporter.ensureHubStateManager().enqueueRefresh(
		[]string{hubStateSectionWheelmakerUpdate},
		true,
	); err != nil {
		t.Fatal(err)
	}
	h.waitForSectionIdle(hubStateSectionWheelmakerUpdate)
	section := h.reporter.ensureHubStateManager().
		get([]string{hubStateSectionWheelmakerUpdate}).
		Sections[hubStateSectionWheelmakerUpdate]
	data := section.Data.(map[string]any)
	if data["installed"].(map[string]any)["version"] != "v1.2.3" {
		t.Fatalf("wheelmakerUpdate data = %#v", data)
	}
}
```

Implement `newReporterHubStateHarness` in `hub_test.go` with injected Section handlers and a buffered publish recorder. Its wait methods consume manager/publish completion channels with the test context deadline. In `tools_test.go`, change completion callback tests to expect exactly one terminal callback on both success and failure.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run:

```powershell
cd server
go test ./internal/hub ./internal/hub/tools -run 'TestReporterBootstrap|TestReporterReconnect|TestAsyncOperationCompletion|OperationDone' -count=1
```

Expected: FAIL because bootstrap batching and failure callbacks do not exist.

- [ ] **Step 3: Add Reporter bootstrap and reconnect hooks**

Add:

```go
var bootstrapHubStateSections = []string{
	hubStateSectionAgentPackages,
	hubStateSectionWheelmakerUpdate,
	hubStateSectionSkills,
	hubStateSectionFileIndex,
	hubStateSectionFlickerBridge,
}

func (r *Reporter) bootstrapHubState(ctx context.Context) {
	r.ensureHubStateManager().enqueueBootstrap(ctx, bootstrapHubStateSections)
}

func (r *Reporter) publishCurrentHubState(reason string) {
	state := r.ensureHubStateManager().get(nil)
	_ = r.publishHubEvent(rp.RegistryMethodHubStateUpdated, map[string]any{
		"instanceId": state.InstanceID,
		"sections":  state.Sections,
		"reason":    reason,
	})
}
```

Start bootstrap once from `Reporter.Run`. After every successful handshake/report sequence, call `publishCurrentHubState("reconnect")` without invoking refresh handlers. Suppress individual bootstrap publishes and emit one full snapshot when the bootstrap batch settles.

- [ ] **Step 4: Wire terminal callbacks**

Change tool callbacks to carry terminal outcome:

```go
type OperationDone struct {
	Status  string
	Scope   string
	Project string
}

type ManagerConfig struct {
	OnNPMOperationDone    func(OperationDone)
	OnSkillsOperationDone func(OperationDone)
}
```

Invoke callbacks after both succeeded and failed operations. Add a File Index completion callback to `projectFileIndexManager`. Reporter callbacks enqueue:

```text
NPM       -> agentPackages
Skills    -> skills (targeted coordinator in Task 6)
FileIndex -> fileIndex
```

Flicker lifecycle continues using notification commits and publishes only stable `running/stopped/failed` snapshots.

Add `Reporter.replaceProjects` as the single topology reconciliation path used by startup/config reload and `UpdateProject`. When the Project ID set or a Project path changes, update the Skills coordinator and File Index project lists, then enqueue exactly `skills` and `fileIndex` once. Agent/git/worktree-only Project updates do not trigger these Sections. Initial Reporter construction records topology without a second refresh because bootstrap owns the first scan.

- [ ] **Step 5: Preserve Usage Service ownership**

Keep `usage.Service.Start`, its immediate startup scan, and its existing 10-minute interval unchanged. Preserve `reloadConfiguredRuntime` calling `usageService.Refresh` after API-key changes. Map `ScanScanning` to a visible `tokenStats` Section update without clearing committed data; map ready/error to terminal Section commits. Manual Monitor Refresh remains the only client UI trigger for `tokenStats`. Do not add `tokenStats` to Reporter bootstrap.

- [ ] **Step 6: Run Hub and Usage tests**

Run:

```powershell
cd server
go test ./internal/hub ./internal/hub/tools ./internal/hub/usage -count=1
```

Expected: PASS, including existing Usage interval tests.

- [ ] **Step 7: Commit lifecycle ownership**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub_state_adapters.go server/internal/hub/file_index.go server/internal/hub/tools/manager.go server/internal/hub/tools/npm.go server/internal/hub/tools/skills.go server/internal/hub/hub_test.go server/internal/hub/tools/tools_test.go
git commit -m "refactor(hub): publish owned section lifecycles"
```

### Task 4: Move Release Publishing out of HubState

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/registry/server.go:690-715, 1150-1270`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/hub/reporter.go:670-710, 900-980`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/tools/release.go:63-420`
- Modify: `server/internal/hub/tools/manager.go`
- Test: `server/internal/hub/tools/tools_test.go`

- [ ] **Step 1: Add failing routing and Job event tests**

Add:

```go
func TestReleasePublishRequestRoutesToPublishingHub(t *testing.T) {
	h := newRegistryRoutingHarness(t)
	h.connectHub("publisher")
	client := h.connectClient([]string{"publisher"})
	request := []byte(`{"type":"request","requestId":"r1","method":"release.publish.start","hubId":"publisher","payload":{"kind":"release"}}`)
	client.writeRaw(request)

	forwarded := h.readHubEnvelope("publisher")
	if forwarded.Method != rp.RegistryMethodReleasePublishStart || forwarded.HubID != "publisher" {
		t.Fatalf("forwarded envelope = %#v", forwarded)
	}
	h.replyFromHub("publisher", forwarded.RequestID, json.RawMessage(`{"accepted":true,"job":{"id":"job-1"}}`))
	response := client.readEnvelope()
	if response.RequestID != "r1" || !bytes.Contains(response.Payload, []byte(`"job-1"`)) {
		t.Fatalf("client response = %#v", response)
	}
}

func TestReleasePublishUpdatedBroadcastsWithinHubScope(t *testing.T) {
	h := newRegistryRoutingHarness(t)
	h.connectHub("publisher")
	allowed := h.connectClient([]string{"publisher"})
	denied := h.connectClient([]string{"other"})

	h.publishFromHub("publisher", rp.RegistryMethodReleasePublishUpdated, map[string]any{
		"job": map[string]any{"id": "job-1", "status": "success"},
	})
	if got := allowed.readEnvelope(); got.Method != rp.RegistryMethodReleasePublishUpdated {
		t.Fatalf("allowed event = %#v", got)
	}
	denied.assertNoEnvelope()
}

func TestReleaseCommandPublishesOnlyJobTransitions(t *testing.T) {
	var updates []releasePublishJob
	runner := newBlockingReleaseRunner()
	cmd := newReleaseCommandWithRunner(t.TempDir(), runner, nil)
	cmd.setJobUpdatedHandler(func(job releasePublishJob) {
		updates = append(updates, job)
	})
	job, err := cmd.Start(context.Background(), releasePublishRequest{Kind: "release"})
	if err != nil {
		t.Fatal(err)
	}
	runner.WaitStarted(t)
	cmd.appendLog(job.ID, "one")
	cmd.appendLog(job.ID, "two")
	if got := len(updates); got != 1 || updates[0].Status != releasePublishStatusRunning {
		t.Fatalf("updates before completion = %#v", updates)
	}
	runner.Complete(nil)
	final := waitReleaseJobTerminal(t, cmd, job.ID)
	if final.Status != releasePublishStatusSuccess {
		t.Fatalf("final job = %#v", final)
	}
	if got := jobStatuses(updates); !reflect.DeepEqual(got, []string{"running", "success"}) {
		t.Fatalf("published statuses = %v", got)
	}
}
```

Extend the existing Registry WebSocket harness with `readHubEnvelope`, `replyFromHub`, scoped client subscriptions, and a non-blocking `assertNoEnvelope`. Implement `newBlockingReleaseRunner` with `WaitStarted` and `Complete` channels so the test has no timing sleeps.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cd server
go test ./internal/registry ./internal/hub ./internal/hub/tools -run 'TestReleasePublish' -count=1
```

Expected: FAIL because Release Publishing still uses `hub.state.action`.

- [ ] **Step 3: Add Release Job request routing**

Route `release.publish.start/get` through a Hub-forward helper with the same scope checks and pending response handling as HubState, but keyed by `RegistryRouteReleasePublish`. Add `release.publish.updated` to the Hub event broadcast allowlist.

Reporter handles:

```go
case rp.RegistryMethodReleasePublishStart:
	r.replyReleasePublishStart(conn, in)
case rp.RegistryMethodReleasePublishGet:
	r.replyReleasePublishGet(conn, in)
```

`start` calls the existing `ReleaseCommand` start behavior; `get` maps to persisted Job lookup.

- [ ] **Step 4: Publish Job phase and terminal events**

Add an `OnJobUpdated` handler to `ReleaseCommand`. Call it after persisted transitions `running`, `transferring`, `notifying`, `success`, and `failed`, but not from `appendLog`. Reporter publishes:

```go
_ = r.publishHubEvent(rp.RegistryMethodReleasePublishUpdated, map[string]any{
	"job": job,
})
```

Remove `hubStateSectionReleasePublish`, its action validation, and its adapter.

- [ ] **Step 5: Run server tests**

Run:

```powershell
cd server
go test ./internal/protocol ./internal/registry ./internal/hub ./internal/hub/tools -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit Release Job routing**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/registry/server.go server/internal/registry/server_test.go server/internal/hub/reporter.go server/internal/hub/hub_state_adapters.go server/internal/hub/tools/release.go server/internal/hub/tools/manager.go server/internal/hub/tools/tools_test.go
git commit -m "refactor(release): separate publish jobs from hub state"
```

### Task 5: Build the canonical Skills inventory and effective projection

**Files:**
- Create: `server/internal/hub/skills_state.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Reuse: `server/internal/hub/agent/skills.go`

- [ ] **Step 1: Add failing inventory tests**

Add table-driven tests to `hub_test.go`:

```go
func TestSkillsStateBuildsLocationsSyncAndEffectiveSkills(t *testing.T) {
	root := t.TempDir()
	writeSkillFixture(t, filepath.Join(root, ".agents", "skills", "scope"), "Scope", "shared description")
	writeSkillFixture(t, filepath.Join(root, ".claude", "skills", "scope"), "Scope", "shared description")
	writeSkillFixture(t, filepath.Join(root, ".agents", "skills", "codex-only"), "Codex", "codex description")

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
	if state.Inventory["codex-only"].Sync.Status != skillSyncAgentsOnly {
		t.Fatalf("codex-only sync = %#v", state.Inventory["codex-only"].Sync)
	}
	if _, ok := state.EffectiveByAgent["codex"]["scope"]; !ok {
		t.Fatal("codex effective skills missing scope")
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
	assertSkillNames(t, got.EffectiveSkills["hub-a:p1"]["codex"], "hub-skill", "local-one")
	assertSkillNames(t, got.EffectiveSkills["hub-a:p2"]["claude"], "hub-skill", "local-two")
}
```

- [ ] **Step 2: Run the focused Skills tests and verify failure**

Run:

```powershell
cd server
go test ./internal/hub -run 'TestSkillsState|TestHubSkillChange' -count=1
```

Expected: FAIL because canonical inventory types do not exist.

- [ ] **Step 3: Implement inventory models and scanning**

Create focused models:

```go
type skillSyncStatus string

const (
	skillSyncAligned         skillSyncStatus = "aligned"
	skillSyncAgentsOnly      skillSyncStatus = "agentsOnly"
	skillSyncClaudeOnly      skillSyncStatus = "claudeOnly"
	skillSyncContentMismatch skillSyncStatus = "contentMismatch"
	skillSyncUnknown         skillSyncStatus = "unknown"
)

type skillLocation struct {
	Path        string `json:"path"`
	Fingerprint string `json:"fingerprint"`
}

type skillInventoryItem struct {
	Name        string                    `json:"name"`
	Description string                    `json:"description,omitempty"`
	Managed     bool                      `json:"managed"`
	Agents      []string                  `json:"agents"`
	Locations   map[string]skillLocation  `json:"locations"`
	Sync        skillSyncDiagnostic       `json:"sync"`
}

type skillsStateSnapshot struct {
	HubInventory            map[string]skillInventoryItem            `json:"hubInventory"`
	ProjectLocalInventories map[string]map[string]skillInventoryItem `json:"projectLocalInventories"`
	EffectiveSkills         map[string]map[string][]skillInventoryItem `json:"effectiveSkills"`
}
```

Read only Skill roots, `SKILL.md`, resolved link targets, and managed lock metadata. Reuse provider discovery from `agent.ListProviderSkills` to preserve actual Agent visibility and descriptions; do not emit Project report data.

- [ ] **Step 4: Add targeted Skills coordinator**

Reporter owns a coordinator with:

```go
func (c *skillsStateCoordinator) RefreshAll(ctx context.Context) (skillsStateSnapshot, error)
func (c *skillsStateCoordinator) RefreshHub(ctx context.Context) (skillsStateSnapshot, error)
func (c *skillsStateCoordinator) RefreshProject(ctx context.Context, projectID string) (skillsStateSnapshot, error)
```

Each targeted method clones committed inventories, replaces only the scanned target, re-derives effective Skills, and returns one complete snapshot for atomic `skills` commit. HubState `skills` refresh calls `RefreshAll`; operation completion calls Hub or Project targeting.

- [ ] **Step 5: Run Skills tests**

Run:

```powershell
cd server
go test ./internal/hub -run 'TestSkillsState|TestHubSkillChange|TestHubStateSkills' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit the Skills authority**

```powershell
git add server/internal/hub/skills_state.go server/internal/hub/hub_state_adapters.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "refactor(skills): build canonical hub state inventory"
```

### Task 6: Add targeted Skills filesystem notifications

**Files:**
- Create: `server/internal/hub/skills_watcher.go`
- Modify: `server/go.mod`
- Modify: `server/go.sum`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Add failing watcher debounce tests**

Use an injected watcher interface rather than real OS timing:

```go
func TestSkillsWatcherDebouncesEventsPerTarget(t *testing.T) {
	events := make(chan fsnotify.Event, 8)
	triggered := make(chan skillsWatchTarget, 8)
	clock := newFakeDebounceClock()
	watcher := newSkillsWatcher(skillsWatcherOptions{
		Events:   events,
		After:    clock.After,
		OnChange: func(target skillsWatchTarget) { triggered <- target },
	})
	watcher.TrackProject("hub-a:project", "project", t.TempDir())

	events <- fsnotify.Event{Name: watcher.projectAgentsRoot("hub-a:project"), Op: fsnotify.Write}
	events <- fsnotify.Event{Name: watcher.projectClaudeRoot("hub-a:project"), Op: fsnotify.Write}
	clock.Fire(750 * time.Millisecond)

	if got := <-triggered; got.ProjectID != "hub-a:project" {
		t.Fatalf("target = %#v", got)
	}
	select {
	case extra := <-triggered:
		t.Fatalf("unexpected duplicate trigger %#v", extra)
	default:
	}
}
```

Also test dynamic Project add/remove, missing roots created later, and watcher error recovery through manual refresh.

- [ ] **Step 2: Add fsnotify and run the failing test**

Run:

```powershell
cd server
go get github.com/fsnotify/fsnotify@v1.10.1
go test ./internal/hub -run 'TestSkillsWatcher' -count=1
```

Expected: FAIL because `skillsWatcher` is not implemented.

- [ ] **Step 3: Implement the watcher**

Create a small wrapper around `fsnotify.Watcher` that:

- watches Hub and Project roots needed to observe `.agents`, `.claude`, Skill directories, and `skills-lock.json`;
- filters unrelated root events;
- updates watched directories when Projects or Skill directories appear/disappear;
- aggregates by Hub or Project target;
- emits one callback after 750ms;
- releases all watches on Reporter shutdown.

The callback calls `RefreshHub` or `RefreshProject`; successful changed snapshots notify HubState. Watcher errors record diagnostics but do not start a periodic fallback.

- [ ] **Step 4: Run Hub tests including a real temporary-directory smoke test**

Run:

```powershell
cd server
go test ./internal/hub -run 'TestSkillsWatcher' -count=1
go test ./internal/hub -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit filesystem notifications**

```powershell
git add server/go.mod server/go.sum server/internal/hub/skills_watcher.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(skills): watch hub and project inventories"
```

### Task 7: Delete Project `agentProfiles` and the second Skills path

**Files:**
- Modify: `server/internal/protocol/registry.go:30-45, 223-235`
- Modify: `server/internal/hub/hub.go:430-490`
- Modify: `server/internal/hub/reporter.go:1540-1630`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Add failing hard-cut tests**

```go
func TestProjectInfoHasNoAgentProfilesField(t *testing.T) {
	if _, ok := reflect.TypeOf(rp.ProjectInfo{}).FieldByName("AgentProfiles"); ok {
		t.Fatal("ProjectInfo still exposes AgentProfiles")
	}
}

func TestProjectListDoesNotContainAgentProfiles(t *testing.T) {
	raw := mustProjectListResponse(t)
	if bytes.Contains(raw, []byte("agentProfiles")) {
		t.Fatalf("project list leaked agentProfiles: %s", raw)
	}
}
```

Delete tests that assert Project report Skills, replacing them with assertions against the canonical `skills` Section from Task 5.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cd server
go test ./internal/protocol ./internal/hub ./internal/registry -run 'AgentProfiles|ProjectListDoesNotContain' -count=1
```

Expected: FAIL because the old fields and collectors still exist.

- [ ] **Step 3: Remove the old path**

Delete:

- `ProjectAgentProfile`;
- `ProjectInfo.AgentProfiles`;
- `ProjectListItem.AgentProfiles`;
- `collectProjectAgentProfiles`;
- startup calls that populate profiles;
- `refreshSkillsAgentProfiles`;
- Registry projection/normalization of profiles.

Keep `agent.ListProviderSkills` because the canonical Skills inventory uses it internally; it must no longer write Project reports.

- [ ] **Step 4: Run all server tests**

Run:

```powershell
cd server
go test ./... -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit the hard cut**

```powershell
git add server/internal/protocol/registry.go server/internal/hub/hub.go server/internal/hub/reporter.go server/internal/registry/server.go server/internal/hub/hub_test.go server/internal/registry/server_test.go
git commit -m "refactor(skills): remove project profile reports"
```

### Task 8: Add the Web HubStore and repository normalization

**Files:**
- Create: `app/web/src/hubState/hubStore.ts`
- Create: `app/web/src/hubState/hubStore.test.ts`
- Create: `app/web/src/hubState/hubSelectors.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts:237-370, 2080-2160`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts:889-925`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Add failing HubStore tests**

```ts
test('replaces an older process instance and rejects older section revisions', () => {
  const store = new HubStore();
  store.replace({
    hubId: 'hub-a',
    instanceId: 'instance-a',
    sections: {skills: section(3, {name: 'old'})},
  });
  store.ingest(updated('hub-a', 'instance-a', {skills: section(2, {name: 'stale'})}));
  expect(store.getSection('hub-a', 'skills')?.data).toEqual({name: 'old'});

  store.ingest(updated('hub-a', 'instance-b', {skills: section(1, {name: 'new-process'})}));
  expect(store.getSection('hub-a', 'skills')?.data).toEqual({name: 'new-process'});
});

test('coalesces refresh calls while a section is queued or updating', async () => {
  const request = jest.fn(() => Promise.resolve(refreshAck('skills', 'skills:1')));
  const store = new HubStore({refresh: request});
  await Promise.all([
    store.refresh('hub-a', ['skills']),
    store.refresh('hub-a', ['skills']),
  ]);
  expect(request).toHaveBeenCalledTimes(1);
});

test('discovers a Hub with get once and does not refresh it', async () => {
  const get = jest.fn(async () => hubState('hub-a', 'instance-a', {
    skills: section(1, {name: 'scope'}),
  }));
  const refresh = jest.fn();
  const store = new HubStore({get, refresh});
  await store.discover(['hub-a']);
  await store.discover(['hub-a']);
  expect(get).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(store.getSection('hub-a', 'skills')?.revision).toBe(1);
});

test('wheelmaker selector keeps the installed version while refreshing', () => {
  const state = hubState('hub-a', 'instance-a', {
    wheelmakerUpdate: {
      ...section(4, {
        ok: true,
        status: 'ready',
        hubId: 'hub-a',
        installed: {version: 'v1.2.3'},
        canRequestUpdate: true,
      }),
      updateStatus: 'updating',
    },
  });
  expect(selectWheelmakerUpdate(state).installed?.version).toBe('v1.2.3');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubStore.test.ts
```

Expected: FAIL because HubStore does not exist.

- [ ] **Step 3: Implement HubStore**

Implement:

```ts
export interface HubStoreSnapshot {
  hubs: Record<string, RegistryHubState>;
}

export interface HubStoreOptions {
  get?: (hubId: string) => Promise<RegistryHubState>;
  refresh?: (
    hubId: string,
    sections: RegistryHubStateSectionName[],
    force: boolean,
  ) => Promise<RegistryHubStateRefreshResponse>;
}

export class HubStore {
  private hubs = new Map<string, RegistryHubState>();
  private listeners = new Set<(snapshot: HubStoreSnapshot) => void>();
  private inFlight = new Map<string, Promise<RegistryHubStateRefreshResponse>>();

  constructor(options: HubStoreOptions = {});
  replace(state: RegistryHubState): void;
  ingest(event: RegistryEnvelope): void;
  getHub(hubId: string): RegistryHubState | undefined;
  getSection<T>(hubId: string, section: RegistryHubStateSectionName): RegistryHubStateSection<T> | undefined;
  discover(hubIds: string[]): Promise<void>;
  refresh(hubId: string, sections: RegistryHubStateSectionName[], force?: boolean): Promise<RegistryHubStateRefreshResponse>;
  subscribe(listener: (snapshot: HubStoreSnapshot) => void): () => void;
}
```

On a new `instanceId`, replace the full Hub record. Within one instance, apply only Sections with a greater revision. `discover` calls `hub.state.get` only for previously unseen Hub IDs, coalesces concurrent gets, and never invokes refresh. Key in-flight refreshes by `hubId + sorted sections + force`; clear keys in `finally`.

- [ ] **Step 4: Update repository parsing**

Normalize the new fields without inventing fallback old statuses. `refreshHubState` returns `RegistryHubStateRefreshResponse`, while `getHubState` returns state. `runHubStateAction` returns action result/operation rather than reading mutable Section data.

Add pure selectors in `hubSelectors.ts` for WheelMaker, NPM, Skills, File Index, Flicker, and Token Stats so `WorkspaceApp` does not parse raw `unknown`.

Wire Registry Hub discovery to `hubStore.discover(registryHubIds)`. Ingest `hub.state.updated` envelopes into the same store. Do not add a discovery-time scan or a polling effect.

- [ ] **Step 5: Run Web tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubStore.test.ts __tests__/web-hub-state-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit HubStore**

```powershell
git add app/web/src/hubState app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-hub-state-service.test.ts
git commit -m "refactor(web): centralize hub state storage"
```

### Task 9: Preserve Usage as the always-on HubStore projection

**Files:**
- Modify: `app/web/src/usage/usageStore.ts`
- Modify: `app/__tests__/web-usage-store.test.ts`
- Create: `app/web/src/usage/MonitorSurface.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx:3327-3335, 12290-12335, 15580-15630, 18480-18510, 20760-20780`
- Test: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Add failing Usage projection tests**

```ts
test('projects tokenStats from HubStore and keeps newer generations', () => {
  const hubStore = new HubStore();
  const usage = new UsageStore();
  const unsubscribe = usage.bindHubStore(hubStore);

  hubStore.replace(hubState('hub-a', 'instance-a', {
    tokenStats: section(1, usageSnapshot(4, 'ready', 75)),
  }));
  hubStore.ingest(updated('hub-a', 'instance-a', {
    tokenStats: section(2, usageSnapshot(5, 'ready', 60)),
  }));

  expect(usage.snapshot().providers[0].remainingPercent).toBe(60);
  unsubscribe();
});

test('opening monitor does not request tokenStats refresh', () => {
  const refreshLimits = jest.fn();
  const refreshIq = jest.fn();
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <MonitorSurface
        usageSnapshot={{refreshing: false, providers: []}}
        efficiencySnapshot={{status: 'idle', refreshing: false, items: []}}
        onRefreshLimits={refreshLimits}
        onRefreshIq={refreshIq}
        onRequestHide={jest.fn()}
      />,
    );
  });
  expect(refreshLimits).not.toHaveBeenCalled();
  expect(refreshIq).not.toHaveBeenCalled();

  act(() => {
    tree!.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick();
  });
  expect(refreshLimits).toHaveBeenCalledTimes(1);
  expect(refreshIq).toHaveBeenCalledTimes(1);
});

test('opening mobile monitor only refreshes from its button', () => {
  const refreshLimits = jest.fn();
  const refreshIq = jest.fn();
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <MobileUsageDialog
        snapshot={{refreshing: false, providers: []}}
        efficiencySnapshot={{status: 'idle', refreshing: false, items: []}}
        onRefresh={refreshLimits}
        onRefreshEfficiency={refreshIq}
        onClose={jest.fn()}
      />,
    );
  });
  expect(refreshLimits).not.toHaveBeenCalled();
  expect(refreshIq).not.toHaveBeenCalled();
  act(() => {
    tree!.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick();
  });
  expect(refreshLimits).toHaveBeenCalledTimes(1);
  expect(refreshIq).toHaveBeenCalledTimes(1);
});
```

Put the projection case in `web-usage-store.test.ts` and the render/click case in the new `MonitorSurface.test.tsx`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-usage-store.test.ts web/src/usage/MonitorSurface.test.tsx __tests__/web-hub-state-service.test.ts
```

Expected: FAIL because UsageStore still owns direct HubState ingestion.

- [ ] **Step 3: Bind UsageStore to HubStore**

Replace direct Registry event parsing and per-Hub get effects with a HubStore subscription:

```ts
bindHubStore(hubStore: HubStore): () => void {
  return hubStore.subscribe(snapshot => {
    const next = new Map<string, UsageHubSnapshot>();
    for (const [hubId, hub] of Object.entries(snapshot.hubs)) {
      const parsed = parseHubSnapshot(hub.sections.tokenStats?.data);
      if (parsed) next.set(hubId, parsed);
    }
    this.replaceAll(next);
  });
}
```

Keep explicit `refreshUsageAcrossHubs` for the Refresh button. Opening/rendering Monitor only consumes the projection. Do not change server-side 10-minute scanning or Usage history queries.

- [ ] **Step 4: Run Usage tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-usage-store.test.ts web/src/usage/MonitorSurface.test.tsx __tests__/web-hub-state-service.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit Usage projection**

```powershell
git add app/web/src/usage/usageStore.ts app/web/src/usage/MonitorSurface.test.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-usage-store.test.ts app/__tests__/web-hub-state-service.test.ts
git commit -m "refactor(usage): project limits from hub store"
```

### Task 10: Migrate Hub menu operational data and remove frontend polling

**Files:**
- Create: `app/web/src/hubState/hubRefreshTriggers.ts`
- Create: `app/web/src/hubState/hubRefreshTriggers.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx:3000-3770, 12900-14050, 15580-15630`
- Modify: `app/web/src/app/ChatHubMenu.tsx:120-260, 930-1220`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/__tests__/web-hub-flicker-bridge-menu.test.ts`
- Modify: `app/__tests__/web-skill-management-view.test.ts`

- [ ] **Step 1: Add failing UI trigger tests**

Add a small edge controller test so React renders cannot retrigger refreshes:

```ts
test('menu open refreshes only wheelmakerUpdate and hub expand refreshes operational summaries once', async () => {
  const refresh = jest.fn(async () => refreshAck());
  const triggers = new HubRefreshTriggers(refresh);

  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setMenuOpen(true, ['hub-a']);
  expect(refresh).toHaveBeenCalledWith('hub-a', ['wheelmakerUpdate'], false);

  await triggers.setHubExpanded('hub-a', true);
  await triggers.setHubExpanded('hub-a', true);
  expect(refresh).toHaveBeenCalledWith(
    'hub-a',
    ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
    false,
  );

  expect(refresh).toHaveBeenCalledTimes(2);
});

test('closing and reopening creates one new menu-open edge', async () => {
  const refresh = jest.fn(async () => refreshAck());
  const triggers = new HubRefreshTriggers(refresh);
  await triggers.setMenuOpen(true, ['hub-a']);
  await triggers.setMenuOpen(false, ['hub-a']);
  await triggers.setMenuOpen(true, ['hub-a']);
  expect(refresh).toHaveBeenCalledTimes(2);
});
```

In `ChatHubMenu.test.tsx`, call the existing `onToggleSection` callback for NPM, Global Skills, Project Skills, and scan details and assert no HubState refresh callback is present or invoked by those detail toggles.

- [ ] **Step 2: Run menu tests and verify failure**

Run:

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubRefreshTriggers.test.ts web/src/app/ChatHubMenu.test.tsx __tests__/web-hub-flicker-bridge-menu.test.ts __tests__/web-skill-management-view.test.ts
```

Expected: FAIL because the edge controller does not exist and the current Workspace wiring refreshes/polls independently.

- [ ] **Step 3: Implement the edge controller and replace independent state maps**

Create:

```ts
type RefreshHubState = (
  hubId: string,
  sections: RegistryHubStateSectionName[],
  force: boolean,
) => Promise<RegistryHubStateRefreshResponse>;

export class HubRefreshTriggers {
  private menuOpen = false;
  private readonly expanded = new Set<string>();

  constructor(private readonly refresh: RefreshHubState) {}

  async setMenuOpen(open: boolean, hubIds: string[]): Promise<void> {
    const opening = open && !this.menuOpen;
    this.menuOpen = open;
    if (!opening) return;
    await Promise.all(hubIds.map(hubId =>
      this.refresh(hubId, ['wheelmakerUpdate'], false),
    ));
  }

  async setHubExpanded(hubId: string, expanded: boolean): Promise<void> {
    const opening = expanded && !this.expanded.has(hubId);
    if (expanded) this.expanded.add(hubId);
    else this.expanded.delete(hubId);
    if (!opening) return;
    await this.refresh(
      hubId,
      ['flickerBridge', 'agentPackages', 'skills', 'fileIndex'],
      false,
    );
  }
}
```

Delete `wheelMakerUpdateHubs`, `agentPackageHubs`, `skillHubs`, `projectIndexByHubId`, `chatHubFlickerBridgeStatuses`, their request-generation refs, and refresh refs. Build `chatHubOpsByHubId` from `HubStoreSnapshot` using Task 8 selectors.

Keep mutation-specific pending UI state only for the confirmation currently being submitted; clear it from terminal HubState events instead of polling.

- [ ] **Step 4: Implement exact menu trigger edges**

Create one controller per `HubStore` and invoke it only from the existing menu-toggle and Hub-toggle event handlers. On menu closed→open:

```ts
void hubRefreshTriggers.setMenuOpen(true, registryHubIds);
```

On Hub collapsed→expanded:

```ts
void hubRefreshTriggers.setHubExpanded(hubId, true);
```

Pass `false` on the corresponding close/collapse handlers so the next real open is a new edge. Do not refresh on Settings/NPM/Global Skills/Project Skills/Scan detail toggle. Settings may independently call `hub.config.get`.

- [ ] **Step 5: Delete operational polling**

Remove:

- `scheduleWheelMakerUpdatePoll`;
- `scheduleSkillOperationPoll`;
- `scheduleProjectIndexPoll`;
- `agentPackageScanPollTimerRef`;
- the associated clear functions and `updateSurfaceActiveRef`.

Actions return accepted operation data; final Section events update HubStore and clear pending UI. Leave unrelated application intervals untouched.

- [ ] **Step 6: Run menu tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubRefreshTriggers.test.ts web/src/app/ChatHubMenu.test.tsx __tests__/web-hub-flicker-bridge-menu.test.ts __tests__/web-skill-management-view.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit Hub menu migration**

```powershell
git add app/web/src/hubState/hubRefreshTriggers.ts app/web/src/hubState/hubRefreshTriggers.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/__tests__/web-hub-flicker-bridge-menu.test.ts app/__tests__/web-skill-management-view.test.ts
git commit -m "refactor(web): drive hub menu from hub store"
```

### Task 11: Move Composer suggestions and Skills diagnostics to `skills`

**Files:**
- Modify: `app/web/src/hubState/hubSelectors.ts`
- Modify: `app/web/src/registry/registryTypes.ts:780-870, 990-1020`
- Modify: `app/web/src/registry/RegistryRepository.ts:880-925`
- Modify: `app/web/src/app/WorkspaceApp.tsx:4100-4150, 12900-13020`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Modify: `app/__tests__/web-skill-management-service.test.ts`
- Modify: `app/__tests__/web-skill-management-view.test.ts`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/__tests__/web-chat-inline-composer-wiring.test.ts`

- [ ] **Step 1: Add failing Composer and diagnostic tests**

```ts
test('composer reads effective skills for the current project and agent', () => {
  const state = skillsState({
    projectId: 'hub-a:project',
    agent: 'claude',
    skills: [{name: 'scope', description: 'Clarify requirements'}],
  });
  const options = selectComposerSkills(state, 'hub-a:project', 'claude');
  expect(options).toEqual([{name: 'scope', description: 'Clarify requirements'}]);
});

test('skills mismatch is non-blocking and visible in menu and composer', () => {
  const state = skillsStateWithSync('contentMismatch');
  const menu = renderSkillsMenu(state);
  expect(menu.getByText('content differs')).toBeTruthy();
  expect(selectComposerSkills(state, 'hub-a:project', 'claude')).toHaveLength(1);
  expect(selectComposerDiagnostic(state, 'hub-a:project')).toContain('differ');
});

test('project payload no longer normalizes agentProfiles', () => {
  const project = normalizeProject({agentProfiles: [{name: 'codex', skills: ['old']}]});
  expect('agentProfiles' in project).toBe(false);
});

test('opening cached slash and file mention menus does not refresh HubState', () => {
  const source = readFileSync(workspaceAppPath, 'utf8');
  const slashOpen = source.slice(
    source.indexOf('const openChatPromptMenu = useCallback'),
    source.indexOf('const toggleChatAttachmentTray'),
  );
  const mentionOpen = source.slice(
    source.indexOf('const openChatFileMentionMenu = useCallback'),
    source.indexOf('const closeChatFileMentionMenu'),
  );
  expect(slashOpen).not.toMatch(/refreshHubState|hubStore\.refresh/);
  expect(mentionOpen).not.toMatch(/refreshHubState|hubStore\.refresh/);
});
```

- [ ] **Step 2: Run Skills Web tests and verify failure**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-skill-management-service.test.ts __tests__/web-skill-management-view.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-chat-inline-composer-wiring.test.ts web/src/app/ChatHubMenu.test.tsx
```

Expected: FAIL because Composer still reads `agentProfiles`.

- [ ] **Step 3: Remove Web `agentProfiles`**

Implement `selectComposerSkills` and `selectComposerDiagnostic` in `hubSelectors.ts`. Delete `RegistryProjectAgentProfile`, `agentProfiles` from Project types, repository normalization, fixtures, and test data. Replace `chatSlashSkills` with:

```ts
const chatSlashSkills = useMemo(
  () => selectComposerSkills(
    hubStoreSnapshot,
    selectedChatKey?.projectId ?? projectId,
    selectedChatConfig?.agent ?? currentProject?.agent ?? '',
  ),
  [hubStoreSnapshot, selectedChatKey?.projectId, projectId, selectedChatConfig?.agent, currentProject?.agent],
);
```

No Project Snapshot or fallback path may contribute suggestions.

- [ ] **Step 4: Render sync diagnostics**

Add location and sync fields to Registry Skills types. Hub/Project Skills summary shows an amber mismatch count; each row renders `.agents only`, `.claude only`, or `content differs`. Composer Slash Menu renders one non-blocking footer for the active Project while retaining available options.

Opening the Slash Menu only selects cached `effectiveSkills`; opening or typing in File Mention only queries the committed File Index. Neither path invokes `hubStore.refresh`. Do not add a global Toast, automatic repair, or recursive supporting-file comparison.

- [ ] **Step 5: Run Skills tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-skill-management-service.test.ts __tests__/web-skill-management-view.test.ts __tests__/web-skill-management-settings.test.ts __tests__/web-chat-inline-composer-wiring.test.ts web/src/app/ChatHubMenu.test.tsx
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit Skills UI authority**

```powershell
git add app/web/src/hubState/hubSelectors.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/app/WorkspaceApp.tsx app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/__tests__/web-skill-management-service.test.ts app/__tests__/web-skill-management-view.test.ts app/__tests__/web-skill-management-settings.test.ts app/__tests__/web-chat-inline-composer-wiring.test.ts
git commit -m "refactor(web): source skills from hub state"
```

### Task 12: Move Release Publishing Web UI to Job events

**Files:**
- Modify: `app/web/src/registry/RegistryRepository.ts:2290-2330`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts:1015-1030`
- Create: `app/web/src/registry/releasePublishStore.ts`
- Modify: `app/web/src/settings/ReleasePublishSettings.tsx`
- Modify: `app/web/src/settings/ReleasePublishSettings.test.tsx`
- Modify: `app/web/src/registry/releasePublishState.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx:13780-13800, 15580-15630, 15970-16000`

- [ ] **Step 1: Add failing no-poll event tests**

```ts
test('release page queries once and follows release.publish.updated events', async () => {
  jest.useFakeTimers();
  const values = new Map<string, string>([[
    'wheelmaker.settings.release-publish.v1',
    JSON.stringify({jobId: 'job-1', jobHubId: 'publisher'}),
  ]]);
  (global as typeof globalThis & {window: Window}).window = {
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  } as unknown as Window;
  const query = jest.fn(async () => releaseResponse('running'));
  const updates = new ReleasePublishStore();
  let tree: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ReleasePublishSettings
        hubIds={['publisher']}
        start={start}
        query={query}
        subscribe={listener => updates.subscribe(listener)}
      />,
    );
    await Promise.resolve();
  });
  jest.advanceTimersByTime(10_000);
  expect(query).toHaveBeenCalledTimes(1);

  act(() => {
    updates.ingest(releaseUpdated('publisher', releaseJob('job-1', 'success')));
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('success');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cd app
npm test -- --runInBand web/src/settings/ReleasePublishSettings.test.tsx web/src/registry/releasePublishState.test.ts
```

Expected: FAIL because the page uses `setInterval`.

- [ ] **Step 3: Use Release Job methods and event store**

Repository sends:

```ts
request({method: RegistryMethods.ReleasePublishStart, hubId, payload: input});
request({method: RegistryMethods.ReleasePublishGet, hubId, payload: {jobId}});
```

Add a small ReleasePublishStore keyed by `publishingHubId + jobId`:

```ts
export type ReleasePublishListener = (
  publishingHubId: string,
  job: ReleasePublishJob,
) => void;

export class ReleasePublishStore {
  private readonly jobs = new Map<string, ReleasePublishJob>();
  private readonly listeners = new Set<ReleasePublishListener>();

  ingest(envelope: RegistryEnvelope): boolean {
    const parsed = parseReleasePublishUpdated(envelope);
    if (!parsed) return false;
    this.jobs.set(`${parsed.hubId}\0${parsed.job.id}`, parsed.job);
    for (const listener of this.listeners) listener(parsed.hubId, parsed.job);
    return true;
  }

  get(hubId: string, jobId: string): ReleasePublishJob | undefined {
    return this.jobs.get(`${hubId}\0${jobId}`);
  }

  subscribe(listener: ReleasePublishListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

Workspace ingests `ReleasePublishUpdated`; the page queries the saved Job once on mount and subscribes to subsequent events.

- [ ] **Step 4: Remove the 2-second interval**

Delete `window.setInterval` from `ReleasePublishSettings`. Preserve localStorage for selected Hubs, source path, options, and current Job ID. Job event updates replace the displayed full Job.

- [ ] **Step 5: Run Release tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand web/src/settings/ReleasePublishSettings.test.tsx web/src/registry/releasePublishState.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit Release Publishing UI**

```powershell
git add app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/web/src/registry/releasePublishStore.ts app/web/src/settings/ReleasePublishSettings.tsx app/web/src/settings/ReleasePublishSettings.test.tsx app/web/src/registry/releasePublishState.test.ts app/web/src/app/WorkspaceApp.tsx
git commit -m "refactor(web): subscribe to release publish jobs"
```

### Task 13: Run hard-cut integration verification and finish documentation

**Files:**
- Modify: `docs/scope/2026-07-31-hub-state-unification/spec-hub-state-unification.md` only if implementation reveals an approved-contract clarification
- Modify: `docs/wiki/architecture/hub-state.md` only if implementation names differ from the approved contract
- Modify: `docs/wiki/protocols/registry.md` only if final payload fields differ
- Modify: `docs/wiki/frontend-interaction/hub-menu.md` only if final UI trigger wiring differs
- Test: `server/internal/protocol/registry_methods_test.go`
- Test: `server/internal/registry/server_test.go`
- Test: `server/internal/hub/hub_state_test.go`
- Test: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Scan for removed paths and forbidden polling**

Run:

```powershell
rg -n --glob '!**/dist/**' 'AgentProfiles|agentProfiles|hubStateSectionReleasePublish|releasePublish.*hub.state|scheduleSkillOperationPoll|scheduleProjectIndexPoll|scheduleWheelMakerUpdatePoll' server app/web/src app/__tests__
```

Expected: no production references to removed `agentProfiles`, HubState `releasePublish`, or the three operational poll schedulers. Historical scope/wiki text may name removed concepts intentionally.

- [ ] **Step 2: Verify protocol stays at 2.6**

Run:

```powershell
rg -n 'DefaultProtocolVersion = \"2.6\"' server/internal/protocol/registry.go
rg -n \"RegistryProtocolVersion = '2.6'\" app/web/src/registry/registryMethods.ts
```

Expected: one matching Go constant and one matching Web constant.

- [ ] **Step 3: Run complete Server verification**

Run:

```powershell
cd server
go test ./... -count=1
go build ./cmd/wheelmaker/
```

Expected: all packages PASS and build exits 0.

- [ ] **Step 4: Run complete Web verification**

Run:

```powershell
cd app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: all Jest suites PASS, TypeScript exits 0, and webpack completes successfully.

- [ ] **Step 5: Check formatting and documentation consistency**

Run:

```powershell
git diff --check
rg -n 'T[B]D|T[O]DO|implement[ ]later' docs/scope/2026-07-31-hub-state-unification docs/wiki/architecture/hub-state.md docs/wiki/protocols/registry.md docs/wiki/frontend-interaction/hub-menu.md
git status --short
```

Expected: `git diff --check` exits 0, the dangerous-marker search returns no matches, and status contains only intended task files.

- [ ] **Step 6: Rebase, rerun targeted smoke tests, and commit final adjustments**

```powershell
git fetch origin
git rebase origin/main
cd server
go test ./internal/protocol ./internal/registry ./internal/hub ./internal/hub/usage -count=1
cd ..\app
npm test -- --runInBand __tests__/web-hub-state-service.test.ts web/src/app/ChatHubMenu.test.tsx __tests__/web-usage-store.test.ts web/src/usage/MonitorSurface.test.tsx web/src/settings/ReleasePublishSettings.test.tsx
cd ..
git add -A
git commit -m "docs(hub): finalize unified state architecture"
git push origin feat/hub-state-unification
```

Expected: rebase succeeds, targeted tests PASS, and the exact final add/commit/push sequence succeeds. The approved spec, plan, and wiki updates remain for this final commit, so it is not empty.

### Task 14: Complete the configured Git delivery workflow

**Files:**
- No source changes expected.

- [ ] **Step 1: Confirm the worktree is clean**

Run:

```powershell
git status --short --branch
```

Expected: clean `feat/hub-state-unification` worktree.

- [ ] **Step 2: Confirm the pushed feature branch**

Run:

```powershell
git status --short --branch
git log -1 --oneline
```

Expected: the worktree is clean and the branch tracks `origin/feat/hub-state-unification` at the final integration commit.

- [ ] **Step 3: Merge into clean local main**

From `D:\Code\WheelMaker`, first verify the main worktree is clean:

```powershell
git status --short --branch
git pull --rebase origin main
git merge --ff-only feat/hub-state-unification
git push origin main
```

Expected: clean main, fast-forward merge, and successful push. If main contains user changes, stop before merge and leave the pushed feature branch/worktree intact.

- [ ] **Step 4: Clean up only after main is pushed**

Resolve and verify the exact worktree path before removal:

```powershell
$taskWorktree = (Resolve-Path 'D:\Code\WheelMaker\.worktree\feat-hub-state-unification').Path
$expectedRoot = (Resolve-Path 'D:\Code\WheelMaker\.worktree').Path
if (-not $taskWorktree.StartsWith($expectedRoot + [IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to remove unexpected worktree path: $taskWorktree"
}
git worktree remove $taskWorktree
git branch -d feat/hub-state-unification
git push origin --delete feat/hub-state-unification
```

Expected: the clean task worktree and merged local/remote task branches are removed; `main` remains.

- [ ] **Step 5: Record completion and run the repository completion gate**

From `D:\Code\WheelMaker`, change this plan's `**Execution status:** planned` line to `**Execution status:** completed`, then run the required final sequence exactly:

```powershell
git add -A
git commit -m "docs(hub): record unified state completion"
git push origin main
```

Expected: the execution record is committed on `main`, the final push succeeds, and no commands run after this sequence before the user-facing completion message.

### Task 15: Make Hub discovery and store lifetime resilient

**Files:**
- Modify: `app/web/src/hubState/hubStore.ts`
- Modify: `app/web/src/hubState/hubStore.test.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/__tests__/web-hub-state-service.test.ts`
- Modify: `app/web/src/usage/usageStore.test.ts`

- [x] **Step 1: Add failing tests**

Add tests proving that one failed `hub.state.get` does not reject discovery, reconnect rediscovery replaces same-ID state when the Hub instance changed, and retaining the active Hub IDs removes obsolete Usage projections.

- [x] **Step 2: Run focused tests and verify failure**

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubStore.test.ts __tests__/web-hub-state-service.test.ts web/src/usage/usageStore.test.ts
```

Expected: FAIL on discovery rejection, skipped rediscovery, or obsolete Hub retention.

- [x] **Step 3: Implement minimal lifetime behavior**

Make discovery settle each Hub independently, always query connected Hub IDs, retain only the current connection's Hub IDs, and preserve cached section data while a refresh is in flight. Workspace connection must remain usable when HubState discovery is unavailable.

- [x] **Step 4: Run focused tests**

Run the Step 2 command. Expected: PASS.

### Task 16: Fix Skills ownership, target changes, and diagnostics

**Files:**
- Modify: `server/internal/hub/skills_state.go`
- Modify: `server/internal/hub/skills_state_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/reporter_test.go`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubSkillManagement.tsx`
- Modify: `app/web/src/app/ChatComposer.tsx`
- Modify: corresponding existing Web tests

- [x] **Step 1: Add failing server and Web tests**

Cover global managed Skill lookup through the authoritative `.agents/.skill-lock.json`, agent-list-only topology changes, preservation of sync diagnostics in menu models, and rendering of the non-blocking Composer diagnostic.

- [x] **Step 2: Verify RED**

```powershell
cd server
go test ./internal/hub -run 'Managed|Topology|AgentTargets' -count=1
cd ..\app
npm test -- --runInBand __tests__/web-skill-management-view.test.ts __tests__/web-chat-inline-composer-wiring.test.ts
```

Expected: at least one assertion fails for each missing behavior.

- [x] **Step 3: Implement the authoritative data flow**

Resolve the global managed lock from the Hub `.agents` root, include Agent membership in topology comparison, carry `sync` through the Hub menu view model, and display `selectComposerDiagnostic` without triggering refresh or blocking Skill selection.

- [x] **Step 4: Verify GREEN**

Run the Step 2 commands. Expected: PASS.

### Task 17: Correct refresh edges and asynchronous completion

**Files:**
- Modify: `app/web/src/hubState/hubRefreshTriggers.ts`
- Modify: `app/web/src/hubState/hubRefreshTriggers.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `server/internal/hub/tools/update.go`
- Modify: `server/internal/hub/tools/update_test.go`
- Modify: Hub action wiring files and existing tests

- [x] **Step 1: Add failing edge and completion tests**

Test menu-open-before-Hub-discovery, Hub additions while open, reconnect/open generations, clearing expanded state on close, handled refresh rejection, and WheelMaker update completion publishing a terminal `wheelmakerUpdate` refresh.

- [x] **Step 2: Verify RED**

```powershell
cd app
npm test -- --runInBand web/src/hubState/hubRefreshTriggers.test.ts
cd ..\server
go test ./internal/hub/... -run 'Update.*Done|WheelMaker.*Update' -count=1
```

- [x] **Step 3: Implement edge generations and completion notification**

Track observed Hub IDs per menu-open generation, reset expansion on close, retry newly connected IDs once, catch request failures at the UI boundary, and invoke the section completion callback after the updater exits regardless of success.

- [x] **Step 4: Verify GREEN**

Run the Step 2 commands. Expected: PASS.

### Task 18: Make section snapshots observable and immutable

**Files:**
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_test.go`
- Modify: `app/web/src/hubState/hubStore.ts`
- Modify: `app/web/src/hubState/hubStore.test.ts`

- [x] **Step 1: Add failing tests**

Cover request-local queue progress without losing committed data, stale response rejection, discovery generations, and deep cloning of structs, pointers, maps, and slices used by real Section payloads.

- [x] **Step 2: Verify RED**

```powershell
cd server
go test ./internal/hub -run 'HubState.*(NoChange|Clone|Status)' -count=1
cd ..\app
npm test -- --runInBand web/src/hubState/hubStore.test.ts
```

- [x] **Step 3: Implement minimal state semantics**

Commit and publish a monotonic revision when data, availability, or error changes; keep queue progress request-local except for Usage scanning; and recursively clone pointers and structs so committed snapshots do not share mutable backing data.

- [x] **Step 4: Verify GREEN**

Run the Step 2 commands. Expected: PASS.

### Task 19: Re-review and deliver remediation

**Files:**
- Modify documentation only where final behavior differs from the approved wording.

- [x] **Step 1: Run complete verification**

```powershell
cd server
go test ./... -count=1
go build ./cmd/wheelmaker/
cd ..\app
npm test -- --runInBand
npm run tsc:web
npm run build:web
cd ..
git diff --check
```

- [x] **Step 2: Re-review**

Trace startup, reconnect, menu open/expand, Skill filesystem notification, token usage, and asynchronous action completion end-to-end. Search for discarded diagnostics, stale Hub IDs, unhandled refresh promises, obsolete polling, and duplicate update paths.

- [ ] **Step 3: Deliver through the configured Git workflow**

Fetch and rebase the feature branch, repeat targeted smoke tests, run the repository completion gate (`git add -A`, `git commit`, `git push origin feat/hub-state-unification`), then merge only if the main worktree is clean.
