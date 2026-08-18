import { spawn } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {parseDeploymentConfig, renderPrivatePublishWorkflow} from './deployment-config.mjs';
import { installSkills } from './install-skills.mjs';
import {parseKitLock} from './kit-lock.mjs';
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

function validateSetupOptions(options) {
  const required = [
    'repositoryPath',
    'configDirectory',
    'skillsDirectory',
    'kitRoot',
    'kitVersion',
    'kitSource',
    'kitSha256',
  ];
  for (const field of required) {
    if (typeof options[field] !== 'string' || options[field].trim() === '') {
      throw new Error(`初始化缺少 ${field}`);
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.kitVersion)) {
    throw new Error('kitVersion 必须是精确语义版本');
  }
  if (!/^[a-f0-9]{64}$/u.test(options.kitSha256)) {
    throw new Error('kitSha256 必须是小写 SHA-256');
  }
  if (options.githubRepository !== undefined
    && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(options.githubRepository)) {
    throw new Error('GitHub 仓库必须使用 owner/name 格式');
  }
  const kitLock = parseKitLock(JSON.stringify({
    schema: 1,
    version: options.kitVersion,
    source: options.kitSource,
    sha256: options.kitSha256,
  }));
  const deployment = options.deployment === undefined
    ? undefined
    : parseDeploymentConfig(options.deployment);
  if (deployment) {
    const publicUrl = new URL(options.publicUrl || `https://${deployment.domain}`);
    if (publicUrl.protocol !== 'https:' || publicUrl.origin !== `https://${deployment.domain}`) {
      throw new Error('在线 Wiki 的 publicUrl 必须与部署域名一致');
    }
  }
  return {kitLock, deployment};
}

function defaultTimestamp() {
  return `${Date.now()}-${process.pid}`;
}

async function assertNewTarget(target) {
  if (!await pathExists(target)) return;
  const info = await lstat(target);
  if (!info.isDirectory() || (await readdir(target)).length > 0) {
    throw new Error(`目标目录不是空目录，拒绝覆盖：${target}`);
  }
  throw new Error(`目标目录已经存在，请选择新目录：${target}`);
}

async function writeNewFile(filename, content) {
  if (await pathExists(filename)) {
    throw new Error(`用户文件已存在，拒绝覆盖：${filename}`);
  }
  await mkdir(path.dirname(filename), { recursive: true });
  const candidate = `${filename}.candidate-${process.pid}`;
  if (await pathExists(candidate)) {
    throw new Error(`用户文件候选已存在：${candidate}`);
  }
  await writeFile(candidate, content, 'utf8');
  await rename(candidate, filename);
  return filename;
}

function commandLauncher({ kitRoot, nodeExecutable }) {
  const escapedNode = nodeExecutable.replaceAll('"', '""');
  const escapedCLI = path.join(kitRoot, 'src', 'cli.mjs').replaceAll('"', '""');
  return `@echo off\r\n"${escapedNode}" "${escapedCLI}" %*\r\n`;
}

export async function setupWiki(options = {}, {
  runCommand = defaultRunCommand,
  confirm = async () => false,
  timestamp = defaultTimestamp(),
  nodeExecutable = process.execPath,
} = {}) {
  const validated = validateSetupOptions(options);
  const repositoryPath = path.resolve(options.repositoryPath);
  const configDirectory = path.resolve(options.configDirectory);
  const skillsDirectory = path.resolve(options.skillsDirectory);
  const kitRoot = path.resolve(options.kitRoot);
  const templateRoot = path.join(kitRoot, 'templates', 'private-repository');
  const candidate = path.join(
    path.dirname(repositoryPath),
    `.${path.basename(repositoryPath)}.candidate-${timestamp}`,
  );
  await assertNewTarget(repositoryPath);
  if (await pathExists(candidate)) {
    throw new Error(`初始化候选目录已存在：${candidate}`);
  }

  let repositoryReady = false;
  try {
    await cp(templateRoot, candidate, {
      recursive: true,
      errorOnExist: true,
      filter: (source) => !path.relative(templateRoot, source).split(path.sep).includes('.wiki-kit-out'),
    });
    await writeFile(path.join(candidate, 'wiki-kit.lock.json'), `${JSON.stringify(validated.kitLock, null, 2)}\n`, 'utf8');
    await writeFile(path.join(candidate, 'wiki.config.json'), `${JSON.stringify({
      schema: 1,
      title: options.siteTitle || 'Personal Wiki',
      language: 'zh-CN',
      online: Boolean(validated.deployment),
      ...(validated.deployment ? {deployment: validated.deployment} : {}),
    }, null, 2)}\n`, 'utf8');
    const workflowDirectory = path.join(candidate, '.github');
    if (validated.deployment) {
      const workflow = await renderPrivatePublishWorkflow({
        deployment: validated.deployment,
        kitLock: validated.kitLock,
      }, {
        templatePath: path.join(templateRoot, '.github', 'workflows', 'publish.yml'),
      });
      await writeFile(path.join(workflowDirectory, 'workflows', 'publish.yml'), workflow, 'utf8');
    } else {
      await rm(workflowDirectory, {force: true, recursive: true});
    }

    await runCommand('git', ['init', '--initial-branch=main'], { cwd: candidate });
    await runCommand('git', ['config', 'user.name', 'Personal Wiki'], { cwd: candidate });
    await runCommand('git', ['config', 'user.email', 'personal-wiki@example.com'], { cwd: candidate });
    const initialPaths = ['.gitignore', 'AGENTS.md', 'README.md', 'content', 'wiki-kit.lock.json', 'wiki.config.json', 'open-wiki.bat', 'publish-wiki.bat', 'update-wiki-kit.bat'];
    if (validated.deployment) initialPaths.push('.github');
    await runCommand('git', ['add', '--', ...initialPaths], { cwd: candidate });
    await runCommand('git', ['commit', '-m', 'knowledge: initialize personal wiki'], { cwd: candidate });
    await rename(candidate, repositoryPath);
    repositoryReady = true;
  } catch (error) {
    if (!repositoryReady && await pathExists(candidate)) {
      await rm(candidate, { force: true, recursive: true });
    }
    throw error;
  }

  const userConfig = parseUserConfig(JSON.stringify({
    schema: 1,
    repositoryPath,
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
  }));
  const userFiles = [
    {
      filename: path.join(configDirectory, 'config.json'),
      content: `${JSON.stringify(userConfig, null, 2)}\n`,
    },
    {
      filename: path.join(configDirectory, 'project-routing.json'),
      content: `${JSON.stringify({ schema: 1, routes: [] }, null, 2)}\n`,
    },
    {
      filename: path.join(configDirectory, 'bin', 'personal-wiki.cmd'),
      content: commandLauncher({ kitRoot, nodeExecutable }),
    },
  ];
  const createdUserFiles = [];
  let skills;
  try {
    for (const userFile of userFiles) {
      if (await pathExists(userFile.filename)) {
        throw new Error(`用户文件已存在，拒绝覆盖：${userFile.filename}`);
      }
    }
    for (const userFile of userFiles) {
      createdUserFiles.push(await writeNewFile(userFile.filename, userFile.content));
    }
    skills = await installSkills({
      sourceRoot: path.join(kitRoot, 'skills'),
      destinationRoot: skillsDirectory,
      timestamp,
    });
  } catch (error) {
    for (const filename of createdUserFiles) {
      if (await pathExists(filename)) {
        await rename(filename, `${filename}.failed-${timestamp}`);
      }
    }
    const failedRepository = `${repositoryPath}.failed-${timestamp}`;
    if (await pathExists(repositoryPath) && !await pathExists(failedRepository)) {
      await rename(repositoryPath, failedRepository);
    }
    throw error;
  }

  let remoteCreated = false;
  if (options.githubRepository
    && await confirm(`创建 GitHub 私有仓库 ${options.githubRepository} 并推送初始内容？`)) {
    await runCommand('gh', [
      'repo',
      'create',
      options.githubRepository,
      '--private',
      '--source',
      repositoryPath,
      '--remote',
      'origin',
      '--push',
    ], { cwd: repositoryPath });
    remoteCreated = true;
  }
  return {
    repositoryPath,
    configDirectory,
    skills,
    remoteCreated,
  };
}

function defaultRunCommand(executable, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} 退出码 ${code}`));
    });
  });
}
