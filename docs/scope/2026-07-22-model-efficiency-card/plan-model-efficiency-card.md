# Model Efficiency Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a self-contained CodexRadar model-efficiency feature that fetches on page startup or manual refresh, presents three recommended effort levels per supported model in a compact desktop card, and exposes full details through desktop mode switching and a mobile dialog tab.

**Architecture:** A frontend-only singleton store owns the in-memory request lifecycle and normalized snapshot. Pure domain helpers parse CodexRadar data, deduplicate records, calculate combined cost, and choose Quality/Balanced/Economy recommendations. Reusable presentation components render Simple and Detail views; `WorkspaceApp` integrates them with the existing edge-surface, mobile usage dialog, settings persistence, and confirmation flows.

**Tech Stack:** React 18, TypeScript, Jest, Testing Library, CSS, webpack

---

## Task 1: Build and test the model-efficiency domain layer

**Files:**

- Create: `app/web/src/modelEfficiency/modelEfficiencyTypes.ts`
- Create: `app/web/src/modelEfficiency/modelEfficiencyModel.ts`
- Create: `app/__tests__/web-model-efficiency-model.test.ts`

- [x] Write failing parser and recommendation tests covering root/comparison merging, fixed family filtering/order, date precedence, incomplete records, combined-cost calculation, Pareto selection, role uniqueness, and fixed effort tie-breaking.

```ts
import {
  calculateCombinedCost,
  normalizeModelEfficiencyPayload,
  selectModelRecommendations,
} from '../web/src/modelEfficiency/modelEfficiencyModel';

expect(normalizeModelEfficiencyPayload(payload).map((item) => item.family)).toEqual([
  'gpt-5.6-sol',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
]);
expect(calculateCombinedCost({ averageCostUsd: 2, averageTaskSeconds: 600 })).toBeCloseTo(2);
expect(selectModelRecommendations(items)).toMatchObject({
  quality: { effort: 'max' },
  balanced: { effort: 'high' },
  economy: { effort: 'low' },
});
```

- [x] Run the test and confirm it fails because the model-efficiency modules do not exist.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-model.test.ts`

Expected: FAIL with a module-resolution error.

- [x] Define the shared model types, including the three supported families, six recognized effort levels, normalized rows, fetch snapshot, and recommendation roles.

```ts
export const MODEL_FAMILIES = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;
export const EFFORT_ORDER = ['ultra', 'max', 'xhigh', 'high', 'medium', 'low'] as const;
export type RecommendationRole = 'quality' | 'balanced' | 'economy';
```

- [x] Implement payload normalization using root `model_iq.latest` plus every `model_iq.comparisons.*.latest`, retaining only valid supported records and deduplicating model/effort by newer date with root winning equal or missing dates.

- [x] Implement combined cost and recommendation selection exactly as approved: Quality first, Economy second from unused rows, then Balanced from the remaining Pareto frontier using normalized IQ and log-cost distance to the ideal point.

```ts
const exponent = Math.log(2.5) / Math.log(1.35);
return averageCostUsd * Math.pow(averageTaskSeconds / 60 / 10, exponent);
```

- [x] Run the domain tests and confirm they pass.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-model.test.ts`

Expected: PASS.

- [x] Commit the domain layer.

Run:

```powershell
git add app/web/src/modelEfficiency app/__tests__/web-model-efficiency-model.test.ts
git commit -m "feat: add model efficiency ranking logic"
```

## Task 2: Add the in-memory fetch store

**Files:**

- Create: `app/web/src/modelEfficiency/modelEfficiencyStore.ts`
- Create: `app/__tests__/web-model-efficiency-store.test.ts`

- [x] Write failing tests for initial load, subscribers, concurrent refresh coalescing, HTTP/JSON failures, first-load error state, and stale-data retention after a failed manual refresh.

```ts
const store = new ModelEfficiencyStore(fetcher);
const refresh = store.refresh();
expect(store.snapshot()).toMatchObject({ status: 'loading', refreshing: true });
await refresh;
expect(store.snapshot()).toMatchObject({ status: 'ready', refreshing: false });
```

- [x] Run the store test and confirm it fails because the store is not implemented.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-store.test.ts`

Expected: FAIL with a module-resolution or export error.

- [x] Implement `ModelEfficiencyStore` with an injectable fetcher, `subscribe`, immutable `snapshot`, and a coalesced `refresh` request to `https://codexradar.com/current.json`.

- [x] Preserve successful items and source update time when a later refresh fails, while exposing the refresh error; keep first-load failures retryable without persistence or timers.

- [x] Run the store tests and confirm they pass.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-store.test.ts`

Expected: PASS.

- [x] Commit the store.

Run:

```powershell
git add app/web/src/modelEfficiency/modelEfficiencyStore.ts app/__tests__/web-model-efficiency-store.test.ts
git commit -m "feat: add model efficiency data store"
```

## Task 3: Render Simple and Detail model-efficiency views

**Files:**

- Create: `app/web/src/modelEfficiency/ModelEfficiencyContent.tsx`
- Create: `app/web/src/modelEfficiency/ModelEfficiencySurface.tsx`
- Create: `app/web/src/styles/modelEfficiency.css`
- Modify: `app/web/src/styles/index.css`
- Modify: `app/web/src/chat/ChatFunctionSurface.tsx`
- Create: `app/__tests__/web-model-efficiency-surface.test.tsx`

- [x] Write failing component tests for the three-row Simple matrix, Quality/Balanced/Economy columns, IQ/cost/time values, missing-value dashes, Detail family grouping, effort ordering, loading/error/stale-error states, source attribution, refresh, hide, collapse, and Simple/Detail toggling.

```tsx
render(
  <ModelEfficiencySurface
    snapshot={snapshot}
    onRefresh={onRefresh}
    onRequestHide={onRequestHide}
  />,
);
expect(screen.getByRole('columnheader', { name: 'Quality' })).toBeInTheDocument();
expect(screen.getByText('Sol')).toBeInTheDocument();
```

- [x] Run the component test and confirm it fails because the components do not exist.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-surface.test.tsx`

Expected: FAIL with a module-resolution error.

- [x] Extend `ChatFunctionSurface` with optional `side` and `className` props, defaulting `side` to `left`, so the existing component can apply right-edge geometry without changing current callers.

- [x] Implement reusable Simple and Detail content. Format average task cost in USD, duration compactly, and missing cost/time as `—`; expose semantic table headers and accessible action labels.

- [x] Implement the desktop surface with default Simple mode, local non-persisted mode/collapse state, existing header/action visual language, right-edge fade geometry, manual refresh, hide action, updated timestamp, and clickable CodexRadar attribution.

- [x] Add dedicated responsive CSS with a compact table-like grid, one equal visual cell per recommendation, fixed three-row family layout, and no chart graphics.

- [x] Run component and existing edge-surface tests and confirm they pass.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-surface.test.tsx __tests__/web-chat-edge-surface-geometry.test.ts`

Expected: PASS.

- [x] Commit the presentation layer.

Run:

```powershell
git add app/web/src/modelEfficiency app/web/src/chat/ChatFunctionSurface.tsx app/web/src/styles app/__tests__/web-model-efficiency-surface.test.tsx
git commit -m "feat: add model efficiency views"
```

## Task 4: Add the mobile Model efficiency tab

**Files:**

- Modify: `app/web/src/usage/MobileUsageDialog.tsx`
- Modify: `app/__tests__/web-usage-feature-surface.test.tsx`
- Modify: `app/web/src/styles/usage.css`

- [x] Extend the mobile dialog tests first: every mount defaults to Limits, selecting Model efficiency shows the Detail view directly, and the header refresh action targets and disables according to the active tab.

```tsx
expect(screen.getByRole('tab', { name: 'Limits' })).toHaveAttribute('aria-selected', 'true');
fireEvent.click(screen.getByRole('tab', { name: 'Model efficiency' }));
expect(screen.getByRole('tab', { name: 'Model efficiency' })).toHaveAttribute('aria-selected', 'true');
expect(screen.getByRole('table', { name: /Sol model efficiency/i })).toBeInTheDocument();
```

- [x] Run the existing usage surface test and confirm the new assertions fail.

Run: `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx`

Expected: FAIL because the dialog does not expose tabs or model-efficiency props.

- [x] Add `efficiencySnapshot` and `onRefreshEfficiency` props, local tab state initialized to Limits, accessible tab semantics, active refresh routing, and the shared Detail content for Model efficiency.

- [x] Update the mobile dialog CSS for the two-tab control and detail table while preserving the current Limits layout and native-back close behavior.

- [x] Run the usage surface tests and confirm they pass.

Run: `npm test -- --runInBand __tests__/web-usage-feature-surface.test.tsx`

Expected: PASS.

- [x] Commit the mobile integration.

Run:

```powershell
git add app/web/src/usage/MobileUsageDialog.tsx app/web/src/styles/usage.css app/__tests__/web-usage-feature-surface.test.tsx
git commit -m "feat: add mobile model efficiency tab"
```

## Task 5: Integrate lifecycle, settings, persistence, and hide confirmation

**Files:**

- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Create: `app/__tests__/web-model-efficiency-workspace-integration.test.tsx`
- Modify: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [x] Write failing integration and persistence tests for `showModelEfficiency` defaulting to true, round-trip normalization, Settings > Chat toggle wiring, desktop-only right card placement, one startup refresh per Workspace lifecycle, mobile dialog props, and the hide confirmation path.

```ts
expect(loadPersistedState(emptyStorage).global.showModelEfficiency).toBe(true);
expect(workspaceSource).toContain('new ModelEfficiencyStore()');
expect(workspaceSource).toContain('showModelEfficiency ?');
expect(settingsSource).toContain('Show Model Efficiency');
```

- [x] Run the integration and persistence tests and confirm they fail for the missing wiring.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-usage-workspace-integration.test.tsx`

Expected: FAIL with missing state, settings, or source integration assertions.

- [x] Add `showModelEfficiency` to persisted global state, normalization, save rows, and the Settings root props. Default it to true and keep it independent from `showLimitsMonitor`.

- [x] Instantiate one store per `WorkspaceApp` lifecycle, subscribe to its snapshot, trigger one startup refresh, and pass active refresh/state into both desktop and mobile surfaces without timers, focus listeners, current-model logic, or server APIs.

- [x] Mount the right-side card only on wide non-archived workspaces when enabled. Keep the preview open and do not add the right card to left-side alignment reservation logic.

- [x] Add `hideModelEfficiency` confirmation copy and handler, and wire the Settings toggle and surface hide action to the same persisted state.

- [x] Run integration, persistence, usage, and surface tests and confirm they pass.

Run: `npm test -- --runInBand __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-usage-feature-surface.test.tsx __tests__/web-model-efficiency-surface.test.tsx`

Expected: PASS.

- [x] Commit the app integration and approved product documentation.

Run:

```powershell
git add app/web/src/app app/web/src/settings app/web/src/storage app/__tests__ docs/scope/2026-07-22-model-efficiency-card docs/wiki
git commit -m "feat: integrate model efficiency card"
```

## Task 6: Verify the complete feature in the worktree

**Files:**

- Review all files changed by Tasks 1–5.

- [x] Run all model-efficiency and directly affected UI tests together.

Run:

```powershell
npm test -- --runInBand __tests__/web-model-efficiency-model.test.ts __tests__/web-model-efficiency-store.test.ts __tests__/web-model-efficiency-surface.test.tsx __tests__/web-model-efficiency-workspace-integration.test.tsx __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-chat-edge-surface-geometry.test.ts
```

Expected: PASS.

- [x] Run the entire Jest suite to catch interactions outside the focused surface.

Run: `npm test -- --runInBand`

Expected: all suites PASS.

- [x] Run the web TypeScript check.

Run: `npm run tsc:web`

Expected: exit code 0 with no diagnostics.

- [x] Build the production web bundle.

Run: `npm run build:web`

Expected: webpack exits successfully.

- [x] Check formatting hazards, unresolved planning markers, worktree status, and the final diff.

Run:

```powershell
git diff --check
rg -n -i "TBD|TODO|implement later|fill in details" docs/scope/2026-07-22-model-efficiency-card app/web/src/modelEfficiency
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors or unresolved markers; only intended feature files differ from `main`.

- [x] Review the rendered desktop Simple/Detail states and mobile tab at wide and narrow viewport sizes using the available local preview workflow; correct any visual clipping, overlap, or inaccessible controls before integration.

- [x] Hand the verified feature branch back to the main worktree for a squash merge, rerun focused verification against the squashed changes, then commit and push `main`.
