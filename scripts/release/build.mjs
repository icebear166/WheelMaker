import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runCommand } from './commands.mjs';

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
  repoRoot,
  outputRoot,
  version,
  withDesktop = false,
  runner = runCommand,
}) {
  if (
    !/^v1\.(0|[1-9]\d*)$/.test(version) &&
    !/^local-[0-9a-f]{7,40}$/.test(version)
  ) {
    throw new Error(`invalid release build identifier: ${version}`);
  }

  const appRoot = join(repoRoot, 'app');
  const serverRoot = join(repoRoot, 'server');
  const versionRoot = join(outputRoot, version);
  const webSource = join(versionRoot, 'web-source');

  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(webSource, { recursive: true });

  await runner('npm', ['ci', '--include=dev'], {
    cwd: appRoot,
    env: { WHEELMAKER_WEB_TARGET: webSource },
  });
  await runner('npm', ['run', 'build:web:release'], {
    cwd: appRoot,
    env: { WHEELMAKER_WEB_TARGET: webSource },
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

    await runner(
      'go',
      ['build', '-trimpath', '-o', binaryPath, './cmd/wheelmaker'],
      {
        cwd: serverRoot,
        env: {
          CGO_ENABLED: '0',
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
      { cwd: desktopCommandRoot, env: {} },
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
        env: { CGO_ENABLED: '0', GOARCH: 'amd64', GOOS: 'windows' },
      },
    );
  }

  return { desktopExe, platforms, version, versionRoot, webSource };
}
