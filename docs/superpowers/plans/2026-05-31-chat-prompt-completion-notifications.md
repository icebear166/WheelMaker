# Chat Prompt Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in Chat prompt completion notifications for PWA/browser and WheelMaker Android.

**Architecture:** Web owns notification policy, settings, payload construction, and deep-link routing. Platform providers only deliver notifications: PWA via Service Worker/Web Notification, Android via the existing JavaScript bridge and native NotificationManager.

**Tech Stack:** React/TypeScript Web UI, Service Worker JavaScript, Kotlin Android WebView shell, AndroidX Core NotificationCompat, Jest, JUnit.

---

## File Structure

- Create `app/web/src/notifications/promptCompletion.ts`: pure policy helpers for status mapping, visibility decision, payload creation, and dedupe key.
- Create `app/web/src/notifications/provider.ts`: shared notification provider interface and platform provider selection.
- Modify `app/web/src/pwa/push.ts`: rename demo-oriented local notification API to support shared payloads while preserving existing calls if needed.
- Modify `app/web/public/service-worker.js`: keep showing notifications with a click URL from payload data.
- Modify `app/web/src/main.tsx`: add Chat setting, consume deep-link query params, call notification policy on `session.message`.
- Modify `app/web/src/services/workspacePersistence.ts` and `workspaceStore.ts`: persist the Chat notification setting in global state.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`: expose notification bridge methods.
- Create `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt`: permission state, permission request, notification channel, display, click intent.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`: initialize notification runtime and consume notification target intents.
- Modify `mobile/android/app/src/main/AndroidManifest.xml`: set launch mode so notification clicks route into the existing Activity.
- Add/extend tests under `app/__tests__/` and `mobile/android/app/src/test/java/com/wheelmaker/android/`.

## Task 1: Web Notification Policy

**Files:**
- Create: `app/web/src/notifications/promptCompletion.ts`
- Test: `app/__tests__/web-prompt-completion-notifications.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import {
  buildPromptCompletionNotification,
  promptCompletionNotificationKey,
  shouldNotifyPromptCompletion,
} from '../web/src/notifications/promptCompletion';
import type { RegistryChatMessage, RegistrySessionSummary } from '../web/src/types/registry';

function message(method: string, turnIndex = 7, param: Record<string, unknown> = {}): RegistryChatMessage {
  return { sessionId: 'sess-1', turnIndex, method, param, finished: true };
}

const session: RegistrySessionSummary = {
  sessionId: 'sess-1',
  title: 'Build Android',
  preview: '',
  updatedAt: '2026-05-31T00:00:00.000Z',
  messageCount: 1,
};

describe('prompt completion notifications', () => {
  test('only prompt_done can notify', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('agent_message_chunk'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'other:sess-2',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(false);

    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'other:sess-2',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(true);
  });

  test('suppresses the visible selected chat session', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible',
      activeTab: 'chat',
    })).toBe(false);
  });

  test('allows background and other-view completions', () => {
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'hidden',
      activeTab: 'chat',
    })).toBe(true);
    expect(shouldNotifyPromptCompletion({
      enabled: true,
      message: message('prompt_done'),
      projectId: 'proj-1',
      selectedRuntimeKey: 'proj-1:sess-1',
      documentVisibility: 'visible',
      activeTab: 'files',
    })).toBe(true);
  });

  test('builds privacy-preserving payload and stable dedupe key', () => {
    const payload = buildPromptCompletionNotification({
      message: message('prompt_done', 9, { stopReason: 'failed', message: 'agent crashed with a very long diagnostic' }),
      projectId: 'proj-1',
      session,
    });

    expect(payload).toMatchObject({
      type: 'chat.prompt.completed',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      turnIndex: 9,
      status: 'failed',
      title: 'Prompt failed',
    });
    expect(payload.body).toContain('Build Android');
    expect(payload.body).not.toContain('assistant answer');
    expect(payload.url).toContain('wmProjectId=proj-1');
    expect(payload.url).toContain('wmSessionId=sess-1');
    expect(promptCompletionNotificationKey('proj-1', message('prompt_done', 9))).toBe('proj-1:sess-1:9');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd app; npm test -- --runInBand web-prompt-completion-notifications.test.ts`

Expected: FAIL because `app/web/src/notifications/promptCompletion.ts` does not exist.

- [ ] **Step 3: Implement policy helpers**

Create `promptCompletion.ts` with exported helpers:

```ts
import type { RegistryChatMessage, RegistrySessionSummary } from '../types/registry';

export type WheelMakerNotificationType = 'chat.prompt.completed';
export type PromptCompletionNotificationStatus = 'completed' | 'cancelled' | 'interrupted' | 'failed';

export type WheelMakerNotificationPayload = {
  type: WheelMakerNotificationType;
  projectId: string;
  sessionId: string;
  turnIndex: number;
  title: string;
  body: string;
  status: PromptCompletionNotificationStatus;
  url: string;
};

export function promptCompletionNotificationKey(projectId: string, message: RegistryChatMessage): string {
  return `${projectId}:${message.sessionId}:${Math.max(0, Math.trunc(Number(message.turnIndex) || 0))}`;
}

export function resolvePromptCompletionStatus(param: Record<string, unknown>): PromptCompletionNotificationStatus {
  const stopReason = typeof param.stopReason === 'string' ? param.stopReason.trim().toLowerCase() : '';
  if (stopReason === 'cancelled' || stopReason === 'canceled') return 'cancelled';
  if (stopReason === 'interrupted') return 'interrupted';
  if (stopReason === 'failed' || stopReason === 'error') return 'failed';
  return 'completed';
}

export function shouldNotifyPromptCompletion(input: {
  enabled: boolean;
  message: RegistryChatMessage;
  projectId: string;
  selectedRuntimeKey: string;
  documentVisibility: DocumentVisibilityState | 'hidden' | 'visible';
  activeTab: string;
}): boolean {
  if (!input.enabled || !input.projectId || !input.message.sessionId) return false;
  if (input.message.method !== 'prompt_done') return false;
  if (input.documentVisibility !== 'visible') return true;
  if (input.activeTab !== 'chat') return true;
  return input.selectedRuntimeKey !== `${input.projectId}:${input.message.sessionId}`;
}

export function buildPromptCompletionNotification(input: {
  projectId: string;
  message: RegistryChatMessage;
  session?: Pick<RegistrySessionSummary, 'sessionId' | 'title'>;
}): WheelMakerNotificationPayload {
  const status = resolvePromptCompletionStatus(input.message.param);
  const title = status === 'completed'
    ? 'Prompt completed'
    : status === 'cancelled'
      ? 'Prompt cancelled'
      : status === 'interrupted'
        ? 'Prompt interrupted'
        : 'Prompt failed';
  const sessionTitle = input.session?.title || input.message.sessionId;
  const messageText = status === 'failed' && typeof input.message.param.message === 'string'
    ? input.message.param.message.trim()
    : '';
  const body = messageText
    ? `${sessionTitle}: ${messageText.slice(0, 120)}`
    : sessionTitle;
  const projectId = input.projectId;
  const sessionId = input.message.sessionId;
  return {
    type: 'chat.prompt.completed',
    projectId,
    sessionId,
    turnIndex: Math.max(0, Math.trunc(Number(input.message.turnIndex) || 0)),
    title,
    body,
    status,
    url: `/?wmProjectId=${encodeURIComponent(projectId)}&wmSessionId=${encodeURIComponent(sessionId)}`,
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd app; npm test -- --runInBand web-prompt-completion-notifications.test.ts`

Expected: PASS.

## Task 2: Provider Layer And PWA Delivery

**Files:**
- Create: `app/web/src/notifications/provider.ts`
- Modify: `app/web/src/pwa/push.ts`
- Modify: `app/web/public/service-worker.js`
- Test: `app/__tests__/web-notification-provider.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createNotificationProvider } from '../web/src/notifications/provider';

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

    await expect(provider.show({
      type: 'chat.prompt.completed',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      turnIndex: 1,
      title: 'Prompt completed',
      body: 'Build Android',
      status: 'completed',
      url: '/?wmProjectId=proj-1&wmSessionId=sess-1',
    })).resolves.toBe(true);

    expect(calls[0]).toContain('chat.prompt.completed');
  });

  test('falls back to PWA local notification provider', async () => {
    const messages: unknown[] = [];
    const provider = createNotificationProvider({
      isSecureContext: true,
      Notification: { permission: 'granted', requestPermission: async () => 'granted' },
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

    await expect(provider.show({
      type: 'chat.prompt.completed',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      turnIndex: 1,
      title: 'Prompt completed',
      body: 'Build Android',
      status: 'completed',
      url: '/?wmProjectId=proj-1&wmSessionId=sess-1',
    })).resolves.toBe(true);

    expect(JSON.stringify(messages[0])).toContain('WM_PWA_NOTIFY');
    expect(JSON.stringify(messages[0])).toContain('wmSessionId');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd app; npm test -- --runInBand web-notification-provider.test.ts`

Expected: FAIL because `notifications/provider.ts` does not exist.

- [ ] **Step 3: Implement provider layer**

Implement `createNotificationProvider` with Android-first selection, PWA fallback, unsupported no-op, and JSON parsing of Android bridge return values.

- [ ] **Step 4: Run tests and verify pass**

Run: `cd app; npm test -- --runInBand web-notification-provider.test.ts`

Expected: PASS.

## Task 3: Chat Setting, Deep Link, And Event Wiring

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/services/workspacePersistence.ts`
- Modify: `app/web/src/services/workspaceStore.ts`
- Test: `app/__tests__/web-chat-notification-settings.test.ts`
- Test: `app/__tests__/web-reconnect-fallback.test.ts`

- [ ] **Step 1: Write failing source-structure tests**

Add tests that assert:

- `Prompt Completion Notifications` appears inside the Chat settings section.
- `maybeNotifyChatMessage` is replaced or constrained so it checks `message.method === 'prompt_done'`.
- The event handler calls `shouldNotifyPromptCompletion`.
- The event handler calls `buildPromptCompletionNotification`.
- Notification URLs include `wmProjectId` and `wmSessionId`.
- Global persistence includes `promptCompletionNotificationsEnabled`.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd app; npm test -- --runInBand web-chat-notification-settings.test.ts web-reconnect-fallback.test.ts`

Expected: FAIL because the setting and policy calls are not wired.

- [ ] **Step 3: Implement setting and event wiring**

Add global persisted state `promptCompletionNotificationsEnabled`, render a Chat settings row with an on/off button, request provider permission when enabling, and update session event handling to notify only after `prompt_done` policy passes.

- [ ] **Step 4: Implement deep-link consumption**

On startup, parse `wmProjectId` and `wmSessionId`, open Chat, refresh/select the target session when registry state is ready, then clear those query parameters with `history.replaceState`.

- [ ] **Step 5: Run tests and verify pass**

Run: `cd app; npm test -- --runInBand web-chat-notification-settings.test.ts web-reconnect-fallback.test.ts`

Expected: PASS.

## Task 4: Android Native Notification Bridge

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidNotificationRuntimeTest.kt`

- [ ] **Step 1: Write failing Android tests**

Add tests that inspect the Kotlin source and pure helper behavior:

- `WheelMakerBridge` exposes `requestNotificationPermission`, `getNotificationPermissionState`, and `showNotification`.
- `AndroidNotificationRuntime` defines `chat.prompt.completed` as the only supported type.
- `AndroidNotificationRuntime` creates `chat_prompt_completion` channel.
- `MainActivity` uses `onNewIntent` and `singleTop` launch mode for notification clicks.

- [ ] **Step 2: Run Android tests and verify failure**

Run Gradle with external build dirs:

```powershell
gradle :app:testDebugUnitTest --no-daemon --console=plain --project-cache-dir D:\.wheelmaker\build\mobile\android\gradle-cache-test -g D:\.wheelmaker\build\mobile\android\gradle-home-test -PwheelmakerBuildRoot=D:\.wheelmaker\build\mobile\android\gradle-build-test -Pkotlin.project.persistent.dir=D:\.wheelmaker\build\mobile\android\gradle-build-test\kotlin-persistent
```

Expected: FAIL because the native runtime and bridge methods do not exist.

- [ ] **Step 3: Implement Android runtime and bridge**

Create `AndroidNotificationRuntime`, wire it into `WheelMakerBridge`, initialize it in `MainActivity`, request notification permission on Android 13+, create the notification channel on Android 8+, and route click intents into WebView with the shared `wmProjectId`/`wmSessionId` URL.

- [ ] **Step 4: Run Android tests and verify pass**

Run the same Gradle command.

Expected: PASS.

## Task 5: Full Verification And Publish

**Files:**
- All files above

- [ ] **Step 1: Run focused Web tests**

Run: `cd app; npm test -- --runInBand web-prompt-completion-notifications.test.ts web-notification-provider.test.ts web-chat-notification-settings.test.ts web-reconnect-fallback.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Web typecheck**

Run: `cd app; npm run tsc:web`

Expected: PASS.

- [ ] **Step 3: Run Android unit tests**

Run the external-dir Gradle test command from Task 4.

Expected: PASS.

- [ ] **Step 4: Build APK**

Run: `.\scripts\publish_android.ps1`

Expected: APK written to `~/.wheelmaker/mobile/android/WheelMakerAndroid.apk` and release manifest updated.

- [ ] **Step 5: Execute repository completion gate**

Run exactly from repo root:

```powershell
git add -A
git commit -m "feat: add chat prompt completion notifications"
git push origin main
```

Expected: commit and push succeed.

## Self-Review

- The plan covers the approved spec: Chat setting, prompt_done-only trigger, visibility suppression, privacy-safe payloads, deep-link click behavior, PWA provider, Android provider, client-local dedupe, and verification.
- No server protocol changes are included.
- All implementation tasks include red/green test steps.
- Generated Android/Web build output stays outside the repo.
