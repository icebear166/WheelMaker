import type { WheelMakerNotificationPayload } from './promptCompletion';

type AndroidNotificationBridge = {
  showNotification?: (rawJson: string) => string;
  getNotificationPermissionState?: () => string;
  requestNotificationPermission?: () => string;
};

type NotificationLike = {
  permission?: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission> | NotificationPermission;
};

type ServiceWorkerRegistrationLike = {
  active?: {
    postMessage: (message: unknown) => void;
  } | null;
};

type NotificationProviderEnv = {
  isSecureContext?: boolean;
  Notification?: NotificationLike;
  PushManager?: unknown;
  addEventListener?: (eventName: string, listener: EventListener) => void;
  removeEventListener?: (eventName: string, listener: EventListener) => void;
  navigator?: {
    serviceWorker?: {
      getRegistration?: (scope?: string) => Promise<ServiceWorkerRegistrationLike | null | undefined>;
      register?: (scriptURL: string) => Promise<ServiceWorkerRegistrationLike | null | undefined>;
    };
  };
  WheelMakerAndroidNative?: AndroidNotificationBridge;
};

type AndroidPermissionResponse = {
  state: WheelMakerNotificationPermissionState;
  pending: boolean;
};

export type WheelMakerNotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export type WheelMakerNotificationProvider = {
  kind: 'android' | 'pwa' | 'unsupported';
  isSupported(): boolean;
  getPermissionState(): Promise<WheelMakerNotificationPermissionState>;
  requestPermission(): Promise<WheelMakerNotificationPermissionState>;
  show(payload: WheelMakerNotificationPayload): Promise<boolean>;
};

function parsePermissionState(raw: string | undefined): WheelMakerNotificationPermissionState {
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
  env: NotificationProviderEnv,
): Promise<WheelMakerNotificationPermissionState> {
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

function createAndroidProvider(
  bridge: AndroidNotificationBridge,
  env: NotificationProviderEnv,
): WheelMakerNotificationProvider {
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

function createPwaProvider(env: NotificationProviderEnv): WheelMakerNotificationProvider {
  const serviceWorker = env.navigator?.serviceWorker;
  const notificationApi = env.Notification;
  const supported = !!env.isSecureContext &&
    !!serviceWorker &&
    typeof notificationApi !== 'undefined';

  const ensurePermission = async (): Promise<WheelMakerNotificationPermissionState> => {
    if (!notificationApi) {
      return 'unsupported';
    }
    const current = notificationApi.permission;
    if (current === 'granted' || current === 'denied') {
      return current;
    }
    const requested = await notificationApi.requestPermission?.();
    return requested === 'granted' || requested === 'denied' || requested === 'default'
      ? requested
      : 'unsupported';
  };

  const registration = async (): Promise<ServiceWorkerRegistrationLike | null> => {
    const existing = await serviceWorker?.getRegistration?.('/service-worker.js');
    if (existing) {
      return existing;
    }
    return await serviceWorker?.register?.('/service-worker.js') ?? null;
  };

  return {
    kind: supported ? 'pwa' : 'unsupported',
    isSupported: () => supported,
    getPermissionState: async () => {
      const value = notificationApi?.permission;
      return value === 'granted' || value === 'denied' || value === 'default'
        ? value
        : 'unsupported';
    },
    requestPermission: ensurePermission,
    show: async payload => {
      if (!supported) {
        return false;
      }
      if (await ensurePermission() !== 'granted') {
        return false;
      }
      const activeRegistration = await registration();
      if (!activeRegistration?.active) {
        return false;
      }
      activeRegistration.active.postMessage({
        type: 'WM_PWA_NOTIFY',
        payload,
      });
      return true;
    },
  };
}

const unsupportedProvider: WheelMakerNotificationProvider = {
  kind: 'unsupported',
  isSupported: () => false,
  getPermissionState: async () => 'unsupported',
  requestPermission: async () => 'unsupported',
  show: async () => false,
};

export function createNotificationProvider(
  env: NotificationProviderEnv = globalThis as NotificationProviderEnv,
): WheelMakerNotificationProvider {
  const bridge = env.WheelMakerAndroidNative;
  if (bridge?.showNotification) {
    return createAndroidProvider(bridge, env);
  }
  const pwaProvider = createPwaProvider(env);
  return pwaProvider.isSupported() ? pwaProvider : unsupportedProvider;
}
