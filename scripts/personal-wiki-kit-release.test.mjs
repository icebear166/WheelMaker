import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {releaseIdentity, runPersonalWikiKitRelease} from './personal-wiki-kit-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-kit-publish-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'personal-wiki-kit');
  const assetsDirectory = path.join(root, 'assets');
  const setupPath = path.join(kitRoot, 'setup-wiki.bat');
  await mkdir(kitRoot, {recursive: true});
  await mkdir(assetsDirectory, {recursive: true});
  await writeFile(path.join(kitRoot, 'kit.json'), '{"schema":1,"version":"0.1.0"}\n');
  await writeFile(setupPath, '@echo off\r\necho setup\r\n');
  for (const [platform, extension] of [['windows-x64', 'zip'], ['linux-x64', 'tar.gz']]) {
    const artifact = `personal-wiki-kit-v0.1.0-${platform}.${extension}`;
    const bytes = Buffer.from(`${platform} artifact\n`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(assetsDirectory, artifact), bytes);
    await writeFile(path.join(assetsDirectory, `personal-wiki-kit-v0.1.0-${platform}.lock.json`), `${JSON.stringify({schema: 1, version: '0.1.0', platform, artifact, sha256}, null, 2)}\n`);
  }
  return {root, kitRoot, assetsDirectory, setupPath};
}

function adapters(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      git: {
        assertClean: async () => calls.push(['clean']),
        head: async () => 'a'.repeat(40),
        ...overrides.git,
      },
      api: {
        readKitStable: async () => null,
        startKit: async value => {
          calls.push(['start', value]);
          return {schema: 1, sessionId: 'b'.repeat(32), version: value.version};
        },
        uploadKit: async (sessionId, asset) => calls.push(['upload', sessionId, asset]),
        commitKit: async sessionId => {
          calls.push(['commit', sessionId]);
          return {schema: 1, version: '0.1.0'};
        },
        cancelKit: async sessionId => calls.push(['cancel', sessionId]),
        ...overrides.api,
      },
    },
  };
}

test('Kit release identity maps an exact semantic version to the independent channel', () => {
  assert.deepEqual(releaseIdentity('0.1.0'), {version: '0.1.0'});
  assert.throws(() => releaseIdentity('latest'), /semantic version/u);
});

test('dry-run verifies setup and exact platform assets without opening a publish session', async (t) => {
  const paths = await fixture(t);
  const fake = adapters();
  const result = await runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root, dryRun: true}, fake.dependencies);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.version, '0.1.0');
  assert.deepEqual(result.assets.map(asset => asset.name).sort(), [
    'personal-wiki-kit-v0.1.0-linux-x64.tar.gz',
    'personal-wiki-kit-v0.1.0-windows-x64.zip',
    'setup-wiki.bat',
  ]);
  assert.equal(fake.calls.some(([kind]) => kind === 'start'), false);
});

test('publish refuses dirty source, an already stable version, and tampered assets', async (t) => {
  const paths = await fixture(t);
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters({git: {assertClean: async () => { throw new Error('dirty source'); }}}).dependencies), /dirty source/u);
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters({api: {readKitStable: async () => ({schema: 1, version: '0.1.0'})}}).dependencies), /already stable|newer/u);
  await writeFile(path.join(paths.assetsDirectory, 'personal-wiki-kit-v0.1.0-windows-x64.zip'), 'tampered');
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters().dependencies), /checksum mismatch/u);
});

test('publish uploads setup and both platforms then commits the Kit session', async (t) => {
  const paths = await fixture(t);
  const fake = adapters();
  const result = await runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, fake.dependencies);
  assert.equal(result.mode, 'published');
  assert.deepEqual(fake.calls.map(([kind]) => kind), ['clean', 'start', 'upload', 'upload', 'upload', 'commit']);
  assert.deepEqual(fake.calls.filter(([kind]) => kind === 'upload').map(([, , asset]) => asset.name).sort(), [
    'personal-wiki-kit-v0.1.0-linux-x64.tar.gz',
    'personal-wiki-kit-v0.1.0-windows-x64.zip',
    'setup-wiki.bat',
  ]);
  assert.equal(fake.calls.find(([kind]) => kind === 'start')[1].sourceSha, 'a'.repeat(40));
});

test('failed upload cancels the Kit session without committing', async (t) => {
  const paths = await fixture(t);
  let uploadCount = 0;
  const fake = adapters({api: {uploadKit: async () => {
    uploadCount += 1;
    if (uploadCount === 2) throw new Error('upload failed');
  }}});
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, fake.dependencies), /upload failed/u);
  assert.deepEqual(fake.calls.filter(([kind]) => kind === 'commit'), []);
  assert.deepEqual(fake.calls.filter(([kind]) => kind === 'cancel').map(([, sessionId]) => sessionId), ['b'.repeat(32)]);
});
