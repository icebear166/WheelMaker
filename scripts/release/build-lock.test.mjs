import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {acquireBuildLock} from './build-lock.mjs';

test('rejects a second owner and keeps owner metadata', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'wheelmaker-build-lock-'));
  const first = await acquireBuildLock({owner: 'dev', workRoot});
  await assert.rejects(
    () => acquireBuildLock({owner: 'release', workRoot}),
    /build is already running \(owner: dev\)/,
  );
  const owner = JSON.parse(
    await readFile(join(workRoot, 'build.lock', 'owner.json'), 'utf8'),
  );
  assert.deepEqual(owner, {owner: 'dev', pid: process.pid});
  await first.release();
});

test('creates the release work root before taking the lock', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'wheelmaker-build-lock-parent-'));
  const workRoot = join(parent, 'missing-release-work');

  const lock = await acquireBuildLock({owner: 'dev', workRoot});
  const owner = JSON.parse(
    await readFile(join(workRoot, 'build.lock', 'owner.json'), 'utf8'),
  );
  assert.equal(owner.owner, 'dev');
  await lock.release();
});
