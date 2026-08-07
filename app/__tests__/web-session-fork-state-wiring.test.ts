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

  test('separates historical fork actions from the last current-session fork', () => {
    const projectRoot = path.join(__dirname, '..');
    const source = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).not.toContain('aria-label="Fork current session"');
    expect(source).toContain('forkSupported={');
    expect(source).toContain("sessionActions?.fork?.historicalTurn === true");
    expect(source).toContain('forkCurrentSessionSupported={');
    expect(source).toContain("sessionActions?.fork?.currentSession === true");
    expect(source).toContain('selectedChatSession?.lastDoneTurnIndex');
    expect(source).toContain('const forkCurrentSessionEvent = async');
    expect(source).toContain('service.forkProjectSession(selected.projectId, selected.sessionId);');
    expect(source).toContain("mode === 'current'");
    expect(source).toContain('onForkPromptDone={');

    const currentGateStart = source.indexOf('const currentSessionForkSupported =');
    const currentGateEnd = source.indexOf('const permissionRecord', currentGateStart);
    const currentGate = source.slice(currentGateStart, currentGateEnd);
    expect(currentGate).toContain("message.method === 'prompt_done'");
    expect(currentGate).toContain('doneTurnIndex === (selectedChatSession?.lastDoneTurnIndex ?? 0)');
    expect(currentGate).toContain("sessionActions?.fork?.currentSession === true");

    const currentHandlerStart = source.indexOf('const forkCurrentSessionEvent = async');
    const currentHandlerEnd = source.indexOf('const renderChatMessageTurn', currentHandlerStart);
    const currentHandler = source.slice(currentHandlerStart, currentHandlerEnd);
    expect(currentHandler).toContain('normalizedTurnIndex !== (selectedChatSession?.lastDoneTurnIndex ?? 0)');
  });
});
