import {
  buildTokenStatCards,
  scanTokenStatsAcrossHubs,
  tokenStatsFailureSummary,
  type TokenProviderSectionView,
  type TokenStatsHubScanEntry,
} from '../web/src/settings/tokenStatsView';
import type { RegistryTokenScanResult } from '../web/src/registry/registryTypes';
import fs from 'fs';
import path from 'path';

const mainTsx = fs.readFileSync(path.join(__dirname, '../web/src/app/WorkspaceApp.tsx'), 'utf8');

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
};

const waitForMicrotasks = () => new Promise(resolve => globalThis.setTimeout(resolve, 0));

const codexTokenScanResult = (updatedAt: string): RegistryTokenScanResult => ({
  ok: true,
  updatedAt,
  providers: [
    {
      id: 'codex',
      name: 'Codex',
      accounts: [
        {
          id: 'current',
          alias: 'current',
          displayName: 'current',
          status: 'ok',
          source: '~/.codex/auth.json',
          fiveHourLimit: '12%',
          weeklyLimit: '34%',
          balance: {isAvailable: false, items: []},
          usage: {rangeType: 'month', month: '2026-06', rows: []},
          usageUnavailable: false,
        },
      ],
    },
  ],
});

describe('web token stats view', () => {
  test('refreshes token stats from hub snapshot instead of online projects', () => {
    const refreshTokenStatsStart = mainTsx.indexOf('const refreshTokenStats = useCallback(async () => {');
    const refreshTokenStatsEnd = mainTsx.indexOf('const agentPackageActionKey', refreshTokenStatsStart);
    const refreshTokenStatsBlock = mainTsx.slice(refreshTokenStatsStart, refreshTokenStatsEnd);

    expect(refreshTokenStatsBlock).toContain('const snapshot = await service.listProjectSnapshot();');
    expect(refreshTokenStatsBlock).toContain('const hubIds = deriveRegistryHubIds(snapshot.hubs);');
    expect(refreshTokenStatsBlock).toContain('service.scanTokenStats(hubId)');
    expect(refreshTokenStatsBlock).not.toContain('onlineByHub');
    expect(refreshTokenStatsBlock).not.toContain('scanTokenStats(project.projectId)');
  });

  test('emits successful hub token stats before failed hub settles', async () => {
    const localHub = createDeferred<RegistryTokenScanResult>();
    const staleHub = createDeferred<RegistryTokenScanResult>();
    const partials: TokenStatsHubScanEntry[][] = [];
    const errors: string[] = [];

    const scan = scanTokenStatsAcrossHubs(
      ['local-hub', 'stale-hub'],
      hubId => (hubId === 'local-hub' ? localHub.promise : staleHub.promise),
      {
        timeoutMs: 0,
        onSuccess: entries => {
          partials.push(entries);
        },
        onFailure: failures => {
          const summary = tokenStatsFailureSummary(failures);
          if (summary) errors.push(summary);
        },
      },
    );

    localHub.resolve(codexTokenScanResult('2026-06-15T10:00:00Z'));
    await waitForMicrotasks();

    expect(partials).toHaveLength(1);
    expect(partials[0]).toMatchObject([
      {
        hubId: 'local-hub',
        result: {
          updatedAt: '2026-06-15T10:00:00Z',
          providers: [{id: 'codex'}],
        },
      },
    ]);
    expect(errors).toHaveLength(0);

    staleHub.reject(new Error('hub offline'));
    const result = await scan;

    expect(result.responses).toHaveLength(1);
    expect(result.failures).toEqual([{hubId: 'stale-hub', message: 'hub offline'}]);
    expect(tokenStatsFailureSummary(result.failures)).toBe('Some hubs failed: stale-hub: hub offline');
  });

  test('aggregates the same provider account across hubs and keeps hub tags', () => {
    const providers: TokenProviderSectionView[] = [
      {
        id: 'codex',
        name: 'Codex',
        accounts: [
          {
            id: 'current',
            alias: 'Current Account',
            displayName: 'Current Account',
            email: 'dev@example.com',
            source: 'local',
            status: 'ok',
            hubId: 'local',
            projectId: 'local:repo',
            providerId: 'codex',
            providerName: 'Codex',
            fiveHourLimit: '4%',
            weeklyLimit: '12%',
            balance: {items: []},
            usage: {rows: []},
            usageUnavailable: false,
          },
          {
            id: 'current',
            alias: 'Current Account',
            displayName: 'Current Account',
            email: 'dev@example.com',
            source: 'ks',
            status: 'ok',
            hubId: 'ks-hub',
            projectId: 'ks-hub:repo',
            providerId: 'codex',
            providerName: 'Codex',
            fiveHourLimit: '4%',
            weeklyLimit: '12%',
            balance: {items: []},
            usage: {rows: []},
            usageUnavailable: false,
          },
        ],
      },
    ];

    const cards = buildTokenStatCards(providers);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      accountName: 'dev@example.com',
      agentTag: 'Codex',
      hubTags: ['local', 'ks-hub'],
      secondaryLine: '5h Usage: 4%',
      tertiaryLine: 'Week Usage: 12%',
    });
  });
});
