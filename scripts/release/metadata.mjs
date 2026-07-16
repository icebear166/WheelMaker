import { createHash } from 'node:crypto';

export function nextV1Version(current) {
  const match = /^v1\.(0|[1-9]\d*)$/.exec(current);
  if (!match) {
    throw new Error(`expected v1.x version, received ${current}`);
  }
  return `v1.${Number(match[1]) + 1}`;
}

export function stableVersionFromBytes(bytes) {
  let stable;
  try {
    stable = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('stable metadata schema is invalid');
  }
  if (
    stable?.schema !== 1 ||
    typeof stable.version !== 'string' ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version)
  ) {
    throw new Error('stable metadata schema is invalid');
  }
  return stable.version;
}

export function nextVersionFromStableBytes(bytes) {
  return nextV1Version(stableVersionFromBytes(bytes));
}

export function encodeJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
