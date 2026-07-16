import fs from 'fs';
import path from 'path';

import {
  CHAT_VIEW_WIDTH_OPTIONS,
  DEFAULT_CHAT_VIEW_WIDTH,
  isChatViewWidth,
  normalizeChatViewWidth,
} from '../web/src/chat/chatViewWidth';
import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web chat view width settings', () => {
  test('defines full and fixed-width chat view choices', () => {
    expect(DEFAULT_CHAT_VIEW_WIDTH).toBe('fixed-800');
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.id)).toEqual(['full', 'fixed-800']);
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.label)).toEqual(['Full', '800px']);
    expect(isChatViewWidth('full')).toBe(true);
    expect(isChatViewWidth('fixed-800')).toBe(true);
    expect(isChatViewWidth('760')).toBe(false);
    expect(normalizeChatViewWidth('fixed-560')).toBe('fixed-800');
    expect(normalizeChatViewWidth('bad-width')).toBe(DEFAULT_CHAT_VIEW_WIDTH);
    expect(normalizeChatViewWidth(undefined)).toBe('fixed-800');
  });

  test('defines relaxed desktop session density and persists it without changing mobile density', () => {
    const projectRoot = path.join(__dirname, '..');
    const densityModulePath = path.join(projectRoot, 'web', 'src', 'chat', 'sessionListDensity.ts');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));
    const stylesCss = readWebStyles(projectRoot);

    expect(fs.existsSync(densityModulePath)).toBe(true);
    const density = require(densityModulePath) as {
      DEFAULT_SESSION_LIST_DENSITY: string;
      SESSION_LIST_DENSITY_OPTIONS: Array<{id: string; label: string}>;
      isSessionListDensity: (value: unknown) => boolean;
      normalizeSessionListDensity: (value: unknown, fallback?: string) => string;
    };
    expect(density.DEFAULT_SESSION_LIST_DENSITY).toBe('relaxed');
    expect(density.SESSION_LIST_DENSITY_OPTIONS).toEqual([
      {id: 'relaxed', label: 'Relaxed'},
      {id: 'compact', label: 'Compact'},
    ]);
    expect(density.isSessionListDensity('relaxed')).toBe(true);
    expect(density.isSessionListDensity('compact')).toBe(true);
    expect(density.isSessionListDensity('mobile')).toBe(false);
    expect(density.normalizeSessionListDensity('invalid')).toBe('relaxed');
    expect(density.normalizeSessionListDensity(undefined, 'compact')).toBe('compact');

    expect(persistence).toContain('sessionListDensity: SessionListDensity;');
    expect(persistence).toContain("sessionListDensity: 'sessionListDensity',");
    expect(persistence).toContain('sessionListDensity: DEFAULT_SESSION_LIST_DENSITY,');
    expect(persistence).toContain('sessionListDensity: normalizeSessionListDensity(input.sessionListDensity, base.sessionListDensity),');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.sessionListDensity, v: serialize(this.state.global.sessionListDensity), updatedAt}',
    );

    expect(mainTsx).toContain('const [sessionListDensity, setSessionListDensity] = useState<SessionListDensity>(');
    expect(mainTsx).toContain('normalizeSessionListDensity(persistedGlobal.sessionListDensity)');
    expect(mainTsx).toContain('sessionListDensity,');
    expect(mainTsx).toContain('sessionListDensity={sessionListDensity}');
    expect(mainTsx).toContain('setSessionListDensity={setSessionListDensity}');
    expect(mainTsx).toContain('dataSessionListDensity={sessionListDensity}');

    expect(settingsRootTsx).toContain('sessionListDensity: SessionListDensity;');
    expect(settingsRootTsx).toContain('setSessionListDensity: (value: SessionListDensity) => void;');
    expect(settingsRootTsx).toContain('Session List Density');
    expect(settingsRootTsx).toContain('value={sessionListDensity}');
    expect(settingsRootTsx).toContain('if (isSessionListDensity(next)) setSessionListDensity(next);');
    expect(settingsRootTsx).toContain('SESSION_LIST_DENSITY_OPTIONS.map(item => (');
    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const densitySettingStart = settingsRootTsx.indexOf('Session List Density');
    expect(densitySettingStart).toBeGreaterThan(chatStart);
    expect(settingsRootTsx.slice(chatStart, densitySettingStart)).toContain('isWide ? (');

    const relaxedRow = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='relaxed'] .wide-session-row",
    );
    const compactRow = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='compact'] .wide-session-row",
    );
    const relaxedTitle = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='relaxed'] .wide-session-title",
    );
    const compactTitle = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='compact'] .wide-session-title",
    );
    expect(relaxedRow).toContain('min-height: 30px;');
    expect(compactRow).toContain('min-height: 28px;');
    expect(relaxedTitle).toContain('font-size: 13.5px;');
    expect(relaxedTitle).toContain('line-height: 1.25;');
    expect(compactTitle).toContain('font-size: 13px;');
    expect(compactTitle).toContain('line-height: 1.35;');
    expect(cssRuleBlock(stylesCss, '.mobile-session-row')).toContain('min-height: 30px;');
  });

  test('persists chat view width and exposes it in PC Appearance settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));

    expect(persistence).toContain('chatViewWidth: ChatViewWidth;');
    expect(persistence).toContain("chatViewWidth: 'chatViewWidth',");
    expect(persistence).toContain('chatViewWidth: DEFAULT_CHAT_VIEW_WIDTH,');
    expect(persistence).toContain('chatViewWidth: normalizeChatViewWidth(input.chatViewWidth, base.chatViewWidth),');
    expect(persistence).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.chatViewWidth, v: serialize(this.state.global.chatViewWidth), updatedAt}',
    );

    expect(mainTsx).toContain('const [chatViewWidth, setChatViewWidth] = useState<ChatViewWidth>(');
    expect(mainTsx).toContain('normalizeChatViewWidth(persistedGlobal.chatViewWidth)');
    expect(mainTsx).toContain('chatViewWidth,');
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("chatViewWidth === 'fixed-800' ? `chat-main chat-view-width-fixed-800${showPinnedRecentSessionsSurface ? ' chat-view-width-fixed-800-pinned-recent' : ''}` : 'chat-main'");
    expect(mainTsx).toContain('chatViewWidth={chatViewWidth}');
    expect(mainTsx).toContain('setChatViewWidth={setChatViewWidth}');

    expect(settingsRootTsx).toContain('chatViewWidth: ChatViewWidth;');
    expect(settingsRootTsx).toContain('setChatViewWidth: (value: ChatViewWidth) => void;');
    expect(settingsRootTsx).toContain('Chat View Width');
    expect(settingsRootTsx).toContain('value={chatViewWidth}');
    expect(settingsRootTsx).toContain('if (isChatViewWidth(next)) setChatViewWidth(next);');
    expect(settingsRootTsx).toContain('CHAT_VIEW_WIDTH_OPTIONS.map(item => (');
    const appearanceStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'appearance'");
    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const settingStart = settingsRootTsx.indexOf('Chat View Width');
    expect(appearanceStart).toBeGreaterThanOrEqual(0);
    expect(chatStart).toBeGreaterThan(appearanceStart);
    expect(settingStart).toBeGreaterThan(appearanceStart);
    expect(settingStart).toBeLessThan(chatStart);
    expect(settingsRootTsx.slice(appearanceStart, chatStart)).toContain('isWide ? (');
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
      /\.chat-view-width-fixed-800 \.chat-view-content \{[\s\S]*width: min\(800px, 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer-content \{[\s\S]*width: min\(800px, 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main \{[\s\S]*--chat-scrollbar-gutter-width: 8px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-800 \.chat-composer \{[\s\S]*padding-left: 18px;[\s\S]*padding-right: calc\(18px \+ var\(--chat-scrollbar-gutter-width, 8px\)\);[\s\S]*\}/,
    );
    const scrollBottomButtonBlock = cssRuleBlock(stylesCss, '.chat-view-width-fixed-800 .chat-scroll-bottom-button');
    expect(scrollBottomButtonBlock).toContain('right: max(');
    expect(scrollBottomButtonBlock).toContain('calc(18px + var(--chat-scrollbar-gutter-width, 8px)),');
    expect(scrollBottomButtonBlock).toContain('calc((100% - 800px) / 2 + calc(var(--chat-scrollbar-gutter-width, 8px) / 2))');
  });

  test('keeps fixed-width chat centered while preserving preview resize', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const shellTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const CHAT_FIXED_VIEW_WIDTH = 800;');
    expect(mainTsx).toContain("const desktopChatFixedPreview = isWide && chatPreviewOpen && chatViewWidth === 'fixed-800';");
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
});
