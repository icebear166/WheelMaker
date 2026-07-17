import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';

import {encodeJsonBytes} from './metadata.mjs';
import {validateReleaseChannel, versionAssetPath} from './channel.mjs';
import {createTarGz} from './tar.mjs';

const RELEASE_BASE_URL_MARKER = '__WHEELMAKER_RELEASE_BASE_URL__';

function versionNumber(version) {
  const match = /^v1\.(0|[1-9]\d*)$/.exec(version ?? '');
  return match ? Number(match[1]) : -1;
}

function renderDeployLauncher(bytes, channel) {
  const source = Buffer.from(bytes).toString('utf8');
  const matches = source.split(RELEASE_BASE_URL_MARKER).length - 1;
  if (matches !== 1) {
    throw new Error('deploy.mjs must contain exactly one release base URL marker');
  }
  return Buffer.from(
    source.replace(RELEASE_BASE_URL_MARKER, validateReleaseChannel(channel).baseUrl),
    'utf8',
  );
}

async function inspectFile(path) {
  const info = await stat(path);
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = createReadStream(path);
    input.on('data', chunk => hash.update(chunk));
    input.once('error', reject);
    input.once('end', resolve);
  });
  return {sha256: hash.digest('hex'), size: info.size};
}

async function addAsset(assets, path, name) {
  assets.push({name, path, ...await inspectFile(path)});
}

function validateAndroidManifest(manifest, apk, release) {
  return (
    manifest?.schema === 1 &&
    manifest.platform === 'android' &&
    manifest.version === release.version &&
    manifest.versionName === release.version.slice(1) &&
    manifest.versionCode === versionNumber(release.version) &&
    manifest.sourceSha === release.sourceSha &&
    manifest.apk?.fileName === 'WheelMakerAndroid.apk' &&
    manifest.apk.sha256 === apk.sha256 &&
    manifest.apk.size === apk.size &&
    Array.isArray(manifest.signing?.certificateSha256) &&
    manifest.signing.certificateSha256.length > 0 &&
    manifest.signing.certificateSha256.every(digest => /^[0-9a-f]{64}$/.test(digest))
  );
}

export class ReleaseVersionConflictError extends Error {
  constructor(version, options) {
    super(`release version already exists: ${version}`, options);
    this.name = 'ReleaseVersionConflictError';
    this.version = version;
  }
}

export async function packageBuiltRelease(release) {
  if (versionNumber(release.version) < 1) {
    throw new Error(`invalid release version: ${release.version}`);
  }
  const versionRoot = join(release.outputRoot, release.version);
  const packageRoot = join(release.stagingRoot, 'final-assets');
  await rm(packageRoot, {force: true, recursive: true});
  await mkdir(packageRoot, {recursive: true});

  const assets = [];
  const artifacts = {};
  const platforms = [];
  for (const platform of release.platforms) {
    const name = `wheelmaker-${release.version}-${platform.key}.tar.gz`;
    const path = join(packageRoot, name);
    await createTarGz({sourceDir: platform.directory, outputPath: path});
    const identity = await inspectFile(path);
    artifacts[platform.key] = {
      path: versionAssetPath(release.version, name),
      ...identity,
    };
    assets.push({name, path, ...identity});
    platforms.push({archivePath: join(versionRoot, name), key: platform.key});
  }

  const deployMjsBytes = renderDeployLauncher(
    release.deployMjsBytes,
    release.channel,
  );
  const deployMjsPath = join(packageRoot, 'deploy.mjs');
  const corePath = join(packageRoot, 'deploy-core.mjs');
  await Promise.all([
    writeFile(deployMjsPath, deployMjsBytes),
    writeFile(corePath, release.coreBytes),
  ]);
  await addAsset(assets, deployMjsPath, 'deploy.mjs');
  await addAsset(assets, corePath, 'deploy-core.mjs');

  const manifest = {
    schema: 2,
    version: release.version,
    publishedAt: release.publishedAt,
    sourceSha: release.sourceSha,
    artifacts,
  };
  const manifestBytes = encodeJsonBytes(manifest);
  const manifestPath = join(packageRoot, 'release-manifest.json');
  await writeFile(manifestPath, manifestBytes);
  await addAsset(assets, manifestPath, 'release-manifest.json');

  let desktopExePath;
  if (release.desktopExe) {
    desktopExePath = join(packageRoot, 'WheelMakerDesktop.exe');
    await copyFile(release.desktopExe, desktopExePath);
    await addAsset(assets, desktopExePath, 'WheelMakerDesktop.exe');
  }

  let androidApkPath;
  let androidManifestPath;
  if (release.androidApk) {
    androidApkPath = join(packageRoot, 'WheelMakerAndroid.apk');
    androidManifestPath = join(packageRoot, 'android-release.json');
    await Promise.all([
      copyFile(release.androidApk.apkPath, androidApkPath),
      copyFile(release.androidApk.manifestPath, androidManifestPath),
    ]);
    const apk = await inspectFile(androidApkPath);
    let androidManifest;
    try {
      androidManifest = JSON.parse(await readFile(androidManifestPath, 'utf8'));
    } catch {
      throw new Error('Android release manifest is invalid');
    }
    if (!validateAndroidManifest(androidManifest, apk, release)) {
      throw new Error('Android release manifest does not match the built APK');
    }
    assets.push({name: 'WheelMakerAndroid.apk', path: androidApkPath, ...apk});
    await addAsset(assets, androidManifestPath, 'android-release.json');
  }

  await rm(versionRoot, {force: true, recursive: true});
  await mkdir(release.outputRoot, {recursive: true});
  await rename(packageRoot, versionRoot);
  for (const asset of assets) {
    asset.path = join(versionRoot, asset.name);
  }

  return {
    androidApkPath: androidApkPath ? join(versionRoot, 'WheelMakerAndroid.apk') : undefined,
    androidManifestPath: androidManifestPath ? join(versionRoot, 'android-release.json') : undefined,
    assets,
    desktopExePath: desktopExePath ? join(versionRoot, 'WheelMakerDesktop.exe') : undefined,
    manifestBytes,
    manifestPath: join(versionRoot, 'release-manifest.json'),
    platforms,
    version: release.version,
    versionRoot,
  };
}

export async function publishBuiltRelease(release, api) {
  const progress = release.progress ?? {info() {}};
  const sessionId = release.session?.sessionId;
  release.onPhase?.('uploading');
  await api.status(sessionId, {phase: 'uploading', state: 'running'});
  for (const [index, asset] of release.packaged.assets.entries()) {
    progress.info(
      `Uploading ${index + 1}/${release.packaged.assets.length} ${asset.name}`,
    );
    const report = progress.upload?.(asset.name) ?? (() => {});
    await api.upload(sessionId, asset, report);
  }
  release.onPhase?.('committing');
  await api.status(sessionId, {phase: 'committing', state: 'running'});
  try {
    return await api.commit(sessionId);
  } catch (error) {
    if (error?.status === 409) {
      throw new ReleaseVersionConflictError(release.version, {cause: error});
    }
    throw error;
  }
}
