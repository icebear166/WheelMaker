import { createNotificationProvider } from '../web/src/notifications/provider';
import type { WheelMakerNotificationPayload } from '../web/src/notifications/promptCompletion';

const payload: WheelMakerNotificationPayload = {
  type: 'chat.prompt.completed',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  turnIndex: 1,
  title: 'Prompt completed',
  body: 'Build Android',
  status: 'completed',
  url: '/?wmProjectId=proj-1&wmSessionId=sess-1',
};

describe('notification provider selection', () => {
  test('prefers Android native bridge when available', async () => {
    const calls: string[] = [];
    const provider = createNotificationProvider({
      WheelMakerAndroidNative: {
        showNotification: raw => {
          calls.push(raw);
          return JSON.stringify({ ok: true });
        },
        getNotificationPermissionState: () => JSON.stringify({ state: 'granted' }),
      },
    } as any);

    await expect(provider.show(payload)).resolves.toBe(true);

    expect(calls[0]).toContain('chat.prompt.completed');
  });

  test('waits for Android notification permission result events', async () => {
    let permissionListener: ((event: { detail: { state: string } }) => void) | null = null;
    const provider = createNotificationProvider({
      WheelMakerAndroidNative: {
        requestNotificationPermission: () => JSON.stringify({ state: 'default', pending: true }),
        getNotificationPermissionState: () => JSON.stringify({ state: 'default' }),
        showNotification: () => JSON.stringify({ ok: false }),
      },
      addEventListener: (eventName: string, listener: EventListener) => {
        if (eventName === 'wheelmaker:android-notification-permission') {
          permissionListener = listener as unknown as typeof permissionListener;
        }
      },
      removeEventListener: () => undefined,
    } as any);

    const result = provider.requestPermission();
    permissionListener?.({ detail: { state: 'granted' } });

    await expect(result).resolves.toBe('granted');
  });

  test('falls back to PWA local notification provider', async () => {
    const messages: unknown[] = [];
    const provider = createNotificationProvider({
      isSecureContext: true,
      Notification: {
        permission: 'granted',
        requestPermission: async () => 'granted',
      },
      navigator: {
        serviceWorker: {
          getRegistration: async () => ({
            active: { postMessage: (message: unknown) => messages.push(message) },
          }),
          register: async () => null,
        },
      },
      PushManager: function PushManager() {},
    } as any);

    await expect(provider.show(payload)).resolves.toBe(true);

    expect(JSON.stringify(messages[0])).toContain('WM_PWA_NOTIFY');
    expect(JSON.stringify(messages[0])).toContain('wmSessionId');
  });
});
