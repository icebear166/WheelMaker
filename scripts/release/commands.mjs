import { spawn } from 'node:child_process';

const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx']);

export function resolveCommand(command, platform = process.platform) {
  if (platform === 'win32' && WINDOWS_CMD_SHIMS.has(command)) {
    return `${command}.cmd`;
  }
  return command;
}

export function runCommand(command, args, { cwd, env = {} } = {}) {
  if (!cwd) {
    throw new Error(`cwd is required when running ${command}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, {
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
