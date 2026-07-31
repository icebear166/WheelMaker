import fs from 'fs';
import path from 'path';
import {
  resolveSessionsShortcutAction,
  resolveWindowsWorkspaceShortcut,
} from '../web/src/app/workspaceShortcuts';

const root = path.join(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const shortcutEvent = (overrides: Partial<Parameters<typeof resolveWindowsWorkspaceShortcut>[0]> = {}) => ({
  code: 'Digit1',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...overrides,
});

describe('terminal workspace integration', () => {
  test('maps the Windows desktop workspace shortcuts', () => {
    const environment = {isWindows: true, isWide: true};

    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({code: 'Digit1'}), environment)).toBe('sessions');
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({code: 'Digit2'}), environment)).toBe('preview');
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({code: 'Backquote'}), environment)).toBe('terminal');
  });

  test('opens and closes the slide-out without Pin when the saved mode is unpinned', () => {
    expect(resolveSessionsShortcutAction({
      sessionPanelPinned: false,
      temporarilyUnpinned: false,
      slideOutOpen: false,
    })).toBe('open-slideout');
    expect(resolveSessionsShortcutAction({
      sessionPanelPinned: false,
      temporarilyUnpinned: false,
      slideOutOpen: true,
    })).toBe('close-slideout');
  });

  test('temporarily unpins and restores Pin when the saved mode is pinned', () => {
    expect(resolveSessionsShortcutAction({
      sessionPanelPinned: true,
      temporarilyUnpinned: false,
      slideOutOpen: false,
    })).toBe('temporarily-unpin');
    expect(resolveSessionsShortcutAction({
      sessionPanelPinned: true,
      temporarilyUnpinned: true,
      slideOutOpen: false,
    })).toBe('restore-pin');
  });

  test('rejects old, shifted, non-Windows, mobile, and modified shortcuts', () => {
    const windowsDesktop = {isWindows: true, isWide: true};
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({code: 'KeyT'}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({code: 'Backquote', shiftKey: true}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent(), {isWindows: false, isWide: true})).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent(), {isWindows: true, isWide: false})).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({ctrlKey: false}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({altKey: true}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({metaKey: true}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({isComposing: true}), windowsDesktop)).toBeNull();
    expect(resolveWindowsWorkspaceShortcut(shortcutEvent({defaultPrevented: true}), windowsDesktop)).toBeNull();
  });

  test('wires Windows workspace shortcuts to the existing surface toggles', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('resolveWindowsWorkspaceShortcut(event, {isWindows: isWindowsPlatform, isWide})');
    expect(source).toContain("case 'sessions':");
    expect(source).toContain("case 'preview':");
    expect(source).toContain("case 'terminal':");
    expect(source).not.toContain("event.key === 't' || event.key === 'T'");

    const sessionsStart = source.indexOf("case 'sessions':");
    const previewStart = source.indexOf("case 'preview':", sessionsStart);
    const sessionsBlock = source.slice(sessionsStart, previewStart);
    expect(sessionsBlock).toContain('resolveSessionsShortcutAction({');
    expect(sessionsBlock).toContain('sessionPanelPinned: !sidebarCollapsed');
    expect(sessionsBlock).toContain('temporarilyUnpinned: sessionPanelShortcutUnpinned');
    expect(sessionsBlock).toContain('slideOutOpen: sessionNavSlideOut.open');
    expect(sessionsBlock).not.toContain('setSidebarCollapsed(');

    expect(source).toContain('const chatSidebarCollapsed = sidebarCollapsed || sessionPanelShortcutUnpinned;');
    expect(source).toContain('sessionPanelPinned: !sidebarCollapsed,');
    expect(source).not.toContain('sessionPanelPinned: !chatSidebarCollapsed,');
  });

  test('clears the temporary shortcut override when Pin is changed explicitly', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain([
      'const pinChatSessionPanel = useCallback(() => {',
      '    setSessionPanelShortcutUnpinned(false);',
      '    setSidebarCollapsed(false);',
    ].join('\n'));
    expect(source).toContain([
      'const unpinChatSessionPanel = useCallback(() => {',
      '    setSessionPanelShortcutUnpinned(false);',
      '    setSidebarCollapsed(true);',
    ].join('\n'));
    expect(source).toContain('onTogglePin={unpinChatSessionPanel}');
    expect(source).toContain('onTogglePin={pinChatSessionPanel}');
    expect(source).toContain('pinChatSessionPanel();');
  });

  test('restores the saved Pin mode when opening settings', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain([
      'if (sidebarSettingsOpen) {',
      '      setSessionPanelShortcutUnpinned(false);',
      '      sessionNavSlideOutAutoClose.cancel();',
    ].join('\n'));
  });

  test('places Terminal before Preview and renders a desktop bottom panel', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    const terminalButton = source.indexOf('className={`chat-terminal-toggle${terminalOpen ? \' active\' : \'\'}`}');
    const previewButton = source.indexOf('className={`chat-preview-toggle${chatPreviewOpen ? \' active\' : \'\'}`}');
    expect(terminalButton).toBeGreaterThan(0);
    expect(previewButton).toBeGreaterThan(terminalButton);
    expect(source).toContain('className="terminal-splitter"');
    expect(source).toContain('className="terminal-desktop-panel"');
    expect(source).toContain('<TerminalWorkbench mode="desktop"');
  });

  test('uses the full-screen mobile overlay slot and keeps Preview exclusive', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('const terminalMobileOverlay = !isWide ? (');
    expect(source).toContain('className="terminal-mobile-overlay"');
    expect(source).toContain('hidden={!terminalOpen}');
    expect(source).toContain('aria-hidden={terminalOpen ? undefined : true}');
    expect(source).toContain('{terminalMobileOverlay}');
    expect(source).toContain('active={terminalOpen}');
    expect(source).toContain([
      'if (!isWide) {',
      '      setMobileUsageOpen(false);',
      '      setTerminalOpen(false);',
    ].join('\n'));
    expect(source).toContain('onCloseSurface={() => setTerminalOpen(false)}');
    expect(source).toContain('const [terminalFullscreen, setTerminalFullscreen] = useState(false);');
    expect(source).toContain('mobileFullscreen={terminalFullscreen}');
    expect(source).toContain('onMobileFullscreenChange={setTerminalFullscreen}');
    expect(source).toContain('if (!isWide && terminalOpen) {');
  });

  test('handles terminal events, reconnect lists, and page-memory ownership', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('event.method === RegistryMethods.TerminalOutput');
    expect(source).toContain('event.method === RegistryMethods.TerminalChanged');
    expect(source).toContain('Promise.allSettled(hubIds.map(hubId => service.listTerminals(hubId)))');
    expect(source).toContain('const terminalResizeTokensRef = useRef(new Map<string, string>());');
    expect(source).not.toContain('workspaceStore.rememberTerminal');
  });

  test('refreshes an unavailable terminal Hub when an online project report arrives', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('terminalListRefreshInFlightRef');
    expect(source).toContain('nextProject.online &&');
    expect(source).toContain('terminalSyncRef.current.unavailableHubIds[reportedHubId]');
    expect(source).toContain('refreshTerminalLists([{hubId: reportedHubId}]).catch(() => undefined);');
  });

  test('shows the global toast after terminal text is copied', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain("const handleTerminalCopy = () => setToastMessage('Copied to clipboard.');");
    expect(source.match(/onCopy=\{handleTerminalCopy\}/g)).toHaveLength(2);
  });

  test('confirms closing a running terminal', () => {
    const dialogs = read('web/src/shell/AppDialogs.tsx');
    expect(dialogs).toContain("kind: 'terminalClose'");
    expect(dialogs).toContain("if (target.kind === 'terminalClose') return 'Close running terminal?';");
    expect(dialogs).toContain('This terminates the terminal process tree');
  });

  test('imports focused Terminal styles with desktop and mobile geometry', () => {
    const indexCss = read('web/src/styles/index.css');
    const terminalCss = read('web/src/styles/terminal.css');
    expect(indexCss.trimEnd().endsWith("@import './terminal.css';")).toBe(true);
    expect(terminalCss).toContain('.terminal-desktop-panel');
    expect(terminalCss).toContain([
      '.terminal-desktop-panel {',
      '  display: flex;',
      '  flex: 0 0 auto;',
      '  flex-direction: column;',
    ].join('\n'));
    expect(terminalCss).toContain('min-height: 160px;');
    expect(terminalCss).toContain('.terminal-mobile-overlay');
    expect(terminalCss).toContain('position: fixed;');
    expect(terminalCss).toContain('z-index: 70;');
    expect(terminalCss).toContain([
      '.terminal-xterm-host {',
      '  width: 100%;',
      '  height: 100%;',
      '  touch-action: none;',
      '  overscroll-behavior: contain;',
      '}',
    ].join('\n'));
    expect(terminalCss).toContain('.terminal-xterm-surface {');
    expect(terminalCss).toContain('.terminal-copy-context-menu {');
    expect(terminalCss).toContain('position: fixed;');
    expect(terminalCss).toContain('.terminal-toolbar-action {');
    expect(terminalCss).toContain('display: inline-flex;');
    expect(terminalCss).toContain('.terminal-workbench.mobile > .workbench-chrome-fullscreen-toggle {');
    expect(terminalCss).toContain('bottom: calc(71px + var(--wm-safe-area-bottom));');
  });

  test('uses the danger state color for an unavailable terminal', () => {
    const terminalCss = read('web/src/styles/terminal.css');
    expect(terminalCss).toContain('.terminal-status.unavailable { background: var(--state-danger); }');
    expect(terminalCss).not.toContain('.terminal-status.unavailable { background: #d8a34c; }');
  });

  test('passes the current app theme to desktop and mobile terminals', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    const terminalViews = source.match(/<TerminalView\s[\s\S]*?\/>/g) ?? [];
    expect(terminalViews).toHaveLength(2);
    terminalViews.forEach(view => expect(view).toContain('themeMode={themeMode}'));
  });

  test('uses app theme tokens throughout the terminal chrome', () => {
    const terminalCss = read('web/src/styles/terminal.css');
    expect(terminalCss).toContain('background: var(--surface-workspace-content);');
    expect(terminalCss).toContain('background: var(--surface-sidebar);');
    expect(terminalCss).toContain('color: var(--text-primary);');
    expect(terminalCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test('automatically claims changed focused dimensions and recovers a stale resize token', () => {
    const source = read('web/src/app/WorkspaceApp.tsx');
    expect(source).toContain('onAutoResize={handleAutoClaimTerminalResize}');
    expect(source).toContain('terminalResizeClaimsRef');
    expect(source).toContain('terminalResizeTokensRef.current.delete(key);');
    expect(source).toContain('claimTerminalResize(key, cols, rows)');
    expect(source).toContain('shell={activeTerminal.shell}');
    expect(source).toContain('initialCwd={activeTerminal.initialCwd}');
  });
});
