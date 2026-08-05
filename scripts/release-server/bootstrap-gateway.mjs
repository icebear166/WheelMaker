import {spawn} from 'node:child_process';
import {mkdir, readFile, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from '../release/channel.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, '..', '..');
const DEFAULT_GATEWAY_HOME = '/srv/wheelmaker-release/gateway';

export function parseGatewayBootstrapArgs(args) {
  let start = false;
  for (const arg of args) {
    if (arg === '--start' && !start) {
      start = true;
      continue;
    }
    throw new Error(`unknown Gateway bootstrap option: ${arg}`);
  }
  return {start};
}

export function buildGatewayBootstrapScript({
  gatewayHome = DEFAULT_GATEWAY_HOME,
  start = false,
} = {}) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(gatewayHome)) {
    throw new Error('Gateway bootstrap home must be an absolute safe path');
  }
  const startCommand = start
    ? 'systemctl start wheelmaker-gateway.service'
    : 'echo "Gateway installed and enabled; start it after the legacy ingress is stopped"';
  return String.raw`#!/usr/bin/env bash
set -euo pipefail

source_sha="$1"
public_url="$2"
upload_dir="$3"
gateway_home="${gatewayHome}"

case "$source_sha" in
  *[!0-9a-f]*|'') echo "invalid source SHA" >&2; exit 1 ;;
esac
[ "$(printf '%s' "$source_sha" | wc -c)" -eq 40 ] || { echo "invalid source SHA length" >&2; exit 1; }
case "$public_url" in
  https://* ) ;;
  *) echo "Gateway public URL must use HTTPS" >&2; exit 1 ;;
esac
[ "$upload_dir" = "/tmp/wheelmaker-gateway-$source_sha" ] || { echo "invalid upload directory" >&2; exit 1; }
trap 'rm -rf -- "$upload_dir"' EXIT

[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] || {
  echo "Gateway bootstrap requires Linux/amd64" >&2
  exit 1
}
id -u wheelmaker-release >/dev/null 2>&1 || {
  echo "wheelmaker-release must be installed before Gateway bootstrap" >&2
  exit 1
}

install -d -o wheelmaker-release -g wheelmaker-release -m 0750 "$gateway_home"
install -d -o wheelmaker-release -g wheelmaker-release -m 0750 \
  "$gateway_home/bin" "$gateway_home/sites" "$gateway_home/generated" \
  "$gateway_home/state" "$gateway_home/data" "$gateway_home/logs" \
  "$gateway_home/downloads" "$gateway_home/rollback"
install -o wheelmaker-release -g wheelmaker-release -m 0755 \
  "$upload_dir/wheelmaker-gateway" "$gateway_home/bin/wheelmaker-gateway.next"
mv -f "$gateway_home/bin/wheelmaker-gateway.next" "$gateway_home/bin/wheelmaker-gateway"

install -d -o root -g root -m 0755 /etc/wheelmaker-gateway
home_tmp="/etc/wheelmaker-gateway/.home-$source_sha.tmp"
printf '%s\n' "$gateway_home" > "$home_tmp"
chown root:root "$home_tmp"
chmod 0644 "$home_tmp"
mv -f "$home_tmp" /etc/wheelmaker-gateway/home

site_tmp="$gateway_home/sites/.release-server-$source_sha.tmp"
printf '{"schema":1,"kind":"release-server","publicUrl":"%s","publicRoot":"/srv/wheelmaker-release/public","upstream":"http://127.0.0.1:9680","tls":{"certificateFile":"","keyFile":""}}\n' "$public_url" > "$site_tmp"
chown wheelmaker-release:wheelmaker-release "$site_tmp"
chmod 0600 "$site_tmp"
mv -f "$site_tmp" "$gateway_home/sites/release-server.json"

"$gateway_home/bin/wheelmaker-gateway" validate --home "$gateway_home"
"$gateway_home/bin/wheelmaker-gateway" render --home "$gateway_home"

unit_tmp="/etc/systemd/system/wheelmaker-gateway.service.$source_sha.tmp"
cat > "$unit_tmp" <<EOF
[Unit]
Description=WheelMaker Gateway (embedded Caddy)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wheelmaker-release
Group=wheelmaker-release
WorkingDirectory=$gateway_home
ExecStart=$gateway_home/bin/wheelmaker-gateway serve --home $gateway_home
Restart=always
RestartSec=3s
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$gateway_home
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
install -o root -g root -m 0644 "$unit_tmp" /etc/systemd/system/wheelmaker-gateway.service
rm -f -- "$unit_tmp"

cat > "$gateway_home/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
  exec systemctl start wheelmaker-gateway.service
fi
exec sudo systemctl start wheelmaker-gateway.service
EOF
cat > "$gateway_home/stop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
  exec systemctl stop wheelmaker-gateway.service
fi
exec sudo systemctl stop wheelmaker-gateway.service
EOF
chown wheelmaker-release:wheelmaker-release "$gateway_home/start.sh" "$gateway_home/stop.sh"
chmod 0750 "$gateway_home/start.sh" "$gateway_home/stop.sh"

systemctl daemon-reload
systemctl enable wheelmaker-gateway.service
${startCommand}
`;
}

export async function bootstrapGateway(dependencies = createDefaultDependencies()) {
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
    throw new Error('Gateway bootstrap requires a full source SHA');
  }
  const workRoot = join(
    dependencies.repoRoot,
    '.release-work',
    'tmp',
    `gateway-bootstrap-${source.sha}`,
  );
  const remoteDirectory = `/tmp/wheelmaker-gateway-${source.sha}`;
  try {
    if (!source.clean) {
      throw new Error('Gateway bootstrap requires a clean source tree');
    }
    dependencies.write('Checking local Gateway bootstrap tools');
    await dependencies.ensureTools(['go', 'ssh', 'scp']);
    dependencies.write(`Checking ${remote.host} architecture`);
    const platform = await dependencies.checkRemote(remote);
    if (platform.operatingSystem !== 'Linux' || platform.architecture !== 'amd64') {
      throw new Error(
        `Gateway bootstrap requires remote Linux/amd64, received ${platform.operatingSystem}/${platform.architecture}`,
      );
    }

    const binaryPath = join(workRoot, 'wheelmaker-gateway');
    dependencies.write(`Building Gateway from ${source.sha}`);
    await dependencies.build({binaryPath, sourceSha: source.sha, workRoot});
    dependencies.write(`Uploading Gateway to ${remote.host}`);
    await dependencies.upload({
      files: [binaryPath],
      remote,
      remoteDirectory,
    });
    dependencies.write('Installing Gateway service and release-server site configuration');
    await dependencies.install({
      publicUrl: origin.origin,
      remote,
      remoteDirectory,
      script: buildGatewayBootstrapScript({start: dependencies.start === true}),
      sourceSha: source.sha,
    });
    dependencies.write(
      dependencies.start === true
        ? 'Gateway bootstrap completed and Gateway started'
        : 'Gateway bootstrap completed; start it after disabling the legacy ingress',
    );
    return {host: remote.host, sourceSha: source.sha};
  } finally {
    await dependencies.cleanupRemote?.(remote, remoteDirectory).catch(() => {});
    await dependencies.cleanup(workRoot);
  }
}

export function createDefaultDependencies(options = parseGatewayBootstrapArgs(process.argv.slice(2))) {
  return {
    start: options.start,
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
        ['build', '-trimpath', '-o', binaryPath, './cmd/wheelmaker-gateway'],
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
    async cleanupRemote(remote, remoteDirectory) {
      if (!/^\/tmp\/wheelmaker-gateway-[0-9a-f]{40}$/.test(remoteDirectory)) {
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
      process.stdout.write(`[gateway-bootstrap] ${message}\n`);
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
  bootstrapGateway().catch(error => {
    process.stderr.write(`[gateway-bootstrap] ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
