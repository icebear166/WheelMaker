import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {
  packageBuiltRelease,
  publishBuiltRelease,
  ReleaseVersionConflictError,
} from './publish.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const PUBLISHED_AT = '2026-07-17T09:00:00Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixtureRelease({withAndroid = false, withDesktop = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-publish-'));
  const platforms = [];
  for (const [key, binary] of [
    ['windows-amd64', 'wheelmaker.exe'],
    ['linux-amd64', 'wheelmaker'],
    ['darwin-amd64', 'wheelmaker'],
    ['darwin-arm64', 'wheelmaker'],
  ]) {
    const directory = join(root, key);
    await mkdir(join(directory, 'hub'), {recursive: true});
    await mkdir(join(directory, 'web'), {recursive: true});
    await writeFile(join(directory, 'hub', binary), `hub-${key}`);
    await writeFile(join(directory, 'web', 'index.html'), `web-${key}`);
    platforms.push({directory, key});
  }
  const release = {
    channel: {baseUrl: 'https://release.wheelmaker.top'},
    coreBytes: Buffer.from('export const core = true;\n'),
    deployMjsBytes: Buffer.from(
      "export const RELEASE_BASE_URL = '__WHEELMAKER_RELEASE_BASE_URL__';\n",
    ),
    outputRoot: join(root, 'output'),
    platforms,
    publishedAt: PUBLISHED_AT,
    sourceSha: SOURCE_SHA,
    stagingRoot: join(root, 'staging'),
    version: 'v1.1',
    cleanup: () => rm(root, {force: true, recursive: true}),
  };
  if (withDesktop) {
    release.desktopExe = join(root, 'WheelMakerDesktop.exe');
    await writeFile(release.desktopExe, 'desktop');
  }
  if (withAndroid) {
    const apkPath = join(root, 'WheelMakerAndroid.apk');
    const manifestPath = join(root, 'android-release.json');
    const apkBytes = Buffer.from('signed-android-apk');
    await writeFile(apkPath, apkBytes);
    await writeFile(manifestPath, `${JSON.stringify({
      apk: {
        fileName: 'WheelMakerAndroid.apk',
        sha256: sha256(apkBytes),
        size: apkBytes.length,
      },
      builtAt: PUBLISHED_AT,
      platform: 'android',
      schema: 1,
      signing: {certificateSha256: ['f'.repeat(64)]},
      sourceSha: SOURCE_SHA,
      version: 'v1.1',
      versionCode: 1,
      versionName: '1.1',
    }, null, 2)}\n`);
    release.androidApk = {apkPath, manifestPath};
  }
  return release;
}

test('packaging creates the exact schema 2 server directory and renders one launcher marker', async () => {
  const release = await fixtureRelease({withAndroid: true, withDesktop: true});
  try {
    const packaged = await packageBuiltRelease(release);
    assert.deepEqual((await readdir(packaged.versionRoot)).sort(), [
      'WheelMakerAndroid.apk',
      'WheelMakerDesktop.exe',
      'android-release.json',
      'deploy-core.mjs',
      'deploy.mjs',
      'release-manifest.json',
      'wheelmaker-v1.1-darwin-amd64.tar.zst',
      'wheelmaker-v1.1-darwin-arm64.tar.zst',
      'wheelmaker-v1.1-linux-amd64.tar.zst',
      'wheelmaker-v1.1-windows-amd64.tar.zst',
    ].sort());
    assert.equal(
      await readFile(join(packaged.versionRoot, 'deploy.mjs'), 'utf8'),
      "export const RELEASE_BASE_URL = 'https://release.wheelmaker.top';\n",
    );
    assert.deepEqual(
      await readFile(join(packaged.versionRoot, 'deploy-core.mjs')),
      release.coreBytes,
    );
    const manifest = JSON.parse(await readFile(packaged.manifestPath, 'utf8'));
    assert.equal(manifest.schema, 2);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(manifest.artifacts).map(([key, value]) => [key, value.path]),
      ),
      {
        'darwin-amd64': '/releases/v1.1/wheelmaker-v1.1-darwin-amd64.tar.zst',
        'darwin-arm64': '/releases/v1.1/wheelmaker-v1.1-darwin-arm64.tar.zst',
        'linux-amd64': '/releases/v1.1/wheelmaker-v1.1-linux-amd64.tar.zst',
        'windows-amd64': '/releases/v1.1/wheelmaker-v1.1-windows-amd64.tar.zst',
      },
    );
    assert.equal(packaged.assets.every(asset => !('bytes' in asset)), true);
    assert.equal(
      packaged.assets.every(asset => Number.isSafeInteger(asset.size) && /^[0-9a-f]{64}$/.test(asset.sha256)),
      true,
    );
  } finally {
    await release.cleanup();
  }
});

test('packaging rejects a launcher with zero or multiple render markers', async () => {
  const release = await fixtureRelease();
  try {
    release.deployMjsBytes = Buffer.from('no marker');
    await assert.rejects(packageBuiltRelease(release), /exactly one release base URL marker/i);
    release.deployMjsBytes = Buffer.from(
      '__WHEELMAKER_RELEASE_BASE_URL__ __WHEELMAKER_RELEASE_BASE_URL__',
    );
    await assert.rejects(packageBuiltRelease(release), /exactly one release base URL marker/i);
  } finally {
    await release.cleanup();
  }
});

test('publisher uploads every final file and commits only after all uploads', async () => {
  const release = await fixtureRelease();
  const packaged = await packageBuiltRelease(release);
  const events = [];
  const session = {sessionId: 'a'.repeat(32), version: 'v1.1', publishedAt: PUBLISHED_AT};
  const api = {
    async status(_sessionId, value) { events.push(`status:${value.phase}`); },
    async upload(_sessionId, asset, report) {
      events.push(`upload:${asset.name}`);
      report({done: true, uploadedBytes: asset.size, totalBytes: asset.size});
    },
    async commit() {
      events.push('commit');
      return {schema: 2, version: 'v1.1'};
    },
  };
  const progressEvents = [];
  try {
    const stable = await publishBuiltRelease({
      packaged,
      progress: {
        info(message) { progressEvents.push(message); },
        upload(name) {
          return update => progressEvents.push(`${name}:${update.uploadedBytes}`);
        },
      },
      session,
      version: 'v1.1',
    }, api);
    assert.equal(stable.version, 'v1.1');
    assert.equal(events[0], 'status:uploading');
    assert.equal(events.at(-2), 'status:committing');
    assert.equal(events.at(-1), 'commit');
    assert.deepEqual(
      events.filter(event => event.startsWith('upload:')).map(event => event.slice(7)).sort(),
      (await readdir(packaged.versionRoot)).sort(),
    );
    assert.equal(progressEvents.some(message => message.startsWith('deploy.mjs:')), true);
  } finally {
    await release.cleanup();
  }
});

test('commit conflict requests a full rebuild through a typed error', async () => {
  const error = Object.assign(new Error('conflict'), {status: 409});
  await assert.rejects(
    publishBuiltRelease({
      packaged: {assets: []},
      session: {sessionId: 'a'.repeat(32)},
      version: 'v1.7',
    }, {
      async status() {},
      async commit() { throw error; },
    }),
    failure => failure instanceof ReleaseVersionConflictError && failure.version === 'v1.7',
  );
});
