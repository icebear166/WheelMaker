import {UsageStore, summarizeProvider} from '../web/src/usage/usageStore';

describe('UsageStore', () => {
  it('accepts MyFlicker monthly limits from HubState', () => {
    const store = new UsageStore();
    expect(store.ingest({
      method: 'hub.state.updated',
      payload: {
        sections: ['tokenStats'],
        state: {sections: {tokenStats: {data: {
          hubId: 'hub-a', generation: 1, status: 'ready', providers: [{
            id: 'flicker', name: 'MyFlicker', status: 'ok', accounts: [{
              localId: 'user-1', identity: {kind: 'user', value: 'user-1', label: 'Account'},
              status: 'ok', limits: [{id: 'month', label: 'Month', remainingPercent: 50.38}],
            }],
          }],
        }}}},
      },
    })).toBe(true);
    expect(store.snapshot().providers[0]).toMatchObject({
      id: 'flicker',
      accounts: [{limits: [{id: 'month', remainingPercent: 50.38}]}],
    });
  });

  it('atomically replaces one Hub and removes disappeared accounts', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 1, status: 'ready', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'current', identity: {kind: 'accountId', value: 'acct-a', label: 'acct-a'},
          status: 'ok', limits: [],
        }],
      }],
    });
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 2, status: 'ready', providers: [{
        id: 'codex', name: 'Codex', status: 'unavailable', accounts: [],
      }],
    });
    expect(store.snapshot().providers.find(item => item.id === 'codex')?.accounts).toEqual([]);
  });

  it('does not merge identity-less accounts across Hubs', () => {
    const store = new UsageStore();
    for (const hubId of ['hub-a', 'hub-b']) {
      store.replaceHub(hubId, {
        hubId, generation: 1, status: 'ready', providers: [{
          id: 'deepseek', name: 'DeepSeek', status: 'ok', accounts: [{
            localId: 'default', identity: {}, status: 'ok', limits: [],
          }],
        }],
      });
    }
    expect(store.snapshot().providers[0].accounts).toHaveLength(2);
  });

  it('aggregates the same source account across Hubs', () => {
    const store = new UsageStore();
    for (const hubId of ['hub-a', 'hub-b']) {
      store.replaceHub(hubId, {
        hubId, generation: 1, status: 'ready', providers: [{
          id: 'kimi', name: 'Kimi', status: 'ok', accounts: [{
            localId: 'opencode', identity: {kind: 'source', label: 'OpenCode'}, status: 'ok',
            limits: [
              {id: '5h', label: '5 hours', remainingPercent: 37},
              {id: 'week', label: 'Week', remainingPercent: 90},
            ],
          }],
        }],
      });
    }

    const accounts = store.snapshot().providers[0].accounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].hubIds).toEqual(['hub-a', 'hub-b']);
  });

  it('aggregates the same Codex email across Hubs without depending on case', () => {
    const store = new UsageStore();
    for (const [hubId, email] of [['windows', 'User@Example.com'], ['linux', 'user@example.com']] as const) {
      store.replaceHub(hubId, {
        hubId, generation: 1, status: 'ready', providers: [{
          id: 'codex', name: 'Codex', status: 'ok', accounts: [{
            localId: 'current', identity: {kind: 'email', value: email, label: email}, status: 'ok',
            limits: [{id: 'week', label: 'Week', remainingPercent: 90}],
          }],
        }],
      });
    }

    const accounts = store.snapshot().providers[0].accounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].hubIds).toEqual(['linux', 'windows']);
  });

  it('summarizes the account with the lowest remaining percentage', () => {
    const summary = summarizeProvider({
      id: 'codex', name: 'Codex', status: 'ok', accounts: [78, 9, 42].map((remainingPercent, index) => ({
        localId: String(index), identity: {kind: 'accountId', value: String(index)}, status: 'ok',
        limits: [{id: '5h', label: '5h', remainingPercent}], hubIds: ['hub-a'],
      })),
    });
    expect(summary.remainingPercent).toBe(9);
    expect(summary.accountCount).toBe(3);
  });

  it('uses a lower-generation snapshot received after a Hub restart', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 20, status: 'ready', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'current', identity: {}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 47}],
        }],
      }],
    });
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 1, status: 'ready', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'current', identity: {}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 44}],
        }],
      }],
    });

    expect(store.snapshot().providers[0].remainingPercent).toBe(44);
  });

  it('keeps visible data while a scan is in progress', () => {
    const store = new UsageStore();
    const ready = {
      hubId: 'hub-a', generation: 3, status: 'ready' as const, providers: [{
        id: 'kimi' as const, name: 'Kimi', status: 'ok' as const, accounts: [{
          localId: 'opencode', identity: {}, status: 'ok' as const,
          limits: [{id: 'week', label: 'Week', remainingPercent: 77}],
        }],
      }],
    };
    store.replaceHub('hub-a', ready);
    store.replaceHub('hub-a', {...ready, status: 'scanning', providers: []});

    expect(store.snapshot().providers[0].remainingPercent).toBe(77);
    expect(store.snapshot().refreshing).toBe(true);
  });

  it('keeps the last successful data while a newer scan is in progress', () => {
    const store = new UsageStore();
    const ready = {
      hubId: 'hub-a', generation: 4, status: 'ready' as const,
      updatedAt: '2026-07-27T10:00:00Z',
      providers: [{
        id: 'kimi' as const, name: 'Kimi', status: 'ok' as const, accounts: [{
          localId: 'opencode', identity: {}, status: 'ok' as const,
          limits: [{id: 'week', label: 'Week', remainingPercent: 66}],
        }],
      }],
    };
    store.replaceHub('hub-a', ready);
    store.replaceHub('hub-a', {
      ...ready,
      generation: 5,
      status: 'scanning',
      providers: [],
    });

    expect(store.snapshot().providers[0].remainingPercent).toBe(66);
    expect(store.snapshot().refreshing).toBe(true);
  });

  it('ignores an older completed snapshot for the same Hub', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 5, status: 'ready',
      updatedAt: '2026-07-27T10:05:00Z', providers: [{
        id: 'kimi', name: 'Kimi', status: 'ok', accounts: [{
          localId: 'opencode', identity: {}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 66}],
        }],
      }],
    });
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 4, status: 'ready',
      updatedAt: '2026-07-27T10:04:00Z', providers: [{
        id: 'kimi', name: 'Kimi', status: 'ok', accounts: [{
          localId: 'opencode', identity: {}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 12}],
        }],
      }],
    });

    expect(store.snapshot().providers[0].remainingPercent).toBe(66);
  });

  it('uses the newest account data when the same account is reported by multiple Hubs', () => {
    const store = new UsageStore();
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 1, status: 'ready',
      updatedAt: '2026-07-27T10:04:00Z', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'current', identity: {kind: 'email', value: 'user@example.com'}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 40}],
        }],
      }],
    });
    store.replaceHub('hub-b', {
      hubId: 'hub-b', generation: 1, status: 'ready',
      updatedAt: '2026-07-27T10:05:00Z', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'current', identity: {kind: 'email', value: 'user@example.com'}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 60}],
        }],
      }],
    });

    const account = store.snapshot().providers[0].accounts[0];
    expect(account.limits[0].remainingPercent).toBe(60);
    expect(account.hubIds).toEqual(['hub-a', 'hub-b']);
  });

  it('retains the local account reference for every merged Hub source', () => {
    const store = new UsageStore();
    store.replaceHub('hub-b', {
      hubId: 'hub-b', generation: 1, status: 'ready',
      updatedAt: '2026-07-28T01:10:00Z', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'local-b', identity: {kind: 'email', value: 'user@example.com'}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 60}],
        }],
      }],
    });
    store.replaceHub('hub-a', {
      hubId: 'hub-a', generation: 1, status: 'ready',
      updatedAt: '2026-07-28T01:00:00Z', providers: [{
        id: 'codex', name: 'Codex', status: 'ok', accounts: [{
          localId: 'local-a', identity: {kind: 'email', value: 'USER@example.com'}, status: 'ok',
          limits: [{id: 'week', label: 'Week', remainingPercent: 65}],
        }],
      }],
    });

    expect(store.snapshot().providers[0].accounts[0].sources).toEqual([
      {hubId: 'hub-a', accountLocalId: 'local-a', updatedAt: '2026-07-28T01:00:00Z'},
      {hubId: 'hub-b', accountLocalId: 'local-b', updatedAt: '2026-07-28T01:10:00Z'},
    ]);
  });

  it('preserves Codex reset credits through normalization', () => {
    const store = new UsageStore();
    expect(store.ingest({
      method: 'hub.state.updated',
      payload: {
        sections: ['tokenStats'],
        state: {sections: {tokenStats: {data: {
          hubId: 'hub-a', generation: 1, status: 'ready', providers: [{
            id: 'codex', name: 'Codex', status: 'ok', accounts: [{
              localId: 'current',
              identity: {kind: 'email', value: 'user@example.com', label: 'user@example.com'},
              status: 'ok',
              limits: [{id: 'week', label: 'Week', remainingPercent: 80}],
              resetCredits: {
                availableCount: 2,
                credits: [
                  {id: 'RateLimitResetCredit_b', expiresAt: '2026-08-01T00:00:00Z'},
                  {id: 'RateLimitResetCredit_a', expiresAt: '2026-07-31T00:00:00Z'},
                  {id: 'RateLimitResetCredit_c'},
                ],
              },
            }],
          }],
        }}}},
      },
    })).toBe(true);

    const account = store.snapshot().providers[0].accounts[0];
    expect(account.resetCredits?.availableCount).toBe(2);
    expect(account.resetCredits?.credits).toEqual([
      {id: 'RateLimitResetCredit_b', expiresAt: '2026-08-01T00:00:00Z'},
      {id: 'RateLimitResetCredit_a', expiresAt: '2026-07-31T00:00:00Z'},
    ]);
  });
});
