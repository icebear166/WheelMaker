import fs from 'fs';
import path from 'path';
import { RegistryRepository } from '../web/src/registry/RegistryRepository';

function projectRoot(): string {
  return path.join(__dirname, '..');
}

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function extractConstFunctionBody(source: string, functionName: string): string {
  const marker = `const ${functionName}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const arrowStart = source.indexOf('=> {', start);
  expect(arrowStart).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf('{', arrowStart);
  expect(bodyStart).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function loadDraftSessionModule(): any {
  const helperPath = path.join(projectRoot(), 'web', 'src', 'chat', 'session', 'chatDraftSessions.ts');
  expect(fs.existsSync(helperPath)).toBe(true);
  return require(helperPath);
}

describe('web chat draft sessions', () => {
  test('creates frontend-only draft sessions with explicit lifecycle states', () => {
    const {
      DRAFT_CHAT_SESSION_ID_PREFIX,
      canStartDraftChatSessionCreate,
      createDraftChatSession,
      isDraftChatSessionId,
      markDraftChatSessionFailed,
      markDraftChatSessionSending,
    } = loadDraftSessionModule();

    const draft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Codex',
      nowIso: '2026-06-12T08:00:00.000Z',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}fixed`,
    });

    expect(draft).toEqual({
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}fixed`,
      projectId: 'project-a',
      agentType: 'Codex',
      title: 'New Codex session',
      createdAt: '2026-06-12T08:00:00.000Z',
      updatedAt: '2026-06-12T08:00:00.000Z',
      status: 'creating',
      errorMessage: '',
    });
    expect(isDraftChatSessionId(draft.draftId)).toBe(true);
    expect(isDraftChatSessionId('real-session-id')).toBe(false);

    expect(markDraftChatSessionSending(draft)).toMatchObject({
      draftId: draft.draftId,
      status: 'sendingFirstPrompt',
      errorMessage: '',
    });
    expect(markDraftChatSessionFailed(draft, 'create failed')).toMatchObject({
      draftId: draft.draftId,
      status: 'failed',
      errorMessage: 'create failed',
    });
    expect(canStartDraftChatSessionCreate(draft)).toBe(true);
    expect(canStartDraftChatSessionCreate(markDraftChatSessionSending(draft))).toBe(true);
    expect(canStartDraftChatSessionCreate(markDraftChatSessionFailed(draft, 'create failed'))).toBe(false);
  });

  test('replaces selected draft keys only when the user is still on that draft', () => {
    const {
      DRAFT_CHAT_SESSION_ID_PREFIX,
      createDraftChatSession,
      removeDraftChatSession,
      resolveDraftReplacementSelection,
    } = loadDraftSessionModule();
    const draft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Codex',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}selected`,
      nowIso: '2026-06-12T08:00:00.000Z',
    });
    const drafts = [
      draft,
      createDraftChatSession({
        projectId: 'project-a',
        agentType: 'Claude',
        draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}other`,
        nowIso: '2026-06-12T08:01:00.000Z',
      }),
    ];

    expect(removeDraftChatSession(drafts, draft.draftId).map((item: any) => item.draftId))
      .toEqual([`${DRAFT_CHAT_SESSION_ID_PREFIX}other`]);
    expect(resolveDraftReplacementSelection({
      currentSelectedKey: {projectId: 'project-a', sessionId: draft.draftId},
      draft,
      realSessionId: 'real-session',
    })).toEqual({projectId: 'project-a', sessionId: 'real-session'});
    const unrelatedSelection = {projectId: 'project-a', sessionId: 'another-session'};
    expect(resolveDraftReplacementSelection({
      currentSelectedKey: unrelatedSelection,
      draft,
      realSessionId: 'real-session',
    })).toBe(unrelatedSelection);
    expect(resolveDraftReplacementSelection({
      currentSelectedKey: null,
      draft,
      realSessionId: 'real-session',
    })).toBeNull();
  });

  test('matches a late created session to the draft that initiated it', () => {
    const {
      DRAFT_CHAT_SESSION_ID_PREFIX,
      createDraftChatSession,
      findDraftChatSessionForCreatedSession,
    } = loadDraftSessionModule();
    const matchingDraft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Codex',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}matching`,
      nowIso: '2026-07-13T08:00:00.000Z',
    });
    const otherDraft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Codex',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}other`,
      nowIso: '2026-07-13T08:00:01.000Z',
    });

    expect(findDraftChatSessionForCreatedSession(
      [otherDraft, matchingDraft],
      {sessionId: 'real-session', createRequestId: matchingDraft.draftId},
    )).toBe(matchingDraft);
    expect(findDraftChatSessionForCreatedSession(
      [matchingDraft],
      {sessionId: 'unrelated-session'},
    )).toBeUndefined();
  });

  test('carries the draft id through session.create and normalized session lists', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        payload: {
          ok: true,
          session: {
            sessionId: 'real-session',
            title: '',
            preview: '',
            updatedAt: '2026-07-13T08:00:02Z',
            messageCount: 0,
            agentType: 'codex',
            createRequestId: 'draft-request-1',
          },
        },
      })
      .mockResolvedValueOnce({
        payload: {
          sessions: [{
            sessionId: 'real-session',
            title: '',
            preview: '',
            updatedAt: '2026-07-13T08:00:02Z',
            messageCount: 0,
            agentType: 'codex',
            createRequestId: 'draft-request-1',
          }],
        },
      });
    const repository = new RegistryRepository({request} as never);

    const created = await repository.createSession('project-a', 'codex', '', 'draft-request-1');
    const listed = await repository.listSessions('project-a');

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'session.create',
      projectId: 'project-a',
      payload: {agentType: 'codex', createRequestId: 'draft-request-1'},
    }));
    expect(created.session.createRequestId).toBe('draft-request-1');
    expect(listed[0].createRequestId).toBe('draft-request-1');
  });

  test('wires draft sessions without adding backend protocol operations to draft rows', () => {
    const root = projectRoot();
    const mainTsx = readSourceText(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sessionRowTsx = readSourceText(path.join(root, 'web', 'src', 'chat', 'sessionlist', 'SessionRow.tsx'));

    expect(mainTsx).toContain("from '../chat/session/chatDraftSessions'");
    expect(mainTsx).toContain('const [draftSessionsByProjectId, setDraftSessionsByProjectId] = useState');
    expect(mainTsx).toContain('const draftSessionsByProjectIdRef = useRef');
    expect(mainTsx).toContain('const draftSessionCreatePromisesRef = useRef');
    expect(mainTsx).toContain('const selectDraftChatSession = useCallback');
    expect(mainTsx).toContain('const resolveSelectedDraftSessionForSend = async');
    expect(sessionRowTsx).toContain('export function DraftSessionRow(');
    expect(mainTsx).toContain('canStartDraftChatSessionCreate(draft)');
    expect(mainTsx).toContain("service.createProjectSession(targetProjectId, agentType, '', draft.draftId)");
    expect(mainTsx).toContain('reconcileCreatedDraftSessions(eventProjectId, [payload.session]);');
    expect(mainTsx).toContain('reconcileCreatedDraftSessions(targetProjectId, listedSessions);');

    const sendBody = extractConstFunctionBody(mainTsx, 'sendChatMessage');
    const resolveIndex = sendBody.indexOf('await resolveSelectedDraftSessionForSend(');
    const uploadIndex = sendBody.indexOf('await uploadChatAttachmentsForSend(');
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(resolveIndex);

    const resolveDraftSendBody = extractConstFunctionBody(mainTsx, 'resolveSelectedDraftSessionForSend');
    const canStartIndex = resolveDraftSendBody.indexOf('if (!canStartDraftChatSessionCreate(draft))');
    const markSendingIndex = resolveDraftSendBody.indexOf('markDraftChatSessionSending(current)');
    expect(canStartIndex).toBeGreaterThanOrEqual(0);
    expect(markSendingIndex).toBeGreaterThan(canStartIndex);

    const draftRowBody = sessionRowTsx.slice(sessionRowTsx.indexOf('export function DraftSessionRow('));
    expect(draftRowBody).not.toContain('renderProjectSessionActionMenu');
    expect(draftRowBody).not.toContain('openProjectSessionContextMenu');
    expect(draftRowBody).not.toContain('startProjectSessionLongPress');
  });

  test('never reads frontend draft sessions from the backend', () => {
    const root = projectRoot();
    const mainTsx = readSourceText(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const loadBody = extractConstFunctionBody(mainTsx, 'loadChatSession');
    const guardIndex = loadBody.indexOf('if (isDraftChatSessionId(sessionId)) return false;');
    const diagnosticIndex = loadBody.indexOf("startWorkspaceDiagnosticSpan('load_chat_session'");
    const readIndex = loadBody.indexOf('await readProjectSessionWithStaleCacheRepair(');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(diagnosticIndex).toBeGreaterThan(guardIndex);
    expect(readIndex).toBeGreaterThan(guardIndex);
  });

  test('keeps session.create RPC alive long enough for slow Codex startup drafts', () => {
    const root = projectRoot();
    const repositoryTs = readSourceText(path.join(root, 'web', 'src', 'registry', 'RegistryRepository.ts'));
    const createSessionStart = repositoryTs.indexOf('async createSession(');
    expect(createSessionStart).toBeGreaterThanOrEqual(0);
    const queueSessionStart = repositoryTs.indexOf('async mutateSessionQueue(', createSessionStart);
    expect(queueSessionStart).toBeGreaterThan(createSessionStart);
    const createSessionBody = repositoryTs.slice(createSessionStart, queueSessionStart);

    expect(repositoryTs).toContain('const SESSION_CREATE_TIMEOUT_MS = 120000;');
    expect(createSessionBody).toContain('timeoutMs: SESSION_CREATE_TIMEOUT_MS,');
    expect(createSessionBody).not.toContain('timeoutMs: 15000,');
  });
});
