import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseReleaseArgs,
  resolvePublishingToken,
  runRelease,
} from './cli.mjs';
import * as cliModule from './cli.mjs';
import {ReleaseVersionConflictError} from './publish.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function fakeCliDeps() {
  const state = {
    buildCalls: [],
    cleanupCalls: [],
    githubClientCalls: 0,
    messages: [],
    order: [],
    packageCalls: [],
    phases: [],
    publishCalls: [],
    sourceCalls: [],
    versionCalls: 0,
    workspaceCalls: [],
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
    progress: {
      info(message) {
        state.messages.push(message);
      },
      async phase(label, action) {
        state.phases.push(label);
        return action();
      },
    },
    repoRoot: 'D:\\repo',
    workRoot: 'D:\\repo\\.release-work',
    state,
    async cleanupReleaseWorkspace(path) {
      state.cleanupCalls.push(path);
      state.order.push('cleanup');
    },
    async buildRelease(input) {
      state.buildCalls.push(input);
      state.order.push('build');
      return {
        desktopExe: input.withDesktop ? 'desktop.exe' : undefined,
        androidApk: input.withAndroid
          ? {apkPath: 'android.apk', manifestPath: 'android-release.json'}
          : undefined,
        platforms: [{ directory: 'windows', key: 'windows-amd64' }],
        versionRoot: `${input.outputRoot}\\${input.version}`,
      };
    },
    async createGitHubClient() {
      state.githubClientCalls += 1;
      state.order.push('github');
      return { kind: 'github-client' };
    },
    async createReleaseWorkspace(version) {
      const path = `D:\\repo\\.release-work\\tmp\\release-${version}-test`;
      state.workspaceCalls.push({path, version});
      state.order.push('workspace');
      return path;
    },
    now() {
      return '2026-07-16T09:00:00.000Z';
    },
    async packageBuiltRelease(input) {
      state.packageCalls.push(input);
      state.order.push('package');
      return {
        assets: [{name: `wheelmaker-${input.version}-windows-amd64.tar.gz`}],
        manifestPath: `${input.outputRoot}\\${input.version}\\release-manifest.json`,
        platforms: [{
          archivePath: `${input.outputRoot}\\${input.version}\\wheelmaker-${input.version}-windows-amd64.tar.gz`,
          key: 'windows-amd64',
        }],
        version: input.version,
        versionRoot: `${input.outputRoot}\\${input.version}`,
      };
    },
    async publishBuiltRelease(input, api) {
      state.publishCalls.push({api, input});
      state.order.push('publish');
      return { version: 'v1.1' };
    },
    async resolveSourceSha(options) {
      state.sourceCalls.push(options);
      return SOURCE_SHA;
    },
    async resolveNextVersion(options) {
      state.versionCalls += 1;
      state.order.push('version');
      return options?.floorVersion === 'v1.24' ? 'v1.25' : 'v1.24';
    },
  };
  return deps;
}

test('CLI builds locally by default and accepts independent publish/Desktop flags', () => {
  assert.deepEqual(parseReleaseArgs([]), {
    publish: false,
    withAndroid: false,
    withDesktop: false,
  });
  assert.deepEqual(parseReleaseArgs(['--with-desktop', '--with-android', '--publish']), {
    publish: true,
    withAndroid: true,
    withDesktop: true,
  });
  assert.throws(
    () => parseReleaseArgs(['--desktop-exe', 'x.exe']),
    /unknown option/,
  );
  assert.throws(() => parseReleaseArgs(['build']), /unknown option/);
});

test('default mode builds the next stable version without constructing a GitHub client', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease({ publish: false, withDesktop: false }, deps);

  assert.equal(deps.state.githubClientCalls, 0);
  assert.equal(deps.state.publishCalls.length, 0);
  assert.deepEqual(deps.state.sourceCalls, [{ requireClean: false }]);
  assert.equal(deps.state.versionCalls, 1);
  assert.equal(deps.state.buildCalls[0].version, 'v1.24');
  assert.equal(deps.state.buildCalls[0].workRoot, 'D:\\repo\\.release-work');
  assert.deepEqual(deps.state.order, [
    'version',
    'workspace',
    'build',
    'package',
    'cleanup',
  ]);
  assert.equal(
    deps.state.buildCalls[0].stagingRoot,
    'D:\\repo\\.release-work\\tmp\\release-v1.24-test',
  );
  assert.equal(deps.state.packageCalls.length, 1);
  assert.equal(deps.state.cleanupCalls.length, 1);
  assert.deepEqual(deps.state.phases, [
    'Checking source',
    'Resolving release version',
    'Preparing release workspace',
    'Building release assets',
    'Packaging and verifying assets',
    'Cleaning release workspace',
  ]);
  assert.equal(result.mode, 'build');
  assert.equal(
    result.build.versionRoot,
    'D:\\repo\\.release-out\\v1.24',
  );
});

test('publish mode builds once and publishes that same build', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease({ publish: true, withDesktop: true }, deps);

  assert.deepEqual(deps.state.sourceCalls, [{ requireClean: true }]);
  assert.equal(deps.state.githubClientCalls, 1);
  assert.equal(deps.state.buildCalls.length, 1);
  assert.equal(deps.state.buildCalls[0].withDesktop, true);
  assert.equal(deps.state.buildCalls[0].withAndroid, false);
  assert.equal(deps.state.publishCalls.length, 1);
  assert.equal(deps.state.publishCalls[0].input.sourceSha, SOURCE_SHA);
  assert.equal(deps.state.publishCalls[0].input.desktopExe, 'desktop.exe');
  assert.deepEqual(deps.state.publishCalls[0].api, { kind: 'github-client' });
  assert.equal(deps.state.publishCalls[0].input.version, 'v1.24');
  assert.deepEqual(deps.state.order, [
    'version',
    'github',
    'workspace',
    'build',
    'package',
    'publish',
    'cleanup',
  ]);
  assert.equal(
    deps.state.publishCalls[0].input.packaged.versionRoot,
    'D:\\repo\\.release-out\\v1.24',
  );
  assert.deepEqual(deps.state.phases, [
    'Checking source',
    'Resolving release version',
    'Authenticating release repository',
    'Preparing release workspace',
    'Building release assets',
    'Packaging and verifying assets',
    'Publishing release',
    'Cleaning release workspace',
  ]);
  assert.deepEqual(result, { mode: 'publish', stable: { version: 'v1.1' } });
});

test('local build summary exposes final files instead of unpacked directories', () => {
  assert.equal(typeof cliModule.releaseBuildSummary, 'function');
  assert.deepEqual(
    cliModule.releaseBuildSummary({
      androidApkPath: 'D:\\out\\v1.24\\WheelMakerAndroid.apk',
      desktopExePath: undefined,
      manifestPath: 'D:\\out\\v1.24\\release-manifest.json',
      platforms: [
        {
          archivePath: 'D:\\out\\v1.24\\wheelmaker-v1.24-windows-amd64.tar.gz',
          key: 'windows-amd64',
        },
      ],
      versionRoot: 'D:\\out\\v1.24',
    }),
    {
      androidApk: 'D:\\out\\v1.24\\WheelMakerAndroid.apk',
      desktopExe: null,
      manifest: 'D:\\out\\v1.24\\release-manifest.json',
      platforms: [
        {
          archive: 'D:\\out\\v1.24\\wheelmaker-v1.24-windows-amd64.tar.gz',
          key: 'windows-amd64',
        },
      ],
      versionRoot: 'D:\\out\\v1.24',
    },
  );
});

test('release workspace is removed when final packaging fails', async () => {
  const deps = fakeCliDeps();
  deps.packageBuiltRelease = async () => {
    deps.state.order.push('package');
    throw new Error('packaging failed');
  };

  await assert.rejects(
    () => runRelease({publish: false, withDesktop: false}, deps),
    /packaging failed/,
  );
  assert.deepEqual(deps.state.cleanupCalls, [
    'D:\\repo\\.release-work\\tmp\\release-v1.24-test',
  ]);
  assert.deepEqual(deps.state.order, [
    'version',
    'workspace',
    'build',
    'package',
    'cleanup',
  ]);
});

test('publish version conflict rebuilds every asset with a newly resolved version', async () => {
  const deps = fakeCliDeps();
  let publishAttempt = 0;
  deps.publishBuiltRelease = async input => {
    deps.state.publishCalls.push({input});
    deps.state.order.push('publish');
    publishAttempt += 1;
    if (publishAttempt === 1) {
      throw new ReleaseVersionConflictError(input.version);
    }
    return {version: input.version};
  };

  const result = await runRelease(
    {publish: true, withAndroid: true, withDesktop: false},
    deps,
  );

  assert.deepEqual(
    deps.state.buildCalls.map(({version, withAndroid}) => ({version, withAndroid})),
    [
      {version: 'v1.24', withAndroid: true},
      {version: 'v1.25', withAndroid: true},
    ],
  );
  assert.deepEqual(
    deps.state.publishCalls.map(({input}) => ({
      androidApk: input.androidApk,
      version: input.version,
    })),
    [
      {
        androidApk: {apkPath: 'android.apk', manifestPath: 'android-release.json'},
        version: 'v1.24',
      },
      {
        androidApk: {apkPath: 'android.apk', manifestPath: 'android-release.json'},
        version: 'v1.25',
      },
    ],
  );
  assert.deepEqual(result, {mode: 'publish', stable: {version: 'v1.25'}});
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
