import fs from 'fs';
import path from 'path';

function readMain(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const marker = `const ${functionName} = async`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const arrowStart = source.indexOf(') => {', start);
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
    expect(main).toContain('await refreshChatIndex();');
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

  test('silent project freshness polling runs at a 30 second cadence', () => {
    const main = readMain();

    expect(main).toContain('const PROJECT_REFRESH_POLL_INTERVAL_MS = 30_000;');
    expect(main).toContain('}, PROJECT_REFRESH_POLL_INTERVAL_MS);');
    expect(main).not.toContain('}, 15000);');
  });

  test('new project sessions are cached before selecting the session', () => {
    const main = readMain();
    const body = extractFunctionBody(main, 'handleProjectCreateSession');

    expect(body.indexOf('workspaceStore.rememberChatSession(targetProjectId, session, {turnIndex: 0});'))
      .toBeLessThan(body.indexOf('await selectProjectChatSession(targetProjectId, session.sessionId, options);'));
    expect(body.indexOf('setProjectSessionsByProjectId(prev => ({'))
      .toBeLessThan(body.indexOf('await selectProjectChatSession(targetProjectId, session.sessionId, options);'));
    expect(body.indexOf('chatMessageStoreRef.current[runtimeKey] = [];'))
      .toBeLessThan(body.indexOf('await selectProjectChatSession(targetProjectId, session.sessionId, options);'));
  });

  test('project session lists are never mirrored from unscoped chatSessions state', () => {
    const main = readMain();

    expect(main).toContain('shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)');
    expect(main).toContain('shouldUpdateCurrentProjectSessions(targetProjectId, projectIdRef.current)');
    expect(main).not.toContain('[projectId]: chatSessions');
    expect(main).not.toContain('persistChatSessionsIndex(activeProjectId);');
  });
});
