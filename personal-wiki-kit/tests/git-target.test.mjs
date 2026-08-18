import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveGitTarget } from '../src/git-target.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function createFixture(t, remoteNames) {
  const root = mkdtempSync(join(tmpdir(), 'personal-wiki-git-target-'));
  t.after(() => rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }));
  const repository = join(root, 'wiki');
  mkdirSync(repository);
  git(repository, 'init', '--initial-branch=main');
  git(repository, 'config', 'user.name', 'Wiki Test');
  git(repository, 'config', 'user.email', 'wiki-test@example.com');
  writeFileSync(join(repository, 'README.md'), '# Test\n');
  git(repository, 'add', 'README.md');
  git(repository, 'commit', '-m', 'initial');

  for (const remoteName of remoteNames) {
    const remote = join(root, `${remoteName}.git`);
    git(root, 'init', '--bare', '--initial-branch=main', remote);
    git(repository, 'remote', 'add', remoteName, remote);
    git(repository, 'push', remoteName, 'main');
  }
  return repository;
}

test('Git target uses the current branch upstream when multiple remotes exist', (t) => {
  const repository = createFixture(t, ['archive', 'publish']);
  git(repository, 'branch', '--set-upstream-to=publish/main', 'main');
  assert.deepEqual(resolveGitTarget(repository), { remote: 'publish', branch: 'main' });
});

test('Git target uses the only remote and its symbolic default branch', (t) => {
  const repository = createFixture(t, ['origin']);
  assert.deepEqual(resolveGitTarget(repository), { remote: 'origin', branch: 'main' });
});

test('Git target rejects ambiguous remotes instead of guessing', (t) => {
  const repository = createFixture(t, ['archive', 'publish']);
  assert.throws(
    () => resolveGitTarget(repository),
    /当前分支没有上游分支，且仓库存在多个远端/,
  );
});

test('Git target rejects detached HEAD', () => {
  const runGit = (_repository, args) => (
    args[0] === 'rev-parse' ? 'true' : ''
  );
  assert.throws(() => resolveGitTarget('C:/example/wiki', runGit), /游离 HEAD/);
});
