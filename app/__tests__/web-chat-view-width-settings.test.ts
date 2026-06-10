import fs from 'fs';
import path from 'path';

import {
  CHAT_VIEW_WIDTH_OPTIONS,
  DEFAULT_CHAT_VIEW_WIDTH,
  isChatViewWidth,
} from '../web/src/chat/chatViewWidth';
import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat view width settings', () => {
  test('defines full and fixed-width chat view choices', () => {
    expect(DEFAULT_CHAT_VIEW_WIDTH).toBe('full');
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.id)).toEqual(['full', 'fixed-560']);
    expect(CHAT_VIEW_WIDTH_OPTIONS.map(option => option.label)).toEqual(['Full', '560px']);
    expect(isChatViewWidth('full')).toBe(true);
    expect(isChatViewWidth('fixed-560')).toBe(true);
    expect(isChatViewWidth('760')).toBe(false);
  });

  test('persists chat view width and exposes it in PC Appearance settings', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const persistence = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));

    expect(persistence).toContain('chatViewWidth: ChatViewWidth;');
    expect(persistence).toContain("chatViewWidth: 'chatViewWidth',");
    expect(persistence).toContain('chatViewWidth: DEFAULT_CHAT_VIEW_WIDTH,');
    expect(persistence).toContain("chatViewWidth: typeof input.chatViewWidth === 'string' && isChatViewWidth(input.chatViewWidth) ? input.chatViewWidth : base.chatViewWidth");
    expect(persistence).toContain('{k: GLOBAL_KEYS.chatViewWidth, v: serialize(next.chatViewWidth), updatedAt: now}');

    expect(mainTsx).toContain('const [chatViewWidth, setChatViewWidth] = useState<ChatViewWidth>(');
    expect(mainTsx).toContain('chatViewWidth,');
    expect(mainTsx).toContain('const chatMainClassName = isWide');
    expect(mainTsx).toContain("chatViewWidth === 'fixed-560' ? 'chat-main chat-view-width-fixed-560' : 'chat-main'");
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

  test('centers fixed-width chat messages on desktop without changing the composer', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('className={chatMainClassName}');
    expect(mainTsx).toContain("'chat-view-content'");
    expect(stylesCss).toMatch(
      /\.chat-view-width-fixed-560 \.chat-view-content \{[\s\S]*width: min\(560px, 100%\);[\s\S]*margin-left: auto;[\s\S]*margin-right: auto;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('.chat-view-width-fixed-560 .chat-composer');
  });
});
