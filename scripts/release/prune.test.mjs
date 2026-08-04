import assert from 'node:assert/strict';
import test from 'node:test';

import {runReleasePrune} from './prune.mjs';

test('runReleasePrune prints the result as a JSON line', async () => {
  const lines = [];
  const report = {ok: true, removedCount: 2};
  const result = await runReleasePrune({
    api: {prune: async () => report},
    write: line => lines.push(line),
  });
  assert.deepEqual(result, report);
  assert.deepEqual(lines, [`${JSON.stringify(report)}\n`]);
});
