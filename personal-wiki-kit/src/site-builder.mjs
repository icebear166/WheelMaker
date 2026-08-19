import { createHash, timingSafeEqual } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { verifyReleaseRoot, writeReleaseManifest } from './release-manifest.mjs';
import { parseKitManifest } from './kit-manifest.mjs';

const READER_MANIFEST = 'reader-manifest.json';
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const READER_FIELDS = new Set(['schema', 'kitVersion', 'files']);
const FILE_FIELDS = new Set(['path', 'bytes', 'sha256']);

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

function assertSafePath(value, label) {
  if (typeof value !== 'string'
    || value === ''
    || value.includes('\\')
    || value.startsWith('/')
    || path.posix.normalize(value) !== value
    || value === '..'
    || value.startsWith('../')) {
    throw new Error(`${label} contains unsafe path ${JSON.stringify(value)}`);
  }
}

async function hashFile(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

function checksumsEqual(actual, expected) {
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      const info = await lstat(filename);
      const relativePath = normalizePath(path.relative(root, filename));
      if (info.isSymbolicLink()) {
        throw new Error(`Reader contains symbolic link ${relativePath}`);
      }
      if (info.isDirectory()) {
        await visit(filename);
      } else if (info.isFile()) {
        files.push({ filename, path: relativePath, bytes: info.size });
      } else {
        throw new Error(`Reader contains non-regular file ${relativePath}`);
      }
    }
  }
  await visit(root);
  return files;
}

function parseReaderManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Reader manifest is invalid JSON: ${error.message}`);
  }
  assertExactFields(manifest, READER_FIELDS, 'Reader manifest');
  if (manifest.schema !== 1
    || typeof manifest.kitVersion !== 'string'
    || !SEMANTIC_VERSION.test(manifest.kitVersion)
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) {
    throw new Error('Reader manifest has an invalid header');
  }
  return manifest;
}

export async function writeReaderManifest({ reader, kitVersion } = {}) {
  if (typeof reader !== 'string' || !path.isAbsolute(reader)) {
    throw new Error('Reader root must be an absolute path');
  }
  if (typeof kitVersion !== 'string' || !SEMANTIC_VERSION.test(kitVersion)) {
    throw new Error('Reader kitVersion must be an exact semantic version');
  }
  const readerRoot = await realpath(reader);
  const files = [];
  for (const file of await listFiles(readerRoot)) {
    if (file.path === READER_MANIFEST) {
      continue;
    }
    files.push({
      path: file.path,
      bytes: file.bytes,
      sha256: await hashFile(file.filename),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some((file) => file.path === 'index.html')) {
    throw new Error('Reader must contain index.html');
  }
  const manifest = { schema: 1, kitVersion, files };
  await writeFile(
    path.join(readerRoot, READER_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

async function verifyReaderRoot(reader, expectedKitVersion) {
  const readerInfo = await lstat(reader);
  if (readerInfo.isSymbolicLink() || !readerInfo.isDirectory()) {
    throw new Error('Reader root must be a regular directory');
  }
  const readerRoot = await realpath(reader);
  const manifest = parseReaderManifest(
    await readFile(path.join(readerRoot, READER_MANIFEST), 'utf8'),
  );
  if (manifest.kitVersion !== expectedKitVersion) {
    throw new Error(`Reader Kit version ${manifest.kitVersion} does not match ${expectedKitVersion}`);
  }
  const listed = new Set([READER_MANIFEST]);
  for (const item of manifest.files) {
    assertExactFields(item, FILE_FIELDS, 'Reader manifest file');
    assertSafePath(item.path, 'Reader manifest');
    if (item.path === READER_MANIFEST
      || item.path === 'release-manifest.json'
      || item.path === 'release-metadata.json'
      || item.path === 'data'
      || item.path.startsWith('data/')
      || item.path === 'attachments'
      || item.path.startsWith('attachments/')) {
      throw new Error(`Reader contains reserved path ${item.path}`);
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      throw new Error(`Reader manifest has invalid size for ${item.path}`);
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new Error(`Reader manifest has invalid checksum for ${item.path}`);
    }
    if (listed.has(item.path)) {
      throw new Error(`Reader manifest repeats path ${item.path}`);
    }
    listed.add(item.path);
    const filename = path.join(readerRoot, nativePath(item.path));
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== item.bytes) {
      throw new Error(`Reader file size changed for ${item.path}`);
    }
    if (!checksumsEqual(await hashFile(filename), item.sha256)) {
      throw new Error(`Reader checksum mismatch for ${item.path}`);
    }
  }
  for (const file of await listFiles(readerRoot)) {
    if (!listed.has(file.path)) {
      throw new Error(`unlisted Reader file ${file.path}`);
    }
  }
  return { root: readerRoot, manifest };
}

async function parseDataRelease(data) {
  await verifyReleaseRoot(data);
  const dataRoot = await realpath(data);
  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'release-manifest.json'), 'utf8'));
  for (const item of manifest.files) {
    const allowed = item.path === 'data'
      || item.path.startsWith('data/')
      || item.path === 'attachments'
      || item.path.startsWith('attachments/');
    if (!allowed) {
      throw new Error(`knowledge release contains unsupported site path ${item.path}`);
    }
  }
  return { root: dataRoot, manifest };
}

async function prepareEmptyOutput(output) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('site output is required');
  }
  const resolved = path.resolve(output);
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('site output must be a regular directory');
    }
    if ((await readdir(resolved)).length > 0) {
      throw new Error('site output directory must be empty');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await mkdir(resolved, { recursive: true });
  }
  return realpath(resolved);
}

async function copyDeclaredFiles(sourceRoot, outputRoot, files) {
  for (const file of files) {
    const source = path.join(sourceRoot, nativePath(file.path));
    const destination = path.join(outputRoot, nativePath(file.path));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

export async function buildSite({
  reader,
  data,
  output,
  releaseId,
  generatedAt,
  sourceCommit,
  kitVersion,
} = {}) {
  if (typeof releaseId !== 'string' || releaseId.trim() === '') {
    throw new Error('site releaseId is required');
  }
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('site generatedAt must be an ISO date-time');
  }
  if (typeof sourceCommit !== 'string' || !/^(?:[a-f0-9]{7,64}|uncommitted)$/u.test(sourceCommit)) {
    throw new Error('site sourceCommit must be a Git object id or uncommitted');
  }
  if (typeof kitVersion !== 'string' || !SEMANTIC_VERSION.test(kitVersion)) {
    throw new Error('site kitVersion must be an exact semantic version');
  }
  const verifiedReader = await verifyReaderRoot(path.resolve(reader), kitVersion);
  const verifiedData = await parseDataRelease(path.resolve(data));
  const outputRoot = await prepareEmptyOutput(output);

  await copyDeclaredFiles(verifiedReader.root, outputRoot, verifiedReader.manifest.files);
  await copyDeclaredFiles(verifiedData.root, outputRoot, verifiedData.manifest.files);
  const metadata = {
    schema: 1,
    releaseId,
    generatedAt,
    sourceCommit,
    kitVersion,
  };
  await writeFile(
    path.join(outputRoot, 'release-metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
  const manifest = await writeReleaseManifest({
    root: outputRoot,
    releaseId,
    generatedAt,
  });
  return { output: outputRoot, metadata, manifest };
}

async function runCLI() {
  const [command, reader, manifestPath] = process.argv.slice(2);
  if (command !== 'seal-reader' || !reader || !manifestPath) {
    throw new Error('usage: node src/site-builder.mjs seal-reader <reader-root> <kit-manifest>');
  }
  const kit = parseKitManifest(await readFile(path.resolve(manifestPath), 'utf8'));
  await writeReaderManifest({ reader: path.resolve(reader), kitVersion: kit.version });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCLI().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
