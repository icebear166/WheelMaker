import {
  createHtmlShareSnapshot,
  createMarkdownShareSnapshot,
  inspectShareHtmlDependencies,
  shareKindForPath,
} from '../web/src/shares/shareSnapshot';
import {serializeMarkdownHtmlExportSurface} from '../web/src/chat/export/markdownHtmlExportSurface';

describe('share snapshots', () => {
  test('accepts only supported single-document project extensions', () => {
    expect(shareKindForPath('docs/readme.md')).toBe('markdown');
    expect(shareKindForPath('docs/readme.markdown')).toBe('markdown');
    expect(shareKindForPath('docs/index.html')).toBe('html');
    expect(shareKindForPath('docs/index.htm')).toBe('html');
    expect(shareKindForPath('docs/data.json')).toBeUndefined();
  });

  test('keeps Markdown export output as the standalone HTML snapshot', () => {
    const snapshot = createMarkdownShareSnapshot({
      title: 'README',
      html: '<!doctype html><html><body><h1>Hello</h1></body></html>',
    });
    expect(snapshot.kind).toBe('markdown');
    expect(snapshot.html).toContain('<h1>Hello</h1>');
    expect(snapshot.warnings).toEqual([]);
  });

  test('keeps raw HTML source and warns about relative dependencies without rewriting', () => {
    const source = '<!doctype html><script src="./app.js"></script><img src="assets/logo.png"><a href="/docs">docs</a>';
    const snapshot = createHtmlShareSnapshot({title: 'Page', source});
    expect(snapshot.kind).toBe('html');
    expect(snapshot.html).toBe(source);
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({source: './app.js'}),
      expect.objectContaining({source: 'assets/logo.png'}),
    ]));
    expect(snapshot.html).toContain('src="./app.js"');
    expect(snapshot.html).toContain('src="assets/logo.png"');
    expect(snapshot.html).not.toContain('data:');
  });

  test('reports relative CSS url dependencies', () => {
    expect(inspectShareHtmlDependencies('<style>body{background:url(./theme.css)}</style>'))
      .toEqual([expect.objectContaining({source: './theme.css'})]);
  });

  test('serializes the existing Markdown export surface without downloading', () => {
    const body = {
      innerHTML: '<p>Hello</p>',
      removeAttribute: jest.fn(),
      querySelectorAll: jest.fn(() => []),
    };
    const surface = {querySelector: jest.fn(() => ({cloneNode: jest.fn(() => body)}))};
    const html = serializeMarkdownHtmlExportSurface(surface as unknown as Element, 'README');
    expect(html).toContain('<title>README</title>');
    expect(html).toContain('<p>Hello</p>');
    expect(html).not.toContain('data-markdown-export-pending');
  });
});
