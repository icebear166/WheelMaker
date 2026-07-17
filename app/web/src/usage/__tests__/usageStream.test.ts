import {UsageStream, parseLimitString} from '../usageStream';

describe('parseLimitString', () => {
  it('parses remaining percent with reset time', () => {
    const limit = parseLimitString('77% (07-22 15:04)', '5h', '5h window');
    expect(limit).not.toBeNull();
    expect(limit!.usedPercent).toBe(23); // 100 - 77
    expect(limit!.resetsAt).toBeGreaterThan(0);
  });
  it('parses remaining percent without reset time', () => {
    const limit = parseLimitString('50%', 'week', 'Weekly');
    expect(limit).not.toBeNull();
    expect(limit!.usedPercent).toBe(50);
    expect(limit!.resetsAt).toBeUndefined();
  });
  it('returns null for empty string', () => {
    expect(parseLimitString('', '5h', '5h')).toBeNull();
    expect(parseLimitString(undefined, '5h', '5h')).toBeNull();
  });
});

describe('UsageStream', () => {
  function makeProviderEvent(provider: string, hubId: string, accounts: Array<Record<string, unknown>>) {
    return {
      type: 'event' as const,
      method: 'tokenStats.update',
      hubId,
      payload: {id: provider, name: provider, accounts},
    };
  }

  it('accumulates accounts across events + dedupes by identity', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '77%'}]));
    stream.ingest(makeProviderEvent('codex', 'h2', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '77%'}]));
    stream.ingest(makeProviderEvent('kimi', 'h1', [{id: 'u1:kimi', status: 'ok', fiveHourLimit: '98%'}]));
    const snap = stream.snapshot();
    expect(snap.accounts).toHaveLength(2);
    const codex = snap.accounts.find(a => a.provider === 'codex');
    expect(codex!.hubIds).toEqual(['h1', 'h2']);
  });

  it('updates an account in place when same provider+identity reappears', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'error', message: 'oops'}]));
    stream.ingest(makeProviderEvent('codex', 'h1', [{id: 'a1:current', email: 'a@b.c', status: 'ok', fiveHourLimit: '10%'}]));
    const snap = stream.snapshot();
    expect(snap.accounts[0].status).toBe('ok');
    expect(snap.accounts[0].limits).toHaveLength(1);
    expect(snap.accounts[0].limits[0].usedPercent).toBe(90); // 100 - 10
  });

  it('parses DeepSeek balance', () => {
    const stream = new UsageStream();
    stream.ingest(makeProviderEvent('deepseek', 'h1', [{
      id: 'deepseek:****',
      status: 'ok',
      balance: {isAvailable: true, items: [{currency: 'CNY', totalBalance: '110', grantedBalance: '10', toppedUpBalance: '100'}]},
    }]));
    const snap = stream.snapshot();
    expect(snap.accounts[0].balance).toBeDefined();
    expect(snap.accounts[0].balance!.items[0].total).toBe('110');
  });

  it('ignores non-tokenStats events', () => {
    const stream = new UsageStream();
    stream.ingest({type: 'event', method: 'other.method', hubId: 'h1', payload: {}});
    expect(stream.snapshot().accounts).toHaveLength(0);
  });
});
