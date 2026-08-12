import fs from 'fs';
import path from 'path';

describe('web reconnect fallback behavior', () => {
  test('keeps cached workspace visible and retries silent reconnect until recovery', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).not.toContain('RECONNECT_GRACE_PERIOD_MS');
    expect(mainTsx).not.toContain('reconnectStartedAtRef');
    expect(mainTsx).not.toContain('Please reconnect manually.');
    expect(mainTsx).toMatch(
      /const\s+canSilentReconnect\s*=\s*!!projectIdRef\.current;/,
    );
    expect(mainTsx).not.toContain('addressRef');
    expect(mainTsx).toContain('reconnectScheduled = true;');
    expect(mainTsx).toContain('scheduleReconnectAttempt();');
    expect(mainTsx).toMatch(
      /connect\(\{\s*silentReconnect:\s*true\s*\}\)\.catch\(\(\)\s*=>\s*undefined\);/,
    );
    expect(mainTsx).toContain('if (!connected && !keepWorkspaceVisible) {');
    expect(mainTsx).toContain('const syncChatSessionsAfterReconnect = async (');
    expect(mainTsx).toContain('reconnectSessionRuntimeKeys(selectedRuntimeKey)');
    expect(mainTsx).toContain('syncChatSessionsAfterReconnect(preferredSelectedChatKey).catch(() => undefined);');
    const connectStart = mainTsx.indexOf('const connect = async');
    const disconnectStart = mainTsx.indexOf('const disconnectForSupervisor', connectStart);
    const connectBlock = mainTsx.slice(connectStart, disconnectStart);
    expect(connectBlock).toContain(
      'schedulePostConnectProjectRefresh(preferredSelectedChatKey?.projectId ?? connectedProjectId);',
    );
    expect(connectBlock).not.toContain('await refreshChatIndex();');
  });

  test('schedules a forced project refresh after registry connect is ready', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const schedulePostConnectProjectRefresh = (activeProjectId: string) => {');
    expect(mainTsx).toContain('window.setTimeout(() => {');
    expect(mainTsx).toContain('refreshChatIndex({force: true, skipProjectId: activeProjectId}).catch(() => undefined);');
    expect(mainTsx).toContain('const refreshChatIndex = async (options?: {force?: boolean; skipProjectId?: string}) => {');
    expect(mainTsx).toContain('if (!options?.force && !connected && !connectInFlightRef.current) return;');

    const connectStart = mainTsx.indexOf('const connect = async');
    const disconnectStart = mainTsx.indexOf('const disconnectForSupervisor', connectStart);
    const connectBlock = mainTsx.slice(connectStart, disconnectStart);
    expect(connectBlock).toContain(
      'schedulePostConnectProjectRefresh(preferredSelectedChatKey?.projectId ?? connectedProjectId);',
    );
    expect(connectBlock).not.toContain('refreshChatIndex().catch(() => undefined);');
    expect(connectBlock).not.toContain('await refreshChatIndex();');
  });

  test('forced post-connect project refresh also forces per-project session refresh', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain(
      'const refreshChatProjectSessions = async (targetProjectId: string, options?: {force?: boolean}) => {',
    );
    expect(mainTsx).toContain(
      "if ((!options?.force && !connected && !connectInFlightRef.current) || !targetProjectId) return;",
    );
    expect(mainTsx).toContain(
      'refreshChatProjectSessions(projectId, {force: options?.force === true}),',
    );
  });

  test('uses pwa foreground supervisor for background suspend and resume reconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain(
      'const pwaFoundation = initializePWAFoundation();',
    );
    expect(mainTsx).toContain(
      'const supervisor = pwaFoundation.createConnectionSupervisor(',
    );
    expect(mainTsx).toContain('disconnectForSupervisor(reason);');
    expect(mainTsx).toContain('await connect({ silentReconnect: true });');
    expect(mainTsx).toContain('shouldDisconnectOnBackground: () => !isVoiceInputActive(),');
  });

  test('does not carry an intentional-close sentinel across repository connections', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).not.toContain('supervisorManagedCloseRef');
  });

  test('triggers local notification for completed prompts only', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const maybeNotifyPromptCompletion = (');
    expect(mainTsx).toContain('message: RegistryChatMessage,');
    expect(mainTsx).toContain('session?: RegistryChatSession,');
    expect(mainTsx).toContain('const normalizedPayload = normalizeSessionMessagePayload(payload);');
    expect(mainTsx).toContain('maybeNotifyPromptCompletion(message, existingSession, eventProjectId);');
    expect(mainTsx).toContain("message.method !== 'prompt_done'");
    expect(mainTsx).toContain('notificationProvider.show(payload)');
  });

  test('keeps workspace visible while background-disconnected and reconnecting', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    expect(mainTsx).toContain('const shouldKeepWorkspaceVisible =');
    expect(mainTsx).toContain(
      "reason !== 'stop' && !!projectIdRef.current;",
    );
    expect(mainTsx).toContain('setReconnecting(shouldKeepWorkspaceVisible);');
  });

  test('restores preview workbench through shared persisted state across viewport modes', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const persistenceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(mainTsx).toContain(
      'previewWorkbenchStateFromSnapshot(persistedGlobal.previewWorkbenchSnapshot)',
    );
    expect(mainTsx).toContain(
      'workspaceStore.rememberGlobalState({previewWorkbenchSnapshot: previewWorkbenchSnapshotFromState(previewWorkbench)});',
    );
    expect(mainTsx).toContain('const loadRestoredPreviewTab = useCallback(async (tab: PreviewWorkbenchTab) => {');
    expect(mainTsx).toContain('loadRestoredPreviewTab(restoredActiveTab).catch(() => undefined);');
    expect(mainTsx).toContain('Attachment preview cannot be restored from this source.');
    expect(mainTsx).not.toContain(
      'isWide && workspaceStore.rememberGlobalState({previewWorkbenchSnapshot',
    );
    expect(persistenceTs).toContain('previewWorkbenchSnapshot: PreviewWorkbenchSnapshot | null;');
    expect(persistenceTs).toContain("previewWorkbenchSnapshot: 'previewWorkbenchSnapshot',");
    expect(persistenceTs).toContain('previewWorkbenchSnapshot: null,');
    expect(persistenceTs).toContain('const rows = globalRowsForPatch(patch, next, now);');
    expect(persistenceTs).toContain(
      '{k: GLOBAL_KEYS.previewWorkbenchSnapshot, v: serialize(this.state.global.previewWorkbenchSnapshot), updatedAt}',
    );
  });
});
