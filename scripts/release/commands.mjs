import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

const WINDOWS_NPM_CLIS = new Set(['npm', 'npx']);

export function resolveCommand(
  command,
  platform = process.platform,
  nodePath = process.execPath,
  commandInterpreter = process.env.ComSpec ?? 'cmd.exe',
) {
  if (platform === 'win32' && WINDOWS_NPM_CLIS.has(command)) {
    return {
      args: [
        win32.join(
          win32.dirname(nodePath),
          'node_modules',
          'npm',
          'bin',
          `${command}-cli.js`,
        ),
      ],
      executable: nodePath,
    };
  }
  if (platform === 'win32' && command === 'gradle') {
    return {
      args: ['/d', '/s', '/c', 'gradle.cmd'],
      executable: commandInterpreter,
    };
  }
  return { args: [], executable: command };
}

export function runCommand(
  command,
  args,
  { captureOutput = false, cwd, env = {} } = {},
) {
  if (!cwd) {
    throw new Error(`cwd is required when running ${command}`);
  }

  return new Promise((resolve, reject) => {
    const invocation = resolveCommand(command);
    const child = spawn(invocation.executable, [...invocation.args, ...args], {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', chunk => stdout.push(chunk));
    child.stderr?.on('data', chunk => stderr.push(chunk));

    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(
          captureOutput
            ? {
                stderr: Buffer.concat(stderr).toString('utf8'),
                stdout: Buffer.concat(stdout).toString('utf8'),
              }
            : undefined,
        );
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(' ')} failed with ${reason}`));
    });
  });
}
