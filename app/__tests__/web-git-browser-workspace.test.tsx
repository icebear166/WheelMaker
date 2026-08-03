import fs from 'fs';
import path from 'path';

const appRoot = path.join(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('Git browser workspace integration', () => {
  test('wires the shared store into Preview and desktop edge surfaces without restoring a top-level Git tab', () => {
    const main = read('web/src/app/WorkspaceApp.tsx');
    expect(main).toContain("import {GitBrowserStore}");
    expect(main).toContain('<GitHistoryPanel');
    expect(main).toContain('<GitStatusSurface');
    expect(main.indexOf('<GitStatusSurface')).toBeLessThan(main.indexOf('<MonitorSurface'));
    expect(main).toContain('drawerMode={previewWorkbench.drawerMode}');
    expect(main).toContain("tab.type === 'git-diff'");
    expect(main).not.toContain("tab === 'git'");
    expect(main).not.toContain('../git/GitSidebar');
  });

  test('loads commit and worktree diffs with explicit project ids', () => {
    const main = read('web/src/app/WorkspaceApp.tsx');
    expect(main).toContain('service.readProjectGitFileDiff(tab.projectId, tab.source.sha, tab.source.path)');
    expect(main).toContain('service.readProjectWorkingTreeFileDiff(');
    expect(main).toContain('loadedWorktreeRev: projectGitSnapshot.worktreeRev');
    expect(main).toContain("const gitDiffNeedsLoad = activeTab.source.kind === 'commit'");
    expect(main).toContain("activeTab.source.kind === 'worktree'");
    expect(main).toContain('activeTab.loadedWorktreeRev !== previewGitSnapshot.worktreeRev');
  });

  test('subscribes once, ingests project revisions, and loads only visible slices', () => {
    const main = read('web/src/app/WorkspaceApp.tsx');
    const store = read('web/src/git/gitBrowserStore.ts');
    expect(main).toContain('useSyncExternalStore(');
    expect(main).toContain('void gitBrowserStore.syncProjects(projects);');
    expect(main).toContain("previewWorkbench.drawerMode !== 'git'");
    expect(main).toContain('gitBrowserStore.ensureHistory(previewGitSnapshot.projectId)');
    expect(main).toContain('gitBrowserStore.ensureStatus(desktopGitSnapshot.projectId)');
    expect(store).toContain('gitProjectAvailable(project.git)');
    expect(store).toContain('existing.available || reportedAvailable');
    expect(store).not.toContain('setInterval');
    expect(store).not.toContain('setTimeout');
  });

  test('shares one Diff renderer and keeps Git off mobile Floating Nav', () => {
    const main = read('web/src/app/WorkspaceApp.tsx');
    const mobile = read('web/src/shell/layouts/mobile/mobileFloatingNavModel.ts');
    const shiki = read('web/src/code/ShikiCodeBlock.tsx');
    expect(main).toContain('<UnifiedDiffPreview');
    expect(mobile).not.toContain("id: 'git'");
    expect(shiki).toMatch(
      /import\(\s*\/\* webpackChunkName: "git-diff" \*\/\s*'\.\.\/git\/diffRows'\s*\)/,
    );
  });
});
