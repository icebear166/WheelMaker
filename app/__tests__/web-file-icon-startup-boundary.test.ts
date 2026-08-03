import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

describe('web file icon startup boundary', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsxPath = path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx');
  const fileIconsPath = path.join(projectRoot, 'web', 'src', 'file', 'fileIcons.ts');

  test('keeps Seti resources out of the chat startup module', () => {
    const mainTsx = readSourceText(mainTsxPath);

    expect(mainTsx).not.toContain('@codingame/monaco-vscode-theme-seti-default-extension');
    expect(mainTsx).not.toContain('setiThemeJson');
    expect(mainTsx).not.toContain('setiFontUrl');
    expect(mainTsx).toMatch(
      /import\(\s*\/\* webpackChunkName: "file-icons" \*\/\s*'\.\.\/file\/fileIcons'\s*\)/,
    );
    expect(mainTsx).toContain('const fileIconResourcesNeeded = chatPreviewOpen &&');
    expect(mainTsx).toContain('chatPreviewOpen &&');
    expect(mainTsx).toContain("previewWorkbench.drawerMode === 'files';");
    expect(mainTsx).not.toContain("(!activeWorkbenchTab || activeWorkbenchTab.type === 'file')");
    expect(mainTsx).toContain('if (!fileIconResourcesNeeded || fileIconResources)');
    expect(mainTsx).toContain('const [fileIconResources, setFileIconResources]');
    expect(mainTsx).toContain('fileIconResources?.setiFontCss() ??');
  });

  test('loads Seti icon resolution from a dedicated lazy module', () => {
    const fileIconsTs = readSourceText(fileIconsPath);

    expect(fs.existsSync(fileIconsPath)).toBe(true);
    expect(fileIconsTs).toContain(
      "import setiThemeJson from '@codingame/monaco-vscode-theme-seti-default-extension/resources/vs-seti-icon-theme.json';",
    );
    expect(fileIconsTs).toContain(
      "import setiFontUrl from '@codingame/monaco-vscode-theme-seti-default-extension/resources/seti.woff';",
    );
    expect(fileIconsTs).toContain("export type FileIconThemeMode = 'dark' | 'light';");
    expect(fileIconsTs).toContain('export function resolveSetiIcon');
    expect(fileIconsTs).toContain('export function setiFontFaceCss');
  });
});
