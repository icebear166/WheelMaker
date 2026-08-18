import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {compareReleaseIdentity, readReleaseIdentity} from '../src/manifest-equivalence.mjs';

async function releaseFixture(t, id = 'article-a') {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-identity-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'data', 'articles'), {recursive: true});
  await writeFile(path.join(root, 'data', 'catalog.json'), `${JSON.stringify({schema: 1, generatedAt: 'one', articleCount: 1, sections: [{id: 'topic', categories: [{id: 'category', articles: [{id}]}]}], projects: []})}\n`);
  await writeFile(path.join(root, 'data', 'search.json'), `${JSON.stringify({schema: 1, generatedAt: 'one', entries: [{id, title: 'A'}]})}\n`);
  await writeFile(path.join(root, 'data', 'articles', `${id}.json`), `${JSON.stringify({schema: 1, metadata: {id, title: 'A'}, body: 'Body'})}\n`);
  return root;
}

test('release identity ignores generation time but preserves catalogs, search, IDs, URLs, and article payloads', async (t) => {
  const before = await releaseFixture(t);
  const after = await releaseFixture(t);
  const identity = await readReleaseIdentity(before);
  assert.deepEqual(identity.articleIds, ['article-a']);
  assert.deepEqual(await compareReleaseIdentity(before, after), {equivalent: true, differences: []});
});

test('release identity reports changed article IDs and search entries', async (t) => {
  const before = await releaseFixture(t, 'article-a');
  const after = await releaseFixture(t, 'article-b');
  const result = await compareReleaseIdentity(before, after);
  assert.equal(result.equivalent, false);
  assert.ok(result.differences.some((difference) => difference.includes('article IDs')));
});
