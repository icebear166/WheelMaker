import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireUpdateLease,
  createLegacyMigrationAdapter,
  createRuntimeAdapter,
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
import { createTarGz } from '../release/tar.mjs';

const RUNTIME_PATHS = {
  bin: 'C:\\Users\\alice\\.wheelmaker\\bin',
  deploy: 'C:\\Users\\alice\\.wheelmaker\\deploy.mjs',
  home: 'C:\\Users\\alice\\.wheelmaker',
  hub: 'C:\\Users\\alice\\.wheelmaker\\bin\\wheelmaker.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  uid: 501,
  userHome: 'C:\\Users\\alice',
};

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
  assert.match(files['wheelmaker-updater.service'], /Type=oneshot/);
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
  assert.match(windows['update_exe.bat'], /deploy\.mjs" desktop-update/);
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

test('runtime adapter exposes only manual start and stop actions', () => {
  const adapter = createRuntimeAdapter({
    paths: RUNTIME_PATHS,
    platform: 'win32',
    async runner() {},
  });
  assert.equal(typeof adapter.start, 'function');
  assert.equal(typeof adapter.stop, 'function');
  assert.equal(adapter.restart, undefined);
  assert.equal(adapter.status, undefined);
});

test('core rejects retired runtime actions even when an adapter defines them', async () => {
  for (const action of ['restart', 'status']) {
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
  const archivePath = join(root, 'package.tar.gz');
  try {
    await mkdir(join(source, 'hub'), { recursive: true });
    await mkdir(join(source, 'web'), { recursive: true });
    await writeFile(join(source, 'hub', 'wheelmaker.exe'), 'hub');
    await writeFile(join(source, 'web', 'index.html'), 'web');
    await createTarGz({ outputPath: archivePath, sourceDir: source });
    const archiveBytes = await readFile(archivePath);
    const manifest = {
      schema: 1,
      version: 'v1.7',
      publishedAt: '2026-07-16T09:00:00.000Z',
      sourceSha: '0'.repeat(40),
      artifacts: {
        'windows-amd64': {
          sha256: sha256Bytes(archiveBytes),
          size: archiveBytes.length,
          url: 'https://release.example/windows.tar.gz',
        },
      },
    };
    const manifestBytes = encodeJsonBytes(manifest);
    const stable = {
      androidApk: {
        sha256: 'f'.repeat(64),
        size: 123,
        url: 'https://release.example/WheelMakerAndroid.apk',
        version: 'v1.7',
        versionCode: 7,
        versionName: '1.7',
      },
      schema: 1,
      version: 'v1.7',
      sourceSha: '0'.repeat(40),
      release: {
        manifestSha256: sha256Bytes(manifestBytes),
        manifestUrl: 'https://release.example/release-manifest.json',
      },
    };
    const downloads = new Map([
      [stable.release.manifestUrl, manifestBytes],
      [manifest.artifacts['windows-amd64'].url, archiveBytes],
    ]);

    const fetched = [];
    const result = await stageVerifiedRelease({
      fetchBytes: async (url, options) => {
        fetched.push({label: options?.label, url});
        return downloads.get(url);
      },
      jobId: 'job-a',
      platform: 'windows-amd64',
      stable,
      stagingDirectory: join(root, 'staging'),
    });
    assert.equal(
      await readFile(join(result.extractionDirectory, 'hub', 'wheelmaker.exe'), 'utf8'),
      'hub',
    );
    assert.deepEqual(fetched, [
      {label: 'release manifest', url: stable.release.manifestUrl},
      {
        label: 'windows-amd64 release package',
        url: manifest.artifacts['windows-amd64'].url,
      },
    ]);

    const tamperedArchive = Buffer.from(archiveBytes);
    tamperedArchive[tamperedArchive.length - 1] ^= 0xff;
    downloads.set(manifest.artifacts['windows-amd64'].url, tamperedArchive);
    await assert.rejects(
      () =>
        stageVerifiedRelease({
          fetchBytes: async (url) => downloads.get(url),
          jobId: 'job-b',
          platform: 'windows-amd64',
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
  await writeFile(join(fixture.home, 'data', 'sessions.db'), 'db');
  await writeFile(join(fixture.home, 'logs', 'hub.log'), 'log');
  for (const name of ['restart.bat', 'restart.sh', 'status.bat', 'status.sh']) {
    await writeFile(join(fixture.home, name), name);
  }

  await runCore([], fixture.deps);

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
  assert.deepEqual(config.projects, []);
  assert.match(config.registry.token, /^[A-Za-z0-9_-]{43}$/);
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
  const desktopUrl = 'https://release.example/v1.2/WheelMakerDesktop.exe';

  await runCore(['desktop-update'], {
    fetchBytes: async (url) => {
      assert.equal(url, desktopUrl);
      return nextDesktop;
    },
    installDirectory: home,
    isDesktopRunning: async () => false,
    trustedStable: {
      schema: 1,
      version: 'v1.3',
      desktopExe: {
        version: 'v1.2',
        url: desktopUrl,
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
        trustedStable: {
          schema: 1,
          version: 'v1.3',
          desktopExe: {
            version: 'v1.2',
            url: 'https://release.example/v1.2/WheelMakerDesktop.exe',
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
  assert.match(script, /sc\.exe delete/);
  assert.match(script, /-Verb RunAs/);
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
  await acquireUpdateLease(join(fixture.home, 'staging'), {
    jobId: 'web-job',
    now: fixture.installedAt,
    owner: 'web',
  });

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
  assert.deepEqual(
    fixture.events.filter((event) => ['stop', 'start'].includes(event)),
    ['stop', 'start'],
  );
  assert.equal(await exists(join(fixture.home, 'staging', 'lock.json')), false);
  const status = JSON.parse(
    await readFile(join(fixture.home, 'staging', 'status.json'), 'utf8'),
  );
  assert.equal(status.jobId, 'web-job');
  assert.equal(status.state, 'succeeded');
  assert.equal(await exists(join(fixture.home, 'staging', 'web-job')), false);
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

async function installFixture(t, { hubRunning = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, '.wheelmaker');
  const packageDirectory = join(root, 'package');
  await mkdir(join(packageDirectory, 'hub'), { recursive: true });
  await mkdir(join(packageDirectory, 'web'), { recursive: true });
  await writeFile(join(packageDirectory, 'hub', 'wheelmaker.exe'), 'new-hub');
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
      platform: 'win32',
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
        schema: 1,
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
