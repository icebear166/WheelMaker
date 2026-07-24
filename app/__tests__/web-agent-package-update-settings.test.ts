import fs from 'fs';
import path from 'path';

import {
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
    expect(mainTsx).toContain("if (detail === 'update') {");
    expect(mainTsx).toContain('renderUpdateSettingsDetail(options)');
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

  test('renders Update detail with scan, task polling, and npm confirmation flow hooks', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';
    const updateDetailSource = `${mainTsx}\n${detailTsx}`;
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const renderUpdateSettingsDetail = (options?: SettingsDetailShellOptions) =>');
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<UpdateSettingsDetail');
    expect(detailTsx).toContain('export function UpdateSettingsDetail');
    expect(mainTsx).toContain("'Update'");
    expect(detailTsx).toContain('WheelMaker');
    expect(mainTsx).toContain('refreshWheelMakerUpdates');
    expect(mainTsx).toContain('service.queryWheelMakerUpdate');
    expect(mainTsx).toContain('service.requestWheelMakerUpdate');
    expect(mainTsx).toContain('refreshWheelMakerReleaseHistory');
    expect(mainTsx).toContain('const wheelMakerUpdatePollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);');
    expect(mainTsx).toContain('const scheduleWheelMakerUpdatePoll = useCallback((hubIds: string | string[]) =>');
    expect(mainTsx).toContain('wheelMakerUpdateJobActive(result.job)');
    expect(mainTsx).toContain('scheduleWheelMakerUpdatePoll(hubId)');
    expect(mainTsx).toContain('refreshWheelMakerUpdateHubRef.current?.(hubId, {silent: true})');
    expect(mainTsx).toContain("kind: 'wheelMakerUpdate'");
    expect(mainTsx).toContain("kind: 'wheelMakerUpdateAll'");
    expect(mainTsx).toContain('requestWheelMakerUpdate');
    expect(mainTsx).toContain("latestVersion: wheelMakerPublicMetadata?.stable.version || ''");
    expect(mainTsx).not.toContain('latestVersion: data?.stable?.version');
    expect(mainTsx).toContain('requestWheelMakerUpdateAll');
    expect(mainTsx).toContain('handleWheelMakerUpdateAllConfirmedAction');
    expect(mainTsx).toContain('const [wheelMakerUpdateAllPending, setWheelMakerUpdateAllPending] = useState(false);');
    expect(mainTsx).toContain('Promise.all(target.hubIds.map(async hubId =>');
    expect(mainTsx).toContain('scheduleWheelMakerUpdatePoll(');
    expect(mainTsx).toContain('Failed to update ${failedUpdates.length} of ${target.hubIds.length} hubs: ${failedUpdates.map(entry => entry.hubId).join');
    expect(detailTsx).toContain('wheelMakerUpdateStatusLabel');
    expect(detailTsx).toContain('wheelMakerVersionCopy');
    expect(detailTsx).toContain('formatWheelMakerDateTime');
    expect(detailTsx).toContain('wheelMakerPublicMetadata?.stable');
    expect(detailTsx).not.toContain('wheelMakerData?.stable');
    expect(detailTsx).not.toContain('wheelMakerData?.publishStatus');
    expect(detailTsx).toContain('wheelMakerReleaseHistory');
    expect(mainTsx).toContain('refreshAgentPackages');
    expect(mainTsx).toContain('deriveRegistryHubIds');
    expect(mainTsx).toContain('withAgentPackageTimeout(');
    expect(mainTsx).toContain('service.scanNpmPackages');
    expect(mainTsx).toContain('service.installNpmPackage');
    expect(mainTsx).toContain('service.installNpmPackages');
    expect(mainTsx).toContain('service.uninstallNpmPackage');
    expect(mainTsx).not.toContain('service.queryNpmPackageTask');
    expect(mainTsx).not.toContain('pollAgentPackageTask');
    expect(mainTsx).toContain("kind: 'npmPackage'");
    expect(mainTsx).toContain("kind: 'npmPackageHubUpdate'");
    expect(mainTsx).toContain('requestAgentPackageAction');
    expect(detailTsx).toContain('requestAgentPackageHubUpdate(card.hubId, npmUpdatable)');
    expect(mainTsx).toContain('handleAgentPackageConfirmedAction');
    expect(mainTsx).toContain('handleAgentPackageHubUpdateConfirmedAction');
    expect(mainTsx).toContain("await service.installNpmPackages(target.hubId, target.packages.map(pkg => pkg.packageName), 'latest');");
    expect(mainTsx).not.toContain("for (const pkg of target.packages)");
    expect(detailTsx).toContain('packageStatusLabel');
    expect(detailTsx).toContain('deriveNpmUpdatableTargets(allPackages)');
    expect(detailTsx).toContain('{npmUpdatable.length} updates');
    expect(mainTsx).toContain('const [expandedNpmUpdateHubIds, setExpandedNpmUpdateHubIds] = useState<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const [expandedProjectIndexHubIds, setExpandedProjectIndexHubIds] = useState<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const [projectIndexByHubId, setProjectIndexByHubId] = useState<Record<string, RegistryFileIndexStatusResponse>>({});');
    expect(mainTsx).toContain('const refreshProjectFileIndexes = useCallback(async (hubIds: string | string[], options: {silent?: boolean} = {}) =>');
    expect(mainTsx).toContain('service.getFileIndexStatus(hubId)');
    expect(detailTsx).toContain('handleScanProjectIndex(card.hubId, project.projectId)');
    expect(detailTsx).toContain('handleScanAllProjectIndexes(card.hubId, projectIndexProjects)');
    expect(mainTsx).toContain('PROJECT_INDEX_SCAN_CONCURRENCY');
    expect(detailTsx).toContain('const projectIndexExpanded = expandedProjectIndexHubIds[card.hubId] === true;');
    expect(detailTsx).toContain('aria-expanded={projectIndexExpanded}');
    expect(detailTsx).toContain('className="set-disclosure"');
    expect(detailTsx).toContain('className="project-index-row"');
    expect(detailTsx).toContain("projectIndexScanPendingByProjectId[project.projectId] ? 'Scanning...' : 'Scan'");
    expect(detailTsx).toContain("projectIndexScanAllPending ? 'Scanning...' : 'Scan all'");
    expect(mainTsx).toContain("const [agentPackageHubUpdatePendingId, setAgentPackageHubUpdatePendingId] = useState('');");
    expect(detailTsx).toContain('const npmExpanded = expandedNpmUpdateHubIds[card.hubId] === true;');
    expect(detailTsx).toContain('aria-expanded={npmExpanded}');
    expect(detailTsx).toContain('{npmExpanded ? (');
    expect(updateDetailSource).not.toContain('<span className="npm-update-title">NPM Update</span>');
    expect(detailTsx).toContain("npmHubUpdatePending ? 'Updating...' : 'Update NPM'");
    expect(detailTsx).toContain('const showWheelMakerUpdateAction =');
    expect(detailTsx).toContain('shouldShowWheelMakerUpdateAction({');
    expect(detailTsx).toContain('loading: wheelMaker?.loading === true,');
    expect(detailTsx).toContain('pending: wheelMakerPending || wheelMakerUpdateAllPending,');
    expect(detailTsx).toContain('disabled={wheelMakerUpdateAllPending || wheelMakerPending || wheelMakerJobActive}');
    expect(detailTsx).toContain('requestWheelMakerUpdateAll(wheelMakerRequestableHubIds)');
    expect(detailTsx).toContain("wheelMakerUpdateAllPending ? 'Updating all hubs...' : 'Update all hubs'");
    expect(detailTsx).toContain('disabled={wheelMakerRequestableHubIds.length === 0 || wheelMakerUpdateAllPending}');
    expect(updateDetailSource).not.toContain("wheelMakerStatus !== 'up_to_date'");
    expect(updateDetailSource).not.toContain('Agent Packages');
    expect(updateDetailSource).not.toContain('>Prefix:');
    expect(updateDetailSource).not.toContain('title={hub?.npmPrefix');
    expect(updateDetailSource).not.toContain('Updated: {agentCard.updatedAt}');
    expect(updateDetailSource).not.toContain('<span className="wheelmaker-update-product">WheelMaker</span>');
    expect(updateDetailSource).not.toContain('<span className="wheelmaker-update-product" title={card.hubId}>{card.hubId}</span>');

    expect(stylesCss).toContain('.update-hub-list');
    expect(stylesCss).toContain('.update-overview');
    const settingsDetailPageBlock = stylesCss.match(/^\.settings-detail-page \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(settingsDetailPageBlock).toContain('flex: 1 1 auto;');
    expect(settingsDetailPageBlock).toContain('overflow: hidden;');
    const settingsDetailBodyBlock = stylesCss.match(/^\.settings-detail-body \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(settingsDetailBodyBlock).toContain('overflow-y: auto;');
    expect(settingsDetailBodyBlock).toContain('scrollbar-gutter: stable;');
    expect(stylesCss).toContain('.update-hub-row');
    expect(stylesCss).toContain('.update-disclosure-scope');
    expect(stylesCss).toContain('.set-disclosure');
    expect(stylesCss).toContain('.set-btn');
    expect(stylesCss).toContain('.set-status');
    expect(stylesCss).toContain('.agent-package-row');
    expect(stylesCss).toContain('.agent-package-version-line');
    expect(stylesCss).toContain('.project-index-row');
  });

  test('keeps Update page scan polling scoped to the active Update detail', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    expect(mainTsx).toContain('const refreshWheelMakerUpdatesRef = useRef<(() => Promise<void>) | null>(null);');
    expect(mainTsx).toContain('const refreshAgentPackagesRef = useRef<((options?: {silent?: boolean}) => Promise<void>) | null>(null);');
    expect(mainTsx).toContain('const refreshAndroidApkUpdateRef = useRef<(() => Promise<void>) | null>(null);');
    expect(mainTsx).toContain('const clearAgentPackageScanPollTimer = useCallback(() => {');
    expect(mainTsx).toContain('clearAgentPackageScanPollTimer();');
    expect(mainTsx).toContain('if (!options.silent) {');
    expect(mainTsx).toContain('loading: !options.silent,');
    expect(mainTsx).toContain("if (settingsDetailViewRef.current !== 'update') {");
    expect(mainTsx).toContain('refreshAgentPackagesRef.current?.({silent: true}).catch(() => undefined);');

    const updateEntryEffectStart = mainTsx.indexOf("if (settingsDetailView !== 'update') {\n      clearWheelMakerUpdatePollTimer();\n      clearAgentPackageScanPollTimer();");
    expect(updateEntryEffectStart).toBeGreaterThanOrEqual(0);
    const updateEntryEffectEnd = mainTsx.indexOf('}, [clearAgentPackageScanPollTimer, clearProjectIndexPollTimer, clearWheelMakerUpdatePollTimer, refreshProjectHubSnapshot, refreshWheelMakerReleaseHistory, settingsDetailView]);', updateEntryEffectStart);
    expect(updateEntryEffectEnd).toBeGreaterThan(updateEntryEffectStart);
    const updateEntryEffect = mainTsx.slice(updateEntryEffectStart, updateEntryEffectEnd);
    expect(updateEntryEffect).toContain('refreshWheelMakerUpdatesRef.current?.().catch(() => undefined);');
    expect(updateEntryEffect).toContain('refreshWheelMakerReleaseHistory().catch(() => undefined);');
    expect(updateEntryEffect).toContain('refreshAgentPackagesRef.current?.().catch(() => undefined);');
    expect(updateEntryEffect).toContain('refreshProjectFileIndexesRef.current?.(hubIds)');
    expect(updateEntryEffect).toContain('refreshAndroidApkUpdateRef.current?.().catch(() => undefined);');
    expect(updateEntryEffect).not.toContain('refreshWheelMakerUpdates().catch(() => undefined);');
    expect(updateEntryEffect).not.toContain('refreshAgentPackages().catch(() => undefined);');
    expect(updateEntryEffect).not.toContain('refreshAndroidApkUpdate().catch(() => undefined);');
  });

  test('updates each Update page hub scan section as its request settles', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs
      .readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8')
      .replace(/\r\n/g, '\n');

    const wheelMakerStart = mainTsx.indexOf('const refreshWheelMakerUpdates = useCallback');
    const wheelMakerEnd = mainTsx.indexOf('const refreshAndroidApkUpdate = useCallback', wheelMakerStart);
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

  test('does not use one hub package operation to disable every hub action', () => {
    const projectRoot = path.join(__dirname, '..');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');

    expect(detailTsx).toContain('const pending = agentPackageActionPendingKey === pendingKey || operation?.running === true || npmHubUpdatePending;');
    expect(detailTsx).toContain('disabled={pending}');
    expect(detailTsx).not.toContain('agentPackageAnyOperationRunning');
    expect(detailTsx).not.toContain('disabled={pending || agentPackageAnyOperationRunning}');
  });

  test('places the npm hub update action in the disclosure summary row', () => {
    const projectRoot = path.join(__dirname, '..');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');

    const disclosureStart = detailTsx.indexOf('className="set-disclosure"');
    const bodyStart = detailTsx.indexOf('className="set-disclosure-body"', disclosureStart);
    expect(disclosureStart).toBeGreaterThanOrEqual(0);
    expect(bodyStart).toBeGreaterThan(disclosureStart);

    const disclosureBlock = detailTsx.slice(disclosureStart, bodyStart);
    expect(disclosureBlock).toContain('className="set-disclosure-btn"');
    expect(disclosureBlock).toContain("npmHubUpdatePending ? 'Updating...' : 'Update NPM'");
    // the action lives in the summary row, before the expandable body gate
    const actionIndex = disclosureBlock.indexOf("npmHubUpdatePending ? 'Updating...'");
    const expandedGateIndex = disclosureBlock.indexOf('{npmExpanded ? (');
    expect(expandedGateIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeLessThan(expandedGateIndex);
  });

  test('places update overview between APK update and hub cards', () => {
    const projectRoot = path.join(__dirname, '..');
    const updateDetail = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');

    const apkIndex = updateDetail.indexOf('update-apk-card');
    const overviewIndex = updateDetail.indexOf('update-overview');
    const hubListIndex = updateDetail.indexOf('update-hub-list');
    const overviewButtonIndex = updateDetail.indexOf('set-btn--lg', overviewIndex);
    expect(apkIndex).toBeGreaterThanOrEqual(0);
    expect(overviewIndex).toBeGreaterThan(apkIndex);
    expect(hubListIndex).toBeGreaterThan(overviewIndex);
    expect(overviewButtonIndex).toBeGreaterThan(overviewIndex);
    expect(overviewButtonIndex).toBeLessThan(hubListIndex);
  });

  test('shows public stable metadata once and keeps hub cards local-only', () => {
    const projectRoot = path.join(__dirname, '..');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');

    // the overview bar renders the public stable version exactly once
    const overviewStart = detailTsx.indexOf('className="update-overview"');
    expect(overviewStart).toBeGreaterThanOrEqual(0);
    const overviewBlock = detailTsx.slice(overviewStart, overviewStart + 400);
    expect(overviewBlock).toContain('stableRelease?.version');

    // hub cards render the local installed version, never the public stable one
    const hubVersionStart = detailTsx.indexOf('update-hub-current-version');
    expect(hubVersionStart).toBeGreaterThan(overviewStart);
    const hubVersionBlock = detailTsx.slice(hubVersionStart, hubVersionStart + 200);
    expect(hubVersionBlock).toContain('wheelMakerVersions.current');
    expect(hubVersionBlock).not.toContain('stableRelease');
  });

  // The "mobile release-line" and "agent tags beside display names" tests were
  // removed: they guarded the per-hub release-metadata panel and the npm-row
  // agent tags, both dropped in the prior Update revamp.


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

    expect(mainTsx).toContain('renderUpdateSettingsDetail(options)');
    expect(mainTsx).not.toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).toContain('renderSkillsSettingsDetail(options)');
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
    expect(surfaceShortcuts.indexOf("detail: 'update'")).toBeLessThan(surfaceShortcuts.indexOf("detail: 'skills'"));
    expect(surfaceShortcuts.indexOf("detail: 'skills'")).toBeLessThan(surfaceShortcuts.indexOf("detail: 'portRelay'"));
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
    expect(chatSessionHeader).toContain('renderChatMenuSettingsButton()');
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
