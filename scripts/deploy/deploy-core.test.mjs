import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  RELEASE_PUBLIC_KEY_PEM,
  acquireUpdateLease,
  finishUpdate,
  stageVerifiedRelease,
} from './deploy-core.mjs';
import {
  encodeJsonBytes,
  sha256Bytes,
  signBytes,
} from '../release/metadata.mjs';
import { createTarGz } from '../release/tar.mjs';

test('core embeds the same release verification key as the source publisher', async () => {
  assert.equal(
    RELEASE_PUBLIC_KEY_PEM,
    await readFile(new URL('../release/release-public-key.pem', import.meta.url), 'utf8'),
  );
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
