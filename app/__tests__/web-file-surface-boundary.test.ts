import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

describe('web file surface boundary', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsxPath = path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx');
  const fileExplorerPath = path.join(projectRoot, 'web', 'src', 'file', 'FileExplorerTree.tsx');

  test('keeps file explorer rendering out of the main app module', () => {
    const mainTsx = readSourceText(mainTsxPath);

    expect(mainTsx).toContain("import { FileExplorerTree, WorkspaceProjectSelector } from '../file/FileExplorerTree';");
    expect(mainTsx).not.toContain('const renderFileTree = (path: string, depth: number): React.ReactNode => {');
    expect(mainTsx).not.toContain('const renderWorkspaceProjectSelector = () => {');
    expect(mainTsx).toContain('<FileExplorerTree');
    expect(mainTsx).toContain('resolveFileIcon={resolveFileIcon}');
  });

  test('renders the file tree and workspace project selector from a file module', () => {
    const fileExplorerTsx = readSourceText(fileExplorerPath);

    expect(fs.existsSync(fileExplorerPath)).toBe(true);
    expect(fileExplorerTsx).toContain('export function FileExplorerTree');
    expect(fileExplorerTsx).toContain('className="workspace-project-selector"');
    expect(fileExplorerTsx).toContain('className="section-title">EXPLORER</div>');
    expect(fileExplorerTsx).toContain('className="node-icon seti-icon"');
    expect(fileExplorerTsx).toContain('className="seti-glyph"');
    expect(fileExplorerTsx).toContain('depthIndent?: number;');
    expect(fileExplorerTsx).toContain('depthIndent = 14');
    expect(fileExplorerTsx).toContain('10 + depth * depthIndent');
    expect(fileExplorerTsx).toContain('syncWorkspaceProject(projectItem.projectId');
  });
});
