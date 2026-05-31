import fs from 'fs';
import path from 'path';

describe('chat prompt completion notification settings', () => {
  const projectRoot = path.join(__dirname, '..');

  test('adds prompt completion notifications to chat settings and persistence', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');
    const persistenceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'services', 'workspacePersistence.ts'),
      'utf8',
    );

    const chatSectionStart = mainTsx.indexOf("renderSettingsSection('Chat'");
    const connectionSectionStart = mainTsx.indexOf("renderSettingsSection('Connection'");
    const chatSection = mainTsx.slice(chatSectionStart, connectionSectionStart);

    expect(chatSection).toContain('Prompt Completion Notifications');
    expect(chatSection).toContain('promptCompletionNotificationsEnabled');
    expect(chatSection).toContain('setPromptCompletionNotificationsEnabled');
    expect(persistenceTs).toContain('promptCompletionNotificationsEnabled: boolean;');
    expect(persistenceTs).toContain('promptCompletionNotificationsEnabled: false,');
    expect(persistenceTs).toContain('typeof input.promptCompletionNotificationsEnabled ===');
  });

  test('routes session.message through prompt completion notification policy', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');

    expect(mainTsx).toContain("from './notifications/promptCompletion'");
    expect(mainTsx).toContain("from './notifications/provider'");
    expect(mainTsx).toContain('const notificationProvider = useMemo(() => createNotificationProvider(), []);');
    expect(mainTsx).toContain('const notifiedPromptCompletionIdsRef = useRef<Set<string>>(new Set());');
    expect(mainTsx).toContain('const maybeNotifyPromptCompletion = (');
    expect(mainTsx).toContain("message.method !== 'prompt_done'");
    expect(mainTsx).toContain('shouldNotifyPromptCompletion({');
    expect(mainTsx).toContain('buildPromptCompletionNotification({');
    expect(mainTsx).toContain('notificationProvider.show(payload)');
    expect(mainTsx).toContain('maybeNotifyPromptCompletion(message, existingSession, eventProjectId);');
    expect(mainTsx).not.toContain('maybeNotifyChatMessage(message, existingSession, eventProjectId);');
  });

  test('consumes notification deep links for project and session selection', () => {
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'main.tsx'), 'utf8');

    expect(mainTsx).toContain('const pendingNotificationTargetRef = useRef<ChatSessionKey | null>(');
    expect(mainTsx).toContain("searchParams.get('wmProjectId')");
    expect(mainTsx).toContain("searchParams.get('wmSessionId')");
    expect(mainTsx).toContain("searchParams.delete('wmProjectId')");
    expect(mainTsx).toContain("searchParams.delete('wmSessionId')");
    expect(mainTsx).toContain('applyPendingNotificationTarget');
    expect(mainTsx).toContain('refreshChatProjectSessions(target.projectId, {force: true})');
    expect(mainTsx).toContain('selectProjectChatSession(target.projectId, target.sessionId)');
  });
});
