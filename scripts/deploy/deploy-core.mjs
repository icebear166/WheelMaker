import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  access,
  chmod,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

import { isIP } from 'node:net';
import { createInterface } from 'node:readline/promises';

const BLOCK_SIZE = 512;
const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;
const STALE_LEASE_MS = 2 * 60 * 60 * 1000;
const STATUS_STATES = new Set([
  'applying',
  'downloading',
  'failed',
  'queued',
  'restarting',
  'succeeded',
  'verifying',
]);
const TERMINAL_STATES = new Set(['failed', 'succeeded']);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateJobId(jobId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId ?? '')) {
    throw new Error(`invalid update job ID: ${jobId}`);
  }
}

function normalizeTime(value) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`invalid update timestamp: ${value}`);
  }
  return new Date(milliseconds).toISOString();
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, bytes, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${randomUUID()}.${process.pid}.tmp`,
  );
  await writeFile(temporaryPath, bytes, { mode });
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function statusRecord(status, existing) {
  validateJobId(status.jobId);
  if (!STATUS_STATES.has(status.state)) {
    throw new Error(`invalid update state: ${status.state}`);
  }
  const updatedAt = normalizeTime(status.now ?? new Date().toISOString());
  const startedAt = normalizeTime(
    status.startedAt ??
      (existing?.jobId === status.jobId ? existing.startedAt : updatedAt),
  );
  return {
    schema: 1,
    jobId: status.jobId,
    state: status.state,
    startedAt,
    updatedAt,
    ...(status.version ? { version: status.version } : {}),
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  };
}

export async function writeUpdateStatus(stateDirectory, status) {
  const statusPath = join(stateDirectory, 'status.json');
  const existing = await readJsonIfPresent(statusPath);
  const record = statusRecord(status, existing);
  await atomicWrite(statusPath, jsonBytes(record));
  return record;
}

async function tryCreateLease(stateDirectory, lease) {
  const lockPath = join(stateDirectory, 'lock.json');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }

  const startedAt = normalizeTime(lease.now ?? new Date().toISOString());
  const lock = {
    schema: 1,
    jobId: lease.jobId,
    owner: lease.owner,
    state: 'queued',
    startedAt,
    heartbeatAt: startedAt,
  };
  try {
    await handle.writeFile(jsonBytes(lock));
  } finally {
    await handle.close();
  }
  try {
    await writeUpdateStatus(stateDirectory, {
      jobId: lease.jobId,
      now: startedAt,
      startedAt,
      state: 'queued',
    });
  } catch (error) {
    await rm(lockPath, { force: true });
    throw error;
  }
  return true;
}

export async function acquireUpdateLease(
  stateDirectory,
  lease,
  { isUpdaterRunning = async () => false } = {},
) {
  validateJobId(lease.jobId);
  if (lease.owner !== 'web' && lease.owner !== 'timer') {
    throw new Error(`invalid update lease owner: ${lease.owner}`);
  }
  await mkdir(stateDirectory, { recursive: true });
  if (await tryCreateLease(stateDirectory, lease)) {
    return true;
  }

  const lockPath = join(stateDirectory, 'lock.json');
  const existing = await readJsonIfPresent(lockPath);
  if (!existing) {
    return tryCreateLease(stateDirectory, lease);
  }
  const nowMilliseconds = Date.parse(lease.now ?? new Date().toISOString());
  const heartbeatMilliseconds = Date.parse(existing.heartbeatAt ?? '');
  if (
    !Number.isFinite(nowMilliseconds) ||
    !Number.isFinite(heartbeatMilliseconds) ||
    nowMilliseconds - heartbeatMilliseconds <= STALE_LEASE_MS ||
    (await isUpdaterRunning())
  ) {
    return false;
  }

  const claimedPath = join(
    stateDirectory,
    `.stale-lock.${process.pid}.${randomUUID()}.json`,
  );
  try {
    await rename(lockPath, claimedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return tryCreateLease(stateDirectory, lease);
    }
    return false;
  }
  try {
    return await tryCreateLease(stateDirectory, lease);
  } finally {
    await rm(claimedPath, { force: true });
  }
}

export async function heartbeatUpdateLease(
  stateDirectory,
  jobId,
  now = new Date().toISOString(),
) {
  validateJobId(jobId);
  const lockPath = join(stateDirectory, 'lock.json');
  const lock = await readJsonIfPresent(lockPath);
  if (!lock || lock.jobId !== jobId) {
    return false;
  }
  lock.heartbeatAt = normalizeTime(now);
  await atomicWrite(lockPath, jsonBytes(lock));
  return true;
}

export async function finishUpdate(stateDirectory, status) {
  if (!TERMINAL_STATES.has(status.state)) {
    throw new Error(`update terminal state required: ${status.state}`);
  }
  const record = await writeUpdateStatus(stateDirectory, status);
  const lockPath = join(stateDirectory, 'lock.json');
  const lock = await readJsonIfPresent(lockPath);
  if (lock?.jobId === status.jobId) {
    await rm(lockPath, { force: true });
  }
  return record;
}

class StreamReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
  }

  async fill() {
    if (this.buffer.length || this.done) return;
    const next = await this.iterator.next();
    if (next.done) {
      this.done = true;
      return;
    }
    this.buffer = Buffer.from(next.value);
  }

  async readExact(length, allowEnd = false) {
    const output = Buffer.alloc(length);
    let written = 0;
    while (written < length) {
      await this.fill();
      if (!this.buffer.length) {
        if (allowEnd && written === 0) return null;
        throw new Error('unsafe tar entry: truncated archive');
      }
      const count = Math.min(length - written, this.buffer.length);
      this.buffer.copy(output, written, 0, count);
      this.buffer = this.buffer.subarray(count);
      written += count;
    }
    return output;
  }

  async writeExact(length, handle) {
    let remaining = length;
    while (remaining > 0) {
      await this.fill();
      if (!this.buffer.length) {
        throw new Error('unsafe tar entry: truncated file');
      }
      const count = Math.min(remaining, this.buffer.length);
      const chunk = this.buffer.subarray(0, count);
      await handle.writeFile(chunk);
      this.buffer = this.buffer.subarray(count);
      remaining -= count;
    }
  }

  async discard(length) {
    let remaining = length;
    while (remaining > 0) {
      await this.fill();
      if (!this.buffer.length) {
        throw new Error('unsafe tar entry: truncated padding');
      }
      const count = Math.min(remaining, this.buffer.length);
      this.buffer = this.buffer.subarray(count);
      remaining -= count;
    }
  }
}

function readTarText(bytes) {
  const nullIndex = bytes.indexOf(0);
  const value = bytes.subarray(0, nullIndex === -1 ? bytes.length : nullIndex);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('unsafe tar entry: invalid UTF-8');
  }
}

function readTarOctal(bytes, label) {
  if (bytes[0] & 0x80) {
    throw new Error(`unsafe tar entry: unsupported ${label}`);
  }
  const value = readTarText(bytes).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`unsafe tar entry: invalid ${label}`);
  }
  return Number.parseInt(value, 8);
}

function verifyTarChecksum(header) {
  const expected = readTarOctal(header.subarray(148, 156), 'checksum');
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) {
    throw new Error('unsafe tar entry: checksum mismatch');
  }
}

function safeTarDestination(root, rawName, type) {
  if (
    !rawName ||
    rawName.includes('\\') ||
    rawName.includes('\0') ||
    rawName.startsWith('/') ||
    /^[A-Za-z]:/.test(rawName) ||
    isAbsolute(rawName)
  ) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  const name = rawName.endsWith('/') ? rawName.slice(0, -1) : rawName;
  const parts = name.split('/');
  if (!name || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  if (type === '0' && rawName.endsWith('/')) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  const destination = resolve(root, ...parts);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (destination !== root && !destination.startsWith(rootPrefix)) {
    throw new Error(`unsafe tar entry: ${rawName}`);
  }
  return destination;
}

function inputStream(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return Readable.from([Buffer.from(input)]);
  }
  if (typeof input === 'string') {
    return createReadStream(input);
  }
  throw new Error('tar.zst input must be bytes or a file path');
}

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 15;

function assertNodeRuntime() {
  const [major, minor] = (process.versions.node || '0').split('.').map(Number);
  if (
    major < REQUIRED_NODE_MAJOR ||
    (major === REQUIRED_NODE_MAJOR && minor < REQUIRED_NODE_MINOR)
  ) {
    throw new Error(
      `WheelMaker requires Node.js ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}+ to decode the release archive (have ${process.versions.node}). ` +
        'Re-run the install command from https://release.wheelmaker.top/ to upgrade Node, then retry.',
    );
  }
}

export async function extractTarZst(
  input,
  targetDirectory,
  {
    maxContentBytes = DEFAULT_MAX_CONTENT_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  } = {},
) {
  assertNodeRuntime();
  const root = resolve(targetDirectory);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const decompress = createZstdDecompress();
  inputStream(input).pipe(decompress);
  const reader = new StreamReader(decompress);
  let entries = 0;
  let contentBytes = 0;

  try {
    for (;;) {
      const header = await reader.readExact(BLOCK_SIZE, true);
      if (!header) {
        throw new Error('unsafe tar entry: missing end marker');
      }
      if (header.every((byte) => byte === 0)) {
        return { contentBytes, entries };
      }
      entries += 1;
      if (entries > maxEntries) {
        throw new Error('archive limit exceeded: too many entries');
      }
      verifyTarChecksum(header);
      if (!readTarText(header.subarray(257, 263)).startsWith('ustar')) {
        throw new Error('unsafe tar entry: unsupported header');
      }
      const typeByte = header[156];
      const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
      if (type !== '0' && type !== '5') {
        throw new Error('unsafe tar entry: links and special files are forbidden');
      }
      const name = readTarText(header.subarray(0, 100));
      const prefix = readTarText(header.subarray(345, 500));
      const archiveName = prefix ? `${prefix}/${name}` : name;
      const size = readTarOctal(header.subarray(124, 136), 'size');
      const mode = readTarOctal(header.subarray(100, 108), 'mode') & 0o777;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error('unsafe tar entry: invalid size');
      }
      if (type === '5' && size !== 0) {
        throw new Error('unsafe tar entry: directory has content');
      }
      if (size > maxFileBytes || contentBytes + size > maxContentBytes) {
        throw new Error('archive limit exceeded: uncompressed content');
      }
      contentBytes += size;
      const destination = safeTarDestination(root, archiveName, type);

      if (type === '5') {
        await mkdir(destination, { recursive: true, mode: 0o755 });
        await chmod(destination, mode || 0o755);
      } else {
        await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
        const handle = await open(destination, 'wx', 0o644);
        try {
          await reader.writeExact(size, handle);
          await handle.chmod(mode || 0o644);
        } finally {
          await handle.close();
        }
      }
      const padding = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
      await reader.discard(padding);
    }
  } catch (error) {
    decompress.destroy();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function resolveReleasePath(baseUrl, path, label) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error('trusted release base URL is invalid');
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    baseUrl !== base.origin
  ) {
    throw new Error('trusted release base URL is invalid');
  }
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new Error(`${label} path is invalid`);
  }
  const url = new URL(path, `${base.origin}/`);
  if (url.origin !== base.origin) {
    throw new Error(`${label} path must stay on the trusted release origin`);
  }
  return url.href;
}

export function currentPlatformKey(
  platform = process.platform,
  architecture = process.arch,
) {
  const key = `${platform}/${architecture}`;
  if (key === 'win32/x64') return 'windows-amd64';
  if (key === 'linux/x64') return 'linux-amd64';
  if (key === 'darwin/x64') return 'darwin-amd64';
  if (key === 'darwin/arm64') return 'darwin-arm64';
  throw new Error(`unsupported deployment platform: ${key}`);
}

export async function stageVerifiedRelease({
  fetchBytes,
  jobId,
  onPhase = async () => {},
  platform = currentPlatformKey(),
  releaseBaseUrl,
  stable,
  stagingDirectory,
}) {
  validateJobId(jobId);
  if (
    ![
      'windows-amd64',
      'linux-amd64',
      'darwin-amd64',
      'darwin-arm64',
    ].includes(platform)
  ) {
    throw new Error(`unsupported deployment platform: ${platform}`);
  }
  const manifestUrl = resolveReleasePath(
    releaseBaseUrl,
    stable?.release?.manifestPath,
    'release manifest',
  );
  const manifestBytes = await fetchBytes(manifestUrl, {
    label: 'release manifest',
  });
  if (
    sha256Bytes(manifestBytes) !== stable.release.manifestSha256
  ) {
    throw new Error('release manifest SHA-256 verification failed');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.schema !== 2 ||
    manifest.version !== stable.version ||
    manifest.sourceSha !== stable.sourceSha
  ) {
    throw new Error('release manifest identity is invalid');
  }
  const artifact = manifest.artifacts?.[platform];
  if (
    !artifact ||
    !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '') ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0
  ) {
    throw new Error(`release artifact metadata is invalid: ${platform}`);
  }
  const artifactUrl = resolveReleasePath(
    releaseBaseUrl,
    artifact.path,
    'release artifact',
  );
  const archiveBytes = await fetchBytes(artifactUrl, {
    label: `${platform} release package`,
  });
  await onPhase('verifying');
  if (archiveBytes.length !== artifact.size) {
    throw new Error('release archive size verification failed');
  }
  if (sha256Bytes(archiveBytes) !== artifact.sha256) {
    throw new Error('release archive SHA-256 verification failed');
  }

  const extractionDirectory = join(stagingDirectory, jobId, 'package');
  const extraction = await extractTarZst(archiveBytes, extractionDirectory);
  return {
    artifact,
    extraction,
    extractionDirectory,
    manifest,
    manifestSha256: sha256Bytes(manifestBytes),
  };
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsBatchQuote(value) {
  return `"${String(value).replaceAll('%', '%%')}"`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function systemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function windowsElevatedPowerShellScript(script, { preserveRuntimeUser = false } = {}) {
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  const preserveUser = preserveRuntimeUser
    ? `$env:WHEELMAKER_RUNTIME_USER = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$runtimeUserLiteral = "'" + $env:WHEELMAKER_RUNTIME_USER.Replace("'", "''") + "'"
$childScript = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(${psQuote(encodedScript)}))
$childScript = '$currentUser = ' + $runtimeUserLiteral + [Environment]::NewLine + $childScript
$encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))`
    : `$encodedScript = ${psQuote(encodedScript)}`;
  return `$ErrorActionPreference = 'Stop'
${preserveUser}
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-EncodedCommand',
  $encodedScript
) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) {
  throw "elevated PowerShell failed with exit code $($process.ExitCode)"
}
`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function deploymentRuntimePaths({
  installDirectory,
  nodePath = process.execPath,
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
  userHome = homedir(),
}) {
  const home = resolve(installDirectory);
  const bin = join(home, 'bin');
  return {
    bin,
    deploy: join(home, 'deploy.mjs'),
    home,
    hub: join(bin, platform === 'win32' ? 'wheelmaker.exe' : 'wheelmaker'),
    node: nodePath,
    systemdEnv: join(home, 'systemd.env'),
    uid,
    userHome,
  };
}

export function windowsRuntimePlan(paths) {
  const names = ['WheelMaker', 'WheelMakerUpdater'];
  const updaterCommand = `& ${psQuote(paths.node)} ${psQuote(paths.deploy)} update\nexit $LASTEXITCODE`;
  const encodedUpdaterCommand = Buffer.from(updaterCommand, 'utf16le').toString('base64');
  const updaterArguments = `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodedUpdaterCommand}`;
  const script = `$ErrorActionPreference = 'Stop'
$currentUser = [string]$currentUser
if ([string]::IsNullOrWhiteSpace($currentUser)) {
  $currentUser = [Environment]::GetEnvironmentVariable('WHEELMAKER_RUNTIME_USER')
}
if ([string]::IsNullOrWhiteSpace($currentUser)) {
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
}
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -MultipleInstances IgnoreNew
$hubAction = New-ScheduledTaskAction -Execute ${psQuote(paths.hub)} -Argument '-d' -WorkingDirectory ${psQuote(paths.home)}
$hubTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
Register-ScheduledTask -TaskName 'WheelMaker' -Action $hubAction -Trigger $hubTrigger -Principal $principal -Settings $settings -Force | Out-Null
$updaterArguments = ${psQuote(updaterArguments)}
$updaterAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $updaterArguments -WorkingDirectory ${psQuote(paths.home)}
$updaterTrigger = New-ScheduledTaskTrigger -Daily -At '03:00'
Register-ScheduledTask -TaskName 'WheelMakerUpdater' -Action $updaterAction -Trigger $updaterTrigger -Principal $principal -Settings $settings -Force | Out-Null
`;
  return { names, script };
}

export function linuxRuntimeFiles(paths) {
  const environmentFile =
    paths.systemdEnv ?? `${paths.home.replace(/\/$/, '')}/systemd.env`;
  return {
    'wheelmaker-hub.service': `[Unit]
Description=WheelMaker Hub
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${paths.home}
EnvironmentFile=${environmentFile}
ExecStart=${systemdQuote(paths.hub)} -d
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
    'wheelmaker-updater.service': `[Unit]
Description=WheelMaker Updater
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${paths.home}
EnvironmentFile=${environmentFile}
ExecStart=${systemdQuote(paths.node)} ${systemdQuote(paths.deploy)} update
`,
    'wheelmaker-updater.timer': `[Unit]
Description=Run WheelMaker Updater daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=wheelmaker-updater.service

[Install]
WantedBy=timers.target
`,
  };
}

function launchAgentPlist({
  arguments: programArguments,
  calendar,
  keepAlive,
  label,
  paths,
}) {
  const argumentsXml = programArguments
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join('\n');
  const scheduleXml = calendar
    ? `  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${calendar.hour}</integer>
    <key>Minute</key>
    <integer>${calendar.minute}</integer>
  </dict>\n`
    : '';
  const keepAliveXml = keepAlive
    ? '  <key>KeepAlive</key>\n  <true/>\n  <key>RunAtLoad</key>\n  <true/>\n'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.home)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
${keepAliveXml}${scheduleXml}</dict>
</plist>
`;
}

export function darwinRuntimeFiles(paths) {
  return {
    'com.wheelmaker.hub.plist': launchAgentPlist({
      arguments: [paths.hub, '-d'],
      keepAlive: true,
      label: 'com.wheelmaker.hub',
      paths,
    }),
    'com.wheelmaker.updater.plist': launchAgentPlist({
      arguments: [paths.node, paths.deploy, 'update'],
      calendar: { hour: 3, minute: 0 },
      keepAlive: false,
      label: 'com.wheelmaker.updater',
      paths,
    }),
  };
}

export const DESKTOP_SELF_UPDATE_CAPABILITY =
  '@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1';

export function windowsWrappers(paths) {
  return {
    'deploy.bat': `@echo off\r\nsetlocal\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)}\r\nset "_EXIT_CODE=%errorlevel%"\r\necho.\r\npause\r\nexit /b %_EXIT_CODE%\r\n`,
    ...Object.fromEntries(
      ['start', 'stop'].map((action) => [
        `${action}.bat`,
        `@echo off\r\nsetlocal\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)} runtime ${action} %*\r\nexit /b %errorlevel%\r\n`,
      ]),
    ),
    'update_exe.bat': `${DESKTOP_SELF_UPDATE_CAPABILITY}\r\n@echo off\r\nsetlocal\r\nif "%~1"=="" goto manual_update\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)} desktop-self-update --parent-pid "%~1"\r\nset "_EXIT_CODE=%errorlevel%"\r\ngoto update_finished\r\n:manual_update\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)} desktop-update\r\nset "_EXIT_CODE=%errorlevel%"\r\n:update_finished\r\necho.\r\nif "%_EXIT_CODE%"=="0" (\r\n  echo Desktop update completed. Close this window and start WheelMakerDesktop.exe manually.\r\n) else (\r\n  echo Desktop update failed with exit code %_EXIT_CODE%. Review the log above.\r\n)\r\necho.\r\npause\r\nexit /b %_EXIT_CODE%\r\n`,
  };
}

async function writeWindowsDesktopUpdateWrapper(paths) {
  const body = windowsWrappers(paths)['update_exe.bat'];
  const path = join(paths.home, 'update_exe.bat');
  await atomicWrite(path, Buffer.from(body, 'utf8'), 0o644);
  await chmod(path, 0o644);
}

export function unixWrappers(paths) {
  return {
    'deploy.sh': `#!/bin/sh\nset -eu\nexec ${shellQuote(paths.node)} ${shellQuote(paths.deploy)}\n`,
    ...Object.fromEntries(
      ['start', 'stop'].map((action) => [
        `${action}.sh`,
        `#!/bin/sh\nset -eu\nexec ${shellQuote(paths.node)} ${shellQuote(paths.deploy)} runtime ${action} "$@"\n`,
      ]),
    ),
  };
}

const RETIRED_LIFECYCLE_WRAPPERS = [
  'restart.bat',
  'restart.sh',
  'status.bat',
  'status.sh',
];

async function removeRetiredLifecycleWrappers(home) {
  for (const name of RETIRED_LIFECYCLE_WRAPPERS) {
    await rm(join(home, name), { force: true });
  }
}

async function writeRuntimeWrappers(paths, platform) {
  const useWindows = platform === 'win32';
  const active = useWindows ? windowsWrappers(paths) : unixWrappers(paths);
  const staleNames = useWindows
    ? ['deploy.sh', 'start.sh', 'stop.sh']
    : ['deploy.bat', 'start.bat', 'stop.bat', 'update_exe.bat'];
  await mkdir(paths.home, { recursive: true });
  await removeRetiredLifecycleWrappers(paths.home);
  for (const name of staleNames) {
    await rm(join(paths.home, name), { force: true });
  }
  for (const [name, body] of Object.entries(active)) {
    const mode = useWindows ? 0o644 : 0o755;
    await atomicWrite(join(paths.home, name), Buffer.from(body, 'utf8'), mode);
    await chmod(join(paths.home, name), mode);
  }
}

async function runProcess(
  command,
  args,
  { allowFailure = false, cwd, env = process.env } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      const result = {
        code: code ?? -1,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      };
      if (code === 0 || allowFailure) {
        resolvePromise(result);
        return;
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`}): ${result.stderr}`,
        ),
      );
    });
  });
}

export function windowsLegacyMigrationScript(paths) {
  return `$ErrorActionPreference = 'Stop'
$runtimeNames = @('WheelMaker', 'WheelMakerUpdater', 'WheelMakerMonitor')
$legacyBinaries = @(
  'wheelmaker.exe',
  'wheelmaker-updater.exe',
  'wheelmaker-deploy.exe',
  'wheelmaker-monitor.exe'
)
$targetBinRoot = ([System.IO.Path]::GetFullPath(${psQuote(paths.bin)}).TrimEnd('\\') + '\\').ToLowerInvariant()

$registrationRemoval = @'
$ErrorActionPreference = 'Stop'
$binRoot = ([System.IO.Path]::GetFullPath(${psQuote(paths.bin)}).TrimEnd('\\') + '\\').ToLowerInvariant()
$legacyBinaries = @(
  'wheelmaker.exe',
  'wheelmaker-updater.exe',
  'wheelmaker-deploy.exe',
  'wheelmaker-monitor.exe'
)

function Test-WheelMakerLegacyProcess($process) {
  $path = [string]$process.ExecutablePath
  if (-not [string]::IsNullOrWhiteSpace($path)) {
    $pathLower = $path.ToLowerInvariant()
    if (
      $pathLower.StartsWith($binRoot) -and
      $legacyBinaries -contains [System.IO.Path]::GetFileName($pathLower)
    ) {
      return $true
    }
  }
  $commandLine = [string]$process.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }
  $commandLineLower = $commandLine.ToLowerInvariant()
  foreach ($binary in $legacyBinaries) {
    if ($commandLineLower.Contains($binRoot + $binary)) {
      return $true
    }
  }
  return $false
}

function Get-WheelMakerLegacyProcesses {
  return @(Get-CimInstance Win32_Process | Where-Object {
    Test-WheelMakerLegacyProcess $_
  })
}

function Stop-WheelMakerLegacyProcesses {
  $stopErrors = @()
  foreach ($process in @(Get-WheelMakerLegacyProcesses)) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      if ($null -ne (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
        $stopErrors += ("PID {0} {1}: {2}" -f $process.ProcessId, $process.Name, $_.Exception.Message)
      }
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remaining = @(Get-WheelMakerLegacyProcesses)
    if ($remaining.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  $remainingText = ($remaining | Select-Object ProcessId,Name,ExecutablePath,CommandLine | Format-List | Out-String).Trim()
  if ($stopErrors.Count -gt 0) {
    $remainingText += [Environment]::NewLine + 'Stop errors:' + [Environment]::NewLine + ($stopErrors -join [Environment]::NewLine)
  }
  throw ("Timed out stopping WheelMaker runtime processes:" + [Environment]::NewLine + $remainingText)
}

function Remove-WheelMakerLegacyService([string]$name) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $name -Force -ErrorAction Stop
  }
  & sc.exe delete $name | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "failed to delete service $name"
  }
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if ($null -eq (Get-Service -Name $name -ErrorAction SilentlyContinue)) {
      return
    }
  }
  throw "Timed out deleting service $name"
}

try {
  foreach ($name in @('WheelMaker', 'WheelMakerUpdater', 'WheelMakerMonitor')) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -ne $task) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
    }
    Remove-WheelMakerLegacyService $name
  }
  Stop-WheelMakerLegacyProcesses
} catch {
  if (-not [string]::IsNullOrWhiteSpace($env:WHEELMAKER_MIGRATION_DIAGNOSTIC)) {
    try {
      ($_ | Out-String) | Set-Content -LiteralPath $env:WHEELMAKER_MIGRATION_DIAGNOSTIC -Encoding UTF8 -ErrorAction Stop
    } catch {}
  }
  if ($env:WHEELMAKER_MIGRATION_ELEVATED_CHILD -eq '1') {
    exit 1
  }
  throw
}
'@
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$existingTasks = @($runtimeNames | ForEach-Object {
  Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
})
$existingServices = @(Get-Service -Name $runtimeNames -ErrorAction SilentlyContinue)
$existingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $legacyBinaries -contains ([string]$_.Name).ToLowerInvariant()
})
if ($existingTasks.Count -gt 0 -or $existingServices.Count -gt 0 -or $existingProcesses.Count -gt 0) {
  $diagnosticName = "wheelmaker-migrate-uninstall-$([Guid]::NewGuid().ToString('N')).log"
  $diagnosticPath = Join-Path $env:TEMP $diagnosticName
  $registrationError = $null
  if ($isAdministrator) {
    try {
      & ([ScriptBlock]::Create($registrationRemoval))
    } catch {
      $registrationError = ($_ | Out-String)
    }
  } else {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($registrationRemoval))
    $env:WHEELMAKER_MIGRATION_ELEVATED_CHILD = '1'
    $env:WHEELMAKER_MIGRATION_DIAGNOSTIC = $diagnosticPath
    try {
      $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        $encoded
      ) -Verb RunAs -Wait -PassThru
    } finally {
      Remove-Item Env:WHEELMAKER_MIGRATION_ELEVATED_CHILD -ErrorAction SilentlyContinue
      Remove-Item Env:WHEELMAKER_MIGRATION_DIAGNOSTIC -ErrorAction SilentlyContinue
    }
    if ($process.ExitCode -ne 0) {
      $registrationError = "elevated process exited with code $($process.ExitCode)"
      if (Test-Path -LiteralPath $diagnosticPath) {
        $registrationError = Get-Content -Raw -LiteralPath $diagnosticPath
      }
    }
  }

  $remainingTasks = @($runtimeNames | ForEach-Object {
    Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
  })
  $remainingServices = @(Get-Service -Name $runtimeNames -ErrorAction SilentlyContinue)
  $remainingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $path = [string]$_.ExecutablePath
    $commandLine = [string]$_.CommandLine
    $pathMatches = -not [string]::IsNullOrWhiteSpace($path) -and
      $path.ToLowerInvariant().StartsWith($targetBinRoot) -and
      $legacyBinaries -contains [System.IO.Path]::GetFileName($path).ToLowerInvariant()
    $commandMatches = $false
    if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
      foreach ($binary in $legacyBinaries) {
        if ($commandLine.ToLowerInvariant().Contains($targetBinRoot + $binary)) {
          $commandMatches = $true
        }
      }
    }
    $pathMatches -or $commandMatches
  })
  if ($remainingTasks.Count -gt 0 -or $remainingServices.Count -gt 0 -or $remainingProcesses.Count -gt 0) {
    $remaining = @(
      $remainingTasks | ForEach-Object { "task:$($_.TaskPath)$($_.TaskName)" }
      $remainingServices | ForEach-Object { "service:$($_.Name)" }
      $remainingProcesses | ForEach-Object { "process:$($_.ProcessId):$($_.Name)" }
    ) -join ', '
    $detail = if ([string]::IsNullOrWhiteSpace([string]$registrationError)) {
      ''
    } else {
      " Details: $registrationError"
    }
    throw "legacy registration removal incomplete; remaining: $remaining. Diagnostic: $diagnosticPath.$detail"
  }
  Remove-Item -LiteralPath $diagnosticPath -Force -ErrorAction SilentlyContinue
}

$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
foreach ($name in $runtimeNames) {
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
}
exit 0
`;
}

function missingRuntimeRegistration(result) {
  if ((result?.code ?? 0) === 0) return false;
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.toLowerCase();
  return [
    'could not be found',
    'does not exist',
    'no such',
    'not found',
    'not loaded',
  ].some((marker) => output.includes(marker));
}

function assertRuntimeRemovalResult(command, args, result) {
  if ((result?.code ?? 0) === 0 || missingRuntimeRegistration(result)) return;
  const detail = String(result?.stderr || result?.stdout || '').trim();
  throw new Error(
    `${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`,
  );
}

export function createLegacyMigrationAdapter({
  paths,
  platform = process.platform,
  runner = runProcess,
}) {
  return {
    removeRuntime: async () => {
      if (platform === 'win32') {
        await runner(
          'powershell',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            windowsLegacyMigrationScript(paths),
          ],
          { cwd: paths.home },
        );
        return;
      }
      if (platform === 'linux') {
        const units = [
          'wheelmaker-hub.service',
          'wheelmaker-updater.service',
          'wheelmaker-updater.timer',
          'wheelmaker-monitor.service',
        ];
        for (const unit of units) {
          const args = ['--user', 'disable', '--now', unit];
          const result = await runner('systemctl', args, {
            allowFailure: true,
          });
          assertRuntimeRemovalResult('systemctl', args, result);
          await rm(join(paths.userHome, '.config', 'systemd', 'user', unit), {
            force: true,
          });
        }
        await runner('systemctl', ['--user', 'daemon-reload']);
        return;
      }
      if (platform === 'darwin') {
        const labels = [
          'com.wheelmaker.hub',
          'com.wheelmaker.updater',
          'com.wheelmaker.monitor',
        ];
        const domain = `gui/${paths.uid}`;
        for (const label of labels) {
          const args = ['bootout', `${domain}/${label}`];
          const result = await runner('launchctl', args, {
            allowFailure: true,
          });
          assertRuntimeRemovalResult('launchctl', args, result);
          await rm(join(paths.userHome, 'Library', 'LaunchAgents', `${label}.plist`), {
            force: true,
          });
        }
        return;
      }
      throw new Error(`unsupported migration platform: ${platform}`);
    },
  };
}

async function executeLegacyMigration(deps) {
  if (!deps.installDirectory) {
    throw new Error('deployment install directory is required');
  }
  const platform = deps.platform ?? process.platform;
  const paths = deploymentRuntimePaths({
    installDirectory: deps.installDirectory,
    nodePath: deps.nodePath ?? process.execPath,
    platform,
    uid: deps.uid,
    userHome: deps.userHome ?? homedir(),
  });
  const migration =
    deps.legacyMigration ??
    createLegacyMigrationAdapter({ paths, platform, runner: deps.runner });
  await migration.removeRuntime();

  const suffix = platform === 'win32' ? '.exe' : '';
  for (const name of [
    'wheelmaker',
    'wheelmaker-updater',
    'wheelmaker-deploy',
    'wheelmaker-monitor',
  ]) {
    await rm(join(paths.bin, `${name}${suffix}`), { force: true });
  }
  for (const directory of [
    join(paths.home, 'build'),
    join(paths.home, 'cache'),
    join(paths.home, 'mobile'),
    join(paths.home, 'tmp'),
  ]) {
    await rm(directory, { force: true, recursive: true });
  }
  await rm(join(paths.home, 'update-now.signal'), { force: true });
  await rm(join(paths.home, 'release.json'), { force: true });
  await removeRetiredLifecycleWrappers(paths.home);
}

async function detectDesktopRunning(platform, runner) {
  if (platform !== 'win32') {
    throw new Error('WheelMaker Desktop update is supported on Windows only');
  }
  const result = await runner(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "if (Get-Process -Name 'WheelMakerDesktop' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
    ],
    { allowFailure: true },
  );
  return result.code === 0;
}

function parseDesktopSelfUpdatePID(args) {
  if (
    args.length !== 3 ||
    args[0] !== 'desktop-self-update' ||
    args[1] !== '--parent-pid' ||
    !/^[1-9]\d*$/.test(args[2] ?? '')
  ) {
    throw new Error(
      'Desktop self-update parent PID must be a positive integer',
    );
  }
  const pid = Number(args[2]);
  if (!Number.isSafeInteger(pid)) {
    throw new Error(
      'Desktop self-update parent PID must be a positive integer',
    );
  }
  return pid;
}

async function waitForDesktopExit(pid, platform, runner) {
  if (platform !== 'win32') {
    throw new Error('WheelMaker Desktop update is supported on Windows only');
  }
  await runner('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $process) { exit 0 }; Wait-Process -InputObject $process -ErrorAction Stop`,
  ]);
}

async function detectLegacyDesktopUpdaterParent({
  installDirectory,
  parentPID = process.ppid,
  platform,
  runner,
}) {
  if (platform !== 'win32') return false;
  const expected = join(
    resolve(installDirectory),
    'desktop',
    'update.exe',
  );
  const result = await runner(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        `$expected = [IO.Path]::GetFullPath(${psQuote(expected)})`,
        `$parent = Get-CimInstance Win32_Process -Filter "ProcessId = ${parentPID}" -ErrorAction SilentlyContinue`,
        'if ($null -ne $parent.ExecutablePath -and [String]::Equals([IO.Path]::GetFullPath([string]$parent.ExecutablePath), $expected, [StringComparison]::OrdinalIgnoreCase)) { exit 0 }',
        'exit 1',
      ].join('; '),
    ],
    { allowFailure: true },
  );
  return result.code === 0;
}

async function executeDesktopUpdate(deps) {
  if (!deps.installDirectory) {
    throw new Error('deployment install directory is required');
  }
  const pointer = deps.trustedStable?.desktopExe;
  if (
    !pointer ||
    !/^v1\.(0|[1-9]\d*)$/.test(pointer.version ?? '') ||
    !/^[0-9a-f]{64}$/.test(pointer.sha256 ?? '')
  ) {
    throw new Error('stable release does not contain a valid Desktop executable');
  }
  const desktopUrl = resolveReleasePath(
    deps.trustedReleaseBaseUrl,
    pointer.path,
    'Desktop executable',
  );
  const platform = deps.platform ?? process.platform;
  const runner = deps.runner ?? runProcess;
  const isDesktopRunning =
    deps.isDesktopRunning ?? (() => detectDesktopRunning(platform, runner));
  if (await isDesktopRunning()) {
    throw new Error('Close WheelMaker Desktop before updating it');
  }
  if (typeof deps.fetchBytes !== 'function') {
    throw new Error('Desktop executable downloader is required');
  }

  const home = resolve(deps.installDirectory);
  const desktopDirectory = join(home, 'desktop');
  const targetPath = join(desktopDirectory, 'WheelMakerDesktop.exe');
  const temporaryPath = `${targetPath}.tmp`;
  const bytes = Buffer.from(await deps.fetchBytes(desktopUrl, {
    label: `Desktop ${pointer.version}`,
  }));
  await mkdir(desktopDirectory, { recursive: true });
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o755 });
    if (sha256Bytes(bytes) !== pointer.sha256) {
      throw new Error('Desktop executable SHA-256 verification failed');
    }
    await replaceInstalledFile(temporaryPath, targetPath, {
      fileOperations: deps.fileOperations,
      platform,
      sleep: deps.replaceSleep,
    });
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function windowsStopScript(paths) {
  return `$ErrorActionPreference = 'Stop'
Stop-ScheduledTask -TaskName 'WheelMaker' -ErrorAction SilentlyContinue
$bin = (${psQuote(paths.bin)}.TrimEnd('\\') + '\\').ToLowerInvariant()
$hub = ${psQuote(paths.hub)}.ToLowerInvariant()
function Get-WheelMakerHubProcesses {
  return @(Get-CimInstance Win32_Process | Where-Object {
    $path = [string]$_.ExecutablePath
    -not [string]::IsNullOrWhiteSpace($path) -and
    $path.ToLowerInvariant().StartsWith($bin) -and
    $path.ToLowerInvariant() -eq $hub
  })
}
$deadline = (Get-Date).AddSeconds(10)
do {
  foreach ($process in @(Get-WheelMakerHubProcesses)) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      if ($null -ne (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
        Write-Verbose ("WheelMaker Hub process {0} is still running: {1}" -f $process.ProcessId, $_.Exception.Message)
      }
    }
  }
  $remaining = @(Get-WheelMakerHubProcesses)
  if ($remaining.Count -eq 0) {
    break
  }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
$remaining = @(Get-WheelMakerHubProcesses)
if ($remaining.Count -gt 0) {
  $remainingText = ($remaining | Select-Object ProcessId,Name,ExecutablePath,CommandLine | Format-List | Out-String).Trim()
  throw ("Timed out stopping WheelMaker Hub processes:" + [Environment]::NewLine + $remainingText)
}
`;
}

async function checkLinuxPrerequisites(runner) {
  await runner('systemctl', ['--user', 'show-environment']);
  let userName = process.env.USER;
  if (!userName) {
    userName = (await runner('id', ['-un'])).stdout.trim();
  }
  const lingering = await runner('loginctl', [
    'show-user',
    userName,
    '-p',
    'Linger',
  ]);
  if (!lingering.stdout.includes('Linger=yes')) {
    throw new Error(
      'linux deploy requires lingering so systemd user services survive logout; run: sudo loginctl enable-linger "$USER"',
    );
  }
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function windowsHubHealthScript(paths) {
  return `$task = Get-ScheduledTask -TaskName 'WheelMaker' -ErrorAction SilentlyContinue
$hub = ${psQuote(paths.hub)}.ToLowerInvariant()
$workers = @(Get-CimInstance Win32_Process | Where-Object {
  $path = [string]$_.ExecutablePath
  $commandLine = [string]$_.CommandLine
  -not [string]::IsNullOrWhiteSpace($path) -and
  $path.ToLowerInvariant() -eq $hub -and
  $commandLine -match '(^|\\s)--hub-worker(\\s|$)'
})
if ($null -ne $task -and $task.State -eq 'Running' -and $workers.Count -gt 0) {
  exit 0
}
exit 1
`;
}

export function createRuntimeAdapter({
  environment = process.env,
  paths,
  platform = process.platform,
  runner = runProcess,
}) {
  async function configureRuntime() {
    if (platform === 'win32') {
      const registrationScript = windowsRuntimePlan(paths).script;
      await runner(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowsElevatedPowerShellScript(registrationScript, {
            preserveRuntimeUser: true,
          }),
        ],
        { cwd: paths.home },
      );
      return;
    }
    if (platform === 'linux') {
      const environmentFile = paths.systemdEnv ?? join(paths.home, 'systemd.env');
      const environmentBody = [
        `HOME=${JSON.stringify(environment.HOME ?? paths.userHome)}`,
        `PATH=${JSON.stringify(environment.PATH ?? '')}`,
        '',
      ].join('\n');
      await atomicWrite(environmentFile, Buffer.from(environmentBody), 0o600);
      await chmod(environmentFile, 0o600);
      const unitDirectory = join(paths.userHome, '.config', 'systemd', 'user');
      for (const [name, body] of Object.entries(linuxRuntimeFiles(paths))) {
        await atomicWrite(join(unitDirectory, name), Buffer.from(body), 0o644);
      }
      await runner('systemctl', ['--user', 'daemon-reload']);
      for (const unit of ['wheelmaker-hub.service', 'wheelmaker-updater.timer']) {
        await runner('systemctl', ['--user', 'enable', unit]);
      }
      await runner('systemctl', ['--user', 'start', 'wheelmaker-updater.timer']);
      return;
    }
    if (platform === 'darwin') {
      const directory = join(paths.userHome, 'Library', 'LaunchAgents');
      const files = darwinRuntimeFiles(paths);
      for (const [name, body] of Object.entries(files)) {
        await atomicWrite(join(directory, name), Buffer.from(body), 0o644);
      }
      const domain = `gui/${paths.uid}`;
      for (const label of ['com.wheelmaker.hub', 'com.wheelmaker.updater']) {
        await runner('launchctl', ['bootout', `${domain}/${label}`], {
          allowFailure: true,
        });
        await runner('launchctl', [
          'bootstrap',
          domain,
          join(directory, `${label}.plist`),
        ]);
      }
      await runner('launchctl', ['kickstart', '-k', `${domain}/com.wheelmaker.hub`]);
      return;
    }
    throw new Error(`unsupported runtime platform: ${platform}`);
  }

  async function action(name) {
    if (!['start', 'stop', 'restart'].includes(name)) {
      throw new Error(`unknown runtime action: ${name}`);
    }
    if (name === 'restart' && platform === 'win32') {
      // Windows has no atomic "restart task + workers" primitive: Stop-ScheduledTask
      // ends only the guardian and leaves detached worker grandchildren orphaned.
      // Reuse the proven stop (kills every wheelmaker.exe worker by path) then start.
      await action('stop');
      await action('start');
      return;
    }
    if (platform === 'win32') {
      if (name === 'stop') {
        await runner(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsStopScript(paths)],
          { cwd: paths.home },
        );
      }
      if (name === 'start') {
        await runner('powershell', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "Start-ScheduledTask -TaskName 'WheelMaker' -ErrorAction Stop",
        ]);
      }
      return;
    }
    if (platform === 'linux') {
      return runner('systemctl', ['--user', name, 'wheelmaker-hub.service'], {
        allowFailure: name === 'stop',
      });
    }
    if (platform === 'darwin') {
      const target = `gui/${paths.uid}/com.wheelmaker.hub`;
      if (name === 'start' || name === 'restart') {
        return runner('launchctl', ['kickstart', '-k', target]);
      }
      if (name === 'stop') {
        return runner('launchctl', ['kill', 'SIGTERM', target], {
          allowFailure: true,
        });
      }
    }
    throw new Error(`unsupported runtime platform: ${platform}`);
  }

  return {
    checkPrerequisites: () =>
      platform === 'linux' ? checkLinuxPrerequisites(runner) : Promise.resolve(),
    configureRuntime,
    isHubRunning: async () => {
      if (platform === 'win32') {
        const result = await runner(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            windowsHubHealthScript(paths),
          ],
          { allowFailure: true },
        );
        return result.code === 0;
      }
      if (platform === 'linux') {
        const registration = await runner(
          'systemctl',
          ['--user', 'is-active', '--quiet', 'wheelmaker-hub.service'],
          { allowFailure: true },
        );
        if (registration.code !== 0) return false;
        const worker = await runner(
          'pgrep',
          ['-f', `${regexEscape(paths.hub)}.*--hub-worker`],
          { allowFailure: true },
        );
        return worker.code === 0;
      }
      const registration = await runner(
        'launchctl',
        ['print', `gui/${paths.uid}/com.wheelmaker.hub`],
        { allowFailure: true },
      );
      if (registration.code !== 0) return false;
      const worker = await runner(
        'pgrep',
        ['-f', `${regexEscape(paths.hub)}.*--hub-worker`],
        { allowFailure: true },
      );
      return worker.code === 0;
    },
    isUpdaterRunning: async () => {
      if (platform === 'win32') {
        const result = await runner(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            "if ((Get-ScheduledTask -TaskName 'WheelMakerUpdater' -ErrorAction SilentlyContinue).State -eq 'Running') { exit 0 } else { exit 1 }",
          ],
          { allowFailure: true },
        );
        return result.code === 0;
      }
      if (platform === 'linux') {
        const result = await runner(
          'systemctl',
          ['--user', 'is-active', '--quiet', 'wheelmaker-updater.service'],
          { allowFailure: true },
        );
        return result.code === 0;
      }
      const result = await runner(
        'launchctl',
        ['print', `gui/${paths.uid}/com.wheelmaker.updater`],
        { allowFailure: true },
      );
      return result.code === 0;
    },
    start: () => action('start'),
    stop: () => action('stop'),
    restart: () => action('restart'),
    writeWrappers: () => writeRuntimeWrappers(paths, platform),
  };
}

function resolveRuntime(deps) {
  if (deps.runtime) return deps.runtime;
  if (!deps.installDirectory) {
    throw new Error('deployment install directory is required');
  }
  const platform = deps.platform ?? process.platform;
  const paths = deploymentRuntimePaths({
    installDirectory: deps.installDirectory,
    nodePath: deps.nodePath ?? process.execPath,
    platform,
    uid: deps.uid,
    userHome: deps.userHome ?? homedir(),
  });
  const runtimeFactory = deps.runtimeFactory ?? createRuntimeAdapter;
  return runtimeFactory({ paths, platform, runner: deps.runner });
}

function windowsConfigSecurityScript(path) {
  return `$ErrorActionPreference = 'Stop'
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
foreach ($sid in @($currentSid, $systemSid)) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
}
[System.IO.File]::SetAccessControl(${psQuote(path)}, $acl)
`;
}

async function secureRuntimeConfig(path, platform, runner = runProcess) {
  if (platform !== 'win32') {
    await chmod(path, 0o600);
    return;
  }
  await runner('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    windowsConfigSecurityScript(path),
  ]);
}

async function ensureRuntimeConfig(home, deps, platform) {
  const configPath = join(home, 'config.json');
  let config = await readJsonIfPresent(configPath);
  let changed = false;
  if (config === null) {
    config = {
      projects: [],
      registry: {
        listen: true,
        port: 9630,
        server: '127.0.0.1',
        token: randomBytes(32).toString('base64url'),
        hubId: 'local-hub',
      },
      log: { level: 'warn' },
    };
    changed = true;
  } else {
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config.json root must be an object');
    }
    if (Object.hasOwn(config, 'monitor')) {
      delete config.monitor;
      changed = true;
    }
    if (!Object.hasOwn(config, 'registry')) {
      config.registry = {};
      changed = true;
    }
    if (
      typeof config.registry !== 'object' ||
      config.registry === null ||
      Array.isArray(config.registry)
    ) {
      throw new Error('config.json registry must be an object');
    }
    const token = config.registry.token;
    if (token !== undefined && typeof token !== 'string') {
      throw new Error('config.json registry.token must be a string');
    }
    if (!token?.trim() || token === 'wheelmaker-local-token') {
      config.registry.token = randomBytes(32).toString('base64url');
      changed = true;
    }
  }
  if (changed) {
    await atomicWrite(configPath, jsonBytes(config), 0o600);
  }
  const secureConfigFile =
    deps.secureConfigFile ??
    ((path) => secureRuntimeConfig(path, platform, deps.runner));
  await secureConfigFile(configPath);
  return changed;
}

function transientWindowsFileError(error) {
  return ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
}

async function replaceInstalledFile(
  temporaryPath,
  targetPath,
  {
    fileOperations = {},
    platform = process.platform,
    sleep = (milliseconds) =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  } = {},
) {
  const removeFile = fileOperations.remove ?? rm;
  const renameFile = fileOperations.rename ?? rename;
  if (platform !== 'win32') {
    await renameFile(temporaryPath, targetPath);
    return;
  }
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await removeFile(targetPath, { force: true });
      await renameFile(temporaryPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!transientWindowsFileError(error) || attempt === 9) break;
      await sleep(300);
    }
  }
  throw lastError;
}

async function applyStagedPackage({
  extractionDirectory,
  fileOperations,
  home,
  jobId,
  platform,
  replaceSleep,
}) {
  const binaryName = platform === 'win32' ? 'wheelmaker.exe' : 'wheelmaker';
  const sourceBinary = join(extractionDirectory, 'hub', binaryName);
  const sourceWeb = join(extractionDirectory, 'web');
  await access(sourceBinary);
  await access(sourceWeb);

  const binDirectory = join(home, 'bin');
  const targetBinary = join(binDirectory, binaryName);
  const temporaryBinary = join(binDirectory, `.${binaryName}.${jobId}.tmp`);
  const targetWeb = join(home, 'web');
  const temporaryWeb = join(home, `.web.${jobId}.tmp`);
  await mkdir(binDirectory, { recursive: true });
  await rm(temporaryBinary, { force: true });
  await rm(temporaryWeb, { recursive: true, force: true });

  try {
    await cp(sourceBinary, temporaryBinary);
    await chmod(temporaryBinary, 0o755);
    await cp(sourceWeb, temporaryWeb, { recursive: true });
    await replaceInstalledFile(temporaryBinary, targetBinary, {
      fileOperations,
      platform,
      sleep: replaceSleep,
    });
    await rm(targetWeb, { recursive: true, force: true });
    await rename(temporaryWeb, targetWeb);
  } finally {
    await rm(temporaryBinary, { force: true });
    await rm(temporaryWeb, { recursive: true, force: true });
  }
}

async function writeInstalledRelease(home, stable, manifestSha256, installedAt) {
  const release = {
    schemaVersion: 2,
    version: stable.version,
    publishedAt: stable.publishedAt,
    sourceSha: stable.sourceSha,
    manifestSha256,
    installedAt,
  };
  await atomicWrite(join(home, 'release.json'), jsonBytes(release), 0o644);
  return release;
}

async function confirmHubStarted(runtime, deps) {
  if (typeof runtime.isHubRunning !== 'function') {
    throw new Error('runtime adapter cannot confirm Hub health');
  }
  const timeoutMs = deps.healthTimeoutMs ?? 30_000;
  const pollIntervalMs = deps.healthPollIntervalMs ?? 500;
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  const sleep =
    deps.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await runtime.isHubRunning()) return;
    if (attempt + 1 < attempts) await sleep(pollIntervalMs);
  }
  const error = new Error('Hub did not start within the health check timeout');
  error.code = 'hub_start_timeout';
  throw error;
}

function updateErrorCode(phase, error) {
  if (error?.code === 'hub_start_timeout') return 'hub_start_timeout';
  return {
    applying: 'apply_failed',
    downloading: 'download_failed',
    restarting: 'restart_failed',
    verifying: 'verification_failed',
  }[phase] ?? 'update_failed';
}

async function resolveUpdateJob({ deps, internalUpdate, runtime, stagingDirectory }) {
  const existing = await readJsonIfPresent(join(stagingDirectory, 'lock.json'));
  if (internalUpdate && existing?.state === 'queued') {
    validateJobId(existing.jobId);
    return { jobId: existing.jobId, startedAt: normalizeTime(existing.startedAt) };
  }
  const jobId = deps.jobIdFactory?.() ?? randomUUID();
  const startedAt = normalizeTime(deps.now?.() ?? new Date().toISOString());
  const acquired = await acquireUpdateLease(
    stagingDirectory,
    { jobId, now: startedAt, owner: 'timer' },
    {
      isUpdaterRunning:
        runtime.isUpdaterRunning?.bind(runtime) ?? (async () => false),
    },
  );
  if (!acquired) {
    throw new Error('another deployment update is already active');
  }
  return { jobId, startedAt };
}

async function executeDeployment(internalUpdate, deps, runtime) {
  if (!deps.trustedStable) {
    throw new Error('trusted stable metadata is required');
  }
  const home = resolve(deps.installDirectory);
  const platform = deps.platform ?? process.platform;
  if (!internalUpdate && typeof runtime.checkPrerequisites === 'function') {
    await runtime.checkPrerequisites();
  }
  const stagingDirectory = join(home, 'staging');
  const { jobId, startedAt } = await resolveUpdateJob({
    deps,
    internalUpdate,
    runtime,
    stagingDirectory,
  });
  let phase = 'downloading';
  let runtimeStopped = false;
  let runtimeStarted = false;
  const now = () => deps.now?.() ?? new Date().toISOString();

  const setState = async (state) => {
    phase = state;
    await heartbeatUpdateLease(stagingDirectory, jobId, now());
    await writeUpdateStatus(stagingDirectory, {
      jobId,
      now: now(),
      startedAt,
      state,
      version: deps.trustedStable.version,
    });
    const message = {
      applying: 'Applying Hub and Web',
      downloading: `Downloading release ${deps.trustedStable.version}`,
      restarting: 'Starting Hub',
      verifying: `Verifying release ${deps.trustedStable.version}`,
    }[state];
    if (message) deps.reportStatus?.(message);
  };

  let deploymentError;
  try {
    await setState('downloading');
    const stageRelease =
      deps.stageRelease ??
      ((input) =>
        stageVerifiedRelease({
          ...input,
          fetchBytes: deps.fetchBytes,
          releaseBaseUrl: deps.trustedReleaseBaseUrl,
          stable: deps.trustedStable,
          stagingDirectory,
        }));
    const staged = await stageRelease({
      jobId,
      onPhase: async (nextPhase) => setState(nextPhase),
      platform:
        deps.platformKey ?? currentPlatformKey(platform, deps.arch ?? process.arch),
    });
    if (phase !== 'verifying') await setState('verifying');
    if (!internalUpdate) await ensureRuntimeConfig(home, deps, platform);

    // Gateway configuration is deliberately outside the Hub update transaction.
    // A normal `deploy.mjs update` never enters this block, and a full deployment
    // only writes the semantic Workspace site when explicitly selected.
    if (!internalUpdate) {
      const gatewayOptions = deps.gatewayOptions ?? parseGatewayOptions([]);
      let mode = gatewayOptions.mode;
      let questioner;
      try {
        if (!gatewayOptions.explicit && deps.interactive) {
          if (!deps.gatewayQuestion) questioner = createGatewayQuestioner();
          const ask = deps.gatewayQuestion ?? questioner.ask;
          const answer = String(
            await ask('Write Workspace Caddy configuration? [y/N]', 'n'),
          ).trim().toLowerCase();
          mode = ['y', 'yes'].includes(answer) ? 'caddy' : 'none';
        }
        if (mode === 'caddy') {
          const configResult = await configureWorkspaceSite({
            ask: deps.gatewayQuestion ?? questioner?.ask,
            home: deps.gatewayHome ?? gatewayHome({userHome: deps.userHome ?? homedir()}),
            mode,
            publicUrl: gatewayOptions.publicUrl,
            upstream: 'http://127.0.0.1:9630',
            webRoot: join(home, 'web'),
          });
          if (configResult.written) deps.reportStatus?.('Workspace Caddy configuration written');
        }
      } finally {
        questioner?.close();
      }
    }

    await setState('applying');
    await runtime.stop();
    runtimeStopped = true;
    await applyStagedPackage({
      extractionDirectory: staged.extractionDirectory,
      fileOperations: deps.fileOperations,
      home,
      jobId,
      platform,
      replaceSleep: deps.replaceSleep,
    });
    await removeRetiredLifecycleWrappers(home);
    await writeInstalledRelease(
      home,
      deps.trustedStable,
      staged.manifestSha256,
      normalizeTime(now()),
    );
    if (!internalUpdate) {
      deps.reportStatus?.('Configuring runtime');
      await runtime.configureRuntime();
    }
    if (!internalUpdate) {
      await runtime.writeWrappers();
    }

    await setState('restarting');
    await runtime.start();
    runtimeStarted = true;
    await confirmHubStarted(runtime, deps);
    await finishUpdate(stagingDirectory, {
      jobId,
      now: now(),
      startedAt,
      state: 'succeeded',
      version: deps.trustedStable.version,
    });
    deps.reportStatus?.(`Deployment completed: ${deps.trustedStable.version}`);
  } catch (error) {
    deps.reportStatus?.(`Deployment failed during ${phase}`);
    if (runtimeStopped && !runtimeStarted) {
      await runtime.start().catch(() => {});
    }
    await finishUpdate(stagingDirectory, {
      errorCode: updateErrorCode(phase, error),
      jobId,
      now: now(),
      startedAt,
      state: 'failed',
      version: deps.trustedStable.version,
    }).catch(() => {});
    deploymentError = error;
  }

  let cleanupError;
  try {
    validateJobId(jobId);
    await rm(join(stagingDirectory, jobId), {
      force: true,
      recursive: true,
    });
  } catch (error) {
    cleanupError = error;
  }
  if (deploymentError && cleanupError) {
    throw new AggregateError(
      [deploymentError, cleanupError],
      'deployment and staging cleanup both failed',
    );
  }
  if (deploymentError) throw deploymentError;
  if (cleanupError) throw cleanupError;
}

async function executeGatewayDeployment(deps, {force = false} = {}) {
  if (!deps.trustedStable) throw new Error('trusted stable metadata is required');
  const result = await installGatewayFromStable({
    stable: deps.trustedStable,
    releaseBaseUrl: deps.trustedReleaseBaseUrl,
    fetchBytes: deps.fetchBytes,
    gatewayHome: deps.gatewayHome ?? gatewayHome({userHome: deps.userHome ?? homedir()}),
    userHome: deps.userHome ?? homedir(),
    platformKey: deps.gatewayPlatformKey ?? currentPlatformKey(deps.platform ?? process.platform, deps.arch ?? process.arch),
    platform: deps.platform ?? process.platform,
    arch: deps.arch ?? process.arch,
    nodePath: deps.nodePath ?? process.execPath,
    uid: deps.uid,
    runner: deps.gatewayRunner ?? deps.runner,
    gatewayRuntime: deps.gatewayRuntime,
    validateBinary: deps.validateGatewayBinary,
    now: deps.now,
    reportStatus: deps.reportStatus,
    force,
  });
  if (result.skipped && result.reason === 'missing-pointer') {
    throw new Error('stable release has no Gateway artifact; publish a release with Gateway first');
  }
  deps.reportStatus?.(`Gateway deployment completed: ${result.pointer?.version ?? deps.trustedStable.gateway?.version}`);
  return result;
}

export async function runCore(args, deps = {}) {
  const gatewayInvocation = parseGatewayOptions(args);
  args = gatewayInvocation.commandArgs;
  if (gatewayInvocation.explicit) {
    deps = {...deps, gatewayOptions: gatewayInvocation};
  }
  if (args.length === 1 && args[0] === 'migrate-uninstall') {
    deps.reportStatus?.('Removing legacy services and files');
    await executeLegacyMigration(deps);
    deps.reportStatus?.('Legacy migration cleanup completed');
    return;
  }
  if (args.length === 1 && args[0] === 'desktop-update') {
    if (!deps.installDirectory) {
      throw new Error('deployment install directory is required');
    }
    const platform = deps.platform ?? process.platform;
    const runner = deps.runner ?? runProcess;
    const legacyParent =
      deps.isLegacyDesktopUpdaterParent ??
      (() =>
        detectLegacyDesktopUpdaterParent({
          installDirectory: deps.installDirectory,
          parentPID: deps.parentPID ?? process.ppid,
          platform,
          runner,
        }));
    if (await legacyParent()) {
      const paths = deploymentRuntimePaths({
        installDirectory: deps.installDirectory,
        nodePath: deps.nodePath ?? process.execPath,
        platform,
        uid: deps.uid,
        userHome: deps.userHome ?? homedir(),
      });
      await writeWindowsDesktopUpdateWrapper(paths);
    }
    deps.reportStatus?.('Updating WheelMaker Desktop');
    await executeDesktopUpdate(deps);
    deps.reportStatus?.('Desktop update completed');
    return;
  }
  if (args[0] === 'desktop-self-update') {
    const parentPID = parseDesktopSelfUpdatePID(args);
    const platform = deps.platform ?? process.platform;
    const runner = deps.runner ?? runProcess;
    const wait =
      deps.waitForDesktopExit ??
      ((pid) => waitForDesktopExit(pid, platform, runner));
    deps.reportStatus?.(
      `Waiting for WheelMaker Desktop process ${parentPID}`,
    );
    await wait(parentPID);
    deps.reportStatus?.('Updating WheelMaker Desktop');
    await executeDesktopUpdate(deps);
    deps.reportStatus?.('Desktop update completed');
    return;
  }
  if (args.length === 1 && (args[0] === 'gateway' || args[0] === 'gateway-update')) {
    return executeGatewayDeployment(deps, {force: args[0] === 'gateway-update'});
  }
  const runtime = resolveRuntime(deps);
  if (args[0] === 'runtime' && args.length === 2) {
    if (!['start', 'stop', 'restart'].includes(args[1])) {
      throw new Error(`unknown runtime action: ${args[1]}`);
    }
    if (!runtime || typeof runtime[args[1]] !== 'function') {
      throw new Error(`runtime adapter cannot ${args[1]}`);
    }
    const action = args[1];
    const verb = action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting';
    const pastTense = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted';
    deps.reportStatus?.(`${verb} Hub`);
    await runtime[action]();
    deps.reportStatus?.(`Hub ${pastTense}`);
    return;
  }
  if (args.length === 1 && args[0] === 'update') {
    if (typeof deps.applyUpdate === 'function') {
      await runtime.stop();
      let updateError;
      try {
        await deps.applyUpdate();
      } catch (error) {
        updateError = error;
      }
      await runtime.start();
      if (updateError) throw updateError;
      return;
    }
    return executeDeployment(true, deps, runtime);
  }
  if (args.length === 0) return executeDeployment(false, deps, runtime);
  throw new Error('deployment application is not implemented yet');
}

// Gateway configuration, runtime and installation are embedded in the published core.
export const GATEWAY_SCHEMA = 1;
export const WORKSPACE_SITE_KIND = 'workspace';
export const RELEASE_SERVER_SITE_KIND = 'release-server';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOG_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);

function gatewayJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readGatewayJsonIfPresent(path) {
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
    readGatewayJsonIfPresent(paths.config),
    readGatewayJsonIfPresent(paths.workspace),
    readGatewayJsonIfPresent(paths.releaseServer),
  ]);
  if (global !== null) validateGatewayGlobal(global);
  if (workspace !== null) validateGatewaySite(workspace, {kind: WORKSPACE_SITE_KIND});
  if (releaseServer !== null) validateGatewaySite(releaseServer, {kind: RELEASE_SERVER_SITE_KIND});
  return {paths, global, workspace, releaseServer};
}

async function gatewayConfigAtomicWrite(path, bytes, mode = 0o600) {
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
  await gatewayConfigAtomicWrite(paths.workspace, gatewayJsonBytes(validated), 0o600);
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
  const existingValue = await readGatewayJsonIfPresent(paths.workspace);
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

const SERVICE_NAME = 'wheelmaker-gateway';
const WINDOWS_TASK_NAME = 'WheelMakerGateway';
const DARWIN_LABEL = 'com.wheelmaker.gateway';

function gatewayRuntimeShellQuote(value) {
  return `'${String(value).replaceAll("'", `\"'\"'`)}'`;
}

function gatewayRuntimePsQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function gatewayRuntimeSystemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function gatewayRuntimeXmlEscape(value) {
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
  const home = gatewayRuntimePsQuote(paths.home);
  const binary = gatewayRuntimePsQuote(paths.binary);
  const currentUser = '$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name';
  const taskScript = `$ErrorActionPreference = 'Stop'
${currentUser}
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute ${binary} -Argument ${gatewayRuntimePsQuote(`serve --home ${paths.home}`)} -WorkingDirectory ${home}
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
ExecStart=${gatewayRuntimeSystemdQuote(paths.binary)} serve --home ${gatewayRuntimeSystemdQuote(paths.home)}
Restart=always
RestartSec=5
Environment=HOME=${gatewayRuntimeSystemdQuote(paths.userHome ?? '')}

[Install]
WantedBy=default.target
`,
  };
}

function gatewayLaunchAgentPlist(paths) {
  const args = [paths.binary, 'serve', '--home', paths.home]
    .map((value) => `    <string>${gatewayRuntimeXmlEscape(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${gatewayRuntimeXmlEscape(paths.plistLabel ?? DARWIN_LABEL)}</string>
  <key>WorkingDirectory</key>
  <string>${gatewayRuntimeXmlEscape(paths.home)}</string>
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
    [`${paths.plistLabel ?? DARWIN_LABEL}.plist`]: gatewayLaunchAgentPlist(paths),
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
      'start.sh': `#!/bin/sh\nset -eu\nexec systemctl --user start ${gatewayRuntimeShellQuote(unit)}\n`,
      'stop.sh': `#!/bin/sh\nset -eu\nexec systemctl --user stop ${gatewayRuntimeShellQuote(unit)}\n`,
    };
  }
  if (platform === 'darwin') {
    const target = `gui/${paths.uid}/${paths.plistLabel ?? DARWIN_LABEL}`;
    return {
      'start.sh': `#!/bin/sh\nset -eu\nexec launchctl kickstart -k ${gatewayRuntimeShellQuote(target)}\n`,
      'stop.sh': `#!/bin/sh\nset -eu\nexec launchctl kill SIGTERM ${gatewayRuntimeShellQuote(target)}\n`,
    };
  }
  throw new Error(`unsupported Gateway runtime platform: ${platform}`);
}

async function gatewayRuntimeAtomicWrite(path, body, mode = 0o600) {
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
      await gatewayRuntimeAtomicWrite(wrapperPath, body, 0o755);
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
        await gatewayRuntimeAtomicWrite(join(directory, name), body, 0o644);
      }
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
        await gatewayRuntimeAtomicWrite(join(directory, name), body, 0o644);
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

const GATEWAY_TARGETS = new Set([
  'windows-amd64',
  'linux-amd64',
  'darwin-amd64',
  'darwin-arm64',
]);
const GATEWAY_ARCHIVE_PATTERN = /^wheelmaker-gateway-v1\.(0|[1-9]\d*)-(windows-amd64|linux-amd64|darwin-amd64|darwin-arm64)\.tar\.zst$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^v1\.(0|[1-9]\d*)$/;

function gatewayInstallRunProcess(command, args, {cwd, allowFailure = false} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', rejectPromise);
    child.once('exit', code => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code !== 0 && !allowFailure) {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed (${code}): ${result.stderr.trim()}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function gatewayInstallSha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gatewayInstallJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function gatewayInstallResolveReleasePath(baseUrl, path, label) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error('trusted release base URL is invalid');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || baseUrl !== base.origin) {
    throw new Error('trusted release base URL is invalid');
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) {
    throw new Error(`${label} path is invalid`);
  }
  const resolved = new URL(path, `${base.origin}/`);
  if (resolved.origin !== base.origin) throw new Error(`${label} path must stay on the trusted release origin`);
  return resolved.href;
}

function validatePointer(pointer) {
  if (!pointer) return null;
  if (typeof pointer !== 'object' || Array.isArray(pointer) || !VERSION_PATTERN.test(pointer.version ?? '') ||
      !SOURCE_SHA_PATTERN.test(pointer.sourceSha ?? '') || pointer.manifestPath !== '/gateway/current/gateway-manifest.json' ||
      !SHA256_PATTERN.test(pointer.manifestSha256 ?? '')) {
    throw new Error('stable Gateway pointer is invalid');
  }
  return pointer;
}

export function validateGatewayManifest(manifest, pointer) {
  validatePointer(pointer);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.schema !== 1 ||
      manifest.version !== pointer.version || manifest.sourceSha !== pointer.sourceSha ||
      manifest.path !== '/gateway/current/gateway-manifest.json') {
    throw new Error('Gateway manifest identity is invalid');
  }
  // Release Server serializes artifacts as an object keyed by platform. Accepting
  // only that shape prevents an attacker from smuggling paths through an array.
  if (!manifest.artifacts || typeof manifest.artifacts !== 'object' || Array.isArray(manifest.artifacts)) {
    throw new Error('Gateway manifest artifacts are invalid');
  }
  const normalized = {};
  for (const target of GATEWAY_TARGETS) {
    const artifact = manifest.artifacts[target];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
        typeof artifact.path !== 'string' || !artifact.path.startsWith('/gateway/current/') ||
        artifact.path.includes('..') || artifact.path.includes('?') || artifact.path.includes('#') ||
        !SHA256_PATTERN.test(artifact.sha256 ?? '') || !Number.isSafeInteger(artifact.size) || artifact.size < 1) {
      throw new Error(`Gateway artifact metadata/path is invalid: ${target}`);
    }
    const name = artifact.path.slice('/gateway/current/'.length);
    const expected = `wheelmaker-gateway-${manifest.version}-${target}.tar.zst`;
    if (name !== expected || !GATEWAY_ARCHIVE_PATTERN.test(name)) {
      throw new Error(`Gateway artifact path is invalid: ${target}`);
    }
    normalized[target] = {...artifact, name};
  }
  if (Object.keys(manifest.artifacts).some(key => !GATEWAY_TARGETS.has(key))) {
    throw new Error('Gateway manifest contains an unsupported platform');
  }
  return normalized;
}

async function gatewayInstallAtomicWrite(path, bytes, mode = 0o600) {
  await mkdir(resolve(path, '..'), {recursive: true});
  const temporary = join(resolve(path, '..'), `.${path.split(/[\\/]/).pop()}.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, {mode});
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, {force: true});
  }
}

async function copyFileAtomic(source, destination) {
  const bytes = await readFile(source);
  await gatewayInstallAtomicWrite(destination, bytes, 0o755);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateBinary({binary, home, runner}) {
  if (runner) {
    await runner(binary, ['validate', '--home', home]);
    return;
  }
  // Callers that install the service normally provide a platform runner. Keep
  // the default explicit so a deployment cannot silently skip validation.
  throw new Error('Gateway binary validation runner is required');
}

async function waitForGatewayStopped(runtime, {attempts = 20, intervalMs = 250} = {}) {
  if (typeof runtime?.isRunning !== 'function') return;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await runtime.isRunning())) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error('Gateway service did not stop before binary replacement');
}

function gatewayBinaryName(platformKey) {
  return platformKey === 'windows-amd64' ? 'wheelmaker-gateway.exe' : 'wheelmaker-gateway';
}

export function gatewayInstallPaths(home, platformKey) {
  const paths = gatewayConfigPaths(home);
  const binaryName = gatewayBinaryName(platformKey);
  return {
    ...paths,
    binaryName,
    binary: join(paths.bin, binaryName),
    rollbackBinary: join(paths.rollback, binaryName),
  };
}

export async function installGatewayFromStable({
  stable,
  releaseBaseUrl,
  fetchBytes,
  gatewayHome: configuredHome,
  userHome,
  platformKey = currentPlatformKey(),
  platform = process.platform,
  arch = process.arch,
  nodePath = process.execPath,
  uid,
  runner,
  gatewayRuntime,
  validateBinary: validateBinaryOverride,
  now = () => new Date().toISOString(),
  reportStatus,
  force = false,
} = {}) {
  const pointer = validatePointer(stable?.gateway);
  if (!pointer) return {skipped: true, reason: 'missing-pointer'};
  if (!fetchBytes || !releaseBaseUrl) throw new Error('Gateway download dependencies are required');
  if (!GATEWAY_TARGETS.has(platformKey)) throw new Error(`unsupported Gateway platform: ${platformKey}`);

  const home = gatewayHome({home: configuredHome, userHome});
  const paths = gatewayInstallPaths(home, platformKey);
  const commandRunner = runner ?? gatewayInstallRunProcess;
  await mkdir(paths.bin, {recursive: true});
  await mkdir(paths.downloads, {recursive: true});
  await mkdir(paths.rollback, {recursive: true});
  await mkdir(join(paths.home, 'state'), {recursive: true});

  const runtime = gatewayRuntime ?? createGatewayRuntimeAdapter({
    paths: gatewayRuntimePaths({gatewayHome: home, gatewayBinary: paths.binary, nodePath, userHome, uid}),
    platform,
    runner: commandRunner,
  });

  const manifestURL = gatewayInstallResolveReleasePath(releaseBaseUrl, pointer.manifestPath, 'Gateway manifest');
  const manifestBytes = await fetchBytes(manifestURL, {label: 'Gateway manifest'});
  if (gatewayInstallSha256Bytes(manifestBytes) !== pointer.manifestSha256) throw new Error('Gateway manifest SHA-256 verification failed');
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch {
    throw new Error('Gateway manifest is not valid JSON');
  }
  const artifacts = validateGatewayManifest(manifest, pointer);
  const artifact = artifacts[platformKey];
  const statePath = join(paths.home, 'state', 'release.json');
  const previousState = await (async () => {
    try { return JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  })();
  if (!force && previousState?.version === pointer.version && previousState?.manifestSha256 === pointer.manifestSha256 && await fileExists(paths.binary)) {
    let running = false;
    if (typeof runtime.isRunning === 'function') {
      running = await runtime.isRunning();
    } else {
      try {
        await runtime.health();
        running = true;
      } catch {
        // Start and verify the existing binary below.
      }
    }
    if (running) {
      try {
        await runtime.health();
        return {skipped: true, reason: 'already-installed', home, paths, pointer, manifest};
      } catch (error) {
        reportStatus?.(`Existing Gateway health check failed; reinstalling service: ${error.message}`);
      }
    }
    try {
      await runtime.start();
      await runtime.health();
      return {skipped: true, reason: 'started-existing', home, paths, pointer, manifest};
    } catch (error) {
      reportStatus?.(`Existing Gateway service could not start; reinstalling service: ${error.message}`);
    }
  }

  reportStatus?.(`Downloading Gateway ${pointer.version} (${platformKey})`);
  const archiveURL = gatewayInstallResolveReleasePath(releaseBaseUrl, artifact.path, 'Gateway artifact');
  const archiveBytes = await fetchBytes(archiveURL, {label: `Gateway ${platformKey}`});
  if (archiveBytes.length !== artifact.size) throw new Error('Gateway archive size verification failed');
  if (gatewayInstallSha256Bytes(archiveBytes) !== artifact.sha256) throw new Error('Gateway archive SHA-256 verification failed');

  const job = `${process.pid}-${randomUUID()}`;
  const downloadPath = join(paths.downloads, `${artifact.name}.${job}`);
  const extractionPath = join(paths.downloads, `extract-${job}`);
  const stagedBinary = join(extractionPath, paths.binaryName);
  await writeFile(downloadPath, archiveBytes, {mode: 0o600});
  try {
    await extractTarZst(archiveBytes, extractionPath);
    await access(stagedBinary);
    const candidateHome = home;
    const validate = validateBinaryOverride ?? validateBinary;
    await validate({binary: stagedBinary, home: candidateHome, runner: commandRunner});

    const hadCurrent = await fileExists(paths.binary);
    await runtime.stop().catch((error) => {
      if (!hadCurrent) return;
      throw error;
    });
    await waitForGatewayStopped(runtime);
    await rm(paths.rollbackBinary, {force: true});
    if (hadCurrent) await rename(paths.binary, paths.rollbackBinary);
    try {
      await copyFileAtomic(stagedBinary, paths.binary);
      await chmod(paths.binary, 0o755);
      await runtime.install();
      await runtime.health();
      await gatewayInstallAtomicWrite(statePath, gatewayInstallJsonBytes({schema: 1, version: pointer.version, sourceSha: pointer.sourceSha, manifestSha256: pointer.manifestSha256, installedAt: now()}), 0o600);
      await rm(paths.rollbackBinary, {force: true});
      return {skipped: false, home, paths, pointer, manifest};
    } catch (error) {
      reportStatus?.(`Gateway ${pointer.version} failed to start; restoring previous version`);
      await runtime.stop().catch(() => {});
      await waitForGatewayStopped(runtime).catch(() => {});
      await rm(paths.binary, {force: true});
      if (hadCurrent && await fileExists(paths.rollbackBinary)) {
        await rename(paths.rollbackBinary, paths.binary);
        await runtime.install().catch(() => {});
        await runtime.health().catch(() => {});
      }
      throw new Error(`Gateway installation failed and rollback was attempted: ${error.message}`, {cause: error});
    }
  } finally {
    await rm(downloadPath, {force: true});
    await rm(extractionPath, {recursive: true, force: true});
  }
}

export async function validateInstalledGatewayConfiguration(home) {
  return readGatewayConfiguration(home);
}
