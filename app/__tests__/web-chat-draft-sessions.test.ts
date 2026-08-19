import {RegistryRepository} from '../web/src/registry/RegistryRepository';
import {
  DRAFT_CHAT_SESSION_ID_PREFIX,
  canStartDraftChatSessionCreate,
  createDraftChatSession,
  findDraftChatSessionForCreatedSession,
  isDraftChatSessionId,
  markDraftChatSessionFailed,
  markDraftChatSessionSending,
  removeDraftChatSession,
  resolveDraftReplacementSelection,
} from '../web/src/chat/session/chatDraftSessions';

describe('web chat draft sessions', () => {
  test('creates drafts with explicit lifecycle states', () => {
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
    expect(markDraftChatSessionSending(draft)).toMatchObject({status: 'sendingFirstPrompt', errorMessage: ''});
    expect(markDraftChatSessionFailed(draft, 'create failed')).toMatchObject({status: 'failed', errorMessage: 'create failed'});
    expect(canStartDraftChatSessionCreate(draft)).toBe(true);
    expect(canStartDraftChatSessionCreate(markDraftChatSessionSending(draft))).toBe(true);
    expect(canStartDraftChatSessionCreate(markDraftChatSessionFailed(draft, 'create failed'))).toBe(false);
  });

  test('replaces a selected draft only when it initiated the created session', () => {
    const draft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Codex',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}selected`,
      nowIso: '2026-06-12T08:00:00.000Z',
    });
    const otherDraft = createDraftChatSession({
      projectId: 'project-a',
      agentType: 'Claude',
      draftId: `${DRAFT_CHAT_SESSION_ID_PREFIX}other`,
      nowIso: '2026-06-12T08:01:00.000Z',
    });

    expect(removeDraftChatSession([draft, otherDraft], draft.draftId)).toEqual([otherDraft]);
    expect(findDraftChatSessionForCreatedSession(
      [otherDraft, draft],
      {sessionId: 'real-session', createRequestId: draft.draftId},
    )).toBe(draft);
    expect(resolveDraftReplacementSelection({
      currentSelectedKey: {projectId: 'project-a', sessionId: draft.draftId},
      draft,
      realSessionId: 'real-session',
    })).toEqual({projectId: 'project-a', sessionId: 'real-session'});
    const unrelatedSelection = {projectId: 'project-a', sessionId: 'another-session'};
    expect(resolveDraftReplacementSelection({currentSelectedKey: unrelatedSelection, draft, realSessionId: 'real-session'})).toBe(unrelatedSelection);
    expect(resolveDraftReplacementSelection({currentSelectedKey: null, draft, realSessionId: 'real-session'})).toBeNull();
  });

  test('carries the draft id through session.create and normalized session lists', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        payload: {ok: true, session: {
          sessionId: 'real-session', title: '', preview: '', updatedAt: '2026-07-13T08:00:02Z',
          messageCount: 0, agentType: 'codex', createRequestId: 'draft-request-1',
        }},
      })
      .mockResolvedValueOnce({
        payload: {sessions: [{
          sessionId: 'real-session', title: '', preview: '', updatedAt: '2026-07-13T08:00:02Z',
          messageCount: 0, agentType: 'codex', createRequestId: 'draft-request-1',
        }]},
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
});
