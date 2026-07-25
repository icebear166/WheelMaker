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

test('release upload progress reports percentages without exposing request details', async () => {
  const progressModule = await import('./progress.mjs');
  const output = [];
  const progress = progressModule.createReleaseProgress({
    write: line => output.push(line),
  });
  const report = progress.upload('wheelmaker-v1.1-windows-amd64.tar.zst');
  report({done: false, uploadedBytes: 0, totalBytes: 100});
  report({done: false, uploadedBytes: 2, totalBytes: 100});
  report({done: false, uploadedBytes: 5, totalBytes: 100});
  report({done: true, uploadedBytes: 100, totalBytes: 100});
  assert.deepEqual(output, [
    '[release] Uploading wheelmaker-v1.1-windows-amd64.tar.zst: 0 B / 100 B (0%)',
    '[release] Uploading wheelmaker-v1.1-windows-amd64.tar.zst: 5 B / 100 B (5%)',
    '[release] Uploading wheelmaker-v1.1-windows-amd64.tar.zst: 100 B / 100 B (100%)',
  ]);
});
