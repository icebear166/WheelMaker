# Prebuilt Release Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-based WheelMaker deployment with a signed, prebuilt GitHub Release pipeline and a Node-only target-side installer/updater.

**Architecture:** Private-source release code builds and signs complete Hub+Web packages, then publishes immutable release assets and signed control files to a separate public repository. A small local Node launcher verifies `stable.json`, refreshes the public Git-maintained deployment core, and executes it; the core owns package application and current-user runtime registration.

**Tech Stack:** Node.js 22 standard library (`node:test`, `crypto`, `https`, `zlib`, `tar` parsing), Go cross compilation, GitHub REST API, GitHub App installation tokens, Ed25519, GitHub Actions, Windows Task Scheduler, launchd LaunchAgents, systemd user units.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `scripts/release.mjs` | Source-side CLI for local build and publish. |
| `scripts/release/*.mjs` | Build, package, signing, GitHub API and Desktop helpers; no target-side deployment logic. |
| `scripts/release/*.test.mjs` | Node unit tests for versions, signing payloads, manifests and publisher ordering. |
| `scripts/deploy/deploy.mjs` | Small target launcher copied to public repository by publisher. |
| `scripts/deploy/deploy-core.mjs` | Target deployment implementation copied to public repository by publisher. |
| `scripts/deploy/*.mjs` | Fetching, signature verification, archive extraction, state and platform adapters. |
| `scripts/deploy/*.test.mjs` | Node unit tests for target-side security and state transitions. |
| `.github/workflows/publish-release.yml` | Manual, single Ubuntu release fallback. |
| `server/cmd/wheelmaker/*` | Hub update API, job coordination and restart handoff. |
| `app/web/src/settings/*` | Update page status/trigger UI adapted to the new Hub protocol. |
| `deploy.bat`, `deploy.sh`, `update_exe.bat` | Legacy migration shims and Desktop updater. |

## Task 1: Establish source-side release configuration and deterministic metadata

**Files:**
- Create: `scripts/release/config.mjs`
- Create: `scripts/release/version.mjs`
- Create: `scripts/release/metadata.mjs`
- Create: `scripts/release/version.test.mjs`
- Create: `scripts/release/metadata.test.mjs`

- [ ] **Step 1: Write failing tests for versions and raw-byte signatures**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from './version.mjs';
import { encodeSignedJson, verifySignedJson } from './metadata.mjs';

test('nextVersion increments only v1.x', () => {
  assert.equal(nextVersion('v1.23'), 'v1.24');
  assert.throws(() => nextVersion('v2.0'), /v1\.x/);
});

test('signed JSON verifies its exact UTF-8 bytes', () => {
  const { jsonBytes, signature } = encodeSignedJson({ schema: 1, version: 'v1.1' }, testPrivateKey);
  assert.equal(verifySignedJson(jsonBytes, signature, testPublicKey), true);
  assert.equal(verifySignedJson(Buffer.concat([jsonBytes, Buffer.from(' ')]), signature, testPublicKey), false);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test scripts/release/version.test.mjs scripts/release/metadata.test.mjs`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement immutable metadata helpers**

Implement exact exports:

```js
export function nextVersion(current) { /* accept only /^v1\.(0|[1-9]\d*)$/ */ }
export function encodeSignedJson(value, privateKeyPem) { /* UTF-8 no BOM + final \n */ }
export function verifySignedJson(jsonBytes, base64Signature, publicKeyPem) { /* crypto.verify */ }
export function sha256File(path) { /* hex digest */ }
```

`config.mjs` must require `WHEELMAKER_RELEASE_OWNER`, `WHEELMAKER_RELEASE_REPO`, `WHEELMAKER_RELEASE_APP_ID`, `WHEELMAKER_RELEASE_INSTALLATION_ID`, and `WHEELMAKER_SIGNING_PRIVATE_KEY`; reject absent values before any network write.

- [ ] **Step 4: Re-run tests**

Run: `node --test scripts/release/version.test.mjs scripts/release/metadata.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/release
git commit -m "feat: add signed release metadata primitives"
```

## Task 2: Build the local release directory once per release

**Files:**
- Create: `scripts/release/build.mjs`
- Create: `scripts/release/package.mjs`
- Create: `scripts/release/build.test.mjs`
- Modify: `scripts/publish_desktop.ps1`

- [ ] **Step 1: Write failing build-plan tests**

```js
test('build plan builds Web once and emits exactly three Hub targets', () => {
  assert.deepEqual(makeBuildPlan({ withDesktop: false }).targets, [
    ['windows', 'amd64'], ['linux', 'amd64'], ['darwin', 'arm64']
  ]);
  assert.equal(makeBuildPlan({ withDesktop: false }).webBuilds, 1);
  assert.equal(makeBuildPlan({ withDesktop: true }).desktopTarget.join('/'), 'windows/amd64');
});

test('package layout contains hub and web but no deployment MJS', async () => {
  await packagePlatform(fixtureBuild, fixtureOutput, { os: 'windows', arch: 'amd64' });
  assert.equal(await exists(join(fixtureOutput, 'hub', 'wheelmaker.exe')), true);
  assert.equal(await exists(join(fixtureOutput, 'web', 'index.html')), true);
  assert.equal(await exists(join(fixtureOutput, 'mjs')), false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release/build.test.mjs`  
Expected: FAIL because build helpers are missing.

- [ ] **Step 3: Implement source build helpers**

Implement `build.mjs` to:

1. Run `npm ci` and `npm run build:web:release` once from `app`.
2. Run Go builds with `CGO_ENABLED=0` for `windows/amd64`, `linux/amd64`, and `darwin/arm64`.
3. Copy the single Web release directory into every platform directory.
4. On `withDesktop`, run `go run github.com/tc-hib/go-winres@v0.3.3 simply ...` and cross-build `./cmd/wheelmaker-desktop` with `GOOS=windows GOARCH=amd64`.

Refactor `publish_desktop.ps1` so its local shortcut creation remains available, but it delegates build-only work to the release helper or is replaced by a wrapper that does not duplicate the build algorithm. Do not run `New-DesktopShortcut` from CI.

- [ ] **Step 4: Implement packages and manifests**

`package.mjs` must create an output directory matching the design document and produce `.tar.gz` from that exact directory. It must calculate size and SHA-256 after archive creation, then create an unsigned in-memory manifest object with only the three platform assets.

- [ ] **Step 5: Re-run build tests**

Run: `node --test scripts/release/build.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/release scripts/publish_desktop.ps1
git commit -m "feat: build precompiled release packages"
```

## Task 3: Publish signed control files and immutable GitHub Releases

**Files:**
- Create: `scripts/release/github-app.mjs`
- Create: `scripts/release/publish.mjs`
- Create: `scripts/release/publish.test.mjs`
- Create: `scripts/release/status.mjs`

- [ ] **Step 1: Write failing publisher ordering tests**

```js
test('publisher writes stable only after a public release exists', async () => {
  const events = [];
  await publishRelease(fakeApi(events), fixtureRelease);
  assert.deepEqual(events, [
    'status:validating', 'status:building-web', 'status:building-runtime',
    'commit:deploy-mjs', 'release:create-draft', 'release:upload-assets',
    'release:publish', 'commit:stable', 'status:succeeded'
  ]);
});

test('a failed upload leaves stable untouched and writes a generic failed status', async () => {
  await assert.rejects(() => publishRelease(failingUploadApi, fixtureRelease));
  assert.equal(failingUploadApi.calls.includes('commit:stable'), false);
  assert.equal(failingUploadApi.lastStatus.state, 'failed');
  assert.equal('stack' in failingUploadApi.lastStatus, false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release/publish.test.mjs`  
Expected: FAIL because publisher modules are missing.

- [ ] **Step 3: Implement GitHub App and REST clients**

`github-app.mjs` creates a short-lived installation token from the App ID, installation ID and PEM. `publish.mjs` uses only REST endpoints for Contents, Releases and release asset upload; it must never shell out to `git` or `gh` for public repository operations.

Implement exactly these transitions:

- write status phases without sensitive details;
- commit `deploy.mjs` and `deploy-core.mjs` to the public repository and capture the resulting commit SHA;
- create a draft `v1.x` release, upload tarballs, manifest, manifest signature and optional EXE;
- mark the release public;
- write signed `stable.json`/`stable.json.sig` referring to the script commit and newly public manifest;
- on any exception, delete this round's draft if it was created and write `state: failed` with an error code.

On Release tag conflict, refetch stable and restart version allocation. On startup, delete only publisher-created draft releases older than two hours.

- [ ] **Step 4: Re-run publisher tests**

Run: `node --test scripts/release/publish.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/release
git commit -m "feat: publish signed GitHub release artifacts"
```

## Task 4: Expose the source-only release CLI and manual Action

**Files:**
- Create: `scripts/release.mjs`
- Create: `.github/workflows/publish-release.yml`
- Create: `scripts/release/cli.test.mjs`

- [ ] **Step 1: Write CLI and workflow source tests**

```js
test('build mode never creates a GitHub client', async () => {
  const result = await runReleaseCli(['build'], fakeDeps);
  assert.equal(result.published, false);
  assert.equal(fakeDeps.githubClientCalls, 0);
});

test('publish accepts only an explicit desktop boolean', () => {
  assert.deepEqual(parseArgs(['publish', '--with-desktop']), { mode: 'publish', withDesktop: true });
  assert.throws(() => parseArgs(['publish', '--desktop-exe', 'C:\\x.exe']), /unknown option/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release/cli.test.mjs`  
Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement source CLI**

Support only:

```text
node scripts/release.mjs build [--with-desktop]
node scripts/release.mjs publish [--with-desktop]
```

`build` writes the exact platform directory layout to `out/release/<source-sha>/`; `publish` requires a clean local worktree, invokes build/package/sign/publish, and does not permit a path argument for Desktop.

- [ ] **Step 4: Add manual single-job workflow**

Create `workflow_dispatch` inputs `ref` (required) and `with_desktop` (boolean, default false). The workflow must:

1. checkout only `ref` with `fetch-depth: 1`;
2. use Node 22 and Go 1.26;
3. enable npm cache using `app/package-lock.json` and Go cache using `server/go.sum`;
4. run `node scripts/release.mjs publish`, adding `--with-desktop` only when input is true;
5. obtain App and signing secrets only from GitHub Actions secrets;
6. use one Ubuntu job and no Actions artifact handoff.

- [ ] **Step 5: Re-run CLI tests and validate workflow syntax**

Run: `node --test scripts/release/cli.test.mjs`  
Expected: PASS.

Run: `git diff --check`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/release.mjs scripts/release .github/workflows/publish-release.yml
git commit -m "feat: add manual prebuilt release workflow"
```

## Task 5: Implement the signed deployment launcher and core primitives

**Files:**
- Create: `scripts/deploy/deploy.mjs`
- Create: `scripts/deploy/deploy-core.mjs`
- Create: `scripts/deploy/verify.mjs`
- Create: `scripts/deploy/http.mjs`
- Create: `scripts/deploy/state.mjs`
- Create: `scripts/deploy/verify.test.mjs`
- Create: `scripts/deploy/state.test.mjs`

- [ ] **Step 1: Write failing trust-chain and state tests**

```js
test('launcher rejects a stable file with an invalid Ed25519 signature', async () => {
  await assert.rejects(() => loadStable(tamperedStable, publicKey), /signature/);
});

test('launcher stages a newer core but runs the verified current core', async () => {
  const events = await runLauncher({ stable: newerCoreStable, files: fixtureFiles });
  assert.deepEqual(events, ['verify-stable', 'stage-launcher', 'stage-core', 'run-current-core']);
});

test('only one queued or running update lease can exist', async () => {
  assert.equal(await acquireLease(stateDir, 'job-a'), true);
  assert.equal(await acquireLease(stateDir, 'job-b'), false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/verify.test.mjs scripts/deploy/state.test.mjs`  
Expected: FAIL because target deployment modules are missing.

- [ ] **Step 3: Implement trust primitives and minimal launcher**

Embed only the Ed25519 public key and fixed stable URL in `deploy.mjs`. It must fetch raw bytes, verify `stable.json.sig`, verify SHA-256 for script downloads, stage replacement scripts with same-directory temporary files, and invoke the installed core. It must not install services or unpack product assets.

`verify.mjs` must expose `verifyEd25519`, `sha256Bytes`, `downloadToFileWithSha256`, and reject redirects to non-HTTPS hosts after the initial GitHub URL.

- [ ] **Step 4: Implement atomic state lease and status writes**

`state.mjs` creates `staging/lock.json` with exclusive file creation, writes `status.json` through rename, tracks heartbeat, and only reclaims an expired lease after the platform adapter reports the updater task not running. Terminal completion removes `lock.json` but keeps `status.json`.

- [ ] **Step 5: Re-run tests**

Run: `node --test scripts/deploy/verify.test.mjs scripts/deploy/state.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/deploy
git commit -m "feat: add signed deployment launcher"
```

## Task 6: Apply prebuilt packages securely without changing runtime registration

**Files:**
- Create: `scripts/deploy/archive.mjs`
- Create: `scripts/deploy/install.mjs`
- Create: `scripts/deploy/archive.test.mjs`
- Create: `scripts/deploy/install.test.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`

- [ ] **Step 1: Write failing extractor and update-mode tests**

```js
test('extractor rejects path traversal and links', async () => {
  for (const archive of [traversalTar, symlinkTar, absolutePathTar]) {
    await assert.rejects(() => extractVerifiedTarGz(archive, target), /unsafe archive entry/);
  }
});

test('internal update never calls runtime registration', async () => {
  const events = await runCore(['update'], fakePlatform);
  assert.equal(events.includes('install-runtime'), false);
  assert.equal(events.includes('remove-runtime'), false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/archive.test.mjs scripts/deploy/install.test.mjs`  
Expected: FAIL because extractor and installer do not exist.

- [ ] **Step 3: Implement archive validation and package application**

The extractor must reject absolute paths, `..`, symlinks, hardlinks, unknown tar types, files above the configured per-file limit, more than the configured entry limit, and cumulative uncompressed size above the configured total limit. Extract only after the tar.gz SHA-256 matches the signed manifest.

The installer must download into `~/.wheelmaker/staging/<job-id>/`, request Hub shutdown through the authenticated local control endpoint, replace `~/.wheelmaker/app/`, then trigger the already-registered Hub runtime. It must set `failed` status on any error and perform no automatic restore.

- [ ] **Step 4: Implement core commands**

`deploy-core.mjs` accepts `migrate-uninstall`, implicit normal deploy, and internal `update`. Normal deploy installs/repairs current-user runtime registration after applying assets. Internal update only applies assets and restarts the existing runtime. No public schedule/history/status/install command is parsed.

- [ ] **Step 5: Re-run tests**

Run: `node --test scripts/deploy/archive.test.mjs scripts/deploy/install.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/deploy
git commit -m "feat: apply verified prebuilt packages"
```

## Task 7: Add current-user platform runtime adapters and legacy cleanup

**Files:**
- Create: `scripts/deploy/platform/windows.mjs`
- Create: `scripts/deploy/platform/darwin.mjs`
- Create: `scripts/deploy/platform/linux.mjs`
- Create: `scripts/deploy/platform/index.mjs`
- Create: `scripts/deploy/platform/platform.test.mjs`
- Modify: `deploy.bat`
- Modify: `deploy.sh`
- Delete: `server/cmd/wheelmaker-deploy/`
- Delete: `server/cmd/wheelmaker-updater/`

- [ ] **Step 1: Write failing registration content tests**

```js
test('Windows registration creates current-user WheelMaker tasks', () => {
  const commands = windowsRegistrationCommands(fixture);
  assert.match(commands.join('\n'), /WheelMakerUpdater/);
  assert.match(commands.join('\n'), /03:00/);
  assert.doesNotMatch(commands.join('\n'), /sc\.exe create/);
});

test('Linux registration writes a user hub service and updater timer', () => {
  const files = linuxUnitFiles(fixture);
  assert.match(files['wheelmaker-hub.service'], /Restart=always/);
  assert.match(files['wheelmaker-updater.timer'], /OnCalendar=\*-\*-\* 03:00:00/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/platform/platform.test.mjs`  
Expected: FAIL because platform adapters are absent.

- [ ] **Step 3: Implement new current-user registrations**

Implement exactly the identifiers from the design: Windows `WheelMaker` / `WheelMakerUpdater` tasks; macOS `com.wheelmaker.hub` / `com.wheelmaker.updater` LaunchAgents; Linux `wheelmaker-hub.service` and `wheelmaker-updater.service` + `.timer`. The updater registration invokes `node ~/.wheelmaker/deploy.mjs update`; the Hub registration invokes the installed Hub binary.

- [ ] **Step 4: Implement `migrate-uninstall` only**

Each platform adapter removes legacy Hub/monitor/updater registrations and binaries while preserving `config.json`, persistent data and logs. Windows legacy service removal uses elevation only in this command. The normal deploy path must not inspect legacy registration names.

`deploy.bat` and `deploy.sh` become compatibility launchers that copy source `deploy.mjs` into `~/.wheelmaker/` and execute `migrate-uninstall`; they must not compile Go or call refresh scripts.

- [ ] **Step 5: Remove obsolete Go deployment/updater code and adjust source tests**

Delete `server/cmd/wheelmaker-deploy` and `server/cmd/wheelmaker-updater`; update or delete their dedicated tests. Remove obsolete wrappers and signal tests that assert `update-now.signal` behavior. Preserve unrelated Hub tests.

- [ ] **Step 6: Re-run platform and wrapper tests**

Run: `node --test scripts/deploy/platform/platform.test.mjs`  
Expected: PASS.

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_bat.ps1`  
Expected: PASS with the new migration launcher assertions.

- [ ] **Step 7: Commit**

```powershell
git add deploy.bat deploy.sh scripts/deploy scripts/test_deploy_bat.ps1 scripts/test_deploy_sh.ps1
git rm -r server/cmd/wheelmaker-deploy server/cmd/wheelmaker-updater
git commit -m "feat: replace legacy runtime services with user deployment tasks"
```

## Task 8: Move Hub update triggering to job-based deployment state

**Files:**
- Modify: `server/cmd/wheelmaker/main.go`
- Modify: `server/cmd/wheelmaker/daemon.go`
- Create: `server/cmd/wheelmaker/update_job.go`
- Create: `server/cmd/wheelmaker/update_job_test.go`
- Modify: existing Hub command/registry files found by `rg -n "cmd.update" server`
- Delete: `update-publish.bat`
- Delete: `update-publish.sh`
- Delete: `scripts/test_update_publish_bat.ps1`
- Delete: `scripts/test_update_publish_sh.ps1`

- [ ] **Step 1: Write failing Hub protocol tests**

```go
func TestRequestUpdateCreatesOneQueuedJobAndTriggersUpdater(t *testing.T) {
    jobs := newTestUpdateJobs(t)
    first, err := jobs.Request(context.Background())
    if err != nil { t.Fatal(err) }
    second, err := jobs.Request(context.Background())
    if err != nil { t.Fatal(err) }
    if first.JobID != second.JobID || jobs.TriggerCalls != 1 { t.Fatalf("first=%+v second=%+v", first, second) }
}

func TestUpdateQueryReturnsPersistedTerminalStatus(t *testing.T) {
    jobs := newTestUpdateJobs(t)
    jobs.WriteStatus("succeeded")
    got, err := jobs.Query(context.Background())
    if err != nil || got.State != "succeeded" { t.Fatalf("got=%+v err=%v", got, err) }
}
```

- [ ] **Step 2: Run and verify failure**

Run from `server`: `go test ./cmd/wheelmaker -run Update`  
Expected: FAIL because job API does not exist.

- [ ] **Step 3: Implement the constrained Hub update protocol**

Replace signal-file writes and Git comparisons with a `cmd.update` action set containing only `query` and `request`. `request` atomically creates `~/.wheelmaker/staging/lock.json` with `queued` status, starts the already registered updater task through a platform-specific known command, and returns `{ accepted: true, jobId }`. Existing lock returns its job/status without another trigger. `query` reads `status.json`; it never shells out to Git.

Implement a separate local authenticated `prepare-update` control action used only by deployment core to make Hub exit cleanly after the Web request already returned.

- [ ] **Step 4: Re-run Hub tests**

Run from `server`: `go test ./cmd/wheelmaker -run Update`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/cmd/wheelmaker update-publish.bat update-publish.sh scripts/test_update_publish_bat.ps1 scripts/test_update_publish_sh.ps1
git commit -m "feat: trigger deployment updates through persisted jobs"
```

## Task 9: Update the Web release and update-status UI

**Files:**
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx`
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Create: `app/web/src/settings/wheelmakerReleaseUpdate.ts`
- Create: `app/web/src/settings/wheelmakerReleaseUpdate.test.ts`
- Modify: `app/web/src/shell/AppDialogs.tsx`

- [ ] **Step 1: Write failing UI model tests**

```ts
it('renders one accepted deployment job without treating it as complete', () => {
  expect(toReleaseUpdateView({ accepted: true, jobId: 'job-1', state: 'queued' })).toEqual({
    label: 'Queued', canTrigger: false, jobId: 'job-1'
  });
});

it('renders a terminal failed update without source or Git details', () => {
  expect(toReleaseUpdateView({ state: 'failed', errorCode: 'download_failed' }).detail)
    .toBe('download_failed');
});
```

- [ ] **Step 2: Run and verify failure**

Run from `app`: `npm test -- wheelmakerReleaseUpdate.test.ts --runInBand`  
Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement UI protocol migration**

Use Hub `cmd.update.query` to display persisted update state and `cmd.update.request` for the button. Remove UI text that claims a Hub will pull source, build Web or compare Git history. Poll only while a job is queued/running; show the returned `jobId`, terminal success, or generic failure code.

- [ ] **Step 4: Re-run UI tests and typecheck**

Run from `app`:

```powershell
npm test -- wheelmakerReleaseUpdate.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/web/src/settings app/web/src/shell/AppDialogs.tsx
git commit -m "feat: show prebuilt deployment update jobs"
```

## Task 10: Add independent Desktop EXE update behavior

**Files:**
- Create: `update_exe.bat`
- Create: `scripts/update_exe.ps1`
- Create: `scripts/test_update_exe_ps1.ps1`

- [ ] **Step 1: Write failing source checks**

```powershell
Assert-Contains -Label 'update_exe.ps1' -Text $script -Needle 'desktopExe'
Assert-Contains -Label 'update_exe.ps1' -Text $script -Needle 'WheelMakerDesktop.exe'
Assert-Contains -Label 'update_exe.ps1' -Text $script -Needle 'Get-Process'
Assert-NotContains -Label 'update_exe.ps1' -Text $script -Needle 'Start-Sleep'
```

- [ ] **Step 2: Run and verify failure**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_update_exe_ps1.ps1`  
Expected: FAIL because updater scripts do not exist.

- [ ] **Step 3: Implement Desktop updater**

`update_exe.bat` calls `scripts/update_exe.ps1`. The PowerShell script fetches and verifies signed stable, reads `desktopExe`, verifies EXE SHA-256 before replacing the installed file, and exits with an actionable message when `WheelMakerDesktop.exe` is running. It must not start a background replacement process and must not require a Desktop path parameter.

- [ ] **Step 4: Re-run source checks**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_update_exe_ps1.ps1`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add update_exe.bat scripts/update_exe.ps1 scripts/test_update_exe_ps1.ps1
git commit -m "feat: update optional desktop executable from stable"
```

## Task 11: Documentation, removal audit, and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-16-prebuilt-release-deployment-design.md` only for implementation-discovered corrections
- Modify/Delete: old deployment/updater documentation and tests identified by `rg -n "wheelmaker-deploy|wheelmaker-updater|update-now.signal|full-update"`

- [ ] **Step 1: Update operator documentation**

Document Node 22+ as the only target prerequisite, the two public deploy commands, one-time migration sequence, fixed daily 03:00 behavior, Web-triggered update semantics, and `update_exe.bat` requiring Desktop to be closed. Document publishing as a source-repository-only operation and list GitHub App/signing secret names without placing secret values in the repository.

- [ ] **Step 2: Run targeted tests**

```powershell
node --test scripts/release/*.test.mjs scripts/deploy/*.test.mjs scripts/deploy/platform/*.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_bat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_sh.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_update_exe_ps1.ps1
Push-Location server; go test ./cmd/wheelmaker; Pop-Location
Push-Location app; npm test -- wheelmakerReleaseUpdate.test.ts --runInBand; npm run tsc:web; Pop-Location
```

Expected: all PASS.

- [ ] **Step 3: Run build and cross-platform verification**

```powershell
node scripts/release.mjs build
Get-ChildItem out/release/*/windows-amd64/hub/wheelmaker.exe
Get-ChildItem out/release/*/linux-amd64/hub/wheelmaker
Get-ChildItem out/release/*/darwin-arm64/hub/wheelmaker
```

Expected: one local release directory containing all three target layouts and each Web tree.

- [ ] **Step 4: Run clean-tree and documentation checks**

```powershell
git diff --check
rg -n "update-now\.signal|wheelmaker-deploy bootstrap-update|wheelmaker-updater" README.md INSTALL.md CLAUDE.md docs scripts deploy.bat deploy.sh
```

Expected: no active-install documentation or scripts retain obsolete signal/updater behavior; historical design documents may contain it only when clearly marked superseded.

- [ ] **Step 5: Commit and push**

```powershell
git add -A
git commit -m "feat: ship signed prebuilt release deployment"
git push origin main
```

Expected: commit and push succeed.

## Self-review

Spec coverage:

- Private source/public artifact split, GitHub App and Ed25519 trust: Tasks 1 and 3.
- Local-only build, v1.x allocation, three complete packages and optional Desktop: Tasks 1–4.
- Single Ubuntu Action, one Web build and dependency caching: Task 4.
- Self-updating launcher, public Git core and signed manifest/archive extraction: Tasks 5–6.
- Current-user scheduled runtime, no-admin update and one-time legacy cleanup: Task 7.
- Hub/Web accepted job flow, lock/status distinction and no Git queries: Tasks 8–9.
- Independent carried-forward Desktop EXE pointer and closed-process update: Task 10.
- Documentation and complete verification: Task 11.

The plan intentionally makes no automatic rollback, version rollback UI, source deployment compatibility during normal deploy, Android migration, macOS amd64 package, or persistent publisher lock.
