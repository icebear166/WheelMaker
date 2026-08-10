import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  acquireUpdateLease,
  createLegacyMigrationAdapter,
  createRuntimeAdapter,
  currentPlatformKey,
  createGatewayQuestioner,
  darwinRuntimeFiles,
  finishUpdate,
  linuxRuntimeFiles,
  runCore,
  stageVerifiedRelease,
  unixWrappers,
  windowsRuntimePlan,
  windowsLegacyMigrationScript,
  windowsWrappers,
} from './deploy-core.mjs';
import {
  encodeJsonBytes,
  sha256Bytes,
} from '../release/metadata.mjs';
import { createTarZst } from '../release/tar.mjs';

const RUNTIME_PATHS = {
  bin: 'C:\\Users\\alice\\.wheelmaker\\bin',
  deploy: 'C:\\Users\\alice\\.wheelmaker\\deploy.mjs',
  home: 'C:\\Users\\alice\\.wheelmaker',
  hub: 'C:\\Users\\alice\\.wheelmaker\\bin\\wheelmaker.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  uid: 501,
  userHome: 'C:\\Users\\alice',
};

test('platform mapping includes Intel macOS releases', () => {
  assert.equal(currentPlatformKey('darwin', 'x64'), 'darwin-amd64');
  assert.equal(currentPlatformKey('darwin', 'arm64'), 'darwin-arm64');
});

test('Windows plan contains current-user tasks and fixed 03:00 updater', () => {
  const plan = windowsRuntimePlan(RUNTIME_PATHS);
  assert.deepEqual(plan.names, ['WheelMaker', 'WheelMakerUpdater']);
  assert.match(plan.script, /AtLogOn/);
  assert.match(plan.script, /03:00/);
  assert.match(plan.script, /RunLevel Limited/);
  assert.doesNotMatch(plan.script, /sc\.exe create/i);
  assert.doesNotMatch(plan.script, /New-Service/i);
});

test('Windows tasks hide the Node updater and allow the Hub to run indefinitely', () => {
  const plan = windowsRuntimePlan(RUNTIME_PATHS);

  assert.match(
    plan.script,
    /ExecutionTimeLimit \(New-TimeSpan -Seconds 0\)/,
  );
  assert.match(
    plan.script,
    /\$updaterArguments = '.*-WindowStyle Hidden.*-EncodedCommand/,
  );
  assert.match(
    plan.script,
    /\$updaterAction = New-ScheduledTaskAction -Execute 'powershell\.exe' -Argument \$updaterArguments/,
  );
});

test('Windows runtime registration elevates task mutations and preserves the login user', async () => {
  const calls = [];
  const adapter = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    async runner(command, args, options) {
      calls.push({ args, command, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  });

  await adapter.configureRuntime();

  assert.equal(calls.length, 1);
  const script = calls[0].args.at(-1);
  assert.match(script, /-Verb RunAs/);
  assert.match(script, /WHEELMAKER_RUNTIME_USER/);
  assert.match(script, /-EncodedCommand/);
});

test('Linux files contain Hub service plus one-shot updater timer', () => {
  const files = linuxRuntimeFiles({
    ...RUNTIME_PATHS,
    deploy: '/home/alice/.wheelmaker/deploy.mjs',
    home: '/home/alice/.wheelmaker',
    hub: '/home/alice/.wheelmaker/bin/wheelmaker',
    node: '/usr/bin/node',
    userHome: '/home/alice',
  });
  assert.match(files['wheelmaker-hub.service'], /Restart=always/);
  assert.match(
    files['wheelmaker-hub.service'],
    /^WorkingDirectory=\/home\/alice\/\.wheelmaker$/m,
  );
  assert.doesNotMatch(files['wheelmaker-hub.service'], /WorkingDirectory="/);
  assert.match(files['wheelmaker-updater.service'], /Type=oneshot/);
  assert.match(
    files['wheelmaker-updater.service'],
    /^WorkingDirectory=\/home\/alice\/\.wheelmaker$/m,
  );
  assert.match(files['wheelmaker-updater.service'], /deploy\.mjs.*update/);
  assert.match(
    files['wheelmaker-updater.timer'],
    /OnCalendar=\*-\*-\* 03:00:00/,
  );
  const hubUnit = files['wheelmaker-hub.service'];
  const unitSection = hubUnit.slice(
    hubUnit.indexOf('[Unit]'),
    hubUnit.indexOf('[Service]'),
  );
  const serviceSection = hubUnit.slice(
    hubUnit.indexOf('[Service]'),
    hubUnit.indexOf('[Install]'),
  );
  assert.match(unitSection, /StartLimitIntervalSec=300/);
  assert.match(unitSection, /StartLimitBurst=5/);
  assert.doesNotMatch(serviceSection, /StartLimit/);
  assert.match(
    files['wheelmaker-hub.service'],
    /^EnvironmentFile=\/home\/alice\/\.wheelmaker\/systemd\.env$/m,
  );
  assert.match(
    files['wheelmaker-updater.service'],
    /^EnvironmentFile=\/home\/alice\/\.wheelmaker\/systemd\.env$/m,
  );
});

test('Linux runtime configuration preserves HOME and PATH without starting Hub early', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-linux-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  const calls = [];
  const adapter = createRuntimeAdapter({
    environment: {
      HOME: '/home/alice',
      PATH: '/home/alice/.local/bin:/usr/bin',
    },
    paths: {
      bin: join(home, 'bin'),
      deploy: join(home, 'deploy.mjs'),
      home,
      hub: join(home, 'bin', 'wheelmaker'),
      node: '/usr/bin/node',
      systemdEnv: join(home, 'systemd.env'),
      uid: 501,
      userHome: root,
    },
    platform: 'linux',
    runner: async (command, args) => {
      calls.push({ args, command });
      if (command === 'loginctl') {
        return { code: 0, stderr: '', stdout: 'Linger=yes\n' };
      }
      return { code: 0, stderr: '', stdout: '' };
    },
  });

  await adapter.configureRuntime();

  const environmentPath = join(home, 'systemd.env');
  assert.equal(await exists(environmentPath), true);
  assert.equal(
    await readFile(environmentPath, 'utf8'),
    'HOME="/home/alice"\nPATH="/home/alice/.local/bin:/usr/bin"\n',
  );
  assert.equal(
    calls.some((call) => call.args.join(' ') === '--user start wheelmaker-hub.service'),
    false,
  );
  assert.equal(
    calls.some((call) => call.args.join(' ') === '--user start wheelmaker-updater.timer'),
    true,
  );
});

test('macOS files keep Hub alive and schedule updater at 03:00', () => {
  const files = darwinRuntimeFiles({
    ...RUNTIME_PATHS,
    deploy: '/Users/alice/.wheelmaker/deploy.mjs',
    home: '/Users/alice/.wheelmaker',
    hub: '/Users/alice/.wheelmaker/bin/wheelmaker',
    node: '/usr/local/bin/node',
    userHome: '/Users/alice',
  });
  assert.match(files['com.wheelmaker.hub.plist'], /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(files['com.wheelmaker.updater.plist'], /<key>Hour<\/key>\s*<integer>3<\/integer>/);
  assert.match(files['com.wheelmaker.updater.plist'], /<key>Minute<\/key>\s*<integer>0<\/integer>/);
});

test('helper wrappers keep only deploy, start, stop, and optional Desktop update', () => {
  const windows = windowsWrappers(RUNTIME_PATHS);
  const unix = unixWrappers({
    ...RUNTIME_PATHS,
    deploy: '/home/alice/.wheelmaker/deploy.mjs',
    node: '/usr/bin/node',
  });
  const runtimeActions = ['start', 'stop'];
  assert.deepEqual(
    Object.keys(windows).sort(),
    [
      ...runtimeActions.map((name) => `${name}.bat`),
      'deploy.bat',
      'update_exe.bat',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(unix).sort(),
    [...runtimeActions.map((name) => `${name}.sh`), 'deploy.sh'].sort(),
  );
  assert.match(windows['deploy.bat'], /deploy\.mjs"\s*\r?\n/);
  assert.doesNotMatch(windows['deploy.bat'], /migrate|runtime|update/);
  assert.match(windows['deploy.bat'], /\r\npause\r\n/);
  assert.match(windows['start.bat'], /deploy\.mjs" runtime start/);
  const desktopUpdateWrapper = windows['update_exe.bat'];
  assert.match(
    desktopUpdateWrapper,
    /^@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n/,
  );
  assert.match(desktopUpdateWrapper, /if "%~1"=="" goto manual_update/);
  assert.match(
    desktopUpdateWrapper,
    /desktop-self-update --parent-pid "%~1"/,
  );
  assert.match(desktopUpdateWrapper, /:manual_update/);
  assert.match(desktopUpdateWrapper, /deploy\.mjs" desktop-update/);
  assert.match(desktopUpdateWrapper, /set "_EXIT_CODE=%errorlevel%"/);
  assert.match(desktopUpdateWrapper, /start WheelMakerDesktop\.exe manually/i);
  assert.match(desktopUpdateWrapper, /\r\npause\r\n/);
  assert.match(desktopUpdateWrapper, /exit \/b %_EXIT_CODE%/);
  assert.match(unix['deploy.sh'], /deploy\.mjs'\s*\n/);
  assert.doesNotMatch(unix['deploy.sh'], /migrate|runtime|update/);
  assert.match(unix['stop.sh'], /deploy\.mjs' runtime stop/);
  assert.equal(windows['restart.bat'], undefined);
  assert.equal(windows['status.bat'], undefined);
  assert.equal(unix['restart.sh'], undefined);
  assert.equal(unix['status.sh'], undefined);
});

test('internal update restarts existing runtime without mutating registration', async () => {
  const events = [];
  const runtime = {
    async configureRuntime() {
      events.push('configureRuntime');
    },
    async removeRuntime() {
      events.push('removeRuntime');
    },
    async start() {
      events.push('start');
    },
    async stop() {
      events.push('stop');
    },
    async writeWrappers() {
      events.push('writeWrappers');
    },
  };

  await runCore(['update'], {
    async applyUpdate() {
      events.push('applyUpdate');
    },
    runtime,
  });
  assert.deepEqual(events, ['stop', 'applyUpdate', 'start']);
});

test('full deployment stores its public URL without writing Gateway config', async (t) => {
  const fixture = await installFixture(t);
  const userHome = join(dirname(fixture.home), 'login-home');
  fixture.deps.userHome = userHome;
  fixture.deps.interactive = false;
  fixture.deps.trustedStable.gateway = {version: 'invalid-implicit-pointer'};
  await runCore(['--public-url=https://workspace.example.com'], fixture.deps);
  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(config.publicUrl, 'https://workspace.example.com');
  await assert.rejects(
    () => access(join(userHome, '.wheelmaker', 'gateway')),
    {code: 'ENOENT'},
  );
});

test('public URL input accepts websocket origin syntax and persists HTTPS origin', async (t) => {
  const fixture = await installFixture(t);
  await runCore(['--public-url=wss://registry.example.com:28800/ws'], fixture.deps);
  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(config.publicUrl, 'https://registry.example.com:28800');
});

test('loopback public URL input remains plain HTTP for local development', async (t) => {
  const fixture = await installFixture(t);
  await runCore(['--public-url=http://127.0.0.2:9630/ws'], fixture.deps);
  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(config.publicUrl, 'http://127.0.0.2:9630');
});

test('first noninteractive full deployment uses loopback when public URL is omitted', async (t) => {
  const fixture = await installFixture(t);
  fixture.deps.interactive = false;

  await runCore([], fixture.deps);
  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal('publicUrl' in config, false);
  assert.match(config.token, /^[A-Za-z0-9_-]{43}$/);
});

test('first interactive full deployment does not prompt when public URL is omitted', async (t) => {
  const fixture = await installFixture(t);
  const userHome = join(dirname(fixture.home), 'login-home');
  fixture.deps.userHome = userHome;
  const questions = [];
  fixture.deps.interactive = true;
  const ask = async (question) => {
    questions.push(question);
    throw new Error('public URL prompt should not run');
  };
  fixture.deps.publicURLQuestion = ask;
  fixture.deps.gatewayQuestion = ask;

  await runCore([], fixture.deps);

  assert.deepEqual(questions, []);
  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal('publicUrl' in config, false);
  await assert.rejects(
    () => access(join(userHome, '.wheelmaker', 'gateway')),
    {code: 'ENOENT'},
  );
});

test('interactive public URL prompt uses a visible colon and a new line', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const questioner = createGatewayQuestioner({input, output});
  const answerPromise = questioner.ask('WheelMaker server public URL');
  input.end('workspace.example.com\n');
  assert.equal(await answerPromise, 'workspace.example.com');
  questioner.close();
  assert.match(Buffer.concat(chunks).toString('utf8'), /WheelMaker server public URL:\r?\n/);
});

test('full deployment reuses the configured public URL without asking', async (t) => {
  const fixture = await installFixture(t);
  await mkdir(fixture.home, {recursive: true});
  await writeFile(join(fixture.home, 'config.json'), JSON.stringify({
    projects: [],
    publicUrl: 'https://workspace.example.com',
  }));
  fixture.deps.interactive = true;
  fixture.deps.publicURLQuestion = async () => {
    throw new Error('configured public URL must be reused');
  };
  fixture.deps.gatewayQuestion = fixture.deps.publicURLQuestion;

  await runCore([], fixture.deps);

  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(config.publicUrl, 'https://workspace.example.com');
});

test('update does not write Gateway config', async (t) => {
  const fixture = await installFixture(t);
  const userHome = join(dirname(fixture.home), 'update-home');
  fixture.deps.userHome = userHome;
  await mkdir(fixture.home, {recursive: true});
  await writeFile(join(fixture.home, 'config.json'), JSON.stringify({
    projects: [],
    publicUrl: 'https://workspace.example.com:8443',
  }));

  await runCore(['update'], fixture.deps);

  await assert.rejects(
    () => access(join(userHome, '.wheelmaker', 'gateway')),
    {code: 'ENOENT'},
  );
});

test('legacy update does not write Gateway config when public URL is absent', async (t) => {
  const fixture = await installFixture(t);
  const userHome = join(dirname(fixture.home), 'legacy-update-home');
  fixture.deps.userHome = userHome;
  await mkdir(fixture.home, {recursive: true});
  await writeFile(join(fixture.home, 'config.json'), '{"projects":[]}\n');

  await runCore(['update'], fixture.deps);

  await assert.rejects(
    () => access(join(userHome, '.wheelmaker', 'gateway')),
    {code: 'ENOENT'},
  );
});

test('runtime start command builds a default adapter from the install directory', async () => {
  let capturedPaths;
  let startCalls = 0;
  await runCore(['runtime', 'start'], {
    installDirectory: 'C:\\Users\\alice\\.wheelmaker',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    runtimeFactory({ paths }) {
      capturedPaths = paths;
      return {
        async start() {
          startCalls += 1;
        },
      };
    },
    userHome: 'C:\\Users\\alice',
  });
  assert.equal(capturedPaths.hub.endsWith('bin\\wheelmaker.exe'), true);
  assert.equal(startCalls, 1);
});

test('runtime restart command builds a default adapter from the install directory', async () => {
  let capturedPaths;
  let restartCalls = 0;
  await runCore(['runtime', 'restart'], {
    installDirectory: 'C:\\Users\\alice\\.wheelmaker',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    runtimeFactory({ paths }) {
      capturedPaths = paths;
      return {
        async restart() {
          restartCalls += 1;
        },
      };
    },
    userHome: 'C:\\Users\\alice',
  });
  assert.equal(capturedPaths.hub.endsWith('bin\\wheelmaker.exe'), true);
  assert.equal(restartCalls, 1);
});

test('runtime adapter exposes manual start, stop, and restart actions', () => {
  const adapter = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    async runner() {},
  });
  assert.equal(typeof adapter.start, 'function');
  assert.equal(typeof adapter.stop, 'function');
  assert.equal(typeof adapter.restart, 'function');
  assert.equal(adapter.status, undefined);
});

test('runtime restart delegates to each platform manager', async () => {
  const linuxCalls = [];
  const linux = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'linux',
    runner: async (command, args, options) => {
      linuxCalls.push({ args, command, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  });
  await linux.restart();
  assert.deepEqual(linuxCalls.at(-1), {
    command: 'systemctl',
    args: ['--user', 'restart', 'wheelmaker-hub.service'],
    options: { allowFailure: false },
  });

  const macCalls = [];
  const mac = createRuntimeAdapter({
    paths: { ...RUNTIME_PATHS, uid: 501 },
    platform: 'darwin',
    runner: async (command, args, options) => {
      macCalls.push({ args, command, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  });
  await mac.restart();
  assert.deepEqual(macCalls.at(-1), {
    command: 'launchctl',
    args: ['kickstart', '-k', 'gui/501/com.wheelmaker.hub'],
    options: undefined,
  });

  const windowsCalls = [];
  const windows = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    runner: async (command, args) => {
      windowsCalls.push({ args, command });
      return { code: 0, stderr: '', stdout: '' };
    },
  });
  await windows.restart();
  // Windows has no atomic "restart task + workers" primitive: Stop-ScheduledTask
  // only ends the guardian and leaves detached worker grandchildren alive. Restart
  // must therefore reuse the proven stop (which kills every wheelmaker.exe worker
  // by path) followed by start, instead of a detached self-restart script.
  assert.equal(windowsCalls.length, 2);
  assert.equal(windowsCalls[0].command, 'powershell');
  const windowsStop = windowsCalls[0].args.at(-1);
  assert.match(windowsStop, /Stop-ScheduledTask -TaskName 'WheelMaker'/);
  assert.match(windowsStop, /function Get-WheelMakerHubProcesses/);
  assert.match(windowsStop, /do \{/);
  assert.match(windowsStop, /while \(\(Get-Date\) -lt \$deadline\)/);
  assert.match(windowsStop, /Stop-Process/);
  assert.match(windowsStop, /Timed out stopping WheelMaker Hub processes/);
  assert.match(windowsCalls[1].args.at(-1), /Start-ScheduledTask -TaskName 'WheelMaker'/);
  assert.equal(
    windowsCalls.some((entry) => /Start-Process/.test(entry.args.at(-1))),
    false,
  );
});

test('runtime health requires the registered task and an actual Hub worker', async () => {
  let windowsHealthScript = '';
  const windows = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    runner: async (_command, args) => {
      windowsHealthScript = args.at(-1);
      return { code: 0, stderr: '', stdout: '' };
    },
  });
  assert.equal(await windows.isHubRunning(), true);
  assert.match(
    windowsHealthScript,
    /\(\^\|\\s\)--hub-worker\(\\s\|\$\)/,
  );
  assert.doesNotMatch(
    windowsHealthScript,
    /\(\^\|s\)--hub-worker\(s\|\$\)/,
  );
  assert.match(windowsHealthScript, /ExecutablePath/);

  for (const platform of ['linux', 'darwin']) {
    const calls = [];
    const adapter = createRuntimeAdapter({
      paths: {
        ...RUNTIME_PATHS,
        hub: '/home/alice/.wheelmaker/bin/wheelmaker',
      },
      platform,
      runner: async (command, args) => {
        calls.push({ args, command });
        return {
          code: command === 'pgrep' ? 1 : 0,
          stderr: '',
          stdout: '',
        };
      },
    });
    assert.equal(await adapter.isHubRunning(), false, platform);
    assert.equal(
      calls.some(
        (call) =>
          call.command === 'pgrep' &&
          call.args.includes('-f') &&
          call.args.some((argument) => argument.includes('--hub-worker')),
      ),
      true,
      platform,
    );
  }
});

test('core rejects retired runtime actions even when an adapter defines them', async () => {
  for (const action of ['status']) {
    await assert.rejects(
      () =>
        runCore(['runtime', action], {
          runtime: { async [action]() {} },
        }),
      /unknown runtime action/,
    );
  }
});

test('only one update lease can be created atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-lease-'));
  try {
    assert.equal(
      await acquireUpdateLease(root, {
        jobId: 'job-a',
        now: '2026-07-16T09:00:00.000Z',
        owner: 'web',
      }),
      true,
    );
    assert.equal(
      await acquireUpdateLease(root, {
        jobId: 'job-b',
        now: '2026-07-16T09:01:00.000Z',
        owner: 'timer',
      }),
      false,
    );
    const lock = JSON.parse(await readFile(join(root, 'lock.json'), 'utf8'));
    assert.equal(lock.jobId, 'job-a');
    assert.equal(lock.state, 'queued');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('terminal status removes matching lock but persists status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-finish-'));
  try {
    await acquireUpdateLease(root, {
      jobId: 'job-a',
      now: '2026-07-16T09:00:00.000Z',
      owner: 'web',
    });
    await finishUpdate(root, {
      errorCode: 'download_failed',
      jobId: 'job-a',
      now: '2026-07-16T09:02:00.000Z',
      state: 'failed',
    });
    assert.equal(await exists(join(root, 'lock.json')), false);
    const status = JSON.parse(await readFile(join(root, 'status.json'), 'utf8'));
    assert.equal(status.state, 'failed');
    assert.equal(status.errorCode, 'download_failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale lease is reclaimed only when updater is not running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-stale-'));
  try {
    await acquireUpdateLease(root, {
      jobId: 'old-job',
      now: '2026-07-16T06:00:00.000Z',
      owner: 'timer',
    });
    assert.equal(
      await acquireUpdateLease(
        root,
        {
          jobId: 'blocked-job',
          now: '2026-07-16T09:00:01.000Z',
          owner: 'web',
        },
        { isUpdaterRunning: async () => true },
      ),
      false,
    );
    assert.equal(
      await acquireUpdateLease(
        root,
        {
          jobId: 'new-job',
          now: '2026-07-16T09:00:02.000Z',
          owner: 'web',
        },
        { isUpdaterRunning: async () => false },
      ),
      true,
    );
    const lock = JSON.parse(await readFile(join(root, 'lock.json'), 'utf8'));
    assert.equal(lock.jobId, 'new-job');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manifest and completed archive are verified before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-stage-'));
  const source = join(root, 'source');
  const archivePath = join(root, 'package.tar.zst');
  try {
    await mkdir(join(source, 'hub'), { recursive: true });
    await mkdir(join(source, 'web'), { recursive: true });
    await writeFile(join(source, 'hub', 'wheelmaker'), 'hub');
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await createTarZst({ outputPath: archivePath, sourceDir: source });
    const archiveBytes = await readFile(archivePath);
    const manifest = {
      schema: 2,
      version: 'v1.7',
      publishedAt: '2026-07-16T09:00:00.000Z',
      sourceSha: '0'.repeat(40),
      artifacts: {
        'darwin-amd64': {
          sha256: sha256Bytes(archiveBytes),
          size: archiveBytes.length,
          path: '/releases/v1.7/wheelmaker-v1.7-darwin-amd64.tar.zst',
        },
      },
    };
    const manifestBytes = encodeJsonBytes(manifest);
    const stable = {
      androidApk: {
        sha256: 'f'.repeat(64),
        size: 123,
        path: '/releases/v1.7/WheelMakerAndroid.apk',
        version: 'v1.7',
        versionCode: 7,
        versionName: '1.7',
      },
      schema: 2,
      version: 'v1.7',
      sourceSha: '0'.repeat(40),
      release: {
        manifestSha256: sha256Bytes(manifestBytes),
        manifestPath: '/releases/v1.7/release-manifest.json',
      },
    };
    const downloads = new Map([
      ['https://release.example/releases/v1.7/release-manifest.json', manifestBytes],
      ['https://release.example/releases/v1.7/wheelmaker-v1.7-darwin-amd64.tar.zst', archiveBytes],
    ]);

    const fetched = [];
    const result = await stageVerifiedRelease({
      fetchBytes: async (url, options) => {
        fetched.push({label: options?.label, url});
        return downloads.get(url);
      },
      jobId: 'job-a',
      platform: 'darwin-amd64',
      releaseBaseUrl: 'https://release.example',
      stable,
      stagingDirectory: join(root, 'staging'),
    });
    assert.equal(
      await readFile(join(result.extractionDirectory, 'hub', 'wheelmaker'), 'utf8'),
      'hub',
    );
    assert.deepEqual(fetched, [
      {label: 'release manifest', url: 'https://release.example/releases/v1.7/release-manifest.json'},
      {
        label: 'darwin-amd64 release package',
        url: 'https://release.example/releases/v1.7/wheelmaker-v1.7-darwin-amd64.tar.zst',
      },
    ]);

    const tamperedArchive = Buffer.from(archiveBytes);
    tamperedArchive[tamperedArchive.length - 1] ^= 0xff;
    downloads.set('https://release.example/releases/v1.7/wheelmaker-v1.7-darwin-amd64.tar.zst', tamperedArchive);
    await assert.rejects(
      () =>
        stageVerifiedRelease({
          fetchBytes: async (url) => downloads.get(url),
          jobId: 'job-b',
          platform: 'darwin-amd64',
          releaseBaseUrl: 'https://release.example',
          stable,
          stagingDirectory: join(root, 'staging'),
        }),
      /archive SHA-256 verification failed/,
    );
    assert.equal(await exists(join(root, 'staging', 'job-b', 'package')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('normal deploy applies Hub and Web to the existing layout', async (t) => {
  const fixture = await installFixture(t);
  await mkdir(join(fixture.home, 'desktop'), { recursive: true });
  await mkdir(join(fixture.home, 'data'), { recursive: true });
  await mkdir(join(fixture.home, 'logs'), { recursive: true });
  await writeFile(
    join(fixture.home, 'desktop', 'WheelMakerDesktop.exe'),
    'desktop',
  );
  await writeFile(
    join(fixture.home, 'desktop', 'update.exe'),
    'legacy-updater',
  );
  await writeFile(join(fixture.home, 'data', 'sessions.db'), 'db');
  await writeFile(join(fixture.home, 'logs', 'hub.log'), 'log');
  for (const name of ['restart.bat', 'restart.sh', 'status.bat', 'status.sh']) {
    await writeFile(join(fixture.home, name), name);
  }

  await runCore(['--public-url=https://workspace.example.com'], fixture.deps);

  assert.equal(await exists(join(fixture.home, 'bin', 'wheelmaker.exe')), true);
  assert.equal(await readFile(join(fixture.home, 'web', 'index.html'), 'utf8'), 'new-web');
  assert.equal(await exists(join(fixture.home, 'app')), false);
  assert.equal(
    await readFile(
      join(fixture.home, 'desktop', 'WheelMakerDesktop.exe'),
      'utf8',
    ),
    'desktop',
  );
  assert.equal(
    await readFile(join(fixture.home, 'desktop', 'update.exe'), 'utf8'),
    'legacy-updater',
  );
  assert.equal(await readFile(join(fixture.home, 'data', 'sessions.db'), 'utf8'), 'db');
  assert.equal(await readFile(join(fixture.home, 'logs', 'hub.log'), 'utf8'), 'log');
  for (const name of ['restart.bat', 'restart.sh', 'status.bat', 'status.sh']) {
    assert.equal(await exists(join(fixture.home, name)), false);
  }
  assert.equal(fixture.events.includes('configure-runtime'), true);
  assert.equal(fixture.events.includes('write-wrappers'), true);
  assert.deepEqual(fixture.messages, [
    'Downloading release v1.23',
    'Verifying release v1.23',
    'Applying Hub and Web',
    'Configuring runtime',
    'Starting Hub',
    'Deployment completed: v1.23',
  ]);

  const config = JSON.parse(await readFile(join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(config.publicUrl, 'https://workspace.example.com');
  assert.deepEqual(config.projects, []);
  assert.match(config.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(config.hubId, 'local-hub');
  assert.equal('server' in config.registry, false);
  assert.equal('token' in config.registry, false);
  assert.equal('hubId' in config.registry, false);
});

test('fresh Windows deploy does not create a Desktop updater binary', async (t) => {
  const fixture = await installFixture(t);

  await runCore(['--public-url=https://workspace.example.com'], fixture.deps);

  assert.equal(
    await exists(join(fixture.home, 'desktop', 'update.exe')),
    false,
  );
});

test('normal deploy migrates legacy config and secures it without losing user fields', async (t) => {
  const fixture = await installFixture(t);
  const configPath = join(fixture.home, 'config.json');
  await mkdir(fixture.home, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    custom: { keep: true },
    monitor: { enabled: true },
    projects: [{ name: 'Existing', path: 'D:\\Existing' }],
    registry: {
      hubId: 'existing-hub',
      listen: false,
      server: '127.0.0.1',
      token: 'wheelmaker-local-token',
    },
  }));
  const secured = [];
  fixture.deps.secureConfigFile = async (path) => secured.push(path);

  await runCore(['--public-url=https://workspace.example.com'], fixture.deps);

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal('monitor' in config, false);
  assert.deepEqual(config.custom, { keep: true });
  assert.deepEqual(config.projects, [{ name: 'Existing', path: 'D:\\Existing' }]);
  assert.equal(config.registry.hubId, 'existing-hub');
  assert.equal(config.registry.listen, false);
  assert.equal(config.registry.server, '127.0.0.1');
  assert.equal(config.publicUrl, 'https://workspace.example.com');
  assert.notEqual(config.registry.token, 'wheelmaker-local-token');
  assert.match(config.registry.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(secured, [configPath]);
});

test('normal deploy preserves canonical top-level identity placement', async (t) => {
  const fixture = await installFixture(t);
  const configPath = join(fixture.home, 'config.json');
  await mkdir(fixture.home, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    projects: [],
    publicUrl: 'https://workspace.example.com',
    token: 'existing-top-level-token',
    hubId: 'existing-top-level-hub',
    registry: { listen: false, port: 9630 },
  }));

  await runCore([], fixture.deps);

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.token, 'existing-top-level-token');
  assert.equal(config.hubId, 'existing-top-level-hub');
  assert.equal('token' in config.registry, false);
  assert.equal('hubId' in config.registry, false);
});

test('normal deploy preserves nested share configuration', async (t) => {
  const fixture = await installFixture(t);
  const configPath = join(fixture.home, 'config.json');
  await mkdir(fixture.home, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    projects: [],
    publicUrl: 'https://workspace.example.com',
    share: { publicUrl: 'https://share.example.com' },
  }));

  await runCore([], fixture.deps);

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(config.share, { publicUrl: 'https://share.example.com' });
});

test('normal deploy keeps legacy server text when no public URL is supplied', async (t) => {
  const fixture = await installFixture(t);
  const configPath = join(fixture.home, 'config.json');
  await mkdir(fixture.home, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    projects: [],
    registry: {
      listen: false,
      server: 'registry.example.com:28800',
      token: 'existing-token',
    },
  }));
  fixture.deps.interactive = true;
  fixture.deps.publicURLQuestion = async () => {
    throw new Error('existing config must not prompt for public URL');
  };

  await runCore([], fixture.deps);

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal('publicUrl' in config, false);
  assert.equal(config.registry.server, 'registry.example.com:28800');
  assert.equal(config.registry.token, 'existing-token');
});

test('normal Linux deploy checks runtime prerequisites before staging files', async (t) => {
  const fixture = await installFixture(t, { platform: 'linux' });
  fixture.deps.runtime.checkPrerequisites = async () => {
    fixture.events.push('prerequisites');
    throw new Error('linger is disabled');
  };

  await assert.rejects(() => runCore([], fixture.deps), /linger is disabled/);

  assert.deepEqual(fixture.events, ['prerequisites']);
  assert.equal(await exists(join(fixture.home, 'staging', 'lock.json')), false);
});

test('Windows package apply retries a temporarily locked Hub binary', async (t) => {
  const fixture = await installFixture(t);
  const target = join(fixture.home, 'bin', 'wheelmaker.exe');
  await mkdir(join(fixture.home, 'bin'), { recursive: true });
  await writeFile(target, 'old-hub');
  let removeAttempts = 0;
  const delays = [];
  fixture.deps.fileOperations = {
    async remove(path, options) {
      if (path === target) {
        removeAttempts += 1;
        if (removeAttempts < 3) {
          const error = new Error('binary is still locked');
          error.code = 'EPERM';
          throw error;
        }
      }
      return rm(path, options);
    },
    rename,
  };
  fixture.deps.replaceSleep = async (milliseconds) => delays.push(milliseconds);

  await runCore(['update'], fixture.deps);

  assert.equal(removeAttempts, 3);
  assert.deepEqual(delays, [300, 300]);
  assert.equal(await readFile(target, 'utf8'), 'new-hub');
});

test('Unix package apply atomically renames the Hub without deleting its target first', async (t) => {
  const fixture = await installFixture(t, { platform: 'linux' });
  const target = join(fixture.home, 'bin', 'wheelmaker');
  await mkdir(join(fixture.home, 'bin'), { recursive: true });
  await writeFile(target, 'old-hub');
  let targetRemoveCalls = 0;
  let targetRenameCalls = 0;
  fixture.deps.fileOperations = {
    async remove(path, options) {
      if (path === target) targetRemoveCalls += 1;
      return rm(path, options);
    },
    async rename(source, destination) {
      if (destination === target) targetRenameCalls += 1;
      return rename(source, destination);
    },
  };

  await runCore(['update'], fixture.deps);

  assert.equal(targetRemoveCalls, 0);
  assert.equal(targetRenameCalls, 1);
  assert.equal(await readFile(target, 'utf8'), 'new-hub');
});

async function createDesktopUpdateFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-desktop-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  const target = join(home, 'desktop', 'WheelMakerDesktop.exe');
  const desktop = overrides.desktop ?? Buffer.from('desktop-v1.2');
  await mkdir(join(home, 'desktop'), { recursive: true });
  await writeFile(target, 'old-desktop');

  return {
    desktop,
    home,
    target,
    deps: {
      fetchBytes: overrides.fetchBytes ?? (async () => desktop),
      installDirectory: home,
      isDesktopRunning: overrides.isDesktopRunning ?? (async () => false),
      platform: 'win32',
      trustedReleaseBaseUrl: 'https://release.example',
      trustedStable: {
        schema: 2,
        version: 'v1.3',
        desktopExe: {
          version: 'v1.2',
          path: '/releases/v1.2/WheelMakerDesktop.exe',
          sha256: sha256Bytes(desktop),
        },
      },
      ...(overrides.waitForDesktopExit
        ? { waitForDesktopExit: overrides.waitForDesktopExit }
        : {}),
    },
  };
}

test('Desktop self-update waits for the exact PID before checking other instances', async (t) => {
  const events = [];
  const desktop = Buffer.from('desktop-v1.2');
  const fixture = await createDesktopUpdateFixture(t, {
    desktop,
    waitForDesktopExit: async (pid) => {
      events.push(`wait:${pid}`);
    },
    isDesktopRunning: async () => {
      events.push('check-running');
      return false;
    },
    fetchBytes: async () => {
      events.push('download');
      return desktop;
    },
  });

  await runCore(
    ['desktop-self-update', '--parent-pid', '42'],
    fixture.deps,
  );

  assert.deepEqual(events, ['wait:42', 'check-running', 'download']);
});

test('Desktop self-update stops when waiting for the parent PID fails', async (t) => {
  let downloadCalls = 0;
  const fixture = await createDesktopUpdateFixture(t, {
    waitForDesktopExit: async () => {
      throw new Error('wait failed');
    },
    fetchBytes: async () => {
      downloadCalls += 1;
      return Buffer.from('new-desktop');
    },
  });

  await assert.rejects(
    () =>
      runCore(
        ['desktop-self-update', '--parent-pid', '42'],
        fixture.deps,
      ),
    /wait failed/,
  );
  assert.equal(downloadCalls, 0);
});

test('Desktop self-update treats a missing PID as exited and otherwise waits on the captured process', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  const runnerCalls = [];

  await runCore(
    ['desktop-self-update', '--parent-pid', '77'],
    {
      ...fixture.deps,
      runner: async (command, args) => {
        runnerCalls.push({ command, args });
        return { code: 0, stderr: '', stdout: '' };
      },
    },
  );

  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0].command, 'powershell');
  assert.deepEqual(runnerCalls[0].args.slice(0, 2), [
    '-NoProfile',
    '-NonInteractive',
  ]);
  const script = runnerCalls[0].args.at(-1);
  assert.match(script, /Get-Process -Id 77/);
  assert.match(script, /if \(\$null -eq \$process\) { exit 0 }/);
  assert.match(script, /Wait-Process -InputObject \$process/);
  assert.doesNotMatch(script, /Wait-Process -Id/);
});

test('Desktop self-update defensively rejects invalid parent PIDs', async () => {
  for (const args of [
    ['desktop-self-update'],
    ['desktop-self-update', '--parent-pid', '0'],
    ['desktop-self-update', '--parent-pid', 'abc'],
    ['desktop-self-update', '--parent-pid', '42', 'extra'],
  ]) {
    await assert.rejects(
      () => runCore(args, {}),
      /parent PID must be a positive integer/,
    );
  }
});

test('legacy updater-driven desktop-update refreshes the capable BAT before replacement', async (t) => {
  const desktop = Buffer.from('desktop-v1.2');
  let wrapperAtDownload;
  const fixture = await createDesktopUpdateFixture(t, {
    desktop,
    fetchBytes: async () => {
      wrapperAtDownload = await readFile(
        join(fixture.home, 'update_exe.bat'),
        'utf8',
      );
      return desktop;
    },
  });

  await runCore(['desktop-update'], {
    ...fixture.deps,
    isLegacyDesktopUpdaterParent: async () => true,
  });

  assert.match(
    wrapperAtDownload,
    /^@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n/,
  );
});

test('manual desktop-update does not rewrite its running BAT', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  const wrapperPath = join(fixture.home, 'update_exe.bat');
  await writeFile(wrapperPath, 'manual-wrapper');

  await runCore(['desktop-update'], {
    ...fixture.deps,
    isLegacyDesktopUpdaterParent: async () => false,
  });

  assert.equal(await readFile(wrapperPath, 'utf8'), 'manual-wrapper');
});

test('desktop-update recognizes only the installed legacy helper parent', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  const runnerCalls = [];

  await runCore(['desktop-update'], {
    ...fixture.deps,
    parentPID: 123,
    runner: async (command, args, options) => {
      runnerCalls.push({ command, args, options });
      return { code: 1, stderr: '', stdout: '' };
    },
  });

  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0].command, 'powershell');
  assert.equal(runnerCalls[0].options.allowFailure, true);
  const script = runnerCalls[0].args.at(-1);
  assert.match(script, /ProcessId = 123/);
  assert.match(script, /desktop[\\/]update\.exe/i);
  assert.match(script, /OrdinalIgnoreCase/);
  assert.equal(
    await exists(join(fixture.home, 'update_exe.bat')),
    false,
  );
});

test('Desktop update follows carried stable pointer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-desktop-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  const target = join(home, 'desktop', 'WheelMakerDesktop.exe');
  await mkdir(join(home, 'desktop'), { recursive: true });
  await writeFile(target, 'old-desktop');
  await writeFile(
    join(home, 'release.json'),
    '{"schemaVersion":2,"version":"v1.1"}\n',
  );
  const nextDesktop = Buffer.from('desktop-v1.2');
  const desktopUrl = 'https://release.example/releases/v1.2/WheelMakerDesktop.exe';

  await runCore(['desktop-update'], {
    fetchBytes: async (url) => {
      assert.equal(url, desktopUrl);
      return nextDesktop;
    },
    installDirectory: home,
    isDesktopRunning: async () => false,
    trustedReleaseBaseUrl: 'https://release.example',
    trustedStable: {
      schema: 2,
      version: 'v1.3',
      desktopExe: {
        version: 'v1.2',
        path: '/releases/v1.2/WheelMakerDesktop.exe',
        sha256: sha256Bytes(nextDesktop),
      },
    },
  });

  assert.deepEqual(await readFile(target), nextDesktop);
  assert.equal(
    await readFile(join(home, 'release.json'), 'utf8'),
    '{"schemaVersion":2,"version":"v1.1"}\n',
  );
  assert.equal(await exists(`${target}.tmp`), false);
});

test('Desktop update refuses to replace a running executable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-desktop-running-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let downloadCalls = 0;

  await assert.rejects(
    () =>
      runCore(['desktop-update'], {
        fetchBytes: async () => {
          downloadCalls += 1;
          return Buffer.from('new-desktop');
        },
        installDirectory: join(root, '.wheelmaker'),
        isDesktopRunning: async () => true,
        trustedReleaseBaseUrl: 'https://release.example',
        trustedStable: {
          schema: 2,
          version: 'v1.3',
          desktopExe: {
            version: 'v1.2',
            path: '/releases/v1.2/WheelMakerDesktop.exe',
            sha256: sha256Bytes(Buffer.from('new-desktop')),
          },
        },
      }),
    /close WheelMaker Desktop/i,
  );
  assert.equal(downloadCalls, 0);
});

test('migrate-uninstall removes legacy runtimes and preserves user data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  for (const directory of [
    join(home, 'bin'),
    join(home, 'build', 'bootstrap'),
    join(home, 'build', 'mobile', 'android'),
    join(home, 'cache', 'go-build'),
    join(home, 'cache', 'wheelmaker'),
    join(home, 'data'),
    join(home, 'logs'),
    join(home, 'desktop'),
    join(home, 'mobile', 'android'),
    join(home, 'tmp'),
  ]) {
    await mkdir(directory, { recursive: true });
  }
  for (const name of [
    'wheelmaker.exe',
    'wheelmaker-updater.exe',
    'wheelmaker-deploy.exe',
    'wheelmaker-monitor.exe',
  ]) {
    await writeFile(join(home, 'bin', name), name);
  }
  await writeFile(join(home, 'build', 'bootstrap', 'wheelmaker-deploy.exe'), 'bootstrap');
  await writeFile(join(home, 'build', 'mobile', 'android', 'old.apk'), 'android');
  await writeFile(join(home, 'cache', 'go-build', 'cache-entry'), 'go-build');
  await writeFile(join(home, 'cache', 'wheelmaker', 'agent-entry'), 'agent');
  await writeFile(join(home, 'config.json'), '{"projects":[]}\n');
  await writeFile(join(home, 'data', 'sessions.db'), 'db');
  await writeFile(join(home, 'logs', 'hub.log'), 'log');
  await writeFile(join(home, 'desktop', 'WheelMakerDesktop.exe'), 'desktop');
  await writeFile(join(home, 'mobile', 'android', 'old.apk'), 'android');
  await writeFile(join(home, 'tmp', 'deploy.tmp'), 'tmp');
  await writeFile(join(home, 'update-now.signal'), 'full-update');
  await writeFile(join(home, 'release.json'), '{"schemaVersion":2,"version":"v1.5"}\n');
  for (const name of ['restart.bat', 'restart.sh', 'status.bat', 'status.sh']) {
    await writeFile(join(home, name), name);
  }

  let runtimeRemoved = false;
  const messages = [];
  await runCore(['migrate-uninstall'], {
    installDirectory: home,
    legacyMigration: {
      async removeRuntime() {
        runtimeRemoved = true;
      },
    },
    platform: 'win32',
    reportStatus(message) {
      messages.push(message);
    },
  });

  assert.equal(runtimeRemoved, true);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker.exe')), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker-updater.exe')), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker-deploy.exe')), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker-monitor.exe')), false);
  assert.equal(await exists(join(home, 'build')), false);
  assert.equal(await exists(join(home, 'cache')), false);
  assert.equal(await exists(join(home, 'mobile')), false);
  assert.equal(await exists(join(home, 'tmp')), false);
  assert.equal(await exists(join(home, 'update-now.signal')), false);
  assert.equal(await exists(join(home, 'release.json')), false);
  for (const name of ['restart.bat', 'restart.sh', 'status.bat', 'status.sh']) {
    assert.equal(await exists(join(home, name)), false);
  }
  assert.equal(await exists(join(home, 'config.json')), true);
  assert.equal(await exists(join(home, 'data', 'sessions.db')), true);
  assert.equal(await exists(join(home, 'logs', 'hub.log')), true);
  assert.equal(await exists(join(home, 'desktop', 'WheelMakerDesktop.exe')), true);
  assert.deepEqual(messages, [
    'Removing legacy services and files',
    'Legacy migration cleanup completed',
  ]);
});

test('Windows legacy migration elevates scheduled task and service removal', () => {
  const script = windowsLegacyMigrationScript(RUNTIME_PATHS);

  for (const name of ['WheelMaker', 'WheelMakerUpdater', 'WheelMakerMonitor']) {
    assert.match(script, new RegExp(name));
  }
  assert.match(script, /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run/);
  assert.match(script, /ExecutablePath/);
  assert.match(script, /StartsWith\(\$binRoot\)/);
  const elevatedBlock = script.slice(
    script.indexOf("$registrationRemoval = @'"),
    script.indexOf("'@", script.indexOf("$registrationRemoval = @'") + 1),
  );
  assert.match(elevatedBlock, /Unregister-ScheduledTask/);
  assert.match(elevatedBlock, /Get-Service/);
  assert.match(elevatedBlock, /Get-CimInstance Win32_Process/);
  assert.match(elevatedBlock, /CommandLine/);
  assert.match(elevatedBlock, /Stop-Process/);
  assert.match(elevatedBlock, /AddSeconds\(10\)/);
  assert.match(elevatedBlock, /Timed out stopping WheelMaker runtime processes/);
  assert.match(script, /sc\.exe delete/);
  assert.match(elevatedBlock, /for \(\$i = 0; \$i -lt 30; \$i\+\+\)/);
  assert.match(elevatedBlock, /Timed out deleting service \$name/);
  assert.match(script, /\$existingProcesses = @\(/);
  assert.match(script, /-Verb RunAs/);
  assert.equal(script.trimEnd().endsWith('exit 0'), true);
});

test('Windows legacy migration accepts a failed elevated exit when no registrations remain', () => {
  const script = windowsLegacyMigrationScript(RUNTIME_PATHS);
  const exitCheck = script.indexOf('if ($process.ExitCode -ne 0)');
  const remainingTasks = script.indexOf('$remainingTasks = @(', exitCheck);
  const remainingServices = script.indexOf('$remainingServices = @(', exitCheck);
  const remainingProcesses = script.indexOf('$remainingProcesses = @(', exitCheck);
  const remainingCheck = script.indexOf(
    'if ($remainingTasks.Count -gt 0 -or $remainingServices.Count -gt 0 -or $remainingProcesses.Count -gt 0)',
    exitCheck,
  );
  const failure = script.indexOf('throw "legacy registration removal incomplete', exitCheck);

  assert.notEqual(exitCheck, -1);
  assert.match(
    script.slice(exitCheck, remainingTasks),
    /\$registrationError\s*=/,
  );
  assert.doesNotMatch(
    script.slice(exitCheck, remainingTasks),
    /throw "elevated legacy registration removal failed/,
  );
  assert.ok(remainingTasks > exitCheck);
  assert.ok(remainingServices > remainingTasks);
  assert.ok(remainingProcesses > remainingServices);
  assert.ok(remainingCheck > remainingProcesses);
  assert.ok(failure > remainingCheck);
  assert.match(script, /wheelmaker-migrate-uninstall-/);
  assert.match(script, /Get-Content -Raw -LiteralPath \$diagnosticPath/);
});

test('Unix legacy migration disables registrations and removes their files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-runtime-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linuxHome = join(root, 'linux');
  const linuxUnits = [
    'wheelmaker-hub.service',
    'wheelmaker-updater.service',
    'wheelmaker-updater.timer',
    'wheelmaker-monitor.service',
  ];
  const unitDirectory = join(linuxHome, '.config', 'systemd', 'user');
  await mkdir(unitDirectory, { recursive: true });
  for (const unit of linuxUnits) await writeFile(join(unitDirectory, unit), unit);
  const linuxCalls = [];
  await createLegacyMigrationAdapter({
    paths: { ...RUNTIME_PATHS, userHome: linuxHome },
    platform: 'linux',
    runner: async (command, args, options) => {
      linuxCalls.push({ args, command, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  }).removeRuntime();
  for (const unit of linuxUnits) {
    assert.equal(await exists(join(unitDirectory, unit)), false);
    assert.equal(
      linuxCalls.some(
        (call) =>
          call.command === 'systemctl' &&
          call.args.join(' ') === `--user disable --now ${unit}` &&
          call.options.allowFailure === true,
      ),
      true,
    );
  }
  assert.equal(
    linuxCalls.some(
      (call) => call.args.join(' ') === '--user daemon-reload',
    ),
    true,
  );

  const macHome = join(root, 'mac');
  const agentDirectory = join(macHome, 'Library', 'LaunchAgents');
  const macLabels = [
    'com.wheelmaker.hub',
    'com.wheelmaker.updater',
    'com.wheelmaker.monitor',
  ];
  await mkdir(agentDirectory, { recursive: true });
  for (const label of macLabels) {
    await writeFile(join(agentDirectory, `${label}.plist`), label);
  }
  const macCalls = [];
  await createLegacyMigrationAdapter({
    paths: { ...RUNTIME_PATHS, uid: 501, userHome: macHome },
    platform: 'darwin',
    runner: async (command, args, options) => {
      macCalls.push({ args, command, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  }).removeRuntime();
  for (const label of macLabels) {
    assert.equal(await exists(join(agentDirectory, `${label}.plist`)), false);
    assert.equal(
      macCalls.some(
        (call) =>
          call.command === 'launchctl' &&
          call.args.join(' ') === `bootout gui/501/${label}` &&
          call.options.allowFailure === true,
      ),
      true,
    );
  }
});

test('successful internal update writes release schema v2 without registration changes', async (t) => {
  const fixture = await installFixture(t);
  await mkdir(join(fixture.home, 'desktop'), {recursive: true});
  await writeFile(join(fixture.home, 'desktop', 'WheelMakerDesktop.exe'), 'desktop');
  await writeFile(
    join(fixture.home, 'desktop', 'update.exe'),
    'legacy-updater',
  );
  await runCore(['update'], fixture.deps);

  assert.deepEqual(
    JSON.parse(await readFile(join(fixture.home, 'release.json'), 'utf8')),
    {
      schemaVersion: 2,
      version: 'v1.23',
      publishedAt: '2026-07-16T09:00:00Z',
      sourceSha: fixture.sourceSha,
      manifestSha256: fixture.manifestSha,
      installedAt: fixture.installedAt,
    },
  );
  assert.equal(fixture.events.includes('configure-runtime'), false);
  assert.equal(fixture.events.includes('write-wrappers'), false);
  assert.equal(
    await readFile(join(fixture.home, 'desktop', 'WheelMakerDesktop.exe'), 'utf8'),
    'desktop',
  );
  assert.equal(
    await readFile(join(fixture.home, 'desktop', 'update.exe'), 'utf8'),
    'legacy-updater',
  );
  assert.deepEqual(
    fixture.events.filter((event) => ['stop', 'start'].includes(event)),
    ['stop', 'start'],
  );
  assert.equal(await exists(join(fixture.home, 'staging', 'lock.json')), false);
  const status = JSON.parse(
    await readFile(join(fixture.home, 'staging', 'status.json'), 'utf8'),
  );
  assert.equal(status.jobId, 'timer-job');
  assert.equal(status.state, 'succeeded');
  assert.equal(await exists(join(fixture.home, 'staging', 'timer-job')), false);
});

test('Linux legacy migration ignores missing units but propagates real systemctl failures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-linux-migration-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { ...RUNTIME_PATHS, userHome: root };

  await createLegacyMigrationAdapter({
    paths,
    platform: 'linux',
    runner: async (_command, args) => ({
      code: args.includes('daemon-reload') ? 0 : 1,
      stderr: 'Unit wheelmaker-hub.service does not exist.',
      stdout: '',
    }),
  }).removeRuntime();

  await assert.rejects(
    () => createLegacyMigrationAdapter({
      paths,
      platform: 'linux',
      runner: async () => ({
        code: 1,
        stderr: 'Failed to connect to bus: Permission denied',
        stdout: '',
      }),
    }).removeRuntime(),
    /Permission denied/,
  );
});

test('Linux internal update does not rewrite user units or wrappers', async (t) => {
  const fixture = await installFixture(t, { platform: 'linux' });

  await runCore(['update'], fixture.deps);

  assert.equal(fixture.events.includes('configure-runtime'), false);
  assert.equal(fixture.events.includes('write-wrappers'), false);
  assert.deepEqual(
    fixture.events.filter((event) =>
      ['stop', 'configure-runtime', 'start'].includes(event),
    ),
    ['stop', 'start'],
  );
  assert.equal(fixture.messages.includes('Configuring runtime'), false);
  assert.equal(await exists(join(fixture.home, 'desktop')), false);
});

test('Hub health timeout persists failure and removes the update lock', async (t) => {
  const fixture = await installFixture(t, { hubRunning: false });
  await assert.rejects(() => runCore(['update'], fixture.deps), /Hub did not start/);
  assert.equal(await exists(join(fixture.home, 'staging', 'lock.json')), false);
  const status = JSON.parse(
    await readFile(join(fixture.home, 'staging', 'status.json'), 'utf8'),
  );
  assert.equal(status.state, 'failed');
  assert.equal(status.errorCode, 'hub_start_timeout');
  assert.equal('stack' in status, false);
  assert.equal('message' in status, false);
  assert.equal(await exists(join(fixture.home, 'staging', 'timer-job')), false);
});

test('deployment fallback restores Go pre-migration config before starting old runtime', async (t) => {
  const fixture = await installFixture(t);
  const configPath = join(fixture.home, 'config.json');
  const backupPath = `${configPath}.pre-migration`;
  await mkdir(fixture.home, { recursive: true });
  const legacy = JSON.stringify({
    projects: [],
    registry: {
      listen: false,
      port: 9630,
      server: '127.0.0.1',
      token: 'legacy-token',
      hubId: 'legacy-hub',
    },
  });
  await writeFile(backupPath, legacy);
  await writeFile(configPath, JSON.stringify({
    projects: [],
    token: 'new-token',
    hubId: 'new-hub',
    registry: { listen: false, port: 9630 },
  }));
  fixture.deps.secureConfigFile = async () => {};
  let starts = 0;
  const originalStart = fixture.deps.runtime.start;
  fixture.deps.runtime.start = async () => {
    starts += 1;
    if (starts === 1) throw new Error('new runtime failed');
    const restored = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(restored.registry.server, '127.0.0.1');
    assert.equal(restored.registry.token, 'legacy-token');
    assert.equal(restored.registry.hubId, 'legacy-hub');
    await originalStart();
  };

  await assert.rejects(() => runCore([], fixture.deps), /new runtime failed/);
  assert.equal(starts, 2);
  assert.equal(await exists(backupPath), false);
});

async function installFixture(t, { hubRunning = true, platform = 'win32' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  const packageDirectory = join(root, 'package');
  await mkdir(join(packageDirectory, 'hub'), { recursive: true });
  await mkdir(join(packageDirectory, 'web'), { recursive: true });
  await writeFile(
    join(packageDirectory, 'hub', platform === 'win32' ? 'wheelmaker.exe' : 'wheelmaker'),
    'new-hub',
  );
  await writeFile(join(packageDirectory, 'web', 'index.html'), 'new-web');

  const sourceSha = '1'.repeat(40);
  const manifestSha = '2'.repeat(64);
  const installedAt = '2026-07-16T09:05:00.000Z';
  const events = [];
  const messages = [];
  const runtime = {
    async configureRuntime() {
      events.push('configure-runtime');
    },
    async isHubRunning() {
      events.push('health');
      return hubRunning;
    },
    async start() {
      events.push('start');
    },
    async stop() {
      events.push('stop');
    },
    async writeWrappers() {
      events.push('write-wrappers');
    },
  };
  return {
    deps: {
      healthPollIntervalMs: 1,
      healthTimeoutMs: 3,
      installDirectory: home,
      jobIdFactory: () => 'timer-job',
      now: () => installedAt,
      platform,
      reportStatus(message) {
        messages.push(message);
      },
      runtime,
      sleep: async () => {},
      async stageRelease({ jobId, onPhase }) {
        events.push('stage');
        await onPhase('verifying');
        const extractionDirectory = join(home, 'staging', jobId, 'package');
        await cp(packageDirectory, extractionDirectory, {recursive: true});
        return { extractionDirectory, manifestSha256: manifestSha };
      },
      trustedStable: {
        schema: 2,
        version: 'v1.23',
        publishedAt: '2026-07-16T09:00:00Z',
        sourceSha,
      },
    },
    events,
    home,
    installedAt,
    manifestSha,
    messages,
    sourceSha,
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
