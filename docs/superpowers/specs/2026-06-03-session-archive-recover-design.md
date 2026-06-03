# Session Archive, Recover, And Older Session Folding Design

Date: 2026-06-03

## Goal

Improve chat session navigation and archive management across all projects:

1. Fold older sessions in each Project by default.
2. Add an Archive menu next to the session search control.
3. Let users batch archive old sessions without adding a server-side bulk archive protocol.
4. Add a real Recover flow for archived sessions, including read-only preview and confirmed restore.
5. Keep WheelMaker archive state authoritative while optionally syncing native Codex App archive state.

## Existing Context

The current `session.archive` protocol is project-scoped and removes a non-running normal session from the regular chat list. Long sessions are written to `~/.wheelmaker/db/session-archive/<projectName>/archive.pack` and indexed by `manifest.json`; short sessions are deleted without an archive record. Existing archive v1 explicitly does not provide archive list, read, or restore APIs.

`session.delete` is a hard WheelMaker delete. It removes the normal session record and local session data. It does not write to the archive store.

The app already has project-scoped session search in the chat session navigation. Search mode is separate from the normal Project/session list.

ACP currently exposes session lifecycle methods such as `session/new`, `session/load`, `session/list`, `session/prompt`, and `session/cancel`. It does not expose a standard archive, unarchive, restore, or delete session method.

The installed Codex App Server schema from `codex-cli 0.133.0` includes native `thread/archive` and `thread/unarchive` requests, with `thread/archived` and `thread/unarchived` notifications. The current WheelMaker Codex App adapter does not yet expose these methods. The schema does not expose a `thread/delete` request.

## Non-Goals

- Do not add `session.archive.bulk`.
- Do not add a persistent automatic archive policy or background scheduler.
- Do not add fuzzy matching or archive search.
- Do not make archived preview writable.
- Do not delete native agent histories from `.codex`, `.claude`, `.copilot`, or other provider stores.
- Do not expose `codexapp` as a public agent identity. `codexapp*` names may remain internal bridge implementation names.

## Confirmed Product Decisions

- Age checks use session `updatedAt`, meaning last active time.
- A session is older than N days only when `now - updatedAt > N * 24h`.
- Invalid or missing `updatedAt` is excluded from older folding and automatic batch archive candidates.
- Older folding threshold is 5 days.
- Batch archive options are one-shot actions for sessions older than 7 days or 14 days.
- Batch archive runs from the frontend by serially calling existing single-session `session.archive`.
- Batch archive covers all known Projects, including Projects hidden in the Chat UI.
- Batch archive is not limited by current Project expansion, `Show older`, search state, or visible rows.
- Batch archive skips running sessions when building candidates; server errors remain the final truth during execution.
- Batch archive requires a confirmation after candidate counting and before execution.
- Batch archive is fully serial, not concurrent.
- Recover is a real restore into the normal session list.
- Recover mode reuses the chat session navigation area instead of a separate modal list.
- Clicking an archived session previews it read-only on the right.
- The selected archived row shows a Restore action.
- Restore requires a confirmation dialog.
- Restore success exits Archived mode, refreshes the target Project session list, and opens the restored normal session.
- Search mode and Archived mode are mutually exclusive.
- Archive button is placed to the left of the search button and is hidden while search is expanded or active.
- Older folding expansion state is stored per Project in `sessionStorage`, so reload in the same tab can preserve it while an app/window restart may reset it.

## Frontend Behavior

### Older Session Folding

For each Project in the normal chat session list:

1. Split sessions by `updatedAt`.
2. Recent sessions are those where `now - updatedAt <= 5 * 24h`.
3. Older sessions are those where `now - updatedAt > 5 * 24h`.
4. If older session count is greater than 1, hide all older sessions by default and render a `Show N older` row.
5. If older session count is 0 or 1, render all sessions normally.
6. When the user clicks `Show N older`, render the older sessions and a `Show less` row for that Project.

The expansion key is project-scoped and stored in `sessionStorage`, for example:

```text
wheelmaker.chat.olderSessionsExpanded.v1
```

The stored value is a JSON object keyed by project id. Invalid JSON or unknown keys are ignored. The state only affects normal session list rendering. It does not affect search results, Archived mode, batch archive candidates, or hidden Project inclusion.

### Archive Menu

Render an Archive icon button with `codicon-archive` next to the existing session search control:

- Desktop: in the chat sidebar title actions, to the left of search.
- Mobile: in the mobile chat toolbar, to the left of search.
- Hide the Archive button while search is expanded or an active search is present.

Clicking the Archive button opens a compact menu with:

1. `Archive > 7 days`
2. `Archive > 14 days`
3. `Recover...`

Opening `Recover...` exits search mode if needed and enters Archived mode.

### Batch Archive Flow

When the user selects `Archive > N days`:

1. Build candidates from the latest frontend `projectSessionsByProjectId` across all known Projects.
2. Include sessions where:
   - `updatedAt` parses successfully;
   - `now - updatedAt > N * 24h`;
   - `running` is not true.
3. Include hidden Projects and collapsed Projects.
4. Ignore `Show older` state.
5. If no candidates exist, show a lightweight notice such as `No sessions older than 7 days`.
6. If candidates exist, show a confirmation dialog with count and Project count.
7. On confirmation, execute serially:
   - call `service.archiveProjectSession(projectId, sessionId)`;
   - update progress after each result;
   - remove successful sessions from local normal session state;
   - record failures and continue.

The progress UI should show at least:

- total candidate count;
- completed count;
- current session title or Project title;
- archived count;
- failed count.

The final result should show:

```text
Archived X, failed Y
```

If failures exist, show rows with Project name, session title or id, and the error message. Running errors that still occur from the server are treated as per-session failures or skipped rows in the summary; they must not stop the remaining serial run.

### Archived Mode

Archived mode replaces the normal session navigation body. It keeps the same overall chat shell.

Entry:

- User clicks Archive menu `Recover...`.
- UI fan-outs `session.archive.list` to all known Projects, including Projects hidden in the Chat UI.
- Ordinary session search is exited.

Header:

- Shows `Archived`.
- Shows a `Cancel` button.
- `Cancel` exits Archived mode, clears archived selection and preview, and restores the normal session list.

List:

- Group archived records by Project.
- Render Project ordering consistent with the normal Project list.
- Render session rows with title, agent tag, original updated time, and archived time.
- Records with non-empty `restoredAt` are not shown by default because `session.archive.list` filters them out.

Selecting an archived row:

1. Calls `session.archive.read` for that Project and session id.
2. Loads the returned turns/messages into the right chat content area.
3. Marks the selected archived row as selected.
4. Shows a `Restore` action as a floating or inline action on the selected row.
5. Puts the chat content area in read-only mode.

Read-only preview:

- Composer is hidden or disabled.
- Sending, canceling, config updates, attachment upload, and voice input are unavailable.
- Preview does not update normal selected chat persistence.
- Preview does not update read cursors.
- Preview does not write the ordinary chat durable cache as if this were an active normal session.

Restore:

1. User clicks `Restore` on the selected archived row.
2. UI opens a confirmation dialog:

```text
Restore this archived session to the active chat list?
```

3. On confirmation, call `session.archive.restore`.
4. On success:
   - exit Archived mode;
   - refresh the target Project session list;
   - select and open the restored normal session;
   - restore normal composer behavior.
5. On failure:
   - remain in Archived mode;
   - keep the preview visible;
   - show row-level or dialog-level error text.

## Server Protocol

All new methods remain project-scoped and route through the existing `session.*` Registry forwarding model.

### `session.archive.list`

Request payload:

```ts
type SessionArchiveListRequest = {};
```

Response payload:

```ts
type SessionArchiveListResponse = {
  sessions: SessionArchiveSummary[];
};

type SessionArchiveSummary = {
  sessionId: string;
  projectName: string;
  title?: string;
  agentType?: string;
  createdAt?: string;
  updatedAt?: string;
  archivedAt: string;
  restoredAt?: string;
  turnCount: number;
  gapCount: number;
  nativeArchivedAt?: string;
  nativeUnarchivedAt?: string;
  nativeSyncWarning?: string;
};
```

Behavior:

- Read the Project archive manifest.
- Return only records without `restoredAt`.
- Sort by `updatedAt` descending, falling back to `archivedAt` descending, then `sessionId`.
- Missing archive store or manifest returns an empty list.
- Corrupt manifest returns a clear project-level error.

### `session.archive.read`

Request payload:

```ts
type SessionArchiveReadRequest = {
  sessionId: string;
};
```

Response payload should mirror enough of `session.read` for the existing chat renderer:

```ts
type SessionArchiveReadResponse = {
  sessionId: string;
  session: SessionArchiveSummary;
  turns: RegistrySessionTurn[];
  messages: RegistrySessionMessage[];
  latestTurnIndex: number;
  readOnly: true;
};
```

Behavior:

- Validate `sessionId`.
- Look up the manifest entry.
- Reject missing or restored entries with a clear error.
- Read the WMSA segment from `archive.pack` using `offset` and `length`.
- Verify segment header, session id, codec, compressed length, uncompressed length, and SHA-256 fields.
- Decompress gzip payload.
- Parse WMT2 turns.
- Convert turn contents using the same read path or parser used by normal `session.read` so the frontend renderer receives familiar data.
- Return archive gap turns as readable gap entries; do not drop them.
- Do not recreate a normal session.
- Do not update read cursors or normal session sync.

### `session.archive.restore`

Request payload:

```ts
type SessionArchiveRestoreRequest = {
  sessionId: string;
};
```

Response payload:

```ts
type SessionArchiveRestoreResponse = {
  ok: boolean;
  sessionId: string;
  session: RegistrySessionSummary;
  warning?: string;
};
```

Behavior:

1. Validate `sessionId`.
2. Load the archive manifest entry.
3. Reject if `restoredAt` is already set.
4. Reject if a normal session with the same id already exists, unless a future implementation explicitly chooses idempotent restore.
5. Read and verify archive payload exactly as `session.archive.read` does.
6. Recreate ordinary session turn files from the WMT2 payload.
7. Recreate the `sessions` table row with:
   - `ID = sessionId`;
   - `ProjectName = current project`;
   - `Status = SessionPersisted`;
   - `AgentType = entry.AgentType`;
   - `Title = entry.Title`;
   - `CreatedAt = entry.CreatedAt` when present, otherwise `entry.ArchivedAt`;
   - `LastActiveAt = entry.UpdatedAt` when present, otherwise `entry.ArchivedAt`;
   - `SessionSyncJSON.latestPersistedTurnIndex = turnCount`.
8. Best-effort native unarchive for agents that support it.
9. Mark manifest entry `restoredAt = now` and record native sync metadata.
10. Return the restored session summary and any native sync warning.

Restore must be careful about ordering. The normal session row and turn files should not be left half-created if WMSA verification or turn decode fails. Native unarchive failure does not roll back the WheelMaker restore. If manifest marking fails after the normal session has been restored, the error should be reported clearly so a retry or repair can resolve the inconsistent state.

### Existing `session.archive`

The existing single-session `session.archive` remains the only archive execution method.

Changes:

- After WheelMaker archive store append succeeds and before or after active session removal, perform best-effort native archive for agents that support it.
- Native archive failure must not roll back the WheelMaker archive.
- The response may include `warning`.
- The archive manifest should record native sync metadata:
  - `nativeArchivedAt` when successful;
  - `nativeSyncWarning` when failed.

Short sessions with `latestPersistedTurnIndex < 3` continue to be deleted without writing archive pack or manifest. Native archive for such sessions is not required because there is no WheelMaker archive record to recover.

### Existing `session.delete`

`session.delete` remains WheelMaker hard delete:

- no archive pack write;
- no manifest tombstone;
- no native Codex delete because no `thread/delete` method is available in the checked Codex App schema;
- unified WheelMaker artifact cleanup still applies.

## Archive Manifest Extension

Manifest version can remain backward-compatible if the new fields are optional.

Add optional fields to each session entry:

```go
RestoredAt          string `json:"restoredAt,omitempty"`
NativeArchivedAt    string `json:"nativeArchivedAt,omitempty"`
NativeUnarchivedAt  string `json:"nativeUnarchivedAt,omitempty"`
NativeSyncWarning   string `json:"nativeSyncWarning,omitempty"`
```

Existing v1 entries without these fields remain valid.

`restoredAt` is the source of truth for whether a record appears in Recover mode.

## Archive Store Read/Restore Internals

Extend `sessionArchiveStore` with read-oriented helpers:

- `ListSessions(ctx, projectName) ([]sessionArchiveManifestEntry, error)`
- `ReadSession(ctx, projectName, sessionID) (entry, contents, error)`
- `MarkRestored(ctx, projectName, sessionID, restoredAt, nativeWarning) (entry, error)`
- `UpdateNativeSync(ctx, projectName, sessionID, fields) error`

The WMSA read path should:

1. open `archive.pack`;
2. read `offset:length`;
3. validate magic `WMSA`;
4. validate segment version and codec;
5. validate embedded session id;
6. validate compressed and uncompressed lengths;
7. validate SHA-256 hashes where manifest values are present;
8. decompress gzip;
9. parse WMT2 payload into turn content strings.

The restore path should write ordinary turn files through existing session turn store primitives where possible, instead of hand-encoding independent WMT2 variants. If a direct writer helper is missing, add one close to the existing turn store boundary so archive restore does not duplicate low-level file format logic.

## Agent Native Archive Sync

### Boundary

Do not let `client.Client` call Codex App runtime internals directly. The native sync boundary belongs in the agent layer.

Add a small optional interface, for example:

```go
type SessionArchiver interface {
  ArchiveSession(ctx context.Context, sessionID string) error
  UnarchiveSession(ctx context.Context, sessionID string) error
}
```

`agent.Instance` can expose this by direct methods, or `client.Client` can type-assert an optional capability on the runtime instance. The implementation plan should choose the approach that best matches local `agent.Instance` patterns.

### Codex App

`codexappConn` implements native sync by calling:

- `thread/archive` with `{threadId}`
- `thread/unarchive` with `{threadId}`

Thread id resolution must follow existing ACP session id to runtime thread id mapping:

- archive and unarchive should resolve the ACP session id to the runtime thread id when a mapping exists;
- if no mapping exists, use the ACP session id directly.

Native sync should not start a new thread. If the underlying Codex App thread is missing, return a warning and leave WheelMaker state authoritative.

### Other Agents

Other agents do not implement native archive sync. Unsupported native sync is not a user-visible error.

## Resume Filtering Risk

Currently native resume scans exclude ordinary managed session ids from `sessions`. After archive, a session no longer exists in `sessions`, while native provider history may still exist. Without a guard, an archived native session could reappear under `Resume session`.

Fix:

- Extend managed id calculation for `session.resume.list` to include archive manifest records with empty `restoredAt`.
- This prevents archived sessions from being imported through native Resume.
- Recover mode remains the only way to restore WheelMaker archived sessions.

The filter is based on WheelMaker archive manifest, not native Codex archive state.

## Unified Artifact Cleanup

WheelMaker-owned session artifacts should be cleaned uniformly for all agents.

Current cleanup only runs attachment cleanup for `agentType == codex`. This is too provider-specific for a WheelMaker-owned path. Replace it with a provider-neutral cleanup that removes:

```text
~/.wheelmaker/db/session/<projectName>/<sessionId>/attachments
```

or the equivalent configured artifact root.

The cleanup must not delete native provider histories. It only removes WheelMaker-created transient artifacts, such as uploaded or converted local attachments.

## Error Handling

Batch archive:

- A failed per-session `session.archive` call records the error and continues.
- The final summary must include failures.
- The frontend should not pretend native sync warnings are hard failures.

Native sync:

- Native archive/unarchive failure returns or records `warning`.
- WheelMaker archive/restore remains successful when the WheelMaker source of truth was updated correctly.
- UI shows warnings in batch summaries or restore result details.

Archive read:

- Corrupt WMSA segment, checksum mismatch, missing pack file, gzip failure, or WMT2 decode failure returns an explicit error.
- Read failure does not mark a record restored.

Restore:

- Missing archive entry returns `session archive not found`.
- Already restored entry returns `session archive already restored`.
- Normal session id collision returns `session already exists`.
- Native unarchive warning does not fail restore.

## Testing

### Server Tests

- `session.archive.list` returns only un-restored entries.
- `session.archive.list` sorts records stably.
- `session.archive.read` reads WMSA/gzip/WMT2 and returns data compatible with normal chat rendering.
- `session.archive.read` rejects restored entries.
- `session.archive.read` surfaces pack corruption and hash mismatch.
- `session.archive.restore` recreates session row and ordinary turn files.
- `session.archive.restore` sets `SessionSyncJSON.latestPersistedTurnIndex`.
- `session.archive.restore` marks `restoredAt`.
- Restore followed by `session.list` shows the session.
- Restore followed by `session.read` shows the restored history.
- Restore of an already restored entry returns a clear error.
- `session.resume.list` excludes archived but not restored session ids.
- Unified artifact cleanup runs for non-codex agent types too.
- Codex App native archive calls `thread/archive`.
- Codex App native unarchive calls `thread/unarchive`.
- Native sync errors are returned as warnings and do not roll back WheelMaker archive/restore.
- `session.delete` does not call any native thread delete.

### Frontend Tests

- Older sessions older than 5 days collapse only when count is greater than 1.
- A single older session remains visible.
- `Show N older` expands and `Show less` collapses.
- Per-Project older expansion state round-trips through `sessionStorage`.
- Archive button appears to the left of search.
- Archive button hides while search is open or active.
- Batch archive candidate calculation includes hidden Projects and ignores UI folding.
- Batch archive excludes missing/invalid `updatedAt` and running sessions.
- Batch archive confirms before execution.
- Batch archive calls `archiveProjectSession` serially.
- Batch archive progress increments after each session.
- Batch archive failure continues to the next candidate.
- `Recover...` enters Archived mode and fan-outs archive list calls.
- `Cancel` exits Archived mode.
- Clicking an archived row calls `session.archive.read`.
- Archived preview renders read-only and disables composer actions.
- Selected archived row shows Restore.
- Restore opens confirmation before calling `session.archive.restore`.
- Restore success exits Archived mode, refreshes sessions, and selects the restored session.
- Restore failure stays in Archived mode and displays an error.

## Documentation Updates

Update `docs/session-management-and-sync.zh-CN.md` after implementation to replace the v1 note that archive has no list/read/restore API.

Update `docs/codex-app-server-acp-bridge.zh-CN.md` after implementation to document `thread/archive` and `thread/unarchive` mapping.

## Open Implementation Notes

These are implementation choices, not unresolved product requirements:

- Whether optional native archive support is added directly to `agent.Instance` or via a smaller optional interface asserted by `client.Client`.
- Whether `session.archive.read` reuses the exact `session.read` conversion path directly or introduces a shared helper for archived and normal turn content.
- Whether read-only archived preview uses a separate in-memory store or a flagged branch in existing selected chat state.

The product behavior is fixed by this design; these choices should be resolved in the implementation plan based on the smallest clean change to the current codebase.
