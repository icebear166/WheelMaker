import {
  compareChatSessionUpdatedAtDesc,
  mergeChatSession,
  mergeChatSessionList,
  sortChatSessions,
  sortProjectChatSessions,
} from '../web/src/chat/session/chatSessionOrdering';
import type {RegistryChatSession} from '../web/src/registry/registryTypes';

function session(sessionId: string, updatedAt: string): RegistryChatSession {
  return {
    sessionId,
    title: sessionId,
    preview: '',
    updatedAt,
    messageCount: 1,
  };
}

describe('chat session ordering', () => {
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

  test('patches metadata without moving a session when updatedAt is unchanged', () => {
    const items = [
      session('a', '2026-07-20T05:00:00Z'),
      {
        ...session('b', '2026-07-20T05:00:00Z'),
        commands: [{name: '/plan', description: 'Plan'}],
        sessionActions: {
          status: {supported: true},
          compact: {supported: false, reason: 'busy'},
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
