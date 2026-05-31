# Android APK Self Update Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Android-only Settings > Update card that compares the installed APK with the latest GitHub Release and starts the verified download/install flow.

**Architecture:** Web owns GitHub release lookup, comparison, and card rendering. Android owns installed APK metadata, permission checks, APK download, sha256 verification, FileProvider exposure, and launching the system package installer. Bridge calls are JSON strings consistent with the existing Android native bridge.

**Tech Stack:** React/TypeScript, Jest, Kotlin Android WebView bridge, OkHttp, Android FileProvider, GitHub Releases REST API.

---

### Task 1: Web APK Update Model

**Files:**
- Create: `app/web/src/androidApkUpdate.ts`
- Test: `app/__tests__/web-android-apk-update.test.ts`

- [ ] Write tests for parsing latest GitHub release assets, normalizing `sha256:` digests, and comparing installed APK sha256 to latest APK digest.
- [ ] Implement the helper with focused types and pure comparison functions.
- [ ] Run `npm test -- --runInBand web-android-apk-update.test.ts`.

### Task 2: Android Native Runtime

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Create: `mobile/android/app/src/main/res/xml/apk_update_paths.xml`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidApkUpdateRuntimeTest.kt`

- [ ] Write source and pure function tests for bridge methods, permission declaration, FileProvider declaration, digest normalization, event dispatch, OkHttp download, sha256 verification, and package installer intent.
- [ ] Implement `AndroidApkUpdateRuntime`.
- [ ] Wire the runtime into `WheelMakerBridge` and `MainActivity`.
- [ ] Run Android unit tests.

### Task 3: Settings Update Card

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/styles.css`
- Test: `app/__tests__/web-android-apk-update-settings.test.ts`

- [ ] Write a source structure test proving the APK card appears above the hub update controls and is gated by Android bridge support.
- [ ] Add card state, refresh flow, install event listener, and rendering.
- [ ] Add restrained CSS using existing settings metadata styles.
- [ ] Run focused web tests.

### Task 4: Verification and Publish

**Files:**
- Existing scripts and Android project.

- [ ] Run full app Jest tests.
- [ ] Run `npm run tsc:web`.
- [ ] Run Android unit tests.
- [ ] Build and publish the Android APK locally.
- [ ] Confirm no generated output appears under the repo.
- [ ] Commit and push.
