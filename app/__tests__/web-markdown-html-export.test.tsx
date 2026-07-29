import fs from 'node:fs';
import path from 'node:path';

import {
  buildMarkdownHtmlFileName,
  buildPromptMarkdownHtmlFileName,
  buildStandaloneMarkdownHtmlDocument,
  resolveProjectMarkdownImagePath,
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
    expect(
      buildPromptMarkdownHtmlFileName(7, new Date('2026-07-24T08:09:10.123Z')),
    ).toBe('wheelmaker-response-turn-7-2026-07-24T08-09-10-123Z.html');
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
