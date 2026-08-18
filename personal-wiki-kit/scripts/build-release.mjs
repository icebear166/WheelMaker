import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {chmod, cp, lstat, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {collectArchiveEntries, writeTarGzArchive, writeZipArchive} from './archive.mjs';

const execFileAsync = promisify(execFile);
const PLATFORMS = new Map([
  ['windows-x64', {os: 'win32', goos: 'windows', goarch: 'amd64', runtime: 'runtime/node.exe', server: 'bin/wiki-server.exe', archive: 'zip'}],
  ['linux-x64', {os: 'linux', goos: 'linux', goarch: 'amd64', runtime: 'runtime/bin/node', server: 'bin/wiki-server', archive: 'tar.gz'}],
  ['linux-arm64', {os: 'linux', goos: 'linux', goarch: 'arm64', runtime: 'runtime/bin/node', server: 'bin/wiki-server', archive: 'tar.gz'}],
]);
const MANIFEST = 'release-files.json';
const COPY_PATHS = ['README.md', 'deployment', 'kit.json', 'package.json', 'package-lock.json', 'schema', 'skills', 'src', 'templates'];

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function exists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function copyRequired(source, destination, {excludeGenerated = false} = {}) {
  if (!await exists(source)) throw new Error(`release input is missing ${source}`);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`release input is a symbolic link ${source}`);
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination, {
    recursive: info.isDirectory(),
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
    filter: excludeGenerated
      ? (candidate) => !path.relative(source, candidate).split(path.sep)
        .some((segment) => segment === '.git' || segment === '.wiki-kit-out' || segment === 'coverage')
      : undefined,
  });
}

async function assertEmptyDestination(destination) {
  if (!await exists(destination)) {
    await mkdir(destination, {recursive: true});
    return;
  }
  const info = await lstat(destination);
  if (!info.isDirectory() || (await readdir(destination)).length > 0) throw new Error(`release destination must be an empty new directory: ${destination}`);
}

async function copyProductionDependencies(kitRoot, destination) {
  const lock = JSON.parse(await readFile(path.join(kitRoot, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') throw new Error('package-lock.json must use lockfileVersion 3');
  for (const [relative, descriptor] of Object.entries(lock.packages).sort(([left], [right]) => compareText(left, right))) {
    if (!relative.startsWith('node_modules/') || descriptor.dev === true) continue;
    const segments = relative.split('/');
    const topLevelLength = segments[1]?.startsWith('@') ? 3 : 2;
    if (segments.length !== topLevelLength) continue;
    const source = path.join(kitRoot, relative.split('/').join(path.sep));
    if (!await exists(source)) {
      if (descriptor.optional === true) continue;
      throw new Error(`installed production dependency is missing ${relative}`);
    }
    await copyRequired(source, path.join(destination, relative.split('/').join(path.sep)));
  }
}

function launcherText(platform) {
  if (platform.startsWith('windows-')) return '@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0src\\cli.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n';
  return '#!/bin/sh\nset -eu\nKIT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$KIT_ROOT/runtime/bin/node" "$KIT_ROOT/src/cli.mjs" "$@"\n';
}

function setupLauncherText(platform) {
  if (platform.startsWith('windows-')) return '@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0src\\cli.mjs" setup %*\r\nexit /b %ERRORLEVEL%\r\n';
  return '#!/bin/sh\nset -eu\nKIT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$KIT_ROOT/runtime/bin/node" "$KIT_ROOT/src/cli.mjs" setup "$@"\n';
}

function executablePathsFor(platform) {
  const descriptor = PLATFORMS.get(platform);
  const paths = new Set([descriptor.runtime, descriptor.server]);
  if (platform.startsWith('linux-')) paths.add('personal-wiki').add('setup-wiki');
  return paths;
}

async function writeManifest(destination, {platform, version}) {
  const entries = await collectArchiveEntries(destination, {executablePaths: executablePathsFor(platform)});
  const files = entries.map(({path: relative, bytes, sha256, mode}) => ({path: relative, bytes, sha256, mode: mode.toString(8).padStart(4, '0')}));
  await writeFile(path.join(destination, MANIFEST), `${JSON.stringify({schema: 1, version, platform, files}, null, 2)}\n`, 'utf8');
}

export async function stageReleaseTree({kitRoot, destination, platform, runtimeExecutable, serverExecutable, readerRoot, includeProductionDependencies = true} = {}) {
  const descriptor = PLATFORMS.get(platform);
  if (!descriptor) throw new Error(`unsupported release platform ${platform}`);
  const sourceRoot = path.resolve(kitRoot);
  const output = path.resolve(destination);
  await assertEmptyDestination(output);
  try {
    const kit = JSON.parse(await readFile(path.join(sourceRoot, 'kit.json'), 'utf8'));
    if (kit.schema !== 1 || typeof kit.version !== 'string') throw new Error('invalid kit.json');
    for (const relative of COPY_PATHS) await copyRequired(
      path.join(sourceRoot, relative),
      path.join(output, relative),
      {excludeGenerated: true},
    );
    await copyRequired(path.resolve(readerRoot), path.join(output, 'reader-dist'));
    await copyRequired(path.resolve(runtimeExecutable), path.join(output, descriptor.runtime));
    await copyRequired(path.resolve(serverExecutable), path.join(output, descriptor.server));
    const runtimeReadme = path.join(sourceRoot, 'runtime', 'README.md');
    if (await exists(runtimeReadme)) await copyRequired(runtimeReadme, path.join(output, 'runtime', 'README.md'));
    if (includeProductionDependencies) await copyProductionDependencies(sourceRoot, output);
    if (platform.startsWith('windows-')) {
      await writeFile(path.join(output, 'personal-wiki.cmd'), launcherText(platform), 'utf8');
      await writeFile(path.join(output, 'setup-wiki.bat'), setupLauncherText(platform), 'utf8');
    } else {
      await writeFile(path.join(output, 'personal-wiki'), launcherText(platform), {encoding: 'utf8', mode: 0o755});
      await writeFile(path.join(output, 'setup-wiki'), setupLauncherText(platform), {encoding: 'utf8', mode: 0o755});
      for (const relative of executablePathsFor(platform)) await chmod(path.join(output, relative), 0o755);
    }
    await writeManifest(output, {platform, version: kit.version});
    await verifyReleaseTree(output);
    return {destination: output, platform, version: kit.version, files: (await collectArchiveEntries(output)).map((entry) => entry.path)};
  } catch (error) {
    await rm(output, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    throw error;
  }
}

export async function verifyReleaseTree(root) {
  const releaseRoot = path.resolve(root);
  const manifest = JSON.parse(await readFile(path.join(releaseRoot, MANIFEST), 'utf8'));
  if (manifest.schema !== 1 || !PLATFORMS.has(manifest.platform) || !Array.isArray(manifest.files)) throw new Error('invalid release manifest');
  const declared = new Map();
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || declared.has(item.path) || !/^[a-f0-9]{64}$/u.test(item.sha256)) throw new Error('invalid release manifest file');
    declared.set(item.path, item);
  }
  const disk = await collectArchiveEntries(releaseRoot, {executablePaths: executablePathsFor(manifest.platform)});
  for (const entry of disk) {
    if (entry.path === MANIFEST) continue;
    const item = declared.get(entry.path);
    if (!item) throw new Error(`unlisted release file ${entry.path}`);
    if (item.bytes !== entry.bytes || item.sha256 !== entry.sha256 || item.mode !== entry.mode.toString(8).padStart(4, '0')) throw new Error(`release file changed ${entry.path}`);
    declared.delete(entry.path);
  }
  if (declared.size > 0) throw new Error(`missing release file ${[...declared.keys()][0]}`);
  return manifest;
}

async function hashFile(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function buildServer({kitRoot, output, descriptor}) {
  await execFileAsync('go', ['build', '-trimpath', '-o', output, './cmd/wiki-server'], {cwd: path.join(kitRoot, 'server'), env: {...process.env, CGO_ENABLED: '0', GOOS: descriptor.goos, GOARCH: descriptor.goarch}, windowsHide: true});
}

export async function buildRelease({kitRoot, outputRoot, platform, runtimeExecutable, serverExecutable, readerRoot} = {}) {
  const descriptor = PLATFORMS.get(platform);
  if (!descriptor) throw new Error(`unsupported release platform ${platform}`);
  if (!runtimeExecutable && descriptor.os !== process.platform) throw new Error(`runtimeExecutable is required when cross-packaging ${platform}`);
  const sourceRoot = path.resolve(kitRoot);
  const kit = JSON.parse(await readFile(path.join(sourceRoot, 'kit.json'), 'utf8'));
  const base = `personal-wiki-kit-v${kit.version}-${platform}`;
  const output = path.resolve(outputRoot);
  await mkdir(output, {recursive: true});
  const destination = path.join(output, base);
  const archive = path.join(output, `${base}.${descriptor.archive}`);
  const lock = path.join(output, `${base}.lock.json`);
  await rm(destination, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  await rm(archive, {force: true});
  await rm(lock, {force: true});
  let builtServer = serverExecutable;
  const temporaryServer = path.join(output, `.${base}-server${descriptor.goos === 'windows' ? '.exe' : ''}`);
  if (!builtServer) {
    await buildServer({kitRoot: sourceRoot, output: temporaryServer, descriptor});
    builtServer = temporaryServer;
  }
  try {
    const staged = await stageReleaseTree({kitRoot: sourceRoot, destination, platform, runtimeExecutable: runtimeExecutable || process.execPath, serverExecutable: builtServer, readerRoot: readerRoot || path.join(sourceRoot, 'reader-dist')});
    const archiveOptions = {source: destination, output: archive, prefix: `${base}/`, executablePaths: executablePathsFor(platform)};
    if (descriptor.archive === 'zip') await writeZipArchive(archiveOptions);
    else await writeTarGzArchive(archiveOptions);
    const sha256 = await hashFile(archive);
    await writeFile(lock, `${JSON.stringify({schema: 1, version: kit.version, platform, artifact: path.basename(archive), sha256}, null, 2)}\n`, 'utf8');
    return {...staged, archive, lock, sha256};
  } finally {
    if (!serverExecutable) await rm(temporaryServer, {force: true});
  }
}

function parseCLI(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`invalid release argument ${key || ''}`);
    options[key.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = value;
  }
  return options;
}

async function main() {
  const options = parseCLI(process.argv.slice(2));
  const kitRoot = path.resolve(import.meta.dirname, '..');
  const result = await buildRelease({kitRoot, outputRoot: path.resolve(options.output || path.join(kitRoot, '.wiki-kit-out')), platform: options.platform, runtimeExecutable: options.runtime, serverExecutable: options.server, readerRoot: options.reader});
  const {files, ...summary} = result;
  process.stdout.write(`${JSON.stringify({...summary, fileCount: files.length}, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
