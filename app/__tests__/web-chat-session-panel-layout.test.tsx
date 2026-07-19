import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(__dirname, '..');
const workspaceAppSource = readFileSync(resolve(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');
const chatStyles = readFileSync(resolve(root, 'web/src/styles/chat.css'), 'utf8');

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
