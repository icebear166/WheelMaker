import fs from 'fs';
import path from 'path';

describe('web chat session navigation expansion', () => {
  test('renders every known project session without local expansion batching', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const styles = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'styles.css'), 'utf8');

    expect(main).not.toContain('Show more');
    expect(main).not.toContain('WIDE_PROJECT_SESSION_LIMIT');
    expect(main).not.toContain('wideProjectVisibleCounts');
    expect(main).not.toContain('projectSessionSentinelRefs');
    expect(main).not.toContain('new IntersectionObserver');
    expect(main).not.toContain('wide-project-session-sentinel');
    expect(styles).not.toContain('.wide-project-session-sentinel');
    expect(main).toContain('const renderProjectSessionRowsWithOlderFolding = (');
    expect(main).toContain('renderProjectSessionRowsWithOlderFolding(targetProjectId, projectSessions, true)');
    expect(main).toContain('renderProjectSessionRowsWithOlderFolding(targetProjectId, projectSessions, false)');
    expect(main).toContain('selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, session.sessionId)');
  });
});
