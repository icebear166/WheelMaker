import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildRelease } from './build.mjs';
import {
  githubAppCredentialsFromEnv,
  requestInstallationToken,
} from './github-app.mjs';
import { GitHubApi } from './github-api.mjs';
import { nextVersionFromStableBytes } from './metadata.mjs';
import { publishBuiltRelease } from './publish.mjs';

const execFileAsync = promisify(execFile);

export function parseReleaseArgs(args) {
  let publish = false;
  let withDesktop = false;
  for (const option of args) {
    if (option === '--with-desktop' && !withDesktop) {
      withDesktop = true;
      continue;
    }
    if (option === '--publish' && !publish) {
      publish = true;
      continue;
    }
    throw new Error(`unknown option: ${option}`);
  }
  return { publish, withDesktop };
}

export async function runRelease(options, deps) {
  const requireClean = options.publish;
  const sourceSha = await deps.resolveSourceSha({ requireClean });
  const version = await deps.resolveNextVersion();
  const startedAt = deps.now();

  const build = await deps.buildRelease({
    outputRoot: deps.outputRoot,
    repoRoot: deps.repoRoot,
    sourceSha,
    version,
    workRoot: deps.workRoot,
    withDesktop: options.withDesktop,
  });
  if (!options.publish) {
    return { build, mode: 'build', sourceSha };
  }

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
      version,
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
    workRoot: join(repoRoot, '.release-work'),
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
    now: () => new Date().toISOString(),
    publishBuiltRelease,
    async resolveNextVersion() {
      const stableUrl = new URL(
        channel.stablePath,
        `https://raw.githubusercontent.com/${channel.owner}/${channel.repository}/${channel.branch}/`,
      );
      const response = await fetchImpl(stableUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(
          `failed to query stable metadata: ${response.status} ${response.statusText}`,
        );
      }
      return nextVersionFromStableBytes(Buffer.from(await response.arrayBuffer()));
    },
    resolveSourceSha: (options) => resolveGitSourceSha(repoRoot, options),
  };
}
