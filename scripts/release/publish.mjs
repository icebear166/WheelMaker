import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  encodeJsonBytes,
  nextV1Version,
  sha256Bytes,
} from './metadata.mjs';
import { createTarGz } from './tar.mjs';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const PHASE_ERROR_CODES = Object.freeze({
  packaging: 'packaging_failed',
  'publishing-release': 'release_publish_failed',
  updating_stable: 'stable_update_failed',
  'updating-stable': 'stable_update_failed',
  uploading: 'asset_upload_failed',
  validating: 'validation_failed',
});

function releaseAssetUrl(channel, version, name) {
  return `https://github.com/${channel.owner}/${channel.repository}/releases/download/${version}/${encodeURIComponent(name)}`;
}

function rawScriptUrl(channel, commitSha, name) {
  return `https://raw.githubusercontent.com/${channel.owner}/${channel.repository}/${commitSha}/${name}`;
}

function versionNumber(version) {
  const match = /^v1\.(0|[1-9]\d*)$/.exec(version ?? '');
  return match ? Number(match[1]) : -1;
}

function nextCandidate(previous, floorVersion) {
  const previousVersion = previous?.version ?? 'v1.0';
  const base =
    versionNumber(floorVersion) > versionNumber(previousVersion)
      ? floorVersion
      : previousVersion;
  return nextV1Version(base);
}

async function readStable(api, channel) {
  const stableFile = await api.readFile(channel.stablePath, channel.branch);
  if (!stableFile) {
    return null;
  }
  const stable = JSON.parse(stableFile.bytes.toString('utf8'));
  if (stable.schema !== 1 || versionNumber(stable.version) < 0) {
    throw new Error('stable metadata schema is invalid');
  }
  return stable;
}

export function makeStable({ previous, release }) {
  const version = release.version ?? nextCandidate(previous);
  const stable = {
    schema: 1,
    version,
    publishedAt: release.publishedAt,
    sourceSha: release.sourceSha,
    deploy: release.deploy,
    release: {
      manifestUrl: release.manifest.url,
      manifestSha256: release.manifest.sha256,
    },
  };
  const desktopExe = release.desktopExe ?? previous?.desktopExe;
  if (desktopExe) {
    stable.desktopExe = desktopExe;
  }
  const androidApk = release.androidApk ?? previous?.androidApk;
  if (androidApk) {
    stable.androidApk = androidApk;
  }
  return stable;
}

async function packageAttempt(release, version) {
  const artifacts = {};
  const assets = [];
  for (const platform of release.platforms) {
    const name = `wheelmaker-${version}-${platform.key}.tar.gz`;
    const path = join(release.outputRoot, version, name);
    await createTarGz({ sourceDir: platform.directory, outputPath: path });
    const bytes = await readFile(path);
    const info = await stat(path);
    artifacts[platform.key] = {
      url: releaseAssetUrl(release.channel, version, name),
      sha256: sha256Bytes(bytes),
      size: info.size,
    };
    assets.push({ bytes, name });
  }

  const manifest = {
    schema: 1,
    version,
    publishedAt: release.publishedAt,
    sourceSha: release.sourceSha,
    artifacts,
  };
  const manifestBytes = encodeJsonBytes(manifest);
  assets.push({ bytes: manifestBytes, name: 'release-manifest.json' });

  let desktopExe;
  if (release.desktopExe) {
    const bytes = await readFile(release.desktopExe);
    assets.push({ bytes, name: 'WheelMakerDesktop.exe' });
    desktopExe = {
      version,
      url: releaseAssetUrl(
        release.channel,
        version,
        'WheelMakerDesktop.exe',
      ),
      sha256: sha256Bytes(bytes),
    };
  }

  let androidApk;
  if (release.androidApk) {
    const apkBytes = await readFile(release.androidApk.apkPath);
    const androidManifestBytes = await readFile(
      release.androidApk.manifestPath,
    );
    let androidManifest;
    try {
      androidManifest = JSON.parse(androidManifestBytes.toString('utf8'));
    } catch {
      throw new Error('Android release manifest is invalid');
    }
    const apkSha256 = sha256Bytes(apkBytes);
    if (
      androidManifest?.schema !== 1 ||
      androidManifest.platform !== 'android' ||
      androidManifest.version !== version ||
      androidManifest.versionName !== version.slice(1) ||
      androidManifest.versionCode !== versionNumber(version) ||
      androidManifest.sourceSha !== release.sourceSha ||
      androidManifest.apk?.fileName !== 'WheelMakerAndroid.apk' ||
      androidManifest.apk.sha256 !== apkSha256 ||
      androidManifest.apk.size !== apkBytes.length ||
      !Array.isArray(androidManifest.signing?.certificateSha256) ||
      androidManifest.signing.certificateSha256.length === 0 ||
      androidManifest.signing.certificateSha256.some(
        digest => !/^[0-9a-f]{64}$/.test(digest),
      )
    ) {
      throw new Error('Android release manifest does not match the built APK');
    }
    assets.push(
      {bytes: apkBytes, name: 'WheelMakerAndroid.apk'},
      {bytes: androidManifestBytes, name: 'android-release.json'},
    );
    androidApk = {
      publishedAt: release.publishedAt,
      sha256: apkSha256,
      size: apkBytes.length,
      sourceSha: release.sourceSha,
      url: releaseAssetUrl(
        release.channel,
        version,
        'WheelMakerAndroid.apk',
      ),
      version,
      versionCode: androidManifest.versionCode,
      versionName: androidManifest.versionName,
    };
  }

  return { androidApk, assets, desktopExe, manifestBytes };
}

async function cleanOldDrafts(api, nowMilliseconds) {
  const releases = await api.listReleases();
  for (const release of releases) {
    const createdAt = Date.parse(release.created_at ?? '');
    if (
      release.draft === true &&
      /^v1\.(0|[1-9]\d*)$/.test(release.tag_name ?? '') &&
      Number.isFinite(createdAt) &&
      nowMilliseconds - createdAt > TWO_HOURS_MS
    ) {
      await api.deleteRelease(release.id);
    }
  }
}

function isTagCollision(error) {
  return error?.status === 422;
}

export class ReleaseVersionConflictError extends Error {
  constructor(version, options) {
    super(`release version already exists: ${version}`, options);
    this.name = 'ReleaseVersionConflictError';
    this.version = version;
  }
}

function statusDocument(release, { errorCode, phase, state, version }) {
  const status = {
    schema: 1,
    state,
    phase,
    version,
    sourceSha: release.sourceSha,
    publisher: release.publisher,
    startedAt: release.startedAt,
    updatedAt: release.now?.() ?? new Date().toISOString(),
  };
  if (errorCode) {
    status.errorCode = errorCode;
  }
  return status;
}

async function writeStatus(api, release, status) {
  await api.writeFile(
    release.channel.publishStatusPath,
    encodeJsonBytes(statusDocument(release, status)),
    `chore: update release status (${status.phase})`,
    release.channel.branch,
  );
}

export async function publishBuiltRelease(release, api) {
  let currentPhase = 'validating';
  let version = release.version;
  let draft = null;
  let releaseIsPublic = false;
  let previous = null;

  try {
    if (versionNumber(version) < 1) {
      throw new Error(`invalid release version: ${version}`);
    }
    previous = await readStable(api, release.channel);
    if (versionNumber(previous?.version) >= versionNumber(version)) {
      throw new ReleaseVersionConflictError(version);
    }
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'running',
      version,
    });
    await cleanOldDrafts(api, Date.parse(release.startedAt));

    currentPhase = 'packaging';
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'running',
      version,
    });
    const packaged = await packageAttempt(release, version);

    const scriptCommit = await api.commitFiles(
      [
        { path: 'deploy.mjs', bytes: release.deployMjsBytes },
        { path: 'deploy-core.mjs', bytes: release.coreBytes },
      ],
      `chore: publish deployment scripts for ${version}`,
      release.channel.branch,
    );
    const deploy = {
      mjsUrl: rawScriptUrl(
        release.channel,
        scriptCommit.sha,
        'deploy.mjs',
      ),
      mjsSha256: sha256Bytes(release.deployMjsBytes),
      coreUrl: rawScriptUrl(
        release.channel,
        scriptCommit.sha,
        'deploy-core.mjs',
      ),
      coreSha256: sha256Bytes(release.coreBytes),
    };

    currentPhase = 'uploading';
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'running',
      version,
    });
    try {
      draft = await api.createRelease({
        draft: true,
        name: `WheelMaker ${version}`,
        prerelease: false,
        tag_name: version,
        target_commitish: scriptCommit.sha,
      });
    } catch (error) {
      if (isTagCollision(error)) {
        throw new ReleaseVersionConflictError(version, {cause: error});
      }
      throw error;
    }

    for (const asset of packaged.assets) {
      await api.uploadReleaseAsset(draft, asset);
    }

    currentPhase = 'publishing-release';
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'running',
      version,
    });
    await api.updateRelease(draft.id, { draft: false });
    releaseIsPublic = true;

    currentPhase = 'updating-stable';
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'running',
      version,
    });
    const stable = makeStable({
      previous,
      release: {
        deploy,
        androidApk: packaged.androidApk,
        desktopExe: packaged.desktopExe,
        manifest: {
          sha256: sha256Bytes(packaged.manifestBytes),
          url: releaseAssetUrl(
            release.channel,
            version,
            'release-manifest.json',
          ),
        },
        publishedAt: release.publishedAt,
        sourceSha: release.sourceSha,
        version,
      },
    });
    const stableBytes = encodeJsonBytes(stable);
    await api.commitFiles(
      [{ path: release.channel.stablePath, bytes: stableBytes }],
      `chore: publish stable ${version}`,
      release.channel.branch,
    );
    await writeStatus(api, release, {
      phase: currentPhase,
      state: 'succeeded',
      version,
    });
    return stable;
  } catch (error) {
    if (draft && !releaseIsPublic) {
      await api.deleteRelease(draft.id).catch(() => {});
    }
    const errorCode =
      currentPhase === 'uploading' && !draft
        ? 'release_create_failed'
        : PHASE_ERROR_CODES[currentPhase] ?? 'publish_failed';
    await writeStatus(api, release, {
      errorCode,
      phase: currentPhase,
      state: 'failed',
      version,
    }).catch(() => {});
    throw error;
  }
}
