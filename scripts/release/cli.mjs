import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

import {buildRelease} from './build.mjs';
import {acquireBuildLock} from './build-lock.mjs';
import {validateReleaseChannel} from './channel.mjs';
import {
  encodeJsonBytes,
  nextV1Version,
  nextVersionFromStableBytes,
  stableVersionFromBytes,
} from './metadata.mjs';
import {createReleaseProgress} from './progress.mjs';
import {
  createPublisherConfigDependencies,
  resolvePublisherToken,
} from './publisher-config.mjs';
import {
  packageBuiltRelease,
  publishBuiltRelease,
  ReleaseVersionConflictError,
} from './publish.mjs';
import {ReleaseServerApi} from './release-server-api.mjs';

const execFileAsync = promisify(execFile);

export function releaseBuildSummary(build) {
  return {
    androidApk: build.androidApkPath ?? null,
    desktopExe: build.desktopExePath ?? null,
    manifest: build.manifestPath,
    platforms: build.platforms.map(({archivePath, key}) => ({
      archive: archivePath,
      key,
    })),
    versionRoot: build.versionRoot,
  };
}

export function parseReleaseArgs(args) {
  let publish = false;
  let withAndroid = false;
  let withDesktop = false;
  for (const option of args) {
    if (option === '--with-desktop' && !withDesktop) {
      withDesktop = true;
    } else if (option === '--with-android' && !withAndroid) {
      withAndroid = true;
    } else if (option === '--publish' && !publish) {
      publish = true;
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  }
  return {publish, withAndroid, withDesktop};
}

function failureCode(phase, error) {
  if (error instanceof ReleaseVersionConflictError) return 'version_conflict';
  return {
    building: 'build_failed',
    committing: 'commit_failed',
    packaging: 'packaging_failed',
    uploading: 'upload_failed',
    validating: 'validation_failed',
  }[phase] ?? 'publish_failed';
}

async function failAndCancel(api, session, phase, error) {
  await api.status(session.sessionId, {
    errorCode: failureCode(phase, error),
    phase,
    state: 'failed',
  }).catch(() => {});
  await api.cancel(session.sessionId).catch(() => {});
}

export async function runRelease(options, deps) {
  const progress = deps.progress ?? {
    info() {},
    phase: (_label, action) => action(),
  };
  const sourceSha = await progress.phase(
    'Checking source',
    () => deps.resolveSourceSha({requireClean: options.publish}),
  );
  let floorVersion;
  let api;
  let deploymentSources;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await progress.phase(
      'Resolving release version',
      () => deps.resolveReleaseTarget({floorVersion}),
    );
    const {version} = target;
    if (options.publish && target.stable?.sourceSha === sourceSha) {
      progress.info(
        `Skipping publish: ${target.stable.version} already contains source ${sourceSha}`,
      );
      return {mode: 'publish', stable: target.stable, unchanged: true};
    }
    deploymentSources ??= await progress.phase(
      'Loading deployment scripts',
      () => deps.loadDeploymentSources(),
    );
    progress.info(
      `${options.publish ? 'Publishing' : 'Building'} ${version} from ${sourceSha}`,
    );

    if (options.publish && !api) {
      api = await progress.phase(
        'Authenticating release server',
        () => deps.createReleaseClient(),
      );
    }

    let currentPhase = 'building';
    let buildLock;
    let session;
    let stagingRoot;
    try {
      if (options.publish) {
        session = await progress.phase(
          'Starting release session',
          () => api.start({
            publisher: deps.publisher,
            sourceSha,
            version,
            withAndroid: options.withAndroid ?? false,
            withDesktop: options.withDesktop ?? false,
          }),
        );
        await api.status(session.sessionId, {
          phase: currentPhase,
          state: 'running',
        });
      }
      stagingRoot = await progress.phase(
        'Preparing release workspace',
        () => deps.createReleaseWorkspace(version),
      );
      buildLock = await deps.acquireBuildLock({
        owner: 'release',
        workRoot: deps.workRoot,
      });
      const build = await progress.phase(
        'Building release assets',
        () => deps.buildRelease({
          progress,
          repoRoot: deps.repoRoot,
          sourceSha,
          stagingRoot,
          version,
          workRoot: deps.workRoot,
          withAndroid: options.withAndroid ?? false,
          withDesktop: options.withDesktop ?? false,
        }),
      );

      currentPhase = 'packaging';
      if (session) {
        await api.status(session.sessionId, {
          phase: currentPhase,
          state: 'running',
        });
      }
      const publishedAt = session?.publishedAt ?? deps.now();
      const packaged = await progress.phase(
        'Packaging and verifying assets',
        () => deps.packageBuiltRelease({
          ...build,
          channel: deps.channel,
          coreBytes: deploymentSources.coreBytes,
          deployMjsBytes: deploymentSources.deployMjsBytes,
          outputRoot: deps.outputRoot,
          publishedAt,
          sourceSha,
          stagingRoot,
          version,
        }),
      );
      if (!options.publish) {
        return {build: packaged, mode: 'build', sourceSha};
      }

      currentPhase = 'uploading';
      const stable = await progress.phase(
        'Publishing release',
        () => deps.publishBuiltRelease({
          onPhase(phase) { currentPhase = phase; },
          packaged,
          progress,
          session,
          version,
        }, api),
      );
      return {mode: 'publish', stable};
    } catch (error) {
      if (error instanceof ReleaseVersionConflictError) {
        currentPhase = 'committing';
      }
      if (session) {
        await failAndCancel(api, session, currentPhase, error);
      }
      if (!(error instanceof ReleaseVersionConflictError) || attempt === 2) {
        throw error;
      }
      floorVersion = error.version;
    } finally {
      if (buildLock) {
        await buildLock.release();
      }
      if (stagingRoot) {
        await progress.phase(
          'Cleaning release workspace',
          () => deps.cleanupReleaseWorkspace(stagingRoot),
        );
      }
    }
  }
  throw new Error('release retry limit reached');
}

async function resolveGitSourceSha(repoRoot, {requireClean}) {
  if (requireClean) {
    const {stdout: status} = await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {cwd: repoRoot, encoding: 'utf8'},
    );
    if (status.trim()) {
      throw new Error('publish requires a clean Git worktree');
    }
  }
  const {stdout} = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const sourceSha = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`unexpected Git HEAD SHA: ${sourceSha}`);
  }
  return sourceSha;
}

export async function createDefaultReleaseDependencies({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(moduleDirectory, '..', '..');
  const channel = validateReleaseChannel(JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  ));
  const actions = env.GITHUB_ACTIONS === 'true';
  const anonymousApi = new ReleaseServerApi({
    baseUrl: channel.baseUrl,
    token: '',
  });

  return {
    acquireBuildLock,
    buildRelease,
    channel,
    async cleanupReleaseWorkspace(path) {
      await rm(path, {force: true, recursive: true});
    },
    outputRoot: join(repoRoot, '.release-out'),
    packageBuiltRelease,
    progress: createReleaseProgress({githubActions: actions}),
    publisher: actions ? 'action' : 'local',
    repoRoot,
    async createReleaseWorkspace(version) {
      const temporaryRoot = join(repoRoot, '.release-work', 'tmp');
      await mkdir(temporaryRoot, {recursive: true});
      return mkdtemp(join(temporaryRoot, `release-${version}-`));
    },
    workRoot: join(repoRoot, '.release-work'),
    async createReleaseClient() {
      const tokenDependencies = createPublisherConfigDependencies({
        baseUrl: channel.baseUrl,
        env,
        fetchImpl,
      });
      const token = await resolvePublisherToken({actions}, tokenDependencies);
      return new ReleaseServerApi({baseUrl: channel.baseUrl, token});
    },
    async loadDeploymentSources() {
      return {
        coreBytes: await readFile(join(repoRoot, 'scripts', 'deploy', 'deploy-core.mjs')),
        deployMjsBytes: await readFile(join(repoRoot, 'scripts', 'deploy', 'deploy.mjs')),
      };
    },
    now: () => new Date().toISOString(),
    publishBuiltRelease,
    async resolveReleaseTarget({floorVersion} = {}) {
      const stable = await anonymousApi.readStable();
      const stableBytes = stable ? encodeJsonBytes(stable) : null;
      if (!floorVersion) {
        return {stable, version: nextVersionFromStableBytes(stableBytes)};
      }
      if (!/^v1\.(0|[1-9]\d*)$/.test(floorVersion)) {
        throw new Error(`invalid release version floor: ${floorVersion}`);
      }
      const stableVersion = stableBytes
        ? stableVersionFromBytes(stableBytes)
        : 'v1.0';
      const stableNumber = Number(stableVersion.slice(3));
      const floorNumber = Number(floorVersion.slice(3));
      return {
        stable,
        version: nextV1Version(
          stableNumber > floorNumber ? stableVersion : floorVersion,
        ),
      };
    },
    resolveSourceSha: options => resolveGitSourceSha(repoRoot, options),
  };
}
