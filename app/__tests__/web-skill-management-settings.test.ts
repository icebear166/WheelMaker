import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
const root = path.resolve(__dirname, '..');
const mainTsx = fs.readFileSync(path.join(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8').replace(/\r\n/g, '\n');
const settingsSurfaceTsx = fs.readFileSync(path.join(root, 'web/src/settings/SettingsSurface.tsx'), 'utf8').replace(/\r\n/g, '\n');
const detailPath = path.join(root, 'web/src/settings/SkillsSettingsDetail.tsx');
const detailTsx = fs.existsSync(detailPath)
  ? fs.readFileSync(detailPath, 'utf8').replace(/\r\n/g, '\n')
  : '';
const contentPath = path.join(root, 'web/src/settings/SkillManagementContent.tsx');
const contentTsx = fs.existsSync(contentPath)
  ? fs.readFileSync(contentPath, 'utf8').replace(/\r\n/g, '\n')
  : '';
const chatHubSkillTsx = fs
  .readFileSync(path.join(root, 'web/src/app/ChatHubSkillManagement.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const skillsDetailSource = `${mainTsx}\n${detailTsx}\n${contentTsx}`;
const stylesCss = readWebStyles(root);

describe('skill management settings UI source structure', () => {
  test('adds Skills as a settings detail and mobile shortcut bar entry', () => {
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).toContain("if (detail === 'skills') {");
    expect(mainTsx).toContain('renderSkillsSettingsDetail(options)');
    expect(mainTsx).not.toContain("renderSettingsSection('More'");

    expect(mainTsx).toContain('<MobileSettingsShortcutBar');
    expect(mainTsx).toContain('onDetailSelect={openMobileSettingsShortcutDetail}');
    const mobileShortcutsStart = settingsSurfaceTsx.indexOf('export const MOBILE_SETTINGS_SHORTCUTS');
    const mobileShortcutsEnd = settingsSurfaceTsx.indexOf('export function settingsDetailTitle', mobileShortcutsStart);
    expect(mobileShortcutsStart).toBeGreaterThanOrEqual(0);
    expect(mobileShortcutsEnd).toBeGreaterThan(mobileShortcutsStart);
    const mobileShortcuts = settingsSurfaceTsx.slice(mobileShortcutsStart, mobileShortcutsEnd);
    expect(mobileShortcuts.indexOf("detail: 'update'")).toBeLessThan(mobileShortcuts.indexOf("detail: 'skills'"));
    expect(mobileShortcuts.indexOf("detail: 'skills'")).toBeLessThan(mobileShortcuts.indexOf("detail: 'portRelay'"));
    expect(settingsSurfaceTsx).toContain('onClick={() => onDetailSelect(shortcut.detail)}');
  });

  test('hides desktop Skills shortcut while keeping the settings detail route', () => {
    expect(mainTsx).toContain('renderSkillsSettingsDetail(options)');
    expect(mainTsx).toContain("if (detail === 'skills') {");
    expect(mainTsx).toContain('const desktopWindowControls = desktopWindowControlsVisible ? (');
    expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).not.toContain('className={`desktop-activity-button${sidebarSettingsOpen && settingsDetailView === \'skills\' ? \' active\' : \'\'}`}');
    expect(mainTsx).not.toContain('aria-label="Skills"\n        >\n          <span className="codicon codicon-extensions" />');
  });

  test('renders Skills detail with controlled command hooks and confirmations', () => {
    expect(mainTsx).toContain('const renderSkillsSettingsDetail = (options?: SettingsDetailShellOptions) =>');
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<SkillsSettingsDetail');
    expect(detailTsx).toContain('export function SkillsSettingsDetail');
    expect(mainTsx).toContain('refreshSkillManagement');
    expect(mainTsx).toContain('service.scanSkills');
    expect(mainTsx).toContain('service.listSkillsSource');
    expect(mainTsx).toContain('service.installSkills');
    expect(mainTsx).toContain('service.uninstallSkills');
    expect(mainTsx).toContain('service.updateSkills');
    expect(mainTsx).toContain("kind: 'skillInstall'");
    expect(mainTsx).toContain("kind: 'skillUninstall'");
    expect(mainTsx).toContain("kind: 'skillUpdate'");
    expect(contentTsx).toContain("export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';");
    expect(contentTsx).toContain('className="skill-install-marketplace"');
    expect(detailTsx).not.toContain('settings-skills-marketplace-link');
  });

  test('renders skill rows without linked agent labels', () => {
    expect(skillsDetailSource).not.toContain('skillAgentsLabel');
    expect(skillsDetailSource).not.toContain('No linked agents');
  });

  test('renders unmanaged skills as read-only rows', () => {
    expect(detailTsx).toContain('skill.managed !== false');
    expect(detailTsx).toContain('settings-skill-readonly-tag');
    expect(detailTsx).toContain('External');
    expect(detailTsx).toContain('managed ? renderSkillIconButton');
  });

  test('uses icon actions and operation polling for Skills tasks', () => {
    expect(mainTsx).toContain('skillOperationPollTimerRef');
    expect(detailTsx).toContain('operation?.running');
    expect(detailTsx).toContain('includeProjects: true');
    expect(detailTsx).toContain('set-btn--icon');
    expect(detailTsx).toContain("icon: 'plus'");
    expect(detailTsx).toContain("icon: 'refreshCw'");
    expect(detailTsx).toContain("icon: 'trash'");
  });

  test('keeps Hub menu skill updates scoped to global Hub skills', () => {
    const summaryStart = mainTsx.indexOf('const renderChatHubSummary = () => {');
    const summaryEnd = mainTsx.indexOf('const renderHiddenProjectRows =', summaryStart);
    const summaryBlock = mainTsx.slice(summaryStart, summaryEnd);

    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    expect(summaryBlock).not.toContain('includeProjects: true');
  });

  test('keeps Skills pending and polling scoped to the affected hub', () => {
    expect(detailTsx).toContain('isSkillActionPendingForHub(skillsPendingKey, hubId)');
    expect(mainTsx).toContain('skillOperationPollHubIdsRef');
    expect(mainTsx).toContain('scheduleSkillOperationPoll(hubId)');
    expect(skillsDetailSource).not.toContain('options.operationRunning === true || !!skillsPendingKey');
    expect(mainTsx).not.toContain('refreshSkillManagementRef.current?.().catch(() => undefined)');
  });

  test('updates each Skills hub as its scan request settles', () => {
    const normalizedMainTsx = mainTsx.replace(/\r\n/g, '\n');
    const refreshStart = normalizedMainTsx.indexOf('const refreshSkillManagement = useCallback');
    const refreshEnd = normalizedMainTsx.indexOf('refreshSkillManagementHubRef.current = refreshSkillManagementHub;', refreshStart);
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);

    const refreshBlock = normalizedMainTsx.slice(refreshStart, refreshEnd);
    expect(refreshBlock).toContain('const runningHubIds = new Set<string>();');
    expect(refreshBlock).toContain('await Promise.all(hubIds.map(async hubId => {');
    expect(refreshBlock).not.toContain('const responses = await Promise.all(hubIds.map');
    expect(refreshBlock).not.toContain('responses.forEach(entry =>');

    const requestIndex = refreshBlock.indexOf('const result = await service.scanSkills(hubId);');
    const updateIndex = refreshBlock.indexOf('setSkillHubs(prev => ({', requestIndex);
    expect(updateIndex).toBeGreaterThan(requestIndex);
  });

  test('scans Skills for the current Hub IDs without refreshing Hub topology', () => {
    const normalizedMainTsx = mainTsx.replace(/\r\n/g, '\n');
    const refreshStart = normalizedMainTsx.indexOf('const refreshSkillManagement = useCallback');
    const refreshEnd = normalizedMainTsx.indexOf('refreshSkillManagementHubRef.current = refreshSkillManagementHub;', refreshStart);
    const refreshBlock = normalizedMainTsx.slice(refreshStart, refreshEnd);

    expect(refreshBlock).toContain('const refreshSkillManagement = useCallback(async (hubIds: string[]) =>');
    expect(refreshBlock).not.toContain('service.listProjectSnapshot()');
    expect(refreshBlock).not.toContain('setRegistryHubs(');

    const entryEffectStart = normalizedMainTsx.indexOf("if (settingsDetailView !== 'skills') {");
    const entryEffectEnd = normalizedMainTsx.indexOf('}, [settingsDetailView, refreshSkillManagement, registryHubIds]);', entryEffectStart);
    expect(entryEffectStart).toBeGreaterThanOrEqual(0);
    expect(entryEffectEnd).toBeGreaterThan(entryEffectStart);
    expect(normalizedMainTsx.slice(entryEffectStart, entryEffectEnd))
      .toContain('refreshSkillManagement(registryHubIds).catch(() => undefined);');
  });

  test('wires the hub menu to scoped Hub and Project skill management data and actions', () => {
    expect(mainTsx).toContain('const skillHub = skillHubs[card.hubId];');
    expect(mainTsx).toContain('const hubSkills = skillHub?.data?.hubSkills?.skills ?? [];');
    expect(mainTsx).toContain('const skillProjects = skillHub?.data?.projects ?? [];');
    expect(mainTsx).toContain('hubItems: hubSkills,');
    expect(mainTsx).toContain('projects: skillProjects,');
    expect(mainTsx).toContain('pendingKey: skillsPendingKey,');
    expect(mainTsx).toContain("onRequestSkillInstall={target => requestSkillInstall(target, 'hub')}");
    expect(mainTsx).toContain("onRequestSkillDetail={target => requestSkillDetail(target, 'hub')}");
    expect(mainTsx).toContain('onRequestSkillUpdate={requestSkillUpdate}');
    expect(mainTsx).toContain('onRequestSkillBatchUninstall={requestSkillBatchUninstall}');
    expect(mainTsx).toContain('skills: target.skills,');
    expect(mainTsx).toContain('refreshSkillManagementHubRef.current?.(hubId)');
    expect(mainTsx).not.toContain('onScanSkills={handleChatHubScanSkills}');
  });

  test('keeps user-triggered Skill action feedback replayable without background retry popups', () => {
    expect(mainTsx).toContain('<RetryToast');
    expect(mainTsx).toContain("setToastMessage('Skill operation completed.')");
    expect(mainTsx).toContain('setSkillRetryNotice(createSkillRetryNotice(message, target))');
    expect(mainTsx).not.toContain("retry: {kind: 'refresh', hubId}");
    expect(chatHubSkillTsx).not.toContain('agent-package-task');
    expect(chatHubSkillTsx).not.toContain('skillOperationStatusLabel');
  });

  test('separates Skills scanning state from empty skill state', () => {
    expect(detailTsx).toContain('const skillHubCards = Object.values(skillHubs)');
    expect(detailTsx).toContain('const skillsScanning = skillsLoading || skillHubCards.some(hub => hub.loading === true);');
    expect(detailTsx).toContain('className="settings-skills-scan-status"');
    expect(detailTsx).toContain('role="status"');
    expect(detailTsx).toContain('<Icon name="loader" spin');
    expect(detailTsx).toContain('Scanning skills');
    expect(detailTsx).toContain('groups.length === 0 && options.loading ? (');
    expect(detailTsx).toContain('groups.length === 0 && !options.error && !options.loading ? (');
    expect(stylesCss).toContain('.settings-skills-scan-status');
  });

  test('keeps the Skills hub picker fixed above the scrolling skill list', () => {
    expect(detailTsx).toContain('const skillHubIds = skillHubCards.map(hub => hub.hubId);');
    expect(detailTsx).toContain('const [activeSkillHubId, setActiveSkillHubId] = React.useState');
    expect(detailTsx).toContain('const [skillHubMenuOpen, setSkillHubMenuOpen] = React.useState(false);');
    expect(detailTsx).toContain('const activeSkillHub = skillHubCards.find(hub => hub.hubId === activeSkillHubId)');
    expect(detailTsx).toContain("const selectedSkillHubId = activeSkillHub?.hubId ?? '';");
    expect(detailTsx).toContain('className="settings-skills-page"');
    expect(detailTsx).toContain('className="settings-skills-fixed-controls"');
    expect(detailTsx).toContain('className="settings-skills-list"');
    const pageIndex = detailTsx.indexOf('className="settings-skills-page"');
    const controlsIndex = detailTsx.indexOf('className="settings-skills-fixed-controls"');
    const pickerIndex = detailTsx.indexOf('{renderSkillHubPicker()}', controlsIndex);
    const listIndex = detailTsx.indexOf('className="settings-skills-list"', controlsIndex);
    expect(pageIndex).toBeGreaterThanOrEqual(0);
    expect(controlsIndex).toBeGreaterThanOrEqual(0);
    expect(controlsIndex).toBeGreaterThan(pageIndex);
    expect(pickerIndex).toBeGreaterThan(controlsIndex);
    expect(listIndex).toBeGreaterThan(pickerIndex);
    expect(detailTsx).not.toContain('className="settings-skills-marketplace-link"');
    expect(detailTsx).toContain('className="settings-skills-hub-picker"');
    expect(detailTsx).toContain('className="settings-skills-hub-picker-button"');
    expect(detailTsx).toContain('className="settings-skills-hub-menu"');
    expect(detailTsx).toContain('className={`settings-skills-hub-option${hub.hubId === selectedSkillHubId ? \' active\' : \'\'}`}');
    expect(detailTsx).toContain('setSkillHubMenuOpen(false);');
    expect(detailTsx).toContain('{activeSkillHub ? (');
    expect(stylesCss).toContain('.settings-skills-page');
    expect(stylesCss).toContain('.settings-skills-fixed-controls');
    const pageBlock = stylesCss.match(/\.settings-skills-page \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(pageBlock).toContain('height: 100%;');
    expect(pageBlock).toContain('display: flex;');
    expect(pageBlock).toContain('flex-direction: column;');
    expect(pageBlock).toContain('overflow: hidden;');
    const detailBodyBlock = stylesCss.match(/\.settings-detail-body:has\(> \.settings-skills-page\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(detailBodyBlock).toContain('flex: 1 1 auto;');
    expect(detailBodyBlock).toContain('min-height: 0;');
    expect(detailBodyBlock).toContain('display: flex;');
    expect(detailBodyBlock).toContain('flex-direction: column;');
    expect(detailBodyBlock).toContain('overflow: hidden;');
    expect(detailBodyBlock).toContain('align-content: stretch;');
    const scrollBlock = stylesCss.match(/\.mobile-settings-scroll:has\(\.settings-skills-page\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(scrollBlock).toContain('min-height: 0;');
    expect(scrollBlock).toContain('display: flex;');
    expect(scrollBlock).toContain('flex-direction: column;');
    expect(scrollBlock).toContain('overflow: hidden;');
    const listBlock = stylesCss.match(/\.settings-skills-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(listBlock).toContain('flex: 1 1 auto;');
    expect(listBlock).toContain('min-height: 0;');
    expect(listBlock).toContain('overflow-y: auto;');
    expect(listBlock).not.toContain('padding-bottom: var(--settings-skills-controls-space);');
    const controlsBlock = stylesCss.match(/\.settings-skills-fixed-controls \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(controlsBlock).toContain('position: sticky;');
    expect(controlsBlock).toContain('top: 0;');
    expect(controlsBlock).toContain('border-bottom: 1px solid');
    expect(controlsBlock).not.toContain('position: fixed;');
    expect(controlsBlock).not.toContain('bottom: 0;');
    const mobileControlsBlock = stylesCss.match(/\.mobile-settings-screen \.settings-skills-fixed-controls \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileControlsBlock).toContain('position: sticky;');
    expect(mobileControlsBlock).toContain('top: 0;');
    expect(mobileControlsBlock).not.toContain('bottom: 0;');
    expect(mobileControlsBlock).not.toContain('left: 0;');
    expect(mobileControlsBlock).not.toContain('right: 0;');
    expect(mobileControlsBlock).not.toContain('width: auto;');
    expect(stylesCss).toContain('.settings-skills-hub-picker');
    expect(stylesCss).toContain('.settings-skills-hub-menu');
    expect(stylesCss).toContain('z-index: 12;');
    expect(stylesCss).toContain('top: calc(100% + 4px);');
    expect(stylesCss).not.toContain('bottom: calc(100% + 4px);');
    expect(stylesCss).not.toContain('padding-bottom: var(--settings-skills-controls-space);');
    expect(stylesCss).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(stylesCss).not.toContain('grid-template-columns: repeat(auto-fit');
    expect(stylesCss).not.toContain('.settings-skills-hub-selector');
    expect(stylesCss).not.toContain('max-height: min(32vh, 320px);');
  });

  test('pairs each hub status dot with visible text', () => {
    expect(detailTsx).toContain('<span className="set-status is-running">Scanning</span>');
    expect(detailTsx).toContain('<span className="set-status is-running">Running</span>');
    expect(detailTsx).toContain('<span className="set-status is-error">Error</span>');
    expect(detailTsx).toContain('<span className="set-status is-ok">Ready</span>');
  });

  test('expands skill install controls inline with select all', () => {
    expect(mainTsx).toContain('sameSkillInstallTarget={sameSkillScopeTarget}');
    expect(mainTsx).toContain('toggleAllSkillSourceCandidates');
    expect(contentTsx).toContain('Select all');
    expect(detailTsx).toContain('<SkillInstallContent');
    expect(detailTsx).toContain('renderSkillInstallPanel({hubId, scope: options.scope, projectName: options.projectName})');
    expect(skillsDetailSource).not.toContain('renderSkillInstallPanel()}');
    expect(skillsDetailSource).not.toContain('candidate?.description');
    expect(skillsDetailSource).not.toContain('candidateGroups');
    expect(skillsDetailSource).not.toContain('candidate-group:');
  });

  test('normalizes pasted skills add commands in the install panel', () => {
    expect(mainTsx).toContain('parseSkillSourceInput(skillSourceInput)');
    expect(mainTsx).toContain('sourceInput.skillNames');
    expect(mainTsx).toContain('Skill not found in source:');
    expect(contentTsx).toContain('owner/repo or npx skills add --skill name');
  });

  test('loads skill details on demand into the shared settings detail panel', () => {
    expect(mainTsx).toContain('skillDetailCache');
    expect(mainTsx).toContain('requestSkillDetail');
    expect(mainTsx).toContain('service.getSkillDetail');
    expect(mainTsx).toContain('skillDetailCacheKey');
    expect(mainTsx).toContain("const SkillDetailPanel = React.lazy(() => loadSettingsBundle().then(module => ({");
    expect(mainTsx).toContain('const renderSkillDetailSettingsDetail = (options?: SettingsDetailShellOptions) =>');
    expect(mainTsx).toContain("if (detail === 'skillDetail') {");
    expect(mainTsx).toContain('return renderSkillDetailSettingsDetail(options);');
    expect(detailTsx).toContain('export function SkillDetailPanel');
    expect(detailTsx).toContain('settings-skills-detail-panel');
    expect(detailTsx).not.toContain('settings-skills-detail-popover');
    expect(detailTsx).not.toContain('settings-skills-detail-mobile-header');
    expect(detailTsx).toContain('<SkillDetailContent loading={loading} error={error} detail={detail} />');
    expect(contentTsx).toContain('Skill.md');
    expect(contentTsx).toContain("import ReactMarkdown from 'react-markdown';");
    expect(contentTsx).toContain("import remarkGfm from 'remark-gfm';");
    expect(contentTsx).toContain('const SKILL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];');
    expect(contentTsx).toContain('className="skill-detail-markdown markdown-preview"');
    expect(contentTsx).toContain('remarkPlugins={SKILL_MARKDOWN_REMARK_PLUGINS}');
    expect(contentTsx).toContain('<ReactMarkdown');
    expect(contentTsx).not.toContain('<pre className="settings-skills-detail-markdown">{detail.skillMarkdown}</pre>');
    expect(contentTsx).toContain('Supporting files');
    expect(stylesCss).toContain('.settings-skills-detail-panel');
    expect(stylesCss).not.toContain('.settings-skills-detail-popover');
    expect(stylesCss).not.toContain('.settings-skills-detail-mobile-header');
  });

  test('opens skill details as mobile child pages and desktop side panels', () => {
    expect(detailTsx).not.toContain('skillDetailAnchor');
    expect(detailTsx).toContain('openSkillDetailFromRow');
    expect(detailTsx).not.toContain('getBoundingClientRect()');
    expect(detailTsx).not.toContain('style={skillDetailAnchor ?');
    expect(detailTsx).not.toContain('settings-skills-detail-placement-');
    expect(detailTsx).toContain('requestSkillDetail(target).catch(() => undefined);');
    expect(detailTsx).not.toContain('{renderSkillDetailPanel()}');
    expect(mainTsx).toContain("if (owner === 'settings' && !isWide) {\n      setSidebarSettingsOpen(true);\n      setSettingsDetailView('skillDetail');\n    }");
    expect(mainTsx).toContain('const desktopSkillDetailPanel = isWide && sidebarSettingsOpen && settingsDetailView === \'skills\' && skillDetailTarget ? (');
    expect(mainTsx).toContain('sidePanel={desktopSkillDetailPanel}');
    expect(settingsSurfaceTsx).toContain('sidePanel?: ReactNode;');
    expect(settingsSurfaceTsx).toContain("sidePanel ? `${screenClassName} has-settings-side-panel` : screenClassName");
    expect(settingsSurfaceTsx).toContain('className="settings-screen-panel-row"');

    const panelStart = stylesCss.indexOf('.settings-skills-detail-panel {');
    expect(panelStart).toBeGreaterThanOrEqual(0);
    const panelEnd = stylesCss.indexOf('.settings-skills-detail-header {', panelStart);
    expect(panelEnd).toBeGreaterThan(panelStart);
    const panelStyles = stylesCss.slice(panelStart, panelEnd);
    expect(panelStyles).not.toContain('position: fixed;');
    expect(panelStyles).not.toContain('transform: translateY(-50%);');
    expect(panelStyles).toContain('display: flex;');
    expect(panelStyles).toContain('height: 100%;');
    expect(panelStyles).toContain('max-height: 100%;');
    expect(stylesCss).toContain('.settings-screen-panel-row');
    expect(stylesCss).toContain('.desktop-settings-screen.has-settings-side-panel .settings-screen-panel-row');
    expect(stylesCss).toContain('grid-template-columns: minmax(0, 920px) minmax(360px, 500px);');
    expect(stylesCss).toContain('width: min(1440px, calc(100vw - 56px));');

    const markdownStart = stylesCss.indexOf('.skill-detail-markdown {', panelStart);
    const markdownEnd = stylesCss.indexOf('.settings-skills-detail-files {', markdownStart);
    expect(markdownStart).toBeGreaterThanOrEqual(0);
    expect(markdownEnd).toBeGreaterThan(markdownStart);
    const markdownStyles = stylesCss.slice(markdownStart, markdownEnd);
    expect(markdownStyles).not.toContain('max-height:');
    expect(markdownStyles).not.toContain('overflow: auto;');
    expect(stylesCss).not.toContain('.settings-skills-detail-placement-left');
    expect(stylesCss).not.toContain('.settings-skills-detail-placement-right');
  });

  test('supports current-scope batch uninstall without selecting external skills', () => {
    expect(detailTsx).toContain('selectedSkillKeysByScope');
    expect(detailTsx).toContain('toggleScopeSkillSelection');
    expect(detailTsx).toContain('requestSkillBatchUninstall');
    expect(detailTsx).toContain('settings-skills-bulk-bar');
    expect(detailTsx).toContain('managed && !actionDisabled');
    expect(mainTsx).toContain("kind: 'skillBatchUninstall'");
    expect(mainTsx).toContain('service.uninstallSkills({');
    expect(mainTsx).toContain('skills: target.skillNames');
  });

  test('uses compact settings skill styles', () => {
    expect(stylesCss).toContain('.settings-skills-hub');
    expect(stylesCss).toContain('.skill-install-marketplace');
    expect(stylesCss).toContain('.settings-skill-row');
    expect(stylesCss).toContain('.settings-skill-category');
    expect(stylesCss).toContain('.settings-skill-icon-btn');
    expect(stylesCss).toContain('.settings-skill-readonly-tag');
    expect(stylesCss).toContain('.settings-skill-select-all-row');
    expect(stylesCss).toContain('.settings-skills-candidates .settings-skill-row');
    expect(stylesCss).toContain('min-height: 26px;');
    expect(stylesCss).not.toContain('.settings-skills-candidates .settings-skill-category');
    expect(stylesCss).not.toContain('max-height: min(34vh, 260px);');
  });
});
