import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function resolveGitTarget(repositoryPath, runGit = defaultRunGit) {
  if (!repositoryPath) {
    throw new Error('缺少 Wiki 仓库路径');
  }
  if (runGit(repositoryPath, ['rev-parse', '--is-inside-work-tree'], { optional: true }) !== 'true') {
    throw new Error(`Wiki 仓库不可用：${repositoryPath}`);
  }
  const currentBranch = runGit(
    repositoryPath,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { optional: true },
  );
  if (!currentBranch) {
    throw new Error('Wiki 仓库当前处于游离 HEAD 状态，无法确定发布目标');
  }
  const upstreamRemote = runGit(
    repositoryPath,
    ['config', '--get', `branch.${currentBranch}.remote`],
    { optional: true },
  );
  const remote = selectRemote(repositoryPath, upstreamRemote, runGit);
  return {
    remote,
    branch: resolveDefaultBranch(repositoryPath, remote, runGit),
  };
}

function selectRemote(repositoryPath, upstreamRemote, runGit) {
  if (upstreamRemote && upstreamRemote !== '.') {
    return upstreamRemote;
  }
  const remotes = splitLines(runGit(repositoryPath, ['remote']));
  if (remotes.length === 0) {
    throw new Error('Wiki 仓库没有 Git 远端');
  }
  if (remotes.length > 1) {
    throw new Error('当前分支没有上游分支，且仓库存在多个远端，无法安全选择发布目标');
  }
  return remotes[0];
}

function resolveDefaultBranch(repositoryPath, remote, runGit) {
  const localHead = runGit(
    repositoryPath,
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
    { optional: true },
  );
  const prefix = `${remote}/`;
  if (localHead?.startsWith(prefix) && localHead.length > prefix.length) {
    return localHead.slice(prefix.length);
  }
  const remoteHead = runGit(
    repositoryPath,
    ['ls-remote', '--symref', remote, 'HEAD'],
    { optional: true },
  );
  const match = remoteHead?.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/mu);
  if (!match) {
    throw new Error(`无法确定远端 ${remote} 的默认分支`);
  }
  return match[1];
}

function defaultRunGit(repositoryPath, args, { optional = false } = {}) {
  const repository = path.resolve(repositoryPath);
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${repository}`, '-C', repository, ...args],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status === 0) {
    return result.stdout.trim();
  }
  if (optional) {
    return '';
  }
  throw new Error(`Git 命令执行失败：git ${args.join(' ')}`);
}

function splitLines(value) {
  return value.split(/\r?\n/u).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--repository' || !args[1]) {
    throw new Error('用法：git-target.mjs --repository <Wiki仓库>');
  }
  process.stdout.write(`${JSON.stringify(resolveGitTarget(args[1]), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
