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
    async readBuildRecord() {
      return {
        build: {
          desktopExe: 'D:\\repo\\.release-out\\desktop\\WheelMakerDesktop.exe',
          platforms: [
            { key: 'windows-amd64' },
            { key: 'linux-amd64' },
            { key: 'darwin-arm64' },
          ],
        },
        cleanSource: true,
        sourceSha: HEAD,
      };
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

test('build entry asks for Desktop and defaults to excluding it', async () => {
  const deps = fakeDependencies();
  await runReleaseEntry('build', deps);

  assert.match(deps.state.prompts[0], /Desktop.*\[y\/N\]/i);
  assert.deepEqual(deps.state.commands[0].args.slice(-2), [
    'scripts/release.mjs',
    'build',
  ]);
});

test('build entry passes --with-desktop only after an affirmative answer', async () => {
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return 'y';
    },
  });
  await runReleaseEntry('build', deps);

  assert.equal(deps.state.commands[0].args.at(-1), '--with-desktop');
});

test('publish entry fails before prompting when no build record exists', async () => {
  const deps = fakeDependencies({ readBuildRecord: async () => null });

  await assert.rejects(
    () => runReleaseEntry('publish', deps),
    /run build-release\.bat first/i,
  );
  assert.equal(deps.state.prompts.length, 0);
  assert.equal(deps.state.commands.length, 0);
});

test('publish entry shows recorded Desktop state and never asks how to build', async () => {
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return 'y';
    },
  });
  await runReleaseEntry('publish', deps);

  assert.equal(deps.state.prompts.length, 1);
  assert.match(deps.state.prompts[0], /确认正式发布.*\[y\/N\]/);
  assert.match(deps.state.output.join('\n'), /Desktop: included/i);
  assert.deepEqual(deps.state.commands[0].args.slice(-2), [
    'scripts/release.mjs',
    'publish',
  ]);
});

test('action entry requires a clean pushed commit and passes Desktop choice', async () => {
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return deps.state.prompts.length === 1 ? 'y' : 'y';
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

test('three Windows BAT entrypoints delegate to the interactive release entry', async () => {
  for (const [name, mode] of [
    ['build-release.bat', 'build'],
    ['publish-release.bat', 'publish'],
    ['publish-release-action.bat', 'action'],
  ]) {
    const source = await readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
    assert.match(source, /scripts\\release\\entry\.mjs/);
    assert.match(source, new RegExp(`entry\\.mjs\" ${mode}`));
  }
});

test('manual Action builds once before publishing without a signing secret', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/publish-release.yml', import.meta.url),
    'utf8',
  );
  const build = workflow.indexOf('node scripts/release.mjs build');
  const publish = workflow.indexOf('node scripts/release.mjs publish');

  assert.notEqual(build, -1);
  assert.equal(publish > build, true);
  assert.doesNotMatch(workflow, /WHEELMAKER_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /run: node scripts\/release\.mjs publish\s*$/m);
});
