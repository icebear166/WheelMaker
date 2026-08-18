import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.txt',
  '.webp',
]);
const REGISTRY_PATHS = new Set([
  'content/registry/articles.yaml',
  'content/registry/projects.yaml',
  'content/registry/taxonomy.yaml',
]);

function normalizeGitPath(value) {
  return value.replaceAll('\\', '/');
}

function isSafeRelativePath(value) {
  return value !== ''
    && !value.startsWith('/')
    && !/^[A-Za-z]:\//u.test(value)
    && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isKnowledgePath(value) {
  const candidate = normalizeGitPath(value);
  if (!isSafeRelativePath(candidate)) return false;
  if (REGISTRY_PATHS.has(candidate)) return true;
  if (candidate.startsWith('content/articles/')) {
    return candidate.endsWith('.md') && candidate.length > 'content/articles/.md'.length;
  }
  if (candidate.startsWith('attachments/')) {
    return ALLOWED_ATTACHMENT_EXTENSIONS.has(path.posix.extname(candidate).toLowerCase());
  }
  return false;
}

function isUnmerged(code) {
  return code.includes('U') || code === 'AA' || code === 'DD';
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parsePorcelainStatus(source) {
  if (typeof source !== 'string') throw new Error('Git 状态必须是字符串');
  const fields = source.split('\0');
  const records = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === '') continue;
    if (field.length < 4 || field[2] !== ' ') {
      throw new Error('无法解析 Git porcelain 状态');
    }
    const record = {
      code: field.slice(0, 2),
      path: normalizeGitPath(field.slice(3)),
    };
    if (/[RC]/u.test(record.code)) {
      index += 1;
      if (!fields[index]) throw new Error('Git 重命名状态缺少原路径');
      record.originalPath = normalizeGitPath(fields[index]);
    }
    records.push(record);
  }
  return records;
}

export function classifyKnowledgeChanges(records) {
  if (!Array.isArray(records)) throw new Error('Git 状态记录必须是数组');
  const allowed = new Set();
  const blocked = [];
  for (const record of records) {
    const paths = [record.path, record.originalPath].filter(Boolean);
    let reason;
    if (!/^[ MADRCU?!]{2}$/u.test(record.code || '') || isUnmerged(record.code)) {
      reason = '存在未解决冲突或未知 Git 状态';
    } else if (paths.some((candidate) => !isKnowledgePath(candidate))) {
      reason = '不属于允许发布的知识路径';
    }
    if (reason) {
      for (const candidate of paths) blocked.push({ path: candidate, reason });
      continue;
    }
    for (const candidate of paths) allowed.add(candidate);
  }
  return {
    allowedPaths: [...allowed].sort(comparePaths),
    blocked: blocked.sort((left, right) => comparePaths(left.path, right.path)),
  };
}

async function defaultRunGit(repositoryPath, args, { optional = false } = {}) {
  const repository = path.resolve(repositoryPath);
  try {
    const result = await execFileAsync(
      'git',
      ['-c', `safe.directory=${repository}`, '-C', repository, ...args],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    return result.stdout.trimEnd();
  } catch (error) {
    if (optional) return '';
    const wrapped = new Error(`Git 命令失败：git ${args.join(' ')}`);
    wrapped.cause = error;
    wrapped.stderr = error.stderr || '';
    throw wrapped;
  }
}

function splitLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function resolvePublicationTarget(repository, runGit) {
  if (await runGit(repository, ['rev-parse', '--is-inside-work-tree'], { optional: true }) !== 'true') {
    throw new Error(`Wiki 仓库不可用：${repository}`);
  }
  const branch = await runGit(repository, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { optional: true });
  if (!branch) throw new Error('Wiki 仓库处于游离 HEAD，无法发布');
  const remotes = splitLines(await runGit(repository, ['remote']));
  if (remotes.length === 0) return { branch, remote: undefined };
  const upstreamRemote = await runGit(
    repository,
    ['config', '--get', `branch.${branch}.remote`],
    { optional: true },
  );
  let remote;
  if (upstreamRemote && upstreamRemote !== '.') remote = upstreamRemote;
  else if (remotes.length === 1) [remote] = remotes;
  else throw new Error('当前分支没有上游，且仓库存在多个远端，无法安全选择发布目标');
  if (!remotes.includes(remote)) throw new Error(`当前分支引用了不存在的远端 ${remote}`);

  const localHead = await runGit(
    repository,
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
    { optional: true },
  );
  const prefix = `${remote}/`;
  let defaultBranch = localHead.startsWith(prefix) ? localHead.slice(prefix.length) : '';
  if (!defaultBranch) {
    const remoteHead = await runGit(
      repository,
      ['ls-remote', '--symref', remote, 'HEAD'],
      { optional: true },
    );
    defaultBranch = remoteHead.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/mu)?.[1] || '';
  }
  if (!defaultBranch) throw new Error(`无法确定远端 ${remote} 的默认分支`);
  if (branch !== defaultBranch) {
    throw new Error(`必须在远端默认分支 ${defaultBranch} 发布；当前分支是 ${branch}`);
  }
  return { branch, remote };
}

function blockedMessage(blocked) {
  return `发布已停止；工作树包含非知识改动：\n${blocked
    .map(({ path: filename, reason }) => `- ${filename}: ${reason}`)
    .join('\n')}`;
}

function isNonFastForward(error) {
  return /non-fast-forward|fetch first|\[rejected\]/iu.test(`${error?.message || ''}\n${error?.stderr || ''}`);
}

async function synchronize(repository, target, runGit, verify) {
  await runGit(repository, ['fetch', target.remote, target.branch]);
  try {
    await runGit(repository, ['rebase', `${target.remote}/${target.branch}`]);
  } catch (error) {
    await runGit(repository, ['rebase', '--abort'], { optional: true });
    throw error;
  }
  await verify();
}

export async function publishKnowledge(options = {}, {
  runGit = defaultRunGit,
  verify,
} = {}) {
  if (!options.repository) throw new Error('发布缺少 Wiki 仓库路径');
  if (typeof verify !== 'function') throw new Error('发布缺少完整知识校验器');
  const repository = path.resolve(options.repository);
  const target = await resolvePublicationTarget(repository, runGit);
  const records = parsePorcelainStatus(
    await runGit(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
  const classified = classifyKnowledgeChanges(records);
  if (classified.blocked.length > 0) throw new Error(blockedMessage(classified.blocked));
  if (classified.allowedPaths.length === 0) {
    return { status: 'no-changes', deploymentStatus: 'unchanged' };
  }

  await verify();
  await runGit(repository, ['add', '--', ...classified.allowedPaths]);
  const staged = (await runGit(repository, ['diff', '--cached', '--name-only', '-z']))
    .split('\0')
    .filter(Boolean)
    .map(normalizeGitPath);
  const blockedStaged = staged.filter((filename) => !isKnowledgePath(filename));
  if (blockedStaged.length > 0) {
    throw new Error(`暂存区包含非知识路径：${blockedStaged.join(', ')}`);
  }
  if (staged.length === 0) return { status: 'no-changes', deploymentStatus: 'unchanged' };
  const message = options.message?.trim() || 'knowledge: publish approved updates';
  if (/\r|\n/u.test(message)) throw new Error('提交说明必须是单行文本');
  await runGit(repository, ['commit', '-m', message]);
  const commit = await runGit(repository, ['rev-parse', '--verify', 'HEAD']);
  if (!target.remote) {
    return { status: 'local-only', deploymentStatus: 'not-configured', commit };
  }

  await synchronize(repository, target, runGit, verify);
  const pushArguments = ['push', target.remote, `HEAD:refs/heads/${target.branch}`];
  try {
    await runGit(repository, pushArguments);
  } catch (error) {
    if (!isNonFastForward(error)) throw error;
    await synchronize(repository, target, runGit, verify);
    await runGit(repository, pushArguments);
  }
  return {
    status: 'pushed',
    deploymentStatus: 'unknown',
    commit: await runGit(repository, ['rev-parse', '--verify', 'HEAD']),
    remote: target.remote,
    branch: target.branch,
  };
}
