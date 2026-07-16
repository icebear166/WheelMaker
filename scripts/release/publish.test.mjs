import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAppJwt, requestInstallationToken } from './github-app.mjs';
import { GitHubApi } from './github-api.mjs';
import { encodeJsonBytes } from './metadata.mjs';
import { makeStable, publishBuiltRelease } from './publish.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const SCRIPT_COMMIT_SHA = 'a'.repeat(40);
const PUBLISHED_AT = '2026-07-16T09:00:00.000Z';

class FakeGitHubApi {
  constructor({ failAt = '', previousStable = null, tagCollisionOnce = false } = {}) {
    this.events = [];
    this.failAt = failAt;
    this.lastStatus = null;
    this.releases = [];
    this.uploadedAssets = [];
    this.scriptFiles = null;
    this.stableFiles = null;
    this.tagCollisionOnce = tagCollisionOnce;
    this.tagCollisions = 0;
    this.previousStable = previousStable;
  }

  async readFile(path) {
    if (!this.previousStable) return null;
    if (path === 'stable.json') {
      return { bytes: encodeJsonBytes(this.previousStable), sha: 'stable-sha' };
    }
    return null;
  }

  async writeFile(path, bytes) {
    if (path !== 'publish-status.json') throw new Error(`unexpected write: ${path}`);
    this.lastStatus = JSON.parse(bytes.toString('utf8'));
    this.events.push(`status:${this.lastStatus.state === 'running' ? this.lastStatus.phase : this.lastStatus.state}`);
  }

  async commitFiles(files) {
    const paths = files.map(({ path }) => path).sort();
    if (paths.includes('deploy.mjs')) {
      this.events.push('scripts:commit');
      this.scriptFiles = files;
      return { sha: SCRIPT_COMMIT_SHA };
    }
    if (paths.includes('stable.json')) {
      this.events.push('stable:commit');
      if (this.failAt === 'stable:commit') throw new Error('stable failed');
      this.stableFiles = files;
      return { sha: 'stable-commit-sha' };
    }
    throw new Error(`unexpected commit: ${paths.join(',')}`);
  }

  async listReleases() {
    return this.releases;
  }

  async deleteRelease(id) {
    this.events.push(`release:delete:${id}`);
  }

  async createRelease(input) {
    this.events.push('release:create-draft');
    this.createdRelease = input;
    if (this.tagCollisionOnce && this.tagCollisions === 0) {
      this.tagCollisions += 1;
      const error = new Error('tag already exists');
      error.status = 422;
      throw error;
    }
    if (this.failAt === 'release:create-draft') throw new Error('draft failed');
    return { id: 17, tag_name: input.tag_name, upload_url: 'https://uploads.example/{?name,label}' };
  }

  async uploadReleaseAsset(_release, asset) {
    if (!this.events.includes('release:upload')) this.events.push('release:upload');
    if (this.failAt === 'release:upload') throw new Error('upload failed');
    assert.equal(Buffer.isBuffer(asset.bytes), true);
    this.uploadedAssets.push(asset);
  }

  async updateRelease() {
    this.events.push('release:publish');
    if (this.failAt === 'release:publish') throw new Error('publish failed');
  }
}

async function fixtureRelease() {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-publish-'));
  const platforms = [];
  for (const [key, binary] of [
    ['windows-amd64', 'wheelmaker.exe'],
    ['linux-amd64', 'wheelmaker'],
    ['darwin-arm64', 'wheelmaker'],
  ]) {
    const directory = join(root, key);
    await mkdir(join(directory, 'hub'), { recursive: true });
    await mkdir(join(directory, 'web'), { recursive: true });
    await writeFile(join(directory, 'hub', binary), `hub-${key}`);
    await writeFile(join(directory, 'web', 'index.html'), `web-${key}`);
    platforms.push({ key, directory });
  }

  return {
    channel: {
      owner: 'swm8023',
      repository: 'wheelmaker-release',
      branch: 'main',
      stablePath: 'stable.json',
      publishStatusPath: 'publish-status.json',
    },
    coreBytes: Buffer.from('core-source'),
    deployMjsBytes: Buffer.from('launcher-source'),
    outputRoot: join(root, 'assets'),
    platforms,
    publishedAt: PUBLISHED_AT,
    publisher: 'local',
    sourceSha: SOURCE_SHA,
    startedAt: PUBLISHED_AT,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('stable is committed only after the release is public', async () => {
  const release = await fixtureRelease();
  const api = new FakeGitHubApi();
  try {
    await publishBuiltRelease(release, api);
    assert.deepEqual(api.events, [
      'status:validating',
      'status:packaging',
      'scripts:commit',
      'status:uploading',
      'release:create-draft',
      'release:upload',
      'status:publishing-release',
      'release:publish',
      'status:updating-stable',
      'stable:commit',
      'status:succeeded',
    ]);
    assert.equal(api.createdRelease.target_commitish, SCRIPT_COMMIT_SHA);
  } finally {
    await release.cleanup();
  }
});

test('release without Desktop carries the previous Desktop pointer forward', () => {
  const previous = {
    version: 'v1.12',
    desktopExe: {
      version: 'v1.12',
      url: 'https://example.test/v1.12/WheelMakerDesktop.exe',
      sha256: 'b'.repeat(64),
    },
  };
  const next = makeStable({
    previous,
    release: stableReleaseInput({ version: 'v1.13' }),
  });
  assert.equal(next.desktopExe.version, 'v1.12');
});

test('first public release starts at v1.1 without a Desktop pointer', () => {
  const next = makeStable({
    previous: null,
    release: stableReleaseInput({ version: undefined }),
  });
  assert.equal(next.version, 'v1.1');
  assert.equal('desktopExe' in next, false);
});

test('failed upload never writes stable and exposes only an error code', async () => {
  const release = await fixtureRelease();
  const api = new FakeGitHubApi({ failAt: 'release:upload' });
  try {
    await assert.rejects(() => publishBuiltRelease(release, api), /upload failed/);
    assert.equal(api.events.includes('stable:commit'), false);
    assert.equal(api.events.includes('release:delete:17'), true);
    assert.equal(api.lastStatus.state, 'failed');
    assert.equal(api.lastStatus.phase, 'uploading');
    assert.equal(api.lastStatus.errorCode, 'asset_upload_failed');
    assert.equal('message' in api.lastStatus, false);
    assert.equal('stack' in api.lastStatus, false);
  } finally {
    await release.cleanup();
  }
});

test('stable failure keeps the already public release and leaves stable unchanged', async () => {
  const release = await fixtureRelease();
  const api = new FakeGitHubApi({ failAt: 'stable:commit' });
  try {
    await assert.rejects(() => publishBuiltRelease(release, api), /stable failed/);
    assert.equal(api.events.includes('release:publish'), true);
    assert.equal(api.events.includes('release:delete:17'), false);
    assert.equal(api.lastStatus.state, 'failed');
    assert.equal(api.lastStatus.phase, 'updating-stable');
    assert.equal(api.lastStatus.errorCode, 'stable_update_failed');
  } finally {
    await release.cleanup();
  }
});

test('publisher commits exact script bytes and hashes exact manifest bytes', async () => {
  const release = await fixtureRelease();
  release.deployMjsBytes = await readFile(
    new URL('../deploy/deploy.mjs', import.meta.url),
  );
  release.coreBytes = await readFile(
    new URL('../deploy/deploy-core.mjs', import.meta.url),
  );
  const api = new FakeGitHubApi();
  try {
    const stable = await publishBuiltRelease(release, api);
    const scriptFiles = Object.fromEntries(
      api.scriptFiles.map(({ path, bytes }) => [path, bytes]),
    );
    assert.deepEqual(scriptFiles['deploy.mjs'], release.deployMjsBytes);
    assert.deepEqual(scriptFiles['deploy-core.mjs'], release.coreBytes);
    assert.match(stable.deploy.mjsUrl, new RegExp(SCRIPT_COMMIT_SHA));
    assert.equal(stable.deploy.mjsSha256, sha256ForTest(release.deployMjsBytes));
    assert.equal(stable.deploy.coreSha256, sha256ForTest(release.coreBytes));

    const stableFiles = Object.fromEntries(
      api.stableFiles.map(({ path, bytes }) => [path, bytes]),
    );
    assert.deepEqual(Object.keys(stableFiles), ['stable.json']);
    assert.deepEqual(
      JSON.parse(stableFiles['stable.json'].toString('utf8')),
      stable,
    );

    assert.deepEqual(
      api.uploadedAssets.map(({ name }) => name).sort(),
      [
        'release-manifest.json',
        'wheelmaker-v1.1-darwin-arm64.tar.gz',
        'wheelmaker-v1.1-linux-amd64.tar.gz',
        'wheelmaker-v1.1-windows-amd64.tar.gz',
      ],
    );
    const manifest = api.uploadedAssets.find(
      ({ name }) => name === 'release-manifest.json',
    ).bytes;
    assert.equal(
      stable.release.manifestSha256,
      sha256ForTest(manifest),
    );
  } finally {
    await release.cleanup();
  }
});

test('tag collision refetches stable and advances to the next v1.x', async () => {
  const release = await fixtureRelease();
  const api = new FakeGitHubApi({ tagCollisionOnce: true });
  try {
    const stable = await publishBuiltRelease(release, api);
    assert.equal(api.tagCollisions, 1);
    assert.equal(stable.version, 'v1.2');
    assert.equal(api.createdRelease.tag_name, 'v1.2');
  } finally {
    await release.cleanup();
  }
});

test('publisher deletes only matching drafts older than two hours', async () => {
  const release = await fixtureRelease();
  const api = new FakeGitHubApi();
  api.releases = [
    { created_at: '2026-07-16T06:00:00.000Z', draft: true, id: 1, tag_name: 'v1.9' },
    { created_at: '2026-07-16T08:30:00.000Z', draft: true, id: 2, tag_name: 'v1.10' },
    { created_at: '2026-07-16T06:00:00.000Z', draft: true, id: 3, tag_name: 'android-v1.9' },
    { created_at: '2026-07-16T06:00:00.000Z', draft: false, id: 4, tag_name: 'v1.8' },
  ];
  try {
    await publishBuiltRelease(release, api);
    assert.deepEqual(
      api.events.filter((event) => event.startsWith('release:delete:')),
      ['release:delete:1'],
    );
  } finally {
    await release.cleanup();
  }
});

test('GitHub App JWT is RS256 and installation token stays in memory', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = createAppJwt({ appId: '1234', privateKey, nowSeconds: 1_700_000_000 });
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {
    alg: 'RS256',
    typ: 'JWT',
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    exp: 1_700_000_540,
    iat: 1_699_999_940,
    iss: '1234',
  });
  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );

  let request;
  const token = await requestInstallationToken({
    appId: '1234',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ token: 'installation-token' }), {
        headers: { 'content-type': 'application/json' },
        status: 201,
      });
    },
    installationId: '5678',
    nowSeconds: 1_700_000_000,
    privateKey,
  });
  assert.equal(token, 'installation-token');
  assert.match(request.url, /\/app\/installations\/5678\/access_tokens$/);
  assert.match(request.options.headers.Authorization, /^Bearer /);
});

test('GitHub API commits files atomically through blobs, tree, commit, and ref', async () => {
  const requests = [];
  let blobNumber = 0;
  const api = new GitHubApi({
    branch: 'main',
    fetchImpl: async (url, options = {}) => {
      const request = {
        body: options.body ? JSON.parse(options.body) : null,
        method: options.method ?? 'GET',
        url: String(url),
      };
      requests.push(request);
      if (request.url.endsWith('/git/ref/heads/main')) {
        return jsonResponse({ object: { sha: 'parent-commit' } });
      }
      if (request.url.endsWith('/git/commits/parent-commit')) {
        return jsonResponse({ tree: { sha: 'base-tree' } });
      }
      if (request.url.endsWith('/git/blobs')) {
        blobNumber += 1;
        return jsonResponse({ sha: `blob-${blobNumber}` }, 201);
      }
      if (request.url.endsWith('/git/trees')) {
        return jsonResponse({ sha: 'next-tree' }, 201);
      }
      if (request.url.endsWith('/git/commits')) {
        return jsonResponse({ sha: 'next-commit' }, 201);
      }
      if (request.url.endsWith('/git/refs/heads/main')) {
        return jsonResponse({ object: { sha: 'next-commit' } });
      }
      throw new Error(`unexpected request: ${request.method} ${request.url}`);
    },
    owner: 'swm8023',
    repository: 'wheelmaker-release',
    token: 'installation-token',
  });

  const result = await api.commitFiles(
    [
      { path: 'deploy.mjs', bytes: Buffer.from('launcher') },
      { path: 'deploy-core.mjs', bytes: Buffer.from('core') },
    ],
    'publish scripts',
  );

  assert.equal(result.sha, 'next-commit');
  assert.deepEqual(
    requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`),
    [
      'GET /repos/swm8023/wheelmaker-release/git/ref/heads/main',
      'GET /repos/swm8023/wheelmaker-release/git/commits/parent-commit',
      'POST /repos/swm8023/wheelmaker-release/git/blobs',
      'POST /repos/swm8023/wheelmaker-release/git/blobs',
      'POST /repos/swm8023/wheelmaker-release/git/trees',
      'POST /repos/swm8023/wheelmaker-release/git/commits',
      'PATCH /repos/swm8023/wheelmaker-release/git/refs/heads/main',
    ],
  );
  const treeRequest = requests.find(({ url }) => url.endsWith('/git/trees'));
  assert.equal(treeRequest.body.base_tree, 'base-tree');
  assert.deepEqual(
    treeRequest.body.tree.map(({ mode, path, type }) => ({ mode, path, type })),
    [
      { mode: '100644', path: 'deploy.mjs', type: 'blob' },
      { mode: '100644', path: 'deploy-core.mjs', type: 'blob' },
    ],
  );
});

test('GitHub API uploads a binary release asset with an encoded name', async () => {
  let captured;
  const api = new GitHubApi({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ id: 99 }, 201);
    },
    owner: 'swm8023',
    repository: 'wheelmaker-release',
    token: 'installation-token',
  });
  await api.uploadReleaseAsset(
    { upload_url: 'https://uploads.github.com/repos/o/r/releases/1/assets{?name,label}' },
    { bytes: Buffer.from('asset'), name: 'WheelMaker Desktop.exe' },
  );
  assert.equal(
    captured.url,
    'https://uploads.github.com/repos/o/r/releases/1/assets?name=WheelMaker%20Desktop.exe',
  );
  assert.equal(captured.options.headers['Content-Type'], 'application/octet-stream');
  assert.deepEqual(captured.options.body, Buffer.from('asset'));
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function sha256ForTest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableReleaseInput({ version }) {
  return {
    deploy: {
      coreSha256: 'c'.repeat(64),
      coreUrl: `https://example.test/${SCRIPT_COMMIT_SHA}/deploy-core.mjs`,
      mjsSha256: 'd'.repeat(64),
      mjsUrl: `https://example.test/${SCRIPT_COMMIT_SHA}/deploy.mjs`,
    },
    manifest: {
      sha256: 'e'.repeat(64),
      url: 'https://example.test/release-manifest.json',
    },
    publishedAt: PUBLISHED_AT,
    sourceSha: SOURCE_SHA,
    version,
  };
}
