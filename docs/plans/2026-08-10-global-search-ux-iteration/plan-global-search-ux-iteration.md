# Global Search UX Iteration Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows target-picker search flow with direct context-aware shortcuts and make current-session, global-session, and Preview search surfaces visible, navigable, and consistent.

**Scope Source:** `docs/scope/2026-08-10-global-search-ux-iteration.md` (approved 2026-08-10)

**Architecture:** Keep search state local to `WorkspaceApp` and preserve the existing current-chat and Preview match engines. Add a small pure routing module for shortcut target resolution, move the global session search from submit-driven to debounced input-driven execution, and mount the chat/Preview search bars as independent surface layers above their scroll containers. Reuse the existing Registry `session.search` contract and Sessions sidebar renderer; do not add snippets or protocol fields.

**Tech Stack:** React 19, TypeScript, Jest, CSS tokens, `react-virtuoso`, existing Registry workspace service.

**Verification:** From `app/`: focused Jest tests per task, `npm run tsc:web`, `npm test`, `npm run build:web`; manual keyboard/focus and scroll checks for Chat, Preview, Sessions, narrow screens, and reduced motion.

---

### Task 1: Replace target-picker logic with pure shortcut routing

**Files:**
- Create: `app/web/src/chat/search/searchRouting.ts`
- Create: `app/__tests__/web-chat-search-routing.test.ts`
- Delete after the new module is wired: `app/web/src/chat/search/searchTargetPicker.ts`
- Delete after the old test assertions are migrated: `app/__tests__/web-chat-search-target-picker.test.ts`

**Acceptance:** A pure resolver returns `current`, `preview`, or `sessions` for Ctrl/Cmd shortcuts, uses Preview only when the event is inside a searchable Preview surface, falls back to current chat when Preview search is unavailable, ignores unrelated/Alt shortcuts, and preserves the existing session-panel expansion decision.

- [x] **Step 1: Write the failing routing tests**

  Add tests with concrete event/context inputs:

  ```ts
  expect(resolveWorkspaceSearchShortcutTarget(
    {key: 'f', ctrlKey: true},
    {previewFocused: false, previewSearchable: false},
  )).toBe('current');
  expect(resolveWorkspaceSearchShortcutTarget(
    {key: 'F', metaKey: true},
    {previewFocused: true, previewSearchable: true},
  )).toBe('preview');
  expect(resolveWorkspaceSearchShortcutTarget(
    {key: 'f', ctrlKey: true},
    {previewFocused: true, previewSearchable: false},
  )).toBe('current');
  expect(resolveWorkspaceSearchShortcutTarget(
    {key: 'f', ctrlKey: true, shiftKey: true},
    {previewFocused: true, previewSearchable: true},
  )).toBe('sessions');
  expect(resolveWorkspaceSearchShortcutTarget(
    {key: 'f', altKey: true},
    {previewFocused: false, previewSearchable: false},
  )).toBeNull();
  ```

  Also assert `resolveSessionSearchExpansion` returns `open-slideout` only when neither pinned nor slide-out Sessions is visible.

- [x] **Step 2: Run the focused test and verify the expected RED**

  Run: `npm test -- --runInBand __tests__/web-chat-search-routing.test.ts`

  Expected: Jest fails because `searchRouting.ts` and the requested resolver exports do not exist yet.

- [x] **Step 3: Implement the minimal pure routing module**

  Export `WorkspaceSearchTarget`, `resolveWorkspaceSearchShortcutTarget`, `SessionSearchExpansion`, and `resolveSessionSearchExpansion`. Normalize the key to lowercase, require Ctrl or Meta, let Shift select the global target, reject Alt, and use the Preview context only for the unshifted shortcut.

- [x] **Step 4: Run the focused test and verify GREEN**

  Run: `npm test -- --runInBand __tests__/web-chat-search-routing.test.ts`

  Expected: all routing and session-panel expansion assertions pass.

- [x] **Step 5: Run the existing pure search regressions**

  Run: `npm test -- --runInBand __tests__/web-chat-search-state.test.ts __tests__/web-chat-search-controller.test.ts`

  Expected: existing current-session search behavior remains green.

- [x] **Step 6: Git checkpoint**

  After verification, checkpoint the new routing test/module and the approved spec/plan documents. Do not stage unrelated files.

### Task 2: Add global-result metadata and debounce constants

**Files:**
- Modify: `app/web/src/chat/session/sessionSearchState.ts`
- Modify: `app/__tests__/web-session-search-state.test.ts`

**Acceptance:** Session result rows can format the existing `title`/`prompt` source and optional Turn number without requiring a snippet or protocol change; the 300ms debounce interval is a named shared constant.

- [x] **Step 1: Write failing state-helper tests**

  Add assertions for a helper such as `formatSessionSearchResultMeta`:

  ```ts
  expect(formatSessionSearchResultMeta({source: 'title'})).toBe('Title');
  expect(formatSessionSearchResultMeta({source: 'prompt', turnIndex: 4})).toBe('Prompt · Turn 4');
  expect(formatSessionSearchResultMeta({source: 'prompt', turnIndex: 0})).toBe('Prompt');
  expect(SESSION_SEARCH_DEBOUNCE_MS).toBe(300);
  ```

- [x] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- --runInBand __tests__/web-session-search-state.test.ts`

  Expected: Jest fails because the formatter and named debounce constant are not exported.

- [x] **Step 3: Implement the minimal helpers**

  Add the constant and formatter to `sessionSearchState.ts`. The formatter must use only the existing `source` and `turnIndex` fields and must never invent a snippet.

- [x] **Step 4: Run the focused test and verify GREEN**

  Run: `npm test -- --runInBand __tests__/web-session-search-state.test.ts`

  Expected: all session state assertions pass.

- [x] **Step 5: Git checkpoint**

  Checkpoint only `sessionSearchState.ts` and its test.

### Task 3: Wire direct shortcuts and context-aware Chat/Preview opening

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Delete after all imports/assertions are removed: `app/web/src/chat/search/searchTargetPicker.ts`
- Delete after all old assertions are removed: `app/__tests__/web-chat-search-target-picker.test.ts`

**Acceptance:** The global target-picker state/effect/overlay is gone. A single workspace-level shortcut route opens current chat, searchable Preview, or Sessions directly; an unsupported Preview falls back to current chat. Existing Preview `P` and tab shortcuts remain unchanged.

- [x] **Step 1: Update source-wiring tests before implementation**

  Replace picker expectations with assertions that `WorkspaceApp.tsx` imports `resolveWorkspaceSearchShortcutTarget`, routes the two F shortcuts, checks `.preview-workbench-surface`, calls `openPreviewSearch` only for a searchable Preview, and calls the Sessions-opening helper for Shift+F. Assert the old `chat-search-target-backdrop`, `setSearchTargetPickerOpen`, `confirmSearchTarget`, and `seedSearchQuery` wiring is absent. Add a source assertion that Preview fallback calls `openChatSearch`.

- [x] **Step 2: Run the affected tests and verify the expected RED**

  Run: `npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-chat-ui.test.ts`

  Expected: the new direct-routing assertions fail against the existing picker implementation; unrelated existing assertions remain readable in the failure output.

- [x] **Step 3: Implement direct workspace routing**

  Remove the target-picker state, availability memo, confirm/seed functions, picker keyboard effect, and overlay JSX. Extract a stable Sessions-opening action that expands the slide-out when needed and focuses `sessionSearchInputRef`. Replace the Windows-only F listener with a platform-aware capture listener using the pure resolver. Detect Preview focus from the event target's `.preview-workbench-surface` ancestor and pass `!!activeWorkbenchTab && !previewSearchUnavailableMessage` as searchability. Keep `Ctrl/Cmd+Shift+F` global regardless of Preview focus.

- [x] **Step 4: Run the affected tests and verify GREEN**

  Run: `npm test -- --runInBand __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-chat-ui.test.ts __tests__/web-chat-search-routing.test.ts`

  Expected: direct shortcut assertions pass, old picker assertions are removed, and Preview P/Tab routing regressions remain green.

- [x] **Step 5: Run Web TypeScript validation**

  Run: `npm run tsc:web`

  Expected: no TypeScript errors from removed picker symbols or new shortcut routing.

- [x] **Step 6: Git checkpoint**

  Checkpoint `WorkspaceApp.tsx` and the explicitly updated/deleted shortcut tests/modules after the focused tests and typecheck pass.

### Task 4: Make Sessions search live and keyboard-navigable

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-session-search-ui.test.ts`
- Modify: `app/__tests__/web-session-search-state.test.ts`

**Acceptance:** Opening Sessions search focuses the input; non-empty input starts a debounced per-Project search; changing or clearing the query cancels the prior search; the check/submit confirmation is removed; Enter/Shift+Enter navigates the flattened result rows; result rows show source/Turn metadata and an active row state.

- [x] **Step 1: Update UI/state tests before implementation**

  Add source assertions for `SESSION_SEARCH_DEBOUNCE_MS`, a timer tied to `sessionSearchInput`, cancellation before a new `startSessionSearch`, no check submit button, `handleSessionSearchInputKeyDown`, flattened result navigation, `formatSessionSearchResultMeta`, and active result row markup. Assert the current `startSessionSearch` form-submit-only path is no longer the sole trigger.

- [x] **Step 2: Run the affected tests and verify the expected RED**

  Run: `npm test -- --runInBand __tests__/web-session-search-ui.test.ts __tests__/web-session-search-state.test.ts`

  Expected: new live-search and result-metadata assertions fail against the submit-driven UI.

- [x] **Step 3: Implement debounced query ownership**

  Add a session-search debounce timer ref/effect using `SESSION_SEARCH_DEBOUNCE_MS`. When the input changes, clear the previous timer; after the delay, call the existing `startSessionSearch`; when the input is empty, clear results and cancel the active server search. Preserve per-Project progress/error isolation and the existing polling backoff.

- [x] **Step 4: Implement keyboard navigation and row metadata**

  Add a memoized flattened list of the current `sessionSearchSections`, an active result index, and a key handler: Escape exits, Enter moves forward, Shift+Enter moves backward. Clicking a row sets the active index before invoking the existing session/Turn navigation. Render `formatSessionSearchResultMeta` beside the title/time and expose the active row with a class and accessible selected/current state.

- [x] **Step 5: Remove explicit submit-only UI and run focused tests**

  Replace the Sessions search `<form>`/check button with a search region whose input handles Escape/Enter; retain the close button and status line. Run:

  `npm test -- --runInBand __tests__/web-session-search-ui.test.ts __tests__/web-session-search-state.test.ts __tests__/web-session-search-service.test.ts`

  Expected: live search wiring, result metadata, async service behavior, loading status, errors, and cancellation all pass.

- [x] **Step 6: Git checkpoint**

  Checkpoint the Sessions search implementation and its focused tests.

### Task 5: Mount the Search HUD above scroll content and unify result emphasis

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/file.css`
- Modify: `app/__tests__/web-chat-session-search-ui.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/web/src/styles/motionContracts.test.ts` only if existing motion contract coverage requires a new stable selector

**Acceptance:** Chat and Preview search bars are independent raised surfaces above their scroll content, remain visible while content scrolls, align to their content column, use clear active/focus/no-result styling, and animate only when appropriate with reduced-motion coverage. Current and Preview match highlights distinguish all matches from the active match.

- [x] **Step 1: Add failing style/source assertions**

  Assert the chat main search-open class, HUD layer/position classes, Preview HUD layer classes, active/no-result match classes, explicit motion properties, and reduced-motion selectors. Assert that the search bars no longer rely on normal-flow placement as their visibility mechanism.

- [x] **Step 2: Run the focused tests and verify the expected RED**

  Run: `npm test -- --runInBand __tests__/web-chat-session-search-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts`

  Expected: new HUD and active-match assertions fail against the current 34px normal-flow bars.

- [x] **Step 3: Implement the HUD layout**

  Add a `chat-search-open` modifier to the chat main surface. Position the chat HUD within `.chat-main` at a dedicated layer above the scroll container, reserve only the necessary top reading space, and reuse the existing fixed-800/edge-surface geometry variables. Keep the Sessions edge surfaces below the HUD. Give Preview search its own surface-level layer inside the Preview workbench body, above file/code content and below drawer/action layers.

- [x] **Step 4: Implement the visual hierarchy and motion**

  Use existing surface/border/shadow/focus tokens with a deliberate blue accent edge and a restrained warm active-match mark that remains legible on code backgrounds. Use named `opacity`/`transform` transitions or CSS animations only for occasional HUD appearance/state feedback; do not animate the frequent keyboard action itself. Use the existing motion tokens and a strong ease-out already present in the project, and add reduced-motion rules that remove translation while keeping state/color feedback. Avoid `transition: all`, layout-property animation, and unbounded z-index escalation.

- [x] **Step 5: Implement all-vs-active match styling**

  Apply a low-contrast class to non-active chat/Preview matches and a stronger class to the active match. Keep existing highlight plugins and line-navigation algorithms; only adjust class names/props necessary to express active state and preserve Markdown/code fallback behavior.

- [x] **Step 6: Run focused tests, typecheck, and inspect diff**

  Run:

  `npm test -- --runInBand __tests__/web-chat-session-search-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-chat-search-highlight-plugin.test.ts`

  `npm run tsc:web`

  Expected: style/source assertions, Markdown highlight coverage, and TypeScript all pass; `git diff --check` reports no whitespace errors.

- [x] **Step 7: Git checkpoint**

  Checkpoint the HUD implementation, styles, and focused tests.

### Task 6: Update confirmed frontend wiki knowledge

**Files:**
- Modify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`
- Modify: `docs/wiki/frontend-interaction/workbench-chrome.md`
- Modify: `docs/wiki/frontend-interaction/visual-language.md`

**Acceptance:** The three existing pages describe the shipped direct shortcuts, active-session global scope, Preview focus fallback, Sessions sidebar result behavior, and Search HUD visual/motion rules without including temporary task steps or unconfirmed details.

- [ ] **Step 1: Read the three target pages in full and locate the existing search/Chrome/visual sections**

  Preserve each page's first-line summary and existing unrelated rules. Update the Search entry section in `pc-chat-sidebar-modes.md`, Preview search behavior in `workbench-chrome.md`, and the stable HUD/highlight/motion rules in `visual-language.md`.

- [ ] **Step 2: Write only confirmed stable knowledge**

  Record Ctrl/Cmd+F context routing, Ctrl/Cmd+Shift+F Sessions search, active-session/all-visible-Project scope excluding Archived, retained Preview toolbar search, unsupported-Preview fallback, sidebar result metadata, HUD layer requirements, active/all-match emphasis, and reduced-motion behavior. Do not copy plan checklists or implementation line numbers.

- [ ] **Step 3: Run wiki structure checks and Git checkpoint**

  Run a first-line summary check for all three pages and `git diff --check`. Checkpoint only the three wiki files after verifying the diff contains no task checklist or speculative protocol change.

### Task 7: Full verification and completion gate

**Files:**
- Verify all task-owned files; no new implementation files are introduced in this task.

**Acceptance:** The full feature satisfies the approved spec and all required automated checks pass.

- [ ] **Step 1: Run the complete Jest suite**

  Run: `npm test -- --runInBand`

  Expected: all tests pass with no unexpected errors.

- [ ] **Step 2: Run Web TypeScript and production build**

  Run: `npm run tsc:web`

  Run: `npm run build:web`

  Expected: both commands exit 0.

- [ ] **Step 3: Perform manual interaction checks**

  Check desktop Windows/Linux Ctrl+F and Ctrl+Shift+F, macOS modifier routing through the pure resolver, Preview searchable and unsupported tabs, code/Markdown scroll layering, Sessions debounce/loading/error/empty states, Enter/Shift+Enter navigation, close/cancel behavior, narrow-screen layout, and `prefers-reduced-motion`.

- [ ] **Step 4: Review task-owned diff and finalize Git workflow**

  Run `git status -sb`, `git diff --check`, and inspect the complete diff. Invoke `git-workflow-preferences` `finalize` with the actual verification result. If complete and green, commit/push the feature branch, merge into clean local `main`, push `main`, verify remote SHAs, and clean up the merged worktree/branches according to the repository preference.
