import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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

async function runBuild(deps) {
  const withDesktop = affirmative(
    await deps.prompt('是否包含 WheelMaker Desktop？[y/N] '),
  );
  const args = [releaseScriptPath(deps), 'build'];
  if (withDesktop) args.push('--with-desktop');
  await deps.run(process.execPath, args, { cwd: deps.repoRoot });
  return { cancelled: false, withDesktop };
}

async function runPublish(deps) {
  const git = await deps.getGitContext();
  const record = await deps.readBuildRecord(git.head);
  if (!record) {
    throw new Error('local release build was not found; run build-release.bat first');
  }
  if (record.sourceSha !== git.head) {
    throw new Error('local release build does not match the current Git HEAD; run build-release.bat first');
  }
  if (!record.cleanSource) {
    throw new Error('local release build was created from a dirty worktree; run build-release.bat again from a clean worktree');
  }
  if (!git.clean) {
    throw new Error('publish requires a clean Git worktree');
  }

  deps.write(`Release repository: ${deps.channel.owner}/${deps.channel.repository}`);
  deps.write(`Source: ${git.branch} @ ${git.head}`);
  deps.write(`Desktop: ${record.build?.desktopExe ? 'included' : 'not included'}`);
  deps.write(
    `Platforms: ${(record.build?.platforms ?? []).map(({ key }) => key).join(', ')}`,
  );
  if (!affirmative(await deps.prompt('确认正式发布？[y/N] '))) {
    deps.write('已取消发布。');
    return { cancelled: true };
  }

  await deps.run(
    process.execPath,
    [releaseScriptPath(deps), 'publish'],
    { cwd: deps.repoRoot },
  );
  return { cancelled: false };
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
  deps.write(`Workflow branch: ${git.branch}`);
  deps.write(`Source SHA: ${git.head}`);
  deps.write(`Desktop: ${withDesktop ? 'included' : 'not included'}`);
  if (!affirmative(await deps.prompt('确认触发 GitHub Action？[y/N] '))) {
    deps.write('已取消触发。');
    return { cancelled: true, withDesktop };
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
    ],
    { cwd: deps.repoRoot },
  );
  return { cancelled: false, withDesktop };
}

export async function runReleaseEntry(mode, deps) {
  if (mode === 'build') return runBuild(deps);
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
  const channel = JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  );
  const input = createInterface({ input: process.stdin, output: process.stdout });

  return {
    channel,
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
    async readBuildRecord(head) {
      try {
        return JSON.parse(
          await readFile(
            join(repoRoot, '.release-out', `local-${head.slice(0, 12)}`, 'build.json'),
            'utf8',
          ),
        );
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
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
