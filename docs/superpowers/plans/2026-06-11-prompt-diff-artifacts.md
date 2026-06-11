# Prompt Diff Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store one unified-diff artifact for each completed Codex prompt and show a clickable changed-files list above the done separator.

**Architecture:** Codex App Server `turn/diff/updated` is adapter input only. The Codex bridge attaches pending diff bodies to the existing `SessionPromptResult`; the common session recorder writes the artifact body beside turn files and persists only lightweight metadata in `prompt_done.param.artifacts`; app/web reads the full body through `session.artifact.read` on demand.

**Tech Stack:** Go session/registry server, Codex App Server JSON-RPC adapter, React/TypeScript Workspace Web UI, existing Registry request pipeline, existing Shiki unified diff renderer.

---

## File Structure

- `server/internal/protocol/acp.go`: add internal prompt artifact payloads on `SessionPromptResult`.
- `server/internal/protocol/session_turn.go`: add persisted prompt diff artifact metadata under `SessionTurnPromptResult`.
- `server/internal/protocol/registry_methods.go`: add `session.artifact.read` as a client session method.
- `server/internal/protocol/registry_methods_test.go`: assert method descriptor routing.
- `server/internal/hub/agent/codexapp_agent.go`: cache `turn/diff/updated` by Codex turn id and attach one pending diff artifact when that turn completes.
- `server/internal/hub/agent/codexapp_convert.go`: add notification params for `turn/diff/updated`.
- `server/internal/hub/agent/agent_test.go`: cover bridge diff caching and completion result payload.
- `server/internal/hub/client/session_artifacts.go`: create artifact store, unified diff metadata parser, read/write/delete helpers.
- `server/internal/hub/client/session_recorder.go`: carry side-band artifacts through `SessionViewEvent`, write artifact bodies before `prompt_done`, and include metadata.
- `server/internal/hub/client/session_turn_files.go`: keep artifacts under the same session directory layout.
- `server/internal/hub/client/client.go`: configure artifact store, reset/delete artifacts, expose `session.artifact.read`.
- `server/internal/hub/client/client_test.go`: cover recorder persistence, artifact read, path traversal rejection, and reset cleanup.
- `app/web/src/registry/registryMethods.ts`: add `SessionArtifactRead`.
- `app/web/src/registry/registryTypes.ts`: add prompt artifact metadata/read types.
- `app/web/src/registry/RegistryRepository.ts`: add request method for `session.artifact.read`.
- `app/web/src/registry/RegistryWorkspaceService.ts`: expose `readSessionArtifact`.
- `app/web/src/chat/ChatTurnView.tsx`: render changed-files metadata above the done separator and emit artifact open requests.
- `app/web/src/app/WorkspaceApp.tsx`: handle artifact reads and show the returned unified diff in the existing diff pane.

## Tasks

### Task 1: Protocol Types And Registry Method

**Files:**
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Test: `server/internal/protocol/registry_methods_test.go`

- [ ] **Step 1: Write the failing registry method test**

Add this assertion to `TestRegistryMethodRolesAndRoutes`:

```go
	if !RegistryClientForwardMethod(RegistryMethodSessionArtifactRead) {
		t.Fatalf("%s should be forwarded to the hub session route", RegistryMethodSessionArtifactRead)
	}
	if !RegistryMethodAllowed(string(RegistryRoleClient), RegistryMethodSessionArtifactRead) {
		t.Fatalf("%s should allow client callers", RegistryMethodSessionArtifactRead)
	}
```

- [ ] **Step 2: Run the protocol test and verify it fails**

Run: `go test ./internal/protocol -run TestRegistryMethodRolesAndRoutes -count=1`

Expected: compile failure for `RegistryMethodSessionArtifactRead`.

- [ ] **Step 3: Add minimal protocol definitions**

Define `RegistryMethodSessionArtifactRead = "session.artifact.read"` and register it with `registryProjectMethod(..., RegistryRouteSessionForward)`. Add:

```go
type SessionPromptArtifactPayload struct {
	Type    string `json:"type"`
	Format  string `json:"format"`
	Content string `json:"-"`
}

type SessionTurnPromptArtifact struct {
	ArtifactID string                          `json:"artifactId"`
	Type       string                          `json:"type"`
	Format     string                          `json:"format"`
	FileCount  int                             `json:"fileCount"`
	Files      []SessionTurnPromptArtifactFile `json:"files,omitempty"`
}

type SessionTurnPromptArtifactFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}
```

Extend `SessionPromptResult` with `Artifacts []SessionPromptArtifactPayload `json:"-"`` and `SessionTurnPromptResult` with `Artifacts []SessionTurnPromptArtifact `json:"artifacts,omitempty"``.

- [ ] **Step 4: Run the protocol test and verify it passes**

Run: `go test ./internal/protocol -run TestRegistryMethodRolesAndRoutes -count=1`

Expected: `ok`.

### Task 2: Artifact Store And Diff Metadata Parser

**Files:**
- Create: `server/internal/hub/client/session_artifacts.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing parser/store tests**

Add tests that call `parseUnifiedDiffArtifactFiles`, `newFileSessionArtifactStore(tempDir).WriteDiffArtifact`, `ReadArtifact`, and `DeleteArtifacts`. Required assertions:

```go
files := parseUnifiedDiffArtifactFiles(sampleUnifiedDiff)
if len(files) != 3 {
	t.Fatalf("files len = %d, want 3", len(files))
}
if files[0].Path != "app/web/src/app/WorkspaceApp.tsx" || files[0].Status != "M" || files[0].Additions != 2 || files[0].Deletions != 1 {
	t.Fatalf("modified file metadata = %+v", files[0])
}
```

The store test must assert that reading the returned artifact id returns the original diff body and that `ReadArtifact(..., "../escape")` returns an error.

- [ ] **Step 2: Run the client test and verify it fails**

Run: `go test ./internal/hub/client -run 'TestParseUnifiedDiffArtifactFiles|TestFileSessionArtifactStore' -count=1`

Expected: compile failure for missing parser/store symbols.

- [ ] **Step 3: Implement artifact store**

Create a focused store with this public package API:

```go
func newFileSessionArtifactStore(root string) *fileSessionArtifactStore
func (s *fileSessionArtifactStore) WriteDiffArtifact(ctx context.Context, projectID, sessionID, content string) (acp.SessionTurnPromptArtifact, error)
func (s *fileSessionArtifactStore) ReadArtifact(ctx context.Context, projectID, sessionID, artifactID string) (sessionArtifactReadResult, error)
func (s *fileSessionArtifactStore) DeleteArtifacts(ctx context.Context, projectID, sessionID string) error
func parseUnifiedDiffArtifactFiles(diff string) []acp.SessionTurnPromptArtifactFile
```

Artifact files live at `<root>/<projectID>/<sessionID>/artifacts/<artifactId>.diff`; artifact ids use `diff-` plus a short content hash and must match `^[A-Za-z0-9._-]+$`.

- [ ] **Step 4: Run parser/store tests and verify they pass**

Run: `go test ./internal/hub/client -run 'TestParseUnifiedDiffArtifactFiles|TestFileSessionArtifactStore' -count=1`

Expected: `ok`.

### Task 3: Session Recorder Side-Band Artifact Persistence

**Files:**
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing recorder test**

Add a test that records an ACP `session/prompt` result with:

```go
Artifacts: []acp.SessionPromptArtifactPayload{{
	Type:    "diff",
	Format:  "unified-diff",
	Content: sampleUnifiedDiff,
}},
```

Then read persisted turns and assert the `prompt_done` param contains one artifact with `type=diff`, `format=unified-diff`, `fileCount=3`, and no `content` property in JSON.

- [ ] **Step 2: Run recorder test and verify it fails**

Run: `go test ./internal/hub/client -run TestSessionRecorderPromptDoneWritesDiffArtifact -count=1`

Expected: failing assertion because artifacts are not persisted.

- [ ] **Step 3: Implement side-band artifact delivery**

Add `Artifacts []acp.SessionPromptArtifactPayload` to `SessionViewEvent` and `parsedSessionViewEvent`. When `client.Session` records an ACP prompt result, pass `result.Artifacts` on the event side-band while serializing only `stopReason` and `message` into JSON. In `handlePromptFinishedLocked`, write each diff artifact before appending `prompt_done` and copy returned metadata to `SessionTurnPromptResult.Artifacts`.

- [ ] **Step 4: Run recorder test and verify it passes**

Run: `go test ./internal/hub/client -run TestSessionRecorderPromptDoneWritesDiffArtifact -count=1`

Expected: `ok`.

### Task 4: Codex App Server Diff Capture

**Files:**
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Test: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write failing Codex bridge test**

Extend the fake App Server notification sequence with:

```json
{"jsonrpc":"2.0","method":"turn/diff/updated","params":{"threadId":"thread-1","turnId":"turn-1","diff":"diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"}}
```

Assert `promptRes.Artifacts` has exactly one item with `Type == "diff"`, `Format == "unified-diff"`, and the same diff content after `turn/completed`.

- [ ] **Step 2: Run agent test and verify it fails**

Run: `go test ./internal/hub/agent -run TestCodexAppRuntimeAttachesTurnDiffArtifact -count=1`

Expected: failing assertion because no artifact is attached.

- [ ] **Step 3: Implement bridge cache**

Parse `turn/diff/updated` params, cache non-empty diff by `turnId`, and on the matching `turn/completed` return:

```go
codexappPromptResult{
	stopReason: stopReason,
	artifacts: []protocol.SessionPromptArtifactPayload{{
		Type:    "diff",
		Format:  "unified-diff",
		Content: diff,
	}},
}
```

Clear cached turn diffs when prompt state completes or is cancelled.

- [ ] **Step 4: Run agent test and verify it passes**

Run: `go test ./internal/hub/agent -run TestCodexAppRuntimeAttachesTurnDiffArtifact -count=1`

Expected: `ok`.

### Task 5: Registry Artifact Read

**Files:**
- Modify: `server/internal/hub/client/client.go`
- Test: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing read API test**

Call the session handler with:

```json
{"sessionId":"sess-1","artifactId":"diff-test"}
```

for method `session.artifact.read` after writing an artifact through the store. Assert the response has `artifactId`, `type`, `format`, and `content`, and that `artifactId:"../escape"` returns an error.

- [ ] **Step 2: Run read API test and verify it fails**

Run: `go test ./internal/hub/client -run TestClientSessionArtifactRead -count=1`

Expected: failure because the method is unsupported.

- [ ] **Step 3: Implement read API**

Add request/response structs in `client.go`, route `RegistryMethodSessionArtifactRead`, scope it to the current project id, and call `sessionRecorder.artifactStore.ReadArtifact`.

- [ ] **Step 4: Run read API test and verify it passes**

Run: `go test ./internal/hub/client -run TestClientSessionArtifactRead -count=1`

Expected: `ok`.

### Task 6: Frontend Registry And Chat UI

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/app/WorkspaceApp.tsx`

- [ ] **Step 1: Write failing frontend assertions**

Add or extend existing tests, if present, to assert a `prompt_done` message with `param.artifacts[0].files` renders a changed-files section before the done separator and that clicking it calls `readSessionArtifact(sessionId, artifactId)`.

- [ ] **Step 2: Run frontend test/build and verify it fails**

Run the narrow existing frontend test command if available; otherwise run `npm run typecheck` from `app/web`.

Expected: failure for missing types/props/methods.

- [ ] **Step 3: Implement frontend registry/read UI**

Add TypeScript types for artifact metadata and read response. Add `RegistryMethods.SessionArtifactRead = 'session.artifact.read'`, repository/service methods, and a `ChatTurnView` changed-files section rendered immediately above the `prompt_done` separator. In `WorkspaceApp`, open the full returned diff with the existing diff pane renderer.

- [ ] **Step 4: Run frontend verification and verify it passes**

Run from `app/web`: `npm run typecheck`

Expected: `ok`.

### Task 7: Full Verification And Commit

**Files:**
- All modified files.

- [ ] **Step 1: Run focused Go tests**

Run:

```powershell
cd server
go test ./internal/protocol ./internal/hub/agent ./internal/hub/client
```

Expected: `ok` for all packages.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
cd app/web
npm run typecheck
```

Expected: command exits 0.

- [ ] **Step 3: Commit and push**

Run from repo root:

```powershell
git add -A
git commit -m "feat: add prompt diff artifacts"
git push origin <current-branch>
```

Expected: push succeeds.
