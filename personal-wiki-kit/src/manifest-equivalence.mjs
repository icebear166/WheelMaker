import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

function withoutGeneratedAt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = {...value};
  delete copy.generatedAt;
  return copy;
}

async function readJSON(filename, label) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function readReleaseIdentity(root) {
  const dataRoot = path.join(path.resolve(root), 'data');
  const catalog = withoutGeneratedAt(await readJSON(path.join(dataRoot, 'catalog.json'), 'catalog'));
  const search = withoutGeneratedAt(await readJSON(path.join(dataRoot, 'search.json'), 'search index'));
  const articlesRoot = path.join(dataRoot, 'articles');
  const filenames = (await readdir(articlesRoot)).filter((name) => name.endsWith('.json')).sort();
  const articles = {};
  for (const filename of filenames) {
    const id = filename.slice(0, -'.json'.length);
    const article = await readJSON(path.join(articlesRoot, filename), `article ${id}`);
    if (article?.metadata?.id !== id) throw new Error(`article file ${filename} does not match metadata ID`);
    articles[id] = article;
  }
  return {catalog, search, articleIds: Object.keys(articles), articles};
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function compareReleaseIdentity(beforeRoot, afterRoot) {
  const [before, after] = await Promise.all([
    readReleaseIdentity(beforeRoot),
    readReleaseIdentity(afterRoot),
  ]);
  const differences = [];
  if (!same(before.articleIds, after.articleIds)) differences.push('article IDs and stable URLs changed');
  if (!same(before.catalog, after.catalog)) differences.push('catalog changed');
  if (!same(before.search, after.search)) differences.push('search entries changed');
  if (!same(before.articles, after.articles)) differences.push('article payloads changed');
  return {equivalent: differences.length === 0, differences};
}
