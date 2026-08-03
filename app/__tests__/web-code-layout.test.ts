import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web code layout', () => {
  test('uses shiki renderer with transformer-based line metadata and custom diff rendering', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const codeLanguage = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'codeLanguage.ts'), 'utf8');
    const shikiBlock = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx'), 'utf8');
    const diffRows = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'git', 'diffRows.ts'), 'utf8');
    const shikiRenderer = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'shikiRenderer.ts'), 'utf8');
    const shikiSettings = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'shikiSettings.ts'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("from '../code/shikiSettings'");
    expect(mainTsx).toContain("from '../code/ShikiCodeBlock'");
    expect(shikiBlock).toContain("import('./shikiRenderer')");
    expect(mainTsx).not.toContain("from '../code/shikiRenderer'");
    expect(shikiBlock).toContain('renderShikiHtml');
    expect(shikiBlock).toContain('renderShikiDiffHtml');
    expect(shikiBlock).toContain("import(/* webpackChunkName: \"git-diff\" */ '../git/diffRows')");
    expect(mainTsx).not.toContain("require('gitdiff-parser')");
    expect(diffRows).toContain("require('gitdiff-parser')");
    expect(diffRows).toContain('gitdiffParser.parse(content)');
    expect(shikiBlock).toContain("mode: 'block'");
    expect(mainTsx).toContain('themeMode={themeMode}');
    expect(mainTsx).toContain('codeTheme={codeTheme}');
    expect(diffRows).toContain('type UnifiedDiffRow = {');
    expect(shikiBlock).toContain('parseUnifiedDiffRenderLines(content)');
    expect(diffRows).toContain('function parseUnifiedDiffRows');
    expect(diffRows).toContain('function buildInlineDiffRenderLines');
    expect(shikiBlock).toContain("className={`diff-inline ${wrap ? 'wrap' : 'nowrap'}`}");
    expect(mainTsx).toContain('codeFont={codeFont}');
    expect(mainTsx).toContain('codeFontSize={codeFontSize}');
    expect(mainTsx).toContain('codeLineHeight={codeLineHeight}');
    expect(mainTsx).toContain('codeTabSize={codeTabSize}');
    expect(shikiBlock).toContain("dangerouslySetInnerHTML={{__html: diffHtml || '<pre><code> </code></pre>'}}");
    expect(shikiRenderer).toContain('transformers: [buildLineTransformer(');
    expect(shikiSettings).toContain('export type DiffRenderLine = {');
    expect(shikiRenderer).toContain('export async function renderShikiDiffHtml');
    expect(shikiRenderer).toContain('data-line-kind');
    expect(shikiRenderer).toContain('wm-shiki-diff-line');
    expect(shikiRenderer).toContain('white-space:normal;tab-size:${codeTabSize};');
    expect(shikiRenderer).toContain("hast.properties['data-line-number'] = String(line + lineOffset);");
    expect(shikiRenderer).toContain('createHighlighterCore');
    expect(shikiRenderer).toContain('SHIKI_THEME_LOADERS');
    expect(shikiRenderer).toContain('SHIKI_LANG_LOADERS');
    expect(shikiRenderer).toContain("import('@shikijs/langs/hlsl')");
    expect(shikiRenderer).toContain("import('@shikijs/langs/glsl')");
    expect(shikiRenderer).toContain("import('@shikijs/langs/lua')");
    expect(codeLanguage).toContain("case 'lua':");
    expect(codeLanguage).toContain("return 'lua';");
    expect(codeLanguage).toContain("case 'hlsl':");
    expect(codeLanguage).toContain("return 'hlsl';");
    expect(codeLanguage).toContain("case 'glsl':");
    expect(codeLanguage).toContain("case 'frag':");
    expect(codeLanguage).toContain("return 'glsl';");
    expect(codeLanguage).toContain("case 'py':");
    expect(codeLanguage).toContain("return 'python';");
    expect(codeLanguage).toContain("case 'ps1':");
    expect(codeLanguage).toContain("return 'powershell';");
    expect(shikiRenderer).toContain("from './shikiSettings'");
    expect(shikiSettings).toContain('CODE_FONT_OPTIONS');
    expect(shikiSettings).toContain('resolveCodeFontFamily');
    expect(shikiBlock).toContain("const VS_CODE_EDITOR_FONT_FAMILY = \"Consolas, 'Courier New', monospace\";");
    expect(shikiBlock).toContain('codeFontFamily || VS_CODE_EDITOR_FONT_FAMILY');
    expect(mainTsx).not.toContain("from 'react-diff-viewer-continued'");
    expect(mainTsx).not.toContain('ReactDiffViewer');
    expect(stylesCss).toContain('.chat-main-message code:not(.wm-shiki-code) {');
    expect(stylesCss).toContain('.chat-main-message .wm-shiki-code {');
    expect(stylesCss).toContain('white-space: normal;');
    expect(stylesCss).toMatch(
      /\.chat-main-message \{[\s\S]*line-height: 1\.6;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-main-message p,[\s\S]*margin: 0 0 10px 0;[\s\S]*\}/,
    );
  });
});
