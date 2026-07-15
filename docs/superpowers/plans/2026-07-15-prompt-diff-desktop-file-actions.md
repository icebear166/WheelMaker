# Prompt Diff Desktop File Actions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-only actions to the prompt-diff preview so the selected changed file can be opened in Visual Studio Code or revealed in Windows File Explorer.

**Architecture:** Keep selected-file state in each `PromptDiffPreviewTab`, render actions through the existing preview-workbench menu, and send project-root plus relative-path arguments through two new WheelMaker Desktop bindings. A focused Windows file-action runner validates the path and launches fixed executables without invoking a shell; existing desktop navigation authorization remains the trust boundary.

**Tech Stack:** React 19, TypeScript 5.8, Jest 30, Go 1.26, Windows WebView2, `os/exec`, Windows `filepath` rules.

**Source design:** `docs/superpowers/specs/2026-07-15-prompt-diff-desktop-file-actions-design.md`

---

## File Structure

- Create `server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go`: validate project-relative targets, locate `Code.exe`, and launch VS Code or Explorer through injected operating-system dependencies.
- Create `server/cmd/wheelmaker-desktop/desktop_file_actions_windows_test.go`: real-temp-directory path tests and launch-recorder tests. This new native responsibility does not fit an existing test file cleanly.
- Modify `server/cmd/wheelmaker-desktop/desktop_bridge.go`: declare binding names and expose them only on the trusted remote runtime object.
- Modify `server/cmd/wheelmaker-desktop/webview_policy.go`: add explicitly authorized trusted-page action values while keeping them unavailable to bootstrap and untrusted pages.
- Modify `server/cmd/wheelmaker-desktop/webview_policy_test.go`: extend the existing authorization matrix.
- Modify `server/cmd/wheelmaker-desktop/webview_windows.go`: bind authorized JavaScript calls to the focused runner.
- Modify `server/cmd/wheelmaker-desktop/webview_windows_test.go`: verify the runtime script and Windows binding source include both actions.
- Modify `app/web/src/platform/desktop/desktopRuntime.ts`: type the two optional bridge methods and provide a small invocation helper.
- Create `app/__tests__/web-desktop-runtime.test.ts`: behavior tests for the invocation helper without rendering the workspace.
- Modify `app/web/src/preview/previewWorkbenchState.ts`: add, normalize, merge, snapshot, and restore `activeFilePath`.
- Modify `app/__tests__/web-preview-workbench-state.test.ts`: state and persistence regression tests.
- Modify `app/web/src/app/WorkspaceApp.tsx`: initialize/preserve active paths, select file headers, resolve project roots, invoke native actions, and render menu items.
- Modify `app/web/src/styles/file.css`: add the active prompt-diff file treatment.
- Modify `app/__tests__/web-chat-file-peek-viewer.test.ts`: integration-boundary assertions for selection, gating, actions, and errors.

## Chunk 1: Windows Native Action Boundary

### Task 1: Validate and launch desktop project-file actions

**Files:**
- Create: `server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_file_actions_windows_test.go`

- [ ] **Step 1: Write failing path-validation tests**

Create a real temporary project root and assert that the future resolver accepts `src/main.ts` but rejects empty, `.`, absolute, drive-qualified, current-drive-rooted, and parent-traversal inputs. Also cover a non-absolute root, missing root, and regular-file root. Assert the returned target remains under the cleaned root.

```go
func TestDesktopProjectFilePathRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	for _, relativePath := range []string{
		"", ".", `C:\\Windows\\win.ini`, `\\Windows\\win.ini`,
		`/Windows/win.ini`, `..\\outside.txt`,
	} {
		t.Run(relativePath, func(t *testing.T) {
			if _, _, err := resolveDesktopProjectFilePath(root, relativePath); err == nil {
				t.Fatalf("resolveDesktopProjectFilePath(%q) succeeded", relativePath)
			}
		})
	}
}

func TestDesktopProjectFilePathRejectsInvalidRoot(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	regularFile := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(regularFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{"relative-root", missing, regularFile} {
		if _, _, err := resolveDesktopProjectFilePath(root, "src/main.ts"); err == nil {
			t.Fatalf("resolveDesktopProjectFilePath(%q) succeeded", root)
		}
	}
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

From `server` run:

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestDesktopProjectFilePath' -count=1
```

Expected: FAIL because `resolveDesktopProjectFilePath` does not exist.

- [ ] **Step 3: Implement the minimal lexical path resolver**

Create the Windows-only file with `//go:build windows`. Require an absolute, existing directory root. Convert artifact paths with `filepath.FromSlash`, require `filepath.IsLocal`, and also reject `filepath.IsAbs` or a non-empty `filepath.VolumeName`. This explicitly rejects `\\Windows` and `/Windows` current-drive-rooted paths. Join and clean, then use `filepath.Rel` as a defense-in-depth rejection of `..` or `..` plus the OS separator.

```go
func resolveDesktopProjectFilePath(projectRoot, relativePath string) (string, string, error) {
	root := filepath.Clean(projectRoot)
	if !filepath.IsAbs(root) {
		return "", "", errors.New("project root must be absolute")
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", "", errors.New("project root is unavailable")
	}
	relativePath = filepath.FromSlash(relativePath)
	if !filepath.IsLocal(relativePath) || relativePath == "." || filepath.IsAbs(relativePath) || filepath.VolumeName(relativePath) != "" {
		return "", "", errors.New("file path must be project-relative")
	}
	target := filepath.Clean(filepath.Join(root, relativePath))
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", errors.New("file path escapes project root")
	}
	return root, target, nil
}
```

- [ ] **Step 4: Run the resolver tests and confirm GREEN**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Write failing VS Code and Explorer behavior tests**

Use real temporary files and a small production dependency struct containing `stat`, `lookPath`, `getenv`, and `launch`. The launch function records executable and arguments; assertions verify the action result, not merely that a fake exists.

Cover all of these cases:

- PATH `Code.exe` wins over install-directory candidates.
- `%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe` is the first fallback.
- Program Files candidates follow.
- an existing regular target launches the resolved VS Code executable with exactly the target argument.
- a missing target returns an error without launching VS Code.
- no PATH or installation-directory candidate returns a concise `Visual Studio Code was not found` error without launching anything.
- an existing target launches `explorer.exe` with one `/select,<target>` argument.
- a deleted target opens the nearest existing parent directory and never a directory above root.

```go
type recordingDesktopLaunch struct {
	name string
	args []string
}

func writeDesktopTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil { t.Fatal(err) }
}

func TestDesktopVSCodeDiscoveryAndLaunch(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "src", "main.ts")
	writeDesktopTestFile(t, target)
	pathCode := filepath.Join(t.TempDir(), "Code.exe")
	localCode := filepath.Join(t.TempDir(), "Programs", "Microsoft VS Code", "Code.exe")
	writeDesktopTestFile(t, localCode)
	var launch recordingDesktopLaunch
	env := desktopFileActionEnvironment{
		stat: os.Stat,
		lookPath: func(name string) (string, error) {
			if name != "Code.exe" { t.Fatalf("lookPath(%q)", name) }
			return pathCode, nil
		},
		getenv: func(name string) string {
			if name == "LOCALAPPDATA" { return filepath.Dir(filepath.Dir(filepath.Dir(localCode))) }
			return ""
		},
		launch: func(name string, args ...string) error {
			launch = recordingDesktopLaunch{name: name, args: append([]string(nil), args...)}
			return nil
		},
	}
	if err := env.openProjectFileInVSCode(root, "src/main.ts"); err != nil { t.Fatal(err) }
	if launch.name != pathCode || !reflect.DeepEqual(launch.args, []string{target}) {
		t.Fatalf("launch=%+v", launch)
	}

	env.lookPath = func(string) (string, error) { return "", exec.ErrNotFound }
	launch = recordingDesktopLaunch{}
	if err := env.openProjectFileInVSCode(root, "src/main.ts"); err != nil { t.Fatal(err) }
	if launch.name != localCode { t.Fatalf("fallback launch=%+v", launch) }
}

func TestDesktopVSCodeErrorsDoNotLaunch(t *testing.T) {
	root := t.TempDir()
	launched := false
	env := desktopFileActionEnvironment{
		stat: os.Stat,
		lookPath: func(string) (string, error) { return "", exec.ErrNotFound },
		getenv: func(string) string { return "" },
		launch: func(string, ...string) error { launched = true; return nil },
	}
	if err := env.openProjectFileInVSCode(root, "missing.ts"); err == nil || launched {
		t.Fatalf("missing file err=%v launched=%v", err, launched)
	}
	writeDesktopTestFile(t, filepath.Join(root, "main.ts"))
	err := env.openProjectFileInVSCode(root, "main.ts")
	if err == nil || !strings.Contains(err.Error(), "Visual Studio Code was not found") || launched {
		t.Fatalf("missing VS Code err=%v launched=%v", err, launched)
	}
}

func TestDesktopVSCodeProgramFilesFallbacks(t *testing.T) {
	for _, variable := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		t.Run(variable, func(t *testing.T) {
			base := t.TempDir()
			expected := filepath.Join(base, "Microsoft VS Code", "Code.exe")
			writeDesktopTestFile(t, expected)
			env := desktopFileActionEnvironment{
				stat: os.Stat,
				lookPath: func(string) (string, error) { return "", exec.ErrNotFound },
				getenv: func(name string) string {
					if name == variable { return base }
					return ""
				},
			}
			got, err := env.findVSCode()
			if err != nil || got != expected { t.Fatalf("findVSCode()=%q, %v", got, err) }
		})
	}
}

func TestDesktopFileExplorerSelectsFileAndOpensDeletedFileParent(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "src", "main.ts")
	writeDesktopTestFile(t, target)
	var launches []recordingDesktopLaunch
	env := desktopFileActionEnvironment{
		stat: os.Stat,
		launch: func(name string, args ...string) error {
			launches = append(launches, recordingDesktopLaunch{name: name, args: append([]string(nil), args...)})
			return nil
		},
	}
	if err := env.showProjectFileInFolder(root, "src/main.ts"); err != nil { t.Fatal(err) }
	if err := env.showProjectFileInFolder(root, "src/deleted.ts"); err != nil { t.Fatal(err) }
	want := []recordingDesktopLaunch{
		{name: "explorer.exe", args: []string{"/select," + target}},
		{name: "explorer.exe", args: []string{filepath.Join(root, "src")}},
	}
	if !reflect.DeepEqual(launches, want) { t.Fatalf("launches=%v, want %v", launches, want) }
}
```

- [ ] **Step 6: Run the launch tests and confirm RED**

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(VSCode|FileExplorer)' -count=1
```

Expected: FAIL because the runner and actions do not exist.

- [ ] **Step 7: Implement the minimal file-action runner**

Add a focused `desktopFileActionEnvironment` and default constructor. The default launcher calls `exec.Command(name, args...).Start()` and releases the process handle after a successful start. It must not invoke `cmd.exe`, PowerShell, `start`, or an external URL.

```go
type desktopFileActionEnvironment struct {
	stat     func(string) (os.FileInfo, error)
	lookPath func(string) (string, error)
	getenv   func(string) string
	launch   func(string, ...string) error
}

func (e desktopFileActionEnvironment) openProjectFileInVSCode(root, relative string) error {
	_, target, err := resolveDesktopProjectFilePath(root, relative)
	if err != nil { return err }
	info, err := e.stat(target)
	if err != nil || info.IsDir() { return errors.New("file is unavailable") }
	codePath, err := e.findVSCode()
	if err != nil { return err }
	return e.launch(codePath, target)
}
```

`findVSCode` checks `lookPath("Code.exe")`, then Local AppData, Program Files, and Program Files (x86), accepting only existing regular files. `showProjectFileInFolder` selects an existing file or walks parent directories until it finds an existing directory at or below root.

- [ ] **Step 8: Run all new native action tests and confirm GREEN**

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(ProjectFilePath|VSCode|FileExplorer)' -count=1
```

Expected: PASS with no real process launched.

- [ ] **Step 9: Commit the focused native action runner**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_file_actions_windows.go server/cmd/wheelmaker-desktop/desktop_file_actions_windows_test.go
git commit -m "feat: add desktop project file actions"
```

### Task 2: Authorize and expose the desktop bindings

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`

- [ ] **Step 1: Extend the authorization test matrix first**

Add `desktopBridgeOpenProjectFileInVSCode` and `desktopBridgeShowProjectFileInFolder` cases to the direct policy matrix for trusted origin/base-path, bootstrap, untrusted origin, out-of-base-path URL, and iframe decisions. Add a separate committed-navigation test using `desktopWebViewSecurityState`: begin a trusted top-level navigation, prove both actions fail before `CommitTopLevelNavigation`, commit it, then prove both succeed through `Authorize` and `AuthorizeCurrent`.

```go
func TestDesktopFileActionsRequireCommittedTrustedNavigation(t *testing.T) {
	state, err := newDesktopWebViewSecurityState("https://example.com/wheelmaker/", desktopTrustedRemotePage)
	if err != nil { t.Fatal(err) }
	epoch := state.BeginTopLevelNavigation("https://example.com/wheelmaker/projects")
	for _, action := range []desktopBridgeAction{
		desktopBridgeOpenProjectFileInVSCode,
		desktopBridgeShowProjectFileInFolder,
	} {
		if state.Authorize(epoch, true, action) {
			t.Fatalf("action %v authorized before commit", action)
		}
	}
	state.CommitTopLevelNavigation(epoch, "https://example.com/wheelmaker/projects")
	for _, action := range []desktopBridgeAction{
		desktopBridgeOpenProjectFileInVSCode,
		desktopBridgeShowProjectFileInFolder,
	} {
		if !state.AuthorizeCurrent(action) {
			t.Fatalf("action %v denied after trusted commit", action)
		}
	}
}
```

- [ ] **Step 2: Add failing runtime-script and binding assertions**

In `webview_windows_test.go`, assert `desktopRuntimeInitScript()` includes both public method names and both private binding constants, and assert the Windows binding source references the focused runner methods.

- [ ] **Step 3: Run the focused bridge tests and confirm RED**

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(BridgeAuthorization|FileActionsRequireCommittedTrustedNavigation|RuntimeFileActionBindings)' -count=1
```

Expected: FAIL because the action values, constants, runtime methods, and bindings are absent.

- [ ] **Step 4: Implement explicit policy actions and bindings**

Append two `desktopBridgeAction` values. Replace fragile numeric remote-action authorization with an explicit `switch` listing device name, window controls, server change, and both file actions. Keep `desktopBootstrapActionAllowed` explicit and omit the file actions.

Add constants for `__wheelMakerDesktopOpenProjectFileInVSCode` and `__wheelMakerDesktopShowProjectFileInFolder`. Expose them only inside the trusted `location.protocol === 'https:'` `WheelMakerDesktop` object:

```javascript
openProjectFileInVSCode: invoke('__wheelMakerDesktopOpenProjectFileInVSCode'),
showProjectFileInFolder: invoke('__wheelMakerDesktopShowProjectFileInFolder'),
```

Bind each function in `bindDesktopWindowBridge`, authorize its matching action, then call a fresh default file-action environment with `(projectRoot, relativePath)`.

- [ ] **Step 5: Run focused and package tests and confirm GREEN**

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(BridgeAuthorization|FileActionsRequireCommittedTrustedNavigation|RuntimeFileActionBindings)' -count=1
go test ./cmd/wheelmaker-desktop -count=1
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the native bridge boundary**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_bridge.go server/cmd/wheelmaker-desktop/webview_policy.go server/cmd/wheelmaker-desktop/webview_policy_test.go server/cmd/wheelmaker-desktop/webview_windows.go server/cmd/wheelmaker-desktop/webview_windows_test.go
git commit -m "feat: expose desktop file action bridge"
```

## Chunk 2: Prompt-Diff Selection and UI

### Task 3: Persist the active changed file per preview tab

**Files:**
- Modify: `app/web/src/preview/previewWorkbenchState.ts`
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`

- [ ] **Step 1: Write failing active-file state tests**

Add the following complete test. It covers initialization from a preferred path, first-file fallback, preservation when reopening without a preference, explicit reselection, fallback when files disappear, snapshot preservation, and safe fallback from a legacy snapshot without the field.

```ts
test('tracks and restores the active prompt diff file with safe fallbacks', () => {
  const files = ['src/a.ts', 'src/b.ts'].map(path => ({
    path,
    status: 'MODIFIED',
    additions: 1,
    deletions: 0,
    diff: '',
    expanded: false,
  }));
  const input = (activeFilePath?: string) => ({
    type: 'prompt-diff' as const,
    projectId: 'p1',
    sessionId: 's1',
    artifactId: 'd1',
    title: 'Prompt diff',
    files,
    ...(activeFilePath === undefined ? {} : {activeFilePath}),
  });

  const preferred = openPreviewTab(createPreviewWorkbenchState('p1'), input('src/b.ts'));
  expect(activePreviewTab(preferred)).toMatchObject({activeFilePath: 'src/b.ts'});

  const fallback = openPreviewTab(createPreviewWorkbenchState('p1'), input('missing.ts'));
  expect(activePreviewTab(fallback)).toMatchObject({activeFilePath: 'src/a.ts'});

  const preserved = openPreviewTab(preferred, input());
  expect(activePreviewTab(preserved)).toMatchObject({activeFilePath: 'src/b.ts'});

  const reselected = openPreviewTab(preserved, input('src/a.ts'));
  expect(activePreviewTab(reselected)).toMatchObject({activeFilePath: 'src/a.ts'});

  const replaced = openPreviewTab(reselected, {...input(), files: [files[1]]});
  expect(activePreviewTab(replaced)).toMatchObject({activeFilePath: 'src/b.ts'});

  const snapshot = previewWorkbenchSnapshotFromState(preferred);
  expect(snapshot.tabsByProjectId.p1[0]).toMatchObject({activeFilePath: 'src/b.ts'});
  expect(activePreviewTab(previewWorkbenchStateFromSnapshot(snapshot))).toMatchObject({
    activeFilePath: 'src/b.ts',
  });

  const legacy = structuredClone(snapshot);
  delete (legacy.tabsByProjectId.p1[0] as {activeFilePath?: string}).activeFilePath;
  expect(activePreviewTab(previewWorkbenchStateFromSnapshot(legacy))).toMatchObject({
    activeFilePath: 'src/a.ts',
  });
});
```

- [ ] **Step 2: Run the state suite and confirm RED**

From `app` run:

```powershell
npm test -- __tests__/web-preview-workbench-state.test.ts --runInBand
```

Expected: FAIL because prompt-diff tabs do not store `activeFilePath`.

- [ ] **Step 3: Add selection normalization to workbench state**

Add `activeFilePath: string` to `PromptDiffPreviewTab`, optional `activeFilePath?: string` to prompt-diff open input, and optional `activeFilePath?: string` to the snapshot type for version-1 backward compatibility.

```ts
export function resolvePromptDiffActiveFilePath(
  files: PromptDiffPreviewFile[],
  preferredPath = '',
): string {
  return files.some(file => file.path === preferredPath)
    ? preferredPath
    : files[0]?.path ?? '';
}
```

Use the helper in `createTab`, `mergeTab`, snapshot serialization, and snapshot restoration. In `mergeTab`, prefer an explicitly supplied input path; otherwise preserve the existing selection only while it remains in the replacement file list.

- [ ] **Step 4: Run the state suite and confirm GREEN**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit the isolated state change**

```powershell
git add app/web/src/preview/previewWorkbenchState.ts app/__tests__/web-preview-workbench-state.test.ts
git commit -m "feat: track active prompt diff file"
```

### Task 4: Type and test desktop bridge invocation

**Files:**
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Create: `app/__tests__/web-desktop-runtime.test.ts`

- [ ] **Step 1: Write complete failing helper tests**

Import the module as a namespace so Jest can assert the missing export rather than failing module resolution. Add the following tests for argument forwarding, asynchronous waiting, Explorer routing, and missing-method rejection:

```ts
import * as runtime from '../web/src/platform/desktop/desktopRuntime';

describe('desktop project file actions', () => {
  test('routes both actions and waits for the native promise', async () => {
    let finishVSCode!: () => void;
    const openProjectFileInVSCode = jest.fn(() => new Promise<void>(resolve => {
      finishVSCode = resolve;
    }));
    const showProjectFileInFolder = jest.fn().mockResolvedValue(undefined);
    const bridge = {enabled: true as const, openProjectFileInVSCode, showProjectFileInFolder};
    const invoke = (runtime as typeof runtime & {
      invokeDesktopProjectFileAction: (
        bridge: typeof bridge,
        action: 'vscode' | 'folder',
        root: string,
        path: string,
      ) => Promise<void>;
    }).invokeDesktopProjectFileAction;

    expect(typeof invoke).toBe('function');
    let settled = false;
    const pending = invoke(bridge, 'vscode', 'F:\\repo', 'src/main.ts')
      .then(() => { settled = true; });
    expect(openProjectFileInVSCode).toHaveBeenCalledWith('F:\\repo', 'src/main.ts');
    await Promise.resolve();
    expect(settled).toBe(false);
    finishVSCode();
    await pending;

    await invoke(bridge, 'folder', 'F:\\repo', 'src/main.ts');
    expect(showProjectFileInFolder).toHaveBeenCalledWith('F:\\repo', 'src/main.ts');
  });

  test('rejects when the requested native action is unavailable', async () => {
    const invoke = (runtime as typeof runtime & {
      invokeDesktopProjectFileAction: (
        bridge: {enabled: true}, action: 'vscode', root: string, path: string,
      ) => Promise<void>;
    }).invokeDesktopProjectFileAction;
    expect(typeof invoke).toBe('function');
    await expect(invoke({enabled: true}, 'vscode', 'F:\\repo', 'src/main.ts'))
      .rejects.toThrow('Desktop file action is unavailable.');
  });
});
```

- [ ] **Step 2: Run the helper suite and confirm RED**

```powershell
npm test -- __tests__/web-desktop-runtime.test.ts --runInBand
```

Expected: FAIL at `typeof invoke` because the helper is not exported.

- [ ] **Step 3: Implement the typed invocation helper**

Extend `DesktopWindowBridge` with both optional native methods, then export an async helper that selects the exact method, throws `Desktop file action is unavailable.` when absent, and awaits it:

```ts
export type DesktopProjectFileAction = 'vscode' | 'folder';

export async function invokeDesktopProjectFileAction(
  bridge: DesktopWindowBridge,
  action: DesktopProjectFileAction,
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const invoke = action === 'vscode'
    ? bridge.openProjectFileInVSCode
    : bridge.showProjectFileInFolder;
  if (!invoke) throw new Error('Desktop file action is unavailable.');
  await invoke(projectRoot, relativePath);
}
```

Do not normalize or concatenate paths in this layer.

- [ ] **Step 4: Run the helper suite and confirm GREEN**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit the isolated desktop runtime helper**

```powershell
git add app/web/src/platform/desktop/desktopRuntime.ts app/__tests__/web-desktop-runtime.test.ts
git commit -m "feat: add desktop file action client"
```

### Task 5: Wire prompt-diff selection through open, reload, and file headers

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write a failing source-boundary regression test**

Add this test to the existing source-boundary suite. It deliberately checks each separate WorkspaceApp callback that Task 3 state tests cannot cover:

```ts
test('prompt diff selection follows row opens, summary fallback, reloads, and file clicks', () => {
  const mainTsx = readSourceText(mainPath);
  const openStart = mainTsx.indexOf('const openPromptArtifactDiff = useCallback(async');
  const openEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', openStart);
  const openBody = mainTsx.slice(openStart, openEnd);
  expect(openBody).toContain("activeFilePath: initialPath || initialFiles[0]?.path || ''");
  expect(openBody).toContain('resolvePromptDiffActiveFilePath(files,');
  expect(openBody).toContain('tab.activeFilePath');

  const restoreStart = mainTsx.indexOf('const loadRestoredPreviewTab = useCallback');
  const restoreEnd = mainTsx.indexOf('useEffect(() => {', restoreStart);
  const restoreBody = mainTsx.slice(restoreStart, restoreEnd);
  expect(restoreBody).toContain('resolvePromptDiffActiveFilePath(files, tab.activeFilePath)');

  const toggleStart = mainTsx.indexOf('const togglePromptArtifactPreviewFile = useCallback');
  const toggleEnd = mainTsx.indexOf('const selectedChatHasOpenPromptTurn', toggleStart);
  const toggleBody = mainTsx.slice(toggleStart, toggleEnd);
  expect(toggleBody).toContain('activeFilePath: path');
  expect(toggleBody).toContain('expanded: !file.expanded');

  const viewerStart = mainTsx.indexOf('const ChatPromptArtifactPreviewViewer = React.memo');
  const viewerEnd = mainTsx.indexOf('}, (prev, next) => (', viewerStart);
  const viewerBody = mainTsx.slice(viewerStart, viewerEnd);
  expect(viewerBody).toContain('file.path === preview.activeFilePath');
  expect(viewerBody).toContain('aria-current={active || undefined}');
});
```

- [ ] **Step 2: Run the preview suite and confirm RED**

```powershell
npm test -- __tests__/web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: FAIL because WorkspaceApp has no active-file wiring.

- [ ] **Step 3: Implement selection initialization and preservation**

Import `resolvePromptDiffActiveFilePath`. When opening an artifact, pass `activeFilePath: initialPath || initialFiles[0]?.path || ''`. After content loads, preserve `tab.activeFilePath` when still present, otherwise resolve from the initial path and new files. When restored tabs reload, resolve from `tab.activeFilePath` after applying retained expansion flags.

Update `togglePromptArtifactPreviewFile` so one state update assigns `activeFilePath: path` and toggles the matching file. In the viewer loop, compute `const active = file.path === preview.activeFilePath`, add the `active` class, and set `aria-current={active || undefined}`.

- [ ] **Step 4: Run state and preview suites and confirm GREEN**

```powershell
npm test -- __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the prompt-diff selection wiring**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts
git commit -m "feat: select active prompt diff files"
```

### Task 6: Render desktop-only actions, errors, and styling

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write a failing menu-and-style regression test**

```ts
test('prompt diff actions are independently desktop-gated and report native failures', () => {
  const mainTsx = readSourceText(mainPath);
  const stylesCss = readWebStyles(projectRoot);
  const actionsStart = mainTsx.indexOf('const renderPreviewWorkbenchActions = () => {');
  const actionsEnd = mainTsx.indexOf('const renderPreviewWorkbenchTabBody =', actionsStart);
  const actionsBody = mainTsx.slice(actionsStart, actionsEnd);

  expect(actionsBody).toContain('const desktopBridge = getDesktopWindowBridge();');
  expect(actionsBody).toContain('project.projectId === tab.projectId');
  expect(actionsBody).toContain("tab.type === 'prompt-diff' ? tab.activeFilePath : ''");
  expect(actionsBody).toContain(
    'const canOpenPromptDiffInVSCode = Boolean(projectRoot && relativePath && desktopBridge?.openProjectFileInVSCode);',
  );
  expect(actionsBody).toContain(
    'const canShowPromptDiffInFolder = Boolean(projectRoot && relativePath && desktopBridge?.showProjectFileInFolder);',
  );
  expect(actionsBody).toContain('{canOpenPromptDiffInVSCode ? (');
  expect(actionsBody).toContain('{canShowPromptDiffInFolder ? (');
  expect(actionsBody).toContain('Open with VS Code');
  expect(actionsBody).toContain('Show in File Explorer');
  expect(actionsBody).toContain("invokeDesktopProjectFileAction(desktopBridge, 'vscode', projectRoot, relativePath)");
  expect(actionsBody).toContain("invokeDesktopProjectFileAction(desktopBridge, 'folder', projectRoot, relativePath)");
  expect(actionsBody).toContain("runPromptDiffDesktopFileAction('vscode', 'Failed to open file in VS Code')");
  expect(actionsBody).toContain("runPromptDiffDesktopFileAction('folder', 'Failed to show file in File Explorer')");

  const handlerStart = actionsBody.indexOf('const runPromptDiffDesktopFileAction = (');
  const handlerEnd = actionsBody.indexOf('return (', handlerStart);
  const handlerBody = actionsBody.slice(handlerStart, handlerEnd);
  expect(handlerBody).toContain('closeActionsMenu();');
  expect(handlerBody).toContain("setError('');");
  expect(handlerBody).toContain('Promise.resolve()');
  const catchIndex = handlerBody.indexOf('.catch(err => {');
  const errorIndex = handlerBody.indexOf('setError(`${failurePrefix}: ${reason}`)', catchIndex);
  expect(catchIndex).toBeGreaterThanOrEqual(0);
  expect(errorIndex).toBeGreaterThan(catchIndex);
  expect(stylesCss).toContain('.chat-prompt-diff-file.active > .chat-prompt-diff-file-header');
});
```

- [ ] **Step 2: Run the preview suite and confirm RED**

Run the Task 5 Step 2 command. Expected: FAIL because the actions and active style are absent.

- [ ] **Step 3: Implement desktop-only menu actions and error handling**

Import `invokeDesktopProjectFileAction`. In `renderPreviewWorkbenchActions`, resolve:

```ts
const desktopBridge = getDesktopWindowBridge();
const projectRoot = projects.find(project => project.projectId === tab.projectId)?.path ?? '';
const relativePath = tab.type === 'prompt-diff' ? tab.activeFilePath : '';
```

Define the two exact `canOpenPromptDiffInVSCode` and `canShowPromptDiffInFolder` booleans asserted above, and wrap each item with its matching boolean only. Implement `runPromptDiffDesktopFileAction(action, failurePrefix)` so it closes the menu, clears the old error, calls the helper through `Promise.resolve().then(...)`, converts the rejection to a `reason` string inside `.catch(err => { ... })`, and then calls `setError(`${failurePrefix}: ${reason}`)`. Pass the two exact action-specific prefixes shown in the test. Do not add the actions to other tab types.

- [ ] **Step 4: Add the final active-file CSS**

Place these rules after the existing prompt-diff header hover rule so the active and active-hover states remain visible without changing dimensions:

```css
.chat-prompt-diff-file.active > .chat-prompt-diff-file-header {
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--accent-primary);
}

.chat-prompt-diff-file.active > .chat-prompt-diff-file-header:hover {
  background: color-mix(in srgb, var(--accent-primary) 18%, var(--hover));
}
```

- [ ] **Step 5: Run focused tests and type checking and confirm GREEN**

```powershell
npm test -- __tests__/web-desktop-runtime.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-peek-viewer.test.ts --runInBand
npm run tsc:web
```

Expected: both commands PASS with no TypeScript errors.

Do not commit Task 6 yet. The repository completion gate requires its UI/menu changes and this plan update to form the final implementation commit in the exact tail sequence below.

### Task 7: Verify and satisfy the repository completion gate

**Files:**
- Verify all files listed above.
- Include: `docs/superpowers/plans/2026-07-15-prompt-diff-desktop-file-actions.md`

- [ ] **Step 1: Re-read the spec and inspect the diff**

```powershell
git diff --check
git status --short
git diff HEAD
```

Expected: no whitespace errors; only the plan and intended Task 6 changes remain uncommitted, while prior focused commits contain Tasks 1–5.

- [ ] **Step 2: Run focused regression tests fresh**

From `app`:

```powershell
npm test -- __tests__/web-desktop-runtime.test.ts __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-peek-viewer.test.ts --runInBand
```

From `server`:

```powershell
go test ./cmd/wheelmaker-desktop -count=1
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run broader verification fresh**

From `app`:

```powershell
npm run tsc:web
npm test -- --runInBand
npm run build:web
```

From `server`:

```powershell
go test ./...
go build -o ..\\.tmp\\WheelMakerDesktop-test.exe ./cmd/wheelmaker-desktop/
```

Expected: all commands exit 0. The build writes only to the approved web output and `.tmp` test-binary locations; do not scan generated output.

- [ ] **Step 4: Execute the exact completion tail sequence**

From the repository root run these as separate commands, in this order:

```powershell
git add -A
git commit -m "feat: open prompt diff files from desktop"
git push origin codex/prompt-diff-desktop-file-actions
```

Expected: staging succeeds, the final implementation/UI/plan commit is created, and `codex/prompt-diff-desktop-file-actions` pushes to origin.

- [ ] **Step 5: Confirm the pushed state without changing it**

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

Expected: clean worktree and `codex/prompt-diff-desktop-file-actions` aligned with its origin tracking branch.
