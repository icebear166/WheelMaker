import {execFile, spawn as spawnChild} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {acquireBuildLock} from './release/build-lock.mjs';

const execFileAsync = promisify(execFile);
const commands = new Set(['build', 'start', 'stop', 'restart', 'status']);

export function parseDevLocalArgs(args) {
  if (args.length !== 1 || !commands.has(args[0])) {
    throw new Error(`unknown dev command: ${args.join(' ')}`);
  }
  return args[0];
}

export async function runDevLocal(args, deps = createDefaultDevDependencies()) {
  const command = parseDevLocalArgs(args);
  if (command === 'build') return buildDevAssets(deps);
  if (command === 'start') return startDev(deps);
  if (command === 'stop') return stopDev(deps);
  if (command === 'restart') {
    await stopDev(deps);
    return startDev(deps);
  }
  return readDevStatus(deps);
}

async function buildDevAssets(deps) {
  const paths = devPaths(deps);
  const env = buildEnvironment(deps, paths);
  const lock = await deps.acquireBuildLock({
    owner: 'dev',
    workRoot: paths.workRoot,
  });
  try {
    await Promise.all([
      deps.mkdir(paths.bin),
      deps.mkdir(paths.web),
      deps.mkdir(join(paths.workRoot, 'cache', 'webpack')),
    ]);
    await Promise.all([
      deps.run('go', [
        'build',
        '-trimpath',
        '-ldflags=-H windowsgui',
        '-o',
        paths.hub,
        './cmd/wheelmaker',
      ], {cwd: paths.serverRoot, env}),
      buildDesktopExecutable(deps, paths, env),
      runNpm(deps, ['run', 'build:web'], {cwd: paths.appRoot, env}),
    ]);
  } finally {
    await lock.release();
  }
}

async function buildDesktopExecutable(deps, paths, env) {
  try {
    await deps.run('go', [
      'run',
      'github.com/tc-hib/go-winres@v0.3.3',
      'simply',
      '--arch',
      'amd64',
      '--out',
      paths.desktopResource,
      '--no-suffix',
      '--manifest',
      'gui',
      '--icon',
      join(paths.desktopCommandRoot, 'winres', 'icon.png'),
      '--file-description',
      'WheelMaker Desktop',
      '--product-name',
      'WheelMaker Desktop',
      '--original-filename',
      'WheelMakerDesktop.exe',
    ], {cwd: paths.desktopCommandRoot, env});
    await deps.run('go', [
      'build',
      '-trimpath',
      '-ldflags=-H windowsgui',
      '-o',
      paths.desktop,
      './cmd/wheelmaker-desktop',
    ], {cwd: paths.serverRoot, env});
  } finally {
    await deps.remove(paths.desktopResource);
  }
}

async function startDev(deps) {
  await buildDevAssets(deps);
  const paths = devPaths(deps);
  if (await deps.exists(paths.runtime)) {
    throw new Error(`Dev runtime is already tracked at ${paths.runtime}`);
  }
  await runWindowsBatch(deps, paths.formalStop);
  const env = buildEnvironment(deps, paths);
  const started = [];
  try {
    const guardian = await deps.spawn(paths.hub, [
      '-d',
      '--local-dev',
      '--dir',
      paths.formalRoot,
    ], {cwd: paths.devRoot, env});
    started.push(guardian.pid);
    const webServer = await spawnNpm(deps, ['run', 'web'], {
      cwd: paths.appRoot,
      env,
    });
    started.push(webServer.pid);
    await deps.writeFile(paths.devConfig, JSON.stringify({sourcePath: deps.repoRoot}) + '\n');
    await Promise.all([
      deps.waitForURL('http://127.0.0.1:4173/'),
      deps.waitForURL('http://127.0.0.1:9630/ws', 60_000, true),
    ]);
    await deps.writeFile(paths.runtime, JSON.stringify({
      guardianPid: guardian.pid,
      webServerPid: webServer.pid,
    }) + '\n');
    if (deps.env.WHEELMAKER_DEV_NO_DESKTOP !== '1') {
      await deps.spawn(paths.desktop, ['--local-dev'], {cwd: paths.devRoot, env});
    }
  } catch (error) {
    for (const pid of started.reverse()) {
      await deps.run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {cwd: paths.devRoot, env: deps.env}).catch(() => undefined);
    }
    await deps.remove(paths.runtime);
    await runWindowsBatch(deps, paths.formalStart).catch(() => undefined);
    throw error;
  }
}

function runNpm(deps, args, options) {
  if (deps.npmViaCmd) {
    return deps.run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], options);
  }
  return deps.run('npm', args, options);
}

function spawnNpm(deps, args, options) {
  if (deps.npmViaCmd) {
    return deps.spawn('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], options);
  }
  return deps.spawn('npm', args, options);
}

async function stopDev(deps) {
  const paths = devPaths(deps);
  const runtime = JSON.parse(await deps.readFile(paths.runtime, 'utf8'));
  const failures = [];
  for (const pid of [runtime.webServerPid, runtime.guardianPid]) {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`invalid Dev runtime pid in ${paths.runtime}`);
    }
    try {
      await deps.run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {cwd: paths.devRoot, env: deps.env});
    } catch (error) {
      failures.push(error);
    }
  }
  await deps.remove(paths.runtime);
  try {
    await runWindowsBatch(deps, paths.formalStart);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Local Dev stopped with cleanup errors: ${failures.map(error => error.message).join('; ')}`);
  }
}

async function readDevStatus(deps) {
  const paths = devPaths(deps);
  try {
    return JSON.parse(await deps.readFile(paths.runtime, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function runWindowsBatch(deps, batchPath) {
  if (!(await deps.exists(batchPath))) {
    throw new Error(`required formal runtime command is missing: ${batchPath}`);
  }
  await deps.run('cmd.exe', ['/d', '/s', '/c', batchPath], {
    cwd: dirname(batchPath),
    env: deps.env,
  });
}

function devPaths(deps) {
  const devRoot = join(deps.home, '.wheelmaker', 'dev');
  const serverRoot = join(deps.repoRoot, 'server');
  const desktopCommandRoot = join(serverRoot, 'cmd', 'wheelmaker-desktop');
  return {
    appRoot: join(deps.repoRoot, 'app'),
    bin: join(devRoot, 'bin'),
    desktop: join(devRoot, 'bin', 'WheelMakerDesktop.exe'),
    desktopCommandRoot,
    desktopResource: join(desktopCommandRoot, 'desktop_windows.syso'),
    devRoot,
    devConfig: join(devRoot, 'dev-config.json'),
    formalStart: join(deps.home, '.wheelmaker', 'start.bat'),
    formalStop: join(deps.home, '.wheelmaker', 'stop.bat'),
    formalRoot: join(deps.home, '.wheelmaker'),
    hub: join(devRoot, 'bin', 'wheelmaker.exe'),
    runtime: join(devRoot, 'runtime.json'),
    serverRoot,
    web: join(devRoot, 'web'),
    workRoot: join(deps.repoRoot, '.release-work'),
  };
}

function buildEnvironment(deps, paths) {
  const cache = join(paths.workRoot, 'cache');
  return {
    ...deps.env,
    GOCACHE: join(cache, 'go-build'),
    GOMODCACHE: join(cache, 'go-mod'),
    WHEELMAKER_WEB_TARGET: paths.web,
    WHEELMAKER_WEBPACK_CACHE: join(cache, 'webpack'),
  };
}

export function createDefaultDevDependencies() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    acquireBuildLock,
    env: process.env,
    exists: async path => readFile(path).then(() => true).catch(error => error?.code === 'ENOENT' ? false : Promise.reject(error)),
    home: os.homedir(),
    mkdir: path => mkdir(path, {recursive: true}),
	npmViaCmd: process.platform === 'win32',
    readFile,
    remove: path => rm(path, {force: true}),
    repoRoot,
    run: (file, args, options) => execFileAsync(file, args, options),
    spawn: (file, args, options) => new Promise((resolveSpawn, rejectSpawn) => {
      const child = spawnChild(file, args, {...options, detached: true, stdio: 'ignore'});
      child.once('error', rejectSpawn);
      child.once('spawn', () => {
        child.unref();
        resolveSpawn({pid: child.pid});
      });
    }),
	waitForURL: async (url, timeoutMs = 60_000, acceptAnyStatus = false) => {
		const deadline = Date.now() + timeoutMs;
		let lastError;
		while (Date.now() < deadline) {
			try {
				const response = await fetch(url, {signal: AbortSignal.timeout(2_000)});
				if (response.ok || acceptAnyStatus) return;
				lastError = new Error(`HTTP ${response.status}`);
			} catch (error) {
				lastError = error;
			}
			await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
		}
		throw new Error(`Local Web did not become ready at ${url}: ${lastError?.message ?? 'timeout'}`);
	},
    writeFile,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await runDevLocal(process.argv.slice(2)).catch(error => {
    process.stderr.write(`[dev] ${error.message}\n`);
    process.exitCode = 1;
  });
}
