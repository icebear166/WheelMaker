import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

import {runCLI} from '../src/cli.mjs';
import {classifyRepositoryPaths, migrateRepository} from '../src/migrate-repository.mjs';

const execFileAsync = promisify(execFile);
const kitRoot = path.resolve(import.meta.dirname, '..');
const kitLock = {schema: 1, version: '0.1.0', source: 'https://github.com/example/WheelMaker/releases/download/personal-wiki-kit-v0.1.0/personal-wiki-kit-v0.1.0-linux-x64.tar.gz', sha256: 'a'.repeat(64)};
const deployment = {schema: 1, domain: 'wiki.example.com', sshUser: 'wiki-deploy', sshPort: 22, serviceUser: 'personal-wiki', installRoot: '/srv/personal-wiki', listenPort: 9765};

async function git(repository, args) {
  return (await execFileAsync('git', ['-C', repository, ...args], {encoding: 'utf8', windowsHide: true})).stdout.trim();
}

async function legacyFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-migration-'));
  t.after(() => rm(root, {recursive: true, force: true, maxRetries: 20, retryDelay: 100}));
  const repository = path.join(root, 'legacy');
  await cp(path.join(kitRoot, 'tests', 'fixtures', 'valid-wiki'), repository, {recursive: true});
  await mkdir(path.join(repository, 'app'), {recursive: true});
  await mkdir(path.join(repository, 'scripts'), {recursive: true});
  await mkdir(path.join(repository, '.github', 'workflows'), {recursive: true});
  await writeFile(path.join(repository, 'app', 'App.tsx'), 'legacy program\n');
  await writeFile(path.join(repository, 'scripts', 'build.mjs'), 'legacy program\n');
  await writeFile(path.join(repository, '.github', 'workflows', 'publish.yml'), 'name: legacy\n');
  await writeFile(path.join(repository, '.gitignore'), 'node_modules/\n.wiki-out/\n');
  await writeFile(path.join(repository, '.gitattributes'), '* text=auto\n');
  await writeFile(path.join(repository, 'README.md'), '# Legacy\n');
  await writeFile(path.join(repository, 'AGENTS.md'), '# Legacy rules\n');
  await writeFile(path.join(repository, 'package.json'), '{"private":true}\n');
  await writeFile(path.join(repository, 'publish-wiki.bat'), '@echo legacy\r\n');
  await git(repository, ['init', '--initial-branch=main']);
  await git(repository, ['config', 'user.name', 'Migration Test']);
  await git(repository, ['config', 'user.email', 'migration@example.com']);
  await git(repository, ['add', '--all']);
  await git(repository, ['commit', '-m', 'legacy wiki']);
  return {root, repository};
}

test('repository path classifier separates retained data, generated thin files, legacy programs, and unknowns', () => {
  const result = classifyRepositoryPaths(['content/articles/a.md', 'attachments/a.png', '.gitignore', 'app/App.tsx', 'package.json', 'migration/notes.txt', 'mystery.bin']);
  assert.deepEqual(result.retained, ['attachments/a.png', 'content/articles/a.md']);
  assert.deepEqual(result.generated, ['.gitignore']);
  assert.deepEqual(result.legacy, ['app/App.tsx', 'package.json']);
  assert.deepEqual(result.unknown, ['migration/notes.txt', 'mystery.bin']);
});

test('stable dry-run proves identity and does not change the repository', async (t) => {
  const fixture = await legacyFixture(t);
  const before = await git(fixture.repository, ['status', '--porcelain=v1', '-z']);
  const options = {repository: fixture.repository, kitRoot, kitLock, deployment, dryRun: true};
  const first = await migrateRepository(options);
  const second = await migrateRepository(options);
  assert.deepEqual(first, second);
  assert.equal(first.identity.equivalent, true);
  assert.equal(first.unknown.length, 0);
  assert.ok(first.legacy.includes('app/App.tsx'));
  assert.equal(await git(fixture.repository, ['status', '--porcelain=v1', '-z']), before);
});

test('apply preserves knowledge bytes, removes legacy programs, and creates recoverable thin integration', async (t) => {
  const fixture = await legacyFixture(t);
  const article = path.join(fixture.repository, 'content', 'articles', 'example-article.md');
  const articleBefore = await readFile(article);
  const result = await migrateRepository({repository: fixture.repository, kitRoot, kitLock, deployment, apply: true});
  assert.deepEqual(await readFile(article), articleBefore);
  await assert.rejects(() => readFile(path.join(fixture.repository, 'app', 'App.tsx')));
  await assert.rejects(() => readFile(path.join(fixture.repository, 'package.json')));
  assert.match(await readFile(path.join(fixture.repository, '.github', 'workflows', 'publish.yml'), 'utf8'), /KIT_SHA256/u);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.repository, 'wiki-kit.lock.json'), 'utf8')), kitLock);
  assert.equal(await git(fixture.repository, ['rev-parse', result.recoveryTag]), result.sourceCommit);
  assert.match(await readFile(path.join(fixture.repository, 'migration', 'personal-wiki-kit.json'), 'utf8'), /"equivalent": true/u);
});

test('unknown tracked files and dirty apply both fail closed', async (t) => {
  const fixture = await legacyFixture(t);
  await writeFile(path.join(fixture.repository, 'mystery.bin'), 'unknown\n');
  await git(fixture.repository, ['add', 'mystery.bin']);
  await git(fixture.repository, ['commit', '-m', 'unknown']);
  await assert.rejects(() => migrateRepository({repository: fixture.repository, kitRoot, kitLock, deployment, dryRun: true}), /unknown tracked path/u);
  await rm(path.join(fixture.repository, 'mystery.bin'));
  await git(fixture.repository, ['add', '--all']);
  await git(fixture.repository, ['commit', '-m', 'remove unknown']);
  await writeFile(path.join(fixture.repository, 'README.md'), '# Dirty\n');
  await assert.rejects(() => migrateRepository({repository: fixture.repository, kitRoot, kitLock, deployment, apply: true}), /clean Git worktree/u);
});

test('apply failure restores every legacy and generated path', async (t) => {
  const fixture = await legacyFixture(t);
  const beforeHead = await git(fixture.repository, ['rev-parse', 'HEAD']);
  const beforeStatus = await git(fixture.repository, ['status', '--porcelain=v1', '-z']);
  const legacy = await readFile(path.join(fixture.repository, 'app', 'App.tsx'));
  await assert.rejects(() => migrateRepository({repository: fixture.repository, kitRoot, kitLock, deployment, apply: true}, {afterMutation: async () => { throw new Error('injected failure'); }}), /injected failure/u);
  assert.deepEqual(await readFile(path.join(fixture.repository, 'app', 'App.tsx')), legacy);
  assert.equal(await git(fixture.repository, ['rev-parse', 'HEAD']), beforeHead);
  assert.equal(await git(fixture.repository, ['status', '--porcelain=v1', '-z']), beforeStatus);
});

test('recovery-tag failure also restores the repository transaction', async (t) => {
  const fixture = await legacyFixture(t);
  const beforeStatus = await git(fixture.repository, ['status', '--porcelain=v1', '-z']);
  const legacy = await readFile(path.join(fixture.repository, 'app', 'App.tsx'));
  const failingGit = async (repository, args) => {
    if (args[0] === 'tag') throw new Error('tag failure');
    return git(repository, args);
  };
  await assert.rejects(
    () => migrateRepository(
      {repository: fixture.repository, kitRoot, kitLock, deployment, apply: true},
      {git: failingGit},
    ),
    /tag failure/u,
  );
  assert.deepEqual(await readFile(path.join(fixture.repository, 'app', 'App.tsx')), legacy);
  assert.equal(await git(fixture.repository, ['status', '--porcelain=v1', '-z']), beforeStatus);
});

test('CLI dry-run resolves explicit repository settings and writes the requested report', async (t) => {
  const fixture = await legacyFixture(t);
  const deploymentConfig = path.join(fixture.root, 'deployment.json');
  const reportPath = path.join(fixture.root, 'migration-report.json');
  await writeFile(deploymentConfig, `${JSON.stringify(deployment)}\n`);
  await runCLI([
    'migrate-repository',
    '--repository', fixture.repository,
    '--kit-source', kitLock.source,
    '--kit-sha256', kitLock.sha256,
    '--deployment-config', deploymentConfig,
    '--dry-run',
    '--report', reportPath,
  ], {
    prompt: {close() {}},
    stdout: {write() {}},
  });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.identity.equivalent, true);
  assert.equal(report.sourceCommit, await git(fixture.repository, ['rev-parse', 'HEAD']));
});
