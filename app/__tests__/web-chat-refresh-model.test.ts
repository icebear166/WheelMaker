import fs from 'fs';
import path from 'path';

function readMain(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const marker = `const ${functionName} = async`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const arrowStart = source.indexOf('=> {', start);
  expect(arrowStart).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf('{', arrowStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

describe('web chat refresh model', () => {
  test('mobile drawer open does not trigger an online chat session fan-out', () => {
    const main = readMain();

    expect(main).not.toContain("if (isWide || tab !== 'chat' || !drawerOpen || !connected)");
    expect(main).not.toContain('refreshMobileChatProjectSessions().catch(() => undefined);\n  }, [isWide, tab, drawerOpen, connected, projectIdListKey]);');
  });

  test('manual and reconnect refresh use coalesced chat index refresh helpers', () => {
    const main = readMain();

    expect(main).toContain('const refreshChatIndex = async');
    expect(main).toContain('const refreshChatProjectSessions = async');
    expect(main).toContain('chatIndexFullRefreshInFlightRef');
    expect(main).toContain('chatProjectRefreshInFlightRef');
    expect(main).toContain('chatIndexProjectRefreshTargets(');
    expect(main).toContain('options?.skipProjectId,');
    expect(main).toContain('runChatIndexProjectRefreshes(');
    expect(main).toContain('await refreshChatIndex();');
  });

  test('post-connect refresh does not duplicate the active session list load', () => {
    const main = readMain();
    const connectBody = extractFunctionBody(main, 'connect');

    expect(connectBody).not.toContain('loadChatSessions(');
    expect(connectBody).toContain(
      'schedulePostConnectProjectRefresh(preferredSelectedChatKey?.projectId ?? connectedProjectId);',
    );
    expect(main).not.toContain('.listProjectSessions(projectItem.projectId)');
  });

  test('session events use envelope project id and never fall back to workspace project', () => {
    const main = readMain();

    expect(main).toContain('if (!eventProjectId) {');
    expect(main).toContain('projectsRef.current.some(item => item.projectId === eventProjectId)');
    expect(main).toContain('refreshChatProjectSessions(eventProjectId)');
    expect(main).toContain('const runtimeKey = buildChatRuntimeKey(eventProjectId, sessionId);');
    expect(main).not.toContain('const targetProjectId = eventProjectId || projectIdRef.current;');
  });

  test('chat index refresh does not drive the project loading spinner', () => {
    const main = readMain();
    const refreshChatIndexBody = extractFunctionBody(main, 'refreshChatIndex');

    expect(refreshChatIndexBody).toContain('setMobileProjectSessionsRefreshing(true)');
    expect(refreshChatIndexBody).not.toContain('setRefreshingProject(true)');
    expect(refreshChatIndexBody).not.toContain('setRefreshingProject(false)');
  });

  test('project freshness polling and top-level Git refresh are removed', () => {
    const main = readMain();

    expect(main).not.toContain('PROJECT_REFRESH_POLL_INTERVAL_MS');
    expect(main).not.toContain('refreshProject({silent: true})');
    expect(main).not.toContain('service.syncCheck');
    expect(main).not.toContain('const loadGitIfRevChanged = async');
    expect(main).not.toContain('await service.getGitRev()');
  });

  test('new project sessions are cached before selecting the session', () => {
    const main = readMain();
    const body = extractFunctionBody(main, 'handleProjectCreateSession');

    // Draft placeholder is registered and runtime caches are initialized before
    // the draft is selected, so the UI never shows a session with no backing state.
    expect(body.indexOf('updateProjectDraftSessions(targetProjectId, drafts => [draft, ...drafts]);'))
      .toBeLessThan(body.indexOf('selectDraftChatSession(targetProjectId, draft.draftId, options);'));
    expect(body.indexOf('chatMessageStoreRef.current[runtimeKey] = [];'))
      .toBeLessThan(body.indexOf('selectDraftChatSession(targetProjectId, draft.draftId, options);'));
  });

  test('project session lists are never mirrored from unscoped chatSessions state', () => {
    const main = readMain();

    expect(main).toContain('shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)');
    expect(main).toContain('shouldUpdateCurrentProjectSessions(targetProjectId, projectIdRef.current)');
    expect(main).not.toContain('[projectId]: chatSessions');
    expect(main).not.toContain('persistChatSessionsIndex(activeProjectId);');
  });
});
