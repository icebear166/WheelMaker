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

  test('exposes current-session fork from the negotiated capability without a turn index', () => {
    const projectRoot = path.join(__dirname, '..');
    const source = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).toContain("sessionActions?.fork?.currentSession === true");
    expect(source).toContain('(selectedChatSession?.lastDoneTurnIndex ?? 0) > 0');
    expect(source).toContain('const forkCurrentSessionEvent = async');
    expect(source).toContain('(selectedChatSession?.lastDoneTurnIndex ?? 0) <= 0');
    expect(source).toContain('service.forkProjectSession(selected.projectId, selected.sessionId)');
    expect(source).toContain('Fork current session');
  });
});
