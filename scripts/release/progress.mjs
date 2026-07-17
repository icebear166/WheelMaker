function duration(milliseconds) {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(1)} ${units[unit]}`;
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
    upload(label) {
      let lastPercentage = -5;
      let lastLine;
      return ({done, totalBytes, uploadedBytes}) => {
        const percentage = totalBytes === 0
          ? (done ? 100 : 0)
          : Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100));
        if (!done && uploadedBytes !== 0 && percentage < lastPercentage + 5) {
          return;
        }
        lastPercentage = percentage;
        const line = `[release] Uploading ${label}: ${bytes(uploadedBytes)} / ${bytes(totalBytes)} (${percentage}%)`;
        if (line !== lastLine) {
          write(line);
          lastLine = line;
        }
      };
    },
  };
}
