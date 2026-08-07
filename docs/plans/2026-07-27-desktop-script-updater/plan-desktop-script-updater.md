# Desktop Script Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows Desktop self-update helper EXE with the existing visible `update_exe.bat` and trusted Node deployment scripts, while preserving the old-helper upgrade bridge.

**Architecture:** `WheelMakerDesktop.exe` launches one fixed BAT through visible `cmd.exe` and passes only its PID. `deploy.mjs` validates and forwards the new command shape; `deploy-core.mjs` waits for that exact PID, then reuses the existing verified Desktop replacement. Windows packages stop carrying `desktop/update.exe`; full installs write the capable BAT, while the legacy `desktop-update` route refreshes it only when its direct parent is the installed old helper.

**Tech Stack:** Go 1.24, Node.js 22 ESM, Windows `cmd.exe`/PowerShell, `node:test`

---

## Working-tree guard

The worktree already contains unrelated user edits in:

- `server/internal/flickerbridge/flicker_bridge_test.go`
- `server/internal/hub/agent/agent_test.go`
- `server/internal/hub/client/client_test.go`

Do not edit or stage these paths. Every intermediate commit below uses explicit paths. Before the repository-mandated final `git add -A`, verify those user changes are no longer present or obtain explicit user authorization; otherwise stop before that destructive ownership boundary and report the blocker.

### Task 1: Commit the approved design baseline

**Files:**

- Add: `docs/scope/2026-07-27-desktop-script-updater.md`
- Add: `docs/plans/2026-07-27-desktop-script-updater/plan-desktop-script-updater.md`
- Modify: `docs/wiki/release-and-build/desktop-self-update.md`
- Modify: `docs/wiki/release-and-build/build.md`
- Modify: `docs/wiki/release-and-build/release.md`

- [ ] **Step 1: Re-read the approved behavior**

Run:

```powershell
Get-Content -Raw docs/scope/2026-07-27-desktop-script-updater.md
Get-Content -Raw docs/plans/2026-07-27-desktop-script-updater/plan-desktop-script-updater.md
```

Expected: the spec and plan agree on visible CMD, exact PID waiting, no automatic restart, capability gating, old-helper transition, and preservation—not installation—of legacy `update.exe`.

- [ ] **Step 2: Check the documentation diff**

Run:

```powershell
git diff --check -- docs/scope/2026-07-27-desktop-script-updater.md docs/wiki/release-and-build
git diff -- docs/scope/2026-07-27-desktop-script-updater.md docs/wiki/release-and-build
```

Expected: no whitespace errors and no claim that the new implementation is already shipped.

- [ ] **Step 3: Commit only the design documents**

```powershell
git add docs/scope/2026-07-27-desktop-script-updater.md docs/plans/2026-07-27-desktop-script-updater/plan-desktop-script-updater.md docs/wiki/release-and-build/desktop-self-update.md docs/wiki/release-and-build/build.md docs/wiki/release-and-build/release.md
git commit -m "docs: design script-based desktop updater"
```

### Task 2: Teach the trusted launcher the fixed self-update command

**Files:**

- Modify: `scripts/deploy/deploy.test.mjs`
- Modify: `scripts/deploy/deploy.mjs`

- [ ] **Step 1: Add failing argument-shape tests**

In `scripts/deploy/deploy.test.mjs`, import `parseDeployArgs` if it is not already imported and add:

```js
test('Desktop self-update accepts only a positive parent PID', () => {
  assert.deepEqual(
    parseDeployArgs(['desktop-self-update', '--parent-pid', '42']),
    ['desktop-self-update', '--parent-pid', '42'],
  );

  for (const args of [
    ['desktop-self-update'],
    ['desktop-self-update', '--parent-pid'],
    ['desktop-self-update', '--parent-pid', '0'],
    ['desktop-self-update', '--parent-pid', '-1'],
    ['desktop-self-update', '--parent-pid', '1.5'],
    ['desktop-self-update', '--parent-pid', 'pid'],
    ['desktop-self-update', '--parent-pid', '42', 'extra'],
    ['desktop-self-update', '--other', '42'],
  ]) {
    assert.throws(() => parseDeployArgs(args), /unknown deploy command/);
  }
});
```

Add a forwarding/status test using the existing `launcherFixture`:

```js
test('launcher forwards Desktop self-update without owning its lifecycle', async () => {
  const deps = launcherFixture({});
  const statuses = [];
  deps.reportStatus = (message) => statuses.push(message);

  await runLauncher(
    ['desktop-self-update', '--parent-pid', '42'],
    deps,
  );
  assert.equal(
    deps.events.at(-1),
    'run-core:desktop-self-update,--parent-pid,42',
  );
  assert.match(statuses.at(-1), /Desktop self-update/);
});
```

- [ ] **Step 2: Run the focused launcher tests and observe failure**

Run:

```powershell
node --test --test-name-pattern="Desktop self-update|unknown deploy command|forwards" scripts/deploy/deploy.test.mjs
```

Expected: FAIL because `desktop-self-update` is not accepted.

- [ ] **Step 3: Implement exact validation and a dedicated status**

In `scripts/deploy/deploy.mjs`, keep `desktop-self-update` out of the single-token `ALLOWED_COMMANDS` set and add an exact branch before the generic one-token check:

```js
function isPositiveDecimalPID(value) {
  if (!/^[1-9]\d*$/.test(value ?? '')) return false;
  const pid = Number(value);
  return Number.isSafeInteger(pid);
}

export function parseDeployArgs(args) {
  if (args.length === 0) {
    return [];
  }
  if (args.length === 2 && args[0] === 'runtime' && RUNTIME_ACTIONS.has(args[1])) {
    return ['runtime', args[1]];
  }
  if (
    args.length === 3 &&
    args[0] === 'desktop-self-update' &&
    args[1] === '--parent-pid' &&
    isPositiveDecimalPID(args[2])
  ) {
    return [...args];
  }
  if (args.length !== 1 || !ALLOWED_COMMANDS.has(args[0])) {
    throw new Error(`unknown deploy command: ${args.join(' ')}`);
  }
  return [args[0]];
}
```

Add a specific operation label without putting update mechanics in the launcher:

```js
: args[0] === 'desktop-self-update'
  ? 'Starting Desktop self-update'
```

- [ ] **Step 4: Run the full launcher suite**

Run:

```powershell
node --test scripts/deploy/deploy.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit launcher routing**

```powershell
git add scripts/deploy/deploy.mjs scripts/deploy/deploy.test.mjs
git commit -m "feat: route desktop self-update command"
```

### Task 3: Put self-update lifecycle and BAT interaction in deploy-core

**Files:**

- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`

- [ ] **Step 1: Specify the BAT contract with a failing test**

Update the existing wrapper test to require one stable capability marker and both modes:

```js
const desktopUpdateWrapper = windows['update_exe.bat'];
assert.match(
  desktopUpdateWrapper,
  /^@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n/,
);
assert.match(
  desktopUpdateWrapper,
  /if "%~1"=="" goto manual_update/,
);
assert.match(
  desktopUpdateWrapper,
  /desktop-self-update --parent-pid "%~1"/,
);
assert.match(desktopUpdateWrapper, /:manual_update/);
assert.match(desktopUpdateWrapper, /deploy\.mjs" desktop-update/);
assert.match(desktopUpdateWrapper, /set "_EXIT_CODE=%errorlevel%"/);
assert.match(desktopUpdateWrapper, /start WheelMakerDesktop\.exe manually/i);
assert.match(desktopUpdateWrapper, /\r\npause\r\n/);
assert.match(desktopUpdateWrapper, /exit \/b %_EXIT_CODE%/);
```

Use this exact generated BAT body in `windowsWrappers`:

```js
'update_exe.bat': `${DESKTOP_SELF_UPDATE_CAPABILITY}\r\n@echo off\r\nsetlocal\r\nif "%~1"=="" goto manual_update\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)} desktop-self-update --parent-pid "%~1"\r\nset "_EXIT_CODE=%errorlevel%"\r\ngoto update_finished\r\n:manual_update\r\n${windowsBatchQuote(paths.node)} ${windowsBatchQuote(paths.deploy)} desktop-update\r\nset "_EXIT_CODE=%errorlevel%"\r\n:update_finished\r\necho.\r\nif "%_EXIT_CODE%"=="0" (\r\n  echo Desktop update completed. Close this window and start WheelMakerDesktop.exe manually.\r\n) else (\r\n  echo Desktop update failed with exit code %_EXIT_CODE%. Review the log above.\r\n)\r\necho.\r\npause\r\nexit /b %_EXIT_CODE%\r\n`,
```

Capturing `%errorlevel%` immediately after each Node invocation is required; `goto` must not run first.

- [ ] **Step 2: Add failing exact-PID lifecycle tests**

Add this fixture next to the current Desktop update tests so every test receives a valid stable pointer and an isolated installed EXE:

```js
async function createDesktopUpdateFixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wheelmaker-desktop-update-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const home = join(root, '.wheelmaker');
  const target = join(home, 'desktop', 'WheelMakerDesktop.exe');
  const desktop = overrides.desktop ?? Buffer.from('desktop-v1.2');
  await mkdir(join(home, 'desktop'), {recursive: true});
  await writeFile(target, 'old-desktop');

  return {
    desktop,
    home,
    target,
    deps: {
      fetchBytes: overrides.fetchBytes ?? (async () => desktop),
      installDirectory: home,
      isDesktopRunning: overrides.isDesktopRunning ?? (async () => false),
      platform: 'win32',
      trustedReleaseBaseUrl: 'https://release.example',
      trustedStable: {
        schema: 2,
        version: 'v1.3',
        desktopExe: {
          version: 'v1.2',
          path: '/releases/v1.2/WheelMakerDesktop.exe',
          sha256: sha256Bytes(desktop),
        },
      },
      ...(overrides.waitForDesktopExit
        ? {waitForDesktopExit: overrides.waitForDesktopExit}
        : {}),
    },
  };
}
```

Then add tests around `runCore`:

```js
test('Desktop self-update waits for the exact PID before checking other instances', async (t) => {
  const events = [];
  const desktop = Buffer.from('desktop-v1.2');
  const fixture = await createDesktopUpdateFixture(t, {
    desktop,
    waitForDesktopExit: async (pid) => {
      events.push(`wait:${pid}`);
    },
    isDesktopRunning: async () => {
      events.push('check-running');
      return false;
    },
    fetchBytes: async () => {
      events.push('download');
      return desktop;
    },
  });

  await runCore(
    ['desktop-self-update', '--parent-pid', '42'],
    fixture.deps,
  );

  assert.deepEqual(events, ['wait:42', 'check-running', 'download']);
});

test('Desktop self-update stops when waiting for the parent PID fails', async (t) => {
  let downloadCalls = 0;
  const fixture = await createDesktopUpdateFixture(t, {
    waitForDesktopExit: async () => {
      throw new Error('wait failed');
    },
    fetchBytes: async () => {
      downloadCalls += 1;
      return Buffer.from('new-desktop');
    },
  });
  await assert.rejects(
    () => runCore(
      ['desktop-self-update', '--parent-pid', '42'],
      fixture.deps,
    ),
    /wait failed/,
  );
  assert.equal(downloadCalls, 0);
});
```

Refactor the existing “carried stable pointer” and “running executable” cases to use `createDesktopUpdateFixture` without weakening their current assertions. Keep the current coverage for download/hash failure, temporary cleanup, and replacement failure.

Also add defensive core-shape cases:

```js
for (const args of [
  ['desktop-self-update'],
  ['desktop-self-update', '--parent-pid', '0'],
  ['desktop-self-update', '--parent-pid', 'abc'],
  ['desktop-self-update', '--parent-pid', '42', 'extra'],
]) {
  await assert.rejects(() => runCore(args, {}), /parent PID|not implemented/);
}
```

- [ ] **Step 3: Add failing legacy transition tests**

Prove that only the old helper path refreshes the BAT:

```js
test('legacy updater-driven desktop-update refreshes the capable BAT', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  await runCore(['desktop-update'], {
    ...fixture.deps,
    isLegacyDesktopUpdaterParent: async () => true,
  });
  const wrapper = await readFile(
    join(fixture.home, 'update_exe.bat'),
    'utf8',
  );
  assert.match(wrapper, /^@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n/);
});

test('manual desktop-update does not rewrite its running BAT', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  const wrapperPath = join(fixture.home, 'update_exe.bat');
  await writeFile(wrapperPath, 'manual-wrapper');
  await runCore(['desktop-update'], {
    ...fixture.deps,
    isLegacyDesktopUpdaterParent: async () => false,
  });
  assert.equal(await readFile(wrapperPath, 'utf8'), 'manual-wrapper');
});
```

Add one adapter test whose fake `runner` verifies the PowerShell query uses `process.ppid` (or an injected `parentPID`) and compares against exactly:

```text
`join(resolve(installDirectory), 'desktop', 'update.exe')`
```

case-insensitively. Exercise it through `runCore` without exporting the adapter:

```js
test('desktop-update recognizes only the installed legacy helper parent', async (t) => {
  const fixture = await createDesktopUpdateFixture(t);
  const runnerCalls = [];
  await runCore(['desktop-update'], {
    ...fixture.deps,
    parentPID: 123,
    runner: async (command, args, options) => {
      runnerCalls.push({command, args, options});
      return {code: 1, stderr: '', stdout: ''};
    },
  });

  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0].command, 'powershell');
  assert.equal(runnerCalls[0].options.allowFailure, true);
  const script = runnerCalls[0].args.at(-1);
  assert.match(script, /ProcessId = 123/);
  assert.match(script, /desktop[\\/]update\.exe/i);
  assert.match(script, /OrdinalIgnoreCase/);
  assert.equal(
    await exists(join(fixture.home, 'update_exe.bat')),
    false,
  );
});
```

Returning code `1` models a missing, inaccessible, or different parent and must not turn manual recovery into a failure.

- [ ] **Step 4: Run focused core tests and observe failure**

Run:

```powershell
node --test --test-name-pattern="helper wrappers|Desktop self-update|legacy updater-driven|manual desktop-update" scripts/deploy/deploy-core.test.mjs
```

Expected: FAIL because the BAT has one mode and core has no exact-PID branch.

- [ ] **Step 5: Implement the capable wrapper**

In `scripts/deploy/deploy-core.mjs`, export one shared JS marker constant:

```js
export const DESKTOP_SELF_UPDATE_CAPABILITY =
  '@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1';
```

Generate the exact BAT from Step 1 in `windowsWrappers(paths)`. Add a narrow writer used by the compatibility path:

```js
async function writeWindowsDesktopUpdateWrapper(paths) {
  const body = windowsWrappers(paths)['update_exe.bat'];
  const path = join(paths.home, 'update_exe.bat');
  await atomicWrite(path, Buffer.from(body, 'utf8'), 0o644);
  await chmod(path, 0o644);
}
```

- [ ] **Step 6: Implement exact PID parsing and waiting**

Add a defensive parser in core:

```js
function parseDesktopSelfUpdatePID(args) {
  if (
    args.length !== 3 ||
    args[0] !== 'desktop-self-update' ||
    args[1] !== '--parent-pid' ||
    !/^[1-9]\d*$/.test(args[2] ?? '')
  ) {
    throw new Error('Desktop self-update parent PID must be a positive integer');
  }
  const pid = Number(args[2]);
  if (!Number.isSafeInteger(pid)) {
    throw new Error('Desktop self-update parent PID must be a positive integer');
  }
  return pid;
}
```

Add the Windows adapter:

```js
async function waitForDesktopExit(pid, platform, runner) {
  if (platform !== 'win32') {
    throw new Error('WheelMaker Desktop update is supported on Windows only');
  }
  await runner('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $process) { Wait-Process -Id ${pid} -ErrorAction Stop }`,
  ]);
}
```

Dispatch it before `executeDesktopUpdate`:

```js
if (args[0] === 'desktop-self-update') {
  const parentPID = parseDesktopSelfUpdatePID(args);
  const platform = deps.platform ?? process.platform;
  const runner = deps.runner ?? runProcess;
  const wait = deps.waitForDesktopExit ??
    ((pid) => waitForDesktopExit(pid, platform, runner));
  deps.reportStatus?.(`Waiting for WheelMaker Desktop process ${parentPID}`);
  await wait(parentPID);
  deps.reportStatus?.('Updating WheelMaker Desktop');
  await executeDesktopUpdate(deps);
  deps.reportStatus?.('Desktop update completed');
  return;
}
```

This ordering is mandatory: wait for the exact initiating PID first, then let the existing process-name check reject any second Desktop instance before download or replacement.

- [ ] **Step 7: Implement old-helper detection without touching manual BAT execution**

Add an adapter that queries the current Node process's direct parent executable and returns a boolean:

```js
async function detectLegacyDesktopUpdaterParent({
  installDirectory,
  parentPID = process.ppid,
  platform,
  runner,
}) {
  if (platform !== 'win32') return false;
  const expected = join(resolve(installDirectory), 'desktop', 'update.exe');
  const result = await runner(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        `$expected = [IO.Path]::GetFullPath(${psQuote(expected)})`,
        `$parent = Get-CimInstance Win32_Process -Filter "ProcessId = ${parentPID}" -ErrorAction SilentlyContinue`,
        'if ($null -ne $parent.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($parent.ExecutablePath), $expected)) { exit 0 }',
        'exit 1',
      ].join('; '),
    ],
    { allowFailure: true },
  );
  return result.code === 0;
}
```

In the existing `desktop-update` branch, perform the transition write before replacing the Desktop EXE:

```js
const platform = deps.platform ?? process.platform;
const runner = deps.runner ?? runProcess;
const legacyParent = deps.isLegacyDesktopUpdaterParent ??
  (() => detectLegacyDesktopUpdaterParent({
    installDirectory: deps.installDirectory,
    parentPID: deps.parentPID ?? process.ppid,
    platform,
    runner,
  }));
if (await legacyParent()) {
  const paths = deploymentRuntimePaths({
    installDirectory: deps.installDirectory,
    nodePath: deps.nodePath ?? process.execPath,
    platform,
    uid: deps.uid,
    userHome: deps.userHome ?? homedir(),
  });
  await writeWindowsDesktopUpdateWrapper(paths);
}
await executeDesktopUpdate(deps);
```

Writing before EXE replacement ensures that an old helper which restarts Desktop immediately after its child exits can never install the new Desktop without first installing the BAT capability it requires.

- [ ] **Step 8: Run core tests**

Run:

```powershell
node --test scripts/deploy/deploy-core.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit core lifecycle**

```powershell
git add scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs
git commit -m "feat: update desktop through visible script"
```

### Task 4: Make Desktop launch only the capable fixed BAT in a visible CMD

**Files:**

- Modify: `server/cmd/wheelmaker-desktop/desktop_update_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_update_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_update.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_update_windows.go`
- Verify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`

- [ ] **Step 1: Replace updater-file tests with capability tests**

Change test fixtures from:

```text
~/.wheelmaker/desktop/update.exe
```

to:

```text
~/.wheelmaker/update_exe.bat
```

Write this first line in ready fixtures:

```text
@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1
```

Add failing cases:

```go
func TestDesktopUpdateInfoRequiresCapableFixedBAT(t *testing.T) {
    cases := []struct {
        name      string
        batBody   string
        writeBAT  bool
        wantReady bool
    }{
        {name: "missing"},
        {name: "old", batBody: "@echo off\r\nnode deploy.mjs desktop-update\r\n", writeBAT: true},
        {
            name:      "capable",
            batBody:   "@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
            writeBAT:  true,
            wantReady: true,
        },
    }
    for _, testCase := range cases {
        t.Run(testCase.name, func(t *testing.T) {
            home := t.TempDir()
            exe := filepath.Join(
                home,
                ".wheelmaker",
                "desktop",
                "WheelMakerDesktop.exe",
            )
            bat := filepath.Join(home, ".wheelmaker", "update_exe.bat")
            writeDesktopUpdateTestFile(t, exe, "desktop")
            if testCase.writeBAT {
                writeDesktopUpdateTestFile(t, bat, testCase.batBody)
            }
            controller := newDesktopUpdateController(desktopUpdateDependencies{
                userHome:   func() (string, error) { return home, nil },
                executable: func() (string, error) { return exe, nil },
                hashFile:   sha256File,
                readFile:   os.ReadFile,
            })

            info, err := controller.Info()
            if err != nil {
                t.Fatal(err)
            }
            wantSHA := sha256.Sum256([]byte("desktop"))
            if info.SHA256 != hex.EncodeToString(wantSHA[:]) {
                t.Fatalf("SHA256=%q", info.SHA256)
            }
            if info.UpdaterReady != testCase.wantReady {
                t.Fatalf("UpdaterReady=%v want=%v", info.UpdaterReady, testCase.wantReady)
            }
        })
    }
}

func TestDesktopUpdateStartRejectsOldBAT(t *testing.T) {
    home := t.TempDir()
    exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
    bat := filepath.Join(home, ".wheelmaker", "update_exe.bat")
    writeDesktopUpdateTestFile(t, exe, "desktop")
    writeDesktopUpdateTestFile(t, bat, "@echo off\r\n")
    startCalls := 0
    controller := newDesktopUpdateController(desktopUpdateDependencies{
        userHome:   func() (string, error) { return home, nil },
        executable: func() (string, error) { return exe, nil },
        hashFile:   sha256File,
        readFile:   os.ReadFile,
        startUpdater: func(string, int) error {
            startCalls++
            return nil
        },
    })

    err := controller.Start(42)
    if err == nil || !strings.Contains(err.Error(), "unavailable") {
        t.Fatalf("Start error=%v", err)
    }
    if startCalls != 0 {
        t.Fatalf("start calls=%d", startCalls)
    }
}

func TestDesktopUpdateStartRejectsInvalidPID(t *testing.T) {
    home := t.TempDir()
    exe := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
    bat := filepath.Join(home, ".wheelmaker", "update_exe.bat")
    writeDesktopUpdateTestFile(t, exe, "desktop")
    writeDesktopUpdateTestFile(
        t,
        bat,
        "@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1\r\n@echo off\r\n",
    )
    startCalls := 0
    controller := newDesktopUpdateController(desktopUpdateDependencies{
        userHome:   func() (string, error) { return home, nil },
        executable: func() (string, error) { return exe, nil },
        hashFile:   sha256File,
        readFile:   os.ReadFile,
        startUpdater: func(string, int) error {
            startCalls++
            return nil
        },
    })

    for _, pid := range []int{0, -1} {
        if err := controller.Start(pid); err == nil {
            t.Fatalf("Start(%d) succeeded", pid)
        }
    }
    if startCalls != 0 {
        t.Fatalf("start calls=%d", startCalls)
    }
}
```

Update the fixed-path launch assertion:

```go
wantBAT := filepath.Join(home, ".wheelmaker", "update_exe.bat")
if filepath.Clean(startedPath) != filepath.Clean(wantBAT) || startedPID != 42 {
    t.Fatalf("started path=%q pid=%d", startedPath, startedPID)
}
```

- [ ] **Step 2: Invert the Windows visibility test**

Replace the current hidden-helper expectation with:

```go
func TestWindowsDesktopUpdaterCommandUsesVisibleCMDWithFixedArguments(t *testing.T) {
    bat := filepath.Join(t.TempDir(), "update_exe.bat")
    cmd := newDesktopUpdaterCommand(bat, 42)
    wantArgs := []string{
        "cmd.exe",
        "/d",
        "/s",
        "/c",
        fmt.Sprintf(`call "%s" 42`, bat),
    }
    if !slices.Equal(cmd.Args, wantArgs) {
        t.Fatalf("args=%v want=%v", cmd.Args, wantArgs)
    }
    if cmd.SysProcAttr != nil && cmd.SysProcAttr.HideWindow {
        t.Fatal("Desktop updater command must be visible")
    }
}
```

Use standard-library comparison compatible with the repository's Go version, or retain the existing loop if preferred.

- [ ] **Step 3: Run the Go tests and observe failure**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop
Set-Location ..
```

Expected: FAIL because Desktop still targets `desktop/update.exe` and hides the command.

- [ ] **Step 4: Implement capability-aware fixed BAT resolution**

In `desktop_update.go`, replace `stat` with a small file reader dependency:

```go
const desktopSelfUpdateCapability = "@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1"

type desktopUpdateDependencies struct {
    userHome     func() (string, error)
    executable   func() (string, error)
    hashFile     func(string) (string, error)
    readFile     func(string) ([]byte, error)
    startUpdater func(string, int) error
}
```

Return the standard root BAT from `paths()`:

```go
root := filepath.Join(home, ".wheelmaker")
expected := filepath.Join(root, "desktop", "WheelMakerDesktop.exe")
// Keep the existing case-insensitive standard-install check.
return expected, filepath.Join(root, "update_exe.bat"), nil
```

Centralize readiness so both `Info` and `Start` use the same rule:

```go
func (c *desktopUpdateController) updaterReady(path string) bool {
    body, err := c.deps.readFile(path)
    if err != nil {
        return false
    }
    firstLine, _, _ := strings.Cut(
        strings.ReplaceAll(string(body), "\r\n", "\n"),
        "\n",
    )
    return firstLine == desktopSelfUpdateCapability
}
```

`Start` must reject `parentPID <= 0`, re-check the marker immediately before launch, and pass only the fixed path plus PID to `startUpdater`.

- [ ] **Step 5: Implement visible `cmd.exe` startup**

In `desktop_update_windows.go`, remove `shared.ConfigureBackgroundCommand` and build:

```go
func newDesktopUpdaterCommand(path string, parentPID int) *exec.Cmd {
    command := fmt.Sprintf(`call "%s" %d`, path, parentPID)
    return exec.Command("cmd.exe", "/d", "/s", "/c", command)
}
```

Keep the existing `Start`, `Process.Release`, and error propagation. Add `readFile: os.ReadFile` to `newWindowsDesktopUpdateController`.

- [ ] **Step 6: Verify close-after-success behavior remains intact**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop
Set-Location ..
```

Expected: PASS, including the existing source-level WebView test proving `postWindowClose` occurs only after `Start` returns successfully.

- [ ] **Step 7: Commit the Desktop bridge**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_update.go server/cmd/wheelmaker-desktop/desktop_update_windows.go server/cmd/wheelmaker-desktop/desktop_update_test.go server/cmd/wheelmaker-desktop/desktop_update_windows_test.go
git commit -m "feat: launch desktop update in visible cmd"
```

### Task 5: Remove the updater binary from build and deployment

**Files:**

- Modify: `scripts/release/build.test.mjs`
- Modify: `scripts/release/build.mjs`
- Modify: `scripts/deploy/deploy-core.test.mjs`
- Modify: `scripts/deploy/deploy-core.mjs`
- Delete: `server/cmd/wheelmaker-desktop-updater/main_other.go`
- Delete: `server/cmd/wheelmaker-desktop-updater/main_windows.go`
- Delete: `server/cmd/wheelmaker-desktop-updater/main_windows_test.go`
- Delete: `server/cmd/wheelmaker-desktop-updater/updater.go`
- Delete: `server/cmd/wheelmaker-desktop-updater/updater_test.go`

- [ ] **Step 1: Invert release build expectations**

In `scripts/release/build.test.mjs`, require that every platform lacks the helper and no updater Go build occurs:

```js
for (const platform of result.platforms) {
  assert.equal(
    await readExists(join(platform.directory, 'desktop', 'update.exe')),
    false,
  );
}
const updaterBuilds = runner.calls.filter(
  ({command, args}) =>
    command === 'go' &&
    args.at(-1) === './cmd/wheelmaker-desktop-updater',
);
assert.equal(updaterBuilds.length, 0);
```

In `release build routes Webpack and Go caches through the work root`, change the expected Go call count from five to the four Hub targets:

```js
assert.equal(goCalls.length, 4);
```

- [ ] **Step 2: Specify fresh-install and legacy-preservation behavior**

Remove `desktop/update.exe` creation from `installFixture`.

In the normal deployment test, assert:

```js
assert.equal(
  await exists(join(fixture.home, 'desktop', 'update.exe')),
  false,
);
```

In the internal update test, create a legacy helper before `runCore`:

```js
const legacyUpdater = join(fixture.home, 'desktop', 'update.exe');
await writeFile(legacyUpdater, 'legacy-updater');
```

and assert afterward:

```js
assert.equal(await readFile(legacyUpdater, 'utf8'), 'legacy-updater');
```

Add the same preservation assertion to a normal upgrade fixture so both `executeDeployment(false, ...)` and `executeDeployment(true, ...)` prove they neither overwrite nor delete the legacy file.

- [ ] **Step 3: Run focused tests and observe failure**

Run:

```powershell
node --test scripts/release/build.test.mjs
node --test --test-name-pattern="normal deploy|successful internal update" scripts/deploy/deploy-core.test.mjs
```

Expected: FAIL while build/apply still require and replace `desktop/update.exe`.

- [ ] **Step 4: Remove updater build and package application**

Delete the Windows updater build block from `scripts/release/build.mjs`:

```js
if (target.GOOS === 'windows') {
  // entire wheelmaker-desktop-updater build block
}
```

In `applyStagedPackage`, remove all of:

- `sourceUpdater`
- the source updater `access`
- `desktopDirectory`, `targetUpdater`, and `temporaryUpdater`
- updater directory creation
- updater copy/chmod/replace
- updater temporary cleanup

Leave Hub and Web staging/replacement unchanged. Because the target updater path is never removed, an already installed legacy helper remains byte-for-byte intact.

- [ ] **Step 5: Delete the obsolete Go command**

Delete all five files under `server/cmd/wheelmaker-desktop-updater/`. Do not move any of its restart, hidden-window, or MessageBox behavior elsewhere.

- [ ] **Step 6: Run affected suites**

Run:

```powershell
node --test scripts/release/build.test.mjs
node --test scripts/deploy/deploy-core.test.mjs
Set-Location server
go test ./cmd/wheelmaker-desktop
Set-Location ..
```

Expected: PASS.

- [ ] **Step 7: Prove no production packaging reference remains**

Run:

```powershell
rg -n "wheelmaker-desktop-updater|desktop[/\\\\]update\\.exe|sourceUpdater|targetUpdater" scripts server/cmd
```

Expected: no production references. Intentional legacy-path detection in `deploy-core.mjs` may still contain the literal `desktop/update.exe`; tests and documentation may mention it for preservation/migration assertions.

- [ ] **Step 8: Leave the final binary-removal unit for the completion gate**

Run:

```powershell
git diff --check -- scripts/release/build.mjs scripts/release/build.test.mjs scripts/deploy/deploy-core.mjs scripts/deploy/deploy-core.test.mjs server/cmd/wheelmaker-desktop-updater
```

Expected: no whitespace errors. Keep this last self-contained unit uncommitted so the repository's mandatory final `git add -A` and `git commit` sequence has an intentional commit to create.

### Task 6: Full automated and Windows integration verification

**Files:**

- Verify only

- [ ] **Step 1: Run all relevant Node tests**

```powershell
node --test scripts/deploy/deploy.test.mjs scripts/deploy/deploy-core.test.mjs scripts/release/build.test.mjs
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the complete Go test suite**

```powershell
Set-Location server
go test ./...
Set-Location ..
```

Expected: PASS. If failures occur only in the three pre-existing user-modified test files, do not alter them; report the exact failure and continue only after the ownership issue is resolved.

- [ ] **Step 3: Run static repository checks**

```powershell
git diff --check
if (Test-Path server/cmd/wheelmaker-desktop-updater) { throw 'obsolete updater command still exists' }
rg -n "ConfigureBackgroundCommand|HideWindow|restartDesktop" server/cmd/wheelmaker-desktop
rg -n "WHEELMAKER_DESKTOP_SELF_UPDATE=1|desktop-self-update|update_exe\\.bat" server/cmd/wheelmaker-desktop scripts/deploy
```

Expected:

- no whitespace errors;
- no hidden/restart implementation remains for Desktop self-update;
- the capability marker agrees exactly between Go and JS;
- the new command occurs only in launcher/core/BAT/tests;
- the removed updater directory produces no matches.

- [ ] **Step 4: Build the Windows artifacts locally**

```powershell
Set-Location server
$desktopBuild = Join-Path $env:TEMP 'WheelMakerDesktop-script-updater-check.exe'
$env:CGO_ENABLED='0'
$env:GOOS='windows'
$env:GOARCH='amd64'
go build -trimpath -ldflags="-s -w -H windowsgui" -o $desktopBuild ./cmd/wheelmaker-desktop
Remove-Item Env:CGO_ENABLED
Remove-Item Env:GOOS
Remove-Item Env:GOARCH
Remove-Item -LiteralPath $desktopBuild
Set-Location ..
```

Expected: the temporary Desktop executable builds and is removed, and there is no updater build output.

- [ ] **Step 5: Perform a successful Windows self-update smoke test**

On a disposable standard install:

1. Confirm `~/.wheelmaker/update_exe.bat` starts with `@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1`.
2. Start exactly one Desktop and record its PID and current EXE SHA-256.
3. Trigger update from the UI.
4. Confirm a visible CMD opens with launcher/core progress.
5. Confirm the original Desktop PID exits before the EXE hash changes.
6. Confirm the CMD ends with the success message and waits at `pause`.
7. Confirm no Desktop process was automatically started.
8. Close CMD, manually start Desktop, and confirm exactly one visible instance.

- [ ] **Step 6: Perform the extra-instance failure smoke test**

1. Start two Desktop instances deliberately.
2. Trigger update from one instance.
3. Confirm the initiating PID exits.
4. Confirm core rejects the update because another `WheelMakerDesktop.exe` remains.
5. Confirm CMD displays the full failure and pauses.
6. Confirm the installed EXE SHA-256 is unchanged and no new Desktop process appears.

- [ ] **Step 7: Verify manual recovery and legacy preservation**

1. With all Desktop instances closed, run `update_exe.bat` without arguments.
2. Confirm it uses `desktop-update`, shows logs, pauses, and does not rewrite itself while executing.
3. On an upgraded fixture containing an old `~/.wheelmaker/desktop/update.exe`, confirm deployment leaves that file unchanged.
4. On a fresh fixture, confirm deployment creates no `desktop/update.exe`.

- [ ] **Step 8: Review the final diff and retain the final commit unit**

```powershell
git status --short
git diff --stat
git diff --check
git log --oneline -5
```

Expected: only the intended final binary-removal unit, any verification corrections, and the three untouched user-modified test files are present. Keep intended implementation corrections uncommitted for the completion gate.

### Task 7: Repository completion gate

- [ ] **Step 1: Resolve the pre-existing dirty-file boundary**

Run:

```powershell
git status --short
```

If the three user-owned test modifications are still present, stop and ask the user to commit/stash them or explicitly authorize including them. Do not run `git add -A` while ownership is ambiguous.

- [ ] **Step 2: Run the mandatory completion tail**

Only from a worktree containing no unrelated changes:

```powershell
git add -A
git commit -m "feat: replace desktop updater with script flow"
$branch = git branch --show-current
git push origin $branch
```

Expected: commit succeeds (or reports nothing to commit after the scoped commits) and push succeeds. Do not report implementation completion until the push has completed successfully.
