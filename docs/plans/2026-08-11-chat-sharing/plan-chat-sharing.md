# Chat Sharing Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use do-scoped to execute this plan task-by-task. Invoke git-workflow-preferences through prepare/checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate response image/HTML controls with one adaptive Share menu and support immutable response or full-session output as PNG, standalone HTML, or Public Share URL.

**Scope Source:** Approved spec `docs/scope/2026-08-11-chat-sharing.md`

**Architecture:** A pure chat-share projector converts raw Session turns into one frozen response/session document model. A shared React document renderer feeds PNG capture, standalone HTML serialization, and Public Share creation, while Registry schema 2 records distinguish project documents, chat responses, and chat sessions without changing the protocol version or breaking schema 1 records.

**Tech Stack:** React 19, TypeScript 5, Jest/react-test-renderer, React Markdown, html-to-image, Go Registry WebSocket/store, Markdown wiki.

**Verification:** Focused Jest and Go tests per task; final `npm test -- --runInBand`, `npm run tsc:web`, `npm run build:web`, and `go test ./...`.

---

### Task 1: Publish the approved chat-sharing knowledge

**Files:**
- Create: `docs/wiki/features/chat-sharing.md`
- Modify: `docs/wiki/features/features.md`
- Modify: `docs/wiki/features/public-sharing.md`

**Acceptance:** The feature wiki defines the six-action menu, frozen response/session content rules, shared PNG/HTML/URL renderer, platform delivery, image limits, and failure behavior; the Public Share wiki defines all three source types, schema compatibility, management labels, and unchanged anonymous/storage boundaries; the features index links the new page.

- [x] **Step 1: Write the chat-sharing wiki page**

Create `chat-sharing.md` with a first-line summary and sections for entry points, normalized content, shared rendering/output, platform delivery, and failure boundaries. Record the approved spec as the source without copying execution checklists.

- [x] **Step 2: Update the Public Share wiki**

Change the first-line summary and body from project-document-only wording to `project_document | chat_response | chat_session`, record schema 2 plus schema 1 compatibility, and keep the existing token, 16 MiB, expiry, Gateway, and anonymous access rules intact.

- [x] **Step 3: Update the feature index**

Add `chat-sharing.md` to `features.md` and update the `public-sharing.md` description so both pages are discoverable without overlapping ownership.

- [x] **Step 4: Validate wiki structure and scope**

Run:

```powershell
$files = @('docs/wiki/features/chat-sharing.md','docs/wiki/features/features.md','docs/wiki/features/public-sharing.md')
foreach ($file in $files) { if ((Get-Content -LiteralPath $file -TotalCount 1) -notmatch '^> 摘要：') { throw "$file missing summary" } }
rg -n "chat-sharing|chat_response|chat_session|16 MiB|schema 1|schema 2" docs/wiki/features
git diff --check
```

Expected: all three files start with summaries; the index link and stable compatibility/security terms are present; `git diff --check` passes.

- [x] **Step 5: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for only the three wiki files. Record the commit hash and subject, or the explicit reason no commit was created.

### Task 2: Extend Registry Public Share sources and schema compatibility

**Files:**
- Modify: `server/internal/registry/share_store_test.go`
- Modify: `server/internal/registry/share_test.go`
- Modify: `server/internal/registry/share_store.go`
- Modify: `server/internal/registry/share.go`

**Acceptance:** Registry accepts valid legacy project-document, chat-response, and chat-session creates; writes new records as schema 2; lists source context; rejects invalid/mixed source fields; and continues repairing, listing, expiring, serving, and deleting schema 1 project records.

- [x] **Step 1: Write failing store tests for schema 2 sources**

Extend `share_store_test.go` with table-driven tests that call `store.create` for:

```go
shareCreateInput{SourceType: "chat_response", ProjectID: "hub:p", SessionID: "sess-1", TurnIndex: 9, Title: "Answer", ...}
shareCreateInput{SourceType: "chat_session", ProjectID: "hub:p", SessionID: "sess-1", Title: "Session", ...}
```

Assert saved records use schema 2, preserve Session/turn fields, omit path/kind for chat, and survive `list`. Add invalid cases for missing Session ID, non-positive response turn, chat path/kind, project fields missing, and mixed source fields. Add a manually written schema 1 project record and assert `repair` preserves it and `list` projects it as `project_document`.

- [x] **Step 2: Run the store tests to verify RED**

Run:

```powershell
go test ./internal/registry -run 'TestShareStore(Schema2Sources|RejectsInvalidSourceCombinations|PreservesSchema1ProjectRecord)$' -count=1
```

Expected: FAIL because source discriminators, schema 2 fields, and legacy projection do not exist.

- [x] **Step 3: Implement schema 2 storage and validation**

In `share_store.go`, define source constants, keep an explicit legacy schema 1 constant, set the current writer schema to 2, add `SourceType`, `SessionID`, and `TurnIndex` to create inputs/records, and centralize validation so:

- missing `sourceType` normalizes to `project_document`;
- project documents require valid path/kind and forbid Session/turn fields;
- chat sessions require project/session/title and forbid path/kind/turn;
- chat responses additionally require a positive terminal turn index;
- schema 1 records validate under their legacy project path/kind rules and are normalized only in memory.

Keep token allocation, HTML decoding, atomic publication, expiry, cursor ordering, repair, and deletion unchanged.

- [x] **Step 4: Run the store tests to verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [x] **Step 5: Write failing WebSocket contract tests**

Extend `share_test.go` so a `chat_response` create without path/kind succeeds, `share.list` returns `sourceType`, `sessionId`, and `turnIndex`, a `chat_session` create succeeds without `turnIndex`, the old project payload still succeeds without `sourceType`, and strict decoding/validation rejects incompatible field combinations.

- [x] **Step 6: Run the WebSocket tests to verify RED**

Run:

```powershell
go test ./internal/registry -run 'TestShareRequests(ChatSources|LegacyProjectSource|RejectInvalidSourceFields)$' -count=1
```

Expected: FAIL because the request/response structs do not expose the new source fields.

- [x] **Step 7: Implement additive create/list fields**

Extend the flat structs and mapping in `share.go`; do not add methods or touch protocol version constants. Ensure list emits `sourceType: project_document` even for schema 1 records, while path/kind or Session/turn fields appear only for the applicable source.

- [x] **Step 8: Run Registry regressions**

Run:

```powershell
go test ./internal/registry -run 'TestShare' -count=1
go test ./internal/protocol -run 'TestRegistryShareMethodsAreClientOnly' -count=1
```

Expected: PASS with existing storage/config/delete tests unchanged and no Registry method/version changes.

- [x] **Step 9: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for the four Registry files after the focused tests pass.

### Task 3: Build the immutable chat-share projection

**Files:**
- Create: `app/web/src/chat/share/chatShareSnapshot.ts`
- Create: `app/__tests__/web-chat-share-snapshot.test.ts`
- Modify: `app/web/src/chat/chatCopyRange.ts`
- Modify: `app/__tests__/web-chat-copy-range.test.ts`

**Acceptance:** One pure projector produces frozen response/session models from raw turns, matches current response-copy semantics, excludes streaming/control content, preserves terminal failure labels, silently skips gaps/orphans, and reduces every user attachment to a name-only label.

- [x] **Step 1: Write failing projector tests**

Create `web-chat-share-snapshot.test.ts` with real `RegistryChatMessage` fixtures and assertions for:

- `buildResponseChatShareSnapshot` returning one Assistant entry with the same Markdown and turn range as `buildPromptDoneCopyRange`;
- `buildSessionChatShareSnapshot` pairing multiple `prompt_request`/`user_message_chunk` ranges with terminal `prompt_done` messages in order;
- omitting thought/tool/plan/permission/session-operation turns and a live unfinished tail;
- retaining partial Assistant text plus `failed`, `cancelled`, or `interrupted`, and retaining User plus status when Assistant text is empty;
- silently skipping `session/gap`, missing request/done pairs, and orphan messages;
- returning only `report.pdf`, `Image attachment`, and `File attachment` labels for resource/image blocks, with no `data` or `uri` field in the snapshot;
- copying title, ISO timestamp, source IDs, scope, theme/code presentation values, and response terminal turn into a detached immutable value.

- [x] **Step 2: Run projector tests to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-share-snapshot.test.ts
```

Workdir: `app`

Expected: FAIL because the projector module and APIs do not exist.

- [x] **Step 3: Extract shared response-range helpers**

Expose the existing parameter text extraction/range grouping needed by both copy and share without changing `buildPromptDoneCopyRange` output. Update its existing tests first if the extracted API changes imports, then keep all original assertions green.

- [x] **Step 4: Implement the minimal projector**

Define discriminated snapshot/entry/status/attachment types and the two builders. Sort cloned input, track only valid prompt-start-to-terminal ranges, use the current response Markdown builder for Assistant content, normalize only the three public terminal states, and copy all presentation values at construction time. Do not retain raw message/block references.

- [x] **Step 5: Run projector and copy tests to verify GREEN**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-share-snapshot.test.ts __tests__/web-chat-copy-range.test.ts
```

Workdir: `app`

Expected: PASS.

- [x] **Step 6: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for the projector and copy-range files after the focused tests pass.

### Task 4: Render one shared document and enforce PNG safety limits

**Files:**
- Create: `app/web/src/chat/share/ChatShareDocument.tsx`
- Create: `app/web/src/chat/share/chatShareDocumentStyle.ts`
- Create: `app/web/src/chat/share/ChatShareCaptureSurface.tsx`
- Create: `app/__tests__/web-chat-share-document.test.tsx`
- Modify: `app/web/src/chat/export/chatMarkdownImageExport.ts`
- Modify: `app/web/src/chat/export/markdownHtmlExport.ts`
- Modify: `app/web/src/chat/export/markdownHtmlExportSurface.ts`
- Modify: `app/__tests__/web-chat-markdown-image-export.test.ts`
- Modify: `app/__tests__/web-markdown-html-export.test.tsx`

**Acceptance:** The same role-aware DOM produces session PNG and standalone HTML/Public Share content; response rendering remains visually compatible; serialized output contains title/time/roles/status/attachment labels but no app chrome or pending markers; PNG preflight selects the highest safe `1..2x` ratio or returns a deterministic too-large failure before capture.

- [x] **Step 1: Write failing document renderer tests**

Create `web-chat-share-document.test.tsx` that renders response and session snapshot fixtures. Assert response uses the existing standalone Markdown body, session renders one header plus ordered User/Assistant sections, terminal status badges and attachment labels, and no raw attachment payload. Serialize the surface and assert the standalone HTML includes the exact same semantic text/classes, conversation CSS, escaped title, and no `data-markdown-export-pending` attributes.

- [x] **Step 2: Write failing image preflight tests**

Extend `web-chat-markdown-image-export.test.ts` for a pure `resolveMarkdownImageCapture` helper:

```ts
expect(resolveMarkdownImageCapture({width: 800, height: 4_000, preferredPixelRatio: 2})).toEqual({ok: true, pixelRatio: 2});
expect(resolveMarkdownImageCapture({width: 800, height: 8_000, preferredPixelRatio: 2})).toEqual({ok: true, pixelRatio: 1});
expect(resolveMarkdownImageCapture({width: 800, height: 20_000, preferredPixelRatio: 2})).toEqual({ok: false, reason: 'too_large'});
```

Also assert `renderMarkdownElementToPngBlob` rejects with the user-facing HTML/URL alternative before calling `html-to-image` when no safe ratio exists.

- [x] **Step 3: Run renderer/preflight tests to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-share-document.test.tsx __tests__/web-chat-markdown-image-export.test.ts __tests__/web-markdown-html-export.test.tsx
```

Workdir: `app`

Expected: FAIL because the document renderer, serializer support, and size preflight are missing.

- [x] **Step 4: Implement shared document rendering**

Build `ChatShareDocument` around the existing Markdown renderer primitives and image resolver contract. Keep Markdown sanitization in the existing React pipeline; render roles, metadata, statuses, and attachment names as React nodes. Add conversation-specific standalone styles to the existing export page builder via an explicit optional style/body-class input rather than unescaped HTML concatenation.

- [x] **Step 5: Implement the capture surface**

`ChatShareCaptureSurface` accepts one frozen snapshot, render mode (`image | html`), width mode, and callbacks. It waits for Markdown capabilities/images, returns either a single Blob or standalone HTML plus dependency warnings, and never invokes platform output itself. Response and session formats both traverse this component.

- [x] **Step 6: Implement deterministic PNG preflight**

Add constants `16_384` max dimension and `16_000_000` max pixels. Measure the laid-out element, test candidate ratios from the clamped preferred ratio down to `1`, pass the selected ratio to `html-to-image`, and throw a typed/user-facing too-large error without truncating or capturing when all candidates fail.

- [x] **Step 7: Run renderer/preflight tests to verify GREEN**

Run the Step 3 command.

Expected: PASS, including all existing Markdown HTML/image readiness tests.

- [x] **Step 8: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for only the renderer/export files after focused tests pass.

### Task 5: Extend Web Share contracts and management UI

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/shares/ShareManager.tsx`
- Modify: `app/web/src/shares/shareSnapshot.ts`
- Modify: `app/__tests__/web-registry-share-contract.test.ts`
- Modify: `app/__tests__/web-share-ui.test.tsx`
- Modify: `app/__tests__/web-share-snapshot.test.ts`

**Acceptance:** TypeScript models and repository parsing represent all three source types; ShareManager accepts frozen chat sources, emits the exact additive payload, keeps project capture behavior, describes scope/session in the dialog and list, and retains disabled-server, warning, pagination, copy, and stop behavior.

- [x] **Step 1: Write failing wire and repository assertions**

Extend `web-registry-share-contract.test.ts` with valid typed payload fixtures for all source variants and mocked list envelopes. Assert missing `sourceType` parses as `project_document`, chat records retain Session/turn context without fake paths/kinds, and malformed source combinations are dropped rather than coerced to project Markdown.

- [x] **Step 2: Write failing ShareManager chat-source tests**

Extend `web-share-ui.test.tsx` with a frozen `chat_response` source and assert the dialog shows `Current response · <session title>`, `captureSnapshot` receives the same frozen source after later fixture mutation, and `createShare` receives `sourceType`, `projectId`, `sessionId`, `turnIndex` without `path`/`kind`. Add a `chat_session` management record and assert its row says `Full session · <session title>` while copy/stop still use the token/url.

- [x] **Step 3: Run Web share tests to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-registry-share-contract.test.ts __tests__/web-share-ui.test.tsx __tests__/web-share-snapshot.test.ts
```

Workdir: `app`

Expected: FAIL because Web source unions, parsing, payload mapping, and labels are project-file-only.

- [x] **Step 4: Implement source unions and strict parsing**

Define `RegistryShareSourceType` and discriminated create/record types. Keep project payload compatibility with omitted `sourceType`; require explicit source type for chat. Update repository parsing to validate applicable fields and ignore invalid records instead of fabricating path/kind values.

- [x] **Step 5: Implement ShareManager source mapping**

Make `ShareManagerSource` a project/chat union. Project sources continue resolving file snapshots through `captureSnapshot`; chat sources carry the frozen chat model and resolve through the same callback only when the user confirms. Map source metadata into create payloads, replace `source.path` UI assumptions with a source description helper, and show source-aware list metadata.

- [x] **Step 6: Run Web share tests to verify GREEN**

Run the Step 3 command.

Expected: PASS with all existing file-share modal, warning, pagination, disabled-server, clipboard, and stop tests unchanged.

- [x] **Step 7: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for the Web share contract/manager files after focused tests pass.

### Task 6: Replace response export buttons with the adaptive Share menu

**Files:**
- Create: `app/web/src/chat/share/ChatShareMenu.tsx`
- Create: `app/web/src/chat/share/ChatShareMenu.test.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/ChatTurnView.test.tsx`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/web/src/styles/sessionlist.css`

**Acceptance:** A completed response exposes Copy plus one Share trigger; the menu directly renders two labeled groups and six actions; Desktop uses a fixed anchored popover, narrow mode uses the shared bottom-sheet overlay; disabled/busy states, outside/scroll/Escape close, arrow-key navigation, focus restoration, and callbacks are covered.

- [ ] **Step 1: Write failing menu component tests**

Create `ChatShareMenu.test.tsx` and assert:

- the trigger has `aria-label="Share response or session"`, `aria-haspopup="menu"`, and correct expanded state;
- wide mode renders `Current response` and `Full session` groups with Image, HTML file, Public URL actions and invokes `{scope, format}` directly;
- sheet mode renders an overlay, title/close affordance, and the same actions;
- per-scope disabled states leave the other group usable;
- Escape closes and restores trigger focus; ArrowUp/ArrowDown/Home/End reuse shared keyboard semantics; scroll/resize/outside pointer close the popover.

- [ ] **Step 2: Write failing ChatTurnView action assertions**

Extend `ChatTurnView.test.tsx` to render `prompt_done` with Share callbacks. Assert Copy remains, camera/fileCode buttons are gone, one share icon trigger appears, non-share actions remain, and choosing a menu item forwards the clicked terminal turn plus action to the caller.

- [ ] **Step 3: Run menu/view tests to verify RED**

Run:

```powershell
npm test -- --runInBand web/src/chat/share/ChatShareMenu.test.tsx web/src/chat/ChatTurnView.test.tsx
```

Workdir: `app`

Expected: FAIL because the menu and consolidated action API do not exist.

- [ ] **Step 4: Implement the adaptive menu**

Use a body portal so virtualization/clipping cannot cut off the surface. In wide mode compute a viewport-clamped fixed position from the trigger rect; in narrow mode render the existing sheet overlay and bottom-sheet presentation. Reuse `menuKeyboardNavigation` and the current menu motion classes; keep local open state ephemeral and close on scroll/resize.

- [ ] **Step 5: Consolidate ChatTurnView props and controls**

Replace `onExportPromptDoneImage`/`onExportPromptDoneHtml` and their busy flags with one typed `onSharePromptDone(action)` plus response/session availability and `shareMenuMode`. Preserve Copy, read aloud, Fork, retry, duration, artifacts, and terminal status rendering.

- [ ] **Step 6: Add menu styles and rerun tests**

Add only Share-specific sizing/group/label styles while reusing current popover/sheet materials and reduced-motion contracts. Run the Step 3 command.

Expected: PASS.

- [ ] **Step 7: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for the menu, ChatTurnView, and style files after tests pass.

### Task 7: Orchestrate all six actions in WorkspaceApp

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-response-image-output.test.ts`
- Modify: `app/__tests__/web-markdown-html-output.test.ts`
- Modify: `app/__tests__/web-share-ui.test.tsx`

**Acceptance:** Clicking any action freezes the chosen response/session snapshot once; PNG and HTML use the shared capture surface and existing output adapters; HTML retains editable names; URL opens ShareManager with the frozen source; output busy/error/toast states are accurate; Android reservations remain in the direct image/HTML click chain; archived/read-only loaded sessions retain sharing.

- [ ] **Step 1: Write failing Workspace wiring assertions**

Extend `web-chat-ui.test.ts` with source/behavior assertions that Workspace:

- builds one frozen snapshot from `selectedFullChatMessages` and selected Session metadata when a typed menu action fires;
- uses the clicked `doneTurnIndex` only for response scope and the latest terminal ranges for session scope;
- reserves Android image authorization in the menu click and HTML authorization in the filename dialog's explicit Export click, before each asynchronous capture state;
- routes both scopes through `ChatShareCaptureSurface` and the existing `outputResponseImage` / `outputMarkdownHtml` adapters;
- opens `ShareManager` with chat source metadata and the already frozen model for URL;
- no longer wires separate image/HTML props into `ChatTurnView`.

Extend `web-share-ui.test.tsx` with a state test that mutating Session-like fixture data after opening the URL dialog does not change the HTML passed to create.

- [ ] **Step 2: Run Workspace/share tests to verify RED**

Run:

```powershell
npm test -- --runInBand __tests__/web-chat-ui.test.ts __tests__/web-share-ui.test.tsx __tests__/web-response-image-output.test.ts __tests__/web-markdown-html-output.test.ts
```

Workdir: `app`

Expected: FAIL because Workspace still owns separate Markdown-only image/HTML flows and file-only Public Share sources.

- [ ] **Step 3: Replace export request state with chat-share requests**

In `WorkspaceApp.tsx`, introduce one capture request union keyed by scope/format and one frozen-source helper that captures title, time, project/session IDs, terminal turn, raw-turn projection, and presentation settings. Keep project-document Public Share capture state separate. Remove the old response-only hidden image surface after all callers move to the shared surface.

- [ ] **Step 4: Implement image and HTML actions**

For Image, reserve Android authorization in the menu callback, render/capture one PNG, then use `outputResponseImage`; show copied/shared/downloaded toast text and the prescribed too-large alternative. For HTML, open the existing editable name dialog with response/session defaults, keep the content snapshot frozen from the menu selection, reserve Android authorization in the dialog's explicit Export callback, serialize the frozen model, then use `outputMarkdownHtml`.

- [ ] **Step 5: Implement Public URL actions**

Create `chat_response` or `chat_session` `ShareManagerSource` from the frozen model. `captureShareSource` renders that exact model into standalone HTML and returns warnings without re-reading Session state. Keep project Markdown/HTML file capture behavior unchanged.

- [ ] **Step 6: Wire availability and adaptive mode**

For each `prompt_done`, derive response availability from the existing copy range and session availability from the full projector. Pass `desktop` when `isWide`, otherwise `sheet`; disable a scope while its output is active without blocking the other scope unless the shared renderer is occupied. Ensure archived/read-only messages use the same loaded raw store path.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run the Step 2 command plus:

```powershell
npm test -- --runInBand __tests__/web-chat-share-snapshot.test.ts __tests__/web-chat-share-document.test.tsx web/src/chat/share/ChatShareMenu.test.tsx web/src/chat/ChatTurnView.test.tsx
```

Workdir: `app`

Expected: PASS.

- [ ] **Step 8: Run TypeScript validation**

Run:

```powershell
npm run tsc:web
```

Workdir: `app`

Expected: PASS with discriminated share sources and capture request states fully narrowed.

- [ ] **Step 9: Git checkpoint**

Invoke `git-workflow-preferences` in `checkpoint` mode for Workspace/App dialog/output test files after focused tests and type checking pass.

### Task 8: Prove the complete approved contract

**Files:**
- Modify if implementation facts require clarification: `docs/wiki/features/chat-sharing.md`
- Modify if implementation facts require clarification: `docs/wiki/features/public-sharing.md`
- Modify: `docs/plans/2026-08-11-chat-sharing/plan-chat-sharing.md`

**Acceptance:** Every spec acceptance item has passing automated evidence; documentation matches implemented stable behavior; all plan boxes are accurate; the final diff contains only chat-sharing-owned changes.

- [ ] **Step 1: Run the full App test suite**

Run:

```powershell
npm test -- --runInBand
```

Workdir: `app`

Expected: PASS with no Jest failures.

- [ ] **Step 2: Run App type checking and production build**

Run:

```powershell
npm run tsc:web
npm run build:web
```

Workdir: `app`

Expected: both commands PASS; the Web build writes only to the configured release output and does not add `app/dist` artifacts.

- [ ] **Step 3: Run the complete Server suite**

Run:

```powershell
go test ./...
```

Workdir: `server`

Expected: PASS.

- [ ] **Step 4: Audit contract and wiki alignment**

Map each acceptance bullet in `docs/scope/2026-08-11-chat-sharing.md` to its focused/full validation result. Re-read only the two confirmed wiki knowledge pages and correct any statement contradicted by the implementation; update `features.md` only if the page index changed.

- [ ] **Step 5: Audit the final diff**

Run:

```powershell
git status -sb
git diff --check
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: no whitespace errors, no generated `dist` content, and no files from the dirty main worktree's pre-existing file-highlight changes.

- [ ] **Step 6: Final Git checkpoint and finalize**

Invoke `git-workflow-preferences` in `checkpoint` mode for any final plan/wiki corrections after their validation. Then invoke it in `finalize` mode with the actual result (`complete`, `blocked`, or `verification_failed`), recording branch/worktree, commits, push, merge, and cleanup outcomes.
