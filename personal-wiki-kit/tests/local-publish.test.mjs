import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyKnowledgeChanges,
  parsePorcelainStatus,
  publishKnowledge,
} from '../src/local-publish.mjs';

test('porcelain parser preserves rename records and supported knowledge paths', () => {
  const records = parsePorcelainStatus([
    ' M content/articles/guide.md',
    'R  content/articles/new-name.md',
    'content/articles/old-name.md',
    '?? attachments/diagram.png',
    '',
  ].join('\0'));

  assert.deepEqual(records, [
    { code: ' M', path: 'content/articles/guide.md' },
    {
      code: 'R ',
      path: 'content/articles/new-name.md',
      originalPath: 'content/articles/old-name.md',
    },
    { code: '??', path: 'attachments/diagram.png' },
  ]);
  assert.deepEqual(classifyKnowledgeChanges(records), {
    allowedPaths: [
      'attachments/diagram.png',
      'content/articles/guide.md',
      'content/articles/new-name.md',
      'content/articles/old-name.md',
    ],
    blocked: [],
  });
});

test('classification blocks unsupported attachments, integration files, and conflicts', () => {
  const result = classifyKnowledgeChanges([
    { code: '??', path: 'attachments/archive.zip' },
    { code: ' M', path: 'README.md' },
    { code: 'UU', path: 'content/articles/conflicted.md' },
  ]);

  assert.deepEqual(result.allowedPaths, []);
  assert.deepEqual(result.blocked.map(({ path }) => path), [
    'README.md',
    'attachments/archive.zip',
    'content/articles/conflicted.md',
  ]);
});

function gitFixture({
  status = ' M content/articles/guide.md\0',
  remotes = '',
  defaultBranch = '',
  pushFailures = 0,
} = {}) {
  const calls = [];
  let pushes = 0;
  const runGit = async (_repository, args, { optional = false } = {}) => {
    calls.push(args);
    const joined = args.join(' ');
    if (joined === 'rev-parse --is-inside-work-tree') return 'true';
    if (joined === 'symbolic-ref --quiet --short HEAD') return 'main';
    if (joined === 'remote') return remotes;
    if (joined === 'config --get branch.main.remote') return remotes ? 'origin' : '';
    if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
      return defaultBranch ? `origin/${defaultBranch}` : '';
    }
    if (joined === 'ls-remote --symref origin HEAD') {
      return defaultBranch ? `ref: refs/heads/${defaultBranch}\tHEAD` : '';
    }
    if (joined === 'status --porcelain=v1 -z --untracked-files=all') return status;
    if (joined === 'diff --cached --name-only -z') return 'content/articles/guide.md\0';
    if (joined === 'rev-parse --verify HEAD') return '0123456789abcdef';
    if (args[0] === 'push') {
      pushes += 1;
      if (pushes <= pushFailures) {
        const error = new Error('rejected non-fast-forward');
        error.stderr = '[rejected] main -> main (non-fast-forward)';
        throw error;
      }
      return '';
    }
    if (optional) return '';
    return '';
  };
  return { calls, runGit };
}

test('publication stages only explicit knowledge paths and reports a no-remote commit honestly', async () => {
  const git = gitFixture();
  const events = [];
  const result = await publishKnowledge({
    repository: 'C:/example/private-wiki',
    message: 'knowledge: update guide',
  }, {
    runGit: git.runGit,
    verify: async () => events.push('verify'),
  });

  assert.equal(result.status, 'local-only');
  assert.equal(result.deploymentStatus, 'not-configured');
  assert.deepEqual(events, ['verify']);
  const add = git.calls.find(([command]) => command === 'add');
  assert.deepEqual(add, ['add', '--', 'content/articles/guide.md']);
  assert.equal(git.calls.some((args) => args.includes('-A')), false);
});

test('publication refuses non-knowledge changes before staging', async () => {
  const git = gitFixture({ status: ' M README.md\0' });
  await assert.rejects(
    () => publishKnowledge({ repository: 'C:/example/private-wiki' }, {
      runGit: git.runGit,
      verify: async () => assert.fail('verification must not run for a blocked tree'),
    }),
    /README\.md/u,
  );
  assert.equal(git.calls.some(([command]) => command === 'add'), false);
});

test('remote publication requires the checked-out default branch', async () => {
  const git = gitFixture({ remotes: 'origin', defaultBranch: 'trunk' });
  await assert.rejects(
    () => publishKnowledge({ repository: 'C:/example/private-wiki' }, {
      runGit: git.runGit,
      verify: async () => {},
    }),
    /默认分支 trunk/u,
  );
});

test('remote publication retries one non-fast-forward and never claims deployment success', async () => {
  const git = gitFixture({ remotes: 'origin', defaultBranch: 'main', pushFailures: 1 });
  let verifications = 0;
  const result = await publishKnowledge({ repository: 'C:/example/private-wiki' }, {
    runGit: git.runGit,
    verify: async () => { verifications += 1; },
  });

  assert.equal(result.status, 'pushed');
  assert.equal(result.deploymentStatus, 'unknown');
  assert.equal(git.calls.filter(([command]) => command === 'push').length, 2);
  assert.equal(git.calls.filter(([command]) => command === 'fetch').length, 2);
  assert.equal(git.calls.filter(([command]) => command === 'rebase').length, 2);
  assert.equal(verifications, 3);
});

test('publication stops after the single non-fast-forward retry', async () => {
  const git = gitFixture({ remotes: 'origin', defaultBranch: 'main', pushFailures: 2 });
  await assert.rejects(
    () => publishKnowledge({ repository: 'C:/example/private-wiki' }, {
      runGit: git.runGit,
      verify: async () => {},
    }),
    /non-fast-forward/u,
  );
  assert.equal(git.calls.filter(([command]) => command === 'push').length, 2);
});
