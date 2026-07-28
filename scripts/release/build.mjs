import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runCommand } from './commands.mjs';
import { buildAndroidRelease } from './android.mjs';

export const RELEASE_TARGETS = Object.freeze([
  {
    key: 'windows-amd64',
    GOOS: 'windows',
    GOARCH: 'amd64',
    binary: 'wheelmaker.exe',
  },
  {
    key: 'linux-amd64',
    GOOS: 'linux',
    GOARCH: 'amd64',
    binary: 'wheelmaker',
  },
  {
    key: 'darwin-amd64',
    GOOS: 'darwin',
    GOARCH: 'amd64',
    binary: 'wheelmaker',
  },
  {
    key: 'darwin-arm64',
    GOOS: 'darwin',
    GOARCH: 'arm64',
    binary: 'wheelmaker',
  },
]);

export async function buildRelease({
  androidBuilder = buildAndroidRelease,
  progress,
  repoRoot,
  sourceSha,
  version,
  workRoot = join(repoRoot, '.release-work'),
  stagingRoot = join(workRoot, 'tmp', `release-${version}`),
  withDesktop = false,
  withAndroid = false,
  runner = runCommand,
}) {
  if (!/^v1\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`invalid release build identifier: ${version}`);
  }

  const appRoot = join(repoRoot, 'app');
  const serverRoot = join(repoRoot, 'server');
  const desktopCommandRoot = join(serverRoot, 'cmd', 'wheelmaker-desktop');
  const desktopResourcePath = join(
    desktopCommandRoot,
    'desktop_windows.syso',
  );
  const versionRoot = stagingRoot;
  const webSource = join(versionRoot, 'web-source');
  const cacheRoot = join(workRoot, 'cache');
  const buildEnvironment = {
    GOCACHE: join(cacheRoot, 'go-build'),
    GOMODCACHE: join(cacheRoot, 'go-mod'),
  };
  const webEnvironment = {
    WHEELMAKER_WEB_TARGET: webSource,
    WHEELMAKER_WEBPACK_CACHE: join(cacheRoot, 'webpack'),
  };
  const task = progress?.task
    ? (label, action) => progress.task(label, action)
    : (_label, action) => action();

  await rm(versionRoot, { recursive: true, force: true });
  await rm(desktopResourcePath, {force: true});
  await mkdir(webSource, { recursive: true });
  await Promise.all([
    mkdir(buildEnvironment.GOCACHE, { recursive: true }),
    mkdir(buildEnvironment.GOMODCACHE, { recursive: true }),
    mkdir(webEnvironment.WHEELMAKER_WEBPACK_CACHE, { recursive: true }),
  ]);

  await task('Installing Web dependencies', () =>
    runner('npm', ['ci', '--include=dev'], {
      cwd: appRoot,
      env: webEnvironment,
    }),
  );
  await task('Building Web', () =>
    runner('npm', ['run', 'build:web:release'], {
      cwd: appRoot,
      env: webEnvironment,
    }),
  );

  const platforms = Array(RELEASE_TARGETS.length);
  const jobs = [];
  let androidApk;
  let desktopExe;

  if (withAndroid) {
    jobs.push(() => task('Building Android', async () => {
      androidApk = await androidBuilder({
        cacheRoot,
        outputDirectory: join(versionRoot, 'android'),
        repoRoot,
        sourceSha,
        version,
        workRoot,
      });
    }));
  }

  RELEASE_TARGETS.forEach((target, index) => {
    jobs.push(() => task(`Building ${target.key}`, async () => {
      const directory = join(
        versionRoot,
        `wheelmaker-${version}-${target.key}`,
      );
      const hubDirectory = join(directory, 'hub');
      const binaryPath = join(hubDirectory, target.binary);
      await mkdir(hubDirectory, { recursive: true });

      const buildArguments = ['build', '-trimpath'];
      if (target.GOOS === 'windows') {
        buildArguments.push('-ldflags=-s -w -H windowsgui');
      } else {
        buildArguments.push('-ldflags=-s -w');
      }
      buildArguments.push('-o', binaryPath, './cmd/wheelmaker');

      await runner('go', buildArguments, {
        cwd: serverRoot,
        env: {
          CGO_ENABLED: '0',
          ...buildEnvironment,
          GOARCH: target.GOARCH,
          GOOS: target.GOOS,
        },
      });
      await cp(webSource, join(directory, 'web'), { recursive: true });
      platforms[index] = {...target, binaryPath, directory};
    }));
  });

  if (withDesktop) {
    jobs.push(() => task('Building Desktop', async () => {
      const desktopDirectory = join(versionRoot, 'desktop');
      desktopExe = join(desktopDirectory, 'WheelMakerDesktop.exe');
      await mkdir(desktopDirectory, { recursive: true });

      try {
        await runner(
          'go',
          [
            'run',
            'github.com/tc-hib/go-winres@v0.3.3',
            'simply',
            '--arch',
            'amd64',
            '--out',
            desktopResourcePath,
            '--no-suffix',
            '--manifest',
            'gui',
            '--icon',
            join(desktopCommandRoot, 'winres', 'icon.png'),
            '--file-description',
            'WheelMaker Desktop',
            '--product-name',
            'WheelMaker Desktop',
            '--original-filename',
            'WheelMakerDesktop.exe',
          ],
          { cwd: desktopCommandRoot, env: buildEnvironment },
        );
        await runner(
          'go',
          [
            'build',
            '-trimpath',
            '-ldflags=-s -w -H windowsgui',
            '-o',
            desktopExe,
            './cmd/wheelmaker-desktop',
          ],
          {
            cwd: serverRoot,
            env: {
              CGO_ENABLED: '0',
              ...buildEnvironment,
              GOARCH: 'amd64',
              GOOS: 'windows',
            },
          },
        );
      } finally {
        await rm(desktopResourcePath, {force: true});
      }
    }));
  }

  await runWithConcurrency(jobs, 3);

  return {
    androidApk,
    desktopExe,
    platforms,
    version,
    versionRoot,
    webSource,
  };
}

async function runWithConcurrency(jobs, limit) {
  let nextIndex = 0;
  let failure;
  async function worker() {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= jobs.length) return;
      try {
        await jobs[index]();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(
    Array.from({length: Math.min(limit, jobs.length)}, () => worker()),
  );
  if (failure) throw failure;
}
