import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

const root = path.resolve(__dirname, '..');
const mainTsx = fs
  .readFileSync(path.join(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const settingsBundleTs = fs
  .readFileSync(path.join(root, 'web/src/settings/SettingsBundle.ts'), 'utf8')
  .replace(/\r\n/g, '\n');
const settingsSurfaceTsx = fs
  .readFileSync(path.join(root, 'web/src/settings/SettingsSurface.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const navigationTs = fs
  .readFileSync(path.join(root, 'web/src/settings/settingsNavigation.ts'), 'utf8')
  .replace(/\r\n/g, '\n');
const contentTsx = fs
  .readFileSync(path.join(root, 'web/src/settings/SkillManagementContent.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const chatHubSkillTsx = fs
  .readFileSync(path.join(root, 'web/src/app/ChatHubSkillManagement.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const chatHubCompanionTsx = fs
  .readFileSync(path.join(root, 'web/src/app/ChatHubSkillCompanion.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const stylesCss = readWebStyles(root);
const standaloneSkillsPath = path.join(root, 'web/src/settings/SkillsSettingsDetail.tsx');

describe('Hub-owned skill management source structure', () => {
  test('removes the standalone Skills settings page and route', () => {
    expect(fs.existsSync(standaloneSkillsPath)).toBe(false);
    expect(settingsBundleTs).not.toContain('SkillsSettingsDetail');
    expect(settingsBundleTs).not.toContain('SkillDetailPanel');
    expect(settingsSurfaceTsx).not.toContain('sidePanel?: ReactNode');
    expect(settingsSurfaceTsx).not.toContain('has-settings-side-panel');
    expect(settingsSurfaceTsx).not.toContain("detail: 'skills'");
    expect(navigationTs).not.toContain("| 'skills'");
    expect(navigationTs).not.toContain("| 'skillDetail'");
    expect(mainTsx).not.toContain('renderSkillsSettingsDetail');
    expect(mainTsx).not.toContain('renderSkillDetailSettingsDetail');
    expect(mainTsx).not.toContain("settingsDetailView !== 'skills'");
    expect(mainTsx).not.toContain('refreshSkillManagement(registryHubIds)');
  });

  test('keeps skill commands and retry feedback without polling', () => {
    expect(mainTsx).toContain('service.scanSkills');
    expect(mainTsx).toContain('service.listSkillsSource');
    expect(mainTsx).toContain('service.installSkills');
    expect(mainTsx).toContain('service.getSkillDetail');
    expect(mainTsx).toContain('service.updateSkills');
    expect(mainTsx).toContain('service.uninstallSkills');
    expect(mainTsx).not.toContain('skillOperationPollTimerRef');
    expect(mainTsx).not.toContain('scheduleSkillOperationPoll');
    expect(mainTsx).toContain('<RetryToast');
    expect(mainTsx).toContain("setToastMessage('Skill operation completed.')");
    expect(mainTsx).toContain('setSkillRetryNotice(createSkillRetryNotice(message, target))');
  });

  test('keeps Hub-global updates isolated from Project skills', () => {
    const summaryStart = mainTsx.indexOf('const renderChatHubSummary = () => {');
    const summaryEnd = mainTsx.indexOf('const renderHiddenProjectRows =', summaryStart);
    const summaryBlock = mainTsx.slice(summaryStart, summaryEnd);

    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    expect(summaryBlock).not.toContain('includeProjects: true');
  });

  test('wires Hub-global and Project skill data to the Hub menu', () => {
    expect(mainTsx).toContain('const skillHub = skillHubs[card.hubId];');
    expect(mainTsx).toContain('const hubSkills = skillHub?.data?.hubSkills?.skills ?? [];');
    expect(mainTsx).toContain('const skillProjects = skillHub?.data?.projects ?? [];');
    expect(mainTsx).toContain('hubItems: hubSkills,');
    expect(mainTsx).toContain('projects: skillProjects,');
    expect(mainTsx).toContain('pendingKey: skillsPendingKey,');
    expect(mainTsx).toContain('onRequestSkillInstall={requestSkillInstall}');
    expect(mainTsx).toContain('onRequestSkillDetail={requestSkillDetail}');
    expect(mainTsx).toContain('onRequestSkillUpdate={requestSkillUpdate}');
    expect(mainTsx).toContain('onRequestSkillBatchUninstall={requestSkillBatchUninstall}');
    expect(mainTsx).toContain('refreshSkillManagementHubRef.current?.(hubId)');
  });

  test('keeps Hub skill install and detail companion surfaces', () => {
    expect(mainTsx).toContain('const chatHubSkillSurface');
    expect(mainTsx).toContain('<ChatHubMenu');
    expect(chatHubCompanionTsx).toContain('<SkillInstallContent');
    expect(chatHubCompanionTsx).toContain('<SkillDetailContent');
    expect(contentTsx).toContain("export const SKILLS_MARKETPLACE_URL = 'https://www.skills.sh/';");
    expect(contentTsx).toContain('Select all');
    expect(contentTsx).toContain('Skill.md');
    expect(contentTsx).toContain('Supporting files');
    expect(contentTsx).toContain('className="skill-detail-markdown markdown-preview"');
  });

  test('keeps shared install and detail styles used by the Hub companion', () => {
    expect(stylesCss).not.toContain('.settings-skills-page');
    expect(stylesCss).not.toContain('.settings-skills-hub-picker');
    expect(stylesCss).not.toContain('.settings-skills-scope-grid');
    expect(stylesCss).not.toContain('.settings-skills-detail-panel');
    expect(stylesCss).toContain('.skill-install-marketplace');
    expect(stylesCss).toContain('.settings-skills-source-row');
    expect(stylesCss).toContain('.settings-skills-candidates');
    expect(stylesCss).toContain('.settings-skills-detail-body');
    expect(stylesCss).toContain('.settings-skills-detail-meta');
    expect(stylesCss).toContain('.skill-detail-markdown');
    expect(stylesCss).toContain('.settings-skills-detail-files');
  });

  test('keeps Hub skill rows independent from old settings-only task presentation', () => {
    expect(chatHubSkillTsx).not.toContain('agent-package-task');
    expect(chatHubSkillTsx).not.toContain('skillOperationStatusLabel');
    expect(chatHubSkillTsx).not.toContain('includeProjects: true');
  });
});
