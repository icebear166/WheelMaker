import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {buildDebugWeb, createDebugWebZip} from './debug-web.mjs';

test('debug web zip contains only safe release files in stable order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-debug-web-'));
  try {
    const source = join(root, 'web');
    await mkdir(join(source, 'assets'), {recursive: true});
    await writeFile(join(source, 'index.html'), '<html/>');
    await writeFile(join(source, 'assets', 'app.js'), 'console.log(1)');
    const archive = await createDebugWebZip({sourceDir: source, outputPath: join(root, 'web.zip')});
    const bytes = await readFile(archive);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(bytes.includes(Buffer.from('assets/app.js')));
    assert.ok(bytes.includes(Buffer.from('index.html')));
  } finally { await rm(root, {force: true, recursive: true}); }
});

test('debug web build writes a local verified archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-debug-web-publish-'));
  const calls = [];
  const runner = async (_command, args, options) => {
    calls.push(['run', args, options]);
    if (args.includes('build:web:release')) await writeFile(join(options.env.WHEELMAKER_WEB_TARGET, 'index.html'), '<html/>');
  };
  try {
    const archive = await buildDebugWeb({repoRoot: root, outputPath: join(root, 'job', 'debug-web.zip'), runner});
    assert.equal(calls.filter(([kind]) => kind === 'run').length, 2);
    assert.equal(archive.path, join(root, 'job', 'debug-web.zip'));
    assert.equal(archive.size > 0, true);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root, {force: true, recursive: true}); }
});
