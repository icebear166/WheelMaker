# Hub Version Topology Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a Hub discovered by a realtime project report participates in Hub version and operation refreshes without requiring the Workspace client to reconnect.

**Architecture:** Add one pure helper that derives operational Hub IDs from the Registry Hub snapshot plus online project reports. Wire the existing `registryHubIds` memo to that helper so the Hub menu refresh effect, WheelMaker version query, NPM scan, Skills scan, and file-index scan all consume the same live topology while offline project-only Hubs remain display-only.

**Tech Stack:** React, TypeScript, Jest.

---

### Task 1: Derive live operational Hub IDs

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Test: `app/__tests__/web-agent-package-update-settings.test.ts`

- [x] **Step 1: Write the failing helper test**

Add a test that imports `deriveOperationalHubIds` and proves a Hub found only through an online project report is included, while an offline project-only Hub is excluded:

```ts
expect(deriveOperationalHubIds(
  [{hubId: 'snapshot-hub'}],
  [
    {projectId: 'reported-hub:Online', hubId: 'reported-hub', online: true},
    {projectId: 'offline-hub:Offline', hubId: 'offline-hub', online: false},
  ],
)).toEqual(['reported-hub', 'snapshot-hub']);
```

- [x] **Step 2: Run the helper test to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts
```

Expected: FAIL because `deriveOperationalHubIds` is not exported.

- [x] **Step 3: Implement the minimal helper**

Add this pure helper next to `deriveRegistryHubIds`:

```ts
export function deriveOperationalHubIds(
  hubs: RegistryHub[],
  projects: Array<Pick<RegistryProject, 'hubId' | 'online'>>,
): string[] {
  const hubIds = new Set(deriveRegistryHubIds(hubs));
  projects.forEach(project => {
    const hubId = (project.hubId || '').trim();
    if (project.online === true && hubId) hubIds.add(hubId);
  });
  return Array.from(hubIds).sort(compareHubIds);
}
```

Reuse a small private `compareHubIds` comparator from `deriveRegistryHubIds` so sorting remains deterministic without duplicating logic.

- [x] **Step 4: Run the helper test to verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts
```

Expected: PASS.

### Task 2: Wire the Hub menu refresh topology

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-agent-package-update-settings.test.ts`

- [x] **Step 1: Write the failing wiring assertion**

Extend the existing Hub operation topology test with:

```ts
expect(mainTsx).toContain(
  'const registryHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));',
);
```

Keep the existing assertions that all operation refreshes consume `registryHubIds`.

- [x] **Step 2: Run the wiring test to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts
```

Expected: FAIL because `WorkspaceApp` still derives operation IDs from `registryHubs` alone.

- [x] **Step 3: Apply the minimal wiring change**

Import `deriveOperationalHubIds` and change the memo key:

```ts
const registryHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));
```

Do not change Registry protocol methods or protocol version.

- [x] **Step 4: Run focused tests and type checking**

Run:

```powershell
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts __tests__/web-chat-ui.test.ts web/src/app/ChatHubMenu.test.tsx
npm run tsc:web
```

Expected: all tests and type checking PASS.

- [x] **Step 5: Run the broader App regression suite**

Run:

```powershell
npm test -- --runInBand
```

Expected: all suites PASS with no new warnings.

- [x] **Step 6: Commit and push**

From the repository root, after rebasing onto the latest `origin/main`, run the required completion tail:

```powershell
git add -A
git commit -m "fix(app): refresh operations for reported hubs"
git push origin main
```
