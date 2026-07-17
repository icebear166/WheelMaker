import { sign } from 'node:crypto';

const GITHUB_API_VERSION = '2022-11-28';

function encodeJwtPart(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value), 'utf8');
  return bytes.toString('base64url');
}

function normalizePrivateKey(privateKey) {
  if (typeof privateKey !== 'string') {
    return privateKey;
  }
  return privateKey.includes('\\n')
    ? privateKey.replaceAll('\\n', '\n')
    : privateKey;
}

export function createAppJwt({
  appId,
  privateKey,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (!appId || !privateKey) {
    throw new Error('GitHub App ID and private key are required');
  }
  const header = encodeJwtPart({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJwtPart({
    exp: nowSeconds + 9 * 60,
    iat: nowSeconds - 60,
    iss: String(appId),
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'utf8'),
    normalizePrivateKey(privateKey),
  );
  return `${signingInput}.${encodeJwtPart(signature)}`;
}

export async function requestInstallationToken({
  appId,
  installationId,
  privateKey,
  fetchImpl = fetch,
  nowSeconds,
}) {
  if (!installationId) {
    throw new Error('GitHub App installation ID is required');
  }
  const jwt = createAppJwt({ appId, privateKey, nowSeconds });
  const response = await fetchImpl(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'wheelmaker-release',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.token !== 'string' || !body.token) {
    throw new Error(`GitHub App installation token request failed (${response.status})`);
  }
  return body.token;
}

export function githubAppCredentialsFromEnv(env = process.env) {
  const credentials = {
    appId: env.WHEELMAKER_RELEASE_APP_ID,
    installationId: env.WHEELMAKER_RELEASE_INSTALLATION_ID,
    privateKey: env.WHEELMAKER_RELEASE_APP_PRIVATE_KEY,
  };
  for (const [name, value] of Object.entries(credentials)) {
    if (!value) {
      throw new Error(`missing GitHub App credential: ${name}`);
    }
  }
  return credentials;
}
