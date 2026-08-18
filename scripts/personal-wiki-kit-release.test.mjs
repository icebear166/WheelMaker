import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {releaseIdentity, runPersonalWikiKitRelease} from './personal-wiki-kit-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-kit-publish-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const kitRoot = path.join(root, 'personal-wiki-kit');
  const assetsDirectory = path.join(root, 'assets');
  await mkdir(kitRoot, {recursive: true});
  await mkdir(assetsDirectory, {recursive: true});
  await writeFile(path.join(kitRoot, 'kit.json'), '{"schema":1,"version":"0.1.0"}\n');
  for (const [platform, extension] of [['windows-x64', 'zip'], ['linux-x64', 'tar.gz']]) {
    const artifact = `personal-wiki-kit-v0.1.0-${platform}.${extension}`;
    const bytes = Buffer.from(`${platform} artifact\n`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(assetsDirectory, artifact), bytes);
    await writeFile(path.join(assetsDirectory, `personal-wiki-kit-v0.1.0-${platform}.lock.json`), `${JSON.stringify({schema: 1, version: '0.1.0', platform, artifact, sha256}, null, 2)}\n`);
  }
  return {root, kitRoot, assetsDirectory};
}

function adapters(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      git: {
        assertClean: async () => calls.push(['clean']),
        head: async () => 'a'.repeat(40),
        tagExists: async () => false,
        ...overrides.git,
      },
      github: {
        releaseExists: async () => false,
        createRelease: async (value) => calls.push(['release', value]),
        ...overrides.github,
      },
    },
  };
}

test('Kit release identity maps an exact version to an independent tag', () => {
  assert.deepEqual(releaseIdentity('0.1.0'), {version: '0.1.0', tag: 'personal-wiki-kit-v0.1.0'});
  assert.throws(() => releaseIdentity('latest'), /semantic version/u);
});

test('dry-run verifies exact assets and writes a checksum descriptor without publishing', async (t) => {
  const paths = await fixture(t);
  const fake = adapters();
  const result = await runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root, dryRun: true}, fake.dependencies);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.tag, 'personal-wiki-kit-v0.1.0');
  assert.equal(fake.calls.some(([kind]) => kind === 'release'), false);
  const descriptor = JSON.parse(await readFile(result.descriptor, 'utf8'));
  assert.deepEqual(Object.keys(descriptor.artifacts), ['linux-x64', 'windows-x64']);
  assert.ok(Object.values(descriptor.artifacts).every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256)));
});

test('publish refuses dirty source, duplicate tags, and tampered assets', async (t) => {
  const paths = await fixture(t);
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters({git: {assertClean: async () => { throw new Error('dirty source'); }}}).dependencies), /dirty source/u);
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters({git: {tagExists: async () => true}}).dependencies), /tag already exists/u);
  await writeFile(path.join(paths.assetsDirectory, 'personal-wiki-kit-v0.1.0-windows-x64.zip'), 'tampered');
  await assert.rejects(() => runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, adapters().dependencies), /checksum mismatch/u);
});

test('publish creates one GitHub release with both platform artifacts and locks', async (t) => {
  const paths = await fixture(t);
  const fake = adapters();
  const result = await runPersonalWikiKitRelease({...paths, repositoryRoot: paths.root}, fake.dependencies);
  assert.equal(result.mode, 'published');
  const release = fake.calls.find(([kind]) => kind === 'release')?.[1];
  assert.equal(release.tag, 'personal-wiki-kit-v0.1.0');
  assert.equal(release.target, 'a'.repeat(40));
  assert.deepEqual(release.assets.map((filename) => path.basename(filename)).sort(), [
    'personal-wiki-kit-v0.1.0-linux-x64.lock.json',
    'personal-wiki-kit-v0.1.0-linux-x64.tar.gz',
    'personal-wiki-kit-v0.1.0-windows-x64.lock.json',
    'personal-wiki-kit-v0.1.0-windows-x64.zip',
    'personal-wiki-kit-v0.1.0.lock.json',
  ]);
});

test('dedicated workflow has only Kit release authority and no WheelMaker publisher token', async () => {
  const workflow = await readFile(path.resolve(import.meta.dirname, '..', '.github', 'workflows', 'publish-personal-wiki-kit.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /windows-x64/u);
  assert.match(workflow, /linux-x64/u);
  assert.match(workflow, /contents: write/u);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_TOKEN|release\.wheelmaker\.top/u);
});
