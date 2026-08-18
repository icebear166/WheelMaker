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

import { verifyReleaseRoot, writeReleaseManifest } from '../src/release-manifest.mjs';
import {
  buildSite,
  writeReaderManifest,
} from '../src/site-builder.mjs';

const generatedAt = '2026-08-18T00:00:00.000Z';

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-site-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const reader = join(root, 'reader');
  const data = join(root, 'data-release');
  const output = join(root, 'site');

  await mkdir(join(reader, 'assets'), { recursive: true });
  await writeFile(join(reader, 'index.html'), '<div id="root"></div>\n');
  await writeFile(join(reader, 'assets', 'app.fixture.js'), 'globalThis.readerLoaded = true;\n');
  await writeReaderManifest({ reader, kitVersion: '0.1.0' });

  await mkdir(join(data, 'data'), { recursive: true });
  await writeFile(join(data, 'data', 'catalog.json'), '{"schema":1}\n');
  await writeFile(join(data, 'data', 'search.json'), '{"schema":1}\n');
  await writeReleaseManifest({
    root: data,
    releaseId: 'knowledge-fixture',
    generatedAt,
  });
  return { root, reader, data, output };
}

test('site builder assembles only sealed Reader assets and generated knowledge data', async (t) => {
  const { reader, data, output } = await createFixture(t);
  const result = await buildSite({
    reader,
    data,
    output,
    releaseId: 'site-fixture',
    generatedAt,
    sourceCommit: '0123456789abcdef',
    kitVersion: '0.1.0',
  });

  assert.equal(result.metadata.releaseId, 'site-fixture');
  assert.match(await readFile(join(output, 'index.html'), 'utf8'), /id="root"/);
  assert.match(await readFile(join(output, 'assets', 'app.fixture.js'), 'utf8'), /readerLoaded/);
  assert.equal(await readFile(join(output, 'data', 'catalog.json'), 'utf8'), '{"schema":1}\n');
  assert.deepEqual(
    JSON.parse(await readFile(join(output, 'release-metadata.json'), 'utf8')),
    {
      schema: 1,
      releaseId: 'site-fixture',
      generatedAt,
      sourceCommit: '0123456789abcdef',
      kitVersion: '0.1.0',
    },
  );
  assert.equal(await verifyReleaseRoot(output), true);
});

test('site builder rejects unlisted Reader assets', async (t) => {
  const { reader, data, output } = await createFixture(t);
  await writeFile(join(reader, 'assets', 'extra.js'), 'not sealed\n');

  await assert.rejects(
    () => buildSite({
      reader,
      data,
      output,
      releaseId: 'site-fixture',
      generatedAt,
      sourceCommit: '0123456789abcdef',
      kitVersion: '0.1.0',
    }),
    /unlisted Reader file assets\/extra\.js/,
  );
});

test('site builder rejects tampered Reader assets', async (t) => {
  const { reader, data, output } = await createFixture(t);
  await writeFile(join(reader, 'assets', 'app.fixture.js'), 'globalThis.readerLoaded = false;\n');

  await assert.rejects(
    () => buildSite({
      reader,
      data,
      output,
      releaseId: 'site-fixture',
      generatedAt,
      sourceCommit: '0123456789abcdef',
      kitVersion: '0.1.0',
    }),
    /Reader (checksum mismatch|file size changed)/,
  );
});
