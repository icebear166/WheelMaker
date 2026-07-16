import { createHash, randomUUID, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const BLOCK_SIZE = 512;
const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;
const STALE_LEASE_MS = 2 * 60 * 60 * 1000;
const STATUS_STATES = new Set([
  'applying',
  'downloading',
  'failed',
  'queued',
  'restarting',
  'succeeded',
  'verifying',
]);
const TERMINAL_STATES = new Set(['failed', 'succeeded']);

export const RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATHBcwgOFQcJHJ/eMNIEzxtZNiK8Wu4bdFsSD9+LLiao=
-----END PUBLIC KEY-----
`;

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateJobId(jobId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId ?? '')) {
    throw new Error(`invalid update job ID: ${jobId}`);
  }
}

function normalizeTime(value) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`invalid update timestamp: ${value}`);
  }
  return new Date(milliseconds).toISOString();
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${randomUUID()}.${process.pid}.tmp`,
  );
  await writeFile(temporaryPath, bytes, { mode: 0o600 });
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function statusRecord(status) {
  validateJobId(status.jobId);
  if (!STATUS_STATES.has(status.state)) {
    throw new Error(`invalid update state: ${status.state}`);
  }
  const updatedAt = normalizeTime(status.now ?? new Date().toISOString());
  return {
    schema: 1,
    jobId: status.jobId,
    state: status.state,
    updatedAt,
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  };
}

export async function writeUpdateStatus(stateDirectory, status) {
  const record = statusRecord(status);
  await atomicWrite(join(stateDirectory, 'status.json'), jsonBytes(record));
  return record;
}

async function tryCreateLease(stateDirectory, lease) {
  const lockPath = join(stateDirectory, 'lock.json');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }

  const startedAt = normalizeTime(lease.now ?? new Date().toISOString());
  const lock = {
    schema: 1,
    jobId: lease.jobId,
    owner: lease.owner,
    state: 'queued',
    startedAt,
    heartbeatAt: startedAt,
  };
  try {
    await handle.writeFile(jsonBytes(lock));
  } finally {
    await handle.close();
  }
  try {
    await writeUpdateStatus(stateDirectory, {
      jobId: lease.jobId,
      now: startedAt,
      state: 'queued',
    });
  } catch (error) {
    await rm(lockPath, { force: true });
    throw error;
  }
  return true;
}

export async function acquireUpdateLease(
  stateDirectory,
  lease,
  { isUpdaterRunning = async () => false } = {},
) {
  validateJobId(lease.jobId);
  if (lease.owner !== 'web' && lease.owner !== 'timer') {
    throw new Error(`invalid update lease owner: ${lease.owner}`);
  }
  await mkdir(stateDirectory, { recursive: true });
  if (await tryCreateLease(stateDirectory, lease)) {
    return true;
  }

  const lockPath = join(stateDirectory, 'lock.json');
  const existing = await readJsonIfPresent(lockPath);
  if (!existing) {
    return tryCreateLease(stateDirectory, lease);
  }
  const nowMilliseconds = Date.parse(lease.now ?? new Date().toISOString());
  const heartbeatMilliseconds = Date.parse(existing.heartbeatAt ?? '');
  if (
    !Number.isFinite(nowMilliseconds) ||
    !Number.isFinite(heartbeatMilliseconds) ||
    nowMilliseconds - heartbeatMilliseconds <= STALE_LEASE_MS ||
    (await isUpdaterRunning())
  ) {
    return false;
  }

  const claimedPath = join(
    stateDirectory,
    `.stale-lock.${process.pid}.${randomUUID()}.json`,
  );
  try {
    await rename(lockPath, claimedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return tryCreateLease(stateDirectory, lease);
    }
    return false;
  }
  try {
    return await tryCreateLease(stateDirectory, lease);
  } finally {
    await rm(claimedPath, { force: true });
  }
}

export async function heartbeatUpdateLease(
  stateDirectory,
  jobId,
  now = new Date().toISOString(),
) {
  validateJobId(jobId);
  const lockPath = join(stateDirectory, 'lock.json');
  const lock = await readJsonIfPresent(lockPath);
  if (!lock || lock.jobId !== jobId) {
    return false;
  }
  lock.heartbeatAt = normalizeTime(now);
  await atomicWrite(lockPath, jsonBytes(lock));
  return true;
}

export async function finishUpdate(stateDirectory, status) {
  if (!TERMINAL_STATES.has(status.state)) {
    throw new Error(`update terminal state required: ${status.state}`);
  }
  const record = await writeUpdateStatus(stateDirectory, status);
  const lockPath = join(stateDirectory, 'lock.json');
  const lock = await readJsonIfPresent(lockPath);
  if (lock?.jobId === status.jobId) {
    await rm(lockPath, { force: true });
  }
  return record;
}

class StreamReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
  }

  async fill() {
    if (this.buffer.length || this.done) return;
    const next = await this.iterator.next();
    if (next.done) {
      this.done = true;
      return;
    }
    this.buffer = Buffer.from(next.value);
  }

  async readExact(length, allowEnd = false) {
    const output = Buffer.alloc(length);
    let written = 0;
    while (written < length) {
      await this.fill();
      if (!this.buffer.length) {
        if (allowEnd && written === 0) return null;
        throw new Error('unsafe tar entry: truncated archive');
      }
      const count = Math.min(length - written, this.buffer.length);
      this.buffer.copy(output, written, 0, count);
      this.buffer = this.buffer.subarray(count);
      written += count;
    }
    return output;
  }

  async writeExact(length, handle) {
    let remaining = length;
    while (remaining > 0) {
      await this.fill();
      if (!this.buffer.length) {
        throw new Error('unsafe tar entry: truncated file');
      }
      const count = Math.min(remaining, this.buffer.length);
      const chunk = this.buffer.subarray(0, count);
      await handle.writeFile(chunk);
      this.buffer = this.buffer.subarray(count);
      remaining -= count;
    }
  }

  async discard(length) {
    let remaining = length;
    while (remaining > 0) {
      await this.fill();
      if (!this.buffer.length) {
        throw new Error('unsafe tar entry: truncated padding');
      }
      const count = Math.min(remaining, this.buffer.length);
      this.buffer = this.buffer.subarray(count);
      remaining -= count;
    }
  }
}

function readTarText(bytes) {
  const nullIndex = bytes.indexOf(0);
  const value = bytes.subarray(0, nullIndex === -1 ? bytes.length : nullIndex);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('unsafe tar entry: invalid UTF-8');
  }
}

function readTarOctal(bytes, label) {
  if (bytes[0] & 0x80) {
    throw new Error(`unsafe tar entry: unsupported ${label}`);
  }
  const value = readTarText(bytes).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`unsafe tar entry: invalid ${label}`);
  }
  return Number.parseInt(value, 8);
}

function verifyTarChecksum(header) {
  const expected = readTarOctal(header.subarray(148, 156), 'checksum');
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) {
    throw new Error('unsafe tar entry: checksum mismatch');
  }
}

function safeTarDestination(root, rawName, type) {
  if (
    !rawName ||
    rawName.includes('\\') ||
    rawName.includes('\0') ||
    rawName.startsWith('/') ||
    /^[A-Za-z]:/.test(rawName) ||
    isAbsolute(rawName)
  ) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  const name = rawName.endsWith('/') ? rawName.slice(0, -1) : rawName;
  const parts = name.split('/');
  if (!name || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  if (type === '0' && rawName.endsWith('/')) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  const destination = resolve(root, ...parts);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (destination !== root && !destination.startsWith(rootPrefix)) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  return destination;
}

function inputStream(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return Readable.from([Buffer.from(input)]);
  }
  if (typeof input === 'string') {
    return createReadStream(input);
  }
  throw new Error('tar.gz input must be bytes or a file path');
}

export async function extractTarGz(
  input,
  targetDirectory,
  {
    maxContentBytes = DEFAULT_MAX_CONTENT_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  } = {},
) {
  const root = resolve(targetDirectory);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const gunzip = createGunzip();
  inputStream(input).pipe(gunzip);
  const reader = new StreamReader(gunzip);
  let entries = 0;
  let contentBytes = 0;

  try {
    for (;;) {
      const header = await reader.readExact(BLOCK_SIZE, true);
      if (!header) {
        throw new Error('unsafe tar entry: missing end marker');
      }
      if (header.every((byte) => byte === 0)) {
        return { contentBytes, entries };
      }
      entries += 1;
      if (entries > maxEntries) {
        throw new Error('archive limit exceeded: too many entries');
      }
      verifyTarChecksum(header);
      if (!readTarText(header.subarray(257, 263)).startsWith('ustar')) {
        throw new Error('unsafe tar entry: unsupported header');
      }
      const typeByte = header[156];
      const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
      if (type !== '0' && type !== '5') {
        throw new Error('unsafe tar entry: links and special files are forbidden');
      }
      const name = readTarText(header.subarray(0, 100));
      const prefix = readTarText(header.subarray(345, 500));
      const archiveName = prefix ? `${prefix}/${name}` : name;
      const size = readTarOctal(header.subarray(124, 136), 'size');
      const mode = readTarOctal(header.subarray(100, 108), 'mode') & 0o777;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error('unsafe tar entry: invalid size');
      }
      if (type === '5' && size !== 0) {
        throw new Error('unsafe tar entry: directory has content');
      }
      if (size > maxFileBytes || contentBytes + size > maxContentBytes) {
        throw new Error('archive limit exceeded: uncompressed content');
      }
      contentBytes += size;
      const destination = safeTarDestination(root, archiveName, type);

      if (type === '5') {
        await mkdir(destination, { recursive: true, mode: 0o755 });
        await chmod(destination, mode || 0o755);
      } else {
        await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
        const handle = await open(destination, 'wx', 0o644);
        try {
          await reader.writeExact(size, handle);
          await handle.chmod(mode || 0o644);
        } finally {
          await handle.close();
        }
      }
      const padding = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
      await reader.discard(padding);
    }
  } catch (error) {
    gunzip.destroy();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function requireHttps(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} URL must use HTTPS`);
  }
  return url.href;
}

export function currentPlatformKey(
  platform = process.platform,
  architecture = process.arch,
) {
  const key = `${platform}/${architecture}`;
  if (key === 'win32/x64') return 'windows-amd64';
  if (key === 'linux/x64') return 'linux-amd64';
  if (key === 'darwin/arm64') return 'darwin-arm64';
  throw new Error(`unsupported deployment platform: ${key}`);
}

export async function stageVerifiedRelease({
  fetchBytes,
  jobId,
  platform = currentPlatformKey(),
  publicKey = RELEASE_PUBLIC_KEY_PEM,
  stable,
  stagingDirectory,
}) {
  validateJobId(jobId);
  if (!['windows-amd64', 'linux-amd64', 'darwin-arm64'].includes(platform)) {
    throw new Error(`unsupported deployment platform: ${platform}`);
  }
  const manifestUrl = requireHttps(
    stable?.release?.manifestUrl,
    'release manifest',
  );
  const manifestBytes = await fetchBytes(manifestUrl);
  if (
    sha256Bytes(manifestBytes) !== stable.release.manifestSha256
  ) {
    throw new Error('release manifest SHA-256 verification failed');
  }
  const signatureBytes = await fetchBytes(`${manifestUrl}.sig`);
  if (
    !verify(
      null,
      manifestBytes,
      publicKey,
      Buffer.from(signatureBytes.toString('utf8').trim(), 'base64'),
    )
  ) {
    throw new Error('release manifest signature verification failed');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.schema !== 1 ||
    manifest.version !== stable.version ||
    manifest.sourceSha !== stable.sourceSha
  ) {
    throw new Error('release manifest identity is invalid');
  }
  const artifact = manifest.artifacts?.[platform];
  if (
    !artifact ||
    !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '') ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0
  ) {
    throw new Error(`release artifact metadata is invalid: ${platform}`);
  }
  const artifactUrl = requireHttps(artifact.url, 'release artifact');
  const archiveBytes = await fetchBytes(artifactUrl);
  if (archiveBytes.length !== artifact.size) {
    throw new Error('release archive size verification failed');
  }
  if (sha256Bytes(archiveBytes) !== artifact.sha256) {
    throw new Error('release archive SHA-256 verification failed');
  }

  const extractionDirectory = join(stagingDirectory, jobId, 'package');
  const extraction = await extractTarGz(archiveBytes, extractionDirectory);
  return {
    artifact,
    extraction,
    extractionDirectory,
    manifest,
    manifestSha256: sha256Bytes(manifestBytes),
  };
}

export async function runCore() {
  throw new Error('deployment application is not implemented yet');
}
