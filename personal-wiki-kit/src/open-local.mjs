import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { compileKnowledge } from './content.mjs';
import { buildSite } from './site-builder.mjs';

export function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法读取 loopback 端口'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function defaultSpawnServer(executable, args) {
  return spawn(executable, args, {
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
}

async function defaultWaitForReady(url, child) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`本地 Wiki 服务提前退出，退出码 ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(1_000) });
      if (response.ok && await response.text() === 'ok\n') return;
      lastError = new Error(`健康检查返回 ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`本地 Wiki 健康检查超时：${lastError?.message || '未知错误'}`);
}

function defaultOpenBrowser(url) {
  let executable;
  let args;
  if (process.platform === 'win32') {
    executable = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.platform === 'darwin') {
    executable = 'open';
    args = [url];
  } else {
    executable = 'xdg-open';
    args = [url];
  }
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  child.unref();
}

function validateOptions(options) {
  for (const field of ['repository', 'reader', 'serverExecutable', 'kitVersion', 'sourceCommit', 'generatedAt']) {
    if (typeof options[field] !== 'string' || options[field].trim() === '') {
      throw new Error(`本地打开缺少 ${field}`);
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.kitVersion)) {
    throw new Error('kitVersion 必须是精确语义版本');
  }
  if (!/^(?:[a-f0-9]{7,64}|uncommitted)$/u.test(options.sourceCommit)) {
    throw new Error('sourceCommit 必须是 Git 对象 ID 或 uncommitted');
  }
  if (!Number.isFinite(Date.parse(options.generatedAt))) {
    throw new Error('generatedAt 必须是有效时间');
  }
}

export async function openLocalWiki(options = {}, {
  compile = compileKnowledge,
  assemble = buildSite,
  selectPort = findAvailableLoopbackPort,
  spawnServer = defaultSpawnServer,
  waitForReady = defaultWaitForReady,
  openBrowser = defaultOpenBrowser,
} = {}) {
  validateOptions(options);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'personal-wiki-open-'));
  const dataOutput = path.join(temporaryRoot, 'knowledge');
  const siteOutput = path.join(temporaryRoot, 'site');
  let child;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ||= rm(temporaryRoot, {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    return cleanupPromise;
  };

  try {
    await compile({
      repository: path.resolve(options.repository),
      output: dataOutput,
      generatedAt: options.generatedAt,
    });
    const releaseId = `${options.generatedAt.replace(/[-:.]/gu, '')}-${options.sourceCommit.slice(0, 12)}`;
    await assemble({
      reader: path.resolve(options.reader),
      data: dataOutput,
      output: siteOutput,
      releaseId,
      generatedAt: options.generatedAt,
      sourceCommit: options.sourceCommit,
      kitVersion: options.kitVersion,
    });
    const port = await selectPort();
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`无效的本地端口：${port}`);
    }
    const url = `http://127.0.0.1:${port}`;
    child = spawnServer(options.serverExecutable, [
      'serve',
      '--mode', 'local',
      '--listen', `127.0.0.1:${port}`,
      '--root', siteOutput,
      '--secure-cookie=false',
    ]);
    child.once('exit', () => { void cleanup(); });
    await waitForReady(`${url}/healthz`, child);
    await openBrowser(url);

    let stopped = false;
    return {
      url,
      child,
      temporaryRoot,
      stop: async () => {
        if (stopped) return cleanup();
        stopped = true;
        if (child.exitCode === null) {
          child.kill();
          await once(child, 'exit');
        }
        await cleanup();
      },
    };
  } catch (error) {
    if (child?.exitCode === null) child.kill();
    await cleanup();
    throw error;
  }
}
