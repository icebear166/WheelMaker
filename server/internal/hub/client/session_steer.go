package client

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

type sessionPromptGeneration struct {
	id        uint64
	completed bool
	inflight  int
	resolved  chan struct{}
}

type sessionSteerState struct {
	nextGeneration uint64
	active         *sessionPromptGeneration
}

type sessionSteerAttempt struct {
	outcome string
}

const (
	sessionSteerAttemptTranscript = "transcript"
	sessionSteerAttemptFallback   = "fallback"
)

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
	if generation == nil || !generation.completed || generation.inflight != 0 {
		return
	}
	select {
	case <-generation.resolved:
	default:
		close(generation.resolved)
	}
}

func (s *Session) finishSteerAttempt(generation *sessionPromptGeneration) {
	s.mu.Lock()
	if generation.inflight > 0 {
		generation.inflight--
	}
	resolvePromptGenerationLocked(generation)
	s.mu.Unlock()
}

func (s *Session) clearSteerStateLocked() {
	s.steerState = sessionSteerState{}
}

func (s *Session) trySteerQueuePrompt(
	ctx context.Context,
	itemID string,
	blocks []acp.ContentBlock,
) (sessionSteerAttempt, error) {
	s.steerMu.Lock()
	defer s.steerMu.Unlock()
	if err := ctx.Err(); err != nil {
		return sessionSteerAttempt{}, err
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" || len(blocks) == 0 {
		return sessionSteerAttempt{}, fmt.Errorf("itemId and blocks are required")
	}

	s.mu.Lock()
	generation := s.steerState.active
	executionKind := s.executionKind
	instance := s.instance
	sessionID := s.acpSessionID
	if generation != nil && !generation.completed && executionKind == "prompt" {
		generation.inflight++
	}
	s.mu.Unlock()

	if generation == nil || generation.completed || executionKind != "prompt" {
		return sessionSteerAttempt{outcome: sessionSteerAttemptFallback}, nil
	}
	defer s.finishSteerAttempt(generation)
	if instance == nil {
		return sessionSteerAttempt{}, agent.ErrSessionSteerUnavailable
	}
	steerer, ok := instance.(agent.SessionSteerer)
	if !ok {
		return sessionSteerAttempt{}, agent.ErrSessionActionUnsupported
	}
	result, err := steerer.SteerSession(ctx, sessionID, itemID, cloneSessionContentBlocks(blocks))
	if err != nil {
		if errors.Is(err, agent.ErrSessionSteerInactive) {
			return sessionSteerAttempt{outcome: sessionSteerAttemptFallback}, nil
		}
		return sessionSteerAttempt{}, err
	}
	if result.AcceptedInput {
		messageLifecycle := true
		s.SessionUpdate(acp.SessionUpdateParams{
			SessionID: sessionID,
			Update: acp.SessionUpdate{
				SessionUpdate:    acp.SessionUpdateUserMessageChunk,
				MessageID:        itemID,
				ClientMessageID:  itemID,
				ContentBlocks:    cloneSessionContentBlocks(blocks),
				Steered:          true,
				MessageLifecycle: &messageLifecycle,
				Meta:             acp.BuildSessionUpdateMetaLifecycle("", true, true),
			},
		})
	}
	return sessionSteerAttempt{outcome: sessionSteerAttemptTranscript}, nil
}
