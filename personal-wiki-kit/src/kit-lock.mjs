import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const FIELDS = new Set(['schema', 'version', 'source', 'sha256']);
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SOURCE_LABEL = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

function validSource(value) {
  if (SOURCE_LABEL.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.hostname !== ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

export function parseKitLock(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Kit 锁文件不是有效 JSON：${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Kit 锁文件必须是 JSON 对象');
  }
  for (const field of Object.keys(value)) {
    if (!FIELDS.has(field)) throw new Error(`Kit 锁文件包含未知字段：${field}`);
  }
  for (const field of FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`Kit 锁文件缺少字段：${field}`);
  }
  if (value.schema !== 1) throw new Error(`不支持的 Kit 锁 schema：${value.schema}`);
  if (typeof value.version !== 'string' || !EXACT_VERSION.test(value.version)) {
    throw new Error('Kit 锁必须使用精确语义版本');
  }
  if (typeof value.source !== 'string' || !validSource(value.source)) {
    throw new Error('Kit 锁 source 必须是安全的发布标签或 HTTPS 地址');
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new Error('Kit 锁 sha256 必须是小写 SHA-256');
  }
  return {
    schema: 1,
    version: value.version,
    source: value.source,
    sha256: value.sha256,
  };
}

export async function loadKitLock(filename) {
  return parseKitLock(await readFile(path.resolve(filename), 'utf8'));
}

export async function writeKitLock(filename, lock) {
  const target = path.resolve(filename);
  const validated = parseKitLock(JSON.stringify(lock));
  await mkdir(path.dirname(target), { recursive: true });
  const candidate = `${target}.candidate-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(candidate, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(candidate, target);
  } finally {
    await rm(candidate, { force: true });
  }
  return validated;
}

export function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path.resolve(filename));
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
