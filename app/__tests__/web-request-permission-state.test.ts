import {deriveChatPermissionState, permissionRequestView} from '../web/src/chat/permission/chatPermissionState';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(turnIndex: number, method: string, param: Record<string, unknown>): RegistryChatMessage {
  return {sessionId: 'sess-1', turnIndex, method, param, finished: true};
}

function request(turnIndex: number, permissionId: string, optionId = 'allow'): RegistryChatMessage {
  return message(turnIndex, 'permission_request', {
    permissionId,
    title: 'Choose',
    detailsText: 'Question',
    options: [{optionId, name: optionId === 'allow' ? 'Allow' : optionId, kind: 'allow_once'}],
  });
}

describe('chat permission turn state', () => {
  test('reads only normalized request display fields for the dialog', () => {
    const view = permissionRequestView(request(2, 'perm-a'));
    expect(view).toEqual({
      title: 'Choose',
      detailsText: 'Question',
      options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once'}],
    });
  });

  test('selects the earliest unresolved permission in the latest open prompt', () => {
    const state = deriveChatPermissionState([
      message(1, 'prompt_request', {text: 'run'}),
      request(3, 'perm-b'),
      request(2, 'perm-a'),
    ]);

    expect(state.active?.permissionId).toBe('perm-a');
    expect(state.active?.requestTurnIndex).toBe(2);
    expect(state.byRequestTurnIndex.get(3)?.status).toBe('pending');
  });

  test('folds a matching response into the request and hides the response turn', () => {
    const state = deriveChatPermissionState([
      message(1, 'prompt_request', {text: 'run'}),
      request(2, 'perm-a'),
      message(3, 'permission_response', {
        permissionId: 'perm-a',
        requestTurnIndex: 2,
        outcome: 'selected',
        optionId: 'allow',
        optionName: 'Allow',
      }),
    ]);

    expect(state.active).toBeNull();
    expect(state.byRequestTurnIndex.get(2)).toMatchObject({
      status: 'selected',
      optionId: 'allow',
      optionName: 'Allow',
    });
    expect(state.hiddenTurnIndexes.has(3)).toBe(true);
  });

  test('does not match a response with the wrong request turn index', () => {
    const state = deriveChatPermissionState([
      message(1, 'prompt_request', {text: 'run'}),
      request(2, 'perm-a'),
      message(3, 'permission_response', {
        permissionId: 'perm-a', requestTurnIndex: 99, outcome: 'selected', optionId: 'allow', optionName: 'Allow',
      }),
    ]);

    expect(state.active?.permissionId).toBe('perm-a');
    expect(state.hiddenTurnIndexes.has(3)).toBe(true);
  });

  test.each([
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['interrupted', 'interrupted'],
    ['end_turn', 'ended'],
  ])('terminal %s marks unmatched requests unanswered as %s', (stopReason, reason) => {
    const state = deriveChatPermissionState([
      message(1, 'prompt_request', {text: 'run'}),
      request(2, 'perm-a'),
      message(3, 'prompt_done', {stopReason}),
    ]);

    expect(state.active).toBeNull();
    expect(state.byRequestTurnIndex.get(2)).toMatchObject({status: 'unanswered', unansweredReason: reason});
  });

  test('a later prompt never revives an unresolved request from an older prompt', () => {
    const state = deriveChatPermissionState([
      message(1, 'prompt_request', {text: 'old'}),
      request(2, 'old-permission'),
      message(3, 'prompt_request', {text: 'new'}),
    ]);

    expect(state.active).toBeNull();
    expect(state.byRequestTurnIndex.get(2)).toMatchObject({status: 'unanswered', unansweredReason: 'interrupted'});
  });
});
