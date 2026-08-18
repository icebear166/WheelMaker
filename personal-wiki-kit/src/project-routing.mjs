import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DOCUMENT_FIELDS = new Set(['schema', 'routes']);
const ROUTE_FIELDS = new Set(['projectId', 'roots']);
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function normalizedRoot(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || !path.isAbsolute(value)) {
    throw new Error(`${label} 必须是绝对路径`);
  }
  return path.normalize(value);
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function containsPath(candidate, root) {
  const relativePath = path.relative(root, candidate);
  return relativePath === ''
    || (!relativePath.startsWith(`..${path.sep}`)
      && relativePath !== '..'
      && !path.isAbsolute(relativePath));
}

export function parseProjectRouting(source, { projectIds } = {}) {
  let document;
  try {
    document = JSON.parse(String(source));
  } catch (error) {
    throw new Error(`项目路由不是有效 JSON：${error.message}`);
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('项目路由必须是对象');
  }
  for (const field of Object.keys(document)) {
    if (!DOCUMENT_FIELDS.has(field)) {
      throw new Error(`项目路由包含不支持的字段 ${field}`);
    }
  }
  if (document.schema !== 1 || !Array.isArray(document.routes)) {
    throw new Error('项目路由必须使用 schema 1，并包含 routes 数组');
  }

  const owners = new Map();
  const routes = document.routes.map((route, routeIndex) => {
    const label = `routes[${routeIndex}]`;
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error(`${label} 必须是对象`);
    }
    for (const field of Object.keys(route)) {
      if (!ROUTE_FIELDS.has(field)) {
        throw new Error(`${label} 包含不支持的字段 ${field}`);
      }
    }
    if (!STABLE_ID.test(route.projectId || '') || route.projectId === 'unassigned') {
      throw new Error(`${label}.projectId 必须是非保留的小写 kebab-case ID`);
    }
    if (projectIds && !projectIds.has(route.projectId)) {
      throw new Error(`未知项目 ID：${route.projectId}`);
    }
    if (!Array.isArray(route.roots) || route.roots.length === 0) {
      throw new Error(`${label}.roots 至少需要一个路径`);
    }
    const roots = route.roots.map((root, rootIndex) => {
      const normalized = normalizedRoot(root, `${label}.roots[${rootIndex}]`);
      const comparable = comparablePath(normalized);
      const owner = owners.get(comparable);
      if (owner) {
        if (owner === route.projectId) {
          throw new Error(`项目路径 ${normalized} 重复`);
        }
        throw new Error(`项目路径 ${normalized} 同时分配给了 ${owner} 和 ${route.projectId}`);
      }
      owners.set(comparable, route.projectId);
      return normalized;
    });
    return { projectId: route.projectId, roots };
  });
  return { schema: 1, routes };
}

export function resolveProjectIds(routing, { sourcePaths = [], workspacePath } = {}) {
  const candidates = sourcePaths.length > 0 ? sourcePaths : (workspacePath ? [workspacePath] : []);
  const roots = routing.routes.flatMap((route, routeIndex) => route.roots.map((root, rootIndex) => ({
    projectId: route.projectId,
    root: comparablePath(root),
    routeIndex,
    rootIndex,
  })));
  const projectIds = [];
  const unmatchedSources = [];
  for (const source of candidates) {
    const normalizedSource = comparablePath(path.resolve(source));
    const match = roots
      .filter((candidate) => containsPath(normalizedSource, candidate.root))
      .sort((left, right) => right.root.length - left.root.length
        || left.routeIndex - right.routeIndex
        || left.rootIndex - right.rootIndex)[0];
    if (!match) {
      unmatchedSources.push(source);
    } else if (!projectIds.includes(match.projectId)) {
      projectIds.push(match.projectId);
    }
  }
  return { projectIds, unmatchedSources };
}

export async function loadProjectRouting({ routingPath, projectIds } = {}) {
  if (typeof routingPath !== 'string' || routingPath.trim() === '') {
    throw new Error('缺少项目路由文件路径');
  }
  const filename = path.resolve(routingPath);
  try {
    return parseProjectRouting(await readFile(filename, 'utf8'), { projectIds });
  } catch (error) {
    throw new Error(`无法读取项目路由 ${filename}：${error.message}`, { cause: error });
  }
}
