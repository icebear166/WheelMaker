import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {runCommand} from './commands.mjs';

export const GARBLE_MODULE = 'mvdan.cc/garble';
export const GARBLE_VERSION = 'v0.17.0';

const RELEASE_FLAGS = Object.freeze(['-tiny']);
const DIAGNOSTIC_FLAGS = Object.freeze([]);

export const GO_CLIENT_PROFILES = Object.freeze({
  release: Object.freeze({garbleFlags: RELEASE_FLAGS}),
  diagnostic: Object.freeze({garbleFlags: DIAGNOSTIC_FLAGS}),
});

export function garbleExecutablePath(
  toolDirectory,
  hostPlatform = process.platform,
) {
  return join(
    toolDirectory,
    hostPlatform === 'win32' ? 'garble.exe' : 'garble',
  );
}

function profileFor(name) {
  const profile = GO_CLIENT_PROFILES[name];
  if (!profile) {
    throw new Error(`unknown Go client build profile: ${name}`);
  }
  return profile;
}

export async function ensureGarble({
  buildEnvironment,
  cacheRoot,
  runner = runCommand,
  serverRoot,
}) {
  const toolDirectory = join(cacheRoot, 'go-tools');
  await mkdir(toolDirectory, {recursive: true});
  const hostEnvironment = {...buildEnvironment};
  delete hostEnvironment.GOOS;
  delete hostEnvironment.GOARCH;
  const environment = {
    ...hostEnvironment,
    GOBIN: toolDirectory,
  };

  await runner(
    'go',
    ['install', `${GARBLE_MODULE}@${GARBLE_VERSION}`],
    {cwd: serverRoot, env: environment},
  );

  const executable = garbleExecutablePath(toolDirectory);
  const version = await runner(executable, ['version'], {
    captureOutput: true,
    cwd: serverRoot,
    env: hostEnvironment,
  });
  if (!version?.stdout?.includes(`mvdan.cc/garble ${GARBLE_VERSION}`)) {
    throw new Error(
      `Garble version verification failed: expected ${GARBLE_VERSION}`,
    );
  }
  return executable;
}

export function garbleBuildArguments({
  binaryPath,
  ldflags,
  packagePath,
  profile,
}) {
  return [
    ...profileFor(profile).garbleFlags,
    'build',
    '-trimpath',
    `-ldflags=${ldflags}`,
    '-o',
    binaryPath,
    packagePath,
  ];
}

export async function buildGoClient({
  binaryPath,
  buildEnvironment,
  garblePath,
  goarch,
  goos,
  ldflags,
  packagePath,
  profile,
  runner = runCommand,
  serverRoot,
}) {
  await runner(
    garblePath,
    garbleBuildArguments({binaryPath, ldflags, packagePath, profile}),
    {
      cwd: serverRoot,
      env: {
        CGO_ENABLED: '0',
        ...buildEnvironment,
        GOARCH: goarch,
        GOOS: goos,
      },
    },
  );
}
