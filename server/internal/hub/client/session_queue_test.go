package client

import (
	"errors"
	"testing"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

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

func TestSessionQueueFailedRetryMovesItemToFront(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-retry")
	s.queueMu.Lock()
	s.queue.active = &sessionQueueItem{wire: promptQueueItem("failed", "one"), status: acp.SessionQueueItemStatusFailed, errMessage: "failed"}
	s.queue.waiting = []*sessionQueueItem{{wire: promptQueueItem("next", "two"), status: acp.SessionQueueItemStatusQueued}}
	s.queue.paused = true
	s.queueMu.Unlock()

	if err := s.retryQueueItem("failed"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if got.Paused || got.ActiveItem != nil || len(got.WaitingItems) != 2 ||
		got.WaitingItems[0].ItemID != "failed" || got.WaitingItems[0].Error != "" ||
		got.WaitingItems[0].Status != acp.SessionQueueItemStatusQueued {
		t.Fatalf("snapshot = %#v", got)
	}
}

func TestSessionQueueFailedCancelResumesWaitingItems(t *testing.T) {
	s := mustNewSessionForQueueTest(t, "sess-failed")
	s.queueMu.Lock()
	s.queue.active = &sessionQueueItem{wire: promptQueueItem("failed", "one"), status: acp.SessionQueueItemStatusFailed}
	s.queue.waiting = []*sessionQueueItem{{wire: promptQueueItem("next", "two"), status: acp.SessionQueueItemStatusQueued}}
	s.queue.paused = true
	s.queueMu.Unlock()

	if err := s.cancelQueueItem("failed"); err != nil {
		t.Fatal(err)
	}
	got := s.queueSnapshot(true)
	if got.Paused || got.ActiveItem != nil || len(got.WaitingItems) != 1 {
		t.Fatalf("snapshot = %#v", got)
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
		after.Paused || after.ActiveItem != nil || len(after.WaitingItems) != 0 || s.queuePinsMemory() {
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
