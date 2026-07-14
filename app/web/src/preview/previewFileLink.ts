export type PreviewFileLink = {
  path: string;
  line: number | null;
};

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolvePreviewFileLink(
  href: string,
  projectRoot = '',
): PreviewFileLink | null {
  const rawHref = href.trim();
  if (!rawHref) return null;
  const isWindowsDrivePath = /^\/?[a-zA-Z]:/.test(rawHref);

  let pathCandidate = rawHref;
  if (/^\/?[a-zA-Z]:[^\\/]/.test(pathCandidate)) {
    const hasLeadingSlash = pathCandidate.startsWith('/');
    const prefix = hasLeadingSlash ? pathCandidate.slice(0, 3) : pathCandidate.slice(0, 2);
    const suffix = hasLeadingSlash ? pathCandidate.slice(3) : pathCandidate.slice(2);
    pathCandidate = `${prefix}/${suffix}`;
  }
  if (/^file:\/\//i.test(rawHref)) {
    try {
      const parsed = new URL(rawHref);
      pathCandidate = `${parsed.hostname || ''}${decodePath(parsed.pathname)}`;
    } catch {
      return null;
    }
  } else if (/^vscode:\/\//i.test(rawHref)) {
    try {
      const parsed = new URL(rawHref);
      if (parsed.hostname.toLowerCase() !== 'file') return null;
      pathCandidate = decodePath(parsed.pathname);
    } catch {
      return null;
    }
  } else if (isWindowsDrivePath) {
    pathCandidate = decodePath(rawHref);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return null;
  } else {
    pathCandidate = decodePath(rawHref);
  }

  const normalizeSlashes = (value: string) => value.replaceAll('\\', '/');
  let normalized = normalizeSlashes(pathCandidate.trim());
  if (!normalized) return null;

  let line: number | null = null;
  const hashMatch = /#L(\d+)(?:C\d+)?$/i.exec(normalized);
  if (hashMatch) {
    const parsedLine = Number.parseInt(hashMatch[1], 10);
    line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
    normalized = normalized.slice(0, hashMatch.index);
  }
  const suffixLineMatch = /:(\d+)(?::\d+)?$/.exec(normalized);
  if (suffixLineMatch) {
    const parsedLine = Number.parseInt(suffixLineMatch[1], 10);
    line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : line;
    normalized = normalized.slice(0, suffixLineMatch.index);
  }
  normalized = normalized.trim();
  if (!normalized || /^(\/\/|[a-z]+:\/\/)/i.test(normalized)) return null;

  const root = normalizeSlashes(projectRoot).replace(/\/+$/, '');
  const rootLower = root.toLowerCase();
  let candidateLower = normalized.toLowerCase();
  if (root && candidateLower === rootLower) return null;
  if (/^\/[a-z]:\//i.test(normalized)) {
    normalized = normalized.slice(1);
    candidateLower = normalized.toLowerCase();
  }

  let resolvedPath = normalized;
  if (root && candidateLower.startsWith(`${rootLower}/`)) {
    resolvedPath = normalized.slice(root.length + 1);
  }
  resolvedPath = resolvedPath
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!resolvedPath || resolvedPath.startsWith('../')) return null;
  return {path: resolvedPath, line};
}
