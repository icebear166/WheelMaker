import {spawn} from 'node:child_process';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from '../release/channel.mjs';
import {buildRemoteInstallScript} from './remote-install.mjs';

export {buildRemoteInstallScript};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, '..', '..');

export function parseReleaseServerArgs(args) {
  let gateway = 'caddy';
  let seenGateway = false;
  for (const arg of args) {
    if (arg.startsWith('--gateway=')) {
      if (seenGateway) throw new Error('--gateway may only be specified once');
      gateway = arg.slice('--gateway='.length);
      if (!['none', 'caddy'].includes(gateway)) {
        throw new Error('--gateway must be none or caddy');
      }
      seenGateway = true;
      continue;
    }
    throw new Error(`unknown release server option: ${arg}`);
  }
  return {gateway};
}

export async function deployReleaseServer(dependencies = createDefaultDependencies()) {
  const gateway = dependencies.gateway ?? 'caddy';
  if (!['none', 'caddy'].includes(gateway)) {
    throw new Error('--gateway must be none or caddy');
  }
  const channelValue = dependencies.loadChannel
    ? await dependencies.loadChannel()
    : dependencies.channel;
  const channel = validateReleaseChannel(channelValue);
  const origin = new URL(channel.baseUrl);
  const remote = {
    host: origin.hostname,
    identityFile: join(
      dependencies.homeDirectory,
      '.ssh',
      'wheelmaker-release-server_ed25519',
    ),
    port: 22,
  };
  const source = await dependencies.sourceContext();
  if (!/^[0-9a-f]{40}$/.test(source.sha ?? '')) {
    throw new Error('release server deployment requires a full source SHA');
  }
  const workRoot = join(
    dependencies.repoRoot,
    '.release-work',
    'tmp',
    `release-server-${source.sha}`,
  );
  const remoteDirectory = `/tmp/wheelmaker-release-server-${source.sha}`;
  try {
    if (!source.clean) {
      throw new Error('release server deployment requires a clean source tree');
    }
    dependencies.write('Checking local deployment tools');
    await dependencies.ensureTools(['go', 'ssh', 'scp']);
    dependencies.write(`Checking ${remote.host} architecture`);
    const platform = await dependencies.checkRemote(remote);
    if (platform.operatingSystem !== 'Linux' || platform.architecture !== 'amd64') {
      throw new Error(
        `release server requires remote Linux/amd64, received ${platform.operatingSystem}/${platform.architecture}`,
      );
    }

    const binaryPath = join(workRoot, 'wheelmaker-release-server');
    dependencies.write(`Building release server from ${source.sha}`);
    await dependencies.build({binaryPath, sourceSha: source.sha, workRoot});
    const templateRoot = join(dependencies.repoRoot, 'scripts', 'release-server');
    const files = [
      binaryPath,
      join(templateRoot, 'wheelmaker-release-server.service'),
      join(templateRoot, 'index.html'),
      join(templateRoot, 'release-home.js'),
    ];
    dependencies.write(`Uploading release server files to ${remote.host}`);
    await dependencies.upload({files, remote, remoteDirectory});
    dependencies.write(`Installing Release Server in the SSH user Home (Gateway: ${gateway})`);
    await dependencies.install({
      domain: origin.hostname,
      gateway,
      remote,
      remoteDirectory,
      script: buildRemoteInstallScript(),
      sourceSha: source.sha,
      publicUrl: origin.origin,
    });
    dependencies.write(`Release server deployed from ${source.sha}`);
    return {host: remote.host, sourceSha: source.sha};
  } finally {
    if (dependencies.cleanupRemote) {
      await dependencies.cleanupRemote(remote, remoteDirectory).catch(() => {});
    }
    await dependencies.cleanup(workRoot);
  }
}

export function createDefaultDependencies(options = parseReleaseServerArgs(process.argv.slice(2))) {
  return {
    gateway: options.gateway ?? 'caddy',
    homeDirectory: homedir(),
    repoRoot: defaultRepoRoot,
    async loadChannel() {
      return JSON.parse(
        await readFile(new URL('../release/channel.json', import.meta.url), 'utf8'),
      );
    },
    async sourceContext() {
      const status = await runProcess(
        'git',
        ['status', '--porcelain', '--untracked-files=normal'],
        {captureOutput: true, cwd: defaultRepoRoot},
      );
      const revision = await runProcess(
        'git',
        ['rev-parse', 'HEAD'],
        {captureOutput: true, cwd: defaultRepoRoot},
      );
      return {
        clean: status.stdout.length === 0,
        sha: revision.stdout.replace(/[\r\n]+$/, ''),
      };
    },
    async ensureTools(tools) {
      for (const tool of tools) {
        await runProcess('where.exe', [tool], {cwd: defaultRepoRoot});
      }
    },
    async checkRemote(remote) {
      const result = await runProcess(
        'ssh',
        [...sshArguments(remote), remote.host, 'uname -s && uname -m'],
        {captureOutput: true, cwd: defaultRepoRoot},
      );
      const [operatingSystem, machine] = result.stdout.split(/\r?\n/).filter(Boolean);
      return {
        architecture: machine === 'x86_64' ? 'amd64' : machine,
        operatingSystem,
      };
    },
    async build({binaryPath, workRoot}) {
      await mkdir(workRoot, {recursive: true});
      await runProcess(
        'go',
        ['build', '-trimpath', '-o', binaryPath, './cmd/wheelmaker-release-server'],
        {
          cwd: join(defaultRepoRoot, 'server'),
          env: {CGO_ENABLED: '0', GOARCH: 'amd64', GOOS: 'linux'},
        },
      );
    },
    async upload({files, remote, remoteDirectory}) {
      await runProcess(
        'ssh',
        [...sshArguments(remote), remote.host, `install -d -m 0700 ${shellQuote(remoteDirectory)}`],
        {cwd: defaultRepoRoot},
      );
      await runProcess(
        'scp',
        [
          '-P', String(remote.port),
          '-i', remote.identityFile,
          '--',
          ...files,
          `${remote.host}:${remoteDirectory}/`,
        ],
        {cwd: defaultRepoRoot},
      );
    },
    async install({gateway, publicUrl, remote, remoteDirectory, script, sourceSha}) {
      await runProcess(
        'ssh',
        [
          ...sshArguments(remote),
          remote.host,
          `bash -s -- ${[sourceSha, publicUrl, remoteDirectory, gateway].map(shellQuote).join(' ')}`,
        ],
        {cwd: defaultRepoRoot, input: script},
      );
    },
    async health(url) {
      const response = await fetch(url, {headers: {Accept: 'application/json'}});
      if (!response.ok) {
        throw new Error(`release server health failed with HTTP ${response.status}`);
      }
      const body = await response.json();
      if (body?.ok !== true) {
        throw new Error('release server health returned an invalid payload');
      }
    },
    async cleanupRemote(remote, remoteDirectory) {
      if (!/^\/tmp\/wheelmaker-release-server-[0-9a-f]{40}$/.test(remoteDirectory)) {
        throw new Error('refusing unsafe remote cleanup path');
      }
      await runProcess(
        'ssh',
        [...sshArguments(remote), remote.host, `rm -rf -- ${shellQuote(remoteDirectory)}`],
        {cwd: defaultRepoRoot},
      );
    },
    async cleanup(path) {
      await rm(path, {force: true, recursive: true});
    },
    write(message) {
      process.stdout.write(`[release-server] ${message}\n`);
    },
  };
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
}

function sshArguments(remote) {
  return ['-p', String(remote.port), '-i', remote.identityFile, '-o', 'BatchMode=yes'];
}

function runProcess(command, args, {captureOutput = false, cwd, env = {}, input} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: {...process.env, ...env},
      shell: false,
      stdio: input !== undefined
        ? ['pipe', captureOutput ? 'pipe' : 'inherit', captureOutput ? 'pipe' : 'inherit']
        : captureOutput
          ? ['ignore', 'pipe', 'pipe']
          : 'inherit',
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', chunk => stdout.push(chunk));
    child.stderr?.on('data', chunk => stderr.push(chunk));
    if (input !== undefined) {
      child.stdin.end(input);
    }
    child.once('error', rejectPromise);
    child.once('exit', code => {
      if (code !== 0) {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
        return;
      }
      resolvePromise({
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployReleaseServer().catch(error => {
    process.stderr.write(`[release-server] ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
