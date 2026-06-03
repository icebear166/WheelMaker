# Session Archive Recover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project-scoped session older folding, one-shot serial archive actions, and true archive read/restore across server protocol and Workspace UI.

**Architecture:** WheelMaker archive manifest remains the source of truth. The server adds project-scoped `session.archive.list`, `session.archive.read`, and `session.archive.restore` on top of the existing WMSA/WMT2 archive store, with Codex App native archive/unarchive as best-effort agent capability sync. The frontend keeps ordinary session navigation, search, and archived recovery as separate UI modes so read-only archive preview does not mutate normal selected-chat state.

**Tech Stack:** Go server (`internal/hub/client`, `internal/hub/agent`, `internal/protocol`, `internal/registry`), React/TypeScript app (`app/web/src/main.tsx`, repository/service/types), Jest, Go tests, webpack web build.

---

## File Structure

- Modify `server/internal/protocol/registry_methods.go`: add registry descriptors for `session.archive.list`, `session.archive.read`, and `session.archive.restore`.
- Modify `server/internal/registry/server_test.go`: prove new methods route through the existing project session forwarding path.
- Modify `server/internal/hub/client/session_archive.go`: add manifest optional fields, list/read/restore helpers, WMSA segment validation, gzip decode, and WMT2 archive payload decode.
- Modify `server/internal/hub/client/client.go`: add request handlers and `ArchiveSession` response warning path, call restore helpers, and keep `session.delete` as WheelMaker hard delete.
- Modify `server/internal/hub/client/session_recovery.go`: include archived un-restored session ids in managed ids.
- Modify `server/internal/hub/client/client_test.go`: extend existing archive/delete/recovery tests.
- Modify `server/internal/hub/agent/instance.go`: add an optional archive capability boundary implemented by the concrete instance.
- Modify `server/internal/hub/agent/codexapp_agent.go`: map native archive/unarchive to Codex App `thread/archive` and `thread/unarchive`.
- Modify `server/internal/hub/agent/codexapp_convert.go`: make WheelMaker-owned attachment cleanup provider-neutral.
- Modify `server/internal/hub/agent/agent_test.go`: add Codex App native archive/unarchive and provider-neutral cleanup tests.
- Create `app/web/src/chat/sessionArchiveState.ts`: pure helpers for older folding, sessionStorage state, batch candidates, serial progress state, and archive sections.
- Modify `app/web/src/types/registry.ts`: add archived summary/read/restore response types.
- Modify `app/web/src/services/registryRepository.ts`: add protocol calls and response normalization for archive list/read/restore, include archive warning on single archive.
- Modify `app/web/src/services/registryWorkspaceService.ts`: expose project-scoped archive list/read/restore methods.
- Modify `app/web/src/main.tsx`: add Archive menu, batch archive progress, Archived mode, read-only preview, restore confirmation, and older folding in desktop/mobile session lists.
- Create or modify app tests under `app/__tests__/`: pure helper tests, service tests, and UI source tests.
- Modify `docs/session-management-and-sync.zh-CN.md`: document archive list/read/restore and restore semantics.
- Modify `docs/codex-app-server-acp-bridge.zh-CN.md`: document Codex App `thread/archive` and `thread/unarchive` mapping.

## Task 1: Server Protocol Constants And Forwarding

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/registry/server_test.go`

- [x] **Step 1: Write failing forwarding tests**

Add table entries in the existing session forwarding test in `server/internal/registry/server_test.go` for:

```go
[]string{
	"session.archive.list",
	"session.archive.read",
	"session.archive.restore",
}
```

Each entry sends a project-scoped request with `projectId: "proj1"` and asserts the forwarded method equals the original method.

- [x] **Step 2: Verify RED**

Run:

```powershell
Set-Location server
go test ./internal/registry -run TestServerForwardsSessionRequestsToProjectHub -count=1
```

Expected: failure because the methods are not registered.

- [x] **Step 3: Add registry descriptors**

Add constants:

```go
RegistryMethodSessionArchiveList    = "session.archive.list"
RegistryMethodSessionArchiveRead    = "session.archive.read"
RegistryMethodSessionArchiveRestore = "session.archive.restore"
```

Add descriptors using:

```go
registryProjectMethod(RegistryMethodSessionArchiveList, RegistryRouteSessionForward)
registryProjectMethod(RegistryMethodSessionArchiveRead, RegistryRouteSessionForward)
registryProjectMethod(RegistryMethodSessionArchiveRestore, RegistryRouteSessionForward)
```

- [x] **Step 4: Verify GREEN**

Run the same registry test and confirm exit code 0.

- [x] **Step 5: Commit**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/registry/server_test.go
git commit -m "feat: register session archive recovery methods"
```

## Task 2: Archive Store List/Read/Restore Helpers

**Files:**
- Modify: `server/internal/hub/client/session_archive.go`
- Modify: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing store tests through client archive setup**

Extend existing archive tests in `client_test.go` with these test names:

```go
func TestSessionArchiveStoreListSessionsExcludesRestoredAndSorts(t *testing.T)
func TestSessionArchiveStoreReadSessionValidatesPackAndReturnsTurns(t *testing.T)
func TestSessionArchiveStoreReadSessionRejectsHashMismatch(t *testing.T)
func TestSessionArchiveStoreMarkRestoredHidesEntryFromList(t *testing.T)
```

The tests create long sessions with `latestPersistedTurnIndex >= 3`, archive them through the current path, then call the new archive store helpers directly.

- [x] **Step 2: Verify RED**

Run:

```powershell
Set-Location server
go test ./internal/hub/client -run "SessionArchiveStore(List|Read|Mark)" -count=1
```

Expected: compile failure because helpers and manifest fields are missing.

- [x] **Step 3: Add manifest fields and list helper**

Extend `sessionArchiveManifestEntry`:

```go
RestoredAt         string `json:"restoredAt,omitempty"`
NativeArchivedAt   string `json:"nativeArchivedAt,omitempty"`
NativeUnarchivedAt string `json:"nativeUnarchivedAt,omitempty"`
NativeSyncWarning  string `json:"nativeSyncWarning,omitempty"`
```

Add:

```go
func (s *sessionArchiveStore) ListSessions(ctx context.Context, projectName string) ([]sessionArchiveManifestEntry, error)
```

Return only entries with empty `RestoredAt`, sorted by `UpdatedAt` desc, then `ArchivedAt` desc, then `SessionID` asc.

- [x] **Step 4: Add WMSA/WMT2 read helper**

Add:

```go
func (s *sessionArchiveStore) ReadSession(ctx context.Context, projectName, sessionID string) (sessionArchiveManifestEntry, []string, error)
```

The helper reads `archive.pack` at `Offset:Length`, checks magic `WMSA`, version 1, gzip codec, embedded session id, compressed length, uncompressed length, segment SHA-256, uncompressed SHA-256, gzip decode, WMT2 magic/version/chunk metadata, and returns ordered turn content strings.

- [x] **Step 5: Add restore marker and native sync metadata helpers**

Add:

```go
type sessionArchiveNativeSyncUpdate struct {
	NativeArchivedAt   string
	NativeUnarchivedAt string
	NativeSyncWarning  string
}

func (s *sessionArchiveStore) MarkRestored(ctx context.Context, projectName, sessionID, restoredAt string, nativeUpdate sessionArchiveNativeSyncUpdate) (sessionArchiveManifestEntry, error)
func (s *sessionArchiveStore) UpdateNativeSync(ctx context.Context, projectName, sessionID string, update sessionArchiveNativeSyncUpdate) error
```

Both helpers rewrite the manifest atomically with existing `writeManifestLocked`.

- [x] **Step 6: Verify GREEN**

Run the Task 2 client tests and confirm exit code 0.

- [x] **Step 7: Commit**

```powershell
git add server/internal/hub/client/session_archive.go server/internal/hub/client/client_test.go
git commit -m "feat: add archive store read helpers"
```

## Task 3: Server Archive List/Read/Restore Protocols

**Files:**
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`

- [x] **Step 1: Write failing protocol tests**

Add these tests to `client_test.go`:

```go
func TestHandleSessionRequestSessionArchiveListReturnsArchivedSessions(t *testing.T)
func TestHandleSessionRequestSessionArchiveReadReturnsReadOnlyTurns(t *testing.T)
func TestHandleSessionRequestSessionArchiveReadRejectsRestoredSession(t *testing.T)
func TestHandleSessionRequestSessionArchiveRestoreRecreatesSessionAndTurns(t *testing.T)
func TestHandleSessionRequestSessionArchiveRestoreRejectsExistingSession(t *testing.T)
func TestHandleSessionRequestSessionArchiveRestoreRejectsAlreadyRestored(t *testing.T)
```

Assert exact response shapes:

```go
map[string]any{"sessions": []any{...}}
map[string]any{"sessionId": "sess-archive", "readOnly": true, "latestTurnIndex": float64(3)}
map[string]any{"ok": true, "sessionId": "sess-archive", "session": map[string]any{...}}
```

- [x] **Step 2: Verify RED**

Run:

```powershell
Set-Location server
go test ./internal/hub/client -run "SessionArchive(List|Read|Restore)" -count=1
```

Expected: unsupported session method failures.

- [x] **Step 3: Add request handlers**

Add cases in `HandleSessionRequest`:

```go
case acp.RegistryMethodSessionArchiveList:
	return c.ListArchivedSessions(ctx)
case acp.RegistryMethodSessionArchiveRead:
	return c.ReadArchivedSession(ctx, req.SessionID)
case acp.RegistryMethodSessionArchiveRestore:
	return c.RestoreArchivedSession(ctx, req.SessionID)
```

Each request validates `sessionId` for read/restore.

- [x] **Step 4: Implement list/read response conversion**

Add helpers:

```go
func (c *Client) ListArchivedSessions(ctx context.Context) (map[string]any, error)
func (c *Client) ReadArchivedSession(ctx context.Context, sessionID string) (map[string]any, error)
func archiveSummaryFromEntry(entry sessionArchiveManifestEntry) map[string]any
func archiveTurnsFromContents(contents []string) []sessionViewTurn
```

`ReadArchivedSession` returns `messages: []` only if the existing frontend type requires it, and always returns `readOnly: true`.

- [x] **Step 5: Implement restore**

Add:

```go
func (c *Client) RestoreArchivedSession(ctx context.Context, sessionID string) (map[string]any, error)
```

Flow:

1. Read and validate archive payload.
2. Reject when `store.LoadSession` finds the id.
3. Delete any partial turn data for the target id before writing.
4. Use `WriteSessionTurnFiles(ctx, c.sessionRecorder.turnStore.root, c.projectName, sessionID, 1, contents)`.
5. Save `SessionRecord` with `Status: SessionPersisted`, `AgentType`, `Title`, `CreatedAt`, `LastActiveAt`, and `SessionSyncJSON: sessionSyncJSON(int64(len(contents)))`.
6. Call native unarchive helper and keep warning string.
7. Mark manifest restored with current UTC timestamp and native warning.
8. Return restored `sessionViewSummary`.

- [x] **Step 6: Verify GREEN**

Run the Task 3 client tests and confirm exit code 0.

- [x] **Step 7: Commit**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat: restore archived sessions"
```

## Task 4: Native Sync, Resume Exclusion, And Provider-Neutral Cleanup

**Files:**
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing native sync and cleanup tests**

Add tests:

```go
func TestCodexAppArchiveSessionCallsThreadArchive(t *testing.T)
func TestCodexAppUnarchiveSessionCallsThreadUnarchive(t *testing.T)
func TestCleanupSessionArtifactsRemovesAttachmentsForAnyAgent(t *testing.T)
func TestSessionResumeListExcludesArchivedUnrestoredSessions(t *testing.T)
func TestArchiveSessionNativeWarningDoesNotRollbackWheelMakerArchive(t *testing.T)
```

The Codex App tests use the existing fake transport pattern in `agent_test.go` and assert outgoing methods `thread/archive` and `thread/unarchive` with `threadId`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
Set-Location server
go test ./internal/hub/agent -run "CodexApp.*Archive|CleanupSessionArtifacts" -count=1
go test ./internal/hub/client -run "ResumeListExcludesArchived|NativeWarning" -count=1
```

Expected: missing capability methods and old cleanup behavior.

- [ ] **Step 3: Add optional agent capability**

Add in `instance.go`:

```go
type SessionArchiver interface {
	ArchiveSession(ctx context.Context, sessionID string) error
	UnarchiveSession(ctx context.Context, sessionID string) error
}
```

Implement these methods on `*instance`; they delegate to the underlying conn when the conn implements `SessionArchiver`, otherwise return `ErrSessionArchiveUnsupported`.

- [ ] **Step 4: Add Codex App native methods**

Add to `codexappConn`:

```go
func (c *codexappConn) ArchiveSession(ctx context.Context, sessionID string) error
func (c *codexappConn) UnarchiveSession(ctx context.Context, sessionID string) error
```

Each resolves `threadID := firstNonEmptyString(codexappMappedThreadID(sessionID), c.runtimeThreadIDForSession(sessionID), sessionID)` and calls `c.runtime.request(ctx, "thread/archive", appServerThreadArchiveParams{ThreadID: threadID}, &ignored)` or `thread/unarchive`.

- [ ] **Step 5: Add client best-effort native sync**

Add helper in `client.go`:

```go
func (c *Client) syncNativeArchiveState(ctx context.Context, agentType, sessionID string, archived bool) string
```

It creates a short-lived agent instance through the existing agent creator, initializes it with the project CWD, calls `ArchiveSession` or `UnarchiveSession` when supported, closes it, and returns a warning string on failure. Unsupported capability returns empty warning.

- [ ] **Step 6: Wire native sync to archive/restore**

`ArchiveSession` stores native archive metadata after `AppendSession` succeeds and before `deleteActiveSession`. `RestoreArchivedSession` stores native unarchive metadata after the normal session row and turn files are recreated.

- [ ] **Step 7: Extend managed session ids**

Update `managedSessionIDs` so it adds every archive manifest entry with empty `RestoredAt`.

- [ ] **Step 8: Make cleanup provider-neutral**

Replace the `agentType == codex` branch with cleanup of:

```text
<artifactRoot>/db/session/<projectName>/<sessionId>/attachments
```

for all agent types. Keep removal scoped to that attachments directory.

- [ ] **Step 9: Verify GREEN**

Run the Task 4 test commands and confirm exit code 0.

- [ ] **Step 10: Commit**

```powershell
git add server/internal/hub/agent server/internal/hub/client
git commit -m "feat: sync native archive state"
```

## Task 5: Frontend Archive State Helpers

**Files:**
- Create: `app/web/src/chat/sessionArchiveState.ts`
- Create: `app/__tests__/web-session-archive-state.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Create tests for:

```ts
splitOlderProjectSessions({sessions, nowMs, olderThanDays: 5, expanded: false})
readOlderSessionsExpanded(storage)
writeOlderSessionsExpanded(storage, state)
collectArchiveCandidates({projects, sessionsByProjectId, nowMs, olderThanDays})
buildArchivedSessionSections({projects, archivedByProjectId})
nextArchiveBatchProgress(previous, result)
```

Assertions cover: two older sessions collapse behind `hiddenOlderCount`, one older session remains visible, invalid `updatedAt` excluded from candidates, running sessions excluded, hidden projects included when they are present in `projects`, and storage invalid JSON returns `{}`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
Set-Location app
npm test -- web-session-archive-state.test.ts --runInBand
```

Expected: module not found.

- [ ] **Step 3: Implement helper module**

Export constants:

```ts
export const OLDER_SESSION_DAYS = 5;
export const OLDER_SESSIONS_EXPANDED_KEY = 'wheelmaker.chat.olderSessionsExpanded.v1';
```

Export functions and types named in Step 1. Use `parseUpdatedAtMs` from `../sessionTime` and compute age with `nowMs - updatedAtMs > days * 24 * 60 * 60 * 1000`.

- [ ] **Step 4: Verify GREEN**

Run the Task 5 test command and confirm exit code 0.

- [ ] **Step 5: Commit**

```powershell
git add app/web/src/chat/sessionArchiveState.ts app/__tests__/web-session-archive-state.test.ts
git commit -m "feat: add session archive state helpers"
```

## Task 6: Frontend Archive Protocol Types And Services

**Files:**
- Modify: `app/web/src/types/registry.ts`
- Modify: `app/web/src/services/registryRepository.ts`
- Modify: `app/web/src/services/registryWorkspaceService.ts`
- Modify: existing service tests or create `app/__tests__/web-session-archive-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests asserting repository methods send:

```ts
{method: 'session.archive.list', projectId}
{method: 'session.archive.read', projectId, payload: {sessionId}}
{method: 'session.archive.restore', projectId, payload: {sessionId}}
```

and workspace service delegates project id correctly.

- [ ] **Step 2: Verify RED**

Run:

```powershell
Set-Location app
npm test -- web-session-archive-service.test.ts --runInBand
```

Expected: missing methods or type errors.

- [ ] **Step 3: Add registry types**

Add:

```ts
export interface RegistryArchivedSessionSummary extends RegistrySessionSummary {
  archivedAt: string;
  restoredAt?: string;
  turnCount: number;
  gapCount: number;
  nativeArchivedAt?: string;
  nativeUnarchivedAt?: string;
  nativeSyncWarning?: string;
}

export interface RegistrySessionArchiveReadResponse {
  sessionId: string;
  session: RegistryArchivedSessionSummary;
  turns: RegistrySessionTurn[];
  messages: RegistrySessionMessage[];
  latestTurnIndex: number;
  readOnly: true;
}

export interface RegistrySessionArchiveRestoreResponse {
  ok: boolean;
  sessionId: string;
  session: RegistrySessionSummary;
  warning?: string;
}
```

- [ ] **Step 4: Add repository and service methods**

Add repository methods:

```ts
listArchivedSessions(projectId: string): Promise<RegistryArchivedSessionSummary[]>
readArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveReadResponse>
restoreArchivedSession(projectId: string, sessionId: string): Promise<RegistrySessionArchiveRestoreResponse>
```

Add workspace methods:

```ts
listProjectArchivedSessions(projectId: string)
readProjectArchivedSession(projectId: string, sessionId: string)
restoreProjectArchivedSession(projectId: string, sessionId: string)
```

- [ ] **Step 5: Verify GREEN**

Run the Task 6 service test command and confirm exit code 0.

- [ ] **Step 6: Commit**

```powershell
git add app/web/src/types/registry.ts app/web/src/services/registryRepository.ts app/web/src/services/registryWorkspaceService.ts app/__tests__
git commit -m "feat: add archive recovery service calls"
```

## Task 7: Frontend UI Integration

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: existing UI tests or create `app/__tests__/web-session-archive-ui.test.ts`

- [ ] **Step 1: Write failing UI source tests**

Add tests asserting the source contains:

```ts
renderChatArchiveControls(false)
renderChatArchiveControls(true)
sessionArchiveMenuOpen
archiveBatchProgress
archivedMode
renderArchivedSessionRows
readProjectArchivedSession
restoreProjectArchivedSession
splitOlderProjectSessions
Show ${hiddenOlderCount} older
```

Also assert Archive controls appear before search controls in both desktop and mobile header snippets.

- [ ] **Step 2: Verify RED**

Run:

```powershell
Set-Location app
npm test -- web-session-archive-ui.test.ts --runInBand
```

Expected: missing source markers.

- [ ] **Step 3: Add UI state**

Add state in `main.tsx` near search state:

```ts
const [olderSessionsExpandedByProjectId, setOlderSessionsExpandedByProjectId] = useState<Record<string, boolean>>(...)
const [sessionArchiveMenuOpen, setSessionArchiveMenuOpen] = useState(false);
const [archiveBatchProgress, setArchiveBatchProgress] = useState<ArchiveBatchProgress | null>(null);
const [archivedMode, setArchivedMode] = useState(false);
const [archivedByProjectId, setArchivedByProjectId] = useState<Record<string, RegistryArchivedSessionSummary[]>>({});
const [selectedArchivedKey, setSelectedArchivedKey] = useState<{projectId: string; sessionId: string} | null>(null);
const [archivedPreview, setArchivedPreview] = useState<RegistrySessionArchiveReadResponse | null>(null);
const [archivedError, setArchivedError] = useState('');
```

- [ ] **Step 4: Add archive menu and batch flow**

Add `renderChatArchiveControls(mobile: boolean)`, `requestArchiveOlderSessions(days)`, and `runArchiveBatch(candidates)`.

`runArchiveBatch` must use a `for...of` loop with `await service.archiveProjectSession(candidate.project.projectId, candidate.session.sessionId)` and must not use `Promise.all`.

- [ ] **Step 5: Add Archived mode flow**

Add `enterArchivedMode`, `exitArchivedMode`, `loadArchivedSessionPreview`, `requestRestoreArchivedSession`, and `confirmRestoreArchivedSession`.

`enterArchivedMode` calls archive list sequentially across all known projects and clears search state. `loadArchivedSessionPreview` populates only archived preview state. Restore success exits archived mode, refreshes target project sessions, selects the restored normal session, and clears read-only preview.

- [ ] **Step 6: Add older folding to session rows**

In desktop and mobile session list rendering, call `splitOlderProjectSessions` per Project. Render visible recent rows first, then either the collapsed button or older rows. The collapsed button uses `Show ${hiddenOlderCount} older`; expanded state renders `Show less`.

- [ ] **Step 7: Render read-only preview**

When `archivedMode && archivedPreview`, route the right chat body to archived preview turns and hide or disable composer actions. Do not call mark-read, durable selected-chat persistence, prompt send, attachment upload, or cancel for archived preview.

- [ ] **Step 8: Verify GREEN**

Run the Task 7 UI source test and a TypeScript check:

```powershell
Set-Location app
npm test -- web-session-archive-ui.test.ts --runInBand
npm run tsc:web
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit**

```powershell
git add app/web/src/main.tsx app/__tests__
git commit -m "feat: add archive recovery UI"
```

## Task 8: Documentation And Full Verification

**Files:**
- Modify: `docs/session-management-and-sync.zh-CN.md`
- Modify: `docs/codex-app-server-acp-bridge.zh-CN.md`
- Modify: plan checklist statuses in this file

- [ ] **Step 1: Update docs**

Document `session.archive.list`, `session.archive.read`, `session.archive.restore`, `restoredAt`, native sync warning behavior, serial frontend batch archive, and Codex App `thread/archive` / `thread/unarchive`.

- [ ] **Step 2: Run targeted server verification**

```powershell
Set-Location server
go test ./internal/hub/client -run "SessionArchive|ArchiveSession|ResumeListExcludesArchived|NativeWarning" -count=1
go test ./internal/hub/agent -run "CodexApp.*Archive|CleanupSessionArtifacts" -count=1
go test ./internal/registry -run "Session.*Archive|Forward" -count=1
```

- [ ] **Step 3: Run targeted frontend verification**

```powershell
Set-Location app
npm test -- web-session-archive-state.test.ts web-session-archive-service.test.ts web-session-archive-ui.test.ts --runInBand
npm run tsc:web
```

- [ ] **Step 4: Run full verification**

```powershell
Set-Location server
go test ./...
Set-Location ..\app
npm run build:web
```

- [ ] **Step 5: Commit docs and checklist**

```powershell
git add docs/session-management-and-sync.zh-CN.md docs/codex-app-server-acp-bridge.zh-CN.md docs/superpowers/plans/2026-06-03-session-archive-recover-implementation.md
git commit -m "docs: document archive recovery"
```

- [ ] **Step 6: Completion gate**

From repo root:

```powershell
git add -A
git commit -m "feat: add session archive recovery"
git push origin main
```

If the final commit has no staged changes because earlier task commits already captured all work, record the no-op commit result and still run `git push origin main`.
