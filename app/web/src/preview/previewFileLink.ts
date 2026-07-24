export type PreviewFileLink = {
  path: string;
  absolutePath: string;
  relativePath: string | null;
  line: number | null;
};

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

function stripLeadingSlashFromDrivePath(value: string): string {
  return /^\/[a-z]:\//i.test(value) ? value.slice(1) : value;
}

export function isAbsolutePreviewFilePath(value: string): boolean {
  const normalized = stripLeadingSlashFromDrivePath(normalizeSlashes(value.trim()));
  return (
    /^[a-z]:\//i.test(normalized)
    || /^\/\/[^/]+\/[^/]+/.test(normalized)
    || normalized.startsWith('/')
  );
}

function normalizeSegments(segments: string[], floor = 0): string[] {
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (result.length > floor) result.pop();
      continue;
    }
    result.push(segment);
  }
  return result;
}

function normalizeAbsoluteLocalPath(value: string): string {
  const normalized = stripLeadingSlashFromDrivePath(normalizeSlashes(value));
  const driveMatch = /^([a-z]:)\/(.*)$/i.exec(normalized);
  if (driveMatch) {
    return `${driveMatch[1]}/${normalizeSegments(driveMatch[2].split('/')).join('/')}`
      .replace(/\/$/, '');
  }

  if (normalized.startsWith('//')) {
    const segments = normalized.slice(2).split('/').filter(Boolean);
    if (segments.length < 2) return '';
    const normalizedSegments = normalizeSegments(segments, 2);
    return `//${normalizedSegments.join('/')}`.replace(/\/$/, '');
  }

  if (normalized.startsWith('/')) {
    const path = normalizeSegments(normalized.slice(1).split('/')).join('/');
    return path ? `/${path}` : '/';
  }
  return '';
}

function normalizeRelativePath(value: string): string {
  const result: string[] = [];
  for (const segment of normalizeSlashes(value).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && result.length > 0 && result.at(-1) !== '..') {
      result.pop();
    } else {
      result.push(segment);
    }
  }
  return result.join('/');
}

function resolveAbsolutePath(path: string, projectRoot: string): string {
  if (isAbsolutePreviewFilePath(path)) {
    return normalizeAbsoluteLocalPath(path);
  }
  if (!projectRoot) return '';
  return normalizeAbsoluteLocalPath(`${projectRoot}/${path}`);
}

function relativePathWithinRoot(projectRoot: string, absolutePath: string): string | null {
  if (!projectRoot || !absolutePath) return null;
  const windowsLike = /^[a-z]:\//i.test(projectRoot) || projectRoot.startsWith('//');
  const comparableRoot = windowsLike ? projectRoot.toLowerCase() : projectRoot;
  const comparablePath = windowsLike ? absolutePath.toLowerCase() : absolutePath;
  if (comparablePath === comparableRoot) return '';
  if (!comparablePath.startsWith(`${comparableRoot}/`)) return null;
  return absolutePath.slice(projectRoot.length + 1);
}

function extractLine(value: string): {path: string; line: number | null} {
  let path = value;
  let line: number | null = null;
  const hashMatch = /#L(\d+)(?:C\d+)?$/i.exec(path);
  if (hashMatch) {
    line = Number.parseInt(hashMatch[1], 10);
    path = path.slice(0, hashMatch.index);
  }
  const suffixMatch = /:(\d+)(?::\d+)?$/.exec(path);
  if (suffixMatch) {
    line = Number.parseInt(suffixMatch[1], 10);
    path = path.slice(0, suffixMatch.index);
  }
  return {path, line: line && line > 0 ? line : null};
}

function resolvePathCandidate(rawHref: string): string | null {
  if (/^file:\/\//i.test(rawHref)) {
    try {
      const parsed = new URL(rawHref);
      const pathname = decodePath(parsed.pathname);
      return parsed.hostname
        ? `//${parsed.hostname}${pathname}${parsed.hash}`
        : `${pathname}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  if (/^vscode:\/\//i.test(rawHref)) {
    try {
      const parsed = new URL(rawHref);
      if (parsed.hostname.toLowerCase() !== 'file') return null;
      return `${decodePath(parsed.pathname)}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  if (/^\/?[a-z]:/i.test(rawHref)) {
    const decoded = decodePath(rawHref);
    return /^\/?[a-z]:[^\\/]/i.test(decoded)
      ? decoded.replace(/^\/?([a-z]:)/i, '$1/')
      : decoded;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) return null;
  return decodePath(rawHref);
}

export function resolvePreviewFileLink(
  href: string,
  projectRoot = '',
): PreviewFileLink | null {
  const rawHref = href.trim();
  if (!rawHref) return null;

  const candidate = resolvePathCandidate(rawHref);
  if (candidate === null) return null;
  const parsed = extractLine(normalizeSlashes(candidate).trim());
  if (!parsed.path) return null;

  const normalizedRoot = normalizeAbsoluteLocalPath(projectRoot);
  const absolutePath = resolveAbsolutePath(parsed.path, normalizedRoot);
  if (absolutePath) {
    const relativePath = relativePathWithinRoot(normalizedRoot, absolutePath);
    if (relativePath === '') return null;
    return {
      path: relativePath ?? absolutePath,
      absolutePath,
      relativePath,
      line: parsed.line,
    };
  }

  const relativePath = normalizeRelativePath(parsed.path);
  if (!relativePath || relativePath.startsWith('../')) return null;
  return {
    path: relativePath,
    absolutePath: '',
    relativePath,
    line: parsed.line,
  };
}
