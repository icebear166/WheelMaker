import {extractLatestChatPlan} from '../web/src/chat/chatPlan';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';

function message(
  turnIndex: number,
  method: string,
  param: Record<string, unknown> = {},
): RegistryChatMessage {
  return {
    sessionId: 'sess-plan',
    turnIndex,
    method,
    param,
    finished: true,
  };
}

describe('chat plan extraction', () => {
  test('keeps the latest structured plan until the next prompt starts', () => {
    const plan = extractLatestChatPlan([
      message(1, 'prompt_request'),
      message(2, 'agent_plan', {
        entries: [
          {content: 'Read the code', status: 'completed'},
          {content: 'Patch the UI', status: 'in_progress'},
          {content: 'Run tests', status: 'pending'},
        ],
      }),
      message(3, 'agent_message_chunk', {text: 'Working'}),
      message(4, 'prompt_done', {stopReason: 'end_turn'}),
    ]);

    expect(plan?.turnIndex).toBe(2);
    expect(plan?.totalCount).toBe(3);
    expect(plan?.completedCount).toBe(1);
    expect(plan?.activeIndex).toBe(1);
    expect(plan?.activeEntry?.content).toBe('Patch the UI');

    expect(extractLatestChatPlan([
      message(1, 'prompt_request'),
      message(2, 'agent_plan', {
        entries: [
          {content: 'Read the code', status: 'completed'},
        ],
      }),
      message(5, 'prompt_request'),
    ])).toBeNull();
  });

  test('uses the newest plan update for the active prompt', () => {
    const plan = extractLatestChatPlan([
      message(1, 'prompt_request'),
      message(2, 'agent_plan', {
        entries: [
          {content: 'Old step', status: 'in_progress'},
        ],
      }),
      message(2, 'agent_plan', {
        entries: [
          {content: 'Old step', status: 'completed'},
          {content: 'New step', status: 'in_progress'},
        ],
      }),
    ]);

    expect(plan?.entries.map(entry => entry.content)).toEqual(['Old step', 'New step']);
    expect(plan?.activeEntry?.content).toBe('New step');
  });

  test('uses the furthest in-progress step when a plan snapshot overlaps active steps', () => {
    const plan = extractLatestChatPlan([
      message(1, 'prompt_request'),
      message(2, 'agent_plan', {
        entries: [
          {content: 'Patch the UI', status: 'in_progress'},
          {content: 'Run tests', status: 'in_progress'},
          {content: 'Commit changes', status: 'pending'},
        ],
      }),
    ]);

    expect(plan?.activeIndex).toBe(1);
    expect(plan?.activeEntry?.content).toBe('Run tests');
  });
});
