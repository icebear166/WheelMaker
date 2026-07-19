import fs from 'fs';
import path from 'path';

describe('web hide tool calls setting', () => {
  test('removes the obsolete tool-call hiding preference', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const chatTurnTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'), 'utf8');
    const settingsRootTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'), 'utf8');
    const workspacePersistence = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'chat'");
    expect(settingsRootTsx).not.toContain('Use Latest Prompt Title');
    expect(workspacePersistence).not.toContain('hideToolCalls');
    expect(settingsRootTsx).not.toContain('Hide Tool Calls');
    expect(settingsRootTsx).not.toContain('setHideToolCalls');
    expect(mainTsx).not.toContain('hideToolCalls');
    expect(chatTurnTsx).not.toContain('hideToolCalls');
  });
});
