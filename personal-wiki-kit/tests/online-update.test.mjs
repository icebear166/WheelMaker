import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';

import {sha256File} from '../src/kit-lock.mjs';
import {activateInstalledKit, resolveOnlineKitUpdate} from '../src/online-update.mjs';
import {createTemporaryDirectory} from './support/temp-directory.mjs';

async function writeSkill(root, name, marker) {
  await mkdir(join(root, name, 'agents'), {recursive: true});
  await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${marker}\n---\n${marker}\n`);
  await writeFile(join(root, name, 'agents', 'openai.yaml'), `interface:\n  display_name: ${marker}\n  default_prompt: Use $${name}.\n`);
}

async function fixture() {
  const temporary = await createTemporaryDirectory('online-kit-update-');
  const configDirectory = join(temporary.path, 'user');
  const repository = join(temporary.path, 'wiki');
  const skillsDirectory = join(temporary.path, 'skills');
  const candidateKitRoot = join(temporary.path, 'candidate');
  const candidateArtifact = join(temporary.path, 'candidate.zip');
  await mkdir(join(configDirectory, 'kit', 'versions', '1.0.0'), {recursive: true});
  await mkdir(join(configDirectory, 'bin'), {recursive: true});
  await mkdir(join(repository, 'content', 'articles'), {recursive: true});
  await mkdir(join(candidateKitRoot, 'src'), {recursive: true});
  await mkdir(join(candidateKitRoot, 'runtime'), {recursive: true});
  await mkdir(join(candidateKitRoot, 'skills'), {recursive: true});
  await writeFile(join(configDirectory, 'kit', 'active-version.txt'), '1.0.0\n');
  await writeFile(join(configDirectory, 'bin', 'personal-wiki.cmd'), 'old launcher\n');
  await writeFile(join(configDirectory, 'config.json'), `${JSON.stringify({schema: 1, repositoryPath: repository})}\n`);
  await writeFile(join(configDirectory, 'project-routing.json'), '{"schema":1,"routes":[{"projectId":"keep","roots":["C:/keep"]}]}\n');
  await writeFile(join(repository, 'content', 'articles', 'keep.md'), 'private article\n');
  await writeFile(join(repository, 'wiki-kit.lock.json'), `${JSON.stringify({schema: 1, version: '1.0.0', source: 'wheelmaker-release', sha256: '1'.repeat(64)})}\n`);
  await writeSkill(skillsDirectory, 'lookup-knowledge', 'old lookup');
  await writeSkill(skillsDirectory, 'publish-knowledge', 'old publish');
  await writeFile(join(candidateKitRoot, 'kit.json'), '{"schema":1,"version":"1.1.0"}\n');
  await writeFile(join(candidateKitRoot, 'src', 'cli.mjs'), 'console.log("candidate");\n');
  await writeFile(join(candidateKitRoot, 'runtime', 'node.exe'), 'runtime');
  await writeSkill(join(candidateKitRoot, 'skills'), 'lookup-knowledge', 'new lookup');
  await writeSkill(join(candidateKitRoot, 'skills'), 'publish-knowledge', 'new publish');
  await writeFile(candidateArtifact, 'candidate archive');
  const targetLock = {
    schema: 1,
    version: '1.1.0',
    source: 'https://release.example.com/personal-wiki-kit/releases/v1.1.0/personal-wiki-kit-v1.1.0-windows-x64.zip',
    sha256: await sha256File(candidateArtifact),
  };
  return {temporary, configDirectory, repository, skillsDirectory, candidateKitRoot, candidateArtifact, targetLock};
}

test('installed update atomically switches version, launcher, lock and Skills while preserving private data', async () => {
  const value = await fixture();
  const result = await activateInstalledKit(value, {checkCompatibility: async () => {}});
  assert.equal(result.current.version, '1.1.0');
  assert.equal((await readFile(join(value.configDirectory, 'kit', 'active-version.txt'), 'utf8')).trim(), '1.1.0');
  assert.match(await readFile(join(value.configDirectory, 'bin', 'personal-wiki.cmd'), 'utf8'), /active-version\.txt/u);
  assert.match(await readFile(join(value.skillsDirectory, 'lookup-knowledge', 'SKILL.md'), 'utf8'), /new lookup/u);
  assert.equal(await readFile(join(value.repository, 'content', 'articles', 'keep.md'), 'utf8'), 'private article\n');
  assert.match(await readFile(join(value.configDirectory, 'project-routing.json'), 'utf8'), /C:\/keep/u);
  assert.equal(JSON.parse(await readFile(join(value.repository, 'wiki-kit.lock.json'), 'utf8')).version, '1.1.0');
  await value.temporary.cleanup();
});

test('failed post-switch compatibility check restores active version, launcher, lock and Skills', async () => {
  const value = await fixture();
  let checks = 0;
  await assert.rejects(() => activateInstalledKit(value, {
    checkCompatibility: async () => {
      checks += 1;
      if (checks === 2) throw new Error('candidate failed after switch');
    },
  }), /candidate failed after switch/u);
  assert.equal((await readFile(join(value.configDirectory, 'kit', 'active-version.txt'), 'utf8')).trim(), '1.0.0');
  assert.equal(await readFile(join(value.configDirectory, 'bin', 'personal-wiki.cmd'), 'utf8'), 'old launcher\n');
  assert.match(await readFile(join(value.skillsDirectory, 'lookup-knowledge', 'SKILL.md'), 'utf8'), /old lookup/u);
  assert.equal(JSON.parse(await readFile(join(value.repository, 'wiki-kit.lock.json'), 'utf8')).version, '1.0.0');
  await assert.rejects(() => readFile(join(value.configDirectory, 'kit', 'versions', '1.1.0', 'kit.json')));
  await value.temporary.cleanup();
});

test('online update shows current and target versions and stops before download when declined', async () => {
  const events = [];
  const result = await resolveOnlineKitUpdate({currentVersion: '1.0.0'}, {
    fetchStable: async () => ({schema: 1, version: '1.1.0', artifacts: {'windows-x64': {path: '/personal-wiki-kit/releases/v1.1.0/personal-wiki-kit-v1.1.0-windows-x64.zip', size: 10, sha256: 'a'.repeat(64)}}}),
    confirm: async message => {
      events.push(message);
      return false;
    },
    downloadAndActivate: async () => assert.fail('declined update must not download'),
  });
  assert.deepEqual(result, {changed: false, cancelled: true, currentVersion: '1.0.0', targetVersion: '1.1.0'});
  assert.match(events[0], /1\.0\.0/u);
  assert.match(events[0], /1\.1\.0/u);
});
