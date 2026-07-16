import { execFile, spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

function affirmative(answer) {
  return /^y(?:es)?$/i.test(answer.trim());
}

function releaseScriptPath(deps) {
  return relative(deps.repoRoot ?? process.cwd(), join(deps.repoRoot ?? process.cwd(), 'scripts', 'release.mjs'))
    .replaceAll('\\', '/');
}

async function runPublish(deps) {
  const withDesktop = affirmative(
    await deps.prompt('是否包含 WheelMaker Desktop？[y/N] '),
  );
  const withAndroid = affirmative(
    await deps.prompt('是否包含 WheelMaker Android APK？[y/N] '),
  );
  const publish = affirmative(
    await deps.prompt('是否发布到 public release 仓库？[y/N] '),
  );

  const args = [releaseScriptPath(deps)];
  if (withDesktop) args.push('--with-desktop');
  if (withAndroid) args.push('--with-android');
  if (publish) args.push('--publish');
  await deps.run(
    process.execPath,
    args,
    { cwd: deps.repoRoot },
  );
  return { publish, withAndroid, withDesktop };
}

async function runAction(deps) {
  const git = await deps.getGitContext();
  if (!git.branch || git.branch === 'HEAD') {
    throw new Error('GitHub Action publishing requires a checked-out branch');
  }
  if (!git.clean) {
    throw new Error('GitHub Action publishing requires a clean Git worktree');
  }
  if (!git.upstreamSha || git.upstreamSha !== git.head) {
    throw new Error('push the current commit first, then trigger the GitHub Action');
  }

  const withDesktop = affirmative(
    await deps.prompt('是否包含 WheelMaker Desktop？[y/N] '),
  );
  const withAndroid = affirmative(
    await deps.prompt('是否包含 WheelMaker Android APK？[y/N] '),
  );
  deps.write(`Workflow branch: ${git.branch}`);
  deps.write(`Source SHA: ${git.head}`);
  deps.write(`Desktop: ${withDesktop ? 'included' : 'not included'}`);
  deps.write(`Android: ${withAndroid ? 'included' : 'not included'}`);
  if (!affirmative(await deps.prompt('确认触发 GitHub Action？[y/N] '))) {
    deps.write('已取消触发。');
    return { cancelled: true, withAndroid, withDesktop };
  }

  await deps.run(
    'gh',
    [
      'workflow',
      'run',
      'publish-release.yml',
      '--ref',
      git.branch,
      '-f',
      `ref=${git.head}`,
      '-f',
      `with_desktop=${withDesktop}`,
      '-f',
      `with_android=${withAndroid}`,
    ],
    { cwd: deps.repoRoot },
  );
  return { cancelled: false, withAndroid, withDesktop };
}

export async function runReleaseEntry(mode, deps) {
  if (mode === 'publish') return runPublish(deps);
  if (mode === 'action') return runAction(deps);
  throw new Error(`unknown release entry mode: ${mode}`);
}

async function captureGit(repoRoot, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

function spawnInherited(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

export async function createDefaultEntryDependencies() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(moduleDirectory, '..', '..');
  const input = createInterface({ input: process.stdin, output: process.stdout });

  return {
    repoRoot,
    async getGitContext() {
      const [branch, head, status, upstreamSha] = await Promise.all([
        captureGit(repoRoot, ['branch', '--show-current']),
        captureGit(repoRoot, ['rev-parse', 'HEAD']),
        captureGit(repoRoot, ['status', '--porcelain', '--untracked-files=normal']),
        captureGit(repoRoot, ['rev-parse', '--verify', '@{u}'], {
          allowFailure: true,
        }),
      ]);
      return { branch, clean: status === '', head, upstreamSha };
    },
    prompt: (question) => input.question(question),
    run: spawnInherited,
    write(message) {
      process.stdout.write(`${message}\n`);
    },
    close() {
      input.close();
    },
  };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const deps = await createDefaultEntryDependencies();
  try {
    await runReleaseEntry(process.argv[2], deps);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    deps.close();
  }
}
