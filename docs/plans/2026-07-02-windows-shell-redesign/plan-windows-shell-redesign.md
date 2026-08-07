# Windows Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows desktop title bar and left activity bar with a frameless top-right window control menu while keeping Chat as the default desktop workspace and settings in the left sidebar.

**Architecture:** Keep the desktop shell layout split in `ResponsiveShell`, but make desktop chrome a fixed overlay instead of a layout row. Rework `DesktopTitleBar.tsx` into a reusable desktop window controls component that owns the WheelMaker menu, source panel, and native window actions. Reuse the existing `renderSettingsContent` path for the left sidebar settings replacement.

**Tech Stack:** React 19, TypeScript, webpack, Jest, react-test-renderer, CSS modules via global CSS files.

---

## File Structure

- Modify `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`: replace the titlebar UI with `DesktopWindowControls`, keep the existing SVG icon and desktop bridge calls, add the WheelMaker dropdown, source subpanel, and optional settings callback.
- Modify `app/web/src/shell/ResponsiveShell.tsx`: remove `DesktopTitleBar` from desktop shell layout, remove `desktopActivityBar`, and render a `desktopWindowControls` React node as a fixed overlay.
- Modify `app/web/src/app/WorkspaceApp.tsx`: import `DesktopWindowControls`, pass `onSettingsSelect`, remove the desktop activity bar JSX, force hidden desktop File/Git tabs back to Chat, and keep settings rendering in the left sidebar.
- Modify `app/web/src/styles/shell.css`: add fixed overlay styles for desktop controls/menu, remove titlebar layout pressure, and keep the desktop content starting at top-left.
- Modify `app/web/src/styles/settings.css`: apply mobile-like settings list/detail styling when settings render in `.workspace-left`.
- Modify `app/web/src/styles/surfaces.css` and `app/web/src/styles/file.css`: reserve right-side space in top toolbars that can sit below the fixed desktop controls.
- Modify `app/__tests__/web-desktop-titlebar.test.tsx`: update component tests for the new dropdown/source/settings behavior.
- Modify `app/__tests__/web-responsive-shell.test.ts`: update shell source-structure tests for fixed controls and no activity bar.
- Modify `app/__tests__/web-chat-ui.test.ts`: update desktop activity bar expectations so Chat/File/Git activity icons are absent and settings still replaces the left sidebar.
- Modify `app/__tests__/web-agent-package-update-settings.test.ts`, `app/__tests__/web-port-relay-settings.test.ts`, and `app/__tests__/web-skill-management-settings.test.ts`: update shortcut expectations that currently inspect `desktopActivityBar`.

---

### Task 1: Update Desktop Controls Tests

**Files:**
- Modify: `app/__tests__/web-desktop-titlebar.test.tsx`
- Test target: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`

- [x] **Step 1: Replace titlebar expectations with frameless controls expectations**

Replace the second test name and assertions with this behavior:

```tsx
test('renders frameless controls with menu, source panel, and window actions', async () => {
  const minimize = jest.fn();
  const toggleMaximize = jest.fn();
  const close = jest.fn();
  const onSettingsSelect = jest.fn();
  const getWebSourceState = jest.fn(async () => ({
    preference: 'auto',
    actualSource: 'remote',
    displayTitle: 'WheelMaker - example.com',
    displaySource: 'example.com',
    remoteUrl: 'https://example.com/',
    remoteHost: 'example.com',
  }));
  const setWebSourcePreference = jest.fn(async () => ({
    preference: 'embedded',
    actualSource: 'embedded',
    displayTitle: 'WheelMaker - Embedded',
    displaySource: 'Embedded',
    remoteUrl: '',
    remoteHost: '',
  }));
  const reload = jest.fn();
  (global as typeof globalThis & { window?: unknown }).window = {
    location: {reload},
    WheelMakerDesktop: {
      enabled: true,
      minimize,
      toggleMaximize,
      close,
      getWebSourceState,
      setWebSourcePreference,
    },
  };

  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<DesktopWindowControls onSettingsSelect={onSettingsSelect} />);
  });

  const root = renderer!.root;
  expect(root.findByProps({'data-desktop-window-controls': true})).toBeDefined();
  expect(root.findAllByProps({'data-desktop-titlebar': true})).toHaveLength(0);
  expect(root.findByProps({className: 'desktop-window-menu-button'}).findByProps({className: 'desktop-titlebar-icon'})).toBeDefined();
  expect(root.findAllByProps({className: 'desktop-titlebar-title-group'})).toHaveLength(0);

  const menuButton = root.findByProps({className: 'desktop-window-menu-button'});
  expect(menuButton.props['aria-expanded']).toBe(false);
  await ReactTestRenderer.act(async () => {
    menuButton.props.onClick();
  });
  expect(root.findByProps({className: 'desktop-window-menu'}).props.role).toBe('menu');

  const menuItems = root.findAllByProps({className: 'desktop-window-menu-item'});
  expect(menuItems.map(item => item.props.children).flat().filter(Boolean).join(' ')).toContain('显示来源');
  expect(menuItems.map(item => item.props.children).flat().filter(Boolean).join(' ')).toContain('设置');

  await ReactTestRenderer.act(async () => {
    menuItems[0].props.onClick();
  });
  expect(root.findByProps({className: 'desktop-window-source-panel'})).toBeDefined();
  expect(root.findByProps({className: 'desktop-window-source-current'}).props.title).toBe('https://example.com/');
  const sourceRefreshButton = root.findByProps({className: 'desktop-window-source-refresh'});
  sourceRefreshButton.props.onClick();
  expect(reload).toHaveBeenCalledTimes(1);

  const sourceItems = root.findAllByProps({className: 'desktop-window-source-choice'});
  expect(sourceItems.map(item => item.props.children)).toEqual(['example.com', 'Embedded']);
  await ReactTestRenderer.act(async () => {
    await sourceItems[1].props.onClick();
  });
  expect(setWebSourcePreference).toHaveBeenCalledWith('embedded');
  expect(reload).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    menuButton.props.onClick();
  });
  const settingsItem = root.findAllByProps({className: 'desktop-window-menu-item'}).find(item =>
    item.props['aria-label'] === 'Open settings',
  );
  expect(settingsItem).toBeDefined();
  settingsItem!.props.onClick();
  expect(onSettingsSelect).toHaveBeenCalledTimes(1);

  const buttons = root.findAllByType('button');
  expect(buttons.map(button => button.props['aria-label']).filter(Boolean)).toEqual(
    expect.arrayContaining([
      'WheelMaker menu',
      'Show source',
      'Refresh web source',
      'Open settings',
      'Minimize',
      'Maximize or restore',
      'Close',
    ]),
  );

  root.findByProps({'aria-label': 'Minimize'}).props.onClick();
  root.findByProps({'aria-label': 'Maximize or restore'}).props.onClick();
  root.findByProps({'aria-label': 'Close'}).props.onClick();

  expect(minimize).toHaveBeenCalled();
  expect(toggleMaximize).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});
```

Also update the first and third tests to import and render `DesktopWindowControls`:

```tsx
import { DesktopWindowControls } from '../web/src/shell/layouts/desktop/DesktopTitleBar';

renderer = ReactTestRenderer.create(<DesktopWindowControls />);
```

For the embedded-source test, assert plain source text inside the source panel:

```tsx
await ReactTestRenderer.act(async () => {
  root.findByProps({className: 'desktop-window-menu-button'}).props.onClick();
});
await ReactTestRenderer.act(async () => {
  root.findByProps({className: 'desktop-window-menu-item'}).props.onClick();
});
expect(root.findByProps({className: 'desktop-window-source-current'}).props.children).toBe('Embedded');
expect(root.findAllByProps({className: 'desktop-window-source-choice'})).toHaveLength(0);
expect(root.findAllByProps({className: 'desktop-window-source-refresh'})).toHaveLength(0);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-desktop-titlebar.test.tsx
```

Expected: FAIL because `DesktopWindowControls`, `desktop-window-controls`, `desktop-window-menu-button`, and the source panel classes do not exist yet.

- [x] **Step 3: Commit the failing test**

```powershell
git add app/__tests__/web-desktop-titlebar.test.tsx
git commit -m "test: specify frameless desktop window controls"
```

---

### Task 2: Implement Frameless Desktop Window Controls

**Files:**
- Modify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`
- Test: `app/__tests__/web-desktop-titlebar.test.tsx`

- [x] **Step 1: Replace titlebar implementation with `DesktopWindowControls`**

In `DesktopTitleBar.tsx`, keep `DesktopTitleBarIcon`, `invokeDesktopAction`, and the existing desktop web source imports. Replace `DesktopTitleBarProps` and `DesktopTitleBar` with these types and component body:

```tsx
type DesktopWindowControlsProps = {
  onSettingsSelect?: () => void;
};

type DesktopSourcePreference = 'auto' | 'embedded';

function isDesktopWindowControlsTarget(target: EventTarget | null) {
  const targetElement = target as { closest?: (selector: string) => Element | null } | null;
  return typeof targetElement?.closest === 'function'
    && Boolean(targetElement.closest('[data-desktop-window-menu-root]'));
}

export function DesktopWindowControls({ onSettingsSelect }: DesktopWindowControlsProps) {
  const bridge = getDesktopWindowBridge();
  const [webSourceState, setWebSourceState] = useState<DesktopWebSourceState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readDesktopWebSourceState().then(state => {
      if (!cancelled) {
        setWebSourceState(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const closeMenu = (event: PointerEvent) => {
      if (isDesktopWindowControlsTarget(event.target)) {
        return;
      }
      setMenuOpen(false);
      setSourcePanelOpen(false);
    };
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  if (!bridge) {
    return null;
  }

  const actualSourceLabel = webSourceState?.displaySource || '';
  const hasRemoteWebSource = Boolean(webSourceState?.remoteUrl && webSourceState.remoteHost && bridge.setWebSourcePreference);
  const remoteSourceLabel = webSourceState?.remoteHost || webSourceState?.displaySource || 'Auto';
  const sourceTitle = webSourceState?.remoteUrl || actualSourceLabel;

  const handleWebSourcePreferenceSelect = async (preference: DesktopSourcePreference) => {
    const nextState = await setDesktopWebSourcePreference(preference);
    if (nextState) {
      setWebSourceState(nextState);
    }
    window.location.reload();
  };

  const handleWebSourceRefresh = () => {
    window.location.reload();
  };

  const handleSettingsSelect = () => {
    setMenuOpen(false);
    setSourcePanelOpen(false);
    onSettingsSelect?.();
  };

  return (
    <div className="desktop-window-controls" data-desktop-window-controls={true}>
      <div className="desktop-window-menu-root" data-desktop-window-menu-root={true}>
        <button
          type="button"
          className="desktop-window-menu-button"
          aria-label="WheelMaker menu"
          title="WheelMaker"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen(open => {
              if (open) {
                setSourcePanelOpen(false);
              }
              return !open;
            });
          }}
        >
          <DesktopTitleBarIcon />
        </button>
        {menuOpen ? (
          <div className="desktop-window-menu" role="menu">
            <button
              type="button"
              className="desktop-window-menu-item"
              role="menuitem"
              aria-label="Show source"
              aria-expanded={sourcePanelOpen}
              onClick={() => setSourcePanelOpen(open => !open)}
            >
              <span className="codicon codicon-server-process" aria-hidden="true" />
              <span>显示来源</span>
              <span className={`codicon ${sourcePanelOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden="true" />
            </button>
            {sourcePanelOpen && webSourceState ? (
              <div className="desktop-window-source-panel">
                <div className="desktop-window-source-current" title={sourceTitle}>
                  {actualSourceLabel}
                </div>
                {hasRemoteWebSource ? (
                  <>
                    <button
                      type="button"
                      className="desktop-window-source-refresh"
                      aria-label="Refresh web source"
                      title="Refresh web source"
                      onClick={handleWebSourceRefresh}
                    >
                      <span className="codicon codicon-refresh" aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      className="desktop-window-source-choice"
                      role="menuitemradio"
                      aria-checked={webSourceState.preference === 'auto'}
                      title={webSourceState.remoteUrl}
                      onClick={() => void handleWebSourcePreferenceSelect('auto')}
                    >
                      {remoteSourceLabel}
                    </button>
                    <button
                      type="button"
                      className="desktop-window-source-choice"
                      role="menuitemradio"
                      aria-checked={webSourceState.preference === 'embedded'}
                      onClick={() => void handleWebSourcePreferenceSelect('embedded')}
                    >
                      Embedded
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            {onSettingsSelect ? (
              <button
                type="button"
                className="desktop-window-menu-item"
                role="menuitem"
                aria-label="Open settings"
                onClick={handleSettingsSelect}
              >
                <span className="codicon codicon-settings-gear" aria-hidden="true" />
                <span>设置</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => invokeDesktopAction(bridge.minimize)}
      >
        <span className="codicon codicon-chrome-minimize" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button"
        aria-label="Maximize or restore"
        title="Maximize or restore"
        onClick={() => invokeDesktopAction(bridge.toggleMaximize)}
      >
        <span className="codicon codicon-chrome-maximize" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="desktop-titlebar-button desktop-titlebar-close"
        aria-label="Close"
        title="Close"
        onClick={() => invokeDesktopAction(bridge.close)}
      >
        <span className="codicon codicon-chrome-close" aria-hidden="true" />
      </button>
    </div>
  );
}
```

Remove `DesktopTitleBarProps`, `isDesktopTitleBarInteractiveTarget`, `suppressNextDoubleClickRef`, `handleDragMouseDown`, `handleDragDoubleClick`, and the old title/source rendering inside `.desktop-titlebar`.

- [x] **Step 2: Run the focused test to verify it passes**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-desktop-titlebar.test.tsx
```

Expected: PASS.

- [x] **Step 3: Commit implementation**

```powershell
git add app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx app/__tests__/web-desktop-titlebar.test.tsx
git commit -m "feat: add frameless desktop window controls"
```

---

### Task 3: Move Desktop Chrome Out Of Layout Flow

**Files:**
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-responsive-shell.test.ts`

- [x] **Step 1: Update responsive shell tests first**

In `web-responsive-shell.test.ts`, replace titlebar/activity expectations with these assertions:

```ts
expect(shellTsx).not.toContain("import { DesktopTitleBar } from './layouts/desktop/DesktopTitleBar';");
expect(shellTsx).toContain('desktopWindowControls: ReactNode;');
expect(shellTsx).not.toContain('desktopActivityBar: ReactNode;');
expect(shellTsx).not.toContain('<DesktopTitleBar title="WheelMaker" />');
expect(shellTsx).toMatch(
  /export function DesktopShell[\s\S]*?desktopWindowControls[\s\S]*?className=\{`workspace theme-\$\{themeMode\}`\}[\s\S]*?\{desktopWindowControls\}[\s\S]*?<div[\s\S]*?className="desktop-shell"[\s\S]*?<aside className="workspace-left">\{sidebar\}<\/aside>/,
);
```

In the app delegation test, replace:

```ts
expect(mainTsx).toContain('desktopActivityBar={desktopActivityBar}');
```

with:

```ts
expect(mainTsx).toContain('desktopWindowControls={desktopWindowControls}');
expect(mainTsx).not.toContain('desktopActivityBar={desktopActivityBar}');
```

Replace the connection-screen test with:

```ts
test('connection screen keeps frameless desktop controls available', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

  expect(mainTsx).toContain("import { DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';");

  const disconnectedStart = mainTsx.indexOf('if (!connected && !keepWorkspaceVisible)');
  const disconnectedEnd = mainTsx.indexOf('const projectMenu', disconnectedStart);
  expect(disconnectedStart).toBeGreaterThanOrEqual(0);
  expect(disconnectedEnd).toBeGreaterThan(disconnectedStart);
  const disconnectedReturn = mainTsx.slice(disconnectedStart, disconnectedEnd);

  expect(disconnectedReturn).toContain('<DesktopWindowControls />');
  expect(disconnectedReturn).not.toContain('<DesktopTitleBar title="WheelMaker" />');
  expect(disconnectedReturn).toMatch(
    /className=\{`page theme-\$\{themeMode\}`\}[\s\S]*?<DesktopWindowControls \/>[\s\S]*?<div className="connect">/,
  );
});
```

- [x] **Step 2: Run the focused shell test to verify it fails**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts
```

Expected: FAIL because `ResponsiveShell` still imports `DesktopTitleBar`, still expects `desktopActivityBar`, and the connection screen still renders `<DesktopTitleBar title="WheelMaker" />`.

- [x] **Step 3: Modify `ResponsiveShell.tsx`**

Apply these changes:

```tsx
import React, { type ReactNode } from 'react';
import type { LayoutMode } from './state/responsiveLayout';
```

Remove:

```tsx
import { DesktopTitleBar } from './layouts/desktop/DesktopTitleBar';
```

Change `DesktopShellProps`:

```tsx
export type DesktopShellProps = ShellContentProps & {
  desktopWindowControls: ReactNode;
  desktopPeek: ReactNode;
  desktopChatFixedPreview: boolean;
  sidebarCollapsed: boolean;
  desktopSidebarWidth: number;
};
```

Change `DesktopShell` parameters and JSX:

```tsx
export function DesktopShell({
  themeMode,
  setiFontCss,
  desktopWindowControls,
  desktopPeek,
  desktopChatFixedPreview,
  sidebar,
  main,
  sidebarCollapsed,
  desktopSidebarWidth,
}: DesktopShellProps) {
  return (
    <div className={`workspace theme-${themeMode}`}>
      {setiFontCss ? <style>{setiFontCss}</style> : null}
      {desktopWindowControls}
      <div
        className="desktop-shell"
        data-chat-fixed-preview={desktopChatFixedPreview ? 'true' : undefined}
        style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as React.CSSProperties}
      >
        <div className="body">
          {!sidebarCollapsed ? (
            <aside className="workspace-left">{sidebar}</aside>
          ) : null}
          <main className="workspace-right">{main}</main>
          {desktopPeek}
        </div>
      </div>
    </div>
  );
}
```

- [x] **Step 4: Modify `WorkspaceApp.tsx` imports and connection screen**

Replace the desktop chrome import:

```tsx
import { DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';
```

Replace disconnected render chrome:

```tsx
<DesktopWindowControls />
```

- [x] **Step 5: Replace ResponsiveShell prop**

Before the final return, add:

```tsx
const desktopWindowControls = isWide ? (
  <DesktopWindowControls onSettingsSelect={handleDesktopSettingsSelect} />
) : null;
```

In `<ResponsiveShell />`, replace:

```tsx
desktopActivityBar={desktopActivityBar}
```

with:

```tsx
desktopWindowControls={desktopWindowControls}
```

- [x] **Step 6: Run the focused shell test to verify it passes**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit shell refactor**

```powershell
git add app/web/src/shell/ResponsiveShell.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-responsive-shell.test.ts
git commit -m "feat: move desktop controls out of shell layout"
```

---

### Task 4: Hide Desktop Activity Navigation And Keep Desktop On Chat

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-port-relay-settings.test.ts`
- Modify: `app/__tests__/web-skill-management-settings.test.ts`

- [x] **Step 1: Update source-structure tests for no activity bar**

In `web-chat-ui.test.ts`, replace the block that extracts `const desktopActivityBar = isWide ? (` with assertions for absence and for settings still replacing the sidebar:

```ts
expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
expect(mainTsx).not.toContain('className="desktop-activity-bar"');
expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('chat')}");
expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('file')}");
expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('git')}");
expect(mainTsx).toContain('const handleDesktopSettingsSelect = useCallback(() => {');
expect(mainTsx).toContain('const desktopWindowControls = isWide ? (');
expect(mainTsx).toContain('<DesktopWindowControls onSettingsSelect={handleDesktopSettingsSelect} />');
expect(mainTsx).toContain('const wideSidebarMain = sidebarSettingsOpen');
expect(mainTsx).toContain("? renderSettingsContent(false, { hideDetailHeader: isSettingsPeerDetail(settingsDetailView) })");
```

In `web-agent-package-update-settings.test.ts`, `web-port-relay-settings.test.ts`, and `web-skill-management-settings.test.ts`, replace activity-bar slicing with direct assertions that the settings peers remain reachable through functions and no longer through activity buttons:

```ts
expect(mainTsx).toContain("openSettingsPeer('update')");
expect(mainTsx).toContain("openSettingsPeer('tokenStats')");
expect(mainTsx).toContain("openSettingsPeer('skills')");
expect(mainTsx).toContain('const desktopWindowControls = isWide ? (');
expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
expect(mainTsx).not.toContain('className="desktop-activity-bar"');
```

Use only the peer IDs relevant to each test file. For `web-port-relay-settings.test.ts`, assert `handleDesktopPortRelaySelect` still calls `openSettingsPeer('portRelay')`.

- [x] **Step 2: Run affected tests to verify they fail**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-skill-management-settings.test.ts
```

Expected: FAIL because `desktopActivityBar` still exists and desktop File/Git buttons are still present.

- [x] **Step 3: Remove desktop activity bar JSX from `WorkspaceApp.tsx`**

Delete from this line:

```tsx
const isShortcutSettingsDetailActive = sidebarSettingsOpen && isSettingsPeerDetail(settingsDetailView);
```

through the matching end of the `desktopActivityBar` assignment:

```tsx
) : null;
```

The deleted range must include the `<nav className="desktop-activity-bar" aria-label="Workspace navigation">` element and every button inside it.

Keep `refreshButtonContent` because mobile drawer refresh still uses it. Remove `isShortcutSettingsDetailActive` if no other reference remains.

- [x] **Step 4: Keep desktop surfaces on Chat when persisted tab is File/Git**

After `handleDesktopSettingsSelect`, add this effect:

```tsx
useEffect(() => {
  if (!isWide || tab === 'chat') {
    return;
  }
  setTab('chat');
  setSidebarCollapsed(false);
}, [isWide, setSidebarCollapsed, setTab, tab]);
```

This preserves mobile File/Git behavior while forcing the Windows desktop wide layout back to Chat when an old persisted tab value is loaded.

- [x] **Step 5: Run affected tests to verify they pass**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-skill-management-settings.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit navigation removal**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-ui.test.ts app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-port-relay-settings.test.ts app/__tests__/web-skill-management-settings.test.ts
git commit -m "feat: hide desktop activity navigation"
```

---

### Task 5: Style Frameless Controls And Top Toolbar Avoidance

**Files:**
- Modify: `app/web/src/styles/shell.css`
- Modify: `app/web/src/styles/surfaces.css`
- Modify: `app/web/src/styles/file.css`
- Test: `app/__tests__/web-responsive-shell.test.ts`
- Test: `app/__tests__/web-chat-ui.test.ts`

- [x] **Step 1: Add CSS assertions first**

In `web-responsive-shell.test.ts`, add these assertions to the shell structure test or the sidebar style test:

```ts
expect(stylesCss).toContain('.desktop-window-controls {');
expect(stylesCss).toMatch(
  /\.desktop-window-controls \{[\s\S]*position: fixed;[\s\S]*top: 0;[\s\S]*right: 0;[\s\S]*z-index: 80;[\s\S]*\}/,
);
expect(stylesCss).toContain('.desktop-window-menu {');
expect(stylesCss).toContain('.desktop-window-source-panel {');
expect(stylesCss).not.toMatch(/\.desktop-titlebar \{[\s\S]*flex: 0 0 32px;[\s\S]*\}/);
```

In `web-chat-ui.test.ts`, replace the old activity bar style assertions with:

```ts
expect(stylesCss).not.toContain('.desktop-activity-bar {');
expect(stylesCss).not.toContain('.desktop-activity-button {');
expect(stylesCss).toContain('--desktop-window-controls-width: 176px;');
expect(stylesCss).toContain('.desktop-shell .workspace-right .chat-title-bar {');
```

- [x] **Step 2: Run CSS-focused tests to verify they fail**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts __tests__/web-chat-ui.test.ts
```

Expected: FAIL because the new CSS classes and toolbar avoidance rules do not exist yet.

- [x] **Step 3: Replace titlebar/activity styles in `shell.css`**

Remove the `.desktop-titlebar`, `.desktop-titlebar-drag-region`, `.desktop-titlebar-title`, `.desktop-titlebar-title-group`, `.desktop-titlebar-source-*`, `.desktop-activity-bar`, `.desktop-activity-primary`, `.desktop-activity-secondary`, and `.desktop-activity-button*` blocks.

Keep `.desktop-titlebar-icon`, `.desktop-titlebar-button`, and `.desktop-titlebar-close`, then add:

```css
.workspace {
  --desktop-window-controls-width: 176px;
}

.desktop-window-controls {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 80;
  height: 32px;
  display: inline-flex;
  align-items: stretch;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--bg) 76%, var(--panel));
  color: var(--text);
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.theme-light .desktop-window-controls {
  background: color-mix(in srgb, var(--panel) 86%, var(--panel-3));
}

.desktop-window-menu-root {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
}

.desktop-window-menu-button {
  width: 38px;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: color-mix(in srgb, var(--text) 82%, var(--muted));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.desktop-window-menu-button:hover,
.desktop-window-menu-button[aria-expanded='true'] {
  background: var(--hover);
  color: var(--text);
}

.desktop-window-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 82;
  width: 224px;
  max-width: calc(100vw - 12px);
  padding: 5px;
  border: 1px solid color-mix(in srgb, var(--border) 86%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 94%, var(--bg));
  box-shadow: 0 16px 38px color-mix(in srgb, #000 34%, transparent);
}

.theme-light .desktop-window-menu {
  background: color-mix(in srgb, var(--panel) 96%, #ffffff);
  box-shadow: 0 12px 28px color-mix(in srgb, #000 16%, transparent);
}

.desktop-window-menu-item,
.desktop-window-source-refresh,
.desktop-window-source-choice {
  width: 100%;
  min-height: 30px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: color-mix(in srgb, var(--text) 86%, var(--muted));
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.desktop-window-source-refresh,
.desktop-window-source-choice {
  grid-template-columns: 18px minmax(0, 1fr);
}

.desktop-window-source-choice {
  display: flex;
  justify-content: flex-start;
}

.desktop-window-menu-item:hover,
.desktop-window-menu-item:focus-visible,
.desktop-window-source-refresh:hover,
.desktop-window-source-refresh:focus-visible,
.desktop-window-source-choice:hover,
.desktop-window-source-choice:focus-visible,
.desktop-window-source-choice[aria-checked='true'] {
  background: var(--hover);
  color: var(--text);
  outline: none;
}

.desktop-window-source-panel {
  margin: 4px 0 5px;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--panel-2) 82%, transparent);
  display: grid;
  gap: 3px;
}

.desktop-window-source-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px 5px;
  color: color-mix(in srgb, var(--text) 72%, var(--muted));
  font-size: 11px;
}
```

- [x] **Step 4: Add top toolbar avoidance rules**

In `surfaces.css`, after `.block-title` add:

```css
.desktop-shell .workspace-right .block-title {
  padding-right: calc(var(--desktop-window-controls-width) + 10px);
}

.desktop-shell .workspace-right .chat-title-bar {
  padding-right: calc(var(--desktop-window-controls-width) + 10px);
}
```

In `file.css`, after `.preview-workbench-toolbar` add:

```css
.desktop-shell .preview-workbench-surface.desktop .preview-workbench-toolbar {
  padding-right: calc(var(--desktop-window-controls-width) + 10px);
}
```

- [x] **Step 5: Run CSS-focused tests to verify they pass**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts __tests__/web-chat-ui.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit CSS changes**

```powershell
git add app/web/src/styles/shell.css app/web/src/styles/surfaces.css app/web/src/styles/file.css app/__tests__/web-responsive-shell.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "style: support frameless desktop chrome"
```

---

### Task 6: Reuse Mobile Settings Styling In Desktop Sidebar

**Files:**
- Modify: `app/web/src/styles/settings.css`
- Test: `app/__tests__/web-responsive-shell.test.ts`

- [x] **Step 1: Add settings sidebar style assertions**

In `web-responsive-shell.test.ts`, add:

```ts
expect(stylesCss).toContain('.workspace-left .settings-list {');
expect(stylesCss).toContain('.workspace-left .settings-section-rows {');
expect(stylesCss).toContain('.workspace-left .settings-row {');
expect(stylesCss).toContain('.workspace-left .settings-detail-page {');
expect(stylesCss).toContain('.workspace-left .settings-detail-header {');
```

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts
```

Expected: FAIL because desktop sidebar settings do not yet have the mobile-style scoped rules.

- [x] **Step 3: Add desktop-sidebar settings rules**

In `settings.css`, after the `.mobile-settings-screen .settings-detail-body` block, add:

```css
.workspace-left .settings-list {
  overflow: visible;
  gap: 18px;
  padding: 0 10px 16px;
}

.workspace-left .settings-section-rows {
  border-radius: 12px;
}

.workspace-left .settings-row {
  min-height: 56px;
  margin: 0;
  padding: 0 16px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  border-radius: 0;
  background: transparent;
  font-size: 14px;
}

.workspace-left .settings-row > span:first-child > .codicon:first-child,
.workspace-left .settings-row-icon {
  font-size: 16px;
  width: 20px;
}

.workspace-left .settings-row:hover {
  background: var(--hover);
}

.workspace-left .sidebar-setting-select {
  max-width: min(48vw, 200px);
  border-radius: 999px;
  font-size: 13px;
  padding: 5px 10px;
}

.workspace-left .settings-detail-page {
  padding: 0 8px 8px;
}

.workspace-left .settings-detail-header {
  padding: 6px 4px 8px;
}

.workspace-left .settings-detail-title {
  font-size: 15px;
}

.workspace-left .settings-detail-body {
  padding: 4px 2px 16px;
  gap: 12px;
}
```

- [x] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-responsive-shell.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit settings styling**

```powershell
git add app/web/src/styles/settings.css app/__tests__/web-responsive-shell.test.ts
git commit -m "style: align desktop sidebar settings with mobile"
```

---

### Task 7: Final Verification And Publish Gate

**Files:**
- Verify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`
- Verify: `app/web/src/shell/ResponsiveShell.tsx`
- Verify: `app/web/src/app/WorkspaceApp.tsx`
- Verify: `app/web/src/styles/*.css`
- Verify: `app/__tests__/*.test.ts`

- [x] **Step 1: Run focused tests**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-desktop-titlebar.test.tsx __tests__/web-responsive-shell.test.ts __tests__/web-chat-ui.test.ts __tests__/web-agent-package-update-settings.test.ts __tests__/web-port-relay-settings.test.ts __tests__/web-skill-management-settings.test.ts
```

Expected: PASS.

- [x] **Step 2: Run TypeScript verification**

Run:

```powershell
cd app
npm run tsc:web
```

Expected: PASS with no TypeScript errors.

- [x] **Step 3: Run production web build**

Run:

```powershell
cd app
npm run build:web
```

Expected: PASS and webpack emits the web bundle.

- [x] **Step 4: Run git status review**

Run:

```powershell
git status --short
```

Expected: only intentional files from this plan are modified after the last task commit; no generated `dist` output is tracked.

- [x] **Step 5: Completion gate**

Run exactly from repo root:

```powershell
git add -A
git commit -m "feat: redesign windows desktop shell"
git push origin <current-branch>
```

Expected: commit succeeds if any uncommitted plan or implementation changes remain; push succeeds to the current branch. If `git commit` reports no changes, keep the earlier task commits and continue to `git push origin <current-branch>`.
