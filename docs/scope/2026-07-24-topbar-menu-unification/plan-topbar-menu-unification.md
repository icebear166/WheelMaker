# 顶栏与菜单统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PC Chat 顶栏改为 WheelMaker 应用菜单、弹性 Project 和不可压缩 Hubs，并使顶栏菜单及 Hubs 管理面板使用一致的烟熏半实底视觉语言。

**Architecture:** 新增 `DesktopAppMenu` 承接原 Windows 扩展菜单的 Dev Mode、Desktop 更新和 Local Dev 对话框，同时接收 Workspace 传入的 Settings 导航回调；右上角 `DesktopWindowControls` 因此只保留窗口控制。`WorkspaceApp` 仅在 PC 左段渲染此应用菜单，移动端继续使用现有 Workspace/Prompt 顶栏与直接 Settings 入口。所有顶栏菜单添加共享 `topbar-menu-surface` 类，Hubs 继续在原有数据和偏好状态上重排其呈现与嵌套配色菜单。

**Tech Stack:** React 19、TypeScript、全局 CSS tokens、Jest 30、react-test-renderer。

---

## 文件结构

- Create: `app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx` — PC 左段 WheelMaker 菜单、Settings 转发、Dev Mode、Desktop 更新和 Local Dev 对话框。
- Modify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx` — 删除已迁移的 Windows 扩展菜单状态与 UI，只保留窗口控制和拖拽区域。
- Modify: `app/web/src/app/WorkspaceApp.tsx` — 在 PC 顶栏接入应用菜单，保留移动端 Settings；将 Hubs 配色子菜单迁移到退场状态机并重排 Hub 行。
- Modify: `app/web/src/styles/shell.css` — 定义共享顶栏菜单外壳与应用菜单触发器/菜单行样式，移除旧 Windows 扩展菜单规则。
- Modify: `app/web/src/styles/chat.css` — 调整 Project 弹性与文字层级，将 Project/Prompt/Hubs/配色子菜单接入共享外壳，并重排 Hubs 层级样式。
- Modify: `app/__tests__/web-desktop-titlebar.test.tsx` — 将 Windows 扩展菜单的交互覆盖迁移到 `DesktopAppMenu`，断言窗口控制不再重复展示扩展入口。
- Modify: `app/__tests__/web-chat-ui.test.ts` — 固化 PC/移动端顶栏分支、Project 布局、Hubs 层级和共享菜单外壳的源码/CSS 契约。

### Task 1: Consolidate Desktop actions into the WheelMaker application menu

**Files:**

- Create: `app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx`
- Modify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx:1-255`
- Modify: `app/web/src/styles/shell.css:1605-1680,1817-1830`
- Test: `app/__tests__/web-desktop-titlebar.test.tsx:1-335`

- [ ] **Step 1: Write the failing component tests for the application menu and simplified window controls.**

  Import `DesktopAppMenu` from its new file, retain `DesktopWindowControls`, and add a Settings-first menu test. Move the current Dev Mode, update check, retry, update-launch-failure and Local Dev dialog test cases to render `DesktopAppMenu` and open it through `aria-label="Open WheelMaker menu"`.

  ```tsx
  import {DesktopAppMenu} from '../web/src/shell/layouts/desktop/DesktopAppMenu';
  import {DesktopDragRegion, DesktopWindowControls} from '../web/src/shell/layouts/desktop/DesktopTitleBar';

  test('opens a Settings-first WheelMaker menu and keeps native actions conditional', async () => {
    const onOpenSettings = jest.fn();
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, requestLocalDevMode: jest.fn()},
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopAppMenu onOpenSettings={onOpenSettings} />);
    });
    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({'aria-label': 'Open WheelMaker menu'}).props.onClick();
    });

    const actions = root.findAll(node => typeof node.props['data-desktop-app-action'] === 'string');
    expect(actions.map(action => action.props['data-desktop-app-action'])).toEqual(['settings', 'local-dev']);
    await ReactTestRenderer.act(async () => {
      root.findByProps({'data-desktop-app-action': 'settings'}).props.onClick();
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  test('renders window controls without a duplicate extensions trigger', async () => {
    (global as typeof globalThis & {window?: unknown}).window = {
      WheelMakerDesktop: {enabled: true, minimize: jest.fn(), toggleMaximize: jest.fn(), close: jest.fn()},
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DesktopWindowControls />);
    });
    const labels = renderer!.root.findAllByType('button').map(button => button.props['aria-label']).filter(Boolean);
    expect(labels).toEqual(['Minimize', 'Maximize or restore', 'Close']);
    expect(renderer!.root.findAllByProps({'aria-label': 'Windows extensions'})).toHaveLength(0);
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails because the new application menu does not exist.**

  Run: `npm test -- --runInBand __tests__/web-desktop-titlebar.test.tsx`

  Expected: FAIL with `DesktopAppMenu` export/module resolution errors and old `Windows extensions` expectations.

- [ ] **Step 3: Create `DesktopAppMenu` and move the existing native action state into it.**

  Move the update check, update request, Dev Mode selection and Local Dev dialog logic currently owned by `DesktopWindowControls` into the new component. The browser build must still render the Settings menu item even when `getDesktopWindowBridge()` returns `null`; Dev Mode and Desktop update rows remain conditional on the same bridge capabilities as today.

  ```tsx
  // app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx
  import React, {useCallback, useEffect, useRef, useState} from 'react';
  import {SessionIcon} from '../../../chat/sessionlist/SessionIcon';
  import {useMenuExitFlag} from '../../../chat/sessionlist/menuExit';
  import {checkDesktopUpdate, type DesktopUpdateCheck} from '../../../platform/desktop/desktopUpdate';
  import {getDesktopWindowBridge, openLocalDevPanelEvent} from '../../../platform/desktop/desktopRuntime';

  type DesktopAppMenuProps = {onOpenSettings: () => void};

  export function DesktopAppMenu({onOpenSettings}: DesktopAppMenuProps) {
    const bridge = getDesktopWindowBridge();
    const [menuOpen, setMenuOpen, menuExiting] = useMenuExitFlag();
    const [localDevDialogOpen, setLocalDevDialogOpen] = useState(false);
    const [localDevSource, setLocalDevSource] = useState('');
    const [localDevError, setLocalDevError] = useState('');
    const [localDevBusy, setLocalDevBusy] = useState(false);
    const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateCheck>({status: 'checking'});
    const [desktopUpdateBusy, setDesktopUpdateBusy] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const canUpdateDesktop = Boolean(bridge?.getDesktopUpdateInfo && bridge.requestDesktopUpdate && !bridge.localDev);

    const refreshDesktopUpdate = useCallback(async () => {
      if (!bridge || !canUpdateDesktop) return;
      setDesktopUpdate({status: 'checking'});
      setDesktopUpdate(await checkDesktopUpdate(bridge));
    }, [bridge, canUpdateDesktop]);

    useEffect(() => { void refreshDesktopUpdate(); }, [refreshDesktopUpdate]);
    useEffect(() => {
      if (!menuOpen) return;
      const closeForOutsidePress = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
      };
      const closeForEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setMenuOpen(false);
      };
      window.addEventListener('pointerdown', closeForOutsidePress);
      window.addEventListener('keydown', closeForEscape);
      return () => {
        window.removeEventListener('pointerdown', closeForOutsidePress);
        window.removeEventListener('keydown', closeForEscape);
      };
    }, [menuOpen, setMenuOpen]);

    const selectLocalDev = () => {
      setMenuOpen(false);
      if (!bridge) return;
      if (bridge.localDev) {
        window.dispatchEvent?.(new Event(openLocalDevPanelEvent));
        return;
      }
      setLocalDevError('');
      setLocalDevDialogOpen(true);
    };
    const enterLocalDev = async () => {
      const sourcePath = localDevSource.trim();
      if (!sourcePath || localDevBusy) {
        if (!sourcePath) setLocalDevError('Enter the WheelMaker source directory.');
        return;
      }
      setLocalDevError('');
      setLocalDevBusy(true);
      try {
        await bridge?.requestLocalDevMode?.(sourcePath);
      } catch (error) {
        setLocalDevError(error instanceof Error ? error.message : String(error));
      } finally {
        setLocalDevBusy(false);
      }
    };
    const selectDesktopUpdate = async () => {
      if (desktopUpdateBusy) return;
      if (desktopUpdate.status === 'failed') {
        await refreshDesktopUpdate();
        return;
      }
      if (desktopUpdate.status !== 'available' || !bridge?.requestDesktopUpdate) return;
      setDesktopUpdateBusy(true);
      try {
        await bridge.requestDesktopUpdate();
      } catch {
        setDesktopUpdate({status: 'failed'});
        setDesktopUpdateBusy(false);
      }
    };
    const desktopUpdateLabel = desktopUpdateBusy
      ? 'Starting Desktop update…'
      : desktopUpdate.status === 'checking'
        ? 'Checking Desktop update…'
        : desktopUpdate.status === 'current'
          ? 'Desktop is up to date'
          : desktopUpdate.status === 'available'
            ? `Update Desktop to ${desktopUpdate.version}`
            : 'Check failed · Retry';
    const canUseLocalDev = Boolean(bridge?.requestLocalDevMode || bridge?.localDev);

    return (
      <>
        <div className="desktop-app-menu-root" ref={rootRef} data-desktop-window-interactive={true}>
          <button type="button" className="desktop-app-menu-trigger" aria-label="Open WheelMaker menu"
            aria-expanded={menuOpen} title="WheelMaker menu" onClick={() => setMenuOpen(open => !open)}>
            <img src="/icons/icon.svg" alt="" aria-hidden="true" />
            {canUpdateDesktop && desktopUpdate.status === 'available' ? <span className="desktop-update-dot" data-desktop-update-dot="app-menu" aria-hidden="true" /> : null}
          </button>
          {menuOpen ? (
            <div className={`desktop-app-menu topbar-menu-surface${menuExiting ? ' sl-menu-exit' : ''}`} role="menu" aria-label="WheelMaker menu">
              <button type="button" role="menuitem" data-desktop-app-action="settings" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
                <SessionIcon name="settings" /><span>Settings</span>
              </button>
              {canUseLocalDev ? (
                <button type="button" role="menuitemcheckbox" aria-checked={Boolean(bridge?.localDev)}
                  data-desktop-app-action="local-dev" onClick={selectLocalDev}>
                  {bridge?.localDev ? <SessionIcon name="check" /> : <span className="desktop-app-menu-leading-slot" aria-hidden="true" />}
                  <span>Dev Mode</span>
                </button>
              ) : null}
              {canUpdateDesktop ? (
                <button type="button" role="menuitem" data-desktop-app-action="desktop-update"
                  disabled={desktopUpdateBusy || desktopUpdate.status === 'checking' || desktopUpdate.status === 'current'}
                  onClick={() => void selectDesktopUpdate()}>
                  {desktopUpdate.status === 'available' ? <span className="desktop-update-dot desktop-update-dot-menu" data-desktop-update-dot="menu" aria-hidden="true" /> : <span className="desktop-app-menu-leading-slot" aria-hidden="true" />}
                  <span data-desktop-update-label={true}>{desktopUpdateLabel}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {localDevDialogOpen ? (
          <div className="local-dev-entry-backdrop" data-desktop-window-interactive={true}>
            <section className="local-dev-entry-dialog" role="dialog" aria-modal="true" aria-label="Configure Local Dev">
              <header><span className="local-dev-entry-eyebrow">Windows extension</span><h2>Enter Dev Mode</h2><p>Build and run WheelMaker from a local source checkout.</p></header>
              <label><span>Source directory</span><input aria-label="WheelMaker source directory" value={localDevSource} placeholder="E:\\_Code\\WheelMaker" spellCheck={false} autoFocus onChange={event => setLocalDevSource(event.target.value)} /></label>
              {localDevError ? <p className="local-dev-entry-error" role="status">{localDevError}</p> : null}
              <footer>
                <button type="button" className="secondary" disabled={localDevBusy} onClick={() => setLocalDevDialogOpen(false)}>Cancel</button>
                <button type="button" className="primary" data-local-dev-enter={true} disabled={localDevBusy} onClick={() => void enterLocalDev()}>{localDevBusy ? 'Entering…' : 'Enter Dev Mode'}</button>
              </footer>
            </section>
          </div>
        ) : null}
      </>
    );
  }
  ```

  Import `DesktopAppMenu` directly from its own file in callers and tests. Simplify `DesktopWindowControls` to the `bridge` guard and the three minimize/maximize/close buttons; it must no longer import `checkDesktopUpdate`, `openLocalDevPanelEvent`, `useMenuExitFlag`, `useCallback` or `useEffect`.

- [ ] **Step 4: Add the shared application-menu styling and remove the old extension-menu styling.**

  In `shell.css`, make the shared material a reusable global class rather than duplicating it for the new menu. Preserve `sl-menu-in`/`.sl-menu-exit` and the existing local-dev dialog styles.

  ```css
  .topbar-menu-surface {
    border: 1px solid var(--border-faint);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
    box-shadow: var(--shadow-overlay);
    backdrop-filter: blur(12px) saturate(1.1);
    -webkit-backdrop-filter: blur(12px) saturate(1.1);
    padding: 4px;
    animation: sl-menu-in 140ms var(--ease-out);
  }

  .desktop-app-menu-root { position: relative; flex: 0 0 auto; }
  .desktop-app-menu-trigger {
    position: relative; width: 30px; height: 30px; border: 0; border-radius: 6px;
    padding: 0; background: transparent; color: var(--text-tertiary); cursor: pointer;
  }
  .desktop-app-menu-trigger img { width: 16px; height: 16px; display: block; border-radius: 4px; }
  .desktop-app-menu-trigger:hover,
  .desktop-app-menu-trigger[aria-expanded='true'] { background: var(--hover); color: var(--text-primary); }
  .desktop-app-menu {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 100; width: 220px;
    transform-origin: top left;
  }
  .desktop-app-menu button {
    width: 100%; min-height: 30px; display: flex; align-items: center; gap: 8px;
    border: 0; border-radius: 5px; padding: 0 9px; background: transparent;
    color: var(--text-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  }
  .desktop-app-menu button:hover,
  .desktop-app-menu button:focus-visible { background: var(--hover); outline: none; }

  @media (prefers-reduced-transparency: reduce) {
    .topbar-menu-surface { background: var(--surface-overlay); backdrop-filter: none; -webkit-backdrop-filter: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .topbar-menu-surface { animation: none; }
  }
  ```

  Replace all `.desktop-windows-extension-*` selectors and their reduced-motion/transparency inclusions with the new application-menu selectors. Keep `.desktop-update-dot` reusable, but change the titlebar-positioning rule to the app-menu trigger position.

- [ ] **Step 5: Run the focused test and typecheck.**

  Run: `npm test -- --runInBand __tests__/web-desktop-titlebar.test.tsx && npm run tsc:web`

  Expected: both commands exit 0; the test proves Settings is first, Dev Mode/update retain their existing behavior, and window controls no longer render `Windows extensions`.

- [ ] **Step 6: Commit the isolated Desktop application menu change.**

  ```powershell
  git add app/web/src/shell/layouts/desktop/DesktopAppMenu.tsx app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx app/web/src/styles/shell.css app/__tests__/web-desktop-titlebar.test.tsx
  git commit -m "feat(app): consolidate desktop actions in app menu"
  ```

### Task 2: Wire the PC left segment and make Project the primary elastic control

**Files:**

- Modify: `app/web/src/app/WorkspaceApp.tsx:36,15785-15825,17420-17440,18935-19010`
- Modify: `app/web/src/styles/chat.css:1-100,169-220,243-385,5340-5475`
- Test: `app/__tests__/web-chat-ui.test.ts:571-610,1927-1940,2150-2272`

- [ ] **Step 1: Add failing desktop/mobile header and menu-surface contract assertions.**

  Amend the existing Chat UI tests so they require the PC-only app menu, the still-direct mobile Settings control, full-width Project and shared surface class on Project/Prompt/Hubs.

  ```ts
  expect(mainTsx).toContain("import {DesktopAppMenu} from '../shell/layouts/desktop/DesktopAppMenu';");
  expect(mainTsx).toContain('<DesktopAppMenu onOpenSettings={handleDesktopSettingsSelect} />');
  expect(mainTsx).toContain('{mobile ? renderChatMenuSettingsButton() : (');
  expect(mainTsx).toContain('{!mobile ? renderDesktopChatProjectSelector() : null}');
  expect(mainTsx).not.toContain('{renderChatMenuSettingsButton()}\n            {!mobile ? renderDesktopChatProjectSelector() : null}');

  const desktopProjectRule = cssRuleBlock(stylesCss, '.chat-title-bar > .chat-session-header .chat-title-project-button');
  expect(desktopProjectRule).toContain('flex: 1 1 0;');
  expect(desktopProjectRule).toContain('max-width: none;');
  expect(desktopProjectRule).not.toContain('116px');
  expect(cssRuleBlock(stylesCss, '.chat-title-project-button')).toContain('color: var(--text-primary);');
  expect(cssRuleBlock(stylesCss, '.chat-title-project-button .sl-icon')).toContain('color: var(--text-tertiary);');

  expect(mainTsx).toContain('topbar-menu-surface${chatTitleProjectMenuExiting');
  expect(mainTsx).toContain('topbar-menu-surface${chatTitlePromptMenuExiting');
  expect(mainTsx).toContain('chat-hub-popover topbar-menu-surface');
  ```

- [ ] **Step 2: Run the Chat UI test to verify the new structural expectations fail.**

  Run: `npm test -- --runInBand __tests__/web-chat-ui.test.ts`

  Expected: FAIL because `WorkspaceApp` still imports only `DesktopTitleBar`, renders the PC gear and uses the 116px Project cap.

- [ ] **Step 3: Render `DesktopAppMenu` only in the PC session header and retain mobile behavior.**

  Keep `renderChatMenuSettingsButton` as the mobile Settings control. In the non-search header branch, render the new app menu and desktop Project selector only when `mobile` is false; leave `renderChatHubSummary()` inside `chat-sidebar-title-actions` so Hubs remains non-shrinking at the right edge.

  ```tsx
  import {DesktopAppMenu} from '../shell/layouts/desktop/DesktopAppMenu';
  import {DesktopDragRegion, DesktopWindowControls} from '../shell/layouts/desktop/DesktopTitleBar';

  const chatSessionHeaderContent = (
    <>
      {!searchHeaderExpanded ? (
        mobile ? renderChatMenuSettingsButton() : (
          <>
            <DesktopAppMenu onOpenSettings={handleDesktopSettingsSelect} />
            {renderDesktopChatProjectSelector()}
          </>
        )
      ) : null}
      <div className="chat-sidebar-title-actions">
        {renderChatHubSummary()}
        {mobile ? <>{renderChatArchiveControls()}{renderChatHeaderSearchControls()}</> : null}
      </div>
    </>
  );
  ```

  Keep the existing mobile `renderChatTitleBar(true)` branch, its Workspace placement and its entire-Prompt button untouched.

- [ ] **Step 4: Change Project and top-level popovers to the shared layout and material contract.**

  Remove the PC-only 116px limit. Let Project grow between the fixed application menu and fixed Hubs summary. Make the Project label `text-primary` by default, leave the chevron `text-tertiary`, and preserve ellipsis only on the label span. Add `topbar-menu-surface` to the Project, Prompt and Hubs portal class names; remove their duplicate material declarations while keeping their own position, size and scroll rules.

  ```css
  .chat-title-bar > .chat-session-header .chat-title-project-button {
    flex: 1 1 0;
    max-width: none;
  }

  .chat-title-project-button { color: var(--text-primary); }
  .chat-title-project-button .sl-icon { flex: 0 0 auto; color: var(--text-tertiary); }

  .chat-title-project-menu,
  .chat-title-prompt-menu,
  .chat-hub-popover {
    transform-origin: top center;
  }
  ```

  ```tsx
  className={`chat-title-project-menu topbar-menu-surface${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}
  className={`chat-title-prompt-menu topbar-menu-surface${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}
  className={`chat-hub-popover topbar-menu-surface${chatHubColorMenuHubId ? ' no-overflow' : ''}${chatHubMenuExiting ? ' sl-menu-exit' : ''}`}
  ```

- [ ] **Step 5: Run the focused Chat UI test and typecheck.**

  Run: `npm test -- --runInBand __tests__/web-chat-ui.test.ts && npm run tsc:web`

  Expected: both commands exit 0; source/CSS assertions prove that mobile remains unchanged while PC uses the app menu and Project owns the residual width.

- [ ] **Step 6: Commit the platform-aware topbar layout change.**

  ```powershell
  git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
  git commit -m "feat(app): rebalance desktop chat top bar"
  ```

### Task 3: Rework Hubs hierarchy and give its color menu the shared exit path

**Files:**

- Modify: `app/web/src/app/WorkspaceApp.tsx:3396-3405,5250-5270,6030-6070,6290-6515`
- Modify: `app/web/src/styles/chat.css:1250-1685,5340-5475`
- Test: `app/__tests__/web-chat-ui.test.ts:816-915,2251-2272`

- [ ] **Step 1: Add failing Hubs hierarchy and nested-menu assertions.**

  Update the existing drawer/Hubs test to require a colour dot control, a real expandable button with an accessible `aria-expanded` state, a chevron, indented projects, no colour rail, and an exit class on the color palette.

  ```ts
  expect(mainTsx).toContain("const [chatHubColorMenu, setChatHubColorMenu, chatHubColorMenuExiting] = useMenuExitState<{hubId: string}>();");
  expect(mainTsx).toContain("const chatHubColorMenuHubId = chatHubColorMenu?.hubId ?? '';");
  expect(mainTsx).toContain('className="chat-hub-color-button"');
  expect(mainTsx).toContain('className="chat-hub-expand-button"');
  expect(mainTsx).toContain("<SessionIcon name={expanded ? 'chevronDown' : 'chevronRight'} />");
  expect(mainTsx).toContain("chat-hub-color-palette topbar-menu-surface${chatHubColorMenuExiting ? ' sl-menu-exit' : ''}");

  const hubTreeRule = cssRuleBlock(stylesCss, '.chat-hub-tree');
  expect(hubTreeRule).not.toContain('border-left:');
  expect(cssRuleBlock(stylesCss, '.chat-hub-project-list')).toContain('margin-left: 26px;');
  expect(cssRuleBlock(stylesCss, '.chat-hub-color-dot')).toContain('border-radius: 50%;');
  ```

- [ ] **Step 2: Run the focused Chat UI test to verify the Hubs assertions fail.**

  Run: `npm test -- --runInBand __tests__/web-chat-ui.test.ts`

  Expected: FAIL because Hubs still has a clickable `div`, rectangular color chip, `border-left` rail, raw string color-menu state and custom palette animation.

- [ ] **Step 3: Convert the color palette to `useMenuExitState` without changing its data behavior.**

  Replace the raw color hub id state with a `{hubId: string}` object menu. Change every close path (sidebar close, outside press, Escape, settings opening and Hubs toggle) to `setChatHubColorMenu(null)`. Open a palette with `{hubId: hub.hubId}`. Existing preset, hue and saturation/brightness handlers keep calling `setHubColors` exactly as before.

  ```tsx
  const [chatHubColorMenu, setChatHubColorMenu, chatHubColorMenuExiting] =
    useMenuExitState<{hubId: string}>();
  const chatHubColorMenuHubId = chatHubColorMenu?.hubId ?? '';

  setChatHubColorMenu(current => current?.hubId === hub.hubId ? null : {hubId: hub.hubId});

  <div
    className={`chat-hub-color-palette topbar-menu-surface${chatHubColorMenuExiting ? ' sl-menu-exit' : ''}`}
    aria-label={`Color options for ${hub.hubId}`}
  >
  ```

- [ ] **Step 4: Replace the inspector-like Hub row with dot, name and chevron controls.**

  Keep the current expanded-Hub id preference and project visibility checkbox logic. Split the previous clickable row into two sibling buttons so the color dot opens the palette and the rest of the row expands/collapses the Hub. Do not nest buttons.

  ```tsx
  <div className="chat-hub-row" style={hubAccentStyle(hub.hubId)}>
    <button
      type="button"
      className="chat-hub-color-button"
      aria-label={`Set color for ${hub.hubId}`}
      aria-expanded={colorMenuOpen}
      onClick={() => setChatHubColorMenu(current => current?.hubId === hub.hubId ? null : {hubId: hub.hubId})}
    >
      <span className="chat-hub-color-dot" aria-hidden="true" />
    </button>
    <button
      type="button"
      className="chat-hub-expand-button"
      aria-expanded={expanded}
      onClick={() => setExpandedHubIds(current => {
        const next = expanded ? current.filter(hubId => hubId !== hub.hubId) : [...current, hub.hubId];
        return next.length > 0 ? next : [HUB_TREE_EMPTY_EXPANDED_SENTINEL];
      })}
    >
      <span className="chat-hub-row-name">{hub.hubId}</span>
      <SessionIcon name={expanded ? 'chevronDown' : 'chevronRight'} />
    </button>
  </div>
  ```

  Replace the old rail/chip CSS with a compact dot, row and indentation treatment. Keep color palette dimensions and its existing controls; remove its separate background, blur, shadow, arrow pseudo-element and custom keyframes so `topbar-menu-surface` is its only surface.

  ```css
  .chat-hub-tree { position: relative; padding: 2px; }
  .chat-hub-row { min-height: 30px; display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 4px; }
  .chat-hub-color-button,
  .chat-hub-expand-button { border: 0; background: transparent; color: var(--text-primary); cursor: pointer; }
  .chat-hub-color-button { width: 20px; display: grid; place-items: center; border-radius: 5px; }
  .chat-hub-color-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hub-accent); }
  .chat-hub-expand-button { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 0 5px; border-radius: 5px; text-align: left; }
  .chat-hub-project-list { margin: 2px 2px 4px; margin-left: 26px; padding: 2px 0; }
  ```

- [ ] **Step 5: Run Hubs-focused and Desktop menu regression tests, then typecheck.**

  Run: `npm test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-desktop-titlebar.test.tsx && npm run tsc:web`

  Expected: all commands exit 0; color editing and project visibility remain wired, while Hubs and its nested palette now use the same material and exit behavior as the other menus.

- [ ] **Step 6: Commit the Hubs visual and menu-state refinement.**

  ```powershell
  git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css app/__tests__/web-chat-ui.test.ts
  git commit -m "feat(app): unify hubs menu hierarchy"
  ```

### Task 4: Run full verification and perform the documented visual review

**Files:**

- Modify: `docs/wiki/frontend-interaction/visual-language.md`
- Modify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`
- Create: `docs/scope/2026-07-24-topbar-menu-unification/spec-topbar-menu-unification.md`
- Create: `docs/scope/2026-07-24-topbar-menu-unification/plan-topbar-menu-unification.md`

- [ ] **Step 1: Run the full frontend test suite and production type/build checks.**

  Run: `npm test -- --runInBand && npm run tsc:web && npm run build:web`

  Expected: all commands exit 0. Investigate any changed static contract or desktop runtime test immediately; do not weaken an assertion merely to accept a broken Project width, missing mobile behavior or missing menu exit path.

- [ ] **Step 2: Perform manual PC and mobile visual verification.**

  Verify all of the following at a normal desktop width, a narrow desktop width and the mobile breakpoint:

  - PC shows the compact WheelMaker mark, then a primary-colour Project that fills the residual left-segment width, then an uncompressed Hubs trigger.
  - Project only ellipsizes once the physical width becomes insufficient; its chevron remains visually secondary.
  - Settings is the first app-menu row; Dev Mode and Desktop update retain their prior availability and failure/retry behavior; there is no duplicate Windows extensions trigger beside the window controls.
  - Mobile still shows Workspace at the top and keeps the whole Prompt title clickable.
  - Application, Project, Prompt, Hubs and Hubs color menus share 8px corners, 4px padding, 88% overlay, weak blur, thin border, shallow shadow and entry/exit movement. With reduced transparency they become solid; with reduced motion they do not animate.
  - Hubs can expand, toggle project visibility and edit preset/custom color without a rail or an inspector-like outer surface.

- [ ] **Step 3: Align the approved documentation with the consolidated implementation.**

  In `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`, state that the WheelMaker application menu is the sole desktop entry for Settings, Dev Mode and Desktop update; remove the obsolete separate Desktop extension-menu member from the topbar menu family. Keep the Project/Hubs layout and mobile exception already recorded. In `docs/wiki/frontend-interaction/visual-language.md`, retain the shared `topbar-menu-surface` values and add the source link to the approved spec if it is not already present. Do not add implementation checklists or code-specific selectors to either wiki page.

- [ ] **Step 4: Commit the approved scope and wiki records with the finished implementation.**

  ```powershell
  git add docs/scope/2026-07-24-topbar-menu-unification docs/wiki/frontend-interaction/visual-language.md docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md
  git commit -m "docs: record topbar menu unification"
  ```
