# System Security Baseline Failures

Recorded on 2026-07-13 before Phase 01 implementation.

## Passing baseline commands

- `server: go test ./...`
- `app: npm test -- --runInBand` (163 suites, 842 tests; Node emitted the existing `--localstorage-file` warning)
- `app: npm run tsc:web`
- `mobile/android: gradle test` (unit-test tasks passed or were up to date)

## Existing Android lint failures

The plan command `./gradlew.bat test lint` could not run because this checkout does not contain a Gradle wrapper. The available global Gradle 9.5.1 was used instead:

```text
gradle test lint
```

The build reached `:app:lintDebug` and failed with 3 existing errors and 13 warnings:

1. `MainActivity.kt:148` — `GestureBackNavigation`: `onBackPressed` is not used for Android 16+ predictive back gestures; migrate to `OnBackPressedDispatcher`.
2. `MainActivity.kt:319` — `NewApi`: `MediaStore.getPickImagesMaxLimit` requires R Extensions SDK 2 while the current minimum is 0.
3. `styles.xml:4` — `NewApi`: `android:windowLightNavigationBar` requires API 27 while the app minimum is API 23.

Phase 01 does not modify Android sources. These failures are the comparison baseline and must not be reported as Phase 01 regressions.
