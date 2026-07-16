import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAME = "WHEELMAKER_SIGNING_PRIVATE_KEY";
const DEFAULT_PUBLIC_KEY_PATH = fileURLToPath(
  new URL("./release-public-key.pem", import.meta.url)
);
const DEFAULT_HUB_PUBLIC_KEY_PATH = fileURLToPath(
  new URL(
    "../../server/internal/hub/tools/release_public_key.pem",
    import.meta.url
  )
);
const DEFAULT_PUBLIC_KEY_PATHS = [
  DEFAULT_PUBLIC_KEY_PATH,
  DEFAULT_HUB_PUBLIC_KEY_PATH,
];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function generateSigningKey(options = {}) {
  const privateKeyPath =
    options.privateKeyPath ??
    join(homedir(), ".wheelmaker", "release-secrets", "signing-private.pem");
  const publicKeyPaths = options.publicKeyPaths
    ? [...options.publicKeyPaths]
    : options.publicKeyPath
    ? [options.publicKeyPath]
    : [...DEFAULT_PUBLIC_KEY_PATHS];
  const force = options.force ?? false;
  if (publicKeyPaths.length === 0) {
    throw new Error("at least one public key path is required");
  }
  if (!force && (await anyPathExists([privateKeyPath, ...publicKeyPaths]))) {
    throw new Error(
      "refusing to overwrite an existing signing key; pass --force to replace all files"
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });

  await mkdir(dirname(privateKeyPath), { recursive: true });
  await Promise.all(
    publicKeyPaths.map((publicKeyPath) =>
      mkdir(dirname(publicKeyPath), { recursive: true })
    )
  );
  await writeFile(privateKeyPath, privatePem, {
    flag: force ? "w" : "wx",
    mode: 0o600,
  });
  await Promise.all(
    publicKeyPaths.map((publicKeyPath) =>
      writeFile(publicKeyPath, publicPem, {
        flag: force ? "w" : "wx",
        mode: 0o644,
      })
    )
  );

  return {
    secretName: SECRET_NAME,
    privateKeyPath,
    publicKeyPath: publicKeyPaths[0],
    publicKeyPaths,
  };
}

async function anyPathExists(paths) {
  const results = await Promise.all(paths.map((path) => pathExists(path)));
  return results.some(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--force");
  if (unknown.length > 0) {
    throw new Error(`unknown argument: ${unknown[0]}`);
  }

  const result = await generateSigningKey({ force: args.includes("--force") });
  process.stdout.write(
    [
      `Created private signing key: ${result.privateKeyPath}`,
      ...result.publicKeyPaths.map(
        (publicKeyPath) => `Created public signing key: ${publicKeyPath}`
      ),
      `Store the private PEM as GitHub secret ${result.secretName}.`,
    ].join("\n") + "\n"
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
