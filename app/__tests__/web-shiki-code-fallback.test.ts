import fs from 'fs';
import path from 'path';

describe('web shiki code fallback', () => {
  test('renders readable plain code while shiki is loading or unavailable', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain('function renderPlainCodeFallbackHtml');
    expect(mainTsx).toContain('escapeFallbackHtml(content || \' \')');
    expect(mainTsx).toContain('const [renderFailed, setRenderFailed] = useState(false);');
    expect(mainTsx).toContain('setRenderFailed(false);');
    expect(mainTsx).toContain('setRenderFailed(true);');
    expect(mainTsx).toContain('html || fallbackHtml');
    expect(mainTsx).toContain("data-markdown-export-pending={html || renderFailed ? undefined : 'true'}");
    expect(mainTsx).not.toContain("html || '<pre><code> </code></pre>'");
  });

  test('preloads shiki after startup without forcing it into the main bundle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');

    expect(mainTsx).toContain('preloadShikiRenderer');
    expect(mainTsx).toContain('window.requestIdleCallback');
    expect(mainTsx).toContain("import('../code/shikiRenderer')");
    expect(mainTsx).not.toContain("from '../code/shikiRenderer'");
  });
});
