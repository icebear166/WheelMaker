import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_NAME = 'WHEELMAKER_SIGNING_PRIVATE_KEY';
const DEFAULT_PUBLIC_KEY_PATH = fileURLToPath(
  new URL('./release-public-key.pem', import.meta.url),
);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function generateSigningKey({
  privateKeyPath = join(
    homedir(),
    '.wheelmaker',
    'release-secrets',
    'signing-private.pem',
  ),
  publicKeyPath = DEFAULT_PUBLIC_KEY_PATH,
  force = false,
} = {}) {
  if (
    !force &&
    ((await pathExists(privateKeyPath)) || (await pathExists(publicKeyPath)))
  ) {
    throw new Error(
      'refusing to overwrite an existing signing key; pass --force to replace both files',
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicPem = publicKey.export({ format: 'pem', type: 'spki' });

  await mkdir(dirname(privateKeyPath), { recursive: true });
  await mkdir(dirname(publicKeyPath), { recursive: true });
  await writeFile(privateKeyPath, privatePem, {
    flag: force ? 'w' : 'wx',
    mode: 0o600,
  });
  await writeFile(publicKeyPath, publicPem, {
    flag: force ? 'w' : 'wx',
    mode: 0o644,
  });

  return {
    secretName: SECRET_NAME,
    privateKeyPath,
    publicKeyPath,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--force');
  if (unknown.length > 0) {
    throw new Error(`unknown argument: ${unknown[0]}`);
  }

  const result = await generateSigningKey({ force: args.includes('--force') });
  process.stdout.write(
    [
      `Created private signing key: ${result.privateKeyPath}`,
      `Created public signing key: ${result.publicKeyPath}`,
      `Store the private PEM as GitHub secret ${result.secretName}.`,
    ].join('\n') + '\n',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
