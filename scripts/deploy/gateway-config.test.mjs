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

test('Gateway global config owns TLS and Release sections', () => {
  const config = {
    schema: 1,
    acme: {email: ''},
    registry: {tls: {certificateFile: '', keyFile: ''}},
    release: {
      publicUrl: '',
      listen: '127.0.0.1:9680',
      dataRoot: '/home/alice/.wheelmaker/release-server/data',
      tokenSha256: '',
      tls: {certificateFile: '', keyFile: ''},
    },
    share: {tls: {certificateFile: '', keyFile: ''}},
  };
  assert.deepEqual(validateGatewayGlobal(config), config);
});

test('Gateway default config contains blank URLs and complete release runtime fields', () => {
  const home = '/home/alice/.wheelmaker/gateway';
  assert.deepEqual(defaultGatewayConfiguration(home), {
    schema: 1,
    acme: {email: ''},
    registry: {tls: {certificateFile: '', keyFile: ''}},
    release: {
      publicUrl: '',
      listen: '127.0.0.1:9680',
      dataRoot: resolve(home, '..', 'release-server', 'data'),
      tokenSha256: '',
      tls: {certificateFile: '', keyFile: ''},
    },
    share: {tls: {certificateFile: '', keyFile: ''}},
  });
});

test('Gateway deployment materializes the full config once and preserves existing URLs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);

  const first = await ensureGatewayConfiguration(root);
  assert.deepEqual(first.registry, {tls: {certificateFile: '', keyFile: ''}});
  assert.equal(first.release.publicUrl, '');
  assert.deepEqual(first.share, {tls: {certificateFile: '', keyFile: ''}});
  assert.deepEqual(JSON.parse(await readFile(paths.config, 'utf8')), first);

  await writeFile(paths.config, JSON.stringify({...first, release: {...first.release, publicUrl: 'https://release.example.com'}}));
  const second = await ensureGatewayConfiguration(root);
  assert.equal(second.release.publicUrl, 'https://release.example.com');
  assert.equal(second.release.dataRoot, first.release.dataRoot);
});

test('Gateway duplicate fields migrate into an existing Hub config without overriding canonical values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-migration-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const stateRoot = join(root, 'state');
  const home = join(stateRoot, 'gateway');
  const paths = gatewayConfigPaths(home);
  await mkdir(stateRoot, {recursive: true});
  await writeFile(join(stateRoot, 'config.json'), JSON.stringify({
    projects: [],
    publicUrl: 'https://canonical.example.com',
    log: {level: 'warn'},
    registry: {
      listen: true,
      relayPort: 28811,
      share: {publicUrl: 'https://canonical-share.example.com'},
    },
  }));
  await mkdir(paths.home, {recursive: true});
  await writeFile(paths.config, JSON.stringify({
    schema: 1,
    acme: {email: ''},
    log: {level: 'debug'},
    relay: {listenPort: 28810},
    registry: {publicUrl: 'https://legacy.example.com', tls: {certificateFile: '', keyFile: ''}},
    release: {publicUrl: '', listen: '127.0.0.1:9680', dataRoot: paths.releaseDataRoot, tokenSha256: '', tls: {certificateFile: '', keyFile: ''}},
    share: {publicUrl: 'https://legacy-share.example.com', tls: {certificateFile: '', keyFile: ''}},
  }));

  const normalized = await ensureGatewayConfiguration(home);
  assert.deepEqual(normalized.registry, {tls: {certificateFile: '', keyFile: ''}});
  assert.deepEqual(normalized.share, {tls: {certificateFile: '', keyFile: ''}});
  assert.equal('log' in normalized, false);
  assert.equal('relay' in normalized, false);
  assert.equal('publicUrl' in normalized.registry, false);
  assert.equal('publicUrl' in normalized.share, false);

  const hub = JSON.parse(await readFile(join(stateRoot, 'config.json'), 'utf8'));
  assert.equal(hub.publicUrl, 'https://canonical.example.com');
  assert.equal(hub.registry.relayPort, 28811);
  assert.equal(hub.registry.share.publicUrl, 'https://canonical-share.example.com');
});

test('Gateway duplicate fields populate missing Hub shared values during migration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-migration-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const stateRoot = join(root, 'state');
  const home = join(stateRoot, 'gateway');
  const paths = gatewayConfigPaths(home);
  await mkdir(stateRoot, {recursive: true});
  await writeFile(join(stateRoot, 'config.json'), JSON.stringify({projects: [], registry: {listen: true}}));
  await mkdir(paths.home, {recursive: true});
  await writeFile(paths.config, JSON.stringify({
    schema: 1,
    registry: {publicUrl: 'https://legacy.example.com', tls: {certificateFile: '', keyFile: ''}},
    release: {publicUrl: '', dataRoot: paths.releaseDataRoot, tokenSha256: '', tls: {certificateFile: '', keyFile: ''}},
    relay: {listenPort: 28810},
    share: {publicUrl: 'https://legacy-share.example.com', tls: {certificateFile: '', keyFile: ''}},
  }));

  await ensureGatewayConfiguration(home);
  const hub = JSON.parse(await readFile(join(stateRoot, 'config.json'), 'utf8'));
  assert.equal(hub.publicUrl, 'https://legacy.example.com');
  assert.equal(hub.registry.relayPort, 28810);
  assert.equal(hub.registry.share.publicUrl, 'https://legacy-share.example.com');
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
  assert.deepEqual(result.registry, {tls: {certificateFile: '', keyFile: ''}});
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

test('Gateway rejects shared duplicate fields and invalid release runtime fields', () => {
  assert.throws(() => validateGatewayGlobal({log: {level: 'debug'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({relay: {listenPort: 28810}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({registry: {publicUrl: 'https://registry.example.com'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({share: {publicUrl: 'https://share.example.com'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({release: {dataRoot: 'relative'}}), /absolute/);
  assert.throws(() => validateGatewayGlobal({release: {tokenSha256: 'A'.repeat(64)}}), /lowercase/);
});
