import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web chat fixed 800px layout', () => {

  test('fixes responsive session densities without exposing or persisting a preference', () => {
    const projectRoot = path.join(__dirname, '..');
    const densityModulePath = path.join(projectRoot, 'web', 'src', 'chat', 'sessionListDensity.ts');
    const densityModule = readSourceText(densityModulePath);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));
    const stylesCss = readWebStyles(projectRoot);

    expect(fs.existsSync(densityModulePath)).toBe(true);
    const density = require(densityModulePath) as {
      DESKTOP_SESSION_LIST_DENSITY: string;
      MOBILE_SESSION_LIST_DENSITY: string;
    };
    expect(density.DESKTOP_SESSION_LIST_DENSITY).toBe('relaxed');
    expect(density.MOBILE_SESSION_LIST_DENSITY).toBe('relaxed');
    expect(densityModule).not.toContain('SESSION_LIST_DENSITY_OPTIONS');
    expect(densityModule).not.toContain('normalizeSessionListDensity');
    expect(persistence).not.toContain('sessionListDensity');
    expect(settingsRootTsx).not.toContain('Session List Density');
    expect(settingsRootTsx).not.toContain('sessionListDensity');
    expect(mainTsx).not.toContain('const [sessionListDensity');
    expect(mainTsx).not.toContain('setSessionListDensity');
    expect(mainTsx).toContain('dataSessionListDensity={DESKTOP_SESSION_LIST_DENSITY}');
    expect(mainTsx).toContain('dataSessionListDensity={MOBILE_SESSION_LIST_DENSITY}');

    const sessionRowTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionRow.tsx'));
    const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));
    expect(sessionRowTsx).not.toContain('mobile-session-row');
    expect(projectSectionTsx).not.toContain('mobile-project-section');
    expect(projectSectionTsx).not.toContain('mobile-project-row');
    expect(projectSectionTsx).not.toContain('mobile-project-toggle');
    expect(projectSectionTsx).not.toContain('mobile-project-session-list');

    const relaxedTokens = stylesCss.match(/\.wide-project-session-nav,[\s\S]*?\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(relaxedTokens).toContain('--sl-row-py: 5px;');
    expect(relaxedTokens).toContain('--sl-row-font: 12.5px;');
    const compactTokens = cssRuleBlock(stylesCss, '[data-session-list-density="compact"]');
    expect(compactTokens).toContain('--sl-row-py: 3px;');
    expect(compactTokens).not.toContain('--sl-row-font:');
    expect(cssRuleBlock(stylesCss, '.mobile-project-session-nav')).not.toContain('min-height: 30px;');
    expect(stylesCss).not.toContain('.mobile-project-row {');
    expect(stylesCss).not.toContain('.mobile-project-toggle {');
  });

  test('places the chat view width preference in Chat settings instead of the title bar', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));
    const stylesCss = readWebStyles(projectRoot);

    expect(persistence).not.toContain('chatViewWidth');
    expect(settingsRootTsx).toContain('chatColumnWidth: number;');
    expect(settingsRootTsx).toContain('setChatColumnWidth: (value: number) => void;');
    expect(settingsRootTsx).toContain('label="Chat Column Width"');
    expect(settingsRootTsx).toContain('value={String(chatColumnWidth)}');
    expect(settingsRootTsx).toContain('value={CHAT_COLUMN_WIDTH_DEFAULT}');
    expect(settingsRootTsx).toContain('value={CHAT_COLUMN_WIDTH_WIDE}');
    expect(mainTsx).not.toContain('chat-column-width-toggle');
    expect(mainTsx).not.toContain('<SessionIcon name="unfoldHorizontal" />');
    expect(mainTsx).toContain('setChatColumnWidth={setChatColumnWidth}');
    expect(stylesCss).not.toContain('.chat-column-width-toggle');
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("`chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`");
  });

  test('keeps fixed-width chat messages and composer together on desktop', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('className={chatMainClassName}');
    expect(mainTsx).toContain("'chat-view-content'");
    expect((mainTsx.match(/className="chat-view-content chat-empty-state-content"/g) ?? []).length).toBe(3);
    expect(mainTsx).toContain('className="chat-composer-content"');
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-view-content \{[\s\S]*width: min\(var\(--chat-view-column-width, 800px\), 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer-content \{[\s\S]*width: min\(var\(--chat-view-column-width, 800px\), 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main \{[\s\S]*--chat-scrollbar-gutter-width: 8px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer \{[\s\S]*padding-left: 18px;[\s\S]*padding-right: calc\(18px \+ var\(--chat-scrollbar-gutter-width, 8px\)\);[\s\S]*\}/,
    );
    // The composer mirrors the chat-block content box (18px padding + the
    // permanent 8px scrollbar gutter) so both columns center against equal
    // reference widths and cannot drift apart under preview squeeze.
    expect(stylesCss).toMatch(
      /\.chat-block \{[\s\S]*overflow-y: scroll;[\s\S]*scrollbar-gutter: stable;[\s\S]*padding: 18px 18px 0;/,
    );
    expect(stylesCss).not.toContain('.chat-view-width-fixed-800 .chat-scroll-nav');
  });

  test('keeps fixed-width chat centered while preserving preview resize', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const shellTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('CHAT_FIXED_VIEW_WIDTH');
    expect(mainTsx).toContain('availableWidth - chatColumnWidth,');
    expect(mainTsx).toContain('const desktopChatFixedPreview = isWide && chatPreviewOpen;');
    expect(mainTsx).toContain('const [chatFilePeekWidthResized, setChatFilePeekWidthResized] = useState(false);');
    expect(mainTsx).toContain('const fixedChatPreviewDefaultWidth = useMemo(() => {');
    expect(mainTsx).toContain('desktopChatFixedPreview && !chatFilePeekWidthResized');
    expect(mainTsx).toContain('setChatFilePeekWidthResized(true);');
    expect(mainTsx).toContain('clampChatFilePeekWidthForViewport(nextWidth, desktopChatFixedPreview);');
    expect(mainTsx).toContain('desktopChatFixedPreview={desktopChatFixedPreview}');
    expect(shellTsx).toContain('desktopChatFixedPreview: boolean;');
    expect(shellTsx).toContain("data-chat-fixed-preview={desktopChatFixedPreview ? 'true' : undefined}");
    const fixedWorkspace = cssRuleBlock(stylesCss, ".desktop-shell[data-chat-fixed-preview='true'] .workspace-right");
    const fixedPreviewPane = cssRuleBlock(stylesCss, ".desktop-shell[data-chat-fixed-preview='true'] .chat-preview-pane");
    expect(fixedWorkspace).not.toContain('flex: 0 0 800px;');
    expect(fixedPreviewPane).toContain('max-width: none;');
    expect(fixedPreviewPane).not.toContain('flex: 1 1 auto;');
    expect(fixedPreviewPane).not.toContain('width: auto;');
  });

  test('keeps the chat column tier state and layout wiring independent from its settings entry point', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const iconTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'common', 'Icon.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('chatColumnWidth: globalState.chatColumnWidth,');
    expect(mainTsx).toContain('const chatColumnWidth = workspaceUiState.desktop.chatColumnWidth;');
    expect(mainTsx).toContain("'--chat-view-column-width': `${chatColumnWidth}px`,");
    expect(mainTsx).toContain("type: 'desktop/setChatColumnWidth'");
    expect(mainTsx).toContain('      desktopSidebarWidth,\n      chatColumnWidth,');
    expect(iconTsx).toContain('unfoldHorizontal:');
    expect(stylesCss).toContain('width: min(var(--chat-view-column-width, 800px), 100%);');
    expect(stylesCss).toContain('width: min(var(--chat-view-column-width, 800px), calc(100% - 16px));');
    expect(stylesCss).toContain('--chat-fixed-column: min(var(--chat-view-column-width, 800px), max(0px, calc(100% - var(--chat-edge-min-visible))));');
    expect(stylesCss).not.toContain('width: min(800px, 100%);');
    expect(stylesCss).not.toContain('width: min(800px, calc(100% - 16px));');
  });
});
