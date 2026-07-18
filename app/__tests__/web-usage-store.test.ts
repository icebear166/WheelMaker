import {UsageStore, summarizeProvider} from '../web/src/usage/usageStore';

describe('UsageStore', () => {
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

  it('rejects stale generations and a late scanning phase from the same generation', () => {
    const store = new UsageStore();
    const ready = {
      hubId: 'hub-a', generation: 3, status: 'ready' as const, providers: [{
        id: 'kimi' as const, name: 'Kimi', status: 'ok' as const, accounts: [],
      }],
    };
    store.replaceHub('hub-a', ready);
    store.replaceHub('hub-a', {...ready, generation: 2, providers: []});
    store.replaceHub('hub-a', {...ready, status: 'scanning', providers: []});

    expect(store.snapshot().providers.map(provider => provider.id)).toEqual(['kimi']);
    expect(store.snapshot().refreshing).toBe(false);
  });
});
