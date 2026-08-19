import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const setupPath = path.resolve(import.meta.dirname, '..', 'setup-wiki.bat');

test('public Windows installer resolves stable, verifies SHA-256 and installs the exact version', async () => {
  const source = await readFile(setupPath, 'utf8');
  assert.match(source, /https:\/\/release\.wheelmaker\.top\/personal-wiki-kit\/stable\.json/u);
  assert.match(source, /Get-FileHash/u);
  assert.match(source, /Length/u);
  assert.match(source, /Expand-Archive/u);
  assert.match(source, /kit[\\/]versions/u);
  assert.match(source, /active-version\.txt/u);
  assert.match(source, /--kit-source/u);
  assert.match(source, /--kit-sha256/u);
});

test('public Windows installer distinguishes complete reruns from partial installs', async () => {
  const source = await readFile(setupPath, 'utf8');
  assert.match(source, /现有 Personal Wiki/u);
  assert.match(source, /更新/u);
  assert.match(source, /残缺/u);
  assert.match(source, /拒绝覆盖/u);
});
