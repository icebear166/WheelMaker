import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createTarGz,
  listTarEntries,
  normalizeTarPath,
} from './tar.mjs';

test('tar.gz output is deterministic and sorted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-tar-'));
  const source = join(root, 'source');
  const first = join(root, 'first.tar.gz');
  const second = join(root, 'second.tar.gz');

  try {
    await mkdir(join(source, 'web'), { recursive: true });
    await mkdir(join(source, 'hub'), { recursive: true });
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await writeFile(join(source, 'hub', 'wheelmaker'), 'hub');

    await createTarGz({ sourceDir: source, outputPath: first });
    await createTarGz({ sourceDir: source, outputPath: second });

    assert.deepEqual(await readFile(first), await readFile(second));
    assert.deepEqual(await listTarEntries(first), [
      'hub/',
      'hub/wheelmaker',
      'web/',
      'web/index.html',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tar paths reject absolute and traversal-like names', () => {
  assert.throws(() => normalizeTarPath('../outside'), /unsafe tar path/);
  assert.throws(() => normalizeTarPath('/absolute'), /unsafe tar path/);
  assert.throws(() => normalizeTarPath('C:\\absolute'), /unsafe tar path/);
  assert.equal(normalizeTarPath('web\\assets\\bundle.js'), 'web/assets/bundle.js');
});

test('Hub binaries are executable while Web files remain read-only data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-tar-mode-'));
  const source = join(root, 'source');
  const archive = join(root, 'package.tar.gz');
  try {
    await mkdir(join(source, 'hub'), { recursive: true });
    await mkdir(join(source, 'web'), { recursive: true });
    await writeFile(join(source, 'hub', 'wheelmaker'), 'hub');
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await createTarGz({ sourceDir: source, outputPath: archive });

    const entries = await listTarEntries(archive, { details: true });
    const byPath = Object.fromEntries(entries.map((entry) => [entry.path, entry]));
    assert.equal(byPath['hub/wheelmaker'].mode, 0o755);
    assert.equal(byPath['web/index.html'].mode, 0o644);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
