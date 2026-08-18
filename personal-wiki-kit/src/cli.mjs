#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import YAML from 'yaml';

import { compileKnowledge } from './content.mjs';
import { migrateLegacyConfig } from './migrate-config.mjs';
import { openLocalWiki } from './open-local.mjs';
import { loadProjectRouting, resolveProjectIds } from './project-routing.mjs';
import { queryKnowledge } from './query-knowledge.mjs';
import { setupWiki } from './setup.mjs';
import { loadUserConfig, resolveUserConfigPaths } from './user-config.mjs';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function parseArguments(values) {
  if (values.length === 0) {
    throw new Error('缺少命令');
  }
  const command = values[0];
  const options = { projects: [], sources: [] };
  const booleans = new Set(['--working-tree', '--yes']);
  const repeatable = new Map([
    ['--project', 'projects'],
    ['--source', 'sources'],
  ]);
  for (let index = 1; index < values.length; index += 1) {
    const key = values[index];
    if (booleans.has(key)) {
      options[key.slice(2).replace('-', '')] = true;
      continue;
    }
    if (!key.startsWith('--')) {
      throw new Error(`不支持的参数：${key}`);
    }
    const value = values[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 ${key} 缺少值`);
    }
    const repeatableField = repeatable.get(key);
    if (repeatableField) options[repeatableField].push(value);
    else options[key.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return { command, options };
}

async function resolveRepository(options) {
  if (options.repository) return path.resolve(options.repository);
  return (await loadUserConfig({ configPath: options.config })).repositoryPath;
}

async function checkCommand(options) {
  const repository = await resolveRepository(options);
  const output = await mkdtemp(path.join(tmpdir(), 'personal-wiki-check-'));
  try {
    const result = await compileKnowledge({
      repository,
      output,
      generatedAt: new Date().toISOString(),
    });
    return {
      repository,
      articleCount: result.catalog.articleCount,
      sectionCount: result.catalog.sections.length,
    };
  } finally {
    await rm(output, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function queryCommand(options) {
  return queryKnowledge({
    repository: options.repository,
    configPath: options.config,
    query: options.query,
    projects: options.projects,
    limit: options.limit === undefined ? undefined : Number(options.limit),
    workingTree: options.workingtree === true,
  });
}

function projectIdsFromRegistry(source) {
  const document = YAML.parse(source);
  if (!document || document.schema !== 1 || !Array.isArray(document.projects)) {
    throw new Error('项目注册表必须使用 schema 1，并包含 projects 数组');
  }
  const ids = new Set();
  for (const [index, project] of document.projects.entries()) {
    if (!project || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project.id || '') || project.id === 'unassigned') {
      throw new Error(`projects[${index}].id 无效`);
    }
    if (ids.has(project.id)) throw new Error(`项目 ID 重复：${project.id}`);
    ids.add(project.id);
  }
  return ids;
}

async function routeCommand(options) {
  const repository = await resolveRepository(options);
  const configPath = path.resolve(options.config || resolveUserConfigPaths().config);
  const routingPath = path.resolve(
    options.routing || path.join(path.dirname(configPath), 'project-routing.json'),
  );
  const projectIds = projectIdsFromRegistry(
    await readFile(path.join(repository, 'content', 'registry', 'projects.yaml'), 'utf8'),
  );
  const routing = await loadProjectRouting({ routingPath, projectIds });
  return resolveProjectIds(routing, {
    sourcePaths: options.sources,
    workspacePath: options.workspace,
  });
}

async function sourceCommit(repository) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', `safe.directory=${repository}`, '-C', repository, 'rev-parse', '--verify', 'HEAD'],
      { encoding: 'utf8', windowsHide: true },
    );
    return stdout.trim();
  } catch {
    return 'uncommitted';
  }
}

async function openCommand(options) {
  const repository = await resolveRepository(options);
  const kitManifest = JSON.parse(await readFile(path.join(kitRoot, 'kit.json'), 'utf8'));
  const executableName = process.platform === 'win32' ? 'wiki-server.exe' : 'wiki-server';
  const packagedServer = path.join(kitRoot, 'bin', executableName);
  const developmentServer = path.join(kitRoot, 'server', executableName);
  let serverExecutable = options.server ? path.resolve(options.server) : undefined;
  if (!serverExecutable) {
    for (const candidate of [packagedServer, developmentServer]) {
      try {
        await access(candidate);
        serverExecutable = candidate;
        break;
      } catch {}
    }
  }
  if (!serverExecutable) {
    throw new Error('找不到 wiki-server，请先构建或安装完整 Kit');
  }
  const session = await openLocalWiki({
    repository,
    reader: path.resolve(options.reader || path.join(kitRoot, 'reader-dist')),
    serverExecutable,
    kitVersion: kitManifest.version,
    sourceCommit: await sourceCommit(repository),
    generatedAt: new Date().toISOString(),
  });
  const stop = () => { void session.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return session;
}

async function setupCommand(options, prompt) {
  const repositoryPath = path.resolve(
    options.repository || await prompt.text('私人 Wiki 仓库目录：'),
  );
  const siteTitle = options.title || await prompt.text('网站标题（默认 Personal Wiki）：') || 'Personal Wiki';
  const publicUrl = options.publicUrl || await prompt.text('可选网站地址（留空跳过）：');
  const githubRepository = options.githubRepository
    || await prompt.text('可选 GitHub owner/name（留空只创建本地仓库）：');
  const userPaths = resolveUserConfigPaths();
  const kitManifestSource = await readFile(path.join(kitRoot, 'kit.json'));
  const kitManifest = JSON.parse(kitManifestSource);
  return setupWiki({
    repositoryPath,
    configDirectory: options.configDirectory || userPaths.directory,
    skillsDirectory: options.skillsDirectory || path.join(homedir(), '.codex', 'skills'),
    kitRoot,
    kitVersion: kitManifest.version,
    kitSource: options.kitSource || 'local-kit',
    kitSha256: options.kitSha256
      || createHash('sha256').update(kitManifestSource).digest('hex'),
    siteTitle,
    ...(publicUrl ? { publicUrl } : {}),
    ...(githubRepository ? { githubRepository } : {}),
  }, {
    confirm: options.yes ? async () => true : prompt.confirm,
  });
}

async function migrateCommand(options, prompt) {
  return migrateLegacyConfig({
    legacyConfigPath: options.legacyConfig,
    legacyRoutingPath: options.legacyRouting,
    destinationDirectory: options.destination || resolveUserConfigPaths().directory,
  }, {
    confirm: options.yes ? async () => true : prompt.confirm,
    verify: async ({ configPath, routingPath }) => {
      await loadUserConfig({ configPath });
      await loadProjectRouting({ routingPath });
    },
  });
}

function defaultPrompt() {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return {
    text: async (question) => (await terminal.question(question)).trim(),
    confirm: async (question) => /^y(?:es)?$/iu.test(
      (await terminal.question(`${question} [y/N] `)).trim(),
    ),
    close: () => terminal.close(),
  };
}

export async function runCLI(values = process.argv.slice(2), {
  prompt = defaultPrompt(),
  stdout = process.stdout,
} = {}) {
  try {
    const { command, options } = parseArguments(values);
    let result;
    if (command === 'check') result = await checkCommand(options);
    else if (command === 'query') result = await queryCommand(options);
    else if (command === 'route') result = await routeCommand(options);
    else if (command === 'setup') result = await setupCommand(options, prompt);
    else if (command === 'open') result = await openCommand(options);
    else if (command === 'migrate-config') result = await migrateCommand(options, prompt);
    else throw new Error(`未知命令：${command}`);
    const printable = command === 'open' ? { url: result.url } : result;
    stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    return result;
  } finally {
    prompt.close?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCLI().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
