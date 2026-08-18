import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ContentValidationError,
  compileKnowledge,
} from '../src/content.mjs';
import { verifyReleaseRoot } from '../src/release-manifest.mjs';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const generatedAt = '2026-08-18T00:00:00.000Z';

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-content-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const repository = join(root, 'repository');
  await cp(join(fixturesRoot, 'valid-wiki'), repository, { recursive: true });
  return { root, repository };
}

async function captureValidationError(action) {
  let captured;
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof ContentValidationError);
    captured = error;
    return true;
  });
  return captured;
}

test('content compiler emits topic and project catalogs with a verified release manifest', async (t) => {
  const { root, repository } = await createFixture(t);
  const output = join(root, 'output');

  const result = await compileKnowledge({ repository, output, generatedAt });

  assert.equal(result.catalog.articleCount, 1);
  assert.equal(result.catalog.sections[0].categories[0].articles[0].id, 'example-article');
  assert.equal(result.catalog.projects[0].id, 'example-project');
  assert.equal(
    result.catalog.projects[0].sections[0].categories[0].articles[0].id,
    'example-article',
  );
  assert.equal(await verifyReleaseRoot(output), true);
  assert.match(
    await readFile(join(output, 'data', 'articles', 'example-article.json'), 'utf8'),
    /当前结论/,
  );
});

test('content compiler output is deterministic for the same inputs and timestamp', async (t) => {
  const { root, repository } = await createFixture(t);
  const firstOutput = join(root, 'first');
  const secondOutput = join(root, 'second');

  await compileKnowledge({ repository, output: firstOutput, generatedAt });
  await compileKnowledge({ repository, output: secondOutput, generatedAt });

  assert.equal(
    await readFile(join(firstOutput, 'release-manifest.json'), 'utf8'),
    await readFile(join(secondOutput, 'release-manifest.json'), 'utf8'),
  );
});

test('content compiler rejects raw HTML, credentials, and traversal links', async (t) => {
  const { root, repository } = await createFixture(t);
  const articlePath = join(repository, 'content', 'articles', 'example-article.md');
  const original = await readFile(articlePath, 'utf8');
  const assignedSecret = ['pass', 'word = "abcdefghijklmnop"'].join('');
  await writeFile(
    articlePath,
    `${original}\n<div>unsafe</div>\n\n${assignedSecret}\n\n[outside](../../../outside.txt)\n`,
  );
  await writeFile(join(root, 'outside.txt'), 'outside repository');

  const error = await captureValidationError(
    () => compileKnowledge({ repository, output: join(root, 'output'), generatedAt }),
  );
  assert.match(error.message, /raw HTML/);
  assert.match(error.message, /assigned credential/);
  assert.match(error.message, /escapes repository/);
});

test('content compiler rejects unsupported and unreferenced attachments', async (t) => {
  const { root, repository } = await createFixture(t);
  await writeFile(join(repository, 'attachments', 'blocked.exe'), 'not allowed');
  await writeFile(join(repository, 'attachments', 'unused.txt'), 'not referenced');

  const error = await captureValidationError(
    () => compileKnowledge({ repository, output: join(root, 'output'), generatedAt }),
  );
  assert.match(error.message, /attachment type \.exe is not allowed/);
  assert.match(error.message, /attachment is not referenced/);
});
