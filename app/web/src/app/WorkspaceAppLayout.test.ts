declare const __dirname: string;
declare function require(moduleName: string): unknown;

const {readFileSync} = require('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const {resolve} = require('path') as {
  resolve(...paths: string[]): string;
};

const workspaceApp = readFileSync(resolve(__dirname, 'WorkspaceApp.tsx'), 'utf8');
const chatStyles = readFileSync(resolve(__dirname, '../styles/chat.css'), 'utf8');

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex >= 0 ? source.slice(startIndex, endIndex) : '';
}

test('opening settings from the app menu closes the mobile drawer immediately', () => {
  const openSettingsRoot = sourceBetween(
    workspaceApp,
    'const openSettingsRoot',
    'const openReleasePublishing',
  );

  expect(openSettingsRoot).toContain('setDrawerOpen(false);');
});

test('mobile Chat title bar reuses the Drawer WheelMaker logo menu and geometry', () => {
  const renderChatTitleBar = sourceBetween(
    workspaceApp,
    'const renderChatTitleBar',
    'const renderMain',
  );

  expect(renderChatTitleBar).toContain('{!mobile ? renderChatSessionHeader(false) : null}');
  expect(renderChatTitleBar).toContain('{mobile ? renderWheelMakerAppMenu(true) : null}');
  expect(chatStyles).toContain('.narrow-shell .chat-title-bar {');
  expect(chatStyles).toContain('flex: 0 0 calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
  expect(chatStyles).toContain('padding: var(--wm-safe-area-top) 8px 0;');
});
