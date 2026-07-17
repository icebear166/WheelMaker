#!/usr/bin/env node

import {
  createDefaultReleaseDependencies,
  parseReleaseArgs,
  releaseBuildSummary,
  runRelease,
} from './release/cli.mjs';

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < 22) {
  throw new Error(`Node.js 22+ is required; found ${process.versions.node}`);
}

const options = parseReleaseArgs(process.argv.slice(2));
const dependencies = await createDefaultReleaseDependencies();
const result = await runRelease(options, dependencies);

if (result.mode === 'build') {
  process.stdout.write(
    `${JSON.stringify(
      {
        ...releaseBuildSummary(result.build),
        mode: result.mode,
        sourceSha: result.sourceSha,
      },
      null,
      2,
    )}\n`,
  );
} else {
  process.stdout.write(
    `${JSON.stringify(
      { mode: result.mode, version: result.stable.version },
      null,
      2,
    )}\n`,
  );
}
