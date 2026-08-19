import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { writeReleaseManifest } from '../src/release-manifest.mjs';
import {
  findAvailableLoopbackPort,
  openLocalWiki,
} from '../src/open-local.mjs';

test('loopback port selector returns an available local port', async () => {
  const port = await findAvailableLoopbackPort();
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
});

test('local open builds a temporary site, starts local mode, opens browser, and cleans up', async () => {
  const calls = { browser: [], server: [], health: [] };
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0));
    return true;
  };

  const result = await openLocalWiki({
    repository: 'C:/example/private-wiki',
    reader: 'C:/example/reader',
    serverExecutable: 'C:/example/wiki-server.exe',
    kitVersion: '0.1.0',
    sourceCommit: '0123456789abcdef',
    generatedAt: '2026-08-18T00:00:00.000Z',
  }, {
    compile: async ({ output }) => {
      await mkdir(join(output, 'data'), { recursive: true });
      await writeFile(join(output, 'data', 'catalog.json'), '{"schema":1}\n');
      await writeFile(join(output, 'data', 'search.json'), '{"schema":1}\n');
      await writeReleaseManifest({ root: output, releaseId: 'knowledge-fixture' });
    },
    assemble: async ({ output }) => {
      await mkdir(join(output, 'data'), { recursive: true });
      await writeFile(join(output, 'index.html'), '<div id="root"></div>\n');
      await writeFile(join(output, 'data', 'catalog.json'), '{"schema":1}\n');
      await writeFile(join(output, 'data', 'search.json'), '{"schema":1}\n');
      await writeFile(join(output, 'release-metadata.json'), '{"schema":1}\n');
      await writeReleaseManifest({ root: output, releaseId: 'site-fixture' });
    },
    selectPort: async () => 43123,
    spawnServer: (executable, args) => {
      calls.server.push({ executable, args });
      return child;
    },
    waitForReady: async (url) => calls.health.push(url),
    openBrowser: async (url) => calls.browser.push(url),
  });

  assert.equal(result.url, 'http://127.0.0.1:43123');
  assert.deepEqual(calls.browser, [result.url]);
  assert.deepEqual(calls.health, [`${result.url}/healthz`]);
  assert.equal(calls.server[0].executable, 'C:/example/wiki-server.exe');
  assert.deepEqual(calls.server[0].args.slice(0, 6), [
    'serve', '--mode', 'local', '--listen', '127.0.0.1:43123', '--root',
  ]);
  const temporaryRoot = result.temporaryRoot;
  await access(temporaryRoot);
  await result.stop();
  await assert.rejects(() => access(temporaryRoot));
});
