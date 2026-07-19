import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, posix, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCommand} from './commands.mjs';
import {acquireBuildLock} from './build-lock.mjs';

export async function buildDebugWeb({repoRoot, outputPath, runner = runCommand, workRoot = join(repoRoot, '.release-work')}) {
  const sourceDir = join(workRoot, 'tmp', 'debug-web', 'web-source');
  const environment = {WHEELMAKER_WEB_TARGET: sourceDir, WHEELMAKER_WEBPACK_CACHE: join(workRoot, 'cache', 'webpack')};
  await mkdir(sourceDir, {recursive: true});
  await mkdir(environment.WHEELMAKER_WEBPACK_CACHE, {recursive: true});
  await runner('npm', ['ci', '--include=dev'], {cwd: join(repoRoot, 'app'), env: environment});
  await runner('npm', ['run', 'build:web:release'], {cwd: join(repoRoot, 'app'), env: environment});
  const archivePath = await createDebugWebZip({sourceDir, outputPath});
  const bytes = await readFile(archivePath);
  const asset = {path: archivePath, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  return asset;
}

export async function createDebugWebZip({sourceDir, outputPath}) {
  const entries = await collectZipFiles(sourceDir);
  const records = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8'); const body = await readFile(entry.sourcePath); const crc = crc32(body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    records.push(local, name, body);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(body.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  await mkdir(dirname(outputPath), {recursive: true}); await writeFile(outputPath, Buffer.concat([...records, directory, end])); return outputPath;
}

async function collectZipFiles(root, directory = root) {
  const files = [];
  for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = join(directory, entry.name); const info = await lstat(sourcePath); const path = posix.normalize(relative(root, sourcePath).replaceAll('\\', '/'));
    if (!path || path.startsWith('../') || path.includes('/../') || path.startsWith('/')) throw new Error(`unsafe debug web path: ${path}`);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(`unsupported debug web entry: ${path}`);
    if (info.isDirectory()) files.push(...await collectZipFiles(root, sourcePath)); else files.push({path, sourcePath});
  }
  return files;
}

function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let index = 0; index < 8; index += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; }

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1])) throw new Error('usage: node scripts/release/debug-web.mjs --output <absolute-zip-path>');
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const workRoot = join(repoRoot, '.release-work');
  const lock = await acquireBuildLock({owner: 'debug-web', workRoot});
  try {
    await buildDebugWeb({repoRoot, outputPath: args[1], workRoot});
  } finally {
    await lock.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`[debug-web] Failed: ${error.message}\n`); process.exitCode = 1; });
}
