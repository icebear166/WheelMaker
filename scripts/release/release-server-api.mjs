import {request as httpsRequest} from 'node:https';
import {createReadStream} from 'node:fs';
import {Transform} from 'node:stream';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const RELEASE_CONTROL_REQUEST_TIMEOUT_MS = 30_000;

export class ReleaseServerHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ReleaseServerHttpError';
    this.status = status;
  }
}

function errorForStatus(status) {
  if (status === 401) {
    return new ReleaseServerHttpError(
      'the publishing token was rejected; verify WHEELMAKER_RELEASE_TOKEN or the local release-server.json',
      status,
    );
  }
  if (status === 503) {
    return new ReleaseServerHttpError(
      'the release server publisher is not configured; run one local publish to initialize it',
      status,
    );
  }
  if (status === 507) {
    return new ReleaseServerHttpError(
      'the release server has insufficient storage for this publish',
      status,
    );
  }
  if (status === 409) {
    return new ReleaseServerHttpError('release version conflicts with stable', status);
  }
  return new ReleaseServerHttpError(
    `release server request failed (${status})`,
    status,
  );
}

function validateBaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    value !== url.origin
  ) {
    throw new Error('release server base URL must be a clean HTTPS origin');
  }
  return url.origin;
}

function validateSessionId(sessionId) {
  if (!/^[0-9a-f]{32}$/.test(sessionId ?? '')) {
    throw new Error('invalid release session ID');
  }
  return sessionId;
}

function responseBytes(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        reject(new Error('release server response is too large'));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.once('error', reject);
    response.once('end', () => resolve(Buffer.concat(chunks, size)));
  });
}

export class ReleaseServerApi {
  constructor({baseUrl, token, requestImpl = httpsRequest}) {
    this.baseUrl = validateBaseUrl(baseUrl);
    this.token = token;
    this.requestImpl = requestImpl;
  }

  async request(path, {
    allow404 = false,
    body,
    headers = {},
    method = 'GET',
    publish = true,
    timeoutMs,
    writeBody,
  } = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== this.baseUrl) {
      throw new Error('release server request must stay on the configured origin');
    }
    const requestHeaders = {...headers};
    if (publish) {
      if (typeof this.token !== 'string' || this.token.length === 0) {
        throw new Error('publishing token is required');
      }
      requestHeaders.Authorization = `Bearer ${this.token}`;
    }
    let encodedBody;
    if (body !== undefined) {
      encodedBody = Buffer.from(JSON.stringify(body), 'utf8');
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = encodedBody.length;
    }
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = this.requestImpl(url, {
          headers: requestHeaders,
          method,
        }, async response => {
          try {
            const bytes = await responseBytes(response);
            const status = response.statusCode ?? 0;
            if (allow404 && status === 404) {
              resolve(null);
              return;
            }
            if (status < 200 || status >= 300) {
              reject(errorForStatus(status));
              return;
            }
            if (bytes.length === 0) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(bytes.toString('utf8')));
            } catch (error) {
              reject(new Error('release server returned invalid JSON', {cause: error}));
            }
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
        return;
      }
      request.once('error', reject);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error(`release server request timed out after ${timeoutMs}ms`));
        });
      }
      if (writeBody) {
        writeBody(request).catch(reject);
      } else {
        request.end(encodedBody);
      }
    });
  }

  readStable() {
    return this.request('/stable.json', {
      allow404: true,
      publish: false,
    });
  }

  storage() {
    return this.request('/api/storage', {
      method: 'GET',
      timeoutMs: RELEASE_CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  prune() {
    return this.request('/api/prune', {
      method: 'POST',
      timeoutMs: RELEASE_CONTROL_REQUEST_TIMEOUT_MS,
    });
  }

  start(input) {
    return this.request('/api/publish/start', {
      body: {
        publisher: input.publisher,
        sourceSha: input.sourceSha,
        version: input.version,
        withAndroid: input.withAndroid ?? false,
        withDesktop: input.withDesktop ?? false,
        withGateway: input.withGateway ?? false,
      },
      method: 'POST',
    });
  }

  startDebugWeb({size, sha256}) {
    if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-f]{64}$/.test(sha256 ?? '')) {
      throw new Error('invalid debug web archive identity');
    }
    return this.request('/api/debug-web/start', {
      body: {size, sha256},
      method: 'POST',
    });
  }

  status(sessionId, status) {
    return this.request(`/api/publish/${validateSessionId(sessionId)}/status`, {
      body: status,
      method: 'PUT',
    });
  }

  upload(sessionId, asset, onProgress = () => {}) {
    validateSessionId(sessionId);
    if (!/^[A-Za-z0-9._-]+$/.test(asset.name ?? '')) {
      throw new Error('invalid release asset name');
    }
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
      throw new Error('invalid release asset size');
    }
    if (!/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) {
      throw new Error('invalid release asset SHA-256');
    }
    return this.request(
      `/api/publish/${sessionId}/files/${encodeURIComponent(asset.name)}`,
      {
        headers: {
          'Content-Length': asset.size,
          'Content-Type': 'application/octet-stream',
          'X-WheelMaker-SHA256': asset.sha256,
        },
        method: 'PUT',
        async writeBody(request) {
          let uploadedBytes = 0;
          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              uploadedBytes += chunk.length;
              onProgress({
                done: false,
                uploadedBytes,
                totalBytes: asset.size,
              });
              callback(null, chunk);
            },
          });
          const input = createReadStream(asset.path);
          input.once('error', error => request.destroy(error));
          counter.once('error', error => request.destroy(error));
          request.once('finish', () => {
            onProgress({
              done: true,
              uploadedBytes,
              totalBytes: asset.size,
            });
          });
          input.pipe(counter).pipe(request);
        },
      },
    );
  }

  uploadDebugWeb(sessionId, asset, onProgress = () => {}) {
    validateSessionId(sessionId);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) {
      throw new Error('invalid debug web archive identity');
    }
    return this.request(`/api/debug-web/${sessionId}/archive`, {
      headers: {
        'Content-Length': asset.size,
        'Content-Type': 'application/zip',
        'X-WheelMaker-SHA256': asset.sha256,
      },
      method: 'PUT',
      async writeBody(request) {
        let uploadedBytes = 0;
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            uploadedBytes += chunk.length;
            onProgress({done: false, uploadedBytes, totalBytes: asset.size});
            callback(null, chunk);
          },
        });
        const input = createReadStream(asset.path);
        input.once('error', error => request.destroy(error));
        counter.once('error', error => request.destroy(error));
        request.once('finish', () => onProgress({done: true, uploadedBytes, totalBytes: asset.size}));
        input.pipe(counter).pipe(request);
      },
    });
  }

  commit(sessionId) {
    return this.request(`/api/publish/${validateSessionId(sessionId)}/commit`, {
      method: 'POST',
    });
  }

  commitDebugWeb(sessionId) {
    return this.request(`/api/debug-web/${validateSessionId(sessionId)}/commit`, {
      method: 'POST',
    });
  }

  cancel(sessionId) {
    return this.request(`/api/publish/${validateSessionId(sessionId)}`, {
      method: 'DELETE',
    });
  }
}
