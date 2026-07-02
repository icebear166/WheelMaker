# Windows HKCU Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Windows as-user startup registration with HKCU Run entries while requiring old Windows Services and Scheduled Tasks to be fully cleaned before install continues.

**Architecture:** Keep the existing deploy pipeline and `PrepareInstall(ctx, includeUpdater)` boundary. Windows `asuser` runtime will use HKCU Run for login startup and direct process control for start/stop/status; old service/task cleanup remains in `PrepareInstall` and becomes a hard gate. `deploy` includes updater cleanup/configuration, while updater-driven `update/bootstrap-update` continues to exclude updater.

**Tech Stack:** Go, PowerShell, Windows Registry HKCU Run, existing `server/cmd/wheelmaker-deploy` tests.

---

### Task 1: Lock Windows Runtime Semantics With Tests

**Files:**
- Modify: `server/cmd/wheelmaker-deploy/service_windows_test.go`

- [ ] **Step 1: Replace as-user task configuration expectations with HKCU expectations**

Add assertions that `Configure` writes `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` values for `WheelMaker`, `WheelMakerMonitor`, and `WheelMakerUpdater`, and does not call `Register-ScheduledTask`.

- [ ] **Step 2: Add hard cleanup gate test**

Add a test runner that fails when cleanup script attempts to unregister/delete an old registration and assert `PrepareInstall` returns an error instead of swallowing it.

- [ ] **Step 3: Add process start expectations for update path**

Assert `Start(ctx, false)` starts only `wheelmaker.exe -d` and `wheelmaker-monitor.exe`, not `wheelmaker-updater.exe`.

- [ ] **Step 4: Run RED verification**

Run: `go test ./cmd/wheelmaker-deploy -run "WindowsAsUser|WindowsPrepareInstall"`.
Expected: FAIL because production code still uses scheduled tasks and soft cleanup.

### Task 2: Implement Windows HKCU Runtime

**Files:**
- Modify: `server/cmd/wheelmaker-deploy/service_windows.go`

- [ ] **Step 1: Make cleanup strict**

Change Windows cleanup script so failed `Unregister-ScheduledTask`, service deletion, or selected process stop returns a clear error.

- [ ] **Step 2: Configure HKCU Run**

Replace `configureScheduledTasks` as the as-user `Configure` backend with a function that writes HKCU Run values using each runtime program command line.

- [ ] **Step 3: Start/stop/status via processes**

Replace as-user `Start`, `Stop`, and `Status` scheduled-task calls with direct `Start-Process`, process stop, and process status commands.

- [ ] **Step 4: Run GREEN verification**

Run: `go test ./cmd/wheelmaker-deploy -run "WindowsAsUser|WindowsPrepareInstall"`.
Expected: PASS.

### Task 3: Sweep Tests and Commit

**Files:**
- Modify as needed: `README.md`
- Modify as needed: `docs/superpowers/specs/2026-05-30-wheelmaker-deploy-cli-design.md`

- [ ] **Step 1: Run package tests**

Run: `go test ./cmd/wheelmaker-deploy`.
Expected: PASS.

- [ ] **Step 2: Run related updater tests**

Run: `go test ./cmd/wheelmaker-updater`.
Expected: PASS.

- [ ] **Step 3: Apply repository completion gate**

Run:
`git add -A`
`git commit -m "Use HKCU for Windows as-user runtime"`
`git push origin <branch>`
