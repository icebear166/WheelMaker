# Android APK Self Update Card Design

## Goal

Show an Android-only APK update card at the top of Settings > Update, compare the installed APK with the latest GitHub Release asset, and let the user download the APK and enter the system install flow.

## Scope

- Only the Android APK shows this card.
- The existing hub and npm update list remains below the card and keeps its current behavior.
- The update flow downloads the APK and launches Android's package installer. It does not attempt silent installation.
- The APK source is the latest GitHub Release for `swm8023/WheelMaker`.

## Data Flow

1. The Web UI detects the native Android bridge method `getAndroidReleaseState`.
2. The Web UI calls GitHub's latest release API and reads the `WheelMakerAndroid.apk` asset metadata, including digest, size, and download URL.
3. The native bridge returns the installed APK package metadata, installed APK sha256, versionName, versionCode, embedded web build sha, and install-permission status.
4. The Web UI compares installed APK sha256 with the latest release asset digest.
5. If different, the card shows `Update available` and enables `Download and Install`.

## Native Install Flow

1. Web calls `WheelMakerAndroidNative.installAndroidRelease(payload)`.
2. Android checks `REQUEST_INSTALL_PACKAGES` capability. If missing, it opens `ACTION_MANAGE_UNKNOWN_APP_SOURCES` for this package and emits a permission-required event.
3. Android downloads the APK with OkHttp into app cache.
4. Android verifies the downloaded APK sha256 against the GitHub asset digest.
5. Android exposes the cached APK through `FileProvider`.
6. Android launches the system package installer with a read grant. The user confirms the install in system UI.

## Error Handling

- GitHub API failures show an inline APK card error.
- Missing GitHub APK asset shows `Latest APK unavailable`.
- Missing install permission shows `Install permission required` and opens Android settings.
- Download or sha mismatch failures are emitted through `wheelmaker:android-apk-update` and shown in the card.

## Security

- The native runtime verifies the APK sha256 before launching installation.
- APK file access is granted through a scoped `FileProvider` cache path.
- The app does not request or claim silent install behavior.
