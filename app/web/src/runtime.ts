const DEFAULT_REGISTRY_PORT = 9630;

function isNativeAppAssetHost(hostname: string): boolean {
  return hostname.toLowerCase() === 'appassets.androidplatform.net';
}

export function getDefaultRegistryAddress(): string {
  const host = window.location.hostname;
  if (host === '127.0.0.1') {
    return `ws://127.0.0.1:${DEFAULT_REGISTRY_PORT}/ws`;
  }
  if (isNativeAppAssetHost(host)) {
    return `127.0.0.1:${DEFAULT_REGISTRY_PORT}`;
  }
  if (window.location.host) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return `127.0.0.1:${DEFAULT_REGISTRY_PORT}`;
}

export function toRegistryWsUrl(address: string): string {
  const input = address.trim();
  if (!input) {
    throw new Error('Address is required');
  }
  if (/^wss?:\/\//i.test(input)) return input;
  if (/^https?:\/\//i.test(input)) {
    return input.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  }
  const hasPort = /:\d+$/.test(input);
  const host = hasPort ? input : `${input}:9630`;
  return `ws://${host}/ws`;
}
