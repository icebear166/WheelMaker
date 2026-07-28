# Shared File Context Menu Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared, theme-correct file context menu to Changed Files rows and chat file links, including normal preview, Desktop file clipboard, platform-specific Markdown HTML output, and path actions.

**Architecture:** `ChatTurnView` forwards Changed file context-menu intent to `WorkspaceApp`, which resolves the owning project and reuses `ChatFileLinkContextMenu` plus the existing file preview and Markdown HTML flows. WheelMaker Desktop adds one trusted absolute-path file clipboard binding that validates a regular file and publishes it through the existing Windows Shell/OLE and `CF_HDROP` infrastructure; Registry methods and protocol version remain unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Jest 30, project CSS theme tokens, Go 1.26, Windows WebView2, Shell/OLE clipboard APIs.

**Source spec:** `docs/scope/2026-07-28-file-context-menu-actions/spec-file-context-menu-actions.md`

---

## File structure

- Create `server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows.go` for validating and publishing an existing local file to the Windows clipboard without reading the entire file.
- Create `server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows_test.go` for Shell/OLE, raw `CF_HDROP`, validation, and fallback behavior.
- Modify `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go` and its test only to rename the shared OLE dependency type and reuse generic file-object publication while preserving HTML size and virtual-file fallback rules.
- Modify `server/cmd/wheelmaker-desktop/desktop_bridge.go`, `webview_policy.go`, and `webview_windows.go` plus existing tests to expose `copyFileToClipboard` only to a committed trusted remote page.
- Modify `app/web/src/platform/desktop/desktopRuntime.ts` and `app/__tests__/web-desktop-runtime.test.ts` to type, gate, and invoke the native file clipboard binding.
- Modify `app/web/src/chat/ChatTurnView.tsx` and `ChatTurnView.test.tsx` to forward right-clicks from individual Changed file rows without changing left-click diff behavior.
- Modify `app/web/src/chat/ChatFileLinkContextMenu.tsx` and `app/__tests__/web-chat-file-link-context-menu.test.tsx` to render capability-driven action groups, exact labels, icons, separators, and keyboard behavior.
- Modify `app/web/src/app/WorkspaceApp.tsx` and `app/__tests__/web-chat-file-peek-viewer.test.ts` to resolve Changed file targets, open normal previews, copy files, adapt HTML labels, and preserve existing path/native actions.
- Modify `app/web/src/styles/chat.css` for consistent menu geometry, icon alignment, separators, focus visibility, and token-driven light/dark shadows.
- Keep `docs/scope/2026-07-28-file-context-menu-actions/` and `docs/wiki/features/file-links.md` as the approved design and durable behavior record.

### Task 1: Commit the approved scope and wiki artifacts

**Files:**

- Create: `docs/scope/2026-07-28-file-context-menu-actions/spec-file-context-menu-actions.md`
- Create: `docs/scope/2026-07-28-file-context-menu-actions/plan-file-context-menu-actions.md`
- Modify: `docs/wiki/features/file-links.md`

- [x] **Step 1: Validate the documentation structure**

Run:

```powershell
$spec = 'docs/scope/2026-07-28-file-context-menu-actions/spec-file-context-menu-actions.md'
$plan = 'docs/scope/2026-07-28-file-context-menu-actions/plan-file-context-menu-actions.md'
$wiki = 'docs/wiki/features/file-links.md'
if ((Get-Content -LiteralPath $spec -TotalCount 1) -notmatch '^> 由 scope skill') { throw 'spec metadata missing' }
if ((Get-Content -LiteralPath $wiki -TotalCount 1) -notmatch '^> 摘要：') { throw 'wiki summary missing' }
if (-not (Select-String -LiteralPath $wiki -SimpleMatch 'spec-file-context-menu-actions.md')) { throw 'wiki source link missing' }
if (-not (Test-Path -LiteralPath $plan)) { throw 'implementation plan missing' }
git diff --check
```

Expected: no output after the explicit checks and exit code 0.

- [x] **Step 2: Commit the approved documentation**

```powershell
git add docs/scope/2026-07-28-file-context-menu-actions docs/wiki/features/file-links.md
git commit -m "docs: specify shared file context actions"
```

Expected: one commit containing only the approved spec, plan, and wiki update.

### Task 2: Publish an existing Windows file to the clipboard

**Files:**

- Create: `server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows_test.go`

- [x] **Step 1: Write failing generic file clipboard tests**

Create `desktop_file_clipboard_windows_test.go` with focused tests that do not touch the real system clipboard:

```go
//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSetDesktopFileClipboardUsesShellOLEDataObject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.bin")
	if err := os.WriteFile(path, []byte{1, 2, 3}, 0o600); err != nil {
		t.Fatal(err)
	}

	const dataObject = uintptr(0x4321)
	var createdPath string
	var setDataObject uintptr
	released := false
	operations := desktopFileClipboardOLEOperations{
		createDataObject: func(gotPath string) (uintptr, func(), error) {
			createdPath = gotPath
			return dataObject, func() { released = true }, nil
		},
		setClipboard: func(gotDataObject uintptr) error {
			setDataObject = gotDataObject
			return nil
		},
	}

	if err := setDesktopFileClipboardWithOLEOperations(path, operations); err != nil {
		t.Fatal(err)
	}
	if createdPath != path || setDataObject != dataObject || !released {
		t.Fatalf("createdPath=%q setDataObject=%#x released=%v", createdPath, setDataObject, released)
	}
}

func TestSetDesktopFileClipboardRawFallbackPublishesDropFormats(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large-file.bin")
	if err := os.WriteFile(path, []byte{1}, 0o600); err != nil {
		t.Fatal(err)
	}

	const ownerWindow = uintptr(0x1234)
	var openedWindow uintptr
	var labels []string
	nextFormat := uintptr(100)
	operations := desktopFileClipboardOperations{
		openClipboard: func(hwnd uintptr) error {
			openedWindow = hwnd
			return nil
		},
		closeClipboard: func() {},
		emptyClipboard: func() error { return nil },
		registerClipboardFormat: func(name string) (uintptr, error) {
			if name != desktopPreferredDropEffectFormat {
				t.Fatalf("registered format %q", name)
			}
			format := nextFormat
			nextFormat++
			return format, nil
		},
		setClipboardData: func(_ uintptr, _ []byte, label string) error {
			labels = append(labels, label)
			return nil
		},
	}

	if err := setDesktopFileClipboardWithOperations(ownerWindow, path, operations); err != nil {
		t.Fatal(err)
	}
	if openedWindow != ownerWindow {
		t.Fatalf("OpenClipboard hwnd=%#x, want %#x", openedWindow, ownerWindow)
	}
	if got, want := labels, []string{"file drop", "preferred drop effect"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("clipboard labels=%v, want %v", got, want)
	}
}

func TestSetDesktopFileClipboardRejectsInvalidTargets(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "folder")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"relative.txt",
		filepath.Join(root, "missing.txt"),
		directory,
	} {
		t.Run(path, func(t *testing.T) {
			if err := setDesktopFileClipboardWithOLEOperations(path, desktopFileClipboardOLEOperations{}); err == nil {
				t.Fatal("setDesktopFileClipboardWithOLEOperations() error=nil")
			}
		})
	}
}
```

Include `reflect` in the import list. Extend the existing HTML clipboard tests so their fake operation value uses the renamed `desktopFileClipboardOLEOperations` type. Do not change the HTML transfer-store tests or the 16 MiB generated-HTML limit.

- [x] **Step 2: Run the focused tests and confirm RED**

From `server` run:

```powershell
go test ./cmd/wheelmaker-desktop -run 'TestSetDesktop(FileClipboard|HTMLFileClipboard)' -count=1
```

Expected: FAIL because `desktopFileClipboardOperations`, `desktopFileClipboardOLEOperations`, and the generic publication helpers do not exist.

- [x] **Step 3: Implement generic existing-file clipboard publication**

Create `desktop_file_clipboard_windows.go`:

```go
//go:build windows

package main

import "fmt"

type desktopFileClipboardOperations struct {
	openClipboard           func(uintptr) error
	closeClipboard          func()
	emptyClipboard          func() error
	registerClipboardFormat func(string) (uintptr, error)
	setClipboardData        func(uintptr, []byte, string) error
}

func setDesktopFileClipboard(hwnd uintptr, path string) error {
	oleErr := setDesktopFileClipboardWithOLEOperations(path, desktopFileClipboardOLEOperations{
		createDataObject: newDesktopShellFileDataObject,
		setClipboard:     setDesktopOLEClipboard,
	})
	if oleErr == nil {
		return nil
	}
	rawErr := setDesktopFileClipboardWithOperations(hwnd, path, desktopFileClipboardOperations{
		openClipboard: func(owner uintptr) error {
			opened, _, callErr := procDesktopOpenClipboard.Call(owner)
			if opened == 0 {
				return desktopClipboardCallError("open clipboard", callErr)
			}
			return nil
		},
		closeClipboard: func() {
			procDesktopCloseClipboard.Call()
		},
		emptyClipboard: func() error {
			emptied, _, callErr := procDesktopEmptyClipboard.Call()
			if emptied == 0 {
				return desktopClipboardCallError("empty clipboard", callErr)
			}
			return nil
		},
		registerClipboardFormat: registerDesktopClipboardFormat,
		setClipboardData:        setDesktopGlobalClipboardData,
	})
	if rawErr == nil {
		return nil
	}
	return fmt.Errorf("set Shell/OLE file clipboard: %v; raw clipboard fallback: %w", oleErr, rawErr)
}

func setDesktopFileClipboardWithOLEOperations(
	path string,
	operations desktopFileClipboardOLEOperations,
) error {
	target, err := resolveDesktopAbsoluteFilePath(path)
	if err != nil {
		return err
	}
	return publishDesktopFileClipboardWithOLEOperations(target, operations)
}

func publishDesktopFileClipboardWithOLEOperations(
	path string,
	operations desktopFileClipboardOLEOperations,
) error {
	if operations.createDataObject == nil || operations.setClipboard == nil {
		return fmt.Errorf("file clipboard OLE operations are unavailable")
	}
	dataObject, release, err := operations.createDataObject(path)
	if err != nil {
		return err
	}
	if release != nil {
		defer release()
	}
	if dataObject == 0 {
		return fmt.Errorf("Shell data object is unavailable")
	}
	return operations.setClipboard(dataObject)
}

func setDesktopFileClipboardWithOperations(
	hwnd uintptr,
	path string,
	operations desktopFileClipboardOperations,
) error {
	target, err := resolveDesktopAbsoluteFilePath(path)
	if err != nil {
		return err
	}
	dropFiles, err := encodeDesktopDropFiles([]string{target})
	if err != nil {
		return err
	}
	preferredFormat, err := operations.registerClipboardFormat(desktopPreferredDropEffectFormat)
	if err != nil {
		return err
	}
	if err := operations.openClipboard(hwnd); err != nil {
		return err
	}
	defer operations.closeClipboard()
	if err := operations.emptyClipboard(); err != nil {
		return err
	}
	for _, payload := range []struct {
		format uintptr
		data   []byte
		label  string
	}{
		{format: cfHDrop, data: dropFiles, label: "file drop"},
		{format: preferredFormat, data: encodeDesktopPreferredDropEffect(), label: "preferred drop effect"},
	} {
		if err := operations.setClipboardData(payload.format, payload.data, payload.label); err != nil {
			return err
		}
	}
	return nil
}
```

In `desktop_html_clipboard_windows.go`, rename:

```go
type desktopHTMLClipboardOLEOperations
```

to:

```go
type desktopFileClipboardOLEOperations
```

Update the HTML helper and tests to use the new shared type name. Keep `setDesktopHTMLFileClipboardWithOLEOperations` as the HTML-specific validator: it must still reject empty or over-16-MiB generated HTML before creating the Shell data object. Do not route the HTML raw fallback through the generic two-format fallback because HTML exports still need virtual descriptors and file contents for compatible paste targets.

After the HTML-specific validation succeeds, call:

```go
return publishDesktopFileClipboardWithOLEOperations(path, operations)
```

This keeps one Shell/OLE publication implementation while preserving the HTML-only size checks and raw virtual-file fallback.

- [x] **Step 4: Format and run clipboard tests**

From `server` run:

```powershell
gofmt -w cmd/wheelmaker-desktop/desktop_file_clipboard_windows.go cmd/wheelmaker-desktop/desktop_file_clipboard_windows_test.go cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go cmd/wheelmaker-desktop/desktop_html_clipboard_windows_test.go
go test ./cmd/wheelmaker-desktop -run 'Test(SetDesktop(FileClipboard|HTMLFileClipboard)|DesktopHTMLClipboard|EncodeDesktopVirtualHTML)' -count=1
```

Expected: PASS. The generic raw fallback sets exactly `CF_HDROP` and `Preferred DropEffect`; existing HTML tests still set five formats.

- [x] **Step 5: Commit native clipboard publication**

```powershell
git add server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows.go server/cmd/wheelmaker-desktop/desktop_file_clipboard_windows_test.go server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows_test.go
git commit -m "feat(desktop): copy existing files to clipboard"
```

### Task 3: Expose the trusted Desktop copy-file bridge

**Files:**

- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Modify: `app/__tests__/web-desktop-runtime.test.ts`

- [x] **Step 1: Write failing authorization and runtime tests**

Extend `TestDesktopBridgeAuthorization` with these rows:

```go
{name: "bootstrap cannot copy absolute file", mode: desktopBootstrapPage, url: "about:blank", mainFrame: true, action: desktopBridgeCopyFileToClipboard},
{name: "remote copies absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/projects", mainFrame: true, action: desktopBridgeCopyFileToClipboard, want: true},
{name: "outside base path cannot copy absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/admin/", mainFrame: true, action: desktopBridgeCopyFileToClipboard},
{name: "iframe cannot copy absolute file", mode: desktopTrustedRemotePage, url: "https://example.com/wheelmaker/", mainFrame: false, action: desktopBridgeCopyFileToClipboard},
```

Include `desktopBridgeCopyFileToClipboard` in the committed-navigation action matrix. Extend `TestDesktopRuntimeFileActionBindings` to require:

```go
"copyFileToClipboard",
desktopCopyFileToClipboardBinding,
"authorize(desktopBridgeCopyFileToClipboard)",
"setDesktopFileClipboard(hwnd, absolutePath)",
```

and assert that the private binding name appears in neither the bootstrap nor Local Dev object.

In `web-desktop-runtime.test.ts`, extend `TestDesktopBridge` and the `runtime` test facade:

```ts
type TestDesktopBridge = {
  enabled: true;
  copyFileToClipboard?: (absolutePath: string) => Promise<void> | void;
  // existing methods remain
};

const runtime = desktopRuntime as unknown as {
  // existing methods remain
  canCopyDesktopFile?: (bridge: TestDesktopBridge | null, absolutePath: string) => boolean;
  copyDesktopFile?: (
    bridge: TestDesktopBridge,
    absolutePath: string,
  ) => Promise<void>;
};
```

Add:

```ts
describe('desktop file clipboard', () => {
  test('reports capability and forwards the exact absolute path', async () => {
    const copyFileToClipboard = jest.fn();
    const bridge: TestDesktopBridge = {enabled: true, copyFileToClipboard};

    expect(runtime.canCopyDesktopFile!(bridge, 'D:/repo/file name.txt')).toBe(true);
    await runtime.copyDesktopFile!(bridge, 'D:/repo/file name.txt');

    expect(copyFileToClipboard).toHaveBeenCalledWith('D:/repo/file name.txt');
  });

  test('rejects missing bindings and empty paths', async () => {
    expect(runtime.canCopyDesktopFile!({enabled: true}, 'D:/repo/file.txt')).toBe(false);
    expect(runtime.canCopyDesktopFile!({
      enabled: true,
      copyFileToClipboard: jest.fn(),
    }, '')).toBe(false);
    await expect(runtime.copyDesktopFile!({enabled: true}, 'D:/repo/file.txt'))
      .rejects.toEqual(new Error('Desktop file clipboard is unavailable.'));
  });
});
```

- [x] **Step 2: Run bridge tests and confirm RED**

Run:

```powershell
Set-Location server
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(BridgeAuthorization|FileActionsRequireCommittedTrustedNavigation|RuntimeFileActionBindings)' -count=1
Set-Location ..\app
npm test -- --runInBand __tests__/web-desktop-runtime.test.ts
Set-Location ..
```

Expected: FAIL because the action, binding, and TypeScript helpers do not exist.

- [x] **Step 3: Implement the native binding and policy**

Add to `desktop_bridge.go`:

```go
desktopCopyFileToClipboardBinding = "__wheelMakerDesktopCopyFileToClipboard"
```

Expose it only in the trusted remote `WheelMakerDesktop` object:

```js
copyFileToClipboard: invoke('` + desktopCopyFileToClipboardBinding + `'),
```

Add `desktopBridgeCopyFileToClipboard` to the `desktopBridgeAction` enum and to the trusted remote allowlist in `webview_policy.go`; do not add it to bootstrap or Local Dev allowlists.

Add this binding in `bindDesktopWindowBridge`:

```go
{desktopCopyFileToClipboardBinding, func(absolutePath string) error {
	if err := authorize(desktopBridgeCopyFileToClipboard); err != nil {
		return err
	}
	return setDesktopFileClipboard(hwnd, absolutePath)
}},
```

- [x] **Step 4: Implement the typed Web runtime helper**

Add to `DesktopWindowBridge`:

```ts
copyFileToClipboard?: (absolutePath: string) => Promise<void> | void;
```

Add:

```ts
export function canCopyDesktopFile(
  bridge: DesktopWindowBridge | null,
  absolutePath: string,
): boolean {
  return Boolean(bridge?.copyFileToClipboard && absolutePath);
}

export async function copyDesktopFile(
  bridge: DesktopWindowBridge,
  absolutePath: string,
): Promise<void> {
  if (!bridge.copyFileToClipboard || !absolutePath) {
    throw new Error('Desktop file clipboard is unavailable.');
  }
  await bridge.copyFileToClipboard(absolutePath);
}
```

- [x] **Step 5: Format, verify, and commit the bridge**

Run:

```powershell
Set-Location server
gofmt -w cmd/wheelmaker-desktop/desktop_bridge.go cmd/wheelmaker-desktop/webview_policy.go cmd/wheelmaker-desktop/webview_policy_test.go cmd/wheelmaker-desktop/webview_windows.go cmd/wheelmaker-desktop/webview_windows_test.go
go test ./cmd/wheelmaker-desktop -run 'TestDesktop(BridgeAuthorization|FileActionsRequireCommittedTrustedNavigation|RuntimeFileActionBindings)' -count=1
Set-Location ..\app
npm test -- --runInBand __tests__/web-desktop-runtime.test.ts
npm run tsc:web
Set-Location ..
```

Expected: PASS.

```powershell
git add server/cmd/wheelmaker-desktop/desktop_bridge.go server/cmd/wheelmaker-desktop/webview_policy.go server/cmd/wheelmaker-desktop/webview_policy_test.go server/cmd/wheelmaker-desktop/webview_windows.go server/cmd/wheelmaker-desktop/webview_windows_test.go app/web/src/platform/desktop/desktopRuntime.ts app/__tests__/web-desktop-runtime.test.ts
git commit -m "feat(desktop): expose trusted file clipboard action"
```

### Task 4: Forward Changed file right-click intent

**Files:**

- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`

- [x] **Step 1: Write a failing Changed Files interaction test**

Add to `ChatTurnView.test.tsx`:

```tsx
describe('ChatTurnView Changed Files interactions', () => {
  it('keeps left-click diff behavior and forwards only file-row context menus', async () => {
    const onOpenPromptArtifact = jest.fn();
    const onOpenPromptArtifactFileContextMenu = jest.fn();
    const value = message('prompt_done', {
      artifacts: [{
        artifactId: 'artifact-1',
        type: 'diff',
        format: 'unified-diff',
        fileCount: 1,
        files: [{
          path: 'src/main.ts',
          status: 'M',
          additions: 4,
          deletions: 1,
        }],
      }],
    });
    const tree = await renderTurn(value, {
      onOpenPromptArtifact,
      onOpenPromptArtifactFileContextMenu,
    });

    const summary = tree.root.findByProps({className: 'chat-prompt-artifact-summary'});
    const fileRow = tree.root.findByProps({className: 'chat-prompt-artifact-file'});
    const contextEvent = {
      clientX: 32,
      clientY: 48,
      preventDefault: jest.fn(),
    };

    await act(async () => fileRow.props.onClick());
    expect(onOpenPromptArtifact).toHaveBeenCalledWith(
      expect.objectContaining({artifactId: 'artifact-1'}),
      value,
      'src/main.ts',
    );

    await act(async () => fileRow.props.onContextMenu(contextEvent));
    expect(onOpenPromptArtifactFileContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({artifactId: 'artifact-1'}),
      value,
      expect.objectContaining({path: 'src/main.ts', status: 'M'}),
      contextEvent,
    );
    expect(summary.props.onContextMenu).toBeUndefined();
  });
});
```

- [x] **Step 2: Run the test and confirm RED**

From `app` run:

```powershell
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx
```

Expected: FAIL because file rows do not expose the context-menu callback.

- [x] **Step 3: Add the optional callback without changing click behavior**

Add this prop:

```ts
onOpenPromptArtifactFileContextMenu?: (
  artifact: RegistrySessionPromptArtifact,
  message: RegistryChatMessage,
  file: RegistrySessionPromptArtifactFile,
  event: React.MouseEvent<HTMLButtonElement>,
) => void;
```

Destructure it in `ChatTurnView`, then add only this handler to the individual file button:

```tsx
onContextMenu={event =>
  onOpenPromptArtifactFileContextMenu?.(artifact, message, file, event)
}
```

Do not add a context-menu handler to the summary button and do not call `preventDefault` inside the presentation component; `WorkspaceApp` owns whether it can resolve a valid target.

- [x] **Step 4: Verify and commit Changed Files presentation**

Run:

```powershell
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx
npm run tsc:web
```

Expected: PASS.

```powershell
git add app/web/src/chat/ChatTurnView.tsx app/web/src/chat/ChatTurnView.test.tsx
git commit -m "feat(app): expose changed file context intent"
```

### Task 5: Build and connect the shared file menu

**Files:**

- Modify: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Modify: `app/__tests__/web-chat-file-link-context-menu.test.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/web/src/styles/chat.css`

- [x] **Step 1: Write failing menu order, icon, separator, and platform-label tests**

Replace the component-test fixture capabilities with:

```tsx
const internalProps: ChatFileLinkContextMenuProps = {
  x: 24,
  y: 36,
  link: {
    path: 'src/main.ts',
    absolutePath: 'D:/repo/src/main.ts',
    relativePath: 'src/main.ts',
    line: 4,
  },
  canOpenInVSCode: true,
  canShowInFolder: true,
  canCopyFile: true,
  htmlActionLabel: null,
  onAction: jest.fn(),
  onClose: jest.fn(),
};
```

Add helpers:

```tsx
function icons(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => node.props.role === 'menuitem')
    .map(button => button.findByType('svg').props['data-icon-name'] as string);
}

function separatorCount(renderer: TestRenderer.ReactTestRenderer): number {
  return renderer.root.findAll(node => node.props.role === 'separator').length;
}
```

The Desktop internal-file test must assert:

```tsx
expect(labels(renderer)).toEqual([
  'Preview file',
  'Open with VS Code',
  'Show in File Explorer',
  'Copy file',
  'Copy relative path',
  'Copy absolute path',
]);
expect(icons(renderer)).toEqual([
  'eye',
  'code',
  'folderOpen',
  'copy',
  'fileSymlink',
  'clipboard',
]);
expect(separatorCount(renderer)).toBe(2);
```

Add a Desktop project Markdown case:

```tsx
<ChatFileLinkContextMenu
  {...internalProps}
  link={{...internalProps.link, path: 'README.md', relativePath: 'README.md'}}
  htmlActionLabel="Copy file as HTML"
/>
```

Expected labels include `Copy file as HTML` between `Copy file` and the second separator, with `fileCode`.

Add a browser project Markdown case with all native capabilities false and:

```tsx
htmlActionLabel="Export as HTML"
```

Expected labels:

```tsx
[
  'Preview file',
  'Export as HTML',
  'Copy relative path',
  'Copy absolute path',
]
```

Add an external-browser case expecting exactly:

```tsx
['Preview file', 'Copy absolute path']
```

and one separator. Verify clicking every visible item emits the matching action IDs:

```tsx
[
  'preview',
  'vscode',
  'folder',
  'copy-file',
  'export-html',
  'copy-relative',
  'copy-absolute',
]
```

for a fully capable Markdown menu.

- [x] **Step 2: Add failing Workspace integration and theme assertions**

Extend the existing file-link context-menu test in `web-chat-file-peek-viewer.test.ts` to require:

```ts
expect(mainTsx).toContain('const openPromptArtifactFileContextMenu = useCallback');
expect(mainTsx).toContain('onOpenPromptArtifactFileContextMenu={');
expect(mainTsx).toContain("action === 'preview'");
expect(mainTsx).toContain('openChatFilePeek(menuFilePath, menuLine, menuProjectId);');
expect(mainTsx).toContain("action === 'copy-file'");
expect(mainTsx).toContain('canCopyDesktopFile(');
expect(mainTsx).toContain('copyDesktopFile(');
expect(mainTsx).toContain("setToastMessage('Copied file.')");
expect(mainTsx).toContain("htmlActionLabel={");
expect(mainTsx).toContain("'Copy file as HTML'");
expect(mainTsx).toContain("'Export as HTML'");
expect(menuTsx).toContain("{action: 'preview', icon: 'eye', label: 'Preview file'}");
expect(menuTsx).toContain("{action: 'copy-file', icon: 'copy', label: 'Copy file'}");
expect(menuTsx).not.toContain('onLongPress');
```

Add CSS assertions:

```ts
const menuRule = cssRuleBlock(stylesCss, '.chat-file-link-context-menu');
expect(menuRule).toContain('background: var(--surface-overlay);');
expect(menuRule).toContain('box-shadow: var(--shadow-overlay);');
expect(stylesCss).toContain('.chat-file-link-context-menu-separator');
expect(stylesCss).toContain('color: var(--text-secondary);');
expect(stylesCss).toContain('outline: 2px solid var(--focus-ring-color);');
```

- [x] **Step 3: Run focused UI tests and confirm RED**

From `app` run:

```powershell
npm test -- --runInBand __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: FAIL because the new actions, groups, Changed file wiring, clipboard handler, and tokenized styles do not exist.

- [x] **Step 4: Implement capability-driven action groups**

Update the action and prop contracts:

```tsx
export type ChatFileLinkMenuAction =
  | 'preview'
  | 'vscode'
  | 'folder'
  | 'copy-file'
  | 'copy-relative'
  | 'copy-absolute'
  | 'export-html';

export type ChatFileLinkHtmlActionLabel =
  | 'Copy file as HTML'
  | 'Export as HTML';

export type ChatFileLinkContextMenuProps = {
  x: number;
  y: number;
  link: PreviewFileLink;
  canOpenInVSCode: boolean;
  canShowInFolder: boolean;
  canCopyFile: boolean;
  htmlActionLabel: ChatFileLinkHtmlActionLabel | null;
  onAction: (action: ChatFileLinkMenuAction) => void;
  onClose: () => void;
};
```

Build three non-empty groups in this exact order:

```tsx
const actionGroups: MenuEntry[][] = [
  [
    {action: 'preview', icon: 'eye', label: 'Preview file'},
    canOpenInVSCode
      ? {action: 'vscode', icon: 'code', label: 'Open with VS Code'}
      : null,
    canShowInFolder
      ? {action: 'folder', icon: 'folderOpen', label: 'Show in File Explorer'}
      : null,
  ].filter(isMenuEntry),
  [
    canCopyFile
      ? {action: 'copy-file', icon: 'copy', label: 'Copy file'}
      : null,
    htmlActionLabel
      ? {action: 'export-html', icon: 'fileCode', label: htmlActionLabel}
      : null,
  ].filter(isMenuEntry),
  [
    link.relativePath !== null
      ? {action: 'copy-relative', icon: 'fileSymlink', label: 'Copy relative path'}
      : null,
    {action: 'copy-absolute', icon: 'clipboard', label: 'Copy absolute path'},
  ].filter(isMenuEntry),
].filter(group => group.length > 0);
```

Define `MenuEntry` and `isMenuEntry` explicitly:

```tsx
type MenuEntry = {
  action: ChatFileLinkMenuAction;
  icon: ChatIconName;
  label: string;
};

function isMenuEntry(entry: MenuEntry | null): entry is MenuEntry {
  return entry !== null;
}
```

Render one separator only between adjacent non-empty groups:

```tsx
{actionGroups.map((group, groupIndex) => (
  <React.Fragment key={group[0].action}>
    {groupIndex > 0 ? (
      <div
        className="chat-file-link-context-menu-separator"
        role="separator"
      />
    ) : null}
    {group.map(entry => item(entry.action, entry.icon, entry.label))}
  </React.Fragment>
))}
```

Keep the existing menu focus, Escape restoration, outside-click, scroll, resize, and arrow-key behavior unchanged.

- [x] **Step 5: Resolve Changed file targets and connect all actions**

Extend `ChatFileLinkMenuState`:

```ts
type ChatFileLinkMenuState = {
  x: number;
  y: number;
  projectId: string;
  projectRoot: string;
  link: PreviewFileLink;
  fileAvailable: boolean;
};
```

Existing chat-file links set `fileAvailable: true`. Add:

```tsx
const openPromptArtifactFileContextMenu = useCallback((
  _artifact: RegistrySessionPromptArtifact,
  _message: RegistryChatMessage,
  file: RegistrySessionPromptArtifactFile,
  event: React.MouseEvent<HTMLButtonElement>,
) => {
  const targetProjectId =
    selectedArchivedKey?.projectId ||
    selectedChatKey?.projectId ||
    projectId;
  const targetProject = projects.find(project => project.projectId === targetProjectId);
  const targetFile = targetProject
    ? resolvePreviewFileLink(file.path, targetProject.path)
    : null;
  if (!targetProjectId || !targetProject || !targetFile) {
    return;
  }
  event.preventDefault();
  setChatFileLinkMenu({
    x: Math.min(event.clientX, Math.max(8, window.innerWidth - 228)),
    y: Math.min(event.clientY, Math.max(8, window.innerHeight - 280)),
    projectId: targetProjectId,
    projectRoot: targetProject.path,
    link: targetFile,
    fileAvailable: file.status.toUpperCase() !== 'D',
  });
}, [
  projectId,
  projects,
  selectedArchivedKey?.projectId,
  selectedChatKey?.projectId,
]);
```

Pass this callback to both active and archived `ChatTurnView` instances only for `prompt_done` messages. Add it to both render callback dependency arrays.

Import `canCopyDesktopFile` and `copyDesktopFile`. In `handleChatFileLinkMenuAction`, capture `menuLine` before closing the menu and handle the two new actions before Desktop open/reveal dispatch:

```tsx
if (action === 'preview') {
  openChatFilePeek(menuFilePath, menuLine, menuProjectId);
  return;
}
if (action === 'copy-file') {
  const desktopBridge = getDesktopWindowBridge();
  if (!desktopBridge || !absolutePath) return;
  copyDesktopFile(desktopBridge, absolutePath)
    .then(() => setToastMessage('Copied file.'))
    .catch(err => {
      const reason = err instanceof Error ? err.message : String(err);
      setToastMessage(`Failed to copy file: ${reason}`);
    });
  return;
}
```

Keep `export-html`, path copies, VS Code, and Explorer on their existing code paths. Render the menu with:

```tsx
canCopyFile={
  chatFileLinkMenu.fileAvailable &&
  canCopyDesktopFile(
    chatFileLinkDesktopBridge,
    chatFileLinkMenu.link.absolutePath,
  )
}
htmlActionLabel={
  chatFileLinkMenu.fileAvailable &&
  chatFileLinkMenu.link.relativePath !== null &&
  isMarkdownPath(chatFileLinkMenu.link.path)
    ? chatFileLinkDesktopBridge
      ? 'Copy file as HTML'
      : 'Export as HTML'
    : null
}
```

Use `menuLine = chatFileLinkMenu.link.line` so ordinary links retain line-number preview jumps. Explicitly deleted Changed files still receive `Preview file`, Explorer, and path actions, but not `Copy file` or HTML output.

- [x] **Step 6: Apply menu visual baseline and light-theme tokens**

Replace the context-menu CSS block with token-driven geometry:

```css
.chat-file-link-context-menu {
  position: fixed;
  z-index: 140;
  min-width: 208px;
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-overlay);
}

.chat-file-link-context-menu button {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
}

.chat-file-link-context-menu button .sl-icon {
  flex: 0 0 auto;
  color: var(--text-secondary);
}

.chat-file-link-context-menu button:hover {
  background: var(--hover);
}

.chat-file-link-context-menu button:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}

.chat-file-link-context-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-subtle);
}
```

Do not add animation, gradients, blur, new color literals, new icon assets, or a second menu primitive. The existing `ChatIcon` glyphs were verified against Lucide; retain their project-standard 1.5px stroke and `currentColor`.

- [x] **Step 7: Verify focused UI behavior and commit**

Run from `app`:

```powershell
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-menu-keyboard-nav.test.ts __tests__/web-desktop-runtime.test.ts
npm run tsc:web
```

Expected: PASS.

```powershell
git add app/web/src/chat/ChatFileLinkContextMenu.tsx app/__tests__/web-chat-file-link-context-menu.test.tsx app/web/src/chat/ChatTurnView.tsx app/web/src/chat/ChatTurnView.test.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-file-peek-viewer.test.ts app/web/src/styles/chat.css app/web/src/platform/desktop/desktopRuntime.ts app/__tests__/web-desktop-runtime.test.ts
git commit -m "feat(app): unify file context actions"
```

### Task 6: Run regression and production verification

**Files:**

- Verify all files changed by Tasks 1–5.

- [x] **Step 1: Run the complete affected Web test set**

From `app` run:

```powershell
npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx __tests__/web-chat-file-link-context-menu.test.tsx __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-menu-keyboard-nav.test.ts __tests__/web-desktop-runtime.test.ts __tests__/web-markdown-html-output.test.ts __tests__/web-preview-file-regressions.test.tsx __tests__/web-port-relay-settings.test.ts
```

Expected: PASS with no open handles.

- [x] **Step 2: Run type checking and the production Web build**

```powershell
npm run tsc:web
npm run build:web
```

Expected: both commands exit 0; the build writes the normal Web output outside `app/dist` according to repository rules.

- [x] **Step 3: Run Desktop package and server regression tests**

From `server` run:

```powershell
go test ./cmd/wheelmaker-desktop -count=1
go test ./... -count=1
```

Expected: PASS.

- [x] **Step 4: Inspect final theme and behavior invariants**

Run from the repository root:

```powershell
git diff --check
rg -n --glob '!**/dist/**' "Preview file|Copy file as HTML|Copy file|chat-file-link-context-menu-separator|copyFileToClipboard" app server docs
git status --short
```

Confirm from the diff:

- the summary button has no context-menu handler;
- the Changed file row keeps its existing `onClick`;
- the shared menu contains no long-press handler;
- light and dark appearance depend only on existing theme tokens;
- `desktopBridgeCopyFileToClipboard` is remote-only;
- no Registry method or protocol version changed.

- [x] **Step 5: Record completion in the plan**

Mark every completed checkbox in this plan as `[x]`. This final documentation update is intentionally left for the repository completion commit so the mandatory add/commit/push gate has a concrete tracked change.
