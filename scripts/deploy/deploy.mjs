#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseGatewayOptions } from './gateway-config.mjs';

export const RELEASE_BASE_URL = '__WHEELMAKER_RELEASE_BASE_URL__';
export const STABLE_PATH = '/stable.json';
export const STABLE_URL = `${RELEASE_BASE_URL}${STABLE_PATH}`;

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PACKAGE_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const PROGRESS_PERCENT_STEP = 5;
const PROGRESS_BYTES_STEP = 1024 * 1024;
const ALLOWED_COMMANDS = new Set([
  'desktop-update',
  'gateway',
  'gateway-update',
  'migrate-uninstall',
  'update',
]);
const RUNTIME_ACTIONS = new Set(['start', 'stop', 'restart']);

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireHttps(value, label, trustedOrigin) {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  if (trustedOrigin && url.origin !== trustedOrigin) {
    throw new Error(`${label} must stay on the same origin`);
  }
  return url;
}

function validateReleaseBaseUrl(value) {
  let base;
  try {
    base = new URL(value);
  } catch {
    throw new Error('deploy.mjs has not been rendered with a release base URL');
  }
  if (
    value === '__WHEELMAKER_' + 'RELEASE_BASE_URL__' ||
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    value !== base.origin
  ) {
    throw new Error('deploy.mjs has not been rendered with a valid release base URL');
  }
  return base.origin;
}

export function resolveReleasePath(baseUrl, path, label = 'release path') {
  const base = validateReleaseBaseUrl(baseUrl);
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    if (path?.startsWith?.('//')) {
      throw new Error(`${label} must stay on the same origin`);
    }
    throw new Error(`${label} must be a root-relative path`);
  }
  const resolved = new URL(path, `${base}/`);
  if (resolved.origin !== base) {
    throw new Error(`${label} must stay on the same origin`);
  }
  return resolved.href;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function createDownloadProgressReporter(label, {
  write = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  let lastBytes = -PROGRESS_BYTES_STEP;
  let lastPercentage = -PROGRESS_PERCENT_STEP;
  let lastLine;
  return ({done, downloadedBytes, totalBytes}) => {
    let line;
    if (Number.isFinite(totalBytes)) {
      const percentage = totalBytes === 0
        ? (done ? 100 : 0)
        : Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
      if (
        !done &&
        downloadedBytes !== 0 &&
        percentage < lastPercentage + PROGRESS_PERCENT_STEP
      ) {
        return;
      }
      lastPercentage = percentage;
      line = `[deploy] Downloading ${label}: ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${percentage}%)`;
    } else {
      if (
        !done &&
        downloadedBytes !== 0 &&
        downloadedBytes < lastBytes + PROGRESS_BYTES_STEP
      ) {
        return;
      }
      lastBytes = downloadedBytes;
      line = `[deploy] Downloading ${label}: ${formatBytes(downloadedBytes)}`;
    }
    if (line !== lastLine) {
      write(line);
      lastLine = line;
    }
  };
}

export async function fetchHttpsBytes(url, {
  fetchImpl = fetch,
  maxBytes = MAX_DOWNLOAD_BYTES,
  maxRedirects = MAX_REDIRECTS,
  onProgress,
  trustedOrigin,
} = {}) {
  let currentUrl = requireHttps(url, 'download URL', trustedOrigin);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirects === maxRedirects) {
        throw new Error('HTTPS download exceeded redirect limit');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('HTTPS redirect is missing Location');
      }
      currentUrl = requireHttps(
        new URL(location, currentUrl).href,
        'redirect URL',
        trustedOrigin,
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTPS download failed (${response.status})`);
    }
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader === null
      ? Number.NaN
      : Number(contentLengthHeader);
    const totalBytes = Number.isFinite(contentLength) && contentLength >= 0
      ? contentLength
      : undefined;
    if (totalBytes !== undefined && totalBytes > maxBytes) {
      throw new Error('HTTPS download exceeds size limit');
    }
    onProgress?.({done: false, downloadedBytes: 0, totalBytes});
    const chunks = [];
    let downloadedBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          await reader.cancel?.().catch(() => {});
          throw new Error('HTTPS download exceeds size limit');
        }
        chunks.push(chunk);
        onProgress?.({done: false, downloadedBytes, totalBytes});
      }
    } else {
      const chunk = Buffer.from(await response.arrayBuffer());
      downloadedBytes = chunk.length;
      if (downloadedBytes > maxBytes) {
        throw new Error('HTTPS download exceeds size limit');
      }
      chunks.push(chunk);
      onProgress?.({done: false, downloadedBytes, totalBytes});
    }
    onProgress?.({done: true, downloadedBytes, totalBytes});
    const bytes = Buffer.concat(chunks, downloadedBytes);
    return bytes;
  }
  throw new Error('unreachable HTTPS download state');
}

export function parseDeployArgs(args) {
  if (args.length === 0) {
    return [];
  }
  if (args.length === 2 && args[0] === 'runtime' && RUNTIME_ACTIONS.has(args[1])) {
    return ['runtime', args[1]];
  }
  if (
    args.length === 3 &&
    args[0] === 'desktop-self-update' &&
    args[1] === '--parent-pid' &&
    /^[1-9]\d*$/.test(args[2]) &&
    Number.isSafeInteger(Number(args[2]))
  ) {
    return [...args];
  }
  const gateway = parseGatewayOptions(args);
  if (gateway.explicit) {
    if (gateway.commandArgs.length > 0) {
      throw new Error('Gateway configuration options are only valid for a full deployment');
    }
    return [...args];
  }
  if (args.length !== 1 || !ALLOWED_COMMANDS.has(args[0])) {
    throw new Error(`unknown deploy command: ${args.join(' ')}`);
  }
  return [args[0]];
}

function validateStable(stable, releaseBaseUrl) {
  if (
    stable?.schema !== 2 ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version ?? '') ||
    !/^[0-9a-f]{40}$/.test(stable.sourceSha ?? '')
  ) {
    throw new Error('stable metadata schema is invalid');
  }
  for (const [label, path, hash] of [
    ['deploy.mjs', stable.deploy?.mjsPath, stable.deploy?.mjsSha256],
    ['deploy-core.mjs', stable.deploy?.corePath, stable.deploy?.coreSha256],
    [
      'release manifest',
      stable.release?.manifestPath,
      stable.release?.manifestSha256,
    ],
  ]) {
    resolveReleasePath(releaseBaseUrl, path, label);
    if (!/^[0-9a-f]{64}$/.test(hash ?? '')) {
      throw new Error(`${label} SHA-256 is invalid`);
    }
  }
  if (stable.desktopExe !== undefined) {
    if (
      !/^v1\.(0|[1-9]\d*)$/.test(stable.desktopExe?.version ?? '') ||
      !/^[0-9a-f]{64}$/.test(stable.desktopExe?.sha256 ?? '')
    ) {
      throw new Error('Desktop executable metadata is invalid');
    }
    resolveReleasePath(releaseBaseUrl, stable.desktopExe.path, 'Desktop executable');
  }
  if (stable.androidApk !== undefined) {
    const android = stable.androidApk;
    if (
      !/^v1\.(0|[1-9]\d*)$/.test(android?.version ?? '') ||
      android.versionName !== android.version.slice(1) ||
      !Number.isSafeInteger(android.versionCode) ||
      android.versionCode < 1 ||
      !/^[0-9a-f]{40}$/.test(android.sourceSha ?? '') ||
      !/^[0-9a-f]{64}$/.test(android.sha256 ?? '') ||
      !Number.isSafeInteger(android.size) ||
      android.size < 1
    ) {
      throw new Error('Android APK metadata is invalid');
    }
    resolveReleasePath(releaseBaseUrl, android.path, 'Android APK');
  }
  if (stable.gateway !== undefined) {
    const gateway = stable.gateway;
    if (
      !gateway ||
      typeof gateway !== 'object' ||
      Array.isArray(gateway) ||
      !/^v1\.(0|[1-9]\d*)$/.test(gateway.version ?? '') ||
      !/^[0-9a-f]{40}$/.test(gateway.sourceSha ?? '') ||
      gateway.manifestPath !== '/gateway/current/gateway-manifest.json' ||
      !/^[0-9a-f]{64}$/.test(gateway.manifestSha256 ?? '')
    ) {
      throw new Error('Gateway metadata is invalid');
    }
    resolveReleasePath(releaseBaseUrl, gateway.manifestPath, 'Gateway manifest');
  }
  return stable;
}

async function downloadVerifiedScript(deps, url, expectedSha256, label) {
  const bytes = await deps.fetchBytes(url, {label});
  if (sha256Bytes(bytes) !== expectedSha256) {
    throw new Error(`${label} SHA-256 verification failed`);
  }
  return bytes;
}

export async function runLauncher(rawArgs, deps = createDefaultLauncherDependencies()) {
  const args = parseDeployArgs(rawArgs);

  if (await deps.promotePendingLauncher()) {
    deps.onEvent?.('promote-launcher');
  }

  if (args[0] === 'runtime' && args[1] === 'restart') {
    return deps.runCore(args, {
      releaseBaseUrl: deps.releaseBaseUrl,
      stable: null,
      stableBytes: null,
    });
  }

  deps.reportStatus?.('Checking latest release');
  const stableBytes = await deps.fetchBytes(deps.stableUrl, {label: 'stable.json'});
  const stable = validateStable(
    JSON.parse(stableBytes.toString('utf8')),
    deps.releaseBaseUrl,
  );
  deps.reportStatus?.(`Latest release: ${stable.version}`);

  const localLauncher = await deps.readLocalFile('deploy.mjs');
  let scriptsChanged = false;
  if (
    !localLauncher ||
    sha256Bytes(localLauncher) !== stable.deploy.mjsSha256
  ) {
    deps.reportStatus?.('Updating deploy.mjs');
    const launcher = await downloadVerifiedScript(
      deps,
      resolveReleasePath(deps.releaseBaseUrl, stable.deploy.mjsPath, 'deploy.mjs'),
      stable.deploy.mjsSha256,
      'deploy.mjs',
    );
    await deps.stageLauncher(launcher);
    deps.onEvent?.('stage-launcher');
    scriptsChanged = true;
  }

  const localCore = await deps.readLocalFile('deploy-core.mjs');
  if (!localCore || sha256Bytes(localCore) !== stable.deploy.coreSha256) {
    deps.reportStatus?.('Updating deploy-core.mjs');
    const core = await downloadVerifiedScript(
      deps,
      resolveReleasePath(deps.releaseBaseUrl, stable.deploy.corePath, 'deploy-core.mjs'),
      stable.deploy.coreSha256,
      'deploy-core.mjs',
    );
    await deps.replaceCore(core);
    deps.onEvent?.('replace-core');
    scriptsChanged = true;
  }

  if (!scriptsChanged) deps.reportStatus?.('Deployment scripts are current');

  const operation = args.length === 0
    ? `Starting deployment of ${stable.version}`
    : args[0] === 'update'
      ? `Starting update to ${stable.version}`
      : args[0] === 'migrate-uninstall'
        ? 'Starting legacy migration cleanup'
        : ['gateway', 'gateway-update'].includes(args[0])
          ? 'Starting Gateway deployment'
          : args[0] === 'desktop-update'
            ? 'Starting Desktop update'
            : args[0] === 'desktop-self-update'
              ? 'Starting Desktop self-update'
              : `Running ${args.join(' ')}`;
  deps.reportStatus?.(operation);

  return deps.runCore(args, {
    releaseBaseUrl: deps.releaseBaseUrl,
    stable,
    stableBytes,
  });
}

async function readFileIfPresent(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, bytes, { mode: 0o644 });
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function createDefaultLauncherDependencies({
  installDirectory = dirname(fileURLToPath(import.meta.url)),
} = {}) {
  const releaseBaseUrl = validateReleaseBaseUrl(RELEASE_BASE_URL);
  const launcherPath = join(installDirectory, 'deploy.mjs');
  const pendingLauncherPath = join(installDirectory, 'deploy.next.mjs');
  const corePath = join(installDirectory, 'deploy-core.mjs');
  const reportStatus = (message) => process.stdout.write(`[deploy] ${message}\n`);
  const fetchWithProgress = (url, {label = 'file', maxBytes}) =>
    fetchHttpsBytes(url, {
      maxBytes,
      onProgress: createDownloadProgressReporter(label),
      trustedOrigin: releaseBaseUrl,
    });
  return {
    releaseBaseUrl,
    stableUrl: resolveReleasePath(releaseBaseUrl, STABLE_PATH, 'stable.json'),
    fetchBytes: (url, {label} = {}) =>
      fetchWithProgress(url, {label, maxBytes: MAX_DOWNLOAD_BYTES}),
    onEvent() {},
    reportStatus,
    async promotePendingLauncher() {
      const pending = await readFileIfPresent(pendingLauncherPath);
      if (!pending) {
        return false;
      }
      await atomicWrite(launcherPath, pending);
      await rm(pendingLauncherPath, { force: true });
      return true;
    },
    readLocalFile(name) {
      return readFileIfPresent(join(installDirectory, name));
    },
    replaceCore(bytes) {
      return atomicWrite(corePath, bytes);
    },
    async runCore(args, context) {
      const coreUrl = `${pathToFileURL(corePath).href}?sha256=${sha256Bytes(
        await readFile(corePath),
      )}`;
      const core = await import(coreUrl);
      if (typeof core.runCore !== 'function') {
        throw new Error('deploy-core.mjs does not export runCore');
      }
      return core.runCore(args, {
        fetchBytes: (url, {label} = {}) =>
          fetchWithProgress(url, {
            label,
            maxBytes: MAX_PACKAGE_DOWNLOAD_BYTES,
          }),
        installDirectory,
        reportStatus,
        trustedStable: context.stable,
        trustedStableBytes: context.stableBytes,
        trustedReleaseBaseUrl: context.releaseBaseUrl,
        gatewayOptions: context.gatewayOptions,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      });
    },
    stageLauncher(bytes) {
      return atomicWrite(pendingLauncherPath, bytes);
    },
  };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 22) {
    throw new Error(`Node.js 22+ is required; found ${process.versions.node}`);
  }
  await runLauncher(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[deploy] Failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
