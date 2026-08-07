# Windows Local Dev 与 Desktop Dev Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Provide a secure Windows-only source-built Dev stack, including Desktop Dev Mode, while reusing formal runtime data and release compiler caches.

**Architecture:** A shared worktree build lock serializes release and Dev compilation. A Node orchestrator writes Dev artifacts below ~/.wheelmaker/dev, replaces the formal Hub/Registry for the Dev session, and starts webpack HMR on loopback. One Desktop EXE renders a Web-styled extension menu; native Windows policy gives powerful Dev APIs only to an authorized loopback page.

**Tech Stack:** Node.js 22 ESM, batch, Go/WebView2, React 19, TypeScript, webpack-dev-server, node:test, Jest.

---

### Task 1: Create and integrate the shared source-build lock

**Files:**
- Create: scripts/release/build-lock.mjs
- Create: scripts/release/build-lock.test.mjs
- Modify: scripts/release/cli.mjs
- Modify: scripts/release/cli.test.mjs

- [ ] **Step 1: Write the failing contention test**

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireBuildLock} from './build-lock.mjs';

test('rejects a second owner and keeps owner metadata', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'wheelmaker-build-lock-'));
  const first = await acquireBuildLock({owner: 'dev', workRoot});
  await assert.rejects(() => acquireBuildLock({owner: 'release', workRoot}), /owner: dev/);
  const owner = JSON.parse(await readFile(join(workRoot, 'build.lock', 'owner.json'), 'utf8'));
  assert.deepEqual(owner, {owner: 'dev', pid: process.pid});
  await first.release();
});
~~~

- [ ] **Step 2: Verify the test fails**

Run: node --test scripts/release/build-lock.test.mjs

Expected: FAIL because build-lock.mjs does not exist.

- [ ] **Step 3: Implement atomic lock ownership**

~~~js
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function acquireBuildLock({owner, workRoot}) {
  const directory = join(workRoot, 'build.lock');
  try {
    await mkdir(directory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const current = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8').catch(() => '{}'));
    throw new Error('build is already running (owner: ' + (current.owner || 'unknown') + ')');
  }
  await writeFile(join(directory, 'owner.json'), JSON.stringify({owner, pid: process.pid}) + '\n');
  let released = false;
  return {release: async () => {
    if (released) return;
    released = true;
    await rm(directory, {force: true, recursive: true});
  }};
}
~~~

Keep pre-existing locks intact; no PID-based stale-lock deletion is permitted.

- [ ] **Step 4: Wrap the existing release build section**

Add acquireBuildLock to createDefaultReleaseDependencies and wrap buildRelease, packageBuiltRelease, and publishBuiltRelease:

~~~js
const lock = await deps.acquireBuildLock({owner: 'release', workRoot: deps.workRoot});
try {
  const build = await progress.phase('Building release assets', () => deps.buildRelease(buildInput));
  // retain existing package/publish statements in this scope
} finally {
  await lock.release();
}
~~~

Preserve existing stagingRoot cleanup in its outer finally.

- [ ] **Step 5: Run focused checks and commit**

Run: node --test scripts/release/build-lock.test.mjs scripts/release/cli.test.mjs

Expected: PASS, including a cli test that lock acquisition precedes buildRelease and release follows it.

~~~bash
git add scripts/release/build-lock.mjs scripts/release/build-lock.test.mjs scripts/release/cli.mjs scripts/release/cli.test.mjs
git commit -m "feat: serialize release and dev builds"
~~~

### Task 2: Add the Windows Dev build and runtime orchestrator

**Files:**
- Create: scripts/dev-local.mjs
- Create: scripts/dev-local.test.mjs
- Create: dev-local.bat
- Modify: app/web/webpack.config.js
- Modify: server/cmd/wheelmaker-desktop/main.go

- [ ] **Step 1: Write failing output, cache, and handoff tests**

~~~js
test('start writes Dev artifacts and reuses only compiler caches', async () => {
  const commands = [];
  await runDevLocal(['start'], fakeDeps({commands, home: 'C:\\Users\\me', repoRoot: 'D:\\src\\WheelMaker'}));
  const hub = commands.find(call => call.file === 'go' && call.args.includes('./cmd/wheelmaker'));
  const desktop = commands.find(call => call.file === 'go' && call.args.includes('./cmd/wheelmaker-desktop'));
  const web = commands.find(call => call.file === 'npm' && call.args[1] === 'web');
  assert.equal(hub.args[4], 'C:\\Users\\me\\.wheelmaker\\dev\\bin\\wheelmaker.exe');
  assert.equal(desktop.args[4], 'C:\\Users\\me\\.wheelmaker\\dev\\bin\\WheelMakerDesktop.exe');
  assert.equal(hub.env.GOCACHE, 'D:\\src\\WheelMaker\\.release-work\\cache\\go-build');
  assert.equal(web.env.WHEELMAKER_WEB_TARGET, 'C:\\Users\\me\\.wheelmaker\\dev\\web');
  assert.equal('GRADLE_USER_HOME' in hub.env, false);
});

test('start stops formal runtime before starting Dev guardian', async () => {
  const events = [];
  await runDevLocal(['start'], fakeDeps({events}));
  assert.deepEqual(events.slice(0, 3), ['stop-formal-runtime', 'spawn-dev-guardian', 'write-dev-pid']);
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: node --test scripts/dev-local.test.mjs

Expected: FAIL because dev-local.mjs does not exist.

- [ ] **Step 3: Implement fixed command parsing, paths, and cache environment**

Export parseDevLocalArgs and runDevLocal. Accept only build, start, stop, restart, and status. Reject any other argument.

~~~js
const devRoot = join(home, '.wheelmaker', 'dev');
const cacheRoot = join(repoRoot, '.release-work', 'cache');
const env = {
  GOCACHE: join(cacheRoot, 'go-build'),
  GOMODCACHE: join(cacheRoot, 'go-mod'),
  WHEELMAKER_WEB_TARGET: join(devRoot, 'web'),
  WHEELMAKER_WEBPACK_CACHE: join(cacheRoot, 'webpack'),
};
await run('go', ['build', '-trimpath', '-o', join(devRoot, 'bin', 'wheelmaker.exe'), './cmd/wheelmaker'], {
  cwd: join(repoRoot, 'server'), env,
});
await buildDesktopExecutable({devRoot, env, repoRoot, run});
const webServer = await spawnDetached('npm', ['run', 'web'], {cwd: join(repoRoot, 'app'), env});
~~~

Acquire the Task 1 lock with owner dev before compilation. Do not pass .release-work/tmp, .release-out, or Gradle cache to any Dev command.

BuildDesktopExecutable must follow the release builder's existing go-winres invocation, write the generated syso beside cmd/wheelmaker-desktop only while the shared lock is held, compile devRoot/bin/WheelMakerDesktop.exe, and remove the syso in a finally block. Persist both guardianPid and webServerPid in runtime.json.

- [ ] **Step 4: Implement explicit formal/Dev runtime handoff**

~~~js
await runWindowsBatch(join(home, '.wheelmaker', 'stop.bat'));
const guardian = await spawnDetached(join(devRoot, 'bin', 'wheelmaker.exe'), ['-d'], {cwd: devRoot});
await writeFile(join(devRoot, 'runtime.json'), JSON.stringify({guardianPid: guardian.pid, webServerPid: webServer.pid}) + '\n');
~~~

For command-line start, launch devRoot/bin/WheelMakerDesktop.exe with the fixed --local-dev switch after the stack is ready. For stop, terminate only the recorded guardian and web-server PID trees, remove runtime.json, then run ~/.wheelmaker/start.bat. Missing start.bat, stop.bat, or PID data must produce an error; never kill by process image name.

- [ ] **Step 5: Add entrypoint and disk output for HMR**

Create dev-local.bat:

~~~bat
@echo off
setlocal
node "%~dp0scripts\dev-local.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
~~~

Add devMiddleware writeToDisk true to the existing webpack devServer. Preserve host 127.0.0.1, port 8080, current headers, history fallback, and hot reload.

- [ ] **Step 6: Run focused checks and commit**

Run: node --test scripts/dev-local.test.mjs && cd app && npm run tsc:web

Expected: PASS. Tests prove cache/gradle, .release-work/tmp, and .release-out never occur in the Dev environment.

~~~bash
git add scripts/dev-local.mjs scripts/dev-local.test.mjs dev-local.bat app/web/webpack.config.js
git commit -m "feat: add Windows local development orchestrator"
~~~

### Task 3: Define secure Local Dev config, policy, and Windows bridge

**Files:**
- Create: server/cmd/wheelmaker-desktop/local_dev.go
- Create: server/cmd/wheelmaker-desktop/local_dev_test.go
- Create: server/cmd/wheelmaker-desktop/local_dev_windows.go
- Create: server/cmd/wheelmaker-desktop/local_dev_windows_test.go
- Modify: server/cmd/wheelmaker-desktop/desktop_bridge.go
- Modify: server/cmd/wheelmaker-desktop/webview_policy.go
- Modify: server/cmd/wheelmaker-desktop/desktop_runtime.go
- Modify: server/cmd/wheelmaker-desktop/webview_windows.go
- Modify: server/cmd/wheelmaker-desktop/webview_policy_test.go
- Modify: server/cmd/wheelmaker-desktop/webview_windows_test.go
- Modify: server/cmd/wheelmaker-desktop/main.go

- [ ] **Step 1: Write failing source-root and origin-policy tests**

~~~go
func TestValidateLocalDevSourceRoot(t *testing.T) {
  root := t.TempDir()
  for _, name := range []string{"server/go.mod", "app/package.json", "scripts/.keep"} {
    path := filepath.Join(root, name)
    if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil { t.Fatal(err) }
    if err := os.WriteFile(path, []byte("x"), 0o600); err != nil { t.Fatal(err) }
  }
  if got, err := validateLocalDevSourceRoot(root); err != nil || got != root {
    t.Fatalf("validateLocalDevSourceRoot() = %q, %v", got, err)
  }
}

func TestDesktopPolicyRejectsNonLoopbackDevHTTP(t *testing.T) {
  policy, err := newDesktopWebViewPolicy("http://127.0.0.1:4173/")
  if err != nil { t.Fatal(err) }
  if policy.contains("http://192.0.2.1:8080/") { t.Fatal("accepted non-loopback URL") }
}
~~~

- [ ] **Step 2: Verify the tests fail**

Run: cd server && go test ./cmd/wheelmaker-desktop -run 'TestValidateLocalDevSourceRoot|TestDesktopPolicyRejectsNonLoopbackDevHTTP'

Expected: FAIL because Local Dev validation and local page policy do not exist.

- [ ] **Step 3: Implement isolated config and a closed operation set**

~~~go
type localDevConfig struct {
  SourcePath string `json:"sourcePath"`
}

type localDevOperation string

const (
  localDevBuild localDevOperation = "build"
  localDevStart localDevOperation = "start"
  localDevStop localDevOperation = "stop"
  localDevRestart localDevOperation = "restart"
  localDevOpenDirectory localDevOperation = "open-directory"
  localDevExit localDevOperation = "exit"
)

type localDevRunner interface {
  Run(context.Context, string, []string, string) error
}

type localDevConfirm interface {
  Confirm(localDevOperation, string) bool
}
~~~

Persist this configuration only at ~/.wheelmaker/dev/dev-config.json using shared.WriteConfigFile. Normalize source paths to absolute values and require server/go.mod, app/package.json, and scripts. Reject any operation outside these constants.

- [ ] **Step 4: Add page-mode authorization and native execution**

Add desktopTrustedLocalDevPage. It accepts only http://127.0.0.1:4173, no credentials/query/fragment, and slash-prefixed paths. Authorize enter-local-dev only from a committed HTTPS top-level page; authorize state, save-source, and run-operation only from a committed top-level local Dev page.

Use this fixed execution method:

~~~go
func (s *localDevService) Run(ctx context.Context, operation localDevOperation) error {
  config, err := s.store.Load()
  if err != nil { return err }
  root, err := validateLocalDevSourceRoot(config.SourcePath)
  if err != nil { return err }
  if !s.confirm.Confirm(operation, root) {
    return errors.New("local dev operation was cancelled")
  }
  return s.runner.Run(ctx, filepath.Join(root, "dev-local.bat"), []string{string(operation)}, root)
}
~~~

Use Windows-owned confirmation and folder picker, Explorer for open-directory, and exec.CommandContext argument arrays. JavaScript cannot submit a command, working directory, environment, or target URL.

- [ ] **Step 5: Bind API names by capability and implement transitions**

Expose requestLocalDevMode from production HTTPS. Expose localDev only on exact Dev loopback:

~~~ts
window.WheelMakerDesktop = Object.freeze({
  enabled: true,
  requestLocalDevMode: invoke('__wheelMakerDesktopEnterLocalDev'),
  localDev: isLoopbackDevPage ? Object.freeze({
    getState: invoke('__wheelMakerDesktopGetLocalDevState'),
    saveSource: invoke('__wheelMakerDesktopSaveLocalDevSource'),
    run: invoke('__wheelMakerDesktopRunLocalDev'),
  }) : undefined,
});
~~~

Add a --local-dev switch to main.go. It makes the source-built Desktop EXE open literal http://127.0.0.1:4173/ after validating the local Dev stack, while the same EXE without the switch preserves the existing HTTPS bootstrap flow. EnterLocalDev runs the fixed source script with the native-only WHEELMAKER_DEV_NO_DESKTOP=1 environment value, changes policy to local Dev mode, and navigates the current window to literal http://127.0.0.1:4173/. Exit stops Dev, restores formal runtime and HTTPS policy, then navigates to saved base URL.

- [ ] **Step 6: Run package tests and commit**

Run: cd server && go test ./cmd/wheelmaker-desktop

Expected: PASS. Add assertions that bootstrap and HTTPS injection omit localDev, exact loopback injection contains it, and iframe/non-loopback attempts are denied.

~~~bash
git add server/cmd/wheelmaker-desktop/local_dev.go server/cmd/wheelmaker-desktop/local_dev_test.go server/cmd/wheelmaker-desktop/local_dev_windows.go server/cmd/wheelmaker-desktop/local_dev_windows_test.go server/cmd/wheelmaker-desktop/desktop_bridge.go server/cmd/wheelmaker-desktop/webview_policy.go server/cmd/wheelmaker-desktop/desktop_runtime.go server/cmd/wheelmaker-desktop/webview_windows.go server/cmd/wheelmaker-desktop/webview_policy_test.go server/cmd/wheelmaker-desktop/webview_windows_test.go
git commit -m "feat: add secure Windows desktop dev mode"
~~~

### Task 4: Add the Web-styled extension menu and Local Dev page

**Files:**
- Create: app/web/src/platform/desktop/LocalDevModePage.tsx
- Create: app/__tests__/desktop-local-dev-ui.test.tsx
- Modify: app/web/src/platform/desktop/desktopRuntime.ts
- Modify: app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx
- Modify: app/web/src/app/WorkspaceApp.tsx
- Modify: app/web/src/styles/shell.css

- [ ] **Step 1: Write failing capability and operation tests**

~~~tsx
test('does not render Windows extensions without a native bridge', () => {
  render(<DesktopWindowControls />);
  expect(screen.queryByLabelText('Windows extensions')).toBeNull();
});

test('Local Dev page sends the closed build operation', async () => {
  const run = jest.fn().mockResolvedValue({message: '', running: false, sourcePath: ''});
  render(<LocalDevModePage bridge={{enabled: true, localDev: {getState: jest.fn(), saveSource: jest.fn(), run}} as any} />);
  await userEvent.click(screen.getByRole('button', {name: 'Build'}));
  expect(run).toHaveBeenCalledWith('build');
});
~~~

- [ ] **Step 2: Verify the tests fail**

Run: cd app && npm test -- --runInBand __tests__/desktop-local-dev-ui.test.tsx

Expected: FAIL because the Windows extension control and Local Dev page do not exist.

- [ ] **Step 3: Add typed bridge and extension menu**

~~~ts
export type LocalDevOperation = 'build' | 'start' | 'stop' | 'restart' | 'open-directory' | 'exit';

export type LocalDevState = {
  sourcePath: string;
  running: boolean;
  message: string;
};

export type DesktopLocalDevBridge = {
  getState: () => Promise<LocalDevState>;
  saveSource: (sourcePath: string) => Promise<LocalDevState>;
  run: (operation: LocalDevOperation) => Promise<LocalDevState>;
};
~~~

Add optional requestLocalDevMode and localDev to DesktopWindowBridge, with no index signature or generic command method.

Place this control immediately before minimize when requestLocalDevMode exists:

~~~tsx
<button type="button" className="desktop-titlebar-button" aria-label="Windows extensions"
  aria-expanded={open} onClick={() => setOpen(value => !value)}>
  <span className="codicon codicon-extensions" aria-hidden="true" />
</button>
{open ? <div className="desktop-windows-extension-menu" role="menu">
  <button type="button" role="menuitem" onClick={() => void bridge.requestLocalDevMode?.()}>Dev Mode</button>
</div> : null}
~~~

Increase --desktop-window-controls-width from 176px to 222px.

- [ ] **Step 4: Implement Local Dev screen and current-theme styles**

~~~tsx
export function LocalDevModePage({bridge}: {bridge: DesktopWindowBridge}) {
  const localDev = bridge.localDev;
  if (!localDev) return null;
  const [sourcePath, setSourcePath] = useState('');
  const [message, setMessage] = useState('');
  const run = async (operation: LocalDevOperation) => setMessage((await localDev.run(operation)).message);
  return <section className="local-dev-page" aria-label="Local Dev">
    <label>Source directory<input value={sourcePath} onChange={event => setSourcePath(event.target.value)} /></label>
    <button type="button" onClick={() => void localDev.saveSource(sourcePath)}>Save and validate</button>
    <button type="button" onClick={() => void run('build')}>Build</button>
    <button type="button" onClick={() => void run('start')}>Start</button>
    <button type="button" onClick={() => void run('stop')}>Stop</button>
    <button type="button" onClick={() => void run('restart')}>Restart</button>
    <button type="button" onClick={() => void run('open-directory')}>Open dev folder</button>
    <button type="button" onClick={() => void run('exit')}>Exit Dev Mode</button>
    <output>{message}</output>
  </section>;
}
~~~

Mount only when getDesktopWindowBridge()?.localDev exists. Add menu styles with existing surface, border, hover, focus-visible, and shadow tokens; do not introduce a new palette.

- [ ] **Step 5: Run Web checks and commit**

Run: cd app && npm test -- --runInBand __tests__/desktop-local-dev-ui.test.tsx && npm run tsc:web

Expected: PASS, including a browser rendering assertion that shows neither extension control nor Local Dev controls.

~~~bash
git add app/web/src/platform/desktop/LocalDevModePage.tsx app/__tests__/desktop-local-dev-ui.test.tsx app/web/src/platform/desktop/desktopRuntime.ts app/web/src/shell/layouts/desktop/DesktopTitleBar.tsx app/web/src/app/WorkspaceApp.tsx app/web/src/styles/shell.css
git commit -m "feat: add Windows extensions dev mode UI"
~~~

### Task 5: Document and verify the complete workflow

**Files:**
- Modify: README.md
- Modify: app/README.md
- Modify: docs/scope/2026-07-18-windows-local-dev.md

- [ ] **Step 1: Document the exact developer commands**

Add a Windows Local Dev section that states:

    From a WheelMaker source checkout, run dev-local.bat start.
    It writes source-built artifacts to ~/.wheelmaker/dev/bin and ~/.wheelmaker/dev/web.
    It reuses only .release-work/cache/webpack, .release-work/cache/go-build, and .release-work/cache/go-mod.
    Run dev-local.bat stop to restore the formal Hub.

Also document Windows extensions → Dev Mode, exact loopback origin http://127.0.0.1:4173, and the exclusion of .release-work/tmp, .release-out, and Gradle cache.

- [ ] **Step 2: Cross-link scope and plan**

Append an Implementation heading to the approved spec linking plan-windows-local-dev.md. Do not edit decisions or acceptance criteria.

- [ ] **Step 3: Run complete automated checks**

Run: node --test scripts/release/build-lock.test.mjs scripts/release/cli.test.mjs scripts/dev-local.test.mjs

Expected: PASS.

Run: cd server && go test ./cmd/wheelmaker-desktop

Expected: PASS.

Run: cd app && npm test -- --runInBand __tests__/desktop-local-dev-ui.test.tsx && npm run tsc:web && npm run build:web:release

Expected: PASS. Production Web build remains independent of Dev Mode.

- [ ] **Step 4: Perform Windows smoke verification**

1. Start formal runtime and confirm it owns 127.0.0.1:9630.
2. Run dev-local.bat start and confirm formal stops, Dev writes artifacts under ~/.wheelmaker/dev, and Dev owns the port.
3. Open ordinary Desktop EXE, select Windows extensions → Dev Mode, configure source directory, and accept native confirmation.
4. Confirm navigation to http://127.0.0.1:4173 and HMR after a CSS edit.
5. Exit Dev Mode and confirm Dev stops, formal starts, and Desktop returns to its saved HTTPS site.
6. Open the site in a browser and confirm no extension control or Local Dev API exists.

- [ ] **Step 5: Commit**

~~~bash
git add README.md app/README.md docs/scope/2026-07-18-windows-local-dev.md
git commit -m "docs: document Windows local dev workflow"
~~~
