import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

export const GATEWAY_SCHEMA = 1;
export const WORKSPACE_SITE_KIND = 'workspace';
export const RELEASE_SERVER_SITE_KIND = 'release-server';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOG_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`failed to read ${path}: ${error.message}`, { cause: error });
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
  }
}

function parsePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('publicUrl is required');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('publicUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('publicUrl must contain only scheme, host, optional port, and / path');
  }
  if (!url.hostname) throw new Error('publicUrl must include a host');
  return url;
}

function parseUpstream(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('upstream is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('upstream must be a loopback http URL');
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('upstream must be a loopback http URL');
  }
  const hostname = url.hostname.toLowerCase();
  let loopback = LOOPBACK_HOSTS.has(hostname);
  if (!loopback) {
    // URL.hostname keeps IPv6 brackets in some Node versions; normalize both forms.
    const candidate = hostname.replace(/^\[|\]$/g, '');
    loopback = candidate === '::1' || (isIP(candidate) === 4 && candidate.startsWith('127.'));
  }
  if (!loopback) throw new Error('upstream must use a loopback address');
  return url;
}

function validateTLS(tls) {
  requireObject(tls ?? {}, 'tls');
  rejectUnknownKeys(tls ?? {}, new Set(['certificateFile', 'keyFile']), 'tls');
  const certificateFile = tls.certificateFile ?? '';
  const keyFile = tls.keyFile ?? '';
  if (typeof certificateFile !== 'string' || typeof keyFile !== 'string') {
    throw new Error('tls certificateFile and keyFile must be strings');
  }
  if (Boolean(certificateFile) !== Boolean(keyFile)) {
    throw new Error('tls certificateFile and keyFile must be provided as a pair');
  }
  if (certificateFile && (!isAbsolute(certificateFile) || !isAbsolute(keyFile))) {
    throw new Error('tls certificateFile and keyFile must be absolute paths');
  }
  return { certificateFile, keyFile };
}

export function validateGatewayGlobal(config = {}) {
  requireObject(config, 'Gateway config');
  rejectUnknownKeys(config, new Set(['schema', 'acme', 'log']), 'Gateway config');
  if (config.schema !== undefined && config.schema !== GATEWAY_SCHEMA) {
    throw new Error(`unsupported Gateway config schema ${config.schema}`);
  }
  const acme = config.acme ?? {};
  const log = config.log ?? {};
  requireObject(acme, 'Gateway config acme');
  requireObject(log, 'Gateway config log');
  rejectUnknownKeys(acme, new Set(['email']), 'Gateway config acme');
  rejectUnknownKeys(log, new Set(['level']), 'Gateway config log');
  if (acme.email !== undefined && typeof acme.email !== 'string') {
    throw new Error('Gateway config acme.email must be a string');
  }
  const level = String(log.level ?? 'INFO').toUpperCase();
  if (!LOG_LEVELS.has(level)) throw new Error(`unsupported Gateway log level ${level}`);
  return {
    schema: GATEWAY_SCHEMA,
    acme: { email: acme.email ?? '' },
    log: { level: level.toLowerCase() === 'warning' ? 'warn' : level.toLowerCase() },
  };
}

export function validateGatewaySite(site, {kind} = {}) {
  requireObject(site, 'Gateway site');
  rejectUnknownKeys(site, new Set(['schema', 'kind', 'publicUrl', 'webRoot', 'publicRoot', 'upstream', 'tls']), 'Gateway site');
  if (site.schema !== GATEWAY_SCHEMA) throw new Error(`unsupported Gateway site schema ${site.schema}`);
  const siteKind = kind ?? site.kind;
  if (![WORKSPACE_SITE_KIND, RELEASE_SERVER_SITE_KIND].includes(siteKind)) {
    throw new Error(`unsupported Gateway site kind ${siteKind}`);
  }
  if (site.kind !== siteKind) throw new Error(`Gateway site kind must be ${siteKind}`);
  const publicUrl = parsePublicUrl(site.publicUrl);
  const upstream = parseUpstream(site.upstream);
  const staticRoot = siteKind === WORKSPACE_SITE_KIND ? site.webRoot : site.publicRoot;
  if (typeof staticRoot !== 'string' || !isAbsolute(staticRoot)) {
    throw new Error('static root must be an absolute path');
  }
  if (siteKind === WORKSPACE_SITE_KIND && site.publicRoot !== undefined) {
    throw new Error('workspace site cannot set publicRoot');
  }
  if (siteKind === RELEASE_SERVER_SITE_KIND && site.webRoot !== undefined) {
    throw new Error('release-server site cannot set webRoot');
  }
  const tls = validateTLS(site.tls);
  return {
    schema: GATEWAY_SCHEMA,
    kind: siteKind,
    publicUrl: publicUrl.href.replace(/\/$/, ''),
    ...(siteKind === WORKSPACE_SITE_KIND ? { webRoot: resolve(staticRoot) } : { publicRoot: resolve(staticRoot) }),
    upstream: upstream.href.replace(/\/$/, ''),
    tls,
  };
}

export function gatewayHome({
  home,
  userHome = homedir(),
} = {}) {
  if (home !== undefined) {
    if (!isAbsolute(home)) throw new Error('Gateway home must be an absolute path');
    return resolve(home);
  }
  return resolve(userHome, '.wheelmaker', 'gateway');
}

export function gatewayConfigPaths(home) {
  const root = gatewayHome({home});
  return {
    home: root,
    config: join(root, 'config.json'),
    sites: join(root, 'sites'),
    workspace: join(root, 'sites', 'workspace.json'),
    releaseServer: join(root, 'sites', 'release-server.json'),
    generated: join(root, 'generated', 'caddy.json'),
    state: join(root, 'state', 'release.json'),
    data: join(root, 'data'),
    logs: join(root, 'logs'),
    downloads: join(root, 'downloads'),
    rollback: join(root, 'rollback'),
    bin: join(root, 'bin'),
  };
}

export async function readGatewayConfiguration(home) {
  const paths = gatewayConfigPaths(home);
  const [global, workspace, releaseServer] = await Promise.all([
    readJsonIfPresent(paths.config),
    readJsonIfPresent(paths.workspace),
    readJsonIfPresent(paths.releaseServer),
  ]);
  if (global !== null) validateGatewayGlobal(global);
  if (workspace !== null) validateGatewaySite(workspace, {kind: WORKSPACE_SITE_KIND});
  if (releaseServer !== null) validateGatewaySite(releaseServer, {kind: RELEASE_SERVER_SITE_KIND});
  return {paths, global, workspace, releaseServer};
}

async function atomicWrite(path, bytes, mode = 0o600) {
  await mkdir(join(path, '..'), {recursive: true});
  const temporary = join(join(path, '..'), `.${path.split(/[\\/]/).pop()}.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, {mode});
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, {force: true});
  }
}

export async function writeWorkspaceSite(home, site) {
  const validated = validateGatewaySite(site, {kind: WORKSPACE_SITE_KIND});
  const paths = gatewayConfigPaths(home);
  await mkdir(paths.sites, {recursive: true});
  await atomicWrite(paths.workspace, jsonBytes(validated), 0o600);
  return validated;
}

export function workspaceSiteCandidate({
  publicUrl,
  webRoot,
  upstream = 'http://127.0.0.1:9630',
  certificateFile = '',
  keyFile = '',
} = {}) {
  return validateGatewaySite({
    schema: GATEWAY_SCHEMA,
    kind: WORKSPACE_SITE_KIND,
    publicUrl,
    webRoot,
    upstream,
    tls: {certificateFile, keyFile},
  }, {kind: WORKSPACE_SITE_KIND});
}

function defaultAsk() {
  return async () => '';
}

export function createGatewayQuestioner({input = process.stdin, output = process.stdout} = {}) {
  const readline = createInterface({input, output});
  return {
    ask: async (question, defaultValue = '') => {
      const suffix = defaultValue ? ` [${defaultValue}]` : '';
      const answer = await readline.question(`${question}${suffix} `);
      return answer === '' ? defaultValue : answer;
    },
    close: () => readline.close(),
  };
}

export function parseGatewayOptions(args) {
  const options = {
    commandArgs: [],
    explicit: false,
    mode: 'none',
    publicUrl: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith('--gateway=')) {
      if (options.explicit) throw new Error('--gateway may only be specified once');
      const mode = token.slice('--gateway='.length);
      if (!['none', 'caddy'].includes(mode)) {
        throw new Error('--gateway must be none or caddy');
      }
      options.explicit = true;
      options.mode = mode;
      continue;
    }
    if (token === '--gateway-public-url' || token.startsWith('--gateway-public-url=')) {
      if (options.publicUrl !== undefined) {
        throw new Error('--gateway-public-url may only be specified once');
      }
      if (token.includes('=')) {
        options.publicUrl = token.slice(token.indexOf('=') + 1);
      } else {
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--gateway-public-url requires a value');
        }
        options.publicUrl = value;
        index += 1;
      }
      continue;
    }
    options.commandArgs.push(token);
  }
  if (options.publicUrl !== undefined && options.mode !== 'caddy') {
    throw new Error('--gateway-public-url is only valid with --gateway=caddy');
  }
  return options;
}

export async function configureWorkspaceSite({
  home,
  ask,
  mode = 'none',
  publicUrl,
  webRoot,
  upstream = 'http://127.0.0.1:9630',
} = {}) {
  if (mode === 'none') return {written: false};
  if (mode !== 'caddy') throw new Error(`unsupported Gateway mode ${mode}`);
  const paths = gatewayConfigPaths(home);
  const existingValue = await readJsonIfPresent(paths.workspace);
  const existing = existingValue === null
    ? null
    : validateGatewaySite(existingValue, {kind: WORKSPACE_SITE_KIND});
  let selectedPublicUrl = publicUrl ?? existing?.publicUrl;
  if (!selectedPublicUrl && ask) {
    selectedPublicUrl = await ask('Workspace public URL', 'https://workspace.example.com');
  }
  if (!selectedPublicUrl) {
    throw new Error('first non-interactive Caddy deployment requires --gateway-public-url');
  }
  const candidate = workspaceSiteCandidate({publicUrl: selectedPublicUrl, webRoot, upstream});
  await writeWorkspaceSite(home, candidate);
  return {existing, paths, site: candidate, written: true};
}

export async function gatewayConfigExists(home) {
  try {
    await access(gatewayConfigPaths(home).config);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
