package client

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

var errSessionQueueItemConflict = errors.New("session queue item id conflicts with an existing payload")

type sessionQueueItem struct {
	wire        acp.SessionQueueEnqueueItem
	status      string
	errMessage  string
	payloadHash [sha256.Size]byte
}

type sessionQueueState struct {
	generation string
	revision   uint64
	paused     bool
	active     *sessionQueueItem
	waiting    []*sessionQueueItem
	outcomes   map[string][sha256.Size]byte
	draining   bool
}

func newSessionQueueState() sessionQueueState {
	return sessionQueueState{
		generation: uuid.NewString(),
		outcomes:   make(map[string][sha256.Size]byte),
	}
}

func (s *Session) enqueueQueueItem(item acp.SessionQueueEnqueueItem) (acp.SessionQueueSnapshot, bool, error) {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	normalized, payloadHash, err := normalizeSessionQueueItem(item)
	if err != nil {
		return s.queueSnapshot(true), false, err
	}

	s.queueMu.Lock()
	if existing, ok := s.queue.outcomes[normalized.ItemID]; ok {
		s.queueMu.Unlock()
		if existing == payloadHash {
			return s.queueSnapshot(true), true, nil
		}
		return s.queueSnapshot(true), false, fmt.Errorf(
			"%w: %w",
			errSessionQueueItemConflict,
			sessionQueueRequestError(acp.CodeConflict, "itemId is already associated with a different queue payload"),
		)
	}
	s.queue.outcomes[normalized.ItemID] = payloadHash
	s.queue.waiting = append(s.queue.waiting, &sessionQueueItem{
		wire:        normalized,
		status:      acp.SessionQueueItemStatusQueued,
		payloadHash: payloadHash,
	})
	s.bumpQueueRevisionLocked()
	snapshot := s.queueSnapshotLocked(true)
	s.queueMu.Unlock()
	return snapshot, false, nil
}

func (s *Session) cancelQueueItem(itemID string) error {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return sessionQueueRequestError(acp.CodeInvalidArgument, "itemId is required")
	}

	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	if active := s.queue.active; active != nil && active.wire.ItemID == itemID {
		if active.status == acp.SessionQueueItemStatusFailed {
			s.queue.active = nil
			s.queue.paused = false
			s.bumpQueueRevisionLocked()
			return nil
		}
		if active.wire.Kind == acp.SessionQueueItemKindCompact {
			return agent.ErrSessionActionUnsupported
		}
		if active.status == acp.SessionQueueItemStatusCancelling {
			return nil
		}
		active.status = acp.SessionQueueItemStatusCancelling
		s.bumpQueueRevisionLocked()
		return nil
	}
	for i, item := range s.queue.waiting {
		if item.wire.ItemID != itemID {
			continue
		}
		s.queue.waiting = append(s.queue.waiting[:i], s.queue.waiting[i+1:]...)
		s.bumpQueueRevisionLocked()
		return nil
	}
	return sessionQueueRequestError(acp.CodeNotFound, "queue item was not found")
}

func (s *Session) prioritizeQueueItem(itemID string) error {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return sessionQueueRequestError(acp.CodeInvalidArgument, "itemId is required")
	}

	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	for i, item := range s.queue.waiting {
		if item.wire.ItemID != itemID {
			continue
		}
		if i == 0 {
			return nil
		}
		copy(s.queue.waiting[1:i+1], s.queue.waiting[:i])
		s.queue.waiting[0] = item
		s.bumpQueueRevisionLocked()
		return nil
	}
	return sessionQueueRequestError(acp.CodeNotFound, "waiting queue item was not found")
}

func (s *Session) retryQueueItem(itemID string) error {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return sessionQueueRequestError(acp.CodeInvalidArgument, "itemId is required")
	}

	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	active := s.queue.active
	if active == nil || active.wire.ItemID != itemID || active.status != acp.SessionQueueItemStatusFailed {
		return sessionQueueRequestError(acp.CodeConflict, "only the active failed queue item can be retried")
	}
	active.status = acp.SessionQueueItemStatusQueued
	active.errMessage = ""
	s.queue.active = nil
	s.queue.waiting = append([]*sessionQueueItem{active}, s.queue.waiting...)
	s.queue.paused = false
	s.bumpQueueRevisionLocked()
	return nil
}

func (s *Session) resetQueue() acp.SessionQueueSnapshot {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	s.queueMu.Lock()
	s.queue = newSessionQueueState()
	snapshot := s.queueSnapshotLocked(true)
	s.queueMu.Unlock()
	return snapshot
}

func (s *Session) queueSnapshot(full bool) acp.SessionQueueSnapshot {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	return s.queueSnapshotLocked(full)
}

func (s *Session) queueSnapshotLocked(full bool) acp.SessionQueueSnapshot {
	snapshot := acp.SessionQueueSnapshot{
		Generation:   s.queue.generation,
		Revision:     s.queue.revision,
		Paused:       s.queue.paused,
		WaitingCount: len(s.queue.waiting),
	}
	if s.queue.active != nil {
		snapshot.ActiveKind = s.queue.active.wire.Kind
	}
	if !full {
		return snapshot
	}
	if s.queue.active != nil {
		item := queueItemSnapshot(s.queue.active, true)
		snapshot.ActiveItem = &item
	}
	if len(s.queue.waiting) > 0 {
		snapshot.WaitingItems = make([]acp.SessionQueueItem, 0, len(s.queue.waiting))
		for _, item := range s.queue.waiting {
			snapshot.WaitingItems = append(snapshot.WaitingItems, queueItemSnapshot(item, false))
		}
	}
	return snapshot
}

func (s *Session) queuePinsMemory() bool {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	return s.queue.active != nil || len(s.queue.waiting) > 0
}

func (s *Session) bumpQueueRevisionLocked() {
	s.queue.revision++
}

func normalizeSessionQueueItem(item acp.SessionQueueEnqueueItem) (acp.SessionQueueEnqueueItem, [sha256.Size]byte, error) {
	item.ItemID = strings.TrimSpace(item.ItemID)
	item.Kind = strings.TrimSpace(item.Kind)
	item.CreatedAt = strings.TrimSpace(item.CreatedAt)
	item.Blocks = cloneSessionContentBlocks(item.Blocks)
	if item.ItemID == "" {
		return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, sessionQueueRequestError(acp.CodeInvalidArgument, "item.itemId is required")
	}
	if item.CreatedAt == "" {
		return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, sessionQueueRequestError(acp.CodeInvalidArgument, "item.createdAt is required")
	}
	switch item.Kind {
	case acp.SessionQueueItemKindPrompt:
		if len(item.Blocks) == 0 {
			return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, sessionQueueRequestError(acp.CodeInvalidArgument, "prompt queue items require blocks")
		}
	case acp.SessionQueueItemKindCompact:
		if len(item.Blocks) != 0 {
			return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, sessionQueueRequestError(acp.CodeInvalidArgument, "compact queue items cannot contain blocks")
		}
	default:
		return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, sessionQueueRequestError(acp.CodeInvalidArgument, "item.kind must be prompt or compact")
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return acp.SessionQueueEnqueueItem{}, [sha256.Size]byte{}, fmt.Errorf("marshal session queue item: %w", err)
	}
	return item, sha256.Sum256(raw), nil
}

func queueItemSnapshot(item *sessionQueueItem, active bool) acp.SessionQueueItem {
	if item == nil {
		return acp.SessionQueueItem{}
	}
	return acp.SessionQueueItem{
		ItemID:          item.wire.ItemID,
		Kind:            item.wire.Kind,
		Status:          item.status,
		CreatedAt:       item.wire.CreatedAt,
		Blocks:          cloneSessionContentBlocks(item.wire.Blocks),
		CancelSupported: !active || item.status == acp.SessionQueueItemStatusFailed || item.wire.Kind == acp.SessionQueueItemKindPrompt,
		Error:           item.errMessage,
	}
}

func sessionQueueRequestError(code, message string) error {
	return &acp.RegistryRequestError{Code: code, Message: message}
}
