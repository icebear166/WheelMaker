import { createHash, timingSafeEqual } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const MANIFEST_FILENAME = 'release-manifest.json';
const MANIFEST_FIELDS = new Set(['schema', 'releaseId', 'generatedAt', 'files']);
const FILE_FIELDS = new Set(['path', 'bytes', 'sha256']);
const SHA256 = /^[a-f0-9]{64}$/;

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function nativePath(value) {
  return value.split('/').join(path.sep);
}

function assertExactFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} contains unsupported field ${key}`);
    }
  }
}

function assertSafeManifestPath(value) {
  if (typeof value !== 'string'
    || value === ''
    || value.includes('\\')
    || value.startsWith('/')
    || path.posix.normalize(value) !== value
    || value === '..'
    || value.startsWith('../')) {
    throw new Error(`release manifest contains unsafe path ${JSON.stringify(value)}`);
  }
}

async function hashFile(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function listReleaseFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      const info = await lstat(filename);
      const relativePath = normalizePath(path.relative(root, filename));
      if (info.isSymbolicLink()) {
        throw new Error(`release root contains symbolic link ${relativePath}`);
      }
      if (info.isDirectory()) {
        await visit(filename);
      } else if (info.isFile()) {
        files.push({ filename, path: relativePath, bytes: info.size });
      } else {
        throw new Error(`release root contains non-regular file ${relativePath}`);
      }
    }
  }
  await visit(root);
  return files;
}

export async function writeReleaseManifest({ root, releaseId, generatedAt } = {}) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new Error('release root is required');
  }
  if (typeof releaseId !== 'string' || releaseId.trim() === '') {
    throw new Error('releaseId is required');
  }
  if (generatedAt !== undefined
    && (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)))) {
    throw new Error('generatedAt must be an ISO date-time');
  }

  const resolvedRoot = await realpath(path.resolve(root));
  const files = [];
  for (const file of await listReleaseFiles(resolvedRoot)) {
    if (file.path === MANIFEST_FILENAME) {
      continue;
    }
    files.push({
      path: file.path,
      bytes: file.bytes,
      sha256: await hashFile(file.filename),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema: 1,
    releaseId,
    ...(generatedAt === undefined ? {} : { generatedAt }),
    files,
  };
  await writeFile(
    path.join(resolvedRoot, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

function parseManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`release manifest is invalid JSON: ${error.message}`);
  }
  assertExactFields(manifest, MANIFEST_FIELDS, 'release manifest');
  if (manifest.schema !== 1
    || typeof manifest.releaseId !== 'string'
    || manifest.releaseId.trim() === ''
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    throw new Error('release manifest has an invalid header');
  }
  if (manifest.generatedAt !== undefined
    && (typeof manifest.generatedAt !== 'string' || !Number.isFinite(Date.parse(manifest.generatedAt)))) {
    throw new Error('release manifest has an invalid generatedAt');
  }
  return manifest;
}

function checksumsEqual(actual, expected) {
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function verifyReleaseRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('release root must be an absolute path');
  }
  const resolvedRoot = await realpath(root);
  const manifest = parseManifest(await readFile(path.join(resolvedRoot, MANIFEST_FILENAME), 'utf8'));
  const listed = new Set([MANIFEST_FILENAME]);

  for (const item of manifest.files) {
    assertExactFields(item, FILE_FIELDS, 'release manifest file');
    assertSafeManifestPath(item.path);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      throw new Error(`release manifest has invalid size for ${item.path}`);
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new Error(`release manifest has invalid checksum for ${item.path}`);
    }
    if (listed.has(item.path)) {
      throw new Error(`release manifest contains duplicate path ${item.path}`);
    }
    listed.add(item.path);

    const filename = path.join(resolvedRoot, nativePath(item.path));
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== item.bytes) {
      throw new Error(`manifest file ${item.path} has an unexpected size or type`);
    }
    const actualChecksum = await hashFile(filename);
    if (!checksumsEqual(actualChecksum, item.sha256)) {
      throw new Error(`manifest checksum mismatch for ${item.path}`);
    }
  }

  for (const file of await listReleaseFiles(resolvedRoot)) {
    if (!listed.has(file.path)) {
      throw new Error(`release root contains unlisted file ${file.path}`);
    }
  }
  return true;
}
