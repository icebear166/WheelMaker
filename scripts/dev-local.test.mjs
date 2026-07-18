import assert from 'node:assert/strict';
import test from 'node:test';

import {parseDevLocalArgs, runDevLocal} from './dev-local.mjs';

const repoRoot = 'D:\\src\\WheelMaker';
const home = 'C:\\Users\\me';

function fakeDeps() {
  const state = {commands: [], events: [], writes: []};
  return {
    acquireBuildLock: async input => {
      state.events.push(`lock:${input.owner}`);
      return {release: async () => state.events.push('unlock')};
    },
    env: {},
    exists: async path => /(?:start|stop)\.bat$/.test(path),
    home,
    mkdir: async path => state.events.push(`mkdir:${path}`),
	readFile: async path => {
		if (/runtime\.json$/.test(path)) return JSON.stringify({guardianPid: 201, webServerPid: 202});
		throw Object.assign(new Error(`missing ${path}`), {code: 'ENOENT'});
	},
    remove: async path => state.events.push(`remove:${path}`),
    repoRoot,
    run: async (file, args, options) => {
      state.commands.push({file, args, options});
    },
    spawn: async (file, args, options) => {
      state.commands.push({file, args, options, spawned: true});
      return {pid: state.commands.length + 100};
    },
    state,
	waitForURL: async url => state.events.push(`ready:${url}`),
    writeFile: async (path, body) => state.writes.push({body, path}),
  };
}

test('rejects unsupported dev commands', () => {
  assert.throws(() => parseDevLocalArgs(['publish']), /unknown dev command/);
});

test('build writes Hub and Desktop under the dev root and reuses release caches', async () => {
  const deps = fakeDeps();
  await runDevLocal(['build'], deps);

  const hub = deps.state.commands.find(call => call.args.includes('./cmd/wheelmaker'));
  const desktop = deps.state.commands.find(call => call.args.includes('./cmd/wheelmaker-desktop'));
	const web = deps.state.commands.find(call => call.file === 'npm' && call.args.join(' ') === 'run build:web');
  assert.deepEqual(hub.args, [
    'build',
    '-trimpath',
    '-ldflags=-H windowsgui',
    '-o',
    'C:\\Users\\me\\.wheelmaker\\dev\\bin\\wheelmaker.exe',
    './cmd/wheelmaker',
  ]);
  assert.equal(desktop.args.at(-2), 'C:\\Users\\me\\.wheelmaker\\dev\\bin\\WheelMakerDesktop.exe');
  assert.equal(hub.options.env.GOCACHE, 'D:\\src\\WheelMaker\\.release-work\\cache\\go-build');
  assert.equal(hub.options.env.GOMODCACHE, 'D:\\src\\WheelMaker\\.release-work\\cache\\go-mod');
  assert.equal('GRADLE_USER_HOME' in hub.options.env, false);
	assert.equal(web.options.env.WHEELMAKER_WEB_TARGET, 'C:\\Users\\me\\.wheelmaker\\dev\\web');
  assert.deepEqual(deps.state.events.filter(event => event.startsWith('lock') || event === 'unlock'), ['lock:dev', 'unlock']);
});

test('start stops the formal runtime before starting the Dev stack', async () => {
  const deps = fakeDeps();
  await runDevLocal(['start'], deps);

  const stopFormal = deps.state.commands.findIndex(call => call.file === 'cmd.exe' && call.args.at(-1) === 'C:\\Users\\me\\.wheelmaker\\stop.bat');
  const guardian = deps.state.commands.findIndex(call => call.spawned && call.args.includes('-d'));
  const web = deps.state.commands.find(call => call.spawned && call.file === 'npm');
	const desktop = deps.state.commands.find(call => call.spawned && /WheelMakerDesktop\.exe$/.test(call.file));
  assert.ok(stopFormal >= 0);
  assert.ok(guardian > stopFormal);
  assert.equal(web.options.env.WHEELMAKER_WEB_TARGET, 'C:\\Users\\me\\.wheelmaker\\dev\\web');
  assert.ok(deps.state.writes.some(write => /dev-config\.json$/.test(write.path)));
  assert.ok(deps.state.writes.some(write => /runtime\.json$/.test(write.path)));
	assert.ok(deps.state.events.includes('ready:http://127.0.0.1:4173/'));
	assert.ok(deps.state.events.includes('ready:http://127.0.0.1:9630/ws'));
	assert.ok(desktop);
});

test('stop restores the formal runtime even when a Dev process already exited', async () => {
	const deps = fakeDeps();
	const baseRun = deps.run;
	let taskkillCount = 0;
	deps.run = async (file, args, options) => {
		await baseRun(file, args, options);
		if (file === 'taskkill.exe' && taskkillCount++ === 0) {
			throw new Error('process already exited');
		}
	};

	await assert.rejects(runDevLocal(['stop'], deps), /process already exited/);
	const formalStart = deps.state.commands.find(call => call.file === 'cmd.exe' && call.args.at(-1) === 'C:\\Users\\me\\.wheelmaker\\start.bat');
	assert.ok(formalStart);
	assert.ok(deps.state.events.some(event => /remove:.*runtime\.json$/.test(event)));
});
