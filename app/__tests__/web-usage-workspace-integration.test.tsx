import fs from 'fs';
import path from 'path';
import {loadUsageHistoryFromSources} from '../web/src/usage/usageHistory';

describe('limits workspace integration', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
  const workspaceService = fs.readFileSync(
    path.join(root, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'),
    'utf8',
  );
  const settings = fs.readFileSync(path.join(root, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
  const persistence = fs.readFileSync(path.join(root, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'), 'utf8');
  const dialogs = fs.readFileSync(path.join(root, 'web', 'src', 'shell', 'AppDialogs.tsx'), 'utf8');
  const settingsCss = fs.readFileSync(path.join(root, 'web', 'src', 'styles', 'settings.css'), 'utf8');

  test('loads cached tokenStats after Registry connection and never creates a usage interval', () => {
    expect(workspaceService).toContain("get: hubId => this.getHubState(hubId, ['tokenStats'])");
    expect(workspaceService).toContain('void this.hubStore.discover(snapshot.hubs.map(hub => hub.hubId))');
    expect(workspaceService).not.toContain('await this.hubStore.discover(snapshot.hubs.map(hub => hub.hubId))');
    expect(main).toContain('usageStore.bindHubStore(service.hubStore)');
    expect(main).not.toContain('RegistryMethods.HubStateUpdated');
    expect(main).not.toContain('setInterval(refreshUsageAcrossHubs');
    expect(main).not.toContain('renderChatMenuUsageButton');
  });

  test('loads large skill inventories only when the composer needs them', () => {
    expect(main).toContain("service.hubStore.getSection(skillHubId, 'skills')");
    expect(main).toContain("service.hubStore.refresh(skillHubId, ['skills'], false)");
  });

  test('loads every account source and keeps a successful Hub when another fails', async () => {
    const resetAt = '2026-08-01T00:00:00Z';
    const request = jest.fn().mockImplementation((source: {hubId: string; accountLocalId: string}) => {
      if (source.hubId === 'hub-b') return Promise.reject(new Error('old Hub'));
      return Promise.resolve({
        hubId: source.hubId,
        providerId: 'codex',
        accountLocalId: source.accountLocalId,
        limits: [{
          id: 'week',
          label: 'W',
          windowKind: 'fixed' as const,
          windowDurationMins: 10080,
          resetsAt: resetAt,
          samples: [
            {observedAtMillis: Date.parse('2026-07-27T23:40:00Z'), remainingPercent: 84},
            {observedAtMillis: Date.parse('2026-07-27T23:50:00Z'), remainingPercent: 83},
            {observedAtMillis: Date.parse('2026-07-28T00:00:00Z'), remainingPercent: 82},
          ],
        }],
      });
    });

    const result = await loadUsageHistoryFromSources({
      providerId: 'codex',
      sources: [
        {hubId: 'hub-a', accountLocalId: 'local-a'},
        {hubId: 'hub-b', accountLocalId: 'local-b'},
      ],
      nowMillis: Date.parse('2026-07-28T00:05:00Z'),
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({status: 'ready', hubId: 'hub-a', limit: {id: 'week'}});
    expect(main).toContain('onOpenHistory={handleUsageRowActivate}');
    expect(main).toContain('<UsageHistoryDialog');
    expect(main).toContain('{usageHistoryOverlay}');
  });

  test('wires the deepseek usage dialog and platform token save', () => {
    expect(main).toContain('openDeepSeekUsage');
    expect(main).toContain('<DeepSeekUsageDialog');
    expect(main).toContain('{deepSeekUsageOverlay}');
    expect(main).toContain("section: 'deepSeekPlatform'");
    expect(workspaceService).toContain('async getDeepSeekUsage(');
  });

  test('keeps the settings screen free of the retired shortcut bar', () => {
    expect(settingsCss).not.toContain('--settings-shortcut-count');
    expect(settingsCss).not.toContain('.mobile-settings-shortcut-bar');
  });

  test('shows Monitor by default and migrates the legacy visibility settings', () => {
    expect(persistence).toContain('showMonitor: boolean;');
    expect(persistence).toContain("showMonitor: 'showMonitor',");
    expect(persistence).toContain("showLimitsMonitor: 'showLimitsMonitor',");
    expect(persistence).toContain("showModelEfficiency: 'showModelEfficiency',");
    expect(persistence).toContain('showMonitor: true,');
    expect(persistence).toContain("const hasLegacyMonitorVisibility = typeof input.showLimitsMonitor === 'boolean'");
    expect(persistence).toContain("const showMonitor = typeof input.showMonitor === 'boolean'");
    expect(persistence).toContain('input.showLimitsMonitor === true || input.showModelEfficiency === true');
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.showMonitor, v: serialize(this.state.global.showMonitor), updatedAt}',
    );
    expect(persistence).not.toContain('this.state.global.showLimitsMonitor');
    expect(persistence).not.toContain('this.state.global.showModelEfficiency');

    const chatStart = settings.indexOf('<SettingsSection id="chat"');
    const codeStart = settings.indexOf('<SettingsSection id="code"');
    const chatSection = settings.slice(chatStart, codeStart);
    expect(chatSection).toContain('Show Monitor');
    expect(chatSection).toContain('checked={showMonitor}');
    expect(chatSection).toContain('setShowMonitor(e.target.checked)');
    expect(chatSection).not.toContain('Show Limits Monitor');
    expect(chatSection).not.toContain('Show Model Efficiency');

    expect(main).toMatch(
      /typeof persistedGlobal\.showMonitor === 'boolean'\r?\n\s*\? persistedGlobal\.showMonitor\r?\n\s*: true/,
    );
    expect(main).toContain('showMonitor={showMonitor}');
    expect(main).toContain('setShowMonitor={setShowMonitor}');
    expect(main).toContain('isWide ? (');
    const stackStart = main.indexOf('chat-edge-surface-stack');
    const stackEnd = main.indexOf('{isWide && chatSidebarCollapsed', stackStart);
    const stackSource = stackStart >= 0 && stackEnd >= 0 ? main.slice(stackStart, stackEnd) : '';
    expect(stackSource).toContain("{showMonitor ? (");
    expect(stackSource).toContain('<MonitorSurface');
    expect(stackSource).toContain('usageSnapshot={visibleUsageSnapshot}');
    expect(stackSource).toContain('efficiencySnapshot={modelEfficiencySnapshot}');
    expect(stackSource).not.toContain('<UsageFeatureSurface');
    expect(stackSource).not.toContain('<ModelEfficiencySurface');
    expect(main).toContain('showMonitor,');
  });

  test('routes title-bar hiding through the shared confirmation dialog', () => {
    expect(dialogs).toContain("| {kind: 'hideMonitor'}");
    expect(dialogs).toContain("if (target.kind === 'hideMonitor') return 'Hide monitor?';");
    expect(dialogs).toContain('You can show it again from Settings > Chat.');
    expect(dialogs).toContain("if (target.kind === 'hideMonitor') return 'Hide';");
    expect(dialogs).not.toContain("kind: 'hideLimitsMonitor'");
    expect(dialogs).not.toContain("kind: 'hideModelEfficiency'");
    expect(main).toContain("onRequestHide={() => setConfirmTarget({kind: 'hideMonitor'})}");
    expect(main).toContain("if (confirmTarget.kind === 'hideMonitor') {");
    expect(main).toContain('setShowMonitor(false);');
  });

  test('adds an always-available Monitor action to the mobile floating nav', () => {
    const model = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'shell', 'layouts', 'mobile', 'mobileFloatingNavModel.ts'),
      'utf8',
    );
    const ids = Array.from(model.matchAll(/\{id: '([^']+)'/g), match => match[1]);

    expect(ids).toEqual(['preview', 'terminal', 'relay', 'monitor', 'settings', 'chat']);
    expect(model).toContain("{id: 'monitor', icon: 'activity', label: 'Monitor'}");
  });

  test('uses cached usage in one exclusive mobile overlay and closes it first on native back', () => {
    expect(main).toContain('const [mobileUsageOpen, setMobileUsageOpen] = useState(false);');
    expect(main).toContain('const mobileUsageOverlay = !isWide && mobileUsageOpen ? (');
    expect(main).toContain('<MobileUsageDialog');
    expect(main).toContain('snapshot={visibleUsageSnapshot}');
    expect(main).toContain('{mobileUsageOverlay}');
    expect(main).toContain('{terminalMobileOverlay}');
    expect(main).toContain('{chatPreviewMobileOverlay}');

    const selectStart = main.indexOf('const handleFloatingNavSelect = useCallback(');
    const selectEnd = main.indexOf('const toggleTerminalFromTitle', selectStart);
    const selectBody = selectStart >= 0 && selectEnd >= 0 ? main.slice(selectStart, selectEnd) : '';
    expect(selectBody).toContain("destination === 'monitor'");
    expect(selectBody).toContain('setMobileUsageOpen(true);');
    expect(selectBody).toContain('setTerminalOpen(false);');
    expect(selectBody).toContain('hideChatPreviewSurface();');
    expect(selectBody).not.toContain('closeChatPreview();');
    expect(selectBody).not.toContain('refreshUsageAcrossHubs');

    const backStart = main.indexOf('const handleAndroidNativeBack');
    const backEnd = main.indexOf('useEffect(() => {', backStart);
    const backHandler = backStart >= 0 && backEnd >= 0 ? main.slice(backStart, backEnd) : '';
    expect(backHandler.indexOf('mobileUsageOpen')).toBeGreaterThan(0);
    expect(backHandler.indexOf('mobileUsageOpen')).toBeLessThan(backHandler.indexOf('terminalOpen'));
    expect(backHandler).toContain('setMobileUsageOpen(false);');
  });
});
