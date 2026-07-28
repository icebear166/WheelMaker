import {
  buildQueuedPromptMessage,
  cancelQueuedChatPrompt,
  enqueueChatCompact,
  enqueueChatPrompt,
  hasSteeringChatPrompt,
  hasQueuedChatCompact,
  moveQueuedChatPromptToFront,
  queuedChatPrompts,
  reconcileSteeredChatPrompts,
  shiftNextQueuedChatItem,
  shiftNextQueuedChatPrompt,
  setQueuedChatPromptSteering,
  type QueuedChatCompact,
  type QueuedChatPrompt,
} from '../web/src/chat/session/chatPromptQueue';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

const basePrompt = (id: string, text: string): QueuedChatPrompt => ({
  kind: 'prompt',
  id,
  sessionId: 'sess-1',
  blocks: [{type: 'text', text}],
  createdAt: `2026-06-18T00:00:0${id}.000Z`,
  text,
  status: 'queued',
});

const baseCompact = (id = 'compact-1'): QueuedChatCompact => ({
  kind: 'compact',
  id,
  sessionId: 'sess-1',
  createdAt: '2026-06-18T00:00:04.000Z',
});

describe('chat prompt queue state', () => {
  test('enqueues multiple prompts in FIFO order', () => {
    const first = basePrompt('1', 'first');
    const second = basePrompt('2', 'second');
    const state = enqueueChatPrompt(enqueueChatPrompt({}, 'project:sess-1', first), 'project:sess-1', second);

    expect(state['project:sess-1'].map(item => item.text)).toEqual(['first', 'second']);
  });

  test('cancels one queued prompt without changing the rest', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second'), basePrompt('3', 'third')],
    };

    expect(cancelQueuedChatPrompt(state, 'project:sess-1', '2')['project:sess-1'].map(item => item.text))
      .toEqual(['first', 'third']);
  });

  test('moves a queued prompt to the front without sending it immediately', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second'), basePrompt('3', 'third')],
    };

    expect(moveQueuedChatPromptToFront(state, 'project:sess-1', '3')['project:sess-1'].map(item => item.text))
      .toEqual(['third', 'first', 'second']);
  });

  test('shifts the next prompt and keeps remaining queued prompts', () => {
    const state = {
      'project:sess-1': [basePrompt('1', 'first'), basePrompt('2', 'second')],
    };

    const result = shiftNextQueuedChatPrompt(state, 'project:sess-1');

    expect(result.prompt?.text).toBe('first');
    expect(result.state['project:sess-1'].map(item => item.text)).toEqual(['second']);
  });

  test('builds a queued prompt message with queued metadata', () => {
    const message = buildQueuedPromptMessage(basePrompt('1', 'first'), 42);

    expect(message.method).toBe('prompt_request');
    expect(message.turnIndex).toBe(42);
    expect(message.param.queuedPromptId).toBe('1');
    expect(message.param.queueStatus).toBe('queued');
  });

  test('marks one prompt steering without moving it', () => {
    const runtimeKey = 'project:sess-1';
    const state = {
      [runtimeKey]: [basePrompt('1', 'first'), basePrompt('2', 'second'), basePrompt('3', 'third')],
    };

    const next = setQueuedChatPromptSteering(state, runtimeKey, '2', true);

    expect(next[runtimeKey].map(item => item.id)).toEqual(['1', '2', '3']);
    expect(next[runtimeKey][1]).toMatchObject({id: '2', status: 'steering'});
    expect(buildQueuedPromptMessage(next[runtimeKey][1] as QueuedChatPrompt, 43).param.queueStatus)
      .toBe('steering');
  });

  test('prevents drain while a steer is pending', () => {
    const runtimeKey = 'project:sess-1';
    const state = setQueuedChatPromptSteering({
      [runtimeKey]: [basePrompt('1', 'first'), basePrompt('2', 'second')],
    }, runtimeKey, '2', true);

    expect(hasSteeringChatPrompt(state, runtimeKey)).toBe(true);
    expect(shiftNextQueuedChatItem(state, runtimeKey).item).toBeNull();
    expect(shiftNextQueuedChatPrompt(state, runtimeKey).prompt).toBeNull();
  });

  test('reconciles a steering prompt from persisted Steered history', () => {
    const runtimeKey = 'project:sess-1';
    const state = setQueuedChatPromptSteering({
      [runtimeKey]: [basePrompt('1', 'first'), basePrompt('2', 'second'), baseCompact()],
    }, runtimeKey, '2', true);
    const messages: RegistryChatMessage[] = [{
      sessionId: 'sess-1',
      turnIndex: 2,
      method: 'user_message_chunk',
      param: {
        clientMessageId: '2',
        steered: true,
      },
      finished: false,
    }];
    const next = reconcileSteeredChatPrompts(state, runtimeKey, messages);
    expect(next[runtimeKey].map(item => item.id)).toEqual(['1', 'compact-1']);
  });

  test('keeps prompt and compact work in one FIFO queue', () => {
    const runtimeKey = 'project:sess-1';
    const state = enqueueChatPrompt(
      enqueueChatCompact(enqueueChatPrompt({}, runtimeKey, basePrompt('1', 'first')), runtimeKey, baseCompact()),
      runtimeKey,
      basePrompt('2', 'second'),
    );

    expect(state[runtimeKey].map(item => item.kind)).toEqual(['prompt', 'compact', 'prompt']);
    expect(queuedChatPrompts(state, runtimeKey).map(item => item.text)).toEqual(['first', 'second']);
    expect(hasQueuedChatCompact(state, runtimeKey)).toBe(true);
    expect(shiftNextQueuedChatItem(state, runtimeKey).item?.kind).toBe('prompt');
  });

  test('allows only one waiting compact per runtime queue', () => {
    const runtimeKey = 'project:sess-1';
    const once = enqueueChatCompact({}, runtimeKey, baseCompact('compact-1'));
    const twice = enqueueChatCompact(once, runtimeKey, baseCompact('compact-2'));

    expect(twice).toBe(once);
    expect(twice[runtimeKey]).toHaveLength(1);
  });
});
