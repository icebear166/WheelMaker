import {buildPortRelayOpenUrl, resolvePortRelayOpenUrl} from './portRelayUrl';

test('uses the Registry Relay URL instead of a stale persisted port', () => {
  expect(resolvePortRelayOpenUrl({
    relayUrl: 'https://workspace.example.com:28811/',
    registryAddress: 'http://127.0.0.1:9630',
    listenPort: 28810,
  })).toBe('https://workspace.example.com:28811/');
});

test('derives a fixed Relay URL from the server-owned port', () => {
  expect(buildPortRelayOpenUrl('https://workspace.example.com', 28810))
    .toBe('https://workspace.example.com:28810/');
});
