import fs from 'fs';
import path from 'path';

describe('web live refresh uses latest selection', () => {
  test('refreshProject reads refs instead of stale closure state', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain("const selectedFileRef = useRef('');");
    expect(mainTsx).toContain("const expandedDirsRef = useRef<string[]>(['.']);");
    expect(mainTsx).toContain('const currentProjectRef = useRef<RegistryProject | null>(null);');
    expect(mainTsx).toContain('const latestSelectedFile = selectedFileRef.current;');
    expect(mainTsx).toContain('await readSelectedFile(latestSelectedFile);');
  });

  test('Git tab rev check uses last loaded rev refs instead of project metadata', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain('const currentRev = {');
    expect(mainTsx).toContain('gitRev: knownGitRevRef.current,');
    expect(mainTsx).toContain('worktreeRev: knownWorktreeRevRef.current,');
    expect(mainTsx).toContain('const nextRev = await service.getGitRev();');
    expect(mainTsx).toContain('currentRev,');
    expect(mainTsx).not.toContain('knownGitRev: latestProject?.git?.gitRev ??');
    expect(mainTsx).not.toContain('knownWorktreeRev: latestProject?.git?.worktreeRev ??');
    expect(mainTsx).not.toContain('knownGitRevRef.current = currentProject?.git?.gitRev ??');
    expect(mainTsx).not.toContain('knownWorktreeRevRef.current = currentProject.git.worktreeRev;');
  });
});
