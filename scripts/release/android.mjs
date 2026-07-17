import {createHash} from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';

import {runCommand} from './commands.mjs';
import {encodeJsonBytes} from './metadata.mjs';

const CERTIFICATE_DIGEST_PATTERN =
  /certificate SHA-256 digest:\s*([0-9a-f]{64})/gi;

export async function buildAndroidRelease({
  apkSigner,
  cacheRoot,
  now = () => new Date().toISOString(),
  outputDirectory,
  repoRoot,
  runner = runCommand,
  sourceSha,
  version,
  workRoot,
}) {
  const versionMatch = /^v1\.([1-9]\d*)$/.exec(version ?? '');
  if (!versionMatch) {
    throw new Error(`invalid Android release version: ${version}`);
  }
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) {
    throw new Error('Android release source SHA must be a full Git commit SHA');
  }

  const versionCode = Number(versionMatch[1]);
  if (!Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000) {
    throw new Error(`invalid Android version code: ${versionMatch[1]}`);
  }
  const versionName = `1.${versionMatch[1]}`;
  const androidRoot = join(repoRoot, 'mobile', 'android');
  const temporaryRoot = join(workRoot, 'tmp', `android-${version}`);
  const assetsRoot = join(temporaryRoot, 'assets');
  const buildRoot = join(temporaryRoot, 'gradle-build');
  const gradleCacheRoot = join(cacheRoot, 'gradle');
  const gradleProjectCache = join(gradleCacheRoot, 'project');
  const gradleHome = join(gradleCacheRoot, 'home');
  const bootstrapSource = join(
    repoRoot,
    'server',
    'cmd',
    'wheelmaker-desktop',
    'bootstrap',
    'index.html',
  );
  const bootstrapTarget = join(assetsRoot, 'bootstrap', 'index.html');
  const finalApkPath = join(outputDirectory, 'WheelMakerAndroid.apk');
  const manifestPath = join(outputDirectory, 'android-release.json');
  let completed = false;

  await rm(temporaryRoot, {force: true, recursive: true});
  await rm(outputDirectory, {force: true, recursive: true});
  try {
    await Promise.all([
      mkdir(join(bootstrapTarget, '..'), {recursive: true}),
      mkdir(gradleHome, {recursive: true}),
      mkdir(gradleProjectCache, {recursive: true}),
    ]);
    await copyFile(bootstrapSource, bootstrapTarget);

    const signer = apkSigner ?? await resolveApkSigner();
    await runner(
      'gradle',
      [
        'assembleRelease',
        '--project-cache-dir',
        gradleProjectCache,
        '-g',
        gradleHome,
        `-PwheelmakerBuildRoot=${buildRoot}`,
        `-Pkotlin.project.persistent.dir=${join(temporaryRoot, 'kotlin')}`,
        `-PwheelmakerWebAssetsDir=${assetsRoot}`,
        `-PwheelmakerReleaseVersionName=${versionName}`,
        `-PwheelmakerReleaseVersionCode=${versionCode}`,
      ],
      {
        cwd: androidRoot,
        env: {GRADLE_USER_HOME: gradleHome},
      },
    );

    const builtApkPath = await findReleaseApk(buildRoot);
    await mkdir(outputDirectory, {recursive: true});
    await copyFile(builtApkPath, finalApkPath);

    const verification = await runner(
      signer.command,
      [...signer.args, 'verify', '--print-certs', finalApkPath],
      {captureOutput: true, cwd: androidRoot},
    );
    const certificateSha256 = certificateDigests(
      `${verification?.stdout ?? ''}\n${verification?.stderr ?? ''}`,
    );
    if (certificateSha256.length === 0) {
      throw new Error('APK signer certificate SHA-256 was not reported');
    }

    const apkBytes = await readFile(finalApkPath);
    const apkInfo = await stat(finalApkPath);
    const sha256 = createHash('sha256').update(apkBytes).digest('hex');
    const manifest = {
      apk: {
        fileName: 'WheelMakerAndroid.apk',
        sha256,
        size: apkInfo.size,
      },
      builtAt: now(),
      embeddedAsset: 'bootstrap/index.html',
      platform: 'android',
      schema: 1,
      signing: {certificateSha256},
      sourceSha,
      version,
      versionCode,
      versionName,
    };
    const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
    await writeFile(temporaryManifestPath, encodeJsonBytes(manifest));
    await rename(temporaryManifestPath, manifestPath);
    completed = true;
    return {
      apkPath: finalApkPath,
      certificateSha256,
      manifestPath,
      sha256,
      size: apkInfo.size,
      versionCode,
      versionName,
    };
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
    if (!completed) {
      await rm(outputDirectory, {force: true, recursive: true});
    }
  }
}

export async function resolveApkSigner({env = process.env} = {}) {
  const sdkRoots = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : '',
  ].filter(Boolean);

  for (const sdkRoot of [...new Set(sdkRoots)]) {
    const buildToolsRoot = join(sdkRoot, 'build-tools');
    let versions;
    try {
      versions = (await readdir(buildToolsRoot, {withFileTypes: true}))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, {numeric: true}));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const version of versions) {
      const jarPath = join(buildToolsRoot, version, 'lib', 'apksigner.jar');
      try {
        await access(jarPath);
        return {args: ['-jar', jarPath], command: 'java'};
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  throw new Error(
    'Android SDK Build Tools apksigner.jar was not found; set ANDROID_HOME or ANDROID_SDK_ROOT',
  );
}

async function findReleaseApk(buildRoot) {
  const expectedPath = join(
    buildRoot,
    'app',
    'outputs',
    'apk',
    'release',
    'app-release.apk',
  );
  try {
    await access(expectedPath);
    return expectedPath;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const candidates = [];
  await collectApks(buildRoot, candidates);
  const releaseCandidates = candidates.filter(path =>
    /[\\/]outputs[\\/]apk[\\/]release[\\/]/i.test(path),
  );
  if (releaseCandidates.length !== 1) {
    throw new Error(
      `expected one release APK under ${buildRoot}, found ${releaseCandidates.length}`,
    );
  }
  return releaseCandidates[0];
}

async function collectApks(directory, candidates) {
  let entries;
  try {
    entries = await readdir(directory, {withFileTypes: true});
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectApks(path, candidates);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk')) {
      candidates.push(path);
    }
  }
}

function certificateDigests(output) {
  return [
    ...new Set(
      [...output.matchAll(CERTIFICATE_DIGEST_PATTERN)].map(match =>
        match[1].toLowerCase(),
      ),
    ),
  ];
}
