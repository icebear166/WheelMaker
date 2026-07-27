import fs from 'fs';
import path from 'path';

describe('web session fork state wiring', () => {
  test('applies the authoritative fork response before refreshing and selecting the target', () => {
    const projectRoot = path.join(__dirname, '..');
    const source = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const handlerStart = source.indexOf('const forkPromptDoneEvent = async');
    const handlerEnd = source.indexOf('const renderChatMessageTurn', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const applyIndex = handler.indexOf(
      'rememberChatSessionSummary(selected.projectId, result.session);',
    );
    const refreshIndex = handler.indexOf(
      'await refreshChatProjectSessions(selected.projectId, {force: true});',
    );
    const selectIndex = handler.indexOf(
      'await selectProjectChatSession(selected.projectId, targetSessionId);',
    );

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeGreaterThan(applyIndex);
    expect(selectIndex).toBeGreaterThan(refreshIndex);
  });
});
