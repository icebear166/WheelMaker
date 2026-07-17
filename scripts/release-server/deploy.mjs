import {spawn} from 'node:child_process';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from '../release/channel.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, '..', '..');

export async function deployReleaseServer(dependencies = createDefaultDependencies()) {
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
    user: 'root',
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
      join(templateRoot, 'nginx-bootstrap.conf'),
      join(templateRoot, 'nginx.conf'),
      join(templateRoot, 'wheelmaker-release-server.service'),
      join(templateRoot, 'index.html'),
    ];
    dependencies.write(`Uploading release server files to ${remote.host}`);
    await dependencies.upload({files, remote, remoteDirectory});
    dependencies.write('Installing release server, Nginx, and systemd configuration');
    await dependencies.install({
      domain: origin.hostname,
      remote,
      remoteDirectory,
      script: buildRemoteInstallScript(),
      sourceSha: source.sha,
    });
    const healthURL = `${channel.baseUrl}/healthz`;
    dependencies.write(`Checking ${healthURL}`);
    await dependencies.health(healthURL);
    dependencies.write(`Release server deployed from ${source.sha}`);
    return {host: remote.host, sourceSha: source.sha};
  } finally {
    await dependencies.cleanupRemote?.(remote, remoteDirectory).catch(() => {});
    await dependencies.cleanup(workRoot);
  }
}

export function buildRemoteInstallScript() {
  return String.raw`#!/usr/bin/env bash
set -euo pipefail

source_sha="$1"
domain="$2"
upload_dir="$3"

case "$source_sha" in
  *[!0-9a-f]*|'') echo "invalid source SHA" >&2; exit 1 ;;
esac
[ "$(printf '%s' "$source_sha" | wc -c)" -eq 40 ] || { echo "invalid source SHA length" >&2; exit 1; }
[ "$domain" = "release.wheelmaker.top" ] || { echo "invalid release domain" >&2; exit 1; }
[ "$upload_dir" = "/tmp/wheelmaker-release-server-$source_sha" ] || { echo "invalid upload directory" >&2; exit 1; }
trap 'rm -rf -- "$upload_dir"' EXIT

[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] || {
  echo "release server requires Linux/amd64" >&2
  exit 1
}

if ! id -u wheelmaker-release >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin wheelmaker-release
fi
getent group www-data >/dev/null

install -d -o wheelmaker-release -g www-data -m 0750 /srv/wheelmaker-release
install -d -o wheelmaker-release -g www-data -m 2750 /srv/wheelmaker-release/public
install -d -o wheelmaker-release -g wheelmaker-release -m 0700 /srv/wheelmaker-release/staging /srv/wheelmaker-release/data
install -d -o root -g wheelmaker-release -m 2750 /etc/wheelmaker-release-server
install -d -o root -g root -m 0755 /opt/wheelmaker-release-server/versions

if [ ! -f /etc/wheelmaker-release-server/config.json ]; then
  config_tmp="/etc/wheelmaker-release-server/.config-$source_sha.tmp"
  printf '%s\n' '{"schema":1,"listen":"127.0.0.1:9680","dataRoot":"/srv/wheelmaker-release","tokenSha256":""}' > "$config_tmp"
  chown root:wheelmaker-release "$config_tmp"
  chmod 0640 "$config_tmp"
  mv -f "$config_tmp" /etc/wheelmaker-release-server/config.json
fi
chown root:wheelmaker-release /etc/wheelmaker-release-server/config.json
chmod 0640 /etc/wheelmaker-release-server/config.json

version_dir="/opt/wheelmaker-release-server/versions/$source_sha"
install -d -o root -g root -m 0755 "$version_dir"
install -o root -g root -m 0755 "$upload_dir/wheelmaker-release-server" "$version_dir/wheelmaker-release-server"
ln -sfn "versions/$source_sha" /opt/wheelmaker-release-server/current.next
mv -Tf /opt/wheelmaker-release-server/current.next /opt/wheelmaker-release-server/current

install -o root -g root -m 0644 "$upload_dir/wheelmaker-release-server.service" /etc/systemd/system/wheelmaker-release-server.service
install -o wheelmaker-release -g www-data -m 0644 "$upload_dir/index.html" /srv/wheelmaker-release/public/index.html
systemctl daemon-reload
systemctl enable wheelmaker-release-server.service
systemctl restart wheelmaker-release-server.service

site_available="/etc/nginx/sites-available/$domain"
site_enabled="/etc/nginx/sites-enabled/$domain"
if [ ! -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]; then
  install -o root -g root -m 0644 "$upload_dir/nginx-bootstrap.conf" "$site_available"
  ln -sfn "$site_available" "$site_enabled"
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot --non-interactive --agree-tos --webroot-path /srv/wheelmaker-release/public --domain "$domain"
fi
install -o root -g root -m 0644 "$upload_dir/nginx.conf" "$site_available"
ln -sfn "$site_available" "$site_enabled"
nginx -t
systemctl reload nginx
health_ready=0
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error "https://$domain/healthz" >/dev/null; then
    health_ready=1
    break
  fi
  sleep 1
done
[ "$health_ready" -eq 1 ] || { echo "release server HTTPS health check timed out" >&2; exit 1; }
`;
}

export function createDefaultDependencies() {
  return {
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
        [...sshArguments(remote), `${remote.user}@${remote.host}`, 'uname -s && uname -m'],
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
        [...sshArguments(remote), `${remote.user}@${remote.host}`, `install -d -m 0700 ${remoteDirectory}`],
        {cwd: defaultRepoRoot},
      );
      await runProcess(
        'scp',
        [
          '-P', String(remote.port),
          '-i', remote.identityFile,
          '--',
          ...files,
          `${remote.user}@${remote.host}:${remoteDirectory}/`,
        ],
        {cwd: defaultRepoRoot},
      );
    },
    async install({domain, remote, remoteDirectory, script, sourceSha}) {
      await runProcess(
        'ssh',
        [
          ...sshArguments(remote),
          `${remote.user}@${remote.host}`,
          `bash -s -- ${sourceSha} ${domain} ${remoteDirectory}`,
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
        [...sshArguments(remote), `${remote.user}@${remote.host}`, `rm -rf -- ${remoteDirectory}`],
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
