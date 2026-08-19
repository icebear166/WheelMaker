import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadKnowledgeSnapshot,
  queryKnowledge,
  searchKnowledge,
} from '../src/query-knowledge.mjs';

test('knowledge query defaults to committed HEAD and labels explicit working-tree previews', async (t) => {
  const { repository } = await createFixture(t);

  const committed = await queryKnowledge({ repository, query: '共享关键词', limit: 2 });
  assert.match(committed.results[0].summary, /已提交摘要/);
  assert.doesNotMatch(committed.results[0].summary, /本地摘要/);
  assert.equal(committed.sourceState, 'committed-head');
  assert.equal(committed.sourceLabel, '已提交快照（HEAD）');

  const local = await queryKnowledge({
    repository,
    query: '共享关键词',
    limit: 2,
    workingTree: true,
  });
  assert.match(local.results[0].summary, /本地摘要/);
  assert.equal(local.sourceState, 'unpublished-working-tree');
  assert.equal(local.sourceLabel, '未发布工作区');
});

test('knowledge query can locate the repository through explicit user config', async (t) => {
  const { root, repository } = await createFixture(t);
  const configPath = join(root, 'config.json');
  await writeFile(configPath, `${JSON.stringify({ schema: 1, repositoryPath: repository }, null, 2)}\n`);

  const result = await queryKnowledge({ configPath, query: '共享关键词', limit: 1 });
  assert.equal(result.repository, await realpath(repository));
  assert.equal(result.sourceState, 'committed-head');
});

test('knowledge query uses project hints with deterministic cross-project fallback', async (t) => {
  const { repository } = await createFixture(t);
  const snapshot = await loadKnowledgeSnapshot({ repository });

  const projectResult = searchKnowledge(snapshot, {
    query: '共享关键词',
    projects: ['example-project'],
    limit: 5,
    bodyLimit: 1,
  });
  assert.ok(projectResult.results.every((item) => item.projects.includes('example-project')));
  assert.equal(projectResult.results.filter((item) => 'body' in item).length, 1);

  const fallback = searchKnowledge(snapshot, {
    query: '另一项目独有',
    projects: ['example-project'],
    limit: 5,
  });
  assert.deepEqual(fallback.results.map((item) => item.id), ['second-article']);
});

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-query-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, 'wiki');
  await mkdir(join(repository, 'content', 'articles'), { recursive: true });
  await mkdir(join(repository, 'content', 'registry'), { recursive: true });
  git(repository, 'init', '--initial-branch=main');
  git(repository, 'config', 'user.name', 'Query Test');
  git(repository, 'config', 'user.email', 'query-test@example.com');
  git(repository, 'config', 'core.autocrlf', 'false');
  await writeFile(join(repository, 'content', 'registry', 'taxonomy.yaml'), `schema: 1
sections:
  - id: software-development
    title: 软件开发
    description: 软件开发知识。
    order: 10
    categories:
      - id: knowledge-tools
        title: 知识工具
        description: 知识工具与流程。
        order: 10
`);
  await writeFile(join(repository, 'content', 'registry', 'projects.yaml'), `schema: 1
projects:
  - id: example-project
    title: 示例项目
    description: 示例项目知识。
    order: 10
  - id: second-project
    title: 第二项目
    description: 第二项目知识。
    order: 20
`);
  await writeFile(join(repository, 'content', 'registry', 'articles.yaml'), `schema: 1
articles:
  - id: example-article
    section: software-development
    category: knowledge-tools
    projects: [example-project]
    order: 10
  - id: second-article
    section: software-development
    category: knowledge-tools
    projects: [second-project]
    order: 20
`);
  await writeFile(
    join(repository, 'content', 'articles', 'example-article.md'),
    articleSource('示例文章', '已提交摘要，共享关键词用于查找示例项目知识。', '示例项目内容。'),
  );
  await writeFile(
    join(repository, 'content', 'articles', 'second-article.md'),
    articleSource('第二文章', '已提交摘要，共享关键词与另一项目独有线索。', '第二项目内容。'),
  );
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'fixture');
  const articlePath = join(repository, 'content', 'articles', 'example-article.md');
  await writeFile(articlePath, (await readFile(articlePath, 'utf8')).replace('已提交摘要', '本地摘要'));
  return { root, repository };
}

function articleSource(title, summary, bodyPrefix) {
  return `---
title: ${title}
summary: ${summary}
tags: [共享关键词, 知识]
status: current
updated: 2026-08-18
confidence: confirmed
sources:
  - kind: verification
    ref: public query fixture
---

## 当前结论

${bodyPrefix}${'这是用于验证本地知识查询、项目提示和确定性排序的可靠正文。'.repeat(5)}
`;
}

function git(repository, ...args) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
