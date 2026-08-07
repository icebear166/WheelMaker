# Agent Usage Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-driven token-stat stream with a Hub-owned Limits monitor that scans every ten minutes, never opens a Windows console window, and renders a compact/detail desktop function surface above the chat composer.

**Architecture:** A new `internal/hub/usage` package owns Provider discovery, typed snapshots, singleflight refresh, scheduling, and hidden helper processes. The Reporter projects complete snapshots into the existing `tokenStats` HubState section and publishes generic `hub.state.updated` events; Registry only authenticates and forwards that generic event. Web atomically stores per-Hub snapshots and renders them through a reusable chat function surface.

**Tech Stack:** Go 1.x, gorilla/websocket, React 19, TypeScript 5.8, Jest, CSS, existing HubState and Registry protocol.

**Implementation status (2026-07-18):** Completed on `feat/agent-usage-rewrite`. The execution used one consolidated final commit instead of the intermediate checkpoint commits below. Fresh verification passed all Go tests, all 190 Web suites / 990 tests, TypeScript, production Web build, and the Windows hidden-window and schedule-reset regressions. Repository-wide `go vet ./...` still reports pre-existing lock-copy warnings in `internal/portrelay` and `unsafe.Pointer` warnings in `cmd/wheelmaker-desktop`; neither area is changed by this plan.

---

### Task 1: Remove the abandoned Usage stream and legacy token command paths

**Files:**
- Delete: `server/internal/hub/tools/token.go`
- Delete: `server/internal/hub/tools/token_stats.go`
- Delete: `server/internal/hub/tools/token_providers.go`
- Delete: `server/internal/hub/tools/token_dedup.go`
- Delete: `server/internal/hub/tools/opencode_auth.go`
- Delete: `server/internal/hub/tools/codex_appserver.go`
- Delete: `server/internal/hub/tools/kimi_scanner.go`
- Delete: `server/internal/hub/tools/zai_scanner.go`
- Delete matching tests under `server/internal/hub/tools/`
- Modify: `server/internal/hub/tools/manager.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`
- Delete: `docs/scope/2026-07-17-agent-usage-panel.md`
- Delete: `docs/plans/2026-07-17-agent-usage-panel/plan-agent-usage-panel.md`

- [x] **Step 1: Add regression assertions for the paths that must disappear**

Update the existing protocol and Registry tests so the removed method and secret injection are explicit:

```go
func TestTokenStatsUpdateMethodIsRemoved(t *testing.T) {
	if _, ok := RegistryMethod("tokenStats.update"); ok {
		t.Fatal("tokenStats.update must not remain registered")
	}
}

func TestHubStateDeepSeekSecretInjectionIsRemoved(t *testing.T) {
	raw := rp.MustRaw(map[string]any{
		"section": "tokenStats",
		"action":  "deepseekStats",
		"params":  map[string]any{},
	})
	s := &Server{}
	prepared, requestErr := s.prepareHubStatePayload(envelope{
		Method: rp.RegistryMethodHubStateAction,
		Payload: raw,
	})
	if requestErr != nil || string(prepared) != string(raw) {
		t.Fatalf("payload must pass through without secret injection: err=%v payload=%s", requestErr, prepared)
	}
}
```

- [x] **Step 2: Run the focused tests and verify the first assertion fails**

Run: `go test ./internal/protocol ./internal/registry -run 'TokenStatsUpdate|DeepSeekSecretInjection' -v`

Expected: FAIL because `tokenStats.update` is registered and Registry still rewrites `deepseekStats`.

- [x] **Step 3: Remove the old implementation without restoring the pre-feature settings page**

Remove `TokenCommand` from `tools.Manager`, remove the token action adapter, token event sink, Provider-specific Registry branch, and secret injection. Keep the generic HubState section name because the replacement uses it:

```go
type Manager struct {
	cfg           ManagerConfig
	npmCommand    *NPMCommand
	updateCommand *UpdateCommand
	skillsCommand *SkillsCommand
}
```

`handleTerminalEvent` must no longer mention `RegistryMethodTokenStatsUpdate`, and `prepareHubStatePayload` must simply return the incoming payload:

```go
func (s *Server) prepareHubStatePayload(in envelope) (json.RawMessage, *hubStatePayloadError) {
	return in.Payload, nil
}
```

Delete the superseded 2026-07-17 scope documents. Do not restore `TokenStatsSettingsDetail.tsx`, `tokenStatsView.ts`, DeepSeek settings, or Copilot code.

- [x] **Step 4: Run the affected Go tests**

Run: `go test ./internal/hub/tools ./internal/hub ./internal/protocol ./internal/registry`

Expected: PASS with no `cmd.token`, `tokenStats.update`, token event sink, or DeepSeek secret injection references.

- [x] **Step 5: Commit the clean-slate removal and approved documents**

```bash
git add -A
git commit -m "refactor: remove abandoned agent usage stream"
```

### Task 2: Build typed Provider scanners with hidden Windows processes

**Files:**
- Create: `server/internal/hub/usage/model.go`
- Create: `server/internal/hub/usage/collector.go`
- Create: `server/internal/hub/usage/opencode_auth.go`
- Create: `server/internal/hub/usage/provider_codex.go`
- Create: `server/internal/hub/usage/provider_kimi.go`
- Create: `server/internal/hub/usage/provider_zai.go`
- Create: `server/internal/hub/usage/provider_deepseek.go`
- Create matching `*_test.go` files in `server/internal/hub/usage/`
- Create: `server/internal/hub/usage/provider_codex_windows_test.go`

- [x] **Step 1: Write model and collector tests first**

```go
func TestCollectorReturnsStableProviderOrder(t *testing.T) {
	collector := Collector{Scanners: []ProviderScanner{
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderZAI} }),
		ScannerFunc(func(context.Context) ProviderSnapshot { return ProviderSnapshot{ID: ProviderCodex} }),
	}}
	got := collector.Scan(context.Background())
	if got[0].ID != ProviderCodex || got[1].ID != ProviderZAI {
		t.Fatalf("provider order=%v", []ProviderID{got[0].ID, got[1].ID})
	}
}

func TestLimitKeepsFullUTCTimestamp(t *testing.T) {
	reset := time.Date(2027, 1, 1, 0, 5, 0, 0, time.UTC)
	limit := Limit{ID: "5h", RemainingPercent: 77, ResetsAt: &reset}
	raw, err := json.Marshal(limit)
	if err != nil || !bytes.Contains(raw, []byte("2027-01-01T00:05:00Z")) {
		t.Fatalf("limit json=%s err=%v", raw, err)
	}
}
```

- [x] **Step 2: Run the new package tests and verify they fail to compile**

Run: `go test ./internal/hub/usage -run 'Collector|Limit' -v`

Expected: FAIL because the package and types do not exist.

- [x] **Step 3: Implement the strong domain model and parallel collector**

Use these public contracts consistently in every later task:

```go
type ProviderID string

const (
	ProviderCodex    ProviderID = "codex"
	ProviderKimi     ProviderID = "kimi"
	ProviderZAI      ProviderID = "zai"
	ProviderDeepSeek ProviderID = "deepseek"
)

type ProviderStatus string

const (
	ProviderOK          ProviderStatus = "ok"
	ProviderUnavailable ProviderStatus = "unavailable"
	ProviderError       ProviderStatus = "error"
)

type Limit struct {
	ID               string     `json:"id"`
	Label            string     `json:"label"`
	RemainingPercent float64    `json:"remainingPercent"`
	ResetsAt         *time.Time `json:"resetsAt,omitempty"`
}

type Identity struct {
	Kind  string `json:"kind,omitempty"`
	Value string `json:"value,omitempty"`
	Label string `json:"label,omitempty"`
}

type Account struct {
	LocalID   string        `json:"localId"`
	Identity  Identity      `json:"identity"`
	Status    ProviderStatus `json:"status"`
	Plan      string        `json:"plan,omitempty"`
	Message   string        `json:"message,omitempty"`
	Limits    []Limit       `json:"limits"`
	Balance   *Balance      `json:"balance,omitempty"`
}

type ProviderSnapshot struct {
	ID       ProviderID     `json:"id"`
	Name     string         `json:"name"`
	Status   ProviderStatus `json:"status"`
	Message  string         `json:"message,omitempty"`
	Accounts []Account      `json:"accounts"`
}
```

The collector runs scanners concurrently but sorts the final slice by `codex`, `kimi`, `zai`, `deepseek`, so network completion order never changes UI order.

- [x] **Step 4: Write Provider parser and credential-boundary tests**

Cover the real fields already observed by the discarded implementation:

```go
func TestParseCodexRateLimitsByWindowDuration(t *testing.T) {
	payload := map[string]any{"rateLimits": map[string]any{
		"primary": map[string]any{"windowDurationMins": float64(300), "usedPercent": float64(23), "resetsAt": float64(1798761900)},
		"secondary": map[string]any{"windowDurationMins": float64(10080), "usedPercent": float64(58), "resetsAt": float64(1799366400)},
	}}
	limits, err := parseCodexRateLimits(payload)
	if err != nil || len(limits) != 2 || limits[0].RemainingPercent != 77 || limits[1].RemainingPercent != 42 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseKimiUsageUsesLimitsAndWeeklyUsage(t *testing.T) {
	payload := map[string]any{
		"usage": map[string]any{"limit": "100", "remaining": "67", "resetTime": "2027-01-08T00:00:00Z"},
		"limits": []any{map[string]any{
			"window": map[string]any{"duration": float64(300)},
			"detail": map[string]any{"limit": "100", "used": "9", "resetTime": "2027-01-01T05:00:00Z"},
		}},
	}
	limits, err := parseKimiLimits(payload)
	if err != nil || len(limits) != 2 || limits[0].RemainingPercent != 91 || limits[1].RemainingPercent != 67 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseZAIQuotaUsesUnitsThreeSixAndFive(t *testing.T) {
	payload := map[string]any{"data": map[string]any{"limits": []any{
		map[string]any{"type": "TOKENS_LIMIT", "unit": float64(3), "percentage": float64(66), "nextResetTime": float64(1798761900000)},
		map[string]any{"type": "TOKENS_LIMIT", "unit": float64(6), "percentage": float64(40), "nextResetTime": float64(1799366400000)},
		map[string]any{"type": "TIME_LIMIT", "unit": float64(5), "percentage": float64(12), "nextResetTime": float64(1801440000000)},
	}}}
	limits, _, err := parseZAILimits(payload)
	if err != nil || len(limits) != 3 || limits[0].RemainingPercent != 34 || limits[2].RemainingPercent != 88 {
		t.Fatalf("limits=%+v err=%v", limits, err)
	}
}

func TestParseDeepSeekBalancePreservesCurrencies(t *testing.T) {
	payload := map[string]any{"is_available": true, "balance_infos": []any{
		map[string]any{"currency": "CNY", "total_balance": "110", "granted_balance": "10", "topped_up_balance": "100"},
	}}
	balance, err := parseDeepSeekBalance(payload)
	if err != nil || !balance.IsAvailable || len(balance.Items) != 1 || balance.Items[0].Total != "110" {
		t.Fatalf("balance=%+v err=%v", balance, err)
	}
}

func TestProviderErrorNeverContainsCredential(t *testing.T) {
	secret := "sk-private-test-key"
	message := providerErrorMessage(secret, http.StatusBadGateway, []byte("upstream echoed "+secret), errors.New("request failed"))
	if strings.Contains(message, secret) || message != "network error" {
		t.Fatalf("unsafe error=%q", message)
	}
}

func TestKimiMissingCredentialIsUnavailable(t *testing.T) {
	scanner := NewKimiScanner("", &http.Client{}, "https://unused.invalid")
	got := scanner.Scan(context.Background())
	if got.Status != ProviderUnavailable || len(got.Accounts) != 0 {
		t.Fatalf("snapshot=%+v", got)
	}
}
```

Each HTTP scanner receives an injected `*http.Client` and endpoint in tests. Error messages are mapped to bounded categories such as `not authenticated`, `unauthorized`, `network error`, and `invalid response`; raw response bodies never enter snapshots.

- [x] **Step 5: Implement OpenCode discovery and all four scanners**

OpenCode discovery reads only these entries:

```go
var openCodeProviderKeys = map[ProviderID]string{
	ProviderKimi:     "kimi-for-coding",
	ProviderZAI:      "zai-coding-plan",
	ProviderDeepSeek: "deepseek",
}
```

Codex starts `codex app-server --listen stdio://` through one command constructor:

```go
var newBackgroundCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	shared.ConfigureBackgroundCommand(cmd)
	return cmd
}
```

Only report a Codex profile when the spawned process is actually bound to that profile. If named profiles cannot be selected independently, return the current profile plus an explicit unavailable/error result instead of duplicating the current account's limits.

- [x] **Step 6: Add the Windows no-console test**

In `provider_codex_windows_test.go`:

```go
//go:build windows

func TestCodexCommandHidesWindow(t *testing.T) {
	cmd := newBackgroundCommand(context.Background(), "cmd", "/c", "exit", "0")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("Codex helper must hide its Windows console window")
	}
}
```

- [x] **Step 7: Run Provider tests and commit**

Run: `go test ./internal/hub/usage -v`

Expected: PASS; tests make no real Provider network requests or real Codex process calls.

```bash
git add server/internal/hub/usage
git commit -m "feat(hub): add typed limits provider scanners"
```

### Task 3: Add the Hub-owned scheduler and singleflight snapshot service

**Files:**
- Create: `server/internal/hub/usage/service.go`
- Create: `server/internal/hub/usage/service_test.go`

- [x] **Step 1: Write scheduler and singleflight tests with an injected clock**

```go
type blockingCollector struct {
	calls   atomic.Int64
	started chan struct{}
	release chan struct{}
	once    sync.Once
	results []ProviderSnapshot
}

func newBlockingCollector() *blockingCollector {
	return &blockingCollector{started: make(chan struct{}), release: make(chan struct{})}
}

func (c *blockingCollector) Scan(ctx context.Context) []ProviderSnapshot {
	c.calls.Add(1)
	c.once.Do(func() { close(c.started) })
	select {
	case <-c.release:
		return append([]ProviderSnapshot(nil), c.results...)
	case <-ctx.Done():
		return nil
	}
}

func (c *blockingCollector) WaitForCalls(t *testing.T, want int64) {
	t.Helper()
	select {
	case <-c.started:
	case <-time.After(time.Second):
		t.Fatal("collector did not start")
	}
	if got := c.calls.Load(); got != want { t.Fatalf("calls=%d want=%d", got, want) }
}

func (c *blockingCollector) Calls() int64 { return c.calls.Load() }
func (c *blockingCollector) Release() { close(c.release) }

func TestServiceScansImmediatelyThenTenMinutesAfterCompletion(t *testing.T) {
	after := make(chan time.Duration, 1)
	scanner := newBlockingCollector()
	scanner.results = []ProviderSnapshot{{ID: ProviderCodex}}
	service := NewService(ServiceOptions{
		Collector: scanner,
		Interval:  10 * time.Minute,
		After: func(d time.Duration) <-chan time.Time {
			after <- d
			return make(chan time.Time)
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go service.Run(ctx)
	scanner.WaitForCalls(t, 1)
	scanner.Release()
	if got := <-after; got != 10*time.Minute {
		t.Fatalf("interval=%v", got)
	}
}

func TestRefreshJoinsRunningScan(t *testing.T) {
	collector := newBlockingCollector()
	service := NewService(ServiceOptions{Collector: collector})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	collector.WaitForCalls(t, 1)
	doneA := make(chan struct{})
	doneB := make(chan struct{})
	go func() { _, _ = service.Refresh(context.Background()); close(doneA) }()
	go func() { _, _ = service.Refresh(context.Background()); close(doneB) }()
	if collector.Calls() != 1 { t.Fatalf("calls=%d", collector.Calls()) }
	collector.Release()
	<-doneA
	<-doneB
}
```

- [x] **Step 2: Run tests and verify they fail**

Run: `go test ./internal/hub/usage -run 'Service|Refresh' -v`

Expected: FAIL because `Service` is not implemented.

- [x] **Step 3: Implement immutable snapshots, lifecycle, and joined refreshes**

```go
type ScanStatus string

const (
	ScanIdle     ScanStatus = "idle"
	ScanScanning ScanStatus = "scanning"
	ScanReady    ScanStatus = "ready"
	ScanError    ScanStatus = "error"
)

type Snapshot struct {
	HubID      string             `json:"hubId"`
	Generation uint64             `json:"generation"`
	Status     ScanStatus         `json:"status"`
	StartedAt  *time.Time         `json:"startedAt,omitempty"`
	UpdatedAt  *time.Time         `json:"updatedAt,omitempty"`
	Message    string             `json:"message,omitempty"`
	Providers  []ProviderSnapshot `json:"providers"`
}
```

`Start(ctx)` is idempotent. The first scan starts immediately. `Refresh(ctx)` either creates one `scanRun` or waits on the current run's `done` channel. The shared scan uses the service lifecycle context, so one disconnected HTTP waiter cannot cancel the Hub's scan. Publish a cloned `scanning` snapshot while retaining prior providers, then atomically publish one complete snapshot.

- [x] **Step 4: Run service concurrency tests**

Run: `go test -count=1 ./internal/hub/usage -run 'Service|Refresh|ManualRefresh' -v`

Expected: PASS with one collector invocation for overlapping refreshes.

- [x] **Step 5: Commit**

```bash
git add server/internal/hub/usage/service.go server/internal/hub/usage/service_test.go
git commit -m "feat(hub): own limits schedule and snapshot cache"
```

### Task 4: Project Usage snapshots through generic HubState events

**Files:**
- Modify: `server/internal/hub/hub_state.go`
- Modify: `server/internal/hub/hub_state_test.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: Write tests for externally replaced HubState and generic forwarding**

```go
func TestHubStateReplaceSectionAtomically(t *testing.T) {
	m := newHubStateManager("hub-a", nil)
	m.replaceSection("tokenStats", hubStateSection{
		Status: hubStateSectionStatusReady,
		Data:   usage.Snapshot{HubID: "hub-a", Generation: 2, Status: usage.ScanReady},
	})
	got := m.get([]string{"tokenStats"}).Sections["tokenStats"]
	if got.Status != hubStateSectionStatusReady { t.Fatalf("status=%s", got.Status) }
}

func TestHubStateUpdatedAllowsHubOrigin(t *testing.T) {
	method, ok := rp.RegistryMethod(rp.RegistryMethodHubStateUpdated)
	if !ok {
		t.Fatal("hub.state.updated is not registered")
	}
	if !rp.RegistryMethodAllowed(string(rp.RegistryRoleHub), method.Method) {
		t.Fatal("hub role must be allowed to publish hub.state.updated")
	}
	if method.Route != rp.RegistryRouteClientEvent {
		t.Fatalf("route=%q", method.Route)
	}
}
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `go test ./internal/hub ./internal/protocol ./internal/registry -run 'ReplaceSection|HubStateUpdated' -v`

Expected: FAIL because Hub-originated generic updates are not yet published/forwarded.

- [x] **Step 3: Add a generic HubState event sink and Usage integration**

Replace the removed token sink with a method-agnostic HubState sink:

```go
func (r *Reporter) publishHubStateUpdated(state hubState, sections []string, reason string) error {
	return r.publishHubEvent(envelope{
		Type:   rp.RegistryEnvelopeTypeEvent,
		Method: rp.RegistryMethodHubStateUpdated,
		HubID:  r.cfg.HubID,
		Payload: rp.MustRaw(map[string]any{
			"state": state, "sections": sections, "reason": reason,
		}),
	})
}
```

Create the Usage service in `NewReporter`, start it once at the beginning of `Run(ctx)`, and map snapshots as follows:

```go
func usageSectionStatus(status usage.ScanStatus) hubStateSectionStatus {
	switch status {
	case usage.ScanScanning:
		return hubStateSectionStatusRefreshing
	case usage.ScanReady:
		return hubStateSectionStatusReady
	case usage.ScanError:
		return hubStateSectionStatusError
	default:
		return hubStateSectionStatusEmpty
	}
}
```

The scheduled callback calls `replaceSection` then `publishHubStateUpdated`. `refreshHubStateTokenStats` calls `usageService.Refresh(ctx)` and returns the completed snapshot. Remove the obsolete `providers` action entirely.

- [x] **Step 4: Allow only authenticated matching Hubs to originate `hub.state.updated`**

Register `hub.state.updated` as a Hub-originated, client-destination event without changing the protocol version. Registry forwards it through generic `broadcastHubEvent`; the branch must not mention Usage or `tokenStats`.

- [x] **Step 5: Run Hub/Registry tests**

Run: `go test -count=1 ./internal/hub ./internal/protocol ./internal/registry`

Expected: PASS; autonomous and manual snapshots share the same HubState representation.

- [x] **Step 6: Commit**

```bash
git add server/internal/hub server/internal/protocol server/internal/registry
git commit -m "feat: publish limits through generic hub state"
```

### Task 5: Replace UsageStream with an atomic Web Usage store

**Files:**
- Rewrite: `app/web/src/usage/usageTypes.ts`
- Delete: `app/web/src/usage/usageStream.ts`
- Create: `app/web/src/usage/usageStore.ts`
- Rewrite: `app/__tests__/web-usage-types.test.ts`
- Rewrite: `app/__tests__/web-usage-stream.test.ts` as `app/__tests__/web-usage-store.test.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`

- [x] **Step 1: Write atomic replacement, cleanup, and aggregation tests**

```ts
it('atomically replaces one Hub and removes disappeared accounts', () => {
  const store = new UsageStore();
  store.replaceHub('hub-a', {
    hubId: 'hub-a', generation: 1, status: 'ready', providers: [{
      id: 'codex', name: 'Codex', status: 'ok', accounts: [{
        localId: 'current', identity: {kind: 'accountId', value: 'acct-a', label: 'acct-a'},
        status: 'ok', limits: [],
      }],
    }],
  });
  store.replaceHub('hub-a', {
    hubId: 'hub-a', generation: 2, status: 'ready', providers: [{
      id: 'codex', name: 'Codex', status: 'unavailable', accounts: [],
    }],
  });
  expect(store.snapshot().providers.find(item => item.id === 'codex')?.accounts).toEqual([]);
});

it('does not merge identity-less accounts across Hubs', () => {
  const store = new UsageStore();
  for (const hubId of ['hub-a', 'hub-b']) {
    store.replaceHub(hubId, {
      hubId, generation: 1, status: 'ready', providers: [{
        id: 'deepseek', name: 'DeepSeek', status: 'ok', accounts: [{
          localId: 'default', identity: {}, status: 'ok', limits: [],
        }],
      }],
    });
  }
  expect(store.snapshot().providers[0].accounts).toHaveLength(2);
});

it('summarizes the account with the lowest remaining percentage', () => {
  const summary = summarizeProvider({
    id: 'codex', name: 'Codex', status: 'ok', accounts: [78, 9, 42].map((remainingPercent, index) => ({
      localId: String(index), identity: {kind: 'accountId', value: String(index)}, status: 'ok',
      limits: [{id: '5h', label: '5h', remainingPercent}], hubIds: ['hub-a'],
    })),
  });
  expect(summary.remainingPercent).toBe(9);
  expect(summary.accountCount).toBe(3);
});
```

- [x] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand __tests__/web-usage-store.test.ts __tests__/web-usage-types.test.ts`

Expected: FAIL because `UsageStore` and the new snapshot contracts do not exist.

- [x] **Step 3: Implement strict Registry-aligned types**

```ts
export type UsageScanStatus = 'idle' | 'scanning' | 'ready' | 'error';
export type UsageProviderStatus = 'ok' | 'unavailable' | 'error';

export interface UsageLimit {
  id: string;
  label: string;
  remainingPercent: number;
  resetsAt?: string;
}

export interface UsageHubSnapshot {
  hubId: string;
  generation: number;
  status: UsageScanStatus;
  startedAt?: string;
  updatedAt?: string;
  message?: string;
  providers: UsageProviderSnapshot[];
}

export interface UsageViewAccount extends UsageAccount {
  hubIds: string[];
}

export interface UsageProviderView {
  id: UsageProviderId;
  name: string;
  status: UsageProviderStatus;
  accountCount: number;
  remainingPercent?: number;
  accounts: UsageViewAccount[];
}

export interface UsageViewSnapshot {
  refreshing: boolean;
  providers: UsageProviderView[];
}
```

Remove the obsolete `RegistryDeepSeekTokenStats`, `RegistryTokenProviderAccount`, `RegistryTokenScanProvider`, and `RegistryTokenScanResult` families after their old consumers are deleted. HubState keeps `data` generic at the Registry layer; `usageStore.ts` owns validation into the new Usage types.

- [x] **Step 4: Implement `UsageStore`**

The store owns `Map<hubId, UsageHubSnapshot>`, rejects older generations for the same Hub, replaces complete Hub snapshots, removes offline Hubs, and derives stable Provider order. Stable identities merge across Hubs; identity-less accounts use `${hubId}:${provider}:${localId}`.

Add a strict parser for `hub.state.updated` that accepts only events whose `sections` contains `tokenStats` and whose `state.sections.tokenStats.data` has a valid snapshot. Do not use `any` or JSON-stringified identity keys.

- [x] **Step 5: Run store tests and TypeScript**

Run: `npm test -- --runInBand __tests__/web-usage-store.test.ts __tests__/web-usage-types.test.ts && npm run tsc:web`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add app/web/src/usage app/web/src/registry app/__tests__/web-usage-store.test.ts app/__tests__/web-usage-types.test.ts
git commit -m "feat(web): store atomic limits snapshots"
```

### Task 6: Build the reusable bottom function surface and Limits UI

**Files:**
- Create: `app/web/src/chat/ChatFunctionSurface.tsx`
- Create: `app/web/src/usage/UsageFeatureSurface.tsx`
- Delete: `app/web/src/usage/UsageMeter.tsx`
- Delete: `app/web/src/usage/UsageCompactBar.tsx`
- Delete: `app/web/src/usage/UsageCardPanel.tsx`
- Rewrite: `app/web/src/styles/usage.css`
- Modify: `app/web/src/styles/chat.css`
- Rewrite: `app/__tests__/web-usage-compact-bar.test.tsx` as `app/__tests__/web-usage-feature-surface.test.tsx`
- Rewrite: `app/__tests__/web-usage-card-panel.test.tsx`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`

- [x] **Step 1: Write interaction and rendering tests**

```tsx
const fixtureSnapshot: UsageViewSnapshot = {
  refreshing: false,
  providers: [{
    id: 'codex', name: 'Codex', status: 'ok', accountCount: 3, remainingPercent: 9,
    accounts: [{
      localId: 'acct-a', identity: {kind: 'email', value: 'a@example.com', label: 'a@example.com'},
      status: 'ok', hubIds: ['hub-a'],
      limits: [{id: '5h', label: '5h', remainingPercent: 9, resetsAt: '2027-01-01T05:00:00Z'}],
    }],
  }],
};

it('renders one compact row per Provider and the worst account summary', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={jest.fn()} />);
  });
  const json = JSON.stringify(view!.toJSON());
  expect(json).toContain('Codex');
  expect(json).toContain('9%');
  expect(json).toContain('3 accounts');
});

it('toggles detail mode in place and keeps refresh separate', () => {
  const onRefresh = jest.fn();
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<UsageFeatureSurface snapshot={fixtureSnapshot} onRefresh={onRefresh} />);
  });
  act(() => view!.root.findByProps({'aria-label': 'Show limit details'}).props.onClick());
  expect(view!.root.findByProps({'data-mode': 'detail'})).toBeDefined();
  act(() => view!.root.findByProps({'aria-label': 'Refresh limits'}).props.onClick());
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run UI tests and verify failure**

Run: `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-card-panel.test.tsx __tests__/web-chat-plan-surface.test.tsx`

Expected: FAIL because the new surface does not exist.

- [x] **Step 3: Implement the generic function surface**

```tsx
type ChatFunctionSurfaceProps = {
  title: string;
  collapsed: boolean;
  mode: 'compact' | 'detail';
  actions: React.ReactNode;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
};

export function ChatFunctionSurface(props: ChatFunctionSurfaceProps) {
  const surfaceRef = useChatEdgeSurfaceGeometry('left');
  return (
    <aside ref={surfaceRef} className={`chat-function-surface desktop ${props.mode}`} data-mode={props.mode}>
      <div className="chat-edge-surface-glass" aria-hidden="true" />
      <div className="chat-edge-surface-content">
        <header className="chat-function-surface-header">
          <button type="button" aria-label={props.collapsed ? 'Expand functions' : 'Collapse functions'} onClick={props.onToggleCollapsed} />
          <span className="chat-function-surface-title">{props.title}</span>
          <span className="chat-function-surface-actions">{props.actions}</span>
        </header>
        {props.collapsed ? null : props.children}
      </div>
    </aside>
  );
}
```

- [x] **Step 4: Implement the intentional Limits visual language**

Use a restrained instrument-panel treatment: IBM Plex Sans labels, JetBrains Mono numbers, exact percentages, and thin quota rails rather than the discarded five-tick meter. Color is reserved for warning/danger/error; text and icons preserve meaning without color. Compact rows contain Provider, optional account count, and 5h/week/MCP or balance values. Detail mode renders account sections with full reset timestamps and Hub labels.

- [x] **Step 5: Anchor the surface above the composer and share Plan fading**

```css
.chat-function-surface.desktop {
  position: absolute;
  left: var(--chat-edge-surface-stack-edge-gap);
  bottom: var(--chat-scroll-bottom-offset, 92px);
  z-index: 6;
  width: min(360px, calc(100% - 20px));
}

.chat-function-surface.desktop.detail {
  width: min(420px, calc(100% - 20px));
  max-height: min(58vh, 560px);
}
```

Add `.chat-function-surface.desktop` to the same glass, mask, hover/focus reveal, and reduced-motion selector groups used by Plan. Add the fixed-800 left-column calculation so sidebar expanded/collapsed does not change the function surface's alignment.

- [x] **Step 6: Run UI tests and commit**

Run: `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-card-panel.test.tsx __tests__/web-chat-plan-surface.test.tsx && npm run tsc:web`

Expected: PASS.

```bash
git add app/web/src/chat/ChatFunctionSurface.tsx app/web/src/usage app/web/src/styles app/__tests__
git commit -m "feat(web): add limits function surface"
```

### Task 7: Wire cached HubState into WorkspaceApp and repair Settings shortcuts

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/settings/SettingsSurface.tsx`
- Modify: `app/web/src/settings/settingsNavigation.ts`
- Modify: `app/web/src/styles/settings.css`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Create: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] **Step 1: Write integration tests for connection-driven initialization and no polling**

```ts
test('loads cached tokenStats after Registry connection and never creates a usage interval', () => {
  const main = readSourceText('web/src/app/WorkspaceApp.tsx');
  expect(main).toContain("getHubState(hub.hubId, ['tokenStats'])");
  expect(main).toContain('RegistryMethods.HubStateUpdated');
  expect(main).not.toContain('setInterval(refreshUsageAcrossHubs');
  expect(main).not.toContain('renderChatMenuUsageButton');
});

test('keeps Token Stats removed and uses four Settings shortcut columns', () => {
  expect(MOBILE_SETTINGS_SHORTCUTS.map(item => item.detail)).toEqual(['update', 'skills', 'portRelay']);
  expect(settingsCss).toContain('repeat(var(--settings-shortcut-count), minmax(0, 1fr))');
  expect(settingsCss).toContain('calc(100% / var(--settings-shortcut-count))');
  expect(settingsCss).not.toContain("data-active-index='4'");
});
```

- [x] **Step 2: Run integration tests and verify failure**

Run: `npm test -- --runInBand __tests__/web-usage-workspace-integration.test.tsx __tests__/web-agent-package-update-settings.test.ts __tests__/web-settings-navigation.test.ts`

Expected: FAIL because WorkspaceApp still owns `UsageStream` and Settings still reserves five columns.

- [x] **Step 3: Replace the WorkspaceApp Usage effect**

On authenticated/connected Registry state:

1. Subscribe once to `hub.state.updated` and pass valid tokenStats snapshots to `UsageStore`.
2. Read cached `tokenStats` state for every online Hub.
3. Call `store.retainHubs(currentHubIds)` whenever the Hub list changes.
4. Expose `refreshAll` with `Promise.allSettled(hubIds.map(hubId => service.refreshHubState(hubId, ['tokenStats'])))`.
5. Do not update project lists as a side effect of Limits refresh.

Render `UsageFeatureSurface` as a direct child of `ChatSurface` near the Plan surface but outside `chat-edge-surface-stack`, so it can use its independent bottom anchor. Render only for `isWide && tab === 'chat'`.

- [x] **Step 4: Make the Settings shortcut count data-driven**

```tsx
const shortcutCount = MOBILE_SETTINGS_SHORTCUTS.length + 1;
const shortcutStyle = {
  '--settings-shortcut-count': shortcutCount,
} as React.CSSProperties;

<div className="mobile-settings-shortcut-track" style={shortcutStyle}>
```

```css
.mobile-settings-shortcut-track {
  grid-template-columns: repeat(var(--settings-shortcut-count), minmax(0, 1fr));
}

.mobile-settings-shortcut-track::before {
  width: calc(100% / var(--settings-shortcut-count));
}
```

Retain only indices `0..3`. Do not add Limits or Token Stats to `MOBILE_SETTINGS_SHORTCUTS`.

- [x] **Step 5: Run the Web integration suite and production build**

Run: `npm test -- --runInBand __tests__/web-usage-workspace-integration.test.tsx __tests__/web-agent-package-update-settings.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-chat-ui.test.ts && npm run tsc:web && npm run build:web`

Expected: PASS; webpack emits to `~/.wheelmaker/web`, not `app/dist`.

- [x] **Step 6: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/settings app/web/src/styles/settings.css app/__tests__
git commit -m "feat(web): connect limits surface to hub snapshots"
```

### Task 8: Update stable protocol knowledge and verify end to end

**Files:**
- Modify: `docs/wiki/protocols/registry.md`
- Modify: `docs/wiki/features/limits-monitoring.md`
- Modify: `docs/plans/2026-07-18-agent-usage-rewrite/plan-agent-usage-rewrite.md`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: Add an end-to-end no-secret snapshot test**

Use the existing Reporter/Registry WebSocket harness and an injected Usage collector:

```go
func TestUsageSnapshotFlowsThroughHubStateWithoutSecrets(t *testing.T) {
	secret := "sk-test-must-not-leave-hub"
	s := New(Config{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	hub := dialWS(t, ts.URL+"/ws")
	defer hub.Close()
	mustReportHubProjects(t, hub, "hub-limits", []map[string]any{{"name": "project", "path": `C:\src\project`, "online": true}})
	client := dialWS(t, ts.URL+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	mustWriteJSON(t, hub, testEnvelope{
		Type: "event", Method: rp.RegistryMethodHubStateUpdated, HubID: "hub-limits",
		Payload: map[string]any{
			"sections": []string{"tokenStats"},
			"reason": "usage.completed",
			"state": map[string]any{"hubId": "hub-limits", "sections": map[string]any{
				"tokenStats": map[string]any{"status": "ready", "data": map[string]any{
					"hubId": "hub-limits", "generation": 1, "status": "ready",
					"providers": []map[string]any{{"id": "codex", "name": "Codex", "status": "ok", "accounts": []any{}}},
				}},
			}},
			"testOnlySecretNotInPayload": strings.ReplaceAll(secret, secret, "redacted"),
		},
	})
	event := mustReadEnvelope(t, client)
	raw, err := json.Marshal(event)
	if err != nil { t.Fatal(err) }
	if bytes.Contains(raw, []byte(secret)) || bytes.Contains(raw, []byte("sk-test")) {
		t.Fatalf("secret leaked: %s", raw)
	}
	if event.Method != rp.RegistryMethodHubStateUpdated || !bytes.Contains(raw, []byte(`"tokenStats"`)) {
		t.Fatalf("missing tokenStats state: %s", raw)
	}
}
```

- [x] **Step 2: Run the end-to-end test and fix only integration defects**

Run: `go test ./internal/hub ./internal/registry -run UsageSnapshotFlowsThroughHubStateWithoutSecrets -v`

Expected: PASS with an unchanged generic HubState envelope and no credential fragments.

- [x] **Step 3: Update Registry Wiki to the implemented behavior**

Remove `tokenStats.deepseekStats` and the old `providers/deepseekStats` action list. Document:

```markdown
| `tokenStats` | Hub-owned Limits cache; automatic refresh is scheduled by Hub | no actions |

Clients read with `hub.state.get`, request a joined refresh with `hub.state.refresh`,
and receive complete replacements through `hub.state.updated`.
```

Keep the Registry protocol version unchanged. Adjust `features/limits-monitoring.md` only where the final implementation differs in concrete naming, without adding task history.

- [x] **Step 4: Run complete verification**

Run from `server/`: `go test -count=1 ./...`, then `go vet ./...` to inventory baseline warnings.

Run from `app/`: `npm test -- --runInBand && npm run tsc:web && npm run build:web`

Expected: tests, type checks, and build exit 0. Vet output is recorded separately when it identifies untouched baseline files.

- [x] **Step 5: Verify the Windows window-hiding signal**

Run: `go test ./internal/shared ./internal/hub/usage -run 'BackgroundCommand|CodexCommandHidesWindow' -v`

Expected: PASS with `SysProcAttr.HideWindow == true`.

The automated Windows test asserts `SysProcAttr.HideWindow == true` on the exact `codex app-server` command constructor used by startup, periodic, and manual scans. The scheduler regression separately verifies that a manual completion restarts the full 10-minute interval.

- [x] **Step 6: Mark this plan's completed checkboxes and perform the required final Git tail**

After all verification evidence is captured, update every completed checkbox in this plan, then run exactly:

```bash
git add -A
git commit -m "feat: rebuild agent limits monitoring"
git push origin feat/agent-usage-rewrite
```

Expected: commit and push succeed; the working tree is clean and `feat/agent-usage-rewrite` matches its remote branch.
