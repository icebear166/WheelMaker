import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  RELEASE_PUBLIC_KEY_PEM,
  acquireUpdateLease,
  createRuntimeAdapter,
  darwinRuntimeFiles,
  finishUpdate,
  linuxRuntimeFiles,
  runCore,
  stageVerifiedRelease,
  unixWrappers,
  windowsRuntimePlan,
  windowsWrappers,
} from './deploy-core.mjs';
import {
  encodeJsonBytes,
  sha256Bytes,
  signBytes,
} from '../release/metadata.mjs';
import { createTarGz } from '../release/tar.mjs';

const RUNTIME_PATHS = {
  bin: 'C:\\Users\\alice\\.wheelmaker\\bin',
  deploy: 'C:\\Users\\alice\\.wheelmaker\\deploy.mjs',
  home: 'C:\\Users\\alice\\.wheelmaker',
  hub: 'C:\\Users\\alice\\.wheelmaker\\bin\\wheelmaker.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  uid: 501,
  userHome: 'C:\\Users\\alice',
};

test('core embeds the same release verification key as the source publisher', async () => {
  assert.equal(
    RELEASE_PUBLIC_KEY_PEM,
    await readFile(new URL('../release/release-public-key.pem', import.meta.url), 'utf8'),
  );
});

test('Windows plan contains current-user tasks and fixed 03:00 updater', () => {
  const plan = windowsRuntimePlan(RUNTIME_PATHS);
  assert.deepEqual(plan.names, ['WheelMaker', 'WheelMakerUpdater']);
  assert.match(plan.script, /AtLogOn/);
  assert.match(plan.script, /03:00/);
  assert.match(plan.script, /RunLevel Limited/);
  assert.doesNotMatch(plan.script, /sc\.exe create/i);
  assert.doesNotMatch(plan.script, /New-Service/i);
});

test('Linux files contain Hub service plus one-shot updater timer', () => {
  const files = linuxRuntimeFiles({
    ...RUNTIME_PATHS,
    deploy: '/home/alice/.wheelmaker/deploy.mjs',
    home: '/home/alice/.wheelmaker',
    hub: '/home/alice/.wheelmaker/bin/wheelmaker',
    node: '/usr/bin/node',
    userHome: '/home/alice',
  });
  assert.match(files['wheelmaker-hub.service'], /Restart=always/);
  assert.match(files['wheelmaker-updater.service'], /Type=oneshot/);
  assert.match(files['wheelmaker-updater.service'], /deploy\.mjs.*update/);
  assert.match(
    files['wheelmaker-updater.timer'],
    /OnCalendar=\*-\*-\* 03:00:00/,
  );
});

test('macOS files keep Hub alive and schedule updater at 03:00', () => {
  const files = darwinRuntimeFiles({
    ...RUNTIME_PATHS,
    deploy: '/Users/alice/.wheelmaker/deploy.mjs',
    home: '/Users/alice/.wheelmaker',
    hub: '/Users/alice/.wheelmaker/bin/wheelmaker',
    node: '/usr/local/bin/node',
    userHome: '/Users/alice',
  });
  assert.match(files['com.wheelmaker.hub.plist'], /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(files['com.wheelmaker.updater.plist'], /<key>Hour<\/key>\s*<integer>3<\/integer>/);
  assert.match(files['com.wheelmaker.updater.plist'], /<key>Minute<\/key>\s*<integer>0<\/integer>/);
});

test('helper wrappers preserve existing filenames and call grouped runtime actions', () => {
  const windows = windowsWrappers(RUNTIME_PATHS);
  const unix = unixWrappers({
    ...RUNTIME_PATHS,
    deploy: '/home/alice/.wheelmaker/deploy.mjs',
    node: '/usr/bin/node',
  });
  const expected = ['restart', 'start', 'status', 'stop'];
  assert.deepEqual(
    Object.keys(windows).sort(),
    expected.map((name) => `${name}.bat`),
  );
  assert.deepEqual(
    Object.keys(unix).sort(),
    expected.map((name) => `${name}.sh`),
  );
  assert.match(windows['start.bat'], /deploy\.mjs" runtime start/);
  assert.match(unix['status.sh'], /deploy\.mjs' runtime status/);
});

test('internal update restarts existing runtime without mutating registration', async () => {
  const events = [];
  const runtime = {
    async configureRuntime() {
      events.push('configureRuntime');
    },
    async removeRuntime() {
      events.push('removeRuntime');
    },
    async start() {
      events.push('start');
    },
    async stop() {
      events.push('stop');
    },
    async writeWrappers() {
      events.push('writeWrappers');
    },
  };

  await runCore(['update'], {
    async applyUpdate() {
      events.push('applyUpdate');
    },
    runtime,
  });
  assert.deepEqual(events, ['stop', 'applyUpdate', 'start']);
});

test('runtime command builds a default adapter from the install directory', async () => {
  let capturedPaths;
  let statusCalls = 0;
  await runCore(['runtime', 'status'], {
    installDirectory: 'C:\\Users\\alice\\.wheelmaker',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    runtimeFactory({ paths }) {
      capturedPaths = paths;
      return {
        async status() {
          statusCalls += 1;
        },
      };
    },
    userHome: 'C:\\Users\\alice',
  });
  assert.equal(capturedPaths.hub.endsWith('bin\\wheelmaker.exe'), true);
  assert.equal(statusCalls, 1);
});

test('Windows runtime status is limited to the known task and installed Hub path', async () => {
  const calls = [];
  const adapter = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    async runner(command, args) {
      calls.push({ args, command });
      return { code: 0, stderr: '', stdout: '' };
    },
  });
  await adapter.status();
  const script = calls[0].args.at(-1);
  assert.match(script, /TaskName 'WheelMaker'/);
  assert.match(script, /Win32_Process/);
  assert.equal(script.includes(RUNTIME_PATHS.bin), true);
  assert.doesNotMatch(script, /WheelMakerMonitor/);
});

test('only one update lease can be created atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-lease-'));
  try {
    assert.equal(
      await acquireUpdateLease(root, {
        jobId: 'job-a',
        now: '2026-07-16T09:00:00.000Z',
        owner: 'web',
      }),
      true,
    );
    assert.equal(
      await acquireUpdateLease(root, {
        jobId: 'job-b',
        now: '2026-07-16T09:01:00.000Z',
        owner: 'timer',
      }),
      false,
    );
    const lock = JSON.parse(await readFile(join(root, 'lock.json'), 'utf8'));
    assert.equal(lock.jobId, 'job-a');
    assert.equal(lock.state, 'queued');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('terminal status removes matching lock but persists status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-finish-'));
  try {
    await acquireUpdateLease(root, {
      jobId: 'job-a',
      now: '2026-07-16T09:00:00.000Z',
      owner: 'web',
    });
    await finishUpdate(root, {
      errorCode: 'download_failed',
      jobId: 'job-a',
      now: '2026-07-16T09:02:00.000Z',
      state: 'failed',
    });
    assert.equal(await exists(join(root, 'lock.json')), false);
    const status = JSON.parse(await readFile(join(root, 'status.json'), 'utf8'));
    assert.equal(status.state, 'failed');
    assert.equal(status.errorCode, 'download_failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale lease is reclaimed only when updater is not running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-stale-'));
  try {
    await acquireUpdateLease(root, {
      jobId: 'old-job',
      now: '2026-07-16T06:00:00.000Z',
      owner: 'timer',
    });
    assert.equal(
      await acquireUpdateLease(
        root,
        {
          jobId: 'blocked-job',
          now: '2026-07-16T09:00:01.000Z',
          owner: 'web',
        },
        { isUpdaterRunning: async () => true },
      ),
      false,
    );
    assert.equal(
      await acquireUpdateLease(
        root,
        {
          jobId: 'new-job',
          now: '2026-07-16T09:00:02.000Z',
          owner: 'web',
        },
        { isUpdaterRunning: async () => false },
      ),
      true,
    );
    const lock = JSON.parse(await readFile(join(root, 'lock.json'), 'utf8'));
    assert.equal(lock.jobId, 'new-job');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manifest and completed archive are verified before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-stage-'));
  const source = join(root, 'source');
  const archivePath = join(root, 'package.tar.gz');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  try {
    await mkdir(join(source, 'hub'), { recursive: true });
    await mkdir(join(source, 'web'), { recursive: true });
    await writeFile(join(source, 'hub', 'wheelmaker.exe'), 'hub');
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await createTarGz({ outputPath: archivePath, sourceDir: source });
    const archiveBytes = await readFile(archivePath);
    const manifest = {
      schema: 1,
      version: 'v1.7',
      publishedAt: '2026-07-16T09:00:00.000Z',
      sourceSha: '0'.repeat(40),
      artifacts: {
        'windows-amd64': {
          sha256: sha256Bytes(archiveBytes),
          size: archiveBytes.length,
          url: 'https://release.example/windows.tar.gz',
        },
      },
    };
    const manifestBytes = encodeJsonBytes(manifest);
    const stable = {
      schema: 1,
      version: 'v1.7',
      sourceSha: '0'.repeat(40),
      release: {
        manifestSha256: sha256Bytes(manifestBytes),
        manifestUrl: 'https://release.example/release-manifest.json',
      },
    };
    const downloads = new Map([
      [stable.release.manifestUrl, manifestBytes],
      [
        `${stable.release.manifestUrl}.sig`,
        Buffer.from(`${signBytes(manifestBytes, privateKey)}\n`),
      ],
      [manifest.artifacts['windows-amd64'].url, archiveBytes],
    ]);

    const result = await stageVerifiedRelease({
      fetchBytes: async (url) => downloads.get(url),
      jobId: 'job-a',
      platform: 'windows-amd64',
      publicKey,
      stable,
      stagingDirectory: join(root, 'staging'),
    });
    assert.equal(
      await readFile(join(result.extractionDirectory, 'hub', 'wheelmaker.exe'), 'utf8'),
      'hub',
    );

    const tamperedArchive = Buffer.from(archiveBytes);
    tamperedArchive[tamperedArchive.length - 1] ^= 0xff;
    downloads.set(manifest.artifacts['windows-amd64'].url, tamperedArchive);
    await assert.rejects(
      () =>
        stageVerifiedRelease({
          fetchBytes: async (url) => downloads.get(url),
          jobId: 'job-b',
          platform: 'windows-amd64',
          publicKey,
          stable,
          stagingDirectory: join(root, 'staging'),
        }),
      /archive SHA-256 verification failed/,
    );
    assert.equal(await exists(join(root, 'staging', 'job-b', 'package')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
