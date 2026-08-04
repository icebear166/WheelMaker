import assert from 'node:assert/strict';
import test from 'node:test';

import {runReleaseStorage} from './storage.mjs';

test('runReleaseStorage prints the report as a JSON line', async () => {
  const lines = [];
  const report = {totalBytes: 600, reclaimableBytes: 200, orphanCount: 1};
  const result = await runReleaseStorage({
    api: {storage: async () => report},
    write: line => lines.push(line),
  });
  assert.deepEqual(result, report);
  assert.deepEqual(lines, [`${JSON.stringify(report)}\n`]);
});

test('runReleaseStorage propagates api failure without printing', async () => {
  const lines = [];
  await assert.rejects(
    () => runReleaseStorage({
      api: {storage: async () => { throw new Error('unauthorized'); }},
      write: line => lines.push(line),
    }),
    /unauthorized/,
  );
  assert.deepEqual(lines, []);
});
