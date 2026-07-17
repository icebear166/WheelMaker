import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  buildRemoteInstallScript,
  deployReleaseServer,
} from './deploy.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('release server deploy uses fixed derived SSH defaults', async () => {
  const state = {
    builds: [],
    cleanups: [],
    healthChecks: [],
    installs: [],
    remoteChecks: [],
    uploads: [],
  };
  const dependencies = recordingDependencies(state);

  const result = await deployReleaseServer(dependencies);

  assert.equal(result.host, 'release.wheelmaker.top');
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.deepEqual(state.remoteChecks, [{
    host: 'release.wheelmaker.top',
    identityFile: 'C:\\Users\\tester\\.ssh\\wheelmaker-release-server_ed25519',
    port: 22,
    user: 'root',
  }]);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].files.length, 5);
  assert.deepEqual(
    state.uploads[0].files.map(path => path.split(/[\\/]/).at(-1)).sort(),
    [
      'index.html',
      'nginx-bootstrap.conf',
      'nginx.conf',
      'wheelmaker-release-server',
      'wheelmaker-release-server.service',
    ],
  );
  assert.equal(
    state.uploads[0].files.some(path => path.endsWith('wheelmaker-release-server_ed25519')),
    false,
  );
  assert.deepEqual(state.healthChecks, ['https://release.wheelmaker.top/healthz']);
  assert.equal(state.cleanups.length, 1);
});

test('release server deploy rejects a dirty tree and always cleans local staging', async () => {
  const state = {cleanups: []};
  const dependencies = recordingDependencies(state, {
    async sourceContext() {
      return {clean: false, sha: SOURCE_SHA};
    },
  });

  await assert.rejects(deployReleaseServer(dependencies), /clean source tree/);

  assert.equal(state.cleanups.length, 1);
});

test('remote install script is idempotent and preserves public releases and config', () => {
  const script = buildRemoteInstallScript();

  assert.match(script, /id -u wheelmaker-release/);
  assert.match(script, /if \[ ! -f \/etc\/wheelmaker-release-server\/config\.json \]/);
  assert.match(script, /127\.0\.0\.1:9680/);
  assert.match(script, /systemctl daemon-reload/);
  assert.match(script, /certbot certonly --webroot/);
  assert.match(script, /nginx -t/);
  assert.doesNotMatch(script, /rm -rf[^\n]*public\/releases/);
  assert.doesNotMatch(script, /PRIVATE KEY|wheelmaker-release-server_ed25519/);
});

test('templates enforce non-root loopback service and API without wildcard CORS', async () => {
  const unit = await readFile(new URL('./wheelmaker-release-server.service', import.meta.url), 'utf8');
  const nginx = await readFile(new URL('./nginx.conf', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('./nginx-bootstrap.conf', import.meta.url), 'utf8');

  assert.match(unit, /^User=wheelmaker-release$/m);
  assert.match(unit, /^Group=wheelmaker-release$/m);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=\/srv\/wheelmaker-release/);
  const api = nginx.slice(nginx.indexOf('location /api/'), nginx.indexOf('location = /healthz'));
  assert.match(api, /proxy_pass http:\/\/127\.0\.0\.1:9680/);
  assert.match(api, /proxy_request_buffering off/);
  assert.doesNotMatch(api, /Access-Control-Allow-Origin/);
  assert.match(nginx, /ssl_certificate \/etc\/letsencrypt\/live\/release\.wheelmaker\.top\/fullchain\.pem/);
  assert.match(bootstrap, /\.well-known\/acme-challenge/);
  assert.doesNotMatch(bootstrap, /ssl_certificate/);
});

function recordingDependencies(state, overrides = {}) {
  return {
    channel: {baseUrl: 'https://release.wheelmaker.top'},
    homeDirectory: 'C:\\Users\\tester',
    repoRoot: 'D:\\Code\\WheelMaker',
    async sourceContext() {
      return {clean: true, sha: SOURCE_SHA};
    },
    async ensureTools() {},
    async checkRemote(remote) {
      state.remoteChecks ??= [];
      state.remoteChecks.push(remote);
      return {architecture: 'amd64', operatingSystem: 'Linux'};
    },
    async build(options) {
      state.builds ??= [];
      state.builds.push(options);
    },
    async upload(options) {
      state.uploads ??= [];
      state.uploads.push(options);
    },
    async install(options) {
      state.installs ??= [];
      state.installs.push(options);
    },
    async health(url) {
      state.healthChecks ??= [];
      state.healthChecks.push(url);
    },
    async cleanup(path) {
      state.cleanups ??= [];
      state.cleanups.push(path);
    },
    write() {},
    ...overrides,
  };
}
