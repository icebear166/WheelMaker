# Chat Prompt Completion Notifications Design

Date: 2026-05-31
Status: Approved

## Goal

Add opt-in system notifications for completed Chat prompts across PWA/browser and WheelMaker Android without returning to per-message push behavior.

## Product Decisions

1. Notifications are Chat settings, not Connection settings.
2. The first notification type is `chat.prompt.completed`.
3. A notification is emitted only when a `prompt_done` turn is received.
4. Assistant chunks, tool updates, plan updates, system messages, and prompt requests do not trigger notifications.
5. The client suppresses the notification when the user is already viewing the completed session in the visible Chat view.
6. The client shows the notification when the page is hidden, when another session is selected, or when the user is in another workspace view.
7. Notification content includes completion status and session identity, not the full assistant answer.
8. Notification click opens WheelMaker and selects the matching project/session.
9. Each client independently decides whether to notify. PWA and APK may both notify for the same prompt if both are online.
10. Each client deduplicates by `projectId + sessionId + turnIndex`.

## User Setting

Add `Prompt Completion Notifications` under `Settings > Chat`.

The setting is off by default. Enabling it requests the platform notification permission:

- WheelMaker Android asks for Android notification permission when required.
- PWA/browser asks for Web Notification permission.
- If permission is denied, the setting remains disabled or displays a blocked state.
- Turning the setting off suppresses notifications even if platform permission remains granted.

## Architecture

Web owns notification business rules. A small notification provider layer owns platform delivery.

```text
Registry session.message
  -> Web decodes RegistryChatMessage
  -> Chat notification policy checks prompt_done + visibility + setting + dedupe
  -> NotificationProvider.show(payload)
       -> Android provider via WheelMakerAndroidNative
       -> PWA provider via Service Worker/Web Notification
       -> unsupported provider no-ops
```

This keeps Chat semantics in one place and avoids duplicating prompt-completion logic in Kotlin.

## Notification Payload

```ts
type WheelMakerNotificationPayload = {
  type: 'chat.prompt.completed';
  projectId: string;
  sessionId: string;
  turnIndex: number;
  title: string;
  body: string;
  status: 'completed' | 'cancelled' | 'interrupted' | 'failed';
  url: string;
};
```

The first implementation white-lists only `chat.prompt.completed`. Other types require an explicit future product decision.

## Completion Status Mapping

`prompt_done.param.stopReason` maps to notification status:

| stopReason | status | title |
| --- | --- | --- |
| empty / `end_turn` / unknown non-error | `completed` | `Prompt completed` |
| `cancelled` / `canceled` | `cancelled` | `Prompt cancelled` |
| `interrupted` | `interrupted` | `Prompt interrupted` |
| `failed` / `error` | `failed` | `Prompt failed` |

The notification body uses the session title or session id. For failed prompts, a short error message may be appended, but assistant answer text is never included.

## Deep Link

Notification URLs use Web-owned query parameters:

```text
/?wmProjectId=<projectId>&wmSessionId=<sessionId>
```

On app startup or notification click, Web consumes these parameters, opens Chat, refreshes project sessions if needed, selects the target session, and removes the query parameters from the visible URL when practical.

Android notification click starts or brings `MainActivity` to front and passes the same URL/target into WebView. PWA notification click opens the same URL through the service worker.

## Android Native Provider

Android exposes a JS bridge under the existing `WheelMakerAndroidNative` object:

```ts
requestNotificationPermission(): string
getNotificationPermissionState(): string
showNotification(rawJson: string): string
```

The bridge returns JSON strings so the existing synchronous bridge style stays consistent.

Native responsibilities:

- Create a `chat_prompt_completion` notification channel on Android 8+.
- Request `POST_NOTIFICATIONS` on Android 13+.
- Use `NotificationCompat` for display.
- Reject unsupported notification `type` values.
- Build a `PendingIntent` that routes back to the target project/session.
- Avoid logging notification payload text.

Android official constraints:

- Android 8+ notifications require channels.
- Android 13+ non-exempt notifications require the `POST_NOTIFICATIONS` runtime permission.

## PWA Provider

The PWA/browser provider continues using the existing Service Worker/Web Notification path, but is renamed away from demo language and accepts the shared payload shape.

Service worker notification click opens `payload.url`, so PWA and Android share the same deep-link selection behavior.

## Error Handling

- Unsupported platform: setting shows unavailable and no notification is sent.
- Permission denied: setting shows blocked; no repeated permission prompt loop.
- Provider failure: catch and ignore at the session event layer so Chat realtime handling is not interrupted.
- Duplicate realtime/replay events: suppress with the client-side dedupe set.

## Testing

Web tests cover:

- Notification policy fires only for `prompt_done`.
- Visible selected session suppresses notifications.
- Background or other selected session allows notifications.
- Dedupe key prevents repeated notifications.
- Deep-link parsing selects project/session.
- Chat settings include `Prompt Completion Notifications`.
- PWA provider uses shared payload and service worker click URL.

Android tests cover:

- Native bridge exposes notification permission and display methods.
- Unsupported notification type is rejected.
- `chat.prompt.completed` creates channel-backed notifications.
- Android notification click target is encoded for Web selection.

## Self-Review

- No server or Registry protocol change is required.
- Notification business rules stay in Web.
- Android owns only platform permission and display plumbing.
- PWA and APK can both notify; only client-local dedupe is required.
- Prompt answer content is intentionally excluded from notifications.
