# Regular File Desktop Actions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the existing VS Code and File Explorer desktop actions to loaded ordinary source-file preview tabs using server-confirmed canonical paths while preserving all current menu actions.

**Architecture:** Derive a single project-file action path inside `renderPreviewWorkbenchActions`: loaded ordinary file tabs use the server-returned canonical `tab.info.path` after `safeJoin` confirmation, Prompt Diff tabs keep using the resolved active file path, and other tab types have no path. An ordinary file without `info` has no desktop-action path. Rename the Prompt Diff-specific availability flags and runner to generic project-file names, then reuse the existing desktop bridge and toast error handling.

**Tech Stack:** React, TypeScript, Jest, webpack, WheelMaker Desktop JavaScript bridge

---

## Chunk 1: Shared project-file actions

### Task 1: Extend preview actions to ordinary file tabs

**Files:**
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts:106-148`
- Modify: `app/web/src/app/WorkspaceApp.tsx:20833-20886`

- [ ] **Step 1: Write the failing regression assertions**

Update the preview action test so it locates the generic runner, requires ordinary file tabs to use canonical `tab.info.path`, and rejects the raw `tab.path`:

```ts
const runnerStart = actionsBody.indexOf('const runProjectFileDesktopAction = (');

expect(actionsBody).toContain("const relativePath = tab.type === 'file'");
expect(actionsBody).toContain("? (tab.info?.path ?? '')");
expect(actionsBody).not.toContain('? tab.path');
expect(actionsBody).toContain(": tab.type === 'prompt-diff'");
expect(actionsBody).toContain('? resolvePromptDiffActiveFilePath(tab.files, tab.activeFilePath)');
expect(actionsBody).toContain(": '';");
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

The `?? ''` assertion verifies that a file tab without server `info`, including loading and error states, has no desktop-action path and therefore hides both actions. Rejecting `? tab.path` verifies that a raw path containing an internal `..` segment is never passed to the desktop bridge. Also require the final path branch to be `: '';`, which explicitly leaves attachment and port-relay tabs without a project-file action path. Keep the existing assertions for bridge invocation, toast errors, and labels.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `app`:

```powershell
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: FAIL because the production code does not yet derive the ordinary-file action path from canonical server `info` and still uses Prompt Diff-specific names.

- [ ] **Step 3: Implement the minimal shared path and action names**

In `renderPreviewWorkbenchActions`, replace the current Prompt Diff-only path derivation with:

```ts
const relativePath = tab.type === 'file'
  ? (tab.info?.path ?? '')
  : tab.type === 'prompt-diff'
    ? resolvePromptDiffActiveFilePath(tab.files, tab.activeFilePath)
    : '';
```

The server returns `info.path` only after resolving the request through `safeJoin`, so the desktop bridge receives the canonical project-relative path rather than the raw preview link. When `info` is unavailable, the empty path keeps both desktop actions hidden.

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
npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts
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
