import {
  buildChatPromptHistory,
  resolveCurrentChatPromptIndex,
  summarizeChatPromptPreview,
} from '../web/src/chat/turns/chatPromptHistory';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(
  turnIndex: number,
  method: string,
  param: Record<string, unknown> = {},
  sessionId = 's1',
): RegistryChatMessage {
  return {
    sessionId,
    turnIndex,
    method,
    param,
    finished: true,
  };
}

function prompt(turnIndex: number, text: string): RegistryChatMessage {
  return message(turnIndex, 'prompt_request', {contentBlocks: [{type: 'text', text}]});
}

describe('buildChatPromptHistory', () => {
  test('collects prompt starts in turn order with 1-based positions', () => {
    const history = buildChatPromptHistory([
      message(3, 'user_message_chunk', {text: 'third question'}),
      prompt(1, 'first prompt'),
      message(2, 'agent_message_chunk', {text: 'answer'}),
      prompt(0, 'draft without a turn'),
      message(3, 'prompt_done', {stopReason: 'end_turn'}),
    ]);

    expect(history.map(item => item.position)).toEqual([1, 2]);
    expect(history.map(item => item.turnIndex)).toEqual([1, 3]);
    expect(history[0].preview).toBe('first prompt');
    expect(history[0].key).toBe('s1:1:prompt_request');
    expect(history[1].preview).toBe('third question');
    expect(history[1].key).toBe('s1:3:user_message_chunk');
  });

  test('falls back to the ordinal label when the prompt has no text', () => {
    const history = buildChatPromptHistory([
      message(2, 'prompt_request', {contentBlocks: []}),
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].preview).toBe('Prompt 1');
  });
});

describe('summarizeChatPromptPreview', () => {
  test('collapses whitespace and keeps the fallback for empty text', () => {
    expect(summarizeChatPromptPreview('line one\n  line   two', 'fallback')).toBe('line one line two');
    expect(summarizeChatPromptPreview('   ', 'fallback')).toBe('fallback');
  });

  test('truncates long prompts with an ellipsis', () => {
    const summary = summarizeChatPromptPreview('x'.repeat(120), 'fallback');

    expect(summary).toHaveLength(98);
    expect(summary.endsWith('...')).toBe(true);
  });
});

describe('resolveCurrentChatPromptIndex', () => {
  const history = buildChatPromptHistory([
    prompt(3, 'a'),
    prompt(5, 'b'),
    prompt(9, 'c'),
  ]);

  test('returns -1 for an empty history', () => {
    expect(resolveCurrentChatPromptIndex([], 5)).toBe(-1);
  });

  test('assumes the latest prompt when the visible turn is unknown', () => {
    expect(resolveCurrentChatPromptIndex(history, 0)).toBe(2);
    expect(resolveCurrentChatPromptIndex(history, Number.NaN)).toBe(2);
  });

  test('resolves the prompt that owns the visible turn', () => {
    expect(resolveCurrentChatPromptIndex(history, 5)).toBe(1);
    expect(resolveCurrentChatPromptIndex(history, 7)).toBe(1);
    expect(resolveCurrentChatPromptIndex(history, 99)).toBe(2);
  });

  test('pins to the first prompt when the visible turn precedes it', () => {
    expect(resolveCurrentChatPromptIndex(history, 3)).toBe(0);
    expect(resolveCurrentChatPromptIndex(history, 2)).toBe(0);
  });
});
