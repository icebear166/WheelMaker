import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const mainPath = path.join(root, 'web/src/app/WorkspaceApp.tsx');
const gitSidebarPath = path.join(root, 'web/src/git/GitSidebar.tsx');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('git sidebar surface boundary', () => {
  test('main delegates git sidebar rendering to the git surface component', () => {
    const main = readFile(mainPath);

    expect(main).toContain("import { GitSidebar } from '../git/GitSidebar';");
    expect(main).toContain('<GitSidebar');
    expect(main).toContain('workingTreeFiles={workingTreeFiles}');
    expect(main).toContain('commitFilesBySha={commitFilesBySha}');
    expect(main).not.toContain('className="section-title git-section-title"');
    expect(main).not.toContain('className="git-branch-picker"');
    expect(main).not.toContain('className="git-commit-popover"');
    expect(main).not.toContain('const branchFilterLabel =');
  });

  test('git sidebar owns branch picker, graph rows, and commit popover markup', () => {
    expect(fs.existsSync(gitSidebarPath)).toBe(true);
    const source = readFile(gitSidebarPath);

    expect(source).toContain('export function GitSidebar');
    expect(source).toContain('className="section-title git-section-title"');
    expect(source).toContain('className="git-branch-picker"');
    expect(source).toContain('className={`item git-row git-worktree-row');
    expect(source).toContain('className={`item git-row git-commit-row');
    expect(source).toContain('className="git-commit-popover"');
    expect(source).toContain('formatGitCommitDateTime(commitPopover.commit.time)');
  });

  test('git surface keeps its existing diff rendering path outside preview workbench', () => {
    const main = readFile(mainPath);
    const gitBranchStart = main.indexOf('<GitSurface>');
    const gitBranchEnd = main.indexOf('</GitSurface>', gitBranchStart);
    const gitBranch = main.slice(gitBranchStart, gitBranchEnd);

    expect(gitBranch).toContain('<GitSurface>');
    expect(gitBranch).toContain('renderDiffPane(diffText, selectedDiff)');
    expect(gitBranch).toContain("selectedDiff || 'Select a changed file'");
    expect(gitBranch).not.toContain('openPreviewTab(');
    expect(gitBranch).not.toContain("type: 'prompt-diff'");
  });
});
