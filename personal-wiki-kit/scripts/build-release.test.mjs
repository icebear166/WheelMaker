import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {stageReleaseTree, verifyReleaseTree} from './build-release.mjs';

async function makeFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wiki-kit-release-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const kit = path.join(root, 'kit');
  const reader = path.join(kit, 'reader-dist');
  for (const directory of ['deployment', 'src', 'schema', 'skills/lookup-knowledge', 'templates/private-repository', 'runtime']) {
    await mkdir(path.join(kit, directory), {recursive: true});
  }
  await mkdir(reader, {recursive: true});
  await writeFile(path.join(kit, 'kit.json'), '{"schema":1,"version":"0.1.0"}\n');
  await writeFile(path.join(kit, 'package.json'), '{"name":"fixture","version":"0.1.0","type":"module"}\n');
  await writeFile(path.join(kit, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}\n');
  await writeFile(path.join(kit, 'README.md'), 'kit\n');
  await writeFile(path.join(kit, 'runtime', 'README.md'), 'runtime\n');
  await writeFile(path.join(kit, 'deployment', 'Caddyfile.template'), '{{DOMAIN}}\n');
  await writeFile(path.join(kit, 'src', 'cli.mjs'), 'console.log("ok")\n');
  await writeFile(path.join(kit, 'schema', 'article.schema.json'), '{}\n');
  await writeFile(path.join(kit, 'skills', 'lookup-knowledge', 'SKILL.md'), '# fixture\n');
  await writeFile(path.join(kit, 'templates', 'private-repository', 'README.md'), 'private\n');
  await mkdir(path.join(kit, 'templates', 'private-repository', '.wiki-kit-out'), {recursive: true});
  await writeFile(path.join(kit, 'templates', 'private-repository', '.wiki-kit-out', 'private-build.txt'), 'must not ship\n');
  await writeFile(path.join(reader, 'index.html'), '<main></main>\n');
  await writeFile(path.join(reader, 'reader-manifest.json'), '{"schema":1}\n');
  const runtime = path.join(root, 'node.exe');
  const server = path.join(root, 'wiki-server.exe');
  await writeFile(runtime, 'runtime');
  await writeFile(server, 'server');
  return {root, kit, reader, runtime, server};
}

test('Windows release tree is complete and its manifest rejects missing or extra files', async (t) => {
  const fixture = await makeFixture(t);
  const destination = path.join(fixture.root, 'stage');
  const result = await stageReleaseTree({kitRoot: fixture.kit, destination, platform: 'windows-x64', runtimeExecutable: fixture.runtime, serverExecutable: fixture.server, readerRoot: fixture.reader, includeProductionDependencies: false});
  assert.equal(result.version, '0.1.0');
  for (const relative of ['runtime/node.exe', 'bin/wiki-server.exe', 'deployment/Caddyfile.template', 'reader-dist/index.html', 'skills/lookup-knowledge/SKILL.md', 'templates/private-repository/README.md', 'setup-wiki.bat', 'personal-wiki.cmd', 'release-files.json']) {
    assert.ok(result.files.includes(relative), `missing ${relative}`);
  }
  assert.equal(result.files.some((relative) => relative.includes('.wiki-kit-out')), false);
  await verifyReleaseTree(destination);
  await writeFile(path.join(destination, 'unexpected.txt'), 'no');
  await assert.rejects(() => verifyReleaseTree(destination), /unlisted release file/u);
  await rm(path.join(destination, 'unexpected.txt'));
  await rm(path.join(destination, 'src', 'cli.mjs'));
  await assert.rejects(() => verifyReleaseTree(destination), /missing release file/u);
});

test('Linux release marks runtime, server, and launcher executable', async (t) => {
  const fixture = await makeFixture(t);
  const destination = path.join(fixture.root, 'linux-stage');
  await stageReleaseTree({kitRoot: fixture.kit, destination, platform: 'linux-x64', runtimeExecutable: fixture.runtime, serverExecutable: fixture.server, readerRoot: fixture.reader, includeProductionDependencies: false});
  const manifest = JSON.parse(await readFile(path.join(destination, 'release-files.json'), 'utf8'));
  const modes = new Map(manifest.files.map((file) => [file.path, file.mode]));
  assert.equal(modes.get('runtime/bin/node'), '0755');
  assert.equal(modes.get('bin/wiki-server'), '0755');
  assert.equal(modes.get('personal-wiki'), '0755');
});
