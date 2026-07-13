package registry

import (
	"testing"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestRequestIDWindowEvictsOldestAtCapacity(t *testing.T) {
	window := newRequestIDWindow(maxSeenRequestIDs)
	for id := int64(1); id <= maxSeenRequestIDs; id++ {
		if duplicate := window.Add(id); duplicate {
			t.Fatalf("request ID %d unexpectedly duplicate", id)
		}
	}
	if duplicate := window.Add(maxSeenRequestIDs); !duplicate {
		t.Fatal("latest request ID was not detected as duplicate")
	}
	if duplicate := window.Add(maxSeenRequestIDs + 1); duplicate {
		t.Fatal("new request ID was detected as duplicate")
	}
	if window.Len() != maxSeenRequestIDs {
		t.Fatalf("window Len()=%d, want %d", window.Len(), maxSeenRequestIDs)
	}
	if duplicate := window.Add(1); duplicate {
		t.Fatal("oldest evicted request ID remained in the set")
	}
	if duplicate := window.Add(2); duplicate {
		t.Fatal("second request ID should have been evicted after ring advanced")
	}
}

func TestPendingLimitRejectsWithoutGrowingMap(t *testing.T) {
	peer := &peerConn{pending: make(map[int64]chan envelope)}
	for id := int64(1); id <= maxPendingForwards; id++ {
		if _, err := peer.registerPending(id); err != nil {
			t.Fatalf("registerPending(%d): %v", id, err)
		}
	}
	if _, err := peer.registerPending(maxPendingForwards + 1); err != errPendingFull {
		t.Fatalf("overflow err=%v, want errPendingFull", err)
	}
	if len(peer.pending) != maxPendingForwards {
		t.Fatalf("pending len=%d, want %d", len(peer.pending), maxPendingForwards)
	}
	if !peer.resolvePending(1, envelope{}) {
		t.Fatal("resolvePending(1) failed")
	}
	if _, err := peer.registerPending(maxPendingForwards + 1); err != nil {
		t.Fatalf("register after release: %v", err)
	}
}

func TestPendingLimitReturnsBusy(t *testing.T) {
	peer := &peerConn{pending: make(map[int64]chan envelope, maxPendingForwards)}
	for id := int64(1); id <= maxPendingForwards; id++ {
		peer.pending[id] = make(chan envelope, 1)
	}
	server := New(Config{})
	server.hubs["hub-1"] = rp.HubSnapshot{HubID: "hub-1"}
	server.projectToHub["hub-1:project"] = "hub-1"
	server.hubPeers["hub-1"] = peer
	response := server.executeClientRequest(&connectionState{}, envelope{
		RequestID: 1,
		Type:      rp.RegistryEnvelopeTypeRequest,
		Method:    rp.RegistryMethodProjectFSList,
		ProjectID: "hub-1:project",
	})
	if response.Type != rp.RegistryEnvelopeTypeError {
		t.Fatalf("response type=%q, want error", response.Type)
	}
	var failure errorPayload
	if err := decodePayload(response.Payload, &failure); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	if failure.Code != codeBusy {
		t.Fatalf("error code=%q, want %q", failure.Code, codeBusy)
	}
}

func TestQueueLimitRejectsWithoutBlocking(t *testing.T) {
	queue := make(chan envelope, asyncQueueBuffer)
	for index := 0; index < asyncQueueBuffer; index++ {
		if !tryEnqueueRequest(queue, envelope{RequestID: int64(index + 1)}) {
			t.Fatalf("queue rejected item %d before capacity", index)
		}
	}
	if tryEnqueueRequest(queue, envelope{RequestID: asyncQueueBuffer + 1}) {
		t.Fatal("queue accepted item beyond capacity")
	}
	if len(queue) != asyncQueueBuffer {
		t.Fatalf("queue len=%d, want %d", len(queue), asyncQueueBuffer)
	}
}
