import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import path from 'node:path';

import {parseKitLock} from './kit-lock.mjs';

const FIELDS = new Set(['schema', 'domain', 'sshUser', 'sshPort', 'serviceUser', 'installRoot', 'listenPort']);
const TEMPLATES = new Map([
  ['provision.sh', 'provision.sh'],
  ['activate-release.sh', 'activate-release.sh'],
  ['personal-wiki.service', 'personal-wiki.service.template'],
  ['Caddyfile', 'Caddyfile.template'],
  ['publish-action.yml', 'publish-action.yml.template'],
]);

function assertUser(value, field, {allowRoot = false} = {}) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/u.test(value) || (!allowRoot && value === 'root')) {
    throw new Error(`${field} must be a restricted Unix user name`);
  }
}

function normalizeDomain(value) {
  if (typeof value !== 'string') throw new Error('domain must be a DNS host name');
  const domain = value.toLowerCase();
  const labels = domain.split('.');
  if (domain.length > 253 || isIP(domain) !== 0 || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new Error('domain must be a DNS host name without a scheme, path, or port');
  }
  return domain;
}

function assertPort(value, field, minimum) {
  if (!Number.isInteger(value) || value < minimum || value > 65535) throw new Error(`${field} is outside the allowed port range`);
}

function normalizeInstallRoot(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || path.posix.normalize(value) !== value || value.endsWith('/')) {
    throw new Error('installRoot must be a normalized absolute Unix path');
  }
  const segments = value.split('/').filter(Boolean);
  if (segments.length < 2 || segments.some((segment) => !/^[A-Za-z0-9._-]+$/u.test(segment))) {
    throw new Error('installRoot must name a dedicated directory below a top-level root');
  }
  return value;
}

export function parseDeploymentConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('deployment config must be an object');
  for (const field of Object.keys(value)) if (!FIELDS.has(field)) throw new Error(`deployment config contains unsupported field ${field}`);
  if (value.schema !== 1) throw new Error('deployment config schema must be 1');
  assertUser(value.sshUser, 'sshUser');
  assertUser(value.serviceUser, 'serviceUser');
  assertPort(value.sshPort, 'sshPort', 1);
  assertPort(value.listenPort, 'listenPort', 1024);
  return {
    schema: 1,
    domain: normalizeDomain(value.domain),
    sshUser: value.sshUser,
    sshPort: value.sshPort,
    serviceUser: value.serviceUser,
    installRoot: normalizeInstallRoot(value.installRoot),
    listenPort: value.listenPort,
  };
}

function substitutions(config) {
  return new Map([
    ['DOMAIN', config.domain],
    ['SSH_USER', config.sshUser],
    ['SSH_PORT', String(config.sshPort)],
    ['SERVICE_USER', config.serviceUser],
    ['INSTALL_ROOT', config.installRoot],
    ['LISTEN_PORT', String(config.listenPort)],
  ]);
}

export async function renderDeploymentFiles(value, {templatesRoot} = {}) {
  const config = parseDeploymentConfig(value);
  const root = path.resolve(templatesRoot);
  const values = substitutions(config);
  const files = {};
  for (const [outputName, templateName] of TEMPLATES) {
    let content = await readFile(path.join(root, templateName), 'utf8');
    content = content.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (match, key) => {
      if (!values.has(key)) throw new Error(`deployment template ${templateName} contains unsupported placeholder ${match}`);
      return values.get(key);
    });
    files[outputName] = content;
  }
  return files;
}

export async function renderPrivatePublishWorkflow({deployment, kitLock} = {}, {templatePath} = {}) {
  const config = parseDeploymentConfig(deployment);
  const lock = parseKitLock(JSON.stringify(kitLock));
  const expectedArtifact = `personal-wiki-kit-v${lock.version}-linux-x64.tar.gz`;
  let source;
  try {
    source = new URL(lock.source);
  } catch {
    throw new Error('online Kit lock source must be an exact HTTPS artifact URL');
  }
  if (source.protocol !== 'https:' || source.search || source.hash || !source.pathname.endsWith(`/${expectedArtifact}`)) {
    throw new Error(`online Kit lock source must end with ${expectedArtifact}`);
  }
  const values = new Map([
    ['KIT_VERSION', lock.version],
    ['KIT_SOURCE', source.href],
    ['KIT_SHA256', lock.sha256],
    ['SSH_USER', config.sshUser],
    ['SSH_PORT', String(config.sshPort)],
    ['INSTALL_ROOT', config.installRoot],
  ]);
  let workflow = await readFile(path.resolve(templatePath), 'utf8');
  workflow = workflow.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (match, key) => {
    if (!values.has(key)) throw new Error(`private publish workflow contains unsupported placeholder ${match}`);
    return values.get(key);
  });
  return workflow;
}
