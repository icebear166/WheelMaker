import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReleaseArgs, runRelease } from './cli.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function fakeCliDeps() {
  const state = {
    buildCalls: [],
    githubClientCalls: 0,
    publishCalls: [],
    sourceCalls: [],
  };
  return {
    channel: {
      branch: 'main',
      owner: 'swm8023',
      publishStatusPath: 'publish-status.json',
      repository: 'wheelmaker-releases',
      stablePath: 'stable.json',
    },
    coreBytes: Buffer.from('core'),
    deployMjsBytes: Buffer.from('launcher'),
    outputRoot: 'D:\\repo\\.release-out',
    repoRoot: 'D:\\repo',
    state,
    async buildRelease(input) {
      state.buildCalls.push(input);
      return {
        desktopExe: input.withDesktop ? 'desktop.exe' : undefined,
        platforms: [{ directory: 'windows', key: 'windows-amd64' }],
        versionRoot: `${input.outputRoot}\\${input.version}`,
      };
    },
    async createGitHubClient() {
      state.githubClientCalls += 1;
      return { kind: 'github-client' };
    },
    async loadSigningMaterial() {
      return { privateKey: 'private', publicKey: 'public' };
    },
    now() {
      return '2026-07-16T09:00:00.000Z';
    },
    async publishBuiltRelease(input, api) {
      state.publishCalls.push({ api, input });
      return { version: 'v1.1' };
    },
    async resolveSourceSha(options) {
      state.sourceCalls.push(options);
      return SOURCE_SHA;
    },
  };
}

test('CLI exposes only build and publish with optional Desktop build', () => {
  assert.deepEqual(parseReleaseArgs(['build']), {
    mode: 'build',
    withDesktop: false,
  });
  assert.deepEqual(parseReleaseArgs(['publish', '--with-desktop']), {
    mode: 'publish',
    withDesktop: true,
  });
  assert.throws(
    () => parseReleaseArgs(['publish', '--desktop-exe', 'x.exe']),
    /unknown option/,
  );
  assert.throws(() => parseReleaseArgs(['schedule']), /expected build or publish/);
});

test('build mode never constructs a GitHub client', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease(
    { mode: 'build', withDesktop: false },
    deps,
  );

  assert.equal(deps.state.githubClientCalls, 0);
  assert.equal(deps.state.publishCalls.length, 0);
  assert.deepEqual(deps.state.sourceCalls, [{ requireClean: false }]);
  assert.equal(deps.state.buildCalls[0].version, 'local-0123456789ab');
  assert.equal(result.mode, 'build');
});

test('publish requires a clean source and passes the built output to publisher', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease(
    { mode: 'publish', withDesktop: true },
    deps,
  );

  assert.deepEqual(deps.state.sourceCalls, [{ requireClean: true }]);
  assert.equal(deps.state.githubClientCalls, 1);
  assert.equal(deps.state.buildCalls[0].withDesktop, true);
  assert.equal(deps.state.publishCalls.length, 1);
  assert.equal(deps.state.publishCalls[0].input.sourceSha, SOURCE_SHA);
  assert.equal(deps.state.publishCalls[0].input.desktopExe, 'desktop.exe');
  assert.deepEqual(deps.state.publishCalls[0].api, { kind: 'github-client' });
  assert.deepEqual(result, { mode: 'publish', stable: { version: 'v1.1' } });
});
