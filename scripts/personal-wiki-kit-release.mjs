#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {validateReleaseChannel} from './release/channel.mjs';
import {
  createPublisherConfigDependencies,
  readConfiguredPublisherToken,
} from './release/publisher-config.mjs';
import {ReleaseServerApi} from './release/release-server-api.mjs';

const execFileAsync = promisify(execFile);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PLATFORMS = [
  {platform: 'linux-x64', extension: 'tar.gz'},
  {platform: 'windows-x64', extension: 'zip'},
];

export function releaseIdentity(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error('Kit version must be an exact semantic version');
  }
  return {version};
}

async function inspectFile(filename) {
  const hash = createHash('sha256');
  let size = 0;
  await new Promise((resolve, reject) => {
    const input = createReadStream(filename);
    input.on('data', chunk => {
      hash.update(chunk);
      size += chunk.length;
    });
    input.once('error', reject);
    input.once('end', resolve);
  });
  return {path: filename, size, sha256: hash.digest('hex')};
}

function parsePlatformLock(source, expected) {
  let lock;
  try {
    lock = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid ${expected.platform} lock JSON: ${error.message}`);
  }
  const fields = Object.keys(lock).sort();
  if (JSON.stringify(fields) !== JSON.stringify(['artifact', 'platform', 'schema', 'sha256', 'version'])
    || lock.schema !== 1
    || lock.version !== expected.version
    || lock.platform !== expected.platform
    || lock.artifact !== expected.artifact
    || typeof lock.sha256 !== 'string'
    || !SHA256.test(lock.sha256)) {
    throw new Error(`invalid ${expected.platform} release lock`);
  }
  return lock;
}

async function verifyAssets(assetsDirectory, setupPath, identity) {
  const root = path.resolve(assetsDirectory);
  const allowed = new Set();
  const assets = [];
  for (const target of PLATFORMS) {
    const artifact = `personal-wiki-kit-v${identity.version}-${target.platform}.${target.extension}`;
    const lockName = `personal-wiki-kit-v${identity.version}-${target.platform}.lock.json`;
    const artifactPath = path.join(root, artifact);
    const lock = parsePlatformLock(
      await readFile(path.join(root, lockName), 'utf8'),
      {...target, version: identity.version, artifact},
    );
    const inspected = await inspectFile(artifactPath);
    if (inspected.sha256 !== lock.sha256) {
      throw new Error(`${target.platform} artifact checksum mismatch`);
    }
    assets.push({name: artifact, ...inspected});
    allowed.add(artifact);
    allowed.add(lockName);
  }
  const descriptorName = `personal-wiki-kit-v${identity.version}.lock.json`;
  allowed.add(descriptorName);
  const unexpected = (await readdir(root)).filter(name => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new Error(`release assets directory contains unexpected file ${unexpected[0]}`);
  }
  const setup = await inspectFile(path.resolve(setupPath));
  if (setup.size <= 0) throw new Error('setup-wiki.bat is empty');
  assets.push({name: 'setup-wiki.bat', ...setup});
  return assets.sort((left, right) => left.name.localeCompare(right.name));
}

function defaultGit(repositoryRoot) {
  const run = async args => (await execFileAsync(
    'git',
    ['-C', repositoryRoot, ...args],
    {encoding: 'utf8', windowsHide: true},
  )).stdout.trim();
  return {
    async assertClean() {
      const status = await run(['status', '--porcelain=v1', '--untracked-files=all']);
      if (status) throw new Error('Personal Wiki Kit release requires a clean source worktree');
    },
    head: () => run(['rev-parse', '--verify', 'HEAD']),
  };
}

function parseVersion(value) {
  const match = SEMVER.exec(value ?? '');
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return Math.sign(a.numbers[index] - b.numbers[index]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length === 0 ? 1 : -1);
  }
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Math.sign(Number(leftPart) - Number(rightPart));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

async function createDefaultApi(repositoryRoot) {
  const channel = validateReleaseChannel(JSON.parse(await readFile(
    path.join(repositoryRoot, 'scripts', 'release', 'channel.json'),
    'utf8',
  )));
  const actions = process.env.GITHUB_ACTIONS === 'true';
  const token = actions
    ? process.env.WHEELMAKER_RELEASE_TOKEN
    : await readConfiguredPublisherToken(createPublisherConfigDependencies({baseUrl: channel.baseUrl}));
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('WHEELMAKER_RELEASE_TOKEN is required for Kit publishing');
  }
  return new ReleaseServerApi({baseUrl: channel.baseUrl, token});
}

export async function runPersonalWikiKitRelease(options = {}, dependencies = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const kitRoot = path.resolve(options.kitRoot);
  const assetsDirectory = path.resolve(options.assetsDirectory);
  const setupPath = path.resolve(options.setupPath ?? path.join(kitRoot, 'setup-wiki.bat'));
  const manifest = JSON.parse(await readFile(path.join(kitRoot, 'kit.json'), 'utf8'));
  if (manifest.schema !== 1) throw new Error('Kit manifest schema must be 1');
  const identity = releaseIdentity(manifest.version);
  const git = dependencies.git || defaultGit(repositoryRoot);
  await git.assertClean();
  const sourceSha = await git.head();
  if (!/^[a-f0-9]{40,64}$/u.test(sourceSha)) throw new Error('Git HEAD is not a full object ID');
  const assets = await verifyAssets(assetsDirectory, setupPath, identity);
  if (options.dryRun) {
    return {...identity, sourceSha, assets, mode: 'dry-run'};
  }

  const api = dependencies.api || await createDefaultApi(repositoryRoot);
  const current = await api.readKitStable();
  if (current?.version && compareVersions(identity.version, current.version) <= 0) {
    throw new Error(`Kit ${identity.version} is already stable or older than ${current.version}`);
  }
  const session = await api.startKit({
    publisher: process.env.GITHUB_ACTIONS === 'true' ? 'action' : 'local',
    sourceSha,
    version: identity.version,
  });
  try {
    for (const asset of assets) {
      await api.uploadKit(session.sessionId, asset);
    }
    const stable = await api.commitKit(session.sessionId);
    return {...identity, sourceSha, assets, stable, mode: 'published'};
  } catch (error) {
    try {
      await api.cancelKit(session.sessionId);
    } catch {
      // The server may already have removed a committed or expired session.
    }
    throw error;
  }
}

function parseArguments(values) {
  const options = {dryRun: false};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if ((key === '--assets' || key === '--setup') && values[index + 1]) {
      options[key === '--assets' ? 'assetsDirectory' : 'setupPath'] = values[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument ${key}`);
  }
  if (!options.assetsDirectory) throw new Error('--assets is required');
  return options;
}

async function main() {
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const result = await runPersonalWikiKitRelease({
    ...parseArguments(process.argv.slice(2)),
    repositoryRoot,
    kitRoot: path.join(repositoryRoot, 'personal-wiki-kit'),
  });
  process.stdout.write(`${JSON.stringify({
    mode: result.mode,
    version: result.version,
    sourceSha: result.sourceSha,
    assets: result.assets.map(asset => asset.name),
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
