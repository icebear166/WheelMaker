# Token Usage Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist raw remaining-quota samples on each Hub and let users open a polished, lazy-loaded chart that compares the longest Limit's projected depletion with its real reset time.

**Architecture:** The Hub usage package owns a bounded versioned JSON history file and exposes raw recent samples through a new read-only Registry request. The Web queries every online Hub associated with the selected account, chooses one deterministic candidate, calculates the forecast locally, and renders an accessible ECharts modal without adding chart code to the initial bundle.

**Tech Stack:** Go, versioned JSON with atomic replacement, Registry WebSocket protocol, React 19, TypeScript, ECharts 6, Jest, Go tests, webpack dynamic imports.

---

## File structure

### Hub and protocol

- Create `server/internal/hub/usage/history.go`: history file model, validation, retention, atomic persistence, and bounded history query.
- Extend `server/internal/hub/usage/model.go`: stable window metadata on `Limit` and history request/response DTOs.
- Modify existing provider files under `server/internal/hub/usage/provider_*.go`: publish fixed/calendar window metadata and deterministic MyFlicker month resets.
- Extend `server/internal/hub/usage/providers_test.go`: provider window metadata and MyFlicker timezone coverage.
- Extend `server/internal/hub/usage/service.go`: record only the raw successful collector result before failed-scan snapshot preservation.
- Extend `server/internal/hub/usage/service_test.go`: history recording and failed scan regression coverage.
- Extend `server/internal/hub/reporter.go`: construct the history store and answer `usage.history.get`.
- Extend `server/internal/hub/hub_test.go`: Hub request validation and response coverage.
- Extend `server/internal/protocol/registry_methods.go` and `registry_methods_test.go`: additive method descriptor without a protocol version bump.
- Extend `server/internal/registry/server_test.go`: client-to-Hub forwarding and response routing.

### Web data and UI

- Modify `app/web/src/registry/registryMethods.ts`: `UsageHistoryGet` method constant.
- Modify `app/web/src/registry/registryTypes.ts`: history transport DTOs.
- Modify `app/web/src/registry/RegistryRepository.ts` and `RegistryWorkspaceService.ts`: normalized read-only history request.
- Extend `app/web/src/usage/usageTypes.ts` and `usageStore.ts`: window metadata and per-Hub account source references.
- Create `app/web/src/usage/usageHistory.ts`: parse history responses, choose longest Limit and best Hub, and calculate weighted forecasts.
- Create `app/web/src/usage/UsageHistoryChart.tsx`: ECharts registration, lifecycle, resize handling, and chart options; this file is the dynamic-import boundary.
- Create `app/web/src/usage/UsageHistoryDialog.tsx`: accessible modal state, text summary, loading/error/empty states, and lazy chart boundary.
- Modify `app/web/src/usage/UsageFeatureSurface.tsx`, `MonitorSurface.tsx`, and `MobileUsageDialog.tsx`: account-row activation from both Monitor presentations.
- Modify `app/web/src/app/WorkspaceApp.tsx`: query all associated online Hubs and own the selected-account modal state.
- Modify `app/web/src/styles/usage.css`: responsive modal and chart styling.
- Modify `app/package.json` and `app/package-lock.json`: exact ECharts 6 dependency.
- Extend existing usage tests and add focused modules only where existing files cannot carry the responsibility.

### Approved documentation

- Keep `docs/scope/2026-07-28-token-usage-curve.md` as the accepted source.
- Keep `docs/wiki/features/limits-monitoring.md` synchronized with the implemented stable behavior.

---

### Task 1: Publish stable Limit window metadata

**Files:**
- Modify: `server/internal/hub/usage/model.go`
- Modify: `server/internal/hub/usage/provider_codex.go`
- Modify: `server/internal/hub/usage/provider_kimi.go`
- Modify: `server/internal/hub/usage/provider_zai.go`
- Modify: `server/internal/hub/usage/provider_flicker.go`
- Test: `server/internal/hub/usage/providers_test.go`

- [x] **Step 1: Write failing provider metadata tests**

Add assertions to the existing parser tests:

```go
if limits[0].WindowKind != WindowFixed || limits[0].WindowDurationMins != 300 {
	t.Fatalf("primary window=%+v", limits[0])
}
if limits[1].WindowKind != WindowFixed || limits[1].WindowDurationMins != 10080 {
	t.Fatalf("secondary window=%+v", limits[1])
}
```

Add a deterministic MyFlicker reset test:

```go
func TestMyFlickerMonthWindowUsesShanghaiCalendar(t *testing.T) {
	now := time.Date(2026, 7, 31, 15, 30, 0, 0, time.UTC)
	reset := myFlickerMonthReset(now)
	want := time.Date(2026, 8, 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	if !reset.Equal(want) {
		t.Fatalf("reset=%s want=%s", reset, want)
	}
}
```

- [x] **Step 2: Run the focused provider tests and verify RED**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'Test(ParseCodexRateLimitsByWindowDuration|ParseKimiUsageUsesLimitsAndWeeklyUsage|ParseZAIQuotaUsesUnitsThreeSixAndFive|MyFlickerMonthWindowUsesShanghaiCalendar)' -count=1
```

Expected: FAIL because `WindowKind`, `WindowDurationMins`, and `myFlickerMonthReset` do not exist.

- [x] **Step 3: Add the minimal shared window model**

In `model.go`:

```go
type WindowKind string

const (
	WindowFixed         WindowKind = "fixed"
	WindowCalendarMonth WindowKind = "calendarMonth"
)

type Limit struct {
	ID                 string     `json:"id"`
	Label              string     `json:"label"`
	RemainingPercent   float64    `json:"remainingPercent"`
	WindowKind         WindowKind `json:"windowKind"`
	WindowDurationMins int64      `json:"windowDurationMins,omitempty"`
	ResetsAt           *time.Time `json:"resetsAt,omitempty"`
}
```

Populate fixed durations for Codex/Kimi/ZAI 5-hour and week windows. Populate `WindowCalendarMonth` for MyFlicker month and ZAI MCP month.

Add:

```go
func myFlickerMonthReset(now time.Time) time.Time {
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	local := now.In(shanghai)
	return time.Date(local.Year(), local.Month()+1, 1, 0, 0, 0, 0, shanghai)
}
```

Have `FlickerScanner.Scan` pass its current time into the parser or apply the calendar metadata after parsing; expose an injectable `now func() time.Time` on the scanner for tests.

- [x] **Step 4: Run all usage provider tests and verify GREEN**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'Test(Parse|Codex|Kimi|ZAI|Flicker|MyFlicker)' -count=1
```

Expected: PASS.

- [x] **Step 5: Commit the provider metadata**

```powershell
git add server/internal/hub/usage/model.go server/internal/hub/usage/provider_codex.go server/internal/hub/usage/provider_kimi.go server/internal/hub/usage/provider_zai.go server/internal/hub/usage/provider_flicker.go server/internal/hub/usage/providers_test.go
git commit -m "feat(usage): describe quota windows"
```

---

### Task 2: Implement the bounded atomic JSON history store

**Files:**
- Create: `server/internal/hub/usage/history.go`
- Test: `server/internal/hub/usage/service_test.go`

- [x] **Step 1: Add failing storage round-trip and compact JSON tests**

Add tests using `t.TempDir()` and a fixed clock:

```go
func TestHistoryStoreRecordsCompactSamplesAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db", "usage-history.json")
	store := NewHistoryStore(path)
	reset := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	at := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)
	err := store.Record(at, []ProviderSnapshot{{
		ID: ProviderCodex, Status: ProviderOK,
		Accounts: []Account{{
			LocalID: "current", Status: ProviderOK,
			Limits: []Limit{{
				ID: "week", Label: "Week", RemainingPercent: 82.4,
				WindowKind: WindowFixed, WindowDurationMins: 10080, ResetsAt: &reset,
			}},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`[1785200400000,82.4]`)) {
		t.Fatalf("history is not compact: %s", raw)
	}
	got, err := NewHistoryStore(path).Query(HistoryQuery{
		ProviderID: ProviderCodex, AccountLocalID: "current", Now: at,
	})
	if err != nil || len(got.Limits) != 1 || len(got.Limits[0].Samples) != 1 {
		t.Fatalf("query=%+v err=%v", got, err)
	}
}
```

Add separate tests for timestamp replacement, unchanged values at different timestamps, corrupt/unsupported deletion, week retention, calendar-month retention, 10,000-point cap, failed account omission, and a 7-day/current-window query cutoff.

- [x] **Step 2: Run the storage tests and verify RED**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'TestHistoryStore' -count=1
```

Expected: FAIL because `HistoryStore`, `HistoryQuery`, and response types do not exist.

- [x] **Step 3: Implement the versioned storage types and compact sample encoding**

Create `history.go` with:

```go
const (
	historyFileVersion = 1
	historyMaxPoints    = 10_000
	historyQueryRange   = 7 * 24 * time.Hour
)

type HistorySample struct {
	ObservedAtMillis int64
	RemainingPercent float64
}

func (s HistorySample) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]float64{float64(s.ObservedAtMillis), s.RemainingPercent})
}

func (s *HistorySample) UnmarshalJSON(raw []byte) error {
	var pair [2]float64
	if err := json.Unmarshal(raw, &pair); err != nil {
		return err
	}
	if pair[0] < 0 || pair[1] < 0 || pair[1] > 100 {
		return errors.New("invalid history sample")
	}
	s.ObservedAtMillis = int64(pair[0])
	s.RemainingPercent = pair[1]
	return nil
}

type historySeries struct {
	ProviderID         ProviderID      `json:"providerId"`
	AccountLocalID     string          `json:"accountLocalId"`
	LimitID            string          `json:"limitId"`
	LimitLabel         string          `json:"limitLabel"`
	WindowKind         WindowKind      `json:"windowKind"`
	WindowDurationMins int64           `json:"windowDurationMins,omitempty"`
	ResetAt            *time.Time      `json:"resetAt,omitempty"`
	Samples            []HistorySample `json:"samples"`
}

type historyFile struct {
	Version int             `json:"version"`
	Series  []historySeries `json:"series"`
}

type HistoryQuery struct {
	ProviderID     ProviderID
	AccountLocalID string
	Now            time.Time
}

type HistoryLimit struct {
	ID                 string          `json:"id"`
	Label              string          `json:"label"`
	WindowKind         WindowKind      `json:"windowKind"`
	WindowDurationMins int64           `json:"windowDurationMins,omitempty"`
	ResetsAt           *time.Time      `json:"resetsAt,omitempty"`
	Samples            []HistorySample `json:"samples"`
}

type HistoryResponse struct {
	ProviderID     ProviderID     `json:"providerId"`
	AccountLocalID string         `json:"accountLocalId"`
	Limits         []HistoryLimit `json:"limits"`
}
```

Implement `NewHistoryStore(path string)`, `Record(at time.Time, providers []ProviderSnapshot) error`, and `Query(input HistoryQuery) (HistoryResponse, error)` behind a mutex. Validate IDs, window metadata, finite percentages, and monotonic timestamps.

- [x] **Step 4: Implement retention, recovery, and atomic persistence**

Use fixed-window cutoff `resetAt - 2*duration`, calendar-month cutoff at the first day of the previous Shanghai month, and the 10,000 newest-point cap. On load failure caused by malformed JSON, unknown version, or invalid structure:

```go
if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
	return historyFile{}, fmt.Errorf("remove invalid usage history: %w", err)
}
return historyFile{Version: historyFileVersion, Series: []historySeries{}}, nil
```

Marshal once per changed scan and write with:

```go
if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
	return err
}
return shared.WriteConfigFile(s.path, raw)
```

- [x] **Step 5: Run storage tests and verify GREEN**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'TestHistoryStore' -count=1
```

Expected: PASS.

- [x] **Step 6: Commit the history store**

```powershell
git add server/internal/hub/usage/history.go server/internal/hub/usage/service_test.go
git commit -m "feat(usage): persist quota history"
```

---

### Task 3: Record raw scans without manufacturing stale samples

**Files:**
- Modify: `server/internal/hub/usage/service.go`
- Modify: `server/internal/hub/reporter.go`
- Test: `server/internal/hub/usage/service_test.go`

- [x] **Step 1: Write failing raw-recording service tests**

Use a recording fake:

```go
type historyRecorderStub struct {
	at        time.Time
	providers []ProviderSnapshot
	calls     int
}

func (s *historyRecorderStub) Record(at time.Time, providers []ProviderSnapshot) error {
	s.at, s.providers, s.calls = at, append([]ProviderSnapshot(nil), providers...), s.calls+1
	return nil
}
```

Test that a successful raw account is recorded once, and that a subsequent error snapshot is passed to the recorder as an error rather than the old merged success:

```go
if recorder.calls != 2 || recorder.providers[0].Accounts[0].Status != ProviderError {
	t.Fatalf("recorder=%+v", recorder)
}
if service.Snapshot().Providers[0].Accounts[0].Status != ProviderOK {
	t.Fatalf("visible snapshot did not preserve last success")
}
```

- [x] **Step 2: Run the focused service tests and verify RED**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'TestService.*History' -count=1
```

Expected: FAIL because the service has no history recorder.

- [x] **Step 3: Add the recorder boundary before merge**

Add:

```go
type HistoryRecorder interface {
	Record(time.Time, []ProviderSnapshot) error
}

type ServiceOptions struct {
	// existing fields...
	History HistoryRecorder
}
```

In `execute`, preserve the collector output in `rawProviders`, obtain `now`, call `History.Record(now, rawProviders)`, log or surface the persistence error without changing the Provider snapshot, and only then call `mergeProviderSnapshots(previous, rawProviders)`.

Construct the store in `NewReporter`:

```go
history := usage.NewHistoryStore(filepath.Join(stateDir, "db", "usage-history.json"))
r.usageService = usage.NewService(usage.ServiceOptions{
	HubID: r.cfg.HubID, Collector: collector, History: history,
	OnSnapshot: r.updateUsageSnapshot,
})
r.usageHistory = history
```

Add `usageHistory *usage.HistoryStore` to `Reporter`.

- [x] **Step 4: Run service and Hub startup tests**

Run:

```powershell
go -C server test ./internal/hub/usage ./internal/hub -run 'Test(Service.*History|Reporter.*Usage|HubState.*Token)' -count=1
```

Expected: PASS; a history write failure must not turn the latest Limits scan into an error.

- [x] **Step 5: Commit raw scan wiring**

```powershell
git add server/internal/hub/usage/service.go server/internal/hub/usage/service_test.go server/internal/hub/reporter.go
git commit -m "feat(hub): record raw quota scans"
```

---

### Task 4: Add the read-only usage history Registry method

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: Write failing descriptor and routing tests**

Add:

```go
func TestUsageHistoryGetDescriptor(t *testing.T) {
	got, ok := RegistryMethod(RegistryMethodUsageHistoryGet)
	if !ok || got.Route != RegistryRouteHubState || !got.RequiresHubID {
		t.Fatalf("descriptor=%+v ok=%v", got, ok)
	}
}
```

Add a Registry WebSocket test that sends `usage.history.get` from a client with `hubId`, verifies exact forwarding to the Hub, returns a response, and verifies the response reaches the requesting client.

Add Hub tests for valid request, blank `providerId`, blank `accountLocalId`, missing store, and no matching history.

- [x] **Step 2: Run protocol/Registry/Hub tests and verify RED**

Run:

```powershell
go -C server test ./internal/protocol ./internal/registry ./internal/hub -run 'Test.*UsageHistory' -count=1
```

Expected: FAIL because the method and handler do not exist.

- [x] **Step 3: Register the additive method**

Add:

```go
const RegistryMethodUsageHistoryGet = "usage.history.get"
```

Register it with the existing Hub-state forwarding route:

```go
RegistryMethodUsageHistoryGet: registryHubStateMethod(RegistryMethodUsageHistoryGet),
```

Do not edit the protocol version constant or compatibility docs.

- [x] **Step 4: Implement the Hub request handler**

Define a narrow payload:

```go
type usageHistoryGetPayload struct {
	ProviderID     usage.ProviderID `json:"providerId"`
	AccountLocalID string           `json:"accountLocalId"`
}
```

Route the method in `handleRegistryRequest`, validate exact non-empty values, call:

```go
result, err := r.usageHistory.Query(usage.HistoryQuery{
	ProviderID: payload.ProviderID,
	AccountLocalID: payload.AccountLocalID,
	Now: time.Now().UTC(),
})
```

Return `{hubId, providerId, accountLocalId, limits}` as the response payload. Use `INVALID_ARGUMENT` for malformed input and the existing internal error code for unreadable storage.

- [x] **Step 5: Run all focused routing tests and verify GREEN**

Run:

```powershell
go -C server test ./internal/protocol ./internal/registry ./internal/hub -run 'Test.*UsageHistory' -count=1
```

Expected: PASS.

- [x] **Step 6: Commit the read API**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/registry/server_test.go
git commit -m "feat(protocol): expose quota history"
```

---

### Task 5: Preserve per-Hub account sources and fetch raw histories

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/usage/usageTypes.ts`
- Modify: `app/web/src/usage/usageStore.ts`
- Test: `app/__tests__/web-usage-store.test.ts`
- Test: `app/__tests__/web-usage-types.test.ts`
- Test: `app/__tests__/web-hub-state-service.test.ts`

- [x] **Step 1: Write failing source-reference and transport tests**

Extend the store test so two Hubs with the same identity retain distinct source references:

```ts
expect(account.sources).toEqual([
  {hubId: 'hub-a', accountLocalId: 'local-a', updatedAt: '2026-07-28T01:00:00Z'},
  {hubId: 'hub-b', accountLocalId: 'local-b', updatedAt: '2026-07-28T01:10:00Z'},
]);
```

Add a repository request assertion:

```ts
expect(client.request).toHaveBeenCalledWith({
  method: 'usage.history.get',
  hubId: 'hub-a',
  payload: {providerId: 'codex', accountLocalId: 'current'},
  timeoutMs: 15000,
});
```

- [x] **Step 2: Run focused Web tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-store.test.ts __tests__/web-usage-types.test.ts __tests__/web-hub-state-service.test.ts
```

Expected: FAIL because account sources, method constants, and history DTOs do not exist.

- [x] **Step 3: Add exact TypeScript DTOs**

In `registryTypes.ts`:

```ts
export interface RegistryUsageHistorySample {
  observedAtMillis: number;
  remainingPercent: number;
}

export interface RegistryUsageHistoryLimit {
  id: string;
  label: string;
  windowKind: 'fixed' | 'calendarMonth';
  windowDurationMins?: number;
  resetsAt?: string;
  samples: RegistryUsageHistorySample[];
}

export interface RegistryUsageHistoryResponse {
  hubId: string;
  providerId: string;
  accountLocalId: string;
  limits: RegistryUsageHistoryLimit[];
}
```

Normalize the wire arrays `[timestamp, percent]` into named sample objects in `RegistryRepository.getUsageHistory`, rejecting non-finite timestamps, percentages outside 0–100, or malformed limits.

- [x] **Step 4: Preserve source references during account aggregation**

Add:

```ts
export interface UsageAccountSource {
  hubId: string;
  accountLocalId: string;
  updatedAt?: string;
}

export interface UsageViewAccount extends UsageAccount {
  hubIds: string[];
  sources: UsageAccountSource[];
}
```

When merging identical accounts, union sources by `hubId + accountLocalId`, keep each source's latest `updatedAt`, and sort by `hubId` for deterministic snapshots.

- [x] **Step 5: Run Web data tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-store.test.ts __tests__/web-usage-types.test.ts __tests__/web-hub-state-service.test.ts
npm --prefix app run tsc:web
```

Expected: PASS.

- [x] **Step 6: Commit Web history transport**

```powershell
git add app/web/src/registry app/web/src/usage/usageTypes.ts app/web/src/usage/usageStore.ts app/__tests__/web-usage-store.test.ts app/__tests__/web-usage-types.test.ts app/__tests__/web-hub-state-service.test.ts
git commit -m "feat(app): fetch raw quota history"
```

---

### Task 6: Implement deterministic longest-Limit selection and forecast math

**Files:**
- Create: `app/web/src/usage/usageHistory.ts`
- Test: `app/__tests__/web-usage-history.test.ts`

- [x] **Step 1: Write failing pure-function tests**

Cover:

```ts
test('prefers a calendar month over a week and a week over five hours', () => {
  expect(selectLongestLimit([fiveHour, week, month])?.id).toBe('month');
});

test('chooses fresh sufficient history by span, count, then newest sample', () => {
  expect(selectBestHistory(candidates, now)?.hubId).toBe('hub-wide');
});

test('includes flat intervals and excludes increases', () => {
  const HOUR = 60 * 60 * 1000;
  const hour = (value: number) => value * HOUR;
  const forecast = calculateUsageForecast({
    samples: [
      {observedAtMillis: hour(0), remainingPercent: 80},
      {observedAtMillis: hour(1), remainingPercent: 80},
      {observedAtMillis: hour(2), remainingPercent: 90},
      {observedAtMillis: hour(3), remainingPercent: 70},
    ],
    resetsAtMillis: hour(10),
    lookbackMillis: 24 * HOUR,
  });
  expect(forecast.validIntervalCount).toBe(2);
  expect(forecast.speedPerHour).toBeGreaterThan(0);
});
```

Also cover fewer than 3 points, stale candidates, 24/72-hour cutoffs, zero speed, early depletion, safe reset remaining, duplicate timestamps, invalid values, and deterministic ties.

- [x] **Step 2: Run the pure tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-history.test.ts
```

Expected: FAIL because `usageHistory.ts` does not exist.

- [x] **Step 3: Implement selection helpers**

Export:

```ts
export function selectLongestLimit(limits: UsageHistoryLimit[]): UsageHistoryLimit | undefined;
export function selectBestHistory(candidates: UsageHistoryCandidate[], nowMillis: number): UsageHistoryCandidate | undefined;
```

Define the domain inputs in the same file:

```ts
export type UsageHistoryLimit = RegistryUsageHistoryLimit;

export interface UsageHistoryCandidate {
  hubId: string;
  limit: UsageHistoryLimit;
}
```

Score fixed windows by `windowDurationMins`; treat `calendarMonth` as longer than any current fixed week. Candidate eligibility is last sample age `<= 20 * MINUTE` and sample count `>= 3`; compare span, count, then last timestamp.

- [x] **Step 4: Implement the weighted forecast**

Export:

```ts
export interface UsageForecast {
  status: 'insufficient' | 'depletesBeforeReset' | 'safeUntilReset';
  speedPerHour?: number;
  depletionAtMillis?: number;
  remainingAtReset?: number;
  projection: Array<{observedAtMillis: number; remainingPercent: number}>;
  validIntervalCount: number;
}
```

For each valid adjacent interval:

```ts
const speed = Math.max(0, previous.remainingPercent - current.remainingPercent) / elapsedHours;
const age = latestMillis - (previous.observedAtMillis + elapsedMillis / 2);
const weight = 2 ** (-age / halfLifeMillis);
```

Skip increasing intervals, include zero speed, and use half-life 12 hours for a 24-hour week lookback and 36 hours for a 72-hour month lookback. Clamp projected percentages to 0–100.

- [x] **Step 5: Run pure tests and verify GREEN**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-history.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit forecast logic**

```powershell
git add app/web/src/usage/usageHistory.ts app/__tests__/web-usage-history.test.ts
git commit -m "feat(app): forecast quota depletion"
```

---

### Task 7: Add the lazy ECharts renderer and accessible modal

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/web/src/usage/UsageHistoryChart.tsx`
- Create: `app/web/src/usage/UsageHistoryDialog.tsx`
- Modify: `app/web/src/styles/usage.css`
- Test: `app/__tests__/web-usage-history-dialog.test.tsx`

- [x] **Step 1: Install the exact ECharts dependency**

Run:

```powershell
npm --prefix app install --save-exact echarts@6.0.0
```

Expected: `package.json` and `package-lock.json` list exact `6.0.0`.

- [x] **Step 2: Write failing dialog state and accessibility tests**

Mock the lazy chart module and verify:

```ts
expect(dialog.props.role).toBe('dialog');
expect(dialog.props['aria-modal']).toBe(true);
expect(renderedText(view!.root)).toContain('82.4% remaining');
expect(renderedText(view!.root)).toContain('Resets');
```

Cover loading histories, loading chart code, insufficient samples, early depletion, safe-until-reset, all-Hub error with retry, backdrop close, close button, `Escape`, and trigger focus restoration.

- [x] **Step 3: Run dialog tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-history-dialog.test.tsx
```

Expected: FAIL because the modal and chart modules do not exist.

- [x] **Step 4: Implement the dynamic chart boundary**

`UsageHistoryDialog.tsx` must use:

```tsx
const LazyUsageHistoryChart = React.lazy(() => import(
  /* webpackChunkName: "usage-history-chart" */
  './UsageHistoryChart'
));
```

`UsageHistoryChart.tsx` must default-export the chart component so the lazy import resolves without an adapter.

`UsageHistoryChart.tsx` must import only:

```ts
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent, MarkLineComponent, TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

echarts.use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
```

Initialize once from a `ref`, call `setOption` on data/theme changes, observe container size with `ResizeObserver`, and call `dispose()` on unmount.

- [x] **Step 5: Build exact chart options**

Use a fixed 0–100 value axis and a time axis. Render:

```ts
series: [
  {name: 'Observed', type: 'line', showSymbol: false, smooth: 0.2, smoothMonotone: 'x', areaStyle: {...}},
  {name: 'Projected', type: 'line', showSymbol: false, lineStyle: {type: 'dashed'}},
]
```

Add a reset `markLine`, an optional depletion marker, local-time Tooltip formatting, and CSS-variable-derived colors. Ensure line smoothing cannot overshoot by retaining monotone x smoothing and clamped points.

- [x] **Step 6: Implement modal focus and equivalent text**

The dialog must:

- focus its close button on mount;
- listen for `Escape`;
- close on overlay pointer-down only;
- return focus to the account trigger on unmount;
- render current remaining, observation range, reset time, and either depletion time or reset remaining as normal DOM text outside Canvas.

- [x] **Step 7: Run dialog tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-history-dialog.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [x] **Step 8: Commit the chart modal**

```powershell
git add app/package.json app/package-lock.json app/web/src/usage/UsageHistoryChart.tsx app/web/src/usage/UsageHistoryDialog.tsx app/web/src/styles/usage.css app/__tests__/web-usage-history-dialog.test.tsx
git commit -m "feat(app): add quota history chart"
```

---

### Task 8: Wire account rows to all-Hub history loading

**Files:**
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`
- Modify: `app/web/src/usage/MonitorSurface.tsx`
- Modify: `app/web/src/usage/MobileUsageDialog.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`
- Test: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] **Step 1: Write failing row activation and integration tests**

Verify a percentage account row is a keyboard-operable button-like control and a balance-only row is not:

```ts
const row = view!.root.findByProps({'data-usage-account-trigger': 'codex:current'});
expect(row.props.role).toBe('button');
act(() => row.props.onClick());
expect(onOpenHistory).toHaveBeenCalledWith(expect.objectContaining({localId: 'current'}));
expect(view!.root.findAllByProps({'data-usage-account-trigger': 'deepseek:wheelmaker-config'})).toHaveLength(0);
```

In the workspace integration test, provide two sources, resolve one history request and reject the other, then assert the modal still renders the successful candidate.

- [x] **Step 2: Run integration tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: FAIL because row callbacks and modal orchestration do not exist.

- [x] **Step 3: Add account activation props**

Pass:

```ts
type UsageOpenHistory = (provider: UsageProviderView, account: UsageViewAccount, trigger: HTMLElement) => void;
```

from `MonitorSurface` and `MobileUsageDialog` into compact/detail content. Use native `<button>` wrappers where layout permits; otherwise implement `role="button"`, `tabIndex={0}`, Enter/Space handling, and a visible focus ring. Do not attach the callback when `account.limits.length === 0`.

- [x] **Step 4: Query all source Hubs in WorkspaceApp**

On activation:

```ts
const settled = await Promise.allSettled(account.sources.map(source =>
  service.getUsageHistory(source.hubId, provider.id, source.accountLocalId)
));
```

Keep fulfilled responses, parse them into candidates, select the longest Limit and best Hub in `usageHistory.ts`, calculate the forecast, and update dialog state. Retain errors only to show the all-failed state. Retry must repeat the same source set.

- [x] **Step 5: Render one global responsive modal**

Render `UsageHistoryDialog` once near the existing application overlays so it appears above either desktop Monitor or mobile Monitor. Opening it must not close the underlying Monitor. Closing it must restore focus to the triggering row.

- [x] **Step 6: Run integration tests and verify GREEN**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-usage-history-dialog.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [x] **Step 7: Commit end-to-end UI wiring**

```powershell
git add app/web/src/usage app/web/src/app/WorkspaceApp.tsx app/__tests__/web-usage-feature-surface.test.tsx app/__tests__/web-usage-workspace-integration.test.tsx
git commit -m "feat(app): open quota curves from limits"
```

---

### Task 9: Full regression, bundle boundary, and documentation parity

**Files:**
- Modify if implementation differs: `docs/scope/2026-07-28-token-usage-curve.md`
- Modify if stable behavior differs: `docs/wiki/features/limits-monitoring.md`
- Update checklist: `docs/plans/2026-07-28-token-usage-curve/plan-token-usage-curve.md`

- [x] **Step 1: Format Go and run package tests**

Run:

```powershell
gofmt -w server/internal/hub/usage/*.go server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/server_test.go
go -C server test ./internal/hub/usage ./internal/protocol ./internal/registry ./internal/hub
```

Expected: PASS.

- [x] **Step 2: Run all App usage tests**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-store.test.ts __tests__/web-usage-types.test.ts __tests__/web-usage-history.test.ts __tests__/web-usage-history-dialog.test.tsx __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [x] **Step 3: Run full server and App regression suites**

Run:

```powershell
go -C server test ./...
npm --prefix app test -- --runInBand
```

Expected: PASS.

- [x] **Step 4: Build production Web into an isolated target**

Run:

```powershell
$env:WHEELMAKER_WEB_TARGET = Join-Path $env:TEMP 'wheelmaker-token-usage-web'
npm --prefix app run build:web
Get-ChildItem -LiteralPath $env:WHEELMAKER_WEB_TARGET -File | Select-Object Name, Length
```

Expected: PASS; output contains a separately named `usage-history-chart.<hash>.js` async chunk and the main bundle does not inline the ECharts module.

- [x] **Step 5: Check the accepted documentation against actual behavior**

Run:

```powershell
rg -n -i 'TBD|TODO|implement later' docs/scope/2026-07-28-token-usage-curve.md docs/wiki/features/limits-monitoring.md
git diff --check
git status --short
```

Expected: no placeholders, no whitespace errors, and only intended feature files changed.

- [x] **Step 6: Rebase and rerun smoke tests if HEAD changes**

Run:

```powershell
git fetch origin
git rebase origin/main
go -C server test ./internal/hub/usage ./internal/protocol ./internal/registry ./internal/hub
npm --prefix app test -- --runInBand __tests__/web-usage-history.test.ts __tests__/web-usage-history-dialog.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: rebase and tests pass.

- [x] **Step 7: Record completion and execute the repository completion gate**

Update every completed plan checkbox to `[x]`, then execute this exact tail:

```powershell
git add -A
git commit -m "docs: record token usage curve verification"
git push origin feat/token-usage-curve
```

Expected: commit succeeds and the remote feature branch is updated.

### Verification record

- `origin/main` was confirmed at `7402490f` (`merge: add flicker bridge v2 mode`); the feature branch was already based on it.
- Full server regression: PASS.
- Full App regression: 238 suites and 1,409 tests PASS.
- Web TypeScript: PASS.
- Production Web build: PASS. The renderer entry is `usage-history-chart.cf5d52db58f4a664e858.js` (4,397 bytes), while ECharts is isolated in the async vendor chunk `4934.e07c26b3780143e8a859.js`.
