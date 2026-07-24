import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function loadBootstrapModule() {
  try {
    return await import('./bootstrap-worktree.mjs');
  } catch {
    return {};
  }
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'wheelmaker-worktree-'));
  const appDir = join(repoRoot, 'app');
  await mkdir(appDir, { recursive: true });
  await writeFile(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true })
  );
  await writeFile(
    join(appDir, 'package-lock.json'),
    JSON.stringify({ name: 'fixture', lockfileVersion: 3 })
  );
  return { repoRoot, appDir };
}

const runtime = {
  node: 'v24.0.0',
  modules: '137',
  platform: 'win32',
  arch: 'x64',
};

test('bootstrap installs missing dependencies with the shared npm download cache', async () => {
  const { bootstrapWorktree } = await loadBootstrapModule();
  assert.equal(typeof bootstrapWorktree, 'function');

  const { repoRoot, appDir } = await createFixture();
  const calls = [];
  try {
    const result = await bootstrapWorktree({
      repoRoot,
      runtime,
      runNpm: async (call) => {
        calls.push(call);
        await mkdir(join(appDir, 'node_modules'), { recursive: true });
      },
    });

    assert.equal(result.installed, true);
    assert.deepEqual(calls, [
      {
        command: 'npm',
        args: [
          'ci',
          '--include=dev',
          '--prefer-offline',
          '--no-audit',
          '--no-fund',
        ],
        cwd: appDir,
      },
    ]);
    const marker = JSON.parse(
      await readFile(
        join(appDir, 'node_modules', '.wheelmaker-environment.json'),
        'utf8'
      )
    );
    assert.equal(marker.fingerprint, result.fingerprint);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('bootstrap skips npm when the worktree environment fingerprint matches', async () => {
  const { bootstrapWorktree } = await loadBootstrapModule();
  assert.equal(typeof bootstrapWorktree, 'function');

  const { repoRoot, appDir } = await createFixture();
  let calls = 0;
  const runNpm = async () => {
    calls += 1;
    await mkdir(join(appDir, 'node_modules'), { recursive: true });
  };
  try {
    await bootstrapWorktree({ repoRoot, runtime, runNpm });
    const result = await bootstrapWorktree({ repoRoot, runtime, runNpm });

    assert.equal(result.installed, false);
    assert.equal(calls, 1);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('bootstrap reinstalls when package-lock.json changes', async () => {
  const { bootstrapWorktree } = await loadBootstrapModule();
  assert.equal(typeof bootstrapWorktree, 'function');

  const { repoRoot, appDir } = await createFixture();
  let calls = 0;
  const runNpm = async () => {
    calls += 1;
    await mkdir(join(appDir, 'node_modules'), { recursive: true });
  };
  try {
    const first = await bootstrapWorktree({ repoRoot, runtime, runNpm });
    await writeFile(
      join(appDir, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        lockfileVersion: 3,
        packages: { 'node_modules/example': { version: '1.0.0' } },
      })
    );
    const second = await bootstrapWorktree({ repoRoot, runtime, runNpm });

    assert.notEqual(second.fingerprint, first.fingerprint);
    assert.equal(second.installed, true);
    assert.equal(calls, 2);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('bootstrap refuses to mutate a shared node_modules junction', async () => {
  const { bootstrapWorktree } = await loadBootstrapModule();
  assert.equal(typeof bootstrapWorktree, 'function');

  const { repoRoot, appDir } = await createFixture();
  const sharedModules = await mkdtemp(
    join(tmpdir(), 'wheelmaker-shared-modules-')
  );
  try {
    await symlink(
      sharedModules,
      join(appDir, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await assert.rejects(
      bootstrapWorktree({
        repoRoot,
        runtime,
        runNpm: async () => {
          throw new Error('npm must not run for a shared dependency directory');
        },
      }),
      /shared node_modules link/i
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(sharedModules, { recursive: true, force: true });
  }
});

test('Windows npm runs through node without a command shell', async () => {
  const { resolveNpmInvocation } = await loadBootstrapModule();
  assert.equal(typeof resolveNpmInvocation, 'function');

  assert.deepEqual(
    resolveNpmInvocation({
      platform: 'win32',
      execPath: 'C:\\Node\\node.exe',
    }),
    {
      command: 'C:\\Node\\node.exe',
      argsPrefix: ['C:\\Node\\node_modules\\npm\\bin\\npm-cli.js'],
    }
  );
});
