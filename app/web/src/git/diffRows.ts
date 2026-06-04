import type { DiffRenderLine } from '../services/shikiSettings';

declare const require: (id: string) => unknown;

type GitDiffChange =
  | { type: 'insert'; content: string; lineNumber: number }
  | { type: 'delete'; content: string; lineNumber: number }
  | {
      type: 'normal';
      content: string;
      oldLineNumber: number;
      newLineNumber: number;
    };

type GitDiffFile = {
  hunks?: Array<{
    changes?: GitDiffChange[];
  }>;
};

type GitDiffParser = {
  parse: (source: string) => GitDiffFile[];
};

type UnifiedDiffRow = {
  kind: 'context' | 'added' | 'removed' | 'separator';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
  separator?: 'hunk' | 'file';
};

const gitdiffParser = require('gitdiff-parser') as GitDiffParser;

function pushUnifiedDiffSeparator(
  rows: UnifiedDiffRow[],
  separator: 'hunk' | 'file',
  text: string,
): void {
  if (rows.length === 0) return;
  const last = rows[rows.length - 1];
  if (last.kind === 'separator') return;
  rows.push({
    kind: 'separator',
    oldLineNumber: null,
    newLineNumber: null,
    text,
    separator,
  });
}

function parseUnifiedDiffRows(content: string): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  try {
    const files = gitdiffParser.parse(content) as GitDiffFile[];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const hunks = file.hunks || [];
      if (hunks.length === 0) continue;

      if (rows.length > 0) {
        pushUnifiedDiffSeparator(rows, 'file', '... next file ...');
      }

      for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
        const hunk = hunks[hunkIndex];
        if (hunkIndex > 0) {
          pushUnifiedDiffSeparator(rows, 'hunk', '... skipped unchanged lines ...');
        }
        for (const change of hunk.changes || []) {
          pushDiffChange(rows, change);
        }
      }
    }
  } catch {
    // Fall through to fallback parser for non-standard diff snippets.
  }

  if (rows.length > 0) {
    return rows;
  }

  const lines = content.split('\n');
  for (const raw of lines) {
    if (raw.startsWith('+')) {
      rows.push({
        kind: 'added',
        oldLineNumber: null,
        newLineNumber: null,
        text: raw.slice(1),
      });
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({
        kind: 'removed',
        oldLineNumber: null,
        newLineNumber: null,
        text: raw.slice(1),
      });
      continue;
    }
    rows.push({
      kind: 'context',
      oldLineNumber: null,
      newLineNumber: null,
      text: raw.startsWith(' ') ? raw.slice(1) : raw,
    });
  }
  return rows;
}

function pushDiffChange(rows: UnifiedDiffRow[], change: GitDiffChange): void {
  if (change.type === 'insert') {
    rows.push({
      kind: 'added',
      oldLineNumber: null,
      newLineNumber: change.lineNumber,
      text: change.content,
    });
    return;
  }
  if (change.type === 'delete') {
    rows.push({
      kind: 'removed',
      oldLineNumber: change.lineNumber,
      newLineNumber: null,
      text: change.content,
    });
    return;
  }
  rows.push({
    kind: 'context',
    oldLineNumber: change.oldLineNumber,
    newLineNumber: change.newLineNumber,
    text: change.content,
  });
}

function buildInlineDiffRenderLines(rows: UnifiedDiffRow[]): DiffRenderLine[] {
  return rows.map(row => {
    if (row.kind === 'separator') {
      return {
        code: row.text,
        lineNumber: null,
        oldLineNumber: null,
        newLineNumber: null,
        kind: 'empty',
        separator: row.separator ?? 'hunk',
      };
    }
    return {
      code: row.text,
      lineNumber: row.newLineNumber ?? row.oldLineNumber,
      oldLineNumber: row.oldLineNumber,
      newLineNumber: row.newLineNumber,
      kind: row.kind,
    };
  });
}

export function parseUnifiedDiffRenderLines(content: string): DiffRenderLine[] {
  return buildInlineDiffRenderLines(parseUnifiedDiffRows(content));
}
