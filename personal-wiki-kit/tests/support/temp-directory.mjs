import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTemporaryDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return {
    path: directory,
    entries: async () => readdir(directory),
    cleanup: async () => rm(directory, {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  };
}
