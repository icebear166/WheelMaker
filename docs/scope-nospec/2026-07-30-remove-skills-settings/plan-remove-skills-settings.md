# Remove Standalone Skills Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the transitional standalone Skills settings page while preserving complete Hub-global and Project-scoped Skills management in the Hub menu.

**Architecture:** Settings navigation will stop exposing `skills` and `skillDetail`; Hub skill management remains the only presentation owner. Shared skill commands, polling, retry state, install content, detail content, and Hub desktop/mobile companion surfaces remain in place. Settings-only cross-Hub scanning, combined Hub+Project updates, offline-project presentation, grouping, and styling are deleted.

**Tech Stack:** React, TypeScript, Jest, Testing Library, CSS, Markdown wiki.

---

### Task 1: Lock the removal boundary with failing tests

**Files:**
- Modify: `app/__tests__/web-skill-management-settings.test.ts`
- Modify: `app/__tests__/web-settings-navigation.test.ts`
- Modify: `app/__tests__/web-mobile-settings-system-back.test.ts`

- [x] **Step 1: Replace standalone-page assertions with absence assertions**

Update the source-structure test to require removal of the obsolete page and retention of the Hub implementation:

```ts
test('removes standalone Skills settings while preserving Hub skill management', () => {
  expect(fs.existsSync(path.join(root, 'web/src/settings/SkillsSettingsDetail.tsx'))).toBe(false);
  expect(settingsSurfaceTsx).not.toContain("detail: 'skills'");
  expect(mainTsx).not.toContain('renderSkillsSettingsDetail');
  expect(mainTsx).not.toContain('refreshSkillManagement(registryHubIds)');
  expect(mainTsx).toContain('<ChatHubMenu');
  expect(mainTsx).toContain('onRequestSkillInstall={requestSkillInstall}');
  expect(mainTsx).toContain('onRequestSkillDetail={requestSkillDetail}');
});
```

Keep and tighten the existing assertions that prove:

```ts
expect(summaryBlock).not.toContain('includeProjects: true');
expect(mainTsx).toContain('refreshSkillManagementHubRef.current?.(hubId)');
expect(mainTsx).toContain('service.installSkills');
expect(mainTsx).toContain('service.getSkillDetail');
expect(mainTsx).toContain('service.updateSkills');
expect(mainTsx).toContain('service.uninstallSkills');
```

- [x] **Step 2: Update Settings navigation expectations**

Require Port Relay to be the only peer page and remove the Settings-owned skill detail child:

```ts
expect(SETTINGS_PEER_DETAILS).toEqual(['portRelay']);
expect(SETTINGS_CHILD_DETAILS).toEqual([
  'connectionStatus',
  'database',
  'debugLogs',
  'deviceSessions',
]);
expect(mobileSettingsShortcutIndex('portRelay')).toBe(1);
expect(MOBILE_SETTINGS_SHORTCUTS.map(shortcut => shortcut.detail))
  .toEqual(['portRelay']);
```

- [x] **Step 3: Remove Skills-specific Settings history cases**

Replace Skills peer/child history cases with Port Relay and normal Settings child pages:

```ts
expect(mobileSettingsHistoryKey('portRelay')).toBe('mobile-settings:portRelay');
expect(resolveMobileSettingsHistoryWriteAction({
  currentKey: mobileSettingsHistoryKey(null),
  nextDetail: 'portRelay',
})).toBe('push');
```

Keep the separate Hub companion Android-back assertions unchanged.

- [x] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-skill-management-settings.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-settings-system-back.test.ts
```

Expected: FAIL because `SkillsSettingsDetail.tsx`, the Skills Settings shortcut/routes, and Settings-owned skill detail still exist.

### Task 2: Remove the standalone Settings presentation and state ownership

**Files:**
- Delete: `app/web/src/settings/SkillsSettingsDetail.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/web/src/settings/settingsNavigation.ts`
- Modify: `app/web/src/settings/SettingsSurface.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/settings/skillManagementView.ts`

- [x] **Step 1: Remove Settings navigation entries**

Change Settings peers and children to:

```ts
export type SettingsPeerDetail = 'portRelay';

export type SettingsChildDetail =
  | 'connectionStatus'
  | 'database'
  | 'debugLogs'
  | 'deviceSessions';

export const SETTINGS_PEER_DETAILS: readonly SettingsPeerDetail[] = [
  'portRelay',
];
```

Set the Port Relay shortcut index to `1`, remove Skills from `MOBILE_SETTINGS_SHORTCUTS`, and delete the Skills/skill-detail title cases.

- [x] **Step 2: Delete the obsolete Settings component export**

Delete `SkillsSettingsDetail.tsx` and remove:

```ts
export { SkillDetailPanel, SkillsSettingsDetail } from './SkillsSettingsDetail';
```

from `SettingsBundle.ts`.

- [x] **Step 3: Remove Settings-only cross-Hub scanning**

From `WorkspaceApp.tsx`, remove:

```ts
const [skillsLoading, setSkillsLoading] = useState(false);
const [skillsError, setSkillsError] = useState('');
```

Delete `refreshSkillManagement(hubIds)`, the effect triggered by `settingsDetailView === 'skills'`, and the Skills branch in `renderSettingsDetailActions`.

Keep:

```ts
const [skillHubs, setSkillHubs] = useState<Record<string, SkillHubView>>({});
const refreshSkillManagementHubRef = useRef<...>(null);
refreshSkillManagementHubRef.current = refreshSkillManagementHub;
```

because the Hub menu uses per-Hub scan results and refreshes.

- [x] **Step 4: Make skill install/detail ownership Hub-only**

Remove the `SkillSurfaceOwner` type and `skillInstallOwner` / `skillDetailOwner` state. Derive `chatHubSkillSurface` directly from `skillInstallTarget` or `skillDetailTarget`:

```ts
const chatHubSkillSurface = useMemo<ChatHubSkillSurface | null>(() => {
  if (skillInstallTarget) {
    return {kind: 'install', target: skillInstallTarget};
  }
  if (skillDetailTarget) {
    return {kind: 'detail', target: skillDetailTarget};
  }
  return null;
}, [skillDetailTarget, skillInstallTarget]);
```

Remove owner parameters and Settings mobile routing from `requestSkillInstall`, `requestSkillDetail`, `closeSkillDetail`, and all Hub call sites:

```tsx
onRequestSkillInstall={requestSkillInstall}
onRequestSkillDetail={requestSkillDetail}
```

Keep cache loading, confirmation, polling, retry, install, update, uninstall, and batch-uninstall behavior unchanged.

- [x] **Step 5: Remove Settings render branches**

Delete the lazy imports and render helpers for `SkillsSettingsDetail` and `SkillDetailPanel`, remove `skills` / `skillDetail` branches from `renderSettingsDetailContent`, remove special Skills title handling, and remove `desktopSkillDetailPanel`.

The Hub must continue rendering:

```tsx
<ChatHubMenu ... />
<ChatHubSkillCompanion ... />
```

with the existing desktop companion and mobile child surface.

- [x] **Step 6: Remove standalone-only view helpers**

Delete `groupSkillsByCategory`, `skillOperationStatusLabel`, and their supporting exported types if no remaining callers exist. Keep scope sorting, cache keys, target equality, pending keys, labels, and parsing helpers used by Hub or shared content.

- [x] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-skill-management-settings.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-settings-system-back.test.ts web/src/app/ChatHubSkillManagement.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx
```

Expected: PASS.

### Task 3: Remove obsolete CSS without breaking shared Hub content

**Files:**
- Modify: `app/web/src/styles/settings.css`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`

- [x] **Step 1: Add CSS boundary assertions**

Require standalone selectors to be absent:

```ts
expect(stylesCss).not.toContain('.settings-skills-page');
expect(stylesCss).not.toContain('.settings-skills-hub-picker');
expect(stylesCss).not.toContain('.settings-skills-scope-grid');
expect(stylesCss).not.toContain('.settings-skills-detail-panel');
```

Require shared Hub install/detail selectors to remain:

```ts
expect(stylesCss).toContain('.skill-install-marketplace');
expect(stylesCss).toContain('.settings-skills-source-row');
expect(stylesCss).toContain('.settings-skills-detail-body');
expect(stylesCss).toContain('.skill-detail-markdown');
```

- [x] **Step 2: Run the source-structure test and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-skill-management-settings.test.ts
```

Expected: FAIL because obsolete standalone selectors remain.

- [x] **Step 3: Delete standalone-only CSS**

Remove selectors for the deleted page, including page/list/fixed controls, Hub picker/menu/options, scan status, standalone Hub/scope/project layout, category/bulk presentation, and Settings-owned detail panel shell.

Keep styles referenced by `SkillManagementContent.tsx` and `ChatHubSkillCompanion.tsx`, including install source/candidates and shared detail body/meta/file/markdown styles.

- [x] **Step 4: Run the source-structure and component tests**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-skill-management-settings.test.ts web/src/settings/SkillManagementContent.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx
```

Expected: PASS.

### Task 4: Record the final ownership model and complete regression

**Files:**
- Modify: `docs/wiki/frontend-interaction/hub-menu.md`
- Modify: `docs/scope-nospec/2026-07-30-remove-skills-settings/plan-remove-skills-settings.md`

- [x] **Step 1: Update the existing Hub menu wiki**

Replace the transitional migration statement with stable ownership:

```md
- Hub menu is the only Skills management entry.
- Hub-global Skills remain under each Hub's Global row.
- Project Skills remain under the Projects row and selected project.
- Hub Update all never includes Project Skills.
- Install and detail content is shared by desktop and mobile Hub companion surfaces.
```

Also align the detail navigation wording with current behavior: selecting a managed skill name opens its detail surface.

- [x] **Step 2: Run type checking and the complete relevant regression set**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-skill-management-settings.test.ts __tests__/web-skill-management-service.test.ts __tests__/web-skill-management-view.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-mobile-settings-system-back.test.ts __tests__/web-agent-package-update-settings.test.ts web/src/settings/SkillManagementContent.test.tsx web/src/app/ChatHubSkillManagement.test.tsx web/src/app/ChatHubSkillCompanion.test.tsx web/src/app/ChatHubMenu.test.tsx
npm --prefix app run tsc:web
npm --prefix app run build:web
```

Expected: all tests pass, TypeScript reports no errors, and the web build succeeds.

- [x] **Step 3: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only the planned Settings, Hub skill ownership, test, CSS, plan, and wiki files are changed.

- [x] **Step 4: Mark this plan complete**

Change every completed checkbox in this plan from `[ ]` to `[x]`.

- [x] **Step 5: Commit and push using the repository completion gate**

Run exactly:

```powershell
git add -A
git commit -m "refactor(web): remove standalone skills settings"
git push origin main
```

Expected: commit succeeds and `origin/main` advances to the new commit.
