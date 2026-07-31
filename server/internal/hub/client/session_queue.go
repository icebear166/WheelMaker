package client

import (
	"context"
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

const (
	sessionExecutionCompleted = "completed"
	sessionExecutionCancelled = "cancelled"
	sessionExecutionFailed    = "failed"
)

type sessionExecutionOutcome struct {
	status string
	err    error
}

type sessionQueueItem struct {
	wire            acp.SessionQueueEnqueueItem
	status          string
	errMessage      string
	payloadHash     [sha256.Size]byte
	steerCancel     context.CancelFunc
	executionCtx    context.Context
	executionCancel context.CancelFunc
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
	return s.enqueueQueueItemWithPrecommit(item, nil)
}

func (s *Session) enqueueQueueItemWithPrecommit(
	item acp.SessionQueueEnqueueItem,
	precommit func() error,
) (acp.SessionQueueSnapshot, bool, error) {
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
	s.queueMu.Unlock()

	if precommit != nil {
		if err := precommit(); err != nil {
			return s.queueSnapshot(true), false, err
		}
	}

	s.queueMu.Lock()
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

func (s *Session) enqueueAndScheduleQueueItem(item acp.SessionQueueEnqueueItem) (acp.SessionQueueSnapshot, bool, error) {
	snapshot, duplicate, err := s.enqueueQueueItem(item)
	if err != nil {
		return snapshot, duplicate, err
	}
	s.publishQueueSnapshot()
	s.scheduleQueueDrain()
	return snapshot, duplicate, nil
}

func (s *Session) cancelQueueItem(itemID string) error {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return sessionQueueRequestError(acp.CodeInvalidArgument, "itemId is required")
	}

	s.queueMu.Lock()
	if active := s.queue.active; active != nil && active.wire.ItemID == itemID {
		if active.status == acp.SessionQueueItemStatusFailed {
			s.queue.active = nil
			s.queue.paused = false
			s.bumpQueueRevisionLocked()
			s.queueMu.Unlock()
			return nil
		}
		if active.wire.Kind == acp.SessionQueueItemKindCompact {
			s.queueMu.Unlock()
			return agent.ErrSessionActionUnsupported
		}
		if active.status == acp.SessionQueueItemStatusCancelling {
			s.queueMu.Unlock()
			return nil
		}
		active.status = acp.SessionQueueItemStatusCancelling
		executionCancel := active.executionCancel
		s.bumpQueueRevisionLocked()
		s.queueMu.Unlock()
		if executionCancel != nil {
			executionCancel()
		}
		s.publishQueueSnapshot()
		go func() {
			if err := s.cancelPrompt(); err != nil {
				hubLogger(s.projectName).Warn("cancel queued prompt failed session=%s item=%s err=%v", s.acpSessionID, itemID, err)
			}
		}()
		return nil
	}
	for i, item := range s.queue.waiting {
		if item.wire.ItemID != itemID {
			continue
		}
		if item.steerCancel != nil {
			item.steerCancel()
			item.steerCancel = nil
		}
		s.queue.waiting = append(s.queue.waiting[:i], s.queue.waiting[i+1:]...)
		s.bumpQueueRevisionLocked()
		s.queueMu.Unlock()
		return nil
	}
	s.queueMu.Unlock()
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
		if item.status != acp.SessionQueueItemStatusQueued {
			return sessionQueueRequestError(acp.CodeConflict, "only a queued waiting item can be prioritized")
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

func (s *Session) steerQueueItem(ctx context.Context, itemID string) error {
	s.queueOpMu.Lock()

	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		s.queueOpMu.Unlock()
		return sessionQueueRequestError(acp.CodeInvalidArgument, "itemId is required")
	}

	s.queueMu.Lock()
	originalIndex := -1
	var target *sessionQueueItem
	for index, item := range s.queue.waiting {
		if item.wire.ItemID == itemID {
			originalIndex = index
			target = item
			break
		}
	}
	if target == nil {
		s.queueMu.Unlock()
		s.queueOpMu.Unlock()
		return sessionQueueRequestError(acp.CodeNotFound, "waiting queue item was not found")
	}
	if target.wire.Kind != acp.SessionQueueItemKindPrompt || target.status != acp.SessionQueueItemStatusQueued {
		s.queueMu.Unlock()
		s.queueOpMu.Unlock()
		return sessionQueueRequestError(acp.CodeConflict, "only a queued waiting prompt can be steered")
	}
	steerCtx, cancelSteer := context.WithCancel(ctx)
	target.status = acp.SessionQueueItemStatusSteering
	target.steerCancel = cancelSteer
	blocks := cloneSessionContentBlocks(target.wire.Blocks)
	s.bumpQueueRevisionLocked()
	s.queueMu.Unlock()
	s.queueOpMu.Unlock()
	s.publishQueueSnapshot()

	attempt, err := s.trySteerQueuePrompt(steerCtx, itemID, blocks)
	cancelSteer()

	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()
	s.queueMu.Lock()
	currentIndex := -1
	for index, item := range s.queue.waiting {
		if item == target {
			currentIndex = index
			break
		}
	}
	if currentIndex < 0 {
		s.queueMu.Unlock()
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	target.steerCancel = nil
	if err == nil && attempt.outcome == sessionSteerAttemptTranscript {
		s.queueMu.Unlock()
		return nil
	}

	s.queue.waiting = append(s.queue.waiting[:currentIndex], s.queue.waiting[currentIndex+1:]...)
	insertAt := originalIndex
	if err == nil && attempt.outcome == sessionSteerAttemptFallback {
		insertAt = 0
	}
	if insertAt < 0 {
		insertAt = 0
	}
	if insertAt > len(s.queue.waiting) {
		insertAt = len(s.queue.waiting)
	}
	s.queue.waiting = append(s.queue.waiting, nil)
	copy(s.queue.waiting[insertAt+1:], s.queue.waiting[insertAt:])
	s.queue.waiting[insertAt] = target
	target.status = acp.SessionQueueItemStatusQueued
	s.bumpQueueRevisionLocked()
	s.queueMu.Unlock()
	s.publishQueueSnapshot()
	return err
}

func (s *Session) completeSteeredQueueItem(clientMessageID string) {
	clientMessageID = strings.TrimSpace(clientMessageID)
	if clientMessageID == "" {
		return
	}
	s.queueMu.Lock()
	for index, item := range s.queue.waiting {
		if item.wire.ItemID != clientMessageID || item.status != acp.SessionQueueItemStatusSteering {
			continue
		}
		if item.steerCancel != nil {
			item.steerCancel()
			item.steerCancel = nil
		}
		s.queue.waiting = append(s.queue.waiting[:index], s.queue.waiting[index+1:]...)
		s.bumpQueueRevisionLocked()
		s.queueMu.Unlock()
		s.publishQueueSnapshot()
		return
	}
	s.queueMu.Unlock()
}

func (s *Session) resetQueue() acp.SessionQueueSnapshot {
	s.queueOpMu.Lock()
	defer s.queueOpMu.Unlock()

	s.queueMu.Lock()
	if s.queue.active != nil && s.queue.active.executionCancel != nil {
		s.queue.active.executionCancel()
	}
	for _, item := range s.queue.waiting {
		if item.steerCancel != nil {
			item.steerCancel()
		}
	}
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

func (s *Session) scheduleQueueDrain() {
	s.queueMu.Lock()
	if s.queueClosing || s.queue.draining || s.queue.paused || s.queue.active != nil || len(s.queue.waiting) == 0 {
		s.queueMu.Unlock()
		return
	}
	s.queue.draining = true
	s.queueDrainWG.Add(1)
	s.queueMu.Unlock()
	go func() {
		defer s.queueDrainWG.Done()
		s.drainQueue()
	}()
}

func (s *Session) drainQueue() {
	for {
		s.queueMu.Lock()
		if s.queueClosing || s.queue.paused || s.queue.active != nil || len(s.queue.waiting) == 0 {
			s.queue.draining = false
			s.queueMu.Unlock()
			return
		}
		nextKind := s.queue.waiting[0].wire.Kind
		s.queueMu.Unlock()

		executionKind := "prompt"
		if nextKind == acp.SessionQueueItemKindCompact {
			executionKind = acp.SessionOperationTypeCompact
		}
		if err := s.beginExecution(executionKind); err != nil {
			s.queueMu.Lock()
			s.queue.draining = false
			s.queueMu.Unlock()
			return
		}
		item, ok := s.promoteNextQueueItem()
		if !ok {
			s.endExecution()
			continue
		}
		s.publishQueueSnapshot()

		var outcome sessionExecutionOutcome
		switch item.wire.Kind {
		case acp.SessionQueueItemKindPrompt:
			outcome = s.runPromptTurnWithContext(
				item.executionCtx,
				cloneSessionContentBlocks(item.wire.Blocks),
				item.wire.ItemID,
			)
		case acp.SessionQueueItemKindCompact:
			outcome = s.runCompactionExecution(item.executionCtx, item.wire.ItemID)
		default:
			outcome = sessionExecutionOutcome{status: sessionExecutionFailed, err: fmt.Errorf("unsupported queue item kind %q", item.wire.Kind)}
		}
		s.finishActiveQueueItem(item.wire.ItemID, outcome)
		s.endExecution()
		if outcome.status == sessionExecutionFailed {
			s.queueMu.Lock()
			s.queue.draining = false
			s.queueMu.Unlock()
			return
		}
	}
}

func (s *Session) promoteNextQueueItem() (*sessionQueueItem, bool) {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	if s.queue.paused || s.queue.active != nil || len(s.queue.waiting) == 0 {
		return nil, false
	}
	item := s.queue.waiting[0]
	s.queue.waiting = s.queue.waiting[1:]
	item.status = acp.SessionQueueItemStatusRunning
	item.errMessage = ""
	item.executionCtx, item.executionCancel = context.WithCancel(context.Background())
	s.queue.active = item
	s.bumpQueueRevisionLocked()
	return item, true
}

func (s *Session) finishActiveQueueItem(itemID string, outcome sessionExecutionOutcome) {
	s.queueMu.Lock()
	active := s.queue.active
	if active == nil || active.wire.ItemID != itemID {
		s.queueMu.Unlock()
		return
	}
	executionCancel := active.executionCancel
	active.executionCtx = nil
	active.executionCancel = nil
	if outcome.status == sessionExecutionFailed {
		active.status = acp.SessionQueueItemStatusFailed
		active.errMessage = "queue execution failed"
		if outcome.err != nil {
			active.errMessage = outcome.err.Error()
		}
		s.queue.paused = true
	} else {
		s.queue.active = nil
		s.queue.paused = false
	}
	s.bumpQueueRevisionLocked()
	s.queueMu.Unlock()
	if executionCancel != nil {
		executionCancel()
	}
	s.publishQueueSnapshot()
}

func (s *Session) beginQueueShutdown() {
	s.mu.Lock()
	s.closing = true
	s.mu.Unlock()

	s.queueOpMu.Lock()
	s.queueMu.Lock()
	s.queueClosing = true
	var executionCancel context.CancelFunc
	if s.queue.active != nil {
		executionCancel = s.queue.active.executionCancel
	}
	for _, item := range s.queue.waiting {
		if item.steerCancel != nil {
			item.steerCancel()
		}
	}
	s.queue = newSessionQueueState()
	s.queueMu.Unlock()
	s.queueOpMu.Unlock()

	if executionCancel != nil {
		executionCancel()
	}
}

func (s *Session) waitQueueShutdown() {
	s.queueDrainWG.Wait()
}

func (s *Session) publishQueueSnapshot() {
	publisher, ok := s.viewSink.(interface {
		PublishSessionSummary(context.Context, string) error
	})
	if !ok {
		return
	}
	if err := publisher.PublishSessionSummary(context.Background(), s.acpSessionID); err != nil {
		hubLogger(s.projectName).Warn("publish session queue snapshot failed session=%s err=%v", s.acpSessionID, err)
	}
}
