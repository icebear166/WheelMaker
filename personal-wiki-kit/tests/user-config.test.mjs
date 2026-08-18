import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import test from 'node:test';

import {
  parseUserConfig,
  resolveUserConfigPaths,
} from '../src/user-config.mjs';

test('user config accepts only the repository locator and optional public origin', () => {
  const repositoryPath = resolve('example', 'private-wiki');
  assert.deepEqual(parseUserConfig(JSON.stringify({
    schema: 1,
    repositoryPath,
    publicUrl: 'https://wiki.example.com/',
  })), {
    schema: 1,
    repositoryPath,
    publicUrl: 'https://wiki.example.com',
  });
});

test('user config rejects unknown, remote, branch, and credential fields', () => {
  for (const field of ['remote', 'defaultBranch', 'password', 'token']) {
    assert.throws(
      () => parseUserConfig(JSON.stringify({
        schema: 1,
        repositoryPath: resolve('example', 'private-wiki'),
        [field]: 'forbidden',
      })),
      new RegExp(`不支持的字段 ${field}`),
    );
  }
});

test('user config requires an absolute canonical path and safe origin-only URL', () => {
  assert.throws(
    () => parseUserConfig('{"schema":1,"repositoryPath":"relative/wiki"}'),
    /绝对路径/,
  );
  assert.throws(
    () => parseUserConfig(JSON.stringify({
      schema: 1,
      repositoryPath: resolve('example', 'private-wiki'),
      publicUrl: 'https://user@example.com/wiki?token=value',
    })),
    /公开地址必须是规范 origin/,
  );
  assert.throws(
    () => parseUserConfig(JSON.stringify({
      schema: 1,
      repositoryPath: resolve('example', 'private-wiki'),
      publicUrl: 'http://wiki.example.com',
    })),
    /公网地址必须使用 HTTPS/,
  );
});

test('user config paths default to the independent personal wiki directory', () => {
  const homeDirectory = resolve('example', 'home');
  const paths = resolveUserConfigPaths({homeDirectory});
  assert.equal(paths.directory, join(homeDirectory, '.personal-wiki'));
  assert.equal(paths.config, join(paths.directory, 'config.json'));
  assert.equal(paths.routing, join(paths.directory, 'project-routing.json'));
});
