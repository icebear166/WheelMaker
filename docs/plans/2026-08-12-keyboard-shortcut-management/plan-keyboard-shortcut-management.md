# Keyboard Shortcut Management Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-local, customizable eight-command keyboard shortcut system with a polished PC Settings editor and one authoritative Workspace router.

**Scope Source:** `docs/scope/2026-08-12-keyboard-shortcut-management.md`

**Architecture:** A pure `shortcuts` domain module owns command metadata, logical bindings, platform formatting, event matching, validation, conflicts, and override resolution. `WorkspacePersistence` stores only per-action overrides; `WorkspaceApp` owns the effective snapshot, action handlers, availability, and the single capture router, while a Settings detail component edits the same snapshot without owning command execution.

**Tech Stack:** React 19, TypeScript, Jest/react-test-renderer, IndexedDB-backed `WorkspacePersistence`, existing WheelMaker CSS/Icon/motion tokens.

**Verification:** `npm test -- --runInBand`, `npm run tsc:web`, `npm run build:web`, `git diff --check`, and targeted source/diff checks proving no Go or protocol changes.

---

### Task 1: Persist the approved shortcut conventions in the wiki

**Files:**
- Create: `docs/wiki/frontend-interaction/keyboard-shortcuts.md`
- Modify: `docs/wiki/frontend-interaction/frontend-interaction.md`
- Modify: `docs/wiki/frontend-interaction/app-menu.md`

**Acceptance:** The wiki describes only the approved stable command model, platform/responsive boundary, persistence/conflict semantics, and PC Settings entry; the frontend-interaction index links the new page.

- [ ] **Step 1: Read the confirmed wiki targets and directory index**

Read the full current `app-menu.md` and `frontend-interaction.md` after the already-completed first-line summary scan. Use the approved spec as the source; do not copy execution checklists into wiki.

- [ ] **Step 2: Write the stable shortcut page**

Create `keyboard-shortcuts.md` with a first-line summary, title, the eight command defaults, logical `Primary` behavior, wide-PC/modal/input boundaries, override/null/default semantics, collision and unavailable-action behavior, and the relationship between the registry, router, editor, and dynamic hints.

- [ ] **Step 3: Update Settings and the directory index**

Update `app-menu.md` so PC Settings has Application → Keyboard Shortcuts while mobile retains the existing four groups and no keyboard entry. Add the new page to `frontend-interaction.md` as required by the wiki index contract.

- [ ] **Step 4: Verify the wiki contract**

Run: `git diff --check -- docs/wiki/frontend-interaction`

Expected: PASS; each changed wiki file starts with `> 摘要：`, the new page is indexed, and no plan/checklist language is present.

- [ ] **Step 5: Git checkpoint**

Invoke `git-workflow` in checkpoint mode for the three wiki files. Record the resulting commit hash and subject in the execution log.

### Task 2: Build and persist the shortcut domain model

**Files:**
- Create: `app/web/src/shortcuts/keyboardShortcuts.ts`
- Create: `app/__tests__/web-keyboard-shortcuts.test.ts`
- Modify: `app/web/src/workspace/WorkspacePersistence.ts`
- Modify: `app/__tests__/web-workspace-persistence-safety.test.ts`

**Acceptance:** Eight stable actions resolve to collision-free logical bindings; Primary maps by platform, key values use character semantics, validation distinguishes blocked versus warned combinations, replacement is atomic, and valid/null overrides survive persistence while old or damaged data resolves safely.

- [ ] **Step 1: Write failing domain tests for registry and platform formatting**

In `web-keyboard-shortcuts.test.ts`, assert the exact action order/group/default table, Windows/Linux `Ctrl` versus macOS `Cmd` keycaps, lowercase normalization of letter keys, exact modifier matching, and narrow/composing/default-prevented/paused routing rejection.

- [ ] **Step 2: Run the registry tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts`

Expected: FAIL because `web/src/shortcuts/keyboardShortcuts.ts` and its APIs do not exist.

- [ ] **Step 3: Implement the registry, logical binding, formatting, and matching primitives**

Create the domain module with `ShortcutActionId`, `ShortcutPlatform`, `ShortcutBinding`, `ShortcutOverrides`, `SHORTCUT_COMMANDS`, `normalizeShortcutEvent`, `formatShortcutBinding`, `resolveEffectiveShortcutBindings`, and `matchWorkspaceShortcut`. Store an abstract `primary` modifier and normalize `KeyboardEvent.key`; do not store physical `code` values.

- [ ] **Step 4: Run the registry tests to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts`

Expected: PASS for registry, platform formatting, normalization, and matching cases.

- [ ] **Step 5: Write failing validation and conflict tests**

Add cases for modifier-only and bare text rejection, allowed function keys, blocked refresh/close/quit/devtools/system-switch combinations, warning-only browser combinations, default compatibility exceptions, duplicate detection, cancel/no-op, atomic replace with the old action set to `null`, clear, single restore, and reset-all.

- [ ] **Step 6: Run validation tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts`

Expected: FAIL only for missing validation/update APIs.

- [ ] **Step 7: Implement validation and immutable override updates**

Add pure `validateShortcutCandidate`, `findShortcutConflict`, `assignShortcutBinding`, `replaceShortcutConflict`, `clearShortcutBinding`, `restoreShortcutDefault`, and `resetShortcutOverrides`. The blocked/warning policy is platform-aware; UI-created state never contains duplicate effective bindings.

- [ ] **Step 8: Run validation tests to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts`

Expected: PASS.

- [ ] **Step 9: Write failing persistence compatibility tests**

Extend `web-workspace-persistence-safety.test.ts` to seed valid, null, unknown, malformed, and conflicting `keyboardShortcutOverrides` rows; assert deterministic safe resolution inputs, patch-only persistence of that key, and reset behavior.

- [ ] **Step 10: Run persistence tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-workspace-persistence-safety.test.ts`

Expected: FAIL because `PersistedGlobalState` has no shortcut override field/key/sanitizer.

- [ ] **Step 11: Add shortcut overrides to WorkspacePersistence**

Add `keyboardShortcutOverrides` to `PersistedGlobalState`, `GLOBAL_KEYS`, defaults, input sanitation, returned state, and patch/global row serialization. Reuse the domain sanitizer so unknown/malformed entries are ignored, explicit `null` is retained, and corrupted collisions cannot become active.

- [ ] **Step 12: Run domain and persistence regressions**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts __tests__/web-workspace-persistence-safety.test.ts`

Expected: PASS with no console errors or warnings.

- [ ] **Step 13: Git checkpoint**

Invoke `git-workflow` in checkpoint mode for the shortcut domain, its test, persistence, and persistence test. Record commit hash and subject.

### Task 3: Add the PC Keyboard Shortcuts Settings editor

**Files:**
- Create: `app/web/src/settings/KeyboardShortcutsSettingsDetail.tsx`
- Create: `app/web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx`
- Modify: `app/web/src/settings/settingsNavigation.ts`
- Modify: `app/web/src/settings/SettingsSurface.tsx`
- Modify: `app/web/src/settings/SettingsRootContent.tsx`
- Modify: `app/web/src/settings/SettingsBundle.ts`
- Modify: `app/web/src/styles/settings.css`
- Modify: `app/__tests__/web-settings-navigation.test.ts`

**Acceptance:** Wide Settings exposes Application → Keyboard Shortcuts; the detail renders grouped commands and accurate counts, records keys inline, handles validation/warnings/conflicts/clear/restore/reset accessibly, and is absent/unreachable on narrow layouts.

- [ ] **Step 1: Write failing Settings navigation tests**

Update `web-settings-navigation.test.ts` to expect `keyboardShortcuts` as a detail title, Application before Chat only when `isWide`, and the new bundle export. Add a narrow-layout assertion that no Application row is rendered.

- [ ] **Step 2: Run Settings navigation tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-settings-navigation.test.ts`

Expected: FAIL because the detail and Application group do not exist.

- [ ] **Step 3: Wire the responsive Settings detail contract**

Extend `SettingsDetail`/title/bundle, add Application to `SettingsSectionId`, and render one Keyboard Shortcuts navigation row before Chat only for `isWide`. Keep the existing Chat/Code/State/Debug order unchanged after Application.

- [ ] **Step 4: Run Settings navigation tests to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-settings-navigation.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing editor interaction tests**

In `KeyboardShortcutsSettingsDetail.test.tsx`, render the component with real domain snapshots and assert grouping/counts, platform keycaps, focusable recording mode, modifier preview, Escape cancellation, immediate legal assignment, blocked and warning text, conflict Replace/Cancel, clear, restore, reset confirmation, and `aria-live` feedback.

- [ ] **Step 6: Run editor tests to verify RED**

Run: `npm test -- --runInBand web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx`

Expected: FAIL because the editor component does not exist.

- [ ] **Step 7: Implement the editor with the existing Icon system**

Build the grouped command list from `SHORTCUT_COMMANDS`; use buttons and semantic `<kbd>` elements, focus the recording surface after activation, prevent/stop only recording keystrokes, keep the old value until validation or conflict resolution completes, and send immutable next overrides through one `onChange` callback. Use inline reset confirmation rather than adding a new global dialog kind.

- [ ] **Step 8: Run editor tests to verify GREEN**

Run: `npm test -- --runInBand web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx __tests__/web-settings-navigation.test.ts`

Expected: PASS.

- [ ] **Step 9: Add the disciplined command-index styling**

Add Settings-scoped styles for summary counters, group labels, compact command rows, current/recording keycaps, inline status/actions, warning/error states, focus-visible behavior, and the single emphasized recording signal band. Use existing surface/text/state/motion/radius tokens and add a `prefers-reduced-motion` rule that removes recording movement without hiding state.

- [ ] **Step 10: Add and run CSS contract assertions**

Extend `web-settings-navigation.test.ts` to assert the shortcut classes use existing tokens, `<kbd>` remains visible, focus-visible exists, and reduced motion disables transform/animation.

Run: `npm test -- --runInBand web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx __tests__/web-settings-navigation.test.ts`

Expected: PASS.

- [ ] **Step 11: Git checkpoint**

Invoke `git-workflow` in checkpoint mode for the Settings component, navigation, styles, and their tests. Record commit hash and subject.

### Task 4: Replace distributed listeners with one effective Workspace router

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/workspaceShortcuts.ts`
- Modify: `app/web/src/chat/search/searchRouting.ts`
- Modify: `app/web/src/chat/ChatSessionGlobalBar.tsx`
- Modify: `app/web/src/chat/ChatSessionGlobalBar.test.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-keyboard-shortcuts.test.ts`
- Modify: `app/__tests__/web-terminal-workspace.test.tsx`
- Modify: `app/__tests__/web-chat-search-routing.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Modify: `app/__tests__/web-chat-recent-sessions-ui.test.ts`

**Acceptance:** One capture listener uses the effective snapshot to execute all eight existing actions exactly once, pauses for narrow/composing/local-consumed/modal states, reports unavailable actions through the existing accessible toast, preserves contextual search/session semantics, and removes the visible Ctrl+1 label while dynamic tooltips reflect live bindings.

- [ ] **Step 1: Write failing Workspace router tests**

Extend `web-keyboard-shortcuts.test.ts` with a pure dispatch decision API that distinguishes execute/unavailable/ignore and asserts `preventDefault` intent. Update source-contract tests to require one managed capture listener, eight handler entries, modal/narrow gates, and absence of the old Windows/search/Preview shortcut listeners.

- [ ] **Step 2: Run router tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-search-routing.test.ts __tests__/web-chat-file-peek-viewer.test.ts`

Expected: FAIL because the old distributed effects remain and no unified dispatch contract exists.

- [ ] **Step 3: Add effective shortcut state and the single router to WorkspaceApp**

Initialize `keyboardShortcutOverrides` from `persistedGlobal`, memoize the platform/effective snapshot, persist it in the existing global-state effect, expose immutable editor callbacks, and render the new detail. Register one window capture listener after all eight existing action callbacks are available; feed it `isWide`, composition/default-prevented status, whether an `aria-modal=true` surface is present, event focus context, and per-action availability/reason.

- [ ] **Step 4: Reuse existing action controllers and remove old key matching**

Move only dispatch ownership: retain `resolveSessionsShortcutAction`, contextual Chat/Preview search target selection, Preview tab cycling, and existing toggle/open callbacks. Remove `resolveWindowsWorkspaceShortcut` and the old dedicated layout, Quick Open/Preview tab, and search key matching effects so each event is handled once.

- [ ] **Step 5: Run router tests to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-search-routing.test.ts __tests__/web-chat-file-peek-viewer.test.ts`

Expected: PASS; tests cover Windows/Linux/macOS, inputs, composition, local `defaultPrevented`, modal pause, unavailable Preview-tab feedback, and single execution.

- [ ] **Step 6: Write failing hint-removal and dynamic-tooltip tests**

Update `ChatSessionGlobalBar.test.tsx` and `web-chat-recent-sessions-ui.test.ts` to require no shortcut prop/span/CSS. Add source or render assertions that current-session and Sessions search tooltips are formatted from the effective snapshot and omit the parenthetical binding when unbound.

- [ ] **Step 7: Run hint tests to verify RED**

Run: `npm test -- --runInBand web/src/chat/ChatSessionGlobalBar.test.tsx __tests__/web-chat-recent-sessions-ui.test.ts __tests__/web-keyboard-shortcuts.test.ts`

Expected: FAIL because the visible Ctrl+1 label and hard-coded Ctrl+F tooltip remain.

- [ ] **Step 8: Remove Ctrl+1 and make remaining shortcut hints dynamic**

Delete `showSlideOutShortcut`, the visible span, and its obsolete CSS. Use the shared formatter for existing search/Quick Open shortcut hints; when an action is `null`, render the plain action tooltip without a stale default binding.

- [ ] **Step 9: Handle responsive exit and unavailable feedback**

When layout becomes narrow while `settingsDetailView === 'keyboardShortcuts'`, return to Settings root. For matched unavailable actions, call the existing `setToastMessage` path with the registry availability reason and prevent browser fallback; do not create a second toast system.

- [ ] **Step 10: Run the complete shortcut integration regression set**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-search-routing.test.ts __tests__/web-chat-file-peek-viewer.test.ts __tests__/web-chat-recent-sessions-ui.test.ts web/src/chat/ChatSessionGlobalBar.test.tsx web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx __tests__/web-settings-navigation.test.ts __tests__/web-workspace-persistence-safety.test.ts`

Expected: PASS with no stale `Ctrl+1`, old shortcut resolver, or duplicate managed listener expectations.

- [ ] **Step 11: Git checkpoint**

Invoke `git-workflow` in checkpoint mode for Workspace integration, hint cleanup, and related tests. Record commit hash and subject.

### Task 5: Validate the complete feature and close documentation

**Files:**
- Modify: `docs/plans/2026-08-12-keyboard-shortcut-management/plan-keyboard-shortcut-management.md`
- Verify: all source, test, and wiki files owned by Tasks 1–4

**Acceptance:** Every spec acceptance item has passing evidence, the plan is fully checked, no server/protocol code changed, and Git is finalized according to the prepared preferences without touching unrelated main-worktree changes.

- [ ] **Step 1: Run all frontend tests**

Run: `npm test -- --runInBand`

Expected: PASS with zero failed suites/tests.

- [ ] **Step 2: Run type checking**

Run: `npm run tsc:web`

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 3: Run the production build**

Run: `npm run build:web`

Expected: PASS and output to the configured WheelMaker web build location, not `app/dist`.

- [ ] **Step 4: Review scope, accessibility, and diff boundaries**

Run: `git diff --check origin/main...HEAD` and `git diff --name-only origin/main...HEAD`.

Expected: PASS; changed source is confined to `app/`, approved scope/plan/wiki files, and no `server/` or protocol-version file appears. Manually inspect deep/light token usage, keyboard-only editor flow, `aria-live`, and reduced-motion CSS.

- [ ] **Step 5: Re-run targeted shortcut tests after any cleanup**

Run: `npm test -- --runInBand __tests__/web-keyboard-shortcuts.test.ts web/src/settings/KeyboardShortcutsSettingsDetail.test.tsx __tests__/web-workspace-persistence-safety.test.ts __tests__/web-settings-navigation.test.ts __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-search-routing.test.ts`

Expected: PASS.

- [ ] **Step 6: Complete plan and final wiki review**

Mark all verified plan checkboxes complete. Compare `keyboard-shortcuts.md` and `app-menu.md` against the implemented public behavior; if they already match, leave them unchanged. Any discovered mismatch in the approved behavior is a scope issue rather than an invitation to add a new wiki target.

- [ ] **Step 7: Final Git workflow**

Invoke `git-workflow` in finalize mode with the real result and verification evidence. Because the root `main` worktree has unrelated changes, do not merge or clean up unless it is clean at finalization; push and retain the feature branch/worktree otherwise.
