import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';

import {resolvePublisherToken} from './publisher-config.mjs';

function publisherConfigFixture({failHealthOnce = false, final = null, pending = null} = {}) {
  const state = {
    final,
    ghArgs: null,
    ghStdin: null,
    healthCalls: 0,
    pending,
    sshCalls: [],
    warnings: [],
  };
  return {
    state,
    env: {},
    async readFinal() { return state.final; },
    async readPending() { return state.pending; },
    async writePending(document) { state.pending = document; },
    async promotePending() {
      state.final = state.pending;
      state.pending = null;
    },
    async configureRemote(args) { state.sshCalls.push(args); },
    async restartRemote(args) { state.sshCalls.push(args); },
    async waitForHealth() {
      state.healthCalls += 1;
      if (failHealthOnce && state.healthCalls === 1) {
        throw new Error('health check failed');
      }
    },
    async ghAvailable() { return true; },
    async setActionSecret(args, stdin) {
      state.ghArgs = args;
      state.ghStdin = stdin;
    },
    randomToken: () => Buffer.alloc(32, 7).toString('base64url'),
    warning(message) { state.warnings.push(message); },
    identityFile: 'C:\\Users\\test\\.ssh\\wheelmaker-release-server_ed25519',
    host: 'release.wheelmaker.top',
  };
}

test('first local publish creates one token and sends only its hash', async () => {
  const deps = publisherConfigFixture();
  const token = await resolvePublisherToken({actions: false}, deps);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.deepEqual(deps.state.final, {schema: 1, token});
  const flattened = deps.state.sshCalls.flat();
  assert.equal(flattened.includes(token), false);
  assert.equal(flattened.includes(createHash('sha256').update(token).digest('hex')), true);
  const [configure, restart] = deps.state.sshCalls;
  assert.equal(configure.includes('root@release.' + 'wheelmaker.top'), false);
  assert.equal(restart.includes('root@release.' + 'wheelmaker.top'), false);
  assert.equal(configure.includes('release.wheelmaker.top'), true);
  assert.equal(
    configure.includes('$HOME/.wheelmaker/release-server/current/wheelmaker-release-server'),
    true,
  );
  assert.equal(
    configure.includes('$HOME/.wheelmaker/release-server/config.json'),
    true,
  );
  assert.deepEqual(restart.slice(-4), [
    'systemctl',
    '--user',
    'restart',
    'wheelmaker-release-server.service',
  ]);
  assert.equal(deps.state.ghStdin, token);
  assert.equal(deps.state.ghArgs.includes(token), false);
  assert.deepEqual(deps.state.ghArgs, ['secret', 'set', 'WHEELMAKER_RELEASE_TOKEN']);
});

test('interrupted provisioning resumes from the protected pending token', async () => {
  const deps = publisherConfigFixture({failHealthOnce: true});
  await assert.rejects(
    resolvePublisherToken({actions: false}, deps),
    /health check failed/,
  );
  const pendingToken = deps.state.pending.token;
  const token = await resolvePublisherToken({actions: false}, deps);
  assert.equal(token, pendingToken);
  assert.equal(deps.state.pending, null);
  assert.equal(deps.state.final.token, pendingToken);
});

test('Action reads the same token only from its secret and never provisions remotely', async () => {
  const deps = publisherConfigFixture();
  deps.env = {WHEELMAKER_RELEASE_TOKEN: 'same-token'};
  const token = await resolvePublisherToken({actions: true}, deps);
  assert.equal(token, 'same-token');
  assert.deepEqual(deps.state.sshCalls, []);
  assert.equal(deps.state.final, null);
});

test('an unavailable gh secret update warns without invalidating the working local token', async () => {
  const deps = publisherConfigFixture();
  deps.ghAvailable = async () => false;
  const token = await resolvePublisherToken({actions: false}, deps);
  assert.equal(deps.state.final.token, token);
  assert.match(deps.state.warnings[0], /WHEELMAKER_RELEASE_TOKEN/);
});

test('existing local token is reused without SSH', async () => {
  const document = {schema: 1, token: Buffer.alloc(32, 9).toString('base64url')};
  const deps = publisherConfigFixture({final: document});
  assert.equal(await resolvePublisherToken({actions: false}, deps), document.token);
  assert.deepEqual(deps.state.sshCalls, []);
});
