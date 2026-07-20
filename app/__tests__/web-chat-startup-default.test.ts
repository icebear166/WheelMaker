import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat startup defaults', () => {
  test('removes persisted top-level workspace tabs', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const workspacePersistenceTs = readSourceText(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
    );
    const workspaceUiStateTs = readSourceText(
      path.join(projectRoot, 'web', 'src', 'shell', 'state', 'workspaceUiState.ts'),
    );

    expect(mainTsx).not.toContain('globalState.tab');
    expect(workspacePersistenceTs).not.toContain('PersistedTab');
    expect(workspacePersistenceTs).not.toContain("tab: 'chat'");
    expect(workspaceUiStateTs).not.toContain("value === 'file'");
    expect(workspaceUiStateTs).not.toContain("value === 'git'");
  });
});
