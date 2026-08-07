# Unified Android Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate signed Android APKs into the optional `v1.x` WheelMaker release flow while unifying build versions, caches, deployment cleanup, and Web update metadata.

**Architecture:** The release CLI resolves the next public stable version before every build, writes final assets under `.release-out/v1.x`, and keeps reusable compiler state under `.release-work/cache`. A focused Android builder owns Gradle invocation, signing verification, and manifest generation; the publisher treats its output like the existing optional Desktop asset and carries its stable pointer forward. Web fetches global public metadata once, while each Hub reports only installed release and local update-job state.

**Tech Stack:** Node.js 22 ESM and `node:test`, Go 1.26, React/TypeScript/Jest, Gradle/Kotlin/Android SDK 36, GitHub Actions, PowerShell entrypoint tests.

---

### Task 1: Resolve one public `v1.x` version for local and public builds

**Files:**
- Modify: `scripts/release/metadata.mjs`
- Modify: `scripts/release/metadata.test.mjs`
- Modify: `scripts/release/cli.mjs`
- Modify: `scripts/release/cli.test.mjs`
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/release/build.test.mjs`
- Modify: `scripts/release.mjs`
- Modify: `.gitignore`

- [x] **Step 1: Write failing metadata and CLI tests**

Add cases proving that both local and public builds read stable first, turn `v1.23` into `v1.24`, use `.release-out/v1.24`, pass `.release-work` cache/work roots, and never produce `local-<sha>`.

```js
test('every release build uses the next public stable version', async () => {
  const deps = fakeCliDeps();
  deps.resolveNextVersion = async () => 'v1.24';
  const result = await runRelease({publish: false, withAndroid: false, withDesktop: false}, deps);
  assert.equal(deps.state.buildCalls[0].version, 'v1.24');
  assert.equal(result.build.versionRoot, 'D:\\repo\\.release-out\\v1.24');
});

test('nextV1Version rejects malformed public metadata', () => {
  assert.throws(() => stableVersionFromBytes(Buffer.from('{"schema":2}')), /stable metadata/);
});
```

- [x] **Step 2: Run the focused release tests and verify failure**

Run: `node --test scripts/release/metadata.test.mjs scripts/release/cli.test.mjs scripts/release/build.test.mjs`

Expected: FAIL because `resolveNextVersion`, unified version input, and work/cache roots do not exist.

- [x] **Step 3: Implement stable parsing and version resolution**

Export strict helpers from `metadata.mjs` and inject a public stable reader into the CLI. Local mode uses unauthenticated HTTPS; public mode may use the authenticated release API, but both return the same candidate string.

```js
export function stableVersionFromBytes(bytes) {
  const stable = JSON.parse(bytes.toString('utf8'));
  if (stable.schema !== 1 || !/^v1\.(0|[1-9]\d*)$/.test(stable.version ?? '')) {
    throw new Error('stable metadata schema is invalid');
  }
  return stable.version;
}

export function nextStableVersion(bytes) {
  return nextV1Version(stableVersionFromBytes(bytes));
}
```

Make `runRelease` resolve the version before `buildRelease`, remove `local-<sha>`, and return the version for non-public output. Add `.release-work/` to `.gitignore`.

- [x] **Step 4: Route Webpack and Go caches through `.release-work/cache`**

Pass these explicit paths to build commands without changing final asset layout:

```js
const cacheRoot = join(workRoot, 'cache');
const commandEnv = {
  GOCACHE: join(cacheRoot, 'go-build'),
  GOMODCACHE: join(cacheRoot, 'go-mod'),
  WHEELMAKER_WEBPACK_CACHE: join(cacheRoot, 'webpack'),
};
```

Update Webpack configuration in Task 4 to consume the override; until then the build test only asserts the environment contract.

- [x] **Step 5: Run focused tests and verify they pass**

Run: `node --test scripts/release/metadata.test.mjs scripts/release/cli.test.mjs scripts/release/build.test.mjs`

Expected: PASS.

- [x] **Step 6: Commit the unified version and directory change**

```powershell
git add .gitignore scripts/release.mjs scripts/release/metadata.mjs scripts/release/metadata.test.mjs scripts/release/cli.mjs scripts/release/cli.test.mjs scripts/release/build.mjs scripts/release/build.test.mjs
git commit -m "refactor: unify release build versions"
```

### Task 2: Build and verify Android from the release MJS

**Files:**
- Create: `scripts/release/android.mjs`
- Create: `scripts/release/android.test.mjs`
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/release/build.test.mjs`
- Modify: `mobile/android/app/build.gradle.kts`
- Create: `mobile/android/signing/release.p12`
- Create: `mobile/android/signing/signing.properties`

- [x] **Step 1: Write failing Android builder tests**

Use injected runners and a temporary filesystem. Assert exact version properties, cache/work paths, output names, manifest identity, and cleanup on both success and failure.

```js
test('android builder injects the v1.x Android version and verifies the signed APK', async () => {
  const result = await buildAndroidRelease({
    cacheRoot,
    outputDirectory,
    repoRoot,
    runner: fakeAndroidRunner,
    version: 'v1.24',
    workRoot,
  });
  assert.equal(result.versionName, '1.24');
  assert.equal(result.versionCode, 24);
  assert.equal(basename(result.apkPath), 'WheelMakerAndroid.apk');
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});
```

- [x] **Step 2: Run the Android/release tests and verify failure**

Run: `node --test scripts/release/android.test.mjs scripts/release/build.test.mjs`

Expected: FAIL because `android.mjs` and `withAndroid` are missing.

- [x] **Step 3: Make Gradle read committed signing properties and injected versions**

Replace signing environment-variable lookup with one repository file and strict keys:

```kotlin
val releaseVersionName = providers.gradleProperty("wheelmakerReleaseVersionName").orNull
val releaseVersionCode = providers.gradleProperty("wheelmakerReleaseVersionCode").orNull?.toIntOrNull()
val signingFile = rootProject.file("signing/signing.properties")
val signingProperties = Properties().apply {
    FileInputStream(signingFile).use { load(it) }
}
```

Release tasks must fail when the file, keystore, `storePassword`, `keyAlias`, or `keyPassword` is absent or invalid. Non-release unit-test tasks must continue without loading release credentials.

- [x] **Step 4: Move the existing signing identity into the repository without printing secrets**

Copy the existing PKCS12 bytes from `~/.wheelmaker/mobile/android/wheelmaker-android-release.p12` to `mobile/android/signing/release.p12`. Write `signing.properties` from the existing user-level signing values without echoing them to command output. Validate with `keytool -list` before deleting nothing from the old location.

- [x] **Step 5: Implement the Android MJS builder**

The builder must:

```js
const versionNumber = /^v1\.(\d+)$/.exec(version)?.[1];
if (!versionNumber) throw new Error(`invalid Android release version: ${version}`);

await runner('gradle', [
  'assembleRelease',
  '--project-cache-dir', gradleProjectCache,
  '-g', gradleHome,
  `-PwheelmakerBuildRoot=${gradleBuildRoot}`,
  `-PwheelmakerWebAssetsDir=${bootstrapAssetsRoot}`,
  `-PwheelmakerReleaseVersionName=1.${versionNumber}`,
  `-PwheelmakerReleaseVersionCode=${versionNumber}`,
], {cwd: androidRoot, env: {GRADLE_USER_HOME: gradleHome}});
```

Copy only the shared bootstrap asset into the temporary Android asset root, locate the release APK under the external build root, copy it to the final Android output directory, call `apksigner verify --print-certs`, compute SHA-256 and size, and write `android-release.json` atomically. Remove the Android temporary root in `finally`.

- [x] **Step 6: Integrate optional Android output into `buildRelease`**

Add `withAndroid=false`; call `buildAndroidRelease` only when true and return `androidApk` metadata with the existing platforms/Desktop result.

- [x] **Step 7: Run focused Node and real Gradle validation**

Run: `node --test scripts/release/android.test.mjs scripts/release/build.test.mjs`

Expected: PASS.

Run from `mobile/android`: `gradle :app:tasks --all`

Expected: PASS without requiring signing for non-release task discovery.

Run: `node scripts/release.mjs --with-android`

Expected: produces `.release-out/v1.x/android/WheelMakerAndroid.apk` and `android-release.json`, with matching hash, version, and certificate metadata.

- [x] **Step 8: Commit Android build integration**

```powershell
git add scripts/release/android.mjs scripts/release/android.test.mjs scripts/release/build.mjs scripts/release/build.test.mjs mobile/android/app/build.gradle.kts mobile/android/signing/release.p12 mobile/android/signing/signing.properties
git commit -m "feat: build signed Android release assets"
```

### Task 3: Publish Android in the same Release and stable pointer

**Files:**
- Modify: `scripts/release/publish.mjs`
- Modify: `scripts/release/publish.test.mjs`
- Modify: `scripts/release/cli.mjs`
- Modify: `scripts/release/cli.test.mjs`
- Modify: `scripts/release.mjs`

- [x] **Step 1: Write failing publisher tests for Android assets and carry-forward**

```js
test('release with Android uploads APK and manifest and writes stable pointer', async () => {
  const release = await fixtureRelease({withAndroid: true});
  const stable = await publishBuiltRelease(release, new FakeGitHubApi());
  assert.equal(stable.androidApk.version, stable.version);
  assert.equal(stable.androidApk.versionName, stable.version.slice(1));
  assert.match(stable.androidApk.sha256, /^[0-9a-f]{64}$/);
});

test('release without Android carries the previous Android pointer forward', () => {
  const next = makeStable({previous: {androidApk: previousAndroid}, release: stableReleaseInput({version: 'v1.25'})});
  assert.deepEqual(next.androidApk, previousAndroid);
});
```

- [x] **Step 2: Run publisher tests and verify failure**

Run: `node --test scripts/release/cli.test.mjs scripts/release/publish.test.mjs`

Expected: FAIL because Android metadata is not packaged or carried.

- [x] **Step 3: Package Android assets and create the stable pointer**

Read `WheelMakerAndroid.apk` and `android-release.json`, verify the manifest identity matches the build version/source SHA/hash/size, upload both exact asset names, and return:

```js
androidApk = {
  version,
  versionName: android.versionName,
  versionCode: android.versionCode,
  publishedAt: release.publishedAt,
  sourceSha: release.sourceSha,
  url: releaseAssetUrl(release.channel, version, 'WheelMakerAndroid.apk'),
  sha256: sha256Bytes(apkBytes),
  size: apkBytes.length,
};
```

Add `release.androidApk ?? previous?.androidApk` in `makeStable`. Keep stable as the final write after the public Release.

- [x] **Step 4: Make version conflicts rebuild-safe**

The version used to compile Android must equal the GitHub tag. Pass the resolved version into `publishBuiltRelease`; if the tag already exists, return a typed version-conflict error to the CLI instead of silently renaming already-built assets. The CLI resolves the next candidate and rebuilds the entire release before retrying, capped at three attempts.

- [x] **Step 5: Run publisher tests and verify pass**

Run: `node --test scripts/release/cli.test.mjs scripts/release/publish.test.mjs`

Expected: PASS, including stable-last and failure-atomicity cases.

- [x] **Step 6: Commit unified Android publishing**

```powershell
git add scripts/release.mjs scripts/release/cli.mjs scripts/release/cli.test.mjs scripts/release/publish.mjs scripts/release/publish.test.mjs
git commit -m "feat: publish Android with WheelMaker releases"
```

### Task 4: Add interactive Android choices and accelerate the Action

**Files:**
- Modify: `scripts/release/entry.mjs`
- Modify: `scripts/release/entry.test.mjs`
- Modify: `.github/workflows/publish-release.yml`
- Modify: `app/web/webpack.config.js`
- Modify: `app/__tests__/web-setup.test.js`
- Modify: `CLAUDE.md`

- [x] **Step 1: Write failing entrypoint, workflow, and Webpack-cache tests**

Assert three local questions, two Action asset questions plus confirmation, `with_android` workflow input, conditional Android setup, and the cache override.

```js
assert.deepEqual(parseReleaseArgs(['--with-android']), {
  publish: false,
  withAndroid: true,
  withDesktop: false,
});
expect(webpackConfig.cache.cacheDirectory).toBe(process.env.WHEELMAKER_WEBPACK_CACHE);
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `node --test scripts/release/entry.test.mjs scripts/release/cli.test.mjs`

Run from `app`: `npm test -- __tests__/web-setup.test.js --runInBand`

Expected: FAIL for missing Android prompts/input and cache override.

- [x] **Step 3: Implement interactive and non-interactive wiring**

Local prompt order is Desktop, Android, public. Action prompt order is Desktop, Android, confirmation. Pass `--with-android` locally and `with_android=true|false` to `gh workflow run`.

- [x] **Step 4: Add conditional Android setup and layered caches**

Keep the single Ubuntu job. Add Java/Android/Gradle setup only under `if: inputs.with_android`, cache `.release-work/cache/webpack`, `.release-work/cache/go-build`, `.release-work/cache/go-mod`, and Gradle state with lockfile/config-based keys, and pass `--with-android` only when selected.

```yaml
- name: Set up Java for Android
  if: ${{ inputs.with_android }}
  uses: actions/setup-java@v4
  with:
    distribution: temurin
    java-version: '17'

- name: Set up Gradle
  if: ${{ inputs.with_android }}
  uses: gradle/actions/setup-gradle@v4
```

Do not upload/download intermediate Actions artifacts. Let release MJS reuse one Web build and use bounded internal concurrency for independent compilation.

- [x] **Step 5: Make Webpack consume the release cache override**

```js
cacheDirectory: process.env.WHEELMAKER_WEBPACK_CACHE
  ? path.resolve(process.env.WHEELMAKER_WEBPACK_CACHE)
  : path.join(os.homedir(), '.wheelmaker', 'cache', 'webpack'),
```

- [x] **Step 6: Run focused tests and workflow structural checks**

Run: `node --test scripts/release/entry.test.mjs scripts/release/cli.test.mjs`

Run from `app`: `npm test -- __tests__/web-setup.test.js --runInBand`

Expected: PASS.

- [x] **Step 7: Commit the accelerated Action and entrypoints**

```powershell
git add .github/workflows/publish-release.yml CLAUDE.md scripts/release/entry.mjs scripts/release/entry.test.mjs app/web/webpack.config.js app/__tests__/web-setup.test.js
git commit -m "feat: add optional Android Action publishing"
```

### Task 5: Clean deployment staging and legacy build roots

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/test_deploy_bat.ps1`
- Modify: `scripts/test_deploy_sh.ps1`

- [x] **Step 1: Write failing deployment cleanup tests**

Cover successful and failed deployments, stable metadata containing `androidApk`, no APK fetch, and migration removal of the entire old build root.

```js
test('deployment always removes its job package directory', async () => {
  await runCore([], fixture.deps);
  assert.equal(await exists(join(home, 'staging', jobId)), false);
  assert.equal(await exists(join(home, 'staging', 'status.json')), true);
});

test('migration removes the complete legacy build directory', async () => {
  await runCore(['migrate-uninstall'], fixture.deps);
  assert.equal(await exists(join(home, 'build')), false);
});
```

- [x] **Step 2: Run deploy tests and verify failure**

Run: `node --test scripts/deploy/deploy-core.test.mjs`

Expected: FAIL because job directories and non-bootstrap build content remain.

- [x] **Step 3: Implement unconditional per-job cleanup**

Wrap deployment execution with a final cleanup that validates the job ID and removes only `join(stagingDirectory, jobId)`. Finish `status.json` and release the lock before or independently of deleting the package directory; cleanup failure must be logged/raised without deleting status.

- [x] **Step 4: Remove the full legacy build root in migration**

Replace the narrow `build/bootstrap` removal with `rm(join(paths.home, 'build'), {recursive: true, force: true})`. Do not inspect or delete other drive roots.

- [x] **Step 5: Run Node and wrapper tests**

Run: `node --test scripts/deploy/deploy-core.test.mjs`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_bat.ps1`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_sh.ps1`

Expected: PASS.

- [x] **Step 6: Commit deployment cleanup**

```powershell
git add scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs scripts/test_deploy_bat.ps1 scripts/test_deploy_sh.ps1
git commit -m "fix: clean deployment working directories"
```

### Task 6: Make Hub update queries local-only

**Files:**
- Modify: `server/internal/hub/tools/update.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `app/web/src/registry/registryTypes.ts`

- [x] **Step 1: Write failing Go tests for local-only query state**

Replace network-stable comparison expectations with installed/job-state expectations and assert the fake HTTP client is never called by `query`.

```go
func TestUpdateQueryReadsOnlyInstalledReleaseAndJob(t *testing.T) {
    response, cmdErr := cmd.Handle(context.Background(), rawToolPayload(t, map[string]any{
        "action": "query", "hubId": "hub-a",
    }))
    if cmdErr != nil { t.Fatal(cmdErr) }
    body := response.(updateCommandResponse)
    if body.Status != "installed" || client.Calls() != 0 { t.Fatalf("response=%+v", body) }
}
```

- [x] **Step 2: Run focused Go tests and verify failure**

Run from `server`: `go test ./internal/hub/tools -run 'TestUpdate(Query|Request)' -count=1`

Expected: FAIL because query fetches stable and publish status.

- [x] **Step 3: Simplify `UpdateCommand.query`**

Return `not_installed`, `checking_failed`, `installed`, or `update_pending` based only on local `release.json`, `status.json`, and `lock.json`. Keep request behavior unchanged: it creates a local lease and triggers `deploy.mjs update`, which fetches trusted stable itself. Remove unused stable/publish HTTP fields and helpers from this command.

- [x] **Step 4: Update the TypeScript response contract**

Add `installed` as a wire status, retain optional legacy `stable`/`publishStatus` fields for rolling compatibility, and make new UI logic ignore them.

- [x] **Step 5: Run focused and full Hub tests**

Run from `server`: `go test ./internal/hub/tools -count=1`

Run from `server`: `go test ./internal/hub/... -count=1`

Expected: PASS.

- [x] **Step 6: Commit local-only Hub update state**

```powershell
git add server/internal/hub/tools/update.go server/internal/hub/tools/tools_test.go app/web/src/registry/registryTypes.ts
git commit -m "refactor: report local WheelMaker update state"
```

### Task 7: Fetch global release metadata once in Web and use it for Android

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Modify: `app/web/src/platform/android/androidApkUpdate.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-android-apk-update.test.ts`
- Modify: `app/__tests__/web-android-apk-update-settings.test.ts`

- [x] **Step 1: Write failing Web model tests**

Cover strict stable parsing, one global fetch, derived per-Hub status, carried Android pointer parsing, no source-repo latest API, and no Git fields.

```ts
test('derives hub status from global stable and local installed release', () => {
  expect(deriveWheelMakerHubStatus({version: 'v1.23'}, {version: 'v1.24'})).toBe('update_available');
});

test('parses Android from stable instead of a GitHub release response', () => {
  expect(parseAndroidStableRelease({androidApk: validPointer})?.apk.downloadUrl)
    .toBe(validPointer.url);
});
```

- [x] **Step 2: Run focused Web tests and verify failure**

Run from `app`: `npm test -- __tests__/web-agent-package-update-settings.test.ts __tests__/web-android-apk-update.test.ts __tests__/web-android-apk-update-settings.test.ts --runInBand`

Expected: FAIL because stable is fetched per Hub/server and Android uses the source latest-release API.

- [x] **Step 3: Add a strict global public metadata model**

In `agentPackageUpdateView.ts`, define the fixed public URLs, parse schema-1 stable and publish status, and derive Hub states by numeric `v1.x` comparison. Keep release history on the public GitHub Releases HTTPS API.

```ts
export const WHEELMAKER_STABLE_URL =
  'https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/stable.json';

export function deriveWheelMakerHubStatus(
  installed: RegistryWheelMakerInstalledRelease | undefined,
  stable: RegistryWheelMakerStableRelease | null,
  job?: RegistryWheelMakerUpdateJob,
): RegistryWheelMakerUpdateStatus | string {
  if (job && ['queued', 'downloading', 'verifying', 'applying', 'restarting'].includes(job.state)) {
    return 'update_pending';
  }
  if (!installed) return 'not_installed';
  if (!stable) return 'checking_failed';
  const installedMatch = /^v1\.(0|[1-9]\d*)$/.exec(installed.version);
  const stableMatch = /^v1\.(0|[1-9]\d*)$/.exec(stable.version);
  if (!installedMatch || !stableMatch) return 'checking_failed';
  const installedSequence = Number(installedMatch[1]);
  const stableSequence = Number(stableMatch[1]);
  if (stableSequence > installedSequence) return 'update_available';
  if (stableSequence < installedSequence) return 'local_newer';
  return 'up_to_date';
}
```

- [x] **Step 4: Refactor Workspace update state**

Replace per-Hub stable/publish fields with one `wheelMakerPublicMetadata` state. Refresh it once when the update detail opens or the user refreshes. Query each Hub only for installed/job data, including Hubs with zero projects, and derive the card status in Web. “Update All” sends independent requests without Registry ordering.

- [x] **Step 5: Parse and install Android from `stable.androidApk`**

Remove `GITHUB_ANDROID_LATEST_RELEASE_API` and GitHub asset parsing. Convert the strict pointer to the existing native install request shape. Ordinary browsers do not show the Android card; Android native continues package/version/signature verification.

- [x] **Step 6: Simplify update-page display**

Show global latest version/published time/publish phase once. Per Hub show installed version/time, derived update status, job phase/error, and update button. Remove Git/branch/ahead/behind language; keep NPM package management unchanged.

- [x] **Step 7: Run focused Web tests**

Run from `app`: `npm test -- __tests__/web-agent-package-update-settings.test.ts __tests__/web-android-apk-update.test.ts __tests__/web-android-apk-update-settings.test.ts --runInBand`

Expected: PASS.

- [x] **Step 8: Commit global Web update metadata**

```powershell
git add app/web/src/settings/agentPackageUpdateView.ts app/web/src/platform/android/androidApkUpdate.ts app/web/src/app/WorkspaceApp.tsx app/web/src/settings/UpdateSettingsDetail.tsx app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-android-apk-update.test.ts app/__tests__/web-android-apk-update-settings.test.ts
git commit -m "refactor: centralize public update metadata"
```

### Task 8: Retire old Android publishers and update documentation

**Files:**
- Delete: `publish-android.bat`
- Delete: `publish-android-github.bat`
- Delete: `scripts/publish_android.ps1`
- Delete: `scripts/publish_android_github_release.ps1`
- Delete: `scripts/test_publish_android_ps1.ps1`
- Delete: `scripts/test_publish_android_github_release_ps1.ps1`
- Modify: `scripts/test_android_release_signing.ps1`
- Modify: `scripts/release/entry.test.mjs`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/test_security_acceptance_ps1.ps1`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `docs/prebuilt-release-deployment-design.md`
- Modify: `docs/scope/2026-07-16-prebuilt-release-deployment.md`
- Modify: `docs/scope/2026-07-17-unified-android-release.md`
- Modify: `docs/plans/2026-07-17-unified-android-release/plan-unified-android-release.md`

- [x] **Step 1: Update absence and signing tests before deleting files**

Extend `entry.test.mjs` to assert the four old entry/publisher files are absent. Rewrite the signing structural test around Gradle plus `mobile/android/signing`, and make security acceptance run the new Node Android tests.

- [x] **Step 2: Run structural/security-script tests and verify failure**

Run: `node --test scripts/release/entry.test.mjs`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_android_release_signing.ps1`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1`

Expected: FAIL while old files and old acceptance commands remain.

- [x] **Step 3: Delete obsolete Android entrypoints and publishers**

Remove only the listed BAT/PowerShell files. Preserve Android runtime/update tests and the unified release tests.

- [x] **Step 4: Update operator and design documentation**

Document the three interactive choices, unified `v1.x` local output, `.release-work`, committed Android signing inputs, Action caches, `stable.androidApk`, deploy ignoring Android, global Web metadata, full migration build cleanup, and staging cleanup. Remove timestamp Android tags and `~/.wheelmaker/mobile/android` output instructions.

- [x] **Step 5: Add a precise credential-scanner exception**

If Gitleaks flags the user-required committed signing properties, scope the allow rule to the exact `mobile/android/signing/signing.properties` fingerprint/path and the exact intended keys. Do not exclude `mobile/android/signing/**`, `.p12` globally, or the repository.

- [x] **Step 6: Run structural/security-script tests**

Run: `node --test scripts/release/entry.test.mjs scripts/release/android.test.mjs`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_android_release_signing.ps1`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_security_acceptance_ps1.ps1`

Expected: PASS.

- [x] **Step 7: Commit cleanup and documentation**

```powershell
git add -A
git commit -m "docs: finalize unified Android release workflow"
```

### Task 9: Run acceptance, inspect public metadata behavior, and push

**Files:**
- Modify: `docs/plans/2026-07-17-unified-android-release/plan-unified-android-release.md`

- [x] **Step 1: Run all release and deployment tests**

Run: `node --test scripts/release/*.test.mjs scripts/deploy/*.test.mjs`

Expected: PASS.

- [x] **Step 2: Run the full Web suite**

Run from `app`: `npm test -- --runInBand`

Expected: PASS with no open handles or snapshots changed unintentionally.

- [x] **Step 3: Run the full Go suite**

Run from `server`: `go test ./... -count=1`

Expected: PASS.

- [x] **Step 4: Run Android unit tests and signed build inspection**

Run from `mobile/android`: `gradle test`

Expected: PASS.

Run `apksigner verify --print-certs .release-out/<next-v1.x>/android/WheelMakerAndroid.apk` and compare its certificate digest, size, and SHA-256 with `android-release.json`.

Expected: exact match.

- [x] **Step 5: Run security acceptance**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security_acceptance.ps1`

Expected: all Web, Go, Android, npm audit, govulncheck, and Gitleaks gates pass with only the exact approved signing exception.

- [x] **Step 6: Verify clean scope and update plan checkboxes**

Run: `git status --short`

Expected: only the plan checkbox update remains after prior task commits; no `.release-out`, `.release-work`, Gradle, APK, or generated asset is accidentally untracked.

- [x] **Step 7: Execute the repository completion gate**

```powershell
git add -A
git commit -m "feat: unify Android release delivery"
git push origin feat/prebuilt-release-deployment
```

Expected: commit succeeds, push succeeds, and the branch is aligned with its upstream.
