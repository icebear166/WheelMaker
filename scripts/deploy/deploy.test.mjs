import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RELEASE_BASE_URL,
  STABLE_PATH,
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
    schema: 2,
    version: 'v1.7',
    publishedAt: '2026-07-16T09:00:00.000Z',
    sourceSha: '0'.repeat(40),
    deploy: {
      mjsPath: '/releases/v1.7/deploy.mjs',
      mjsSha256: sha256Bytes(nextLauncher),
      corePath: '/releases/v1.7/deploy-core.mjs',
      coreSha256: sha256Bytes(nextCore),
    },
    release: {
      manifestPath: '/releases/v1.7/release-manifest.json',
      manifestSha256: 'a'.repeat(64),
    },
  };
  const stableBytes = encodeJsonBytes(
    invalidStable ? { ...stable, schema: 1 } : stable,
  );
  const events = [];

  return {
    events,
    files,
    releaseBaseUrl: 'https://release.example',
    stableUrl: 'https://release.example/stable.json',
    async fetchBytes(url) {
      if (url === 'https://release.example/stable.json') {
        return stableBytes;
      }
      if (url === `https://release.example${stable.deploy.mjsPath}`) return nextLauncher;
      if (url === `https://release.example${stable.deploy.corePath}`) return nextCore;
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
  await runLauncher(['runtime', 'start'], deps);
  assert.deepEqual(deps.files.get('deploy.mjs'), nextLauncher);
  assert.equal(deps.files.has('deploy.next.mjs'), false);
  assert.deepEqual(deps.events, [
    'promote-launcher',
    'run-core:runtime,start',
  ]);
});

test('runtime restart skips release checks and deployment updates', async () => {
  const deps = launcherFixture({pendingLauncher: Buffer.from('pending-launcher')});
  deps.fetchBytes = async () => {
    throw new Error('runtime restart must not fetch releases');
  };

  await runLauncher(['runtime', 'restart'], deps);

  assert.deepEqual(deps.events, [
    'promote-launcher',
    'run-core:runtime,restart',
  ]);
  assert.deepEqual(deps.files.get('deploy.mjs'), Buffer.from('pending-launcher'));
  assert.equal(deps.files.has('deploy.next.mjs'), false);
});

test('unknown commands fail before launcher files are mutated', async () => {
  const deps = launcherFixture({ pendingLauncher: Buffer.from('next') });
  assert.deepEqual(parseDeployArgs(['runtime', 'start']), ['runtime', 'start']);
  assert.deepEqual(parseDeployArgs(['runtime', 'stop']), ['runtime', 'stop']);
  assert.deepEqual(parseDeployArgs(['runtime', 'restart']), ['runtime', 'restart']);
  assert.throws(() => parseDeployArgs(['runtime', 'status']), /unknown deploy command/);
  assert.throws(() => parseDeployArgs(['schedule']), /unknown deploy command/);
  await assert.rejects(() => runLauncher(['schedule'], deps), /unknown deploy command/);
  assert.equal(deps.files.has('deploy.next.mjs'), true);
  assert.deepEqual(deps.events, []);
});

test('Desktop self-update accepts only a positive parent PID', () => {
  assert.deepEqual(
    parseDeployArgs(['desktop-self-update', '--parent-pid', '42']),
    ['desktop-self-update', '--parent-pid', '42'],
  );

  for (const args of [
    ['desktop-self-update'],
    ['desktop-self-update', '--parent-pid'],
    ['desktop-self-update', '--parent-pid', '0'],
    ['desktop-self-update', '--parent-pid', '-1'],
    ['desktop-self-update', '--parent-pid', '1.5'],
    ['desktop-self-update', '--parent-pid', 'pid'],
    ['desktop-self-update', '--parent-pid', '42', 'extra'],
    ['desktop-self-update', '--other', '42'],
  ]) {
    assert.throws(() => parseDeployArgs(args), /unknown deploy command/);
  }
});

test('launcher forwards Desktop self-update without owning its lifecycle', async () => {
  const deps = launcherFixture({});
  const statuses = [];
  deps.reportStatus = (message) => statuses.push(message);

  await runLauncher(
    ['desktop-self-update', '--parent-pid', '42'],
    deps,
  );

  assert.equal(
    deps.events.at(-1),
    'run-core:desktop-self-update,--parent-pid,42',
  );
  assert.match(statuses.at(-1), /Desktop self-update/);
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

test('launcher rejects a path that tries to escape the trusted release origin', async () => {
  const deps = launcherFixture();
  const stable = JSON.parse((await deps.fetchBytes(deps.stableUrl)).toString('utf8'));
  stable.deploy.mjsPath = '//evil.example/deploy.mjs';
  deps.fetchBytes = async url => {
    if (url === deps.stableUrl) return encodeJsonBytes(stable);
    throw new Error(`unexpected URL: ${url}`);
  };
  await assert.rejects(() => runLauncher([], deps), /same origin/i);
});

test('HTTPS downloader streams without a time limit and reports byte progress', async () => {
  const chunks = [Buffer.from('abc'), Buffer.from('def')];
  const progress = [];
  let fetchOptions;
  const bytes = await fetchHttpsBytes('https://example.test/file', {
    fetchImpl: async (_url, options) => {
      fetchOptions = options;
      let index = 0;
      return {
        body: {
          getReader() {
            return {
              async read() {
                if (index === chunks.length) return {done: true};
                return {done: false, value: chunks[index++]};
              },
            };
          },
        },
        headers: new Headers({'content-length': '6'}),
        ok: true,
        status: 200,
      };
    },
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(fetchOptions.signal, undefined);
  assert.deepEqual(bytes, Buffer.from('abcdef'));
  assert.deepEqual(progress, [
    {done: false, downloadedBytes: 0, totalBytes: 6},
    {done: false, downloadedBytes: 3, totalBytes: 6},
    {done: false, downloadedBytes: 6, totalBytes: 6},
    {done: true, downloadedBytes: 6, totalBytes: 6},
  ]);
});

test('HTTPS downloader treats a missing content length as an unknown total', async () => {
  const progress = [];
  await fetchHttpsBytes('https://example.test/file', {
    fetchImpl: async () => new Response(Buffer.from('content')),
    onProgress(value) {
      progress.push(value);
    },
  });

  assert.equal(progress[0].totalBytes, undefined);
  assert.equal(progress.at(-1).done, true);
  assert.equal(progress.at(-1).downloadedBytes, 7);
});

test('download progress reporter prints bounded readable progress', async () => {
  const module = await import('./deploy.mjs');
  assert.equal(typeof module.createDownloadProgressReporter, 'function');
  const output = [];
  const report = module.createDownloadProgressReporter('windows-amd64 package', {
    write: (line) => output.push(line),
  });

  report({done: false, downloadedBytes: 0, totalBytes: 10_000_000});
  report({done: false, downloadedBytes: 100, totalBytes: 10_000_000});
  report({done: false, downloadedBytes: 5_000_000, totalBytes: 10_000_000});
  report({done: true, downloadedBytes: 10_000_000, totalBytes: 10_000_000});

  assert.deepEqual(output, [
    '[deploy] Downloading windows-amd64 package: 0 B / 9.5 MB (0%)',
    '[deploy] Downloading windows-amd64 package: 4.8 MB / 9.5 MB (50%)',
    '[deploy] Downloading windows-amd64 package: 9.5 MB / 9.5 MB (100%)',
  ]);
});

test('launcher reports the selected release and operation', async () => {
  const deps = launcherFixture();
  deps.messages = [];
  deps.reportStatus = (message) => deps.messages.push(message);

  await runLauncher(['update'], deps);

  assert.deepEqual(deps.messages, [
    'Checking latest release',
    'Latest release: v1.7',
    'Deployment scripts are current',
    'Starting update to v1.7',
  ]);
});

test('launcher source contains one render marker and one stable path', async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(directory, '..', '..');
  const source = await readFile(resolve(repoRoot, 'scripts', 'deploy', 'deploy.mjs'), 'utf8');
  assert.equal(RELEASE_BASE_URL, '__WHEELMAKER_RELEASE_BASE_URL__');
  assert.equal(STABLE_PATH, '/stable.json');
  assert.equal(STABLE_URL, '__WHEELMAKER_RELEASE_BASE_URL__/stable.json');
  assert.equal(source.match(/__WHEELMAKER_RELEASE_BASE_URL__/g)?.length, 1);
});
