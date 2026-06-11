# Chat File Mention Preview Design

## Context
The chat composer already supports `@` file mentions through the indexed project file search. Selecting a result inserts a file token into the composer. Chat message file links already open a side preview through the chat file peek viewer without switching to the File tab.

The gap is that the `@` result list only supports insertion. Users need a fast way to inspect a candidate file before deciding whether to mention it.

## Confirmed Scope
- Runtime target: `app/web/` only.
- Add a preview action to each file result in the `@` mention popup.
- Add a keyboard shortcut for previewing the active file result.
- Reuse the existing chat file peek viewer behavior used by chat file links.
- Keep the existing file mention insertion behavior unchanged.

## Non-Goals
- No backend file index changes.
- No file read API changes.
- No changes to chat message file links.
- No global shortcut system.
- No redesign of the composer or chat preview pane.

## Interaction Design
When the `@` file mention popup is open and indexed file results are visible:

- Clicking the main file row keeps the current behavior: insert the file token into the composer and close the popup.
- Clicking the new right-side preview icon opens that file in the chat file peek viewer.
- Previewing a file does not insert a token.
- Previewing a file does not close the `@` popup.
- After previewing, focus returns to the chat composer so keyboard navigation can continue.
- `Ctrl+O` and `Cmd+O` preview the currently highlighted file result.
- If the popup is open but there is no active file result, `Ctrl+O` and `Cmd+O` are intercepted and do nothing. This prevents the browser or desktop shell from opening a system file picker.
- Desktop shows a small popup tip above the results: `Ctrl+O To open selected file`.
- Mobile does not show the shortcut tip, but each row still shows the right-side preview icon.
- Mobile preview uses the existing chat preview overlay and returns to the still-open `@` popup when the preview is closed.

## Architecture
### 1) Preview helper
Add a small helper in `WorkspaceApp.tsx` for file mention previews:

- Accept a `RegistryFileIndexSearchResult`.
- Normalize and validate `result.path`.
- Call the existing `openChatFilePeek(path, null)` function.
- Keep the file mention popup state unchanged.
- Restore composer focus on the next animation frame.

This keeps pointer and keyboard preview behavior consistent and avoids duplicating chat peek setup logic.

### 2) Result row layout
Render each result as a row with two actions:

- A main button for insertion.
- A trailing icon button for preview.

The main button continues to use `applyChatFileMentionResult(result)`. The trailing icon button calls the preview helper and prevents the row insertion behavior from firing.

### 3) Keyboard handling
Extend the existing composer `onKeyDown` branch that handles the open file mention popup:

- Keep `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and `Escape` behavior unchanged.
- Add `Ctrl+O` / `Cmd+O` handling before fallthrough.
- Use `chatFileMentionActiveIndex` to find the active result.
- Prevent the default event whether or not a result exists.

The shortcut is local to the open popup and does not affect normal composer or browser behavior when the popup is closed.

### 4) Styling
Update `file.css` for the file mention popup:

- Add a desktop-only tip row above results.
- Change file mention option layout to reserve a trailing preview action.
- Keep file name and path truncation stable.
- Ensure the trailing icon button is compact, discoverable through `title` and `aria-label`, and does not cause row text overlap.
- Hide the shortcut tip on mobile using the existing responsive breakpoint style.

## Testing Strategy
Update existing Web UI tests, preferably in `app/__tests__/web-chat-ui.test.ts` and `app/__tests__/web-chat-file-peek-viewer.test.ts`:

- Assert that the file mention popup renders the shortcut tip text.
- Assert that file mention result rows include a trailing preview icon button.
- Assert that `Ctrl+O` / `Cmd+O` handling exists only in the file mention popup keyboard branch.
- Assert that preview calls `openChatFilePeek(result.path, null)`.
- Assert that preview does not call `applyChatFileMentionResult`.
- Assert that preview does not close the file mention popup.
- Assert that existing insertion behavior remains wired to the main row action.

## Risks And Mitigations
- Risk: the row gains two nested buttons, which would produce invalid HTML and unreliable clicks.
  - Mitigation: render the result as a container with sibling buttons or otherwise avoid button nesting.
- Risk: `Ctrl+O` conflicts with browser open-file behavior.
  - Mitigation: intercept it only while the `@` popup is open and always prevent default in that state.
- Risk: the new trailing action makes long file paths overlap.
  - Mitigation: reserve a fixed trailing column and keep existing ellipsis behavior for name and path.
- Risk: mobile users see an irrelevant keyboard tip.
  - Mitigation: hide the tip on mobile while keeping the preview icon available.

## Acceptance Criteria
- The `@` file mention popup shows a right-side preview icon for each file result.
- Clicking the preview icon opens the file in the chat file peek viewer without inserting the mention.
- Previewing a file leaves the `@` popup open.
- Clicking the main result area still inserts the file mention and closes the popup.
- `Ctrl+O` and `Cmd+O` open the currently highlighted file result while the popup is open.
- The shortcut is intercepted with no-op behavior when the popup is open and no result is available.
- Desktop shows `Ctrl+O To open selected file`.
- Mobile does not show the shortcut tip.
