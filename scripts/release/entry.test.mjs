import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runReleaseEntry } from './entry.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

function fakeDependencies(overrides = {}) {
  const state = { commands: [], output: [], prompts: [] };
  return {
    state,
    channel: {
      owner: 'swm8023',
      repository: 'wheelmaker-release',
    },
    async getGitContext() {
      return {
        branch: 'feat/release',
        clean: true,
        head: HEAD,
        upstreamSha: HEAD,
      };
    },
    async prompt(question) {
      state.prompts.push(question);
      return 'n';
    },
    async run(command, args) {
      state.commands.push({ args, command });
    },
    write(message) {
      state.output.push(message);
    },
    ...overrides,
  };
}

test('local release entry asks three questions and defaults to build only', async () => {
  const deps = fakeDependencies();
  await runReleaseEntry('publish', deps);

  assert.equal(deps.state.prompts.length, 3);
  assert.match(deps.state.prompts[0], /Desktop.*\[y\/N\]/i);
  assert.match(deps.state.prompts[1], /Android.*\[y\/N\]/i);
  assert.match(deps.state.prompts[2], /public.*\[y\/N\]/i);
  assert.deepEqual(deps.state.commands[0].args, ['scripts/release.mjs']);
});

test('local release entry passes Desktop and publish choices in one invocation', async () => {
  const answers = ['y', 'y', 'y'];
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return answers.shift();
    },
  });
  await runReleaseEntry('publish', deps);

  assert.deepEqual(deps.state.commands[0].args, [
    'scripts/release.mjs',
    '--with-desktop',
    '--with-android',
    '--publish',
  ]);
});

test('action entry requires a clean pushed commit and passes optional asset choices', async () => {
  const answers = ['y', 'y', 'y'];
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return answers.shift();
    },
  });
  await runReleaseEntry('action', deps);

  assert.equal(deps.state.commands[0].command, 'gh');
  assert.deepEqual(deps.state.commands[0].args, [
    'workflow',
    'run',
    'publish-release.yml',
    '--ref',
    'feat/release',
    '-f',
    `ref=${HEAD}`,
    '-f',
    'with_desktop=true',
    '-f',
    'with_android=true',
  ]);
});

test('action entry fails without triggering when the commit is not pushed', async () => {
  const deps = fakeDependencies({
    async getGitContext() {
      return {
        branch: 'feat/release',
        clean: true,
        head: HEAD,
        upstreamSha: 'f'.repeat(40),
      };
    },
  });

  await assert.rejects(
    () => runReleaseEntry('action', deps),
    /push the current commit first/i,
  );
  assert.equal(deps.state.commands.length, 0);
});

test('two Windows BAT entrypoints delegate to the interactive release entry', async () => {
  for (const [name, mode] of [
    ['publish-release.bat', 'publish'],
    ['publish-release-action.bat', 'action'],
  ]) {
    const source = await readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
    assert.match(source, /scripts\\release\\entry\.mjs/);
    assert.match(source, new RegExp(`entry\\.mjs\" ${mode}`));
  }
  await assert.rejects(
    () => readFile(new URL('../../build-release.bat', import.meta.url), 'utf8'),
    /ENOENT/,
  );
});

test('manual Action builds and publishes in one release invocation', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/publish-release.yml', import.meta.url),
    'utf8',
  );
  assert.equal(workflow.match(/node scripts\/release\.mjs/g)?.length, 1);
  assert.match(workflow, /args\+?=\(--publish\)/);
  assert.match(workflow, /with_android:/);
  assert.match(workflow, /if: \$\{\{ inputs\.with_android \}\}/);
  assert.match(workflow, /actions\/setup-java@v4/);
  assert.match(workflow, /android-actions\/setup-android@v3/);
  assert.match(workflow, /gradle\/actions\/setup-gradle@v4/);
  assert.match(workflow, /\.release-work\/cache\/webpack/);
  assert.match(workflow, /\.release-work\/cache\/go-build/);
  assert.match(workflow, /\.release-work\/cache\/go-mod/);
  assert.match(workflow, /\.release-work\/cache\/gradle/);
  assert.doesNotMatch(workflow, /WHEELMAKER_SIGNING_PRIVATE_KEY/);
});

test('obsolete source-side Desktop and Web helper scripts are absent', async () => {
  for (const path of [
    '../../publish-desktop.bat',
    '../../update_exe.bat',
    '../publish_desktop.ps1',
    '../test_publish_desktop_ps1.ps1',
    '../test_update_exe_bat.ps1',
    '../../app/scripts/export_web_release.ps1',
  ]) {
    await assert.rejects(
      () => readFile(new URL(path, import.meta.url), 'utf8'),
      /ENOENT/,
    );
  }
});
