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
  it('uses the shared panel for both fixed and slide-out session navigation', () => {
    expect(workspaceAppSource).toContain("import {ChatSessionPanel} from '../chat/ChatSessionPanel';");
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="pinned"\s+title="Sessions"/);
    expect(workspaceAppSource).toMatch(/<ChatSessionPanel\s+mode="slideout"\s+title="Sessions"/);
  });

  it('keeps a floating session entry point when there are no recent sessions', () => {
    expect(workspaceAppSource).toContain("const showFloatingSessionPanel = isWide && sidebarCollapsed && !archivedMode && !sessionSearchActive;");
    expect(workspaceAppSource).toContain('{showFloatingSessionPanel ? (');
  });

  it('keeps the pinned panel scrollable and positions auxiliary surfaces beside it', () => {
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('display: flex;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-pinned')).toContain('min-height: 0;');
    expect(cssRuleBlock(chatStyles, '.chat-session-panel-scroll')).toContain('overflow-y: auto;');
    expect(cssRuleBlock(chatStyles, '.chat-edge-surface-stack.beside-pinned-session-panel')).toContain('left: var(--chat-edge-surface-stack-edge-gap);');
  });
});
