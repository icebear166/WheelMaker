import assert from 'node:assert/strict';
import test from 'node:test';

test('release progress reports timed GitHub log groups', async () => {
  const progressModule = await import('./progress.mjs').catch(() => ({}));
  assert.equal(typeof progressModule.createReleaseProgress, 'function');

  const output = [];
  const timestamps = [0, 100];
  const progress = progressModule.createReleaseProgress({
    githubActions: true,
    now: () => timestamps.shift(),
    write: line => output.push(line),
  });

  const value = await progress.phase('Building Web', async () => 'built');

  assert.equal(value, 'built');
  assert.deepEqual(output, [
    '::group::Building Web',
    '[release] Building Web...',
    '[release] Building Web completed (100ms)',
    '::endgroup::',
  ]);
});

test('release progress identifies the failed phase and closes its group', async () => {
  const progressModule = await import('./progress.mjs').catch(() => ({}));
  assert.equal(typeof progressModule.createReleaseProgress, 'function');

  const output = [];
  const timestamps = [0, 1_250];
  const progress = progressModule.createReleaseProgress({
    githubActions: true,
    now: () => timestamps.shift(),
    write: line => output.push(line),
  });

  await assert.rejects(
    () => progress.phase('Packaging assets', async () => {
      throw new Error('archive failed');
    }),
    /archive failed/,
  );
  assert.deepEqual(output, [
    '::group::Packaging assets',
    '[release] Packaging assets...',
    '[release] Packaging assets failed (1.3s): archive failed',
    '::endgroup::',
    '::error title=Release failed::Packaging assets: archive failed',
  ]);
});

test('parallel release tasks report their own completion', async () => {
  const progressModule = await import('./progress.mjs').catch(() => ({}));
  assert.equal(typeof progressModule.createReleaseProgress, 'function');

  const output = [];
  const timestamps = [0, 240];
  const progress = progressModule.createReleaseProgress({
    now: () => timestamps.shift(),
    write: line => output.push(line),
  });

  await progress.task('windows-amd64', async () => {});
  assert.deepEqual(output, [
    '[release] windows-amd64 started',
    '[release] windows-amd64 completed (240ms)',
  ]);
});
