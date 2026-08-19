import {execFile} from 'node:child_process';
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {compileKnowledge} from './content.mjs';
import {parseDeploymentConfig, renderPrivatePublishWorkflow} from './deployment-config.mjs';
import {parseKitLock} from './kit-lock.mjs';
import {compareReleaseIdentity} from './manifest-equivalence.mjs';

const execFileAsync = promisify(execFile);
const RETAINED_ROOTS = new Set(['attachments', 'content']);
const LEGACY_ROOTS = new Set(['app', 'ops', 'schema', 'scripts', 'server', 'skills']);
const LEGACY_FILES = new Set([
  'go.mod',
  'go.sum',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'webpack.config.cjs',
]);
const GENERATED_FILES = new Set([
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  '.github/workflows/publish.yml',
  'open-wiki.bat',
  'publish-wiki.bat',
  'update-wiki-kit.bat',
  'wiki-kit.lock.json',
  'wiki.config.json',
  'migration/personal-wiki-kit.json',
]);
const MUTATED_FILES = [...GENERATED_FILES].filter((name) => name !== '.gitattributes');
const GENERATED_REPORT = 'migration/personal-wiki-kit.json';
const FIXED_GENERATED_AT = '2000-01-01T00:00:00.000Z';

function portable(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function topLevel(value) {
  return portable(value).split('/')[0];
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function classifyRepositoryPaths(paths) {
  const result = {retained: [], generated: [], legacy: [], unknown: []};
  for (const rawPath of paths) {
    const relativePath = portable(rawPath);
    const root = topLevel(relativePath);
    if (RETAINED_ROOTS.has(root)) result.retained.push(relativePath);
    else if (LEGACY_ROOTS.has(root) || LEGACY_FILES.has(relativePath)) result.legacy.push(relativePath);
    else if (GENERATED_FILES.has(relativePath)) result.generated.push(relativePath);
    else result.unknown.push(relativePath);
  }
  for (const key of Object.keys(result)) result[key] = sorted(result[key]);
  return result;
}

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function defaultGit(repository, args) {
  const result = await execFileAsync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
}

function parseNullList(value) {
  return value.split('\0').filter(Boolean).map(portable);
}

async function copyIfPresent(source, destination) {
  if (!await pathExists(source)) return false;
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(source, destination, {recursive: true, force: false, errorOnExist: true});
  return true;
}

async function copyTemplate(templateRoot, candidate) {
  await cp(templateRoot, candidate, {
    recursive: true,
    errorOnExist: true,
    filter: (source) => {
      const segments = portable(path.relative(templateRoot, source)).split('/');
      return !segments.includes('.wiki-kit-out');
    },
  });
}

async function existingTitle(repository, fallback) {
  if (typeof fallback === 'string' && fallback.trim() !== '') return fallback.trim();
  try {
    const value = JSON.parse(await readFile(path.join(repository, 'wiki.config.json'), 'utf8'));
    if (typeof value.title === 'string' && value.title.trim() !== '') return value.title.trim();
  } catch {
    // A legacy repository need not have a Kit-compatible display config.
  }
  return 'Personal Wiki';
}

async function prepareCandidate({repository, kitRoot, kitLock, deployment, title, temporaryRoot}) {
  const candidate = path.join(temporaryRoot, 'candidate');
  const templateRoot = path.join(kitRoot, 'templates', 'private-repository');
  await copyTemplate(templateRoot, candidate);

  await rm(path.join(candidate, 'content'), {recursive: true, force: true});
  await cp(path.join(repository, 'content'), path.join(candidate, 'content'), {
    recursive: true,
    errorOnExist: true,
  });
  await rm(path.join(candidate, 'attachments'), {recursive: true, force: true});
  await copyIfPresent(path.join(repository, 'attachments'), path.join(candidate, 'attachments'));
  if (await pathExists(path.join(repository, '.gitattributes'))) {
    await cp(path.join(repository, '.gitattributes'), path.join(candidate, '.gitattributes'), {force: true});
  }

  await writeFile(
    path.join(candidate, 'wiki-kit.lock.json'),
    `${JSON.stringify(kitLock, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(candidate, 'wiki.config.json'),
    `${JSON.stringify({
      schema: 1,
      title: await existingTitle(repository, title),
      language: 'zh-CN',
      online: Boolean(deployment),
      ...(deployment ? {deployment} : {}),
    }, null, 2)}\n`,
    'utf8',
  );

  if (deployment) {
    const workflow = await renderPrivatePublishWorkflow(
      {deployment, kitLock},
      {templatePath: path.join(templateRoot, '.github', 'workflows', 'publish.yml')},
    );
    await mkdir(path.join(candidate, '.github', 'workflows'), {recursive: true});
    await writeFile(path.join(candidate, '.github', 'workflows', 'publish.yml'), workflow, 'utf8');
  } else {
    await rm(path.join(candidate, '.github'), {recursive: true, force: true});
  }
  return candidate;
}

async function compareCandidate(repository, candidate, temporaryRoot) {
  const beforeOutput = path.join(temporaryRoot, 'before-output');
  const afterOutput = path.join(temporaryRoot, 'after-output');
  await compileKnowledge({repository, output: beforeOutput, generatedAt: FIXED_GENERATED_AT});
  await compileKnowledge({repository: candidate, output: afterOutput, generatedAt: FIXED_GENERATED_AT});
  return compareReleaseIdentity(beforeOutput, afterOutput);
}

function migrationReport({sourceCommit, classification, identity, kitLock}) {
  return {
    schema: 1,
    sourceCommit,
    retained: classification.retained,
    generated: classification.generated,
    legacy: classification.legacy,
    unknown: classification.unknown,
    identity,
    recoveryTag: `personal-wiki-kit-pre-migration-${kitLock.version}-${sourceCommit.slice(0, 12)}`,
  };
}

async function backupMutationPaths(repository, backup) {
  for (const root of LEGACY_ROOTS) {
    await copyIfPresent(path.join(repository, root), path.join(backup, root));
  }
  for (const filename of [...LEGACY_FILES, ...MUTATED_FILES]) {
    await copyIfPresent(path.join(repository, filename), path.join(backup, filename));
  }
}

async function removeMutationPaths(repository) {
  for (const root of LEGACY_ROOTS) {
    await rm(path.join(repository, root), {recursive: true, force: true});
  }
  for (const filename of [...LEGACY_FILES, ...MUTATED_FILES]) {
    await rm(path.join(repository, filename), {recursive: true, force: true});
  }
}

async function installCandidate(repository, candidate) {
  for (const filename of MUTATED_FILES) {
    await copyIfPresent(path.join(candidate, filename), path.join(repository, filename));
  }
}

async function restoreBackup(repository, backup) {
  await removeMutationPaths(repository);
  for (const root of LEGACY_ROOTS) {
    await copyIfPresent(path.join(backup, root), path.join(repository, root));
  }
  for (const filename of [...LEGACY_FILES, ...MUTATED_FILES]) {
    await copyIfPresent(path.join(backup, filename), path.join(repository, filename));
  }
}

async function assertClean(repository, git) {
  const status = await git(repository, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status !== '') throw new Error('migration apply requires a clean Git worktree');
}

async function createRecoveryTag(repository, report, git) {
  let existing = '';
  try {
    existing = (await git(repository, ['rev-parse', '--verify', `refs/tags/${report.recoveryTag}^{commit}`])).trim();
  } catch {
    // Missing tags are expected on the first migration attempt.
  }
  if (existing) {
    if (existing !== report.sourceCommit) throw new Error(`recovery tag ${report.recoveryTag} points to another commit`);
    return;
  }
  await git(repository, ['tag', report.recoveryTag, report.sourceCommit]);
}

export async function migrateRepository(options = {}, dependencies = {}) {
  const repository = path.resolve(options.repository || '');
  const kitRoot = path.resolve(options.kitRoot || '');
  const git = dependencies.git || defaultGit;
  const apply = options.apply === true;
  const dryRun = options.dryRun === true;
  if (apply === dryRun) throw new Error('choose exactly one migration mode: dryRun or apply');
  if (!options.repository || !options.kitRoot) throw new Error('repository and kitRoot are required');
  const kitLock = parseKitLock(JSON.stringify(options.kitLock));
  const deployment = options.deployment === undefined
    ? undefined
    : parseDeploymentConfig(options.deployment);

  const tracked = parseNullList(await git(repository, ['ls-files', '-z']));
  const classification = classifyRepositoryPaths(tracked);
  if (classification.unknown.length > 0) {
    throw new Error(`migration found unknown tracked path: ${classification.unknown.join(', ')}`);
  }
  if (apply) await assertClean(repository, git);
  const sourceCommit = (await git(repository, ['rev-parse', 'HEAD'])).trim();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'personal-wiki-migration-'));
  try {
    const candidate = await prepareCandidate({
      repository,
      kitRoot,
      kitLock,
      deployment,
      title: options.title,
      temporaryRoot,
    });
    const identity = await compareCandidate(repository, candidate, temporaryRoot);
    if (!identity.equivalent) {
      throw new Error(`migration candidate changes knowledge identity: ${identity.differences.join(', ')}`);
    }
    const report = migrationReport({sourceCommit, classification, identity, kitLock});
    await mkdir(path.join(candidate, 'migration'), {recursive: true});
    await writeFile(path.join(candidate, GENERATED_REPORT), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (dryRun) return report;

    const backup = path.join(temporaryRoot, 'backup');
    await mkdir(backup, {recursive: true});
    await backupMutationPaths(repository, backup);
    let mutationStarted = false;
    try {
      mutationStarted = true;
      await removeMutationPaths(repository);
      await installCandidate(repository, candidate);
      if (dependencies.afterMutation) await dependencies.afterMutation({repository, candidate, report});
      await createRecoveryTag(repository, report, git);
    } catch (error) {
      if (mutationStarted) await restoreBackup(repository, backup);
      throw error;
    }
    return {...report, applied: true};
  } finally {
    await rm(temporaryRoot, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
  }
}
