import {RegistryWebAuthClient} from '../web/src/registry/RegistryWebAuthClient';

describe('RegistryWebAuthClient', () => {
  const response = (body: unknown, status = 200): Response => ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);

  test('uses same-origin no-store requests and URLSearchParams for every action', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(response({authenticated: false}))
      .mockResolvedValueOnce(response({authenticated: true, csrfToken: 'csrf'}))
      .mockResolvedValueOnce(response({authenticated: false}));
    const client = new RegistryWebAuthClient(new URL('https://example.com/wheelmaker/ws'), fetcher);

    await client.status();
    await client.login('one-time-token', 'Browser');
    await client.logout('csrf');

    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([
      'https://example.com/wheelmaker/ws?auth=status',
      'https://example.com/wheelmaker/ws?auth=login',
      'https://example.com/wheelmaker/ws?auth=logout',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({credentials: 'same-origin', cache: 'no-store'});
      expect((init.headers as Record<string, string>).Origin).toBeUndefined();
    }
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({token: 'one-time-token', deviceName: 'Browser'});
    expect(fetcher.mock.calls[2][1].headers).toMatchObject({'X-WheelMaker-CSRF': 'csrf'});
  });

  test('does not expose the login token through errors or object state', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({}, 401));
    const client = new RegistryWebAuthClient(new URL('https://example.com/ws'), fetcher);
    await expect(client.login('must-not-echo', 'Browser')).rejects.not.toThrow('must-not-echo');
    expect(JSON.stringify(client)).not.toContain('must-not-echo');
  });
});
