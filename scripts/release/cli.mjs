import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildRelease } from './build.mjs';
import {
  githubAppCredentialsFromEnv,
  requestInstallationToken,
} from './github-app.mjs';
import { GitHubApi } from './github-api.mjs';
import { publishBuiltRelease } from './publish.mjs';

const execFileAsync = promisify(execFile);

export function parseReleaseArgs(args) {
  const [mode, ...options] = args;
  if (mode !== 'build' && mode !== 'publish') {
    throw new Error('expected build or publish');
  }

  let withDesktop = false;
  for (const option of options) {
    if (option === '--with-desktop' && mode !== 'build') {
      throw new Error('--with-desktop is only valid with build');
    }
    if (option === '--with-desktop' && !withDesktop) {
      withDesktop = true;
      continue;
    }
    throw new Error(`unknown option: ${option}`);
  }
  return { mode, withDesktop };
}

export async function runRelease(options, deps) {
  const requireClean = options.mode === 'publish';
  const sourceSha = await deps.resolveSourceSha({ requireClean });
  const buildIdentifier = `local-${sourceSha.slice(0, 12)}`;
  const startedAt = deps.now();

  if (options.mode === 'build') {
    const cleanSource = await deps.isWorkingTreeClean();
    const build = await deps.buildRelease({
      outputRoot: deps.outputRoot,
      repoRoot: deps.repoRoot,
      version: buildIdentifier,
      withDesktop: options.withDesktop,
    });
    const recordedBuild = {
      ...build,
      desktopExe: build.desktopExe ?? null,
    };
    await deps.writeBuildRecord(buildIdentifier, {
      build: recordedBuild,
      cleanSource,
      createdAt: startedAt,
      desktopIncluded: Boolean(build.desktopExe),
      schema: 1,
      sourceSha,
    });
    return { build, mode: 'build', sourceSha };
  }

  const buildRecord = await deps.readBuildRecord(buildIdentifier);
  if (!buildRecord) {
    throw new Error(
      `local release build ${buildIdentifier} was not found; run build-release.bat first`,
    );
  }
  if (buildRecord.sourceSha !== sourceSha) {
    throw new Error('local release build does not match the current Git HEAD');
  }
  if (!buildRecord.cleanSource) {
    throw new Error(
      'the local release build was created from a dirty worktree; run build-release.bat from a clean worktree',
    );
  }

  const build = buildRecord.build;
  const api = await deps.createGitHubClient();
  const deploymentSources = deps.loadDeploymentSources
    ? await deps.loadDeploymentSources()
    : {
        coreBytes: deps.coreBytes,
        deployMjsBytes: deps.deployMjsBytes,
      };

  const stable = await deps.publishBuiltRelease(
    {
      channel: deps.channel,
      coreBytes: deploymentSources.coreBytes,
      deployMjsBytes: deploymentSources.deployMjsBytes,
      desktopExe: build.desktopExe,
      outputRoot: deps.outputRoot,
      platforms: build.platforms,
      publishedAt: deps.now(),
      publisher: deps.publisher,
      sourceSha,
      startedAt,
    },
    api,
  );
  return { mode: 'publish', stable };
}

async function resolveGitSourceSha(repoRoot, { requireClean }) {
  if (requireClean) {
    const { stdout: status } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (status.trim()) {
      throw new Error('publish requires a clean Git worktree');
    }
  }
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const sourceSha = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`unexpected Git HEAD SHA: ${sourceSha}`);
  }
  return sourceSha;
}

async function isGitWorkingTreeClean(repoRoot) {
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return !stdout.trim();
}

export async function resolvePublishingToken({
  env = process.env,
  execGh = execFileAsync,
  fetchImpl = fetch,
  requestAppToken = requestInstallationToken,
} = {}) {
  if (env.GITHUB_ACTIONS === 'true') {
    return requestAppToken({
      ...githubAppCredentialsFromEnv(env),
      fetchImpl,
    });
  }

  try {
    const { stdout } = await execGh('gh', ['auth', 'token'], {
      encoding: 'utf8',
    });
    const token = stdout.trim();
    if (!token) {
      throw new Error('GitHub CLI returned an empty token');
    }
    return token;
  } catch (error) {
    throw new Error(
      'local publishing requires GitHub CLI authentication; install GitHub CLI and run gh auth login first',
      { cause: error },
    );
  }
}

export async function createDefaultReleaseDependencies({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(moduleDirectory, '..', '..');
  const channel = JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  );

  return {
    buildRelease,
    channel,
    outputRoot: join(repoRoot, '.release-out'),
    publisher: env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    repoRoot,
    async createGitHubClient() {
      const token = await resolvePublishingToken({
        env,
        fetchImpl,
      });
      return new GitHubApi({
        branch: channel.branch,
        fetchImpl,
        owner: channel.owner,
        repository: channel.repository,
        token,
      });
    },
    async loadDeploymentSources() {
      return {
        coreBytes: await readFile(
          join(repoRoot, 'scripts', 'deploy', 'deploy-core.mjs'),
        ),
        deployMjsBytes: await readFile(
          join(repoRoot, 'scripts', 'deploy', 'deploy.mjs'),
        ),
      };
    },
    isWorkingTreeClean: () => isGitWorkingTreeClean(repoRoot),
    now: () => new Date().toISOString(),
    publishBuiltRelease,
    async readBuildRecord(version) {
      try {
        return JSON.parse(
          await readFile(join(repoRoot, '.release-out', version, 'build.json')),
        );
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    resolveSourceSha: (options) => resolveGitSourceSha(repoRoot, options),
    async writeBuildRecord(version, record) {
      await writeFile(
        join(repoRoot, '.release-out', version, 'build.json'),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    },
  };
}
