import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { parseProjectRouting } from './project-routing.mjs';
import { parseUserConfig } from './user-config.mjs';

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function safeTimestamp(value) {
  const timestamp = value || new Date().toISOString().replace(/[-:.]/gu, '');
  if (!/^[A-Za-z0-9_-]+$/u.test(timestamp)) {
    throw new Error('迁移时间标识包含不安全字符');
  }
  return timestamp;
}

function parseLegacyLocator(source) {
  let legacy;
  try {
    legacy = JSON.parse(source);
  } catch (error) {
    throw new Error(`旧定位配置不是有效 JSON：${error.message}`);
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new Error('旧定位配置必须是对象');
  }
  const allowed = new Set(['schema', 'repositoryPath', 'publicUrl']);
  for (const field of Object.keys(legacy)) {
    if (!allowed.has(field)) {
      throw new Error(`旧定位配置包含不支持的字段 ${field}`);
    }
  }
  return parseUserConfig(JSON.stringify({
    schema: 1,
    repositoryPath: legacy.repositoryPath,
    ...(legacy.publicUrl === undefined ? {} : { publicUrl: legacy.publicUrl }),
  }));
}

export async function previewLegacyMigration({
  legacyConfigPath,
  legacyRoutingPath,
  destinationDirectory,
} = {}) {
  if (!legacyConfigPath || !legacyRoutingPath || !destinationDirectory) {
    throw new Error('旧配置迁移需要定位文件、路由文件和目标目录');
  }
  const [legacyConfig, legacyRouting] = await Promise.all([
    readFile(path.resolve(legacyConfigPath), 'utf8'),
    readFile(path.resolve(legacyRoutingPath), 'utf8'),
  ]);
  const config = parseLegacyLocator(legacyConfig);
  const routing = parseProjectRouting(legacyRouting);
  const destination = path.resolve(destinationDirectory);
  return {
    config,
    routing,
    destination,
    configPath: path.join(destination, 'config.json'),
    routingPath: path.join(destination, 'project-routing.json'),
    changes: [
      `写入 ${path.join(destination, 'config.json')}`,
      `写入 ${path.join(destination, 'project-routing.json')}`,
      '保留旧配置文件，不再由新 Skill 读取',
    ],
  };
}

async function writeCandidate(filename, value, suffix) {
  const candidate = `${filename}.candidate-${suffix}`;
  if (await pathExists(candidate)) {
    throw new Error(`迁移候选文件已存在：${candidate}`);
  }
  await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return candidate;
}

export async function migrateLegacyConfig(options, {
  confirm = async () => false,
  verify = async () => {},
  timestamp,
} = {}) {
  const preview = await previewLegacyMigration(options);
  if (!await confirm(preview)) {
    return { status: 'cancelled', preview, backups: [] };
  }
  const suffix = safeTimestamp(timestamp);
  await mkdir(preview.destination, { recursive: true });
  const backupDirectory = path.join(preview.destination, '.backups', suffix);
  await mkdir(backupDirectory, { recursive: true });
  const entries = [
    {
      target: preview.configPath,
      value: preview.config,
      backup: path.join(backupDirectory, 'config.json'),
      failed: `${preview.configPath}.failed-${suffix}`,
    },
    {
      target: preview.routingPath,
      value: preview.routing,
      backup: path.join(backupDirectory, 'project-routing.json'),
      failed: `${preview.routingPath}.failed-${suffix}`,
    },
  ];
  for (const entry of entries) {
    entry.candidate = await writeCandidate(entry.target, entry.value, suffix);
    entry.hadExisting = await pathExists(entry.target);
  }

  try {
    for (const entry of entries) {
      if (entry.hadExisting) {
        await rename(entry.target, entry.backup);
      }
      await rename(entry.candidate, entry.target);
      entry.swapped = true;
    }
    await verify({
      configPath: preview.configPath,
      routingPath: preview.routingPath,
      config: preview.config,
      routing: preview.routing,
    });
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.swapped && await pathExists(entry.target)) {
        await rename(entry.target, entry.failed);
      } else if (await pathExists(entry.candidate)) {
        await rename(entry.candidate, entry.failed);
      }
      if (entry.hadExisting) {
        await copyFile(entry.backup, entry.target);
      }
    }
    throw error;
  }
  return {
    status: 'migrated',
    preview,
    backups: entries.filter((entry) => entry.hadExisting).map((entry) => entry.backup),
  };
}
