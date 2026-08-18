import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {stageReleaseTree} from '../scripts/build-release.mjs';

const kitRoot = path.resolve(import.meta.dirname, '..');

function commandEnvironment(root) {
  const gitDirectory = path.dirname(spawnSync('where.exe', ['git.exe'], {encoding: 'utf8'}).stdout.trim().split(/\r?\n/u)[0]);
  return {...process.env, USERPROFILE: root, PATH: [path.join(process.env.SystemRoot, 'System32'), gitDirectory].join(path.delimiter)};
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const {port} = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('staged Windows Kit works without host Node or Go on PATH', {skip: process.platform !== 'win32', timeout: 180_000}, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-kit-windows-smoke-'));
  t.after(() => rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  const stage = path.join(root, 'kit');
  await stageReleaseTree({kitRoot, destination: stage, platform: 'windows-x64', runtimeExecutable: process.execPath, serverExecutable: path.join(kitRoot, 'server', 'wiki-server.exe'), readerRoot: path.join(kitRoot, 'reader-dist')});
  const env = commandEnvironment(root);
  assert.equal(spawnSync('where.exe', ['node.exe'], {env, encoding: 'utf8'}).status, 1);
  assert.equal(spawnSync('where.exe', ['go.exe'], {env, encoding: 'utf8'}).status, 1);

  const setupLauncher = path.join(stage, 'setup-wiki.bat');
  const help = spawnSync(setupLauncher, ['--help'], {env, encoding: 'utf8', shell: true});
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /setup/u);

  const repository = path.join(root, 'private-wiki');
  const config = path.join(root, '.personal-wiki');
  const skills = path.join(root, '.codex', 'skills');
  const runtime = path.join(stage, 'runtime', 'node.exe');
  const cli = path.join(stage, 'src', 'cli.mjs');
  const setup = spawnSync(runtime, [cli, 'setup', '--repository', repository, '--config-directory', config, '--skills-directory', skills, '--title', 'Smoke', '--non-interactive', '--yes'], {env, encoding: 'utf8', timeout: 60_000});
  assert.equal(setup.status, 0, setup.stderr || setup.stdout);

  const query = spawnSync(runtime, [cli, 'query', '--repository', repository, '--query', 'Welcome'], {env, encoding: 'utf8'});
  assert.equal(query.status, 0, query.stderr || query.stdout);
  const build = spawnSync(runtime, [cli, 'build', '--repository', repository], {env, encoding: 'utf8', timeout: 60_000});
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const article = path.join(repository, 'content', 'articles', 'welcome-to-personal-wiki.md');
  await writeFile(article, `${await readFile(article, 'utf8')}\nSmoke publication.\n`);
  const publish = spawnSync(runtime, [cli, 'publish', '--repository', repository], {env, encoding: 'utf8', timeout: 60_000});
  assert.equal(publish.status, 0, publish.stderr || publish.stdout);
  assert.equal(JSON.parse(publish.stdout).status, 'local-only');

  const port = await freePort();
  const server = spawn(path.join(stage, 'bin', 'wiki-server.exe'), ['serve', '--mode', 'local', '--listen', `127.0.0.1:${port}`, '--root', path.join(repository, '.wiki-kit-out', 'site')], {env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  t.after(() => { if (server.exitCode === null) server.kill(); });
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      healthy = response.ok;
      if (healthy) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true);
  server.kill();
  await once(server, 'exit');
});
