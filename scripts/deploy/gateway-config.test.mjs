import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';

import {
  defaultGatewayConfiguration,
  ensureGatewayConfiguration,
  gatewayConfigPaths,
  parsePublicURLDeploymentOptions,
  readGatewayConfiguration,
  validateGatewayGlobal,
} from './deploy-core.mjs';

test('Gateway global config owns complete registry, release, and share sections', () => {
  const config = {
    schema: 1,
    acme: {email: ''},
    log: {level: 'info'},
    relay: {listenPort: 0},
    registry: {publicUrl: '', tls: {certificateFile: '', keyFile: ''}},
    release: {
      publicUrl: '',
      listen: '127.0.0.1:9680',
      dataRoot: '/home/alice/.wheelmaker/release-server/data',
      tokenSha256: '',
      tls: {certificateFile: '', keyFile: ''},
    },
    share: {publicUrl: '', tls: {certificateFile: '', keyFile: ''}},
  };
  assert.deepEqual(validateGatewayGlobal(config), config);
});

test('Gateway default config contains blank URLs and complete release runtime fields', () => {
  const home = '/home/alice/.wheelmaker/gateway';
  assert.deepEqual(defaultGatewayConfiguration(home), {
    schema: 1,
    acme: {email: ''},
    log: {level: 'info'},
    relay: {listenPort: 0},
    registry: {publicUrl: '', tls: {certificateFile: '', keyFile: ''}},
    release: {
      publicUrl: '',
      listen: '127.0.0.1:9680',
      dataRoot: resolve(home, '..', 'release-server', 'data'),
      tokenSha256: '',
      tls: {certificateFile: '', keyFile: ''},
    },
    share: {publicUrl: '', tls: {certificateFile: '', keyFile: ''}},
  });
});

test('Gateway deployment materializes the full config once and preserves existing URLs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);

  const first = await ensureGatewayConfiguration(root);
  assert.equal(first.registry.publicUrl, '');
  assert.equal(first.release.publicUrl, '');
  assert.equal(first.share.publicUrl, '');
  assert.deepEqual(JSON.parse(await readFile(paths.config, 'utf8')), first);

  await writeFile(paths.config, JSON.stringify({...first, registry: {...first.registry, publicUrl: 'https://registry.example.com'}}));
  const second = await ensureGatewayConfiguration(root);
  assert.equal(second.registry.publicUrl, 'https://registry.example.com');
  assert.equal(second.release.dataRoot, first.release.dataRoot);
});

test('Gateway configuration reads only config.json and ignores legacy site files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-single-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  const config = defaultGatewayConfiguration(root);
  await writeFile(paths.config, JSON.stringify(config));
  const legacySitePath = join(paths.home, 'sites', 'workspace.json');
  await mkdir(dirname(legacySitePath), {recursive: true});
  await writeFile(legacySitePath, JSON.stringify({publicUrl: 'https://ignored.example.com'}));

  const result = await readGatewayConfiguration(root);
  assert.deepEqual(result.global, config);
  assert.equal(result.registry.publicUrl, '');
  await access(legacySitePath);
});

test('deployment options accept one normalized business public URL', () => {
  assert.deepEqual(parsePublicURLDeploymentOptions([]), {
    commandArgs: [],
    publicUrl: undefined,
  });
  assert.deepEqual(
    parsePublicURLDeploymentOptions(['--public-url=https://workspace.example.com:8443/']),
    {commandArgs: [], publicUrl: 'https://workspace.example.com:8443'},
  );
  assert.deepEqual(
    parsePublicURLDeploymentOptions(['--public-url=workspace.example.com']),
    {commandArgs: [], publicUrl: 'https://workspace.example.com'},
  );
  assert.deepEqual(
    parsePublicURLDeploymentOptions(['update']),
    {commandArgs: ['update'], publicUrl: undefined},
  );
  assert.throws(() => parsePublicURLDeploymentOptions([
    '--public-url=https://one.example.com',
    '--public-url=https://two.example.com',
  ]), /only be specified once/);
  assert.throws(
    () => parsePublicURLDeploymentOptions(['--public-url=https://example.com/path']),
    /only scheme, host, optional port/,
  );
});

test('Gateway rejects invalid relay and release runtime fields', () => {
  assert.throws(() => validateGatewayGlobal({relay: {listenPort: 9680}}), /reserved/);
  assert.throws(() => validateGatewayGlobal({release: {dataRoot: 'relative'}}), /absolute/);
  assert.throws(() => validateGatewayGlobal({release: {tokenSha256: 'A'.repeat(64)}}), /lowercase/);
});
