# Hub Runtime Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Hub 菜单的版本维护拆成独立的 Update/Restart 动作，并让 Restart 通过 MJS 重启托管 runtime，以便新进程读取服务管理器当前环境变量。

**Architecture:** 前端在同一 Hub 标题行展示版本号、Update 图标和 Restart 图标；两个动作分别进入确认框和 Registry service。后端复用 `hub.state.action` 的 `wheelmakerUpdate` section，新增 `restart` action；Hub 在写回 accepted response 后异步启动 `node <stateDir>/deploy.mjs runtime restart`。MJS 使用 systemd、launchd 或 Windows Scheduled Task 的单一 restart 动作重新创建 guardian 及其 worker。

**Tech Stack:** React 19 + TypeScript + Jest/react-test-renderer；Go Hub/Registry + Go test；Node.js 22 ESM + `node:test`；PowerShell、systemd user service、launchd。

---

## 文件边界

- Modify: `scripts/deploy/deploy.mjs`、`scripts/deploy/deploy-core.mjs`
- Test: `scripts/deploy/deploy.test.mjs`、`scripts/deploy/deploy-core.test.mjs`
- Create: `server/cmd/wheelmaker/runtime_restart.go`
- Modify: `server/cmd/wheelmaker/main.go`、`server/cmd/wheelmaker/main_test.go`
- Modify: `server/internal/hub/hub.go`、`server/internal/hub/reporter.go`、`server/internal/hub/hub_state_adapters.go`、`server/internal/hub/hub_test.go`
- Modify: `server/internal/registry/server.go`、`server/internal/registry/server_test.go`
- Modify: `app/web/src/registry/registryTypes.ts`、`app/web/src/registry/RegistryRepository.ts`、`app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-agent-package-update-service.test.ts`
- Modify: `app/web/src/app/ChatHubMenu.tsx`、`app/web/src/app/WorkspaceApp.tsx`、`app/web/src/styles/chat.css`、`app/web/src/shell/AppDialogs.tsx`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`、`app/web/src/shell/AppDialogs.test.tsx`、`app/__tests__/web-agent-package-update-settings.test.ts`

## Task 1: Add the MJS `runtime restart` command

**Files:**
- Modify: `scripts/deploy/deploy.test.mjs:parseDeployArgs tests`
- Modify: `scripts/deploy/deploy-core.test.mjs:runtime adapter and runCore tests`
- Modify: `scripts/deploy/deploy.mjs:17-22,206-225`
- Modify: `scripts/deploy/deploy-core.mjs:createRuntimeAdapter and runCore runtime dispatch`

- [ ] **Step 1: Write the failing launcher parser test**

Add a `node:test` case asserting:

```js
test('accepts runtime restart without treating it as a deployment command', () => {
  assert.deepEqual(parseDeployArgs(['runtime', 'restart']), ['runtime', 'restart']);
});
```

- [ ] **Step 2: Run the parser test and verify the expected failure**

Run: `node --test scripts/deploy/deploy.test.mjs`

Expected: the new case fails with `unknown deploy command: runtime restart`, while existing parser cases remain green.

- [ ] **Step 3: Write failing platform adapter tests**

Add Linux, macOS, and Windows runner assertions that `createRuntimeAdapter(...).restart()` invokes respectively:

```text
systemctl --user restart wheelmaker-hub.service
launchctl kickstart -k gui/<uid>/com.wheelmaker.hub
the Windows restart PowerShell script that stops and starts WheelMaker
```

Also add a `runCore(['runtime', 'restart'])` test proving the runtime factory's `restart` method is called.

- [ ] **Step 4: Run the adapter tests and verify the expected failure**

Run: `node --test scripts/deploy/deploy-core.test.mjs`

Expected: the new cases fail because the runtime action set and adapter expose only `start` and `stop`.

- [ ] **Step 5: Implement the minimal MJS behavior**

Change the launcher action set to `new Set(['start', 'stop', 'restart'])`, allow the same pair through `runCore`, and add `restart` to `createRuntimeAdapter`:

```js
if (platform === 'linux') {
  return runner('systemctl', ['--user', 'restart', 'wheelmaker-hub.service']);
}
if (platform === 'darwin' && name === 'restart') {
  return runner('launchctl', ['kickstart', '-k', `gui/${paths.uid}/com.wheelmaker.hub`]);
}
```

Windows must use one restart-capable PowerShell operation so the Node helper is not required to continue after the task is stopped. Keep generated `start.bat`/`stop.bat` wrappers unchanged; `restart` remains an internal MJS action.

- [ ] **Step 6: Run MJS tests and preserve existing behavior**

Run: `node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs`

Expected: all parser, runtime adapter, wrapper, update stop/apply/start, and health tests pass.

## Task 2: Add a detached runtime-restart launcher to the Hub worker

**Files:**
- Create: `server/cmd/wheelmaker/runtime_restart.go`
- Modify: `server/cmd/wheelmaker/main.go`
- Test: `server/cmd/wheelmaker/main_test.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/reporter.go`

- [ ] **Step 1: Write failing command-construction and callback-injection tests**

Test that the launcher builds `node <stateDir>/deploy.mjs runtime restart` with the Hub state directory as working directory and starts without waiting for process completion. Extend the Hub/Reporter fixture with an injected restart callback so existing reporters without the callback continue to construct normally.

The callback contract is:

```go
type ReporterConfig struct {
    // existing fields...
    RestartRuntime func() error
}
```

- [ ] **Step 2: Run the Go tests and verify the expected failure**

Run: `go test ./cmd/wheelmaker ./internal/hub`

Expected: compilation/test failure because the launcher, `ReporterConfig` field, and Hub injection point do not exist.

- [ ] **Step 3: Implement the launcher and Hub injection**

Implement `startManagedRuntimeRestart(stateDir string) error` in the new file. It must resolve `<stateDir>/deploy.mjs`, invoke `node` with `runtime restart`, set `cmd.Dir` to `stateDir`, hide the helper window on Windows, redirect stdout/stderr to the existing background sinks, call `Start`, and return without `Wait`.

Add `Hub.SetRestartRuntimeHandler(func() error)` and pass the handler through `setupRegistrySync` into `ReporterConfig`. `runHubWorker` installs the handler before `h.Start(ctx)` using the loaded `baseDir`.

- [ ] **Step 4: Run the focused Go tests and verify green**

Run: `go test ./cmd/wheelmaker ./internal/hub`

Expected: all focused tests pass, including command construction and existing Hub startup tests.

## Task 3: Add and firewall the HubState restart action

**Files:**
- Modify: `server/internal/hub/hub_state_adapters.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing Hub action tests**

Add tests for:

```go
validateHubStateAction("wheelmakerUpdate", "restart") == nil
```

and for a normal Reporter action that returns:

```json
{"ok":true,"accepted":true,"status":"restart_pending","hubId":"hub-a"}
```

The test must observe the response before the injected `RestartRuntime` callback runs; a callback error must be logged/handled without changing an already-written accepted response.

- [ ] **Step 2: Write the failing update-only firewall test**

Add a table case with `hub.state.action`, `section: wheelmakerUpdate`, `action: restart`, and empty params; assert `updateOnlyHubRequestAllowed` returns `false`. Keep the existing `requestUpdate` case `true`.

- [ ] **Step 3: Run the focused tests and verify the expected failure**

Run: `go test ./internal/hub ./internal/registry`

Expected: restart validation fails and the update-only table does not yet exercise the new action.

- [ ] **Step 4: Implement the action and response ordering**

Allow `restart` in `validateHubStateAction`. In `actionHubStateWheelmakerUpdate`, validate that a restart handler exists and return the accepted restart result without calling it inline. In `replyHubStateAction`, write the response first and then schedule the handler asynchronously only for `wheelmakerUpdate/restart`.

Change the update-only exact whitelist to continue accepting only `requestUpdate`; any `restart` payload returns `FORBIDDEN` before routing to the old Hub.

- [ ] **Step 5: Run the focused Go tests and verify green**

Run: `go test ./internal/hub ./internal/registry`

Expected: action ordering, validation, normal routing, and update-only rejection all pass.

## Task 4: Expose Restart through the Web Registry service

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-agent-package-update-service.test.ts`

- [ ] **Step 1: Write the failing request-payload test**

Add a test that calls `requestWheelMakerRestart('hub-a')` and expects one `hub.state.action` request with:

```ts
payload: {
  section: 'wheelmakerUpdate',
  action: 'restart',
  params: {},
}
```

Assert it is distinct from `requestWheelMakerUpdate`, whose action remains `requestUpdate`.

- [ ] **Step 2: Run the focused Web test and verify the expected failure**

Run: `npm test -- --runInBand __tests__/web-agent-package-update-service.test.ts` from `app/`

Expected: TypeScript/test failure because the service and repository methods do not exist.

- [ ] **Step 3: Implement the typed wrapper**

Add `restart_pending` to the local WheelMaker status union if the response status is surfaced by the UI. Implement `RegistryRepository.requestWheelMakerRestart` through `runHubStateAction`, normalize a missing result to the same error shape as the existing update method, and add the guarded `RegistryWorkspaceService` delegate.

- [ ] **Step 4: Run the focused Web tests and typecheck**

Run: `npm test -- --runInBand __tests__/web-agent-package-update-service.test.ts` and `npm run tsc:web` from `app/`.

Expected: focused tests and the Web TypeScript project pass.

## Task 5: Split Update and Restart confirmation flows

**Files:**
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/web/src/shell/AppDialogs.test.tsx`, `app/web/src/app/ChatHubMenu.test.tsx`, and `app/__tests__/web-agent-package-update-settings.test.ts`

- [ ] **Step 1: Write failing dialog tests**

Extend the `wheelMakerUpdate` confirm target with `action: 'update' | 'restart'`. Add a Restart target test asserting:

```text
title: Restart WheelMaker?
primary: Restart
icon: refreshCw
copy: no download/update and runtime reloads its environment
```

Keep the existing Update target assertions unchanged.

- [ ] **Step 2: Run the dialog tests and verify the expected failure**

Run: `npm test -- --runInBand web/src/shell/AppDialogs.test.tsx` from `app/`

Expected: the Restart target cannot compile or still resolves to the Update copy.

- [ ] **Step 3: Implement action-specific targets and handlers**

Add `requestWheelMakerRestart`, `handleChatHubWheelMakerRestart`, and action-aware confirmation dispatch. Use one per-Hub maintenance pending state for Update/Restart so both title-row actions disable together; retain the separate `Update all` pending state. On successful Restart, clear the dialog and keep the pending state until the Hub disconnect/reconnect lifecycle clears it; on failure, preserve the dialog error and do not claim accepted restart.

- [ ] **Step 4: Run dialog, WorkspaceApp, and type tests**

Run: `npm test -- --runInBand web/src/shell/AppDialogs.test.tsx web/src/app/ChatHubMenu.test.tsx` and `npm run tsc:web` from `app/`.

Expected: Update and Restart confirmation behavior is green and existing update-all behavior remains green.

## Task 6: Render the two Hub menu actions

**Files:**
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`

- [ ] **Step 1: Write failing menu tests**

Update the harness and add cases asserting:

```text
update_available normal: version + Update(cloudDownload) + Restart(refreshCw)
up_to_date normal: version + Restart only
local_newer normal: version + Restart only
update_only: Update only
pending: both action buttons disabled and loading state visible
```

Assert each button has an independent accessible name and callback.

- [ ] **Step 2: Run the menu tests and verify the expected failure**

Run: `npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx` from `app/`

Expected: the existing single version button shape fails the new dual-action assertions.

- [ ] **Step 3: Implement independent action view data and layout**

Replace the single `actionLabel/actionVisible/updateAvailable` contract with independent Update/Restart visibility and pending fields. Derive normal/update-only mode from `registryHubs` and require an installed/current version for Restart. Keep Update visibility tied to existing `canRequestUpdate` and status rules.

Render the version as a readout followed by a compact action group. Update keeps the cloud-download icon and update dot; Restart always uses refresh-cw for eligible normal Hub states. Add `onRequestWheelMakerRestart` to `ChatHubMenuProps`. Use the existing fixed action-slot/grid styling so desktop and mobile retain stable row height and accessible icon buttons.

- [ ] **Step 4: Run menu tests, typecheck, and formatting checks**

Run: `npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx` and `npm run tsc:web` from `app/`.

Expected: all menu state/callback assertions and Web typechecking pass; `git diff --check` reports no whitespace errors.

## Task 7: Full verification and handoff

**Files:**
- Test: all modified test files and repository-wide test suites

- [ ] **Step 1: Run focused suites together**

Run:

```text
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs
go test ./cmd/wheelmaker ./internal/hub ./internal/registry
cd app; npm test -- --runInBand __tests__/web-agent-package-update-service.test.ts web/src/app/ChatHubMenu.test.tsx web/src/shell/AppDialogs.test.tsx; npm run tsc:web
```

Expected: all focused tests pass.

- [ ] **Step 2: Run repository-level verification**

Run `go test ./...` from `server/`, then the project-prescribed Web test/build checks from `app/`. Review the generated diff for accidental changes to protocol version, update-only whitelist, or Desktop updater behavior.

- [ ] **Step 3: Rebase before commit**

Run `git fetch origin` and `git rebase origin/main` in the feature worktree. If conflicts have semantic ambiguity, stop and ask; otherwise rerun focused tests after the rebase.

- [ ] **Step 4: Commit and push**

Run:

```text
git add -A
git commit -m "feat: add Hub runtime restart"
git push -u origin feat-hub-runtime-restart
```

The root completion gate also requires the feature branch to be merged into `main` only when the local `main` worktree is clean, followed by pushing `main`; preserve the worktree and branch if merge is deferred by existing changes.
