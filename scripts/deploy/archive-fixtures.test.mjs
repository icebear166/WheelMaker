import assert from 'node:assert/strict';
import { zstdCompressSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractTarZst } from './deploy-core.mjs';
import { createTarZst } from '../release/tar.mjs';

test('extractor rejects traversal, absolute paths, and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-unsafe-tar-'));
  const fixtures = [
    makeTarZst([{ body: 'bad', name: '../outside', type: '0' }]),
    makeTarZst([{ body: 'bad', name: '/absolute', type: '0' }]),
    makeTarZst([{ body: 'bad', name: 'C:/absolute', type: '0' }]),
    makeTarZst([{ body: 'bad', name: 'web\\outside', type: '0' }]),
    makeTarZst([{ body: '', linkName: 'target', name: 'link', type: '2' }]),
    makeTarZst([{ body: '', linkName: 'target', name: 'link', type: '1' }]),
    makeTarZst([{ body: '', name: 'device', type: '3' }]),
  ];

  try {
    for (const [index, fixture] of fixtures.entries()) {
      await assert.rejects(
        () => extractTarZst(fixture, join(root, `target-${index}`)),
        /unsafe tar entry/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('extractor reads archives produced by the release tar writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-safe-tar-'));
  const source = join(root, 'source');
  const archive = join(root, 'package.tar.zst');
  const target = join(root, 'target');

  try {
    await mkdir(join(source, 'hub'), { recursive: true });
    await mkdir(join(source, 'web'), { recursive: true });
    await writeFile(join(source, 'hub', 'wheelmaker'), 'hub');
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await createTarZst({ outputPath: archive, sourceDir: source });

    const result = await extractTarZst(await readFile(archive), target);
    assert.equal(await readFile(join(target, 'hub', 'wheelmaker'), 'utf8'), 'hub');
    assert.equal(await readFile(join(target, 'web', 'index.html'), 'utf8'), 'web');
    assert.equal(result.entries, 4);
    assert.equal(result.contentBytes, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('extractor enforces per-file and cumulative content limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-limited-tar-'));
  try {
    const fileTooLarge = makeTarZst([
      { body: '12345', name: 'large', size: 5, type: '0' },
    ]);
    await assert.rejects(
      () =>
        extractTarZst(fileTooLarge, join(root, 'file-limit'), {
          maxFileBytes: 4,
        }),
      /archive limit exceeded/,
    );

    const totalTooLarge = makeTarZst([
      { body: '123', name: 'first', type: '0' },
      { body: '456', name: 'second', type: '0' },
    ]);
    await assert.rejects(
      () =>
        extractTarZst(totalTooLarge, join(root, 'total-limit'), {
          maxContentBytes: 5,
        }),
      /archive limit exceeded/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function makeTarZst(entries) {
  const blocks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    const size = entry.size ?? body.length;
    const header = Buffer.alloc(512);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, entry.type === '5' ? 0o755 : 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, size);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    writeText(header, 156, 1, entry.type);
    writeText(header, 157, 100, entry.linkName ?? '');
    writeText(header, 257, 6, 'ustar\0');
    writeText(header, 263, 2, '00');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return zstdCompressSync(Buffer.concat(blocks), { level: 22 });
}

function writeText(buffer, offset, length, value) {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer, offset, length, value) {
  writeText(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}
