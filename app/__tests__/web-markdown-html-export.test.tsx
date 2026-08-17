import fs from 'node:fs';
import path from 'node:path';

import {
  buildMarkdownHtmlFileNameFromStem,
  buildMarkdownHtmlFileName,
  buildStandaloneMarkdownHtmlDocument,
  MARKDOWN_EXPORT_CONTENT_STYLE,
  resolveExternalMarkdownImagePath,
  resolveProjectMarkdownImagePath,
  validateMarkdownHtmlFileStem,
} from '../web/src/chat/export/markdownHtmlExport';

function readMarkdownHtmlExportDocumentSource(): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'web',
      'src',
      'chat',
      'export',
      'MarkdownHtmlExportDocument.tsx',
    ),
    'utf8',
  );
}

describe('markdown HTML export', () => {
  test('uses deterministic HTML export names', () => {
    expect(buildMarkdownHtmlFileName('docs/README.MD')).toBe('README.html');
    expect(buildMarkdownHtmlFileNameFromStem(' Project recap ')).toBe('Project recap.html');
  });

  test('validates HTML file name stems before export', () => {
    expect(validateMarkdownHtmlFileStem('')).toBe('Enter a file name.');
    expect(validateMarkdownHtmlFileStem('report:final')).toContain('cannot include');
    expect(validateMarkdownHtmlFileStem('CON')).toBe('Choose a different file name.');
    expect(validateMarkdownHtmlFileStem('Project recap')).toBe('');
  });

  test('accepts only project-contained image paths', () => {
    expect(
      resolveProjectMarkdownImagePath('docs/guide/readme.md', '../assets/logo.png'),
    ).toBe('docs/assets/logo.png');
    expect(
      resolveProjectMarkdownImagePath('docs/guide/readme.md', '../../../secret.png'),
    ).toBeNull();
    expect(
      resolveProjectMarkdownImagePath('docs/guide/readme.md', 'https://example.test/logo.png'),
    ).toBeNull();
  });

  test('resolves external image paths against the host-absolute source directory', () => {
    expect(
      resolveExternalMarkdownImagePath('/home/user/docs/note.md', 'img/a.png'),
    ).toBe('/home/user/docs/img/a.png');
    expect(
      resolveExternalMarkdownImagePath('/home/user/docs/note.md', '../assets/logo.png'),
    ).toBe('/home/user/assets/logo.png');
    expect(
      resolveExternalMarkdownImagePath('/home/user/note.md', '../../../x.png'),
    ).toBe('/x.png');
    expect(
      resolveExternalMarkdownImagePath('D:\\docs\\note.md', 'img\\a.png'),
    ).toBe('D:/docs/img/a.png');
    expect(
      resolveExternalMarkdownImagePath('D:/note.md', '../a.png'),
    ).toBe('D:/a.png');
    expect(
      resolveExternalMarkdownImagePath('\\\\server\\share\\note.md', 'a.png'),
    ).toBe('//server/share/a.png');
  });

  test('rejects non-file image sources for external markdown files', () => {
    expect(
      resolveExternalMarkdownImagePath('/home/user/note.md', 'https://example.test/a.png'),
    ).toBeNull();
    expect(
      resolveExternalMarkdownImagePath('/home/user/note.md', 'data:image/png;base64,xx'),
    ).toBeNull();
    expect(
      resolveExternalMarkdownImagePath('/home/user/note.md', '#anchor'),
    ).toBeNull();
    expect(
      resolveExternalMarkdownImagePath('note.md', '../../x.png'),
    ).toBeNull();
  });

  test('switches exported shiki token colors with the viewer color scheme', () => {
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('var(--shiki-dark)');
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('@media (prefers-color-scheme: light)');
    expect(MARKDOWN_EXPORT_CONTENT_STYLE).toContain('var(--shiki-light)');
  });

  test('renders exported code blocks through the adaptive dual-theme pipeline', () => {
    // Both capture surfaces (file export/share and chat share) consume
    // MarkdownHtmlExportContent, so this flag covers every export pipeline.
    expect(readMarkdownHtmlExportDocumentSource()).toContain('adaptiveCodeTheme: true');
  });

  test('creates an offline HTML document', () => {
    const html = buildStandaloneMarkdownHtmlDocument({
      title: 'README',
      bodyHtml: '<h1>Hello</h1>',
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).not.toContain('<script');
  });

  test('adds trusted document styles and a validated body class explicitly', () => {
    const html = buildStandaloneMarkdownHtmlDocument({
      title: 'Conversation',
      bodyHtml: '<section>Chat</section>',
      additionalStyles: '.wheelmaker-chat-share { display: block; }',
      bodyClassName: 'wheelmaker-chat-share',
    });

    expect(html).toContain('.wheelmaker-chat-share { display: block; }');
    expect(html).toContain('class="wheelmaker-markdown-export wheelmaker-chat-share"');
  });

  test('embeds the framed markdown presentation used by image exports', () => {
    const html = buildStandaloneMarkdownHtmlDocument({
      title: 'Code sample',
      bodyHtml: '<div class="code-frame"><button class="code-frame-copy">Copy</button></div>',
    });

    expect(html).toContain('.wheelmaker-markdown-export .code-frame {');
    expect(html).toContain('.wheelmaker-markdown-export .code-frame-header {');
    expect(html).toMatch(
      /\.wheelmaker-markdown-export \.code-frame-copy\s*\{[^}]*display:\s*none;/,
    );
    expect(html).toContain('max-width: 800px');
  });

  test('renders fenced code with the framed structure used by image exports', () => {
    const source = readMarkdownHtmlExportDocumentSource();
    const codeRendererStart = source.indexOf('markdownCodeRenderer({');
    const codeRendererEnd = source.indexOf('}),', codeRendererStart);

    expect(codeRendererStart).toBeGreaterThanOrEqual(0);
    expect(codeRendererEnd).toBeGreaterThan(codeRendererStart);
    expect(source.slice(codeRendererStart, codeRendererEnd)).toContain('framed: true');
  });

  test('settles HTML renderers at the desktop image export width', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'styles', 'code.css'),
      'utf8',
    );
    const hostStart = source.indexOf('.markdown-html-export-host {');
    const hostEnd = source.indexOf('}', hostStart);
    const surfaceStart = source.indexOf('.markdown-html-export-surface {');
    const surfaceEnd = source.indexOf('}', surfaceStart);

    expect(source.slice(hostStart, hostEnd)).toContain('width: 800px;');
    expect(source.slice(surfaceStart, surfaceEnd)).toContain('padding: 0;');
  });

  test('configures raw HTML sanitization before rendering Markdown', () => {
    const source = readMarkdownHtmlExportDocumentSource();

    expect(source).toContain("import rehypeRaw from 'rehype-raw';");
    expect(source).toContain("import rehypeSanitize");
    expect(source).toContain('rehypeRaw,');
    expect(source).toContain('[rehypeSanitize, markdownHtmlExportSanitizeSchema]');
    expect(source).toContain("src: [...(defaultSchema.protocols?.src ?? []), 'data']");
  });
});
