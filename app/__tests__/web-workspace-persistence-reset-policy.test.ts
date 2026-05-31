import fs from 'fs';
import path from 'path';

function workspacePersistenceSource(): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'services', 'workspacePersistence.ts'),
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
});
