# Monitor Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate desktop Limits and Model efficiency cards with one compact Monitor card whose Limits and IQ tabs share one header, mode, refresh action, visibility preference, and mobile naming.

**Architecture:** Add a `MonitorSurface` presentation container that owns desktop tab, collapse, and detail state while receiving the existing independent Limits and IQ snapshots and refresh callbacks. Keep HubState and CodexRadar stores unchanged; refactor the existing usage component to expose compact content, migrate persistence to one `showMonitor` key with legacy OR fallback, and update the mobile dialog to the same Monitor vocabulary with fixed Detail content.

**Tech Stack:** React 19, TypeScript, CSS, Jest with react-test-renderer, Workspace IndexedDB persistence.

---

### Task 1: Unify the persisted Monitor visibility preference

**Files:**
- Modify: `app/__tests__/web-usage-workspace-integration.test.tsx`
- Modify: `app/__tests__/web-model-efficiency-workspace-integration.test.tsx`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [x] **Step 1: Write failing source-integration assertions for the new preference and migration**

Replace the two old visibility-setting expectations with assertions equivalent to:

```ts
expect(persistence).toContain('showMonitor: boolean;');
expect(persistence).toContain("showMonitor: 'showMonitor'");
expect(persistence).toContain("showLimitsMonitor: 'showLimitsMonitor'");
expect(persistence).toContain("showModelEfficiency: 'showModelEfficiency'");
expect(persistence).toContain(
  "const hasLegacyMonitorVisibility = typeof input.showLimitsMonitor === 'boolean'",
);
expect(persistence).toContain("const showMonitor = typeof input.showMonitor === 'boolean'");
expect(persistence).toContain('input.showLimitsMonitor === true || input.showModelEfficiency === true');
expect(persistence).toContain(
  '{k: GLOBAL_KEYS.showMonitor, v: serialize(this.state.global.showMonitor), updatedAt}',
);
expect(persistence).not.toContain('this.state.global.showLimitsMonitor');
expect(persistence).not.toContain('this.state.global.showModelEfficiency');

expect(settings).toContain('Show Monitor');
expect(settings).toContain('checked={showMonitor}');
expect(settings).not.toContain('Show Limits Monitor');
expect(settings).not.toContain('Show Model Efficiency');

expect(dialogs).toContain("| {kind: 'hideMonitor'}");
expect(dialogs).toContain("if (target.kind === 'hideMonitor') return 'Hide monitor?';");
expect(dialogs).not.toContain("kind: 'hideLimitsMonitor'");
expect(dialogs).not.toContain("kind: 'hideModelEfficiency'");
```

Also require `WorkspaceApp.tsx` to own and persist only `showMonitor` / `setShowMonitor`.

- [x] **Step 2: Run the focused integration tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-workspace-integration.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx
```

Expected: FAIL because persistence, settings, dialogs, and Workspace still expose two old flags.

- [x] **Step 3: Implement the persisted-key migration**

Change `PersistedGlobalState` to contain only:

```ts
showMonitor: boolean;
```

Keep the two old storage names in `GLOBAL_KEYS` for compatibility reads and add the new key:

```ts
showMonitor: 'showMonitor',
showLimitsMonitor: 'showLimitsMonitor',
showModelEfficiency: 'showModelEfficiency',
```

Extend the sanitizer input, but not the persisted output type:

```ts
type PersistedGlobalStateInput = Partial<PersistedGlobalState> & {
  floatingControlSlot?: unknown;
  showLimitsMonitor?: unknown;
  showModelEfficiency?: unknown;
};
```

Set the default to `showMonitor: true` and compute the migration before the returned object. Explicit legacy false values must remain false; the default applies only when neither the new nor either legacy key exists:

```ts
const hasLegacyMonitorVisibility = typeof input.showLimitsMonitor === 'boolean'
  || typeof input.showModelEfficiency === 'boolean';
const showMonitor = typeof input.showMonitor === 'boolean'
  ? input.showMonitor
  : hasLegacyMonitorVisibility
    ? input.showLimitsMonitor === true || input.showModelEfficiency === true
    : base.showMonitor;
```

Use the computed `showMonitor` property in the existing sanitized return object.

In `fromDbRows`, pass the raw `globalPatch` directly to `sanitizeGlobalState` so absence of the new key remains observable. Write only `GLOBAL_KEYS.showMonitor` from `globalRows`; `globalRowsForPatch` naturally ignores the legacy keys because they are not members of `PersistedGlobalState`.

- [x] **Step 4: Replace the two settings and confirmation flows**

Use these public props in `SettingsRootContent`:

```ts
showMonitor: boolean;
setShowMonitor: (value: boolean) => void;
```

Render one wide-only checkbox labeled `Show Monitor`. Replace both confirmation targets with:

```ts
| {kind: 'hideMonitor'}
```

and resolve it as `Hide monitor?`, `Monitor`, and `This hides Monitor from the chat workspace. You can show it again from Settings > Chat.` with the existing eye-closed icon and `Hide` primary label.

In `WorkspaceApp`, initialize, remember, pass to settings, and confirm-hide only `showMonitor`.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-workspace-integration.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx
```

Expected: both suites PASS.

- [x] **Step 6: Commit the preference migration**

```powershell
git add app/__tests__/web-usage-workspace-integration.test.tsx app/__tests__/web-model-efficiency-workspace-integration.test.tsx app/web/src/workspace/WorkspacePersistence.ts app/web/src/settings/SettingsRootContent.tsx app/web/src/shell/AppDialogs.tsx app/web/src/app/WorkspaceApp.tsx
git commit -m "refactor: unify monitor visibility"
```

### Task 2: Add the shared desktop Monitor surface

**Files:**
- Create: `app/web/src/usage/MonitorSurface.tsx`
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`
- Modify: `app/web/src/chat/ChatFunctionSurface.tsx`
- Modify: `app/__tests__/web-usage-feature-surface.test.tsx`
- Modify: `app/web/src/styles/usage.css`

- [x] **Step 1: Write failing component tests for shared state and actions**

Import `MonitorSurface` and add a helper that renders it with `fixtureSnapshot` and `efficiencySnapshot`. Cover the exact behavior:

```tsx
const onRefreshLimits = jest.fn();
const onRefreshIq = jest.fn();
const onRequestHide = jest.fn();
view = TestRenderer.create(
  <MonitorSurface
    usageSnapshot={fixtureSnapshot}
    efficiencySnapshot={efficiencySnapshot}
    onRefreshLimits={onRefreshLimits}
    onRefreshIq={onRefreshIq}
    onRequestHide={onRequestHide}
  />,
);

expect(view.root.findByProps({'aria-label': 'Monitor'}).props['data-mode']).toBe('compact');
expect(view.root.findByProps({role: 'tab', 'aria-label': 'Limits'}).props['aria-selected']).toBe(true);
expect(view.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props['aria-selected']).toBe(false);

act(() => view.root.findByProps({'aria-label': 'Show monitor details'}).props.onClick());
act(() => view.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props.onClick());
expect(view.root.findByProps({'aria-label': 'Monitor'}).props['data-mode']).toBe('detail');
expect(view.root.findByProps({'aria-label': 'Sol model efficiency'})).toBeDefined();

act(() => view.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick());
expect(onRefreshLimits).toHaveBeenCalledTimes(1);
expect(onRefreshIq).toHaveBeenCalledTimes(1);

act(() => view.root.findByProps({'aria-label': 'Collapse Monitor'}).props.onClick());
expect(view.root.findAllByProps({className: expect.stringContaining('monitor-body')})).toHaveLength(0);
expect(view.root.findByProps({role: 'tab', 'aria-label': 'IQ'})).toBeDefined();
act(() => view.root.findByProps({'aria-label': 'Hide monitor'}).props.onClick());
expect(onRequestHide).toHaveBeenCalledTimes(1);
```

Add refresh-state cases: spinner when either snapshot refreshes, disabled only when both refresh, and tooltip containing both freshness values. Assert no CodexRadar external link exists.

- [x] **Step 2: Run the component suite and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx
```

Expected: FAIL because `MonitorSurface` and inline desktop tabs do not exist.

- [x] **Step 3: Expose Limits compact content without a nested surface**

In `UsageFeatureSurface.tsx`, export the existing compact body as:

```tsx
export function UsageCompactContent({snapshot}: {snapshot: UsageViewSnapshot}) {
  const compactAccounts = snapshot.providers.flatMap(provider =>
    provider.accounts
      .filter(account => account.status === 'ok')
      .map(account => ({provider, account})),
  );
  if (snapshot.providers.length === 0) {
    return <div className="usage-feature-empty">Waiting for Hub limits</div>;
  }
  return (
    <div className="usage-provider-list">
      {compactAccounts.map(({provider, account}) => (
        <AccountRail
          key={`${provider.id}:${account.localId}:${account.hubIds.join(',')}`}
          provider={provider}
          account={account}
        />
      ))}
    </div>
  );
}
```

Retain `UsageDetailContent`; remove the old `UsageFeatureSurface` header/state export after all callers move in Task 3.

- [x] **Step 4: Let ChatFunctionSurface accept a full inline toolbar**

Make `actions` optional, add `toolbar?: React.ReactNode`, and forward it to `ChatEdgeSurfaceHeader`:

```tsx
export type ChatFunctionSurfaceProps = {
  title: string;
  collapsed: boolean;
  mode: 'compact' | 'detail';
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
  side?: ChatEdgeSurfaceSide;
  className?: string;
};

<ChatEdgeSurfaceHeader
  title={title}
  collapsed={collapsed}
  onToggleCollapsed={onToggleCollapsed}
  actions={actions}
  toolbar={toolbar}
/>
```

- [x] **Step 5: Implement MonitorSurface**

Create a component with `activeTab: 'limits' | 'iq'`, `collapsed`, and `detail` local state. Its toolbar contains an inline tablist and the three shared buttons. Use this refresh logic:

```tsx
const refreshing = usageSnapshot.refreshing || efficiencySnapshot.refreshing;
const refreshDisabled = usageSnapshot.refreshing && efficiencySnapshot.refreshing;
const handleRefresh = () => {
  onRefreshLimits();
  onRefreshIq();
};
```

Render the selected content with one shared mode:

```tsx
<div className={`monitor-body ${activeTab}`}>
  {activeTab === 'limits' ? (
    detail
      ? <UsageDetailContent snapshot={usageSnapshot} />
      : <UsageCompactContent snapshot={usageSnapshot} />
  ) : (
    <ModelEfficiencySnapshotContent
      snapshot={efficiencySnapshot}
      mode={detail ? 'detail' : 'simple'}
      onRetry={onRefreshIq}
    />
  )}
</div>
```

The toolbar must remain rendered when collapsed. Use `title="Monitor"`, `className="monitor-surface"`, labels `Hide monitor`, `Show monitor details` / `Hide monitor details`, and `Refresh monitor`; do not render the CodexRadar link.

- [x] **Step 6: Add the compact inline-tab styling**

Add `.monitor-toolbar`, `.monitor-tabs`, `.monitor-actions`, and `.monitor-body` rules. The toolbar fills header column 3 through the right edge, tabs use a low-contrast segmented treatment, and all controls fit the existing 36px header. Remove reliance on a second desktop tab row.

- [x] **Step 7: Run the component suite and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx web/src/chat/ChatEdgeSurfaceHeader.test.tsx
```

Expected: both suites PASS.

- [x] **Step 8: Commit the shared surface**

```powershell
git add app/web/src/usage/MonitorSurface.tsx app/web/src/usage/UsageFeatureSurface.tsx app/web/src/chat/ChatFunctionSurface.tsx app/web/src/styles/usage.css app/__tests__/web-usage-feature-surface.test.tsx
git commit -m "feat: add shared monitor surface"
```

### Task 3: Mount one desktop card and remove obsolete card shells

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Delete: `app/web/src/modelEfficiency/ModelEfficiencySurface.tsx`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`
- Modify: `app/__tests__/web-chat-session-panel-layout.test.tsx`
- Modify: `app/__tests__/web-usage-workspace-integration.test.tsx`
- Modify: `app/__tests__/web-model-efficiency-workspace-integration.test.tsx`
- Modify: `app/__tests__/web-model-efficiency-surface.test.tsx`
- Modify: `app/web/src/styles/modelEfficiency.css`

- [x] **Step 1: Write failing workspace assertions for one mounted Monitor card**

Require the desktop stack to contain one conditional and one component:

```ts
expect(stackSource).toContain('{showMonitor ? (');
expect(stackSource).toContain('<MonitorSurface');
expect(stackSource).toContain('usageSnapshot={usageSnapshot}');
expect(stackSource).toContain('efficiencySnapshot={modelEfficiencySnapshot}');
expect(stackSource).toContain("onRequestHide={() => setConfirmTarget({kind: 'hideMonitor'})}");
expect(stackSource).not.toContain('<UsageFeatureSurface');
expect(stackSource).not.toContain('<ModelEfficiencySurface');
```

Update layout expectations from Recent Sessions / Plan / Limits to Recent Sessions / Plan / Monitor and remove assertions that the IQ card mounts separately below Limits.

- [x] **Step 2: Run workspace/layout tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-session-panel-layout.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx
```

Expected: FAIL because Workspace still mounts two cards.

- [x] **Step 3: Replace both desktop mounts with MonitorSurface**

Import `MonitorSurface`, remove both old surface imports, and render:

```tsx
{showMonitor ? (
  <MonitorSurface
    usageSnapshot={usageSnapshot}
    efficiencySnapshot={modelEfficiencySnapshot}
    onRefreshLimits={() => { void refreshUsageAcrossHubs(); }}
    onRefreshIq={() => { void modelEfficiencyStore.refresh(); }}
    onRequestHide={() => setConfirmTarget({kind: 'hideMonitor'})}
  />
) : null}
```

Use `showMonitor` in `showChatEdgeSurfaces` and remove all remaining `showLimitsMonitor` / `showModelEfficiency` state references.

- [x] **Step 4: Remove obsolete desktop shell code**

Delete `ModelEfficiencySurface.tsx`. Remove the old `UsageFeatureSurface` component export and its `ChatFunctionSurface` import, retaining only `UsageCompactContent`, `UsageDetailContent`, and their private helpers. Remove `.model-efficiency-surface.desktop`, `.model-efficiency-surface.desktop.detail`, `.model-efficiency-surface.desktop.collapsed`, and `.model-efficiency-body` CSS; `MonitorSurface` now owns geometry and scrolling.

Update model-efficiency component tests to test only content formatting and cards, while shared header/state behavior remains in the Monitor suite.

- [x] **Step 5: Run the affected suites and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-session-panel-layout.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-model-efficiency-surface.test.tsx
```

Expected: all listed suites PASS.

- [x] **Step 6: Commit the desktop integration**

```powershell
git add -A app/web/src/app/WorkspaceApp.tsx app/web/src/modelEfficiency app/web/src/usage/UsageFeatureSurface.tsx app/web/src/styles/modelEfficiency.css app/__tests__
git commit -m "refactor: merge desktop monitor cards"
```

### Task 4: Unify the narrow-screen Monitor dialog

**Files:**
- Modify: `app/web/src/usage/MobileUsageDialog.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/usage.css`
- Modify: `app/__tests__/web-usage-feature-surface.test.tsx`
- Modify: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] **Step 1: Write failing mobile behavior tests**

Update the mobile expectations to require:

```tsx
expect(overlay.props['aria-label']).toBe('Monitor');
expect(renderedText(view.root.findByProps({className: 'usage-mobile-title'}))).toBe('Monitor');
expect(view.root.findByProps({role: 'tab', 'aria-label': 'Limits'}).props['aria-selected']).toBe(true);
expect(view.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props['aria-selected']).toBe(false);

act(() => view.root.findByProps({'aria-label': 'Refresh monitor'}).props.onClick());
expect(onRefresh).toHaveBeenCalledTimes(1);
expect(onRefreshEfficiency).toHaveBeenCalledTimes(1);

act(() => view.root.findByProps({role: 'tab', 'aria-label': 'IQ'}).props.onClick());
expect(view.root.findByProps({'aria-label': 'Sol model efficiency'})).toBeDefined();
expect(view.root.findAllByProps({className: 'usage-mobile-footer'})).toHaveLength(0);
expect(renderedText(view.root)).not.toContain('Data from CodexRadar');
expect(view.root.findAllByProps({'aria-label': 'Show monitor details'})).toHaveLength(0);
```

Require the mobile gesture button to use key/title/aria-label `monitor`, `Monitor`, `Monitor`, while remaining independent of `showMonitor`.

- [x] **Step 2: Run mobile-focused tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: FAIL on old Limits/Model efficiency names, active-tab-only refresh, and footer presence.

- [x] **Step 3: Implement shared mobile refresh and Monitor naming**

Keep `activeTab` local and defaulted to `limits`, but rename the other value to `iq`. Use:

```tsx
const refreshing = snapshot.refreshing || efficiencySnapshot.refreshing;
const refreshDisabled = snapshot.refreshing && efficiencySnapshot.refreshing;
const handleRefresh = () => {
  onRefresh();
  onRefreshEfficiency();
};
```

Set dialog, title, close, and refresh accessible labels to Monitor vocabulary. Rename the second tab to `IQ`, move the tablist into the same header row as the Monitor title and actions, keep Limits and IQ content fixed to `UsageDetailContent` and `ModelEfficiencySnapshotContent mode="detail"`, and remove the footer entirely.

Rename the Workspace mobile shortcut to `Monitor` while leaving it always rendered whenever the expanded gesture menu is rendered.

- [x] **Step 4: Remove obsolete footer CSS and verify mobile layout**

Delete `.usage-mobile-footer` and `.usage-mobile-footer a`. Keep safe-area card sizing and body scrolling unchanged. Ensure the body grows to consume the freed footer height.

- [x] **Step 5: Run mobile-focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: both suites PASS.

- [x] **Step 6: Commit the mobile integration**

```powershell
git add app/web/src/usage/MobileUsageDialog.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/usage.css app/__tests__/web-usage-feature-surface.test.tsx app/__tests__/web-usage-workspace-integration.test.tsx
git commit -m "feat: unify mobile monitor"
```

### Task 5: Verify the complete feature and finalize documentation

**Files:**
- Modify: `docs/scope/2026-07-22-monitor-card/plan-monitor-card.md`
- Verify: `docs/scope/2026-07-22-monitor-card/spec-monitor-card.md`
- Verify: `docs/wiki/features/limits-monitoring.md`
- Verify: `docs/wiki/features/model-efficiency.md`

- [x] **Step 1: Run stale-name and obsolete-shell scans**

Run:

```powershell
rg -n "showLimitsMonitor|showModelEfficiency|hideLimitsMonitor|hideModelEfficiency|Show Limits Monitor|Show Model Efficiency|Model efficiency.*tab|Data from CodexRadar|usage-mobile-footer|<UsageFeatureSurface|<ModelEfficiencySurface" app/web/src app/__tests__ --glob '!**/dist/**'
```

Expected: only explicit legacy persistence key declarations/migration assertions remain for `showLimitsMonitor` and `showModelEfficiency`; all obsolete UI names, shells, footer, and source link usages are absent.

- [x] **Step 2: Run targeted Monitor regression suites**

Run:

```powershell
npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-model-efficiency-surface.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-chat-plan-surface.test.tsx __tests__/web-chat-session-panel-layout.test.tsx
```

Expected: all listed suites PASS.

- [x] **Step 3: Run full tests, typecheck, and production build**

Run:

```powershell
npm test -- --runInBand
npm run tsc:web
npm run build:web -- --no-cache
```

Expected: Jest reports zero failed suites/tests, TypeScript exits 0, and Webpack compiles successfully. `--no-cache` avoids junction-path cache conflicts in the worktree.

- [x] **Step 4: Check documentation and diff hygiene**

Run:

```powershell
rg -n "TB[D]|TO[D]O|implement lat[e]r" docs/scope/2026-07-22-monitor-card docs/wiki/features/limits-monitoring.md docs/wiki/features/model-efficiency.md
git diff --check
git status --short
```

Expected: no placeholders, no whitespace errors, and only Monitor feature/spec/wiki/plan files are changed.

- [x] **Step 5: Mark this plan complete and create the final feature commit**

Mark all completed checkboxes in this plan, then run the repository completion tail:

```powershell
git add -A
git commit -m "docs: finalize monitor card"
git push origin feature/monitor-card
```

Expected: commit and push succeed. Then fast-forward or merge `feature/monitor-card` into current `main` in a clean integration worktree and push `origin/main`, preserving unrelated worktrees and requesting confirmation before deleting any branch or worktree.
