import {buildChatDisplayIndex} from '../web/src/chat/turns/chatDisplayIndex';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

test('folds operation lifecycle events into one row at the latest turn', () => {
  const messages: RegistryChatMessage[] = [
    {sessionId: 's1', turnIndex: 3, method: 'session_operation', param: {operationId: 'op-1', type: 'compact', status: 'started'}},
    {sessionId: 's1', turnIndex: 4, method: 'session_operation', param: {operationId: 'op-1', type: 'compact', status: 'completed'}},
    {sessionId: 's1', turnIndex: 5, method: 'session_operation', param: {operationId: 'op-2', type: 'compact', status: 'failed'}},
  ];

  const display = buildChatDisplayIndex(messages, {shouldRender: () => false});
  expect(display.items.map(item => item.turnIndex)).toEqual([4, 5]);
  expect(display.items.every(item => item.estimatedHeight >= 40 && item.estimatedHeight <= 56)).toBe(true);
});
