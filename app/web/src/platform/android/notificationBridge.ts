export type AndroidNotificationBridge = {
  showNotification?: (rawJson: string) => string;
  getNotificationPermissionState?: () => string;
  requestNotificationPermission?: () => string;
};

export type AndroidNotificationBridgeEnv = {
  addEventListener?: (eventName: string, listener: EventListener) => void;
  removeEventListener?: (eventName: string, listener: EventListener) => void;
};

export type AndroidNotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

type AndroidPermissionResponse = {
  state: AndroidNotificationPermissionState;
  pending: boolean;
};

function parsePermissionState(raw: string | undefined): AndroidNotificationPermissionState {
  try {
    const parsed = JSON.parse(raw || '{}') as { state?: string; permission?: string };
    const value = parsed.state || parsed.permission;
    if (value === 'granted' || value === 'denied' || value === 'default') {
      return value;
    }
  } catch {
    return 'unsupported';
  }
  return 'unsupported';
}

function parseAndroidPermissionResponse(raw: string | undefined): AndroidPermissionResponse {
  try {
    const parsed = JSON.parse(raw || '{}') as { state?: string; permission?: string; pending?: boolean };
    const value = parsed.state || parsed.permission;
    const state = value === 'granted' || value === 'denied' || value === 'default'
      ? value
      : 'unsupported';
    return { state, pending: parsed.pending === true };
  } catch {
    return { state: 'unsupported', pending: false };
  }
}

function parseOk(raw: string | undefined): boolean {
  try {
    const parsed = JSON.parse(raw || '{}') as { ok?: boolean };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

function waitForAndroidPermissionEvent(
  env: AndroidNotificationBridgeEnv,
): Promise<AndroidNotificationPermissionState> {
  const addEventListener = env.addEventListener;
  const removeEventListener = env.removeEventListener;
  if (!addEventListener || !removeEventListener) {
    return Promise.resolve('default');
  }
  return new Promise(resolve => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      removeEventListener('wheelmaker:android-notification-permission', listener);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
    const listener = ((event: Event) => {
      const detail = (event as CustomEvent<{ state?: string }>).detail;
      const value = detail?.state;
      cleanup();
      resolve(value === 'granted' || value === 'denied' || value === 'default'
        ? value
        : 'unsupported');
    }) as EventListener;
    timeoutId = setTimeout(() => {
      cleanup();
      resolve('default');
    }, 30_000);
    addEventListener('wheelmaker:android-notification-permission', listener);
  });
}

export function createAndroidNotificationProvider(
  bridge: AndroidNotificationBridge,
  env: AndroidNotificationBridgeEnv,
): {
  kind: 'android';
  isSupported(): boolean;
  getPermissionState(): Promise<AndroidNotificationPermissionState>;
  requestPermission(): Promise<AndroidNotificationPermissionState>;
  show(payload: unknown): Promise<boolean>;
} {
  return {
    kind: 'android',
    isSupported: () => typeof bridge.showNotification === 'function',
    getPermissionState: async () => parsePermissionState(bridge.getNotificationPermissionState?.()),
    requestPermission: async () => {
      const response = parseAndroidPermissionResponse(bridge.requestNotificationPermission?.());
      return response.pending
        ? waitForAndroidPermissionEvent(env)
        : response.state;
    },
    show: async payload => parseOk(bridge.showNotification?.(JSON.stringify(payload))),
  };
}
