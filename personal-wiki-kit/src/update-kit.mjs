import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { parseKitManifest } from './kit-manifest.mjs';
import {
  loadKitLock,
  parseKitLock,
  sha256File,
  writeKitLock,
} from './kit-lock.mjs';

const execFileAsync = promisify(execFile);

async function defaultCompatibilityCheck({ candidateKitRoot, repository }) {
  const packagedRuntime = path.join(
    candidateKitRoot,
    'runtime',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  let runtime = process.execPath;
  try {
    await access(packagedRuntime);
    runtime = packagedRuntime;
  } catch {
    // A source checkout uses the current development runtime.
  }
  await execFileAsync(
    runtime,
    [path.join(candidateKitRoot, 'src', 'cli.mjs'), 'check', '--repository', repository],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
}

async function defaultBeginMigration() {
  return {
    apply: async () => {},
    rollback: async () => {},
    finalize: async () => {},
  };
}

function sameLock(left, right) {
  return left.schema === right.schema
    && left.version === right.version
    && left.source === right.source
    && left.sha256 === right.sha256;
}

export async function updateKit(options = {}, {
  checkCompatibility = defaultCompatibilityCheck,
  beginMigration = defaultBeginMigration,
} = {}) {
  for (const field of ['repository', 'candidateKitRoot', 'candidateArtifact']) {
    if (typeof options[field] !== 'string' || options[field].trim() === '') {
      throw new Error(`Kit 更新缺少 ${field}`);
    }
  }
  const repository = path.resolve(options.repository);
  const candidateKitRoot = path.resolve(options.candidateKitRoot);
  const candidateArtifact = path.resolve(options.candidateArtifact);
  const target = parseKitLock(JSON.stringify(options.targetLock));
  const current = await loadKitLock(path.join(repository, 'wiki-kit.lock.json'));
  const candidateManifest = parseKitManifest(
    await readFile(path.join(candidateKitRoot, 'kit.json'), 'utf8'),
  );
  if (candidateManifest.version !== target.version) {
    throw new Error(`候选 Kit 版本 ${candidateManifest.version} 与目标锁 ${target.version} 不一致`);
  }
  const digest = await sha256File(candidateArtifact);
  if (digest !== target.sha256) {
    throw new Error(`候选 Kit SHA-256 不匹配：期望 ${target.sha256}，实际 ${digest}`);
  }
  if (sameLock(current, target)) {
    return { changed: false, previous: current, current };
  }

  const context = { repository, candidateKitRoot, candidateArtifact, previous: current, target };
  await checkCompatibility(context);
  const transaction = await beginMigration(context);
  if (!transaction || typeof transaction.apply !== 'function' || typeof transaction.rollback !== 'function') {
    throw new Error('Kit 迁移器没有提供 apply/rollback 事务');
  }
  let lockWritten = false;
  try {
    await transaction.apply();
    await checkCompatibility(context);
    await writeKitLock(path.join(repository, 'wiki-kit.lock.json'), target);
    lockWritten = true;
    await transaction.finalize?.();
  } catch (error) {
    const failures = [error];
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      failures.push(rollbackError);
    }
    if (lockWritten) {
      try {
        await writeKitLock(path.join(repository, 'wiki-kit.lock.json'), current);
      } catch (restoreError) {
        failures.push(restoreError);
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'Kit 更新失败，回滚不完整');
    throw error;
  }
  return { changed: true, previous: current, current: target };
}
