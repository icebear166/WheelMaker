import type { WheelMakerNotificationPayload } from './notificationPayload';
import {
  createAndroidNotificationProvider,
  type AndroidNotificationBridgeEnv,
  type AndroidNotificationPermissionState,
} from '../platform/android/notificationBridge';
import {
  getAndroidNativeRpcFacade,
  type AndroidNativeMessageTarget,
} from '../platform/android/androidNativeMessageBridge';

type NotificationLike = {
  permission?: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission> | NotificationPermission;
};

type ServiceWorkerRegistrationLike = {
  active?: {
    postMessage: (message: unknown) => void;
  } | null;
};

type NotificationProviderEnv = AndroidNotificationBridgeEnv & {
  isSecureContext?: boolean;
  Notification?: NotificationLike;
  PushManager?: unknown;
  navigator?: {
    serviceWorker?: {
      getRegistration?: (scope?: string) => Promise<ServiceWorkerRegistrationLike | null | undefined>;
      register?: (scriptURL: string) => Promise<ServiceWorkerRegistrationLike | null | undefined>;
    };
  };
  WheelMakerAndroidNative?: AndroidNativeMessageTarget;
};

export type WheelMakerNotificationPermissionState = AndroidNotificationPermissionState;

export type WheelMakerNotificationProvider = {
  kind: 'android' | 'pwa' | 'unsupported';
  isSupported(): boolean;
  getPermissionState(): Promise<WheelMakerNotificationPermissionState>;
  requestPermission(): Promise<WheelMakerNotificationPermissionState>;
  show(payload: WheelMakerNotificationPayload): Promise<boolean>;
};

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
  const bridge = getAndroidNativeRpcFacade(env as unknown as Parameters<typeof getAndroidNativeRpcFacade>[0]);
  if (bridge) {
    return createAndroidNotificationProvider(bridge, env);
  }
  const pwaProvider = createPwaProvider(env);
  return pwaProvider.isSupported() ? pwaProvider : unsupportedProvider;
}
