import {RegistryWebAuthError, type RegistryAuthStatus} from './RegistryWebAuthClient';

export type RegistryAuthState = 'checking' | 'unauthenticated' | 'logging-in' | 'authenticated' | 'error';

export type RegistryAuthSnapshot = {
  state: RegistryAuthState;
  status?: RegistryAuthStatus;
  error?: string;
};

type RegistryAuthClient = {
  status(): Promise<RegistryAuthStatus>;
  login(token: string, deviceName: string): Promise<RegistryAuthStatus>;
  logout(csrfToken: string): Promise<void>;
};

export class RegistryAuthController {
  private current: RegistryAuthSnapshot = {state: 'checking'};
  private readonly listeners = new Set<(snapshot: RegistryAuthSnapshot) => void>();

  constructor(private readonly client: RegistryAuthClient) {}

  snapshot(): RegistryAuthSnapshot {
    return {...this.current, status: this.current.status ? {...this.current.status} : undefined};
  }

  subscribe(listener: (snapshot: RegistryAuthSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<RegistryAuthSnapshot> {
    this.publish({state: 'checking'});
    try {
      const status = await this.client.status();
      this.publish(status.authenticated ? {state: 'authenticated', status} : {state: 'unauthenticated'});
    } catch (error) {
      if (error instanceof RegistryWebAuthError && error.status === 401) {
        this.publish({state: 'unauthenticated'});
      } else {
        this.publish({state: 'error', error: error instanceof Error ? error.message : String(error)});
      }
    }
    return this.snapshot();
  }

  async login(token: string, deviceName: string): Promise<RegistryAuthSnapshot> {
    this.publish({state: 'logging-in'});
    try {
      const status = await this.client.login(token, deviceName);
      this.publish(status.authenticated ? {state: 'authenticated', status} : {state: 'unauthenticated'});
    } catch (error) {
      this.publish({state: 'error', error: error instanceof Error ? error.message : String(error)});
    }
    return this.snapshot();
  }

  async requireSession(): Promise<RegistryAuthStatus> {
    if (this.current.state !== 'authenticated') {
      await this.check();
    }
    if (this.current.state !== 'authenticated' || !this.current.status) {
      throw new Error(this.current.error || 'Registry login is required');
    }
    return {...this.current.status};
  }

  async logout(): Promise<void> {
    const csrfToken = this.current.status?.csrfToken;
    if (csrfToken) await this.client.logout(csrfToken);
    this.publish({state: 'unauthenticated'});
  }

  private publish(snapshot: RegistryAuthSnapshot): void {
    this.current = snapshot;
    const current = this.snapshot();
    this.listeners.forEach(listener => listener(current));
  }
}
