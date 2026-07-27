import assert from 'node:assert/strict';
import test from 'node:test';

import {parseReleaseArgs, releaseBuildSummary, runRelease} from './cli.mjs';
import {ReleaseVersionConflictError} from './publish.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function fakeCliDeps() {
  const state = {
    builds: [],
    cleanups: [],
    clientCalls: 0,
    order: [],
    packages: [],
    phases: [],
    sessions: [],
    statuses: [],
    uploads: [],
  };
  const api = {
    async start(input) {
      state.order.push('start');
      state.sessions.push(input);
      return {
        publishedAt: `2026-07-17T09:00:0${state.sessions.length - 1}Z`,
        sessionId: String(state.sessions.length).repeat(32),
        version: input.version,
      };
    },
    async status(sessionId, value) {
      state.order.push(`status:${value.phase}`);
      state.statuses.push({sessionId, ...value});
    },
    async upload(sessionId, asset) {
      state.order.push(`upload:${asset.name}`);
      state.uploads.push({asset, sessionId});
    },
    async commit() {
      state.order.push('commit');
      return {schema: 2, version: state.sessions.at(-1).version};
    },
    async cancel(sessionId) {
      state.order.push('cancel');
      state.cancelled = sessionId;
    },
  };
  return {
    async acquireBuildLock(input) {
      state.order.push(`lock:${input.owner}`);
      return {
        async release() {
          state.order.push('unlock');
        },
      };
    },
    api,
    channel: {baseUrl: 'https://release.wheelmaker.top'},
    coreBytes: Buffer.from('core'),
    deployMjsBytes: Buffer.from('__WHEELMAKER_RELEASE_BASE_URL__'),
    outputRoot: 'D:\\repo\\.release-out',
    progress: {
      info() {},
      async phase(label, action) {
        state.phases.push(label);
        return action();
      },
    },
    publisher: 'local',
    repoRoot: 'D:\\repo',
    state,
    workRoot: 'D:\\repo\\.release-work',
    async cleanupReleaseWorkspace(path) {
      state.cleanups.push(path);
      state.order.push('cleanup');
    },
    async createReleaseClient() {
      state.clientCalls += 1;
      state.order.push('client');
      return api;
    },
    async createReleaseWorkspace(version) {
      state.order.push('workspace');
      return `D:\\repo\\.release-work\\tmp\\release-${version}-test`;
    },
    async buildRelease(input) {
      state.order.push('build');
      state.builds.push(input);
      return {
        androidApk: input.withAndroid
          ? {apkPath: 'android.apk', manifestPath: 'android-release.json'}
          : undefined,
        desktopExe: input.withDesktop ? 'desktop.exe' : undefined,
        platforms: [{directory: 'windows', key: 'windows-amd64'}],
      };
    },
    async loadDeploymentSources() {
      state.order.push('sources');
      return {
        coreBytes: Buffer.from('core'),
        deployMjsBytes: Buffer.from('__WHEELMAKER_RELEASE_BASE_URL__'),
      };
    },
    now: () => '2026-07-17T08:00:00Z',
    async packageBuiltRelease(input) {
      state.order.push('package');
      state.packages.push(input);
      return {
        assets: [
          {name: 'deploy.mjs', path: 'deploy.mjs', sha256: 'a'.repeat(64), size: 1},
        ],
        manifestPath: `${input.outputRoot}\\${input.version}\\release-manifest.json`,
        platforms: [{archivePath: 'archive.tar.zst', key: 'windows-amd64'}],
        versionRoot: `${input.outputRoot}\\${input.version}`,
      };
    },
    async publishBuiltRelease(input, client) {
      state.order.push('publish');
      assert.equal(client, api);
      await client.status(input.session.sessionId, {phase: 'uploading', state: 'running'});
      for (const asset of input.packaged.assets) await client.upload(input.session.sessionId, asset);
      await client.status(input.session.sessionId, {phase: 'committing', state: 'running'});
      return client.commit(input.session.sessionId);
    },
    async resolveReleaseTarget({floorVersion} = {}) {
      state.order.push('version');
      const version = floorVersion === 'v1.24' ? 'v1.25' : 'v1.24';
      return {
        stable: {
          schema: 2,
          sourceSha: 'f'.repeat(40),
          version: floorVersion ?? 'v1.23',
        },
        version,
      };
    },
    async resolveSourceSha(options) {
      state.sourceOptions = options;
      return SOURCE_SHA;
    },
  };
}

test('CLI flags remain independent and reject retired command syntax', () => {
  assert.deepEqual(parseReleaseArgs([]), {
    publish: false,
    withAndroid: false,
    withDesktop: false,
  });
  assert.deepEqual(
    parseReleaseArgs(['--with-desktop', '--with-android', '--publish']),
    {publish: true, withAndroid: true, withDesktop: true},
  );
  assert.throws(() => parseReleaseArgs(['build']), /unknown option/);
});

test('local release holds the shared build lock through asset construction', async () => {
  const deps = fakeCliDeps();
  deps.acquireBuildLock = async input => {
    deps.state.order.push(`lock:${input.owner}`);
    return {
      async release() {
        deps.state.order.push('unlock');
      },
    };
  };

  await runRelease({publish: false}, deps);

  assert.ok(deps.state.order.indexOf('lock:release') < deps.state.order.indexOf('build'));
  assert.ok(deps.state.order.indexOf('unlock') > deps.state.order.indexOf('package'));
});

test('local build reads public version and creates the identical final directory without auth or session', async () => {
  const deps = fakeCliDeps();
  deps.resolveReleaseTarget = async () => {
    deps.state.order.push('version');
    return {
      stable: {schema: 2, sourceSha: SOURCE_SHA, version: 'v1.23'},
      version: 'v1.24',
    };
  };
  const result = await runRelease({publish: false, withDesktop: false}, deps);

  assert.equal(deps.state.clientCalls, 0);
  assert.equal(deps.state.sessions.length, 0);
  assert.deepEqual(deps.state.sourceOptions, {requireClean: false});
  assert.equal(deps.state.packages[0].publishedAt, '2026-07-17T08:00:00Z');
  assert.deepEqual(deps.state.order, [
    'version',
    'sources',
    'workspace',
    'lock:release',
    'build',
    'package',
    'unlock',
    'cleanup',
  ]);
  assert.equal(result.mode, 'build');
});

test('publish skips authentication and packaging when stable already has the current source SHA', async () => {
  const deps = fakeCliDeps();
  deps.resolveReleaseTarget = async () => {
    deps.state.order.push('version');
    return {
      stable: {schema: 2, sourceSha: SOURCE_SHA, version: 'v1.23'},
      version: 'v1.24',
    };
  };

  const result = await runRelease(
    {publish: true, withAndroid: true, withDesktop: true},
    deps,
  );

  assert.deepEqual(deps.state.sourceOptions, {requireClean: true});
  assert.deepEqual(deps.state.order, ['version']);
  assert.equal(deps.state.clientCalls, 0);
  assert.equal(deps.state.builds.length, 0);
  assert.equal(deps.state.packages.length, 0);
  assert.deepEqual(result, {
    mode: 'publish',
    stable: {schema: 2, sourceSha: SOURCE_SHA, version: 'v1.23'},
    unchanged: true,
  });
});

test('publish starts its remote session before building and uses server publishedAt', async () => {
  const deps = fakeCliDeps();
  const result = await runRelease(
    {publish: true, withAndroid: true, withDesktop: true},
    deps,
  );

  assert.deepEqual(deps.state.sourceOptions, {requireClean: true});
  assert.deepEqual(deps.state.sessions[0], {
    publisher: 'local',
    sourceSha: SOURCE_SHA,
    version: 'v1.24',
    withAndroid: true,
    withDesktop: true,
  });
  assert.equal(deps.state.packages[0].publishedAt, '2026-07-17T09:00:00Z');
  assert.deepEqual(deps.state.order, [
    'version',
    'sources',
    'client',
    'start',
    'status:building',
    'workspace',
    'lock:release',
    'build',
    'status:packaging',
    'package',
    'publish',
    'status:uploading',
    'upload:deploy.mjs',
    'status:committing',
    'commit',
    'unlock',
    'cleanup',
  ]);
  assert.deepEqual(result, {mode: 'publish', stable: {schema: 2, version: 'v1.24'}});
});

test('a failed build exposes only a generic failed status and cancels the session', async () => {
  const deps = fakeCliDeps();
  deps.buildRelease = async () => {
    deps.state.order.push('build');
    throw new Error('compiler emitted a private path');
  };
  await assert.rejects(
    runRelease({publish: true, withDesktop: false}, deps),
    /compiler emitted a private path/,
  );
  assert.deepEqual(deps.state.statuses.at(-1), {
    errorCode: 'build_failed',
    phase: 'building',
    sessionId: '1'.repeat(32),
    state: 'failed',
  });
  assert.equal(deps.state.cancelled, '1'.repeat(32));
  assert.equal(deps.state.cleanups.length, 1);
});

test('commit conflict cancels then skips retry when stable now has the current source SHA', async () => {
  const deps = fakeCliDeps();
  let attempts = 0;
  deps.resolveReleaseTarget = async ({floorVersion} = {}) => {
    deps.state.order.push('version');
    if (floorVersion === 'v1.24') {
      return {
        stable: {schema: 2, sourceSha: SOURCE_SHA, version: 'v1.24'},
        version: 'v1.25',
      };
    }
    return {
      stable: {schema: 2, sourceSha: 'f'.repeat(40), version: 'v1.23'},
      version: 'v1.24',
    };
  };
  deps.publishBuiltRelease = async input => {
    deps.state.order.push('publish');
    attempts += 1;
    if (attempts === 1) throw new ReleaseVersionConflictError(input.version);
    return {schema: 2, version: input.version};
  };
  const result = await runRelease(
    {publish: true, withAndroid: true, withDesktop: false},
    deps,
  );
  assert.deepEqual(deps.state.builds.map(build => build.version), ['v1.24']);
  assert.deepEqual(deps.state.sessions.map(session => session.version), ['v1.24']);
  assert.equal(deps.state.order.filter(value => value === 'cancel').length, 1);
  assert.deepEqual(result, {
    mode: 'publish',
    stable: {schema: 2, sourceSha: SOURCE_SHA, version: 'v1.24'},
    unchanged: true,
  });
});

test('build summary exposes only final release files', () => {
  assert.deepEqual(releaseBuildSummary({
    androidApkPath: undefined,
    desktopExePath: 'D:\\out\\v1.1\\WheelMakerDesktop.exe',
    manifestPath: 'D:\\out\\v1.1\\release-manifest.json',
    platforms: [{archivePath: 'D:\\out\\v1.1\\package.tar.zst', key: 'windows-amd64'}],
    versionRoot: 'D:\\out\\v1.1',
  }), {
    androidApk: null,
    desktopExe: 'D:\\out\\v1.1\\WheelMakerDesktop.exe',
    manifest: 'D:\\out\\v1.1\\release-manifest.json',
    platforms: [{archive: 'D:\\out\\v1.1\\package.tar.zst', key: 'windows-amd64'}],
    versionRoot: 'D:\\out\\v1.1',
  });
});
