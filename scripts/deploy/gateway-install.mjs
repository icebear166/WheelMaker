import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { currentPlatformKey, extractTarZst } from './deploy-core.mjs';
import { gatewayConfigPaths, gatewayHome, readGatewayConfiguration } from './gateway-config.mjs';
import { createGatewayRuntimeAdapter, gatewayRuntimePaths } from './gateway-runtime.mjs';

const GATEWAY_TARGETS = new Set([
  'windows-amd64',
  'linux-amd64',
  'darwin-amd64',
  'darwin-arm64',
]);
const GATEWAY_ARCHIVE_PATTERN = /^wheelmaker-gateway-v1\.(0|[1-9]\d*)-(windows-amd64|linux-amd64|darwin-amd64|darwin-arm64)\.tar\.zst$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^v1\.(0|[1-9]\d*)$/;

function runProcess(command, args, {cwd, allowFailure = false} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', rejectPromise);
    child.once('exit', code => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code !== 0 && !allowFailure) {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed (${code}): ${result.stderr.trim()}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveReleasePath(baseUrl, path, label) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error('trusted release base URL is invalid');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || baseUrl !== base.origin) {
    throw new Error('trusted release base URL is invalid');
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) {
    throw new Error(`${label} path is invalid`);
  }
  const resolved = new URL(path, `${base.origin}/`);
  if (resolved.origin !== base.origin) throw new Error(`${label} path must stay on the trusted release origin`);
  return resolved.href;
}

function validatePointer(pointer) {
  if (!pointer) return null;
  if (typeof pointer !== 'object' || Array.isArray(pointer) || !VERSION_PATTERN.test(pointer.version ?? '') ||
      !SOURCE_SHA_PATTERN.test(pointer.sourceSha ?? '') || pointer.manifestPath !== '/gateway/current/gateway-manifest.json' ||
      !SHA256_PATTERN.test(pointer.manifestSha256 ?? '')) {
    throw new Error('stable Gateway pointer is invalid');
  }
  return pointer;
}

export function validateGatewayManifest(manifest, pointer) {
  validatePointer(pointer);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schema !== 1 ||
      manifest.version !== pointer.version || manifest.sourceSha !== pointer.sourceSha ||
      manifest.path !== '/gateway/current/gateway-manifest.json') {
    throw new Error('Gateway manifest identity is invalid');
  }
  // Release Server serializes artifacts as an object keyed by platform. Accepting
  // only that shape prevents an attacker from smuggling paths through an array.
  if (!manifest.artifacts || typeof manifest.artifacts !== 'object' || Array.isArray(manifest.artifacts)) {
    throw new Error('Gateway manifest artifacts are invalid');
  }
  const normalized = {};
  for (const target of GATEWAY_TARGETS) {
    const artifact = manifest.artifacts[target];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
        typeof artifact.path !== 'string' || !artifact.path.startsWith('/gateway/current/') ||
        artifact.path.includes('..') || artifact.path.includes('?') || artifact.path.includes('#') ||
        !SHA256_PATTERN.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.size) || artifact.size < 1) {
      throw new Error(`Gateway artifact metadata/path is invalid: ${target}`);
    }
    const name = artifact.path.slice('/gateway/current/'.length);
    const expected = `wheelmaker-gateway-${manifest.version}-${target}.tar.zst`;
    if (name !== expected || !GATEWAY_ARCHIVE_PATTERN.test(name)) {
      throw new Error(`Gateway artifact path is invalid: ${target}`);
    }
    normalized[target] = {...artifact, name};
  }
  if (Object.keys(manifest.artifacts).some(key => !GATEWAY_TARGETS.has(key))) {
    throw new Error('Gateway manifest contains an unsupported platform');
  }
  return normalized;
}

async function writeAtomic(path, bytes, mode = 0o600) {
  await mkdir(resolve(path, '..'), {recursive: true});
  const temporary = join(resolve(path, '..'), `.${path.split(/[\\/]/).pop()}.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, {mode});
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, {force: true});
  }
}

async function copyFileAtomic(source, destination) {
  const bytes = await readFile(source);
  await writeAtomic(destination, bytes, 0o755);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateBinary({binary, home, runner}) {
  if (runner) {
    await runner(binary, ['validate', '--home', home]);
    return;
  }
  // Callers that install the service normally provide a platform runner. Keep
  // the default explicit so a deployment cannot silently skip validation.
  throw new Error('Gateway binary validation runner is required');
}

async function waitForGatewayStopped(runtime, {attempts = 20, intervalMs = 250} = {}) {
  if (typeof runtime?.isRunning !== 'function') return;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await runtime.isRunning())) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error('Gateway service did not stop before binary replacement');
}

function gatewayBinaryName(platformKey) {
  return platformKey === 'windows-amd64' ? 'wheelmaker-gateway.exe' : 'wheelmaker-gateway';
}

export function gatewayInstallPaths(home, platformKey) {
  const paths = gatewayConfigPaths(home);
  const binaryName = gatewayBinaryName(platformKey);
  return {
    ...paths,
    binaryName,
    binary: join(paths.bin, binaryName),
    rollbackBinary: join(paths.rollback, binaryName),
  };
}

export async function installGatewayFromStable({
  stable,
  releaseBaseUrl,
  fetchBytes,
  gatewayHome: configuredHome,
  installDirectory,
  userHome,
  platformKey = currentPlatformKey(),
  platform = process.platform,
  arch = process.arch,
  nodePath = process.execPath,
  uid,
  runner,
  gatewayRuntime,
  validateBinary: validateBinaryOverride,
  now = () => new Date().toISOString(),
  reportStatus,
  force = false,
} = {}) {
  const pointer = validatePointer(stable?.gateway);
  if (!pointer) return {skipped: true, reason: 'missing-pointer'};
  if (!fetchBytes || !releaseBaseUrl) throw new Error('Gateway download dependencies are required');
  if (!GATEWAY_TARGETS.has(platformKey)) throw new Error(`unsupported Gateway platform: ${platformKey}`);

  const home = gatewayHome({home: configuredHome, installDirectory, userHome});
  const paths = gatewayInstallPaths(home, platformKey);
  const commandRunner = runner ?? runProcess;
  await mkdir(paths.bin, {recursive: true});
  await mkdir(paths.downloads, {recursive: true});
  await mkdir(paths.rollback, {recursive: true});
  await mkdir(join(paths.home, 'state'), {recursive: true});

  const runtime = gatewayRuntime ?? createGatewayRuntimeAdapter({
    paths: gatewayRuntimePaths({gatewayHome: home, gatewayBinary: paths.binary, nodePath, userHome, uid}),
    platform,
    runner: commandRunner,
  });

  const manifestURL = resolveReleasePath(releaseBaseUrl, pointer.manifestPath, 'Gateway manifest');
  const manifestBytes = await fetchBytes(manifestURL, {label: 'Gateway manifest'});
  if (sha256Bytes(manifestBytes) !== pointer.manifestSha256) throw new Error('Gateway manifest SHA-256 verification failed');
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch {
    throw new Error('Gateway manifest is not valid JSON');
  }
  const artifacts = validateGatewayManifest(manifest, pointer);
  const artifact = artifacts[platformKey];
  const statePath = join(paths.home, 'state', 'release.json');
  const previousState = await (async () => {
    try { return JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  })();
  if (!force && previousState?.version === pointer.version && previousState?.manifestSha256 === pointer.manifestSha256 && await fileExists(paths.binary)) {
    let running = false;
    if (typeof runtime.isRunning === 'function') {
      running = await runtime.isRunning();
    } else {
      try {
        await runtime.health();
        running = true;
      } catch {
        // Start and verify the existing binary below.
      }
    }
    if (running) {
      try {
        await runtime.health();
        return {skipped: true, reason: 'already-installed', home, paths, pointer, manifest};
      } catch (error) {
        reportStatus?.(`Existing Gateway health check failed; reinstalling service: ${error.message}`);
      }
    }
    try {
      await runtime.start();
      await runtime.health();
      return {skipped: true, reason: 'started-existing', home, paths, pointer, manifest};
    } catch (error) {
      reportStatus?.(`Existing Gateway service could not start; reinstalling service: ${error.message}`);
    }
  }

  reportStatus?.(`Downloading Gateway ${pointer.version} (${platformKey})`);
  const archiveURL = resolveReleasePath(releaseBaseUrl, artifact.path, 'Gateway artifact');
  const archiveBytes = await fetchBytes(archiveURL, {label: `Gateway ${platformKey}`});
  if (archiveBytes.length !== artifact.size) throw new Error('Gateway archive size verification failed');
  if (sha256Bytes(archiveBytes) !== artifact.sha256) throw new Error('Gateway archive SHA-256 verification failed');

  const job = `${process.pid}-${randomUUID()}`;
  const downloadPath = join(paths.downloads, `${artifact.name}.${job}`);
  const extractionPath = join(paths.downloads, `extract-${job}`);
  const stagedBinary = join(extractionPath, paths.binaryName);
  await writeFile(downloadPath, archiveBytes, {mode: 0o600});
  try {
    await extractTarZst(archiveBytes, extractionPath);
    await access(stagedBinary);
    const candidateHome = home;
    const validate = validateBinaryOverride ?? validateBinary;
    await validate({binary: stagedBinary, home: candidateHome, runner: commandRunner});

    const hadCurrent = await fileExists(paths.binary);
    await runtime.stop().catch((error) => {
      if (!hadCurrent) return;
      throw error;
    });
    await waitForGatewayStopped(runtime);
    await rm(paths.rollbackBinary, {force: true});
    if (hadCurrent) await rename(paths.binary, paths.rollbackBinary);
    try {
      await copyFileAtomic(stagedBinary, paths.binary);
      await chmod(paths.binary, 0o755);
      await runtime.install();
      await runtime.health();
      await writeAtomic(statePath, jsonBytes({schema: 1, version: pointer.version, sourceSha: pointer.sourceSha, manifestSha256: pointer.manifestSha256, installedAt: now()}), 0o600);
      await rm(paths.rollbackBinary, {force: true});
      return {skipped: false, home, paths, pointer, manifest};
    } catch (error) {
      reportStatus?.(`Gateway ${pointer.version} failed to start; restoring previous version`);
      await runtime.stop().catch(() => {});
      await waitForGatewayStopped(runtime).catch(() => {});
      await rm(paths.binary, {force: true});
      if (hadCurrent && await fileExists(paths.rollbackBinary)) {
        await rename(paths.rollbackBinary, paths.binary);
        await runtime.install().catch(() => {});
        await runtime.health().catch(() => {});
      }
      throw new Error(`Gateway installation failed and rollback was attempted: ${error.message}`, {cause: error});
    }
  } finally {
    await rm(downloadPath, {force: true});
    await rm(extractionPath, {recursive: true, force: true});
  }
}

export async function validateInstalledGatewayConfiguration(home) {
  return readGatewayConfiguration(home);
}
