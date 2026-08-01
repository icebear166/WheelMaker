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
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetail | null;');
    expect(mainTsx).not.toContain("if (detail === 'update') {");
    expect(settingsRootTsx).not.toContain("renderSettingsSection('More'");
    expect(settingsRootTsx).not.toContain("renderSettingsSection('Storage'");

    const chatStart = settingsRootTsx.indexOf('<SettingsSection id="chat"');
    const codeDisplayStart = settingsRootTsx.indexOf('<SettingsSection id="code"', chatStart);
    expect(chatStart).toBeGreaterThanOrEqual(0);
    expect(codeDisplayStart).toBeGreaterThan(chatStart);
    const chatSection = settingsRootTsx.slice(chatStart, codeDisplayStart);
    expect(chatSection).not.toContain('Use Latest Prompt Title');
    expect(chatSection).not.toContain('Hide Tool Calls');
    expect(chatSection).not.toContain('Token Stats');
    expect(chatSection).not.toContain('CC Switch');

    const stateStart = settingsRootTsx.indexOf('<SettingsSection id="state"');
    const debugStart = settingsRootTsx.indexOf('<SettingsSection id="debug"');
    expect(stateStart).toBeGreaterThan(codeDisplayStart);
    expect(debugStart).toBeGreaterThan(stateStart);
    const stateSection = settingsRootTsx.slice(stateStart, debugStart);
    expect(stateSection.indexOf("openSettingsDetail('database')")).toBeGreaterThanOrEqual(0);
    expect(stateSection.indexOf("openSettingsDetail('database')")).toBeLessThan(stateSection.indexOf('requestClearLocalCache'));
    expect(stateSection.indexOf('requestClearLocalCache')).toBeLessThan(stateSection.indexOf('handleRegistryDebugLogout'));
    const debugSection = settingsRootTsx.slice(debugStart);
    expect(debugSection).not.toContain("setSettingsDetailView('update')");
    expect(debugSection).not.toContain("setSettingsDetailView('skills')");
    expect(debugSection).not.toContain("setSettingsDetailView('tokenStats')");
    expect(debugSection).not.toContain("setSettingsDetailView('ccSwitch')");
    expect(debugSection).not.toContain("setSettingsDetailView('portRelay')");
  });

  test('wires update, npm, skills, index and footer actions into the hub menu', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const menuTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubMenu.tsx'), 'utf8');
    const skillTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubSkillManagement.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('opsByHubId={chatHubOpsByHubId}');
    expect(mainTsx).toContain('onRequestWheelMakerUpdate={handleChatHubWheelMakerUpdate}');
    expect(mainTsx).toContain('onRequestWheelMakerRestart={handleChatHubWheelMakerRestart}');
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

  test('does not poll package scans from the open hub menu', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain('const hubOperationalViews = useMemo(');
    expect(mainTsx).toContain('() => deriveHubOperationalViews(hubStoreSnapshot)');
    expect(mainTsx).not.toContain('refreshWheelMakerUpdatesRef');
    expect(mainTsx).not.toContain('refreshAgentPackagesRef');
    expect(mainTsx).not.toContain('refreshAndroidApkUpdateRef');
    expect(mainTsx).not.toContain('agentPackageScanPollTimerRef');
    expect(mainTsx).not.toContain('updateSurfaceActiveRef');
  });

  test('keeps Hub operation scans downstream of the current Hub list', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');
    const refreshTriggers = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'hubState', 'hubRefreshTriggers.ts'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain(
      'const registryHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));',
    );
    const menuEffectStart = mainTsx.indexOf("if (!chatHubMenuOpen || !connected || registryHubIds.length === 0) {");
    const menuEffectEnd = mainTsx.indexOf('}, [chatHubMenuOpen, connected, refreshChatHubConfig, registryHubIdsKey]);', menuEffectStart);
    expect(menuEffectStart).toBeGreaterThanOrEqual(0);
    expect(menuEffectEnd).toBeGreaterThan(menuEffectStart);
    const menuEffect = mainTsx.slice(menuEffectStart, menuEffectEnd);
    expect(menuEffect).toContain('refreshChatHubConfig(hubId)');
    expect(menuEffect).not.toContain('refreshWheelMakerUpdatesRef');
    expect(menuEffect).not.toContain('refreshAgentPackagesRef');
    expect(menuEffect).not.toContain('refreshProjectFileIndexesRef');
    expect(menuEffect).not.toContain('refreshProjectHubSnapshot');

    expect(refreshTriggers).toContain("this.refresh(hubId, ['wheelmakerUpdate'], false)");
    expect(refreshTriggers).toContain("['flickerBridge', 'agentPackages', 'skills', 'fileIndex']");
  });

  test('derives each hub operation surface from the canonical HubStore snapshot', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    const deriveStart = mainTsx.indexOf('function deriveHubOperationalViews');
    const deriveEnd = mainTsx.indexOf('type SkillDetailCacheEntry', deriveStart);
    expect(deriveStart).toBeGreaterThanOrEqual(0);
    expect(deriveEnd).toBeGreaterThan(deriveStart);
    const deriveBlock = mainTsx.slice(deriveStart, deriveEnd);
    expect(deriveBlock).toContain('hub.sections.wheelmakerUpdate');
    expect(deriveBlock).toContain('hub.sections.agentPackages');
    expect(deriveBlock).toContain('hub.sections.fileIndex');
    expect(deriveBlock).toContain('hub.sections.skills');
    expect(deriveBlock).toContain('hub.sections.flickerBridge');
    expect(mainTsx).not.toMatch(/set(?:WheelMakerUpdateHubs|AgentPackageHubs|ProjectIndexByHubId|SkillHubs)/);
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

  test('hides desktop shortcuts and keeps settings screens free of peer surfaces', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).not.toContain('renderSkillsSettingsDetail(options)');
    expect(mainTsx).not.toContain('openSettingsPeer');
    expect(mainTsx).toContain('const desktopWindowControls = desktopWindowControlsVisible ? (');
    expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).not.toContain('const isShortcutSettingsDetailActive = sidebarSettingsOpen && isSettingsPeerDetail(settingsDetailView);');
    expect(mainTsx).not.toContain('title="CC Switch"');
    expect(mainTsx).not.toContain('aria-label="CC Switch"');

    const floatingStart = mainTsx.indexOf('const floatingControlStack = !isWide ? (');
    const desktopScreenStart = mainTsx.indexOf('const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (', floatingStart);
    const mobileOnly = mainTsx.slice(floatingStart, desktopScreenStart);
    expect(mobileOnly).not.toContain("openSettingsDetail('update')");

    expect(desktopScreenStart).toBeGreaterThanOrEqual(0);
    expect(mainTsx).not.toContain('settingsShortcutBar');
    expect(mainTsx).not.toContain('shortcutBar=');
    expect(mainTsx).not.toContain('MobileSettingsShortcutBar');
    expect(mainTsx).toContain('const mobileSettingsScreen = !isWide && sidebarSettingsOpen ? (');
    expect(settingsSurfaceTsx).not.toContain('MOBILE_SETTINGS_SHORTCUTS');
    expect(settingsSurfaceTsx).not.toContain('MobileSettingsShortcutBar');

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

    expect(stylesCss).not.toContain('.mobile-settings-shortcut-bar {');
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-track');
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-button');
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-label');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar-icon.active');
  });
});
