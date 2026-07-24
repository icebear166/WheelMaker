const MARKDOWN_HTML_EXPORT_STYLE = `
:root { color-scheme: light dark; --wm-muted: #57606a; --wm-border: #d0d7de; --wm-code: #f6f8fa; --wm-link: #0969da; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; line-height: 1.6; }
.wheelmaker-markdown-export { max-width: 960px; margin: 0 auto; padding: 32px; }
.wheelmaker-markdown-export > :first-child { margin-top: 0; }
.wheelmaker-markdown-export > :last-child { margin-bottom: 0; }
.wheelmaker-markdown-export h1, .wheelmaker-markdown-export h2 { padding-bottom: .3em; border-bottom: 1px solid var(--wm-border); }
.wheelmaker-markdown-export h1 { font-size: 2em; } .wheelmaker-markdown-export h2 { font-size: 1.5em; } .wheelmaker-markdown-export h3 { font-size: 1.25em; }
.wheelmaker-markdown-export a { color: var(--wm-link); text-decoration: underline; }
.wheelmaker-markdown-export img { max-width: 100%; height: auto; }
.wheelmaker-markdown-export blockquote { margin: 1em 0; padding: 0 .9em; color: var(--wm-muted); border-left: .25em solid var(--wm-border); }
.wheelmaker-markdown-export code { padding: .15em .35em; border-radius: 4px; background: var(--wm-code); font-family: "JetBrains Mono", Consolas, monospace; font-size: .9em; }
.wheelmaker-markdown-export pre { overflow-x: auto; padding: 14px; border-radius: 8px; background: var(--wm-code); }
.wheelmaker-markdown-export pre code { padding: 0; background: transparent; }
.wheelmaker-markdown-export .wm-shiki-pre { background: var(--wm-code); }
.wheelmaker-markdown-export table { width: 100%; border-collapse: collapse; overflow: auto; display: block; }
.wheelmaker-markdown-export th, .wheelmaker-markdown-export td { border: 1px solid var(--wm-border); padding: 6px 8px; text-align: left; }
.wheelmaker-markdown-export th { background: var(--wm-code); }
.wheelmaker-markdown-export input[type="checkbox"] { margin-right: .45em; }
.wheelmaker-markdown-export hr { border: 0; border-top: 1px solid var(--wm-border); }
.wheelmaker-markdown-export .katex { font-size: 1.05em; }
@media (prefers-color-scheme: light) {
  body { background: #ffffff; color: #1f2328; }
}
@media (prefers-color-scheme: dark) {
  :root { --wm-muted: #aab4c0; --wm-border: #3d444d; --wm-code: #161b22; --wm-link: #58a6ff; }
  body { background: #1e1e1e; color: #f0f0f0; }
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
