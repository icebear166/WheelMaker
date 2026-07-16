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
    key: 'darwin-arm64',
    GOOS: 'darwin',
    GOARCH: 'arm64',
    binary: 'wheelmaker',
  },
]);

export async function buildRelease({
  androidBuilder = buildAndroidRelease,
  repoRoot,
  outputRoot,
  sourceSha,
  version,
  workRoot = join(repoRoot, '.release-work'),
  withDesktop = false,
  withAndroid = false,
  runner = runCommand,
}) {
  if (!/^v1\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`invalid release build identifier: ${version}`);
  }

  const appRoot = join(repoRoot, 'app');
  const serverRoot = join(repoRoot, 'server');
  const versionRoot = join(outputRoot, version);
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

  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(webSource, { recursive: true });
  await Promise.all([
    mkdir(buildEnvironment.GOCACHE, { recursive: true }),
    mkdir(buildEnvironment.GOMODCACHE, { recursive: true }),
    mkdir(webEnvironment.WHEELMAKER_WEBPACK_CACHE, { recursive: true }),
  ]);

  await runner('npm', ['ci', '--include=dev'], {
    cwd: appRoot,
    env: webEnvironment,
  });
  await runner('npm', ['run', 'build:web:release'], {
    cwd: appRoot,
    env: webEnvironment,
  });

  const platforms = [];
  for (const target of RELEASE_TARGETS) {
    const directory = join(
      versionRoot,
      `wheelmaker-${version}-${target.key}`,
    );
    const hubDirectory = join(directory, 'hub');
    const binaryPath = join(hubDirectory, target.binary);
    await mkdir(hubDirectory, { recursive: true });

    const buildArguments = ['build', '-trimpath'];
    if (target.GOOS === 'windows') {
      buildArguments.push('-ldflags=-H windowsgui');
    }
    buildArguments.push('-o', binaryPath, './cmd/wheelmaker');

    await runner(
      'go',
      buildArguments,
      {
        cwd: serverRoot,
        env: {
          CGO_ENABLED: '0',
          ...buildEnvironment,
          GOARCH: target.GOARCH,
          GOOS: target.GOOS,
        },
      },
    );
    await cp(webSource, join(directory, 'web'), { recursive: true });
    platforms.push({ ...target, directory, binaryPath });
  }

  let desktopExe;
  if (withDesktop) {
    const desktopCommandRoot = join(serverRoot, 'cmd', 'wheelmaker-desktop');
    const desktopDirectory = join(versionRoot, 'desktop');
    desktopExe = join(desktopDirectory, 'WheelMakerDesktop.exe');
    await mkdir(desktopDirectory, { recursive: true });

    await runner(
      'go',
      [
        'run',
        'github.com/tc-hib/go-winres@v0.3.3',
        'simply',
        '--arch',
        'amd64',
        '--out',
        join(desktopCommandRoot, 'desktop_windows.syso'),
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
        '-ldflags=-H windowsgui',
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
  }

  const androidApk = withAndroid
    ? await androidBuilder({
        cacheRoot,
        outputDirectory: join(versionRoot, 'android'),
        repoRoot,
        sourceSha,
        version,
        workRoot,
      })
    : undefined;

  return {
    androidApk,
    desktopExe,
    platforms,
    version,
    versionRoot,
    webSource,
  };
}
