# Chat File Mention Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview controls to the chat `@` file mention popup without changing mention insertion behavior.

**Architecture:** Keep the feature inside the existing Web UI composer flow. `WorkspaceApp.tsx` owns popup state, keyboard handling, and the existing `openChatFilePeek` hook; `file.css` owns popup layout and responsive visibility. Tests are source-level regression checks matching the existing Web UI test style.

**Tech Stack:** React 19, TypeScript, Jest, CSS, existing Codicon icon font.

---

## File Structure

- Modify `app/__tests__/web-chat-ui.test.ts`
  - Add assertions that protect the mention popup tip, preview button, shortcut branch, and unchanged insert action.
- Modify `app/__tests__/web-chat-file-peek-viewer.test.ts`
  - Add assertions that mention preview reuses `openChatFilePeek(result.path, null)` and does not close or insert.
- Modify `app/web/src/app/WorkspaceApp.tsx`
  - Add `openChatFileMentionPreview`.
  - Wire `Ctrl+O` / `Cmd+O` into the existing file mention menu keyboard branch.
  - Render a desktop shortcut tip and a trailing preview icon for each result.
- Modify `app/web/src/styles/file.css`
  - Add tip styling.
  - Add row/action styling that avoids nested buttons and preserves truncation.
  - Hide the tip on mobile.

### Task 1: Add Failing Regression Tests

**Files:**
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`

- [ ] **Step 1: Add UI structure and shortcut assertions**

Add this test near the existing file mention popup tests in `app/__tests__/web-chat-ui.test.ts`:

```ts
  test('chat composer file mention popup exposes preview actions and shortcut help', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('Ctrl+O To open selected file');
    expect(mainTsx).toContain('className="chat-file-mention-shortcut-tip"');
    expect(mainTsx).toContain('className="chat-file-mention-option-row"');
    expect(mainTsx).toContain('className="chat-file-mention-option-main"');
    expect(mainTsx).toContain('className="chat-file-mention-preview-button"');
    expect(mainTsx).toContain('aria-label={`Open ${name} preview`}');
    expect(mainTsx).toContain('onClick={() => openChatFileMentionPreview(result)}');
    expect(mainTsx).toContain('onClick={() => applyChatFileMentionResult(result)}');
    expect(mainTsx).toContain("event.key.toLowerCase() === 'o'");
    expect(mainTsx).toContain('(event.ctrlKey || event.metaKey)');

    expect(stylesCss).toContain('.chat-file-mention-shortcut-tip');
    expect(stylesCss).toContain('.chat-file-mention-option-row');
    expect(stylesCss).toContain('.chat-file-mention-preview-button');
    expect(stylesCss).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.chat-file-mention-shortcut-tip \{[\s\S]*?display: none;/);
  });
```

- [ ] **Step 2: Add peek reuse assertions**

Add this test near the existing chat file peek tests in `app/__tests__/web-chat-file-peek-viewer.test.ts`:

```ts
  test('file mention preview reuses chat peek without inserting or closing the menu', () => {
    const mainTsx = readSourceText(mainPath);
    const previewStart = mainTsx.indexOf('const openChatFileMentionPreview = useCallback(');
    expect(previewStart).toBeGreaterThanOrEqual(0);
    const previewEnd = mainTsx.indexOf('const appendChatAttachments = useCallback', previewStart);
    expect(previewEnd).toBeGreaterThan(previewStart);
    const previewBody = mainTsx.slice(previewStart, previewEnd);

    expect(previewBody).toContain('openChatFilePeek(path, null)');
    expect(previewBody).not.toContain('applyChatFileMentionResult');
    expect(previewBody).not.toContain('setChatFileMentionMenuOpen(false)');
    expect(previewBody).toContain('chatRichComposerRef.current?.focus();');
  });
```

- [ ] **Step 3: Run tests and verify they fail for the missing feature**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: FAIL because `Ctrl+O To open selected file`, `openChatFileMentionPreview`, and preview button classes are not present yet.

### Task 2: Implement File Mention Preview

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/file.css`

- [ ] **Step 1: Add the preview helper**

Add a `useCallback` after `applyChatFileMentionResult`:

```tsx
  const openChatFileMentionPreview = useCallback(
    (result: RegistryFileIndexSearchResult) => {
      const path = result.path.trim();
      if (!path) {
        return;
      }
      openChatFilePeek(path, null);
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
    },
    [openChatFilePeek],
  );
```

- [ ] **Step 2: Add shortcut handling**

Inside the existing `if (chatFileMentionMenuOpen)` keyboard branch in the composer `onKeyDown`, before the `Enter` / `Tab` branch, add:

```tsx
                        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
                          event.preventDefault();
                          const activeResult = chatFileMentionResults[chatFileMentionActiveIndex];
                          if (activeResult) {
                            openChatFileMentionPreview(activeResult);
                          }
                          return;
                        }
```

- [ ] **Step 3: Render the shortcut tip and split result row actions**

In the `chatFileMentionMenuOpen` popup JSX:

```tsx
                <div ref={chatFileMentionMenuRef} className="chat-file-mention-menu" role="listbox" aria-label="File mentions">
                  <div className="chat-file-mention-shortcut-tip">Ctrl+O To open selected file</div>
```

Replace each result button with sibling row buttons:

```tsx
                        <div
                          key={result.path}
                          className={`chat-file-mention-option-row${selected ? ' active' : ''}`}
                          role="option"
                          aria-selected={index === chatFileMentionActiveIndex}
                          title={result.path}
                          onMouseEnter={() => setChatFileMentionActiveIndex(index)}
                        >
                          <button
                            type="button"
                            className="chat-file-mention-option-main"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => applyChatFileMentionResult(result)}
                          >
                            <span className="codicon codicon-file-code" aria-hidden="true" />
                            <span className="chat-file-mention-name">{name}</span>
                            <span className="chat-file-mention-path">{result.path}</span>
                          </button>
                          <button
                            type="button"
                            className="chat-file-mention-preview-button"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => openChatFileMentionPreview(result)}
                            title={`Open ${name} preview`}
                            aria-label={`Open ${name} preview`}
                          >
                            <span className="codicon codicon-open-preview" aria-hidden="true" />
                          </button>
                        </div>
```

- [ ] **Step 4: Update CSS**

In `app/web/src/styles/file.css`, add styles for `.chat-file-mention-shortcut-tip`, `.chat-file-mention-option-row`, `.chat-file-mention-option-main`, and `.chat-file-mention-preview-button`; keep existing truncation classes. Hide `.chat-file-mention-shortcut-tip` in the existing mobile media block.

- [ ] **Step 5: Run targeted tests and verify green**

Run:

```powershell
cd app
npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts --runInBand
```

Expected: PASS.

### Task 3: Verify Type Safety And Commit

**Files:**
- Modify: all touched files

- [ ] **Step 1: Run TypeScript check**

Run:

```powershell
cd app
npm run tsc:web
```

Expected: PASS with exit code 0.

- [ ] **Step 2: Review diff**

Run:

```powershell
git diff -- app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-file-peek-viewer.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css
```

Expected: Diff contains only the file mention preview feature and tests.

- [ ] **Step 3: Commit**

Run:

```powershell
git add app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-file-peek-viewer.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/file.css docs/superpowers/plans/2026-06-11-chat-file-mention-preview-implementation.md
git commit -m "feat: preview chat file mentions"
```

Expected: Commit succeeds on `feat/chat-file-mention-preview`.

## Self-Review

- Spec coverage: each accepted behavior maps to Task 2 and Task 1 assertions.
- Placeholder scan: the plan contains no deferred implementation placeholders.
- Type consistency: helper and result types match existing `RegistryFileIndexSearchResult` usage in `WorkspaceApp.tsx`.
