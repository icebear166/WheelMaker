import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const CONFIG_FIELDS = new Set(['schema', 'repositoryPath', 'publicUrl']);

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

function parsePublicOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('publicUrl 必须是非空字符串');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('公开地址必须是规范 origin');
  }
  if (parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('公开地址必须是规范 origin，不能包含路径、凭据、查询或片段');
  }
  if (parsed.protocol !== 'https:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error('公网地址必须使用 HTTPS');
  }
  return parsed.origin;
}

export function parseUserConfig(source) {
  let config;
  try {
    config = JSON.parse(String(source));
  } catch (error) {
    throw new Error(`用户配置不是有效 JSON：${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('用户配置必须是对象');
  }
  for (const field of Object.keys(config)) {
    if (!CONFIG_FIELDS.has(field)) {
      throw new Error(`用户配置包含不支持的字段 ${field}`);
    }
  }
  if (config.schema !== 1) {
    throw new Error('用户配置 schema 必须是 1');
  }
  if (typeof config.repositoryPath !== 'string'
    || config.repositoryPath.trim() === ''
    || !path.isAbsolute(config.repositoryPath)) {
    throw new Error('repositoryPath 必须是绝对路径');
  }
  const repositoryPath = path.normalize(config.repositoryPath);
  return {
    schema: 1,
    repositoryPath,
    ...(config.publicUrl === undefined ? {} : { publicUrl: parsePublicOrigin(config.publicUrl) }),
  };
}

export function resolveUserConfigPaths({ homeDirectory = homedir() } = {}) {
  if (typeof homeDirectory !== 'string' || !path.isAbsolute(homeDirectory)) {
    throw new Error('用户主目录必须是绝对路径');
  }
  const directory = path.join(path.normalize(homeDirectory), '.personal-wiki');
  return {
    directory,
    config: path.join(directory, 'config.json'),
    routing: path.join(directory, 'project-routing.json'),
  };
}

export async function loadUserConfig({ configPath } = {}) {
  const filename = path.resolve(configPath || resolveUserConfigPaths().config);
  try {
    return parseUserConfig(await readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取个人 Wiki 用户配置 ${filename}：${error.message}`, { cause: error });
  }
}
