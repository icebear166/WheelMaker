import type {RegistryChatMessage} from '../web/src/registry/registryTypes';
import {resolveChatSearchMessages} from '../web/src/chat/search/useChatSearchController';

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
});
