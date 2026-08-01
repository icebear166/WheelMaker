import {
  deriveNpmPackageUpdateTargets,
  deriveRegistryHubIds,
  npmPackageUpdateSummary,
  packageStatusLabel,
  resolveWheelMakerRestartPending,
  shouldShowWheelMakerUpdateAction,
  WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS,
  wheelMakerUpdateStatusLabel,
  withAgentPackageTimeout,
} from '../web/src/settings/agentPackageUpdateView';
import type {RegistryHub} from '../web/src/registry/registryTypes';

describe('agent package update view helpers', () => {
  test('resolves restart pending after reconnect or timeout', () => {
    expect(resolveWheelMakerRestartPending({
      previousInstanceId: 'instance-a',
      currentInstanceId: 'instance-b',
      startedAtMs: 1_000,
      nowMs: 2_000,
    })).toBe('reconnected');
    expect(resolveWheelMakerRestartPending({
      previousInstanceId: '',
      currentInstanceId: 'instance-b',
      startedAtMs: 1_000,
      nowMs: 2_000,
    })).toBe('reconnected');
    expect(resolveWheelMakerRestartPending({
      previousInstanceId: 'instance-a',
      currentInstanceId: 'instance-a',
      startedAtMs: 1_000,
      nowMs: 1_000 + WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS - 1,
    })).toBe('waiting');
    expect(resolveWheelMakerRestartPending({
      previousInstanceId: 'instance-a',
      currentInstanceId: 'instance-a',
      startedAtMs: 1_000,
      nowMs: 1_000 + WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS,
    })).toBe('timed_out');
  });

  test('derives unique hub ids from project.list hubs in stable sorted order', () => {
    const hubs: RegistryHub[] = [
      {hubId: 'hub-b'},
      {hubId: 'hub-a'},
      {hubId: 'hub-b'},
      {hubId: ' '},
    ];

    expect(deriveRegistryHubIds(hubs)).toEqual(['hub-a', 'hub-b']);
  });

  test('maps package status values to concise labels', () => {
    expect(packageStatusLabel('checking_latest')).toBe('Checking latest');
    expect(packageStatusLabel('not_installed')).toBe('Not installed');
    expect(packageStatusLabel('up_to_date')).toBe('Up to date');
    expect(packageStatusLabel('update_available')).toBe('Update available');
    expect(packageStatusLabel('latest_unknown')).toBe('Latest unknown');
    expect(packageStatusLabel('checking_failed')).toBe('Checking failed');
    expect(packageStatusLabel('deprecated')).toBe('Deprecated');
    expect(packageStatusLabel('running')).toBe('Running');
  });

  test('derives hub-level npm update targets without uninstalling deprecated packages', () => {
    const targets = deriveNpmPackageUpdateTargets([
      {
        packageName: '@openai/codex',
        displayName: 'Codex',
        agentTypes: ['codex'],
        kind: 'runtime',
        installed: true,
        installedVersion: '0.1.0',
        latestVersion: '0.2.0',
        status: 'update_available',
        error: '',
        canInstall: false,
        canUpdate: true,
        canUninstall: false,
      },
      {
        packageName: '@anthropic/claude-code',
        displayName: 'Claude Code',
        agentTypes: ['claude'],
        kind: 'runtime',
        installed: false,
        installedVersion: '',
        latestVersion: '1.0.0',
        status: 'not_installed',
        error: '',
        canInstall: true,
        canUpdate: false,
        canUninstall: false,
      },
      {
        packageName: '@zed-industries/claude-agent-acp',
        displayName: 'Deprecated Claude ACP',
        agentTypes: [],
        kind: 'deprecated',
        installed: true,
        installedVersion: '0.0.1',
        latestVersion: '',
        status: 'deprecated',
        error: '',
        canInstall: false,
        canUpdate: false,
        canUninstall: true,
      },
    ]);

    expect(targets).toEqual([
      {
        packageName: '@openai/codex',
        displayName: 'Codex',
        installedVersion: '0.1.0',
        latestVersion: '0.2.0',
      },
      {
        packageName: '@anthropic/claude-code',
        displayName: 'Claude Code',
        installedVersion: '',
        latestVersion: '1.0.0',
      },
    ]);
    expect(npmPackageUpdateSummary(targets.length)).toBe('2 npm updates');
    expect(npmPackageUpdateSummary(0)).toBe('No npm updates');
  });

  test('maps WheelMaker update status values to concise labels', () => {
    expect(wheelMakerUpdateStatusLabel('update_pending')).toBe('Update pending');
    expect(wheelMakerUpdateStatusLabel('downloading')).toBe('Downloading');
    expect(wheelMakerUpdateStatusLabel('verifying')).toBe('Verifying');
    expect(wheelMakerUpdateStatusLabel('failed')).toBe('Failed');
    expect(wheelMakerUpdateStatusLabel('custom_status')).toBe('custom_status');
  });

  test('shows WheelMaker update only when allowed or a job is active', () => {
    expect(
      shouldShowWheelMakerUpdateAction({
        data: null,
        loading: true,
        pending: false,
      }),
    ).toBe(false);
    expect(
      shouldShowWheelMakerUpdateAction({
        data: {
          ok: true,
          status: 'up_to_date',
          hubId: 'hub-a',
          canRequestUpdate: false,
        },
        loading: false,
        pending: false,
      }),
    ).toBe(false);
    expect(
      shouldShowWheelMakerUpdateAction({
        data: {
          ok: true,
          status: 'update_available',
          hubId: 'hub-a',
          canRequestUpdate: true,
        },
        loading: false,
        pending: false,
      }),
    ).toBe(true);
    expect(
      shouldShowWheelMakerUpdateAction({
        data: {
          ok: true,
          status: 'update_pending',
          hubId: 'hub-a',
          canRequestUpdate: false,
          job: {
            schema: 1,
            jobId: 'job-a',
            state: 'queued',
            startedAt: '2026-07-16T09:00:00Z',
            updatedAt: '2026-07-16T09:00:00Z',
          },
        },
        loading: true,
        pending: false,
      }),
    ).toBe(true);
  });

  test('turns a stuck scan promise into a timeout error', async () => {
    jest.useFakeTimers();
    const pending = withAgentPackageTimeout(
      new Promise(() => undefined),
      25,
      'hub-a scan timed out',
    );

    jest.advanceTimersByTime(25);

    await expect(pending).rejects.toThrow('hub-a scan timed out');
    jest.useRealTimers();
  });
});
