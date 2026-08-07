# Markdown HTML Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export project Markdown files and completed chat responses as portable, self-contained HTML files through preview, file-link, and prompt-done entry points.

**Architecture:** A hidden React export surface reuses the app's Markdown, Shiki, Mermaid, and math lifecycle, then serializes its settled DOM with standalone CSS. A platform adapter routes the HTML Blob to browser download, a trusted Desktop file-clipboard bridge, or an Android file-share bridge. Project image bytes come from existing `project.fs.read` responses, so Registry protocol version does not change.

**Tech Stack:** React 19, TypeScript, react-markdown, remark-gfm, rehype-raw, rehype-sanitize, Shiki, Jest, Go/Windows WebView2, Windows clipboard APIs, Kotlin/Android FileProvider.

---

## File structure

- `app/web/src/chat/export/markdownHtmlExport.ts` — naming, project-image path resolution, safe export surface, standalone document assembly.
- `app/web/src/chat/export/markdownHtmlOutput.ts` — browser, Desktop, and Android Blob delivery.
- `app/web/src/platform/desktop/desktopRuntime.ts` — typed Desktop HTML clipboard bridge.
- `app/web/src/platform/android/androidNativeMessageBridge.ts` — typed Android HTML-share RPC.
- `app/web/src/registry/RegistryWorkspaceService.ts` — preserves binary `mimeType` and `encoding`.
- `app/web/src/app/WorkspaceApp.tsx` — entry-point callbacks, busy state, image reads, hidden rendering, and feedback.
- `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go` — secure temporary HTML file plus `CF_HDROP`.
- `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidHtmlShareRuntime.kt` — secure temporary HTML file plus Android share chooser.

### Task 1: Commit the approved scope artifacts

**Files:**

- Create: `docs/plans/2026-07-24-markdown-html-export/plan-markdown-html-export.md`
- Modify: `docs/scope/2026-07-24-markdown-html-export.md`
- Modify: `docs/wiki/features/file-links.md`

- [ ] **Step 1: Inspect the approved documents**

Run: `git status --short && git diff -- docs/scope/2026-07-24-markdown-html-export.md docs/wiki/features/file-links.md`

Expected: only the approved spec, plan, and wiki update are present.

- [ ] **Step 2: Commit the design baseline**

```powershell
git add docs/scope/2026-07-24-markdown-html-export.md docs/wiki/features/file-links.md
git commit -m "docs: plan markdown HTML export"
```

Expected: the worktree is clean after the documentation commit.

### Task 2: Build the standalone Markdown renderer

**Files:**

- Create: `app/web/src/chat/export/markdownHtmlExport.ts`
- Create: `app/__tests__/web-markdown-html-export.test.tsx`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/__tests__/web-external-file-service.test.ts`

- [ ] **Step 1: Write failing utility and metadata-preservation tests**

```tsx
import {
  buildMarkdownHtmlFileName,
  buildPromptMarkdownHtmlFileName,
  buildStandaloneMarkdownHtmlDocument,
  resolveProjectMarkdownImagePath,
} from '../web/src/chat/export/markdownHtmlExport';

test('uses deterministic HTML export names', () => {
  expect(buildMarkdownHtmlFileName('docs/README.MD')).toBe('README.html');
  expect(buildPromptMarkdownHtmlFileName(7, new Date('2026-07-24T08:09:10.123Z')))
    .toBe('wheelmaker-response-turn-7-2026-07-24T08-09-10-123Z.html');
});

test('accepts only project-contained image paths', () => {
  expect(resolveProjectMarkdownImagePath('docs/guide/readme.md', '../assets/logo.png'))
    .toBe('docs/assets/logo.png');
  expect(resolveProjectMarkdownImagePath('docs/guide/readme.md', '../../../secret.png'))
    .toBeNull();
  expect(resolveProjectMarkdownImagePath('docs/guide/readme.md', 'https://example.test/logo.png'))
    .toBeNull();
});

test('creates an offline HTML document', () => {
  const html = buildStandaloneMarkdownHtmlDocument({title: 'README', bodyHtml: '<h1>Hello</h1>'});
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain('<h1>Hello</h1>');
  expect(html).not.toContain('<script');
});
```

Extend `web-external-file-service.test.ts` with a `RegistryWorkspaceService.readProjectFile` fixture containing `isBinary: true`, `mimeType: 'image/png'`, and `encoding: 'base64'`; assert all fields reach the caller.

- [ ] **Step 2: Run the new tests to confirm failure**

Run: `npm test -- --runInBand web-markdown-html-export.test.tsx web-external-file-service.test.ts`

Expected: FAIL because the export module and extended service result are absent.

- [ ] **Step 3: Install the raw-HTML parser and sanitizer**

```powershell
npm install rehype-raw@^7.0.0 rehype-sanitize@^6.0.0
```

Expected: only these direct dependencies and their lockfile graph are added.

- [ ] **Step 4: Implement names, safe paths, and binary metadata**

```tsx
export function buildMarkdownHtmlFileName(path: string): string {
  const base = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || 'document.md';
  return `${base.replace(/\.md$/i, '') || 'document'}.html`;
}

export function resolveProjectMarkdownImagePath(markdownPath: string, source: string): string | null {
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return null;
  const parts = [
    ...markdownPath.replaceAll('\\', '/').split('/').slice(0, -1),
    ...source.split(/[?#]/, 1)[0].split('/'),
  ];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/') || null;
}
```

Extend both `readProjectFile` and `readExternalFile` return types with `mimeType?: string` and `encoding?: string`, returning `result.mimeType` and `result.encoding` without changing Registry requests, methods, or protocol version.

- [ ] **Step 5: Implement a safe settled-DOM export surface**

Use `useMarkdownCapabilityPlugins`, `markdownPreRenderer`, and `markdownCodeRenderer` so Markdown, Mermaid, math, and Shiki settle exactly like current preview rendering. Apply raw HTML and sanitization only in the export surface:

```tsx
const rehypePlugins = [
  rehypeRaw,
  ...markdownCapabilities.rehypePlugins,
  [rehypeSanitize, markdownHtmlExportSchema],
];

<ReactMarkdown
  remarkPlugins={markdownCapabilities.remarkPlugins}
  rehypePlugins={rehypePlugins}
  components={{
    pre: markdownPreRenderer,
    code: exportCodeRenderer,
    img: props => <ExportImage {...props} resolveImage={request.resolveImage} />,
  }}
>
  {request.markdown}
</ReactMarkdown>
```

`markdownHtmlExportSchema` must preserve safe structural tags, GFM task-list attributes, table markup, code classes, KaTeX classes, and safe link/image attributes. It must remove scripts, styles, event attributes, executable embeds, `javascript:` URLs, and `vbscript:` URLs. `ExportImage` marks pending resolution with `data-markdown-export-pending="true"`, inlines resolved image bytes as a data URL, retains a failed remote URL, and records each failed source once.

After `waitForMarkdownExportReady(surface)`, clone the export document, remove pending attributes, and emit:

```tsx
const html = buildStandaloneMarkdownHtmlDocument({
  title: request.title,
  bodyHtml: exportNode.innerHTML,
});
onComplete({
  blob: new Blob([html], {type: 'text/html;charset=utf-8'}),
  unresolvedImageUrls: [...unresolvedImageUrls],
});
```

The document builder includes a CSS string for portable typography, tables, blockquotes, images, links, code blocks, Shiki fallback variables, and `@media (prefers-color-scheme: dark)`. It must not emit external scripts or stylesheets.

- [ ] **Step 6: Verify the renderer seam**

Run: `npm test -- --runInBand web-markdown-html-export.test.tsx web-external-file-service.test.ts && npm run tsc:web`

Expected: PASS.

- [ ] **Step 7: Commit the renderer seam**

```powershell
git add app/package.json app/package-lock.json app/web/src/chat/export/markdownHtmlExport.ts app/web/src/registry/RegistryWorkspaceService.ts app/__tests__/web-markdown-html-export.test.tsx app/__tests__/web-external-file-service.test.ts
git commit -m "feat(app): render standalone markdown HTML"
```

### Task 3: Add the Web output adapter and RPC contracts

**Files:**

- Create: `app/web/src/chat/export/markdownHtmlOutput.ts`
- Create: `app/__tests__/web-markdown-html-output.test.ts`
- Modify: `app/web/src/platform/desktop/desktopRuntime.ts`
- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Modify: `app/__tests__/web-android-native-message-bridge.test.ts`
- Modify: `app/__tests__/web-android-native-action-contract.test.ts`

- [ ] **Step 1: Write failing browser, Desktop, and Android routing tests**

```ts
import {outputMarkdownHtml, reserveMarkdownHtmlShare} from '../web/src/chat/export/markdownHtmlOutput';

test('downloads HTML outside native shells', async () => {
  const download = jest.fn();
  const blob = new Blob(['<h1>Hi</h1>'], {type: 'text/html'});
  await expect(outputMarkdownHtml({blob, fileName: 'README.html', download, env: {} as Window}))
    .resolves.toEqual({ok: true, status: 'downloaded'});
  expect(download).toHaveBeenCalledWith(blob, 'README.html');
});

test('streams a file to the Desktop clipboard bridge', async () => {
  const bridge = {
    enabled: true as const,
    beginHtmlFileClipboard: jest.fn(() => 'transfer-1'),
    appendHtmlFileClipboard: jest.fn(),
    commitHtmlFileClipboard: jest.fn(),
  };
  await expect(outputMarkdownHtml({
    blob: new Blob(['<h1>Hi</h1>'], {type: 'text/html'}),
    fileName: 'README.html',
    env: {WheelMakerDesktop: bridge} as unknown as Window,
  })).resolves.toEqual({ok: true, status: 'copied-file'});
  expect(bridge.beginHtmlFileClipboard).toHaveBeenCalledWith('README.html', 11);
  expect(bridge.commitHtmlFileClipboard).toHaveBeenCalledWith('transfer-1');
});
```

Add Android expectations for `userAction.reserve {action: 'html.share'}`, `html.share.begin`, ordered `html.share.chunk`, `html.share.commit`, and `html.share.cancel` after a partial-transfer failure.

- [ ] **Step 2: Run the adapter tests to confirm failure**

Run: `npm test -- --runInBand web-markdown-html-output.test.ts web-android-native-message-bridge.test.ts`

Expected: FAIL because the HTML output module and bridge methods are absent.

- [ ] **Step 3: Declare exact bridge methods**

```ts
export type DesktopWindowBridge = {
  enabled: true;
  beginHtmlFileClipboard?: (fileName: string, size: number) => Promise<string> | string;
  appendHtmlFileClipboard?: (transferId: string, index: number, data: string) => Promise<void> | void;
  commitHtmlFileClipboard?: (transferId: string) => Promise<void> | void;
  cancelHtmlFileClipboard?: (transferId: string) => Promise<void> | void;
};

export type AndroidNativeRpcFacade = {
  reserveUserAction(action: 'image.share' | 'html.share' | 'speech.start'): Promise<string>;
  beginHtmlShare(fileName: string, size: number, userActionToken: string): Promise<string>;
  appendHtmlShare(transferId: string, index: number, data: string): Promise<string>;
  commitHtmlShare(transferId: string): Promise<string>;
  cancelHtmlShare(transferId: string): Promise<string>;
};
```

Map Android methods to `html.share.begin`, `html.share.chunk`, `html.share.commit`, and `html.share.cancel`. Existing image RPC names remain unchanged.

- [ ] **Step 4: Implement bounded platform delivery**

```ts
const HTML_EXPORT_CHUNK_BYTES = 128 * 1024;

export async function reserveMarkdownHtmlShare(env = window as MarkdownHtmlOutputEnv) {
  if (!env.WheelMakerAndroidNative) return undefined;
  const native = getAndroidNativeRpcFacade(env);
  if (!native) throw new Error('Update the Android app to share HTML files.');
  return native.reserveUserAction('html.share');
}

export async function outputMarkdownHtml({blob, fileName, userActionToken, env = window, download = downloadBlobAsFile}: MarkdownHtmlOutputOptions) {
  if (env.WheelMakerAndroidNative) return shareHtmlOnAndroid(blob, fileName, userActionToken, env);
  if (env.WheelMakerDesktop) return copyHtmlFileOnDesktop(blob, fileName, env);
  download(blob, fileName);
  return {ok: true, status: 'downloaded'} as const;
}
```

Both native paths encode sequential `Uint8Array` chunks with the existing safe base64 routine. A native failure cancels the active transfer and returns an error; it never falls back to copying source text into the clipboard.

- [ ] **Step 5: Verify and commit the adapter**

Run: `npm test -- --runInBand web-markdown-html-output.test.ts web-android-native-message-bridge.test.ts web-android-native-action-contract.test.ts && npm run tsc:web`

Expected: PASS.

```powershell
git add app/web/src/chat/export/markdownHtmlOutput.ts app/web/src/platform/desktop/desktopRuntime.ts app/web/src/platform/android/androidNativeMessageBridge.ts app/__tests__/web-markdown-html-output.test.ts app/__tests__/web-android-native-message-bridge.test.ts app/__tests__/web-android-native-action-contract.test.ts
git commit -m "feat(app): route markdown HTML to native outputs"
```

### Task 4: Implement the trusted Windows file clipboard bridge

**Files:**

- Create: `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go`
- Create: `server/cmd/wheelmaker-desktop/desktop_html_clipboard_windows_test.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows_test.go`

- [ ] **Step 1: Write failing exporter tests using a mocked clipboard publisher**

```go
func TestDesktopHTMLClipboardCommitWritesNamedFileAndPublishesOnlyThatFile(t *testing.T) {
	published := []string(nil)
	exporter := newDesktopHTMLClipboardExporter(desktopHTMLClipboardEnvironment{
		root: t.TempDir(),
		publishFiles: func(paths []string) error {
			published = append([]string(nil), paths...)
			return nil
		},
	})
	transferID, err := exporter.Begin("README.html", int64(len("<h1>Hi</h1>")))
	if err != nil { t.Fatal(err) }
	if err := exporter.Append(transferID, 0, base64.StdEncoding.EncodeToString([]byte("<h1>Hi</h1>"))); err != nil { t.Fatal(err) }
	if err := exporter.Commit(transferID); err != nil { t.Fatal(err) }
	if len(published) != 1 || filepath.Base(published[0]) != "README.html" { t.Fatalf("published=%v", published) }
	body, err := os.ReadFile(published[0])
	if err != nil || string(body) != "<h1>Hi</h1>" { t.Fatalf("body=%q err=%v", body, err) }
}
```

Cover unsafe names, non-HTML suffixes, oversized/out-of-order chunks, wrong final size, cancellation, and preserving the prior published directory when a new publish fails.

- [ ] **Step 2: Run the Windows package tests to confirm failure**

Run: `go test ./cmd/wheelmaker-desktop`

Expected: FAIL because `desktopHTMLClipboardExporter` does not exist.

- [ ] **Step 3: Implement controlled temp-file creation and `CF_HDROP` publication**

```go
type desktopHTMLClipboardExporter struct {
	mu        sync.Mutex
	env       desktopHTMLClipboardEnvironment
	active    *desktopHTMLClipboardTransfer
	published string
}

func (e *desktopHTMLClipboardExporter) Begin(fileName string, size int64) (string, error) {
	safeName, err := validateDesktopHTMLFileName(fileName)
	if err != nil || size < 1 || size > maxDesktopHTMLClipboardBytes {
		return "", errors.New("invalid HTML clipboard export")
	}
	e.cancelLocked()
	dir, err := os.MkdirTemp(e.env.root, "wheelmaker-html-")
	if err != nil { return "", err }
	file, err := os.OpenFile(filepath.Join(dir, safeName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil { os.RemoveAll(dir); return "", err }
	e.active = &desktopHTMLClipboardTransfer{id: newDesktopTransferID(), dir: dir, file: file, expected: size}
	return e.active.id, nil
}
```

`Append` base64-decodes one bounded ordered chunk and rejects writes beyond the declared size. `Commit` closes the file, requires exact size, calls `publishFiles([]string{path})`, keeps the new directory only after publish succeeds, then removes the former directory. `Cancel` and every failed transfer remove partial output.

Implement `publishFiles` with `OpenClipboard`, `EmptyClipboard`, `GlobalAlloc(GMEM_MOVEABLE)`, `GlobalLock`, a UTF-16 `DROPFILES` buffer containing the absolute path plus two NUL characters, `SetClipboardData(CF_HDROP, handle)`, `GlobalUnlock`, and `CloseClipboard`. Once `SetClipboardData` succeeds, Windows owns the allocation.

- [ ] **Step 4: Authorize and expose only the trusted remote bridge**

Add one `desktopBridgeHTMLClipboard` action plus these binding constants:

```go
desktopBeginHTMLClipboardBinding  = "__wheelMakerDesktopBeginHTMLClipboard"
desktopAppendHTMLClipboardBinding = "__wheelMakerDesktopAppendHTMLClipboard"
desktopCommitHTMLClipboardBinding = "__wheelMakerDesktopCommitHTMLClipboard"
desktopCancelHTMLClipboardBinding = "__wheelMakerDesktopCancelHTMLClipboard"
```

Create one exporter in `bindDesktopWindowBridge`; every closure must first call `authorize(desktopBridgeHTMLClipboard)`. Expose `beginHtmlFileClipboard`, `appendHtmlFileClipboard`, `commitHtmlFileClipboard`, and `cancelHtmlFileClipboard` only in the trusted HTTPS `WheelMakerDesktop` object. Policy tests must prove bootstrap, stale origin, iframe, and Local Dev pages cannot use it.

- [ ] **Step 5: Format, verify, and commit Desktop work**

Run: `gofmt -w cmd/wheelmaker-desktop/desktop_html_clipboard_windows.go cmd/wheelmaker-desktop/desktop_html_clipboard_windows_test.go cmd/wheelmaker-desktop/desktop_bridge.go cmd/wheelmaker-desktop/webview_windows.go cmd/wheelmaker-desktop/webview_policy.go cmd/wheelmaker-desktop/webview_policy_test.go cmd/wheelmaker-desktop/webview_windows_test.go && go test ./cmd/wheelmaker-desktop`

Expected: PASS.

```powershell
git add server/cmd/wheelmaker-desktop
git commit -m "feat(desktop): copy HTML exports as files"
```

### Task 5: Implement Android HTML file sharing

**Files:**

- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidHtmlShareRuntime.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidHtmlShareTransferStore.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidHtmlShareRuntimeTest.kt`
- Create: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidHtmlShareTransferStoreTest.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedNativeUserAction.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/TrustedWebMessagePolicy.kt`
- Modify: `mobile/android/app/src/main/res/xml/apk_update_paths.xml`

- [ ] **Step 1: Write failing Kotlin transfer and runtime tests**

```kotlin
@Test
fun htmlTransferRetainsProvidedHtmlFilenameAfterExactCommit() {
    val store = AndroidHtmlShareTransferStore(temporaryFolder.newFolder("html-shares"), now = { 1_000L })
    val transferId = requireNotNull(store.begin("README.html", 11))
    assertTrue(store.append(transferId, 0, "<h1>Hi</h1>".toByteArray()))
    val file = requireNotNull(store.commit(transferId))
    assertEquals("README.html", file.name)
    assertEquals("<h1>Hi</h1>", file.readText())
}
```

Add cases for unsafe names, wrong extensions, invalid chunk order, incorrect byte count, and expiry. Runtime assertions must cover `Intent.ACTION_SEND`, `text/html`, `EXTRA_STREAM`, `ClipData.newUri`, `FileProvider.getUriForFile`, and `FLAG_GRANT_READ_URI_PERMISSION`.

- [ ] **Step 2: Run Android tests to confirm failure**

Run: `./gradlew.bat :app:testDebugUnitTest --tests com.wheelmaker.android.AndroidHtmlShareTransferStoreTest --tests com.wheelmaker.android.AndroidHtmlShareRuntimeTest`

Expected: FAIL because the HTML store and runtime do not exist.

- [ ] **Step 3: Implement bounded, named temporary files**

```kotlin
class AndroidHtmlShareTransferStore(
    private val rootDirectory: File,
    private val maxTotalBytes: Int = 16 * 1024 * 1024,
    private val maxChunkBytes: Int = 128 * 1024,
    private val ttlMillis: Long = 60_000L,
    private val now: () -> Long = { SystemClock.elapsedRealtime() }
) {
    fun begin(fileName: String, expectedBytes: Int): String?
    fun append(transferId: String, index: Int, bytes: ByteArray): Boolean
    fun commit(transferId: String): File?
    fun cancel(transferId: String): Boolean
    fun clear()
}
```

Use the same one-active-transfer, sequential index, byte-limit, timeout, and cleanup behavior as `AndroidImageShareTransferStore`; validate a base name ending only in `.html` and create it beneath a UUID directory in `cacheDir/html-shares`. `AndroidHtmlShareRuntime` base64-decodes chunks, creates a `text/html` share chooser titled `Share HTML export`, and returns the existing `{ok, status, error}` JSON shape.

- [ ] **Step 4: Wire trusted actions and lifecycle cleanup**

```kotlin
val SUPPORTED_ACTIONS = setOf("image.share", "html.share", "speech.start")

"html.share.begin" -> beginHtmlShare(payload)
"html.share.chunk" -> androidHtmlShareRuntime.append(payload.toString())
"html.share.commit" -> androidHtmlShareRuntime.commit(payload.toString())
"html.share.cancel" -> androidHtmlShareRuntime.cancel(payload.toString())
```

`beginHtmlShare` consumes only a `html.share` grant and removes `userActionToken` before runtime input. Instantiate and clear the runtime with the image runtime in `MainActivity`; list the four actions in `BUSINESS_ACTIONS`; add `<cache-path name="html_shares" path="html-shares/" />` to the existing provider configuration.

- [ ] **Step 5: Verify and commit Android work**

Run: `./gradlew.bat :app:testDebugUnitTest && npm test -- --runInBand web-android-native-action-contract.test.ts`

Expected: PASS.

```powershell
git add mobile/android app/__tests__/web-android-native-action-contract.test.ts
git commit -m "feat(android): share markdown HTML files"
```

### Task 6: Add conditional file-link and prompt-done actions

**Files:**

- Modify: `app/web/src/chat/ChatFileLinkContextMenu.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/__tests__/web-chat-file-link-context-menu.test.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing UI tests**

```tsx
test('shows HTML export only for a project Markdown link', () => {
  const onAction = jest.fn();
  const renderer = TestRenderer.create(
    <ChatFileLinkContextMenu {...internalProps} canExportHtml onAction={onAction} />,
  );
  expect(labels(renderer)).toContain('Export as HTML');
  renderer.root.findAll(node => node.props.role === 'menuitem')
    .find(button => button.findAllByType('span')[1].props.children === 'Export as HTML')
    ?.props.onClick();
  expect(onAction).toHaveBeenCalledWith('export-html');
});
```

Add `web-chat-ui.test.ts` expectations for `onExportPromptDoneHtml`, `exportHtmlBusy`, title `Export response HTML`, and the disabled/busy action beside the existing screenshot button.

- [ ] **Step 2: Run the UI tests to confirm failure**

Run: `npm test -- --runInBand web-chat-file-link-context-menu.test.tsx web-chat-ui.test.ts`

Expected: FAIL because neither component exposes the HTML action.

- [ ] **Step 3: Implement the action props without changing existing controls**

```tsx
export type ChatFileLinkMenuAction =
  | 'vscode'
  | 'folder'
  | 'copy-relative'
  | 'copy-absolute'
  | 'export-html';

export type ChatFileLinkContextMenuProps = {
  canExportHtml: boolean;
  // existing members remain unchanged
};
```

Render `item('export-html', 'codicon-export', 'Export as HTML')` only when `canExportHtml` is true. Add `exportHtmlBusy?: boolean` and `onExportPromptDoneHtml?: () => void` to `ChatTurnViewProps`, then add this button beside the camera:

```tsx
<button
  type="button"
  className="chat-prompt-action-button"
  onClick={() => onExportPromptDoneHtml?.()}
  disabled={copyDisabled || exportHtmlBusy}
  aria-busy={exportHtmlBusy}
  title="Export response HTML"
  aria-label="Export response markdown as HTML"
>
  <span className="codicon codicon-file-code" />
</button>
```

- [ ] **Step 4: Verify and commit the action components**

Run: `npm test -- --runInBand web-chat-file-link-context-menu.test.tsx web-chat-ui.test.ts`

Expected: PASS.

```powershell
git add app/web/src/chat/ChatFileLinkContextMenu.tsx app/web/src/chat/ChatTurnView.tsx app/__tests__/web-chat-file-link-context-menu.test.tsx app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): add markdown HTML export controls"
```

### Task 7: Connect preview, file-link, and prompt-done flows

**Files:**

- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/code.css`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing integration assertions**

```ts
expect(mainTsx).toContain("action === 'export-html'");
expect(mainTsx).toContain('<MarkdownHtmlExportSurface');
expect(mainTsx).toContain('exportPromptDoneMarkdownHtmlEvent(doneTurnIndex)');
expect(mainTsx).toContain("setToastMessage('HTML file copied to clipboard.')");
expect(mainTsx).toContain("setToastMessage('HTML file shared.')");
expect(mainTsx).toContain("setToastMessage('HTML file downloaded.')");
expect(mainTsx).toContain('canExportHtml={chatFileLinkMenu.link.relativePath !== null && isMarkdownPath(chatFileLinkMenu.link.path)}');
```

Assert `.markdown-html-export-host` is off-screen, pointer-inert, and has a fixed render width with no viewport-dependent maximum.

- [ ] **Step 2: Run integration tests to confirm failure**

Run: `npm test -- --runInBand web-chat-file-peek-viewer.test.ts web-chat-ui.test.ts`

Expected: FAIL because WorkspaceApp has no export request state or HTML surface.

- [ ] **Step 3: Implement one request state machine and the project-image resolver**

```tsx
type MarkdownHtmlExportRequest = {
  id: number;
  markdown: string;
  title: string;
  fileName: string;
  projectId: string;
  sourcePath: string;
  userActionToken?: string;
};

const [markdownHtmlExportRequest, setMarkdownHtmlExportRequest] = useState<MarkdownHtmlExportRequest | null>(null);
const [exportingMarkdownHtmlKey, setExportingMarkdownHtmlKey] = useState('');
const markdownHtmlExportIdRef = useRef(0);
```

`startMarkdownHtmlExport` rejects concurrent starts, reserves `html.share` before async work, increments the request id, and supplies a memoized resolver. A project-relative source uses `resolveProjectMarkdownImagePath` then `service.readProjectFile`; it accepts only a base64 response whose MIME starts with `image/` and returns `data:<mime>;base64,<content>`. Remote sources use CORS `fetch`, require an image MIME type, and report a warning result when retrieval or conversion fails. Warning results retain the original remote URL; project-relative read failure stops export because the required local image could not be embedded.

- [ ] **Step 4: Connect every approved entry point**

In `renderPreviewWorkbenchActions`, show `Export as HTML` only for a loaded, error-free `file` tab satisfying `isMarkdownPath(tab.path)`; use its existing `content`, project id, source path, and `buildMarkdownHtmlFileName(tab.path)`.

In `handleChatFileLinkMenuAction`, handle `export-html` before Desktop actions. Require `relativePath`, read only `service.readProjectFile(relativePath, projectId)`, reject binary Markdown, then start the same export. Never use `readExternalFile` for this action.

For `prompt_done`, reuse the existing range exactly:

```tsx
const range = buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex);
if (!range.ok) return;
await startMarkdownHtmlExport({
  markdown: range.markdown,
  title: `WheelMaker response ${doneTurnIndex}`,
  fileName: buildPromptMarkdownHtmlFileName(doneTurnIndex),
  projectId: selectedChatKey?.projectId || projectId,
  sourcePath: '',
  key: `prompt:${selectedChatEncodedKey}:${doneTurnIndex}`,
});
```

Pass `exportHtmlBusy={exportingMarkdownHtmlKey !== ''}` and `onExportPromptDoneHtml` only to active `prompt_done` views.

- [ ] **Step 5: Mount the hidden surface and give accurate feedback**

```tsx
<MarkdownHtmlExportSurface
  key={markdownHtmlExportRequest.id}
  request={markdownHtmlExportRequest}
  onComplete={async ({blob, unresolvedImageUrls}) => {
    const result = await outputMarkdownHtml({
      blob,
      fileName: markdownHtmlExportRequest.fileName,
      userActionToken: markdownHtmlExportRequest.userActionToken,
    });
    if (!result.ok) throw new Error(result.error || result.status);
    const delivery = result.status === 'copied-file'
      ? 'HTML file copied to clipboard.'
      : result.status === 'shared'
        ? 'HTML file shared.'
        : 'HTML file downloaded.';
    setToastMessage(unresolvedImageUrls.length
      ? `${delivery} ${unresolvedImageUrls.length} image link(s) remain remote.`
      : delivery);
    setMarkdownHtmlExportRequest(null);
    setExportingMarkdownHtmlKey('');
  }}
  onError={message => {
    setMarkdownHtmlExportRequest(null);
    setExportingMarkdownHtmlKey('');
    setError(`Failed to export HTML: ${message}`);
  }}
/>
```

Add `.markdown-html-export-host` and `.markdown-html-export-surface` next to the existing image-export rules in `code.css`. The host sits off-screen with `pointer-events: none`; the surface has a stable desktop width so Shiki and Mermaid can settle without changing visible layout. Use existing prompt-action busy styles in `chat.css`.

- [ ] **Step 6: Verify and commit integration**

Run: `npm test -- --runInBand web-markdown-html-export.test.tsx web-markdown-html-output.test.ts web-chat-file-link-context-menu.test.tsx web-chat-file-peek-viewer.test.ts web-chat-ui.test.ts && npm run tsc:web`

Expected: PASS.

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/styles/code.css app/web/src/styles/chat.css app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat(app): export markdown as HTML"
```

### Task 8: Run final verification and push the feature branch

**Files:**

- Verify every file changed in Tasks 1-7.

- [ ] **Step 1: Review the final diff and protocol boundary**

Run: `git diff origin/main...HEAD --check && git diff origin/main...HEAD -- docs/wiki/protocols/registry.md server/internal/protocol`

Expected: whitespace check passes and the protocol diff is empty.

- [ ] **Step 2: Run Web, Desktop, and Android verification**

Run: `npm test -- --runInBand && npm run tsc:web && npm run build:web`

Expected: PASS.

Run: `go test ./cmd/wheelmaker-desktop`

Expected: PASS.

Run: `./gradlew.bat :app:testDebugUnitTest`

Expected: PASS.

- [ ] **Step 3: Rebase and push**

```powershell
git fetch origin
git rebase origin/main
git push --set-upstream origin feat/markdown-html-export
```

Expected: the verified `feat/markdown-html-export` branch is available on `origin`. Stop for user direction only if a rebase conflict changes approved behavior.
