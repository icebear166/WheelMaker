export type ShareDocumentKind = 'markdown' | 'html';

export type ShareDependencyWarning = {
  source: string;
  message: string;
};

export type ShareSnapshot = {
  kind: ShareDocumentKind;
  title: string;
  html: string;
  warnings: ShareDependencyWarning[];
};

export function shareKindForPath(path: string): ShareDocumentKind | undefined {
  const normalized = path.replaceAll('\\', '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..')) {
    return undefined;
  }
  const extension = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  return undefined;
}

// External files use host-absolute paths, so unlike shareKindForPath this check
// is extension-only and accepts POSIX roots, drive letters, and '..' segments.
export function shareKindForExternalPath(path: string): ShareDocumentKind | undefined {
  const normalized = path.replaceAll('\\', '/').trim();
  if (!normalized) return undefined;
  const extension = normalized.slice(normalized.lastIndexOf('.')).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  return undefined;
}

export function createMarkdownShareSnapshot({
  title,
  html,
  warnings = [],
}: {
  title: string;
  html: string;
  warnings?: ShareDependencyWarning[];
}): ShareSnapshot {
  return {kind: 'markdown', title, html, warnings};
}

export function createHtmlShareSnapshot({
  title,
  source,
}: {
  title: string;
  source: string;
}): ShareSnapshot {
  return {
    kind: 'html',
    title,
    html: source,
    warnings: inspectShareHtmlDependencies(source),
  };
}

export function createChatShareSnapshot({
  title,
  html,
  warnings = [],
}: {
  title: string;
  html: string;
  warnings?: ShareDependencyWarning[];
}): ShareSnapshot {
  return {kind: 'html', title, html, warnings};
}

export function inspectShareHtmlDependencies(source: string): ShareDependencyWarning[] {
  const warnings: ShareDependencyWarning[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const value = raw.trim();
    if (!isRelativeShareDependency(value) || seen.has(value)) return;
    seen.add(value);
    warnings.push({
      source: value,
      message: `Relative dependency "${value}" is kept as-is and may not be available from the public share.`,
    });
  };

  const attributePattern = /\b(?:src|href|poster|data)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of source.matchAll(attributePattern)) {
    add(match[2] ?? '');
  }
  const cssURLPattern = /url\(\s*(["']?)([^)'\"]+)\1\s*\)/gi;
  for (const match of source.matchAll(cssURLPattern)) {
    add(match[2] ?? '');
  }
  return warnings;
}

function isRelativeShareDependency(value: string): boolean {
  return !!value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(value);
}
