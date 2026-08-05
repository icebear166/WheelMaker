import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapGateway,
  buildGatewayBootstrapScript,
  parseGatewayBootstrapArgs,
} from './bootstrap-gateway.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('Gateway bootstrap installs a fixed release-server home without starting', () => {
  const script = buildGatewayBootstrapScript();

  assert.match(script, /gateway_home="\/srv\/wheelmaker-release\/gateway"/);
  assert.match(script, /wheelmaker-gateway\.service/);
  assert.match(script, /User=wheelmaker-release/);
  assert.match(script, /\/etc\/wheelmaker-gateway\/home/);
  assert.match(script, /sites\/release-server\.json/);
  assert.match(script, /systemctl enable wheelmaker-gateway\.service/);
  assert.match(script, /systemctl enable wheelmaker-gateway\.service\necho /);
  assert.doesNotMatch(script, /systemctl\s+(stop|disable|restart|reload)\s+nginx/i);
});

test('Gateway bootstrap can explicitly start after installation', () => {
  const script = buildGatewayBootstrapScript({start: true});

  assert.match(script, /systemctl start wheelmaker-gateway\.service/);
});

test('Gateway bootstrap rejects unsafe home paths', () => {
  assert.throws(
    () => buildGatewayBootstrapScript({gatewayHome: '/srv/wheelmaker-release/gateway;id'}),
    /absolute safe path/,
  );
});

test('Gateway bootstrap accepts only the explicit start flag', () => {
  assert.deepEqual(parseGatewayBootstrapArgs([]), {start: false});
  assert.deepEqual(parseGatewayBootstrapArgs(['--start']), {start: true});
  assert.throws(() => parseGatewayBootstrapArgs(['--unknown']), /unknown Gateway bootstrap option/);
});

test('Gateway bootstrap builds and uploads the source Gateway without starting it', async () => {
  const state = {builds: [], cleanups: [], installs: [], uploads: []};
  const result = await bootstrapGateway({
    channel: {baseUrl: 'https://release.wheelmaker.top'},
    homeDirectory: 'C:\\Users\\tester',
    repoRoot: 'D:\\Code\\WheelMaker',
    start: false,
    async sourceContext() {
      return {clean: true, sha: SOURCE_SHA};
    },
    async ensureTools() {},
    async checkRemote() {
      return {architecture: 'amd64', operatingSystem: 'Linux'};
    },
    async build(options) {
      state.builds.push(options);
    },
    async upload(options) {
      state.uploads.push(options);
    },
    async install(options) {
      state.installs.push(options);
    },
    async cleanupRemote() {},
    async cleanup(path) {
      state.cleanups.push(path);
    },
    write() {},
  });

  assert.deepEqual(result, {
    host: 'release.wheelmaker.top',
    sourceSha: SOURCE_SHA,
  });
  assert.equal(state.builds.length, 1);
  assert.equal(state.uploads.length, 1);
  assert.deepEqual(state.uploads[0].files.map(path => path.split(/[\\/]/).at(-1)), ['wheelmaker-gateway']);
  assert.equal(state.installs.length, 1);
  assert.match(state.installs[0].script, /systemctl enable wheelmaker-gateway\.service/);
  assert.match(state.installs[0].script, /start it after the legacy ingress is stopped/);
  assert.equal(state.cleanups.length, 1);
});
