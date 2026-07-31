import {
  buildQueuePromptMessage,
  fullQueueSnapshot,
  mergeChatSessionQueueProjection,
  queueDisplayItems,
} from '../web/src/chat/session/chatSessionQueue';
import type {RegistrySessionQueueSnapshot} from '../web/src/registry/registryTypes';

const snapshot = (
  generation: string,
  revision: number,
  itemId = 'item-1',
): RegistrySessionQueueSnapshot => ({
  generation,
  revision,
  paused: false,
  activeKind: 'prompt',
  waitingCount: 1,
  waitingItems: [{
    itemId,
    kind: 'prompt',
    status: 'queued',
    createdAt: '2026-07-31T10:00:00Z',
    blocks: [{type: 'text', text: itemId}],
    cancelSupported: true,
  }],
});

describe('server session queue projection', () => {
  test('rejects stale revisions in one generation', () => {
    expect(mergeChatSessionQueueProjection(snapshot('g1', 3), snapshot('g1', 2)))
      .toEqual(snapshot('g1', 3));
  });

  test('replaces all state on a new generation', () => {
    expect(mergeChatSessionQueueProjection(snapshot('g1', 9), snapshot('g2', 1, 'new')))
      .toEqual(snapshot('g2', 1, 'new'));
  });

  test('accepts only full item projections', () => {
    expect(fullQueueSnapshot({
      generation: 'g1',
      revision: 2,
      paused: false,
      waitingCount: 2,
    })).toBeUndefined();
    expect(fullQueueSnapshot({
      generation: 'g1',
      revision: 3,
      paused: false,
      waitingCount: 0,
    })).toMatchObject({generation: 'g1', revision: 3});
  });

  test('renders active failure followed by waiting items using cloned blocks', () => {
    const queue = snapshot('g1', 4);
    queue.activeItem = {
      itemId: 'failed',
      kind: 'prompt',
      status: 'failed',
      createdAt: '2026-07-31T09:00:00Z',
      blocks: [{type: 'text', text: 'failed'}],
      cancelSupported: true,
      error: 'provider failed',
    };
    const items = queueDisplayItems(queue);
    expect(items.map(item => item.itemId)).toEqual(['failed', 'item-1']);
    items[1].blocks![0].text = 'mutated';
    expect(queue.waitingItems![0].blocks![0].text).toBe('item-1');
  });

  test('builds a synthetic prompt message from server item identity', () => {
    const item = snapshot('g1', 1).waitingItems![0];
    const message = buildQueuePromptMessage('sess-1', item, 42);
    expect(message).toMatchObject({
      sessionId: 'sess-1',
      turnIndex: 42,
      method: 'prompt_request',
      param: {queuedPromptId: 'item-1', queueStatus: 'queued'},
    });
  });
});
