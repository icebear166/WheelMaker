import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  releasePublicUrl,
  validateReleaseChannel,
  versionAssetPath,
} from './channel.mjs';

test('release channel has one canonical HTTPS base URL', async () => {
  const raw = JSON.parse(
    await readFile(new URL('./channel.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(raw, {baseUrl: 'https://release.wheelmaker.top'});
  assert.equal(
    releasePublicUrl(raw, '/stable.json'),
    'https://release.wheelmaker.top/stable.json',
  );
  assert.throws(() => releasePublicUrl(raw, 'stable.json'), /root-relative/);
  assert.throws(
    () => releasePublicUrl(raw, '//evil.example/stable.json'),
    /same origin/,
  );
});

test('release channel rejects fallback fields and non-origin base URLs', () => {
  assert.throws(
    () => validateReleaseChannel({
      baseUrl: 'https://release.wheelmaker.top',
      fallbackUrl: 'https://example.com',
    }),
    /only baseUrl/,
  );
  assert.throws(
    () => validateReleaseChannel({baseUrl: 'http://release.wheelmaker.top'}),
    /clean HTTPS origin/,
  );
  assert.throws(
    () => validateReleaseChannel({baseUrl: 'https://release.wheelmaker.top/files'}),
    /clean HTTPS origin/,
  );
});

test('version asset paths accept only v1.x and one safe filename', () => {
  assert.equal(
    versionAssetPath('v1.12', 'WheelMakerDesktop.exe'),
    '/releases/v1.12/WheelMakerDesktop.exe',
  );
  assert.throws(() => versionAssetPath('v2.0', 'x'), /invalid release asset/);
  assert.throws(() => versionAssetPath('v1.1', '../x'), /invalid release asset/);
});
