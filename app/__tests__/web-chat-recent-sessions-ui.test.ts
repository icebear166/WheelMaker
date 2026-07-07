import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat recent sessions', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
  const chatCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'chat.css'));

  test('recent sessions section renders at top of the session list', () => {
    expect(mainTsx).toContain('Recent Sessions');
    expect(mainTsx).toContain('renderRecentSessionsSection(false)');
    expect(mainTsx).toContain('renderRecentSessionsSection(true)');
    expect(mainTsx).toContain('recent-sessions-section');
    expect(mainTsx).toContain('recent-sessions-list');
  });

  test('recent sessions section behaves like a collapsible block', () => {
    expect(mainTsx).toContain('RECENT_SESSIONS_VIRTUAL_PROJECT_ID');
    expect(mainTsx).toContain('toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)');
    expect(mainTsx).toContain('codicon-history recent-sessions-icon');
  });

  test('recent sessions reuse the shared builder with an 8-item cap', () => {
    expect(mainTsx).toContain('buildRecentChatSessionRows({');
    expect(mainTsx).toContain('limit: 8,');
    // Right-click quick switch keeps its own 6-item cap.
    expect(mainTsx).toContain('limit: 6,');
  });

  test('recent sessions span all projects, not just visible ones', () => {
    // The recent list must use the full project list (sortedProjectItems) so it
    // stays a global recency jump list even when some projects are hidden.
    expect(mainTsx).toMatch(
      /buildRecentChatSessionRows\(\{[\s\S]*?projects: sortedProjectItems,/,
    );
  });

  test('each recent row shows the project name as a clear marker', () => {
    expect(mainTsx).toContain('recent-session-project-tag');
    expect(mainTsx).toContain('renderRecentSessionRow(row, mobile)');
    expect(chatCss).toContain('.recent-session-project-tag.wide-project-hub-tag');
    // Project name (not hub id) is displayed on the row.
    expect(mainTsx).toContain('{projectName}</span>');
  });

  test('recent sessions refresh only on prompt start / done', () => {
    expect(mainTsx).toContain(
      "if (message.method === 'prompt_request' || message.method === 'prompt_done') {",
    );
    expect(mainTsx).toContain('recentSessionsTick');
  });

  test('recent sessions has a pin toggle that sticks the block to the top', () => {
    // Pin button toggles recentSessionsPinned state.
    expect(mainTsx).toContain('recentSessionsPinned');
    expect(mainTsx).toContain('setRecentSessionsPinned(p => !p)');
    expect(mainTsx).toContain('recent-sessions-pin-btn');
    // Pinned state adds the `pinned` class for sticky positioning.
    expect(mainTsx).toContain("recentSessionsPinned ? ' pinned' : ''");
    // Sticky styling lives in chat.css so the block stays at top while scrolling.
    expect(chatCss).toContain('.recent-sessions-section.pinned');
    expect(chatCss).toContain('position: sticky;');
  });
});
