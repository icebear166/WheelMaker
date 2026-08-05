import {spawn} from 'node:child_process';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from '../release/channel.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, '..', '..');

export function parseReleaseServerArgs(args) {
  let legacyNginx = false;
  for (const arg of args) {
    if (arg === '--legacy-nginx' && !legacyNginx) {
      legacyNginx = true;
      continue;
    }
    throw new Error(`unknown release server option: ${arg}`);
  }
  return {legacyNginx};
}

export async function deployReleaseServer(dependencies = createDefaultDependencies()) {
  const legacyNginx = dependencies.legacyNginx === true;
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
      join(templateRoot, 'wheelmaker-release-server.service'),
      join(templateRoot, 'index.html'),
      join(templateRoot, 'release-home.js'),
    ];
    dependencies.write(`Uploading release server files to ${remote.host}`);
    await dependencies.upload({files, remote, remoteDirectory});
    dependencies.write(
      legacyNginx
        ? 'Installing release server behind the existing legacy Nginx ingress'
        : 'Installing release server and systemd configuration; validating Gateway site',
    );
    await dependencies.install({
      domain: origin.hostname,
      remote,
      remoteDirectory,
      script: buildRemoteInstallScript({legacyNginx}),
      sourceSha: source.sha,
      publicUrl: origin.origin,
    });
    const healthURL = `${channel.baseUrl}/healthz`;
    dependencies.write(`Checking ${healthURL}`);
    try {
      await dependencies.health(healthURL);
    } catch (error) {
      // Public HTTPS is informational when the independently managed Gateway
      // is stopped or DNS is not yet pointed at this host. The remote script
      // already verified the Release Server loopback health endpoint.
      dependencies.write(`Public Gateway health is not ready yet: ${error.message}`);
    }
    dependencies.write(`Release server deployed from ${source.sha}`);
    return {host: remote.host, sourceSha: source.sha};
  } finally {
    await dependencies.cleanupRemote?.(remote, remoteDirectory).catch(() => {});
    await dependencies.cleanup(workRoot);
  }
}

export function buildRemoteInstallScript({legacyNginx = false} = {}) {
  const gatewayPreparation = legacyNginx
    ? String.raw`# Legacy Nginx ingress remains in place; this one-time mode only upgrades
# the loopback Release Server and never installs or inspects Gateway.
`
    : String.raw`# Gateway is a separately installed host service. Release Server deployment
# discovers its fixed home from the installer metadata and never installs,
# starts, stops, or upgrades that service.
gateway_meta="/etc/wheelmaker-gateway/home"
if [ ! -r "$gateway_meta" ]; then
  echo "WheelMaker Gateway is not installed; run the explicit Gateway deployment first" >&2
  exit 1
fi
gateway_home="$(cat "$gateway_meta")"
case "$gateway_home" in
  /*) ;;
  *) echo "Gateway metadata contains an invalid home" >&2; exit 1 ;;
esac
gateway_binary="$gateway_home/bin/wheelmaker-gateway"
[ -x "$gateway_binary" ] || { echo "Gateway binary is missing at $gateway_binary; run the explicit Gateway deployment first" >&2; exit 1; }
gateway_user="$(stat -c '%U' "$gateway_home" 2>/dev/null || stat -f '%Su' "$gateway_home")"
[ -n "$gateway_user" ] && [ "$gateway_user" != "root" ] || { echo "Gateway metadata must identify a non-root runtime user" >&2; exit 1; }
gateway_group="$(id -gn "$gateway_user")"
gateway_paths_json="$($gateway_binary paths --home "$gateway_home")"
printf '%s' "$gateway_paths_json" | grep -F '"home"' >/dev/null || { echo "Gateway paths command returned invalid metadata" >&2; exit 1; }
`;
  const gatewayConfiguration = legacyNginx
    ? String.raw`# Keep the existing Nginx configuration and certificates untouched during
# the protocol migration. A later explicit Gateway bootstrap writes its own
# semantic release-server site.
`
    : String.raw`# Grant only directory traversal/read access to the Gateway runtime user. Do
# not make the release tree world-readable and do not change its owner.
if command -v setfacl >/dev/null 2>&1; then
  setfacl -m "u:$gateway_user:rx" /srv/wheelmaker-release /srv/wheelmaker-release/public
else
  [ "$gateway_user" = "wheelmaker-release" ] || {
    echo "setfacl is required to grant Gateway read access to the release tree" >&2
    exit 1
  }
fi

gateway_sites="$gateway_home/sites"
install -d -o "$gateway_user" -g "$gateway_group" -m 0750 "$gateway_sites"
gateway_site_tmp="$gateway_sites/.release-server-$source_sha.tmp"
printf '{"schema":1,"kind":"release-server","publicUrl":"%s","publicRoot":"/srv/wheelmaker-release/public","upstream":"http://127.0.0.1:9680","tls":{"certificateFile":"","keyFile":""}}\n' "$public_url" > "$gateway_site_tmp"
chown "$gateway_user:$gateway_group" "$gateway_site_tmp"
chmod 0600 "$gateway_site_tmp"
mv -f "$gateway_site_tmp" "$gateway_sites/release-server.json"
"$gateway_binary" validate --home "$gateway_home"
"$gateway_binary" render --home "$gateway_home"
`;
  const gatewayReload = legacyNginx
    ? String.raw`# The legacy Nginx ingress continues serving the existing public tree;
# do not reload or stop it as part of this server-only upgrade.
`
    : String.raw`# If Gateway is running, apply the generated config through its local admin
# endpoint. If it is stopped, leave it stopped; the new site applies on the
# next explicit Gateway start.
if curl --fail --silent http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
  curl --fail --silent --show-error -X POST -H 'Content-Type: application/json' \
    --data-binary @"$gateway_home/generated/caddy.json" \
    http://127.0.0.1:2019/load >/dev/null
else
  echo "Gateway is stopped; release-server.json will apply on the next manual Gateway start" >&2
fi
`;
  return String.raw`#!/usr/bin/env bash
set -euo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"

case "$source_sha" in
  *[!0-9a-f]*|'') echo "invalid source SHA" >&2; exit 1 ;;
esac
[ "$(printf '%s' "$source_sha" | wc -c)" -eq 40 ] || { echo "invalid source SHA length" >&2; exit 1; }
case "$public_url" in
  https://* ) ;;
  *) echo "release server public URL must use HTTPS" >&2; exit 1 ;;
esac
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

${gatewayPreparation}

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
install -o wheelmaker-release -g www-data -m 0644 "$upload_dir/release-home.js" /srv/wheelmaker-release/public/release-home.js

${gatewayConfiguration}

systemctl daemon-reload
systemctl enable wheelmaker-release-server.service
systemctl restart wheelmaker-release-server.service

health_ready=0
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error http://127.0.0.1:9680/healthz >/dev/null; then
    health_ready=1
    break
  fi
  sleep 1
done
[ "$health_ready" -eq 1 ] || { echo "release server loopback health check timed out" >&2; exit 1; }

${gatewayReload}
`;
}

export function createDefaultDependencies(options = parseReleaseServerArgs(process.argv.slice(2))) {
  return {
    legacyNginx: options.legacyNginx,
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
    async install({publicUrl, remote, remoteDirectory, script, sourceSha}) {
      await runProcess(
        'ssh',
        [
          ...sshArguments(remote),
          `${remote.user}@${remote.host}`,
          `bash -s -- ${sourceSha} ${publicUrl} ${remoteDirectory}`,
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
