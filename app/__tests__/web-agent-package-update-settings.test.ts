import fs from 'fs';
import path from 'path';

import {
  deriveOperationalHubIds,
  deriveWheelMakerHubStatus,
  fetchWheelMakerPublicMetadata,
  fetchWheelMakerReleaseHistory,
  parseWheelMakerStable,
  WHEELMAKER_PUBLISH_STATUS_URL,
  WHEELMAKER_RELEASE_HISTORY_URL,
  WHEELMAKER_STABLE_URL,
  wheelMakerUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
} from '../web/src/settings/agentPackageUpdateView';
import type {RegistryWheelMakerUpdateResponse} from '../web/src/registry/registryTypes';
import {readWebStyles} from '../testHelpers/webStyles';

test('includes Hubs discovered through online project reports in operation refreshes', () => {
  expect(deriveOperationalHubIds(
    [{hubId: 'snapshot-hub'}],
    [
      {hubId: 'reported-hub', online: true},
      {hubId: 'offline-hub', online: false},
    ],
  )).toEqual(['reported-hub', 'snapshot-hub']);
});

test('renders installed and stable WheelMaker release versions', () => {
  const updateResponse: RegistryWheelMakerUpdateResponse = {
    ok: true,
    status: 'installed',
    hubId: 'hub-a',
    installed: {
      schemaVersion: 2,
      version: 'v1.22',
      publishedAt: '2026-07-15T09:00:00Z',
      sourceSha: 'a'.repeat(40),
      manifestSha256: 'c'.repeat(64),
      installedAt: '2026-07-15T09:05:00Z',
    },
    canRequestUpdate: true,
  };

  const stable = parseWheelMakerStable({
    schema: 2,
    version: 'v1.23',
    publishedAt: '2026-07-16T09:00:00Z',
    sourceSha: 'b'.repeat(40),
  });

  expect(wheelMakerVersionCopy(updateResponse, stable)).toEqual({current: 'v1.22', latest: 'v1.23'});
  expect(deriveWheelMakerHubStatus(updateResponse.installed, stable)).toBe('update_available');
  expect(deriveWheelMakerHubStatus({...updateResponse.installed, version: 'v1.23'}, stable)).toBe('up_to_date');
  expect(deriveWheelMakerHubStatus({...updateResponse.installed, version: 'v1.24'}, stable)).toBe('local_newer');
  expect(wheelMakerUpdateStatusLabel('downloading')).toBe('Downloading');
  expect(wheelMakerUpdateJobActive({
    schema: 1,
    jobId: 'job-a',
    state: 'downloading',
    startedAt: '2026-07-16T09:00:00Z',
    updatedAt: '2026-07-16T09:01:00Z',
  })).toBe(true);
  expect(wheelMakerUpdateJobActive({
    schema: 1,
    jobId: 'job-a',
    state: 'succeeded',
    startedAt: '2026-07-16T09:00:00Z',
    updatedAt: '2026-07-16T09:02:00Z',
  })).toBe(false);
});

test('stable metadata preserves a valid Desktop pointer', () => {
  const stable = parseWheelMakerStable({
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    desktopExe: {
      version: 'v1.22',
      path: '/releases/v1.22/WheelMakerDesktop.exe',
      sha256: 'b'.repeat(64),
    },
  });

  expect(stable.desktopExe?.version).toBe('v1.22');
  expect(stable.desktopExe?.sha256).toBe('b'.repeat(64));
});

test.each([
  {version: 'v1.22', path: 'https://evil.example/Desktop.exe', sha256: 'b'.repeat(64)},
  {version: 'v1.22', path: '/releases/v1.22/WheelMakerDesktop.exe', sha256: 'bad'},
])('stable metadata rejects invalid Desktop pointers', desktopExe => {
  expect(() => parseWheelMakerStable({
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    desktopExe,
  })).toThrow(/Desktop pointer/);
});

test('loads strict public metadata once per global endpoint', async () => {
  const requests: string[] = [];
  const request = jest.fn(async (url: string) => {
    requests.push(url);
    if (url.endsWith('/stable.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          schema: 2,
          version: 'v1.24',
          publishedAt: '2026-07-17T09:00:00Z',
          sourceSha: 'a'.repeat(40),
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        schema: 1,
        state: 'running',
        phase: 'packaging',
        version: 'v1.25',
      }),
    };
  }) as unknown as typeof fetch;

  await expect(fetchWheelMakerPublicMetadata(request)).resolves.toMatchObject({
    stable: {version: 'v1.24'},
    publishStatus: {phase: 'packaging'},
  });
  expect(requests.filter(url => url.endsWith('/stable.json'))).toHaveLength(1);
  expect(requests.filter(url => url.endsWith('/publish-status.json'))).toHaveLength(1);
  expect(() => parseWheelMakerStable({schema: 1, version: 'v1.24'})).toThrow(/stable metadata/i);
});

test('loads schema 2 metadata and release history from one origin', async () => {
  expect(WHEELMAKER_STABLE_URL).toBe('https://release.wheelmaker.top/stable.json');
  expect(WHEELMAKER_PUBLISH_STATUS_URL).toBe('https://release.wheelmaker.top/publish-status.json');
  expect(WHEELMAKER_RELEASE_HISTORY_URL).toBe('https://release.wheelmaker.top/releases.json');
  const request = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      schema: 1,
      releases: [
        {version: 'v1.2', publishedAt: '2026-07-15T09:00:00Z', sourceSha: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), assets: []},
        {version: 'v1.3', publishedAt: '2026-07-16T09:00:00Z', sourceSha: 'c'.repeat(40), manifestSha256: 'd'.repeat(64), assets: []},
      ],
    }),
  }) as unknown as typeof fetch;

  await expect(fetchWheelMakerReleaseHistory(request)).resolves.toEqual([
    {version: 'v1.3', publishedAt: '2026-07-16T09:00:00Z', url: 'https://release.wheelmaker.top/releases/v1.3/release-manifest.json'},
    {version: 'v1.2', publishedAt: '2026-07-15T09:00:00Z', url: 'https://release.wheelmaker.top/releases/v1.2/release-manifest.json'},
  ]);
  expect(request).toHaveBeenCalledWith(WHEELMAKER_RELEASE_HISTORY_URL, {cache: 'no-store'});
});

describe('agent package update settings UI source structure', () => {
  test('moves shortcut details out of More and keeps Chat focused on chat options', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');

    expect(mainTsx).toContain("} from '../settings/settingsNavigation';");
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).not.toContain("if (detail === 'update') {");
    expect(settingsRootTsx).not.toContain("renderSettingsSection('More'");
    expect(settingsRootTsx).not.toContain("renderSettingsSection('Storage'");

    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const codeDisplayStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'code-display'", chatStart);
    expect(chatStart).toBeGreaterThanOrEqual(0);
    expect(codeDisplayStart).toBeGreaterThan(chatStart);
    const chatSection = settingsRootTsx.slice(chatStart, codeDisplayStart);
    expect(chatSection).not.toContain('Use Latest Prompt Title');
    expect(chatSection).not.toContain('Hide Tool Calls');
    expect(chatSection).not.toContain('Token Stats');
    expect(chatSection).not.toContain('CC Switch');

    const debugStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'debug'");
    expect(debugStart).toBeGreaterThan(codeDisplayStart);
    const debugSection = settingsRootTsx.slice(debugStart);
    expect(debugSection).not.toContain("setSettingsDetailView('update')");
    expect(debugSection).not.toContain("setSettingsDetailView('skills')");
    expect(debugSection).not.toContain("setSettingsDetailView('tokenStats')");
    expect(debugSection).not.toContain("setSettingsDetailView('ccSwitch')");
    expect(debugSection).not.toContain("setSettingsDetailView('portRelay')");
    expect(debugSection.indexOf("openSettingsChild('database')")).toBeGreaterThanOrEqual(0);
    expect(debugSection.indexOf("openSettingsChild('database')")).toBeLessThan(debugSection.indexOf('requestClearLocalCache'));
    expect(debugSection.indexOf('requestClearLocalCache')).toBeLessThan(debugSection.indexOf('handleRegistryDebugLogout'));
  });

  test('wires update, npm, skills, index and footer actions into the hub menu', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const menuTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubMenu.tsx'), 'utf8');
    const skillTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubSkillManagement.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('opsByHubId={chatHubOpsByHubId}');
    expect(mainTsx).toContain('onRequestWheelMakerUpdate={handleChatHubWheelMakerUpdate}');
    expect(mainTsx).toContain('onRequestNpmUpdate={handleChatHubNpmUpdate}');
    expect(mainTsx).toContain('onPackageAction={handleChatHubPackageAction}');
    expect(mainTsx).toContain('onRequestSkillUpdate={requestSkillUpdate}');
    expect(mainTsx).toContain('onRequestSkillUninstall={requestSkillUninstall}');
    expect(mainTsx).toContain('onRequestSkillBatchUninstall={requestSkillBatchUninstall}');
    expect(mainTsx).not.toContain('onScanSkills={handleChatHubScanSkills}');
    expect(mainTsx).toContain('onScanAllIndexes={handleChatHubScanAllIndexes}');
    expect(mainTsx).toContain('onScanProject={handleChatHubScanProject}');
    expect(mainTsx).not.toContain('onToggleAllProjects={handleChatHubToggleAllProjects}');
    expect(mainTsx).toContain('onUpdateAllHubs={handleChatHubUpdateAllHubs}');
    expect(mainTsx).toContain('requestAgentPackageHubUpdate(hubId, targets);');
    expect(mainTsx).toContain('requestAgentPackageAction(action, hubId, fullPackage);');

    expect(menuTsx).toContain('chat-hub-version-action');
    expect(menuTsx).toContain('chat-hub-disclosure-action');
    expect(menuTsx).not.toContain('className="chat-hub-action-toggle"');
    expect(menuTsx).toContain('className="chat-hub-npm-row"');
    expect(skillTsx).toContain('className="chat-hub-skill-row"');
    expect(menuTsx).toContain('className="chat-hub-scan-row"');
    expect(menuTsx).toContain('className="chat-hub-footer"');
    expect(menuTsx).toContain('Update all hubs');
    expect(menuTsx).not.toContain('Reinstall');

    const hubActions = stylesCss.match(/\.chat-hub-line-actions \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hubActions).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(stylesCss).toContain('.chat-hub-action-pending');
    expect(stylesCss).not.toContain('.chat-hub-disclosure-action .sl-icon');
    expect(stylesCss).toContain('.chat-hub-row-actions');
    expect(stylesCss).toContain('.chat-hub-detail');
    expect(stylesCss).toContain('.chat-hub-footer');
    expect(stylesCss).not.toContain('.chat-hub-ops-grid');
  });

  test('keeps scan polling scoped to the open hub menu', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain('const refreshWheelMakerUpdatesRef = useRef<((hubIds: string[], options?: {silent?: boolean}) => Promise<void>) | null>(null);');
    expect(mainTsx).toContain('const refreshAgentPackagesRef = useRef<((hubIds: string[], options?: {silent?: boolean}) => Promise<void>) | null>(null);');
    expect(mainTsx).not.toContain('refreshAndroidApkUpdateRef');
    expect(mainTsx).toContain('const clearAgentPackageScanPollTimer = useCallback(() => {');
    expect(mainTsx).toContain('clearAgentPackageScanPollTimer();');
    expect(mainTsx).toContain('if (!options.silent) {');
    expect(mainTsx).toContain('loading: !options.silent,');
    expect(mainTsx).toContain('if (!updateSurfaceActiveRef.current) {');
    expect(mainTsx).toContain('updateSurfaceActiveRef.current = chatHubMenuOpen;');
    expect(mainTsx).toContain('refreshAgentPackagesRef.current?.(Array.from(runningHubIds), {silent: true}).catch(() => undefined);');
  });

  test('keeps Hub operation scans downstream of the current Hub list', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain(
      'const registryHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));',
    );
    const menuEffectStart = mainTsx.indexOf("if (!chatHubMenuOpen || !connected || registryHubIds.length === 0) {");
    const menuEffectEnd = mainTsx.indexOf('}, [chatHubMenuOpen, connected, refreshChatHubFlickerBridge, refreshChatHubConfig, registryHubIds]);', menuEffectStart);
    expect(menuEffectStart).toBeGreaterThanOrEqual(0);
    expect(menuEffectEnd).toBeGreaterThan(menuEffectStart);
    const menuEffect = mainTsx.slice(menuEffectStart, menuEffectEnd);
    expect(menuEffect).toContain('refreshWheelMakerUpdatesRef.current?.(registryHubIds, {silent: true})');
    expect(menuEffect).toContain('refreshAgentPackagesRef.current?.(registryHubIds, {silent: true})');
    expect(menuEffect).toContain('refreshProjectFileIndexesRef.current?.(registryHubIds, {silent: true})');
    expect(menuEffect).not.toContain('refreshProjectHubSnapshot');

    const wheelMakerStart = mainTsx.indexOf('const refreshWheelMakerUpdates = useCallback');
    const wheelMakerEnd = mainTsx.indexOf('const refreshAgentPackages = useCallback', wheelMakerStart);
    const wheelMakerBlock = mainTsx.slice(wheelMakerStart, wheelMakerEnd);
    expect(wheelMakerBlock).toContain('const refreshWheelMakerUpdates = useCallback(async (hubIds: string[], options: {silent?: boolean} = {}) =>');
    expect(wheelMakerBlock).not.toContain('refreshProjectHubSnapshot');

    const agentStart = mainTsx.indexOf('const refreshAgentPackages = useCallback');
    const agentEnd = mainTsx.indexOf('const refreshProjectFileIndexes = useCallback', agentStart);
    const agentBlock = mainTsx.slice(agentStart, agentEnd);
    expect(agentBlock).toContain('const refreshAgentPackages = useCallback(async (hubIds: string[], options: {silent?: boolean} = {}) =>');
    expect(agentBlock).not.toContain('refreshProjectHubSnapshot');
  });

  test('updates each hub scan surface as its request settles', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    const wheelMakerStart = mainTsx.indexOf('const refreshWheelMakerUpdates = useCallback');
    const wheelMakerEnd = mainTsx.indexOf('const refreshAgentPackages = useCallback', wheelMakerStart);
    expect(wheelMakerStart).toBeGreaterThanOrEqual(0);
    expect(wheelMakerEnd).toBeGreaterThan(wheelMakerStart);
    const wheelMakerBlock = mainTsx.slice(wheelMakerStart, wheelMakerEnd);
    expect(wheelMakerBlock).toContain('await Promise.all(hubIds.map(async hubId => {');
    expect(wheelMakerBlock).not.toContain('const responses = await Promise.all(hubIds.map');
    expect(wheelMakerBlock).not.toContain('responses.forEach(entry =>');
    const wheelMakerRequestIndex = wheelMakerBlock.indexOf('const result = await service.queryWheelMakerUpdate(hubId);');
    const wheelMakerUpdateIndex = wheelMakerBlock.indexOf('setWheelMakerUpdateHubs(prev => ({', wheelMakerRequestIndex);
    expect(wheelMakerUpdateIndex).toBeGreaterThan(wheelMakerRequestIndex);

    const agentStart = mainTsx.indexOf('const refreshAgentPackages = useCallback');
    const agentEnd = mainTsx.indexOf('const refreshProjectFileIndexes = useCallback', agentStart);
    expect(agentStart).toBeGreaterThanOrEqual(0);
    expect(agentEnd).toBeGreaterThan(agentStart);
    const agentBlock = mainTsx.slice(agentStart, agentEnd);
    expect(agentBlock).toContain('const runningHubIds = new Set<string>();');
    expect(agentBlock).toContain('await Promise.all(hubIds.map(async hubId => {');
    expect(agentBlock).not.toContain('const responses = await Promise.all(hubIds.map');
    expect(agentBlock).not.toContain('responses.forEach(entry =>');
    const agentRequestIndex = agentBlock.indexOf('const result = await withAgentPackageTimeout(');
    const agentUpdateIndex = agentBlock.indexOf('setAgentPackageHubs(prev => ({', agentRequestIndex);
    expect(agentUpdateIndex).toBeGreaterThan(agentRequestIndex);

    const projectIndexStart = mainTsx.indexOf('const refreshProjectFileIndexes = useCallback');
    const projectIndexEnd = mainTsx.indexOf('useEffect(() => {\n    refreshWheelMakerUpdatesRef.current = refreshWheelMakerUpdates;', projectIndexStart);
    expect(projectIndexStart).toBeGreaterThanOrEqual(0);
    expect(projectIndexEnd).toBeGreaterThan(projectIndexStart);
    const projectIndexBlock = mainTsx.slice(projectIndexStart, projectIndexEnd);
    expect(projectIndexBlock).toContain('const runningHubIds = new Set<string>();');
    expect(projectIndexBlock).toContain('await Promise.all(ids.map(async hubId => {');
    expect(projectIndexBlock).not.toContain('const responses = await Promise.all(ids.map');
    expect(projectIndexBlock).not.toContain('responses.forEach(entry =>');
    const projectRequestIndex = projectIndexBlock.indexOf('const result = await service.getFileIndexStatus(hubId);');
    const projectUpdateIndex = projectIndexBlock.indexOf('setProjectIndexByHubId(prev => ({', projectRequestIndex);
    expect(projectUpdateIndex).toBeGreaterThan(projectRequestIndex);
  });

  test('uses explicit agent tag variants and softly sized capsules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    const agentVariantTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'chat', 'agentTagVariant.ts'), 'utf8');
    expect(mainTsx).toContain("from '../chat/agentTagVariant'");
    expect(mainTsx).toContain("if (prefix === 'wide-session-agent')");
    expect(agentVariantTsx).toContain('const AGENT_TAG_VARIANT_INDEX');
    expect(agentVariantTsx).toContain("claude: 2");
    expect(agentVariantTsx).toContain("flicker: 8");
    expect(mainTsx).not.toContain("codexapp: 3");
    expect(mainTsx).not.toContain(`${['my', 'flicker'].join('')}:`);
    expect(mainTsx).not.toContain('token-stats-pill-agent');

    const agentTagBlock = stylesCss.match(/\.wide-session-agent-tag \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(agentTagBlock).toContain('display: inline-flex;');
    expect(agentTagBlock).toContain('max-width: 96px;');
    expect(agentTagBlock).toContain('padding: 0 7px;');
    expect(agentTagBlock).toContain('font-size: 10.5px;');
    expect(agentTagBlock).toContain('border-radius: 999px;');
    expect(agentTagBlock).toContain('background: color-mix(in srgb, var(--agent-accent, #666) 14%, transparent);');
    expect(stylesCss).toContain('.wide-session-agent-8 { --agent-accent: #69db7c; }');
    expect(stylesCss).not.toContain('.token-stats-');
  });

  test('hides desktop shortcuts and shares the Settings shortcut bar across settings screens', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).not.toContain('renderSkillsSettingsDetail(options)');
    expect(mainTsx).toContain("openSettingsPeer('portRelay')");
    expect(mainTsx).not.toContain("openSettingsPeer('ccSwitch')");
    expect(mainTsx).toContain('const desktopWindowControls = desktopWindowControlsVisible ? (');
    expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).not.toContain('const isShortcutSettingsDetailActive = sidebarSettingsOpen && isSettingsPeerDetail(settingsDetailView);');
    expect(mainTsx).not.toContain('title="CC Switch"');
    expect(mainTsx).not.toContain('aria-label="CC Switch"');

    const floatingStart = mainTsx.indexOf('const floatingControlStack = !isWide ? (');
    const settingsBarStart = mainTsx.indexOf('const settingsShortcutBar = sidebarSettingsOpen ? (', floatingStart);
    const mobileOnly = mainTsx.slice(floatingStart, settingsBarStart);
    expect(mobileOnly).not.toContain("openSettingsDetail('update')");

    const settingsBarEnd = mainTsx.indexOf('const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (', settingsBarStart);
    expect(settingsBarStart).toBeGreaterThanOrEqual(0);
    expect(settingsBarEnd).toBeGreaterThan(settingsBarStart);
    const settingsBar = mainTsx.slice(settingsBarStart, settingsBarEnd);
    expect(settingsBar).toContain('<MobileSettingsShortcutBar');
    expect(settingsBar).toContain('onRootSelect={handleMobileSettingsRootShortcut}');
    expect(settingsBar).toContain('onDetailSelect={openMobileSettingsShortcutDetail}');
    expect(settingsBar).toContain('activeIndex={mobileSettingsShortcutActiveIndex}');
    expect(mainTsx).toContain('const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (');
    expect(mainTsx).toContain('shortcutBar={settingsShortcutBar}');
    expect(mainTsx).toContain('const mobileSettingsScreen = !isWide && sidebarSettingsOpen ? (');
    const surfaceShortcutStart = settingsSurfaceTsx.indexOf('export const MOBILE_SETTINGS_SHORTCUTS');
    const surfaceShortcutEnd = settingsSurfaceTsx.indexOf('export function settingsDetailTitle', surfaceShortcutStart);
    const surfaceShortcuts = settingsSurfaceTsx.slice(surfaceShortcutStart, surfaceShortcutEnd);
    expect(surfaceShortcutStart).toBeGreaterThanOrEqual(0);
    expect(surfaceShortcutEnd).toBeGreaterThan(surfaceShortcutStart);
    expect(surfaceShortcuts).not.toContain("detail: 'update'");
    expect(surfaceShortcuts).not.toContain("detail: 'skills'");
    expect(surfaceShortcuts).toContain("detail: 'portRelay'");
    expect(surfaceShortcuts).not.toContain("detail: 'ccSwitch'");
    const surfaceBarStart = settingsSurfaceTsx.indexOf('export function MobileSettingsShortcutBar');
    const surfaceBarEnd = settingsSurfaceTsx.indexOf('export function MobileSettingsScreen', surfaceBarStart);
    const surfaceBar = settingsSurfaceTsx.slice(surfaceBarStart, surfaceBarEnd);
    expect(surfaceBar.indexOf('title="Settings"')).toBeLessThan(surfaceBar.indexOf('MOBILE_SETTINGS_SHORTCUTS.map'));
    expect(surfaceBar).toContain('className="mobile-settings-shortcut-track"');
    expect(surfaceBar).toContain('onClick={onRootSelect}');
    expect(surfaceBar).toContain('onClick={() => onDetailSelect(shortcut.detail)}');
    expect(surfaceBar).toContain('className="mobile-settings-shortcut-label">Settings</span>');
    expect(surfaceBar).toContain('className="mobile-settings-shortcut-label">{shortcut.label}</span>');

    const chatSessionHeaderStart = mainTsx.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const chatSessionHeaderEnd = mainTsx.indexOf('const renderMobileChatSessionSheet = (', chatSessionHeaderStart);
    expect(chatSessionHeaderStart).toBeGreaterThanOrEqual(0);
    expect(chatSessionHeaderEnd).toBeGreaterThan(chatSessionHeaderStart);
    const chatSessionHeader = mainTsx.slice(chatSessionHeaderStart, chatSessionHeaderEnd);
    expect(chatSessionHeader).toContain('{!searchHeaderExpanded ? (');
    expect(chatSessionHeader).not.toContain('{renderChatMenuUsageButton()}');
    expect(chatSessionHeader).toContain('renderWheelMakerAppMenu(true)');
    expect(chatSessionHeader).not.toContain('title="Update"');
    expect(chatSessionHeader).not.toContain('title="Port Relay"');
    expect(chatSessionHeader).not.toContain("openSettingsDetail('update')");
    expect(chatSessionHeader).not.toContain("openSettingsDetail('portRelay')");
    expect(chatSessionHeader).not.toContain('refreshMobileChatProjectSessions()');
    expect(chatSessionHeader).not.toContain('title={reconnecting ? \'Reconnecting...\' : \'Refresh chats\'}');

    const mobileChatSessionHeaderBlock = stylesCss.match(/\.chat-session-header\.mobile \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileChatSessionHeaderBlock).toContain('padding: var(--wm-safe-area-top) 8px 0;');
    expect(mobileChatSessionHeaderBlock).not.toContain('border-radius: 10px;');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar {');

    expect(stylesCss).toContain('.mobile-settings-shortcut-bar {');
    expect(stylesCss).toContain('.mobile-settings-shortcut-track {');
    expect(stylesCss).toContain('.mobile-settings-shortcut-track::before {');
    expect(stylesCss).toContain('.mobile-settings-shortcut-button {');
    expect(stylesCss).toContain('.mobile-settings-shortcut-label {');
    const mobileShortcutBarBlock = stylesCss.match(/\.mobile-settings-shortcut-bar \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutBarBlock).toContain('display: flex;');
    expect(mobileShortcutBarBlock).toContain('justify-content: center;');
    expect(mobileShortcutBarBlock).toContain('padding: 0 12px env(safe-area-inset-bottom, 0px);');
    expect(mobileShortcutBarBlock).not.toContain('grid-template-columns: repeat(6');
    const mobileShortcutTrackBlock = stylesCss.match(/\.mobile-settings-shortcut-track \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutTrackBlock).toContain('width: min(100%, 340px);');
    expect(mobileShortcutTrackBlock).toContain('grid-template-columns: repeat(var(--settings-shortcut-count), minmax(0, 1fr));');
    const mobileShortcutButtonBlock = stylesCss.match(/\.mobile-settings-shortcut-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutButtonBlock).toContain('height: 58px;');
    expect(mobileShortcutButtonBlock).toContain('flex-direction: column;');
    const mobileShortcutIndicatorBlock = stylesCss.match(/\.mobile-settings-shortcut-track::before \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutIndicatorBlock).toContain('top: 0;');
    expect(mobileShortcutIndicatorBlock).toContain('width: calc(100% / var(--settings-shortcut-count));');
    expect(mobileShortcutIndicatorBlock).toContain('transition: transform');
    expect(stylesCss).not.toContain(".mobile-settings-shortcut-bar[data-active-index='4'] .mobile-settings-shortcut-track::before");
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-button.active::before');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar-icon.active');
  });
});
