import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { runCommand } from './commands.mjs';
import { encodeJsonBytes } from './metadata.mjs';
import { createTarZst } from './tar.mjs';

export const GATEWAY_TARGETS = Object.freeze([
  {
    key: 'windows-amd64',
    GOOS: 'windows',
    GOARCH: 'amd64',
    binary: 'wheelmaker-gateway.exe',
  },
  {
    key: 'linux-amd64',
    GOOS: 'linux',
    GOARCH: 'amd64',
    binary: 'wheelmaker-gateway',
  },
  {
    key: 'darwin-amd64',
    GOOS: 'darwin',
    GOARCH: 'amd64',
    binary: 'wheelmaker-gateway',
  },
  {
    key: 'darwin-arm64',
    GOOS: 'darwin',
    GOARCH: 'arm64',
    binary: 'wheelmaker-gateway',
  },
]);

const VERSION_PATTERN = /^v1\.(0|[1-9]\d*)$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;

async function runWithConcurrency(jobs, limit) {
  let nextIndex = 0;
  let failure;
  async function worker() {
    while (!failure) {
      const index = nextIndex++;
      if (index >= jobs.length) return;
      try {
        await jobs[index]();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  if (failure) throw failure;
}

export async function buildGatewayRelease({
  progress,
  repoRoot,
  sourceSha,
  stagingRoot,
  version,
  workRoot = join(repoRoot, '.release-work'),
  runner = runCommand,
}) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`invalid Gateway release version: ${version}`);
  }
  if (sourceSha !== undefined && !SOURCE_SHA_PATTERN.test(sourceSha)) {
    throw new Error('invalid Gateway source SHA');
  }
  const serverRoot = join(repoRoot, 'server');
  const cacheRoot = join(workRoot, 'cache');
  const buildEnvironment = {
    GOCACHE: join(cacheRoot, 'go-build'),
    GOMODCACHE: join(cacheRoot, 'go-mod'),
  };
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(buildEnvironment.GOCACHE, { recursive: true });
  await mkdir(buildEnvironment.GOMODCACHE, { recursive: true });

  const task = progress?.task
    ? (label, action) => progress.task(label, action)
    : (_label, action) => action();
  const platforms = Array(GATEWAY_TARGETS.length);
  const jobs = GATEWAY_TARGETS.map((target, index) => () => task(
    `Building Gateway ${target.key}`,
    async () => {
      const directory = join(
        stagingRoot,
        `wheelmaker-gateway-${version}-${target.key}`,
      );
      const binaryPath = join(directory, target.binary);
      await mkdir(directory, { recursive: true });
      await runner('go', [
        'build',
        '-trimpath',
        `-ldflags=-s -w -X main.version=${version}`,
        '-o',
        binaryPath,
        './cmd/wheelmaker-gateway',
      ], {
        cwd: serverRoot,
        env: {
          CGO_ENABLED: '0',
          ...buildEnvironment,
          GOARCH: target.GOARCH,
          GOOS: target.GOOS,
        },
      });
      platforms[index] = { ...target, binaryPath, directory };
    },
  ));
  await runWithConcurrency(jobs, 3);
  return { platforms, version, versionRoot: stagingRoot };
}

async function inspectFile(path) {
  const info = await stat(path);
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = createReadStream(path);
    input.on('data', chunk => hash.update(chunk));
    input.once('error', reject);
    input.once('end', resolve);
  });
  return { size: info.size, sha256: hash.digest('hex') };
}

export async function packageGatewayArtifacts({
  outputRoot,
  packageRoot,
  platforms,
  publishedAt,
  sourceSha,
  stagingRoot,
  version,
}) {
  if (!VERSION_PATTERN.test(version) || !SOURCE_SHA_PATTERN.test(sourceSha ?? '')) {
    throw new Error('invalid Gateway package identity');
  }
  if (!Array.isArray(platforms) || platforms.length !== GATEWAY_TARGETS.length) {
    throw new Error('Gateway package must contain all supported platforms');
  }
  const finalRoot = packageRoot ?? join(outputRoot, version);
  const temporaryRoot = packageRoot ?? join(stagingRoot ?? outputRoot, 'gateway-assets');
  if (!packageRoot) {
    await rm(finalRoot, { recursive: true, force: true });
    await mkdir(finalRoot, { recursive: true });
  } else {
    await mkdir(finalRoot, { recursive: true });
  }

  const assets = [];
  const artifacts = {};
  for (const platform of platforms) {
    const target = GATEWAY_TARGETS.find(item => item.key === platform.key);
    if (!target || platform.binaryPath && platform.binaryPath.endsWith(target.binary) === false) {
      throw new Error(`invalid Gateway platform: ${platform.key}`);
    }
    const archiveName = `wheelmaker-gateway-${version}-${target.key}.tar.zst`;
    const archivePath = join(finalRoot, archiveName);
    await createTarZst({ sourceDir: platform.directory, outputPath: archivePath });
    const identity = await inspectFile(archivePath);
    artifacts[target.key] = {
      path: `/gateway/current/${archiveName}`,
      ...identity,
    };
    assets.push({ name: archiveName, path: archivePath, ...identity });
  }

  const manifest = {
    schema: 1,
    version,
    publishedAt,
    sourceSha,
    path: '/gateway/current/gateway-manifest.json',
    artifacts,
  };
  const manifestBytes = encodeJsonBytes(manifest);
  const manifestPath = join(finalRoot, 'gateway-manifest.json');
  await writeFile(manifestPath, manifestBytes);
  const manifestIdentity = await inspectFile(manifestPath);
  assets.push({ name: 'gateway-manifest.json', path: manifestPath, ...manifestIdentity });
  return {
    assets,
    manifest,
    manifestBytes,
    manifestPath,
    version,
    versionRoot: finalRoot,
    temporaryRoot,
  };
}

export async function readGatewayManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
