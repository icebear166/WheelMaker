import fs from 'fs';
import path from 'path';

describe('web shiki code fallback', () => {
  test('renders readable plain code while shiki is loading or unavailable', () => {
    const projectRoot = path.join(__dirname, '..');
    const shikiBlock = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx'), 'utf8');

    expect(shikiBlock).toContain('function renderPlainCodeFallbackHtml');
    expect(shikiBlock).toContain('escapeFallbackHtml(content || \' \')');
    expect(shikiBlock).toContain('const [renderFailed, setRenderFailed] = useState(false);');
    expect(shikiBlock).toContain('setRenderFailed(false);');
    expect(shikiBlock).toContain('setRenderFailed(true);');
    expect(shikiBlock).toContain('html || fallbackHtml');
    expect(shikiBlock).toContain("data-markdown-export-pending={html || renderFailed ? undefined : 'true'}");
    expect(shikiBlock).not.toContain("html || '<pre><code> </code></pre>'");
  });

  test('preloads shiki after startup without forcing it into the main bundle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const shikiBlock = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'code', 'ShikiCodeBlock.tsx'), 'utf8');

    expect(mainTsx).toContain('preloadShikiRenderer');
    expect(mainTsx).toContain('window.requestIdleCallback');
    expect(shikiBlock).toContain("import('./shikiRenderer')");
    expect(mainTsx).not.toContain("from '../code/shikiRenderer'");
  });
});
