import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeJsonBytes,
  nextV1Version,
  sha256Bytes,
} from './metadata.mjs';

test("nextV1Version increments only v1.x", () => {
  assert.equal(nextV1Version("v1.0"), "v1.1");
  assert.equal(nextV1Version("v1.29"), "v1.30");
  assert.throws(() => nextV1Version("v2.0"), /expected v1\.x/);
});

test('JSON encoding and SHA-256 cover exact UTF-8 bytes', () => {
  const bytes = encodeJsonBytes({ schema: 1, version: 'v1.1' });

  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(sha256Bytes(bytes).length, 64);
  assert.notEqual(
    sha256Bytes(bytes),
    sha256Bytes(Buffer.concat([bytes, Buffer.from(' ')])),
  );
});
