import fs from 'fs';
import path from 'path';

const appRoot = path.join(__dirname, '..');
const sourceRoot = path.join(appRoot, 'web', 'src');
const workspaceApp = fs.readFileSync(path.join(sourceRoot, 'app', 'WorkspaceApp.tsx'), 'utf8');
const registryService = fs.readFileSync(
  path.join(sourceRoot, 'registry', 'RegistryWorkspaceService.ts'),
  'utf8',
);

describe('chat-only top-level workspace', () => {
  test('removes the top-level File and Git tabs and their page modules', () => {
    expect(workspaceApp).not.toContain("type Tab = 'chat' | 'file' | 'git'");
    expect(workspaceApp).not.toContain("setTab('file')");
    expect(workspaceApp).not.toContain("tab === 'file'");
    expect(workspaceApp).not.toContain("tab === 'git'");
    expect(workspaceApp).not.toContain("../file/FileSurface");
    expect(workspaceApp).not.toContain("../file/FilePreviewPane");
    expect(workspaceApp).not.toContain("../git/GitSurface");
    expect(workspaceApp).not.toContain("../git/GitSidebar");
    expect(workspaceApp).not.toContain('Open in File tab');

    for (const relativePath of [
      'file/FileSurface.tsx',
      'file/FilePreviewPane.tsx',
      'git/GitSurface.tsx',
      'git/GitSidebar.tsx',
      'git/gitRefreshPolicy.ts',
      'git/gitView.ts',
    ]) {
      expect(fs.existsSync(path.join(sourceRoot, relativePath))).toBe(false);
    }
  });

  test('keeps Preview Workbench file capabilities', () => {
    expect(workspaceApp).toContain("from '../file/FileExplorerTree'");
    expect(workspaceApp).toContain('<FileExplorerTree');
    expect(workspaceApp).toContain('chatFilePreviewDirEntries');
    expect(workspaceApp).toContain('openChatFilePeek');
    expect(workspaceApp).toContain("from '../file/fileSearchResultTree'");
    expect(workspaceApp).toContain("from '../git/unifiedDiffFiles'");
  });

  test('keeps filesystem and Git registry APIs for later reuse', () => {
    expect(registryService).toContain('async listProjectDirectory(');
    expect(registryService).toContain('async readProjectFile(');
    expect(registryService).toContain('async listGitCommits(');
    expect(registryService).toContain('async listGitBranches(');
    expect(registryService).toContain('async readGitFileDiff(');
    expect(registryService).toContain('async readWorkingTreeFileDiff(');
  });

  test('removes retired Git page caches and migrates their IndexedDB stores away', () => {
    const persistence = fs.readFileSync(
      path.join(sourceRoot, 'workspace', 'WorkspacePersistence.ts'),
      'utf8',
    );

    expect(persistence).not.toContain('PersistedProjectCommitsState');
    expect(persistence).not.toContain('patchProjectCommitsState');
    expect(persistence).not.toContain('getProjectDiff(');
    expect(persistence).not.toContain('putProjectDiff(');
    expect(persistence).toContain("db.deleteObjectStore('wm_project_commits')");
    expect(persistence).toContain("db.deleteObjectStore('wm_diff_cache')");
  });
});
