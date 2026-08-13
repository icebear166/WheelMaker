declare const __dirname: string;
declare function require(moduleName: string): unknown;

const {readFileSync} = require('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const {resolve} = require('path') as {
  resolve(...paths: string[]): string;
};

import {resolveSheetReleaseDuration} from '../chat/sessionlist/sheetDragDismiss';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('P0 motion contracts', () => {
  it('keeps keyboard composer menus immediate and gives the send action press feedback', () => {
    const chatCss = read('chat.css');

    expect(chatCss).toMatch(
      /\.chat-slash-menu,\s*\.chat-file-mention-menu\s*\{\s*transform-origin: bottom center;\s*\}/,
    );
    expect(chatCss).not.toMatch(
      /\.chat-slash-menu,\s*\.chat-file-mention-menu,\s*\.chat-core-config-menu/,
    );
    expect(chatCss).toContain(
      'transition:\n    transform var(--motion-fast) var(--ease-standard),\n    background var(--motion-fast) var(--ease-standard),\n    border-color var(--motion-fast) var(--ease-standard),\n    color var(--motion-fast) var(--ease-standard);',
    );
    expect(chatCss).toContain('.chat-send-button:active:not(:disabled) {');
  });

  it('uses a fast ease-out for attachment removal', () => {
    const chatCss = read('chat.css');

    expect(chatCss).toContain('opacity var(--motion-fast) var(--ease-out)');
    expect(chatCss).not.toContain('opacity var(--motion-fast) ease-in');
    expect(chatCss).not.toContain('transform var(--motion-fast) ease-in');
  });

  it('animates Settings once at the screen level and gives Usage surfaces paired exits', () => {
    const settingsCss = read('settings.css');
    const usageCss = read('usage.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(settingsCss).not.toMatch(
      /\.mobile-settings-screen,\s*\.settings-detail-page\s*\{\s*animation:/,
    );
    expect(settingsCss).toContain('.mobile-settings-screen.settings-detail-screen');
    expect(settingsCss).toContain('.settings-detail-page {\n  animation: none;');
    expect(workspaceApp).toContain('settings-screen-exiting');
    expect(usageCss).toContain('@keyframes usage-overlay-out');
    expect(usageCss).toContain('@keyframes usage-dialog-out');
    expect(usageCss).toContain('.usage-overlay-exit');
    expect(usageCss).toContain('.usage-dialog-exit');
    expect(workspaceApp).toContain('usageHistoryDialogExiting');
    expect(workspaceApp).toContain('deepSeekUsageDialogExiting');
    expect(workspaceApp).toContain('mobileUsageExiting');
  });

  it('keeps the desktop settings root resident and animates only the detail pane', () => {
    const settingsCss = read('settings.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(workspaceApp).toContain('SettingsDesktopSplit');
    expect(workspaceApp).toContain('settingsDetailPaneExit');
    expect(workspaceApp).toContain('settings-main-screen${desktopSettingsDetailPane');
    expect(settingsCss).toContain('@keyframes settingsDetailPaneIn');
    expect(settingsCss).toContain('@keyframes settingsDetailPaneOut');
    expect(settingsCss).toContain('.settings-desktop-detail-pane.is-exiting');
  });

  it('uses one tokenized exit duration for shared menu surfaces', () => {
    const sessionListCss = read('sessionlist.css');
    const chatCss = read('chat.css');
    const menuExit = read('../chat/sessionlist/menuExit.ts');

    expect(menuExit).toMatch(/MENU_EXIT_MS\s*=\s*120/);
    expect(sessionListCss).toContain(
      'animation: sl-menu-out var(--motion-fast) var(--ease-out) forwards;',
    );
    expect(sessionListCss).toContain(
      'animation: sl-sheet-overlay-out var(--motion-fast) var(--ease-out) forwards;',
    );
    expect(chatCss).toContain(
      'animation: mobile-sheet-slide-down var(--motion-fast) var(--ease-out) forwards;',
    );
  });

  it('derives anchored project popover origin from its placement', () => {
    const sessionListCss = read('sessionlist.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(sessionListCss).toContain(
      'transform-origin: var(--sl-popover-origin, top center);',
    );
    expect((workspaceApp.match(/--sl-popover-origin/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('animates transient notices and desktop dialogs with reduced-motion coverage', () => {
    const shellCss = read('shell.css');
    const usageCss = read('usage.css');

    expect(shellCss).toContain(
      'animation: app-toast-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(shellCss).toContain(
      'animation: app-dialog-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(shellCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-toast,[\s\S]*\.app-retry-toast/,
    );
    expect(usageCss).toContain(
      'animation: usage-dialog-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(usageCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.usage-mobile-overlay,[\s\S]*\.usage-history-overlay/,
    );
  });
});

describe('P1 motion contracts', () => {
  it('keeps Hub companion exits spatial and avoids moving the parent by left', () => {
    const chatCss = read('chat.css');
    const chatHubMenu = read('../app/ChatHubMenu.tsx');

    expect(chatHubMenu).toContain('skillSurfaceExiting');
    expect(chatCss).toContain('.chat-hub-skill-companion.desktop.sl-menu-exit');
    expect(chatCss).toContain('transform: translateX(6px) scale(0.98);');
    expect(chatCss).not.toContain('transition: left 180ms var(--ease-out);');
  });

  it('reveals Recent Sessions content without a max-height layout transition', () => {
    const chatCss = read('chat.css');
    const panel = read('../chat/ChatSessionPanel.tsx');
    const recentSessions = read('../chat/ChatRecentSessionsSurface.tsx');

    expect(chatCss).not.toContain('transition: max-height var(--motion-standard) var(--ease-standard);');
    expect(chatCss).toContain('.chat-recent-sessions-surface.desktop.collapsed .chat-recent-sessions-surface-list');
    expect(panel).toContain('keepChildrenMounted');
    expect(recentSessions).toContain('keepChildrenMounted={true}');
  });

  it('uses a transform offset while dragging the mobile floating control stack', () => {
    const shellCss = read('shell.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(shellCss).not.toContain('transition: top var(--motion-standard) var(--ease-standard),');
    expect(workspaceApp).toMatch(
      /top: `\$\{floatingDragState \? floatingDragState\.startTop : effectiveFloatingControlTop\}px`/,
    );
    expect(workspaceApp).toContain('floatingDragState.currentTop - floatingDragState.startTop');
  });

  it('derives a shorter sheet release duration from faster releases', () => {
    expect(resolveSheetReleaseDuration(0)).toBe(180);
    expect(resolveSheetReleaseDuration(0.4)).toBe(140);
    expect(resolveSheetReleaseDuration(0.8)).toBe(100);
  });

  it('keeps Thinking expansion out of max-height transitions', () => {
    const chatCss = read('chat.css');
    const workspaceApp = read('../app/WorkspaceApp.tsx');

    expect(chatCss).not.toContain('transition: max-height 220ms cubic-bezier(0.4, 0, 0.2, 1);');
    expect(chatCss).toContain('.thinking-body.expanded .thinking-content');
    expect(chatCss).toContain(
      'animation: thinking-content-in var(--motion-standard) var(--ease-out) both;',
    );
    expect(workspaceApp).not.toContain('style={{ maxHeight: expanded ? contentHeight + 16 : 0 }}');
  });

  it('tokenizes Preview Workbench entry motion and disables it for reduced motion', () => {
    const fileCss = read('file.css');

    expect(fileCss).toContain(
      'animation: preview-workbench-search-in var(--motion-fast) var(--ease-out);',
    );
    expect(fileCss).toContain(
      'animation: preview-workbench-drawer-in var(--motion-standard) var(--ease-out);',
    );
    expect(fileCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.preview-workbench-search-bar,[\s\S]*\.preview-workbench-drawer-panel\.external/,
    );
  });
});

describe('P2 motion contracts', () => {
  it('anchors generic topbar surfaces and keeps hover-only movement off touch', () => {
    const shellCss = read('shell.css');
    const chatCss = read('chat.css');
    const settingsCss = read('settings.css');

    expect(shellCss).toContain('transform-origin: var(--popover-origin, top center);');
    expect(chatCss).toContain('.chat-hub-color-palette.topbar-menu-surface');
    expect(chatCss).toContain('--popover-origin: top right;');
    expect(settingsCss).toContain('@media (hover: hover) and (pointer: fine)');
    expect(settingsCss).toContain('.settings-detail-row:hover .settings-row-chevron');
  });

  it('uses the tokenized ease-out curve for web and native launch exits', () => {
    const shellCss = read('shell.css');
    const launchOverlay = read('../../../../server/cmd/wheelmaker-desktop/launch_overlay.js');

    expect(shellCss).toContain(
      'animation: wm-launch-exit var(--motion-emphasized) var(--ease-out) forwards;',
    );
    expect(launchOverlay).toContain(
      "transition:opacity ' + FADE_MS + 'ms cubic-bezier(0.16,1,0.3,1);",
    );
  });

  it('maps common hover and sheet timings to shared motion tokens', () => {
    const chatCss = read('chat.css');
    const shellCss = read('shell.css');
    const settingsCss = read('settings.css');
    const usageCss = read('usage.css');

    expect(chatCss).toContain('transition: background-color var(--motion-fast) var(--ease-standard);');
    expect(shellCss).toContain('animation: mobile-sheet-slide-up var(--motion-emphasized) var(--ease-out);');
    expect(settingsCss).toContain('transition: background var(--motion-fast) var(--ease-standard);');
    expect(usageCss).toContain('transition: background var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard);');
  });

  it('uses the valid reduced-motion query and avoids scale-zero indicators', () => {
    const tooltipCss = read('tooltip.css');
    const chatCss = read('chat.css');

    expect(tooltipCss).not.toContain('@media (prefers-reduced-motion) {');
    expect(tooltipCss).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(chatCss).not.toContain('from { transform: scale(0); }');
    expect(chatCss).toContain('from { opacity: 0; transform: scale(0.97); }');
  });

  it('keeps one Settings detail entry animation and tokenizes Thinking controls', () => {
    const settingsCss = read('settings.css');
    const chatCss = read('chat.css');

    expect(settingsCss).not.toContain('@keyframes settings-detail-enter');
    expect((settingsCss.match(/animation: settingsPageEnter/g) ?? []).length).toBe(1);
    expect(chatCss).toContain('transition: border-color var(--motion-standard) var(--ease-standard);');
    expect(chatCss).toContain(
      'transition: transform var(--motion-standard) var(--ease-standard), color var(--motion-fast) var(--ease-standard);',
    );
  });
});

describe('Mermaid viewport interaction contracts', () => {
  it('keeps the diagram surface draggable and keyboard focusable', () => {
    const codeCss = read('code.css');

    expect(codeCss).toContain('touch-action: none;');
    expect(codeCss).toContain('.mermaid-block.is-dragging');
    expect(codeCss).toContain('.mermaid-viewport {');
    expect(codeCss).toContain('transform-origin: 0 0;');
    expect(codeCss).toContain('.mermaid-block:focus-visible');
  });

  it('provides a larger modal diagram surface with a dismissible backdrop', () => {
    const codeCss = read('code.css');

    expect(codeCss).toContain('.mermaid-expand-button');
    expect(codeCss).toContain('.mermaid-modal-overlay');
    expect(codeCss).toContain('.mermaid-modal-dialog');
    expect(codeCss).toContain('.mermaid-modal-canvas');
    expect(codeCss).toContain('backdrop-filter: blur');
  });
});
