import { mkdir, chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const SERVICE_NAME = 'wheelmaker-gateway';
const WINDOWS_TASK_NAME = 'WheelMakerGateway';
const DARWIN_LABEL = 'com.wheelmaker.gateway';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `\"'\"'`)}'`;
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function systemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function gatewayRuntimePaths({
  gatewayHome,
  gatewayBinary,
  nodePath = process.execPath,
  userHome = homedir(),
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
}) {
  if (!gatewayHome || !gatewayBinary) {
    throw new Error('Gateway home and binary are required');
  }
  return {
    home: gatewayHome,
    binary: gatewayBinary,
    config: join(gatewayHome, 'generated', 'caddy.json'),
    node: nodePath,
    serviceName: SERVICE_NAME,
    serviceUnit: `${SERVICE_NAME}.service`,
    taskName: WINDOWS_TASK_NAME,
    plistLabel: DARWIN_LABEL,
    plist: join(userHome ?? '', 'Library', 'LaunchAgents', `${DARWIN_LABEL}.plist`),
    uid,
    userHome,
  };
}

export function windowsGatewayRuntimePlan(paths) {
  const home = psQuote(paths.home);
  const binary = psQuote(paths.binary);
  const currentUser = '$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name';
  const taskScript = `$ErrorActionPreference = 'Stop'
${currentUser}
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute ${binary} -Argument ${psQuote(`serve --home ${paths.home}`)} -WorkingDirectory ${home}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
Register-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}'
`;
  const encoded = Buffer.from(taskScript, 'utf16le').toString('base64');
  const script = `$ErrorActionPreference = 'Stop'
$taskScript = @'
${taskScript}
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskScript))
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "elevated Gateway task registration failed with exit code $($process.ExitCode)" }`;
  return { names: [WINDOWS_TASK_NAME], script };
}

export function linuxGatewayRuntimeFiles(paths) {
  return {
    [paths.serviceUnit ?? `${SERVICE_NAME}.service`]: `[Unit]
Description=WheelMaker Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${paths.home}
ExecStart=${systemdQuote(paths.binary)} serve --home ${systemdQuote(paths.home)}
Restart=always
RestartSec=5
Environment=HOME=${systemdQuote(paths.userHome ?? '')}

[Install]
WantedBy=default.target
`,
  };
}

function launchAgentPlist(paths) {
  const args = [paths.binary, 'serve', '--home', paths.home]
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(paths.plistLabel ?? DARWIN_LABEL)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.home)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

export function darwinGatewayRuntimeFiles(paths) {
  return {
    [`${paths.plistLabel ?? DARWIN_LABEL}.plist`]: launchAgentPlist(paths),
  };
}

export function gatewayWrapperFiles(paths, platform = process.platform) {
  const unit = paths.serviceUnit ?? `${SERVICE_NAME}.service`;
  if (platform === 'win32') {
    return {
      'start.bat': `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}'"\r\n`,
      'stop.bat': `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -ErrorAction SilentlyContinue"\r\n`,
    };
  }
  if (platform === 'linux') {
    return {
      'start.sh': `#!/bin/sh\nset -eu\nexec systemctl --user start ${shellQuote(unit)}\n`,
      'stop.sh': `#!/bin/sh\nset -eu\nexec systemctl --user stop ${shellQuote(unit)}\n`,
    };
  }
  if (platform === 'darwin') {
    const target = `gui/${paths.uid}/${paths.plistLabel ?? DARWIN_LABEL}`;
    return {
      'start.sh': `#!/bin/sh\nset -eu\nexec launchctl kickstart -k ${shellQuote(target)}\n`,
      'stop.sh': `#!/bin/sh\nset -eu\nexec launchctl kill SIGTERM ${shellQuote(target)}\n`,
    };
  }
  throw new Error(`unsupported Gateway runtime platform: ${platform}`);
}

async function atomicWrite(path, body, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.${process.pid}.tmp`);
  await writeFile(temporary, body, { mode });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function windowsActionScript(action) {
  if (action === 'start') {
    return `Start-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -ErrorAction Stop`;
  }
  if (action === 'stop') {
    return `Stop-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -ErrorAction SilentlyContinue`;
  }
  throw new Error(`unsupported Gateway Windows action: ${action}`);
}

export function createGatewayRuntimeAdapter({
  paths,
  platform = process.platform,
  runner,
  fetchImpl = globalThis.fetch,
  environment = process.env,
}) {
  if (!paths?.home || !paths?.binary) {
    throw new Error('Gateway runtime paths are required');
  }
  const run = runner ?? (async () => ({ code: 0, stderr: '', stdout: '' }));

  async function install() {
    const wrappers = gatewayWrapperFiles(paths, platform);
    for (const [name, body] of Object.entries(wrappers)) {
      const wrapperPath = join(paths.home, name);
      await atomicWrite(wrapperPath, body, 0o755);
      if (platform !== 'win32') await chmod(wrapperPath, 0o755);
    }
    if (platform === 'win32') {
      const plan = windowsGatewayRuntimePlan(paths);
      await run('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        plan.script,
      ], { cwd: paths.home });
      return;
    }
    if (platform === 'linux') {
      const directory = join(environment.XDG_CONFIG_HOME ?? join(paths.userHome, '.config'), 'systemd', 'user');
      const files = linuxGatewayRuntimeFiles(paths);
      for (const [name, body] of Object.entries(files)) {
        await atomicWrite(join(directory, name), body, 0o644);
      }
      // Release Server discovery uses this host-level record instead of
      // guessing a different user's HOME during a root SSH deployment.
      await run('sudo', ['install', '-d', '-m', '0755', '/etc/wheelmaker-gateway']);
      await run('sudo', [
        'sh',
        '-c',
        `printf '%s\\n' ${shellQuote(paths.home)} > /etc/wheelmaker-gateway/home`,
      ]);
      const runtimeUser = environment.USER ?? environment.USERNAME;
      if (runtimeUser) {
        await run('sudo', ['loginctl', 'enable-linger', runtimeUser]);
      }
      await run('sudo', ['setcap', 'cap_net_bind_service=+ep', paths.binary]);
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', paths.serviceUnit ?? `${SERVICE_NAME}.service`]);
      await run('systemctl', ['--user', 'start', paths.serviceUnit ?? `${SERVICE_NAME}.service`]);
      return;
    }
    if (platform === 'darwin') {
      const directory = join(paths.userHome, 'Library', 'LaunchAgents');
      const files = darwinGatewayRuntimeFiles(paths);
      for (const [name, body] of Object.entries(files)) {
        await atomicWrite(join(directory, name), body, 0o644);
      }
      const domain = `gui/${paths.uid}`;
      await run('launchctl', ['bootout', `${domain}/${paths.plistLabel ?? DARWIN_LABEL}`], { allowFailure: true });
      await run('launchctl', ['bootstrap', domain, join(directory, `${paths.plistLabel ?? DARWIN_LABEL}.plist`)]);
      await run('launchctl', ['kickstart', '-k', `${domain}/${paths.plistLabel ?? DARWIN_LABEL}`]);
      return;
    }
    throw new Error(`unsupported Gateway runtime platform: ${platform}`);
  }

  async function action(name) {
    if (!['start', 'stop', 'restart'].includes(name)) {
      throw new Error(`unknown Gateway runtime action: ${name}`);
    }
    if (platform === 'win32') {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsActionScript(name === 'restart' ? 'stop' : name)], { cwd: paths.home, allowFailure: name === 'stop' });
      if (name === 'restart') {
        await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsActionScript('start')], { cwd: paths.home });
      }
      return;
    }
    if (platform === 'linux') {
      const unit = paths.serviceUnit ?? `${SERVICE_NAME}.service`;
      if (name === 'restart') {
        await run('systemctl', ['--user', 'restart', unit]);
      } else {
        await run('systemctl', ['--user', name, unit], { allowFailure: name === 'stop' });
      }
      return;
    }
    if (platform === 'darwin') {
      const target = `gui/${paths.uid}/${paths.plistLabel ?? DARWIN_LABEL}`;
      if (name === 'start' || name === 'restart') {
        await run('launchctl', ['kickstart', '-k', target]);
      } else {
        await run('launchctl', ['kill', 'SIGTERM', target], { allowFailure: true });
      }
      return;
    }
    throw new Error(`unsupported Gateway runtime platform: ${platform}`);
  }

  async function reload(configBytes) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Gateway reload requires fetch');
    }
    const body = configBytes === undefined
      ? await readFile(paths.config)
      : configBytes;
    const response = await fetchImpl('http://127.0.0.1:2019/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(body).toString('utf8'),
    });
    if (!response.ok) {
      const detail = typeof response.text === 'function' ? await response.text() : '';
      throw new Error(`Gateway reload failed (${response.status}): ${detail}`.trim());
    }
  }

  async function health() {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Gateway health check requires fetch');
    }
    const response = await fetchImpl('http://127.0.0.1:2019/config/', {
      method: 'GET',
    });
    if (!response.ok) {
      const detail = typeof response.text === 'function' ? await response.text() : '';
      throw new Error(`Gateway health check failed (${response.status}): ${detail}`.trim());
    }
  }

  async function isRunning() {
    if (platform === 'win32') {
      const result = await run('powershell', ['-NoProfile', '-Command', `if ((Get-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -ErrorAction SilentlyContinue).State -eq 'Running') { exit 0 } else { exit 1 }`], { allowFailure: true });
      return result.code === 0;
    }
    if (platform === 'linux') {
      const result = await run('systemctl', ['--user', 'is-active', '--quiet', paths.serviceUnit ?? `${SERVICE_NAME}.service`], { allowFailure: true });
      return result.code === 0;
    }
    if (platform === 'darwin') {
      const result = await run('launchctl', ['print', `gui/${paths.uid}/${paths.plistLabel ?? DARWIN_LABEL}`], { allowFailure: true });
      return result.code === 0;
    }
    throw new Error(`unsupported Gateway runtime platform: ${platform}`);
  }

  return {
    install,
    start: () => action('start'),
    stop: () => action('stop'),
    restart: () => action('restart'),
    reload,
    health,
    isRunning,
  };
}
