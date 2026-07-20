import fs from 'fs';
import path from 'path';
import { transformSync } from '@babel/core';

import {readWebStyles} from '../testHelpers/webStyles';
function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web responsive shell split', () => {
  test('defines desktop and mobile shells behind one responsive shell module', () => {
    const projectRoot = path.join(__dirname, '..');
    const shellPath = path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx');

    expect(fs.existsSync(shellPath)).toBe(true);

    const shellTsx = fs.readFileSync(shellPath, 'utf8');

    expect(shellTsx).toContain("import type { LayoutMode } from './state/responsiveLayout';");
    expect(shellTsx).toContain('export function DesktopShell(');
    expect(shellTsx).toContain('export function MobileShell(');
    expect(shellTsx).toContain('export function ResponsiveShell(');
    expect(shellTsx).not.toContain("import { DesktopTitleBar } from './layouts/desktop/DesktopTitleBar';");
    expect(shellTsx).toContain("mode === 'desktop'");
    expect(shellTsx).toContain('desktopWindowControls: ReactNode;');
    expect(shellTsx).toContain('desktopWindowControlsVisible: boolean;');
    expect(shellTsx).toContain('desktopTopBar: ReactNode;');
    expect(shellTsx).toContain('desktopSettingsScreen: ReactNode;');
    expect(shellTsx).toContain('desktopChatPreviewOpen: boolean;');
    expect(shellTsx).not.toContain('desktopActivityBar: ReactNode;');
    expect(shellTsx).not.toContain('<DesktopTitleBar title="WheelMaker" />');

    expect(shellTsx).toMatch(
      /export function DesktopShell[\s\S]*?desktopWindowControls[\s\S]*?className=\{`workspace theme-\$\{themeMode\}`\}[\s\S]*?\{desktopWindowControls\}[\s\S]*?<div[\s\S]*?className="desktop-shell"[\s\S]*?<aside className="workspace-left">\{sidebar\}<\/aside>/,
    );
    expect(shellTsx).toContain("data-chat-preview-open={desktopChatPreviewOpen ? 'true' : undefined}");
    expect(shellTsx).toContain("data-desktop-window-controls={desktopWindowControlsVisible ? 'true' : undefined}");
    expect(shellTsx).toMatch(
      /export function MobileShell[\s\S]*?className=\{`workspace theme-\$\{themeMode\} narrow-shell`\}[\s\S]*?className=\{`drawer-overlay \$\{drawerOpen \? 'show' : ''\}`\}/,
    );
    expect(shellTsx).toMatch(
      /<div\s+className=\{`drawer-overlay \$\{drawerOpen \? 'show' : ''\}`\}\s+onClick=\{onCloseDrawer\}\s+\/>/,
    );
    expect(shellTsx).toMatch(
      /<aside\s+className=\{`drawer \$\{drawerOpen \? 'show' : ''\}`\}[\s\S]*?onClick=\{event => event\.stopPropagation\(\)\}/,
    );
  });

  test('keeps the React runtime import required by the web JSX transform', () => {
    const projectRoot = path.join(__dirname, '..');
    const shellPath = path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx');
    const shellTsx = fs.readFileSync(shellPath, 'utf8');

    const output =
      transformSync(shellTsx, {
        filename: shellPath,
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'],
      })?.code ?? '';

    expect(output).toMatch(/\.createElement\(/);
    expect(output).toMatch(/require\(["']react["']\)|from ["']react["']/);
  });

  test('main delegates shell structure instead of owning desktop and mobile containers inline', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain("import { ResponsiveShell } from '../shell/ResponsiveShell';");
    expect(mainTsx).toContain('<ResponsiveShell');
    expect(mainTsx).toContain('mode={layoutMode}');
    expect(mainTsx).toContain('desktopWindowControls={desktopWindowControls}');
    expect(mainTsx).toContain('desktopWindowControlsVisible={desktopWindowControlsVisible}');
    expect(mainTsx).toContain('desktopTopBar={desktopTopBar}');
    expect(mainTsx).toContain('desktopSettingsScreen={desktopSettingsScreen}');
    expect(mainTsx).toContain('desktopChatPreviewOpen={isWide && chatPreviewOpen}');
    expect(mainTsx).not.toContain('desktopActivityBar={desktopActivityBar}');
    expect(mainTsx).toContain('floatingControlStack={floatingControlStack}');
    expect(mainTsx).toContain('mobileSettingsScreen={mobileSettingsScreen}');
    expect(mainTsx).toContain('sidebar={renderSidebar()}');
    expect(mainTsx).toContain('main={renderMain()}');

    const appShellStart = mainTsx.indexOf('<ResponsiveShell');
    const appShellEnd = mainTsx.indexOf('/>', appShellStart);
    expect(appShellStart).toBeGreaterThanOrEqual(0);
    expect(appShellEnd).toBeGreaterThan(appShellStart);
    const appReturn = mainTsx.slice(appShellStart, appShellEnd);

    expect(appReturn).not.toContain('className="body"');
    expect(appReturn).not.toContain('className={`drawer-overlay');
    expect(appReturn).not.toContain('className="workspace-left"');
  });

  test('connection screen keeps frameless desktop controls available', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain("import { DesktopDragRegion, DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';");

    const disconnectedStart = mainTsx.indexOf('if (!connected && !keepWorkspaceVisible)');
    const disconnectedEnd = mainTsx.indexOf('const projectMenu', disconnectedStart);
    expect(disconnectedStart).toBeGreaterThanOrEqual(0);
    expect(disconnectedEnd).toBeGreaterThan(disconnectedStart);
    const disconnectedReturn = mainTsx.slice(disconnectedStart, disconnectedEnd);

    expect(disconnectedReturn).toContain('<DesktopWindowControls />');
    expect(disconnectedReturn).not.toContain('<DesktopTitleBar title="WheelMaker" />');
    expect(disconnectedReturn).toMatch(
      /className=\{`page theme-\$\{themeMode\}`\}[\s\S]*?<DesktopWindowControls \/>[\s\S]*?<div className="connect" aria-busy=\{autoConnecting\}>/,
    );
    expect(disconnectedReturn).toContain('aria-busy={autoConnecting}');
    expect(disconnectedReturn).toContain('disabled={autoConnecting}');
    expect(disconnectedReturn).toContain('role="alert"');
  });

  test('styles frameless desktop controls and reserves right toolbar space', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toContain('--desktop-window-controls-width: 176px;');
    expect(stylesCss).toContain('--desktop-top-surface: color-mix(in srgb, var(--surface-sidebar) 62%, var(--surface-panel));');
    expect(stylesCss).not.toContain('.desktop-titlebar {');
    expect(stylesCss).not.toContain('.desktop-activity-bar {');

    const blockTitleBlock = cssRuleBlock(stylesCss, '.block-title');
    expect(blockTitleBlock).toContain('height: 32px;');

    const sidebarTitleRowBlock = cssRuleBlock(stylesCss, '.sidebar-title-row');
    expect(sidebarTitleRowBlock).toContain('flex: 0 0 var(--chat-menu-header-height);');
    expect(sidebarTitleRowBlock).toContain('min-height: var(--chat-menu-header-height);');

    const shellCss = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles', 'shell.css'), 'utf8');
    const shellEvolutionStart = shellCss.indexOf('/* workspace-ui-targeted-evolution: shell */');
    const sidebarTitleStart = shellCss.indexOf('.sidebar-title-row {', shellEvolutionStart);
    const sidebarTitleEnd = shellCss.indexOf('\n}', sidebarTitleStart) + 2;
    const evolvedSidebarTitleRow = shellCss.slice(sidebarTitleStart, sidebarTitleEnd);
    expect(evolvedSidebarTitleRow).toContain('min-height: var(--chat-menu-header-height);');
    expect(evolvedSidebarTitleRow).not.toContain('min-height: 44px;');
    const mobileSessionHeaderBlock = cssRuleBlock(stylesCss, '.chat-session-header.mobile');
    expect(mobileSessionHeaderBlock).toContain('min-height: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');

    const controlsBlock = cssRuleBlock(stylesCss, '.desktop-window-controls');
    expect(controlsBlock).toContain('position: fixed;');
    expect(controlsBlock).toContain('top: 0;');
    expect(controlsBlock).toContain('right: 0;');
    expect(controlsBlock).toContain('z-index: 80;');
    expect(controlsBlock).toContain('width: var(--desktop-window-controls-width);');
    expect(controlsBlock).toContain('height: 32px;');
    expect(controlsBlock).toContain('background: var(--desktop-top-surface);');
    expect(controlsBlock).not.toContain('border-left:');
    expect(controlsBlock).toContain('border-bottom: 1px solid var(--border-subtle);');
    expect(stylesCss).not.toContain('.theme-light .desktop-window-controls {');

    expect(stylesCss).toContain('.desktop-window-source-button {');
    expect(stylesCss).toContain('.desktop-window-source-popover {');
    expect(stylesCss).toContain('.desktop-window-source-panel {');
    expect(stylesCss).toContain('.desktop-window-source-choice {');

    const sidebarSettingsButtonBlock = cssRuleBlock(stylesCss, '.chat-menu-icon-button');
    expect(sidebarSettingsButtonBlock).toContain('width: var(--chat-menu-icon-button-size);');
    expect(sidebarSettingsButtonBlock).toContain('height: var(--chat-menu-icon-button-size);');
    expect(sidebarSettingsButtonBlock).toContain('flex: 0 0 var(--chat-menu-icon-button-size);');

    const rightTitleBlock = cssRuleBlock(stylesCss, ".desktop-shell[data-desktop-window-controls='true'] .workspace-right .block-title");
    expect(rightTitleBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');

    const rightChatTitleBlock = cssRuleBlock(stylesCss, ".desktop-shell[data-desktop-window-controls='true']:not([data-chat-preview-open='true']) .desktop-primary-workspace > .chat-title-bar");
    expect(rightChatTitleBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');
    const rightChatTitlePreviewOpenBlock = cssRuleBlock(stylesCss, ".desktop-shell[data-desktop-window-controls='true'][data-chat-preview-open='true'] .desktop-primary-workspace > .chat-title-bar");
    expect(rightChatTitlePreviewOpenBlock).toContain('padding-right: 10px;');

    const previewToolbarBlock = cssRuleBlock(stylesCss, ".desktop-shell[data-desktop-window-controls='true'] .preview-workbench-surface.desktop .preview-workbench-toolbar");
    expect(previewToolbarBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');
  });

  test('renders desktop settings as a global centered overlay instead of sidebar content', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (');
    expect(mainTsx).toContain('<SettingsScreen');
    expect(mainTsx).toContain('className="desktop-settings-screen"');
    expect(mainTsx).toContain('shortcutBar={settingsShortcutBar}');
    expect(mainTsx).toContain('onBackdropClick={handleMobileSettingsBackButton}');
    expect(mainTsx).toContain('const wideSidebarMain = renderWideProjectSessionNav();');
    expect(mainTsx).not.toContain('const wideSidebarMain = sidebarSettingsOpen');
    expect(mainTsx).not.toContain('wideSettingsTitle');
    expect(mainTsx).not.toContain('const wideSidebarTitle = sidebarSettingsOpen');
    expect(mainTsx).toContain('<div className="sidebar-scroll">');

    const workspaceLeftBlock = cssRuleBlock(stylesCss, '.workspace-left');
    expect(workspaceLeftBlock).toContain('overflow: hidden;');

    const wideSidebarScrollBlock = cssRuleBlock(stylesCss, '.workspace-left .sidebar-scroll');
    expect(wideSidebarScrollBlock).toContain('overflow-x: hidden;');
    expect(wideSidebarScrollBlock).toContain('overflow-y: auto;');
    expect(wideSidebarScrollBlock).toContain('scrollbar-gutter: auto;');
    expect(wideSidebarScrollBlock).toContain('scrollbar-width: thin;');
    expect(wideSidebarScrollBlock).not.toContain('scrollbar-gutter: stable;');

    const desktopScreenBlock = cssRuleBlock(stylesCss, '.mobile-settings-screen.desktop-settings-screen');
    expect(desktopScreenBlock).toContain('position: fixed;');
    expect(desktopScreenBlock).toContain('inset: 0;');
    expect(desktopScreenBlock).toContain('z-index: 60;');
    expect(desktopScreenBlock).toContain('display: grid;');
    expect(desktopScreenBlock).toContain('place-items: center;');

    const desktopPanelBlock = cssRuleBlock(stylesCss, '.desktop-settings-screen .settings-workbench-panel');
    expect(desktopPanelBlock).toContain('width: min(920px, calc(100vw - 56px));');
    expect(desktopPanelBlock).toContain('height: calc(100vh - 56px);');
    expect(desktopPanelBlock).toContain('border-radius: 14px;');
    expect(desktopPanelBlock).toContain('overflow: hidden;');

    expect(stylesCss).not.toContain('.workspace-left .settings-list {');
    expect(stylesCss).not.toContain('.workspace-left .settings-detail-page {');
  });

  test('keeps the existing two responsive modes while styling the mobile drawer', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    expect(stylesCss).toContain('@media (max-width: 900px)');
    expect(stylesCss).not.toMatch(/@media[^\{]+\(min-width:\s*901px\)[^\{]+\(max-width:/);
    expect(stylesCss).toContain('.drawer.show');
    expect(stylesCss).toContain('.drawer-overlay.show');
    expect(stylesCss).toContain('background: rgb(4 9 16 / 48%);');
  });
});
