import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {acquireBuildLock as defaultAcquireBuildLock} from './build-lock.mjs';
import {buildRelease as defaultBuildRelease} from './build.mjs';
import {createReleaseProgress} from './progress.mjs';

const defaultRepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export function parseDiagnosticArgs(args) {
  let version;
  let withDesktop = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--version') {
      if (version !== undefined || index + 1 >= args.length) {
        throw new Error('diagnostic requires exactly one --version v1.x');
      }
      version = args[index + 1];
      index += 1;
      if (!/^v1\.(0|[1-9]\d*)$/.test(version)) {
        throw new Error(`invalid diagnostic version: ${version}`);
      }
    } else if (option === '--with-desktop') {
      if (withDesktop) {
        throw new Error('duplicate diagnostic option: --with-desktop');
      }
      withDesktop = true;
    } else {
      throw new Error(`unknown diagnostic option: ${option}`);
    }
  }

  if (version === undefined) {
    throw new Error('diagnostic requires exactly one --version v1.x');
  }
  return {version, withDesktop};
}

export async function runDiagnostic(args, {
  acquireBuildLock = defaultAcquireBuildLock,
  buildRelease = defaultBuildRelease,
  progress = createReleaseProgress(),
  repoRoot = defaultRepoRoot,
} = {}) {
  const options = parseDiagnosticArgs(args);
  const workRoot = join(repoRoot, '.release-work', 'diagnostic-cache');
  const stagingRoot = join(
    repoRoot,
    '.release-work',
    'diagnostic',
    options.version,
  );
  const lock = await acquireBuildLock({owner: 'diagnostic', workRoot});
  try {
    progress.info?.(
      `Building diagnostic ${options.version} (non-tiny, not published)`,
    );
    const build = await buildRelease({
      goProfile: 'diagnostic',
      progress,
      repoRoot,
      stagingRoot,
      version: options.version,
      withAndroid: false,
      withDesktop: options.withDesktop,
      workRoot,
    });
    return {...build, mode: 'diagnostic'};
  } finally {
    await lock.release();
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runDiagnostic(process.argv.slice(2))
    .then(result => {
      process.stdout.write(`${JSON.stringify({
        mode: result.mode,
        version: result.version,
        versionRoot: result.versionRoot,
      }, null, 2)}\n`);
    })
    .catch(error => {
      process.stderr.write(`[diagnostic] Failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
