# File Menu and Preview Entry Unification Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every file-related context menu consume one grouped menu model and align Preview context-menu entry points across desktop and mobile without changing existing file actions or left-click behavior.

**Scope Source:** `docs/scope/2026-08-10-file-menu-unification.md`

**Architecture:** Add a generic positioned context-menu shell and a file-menu model builder. The builder accepts a surface, normalized target facts, platform, and capabilities, then returns the fixed `open`, `transfer-share-export`, and `path` groups plus surface-specific actions. Chat file menus and Preview Tab menus render the same model and dispatch the same action IDs; callers provide target facts and effect handlers only.

**Tech Stack:** React, TypeScript, Jest, React test renderer/jsdom, webpack.

**Verification:** Focused Jest suites for the model, shared renderer, file menu, and Preview Chrome; `npm run tsc:web`; `npm run build:web` from `app`.

---

## Task 1: Build the grouped model and shared menu shell

**Files:**
- Add `app/web/src/file/fileMenuModel.ts` and its unit test.
- Add `app/web/src/common/ContextMenu.tsx` for the shared positioned shell and model renderer.
- Update `app/web/src/styles/chat.css` and `app/web/src/styles/file.css` only as needed to give the shared shell one stable visual contract.

- [x] Write failing model tests covering project/external/attachment/changed targets, desktop/browser/Android capability gates, Markdown/HTML share and export conditions, diff/history exclusion, fixed action order, group IDs, short labels, icons, and empty-group filtering.
- [x] Run the focused model test and confirm it fails for the missing builder.
- [x] Implement the normalized `ContextMenuOptions` types, `ContextMenuModel`/`MenuGroup` types, the grouped builder, and the shared focus/keyboard/outside-click/scroll/resize/exit shell.
- [x] Run the model and shared-shell tests; fix only the implementation needed for the specified behavior.
- [x] Checkpoint the task with `git diff --check` and an explicit task-scoped commit.

## Task 2: Move chat, attachment, Changed Files, tree, and Quick Open menus to the model

**Files:**
- Update `app/web/src/chat/ChatFileLinkContextMenu.tsx` to render the shared model instead of local action groups and capability booleans.
- Update `app/web/src/app/WorkspaceApp.tsx` to normalize all existing file-menu sources into the model and route the unified action dispatcher.
- Update `app/__tests__/web-chat-file-link-context-menu.test.tsx` and related source-contract assertions for the new labels and groups.

- [x] Update/add renderer integration tests first for the model-driven menu, including `Share MD/HTML` and the unified `Export as HTML` label on Desktop and browser paths.
- [x] Run the focused file-menu tests and confirm the new assertions fail before production refactoring.
- [x] Replace caller-side `can*`/HTML-label JSX decisions with model options for chat links, attachments, Changed Files, Preview file tree/search, and Quick Open while preserving each left-click handler.
- [x] Keep the existing preview/download/copy/share/export/Desktop bridge effects behind the same action IDs and ensure deleted, external, attachment, and unavailable files hide invalid actions.
- [x] Run focused file-menu, download, bridge, keyboard-navigation, and relevant chat tests; checkpoint with `git diff --check` and an explicit task-scoped commit.

## Task 3: Use the same model for Preview Tab menus and align desktop/mobile entry points

**Files:**
- Update `app/web/src/app/WorkspaceApp.tsx`, `app/web/src/preview/PreviewTabContextMenu.tsx`, and `app/web/src/preview/PreviewWorkbenchChrome.tsx`.
- Update `app/web/src/preview/PreviewWorkbenchChrome.test.tsx` and `app/__tests__/web-chat-file-peek-viewer.test.ts`.

- [x] Add failing tests for the Preview Tab action boundary: ordinary Markdown/HTML file tabs, attachment tabs, Prompt/Git diff or history tabs, Relay tabs, and the fixed grouped order.
- [x] Add failing Chrome tests asserting Desktop has no top-right Preview actions button, Desktop Tab right-click still opens the menu, and Mobile retains the ellipsis plus long-press/right-click path.
- [x] Refactor Preview Tab actions to build/render the same model and dispatch the existing effects; exclude normal Download, Copy file, Share MD/HTML, and HTML export from diff/history tabs while retaining Refresh and Relay-only actions where applicable.
- [x] Make the desktop Chrome omit the actions button and the mobile Chrome keep it targeted at the active tab; keep the existing long-press gesture and make both mobile routes produce the same model/action set.
- [x] Run focused Preview tests and checkpoint with `git diff --check` and an explicit task-scoped commit.

## Task 4: Full verification and handoff

- [x] Run all affected Jest suites, then `npm run tsc:web` and `npm run build:web` from `app`.
- [x] Inspect the final diff for unrelated changes, protocol-version changes, duplicate menu JSX, stale labels, and accidental edits outside the feature worktree.
- [x] Update this plan checkboxes and record verification results in the final handoff.
- [x] Invoke git-workflow-preferences finalize: commit verified work, attempt branch push, and merge into clean local `main` only if the pre-existing dirty main workspace permits it; preserve the isolated worktree when merge/cleanup is unsafe.

### Verification (2026-08-10)

- Affected Jest suites: 9 passed, 98 tests passed.
- `npm run tsc:web`: passed.
- `npm run build:web`: passed.
- `git diff --check`: passed; no protocol-version changes or duplicate file-menu JSX introduced.

### Git finalization

- Rebased onto `origin/main` (`df779dd2`) without conflicts.
- Pushed `feature/file-menu-unification`; local `main` was clean and ready for fast-forward merge.
