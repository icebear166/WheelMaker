const MARKDOWN_HTML_EXPORT_STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; font-family: "IBM Plex Sans", system-ui, sans-serif; line-height: 1.6; }
.wheelmaker-markdown-export { box-sizing: border-box; max-width: 960px; margin: 0 auto; padding: 32px; }
.wheelmaker-markdown-export img { max-width: 100%; height: auto; }
.wheelmaker-markdown-export pre { overflow-x: auto; padding: 14px; border-radius: 8px; }
.wheelmaker-markdown-export table { width: 100%; border-collapse: collapse; }
.wheelmaker-markdown-export th, .wheelmaker-markdown-export td { border: 1px solid currentColor; padding: 6px 8px; text-align: left; }
@media (prefers-color-scheme: light) {
  body { background: #ffffff; color: #1f2328; }
  .wheelmaker-markdown-export pre { background: #f6f8fa; }
}
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #f0f0f0; }
  .wheelmaker-markdown-export pre { background: #161b22; }
}
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildMarkdownHtmlFileName(path: string): string {
  const base = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || 'document.md';
  return `${base.replace(/\.md$/i, '') || 'document'}.html`;
}

export function buildPromptMarkdownHtmlFileName(
  doneTurnIndex: number,
  now = new Date(),
): string {
  const safeTurnIndex = Math.max(0, Math.trunc(doneTurnIndex || 0));
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `wheelmaker-response-turn-${safeTurnIndex}-${timestamp}.html`;
}

export function resolveProjectMarkdownImagePath(
  markdownPath: string,
  source: string,
): string | null {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) {
    return null;
  }
  const relativeSource = source.split(/[?#]/, 1)[0] || '';
  const parts = [
    ...markdownPath.replaceAll('\\', '/').split('/').slice(0, -1),
    ...relativeSource.split('/'),
  ];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/') || null;
}

export function buildStandaloneMarkdownHtmlDocument({
  title,
  bodyHtml,
}: {
  title: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${MARKDOWN_HTML_EXPORT_STYLE}</style>
</head>
<body>
<main class="wheelmaker-markdown-export">${bodyHtml}</main>
</body>
</html>`;
}
