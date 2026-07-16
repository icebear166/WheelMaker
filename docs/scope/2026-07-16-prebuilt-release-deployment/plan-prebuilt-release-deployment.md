# WheelMaker Prebuilt Release Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-based deployment with signed prebuilt Hub + Web releases, a Node 22 deployment launcher/core, current-user runtime registration, and version-aware Hub/App update status.

**Architecture:** The private source repository owns build, signing, publishing, and deployment MJS sources. A source-side publisher produces three complete platform archives, copies the two deployment MJS files to a public `swm8023/wheelmaker-releases` repository, publishes immutable Release assets, and updates signed `stable.json` last. Target machines keep the existing `~/.wheelmaker/bin`, `web`, and `desktop` layout; `deploy.mjs` verifies and refreshes `deploy-core.mjs`, while the core owns extraction, runtime registration, migration, locking, and release metadata.

**Tech Stack:** Node.js 22 standard library and `node:test`, Go 1.26, React/TypeScript/Jest, GitHub REST API, GitHub Actions, Ed25519, Windows Task Scheduler, macOS LaunchAgents, Linux systemd user units.

---

## Execution order and compatibility

Tasks 1–4 build the release side without changing installed machines. Tasks 5–8 add the new deployment path while the old Go deploy/updater still exists. Tasks 9–10 move Hub/App update behavior to the new release model. Task 11 performs the one-time compatibility cutover and removes obsolete Go programs only after the replacement path is tested. Task 12 closes Desktop and documentation gaps and runs the full acceptance suite.

No task changes the Registry protocol version. The existing `cmd.update` method remains allowlisted; only its constrained payload and response fields change.

## File structure

| Path | Responsibility |
| --- | --- |
| `scripts/release.mjs` | Source-only `build` / `publish` CLI. |
| `scripts/release/*.mjs` | Versioning, deterministic JSON, signing, build, tar writing, GitHub App and publisher modules. |
| `scripts/release/*.test.mjs` | Source-side Node tests. |
| `scripts/release/channel.json` | Non-secret public release repository/channel configuration. |
| `scripts/release/release-public-key.pem` | Committed Ed25519 public key; private key stays outside the repository. |
| `scripts/deploy/deploy.mjs` | Small launcher copied to the public repository. |
| `scripts/deploy/deploy-core.mjs` | Cached target-side deployment core copied to the public repository. |
| `scripts/deploy/*.test.mjs` | Launcher/core security, archive, state and platform tests. |
| `.github/workflows/publish-release.yml` | Manual single-Ubuntu-job release fallback. |
| `server/internal/hub/tools/update.go` | Installed/stable version query and queued update job protocol. |
| `app/web/src/settings/agentPackageUpdateView.ts` | WheelMaker release/job presentation helpers. |
| `deploy.bat`, `deploy.sh` | Old-source migration entrypoints. |
| `update_exe.bat` | User-facing Desktop updater wrapper. |

## Task 1: Lock release schemas, channel configuration, and signing primitives

**Files:**
- Create: `scripts/release/channel.json`
- Create: `scripts/release/metadata.mjs`
- Create: `scripts/release/metadata.test.mjs`
- Create: `scripts/release/generate-signing-key.mjs`
- Create at setup time: `scripts/release/release-public-key.pem`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing tests for the version and exact-byte signature contracts**

Create `scripts/release/metadata.test.mjs` with test-only Ed25519 keys generated in memory:

```js
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  encodeJsonBytes,
  nextV1Version,
  sha256Bytes,
  signBytes,
  verifyBytes,
} from './metadata.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

test('nextV1Version increments only v1.x', () => {
  assert.equal(nextV1Version('v1.0'), 'v1.1');
  assert.equal(nextV1Version('v1.29'), 'v1.30');
  assert.throws(() => nextV1Version('v2.0'), /expected v1\.x/);
});

test('JSON signature covers exact UTF-8 bytes', () => {
  const bytes = encodeJsonBytes({ schema: 1, version: 'v1.1' });
  const signature = signBytes(bytes, privateKey);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(verifyBytes(bytes, signature, publicKey), true);
  assert.equal(verifyBytes(Buffer.concat([bytes, Buffer.from(' ')]), signature, publicKey), false);
  assert.equal(sha256Bytes(bytes).length, 64);
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
node --test scripts/release/metadata.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `metadata.mjs`.

- [ ] **Step 3: Implement deterministic metadata helpers and channel configuration**

Create `scripts/release/channel.json`:

```json
{
  "owner": "swm8023",
  "repository": "wheelmaker-releases",
  "branch": "main",
  "stablePath": "stable.json",
  "publishStatusPath": "publish-status.json"
}
```

Create `metadata.mjs` with these exact exports and behavior:

```js
import { createHash, sign, verify } from 'node:crypto';

export function nextV1Version(current) {
  const match = /^v1\.(0|[1-9]\d*)$/.exec(current);
  if (!match) throw new Error(`expected v1.x version, received ${current}`);
  return `v1.${Number(match[1]) + 1}`;
}

export function encodeJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function signBytes(bytes, privateKey) {
  return sign(null, bytes, privateKey).toString('base64');
}

export function verifyBytes(bytes, base64Signature, publicKey) {
  return verify(null, bytes, publicKey, Buffer.from(base64Signature, 'base64'));
}
```

Add `.release-out/` and `.wheelmaker-release-secrets/` to `.gitignore`.

- [ ] **Step 4: Add a safe one-time key generator**

`generate-signing-key.mjs` must use `generateKeyPairSync('ed25519')`, write the private PKCS#8 PEM to `~/.wheelmaker/release-secrets/signing-private.pem` with mode `0600`, and write only the public SPKI PEM to `scripts/release/release-public-key.pem`. Refuse to overwrite either file unless `--force` is explicitly passed. Print the GitHub secret name `WHEELMAKER_SIGNING_PRIVATE_KEY` but never print private key contents.

- [ ] **Step 5: Run tests and secret-source checks**

Run:

```powershell
node --test scripts/release/metadata.test.mjs
rg -n "BEGIN PRIVATE KEY" . --glob '!**/dist/**' --glob '!docs/**'
```

Expected: Node tests PASS; `rg` finds no committed private key.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore scripts/release
git commit -m "feat: define signed release metadata"
```

## Task 2: Build identical local and publishable platform directories

**Files:**
- Create: `scripts/release/commands.mjs`
- Create: `scripts/release/build.mjs`
- Create: `scripts/release/tar.mjs`
- Create: `scripts/release/build.test.mjs`
- Create: `scripts/release/tar.test.mjs`
- Modify: `scripts/publish_desktop.ps1`
- Modify: `scripts/test_publish_desktop_ps1.ps1`

- [ ] **Step 1: Write failing build-plan and layout tests**

Create tests that inject a recording command runner instead of running Go/npm:

```js
test('release build compiles Web once and exactly three Hub targets', async () => {
  const runner = recordingRunner();
  await buildRelease({ repoRoot, outputRoot, version: 'v1.7', withDesktop: false, runner });
  assert.equal(runner.count('npm', ['run', 'build:web:release']), 1);
  assert.deepEqual(runner.goTargets(), [
    'windows/amd64:wheelmaker.exe',
    'linux/amd64:wheelmaker',
    'darwin/arm64:wheelmaker',
  ]);
});

test('platform directory preserves hub and web package layout', async () => {
  const root = await buildFixturePackage('windows-amd64');
  assert.equal(await exists(join(root, 'hub', 'wheelmaker.exe')), true);
  assert.equal(await exists(join(root, 'web', 'index.html')), true);
  assert.equal(await exists(join(root, 'deploy-core.mjs')), false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
node --test scripts/release/build.test.mjs scripts/release/tar.test.mjs
```

Expected: FAIL because the build and tar modules do not exist.

- [ ] **Step 3: Implement a Windows-safe command runner and one-time Web build**

`commands.mjs` must use `spawn` with `shell: false`, `.cmd` resolution on Windows, explicit `cwd`, and an environment object. `build.mjs` must run:

```text
cwd=app    npm ci --include=dev
cwd=app    npm run build:web:release
```

Set `WHEELMAKER_WEB_TARGET` to `.release-out/<version>/web-source` so the release build never overwrites the installed `~/.wheelmaker/web`. Copy that one Web directory into all three platform directories.

- [ ] **Step 4: Implement Go cross-builds and optional Desktop build**

For each Hub build call `go build -trimpath -o <output> ./cmd/wheelmaker` from `server` with:

```js
const targets = [
  { key: 'windows-amd64', GOOS: 'windows', GOARCH: 'amd64', binary: 'wheelmaker.exe' },
  { key: 'linux-amd64', GOOS: 'linux', GOARCH: 'amd64', binary: 'wheelmaker' },
  { key: 'darwin-arm64', GOOS: 'darwin', GOARCH: 'arm64', binary: 'wheelmaker' },
];
```

Always set `CGO_ENABLED=0`. When `withDesktop` is true, run `go-winres` against `server/cmd/wheelmaker-desktop/winres/icon.png`, then build `./cmd/wheelmaker-desktop` with `GOOS=windows`, `GOARCH=amd64`, `CGO_ENABLED=0`, and `-ldflags=-H windowsgui`. The output path is fixed by the builder; there is no EXE path CLI option.

- [ ] **Step 5: Implement deterministic `.tar.gz` writing without a system tar dependency**

`tar.mjs` must write POSIX ustar headers, normalized `/` paths, file/dir entries only, fixed uid/gid, and gzip through `node:zlib`. Sort entries lexicographically. Test that traversal-like source names are rejected and export a test-only `listTarEntries` reader so Task 2 can prove its own archive entries without depending on the later target extractor. Task 6 adds the cross-contract extraction test.

- [ ] **Step 6: Keep local Desktop shortcut behavior separate**

Refactor `publish_desktop.ps1` to invoke `node scripts/release.mjs build --with-desktop`, copy the generated EXE to `~/.wheelmaker/desktop/WheelMakerDesktop.exe`, and create the shortcut. Update its source test to assert the Node build call and absence of duplicated `go build` / `go-winres` commands.

- [ ] **Step 7: Run Node and PowerShell tests**

```powershell
node --test scripts/release/build.test.mjs scripts/release/tar.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_publish_desktop_ps1.ps1
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/release scripts/publish_desktop.ps1 scripts/test_publish_desktop_ps1.ps1
git commit -m "feat: build precompiled platform packages"
```

## Task 3: Publish through GitHub App with stable written last

**Files:**
- Create: `scripts/release/github-app.mjs`
- Create: `scripts/release/github-api.mjs`
- Create: `scripts/release/publish.mjs`
- Create: `scripts/release/publish.test.mjs`
- Modify: `scripts/release/metadata.mjs`

- [ ] **Step 1: Write failing publisher-order and Desktop-pointer tests**

```js
test('stable is committed only after the release is public', async () => {
  const api = fakeGitHubApi();
  await publishBuiltRelease(fixtureRelease(), api);
  assert.deepEqual(api.events, [
    'status:validating',
    'scripts:commit',
    'release:create-draft',
    'release:upload',
    'release:publish',
    'stable:commit',
    'status:succeeded',
  ]);
});

test('release without Desktop carries the previous Desktop pointer forward', async () => {
  const next = makeStable({ previous: stableWithDesktopV12, release: releaseV13WithoutDesktop });
  assert.equal(next.desktopExe.version, 'v1.12');
});

test('first public release starts at v1.1 without a Desktop pointer', () => {
  const next = makeStable({ previous: null, release: firstReleaseWithoutDesktop });
  assert.equal(next.version, 'v1.1');
  assert.equal('desktopExe' in next, false);
});

test('failed upload never writes stable and exposes only an error code', async () => {
  const api = fakeGitHubApi({ failAt: 'release:upload' });
  await assert.rejects(() => publishBuiltRelease(fixtureRelease(), api));
  assert.equal(api.events.includes('stable:commit'), false);
  assert.deepEqual(api.lastStatus, { state: 'failed', phase: 'uploading', errorCode: 'asset_upload_failed' });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/release/publish.test.mjs`  
Expected: FAIL because publisher modules are missing.

- [ ] **Step 3: Implement GitHub App authentication**

`github-app.mjs` reads `WHEELMAKER_RELEASE_APP_ID`, `WHEELMAKER_RELEASE_INSTALLATION_ID`, and `WHEELMAKER_RELEASE_APP_PRIVATE_KEY`. Build an RS256 App JWT with a 9-minute expiry, request `POST /app/installations/{installation_id}/access_tokens`, and retain the installation token only in memory. Never log request headers or key contents.

- [ ] **Step 4: Implement the REST client and immutable script commit**

`github-api.mjs` must support Contents GET/PUT, Git blobs/trees/commits/ref updates, Releases create/update/delete/list, and release asset upload. `publish.mjs` reads the current signed stable, computes `nextV1Version`, commits the exact source bytes of `deploy.mjs` plus `deploy-core.mjs` in one public repository tree/commit operation, and records that commit SHA for `deploy.mjsUrl` and `coreUrl`. If stable does not exist, allocate `v1.1` and omit `desktopExe` until an EXE is actually published.

- [ ] **Step 5: Implement manifest, status, Release, and stable ordering**

Write status phases exactly as defined by the design. Upload three tarballs, `release-manifest.json`, `release-manifest.json.sig`, and optional `WheelMakerDesktop.exe`. Publish the draft Release before committing `stable.json` and `stable.json.sig`. Treat tag collision as a version-allocation retry after refetching stable. Delete this round's draft on failure and delete only matching drafts older than two hours at the start of a new publish.

- [ ] **Step 6: Run publisher tests**

Run: `node --test scripts/release/publish.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/release
git commit -m "feat: publish signed public releases"
```

## Task 4: Add the source-only CLI and single-job manual Action

**Files:**
- Create: `scripts/release.mjs`
- Create: `scripts/release/cli.mjs`
- Create: `scripts/release/cli.test.mjs`
- Create: `.github/workflows/publish-release.yml`

- [ ] **Step 1: Write failing CLI parsing tests**

```js
test('CLI exposes only build and publish with optional Desktop build', () => {
  assert.deepEqual(parseReleaseArgs(['build']), { mode: 'build', withDesktop: false });
  assert.deepEqual(parseReleaseArgs(['publish', '--with-desktop']), { mode: 'publish', withDesktop: true });
  assert.throws(() => parseReleaseArgs(['publish', '--desktop-exe', 'x.exe']), /unknown option/);
});

test('build mode never constructs a GitHub client', async () => {
  const deps = fakeCliDeps();
  await runRelease({ mode: 'build', withDesktop: false }, deps);
  assert.equal(deps.githubClientCalls, 0);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/release/cli.test.mjs`  
Expected: FAIL because CLI modules are absent.

- [ ] **Step 3: Implement local Windows-first CLI behavior**

Support exactly:

```text
node scripts/release.mjs build [--with-desktop]
node scripts/release.mjs publish [--with-desktop]
```

`build` resolves source SHA, writes `.release-out/local-<short-sha>/`, and performs no network write. `publish` requires a clean worktree, uses full `HEAD` SHA, loads the signing private key from `WHEELMAKER_SIGNING_PRIVATE_KEY` or `~/.wheelmaker/release-secrets/signing-private.pem`, then invokes Task 3. Do not use bash, `tar`, `gh`, or public-repository Git commands.

- [ ] **Step 4: Add a manually triggered one-job workflow**

Create `publish-release.yml` with required `ref` and boolean `with_desktop` inputs. Use `ubuntu-latest`, `actions/checkout@v4` with that ref and `fetch-depth: 1`, `actions/setup-node@v4` with Node 22 and npm cache keyed by `app/package-lock.json`, and `actions/setup-go@v5` with Go 1.26 and cache keyed by `server/go.sum`. Run one `node scripts/release.mjs publish` step and append `--with-desktop` only when selected. Do not use a matrix or Actions artifact handoff.

- [ ] **Step 5: Run CLI tests and inspect workflow invariants**

```powershell
node --test scripts/release/cli.test.mjs
rg -n "workflow_dispatch|ubuntu-latest|cache-dependency-path|with_desktop" .github/workflows/publish-release.yml
rg -n "matrix:|upload-artifact|download-artifact" .github/workflows/publish-release.yml
```

Expected: tests PASS; first `rg` finds required entries; second `rg` returns no matches.

- [ ] **Step 6: Commit**

```powershell
git add scripts/release.mjs scripts/release .github/workflows/publish-release.yml
git commit -m "feat: add manual release entrypoints"
```

## Task 5: Implement the small self-updating deployment launcher

**Files:**
- Create: `scripts/deploy/deploy.mjs`
- Create: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/release/publish.mjs`
- Modify: `scripts/release/publish.test.mjs`

- [ ] **Step 1: Write failing launcher trust-chain tests**

```js
test('launcher rejects tampered stable bytes before reading URLs', async () => {
  const deps = launcherFixture({ tamperStable: true });
  await assert.rejects(() => runLauncher([], deps), /stable signature verification failed/);
  assert.equal(deps.downloadedCore, false);
});

test('launcher refreshes changed core and runs it in the current invocation', async () => {
  const deps = launcherFixture({ localCoreSha: 'old', stableCoreSha: 'new' });
  await runLauncher(['update'], deps);
  assert.deepEqual(deps.events, ['verify-stable', 'stage-launcher', 'replace-core', 'run-core:update']);
});

test('launcher self-update becomes active on the next invocation', async () => {
  const deps = launcherFixture({ localLauncherSha: 'old', stableLauncherSha: 'new' });
  await runLauncher([], deps);
  assert.equal(deps.files.has('deploy.next.mjs'), true);
  assert.equal(deps.currentLauncherReplaced, false);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/deploy.test.mjs`  
Expected: FAIL because launcher code is missing.

- [ ] **Step 3: Implement launcher-only responsibilities**

`deploy.mjs` must contain the exact public key from `scripts/release/release-public-key.pem` and the stable URL `https://raw.githubusercontent.com/swm8023/wheelmaker-releases/main/stable.json` as source constants, plus HTTPS fetch with redirect validation, raw-byte Ed25519 verification, SHA-256, same-directory temporary writes, next-run launcher promotion, core replacement, and dynamic import of local `deploy-core.mjs`. It must not parse tar, install files, or register runtime tasks. Because the checked-in source is already runnable, legacy `deploy.bat`/`deploy.sh` can copy it directly before the first public download.

Its public parser passes only no command, `migrate-uninstall`, or internal `update`/runtime/Desktop actions through to core. Unknown arguments fail before any installation mutation.

- [ ] **Step 4: Prove public copy is byte-identical to the trusted source**

The publisher must upload `scripts/deploy/deploy.mjs` and `deploy-core.mjs` without templating or substitution. Add a test that compares the uploaded bytes with source bytes, verifies the launcher's embedded PEM equals `scripts/release/release-public-key.pem`, verifies its stable URL matches `channel.json`, and confirms the source-file hashes are the hashes written into stable.

- [ ] **Step 5: Run launcher and publisher tests**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/release/publish.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/deploy scripts/release
git commit -m "feat: add verified deployment launcher"
```

## Task 6: Implement secure archive extraction and staging state

**Files:**
- Create: `scripts/deploy/deploy-core.mjs`
- Create: `scripts/deploy/deploy-core.test.mjs`
- Create: `scripts/deploy/archive-fixtures.test.mjs`

- [ ] **Step 1: Write failing malicious archive and lease tests**

```js
test('extractor rejects traversal, absolute paths, and links', async () => {
  for (const fixture of [traversalTarGz, absoluteTarGz, symlinkTarGz, hardlinkTarGz]) {
    await assert.rejects(() => extractTarGz(fixture, targetDir), /unsafe tar entry/);
  }
});

test('only one update lease can be created atomically', async () => {
  assert.equal(await acquireUpdateLease(stateDir, { jobId: 'job-a', owner: 'web' }), true);
  assert.equal(await acquireUpdateLease(stateDir, { jobId: 'job-b', owner: 'timer' }), false);
});

test('terminal status removes lock but persists status', async () => {
  await finishUpdate(stateDir, { jobId: 'job-a', state: 'failed', errorCode: 'download_failed' });
  assert.equal(await exists(join(stateDir, 'lock.json')), false);
  assert.equal((await readJson(join(stateDir, 'status.json'))).state, 'failed');
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/archive-fixtures.test.mjs
```

Expected: FAIL because core functions are missing.

- [ ] **Step 3: Implement a bounded Node-standard-library tar.gz extractor**

Use `createGunzip` and a streaming 512-byte ustar reader. Accept regular files and directories only. Reject absolute paths, drive-qualified paths, `..`, backslashes in archive names, symlinks, hardlinks, devices, sparse/unknown types, more than 20,000 entries, any file above 512 MiB, or cumulative uncompressed content above 2 GiB. Resolve every destination and confirm it remains beneath the job extraction root before writing.

- [ ] **Step 4: Implement atomic lock and persistent status helpers inside core**

Create lock with `fs.open(path, 'wx')`. The lock schema is:

```json
{
  "schema": 1,
  "jobId": "job-a",
  "owner": "web",
  "state": "queued",
  "startedAt": "2026-07-16T09:00:00Z",
  "heartbeatAt": "2026-07-16T09:00:00Z"
}
```

Write `status.json` through temp-file + rename with states `queued`, `downloading`, `verifying`, `applying`, `restarting`, `succeeded`, or `failed`. Reclaim a stale lock only after its heartbeat is older than two hours and the platform adapter reports the updater task is not running.

- [ ] **Step 5: Verify release manifest and archive before extraction**

Core must fetch `release-manifest.json` bytes, verify its SHA from stable, verify `release-manifest.json.sig`, select only `windows-amd64`, `linux-amd64`, or `darwin-arm64`, then hash the completed tar.gz before passing it to the extractor.

- [ ] **Step 6: Run archive/state tests**

```powershell
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/archive-fixtures.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/deploy
git commit -m "feat: verify and stage deployment archives"
```

## Task 7: Port current-user runtime registration and helper wrappers to core

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Reference during implementation: `server/cmd/wheelmaker-deploy/service_windows.go`
- Reference during implementation: `server/cmd/wheelmaker-deploy/service_darwin.go`
- Reference during implementation: `server/cmd/wheelmaker-deploy/service_linux.go`
- Reference during implementation: `server/cmd/wheelmaker-deploy/main.go`

- [ ] **Step 1: Write failing platform registration and wrapper tests**

```js
test('Windows plan contains user tasks and fixed 03:00 updater', () => {
  const plan = windowsRuntimePlan(paths);
  assert.deepEqual(plan.names, ['WheelMaker', 'WheelMakerUpdater']);
  assert.match(plan.script, /AtLogOn/);
  assert.match(plan.script, /03:00/);
  assert.doesNotMatch(plan.script, /sc\.exe create/);
});

test('Linux plan contains hub service plus one-shot updater timer', () => {
  const files = linuxRuntimeFiles(paths);
  assert.match(files['wheelmaker-hub.service'], /Restart=always/);
  assert.match(files['wheelmaker-updater.service'], /deploy\.mjs update/);
  assert.match(files['wheelmaker-updater.timer'], /OnCalendar=\*-\*-\* 03:00:00/);
});

test('helper wrappers preserve existing filenames', () => {
  assert.deepEqual(Object.keys(windowsWrappers(paths)).sort(), ['restart.bat', 'start.bat', 'status.bat', 'stop.bat']);
  assert.deepEqual(Object.keys(unixWrappers(paths)).sort(), ['restart.sh', 'start.sh', 'status.sh', 'stop.sh']);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/deploy-core.test.mjs`  
Expected: FAIL for missing runtime plan functions.

- [ ] **Step 3: Implement Windows current-user scheduled tasks**

Generate PowerShell using `Register-ScheduledTask`: `WheelMaker` runs `~/.wheelmaker/bin/wheelmaker.exe -d` at user logon with limited current-user principal and restart settings; `WheelMakerUpdater` runs `node ~/.wheelmaker/deploy.mjs update` daily at 03:00. Runtime start/stop/restart/status use only those known task names and current-user processes rooted at `~/.wheelmaker/bin`.

- [ ] **Step 4: Implement macOS and Linux current-user files**

macOS writes `~/Library/LaunchAgents/com.wheelmaker.hub.plist` with KeepAlive and `com.wheelmaker.updater.plist` with `StartCalendarInterval` hour 3/minute 0. Linux writes `~/.config/systemd/user/wheelmaker-hub.service`, `wheelmaker-updater.service`, and `wheelmaker-updater.timer`, then runs `systemctl --user daemon-reload` and enable/start commands. Preserve the existing Linux lingering prerequisite message.

- [ ] **Step 5: Generate all existing helper wrappers**

Write the four platform-appropriate wrappers into `~/.wheelmaker/`. Each wrapper calls a core-only internal action through `node deploy.mjs runtime start|stop|restart|status`; quote the Node path and WheelMaker home. Remove stale wrappers for the other platform exactly as the current Go deploy does.

- [ ] **Step 6: Prove internal update cannot mutate runtime registration**

Add a test that calls `runCore(['update'])` with a recording adapter and asserts no `configureRuntime`, `removeRuntime`, or `writeWrappers` event. It may call stop/start on already registered Hub runtime only.

- [ ] **Step 7: Run core tests**

Run: `node --test scripts/deploy/deploy-core.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/deploy
git commit -m "feat: register current-user deployment runtime"
```

## Task 8: Apply Hub/Web into existing directories and write release schema v2

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`

- [ ] **Step 1: Write failing install/update layout tests**

```js
test('normal deploy applies Hub and Web to existing layout', async () => {
  await runCore([], fixtureDeps);
  assert.equal(await exists(join(home, 'bin', binaryName)), true);
  assert.equal(await exists(join(home, 'web', 'index.html')), true);
  assert.equal(await exists(join(home, 'app')), false);
  assert.equal(fixtureDeps.events.includes('configure-runtime'), true);
  assert.equal(fixtureDeps.events.includes('write-wrappers'), true);
});

test('successful update writes release schema v2', async () => {
  await runCore(['update'], fixtureDeps);
  assert.deepEqual(await readJson(join(home, 'release.json')), {
    schemaVersion: 2,
    version: 'v1.23',
    publishedAt: '2026-07-16T09:00:00Z',
    sourceSha: fixtureSourceSha,
    manifestSha256: fixtureManifestSha,
    installedAt: fixtureInstalledAt,
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/deploy-core.test.mjs`  
Expected: FAIL because package application is incomplete.

- [ ] **Step 3: Implement normal deployment**

Normal no-argument deployment verifies/stages the current package, stops the existing Hub if present, replaces `bin/wheelmaker(.exe)` and the complete `web/` directory, preserves `desktop/`, `config.json`, databases and logs, writes release schema v2, configures current-user runtime, writes wrappers, and starts Hub. A missing config uses the current deploy's runnable default config generation rules.

- [ ] **Step 4: Implement internal update without registration mutation**

Internal update takes over a queued Hub-created lock or creates its own timer-owned lock, updates heartbeat and status phases, stages and applies `bin/web`, writes release schema v2, and invokes only runtime stop/start. On failure it writes a generic error code, removes the lock, leaves `status.json`, and performs no rollback.

- [ ] **Step 5: Add health confirmation**

After starting Hub, poll the platform adapter's runtime status for at most 30 seconds and require the registered Hub process to be running. Only then write `succeeded`; timeout writes `failed` with `hub_start_timeout`. The prior package is not restored.

- [ ] **Step 6: Run core tests**

Run: `node --test scripts/deploy/deploy-core.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/deploy
git commit -m "feat: install prebuilt Hub and Web releases"
```

## Task 9: Replace Hub Git inference and signal files with stable versions and update jobs

**Files:**
- Modify: `server/internal/hub/tools/update.go`
- Modify: `server/internal/hub/tools/tools_test.go`
- Modify: `server/internal/hub/hub_state_adapters.go`
- Create: `server/internal/hub/tools/release_public_key.pem`
- Modify: `scripts/release/generate-signing-key.mjs`

- [ ] **Step 1: Replace old Git/signal tests with failing release/job tests in the existing test file**

Add tests to `tools_test.go` using an injected HTTP client and task trigger:

```go
func TestUpdateQueryComparesInstalledReleaseWithSignedStable(t *testing.T) {
    cmd := newSignedStableUpdateCommand(t, installedRelease{Version: "v1.22"}, stableRelease{Version: "v1.23"})
    got := handleUpdateQuery(t, cmd)
    if got.Status != "update_available" || got.Installed.Version != "v1.22" || got.Stable.Version != "v1.23" {
        t.Fatalf("response=%+v", got)
    }
}

func TestUpdateRequestCreatesOneQueuedJob(t *testing.T) {
    cmd, trigger := newUpdateJobCommand(t)
    first := handleUpdateRequest(t, cmd)
    second := handleUpdateRequest(t, cmd)
    if first.JobID == "" || first.JobID != second.JobID || trigger.Calls() != 1 {
        t.Fatalf("first=%+v second=%+v calls=%d", first, second, trigger.Calls())
    }
}

func TestUpdateQueryRejectsTamperedStable(t *testing.T) {
    cmd := newTamperedStableUpdateCommand(t)
    got := handleUpdateQuery(t, cmd)
    if got.Status != "checking_failed" || got.ErrorCode != "stable_signature_invalid" {
        t.Fatalf("response=%+v", got)
    }
}
```

- [ ] **Step 2: Run focused Go tests and verify failure**

Run from `server`:

```powershell
go test ./internal/hub/tools -run "Update(Query|Request)"
```

Expected: FAIL because the response still uses Git and signal fields.

- [ ] **Step 3: Replace release and response types without bumping protocol version**

Use these response concepts:

```go
type installedRelease struct {
    SchemaVersion int    `json:"schemaVersion"`
    Version       string `json:"version"`
    PublishedAt   string `json:"publishedAt"`
    SourceSHA     string `json:"sourceSha"`
    ManifestSHA   string `json:"manifestSha256"`
    InstalledAt   string `json:"installedAt"`
}

type stableReleaseSummary struct {
    Version     string `json:"version"`
    PublishedAt string `json:"publishedAt"`
    SourceSHA   string `json:"sourceSha"`
}

type updateCommandResponse struct {
    OK            bool                  `json:"ok"`
    Accepted      bool                  `json:"accepted,omitempty"`
    JobID         string                `json:"jobId,omitempty"`
    Status        string                `json:"status"`
    HubID         string                `json:"hubId"`
    Installed     *installedRelease     `json:"installed,omitempty"`
    Stable        *stableReleaseSummary `json:"stable,omitempty"`
    Job           *updateJobStatus      `json:"job,omitempty"`
    PublishStatus *publishStatus        `json:"publishStatus,omitempty"`
    CanRequest    bool                  `json:"canRequestUpdate"`
    ErrorCode     string                `json:"errorCode,omitempty"`
}
```

Remove repo/branch/remote/Git snapshot, background fetch, `pendingSignal`, and `canUpdatePublish` fields.

- [ ] **Step 4: Implement signed stable and publish-status reads**

Read local schema v2 `release.json`. Fetch stable bytes/signature with a bounded Go HTTP client, verify Ed25519 with `release_public_key.pem`, parse stable, and compare exact version strings. Fetch `publish-status.json` only for display; never use it in the trust decision. Update the key generator to copy the same public PEM into the Go package and add a Node test asserting both committed PEM files are byte-identical.

- [ ] **Step 5: Implement atomic queued job and platform updater trigger**

Accept command actions `query` and `request`. `request` creates `staging/lock.json` with exclusive create, writes queued `status.json`, then triggers the known updater runtime: `Start-ScheduledTask WheelMakerUpdater`, `launchctl kickstart gui/<uid>/com.wheelmaker.updater`, or `systemctl --user start wheelmaker-updater.service`. A duplicate request returns the existing job and does not trigger again.

Change Hub state action name from `updatePublish` to `requestUpdate`, mapping to `cmd.update` action `request`.

- [ ] **Step 6: Run Hub tests**

Run from `server`:

```powershell
go test ./internal/hub/tools ./internal/hub
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/hub scripts/release
git commit -m "feat: report signed release update jobs"
```

## Task 10: Update App version inference, job UI, publish status, and release history

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/settings/agentPackageUpdateView.ts`
- Modify: `app/web/src/settings/UpdateSettingsDetail.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/__tests__/web-agent-package-update-settings.test.ts`
- Modify: `app/__tests__/web-agent-package-update-service.test.ts`

- [ ] **Step 1: Write failing TypeScript source/behavior tests for release versions**

Update existing tests to use this response shape:

```ts
const updateResponse: RegistryWheelMakerUpdateResponse = {
  ok: true,
  status: 'update_available',
  hubId: 'hub-a',
  installed: {schemaVersion: 2, version: 'v1.22', publishedAt: '2026-07-15T09:00:00Z', sourceSha: 'a'.repeat(40), manifestSha256: 'c'.repeat(64), installedAt: '2026-07-15T09:05:00Z'},
  stable: {version: 'v1.23', publishedAt: '2026-07-16T09:00:00Z', sourceSha: 'b'.repeat(40)},
  canRequestUpdate: true,
};

expect(wheelMakerVersionCopy(updateResponse)).toEqual({current: 'v1.22', latest: 'v1.23'});
expect(wheelMakerUpdateStatusLabel('downloading')).toBe('Downloading');
```

Update service tests to expect hub state action `requestUpdate`, not `updatePublish`.

- [ ] **Step 2: Run focused App tests and verify failure**

Run from `app`:

```powershell
npm test -- web-agent-package-update-settings.test.ts web-agent-package-update-service.test.ts --runInBand
```

Expected: FAIL because old Git fields and action names remain.

- [ ] **Step 3: Replace Registry TypeScript types and repository fallbacks**

Define installed/stable/job/publish status interfaces matching Task 9 exactly. Replace `RegistryWheelMakerRelease`, `RegistryWheelMakerGitSnapshot`, `pendingSignal`, and `canUpdatePublish`. Rename service/repository method to `requestWheelMakerUpdate`, using hub state action `requestUpdate`.

- [ ] **Step 4: Replace Git-derived view helpers and UI copy**

Remove `shortGitSha`, `wheelMakerBehindCopy`, and `wheelMakerReleaseRef`. Add helpers that render current/latest `v1.x`, publication times, job state, and generic error code. The Update panel must not show branch, remote, current/latest SHA, commit counts, dirty/ahead/diverged states, or “pull/build/publish Web” dialog copy.

- [ ] **Step 5: Add publish status and public Release history**

Render optional Hub-provided `publishStatus` phase/state near the stable version. Query `https://api.github.com/repos/swm8023/wheelmaker-releases/releases` from the Web client for version history, filter drafts/prereleases, and display version plus published time. This is display-only and does not choose deployment assets.

- [ ] **Step 6: Poll only active jobs**

After `accepted`, poll Hub state while job state is queued/downloading/verifying/applying/restarting. Stop on succeeded/failed and reuse returned jobId for duplicate clicks. Disable the button while a job is active.

- [ ] **Step 7: Run tests and typecheck**

Run from `app`:

```powershell
npm test -- web-agent-package-update-settings.test.ts web-agent-package-update-service.test.ts --runInBand
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/web/src app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-agent-package-update-service.test.ts
git commit -m "feat: show installed and stable WheelMaker versions"
```

## Task 11: Add one-time migration, cut over wrappers, and remove obsolete Go deploy/updater

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `deploy.bat`
- Modify: `deploy.sh`
- Modify: `scripts/test_deploy_bat.ps1`
- Modify: `scripts/test_deploy_sh.ps1`
- Delete: `server/cmd/wheelmaker-deploy/`
- Delete: `server/cmd/wheelmaker-updater/`
- Delete: `update-publish.bat`
- Delete: `update-publish.sh`
- Delete: `scripts/test_update_publish_bat.ps1`
- Delete: `scripts/test_update_publish_sh.ps1`
- Modify: `scripts/security_acceptance.ps1`
- Modify: `scripts/security_acceptance.sh`

- [ ] **Step 1: Write failing migration preservation tests**

```js
test('migrate-uninstall removes legacy runtimes and preserves user data', async () => {
  await seedLegacyInstall(home);
  await runCore(['migrate-uninstall'], fixtureDeps);
  assert.equal(await legacyRuntimeExists(fixtureDeps), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker.exe')), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker-updater.exe')), false);
  assert.equal(await exists(join(home, 'bin', 'wheelmaker-deploy.exe')), false);
  assert.equal(await exists(join(home, 'build', 'bootstrap')), false);
  assert.equal(await exists(join(home, 'config.json')), true);
  assert.equal(await exists(join(home, 'data', 'sessions.db')), true);
  assert.equal(await exists(join(home, 'logs', 'hub.log')), true);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/deploy/deploy-core.test.mjs`  
Expected: FAIL because full legacy cleanup is missing.

- [ ] **Step 3: Port the complete one-time cleanup map**

Windows removes services/tasks/HKCU Run entries named `WheelMaker`, `WheelMakerUpdater`, and `WheelMakerMonitor`, stops only binaries rooted under `~/.wheelmaker/bin`, and requests elevation only when deleting legacy Windows services. macOS removes old Hub/updater/monitor LaunchAgents. Linux removes old hub/updater/monitor user units and reloads systemd. Delete old Hub, `wheelmaker-deploy`, `wheelmaker-updater`, monitor binaries, and `~/.wheelmaker/build/bootstrap`; preserve config, DBs, logs, desktop, and other user data.

- [ ] **Step 4: Rewrite top-level migration launchers**

`deploy.bat` and `deploy.sh` must copy `scripts/deploy/deploy.mjs` into `~/.wheelmaker/deploy.mjs`, invoke `node deploy.mjs migrate-uninstall`, then invoke `node deploy.mjs`. They must require Node 22+, never run Go/npm/Git, and never call old refresh scripts. Update their PowerShell source tests accordingly.

- [ ] **Step 5: Remove obsolete programs and signal entrypoints**

Delete both Go command directories and root update-publish signal scripts/tests. Update security acceptance lists so they require the new Node tests and no longer invoke deleted updater/signal tests. Run `rg` to ensure active code contains no `update-now.signal`, `full-update`, or `bootstrap-update` references.

- [ ] **Step 6: Run migration, wrapper, Go, and security tests**

```powershell
node --test scripts/deploy/deploy-core.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_bat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_sh.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security_acceptance.ps1
Push-Location server; go test ./...; Pop-Location
```

Expected: PASS; Go test output contains no `wheelmaker-deploy` or `wheelmaker-updater` package.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: retire source deployment runtime"
```

## Task 12: Add independent Desktop updater, documentation, and full release acceptance

**Files:**
- Create: `update_exe.bat`
- Modify: `scripts/deploy/deploy-core.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Create: `scripts/test_update_exe_bat.ps1`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`
- Modify: `docs/prebuilt-release-deployment-design.md` only if implementation reveals a factual correction
- Modify: `docs/scope/2026-07-16-prebuilt-release-deployment/spec-prebuilt-release-deployment.md` only if implementation reveals a factual correction

- [ ] **Step 1: Write failing Desktop updater tests**

```js
test('Desktop update follows carried stable pointer', async () => {
  await runCore(['desktop-update'], fixtureDeps.withStable({
    version: 'v1.3',
    desktopExe: {version: 'v1.2', url: fixtureDesktopURL, sha256: fixtureDesktopSHA},
  }));
  assert.equal(await sha256File(join(home, 'desktop', 'WheelMakerDesktop.exe')), fixtureDesktopSHA);
});

test('Desktop update refuses to replace a running executable', async () => {
  const deps = fixtureDeps.withDesktopRunning(true);
  await assert.rejects(() => runCore(['desktop-update'], deps), /close WheelMaker Desktop/i);
  assert.equal(deps.downloadCalls, 0);
});
```

PowerShell source test must assert `update_exe.bat` invokes `node "%USERPROFILE%\.wheelmaker\deploy.mjs" desktop-update` and does not contain process-kill or delayed self-replacement logic.

- [ ] **Step 2: Run and verify failure**

```powershell
node --test scripts/deploy/deploy-core.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_update_exe_bat.ps1
```

Expected: FAIL because Desktop update entrypoints do not exist.

- [ ] **Step 3: Implement Desktop update through the existing trust chain**

Core reads the already verified stable object, requires `desktopExe`, checks whether `WheelMakerDesktop` is running, downloads to `desktop/WheelMakerDesktop.exe.tmp`, verifies SHA-256, and atomically replaces the EXE. It does not change Hub/Web, runtime tasks, shortcut, or stable version. `update_exe.bat` is only a thin user-facing wrapper; normal deployment writes the same wrapper body into `~/.wheelmaker/update_exe.bat` alongside start/stop/restart/status.

- [ ] **Step 4: Update operator and contributor documentation**

Document Node 22+ as the only target prerequisite, `bin/web/desktop` layout, normal deploy, one-time migration, fixed 03:00 update task, four helper wrappers, schema v2 `release.json`, Desktop close-and-retry behavior, Windows-first local release, Action fallback, signing/App secret names, and no Git-based version inference. Remove instructions for Go deploy CLI, Go updater, update signals, source pull/build on target, and conditional Web deployment.

- [ ] **Step 5: Run all targeted tests**

```powershell
node --test scripts/release/*.test.mjs scripts/deploy/*.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_bat.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_deploy_sh.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_publish_desktop_ps1.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test_update_exe_bat.ps1
Push-Location server; go test ./...; Pop-Location
Push-Location app; npm test -- --runInBand; npm run tsc:web; Pop-Location
```

Expected: PASS.

- [ ] **Step 6: Run a real no-publish build and inspect its layout**

```powershell
node scripts/release.mjs build --with-desktop
Get-ChildItem .release-out -Recurse -File | Where-Object { $_.Name -in @('wheelmaker.exe', 'wheelmaker', 'index.html', 'WheelMakerDesktop.exe') }
```

Expected: three platform directories each contain Hub + Web, and the optional Desktop EXE exists once outside platform archives; no package contains deployment MJS.

- [ ] **Step 7: Cross-check obsolete behavior and repository hygiene**

```powershell
rg -n "update-now\.signal|full-update|bootstrap-update|wheelmaker-deploy|wheelmaker-updater" server app scripts deploy.bat deploy.sh README.md INSTALL.md CLAUDE.md --glob '!**/dist/**'
git diff --check
git status --short
```

Expected: no active implementation or current documentation references obsolete deployment behavior; historical superseded documents may retain it. Diff check passes.

- [ ] **Step 8: Commit and push**

```powershell
git add -A
git commit -m "feat: ship prebuilt release deployment"
git push origin main
```

Expected: commit and push succeed.

## Self-review

Spec coverage:

- Private/public repository split, GitHub App authorization, signing and stable-last ordering: Tasks 1, 3, and 4.
- Windows-first local build, one Web build, three Hub targets, optional Desktop, tar.gz and runner caching: Tasks 2 and 4.
- Public Git launcher/core, self-update, secure extraction, staging lock/status and no rollback: Tasks 5, 6, and 8.
- Existing `bin/web/desktop` layout, current-user runtime, fixed updater schedule, and all helper wrappers: Tasks 7 and 8.
- Hub accepted job flow, stable/release schema v2 version inference, publish status and App history: Tasks 9 and 10.
- Dedicated migration, removal of Go deploy/updater/signal path, and preserved user data: Task 11.
- Carried-forward Desktop pointer and closed-process update: Tasks 3 and 12.
- Android, macOS amd64, rollback and protocol-version changes remain outside scope.

Type consistency:

- Release version is named `version` in stable, manifest, local schema v2, Go response and TypeScript response.
- Private source identity is named `sourceSha`; manifest identity is named `manifestSha256`.
- Hub action is `request`; Hub-state action is `requestUpdate`; App method is `requestWheelMakerUpdate`.
- Job states are `queued`, `downloading`, `verifying`, `applying`, `restarting`, `succeeded`, and `failed` across MJS, Go and TypeScript.
- Target directories are always `bin/`, `web/`, `desktop/`, and `staging/`; no task introduces `app/`.
