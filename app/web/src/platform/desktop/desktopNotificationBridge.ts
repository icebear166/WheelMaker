import type { DesktopWindowBridge } from './desktopRuntime';

export type DesktopNotificationPermissionState = 'granted';

export function createDesktopNotificationProvider(bridge: DesktopWindowBridge): {
  kind: 'desktop';
  isSupported(): boolean;
  getPermissionState(): Promise<DesktopNotificationPermissionState>;
  requestPermission(): Promise<DesktopNotificationPermissionState>;
  show(payload: unknown): Promise<boolean>;
} {
  return {
    kind: 'desktop',
    isSupported: () => typeof bridge.showNotification === 'function',
    getPermissionState: async () => 'granted',
    requestPermission: async () => 'granted',
    show: async payload => {
      if (typeof bridge.showNotification !== 'function') {
        return false;
      }
      try {
        const raw = await bridge.showNotification(JSON.stringify(payload));
        const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}') as { ok?: boolean };
        return parsed.ok === true;
      } catch {
        return false;
      }
    },
  };
}
