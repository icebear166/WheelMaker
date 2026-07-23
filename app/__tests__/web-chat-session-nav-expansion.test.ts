import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web chat session navigation expansion', () => {
  test('renders every known project session without local expansion batching', () => {
    const projectRoot = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const styles = readWebStyles(projectRoot);

    expect(main).not.toContain('Show more');
    expect(main).not.toContain('WIDE_PROJECT_SESSION_LIMIT');
    expect(main).not.toContain('wideProjectVisibleCounts');
    expect(main).not.toContain('projectSessionSentinelRefs');
    expect(main).not.toContain('new IntersectionObserver');
    expect(main).not.toContain('wide-project-session-sentinel');
    expect(styles).not.toContain('.wide-project-session-sentinel');
    const listView = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'), 'utf8');
    expect(main).toContain('splitOlder: (targetProjectId: string');
    expect(listView).toContain('split.visibleSessions.map(session => renderRow(projectId, session, false))');
    expect(listView).toContain('props.selectedChatEncodedKey === props.runtimeKey(projectId, session.sessionId)');
  });
});
