import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseReleaseArgs,
  resolvePublishingToken,
  runRelease,
} from './cli.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function fakeCliDeps() {
  const state = {
    buildCalls: [],
    githubClientCalls: 0,
    isWorkingTreeCleanCalls: 0,
    loadSigningCalls: 0,
    publishCalls: [],
    readBuildRecordCalls: [],
    sourceCalls: [],
    writeBuildRecordCalls: [],
  };
  const deps = {
    channel: {
      branch: 'main',
      owner: 'swm8023',
      publishStatusPath: 'publish-status.json',
      repository: 'wheelmaker-release',
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
    async isWorkingTreeClean() {
      state.isWorkingTreeCleanCalls += 1;
      return true;
    },
    async loadSigningMaterial() {
      state.loadSigningCalls += 1;
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
    async readBuildRecord(version) {
      state.readBuildRecordCalls.push(version);
      return {
        build: {
          desktopExe: 'desktop.exe',
          platforms: [{ directory: 'windows', key: 'windows-amd64' }],
          versionRoot: `${deps.outputRoot}\\${version}`,
        },
        cleanSource: true,
        sourceSha: SOURCE_SHA,
      };
    },
    async writeBuildRecord(version, record) {
      state.writeBuildRecordCalls.push({ record, version });
    },
  };
  return deps;
}

test('CLI allows Desktop selection only while building', () => {
  assert.deepEqual(parseReleaseArgs(['build']), {
    mode: 'build',
    withDesktop: false,
  });
  assert.deepEqual(parseReleaseArgs(['publish']), {
    mode: 'publish',
    withDesktop: false,
  });
  assert.throws(
    () => parseReleaseArgs(['publish', '--with-desktop']),
    /only valid with build/,
  );
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
  assert.equal(deps.state.writeBuildRecordCalls.length, 1);
  assert.equal(deps.state.writeBuildRecordCalls[0].record.sourceSha, SOURCE_SHA);
  assert.equal(deps.state.writeBuildRecordCalls[0].record.cleanSource, true);
  assert.equal(deps.state.writeBuildRecordCalls[0].record.desktopIncluded, false);
  assert.equal(deps.state.writeBuildRecordCalls[0].record.build.desktopExe, null);
  assert.equal(result.mode, 'build');
});

test('publish requires a clean source and reuses the recorded local build', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease(
    { mode: 'publish', withDesktop: false },
    deps,
  );

  assert.deepEqual(deps.state.sourceCalls, [{ requireClean: true }]);
  assert.equal(deps.state.githubClientCalls, 1);
  assert.equal(deps.state.buildCalls.length, 0);
  assert.deepEqual(deps.state.readBuildRecordCalls, ['local-0123456789ab']);
  assert.equal(deps.state.loadSigningCalls, 0);
  assert.equal(deps.state.publishCalls.length, 1);
  assert.equal(deps.state.publishCalls[0].input.sourceSha, SOURCE_SHA);
  assert.equal(deps.state.publishCalls[0].input.desktopExe, 'desktop.exe');
  assert.deepEqual(deps.state.publishCalls[0].api, { kind: 'github-client' });
  assert.deepEqual(result, { mode: 'publish', stable: { version: 'v1.1' } });
});

test('publish fails before authentication when no local build exists', async () => {
  const deps = fakeCliDeps();
  deps.readBuildRecord = async () => null;

  await assert.rejects(
    () => runRelease({ mode: 'publish', withDesktop: false }, deps),
    /run build-release\.bat first/i,
  );
  assert.equal(deps.state.githubClientCalls, 0);
  assert.equal(deps.state.buildCalls.length, 0);
});

test('publish refuses an artifact built from a dirty worktree', async () => {
  const deps = fakeCliDeps();
  const readBuildRecord = deps.readBuildRecord;
  deps.readBuildRecord = async (version) => ({
    ...(await readBuildRecord(version)),
    cleanSource: false,
  });

  await assert.rejects(
    () => runRelease({ mode: 'publish', withDesktop: false }, deps),
    /created from a dirty worktree/i,
  );
  assert.equal(deps.state.githubClientCalls, 0);
});

test('publish refuses a build record from another source commit', async () => {
  const deps = fakeCliDeps();
  const readBuildRecord = deps.readBuildRecord;
  deps.readBuildRecord = async (version) => ({
    ...(await readBuildRecord(version)),
    sourceSha: 'f'.repeat(40),
  });

  await assert.rejects(
    () => runRelease({ mode: 'publish', withDesktop: false }, deps),
    /does not match the current Git HEAD/i,
  );
  assert.equal(deps.state.githubClientCalls, 0);
});

test('local publishing reuses the authenticated GitHub CLI token', async () => {
  const calls = [];
  const token = await resolvePublishingToken({
    env: {},
    async execGh(command, args, options) {
      calls.push({ args, command, options });
      return { stdout: 'local-gh-token\n' };
    },
  });

  assert.equal(token, 'local-gh-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args, ['auth', 'token']);
});

test('local publishing gives an actionable error when gh is unavailable', async () => {
  await assert.rejects(
    () =>
      resolvePublishingToken({
        env: {},
        async execGh() {
          throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
        },
      }),
    /install GitHub CLI.*gh auth login/i,
  );
});

test('GitHub Actions publishing uses only the GitHub App installation token', async () => {
  const appCalls = [];
  const token = await resolvePublishingToken({
    env: {
      GITHUB_ACTIONS: 'true',
      WHEELMAKER_RELEASE_APP_ID: '123',
      WHEELMAKER_RELEASE_INSTALLATION_ID: '456',
      WHEELMAKER_RELEASE_APP_PRIVATE_KEY: 'private-key',
    },
    async execGh() {
      throw new Error('gh must not be used in Actions');
    },
    async requestAppToken(input) {
      appCalls.push(input);
      return 'app-installation-token';
    },
  });

  assert.equal(token, 'app-installation-token');
  assert.equal(appCalls.length, 1);
  assert.equal(appCalls[0].appId, '123');
  assert.equal(appCalls[0].installationId, '456');
});
