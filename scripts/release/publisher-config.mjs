import {execFile, spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {chmod, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

function validateTokenDocument(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'schema,token' ||
    value.schema !== 1 ||
    typeof value.token !== 'string'
  ) {
    throw new Error(`${label} is invalid`);
  }
  let bytes;
  try {
    bytes = Buffer.from(value.token, 'base64url');
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (bytes.length !== 32 || bytes.toString('base64url') !== value.token) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function syncActionSecret(token, deps) {
  try {
    if (!await deps.ghAvailable()) {
      deps.warning(
        'GitHub CLI is unavailable or not authenticated; set the repository Secret WHEELMAKER_RELEASE_TOKEN before using Action publishing.',
      );
      return;
    }
    await deps.setActionSecret(
      ['secret', 'set', 'WHEELMAKER_RELEASE_TOKEN'],
      token,
    );
  } catch (error) {
    deps.warning(
      `Local publishing is configured, but WHEELMAKER_RELEASE_TOKEN could not be updated in GitHub Actions: ${error.message}`,
    );
  }
}

export async function resolvePublisherToken({actions}, deps) {
  if (actions) {
    const token = deps.env?.WHEELMAKER_RELEASE_TOKEN;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(
        'GitHub Actions requires the WHEELMAKER_RELEASE_TOKEN repository Secret; run one successful local publish first',
      );
    }
    return token;
  }

  const finalDocument = await deps.readFinal();
  if (finalDocument) {
    const {token} = validateTokenDocument(
      finalDocument,
      'local release server configuration',
    );
    await syncActionSecret(token, deps);
    return token;
  }

  let pendingDocument = await deps.readPending();
  if (pendingDocument) {
    pendingDocument = validateTokenDocument(
      pendingDocument,
      'pending release server configuration',
    );
  } else {
    pendingDocument = {schema: 1, token: deps.randomToken()};
    validateTokenDocument(pendingDocument, 'generated release server configuration');
    await deps.writePending(pendingDocument);
  }

  const tokenHash = createHash('sha256')
    .update(pendingDocument.token)
    .digest('hex');
  const sshPrefix = [
    '-i',
    deps.identityFile,
    '-p',
    '22',
    `root@${deps.host}`,
  ];
  await deps.configureRemote([
    ...sshPrefix,
    '/opt/wheelmaker-release-server/current/wheelmaker-release-server',
    'configure-token',
    '--config',
    '/etc/wheelmaker-release-server/config.json',
    '--sha256',
    tokenHash,
  ]);
  await deps.restartRemote([
    ...sshPrefix,
    'systemctl',
    'restart',
    'wheelmaker-release-server',
  ]);
  await deps.waitForHealth();
  await deps.promotePending();
  await syncActionSecret(pendingDocument.token, deps);
  return pendingDocument.token;
}

function spawnWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ));
      }
    });
    child.stdin.end(input);
  });
}

async function readDocument(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`failed to read ${path}`, {cause: error});
  }
}

async function protectWindowsFile(path) {
  const username = process.env.USERNAME;
  if (!username) {
    throw new Error('USERNAME is required to protect the local publishing token');
  }
  await execFileAsync(
    'icacls.exe',
    [path, '/inheritance:r', '/grant:r', `${username}:(R,W)`],
    {windowsHide: true},
  );
}

async function writeProtectedAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await writeFile(temporary, bytes, {flag: 'wx', mode: 0o600});
    await chmod(temporary, 0o600);
    if (process.platform === 'win32') {
      await protectWindowsFile(temporary);
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, {force: true});
  }
}

async function runSsh(args) {
  await execFileAsync('ssh', args, {windowsHide: true});
}

export function createPublisherConfigDependencies({
  baseUrl,
  env = process.env,
  fetchImpl = fetch,
  homeDirectory = homedir(),
  warning = message => process.stderr.write(`[release] Warning: ${message}\n`),
} = {}) {
  const origin = new URL(baseUrl);
  const directory = join(homeDirectory, '.wheelmaker');
  const finalPath = join(directory, 'release-server.json');
  const pendingPath = `${finalPath}.pending`;
  return {
    env,
    host: origin.hostname,
    identityFile: join(
      homeDirectory,
      '.ssh',
      'wheelmaker-release-server_ed25519',
    ),
    warning,
    randomToken: () => randomBytes(32).toString('base64url'),
    readFinal: () => readDocument(finalPath),
    readPending: () => readDocument(pendingPath),
    async writePending(document) {
      await mkdir(directory, {recursive: true, mode: 0o700});
      await writeProtectedAtomic(pendingPath, document);
    },
    async promotePending() {
      await rename(pendingPath, finalPath);
      await chmod(finalPath, 0o600);
      if (process.platform === 'win32') {
        await protectWindowsFile(finalPath);
      }
    },
    configureRemote: runSsh,
    restartRemote: runSsh,
    async waitForHealth() {
      const healthUrl = new URL('/healthz', `${baseUrl}/`);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const response = await fetchImpl(healthUrl, {cache: 'no-store'});
          if (response.ok) {
            const body = await response.json();
            if (body?.ok === true && body.publisherConfigured === true) return;
          }
        } catch {
          // The service can be briefly unavailable while systemd restarts it.
        }
        if (attempt + 1 < 30) await delay(1_000);
      }
      throw new Error('release server health check did not confirm publisher configuration');
    },
    async ghAvailable() {
      try {
        await execFileAsync('gh', ['--version'], {windowsHide: true});
        await execFileAsync('gh', ['auth', 'status'], {windowsHide: true});
        return true;
      } catch {
        return false;
      }
    },
    setActionSecret(args, input) {
      return spawnWithInput('gh', args, input);
    },
  };
}
