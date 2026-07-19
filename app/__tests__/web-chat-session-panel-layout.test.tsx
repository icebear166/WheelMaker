import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(__dirname, '..');
const workspaceAppSource = readFileSync(resolve(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');
const responsiveShellSource = readFileSync(resolve(root, 'web/src/shell/ResponsiveShell.tsx'), 'utf8');
const sessionGlobalBarSource = readFileSync(resolve(root, 'web/src/chat/ChatSessionGlobalBar.tsx'), 'utf8');
const chatStyles = readFileSync(resolve(root, 'web/src/styles/chat.css'), 'utf8');
const shellStyles = readFileSync(resolve(root, 'web/src/styles/shell.css'), 'utf8');

function cssRuleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n}', start);
  return end < 0 ? '' : source.slice(start, end + 2);
}

describe('PC chat session-panel layout', () => {
  it('renders one permanent desktop chat title bar above both the sidebar and chat body', () => {
    expect(responsiveShellSource).toContain('desktopTopBar: ReactNode;');
    expect(responsiveShellSource).toContain('<div className="desktop-primary-workspace">');
    expect(responsiveShellSource).toContain('{desktopTopBar}');
    expect(workspaceAppSource).toContain("const desktopTopBar = isWide && tab === 'chat' ? renderChatTitleBar(false) : null;");
    expect(workspaceAppSource).toContain('desktopTopBar={desktopTopBar}');
    expect(workspaceAppSource).not.toContain('chat-pinned-title-bar');
    expect(workspaceAppSource).not.toContain('!desktopChatSessionPinned ? renderChatSessionHeader(false)');
  });

  it('keeps the desktop settings and Hub segment at the shared 360px panel width', () => {
    expect(shellStyles).toMatch(/\.page,\r?\n\.workspace \{[\s\S]*?--chat-session-panel-width: 360px;/);
    const addressRule = cssRuleBlock(chatStyles, '.chat-title-bar > .chat-session-header');
    expect(addressRule).toContain('flex: 0 0 var(--chat-session-panel-width);');
    expect(addressRule).toContain('width: var(--chat-session-panel-width);');
    expect(addressRule).toContain('padding: 0 8px;');
    expect(cssRuleBlock(chatStyles, '.chat-main')).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
  });

  it('does not let desktop session search change the settings and Hub segment', () => {
    const headerStart = workspaceAppSource.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const headerEnd = workspaceAppSource.indexOf('const renderMobileChatSessionSheet = () => {', headerStart);
    const headerSource = workspaceAppSource.slice(headerStart, headerEnd);

    expect(headerSource).toContain('const searchHeaderExpanded = mobile && sessionSearchHeaderExpanded;');
    expect(headerSource).toContain("${searchHeaderExpanded ? ' search-open' : ''}");
    expect(headerSource).toContain('{!searchHeaderExpanded ? (');
  });

  it('keeps the pinned Sessions panel below the permanent shell title bar', () => {
    const pinnedStart = workspaceAppSource.indexOf('{showPinnedChatSessionPanel ? (');
    const pinnedSource = workspaceAppSource.slice(pinnedStart, pinnedStart + 2200);

    expect(pinnedSource).not.toContain('className="chat-pinned-title-bar"');
    expect(pinnedSource).not.toContain('{renderChatSessionHeader(false)}');
    expect(chatStyles).not.toContain('.chat-session-panel-pinned .chat-session-panel-header');
  });

  it('pins the Chat session sidebar at 360px without changing resizable non-Chat sidebars', () => {
    expect(workspaceAppSource).toContain('const CHAT_SESSION_PANEL_WIDTH = 360;');
    expect(workspaceAppSource).toContain('const desktopLayoutSidebarWidth = desktopChatSessionPinned');
    expect(workspaceAppSource).toContain('desktopSidebarWidth={desktopLayoutSidebarWidth}');
    expect(workspaceAppSource).toContain('{isWide && !showPinnedChatSessionPanel ? (');
  });

  it('uses the shared panel for both fixed and slide-out session navigation', () => {
    expect(workspaceAppSource).toContain("import {ChatSessionPanel} from '../chat/ChatSessionPanel';");
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="pinned"\s+title="Sessions"/);
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="slideout"\s+title="Sessions"/);
  });

  it('keeps a floating session entry point when there are no recent sessions', () => {
    expect(workspaceAppSource).toContain("const showFloatingSessionPanel = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive;");
    expect(workspaceAppSource).toContain('{showFloatingSessionPanel ? (');
  });

  it('hides the auxiliary surface stack while the full session panel is open', () => {
    expect(workspaceAppSource).toContain("${sessionNavSlideOut.open ? ' covered-by-session-panel' : ''}");
    const coveredRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack.covered-by-session-panel');
    expect(coveredRule).toContain('visibility: hidden;');
    expect(coveredRule).toContain('pointer-events: none;');
  });

  it('positions desktop session surfaces from the chat area below the permanent title bar', () => {
    expect(chatStyles).not.toContain('.chat-edge-surface-stack.below-top-bar');
    const stackRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack');
    expect(stackRule).toContain('--chat-edge-surface-stack-edge-gap: 0px;');
    expect(stackRule).toContain('top: 0;');
    expect(stackRule).toContain('left: 0;');
    const slideoutRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout');
    expect(slideoutRule).toContain('top: 0;');
    expect(slideoutRule).toContain('left: 0;');
    expect(slideoutRule).toContain('height: 100%;');
    expect(slideoutRule).toContain('border-radius: 0;');
    const slideoutGlassRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout .chat-edge-surface-glass');
    expect(slideoutGlassRule).toContain('border: 0;');
    expect(slideoutGlassRule).toContain('box-shadow: none;');
    expect(slideoutGlassRule).toContain('background: var(--desktop-top-surface);');
  });

  it('uses the pinned Recent project presentation inside the unpinned surface', () => {
    const floatingStart = workspaceAppSource.indexOf('{showFloatingSessionPanel ? (');
    const floatingSource = workspaceAppSource.slice(floatingStart, floatingStart + 2200);
    expect(floatingSource).toContain('{renderRecentSessionsSection(false)}');
    expect(floatingSource).not.toContain('recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))');
    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface-list')).toContain('padding: 8px 7px 16px;');
  });

  it('gives the expanded unpinned Recent surface the pinned flat sidebar material', () => {
    expect(cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded')).toContain('border-radius: 0;');
    const glassRule = cssRuleBlock(chatStyles, '.chat-recent-sessions-surface.desktop.expanded .chat-edge-surface-glass');
    expect(glassRule).toContain('border: 0;');
    expect(glassRule).toContain('box-shadow: none;');
    expect(glassRule).toContain('background: var(--desktop-top-surface);');
    expect(glassRule).toContain('backdrop-filter: none;');
  });

  it('keeps the pin control in the first stable action slot', () => {
    expect(sessionGlobalBarSource.indexOf('{onTogglePin ? (')).toBeLessThan(
      sessionGlobalBarSource.indexOf('{onToggleSlideOut ? ('),
    );
  });

  it('adds three pixels of breathing room to every desktop session row', () => {
    expect(cssRuleBlock(chatStyles, '.wide-project-session-list')).toContain('padding: 1px 0 1px 11px;');
  });

  it('keeps the pinned panel scrollable and positions auxiliary surfaces beside it', () => {
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('display: flex;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('min-height: 0;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-scroll')).toContain('overflow-y: auto;');
    const pinnedStackRule = cssRuleBlock(chatStyles, '.chat-edge-surface-stack.beside-pinned-session-panel');
    expect(pinnedStackRule).toContain('top: 0;');
    expect(pinnedStackRule).toContain('left: 0;');
  });
});
