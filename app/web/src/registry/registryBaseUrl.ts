export type RegistryEndpoints = {
  authURL: URL;
  wsURL: string;
  basePath: string;
};

const isLoopback = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export function deriveRegistryEndpoints(
  baseURI: string,
  options: {allowInsecureLoopback?: boolean} = {},
): RegistryEndpoints {
  const base = new URL(baseURI);
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Registry page base URL must not contain credentials, query, or fragment');
  }
  if (!base.pathname.endsWith('/')) {
    throw new Error('Registry page base URL must identify a directory');
  }
  const secure = base.protocol === 'https:';
  const insecureLoopback = base.protocol === 'http:' &&
    options.allowInsecureLoopback === true &&
    isLoopback(base.hostname);
  if (!secure && !insecureLoopback) {
    throw new Error('Registry browser access requires HTTPS');
  }

  const authURL = new URL('ws', base);
  const wsURL = new URL(authURL.toString());
  wsURL.protocol = secure ? 'wss:' : 'ws:';
  return {
    authURL,
    wsURL: wsURL.toString(),
    basePath: base.pathname,
  };
}
