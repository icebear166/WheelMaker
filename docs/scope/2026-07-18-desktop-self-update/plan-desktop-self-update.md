# Windows Desktop Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Windows-only Desktop startup update check and a one-shot `update.exe` that closes, updates, and relaunches the standard installed Desktop without affecting Hub runtime registration.

**Architecture:** The Web titlebar reuses the public stable metadata parser and compares `stable.desktopExe.sha256` with a SHA returned by a trusted native bridge. The bridge exposes read/start operations only to the configured HTTPS top-level page and launches a fixed `~/.wheelmaker/desktop/update.exe`; the helper waits for the Desktop PID, runs the existing `deploy.mjs desktop-update` trust chain, and relaunches the fixed Desktop path. Release builds place the helper in every Windows platform archive, and deploy applies only that helper while preserving `WheelMakerDesktop.exe`.

**Tech Stack:** Go 1.26, `golang.org/x/sys/windows`, WebView2 native bindings, React 19, TypeScript/Jest, Node.js 22 ESM and `node:test`, existing WheelMaker release/deploy MJS.

---

### Task 1: Parse Desktop release metadata and derive Web update state

**Files:**
- Modify: `app/web/src/settings/agentPackageUpdateView.ts:25-220`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts:1-50`
- Create: `app/web/src/platform/desktop/desktopUpdate.ts`
- Test: `app/__tests__/web-agent-package-update-settings.test.ts`
- Create: `app/__tests__/web-desktop-update.test.ts`

- [ ] **Step 1: Write failing stable pointer parser tests**

Extend the existing settings test with one valid Desktop pointer and invalid path/SHA cases:

```ts
test('stable metadata preserves a valid Desktop pointer', () => {
  const stable = parseWheelMakerStable({
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    desktopExe: {
      version: 'v1.22',
      path: '/releases/v1.22/WheelMakerDesktop.exe',
      sha256: 'b'.repeat(64),
    },
  });
  expect(stable.desktopExe?.version).toBe('v1.22');
  expect(stable.desktopExe?.sha256).toBe('b'.repeat(64));
});

test.each([
  {version: 'v1.22', path: 'https://evil.example/Desktop.exe', sha256: 'b'.repeat(64)},
  {version: 'v1.22', path: '/releases/v1.22/WheelMakerDesktop.exe', sha256: 'bad'},
])('stable metadata rejects invalid Desktop pointers', desktopExe => {
  expect(() => parseWheelMakerStable({
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'a'.repeat(40),
    desktopExe,
  })).toThrow(/Desktop pointer/);
});
```

- [ ] **Step 2: Run the parser tests to verify RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts
```

Expected: FAIL because `WheelMakerStableMetadata` drops `desktopExe` and does not validate it.

- [ ] **Step 3: Add the Desktop pointer type and validation**

Add to `agentPackageUpdateView.ts`:

```ts
export type WheelMakerDesktopPointer = {
  version: string;
  path: string;
  sha256: string;
};

export type WheelMakerStableMetadata = RegistryWheelMakerStableRelease & {
  schema: 2;
  androidApk?: WheelMakerAndroidApkPointer;
  desktopExe?: WheelMakerDesktopPointer;
};

function validDesktopPointer(input: unknown): input is WheelMakerDesktopPointer {
  const pointer = input as Record<string, unknown>;
  if (
    !pointer || typeof pointer !== 'object' ||
    typeof pointer.version !== 'string' || !/^v1\.([1-9]\d*)$/.test(pointer.version) ||
    typeof pointer.path !== 'string' ||
    typeof pointer.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pointer.sha256)
  ) return false;
  try {
    wheelMakerReleaseUrl(pointer.path);
  } catch {
    return false;
  }
  return true;
}
```

In `parseWheelMakerStable`, reject an invalid present pointer and include the validated pointer in the returned object.

- [ ] **Step 4: Define the native update bridge contract**

Add to `desktopRuntime.ts`:

```ts
export type DesktopUpdateInfo = {
  sha256: string;
  updaterReady: boolean;
};

export type DesktopWindowBridge = {
  enabled: true;
  getDeviceName?: () => Promise<string> | string;
  startDrag?: () => Promise<void> | void;
  minimize?: () => Promise<void> | void;
  toggleMaximize?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
  requestLocalDevMode?: (sourcePath: string) => Promise<void> | void;
  localDev?: DesktopLocalDevBridge;
  openProjectFileInVSCode?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  showProjectFileInFolder?: (projectRoot: string, relativePath: string) => Promise<void> | void;
  getDesktopUpdateInfo?: () => Promise<DesktopUpdateInfo>;
  requestDesktopUpdate?: () => Promise<void>;
};
```

- [ ] **Step 5: Write failing pure update-state tests**

Create `web-desktop-update.test.ts` with injected fetch and bridge behavior:

```ts
import {checkDesktopUpdate} from '../web/src/platform/desktop/desktopUpdate';
import type {DesktopWindowBridge} from '../web/src/platform/desktop/desktopRuntime';

function stableWithDesktop(version: string, sha256: string) {
  return {
    schema: 2,
    version: 'v1.24',
    publishedAt: '2026-07-18T09:00:00Z',
    sourceSha: 'c'.repeat(40),
    desktopExe: {
      version,
      path: `/releases/${version}/WheelMakerDesktop.exe`,
      sha256,
    },
  };
}

function bridgeWith(sha256: string, updaterReady: boolean): DesktopWindowBridge {
  return {
    enabled: true,
    getDesktopUpdateInfo: jest.fn(async () => ({sha256, updaterReady})),
    requestDesktopUpdate: jest.fn(async () => undefined),
  };
}

function stableFetch(sha256: string): typeof fetch {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => stableWithDesktop('v1.22', sha256),
  })) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
  return jest.fn(async () => {
    throw new Error('network failed');
  }) as unknown as typeof fetch;
}

test('reports an available update only when the Desktop SHA differs', async () => {
  const bridge = bridgeWith('a'.repeat(64), true);
  const request = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => stableWithDesktop('v1.22', 'b'.repeat(64)),
  })) as unknown as typeof fetch;

  await expect(checkDesktopUpdate(bridge, request)).resolves.toEqual({
    status: 'available',
    version: 'v1.22',
  });
});

test('reports current, and maps missing helper or request failures to failed', async () => {
  await expect(checkDesktopUpdate(bridgeWith('a'.repeat(64), true), stableFetch('a'.repeat(64))))
    .resolves.toEqual({status: 'current', version: 'v1.22'});
  await expect(checkDesktopUpdate(bridgeWith('a'.repeat(64), false), stableFetch('b'.repeat(64))))
    .resolves.toEqual({status: 'failed'});
  await expect(checkDesktopUpdate(bridgeWith('a'.repeat(64), true), failingFetch()))
    .resolves.toEqual({status: 'failed'});
});
```

- [ ] **Step 6: Run the update-state test to verify RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-desktop-update.test.ts
```

Expected: FAIL because `desktopUpdate.ts` does not exist.

- [ ] **Step 7: Implement the pure checker**

Create `desktopUpdate.ts` with no React dependency:

```ts
import {parseWheelMakerStable, WHEELMAKER_STABLE_URL} from '../../settings/agentPackageUpdateView';
import type {DesktopWindowBridge} from './desktopRuntime';

export type DesktopUpdateCheck =
  | {status: 'checking'}
  | {status: 'current'; version: string}
  | {status: 'available'; version: string}
  | {status: 'failed'};

export async function checkDesktopUpdate(
  bridge: DesktopWindowBridge,
  request: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<DesktopUpdateCheck> {
  if (!bridge.getDesktopUpdateInfo || !bridge.requestDesktopUpdate) return {status: 'failed'};
  try {
    const [info, response] = await Promise.all([
      bridge.getDesktopUpdateInfo(),
      request(WHEELMAKER_STABLE_URL, {cache: 'no-store'}),
    ]);
    if (!response.ok || !info.updaterReady || !/^[0-9a-f]{64}$/.test(info.sha256)) {
      return {status: 'failed'};
    }
    const pointer = parseWheelMakerStable(await response.json()).desktopExe;
    if (!pointer) return {status: 'failed'};
    return {
      status: info.sha256 === pointer.sha256 ? 'current' : 'available',
      version: pointer.version,
    };
  } catch {
    return {status: 'failed'};
  }
}
```

- [ ] **Step 8: Run Task 1 tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts __tests__/web-desktop-update.test.ts
npm run tsc:web
```

Expected: both suites PASS; TypeScript exits 0.

- [ ] **Step 9: Commit**

```powershell
git add app/web/src/settings/agentPackageUpdateView.ts app/web/src/platform/desktop/desktopRuntime.ts app/web/src/platform/desktop/desktopUpdate.ts app/__tests__/web-agent-package-update-settings.test.ts app/__tests__/web-desktop-update.test.ts
git commit -m "feat(app): model Desktop update availability"
```

### Task 2: Add the standard-install Desktop update controller and secure bridge

**Files:**
- Create: `server/cmd/wheelmaker-desktop/desktop_update.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_update_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_update_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go:8-80`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go:20-115`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go:35-130`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go:60-215`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go:45-100`

- [ ] **Step 1: Write failing controller tests for the fixed path and SHA**

Create `desktop_update_test.go` around an injected controller:

```go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeDesktopTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil { t.Fatal(err) }
}

func TestDesktopUpdateInfoUsesOnlyStandardInstall(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopTestFile(t, exe, "desktop")
	writeDesktopTestFile(t, updater, "updater")

	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
	})
	info, err := controller.Info()
	if err != nil { t.Fatal(err) }
	wantSHA := sha256.Sum256([]byte("desktop"))
	if info.SHA256 != hex.EncodeToString(wantSHA[:]) || !info.UpdaterReady {
		t.Fatalf("info=%+v", info)
	}
}

func TestDesktopUpdateStartsOnlyTheFixedUpdater(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopTestFile(t, exe, "desktop")
	writeDesktopTestFile(t, updater, "updater")
	var startedPath string
	var startedPID int
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
		startUpdater: func(path string, pid int) error {
			startedPath, startedPID = path, pid
			return nil
		},
	})
	if err := controller.Start(42); err != nil { t.Fatal(err) }
	if filepath.Clean(startedPath) != filepath.Clean(updater) || startedPID != 42 {
		t.Fatalf("started path=%q pid=%d", startedPath, startedPID)
	}
}

func TestDesktopUpdateRejectsPortableExecutable(t *testing.T) {
	home := t.TempDir()
	portable := filepath.Join(home, "WheelMakerDesktop.exe")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return portable, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
	})
	if _, err := controller.Info(); err == nil || !strings.Contains(err.Error(), "standard install") {
		t.Fatalf("Info error=%v", err)
	}
}

func TestDesktopUpdateStartPropagatesLauncherFailure(t *testing.T) {
	home := t.TempDir()
	exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	updater := filepath.Join(home, ".wheelmaker", "desktop", "update.exe")
	writeDesktopTestFile(t, exe, "desktop")
	writeDesktopTestFile(t, updater, "updater")
	wantErr := errors.New("start failed")
	controller := newDesktopUpdateController(desktopUpdateDependencies{
		userHome:   func() (string, error) { return home, nil },
		executable: func() (string, error) { return exe, nil },
		hashFile:   sha256File,
		stat:       os.Stat,
		startUpdater: func(string, int) error { return wantErr },
	})
	if err := controller.Start(42); !errors.Is(err, wantErr) {
		t.Fatalf("Start error=%v", err)
	}
}
```

- [ ] **Step 2: Run the controller tests to verify RED**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -run 'TestDesktopUpdate' -count=1
```

Expected: FAIL because the controller types do not exist.

- [ ] **Step 3: Implement fixed-path resolution and streaming SHA**

Create `desktop_update.go` with the JSON contract and injected boundaries:

```go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type desktopUpdateInfo struct {
	SHA256       string `json:"sha256"`
	UpdaterReady bool   `json:"updaterReady"`
}

type desktopUpdateDependencies struct {
	userHome     func() (string, error)
	executable   func() (string, error)
	hashFile     func(string) (string, error)
	stat         func(string) (os.FileInfo, error)
	startUpdater func(string, int) error
}

type desktopUpdateController struct { deps desktopUpdateDependencies }

func newDesktopUpdateController(deps desktopUpdateDependencies) *desktopUpdateController {
	return &desktopUpdateController{deps: deps}
}

func (c *desktopUpdateController) paths() (string, string, error) {
	home, err := c.deps.userHome()
	if err != nil { return "", "", fmt.Errorf("resolve user home: %w", err) }
	expected := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	current, err := c.deps.executable()
	if err != nil { return "", "", fmt.Errorf("resolve Desktop executable: %w", err) }
	if !strings.EqualFold(filepath.Clean(current), filepath.Clean(expected)) {
		return "", "", errors.New("Desktop self-update requires the standard install directory")
	}
	return expected, filepath.Join(filepath.Dir(expected), "update.exe"), nil
}

func (c *desktopUpdateController) Info() (desktopUpdateInfo, error) {
	desktop, updater, err := c.paths()
	if err != nil { return desktopUpdateInfo{}, err }
	sha, err := c.deps.hashFile(desktop)
	if err != nil { return desktopUpdateInfo{}, fmt.Errorf("hash Desktop executable: %w", err) }
	_, statErr := c.deps.stat(updater)
	return desktopUpdateInfo{SHA256: sha, UpdaterReady: statErr == nil}, nil
}

func (c *desktopUpdateController) Start(parentPID int) error {
	_, updater, err := c.paths()
	if err != nil { return err }
	if _, err := c.deps.stat(updater); err != nil { return fmt.Errorf("Desktop updater is unavailable: %w", err) }
	return c.deps.startUpdater(updater, parentPID)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil { return "", err }
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil { return "", err }
	return hex.EncodeToString(hash.Sum(nil)), nil
}
```

- [ ] **Step 4: Implement the Windows updater launcher**

Create `desktop_update_windows.go`:

```go
//go:build windows

func newWindowsDesktopUpdateController() *desktopUpdateController {
	return newDesktopUpdateController(desktopUpdateDependencies{
		userHome: os.UserHomeDir,
		executable: os.Executable,
		hashFile: sha256File,
		stat: os.Stat,
		startUpdater: func(path string, parentPID int) error {
			cmd := exec.Command(path, "--parent-pid", strconv.Itoa(parentPID))
			shared.ConfigureBackgroundCommand(cmd)
			if err := cmd.Start(); err != nil { return err }
			return cmd.Process.Release()
		},
	})
}
```

- [ ] **Step 5: Write failing policy and injection assertions**

Add policy cases proving both update actions are allowed only for the trusted remote main frame and denied for bootstrap, Local Dev, stale origins and iframes. Extend `webview_windows_test.go` to require the binding source strings, their authorization calls, launcher error propagation, and source ordering that places `postWindowClose` after the successful `Start(os.Getpid())` branch.

```go
{name: "remote update info", mode: desktopTrustedRemotePage, url: trustedURL, mainFrame: true, action: desktopBridgeGetUpdateInfo, want: true},
{name: "local dev cannot update Desktop", mode: desktopTrustedLocalDevPage, url: desktopLocalDevURL, mainFrame: true, action: desktopBridgeRequestUpdate},
```

- [ ] **Step 6: Run policy tests to verify RED**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop -run 'TestDesktopWebViewPolicy|TestDesktopRuntimeScript' -count=1
```

Expected: FAIL because the actions and bindings are absent.

- [ ] **Step 7: Add bridge constants, authorization, and no-argument Web methods**

Add `desktopGetUpdateInfoBinding` and `desktopRequestUpdateBinding` to `desktop_bridge.go`. Expose only on the trusted HTTPS `WheelMakerDesktop` object:

```js
getDesktopUpdateInfo: invoke('__wheelMakerDesktopGetUpdateInfo'),
requestDesktopUpdate: invoke('__wheelMakerDesktopRequestUpdate'),
```

Add `desktopBridgeGetUpdateInfo` and `desktopBridgeRequestUpdate` to the remote-page allowlist in `webview_policy.go`; do not add them to bootstrap or Local Dev allowlists.

In `bindDesktopWindowBridge`, construct one Windows controller and bind:

```go
{desktopGetUpdateInfoBinding, func() (desktopUpdateInfo, error) {
	if err := authorize(desktopBridgeGetUpdateInfo); err != nil { return desktopUpdateInfo{}, err }
	return updateController.Info()
}},
{desktopRequestUpdateBinding, func() error {
	if err := authorize(desktopBridgeRequestUpdate); err != nil { return err }
	if err := updateController.Start(os.Getpid()); err != nil { return err }
	postWindowClose(hwnd)
	return nil
}},
```

The close call must remain after successful `Start`.

- [ ] **Step 8: Run and format Desktop tests**

Run:

```powershell
cd server
gofmt -w cmd/wheelmaker-desktop/desktop_update.go cmd/wheelmaker-desktop/desktop_update_windows.go cmd/wheelmaker-desktop/desktop_update_test.go cmd/wheelmaker-desktop/desktop_bridge.go cmd/wheelmaker-desktop/webview_policy.go cmd/wheelmaker-desktop/webview_policy_test.go cmd/wheelmaker-desktop/webview_windows.go cmd/wheelmaker-desktop/webview_windows_test.go
go test ./cmd/wheelmaker-desktop -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add server/cmd/wheelmaker-desktop
git commit -m "feat(desktop): expose secure self-update bridge"
```

### Task 3: Add the one-shot Windows GUI updater

**Files:**
- Create: `server/cmd/wheelmaker-desktop-updater/updater.go`
- Create: `server/cmd/wheelmaker-desktop-updater/updater_test.go`
- Create: `server/cmd/wheelmaker-desktop-updater/main_windows.go`
- Create: `server/cmd/wheelmaker-desktop-updater/main_other.go`

- [ ] **Step 1: Write failing orchestration tests**

Create `updater_test.go` with injected functions and ordered events:

```go
package main

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func TestRunUpdaterWaitsUpdatesAndRestarts(t *testing.T) {
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(pid uint32) error { events = append(events, fmt.Sprintf("wait:%d", pid)); return nil },
		runUpdate: func() error { events = append(events, "update"); return nil },
		showError: func(error) { events = append(events, "message") },
		restart: func() error { events = append(events, "restart"); return nil },
	})
	if err != nil { t.Fatal(err) }
	want := []string{"wait:42", "update", "restart"}
	if !reflect.DeepEqual(events, want) { t.Fatalf("events=%v want=%v", events, want) }
}

func TestRunUpdaterShowsFailureAndRestartsOldDesktop(t *testing.T) {
	updateErr := errors.New("download failed")
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error { events = append(events, "wait"); return nil },
		runUpdate: func() error { events = append(events, "update"); return updateErr },
		showError: func(err error) { events = append(events, "message:"+err.Error()) },
		restart: func() error { events = append(events, "restart"); return nil },
	})
	if !errors.Is(err, updateErr) { t.Fatalf("error=%v", err) }
	want := []string{"wait", "update", "message:download failed", "restart"}
	if !reflect.DeepEqual(events, want) { t.Fatalf("events=%v want=%v", events, want) }
}
```

- [ ] **Step 2: Run updater tests to verify RED**

Run:

```powershell
cd server
go test ./cmd/wheelmaker-desktop-updater -count=1
```

Expected: FAIL because the package and `runUpdater` do not exist.

- [ ] **Step 3: Implement pure ordered orchestration**

Create `updater.go`:

```go
package main

import (
	"errors"
	"fmt"
)

type updaterDependencies struct {
	waitForParent func(uint32) error
	runUpdate     func() error
	showError     func(error)
	restart       func() error
}

func runUpdater(parentPID uint32, deps updaterDependencies) error {
	if parentPID == 0 { return errors.New("parent PID is required") }
	if err := deps.waitForParent(parentPID); err != nil { return fmt.Errorf("wait for Desktop: %w", err) }
	updateErr := deps.runUpdate()
	if updateErr != nil { deps.showError(updateErr) }
	restartErr := deps.restart()
	if updateErr != nil || restartErr != nil { return errors.Join(updateErr, restartErr) }
	return nil
}
```

Add these boundary tests to the same file:

```go
func TestRunUpdaterRejectsZeroPID(t *testing.T) {
	if err := runUpdater(0, updaterDependencies{}); err == nil {
		t.Fatal("expected a parent PID error")
	}
}

func TestRunUpdaterStopsWhenWaitFails(t *testing.T) {
	waitErr := errors.New("wait failed")
	updated, restarted := false, false
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error { return waitErr },
		runUpdate: func() error { updated = true; return nil },
		showError: func(error) {},
		restart: func() error { restarted = true; return nil },
	})
	if !errors.Is(err, waitErr) || updated || restarted {
		t.Fatalf("error=%v updated=%v restarted=%v", err, updated, restarted)
	}
}

func TestRunUpdaterReturnsRestartFailure(t *testing.T) {
	restartErr := errors.New("restart failed")
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error { return nil },
		runUpdate: func() error { return nil },
		showError: func(error) {},
		restart: func() error { return restartErr },
	})
	if !errors.Is(err, restartErr) { t.Fatalf("error=%v", err) }
}
```

- [ ] **Step 4: Implement Windows fixed paths and process waiting**

Create `main_windows.go` with a strict two-argument parser that accepts `--parent-pid` followed by a positive decimal PID. Resolve only:

```go
home, _ := os.UserHomeDir()
root := filepath.Join(home, ".wheelmaker")
deploy := filepath.Join(root, "deploy.mjs")
desktop := filepath.Join(root, "desktop", "WheelMakerDesktop.exe")
```

Implement `waitForParent` with `windows.OpenProcess(windows.SYNCHRONIZE, false, pid)`, `windows.WaitForSingleObject(handle, windows.INFINITE)`, and `windows.CloseHandle`. Treat `windows.ERROR_INVALID_PARAMETER` from `OpenProcess` as an already-exited PID; propagate every other open error. Accept only `windows.WAIT_OBJECT_0` from the wait call and return an error for every other status.

Implement the update command and restart with fixed arguments:

```go
nodePath, err := exec.LookPath("node.exe")
cmd := exec.Command(nodePath, deploy, "desktop-update")
cmd.Dir = root
shared.ConfigureBackgroundCommand(cmd)
output, err := cmd.CombinedOutput()
```

Wrap failures with the final non-empty UTF-8 output. Restart only `desktop` with `exec.Command(desktop).Start()`. Show errors using `MessageBoxW` with an error icon; do not open a console.

- [ ] **Step 5: Add a non-Windows unsupported main**

Create `main_other.go` behind `//go:build !windows` with a `main` that writes `WheelMaker Desktop updater is supported on Windows only` to stderr and exits non-zero. This keeps `go build ./...` valid on other development hosts without adding non-Windows behavior.

- [ ] **Step 6: Format, test, and compile the GUI binary**

Run:

```powershell
cd server
gofmt -w cmd/wheelmaker-desktop-updater
go test ./cmd/wheelmaker-desktop-updater -count=1
New-Item -ItemType Directory -Force -Path ..\.tmp | Out-Null
go build -trimpath -ldflags="-H windowsgui" -o ..\.tmp\update.exe ./cmd/wheelmaker-desktop-updater
Remove-Item -LiteralPath ..\.tmp\update.exe -Force
```

Expected: tests PASS and Windows GUI build exits 0.

- [ ] **Step 7: Commit**

```powershell
git add server/cmd/wheelmaker-desktop-updater
git commit -m "feat(desktop): add one-shot Windows updater"
```

### Task 4: Include `update.exe` in every Windows platform package

**Files:**
- Modify: `scripts/release/build.mjs:105-135`
- Modify: `scripts/release/build.test.mjs:40-145,330-380`

- [ ] **Step 1: Write a failing package-layout test**

Extend `platform directories preserve the Hub and Web package layout`:

```js
const windows = result.platforms.find(platform => platform.key === 'windows-amd64');
assert.equal(await readExists(join(windows.directory, 'desktop', 'update.exe')), true);
for (const platform of result.platforms.filter(item => item.key !== 'windows-amd64')) {
  assert.equal(await readExists(join(platform.directory, 'desktop', 'update.exe')), false);
}
const updaterBuilds = runner.calls.filter(({command, args}) =>
  command === 'go' && args.at(-1) === './cmd/wheelmaker-desktop-updater');
assert.equal(updaterBuilds.length, 1);
assert.equal(updaterBuilds[0].options.env.GOOS, 'windows');
assert.equal(updaterBuilds[0].args.includes('-ldflags=-H windowsgui'), true);
```

Run the same assertion once with `withDesktop: false` and keep the existing optional Desktop test proving `WheelMakerDesktop.exe` remains separate.

- [ ] **Step 2: Run the build test to verify RED**

Run: `node --test scripts/release/build.test.mjs`

Expected: FAIL because the Windows platform directory lacks `desktop/update.exe`.

- [ ] **Step 3: Build the updater inside the Windows platform job**

After the Windows Hub build and before assigning `platforms[index]`, add:

```js
if (target.GOOS === 'windows') {
  const updaterDirectory = join(directory, 'desktop');
  const updaterPath = join(updaterDirectory, 'update.exe');
  await mkdir(updaterDirectory, {recursive: true});
  await runner('go', [
    'build',
    '-trimpath',
    '-ldflags=-H windowsgui',
    '-o',
    updaterPath,
    './cmd/wheelmaker-desktop-updater',
  ], {
    cwd: serverRoot,
    env: {
      CGO_ENABLED: '0',
      ...buildEnvironment,
      GOARCH: 'amd64',
      GOOS: 'windows',
    },
  });
}
```

Do not add a separate top-level build job; keep Hub and updater outputs owned by the Windows package task.

- [ ] **Step 4: Run release build tests**

Run: `node --test scripts/release/build.test.mjs scripts/release/publish.test.mjs`

Expected: PASS. The archive packager continues to include the complete platform directory recursively.

- [ ] **Step 5: Commit**

```powershell
git add scripts/release/build.mjs scripts/release/build.test.mjs
git commit -m "feat(release): package the Desktop updater on Windows"
```

### Task 5: Install the helper without replacing the Desktop executable

**Files:**
- Modify: `scripts/deploy/deploy-core.mjs:1625-1670`
- Modify: `scripts/deploy/deploy-core.test.mjs:440-575,930-1045,1060-1130`

- [ ] **Step 1: Extend the Windows fixture and write failing preservation assertions**

For `platform === 'win32'`, make `installFixture` create `package/desktop/update.exe` containing `new-updater`. Extend the normal deploy test:

```js
assert.equal(
  await readFile(join(fixture.home, 'desktop', 'update.exe'), 'utf8'),
  'new-updater',
);
assert.equal(
  await readFile(join(fixture.home, 'desktop', 'WheelMakerDesktop.exe'), 'utf8'),
  'desktop',
);
```

Extend the successful internal update test with the same updater assertion, proving `node deploy.mjs update` installs the helper without runtime reconfiguration. Add a Linux assertion that no desktop directory is required or created.

- [ ] **Step 2: Run deploy tests to verify RED**

Run: `node --test scripts/deploy/deploy-core.test.mjs`

Expected: FAIL because `applyStagedPackage` ignores the packaged updater.

- [ ] **Step 3: Stage and atomically replace only the Windows helper**

In `applyStagedPackage`, resolve and require the helper only on Windows:

```js
const sourceUpdater = platform === 'win32'
  ? join(extractionDirectory, 'desktop', 'update.exe')
  : null;
if (sourceUpdater) await access(sourceUpdater);

const desktopDirectory = join(home, 'desktop');
const targetUpdater = join(desktopDirectory, 'update.exe');
const temporaryUpdater = join(desktopDirectory, `.update.exe.${jobId}.tmp`);
```

Create `desktopDirectory`, copy and chmod the temporary updater, then call `replaceInstalledFile(temporaryUpdater, targetUpdater, ...)` in the same applying phase. Clean only `temporaryUpdater` in `finally`. Never remove `desktopDirectory` and never address `WheelMakerDesktop.exe` in this function.

- [ ] **Step 4: Run deploy and launcher tests**

Run:

```powershell
node --test scripts/deploy/deploy-core.test.mjs scripts/deploy/deploy.test.mjs
```

Expected: PASS; the existing `desktop-update` and `update_exe.bat` tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs
git commit -m "feat(deploy): install the Desktop updater helper"
```

### Task 6: Render the startup check, retry entry, and WheelMaker red dot

**Files:**
- Modify: `app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx:1-205`
- Modify: `app/web/src/styles/shell.css:165-200,1750-1795`
- Modify: `app/__tests__/web-desktop-titlebar.test.tsx`

- [ ] **Step 1: Write failing titlebar state and ordering tests**

Add a fetch restore in `afterEach`, then test a bridge with both update methods. Assert initial checking, resolved available state, ordering after Dev Mode, both red-dot markers, and update invocation:

```tsx
expect(menuItems.map(item => item.props['data-desktop-extension-action'])).toEqual([
  'local-dev',
  'desktop-update',
]);
expect(root.findByProps({'data-desktop-update-label': true}).children).toContain('Update Desktop to v1.22');
expect(root.findByProps({'data-desktop-update-dot': 'titlebar'})).toBeDefined();
expect(root.findByProps({'data-desktop-update-dot': 'menu'})).toBeDefined();

await ReactTestRenderer.act(async () => {
  root.findByProps({'data-desktop-extension-action': 'desktop-update'}).props.onClick();
});
expect(requestDesktopUpdate).toHaveBeenCalledTimes(1);
```

Add tests for:

- matching SHA renders `Desktop is up to date` and a disabled button with no red dot;
- failed fetch renders `Check failed · Retry`, clicking it issues a second check;
- Local Dev bridge and ordinary browser render no Desktop update entry;
- rejected `requestDesktopUpdate` keeps the window alive and changes the item to retry state.

- [ ] **Step 2: Run titlebar tests to verify RED**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-desktop-titlebar.test.tsx
```

Expected: FAIL because the menu has only Dev Mode and no update state.

- [ ] **Step 3: Add one startup effect and retry/update handlers**

Import `useCallback` and `useEffect`. Add these hooks before the existing `if (!bridge) return null` so browser and Desktop renders keep the same hook order. Enable the capability only when both native methods exist and `bridge.localDev` is absent, then include it in the existing Windows extensions visibility condition:

```tsx
const canUpdateDesktop = Boolean(
  bridge?.getDesktopUpdateInfo && bridge?.requestDesktopUpdate && !bridge?.localDev,
);
const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateCheck>({status: 'checking'});
const [desktopUpdateBusy, setDesktopUpdateBusy] = useState(false);

const refreshDesktopUpdate = useCallback(async () => {
  if (!bridge || !canUpdateDesktop) return;
  setDesktopUpdate({status: 'checking'});
  setDesktopUpdate(await checkDesktopUpdate(bridge));
}, [bridge, canUpdateDesktop]);

useEffect(() => {
  void refreshDesktopUpdate();
}, [refreshDesktopUpdate]);

if (!bridge) return null;
const hasWindowsExtensions = Boolean(
  bridge.requestLocalDevMode || bridge.localDev || canUpdateDesktop,
);
```

Do not add an interval. The failed menu action calls `refreshDesktopUpdate`; the available action sets busy, calls the no-argument native method, and on rejection returns to `{status: 'failed'}`.

- [ ] **Step 4: Render the permanent menu item directly after Dev Mode**

Use one button with `data-desktop-extension-action="desktop-update"`. Labels are exact:

```ts
checking: 'Checking Desktop update…'
current: 'Desktop is up to date'
available: `Update Desktop to ${desktopUpdate.version}`
failed: 'Check failed · Retry'
```

Disable checking/current/busy states. Render a menu red-dot span only for `available`, and render a titlebar red-dot span inside the Windows extensions button only for `available`. Keep the item visible whenever `canUpdateDesktop` is true.

- [ ] **Step 5: Style accessible WheelMaker red dots and disabled state**

Add focused CSS without changing control width:

```css
.desktop-windows-extension-button { position: relative; }
.desktop-update-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 999px;
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--surface-panel);
}
.desktop-windows-extension-button .desktop-update-dot {
  position: absolute;
  top: 8px;
  right: 9px;
}
.desktop-windows-extension-menu button:disabled {
  cursor: default;
  color: var(--text-secondary);
  opacity: 0.72;
}
```

Use the existing `--danger` token from `tokens.css`; do not introduce a hard-coded unrelated green or blue.

- [ ] **Step 6: Run UI tests and typecheck**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-desktop-titlebar.test.tsx __tests__/web-desktop-update.test.ts __tests__/web-agent-package-update-settings.test.ts
npm run tsc:web
```

Expected: all suites PASS and TypeScript exits 0.

- [ ] **Step 7: Commit**

```powershell
git add app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx app/web/src/styles/shell.css app/__tests__/web-desktop-titlebar.test.tsx
git commit -m "feat(app): surface Desktop self-update in the titlebar"
```

### Task 7: Run cross-layer acceptance and hand off without publishing

**Files:**
- Verify: `docs/scope/2026-07-18-desktop-self-update/spec-desktop-self-update.md`
- Verify: `docs/wiki/features/desktop-self-update.md`
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Re-run focused acceptance suites**

Run:

```powershell
cd D:\Code\WheelMaker\server
go test ./cmd/wheelmaker-desktop ./cmd/wheelmaker-desktop-updater -count=1

cd D:\Code\WheelMaker
node --test scripts/release/build.test.mjs scripts/release/publish.test.mjs scripts/deploy/deploy-core.test.mjs scripts/deploy/deploy.test.mjs

cd D:\Code\WheelMaker\app
npm test -- --runInBand __tests__/web-agent-package-update-settings.test.ts __tests__/web-desktop-update.test.ts __tests__/web-desktop-titlebar.test.tsx
npm run tsc:web
```

Expected: every command exits 0.

- [ ] **Step 2: Run full Go and deployment/release regression suites**

Run:

```powershell
cd D:\Code\WheelMaker\server
go test ./... -count=1

cd D:\Code\WheelMaker
$nodeTests = @(
  Get-ChildItem scripts/deploy -Filter *.test.mjs -File
  Get-ChildItem scripts/release -Filter *.test.mjs -File
  Get-ChildItem scripts/release-server -Filter *.test.mjs -File
) | ForEach-Object { $_.FullName }
node --test $nodeTests
git diff --check
```

Expected: all Go packages and Node tests PASS; `git diff --check` emits no errors.

- [ ] **Step 3: Build the actual Windows updater once**

Run:

```powershell
cd D:\Code\WheelMaker\server
New-Item -ItemType Directory -Force -Path ..\.tmp | Out-Null
go build -trimpath -ldflags="-H windowsgui" -o ..\.tmp\update.exe ./cmd/wheelmaker-desktop-updater
Get-Item ..\.tmp\update.exe | Select-Object Name,Length
Remove-Item -LiteralPath ..\.tmp\update.exe -Force
```

Expected: `update.exe` exists with non-zero length before cleanup.

- [ ] **Step 4: Check the approved scope line by line**

Confirm from tests and diff that:

```text
startup check is one-shot and non-blocking
menu item is permanent and below Dev Mode
available is the only red-dot state
remote Web passes no command/path/URL/version/hash to native
native closes only after fixed updater starts
helper waits, updates, reports failure, and always relaunches
Windows package and deploy install update.exe while preserving Desktop
Local Dev/browser/non-Windows have no update bridge
updater uses no elevation and does not change Hub registration or runtime state
update_exe.bat remains present
no Registry protocol version changed
```

- [ ] **Step 5: Mark the implementation plan complete**

In `docs/scope/2026-07-18-desktop-self-update/plan-desktop-self-update.md`, change each completed step marker from `- [ ]` to `- [x]`, then run:

```powershell
rg -n "^- \[ \]" docs/scope/2026-07-18-desktop-self-update/plan-desktop-self-update.md
git status --short
git diff --check
```

Expected: `rg` has no matches, the plan file is part of the final source diff, and `git diff --check` emits no errors.

- [ ] **Step 6: Push source only**

Run the repository completion gate exactly:

```powershell
git add -A
git commit -m "feat: add Windows Desktop self-update"
git push origin main
```

Do not run `scripts/release.mjs --publish`, `publish-release.bat`, or any release-server upload command.
