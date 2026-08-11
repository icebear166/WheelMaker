import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import test from 'node:test';

import {buildAndroidRelease} from './android.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const CERTIFICATE_SHA = 'a'.repeat(64);

test('shared Bootstrap exposes Localhost only through an explicit Desktop capability', async () => {
  const bootstrap = await readFile(
    join(process.cwd(), 'server', 'cmd', 'wheelmaker-desktop', 'bootstrap', 'index.html'),
    'utf8',
  );

  assert.match(bootstrap, /typeof window\.wheelMakerBootstrap\?\.selectLocalhost === 'function'/);
  assert.match(bootstrap, /typeof bridge\?\.postMessage === 'function'/);
  assert.match(bootstrap, /bootstrap\.selectLocalhost/);
  assert.match(bootstrap, /localhost-mode/);
});

test('android builder injects v1.x identity, verifies signing, and writes a portable manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-android-builder-'));
  const repoRoot = join(root, 'repo');
  const workRoot = join(root, '.release-work');
  const cacheRoot = join(workRoot, 'cache');
  const outputDirectory = join(root, 'out', 'v1.24', 'android');
  const calls = [];
  let embeddedBootstrap = '';

  try {
    await mkdir(
      join(repoRoot, 'server', 'cmd', 'wheelmaker-desktop', 'bootstrap'),
      {recursive: true},
    );
    await mkdir(join(repoRoot, 'mobile', 'android'), {recursive: true});
    await writeFile(
      join(repoRoot, 'server', 'cmd', 'wheelmaker-desktop', 'bootstrap', 'index.html'),
      '<!doctype html><title>bootstrap</title>',
    );

    const result = await buildAndroidRelease({
      apkSigner: {args: ['-jar', 'apksigner.jar'], command: 'java'},
      cacheRoot,
      now: () => '2026-07-17T00:00:00.000Z',
      outputDirectory,
      repoRoot,
      runner: async (command, args, options) => {
        calls.push({args: [...args], command, options});
        if (command === 'gradle') {
          const buildRoot = args
            .find(argument => argument.startsWith('-PwheelmakerBuildRoot='))
            .slice('-PwheelmakerBuildRoot='.length);
          const assetsRoot = args
            .find(argument => argument.startsWith('-PwheelmakerWebAssetsDir='))
            .slice('-PwheelmakerWebAssetsDir='.length);
          embeddedBootstrap = await readFile(
            join(assetsRoot, 'bootstrap', 'index.html'),
            'utf8',
          );
          const apkPath = join(buildRoot, 'app', 'outputs', 'apk', 'release', 'app-release.apk');
          await mkdir(join(apkPath, '..'), {recursive: true});
          await writeFile(apkPath, 'signed-apk-bytes');
          return undefined;
        }
        if (command === 'java') {
          return {
            stdout: `Signer #1 certificate SHA-256 digest: ${CERTIFICATE_SHA}\n`,
          };
        }
        throw new Error(`unexpected command: ${command}`);
      },
      sourceSha: SOURCE_SHA,
      version: 'v1.24',
      workRoot,
    });

    assert.equal(result.versionName, '1.24');
    assert.equal(result.versionCode, 24);
    assert.equal(basename(result.apkPath), 'WheelMakerAndroid.apk');
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.size, Buffer.byteLength('signed-apk-bytes'));
    assert.deepEqual(result.certificateSha256, [CERTIFICATE_SHA]);
    assert.match(embeddedBootstrap, /bootstrap/);

    const gradleCall = calls.find(({command}) => command === 'gradle');
    assert.deepEqual(gradleCall.args.slice(0, 5), [
      'assembleRelease',
      '--project-cache-dir',
      join(cacheRoot, 'gradle', 'project'),
      '-g',
      join(cacheRoot, 'gradle', 'home'),
    ]);
    assert.equal(
      gradleCall.args.includes('-PwheelmakerReleaseVersionName=1.24'),
      true,
    );
    assert.equal(
      gradleCall.args.includes('-PwheelmakerReleaseVersionCode=24'),
      true,
    );
    assert.equal(
      gradleCall.options.env.GRADLE_USER_HOME,
      join(cacheRoot, 'gradle', 'home'),
    );

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    assert.deepEqual(manifest, {
      apk: {
        fileName: 'WheelMakerAndroid.apk',
        sha256: result.sha256,
        size: result.size,
      },
      builtAt: '2026-07-17T00:00:00.000Z',
      embeddedAsset: 'bootstrap/index.html',
      platform: 'android',
      schema: 1,
      signing: {certificateSha256: [CERTIFICATE_SHA]},
      sourceSha: SOURCE_SHA,
      version: 'v1.24',
      versionCode: 24,
      versionName: '1.24',
    });
    assert.equal(await exists(join(workRoot, 'tmp', 'android-v1.24')), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('android builder removes temporary and partial output after failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-android-failure-'));
  const repoRoot = join(root, 'repo');
  const workRoot = join(root, '.release-work');
  const outputDirectory = join(root, 'out', 'v1.24', 'android');

  try {
    await mkdir(
      join(repoRoot, 'server', 'cmd', 'wheelmaker-desktop', 'bootstrap'),
      {recursive: true},
    );
    await mkdir(join(repoRoot, 'mobile', 'android'), {recursive: true});
    await writeFile(
      join(repoRoot, 'server', 'cmd', 'wheelmaker-desktop', 'bootstrap', 'index.html'),
      'bootstrap',
    );

    await assert.rejects(
      () => buildAndroidRelease({
        apkSigner: {args: [], command: 'java'},
        cacheRoot: join(workRoot, 'cache'),
        outputDirectory,
        repoRoot,
        runner: async () => {
          throw new Error('Gradle failed');
        },
        sourceSha: SOURCE_SHA,
        version: 'v1.24',
        workRoot,
      }),
      /Gradle failed/,
    );
    assert.equal(await exists(join(workRoot, 'tmp', 'android-v1.24')), false);
    assert.equal(await exists(outputDirectory), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
