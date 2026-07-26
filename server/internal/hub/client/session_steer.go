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

func (s *Session) clearSteerStateLocked() {
	s.steerState = sessionSteerState{}
}

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
	params.ClientMessageID = clientID

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
