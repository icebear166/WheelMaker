import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateReleaseChannel} from './channel.mjs';
import {
  createPublisherConfigDependencies,
  readConfiguredPublisherToken,
} from './publisher-config.mjs';
import {ReleaseServerApi} from './release-server-api.mjs';

export async function runReleasePrune({api, write = line => process.stdout.write(line)}) {
  const report = await api.prune();
  write(`${JSON.stringify(report)}\n`);
  return report;
}

async function createPruneApi() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const channel = validateReleaseChannel(JSON.parse(
    await readFile(join(moduleDirectory, 'channel.json'), 'utf8'),
  ));
  const token = await readConfiguredPublisherToken(
    createPublisherConfigDependencies({baseUrl: channel.baseUrl}),
  );
  return new ReleaseServerApi({baseUrl: channel.baseUrl, token});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleasePrune({api: await createPruneApi()}).catch(error => {
    process.stderr.write(`[release-prune] ${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
