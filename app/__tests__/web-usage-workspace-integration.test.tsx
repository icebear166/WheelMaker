import fs from 'fs';
import path from 'path';

describe('limits workspace integration', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
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
});
