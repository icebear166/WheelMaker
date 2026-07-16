import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  STABLE_URL,
  fetchHttpsBytes,
  parseDeployArgs,
  runLauncher,
} from './deploy.mjs';
import { encodeJsonBytes, sha256Bytes } from '../release/metadata.mjs';

function launcherFixture({
  localCore = Buffer.from('current-core'),
  localLauncher = Buffer.from('current-launcher'),
  nextCore = Buffer.from('current-core'),
  nextLauncher = Buffer.from('current-launcher'),
  pendingLauncher = null,
  invalidStable = false,
} = {}) {
  const files = new Map([
    ['deploy.mjs', localLauncher],
    ['deploy-core.mjs', localCore],
  ]);
  if (pendingLauncher) files.set('deploy.next.mjs', pendingLauncher);

  const stable = {
    schema: 1,
    version: 'v1.7',
    publishedAt: '2026-07-16T09:00:00.000Z',
    sourceSha: '0'.repeat(40),
    deploy: {
      mjsUrl: 'https://raw.example/deploy.mjs',
      mjsSha256: sha256Bytes(nextLauncher),
      coreUrl: 'https://raw.example/deploy-core.mjs',
      coreSha256: sha256Bytes(nextCore),
    },
    release: {
      manifestUrl: 'https://release.example/release-manifest.json',
      manifestSha256: 'a'.repeat(64),
    },
  };
  const stableBytes = encodeJsonBytes(
    invalidStable ? { ...stable, schema: 2 } : stable,
  );
  const events = [];

  return {
    events,
    files,
    stableUrl: 'https://stable.example/stable.json',
    async fetchBytes(url) {
      if (url === 'https://stable.example/stable.json') {
        return stableBytes;
      }
      if (url === stable.deploy.mjsUrl) return nextLauncher;
      if (url === stable.deploy.coreUrl) return nextCore;
      throw new Error(`unexpected URL: ${url}`);
    },
    onEvent(event) {
      events.push(event);
    },
    async promotePendingLauncher() {
      if (!files.has('deploy.next.mjs')) return false;
      files.set('deploy.mjs', files.get('deploy.next.mjs'));
      files.delete('deploy.next.mjs');
      return true;
    },
    async readLocalFile(name) {
      return files.get(name) ?? null;
    },
    async replaceCore(bytes) {
      files.set('deploy-core.mjs', bytes);
    },
    async runCore(args) {
      events.push(`run-core:${args.join(',') || 'deploy'}`);
    },
    async stageLauncher(bytes) {
      files.set('deploy.next.mjs', bytes);
    },
  };
}

test('launcher rejects invalid stable metadata before reading release URLs', async () => {
  const deps = launcherFixture({ invalidStable: true });
  await assert.rejects(
    () => runLauncher([], deps),
    /stable metadata schema is invalid/,
  );
  assert.deepEqual(deps.events, []);
  assert.equal(deps.files.has('deploy.next.mjs'), false);
});

test('launcher refreshes changed core and runs it in the current invocation', async () => {
  const deps = launcherFixture({ nextCore: Buffer.from('new-core') });
  await runLauncher(['update'], deps);
  assert.deepEqual(deps.events, [
    'replace-core',
    'run-core:update',
  ]);
  assert.deepEqual(deps.files.get('deploy-core.mjs'), Buffer.from('new-core'));
});

test('launcher self-update is staged without replacing the running launcher', async () => {
  const deps = launcherFixture({ nextLauncher: Buffer.from('new-launcher') });
  await runLauncher([], deps);
  assert.deepEqual(deps.files.get('deploy.next.mjs'), Buffer.from('new-launcher'));
  assert.deepEqual(deps.files.get('deploy.mjs'), Buffer.from('current-launcher'));
});

test('pending launcher is promoted at the beginning of the next invocation', async () => {
  const nextLauncher = Buffer.from('new-launcher');
  const deps = launcherFixture({
    localLauncher: Buffer.from('old-launcher'),
    nextLauncher,
    pendingLauncher: nextLauncher,
  });
  await runLauncher(['runtime', 'status'], deps);
  assert.deepEqual(deps.files.get('deploy.mjs'), nextLauncher);
  assert.equal(deps.files.has('deploy.next.mjs'), false);
  assert.deepEqual(deps.events, [
    'promote-launcher',
    'run-core:runtime,status',
  ]);
});

test('unknown commands fail before launcher files are mutated', async () => {
  const deps = launcherFixture({ pendingLauncher: Buffer.from('next') });
  assert.throws(() => parseDeployArgs(['schedule']), /unknown deploy command/);
  await assert.rejects(() => runLauncher(['schedule'], deps), /unknown deploy command/);
  assert.equal(deps.files.has('deploy.next.mjs'), true);
  assert.deepEqual(deps.events, []);
});

test('HTTPS downloader rejects insecure URLs and redirect targets', async () => {
  await assert.rejects(() => fetchHttpsBytes('http://example.test/file'), /HTTPS/);
  await assert.rejects(
    () =>
      fetchHttpsBytes('https://example.test/file', {
        fetchImpl: async () =>
          new Response(null, {
            headers: { location: 'http://example.test/redirected' },
            status: 302,
          }),
      }),
    /HTTPS/,
  );
});

test('launcher embeds the configured stable URL', async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(directory, '..', '..');
  const channel = JSON.parse(
    await readFile(resolve(repoRoot, 'scripts', 'release', 'channel.json'), 'utf8'),
  );
  assert.equal(
    STABLE_URL,
    `https://raw.githubusercontent.com/${channel.owner}/${channel.repository}/${channel.branch}/${channel.stablePath}`,
  );
});
