# Prompt Diff Artifacts Design

## Goal

Show the files changed by a completed Codex prompt and let the user open the full diff from the done separator.

The feature turns provider-specific diff events into one WheelMaker session artifact per completed prompt. The app shows a Git-style file list with status and line counts, while the full unified diff is loaded only when the user opens it.

## Scope

- Capture Codex App Server `turn/diff/updated` notifications as the primary diff source.
- Bind the latest diff for the app-server `turnId` to the corresponding WheelMaker `prompt_done`.
- Store exactly one diff artifact per prompt when a non-empty diff exists.
- Keep `prompt_done` lightweight by storing only artifact metadata.
- Add an artifact read path for loading the full unified diff on demand.
- Show the artifact under `prompt_done` as a changed-files list.
- Opening the artifact shows the full diff; selecting a file may scroll to that file's diff section.
- Keep existing `item/fileChange/patchUpdated` handling for tool-call progress and fallback.

## Non-Goals

- No natural-language file summaries.
- No per-hunk metadata.
- No exposed `sha256`, byte length, or truncation metadata in the UI protocol.
- No separate artifact per file.
- No Codex `turnId` or `itemId` exposure to the frontend protocol.
- No requirement for non-Codex ACP providers to emit Codex App Server events.
- No first version Git snapshot fallback for providers that do not report diffs.

## Verified Codex App Server Behavior

Codex App Server emits diff data as server-initiated JSON-RPC notifications after `turn/start`.

Important events:

- `turn/diff/updated`: `{ threadId, turnId, diff }`
- `item/fileChange/patchUpdated`: `{ threadId, turnId, itemId, changes: [{ path, kind, diff }] }`
- `item/completed`: final item state, including `fileChange` status.
- `turn/completed`: terminal turn state, without diff body.

The current Codex CLI schema (`codex-cli 0.133.0`) defines `TurnDiffUpdatedNotification` as `{ threadId: string, turnId: string, diff: string }`. A live debug run confirmed the server emits a unified diff body through `turn/diff/updated`; `turn/completed` arrived later and did not carry the diff.

OpenAI Codex App Server docs describe `turn/diff/updated` as the latest aggregated unified diff across every file change in the turn, and recommend using `fileChange` items and `turn/diff/updated` instead of the deprecated `item/fileChange/outputDelta`.

## Artifact Metadata

`prompt_done.param.artifacts` contains a lightweight summary:

```json
[
  {
    "artifactId": "diff-000123",
    "type": "diff",
    "format": "unified-diff",
    "fileCount": 3,
    "files": [
      {
        "path": "app/web/src/app/WorkspaceApp.tsx",
        "status": "M",
        "additions": 42,
        "deletions": 8
      },
      {
        "path": "server/internal/hub/agent/codexapp_agent.go",
        "status": "M",
        "additions": 31,
        "deletions": 2
      },
      {
        "path": "server/internal/hub/client/session_artifacts.go",
        "status": "A",
        "additions": 88,
        "deletions": 0
      }
    ]
  }
]
```

Rules:

- `artifactId` is session-local and opaque.
- `type` is `diff`.
- `format` is `unified-diff`.
- `fileCount` equals the number of parsed file entries.
- `files` is derived deterministically from the unified diff.
- `status` uses Git-style letters where possible: `A`, `M`, `D`, `R`, `C`, `B`, or `?`.
- `additions` and `deletions` count changed lines for the file.

The full unified diff is not stored in the turn JSON.

## Storage

Artifacts live beside existing persisted turn files under the session history root:

```text
<historyRoot>/<project>/<session>/
  turns/
    t000000.bin
  artifacts/
    diff-000123.diff
```

The new `SessionArtifactStore` is owned by the same common session layer as `fileSessionTurnStore`.

Behavior:

- Write the artifact body before writing the `prompt_done` turn that references it.
- If artifact write fails, fail prompt persistence rather than emitting a broken reference.
- Deleting a session removes its artifacts because they live under the session directory.
- Resetting session turns should remove artifacts referenced by those turns, or remove the session artifact directory entirely when the reset is whole-session.

## Read API

Add a Registry session method:

```json
{
  "method": "session.artifact.read",
  "payload": {
    "sessionId": "sess-1",
    "artifactId": "diff-000123"
  }
}
```

Response:

```json
{
  "artifactId": "diff-000123",
  "type": "diff",
  "format": "unified-diff",
  "content": "diff --git ..."
}
```

Rules:

- The request is scoped to the active project.
- `artifactId` must resolve inside the session artifact directory.
- Missing artifacts return a not-found error.
- The read path does not expose arbitrary filesystem paths.

## Data Flow

```text
Codex App Server turn/diff/updated
  -> codexapp bridge caches latest diff by turnId

Codex App Server turn/completed
  -> codexapp bridge attaches pending diff body to prompt result

SessionRecorder finishPromptStateLocked
  -> parse diff into file metadata
  -> write one diff artifact body
  -> write prompt_done with artifact metadata

App receives prompt_done
  -> render changed-files list
  -> read full artifact only when opened
```

The bridge does not expose Codex `turnId` to app/web. It only passes provider-neutral prompt artifact data to the common session layer.

## ACP Compatibility

External ACP semantics stay unchanged:

- `session/update` continues to carry messages, plans, and tool calls.
- `prompt_done` remains the terminal WheelMaker turn.
- Standard ACP providers do not need to know Codex App Server `turn` or `item` concepts.

Codex `turn/diff/updated` is adapter-specific input. The common session layer stores the resulting WheelMaker artifact. Future providers can create the same artifact from other sources, such as ACP `toolCallContent` diffs or a Git snapshot fallback.

Existing `item/fileChange/patchUpdated` handling remains useful for live tool progress and as a fallback when no turn-level diff arrives. It is not the primary done-level artifact source.

## UI

Under `prompt_done`, render a compact changed-files section:

```text
Changed 3 files

M  WorkspaceApp.tsx          +42 -8
M  codexapp_agent.go         +31 -2
A  session_artifacts.go      +88
```

Interactions:

- Clicking the section opens the full diff artifact.
- Clicking a row opens the same full diff and may scroll to the selected file.
- If artifact read fails, show a small inline error and keep the metadata visible.

## Archive Behavior

Session archive and restore must include artifacts referenced by archived turns.

Archive should pack:

- existing turn contents
- artifact metadata already embedded in the turn JSON
- artifact bodies referenced by those turns

Restore should recreate:

```text
<historyRoot>/<project>/<session>/turns/
<historyRoot>/<project>/<session>/artifacts/
```

Archived read uses the same `session.artifact.read` shape with read-only session routing. The frontend should not need a separate archive-specific artifact protocol.

## Testing

Server tests:

- Codex bridge stores latest `turn/diff/updated` by turn id and ignores unrelated turn ids.
- `turn/completed` produces one prompt diff artifact when diff is non-empty.
- Session recorder writes artifact body before `prompt_done` metadata.
- `session.artifact.read` returns the stored unified diff and rejects path traversal.
- Session delete/reset removes artifact files.
- Archive/restore preserves artifact bodies and references.

Frontend tests:

- Prompt done with a diff artifact renders changed file count and rows.
- Clicking the artifact reads full diff content.
- File rows show status, additions, and deletions without summaries or hunk counts.
- Read failure leaves metadata visible and shows an error.

## Decisions

- The first version does not expose diff truncation, byte length, or hash metadata.
- The backend stores the full diff received from the provider. If artifact write or read fails, the API returns an error instead of emitting partial metadata.
