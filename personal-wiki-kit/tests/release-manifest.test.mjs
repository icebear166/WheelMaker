import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  verifyReleaseRoot,
  writeReleaseManifest,
} from '../src/release-manifest.mjs';

async function createReleaseRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-release-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data', 'catalog.json'), '{"schema":1}\n');
  await writeFile(join(root, 'data', 'search.json'), '{"schema":1}\n');
  return root;
}

test('release manifest verifies declared files and is deterministic', async (t) => {
  const root = await createReleaseRoot(t);
  const options = {
    root,
    releaseId: 'fixture-release',
    generatedAt: '2026-08-18T00:00:00.000Z',
  };

  await writeReleaseManifest(options);
  const first = await readFile(join(root, 'release-manifest.json'), 'utf8');
  await writeReleaseManifest(options);
  const second = await readFile(join(root, 'release-manifest.json'), 'utf8');

  assert.equal(first, second);
  assert.equal(await verifyReleaseRoot(root), true);
});

test('release manifest rejects tampered and unlisted files', async (t) => {
  const root = await createReleaseRoot(t);
  await writeReleaseManifest({ root, releaseId: 'fixture-release' });
  await writeFile(join(root, 'data', 'catalog.json'), '{"schema":2}\n');
  await assert.rejects(() => verifyReleaseRoot(root), /checksum mismatch|unexpected size/);

  await writeFile(join(root, 'data', 'catalog.json'), '{"schema":1}\n');
  await writeReleaseManifest({ root, releaseId: 'fixture-release' });
  await writeFile(join(root, 'extra.txt'), 'not declared');
  await assert.rejects(() => verifyReleaseRoot(root), /unlisted file extra\.txt/);
});

test('release manifest rejects unsafe declared paths', async (t) => {
  const root = await createReleaseRoot(t);
  await writeReleaseManifest({ root, releaseId: 'fixture-release' });
  const manifestPath = join(root, 'release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].path = '../outside.txt';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(() => verifyReleaseRoot(root), /unsafe path/);
});
