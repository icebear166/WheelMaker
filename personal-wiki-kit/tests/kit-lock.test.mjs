import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadKitLock,
  parseKitLock,
  writeKitLock,
} from '../src/kit-lock.mjs';
import { createTemporaryDirectory } from './support/temp-directory.mjs';

const validLock = {
  schema: 1,
  version: '1.2.3',
  source: 'https://github.com/example/personal-wiki-kit/releases/download/v1.2.3/windows-x64.zip',
  sha256: 'a'.repeat(64),
};

test('Kit lock accepts only the strict pinned-release schema', () => {
  assert.deepEqual(parseKitLock(JSON.stringify(validLock)), validLock);
  for (const invalid of [
    { ...validLock, latest: true },
    { ...validLock, version: 'latest' },
    { ...validLock, source: 'http://example.com/kit.zip' },
    { ...validLock, source: 'https://user:secret@example.com/kit.zip' },
    { ...validLock, sha256: 'ABC' },
  ]) {
    assert.throws(() => parseKitLock(JSON.stringify(invalid)));
  }
});

test('Kit lock writer replaces the file atomically and remains loadable', async () => {
  const temporary = await createTemporaryDirectory('kit-lock-');
  const filename = join(temporary.path, 'wiki-kit.lock.json');
  await writeFile(filename, `${JSON.stringify({ ...validLock, version: '1.2.2' })}\n`);
  await writeKitLock(filename, validLock);
  assert.deepEqual(await loadKitLock(filename), validLock);
  assert.equal((await readFile(filename, 'utf8')).endsWith('\n'), true);
  assert.deepEqual((await temporary.entries()).filter((name) => name.includes('.candidate-')), []);
  await temporary.cleanup();
});
