# MyFlicker Backend Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MyFlicker visibility deterministic by letting each backend-owned data source decide its own availability: project agents for Add, token usage reports for Limits, and an explicit NPM capability for Hub installation/configuration UI.

**Architecture:** The NPM tool will publish `capabilities.myFlicker` and notify the HubState manager when its asynchronous private-registry probe completes, so the committed `agentPackages` section updates without opening Hub UI. The App will hydrate `agentPackages` alongside `tokenStats`, consume the explicit capability for Hub configuration, use `project.agents` unchanged for Add, and render every provider present in the usage snapshot for Limits. No protocol version changes are required because the capability is an additive field in an existing section payload.

**Tech Stack:** Go, React, TypeScript, Jest, Go testing, Registry HubState.

---

### Task 1: Publish and refresh the backend MyFlicker capability

**Files:**
- Modify: `server/internal/hub/tools/npm.go`
- Modify: `server/internal/hub/tools/manager.go`
- Modify: `server/internal/hub/reporter.go`
- Test: `server/internal/hub/tools/npm_myflicker_test.go`
- Test: `server/internal/hub/tools/tools_test.go`
- Test: `server/internal/hub/hub_test.go`

- [x] **Step 1: Write failing NPM capability and async-notification tests**

Add assertions that an unavailable probe yields `Capabilities.MyFlicker == false`, an available probe yields `true` on the next scan, and completing `scan_latest` calls a metadata-change handler exactly once. The callback test must wait on a channel and then scan again, proving the callback runs after the command mutex is released:

```go
changed := make(chan struct{}, 1)
cmd.setMetadataChangedHandler(func() { changed <- struct{}{} })

first := scanNPMTestHub(t, cmd, "hub-a")
if first.Hub.Capabilities.MyFlicker {
	t.Fatal("MyFlicker capability must remain false while the first probe is pending")
}
select {
case <-changed:
case <-time.After(time.Second):
	t.Fatal("scan_latest did not notify the metadata change handler")
}
second := scanNPMTestHub(t, cmd, "hub-a")
if !second.Hub.Capabilities.MyFlicker {
	t.Fatal("MyFlicker capability was not published after a successful probe")
}
```

Add a manager wiring assertion using `ManagerConfig.OnNPMMetadataChanged`, and a reporter test asserting metadata changes enqueue a forced `agentPackages` refresh without calling the agent runtime reload callback.

- [x] **Step 2: Run targeted Go tests and verify RED**

Run:

```powershell
go test ./internal/hub/tools -run "TestNPMCommand.*MyFlicker|TestManager.*NPMMetadata" -count=1
go test ./internal/hub -run "TestReporter.*NPMMetadata" -count=1
```

Expected: FAIL because `npmHubCapabilities`, `setMetadataChangedHandler`, `OnNPMMetadataChanged`, and the reporter callback do not exist.

- [x] **Step 3: Add the capability and dedicated metadata callback**

Define an additive snapshot field and populate it from the scan plan:

```go
type npmHubCapabilities struct {
	MyFlicker bool `json:"myFlicker"`
}

type npmHubSnapshot struct {
	// existing fields
	Capabilities npmHubCapabilities `json:"capabilities"`
}

hub.Capabilities.MyFlicker = plan.flickerAvailable
```

Keep mutation completion separate from metadata refresh by adding `metadataChanged func()` to `NPMCommand`, `setMetadataChangedHandler`, and `ManagerConfig.OnNPMMetadataChanged`. At the end of `runLatestOperation`, capture the handler while locked, unlock explicitly on every completed-operation path, then invoke it outside the mutex:

```go
changed := c.metadataChanged
c.mu.Unlock()
c.notifyMetadataChanged(changed)
```

Wire both manager initialization paths. Add `Reporter.onNPMMetadataChanged`, which only forces `hubStateSectionAgentPackages`; keep `onNPMOperationDone` responsible for runtime reload plus the same refresh. Use these callbacks in both `NewReporter` and `ensureToolHandler`.

- [x] **Step 4: Run targeted Go tests and verify GREEN**

Run:

```powershell
go test ./internal/hub/tools -run "TestNPMCommand.*MyFlicker|TestManager.*NPMMetadata" -count=1
go test ./internal/hub -run "TestReporter.*NPMMetadata" -count=1
```

Expected: PASS; the callback count remains one and no forced-refresh loop occurs.

### Task 2: Hydrate and normalize backend capability in the App

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-agent-package-update-service.test.ts`
- Test: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] **Step 1: Write failing normalization and late-client hydration tests**

Extend the repository response fixture with:

```ts
hub: {
  hubId: 'hub-a',
  capabilities: {myFlicker: true},
  packages: [],
}
```

Assert the normalized result preserves `hub.capabilities.myFlicker`, and assert missing/old-Hub capability data defaults to false. Update the workspace integration expectation so discovery requests both committed sections:

```ts
expect(workspaceService).toContain(
  "get: hubId => this.getHubState(hubId, ['tokenStats', 'agentPackages'])",
);
```

- [x] **Step 2: Run targeted App tests and verify RED**

Run:

```powershell
npm test -- --runInBand app/__tests__/web-agent-package-update-service.test.ts app/__tests__/web-usage-workspace-integration.test.tsx
```

Expected: FAIL because the snapshot type/normalizer lacks `capabilities` and discovery only loads `tokenStats`.

- [x] **Step 3: Add the typed capability and initial HubState hydration**

Add the interface and field:

```ts
export interface RegistryNpmHubCapabilities {
  myFlicker: boolean;
}

export interface RegistryNpmHubSnapshot {
  // existing fields
  capabilities: RegistryNpmHubCapabilities;
  packages: RegistryNpmPackage[];
}
```

Normalize defensively for old Hubs:

```ts
const capabilities = input.capabilities && typeof input.capabilities === 'object'
  ? input.capabilities as Record<string, unknown>
  : {};

return {
  // existing fields
  capabilities: {myFlicker: capabilities.myFlicker === true},
  packages,
};
```

Change `RegistryWorkspaceService` HubStore discovery to request `['tokenStats', 'agentPackages']`, ensuring browsers that connect after Hub bootstrap read the committed capability instead of waiting for a live event.

- [x] **Step 4: Run targeted App tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand app/__tests__/web-agent-package-update-service.test.ts app/__tests__/web-usage-workspace-integration.test.tsx
```

Expected: PASS.

### Task 3: Remove frontend package-name and usage gating

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Modify: `app/web/src/app/ChatHubMenu.test.tsx`
- Delete: `app/web/src/app/myFlickerAvailability.ts`
- Delete: `app/web/src/app/myFlickerAvailability.test.ts`
- Delete: `app/web/src/usage/usageVisibility.ts`
- Delete: `app/web/src/usage/usageVisibility.test.ts`
- Test: `app/__tests__/web-agent-package-update-settings.test.ts`
- Test: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] **Step 1: Write failing UI-source and behavior tests**

Change `ChatHubOpsView.npm` fixtures to carry an explicit boolean independent of package rows:

```ts
npm: {
  loading: false,
  pending: false,
  outdatedCount: 0,
  myFlickerAvailable: true,
  packages: [],
}
```

Assert Flicker Hub configuration appears with `myFlickerAvailable: true` even when `packages` is empty, and remains hidden with `false` even if a package fixture happens to be named `@myflicker/cli`. Add source assertions that `WorkspaceApp.tsx` reads `card.agentPackage?.hub?.capabilities.myFlicker`, does not call `filterMyFlickerAgentTypes`, and does not call `filterUnavailableUsageSnapshot`.

Add an integration source assertion for the backend-report rule:

```ts
expect(usageSnapshot.providers.map(provider => provider.id)).toContain('flicker');
```

The expected behavior is that a reported Flicker provider stays visible regardless of NPM/agent-package state.

- [x] **Step 2: Run targeted App tests and verify RED**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx web/src/usage/usageVisibility.test.ts app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-usage-workspace-integration.test.tsx
```

Expected: FAIL because Hub configuration still infers availability from package names, Add still filters backend agents, and Limits still removes the reported Flicker provider.

- [x] **Step 3: Make each UI consume its authoritative backend list**

Add `myFlickerAvailable: boolean` to `ChatHubOpsView.npm`, populate it with:

```ts
myFlickerAvailable: card.agentPackage?.hub?.capabilities.myFlicker === true,
```

and gate Hub MyFlicker configuration with that boolean. Delete the package-name constant/helper and its import sites.

For Add, remove `myFlickerAvailableByHub` and the `filterMyFlickerAgentTypes(...)` wrapper so `getWideProjectAgents(projectItem)` uses `project.agents` exactly like every other agent.

For Limits, remove `myFlickerAvailable`, `filterUnavailableUsageSnapshot`, and the effect that closes Flicker history when NPM data disappears. Pass the UsageStore snapshot through unchanged:

```ts
const visibleUsageSnapshot = usageSnapshot;
```

Delete `usageVisibility.ts` and its test after removing their only production import. A Flicker provider is now visible precisely when it exists in backend `tokenStats`.

- [x] **Step 4: Run targeted App tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand web/src/app/ChatHubMenu.test.tsx app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-usage-workspace-integration.test.tsx
```

Expected: PASS; no App source references `@myflicker/cli`, `hasMyFlickerPackage`, or `filterMyFlickerAgentTypes`.

### Task 4: Full verification and delivery

**Files:**
- Verify all files changed in Tasks 1-3
- Verify: `docs/scope-nospec/2026-08-03-myflicker-backend-availability/plan-myflicker-backend-availability.md`

- [x] **Step 1: Format changed code**

Run:

```powershell
gofmt -w server/internal/hub/tools/npm.go server/internal/hub/tools/manager.go server/internal/hub/tools/npm_myflicker_test.go server/internal/hub/tools/tools_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
```

Expected: command exits 0.

- [x] **Step 2: Run complete server verification**

Run from `server/`:

```powershell
go test ./...
```

Expected: PASS.

- [x] **Step 3: Run complete App verification**

Run from `app/`:

```powershell
npm test -- --runInBand
npm run typecheck
npm run build
```

If `typecheck` is not a package script, run the repository's declared TypeScript check command from `package.json`. Expected: all commands exit 0.

- [x] **Step 4: Audit requirements and diff**

Run:

```powershell
rg -n --glob '!**/dist/**' "@myflicker/cli|hasMyFlickerPackage|filterMyFlickerAgentTypes|filterUnavailableUsageSnapshot" app/web/src
git status -sb
git diff --check
git diff --stat
```

Expected: the App search has no matches; status contains only this plan and implementation files; diff checks pass. Confirm no protocol version changed.

- [x] **Step 5: Rebase, commit, and push using the repository completion gate**

Run:

```powershell
git fetch origin
git rebase origin/main
git add -A
git commit -m "fix: make MyFlicker availability backend-driven"
git push origin fix/myflicker-backend-capability
```

Expected: rebase succeeds, one task commit is created, and the remote branch is updated. Do not merge into local `main` while its pre-existing user changes remain.
