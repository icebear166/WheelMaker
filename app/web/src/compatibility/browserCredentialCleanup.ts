const OBSOLETE_GLOBAL_ROWS = new Set([
  'address',
  'token',
  'deepseekApiKey',
  'speechSettings',
  'ttsSettings',
]);

export function obsoleteBrowserCredentialRows(rows: ReadonlyArray<{k: string}>): string[] {
  return [...new Set(rows
    .map(row => row.k)
    .filter(key => OBSOLETE_GLOBAL_ROWS.has(key)))];
}

export function scrubLegacyBrowserCredentials(): void {
  try {
    globalThis.localStorage?.removeItem(['wheelmaker', 'workspace', 'address'].join('.'));
    globalThis.localStorage?.removeItem(['wheelmaker', 'workspace', 'token'].join('.'));
  } catch {
    // Storage can be unavailable; IndexedDB cleanup still runs during initialization.
  }
}
