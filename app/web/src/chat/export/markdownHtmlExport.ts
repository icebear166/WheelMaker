export const MARKDOWN_EXPORT_CONTENT_CLASS_NAME = 'wheelmaker-markdown-export';

export const MARKDOWN_EXPORT_CONTENT_STYLE = `
.wheelmaker-markdown-export {
  box-sizing: border-box;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 26px 30px 30px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-panel);
  color: var(--text-primary);
  font-family: "IBM Plex Sans", "Noto Sans", sans-serif;
  font-size: 13px;
  line-height: 1.6;
}
.wheelmaker-markdown-export > :first-child { margin-top: 0; }
.wheelmaker-markdown-export > :last-child { margin-bottom: 0; }
.wheelmaker-markdown-export p,
.wheelmaker-markdown-export ul,
.wheelmaker-markdown-export ol,
.wheelmaker-markdown-export blockquote,
.wheelmaker-markdown-export table { margin: 0 0 12px; }
.wheelmaker-markdown-export h1,
.wheelmaker-markdown-export h2,
.wheelmaker-markdown-export h3,
.wheelmaker-markdown-export h4,
.wheelmaker-markdown-export h5,
.wheelmaker-markdown-export h6 { margin: 16px 0 10px; line-height: 1.3; }
.wheelmaker-markdown-export a,
.wheelmaker-markdown-export a:visited {
  color: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary));
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent-primary) 60%, transparent);
}
.wheelmaker-markdown-export code {
  font-family: "JetBrains Mono", Consolas, "Courier New", monospace;
  font-size: .92em;
}
.wheelmaker-markdown-export .wm-shiki-code { white-space: normal; }
.wheelmaker-markdown-export .code-wrap { margin: 10px 0 12px; }
.wheelmaker-markdown-export table {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.wheelmaker-markdown-export th,
.wheelmaker-markdown-export td {
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  overflow-wrap: anywhere;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}
.wheelmaker-markdown-export .katex-display {
  margin: 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.wheelmaker-markdown-export img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
.wheelmaker-markdown-export .code-frame {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 10px 0 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-panel);
  overflow: hidden;
}
.wheelmaker-markdown-export .code-frame-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 0 14px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 24px;
  user-select: none;
}
.wheelmaker-markdown-export .code-frame-language {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wheelmaker-markdown-export .code-frame-copy { display: none; }
.wheelmaker-markdown-export .code-frame-body { padding: 6px 14px 12px; }
.wheelmaker-markdown-export .code-frame .code-wrap { margin: 0; }
.wheelmaker-markdown-export .mermaid-block {
  margin: 10px 0 12px;
  padding: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-panel);
  overflow: auto;
}
.wheelmaker-markdown-export .mermaid-block svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
`;

const MARKDOWN_HTML_EXPORT_PAGE_STYLE = `
:root {
  color-scheme: light dark;
  --surface-canvas: #1b1b1b;
  --surface-panel: #242424;
  --text-primary: #dedede;
  --text-secondary: #a3a3a3;
  --border-subtle: #363636;
  --accent-primary: #2784c7;
  --muted: var(--text-secondary);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-canvas); color: var(--text-primary); }
@media (prefers-color-scheme: light) {
  :root {
    --surface-canvas: #f3f3f3;
    --surface-panel: #fafafa;
    --text-primary: #242424;
    --text-secondary: #6f6f6f;
    --border-subtle: #dedede;
    --accent-primary: #1478ba;
  }
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
<style>${MARKDOWN_HTML_EXPORT_PAGE_STYLE}${MARKDOWN_EXPORT_CONTENT_STYLE}</style>
</head>
<body>
<main class="${MARKDOWN_EXPORT_CONTENT_CLASS_NAME}">${bodyHtml}</main>
</body>
</html>`;
}
