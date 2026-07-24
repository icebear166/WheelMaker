import fs from 'node:fs';
import path from 'node:path';

import {
  buildMarkdownHtmlFileName,
  buildPromptMarkdownHtmlFileName,
  buildStandaloneMarkdownHtmlDocument,
  resolveProjectMarkdownImagePath,
} from '../web/src/chat/export/markdownHtmlExport';

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

  test('configures raw HTML sanitization before rendering Markdown', () => {
    const source = fs.readFileSync(
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

    expect(source).toContain("import rehypeRaw from 'rehype-raw';");
    expect(source).toContain("import rehypeSanitize");
    expect(source).toContain('rehypeRaw,');
    expect(source).toContain('[rehypeSanitize, markdownHtmlExportSanitizeSchema]');
    expect(source).toContain("src: [...(defaultSchema.protocols?.src ?? []), 'data']");
  });
});
