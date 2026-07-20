import {
  buildChatSearchMatches,
  isChatSearchableMethod,
  splitChatSearchHighlightSegments,
} from '../web/src/chat/search/chatSearchState';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(method: string, turnIndex: number, param: Record<string, unknown> = {}): RegistryChatMessage {
  return {sessionId: 's1', turnIndex, method, param, finished: true};
}

describe('chat search state helpers', () => {
  test('only user prompts and assistant replies are searchable', () => {
    expect(isChatSearchableMethod('prompt_request')).toBe(true);
    expect(isChatSearchableMethod('user_message_chunk')).toBe(true);
    expect(isChatSearchableMethod('agent_message_chunk')).toBe(true);
    expect(isChatSearchableMethod('agent_thought_chunk')).toBe(false);
    expect(isChatSearchableMethod('tool_call')).toBe(false);
    expect(isChatSearchableMethod('prompt_done')).toBe(false);
    expect(isChatSearchableMethod('agent_plan')).toBe(false);
  });

  test('returns matching turn indices, case-insensitive, deduped', () => {
    const messages: RegistryChatMessage[] = [
      message('prompt_request', 0, {contentBlocks: [{type: 'text', text: 'Deploy the API'}]}),
      message('agent_thought_chunk', 1, {text: 'deploy plan hidden'}), // excluded
      message('agent_message_chunk', 2, {text: 'Running DEPLOY now'}),
      message('tool_call', 3, {cmd: 'deploy --prod'}), // excluded
      message('agent_message_chunk', 4, {text: 'nothing here'}),
    ];

    expect(buildChatSearchMatches(messages, 'deploy')).toEqual([
      {turnIndex: 0},
      {turnIndex: 2},
    ]);
  });

  test('empty or whitespace query returns no matches', () => {
    const messages: RegistryChatMessage[] = [
      message('prompt_request', 0, {contentBlocks: [{type: 'text', text: 'hello'}]}),
    ];
    expect(buildChatSearchMatches(messages, '')).toEqual([]);
    expect(buildChatSearchMatches(messages, '   ')).toEqual([]);
  });

  test('splits highlight segments case-insensitively', () => {
    expect(splitChatSearchHighlightSegments('Deploy deployer', 'dep')).toEqual([
      {text: 'Dep', match: true},
      {text: 'loy ', match: false},
      {text: 'dep', match: true},
      {text: 'loyer', match: false},
    ]);
  });

  test('returns a single non-match segment when query absent or empty', () => {
    expect(splitChatSearchHighlightSegments('Hello', 'zz')).toEqual([{text: 'Hello', match: false}]);
    expect(splitChatSearchHighlightSegments('Hello', '')).toEqual([{text: 'Hello', match: false}]);
    expect(splitChatSearchHighlightSegments('', 'x')).toEqual([]);
  });
});
