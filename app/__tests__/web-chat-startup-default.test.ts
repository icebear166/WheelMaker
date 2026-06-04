import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat startup defaults', () => {
  test('defaults new startup state to Chat while preserving explicit non-chat tabs', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const workspacePersistenceTs = readSourceText(
      path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
    );
    const workspaceUiStateTs = readSourceText(
      path.join(projectRoot, 'web', 'src', 'shell', 'state', 'workspaceUiState.ts'),
    );

    expect(mainTsx).toContain("tab: globalState.tab ?? 'chat'");
    expect(workspacePersistenceTs).toContain("tab: 'chat'");
    expect(workspacePersistenceTs).toContain(
      "tab: input.tab === 'file' || input.tab === 'git' ? input.tab : 'chat'",
    );
    expect(workspaceUiStateTs).toContain(
      "return value === 'file' || value === 'git' ? value : 'chat';",
    );
  });
});
