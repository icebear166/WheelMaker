import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import test from 'node:test';

import { buildRelease, RELEASE_TARGETS } from './build.mjs';
import { resolveCommand, runCommand } from './commands.mjs';

function recordingRunner() {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args: [...args], options });

    if (
      command === 'npm' &&
      args[0] === 'run' &&
      args[1] === 'build:web:release'
    ) {
      await mkdir(options.env.WHEELMAKER_WEB_TARGET, { recursive: true });
      await writeFile(
        join(options.env.WHEELMAKER_WEB_TARGET, 'index.html'),
        '<!doctype html>',
      );
    }

    if (command === 'go' && args[0] === 'build') {
      const outputPath = args[args.indexOf('-o') + 1];
      await mkdir(join(outputPath, '..'), { recursive: true });
      await writeFile(outputPath, basename(outputPath));
    }
  };

  runner.calls = calls;
  return runner;
}

test('release build compiles Web once and exactly three Hub targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-build-'));
  const repoRoot = join(root, 'repo');
  const outputRoot = join(root, 'out');
  const runner = recordingRunner();

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });

    await buildRelease({
      repoRoot,
      outputRoot,
      version: 'v1.7',
      withDesktop: false,
      runner,
    });

    const webBuilds = runner.calls.filter(
      ({ command, args }) =>
        command === 'npm' &&
        args[0] === 'run' &&
        args[1] === 'build:web:release',
    );
    assert.equal(webBuilds.length, 1);

    const hubTargets = runner.calls
      .filter(
        ({ command, args }) =>
          command === 'go' &&
          args.at(-1) === './cmd/wheelmaker',
      )
      .map(({ args, options }) => ({
        target: `${options.env.GOOS}/${options.env.GOARCH}`,
        binary: basename(args[args.indexOf('-o') + 1]),
      }));
    assert.deepEqual(hubTargets, [
      { target: 'windows/amd64', binary: 'wheelmaker.exe' },
      { target: 'linux/amd64', binary: 'wheelmaker' },
      { target: 'darwin/arm64', binary: 'wheelmaker' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('platform directories preserve the Hub and Web package layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-layout-'));
  const repoRoot = join(root, 'repo');
  const outputRoot = join(root, 'out');

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    const result = await buildRelease({
      repoRoot,
      outputRoot,
      version: 'v1.7',
      withDesktop: false,
      runner: recordingRunner(),
    });

    assert.deepEqual(
      result.platforms.map(({ key }) => key),
      RELEASE_TARGETS.map(({ key }) => key),
    );
    for (const platform of result.platforms) {
      const binary = RELEASE_TARGETS.find(({ key }) => key === platform.key).binary;
      assert.equal(
        await readExists(join(platform.directory, 'hub', binary)),
        true,
      );
      assert.equal(
        await readExists(join(platform.directory, 'web', 'index.html')),
        true,
      );
      assert.equal(
        await readExists(join(platform.directory, 'deploy-core.mjs')),
        false,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local build identifier matches the source-side output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-local-build-'));
  const repoRoot = join(root, 'repo');

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    const result = await buildRelease({
      repoRoot,
      outputRoot: join(root, 'out'),
      version: 'local-0123456789ab',
      runner: recordingRunner(),
    });

    assert.equal(basename(result.versionRoot), 'local-0123456789ab');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('optional Desktop is built once outside platform packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-desktop-build-'));
  const repoRoot = join(root, 'repo');
  const runner = recordingRunner();

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    const result = await buildRelease({
      repoRoot,
      outputRoot: join(root, 'out'),
      version: 'v1.8',
      withDesktop: true,
      runner,
    });

    assert.equal(await readExists(result.desktopExe), true);
    assert.equal(
      runner.calls.filter(
        ({ command, args }) =>
          command === 'go' && args.includes('github.com/tc-hib/go-winres@v0.3.3'),
      ).length,
      1,
    );
    for (const platform of result.platforms) {
      assert.equal(
        await readExists(join(platform.directory, 'WheelMakerDesktop.exe')),
        false,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows command resolution runs npm CLI through Node without a shell', () => {
  assert.deepEqual(resolveCommand('npm', 'win32', 'C:\\Node\\node.exe'), {
    args: ['C:\\Node\\node_modules\\npm\\bin\\npm-cli.js'],
    executable: 'C:\\Node\\node.exe',
  });
  assert.deepEqual(resolveCommand('npx', 'win32', 'C:\\Node\\node.exe'), {
    args: ['C:\\Node\\node_modules\\npm\\bin\\npx-cli.js'],
    executable: 'C:\\Node\\node.exe',
  });
  assert.deepEqual(resolveCommand('go', 'win32'), {
    args: [],
    executable: 'go',
  });
  assert.deepEqual(resolveCommand('npm', 'linux'), {
    args: [],
    executable: 'npm',
  });
});

test(
  'release runner executes the installed npm on Windows',
  { skip: process.platform !== 'win32' },
  async () => {
    await runCommand('npm', ['--version'], { cwd: process.cwd() });
  },
);

async function readExists(path) {
  try {
    await import('node:fs/promises').then(({ access }) => access(normalize(path)));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
