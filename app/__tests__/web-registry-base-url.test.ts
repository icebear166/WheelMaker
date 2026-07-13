import {deriveRegistryEndpoints} from '../web/src/registry/registryBaseUrl';

describe('registry endpoints derived from page base URL', () => {
  test.each([
    ['https://wheelmaker.top/', 'https://wheelmaker.top/ws', 'wss://wheelmaker.top/ws', '/'],
    ['https://example.com:8443/wheelmaker/', 'https://example.com:8443/wheelmaker/ws', 'wss://example.com:8443/wheelmaker/ws', '/wheelmaker/'],
  ])('derives auth and websocket endpoints from %s', (base, auth, ws, basePath) => {
    const endpoints = deriveRegistryEndpoints(base);
    expect(endpoints.authURL.toString()).toBe(auth);
    expect(endpoints.wsURL).toBe(ws);
    expect(endpoints.basePath).toBe(basePath);
    endpoints.authURL.searchParams.set('auth', 'status');
    expect(endpoints.authURL.toString()).toBe(`${auth}?auth=status`);
  });

  test.each([
    'http://wheelmaker.top/',
    'https://user:pass@wheelmaker.top/',
    'https://wheelmaker.top/?query=1',
    'https://wheelmaker.top/#fragment',
    'https://wheelmaker.top/index.html',
  ])('rejects unsafe or non-directory base URL %s', base => {
    expect(() => deriveRegistryEndpoints(base)).toThrow();
  });

  test('allows explicit insecure loopback only for development tests', () => {
    expect(deriveRegistryEndpoints('http://127.0.0.1:8080/', {allowInsecureLoopback: true}).wsURL)
      .toBe('ws://127.0.0.1:8080/ws');
    expect(() => deriveRegistryEndpoints('http://example.com/', {allowInsecureLoopback: true})).toThrow();
  });
});
