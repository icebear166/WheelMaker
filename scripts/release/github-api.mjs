const API_VERSION = '2022-11-28';

export class GitHubHttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubHttpError';
    this.status = status;
    this.body = body;
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export class GitHubApi {
  constructor({
    owner,
    repository,
    token,
    branch = 'main',
    fetchImpl = fetch,
  }) {
    if (!owner || !repository || !token) {
      throw new Error('GitHub owner, repository, and installation token are required');
    }
    this.owner = owner;
    this.repository = repository;
    this.token = token;
    this.branch = branch;
    this.fetchImpl = fetchImpl;
    this.repositoryApiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  }

  async request(pathOrUrl, {
    allow404 = false,
    body,
    headers = {},
    method = 'GET',
    rawBody,
  } = {}) {
    const url = /^https:\/\//.test(pathOrUrl)
      ? pathOrUrl
      : `${this.repositoryApiUrl}${pathOrUrl}`;
    const requestHeaders = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'wheelmaker-release',
      'X-GitHub-Api-Version': API_VERSION,
      ...headers,
    };
    let requestBody;
    if (rawBody !== undefined) {
      requestBody = rawBody;
    } else if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, {
      body: requestBody,
      headers: requestHeaders,
      method,
    });
    if (allow404 && response.status === 404) {
      return null;
    }
    const responseText = await response.text();
    let responseBody = null;
    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
    }
    if (!response.ok) {
      throw new GitHubHttpError(
        `GitHub API request failed (${response.status})`,
        response.status,
        responseBody,
      );
    }
    return responseBody;
  }

  async readFile(path, branch = this.branch) {
    const content = await this.request(
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      { allow404: true },
    );
    if (!content) {
      return null;
    }
    if (content.type !== 'file' || content.encoding !== 'base64') {
      throw new Error(`GitHub content is not a Base64 file: ${path}`);
    }
    return {
      bytes: Buffer.from(content.content.replaceAll('\n', ''), 'base64'),
      sha: content.sha,
    };
  }

  async putContent(path, bytes, { branch = this.branch, message, sha } = {}) {
    return this.request(`/contents/${encodePath(path)}`, {
      body: {
        branch,
        content: Buffer.from(bytes).toString('base64'),
        message,
        ...(sha ? { sha } : {}),
      },
      method: 'PUT',
    });
  }

  async writeFile(path, bytes, message, branch = this.branch) {
    const current = await this.readFile(path, branch);
    return this.putContent(path, bytes, {
      branch,
      message,
      sha: current?.sha,
    });
  }

  async getRef(ref = `heads/${this.branch}`) {
    return this.request(`/git/ref/${encodePath(ref)}`);
  }

  async getCommit(sha) {
    return this.request(`/git/commits/${encodeURIComponent(sha)}`);
  }

  async createBlob(bytes) {
    return this.request('/git/blobs', {
      body: {
        content: Buffer.from(bytes).toString('base64'),
        encoding: 'base64',
      },
      method: 'POST',
    });
  }

  async createTree({ baseTree, entries }) {
    return this.request('/git/trees', {
      body: { base_tree: baseTree, tree: entries },
      method: 'POST',
    });
  }

  async createCommit({ message, parents, tree }) {
    return this.request('/git/commits', {
      body: { message, parents, tree },
      method: 'POST',
    });
  }

  async updateRef(ref, sha, force = false) {
    return this.request(`/git/refs/${encodePath(ref)}`, {
      body: { force, sha },
      method: 'PATCH',
    });
  }

  async commitFiles(files, message, branch = this.branch) {
    const refName = `heads/${branch}`;
    const ref = await this.getRef(refName);
    const parentSha = ref.object.sha;
    const parentCommit = await this.getCommit(parentSha);
    const treeEntries = [];
    for (const file of files) {
      const blob = await this.createBlob(file.bytes);
      treeEntries.push({
        mode: '100644',
        path: file.path,
        sha: blob.sha,
        type: 'blob',
      });
    }
    const tree = await this.createTree({
      baseTree: parentCommit.tree.sha,
      entries: treeEntries,
    });
    const commit = await this.createCommit({
      message,
      parents: [parentSha],
      tree: tree.sha,
    });
    await this.updateRef(refName, commit.sha, false);
    return commit;
  }

  async listReleases() {
    return this.request('/releases?per_page=100');
  }

  async createRelease(input) {
    return this.request('/releases', { body: input, method: 'POST' });
  }

  async updateRelease(id, input) {
    return this.request(`/releases/${encodeURIComponent(id)}`, {
      body: input,
      method: 'PATCH',
    });
  }

  async deleteRelease(id) {
    return this.request(`/releases/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async uploadReleaseAsset(release, { bytes, name }) {
    const uploadUrl = release.upload_url.replace(/\{.*$/, '');
    const url = `${uploadUrl}?name=${encodeURIComponent(name)}`;
    return this.request(url, {
      headers: { 'Content-Type': 'application/octet-stream' },
      method: 'POST',
      rawBody: Buffer.from(bytes),
    });
  }
}
