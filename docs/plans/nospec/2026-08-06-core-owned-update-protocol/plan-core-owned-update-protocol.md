# Core-Owned Update Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `deploy-core.mjs` the sole owner of the local update lease/status protocol, reduce Go `update.go` to updater triggering plus read-only monitoring, remove obsolete Gateway compatibility facades, and keep `deploy-core.mjs` as one internally organized file.

**Architecture:** The existing `node deploy.mjs update` command remains the only updater entry; it lets core create or adopt the update lease, write all progress/terminal state, recover stale work, and apply the release. `update.go` keeps the existing Registry/Hub command surface, triggers the installed OS updater without writing update files, and reads/watches core-owned state. The Registry response keeps `jobId` optional: if the updater has not created the lease before the request returns, the response is accepted without a job and the next state query supplies it.

**Tech Stack:** Node.js 22 ESM, Node `node:test`, Go Hub tools, `fsnotify`, existing `staging/lock.json`, `staging/status.json`, and `release.json` contracts.

---

## File Structure

- Modify `server/internal/hub/tools/update.go`: remove Go-owned lease/status writes, stale reaping, and job ID allocation; retain read models, updater trigger, and completion monitoring.
- Add `server/internal/hub/tools/state_files.go`: retain generic atomic job/lease file helpers used by debug/release commands, outside the update monitor.
- Modify `server/internal/hub/tools/tools_test.go`: replace tests that require Go to create/reap/update leases with tests proving request triggering and read-only monitoring.
- Modify `scripts/deploy/deploy-core.test.mjs`: add/adjust tests proving an internal update creates its own lease when no queued lease exists and owns terminal cleanup; keep the implementation in the existing core file.
- Modify `scripts/deploy/gateway-config.test.mjs`, `scripts/deploy/gateway-install.test.mjs`, and `scripts/deploy/gateway-runtime.test.mjs`: import the implementation directly from `deploy-core.mjs`.
- Delete `scripts/deploy/gateway-config.mjs`, `scripts/deploy/gateway-install.mjs`, and `scripts/deploy/gateway-runtime.mjs`: these are obsolete two-line compatibility facades, not published artifacts.
- Modify `scripts/deploy/deploy-core.mjs`: retain one file, but consolidate duplicate internal helpers and arrange sections around shared primitives, Workspace deployment, and Gateway implementation without changing the published entrypoint.
- Modify `docs/wiki/release-and-build/release.md`: document that core owns lease/status state and Hub update requests trigger the existing updater; remove the statement that Go creates/reaps the queued lease.

---

### Task 1: Remove obsolete Gateway facades

**Files:**
- Modify: `scripts/deploy/gateway-config.test.mjs`
- Modify: `scripts/deploy/gateway-install.test.mjs`
- Modify: `scripts/deploy/gateway-runtime.test.mjs`
- Delete: `scripts/deploy/gateway-config.mjs`
- Delete: `scripts/deploy/gateway-install.mjs`
- Delete: `scripts/deploy/gateway-runtime.mjs`

- [ ] **Step 1: Redirect tests before deleting implementation files**

Replace each test import path as follows:

~~~
// gateway-config.test.mjs
} from './deploy-core.mjs';

// gateway-install.test.mjs
import { installGatewayFromStable, validateGatewayManifest } from './deploy-core.mjs';

// gateway-runtime.test.mjs
} from './deploy-core.mjs';
~~~

- [ ] **Step 2: Run Gateway tests and confirm they remain green**

Run:

~~~
node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
~~~

Expected: all existing Gateway tests pass while the three facades still exist.

- [ ] **Step 3: Delete the three unused facade files**

Delete only the three 2-line files named above. Do not delete Gateway implementation sections from `deploy-core.mjs`.

- [ ] **Step 4: Re-run the Gateway tests and source import check**

Run:

~~~
node --test scripts/deploy/gateway-config.test.mjs scripts/deploy/gateway-install.test.mjs scripts/deploy/gateway-runtime.test.mjs
rg -n "gateway-(config|install|runtime)\\.mjs" scripts/deploy docs scripts/release
~~~

Expected: tests pass; remaining references are absent or only historical documentation references that are not runtime imports.

---

### Task 2: Specify read-only Go update monitoring with failing tests

**Files:**
- Modify: `server/internal/hub/tools/tools_test.go`

- [ ] **Step 1: Replace the Go-owned lease request test with a trigger-only test**

Change the request test so it asserts that a request with no active job:

~~~
response := handleUpdateForTest(t, cmd, map[string]any{
    "action": "request",
    "hubId":  "hub-a",
})
if !response.OK || !response.Accepted || response.Status != "update_pending" {
    t.Fatalf("response=%+v, want accepted update_pending", response)
}
if response.JobID != "" || response.Job != nil {
    t.Fatalf("response=%+v, update.go must not allocate a job", response)
}
if trigger.Calls() != 1 {
    t.Fatalf("trigger calls=%d, want 1", trigger.Calls())
}
if _, err := os.Stat(filepath.Join(baseDir, "staging", "lock.json")); !errors.Is(err, os.ErrNotExist) {
    t.Fatalf("lock exists or stat failed: %v", err)
}
if _, err := os.Stat(filepath.Join(baseDir, "staging", "status.json")); !errors.Is(err, os.ErrNotExist) {
    t.Fatalf("status exists or stat failed: %v", err)
}
~~~

- [ ] **Step 2: Replace stale-reaping expectations with a non-mutating query test**

Keep a stale `lock.json` and active `status.json`, call `query`, and assert:

~~~
if response.Status != "update_pending" || response.CanRequest {
    t.Fatalf("response=%+v, want active read-only state", response)
}
if got, err := os.ReadFile(lockPath); err != nil || !bytes.Equal(got, beforeLock) {
    t.Fatalf("query mutated lock: %v", err)
}
if got, err := os.ReadFile(statusPath); err != nil || !bytes.Equal(got, beforeStatus) {
    t.Fatalf("query mutated status: %v", err)
}
~~~

- [ ] **Step 3: Run the focused Go tests and confirm RED**

Run from `server/`:

~~~
go test ./internal/hub/tools -run 'TestUpdate(Query|Request|Command|Updater)' -count=1
~~~

Expected: the old implementation fails because it creates `lock.json`/`status.json` and reaps stale state in Go.

---

### Task 3: Move update state ownership to core and keep `update.go` as trigger/monitor

**Files:**
- Modify: `server/internal/hub/tools/update.go`
- Modify: `scripts/deploy/deploy-core.test.mjs`

- [ ] **Step 1: Remove Go state-machine code**

Delete the Go definitions and methods whose only purpose is to create or mutate update protocol state:

~~~
staleUpdateLeaseThreshold
queuedUpdateRetriggerGrace
newUpdateJobID
createUpdateLease
replaceUpdateFile
writeJobStatus
updateLeaseHeartbeatAge
updateLeaseStale
failUpdateJob
~~~

Keep the read-only JSON models for `release.json`, `lock.json`, and `status.json`, `readInstalledRelease`, `readJobStatus`, and `readJobState`. `readJobState` must return the current job and whether a valid lock is present without changing either file.

- [ ] **Step 2: Make request trigger the installed updater without writing state**

Replace `UpdateCommand.request` with this behavior:

~~~
func (c *UpdateCommand) request(ctx context.Context, hubID string) (updateCommandResponse, *updateCommandError) {
    if job, active := c.readJobState(); active && job != nil {
        c.watchCompletion(job.JobID)
        return queuedUpdateResponse(hubID, job.JobID, job), nil
    }
    if err := c.trigger.Trigger(ctx); err != nil {
        return updateCommandResponse{}, internalUpdateError("failed to trigger updater runtime")
    }
    return updateCommandResponse{
        OK: true,
        Accepted: true,
        Status: "update_pending",
        HubID: hubID,
        CanRequest: false,
    }, nil
}
~~~

The request may omit `jobId` because the background `node deploy.mjs update` process creates the job in core after the trigger returns. If the state becomes visible before the trigger returns, `update.go` only reads and returns that state. Existing TypeScript response types already make `jobId` and `job` optional.

- [ ] **Step 3: Make completion monitoring depend on core-owned terminal status**

Keep `watchCompletion` and its callback, but stop it from writing or reaping state. It may use the terminal state strings only to decide when to notify; all transitions and lock deletion remain in core.

- [ ] **Step 4: Add a core regression test for no pre-created lease**

Add a `runCore(['update'])` test with no existing `staging/lock.json` and assert that the injected update flow creates a lease, writes terminal status, and removes the lock through core. This protects the new path where Go no longer pre-creates the queued lease.

- [ ] **Step 5: Run focused Go and Node tests**

Run:

~~~
go test ./internal/hub/tools -run 'TestUpdate(Query|Request|Command|Updater)' -count=1
node --test scripts/deploy/deploy-core.test.mjs
~~~

Expected: all focused tests pass, and no Go test observes `lock.json` or `status.json` being written by `UpdateCommand`.

---

### Task 4: Optimize `deploy-core.mjs` internally without splitting the file

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`

- [ ] **Step 1: Establish helper consolidation tests/source guards**

Extend the existing source-level self-contained test so it still asserts that `deploy-core.mjs` has no local imports and add assertions that the published core retains the single shared helper names used by both Workspace and Gateway paths:

~~~
assert.equal((source.match(/gatewayInstallSha256Bytes/g) ?? []).length, 0);
assert.equal((source.match(/gatewayInstallJsonBytes/g) ?? []).length, 0);
assert.equal((source.match(/gatewayInstallResolveReleasePath/g) ?? []).length, 0);
assert.equal((source.match(/gateway(?:Config|Runtime|Install)AtomicWrite/g) ?? []).length, 0);
~~~

- [ ] **Step 2: Run the source guard and confirm RED**

Run:

~~~
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs
~~~

Expected: the new duplicate-helper assertions fail against the current core because Gateway has separate hash/write/release-path helpers.

- [ ] **Step 3: Consolidate only behavior-equivalent helpers**

Use the existing shared implementations for Gateway paths:

~~~
const digest = sha256Bytes(bytes);
const body = jsonBytes(value);
await atomicWrite(path, bytes, mode);
const url = resolveReleasePath(releaseBaseUrl, path, label);
~~~

Reuse `runProcess` for Gateway process execution after preserving its `allowFailure`, `cwd`, and captured stdout/stderr behavior. Keep Gateway-specific validation and platform plans separate by section; do not change command names, artifact paths, or the published two-file layout.

- [ ] **Step 4: Reorder and label the single-file sections**

Keep one file and one export surface, with this order:

~~~
shared file/JSON/hash/process helpers
update lease/status and archive staging
platform runtime/wrapper helpers
legacy migration and Desktop helpers
Workspace config and deployment transaction
runCore dispatcher
Gateway config
Gateway runtime
Gateway installation
~~~

Do not introduce new local imports or split source files.

- [ ] **Step 5: Run all deployment tests and verify the self-contained artifact**

Run:

~~~
node --test scripts/deploy/*.test.mjs
~~~

Expected: all deployment tests pass, including the no-local-import and helper-consolidation guards.

---

### Task 5: Update architecture documentation and final verification

**Files:**
- Modify: `docs/wiki/release-and-build/release.md`

- [ ] **Step 1: Update the update ownership description**

Document that `update.go` triggers the existing updater and monitors files, while `deploy-core.mjs` creates and owns `lock.json`, `status.json`, stale recovery, and terminal cleanup. Do not change Registry protocol version or public command names.

- [ ] **Step 2: Run Go and Node verification**

Run:

~~~
go test ./internal/hub/tools
node --test scripts/deploy/*.test.mjs
~~~

Expected: both commands exit 0.

- [ ] **Step 3: Inspect scope and diff**

Run:

~~~
git status --short
git diff --stat
git diff -- server/internal/hub/tools/update.go scripts/deploy/deploy-core.mjs scripts/deploy/gateway-config.mjs scripts/deploy/gateway-install.mjs scripts/deploy/gateway-runtime.mjs
~~~

Confirm that no unrelated dirty files are modified and that `deploy-core.mjs` remains one file with no local imports.
