# Regular File Desktop Actions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the existing VS Code and File Explorer desktop actions to loaded ordinary source-file preview tabs using server-confirmed canonical paths while preserving all current menu actions.

**Architecture:** Centralize path derivation in `resolvePreviewDesktopFilePath`: ordinary file tabs return the server-confirmed `tab.info.path` only when `!tab.loading && !tab.error`, Prompt Diff tabs return the resolved active file path, and other tab types return no path. `RegistryRepository.getFileInfo` maps missing or `null` response paths to an empty string instead of the raw request. `renderPreviewWorkbenchActions` reuses the helper with the existing desktop bridge and toast error handling.

**Tech Stack:** React, TypeScript, Jest, webpack, WheelMaker Desktop JavaScript bridge

---

## Chunk 1: Shared project-file actions

### Task 1: Extend preview actions to ordinary file tabs

**Files:**
- Modify: `app/__tests__/web-preview-workbench-state.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-file-not-modified-cache.test.ts`
- Modify: `app/web/src/preview/previewWorkbenchState.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: Write the failing regression assertions**

Add behavioral tests for `resolvePreviewDesktopFilePath` covering a loaded canonical file, a raw `tab.path` containing `src/../` with canonical `info.path`, no `info`, loading with stale `info`, error with stale `info`, an active Prompt Diff file, attachment, and port relay tabs.

Update the preview action source test so it locates the generic runner and requires `WorkspaceApp` to call the shared helper:

```ts
const runnerStart = actionsBody.indexOf('const runProjectFileDesktopAction = (');

expect(mainTsx).toContain('resolvePreviewDesktopFilePath,');
expect(actionsBody).toContain('const relativePath = resolvePreviewDesktopFilePath(tab);');
expect(actionsBody).not.toContain("const relativePath = tab.type === 'file'");
expect(actionsBody).toContain('const canOpenProjectFileInVSCode = Boolean(projectRoot && relativePath && desktopBridge?.openProjectFileInVSCode);');
expect(actionsBody).toContain('const canShowProjectFileInFolder = Boolean(projectRoot && relativePath && desktopBridge?.showProjectFileInFolder);');
expect(actionsBody).toContain('{canOpenProjectFileInVSCode ? (');
expect(actionsBody).toContain('{canShowProjectFileInFolder ? (');
expect(actionsBody).toContain("runProjectFileDesktopAction('vscode', 'Failed to open file in VS Code')");
expect(actionsBody).toContain("runProjectFileDesktopAction('folder', 'Failed to show file in File Explorer')");
expect(actionsBody).toContain('<span>Copy absolute path</span>');
expect(actionsBody).toContain('<span>Open in File tab</span>');

const vscodeLabelIndex = actionsBody.indexOf('<span>Open with VS Code</span>');
const folderLabelIndex = actionsBody.indexOf('<span>Show in File Explorer</span>');
const copyPathLabelIndex = actionsBody.indexOf('<span>Copy absolute path</span>');
const fileTabLabelIndex = actionsBody.indexOf('<span>Open in File tab</span>');
expect(vscodeLabelIndex).toBeLessThan(folderLabelIndex);
expect(folderLabelIndex).toBeLessThan(copyPathLabelIndex);
expect(copyPathLabelIndex).toBeLessThan(fileTabLabelIndex);
```

Add actual `RegistryRepository.getFileInfo` mock request tests requiring a canonical server path to be preserved and missing or `null` response paths to become empty while other metadata remains intact. Keep the existing assertions for bridge invocation, toast errors, labels, and menu ordering.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `app`:

```powershell
npm test -- --runInBand __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-file-not-modified-cache.test.ts
```

Expected: FAIL because the shared helper does not exist and `getFileInfo` still falls back to the raw requested path.

- [ ] **Step 3: Implement the minimal shared path and action names**

Export the shared resolver from `previewWorkbenchState.ts`:

```ts
export function resolvePreviewDesktopFilePath(tab: PreviewWorkbenchTab): string {
  if (tab.type === 'file') {
    return tab.loading || tab.error ? '' : tab.info?.path ?? '';
  }
  if (tab.type === 'prompt-diff') {
    return resolvePromptDiffActiveFilePath(tab.files, tab.activeFilePath);
  }
  return '';
}
```

Use `const relativePath = resolvePreviewDesktopFilePath(tab);` in `renderPreviewWorkbenchActions`. In `RegistryRepository.getFileInfo`, map the path with `typeof payload.path === 'string' ? payload.path : ''`; do not fall back to the raw request. The empty path keeps both desktop actions hidden for unconfirmed, loading, and error states while old servers can still return the rest of the preview metadata.

Rename the shared variables and function without changing bridge behavior:

```ts
const canOpenProjectFileInVSCode = Boolean(projectRoot && relativePath && desktopBridge?.openProjectFileInVSCode);
const canShowProjectFileInFolder = Boolean(projectRoot && relativePath && desktopBridge?.showProjectFileInFolder);
const runProjectFileDesktopAction = (
  action: DesktopProjectFileAction,
  failurePrefix: string,
) => {
  closeActionsMenu();
  setToastMessage('');
  if (!desktopBridge || !projectRoot || !relativePath) {
    return;
  }
  Promise.resolve()
    .then(() => invokeDesktopProjectFileAction(desktopBridge, action, projectRoot, relativePath))
    .catch(err => {
      const reason = err instanceof Error ? err.message : String(err);
      setToastMessage(`${failurePrefix}: ${reason}`);
    });
};
```

Update the two existing conditional menu entries and their click handlers to use the generic names. Leave `Copy absolute path`, `Open in File tab`, attachment behavior, port-relay behavior, and index rebuilding unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run from `app`:

```powershell
npm test -- --runInBand __tests__/web-preview-workbench-state.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-file-not-modified-cache.test.ts
```

Expected: the target suite passes with zero failures.

- [ ] **Step 5: Run full Web verification**

Run the first three commands from `app`, then run the final command from the repository root:

```powershell
npm test -- --runInBand
npm run tsc:web
npm run build:web:release
git diff --check
```

Expected: 187 Jest suites and 940 tests pass or increase only by the new assertions, TypeScript exits 0, webpack compiles successfully, and `git diff --check` produces no errors.

- [ ] **Step 6: Deploy and manually verify the native desktop runtime**

Prerequisites: SSH key access to `root@47.86.63.26`, the WheelMaker Web build exported to `C:\Users\Administrator\.wheelmaker\web`, and the native desktop executable at `C:\Users\Administrator\.wheelmaker\desktop\WheelMakerDesktop.exe`.

From the repository root, package and upload the Web release:

```powershell
$stamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$archive = ".tmp/web-release-regular-file-actions-$stamp.tar.gz"
tar.exe -C 'C:\Users\Administrator\.wheelmaker\web' -czf $archive .
scp $archive "root@47.86.63.26:/root/.wheelmaker/web-release-regular-file-actions-$stamp.tar.gz"
ssh root@47.86.63.26 "mkdir -p /root/.wheelmaker/web-candidate-regular-file-actions-$stamp && tar -xzf /root/.wheelmaker/web-release-regular-file-actions-$stamp.tar.gz -C /root/.wheelmaker/web-candidate-regular-file-actions-$stamp"
ssh root@47.86.63.26 "mv /root/.wheelmaker/web /root/.wheelmaker/web-backup-regular-file-actions-$stamp && mv /root/.wheelmaker/web-candidate-regular-file-actions-$stamp /root/.wheelmaker/web"
```

Expected: all four commands exit 0. Verify HTTPS serves the generated bundle and both action labels:

```powershell
$index = (Invoke-WebRequest -UseBasicParsing 'https://hts.wheelmaker.top:28800/').Content
$bundleName = [regex]::Match($index, 'bundle\.[a-f0-9]+\.js').Value
$bundle = (Invoke-WebRequest -UseBasicParsing "https://hts.wheelmaker.top:28800/$bundleName").Content
if (-not $bundle.Contains('Open with VS Code') -or -not $bundle.Contains('Show in File Explorer')) { throw 'Desktop file action labels missing from deployed bundle' }
```

Restart the native desktop client normally:

```powershell
$process = Get-Process WheelMakerDesktop -ErrorAction SilentlyContinue
if ($process) { $process.CloseMainWindow() | Out-Null; $process.WaitForExit(10000) | Out-Null }
Start-Process -FilePath 'C:\Users\Administrator\.wheelmaker\desktop\WheelMakerDesktop.exe'
```

Manual acceptance checklist:

1. Open an ordinary source-file preview tab.
2. Open its top-right actions menu.
3. Confirm the order is `Open with VS Code`, `Show in File Explorer`, `Copy absolute path`, `Open in File tab`, `Rebuild file index`.
4. Invoke both new actions and confirm VS Code opens the selected file and File Explorer selects that file.
5. Open a Prompt Diff tab and confirm its two desktop file actions remain available.

- [ ] **Step 7: Run the repository completion gate as the exact final tail**

After all implementation, tests, build, deployment, and manual verification are complete, run these commands from the repository root with no further file changes afterward:

```powershell
git add -A
git commit -m "feat: open regular preview files from desktop"
git push origin codex/prompt-diff-desktop-file-actions
```

Expected: commit succeeds and the branch is accepted by `origin`. If push is rejected by GitHub credentials or repository permissions, report that external blocker without claiming repository completion.
