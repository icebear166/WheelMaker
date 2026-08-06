import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  configureWorkspaceSite,
  gatewayConfigPaths,
  parsePublicURLDeploymentOptions,
  validateGatewaySite,
} from './deploy-core.mjs';

test('Gateway config validates loopback workspace site and writes only workspace file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const result = await configureWorkspaceSite({
    home: root,
    publicUrl: 'https://workspace.example.com',
    webRoot: join(root, 'web'),
  });
  assert.equal(result.written, true);
  assert.equal(JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8')).kind, 'workspace');
  await assert.rejects(
    () => access(gatewayConfigPaths(root).releaseServer),
    {code: 'ENOENT'},
  );
});

test('deployment options accept one normalized business public URL', () => {
  assert.deepEqual(parsePublicURLDeploymentOptions([]), {
    commandArgs: [],
    publicUrl: undefined,
  });
  assert.deepEqual(
    parsePublicURLDeploymentOptions([
      '--public-url=https://workspace.example.com:8443/',
    ]),
    {
      commandArgs: [],
      publicUrl: 'https://workspace.example.com:8443',
    },
  );
  assert.deepEqual(
    parsePublicURLDeploymentOptions(['--public-url=workspace.example.com']),
    {
      commandArgs: [],
      publicUrl: 'https://workspace.example.com',
    },
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

test('Workspace site generation always uses the business public URL', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-caddy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const webRoot = join(root, 'web');
  await configureWorkspaceSite({
    home: root,
    publicUrl: 'https://old.example.com',
    webRoot,
  });
  await configureWorkspaceSite({
    home: root,
    publicUrl: 'https://new.example.com',
    webRoot,
  });
  const site = JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8'));
  assert.equal(site.publicUrl, 'https://new.example.com');
  assert.equal(site.webRoot, resolve(webRoot));
  assert.equal(site.upstream, 'http://127.0.0.1:9630');
  assert.deepEqual(site.tls, {certificateFile: '', keyFile: ''});
});

test('Workspace writes do not validate or replace another component site', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-owner-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const paths = gatewayConfigPaths(root);
  await mkdir(paths.sites, {recursive: true});
  await writeFile(paths.releaseServer, '{"ownedBy":"release-server"}\n');
  const before = await readFile(paths.releaseServer, 'utf8');
  await configureWorkspaceSite({
    home: root,
    publicUrl: 'https://workspace.example.com',
    webRoot: join(root, 'web'),
  });
  assert.equal(await readFile(paths.releaseServer, 'utf8'), before);
});

test('Gateway site rejects non-loopback upstreams and incomplete TLS', () => {
  assert.throws(() => validateGatewaySite({
    schema: 1,
    kind: 'workspace',
    publicUrl: 'https://example.com',
    webRoot: 'C:\\web',
    upstream: 'http://10.0.0.1:9630',
    tls: {certificateFile: '', keyFile: ''},
  }), /loopback/);
  assert.throws(() => validateGatewaySite({
    schema: 1,
    kind: 'workspace',
    publicUrl: 'https://example.com',
    webRoot: 'C:\\web',
    upstream: 'http://127.999.0.1:9630',
    tls: {certificateFile: '', keyFile: ''},
  }), /loopback/);
  assert.throws(() => validateGatewaySite({
    schema: 1,
    kind: 'workspace',
    publicUrl: 'https://example.com',
    webRoot: '/web',
    upstream: 'http://127.0.0.1:9630',
    tls: {certificateFile: '/tmp/cert.pem', keyFile: ''},
  }), /pair/);
  assert.throws(() => validateGatewaySite({
    schema: 1,
    kind: 'workspace',
    publicUrl: 'https://example.com',
    webRoot: '/web',
    upstream: 'http://127.0.0.1:9630',
    tls: {certificateFile: '', keyFile: ''},
    routes: [],
  }), /unsupported field/);
});

test('Release Server site is a reverse proxy and rejects static roots', () => {
  assert.deepEqual(validateGatewaySite({
    schema: 1,
    kind: 'release-server',
    publicUrl: 'https://release.example.com',
    upstream: 'http://127.0.0.1:9680',
    tls: {certificateFile: '', keyFile: ''},
  }), {
    schema: 1,
    kind: 'release-server',
    publicUrl: 'https://release.example.com',
    upstream: 'http://127.0.0.1:9680',
    tls: {certificateFile: '', keyFile: ''},
  });
  assert.throws(() => validateGatewaySite({
    schema: 1,
    kind: 'release-server',
    publicUrl: 'https://release.example.com',
    publicRoot: 'C:\\releases',
    upstream: 'http://127.0.0.1:9680',
    tls: {certificateFile: '', keyFile: ''},
  }), /publicRoot/);
});
