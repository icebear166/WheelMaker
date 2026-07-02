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
    expect(shellTsx).not.toContain('desktopActivityBar: ReactNode;');
    expect(shellTsx).not.toContain('<DesktopTitleBar title="WheelMaker" />');

    expect(shellTsx).toMatch(
      /export function DesktopShell[\s\S]*?desktopWindowControls[\s\S]*?className=\{`workspace theme-\$\{themeMode\}`\}[\s\S]*?\{desktopWindowControls\}[\s\S]*?<div[\s\S]*?className="desktop-shell"[\s\S]*?<aside className="workspace-left">\{sidebar\}<\/aside>/,
    );
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

  test('styles frameless desktop controls and reserves right toolbar space', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toContain('--desktop-window-controls-width: 176px;');
    expect(stylesCss).not.toContain('.desktop-titlebar {');
    expect(stylesCss).not.toContain('.desktop-activity-bar {');

    const controlsBlock = cssRuleBlock(stylesCss, '.desktop-window-controls');
    expect(controlsBlock).toContain('position: fixed;');
    expect(controlsBlock).toContain('top: 0;');
    expect(controlsBlock).toContain('right: 0;');
    expect(controlsBlock).toContain('z-index: 80;');
    expect(controlsBlock).toContain('width: var(--desktop-window-controls-width);');
    expect(controlsBlock).toContain('height: 32px;');

    expect(stylesCss).toContain('.desktop-window-menu-button {');
    expect(stylesCss).toContain('.desktop-window-menu {');
    expect(stylesCss).toContain('.desktop-window-source-panel {');
    expect(stylesCss).toContain('.desktop-window-source-choice {');

    const rightTitleBlock = cssRuleBlock(stylesCss, '.desktop-shell .workspace-right .block-title');
    expect(rightTitleBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');

    const rightChatTitleBlock = cssRuleBlock(stylesCss, '.desktop-shell .workspace-right .chat-title-bar');
    expect(rightChatTitleBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');

    const previewToolbarBlock = cssRuleBlock(stylesCss, '.desktop-shell .preview-workbench-surface.desktop .preview-workbench-toolbar');
    expect(previewToolbarBlock).toContain('padding-right: calc(var(--desktop-window-controls-width) + 10px);');
  });

  test('keeps wide sidebar settings scrollable inside the desktop shell', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toMatch(/const wideSidebarMain = sidebarSettingsOpen\s*\?\s*renderSettingsContent\(false, \{ hideDetailHeader: isSettingsPeerDetail\(settingsDetailView\) \}\)/);
    expect(mainTsx).toContain('<div className="sidebar-scroll">');

    const workspaceLeftBlock = cssRuleBlock(stylesCss, '.workspace-left');
    expect(workspaceLeftBlock).toContain('overflow: hidden;');

    const wideSidebarScrollBlock = cssRuleBlock(stylesCss, '.workspace-left .sidebar-scroll');
    expect(wideSidebarScrollBlock).toContain('overflow-x: hidden;');
    expect(wideSidebarScrollBlock).toContain('overflow-y: auto;');
    expect(wideSidebarScrollBlock).toContain('scrollbar-gutter: auto;');
    expect(wideSidebarScrollBlock).toContain('scrollbar-width: thin;');
    expect(wideSidebarScrollBlock).not.toContain('scrollbar-gutter: stable;');
  });

  test('applies mobile-style settings surfaces inside the desktop sidebar', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    const settingsListBlock = cssRuleBlock(stylesCss, '.workspace-left .settings-list');
    expect(settingsListBlock).toContain('overflow: visible;');
    expect(settingsListBlock).toContain('gap: 18px;');
    expect(settingsListBlock).toContain('padding: 0 10px 16px;');

    const settingsRowsBlock = cssRuleBlock(stylesCss, '.workspace-left .settings-section-rows');
    expect(settingsRowsBlock).toContain('border-radius: 12px;');
    expect(settingsRowsBlock).toContain('background: color-mix(in srgb, var(--panel) 92%, transparent);');

    const settingsRowBlock = cssRuleBlock(stylesCss, '.workspace-left .settings-row');
    expect(settingsRowBlock).toContain('min-height: 54px;');
    expect(settingsRowBlock).toContain('padding: 0 16px;');
    expect(settingsRowBlock).toContain('font-size: 13px;');

    const detailPageBlock = cssRuleBlock(stylesCss, '.workspace-left .settings-detail-page');
    expect(detailPageBlock).toContain('padding: 0 8px 12px;');

    const detailHeaderBlock = cssRuleBlock(stylesCss, '.workspace-left .settings-detail-header');
    expect(detailHeaderBlock).toContain('padding: 6px 4px 8px;');
  });
});
