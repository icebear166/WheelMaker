import type {RegistryChatMessage} from '../web/src/registry/registryTypes';
import {
  resolveChatSearchMessages,
  resolveChatSearchOpenRequest,
} from '../web/src/chat/search/useChatSearchController';

function message(sessionId: string, text: string): RegistryChatMessage {
  return {
    sessionId,
    turnIndex: 1,
    method: 'agent_message_chunk',
    param: {text},
    finished: true,
  };
}

describe('chat search controller', () => {
  test('searches archived messages while archive preview mode is active', () => {
    const liveMessages = [message('live', 'live result')];
    const archivedMessages = [message('archive', 'archived result')];

    expect(resolveChatSearchMessages({
      liveMessages,
      archivedMessages,
      archivedMode: true,
    })).toBe(archivedMessages);
    expect(resolveChatSearchMessages({
      liveMessages,
      archivedMessages,
      archivedMode: false,
    })).toBe(liveMessages);
  });

  test('accepts only a newer programmatic open request for the current source', () => {
    const request = {sourceKey: 'live:p1:s1', query: '  needle  ', generation: 3};

    expect(resolveChatSearchOpenRequest({
      request,
      sourceKey: 'live:p1:s1',
      lastConsumedGeneration: 2,
    })).toEqual({query: 'needle', generation: 3});
    expect(resolveChatSearchOpenRequest({
      request,
      sourceKey: 'live:p1:s2',
      lastConsumedGeneration: 2,
    })).toBeNull();
    expect(resolveChatSearchOpenRequest({
      request,
      sourceKey: 'live:p1:s1',
      lastConsumedGeneration: 3,
    })).toBeNull();
    expect(resolveChatSearchOpenRequest({
      request: {...request, query: '   '},
      sourceKey: 'live:p1:s1',
      lastConsumedGeneration: 2,
    })).toBeNull();
  });
});
