# Interactive Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-first, Hub-owned interactive PTY that every authenticated App can create, operate, observe, and exactly restore through the existing Registry WebSocket.

**Architecture:** The Hub owns PTY processes and an xterm-go headless screen; the Registry remains a stateless authenticated router and gives terminal output a bounded low-priority write queue. The App uses xterm.js plus a pure `runId + seq` synchronization controller, with a resizable desktop panel and a mobile full-screen surface. All control and data messages remain JSON; byte payloads are base64.

**Tech Stack:** Go 1.26, gorilla/websocket, go-pty v0.2.3, xterm-go pinned commit, React 19, TypeScript, `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, Jest, Go testing.

---

## File structure

- `server/internal/protocol/terminal.go`: canonical Terminal payloads, limits, base64 validation, and method constants shared by Hub and Registry.
- `server/internal/hub/terminal/screen.go`: xterm-go adapter that owns serialized VT state and fixed 10,000-line scrollback.
- `server/internal/hub/terminal/manager.go`: Hub-scoped terminal metadata, run lifecycle, batching, snapshots, input, ownership, restart, and close.
- `server/internal/hub/terminal/pty.go`, `pty_windows.go`, `pty_other.go`: small PTY interface plus the Windows ConPTY adapter and explicit unsupported-platform implementation.
- `server/internal/hub/reporter.go`, `hub.go`: bridge Terminal requests/events to the manager and tie manager lifetime to Hub lifetime.
- `server/internal/registry/server.go`: strict one-way Terminal event routing and priority/bounded WebSocket writer.
- `app/web/src/terminal/terminalSync.ts`: pure multi-Hub list and snapshot/increment synchronization state machine.
- `app/web/src/terminal/terminalEncoding.ts`: browser-safe base64/byte conversion.
- `app/web/src/terminal/TerminalView.tsx`: xterm.js lifecycle, input, fit, resize, and snapshot rendering.
- `app/web/src/terminal/TerminalWorkbench.tsx`: tabs, actions, status, desktop/mobile chrome, and standard mobile key bar.
- `app/web/src/styles/terminal.css`: Terminal-only layout and visual rules.
- Existing Registry protocol/service and `WorkspaceApp.tsx` files remain integration points; do not move unrelated code while adding Terminal.

### Task 1: Add pinned dependencies and canonical protocol contracts

**Files:**
- Modify: `server/go.mod`
- Modify: `server/go.sum`
- Create: `server/internal/protocol/terminal.go`
- Modify: `server/internal/protocol/registry.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`

- [ ] **Step 1: Write failing protocol tests**

Add table-driven assertions to `server/internal/protocol/registry_methods_test.go` covering all nine control/data methods, their roles, routes, and required IDs:

```go
func TestRegistryTerminalMethods(t *testing.T) {
	tests := []struct {
		method string
		role RegistryRole
		route RegistryRouteKind
		projectID bool
		hubID bool
	}{
		{RegistryMethodTerminalList, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalCreate, RegistryRoleClient, RegistryRouteTerminalProjectRequest, true, false},
		{RegistryMethodTerminalGet, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalResize, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalClose, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalRestart, RegistryRoleClient, RegistryRouteTerminalHubRequest, false, true},
		{RegistryMethodTerminalInput, RegistryRoleClient, RegistryRouteTerminalClientEvent, false, true},
		{RegistryMethodTerminalOutput, RegistryRoleHub, RegistryRouteTerminalHubEvent, false, true},
		{RegistryMethodTerminalChanged, RegistryRoleHub, RegistryRouteTerminalHubEvent, false, true},
	}
	for _, tt := range tests {
		desc, ok := RegistryMethod(tt.method)
		if !ok { t.Fatalf("method %q is not registered", tt.method) }
		if desc.Route != tt.route || desc.RequiresProjectID != tt.projectID || desc.RequiresHubID != tt.hubID {
			t.Fatalf("method %q descriptor=%+v", tt.method, desc)
		}
		if !RegistryMethodAllowed(string(tt.role), tt.method) {
			t.Fatalf("method %q should allow %q", tt.method, tt.role)
		}
	}
}

func TestTerminalDataPayloadValidation(t *testing.T) {
	valid := base64.StdEncoding.EncodeToString([]byte{0, 3, 0xff})
	decoded, err := DecodeTerminalData(valid)
	if err != nil || !bytes.Equal(decoded, []byte{0, 3, 0xff}) {
		t.Fatalf("DecodeTerminalData()=%v,%v", decoded, err)
	}
	if _, err := DecodeTerminalData("not-base64"); err == nil {
		t.Fatal("invalid base64 should fail")
	}
	oversized := base64.StdEncoding.EncodeToString(make([]byte, MaxTerminalEventBytes+1))
	if _, err := DecodeTerminalData(oversized); err == nil {
		t.Fatal("oversized decoded payload should fail")
	}
}
```

- [ ] **Step 2: Run the protocol tests and confirm the new symbols fail to compile**

Run: `cd server; go test ./internal/protocol -run 'TestRegistryTerminalMethods|TestTerminalDataPayloadValidation'`

Expected: FAIL with undefined Terminal method/route symbols.

- [ ] **Step 3: Define exact Go protocol types and routes**

Create `server/internal/protocol/terminal.go` with the following public contract; use `json.RawMessage` only at transport boundaries, not inside these types:

```go
package protocol

import (
	"encoding/base64"
	"fmt"
)

const MaxTerminalEventBytes = 64 * 1024

type TerminalStatus string
const (
	TerminalStatusRunning TerminalStatus = "running"
	TerminalStatusExited TerminalStatus = "exited"
	TerminalStatusError TerminalStatus = "error"
)

type TerminalMetadata struct {
	TerminalID string `json:"terminalId"`
	RunID string `json:"runId"`
	HubID string `json:"hubId"`
	ProjectID string `json:"projectId"`
	ProjectName string `json:"projectName"`
	InitialCWD string `json:"initialCwd"`
	Shell string `json:"shell"`
	Status TerminalStatus `json:"status"`
	Cols int `json:"cols"`
	Rows int `json:"rows"`
	ExitCode *int `json:"exitCode,omitempty"`
	CreatedAt string `json:"createdAt"`
	ExitedAt string `json:"exitedAt,omitempty"`
}

type TerminalListResponse struct { Terminals []TerminalMetadata `json:"terminals"` }
type TerminalCreateRequest struct { Cols int `json:"cols"`; Rows int `json:"rows"` }
type TerminalCreateResponse struct { Terminal TerminalMetadata `json:"terminal"`; ResizeToken string `json:"resizeToken"` }
type TerminalGetRequest struct { TerminalID string `json:"terminalId"` }
type TerminalGetResponse struct { Terminal TerminalMetadata `json:"terminal"`; SnapshotSeq uint64 `json:"snapshotSeq"`; Snapshot string `json:"snapshot"` }
type TerminalResizeRequest struct { TerminalID string `json:"terminalId"`; Cols int `json:"cols"`; Rows int `json:"rows"`; Claim bool `json:"claim,omitempty"`; ResizeToken string `json:"resizeToken,omitempty"` }
type TerminalResizeResponse struct { Terminal TerminalMetadata `json:"terminal"`; ResizeToken string `json:"resizeToken,omitempty"` }
type TerminalRefRequest struct { TerminalID string `json:"terminalId"` }
type TerminalInputEvent struct { TerminalID string `json:"terminalId"`; RunID string `json:"runId"`; Data string `json:"data"` }
type TerminalOutputEvent struct { TerminalID string `json:"terminalId"`; RunID string `json:"runId"`; Seq uint64 `json:"seq"`; Data string `json:"data"` }
type TerminalChangedEvent struct { Change string `json:"change"`; TerminalID string `json:"terminalId"`; Terminal *TerminalMetadata `json:"terminal,omitempty"` }

func DecodeTerminalData(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil { return nil, fmt.Errorf("invalid terminal data: %w", err) }
	if len(decoded) > MaxTerminalEventBytes { return nil, fmt.Errorf("terminal data exceeds %d bytes", MaxTerminalEventBytes) }
	return decoded, nil
}
```

In `registry_methods.go`, add route kinds `terminal_project_request`, `terminal_hub_request`, `terminal_client_event`, and `terminal_hub_event`; register constants `terminal.list/create/get/resize/close/restart/input/output/changed`. Control methods allow only `client`; input only `client`; output/changed only `hub`. Increment `DefaultProtocolVersion` in `registry.go` from `2.5` to `2.6`.

- [ ] **Step 4: Mirror the contract in TypeScript**

Set `RegistryProtocolVersion = '2.6'`, add matching `RegistryMethods` entries, and add these discriminated types to `registryTypes.ts`:

```ts
export type RegistryTerminalStatus = 'running' | 'exited' | 'error';
export type RegistryTerminal = {
  terminalId: string; runId: string; hubId: string; projectId: string;
  projectName: string; initialCwd: string; shell: string;
  status: RegistryTerminalStatus; cols: number; rows: number;
  exitCode?: number; createdAt: string; exitedAt?: string;
};
export type RegistryTerminalListResponse = {terminals: RegistryTerminal[]};
export type RegistryTerminalCreateResponse = {terminal: RegistryTerminal; resizeToken: string};
export type RegistryTerminalGetResponse = {terminal: RegistryTerminal; snapshotSeq: number; snapshot: string};
export type RegistryTerminalResizeResponse = {terminal: RegistryTerminal; resizeToken?: string};
export type RegistryTerminalInputEvent = {terminalId: string; runId: string; data: string};
export type RegistryTerminalOutputEvent = {terminalId: string; runId: string; seq: number; data: string};
export type RegistryTerminalChangedEvent = {change: 'created'|'running'|'resized'|'exited'|'restarted'|'closed'|'error'; terminalId: string; terminal?: RegistryTerminal};
```

- [ ] **Step 5: Install pinned dependencies and run contract checks**

Run:

```powershell
cd server
go get github.com/aymanbagabas/go-pty@v0.2.3
go get github.com/gitpod-io/xterm-go@v0.0.0-20260602140638-d86eba88b616
go mod tidy
go test ./internal/protocol
cd ..\app
npm install @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 --save-exact
npm run tsc:web
```

Expected: protocol tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the contract**

```powershell
git add server/go.mod server/go.sum server/internal/protocol app/package.json app/package-lock.json app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts
git commit -m "feat(protocol): define interactive terminal messages"
```

### Task 2: Build and verify the headless Terminal screen

**Files:**
- Create: `server/internal/hub/terminal/screen.go`
- Create: `server/internal/hub/terminal/screen_test.go`

- [ ] **Step 1: Write screen behavior and exact-restore tests**

Test ANSI color, cursor movement, Unicode, alternate buffer, resize, and 10,000-line trimming. The central restore assertion is:

```go
func TestXTermScreenSnapshotRestoresExactly(t *testing.T) {
	screen := newXTermScreen(20, 4)
	defer screen.Close()
	_, _ = screen.Write([]byte("normal\r\n\x1b[31mred\x1b[0m\r\n\x1b[?1049halt界\x1b[2;3H!"))
	screen.Resize(30, 6)
	snapshot := screen.Snapshot()

	restored := newXTermScreen(30, 6)
	defer restored.Close()
	_, _ = restored.Write(snapshot)
	if got := restored.Snapshot(); !bytes.Equal(got, snapshot) {
		t.Fatalf("restored snapshot differs\nwant=%q\ngot=%q", snapshot, got)
	}
}
```

Generate 10,050 numbered lines, serialize, restore into a second screen, and assert line `00000` is absent while `10049` remains.

- [ ] **Step 2: Verify the screen tests fail**

Run: `cd server; go test ./internal/hub/terminal -run XTermScreen`

Expected: FAIL because `newXTermScreen` does not exist.

- [ ] **Step 3: Implement the xterm-go adapter**

Use only this internal interface outside `screen.go`:

```go
type Screen interface {
	Write([]byte) (int, error)
	Resize(cols, rows int)
	Snapshot() []byte
	Close()
}

type xtermScreen struct {
	term *xterm.Terminal
	serialize *xterm.SerializeAddon
}

func newXTermScreen(cols, rows int) Screen {
	term := xterm.New(xterm.WithCols(cols), xterm.WithRows(rows), xterm.WithScrollback(10000))
	return &xtermScreen{term: term, serialize: xterm.NewSerializeAddon(term)}
}
func (s *xtermScreen) Write(data []byte) (int, error) { return s.term.Write(data) }
func (s *xtermScreen) Resize(cols, rows int) { s.term.Resize(cols, rows) }
func (s *xtermScreen) Snapshot() []byte { return append([]byte(nil), s.serialize.Serialize(nil)...) }
func (s *xtermScreen) Close() { s.term.Dispose() }
```

Keep all screen access under the owning session mutex in Task 3; this adapter does not add a second lock.

- [ ] **Step 4: Run and commit the screen adapter**

Run: `cd server; go test ./internal/hub/terminal -run XTermScreen`

Expected: PASS.

```powershell
git add server/internal/hub/terminal
git commit -m "feat(terminal): add recoverable headless screen"
```

### Task 3: Implement the Hub Terminal Manager with fake PTYs

**Files:**
- Create: `server/internal/hub/terminal/pty.go`
- Create: `server/internal/hub/terminal/manager.go`
- Create: `server/internal/hub/terminal/manager_test.go`

- [ ] **Step 1: Define fake-driven lifecycle tests**

Build a `fakePTY` with buffered `Read`, captured `Write`, resize calls, an exit channel, and a `Kill` flag. Cover create/list/get, concurrent input, stale-run rejection, output batching, monotonic `seq`, consistent snapshot, exit retention, restart, idempotent close, ownership rotation, and no timer-based cleanup. Use the public manager API below:

```go
manager := NewManager(Config{
	HubID: "hub-a",
	ResolveProject: func(id string) (Project, bool) {
		return Project{ID: id, Name: "wheelmaker", Root: `C:\src\wheelmaker`}, id == "hub-a:wheelmaker"
	},
	PTYFactory: fakeFactory,
	ResolveShell: func() (string, error) { return `C:\Program Files\PowerShell\7\pwsh.exe`, nil },
	ScreenFactory: func(cols, rows int) Screen { return newXTermScreen(cols, rows) },
	Publish: func(method string, payload any) error { published <- publishedEvent{method, payload}; return nil },
})
created, err := manager.Create(context.Background(), "hub-a:wheelmaker", protocol.TerminalCreateRequest{Cols: 100, Rows: 30})
if err != nil { t.Fatal(err) }
if created.Terminal.InitialCWD != `C:\src\wheelmaker` || created.ResizeToken == "" { t.Fatalf("create=%+v", created) }
```

For the snapshot race, block `Publish`, emit output while `Get` runs, then assert the returned `SnapshotSeq` matches the bytes serialized under the same lock and the next published event is exactly `SnapshotSeq+1`.

- [ ] **Step 2: Run the manager tests and confirm failure**

Run: `cd server; go test ./internal/hub/terminal -run Manager`

Expected: FAIL because `NewManager` and its API are undefined.

- [ ] **Step 3: Add the PTY boundary and manager API**

Define the only PTY-facing types in `pty.go`:

```go
type PTY interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Resize(cols, rows int) error
	Wait() (int, error)
	Kill() error
	Close() error
}
type PTYFactory interface {
	Start(ctx context.Context, shell, cwd string, cols, rows int) (PTY, error)
}
```

Define `Project`, `Config`, and these manager methods in `manager.go`:

```go
type Project struct { ID, Name, Root string }
type Config struct {
	HubID string
	ResolveProject func(string) (Project, bool)
	ResolveShell func() (string, error)
	PTYFactory PTYFactory
	ScreenFactory func(int, int) Screen
	Publish func(method string, payload any) error
}
func (m *Manager) List() protocol.TerminalListResponse
func (m *Manager) Create(context.Context, string, protocol.TerminalCreateRequest) (protocol.TerminalCreateResponse, error)
func (m *Manager) Get(protocol.TerminalGetRequest) (protocol.TerminalGetResponse, error)
func (m *Manager) Input(protocol.TerminalInputEvent)
func (m *Manager) Resize(protocol.TerminalResizeRequest) (protocol.TerminalResizeResponse, error)
func (m *Manager) CloseTerminal(protocol.TerminalRefRequest) error
func (m *Manager) Restart(context.Context, protocol.TerminalRefRequest) (protocol.TerminalCreateResponse, error)
func (m *Manager) Close() error
```

Use cryptographic 128-bit URL-safe random IDs for `terminalId`, `runId`, and `resizeToken`. Validate dimensions within `2..500` columns and `1..200` rows. Resolve the shell for every new run through `ResolveShell`, store its resolved path in metadata, and never accept a shell or cwd from the request.

- [ ] **Step 4: Implement batching and atomic screen/sequence updates**

Give each run one output goroutine and use constants `outputFlushInterval = 16*time.Millisecond` and `maxOutputBatchBytes = protocol.MaxTerminalEventBytes`. On every flush, hold `session.mu`, write the complete batch to the screen, increment `seq`, construct the output event, unlock, then call `Publish`. Publishing errors are metadata-only log events and must not stop the read loop or mutate sequence. On EOF, flush every remaining byte before setting exited/error state and broadcasting `terminal.changed`, so the final prompt or exit text is included in the retained snapshot.

```go
func (s *session) commitOutput(data []byte) protocol.TerminalOutputEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = s.screen.Write(data)
	s.seq++
	return protocol.TerminalOutputEvent{
		TerminalID: s.meta.TerminalID, RunID: s.meta.RunID, Seq: s.seq,
		Data: base64.StdEncoding.EncodeToString(data),
	}
}
```

`Input` must decode the entire event before locking, then under the lock verify running status and exact run ID, capture the PTY, unlock, and perform one `Write`; invalid/stale data is wholly discarded.

- [ ] **Step 5: Implement lifecycle and ownership rules**

`Get` takes `session.mu` once while copying metadata, `seq`, and `screen.Snapshot()`. `Resize(claim=true)` always rotates the token and returns it; automatic resize requires an exact token and never returns it. The token must be absent from list/get metadata and every `terminal.changed` event. Restart is allowed only from exited/error, keeps `terminalId`, replaces `runId`, resets screen/seq/exit fields, starts from `InitialCWD`, and rotates ownership. Closing a running session kills and closes its PTY before deleting the map entry; closing an absent terminal succeeds.

- [ ] **Step 6: Run lifecycle and race tests**

Run:

```powershell
cd server
go test ./internal/hub/terminal
go test -race ./internal/hub/terminal
```

Expected: both commands PASS; tests leave an exited terminal present after waiting beyond two output flush intervals.

- [ ] **Step 7: Commit the manager**

```powershell
git add server/internal/hub/terminal
git commit -m "feat(terminal): manage hub-owned terminal sessions"
```

### Task 4: Add the Windows ConPTY adapter and shell detection

**Files:**
- Create: `server/internal/hub/terminal/pty_windows.go`
- Create: `server/internal/hub/terminal/pty_other.go`
- Create: `server/internal/hub/terminal/pty_windows_test.go`

- [ ] **Step 1: Write Windows shell and process tests**

Use a temporary directory as cwd. Assert shell probing selects the first available executable in `pwsh.exe`, `powershell.exe`, `cmd.exe` order by injecting `exec.LookPath`. With the real factory, start the detected shell, write a marker command plus `exit`, read until the marker appears, call `Wait`, and assert the child cwd command reports the temp path. Add a long-running child case and assert `Kill` makes `Wait` finish within five seconds.

- [ ] **Step 2: Confirm the Windows test fails**

Run: `cd server; go test ./internal/hub/terminal -run 'WindowsPTY|DetectWindowsShell'`

Expected: FAIL because the Windows factory is absent.

- [ ] **Step 3: Implement the go-pty adapter**

In `pty_windows.go`, wrap `pty.New()`, `p.Command(shell)`, `cmd.Dir = cwd`, `cmd.Env = os.Environ()`, `p.Resize(cols, rows)`, `cmd.Start()`, and `cmd.Wait()`. Store the returned command/process handle so `Kill` terminates the ConPTY process tree and is idempotent. Export only:

```go
func NewPlatformPTYFactory() PTYFactory { return windowsPTYFactory{lookPath: exec.LookPath} }
func DetectShell(lookPath func(string) (string, error)) (string, error) {
	for _, name := range []string{"pwsh.exe", "powershell.exe", "cmd.exe"} {
		if path, err := lookPath(name); err == nil { return path, nil }
	}
	return "", errors.New("no supported Windows shell found")
}
```

In `pty_other.go`, use a `!windows` build tag and return a stable `interactive terminal is supported on Windows only` error so all packages still compile on CI hosts.

- [ ] **Step 4: Run Windows tests and commit**

Run: `cd server; go test ./internal/hub/terminal -run 'WindowsPTY|DetectWindowsShell' -count=1`

Expected: PASS on Windows.

```powershell
git add server/internal/hub/terminal
git commit -m "feat(terminal): launch shells through Windows ConPTY"
```

### Task 5: Connect the Terminal Manager to Hub and Reporter

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write Reporter request/event tests**

Extend the existing Reporter WebSocket tests with a fake `TerminalHandler` and verify:

- each control method is decoded and returns response/error with the original request ID;
- `terminal.input` arrives as an event, invokes `Input`, and receives no response;
- `PublishTerminalEvent` writes `type=event`, no `requestId`, correct `hubId`, method, and payload;
- a blocked sink and full 256-item queue make `PublishTerminalEvent` return immediately while later manager snapshot state continues advancing;
- debug and verbose captures contain IDs/byte counts but never the base64 `data` or snapshot.

Use this interface in the test fake:

```go
type TerminalHandler interface {
	HandleTerminalRequest(context.Context, string, string, json.RawMessage) (any, error)
	HandleTerminalInput(protocol.TerminalInputEvent)
}
```

- [ ] **Step 2: Run the Reporter tests and confirm failure**

Run: `cd server; go test ./internal/hub -run 'Reporter.*Terminal|Hub.*Terminal'`

Expected: FAIL because Reporter has no Terminal handler.

- [ ] **Step 3: Add one-way event support to Reporter**

Add `terminalHandler TerminalHandler`, `SetTerminalHandler`, and a connection-specific `terminalEventSink` with a 256-item channel plus a `done` channel. Start one sink drain goroutine after a successful handshake and retire that sink when the connection ends. `PublishTerminalEvent` must never perform the network write on the PTY output goroutine:

```go
func (r *Reporter) PublishTerminalEvent(method string, payload any) error {
	r.mu.RLock(); sink := r.terminalEventSink; r.mu.RUnlock()
	if sink == nil { return nil }
	event := envelope{
		Type: protocol.RegistryEnvelopeTypeEvent,
		Method: method,
		HubID: r.cfg.HubID,
		Payload: protocol.MustRaw(payload),
	}
	select {
	case sink.events <- event:
		return nil
	case <-sink.done:
		return nil
	default:
		return errTerminalPublishBacklog
	}
}
```

The sink worker calls the existing mutex-protected `writeJSON`; a blocked Registry connection can therefore stall only that sink worker, never the PTY reader or headless screen. A full/disconnected sink drops the real-time publish attempt; the manager has already advanced its screen and sequence, so clients detect a later sequence gap and recover with `terminal.get`. Never carry queued items into a later Registry connection.

Update the Reporter read loop to accept `terminal.input` events separately from requests. Dispatch terminal control requests to `TerminalHandler`; decode input with the canonical protocol type. Keep `PublishProjectEvent` unchanged for session traffic. In `writeDebugEnvelope`, replace Terminal input/output/get payloads with metadata containing only method, Hub/project/terminal/run IDs, sequence, status, and decoded byte count; never serialize `data`, `snapshot`, `resizeToken`, command content, or environment values.

- [ ] **Step 4: Wire manager construction and shutdown in Hub**

Add `terminalManager *terminal.Manager` to `Hub`. In `setupRegistrySync`, construct one manager from the already normalized `projects` list and `rp.ProjectID(hubID, project.Name)`, set its publisher to `rep.PublishTerminalEvent`, and register an adapter implementing `TerminalHandler`. Configure `ResolveShell` with `terminal.DetectShell(exec.LookPath)` and `PTYFactory` with `terminal.NewPlatformPTYFactory()`; use the default xterm screen factory. In `Hub.Close`, close the manager before project clients and join its error into the existing error collection.

The request adapter must switch on the six control methods and decode their exact protocol structs; `terminal.create` receives `projectID` from the envelope and all other controls receive `hubID` plus payload.

- [ ] **Step 5: Run Hub tests and commit**

Run: `cd server; go test ./internal/hub/...`

Expected: PASS, including existing ACP terminal/tool tests, proving the new manager remains separate from ACP command execution.

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub.go server/internal/hub/hub_test.go
git commit -m "feat(hub): serve terminal control and data events"
```

### Task 6: Route strict Terminal requests and events through Registry

**Files:**
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write end-to-end Registry routing tests**

Use the existing real WebSocket test server helpers to connect one Hub and two clients. Verify create routes by `projectId`; list/get/resize/close/restart route by `hubId`; client input reaches only the selected Hub; Hub output/changed reach both permitted clients; scoped clients cannot target another Hub. Also send input from a Hub, output from a client, unknown events, events with a request ID, and missing IDs, and assert each is rejected without forwarding.

Use exact event envelopes:

```go
envelope{Type: rp.RegistryEnvelopeTypeEvent, Method: rp.RegistryMethodTerminalInput,
	HubID: "hub-a", Payload: rp.MustRaw(rp.TerminalInputEvent{TerminalID: "t1", RunID: "r1", Data: "YQ=="})}
envelope{Type: rp.RegistryEnvelopeTypeEvent, Method: rp.RegistryMethodTerminalOutput,
	HubID: "hub-a", Payload: rp.MustRaw(rp.TerminalOutputEvent{TerminalID: "t1", RunID: "r1", Seq: 1, Data: "Yg=="})}
```

- [ ] **Step 2: Run routing tests and confirm failure**

Run: `cd server; go test ./internal/registry -run TerminalRouting`

Expected: FAIL because `handleWS` rejects all events.

- [ ] **Step 3: Split request and event validation**

After `connect.init`, branch by envelope type. Requests retain request-ID uniqueness checks. Events must have `requestId == 0`, match one of the three registered Terminal event methods, and pass `RegistryMethodAllowed`. Add:

```go
func (s *Server) handleTerminalEvent(state *connectionState, in envelope) error {
	switch in.Method {
	case rp.RegistryMethodTerminalInput:
		return s.forwardTerminalInput(state, in)
	case rp.RegistryMethodTerminalOutput, rp.RegistryMethodTerminalChanged:
		return s.broadcastTerminalHubEvent(state, in)
	default:
		return errUnsupportedEvent
	}
}
```

`forwardTerminalInput` requires client role, non-empty in-scope `hubId`, and online Hub; it forwards unchanged as a one-way event. `broadcastTerminalHubEvent` requires Hub role and `in.HubID == state.hubID`, then broadcasts only to clients with empty scope or matching `scopeHubID`. The Registry does not parse command bytes, log payload, or keep terminal state.

- [ ] **Step 4: Route control methods through existing forward primitives**

Treat create as a project-forward request and the other five controls as Hub-forward requests. Add both route predicates to `shouldHandleRegistryRequestAsync` so a slow Hub response does not block its socket reader.

- [ ] **Step 5: Run routing and existing Registry tests**

Run: `cd server; go test ./internal/registry`

Expected: PASS.

- [ ] **Step 6: Commit routing**

```powershell
git add server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): route terminal messages over existing websocket"
```

### Task 7: Protect Registry control traffic from terminal output backpressure

**Files:**
- Modify: `server/internal/registry/server.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write deterministic writer priority and overflow tests**

Create a blocking fake `websocketWriter`. Fill the terminal queue, enqueue a control response, unblock one write, and assert the control response is written before the next terminal output. Fill the bounded terminal queue again and assert the peer closes while another peer still receives output. Assert synchronous `write` returns the underlying write error.

- [ ] **Step 2: Run and confirm failure**

Run: `cd server; go test ./internal/registry -run 'PeerWriter|TerminalOutputOverflow'`

Expected: FAIL because `peerConn` writes directly under a mutex.

- [ ] **Step 3: Replace direct writes with one writer loop**

Use `priorityWrites` capacity 64, `terminalWrites` capacity 128, `closed`, and `writerDone`. A queued item has `value any` and optional `done chan error`. The loop must always perform a non-blocking priority check before selecting terminal work:

```go
for {
	select {
	case item := <-p.priorityWrites:
		p.writeItem(item)
		continue
	default:
	}
	select {
	case item := <-p.priorityWrites:
		p.writeItem(item)
	case item := <-p.terminalWrites:
		p.writeItem(item)
	case <-p.closed:
		return
	}
}
```

Keep `peer.write` synchronous by waiting on `done`. Add `peer.writeTerminal` as non-blocking enqueue; on a full terminal queue, close the WebSocket with code `1013` and reason `terminal output backlog`, then return `errTerminalBacklog`. Responses and non-terminal events always use `peer.write`; only broadcast `terminal.output` uses `writeTerminal`.

- [ ] **Step 4: Run stress/race tests and commit**

Run:

```powershell
cd server
go test ./internal/registry -run 'PeerWriter|TerminalOutputOverflow' -count=10
go test -race ./internal/registry
```

Expected: PASS with stable ordering and no races.

```powershell
git add server/internal/registry/server.go server/internal/registry/server_test.go
git commit -m "feat(registry): prioritize control traffic over terminal output"
```

### Task 8: Add App Registry transport and Terminal service methods

**Files:**
- Modify: `app/web/src/registry/RegistryClient.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Create: `app/__tests__/web-terminal-service.test.ts`

- [ ] **Step 1: Write transport/service tests**

Mock WebSocket and repository boundaries. Assert `sendEvent` emits JSON with no request ID and rejects when disconnected; input carries exact base64; every control method chooses `projectId` or `hubId` per protocol; list normalizes absent terminals to `[]`; and debug capture redacts `data` and `snapshot` while retaining method, terminal ID, run ID, sequence, and byte count.

- [ ] **Step 2: Run and confirm failure**

Run: `cd app; npm test -- --runInBand __tests__/web-terminal-service.test.ts`

Expected: FAIL because `sendEvent` and Terminal service methods are absent.

- [ ] **Step 3: Add the one-way client API**

Add to `RegistryClient`:

```ts
sendEvent(args: {method: string; payload: unknown; projectId?: string; hubId?: string}): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('registry websocket is not connected');
  const envelope: RegistryEnvelope = {
    type: 'event', method: args.method, payload: args.payload,
    ...(args.projectId ? {projectId: args.projectId} : {}),
    ...(args.hubId ? {hubId: args.hubId} : {}),
  };
  const raw = JSON.stringify(envelope);
  this.emitDebug(redactTerminalDebugCapture({kind: 'outbound', envelope, raw}));
  this.ws.send(raw);
}
```

Apply the same redaction before inbound debug capture. Redaction must replace byte fields with `{redacted: true, byteLength}` and must never retain raw JSON for terminal input/output/get responses.

- [ ] **Step 4: Add repository and service methods**

Add typed methods `listTerminals(hubId)`, `createTerminal(projectId, cols, rows)`, `getTerminal(hubId, terminalId)`, `resizeTerminal(hubId, request)`, `closeTerminal(hubId, terminalId)`, `restartTerminal(hubId, terminalId)`, and `sendTerminalInput(hubId, event)`. The service checks `repository` exactly like existing speech methods and forwards without local persistence.

- [ ] **Step 5: Run service tests, typecheck, and commit**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-terminal-service.test.ts
npm run tsc:web
```

Expected: PASS and exit 0.

```powershell
git add app/web/src/registry app/__tests__/web-terminal-service.test.ts
git commit -m "feat(app): expose terminal registry service"
```

### Task 9: Implement the App synchronization controller

**Files:**
- Create: `app/web/src/terminal/terminalEncoding.ts`
- Create: `app/web/src/terminal/terminalSync.ts`
- Create: `app/__tests__/web-terminal-sync.test.ts`

- [ ] **Step 1: Write pure synchronization tests**

Cover browser-safe Unicode/base64 round trips, parallel list merge across online Hubs, preserving a known Hub as unavailable on connection loss, clearing only a reconnected Hub whose list is empty, exact event application, duplicate ignore, gap/run mismatch refresh, snapshot-time buffering, contiguous post-snapshot drain, repeated refresh on a buffered gap, and input disabled while disconnected/unavailable.

Use this public reducer contract:

```ts
const initial = createTerminalSyncState();
const loading = beginTerminalSnapshot(initial, 'hub-a', 't1');
const buffered = receiveTerminalOutput(loading, 'hub-a', {terminalId: 't1', runId: 'r1', seq: 8, data: bytesToBase64(new Uint8Array([98]))});
const restored = applyTerminalSnapshot(buffered.state, 'hub-a', {
  terminal: terminal({terminalId: 't1', runId: 'r1'}), snapshotSeq: 7,
  snapshot: bytesToBase64(new Uint8Array([97])),
});
expect(restored.effects).toEqual([
  {kind: 'reset', terminalKey: 'hub-a:t1', data: new Uint8Array([97])},
  {kind: 'write', terminalKey: 'hub-a:t1', data: new Uint8Array([98])},
]);
expect(restored.state.attached['hub-a:t1'].expectedSeq).toBe(9);
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd app; npm test -- --runInBand __tests__/web-terminal-sync.test.ts`

Expected: FAIL because the terminal synchronization module is absent.

- [ ] **Step 3: Implement encoding and reducer types**

`terminalEncoding.ts` must convert bytes in chunks rather than spreading arbitrary arrays onto the call stack. `terminalSync.ts` exports `TerminalSyncState`, `TerminalEffect`, `createTerminalSyncState`, `mergeTerminalLists`, `markTerminalsUnavailable`, `applyTerminalChanged`, `beginTerminalSnapshot`, `receiveTerminalOutput`, `applyTerminalSnapshot`, and `canSendTerminalInput`.

Use the key `${hubId}:${terminalId}`. While snapshot loading, buffer at most 256 output events or 4 MiB decoded data; crossing either bound emits one `refresh` effect and clears the buffer. Outside snapshot loading:

- output for a terminal with no active attachment is ignored; selecting that tab always begins with `terminal.get`;
- exact `expectedSeq` emits `write` and increments;
- lower sequence emits no effect;
- higher sequence or another run emits `refresh` and marks the attachment loading;
- snapshot emits `reset`, then drains only same-run contiguous events;
- any remaining gap emits `refresh` rather than applying later bytes.

- [ ] **Step 4: Run reducer tests and commit**

Run: `cd app; npm test -- --runInBand __tests__/web-terminal-sync.test.ts`

Expected: PASS.

```powershell
git add app/web/src/terminal/terminalEncoding.ts app/web/src/terminal/terminalSync.ts app/__tests__/web-terminal-sync.test.ts
git commit -m "feat(app): synchronize terminal snapshots and output"
```

### Task 10: Build the xterm.js view and mobile key handling

**Files:**
- Create: `app/web/src/terminal/TerminalView.tsx`
- Create: `app/web/src/terminal/TerminalWorkbench.tsx`
- Create: `app/__tests__/web-terminal-components.test.tsx`

- [ ] **Step 1: Write component tests with mocked xterm.js**

Mock `Terminal` and `FitAddon`. Assert mount opens/fits, snapshot reset calls `reset` then `write`, output writes bytes, `onData` sends base64 input, ResizeObserver reports only foreground-tab size changes, non-owner fit does not send resize, “Fit to this screen” claims ownership, unmount disposes, and the mobile key bar emits exact sequences:

```ts
const mobileKeys = {
  Esc: '\x1b', Tab: '\t', Up: '\x1b[A', Down: '\x1b[B',
  Right: '\x1b[C', Left: '\x1b[D', 'Ctrl+C': '\x03', 'Ctrl+D': '\x04',
};
```

Assert Ctrl/Alt are one-shot modifiers and Paste reads `navigator.clipboard.readText()` then sends the complete UTF-8 bytes.

- [ ] **Step 2: Run and confirm failure**

Run: `cd app; npm test -- --runInBand __tests__/web-terminal-components.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement `TerminalView` lifecycle**

Create xterm with `scrollback: 10000`, `convertEol: false`, cursor blink, and the app’s JetBrains Mono stack. Load `FitAddon`, call `open`, and subscribe to `onData` and `onBinary`. Feed both through `TextEncoder`; `onBinary` converts each code unit to one byte. Use `ResizeObserver` plus `requestAnimationFrame` to coalesce fit operations. Report resize only when `active && resizeToken`, dimensions changed, and cols/rows are positive.

Expose an imperative handle:

```ts
export type TerminalViewHandle = {
  resetAndWrite(data: Uint8Array): Promise<void>;
  write(data: Uint8Array): void;
  focus(): void;
  fit(): {cols: number; rows: number} | null;
};
```

Resolve `resetAndWrite` only from xterm’s write callback so buffered incremental output is not drained before the snapshot is parsed.

- [ ] **Step 4: Implement tabs, status, actions, and key bar**

`TerminalWorkbench` receives terminals, active key, unavailable Hub set, mode, and callbacks. Render Hub/project labels, status/exit code, `+`, restart for exited/error, close, and “Fit to this screen”. Closing running opens the parent confirmation callback; exited/error closes directly. In mobile mode render the standard key bar below the terminal and keep tabs horizontally scrollable.

- [ ] **Step 5: Run component tests, typecheck, and commit**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-terminal-components.test.tsx
npm run tsc:web
```

Expected: PASS and exit 0.

```powershell
git add app/web/src/terminal app/__tests__/web-terminal-components.test.tsx
git commit -m "feat(app): render interactive terminal workbench"
```

### Task 11: Integrate Terminal into desktop and mobile Workspace UI

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/web/src/shell/AppDialogs.tsx`
- Create: `app/web/src/styles/terminal.css`
- Modify: `app/web/src/styles/index.css`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-file-peek-viewer.test.ts`
- Create: `app/__tests__/web-terminal-workspace.test.tsx`

- [ ] **Step 1: Write source and interaction tests for final placement**

Assert the Terminal title button occurs before `chat-preview-toggle`; desktop workbench is below the Chat main region inside `ChatSurface`; a horizontal separator changes a CSS height variable and clamps the panel to 160 px minimum and 70% maximum; Preview remains independently rendered; mobile chooses exactly one of Terminal or Preview for `mobileOverlay`; tabs and `+` remain accessible; close-running uses `ConfirmTarget`; close-exited does not.

- [ ] **Step 2: Run and confirm failure**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-terminal-workspace.test.tsx __tests__/web-chat-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts
```

Expected: terminal workspace assertions FAIL while existing tests remain green.

- [ ] **Step 3: Add Workspace state and Registry event handling**

In `WorkspaceApp.tsx`, keep reducer state, active terminal key, desktop open state/height, mobile surface choice, and resize tokens in page memory only. After every successful Registry connect, call `terminal.list` for all online Hubs with `Promise.allSettled`, merge successes, and mark failed Hubs unavailable. In the existing single `service.onEvent` effect, handle `terminal.changed` and `terminal.output` before session events and execute reducer effects against registered `TerminalViewHandle`s. A `refresh` effect calls `terminal.get`; during it, subsequent output remains buffered by the reducer.

On Registry close, retain known tabs, mark every Hub unavailable, disable input, and preserve xterm content. On reconnect, re-list all online Hubs and get the selected terminal. Never write terminal metadata to `workspaceStore`, localStorage, IndexedDB, or URL state.

- [ ] **Step 4: Add create, input, resize, restart, and close handlers**

Create uses `projectIdRef.current` and the active terminal container’s fitted dimensions, defaulting to 80x24 before first layout. Save create/claim `resizeToken` in a `Map<string,string>` ref. Input requires connected + available + matching current run. Automatic resize includes the token; explicit fit sends `claim: true` and replaces the token. Restart resets the view only after its new snapshot response. Close sends the request after confirmation and relies on the response plus `terminal.changed` idempotently.

Extend `ConfirmTarget` with:

```ts
| {kind: 'terminalClose'; hubId: string; terminalId: string; label: string}
```

and render copy explaining that the running process tree will be terminated.

- [ ] **Step 5: Add desktop and mobile markup**

Place a `codicon-terminal` button immediately before Preview. Desktop markup is:

```tsx
{isWide && terminalOpen ? (
  <>
    <div className="terminal-splitter" role="separator" aria-orientation="horizontal" onPointerDown={beginTerminalResize} />
    <section className="terminal-desktop-panel" style={{height: terminalPanelHeight}}>
      <TerminalWorkbench mode="desktop" {...terminalWorkbenchProps} />
    </section>
  </>
) : null}
```

Set `mobileOverlay={terminalMobileOverlay ?? chatPreviewMobileOverlay}` and make each title action close the other mobile surface before opening itself. Mobile Terminal uses a fixed full-screen dialog with safe-area padding and Preview-like z-index.

- [ ] **Step 6: Add focused Terminal CSS**

Import `terminal.css` last in `styles/index.css`. Define a dark terminal canvas, compact tabs, status dots, splitter hover/drag state, `.terminal-desktop-panel { flex: 0 0 auto; min-height: 160px; }`, `.terminal-mobile-overlay { position: fixed; inset: 0; z-index: 70; }`, remaining-height flex behavior, horizontal tab overflow, 44 px mobile key targets, safe-area bottom padding, and xterm viewport sizing. Reuse existing tokens; do not restyle Chat or Preview.

- [ ] **Step 7: Run UI tests, typecheck, and build**

Run:

```powershell
cd app
npm test -- --runInBand __tests__/web-terminal-workspace.test.tsx __tests__/web-terminal-components.test.tsx __tests__/web-chat-ui.test.ts __tests__/web-chat-file-peek-viewer.test.ts
npm run tsc:web
npm run build:web
```

Expected: all tests PASS, typecheck exits 0, webpack reports a successful production build.

- [ ] **Step 8: Commit UI integration**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/web/src/shell/AppDialogs.tsx app/web/src/styles app/__tests__
git commit -m "feat(app): add desktop and mobile terminal surfaces"
```

### Task 12: Verify recovery, isolation, security, and real Windows behavior

**Files:**
- Modify: `server/internal/hub/hub_test.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `app/__tests__/web-terminal-sync.test.ts`
- Modify: `app/__tests__/web-terminal-workspace.test.tsx`

- [ ] **Step 1: Add cross-layer recovery regression tests**

Drive fake PTY output concurrently with `terminal.get`, deliver the response after a later output event, and assert App reconstruction is byte-for-byte equivalent to the manager snapshot plus contiguous events. Repeat with an omitted event and with restart changing `runId`; both cases must issue another get and never display the later bytes first.

- [ ] **Step 2: Add access and process-lifetime regression tests**

Verify two clients can input and receive output in arrival order, only the latest resize token works, an explicit claim invalidates the former owner, Registry disconnect does not call PTY `Kill`/`Close`, Hub `Close` does, and a new manager after simulated Hub restart lists no running or exited terminals.

- [ ] **Step 3: Add high-output and logging regression tests**

Publish more than 128 terminal output events to one blocked client while a normal client and control request remain active. Assert the blocked client is closed, the normal client sees all events, and the control response is not starved. Capture Registry, Reporter, and Hub logs and assert sentinel command text, environment value, input base64, output base64, and snapshot base64 are absent.

- [ ] **Step 4: Run all automated checks**

Run:

```powershell
cd server
go test ./...
go test -race ./internal/protocol ./internal/hub/terminal ./internal/registry
cd ..\app
npm test -- --runInBand
npm run tsc:web
npm run build:web
```

Expected: every Go/Jest test PASS, race detector reports no races, typecheck exits 0, and production build succeeds.

- [ ] **Step 5: Perform the Windows smoke test**

From the App connected to a local Hub, create a terminal in this repository and verify: prompt cwd is `D:\Code\WheelMaker`; Unicode and colored output render; `Ctrl+C` interrupts a long command; `Tab`, arrows, Paste, vim alternate screen, mouse mode, and resize work; a second browser can type and see output; claiming fit invalidates the first browser’s resize; refresh restores screen/scrollback; Registry restart does not kill the shell; shell exit retains final screen/exit code; restart keeps the tab ID with a new run ID; confirmed close removes the tab and its process tree. Temporarily hide `pwsh.exe` from the test process PATH and verify fallback to `powershell.exe`, then `cmd.exe`.

- [ ] **Step 6: Leave final regression changes for the repository completion gate**

Run: `git diff --check`

Expected: no output. Keep these regression changes uncommitted so Task 13 can execute the repository-required `git add`, `git commit`, and `git push` tail sequence successfully.

### Task 13: Final repository verification and delivery

**Files:**
- Verify: `docs/scope/2026-07-12-interactive-terminal.md`
- Verify: all files changed by Tasks 1-12

- [ ] **Step 1: Check the diff against the approved scope**

Run: `git diff --check; git status --short; git log --oneline -12`

Expected: `git diff --check` prints nothing; status contains only intended Terminal changes; recent history contains the task commits.

- [ ] **Step 2: Run the final verification gate**

Run:

```powershell
cd server
go test ./...
cd ..\app
npm test -- --runInBand
npm run tsc:web
npm run build:web
cd ..
```

Expected: all commands succeed.

- [ ] **Step 3: Apply and re-verify any formatting changes**

Run `gofmt -w` only on changed Go files and `npx prettier --write` only on changed Terminal TypeScript/CSS files. If either command changes files, rerun Step 2. Leave the formatting and Task 12 regression changes uncommitted for the next step.

- [ ] **Step 4: Push the completed implementation**

```powershell
$branch = git branch --show-current
git add -A
git commit -m "test(terminal): cover recovery security and backpressure"
git push origin $branch
```

Expected: all three commands succeed and the pushed branch contains every Terminal task commit.
