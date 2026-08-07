# Fixed Session List Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix session metadata alignment and mobile typography/spacing while replacing the Relaxed/Compact preference with one fixed responsive design: relaxed spacing on desktop and compact spacing on mobile.

**Architecture:** Keep `SessionListView`, `ProjectSection`, and `SessionRow` as the shared desktop/mobile structure. Express the only platform difference through explicit desktop/mobile density constants and CSS spacing tokens; remove user state and persistence so an old preference cannot change the design. Keep relative-age labels within the measured `99m` column maximum by using one-character month/year units.

**Tech Stack:** React 19, TypeScript, CSS, Jest, react-test-renderer

---

### Task 1: Lock the fixed density and alignment contract with failing tests

**Files:**
- Modify: `app/__tests__/web-chat-view-width-settings.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`
- Modify: `app/__tests__/web-chat-plan-surface.test.tsx`
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.test.tsx`
- Create: `app/__tests__/web-session-relative-age.test.ts`

- [ ] **Step 1: Replace the configurable-density test with the fixed responsive contract**

Update `web-chat-view-width-settings.test.ts` so the density test requires:

```ts
expect(density.DESKTOP_SESSION_LIST_DENSITY).toBe('relaxed');
expect(density.MOBILE_SESSION_LIST_DENSITY).toBe('compact');
expect(densityModule).not.toContain('SESSION_LIST_DENSITY_OPTIONS');
expect(settingsRootTsx).not.toContain('Session List Density');
expect(settingsRootTsx).not.toContain('sessionListDensity');
expect(persistence).not.toContain('sessionListDensity');
expect(mainTsx).not.toContain('const [sessionListDensity');
expect(mainTsx).toContain('dataSessionListDensity={DESKTOP_SESSION_LIST_DENSITY}');
expect(mainTsx).toContain('dataSessionListDensity={MOBILE_SESSION_LIST_DENSITY}');
expect(compactTokens).toContain('--sl-row-py: 3px;');
expect(compactTokens).not.toContain('--sl-row-font:');
expect(stylesCss).not.toContain('.mobile-project-row {');
expect(stylesCss).not.toContain('.mobile-project-toggle {');
```

- [ ] **Step 2: Add exact row alignment assertions**

Update the existing session-list style test in `web-chat-ui.test.ts`:

```ts
const sessionRowBlock = cssRuleBlock(stylesCss, '.wide-session-row');
const sessionTimeBlock = cssRuleBlock(stylesCss, '.wide-session-time');

expect(sessionRowBlock).toContain('gap: 4px;');
expect(sessionTimeBlock).toContain('flex: 0 0 22.5px;');
expect(sessionTimeBlock).toContain('white-space: nowrap;');
expect(stylesCss).toContain('--sl-row-font: 12.5px;');
expect(cssRuleBlock(stylesCss, '[data-session-list-density="compact"]')).not.toContain('--sl-row-font:');
```

- [ ] **Step 3: Lock compact age labels to the measured column maximum**

Create `web-session-relative-age.test.ts`. Load the existing local function from `WorkspaceApp.tsx`, execute it with a fixed `Date.now()`, and assert:

```ts
import fs from 'fs';
import path from 'path';

function loadFormatCompactRelativeAge(): (value: string) => string {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const declarationStart = source.indexOf('function formatCompactRelativeAge');
  const bodyStart = source.indexOf('{', declarationStart);
  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index + 1;
        break;
      }
    }
  }
  const declaration = source
    .slice(declarationStart, bodyEnd)
    .replace('value: string', 'value')
    .replace('): string', ')');
  return new Function(`${declaration}; return formatCompactRelativeAge;`)() as (value: string) => string;
}

describe('formatCompactRelativeAge', () => {
  const now = Date.UTC(2026, 6, 24, 0, 0, 0);

  test('keeps every age label within the three-character 99m width contract', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const formatCompactRelativeAge = loadFormatCompactRelativeAge();
    expect(formatCompactRelativeAge(new Date(now - 59 * 60_000).toISOString())).toBe('59m');
    expect(formatCompactRelativeAge(new Date(now - 11 * 30 * 24 * 60 * 60_000).toISOString())).toBe('11M');
    expect(formatCompactRelativeAge(new Date(now - 120 * 12 * 30 * 24 * 60 * 60_000).toISOString())).toBe('99y');
    nowSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Update floating Recent surface tests to require the fixed desktop density**

Remove the `sessionListDensity` prop from `ChatRecentSessionsSurface` fixtures and assert:

```tsx
expect(renderer!.root.findByProps({'aria-label': 'Recent sessions'}).props['data-session-list-density'])
  .toBe('relaxed');
```

Update source-contract assertions in `web-chat-recent-sessions-ui.test.ts` to require `DESKTOP_SESSION_LIST_DENSITY` instead of a state-driven prop.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-view-width-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-session-relative-age.test.ts web/src/chat/ChatRecentSessionsSurface.test.tsx
```

Expected: FAIL because density is still persisted/configurable, the mobile font token is still `12px`, the mobile project row still has a forced height, the row gap is still `8px`, and the time column is not fixed at `22.5px`.

### Task 2: Remove the Relaxed/Compact preference and pin responsive densities

**Files:**
- Modify: `app/web/src/chat/sessionListDensity.ts`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/chat/ChatRecentSessionsSurface.tsx`

- [ ] **Step 1: Make compact age output obey the measured maximum**

Update the existing local helper in `WorkspaceApp.tsx`:

```ts
function formatCompactRelativeAge(value: string): string {
  if (!value) return '0m';
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return '0m';
  const deltaMin = Math.floor(Math.max(0, Date.now() - ts) / 60_000);
  if (deltaMin < 60) return `${deltaMin}m`;
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) return `${deltaHour}h`;
  const deltaDay = Math.floor(deltaHour / 24);
  if (deltaDay < 30) return `${deltaDay}d`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}M`;
  return `${Math.min(Math.floor(deltaMonth / 12), 99)}y`;
}
```

- [ ] **Step 2: Replace preference helpers with fixed constants**

Use this complete `sessionListDensity.ts`:

```ts
export type SessionListDensity = 'relaxed' | 'compact';

export const DESKTOP_SESSION_LIST_DENSITY: SessionListDensity = 'relaxed';
export const MOBILE_SESSION_LIST_DENSITY: SessionListDensity = 'compact';
```

- [ ] **Step 3: Remove the density setting**

Delete the density imports, `sessionListDensity`/`setSessionListDensity` props, destructuring entries, and the `Session List Density` settings row from `SettingsRootContent.tsx`.

- [ ] **Step 4: Remove density persistence**

Delete the density imports, `PersistedGlobalState.sessionListDensity`, `GLOBAL_KEYS.sessionListDensity`, its default value, normalization, and database write record from `WorkspacePersistence.ts`. Existing stored records remain harmless orphaned data and are no longer read.

- [ ] **Step 5: Use constants at responsive render boundaries**

In `WorkspaceApp.tsx`, import both fixed constants, remove density state and persistence, and render:

```tsx
<ChatSessionNav
  className="mobile-project-session-nav"
  dataSessionListDensity={MOBILE_SESSION_LIST_DENSITY}
>
```

```tsx
<ChatSessionNav
  className="wide-project-session-nav"
  dataSessionListDensity={DESKTOP_SESSION_LIST_DENSITY}
>
```

Remove the density props passed to `SettingsRootContent` and `ChatRecentSessionsSurface`.

- [ ] **Step 6: Fix the floating Recent surface to desktop density**

Remove `sessionListDensity` from `ChatRecentSessionsSurfaceProps` and pass the constant directly:

```tsx
<ChatSessionPanel
  sessionListDensity={DESKTOP_SESSION_LIST_DENSITY}
  ref={surfaceRef}
  mode="floating"
  title="Recent Sessions"
  ariaLabel="Recent sessions"
>
```

### Task 3: Correct session alignment and mobile spacing/typography

**Files:**
- Modify: `app/web/src/styles/sessionlist.css`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Keep typography shared and compact only the spacing**

Keep the base density:

```css
--sl-row-py: 5px;
--sl-row-font: 12.5px;
--sl-section-gap: 12px;
```

Reduce only spacing for compact/mobile:

```css
[data-session-list-density="compact"] {
  --sl-row-py: 3px;
  --sl-section-gap: 9px;
}
```

- [ ] **Step 2: Bring the ellipsis closer to the agent pill**

Change the shared session row gap:

```css
.wide-session-row {
  gap: 4px;
}
```

- [ ] **Step 3: Stabilize the agent pill's right edge**

Use the measured minimum fixed column for the widest allowed compact label (`99m`). With IBM Plex Sans 400 at `11px` and tabular numerals, `99m` renders at `22.4063px`, while the row icon is at most `16px`:

```css
.wide-session-time {
  flex: 0 0 22.5px;
  min-width: 0;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
```

This keeps the metadata column at its measured minimum and prevents shorter values or icons from moving the agent pill.

- [ ] **Step 4: Remove legacy mobile-only project row geometry**

Delete the complete `.mobile-project-section`, `.mobile-project-row`, and `.mobile-project-toggle` rule blocks from `shell.css`.

Delete the `@media (max-width: 900px)` override for `.mobile-project-row` from `chat.css`, while retaining the unrelated mobile sheet rule. The shared project row structure then controls both platforms, and density tokens remain the sole compactness difference.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-view-width-settings.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-chat-plan-surface.test.tsx __tests__/web-session-relative-age.test.ts web/src/chat/ChatRecentSessionsSurface.test.tsx
```

Expected: PASS with no warnings.

### Task 4: Normalize icon alignment and separate icon semantics

**Files:**
- Modify: `app/web/src/chat/sessionlist/SessionIcon.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionIcon.test.tsx`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.tsx`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.test.tsx`
- Modify: `app/web/src/chat/sessionlist/RecentSessionsSection.tsx`
- Modify: `app/web/src/chat/sessionlist/RecentSessionsSection.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/base.css`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing semantic icon tests**

Expose the selected glyph name as `data-icon-name` on the shared SVG, then require Project Resume and Recent to use different icons:

```tsx
const resumeIcon = tree.root.findByProps({title: 'Resume session'}).findByType('svg');
expect(resumeIcon.props['data-icon-name']).toBe('play');
```

```tsx
const recentIcon = tree!.root.findByProps({className: 'recent-sessions-icon'});
expect(recentIcon.props['data-icon-name']).toBe('clock');
```

Extend `SessionIcon.test.tsx`:

```tsx
expect(SESSION_ICON_NAMES).toEqual(expect.arrayContaining(['play', 'clock']));
expect(svg.props['data-icon-name']).toBe(name);
```

- [ ] **Step 2: Write failing CSS contract tests for icon centering and Sessions inset**

Update `web-chat-ui.test.ts`:

```ts
const iconButtonReset = cssRuleBlock(stylesCss, 'button:has(> .sl-icon:only-child)');
expect(iconButtonReset).toContain('appearance: none;');
expect(iconButtonReset).toContain('padding: 0;');

const pinnedHeaderRule = stylesCss.match(
  /\.chat-session-panel-pinned \.chat-edge-surface-header,[\s\S]*?\n\}/,
)?.[0] ?? '';
expect(pinnedHeaderRule).toContain('padding-left: 17px;');
```

- [ ] **Step 3: Run the icon-focused tests and verify RED**

Run:

```powershell
npm test -- --runInBand web/src/chat/sessionlist/SessionIcon.test.tsx web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/RecentSessionsSection.test.tsx __tests__/web-chat-ui.test.ts
```

Expected: FAIL because Resume and Recent both use `history`, the shared icon-button reset does not exist, and the pinned Sessions header starts at `11px`.

- [ ] **Step 4: Add verified Lucide Play and Clock glyphs**

Add glyph bodies retrieved with `better-icons get lucide:play` and `better-icons get lucide:clock`:

```tsx
// lucide:play
play: (<><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></>),
// lucide:clock
clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
```

Set `data-icon-name={name}` on the SVG.

- [ ] **Step 5: Apply distinct semantic icons**

Use `clock` only for the Recent Sessions heading. Use `play` for Project Resume buttons, Resume sheet/popover titles, resumable-session rows, and empty Resume states. Use the existing `refreshCw` glyph for the archived Recover action. Remove the now-unused `history` glyph.

- [ ] **Step 6: Normalize every direct SessionIcon-only button**

Add this shared rule to `base.css`:

```css
button:has(> .sl-icon:only-child) {
  appearance: none;
  padding: 0;
}
```

This targets only buttons whose sole element child is a `SessionIcon`; text-and-icon menu rows retain their intended padding. In the current Chromium layout, this moves the SVG center from one pixel right of the button center to the exact center.

- [ ] **Step 7: Add six pixels of left breathing room to Sessions headers**

After the pinned/slideout grid override in `chat.css`, add:

```css
.chat-session-panel-pinned .chat-edge-surface-header,
.chat-session-panel-slideout .chat-edge-surface-header {
  padding-left: 17px;
}
```

Do not change the floating Recent header padding because its toggle-and-title geometry already aligns with the project-name column.

- [ ] **Step 8: Run the icon-focused tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand web/src/chat/sessionlist/SessionIcon.test.tsx web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/RecentSessionsSection.test.tsx __tests__/web-chat-ui.test.ts
```

Expected: PASS with no warnings.

### Task 5: Verify the app and publish the completed change

**Files:**
- Verify only: `app/web/src/**`
- Verify only: `app/__tests__/**`

- [ ] **Step 1: Run all affected component tests**

Run:

```powershell
npm test -- --runInBand web/src/chat/sessionlist web/src/chat/ChatRecentSessionsSurface.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript validation**

Run:

```powershell
npm run tsc:web
```

Expected: exits with code 0.

- [ ] **Step 3: Run the production web build**

Run:

```powershell
npm run build:web
```

Expected: webpack completes successfully and writes the configured web output.

- [ ] **Step 4: Inspect the final diff and check for obsolete density references**

Run:

```powershell
rg -n --glob '!**/dist/**' --glob '!**/node_modules/**' "SESSION_LIST_DENSITY_OPTIONS|normalizeSessionListDensity|Session List Density|sessionListDensity" app/web/src
git diff --check
git status --short
```

Expected: no obsolete preference references, no whitespace errors, and only task-related files changed.

- [ ] **Step 5: Rebase, commit, and push according to project rules**

Run the repository-required completion sequence after rebasing onto the latest `origin/main`:

```powershell
git add -A
git commit -m "fix(app): stabilize responsive session list layout"
git push origin main
```

Expected: commit succeeds and `main` is pushed to `origin/main`.
