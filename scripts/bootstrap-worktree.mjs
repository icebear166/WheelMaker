import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), '..');
const markerName = '.wheelmaker-environment.json';

function currentRuntime() {
  return {
    node: process.version,
    modules: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  };
}

async function pathType(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readMarker(markerPath) {
  try {
    return JSON.parse(await readFile(markerPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function environmentFingerprint(appDir, runtime) {
  const [packageJson, packageLock] = await Promise.all([
    readFile(join(appDir, 'package.json')),
    readFile(join(appDir, 'package-lock.json')),
  ]);
  return createHash('sha256')
    .update(packageJson)
    .update('\0')
    .update(packageLock)
    .update('\0')
    .update(JSON.stringify(runtime))
    .digest('hex');
}

export function resolveNpmInvocation({
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (npmExecPath) {
    return { command: execPath, argsPrefix: [npmExecPath] };
  }
  if (platform === 'win32') {
    return {
      command: execPath,
      argsPrefix: [
        join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ],
    };
  }
  return { command: 'npm', argsPrefix: [] };
}

async function runNpmProcess({ command, args, cwd }) {
  const invocation =
    command === 'npm' ? resolveNpmInvocation() : { command, argsPrefix: [] };
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      invocation.command,
      [...invocation.argsPrefix, ...args],
      {
        cwd,
        stdio: 'inherit',
      }
    );
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} terminated by ${signal}`
            : `${command} exited with code ${code}`
        )
      );
    });
  });
}

export async function bootstrapWorktree({
  repoRoot = defaultRepoRoot,
  runtime = currentRuntime(),
  runNpm = runNpmProcess,
} = {}) {
  const appDir = join(resolve(repoRoot), 'app');
  const nodeModules = join(appDir, 'node_modules');
  const markerPath = join(nodeModules, markerName);
  const fingerprint = await environmentFingerprint(appDir, runtime);
  const nodeModulesType = await pathType(nodeModules);

  if (nodeModulesType?.isSymbolicLink()) {
    throw new Error(
      `Refusing to run npm ci through shared node_modules link: ${nodeModules}`
    );
  }

  const marker = nodeModulesType ? await readMarker(markerPath) : null;
  if (marker?.fingerprint === fingerprint) {
    return { installed: false, fingerprint };
  }

  await runNpm({
    command: 'npm',
    args: [
      'ci',
      '--include=dev',
      '--prefer-offline',
      '--no-audit',
      '--no-fund',
    ],
    cwd: appDir,
  });

  if (!(await pathType(nodeModules))) {
    throw new Error(`npm ci completed without creating ${nodeModules}`);
  }

  const markerTemp = `${markerPath}.${process.pid}.tmp`;
  await mkdir(nodeModules, { recursive: true });
  await writeFile(
    markerTemp,
    `${JSON.stringify({ fingerprint, runtime }, null, 2)}\n`
  );
  await rename(markerTemp, markerPath);
  return { installed: true, fingerprint };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = await bootstrapWorktree();
  console.log(
    result.installed
      ? 'Worktree npm environment is ready.'
      : 'Worktree npm environment is already current.'
  );
}
