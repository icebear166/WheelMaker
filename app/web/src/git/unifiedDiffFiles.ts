export type UnifiedDiffFileBlock = {
  path: string;
  diff: string;
};

export function splitUnifiedDiffFileBlocks(content: string): UnifiedDiffFileBlock[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('diff --git ')) {
      starts.push(index);
    }
  }
  if (starts.length === 0) {
    return [];
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    const blockLines = lines.slice(start, end);
    return {
      path: parseUnifiedDiffBlockPath(blockLines) || `file-${index + 1}`,
      diff: blockLines.join('\n'),
    };
  });
}

function parseUnifiedDiffBlockPath(lines: string[]): string {
  const addedPath = parseUnifiedDiffPathLine(lines.find(line => line.startsWith('+++ ')) ?? '');
  if (addedPath) {
    return addedPath;
  }
  const removedPath = parseUnifiedDiffPathLine(lines.find(line => line.startsWith('--- ')) ?? '');
  if (removedPath) {
    return removedPath;
  }
  return parseDiffGitPath(lines[0] ?? '');
}

function parseUnifiedDiffPathLine(line: string): string {
  const token = line.slice(4).trim();
  if (token === '/dev/null') {
    return '';
  }
  return stripDiffPathPrefix(unquoteDiffPathToken(token));
}

function parseDiffGitPath(line: string): string {
  const tokens = line.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|\S+/g) ?? [];
  const right = tokens[3] ?? tokens[2] ?? '';
  return stripDiffPathPrefix(unquoteDiffPathToken(right));
}

function stripDiffPathPrefix(value: string): string {
  if (value.startsWith('a/') || value.startsWith('b/')) {
    return value.slice(2);
  }
  return value;
}

function unquoteDiffPathToken(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
