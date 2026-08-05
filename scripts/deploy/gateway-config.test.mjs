import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  configureWorkspaceSite,
  gatewayConfigPaths,
  parseGatewayOptions,
  promptWorkspaceSite,
  validateGatewaySite,
} from './gateway-config.mjs';

test('Gateway config validates loopback workspace site and writes only workspace file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const result = await configureWorkspaceSite({
    home: root,
    write: true,
    site: {
      schema: 1,
      kind: 'workspace',
      publicUrl: 'https://workspace.example.com',
      webRoot: join(root, 'web'),
      upstream: 'http://127.0.0.1:9630',
      tls: {certificateFile: '', keyFile: ''},
    },
  });
  assert.equal(result.written, true);
  assert.equal(JSON.parse(await readFile(gatewayConfigPaths(root).workspace, 'utf8')).kind, 'workspace');
  assert.equal(result.paths.releaseServer.endsWith('release-server.json'), true);
});

test('negative Workspace prompt leaves an existing site untouched', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-gateway-prompt-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const original = {
    schema: 1,
    kind: 'workspace',
    publicUrl: 'http://old.example.com',
    webRoot: join(root, 'web'),
    upstream: 'http://127.0.0.1:9630',
    tls: {certificateFile: '', keyFile: ''},
  };
  await configureWorkspaceSite({home: root, write: true, site: original});
  const before = await readFile(gatewayConfigPaths(root).workspace, 'utf8');
  const result = await configureWorkspaceSite({
    home: root,
    interactive: true,
    ask: async () => 'n',
  });
  assert.equal(result.written, false);
  assert.equal(await readFile(gatewayConfigPaths(root).workspace, 'utf8'), before);
});

test('Gateway options require an explicit noninteractive write or skip', () => {
  assert.deepEqual(parseGatewayOptions(['--gateway-write', '--gateway-public-url=https://example.com']), {
    explicit: true,
    mode: 'write',
    values: {publicUrl: 'https://example.com'},
    commandArgs: [],
  });
  assert.equal(parseGatewayOptions(['--gateway-skip']).mode, 'skip');
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
