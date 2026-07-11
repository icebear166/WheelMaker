import fs from 'fs';
import path from 'path';
import {
  CHAT_FONT_OPTIONS,
  DEFAULT_CHAT_FONT,
  isChatFontId,
  resolveChatFontFamily,
} from '../web/src/chat/chatTypography';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web chat font settings', () => {
  test('uses Microsoft YaHei chat text by default while keeping other fonts configurable', () => {
    expect(DEFAULT_CHAT_FONT).toBe('microsoft-yahei');
    expect(CHAT_FONT_OPTIONS.map(option => option.id)).toEqual([
      'microsoft-yahei',
      'system',
      'ibm-plex',
      'serif',
    ]);
    expect(CHAT_FONT_OPTIONS.map(option => option.label)).toContain('Microsoft YaHei');
    expect(resolveChatFontFamily(DEFAULT_CHAT_FONT)).toContain('Segoe UI');
    expect(resolveChatFontFamily(DEFAULT_CHAT_FONT)).toContain('Microsoft YaHei');
    expect(resolveChatFontFamily(DEFAULT_CHAT_FONT).indexOf('Microsoft YaHei')).toBeLessThan(
      resolveChatFontFamily(DEFAULT_CHAT_FONT).indexOf('Microsoft YaHei UI'),
    );
    expect(resolveChatFontFamily('ibm-plex')).toContain('IBM Plex Sans');
    expect(resolveChatFontFamily('ibm-plex')).toContain('Microsoft YaHei');
    expect(resolveChatFontFamily('system')).toContain('Segoe UI');
    expect(resolveChatFontFamily('system')).toContain('Microsoft YaHei UI');
    expect(isChatFontId('microsoft-yahei')).toBe(true);
    expect(isChatFontId('system')).toBe(true);
    expect(isChatFontId('bad-font')).toBe(false);
  });

  test('persists the chat font setting and exposes it only in Chat settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const persistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(persistence).toContain('chatFont: ChatFontId;');
    expect(persistence).toContain("chatFont: 'chatFont',");
    expect(persistence).toContain('chatFont: DEFAULT_CHAT_FONT,');
    expect(persistence).toContain("chatFont: typeof input.chatFont === 'string' && isChatFontId(input.chatFont) ? input.chatFont : base.chatFont");
    expect(persistence).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.chatFont, v: serialize(this.state.global.chatFont), updatedAt}',
    );

    expect(mainTsx).toContain('const [chatFont, setChatFont] = useState<ChatFontId>(');
    expect(mainTsx).toContain('const chatFontFamily = useMemo(');
    expect(mainTsx).toContain('chatFont,');
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'chat'");
    expect(settingsRootTsx).toContain('Chat Font');
    expect(settingsRootTsx).toContain('value={chatFont}');
    expect(settingsRootTsx).toContain('if (isChatFontId(next)) setChatFont(next);');
    expect(settingsRootTsx).toContain('CHAT_FONT_OPTIONS.map(item => (');
    expect(mainTsx).toContain('style={chatMainStyle}');
  });

  test('applies chat font through message CSS without changing code or composer fonts', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("'--chat-message-font-family': chatFontFamily,");
    expect(stylesCss).toContain('--chat-message-text: #e0e4e9;');
    expect(stylesCss).toContain('--chat-message-text: #252c34;');
    expect(stylesCss).toMatch(
      /\.chat-main-message \{[\s\S]*font-family: var\(--chat-message-font-family, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Sans', sans-serif\);[\s\S]*line-height: 1\.58;[\s\S]*color: var\(--chat-message-text, var\(--text-primary\)\);[\s\S]*letter-spacing: 0;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main-message code:not\(\.wm-shiki-code\) \{[\s\S]*font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer-input \{[\s\S]*font: inherit;[\s\S]*font-size: 14px;[\s\S]*\}/,
    );
  });
});
