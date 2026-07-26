import {
  compareChatSessionUpdatedAtDesc,
  mergeChatSession,
  mergeChatSessionList,
  sortChatSessions,
  sortProjectChatSessions,
} from '../web/src/chat/session/chatSessionOrdering';
import type {RegistryChatSession} from '../web/src/registry/registryTypes';

function session(
  sessionId: string,
  updatedAt: string,
  overrides: Partial<RegistryChatSession> = {},
): RegistryChatSession {
  return {
    sessionId,
    title: sessionId,
    preview: '',
    updatedAt,
    messageCount: 1,
    ...overrides,
  };
}

describe('chat session ordering', () => {
  test('preserves Goal snapshots on partial updates and clears explicit undefined', () => {
    const snapshot = {
      sessionId: 'a',
      objective: 'Ship',
      status: 'active' as const,
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 2,
      createdAt: 3,
      updatedAt: 4,
    };
    const existing = [session('a', '2026-01-01T00:00:00Z', {goal: snapshot})];

    expect(mergeChatSession(existing, {sessionId: 'a', preview: 'next'})[0].goal).toEqual(snapshot);
    expect(mergeChatSession(existing, {sessionId: 'a', goal: undefined})[0].goal).toBeUndefined();
  });

  test('compares timestamps by instant rather than timestamp text', () => {
    const earlier = '2026-07-20T12:30:00+08:00';
    const later = '2026-07-20T05:00:00.500Z';

    expect(compareChatSessionUpdatedAtDesc(later, earlier)).toBeLessThan(0);
    expect(sortChatSessions([
      session('earlier', earlier),
      session('later', later),
    ]).map(item => item.sessionId)).toEqual(['later', 'earlier']);
  });

  test('keeps stable order for equal timestamps', () => {
    const items = [
      session('a', '2026-07-20T05:00:00Z'),
      session('b', '2026-07-20T13:00:00+08:00'),
    ];

    expect(sortChatSessions(items).map(item => item.sessionId)).toEqual(['a', 'b']);
  });

  test('sorts project sessions by pinned group then updatedAt descending', () => {
    const result = sortProjectChatSessions([
      session('new-unpinned', '2026-07-22T12:00:00Z'),
      {...session('old-pinned', '2026-07-20T12:00:00Z'), pinned: true},
      {...session('new-pinned', '2026-07-21T12:00:00Z'), pinned: true},
      session('old-unpinned', '2026-07-19T12:00:00Z'),
    ]);

    expect(result.map(item => item.sessionId)).toEqual([
      'new-pinned',
      'old-pinned',
      'new-unpinned',
      'old-unpinned',
    ]);
  });

  test('keeps pure recency sorting available for Recent', () => {
    const result = sortChatSessions([
      {...session('old-pinned', '2026-07-20T12:00:00Z'), pinned: true},
      session('new-unpinned', '2026-07-22T12:00:00Z'),
    ]);

    expect(result.map(item => item.sessionId)).toEqual(['new-unpinned', 'old-pinned']);
  });

  test('reorders when pin changes without updatedAt changing', () => {
    const existing = [
      session('newer', '2026-07-22T12:00:00Z'),
      session('older', '2026-07-20T12:00:00Z'),
    ];

    const pinned = mergeChatSession(existing, {sessionId: 'older', pinned: true});
    expect(pinned.map(item => item.sessionId)).toEqual(['older', 'newer']);

    const unpinned = mergeChatSession(pinned, {sessionId: 'older', pinned: false});
    expect(unpinned.map(item => item.sessionId)).toEqual(['newer', 'older']);
  });

  test('preserves pin when a partial session patch omits it', () => {
    const merged = mergeChatSession(
      [{...session('s1', '2026-07-22T12:00:00Z'), pinned: true}],
      {sessionId: 's1', preview: 'patched'},
    );

    expect(merged[0].pinned).toBe(true);
  });

  test('updates and authoritatively clears mark without changing order or pin', () => {
    const existing = [
      {...session('a', '2026-07-22T12:00:00Z'), pinned: true, markColor: 'red' as const},
      session('b', '2026-07-21T12:00:00Z'),
    ];

    const changed = mergeChatSession(existing, {sessionId: 'a', markColor: 'blue'});
    expect(changed.map(item => item.sessionId)).toEqual(['a', 'b']);
    expect(changed[0]).toMatchObject({pinned: true, markColor: 'blue'});

    const cleared = mergeChatSession(changed, {sessionId: 'a', markColor: undefined});
    expect(cleared.map(item => item.sessionId)).toEqual(['a', 'b']);
    expect(cleared[0].pinned).toBe(true);
    expect(cleared[0].markColor).toBeUndefined();
  });

  test('preserves mark when an unrelated partial patch omits it', () => {
    const merged = mergeChatSession(
      [{...session('s1', '2026-07-22T12:00:00Z'), markColor: 'green'}],
      {sessionId: 's1', preview: 'patched'},
    );

    expect(merged[0].markColor).toBe('green');
  });

  test('patches metadata without moving a session when updatedAt is unchanged', () => {
    const items = [
      session('a', '2026-07-20T05:00:00Z'),
      {
        ...session('b', '2026-07-20T05:00:00Z'),
        commands: [{name: '/plan', description: 'Plan'}],
        sessionActions: {
          status: {supported: true},
          compact: {supported: false, reason: 'busy'},
          steer: {supported: true},
        },
      },
    ];

    const merged = mergeChatSession(items, {sessionId: 'b', preview: 'patched'});

    expect(merged.map(item => item.sessionId)).toEqual(['a', 'b']);
    expect(merged[1]).toMatchObject({
      preview: 'patched',
      commands: items[1].commands,
      sessionActions: items[1].sessionActions,
    });
  });

  test('preserves pending permission count across partial patches and accepts an explicit zero', () => {
    const waiting = {
      ...session('waiting', '2026-07-20T05:00:00Z'),
      running: true,
      pendingPermissionCount: 1,
    };

    const patched = mergeChatSession([waiting], {sessionId: 'waiting', preview: 'still waiting'});
    expect(patched[0].pendingPermissionCount).toBe(1);

    const answered = mergeChatSession(patched, {sessionId: 'waiting', pendingPermissionCount: 0});
    expect(answered[0].pendingPermissionCount).toBe(0);
  });

  test('list refresh preserves optional metadata and reorders changed activity', () => {
    const existing = [{
      ...session('old', '2026-07-19T05:00:00Z'),
      configOptions: [{
        id: 'model',
        name: 'Model',
        currentValue: 'test',
        options: [{value: 'test', name: 'Test'}],
      }],
      sessionActions: {
        status: {supported: true},
        compact: {supported: true},
        steer: {supported: true},
      },
    }];
    const incoming = [
      session('new', '2026-07-20T05:00:00Z'),
      {...session('old', '2026-07-21T05:00:00Z'), preview: 'updated'},
    ];

    const merged = mergeChatSessionList(existing, incoming);

    expect(merged.map(item => item.sessionId)).toEqual(['old', 'new']);
    expect(merged[0].configOptions).toEqual(existing[0].configOptions);
    expect(merged[0].sessionActions).toEqual(existing[0].sessionActions);
  });

  test('list refresh reorders when only pinned changes', () => {
    const existing = [
      session('newer', '2026-07-22T12:00:00Z'),
      session('older', '2026-07-20T12:00:00Z'),
    ];
    const incoming = [
      session('newer', '2026-07-22T12:00:00Z'),
      {...session('older', '2026-07-20T12:00:00Z'), pinned: true},
    ];

    expect(mergeChatSessionList(existing, incoming).map(item => item.sessionId))
      .toEqual(['older', 'newer']);
  });
});
