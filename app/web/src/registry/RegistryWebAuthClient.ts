import type {RegistryDeviceSession} from './registryTypes';

export type RegistryAuthStatus = {
  authenticated: boolean;
  csrfToken?: string;
  device?: RegistryDeviceSession;
};

export class RegistryWebAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'RegistryWebAuthError';
  }
}

export class RegistryWebAuthClient {
  constructor(
    private readonly endpoint: URL,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  status(): Promise<RegistryAuthStatus> {
    return this.requestStatus('status', {method: 'GET'});
  }

  async login(token: string, deviceName: string): Promise<RegistryAuthStatus> {
    let oneTimeToken = token;
    let body = JSON.stringify({token: oneTimeToken, deviceName: deviceName.trim()});
    try {
      return await this.requestStatus('login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
      });
    } finally {
      oneTimeToken = '';
      body = '';
    }
  }

  async logout(csrfToken: string): Promise<void> {
    await this.requestStatus('logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WheelMaker-CSRF': csrfToken,
      },
      body: '{}',
    });
  }

  private async requestStatus(action: 'status' | 'login' | 'logout', init: RequestInit): Promise<RegistryAuthStatus> {
    const url = new URL(this.endpoint.toString());
    url.searchParams.set('auth', action);
    const response = await this.fetcher(url, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new RegistryWebAuthError(response.status, `Registry authentication request failed (${response.status})`);
    }
    const payload = await response.json() as RegistryAuthStatus;
    return {
      authenticated: payload?.authenticated === true,
      csrfToken: typeof payload?.csrfToken === 'string' ? payload.csrfToken : undefined,
      device: payload?.device,
    };
  }
}
