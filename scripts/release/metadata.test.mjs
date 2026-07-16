import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateSigningKey } from './generate-signing-key.mjs';
import {
  encodeJsonBytes,
  nextV1Version,
  sha256Bytes,
  signBytes,
  verifyBytes,
} from './metadata.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

test('nextV1Version increments only v1.x', () => {
  assert.equal(nextV1Version('v1.0'), 'v1.1');
  assert.equal(nextV1Version('v1.29'), 'v1.30');
  assert.throws(() => nextV1Version('v2.0'), /expected v1\.x/);
});

test('JSON signature covers exact UTF-8 bytes', () => {
  const bytes = encodeJsonBytes({ schema: 1, version: 'v1.1' });
  const signature = signBytes(bytes, privateKey);

  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(verifyBytes(bytes, signature, publicKey), true);
  assert.equal(
    verifyBytes(Buffer.concat([bytes, Buffer.from(' ')]), signature, publicKey),
    false,
  );
  assert.equal(sha256Bytes(bytes).length, 64);
});

test('signing key generator writes only the public key to the public path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-signing-key-'));
  const privateKeyPath = join(root, 'secrets', 'signing-private.pem');
  const publicKeyPath = join(root, 'source', 'release-public-key.pem');

  try {
    const result = await generateSigningKey({ privateKeyPath, publicKeyPath });
    const privatePem = await readFile(privateKeyPath, 'utf8');
    const publicPem = await readFile(publicKeyPath, 'utf8');
    const privateKeyLabel = ['BEGIN', 'PRIVATE KEY'].join(' ');

    assert.equal(privatePem.startsWith(`-----${privateKeyLabel}-----`), true);
    assert.doesNotMatch(publicPem, /PRIVATE KEY/);
    assert.match(publicPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.equal(result.secretName, 'WHEELMAKER_SIGNING_PRIVATE_KEY');
    assert.equal(result.privateKeyPath, privateKeyPath);
    assert.equal(result.publicKeyPath, publicKeyPath);
    await assert.rejects(
      () => generateSigningKey({ privateKeyPath, publicKeyPath }),
      /refusing to overwrite/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
