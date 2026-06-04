import fs from 'fs';
import path from 'path';

describe('chat prompt completion notification settings', () => {
  const projectRoot = path.join(__dirname, '..');
  const readMainSource = () =>
    fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');
  const readSettingsRootSource = () =>
    fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

  test('adds prompt completion notifications to chat settings and persistence', () => {
    const mainTsx = readMainSource();
    const settingsRootTsx = readSettingsRootSource();
    const persistenceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    const chatSectionStart = settingsRootTsx.indexOf("renderSettingsSection('Chat'");
    const connectionSectionStart = settingsRootTsx.indexOf("renderSettingsSection('Connection'");
    const chatSection = settingsRootTsx.slice(chatSectionStart, connectionSectionStart);

    expect(chatSection).toContain('Notifications');
    expect(chatSection).not.toContain('Prompt Completion Notifications');
    expect(chatSection).toContain('promptCompletionNotificationsEnabled');
    expect(chatSection).toContain('setPromptCompletionNotificationsEnabled');
    expect(mainTsx).toContain('typeof persistedGlobal.promptCompletionNotificationsEnabled === \'boolean\'\n      ? persistedGlobal.promptCompletionNotificationsEnabled\n      : true,');
    expect(persistenceTs).toContain('promptCompletionNotificationsEnabled: boolean;');
    expect(persistenceTs).toContain('promptCompletionNotificationsEnabled: true,');
    expect(persistenceTs).toContain('typeof input.promptCompletionNotificationsEnabled ===');
  });

  test('routes session.message through prompt completion notification policy', () => {
    const mainTsx = readMainSource();

    expect(mainTsx).toContain("from '../chat/notifications/promptCompletionNotification'");
    expect(mainTsx).toContain("from '../notifications/NotificationProvider'");
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
    const mainTsx = readMainSource();

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
