# Unified Registry WebSocket Message Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Registry's method-specific transport limits with one 16 MiB WebSocket message limit while preserving HTTP and Hub business-level limits.

**Architecture:** Registry will bound the complete WebSocket message once, before JSON decoding, and Gorilla WebSocket will use the same constant as its read limit. Tests will exercise the exact byte boundary and forward a real 1 MiB attachment chunk after Base64 expansion.

**Tech Stack:** Go, Gorilla WebSocket, Go `testing`

---

### Task 1: Unify Registry WebSocket input limits

**Files:**
- Modify: `server/internal/registry/input_limits_test.go`
- Modify: `server/internal/registry/server_test.go`
- Modify: `server/internal/registry/input_limits.go`
- Modify: `server/internal/registry/server.go`

- [ ] **Step 1: Write failing boundary and attachment forwarding tests**

Replace the method-specific cases in `TestInputLimitBoundaries` with a single wire-message boundary exercised through the stable decoder entry point:

```go
func TestInputLimitBoundaries(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		messageBytes int
		valid        bool
	}{
		{name: "limit minus one", messageBytes: 16*1024*1024 - 1, valid: true},
		{name: "limit", messageBytes: 16 * 1024 * 1024, valid: true},
		{name: "limit plus one", messageBytes: 16*1024*1024 + 1},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			message := registryMessageWithBytes(t, testCase.messageBytes)
			_, _, err := decodeEnvelopeMessage(message)
			if testCase.valid && err != nil {
				t.Fatalf("decodeEnvelopeMessage() err=%v", err)
			}
			if !testCase.valid && !errors.Is(err, errRegistryInputTooLarge) {
				t.Fatalf("decodeEnvelopeMessage() err=%v, want too large", err)
			}
		})
	}
}

func registryMessageWithBytes(t *testing.T, messageBytes int) []byte {
	t.Helper()
	prefix := `{"type":"event","method":"registry.project.list","payload":{"data":"`
	suffix := `"}}`
	padding := messageBytes - len(prefix) - len(suffix)
	if padding < 0 {
		t.Fatalf("messageBytes=%d is too small", messageBytes)
	}
	return []byte(prefix + strings.Repeat("x", padding) + suffix)
}
```

Add `encoding/base64` to `server_test.go`, then add a focused end-to-end Registry routing test:

```go
func TestWebSocketForwardsOneMiBAttachmentChunk(t *testing.T) {
	server := New(Config{})
	address := httptestNewRegistryServer(t, server.Handler())

	hub := dialWS(t, "http://"+address+"/ws")
	defer hub.Close()
	epoch := connectRegistryHub(t, hub, "hub-attachment")
	mustWriteJSON(t, hub, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    "hub.report.projects",
		HubID:     "hub-attachment",
		Payload: map[string]any{
			"connectionEpoch": epoch,
			"projects":        []map[string]any{{"name": "project", "path": "D:/project", "online": true}},
		},
	})
	_ = mustReadEnvelope(t, hub)

	client := dialWS(t, "http://"+address+"/ws")
	defer client.Close()
	connectRegistryClient(t, client)
	data := base64.StdEncoding.EncodeToString(make([]byte, 1024*1024))
	mustWriteJSON(t, client, testEnvelope{
		RequestID: 2,
		Type:      "request",
		Method:    rp.RegistryMethodSessionAttachmentChunk,
		ProjectID: "hub-attachment:project",
		Payload: map[string]any{
			"sessionId": "session-1",
			"uploadId":  "upload-1",
			"offset":    0,
			"data":      data,
		},
	})
	_ = hub.SetReadDeadline(time.Now().Add(2 * time.Second))
	forwarded := mustReadEnvelope(t, hub)
	if forwarded.Method != rp.RegistryMethodSessionAttachmentChunk || forwarded.Payload["data"] != data {
		t.Fatalf("forwarded attachment chunk does not match request")
	}
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
cd server
go test ./internal/registry -run 'TestInputLimitBoundaries|TestWebSocketForwardsOneMiBAttachmentChunk' -count=1 -v
```

Expected: both tests fail for the intended old-limit behavior. The boundary test rejects the 16 MiB-minus-one message at the current approximately 8 MiB wire ceiling, and the attachment forwarding test times out or receives no forwarded request because its approximately 1.4 MiB JSON payload exceeds the current 1 MiB normal limit.

- [ ] **Step 3: Implement the single message limit**

Replace the transport constants and validator in `input_limits.go`:

```go
const (
	maxRegistryMessageBytes = 16 * 1024 * 1024
	maxSpeechChunkPayloadBytes = 8 * 1024 * 1024
	codePayloadTooLarge     = "payload_too_large"
)

func validateRegistryInput(messageBytes int) error {
	if messageBytes > maxRegistryMessageBytes {
		return fmt.Errorf("%w: wire message exceeds %d bytes", errRegistryInputTooLarge, maxRegistryMessageBytes)
	}
	return nil
}
```

Keep `maxSpeechChunkPayloadBytes` solely for the existing speech service's business validation, and remove the now-unused protocol import from `input_limits.go`. In `decodeEnvelopeMessage`, use `maxRegistryMessageBytes` for the pre-decode guard and call `validateRegistryInput(len(message))` after decoding. In `server.go`, change the Gorilla read limit to:

```go
ws.SetReadLimit(maxRegistryMessageBytes)
```

Update existing oversized WebSocket tests to construct messages relative to `maxRegistryMessageBytes`; remove assertions tied to payload-only or method-specific limits.

- [ ] **Step 4: Format and verify GREEN**

Run:

```powershell
cd server
gofmt -w internal/registry/input_limits.go internal/registry/input_limits_test.go internal/registry/server.go internal/registry/server_test.go
go test ./internal/registry -run 'TestInputLimit|TestWebSocket.*(AttachmentChunk|TooLarge|Above)' -count=1 -v
```

Expected: all selected tests pass, including exact 16 MiB boundaries, oversized connection closure, HTTP login isolation, and the 1 MiB attachment chunk forwarding test.

- [ ] **Step 5: Run complete server verification**

Run:

```powershell
cd server
go test ./...
go vet ./internal/registry
```

Expected: both commands exit 0 with no test failures or Registry vet diagnostics. A separate `go vet ./...` baseline audit may continue to report the repository's existing `unsafe.Pointer` and `relaySlot` lock-copy diagnostics in untouched packages; none may originate from `internal/registry`.

### Task 2: Review and deliver

**Files:**
- Review: `docs/scope/2026-07-14-unified-registry-message-limit.md`
- Review: `docs/plans/2026-07-14-unified-registry-message-limit/plan-unified-registry-message-limit.md`
- Review: all files changed in Task 1

- [ ] **Step 1: Check scope and repository state**

Run:

```powershell
rg -n "maxJSONPayloadBytes|maxEnvelopeBytes|maxEnvelopeFramingBytes|maxWireMessageBytes" server/internal/registry
git diff --check
git status --short
```

Expected: the obsolete Registry transport constants have no matches, the speech business-level limit remains referenced by `speech_service.go`, `git diff --check` exits 0, and status lists only the spec, plan, Registry implementation, and Registry tests.

- [ ] **Step 2: Commit and push through the repository completion gate**

Run exactly from the repository root:

```powershell
git add -A
git commit -m "fix: unify registry message size limit"
git push origin main
```

Expected: commit succeeds and `origin/main` advances to the new commit.
