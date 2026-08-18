import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { writeReleaseManifest } from './release-manifest.mjs';

const ARTICLE_METADATA_FIELDS = new Set([
  'title',
  'summary',
  'tags',
  'status',
  'updated',
  'confidence',
  'sources',
]);
const REQUIRED_ARTICLE_METADATA = [...ARTICLE_METADATA_FIELDS];
const FORBIDDEN_ROOT_DIRECTORIES = ['conversations', 'drafts', 'inbox', 'raw', 'scratch', 'sources'];
const ALLOWED_ATTACHMENTS = new Set(['.gif', '.jpeg', '.jpg', '.pdf', '.png', '.txt', '.webp']);
const REGISTRY_FILES = new Set([
  'registry/articles.yaml',
  'registry/projects.yaml',
  'registry/taxonomy.yaml',
]);
const SECRET_PATTERNS = [
  {
    name: 'private key',
    expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/iu,
  },
  {
    name: 'GitHub token',
    expression: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  },
  {
    name: 'AWS access key',
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  },
  {
    name: 'Google API key',
    expression: /\bAIza[0-9A-Za-z_-]{35}\b/u,
  },
  {
    name: 'bearer token',
    expression: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/iu,
  },
  {
    name: 'assigned credential',
    expression: /\b(?:api[_-]?key|access[_-]?key|password|passwd|secret|token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/iu,
  },
];

export class ContentValidationError extends Error {
  constructor(errors) {
    super(`knowledge validation failed with ${errors.length} error(s)\n- ${errors.join('\n- ')}`);
    this.name = 'ContentValidationError';
    this.errors = errors;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function nativePath(value) {
  return value.split('/').join(path.sep);
}

function isInside(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === ''
    || (!relativePath.startsWith(`..${path.sep}`)
      && relativePath !== '..'
      && !path.isAbsolute(relativePath));
}

function reportUnsupportedFields(value, allowed, label, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${label} contains unsupported field ${key}`);
    }
  }
}

function reportDuplicateValue(seen, value, message, errors) {
  if (seen.has(value)) {
    errors.push(`${message} ${value}`);
  }
  seen.add(value);
}

function validateStableId(value, label, errors) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value || '')) {
    errors.push(`${label} must be a lowercase kebab-case id`);
  }
}

function validateText(value, label, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`);
  }
}

function validateOrder(value, label, errors) {
  if (!Number.isInteger(value) || value < 0 || value > 9999) {
    errors.push(`${label} must be an integer from 0 through 9999`);
  }
}

function parseRegistryYaml(source, filename, collectionName, errors) {
  let document;
  try {
    document = YAML.parse(String(source || ''));
  } catch (error) {
    errors.push(`${filename} cannot be parsed: ${error.message}`);
    return { [collectionName]: [] };
  }
  if (!isRecord(document)) {
    errors.push(`${filename} must contain an object`);
    return { [collectionName]: [] };
  }
  reportUnsupportedFields(document, new Set(['schema', collectionName]), filename, errors);
  if (document.schema !== 1) {
    errors.push(`${filename}.schema must equal 1`);
  }
  if (!Array.isArray(document[collectionName])) {
    errors.push(`${filename}.${collectionName} must be an array`);
    return { [collectionName]: [] };
  }
  return document;
}

function validateCategories(values, sectionLabel, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    errors.push(`${sectionLabel}.categories must contain at least one category`);
    return [];
  }
  const categories = [];
  const ids = new Set();
  const titles = new Set();
  const orders = new Set();
  for (const [index, value] of values.entries()) {
    const label = `${sectionLabel}.categories[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    reportUnsupportedFields(value, new Set(['id', 'title', 'description', 'order']), label, errors);
    validateStableId(value.id, `${label}.id`, errors);
    validateText(value.title, `${label}.title`, errors);
    validateText(value.description, `${label}.description`, errors);
    validateOrder(value.order, `${label}.order`, errors);
    reportDuplicateValue(ids, value.id, `${label} duplicate category id`, errors);
    reportDuplicateValue(titles, value.title, `${label} duplicate category title`, errors);
    reportDuplicateValue(orders, value.order, `${label} duplicate category order`, errors);
    categories.push(value);
  }
  return categories.sort((left, right) => left.order - right.order);
}

function validateTaxonomy(values, errors) {
  const sections = [];
  const ids = new Set();
  const titles = new Set();
  const orders = new Set();
  for (const [index, value] of values.entries()) {
    const label = `taxonomy.yaml sections[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    reportUnsupportedFields(
      value,
      new Set(['id', 'title', 'description', 'order', 'categories']),
      label,
      errors,
    );
    validateStableId(value.id, `${label}.id`, errors);
    validateText(value.title, `${label}.title`, errors);
    validateText(value.description, `${label}.description`, errors);
    validateOrder(value.order, `${label}.order`, errors);
    reportDuplicateValue(ids, value.id, `${label} duplicate section id`, errors);
    reportDuplicateValue(titles, value.title, `${label} duplicate section title`, errors);
    reportDuplicateValue(orders, value.order, `${label} duplicate section order`, errors);
    sections.push({ ...value, categories: validateCategories(value.categories, label, errors) });
  }
  return sections.sort((left, right) => left.order - right.order);
}

function validateProjects(values, errors) {
  const projects = [];
  const ids = new Set();
  const titles = new Set();
  const orders = new Set();
  for (const [index, value] of values.entries()) {
    const label = `projects.yaml projects[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    reportUnsupportedFields(value, new Set(['id', 'title', 'description', 'order']), label, errors);
    validateStableId(value.id, `${label}.id`, errors);
    validateText(value.title, `${label}.title`, errors);
    validateText(value.description, `${label}.description`, errors);
    validateOrder(value.order, `${label}.order`, errors);
    reportDuplicateValue(ids, value.id, `${label} duplicate project id`, errors);
    reportDuplicateValue(titles, value.title, `${label} duplicate project title`, errors);
    reportDuplicateValue(orders, value.order, `${label} duplicate project order`, errors);
    projects.push(value);
  }
  return projects.sort((left, right) => left.order - right.order);
}

function validateArticleAssignments({ values, taxonomy, projects, articleIds, errors }) {
  const assignments = new Map();
  const categoriesBySection = new Map(taxonomy.map((section) => [
    section.id,
    new Set(section.categories.map((category) => category.id)),
  ]));
  const projectIds = new Set(projects.map((project) => project.id));
  const peerOrders = new Set();

  for (const [index, value] of values.entries()) {
    const label = `articles.yaml articles[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    reportUnsupportedFields(
      value,
      new Set(['id', 'section', 'category', 'projects', 'order']),
      label,
      errors,
    );
    validateStableId(value.id, `${label}.id`, errors);
    validateStableId(value.section, `${label}.section`, errors);
    validateStableId(value.category, `${label}.category`, errors);
    validateOrder(value.order, `${label}.order`, errors);

    if (!Array.isArray(value.projects)) {
      errors.push(`${label}.projects must be an array`);
    } else {
      const seenProjects = new Set();
      for (const projectId of value.projects) {
        validateStableId(projectId, `${label}.projects`, errors);
        if (seenProjects.has(projectId)) {
          errors.push(`${label}.projects repeats project ${projectId}`);
        }
        seenProjects.add(projectId);
        if (!projectIds.has(projectId)) {
          errors.push(`article ${value.id} references unknown project ${projectId}`);
        }
      }
    }
    if (!categoriesBySection.get(value.section)?.has(value.category)) {
      errors.push(`article ${value.id} references unknown category ${value.section}/${value.category}`);
    }
    if (assignments.has(value.id)) {
      errors.push(`${label} repeats article id ${value.id}`);
    }
    const peerOrder = `${value.section}/${value.category}/${value.order}`;
    if (peerOrders.has(peerOrder)) {
      errors.push(`${label} peer order ${value.order} is duplicated`);
    }
    peerOrders.add(peerOrder);
    assignments.set(value.id, value);
  }

  const files = new Set(articleIds);
  for (const articleId of files) {
    if (!assignments.has(articleId)) {
      errors.push(`article ${articleId} has no article registration`);
    }
  }
  for (const articleId of assignments.keys()) {
    if (!files.has(articleId)) {
      errors.push(`article registration ${articleId} has no matching Markdown file`);
    }
  }
  return assignments;
}

export function parseRegistryDocuments({
  taxonomySource,
  projectsSource,
  articlesSource,
  articleIds = [],
}) {
  const errors = [];
  const taxonomyDocument = parseRegistryYaml(taxonomySource, 'taxonomy.yaml', 'sections', errors);
  const projectsDocument = parseRegistryYaml(projectsSource, 'projects.yaml', 'projects', errors);
  const articlesDocument = parseRegistryYaml(articlesSource, 'articles.yaml', 'articles', errors);
  const taxonomy = validateTaxonomy(taxonomyDocument.sections, errors);
  const projects = validateProjects(projectsDocument.projects, errors);
  const assignments = validateArticleAssignments({
    values: articlesDocument.articles,
    taxonomy,
    projects,
    articleIds,
    errors,
  });
  if (errors.length > 0) {
    throw new ContentValidationError(errors);
  }
  return { taxonomy, projects, assignments };
}

export function parseArticleSource(source, filename = '<article>') {
  const normalized = source.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`${filename}: missing YAML frontmatter`);
  }
  const boundary = normalized.indexOf('\n---\n', 4);
  if (boundary < 0) {
    throw new Error(`${filename}: unterminated YAML frontmatter`);
  }
  let metadata;
  try {
    metadata = YAML.parse(normalized.slice(4, boundary));
  } catch (error) {
    throw new Error(`${filename}: invalid YAML frontmatter: ${error.message}`);
  }
  if (!isRecord(metadata)) {
    throw new Error(`${filename}: frontmatter must be an object`);
  }
  return {
    metadata,
    body: `${normalized.slice(boundary + 5).trim()}\n`,
  };
}

function stripFencedCode(markdown) {
  return markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gmu, '');
}

function plainText(markdown) {
  return stripFencedCode(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~>#|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function slugifyHeading(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[`*_~[\](){}<>]/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/[\s-]+/gu, '-');
}

export function extractHeadings(markdown) {
  const headings = [];
  const counts = new Map();
  for (const match of stripFencedCode(markdown).matchAll(/^(#{2,4})\s+(.+?)\s*#*$/gmu)) {
    const text = plainText(match[2]).trim();
    const base = slugifyHeading(text) || 'section';
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    headings.push({
      depth: match[1].length,
      text,
      slug: count === 1 ? base : `${base}-${count}`,
    });
  }
  return headings;
}

function validateStringArray(value, field, relativePath, errors, required) {
  if (value === undefined && !required) {
    return;
  }
  if (!Array.isArray(value) || (required && value.length === 0)) {
    errors.push(`${relativePath}: ${field} must be a non-empty array`);
    return;
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    errors.push(`${relativePath}: ${field} entries must be non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    errors.push(`${relativePath}: ${field} entries must be unique`);
  }
}

export function validateArticle({ metadata, body, relativePath }) {
  const errors = [];
  for (const key of Object.keys(metadata)) {
    if (!ARTICLE_METADATA_FIELDS.has(key)) {
      errors.push(`${relativePath}: unknown metadata field ${key}`);
    }
  }
  for (const key of REQUIRED_ARTICLE_METADATA) {
    if (metadata[key] === undefined || metadata[key] === null || metadata[key] === '') {
      errors.push(`${relativePath}: missing metadata field ${key}`);
    }
  }
  if (typeof metadata.title !== 'string' || metadata.title.length < 2 || metadata.title.length > 100) {
    errors.push(`${relativePath}: title must contain 2-100 characters`);
  }
  if (typeof metadata.summary !== 'string'
    || metadata.summary.length < 10
    || metadata.summary.length > 240) {
    errors.push(`${relativePath}: summary must contain 10-240 characters`);
  }
  validateStringArray(metadata.tags, 'tags', relativePath, errors, true);
  if (metadata.status !== 'current') {
    errors.push(`${relativePath}: status must be current`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(metadata.updated || ''))) {
    errors.push(`${relativePath}: updated must use YYYY-MM-DD`);
  }
  if (!['verified', 'confirmed', 'provisional'].includes(metadata.confidence)) {
    errors.push(`${relativePath}: confidence must be verified, confirmed, or provisional`);
  }
  if (!Array.isArray(metadata.sources) || metadata.sources.length === 0) {
    errors.push(`${relativePath}: sources must contain at least one source`);
  } else {
    metadata.sources.forEach((source, index) => {
      if (!isRecord(source)) {
        errors.push(`${relativePath}: sources[${index}] must be an object`);
        return;
      }
      reportUnsupportedFields(
        source,
        new Set(['kind', 'ref']),
        `${relativePath}: sources[${index}]`,
        errors,
      );
      if (!['repository', 'documentation', 'decision', 'verification'].includes(source.kind)) {
        errors.push(`${relativePath}: sources[${index}].kind is unsupported`);
      }
      if (typeof source.ref !== 'string' || source.ref.length < 3 || source.ref.length > 240) {
        errors.push(`${relativePath}: sources[${index}].ref must contain 3-240 characters`);
      }
    });
  }
  if (body.trim().length < 80) {
    errors.push(`${relativePath}: article body is too short`);
  }
  const bodyWithoutCode = stripFencedCode(body).replace(/`[^`\n]+`/gu, '');
  if (/<[A-Za-z][^>]*>/u.test(bodyWithoutCode)) {
    errors.push(`${relativePath}: raw HTML is not allowed`);
  }
  const serialized = `${JSON.stringify(metadata)}\n${body}`;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.expression.test(serialized)) {
      errors.push(`${relativePath}: possible ${pattern.name} detected`);
    }
  }
  return errors;
}

export async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ContentValidationError([
        `${normalizePath(filename)}: symbolic links are not allowed in Wiki source data`,
      ]);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(filename));
    } else if (entry.isFile()) {
      files.push(filename);
    } else {
      throw new ContentValidationError([
        `${normalizePath(filename)}: only regular files are allowed in Wiki source data`,
      ]);
    }
  }
  return files;
}

async function validateRepositoryShape(repository, errors) {
  for (const directory of FORBIDDEN_ROOT_DIRECTORIES) {
    const filename = path.join(repository, directory);
    try {
      const info = await lstat(filename);
      if (info.isDirectory() || info.isSymbolicLink()) {
        errors.push(`${directory}/ is forbidden; keep raw material and drafts outside the Wiki repository`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const contentRoot = path.join(repository, 'content');
  for (const filename of await listFiles(contentRoot)) {
    const relativePath = normalizePath(path.relative(contentRoot, filename));
    const isArticle = /^articles\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(relativePath);
    if (!isArticle && !REGISTRY_FILES.has(relativePath)) {
      errors.push(`content/${relativePath}: unsupported content file`);
    }
  }

  const attachmentsRoot = path.join(repository, 'attachments');
  for (const filename of await listFiles(attachmentsRoot)) {
    const relativePath = normalizePath(path.relative(repository, filename));
    const extension = path.extname(filename).toLowerCase();
    if (!ALLOWED_ATTACHMENTS.has(extension)) {
      errors.push(`${relativePath}: attachment type ${extension || '<none>'} is not allowed`);
      continue;
    }
    if (extension === '.txt') {
      const source = await readFile(filename, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.expression.test(source)) {
          errors.push(`${relativePath}: possible ${pattern.name} detected`);
        }
      }
    }
  }
}

async function readRegistry(repository, articleIds) {
  const registryRoot = path.join(repository, 'content', 'registry');
  let sources;
  try {
    sources = await Promise.all([
      readFile(path.join(registryRoot, 'taxonomy.yaml'), 'utf8'),
      readFile(path.join(registryRoot, 'projects.yaml'), 'utf8'),
      readFile(path.join(registryRoot, 'articles.yaml'), 'utf8'),
    ]);
  } catch (error) {
    throw new ContentValidationError([`content/registry: ${error.message}`]);
  }
  return parseRegistryDocuments({
    taxonomySource: sources[0],
    projectsSource: sources[1],
    articlesSource: sources[2],
    articleIds,
  });
}

function reportDuplicate(seen, value, relativePath, label, errors) {
  if (!value) {
    return;
  }
  if (seen.has(value)) {
    errors.push(`${relativePath}: duplicate ${label} ${value}; first used by ${seen.get(value)}`);
  } else {
    seen.set(value, relativePath);
  }
}

async function validateLinksAndAttachments(repository, articles, errors) {
  const articleIds = new Set(articles.map((article) => article.metadata.id));
  const attachmentsRoot = path.join(repository, 'attachments');
  const referencedAttachments = new Set();

  for (const article of articles) {
    for (const match of article.body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/iu.test(target)) {
        continue;
      }
      if (target.startsWith('/articles/')) {
        const id = target.slice('/articles/'.length).replace(/\/$/u, '');
        if (!articleIds.has(id)) {
          errors.push(`${article.relativePath}: unknown article link ${target}`);
        }
        continue;
      }

      let targetWithoutAnchor;
      try {
        targetWithoutAnchor = decodeURIComponent(target.split('#')[0].split('?')[0]);
      } catch {
        errors.push(`${article.relativePath}: local link has invalid encoding ${target}`);
        continue;
      }
      let absolute;
      if (targetWithoutAnchor.startsWith('/attachments/')) {
        absolute = path.resolve(repository, targetWithoutAnchor.slice(1));
      } else if (targetWithoutAnchor.startsWith('/')) {
        errors.push(`${article.relativePath}: unsupported absolute local link ${target}`);
        continue;
      } else {
        absolute = path.resolve(
          path.dirname(path.join(repository, 'content', article.relativePath)),
          targetWithoutAnchor,
        );
      }
      if (!isInside(repository, absolute)) {
        errors.push(`${article.relativePath}: local link escapes repository ${target}`);
        continue;
      }
      try {
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink()) {
          errors.push(`${article.relativePath}: link is not a regular file ${target}`);
          continue;
        }
      } catch {
        errors.push(`${article.relativePath}: broken local link ${target}`);
        continue;
      }
      if (isInside(attachmentsRoot, absolute)) {
        referencedAttachments.add(normalizePath(path.relative(attachmentsRoot, absolute)));
      }
    }
  }

  for (const filename of await listFiles(attachmentsRoot)) {
    const relativePath = normalizePath(path.relative(attachmentsRoot, filename));
    if (!referencedAttachments.has(relativePath)) {
      errors.push(`attachments/${relativePath}: attachment is not referenced by any article`);
    }
  }
  return referencedAttachments;
}

function toPublicArticleMetadata(article) {
  const metadata = article.metadata;
  return {
    id: metadata.id,
    title: metadata.title,
    summary: metadata.summary,
    section: metadata.section,
    category: metadata.category,
    order: metadata.order,
    tags: metadata.tags,
    status: metadata.status,
    updated: String(metadata.updated),
    confidence: metadata.confidence,
    projects: metadata.projects || [],
    sources: metadata.sources,
  };
}

function buildProjectCatalog(projects, sections, articles) {
  const definitions = [
    ...projects,
    {
      id: 'unassigned',
      title: '未指定项目',
      description: '尚未关联到正式项目的知识。',
      order: 9999,
    },
  ];
  return definitions.map((project) => {
    const projectArticles = articles.filter((article) => (
      project.id === 'unassigned'
        ? article.projects.length === 0
        : article.projects.includes(project.id)
    ));
    const projectSections = sections.map((section) => ({
      ...section,
      categories: section.categories.map((category) => ({
        ...category,
        articles: projectArticles.filter((article) => (
          article.section === section.id && article.category === category.id
        )),
      })).filter((category) => category.articles.length > 0),
    })).filter((section) => section.categories.length > 0);
    return {
      ...project,
      articleCount: projectArticles.length,
      sections: projectSections,
    };
  }).filter((project) => project.articleCount > 0);
}

async function prepareOutput(repository, output) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('output directory is required');
  }
  const resolved = path.resolve(output);
  const protectedRoots = [
    repository,
    path.join(repository, 'content'),
    path.join(repository, 'attachments'),
  ];
  if (protectedRoots.some((root) => resolved === root)) {
    throw new Error('output directory cannot replace Wiki source data');
  }
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('output must be a regular directory, not a symbolic link');
    }
    if ((await readdir(resolved)).length > 0) {
      throw new Error('output directory must be empty');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await mkdir(resolved, { recursive: true });
  }
  return realpath(resolved);
}

async function writeJSON(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyAttachments(repository, output, referencedAttachments) {
  for (const relativePath of [...referencedAttachments].sort((left, right) => left.localeCompare(right))) {
    const source = path.join(repository, 'attachments', nativePath(relativePath));
    const destination = path.join(output, 'attachments', nativePath(relativePath));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

export async function compileKnowledge({ repository, output, generatedAt } = {}) {
  if (typeof repository !== 'string' || repository.trim() === '') {
    throw new Error('repository directory is required');
  }
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('generatedAt must be an ISO date-time');
  }
  const repositoryRoot = await realpath(path.resolve(repository));
  if (!(await stat(repositoryRoot)).isDirectory()) {
    throw new Error('repository must be a directory');
  }

  const errors = [];
  await validateRepositoryShape(repositoryRoot, errors);
  const contentRoot = path.join(repositoryRoot, 'content');
  const articlesRoot = path.join(contentRoot, 'articles');
  const markdownFiles = (await listFiles(articlesRoot))
    .filter((filename) => filename.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));
  const articleIds = markdownFiles.map((filename) => path.basename(filename, '.md'));
  const { taxonomy: sections, projects, assignments } = await readRegistry(repositoryRoot, articleIds);
  const articles = [];

  for (const filename of markdownFiles) {
    const relativePath = normalizePath(path.relative(contentRoot, filename));
    try {
      const parsed = parseArticleSource(await readFile(filename, 'utf8'), relativePath);
      errors.push(...validateArticle({ ...parsed, relativePath }));
      const articleId = path.basename(filename, '.md');
      articles.push({
        ...parsed,
        metadata: { ...assignments.get(articleId), ...parsed.metadata },
        relativePath,
        headings: extractHeadings(parsed.body),
      });
    } catch (error) {
      errors.push(error.message);
    }
  }

  const ids = new Map();
  const titles = new Map();
  for (const article of articles) {
    reportDuplicate(ids, article.metadata.id, article.relativePath, 'id', errors);
    reportDuplicate(titles, article.metadata.title, article.relativePath, 'title', errors);
  }
  const referencedAttachments = await validateLinksAndAttachments(repositoryRoot, articles, errors);
  if (errors.length > 0) {
    throw new ContentValidationError(errors);
  }

  const sortedArticles = articles.sort((left, right) => {
    const leftSection = sections.find((section) => section.id === left.metadata.section);
    const rightSection = sections.find((section) => section.id === right.metadata.section);
    const leftCategoryOrder = leftSection?.categories.find(
      (category) => category.id === left.metadata.category,
    )?.order ?? 9999;
    const rightCategoryOrder = rightSection?.categories.find(
      (category) => category.id === right.metadata.category,
    )?.order ?? 9999;
    return (leftSection?.order ?? 9999) - (rightSection?.order ?? 9999)
      || leftCategoryOrder - rightCategoryOrder
      || left.metadata.order - right.metadata.order
      || left.metadata.title.localeCompare(right.metadata.title);
  });
  const publicArticles = sortedArticles.map(toPublicArticleMetadata);
  const catalog = {
    schema: 1,
    generatedAt,
    articleCount: publicArticles.length,
    sections: sections.map((section) => ({
      ...section,
      categories: section.categories.map((category) => ({
        ...category,
        articles: publicArticles.filter((article) => (
          article.section === section.id && article.category === category.id
        )),
      })),
    })),
    projects: buildProjectCatalog(projects, sections, publicArticles),
  };
  const search = {
    schema: 1,
    generatedAt,
    entries: sortedArticles.map((article) => ({
      id: article.metadata.id,
      title: article.metadata.title,
      summary: article.metadata.summary,
      tags: article.metadata.tags,
      section: article.metadata.section,
      category: article.metadata.category,
      confidence: article.metadata.confidence,
      updated: String(article.metadata.updated),
      projects: article.metadata.projects || [],
      text: plainText(article.body),
    })),
  };
  const outputRoot = await prepareOutput(repositoryRoot, output);
  await writeJSON(path.join(outputRoot, 'data', 'catalog.json'), catalog);
  await writeJSON(path.join(outputRoot, 'data', 'search.json'), search);
  for (const article of sortedArticles) {
    await writeJSON(path.join(outputRoot, 'data', 'articles', `${article.metadata.id}.json`), {
      schema: 1,
      metadata: toPublicArticleMetadata(article),
      headings: article.headings,
      body: article.body,
    });
  }
  await copyAttachments(repositoryRoot, outputRoot, referencedAttachments);

  const releaseDigest = createHash('sha256')
    .update(JSON.stringify({ catalog, search, articles: publicArticles }))
    .digest('hex')
    .slice(0, 16);
  const releaseManifest = await writeReleaseManifest({
    root: outputRoot,
    releaseId: `knowledge-${releaseDigest}`,
    generatedAt,
  });
  return {
    articles: sortedArticles,
    catalog,
    search,
    releaseManifest,
    output: outputRoot,
  };
}
