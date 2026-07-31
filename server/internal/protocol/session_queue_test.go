package protocol

import (
	"encoding/json"
	"testing"
)

func TestSessionQueueRequestRoundTrip(t *testing.T) {
	raw := []byte(`{"sessionId":"sess-1","action":"enqueue","item":{"itemId":"item-1","kind":"prompt","createdAt":"2026-07-31T10:00:00Z","blocks":[{"type":"text","text":"hello"}]}}`)
	var got SessionQueueRequest
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != "sess-1" || got.Action != SessionQueueActionEnqueue || got.Item == nil ||
		got.Item.ItemID != "item-1" || got.Item.Kind != SessionQueueItemKindPrompt ||
		len(got.Item.Blocks) != 1 || got.Item.Blocks[0].Text != "hello" {
		t.Fatalf("request = %#v", got)
	}
}

func TestSessionQueueSnapshotRoundTrip(t *testing.T) {
	snapshot := SessionQueueSnapshot{
		Generation:   "generation-1",
		Revision:     4,
		ActiveKind:   SessionQueueItemKindPrompt,
		WaitingCount: 1,
		ActiveItem: &SessionQueueItem{
			ItemID:          "active-1",
			Kind:            SessionQueueItemKindPrompt,
			Status:          SessionQueueItemStatusRunning,
			CreatedAt:       "2026-07-31T10:00:00Z",
			CancelSupported: true,
		},
		WaitingItems: []SessionQueueItem{{
			ItemID:          "waiting-1",
			Kind:            SessionQueueItemKindCompact,
			Status:          SessionQueueItemStatusQueued,
			CreatedAt:       "2026-07-31T10:01:00Z",
			CancelSupported: true,
		}},
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var got SessionQueueSnapshot
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Generation != snapshot.Generation || got.Revision != snapshot.Revision ||
		got.ActiveItem == nil || got.ActiveItem.Status != SessionQueueItemStatusRunning ||
		len(got.WaitingItems) != 1 || got.WaitingItems[0].Kind != SessionQueueItemKindCompact {
		t.Fatalf("snapshot = %#v", got)
	}
}
