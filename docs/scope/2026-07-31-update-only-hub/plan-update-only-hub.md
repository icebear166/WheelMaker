# Update-only Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated older Hub stay connected to a newer Registry, expose zero projects, and retain only the existing WheelMaker update query/request path.

**Architecture:** Registry derives `normal` or `update_only` from the existing Hub `protocolVersion`, registers the Hub at handshake, and owns the restricted firewall. Old Hub code remains unchanged: its reports are acknowledged and discarded, while the existing `wheelmakerUpdate` HubState subset is forwarded. App only carries an additive Hub descriptor field into the Hub menu and shows a mismatch notice when expanded.

**Tech Stack:** Go, Gorilla WebSocket, React 19, TypeScript, Jest.

---

## File structure

- `server/internal/protocol/registry.go`: additive Hub descriptor connection mode.
- `server/internal/registry/server.go`: numeric protocol comparison, connection registration, report isolation, and restricted request firewall.
- `server/internal/registry/server_test.go`: WebSocket-level compatibility and routing tests.
- `app/web/src/registry/registryTypes.ts`: optional `connectionMode` on Registry Hub descriptors.
- `app/web/src/registry/RegistryRepository.ts`: preserve the optional descriptor field from `registry.project.list`.
- `app/web/src/app/WorkspaceApp.tsx`: pass the descriptor into Hub tree items.
- `app/web/src/app/ChatHubMenu.tsx`: display the expanded mismatch notice.
- `app/web/src/app/ChatHubMenu.test.tsx`: component regression test.

### Task 1: Negotiate and expose restricted Hub connections

**Files:**
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/registry/server.go`
- Test: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing protocol comparison and handshake tests**

Add table tests for the private comparison helper and WebSocket tests proving:

```go
func TestCompareProtocolVersions(t *testing.T) {
	tests := []struct {
		left, right string
		want        int
		wantOK      bool
	}{
		{"2.6", "2.6", 0, true},
		{"2.5", "2.6", -1, true},
		{"2.10", "2.9", 1, true},
		{"2.6.0", "2.6", 0, true},
		{"2.x", "2.6", 0, false},
	}
	// Call compareProtocolVersions and assert result/ok.
}
```

Use Registry config `ProtocolVersion: "2.7"` for Hub handshake tests:

- Hub `2.6` receives a successful `connect.init`.
- Hub `2.8` receives `unsupported protocolVersion`.
- Client `2.6` still receives `unsupported protocolVersion`.
- Invalid Hub version still receives `unsupported protocolVersion`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `server/`:

```powershell
go test ./internal/registry -run 'Test(CompareProtocolVersions|ConnectInit.*Protocol)' -count=1
```

Expected: FAIL because numeric comparison and older-Hub acceptance do not exist.

- [ ] **Step 3: Add the additive connection-mode types**

In `server/internal/protocol/registry.go`:

```go
type RegistryConnectionMode string

const (
	RegistryConnectionModeNormal     RegistryConnectionMode = "normal"
	RegistryConnectionModeUpdateOnly RegistryConnectionMode = "update_only"
)

type HubListItem struct {
	HubID          string                 `json:"hubId"`
	ConnectionMode RegistryConnectionMode `json:"connectionMode,omitempty"`
}
```

Do not change `DefaultProtocolVersion` or any handshake payload.

- [ ] **Step 4: Implement numeric comparison and handshake selection**

In `server/internal/registry/server.go`, add `protocolVersion string` and `connectionMode rp.RegistryConnectionMode` to `connectionState`. Add a numeric dotted-component parser/comparator using `strconv.Atoi`; trailing zero components compare equal.

In `handleConnectInit`:

```go
mode := rp.RegistryConnectionModeNormal
comparison, comparable := compareProtocolVersions(payload.ProtocolVersion, s.cfg.ProtocolVersion)
if role == string(rp.RegistryRoleClient) {
	comparable = strings.TrimSpace(payload.ProtocolVersion) == s.cfg.ProtocolVersion
	comparison = 0
}
if !comparable || comparison > 0 || (role == string(rp.RegistryRoleClient) && payload.ProtocolVersion != s.cfg.ProtocolVersion) {
	// Return the existing unsupported protocolVersion error.
}
if role == string(rp.RegistryRoleHub) && comparison < 0 {
	mode = rp.RegistryConnectionModeUpdateOnly
}
state.protocolVersion = strings.TrimSpace(payload.ProtocolVersion)
state.connectionMode = mode
```

After setting peer metadata, register every Hub immediately in `hubPeers` and a new `hubDescriptors map[string]rp.HubListItem`. Replace and close any previous peer for the same Hub outside the server mutex. Keep Client registration unchanged.

Update `snapshotProjectListHubs` to read descriptors instead of waiting for a project report. Update `unregisterHub` to delete the descriptor only if the disconnecting peer is still current.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
go test ./internal/registry -run 'Test(CompareProtocolVersions|ConnectInit.*Protocol)' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/internal/protocol/registry.go server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): accept older hubs as update only"
```

### Task 2: Isolate reports and enforce the update whitelist

**Files:**
- Modify: `server/internal/registry/server.go`
- Test: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write failing report-isolation tests**

Create a helper that connects a Hub with Registry config `ProtocolVersion: "2.7"` and Hub payload version `2.6`. Assert:

1. `hub.report.projects` receives the normal success response.
2. `registry.project.list` returns one Hub descriptor with `connectionMode: "update_only"`.
3. The same response contains zero projects.
4. `hub.report.project` is acknowledged but does not create a project.
5. A Hub `hub.state.updated` event produces no event on a connected Client.

- [ ] **Step 2: Run the report test and verify RED**

Run:

```powershell
go test ./internal/registry -run '^TestUpdateOnlyHubReportsAreAcknowledgedAndDiscarded$' -count=1
```

Expected: FAIL because the older Hub is rejected or its report is stored.

- [ ] **Step 3: Implement Hub-side isolation at the Registry boundary**

Before normal event routing, silently discard every event from an `update_only` Hub. Before normal request dispatch, handle restricted Hub requests:

```go
func (s *Server) handleUpdateOnlyHubRequest(state *connectionState, in envelope) bool {
	if state.role != string(rp.RegistryRoleHub) || state.connectionMode != rp.RegistryConnectionModeUpdateOnly {
		return false
	}
	switch in.Method {
	case rp.RegistryMethodHubPing:
		_ = s.writeResponse(state.peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
	case rp.RegistryMethodHubReportProjects, rp.RegistryMethodHubReportProject:
		_ = s.writeResponse(state.peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
	default:
		_ = s.writeResponse(state.peer, in.RequestID, in.Method, "", map[string]any{"ok": true})
	}
	return true
}
```

The handler must run after envelope/request-role validation but before `handleRequest`, and must never mutate `hubs`, `projectToHub`, or broadcast events.

- [ ] **Step 4: Run the report test and verify GREEN**

Run:

```powershell
go test ./internal/registry -run '^TestUpdateOnlyHubReportsAreAcknowledgedAndDiscarded$' -count=1
```

Expected: PASS.

- [ ] **Step 5: Write failing exact-whitelist tests**

With one restricted Hub and one current Client, table-test these requests:

```go
allowed := []testEnvelope{
	{Method: rp.RegistryMethodHubStateRefresh, HubID: "hub-old", Payload: map[string]any{"sections": []string{"wheelmakerUpdate"}}},
	{Method: rp.RegistryMethodHubStateAction, HubID: "hub-old", Payload: map[string]any{"section": "wheelmakerUpdate", "action": "requestUpdate", "params": map[string]any{}}},
}
denied := []testEnvelope{
	{Method: rp.RegistryMethodHubStateGet, HubID: "hub-old", Payload: map[string]any{"sections": []string{"wheelmakerUpdate"}}},
	{Method: rp.RegistryMethodHubStateRefresh, HubID: "hub-old", Payload: map[string]any{"sections": []string{"wheelmakerUpdate", "skills"}}},
	{Method: rp.RegistryMethodHubStateRefresh, HubID: "hub-old", Payload: map[string]any{"sections": []string{"skills"}}},
	{Method: rp.RegistryMethodHubStateAction, HubID: "hub-old", Payload: map[string]any{"section": "wheelmakerUpdate", "action": "updatePublish"}},
	{Method: rp.RegistryMethodHubConfigGet, HubID: "hub-old", Payload: map[string]any{}},
}
```

Allowed requests must reach the Hub unchanged and return its response to the Client. Denied requests must return `FORBIDDEN` and must not arrive at the Hub.

- [ ] **Step 6: Run the whitelist test and verify RED**

Run:

```powershell
go test ./internal/registry -run '^TestUpdateOnlyHubAllowsOnlyWheelMakerUpdateRequests$' -count=1
```

Expected: FAIL because HubState currently forwards every section/action.

- [ ] **Step 7: Implement the Client-to-Hub firewall**

Add:

```go
func updateOnlyHubRequestAllowed(in envelope) bool {
	var payload struct {
		Sections []string `json:"sections"`
		Section  string   `json:"section"`
		Action   string   `json:"action"`
	}
	if decodePayload(in.Payload, &payload) != nil {
		return false
	}
	switch in.Method {
	case rp.RegistryMethodHubStateRefresh:
		return len(payload.Sections) == 1 && payload.Sections[0] == "wheelmakerUpdate"
	case rp.RegistryMethodHubStateAction:
		return payload.Section == "wheelmakerUpdate" && payload.Action == "requestUpdate"
	default:
		return false
	}
}
```

At the start of `handleRequest`, when `state.role` is Client and `in.HubID` identifies a restricted descriptor, return `FORBIDDEN` unless the helper allows it. The guard is Registry-owned and applies before asynchronous forwarding. Adjust the read loop so restricted-target checks occur before dispatch to an async worker.

In `executeHubStateRequest`, consider an immediately registered `hubPeer` sufficient for Hub existence; do not require a stored Project snapshot.

- [ ] **Step 8: Run focused and package tests**

Run:

```powershell
go test ./internal/registry -run 'TestUpdateOnlyHub' -count=1
go test ./internal/protocol ./internal/registry -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): isolate update-only hub traffic"
```

### Task 3: Show the mismatch notice in the existing Hub menu

**Files:**
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/app/ChatHubMenu.tsx`
- Test: `app/web/src/app/ChatHubMenu.test.tsx`
- Test: `app/__tests__/web-agent-package-update-service.test.ts`

- [ ] **Step 1: Write failing descriptor normalization test**

Extend the `registry.project.list` fixture with:

```ts
hubs: [
  {hubId: 'hub-normal'},
  {hubId: 'hub-old', connectionMode: 'update_only'},
],
```

Assert the repository preserves `connectionMode: 'update_only'` only for the restricted Hub and does not change the existing WheelMaker update request expectations.

- [ ] **Step 2: Write failing expanded-menu notice test**

Add:

```tsx
test('expanded update-only hub shows protocol mismatch notice', async () => {
  const {props} = createHarness({
    treeItems: [{hubId: 'hub-old', projects: [], connectionMode: 'update_only'}],
    hubIds: ['hub-old'],
    expandedHubIds: ['hub-old'],
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ChatHubMenu {...props} />);
  });
  expect(renderer.root.findByProps({className: 'chat-hub-protocol-mismatch'}).children)
    .toEqual(['Protocol mismatch · Update only']);
  expect(sectionHeaders(renderer.root).length).toBeGreaterThan(0);
});
```

The second assertion locks the requirement that other controls are not hidden by App.

- [ ] **Step 3: Run both App tests and verify RED**

Run from `app/`:

```powershell
npm test -- web-agent-package-update-service.test.ts ChatHubMenu.test.tsx
```

Expected: FAIL because descriptors discard `connectionMode` and tree items cannot display it.

- [ ] **Step 4: Preserve and pass the additive descriptor field**

In `registryTypes.ts`:

```ts
export interface RegistryHub {
  hubId: string;
  connectionMode?: 'normal' | 'update_only';
}
```

In `RegistryRepository.listProjectSnapshot`, normalize:

```ts
connectionMode: hub?.connectionMode === 'update_only' ? 'update_only' : undefined,
```

Add the same optional field to `ChatHubTreeItem`. In `WorkspaceApp.tsx`, build a Hub descriptor map and pass each matching `connectionMode` into `chatHubTreeItems`.

- [ ] **Step 5: Render only the notice**

Inside the existing expanded `chat-hub-sections`, before normal sections:

```tsx
{treeItem.connectionMode === 'update_only' ? (
  <div className="chat-hub-protocol-mismatch">
    Protocol mismatch · Update only
  </div>
) : null}
```

Do not early-return, hide controls, filter Hub scans, change update methods, or add CSS unless the existing section styling cannot render the notice legibly.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
npm test -- web-agent-package-update-service.test.ts ChatHubMenu.test.tsx
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/app/WorkspaceApp.tsx app/web/src/app/ChatHubMenu.tsx app/web/src/app/ChatHubMenu.test.tsx app/__tests__/web-agent-package-update-service.test.ts
git commit -m "feat(app): label update-only hub connections"
```

### Task 4: Verify the permanent compatibility contract

**Files:**
- Verify: `server/internal/protocol`
- Verify: `server/internal/registry`
- Verify: focused App suites
- Verify: spec, plan, and Wiki

- [ ] **Step 1: Format and check source**

```powershell
gofmt -w server/internal/protocol/registry.go server/internal/registry/server.go server/internal/registry/server_test.go
git diff --check
```

- [ ] **Step 2: Run affected Go suites**

From `server/`:

```powershell
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
```

Expected: PASS. Hub package is regression-only; no Hub source files are changed.

- [ ] **Step 3: Run focused App suites and build**

From `app/`:

```powershell
npm test -- web-agent-package-update-service.test.ts web-agent-package-update-settings.test.ts ChatHubMenu.test.tsx
npm run tsc:web
npm run build:web
```

Expected: PASS; Web output goes to `~/.wheelmaker/web`.

- [ ] **Step 4: Verify excluded designs are absent**

```powershell
rg -n "maintenanceProtocolVersion|hub\\.maintenance|registry\\.hub\\.updated" server app docs/wiki docs/scope/2026-07-31-update-only-hub --glob '!**/dist/**'
git status --short
```

Expected: no implementation/Wiki references to the discarded maintenance protocol. The spec may mention those strings only while explicitly saying they are not added.

- [ ] **Step 5: Rebase, repeat smoke tests, and push**

```powershell
git fetch origin
git rebase origin/main
Set-Location server
go test ./internal/protocol ./internal/registry ./internal/hub -count=1
Set-Location ../app
npm test -- web-agent-package-update-service.test.ts web-agent-package-update-settings.test.ts ChatHubMenu.test.tsx
Set-Location ..
git push --force-with-lease origin feat/update-only-hub
```

Expected: rebase and tests succeed, then the feature branch is pushed.
