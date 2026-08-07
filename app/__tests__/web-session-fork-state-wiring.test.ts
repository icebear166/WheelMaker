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

  test('keeps fork actions attached to completed prompt turns instead of the title bar', () => {
    const projectRoot = path.join(__dirname, '..');
    const source = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(source).not.toContain('const forkCurrentSessionEvent = async');
    expect(source).not.toContain('aria-label="Fork current session"');
    expect(source).toContain('forkSupported={');
    expect(source).toContain("sessionActions?.fork?.historicalTurn === true");
    expect(source).toContain('onForkPromptDone={');
  });
});
