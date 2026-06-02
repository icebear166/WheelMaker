import {
  buildPromptCompletionNotification,
  promptCompletionNotificationKey,
  shouldNotifyPromptCompletion,
} from '../web/src/notifications/promptCompletion';
import type {
  RegistryChatMessage,
  RegistrySessionSummary,
} from '../web/src/types/registry';

function message(
  method: string,
  turnIndex = 7,
  param: Record<string, unknown> = {},
): RegistryChatMessage {
  return {
    sessionId: 'sess-1',
    turnIndex,
    method,
    param,
    finished: true,
  };
}

const session: RegistrySessionSummary = {
  sessionId: 'sess-1',
  title: 'Build Android',
  preview: '',
  updatedAt: '2026-05-31T00:00:00.000Z',
  messageCount: 1,
};

describe('prompt completion notifications', () => {
  test('only prompt_done can notify', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('agent_message_chunk'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'other:sess-2',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(false);

    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'other:sess-2',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(true);
  });

  test('suppresses the visible selected chat session', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible',
      activeTab: 'chat',
    })).toBe(false);
  });

  test('allows background and other-view completions', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(true);

    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible',
      activeTab: 'files',
    })).toBe(true);
  });

  test('builds privacy-preserving payload with the session display title and stable dedupe key', () => {
    const promptDone = message('prompt_done', 9, {
      stopReason: 'failed',
      message: 'agent crashed with a very long diagnostic',
    });
    const payload = buildPromptCompletionNotification({
      message: promptDone,
      projectId: 'proj-1',
      session,
    });

    expect(payload).toMatchObject({
      type: 'chat.prompt.completed',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      turnIndex: 9,
      status: 'failed',
      title: 'Build Android',
      body: 'Prompt failed',
    });
    expect(payload.body).not.toContain('Build Android');
    expect(payload.body).not.toContain('agent crashed');
    expect(payload.body).not.toContain('assistant answer');
    expect(payload.url).toContain('wmProjectId=proj-1');
    expect(payload.url).toContain('wmSessionId=sess-1');
    expect(promptCompletionNotificationKey('proj-1', promptDone)).toBe('proj-1:sess-1:9');
  });

  test('uses the same resolved session title as the chat list', () => {
    const promptDone = message('prompt_done', 10);
    const payload = buildPromptCompletionNotification({
      message: promptDone,
      projectId: 'proj-1',
      session: {
        ...session,
        title: JSON.stringify({
          first: 'Original prompt title',
          last: 'Latest prompt title',
          manual: 'Manual session title',
        }),
      },
    });

    expect(payload.title).toBe('Manual session title');
    expect(payload.body).toBe('Prompt completed');
  });
});
