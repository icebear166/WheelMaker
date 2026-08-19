import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { installSkills } from '../src/install-skills.mjs';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-skills-'));
  t.after(() => rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 }));
  const destinationRoot = join(root, 'skills');
  await mkdir(join(destinationRoot, 'lookup-knowledge'), { recursive: true });
  await mkdir(join(destinationRoot, 'publish-knowledge'), { recursive: true });
  await writeFile(join(destinationRoot, 'lookup-knowledge', 'old.txt'), 'old lookup');
  await writeFile(join(destinationRoot, 'publish-knowledge', 'old.txt'), 'old publish');
  return { root, destinationRoot };
}

test('Skill installer atomically replaces both Skill trees and retains backups', async (t) => {
  const { destinationRoot } = await createFixture(t);
  const result = await installSkills({
    sourceRoot,
    destinationRoot,
    timestamp: '20260818T000000Z',
  });

  assert.match(await readFile(join(destinationRoot, 'lookup-knowledge', 'SKILL.md'), 'utf8'), /查询个人 Wiki/);
  assert.match(await readFile(join(destinationRoot, 'publish-knowledge', 'SKILL.md'), 'utf8'), /发布可靠知识/);
  assert.equal(result.backups.length, 2);
  for (const backup of result.backups) {
    assert.ok((await readdir(backup)).includes('old.txt'));
  }
});

test('Skill installer accepts Windows CRLF Skill files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-skills-crlf-'));
  t.after(() => rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 }));
  const windowsSourceRoot = join(root, 'source');
  const destinationRoot = join(root, 'destination');
  await cp(sourceRoot, windowsSourceRoot, { recursive: true });
  for (const skillName of ['lookup-knowledge', 'publish-knowledge']) {
    const filename = join(windowsSourceRoot, skillName, 'SKILL.md');
    const source = await readFile(filename, 'utf8');
    await writeFile(filename, source.replace(/\r?\n/gu, '\r\n'));
  }

  const result = await installSkills({
    sourceRoot: windowsSourceRoot,
    destinationRoot,
    timestamp: '20260818T000000Z-crlf',
  });

  assert.equal(result.installed.length, 2);
  assert.match(await readFile(join(destinationRoot, 'lookup-knowledge', 'SKILL.md'), 'utf8'), /name: lookup-knowledge/u);
});

test('Skill installer rolls every replacement back when post-install verification fails', async (t) => {
  const { destinationRoot } = await createFixture(t);
  await assert.rejects(
    () => installSkills({
      sourceRoot,
      destinationRoot,
      timestamp: '20260818T000000Z',
      verify: async (skillName) => {
        if (skillName === 'publish-knowledge') throw new Error('injected verification failure');
      },
    }),
    /injected verification failure/,
  );
  assert.equal(await readFile(join(destinationRoot, 'lookup-knowledge', 'old.txt'), 'utf8'), 'old lookup');
  assert.equal(await readFile(join(destinationRoot, 'publish-knowledge', 'old.txt'), 'utf8'), 'old publish');
});
