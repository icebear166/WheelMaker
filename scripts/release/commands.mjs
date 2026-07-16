import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

const WINDOWS_NPM_CLIS = new Set(['npm', 'npx']);

export function resolveCommand(
  command,
  platform = process.platform,
  nodePath = process.execPath,
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
  return { args: [], executable: command };
}

export function runCommand(command, args, { cwd, env = {} } = {}) {
  if (!cwd) {
    throw new Error(`cwd is required when running ${command}`);
  }

  return new Promise((resolve, reject) => {
    const invocation = resolveCommand(command);
    const child = spawn(invocation.executable, [...invocation.args, ...args], {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(' ')} failed with ${reason}`));
    });
  });
}
