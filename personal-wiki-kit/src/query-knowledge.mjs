#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {
  listFiles,
  parseArticleSource,
  parseRegistryDocuments,
  validateArticle,
} from './content.mjs';
import {loadUserConfig} from './user-config.mjs';

const execFileAsync = promisify(execFile);
const registryPaths = {
  taxonomySource: 'content/registry/taxonomy.yaml',
  projectsSource: 'content/registry/projects.yaml',
  articlesSource: 'content/registry/articles.yaml',
};

export async function loadKnowledgeSnapshot({repository, configPath, workingTree = false} = {}) {
  const repositoryRoot = await resolveRepository(repository, configPath);
  const sourceState = workingTree ? 'unpublished-working-tree' : 'committed-head';
  const sourceLabel = workingTree ? '未发布工作区' : '已提交快照（HEAD）';
  const articlePaths = workingTree
    ? (await listFiles(path.join(repositoryRoot, 'content', 'articles')))
      .filter((filename) => filename.toLowerCase().endsWith('.md'))
      .map((filename) => normalizePath(path.relative(repositoryRoot, filename)))
      .sort((a, b) => a.localeCompare(b))
    : (await git(repositoryRoot, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'content/articles']))
      .split(/\r?\n/)
      .filter((filename) => filename.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b));
  for (const relativePath of articlePaths) {
    if (!/^content\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(relativePath)) {
      throw new Error(`文章必须位于中性目录 content/articles/{id}.md：${relativePath}`);
    }
  }

  const readSnapshotFile = workingTree
    ? (relativePath) => readFile(path.join(repositoryRoot, ...relativePath.split('/')), 'utf8')
    : (relativePath) => git(repositoryRoot, ['show', `HEAD:${relativePath}`]);
  let registry;
  try {
    const [taxonomySource, projectsSource, articlesSource] = await Promise.all([
      readSnapshotFile(registryPaths.taxonomySource),
      readSnapshotFile(registryPaths.projectsSource),
      readSnapshotFile(registryPaths.articlesSource),
    ]);
    registry = parseRegistryDocuments({
      taxonomySource,
      projectsSource,
      articlesSource,
      articleIds: articlePaths.map((filename) => path.posix.basename(filename, '.md')),
    });
  } catch (error) {
    throw new Error(`无法读取知识注册表：${error.message}`, {cause: error});
  }

  const errors = [];
  const articles = [];
  for (const relativePath of articlePaths) {
    try {
      const parsed = parseArticleSource(await readSnapshotFile(relativePath), relativePath);
      errors.push(...validateArticle({...parsed, relativePath}));
      const articleId = path.posix.basename(relativePath, '.md');
      articles.push({
        relativePath,
        metadata: {...registry.assignments.get(articleId), ...parsed.metadata},
        body: parsed.body,
      });
    } catch (error) {
      errors.push(`${relativePath}：${error.message}`);
    }
  }
  const titles = new Map();
  for (const article of articles) {
    const firstPath = titles.get(article.metadata.title);
    if (firstPath) errors.push(`${article.relativePath}：文章标题重复，首次出现于 ${firstPath}`);
    else titles.set(article.metadata.title, article.relativePath);
  }
  if (errors.length > 0) {
    throw new Error(`知识内容校验失败（${errors.length} 项）\n- ${errors.join('\n- ')}`);
  }

  return {
    repository: repositoryRoot,
    sourceState,
    sourceLabel,
    sourceCommit: await git(repositoryRoot, ['rev-parse', 'HEAD']).then((value) => value.trim()),
    taxonomy: registry.taxonomy,
    projects: registry.projects,
    articles,
  };
}

export function searchKnowledge(snapshot, {
  query,
  projects = [],
  limit = 5,
  bodyLimit = Math.min(limit, 3),
} = {}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) throw new Error('查询内容不能为空');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('结果数量必须是 1 到 20 的整数');
  }
  if (!Number.isInteger(bodyLimit) || bodyLimit < 0 || bodyLimit > limit) {
    throw new Error('正文数量必须是 0 到结果数量之间的整数');
  }
  const projectHints = [...new Set(projects.map((project) => String(project).trim()).filter(Boolean))];
  const knownProjects = new Set([...snapshot.projects.map((project) => project.id), 'unassigned']);
  for (const projectId of projectHints) {
    if (!knownProjects.has(projectId)) throw new Error(`未知项目：${projectId}`);
  }

  const sectionById = new Map(snapshot.taxonomy.map((section) => [section.id, section]));
  const projectById = new Map([
    ...snapshot.projects.map((project) => [project.id, project]),
    ['unassigned', {id: 'unassigned', title: '未指定项目'}],
  ]);
  const terms = queryTerms(normalizedQuery);
  let candidates = snapshot.articles
    .map((article) => rankArticle(article, terms, sectionById, projectById))
    .filter((candidate) => candidate.score > 0);
  if (projectHints.length > 0) {
    const projectMatches = candidates.filter(({article}) => (
      article.metadata.projects.some((projectId) => projectHints.includes(projectId))
      || (article.metadata.projects.length === 0 && projectHints.includes('unassigned'))
    ));
    if (projectMatches.length > 0) candidates = projectMatches;
  }
  candidates.sort((left, right) => (
    right.score - left.score
    || left.article.metadata.order - right.article.metadata.order
    || left.article.metadata.id.localeCompare(right.article.metadata.id)
  ));

  const results = candidates.slice(0, limit).map(({article, score}, index) => {
    const section = sectionById.get(article.metadata.section);
    const category = section?.categories.find((item) => item.id === article.metadata.category);
    const result = {
      ...article.metadata,
      sectionTitle: section?.title || article.metadata.section,
      categoryTitle: category?.title || article.metadata.category,
      projectTitles: article.metadata.projects.map((projectId) => projectById.get(projectId)?.title || projectId),
      score,
    };
    if (index < bodyLimit) result.body = article.body;
    return result;
  });
  return {
    repository: snapshot.repository,
    query: normalizedQuery,
    projects: projectHints,
    sourceState: snapshot.sourceState,
    sourceLabel: snapshot.sourceLabel,
    sourceCommit: snapshot.sourceCommit,
    resultCount: results.length,
    results,
  };
}

export async function queryKnowledge(options = {}) {
  const snapshot = await loadKnowledgeSnapshot(options);
  return searchKnowledge(snapshot, options);
}

function rankArticle(article, terms, sectionById, projectById) {
  const metadata = article.metadata;
  const section = sectionById.get(metadata.section);
  const category = section?.categories.find((item) => item.id === metadata.category);
  const fields = [
    [metadata.title, 12],
    [metadata.summary, 8],
    [metadata.tags.join(' '), 6],
    [[metadata.section, section?.title, metadata.category, category?.title].filter(Boolean).join(' '), 4],
    [
      (metadata.projects.length > 0 ? metadata.projects : ['unassigned'])
        .flatMap((id) => [id, projectById.get(id)?.title])
        .filter(Boolean)
        .join(' '),
      5,
    ],
    [article.body, 1],
  ];
  let score = 0;
  for (const term of terms) {
    for (const [value, weight] of fields) {
      if (normalizeSearchText(value).includes(term)) score += weight;
    }
  }
  return {article, score};
}

function queryTerms(query) {
  const normalized = normalizeSearchText(query);
  return [...new Set([normalized, ...normalized.split(/\s+/)].filter(Boolean))];
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
}

async function resolveRepository(repository, configPath) {
  const configuredRepository = repository && String(repository).trim()
    ? String(repository)
    : (await loadUserConfig({configPath})).repositoryPath;
  const candidate = path.resolve(configuredRepository);
  try {
    const root = (await git(candidate, ['rev-parse', '--show-toplevel'])).trim();
    return path.resolve(root);
  } catch {
    throw new Error(`不是有效的 Git 仓库：${candidate}`);
  }
}

async function git(repository, args) {
  try {
    const {stdout} = await execFileAsync(
      'git',
      ['-c', `safe.directory=${repository}`, '-C', repository, ...args],
      {encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024},
    );
    return stdout;
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    throw new Error(`Git 命令失败：${detail}`);
  }
}

function parseCliArguments(values) {
  const options = {projects: []};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--working-tree') {
      options.workingTree = true;
      continue;
    }
    if (!['--repository', '--config', '--query', '--project', '--limit'].includes(value)) {
      throw new Error(`不支持的参数：${value}`);
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`参数 ${value} 缺少值`);
    if (value === '--project') options.projects.push(next);
    else if (value === '--limit') options.limit = Number(next);
    else if (value === '--config') options.configPath = next;
    else options[value.slice(2)] = next;
    index += 1;
  }
  return options;
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

async function main() {
  try {
    const result = await queryKnowledge(parseCliArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`知识查询失败：${error.message || error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
