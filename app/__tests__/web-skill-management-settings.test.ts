import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
const root = path.resolve(__dirname, '..');
const mainTsx = fs.readFileSync(path.join(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');
const settingsSurfaceTsx = fs.readFileSync(path.join(root, 'web/src/settings/SettingsSurface.tsx'), 'utf8');
const detailPath = path.join(root, 'web/src/settings/SkillsSettingsDetail.tsx');
const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';
const skillsDetailSource = `${mainTsx}\n${detailTsx}`;
const stylesCss = readWebStyles(root);

describe('skill management settings UI source structure', () => {
  test('adds Skills as a settings detail and mobile shortcut bar entry', () => {
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).toContain("settingsDetailView === 'skills'");
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

  test('adds desktop Skills shortcut between Update and Token Stats', () => {
    const activityBarStart = mainTsx.indexOf('const desktopActivityBar = isWide ? (');
    const activityBarEnd = mainTsx.indexOf('const floatingControlStack = !isWide ? (', activityBarStart);
    const activityBar = mainTsx.slice(activityBarStart, activityBarEnd);

    expect(activityBar).toContain('codicon-extensions');
    expect(activityBar).toContain("openSettingsPeer('skills')");
    expect(activityBar.indexOf('title="Update"')).toBeLessThan(activityBar.indexOf('title="Skills"'));
    expect(activityBar.indexOf('title="Skills"')).toBeLessThan(activityBar.indexOf('title="Token Stats"'));
    expect(activityBar).toContain("settingsDetailView === 'skills'");
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
    expect(detailTsx).toContain("const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';");
    expect(detailTsx).toContain('settings-skills-marketplace-link');
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
    expect(detailTsx).toContain('settings-skill-icon-btn');
    expect(detailTsx).toContain('codicon-add');
    expect(detailTsx).toContain('codicon-sync');
    expect(detailTsx).toContain('codicon-trash');
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

  test('separates Skills scanning state from empty skill state', () => {
    expect(detailTsx).toContain('const skillHubCards = Object.values(skillHubs)');
    expect(detailTsx).toContain('const skillsScanning = skillsLoading || skillHubCards.some(hub => hub.loading === true);');
    expect(detailTsx).toContain('className="settings-skills-scan-status"');
    expect(detailTsx).toContain('role="status"');
    expect(detailTsx).toContain('codicon-loading codicon-modifier-spin');
    expect(detailTsx).toContain('Scanning skills');
    expect(detailTsx).toContain('groups.length === 0 && options.loading ? (');
    expect(detailTsx).toContain('groups.length === 0 && !options.error && !options.loading ? (');
    expect(stylesCss).toContain('.settings-skills-scan-status');
  });

  test('keeps Marketplace and hub dropdown fixed at the bottom of Skills settings', () => {
    expect(detailTsx).toContain('const skillHubIds = skillHubCards.map(hub => hub.hubId);');
    expect(detailTsx).toContain('const [activeSkillHubId, setActiveSkillHubId] = React.useState');
    expect(detailTsx).toContain('const [skillHubMenuOpen, setSkillHubMenuOpen] = React.useState(false);');
    expect(detailTsx).toContain('const activeSkillHub = skillHubCards.find(hub => hub.hubId === activeSkillHubId)');
    expect(detailTsx).toContain("const selectedSkillHubId = activeSkillHub?.hubId ?? '';");
    expect(detailTsx).toContain('className="settings-skills-fixed-controls"');
    const controlsIndex = detailTsx.indexOf('className="settings-skills-fixed-controls"');
    const marketplaceIndex = detailTsx.indexOf('className="settings-skills-marketplace-link"', controlsIndex);
    const pickerIndex = detailTsx.indexOf('{renderSkillHubPicker()}', controlsIndex);
    expect(controlsIndex).toBeGreaterThanOrEqual(0);
    expect(marketplaceIndex).toBeGreaterThan(controlsIndex);
    expect(pickerIndex).toBeGreaterThan(marketplaceIndex);
    expect(detailTsx).toContain('className="settings-skills-hub-picker"');
    expect(detailTsx).toContain('className="settings-skills-hub-picker-button"');
    expect(detailTsx).toContain('className="settings-skills-hub-menu"');
    expect(detailTsx).toContain('className={`settings-skills-hub-option${hub.hubId === selectedSkillHubId ? \' active\' : \'\'}`}');
    expect(detailTsx).toContain('setSkillHubMenuOpen(false);');
    expect(detailTsx).toContain('{activeSkillHub ? (');
    expect(stylesCss).toContain('.settings-skills-fixed-controls');
    expect(stylesCss).toContain('position: fixed;');
    expect(stylesCss).toContain('bottom: 0;');
    expect(stylesCss).toContain('.settings-skills-hub-picker');
    expect(stylesCss).toContain('.settings-skills-hub-menu');
    expect(stylesCss).toContain('z-index: 12;');
    expect(stylesCss).toContain('bottom: calc(100% + 4px);');
    expect(stylesCss).toContain('padding-bottom: var(--settings-skills-controls-space);');
    expect(stylesCss).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(stylesCss).not.toContain('grid-template-columns: repeat(auto-fit');
    expect(stylesCss).not.toContain('.settings-skills-hub-selector');
    expect(stylesCss).not.toContain('max-height: min(32vh, 320px);');
  });

  test('expands skill install controls inline with select all', () => {
    expect(mainTsx).toContain('sameSkillInstallTarget');
    expect(mainTsx).toContain('toggleAllSkillSourceCandidates');
    expect(detailTsx).toContain('Select all');
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
    expect(detailTsx).toContain('owner/repo or npx skills add ... --skill name');
  });

  test('uses compact settings skill styles', () => {
    expect(stylesCss).toContain('.settings-skills-hub');
    expect(stylesCss).toContain('.settings-skills-marketplace-link');
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
