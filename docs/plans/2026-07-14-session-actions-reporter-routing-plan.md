# Session Actions Reporter Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward `session.status` and `session.compact` from Hub Reporter to the registered session handler.

**Architecture:** Registry method descriptors and `client.Client` already support these actions. The missing boundary is the Hub Reporter’s session-method switch; add the two methods there and lock the behavior with its existing WebSocket-level Reporter test fixtures.

**Tech Stack:** Go, `net/http/httptest`, Gorilla WebSocket.

---

### Task 1: Add a failing Reporter regression test

**Files:**
- Modify: `server/internal/hub/hub_test.go` after `TestReporterRespondsToSessionRequests`
- Test: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestReporterForwardsSessionActionRequests(t *testing.T) {
	for _, method := range []string{rp.RegistryMethodSessionStatus, rp.RegistryMethodSessionCompact} {
		t.Run(method, func(t *testing.T) {
			respSeen := make(chan testEnvelope, 1)
			errSeen := make(chan error, 1)
			server := newFakeReporterRegistry(t, "hub-session-actions", testEnvelope{
				RequestID: 100,
				Type:      rp.RegistryEnvelopeTypeRequest,
				Method:    method,
				ProjectID: rp.ProjectID("hub-session-actions", "proj1"),
				Payload:   map[string]any{"sessionId": "sess-1"},
			}, respSeen, errSeen)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reporter := NewReporter(ReporterConfig{Server: strings.TrimPrefix(server.URL, "http://"), HubID: "hub-session-actions", ReconnectInterval: 50 * time.Millisecond}, []ProjectInfo{{Name: "proj1", Path: t.TempDir(), Online: true}})
			handler := &stubSessionHandler{}
			reporter.RegisterSessionHandler(rp.ProjectID("hub-session-actions", "proj1"), handler)
			done := make(chan error, 1)
			go func() { done <- reporter.Run(ctx) }()
			defer stopReporterForTest(t, cancel, done)
			select {
			case err := <-errSeen:
				t.Fatalf("fake registry error: %v", err)
			case response := <-respSeen:
				if response.Type != rp.RegistryEnvelopeTypeResponse || response.Method != method {
					t.Fatalf("response=%#v, want response for %s", response, method)
				}
				if handler.lastMethod != method || !strings.Contains(handler.lastBody, `"sessionId":"sess-1"`) {
					t.Fatalf("handler saw method=%q body=%q", handler.lastMethod, handler.lastBody)
				}
			case <-time.After(2 * time.Second):
				t.Fatalf("did not receive %s response from reporter", method)
			}
		})
	}
}
```

- [ ] **Step 2: Confirm RED**

Run `go test ./internal/hub -run '^TestReporterForwardsSessionActionRequests$' -count=1`.

Expected: both subtests fail because Reporter returns `unsupported method on hub`.

### Task 2: Route both actions through the existing session path

**Files:**
- Modify: `server/internal/hub/reporter.go` in `handleRegistryRequest`
- Test: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Make the smallest production change**

```go
		rp.RegistryMethodSessionMarkRead, rp.RegistryMethodSessionConfig,
		rp.RegistryMethodSessionStatus, rp.RegistryMethodSessionCompact,
		rp.RegistryMethodSessionAttachmentStart, rp.RegistryMethodSessionAttachmentChunk,
```

- [ ] **Step 2: Confirm GREEN**

Run `go test ./internal/hub -run '^TestReporterForwardsSessionActionRequests$' -count=1`.

Expected: PASS; both methods reach `stubSessionHandler` and return regular responses.

### Task 3: Verify and hand off the repair

**Files:**
- Modify: none
- Test: server suite and runtime deployment boundary

- [ ] **Step 1: Run the Hub package suite**

Run `go test ./internal/hub -count=1`.

Expected: PASS.

- [ ] **Step 2: Run the full server suite**

Run `go test ./...`.

Expected: PASS.

- [ ] **Step 3: Commit and push**

Run `git add -A`, `git commit -m "fix: forward session action requests from hub"`, then `git push origin main`.

Expected: clean `main` synchronized with `origin/main`.

- [ ] **Step 4: Verify deployment separately**

After explicit authorization to update the publishing environment, verify the Hub log no longer contains `connect.init failed: INVALID_ARGUMENT: unsupported protocolVersion`, then manually send a prompt and invoke `/status` and `/compact` from a Codex session.
