# Startup and Connection Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant startup probes from Android and Desktop, remove filesystem reads from Registry connection and project selection, and document compression for the Nginx instance serving the Web UI.

**Architecture:** A saved HTTPS Base URL is already trusted configuration, so native shells navigate directly and rely on their existing guarded WebView failure callbacks; explicit save and retry actions continue to probe. Registry connection establishes transport and reads topology metadata only, while project selection remains local and filesystem RPCs stay behind file browsing. Nginx compresses text assets at the serving boundary without changing the Registry protocol.

**Tech Stack:** TypeScript/Jest, Go/WebView2, Kotlin/Android WebView/JUnit, PowerShell documentation checks, Nginx.

---

### Task 1: Remove filesystem work from Registry connection

**Files:**
- Modify: `app/__tests__/web-chat-project-service.test.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`

- [x] **Step 1: Write the failing connection test**

Replace the reachability-probe tests with a test whose `listFiles` promise never settles and whose snapshot includes an `online: false` Project. Assert that `connect()` resolves immediately, selects the first metadata Project, and never calls `listFiles`:

```ts
test('connect selects project metadata without reading the filesystem', async () => {
  const repository = {
    initialize: jest.fn().mockResolvedValue(undefined),
    listProjectSnapshot: jest.fn().mockResolvedValue({
      projects: [{projectId: 'project-1', name: 'Project', online: false, path: '/project'}],
      hubs: [{hubId: 'hub-1'}],
    }),
    getHubState: jest.fn(),
    listFiles: jest.fn().mockReturnValue(new Promise(() => undefined)),
    onEvent: jest.fn(() => () => undefined),
    onClose: jest.fn(() => () => undefined),
    close: jest.fn(),
  };
  const service = new RegistryWorkspaceService(undefined, {
    createRepository: jest.fn(() => repository as never),
  });

  await expect(service.connect('ws://registry.example/ws')).resolves.toMatchObject({
    selectedProjectId: 'project-1',
  });
  expect(repository.listFiles).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runInBand __tests__/web-chat-project-service.test.ts`

Expected: FAIL because current connection skips the offline Project and/or waits on `project.fs.list`.

- [x] **Step 3: Implement metadata-only connection**

In `RegistryWorkspaceService.ts`:

```ts
export type WorkspaceSession = {
  projects: RegistryProject[];
  hubs: RegistryHub[];
  selectedProjectId: string;
};

const selectedProjectId = snapshot.projects[0]?.projectId ?? '';
this.session = {...snapshot, selectedProjectId};
```

Delete `PROJECT_CONNECT_PROBE_TIMEOUT_MS`, `isProjectReachabilityError`, `selectFirstReachableProject`, `probeProjectRoot`, and the connection-time `fileEntries` plumbing. Keep `listDirectory` and `listProjectDirectory` unchanged so file browsing remains explicitly lazy.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --runInBand __tests__/web-chat-project-service.test.ts`

Expected: PASS.

### Task 2: Keep restored and switched Project selection lightweight

**Files:**
- Modify: `app/__tests__/web-workspace-project-lightweight.test.ts`
- Modify: `app/__tests__/web-session-attachment-preview-service.test.ts`
- Modify: `app/web/src/workspace/WorkspaceController.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [x] **Step 1: Write the failing restored-selection test**

Change the controller test to return a first Project from `connect()`, select a different persisted Project from the store, and assert that `selectProjectLightweight` is called while `selectProject` is absent:

```ts
const service = {
  connect: jest.fn().mockResolvedValue({
    projects: [
      {projectId: 'p1', name: 'One', online: true, path: '/one'},
      {projectId: 'p2', name: 'Two', online: true, path: '/two'},
    ],
    hubs: [{hubId: 'hub'}],
    selectedProjectId: 'p1',
  }),
  selectProjectLightweight: jest.fn().mockResolvedValue({
    projects: [
      {projectId: 'p1', name: 'One', online: true, path: '/one'},
      {projectId: 'p2', name: 'Two', online: true, path: '/two'},
    ],
    hubs: [{hubId: 'hub'}],
    selectedProjectId: 'p2',
  }),
};
```

- [x] **Step 2: Run the controller test and verify RED**

Run: `npm test -- --runInBand __tests__/web-workspace-project-lightweight.test.ts`

Expected: FAIL because `WorkspaceController.connect` currently calls the filesystem-loading `selectProject` path.

- [x] **Step 3: Implement lightweight selection and remove the obsolete heavy API**

Use `selectProjectLightweight` when the persisted selection differs:

```ts
const targetProjectId = this.store.selectProjectOnConnect(
  baseSession.projects,
  baseSession.selectedProjectId,
);
const session = targetProjectId !== baseSession.selectedProjectId
  ? await this.service.selectProjectLightweight(targetProjectId)
  : baseSession;
```

Delete `RegistryWorkspaceService.selectProject`, `WorkspaceController.switchProject`, the unused `WorkspaceApp` heavy `switchProject` callback, and remaining `fileEntries` fixtures.

- [x] **Step 4: Run focused Web tests and typecheck**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-project-service.test.ts __tests__/web-workspace-project-lightweight.test.ts __tests__/web-session-attachment-preview-service.test.ts
npm run tsc:web
```

Expected: PASS.

### Task 3: Navigate Desktop directly to a saved server

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/app_test.go`
- Modify: `server/cmd/wheelmaker-desktop/app.go`

- [x] **Step 1: Write the failing Desktop startup test**

Rename the saved-server test and assert direct navigation even when the injected prober would fail:

```go
func TestDesktopSavedServerLaunchesWithoutPreflightProbe(t *testing.T) {
	launcher := &recordingLauncher{}
	prober := &recordingDesktopProber{err: errors.New("probe should not run")}
	store := &memoryDesktopConfigStore{config: desktopConfig{BaseURL: "https://example.com/app"}}

	if err := runDesktopApp(context.Background(), launcher, store, prober); err != nil {
		t.Fatalf("runDesktopApp: %v", err)
	}
	if prober.url != "" {
		t.Fatalf("saved server was preflight-probed: %q", prober.url)
	}
	if launcher.target.URL != "https://example.com/app/" {
		t.Fatalf("target=%+v", launcher.target)
	}
}
```

- [x] **Step 2: Run the Desktop test and verify RED**

Run: `go test ./cmd/wheelmaker-desktop -run '^TestDesktopSavedServerLaunchesWithoutPreflightProbe$' -count=1`

Expected: FAIL because startup invokes `prober.Probe`.

- [x] **Step 3: Implement direct saved-server launch**

After validation and normalization, set:

```go
target = desktopLaunchTarget{URL: normalized}
```

Remove only the startup probe branch. Keep `desktopRuntime.SaveBaseURL` and `Retry` probing user-entered or explicitly retried addresses. Existing navigation failure handling remains the fallback.

- [x] **Step 4: Run Desktop tests and verify GREEN**

Run: `go test ./cmd/wheelmaker-desktop -count=1`

Expected: PASS.

### Task 4: Navigate Android directly to a saved server

**Files:**
- Modify: `mobile/android/app/src/test/java/com/wheelmaker/android/MainActivityWebCacheTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`

- [x] **Step 1: Write the failing Android startup test**

Extend the existing source contract test to extract `startInitialNavigation` and assert that it calls `loadConfiguredRemote` without calling `probeAndLoad`:

```kotlin
@Test
fun savedServerLoadsWithoutPreflightProbe() {
    val body = source.substringAfter("private fun startInitialNavigation")
        .substringBefore("private fun probeAndLoad")

    assertTrue(body.contains("loadConfiguredRemote"))
    assertFalse(body.contains("probeAndLoad"))
}
```

- [x] **Step 2: Run the Android test and verify RED**

Run: `gradle :app:testDebugUnitTest --tests com.wheelmaker.android.MainActivityWebCacheTest`

Expected: FAIL because stored startup currently calls `probeAndLoad`.

- [x] **Step 3: Implement direct saved-server navigation**

In `startInitialNavigation`, preserve bootstrap behavior for an empty address, select an in-origin notification URL when present, clear the bootstrap error, and call `loadConfiguredRemote` directly:

```kotlin
val policy = BaseUrlPolicy(baseUrl)
val targetUrl = notificationUrl?.takeIf(policy::contains) ?: baseUrl
bootstrapError = ""
loadConfiguredRemote(webView, targetUrl)
```

Keep `probeAndLoad` for `bootstrap.saveBaseUrl` and `bootstrap.retry`. Keep `StableOriginWebViewClient.onRemoteFailure` as the TLS/navigation failure path.

- [x] **Step 4: Run Android unit tests and verify GREEN**

Run: `gradle :app:testDebugUnitTest`

Expected: PASS.

### Task 5: Require Nginx compression in deployment templates

**Files:**
- Modify: `scripts/test_security_docs.ps1`
- Modify: `README.md`
- Modify: `INSTALL.md`

- [x] **Step 1: Add a failing deployment-template assertion**

In `test_security_docs.ps1`, require both Nginx examples to contain:

```powershell
foreach ($relativePath in @('README.md', 'INSTALL.md')) {
    $nginxDoc = $documents[$relativePath]
    foreach ($pattern in @(
        'gzip on;',
        'gzip_vary on;',
        'gzip_min_length 1024;',
        'application/javascript',
        'application/manifest+json'
    )) {
        if (-not $nginxDoc.Contains($pattern)) {
            Fail "$relativePath Nginx template is missing: $pattern"
        }
    }
}
```

- [x] **Step 2: Run the documentation check and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1`

Expected: FAIL because the current Web-serving Nginx templates do not enable gzip.

- [x] **Step 3: Add the Nginx compression block**

Add this block at server scope in both templates:

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_types
    text/css
    application/javascript
    application/json
    application/manifest+json
    image/svg+xml;
```

Document that the actual Nginx instance serving the configured Base URL must receive the change, pass `nginx -t`, and reload before clients benefit.

- [x] **Step 4: Run the documentation check and verify GREEN**

Run: `powershell -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1`

Expected: PASS.

### Task 6: Final verification and Git completion gate

**Files:**
- Modify: `docs/plans/nospec/2026-07-31-startup-connection-latency/plan-startup-connection-latency.md`

- [x] **Step 1: Run all relevant verification**

Run:

```powershell
Push-Location app
npm test -- --runInBand __tests__/web-chat-project-service.test.ts __tests__/web-workspace-project-lightweight.test.ts __tests__/web-session-attachment-preview-service.test.ts
npm run tsc:web
Pop-Location
Push-Location server
go test ./cmd/wheelmaker-desktop -count=1
Pop-Location
Push-Location mobile/android
gradle :app:testDebugUnitTest
Pop-Location
powershell -ExecutionPolicy Bypass -File scripts/test_security_docs.ps1
```

Expected: all commands PASS.

- [x] **Step 2: Inspect the final diff and remote state**

Run:

```powershell
git diff --check
git status -sb
git diff --stat
git fetch origin main
git rebase origin/main
```

Expected: no whitespace errors, only planned files changed, and rebase succeeds.

- [x] **Step 3: Execute the required completion tail**

Run exactly:

```powershell
git add -A
git commit -m "fix(startup): remove redundant connection probes"
git push origin main
```

Expected: commit and push succeed.
