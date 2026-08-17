import {
  buildPromptCompletionNotification,
  chatSessionKeyFromNotificationUrl,
  promptCompletionNotificationKey,
  promptCompletionSessionKey,
  promptCompletionStatusPhrase,
  shouldNotifyPromptCompletion,
} from '../web/src/chat/notifications/promptCompletionNotification';
import type {
  RegistryChatMessage,
  RegistrySessionSummary,
} from '../web/src/registry/registryTypes';

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
      windowFocused: true,
    })).toBe(false);

    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'other:sess-2',
      documentVisibility: 'hidden',
      activeTab: 'chat',
      windowFocused: true,
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
      windowFocused: true,
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
      windowFocused: true,
    })).toBe(true);

    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible',
      activeTab: 'files',
      windowFocused: true,
    })).toBe(true);
  });

  test('notifies the selected session when the desktop window is unfocused', () => {
    const input = {
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible' as const,
      activeTab: 'chat',
      windowFocused: false,
    };

    expect(shouldNotifyPromptCompletion(input)).toBe(true);
  });

  test('builds IM-style payload with reply preview and session tag', () => {
    const promptDone = message('prompt_done', 9, {
      stopReason: 'end_turn',
      replyPreview: 'Fixed the login bug and added tests',
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
      status: 'completed',
      title: 'Build Android',
      preview: 'Fixed the login bug and added tests',
      body: 'Fixed the login bug and added tests',
      tag: 'proj-1:sess-1',
    });
    expect(payload.url).toContain('wmProjectId=proj-1');
    expect(payload.url).toContain('wmSessionId=sess-1');
    expect(promptCompletionNotificationKey('proj-1', promptDone)).toBe('proj-1:sess-1:9');
    expect(promptCompletionSessionKey('proj-1', 'sess-1')).toBe('proj-1:sess-1');
  });

  test('falls back to status phrase when no preview, and to error message for failed', () => {
    const done = buildPromptCompletionNotification({
      message: message('prompt_done', 10, {stopReason: 'end_turn'}),
      projectId: 'proj-1',
      session,
    });
    expect(done.preview).toBe('');
    expect(done.body).toBe('Prompt completed');

    const failedOldHub = buildPromptCompletionNotification({
      message: message('prompt_done', 11, {stopReason: 'failed', message: 'agent crashed'}),
      projectId: 'proj-1',
      session,
    });
    expect(failedOldHub.status).toBe('failed');
    expect(failedOldHub.preview).toBe('agent crashed');
    expect(failedOldHub.body).toBe('agent crashed');
  });

  test('status phrase covers all four states', () => {
    expect(promptCompletionStatusPhrase('completed')).toBe('Prompt completed');
    expect(promptCompletionStatusPhrase('failed')).toBe('Prompt failed');
    expect(promptCompletionStatusPhrase('cancelled')).toBe('Prompt cancelled');
    expect(promptCompletionStatusPhrase('interrupted')).toBe('Prompt interrupted');
  });

  test('parses chat session key from notification urls', () => {
    expect(chatSessionKeyFromNotificationUrl('/?wmProjectId=proj-1&wmSessionId=sess-1'))
      .toEqual({projectId: 'proj-1', sessionId: 'sess-1'});
    expect(chatSessionKeyFromNotificationUrl(
      '/?wmProjectId=proj%20x&wmSessionId=sess%2F1',
    )).toEqual({projectId: 'proj x', sessionId: 'sess/1'});
    expect(chatSessionKeyFromNotificationUrl('/')).toBeNull();
    expect(chatSessionKeyFromNotificationUrl('/?wmProjectId=proj-1')).toBeNull();
    expect(chatSessionKeyFromNotificationUrl('not a url')).toBeNull();
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
    expect(payload.tag).toBe('proj-1:sess-1');
  });
});
