import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const BLOCK_SIZE = 512;

export function normalizeTarPath(input) {
  const normalized = input.replaceAll('\\', '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`unsafe tar path: ${input}`);
  }
  return normalized;
}

async function collectEntries(sourceDir, relative = '') {
  const directoryEntries = await readdir(sourceDir, { withFileTypes: true });
  directoryEntries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );

  const entries = [];
  for (const directoryEntry of directoryEntries) {
    const tarPath = normalizeTarPath(
      relative ? posix.join(relative, directoryEntry.name) : directoryEntry.name,
    );
    const sourcePath = join(sourceDir, directoryEntry.name);
    const stats = await lstat(sourcePath);

    if (stats.isSymbolicLink()) {
      throw new Error(`unsupported tar source entry: ${tarPath}`);
    }
    if (stats.isDirectory()) {
      entries.push({ mode: 0o755, path: `${tarPath}/`, size: 0, type: '5' });
      entries.push(...(await collectEntries(sourcePath, tarPath)));
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(`unsupported tar source entry: ${tarPath}`);
    }
    entries.push({
      body: await readFile(sourcePath),
      mode:
        tarPath === 'hub/wheelmaker' || tarPath === 'hub/wheelmaker.exe'
          ? 0o755
          : 0o644,
      path: tarPath,
      size: stats.size,
      type: '0',
    });
  }
  return entries;
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: '' };
  }

  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`tar path is too long for ustar: ${path}`);
}

function writeText(header, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) {
    throw new Error(`tar header value is too long: ${value}`);
  }
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length >= length) {
    throw new Error(`tar numeric value is too large: ${value}`);
  }
  writeText(header, offset, length, `${encoded}\0`);
}

function createHeader(entry) {
  const header = Buffer.alloc(BLOCK_SIZE);
  const { name, prefix } = splitUstarPath(entry.path);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeText(header, 156, 1, entry.type);
  writeText(header, 257, 6, 'ustar\0');
  writeText(header, 263, 2, '00');
  writeText(header, 265, 32, 'wheelmaker');
  writeText(header, 297, 32, 'wheelmaker');
  writeText(header, 345, 155, prefix);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

export async function createTarZst({ sourceDir, outputPath }) {
  const entries = await collectEntries(sourceDir);
  const blocks = [];
  for (const entry of entries) {
    blocks.push(createHeader(entry));
    if (entry.body) {
      blocks.push(entry.body);
      const padding = (BLOCK_SIZE - (entry.body.length % BLOCK_SIZE)) % BLOCK_SIZE;
      if (padding > 0) {
        blocks.push(Buffer.alloc(padding));
      }
    }
  }
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    zstdCompressSync(Buffer.concat(blocks), { level: 19 }),
  );
  return outputPath;
}

function readTarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

export async function listTarEntries(archivePath, { details = false } = {}) {
  const archive = zstdDecompressSync(await readFile(archivePath));
  const entries = [];
  for (let offset = 0; offset + BLOCK_SIZE <= archive.length; ) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const sizeText = readTarString(header.subarray(124, 136)).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const modeText = readTarString(header.subarray(100, 108)).trim();
    const path = prefix ? `${prefix}/${name}` : name;
    entries.push(
      details
        ? {
            mode: modeText ? Number.parseInt(modeText, 8) : 0,
            path,
            size,
            type: String.fromCharCode(header[156]),
          }
        : path,
    );
    offset += BLOCK_SIZE + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  return entries;
}
