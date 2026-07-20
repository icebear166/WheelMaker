import {
  compareChatSessionUpdatedAtDesc,
  mergeChatSession,
  mergeChatSessionList,
  sortChatSessions,
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
});
