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

test('Gateway global config owns shared TLS and fixed wm_sites sections', () => {
  const config = {
    schema: 2,
    acme: {email: ''},
    wm_sites: {
      tls: {certificateFile: '', keyFile: ''},
      registry: {urlMode: 'sync_hub'},
      release: {
        publicUrl: '',
        listen: '127.0.0.1:9680',
        dataRoot: '/home/alice/.wheelmaker/release-server/data',
        tokenSha256: '',
      },
      share: {urlMode: 'sync_hub'},
    },
  };
  assert.deepEqual(validateGatewayGlobal(config), config);
});

test('Gateway default config contains blank URLs and complete release runtime fields', () => {
  const home = '/home/alice/.wheelmaker/gateway';
  assert.deepEqual(defaultGatewayConfiguration(home), {
    schema: 2,
    acme: {email: ''},
    wm_sites: {
      tls: {certificateFile: '', keyFile: ''},
      registry: {urlMode: 'sync_hub'},
      release: {
        publicUrl: '',
        listen: '127.0.0.1:9680',
        dataRoot: resolve(home, '..', 'release-server', 'data'),
        tokenSha256: '',
      },
      share: {urlMode: 'sync_hub'},
    },
  });
});

test('Gateway deployment materializes the full config once and preserves existing URLs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);

  const first = await ensureGatewayConfiguration(root);
  assert.equal(paths.customSitesRoot, join(root, 'sites'));
  await access(paths.customSitesRoot);
  assert.deepEqual(first.wm_sites.registry, {urlMode: 'sync_hub'});
  assert.equal(first.wm_sites.release.publicUrl, '');
  assert.deepEqual(first.wm_sites.share, {urlMode: 'sync_hub'});
  assert.deepEqual(JSON.parse(await readFile(paths.config, 'utf8')), first);

  await writeFile(paths.config, JSON.stringify({
    ...first,
    wm_sites: {
      ...first.wm_sites,
      release: {...first.wm_sites.release, publicUrl: 'https://release.example.com'},
    },
  }));
  const customSite = join(paths.customSitesRoot, 'existing.caddy');
  const customSiteBytes = 'existing.example.com { reverse_proxy 127.0.0.1:3000 }\n';
  await writeFile(customSite, customSiteBytes);
  const second = await ensureGatewayConfiguration(root);
  assert.equal(second.wm_sites.release.publicUrl, 'https://release.example.com');
  assert.equal(second.wm_sites.release.dataRoot, first.wm_sites.release.dataRoot);
  assert.equal(await readFile(customSite, 'utf8'), customSiteBytes);
});

test('Gateway schema 1 is rejected without modifying its bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-no-migration-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  const original = '{\n  "schema": 1,\n  "release": {"publicUrl": "https://legacy.example.com"}\n}\n';
  await writeFile(paths.config, original);

  await assert.rejects(() => ensureGatewayConfiguration(root), /schema 1/);
  assert.equal(await readFile(paths.config, 'utf8'), original);
});

test('Gateway schema 2 defaults missing Registry and Share urlMode', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-url-mode-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  await writeFile(paths.config, JSON.stringify({
    schema: 2,
    acme: {email: ''},
    wm_sites: {
      tls: {certificateFile: '', keyFile: ''},
      registry: {},
      release: {dataRoot: paths.releaseDataRoot},
      share: {},
    },
  }));

  const normalized = await ensureGatewayConfiguration(root);
  assert.equal(normalized.wm_sites.registry.urlMode, 'sync_hub');
  assert.equal(normalized.wm_sites.share.urlMode, 'sync_hub');
  assert.deepEqual(JSON.parse(await readFile(paths.config, 'utf8')), normalized);
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
  assert.deepEqual(result.wmSites, config.wm_sites);
  assert.deepEqual(result.registry, {urlMode: 'sync_hub'});
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

test('Gateway rejects old sections, per-site TLS, and invalid wm_sites values', () => {
  assert.throws(() => validateGatewayGlobal({schema: 1}), /schema 1/);
  assert.throws(() => validateGatewayGlobal({log: {level: 'debug'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({relay: {listenPort: 28810}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({registry: {publicUrl: 'https://registry.example.com'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({release: {publicUrl: 'https://release.example.com'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({share: {publicUrl: 'https://share.example.com'}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({wm_sites: {registry: {tls: {}}}}), /unsupported field/);
  assert.throws(() => validateGatewayGlobal({wm_sites: {registry: {urlMode: 'manual'}}}), /urlMode/);
  assert.throws(() => validateGatewayGlobal({wm_sites: {release: {dataRoot: 'relative'}}}), /absolute/);
  assert.throws(() => validateGatewayGlobal({wm_sites: {release: {tokenSha256: 'A'.repeat(64)}}}), /lowercase/);
});
