# Windows Publish Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Windows desktop publishing and updater-driven releases to complete without accepting false Web-asset detections or blocking on an unprivileged legacy-service cleanup.

**Architecture:** The desktop publisher will retain only asset markers that uniquely indicate an embedded Workspace bundle. The deployment CLI will make the Windows cleanup script emit a stable `requires elevation` sentinel before attempting service changes; cleanup will turn that output into a sentinel error. The caller will report that warning and preserve the old service binary. Real removal failures remain fatal.

**Tech Stack:** PowerShell 7, Go 1.26, Go standard-library tests.

---

### Task 1: Protect desktop publishing from Go-path false positives

**Files:**
- Modify: `scripts/test_publish_desktop_ps1.ps1`
- Modify: `scripts/publish_desktop.ps1`

- [x] **Step 1: Write the failing script-contract test**

Add this assertion after the existing remote-only marker assertions:

```powershell
Assert-NotContains "publish_desktop.ps1" $script '"bundle."'
```

- [x] **Step 2: Verify the test fails for the intended reason**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_publish_desktop_ps1.ps1`

Expected: FAIL because `Assert-RemoteOnlyDesktopBinary` still includes `"bundle."`.

- [x] **Step 3: Remove the non-unique marker**

Change the marker list in `Assert-RemoteOnlyDesktopBinary` to:

```powershell
@("service-worker.js", "manifest.webmanifest", ":9632")
```

This keeps checks for actual embedded Workspace artifacts while excluding Go file paths such as `h2_bundle.go`.

- [x] **Step 4: Verify the contract test passes**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_publish_desktop_ps1.ps1`

Expected: `desktop publish script checks passed`.

### Task 2: Continue an update when the old Windows service requires elevation

**Files:**
- Modify: `server/cmd/wheelmaker-deploy/legacy_monitor.go`
- Modify: `server/cmd/wheelmaker-deploy/main.go`
- Modify: `server/cmd/wheelmaker-deploy/main_test.go`

- [x] **Step 1: Write failing tests for the sentinel and warning**

Extend `legacyMonitorRunner` with an `output string` field and return it from `Run`. Add tests that set its output to the planned sentinel, call Windows cleanup, and assert that it returns the exact `legacy monitor cleanup requires elevation` error without deleting the local legacy binary. Add an update-flow test that asserts the deploy report contains that message and continues to later update work.

- [x] **Step 2: Verify the new Go tests fail**

Run: `go test ./cmd/wheelmaker-deploy -run 'TestCleanupLegacyMonitor|TestUpdate.*LegacyMonitor' -count=1`

Expected: FAIL because successful command output is currently discarded and cleanup returns nil instead of the required elevation error.

- [x] **Step 3: Implement the minimal sentinel flow**

Define a constant sentinel in `legacy_monitor.go`, have the Windows PowerShell cleanup script check its elevation token before stopping or deleting an existing service, and return the sentinel as normal output when elevation is absent. Convert that output into an unexported sentinel error in cleanup. Update `runDeployWithDeps` and `runUpdateWithDeps` to call `deps.report("legacy monitor cleanup requires elevation; preserving the legacy service and binary")` and continue only for that error; all other cleanup errors still return immediately.

- [x] **Step 4: Verify the focused Go tests pass**

Run: `go test ./cmd/wheelmaker-deploy -run 'TestCleanupLegacyMonitor|TestUpdate.*LegacyMonitor' -count=1`

Expected: PASS.

### Task 3: Verify the Windows release paths end to end

**Files:**
- Verify only: `scripts/publish_desktop.ps1`
- Verify only: `server/cmd/wheelmaker-deploy`
- Verify only: `server/cmd/wheelmaker-updater`

- [x] **Step 1: Run all directly related automated checks**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test_publish_desktop_ps1.ps1
Push-Location server
go test ./cmd/wheelmaker-deploy ./cmd/wheelmaker-updater ./cmd/wheelmaker-desktop
Pop-Location
```

Expected: all commands pass.

- [x] **Step 2: Run the actual desktop publisher**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/publish_desktop.ps1`

Expected: it writes `~/.wheelmaker/desktop/WheelMakerDesktop.exe`, creates/updates the desktop shortcut, and prints `desktop publish complete`.

- [ ] **Step 3: Commit and push the verified change**

Run:

```powershell
git add -A
git commit -m "fix: unblock Windows publish paths"
git push origin <current-branch>
```

Expected: commit and push succeed.
