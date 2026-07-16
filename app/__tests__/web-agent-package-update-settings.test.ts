import fs from 'fs';
import path from 'path';

import {
  fetchWheelMakerReleaseHistory,
  wheelMakerUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
} from '../web/src/settings/agentPackageUpdateView';
import type {RegistryWheelMakerUpdateResponse} from '../web/src/registry/registryTypes';
import {readWebStyles} from '../testHelpers/webStyles';

test('renders installed and stable WheelMaker release versions', () => {
  const updateResponse: RegistryWheelMakerUpdateResponse = {
    ok: true,
    status: 'update_available',
    hubId: 'hub-a',
    installed: {
      schemaVersion: 2,
      version: 'v1.22',
      publishedAt: '2026-07-15T09:00:00Z',
      sourceSha: 'a'.repeat(40),
      manifestSha256: 'c'.repeat(64),
      installedAt: '2026-07-15T09:05:00Z',
    },
    stable: {
      version: 'v1.23',
      publishedAt: '2026-07-16T09:00:00Z',
      sourceSha: 'b'.repeat(40),
    },
    canRequestUpdate: true,
  };

  expect(wheelMakerVersionCopy(updateResponse)).toEqual({current: 'v1.22', latest: 'v1.23'});
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

test('loads only published WheelMaker release history', async () => {
  const request = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      {tag_name: 'v1.3', published_at: '2026-07-16T09:00:00Z', html_url: 'https://example.test/v1.3', draft: false, prerelease: false},
      {tag_name: 'v1.4-rc', published_at: '2026-07-17T09:00:00Z', html_url: 'https://example.test/v1.4-rc', draft: false, prerelease: true},
      {tag_name: 'desktop-v2', published_at: '2026-07-18T09:00:00Z', html_url: 'https://example.test/desktop-v2', draft: false, prerelease: false},
      {tag_name: 'v1.2', published_at: '2026-07-15T09:00:00Z', html_url: 'https://example.test/v1.2', draft: false, prerelease: false},
    ],
  }) as unknown as typeof fetch;

  await expect(fetchWheelMakerReleaseHistory(request)).resolves.toEqual([
    {version: 'v1.3', publishedAt: '2026-07-16T09:00:00Z', url: 'https://example.test/v1.3'},
    {version: 'v1.2', publishedAt: '2026-07-15T09:00:00Z', url: 'https://example.test/v1.2'},
  ]);
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
    expect(chatSection).toContain('Hide Tool Calls');
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
    expect(mainTsx).toContain('requestWheelMakerUpdateAll');
    expect(mainTsx).toContain('handleWheelMakerUpdateAllConfirmedAction');
    expect(mainTsx).toContain('const [wheelMakerUpdateAllPending, setWheelMakerUpdateAllPending] = useState(false);');
    expect(mainTsx).toContain('Promise.all(target.hubIds.map(async hubId =>');
    expect(mainTsx).toContain('scheduleWheelMakerUpdatePoll(');
    expect(mainTsx).toContain('Failed to update ${failedUpdates.length} of ${target.hubIds.length} hubs: ${failedUpdates.map(entry => entry.hubId).join');
    expect(detailTsx).toContain('wheelMakerUpdateStatusLabel');
    expect(detailTsx).toContain('wheelMakerVersionCopy');
    expect(detailTsx).toContain('formatWheelMakerDateTime');
    expect(detailTsx).toContain('wheelMakerData?.stable?.publishedAt');
    expect(detailTsx).toContain('wheelMakerData?.publishStatus');
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
    expect(detailTsx).toContain('requestAgentPackageHubUpdate(card.hubId, npmUpdateTargets)');
    expect(mainTsx).toContain('handleAgentPackageConfirmedAction');
    expect(mainTsx).toContain('handleAgentPackageHubUpdateConfirmedAction');
    expect(mainTsx).toContain("await service.installNpmPackages(target.hubId, target.packages.map(pkg => pkg.packageName), 'latest');");
    expect(mainTsx).not.toContain("for (const pkg of target.packages)");
    expect(detailTsx).toContain('packageStatusLabel');
    expect(detailTsx).toContain('deriveNpmPackageUpdateTargets(hub?.packages ?? [])');
    expect(detailTsx).toContain('npmPackageUpdateSummary(npmUpdateTargets.length)');
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
    expect(detailTsx).toContain('className="project-index-disclosure"');
    expect(detailTsx).toContain('className="project-index-section"');
    expect(detailTsx).toContain('className="project-index-row"');
    expect(detailTsx).toContain('className="project-index-path"');
    expect(detailTsx).toContain('className="project-index-action-btn"');
    expect(detailTsx).toContain("projectIndexScanPendingByProjectId[project.projectId] ? 'Scanning...' : 'Scan'");
    expect(detailTsx).toContain("projectIndexScanAllPendingByHubId[card.hubId] ? 'Scanning...' : 'Scan All'");
    expect(mainTsx).toContain("const [agentPackageHubUpdatePendingId, setAgentPackageHubUpdatePendingId] = useState('');");
    expect(detailTsx).toContain('const npmExpanded = expandedNpmUpdateHubIds[card.hubId] === true;');
    expect(detailTsx).toContain('aria-expanded={npmExpanded}');
    expect(detailTsx).toContain('{npmExpanded ? (');
    expect(updateDetailSource).not.toContain('<span className="npm-update-title">NPM Update</span>');
    expect(detailTsx).toContain("npmHubUpdatePending ? 'Updating...' : 'Update All'");
    expect(updateDetailSource).not.toContain("npmHubUpdatePending ? 'Updating...' : 'Update NPM'");
    expect(detailTsx).toContain('const showWheelMakerUpdateAction =');
    expect(detailTsx).toContain('shouldShowWheelMakerUpdateAction({');
    expect(detailTsx).toContain('loading: wheelMaker?.loading === true,');
    expect(detailTsx).toContain('pending: wheelMakerPending || wheelMakerUpdateAllPending,');
    expect(detailTsx).toContain('disabled={wheelMakerUpdateAllPending || wheelMakerPending || wheelMakerUpdateJobActive(wheelMakerData?.job)}');
    expect(detailTsx).toContain('const wheelMakerUpdateAvailableCount = updateHubCards.filter');
    expect(detailTsx).toContain('const npmUpdateAvailableCount = updateHubCards.reduce');
    expect(detailTsx).toContain('const updateSummaryScanning =');
    expect(detailTsx).toContain('className="update-summary-bar"');
    expect(detailTsx).toContain('className="update-summary-metrics"');
    expect(detailTsx).toContain('className="update-summary-value"');
    expect(detailTsx).toContain('className="wheelmaker-update-all-btn"');
    expect(detailTsx).toContain('requestWheelMakerUpdateAll(wheelMakerRequestableHubIds)');
    expect(detailTsx).toContain("wheelMakerUpdateAllPending ? 'Updating All Hubs...' : 'Update All Hubs'");
    expect(detailTsx).toContain('disabled={wheelMakerRequestableHubIds.length === 0 || wheelMakerUpdateAllPending}');
    expect(updateDetailSource).not.toContain("wheelMakerStatus !== 'up_to_date'");
    expect(updateDetailSource).not.toContain('Agent Packages');
    expect(updateDetailSource).not.toContain('>Prefix:');
    expect(updateDetailSource).not.toContain('title={hub?.npmPrefix');
    expect(updateDetailSource).not.toContain('Updated: {agentCard.updatedAt}');
    expect(updateDetailSource).not.toContain('<span className="wheelmaker-update-product">WheelMaker</span>');
    expect(updateDetailSource).not.toContain('<span className="wheelmaker-update-product" title={card.hubId}>{card.hubId}</span>');
    expect(detailTsx).toContain('<span className="wheelmaker-update-scope">Release</span>');

    expect(stylesCss).toContain('.agent-package-hub-list');
    expect(stylesCss).toContain('.update-hub-header .wide-project-hub-tag');
    expect(stylesCss).toContain('font-size: 12.5px;');
    const settingsDetailPageBlock = stylesCss.match(/^\.settings-detail-page \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(settingsDetailPageBlock).toContain('flex: 1 1 auto;');
    expect(settingsDetailPageBlock).toContain('overflow: hidden;');
    const settingsDetailBodyBlock = stylesCss.match(/^\.settings-detail-body \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(settingsDetailBodyBlock).toContain('overflow-y: auto;');
    expect(settingsDetailBodyBlock).toContain('scrollbar-gutter: stable;');
    expect(stylesCss).toContain('.wheelmaker-update-panel');
    expect(stylesCss).toContain('.wheelmaker-update-all-btn');
    expect(stylesCss).toContain('.update-summary-bar');
    expect(stylesCss).toContain('.update-summary-metrics');
    expect(stylesCss).toContain('.update-summary-bar .wheelmaker-update-all-btn');
    const updateSummaryBarBlock = stylesCss.match(/\.update-summary-bar \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(updateSummaryBarBlock).toContain('display: flex;');
    expect(updateSummaryBarBlock).toContain('flex-wrap: wrap;');
    const updateSummaryMetricsBlock = stylesCss.match(/\.update-summary-metrics \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(updateSummaryMetricsBlock).toContain('display: flex;');
    expect(updateSummaryMetricsBlock).toContain('flex-wrap: wrap;');
    expect(updateSummaryMetricsBlock).not.toContain('grid-template-columns: repeat(4, minmax(0, auto));');
    expect(stylesCss).toContain('.wheelmaker-update-version-line');
    expect(stylesCss).toContain('.wheelmaker-update-ref-tag');
    expect(stylesCss).toContain('.wheelmaker-update-release-line');
    expect(stylesCss).toContain('.wheelmaker-release-history');
    expect(stylesCss).toContain('.wheelmaker-update-action-btn');
    expect(stylesCss).toContain('.npm-update-disclosure');
    expect(stylesCss).toContain('.npm-update-section');
    expect(stylesCss).toContain('.project-index-disclosure');
    expect(stylesCss).toContain('.project-index-section');
    expect(stylesCss).toContain('.project-index-row');
    expect(stylesCss).toContain('.project-index-path');
    expect(stylesCss).toContain('.project-index-action-btn');
    expect(stylesCss).toContain('.npm-update-action-btn');
    expect(stylesCss).toContain('.npm-update-body');
    expect(stylesCss).toContain('.agent-package-row');
    expect(stylesCss).toContain('.agent-package-name-line');
    expect(stylesCss).toContain('.agent-package-agent-tags');
    expect(stylesCss).toContain('.agent-package-version-status');
    expect(stylesCss).toContain('.agent-package-action-btn');
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

  test('shows npm hub Update All only from the expanded summary row', () => {
    const projectRoot = path.join(__dirname, '..');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    const disclosureStart = detailTsx.indexOf('className="npm-update-disclosure"');
    const bodyStart = detailTsx.indexOf('className="npm-update-body"', disclosureStart);
    expect(disclosureStart).toBeGreaterThanOrEqual(0);
    expect(bodyStart).toBeGreaterThan(disclosureStart);

    const disclosureBlock = detailTsx.slice(disclosureStart, bodyStart);
    const expandedGateIndex = disclosureBlock.indexOf('{npmExpanded ? (');
    const actionIndex = disclosureBlock.indexOf('className="npm-update-action-btn"');
    expect(expandedGateIndex).toBeGreaterThanOrEqual(0);
    expect(actionIndex).toBeGreaterThan(expandedGateIndex);
    expect(disclosureBlock).toContain("npmHubUpdatePending ? 'Updating...' : 'Update All'");

    const mobileNpmBlock = stylesCss.match(/@media \(max-width: 560px\) \{[\s\S]*?\.wheelmaker-update-panel \{/m)?.[0] ?? '';
    expect(mobileNpmBlock).not.toContain('grid-template-columns: 1fr;');
    expect(mobileNpmBlock).not.toContain('width: 100%;');
  });

  test('places update summary between APK update and hub cards', () => {
    const projectRoot = path.join(__dirname, '..');
    const updateDetail = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');

    const apkIndex = updateDetail.indexOf('android-apk-update-card');
    const summaryIndex = updateDetail.indexOf('update-summary-bar');
    const hubListIndex = updateDetail.indexOf('agent-package-hub-list');
    const summaryButtonIndex = updateDetail.indexOf('className="wheelmaker-update-all-btn"', summaryIndex);
    expect(apkIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(apkIndex);
    expect(hubListIndex).toBeGreaterThan(summaryIndex);
    expect(summaryButtonIndex).toBeGreaterThan(summaryIndex);
    expect(summaryButtonIndex).toBeLessThan(hubListIndex);
  });

  test('makes WheelMaker installed and stable release rows visually distinct', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    const wheelMakerBlockStart = detailTsx.indexOf('className="wheelmaker-update-panel"');
    const agentPackagesStart = detailTsx.indexOf('className="agent-package-row-list"', wheelMakerBlockStart);
    expect(wheelMakerBlockStart).toBeGreaterThanOrEqual(0);
    expect(agentPackagesStart).toBeGreaterThan(wheelMakerBlockStart);
    const wheelMakerBlock = detailTsx.slice(wheelMakerBlockStart, agentPackagesStart);
    expect(wheelMakerBlock).toContain('className="wheelmaker-update-scope"');
    expect(wheelMakerBlock).toContain('className="wheelmaker-update-version-line"');
    expect(wheelMakerBlock).toContain('className="wheelmaker-update-ref-tag"');
    expect(wheelMakerBlock).toContain('wheelMakerVersions.current');
    expect(wheelMakerBlock).toContain('className="wheelmaker-update-release-line"');
    expect(wheelMakerBlock).toContain('wheelMakerCurrentTime');
    expect(wheelMakerBlock).toContain('wheelMakerLatestTime');
    expect(wheelMakerBlock).toContain(": 'Update'}");
    expect(mainTsx).not.toContain('Update+Publish');

    const hubCardBlock = stylesCss.match(/\.agent-package-hub-card \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hubCardBlock).toContain('border-left: 3px solid');

    const panelBlock = stylesCss.match(/\.wheelmaker-update-panel \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(panelBlock).not.toContain('border: 1px solid');
    expect(panelBlock).not.toContain('border-left: 3px solid');
    expect(panelBlock).not.toContain('background:');
    expect(panelBlock).not.toContain('border-radius:');
    expect(panelBlock).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(panelBlock).toContain('grid-template-rows: auto auto auto;');

    const npmSectionBlock = stylesCss.match(/\.npm-update-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(npmSectionBlock).not.toContain('border: 1px solid');
    expect(npmSectionBlock).not.toContain('background:');
    expect(npmSectionBlock).not.toContain('border-radius:');

    const versionLineBlock = stylesCss.match(/\.wheelmaker-update-version-line \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(versionLineBlock).toContain('grid-row: 2;');
    expect(versionLineBlock).toContain('overflow: hidden;');

    const releaseLineBlock = stylesCss.match(/\.wheelmaker-update-release-line \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(releaseLineBlock).toContain('white-space: nowrap;');
    expect(releaseLineBlock).toContain('grid-template-columns: 52px auto minmax(0, 1fr);');

    const releaseLinesBlock = stylesCss.match(/\.wheelmaker-update-release-lines \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(releaseLinesBlock).toContain('grid-column: 1 / -1;');

    const refTagBlock = stylesCss.match(/\.wheelmaker-update-ref-tag \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(refTagBlock).toContain('text-overflow: ellipsis;');
    expect(refTagBlock).toContain('font-family: \'JetBrains Mono\', Consolas, \'Courier New\', monospace;');

    const actionButtonBlock = stylesCss.match(/\.wheelmaker-update-action-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(actionButtonBlock).toContain('grid-row: 1 / 3;');
    expect(actionButtonBlock).toContain('min-width: 74px;');
  });

  test('keeps WheelMaker release metadata on one line inside the mobile settings screen', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    const mobileReleaseLineBlock = stylesCss.match(/\.mobile-settings-screen \.wheelmaker-update-release-line \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileReleaseLineBlock).toContain('grid-template-columns: 52px 7ch max-content;');
    expect(mobileReleaseLineBlock).toContain('column-gap: 10px;');
    expect(mobileReleaseLineBlock).toContain('white-space: nowrap;');

    const mobileReleaseValueBlock = stylesCss.match(/\.mobile-settings-screen \.wheelmaker-update-release-value \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileReleaseValueBlock).toContain('min-width: 7ch;');
    expect(mobileReleaseValueBlock).not.toContain('grid-column: 2;');

    const mobileReleaseTimeBlock = stylesCss.match(/\.mobile-settings-screen \.wheelmaker-update-release-time \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileReleaseTimeBlock).toContain('overflow: visible;');
    expect(mobileReleaseTimeBlock).not.toContain('text-overflow: ellipsis;');
    expect(mobileReleaseTimeBlock).not.toContain('grid-row: 2;');
  });

  test('places agent tags beside display names and lets versions span under the action button', () => {
    const projectRoot = path.join(__dirname, '..');
    const detailTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'UpdateSettingsDetail.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(detailTsx).toContain('className="agent-package-name-line"');
    expect(detailTsx).toContain('className="agent-package-agent-tags"');
    expect(detailTsx).toContain('className={`agent-package-status agent-package-version-status status-${pkg.status}`}');
    expect(detailTsx).not.toContain('className={`agent-package-status status-${pkg.status}`}');

    const titleLineStart = detailTsx.indexOf('className="agent-package-title-line"');
    const nameLineStart = detailTsx.indexOf('className="agent-package-name-line"', titleLineStart);
    expect(titleLineStart).toBeGreaterThanOrEqual(0);
    expect(nameLineStart).toBeGreaterThan(titleLineStart);
    const titleLineBlock = detailTsx.slice(titleLineStart, nameLineStart);
    expect(titleLineBlock).toContain('className="agent-package-agent-tags"');
    expect(titleLineBlock).toContain("tagVariantClass('wide-session-agent', agent)");

    const nameLineEnd = detailTsx.indexOf('className="agent-package-version-line"', nameLineStart);
    const nameLineBlock = detailTsx.slice(nameLineStart, nameLineEnd);
    expect(nameLineBlock).not.toContain('className="agent-package-agent-tags"');

    const actionButtonBlock = stylesCss.match(/\.agent-package-action-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(actionButtonBlock).toContain('grid-column: 2;');
    expect(actionButtonBlock).toContain('grid-row: 1 / 3;');

    const versionLineBlock = stylesCss.match(/\.agent-package-version-line \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(versionLineBlock).toContain('grid-column: 1 / -1;');
  });

  test('uses explicit agent tag variants and softly sized capsules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const AGENT_TAG_VARIANT_INDEX');
    expect(mainTsx).toContain("claude: 2");
    expect(mainTsx).toContain("flicker: 8");
    expect(mainTsx).not.toContain("codexapp: 3");
    expect(mainTsx).not.toContain(`${['my', 'flicker'].join('')}:`);
    expect(mainTsx).toContain('if (prefix === \'wide-session-agent\' || prefix === \'token-stats-pill-agent\')');

    const agentTagBlock = stylesCss.match(/\.wide-session-agent-tag \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(agentTagBlock).toContain('display: inline-flex;');
    expect(agentTagBlock).toContain('min-height: 20px;');
    expect(agentTagBlock).toContain('max-width: 80px;');
    expect(agentTagBlock).toContain('padding: 1px 7px;');
    expect(agentTagBlock).toContain('font-size: 10.5px;');
    expect(agentTagBlock).toContain('font-weight: 600;');
    expect(agentTagBlock).toContain('background: color-mix(in srgb, var(--agent-accent) 14%, transparent);');
    expect(agentTagBlock).toContain('text-transform: none;');
    expect(stylesCss).toContain('.wide-session-agent-8 { --agent-accent: #69db7c; }');
    expect(stylesCss).toContain('.token-stats-pill-agent-8 { --pill-accent: #4fb86a; }');
  });

  test('hides desktop shortcuts and shares the Settings shortcut bar across settings screens', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsSurfaceTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('renderUpdateSettingsDetail(options)');
    expect(mainTsx).toContain('renderTokenStatsSettingsDetail(options)');
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
    expect(surfaceShortcuts.indexOf("detail: 'portRelay'")).toBeLessThan(surfaceShortcuts.indexOf("detail: 'tokenStats'"));
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
    const chatSessionHeaderEnd = mainTsx.indexOf('const renderMobileChatSessionSheet = () => {', chatSessionHeaderStart);
    expect(chatSessionHeaderStart).toBeGreaterThanOrEqual(0);
    expect(chatSessionHeaderEnd).toBeGreaterThan(chatSessionHeaderStart);
    const chatSessionHeader = mainTsx.slice(chatSessionHeaderStart, chatSessionHeaderEnd);
    expect(chatSessionHeader).toContain('{!sessionSearchHeaderExpanded ? renderChatMenuSettingsButton() : null}');
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
    expect(mobileShortcutTrackBlock).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');
    const mobileShortcutButtonBlock = stylesCss.match(/\.mobile-settings-shortcut-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutButtonBlock).toContain('height: 58px;');
    expect(mobileShortcutButtonBlock).toContain('flex-direction: column;');
    const mobileShortcutIndicatorBlock = stylesCss.match(/\.mobile-settings-shortcut-track::before \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileShortcutIndicatorBlock).toContain('top: 0;');
    expect(mobileShortcutIndicatorBlock).toContain('width: calc(100% / 5);');
    expect(mobileShortcutIndicatorBlock).toContain('transition: transform');
    expect(stylesCss).toContain(".mobile-settings-shortcut-bar[data-active-index='4'] .mobile-settings-shortcut-track::before");
    expect(stylesCss).not.toContain(".mobile-settings-shortcut-bar[data-active-index='5']");
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-button.active::before');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar-icon.active');
  });
});
