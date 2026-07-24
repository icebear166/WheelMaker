# Update Restart & NPM Reinstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hub Restart button (reuses the existing update flow) and an NPM Reinstall action (uninstall → install latest), and let every managed package be uninstallable.

**Architecture:** Backend-only change is in `npm.go` (open uninstall to runtime packages + new `reinstall` case). Restart touches **only the frontend** — `update.go` / `deploy-core.mjs` stay untouched because the updater always re-runs the full deploy and restarts. Frontend threads a new `'reinstall'` action through types → registry service → confirm handler → component.

**Tech Stack:** Go (server `internal/hub/tools`), React + TypeScript (app/web), jest + react-test-renderer (frontend tests), Go `testing` (backend tests).

**Spec:** [spec-update-restart-reinstall.md](spec-update-restart-reinstall.md)

**Worktree:** `D:/Code/WheelMaker/.worktree/update-restart-reinstall` (branch `feature/update-restart-reinstall`). All paths below are relative to repo root; run backend commands from `server/` and frontend commands from `app/`. The worktree shares `app/node_modules` via a junction to the main install (already set up if `app/node_modules/.bin/jest` resolves; otherwise run the junction step in Task 4 first).

---

## Task 1: Backend — open uninstall to all packages + `reinstall` case

**Files:**
- Modify: `server/internal/hub/tools/npm.go` (`scan` CanUninstall, `startUninstall`, `Handle` switch, add `startReinstall` + `runReinstallOperation` + `packageUninstallable`)
- Test: `server/internal/hub/tools/tools_test.go` (update 2 existing assertions + add reinstall test)

- [ ] **Step 1: Update the two existing tests that assume runtime packages can't uninstall**

In `server/internal/hub/tools/tools_test.go`, `TestNPMCommandScanReturnsRuntimeAndDeprecatedPackageRows`:

- Around the first codex assertion (the "before latest" block), change:
```go
	if codex.CanInstall || codex.CanUpdate || codex.CanUninstall {
		t.Fatalf("codex action flags should be disabled while latest is checking: %#v", codex)
	}
```
to (codex is installed, so it can now be uninstalled even while latest is still checking):
```go
	if codex.CanInstall || codex.CanUpdate {
		t.Fatalf("codex install/update flags should be disabled while latest is checking: %#v", codex)
	}
	if !codex.CanUninstall {
		t.Fatalf("installed runtime codex should be uninstallable: %#v", codex)
	}
```

- Around the second codex assertion, change:
```go
	if !codex.CanUpdate || codex.CanUninstall {
		t.Fatalf("codex action flags=%#v", codex)
	}
```
to:
```go
	if !codex.CanUpdate || !codex.CanUninstall {
		t.Fatalf("codex action flags=%#v, want CanUpdate and CanUninstall", codex)
	}
```

- [ ] **Step 2: Add the reinstall test**

Append to `server/internal/hub/tools/tools_test.go`:

```go
func TestNPMCommandReinstallUninstallsThenInstallsLatest(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "reinstall",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if cmdErr != nil {
		t.Fatalf("reinstall error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.Accepted || body.Operation == nil || body.Operation.Action != "reinstall" || body.Operation.PackageName != "@openai/codex" {
		t.Fatalf("reinstall response=%#v", body)
	}

	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded reinstall", operation)
	}
	if !runner.hasCall("npm", "uninstall", "-g", "@openai/codex") {
		t.Fatalf("reinstall uninstall call not found: %#v", runner.calls)
	}
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("reinstall install call not found: %#v", runner.calls)
	}
}

func TestNPMCommandUninstallAcceptsRuntimePackages(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "uninstall",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if cmdErr != nil {
		t.Fatalf("runtime uninstall error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if body.Operation == nil || body.Operation.Action != "uninstall" {
		t.Fatalf("runtime uninstall response=%#v", body)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "uninstall", "-g", "@openai/codex") {
		t.Fatalf("runtime uninstall call not found: %#v", runner.calls)
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && go test ./internal/hub/tools/ -run 'TestNPMCommandReinstall|TestNPMCommandUninstallAcceptsRuntime|TestNPMCommandScanReturnsRuntimeAndDeprecated' -v`
Expected: FAIL — `reinstall` action unsupported; runtime uninstall forbidden; codex `CanUninstall` still false.

- [ ] **Step 4: Mark runtime installed packages uninstallable in `scan`**

In `server/internal/hub/tools/npm.go`, inside `scan`'s runtime loop, change the row initializer (the `CanUninstall: false,` line):

```go
		row := npmPackageStatus{
			PackageName:      policy.PackageName,
			DisplayName:      policy.DisplayName,
			AgentTypes:       cloneNPMStringSlice(policy.AgentTypes),
			Kind:             policy.Kind,
			Installed:        installedVersion != "",
			InstalledVersion: installedVersion,
			CanUninstall:     installedVersion != "",
		}
```

- [ ] **Step 5: Add the `packageUninstallable` helper**

In `server/internal/hub/tools/npm.go`, right after `deprecatedPackageAllowed`:

```go
func packageUninstallable(packageName string) bool {
	return runtimePackageAllowed(packageName) || deprecatedPackageAllowed(packageName)
}
```

- [ ] **Step 6: Open `startUninstall` to all managed packages**

In `server/internal/hub/tools/npm.go` `startUninstall`, replace the `deprecatedPackageAllowed` guard:

```go
func (c *NPMCommand) startUninstall(payload npmCommandPayload) (any, *npmCommandError) {
	if payload.PackageName == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageName is required"}
	}
	if !packageUninstallable(payload.PackageName) {
		return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not uninstallable"}
	}
	operation, cmdErr := c.acceptOperation("uninstall", payload.PackageName, "", nil)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runCommandOperation(operation, "npm", "uninstall", "-g", payload.PackageName)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}
```

- [ ] **Step 7: Add the `reinstall` case to `Handle`**

In `server/internal/hub/tools/npm.go` `Handle`'s switch, add the `reinstall` case:

```go
	switch payload.Action {
	case "scan":
		return c.scan(ctx, payload.HubID), nil
	case "install":
		return c.startInstall(payload)
	case "install_many":
		return c.startInstallMany(payload)
	case "uninstall":
		return c.startUninstall(payload)
	case "reinstall":
		return c.startReinstall(payload)
	default:
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.npm action"}
	}
```

- [ ] **Step 8: Implement `startReinstall` + `runReinstallOperation`**

Append to `server/internal/hub/tools/npm.go` (after `startUninstall`):

```go
func (c *NPMCommand) startReinstall(payload npmCommandPayload) (any, *npmCommandError) {
	if payload.PackageName == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageName is required"}
	}
	if !packageUninstallable(payload.PackageName) {
		return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not reinstallable"}
	}
	operation, cmdErr := c.acceptOperation("reinstall", payload.PackageName, "latest", nil)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runReinstallOperation(operation, payload.PackageName)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}

func (c *NPMCommand) runReinstallOperation(operation *npmOperationSnapshot, packageName string) {
	uninstallResult := c.runner.Run(context.Background(), "npm", "uninstall", "-g", packageName)
	if commandFailed(uninstallResult) {
		exitCode := uninstallResult.ExitCode
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.operation != operation {
			return
		}
		operation.Running = false
		operation.FinishedAt = c.now().Format(time.RFC3339)
		operation.ExitCode = &exitCode
		operation.Status = "failed"
		operation.ErrorSummary = formatNPMTaskErrorSummary(uninstallResult.ExitCode, uninstallResult.Stdout, uninstallResult.Stderr, uninstallResult.Err)
		return
	}
	installResult := c.runner.Run(context.Background(), "npm", "install", "-g", packageName+"@latest")
	exitCode := installResult.ExitCode
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation != operation {
		return
	}
	operation.Running = false
	operation.FinishedAt = c.now().Format(time.RFC3339)
	operation.ExitCode = &exitCode
	if commandFailed(installResult) {
		operation.Status = "failed"
		operation.ErrorSummary = formatNPMTaskErrorSummary(installResult.ExitCode, installResult.Stdout, installResult.Stderr, installResult.Err)
		return
	}
	operation.Status = "succeeded"
	operation.Message = c.installSuccessMessage(packageName, "latest")
}
```

- [ ] **Step 9: Run the full tools package tests**

Run: `cd server && go test ./internal/hub/tools/ -v`
Expected: PASS (existing tests with updated assertions + 2 new tests). If `TestNPMCommandAcceptsRuntimeInstallAndDeprecatedUninstall` still passes as-is, fine — it only installs runtime + uninstalls deprecated, both still valid.

- [ ] **Step 10: Commit**

```bash
cd server && git add internal/hub/tools/npm.go internal/hub/tools/tools_test.go
git commit -m "feat(server): open npm uninstall to all packages and add reinstall action"
```

---

## Task 2: Frontend types + registry service for `reinstall`

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts` (`RegistryNpmOperation.action`)
- Modify: `app/web/src/registry/RegistryRepository.ts` (add `reinstallNpmPackage`)
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts` (add `reinstallNpmPackage`)

- [ ] **Step 1: Extend the npm operation action union**

In `app/web/src/registry/registryTypes.ts`, change the `RegistryNpmOperation.action` field (line ~592):

```ts
  action: 'scan_latest' | 'install' | 'install_many' | 'uninstall' | 'reinstall' | string;
```

- [ ] **Step 2: Add `reinstallNpmPackage` to the repository**

In `app/web/src/registry/RegistryRepository.ts`, right after `uninstallNpmPackage` (line ~1814):

```ts
  async reinstallNpmPackage(hubId: string, packageName: string): Promise<RegistryNpmCommandResponse> {
    const state = await this.runHubStateAction(hubId, 'agentPackages', 'reinstall', {packageName});
    return normalizeNpmCommandResponse(hubStateSectionData(state, 'agentPackages'), hubId);
  }
```

- [ ] **Step 3: Add `reinstallNpmPackage` to the workspace service**

In `app/web/src/registry/RegistryWorkspaceService.ts`, right after `uninstallNpmPackage` (find it next to the other npm methods ~line 800):

```ts
  async reinstallNpmPackage(hubId: string, packageName: string): Promise<RegistryNpmCommandResponse> {
    return this.repository.reinstallNpmPackage(hubId, packageName);
  }
```

- [ ] **Step 4: Type-check**

Run: `cd app && npx tsc -p web/tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts
git commit -m "feat(app): add reinstall npm package registry method"
```

---

## Task 3: Frontend confirm flow + labels for `reinstall`

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx` (`requestAgentPackageAction` type, `agentPackageActionLabel`, confirm executor ~line 13574)
- Modify: `app/web/src/shell/AppDialogs.tsx` (confirm target action type, `agentPackageActionLabel`)
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx` (`PackageAction` type)

- [ ] **Step 1: Widen the `PackageAction` type in the component**

In `app/web/src/settings/UpdateSettingsDetail.tsx`, change:

```ts
type PackageAction = 'install' | 'update' | 'uninstall';
```
to:
```ts
type PackageAction = 'install' | 'update' | 'uninstall' | 'reinstall';
```

- [ ] **Step 2: Widen `requestAgentPackageAction` in `WorkspaceApp.tsx`**

In `app/web/src/app/WorkspaceApp.tsx` (line ~13331), change the action parameter type:

```ts
  const requestAgentPackageAction = useCallback((
    action: 'install' | 'update' | 'uninstall' | 'reinstall',
    hubId: string,
    pkg: RegistryNpmPackage,
  ) => {
```

- [ ] **Step 3: Extend `agentPackageActionLabel` in `WorkspaceApp.tsx`**

In `app/web/src/app/WorkspaceApp.tsx` (line ~1182):

```ts
function agentPackageActionLabel(action: 'install' | 'update' | 'uninstall' | 'reinstall'): string {
  switch (action) {
    case 'update':
      return 'Update';
    case 'uninstall':
      return 'Uninstall';
    case 'reinstall':
      return 'Reinstall';
    default:
      return 'Install';
  }
}
```

- [ ] **Step 4: Route `reinstall` through the confirm executor in `WorkspaceApp.tsx`**

Find the confirm executor that currently does (line ~13574):

```ts
        ? await service.uninstallNpmPackage(target.hubId, target.packageName)
        : await service.installNpmPackage(target.hubId, target.packageName, 'latest');
```

Replace the whole `npmPackage` branch with explicit action handling (read the surrounding `if/else` so the first line matches your file; the structure is `target.action === 'uninstall' ? uninstall : install`):

```ts
    switch (target.action) {
      case 'reinstall':
        await service.reinstallNpmPackage(target.hubId, target.packageName);
        break;
      case 'uninstall':
        await service.uninstallNpmPackage(target.hubId, target.packageName);
        break;
      default:
        await service.installNpmPackage(target.hubId, target.packageName, 'latest');
    }
```

- [ ] **Step 5: Widen the confirm target action type + label in `AppDialogs.tsx`**

In `app/web/src/shell/AppDialogs.tsx`:

- Line ~44, the confirm target action field:
```ts
      action: 'install' | 'update' | 'uninstall' | 'reinstall';
```

- Line ~142, the local `agentPackageActionLabel`:
```ts
function agentPackageActionLabel(action: 'install' | 'update' | 'uninstall' | 'reinstall'): string {
  switch (action) {
    case 'update':
      return 'Update';
    case 'uninstall':
      return 'Uninstall';
    case 'reinstall':
      return 'Reinstall';
    default:
      return 'Install';
  }
}
```

- [ ] **Step 6: Type-check**

Run: `cd app && npx tsc -p web/tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/web/src/app/WorkspaceApp.tsx app/web/src/shell/AppDialogs.tsx app/web/src/settings/UpdateSettingsDetail.tsx
git commit -m "feat(app): route npm reinstall action through confirm flow"
```

---

## Task 4: Frontend component — hub Restart + npm Reinstall button

**Files:**
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx` (hub row Restart, npm row reinstall button, `hubStatusLabel`)
- Modify: `app/web/src/settings/UpdateSettingsDetail.test.tsx` (add 3 assertions)
- Modify: `app/web/src/styles/settings.css` (reinstall button style — optional reuse)

- [ ] **Step 0 (only if needed): ensure worktree has `app/node_modules`**

If `test -d app/node_modules/.bin/jest` fails in the worktree, create the junction (Windows):
```
powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'D:\Code\WheelMaker\.worktree\update-restart-reinstall\app\node_modules' -Target 'D:\Code\WheelMaker\app\node_modules' | Out-Null"
```

- [ ] **Step 1: Write the failing tests**

In `app/web/src/settings/UpdateSettingsDetail.test.tsx`, append:

```tsx
test('hub card shows Restart when already up to date', async () => {
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      wheelMakerPublicMetadata: {stable, publishStatus: null},
      updateHubCards: [hubCard('hub-1', {
        wheelMaker: {hubId: 'hub-1', loading: false, error: '', data: {
          ok: true, status: 'up_to_date', hubId: 'hub-1', canRequestUpdate: true,
          installed: {schemaVersion: 2, version: 'v1.9', publishedAt: '2026-07-20T00:00:00Z', sourceSha: 'b'.repeat(40), manifestSha256: 'c'.repeat(64), installedAt: '2026-07-20T00:00:00Z'},
        }},
      })],
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('Restart');
  expect(json).not.toContain('Update Hub');
});

test('installed npm package shows reinstall and uninstall icon buttons', async () => {
  const packages = [
    {packageName: 'cur', displayName: 'Cur', agentTypes: [], kind: 'runtime', installed: true, installedVersion: '2.0.0', latestVersion: '2.0.0', status: 'up_to_date', error: '', canInstall: false, canUpdate: false, canUninstall: true},
  ];
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        agentPackage: {hubId: 'hub-1', loading: false, error: '', updatedAt: '', hub: {hubId: 'hub-1', nodeVersion: '', npmVersion: '', npmPrefix: '', warning: '', error: '', packages}, operation: null},
      })],
      expandedNpmUpdateHubIds: {'hub-1': true},
      agentPackageActionForPackage: pkg => (pkg.canInstall ? 'install' : pkg.canUpdate ? 'update' : pkg.canUninstall ? 'uninstall' : null),
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).toContain('codicon-sync');
  expect(json).toContain('codicon-trash');
});

test('not-installed npm package has no reinstall or uninstall button', async () => {
  const packages = [
    {packageName: 'fresh', displayName: 'Fresh', agentTypes: [], kind: 'runtime', installed: false, installedVersion: '', latestVersion: '1.0.0', status: 'not_installed', error: '', canInstall: true, canUpdate: false, canUninstall: false},
  ];
  let tree;
  await act(async () => {
    tree = create(<UpdateSettingsDetail {...baseProps({
      updateHubCards: [hubCard('hub-1', {
        agentPackage: {hubId: 'hub-1', loading: false, error: '', updatedAt: '', hub: {hubId: 'hub-1', nodeVersion: '', npmVersion: '', npmPrefix: '', warning: '', error: '', packages}, operation: null},
      })],
      expandedNpmUpdateHubIds: {'hub-1': true},
    })} />);
  });
  const json = JSON.stringify(tree!.toJSON());
  expect(json).not.toContain('codicon-sync');
  expect(json).not.toContain('codicon-trash');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx jest web/src/settings/UpdateSettingsDetail.test.tsx`
Expected: FAIL — no Restart label; no reinstall button.

- [ ] **Step 3: Let the hub row show Restart when up to date**

In `app/web/src/settings/UpdateSettingsDetail.tsx`:

(a) Widen the `canRequestUpdate` derivation inside the hub card (the `wheelMakerViewData` block) so `up_to_date` / `local_newer` also show a button:

```ts
          const wheelMakerViewData = wheelMakerData ? {
            ...wheelMakerData,
            status: wheelMakerStatus,
            canRequestUpdate: wheelMakerData.canRequestUpdate === true &&
              (wheelMakerStatus === 'update_available' || wheelMakerStatus === 'up_to_date' || wheelMakerStatus === 'local_newer'),
          } : null;
```

(b) Extend `hubStatusLabel` (the helper near the top of the file) to accept a `restart` flag:

```ts
function hubStatusLabel(
  pending: boolean,
  jobActive: boolean,
  jobFailed: boolean,
  statusFailed: boolean,
  restart: boolean,
  jobState: string,
): string {
  if (pending) return 'Requesting...';
  if (jobActive) return wheelMakerUpdateStatusLabel(jobState);
  if (jobFailed || statusFailed) return 'Retry';
  if (restart) return 'Restart';
  return 'Update Hub';
}
```

(c) Update the call site inside the hub Update button to pass `restart`:

```ts
                    {hubStatusLabel(
                      wheelMakerPending,
                      wheelMakerJobActive,
                      wheelMakerJobFailed,
                      wheelMakerStatus === 'checking_failed',
                      wheelMakerStatus === 'up_to_date' || wheelMakerStatus === 'local_newer',
                      wheelMakerData?.job?.state || '',
                    )}
```

- [ ] **Step 4: Add the Reinstall icon button to each installed npm package**

In `app/web/src/settings/UpdateSettingsDetail.tsx`, inside the package row's `agent-package-action-line` div, add a reinstall button right before the existing uninstall (`codicon-trash`) button. The block currently has the uninstall button guarded by `pkg.canUninstall`; insert the reinstall button (guarded by `pkg.installed`) before it:

```tsx
                            <div className="agent-package-action-line">
                              {action === 'update' ? (
                                <span className="agent-package-version-line">
                                  <span>{pkg.installedVersion || '-'}</span>
                                  <span className="agent-package-version-arrow" aria-hidden="true">→</span>
                                  <span>{pkg.latestVersion || '-'}</span>
                                </span>
                              ) : action === 'uninstall' ? (
                                <span className="agent-package-idle">Up to date</span>
                              ) : null}
                              {action === 'update' ? (
                                <button type="button" className="agent-package-action-btn" disabled={pending}
                                  onClick={() => requestAgentPackageAction('update', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('update')}
                                </button>
                              ) : null}
                              {action === 'install' ? (
                                <button type="button" className="agent-package-action-btn" disabled={pending}
                                  onClick={() => requestAgentPackageAction('install', card.hubId, pkg)}>
                                  {pending ? 'Running...' : agentPackageActionLabel('install')}
                                </button>
                              ) : null}
                              {pkg.installed ? (
                                <button type="button" className="agent-package-action-btn npm-row-reinstall-btn" disabled={pending}
                                  title={agentPackageActionLabel('reinstall')}
                                  aria-label={agentPackageActionLabel('reinstall')}
                                  onClick={() => requestAgentPackageAction('reinstall', card.hubId, pkg)}>
                                  <span className="codicon codicon-sync" aria-hidden="true" />
                                </button>
                              ) : null}
                              {pkg.canUninstall ? (
                                <button type="button" className="agent-package-action-btn npm-row-uninstall-btn" disabled={pending}
                                  title={agentPackageActionLabel('uninstall')}
                                  aria-label={agentPackageActionLabel('uninstall')}
                                  onClick={() => requestAgentPackageAction('uninstall', card.hubId, pkg)}>
                                  <span className="codicon codicon-trash" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
```

- [ ] **Step 5: Add the reinstall button style**

In `app/web/src/styles/settings.css`, next to `.npm-row-uninstall-btn`:

```css
.npm-row-reinstall-btn {
  min-width: 0;
  padding: 0 8px;
  color: var(--text-secondary);
}

.npm-row-reinstall-btn:hover:not(:disabled) {
  color: var(--accent-primary);
}
```

- [ ] **Step 6: Run the component tests to verify they pass**

Run: `cd app && npx jest web/src/settings/UpdateSettingsDetail.test.tsx`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 7: Commit**

```bash
git add app/web/src/settings/UpdateSettingsDetail.tsx app/web/src/settings/UpdateSettingsDetail.test.tsx app/web/src/styles/settings.css
git commit -m "feat(app): add hub restart button and npm reinstall action"
```

---

## Task 5: Full verification

- [ ] **Step 1: Backend tests**

Run: `cd server && go test ./internal/hub/tools/`
Expected: PASS.

- [ ] **Step 2: Frontend tests + type-check + build**

Run:
```
cd app && npx jest web/src/settings && npx tsc -p web/tsconfig.web.json --noEmit && npm run build:web
```
Expected: tests PASS, no type errors, build succeeds (output to `~/.wheelmaker/web`).

- [ ] **Step 3: Re-check spec coverage**

Confirm against [spec-update-restart-reinstall.md](spec-update-restart-reinstall.md): hub Restart on up_to_date (Task 4), all packages uninstallable (Task 1), reinstall = uninstall→install (Task 1), npm operation matrix (Task 4), no backend update.go change (verified — Task 1 only touches npm.go).

- [ ] **Step 4: Final commit if any stray fixups remain**

Only if steps 1–2 surfaced uncommitted fixes:
```bash
git add -A && git commit -m "test: finalize restart + reinstall verification"
```

---

## Self-review

**1. Spec coverage** — every spec decision maps to a task: Restart = pure frontend reuse of `requestWheelMakerUpdate` (Task 4 hub row, no backend change ✓); open all packages to uninstall (Task 1 ✓); reinstall = uninstall→install latest (Task 1 ✓); npm matrix reinstall+uninstall on installed packages (Task 4 ✓); `RegistryNpmOperation.action` + `PackageAction` add `reinstall` (Tasks 2–3 ✓); no `update.go` / `deploy-core.mjs` change (✓); no protocol version bump (only action enum extension ✓).

**2. Placeholder scan** — every code step shows the actual code; no TBD / "add error handling" / "similar to". The one imperative ("read the surrounding if/else") in Task 3 Step 4 is anchored to a concrete line and shows the replacement. ✓

**3. Type consistency** — `'reinstall'` is added to the action union in `registryTypes.ts`, `PackageAction`, `requestAgentPackageAction`, both `agentPackageActionLabel`s, and the confirm target action type — all consistent. `hubStatusLabel` signature change (added `restart` param) matches its single call site. `reinstallNpmPackage(hubId, packageName)` signature matches across repository, service, and the confirm executor. ✓

No spec gaps remain.
