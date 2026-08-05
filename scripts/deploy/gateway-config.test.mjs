import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  configureWorkspaceSite,
  gatewayConfigPaths,
  parseGatewayOptions,
  validateGatewaySite,
} from './gateway-config.mjs';

test('Gateway config validates loopback workspace site and writes only workspace file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const result = await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
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

test('Gateway options accept only none or caddy and default to none', () => {
  assert.deepEqual(parseGatewayOptions([]), {
    commandArgs: [],
    explicit: false,
    mode: 'none',
    publicUrl: undefined,
  });
  assert.equal(parseGatewayOptions(['--gateway=none']).mode, 'none');
  assert.deepEqual(
    parseGatewayOptions([
      '--gateway=caddy',
      '--gateway-public-url=https://workspace.example.com',
    ]),
    {
      commandArgs: [],
      explicit: true,
      mode: 'caddy',
      publicUrl: 'https://workspace.example.com',
    },
  );
  assert.throws(() => parseGatewayOptions(['--gateway=nginx']), /none or caddy/);
  assert.throws(() => parseGatewayOptions(['--gateway=caddy', '--gateway=none']), /only be specified once/);
  assert.throws(
    () => parseGatewayOptions(['--gateway=none', '--gateway-public-url=https://example.com']),
    /only valid with --gateway=caddy/,
  );
});

test('none mode does not read or create Gateway files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-none-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const missingHome = join(root, 'missing', 'gateway');
  assert.deepEqual(
    await configureWorkspaceSite({home: missingHome, mode: 'none'}),
    {written: false},
  );
  await assert.rejects(() => access(missingHome), {code: 'ENOENT'});
  const existingHome = join(root, 'existing', 'gateway');
  const paths = gatewayConfigPaths(existingHome);
  await mkdir(paths.sites, {recursive: true});
  await writeFile(paths.workspace, 'not-json\n');
  const before = await readFile(paths.workspace, 'utf8');
  assert.deepEqual(
    await configureWorkspaceSite({home: existingHome, mode: 'none'}),
    {written: false},
  );
  assert.equal(await readFile(paths.workspace, 'utf8'), before);
});

test('caddy mode reuses or explicitly replaces only Workspace publicUrl', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-caddy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const webRoot = join(root, 'web');
  await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://old.example.com',
    webRoot,
  });
  await configureWorkspaceSite({home: root, mode: 'caddy', webRoot});
  let site = JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8'));
  assert.equal(site.publicUrl, 'https://old.example.com');
  await configureWorkspaceSite({
    home: root,
    mode: 'caddy',
    publicUrl: 'https://new.example.com',
    webRoot,
  });
  site = JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8'));
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
    mode: 'caddy',
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
