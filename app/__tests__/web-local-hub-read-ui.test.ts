import fs from 'fs';
import path from 'path';

describe('local hub read removal', () => {
  test('removes local hub read runtime, settings, and persistence', () => {
    const projectRoot = path.join(__dirname, '..');
    const workspacePersistence = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'), 'utf8');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const serviceTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'), 'utf8');

    expect(workspacePersistence).not.toMatch(/localHubRead/i);
    expect(mainTsx).not.toMatch(/localHubRead/i);
    expect(settingsRootTsx).not.toMatch(/Local Hub Read|localHubRead/i);
    expect(serviceTs).not.toMatch(/localHubRead|localRead/i);
    expect(fs.existsSync(path.join(projectRoot, 'web', 'src', 'registry', 'localRead', 'LocalHubReadManager.ts'))).toBe(false);
  });
});
