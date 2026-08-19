import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {renderPrivatePublishWorkflow} from '../src/deployment-config.mjs';
import {runCLI} from '../src/cli.mjs';
import {setupWiki} from '../src/setup.mjs';
import {createTemporaryDirectory} from './support/temp-directory.mjs';

const kitRoot = path.resolve(import.meta.dirname, '..');
const source = 'https://github.com/example/WheelMaker/releases/download/personal-wiki-kit-v0.1.0/personal-wiki-kit-v0.1.0-linux-x64.tar.gz';
const sha256 = 'a'.repeat(64);
const deployment = {schema: 1, domain: 'wiki.example.com', sshUser: 'wiki-deploy', sshPort: 2222, serviceUser: 'personal-wiki', installRoot: '/srv/personal-wiki', listenPort: 9765};

test('generated online workflow downloads and verifies one pinned Kit without compiling it', async () => {
  const workflow = await renderPrivatePublishWorkflow({
    deployment,
    kitLock: {schema: 1, version: '0.1.0', source, sha256},
  }, {templatePath: path.join(kitRoot, 'templates', 'private-repository', '.github', 'workflows', 'publish.yml')});
  assert.match(workflow, new RegExp(source.replaceAll('.', '\\.').replaceAll('/', '\\/'), 'u'));
  assert.match(workflow, new RegExp(sha256, 'u'));
  assert.match(workflow, /sha256sum --check/u);
  assert.match(workflow, /runtime\/bin\/node/u);
  assert.match(workflow, /src\/cli\.mjs" build/u);
  assert.doesNotMatch(workflow, /\blatest\b|npm (?:ci|install)|webpack|go build|repository:\s*[^\n]+/iu);
  for (const secret of ['WIKI_DEPLOY_KEY', 'WIKI_SSH_KNOWN_HOSTS', 'WIKI_DEPLOY_HOST', 'WIKI_DEPLOY_PORT']) assert.match(workflow, new RegExp(`secrets\\.${secret}`, 'u'));
  assert.match(workflow, /StrictHostKeyChecking=yes/u);
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking=no/u);
});

test('local-only setup omits the workflow while online setup renders only non-secret deployment data', async (t) => {
  const temporary = await createTemporaryDirectory('generated-workflow-');
  t.after(() => temporary.cleanup());
  const common = {
    configDirectory: path.join(temporary.path, 'config'),
    skillsDirectory: path.join(temporary.path, 'skills'),
    kitRoot,
    kitVersion: '0.1.0',
    kitSource: 'local-kit',
    kitSha256: sha256,
    siteTitle: 'Wiki',
  };
  const dependencies = {runCommand: async () => {}, timestamp: 'fixture'};
  const localRepository = path.join(temporary.path, 'local');
  await setupWiki({...common, repositoryPath: localRepository}, dependencies);
  await assert.rejects(() => access(path.join(localRepository, '.github', 'workflows', 'publish.yml')));

  const onlineRepository = path.join(temporary.path, 'online');
  await setupWiki({
    ...common,
    repositoryPath: onlineRepository,
    configDirectory: path.join(temporary.path, 'online-config'),
    skillsDirectory: path.join(temporary.path, 'online-skills'),
    kitSource: source,
    publicUrl: 'https://wiki.example.com',
    deployment,
  }, {...dependencies, timestamp: 'online-fixture'});
  const workflow = await readFile(path.join(onlineRepository, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(workflow, /personal-wiki-kit-v0\.1\.0-linux-x64\.tar\.gz/u);
  const wikiConfig = JSON.parse(await readFile(path.join(onlineRepository, 'wiki.config.json'), 'utf8'));
  assert.equal(wikiConfig.online, true);
  assert.deepEqual(wikiConfig.deployment, deployment);
});

test('CLI can generate an online data-only repository from explicit non-interactive options', async (t) => {
  const temporary = await createTemporaryDirectory('generated-workflow-cli-');
  t.after(() => temporary.cleanup());
  const repository = path.join(temporary.path, 'wiki');
  await runCLI([
    'setup',
    '--repository', repository,
    '--config-directory', path.join(temporary.path, 'config'),
    '--skills-directory', path.join(temporary.path, 'skills'),
    '--title', 'CLI Wiki',
    '--kit-source', source,
    '--kit-sha256', sha256,
    '--deployment-domain', deployment.domain,
    '--deployment-ssh-user', deployment.sshUser,
    '--deployment-ssh-port', String(deployment.sshPort),
    '--deployment-service-user', deployment.serviceUser,
    '--deployment-install-root', deployment.installRoot,
    '--deployment-listen-port', String(deployment.listenPort),
    '--non-interactive',
  ], {
    prompt: {close() {}},
    stdout: {write() {}},
  });
  const workflow = await readFile(path.join(repository, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(workflow, /KIT_SHA256/u);
});
