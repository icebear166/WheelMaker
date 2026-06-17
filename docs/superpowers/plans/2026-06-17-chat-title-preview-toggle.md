# Chat Title Preview Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consistent chat title bar with breadcrumb context on the left and a preview expand/collapse button on the right, including an empty preview state.

**Architecture:** Reuse the existing chat preview rendering path and widen `chatPreviewOpen` from content-derived state to content-or-manual-expanded state. Track manual open for empty previews and manual collapsed for hiding existing previews without clearing their content. Keep all preview content viewers intact, add a small empty preview viewer, and render a shared chat title bar for desktop and mobile.

**Tech Stack:** React, TypeScript, CSS, Jest source-structure tests, existing codicon icon set.

---

## File Structure

- Modify `app/__tests__/web-chat-file-peek-viewer.test.ts`: add source tests for manual preview open, empty preview surface, and unchanged close/back controls.
- Modify `app/__tests__/web-chat-ui.test.ts`: add source/CSS tests for breadcrumb desktop title and right-side preview toggle.
- Modify `app/web/src/app/WorkspaceApp.tsx`: add manual preview state, title-bar toggle, shared chat title markup, and empty preview viewer.
- Modify `app/web/src/styles/chat.css`: style the title bar action area and empty preview body.

## Task 1: Preview State and Empty Surface

**Files:**
- Test: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Write the failing test**

Add this test in `app/__tests__/web-chat-file-peek-viewer.test.ts` after `prompt attachments open the existing chat preview side panel`:

```ts
  test('chat preview can open without active content and keeps chrome close controls', () => {
    const mainTsx = readSourceText(mainPath);
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);');
    expect(mainTsx).toContain('const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(false);');
    expect(mainTsx).toContain('const chatPreviewHasContent = !!chatFilePeek || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;');
    expect(mainTsx).toContain('const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);');
    expect(mainTsx).toContain('const ChatEmptyPreviewViewer = React.memo(function ChatEmptyPreviewViewer');
    expect(mainTsx).toContain('<div className="chat-preview-title" title="Preview">Preview</div>');
    expect(mainTsx).toContain('No preview selected');
    expect(mainTsx).toContain(') : <ChatEmptyPreviewViewer mode="desktop" onClose={closeChatFilePeekFromChrome} />');
    expect(mainTsx).toContain(') : <ChatEmptyPreviewViewer mode="mobile" onClose={closeChatFilePeekFromChrome} />');
    expect(mainTsx).toContain('title={mode === \'mobile\' ? \'Back\' : \'Close preview\'}');

    expect(stylesCss).toContain('.chat-empty-preview-body {');
    expect(stylesCss).toContain('.chat-empty-preview-copy {');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app; npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: FAIL because `chatPreviewManualOpen`, `ChatEmptyPreviewViewer`, and `.chat-empty-preview-body` do not exist.

- [ ] **Step 3: Implement minimal preview state and empty surface**

In `WorkspaceApp.tsx`, add:

```tsx
  const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);
  const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(false);
```

near the other chat preview state hooks.

Change the preview-open derivation to:

```tsx
  const chatPreviewHasContent = !!chatFilePeek || !!chatPromptArtifactPreview || !!chatAttachmentPreview || chatPortRelayPreviewOpen;
  const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);
```

Reset manual preview flags when a real file, attachment, diff artifact, or Port Relay chat preview opens:

```tsx
setChatPreviewManualOpen(false);
setChatPreviewManualCollapsed(false);
```

Add a memoized empty viewer near the existing preview viewer components:

```tsx
const ChatEmptyPreviewViewer = React.memo(function ChatEmptyPreviewViewer({
  mode,
  onClose,
}: {
  mode: 'desktop' | 'mobile';
  onClose: () => void;
}) {
  return (
    <div className={`chat-file-peek-surface chat-empty-preview-surface ${mode}`} aria-label="Chat preview">
      <div className="chat-preview-toolbar">
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={onClose}
          title={mode === 'mobile' ? 'Back' : 'Close preview'}
          aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
        >
          <span className={`codicon ${mode === 'mobile' ? 'codicon-arrow-left' : 'codicon-close'}`} />
        </button>
        <div className="chat-preview-title" title="Preview">Preview</div>
      </div>
      <div className="chat-empty-preview-body">
        <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
        <span className="chat-empty-preview-copy">No preview selected</span>
      </div>
    </div>
  );
});
```

Use it as the final fallback in both desktop and mobile preview rendering:

```tsx
      ) : chatPortRelayPreviewOpen ? renderChatPortRelayPreviewSurface('desktop') : <ChatEmptyPreviewViewer mode="desktop" onClose={closeChatFilePeekFromChrome} />}
```

and:

```tsx
      ) : chatPortRelayPreviewOpen ? renderChatPortRelayPreviewSurface('mobile') : <ChatEmptyPreviewViewer mode="mobile" onClose={closeChatFilePeekFromChrome} />}
```

In `chat.css`, add:

```css
.chat-empty-preview-surface {
  min-width: 0;
}

.chat-empty-preview-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--muted);
  font-size: 12px;
}

.chat-empty-preview-body .codicon {
  font-size: 16px;
}

.chat-empty-preview-copy {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app; npm test -- web-chat-file-peek-viewer.test.ts --runInBand`

Expected: PASS for `web-chat-file-peek-viewer.test.ts`.

## Task 2: Chat Title Breadcrumb and Preview Toggle

**Files:**
- Test: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`

- [ ] **Step 1: Write the failing test**

Add this test in `app/__tests__/web-chat-ui.test.ts` near other chat header/title tests:

```ts
  test('chat title bar uses breadcrumb context and exposes preview toggle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const chatSurfaceStart = mainTsx.indexOf('if (tab === \'chat\') {');
    const chatSurfaceEnd = mainTsx.indexOf('if (tab === \'file\') {', chatSurfaceStart);
    expect(chatSurfaceStart).toBeGreaterThanOrEqual(0);
    expect(chatSurfaceEnd).toBeGreaterThan(chatSurfaceStart);
    const chatSurface = mainTsx.slice(chatSurfaceStart, chatSurfaceEnd);

    expect(chatSurface).toContain('className="block-title chat-title-bar"');
    expect(chatSurface).toContain('renderBreadcrumbTitle(activeChatBreadcrumbProjectName, activeChatBreadcrumbLabel)');
    expect(chatSurface).not.toContain('CHAT - ${selectedChatDisplayTitle || \'New Session\'}');
    expect(chatSurface).toContain('className="chat-title-actions"');
    expect(chatSurface).toContain('className={`chat-preview-toggle${chatPreviewOpen ? \' active\' : \'\'}`}');
    expect(chatSurface).toContain('title={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(chatSurface).toContain('aria-label={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(chatSurface).toContain('aria-pressed={chatPreviewOpen}');
    expect(chatSurface).toContain('onClick={toggleChatPreviewFromTitle}');
    expect(mainTsx).toContain('setChatPreviewManualOpen(open => !open)');
    expect(mainTsx).toContain('setChatPreviewManualCollapsed(true)');

    expect(stylesCss).toContain('.chat-title-bar {');
    expect(stylesCss).toContain('.chat-title-actions {');
    expect(stylesCss).toContain('.chat-preview-toggle {');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app; npm test -- web-chat-ui.test.ts --runInBand`

Expected: FAIL because `.chat-title-bar`, `.chat-preview-toggle`, and the toggle handler do not exist.

- [ ] **Step 3: Implement the title bar and toggle**

Add this handler before `renderMain`:

```tsx
  const toggleChatPreviewFromTitle = useCallback(() => {
    if (chatPreviewOpen) {
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(true);
      return;
    }
    setChatPreviewManualCollapsed(false);
    setChatPreviewManualOpen(open => !open);
  }, [chatPreviewOpen]);
```

In the chat branch of `renderMain`, replace the current `block-title` content with:

```tsx
          <div className="block-title chat-title-bar">
            <div className="chat-title-context">
              {renderBreadcrumbTitle(activeChatBreadcrumbProjectName, activeChatBreadcrumbLabel)}
            </div>
            <div className="chat-title-actions">
              <button
                type="button"
                className={`chat-preview-toggle${chatPreviewOpen ? ' active' : ''}`}
                onClick={toggleChatPreviewFromTitle}
                title={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                aria-label={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                aria-pressed={chatPreviewOpen}
              >
                <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
              </button>
            </div>
          </div>
```

In `chat.css`, add:

```css
.chat-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chat-title-context {
  min-width: 0;
  flex: 1 1 auto;
}

.chat-title-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.chat-preview-toggle {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 6px;
  padding: 0;
  background: color-mix(in srgb, var(--panel-2) 82%, transparent);
  color: var(--muted);
  cursor: pointer;
}

.chat-preview-toggle:hover,
.chat-preview-toggle.active {
  background: var(--hover);
  color: var(--text);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app; npm test -- web-chat-ui.test.ts --runInBand`

Expected: PASS for `web-chat-ui.test.ts`.

## Task 3: Verification and Commit

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd app; npm test -- web-chat-file-peek-viewer.test.ts web-chat-ui.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
cd app; npm run tsc:web
```

Expected: PASS.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff -- app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-chat-ui.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css docs/superpowers/plans/2026-06-17-chat-title-preview-toggle.md
```

Expected: only the planned tests, UI implementation, styles, and plan are present. Existing unrelated dirty files remain unrelated.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add app/__tests__/web-chat-file-peek-viewer.test.ts app/__tests__/web-chat-ui.test.ts app/web/src/app/WorkspaceApp.tsx app/web/src/styles/chat.css docs/superpowers/plans/2026-06-17-chat-title-preview-toggle.md
git commit -m "feat: add chat preview title toggle"
git push origin main
```

Expected: commit and push succeed. If branch is not `main`, push `HEAD` to the current branch.
