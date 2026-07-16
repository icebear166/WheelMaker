import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  encodeJsonBytes,
  nextV1Version,
  sha256Bytes,
  signBytes,
  verifyBytes,
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

function signatureBytes(bytes, privateKey) {
  return Buffer.from(`${signBytes(bytes, privateKey)}\n`, 'utf8');
}

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

async function readSignedStable(api, channel, publicKey) {
  const [stableFile, signatureFile] = await Promise.all([
    api.readFile(channel.stablePath, channel.branch),
    api.readFile(`${channel.stablePath}.sig`, channel.branch),
  ]);
  if (!stableFile && !signatureFile) {
    return null;
  }
  if (!stableFile || !signatureFile) {
    throw new Error('stable metadata is incomplete');
  }
  const signature = signatureFile.bytes.toString('utf8').trim();
  if (!verifyBytes(stableFile.bytes, signature, publicKey)) {
    throw new Error('stable signature is invalid');
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
  const manifestSignatureBytes = signatureBytes(
    manifestBytes,
    release.privateKey,
  );
  assets.push({ bytes: manifestBytes, name: 'release-manifest.json' });
  assets.push({
    bytes: manifestSignatureBytes,
    name: 'release-manifest.json.sig',
  });

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

  return { assets, desktopExe, manifestBytes };
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
  let version = 'v1.1';
  let draft = null;
  let releaseIsPublic = false;
  let previous = null;
  let floorVersion = 'v1.0';

  try {
    previous = await readSignedStable(api, release.channel, release.publicKey);
    version = nextCandidate(previous, floorVersion);
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
    let packaged = await packageAttempt(release, version);

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

    for (let attempt = 0; attempt < 3; attempt += 1) {
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
        if (!isTagCollision(error) || attempt === 2) {
          throw error;
        }
        floorVersion = version;
        previous = await readSignedStable(
          api,
          release.channel,
          release.publicKey,
        );
        version = nextCandidate(previous, floorVersion);
        currentPhase = 'packaging';
        await writeStatus(api, release, {
          phase: currentPhase,
          state: 'running',
          version,
        });
        packaged = await packageAttempt(release, version);
        continue;
      }

      for (const asset of packaged.assets) {
        await api.uploadReleaseAsset(draft, asset);
      }
      break;
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
      [
        { path: release.channel.stablePath, bytes: stableBytes },
        {
          path: `${release.channel.stablePath}.sig`,
          bytes: signatureBytes(stableBytes, release.privateKey),
        },
      ],
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
