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
  return validateStableMetadata(stable).version;
}

export function validateStableMetadata(stable) {
  if (
    !stable ||
    typeof stable !== 'object' ||
    Array.isArray(stable) ||
    stable.schema !== 2 ||
    typeof stable.version !== 'string' ||
    !/^v1\.(0|[1-9]\d*)$/.test(stable.version)
  ) {
    throw new Error('stable metadata schema is invalid');
  }
  if (stable.gateway !== undefined) {
    const gateway = stable.gateway;
    if (
      !gateway ||
      typeof gateway !== 'object' ||
      Array.isArray(gateway) ||
      !/^v1\.(0|[1-9]\d*)$/.test(gateway.version ?? '') ||
      gateway.manifestPath !== '/gateway/current/gateway-manifest.json' ||
      !/^[0-9a-f]{64}$/.test(gateway.manifestSha256 ?? '') ||
      !/^[0-9a-f]{40}$/.test(gateway.sourceSha ?? '')
    ) {
      throw new Error('Gateway pointer is invalid');
    }
  }
  return stable;
}

export function nextVersionFromStableBytes(bytes) {
  return bytes === null ? 'v1.1' : nextV1Version(stableVersionFromBytes(bytes));
}

export function encodeJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
