import fs from 'fs';
import path from 'path';

import { createNotificationProvider } from '../web/src/notifications/NotificationProvider';
import type { WheelMakerNotificationPayload } from '../web/src/notifications/notificationPayload';
import {createAndroidNativeMessageTestHost} from '../testUtils/androidNativeMessageTestHost';

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
  test('keeps Android bridge implementation under platform adapter', () => {
    const root = path.resolve(__dirname, '..');
    const provider = fs.readFileSync(path.join(root, 'web/src/notifications/NotificationProvider.ts'), 'utf8');
    const bridge = fs.readFileSync(path.join(root, 'web/src/platform/android/notificationBridge.ts'), 'utf8');

    expect(provider).toContain("from '../platform/android/notificationBridge'");
    expect(provider).not.toContain('function waitForAndroidPermissionEvent');
    expect(provider).not.toContain('function parseAndroidPermissionResponse');
    expect(bridge).toContain('export function createAndroidNotificationProvider');
    expect(bridge).toContain("wheelmaker:android-notification-permission");
  });

  test('prefers Android native bridge when available', async () => {
    const {target, requests} = createAndroidNativeMessageTestHost({
      'notification.show': () => ({ok: true}),
      'notification.getPermissionState': () => ({state: 'granted'}),
    });
    const provider = createNotificationProvider({
      WheelMakerAndroidNative: target,
    } as any);

    await expect(provider.show(payload)).resolves.toBe(true);

    expect(requests[0]).toMatchObject({
      action: 'notification.show',
      payload: {type: 'chat.prompt.completed'},
    });
  });

  test('waits for Android notification permission result events', async () => {
    let permissionListener: ((event: { detail: { state: string } }) => void) | null = null;
    const {target} = createAndroidNativeMessageTestHost({
      'notification.requestPermission': () => ({state: 'default', pending: true}),
      'notification.getPermissionState': () => ({state: 'default'}),
      'notification.show': () => ({ok: false}),
    });
    const provider = createNotificationProvider({
      WheelMakerAndroidNative: target,
      addEventListener: (eventName: string, listener: EventListener) => {
        if (eventName === 'wheelmaker:android-notification-permission') {
          permissionListener = listener as unknown as typeof permissionListener;
          queueMicrotask(() => permissionListener?.({ detail: { state: 'granted' } }));
        }
      },
      removeEventListener: () => undefined,
    } as any);

    const result = provider.requestPermission();

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
