function duration(milliseconds) {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function workflowCommandValue(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

export function createReleaseProgress({
  githubActions = false,
  now = () => performance.now(),
  write = line => process.stdout.write(`${line}\n`),
} = {}) {
  async function timed(label, action, {group}) {
    const startedAt = now();
    if (group && githubActions) write(`::group::${label}`);
    write(`[release] ${label}${group ? '...' : ' started'}`);
    try {
      const result = await action();
      write(
        `[release] ${label} completed (${duration(now() - startedAt)})`,
      );
      if (group && githubActions) write('::endgroup::');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      write(
        `[release] ${label} failed (${duration(now() - startedAt)}): ${message}`,
      );
      if (group && githubActions) {
        write('::endgroup::');
        write(
          `::error title=Release failed::${workflowCommandValue(`${label}: ${message}`)}`,
        );
      }
      throw error;
    }
  }

  return {
    info(message) {
      write(`[release] ${message}`);
    },
    phase(label, action) {
      return timed(label, action, {group: true});
    },
    task(label, action) {
      return timed(label, action, {group: false});
    },
  };
}
