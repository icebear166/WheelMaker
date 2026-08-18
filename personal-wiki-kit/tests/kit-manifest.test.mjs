import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseKitManifest, scanPublicTree } from '../src/kit-manifest.mjs';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'personal-wiki-kit-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(root, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf8');
    }
    return run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

test('kit manifest accepts only the supported strict schema', () => {
  assert.deepEqual(parseKitManifest('{"schema":1,"version":"0.1.0"}'), {
    schema: 1,
    version: '0.1.0',
  });
  assert.throws(
    () => parseKitManifest('{"schema":1,"version":"latest"}'),
    /semantic version/,
  );
  assert.throws(
    () => parseKitManifest('{"schema":1,"version":"0.1.0","channel":"stable"}'),
    /unsupported field/,
  );
  assert.throws(
    () => parseKitManifest('{"schema":2,"version":"0.1.0"}'),
    /schema/,
  );
});

test('public boundary accepts generic examples and ignores generated roots', () => {
  const httpsPrefix = ['https', '://'].join('');
  const ignoredPrivateDomain = `${httpsPrefix}${'wiki.private.invalid'}`;
  const ignoredUserPath = `${'C:'}/${'Users'}/Generated/private-wiki`;
  withFixture(
    {
      'README.md': [
        'https://example.com/wiki',
        'http://127.0.0.1:4173',
        'http://localhost:4173',
        'C:/example/personal-wiki',
      ].join('\n'),
      'node_modules/package/private.txt': ignoredPrivateDomain,
      'reader-dist/private.txt': ignoredUserPath,
    },
    (fixtureRoot) => assert.deepEqual(scanPublicTree(fixtureRoot), []),
  );
});

test('public boundary reports private content roots and machine-specific values', () => {
  const httpsPrefix = ['https', '://'].join('');
  const privateKeyMarker = `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----`;
  const driveSpecificPath = `${'D:'}/Users/Alice/private-wiki`;
  const nonExampleDomain = `${httpsPrefix}${'wiki.private-domain.invalid'}/knowledge`;

  withFixture(
    {
      'content/articles/private.md': '# Private article',
      'notes/host.txt': `${driveSpecificPath}\n${nonExampleDomain}\n${privateKeyMarker}`,
    },
    (fixtureRoot) => {
      assert.deepEqual(scanPublicTree(fixtureRoot), [
        {
          path: 'content/articles/private.md',
          reason: 'private knowledge content is not allowed in the public Kit',
        },
        {
          path: 'notes/host.txt',
          reason: 'machine-specific user path is not allowed in the public Kit',
        },
        {
          path: 'notes/host.txt',
          reason: 'non-example domain is not allowed in the public Kit',
        },
        {
          path: 'notes/host.txt',
          reason: 'private key material is not allowed in the public Kit',
        },
      ]);
    },
  );
});

test('public boundary keeps the committed Kit tree clean', () => {
  assert.deepEqual(scanPublicTree(kitRoot), []);
});
