import { createHash, sign, verify } from 'node:crypto';

export function nextV1Version(current) {
  const match = /^v1\.(0|[1-9]\d*)$/.exec(current);
  if (!match) {
    throw new Error(`expected v1.x version, received ${current}`);
  }
  return `v1.${Number(match[1]) + 1}`;
}

export function encodeJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function signBytes(bytes, privateKey) {
  return sign(null, bytes, privateKey).toString('base64');
}

export function verifyBytes(bytes, base64Signature, publicKey) {
  return verify(
    null,
    bytes,
    publicKey,
    Buffer.from(base64Signature, 'base64'),
  );
}
