import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {renameDirectoryWithRetry, setupWiki} from '../src/setup.mjs';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('directory activation retries transient Windows rename locks', async () => {
  let attempts = 0;
  await renameDirectoryWithRetry('candidate', 'repository', {
    move: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('locked'), {code: 'EBUSY'});
    },
    delay: async () => {},
  });
  assert.equal(attempts, 3);
});

async function createPaths(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-setup-'));
  t.after(() => rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 }));
  return {
    root,
    repositoryPath: join(root, 'my-wiki'),
    configDirectory: join(root, 'user-config'),
    skillsDirectory: join(root, 'codex-skills'),
  };
}

function setupOptions(paths, overrides = {}) {
  return {
    ...paths,
    kitRoot,
    kitVersion: '0.1.0',
    kitSource: 'wheelmaker-release',
    kitSha256: 'a'.repeat(64),
    siteTitle: '我的知识库',
    ...overrides,
  };
}

test('setup creates a local private repository, user config, and Chinese Skills without network writes', async (t) => {
  const paths = await createPaths(t);
  const commands = [];
  const result = await setupWiki(setupOptions(paths), {
    runCommand: async (executable, args, options) => commands.push({ executable, args, options }),
    confirm: async () => assert.fail('默认本地初始化不应请求创建 GitHub 远端'),
  });

  assert.equal(result.remoteCreated, false);
  assert.equal(commands.some((command) => command.executable === 'gh'), false);
  assert.ok(commands.some((command) => command.executable === 'git' && command.args.includes('init')));
  assert.deepEqual((await readdir(join(paths.repositoryPath, 'content', 'registry'))).sort(), [
    'articles.yaml',
    'projects.yaml',
    'taxonomy.yaml',
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(paths.repositoryPath, 'wiki-kit.lock.json'), 'utf8')), {
    schema: 1,
    version: '0.1.0',
    source: 'wheelmaker-release',
    sha256: 'a'.repeat(64),
  });
  assert.equal(
    JSON.parse(await readFile(join(paths.configDirectory, 'config.json'), 'utf8')).repositoryPath,
    paths.repositoryPath,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(paths.configDirectory, 'project-routing.json'), 'utf8')),
    { schema: 1, routes: [] },
  );
  const launcher = await readFile(join(paths.configDirectory, 'bin', 'personal-wiki.cmd'), 'utf8');
  assert.match(launcher, /active-version\.txt/u);
  assert.match(launcher, /kit\\versions/u);
  assert.doesNotMatch(launcher, new RegExp(kitRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'));
  await assert.rejects(() => access(join(paths.repositoryPath, '.github', 'workflows', 'publish.yml')));
  assert.match(await readFile(join(paths.skillsDirectory, 'lookup-knowledge', 'SKILL.md'), 'utf8'), /查询个人 Wiki/);
  assert.match(await readFile(join(paths.skillsDirectory, 'publish-knowledge', 'SKILL.md'), 'utf8'), /明确批准/);
});

test('setup creates a GitHub repository only after explicit confirmation and forces private visibility', async (t) => {
  const paths = await createPaths(t);
  const commands = [];
  const result = await setupWiki(setupOptions(paths, {
    githubRepository: 'example/private-wiki',
  }), {
    runCommand: async (executable, args, options) => commands.push({ executable, args, options }),
    confirm: async () => true,
  });

  assert.equal(result.remoteCreated, true);
  const gh = commands.find((command) => command.executable === 'gh');
  assert.ok(gh);
  assert.deepEqual(gh.args.slice(0, 3), ['repo', 'create', 'example/private-wiki']);
  assert.ok(gh.args.includes('--private'));
  assert.ok(gh.args.includes('--source'));
});

test('setup refuses to overwrite a non-empty repository target', async (t) => {
  const paths = await createPaths(t);
  await mkdir(paths.repositoryPath, { recursive: true });
  await writeFile(join(paths.repositoryPath, 'keep.txt'), 'user data');
  await assert.rejects(
    () => setupWiki(setupOptions(paths)),
    /目标目录不是空目录/,
  );
  assert.equal(await readFile(join(paths.repositoryPath, 'keep.txt'), 'utf8'), 'user data');
});
