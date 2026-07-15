# Remove Stream Timeout Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the stream-idle observer and its App system timeout message without changing prompt delivery, agent recovery, or other timeout systems.

**Architecture:** `Session.handlePromptBlocks` will consume the agent update channel directly. The dedicated observer, one-second ticker, thresholds, rate limiter, and system-message reporter will be removed as one isolated feature. Existing prompt completion and agent-error paths remain intact.

**Tech Stack:** Go, Go standard library testing.

---

### Task 1: Retire tests for the removed observer

**Files:**
- Modify: `server/internal/hub/client/client_test.go:405-428,850-887`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Run the current focused tests to establish the baseline**

Run: `go test ./internal/hub/client -run 'Test(ReportTimeoutErrorRecordsSystemEventThroughViewSink|PromptObserve_FirstWaitTransitions|PromptObserve_SilenceTransitions|TimeoutNotifyLimiter_Cooldown)$' -count=1`

Expected: PASS; this confirms each selected test belongs only to the retiring feature.

- [x] **Step 2: Delete the four observer-only test functions**

Remove these complete functions from `server/internal/hub/client/client_test.go`:

```go
func TestReportTimeoutErrorRecordsSystemEventThroughViewSink(t *testing.T) { /* obsolete timeout system-message assertion */ }
func TestPromptObserve_FirstWaitTransitions(t *testing.T) { /* obsolete first-wait threshold assertion */ }
func TestPromptObserve_SilenceTransitions(t *testing.T) { /* obsolete silence threshold assertion */ }
func TestTimeoutNotifyLimiter_Cooldown(t *testing.T) { /* obsolete notification limiter assertion */ }
```

- [x] **Step 3: Verify no test references the retired symbols**

Run: `rg -n "reportTimeoutError|newPromptObserveState|timeoutNotifyLimiter" server/internal/hub/client --glob '*_test.go'`

Expected: no output.

### Task 2: Remove the observer from the prompt path

**Files:**
- Delete: `server/internal/hub/client/session_observe.go`
- Modify: `server/internal/hub/client/session.go:71,106,1221-1308,1373-1396`
- Test: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Remove the Session-owned observer dependency**

Delete the field and construction entry:

```go
timeoutLimiter *timeoutNotifyLimiter
timeoutLimiter: newTimeoutNotifyLimiter(timeoutNotifyCooldown),
```

- [x] **Step 2: Restore direct update-channel consumption**

Replace the observer setup and `select` wrapper with a direct channel loop while retaining all update, result, cancellation, recovery, `currentCh` cleanup, persistence, and reply branches:

```go
var buf strings.Builder
for ev := range updates {
    // keep the existing event/error/result handling body
}
```

Remove `observe.MarkActivity`, `observeTicker.Stop`, and the ticker branch that emits the 60-second logs and 180-second system message.

- [x] **Step 3: Delete the reporter and its implementation file**

Remove the full `reportTimeoutError(stage, kind string)` method, then delete `server/internal/hub/client/session_observe.go` in full. Do not modify `renderUnknown`, `reply`, `recordSessionViewEvent`, agent reconnection, or any other timeout implementation.

- [x] **Step 4: Format and run package tests**

Run: `gofmt -w server/internal/hub/client/session.go server/internal/hub/client/client_test.go`

Run: `go test ./internal/hub/client -count=1`

Expected: PASS.

### Task 3: Verify the retired behavior is absent

**Files:**
- Modify: `docs/plans/2026-07-15-remove-stream-timeout-observability-plan.md`

- [x] **Step 1: Scan production code for the retired mechanism**

Run: `rg -n "reportTimeoutError|newPromptObserveState|promptObserveInterval|timeoutNotifyLimiter|category=timeout stage=stream" server --glob '*.go'`

Expected: no output.

- [x] **Step 2: Run the full server test suite**

Run: `go test ./...`

Working directory: `server`

Expected: PASS.

- [x] **Step 3: Record verification and commit the change**

Run: `git status --short`

Expected: only the plan and intended stream-observer deletions are present before the required repository commit and push.
