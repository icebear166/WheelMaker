import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function acquireBuildLock({owner, workRoot}) {
  await mkdir(workRoot, {recursive: true});
  const directory = join(workRoot, 'build.lock');
  try {
    await mkdir(directory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const current = JSON.parse(
      await readFile(join(directory, 'owner.json'), 'utf8').catch(() => '{}'),
    );
    throw new Error(
      `build is already running (owner: ${current.owner || 'unknown'})`,
    );
  }

  await writeFile(
    join(directory, 'owner.json'),
    JSON.stringify({owner, pid: process.pid}) + '\n',
  );

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await rm(directory, {force: true, recursive: true});
    },
  };
}
