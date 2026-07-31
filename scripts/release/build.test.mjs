import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import test from 'node:test';

import { buildRelease, RELEASE_TARGETS } from './build.mjs';
import { resolveCommand, runCommand } from './commands.mjs';

function isGarbleCommand(command) {
  return /(^|[\\/])garble(?:\.exe)?$/.test(command);
}

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

    if (command === 'go' && args[0] === 'run' && args.includes('--out')) {
      const outputPath = args[args.indexOf('--out') + 1];
      await mkdir(join(outputPath, '..'), {recursive: true});
      await writeFile(outputPath, 'generated-resource');
    }
  };

  runner.calls = calls;
  return runner;
}

test('release build compiles Web once and exactly four Hub targets', async () => {
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
      }))
      .sort((left, right) => left.target.localeCompare(right.target));
    assert.deepEqual(hubTargets, [
      { target: 'darwin/amd64', binary: 'wheelmaker' },
      { target: 'darwin/arm64', binary: 'wheelmaker' },
      { target: 'linux/amd64', binary: 'wheelmaker' },
      { target: 'windows/amd64', binary: 'wheelmaker.exe' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release build uses native Go without installing or invoking Garble', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-native-go-build-'));
  const repoRoot = join(root, 'repo');
  const runner = recordingRunner();

  try {
    await mkdir(join(repoRoot, 'app'), {recursive: true});
    await mkdir(join(repoRoot, 'server'), {recursive: true});

    await buildRelease({
      repoRoot,
      runner,
      version: 'v1.85',
    });

    const nativeHubBuilds = runner.calls.filter(
      ({command, args}) =>
        command === 'go' &&
        args[0] === 'build' &&
        args.at(-1) === './cmd/wheelmaker',
    );
    assert.equal(nativeHubBuilds.length, RELEASE_TARGETS.length);
    assert.equal(
      runner.calls.some(({command}) => isGarbleCommand(command)),
      false,
    );
    assert.equal(
      runner.calls.some(
        ({command, args}) =>
          command === 'go' &&
          args[0] === 'install' &&
          args.some(arg => arg.startsWith('mvdan.cc/garble@')),
      ),
      false,
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('Windows Hub uses the GUI subsystem without changing Unix Hub builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-windows-gui-build-'));
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

    const hubBuilds = runner.calls.filter(
      ({ command, args }) =>
        command === 'go' && args.at(-1) === './cmd/wheelmaker',
    );
    const windowsBuild = hubBuilds.find(
      ({ options }) => options.env.GOOS === 'windows',
    );
    const unixBuilds = hubBuilds.filter(
      ({ options }) => options.env.GOOS !== 'windows',
    );

    assert.equal(windowsBuild.args.includes('-ldflags=-s -w -H windowsgui'), true);
    for (const build of unixBuilds) {
      assert.equal(build.args.includes('-ldflags=-s -w'), true);
      assert.equal(
        build.args.some((arg) => arg.startsWith('-ldflags=') && arg.includes('windowsgui')),
        false,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('platform directories preserve the Hub and Web package layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-layout-'));
  const repoRoot = join(root, 'repo');
  const outputRoot = join(root, 'out');
  const runner = recordingRunner();

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    const result = await buildRelease({
      repoRoot,
      outputRoot,
      version: 'v1.7',
      withDesktop: false,
      runner,
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

    for (const platform of result.platforms) {
      assert.equal(
        await readExists(join(platform.directory, 'desktop', 'update.exe')),
        false,
      );
    }
    const updaterBuilds = runner.calls.filter(
      ({command, args}) =>
        command === 'go' && args.at(-1) === './cmd/wheelmaker-desktop-updater',
    );
    assert.equal(updaterBuilds.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release build rejects the retired local source identifier', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-retired-local-build-'));
  const repoRoot = join(root, 'repo');

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    await assert.rejects(
      () => buildRelease({
        repoRoot,
        outputRoot: join(root, 'out'),
        version: 'local-0123456789ab',
        runner: recordingRunner(),
      }),
      /invalid release build identifier/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release build routes Webpack and Go caches through the work root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-release-cache-'));
  const repoRoot = join(root, 'repo');
  const workRoot = join(root, '.release-work');
  const runner = recordingRunner();

  try {
    await mkdir(join(repoRoot, 'app'), { recursive: true });
    await mkdir(join(repoRoot, 'server'), { recursive: true });
    await buildRelease({
      repoRoot,
      outputRoot: join(root, 'out'),
      version: 'v1.24',
      workRoot,
      runner,
    });

    const npmCalls = runner.calls.filter(({command}) => command === 'npm');
    const goCalls = runner.calls.filter(({command}) => command === 'go');
    assert.equal(npmCalls.length, 2);
    assert.equal(goCalls.length, 4);
    for (const call of npmCalls) {
      assert.equal(
        call.options.env.WHEELMAKER_WEBPACK_CACHE,
        join(workRoot, 'cache', 'webpack'),
      );
    }
    for (const call of goCalls) {
      assert.equal(call.options.env.GOCACHE, join(workRoot, 'cache', 'go-build'));
      assert.equal(call.options.env.GOMODCACHE, join(workRoot, 'cache', 'go-mod'));
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('release build keeps every unpacked asset inside its staging directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-release-staging-'));
  const repoRoot = join(root, 'repo');
  const outputRoot = join(root, '.release-out');
  const stagingRoot = join(root, '.release-work', 'tmp', 'release-v1.24-test');

  try {
    await mkdir(join(repoRoot, 'app'), {recursive: true});
    const desktopCommandRoot = join(
      repoRoot,
      'server',
      'cmd',
      'wheelmaker-desktop',
    );
    await mkdir(desktopCommandRoot, {recursive: true});
    await writeFile(
      join(desktopCommandRoot, 'desktop_windows.syso'),
      'stale-resource',
    );
    const result = await buildRelease({
      outputRoot,
      repoRoot,
      runner: recordingRunner(),
      stagingRoot,
      version: 'v1.24',
      workRoot: join(root, '.release-work'),
    });

    assert.equal(result.versionRoot, stagingRoot);
    for (const platform of result.platforms) {
      assert.equal(platform.directory.startsWith(stagingRoot), true);
    }
    assert.equal(await readExists(join(outputRoot, 'v1.24')), false);
    assert.equal(
      await readExists(join(desktopCommandRoot, 'desktop_windows.syso')),
      false,
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('release build reports Web and platform subtask progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-release-progress-'));
  const repoRoot = join(root, 'repo');
  const labels = [];

  try {
    await mkdir(join(repoRoot, 'app'), {recursive: true});
    await mkdir(join(repoRoot, 'server'), {recursive: true});
    await buildRelease({
      progress: {
        async task(label, action) {
          labels.push(label);
          return action();
        },
      },
      repoRoot,
      runner: recordingRunner(),
      stagingRoot: join(root, '.release-work', 'tmp', 'release-v1.24-test'),
      version: 'v1.24',
      workRoot: join(root, '.release-work'),
    });

    assert.deepEqual(labels.slice(0, 2), [
      'Installing Web dependencies',
      'Building Web',
    ]);
    assert.deepEqual(labels.slice(2).sort(), [
      'Building darwin-amd64',
      'Building darwin-arm64',
      'Building linux-amd64',
      'Building windows-amd64',
    ]);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('independent release compilation uses bounded concurrency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-release-concurrency-'));
  const repoRoot = join(root, 'repo');
  const baseRunner = recordingRunner();
  let activeBuilds = 0;
  let maximumBuilds = 0;

  try {
    await mkdir(join(repoRoot, 'app'), {recursive: true});
    await mkdir(join(repoRoot, 'server'), {recursive: true});
    await buildRelease({
      outputRoot: join(root, 'out'),
      repoRoot,
      runner: async (command, args, options) => {
        const isHubBuild =
          command === 'go' && args.at(-1) === './cmd/wheelmaker';
        if (!isHubBuild) return baseRunner(command, args, options);
        activeBuilds += 1;
        maximumBuilds = Math.max(maximumBuilds, activeBuilds);
        await new Promise(resolve => setTimeout(resolve, 10));
        try {
          return await baseRunner(command, args, options);
        } finally {
          activeBuilds -= 1;
        }
      },
      version: 'v1.24',
    });

    assert.equal(maximumBuilds > 1, true);
    assert.equal(maximumBuilds <= 3, true);
  } finally {
    await rm(root, {recursive: true, force: true});
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
    const desktopBuild = runner.calls.find(
      ({command, args}) =>
        command === 'go' && args.at(-1) === './cmd/wheelmaker-desktop',
    );
    assert.equal(
      desktopBuild.args.includes(
        '-ldflags=-s -w -H windowsgui -X main.desktopReleaseVersion=v1.8',
      ),
      true,
    );
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
    assert.equal(
      await readExists(
        join(
          repoRoot,
          'server',
          'cmd',
          'wheelmaker-desktop',
          'desktop_windows.syso',
        ),
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('optional Android is built once with the unified release identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-android-integration-'));
  const repoRoot = join(root, 'repo');
  const outputRoot = join(root, 'out');
  const workRoot = join(root, '.release-work');
  const androidCalls = [];

  try {
    await mkdir(join(repoRoot, 'app'), {recursive: true});
    await mkdir(join(repoRoot, 'server'), {recursive: true});
    const result = await buildRelease({
      androidBuilder: async input => {
        androidCalls.push(input);
        return {
          apkPath: join(input.outputDirectory, 'WheelMakerAndroid.apk'),
          manifestPath: join(input.outputDirectory, 'android-release.json'),
          sha256: 'a'.repeat(64),
          size: 123,
          versionCode: 24,
          versionName: '1.24',
        };
      },
      outputRoot,
      repoRoot,
      runner: recordingRunner(),
      sourceSha: '0123456789abcdef0123456789abcdef01234567',
      version: 'v1.24',
      withAndroid: true,
      workRoot,
    });

    assert.equal(androidCalls.length, 1);
    assert.deepEqual(
      {
        cacheRoot: androidCalls[0].cacheRoot,
        outputDirectory: androidCalls[0].outputDirectory,
        repoRoot: androidCalls[0].repoRoot,
        sourceSha: androidCalls[0].sourceSha,
        version: androidCalls[0].version,
        workRoot: androidCalls[0].workRoot,
      },
      {
        cacheRoot: join(workRoot, 'cache'),
        outputDirectory: join(workRoot, 'tmp', 'release-v1.24', 'android'),
        repoRoot,
        sourceSha: '0123456789abcdef0123456789abcdef01234567',
        version: 'v1.24',
        workRoot,
      },
    );
    assert.equal(result.androidApk.versionName, '1.24');
  } finally {
    await rm(root, {recursive: true, force: true});
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
  assert.deepEqual(
    resolveCommand('gradle', 'win32', 'C:\\Node\\node.exe', 'C:\\Windows\\cmd.exe'),
    {
      args: ['/d', '/s', '/c', 'gradle.cmd'],
      executable: 'C:\\Windows\\cmd.exe',
    },
  );
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
