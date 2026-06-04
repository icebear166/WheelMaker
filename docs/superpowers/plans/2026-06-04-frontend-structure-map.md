# Frontend Structure Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iteratively move Workspace Web UI files toward the documented architecture map without changing runtime behaviour.

**Architecture:** Each task moves one seam at a time, updates imports and structural tests in the same slice, and keeps logic intact. `shell/` owns Workspace shell surfaces and Layout Mode; `platform/` owns Desktop, Android, PWA, and native-host adapters; `debug/` owns diagnostics; generic notification delivery remains separate from Chat notification policy.

**Tech Stack:** React 19, TypeScript, webpack, Jest, PowerShell on Windows.

---

## Files And Responsibilities

- `docs/reviews/architecture-review-workspace-web-ui-2026-06-04.html`: source architecture map for target directories and move map.
- `app/web/src/main.tsx`: current app orchestration. Do not extract large render blocks until late tasks.
- `app/web/src/shell/**`: target for shell surfaces and Layout Mode helpers.
- `app/web/src/platform/**`: target for platform adapters.
- `app/web/src/notifications/**`: target for generic notification provider seam.
- `app/web/src/chat/notifications/**`: target for Chat prompt-completion notification policy.
- `app/web/src/debug/**`: target for diagnostics modules.
- `app/__tests__/**`: structural tests. When a moved module is path-asserted, update the test in the same task.

## Global Rules

- Keep implementation bodies unchanged unless TypeScript requires a relative import update.
- Prefer `git mv` for moved files so history is preserved.
- Do not introduce barrel files unless a task explicitly calls for a temporary compatibility shim.
- Run verification from `app/`.
- Commit after every task that compiles and passes its targeted tests.
- Before final completion, run the repository completion gate from `CLAUDE.md`.

---

### Task 1: Platform And Shell Layout Split

**Files:**
- Move: `app/web/src/shell/desktopRuntime.ts` -> `app/web/src/platform/desktop/desktopRuntime.ts`
- Move: `app/web/src/shell/desktop/webSource.ts` -> `app/web/src/platform/desktop/webSource.ts`
- Move: `app/web/src/shell/native/webSource.ts` -> `app/web/src/platform/native/webSource.ts`
- Move: `app/web/src/shell/DesktopTitleBar.tsx` -> `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx`
- Move: `app/web/src/shell/desktop/chatQuickSwitchContextMenu.ts` -> `app/web/src/shell/layouts/desktop/chatQuickSwitchContextMenu.ts`
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Modify: `app/web/src/debug/nativeWebDiagnostics.ts`
- Modify: `app/web/src/settings/connectionStatus.ts`
- Modify: `app/web/src/settings/ConnectionStatusSettingsDetail.tsx`
- Modify tests:
  - `app/__tests__/web-desktop-chat-quick-switch-context-menu.test.ts`
  - `app/__tests__/web-desktop-web-source.test.ts`
  - `app/__tests__/web-desktop-titlebar.test.tsx`
  - `app/__tests__/web-native-pwa-gating.test.ts`
  - `app/__tests__/web-native-web-source.test.ts`
  - `app/__tests__/web-responsive-shell.test.ts`
  - `app/__tests__/web-mobile-chat-quick-switch-ui.test.ts`

- [x] **Step 1: Run current targeted tests as a baseline**

Run:

```powershell
cd app
npm test -- --runInBand web-desktop-chat-quick-switch-context-menu.test.ts web-desktop-web-source.test.ts web-desktop-titlebar.test.tsx web-native-pwa-gating.test.ts web-native-web-source.test.ts web-responsive-shell.test.ts web-mobile-chat-quick-switch-ui.test.ts
```

Expected: PASS before any move. If it fails, stop and inspect because the structural baseline is not clean.

- [x] **Step 2: Move files**

Run from repository root:

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/platform/desktop, app/web/src/platform/native, app/web/src/shell/layouts/desktop
git mv app/web/src/shell/desktopRuntime.ts app/web/src/platform/desktop/desktopRuntime.ts
git mv app/web/src/shell/desktop/webSource.ts app/web/src/platform/desktop/webSource.ts
git mv app/web/src/shell/native/webSource.ts app/web/src/platform/native/webSource.ts
git mv app/web/src/shell/DesktopTitleBar.tsx app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx
git mv app/web/src/shell/desktop/chatQuickSwitchContextMenu.ts app/web/src/shell/layouts/desktop/chatQuickSwitchContextMenu.ts
```

- [x] **Step 3: Update imports and test path anchors**

Use these replacements:

```text
./shell/DesktopTitleBar -> ./shell/layouts/desktop/DesktopTitleBar
./DesktopTitleBar -> ./layouts/desktop/DesktopTitleBar
./shell/desktop/chatQuickSwitchContextMenu -> ./shell/layouts/desktop/chatQuickSwitchContextMenu
../web/src/shell/desktop/chatQuickSwitchContextMenu -> ../web/src/shell/layouts/desktop/chatQuickSwitchContextMenu
./shell/desktop/webSource -> ./platform/desktop/webSource
../web/src/shell/desktop/webSource -> ../web/src/platform/desktop/webSource
./shell/native/webSource -> ./platform/native/webSource
../shell/native/webSource -> ../platform/native/webSource
../web/src/shell/native/webSource -> ../web/src/platform/native/webSource
./desktopRuntime -> ../../platform/desktop/desktopRuntime
../desktopRuntime -> ../../../platform/desktop/desktopRuntime
```

After replacement, run:

```powershell
rg -n "shell/desktopRuntime|shell/desktop/webSource|shell/native/webSource|shell/DesktopTitleBar|shell/desktop/chatQuickSwitchContextMenu|../desktopRuntime|./desktopRuntime" app/web/src app/__tests__ --glob '!**/dist/**'
```

Expected: no matches except historical prose in docs.

- [x] **Step 4: Verify targeted tests**

Run:

```powershell
cd app
npm test -- --runInBand web-desktop-chat-quick-switch-context-menu.test.ts web-desktop-web-source.test.ts web-desktop-titlebar.test.tsx web-native-pwa-gating.test.ts web-native-web-source.test.ts web-responsive-shell.test.ts web-mobile-chat-quick-switch-ui.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 5: Commit task**

Run:

```powershell
git status --short
git add -A
git commit -m "Refine shell and platform directories"
```

Expected: commit created with only Task 1 files.

---

### Task 2: Mobile Shell Helpers

**Files:**
- Move: `app/web/src/services/mobileFloatingControls.ts` -> `app/web/src/shell/layouts/mobile/floatingControls.ts`
- Move: `app/web/src/services/floatingBackdropTone.ts` -> `app/web/src/shell/layouts/mobile/floatingBackdropTone.ts`
- Move: `app/web/src/services/gestureNavigation.ts` -> `app/web/src/shell/layouts/mobile/gestureNavigation.ts`
- Move: `app/web/src/services/mobileHaptics.ts` -> `app/web/src/shell/layouts/mobile/mobileHaptics.ts`
- Move: `app/web/src/services/mobileSettingsHistory.ts` -> `app/web/src/shell/layouts/mobile/mobileSettingsHistory.ts`
- Move: `app/web/src/services/mobileViewportZoomGuard.ts` -> `app/web/src/shell/layouts/mobile/mobileViewportZoomGuard.ts`
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/services/workspacePersistence.ts`
- Modify: `app/web/src/services/workspaceUiState.ts`
- Modify tests:
  - `app/__tests__/web-responsive-ui-state.test.ts`
  - `app/__tests__/web-floating-backdrop-tone.test.ts`
  - `app/__tests__/web-gesture-navigation.test.ts`
  - `app/__tests__/web-mobile-settings-system-back.test.ts`
  - `app/__tests__/web-mobile-viewport-zoom.test.ts`
  - `app/__tests__/web-chat-ui.test.ts`
  - `app/__tests__/web-port-relay-settings.test.ts`

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-responsive-ui-state.test.ts web-floating-backdrop-tone.test.ts web-gesture-navigation.test.ts web-mobile-settings-system-back.test.ts web-mobile-viewport-zoom.test.ts web-chat-ui.test.ts web-port-relay-settings.test.ts
```

Expected: PASS before moving files.

- [x] **Step 2: Move files**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/shell/layouts/mobile
git mv app/web/src/services/mobileFloatingControls.ts app/web/src/shell/layouts/mobile/floatingControls.ts
git mv app/web/src/services/floatingBackdropTone.ts app/web/src/shell/layouts/mobile/floatingBackdropTone.ts
git mv app/web/src/services/gestureNavigation.ts app/web/src/shell/layouts/mobile/gestureNavigation.ts
git mv app/web/src/services/mobileHaptics.ts app/web/src/shell/layouts/mobile/mobileHaptics.ts
git mv app/web/src/services/mobileSettingsHistory.ts app/web/src/shell/layouts/mobile/mobileSettingsHistory.ts
git mv app/web/src/services/mobileViewportZoomGuard.ts app/web/src/shell/layouts/mobile/mobileViewportZoomGuard.ts
```

- [x] **Step 3: Update imports and test path anchors**

Use these replacements:

```text
./services/mobileFloatingControls -> ./shell/layouts/mobile/floatingControls
./services/floatingBackdropTone -> ./shell/layouts/mobile/floatingBackdropTone
./services/gestureNavigation -> ./shell/layouts/mobile/gestureNavigation
./services/mobileHaptics -> ./shell/layouts/mobile/mobileHaptics
./services/mobileSettingsHistory -> ./shell/layouts/mobile/mobileSettingsHistory
./services/mobileViewportZoomGuard -> ./shell/layouts/mobile/mobileViewportZoomGuard
./mobileFloatingControls -> ../shell/layouts/mobile/floatingControls
../web/src/services/mobileFloatingControls -> ../web/src/shell/layouts/mobile/floatingControls
../web/src/services/floatingBackdropTone -> ../web/src/shell/layouts/mobile/floatingBackdropTone
../web/src/services/gestureNavigation -> ../web/src/shell/layouts/mobile/gestureNavigation
../web/src/services/mobileSettingsHistory -> ../web/src/shell/layouts/mobile/mobileSettingsHistory
../web/src/services/mobileViewportZoomGuard -> ../web/src/shell/layouts/mobile/mobileViewportZoomGuard
../web/src/services/mobileHaptics -> ../web/src/shell/layouts/mobile/mobileHaptics
```

Then run:

```powershell
rg -n "services/mobileFloatingControls|services/floatingBackdropTone|services/gestureNavigation|services/mobileHaptics|services/mobileSettingsHistory|services/mobileViewportZoomGuard|./mobileFloatingControls" app/web/src app/__tests__ --glob '!**/dist/**'
```

Expected: no matches.

- [x] **Step 4: Verify targeted tests**

```powershell
cd app
npm test -- --runInBand web-responsive-ui-state.test.ts web-floating-backdrop-tone.test.ts web-gesture-navigation.test.ts web-mobile-settings-system-back.test.ts web-mobile-viewport-zoom.test.ts web-chat-ui.test.ts web-port-relay-settings.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 5: Commit task**

```powershell
git status --short
git add -A
git commit -m "Move mobile shell helpers into shell layouts"
```

---

### Task 3: Android And PWA Platform Adapters

**Files:**
- Move: `app/web/src/androidApkUpdate.ts` -> `app/web/src/platform/android/androidApkUpdate.ts`
- Move: `app/web/src/features/speech/androidNativeSpeechRuntime.ts` -> `app/web/src/platform/android/androidNativeSpeechRuntime.ts`
- Move: `app/web/src/pwa/*` -> `app/web/src/platform/pwa/*`
- Modify imports in `app/web/src/main.tsx`, `app/web/src/features/speech/voiceInputRuntime.ts`, `app/web/src/settings/UpdateSettingsDetail.tsx`, and affected tests.

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-android-apk-update.test.ts web-android-apk-update-settings.test.ts web-android-native-speech-runtime.test.ts web-pwa-connection.test.ts web-native-pwa-gating.test.ts web-setup.test.js web-reconnect-fallback.test.ts
```

Expected: PASS.

- [x] **Step 2: Move files**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/platform/android, app/web/src/platform/pwa
git mv app/web/src/androidApkUpdate.ts app/web/src/platform/android/androidApkUpdate.ts
git mv app/web/src/features/speech/androidNativeSpeechRuntime.ts app/web/src/platform/android/androidNativeSpeechRuntime.ts
git mv app/web/src/pwa/capabilities.ts app/web/src/platform/pwa/capabilities.ts
git mv app/web/src/pwa/connection.ts app/web/src/platform/pwa/connection.ts
git mv app/web/src/pwa/index.ts app/web/src/platform/pwa/index.ts
git mv app/web/src/pwa/nativePwaGuard.ts app/web/src/platform/pwa/nativePwaGuard.ts
git mv app/web/src/pwa/push.ts app/web/src/platform/pwa/push.ts
git mv app/web/src/pwa/storage.ts app/web/src/platform/pwa/storage.ts
```

- [x] **Step 3: Update imports and tests**

Use replacements:

```text
./androidApkUpdate -> ./platform/android/androidApkUpdate
../web/src/androidApkUpdate -> ../web/src/platform/android/androidApkUpdate
./features/speech/androidNativeSpeechRuntime -> ./platform/android/androidNativeSpeechRuntime
../web/src/features/speech/androidNativeSpeechRuntime -> ../web/src/platform/android/androidNativeSpeechRuntime
./pwa -> ./platform/pwa
./pwa/nativePwaGuard -> ./platform/pwa/nativePwaGuard
../web/src/pwa/ -> ../web/src/platform/pwa/
```

Then run:

```powershell
rg -n "src/androidApkUpdate|features/speech/androidNativeSpeechRuntime|./pwa|../web/src/pwa" app/web/src app/__tests__ --glob '!**/dist/**'
```

Expected: no source/test matches.

- [x] **Step 4: Verify**

```powershell
cd app
npm test -- --runInBand web-android-apk-update.test.ts web-android-apk-update-settings.test.ts web-android-native-speech-runtime.test.ts web-pwa-connection.test.ts web-native-pwa-gating.test.ts web-setup.test.js
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 5: Commit**

```powershell
git add -A
git commit -m "Move platform adapters under platform"
```

---

### Task 4: Notification Provider And Chat Notification Policy

**Files:**
- Move: `app/web/src/notifications/provider.ts` -> `app/web/src/notifications/NotificationProvider.ts`
- Move: `app/web/src/notifications/promptCompletion.ts` -> `app/web/src/chat/notifications/promptCompletionNotification.ts`
- Create: `app/web/src/notifications/notificationPayload.ts`
- Modify imports in `app/web/src/main.tsx`, `app/web/src/notifications/NotificationProvider.ts`, and tests.

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-notification-provider.test.ts web-prompt-completion-notifications.test.ts web-chat-notification-settings.test.ts
```

Expected: PASS.

- [x] **Step 2: Move and create files**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/chat/notifications
git mv app/web/src/notifications/provider.ts app/web/src/notifications/NotificationProvider.ts
git mv app/web/src/notifications/promptCompletion.ts app/web/src/chat/notifications/promptCompletionNotification.ts
```

Create `app/web/src/notifications/notificationPayload.ts` with:

```ts
export type WheelMakerNotificationType = 'chat.prompt.completed';

export type PromptCompletionNotificationStatus =
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed';

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
```

- [x] **Step 3: Update imports**

Use replacements:

```text
./notifications/provider -> ./notifications/NotificationProvider
../web/src/notifications/provider -> ../web/src/notifications/NotificationProvider
./notifications/promptCompletion -> ./chat/notifications/promptCompletionNotification
../web/src/notifications/promptCompletion -> ../web/src/chat/notifications/promptCompletionNotification
./promptCompletion -> ./notificationPayload
```

In `chat/notifications/promptCompletionNotification.ts`, import notification payload types from:

```ts
import type {
  PromptCompletionNotificationStatus,
  WheelMakerNotificationPayload,
} from '../../notifications/notificationPayload';
```

- [x] **Step 4: Verify**

```powershell
cd app
npm test -- --runInBand web-notification-provider.test.ts web-prompt-completion-notifications.test.ts web-chat-notification-settings.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 5: Commit**

```powershell
git add -A
git commit -m "Separate notification provider from chat policy"
```

---

### Task 5: Debug Settings Surface

**Files:**
- Move: `app/web/src/debug/DebugLogsSettingsDetail.tsx` -> `app/web/src/settings/debug/DebugLogsSettingsDetail.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify tests that assert debug settings paths.

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-registry-debug-settings.test.ts web-registry-debug-panel-ui.test.ts web-app-diagnostics.test.ts web-chat-ui.test.ts
```

Expected: PASS.

- [x] **Step 2: Move file and update imports**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/settings/debug
git mv app/web/src/debug/DebugLogsSettingsDetail.tsx app/web/src/settings/debug/DebugLogsSettingsDetail.tsx
```

In the moved file, replace debug-relative imports:

```text
./appDiagnostics -> ../../debug/appDiagnostics
./nativeWebDiagnostics -> ../../debug/nativeWebDiagnostics
./workspaceDiagnostics -> ../../debug/workspaceDiagnostics
```

In `SettingsBundle.ts`, replace:

```ts
export { DebugLogsSettingsDetail } from '../debug/DebugLogsSettingsDetail';
```

with:

```ts
export { DebugLogsSettingsDetail } from './debug/DebugLogsSettingsDetail';
```

- [x] **Step 3: Verify**

```powershell
cd app
npm test -- --runInBand web-registry-debug-settings.test.ts web-registry-debug-panel-ui.test.ts web-app-diagnostics.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 4: Commit**

```powershell
git add -A
git commit -m "Move debug settings surface under settings"
```

---

### Task 6: Registry And Workspace Directory Split

**Files:**
- Move registry files:
  - `app/web/src/services/registryClient.ts` -> `app/web/src/registry/RegistryClient.ts`
  - `app/web/src/services/registryRepository.ts` -> `app/web/src/registry/RegistryRepository.ts`
  - `app/web/src/services/registryWorkspaceService.ts` -> `app/web/src/registry/RegistryWorkspaceService.ts`
  - `app/web/src/services/localHubReadManager.ts` -> `app/web/src/registry/localRead/LocalHubReadManager.ts`
- Move workspace files:
  - `app/web/src/services/workspaceController.ts` -> `app/web/src/workspace/WorkspaceController.ts`
  - `app/web/src/services/workspaceStore.ts` -> `app/web/src/workspace/WorkspaceStore.ts`
  - `app/web/src/services/workspacePersistence.ts` -> `app/web/src/workspace/WorkspacePersistence.ts`
  - `app/web/src/services/projectNavigation.ts` -> `app/web/src/workspace/projectNavigation.ts`
  - `app/web/src/services/hubProjectPreferences.ts` -> `app/web/src/workspace/hubProjectPreferences.ts`
  - `app/web/src/sessionTime.ts` -> `app/web/src/workspace/sessionTime.ts`

- [x] **Step 1: Run broad service baseline tests**

```powershell
cd app
npm test -- --runInBand web-chat-project-service.test.ts web-local-hub-read-service.test.ts web-port-relay-service.test.ts web-session-search-service.test.ts web-session-archive-service.test.ts web-skill-management-service.test.ts web-workspace-project-lightweight.test.ts web-chat-selection-persistence.test.ts
```

Expected: PASS.

- [x] **Step 2: Move files and update imports**

Use `git mv` for all files listed above. Update imports from `./services/*`, `../services/*`, and `../web/src/services/*` to the new `registry/*` or `workspace/*` locations.

- [x] **Step 3: Verify**

```powershell
cd app
npm test -- --runInBand web-chat-project-service.test.ts web-local-hub-read-service.test.ts web-port-relay-service.test.ts web-session-search-service.test.ts web-session-archive-service.test.ts web-skill-management-service.test.ts web-workspace-project-lightweight.test.ts web-chat-selection-persistence.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 4: Commit**

```powershell
git add -A
git commit -m "Split registry and workspace modules"
```

---

### Task 7: Settings Helper Co-location

**Files:**
- Move: `app/web/src/agentPackageUpdateView.ts` -> `app/web/src/settings/update/agentPackageUpdateView.ts`
- Move: `app/web/src/skillManagementView.ts` -> `app/web/src/settings/skills/skillManagementView.ts`
- Move: `app/web/src/tokenStatsView.ts` -> `app/web/src/settings/tokenStats/tokenStatsView.ts`
- Modify detail imports and tests.

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-agent-package-update-view.test.ts web-agent-package-update-settings.test.ts web-skill-management-view.test.ts web-skill-management-settings.test.ts web-token-stats-view.test.ts web-token-stats-settings-ui.test.ts
```

Expected: PASS.

- [x] **Step 2: Move files and update imports**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/settings/update, app/web/src/settings/skills, app/web/src/settings/tokenStats
git mv app/web/src/agentPackageUpdateView.ts app/web/src/settings/update/agentPackageUpdateView.ts
git mv app/web/src/skillManagementView.ts app/web/src/settings/skills/skillManagementView.ts
git mv app/web/src/tokenStatsView.ts app/web/src/settings/tokenStats/tokenStatsView.ts
```

- [x] **Step 3: Verify**

```powershell
cd app
npm test -- --runInBand web-agent-package-update-view.test.ts web-agent-package-update-settings.test.ts web-skill-management-view.test.ts web-skill-management-settings.test.ts web-token-stats-view.test.ts web-token-stats-settings-ui.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 4: Commit**

```powershell
git add -A
git commit -m "Co-locate settings helper modules"
```

---

### Task 8: Chat And Port Relay Helper Co-location

**Files:**
- Move: `app/web/src/chatSync.ts` -> `app/web/src/chat/turns/chatSync.ts`
- Move: `app/web/src/chatSessionState.ts` -> `app/web/src/chat/session/chatSessionState.ts`
- Move: `app/web/src/chatMarkdownImageExport.ts` -> `app/web/src/chat/export/chatMarkdownImageExport.ts`
- Move: `app/web/src/responseImageOutput.ts` -> `app/web/src/chat/export/responseImageOutput.ts`
- Move: `app/web/src/chatPromptCopy.ts` -> `app/web/src/chat/export/chatPromptCopy.ts`
- Move: `app/web/src/portRelayUrl.ts` -> `app/web/src/portRelay/portRelayUrl.ts`
- Move: `app/web/src/portRelayTargets.ts` -> `app/web/src/portRelay/portRelayTargets.ts`

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-chat-sync-reconcile.test.ts web-chat-session-state.test.ts web-chat-markdown-image-export.test.ts web-response-image-output.test.ts web-chat-prompt-copy.test.ts web-port-relay-url.test.ts web-port-relay-targets.test.ts
```

Expected: PASS.

- [x] **Step 2: Move files and update imports**

Create directories with `New-Item -ItemType Directory -Force`, then `git mv` each file listed above. Update source and test imports to the new paths.

- [x] **Step 3: Verify**

```powershell
cd app
npm test -- --runInBand web-chat-sync-reconcile.test.ts web-chat-session-state.test.ts web-chat-markdown-image-export.test.ts web-response-image-output.test.ts web-chat-prompt-copy.test.ts web-port-relay-url.test.ts web-port-relay-targets.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 4: Commit**

```powershell
git add -A
git commit -m "Co-locate chat and port relay helpers"
```

---

### Task 9: Main Bootstrap Extraction

**Files:**
- Create: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/main.tsx`
- Modify tests that assert `main.tsx` contains full App internals.

- [x] **Step 1: Run baseline broad UI structural tests**

```powershell
cd app
npm test -- --runInBand web-main-surface-boundary.test.ts web-chat-turn-rendering.test.ts web-responsive-shell.test.ts web-settings-navigation.test.ts web-file-surface-boundary.test.ts web-git-surface-boundary.test.ts
```

Expected: PASS.

- [x] **Step 2: Move App implementation**

Move everything in `main.tsx` except React/bootstrap imports, CSS/font imports, `createRoot`, and the final render/error boundary into `app/WorkspaceApp.tsx`. Export `App` and `workspaceAppReady` from `WorkspaceApp.tsx`.

The resulting `main.tsx` should import and render:

```ts
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@vscode/codicons/dist/codicon.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import { App, workspaceAppReady } from './app/WorkspaceApp';
import './styles.css';

workspaceAppReady.then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
```

- [x] **Step 3: Verify**

```powershell
cd app
npm test -- --runInBand web-main-surface-boundary.test.ts web-chat-turn-rendering.test.ts web-responsive-shell.test.ts web-settings-navigation.test.ts web-file-surface-boundary.test.ts web-git-surface-boundary.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

- [x] **Step 4: Commit**

```powershell
git add -A
git commit -m "Extract workspace app bootstrap"
```

---

### Task 10: Final Verification And CSS Planning Stop Point

**Files:**
- No CSS split in this execution unless Tasks 1-9 are stable.
- Keep `app/web/src/styles.css` untouched in this plan.

- [x] **Step 1: Run full verification**

```powershell
cd app
npm run tsc:web
npm test -- --runInBand
npm run build:web
```

Expected: TypeScript, Jest, and webpack build all exit 0.

- [x] **Step 2: Commit verification-only docs update if needed**

If no files changed after full verification, skip this step. If docs or tests were updated during verification, run:

```powershell
git add -A
git commit -m "Document frontend structure migration status"
```

---

### Task 11: Shell State Ownership Follow-Up

**Files:**
- Move: `app/web/src/services/responsiveLayout.ts` -> `app/web/src/shell/state/responsiveLayout.ts`
- Move: `app/web/src/services/workspaceUiState.ts` -> `app/web/src/shell/state/workspaceUiState.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Modify tests:
  - `app/__tests__/web-responsive-ui-state.test.ts`
  - `app/__tests__/web-responsive-shell.test.ts`
  - `app/__tests__/web-chat-startup-default.test.ts`

- [x] **Step 1: Run baseline targeted tests**

```powershell
cd app
npm test -- --runInBand web-responsive-ui-state.test.ts web-responsive-shell.test.ts web-chat-startup-default.test.ts
```

Expected: targeted tests PASS before moving files.

- [x] **Step 2: Move shell state files**

```powershell
New-Item -ItemType Directory -Force -Path app/web/src/shell/state
git mv app/web/src/services/responsiveLayout.ts app/web/src/shell/state/responsiveLayout.ts
git mv app/web/src/services/workspaceUiState.ts app/web/src/shell/state/workspaceUiState.ts
```

- [x] **Step 3: Update imports and test anchors**

Use these replacements:

```text
../services/responsiveLayout -> ../shell/state/responsiveLayout
../services/workspaceUiState -> ../shell/state/workspaceUiState
../services/responsiveLayout -> ./state/responsiveLayout in shell/ResponsiveShell.tsx
path.join(projectRoot, 'web', 'src', 'services', 'responsiveLayout.ts') -> path.join(projectRoot, 'web', 'src', 'shell', 'state', 'responsiveLayout.ts')
path.join(projectRoot, 'web', 'src', 'services', 'workspaceUiState.ts') -> path.join(projectRoot, 'web', 'src', 'shell', 'state', 'workspaceUiState.ts')
```

In `shell/state/workspaceUiState.ts`, update relative imports:

```ts
import type { LayoutMode } from './responsiveLayout';
import type {
  PersistedFloatingControlSide,
  PersistedTab,
} from '../../workspace/WorkspacePersistence';
import {
  sanitizeFloatingControlIdleOpacity,
  sanitizeFloatingControlYRatio,
} from '../../preferences/floatingControlPreferences';
import { sanitizeHubColorMap } from '../../workspace/hubProjectPreferences';
```

- [x] **Step 4: Verify**

```powershell
cd app
npm test -- --runInBand web-responsive-ui-state.test.ts web-responsive-shell.test.ts web-chat-startup-default.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

---

### Task 12: Floating Control Preference Seam

**Files:**
- Create: `app/web/src/preferences/floatingControlPreferences.ts`
- Modify: `app/web/src/shell/layouts/mobile/floatingControls.ts`
- Modify: `app/web/src/shell/state/workspaceUiState.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify tests:
  - `app/__tests__/web-responsive-ui-state.test.ts`
  - `app/__tests__/web-drag-scroll-behavior.test.ts`
  - `app/__tests__/web-port-relay-settings.test.ts`

- [x] **Step 1: Create neutral preference module**

Move the persisted floating-control defaults and sanitizer helpers from `shell/layouts/mobile/floatingControls.ts` into `preferences/floatingControlPreferences.ts`:

```ts
export const FLOATING_CONTROL_DEFAULT_Y_RATIO = 0.25;
export const FLOATING_CONTROL_DEFAULT_IDLE_OPACITY = 0.34;
export const FLOATING_CONTROL_IDLE_OPACITY_MIN = 0.1;
export const FLOATING_CONTROL_IDLE_OPACITY_MAX = 0.8;

export type LegacyFloatingControlSlot =
  | 'upper'
  | 'upper-middle'
  | 'center'
  | 'lower-middle'
  | 'lower';

export function sanitizeFloatingControlYRatio(
  value: unknown,
  fallback = FLOATING_CONTROL_DEFAULT_Y_RATIO,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, numeric));
}

export function sanitizeFloatingControlIdleOpacity(
  value: unknown,
  fallback = FLOATING_CONTROL_DEFAULT_IDLE_OPACITY,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const rounded = Math.round((numeric + Number.EPSILON) * 100) / 100;
  return Math.min(
    FLOATING_CONTROL_IDLE_OPACITY_MAX,
    Math.max(FLOATING_CONTROL_IDLE_OPACITY_MIN, rounded),
  );
}

export function floatingControlYRatioFromLegacySlot(value: unknown): number | null {
  switch (value) {
    case 'upper':
      return 0;
    case 'upper-middle':
      return 0.25;
    case 'center':
      return 0.5;
    case 'lower-middle':
      return 0.75;
    case 'lower':
      return 1;
    default:
      return null;
  }
}
```

- [x] **Step 2: Re-export from the mobile layout helper**

`shell/layouts/mobile/floatingControls.ts` should import and re-export the moved symbols so existing callers keep the same runtime API while new persistence callers use `preferences/` directly.

- [x] **Step 3: Update persistence imports**

`workspace/WorkspacePersistence.ts` must import floating-control persisted preference helpers from `../preferences/floatingControlPreferences`, not from `../shell/layouts/mobile/floatingControls`.

- [x] **Step 4: Verify no workspace-to-shell layout dependency remains**

```powershell
rg --glob '!**/dist/**' -n "shell/layouts/mobile/floatingControls" app/web/src/workspace app/web/src/registry
```

Expected: no matches.

- [x] **Step 5: Verify targeted tests**

```powershell
cd app
npm test -- --runInBand web-responsive-ui-state.test.ts web-drag-scroll-behavior.test.ts web-port-relay-settings.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0.

---

### Task 13: Remaining Services Bucket Follow-Up

**Files:**
- Move later: `app/web/src/services/chatScrollBottomButton.ts` -> `app/web/src/chat/layout/chatScrollBottomButton.ts`
- Move later: `app/web/src/services/shikiSettings.ts` -> `app/web/src/code/shikiSettings.ts`
- Move later: `app/web/src/services/shikiRenderer.ts` -> `app/web/src/code/shikiRenderer.ts`

- [ ] **Step 1: Defer until Task 11 and Task 12 are stable**

Do not mix Code rendering and Chat layout moves into the shell-state correction commit. The next execution slice should move these remaining `services/` files with their own targeted tests:

```powershell
cd app
npm test -- --runInBand web-code-layout.test.ts web-shiki-code-fallback.test.ts web-shiki-theme-settings.test.ts web-responsive-ui-state.test.ts
npm run tsc:web
```

Expected: targeted tests PASS and TypeScript exits 0 after that later slice.

---

## Self-Review

- Spec coverage: The plan covers shell/platform split, mobile shell helpers, Android/PWA adapters, notification split, debug Settings surface, registry/workspace split, Settings helpers, Chat/Port Relay helpers, and main bootstrap extraction from the review map.
- Placeholder scan: No task contains `TBD`, `TODO`, or an unspecified "write tests" step.
- Type consistency: Directory names match the review map: `shell/layouts/*`, `platform/*`, `chat/notifications/*`, and generic `notifications/*`.

## Execution Status

- 2026-06-04: Tasks 1-8 are complete and verified on `frontend-structure-map`.
- 2026-06-04: Task 9 extracted `App` into `app/web/src/app/WorkspaceApp.tsx`; `app/web/src/main.tsx` now owns bootstrap imports, global styles/fonts, the IndexedDB-ready render gate, and the startup error fallback.
- 2026-06-04: Task 10 full verification passed with `npm run tsc:web`, `npm test -- --runInBand`, and `npm run build:web`.
- CSS split remains intentionally deferred; `app/web/src/styles.css` was not changed in this execution slice.
- 2026-06-04 follow-up: Added Tasks 11-13 to correct the review-map gaps found after implementation: `shell/state` ownership, neutral floating-control preference sanitizers, and a later services-bucket cleanup.
- 2026-06-04 follow-up: Tasks 11-12 are complete and verified with targeted Jest plus `npm run tsc:web`; `services/responsiveLayout.ts` and `services/workspaceUiState.ts` now live under `shell/state`, and `workspace/WorkspacePersistence.ts` no longer imports mobile layout helpers.
