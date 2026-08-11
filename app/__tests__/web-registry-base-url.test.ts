import {deriveRegistryEndpoints} from '../web/src/registry/registryBaseUrl';

describe('registry endpoints derived from page base URL', () => {
  test.each([
    [
      'https://wheelmaker.top/',
      'https://wheelmaker.top/ws',
      'https://wheelmaker.top/ws/preview/',
      'wss://wheelmaker.top/ws',
      '/',
    ],
    [
      'https://example.com:8443/wheelmaker/',
      'https://example.com:8443/wheelmaker/ws',
      'https://example.com:8443/wheelmaker/ws/preview/',
      'wss://example.com:8443/wheelmaker/ws',
      '/wheelmaker/',
    ],
  ])('derives auth, preview, and websocket endpoints from %s', (base, auth, preview, ws, basePath) => {
    const endpoints = deriveRegistryEndpoints(base);
    expect(endpoints.authURL.toString()).toBe(auth);
    expect(endpoints.previewURL.toString()).toBe(preview);
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
    const endpoints = deriveRegistryEndpoints(
      'http://127.0.0.1:9633/wm-local-a1b2c3/',
      {allowInsecureLoopback: true},
    );
    expect(endpoints.authURL.toString()).toBe('http://127.0.0.1:9633/wm-local-a1b2c3/ws');
    expect(endpoints.wsURL).toBe('ws://127.0.0.1:9633/wm-local-a1b2c3/ws');
    expect(endpoints.previewURL.toString()).toBe(
      'http://127.0.0.1:9633/wm-local-a1b2c3/ws/preview/',
    );
    expect(endpoints.basePath).toBe('/wm-local-a1b2c3/');
    expect(() => deriveRegistryEndpoints('http://example.com/', {allowInsecureLoopback: true})).toThrow();
  });
});
