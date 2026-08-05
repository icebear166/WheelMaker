import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runReleaseEntry } from './entry.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

function fakeDependencies(overrides = {}) {
  const state = {commands: [], output: [], prompts: [], runQueries: []};
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
    async findWorkflowRun(query) {
      state.runQueries.push(query);
      return {
        databaseId: 4321,
        url: 'https://github.com/swm8023/WheelMaker/actions/runs/4321',
      };
    },
    now: () => '2026-07-17T01:00:00.000Z',
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

test('local release entry asks four questions and defaults to build only', async () => {
  const deps = fakeDependencies();
  await runReleaseEntry('publish', deps);

  assert.equal(deps.state.prompts.length, 4);
  assert.match(deps.state.prompts[0], /Desktop.*\[y\/N\]/i);
  assert.match(deps.state.prompts[1], /Android.*\[y\/N\]/i);
  assert.match(deps.state.prompts[2], /Gateway.*\[y\/N\]/i);
  assert.match(deps.state.prompts[3], /public release server.*\[y\/N\]/i);
  assert.deepEqual(deps.state.commands[0].args, ['scripts/release.mjs']);
});

test('local release entry can include Gateway in the same WheelMaker release', async () => {
  const answers = ['n', 'n', 'y', 'y'];
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return answers.shift();
    },
  });
  await runReleaseEntry('publish', deps);
  assert.match(deps.state.prompts[2], /Gateway/i);
  assert.deepEqual(deps.state.commands[0].args, [
    'scripts/release.mjs',
    '--with-gateway',
    '--publish',
  ]);
});

test('local release entry passes Desktop and publish choices in one invocation', async () => {
  const answers = ['y', 'y', 'y', 'y'];
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
    '--with-gateway',
    '--publish',
  ]);
});

test('action entry requires a clean pushed commit and passes optional asset choices', async () => {
  const answers = ['y', 'y', 'y', 'y'];
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
    '-f',
    'with_gateway=true',
  ]);
  assert.deepEqual(deps.state.runQueries, [
    {
      branch: 'feat/release',
      head: HEAD,
      startedAt: '2026-07-17T01:00:00.000Z',
      workflow: 'publish-release.yml',
    },
  ]);
  assert.deepEqual(deps.state.commands[1], {
    args: ['run', 'watch', '4321', '--exit-status'],
    command: 'gh',
  });
  assert.equal(
    deps.state.output.includes(
      'Action: https://github.com/swm8023/WheelMaker/actions/runs/4321',
    ),
    true,
  );
});

test('action entry prints failed step logs when the watched run fails', async () => {
  const answers = ['n', 'n', 'n', 'y'];
  const deps = fakeDependencies({
    async prompt(question) {
      deps.state.prompts.push(question);
      return answers.shift();
    },
    async run(command, args) {
      deps.state.commands.push({args, command});
      if (args[0] === 'run' && args[1] === 'watch') {
        throw new Error('workflow failed');
      }
    },
  });

  await assert.rejects(() => runReleaseEntry('action', deps), /workflow failed/);
  assert.deepEqual(deps.state.commands.at(-1), {
    args: ['run', 'view', '4321', '--log-failed'],
    command: 'gh',
  });
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
    assert.match(source, /set "EXIT_CODE=%ERRORLEVEL%"/i);
    assert.match(source, /pause/i);
    assert.match(source, /exit \/b %EXIT_CODE%/i);
  }
  await assert.rejects(
    () => readFile(new URL('../../build-release.bat', import.meta.url), 'utf8'),
    /ENOENT/,
  );
});

test('manual Action builds and publishes in one release invocation with one server token', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/publish-release.yml', import.meta.url),
    'utf8',
  );
  assert.equal(workflow.match(/node scripts\/release\.mjs/g)?.length, 1);
  const credentialCheck = workflow.indexOf('name: Validate publishing credentials');
  const checkout = workflow.indexOf('name: Check out selected source');
  assert.equal(credentialCheck >= 0 && credentialCheck < checkout, true);
  const preflight = workflow.slice(credentialCheck, checkout);
  assert.match(preflight, /WHEELMAKER_RELEASE_TOKEN/);
  assert.match(preflight, /missing publishing credential/i);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_APP_ID/);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_INSTALLATION_ID/);
  assert.doesNotMatch(workflow, /WHEELMAKER_RELEASE_APP_PRIVATE_KEY/);
  assert.match(workflow, /args\+?=\(--publish\)/);
  assert.match(workflow, /with_android:/);
  assert.match(workflow, /if: \$\{\{ inputs\.with_android \}\}/);
  assert.match(workflow, /with_gateway:/);
  assert.match(workflow, /args\+?=\(--with-gateway\)/);
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

test('obsolete standalone Android publishers and their script tests are absent', async () => {
  for (const path of [
    '../../publish-android.bat',
    '../../publish-android-github.bat',
    '../publish_android.ps1',
    '../publish_android_github_release.ps1',
    '../test_publish_android_ps1.ps1',
    '../test_publish_android_github_release_ps1.ps1',
  ]) {
    await assert.rejects(
      () => readFile(new URL(path, import.meta.url), 'utf8'),
      /ENOENT/,
    );
  }
});

test('source checkout deployment wrappers and their dedicated tests are absent', async () => {
  for (const path of [
    '../../deploy.bat',
    '../../deploy.sh',
    '../test_deploy_bat.ps1',
    '../test_deploy_sh.ps1',
  ]) {
    await assert.rejects(
      () => readFile(new URL(path, import.meta.url), 'utf8'),
      /ENOENT/,
    );
  }
});

test('release server deployment wrapper delegates to Node and pauses', async () => {
  const source = await readFile(
    new URL('../../deploy-release-server.bat', import.meta.url),
    'utf8',
  );
  assert.match(source, /scripts\\release-server\\deploy\.mjs/);
  assert.match(source, /deploy\.mjs" %\*/i);
  assert.match(source, /set "EXIT_CODE=%ERRORLEVEL%"/i);
  assert.match(source, /pause/i);
  assert.match(source, /exit \/b %EXIT_CODE%/i);
});

test('active installation docs use the self-hosted channel and one publishing token', async () => {
  for (const path of ['README.md', 'INSTALL.md', 'CLAUDE.md']) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /raw\.githubusercontent\.com\/swm8023\/wheelmaker-release/);
    assert.doesNotMatch(source, /WHEELMAKER_RELEASE_APP_(ID|PRIVATE_KEY)/);
    assert.doesNotMatch(source, /WHEELMAKER_RELEASE_INSTALLATION_ID/);
  }
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const install = await readFile(new URL('../../INSTALL.md', import.meta.url), 'utf8');
  assert.match(readme, /https:\/\/release\.wheelmaker\.top/);
  assert.match(install, /https:\/\/release\.wheelmaker\.top\/deploy\.mjs/);
  assert.match(readme, /WHEELMAKER_RELEASE_TOKEN/);
});
