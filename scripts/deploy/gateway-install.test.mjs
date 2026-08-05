import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createTarZst } from '../release/tar.mjs';
import { installGatewayFromStable, validateGatewayManifest } from './gateway-install.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('Gateway manifest requires fixed four-platform current paths', () => {
  const pointer = {
    version: 'v1.4',
    sourceSha: 'a'.repeat(40),
    manifestPath: '/gateway/current/gateway-manifest.json',
    manifestSha256: 'b'.repeat(64),
  };
  const artifacts = {};
  for (const target of ['windows-amd64', 'linux-amd64', 'darwin-amd64', 'darwin-arm64']) {
    artifacts[target] = {
      path: `/gateway/current/wheelmaker-gateway-v1.4-${target}.tar.zst`,
      size: 1,
      sha256: 'c'.repeat(64),
    };
  }
  assert.deepEqual(
    Object.keys(validateGatewayManifest({schema: 1, version: 'v1.4', sourceSha: 'a'.repeat(40), path: pointer.manifestPath, artifacts}, pointer)),
    ['windows-amd64', 'linux-amd64', 'darwin-amd64', 'darwin-arm64'],
  );
  artifacts['linux-amd64'].path = '/gateway/current/../../secret';
  assert.throws(() => validateGatewayManifest({schema: 1, version: 'v1.4', sourceSha: 'a'.repeat(40), path: pointer.manifestPath, artifacts}, pointer), /path/);
});
test('Gateway first install removes the registered service and files when health fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-install-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = join(root, 'source');
  await mkdir(source, {recursive: true});
  const binary = join(source, 'wheelmaker-gateway');
  await writeFile(binary, 'new-gateway');
  const archive = join(root, 'gateway.tar.zst');
  await createTarZst({sourceDir: source, outputPath: archive});
  const archiveBytes = await readFile(archive);
  const pointer = {
    version: 'v1.4',
    sourceSha: 'a'.repeat(40),
    manifestPath: '/gateway/current/gateway-manifest.json',
    manifestSha256: 'b'.repeat(64),
  };
  const artifact = {
    path: '/gateway/current/wheelmaker-gateway-v1.4-linux-amd64.tar.zst',
    size: archiveBytes.length,
    sha256: sha256(archiveBytes),
  };
  const manifest = {
    schema: 1,
    version: 'v1.4',
    publishedAt: '2026-08-05T00:00:00Z',
    sourceSha: pointer.sourceSha,
    path: pointer.manifestPath,
    artifacts: Object.fromEntries([
      ['windows-amd64', {...artifact, path: '/gateway/current/wheelmaker-gateway-v1.4-windows-amd64.tar.zst'}],
      ['linux-amd64', artifact],
      ['darwin-amd64', {...artifact, path: '/gateway/current/wheelmaker-gateway-v1.4-darwin-amd64.tar.zst'}],
      ['darwin-arm64', {...artifact, path: '/gateway/current/wheelmaker-gateway-v1.4-darwin-arm64.tar.zst'}],
    ]),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  pointer.manifestSha256 = sha256(manifestBytes);
  const calls = [];
  const runtime = {
    async stop() { calls.push('stop'); },
    async install() { calls.push('install'); },
    async health() { calls.push('health'); throw new Error('health failed'); },
    async uninstall() { calls.push('uninstall'); },
  };
  await assert.rejects(() => installGatewayFromStable({
    stable: {gateway: pointer},
    releaseBaseUrl: 'https://release.example.com',
    gatewayHome: join(root, 'gateway'),
    platformKey: 'linux-amd64',
    platform: 'linux',
    fetchBytes: async (url) => url.endsWith('gateway-manifest.json') ? manifestBytes : archiveBytes,
    gatewayRuntime: runtime,
    validateBinary: async () => {},
  }), /rollback/);
  assert.deepEqual(calls, ['stop', 'install', 'health', 'stop', 'uninstall']);
  await assert.rejects(
    () => access(join(root, 'gateway', 'bin', 'wheelmaker-gateway')),
    {code: 'ENOENT'},
  );
  await assert.rejects(
    () => access(join(root, 'gateway', 'state', 'release.json')),
    {code: 'ENOENT'},
  );
});
