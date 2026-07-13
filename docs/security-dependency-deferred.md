# Security dependency review

Reviewed: 2026-07-13

## Applied without major migrations

- npm production audit: 10 findings before (9 low, 1 moderate), 0 after.
- npm complete audit: 22 findings before (10 low, 10 moderate, 1 high, 1 critical), 0 after.
- Direct build tools are pinned to `@babel/core 7.29.7` and `webpack-dev-server 5.2.6`.
- Transitive advisory fixes are pinned with npm overrides: `dompurify 3.4.11`, `ws 8.21.0`, `uuid 11.1.1`, `qs 6.15.2`, `shell-quote 1.8.4`, `http-proxy-middleware 2.0.10`, `js-yaml 3.15.0`, and `launch-editor 2.14.1`.
- AndroidX Core was updated from 1.17.0 to 1.18.0. AndroidX WebKit 1.15.0, Android Gradle Plugin 8.13.2, Kotlin 2.2.21, and OkHttp 4.12.0 were retained as the latest releases compatible with the current platform/tooling constraints.

The initially planned `@babel/core 7.29.1` and `webpack-dev-server 5.2.7` artifacts do not exist in the npm registry. The compatible published fixes used above were resolved from the live advisory and registry data; no `--force` or peer-dependency bypass was used.

## Deferred major migrations

These are not unresolved audit findings. They are deliberately deferred because they require separate compatibility work:

| Dependency | Current line | New line observed | Existing mitigation | Approval / acceptance needed |
| --- | --- | --- | --- | --- |
| Android Gradle Plugin | 8.13.2 | 9.x | Current release tasks fail closed on signing and pass test/lint | Approve AGP 9 migration, its required Gradle/JDK versions, then validate debug/release packaging and publish scripts |
| AndroidX Core | 1.18.0 | 1.19.0 | Latest release compatible with compileSdk 36 / AGP 8.13 | Core 1.19 requires compileSdk 37 and AGP 9.1; approve those migrations together |
| AndroidX WebKit | 1.15.0 | 1.16.0 | Current app retains minSdk 23 | WebKit 1.16 requires minSdk 24; approve dropping Android 6 support before upgrading |
| Kotlin Gradle plugin | 2.2.21 | 2.3/2.4 | Latest 2.2 patch; compiler warnings are non-security deprecations | Approve language/compiler migration and run all JVM tests plus lint on both build types |
| OkHttp | 4.12.0 | 5.x | HTTPS-only update URL, redirects disabled, streamed size/hash validation | Approve OkHttp 5 API/behavior migration and repeat APK download rejection tests |
| Gradle CLI/wrapper | global 9.5.1, wrapper absent | repository-owned wrapper | Builds are reproducible through documented global Gradle command and isolated caches | Decide wrapper ownership/distribution; add wrapper checksum policy before committing binaries |

Go dependencies and the Go toolchain were intentionally not changed in this phase, per the approved scope.

## Recheck triggers

- Run `npm audit --omit=dev` and `npm audit` on every dependency lock change.
- Re-evaluate overrides when the direct Monaco/Mermaid/webpack dependency lines absorb the patched transitive versions.
- Repeat Android dependency review before raising `minSdk`, `targetSdk`, AGP, Kotlin, OkHttp, or Gradle major versions.
