# Lazy Cross-Session Search Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Sessions search into an explicitly submitted, progressively populated filter that reuses the normal session list and hands result navigation to the existing in-session search.

**Scope Source:** `docs/scope/2026-08-12-lazy-cross-session-search.md`

**Architecture:** Keep the existing per-project Registry `session.search` start/query/cancel task protocol. The web app freezes a submitted query and project scope, polls cumulative session identities, and filters the shared `SessionListView`; the Hub scans sessions with a bounded worker pool and stops each session at the first title or searchable-turn hit. Selecting a result uses the normal session load path, then opens the existing local chat search with the submitted query.

**Tech Stack:** React 19, TypeScript, Jest/react-test-renderer, Go, Registry project-scoped requests, WMT2 session turn store.

**Verification:** Focused Jest and Go race tests per task; final `go test ./...`, `npm test -- --runInBand`, `npm run tsc:web`, and `npm run build:web`.

---

### Task 1: Document the stable lazy-search contract

**Files:**
- Modify: `docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md`
- Modify: `docs/wiki/architecture/session-management-and-sync.md`

**Acceptance:** The confirmed UI workflow and Hub scan/poll/cancel ownership are documented without copying implementation checklists into the wiki.

- [x] **Step 1: Read both confirmed wiki targets and locate their existing search/session-read sections**

Run: `rg -n "search|Search|session.read|Turn|轮询" docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/architecture/session-management-and-sync.md`

Expected: Existing sidebar/search and session storage sections are identified without opening unrelated wiki pages.

- [x] **Step 2: Update the sidebar interaction contract**

Record explicit submit, All/one visible Project scope, normal Project/Session list reuse, read-only search actions, progressive filtering, partial-failure feedback, and the post-load handoff to current-session search. Explicitly state that cross-session results do not show match counts, source, turn, snippet, or title highlight.

- [x] **Step 3: Update the session management architecture contract**

Record per-project task ownership, one scan per submit, memory-only query polling, bounded per-project session concurrency, first-hit short-circuit, cancellation/searchId isolation, strict searchable turn methods, and the absence of a persistent index or protocol-version change.

- [x] **Step 4: Verify wiki scope and formatting**

Run: `git diff --check -- docs/wiki/frontend-interaction/pc-chat-sidebar-modes.md docs/wiki/architecture/session-management-and-sync.md`

Expected: PASS with only the two approved wiki targets changed in this task.

- [x] **Step 5: Git checkpoint** — `407f36b5 docs(wiki): define lazy session search`

Invoke `git-workflow` checkpoint for the two wiki files after Step 4 passes; record commit hash and subject.

### Task 2: Make cross-session search an explicit shared-list filter

**Files:**
- Modify: `app/web/src/chat/session/sessionSearchState.ts`
- Modify: `app/web/src/chat/sessionlist/SessionListView.tsx`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.tsx`
- Modify: `app/web/src/chat/sessionlist/SessionRow.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-session-search-state.test.ts`
- Modify: `app/__tests__/web-session-search-ui.test.ts`
- Modify: `app/web/src/chat/sessionlist/ProjectSection.test.tsx`
- Create: `app/web/src/chat/sessionlist/SessionListView.test.tsx`

**Acceptance:** Typing and scope changes are draft-only; search button and Enter submit the same frozen query/scope, cancel and clear the prior run, then progressively filter the ordinary ProjectSection/SessionRow list while exposing no management actions or match metadata.

- [x] **Step 1: Write failing state-helper tests**

Replace metadata/title-highlight/debounce expectations with tests that:

```ts
expect(resolveSessionSearchProjects(projects, '')).toEqual(projects);
expect(resolveSessionSearchProjects(projects, 'p2')).toEqual([projects[1]]);
expect(buildSessionSearchFilter(...).sessionsByProjectId.p1.map(item => item.sessionId))
  .toEqual(['s2', 's1']);
```

Also assert duplicate and out-of-order Registry results produce one row per session in the original project/session order and do not require `source` or `turnIndex` for UI decisions.

- [x] **Step 2: Write failing shared component tests**

Add `SessionListView.test.tsx` and extend `ProjectSection.test.tsx` to render `mode="search"`. Assert matching rows use `SessionRow`, Project collapse remains clickable, and no Recent/Draft/older toggle/empty-project management row, project actions, unpin button, or context-menu gesture attributes are present.

- [x] **Step 3: Run the state and component tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-session-search-state.test.ts web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx`

Expected: FAIL because the filter helpers and read-only shared list mode do not yet exist.

- [x] **Step 4: Implement minimal state helpers and shared list mode**

Replace `formatSessionSearchResultMeta`, `splitSessionSearchTitleHighlight`, and the debounce constant with identity-based helpers. Remove the dedicated search-result slot/renderer. Make search mode traverse the same `ProjectSection` and `SessionRow` path with filtered projects/sessions, while optional gesture/action props enforce the read-only capability boundary.

- [x] **Step 5: Run the state and component tests to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-session-search-state.test.ts web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx`

Expected: PASS.

- [x] **Step 6: Write failing Workspace wiring assertions**

Update `web-session-search-ui.test.ts` to require a scope select with All Projects default, an explicit submit button, Enter calling the same submit handler, committed project snapshots for start/query/cancel, progressive identity merging, shared `SessionListView` search data, compact Searching/No matches/partial failure states, and absence of debounce, active-result navigation, source/turn rendering, title highlight, result count, and `renderSessionSearchRow`.

- [x] **Step 7: Run the Workspace wiring test to verify RED**

Run: `npm test -- --runInBand __tests__/web-session-search-ui.test.ts`

Expected: FAIL against the current debounced dedicated-result implementation.

- [x] **Step 8: Implement explicit submit, project scope, and progressive shared-list wiring**

In `WorkspaceApp`, keep draft input/scope separate from committed query/project snapshots. Submit only on button/Enter, cancel the previous snapshot, synchronously clear old results, start only selected visible projects, and make polling/cancel use the committed snapshot rather than live visible-project state. Remove active result indexes and direct turn targeting. Feed filtered project/session collections into `SessionListView` and add only compact pending/empty/partial-failure status text. Adjust search-control CSS without changing the overall sidebar layout.

- [x] **Step 9: Run focused frontend regression checks**

Run: `npm test -- --runInBand __tests__/web-session-search-state.test.ts __tests__/web-session-search-ui.test.ts __tests__/web-session-search-service.test.ts __tests__/web-chat-search-routing.test.ts web/src/chat/sessionlist/ProjectSection.test.tsx web/src/chat/sessionlist/SessionListView.test.tsx`

Expected: PASS.

- [x] **Step 10: Git checkpoint** — `8340def6 feat(search): filter shared session list`

Invoke `git-workflow` checkpoint for Task 2 files after Step 9 passes; record commit hash and subject.

### Task 3: Hand a selected result to local chat search after loading

**Files:**
- Modify: `app/web/src/chat/search/useChatSearchController.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-search-controller.test.ts`
- Modify: `app/__tests__/web-session-search-ui.test.ts`

**Acceptance:** Selecting any filtered session preserves the cross-session sidebar, loads through the normal session path without a server turn target, and opens current-session search with the committed query only if that target remains selected; a title-only result naturally produces zero local matches.

- [x] **Step 1: Write failing controller and handoff tests**

Add a controller-level helper test for a programmatic open request carrying `sourceKey + query + generation`, including stale-target rejection. Update Workspace wiring assertions to require a pending handoff keyed by project/session/query and to forbid reading `result.source` or `result.turnIndex` in the click path.

- [x] **Step 2: Run handoff tests to verify RED**

Run: `npm test -- --runInBand __tests__/web-chat-search-controller.test.ts __tests__/web-session-search-ui.test.ts`

Expected: FAIL because programmatic local-search handoff is not implemented.

- [x] **Step 3: Implement the minimal one-shot handoff**

Extend the chat search controller with a programmatic open-with-query entry that preserves existing manual `Ctrl/Cmd+F` behavior. On result click, record `projectId + sessionId + committed query + generation`, await normal `selectProjectChatSession`, verify the loaded selection/generation, then open local search and consume the handoff. Clear stale requests on a newer click, load failure, close, or source mismatch.

- [x] **Step 4: Run handoff and chat-search regressions to verify GREEN**

Run: `npm test -- --runInBand __tests__/web-chat-search-controller.test.ts __tests__/web-chat-search-state.test.ts __tests__/web-session-search-ui.test.ts`

Expected: PASS, including existing match counts/highlights/navigation semantics.

- [ ] **Step 5: Git checkpoint**

Invoke `git-workflow` checkpoint for Task 3 files after Step 4 passes; record commit hash and subject.

### Task 4: Bound Hub scanning and align searchable content

**Files:**
- Modify: `server/internal/hub/client/session_search.go`
- Modify: `server/internal/hub/client/client_test.go`

**Acceptance:** Each project search uses a fixed-size worker pool, emits each matching session once at its first title/searchable-turn hit, stops promptly on cancellation, and ignores every non-user/non-visible-agent turn method while preserving response compatibility.

- [ ] **Step 1: Write failing searchable-content table tests**

Extend existing `client_test.go` tests so `prompt_request`, `user_message_chunk`, and `agent_message_chunk` can match, while `agent_thought_chunk`, tool calls, plans, system, prompt_done/status text, and unknown generic payload fields cannot.

- [ ] **Step 2: Write failing concurrency, deduplication, short-circuit, and cancellation tests**

Exercise an extracted bounded runner with an instrumented callback. Assert active workers never exceed the configured limit, one session identity is appended at most once, a title hit does not scan turns, the first matching turn stops further reads for that session, and cancellation prevents queued work from starting.

- [ ] **Step 3: Run focused Go tests to verify RED**

Run: `go test ./internal/hub/client -run 'Test.*SessionSearch' -race`

Expected: FAIL because current project scanning is serial and visible-text extraction includes excluded methods/fallbacks.

- [ ] **Step 4: Implement the bounded first-hit scanner**

Add a fixed worker limit for one project task, cancellation-aware job dispatch, locked result identity deduplication, and completion after all workers exit. Preserve existing start/query/cancel JSON shapes and `source`/`turnIndex` compatibility fields. Replace generic visible-text fallback with explicit user/visible-agent extraction only; retain newest-first turn-store short-circuiting.

- [ ] **Step 5: Run focused Go tests to verify GREEN**

Run: `go test ./internal/hub/client -run 'Test.*SessionSearch' -race`

Expected: PASS.

- [ ] **Step 6: Run adjacent Hub protocol regressions**

Run: `go test ./internal/hub/... -race`

Expected: PASS.

- [ ] **Step 7: Git checkpoint**

Invoke `git-workflow` checkpoint for Task 4 files after Step 6 passes; record commit hash and subject.

### Task 5: Complete compatibility and release-gate verification

**Files:**
- Modify: `docs/plans/2026-08-12-lazy-cross-session-search/plan-lazy-cross-session-search.md`
- Modify only if a failing acceptance test identifies an in-scope defect: files already owned by Tasks 1-4

**Acceptance:** Every spec acceptance item has passing evidence, no protocol version changed, and the feature branch is ready for Git finalize.

- [ ] **Step 1: Verify no obsolete cross-session UI remains**

Run: `rg -n "SESSION_SEARCH_DEBOUNCE_MS|formatSessionSearchResultMeta|splitSessionSearchTitleHighlight|renderSessionSearchRow|navigateSessionSearchResult|sessionSearchTargetTurn" app/web/src app/__tests__`

Expected: No obsolete implementation references remain; any intentional negative-test strings are clearly scoped.

- [ ] **Step 2: Run the complete Go suite**

Run: `go test ./...`

Working directory: `server`

Expected: PASS.

- [ ] **Step 3: Run the complete web test suite**

Run: `npm test -- --runInBand`

Working directory: `app`

Expected: PASS.

- [ ] **Step 4: Run TypeScript and production build checks**

Run: `npm run tsc:web && npm run build:web`

Working directory: `app`

Expected: PASS; build output goes to the configured WheelMaker web output, not `app/dist`.

- [ ] **Step 5: Inspect final diff and protocol compatibility**

Run: `git diff --check && git status -sb && git diff --stat && git diff -- server/internal/protocol app/web/src/registry/registryMethods.ts`

Expected: No whitespace errors, no unowned files, and no Registry method or protocol-version change.

- [ ] **Step 6: Complete the plan and Git lifecycle**

Mark all verified plan steps complete, checkpoint the updated plan if needed, then invoke `git-workflow` finalize with the real result and verification evidence.
