import fs from 'fs';
import path from 'path';

function workspacePersistenceSource(): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'workspace', 'WorkspacePersistence.ts'),
    'utf8',
  );
}

function functionBlock(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  private ', start + signature.length);
  return source.slice(start, next > start ? next : undefined);
}

describe('workspace persistence reset policy', () => {
  test('does not run destructive table clearing from IndexedDB version upgrades', () => {
    const source = workspacePersistenceSource();
    const upgradeStart = source.indexOf('req.onupgradeneeded =');
    const successStart = source.indexOf('req.onsuccess =', upgradeStart);
    expect(upgradeStart).toBeGreaterThanOrEqual(0);
    expect(successStart).toBeGreaterThan(upgradeStart);

    const upgradeBlock = source.slice(upgradeStart, successStart);
    expect(upgradeBlock).not.toContain('oldVersion');
    expect(upgradeBlock).not.toContain('.clear()');
  });

  test('clears incompatible chat cache without resetting global settings', () => {
    const source = workspacePersistenceSource();
    const resetBlock = functionBlock(source, 'private async resetPersistentCacheAfterIncompatibleSchema()');

    expect(resetBlock).toContain('TABLE_CHAT_SESSION_INDEX');
    expect(resetBlock).toContain('TABLE_CHAT_SESSION_CONTENT');
    expect(resetBlock).not.toContain('this.state = defaultWorkspaceState()');
    expect(resetBlock).not.toContain('this.state.global');
    expect(resetBlock).not.toContain('this.saveLocalIdentityState');
    expect(resetBlock).not.toContain('this.saveAllStateToDb()');
    expect(resetBlock).not.toContain('TABLE_GLOBAL_KV');
  });

  test('reads local identity as partial values so missing localStorage does not blank IndexedDB state', () => {
    const source = workspacePersistenceSource();

    expect(source).toContain("type LocalIdentityState = Partial<Pick<PersistedGlobalState, 'address' | 'token'>>");
    expect(source).toContain("private mergeLocalIdentityState(base: PersistedGlobalState): PersistedGlobalState");
    expect(source).toContain("return sanitizeGlobalState({...base, ...localIdentity});");
    expect(source).not.toContain("return {address: '', token: ''};");
  });

  test('only explicit identity patches write localStorage mirrors', () => {
    const source = workspacePersistenceSource();
    const patchBlock = functionBlock(source, 'patchGlobalState(patch: Partial<PersistedGlobalState>): void');

    expect(patchBlock).toContain("'address' in patch || 'token' in patch");
    expect(patchBlock).toContain('this.saveLocalIdentityState(this.state.global)');
    expect(patchBlock).not.toContain('this.saveLocalIdentityState(this.state.global);\n\n    const now');
  });
});
