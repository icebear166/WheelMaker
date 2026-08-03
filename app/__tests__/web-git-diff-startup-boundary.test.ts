import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    : '';
}

describe('web git diff startup boundary', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainTsxPath = path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx');
  const shikiBlockPath = path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx');
  const diffRowsPath = path.join(projectRoot, 'web', 'src', 'git', 'diffRows.ts');
  const unifiedDiffPath = path.join(projectRoot, 'web', 'src', 'preview', 'UnifiedDiffPreview.tsx');

  test('keeps gitdiff-parser out of the chat startup module', () => {
    const mainTsx = readSourceText(mainTsxPath);
    const shikiBlockTsx = readSourceText(shikiBlockPath);
    const unifiedDiffTsx = readSourceText(unifiedDiffPath);

    expect(mainTsx).not.toContain("require('gitdiff-parser')");
    expect(mainTsx).not.toContain('declare const require');
    expect(mainTsx).not.toContain('ShikiDiffPane');
    expect(unifiedDiffTsx).toContain('<ShikiDiffPane');
    expect(shikiBlockTsx).toMatch(
      /import\(\s*\/\* webpackChunkName: "git-diff" \*\/\s*'\.\.\/git\/diffRows'\s*\)/,
    );
    expect(shikiBlockTsx).toContain('const [diffRenderState, setDiffRenderState]');
    expect(shikiBlockTsx).toContain("if (diffRenderState === 'empty')");
  });

  test('loads git diff row parsing from a dedicated lazy module', () => {
    const diffRowsTs = readSourceText(diffRowsPath);

    expect(fs.existsSync(diffRowsPath)).toBe(true);
    expect(diffRowsTs).toContain('declare const require');
    expect(diffRowsTs).toContain("const gitdiffParser = require('gitdiff-parser') as GitDiffParser;");
    expect(diffRowsTs).toContain('export function parseUnifiedDiffRenderLines');
    expect(diffRowsTs).toContain('function parseUnifiedDiffRows');
    expect(diffRowsTs).toContain('function buildInlineDiffRenderLines');
  });
});
