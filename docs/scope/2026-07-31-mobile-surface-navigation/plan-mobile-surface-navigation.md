# Mobile Surface Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the mobile Floating Nav usable across every primary Surface while unifying Preview and Terminal under one two-row Workbench Chrome with controlled mobile fullscreen behavior.

**Architecture:** Add a shared `WorkbenchChrome` frame for toolbar, tabs, content, footer, and controlled mobile fullscreen. Keep `WorkspaceApp` as the Surface coordinator, move the Floating Nav into an application-control layer above primary mobile Surfaces, and keep Preview/Terminal mounted but hidden on mobile so their DOM-backed work state survives Surface switches. Extend the existing floating-control bounds model with a right-side reserved bottom inset for the fullscreen control.

**Tech Stack:** React 19, TypeScript 5.8, Jest 30, react-test-renderer, CSS custom properties, existing WheelMaker responsive shell and workspace state.

---

## File structure

- Create `app/web/src/shell/workbench/WorkbenchChrome.tsx`: shared desktop/mobile Workbench frame; owns toolbar/tabs structure, leading close/back button, controlled fullscreen button, content slot, and optional footer.
- Create `app/web/src/styles/workbench.css`: shared Chrome geometry and mobile fullscreen control; Preview- and Terminal-specific files retain only feature styling.
- Create `app/__tests__/web-workbench-chrome.test.tsx`: behavioral tests for the shared frame.
- Modify `app/web/src/preview/PreviewWorkbenchChrome.tsx`: compose the shared frame and keep Preview-only menus, tree tools, search, and tab content.
- Modify `app/web/src/terminal/TerminalWorkbench.tsx`: compose the shared frame, render compact non-nested tabs, and organize New/Fit/Restart actions.
- Modify `app/web/src/app/WorkspaceApp.tsx`: own Preview/Terminal fullscreen state, keep mobile workbenches mounted, coordinate global Surface switching, preserve Chat-only drawer coupling, and feed avoidance geometry.
- Modify `app/web/src/shell/ResponsiveShell.tsx`: render Floating Nav after primary mobile Surface layers so it is application-level.
- Modify `app/web/src/shell/layouts/mobile/mobileFloatingNavModel.ts`: keep fixed destinations and add the Chat drawer-coupling and fullscreen-reserve helpers.
- Modify `app/web/src/shell/layouts/mobile/floatingControls.ts`: accept a reserved bottom inset in vertical bounds.
- Modify `app/web/src/styles/index.css`, `app/web/src/styles/file.css`, `app/web/src/styles/terminal.css`, and `app/web/src/styles/chat.css`: import shared styles, remove duplicated Chrome rules, position Terminal fullscreen above the keybar, and remove Preview’s Floating Nav hiding rule.
- Modify adjacent tests: `web-chat-file-peek-viewer.test.ts`, `web-terminal-components.test.tsx`, `web-terminal-workspace.test.tsx`, `web-mobile-floating-nav.test.tsx`, `web-responsive-ui-state.test.ts`, `web-responsive-shell.test.ts`, and `web-gesture-navigation.test.ts`.

### Task 1: Commit the approved product contract

**Files:**
- Create: `docs/scope/2026-07-31-mobile-surface-navigation/spec-mobile-surface-navigation.md`
- Create: `docs/scope/2026-07-31-mobile-surface-navigation/plan-mobile-surface-navigation.md`
- Create: `docs/wiki/frontend-interaction/workbench-chrome.md`
- Modify: `docs/wiki/frontend-interaction/mobile-floating-nav.md`
- Modify: `docs/wiki/frontend-interaction/frontend-interaction.md`

- [ ] **Step 1: Verify the approved documents are internally clean**

Run:

```powershell
rg -n "T[B]D|T[O]DO|i[m]plement later|f[i]ll in details" docs/scope/2026-07-31-mobile-surface-navigation docs/wiki/frontend-interaction
git diff --check
```

Expected: `rg` returns no matches in the new spec/plan/wiki content; `git diff --check` exits 0.

- [ ] **Step 2: Commit the approved contract before production changes**

```powershell
git add docs/scope/2026-07-31-mobile-surface-navigation docs/wiki/frontend-interaction/mobile-floating-nav.md docs/wiki/frontend-interaction/workbench-chrome.md docs/wiki/frontend-interaction/frontend-interaction.md
git commit -m "docs: specify mobile surface navigation"
```

Expected: one documentation commit containing the approved spec, implementation plan, and stable wiki decisions.

### Task 2: Add the shared Workbench Chrome primitive

**Files:**
- Create: `app/web/src/shell/workbench/WorkbenchChrome.tsx`
- Create: `app/web/src/styles/workbench.css`
- Create: `app/__tests__/web-workbench-chrome.test.tsx`
- Modify: `app/web/src/styles/index.css`

- [ ] **Step 1: Write the failing shared-frame tests**

Create `app/__tests__/web-workbench-chrome.test.tsx` with a real renderer test:

```tsx
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {WorkbenchChrome} from '../web/src/shell/workbench/WorkbenchChrome';

function renderChrome(fullscreen = false) {
  const onClose = jest.fn();
  const onFullscreenChange = jest.fn();
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <WorkbenchChrome
        mode="mobile"
        surfaceClassName="test-workbench"
        ariaLabel="Test workbench"
        title="Active item"
        titleTooltip="Hub A · /repo"
        closeLabel="Back to Chat"
        onClose={onClose}
        actions={<button type="button">Action</button>}
        tabsAriaLabel="Open test tabs"
        tabs={<button type="button" role="tab">Tab A</button>}
        mobileFullscreen={fullscreen}
        onMobileFullscreenChange={onFullscreenChange}
        bodyClassName="test-workbench-body"
        footer={<div className="test-footer">Footer</div>}
      >
        <div>Body</div>
      </WorkbenchChrome>,
    );
  });
  return {tree: tree!, onClose, onFullscreenChange};
}

test('renders the shared two-row mobile chrome and footer', () => {
  const {tree} = renderChrome();
  expect(tree.root.findByProps({className: 'workbench-chrome-toolbar'})).toBeTruthy();
  expect(tree.root.findByProps({role: 'tablist'}).props['aria-label']).toBe('Open test tabs');
  expect(tree.root.findByProps({className: 'workbench-chrome-title'}).children).toEqual(['Active item']);
  expect(tree.root.findByProps({className: 'test-footer'})).toBeTruthy();
});

test('requests controlled fullscreen without hiding the footer', () => {
  const {tree, onFullscreenChange} = renderChrome(true);
  const frame = tree.root.findByProps({'data-mobile-fullscreen': true});
  expect(frame).toBeTruthy();
  expect(frame.findByProps({className: 'test-footer'})).toBeTruthy();
  act(() => frame.findByProps({'aria-label': 'Exit workbench fullscreen'}).props.onClick());
  expect(onFullscreenChange).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-workbench-chrome.test.tsx
```

Expected: FAIL because `shell/workbench/WorkbenchChrome` does not exist.

- [ ] **Step 3: Implement the minimal shared frame**

Create `app/web/src/shell/workbench/WorkbenchChrome.tsx` with this public contract and structure:

```tsx
import React from 'react';
import {Icon} from '../../common/Icon';
import {DesktopDragRegion} from '../layouts/desktop/DesktopTitleBar';

export type WorkbenchChromeMode = 'desktop' | 'mobile';

export type WorkbenchChromeProps = {
  mode: WorkbenchChromeMode;
  surfaceClassName: string;
  ariaLabel: string;
  title: string;
  titleTooltip?: string;
  closeLabel: string;
  onClose: () => void;
  actions?: React.ReactNode;
  tabsAriaLabel: string;
  tabs: React.ReactNode;
  mobileFullscreen: boolean;
  onMobileFullscreenChange?: (fullscreen: boolean) => void;
  bodyClassName: string;
  footer?: React.ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  children: React.ReactNode;
};

export function WorkbenchChrome(props: WorkbenchChromeProps) {
  const fullscreen = props.mode === 'mobile' && props.mobileFullscreen;
  const toolbarContent = (
    <>
      <button type="button" className="workbench-chrome-icon-button"
        onClick={props.onClose} title={props.closeLabel} aria-label={props.closeLabel}>
        <Icon name={props.mode === 'mobile' ? 'arrowLeft' : 'x'} />
      </button>
      <div className="workbench-chrome-title" title={props.titleTooltip ?? props.title}>
        {props.title}
      </div>
      <div className="workbench-chrome-actions">{props.actions}</div>
    </>
  );
  return (
    <section className={`workbench-chrome ${props.surfaceClassName} ${props.mode}`}
      data-mobile-fullscreen={fullscreen || undefined}
      aria-label={props.ariaLabel} onKeyDown={props.onKeyDown}>
      {props.mode === 'desktop' ? (
        <DesktopDragRegion className="workbench-chrome-toolbar">{toolbarContent}</DesktopDragRegion>
      ) : <div className="workbench-chrome-toolbar">{toolbarContent}</div>}
      <div className="workbench-chrome-tabs" role="tablist" aria-label={props.tabsAriaLabel}>
        {props.tabs}
      </div>
      <div className={`workbench-chrome-body ${props.bodyClassName}`}>{props.children}</div>
      {props.footer}
      {props.mode === 'mobile' && props.onMobileFullscreenChange ? (
        <button type="button" className="workbench-chrome-fullscreen-toggle"
          onClick={() => props.onMobileFullscreenChange?.(!fullscreen)}
          title={fullscreen ? 'Exit workbench fullscreen' : 'Enter workbench fullscreen'}
          aria-label={fullscreen ? 'Exit workbench fullscreen' : 'Enter workbench fullscreen'}
          aria-pressed={fullscreen}>
          <Icon name={fullscreen ? 'panelTopOpen' : 'panelTop'} />
        </button>
      ) : null}
    </section>
  );
}
```

Create `app/web/src/styles/workbench.css` with the shared flex geometry, 32px toolbar, 34px tab row, icon button focus/hover states, truncated title, 36px bottom-right fullscreen button, and this fullscreen rule:

```css
.workbench-chrome[data-mobile-fullscreen='true'] > .workbench-chrome-toolbar,
.workbench-chrome[data-mobile-fullscreen='true'] > .workbench-chrome-tabs {
  display: none;
}
```

Import it in `app/web/src/styles/index.css` before `file.css` and `terminal.css`:

```css
@import './workbench.css';
```

- [ ] **Step 4: Run the test and type checker for GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-workbench-chrome.test.tsx
npm run tsc:web
```

Expected: the new suite passes and TypeScript exits 0.

- [ ] **Step 5: Commit the primitive**

```powershell
git add app/web/src/shell/workbench/WorkbenchChrome.tsx app/web/src/styles/workbench.css app/web/src/styles/index.css app/__tests__/web-workbench-chrome.test.tsx
git commit -m "feat(web): add shared workbench chrome"
```

### Task 3: Migrate Preview to controlled shared Chrome

**Files:**
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Test: `app/__tests__/web-workbench-chrome.test.tsx`

- [ ] **Step 1: Replace the old source assertions with failing controlled-fullscreen assertions**

In `web-chat-file-peek-viewer.test.ts`, replace the assertions for local `mobileHeaderHidden` with:

```ts
expect(chromeTsx).toContain("from '../shell/workbench/WorkbenchChrome'");
expect(chromeTsx).toContain('mobileFullscreen: boolean;');
expect(chromeTsx).toContain('onMobileFullscreenChange: (fullscreen: boolean) => void;');
expect(chromeTsx).toContain('<WorkbenchChrome');
expect(chromeTsx).toContain('mobileFullscreen={mobileFullscreen}');
expect(chromeTsx).not.toContain('useState(false)');
expect(mainTsx).toContain('const [previewWorkbenchFullscreen, setPreviewWorkbenchFullscreen] = useState(false);');
expect(mainTsx).toContain('mobileFullscreen={previewWorkbenchFullscreen}');
expect(mainTsx).toContain('onMobileFullscreenChange={setPreviewWorkbenchFullscreen}');
```

Keep the existing assertions that Preview still owns search, file-tree, actions, tabs, and Relay refresh.

- [ ] **Step 2: Run the Preview suite and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: FAIL because Preview still owns local header-hidden state and does not render `WorkbenchChrome`.

- [ ] **Step 3: Refactor Preview around the shared frame**

Change `PreviewWorkbenchChromeProps` to accept controlled state:

```tsx
mobileFullscreen: boolean;
onMobileFullscreenChange: (fullscreen: boolean) => void;
```

Keep Preview’s outside-click/Escape effect and construct feature-specific actions/tabs as nodes. Render them through:

```tsx
<WorkbenchChrome
  mode={mode}
  surfaceClassName="preview-workbench-surface chat-file-peek-surface"
  ariaLabel="Preview workbench"
  title={activeTitle}
  closeLabel={mode === 'mobile' ? 'Back to Chat' : 'Close preview'}
  onClose={onClose}
  actions={toolbarActions}
  tabsAriaLabel="Open preview tabs"
  tabs={previewTabs}
  mobileFullscreen={mobileFullscreen}
  onMobileFullscreenChange={onMobileFullscreenChange}
  bodyClassName="preview-workbench-body"
  onKeyDown={onWorkbenchKeyDown}
>
  {fileTreeToolsAndPanels}
  {children}
</WorkbenchChrome>
```

In `WorkspaceApp.tsx`, add stable owner state near the Preview workbench state and pass it to both desktop/mobile render paths:

```tsx
const [previewWorkbenchFullscreen, setPreviewWorkbenchFullscreen] = useState(false);
```

Desktop ignores the mobile state through `WorkbenchChrome`; mobile reuses the same value after hiding/showing the Surface. Remove the old `.mobile-header-hidden` and `.preview-workbench-mobile-header-toggle` rules from `file.css`; keep Preview-only tree/search/Relay refresh rules.

- [ ] **Step 4: Run Preview, shared-frame, and type tests for GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-workbench-chrome.test.tsx
npm run tsc:web
```

Expected: both suites pass and TypeScript exits 0.

- [ ] **Step 5: Commit Preview migration**

```powershell
git add app/web/src/preview/PreviewWorkbenchChrome.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "refactor(web): migrate preview to shared workbench chrome"
```

### Task 4: Unify desktop and mobile Terminal Chrome

**Files:**
- Modify: `app/web/src/terminal/TerminalWorkbench.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/terminal.css`
- Modify: `app/__tests__/web-terminal-components.test.tsx`
- Modify: `app/__tests__/web-terminal-workspace.test.tsx`

- [ ] **Step 1: Write failing behavioral tests for Terminal Chrome**

Add renderer tests in `web-terminal-components.test.tsx` that assert:

```tsx
function renderTerminalWorkbench(
  overrides: Partial<React.ComponentProps<typeof TerminalWorkbench>> = {},
) {
  const props: React.ComponentProps<typeof TerminalWorkbench> = {
    mode: 'mobile',
    terminals: [terminal()],
    activeKey: 'hub-a:t1',
    unavailableHubIds: {},
    onSelect: jest.fn(),
    onCreate: jest.fn(),
    onRequestClose: jest.fn(),
    onRestart: jest.fn(),
    onClaimResize: jest.fn(),
    onSendBytes: jest.fn(),
    onCloseSurface: jest.fn(),
    mobileFullscreen: false,
    onMobileFullscreenChange: jest.fn(),
    ...overrides,
  };
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => { tree = TestRenderer.create(<TerminalWorkbench {...props} />); });
  return {root: tree!.root, props};
}

test('uses shared two-row chrome with compact real-button tabs', () => {
  const {root} = renderTerminalWorkbench({mode: 'mobile', terminals: [terminal()]});
  expect(root.findByProps({className: 'workbench-chrome-title'}).children).toEqual(['p1']);
  const tab = root.findByProps({className: 'terminal-workbench-tab active'});
  expect(tab.props.title).toContain('hub-a');
  expect(tab.findAllByProps({className: 'terminal-workbench-tab-hub'})).toHaveLength(0);
  const close = tab.findByProps({'aria-label': 'Close terminal Project'});
  expect(close.type).toBe('button');
  expect(close.props.type).toBe('button');
});

test('keeps New and Fit visible and moves conditional Restart into More', () => {
  const onRestart = jest.fn();
  const {root} = renderTerminalWorkbench({
    terminals: [terminal({status: 'exited'})],
    onRestart,
  });
  expect(root.findByProps({'aria-label': 'Create terminal'})).toBeTruthy();
  expect(root.findByProps({'aria-label': 'Fit terminal to this screen'})).toBeTruthy();
  act(() => root.findByProps({'aria-label': 'Terminal actions'}).props.onClick());
  const restart = root.findByProps({role: 'menuitem'});
  expect(restart.children).toEqual(['Restart']);
  act(() => restart.props.onClick());
  expect(onRestart).toHaveBeenCalledTimes(1);
});

test('mobile fullscreen keeps the terminal shortcut footer mounted', () => {
  const {root} = renderTerminalWorkbench({mode: 'mobile', mobileFullscreen: true});
  expect(root.findByProps({'data-mobile-fullscreen': true})).toBeTruthy();
  expect(root.findByProps({'aria-label': 'Terminal shortcuts'})).toBeTruthy();
});
```

Add/extend a small `renderTerminalWorkbench` helper in that test file so every test uses real `TerminalWorkbench` callbacks rather than source mocks. In `web-terminal-workspace.test.tsx`, assert that desktop and mobile instances receive `mobileFullscreen` and `onMobileFullscreenChange`, and that desktop supplies a close callback.

- [ ] **Step 2: Run Terminal tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-terminal-components.test.tsx __tests__/web-terminal-workspace.test.tsx
```

Expected: FAIL because Terminal has a single mixed tabbar, nested simulated close control, and no controlled fullscreen.

- [ ] **Step 3: Refactor `TerminalWorkbench` through `WorkbenchChrome`**

Add controlled props:

```tsx
mobileFullscreen?: boolean;
onMobileFullscreenChange?: (fullscreen: boolean) => void;
```

Pass `props.mobileFullscreen ?? false` into `WorkbenchChrome`. The optional boundary keeps existing focused `TerminalWorkbench` tests and non-mobile callers concise; both real Workspace instances must pass the controlled value and setter explicitly.

Derive the title and tooltip without trimming internal values:

```tsx
const active = props.terminals.find(item => terminalKey(item) === props.activeKey);
const activeTitle = active?.projectName || active?.terminalId || 'Terminal';
const activeTooltip = active
  ? `${active.hubId} · ${active.projectName || active.terminalId} · ${active.initialCwd}`
  : 'Terminal';
```

Render each tab as sibling open/close buttons inside a tab container, matching Preview’s valid DOM pattern:

```tsx
<div key={key} role="tab" aria-selected={selected}
  className={`terminal-workbench-tab${selected ? ' active' : ''}`} title={tooltip}>
  <button type="button" className="terminal-workbench-tab-open" onClick={() => props.onSelect(key)}>
    <span className={`terminal-status ${status}`} aria-hidden="true" />
    <span className="terminal-workbench-tab-label">{item.projectName || item.terminalId}</span>
  </button>
  <button type="button" className="terminal-workbench-tab-close"
    aria-label={`Close terminal ${item.projectName || item.terminalId}`}
    onClick={() => props.onRequestClose(item)}>
    <Icon name="x" />
  </button>
</div>
```

Build toolbar actions with icon-only New and Fit buttons. Keep a local transient `actionsMenuOpen`; only render the ellipsis menu for a non-running active terminal, and close it after Restart. Pass the keybar as `footer` so shared fullscreen never hides it.

In `WorkspaceApp.tsx`, add:

```tsx
const [terminalWorkbenchFullscreen, setTerminalWorkbenchFullscreen] = useState(false);
```

Pass the state and setter to both Terminal workbench instances. For desktop `onCloseSurface`, call `setTerminalOpen(false)`; mobile keeps the same direct Chat return behavior.

Replace the single-row `.terminal-tabbar` rules with Terminal-specific styles layered onto `.workbench-chrome-*`. Define:

```css
.terminal-workbench.mobile {
  --terminal-keybar-height: calc(57px + var(--wm-safe-area-bottom));
}

.terminal-workbench.mobile .workbench-chrome-fullscreen-toggle {
  bottom: calc(var(--terminal-keybar-height) + 14px);
}
```

Keep xterm, copy menu, splitter, status colors, and keybar rules unchanged.

- [ ] **Step 4: Run Terminal and shared-frame tests for GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-terminal-components.test.tsx __tests__/web-terminal-workspace.test.tsx __tests__/web-workbench-chrome.test.tsx
npm run tsc:web
```

Expected: all listed suites pass and TypeScript exits 0.

- [ ] **Step 5: Commit Terminal unification**

```powershell
git add app/web/src/terminal/TerminalWorkbench.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/terminal.css app/__tests__/web-terminal-components.test.tsx app/__tests__/web-terminal-workspace.test.tsx
git commit -m "refactor(web): unify terminal workbench chrome"
```

### Task 5: Reserve fullscreen controls in Floating Nav geometry

**Files:**
- Modify: `app/web/src/shell/layouts/mobile/mobileFloatingNavModel.ts`
- Modify: `app/web/src/shell/layouts/mobile/floatingControls.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-mobile-floating-nav.test.tsx`
- Modify: `app/__tests__/web-responsive-ui-state.test.ts`

- [ ] **Step 1: Write failing pure geometry tests**

Extend `web-mobile-floating-nav.test.tsx`:

```ts
expect(resolveFloatingNavReservedBottomInset('chat', 20)).toBe(0);
expect(resolveFloatingNavReservedBottomInset('preview', 20)).toBe(64);
expect(resolveFloatingNavReservedBottomInset('terminal', 20)).toBe(135);
```

The values encode Preview `max(14, safe) + 36px button + 8px gap`, and Terminal `safe + 57px keybar + 14px offset + 36px button + 8px gap`.

Extend `web-responsive-ui-state.test.ts`:

```ts
expect(resolveFloatingControlAvoidanceBounds({
  defaultBounds: {minTop: 6, maxTop: 746},
  viewportHeight: 800,
  keyboardOffset: 0,
  stackHeight: 48,
  safeAreaBottomInset: 0,
  composerTop: null,
  reservedBottomInset: 64,
})).toEqual({minTop: 6, maxTop: 688});
```

- [ ] **Step 2: Run geometry tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-mobile-floating-nav.test.tsx __tests__/web-responsive-ui-state.test.ts
```

Expected: FAIL because the reserve resolver and `reservedBottomInset` input do not exist.

- [ ] **Step 3: Implement the reserve model and wire it by side**

Add to `mobileFloatingNavModel.ts`:

```ts
export const WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX = 36;
export const WORKBENCH_FULLSCREEN_NAV_GAP_PX = 8;
export const WORKBENCH_FULLSCREEN_EDGE_PX = 14;
export const TERMINAL_MOBILE_KEYBAR_BASE_HEIGHT_PX = 57;

export function resolveFloatingNavReservedBottomInset(
  current: FloatingNavDestination,
  safeAreaBottomInset: number,
): number {
  if (current === 'preview') {
    return Math.max(WORKBENCH_FULLSCREEN_EDGE_PX, safeAreaBottomInset)
      + WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX
      + WORKBENCH_FULLSCREEN_NAV_GAP_PX;
  }
  if (current === 'terminal') {
    return safeAreaBottomInset
      + TERMINAL_MOBILE_KEYBAR_BASE_HEIGHT_PX
      + WORKBENCH_FULLSCREEN_EDGE_PX
      + WORKBENCH_FULLSCREEN_BUTTON_SIZE_PX
      + WORKBENCH_FULLSCREEN_NAV_GAP_PX;
  }
  return 0;
}
```

Add optional `reservedBottomInset = 0` to `resolveFloatingControlAvoidanceBounds` and include this max-top candidate:

```ts
const reservedMaxTop = reservedBottomInset > 0
  ? viewportHeight - keyboardOffset - stackHeight - reservedBottomInset
  : defaultBounds.maxTop;
```

Clamp against `reservedMaxTop` with the viewport and composer candidates. In `WorkspaceApp.tsx`, compute the reserve from `floatingNavCurrent`, but apply it only on the right:

```tsx
reservedBottomInset: floatingControlSide === 'right'
  ? resolveFloatingNavReservedBottomInset(floatingNavCurrent, safeAreaBottomInset)
  : 0,
```

Include `floatingControlSide` and `floatingNavCurrent` in the memo dependencies so dragging across sides updates the bounds immediately.

- [ ] **Step 4: Run geometry and gesture regression tests for GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-mobile-floating-nav.test.tsx __tests__/web-responsive-ui-state.test.ts __tests__/web-gesture-navigation.test.ts
npm run tsc:web
```

Expected: all listed suites pass and TypeScript exits 0.

- [ ] **Step 5: Commit avoidance geometry**

```powershell
git add app/web/src/shell/layouts/mobile/mobileFloatingNavModel.ts app/web/src/shell/layouts/mobile/floatingControls.ts app/web/src/app/WorkspaceApp.tsx app/__tests__/web-mobile-floating-nav.test.tsx app/__tests__/web-responsive-ui-state.test.ts
git commit -m "feat(web): avoid workbench controls in floating nav"
```

### Task 6: Promote Floating Nav above every mobile Surface

**Files:**
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-responsive-shell.test.ts`
- Modify: `app/__tests__/web-mobile-floating-nav.test.tsx`
- Modify: `app/__tests__/web-gesture-navigation.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-terminal-workspace.test.tsx`

- [ ] **Step 1: Write failing application-layer and drawer-coupling tests**

In `web-responsive-shell.test.ts`, assert the application-control layer follows primary mobile Surface nodes:

```ts
const mobileStart = shellTsx.indexOf('export function MobileShell');
const mobileBody = shellTsx.slice(mobileStart, shellTsx.indexOf('export function ResponsiveShell'));
expect(mobileBody.indexOf('{floatingControlStack}')).toBeGreaterThan(mobileBody.indexOf('{mobileOverlay}'));
expect(mobileBody.indexOf('{floatingControlStack}')).toBeGreaterThan(mobileBody.indexOf('{mobileSettingsScreen}'));
expect(mobileBody).not.toContain('data-chat-preview-open={mobileOverlay');
```

In `web-mobile-floating-nav.test.tsx`, add:

```ts
expect(shouldOpenDrawerWithFloatingNav('chat')).toBe(true);
expect(shouldOpenDrawerWithFloatingNav('preview')).toBe(false);
expect(shouldOpenDrawerWithFloatingNav('terminal')).toBe(false);
expect(shouldOpenDrawerWithFloatingNav('relay')).toBe(false);
expect(shouldOpenDrawerWithFloatingNav('monitor')).toBe(false);
expect(shouldOpenDrawerWithFloatingNav('settings')).toBe(false);
```

Update source-integration assertions to require `openGestureNavigationActions(shouldOpenDrawerWithFloatingNav(floatingNavCurrent))`, `setDrawerOpen(openDrawer)`, and `setDrawerOpen(false)` at destination selection. In Preview and Terminal integration tests, require always-mounted mobile overlays:

```ts
expect(mainTsx).toContain('const chatPreviewMobileOverlay = !isWide ? (');
expect(mainTsx).toContain('hidden={!chatPreviewOpen}');
expect(mainTsx).toContain('const terminalMobileOverlay = !isWide ? (');
expect(mainTsx).toContain('hidden={!terminalOpen}');
expect(mainTsx).toContain('active={terminalOpen}');
```

- [ ] **Step 2: Run shell/navigation tests and verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-responsive-shell.test.ts __tests__/web-mobile-floating-nav.test.tsx __tests__/web-gesture-navigation.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-terminal-workspace.test.tsx
```

Expected: FAIL because the nav precedes overlays, drawer coupling is unconditional, Preview explicitly hides the nav, and Preview/Terminal unmount when closed.

- [ ] **Step 3: Implement the application-control layer**

Add to `mobileFloatingNavModel.ts`:

```ts
export function shouldOpenDrawerWithFloatingNav(current: FloatingNavDestination): boolean {
  return current === 'chat';
}
```

Move `{floatingControlStack}` in `MobileShell` after `mobileSettingsScreen`, `mobileOverlay`, body, and drawer nodes, while keeping it inside `.workspace.narrow-shell`. Remove the mobile `data-chat-preview-open` attribute. In `shell.css`, raise `.floating-control-stack-layer` above primary Surface z-index 70 using the project’s fixed mobile application-control level, while leaving confirmation dialogs, menus, and Sheets above it. Delete this rule from `chat.css`:

```css
.narrow-shell[data-chat-preview-open='true'] .floating-control-stack-layer {
  display: none;
}
```

Change the expansion helper to accept the Chat decision:

```tsx
const openGestureNavigationActions = useCallback((openDrawer: boolean) => {
  clearGestureMoveLongPressTimer();
  const nextState: GestureNavigationState = {phase: 'expanded'};
  gestureNavStateRef.current = nextState;
  setGestureNavState(nextState);
  setDrawerOpen(openDrawer);
}, [clearGestureMoveLongPressTimer, setDrawerOpen]);
```

Call it with `shouldOpenDrawerWithFloatingNav(floatingNavCurrent)`. At the start of `handleFloatingNavSelect`, close the drawer and transient navigation state before switching destination.

Also close Surface-local transient UI at that boundary while preserving work state:

```tsx
setDrawerOpen(false);
setMobileRelayTargetSheet(null);
setPreviewWorkbenchActionsMenuOpen(false);
setPreviewSelectionMenu(null);
closeMobileDrawerCompanionOverlays();
```

Do not clear Preview tabs, Terminal selection, scroll positions, or either controlled fullscreen flag.

- [ ] **Step 4: Keep Preview and Terminal mounted while mobile**

Change the outer guards from `!isWide && open ?` to `!isWide ?` and use the native `hidden` attribute:

```tsx
const chatPreviewMobileOverlay = !isWide ? (
  <div className="chat-preview-mobile-overlay" hidden={!chatPreviewOpen}
    aria-hidden={chatPreviewOpen ? undefined : true}>
    {renderPreviewWorkbenchSurface('mobile')}
  </div>
) : null;

const terminalMobileOverlay = !isWide ? (
  <div className="terminal-mobile-overlay" hidden={!terminalOpen}
    aria-hidden={terminalOpen ? undefined : true}>
    <TerminalWorkbench mode="mobile" ...>
      {activeTerminal ? <TerminalView active={terminalOpen} ... /> : null}
    </TerminalWorkbench>
  </div>
) : null;
```

Pass all mobile primary nodes in one fragment to `mobileOverlay`. This preserves Preview DOM scroll, Terminal xterm scrollback, selected tabs, and controlled fullscreen state while only one Surface is visible. Do not keep desktop and mobile TerminalView instances mounted at the same breakpoint.

- [ ] **Step 5: Run shell, navigation, Preview, and Terminal tests for GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-responsive-shell.test.ts __tests__/web-mobile-floating-nav.test.tsx __tests__/web-gesture-navigation.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-terminal-workspace.test.tsx __tests__/web-terminal-components.test.tsx
npm run tsc:web
```

Expected: all listed suites pass and TypeScript exits 0.

- [ ] **Step 6: Commit global mobile Surface navigation**

```powershell
git add app/web/src/shell/ResponsiveShell.tsx app/web/src/shell/layouts/mobile/mobileFloatingNavModel.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css app/web/src/styles/chat.css app/__tests__/web-responsive-shell.test.ts app/__tests__/web-mobile-floating-nav.test.tsx app/__tests__/web-gesture-navigation.test.ts app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-terminal-workspace.test.tsx
git commit -m "feat(web): keep mobile nav across surfaces"
```

### Task 7: Complete regression verification and visual checks

**Files:**
- Modify only if a test exposes a spec mismatch in the files already listed above.

- [ ] **Step 1: Run all focused interaction suites together**

```powershell
npm test -- --runInBand __tests__/web-workbench-chrome.test.tsx __tests__/web-mobile-floating-nav.test.tsx __tests__/web-responsive-ui-state.test.ts __tests__/web-responsive-shell.test.ts __tests__/web-gesture-navigation.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-terminal-components.test.tsx __tests__/web-terminal-workspace.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-port-relay-settings.test.ts
```

Expected: all focused suites pass with no warnings or open handles.

- [ ] **Step 2: Run the complete App verification gate**

```powershell
npm run tsc:web
npm test -- --runInBand
npm run build:web
git diff --check
```

Expected: TypeScript exits 0; all Jest suites pass; webpack production build succeeds and writes only the configured `~/.wheelmaker/web` output; diff check exits 0.

- [ ] **Step 3: Perform mobile visual/interaction verification**

Verify at a narrow viewport with safe-area emulation:

1. Chat Floating Nav opens the fixed icon card and Session drawer together.
2. Preview, Terminal, Relay, Monitor, and Settings open only the fixed icon card.
3. Selecting every destination switches Surface; selecting Chat returns; selecting the current item only collapses the card.
4. Floating Nav stays visible above each primary Surface and below confirmation dialogs and Sheets.
5. Preview/Terminal back buttons return to Chat.
6. Preview/Terminal fullscreen buttons hide and restore both Chrome rows; Terminal keybar remains.
7. Switching away and back preserves active tab, xterm scrollback, Preview scroll, and fullscreen state.
8. Left/right dragging, soft keyboard, safe-area extremes, expanded card, and right-side fullscreen controls never overlap.
9. Desktop Terminal has two Chrome rows, compact tabs, close/New/Fit/Restart behavior, and unchanged splitter/xterm behavior; no desktop Floating Nav appears.

- [ ] **Step 4: Rebase, review the final diff, and commit any test-driven corrections**

```powershell
git pull --rebase origin main
git diff --stat origin/main...HEAD
git status --short
```

Expected: rebase succeeds without semantic conflict. If Step 1–3 required corrections, stage only those correction files and commit them with:

```powershell
git add app/web/src app/__tests__
git commit -m "test(web): complete mobile surface navigation regression coverage"
```

If no correction files remain, do not create an empty commit.
