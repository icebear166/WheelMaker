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

test('all mobile standalone destinations are wired into the shell drawer guard', () => {
  expect(workspaceApp).toContain('isMobileStandaloneSurfaceOpen({');
  expect(workspaceApp).toContain('settingsOpen: sidebarSettingsOpen');
  expect(workspaceApp).toContain('releasePublishingOpen');
  expect(workspaceApp).toContain('portRelayOpen: portRelayScreenOpen');
  expect(workspaceApp).toContain('sharesOpen: sharesScreenOpen');
  expect(workspaceApp).toContain('portRelayFrameOpen: mobilePortRelayFrameOpen');
  expect(workspaceApp).toContain('mobileStandaloneSurfaceOpen={mobileStandaloneSurfaceOpen}');
});

test('mobile Chat title bar reuses the Drawer WheelMaker logo menu and geometry', () => {
  const renderChatTitleBar = sourceBetween(
    workspaceApp,
    'const renderChatTitleBar',
    'const renderMain',
  );

  expect(renderChatTitleBar).toContain('{!mobile ? renderChatSessionHeader(false) : null}');
  expect(renderChatTitleBar).toContain('{mobile ? renderWheelMakerAppMenu(true) : null}');
  const mobileChatTitleStyles = sourceBetween(
    chatStyles,
    '.narrow-shell .chat-title-bar {',
    '.chat-title-bar > .chat-session-header',
  );
  expect(mobileChatTitleStyles).toContain('gap: 0px;');
  expect(mobileChatTitleStyles).toContain('flex: 0 0 calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
  expect(mobileChatTitleStyles).toContain('padding: var(--wm-safe-area-top) 8px 0;');
  expect(chatStyles).toContain('.narrow-shell .chat-title-bar .chat-title-project-button {');
  expect(chatStyles).toContain('padding-left: 2px;');
});

test('mobile top-level menus own an exclusive layer instead of the drawer', () => {
  const sessionHeaderStart = workspaceApp.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
  const sessionHeaderEnd = workspaceApp.indexOf('const renderMobileChatSessionSheet = () => {', sessionHeaderStart);
  const sessionHeader = workspaceApp.slice(sessionHeaderStart, sessionHeaderEnd);
  const mobileBreadcrumbStart = workspaceApp.indexOf('const renderMobileChatBreadcrumbTitle = () => (');
  const mobileBreadcrumbEnd = workspaceApp.indexOf('const renderChatTitleBar = (mobile: boolean) => (', mobileBreadcrumbStart);
  const mobileBreadcrumb = workspaceApp.slice(mobileBreadcrumbStart, mobileBreadcrumbEnd);
  const mobileProjectActionStart = workspaceApp.indexOf('const openMobileProjectActionMenu = useCallback(');
  const mobileProjectActionEnd = workspaceApp.indexOf('const projectSessionActionKey', mobileProjectActionStart);
  const mobileProjectAction = workspaceApp.slice(mobileProjectActionStart, mobileProjectActionEnd);

  expect(sessionHeader).not.toContain('mobile ? renderWheelMakerAppMenu(true) : (');
  expect(workspaceApp).toContain('onMenuOpen={mobile ? closeMobileDrawerForTopLevelSurface : undefined}');
  expect(workspaceApp).toContain('const closeMobileDrawerForTopLevelSurface = useCallback(() => {');
  expect(workspaceApp).toContain('closeSidebarTransientMenus();');
  expect(workspaceApp).toContain('setDrawerOpen(false);');
  expect(mobileBreadcrumb).toContain('if (nextOpen && !isWide) closeMobileDrawerForTopLevelSurface();');
  expect(workspaceApp).toContain('if (nextOpen && !isWide) closeMobileDrawerForTopLevelSurface();');
  expect(mobileProjectAction).toContain('closeMobileDrawerForTopLevelSurface();');
});
