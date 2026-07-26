package client

import (
	"context"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const sessionGoalExecutionKind = "goal"

type sessionGoalState struct {
	turnActive           bool
	turnID               string
	continuationCount    int
	releaseAfterTurn     bool
	suppressPromptResult bool
}

func cloneSessionGoal(goal *acp.SessionGoal) *acp.SessionGoal {
	if goal == nil {
		return nil
	}
	cloned := *goal
	if goal.TokenBudget != nil {
		budget := *goal.TokenBudget
		cloned.TokenBudget = &budget
	}
	return &cloned
}

func parseGoalCommand(blocks []acp.ContentBlock) (raw string, objective string, matched bool, err error) {
	if len(blocks) != 1 || blocks[0].Type != acp.ContentBlockTypeText {
		return "", "", false, nil
	}
	raw = blocks[0].Text
	trimmed := strings.TrimSpace(raw)
	if trimmed == "/goal" {
		return raw, "", true, fmt.Errorf("goal objective is required")
	}
	if !strings.HasPrefix(trimmed, "/goal") {
		return "", "", false, nil
	}
	remainder := strings.TrimPrefix(trimmed, "/goal")
	first, _ := utf8.DecodeRuneInString(remainder)
	if first == utf8.RuneError || !unicode.IsSpace(first) {
		return "", "", false, nil
	}
	objective = strings.TrimSpace(remainder)
	if objective == "" {
		return raw, "", true, fmt.Errorf("goal objective is required")
	}
	if utf8.RuneCountInString(objective) > 4000 {
		return raw, "", true, fmt.Errorf("goal objective must be at most 4000 characters")
	}
	return raw, objective, true, nil
}

func validateGoalObjective(objective string) (string, error) {
	objective = strings.TrimSpace(objective)
	if objective == "" {
		return "", fmt.Errorf("goal objective is required")
	}
	if utf8.RuneCountInString(objective) > 4000 {
		return "", fmt.Errorf("goal objective must be at most 4000 characters")
	}
	return objective, nil
}

func goalBlocks(raw string) []acp.ContentBlock {
	return []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: raw}}
}

func (s *Session) GoalSnapshot() *acp.SessionGoal {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneSessionGoal(s.agentState.Goal)
}

func (s *Session) CreateGoalFromCommand(
	ctx context.Context,
	raw string,
	objective string,
	tokenBudget acp.OptionalInt64,
) (acp.SessionGoal, error) {
	objective, err := validateGoalObjective(objective)
	if err != nil {
		return acp.SessionGoal{}, err
	}
	s.mu.Lock()
	existing := cloneSessionGoal(s.agentState.Goal)
	s.mu.Unlock()
	if existing != nil && existing.Status != acp.SessionGoalStatusComplete {
		return acp.SessionGoal{}, fmt.Errorf("session already has an unfinished goal; clear it before creating another")
	}
	if err := s.beginExecution(sessionGoalExecutionKind); err != nil {
		return acp.SessionGoal{}, err
	}
	release := true
	defer func() {
		if release {
			s.endExecution()
		}
	}()

	s.recordSessionViewEvent(SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: s.acpSessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"params": acp.SessionPromptParams{
				SessionID: s.acpSessionID,
				Prompt:    goalBlocks(raw),
			},
		}),
	})

	controller, sessionID, err := s.goalController(ctx)
	if err != nil {
		s.recordPromptFailed(fmt.Sprintf("Goal error: %v", err))
		return acp.SessionGoal{}, err
	}
	active := acp.SessionGoalStatusActive
	goal, err := controller.SessionGoalSet(ctx, acp.SessionGoalSetParams{
		SessionID:   sessionID,
		Objective:   &objective,
		Status:      &active,
		TokenBudget: tokenBudget,
	})
	if err != nil {
		s.recordPromptFailed(fmt.Sprintf("Goal error: %v", err))
		return acp.SessionGoal{}, err
	}
	release = false
	s.applyGoalSnapshot(&goal)
	return goal, nil
}

func (s *Session) UpdateGoal(ctx context.Context, patch acp.SessionGoalSetParams) (acp.SessionGoal, error) {
	current := s.GoalSnapshot()
	if current == nil {
		return acp.SessionGoal{}, fmt.Errorf("session goal not found")
	}
	if patch.Objective == nil && patch.Status == nil && !patch.TokenBudget.Present {
		return acp.SessionGoal{}, fmt.Errorf("goal update is empty")
	}
	if patch.Objective != nil {
		objective, err := validateGoalObjective(*patch.Objective)
		if err != nil {
			return acp.SessionGoal{}, err
		}
		patch.Objective = &objective
	}
	if patch.TokenBudget.Present && patch.TokenBudget.Value != nil && *patch.TokenBudget.Value <= 0 {
		return acp.SessionGoal{}, fmt.Errorf("tokenBudget must be positive or null")
	}
	if patch.Status != nil && *patch.Status != acp.SessionGoalStatusActive && *patch.Status != acp.SessionGoalStatusPaused {
		return acp.SessionGoal{}, fmt.Errorf("goal status can only be active or paused")
	}

	acquired := false
	upgraded := false
	if patch.Status != nil && *patch.Status == acp.SessionGoalStatusActive && current.Status != acp.SessionGoalStatusActive {
		s.mu.Lock()
		kind := s.executionKind
		switch kind {
		case "prompt":
			s.executionKind = sessionGoalExecutionKind
			s.goal.suppressPromptResult = true
			s.goal.continuationCount = 0
			upgraded = true
			s.mu.Unlock()
		case "":
			s.mu.Unlock()
			if err := s.beginExecution(sessionGoalExecutionKind); err != nil {
				return acp.SessionGoal{}, err
			}
			acquired = true
			s.mu.Lock()
			s.goal.continuationCount = 1
			s.mu.Unlock()
		case sessionGoalExecutionKind:
			s.mu.Unlock()
		default:
			s.mu.Unlock()
			return acp.SessionGoal{}, agent.ErrSessionBusy
		}
	}

	controller, sessionID, err := s.goalController(ctx)
	if err != nil {
		s.rollbackGoalOwnership(acquired, upgraded)
		return acp.SessionGoal{}, err
	}
	patch.SessionID = sessionID
	goal, err := controller.SessionGoalSet(ctx, patch)
	if err != nil {
		s.rollbackGoalOwnership(acquired, upgraded)
		return acp.SessionGoal{}, err
	}
	s.applyGoalSnapshot(&goal)
	return goal, nil
}

func (s *Session) StopGoal(ctx context.Context) (*acp.SessionGoal, error) {
	paused := acp.SessionGoalStatusPaused
	goal, err := s.UpdateGoal(ctx, acp.SessionGoalSetParams{Status: &paused})
	if err != nil {
		return nil, err
	}
	if err := s.cancelPrompt(); err != nil {
		return nil, err
	}
	return &goal, nil
}

func (s *Session) ClearGoal(ctx context.Context) error {
	if s.GoalSnapshot() == nil {
		return nil
	}
	controller, sessionID, err := s.goalController(ctx)
	if err != nil {
		return err
	}
	if err := controller.SessionGoalClear(ctx, sessionID); err != nil {
		return err
	}
	s.applyGoalCleared()
	return nil
}

func (s *Session) goalController(ctx context.Context) (agent.SessionGoalController, string, error) {
	if err := s.ensureInstance(ctx); err != nil {
		return nil, "", err
	}
	if err := s.ensureReadyAndNotify(ctx); err != nil {
		return nil, "", err
	}
	s.mu.Lock()
	instance := s.instance
	sessionID := s.acpSessionID
	s.mu.Unlock()
	controller, ok := instance.(agent.SessionGoalController)
	if !ok {
		return nil, "", agent.ErrSessionActionUnsupported
	}
	return controller, sessionID, nil
}

func (s *Session) rollbackGoalOwnership(acquired bool, upgraded bool) {
	if acquired {
		s.endExecution()
		return
	}
	if upgraded {
		s.mu.Lock()
		if s.executionKind == sessionGoalExecutionKind {
			s.executionKind = "prompt"
		}
		s.goal.suppressPromptResult = false
		s.mu.Unlock()
	}
}

func (s *Session) applyGoalSnapshot(goal *acp.SessionGoal) {
	if goal == nil {
		return
	}
	next := cloneSessionGoal(goal)
	s.mu.Lock()
	next.SessionID = s.acpSessionID
	s.agentState.Goal = next
	shouldRelease := false
	if next.Status != acp.SessionGoalStatusActive && s.executionKind == sessionGoalExecutionKind {
		if s.goal.turnActive {
			s.goal.releaseAfterTurn = true
		} else {
			shouldRelease = true
		}
	}
	s.mu.Unlock()
	s.persistAndPublishGoal()
	if shouldRelease {
		s.finishGoalExecution()
	}
}

func (s *Session) applyGoalCleared() {
	s.mu.Lock()
	s.agentState.Goal = nil
	shouldRelease := false
	if s.executionKind == sessionGoalExecutionKind {
		if s.goal.turnActive {
			s.goal.releaseAfterTurn = true
		} else {
			shouldRelease = true
		}
	}
	s.mu.Unlock()
	s.persistAndPublishGoal()
	if shouldRelease {
		s.finishGoalExecution()
	}
}

func (s *Session) handleGoalTurnStarted(turnID string) {
	turnID = strings.TrimSpace(turnID)
	s.mu.Lock()
	if s.executionKind == "" {
		s.mu.Unlock()
		if err := s.beginExecution(sessionGoalExecutionKind); err != nil {
			return
		}
		s.mu.Lock()
		s.goal.continuationCount = 1
	}
	if s.executionKind != sessionGoalExecutionKind {
		s.mu.Unlock()
		return
	}
	needsDivider := s.goal.continuationCount > 0
	s.goal.continuationCount++
	s.goal.turnActive = true
	s.goal.turnID = turnID
	s.goal.releaseAfterTurn = false
	s.mu.Unlock()
	if needsDivider {
		if recorder, ok := s.viewSink.(interface {
			RecordGoalContinuation(context.Context, string) error
		}); ok {
			if err := recorder.RecordGoalContinuation(context.Background(), s.acpSessionID); err != nil {
				hubLogger(s.projectName).Warn("record goal continuation failed session=%s err=%v", s.acpSessionID, err)
			}
		}
	}
}

func (s *Session) handleGoalTurnCompleted(turnID string) {
	turnID = strings.TrimSpace(turnID)
	s.mu.Lock()
	if !s.goal.turnActive || (s.goal.turnID != "" && turnID != "" && s.goal.turnID != turnID) {
		s.mu.Unlock()
		return
	}
	s.goal.turnActive = false
	s.goal.turnID = ""
	status := ""
	if s.agentState.Goal != nil {
		status = s.agentState.Goal.Status
	}
	shouldRelease := s.goal.releaseAfterTurn || status == "" || status != acp.SessionGoalStatusActive
	s.mu.Unlock()
	if shouldRelease {
		s.finishGoalExecution()
	}
}

func (s *Session) finishGoalExecution() {
	s.mu.Lock()
	if s.executionKind != sessionGoalExecutionKind {
		s.mu.Unlock()
		return
	}
	s.goal.turnActive = false
	s.goal.turnID = ""
	s.goal.releaseAfterTurn = false
	s.mu.Unlock()
	s.recordPromptDone(acp.StopReasonEndTurn, "")
	s.endExecution()
	s.publishGoalSummary()
}

func (s *Session) persistAndPublishGoal() {
	s.persistSessionBestEffort()
	s.publishGoalSummary()
}

func (s *Session) publishGoalSummary() {
	if publisher, ok := s.viewSink.(interface {
		PublishSessionSummary(context.Context, string) error
	}); ok {
		if err := publisher.PublishSessionSummary(context.Background(), s.acpSessionID); err != nil {
			hubLogger(s.projectName).Warn("publish goal summary failed session=%s err=%v", s.acpSessionID, err)
		}
	}
}

func isGoalLifecycleUpdate(update string) bool {
	switch update {
	case acp.SessionUpdateGoalUpdated,
		acp.SessionUpdateGoalCleared,
		acp.SessionUpdateGoalTurnStarted,
		acp.SessionUpdateGoalTurnCompleted:
		return true
	default:
		return false
	}
}

func (s *Session) handleGoalLifecycleUpdate(update acp.SessionUpdate) {
	switch update.SessionUpdate {
	case acp.SessionUpdateGoalUpdated:
		s.applyGoalSnapshot(update.Goal)
	case acp.SessionUpdateGoalCleared:
		s.applyGoalCleared()
	case acp.SessionUpdateGoalTurnStarted:
		s.handleGoalTurnStarted(update.TurnID)
	case acp.SessionUpdateGoalTurnCompleted:
		s.handleGoalTurnCompleted(update.TurnID)
	}
}
