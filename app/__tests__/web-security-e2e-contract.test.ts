import {RegistryClient} from '../web/src/registry/RegistryClient';
import {deriveRegistryEndpoints} from '../web/src/registry/registryBaseUrl';
import {RegistryWebAuthClient} from '../web/src/registry/RegistryWebAuthClient';

type WebSocketConstructorCall = {
  args: unknown[];
  url: string;
};

class ContractWebSocket {
  static readonly OPEN = 1;
  static readonly calls: WebSocketConstructorCall[] = [];
  static readonly sent: string[] = [];

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(...args: unknown[]) {
    const url = String(args[0]);
    ContractWebSocket.calls.push({args, url});
    queueMicrotask(() => {
      this.readyState = ContractWebSocket.OPEN;
      this.onopen?.({} as Event);
    });
  }

  send(raw: string): void {
    ContractWebSocket.sent.push(raw);
    const request = JSON.parse(raw) as {requestId: number; method: string};
    queueMicrotask(() => this.onmessage?.({
      data: JSON.stringify({
        requestId: request.requestId,
        type: 'response',
        method: request.method,
        payload: {ok: true},
      }),
    } as MessageEvent));
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({code: 1000, reason: ''} as CloseEvent);
  }

  static reset(): void {
    this.calls.length = 0;
    this.sent.length = 0;
  }
}

const response = (body: unknown): Response => ({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue(body),
} as unknown as Response);

describe('Web security end-to-end contract', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    ContractWebSocket.reset();
    (globalThis as typeof globalThis & {WebSocket: typeof ContractWebSocket}).WebSocket = ContractWebSocket;
  });

  afterEach(() => {
    (globalThis as typeof globalThis & {WebSocket?: typeof WebSocket}).WebSocket = originalWebSocket;
  });

  test.each([
    ['https://registry.example/', 'https://registry.example/ws', 'wss://registry.example/ws'],
    ['https://registry.example/wheelmaker/', 'https://registry.example/wheelmaker/ws', 'wss://registry.example/wheelmaker/ws'],
  ])('login and connect stay credential-free after deriving %s', async (baseURL, authURL, wsURL) => {
    const loginToken = 'one-time-login-value';
    const endpoints = deriveRegistryEndpoints(baseURL);
    const fetcher = jest.fn()
      .mockResolvedValueOnce(response({authenticated: false}))
      .mockResolvedValueOnce(response({authenticated: true, csrfToken: 'csrf-value'}));
    const auth = new RegistryWebAuthClient(endpoints.authURL, fetcher);

    await auth.status();
    const authenticated = await auth.login(loginToken, 'Contract Browser');
    expect(authenticated).toMatchObject({authenticated: true, csrfToken: 'csrf-value'});
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([
      `${authURL}?auth=status`,
      `${authURL}?auth=login`,
    ]);
    for (const [requestURL, init] of fetcher.mock.calls) {
      expect(String(requestURL)).not.toContain(loginToken);
      expect(init).toMatchObject({credentials: 'same-origin', cache: 'no-store'});
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    }

    const client = new RegistryClient();
    await client.connect(endpoints.wsURL);
    await client.connectInit({
      clientName: 'wheelmaker-web',
      clientVersion: '0.1.0',
      protocolVersion: '1',
      role: 'client',
    });

    expect(ContractWebSocket.calls).toHaveLength(1);
    expect(ContractWebSocket.calls[0]).toEqual({args: [wsURL], url: wsURL});
    expect(ContractWebSocket.calls[0].url).not.toContain('?');
    const connectInit = JSON.parse(ContractWebSocket.sent[0]) as {payload: Record<string, unknown>};
    expect(connectInit.payload).toEqual({
      clientName: 'wheelmaker-web',
      clientVersion: '0.1.0',
      protocolVersion: '1',
      role: 'client',
    });
    expect(connectInit.payload.token).toBeUndefined();
    expect(ContractWebSocket.sent[0]).not.toContain(loginToken);
    client.close();
  });
});
