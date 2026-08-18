#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PLATFORMS = [
  {platform: 'linux-x64', extension: 'tar.gz'},
  {platform: 'windows-x64', extension: 'zip'},
];

export function releaseIdentity(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error('Kit version must be an exact semantic version');
  return {version, tag: `personal-wiki-kit-v${version}`};
}

async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
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

async function verifyAssets(assetsDirectory, identity) {
  const root = path.resolve(assetsDirectory);
  const descriptorName = `${identity.tag}.lock.json`;
  const required = [];
  const artifacts = {};
  for (const target of PLATFORMS) {
    const artifact = `${identity.tag}-${target.platform}.${target.extension}`;
    const lockName = `${identity.tag}-${target.platform}.lock.json`;
    const artifactPath = path.join(root, artifact);
    const lockPath = path.join(root, lockName);
    const lock = parsePlatformLock(await readFile(lockPath, 'utf8'), {...target, version: identity.version, artifact});
    const actual = await sha256File(artifactPath);
    if (actual !== lock.sha256) throw new Error(`${target.platform} artifact checksum mismatch`);
    artifacts[target.platform] = {artifact, sha256: actual};
    required.push(artifactPath, lockPath);
  }
  const allowed = new Set([...required.map((filename) => path.basename(filename)), descriptorName]);
  const unexpected = (await readdir(root)).filter((name) => !allowed.has(name));
  if (unexpected.length > 0) throw new Error(`release assets directory contains unexpected file ${unexpected[0]}`);
  return {root, required, artifacts, descriptor: path.join(root, descriptorName)};
}

function defaultGit(repositoryRoot) {
  const run = async (args) => (await execFileAsync('git', ['-C', repositoryRoot, ...args], {encoding: 'utf8', windowsHide: true})).stdout.trim();
  return {
    assertClean: async () => {
      const status = await run(['status', '--porcelain=v1', '--untracked-files=all']);
      if (status) throw new Error('Personal Wiki Kit release requires a clean source worktree');
    },
    head: async () => run(['rev-parse', '--verify', 'HEAD']),
    tagExists: async (tag) => {
      if (await run(['tag', '--list', tag])) return true;
      return Boolean(await run(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]));
    },
  };
}

function defaultGitHub(repositoryRoot) {
  const run = async (args) => execFileAsync('gh', args, {cwd: repositoryRoot, encoding: 'utf8', windowsHide: true});
  return {
    releaseExists: async (tag) => {
      try {
        await run(['release', 'view', tag, '--json', 'tagName']);
        return true;
      } catch (error) {
        if (/release not found|HTTP 404|not found/iu.test(`${error.stderr || ''}\n${error.message || ''}`)) return false;
        throw error;
      }
    },
    createRelease: async ({tag, target, assets}) => {
      await run(['release', 'create', tag, '--target', target, '--title', `Personal Wiki Kit ${tag}`, '--notes', 'Versioned, self-contained Personal Wiki Kit release.', ...assets]);
    },
  };
}

export async function runPersonalWikiKitRelease(options = {}, dependencies = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const kitRoot = path.resolve(options.kitRoot);
  const assetsDirectory = path.resolve(options.assetsDirectory);
  const manifest = JSON.parse(await readFile(path.join(kitRoot, 'kit.json'), 'utf8'));
  if (manifest.schema !== 1) throw new Error('Kit manifest schema must be 1');
  const identity = releaseIdentity(manifest.version);
  const git = dependencies.git || defaultGit(repositoryRoot);
  const github = dependencies.github || defaultGitHub(repositoryRoot);
  await git.assertClean();
  const sourceSha = await git.head();
  if (!/^[a-f0-9]{40,64}$/u.test(sourceSha)) throw new Error('Git HEAD is not a full object ID');
  if (await git.tagExists(identity.tag)) throw new Error(`Kit tag already exists: ${identity.tag}`);
  if (await github.releaseExists(identity.tag)) throw new Error(`Kit release already exists: ${identity.tag}`);
  const verified = await verifyAssets(assetsDirectory, identity);
  const descriptor = {
    schema: 1,
    version: identity.version,
    tag: identity.tag,
    sourceSha,
    artifacts: verified.artifacts,
  };
  await writeFile(verified.descriptor, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  const assets = [...verified.required, verified.descriptor];
  if (options.dryRun) return {...identity, sourceSha, descriptor: verified.descriptor, assets, mode: 'dry-run'};
  await github.createRelease({tag: identity.tag, target: sourceSha, assets});
  return {...identity, sourceSha, descriptor: verified.descriptor, assets, mode: 'published'};
}

function parseArguments(values) {
  const options = {dryRun: false};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (key !== '--assets' || !values[index + 1]) throw new Error(`unsupported argument ${key}`);
    options.assetsDirectory = values[index + 1];
    index += 1;
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
  process.stdout.write(`${JSON.stringify({mode: result.mode, tag: result.tag, sourceSha: result.sourceSha, assets: result.assets.map((filename) => path.basename(filename))}, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
