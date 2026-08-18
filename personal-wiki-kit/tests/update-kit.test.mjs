import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { sha256File } from '../src/kit-lock.mjs';
import { updateKit } from '../src/update-kit.mjs';
import { createTemporaryDirectory } from './support/temp-directory.mjs';

async function fixture() {
  const temporary = await createTemporaryDirectory('update-kit-');
  const repository = join(temporary.path, 'wiki');
  const candidateKitRoot = join(temporary.path, 'candidate-kit');
  const candidateArtifact = join(temporary.path, 'candidate-kit.zip');
  await mkdir(repository);
  await mkdir(candidateKitRoot);
  await writeFile(join(repository, 'wiki-kit.lock.json'), `${JSON.stringify({
    schema: 1,
    version: '1.0.0',
    source: 'wheelmaker-release',
    sha256: '1'.repeat(64),
  }, null, 2)}\n`);
  await writeFile(join(candidateKitRoot, 'kit.json'), '{"schema":1,"version":"1.1.0"}\n');
  await writeFile(candidateArtifact, 'verified archive bytes');
  const target = {
    schema: 1,
    version: '1.1.0',
    source: 'https://github.com/example/personal-wiki-kit/releases/download/v1.1.0/windows-x64.zip',
    sha256: await sha256File(candidateArtifact),
  };
  return { temporary, repository, candidateKitRoot, candidateArtifact, target };
}

test('Kit update rejects an artifact digest mismatch before compatibility checks', async () => {
  const value = await fixture();
  let checked = false;
  await assert.rejects(
    () => updateKit({ ...value, targetLock: { ...value.target, sha256: 'f'.repeat(64) } }, {
      checkCompatibility: async () => { checked = true; },
    }),
    /SHA-256/u,
  );
  assert.equal(checked, false);
  assert.match(await readFile(join(value.repository, 'wiki-kit.lock.json'), 'utf8'), /"1\.0\.0"/u);
  await value.temporary.cleanup();
});

test('failed migration rolls back and preserves the old lock', async () => {
  const value = await fixture();
  const marker = join(value.repository, 'migration-marker.txt');
  let rolledBack = false;
  await assert.rejects(
    () => updateKit({ ...value, targetLock: value.target }, {
      checkCompatibility: async () => {},
      beginMigration: async () => ({
        apply: async () => {
          await writeFile(marker, 'candidate');
          throw new Error('migration failed');
        },
        rollback: async () => {
          rolledBack = true;
          await writeFile(marker, 'restored');
        },
      }),
    }),
    /migration failed/u,
  );
  assert.equal(rolledBack, true);
  assert.equal(await readFile(marker, 'utf8'), 'restored');
  assert.match(await readFile(join(value.repository, 'wiki-kit.lock.json'), 'utf8'), /"1\.0\.0"/u);
  await value.temporary.cleanup();
});

test('successful update checks the candidate before atomically replacing the lock', async () => {
  const value = await fixture();
  const events = [];
  const result = await updateKit({ ...value, targetLock: value.target }, {
    checkCompatibility: async () => events.push('check'),
    beginMigration: async () => ({
      apply: async () => events.push('apply'),
      rollback: async () => events.push('rollback'),
      finalize: async () => events.push('finalize'),
    }),
  });

  assert.deepEqual(events, ['check', 'apply', 'check', 'finalize']);
  assert.equal(result.previous.version, '1.0.0');
  assert.equal(result.current.version, '1.1.0');
  assert.deepEqual(
    JSON.parse(await readFile(join(value.repository, 'wiki-kit.lock.json'), 'utf8')),
    value.target,
  );
  await value.temporary.cleanup();
});
