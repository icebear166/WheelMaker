import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {parseDeploymentConfig, renderDeploymentFiles} from '../src/deployment-config.mjs';

const templatesRoot = path.resolve(import.meta.dirname, '..', 'deployment');

test('deployment config canonicalizes public values and contains no credential fields', () => {
  assert.deepEqual(parseDeploymentConfig({
    schema: 1,
    domain: 'Wiki.Example.COM',
    sshUser: 'wiki-deploy',
    sshPort: 2222,
    serviceUser: 'personal-wiki',
    installRoot: '/srv/personal-wiki',
    listenPort: 9765,
  }), {
    schema: 1,
    domain: 'wiki.example.com',
    sshUser: 'wiki-deploy',
    sshPort: 2222,
    serviceUser: 'personal-wiki',
    installRoot: '/srv/personal-wiki',
    listenPort: 9765,
  });
  for (const field of ['password', 'passwordHash', 'privateKey', 'deployKey']) {
    assert.throws(() => parseDeploymentConfig({schema: 1, domain: 'wiki.example.com', sshUser: 'deploy', sshPort: 22, serviceUser: 'wiki', installRoot: '/srv/wiki', listenPort: 9765, [field]: 'secret'}), /unsupported field/u);
  }
});

test('deployment config rejects non-host domains, broad roots, and unsafe users or ports', () => {
  const base = {schema: 1, domain: 'wiki.example.com', sshUser: 'deploy', sshPort: 22, serviceUser: 'wiki', installRoot: '/srv/wiki', listenPort: 9765};
  for (const domain of ['https://wiki.example.com', 'wiki.example.com/path', 'localhost', '192.0.2.1']) {
    assert.throws(() => parseDeploymentConfig({...base, domain}), /domain/u);
  }
  for (const installRoot of ['/', '/srv', 'relative/wiki', '/srv/wiki/../other']) {
    assert.throws(() => parseDeploymentConfig({...base, installRoot}), /installRoot/u);
  }
  assert.throws(() => parseDeploymentConfig({...base, sshUser: 'root'}), /sshUser/u);
  assert.throws(() => parseDeploymentConfig({...base, listenPort: 80}), /listenPort/u);
});

test('deployment renderer replaces every placeholder without adding secrets', async () => {
  const files = await renderDeploymentFiles({
    schema: 1,
    domain: 'wiki.example.com',
    sshUser: 'wiki-deploy',
    sshPort: 2222,
    serviceUser: 'personal-wiki',
    installRoot: '/srv/personal-wiki',
    listenPort: 9765,
  }, {templatesRoot});
  assert.deepEqual(Object.keys(files).sort(), [
    'Caddyfile',
    'activate-release.sh',
    'personal-wiki.service',
    'provision.sh',
    'publish-action.yml',
  ]);
  for (const [name, content] of Object.entries(files)) {
    assert.doesNotMatch(content, /\{\{[A-Z_]+\}\}/u, `${name} retained a placeholder`);
    assert.doesNotMatch(content, /BEGIN .*PRIVATE KEY|\$argon2id\$|github_pat_|gh[pousr]_[A-Za-z0-9]/iu, `${name} contains a credential`);
  }
});
