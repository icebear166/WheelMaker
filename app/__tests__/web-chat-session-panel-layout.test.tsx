import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(__dirname, '..');
const workspaceAppSource = readFileSync(resolve(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');
const chatStyles = readFileSync(resolve(root, 'web/src/styles/chat.css'), 'utf8');
const shellStyles = readFileSync(resolve(root, 'web/src/styles/shell.css'), 'utf8');

function cssRuleBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('\n}', start);
  return end < 0 ? '' : source.slice(start, end + 2);
}

describe('PC chat session-panel layout', () => {
  it('keeps settings and Hub controls in the permanent chat title bar', () => {
    const titleBarStart = workspaceAppSource.indexOf('<DesktopDragRegion className="block-title chat-title-bar">');
    const titleBarSource = titleBarStart >= 0
      ? workspaceAppSource.slice(titleBarStart, titleBarStart + 2600)
      : '';

    expect(titleBarStart).toBeGreaterThanOrEqual(0);
    expect(titleBarSource).toContain('renderChatSessionHeader(false)');
    expect(titleBarSource).not.toContain('chat-sidebar-toggle');
    expect(workspaceAppSource).not.toContain('const desktopTopBar =');
  });

  it('keeps the desktop settings and Hub segment at the shared 360px panel width', () => {
    expect(shellStyles).toMatch(/\.page,\r?\n\.workspace \{[\s\S]*?--chat-session-panel-width: 360px;/);
    const addressRule = cssRuleBlock(chatStyles, '.chat-title-bar > .chat-session-header');
    expect(addressRule).toContain('flex: 0 0 var(--chat-session-panel-width);');
    expect(addressRule).toContain('width: var(--chat-session-panel-width);');
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

  it('keeps the pinned address bar visible above a top-aligned Sessions panel', () => {
    const pinnedStart = workspaceAppSource.indexOf('{showPinnedChatSessionPanel ? (');
    const pinnedSource = workspaceAppSource.slice(pinnedStart, pinnedStart + 2200);

    expect(pinnedSource).toContain('className="chat-pinned-title-bar"');
    expect(pinnedSource).toContain('{renderChatSessionHeader(false)}');
    expect(workspaceAppSource).toContain('{isWide && !desktopChatSessionPinned ? renderChatSessionHeader(false) : null}');
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
    const slideoutRule = cssRuleBlock(chatStyles, '.chat-session-nav-slideout');
    expect(slideoutRule).toContain('top: 12px;');
    expect(slideoutRule).toContain('height: calc(100% - 24px);');
  });

  it('keeps the pinned panel scrollable and positions auxiliary surfaces beside it', () => {
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('display: flex;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('min-height: 0;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-scroll')).toContain('overflow-y: auto;');
    expect(cssRuleBlock(chatStyles, '.chat-edge-surface-stack.beside-pinned-session-panel')).toContain('left: var(--chat-edge-surface-stack-edge-gap);');
  });
});
