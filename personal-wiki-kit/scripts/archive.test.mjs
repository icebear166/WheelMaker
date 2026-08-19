import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {collectArchiveEntries, writeTarGzArchive, writeZipArchive} from './archive.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-kit-archive-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'bin'), {recursive: true});
  await writeFile(path.join(root, 'README.md'), 'release\n');
  await writeFile(path.join(root, 'bin', 'personal-wiki'), '#!/bin/sh\n');
  return root;
}

test('archive entries are normalized, sorted, hashed, and preserve executable intent', async (t) => {
  const root = await fixture(t);
  const entries = await collectArchiveEntries(root, {executablePaths: new Set(['bin/personal-wiki'])});
  assert.deepEqual(entries.map((entry) => entry.path), ['README.md', 'bin/personal-wiki']);
  assert.deepEqual(entries.map((entry) => entry.mode), [0o644, 0o755]);
  assert.ok(entries.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256)));
  assert.ok(entries.every((entry) => entry.mtime === 0));
});

test('zip and tar.gz bytes are deterministic for an unchanged tree', async (t) => {
  const root = await fixture(t);
  const outputs = ['first.zip', 'second.zip', 'first.tar.gz', 'second.tar.gz']
    .map((name) => path.join(path.dirname(root), `${path.basename(root)}-${name}`));
  t.after(() => Promise.all(outputs.map((filename) => rm(filename, {force: true}))));
  const options = {source: root, executablePaths: new Set(['bin/personal-wiki'])};
  await writeZipArchive({...options, output: outputs[0], prefix: 'personal-wiki-kit/'});
  await writeZipArchive({...options, output: outputs[1], prefix: 'personal-wiki-kit/'});
  await writeTarGzArchive({...options, output: outputs[2], prefix: 'personal-wiki-kit/'});
  await writeTarGzArchive({...options, output: outputs[3], prefix: 'personal-wiki-kit/'});
  assert.deepEqual(await readFile(outputs[0]), await readFile(outputs[1]));
  assert.deepEqual(await readFile(outputs[2]), await readFile(outputs[3]));
});
