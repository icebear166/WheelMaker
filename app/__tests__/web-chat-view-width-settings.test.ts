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
    expect(mainTsx).toContain("chatViewWidth === 'fixed-800' ? 'chat-main chat-view-width-fixed-800' : 'chat-main'");
    expect(mainTsx).toContain('chatViewWidth={chatViewWidth}');
    expect(mainTsx).toContain('setChatViewWidth={setChatViewWidth}');

    expect(settingsRootTsx).toContain('chatViewWidth: ChatViewWidth;');
    expect(settingsRootTsx).toContain('setChatViewWidth: (value: ChatViewWidth) => void;');
    expect(settingsRootTsx).toContain('Chat View Width');
    expect(settingsRootTsx).toContain('value={chatViewWidth}');
    expect(settingsRootTsx).toContain('if (isChatViewWidth(next)) setChatViewWidth(next);');
    expect(settingsRootTsx).toContain('CHAT_VIEW_WIDTH_OPTIONS.map(item => (');
    const appearanceStart = settingsRootTsx.indexOf("renderSettingsSection('Appearance'");
    const chatStart = settingsRootTsx.indexOf("renderSettingsSection('Chat'");
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
