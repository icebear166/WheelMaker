import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const TAR_BLOCK = 512;

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertPrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.startsWith('/') || prefix.includes('..') || (prefix && !prefix.endsWith('/'))) {
    throw new Error('archive prefix must be an empty or safe trailing-slash path');
  }
}

export async function collectArchiveEntries(root, {executablePaths = new Set()} = {}) {
  const source = path.resolve(root);
  const entries = [];
  async function visit(directory) {
    const children = await readdir(directory, {withFileTypes: true});
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const filename = path.join(directory, child.name);
      const info = await lstat(filename);
      const relative = normalizeRelative(path.relative(source, filename));
      if (info.isSymbolicLink()) throw new Error(`archive input contains symbolic link ${relative}`);
      if (info.isDirectory()) await visit(filename);
      else if (info.isFile()) {
        const data = await readFile(filename);
        entries.push({path: relative, data, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mode: executablePaths.has(relative) ? 0o755 : 0o644, mtime: 0});
      } else throw new Error(`archive input contains non-regular file ${relative}`);
    }
  }
  await visit(source);
  entries.sort((left, right) => compareText(left.path, right.path));
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function writeZipArchive({source, output, prefix = '', executablePaths} = {}) {
  assertPrefix(prefix);
  const entries = await collectArchiveEntries(source, {executablePaths});
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(`${prefix}${entry.path}`, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes, 18);
    local.writeUInt32LE(entry.bytes, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.bytes, 20);
    central.writeUInt32LE(entry.bytes, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await mkdir(path.dirname(path.resolve(output)), {recursive: true});
  await writeFile(output, Buffer.concat([...localParts, ...centralParts, end]));
  return {output: path.resolve(output), entries};
}

function writeOctal(buffer, offset, length, value) {
  const text = Math.max(0, value).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  buffer.write(text, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function splitTarPath(value) {
  if (Buffer.byteLength(value) <= 100) return {name: value, prefix: ''};
  for (let index = value.lastIndexOf('/'); index > 0; index = value.lastIndexOf('/', index - 1)) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return {name, prefix};
  }
  return null;
}

function tarHeader({archivePath, size, mode, type = '0'}) {
  const header = Buffer.alloc(TAR_BLOCK);
  const split = splitTarPath(archivePath) || {name: path.posix.basename(archivePath).slice(-100), prefix: ''};
  header.write(split.name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 32, 'ascii');
  header.write('root', 297, 32, 'ascii');
  if (split.prefix) header.write(split.prefix, 345, 155, 'utf8');
  writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
  return header;
}

function padTar(data) {
  const padding = (TAR_BLOCK - (data.length % TAR_BLOCK)) % TAR_BLOCK;
  return padding === 0 ? [data] : [data, Buffer.alloc(padding)];
}

function paxPathRecord(value) {
  const suffix = ` path=${value}\n`;
  let length = Buffer.byteLength(suffix) + 1;
  while (Buffer.byteLength(`${length}${suffix}`) !== length) length = Buffer.byteLength(`${length}${suffix}`);
  return Buffer.from(`${length}${suffix}`, 'utf8');
}

export async function writeTarGzArchive({source, output, prefix = '', executablePaths} = {}) {
  assertPrefix(prefix);
  const entries = await collectArchiveEntries(source, {executablePaths});
  const parts = [];
  for (const entry of entries) {
    const archivePath = `${prefix}${entry.path}`;
    if (!splitTarPath(archivePath)) {
      const pax = paxPathRecord(archivePath);
      parts.push(tarHeader({archivePath: `PaxHeaders/${path.posix.basename(entry.path).slice(-80)}`, size: pax.length, mode: 0o644, type: 'x'}), ...padTar(pax));
    }
    parts.push(tarHeader({archivePath, size: entry.bytes, mode: entry.mode}), ...padTar(entry.data));
  }
  parts.push(Buffer.alloc(TAR_BLOCK * 2));
  await mkdir(path.dirname(path.resolve(output)), {recursive: true});
  await writeFile(output, gzipSync(Buffer.concat(parts), {level: 9, mtime: 0}));
  return {output: path.resolve(output), entries};
}
