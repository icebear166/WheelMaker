import assert from 'node:assert/strict';
import {join} from 'node:path';
import test from 'node:test';

import {parseDiagnosticArgs, runDiagnostic} from './diagnostic.mjs';

test('diagnostic arguments require one valid release version', () => {
  assert.deepEqual(
    parseDiagnosticArgs(['--version', 'v1.83']),
    {version: 'v1.83', withDesktop: false},
  );
  assert.deepEqual(
    parseDiagnosticArgs(['--with-desktop', '--version', 'v1.83']),
    {version: 'v1.83', withDesktop: true},
  );

  for (const args of [
    [],
    ['--version'],
    ['--version', 'v2.1'],
    ['--version', 'v1.83', '--version', 'v1.84'],
    ['--with-desktop', '--with-desktop'],
    ['--publish'],
    ['--with-android'],
    ['--unknown'],
  ]) {
    assert.throws(() => parseDiagnosticArgs(args), /diagnostic|unknown|version/i);
  }
});

test('diagnostic run uses a private non-publishing workspace and profile', async () => {
  const repoRoot = 'C:\\wheelmaker-diagnostic-repo';
  const builds = [];
  const locks = [];
  const progress = {info() {}};
  const result = await runDiagnostic(['--version', 'v1.83'], {
    acquireBuildLock: async input => {
      locks.push(input);
      return {release: async () => {}};
    },
    buildRelease: async input => {
      builds.push(input);
      return {goProfile: input.goProfile, platforms: []};
    },
    progress,
    repoRoot,
  });

  assert.equal(result.mode, 'diagnostic');
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0], {
    goProfile: 'diagnostic',
    progress,
    repoRoot,
    stagingRoot: join(repoRoot, '.release-work', 'diagnostic', 'v1.83'),
    version: 'v1.83',
    withAndroid: false,
    withDesktop: false,
    workRoot: join(repoRoot, '.release-work', 'diagnostic-cache'),
  });
  assert.deepEqual(locks, [{
    owner: 'diagnostic',
    workRoot: join(repoRoot, '.release-work', 'diagnostic-cache'),
  }]);
  assert.equal('publish' in builds[0], false);
});

test('diagnostic run forwards the optional Desktop flag without publishing', async () => {
  const builds = [];
  const progress = {info() {}};
  await runDiagnostic(['--version', 'v1.83', '--with-desktop'], {
    acquireBuildLock: async () => ({release: async () => {}}),
    buildRelease: async input => {
      builds.push(input);
      return {goProfile: input.goProfile, platforms: []};
    },
    progress,
    repoRoot: 'C:\\wheelmaker-diagnostic-repo',
  });

  assert.equal(builds[0].goProfile, 'diagnostic');
  assert.equal(builds[0].withDesktop, true);
  assert.equal(builds[0].withAndroid, false);
});
