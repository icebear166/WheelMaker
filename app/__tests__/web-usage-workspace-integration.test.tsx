import fs from 'fs';
import path from 'path';

describe('limits workspace integration', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
  const persistence = fs.readFileSync(path.join(root, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'), 'utf8');
  const dialogs = fs.readFileSync(path.join(root, 'web', 'src', 'shell', 'AppDialogs.tsx'), 'utf8');
  const settingsCss = fs.readFileSync(path.join(root, 'web', 'src', 'styles', 'settings.css'), 'utf8');

  test('loads cached tokenStats after Registry connection and never creates a usage interval', () => {
    expect(main).toContain("getHubState(hub.hubId, ['tokenStats'])");
    expect(main).toContain('RegistryMethods.HubStateUpdated');
    expect(main).not.toContain('setInterval(refreshUsageAcrossHubs');
    expect(main).not.toContain('renderChatMenuUsageButton');
  });

  test('uses four data-driven Settings shortcut columns', () => {
    expect(settingsCss).toContain('repeat(var(--settings-shortcut-count), minmax(0, 1fr))');
    expect(settingsCss).toContain('calc(100% / var(--settings-shortcut-count))');
    expect(settingsCss).not.toContain("data-active-index='4'");
  });

  test('shows the limits monitor by default and persists its Chat setting', () => {
    expect(persistence).toContain('showLimitsMonitor: boolean;');
    expect(persistence).toContain("showLimitsMonitor: 'showLimitsMonitor',");
    expect(persistence).toContain('showLimitsMonitor: true,');
    expect(persistence).toContain(
      "showLimitsMonitor: typeof input.showLimitsMonitor === 'boolean' ? input.showLimitsMonitor : base.showLimitsMonitor",
    );
    expect(persistence).toContain(
      '{k: GLOBAL_KEYS.showLimitsMonitor, v: serialize(this.state.global.showLimitsMonitor), updatedAt}',
    );

    const chatStart = settings.indexOf("renderSettingsSection({id: 'chat'");
    const connectionStart = settings.indexOf("renderSettingsSection({id: 'connection'");
    const chatSection = settings.slice(chatStart, connectionStart);
    expect(chatSection).toContain('Show Limits Monitor');
    expect(chatSection).toContain('checked={showLimitsMonitor}');
    expect(chatSection).toContain('setShowLimitsMonitor(e.target.checked)');

    expect(main).toMatch(
      /typeof persistedGlobal\.showLimitsMonitor === 'boolean'\r?\n\s*\? persistedGlobal\.showLimitsMonitor\r?\n\s*: true/,
    );
    expect(main).toContain('showLimitsMonitor={showLimitsMonitor}');
    expect(main).toContain('setShowLimitsMonitor={setShowLimitsMonitor}');
    expect(main).toContain("isWide && tab === 'chat' ? (");
    const stackStart = main.indexOf('className="chat-edge-surface-stack"');
    const stackSource = stackStart >= 0 ? main.slice(stackStart, stackStart + 2600) : '';
    expect(stackSource).toContain("{showLimitsMonitor ? (");
    expect(stackSource).toContain('<UsageFeatureSurface');
    expect(main).toContain('showLimitsMonitor,');
  });

  test('routes title-bar hiding through the shared confirmation dialog', () => {
    expect(dialogs).toContain("| {kind: 'hideLimitsMonitor'}");
    expect(dialogs).toContain("if (target.kind === 'hideLimitsMonitor') return 'Hide limits monitor?';");
    expect(dialogs).toContain('You can show it again from Settings > Chat.');
    expect(dialogs).toContain("if (target.kind === 'hideLimitsMonitor') return 'Hide';");
    expect(main).toContain("onRequestHide={() => setConfirmTarget({kind: 'hideLimitsMonitor'})}");
    expect(main).toContain("if (confirmTarget.kind === 'hideLimitsMonitor') {");
    expect(main).toContain('setShowLimitsMonitor(false);');
  });

  test('adds an always-available Limits action to the five-button mobile shortcut', () => {
    const pillStart = main.indexOf('className="gesture-nav-pill"');
    const pillEnd = main.indexOf('</div>', pillStart);
    const pill = pillStart >= 0 && pillEnd >= 0 ? main.slice(pillStart, pillEnd) : '';
    const keys = Array.from(pill.matchAll(/key="([^"]+)"/g), match => match[1]);

    expect(keys).toEqual(['preview', 'terminal', 'chat', 'limits', 'settings']);
    expect(pill).not.toContain('showLimitsMonitor');
    expect(pill).toContain('aria-label="Terminal"');
    expect(pill).toContain('aria-label="Limits"');
  });

  test('uses cached usage in one exclusive mobile overlay and closes it first on native back', () => {
    expect(main).toContain('const [mobileUsageOpen, setMobileUsageOpen] = useState(false);');
    expect(main).toContain('const mobileUsageOverlay = !isWide && mobileUsageOpen ? (');
    expect(main).toContain('<MobileUsageDialog');
    expect(main).toContain('snapshot={usageSnapshot}');
    expect(main).toContain('mobileOverlay={mobileUsageOverlay ?? terminalMobileOverlay ?? chatPreviewMobileOverlay}');

    const limitsButtonStart = main.indexOf('key="limits"');
    const limitsButtonEnd = main.indexOf('</button>', limitsButtonStart);
    const limitsButton = limitsButtonStart >= 0 && limitsButtonEnd >= 0
      ? main.slice(limitsButtonStart, limitsButtonEnd)
      : '';
    expect(limitsButton).toContain('setTerminalOpen(false);');
    expect(limitsButton).toContain('closeChatPreview();');
    expect(limitsButton).not.toContain('refreshUsageAcrossHubs');

    const backStart = main.indexOf('const handleAndroidNativeBack');
    const backEnd = main.indexOf('useEffect(() => {', backStart);
    const backHandler = backStart >= 0 && backEnd >= 0 ? main.slice(backStart, backEnd) : '';
    expect(backHandler.indexOf('mobileUsageOpen')).toBeGreaterThan(0);
    expect(backHandler.indexOf('mobileUsageOpen')).toBeLessThan(backHandler.indexOf('terminalOpen'));
    expect(backHandler).toContain('setMobileUsageOpen(false);');
  });
});
