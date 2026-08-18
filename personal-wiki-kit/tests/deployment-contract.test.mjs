import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {renderDeploymentFiles} from '../src/deployment-config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const config = {schema: 1, domain: 'wiki.example.com', sshUser: 'wiki-deploy', sshPort: 2222, serviceUser: 'personal-wiki', installRoot: '/srv/personal-wiki', listenPort: 9765};

test('deployment templates are parameterized and contain no operator-specific defaults', async () => {
  for (const name of ['provision.sh', 'activate-release.sh', 'personal-wiki.service.template', 'Caddyfile.template', 'publish-action.yml.template']) {
    const source = await readFile(path.join(root, 'deployment', name), 'utf8');
    const withoutLoopback = source.replaceAll('127.0.0.1', '');
    assert.doesNotMatch(withoutLoopback, /[A-Z]:[\\/]/u);
    assert.doesNotMatch(withoutLoopback, /\/home\/[^/$]+|\b(?:\d{1,3}\.){3}\d{1,3}\b|BEGIN .*PRIVATE KEY|github_pat_/iu);
  }
});

test('rendered service and proxy expose only authenticated loopback server', async () => {
  const files = await renderDeploymentFiles(config, {templatesRoot: path.join(root, 'deployment')});
  assert.match(files['personal-wiki.service'], /--mode online --listen 127\.0\.0\.1:9765/u);
  assert.match(files['personal-wiki.service'], /LoadCredential=wiki-password:\/srv\/personal-wiki\/shared\/password\.argon2id/u);
  for (const hardening of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict', 'ProtectHome=true']) assert.match(files['personal-wiki.service'], new RegExp(hardening, 'u'));
  assert.match(files.Caddyfile, /^wiki\.example\.com \{/mu);
  assert.match(files.Caddyfile, /reverse_proxy 127\.0\.0\.1:9765/u);
  assert.doesNotMatch(files.Caddyfile, /reverse_proxy 0\.0\.0\.0/u);
});

test('activation verifies and locks candidates, switches atomically, and rolls back failed health', async () => {
  const {['activate-release.sh']: script} = await renderDeploymentFiles(config, {templatesRoot: path.join(root, 'deployment')});
  assert.match(script, /personal-wiki-release-\*\.tar\.gz/u);
  assert.match(script, /flock -x 9/u);
  assert.match(script, /sha256sum --check/u);
  assert.match(script, /verify-root --root/u);
  assert.match(script, /ln -sfn/u);
  assert.match(script, /mv -Tf/u);
  assert.match(script, /rollback/u);
  assert.match(script, /curl --fail --silent --show-error http:\/\/127\.0\.0\.1:9765\/healthz/u);
});

test('publish action uses secret-only SSH with strict known-host checking', async () => {
  const {['publish-action.yml']: workflow} = await renderDeploymentFiles(config, {templatesRoot: path.join(root, 'deployment')});
  for (const secret of ['WIKI_DEPLOY_KEY', 'WIKI_SSH_KNOWN_HOSTS', 'WIKI_DEPLOY_HOST']) assert.match(workflow, new RegExp(`secrets\\.${secret}`, 'u'));
  assert.match(workflow, /StrictHostKeyChecking=yes/u);
  assert.match(workflow, /UserKnownHostsFile=/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no|ssh-keyscan|\/latest(?:\/|$)|download[^\n]*latest/iu);
});
