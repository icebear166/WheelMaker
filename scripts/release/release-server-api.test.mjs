import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {
  ReleaseServerApi,
  ReleaseServerHttpError,
} from './release-server-api.mjs';

function recordingHttpsRequest(requests, replies = []) {
  return (url, options, callback) => {
    const request = new PassThrough();
    request.setTimeoutCalls = [];
    request.setTimeout = (...args) => request.setTimeoutCalls.push(args);
    const record = {
      body: Buffer.alloc(0),
      options,
      setTimeoutCalls: request.setTimeoutCalls,
      url: String(url),
    };
    request.on('data', chunk => {
      record.body = Buffer.concat([record.body, chunk]);
    });
    requests.push(record);
    request.once('finish', () => {
      const reply = replies.shift() ?? {body: '', statusCode: 204};
      const response = new PassThrough();
      response.statusCode = reply.statusCode;
      response.headers = {'content-type': 'application/json'};
      callback(response);
      response.end(reply.body ?? '');
    });
    return request;
  };
}

test('release server client streams an asset with declared identity and no deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-api-'));
  const path = join(root, 'deploy.mjs');
  const bytes = Buffer.from('streamed-deploy-mjs');
  await writeFile(path, bytes);
  const requests = [];
  const progress = [];
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.wheelmaker.top',
    token: 'release-token',
    requestImpl: recordingHttpsRequest(requests),
  });
  try {
    await api.upload('a'.repeat(32), {
      name: 'deploy.mjs',
      path,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }, update => progress.push(update));
    assert.equal(requests[0].options.headers.Authorization, 'Bearer release-token');
    assert.equal(
      requests[0].options.headers['X-WheelMaker-SHA256'],
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.equal(requests[0].options.headers['Content-Length'], bytes.length);
    assert.equal(requests[0].options.timeout, undefined);
    assert.equal(requests[0].setTimeoutCalls.length, 0);
    assert.deepEqual(requests[0].body, bytes);
    assert.deepEqual(progress.at(-1), {
      done: true,
      uploadedBytes: bytes.length,
      totalBytes: bytes.length,
    });
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('client keeps stable anonymous and authenticates every publishing request', async () => {
  const requests = [];
  const stable = {schema: 2, version: 'v1.8'};
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.wheelmaker.top',
    token: 'same-token',
    requestImpl: recordingHttpsRequest(requests, [
      {statusCode: 200, body: JSON.stringify(stable)},
      {statusCode: 201, body: JSON.stringify({schema: 1, sessionId: 'b'.repeat(32), version: 'v1.9', publishedAt: '2026-07-17T09:00:00Z'})},
      {statusCode: 204},
      {statusCode: 200, body: JSON.stringify(stable)},
      {statusCode: 204},
    ]),
  });

  assert.deepEqual(await api.readStable(), stable);
  const session = await api.start({
    publisher: 'local',
    sourceSha: '1'.repeat(40),
    version: 'v1.9',
    withAndroid: false,
    withDesktop: false,
  });
  await api.status(session.sessionId, {phase: 'building', state: 'running'});
  await api.commit(session.sessionId);
  await api.cancel(session.sessionId);

  assert.equal('Authorization' in requests[0].options.headers, false);
  assert.deepEqual(
    requests.slice(1).map(request => request.options.headers.Authorization),
    Array(4).fill('Bearer same-token'),
  );
  assert.deepEqual(
    requests.map(request => `${request.options.method} ${new URL(request.url).pathname}`),
    [
      'GET /stable.json',
      'POST /api/publish/start',
      `PUT /api/publish/${'b'.repeat(32)}/status`,
      `POST /api/publish/${'b'.repeat(32)}/commit`,
      `DELETE /api/publish/${'b'.repeat(32)}`,
    ],
  );
});

test('stable 404 is empty, while conflict and authentication failures are actionable', async () => {
  const requests = [];
  const api = new ReleaseServerApi({
    baseUrl: 'https://release.wheelmaker.top',
    token: 'token',
    requestImpl: recordingHttpsRequest(requests, [
      {statusCode: 404, body: '{"error":"not_found"}'},
      {statusCode: 409, body: '{"error":"version_conflict"}'},
      {statusCode: 401, body: '{"error":"unauthorized"}'},
      {statusCode: 507, body: '{"error":"insufficient_storage"}'},
    ]),
  });
  assert.equal(await api.readStable(), null);
  await assert.rejects(
    api.commit('c'.repeat(32)),
    error => error instanceof ReleaseServerHttpError && error.status === 409,
  );
  await assert.rejects(
    api.start({publisher: 'local', sourceSha: '1'.repeat(40), version: 'v1.1'}),
    /publishing token was rejected/i,
  );
  await assert.rejects(
    api.start({publisher: 'local', sourceSha: '1'.repeat(40), version: 'v1.1'}),
    /insufficient storage/i,
  );
});
