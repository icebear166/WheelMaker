import assert from 'node:assert/strict';
import {join} from 'node:path';
import test from 'node:test';

import {
  createGatewayRuntimeAdapter,
  darwinGatewayRuntimeFiles,
  gatewayRuntimePaths,
  gatewayWrapperFiles,
  linuxGatewayRuntimeFiles,
  windowsGatewayRuntimePlan,
} from './gateway-runtime.mjs';

const PATHS = gatewayRuntimePaths({
  gatewayHome: '/home/alice/.wheelmaker/gateway',
  gatewayBinary: '/home/alice/.wheelmaker/gateway/bin/wheelmaker-gateway',
  nodePath: '/usr/bin/node',
  userHome: '/home/alice',
  uid: 501,
});

test('Gateway service paths use the fixed host home and binary', () => {
  assert.equal(PATHS.home, '/home/alice/.wheelmaker/gateway');
  assert.equal(PATHS.binary, '/home/alice/.wheelmaker/gateway/bin/wheelmaker-gateway');
  assert.equal(PATHS.config, join(PATHS.home, 'generated', 'caddy.json'));
  assert.equal(PATHS.serviceName, 'wheelmaker-gateway');
});

test('Windows Gateway plan registers a current-user boot task', () => {
  const plan = windowsGatewayRuntimePlan({
    ...PATHS,
    binary: 'C:\\Users\\alice\\.wheelmaker\\gateway\\bin\\wheelmaker-gateway.exe',
    home: 'C:\\Users\\alice\\.wheelmaker\\gateway',
  });
  assert.deepEqual(plan.names, ['WheelMakerGateway']);
  assert.match(plan.script, /Register-ScheduledTask/);
  assert.match(plan.script, /Start-ScheduledTask/);
  assert.match(plan.script, /-AtLogOn/);
  assert.match(plan.script, /serve --home/);
  assert.match(plan.script, /-Verb RunAs/);
  assert.doesNotMatch(plan.script, /Set-Service|New-Service/);
});

test('Linux Gateway unit keeps the service in the deploy user and enables boot start', () => {
  const files = linuxGatewayRuntimeFiles({
    ...PATHS,
    binary: '/home/alice/.wheelmaker/gateway/bin/wheelmaker-gateway',
    config: '/home/alice/.wheelmaker/gateway/generated/caddy.json',
    home: '/home/alice/.wheelmaker/gateway',
  });
  assert.match(files['wheelmaker-gateway.service'], /ExecStart=.*wheelmaker-gateway.*serve --home/);
  assert.match(files['wheelmaker-gateway.service'], /Restart=always/);
  assert.match(files['wheelmaker-gateway.service'], /WantedBy=default.target/);
  assert.doesNotMatch(files['wheelmaker-gateway.service'], /User=root/);
});

test('macOS Gateway plist runs at login and keeps the service alive', () => {
  const files = darwinGatewayRuntimeFiles({
    ...PATHS,
    binary: '/Users/alice/.wheelmaker/gateway/bin/wheelmaker-gateway',
    home: '/Users/alice/.wheelmaker/gateway',
  });
  assert.match(files['com.wheelmaker.gateway.plist'], /com\.wheelmaker\.gateway/);
  assert.match(files['com.wheelmaker.gateway.plist'], /<true\/>/);
  assert.match(files['com.wheelmaker.gateway.plist'], /serve/);
});

test('Gateway runtime exposes current-state actions without rollback uninstall', async () => {
  const calls = [];
  const adapter = createGatewayRuntimeAdapter({
    paths: PATHS,
    platform: 'linux',
    async runner(command, args, options) {
      calls.push({ command, args, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  });

  assert.equal(typeof adapter.install, 'function');
  assert.equal(typeof adapter.start, 'function');
  assert.equal(typeof adapter.stop, 'function');
  assert.equal('uninstall' in adapter, false);
  assert.equal(typeof adapter.reload, 'function');
  assert.equal('enable' in adapter, false);
  assert.equal('disable' in adapter, false);

  await adapter.start();
  await adapter.stop();
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      ['systemctl', '--user', 'start', 'wheelmaker-gateway.service'],
      ['systemctl', '--user', 'stop', 'wheelmaker-gateway.service'],
    ],
  );
});

test('Gateway Home receives only start and stop wrappers', () => {
  const unix = gatewayWrapperFiles(PATHS, 'linux');
  assert.deepEqual(Object.keys(unix).sort(), ['start.sh', 'stop.sh']);
  assert.match(unix['start.sh'], /systemctl --user start/);
  const windows = gatewayWrapperFiles(PATHS, 'win32');
  assert.deepEqual(Object.keys(windows).sort(), ['start.bat', 'stop.bat']);
  assert.match(windows['stop.bat'], /Stop-ScheduledTask/);
});

test('Linux Gateway install grants low-port capability once and starts the user service', async () => {
  const calls = [];
  const adapter = createGatewayRuntimeAdapter({
    environment: {USER: 'alice'},
    paths: PATHS,
    platform: 'linux',
    async runner(command, args, options) {
      calls.push({ command, args, options });
      return { code: 0, stderr: '', stdout: '' };
    },
  });

  await adapter.install();
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      ['sudo', 'loginctl', 'enable-linger', 'alice'],
      ['sudo', 'setcap', 'cap_net_bind_service=+ep', PATHS.binary],
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', 'wheelmaker-gateway.service'],
      ['systemctl', '--user', 'start', 'wheelmaker-gateway.service'],
    ],
  );
  const flattenedCalls = calls
    .flatMap(({command, args}) => [command, ...args])
    .join(' ');
  assert.equal(flattenedCalls.includes('/etc/wheelmaker-' + 'gateway/home'), false);
});

test('Gateway reload posts the generated semantic result to the local Caddy admin API', async () => {
  const requests = [];
  const adapter = createGatewayRuntimeAdapter({
    paths: PATHS,
    platform: 'linux',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, text: async () => '' };
    },
    runner: async () => ({ code: 0, stderr: '', stdout: '' }),
  });

  await adapter.reload(Buffer.from('{"apps":{}}'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:2019/load');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.body, '{"apps":{}}');
});

test('Gateway health checks the local Caddy admin endpoint', async () => {
  const requests = [];
  const adapter = createGatewayRuntimeAdapter({
    paths: PATHS,
    platform: 'linux',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, text: async () => '' };
    },
    runner: async () => ({ code: 0, stderr: '', stdout: '' }),
  });

  await adapter.health();
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:2019/config/', options: { method: 'GET' } },
  ]);
});
