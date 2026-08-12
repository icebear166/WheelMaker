import fs from 'fs';
import path from 'path';

describe('web chat read-on-demand behavior', () => {
  test('connect and project switch only load session list; reconnect hydrates only the selected session', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const workspaceStoreTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspaceStore.ts'),
      'utf8',
    );
    const workspacePersistenceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(mainTsx).toContain('incremental?: boolean;');
    expect(mainTsx).toContain('forceFull?: boolean;');
    expect(mainTsx).toContain('const useIncremental = requestedIncremental && !fallbackToFullRead;');
    expect(mainTsx).toContain('const syncChatSessionsAfterReconnect = async (');
    expect(mainTsx).not.toContain('runtimeKeysFromChatStores()');
    expect(mainTsx).toContain('reconnectSessionRuntimeKeys(selectedRuntimeKey)');
    expect(mainTsx).toContain('syncChatSessionsAfterReconnect(preferredSelectedChatKey).catch(() => undefined);');
    expect(mainTsx).toContain('const requestedAfterTurnIndex = useIncremental ? checkpointTurnIndex : 0;');
    expect(mainTsx).toContain('requestedAfterTurnIndex,');
    expect(mainTsx).toContain('applySessionReadResult(');
    expect(mainTsx).toContain('readProjectSessionWithStaleCacheRepair(');
    expect(mainTsx).toContain('isStaleSessionReadResult(');
    expect(mainTsx).toContain('clearProjectSessionCache(activeProjectId, sessionId);');
    expect(mainTsx).toContain('service.readProjectSession(activeProjectId, sessionId, 0, repairReadOptions);');
    expect(mainTsx).toContain("startWorkspaceDiagnosticSpan('session_read'");
    expect(mainTsx).toContain('requestedAfterTurnIndex:');
    expect(mainTsx).toContain('cacheHit: existingMessages.length > 0');
    expect(mainTsx).toContain('turnCount: result.turns.length');
    expect(mainTsx).toContain('messageCount: result.messages.length');
    expect(mainTsx).toContain('payloadBytes: estimateSessionReadPayloadBytes(result)');
    expect(mainTsx).toContain("const chatVisibleRuntimeKeyRef = useRef('');");
    expect(mainTsx).toContain("const chatSelectedLoadAttemptRuntimeKeyRef = useRef('');");
    expect(mainTsx).toContain('resolveSelectedChatVisibilityRecovery({');
    expect(mainTsx).toContain("if (selectedVisibilityRecovery === 'restore-cache') {");
    expect(mainTsx).toContain("if (selectedVisibilityRecovery === 'read-session') {");
    expect(workspacePersistenceTs).toContain('selectedChatProjectId: string;');
    expect(workspacePersistenceTs).toContain('selectedChatSessionId: string;');
    expect(workspaceStoreTs).toContain('getSelectedChatSessionId(projectId: string): string {');
    expect(workspaceStoreTs).toContain('rememberSelectedChatSession(projectId: string, sessionId: string): void {');
    expect(workspaceStoreTs).toContain('getSelectedChatSessionKey(): ChatSessionKey | null {');
    expect(workspaceStoreTs).toContain('rememberSelectedChatSessionKey(key: ChatSessionKey | null): void {');
    expect(mainTsx).toContain('workspaceStore.getSelectedChatSessionId(activeProjectId)');
    expect(mainTsx).toContain('resolveChatListSelection({');
    expect(mainTsx).toContain('workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);');
    expect(mainTsx).toContain('loadChatSession(currentSelection, activeProjectId, {');
    expect(mainTsx).toContain('shouldApplyLoadedChatSelection(');
    const loadChatSessionStart = mainTsx.indexOf('const loadChatSession = async (');
    const loadChatSessionEnd = mainTsx.indexOf('const refreshSessionTurns = async (', loadChatSessionStart);
    const loadChatSessionBlock = mainTsx.slice(loadChatSessionStart, loadChatSessionEnd);
    expect(loadChatSessionBlock).toContain(
      'const canApplyLoadedSelection = shouldApplyLoadedChatSelection(',
    );
    expect(loadChatSessionBlock).toContain('if (canApplyLoadedSelection) {');
    expect(loadChatSessionBlock).toContain('return canApplyLoadedSelection;');
    expect(loadChatSessionBlock).toContain('onPage: page => {');
    expect(loadChatSessionBlock).toContain('turnsAtReadStart');
    expect(loadChatSessionBlock).toContain('markChatSessionTurnsDirty(pageRuntimeKey);');
    expect(loadChatSessionBlock).toContain('await chatDurablePersistQueueRef.current.flush(runtimeKey);');
    expect(mainTsx).toContain('scheduleSelectedChatLoadRetry(runtimeKey);');
  });

  test('a successful selected-session read keeps the read-attempt marker so empty sessions do not loop', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );

    const resetStart = mainTsx.indexOf('const resetSelectedChatLoadRetry = (');
    const resetEnd = mainTsx.indexOf('const scheduleSelectedChatLoadRetry = (', resetStart);
    expect(resetStart).toBeGreaterThan(-1);
    expect(resetEnd).toBeGreaterThan(resetStart);
    const resetBlock = mainTsx.slice(resetStart, resetEnd);
    // A successful read must keep the attempt marker. Otherwise an empty
    // session never satisfies `selectedVisible` (visibleMessageCount > 0) and
    // the recovery effect re-issues read-session every time chatLoading flips
    // back to false, toggling the spinner against the empty panel forever.
    expect(resetBlock).not.toContain("chatSelectedLoadAttemptRuntimeKeyRef.current = ''");

    const scheduleEnd = mainTsx.indexOf('useEffect(() => () => {', resetEnd);
    expect(scheduleEnd).toBeGreaterThan(resetEnd);
    const scheduleBlock = mainTsx.slice(resetEnd, scheduleEnd);
    // The failure-retry path must still clear the marker so backoff can re-read.
    expect(scheduleBlock).toContain("chatSelectedLoadAttemptRuntimeKeyRef.current = ''");
  });

  test('keeps the existing session cache until a stale-cursor full reread succeeds', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'),
      'utf8',
    );
    const repairStart = mainTsx.indexOf('const readProjectSessionWithStaleCacheRepair = async (');
    const repairEnd = mainTsx.indexOf('const loadChatSession = async (', repairStart);
    const repairBlock = mainTsx.slice(repairStart, repairEnd);
    const fullReadIndex = repairBlock.indexOf(
      'await service.readProjectSession(activeProjectId, sessionId, 0, repairReadOptions)',
    );
    const clearCacheIndex = repairBlock.indexOf(
      'clearProjectSessionCache(activeProjectId, sessionId);',
    );

    expect(fullReadIndex).toBeGreaterThan(-1);
    expect(clearCacheIndex).toBeGreaterThan(fullReadIndex);
    expect(repairBlock).toContain('await onPage?.({');
  });
});
