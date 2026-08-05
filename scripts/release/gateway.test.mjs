import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  GATEWAY_TARGETS,
  buildGatewayRelease,
  packageGatewayArtifacts,
} from './gateway.mjs';

test('Gateway release target matrix matches the supported host platforms', () => {
  assert.deepEqual(GATEWAY_TARGETS.map(target => target.key), [
    'windows-amd64',
    'linux-amd64',
    'darwin-amd64',
    'darwin-arm64',
  ]);
});

test('Gateway builder compiles four versioned binaries with the unified release identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-build-'));
  const calls = [];
  try {
    await mkdir(join(root, 'server'), { recursive: true });
    const result = await buildGatewayRelease({
      repoRoot: root,
      sourceSha: 'a'.repeat(40),
      stagingRoot: join(root, 'staging'),
      version: 'v1.8',
      runner: async (command, args, options) => {
        calls.push({ command, args, options });
        const output = args[args.indexOf('-o') + 1];
        await mkdir(join(output, '..'), { recursive: true });
        await writeFile(output, basename(output));
      },
    });

    assert.equal(result.platforms.length, 4);
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.command, 'go');
      assert.equal(call.args.at(-1), './cmd/wheelmaker-gateway');
      assert.match(call.args.join(' '), /main\.version=v1\.8/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gateway packaging creates fixed-namespace manifest metadata and checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-package-'));
  try {
    const platforms = [];
    for (const target of GATEWAY_TARGETS) {
      const directory = join(root, target.key);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, target.binary), `gateway-${target.key}`);
      platforms.push({ ...target, directory });
    }

    const packaged = await packageGatewayArtifacts({
      outputRoot: join(root, 'out'),
      platforms,
      publishedAt: '2026-08-05T00:00:00Z',
      sourceSha: 'b'.repeat(40),
      stagingRoot: join(root, 'staging'),
      version: 'v1.8',
    });
    const manifest = JSON.parse(await readFile(packaged.manifestPath, 'utf8'));
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.version, 'v1.8');
    assert.equal(manifest.sourceSha, 'b'.repeat(40));
    assert.deepEqual(Object.keys(manifest.artifacts).sort(), GATEWAY_TARGETS.map(({ key }) => key).sort());
    for (const artifact of Object.values(manifest.artifacts)) {
      assert.match(artifact.path, /^\/gateway\/current\/wheelmaker-gateway-v1\.8-/);
      assert.equal(Number.isSafeInteger(artifact.size), true);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    }
    assert.match(manifest.path, /^\/gateway\/current\/gateway-manifest\.json$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
