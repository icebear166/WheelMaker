# Unified Context Menu Gestures Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify mouse right-click and touch/pen long-press behavior for every existing custom context-menu target without breaking text selection, scrolling, short taps, or nested action buttons.

**Scope Source:** `docs/scope/2026-08-12-unified-context-menu-gestures.md`

**Architecture:** `useContextMenuGesture` and its target binder own the pointer/contextmenu state machine, emit the target-local browser-default contract, and expose a companion nested-action guard. Session and Project lists consume that shared boundary while Workspace retains menu content and Sheet/Popover ownership; file menu models, Preview selection, and Terminal copy remain unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Pointer Events, Jest 30/jsdom, react-test-renderer, CSS.

**Verification:** The exact focused Jest commands listed per task, followed by `npm run tsc:web`, `npm run build:web`, and repository-root `git diff --check`.

---

### Task 1: Persist the confirmed interaction contract in the wiki

**Files:**
- Create: `docs/wiki/frontend-interaction/context-menu-gestures.md`
- Modify: `docs/wiki/frontend-interaction/frontend-interaction.md`
- Modify: `docs/wiki/frontend-interaction/session-list.md`
- Modify: `docs/wiki/features/file-links.md`
- Modify: `docs/plans/2026-08-12-unified-context-menu-gestures/plan-unified-context-menu-gestures.md`

**Acceptance:** The confirmed cross-target gesture policy has one discoverable wiki authority; file and session pages link to it and retain only their domain-specific menu behavior.

- [x] **Step 1: Create the interaction policy page**

  Record the supported targets, 450ms/8px arbitration, input-device trigger rules, local selection/callout suppression, one haptic per committed long press, click/de-duplication behavior, nested action ownership, and selectable-text exclusions. Link the approved scope as the source.

- [x] **Step 2: Update the directory and domain indexes**

  Add `context-menu-gestures.md` to the Frontend Interaction page list. Update `session-list.md` and `file-links.md` to reference the shared policy while preserving Session/Project menu contents and file action boundaries.

- [x] **Step 3: Validate wiki structure and links**

  Run: `Get-Content docs/wiki/frontend-interaction/context-menu-gestures.md -TotalCount 2; rg -n "context-menu-gestures" docs/wiki/frontend-interaction docs/wiki/features/file-links.md; git diff --check`

  Expected: Every changed wiki page starts with `> 摘要：`, the new page is indexed and referenced, and diff validation succeeds.

- [x] **Step 4: Git checkpoint**

  Invoke `git-workflow` checkpoint for the four wiki files plus this checked plan. Record the commit hash and subject in the execution report.

### Task 2: Build the shared gesture and browser-default contract with TDD

**Files:**
- Modify: `app/web/src/common/useContextMenuGesture.test.tsx`
- Modify: `app/web/src/common/useContextMenuGesture.ts`
- Create: `app/__tests__/web-context-menu-gesture-contract.test.ts`
- Modify: `app/web/src/styles/settings.css`
- Modify: `docs/plans/2026-08-12-unified-context-menu-gestures/plan-unified-context-menu-gestures.md`

**Acceptance:** One shared state machine handles mouse, touch, and pen; long press emits one haptic/open, movement permanently cancels the current press, synthetic follow-up events cannot double-open or click, and target-local CSS wins over selectable chat descendants.

- [x] **Step 1: Write failing shared-hook tests**

  Extend the jsdom harness to assert:

  - spreading the target gesture emits the shared target data attribute;
  - touch and pen commit only after 450ms and call `navigator.vibrate(12)` exactly once;
  - a move from `(0, 0)` to `(9, 0)` cancels permanently even after moving back and waiting;
  - the contextmenu and click synthesized after a committed long press are prevented without a second `onOpen`;
  - the next independent short click and mouse right-click still work;
  - unmount and target replacement clear timers and do not open a stale target;
  - the nested-action guard stops parent pointer/contextmenu propagation, permits a short click, suppresses a held click, and never vibrates.

- [x] **Step 2: Write the failing style-contract test**

  In `web-context-menu-gesture-contract.test.ts`, read `settings.css` and assert that the shared target selector and its descendants set `-webkit-touch-callout: none`, `-webkit-user-select: none`, and `user-select: none` after the general selectable-text rule. Also assert that the selector does not target `.chat-main-message`, `.wm-shiki-line-content`, or `.terminal-xterm-surface` wholesale.

- [x] **Step 3: Run RED tests**

  Run: `npm test -- --runInBand web/src/common/useContextMenuGesture.test.tsx __tests__/web-context-menu-gesture-contract.test.ts`

  Expected: FAIL because haptic/de-duplication/action-guard behavior and the shared CSS marker do not exist yet.

- [x] **Step 4: Implement the minimum shared state machine**

  Keep 450ms and 8px constants in `useContextMenuGesture.ts`. Track pointer ID, origin, committed/cancelled state, target snapshot, and one-shot click/contextmenu suppression. Only touch/pen primary presses start timers; pointer movement is observed without preventing default scrolling. Call the existing light haptic utility only when a normal target commits. Export a typed nested-action guard using the same timing and cancellation rules but no open callback or haptic.

- [x] **Step 5: Implement the local CSS contract**

  Add the marker/descendant rule after the general selectable-content reset in `settings.css`, with sufficient cascade specificity to keep marked file/Session/Project/Tab targets non-selectable while adjacent text remains selectable.

- [x] **Step 6: Run GREEN and focused regression tests**

  Run: `npm test -- --runInBand web/src/common/useContextMenuGesture.test.tsx __tests__/web-context-menu-gesture-contract.test.ts __tests__/web-responsive-ui-state.test.ts`

  Expected: PASS; existing mobile haptic behavior remains intact.

- [x] **Step 7: Git checkpoint**

  Invoke `git-workflow` checkpoint for the shared hook, tests, CSS, and checked plan after GREEN.

### Task 3: Migrate Session and Project context menus with TDD

**Files:**
- Modify: `app/web/src/chat/sessionlist/SessionListView.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionListView.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.test.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.tsx`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.test.tsx`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `docs/plans/2026-08-12-unified-context-menu-gestures/plan-unified-context-menu-gestures.md`

**Acceptance:** Normal and Recent Session rows plus Project titles use the shared gesture on every input-capable layout; Search/Archived/Draft remain excluded; mobile layout renders Sheets and wide layout renders Popovers; Project Actions contains Resume and Pin/Unpin only.

- [ ] **Step 1: Write failing Session/Project binding tests**

  Update `SessionListView.test.tsx` to drive touch/pen timers through rendered normal and Recent rows and assert callbacks receive `(projectId, sessionId, {x, y})`; assert Project title right-click/long-press receives `(projectId, {x, y})`. Keep archived/search slot tests and add a Draft assertion showing no shared target marker.

- [ ] **Step 2: Write failing nested-action tests**

  Use fake timers in `SessionRow.test.tsx` and `ProjectSection.test.tsx`. Assert Session Unpin and Project Resume/Pin/New execute on short click, but after a 450ms touch hold their click is prevented, no parent menu handler runs, and no haptic is emitted.

- [ ] **Step 3: Update source-contract assertions before implementation**

  Replace the old `PROJECT_PIN_LONG_PRESS_MS`, `PROJECT_SESSION_LONG_PRESS_MS`, manual timer/ref, pointer-capture, and consume-click expectations in `web-chat-ui.test.ts` with assertions that Workspace receives position-based Session/Project callbacks and no longer owns those long-press state machines. Add assertions for wide Project Actions containing Resume and Pin/Unpin but not New Session.

- [ ] **Step 4: Run RED tests**

  Run: `npm test -- --runInBand web/src/chat/sessionlist/SessionListView.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/ProjectSection.test.tsx __tests__/web-chat-ui.test.ts`

  Expected: FAIL because list props still expose manual handlers/consume functions, nested controls lack the action guard, and wide Project titles have no actions menu.

- [ ] **Step 5: Move gesture ownership into SessionListView**

  Replace handler factories and consume-click props with position-based `onOpenSessionContextMenu` and `onOpenProjectContextMenu` callbacks. Bind shared target gestures only while rendering normal/Recent Session rows and Project headers; do not bind Draft, search, archived, or older-toggle rows.

- [ ] **Step 6: Preserve menu ownership in Workspace**

  Delete Session/Project timer refs, 450ms constants, pointer-capture helpers, and consume-click branches. Normalize Session/Project target callbacks, close transient menus, compute wide popover placement from gesture coordinates, and select Sheet versus Popover from current layout. Extend wide Project action state/rendering for the existing Resume and Pin/Unpin actions; keep New Session exclusively on `+`.

- [ ] **Step 7: Apply the nested-action guard**

  Bind the shared action guard to Session Unpin and Project Resume/Pin/New controls without changing their existing business callbacks or disabled states.

- [ ] **Step 8: Run GREEN and focused regressions**

  Run: `npm test -- --runInBand web/src/chat/sessionlist/SessionListView.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/SessionMenu.test.tsx __tests__/web-chat-ui.test.ts`

  Expected: PASS with normal/Recent coverage and existing menu actions intact.

- [ ] **Step 9: Git checkpoint**

  Invoke `git-workflow` checkpoint for Session/Project implementation, tests, and checked plan after GREEN.

### Task 4: Verify file targets and isolate Preview Tab controls with TDD

**Files:**
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`
- Create: `app/web/src/file/FileExplorerTree.test.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.test.tsx`
- Modify: `app/web/src/preview/PreviewWorkbenchChrome.tsx`
- Modify: `app/__tests__/web-context-menu-gesture-contract.test.ts`
- Modify: `docs/plans/2026-08-12-unified-context-menu-gestures/plan-unified-context-menu-gestures.md`

**Acceptance:** Chat file links, attachments, artifact files, file tree rows, Preview/Quick Open search results, and Preview Tabs expose the shared non-selection contract; Preview Tab Close owns its gesture and cannot open the parent menu or close after a long hold.

- [ ] **Step 1: Write failing target-coverage assertions**

  Render attachment/artifact targets in `ChatTurnView.test.tsx`, file rows in a new `FileExplorerTree.test.tsx`, and tabs in `PreviewWorkbenchChrome.test.tsx`; assert context-menu-enabled targets receive the shared data marker while ordinary chat text and non-menu rows do not. Extend the source-contract test to enumerate Workspace-managed chat file links, Preview search rows, and Quick Open rows as shared target-bind consumers.

- [ ] **Step 2: Write the failing Preview Close arbitration test**

  In `PreviewWorkbenchChrome.test.tsx`, assert a short close click calls `onTabClose` once and not `onTabContextMenu`; after a 450ms touch hold, the synthesized click is prevented, neither callback runs, and `navigator.vibrate` is not called.

- [ ] **Step 3: Run RED tests**

  Run: `npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx web/src/file/FileExplorerTree.test.tsx web/src/preview/PreviewWorkbenchChrome.test.tsx __tests__/web-context-menu-gesture-contract.test.ts`

  Expected: FAIL on Preview Close because it currently bubbles pointer events and executes after a hold; any uncovered target marker assertions also fail.

- [ ] **Step 4: Isolate Preview Tab Close and close target gaps**

  Bind the shared nested-action guard to the tab close button. If a listed file target does not already consume the target gesture binder, route it through that binder without changing click behavior or menu target construction.

- [ ] **Step 5: Run GREEN and file-menu regressions**

  Run: `npm test -- --runInBand web/src/chat/ChatTurnView.test.tsx web/src/file/FileExplorerTree.test.tsx web/src/preview/PreviewWorkbenchChrome.test.tsx web/src/preview/PreviewTabContextMenu.test.tsx web/src/common/ContextMenu.test.tsx __tests__/web-context-menu-gesture-contract.test.ts`

  Expected: PASS; file action models and menu rendering remain unchanged.

- [ ] **Step 6: Git checkpoint**

  Invoke `git-workflow` checkpoint for file/Preview coverage, implementation, tests, and checked plan after GREEN.

### Task 5: Complete acceptance verification and Git lifecycle

**Files:**
- Modify if implementation knowledge changed: only the four confirmed wiki targets
- Modify: `docs/plans/2026-08-12-unified-context-menu-gestures/plan-unified-context-menu-gestures.md`

**Acceptance:** Every automated acceptance signal passes, the diff stays within the approved scope, manual-only device checks are reported explicitly, and the configured branch/push/merge/cleanup workflow is completed.

- [ ] **Step 1: Run the complete related Jest suite**

  Run: `npm test -- --runInBand web/src/common/useContextMenuGesture.test.tsx web/src/chat/ChatTurnView.test.tsx web/src/file/FileExplorerTree.test.tsx web/src/preview/PreviewWorkbenchChrome.test.tsx web/src/preview/PreviewTabContextMenu.test.tsx web/src/common/ContextMenu.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx web/src/chat/sessionlist/SessionRow.test.tsx web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/SessionMenu.test.tsx __tests__/web-context-menu-gesture-contract.test.ts __tests__/web-responsive-ui-state.test.ts __tests__/web-chat-ui.test.ts`

  Expected: PASS with no unexpected console errors or warnings.

- [ ] **Step 2: Run static and production-build validation**

  Run: `npm run tsc:web`

  Run: `npm run build:web`

  Run from repository root: `git diff --check`

  Expected: all commands exit 0.

- [ ] **Step 3: Audit exclusions and changed files**

  Inspect `git status -sb`, `git diff --stat origin/main...HEAD`, and the final diff. Confirm Preview selection Copy, Terminal selection/Copy, chat body selection, Search/Archived/Draft Session behavior, voice hold, Floating Nav, file action models, protocols, and server code were not changed outside the approved compatibility work.

- [ ] **Step 4: Record manual-device residual risk**

  Report Android WebView/mobile browser/tablet/touch-PC callout and scroll checks as pending unless this environment provides those real devices; do not present automated jsdom/CSS/build evidence as a real-device pass.

- [ ] **Step 5: Final wiki review**

  If implementation confirms additional stable facts within the four authorized wiki files, update only those facts and rerun first-line/link/diff checks. Do not create another wiki target.

- [ ] **Step 6: Final Git checkpoint and finalize**

  Check off the plan, checkpoint any remaining task-owned changes, then invoke `git-workflow` finalize with the real completion and verification result. Report commits, remote branch, merge/cleanup outcome, and any skipped action with its reason.
