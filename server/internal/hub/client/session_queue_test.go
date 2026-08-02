package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

type queuePromptOutcome struct {
	result acp.SessionPromptResult
	err    error
}

type queueExecutionInstance struct {
	*testInjectedInstance
	mu              sync.Mutex
	order           []string
	started         chan string
	promptOutcomes  chan queuePromptOutcome
	compactOutcomes chan error
	steerErr        error
	steerStarted    chan struct{}
	steerRelease    chan struct{}
}

func newQueueExecutionSession(t *testing.T, id string) (*Session, *queueExecutionInstance) {
	t.Helper()
	s := mustNewSessionForQueueTest(t, id)
	instance := &queueExecutionInstance{
		testInjectedInstance: &testInjectedInstance{name: "queue-test", sessionID: id, alive: true, callbacks: s},
		started:              make(chan string, 16),
		promptOutcomes:       make(chan queuePromptOutcome, 16),
		compactOutcomes:      make(chan error, 16),
	}
	s.mu.Lock()
	s.instance = instance
	s.ready = true
	s.viewSink = &recordingSessionViewSink{}
	s.mu.Unlock()
	return s, instance
}

func (i *queueExecutionInstance) SessionPrompt(ctx context.Context, params acp.SessionPromptParams) (acp.SessionPromptResult, error) {
	text := ""
	for _, block := range params.Prompt {
		if block.Type == acp.ContentBlockTypeText {
			text = block.Text
			break
		}
	}
	i.recordStart("prompt:" + text)
	select {
	case outcome := <-i.promptOutcomes:
		return outcome.result, outcome.err
	case <-ctx.Done():
		return acp.SessionPromptResult{}, ctx.Err()
	}
}

func (i *queueExecutionInstance) CompactSession(ctx context.Context, sessionID string) (<-chan agent.SessionCompactResult, error) {
	i.recordStart("compact:" + sessionID)
	done := make(chan agent.SessionCompactResult, 1)
	go func() {
		select {
		case err := <-i.compactOutcomes:
			done <- agent.SessionCompactResult{Err: err}
		case <-ctx.Done():
			done <- agent.SessionCompactResult{Err: ctx.Err()}
		}
		close(done)
	}()
	return done, nil
}

func (i *queueExecutionInstance) SteerSession(
	ctx context.Context,
	_ string,
	_ string,
	_ []acp.ContentBlock,
) (agent.SessionSteerResult, error) {
	i.mu.Lock()
	err := i.steerErr
	started := i.steerStarted
	release := i.steerRelease
	i.mu.Unlock()
	if started != nil {
		select {
		case started <- struct{}{}:
		default:
		}
	}
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return agent.SessionSteerResult{}, ctx.Err()
		}
	}
	return agent.SessionSteerResult{}, err
}

func (i *queueExecutionInstance) setSteerError(err error) {
	i.mu.Lock()
	i.steerErr = err
	i.mu.Unlock()
}

func (i *queueExecutionInstance) recordStart(value string) {
	i.mu.Lock()
	i.order = append(i.order, value)
	i.mu.Unlock()
	i.started <- value
}

func (i *queueExecutionInstance) executionOrder() []string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return append([]string(nil), i.order...)
}

func awaitQueueExecutionStart(t *testing.T, instance *queueExecutionInstance, want string) {
	t.Helper()
	select {
	case got := <-instance.started:
		if got != want {
			t.Fatalf("execution start = %q, want %q", got, want)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %q", want)
	}
}

func eventuallyQueue(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}

func addPersistedQueueRuntimeSession(
	t *testing.T,
	c *Client,
	sessionID string,
) (*Session, *queueExecutionInstance) {
	t.Helper()
	now := time.Now().UTC()
	addRuntimeSession(c, sessionID, "Queue", "codex", now, now)
	if err := c.store.SaveSession(context.Background(), &SessionRecord{
		ID:           sessionID,
		ProjectName:  c.projectName,
		Status:       SessionActive,
		AgentType:    "codex",
		AgentJSON:    `{}`,
		Title:        "Queue",
		CreatedAt:    now,
		LastActiveAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	sess, err := c.SessionForTest(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	instance := &queueExecutionInstance{
		testInjectedInstance: &testInjectedInstance{name: "queue-test", sessionID: sessionID, alive: true, callbacks: sess},
		started:              make(chan string, 16),
		promptOutcomes:       make(chan queuePromptOutcome, 16),
		compactOutcomes:      make(chan error, 16),
	}
	sess.mu.Lock()
	sess.instance = instance
	sess.ready = true
	sess.mu.Unlock()
	return sess, instance
}

func mustNewSessionForQueueTest(t *testing.T, id string) *Session {
	t.Helper()
	s, err := newSession(id, t.TempDir(), "codex")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func promptQueueItem(itemID, text string) acp.SessionQueueEnqueueItem {
	return acp.SessionQueueEnqueueItem{
		ItemID:    itemID,
		Kind:      acp.SessionQueueItemKindPrompt,
		CreatedAt: "2026-07-31T10:00:00Z",
		Blocks:    []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: text}},
	}
}

func compactQueueItem(itemID string) acp.SessionQueueEnqueueItem {
	return acp.SessionQueueEnqueueItem{
		ItemID:    itemID,
		Kind:      acp.SessionQueueItemKindCompact,
		CreatedAt: "2026-07-31T10:00:00Z",
	}
}

func TestSessionQueueEnqueueIsFIFOAndIdempotent(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-queue")
	first := promptQueueItem("item-1", "first")
	second := promptQueueItem("item-2", "second")

	if _, duplicate, err := s.enqueueQueueItem(first); err != nil || duplicate {
		t.Fatalf("first enqueue duplicate=%t err=%v", duplicate, err)
	}
	if _, duplicate, err := s.enqueueQueueItem(second); err != nil || duplicate {
		t.Fatalf("second enqueue duplicate=%t err=%v", duplicate, err)
	}
	if _, duplicate, err := s.enqueueQueueItem(first); err != nil || !duplicate {
		t.Fatalf("duplicate enqueue duplicate=%t err=%v", duplicate, err)
	}

	got := s.queueSnapshot(true)
	if got.Generation == "" || got.Revision != 2 || len(got.WaitingItems) != 2 ||
		got.WaitingItems[0].ItemID != "item-1" || got.WaitingItems[1].ItemID != "item-2" {
		t.Fatalf("snapshot = %#v", got)
	}
}

func TestSessionQueueRejectsItemIDPayloadConflict(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-conflict")
	if _, _, err := s.enqueueQueueItem(promptQueueItem("item-1", "first")); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.enqueueQueueItem(promptQueueItem("item-1", "different"))
	if !errors.Is(err, errSessionQueueItemConflict) {
		t.Fatalf("error = %v, want conflict", err)
	}
	var registryErr *acp.RegistryRequestError
	if !errors.As(err, &registryErr) || registryErr.Code != acp.CodeConflict {
		t.Fatalf("error = %#v, want RegistryRequestError CONFLICT", err)
	}
}

func TestSessionQueueSnapshotsAreDeepCopies(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-clone")
	item := promptQueueItem("item-1", "original")
	item.Blocks[0].Annotations = []byte(`{"audience":["assistant"]}`)
	if _, _, err := s.enqueueQueueItem(item); err != nil {
		t.Fatal(err)
	}
	item.Blocks[0].Text = "mutated input"
	item.Blocks[0].Annotations[0] = '!'

	first := s.queueSnapshot(true)
	first.WaitingItems[0].Blocks[0].Text = "mutated output"
	first.WaitingItems[0].Blocks[0].Annotations[0] = '?'
	second := s.queueSnapshot(true)
	if second.WaitingItems[0].Blocks[0].Text != "original" ||
		string(second.WaitingItems[0].Blocks[0].Annotations) != `{"audience":["assistant"]}` {
		t.Fatalf("snapshot was aliased: %#v", second.WaitingItems[0].Blocks)
	}
}

func TestSessionQueueValidatesItemUnion(t *testing.T) {
	tests := []struct {
		name string
		item acp.SessionQueueEnqueueItem
	}{
		{name: "missing id", item: promptQueueItem("", "hello")},
		{name: "missing kind", item: acp.SessionQueueEnqueueItem{ItemID: "item-1", CreatedAt: "now"}},
		{name: "missing created at", item: acp.SessionQueueEnqueueItem{ItemID: "item-1", Kind: acp.SessionQueueItemKindCompact}},
		{name: "prompt without blocks", item: acp.SessionQueueEnqueueItem{ItemID: "item-1", Kind: acp.SessionQueueItemKindPrompt, CreatedAt: "now"}},
		{name: "compact with blocks", item: acp.SessionQueueEnqueueItem{ItemID: "item-1", Kind: acp.SessionQueueItemKindCompact, CreatedAt: "now", Blocks: []acp.ContentBlock{{Type: "text", Text: "no"}}}},
		{name: "unknown kind", item: acp.SessionQueueEnqueueItem{ItemID: "item-1", Kind: "other", CreatedAt: "now"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := mustNewSessionForQueueTest(t, "sess-invalid")
			_, _, err := s.enqueueQueueItem(tt.item)
			var registryErr *acp.RegistryRequestError
			if !errors.As(err, &registryErr) || registryErr.Code != acp.CodeInvalidArgument {
				t.Fatalf("error = %#v, want INVALID_ARGUMENT", err)
			}
		})
	}
}

func TestSessionQueuePrioritizeAndWaitingCancel(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-order")
	for _, item := range []acp.SessionQueueEnqueueItem{
		promptQueueItem("one", "one"),
		compactQueueItem("two"),
		promptQueueItem("three", "three"),
	} {
		if _, _, err := s.enqueueQueueItem(item); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.prioritizeQueueItem("three"); err != nil {
		t.Fatal(err)
	}
	if err := s.cancelQueueItem("one"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if got.Revision != 5 || len(got.WaitingItems) != 2 ||
		got.WaitingItems[0].ItemID != "three" || got.WaitingItems[1].ItemID != "two" {
		t.Fatalf("snapshot = %#v", got)
	}
	if err := s.prioritizeQueueItem("missing"); err == nil {
		t.Fatal("prioritize missing item succeeded")
	}
}

func TestSessionQueueActiveCompactCannotBeCancelled(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-compact")
	s.queueMu.Lock()
	s.queue.active = &sessionQueueItem{wire: compactQueueItem("compact"), status: acp.SessionQueueItemStatusRunning}
	s.queueMu.Unlock()

	if err := s.cancelQueueItem("compact"); !errors.Is(err, agent.ErrSessionActionUnsupported) {
		t.Fatalf("error = %v, want unsupported", err)
	}
	if got := s.queueSnapshot(true); got.ActiveItem == nil || got.ActiveItem.CancelSupported {
		t.Fatalf("snapshot = %#v", got)
	}
}

func TestSessionQueueResetChangesGenerationAndClearsState(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-reset")
	item := promptQueueItem("item-1", "hello")
	if _, _, err := s.enqueueQueueItem(item); err != nil {
		t.Fatal(err)
	}
	before := s.queueSnapshot(true)
	after := s.resetQueue()
	if after.Generation == "" || after.Generation == before.Generation || after.Revision != 0 ||
		after.ActiveItem != nil || len(after.WaitingItems) != 0 || s.queuePinsMemory() {
		t.Fatalf("after reset = %#v", after)
	}
	if _, duplicate, err := s.enqueueQueueItem(item); err != nil || duplicate {
		t.Fatalf("enqueue after reset duplicate=%t err=%v", duplicate, err)
	}
}

func TestSessionQueueSummaryOmitsLiveItemsAndBlocks(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-summary")
	if _, _, err := s.enqueueQueueItem(promptQueueItem("item-1", "secret")); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(false)
	if got.WaitingCount != 1 || got.ActiveItem != nil || got.WaitingItems != nil {
		t.Fatalf("summary = %#v", got)
	}
}

func TestSessionQueueDrainsPromptCompactPromptInOrder(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-drain")
	for _, item := range []acp.SessionQueueEnqueueItem{
		promptQueueItem("p1", "first"),
		compactQueueItem("c1"),
		promptQueueItem("p2", "second"),
	} {
		if _, _, err := s.enqueueAndScheduleQueueItem(item); err != nil {
			t.Fatal(err)
		}
	}

	awaitQueueExecutionStart(t, instance, "prompt:first")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	awaitQueueExecutionStart(t, instance, "compact:sess-drain")
	instance.compactOutcomes <- nil
	awaitQueueExecutionStart(t, instance, "prompt:second")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}

	eventuallyQueue(t, func() bool {
		got := s.queueSnapshot(true)
		return got.ActiveItem == nil && len(got.WaitingItems) == 0
	})
	want := []string{"prompt:first", "compact:sess-drain", "prompt:second"}
	if got := instance.executionOrder(); !reflect.DeepEqual(got, want) {
		t.Fatalf("execution order = %v, want %v", got, want)
	}
}

func TestSessionQueuePromptTranscriptCarriesQueueItemIdentity(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-prompt-identity")
	sink := s.viewSink.(*recordingSessionViewSink)
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("prompt-item-1", "identify me")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:identify me")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	eventuallyQueue(t, func() bool { return !s.queuePinsMemory() })

	for _, event := range sink.events {
		if event.Type != SessionViewEventTypeACP {
			continue
		}
		var envelope struct {
			Params struct {
				ClientMessageID string `json:"clientMessageId"`
			} `json:"params"`
		}
		if json.Unmarshal([]byte(event.Content), &envelope) == nil &&
			envelope.Params.ClientMessageID == "prompt-item-1" {
			return
		}
	}
	t.Fatalf("prompt transcript events do not carry queue item identity: %#v", sink.events)
}

func TestSessionQueueFailureDequeuesAndContinues(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-failure-drain")
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "first")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p2", "second")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:first")
	instance.promptOutcomes <- queuePromptOutcome{err: errors.New("provider failed")}
	awaitQueueExecutionStart(t, instance, "prompt:second")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	eventuallyQueue(t, func() bool {
		got := s.queueSnapshot(true)
		return got.ActiveItem == nil && len(got.WaitingItems) == 0
	})
	if got, want := instance.executionOrder(), []string{"prompt:first", "prompt:second"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("execution order = %v, want %v", got, want)
	}
}

func TestSessionQueueEnqueueReturnsBeforeExecutionCompletes(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-async")
	started := time.Now()
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "slow")); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("enqueue blocked for %s", elapsed)
	}
	awaitQueueExecutionStart(t, instance, "prompt:slow")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
}

func TestSessionQueueCancelActivePromptWaitsForOfficialOutcome(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-cancel")
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "cancel me")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:cancel me")
	if err := s.cancelQueueItem("p1"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if got.ActiveItem == nil || got.ActiveItem.Status != acp.SessionQueueItemStatusCancelling {
		t.Fatalf("queue after cancel = %#v", got)
	}
	eventuallyQueue(t, func() bool { return !s.queuePinsMemory() })
}

func TestSessionQueueCancelActivePromptBeforeSessionLoadCompletes(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-cancel-loading")
	loadStarted := make(chan struct{}, 1)
	loadRelease := make(chan struct{})
	instance := &queueExecutionInstance{
		testInjectedInstance: &testInjectedInstance{
			name:      "queue-test",
			sessionID: s.acpSessionID,
			alive:     true,
			callbacks: s,
			initResult: acp.InitializeResult{
				ProtocolVersion: "0.1",
				AgentCapabilities: acp.AgentCapabilities{
					LoadSession: true,
				},
				AgentInfo: &acp.AgentInfo{Name: "queue-test"},
			},
			loadFn: func(ctx context.Context, _ acp.SessionLoadParams) (acp.SessionLoadResult, error) {
				loadStarted <- struct{}{}
				select {
				case <-loadRelease:
					return acp.SessionLoadResult{}, nil
				case <-ctx.Done():
					return acp.SessionLoadResult{}, ctx.Err()
				}
			},
		},
		started:         make(chan string, 1),
		promptOutcomes:  make(chan queuePromptOutcome, 1),
		compactOutcomes: make(chan error, 1),
	}
	s.mu.Lock()
	s.instance = instance
	s.ready = false
	s.viewSink = &recordingSessionViewSink{}
	s.mu.Unlock()

	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "cancel before load")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-loadStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("session/load did not start")
	}
	if err := s.cancelQueueItem("p1"); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if !s.queuePinsMemory() {
			close(loadRelease)
			select {
			case started := <-instance.started:
				t.Fatalf("provider prompt started after early cancellation: %s", started)
			default:
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	close(loadRelease)
	t.Fatal("early cancellation did not finish the active queue item")
}

func TestSessionQueueReschedulesAfterConfigMutationReleasesExecutionLock(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-config-drain")
	configStarted := make(chan struct{}, 1)
	configRelease := make(chan struct{})
	configDone := make(chan error, 1)
	instance.setConfigFn = func(_ context.Context, params acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		configStarted <- struct{}{}
		<-configRelease
		return []acp.ConfigOption{{ID: params.ConfigID, CurrentValue: params.Value}}, nil
	}

	go func() {
		_, err := s.SetConfigOption(context.Background(), acp.ConfigOptionIDModel, "model-b")
		configDone <- err
	}()
	select {
	case <-configStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("config mutation did not start")
	}

	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "after config")); err != nil {
		t.Fatal(err)
	}
	eventuallyQueue(t, func() bool {
		s.queueMu.Lock()
		defer s.queueMu.Unlock()
		return !s.queue.draining && len(s.queue.waiting) == 1
	})
	close(configRelease)
	if err := <-configDone; err != nil {
		t.Fatal(err)
	}

	awaitQueueExecutionStart(t, instance, "prompt:after config")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	eventuallyQueue(t, func() bool { return !s.queuePinsMemory() })
}

func TestSessionQueueConcurrentEnqueueExecutesEachItemOnce(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-concurrent")
	const count = 12
	var wg sync.WaitGroup
	for index := 0; index < count; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			item := promptQueueItem(fmt.Sprintf("p-%02d", index), fmt.Sprintf("%02d", index))
			if _, _, err := s.enqueueAndScheduleQueueItem(item); err != nil {
				t.Errorf("enqueue %d: %v", index, err)
			}
		}(index)
	}
	wg.Wait()
	for index := 0; index < count; index++ {
		select {
		case <-instance.started:
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out waiting for execution %d", index)
		}
		instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	}
	eventuallyQueue(t, func() bool { return !s.queuePinsMemory() })
	order := instance.executionOrder()
	if len(order) != count {
		t.Fatalf("execution count = %d, want %d (%v)", len(order), count, order)
	}
	seen := make(map[string]bool, count)
	for _, entry := range order {
		if seen[entry] {
			t.Fatalf("duplicate execution %q in %v", entry, order)
		}
		seen[entry] = true
	}
}

func TestClientCloseStopsQueueBeforeClosingSessionResources(t *testing.T) {
	c := newSessionViewTestClient(t)
	s, instance := addPersistedQueueRuntimeSession(t, c, "sess-close-queue")
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p1", "active")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("p2", "must not start")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:active")

	closeDone := make(chan error, 1)
	go func() {
		closeDone <- c.Close()
	}()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Client.Close did not wait for the queue drain to stop")
	}

	if got := s.queueSnapshot(true); got.ActiveItem != nil || got.WaitingCount != 0 || len(got.WaitingItems) != 0 {
		t.Fatalf("queue after Client.Close = %#v", got)
	}
	select {
	case started := <-instance.started:
		t.Fatalf("queue started another item during Client.Close: %s", started)
	default:
	}
}

func TestClientCloseCancelsActiveCompactQueue(t *testing.T) {
	c := newSessionViewTestClient(t)
	s, instance := addPersistedQueueRuntimeSession(t, c, "sess-close-compact")
	if _, _, err := s.enqueueAndScheduleQueueItem(compactQueueItem("compact-1")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "compact:sess-close-compact")

	closeDone := make(chan error, 1)
	go func() {
		closeDone <- c.Close()
	}()
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		instance.compactOutcomes <- context.Canceled
		<-closeDone
		t.Fatal("Client.Close did not cancel the active compact execution")
	}
}

func TestSessionQueueSteerWaitsForMatchingTranscript(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-steer")
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("active", "first")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("steer-1", "change direction")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:first")

	if err := s.steerQueueItem(context.Background(), "steer-1"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if len(got.WaitingItems) != 1 || got.WaitingItems[0].Status != acp.SessionQueueItemStatusSteering {
		t.Fatalf("queue = %#v", got)
	}
	if err := s.prioritizeQueueItem("steer-1"); err == nil {
		t.Fatal("steering item was prioritized")
	}

	s.AgentEvent(acp.AgentEvent{
		SessionID: "sess-steer",
		Update: acp.AgentMessageEvent{
			Kind:      acp.SessionUpdateUserMessageChunk,
			MessageID: "different",
			Meta:      acp.BuildSessionUpdateMetaLifecycle("", true, true),
		},
	})
	if len(s.queueSnapshot(true).WaitingItems) != 1 {
		t.Fatal("unrelated transcript removed the item")
	}
	s.AgentEvent(acp.AgentEvent{
		SessionID: "sess-steer",
		Update: acp.AgentMessageEvent{
			Kind:      acp.SessionUpdateUserMessageChunk,
			MessageID: "steer-1",
			Meta:      acp.BuildSessionUpdateMetaLifecycle("", true, true),
		},
	})
	eventuallyQueue(t, func() bool { return len(s.queueSnapshot(true).WaitingItems) == 0 })
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
}

func TestSessionQueueSteeringItemCanBeCancelledWhileProviderIsPending(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-steer-cancel")
	instance.mu.Lock()
	instance.steerStarted = make(chan struct{}, 1)
	instance.steerRelease = make(chan struct{})
	started := instance.steerStarted
	instance.mu.Unlock()
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("active", "first")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.enqueueAndScheduleQueueItem(promptQueueItem("steer-1", "change direction")); err != nil {
		t.Fatal(err)
	}
	awaitQueueExecutionStart(t, instance, "prompt:first")

	steerDone := make(chan error, 1)
	go func() {
		steerDone <- s.steerQueueItem(context.Background(), "steer-1")
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("steer did not reach provider")
	}

	cancelDone := make(chan error, 1)
	go func() {
		cancelDone <- s.cancelQueueItem("steer-1")
	}()
	select {
	case err := <-cancelDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("cancel blocked behind the provider steer call")
	}
	if got := s.queueSnapshot(true); len(got.WaitingItems) != 0 {
		t.Fatalf("queue after cancelling steering item = %#v", got)
	}
	select {
	case err := <-steerDone:
		if err != nil {
			t.Fatalf("steer returned after cancellation: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not stop the provider steer call")
	}
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
}

func TestSessionQueueSteerInactiveMovesPromptToFront(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-steer-inactive")
	for _, item := range []acp.SessionQueueEnqueueItem{
		promptQueueItem("active", "first"),
		promptQueueItem("before", "before"),
		promptQueueItem("target", "target"),
	} {
		if _, _, err := s.enqueueAndScheduleQueueItem(item); err != nil {
			t.Fatal(err)
		}
	}
	awaitQueueExecutionStart(t, instance, "prompt:first")
	instance.setSteerError(agent.ErrSessionSteerInactive)

	if err := s.steerQueueItem(context.Background(), "target"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if len(got.WaitingItems) != 2 || got.WaitingItems[0].ItemID != "target" ||
		got.WaitingItems[0].Status != acp.SessionQueueItemStatusQueued {
		t.Fatalf("queue = %#v", got)
	}
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
}

func TestSessionQueueSteerFailureRestoresOriginalPosition(t *testing.T) {
	s, instance := newQueueExecutionSession(t, "sess-steer-error")
	for _, item := range []acp.SessionQueueEnqueueItem{
		promptQueueItem("active", "first"),
		promptQueueItem("a", "a"),
		promptQueueItem("target", "target"),
		promptQueueItem("b", "b"),
	} {
		if _, _, err := s.enqueueAndScheduleQueueItem(item); err != nil {
			t.Fatal(err)
		}
	}
	awaitQueueExecutionStart(t, instance, "prompt:first")
	instance.setSteerError(agent.ErrSessionActionUnsupported)

	err := s.steerQueueItem(context.Background(), "target")
	if !errors.Is(err, agent.ErrSessionActionUnsupported) {
		t.Fatalf("error = %v, want unsupported", err)
	}
	got := s.queueSnapshot(true)
	if len(got.WaitingItems) != 3 ||
		got.WaitingItems[0].ItemID != "a" ||
		got.WaitingItems[1].ItemID != "target" ||
		got.WaitingItems[2].ItemID != "b" ||
		got.WaitingItems[1].Status != acp.SessionQueueItemStatusQueued {
		t.Fatalf("queue = %#v", got)
	}
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
}

func TestHandleSessionQueueReturnsLatestFullSnapshot(t *testing.T) {
	c := newSessionViewTestClient(t)
	sess, instance := addPersistedQueueRuntimeSession(t, c, "sess-queue-request")

	resp, err := c.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionQueue,
		"proj1",
		json.RawMessage(mustJSON(map[string]any{
			"sessionId": "sess-queue-request",
			"action":    acp.SessionQueueActionEnqueue,
			"item": map[string]any{
				"itemId":    "item-1",
				"kind":      "prompt",
				"createdAt": "2026-07-31T10:00:00Z",
				"blocks":    []map[string]any{{"type": "text", "text": "hello"}},
			},
		})),
	)
	if err != nil {
		t.Fatal(err)
	}
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("response = %T, want map", resp)
	}
	summary, ok := body["session"].(sessionViewSummary)
	if !ok || summary.Queue == nil || summary.Queue.Generation == "" ||
		(summary.Queue.ActiveItem == nil && len(summary.Queue.WaitingItems) == 0) {
		t.Fatalf("response = %#v", body)
	}
	awaitQueueExecutionStart(t, instance, "prompt:hello")
	instance.promptOutcomes <- queuePromptOutcome{result: acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}}
	eventuallyQueue(t, func() bool { return !sess.queuePinsMemory() })
}

func TestSessionQueueProjectionIsFullForReadAndSummaryOnlyForList(t *testing.T) {
	c := newSessionViewTestClient(t)
	sess, _ := addPersistedQueueRuntimeSession(t, c, "sess-queue-projection")
	if _, _, err := sess.enqueueQueueItem(promptQueueItem("item-1", "private blocks")); err != nil {
		t.Fatal(err)
	}

	readResp, err := c.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionRead,
		"proj1",
		json.RawMessage(`{"sessionId":"sess-queue-projection"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	readSummary := readResp.(map[string]any)["session"].(sessionViewSummary)
	if readSummary.Queue == nil || len(readSummary.Queue.WaitingItems) != 1 ||
		len(readSummary.Queue.WaitingItems[0].Blocks) != 1 {
		t.Fatalf("read queue = %#v", readSummary.Queue)
	}

	listResp, err := c.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionList,
		"proj1",
		json.RawMessage(`{}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	sessions := listResp.(map[string]any)["sessions"].([]sessionViewSummary)
	if len(sessions) != 1 || sessions[0].Queue == nil ||
		sessions[0].Queue.WaitingCount != 1 ||
		sessions[0].Queue.ActiveItem != nil ||
		sessions[0].Queue.WaitingItems != nil {
		t.Fatalf("list sessions = %#v", sessions)
	}
}

func TestHandleSessionQueueRejectsInvalidActions(t *testing.T) {
	c := newSessionViewTestClient(t)
	addPersistedQueueRuntimeSession(t, c, "sess-invalid-action")
	for _, payload := range []json.RawMessage{
		json.RawMessage(`{"sessionId":"sess-invalid-action","action":"unknown","itemId":"item-1"}`),
		json.RawMessage(`{"sessionId":"sess-invalid-action","action":"cancel"}`),
		json.RawMessage(`{"sessionId":"sess-invalid-action","action":"enqueue","itemId":"item-1"}`),
		json.RawMessage(`{"sessionId":"sess-invalid-action","action":"cancel","itemId":"item-1","legacy":true}`),
	} {
		_, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
		var registryErr *acp.RegistryRequestError
		if !errors.As(err, &registryErr) || registryErr.Code != acp.CodeInvalidArgument {
			t.Fatalf("payload %s error = %#v, want INVALID_ARGUMENT", payload, err)
		}
	}
}

func TestEvictSuspendedSessionWithQueueKeepsItInMemory(t *testing.T) {
	c := newSessionViewTestClient(t)
	sess, _ := addPersistedQueueRuntimeSession(t, c, "sess-queue-pinned")
	sess.mu.Lock()
	sess.Status = SessionSuspended
	sess.lastActiveAt = time.Now().Add(-time.Hour)
	sess.mu.Unlock()
	if _, _, err := sess.enqueueQueueItem(promptQueueItem("item-1", "waiting")); err != nil {
		t.Fatal(err)
	}
	c.suspendTimeout = time.Millisecond

	c.evictSuspendedSessions()
	if !c.HasSessionInMemoryForTest("sess-queue-pinned") {
		t.Fatal("nonempty queue did not pin the suspended session in memory")
	}
}

func TestSessionQueueIsNotRecoveredFromSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	c := New(store, "proj1", t.TempDir())
	sess, _ := addPersistedQueueRuntimeSession(t, c, "sess-queue-restart")
	if _, _, err := sess.enqueueQueueItem(promptQueueItem("item-1", "ephemeral")); err != nil {
		t.Fatal(err)
	}
	if err := sess.persistSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}

	reopenedStore, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	reopened := New(reopenedStore, "proj1", t.TempDir())
	t.Cleanup(func() { _ = reopened.Close() })

	readResp, err := reopened.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionRead,
		"proj1",
		json.RawMessage(`{"sessionId":"sess-queue-restart"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	readSummary := readResp.(map[string]any)["session"].(sessionViewSummary)
	if readSummary.Queue == nil ||
		readSummary.Queue.Generation == "" ||
		readSummary.Queue.Generation == sess.queueSnapshot(true).Generation ||
		readSummary.Queue.ActiveItem != nil ||
		readSummary.Queue.WaitingCount != 0 ||
		len(readSummary.Queue.WaitingItems) != 0 {
		t.Fatalf("queue projection after restart = %#v", readSummary.Queue)
	}

	reloaded, err := reopened.SessionForTest("sess-queue-restart")
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.queueSnapshot(true)
	if got.Generation == "" || got.ActiveItem != nil || len(got.WaitingItems) != 0 {
		t.Fatalf("recovered queue = %#v", got)
	}
}

func TestSessionQueueLifecycleDeleteClearsLiveState(t *testing.T) {
	c := newSessionViewTestClient(t)
	sess, _ := addPersistedQueueRuntimeSession(t, c, "sess-queue-delete")
	if _, _, err := sess.enqueueQueueItem(promptQueueItem("item-1", "discard me")); err != nil {
		t.Fatal(err)
	}
	before := sess.queueSnapshot(true)

	if err := c.DeleteSession(context.Background(), "sess-queue-delete"); err != nil {
		t.Fatal(err)
	}
	after := sess.queueSnapshot(true)
	if after.Generation == before.Generation || after.ActiveItem != nil || len(after.WaitingItems) != 0 {
		t.Fatalf("queue after delete = %#v", after)
	}
}
