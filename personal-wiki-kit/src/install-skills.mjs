import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

const SKILL_NAMES = ['lookup-knowledge', 'publish-knowledge'];

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function safeTimestamp(value) {
  const timestamp = value || new Date().toISOString().replace(/[-:.]/gu, '');
  if (!/^[A-Za-z0-9_-]+$/u.test(timestamp)) {
    throw new Error('Skill 安装时间标识包含不安全字符');
  }
  return timestamp;
}

async function validateSkillDirectory(directory, skillName) {
  const skillFile = path.join(directory, 'SKILL.md');
  const source = (await readFile(skillFile, 'utf8')).replace(/\r\n?/gu, '\n');
  if (!source.startsWith('---\n')
    || !source.includes(`\nname: ${skillName}\n`)
    || !source.includes('\ndescription: ')
    || /\[?TODO/iu.test(source)) {
    throw new Error(`Skill ${skillName} 的 SKILL.md 无效`);
  }
  const agent = (await readFile(path.join(directory, 'agents', 'openai.yaml'), 'utf8'))
    .replace(/\r\n?/gu, '\n');
  if (!agent.includes('display_name:') || !agent.includes(`$${skillName}`)) {
    throw new Error(`Skill ${skillName} 的 agents/openai.yaml 无效`);
  }
}

export async function installSkills({
  sourceRoot,
  destinationRoot,
  timestamp,
  verify = async (skillName, directory) => validateSkillDirectory(directory, skillName),
} = {}) {
  if (!sourceRoot || !destinationRoot) {
    throw new Error('Skill 安装需要来源目录和目标目录');
  }
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const suffix = safeTimestamp(timestamp);
  await mkdir(destination, { recursive: true });

  const entries = SKILL_NAMES.map((skillName) => ({
    skillName,
    source: path.join(source, skillName),
    target: path.join(destination, skillName),
    candidate: path.join(destination, `.${skillName}.candidate-${suffix}`),
    backup: path.join(destination, `.${skillName}.backup-${suffix}`),
    failed: path.join(destination, `.${skillName}.failed-${suffix}`),
    hadExisting: false,
    swapped: false,
  }));

  for (const entry of entries) {
    await validateSkillDirectory(entry.source, entry.skillName);
    for (const generated of [entry.candidate, entry.backup, entry.failed]) {
      if (await pathExists(generated)) {
        throw new Error(`Skill 安装候选路径已存在：${generated}`);
      }
    }
    await cp(entry.source, entry.candidate, { recursive: true, errorOnExist: true });
    await validateSkillDirectory(entry.candidate, entry.skillName);
  }

  try {
    for (const entry of entries) {
      entry.hadExisting = await pathExists(entry.target);
      if (entry.hadExisting) {
        await rename(entry.target, entry.backup);
      }
      await rename(entry.candidate, entry.target);
      entry.swapped = true;
    }
    for (const entry of entries) {
      await verify(entry.skillName, entry.target);
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.swapped && await pathExists(entry.target)) {
        await rename(entry.target, entry.failed);
      } else if (await pathExists(entry.candidate)) {
        await rm(entry.candidate, { force: true, recursive: true });
      }
      if (entry.hadExisting && await pathExists(entry.backup)) {
        await cp(entry.backup, entry.target, { recursive: true, errorOnExist: true });
      }
    }
    throw error;
  }

  return {
    installed: entries.map((entry) => entry.target),
    backups: entries.filter((entry) => entry.hadExisting).map((entry) => entry.backup),
  };
}
