import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  migrateLegacyConfig,
  previewLegacyMigration,
} from '../src/migrate-config.mjs';

async function createFixture(t, { existing = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'personal-wiki-migrate-'));
  t.after(() => rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 }));
  const repositoryPath = join(root, 'wiki');
  const legacyConfigPath = join(root, 'legacy-personal-wiki.json');
  const legacyRoutingPath = join(root, 'legacy-project-routing.json');
  const destinationDirectory = join(root, 'new-config');
  await writeFile(legacyConfigPath, JSON.stringify({
    repositoryPath,
    publicUrl: 'https://wiki.example.com',
  }));
  await writeFile(legacyRoutingPath, JSON.stringify({
    schema: 1,
    routes: [{
      projectId: 'shared-engine-projects',
      roots: [join(root, 'ProjectA'), join(root, 'ProjectB')],
    }],
  }));
  if (existing) {
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(join(destinationDirectory, 'config.json'), '{"schema":1,"repositoryPath":"C:\\\\example\\\\old"}\n');
    await writeFile(join(destinationDirectory, 'project-routing.json'), '{"schema":1,"routes":[]}\n');
  }
  return { root, repositoryPath, legacyConfigPath, legacyRoutingPath, destinationDirectory };
}

test('legacy migration preview describes the cutover without writing files', async (t) => {
  const fixture = await createFixture(t);
  const preview = await previewLegacyMigration(fixture);
  assert.equal(preview.config.repositoryPath, fixture.repositoryPath);
  assert.equal(preview.routing.routes[0].roots.length, 2);
  await assert.rejects(() => access(join(fixture.destinationDirectory, 'config.json')));
});

test('legacy migration backs up existing files, writes new config, and verifies cutover', async (t) => {
  const fixture = await createFixture(t, { existing: true });
  let verified = false;
  const result = await migrateLegacyConfig(fixture, {
    confirm: async () => true,
    verify: async ({ configPath, routingPath }) => {
      verified = true;
      await access(configPath);
      await access(routingPath);
    },
    timestamp: '20260818T000000Z',
  });
  assert.equal(result.status, 'migrated');
  assert.equal(verified, true);
  assert.equal(JSON.parse(await readFile(join(fixture.destinationDirectory, 'config.json'), 'utf8')).schema, 1);
  assert.equal(result.backups.length, 2);
  for (const backup of result.backups) await access(backup);
});

test('legacy migration restores prior files when verification fails', async (t) => {
  const fixture = await createFixture(t, { existing: true });
  const oldConfig = await readFile(join(fixture.destinationDirectory, 'config.json'), 'utf8');
  const oldRouting = await readFile(join(fixture.destinationDirectory, 'project-routing.json'), 'utf8');
  await assert.rejects(
    () => migrateLegacyConfig(fixture, {
      confirm: async () => true,
      verify: async () => { throw new Error('injected cutover failure'); },
      timestamp: '20260818T000000Z',
    }),
    /injected cutover failure/,
  );
  assert.equal(await readFile(join(fixture.destinationDirectory, 'config.json'), 'utf8'), oldConfig);
  assert.equal(await readFile(join(fixture.destinationDirectory, 'project-routing.json'), 'utf8'), oldRouting);
});
