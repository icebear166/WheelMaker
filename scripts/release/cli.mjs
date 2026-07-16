import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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

  let api;
  let signingMaterial;
  let deploymentSources;
  if (options.mode === 'publish') {
    signingMaterial = await deps.loadSigningMaterial();
    api = await deps.createGitHubClient();
    deploymentSources = deps.loadDeploymentSources
      ? await deps.loadDeploymentSources()
      : {
          coreBytes: deps.coreBytes,
          deployMjsBytes: deps.deployMjsBytes,
        };
  }

  const build = await deps.buildRelease({
    outputRoot: deps.outputRoot,
    repoRoot: deps.repoRoot,
    version: buildIdentifier,
    withDesktop: options.withDesktop,
  });
  if (options.mode === 'build') {
    return { build, mode: 'build', sourceSha };
  }

  const stable = await deps.publishBuiltRelease(
    {
      channel: deps.channel,
      coreBytes: deploymentSources.coreBytes,
      deployMjsBytes: deploymentSources.deployMjsBytes,
      desktopExe: build.desktopExe,
      outputRoot: deps.outputRoot,
      platforms: build.platforms,
      privateKey: signingMaterial.privateKey,
      publicKey: signingMaterial.publicKey,
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

function normalizePem(value) {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

async function loadSigningMaterial(repoRoot, env) {
  const privateKey = env.WHEELMAKER_SIGNING_PRIVATE_KEY
    ? normalizePem(env.WHEELMAKER_SIGNING_PRIVATE_KEY)
    : await readFile(
        join(
          homedir(),
          '.wheelmaker',
          'release-secrets',
          'signing-private.pem',
        ),
        'utf8',
      );
  const publicKey = await readFile(
    join(repoRoot, 'scripts', 'release', 'release-public-key.pem'),
    'utf8',
  );
  return { privateKey, publicKey };
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
      const credentials = githubAppCredentialsFromEnv(env);
      const token = await requestInstallationToken({
        ...credentials,
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
    loadSigningMaterial: () => loadSigningMaterial(repoRoot, env),
    now: () => new Date().toISOString(),
    publishBuiltRelease,
    resolveSourceSha: (options) => resolveGitSourceSha(repoRoot, options),
  };
}
