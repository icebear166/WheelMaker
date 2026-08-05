import assert from 'node:assert/strict';
import test from 'node:test';

import {
  encodeJsonBytes,
  nextV1Version,
  nextVersionFromStableBytes,
  sha256Bytes,
  validateStableMetadata,
  stableVersionFromBytes,
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

test('schema 2 stable metadata determines the next unified build version', () => {
  const bytes = Buffer.from(JSON.stringify({ schema: 2, version: 'v1.23' }));

  assert.equal(stableVersionFromBytes(bytes), 'v1.23');
  assert.equal(nextVersionFromStableBytes(bytes), 'v1.24');
});

test('missing stable starts the self-hosted channel at v1.1', () => {
  assert.equal(nextVersionFromStableBytes(null), 'v1.1');
});

test('stable metadata rejects unknown schemas and malformed versions', () => {
  assert.throws(
    () => stableVersionFromBytes(Buffer.from('{"schema":1,"version":"v1.1"}')),
    /stable metadata schema is invalid/,
  );
  assert.throws(
    () => stableVersionFromBytes(Buffer.from('{"schema":2,"version":"local-deadbeef"}')),
    /stable metadata schema is invalid/,
  );
});

test('stable metadata accepts an optional fixed-namespace Gateway pointer', () => {
  const stable = {
    schema: 2,
    version: 'v1.23',
    gateway: {
      manifestPath: '/gateway/current/gateway-manifest.json',
      manifestSha256: 'a'.repeat(64),
      sourceSha: 'b'.repeat(40),
      version: 'v1.23',
    },
  };
  assert.deepEqual(validateStableMetadata(stable), stable);
});

test('stable metadata allows a previous Gateway pointer to carry forward', () => {
  const stable = {
    schema: 2,
    version: 'v1.24',
    gateway: {
      manifestPath: '/gateway/current/gateway-manifest.json',
      manifestSha256: 'a'.repeat(64),
      sourceSha: 'b'.repeat(40),
      version: 'v1.23',
    },
  };
  assert.deepEqual(validateStableMetadata(stable), stable);
});

test('stable metadata rejects an invalid Gateway pointer', () => {
  assert.throws(
    () => validateStableMetadata({
      schema: 2,
      version: 'v1.23',
      gateway: {
        manifestPath: '/releases/v1.23/gateway-manifest.json',
        manifestSha256: 'a'.repeat(64),
        sourceSha: 'b'.repeat(40),
        version: 'v1.23',
      },
    }),
    /Gateway pointer is invalid/,
  );
});
