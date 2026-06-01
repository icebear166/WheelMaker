# Chat File Peek Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement chat-context file preview so chat file links open a desktop right-side peek column or mobile full-screen viewer without switching away from chat.

**Architecture:** Keep the full File tab state independent from the new chat peek state. Extend `ResponsiveShell` with optional desktop and mobile peek slots, add peek-specific loading/rendering in `main.tsx`, and reuse existing Shiki/Markdown/HTML/image rendering paths.

**Tech Stack:** React 19, TypeScript, CSS, Jest source-structure tests, existing registry workspace service.

---

## File Structure

- Modify `app/web/src/main.tsx`
  - Add `ChatFilePeekState`, independent load sequence, open/close handlers, direct jump helpers, and viewer rendering.
  - Replace chat markdown file-link click behavior so it opens peek state instead of calling `setTab('file')`.
  - Add `Open in File tab` handoff.
  - Add mobile popstate handling while the peek viewer is open.
- Modify `app/web/src/shell/ResponsiveShell.tsx`
  - Add optional `desktopPeek` and `mobileOverlay` props.
  - Render `desktopPeek` after the main workspace on desktop and `mobileOverlay` above drawer chrome on mobile.
- Modify `app/web/src/styles.css`
  - Add desktop right column, resize handle, mobile overlay, toolbar, preview highlight, and floating-control hiding styles.
- Create `app/__tests__/web-chat-file-peek-viewer.test.ts`
  - Source-structure tests for click behavior, shell slot wiring, CSS contract, mobile overlay behavior, and direct jump behavior.

## Task 1: Add Failing Source-Structure Tests

**Files:**
- Create: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

describe('web chat file peek viewer', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainPath = path.join(projectRoot, 'web', 'src', 'main.tsx');
  const shellPath = path.join(projectRoot, 'web', 'src', 'shell', 'ResponsiveShell.tsx');
  const stylesPath = path.join(projectRoot, 'web', 'src', 'styles.css');

  test('chat file links open the peek viewer without switching to the File tab', () => {
    const mainTsx = readSourceText(mainPath);
    const clickStart = mainTsx.indexOf('openChatFilePeek(targetFile.path, jumpLine ?? null)');
    expect(clickStart).toBeGreaterThanOrEqual(0);
    const clickEnd = mainTsx.indexOf('</a>', clickStart);
    const clickBody = mainTsx.slice(clickStart, clickEnd);

    expect(clickBody).not.toContain("setTab('file')");
    expect(clickBody).not.toContain('setSelectedFile(targetFile.path)');
    expect(mainTsx).toContain('const openChatFilePeek = useCallback(');
    expect(mainTsx).toContain('setChatFilePeek({');
  });

  test('desktop shell renders an optional third code peek column', () => {
    const shellTsx = readSourceText(shellPath);
    const mainTsx = readSourceText(mainPath);

    expect(shellTsx).toContain('desktopPeek: ReactNode;');
    expect(shellTsx).toContain('{desktopPeek}');
    expect(mainTsx).toContain('desktopPeek={chatFilePeekDesktopPane}');
    expect(mainTsx).toContain('mobileOverlay={chatFilePeekMobileOverlay}');
  });

  test('peek viewer CSS defines desktop width limits and mobile full-screen overlay', () => {
    const stylesCss = readSourceText(stylesPath);

    const desktopPane = cssRuleBlock(stylesCss, '.chat-file-peek-pane');
    expect(desktopPane).toContain('width: var(--chat-file-peek-width, 520px);');
    expect(desktopPane).toContain('min-width: 360px;');
    expect(desktopPane).toContain('max-width: min(760px, 55vw);');

    const workspaceRight = cssRuleBlock(stylesCss, '.workspace-right');
    expect(workspaceRight).toContain('min-width: 420px;');

    const mobileOverlay = cssRuleBlock(stylesCss, '.chat-file-peek-mobile-overlay');
    expect(mobileOverlay).toContain('position: fixed;');
    expect(mobileOverlay).toContain('inset: 0;');
    expect(mobileOverlay).toContain('z-index: 70;');

    expect(stylesCss).toContain('.narrow-shell[data-chat-file-peek-open=\\'true\\'] .floating-control-stack-layer');
  });

  test('peek viewer uses direct jumps and has an explicit File tab handoff', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const jumpToFileLineNow = (');
    expect(mainTsx).toContain('container.scrollTop =');
    expect(mainTsx).toContain('const openPeekFileInFullFileTab = useCallback(');
    expect(mainTsx).toContain("setTab('file');");
    expect(mainTsx).toContain('setPendingFileJump({ path: chatFilePeek.path, line: chatFilePeek.targetLine });');

    const jumpStart = mainTsx.indexOf('const jumpToFileLineNow = (');
    const jumpEnd = mainTsx.indexOf('const scrollToFileLine =', jumpStart);
    const jumpBody = mainTsx.slice(jumpStart, jumpEnd);
    expect(jumpBody).not.toContain("behavior: 'smooth'");
  });

  test('peek viewer renders preview modes, load errors, and mobile back state', () => {
    const mainTsx = readSourceText(mainPath);

    expect(mainTsx).toContain('const chatFilePeekIsMarkdown = isMarkdownPath(chatFilePeek.path);');
    expect(mainTsx).toContain('const chatFilePeekIsHtml = isHtmlPath(chatFilePeek.path);');
    expect(mainTsx).toContain('const chatFilePeekIsImage = isImageFile(');
    expect(mainTsx).toContain('Failed to load file');
    expect(mainTsx).toContain('createChatFilePeekHistoryState()');
    expect(mainTsx).toContain('closeChatFilePeek();');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: FAIL because `openChatFilePeek`, shell slots, CSS classes, and direct jump helpers do not exist yet.

## Task 2: Extend ResponsiveShell Slots

**Files:**
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Implement shell props and rendering**

Add `desktopPeek: ReactNode` to `DesktopShellProps`, add `mobileOverlay: ReactNode` to `MobileShellProps`, pass them through `ResponsiveShellProps`, render `desktopPeek` after `<main className="workspace-right">{main}</main>`, and render `mobileOverlay` after `{mobileSettingsScreen}`.

- [ ] **Step 2: Run targeted test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: still FAIL on missing main/CSS behavior, but shell-slot assertions pass.

## Task 3: Add Peek State, Loading, And Chat Link Open Handler

**Files:**
- Modify: `app/web/src/main.tsx`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Add state and loader**

Add a peek state object with `path`, `targetLine`, `content`, `info`, `loading`, and `error`. Add a request sequence ref so stale file reads are ignored. Load with `service.getProjectFileInfo` and `service.readProjectFile`, using the current project id and showing errors inside the viewer state.

- [ ] **Step 2: Replace chat link click behavior**

In the chat markdown `a` renderer, replace `setPendingFileJump`, `setTab('file')`, and `setSelectedFile(targetFile.path)` with `openChatFilePeek(targetFile.path, jumpLine ?? null)`.

- [ ] **Step 3: Run targeted test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: still FAIL on rendering, CSS, and direct jump helper assertions.

## Task 4: Implement Direct Jump And File Tab Handoff

**Files:**
- Modify: `app/web/src/main.tsx`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Add direct jump helper**

Add `jumpToFileLineNow(container, line, options?)`, which finds `[data-line-number="<line>"]`, computes centered `scrollTop`, assigns directly, and estimates from line height when the exact line is unavailable.

- [ ] **Step 2: Keep existing File tab tools compatible**

Change `scrollToFileLine` to call `jumpToFileLineNow` for immediate line jumps or keep smooth behavior only for ordinary search/go-to-line if needed. Chat-link jumps must not use smooth scrolling.

- [ ] **Step 3: Add `Open in File tab`**

Add `openPeekFileInFullFileTab`; it closes peek, sets tab to `file`, sets selected file, and sets `pendingFileJump` when a target line exists.

- [ ] **Step 4: Run targeted test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: still FAIL on viewer render/CSS/mobile overlay assertions.

## Task 5: Render Desktop And Mobile Peek Viewer

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/styles.css`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Render common viewer content**

Create render helpers inside `App` for peek toolbar, loading/error state, image preview, Markdown preview, HTML preview, and Shiki code view. Use existing `MarkdownPreview`, `HtmlPreview`, `buildImageDataUrl`, and `renderCodePane`.

- [ ] **Step 2: Wire shell props**

Pass `desktopPeek={chatFilePeekDesktopPane}` and `mobileOverlay={chatFilePeekMobileOverlay}` to `ResponsiveShell`.

- [ ] **Step 3: Add CSS**

Add `.chat-file-peek-pane`, `.chat-file-peek-resize-handle`, `.chat-file-peek-mobile-overlay`, `.chat-file-peek-toolbar`, `.chat-file-peek-scroll`, `.chat-file-peek-error`, and preview highlight styles. Set `.workspace-right` `min-width: 420px`.

- [ ] **Step 4: Run targeted test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: still FAIL only if mobile history/back or exact source strings are missing.

## Task 6: Add Mobile Back Handling And Width Resize

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/src/shell/ResponsiveShell.tsx`
- Modify: `app/web/src/styles.css`
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Add mobile history state**

Add `createChatFilePeekHistoryState`, push it when mobile peek opens, and close the peek first on `popstate` when that history state is active.

- [ ] **Step 2: Hide mobile floating chrome while open**

Set a `data-chat-file-peek-open` attribute on the narrow shell and CSS-hide `.floating-control-stack-layer`.

- [ ] **Step 3: Add desktop resize**

Add pointer handlers for the left-edge resize handle, clamp width to the confirmed bounds, and store the width in React state for the current session.

- [ ] **Step 4: Run targeted test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: PASS.

## Task 7: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run targeted Jest test**

Run: `npm test -- web-chat-file-peek-viewer.test.ts`

Expected: PASS.

- [ ] **Step 2: Run nearby regression tests**

Run: `npm test -- web-responsive-shell.test.ts web-file-open-race.test.ts web-chat-ui.test.ts`

Expected: PASS.

- [ ] **Step 3: Run TypeScript validation**

Run: `npm run tsc:web`

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run: `git diff --stat` and `git diff --check`

Expected: only planned files changed and no whitespace errors.
