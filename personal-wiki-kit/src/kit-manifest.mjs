import {
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SUPPORTED_SCHEMA = 1;
const MANIFEST_FIELDS = new Set(['schema', 'version']);
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.release-out',
  '.release-work',
  '.wiki-kit-out',
  'coverage',
  'node_modules',
  'reader-dist',
]);
const TEXT_EXTENSIONS = new Set([
  '',
  '.bat',
  '.cjs',
  '.css',
  '.go',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function assertPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Kit manifest must be a JSON object');
  }
}

export function parseKitManifest(source) {
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`Kit manifest must be valid JSON: ${error.message}`);
  }

  assertPlainObject(manifest);
  for (const field of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.has(field)) {
      throw new Error(`Kit manifest contains unsupported field: ${field}`);
    }
  }
  for (const field of MANIFEST_FIELDS) {
    if (!Object.hasOwn(manifest, field)) {
      throw new Error(`Kit manifest is missing required field: ${field}`);
    }
  }
  if (manifest.schema !== SUPPORTED_SCHEMA) {
    throw new Error(`Unsupported Kit manifest schema: ${manifest.schema}`);
  }
  if (typeof manifest.version !== 'string' || !SEMANTIC_VERSION.test(manifest.version)) {
    throw new Error('Kit manifest version must be an exact semantic version');
  }

  return {
    schema: manifest.schema,
    version: manifest.version,
  };
}

function normalizedRelativePath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join('/');
}

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name);
}

function isTextFile(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
        continue;
      }
      const absolutePath = join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        files.push({ absolutePath, symbolicLink: true });
      } else if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile()) {
        files.push({ absolutePath, symbolicLink: false });
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.absolutePath.localeCompare(right.absolutePath));
}

function extractUrlHosts(source) {
  const hosts = [];
  const urlPattern = /https?:\/\/[^\s<>'"`)]+/giu;
  for (const match of source.matchAll(urlPattern)) {
    try {
      hosts.push(new URL(match[0]).hostname.toLowerCase());
    } catch {
      // Malformed URLs are validated by their owning parser, not this boundary scan.
    }
  }
  return hosts;
}

function isAllowedHost(host) {
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host === 'example.com'
    || host.endsWith('.example.com')
    || host === 'github.com'
    || host === 'json-schema.org'
    || host === 'registry.npmjs.org';
}

function contentReasons(path, source) {
  const reasons = [];
  const machineUserPath = /(?:\b[A-Za-z]:[\\/]Users[\\/](?!example(?:[\\/]|$))[^\s<>'"`]+|\/home\/(?!example(?:\/|$))[^/\s<>'"`]+\/[^\s<>'"`]*)/iu;
  const privateKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;

  if (machineUserPath.test(source)) {
    reasons.push('machine-specific user path is not allowed in the public Kit');
  }
  if (extractUrlHosts(source).some((host) => !isAllowedHost(host))) {
    reasons.push('non-example domain is not allowed in the public Kit');
  }
  if (privateKey.test(source)) {
    reasons.push('private key material is not allowed in the public Kit');
  }
  return reasons.map((reason) => ({ path, reason }));
}

export function scanPublicTree(rootPath) {
  const root = resolve(rootPath);
  const findings = [];

  for (const file of walkFiles(root)) {
    const path = normalizedRelativePath(root, file.absolutePath);
    if (file.symbolicLink) {
      findings.push({
        path,
        reason: 'symbolic links are not allowed in the public Kit',
      });
      continue;
    }
    if (path === 'content' || path.startsWith('content/')) {
      findings.push({
        path,
        reason: 'private knowledge content is not allowed in the public Kit',
      });
    }
    if (!isTextFile(path)) {
      continue;
    }
    const source = readFileSync(file.absolutePath, 'utf8');
    findings.push(...contentReasons(path, source));
  }

  return findings;
}
