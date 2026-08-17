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
  title: 'Build Android',
  body: 'Prompt completed',
  preview: '',
  status: 'completed',
  tag: 'proj-1:sess-1',
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

  test('prefers desktop bridge over pwa when WheelMakerDesktop exposes showNotification', async () => {
    const calls: string[] = [];
    const provider = createNotificationProvider({
      WheelMakerDesktop: {
        enabled: true,
        showNotification: (raw: string) => {
          calls.push(raw);
          return JSON.stringify({ok: true});
        },
      },
      isSecureContext: true,
      Notification: {permission: 'granted'},
      navigator: {serviceWorker: {getRegistration: async () => null}},
    } as any);

    expect(provider.kind).toBe('desktop');
    await expect(provider.getPermissionState()).resolves.toBe('granted');
    await expect(provider.requestPermission()).resolves.toBe('granted');
    await expect(provider.show(payload)).resolves.toBe(true);
    expect(JSON.parse(calls[0])).toMatchObject({
      type: 'chat.prompt.completed',
      tag: 'proj-1:sess-1',
    });
  });

  test('desktop show returns false on bridge failure and malformed results', async () => {
    const failing = createNotificationProvider({
      WheelMakerDesktop: {
        enabled: true,
        showNotification: () => {
          throw new Error('gone');
        },
      },
    } as any);
    await expect(failing.show(payload)).resolves.toBe(false);

    const malformed = createNotificationProvider({
      WheelMakerDesktop: {enabled: true, showNotification: () => 'not-json'},
    } as any);
    await expect(malformed.show(payload)).resolves.toBe(false);
  });

  test('ignores desktop bridge without showNotification and falls through to pwa', () => {
    const provider = createNotificationProvider({
      WheelMakerDesktop: {enabled: true},
      isSecureContext: true,
      Notification: {permission: 'granted'},
      navigator: {serviceWorker: {getRegistration: async () => null}},
    } as any);
    expect(provider.kind).toBe('pwa');
  });

  test('service worker uses png icons, session tag replacement and origin-focus click', () => {
    const root = path.resolve(__dirname, '..');
    const sw = fs.readFileSync(path.join(root, 'web/public/service-worker.js'), 'utf8');
    expect(sw).toContain("'/icons/icon-192.png'");
    expect(sw).toContain("'/icons/badge-96.png'");
    expect(sw).toContain('renotify');
    expect(sw).toContain('payload.tag');
    expect(sw).toContain('WM_NOTIFICATION_NAVIGATE');
    expect(sw).not.toContain('client.url === targetUrl');
    expect(fs.existsSync(path.join(root, 'web/public/icons/icon-192.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'web/public/icons/badge-96.png'))).toBe(true);
  });
});
