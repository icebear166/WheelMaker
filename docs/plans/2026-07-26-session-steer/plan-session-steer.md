# Session Steer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral Session Steer so a queued prompt can be inserted into a running Codex turn without interruption, with ordered transcript recording and an atomic normal-prompt fallback when the target turn ends.

**Architecture:** Extend the existing Session action capability/Registry spine, add an Agent `SessionSteerer` optional interface, and map Codex to `turn/steer` with `expectedTurnId` plus `clientUserMessageId`. Codex `userMessage item/started` is converted into an ordered internal Session update; Session owns a side-channel steer serializer and a priority prompt handoff that never competes with the current Prompt’s `promptMu`.

**Tech Stack:** Go 1.26 Hub/Agent/Registry, Codex App Server JSON-RPC v2, React 19 + TypeScript, Jest, CSS, existing SessionRecorder and chat prompt queue.

**Command convention:** Run every `go` command from `server/`, every `npm` command from `app/`, and every `git` command from the repository root.

---

### Task 1: Declare the provider-neutral Steer protocol and capability

**Files:**
- Modify: `server/internal/protocol/session_actions.go`
- Modify: `server/internal/protocol/acp.go`
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/hub/agent/factory.go`
- Modify: `server/internal/hub/agent/agent_test.go`
- Modify: `server/internal/hub/reporter.go`
- Modify: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write failing protocol and capability tests**

Add assertions that `session.steer` is a project-scoped SessionForward method, Codex advertises Steer, other providers do not, and Registry version remains `2.6`:

```go
func TestRegistrySessionSteerDescriptor(t *testing.T) {
	desc, ok := RegistryMethod(RegistryMethodSessionSteer)
	if !ok {
		t.Fatal("session.steer descriptor missing")
	}
	if desc.Scope != RegistryScopeProject || desc.Route != RegistryRouteSessionForward {
		t.Fatalf("session.steer descriptor = %+v", desc)
	}
	if RegistryProtocolVersion != "2.6" {
		t.Fatalf("protocol version = %q, want 2.6", RegistryProtocolVersion)
	}
}

func TestFactoryCodexSupportsSteer(t *testing.T) {
	factory := newACPFactoryWithOptions(ACPFactoryOptions{}, func(provider ACPProvider) bool {
		return provider.Name() == protocol.ACPProviderCodex
	})
	got := factory.SessionActions(protocol.ACPProviderCodex)
	if !got.Status || !got.Compact || !got.Steer {
		t.Fatalf("Codex session actions = %+v", got)
	}
}
```

Extend the Hub allowlist test so `session.steer` is accepted alongside `session.status` and `session.compact`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run from `server`:

```powershell
go test ./internal/protocol ./internal/hub/agent ./internal/hub -run 'TestRegistrySessionSteerDescriptor|TestFactoryCodexSupportsSteer|TestReporterForwardsSessionActionRequests'
```

Expected: build failure because `RegistryMethodSessionSteer` and `SessionActionSupport.Steer` do not exist.

- [ ] **Step 3: Add Steer constants, payloads, action capability, and ordered update fields**

Add these provider-neutral contracts to `session_actions.go`:

```go
const (
	SessionActionSteer = "steer"

	SessionSteerOutcomeSteered = "steered"
	SessionSteerOutcomeSent    = "sent"
)

type SessionSteerParams struct {
	SessionID       string         `json:"sessionId"`
	ClientMessageID string         `json:"clientMessageId"`
	Blocks          []ContentBlock `json:"blocks"`
}

type SessionSteerAccepted struct {
	OK              bool   `json:"ok"`
	Accepted        bool   `json:"accepted"`
	SessionID       string `json:"sessionId"`
	ClientMessageID string `json:"clientMessageId"`
	Outcome         string `json:"outcome"`
}
```

Extend the capability struct:

```go
type SessionActionCapabilities struct {
	Status  SessionActionCapability `json:"status"`
	Compact SessionActionCapability `json:"compact"`
	Steer   SessionActionCapability `json:"steer"`
}
```

Extend `protocol.SessionUpdate` so one ordered provider event can carry the full original user message:

```go
type SessionUpdate struct {
	SessionUpdate     string             `json:"sessionUpdate"`
	Content           json.RawMessage    `json:"content,omitempty"`
	ContentBlocks     []ContentBlock     `json:"contentBlocks,omitempty"`
	ClientMessageID   string             `json:"clientMessageId,omitempty"`
	Steered           bool               `json:"steered,omitempty"`
	AvailableCommands []AvailableCommand `json:"availableCommands,omitempty"`
	// existing fields remain unchanged
}
```

- [ ] **Step 4: Register the method and Codex capability without changing the protocol version**

Add:

```go
const RegistryMethodSessionSteer = "session.steer"
```

Register it:

```go
RegistryMethodSessionSteer: registryProjectMethod(
	RegistryMethodSessionSteer,
	RegistryRouteSessionForward,
),
```

Extend factory support:

```go
type SessionActionSupport struct {
	Status  bool
	Compact bool
	Steer   bool
}

f.RegisterSessionActions(protocol.ACPProviderCodex, SessionActionSupport{
	Status:  true,
	Compact: true,
	Steer:   true,
})
```

Add `RegistryMethodSessionSteer` to the reporter’s Session method allowlist. Do not edit the `2.6` constant.

- [ ] **Step 5: Run protocol, agent, and Hub tests**

```powershell
go test ./internal/protocol ./internal/hub/agent ./internal/hub
```

Expected: PASS.

- [ ] **Step 6: Commit the protocol spine**

```powershell
git add docs/scope/2026-07-26-session-steer.md server/internal/protocol/session_actions.go server/internal/protocol/acp.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/agent/factory.go server/internal/hub/agent/agent_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat: declare session steer capability"
```

### Task 2: Implement the Agent optional interface and Codex `turn/steer`

**Files:**
- Modify: `server/internal/hub/agent/instance.go`
- Modify: `server/internal/hub/agent/codexapp_convert.go`
- Modify: `server/internal/hub/agent/codexapp_agent.go`
- Modify: `server/internal/hub/agent/agent_test.go`

- [ ] **Step 1: Write failing Agent delegation and Codex ordering tests**

Add an interface assertion/delegation test and a fake App Server test that intentionally delivers the user item before the RPC response:

```go
func TestCodexAppSteerAcceptsCorrelatedUserMessageBeforeResponse(t *testing.T) {
	tr := newFakeCodexappTransport()
	rt := newCodexappRuntimeWithTransport(tr)
	t.Cleanup(func() { _ = rt.close() })
	conn := newCodexappConnWithRuntime(rt, t.TempDir())
	conn.BindSessionID("thread-1")

	updates := make(chan protocol.SessionUpdateParams, 8)
	conn.OnACPResponse(captureSessionUpdate(t, updates))
	setActiveCodexPromptForTest(conn, "turn-1")

	tr.onSend = func(msg map[string]any) {
		if msg["method"] != "turn/steer" {
			return
		}
		params := msg["params"].(map[string]any)
		if params["expectedTurnId"] != "turn-1" ||
			params["clientUserMessageId"] != "queued-1" {
			t.Fatalf("turn/steer params = %#v", params)
		}
		_ = tr.emit(map[string]any{
			"method": "item/started",
			"params": map[string]any{
				"threadId": "thread-1",
				"turnId":   "turn-1",
				"item": map[string]any{
					"id":       "user-2",
					"type":     "userMessage",
					"clientId": "queued-1",
					"content":  []any{map[string]any{"type": "text", "text": "steer me"}},
				},
			},
		})
		_ = tr.emit(map[string]any{
			"id": msg["id"],
			"result": map[string]any{"turnId": "turn-1"},
		})
	}

	result, err := conn.SteerSession(context.Background(), "thread-1", "queued-1", []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "steer me",
	}})
	if err != nil {
		t.Fatalf("SteerSession(): %v", err)
	}
	if result.ProviderTurnID != "turn-1" {
		t.Fatalf("provider turn = %q", result.ProviderTurnID)
	}
	update := waitForCodexappUpdate(t, updates)
	if update.Update.SessionUpdate != protocol.SessionUpdateUserMessageChunk ||
		update.Update.ClientMessageID != "queued-1" ||
		!update.Update.Steered {
		t.Fatalf("steer update = %#v", update.Update)
	}
}

func setActiveCodexPromptForTest(conn *codexappConn, turnID string) {
	conn.mu.Lock()
	conn.promptDone = make(chan codexappPromptResult, 1)
	conn.activeTurnID = turnID
	conn.lastTurnID = turnID
	conn.mu.Unlock()
}
```

Add companion tests for:

```go
func TestCodexAppSteerResponseBeforeUserMessage(t *testing.T)
func TestCodexAppSteerIgnoresUntrackedUserMessage(t *testing.T)
func TestCodexAppSteerNoActiveTurnReturnsInactive(t *testing.T)
func TestCodexAppSteerNonSteerableTurnReturnsUnavailable(t *testing.T)
func TestCodexAppSteerReusesPromptContentConversion(t *testing.T)
func TestCodexAppReplayMarksAdditionalUserMessagesSteered(t *testing.T)
func TestCodexAppSteerDoesNotBlockOtherThreadNotifications(t *testing.T)
func TestCodexAppSteerKeepsSameTurnUpdatesFlowingBeforeAcceptance(t *testing.T)
```

The content test must include text, image/resource link, and an attachment-backed block already supported by `codexappPromptToInputWithArtifacts`.

- [ ] **Step 2: Run the Agent tests and verify they fail**

```powershell
go test ./internal/hub/agent -run 'TestCodexAppSteer|TestInstanceSteer'
```

Expected: build failure because `SessionSteerer`, `SteerSession`, and Codex steer types are missing.

- [ ] **Step 3: Add the optional interface, results, and typed errors**

In `instance.go` add:

```go
var (
	ErrSessionSteerInactive    = errors.New("session steer target is inactive")
	ErrSessionSteerUnavailable = errors.New("session steer is unavailable")
)

type SessionSteerResult struct {
	ProviderTurnID string
}

type SessionSteerer interface {
	SteerSession(
		ctx context.Context,
		sessionID string,
		clientMessageID string,
		blocks []protocol.ContentBlock,
	) (SessionSteerResult, error)
}

func (i *instance) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []protocol.ContentBlock,
) (SessionSteerResult, error) {
	if err := i.ensureConn(); err != nil {
		return SessionSteerResult{}, err
	}
	steerer, ok := i.conn.(SessionSteerer)
	if !ok {
		return SessionSteerResult{}, ErrSessionActionUnsupported
	}
	return steerer.SteerSession(ctx, sessionID, clientMessageID, blocks)
}
```

- [ ] **Step 4: Add Codex request/response and correlation types**

In `codexapp_convert.go` add:

```go
type appServerTurnSteerParams struct {
	ThreadID            string               `json:"threadId"`
	ExpectedTurnID      string               `json:"expectedTurnId"`
	ClientUserMessageID string               `json:"clientUserMessageId"`
	Input               []appServerUserInput `json:"input"`
}

type appServerTurnSteerResponse struct {
	TurnID string `json:"turnId"`
}

func cloneCodexappContentBlocks(blocks []protocol.ContentBlock) []protocol.ContentBlock {
	if len(blocks) == 0 {
		return nil
	}
	out := make([]protocol.ContentBlock, len(blocks))
	for index := range blocks {
		out[index] = blocks[index]
		out[index].Annotations = append(json.RawMessage(nil), blocks[index].Annotations...)
		if blocks[index].Resource != nil {
			resource := *blocks[index].Resource
			out[index].Resource = &resource
		}
	}
	return out
}
```

Extend the thread item and RPC error:

```go
type appServerThreadItem struct {
	ID       string          `json:"id"`
	ClientID string          `json:"clientId,omitempty"`
	Type     string          `json:"type"`
	Content  json.RawMessage `json:"content,omitempty"`
	// existing fields remain unchanged
}

type codexappRPCRequestError struct {
	Method  string
	Code    int
	Message string
}

func (e *codexappRPCRequestError) Error() string {
	return fmt.Sprintf("codexapp %s: %s", e.Method, e.Message)
}
```

Change `codexappRuntime.request` to return `codexappRPCRequestError` rather than flattening every JSON-RPC error to an uninspectable formatted string.

- [ ] **Step 5: Add the Codex pending tracker and ordered user-message emission**

Add to `codexappConn`:

```go
type codexappSteerTracker struct {
	turnID   string
	blocks   []protocol.ContentBlock
	accepted chan struct{}
	once     sync.Once
}

type codexappConn struct {
	// existing fields
	pendingSteers map[string]*codexappSteerTracker
}
```

Register the tracker before sending, then wait for both the successful response and the matching item notification:

```go
func (c *codexappConn) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []protocol.ContentBlock,
) (SessionSteerResult, error) {
	threadID := c.runtimeThreadIDForSession(sessionID)
	input, err := codexappPromptToInputWithArtifacts(c.projectName, sessionID, blocks)
	if err != nil {
		return SessionSteerResult{}, err
	}

	c.mu.Lock()
	expectedTurnID := strings.TrimSpace(c.activeTurnID)
	if c.promptDone == nil || expectedTurnID == "" {
		c.mu.Unlock()
		return SessionSteerResult{}, ErrSessionSteerInactive
	}
	if c.pendingSteers == nil {
		c.pendingSteers = map[string]*codexappSteerTracker{}
	}
	tracker := &codexappSteerTracker{
		turnID:   expectedTurnID,
		blocks:   cloneCodexappContentBlocks(blocks),
		accepted: make(chan struct{}),
	}
	c.pendingSteers[clientMessageID] = tracker
	c.mu.Unlock()
	defer c.removePendingSteer(clientMessageID, tracker)

	var response appServerTurnSteerResponse
	err = c.runtime.request(ctx, "turn/steer", appServerTurnSteerParams{
		ThreadID:            threadID,
		ExpectedTurnID:      expectedTurnID,
		ClientUserMessageID: clientMessageID,
		Input:               input,
	}, &response)
	if err != nil {
		return SessionSteerResult{}, classifyCodexappSteerError(err)
	}
	if strings.TrimSpace(response.TurnID) != expectedTurnID {
		return SessionSteerResult{}, fmt.Errorf(
			"codexapp turn/steer accepted turn %q, expected %q",
			response.TurnID,
			expectedTurnID,
		)
	}
	select {
	case <-tracker.accepted:
		return SessionSteerResult{ProviderTurnID: response.TurnID}, nil
	case <-ctx.Done():
		return SessionSteerResult{}, ctx.Err()
	}
}

func (c *codexappConn) removePendingSteer(
	clientMessageID string,
	tracker *codexappSteerTracker,
) {
	c.mu.Lock()
	if c.pendingSteers[clientMessageID] == tracker {
		delete(c.pendingSteers, clientMessageID)
	}
	c.mu.Unlock()
}
```

Handle only tracked `userMessage` items on `item/started`:

```go
func (c *codexappConn) handleSteerUserMessage(p appServerItemEventParams) bool {
	clientID := strings.TrimSpace(p.Item.ClientID)
	if p.Item.Type != "userMessage" || clientID == "" {
		return false
	}
	c.mu.Lock()
	tracker := c.pendingSteers[clientID]
	c.mu.Unlock()
	if tracker == nil || tracker.turnID != strings.TrimSpace(p.TurnID) {
		return false
	}
	c.emitTurnUpdate(p.ThreadID, p.TurnID, protocol.SessionUpdate{
		SessionUpdate:   protocol.SessionUpdateUserMessageChunk,
		ContentBlocks:   cloneCodexappContentBlocks(tracker.blocks),
		ClientMessageID: clientID,
		Steered:         true,
	})
	tracker.once.Do(func() { close(tracker.accepted) })
	return true
}
```

Call this before the existing item switch, only for `item/started`:

```go
if method == "item/started" && c.handleSteerUserMessage(p) {
	return
}
```

Leave ordinary Prompt userMessage items ignored.

For provider-native history replay, mark every `userMessage` after the first one in the same native turn as Steered. Change the replay loop and item signature:

```go
func (c *codexappConn) replayThreadTurns(acpSessionID string, turns []appServerTurn) {
	acpSessionID = strings.TrimSpace(acpSessionID)
	if acpSessionID == "" || len(turns) == 0 {
		return
	}
	for _, turn := range turns {
		seenUserMessage := false
		for _, item := range turn.Items {
			steered := item.Type == "userMessage" && seenUserMessage
			c.replayThreadItem(acpSessionID, item, steered)
			if item.Type == "userMessage" {
				seenUserMessage = true
			}
		}
	}
}
```

In the `userMessage` branch, convert all replayable inputs into one update:

```go
func codexappReplayInputBlocks(inputs []appServerUserInput) []protocol.ContentBlock {
	blocks := make([]protocol.ContentBlock, 0, len(inputs))
	for _, input := range inputs {
		switch input.Type {
		case "text":
			if input.Text != "" {
				blocks = append(blocks, protocol.ContentBlock{
					Type: protocol.ContentBlockTypeText,
					Text: input.Text,
				})
			}
		case "image":
			if strings.TrimSpace(input.URL) != "" {
				blocks = append(blocks, protocol.ContentBlock{
					Type: protocol.ContentBlockTypeResourceLink,
					URI:  input.URL,
				})
			}
		case "localImage", "skill", "mention":
			if strings.TrimSpace(input.Path) != "" {
				path := filepath.ToSlash(filepath.Clean(input.Path))
				if filepath.VolumeName(input.Path) != "" && !strings.HasPrefix(path, "/") {
					path = "/" + path
				}
				blocks = append(blocks, protocol.ContentBlock{
					Type: protocol.ContentBlockTypeResourceLink,
					URI:  (&url.URL{Scheme: "file", Path: path}).String(),
					Name: input.Name,
				})
			}
		}
	}
	return blocks
}

```

Change `replayThreadItem` to accept `steered bool`, then replace its current `userMessage` branch with:

```go
	case "userMessage":
		var inputs []appServerUserInput
		if len(item.Content) == 0 || json.Unmarshal(item.Content, &inputs) != nil {
			return
		}
		blocks := codexappReplayInputBlocks(inputs)
		if len(blocks) == 0 {
			return
		}
		c.emitSessionUpdate(protocol.SessionUpdateParams{
			SessionID: acpSessionID,
			Update: protocol.SessionUpdate{
				SessionUpdate:   protocol.SessionUpdateUserMessageChunk,
				ContentBlocks:   blocks,
				ClientMessageID: item.ClientID,
				Steered:         steered,
			},
		})
```

Leave the existing agent/reasoning/plan/tool branches byte-for-byte unchanged. Keep the first user message’s `Steered` value false so replay reconstruction starts the native turn. The original live Steer path remains lossless because it emits the pre-conversion WheelMaker blocks stored in the tracker; this replay conversion is only the provider-history fallback.

- [ ] **Step 6: Classify only stale/no-active errors as fallback candidates**

Use the App Server’s stable invalid-request messages:

```go
func classifyCodexappSteerError(err error) error {
	var requestErr *codexappRPCRequestError
	if !errors.As(err, &requestErr) {
		return err
	}
	message := strings.ToLower(strings.TrimSpace(requestErr.Message))
	switch {
	case message == "no active turn to steer",
		strings.HasPrefix(message, "expected active turn id"):
		return fmt.Errorf("%w: %s", ErrSessionSteerInactive, requestErr.Message)
	case strings.Contains(message, "not steerable"):
		return fmt.Errorf("%w: %s", ErrSessionSteerUnavailable, requestErr.Message)
	default:
		return err
	}
}
```

Do not classify overload, timeout, disconnect, bad content, or unknown invalid requests as inactive.

- [ ] **Step 7: Run the Agent tests**

```powershell
go test ./internal/hub/agent -run 'TestCodexAppSteer|TestInstanceSteer|TestCodexAppPromptDoesNotEchoUserMessageChunk'
```

Expected: PASS, including both response/notification orderings and the existing no-echo regression.

- [ ] **Step 8: Commit the Agent implementation**

```powershell
git add server/internal/hub/agent/instance.go server/internal/hub/agent/codexapp_convert.go server/internal/hub/agent/codexapp_agent.go server/internal/hub/agent/agent_test.go
git commit -m "feat: map session steer to codex"
```

### Task 3: Persist Steered content as one ordered internal Session turn

**Files:**
- Modify: `server/internal/protocol/session_turn.go`
- Modify: `server/internal/hub/client/session_recorder.go`
- Modify: `server/internal/hub/client/session_search.go`
- Modify: `server/internal/hub/client/session_recovery.go`
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing recorder, search, recovery, and fork tests**

Add a recorder test with an agent message before and after the Steered update:

```go
func TestSessionRecorderStoresSteeredMessageBetweenAgentTurns(t *testing.T) {
	client := newSessionViewTestClient(t)
	ctx := context.Background()
	sessionID := "steer-order"
	events := []SessionViewEvent{
		sessionViewCreatedEvent(sessionID, "Steer ordering"),
		sessionViewPromptEvent(sessionID, "start", nil),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "before"}),
		}),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateUserMessageChunk,
			ContentBlocks: []acp.ContentBlock{
				{Type: acp.ContentBlockTypeText, Text: "change direction"},
				{Type: acp.ContentBlockTypeResourceLink, URI: "file:///tmp/input.png", Name: "input.png"},
			},
			ClientMessageID: "queued-1",
			Steered:         true,
		}),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "after"}),
		}),
		sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn),
	}
	for _, event := range events {
		if err := client.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent(%s): %v", event.Type, err)
		}
	}

	_, turns, err := client.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatal(err)
	}
	wantMethods := []string{
		acp.SessionTurnMethodPromptRequest,
		acp.SessionUpdateAgentMessageChunk,
		acp.SessionUpdateUserMessageChunk,
		acp.SessionUpdateAgentMessageChunk,
		acp.SessionTurnMethodPromptDone,
	}
	if len(turns) != len(wantMethods) {
		t.Fatalf("turn count = %d, want %d: %+v", len(turns), len(wantMethods), turns)
	}
	var payload acp.SessionTurnUserMessage
	for index, turn := range turns {
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
			t.Fatalf("decode turn %d: %v", index, err)
		}
		if message.Method != wantMethods[index] {
			t.Fatalf("turn %d method = %q, want %q", index, message.Method, wantMethods[index])
		}
		if index == 2 {
			if err := json.Unmarshal(message.Param, &payload); err != nil {
				t.Fatalf("decode steered payload: %v", err)
			}
		}
	}
	if payload.ClientMessageID != "queued-1" || !payload.Steered || len(payload.ContentBlocks) != 2 {
		t.Fatalf("steered payload = %+v", payload)
	}
}
```

Add tests for:

```go
func TestSessionRecorderDeduplicatesSteeredClientMessageID(t *testing.T)
func TestSessionSearchReadsSteeredContentBlocks(t *testing.T)
func TestSessionRecoveryKeepsSteeredMessageInsideNativeTurn(t *testing.T)
func TestSessionForkPromptsIncludeSteeredBlocks(t *testing.T)
func TestForkCopiesSteeredAttachmentURIs(t *testing.T)
func TestLegacyUserMessageChunkTextStillReads(t *testing.T)
```

- [ ] **Step 2: Run the focused client tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestSessionRecorder.*Steer|TestSessionSearchReadsSteered|TestSessionRecoveryKeepsSteered|TestSessionForkPromptsIncludeSteered|TestForkCopiesSteered|TestLegacyUserMessage'
```

Expected: build failure because `SessionTurnUserMessage` does not exist, followed by assertion failures until recorder projection is updated.

- [ ] **Step 3: Add the persisted user-message payload**

In `session_turn.go` add:

```go
type SessionTurnUserMessage struct {
	Text            string         `json:"text,omitempty"`
	ContentBlocks   []ContentBlock `json:"contentBlocks,omitempty"`
	ClientMessageID string         `json:"clientMessageId,omitempty"`
	Steered         bool           `json:"steered,omitempty"`
}
```

Keep `SessionTurnTextResult` unchanged for agent/thought/system and legacy payloads.

- [ ] **Step 4: Project one correlated Steer update into one finished turn**

In the Session update parser, split `user_message_chunk` from agent/thought:

```go
case acp.SessionUpdateUserMessageChunk:
	blocks := cloneSessionContentBlocks(params.Update.ContentBlocks)
	if len(blocks) == 0 {
		var block acp.ContentBlock
		if json.Unmarshal(params.Update.Content, &block) == nil && strings.TrimSpace(block.Type) != "" {
			blocks = []acp.ContentBlock{block}
		}
	}
	text := sessionSearchContentBlockText(blocks)
	if text == "" {
		text = extractUpdateText(params.Update.Content)
	}
	clientID := strings.TrimSpace(params.Update.ClientMessageID)
	turnKey := ""
	if clientID != "" {
		turnKey = "user:" + clientID
	}
	parsed.setJSONMessage(method, acp.SessionTurnUserMessage{
		Text:            text,
		ContentBlocks:   blocks,
		ClientMessageID: clientID,
		Steered:         params.Update.Steered,
	}, turnKey)
```

In `addMessageTurn`, use the prefixed turn key to reuse an existing turn index only for the same client message:

```go
case acp.SessionUpdateUserMessageChunk:
	if event.turnKey != "" {
		mergedTurnIndex = state.turnIndexByKey[event.turnKey]
	}
```

The method is not an open streaming text method, so each client message is a finished turn and separate Steers never merge.

- [ ] **Step 5: Update visible text, reload recovery, and fork reconstruction**

Search must prefer blocks and fall back to legacy text:

```go
case acp.SessionUpdateUserMessageChunk:
	var payload acp.SessionTurnUserMessage
	if err := json.Unmarshal(turn.Param, &payload); err != nil {
		return ""
	}
	if text := sessionSearchContentBlockText(payload.ContentBlocks); text != "" {
		return text
	}
	return strings.TrimSpace(payload.Text)
```

Recovery must distinguish the initial native user message from Steered messages and preserve its blocks. Change `startPrompt` to accept blocks:

```go
startPrompt := func(blocks []acp.ContentBlock, fallbackText string) {
	prompt := cloneSessionContentBlocks(blocks)
	if len(prompt) == 0 {
		prompt = []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: fallbackText}}
	}
	_ = r.client.sessionRecorder.RecordEvent(ctx, SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"params": acp.SessionPromptParams{
				SessionID: sessionID,
				Prompt:    prompt,
			},
		}),
	})
}
```

Then update the user-message branch:

```go
if u.Update.SessionUpdate == acp.SessionUpdateUserMessageChunk {
	if u.Update.Steered {
		if !hasPending && !recordedAny {
			if err := r.ensureReplayPromptState(ctx, sessionID); err != nil {
				return
			}
		}
		recordUpdate(u)
		recordedAny = true
		continue
	}
	if hasPending || recordedAny {
		finishPrompt()
		recordedAny = false
	}
	startPrompt(u.Update.ContentBlocks, extractRecoveryUpdateText(u.Update.Content))
	hasPending = true
	continue
}
```

When reconstructing `SessionForkPrompt`, append Steered blocks to the pending native turn:

```go
case acp.SessionUpdateUserMessageChunk:
	var message acp.SessionTurnUserMessage
	if json.Unmarshal(turnMessage.Param, &message) == nil && message.Steered && pending != nil {
		pending = append(pending, cloneSessionContentBlocks(message.ContentBlocks)...)
	}
```

When copying fork history, rewrite attachment URIs inside both `prompt_request` and Steered `user_message_chunk` payloads through `copyForkAttachment`.

- [ ] **Step 6: Run recorder and fork tests**

```powershell
go test ./internal/hub/client -run 'TestSessionRecorder|TestSessionSearch|TestSessionRecovery|TestSessionFork|TestFork'
```

Expected: PASS.

- [ ] **Step 7: Commit ordered transcript support**

```powershell
git add server/internal/protocol/session_turn.go server/internal/hub/client/session_recorder.go server/internal/hub/client/session_search.go server/internal/hub/client/session_recovery.go server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat: persist ordered steered messages"
```

### Task 4: Add the Session side-channel and atomic priority fallback

**Files:**
- Create: `server/internal/hub/client/session_steer.go`
- Create: `server/internal/hub/client/session_steer_test.go`
- Modify: `server/internal/hub/client/session.go`

- [ ] **Step 1: Write failing Session concurrency tests**

Create focused tests using an injected instance whose normal Prompt blocks while `SteerSession` remains callable:

```go
func TestSessionSteerRunsWhilePromptOwnsExecutionLock(t *testing.T) {
	instance := newSteerTestInstance()
	session := newReadySteerTestSession(t, instance)
	promptDone := make(chan error, 1)
	go func() {
		promptDone <- session.handlePromptBlocks([]acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: "initial",
		}})
	}()
	instance.waitForPromptStart(t)

	result, err := session.Steer(context.Background(), acp.SessionSteerParams{
		SessionID:       session.acpSessionID,
		ClientMessageID: "queued-1",
		Blocks: []acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: "steer",
		}},
	})
	if err != nil {
		t.Fatalf("Steer(): %v", err)
	}
	if result.Outcome != acp.SessionSteerOutcomeSteered {
		t.Fatalf("outcome = %q", result.Outcome)
	}
	instance.finishPrompt()
	if err := <-promptDone; err != nil {
		t.Fatal(err)
	}
}

type steerTestCall struct {
	sessionID       string
	clientMessageID string
	blocks          []acp.ContentBlock
}

type steerTestInstance struct {
	*testInjectedInstance
	promptStarted chan string
	promptRelease chan struct{}
	releaseOnce   sync.Once

	mu         sync.Mutex
	steerCalls []steerTestCall
	steerFn    func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error)
}

func newSteerTestInstance() *steerTestInstance {
	instance := &steerTestInstance{
		promptStarted: make(chan string, 16),
		promptRelease: make(chan struct{}),
	}
	instance.testInjectedInstance = &testInjectedInstance{
		name:      string(acp.ACPProviderCodex),
		sessionID: "sess-steer",
		alive:     true,
		promptFn: func(_ context.Context, text string) (<-chan acp.SessionUpdateParams, acp.SessionPromptResult, error) {
			instance.promptStarted <- text
			if text == "initial" {
				<-instance.promptRelease
			}
			updates := make(chan acp.SessionUpdateParams)
			close(updates)
			return updates, acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}, nil
		},
	}
	return instance
}

func (i *steerTestInstance) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []acp.ContentBlock,
) (agent.SessionSteerResult, error) {
	i.mu.Lock()
	i.steerCalls = append(i.steerCalls, steerTestCall{
		sessionID:       sessionID,
		clientMessageID: clientMessageID,
		blocks:          cloneSessionContentBlocks(blocks),
	})
	fn := i.steerFn
	i.mu.Unlock()
	if fn != nil {
		return fn(ctx, sessionID, clientMessageID, blocks)
	}
	return agent.SessionSteerResult{ProviderTurnID: "turn-1"}, nil
}

func (i *steerTestInstance) waitForPromptStart(t *testing.T) string {
	t.Helper()
	select {
	case text := <-i.promptStarted:
		return text
	case <-time.After(time.Second):
		t.Fatal("prompt did not start")
		return ""
	}
}

func (i *steerTestInstance) finishPrompt() {
	i.releaseOnce.Do(func() { close(i.promptRelease) })
}

func newReadySteerTestSession(t *testing.T, instance *steerTestInstance) *Session {
	t.Helper()
	session := mustNewSession(t, "sess-steer", t.TempDir(), string(acp.ACPProviderCodex))
	session.mu.Lock()
	session.instance = instance
	session.acpSessionID = "sess-steer"
	session.initialized = true
	session.ready = true
	session.Status = SessionActive
	session.mu.Unlock()
	instance.SetCallbacks(session)
	return session
}
```

Add:

```go
func TestSessionSteerSerializesRequestsByCallOrder(t *testing.T)
func TestSessionSteerInactiveBecomesPriorityPrompt(t *testing.T)
func TestSessionSteerNonHeadFallbackRunsBeforeNormalSend(t *testing.T)
func TestSessionSteerMultipleFallbacksKeepClickOrder(t *testing.T)
func TestSessionSteerUnavailableDoesNotTakeOwnership(t *testing.T)
func TestSessionSteerProviderFailureDoesNotTakeOwnership(t *testing.T)
func TestSessionSteerDuplicateClientMessageReturnsCachedOutcome(t *testing.T)
```

- [ ] **Step 2: Run the Session steer tests and verify they fail**

```powershell
go test ./internal/hub/client -run '^TestSessionSteer'
```

Expected: build failure because `Session.Steer` and the side-channel state are missing.

- [ ] **Step 3: Add focused steer state and Prompt generations**

Add a steer mutex to `Session` and keep mutable generation state under `s.mu`:

```go
type Session struct {
	// existing fields
	mu       sync.Mutex
	promptMu sync.Mutex
	steerMu  sync.Mutex

	executionKind string
	steerState    sessionSteerState
}
```

Create `session_steer.go` with:

```go
package client

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

type sessionPriorityPrompt struct {
	clientMessageID string
	blocks          []acp.ContentBlock
}

type sessionPromptGeneration struct {
	id        uint64
	completed bool
	inflight  int
	resolved  chan struct{}
	fallbacks []sessionPriorityPrompt
}

type sessionSteerState struct {
	nextGeneration     uint64
	active             *sessionPromptGeneration
	acceptingFallbacks bool
	priority           []sessionPriorityPrompt
	outcomes           map[string]acp.SessionSteerAccepted
	outcomeOrder       []string
}
```

Implement helpers that are always called with `s.mu` held:

```go
func (s *Session) beginPromptGenerationLocked() *sessionPromptGeneration {
	s.steerState.nextGeneration++
	generation := &sessionPromptGeneration{
		id:       s.steerState.nextGeneration,
		resolved: make(chan struct{}),
	}
	s.steerState.active = generation
	return generation
}

func resolvePromptGenerationLocked(generation *sessionPromptGeneration) {
	if generation.completed && generation.inflight == 0 {
		select {
		case <-generation.resolved:
		default:
			close(generation.resolved)
		}
	}
}

func (s *Session) shiftPriorityPromptLocked() (sessionPriorityPrompt, bool) {
	if len(s.steerState.priority) == 0 {
		return sessionPriorityPrompt{}, false
	}
	next := s.steerState.priority[0]
	s.steerState.priority = s.steerState.priority[1:]
	return next, true
}

func (s *Session) finishSteerAttempt(
	generation *sessionPromptGeneration,
	fallback *sessionPriorityPrompt,
) {
	s.mu.Lock()
	if fallback != nil {
		generation.fallbacks = append(generation.fallbacks, *fallback)
	}
	if generation.inflight > 0 {
		generation.inflight--
	}
	resolvePromptGenerationLocked(generation)
	s.mu.Unlock()
}

func (s *Session) cacheSteerOutcome(
	clientMessageID string,
	outcome string,
) acp.SessionSteerAccepted {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cached, ok := s.steerState.outcomes[clientMessageID]; ok {
		return cached
	}
	accepted := acp.SessionSteerAccepted{
		OK:              true,
		Accepted:        true,
		SessionID:       s.acpSessionID,
		ClientMessageID: clientMessageID,
		Outcome:         outcome,
	}
	if s.steerState.outcomes == nil {
		s.steerState.outcomes = make(map[string]acp.SessionSteerAccepted)
	}
	s.steerState.outcomes[clientMessageID] = accepted
	s.steerState.outcomeOrder = append(s.steerState.outcomeOrder, clientMessageID)
	if len(s.steerState.outcomeOrder) > 256 {
		evicted := s.steerState.outcomeOrder[0]
		s.steerState.outcomeOrder = s.steerState.outcomeOrder[1:]
		delete(s.steerState.outcomes, evicted)
	}
	return accepted
}
```

- [ ] **Step 4: Refactor one Prompt execution into a loop that drains priority handoffs before unlocking**

Rename the current `handlePromptBlocks` implementation to `runPromptBlocks`. Remove only its empty-input check, `beginExecution("prompt")`, and deferred `endExecution`; keep the existing body from the first `recordSessionViewEvent` call through its final return unchanged. This private method executes exactly one provider turn and assumes `promptMu` is already owned.

Replace `handlePromptBlocks` with:

```go
func (s *Session) handlePromptBlocks(blocks []acp.ContentBlock) error {
	if len(blocks) == 0 {
		return nil
	}
	if err := s.beginExecution("prompt"); err != nil {
		return err
	}
	return s.runPromptExecution(blocks)
}

func (s *Session) runPromptExecution(initial []acp.ContentBlock) error {
	defer s.endExecution()
	s.mu.Lock()
	s.steerState.acceptingFallbacks = true
	s.mu.Unlock()
	blocks := cloneSessionContentBlocks(initial)
	for len(blocks) > 0 {
		s.mu.Lock()
		generation := s.beginPromptGenerationLocked()
		s.mu.Unlock()

		runErr := s.runPromptBlocks(blocks)

		s.mu.Lock()
		generation.completed = true
		resolvePromptGenerationLocked(generation)
		resolved := generation.resolved
		s.mu.Unlock()
		<-resolved

		s.mu.Lock()
		s.steerState.priority = append(s.steerState.priority, generation.fallbacks...)
		if s.steerState.active == generation {
			s.steerState.active = nil
		}
		next, ok := s.shiftPriorityPromptLocked()
		if !ok {
			s.steerState.acceptingFallbacks = false
		}
		s.mu.Unlock()
		if !ok {
			return runErr
		}
		blocks = next.blocks
	}
	return nil
}
```

The `acceptingFallbacks` transition and the final empty-queue check happen in the same `s.mu` critical section. Keeping `promptMu` until that transition prevents a late accepted fallback from being stranded between the last queue check and `endExecution`.

- [ ] **Step 5: Implement serialized Steer and inactive fallback ownership**

Implement:

```go
func (s *Session) Steer(
	ctx context.Context,
	params acp.SessionSteerParams,
) (acp.SessionSteerAccepted, error) {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	if err := ctx.Err(); err != nil {
		return acp.SessionSteerAccepted{}, err
	}

	clientID := strings.TrimSpace(params.ClientMessageID)
	if clientID == "" || len(params.Blocks) == 0 {
		return acp.SessionSteerAccepted{}, fmt.Errorf("clientMessageId and blocks are required")
	}
	s.mu.Lock()
	if cached, ok := s.steerState.outcomes[clientID]; ok {
		s.mu.Unlock()
		return cached, nil
	}
	generation := s.steerState.active
	executionKind := s.executionKind
	instance := s.instance
	sessionID := s.acpSessionID
	if generation != nil && !generation.completed {
		generation.inflight++
	}
	s.mu.Unlock()

	if generation == nil || generation.completed {
		if executionKind != "" && executionKind != "prompt" {
			return acp.SessionSteerAccepted{}, agent.ErrSessionSteerUnavailable
		}
		return s.acceptIdleSteerFallback(ctx, params)
	}
	if instance == nil {
		handoff := &sessionPriorityPrompt{
			clientMessageID: clientID,
			blocks:          cloneSessionContentBlocks(params.Blocks),
		}
		s.finishSteerAttempt(generation, handoff)
		return s.cacheSteerOutcome(clientID, acp.SessionSteerOutcomeSent), nil
	}
	steerer, ok := instance.(agent.SessionSteerer)
	if !ok {
		s.finishSteerAttempt(generation, nil)
		return acp.SessionSteerAccepted{}, agent.ErrSessionActionUnsupported
	}
	_, err := steerer.SteerSession(ctx, sessionID, clientID, params.Blocks)
	if errors.Is(err, agent.ErrSessionSteerInactive) {
		handoff := &sessionPriorityPrompt{
			clientMessageID: clientID,
			blocks:          cloneSessionContentBlocks(params.Blocks),
		}
		s.finishSteerAttempt(generation, handoff)
		return s.cacheSteerOutcome(clientID, acp.SessionSteerOutcomeSent), nil
	}
	s.finishSteerAttempt(generation, nil)
	if err != nil {
		return acp.SessionSteerAccepted{}, err
	}
	return s.cacheSteerOutcome(clientID, acp.SessionSteerOutcomeSteered), nil
}
```

`acceptIdleSteerFallback` must acquire Prompt execution ownership before returning:

```go
func (s *Session) acceptIdleSteerFallback(
	ctx context.Context,
	params acp.SessionSteerParams,
) (acp.SessionSteerAccepted, error) {
	for {
		s.mu.Lock()
		executionKind := s.executionKind
		if executionKind != "" && executionKind != "prompt" {
			s.mu.Unlock()
			return acp.SessionSteerAccepted{}, agent.ErrSessionSteerUnavailable
		}
		if executionKind == "prompt" && s.steerState.acceptingFallbacks {
			s.steerState.priority = append(s.steerState.priority, sessionPriorityPrompt{
				clientMessageID: params.ClientMessageID,
				blocks:          cloneSessionContentBlocks(params.Blocks),
			})
			s.mu.Unlock()
			return s.cacheSteerOutcome(params.ClientMessageID, acp.SessionSteerOutcomeSent), nil
		}
		s.mu.Unlock()

		if s.promptMu.TryLock() {
			s.mu.Lock()
			s.executionKind = "prompt"
			s.steerState.acceptingFallbacks = true
			s.mu.Unlock()
			blocks := cloneSessionContentBlocks(params.Blocks)
			go func() {
				if err := s.runPromptExecution(blocks); err != nil {
					hubLogger(s.projectName).Warn(
						"steer fallback prompt failed session=%s clientMessageId=%s err=%v",
						s.acpSessionID,
						params.ClientMessageID,
						err,
					)
				}
			}()
			return s.cacheSteerOutcome(params.ClientMessageID, acp.SessionSteerOutcomeSent), nil
		}

		select {
		case <-ctx.Done():
			return acp.SessionSteerAccepted{}, ctx.Err()
		case <-time.After(time.Millisecond):
		}
	}
}
```

The retry covers the narrow state where the current loop has closed `acceptingFallbacks` but has not yet released `promptMu`; it never reports accepted until this Session either appended to an owned loop or acquired the next Prompt execution itself. Clear `active`, `acceptingFallbacks`, `priority`, `outcomes`, and `outcomeOrder` on Session reset/suspend. Do not persist this runtime-only state.

- [ ] **Step 6: Run concurrency tests with the race detector**

```powershell
go test -race ./internal/hub/client -run '^TestSessionSteer'
```

Expected: PASS with no data race.

- [ ] **Step 7: Run existing prompt/compact/cancel regressions**

```powershell
go test ./internal/hub/client -run 'Test.*(Prompt|Compact|Cancel|Busy)'
```

Expected: PASS; Compact remains exclusive and ordinary Prompt behavior is unchanged.

- [ ] **Step 8: Commit Session orchestration**

```powershell
git add server/internal/hub/client/session_steer.go server/internal/hub/client/session_steer_test.go server/internal/hub/client/session.go
git commit -m "feat: orchestrate session steer fallback"
```

### Task 5: Expose `session.steer` through Client and reuse attachment preparation

**Files:**
- Modify: `server/internal/hub/client/client.go`
- Modify: `server/internal/hub/client/client_test.go`

- [ ] **Step 1: Write failing request/capability/attachment tests**

Add:

```go
func TestHandleSessionSteerPreparesBlocksAndReturnsOutcome(t *testing.T) {
	client, instance := newSteerRequestTestClient(t)
	session, err := client.SessionByID(context.Background(), "sess-1")
	if err != nil {
		t.Fatal(err)
	}
	promptDone := make(chan error, 1)
	go func() {
		promptDone <- session.handlePromptBlocks([]acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: "initial",
		}})
	}()
	instance.waitForPromptStart(t)

	response, err := client.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionSteer,
		"test",
		json.RawMessage(`{
			"sessionId":"sess-1",
			"clientMessageId":"queued-1",
			"blocks":[{"type":"text","text":"change direction"}]
		}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	accepted := response.(acp.SessionSteerAccepted)
	if !accepted.Accepted || accepted.Outcome != acp.SessionSteerOutcomeSteered {
		t.Fatalf("accepted = %+v", accepted)
	}
	instance.finishPrompt()
	if err := <-promptDone; err != nil {
		t.Fatal(err)
	}
}

func newSteerRequestTestClient(t *testing.T) (*Client, *steerTestInstance) {
	t.Helper()
	client := newSessionViewTestClient(t)
	session, err := client.newWiredSession("sess-1", string(acp.ACPProviderCodex))
	if err != nil {
		t.Fatalf("newWiredSession: %v", err)
	}
	instance := newSteerTestInstance()
	instance.sessionID = "sess-1"
	session.mu.Lock()
	session.instance = instance
	session.acpSessionID = "sess-1"
	session.initialized = true
	session.ready = true
	session.Status = SessionActive
	session.mu.Unlock()
	instance.SetCallbacks(session)
	client.mu.Lock()
	client.sessions["sess-1"] = session
	client.mu.Unlock()
	return client, instance
}
```

Add tests for missing Session ID, missing client message ID, empty blocks, unsupported provider, attachment preparation/mark-sent after accepted ownership, inactive fallback outcome, and provider failure leaving attachments unsent.

- [ ] **Step 2: Run the request tests and verify they fail**

```powershell
go test ./internal/hub/client -run 'TestHandleSessionSteer|TestSessionActions'
```

Expected: `session.steer` falls through or reports unsupported because Client routing and capability lookup are missing.

- [ ] **Step 3: Expose Steer in Session summaries and action checks**

Extend action projection:

```go
Steer: acp.SessionActionCapability{
	Supported: support.Steer,
	Reason:    unsupportedSessionActionReason(support.Steer),
},
```

Extend unsupported capabilities:

```go
Steer: acp.SessionActionCapability{Supported: false, Reason: reason},
```

Extend `sessionSupportsAction`:

```go
case acp.SessionActionSteer:
	return support.Steer
```

- [ ] **Step 4: Add the Client request handler**

Add before `session.send`:

```go
case acp.RegistryMethodSessionSteer:
	var req acp.SessionSteerParams
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid session.steer payload: %w", err)
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.ClientMessageID = strings.TrimSpace(req.ClientMessageID)
	if req.SessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	if req.ClientMessageID == "" {
		return nil, fmt.Errorf("clientMessageId is required")
	}
	if len(req.Blocks) == 0 {
		return nil, fmt.Errorf("session steer is empty")
	}
	sess, err := c.SessionByID(ctx, req.SessionID)
	if err != nil {
		return nil, err
	}
	if !c.sessionSupportsAction(sess, acp.SessionActionSteer) {
		return nil, fmt.Errorf("%w: steer", agent.ErrSessionActionUnsupported)
	}
	blocks, attachmentRefs, err := c.prepareSessionPromptBlocks(ctx, req.SessionID, req.Blocks)
	if err != nil {
		return nil, err
	}
	req.Blocks = blocks
	accepted, err := sess.Steer(ctx, req)
	if err != nil {
		return nil, err
	}
	if err := c.markSessionAttachmentsSent(attachmentRefs); err != nil {
		return nil, err
	}
	return accepted, nil
```

Do not call `PromptToSession` from this handler; Session owns fallback.

- [ ] **Step 5: Run Client tests**

```powershell
go test ./internal/hub/client -run 'TestHandleSessionSteer|TestSessionActions|TestSessionAttachment'
```

Expected: PASS.

- [ ] **Step 6: Commit the Registry-to-Session route**

```powershell
git add server/internal/hub/client/client.go server/internal/hub/client/client_test.go
git commit -m "feat: expose session steer request"
```

### Task 6: Add Web Registry contracts and queue steering state

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Modify: `app/web/src/chat/session/chatPromptQueue.ts`
- Modify: `app/__tests__/web-session-actions-service.test.ts`
- Modify: `app/__tests__/web-chat-prompt-queue-state.test.ts`

- [ ] **Step 1: Write failing repository and queue state tests**

Add:

```ts
it('sends session.steer and normalizes the accepted outcome', async () => {
  client.request.mockResolvedValue({
    payload: {
      ok: true,
      accepted: true,
      sessionId: 's1',
      clientMessageId: 'queued-1',
      outcome: 'steered',
    },
  });
  await expect(repository.steerSession('project-a', {
    sessionId: 's1',
    clientMessageId: 'queued-1',
    blocks: [{type: 'text', text: 'change direction'}],
  })).resolves.toEqual({
    ok: true,
    accepted: true,
    sessionId: 's1',
    clientMessageId: 'queued-1',
    outcome: 'steered',
  });
  expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'session.steer',
    projectId: 'project-a',
  }));
});
```

Queue tests:

```ts
it('marks one prompt steering without moving it', () => {
  const next = setQueuedChatPromptSteering(state, 'project:s1', '2', true);
  expect(next['project:s1'].map(item => item.id)).toEqual(['1', '2', '3']);
  expect(next['project:s1'][1]).toMatchObject({id: '2', status: 'steering'});
});

it('prevents drain while a steer is pending', () => {
  expect(hasSteeringChatPrompt(steeringState, 'project:s1')).toBe(true);
  expect(shiftNextQueuedChatItem(steeringState, 'project:s1').item).toBeNull();
});
```

- [ ] **Step 2: Run the Web tests and verify they fail**

Run from `app`:

```powershell
npm test -- --runInBand web-session-actions-service.test.ts web-chat-prompt-queue-state.test.ts
```

Expected: TypeScript/Jest failure because Steer contracts and queue helpers are missing.

- [ ] **Step 3: Add Registry types, normalization, repository, and service methods**

Add:

```ts
export interface RegistrySessionActionCapabilities {
  status: RegistrySessionActionCapability;
  compact: RegistrySessionActionCapability;
  steer: RegistrySessionActionCapability;
}

export type RegistrySessionSteerOutcome = 'steered' | 'sent';

export interface RegistrySessionSteerAccepted {
  ok: boolean;
  accepted: boolean;
  sessionId: string;
  clientMessageId: string;
  outcome: RegistrySessionSteerOutcome;
}
```

Add `SessionSteer: 'session.steer'` and normalize missing capability data as unsupported:

```ts
return {
  status: this.normalizeSessionActionCapability(input.status),
  compact: this.normalizeSessionActionCapability(input.compact),
  steer: this.normalizeSessionActionCapability(input.steer),
};
```

Repository:

```ts
async steerSession(
  projectId: string,
  payload: {
    sessionId: string;
    clientMessageId: string;
    blocks: RegistrySessionContentBlock[];
  },
): Promise<RegistrySessionSteerAccepted> {
  const response = await this.client.request({
    method: RegistryMethods.SessionSteer,
    projectId,
    payload,
    timeoutMs: 30000,
  });
  const body = response.payload && typeof response.payload === 'object'
    ? response.payload as Record<string, unknown>
    : {};
  const outcome = body.outcome === 'sent' ? 'sent' : 'steered';
  return {
    ok: body.ok === true,
    accepted: body.accepted === true,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : payload.sessionId,
    clientMessageId: typeof body.clientMessageId === 'string'
      ? body.clientMessageId
      : payload.clientMessageId,
    outcome,
  };
}
```

Expose the same call through `RegistryWorkspaceService.steerProjectSession`.

- [ ] **Step 4: Add queue item state and pure helpers**

Extend prompts:

```ts
export type QueuedChatPrompt = {
  kind: 'prompt';
  id: string;
  sessionId: string;
  blocks: RegistryChatContentBlock[];
  createdAt: string;
  text: string;
  status: 'queued' | 'steering';
};
```

Add:

```ts
export function setQueuedChatPromptSteering(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
  promptId: string,
  steering: boolean,
): QueuedChatItemsByKey {
  const current = state[runtimeKey] ?? [];
  let changed = false;
  const next = current.map(item => {
    if (item.kind !== 'prompt' || item.id !== promptId) return item;
    changed = true;
    return {...item, status: steering ? 'steering' as const : 'queued' as const};
  });
  return changed ? {...state, [runtimeKey]: next} : state;
}

export function hasSteeringChatPrompt(
  state: QueuedChatItemsByKey,
  runtimeKey: string,
): boolean {
  return (state[runtimeKey] ?? []).some(
    item => item.kind === 'prompt' && item.status === 'steering',
  );
}
```

Make `shiftNextQueuedChatItem` return no item while any prompt in that Session is steering. Include `queueStatus: prompt.status` in `buildQueuedPromptMessage`.

- [ ] **Step 5: Run Web contract/state tests**

```powershell
npm test -- --runInBand web-session-actions-service.test.ts web-chat-prompt-queue-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Web contracts and queue state**

```powershell
git add app/web/src/registry/registryMethods.ts app/web/src/registry/registryTypes.ts app/web/src/registry/RegistryRepository.ts app/web/src/registry/RegistryWorkspaceService.ts app/web/src/chat/session/chatPromptQueue.ts app/__tests__/web-session-actions-service.test.ts app/__tests__/web-chat-prompt-queue-state.test.ts
git commit -m "feat: add web steer contracts"
```

### Task 7: Wire Steer orchestration into Workspace and reconcile live acceptance

**Files:**
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`
- Modify: `app/__tests__/web-chat-session-ordering.test.ts`

- [ ] **Step 1: Write failing Workspace contract tests**

Add source-contract assertions for:

```ts
expect(mainTsx).toContain('service.steerProjectSession(');
expect(mainTsx).toContain('setQueuedChatPromptSteering(current, runtimeKey, prompt.id, true)');
expect(mainTsx).toContain("message.method === 'user_message_chunk'");
expect(mainTsx).toContain("message.param.steered === true");
expect(mainTsx).toContain('hasSteeringChatPrompt(chatQueuedPromptsByKeyRef.current, runtimeKey)');
expect(mainTsx).toContain('chatAcceptedSteerIdsByKeyRef.current[runtimeKey]?.has(prompt.id)');
```

Extend session ordering fixtures so missing `sessionActions.steer` normalizes to unsupported and merges without dropping an existing Steer capability.

- [ ] **Step 2: Run Workspace tests and verify they fail**

```powershell
npm test -- --runInBand web-chat-turn-rendering.test.ts web-chat-ui.test.ts web-chat-session-ordering.test.ts
```

Expected: FAIL because no Workspace Steer callback or live client-message reconciliation exists.

- [ ] **Step 3: Add a per-Session promise chain and Steer action**

Add:

```ts
const chatSteerChainsByKeyRef = useRef<Record<string, Promise<void>>>({});
const chatAcceptedSteerIdsByKeyRef = useRef<Record<string, Set<string>>>({});

const steerQueuedPrompt = useCallback((
  projectId: string,
  runtimeKey: string,
  prompt: QueuedChatPrompt,
) => {
  setQueuedPrompts(current =>
    setQueuedChatPromptSteering(current, runtimeKey, prompt.id, true));

  const previous = chatSteerChainsByKeyRef.current[runtimeKey] ?? Promise.resolve();
  const next = previous.then(async () => {
    try {
      const result = await service.steerProjectSession(projectId, {
        sessionId: prompt.sessionId,
        clientMessageId: prompt.id,
        blocks: prompt.blocks,
      });
      if (!result.ok || !result.accepted) {
        throw new Error('session.steer returned accepted=false');
      }
      setQueuedPrompts(current =>
        cancelQueuedChatPrompt(current, runtimeKey, prompt.id));
    } catch (errorValue) {
      if (chatAcceptedSteerIdsByKeyRef.current[runtimeKey]?.has(prompt.id)) {
        return;
      }
      setQueuedPrompts(current =>
        setQueuedChatPromptSteering(current, runtimeKey, prompt.id, false));
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }
  }).finally(() => {
    const acceptedIds = chatAcceptedSteerIdsByKeyRef.current[runtimeKey];
    acceptedIds?.delete(prompt.id);
    if (acceptedIds?.size === 0) {
      const remainingAccepted = {...chatAcceptedSteerIdsByKeyRef.current};
      delete remainingAccepted[runtimeKey];
      chatAcceptedSteerIdsByKeyRef.current = remainingAccepted;
    }
    if (chatSteerChainsByKeyRef.current[runtimeKey] === next) {
      const remaining = {...chatSteerChainsByKeyRef.current};
      delete remaining[runtimeKey];
      chatSteerChainsByKeyRef.current = remaining;
    }
  });
  chatSteerChainsByKeyRef.current[runtimeKey] = next;
}, [service, setQueuedPrompts]);
```

Set `status: 'queued'` when creating every `QueuedChatPrompt`.

- [ ] **Step 4: Reconcile `session.message` before RPC completion**

In the existing `session.message` handler add:

```ts
if (
  message.method === 'user_message_chunk' &&
  message.param.steered === true &&
  typeof message.param.clientMessageId === 'string'
) {
  const clientMessageId = message.param.clientMessageId;
  const pending = chatQueuedPromptsByKeyRef.current[runtimeKey] ?? [];
  if (pending.some(
    item => item.kind === 'prompt' &&
      item.id === clientMessageId &&
      item.status === 'steering',
  )) {
    const accepted = chatAcceptedSteerIdsByKeyRef.current[runtimeKey] ?? new Set<string>();
    accepted.add(clientMessageId);
    chatAcceptedSteerIdsByKeyRef.current = {
      ...chatAcceptedSteerIdsByKeyRef.current,
      [runtimeKey]: accepted,
    };
  }
  setQueuedPrompts(current => cancelQueuedChatPrompt(
    current,
    runtimeKey,
    clientMessageId,
  ));
}
```

This makes notification-first and response-first delivery idempotent, and suppresses a late RPC error only when the transcript notification already proved acceptance.

- [ ] **Step 5: Gate visibility and queue drain**

Compute availability from static capability plus current ordinary Prompt state:

```ts
const queuedPromptCanSteer =
  selectedChatSession?.sessionActions?.steer?.supported === true &&
  selectedChatSession?.running === true &&
  chatCompactingByKeyRef.current[selectedChatEncodedKey] !== true;
```

Do not shift the next queue item while Steer ownership is unresolved:

```ts
if (hasSteeringChatPrompt(chatQueuedPromptsByKeyRef.current, runtimeKey)) return;
```

Pass `onSteerQueuedPrompt` only when `queuedPromptCanSteer` is true. Pass the queued item’s `status` to the view.

- [ ] **Step 6: Run Workspace tests**

```powershell
npm test -- --runInBand web-chat-turn-rendering.test.ts web-chat-ui.test.ts web-chat-session-ordering.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Workspace orchestration**

```powershell
git add app/web/src/app/WorkspaceApp.tsx app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-ui.test.ts app/__tests__/web-chat-session-ordering.test.ts
git commit -m "feat: steer queued chat prompts"
```

### Task 8: Render the three icons and Steered history marker

**Files:**
- Modify: `app/web/src/chat/ChatIcon.tsx`
- Modify: `app/web/src/chat/ChatIcon.test.tsx`
- Modify: `app/web/src/chat/ChatTurnView.tsx`
- Modify: `app/web/src/chat/turns/chatPromptStatus.ts`
- Modify: `app/web/src/styles/chat.css`
- Modify: `app/__tests__/web-chat-prompt-status.test.ts`
- Modify: `app/__tests__/web-chat-turn-rendering.test.ts`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing icon, rendering, and status tests**

Add component/source assertions:

```ts
expect(chatTurn).toContain('title="Steer"');
expect(chatTurn).toContain('aria-label="Steer"');
expect(chatTurn).toContain('<ChatIcon name="cornerDownLeft"');
expect(chatTurn).toContain('title="Next"');
expect(chatTurn).toContain('<ChatIcon name="arrowUpToLine"');
expect(chatTurn).toContain('title="Cancel"');
expect(chatTurn).not.toContain('Send next');
expect(chatTurn).toContain('chat-prompt-steered-label');
```

Add a status unit test proving a Steered user message does not replace the open `prompt_request`:

```ts
it('does not treat a steered user message as a new prompt start', () => {
  const request = message('prompt_request', 1, {});
  const steered = message('user_message_chunk', 3, {
    steered: true,
    contentBlocks: [{type: 'text', text: 'change'}],
  });
  const index = buildPromptTurnStatusIndex([request, steered]);
  expect(index.statusFor(request)).toBe('responding');
  expect(index.statusFor(steered)).toBeNull();
});
```

- [ ] **Step 2: Run the UI tests and verify they fail**

```powershell
npm test -- --runInBand ChatIcon.test.tsx web-chat-prompt-status.test.ts web-chat-turn-rendering.test.ts web-chat-ui.test.ts
```

Expected: FAIL because icon names, icon-only buttons, and Steered status handling are missing.

- [ ] **Step 3: Add the exact Lucide glyphs**

Add to `GLYPHS`:

```tsx
// lucide:corner-down-left
cornerDownLeft: (
  <>
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    <path d="m9 10-5 5 5 5" />
  </>
),
// lucide:arrow-up-to-line
arrowUpToLine: (
  <>
    <path d="M5 3h14" />
    <path d="m18 13-6-6-6 6" />
    <path d="M12 7v14" />
  </>
),
```

`ChatIconName` updates automatically from `keyof typeof GLYPHS`; the existing icon snapshot/render-all test must continue to pass.

- [ ] **Step 4: Render Steer, Next, Cancel as icon-only actions**

Extend props:

```ts
onSteerQueuedPrompt?: () => void;
queuedPromptSteering?: boolean;
```

Render:

```tsx
{promptStatus === 'queued' || promptStatus === 'steering' ? (
  <div className="chat-prompt-queue-actions">
    {onSteerQueuedPrompt ? (
      <button
        type="button"
        className="chat-prompt-queue-action"
        title="Steer"
        aria-label="Steer"
        disabled={queuedPromptSteering}
        onClick={onSteerQueuedPrompt}
      >
        <ChatIcon name="cornerDownLeft" />
      </button>
    ) : null}
    <button
      type="button"
      className="chat-prompt-queue-action"
      title="Next"
      aria-label="Next"
      disabled={queuedPromptSteering}
      onClick={onPrioritizeQueuedPrompt}
    >
      <ChatIcon name="arrowUpToLine" />
    </button>
    <button
      type="button"
      className="chat-prompt-queue-action danger"
      title="Cancel"
      aria-label="Cancel"
      disabled={queuedPromptSteering}
      onClick={onCancelQueuedPrompt}
    >
      <ChatIcon name="x" />
    </button>
  </div>
) : null}
```

Add `'steering'` to `ChatPromptStatus` and show `Steering` instead of `Queued` while pending.

- [ ] **Step 5: Render the marker without changing copied/searchable text**

Beside the user bubble add:

```tsx
{message.method === 'user_message_chunk' && message.param.steered === true ? (
  <span className="chat-prompt-steered-label" title="Inserted into the active turn">
    Steered
  </span>
) : null}
```

Update prompt status indexing:

```ts
function isPromptStart(message: RegistryChatMessage): boolean {
  if (message.method === 'prompt_request') return true;
  return message.method === 'user_message_chunk' && message.param.steered !== true;
}
```

This preserves legacy replay behavior while preventing Steered messages from stealing the active Prompt’s responding state.

- [ ] **Step 6: Tighten queue action and marker styles**

Replace text-button sizing with square controls:

```css
.chat-prompt-queue-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.chat-prompt-queue-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--surface-panel);
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}

.chat-prompt-queue-action:disabled {
  cursor: default;
  opacity: 0.46;
}

.chat-prompt-steered-label {
  align-self: flex-end;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 18px;
}
```

Keep the existing danger hover color and add `:focus-visible` using the project’s existing accent outline convention.

- [ ] **Step 7: Run UI tests and TypeScript**

```powershell
npm test -- --runInBand ChatIcon.test.tsx web-chat-prompt-status.test.ts web-chat-turn-rendering.test.ts web-chat-ui.test.ts
npm run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit UI**

```powershell
git add app/web/src/chat/ChatIcon.tsx app/web/src/chat/ChatIcon.test.tsx app/web/src/chat/ChatTurnView.tsx app/web/src/chat/turns/chatPromptStatus.ts app/web/src/styles/chat.css app/__tests__/web-chat-prompt-status.test.ts app/__tests__/web-chat-turn-rendering.test.ts app/__tests__/web-chat-ui.test.ts
git commit -m "feat: add steer queue controls"
```

### Task 9: Verify end-to-end behavior and completion gates

**Files:**
- Verify and, only when a regression is found, return to the owning file list in Tasks 1–8
- Verify: `docs/scope/2026-07-26-session-steer.md`

- [ ] **Step 1: Run focused Go tests with the race detector**

```powershell
go test -race ./internal/hub/agent ./internal/hub/client
```

Expected: PASS.

- [x] **Step 2: Run the complete Go suite**

Run from `server`:

```powershell
go test ./...
```

Expected: PASS.

- [x] **Step 3: Run focused and complete Web tests**

Run from `app`:

```powershell
npm test -- --runInBand web-session-actions-service.test.ts web-chat-prompt-queue-state.test.ts web-chat-prompt-status.test.ts web-chat-turn-rendering.test.ts web-chat-ui.test.ts web-chat-session-ordering.test.ts
npm test -- --runInBand
```

Expected: PASS.

- [x] **Step 4: Run Web typecheck and production build**

```powershell
npm run tsc:web
npm run build:web
```

Expected: both commands succeed.

- [ ] **Step 5: Run a real Codex smoke test**

With a Codex Session actively streaming:

```text
1. Submit two queued prompts.
2. Steer the second, non-head prompt.
3. Confirm the current Codex turn continues without turn/interrupt.
4. Confirm one Steered user turn appears before subsequent agent/tool turns.
5. Let another Steer race with turn completion.
6. Confirm it becomes the next prompt and the original queue head stays behind it.
7. Start Compact and confirm queued prompts show only Next and Cancel.
```

Expected: no duplicate transcript turns, no dropped queue items, and no provider IDs visible in Web.

- [x] **Step 6: Compare implementation against every spec acceptance criterion**

Use this explicit checklist:

```text
Capability: generic, Codex-only implementation, unsupported providers hidden
Queue: default enqueue, Steer/Next/Cancel order, multiple serialized Steers
Content: exact ordinary Send preparation/conversion path
Concurrency: no promptMu acquisition, no interrupt, streaming continues
Ordering: userMessage item/started anchors the internal turn
Fallback: Session-owned priority prompt, no client second-send race
History: one contentBlocks turn, Steered marker, search/fork/reload compatibility
Reliability: clientMessageId dedupe and notification/response reordering
Compatibility: Registry version remains 2.6
```

Expected: every line maps to passing automated coverage or the smoke test.

- [x] **Step 7: Check the final worktree and commit any verification-only fixes**

```powershell
git status --short
git diff --check
```

If verification required code changes, return to the owning Task, rerun that Task’s focused tests, stage only the exact file paths from its **Files** list that changed, and commit them with `git commit -m "fix: close session steer regressions"`.

Expected: no unstaged implementation changes and no whitespace errors.

- [x] **Step 8: Push the completed implementation**

```powershell
git push
```

Expected: the current branch is published with all Task commits.

### Verification record (2026-07-26)

- Complete Go suite: PASS.
- Focused Web suites: PASS, 104 tests.
- Complete Web suite: PASS, 230 suites and 1320 tests.
- Web typecheck and production build: PASS.
- Repeated Session Steer Go coverage: PASS, 20 consecutive runs.
- Race detector: not available in this Windows environment because CGO is disabled
  and no C compiler is installed; the corresponding non-race tests pass.
- Live Codex smoke test: intentionally left as a manual check requiring an
  authenticated, actively streaming Codex session. Automated app-server contract
  tests cover response/notification reordering, correlation, fallback, and
  concurrent same-session turn delivery.
