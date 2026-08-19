package client

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

func (c *Client) handleSubagentEvent(ctx context.Context, root *Session, event agent.SubagentEvent) {
	if c == nil || root == nil || c.store == nil || c.sessionRecorder == nil {
		return
	}
	root.mu.Lock()
	rootSessionID := strings.TrimSpace(root.acpSessionID)
	rootAgentType := strings.TrimSpace(root.agentType)
	root.mu.Unlock()
	if rootSessionID == "" || strings.TrimSpace(event.ChildSessionID) == "" {
		return
	}
	if event.RootSessionID != "" && strings.TrimSpace(event.RootSessionID) != rootSessionID {
		return
	}

	c.subagentMu.Lock()
	defer c.subagentMu.Unlock()
	child, projection, eventTime, err := c.upsertSubagentRelationLocked(ctx, rootSessionID, rootAgentType, event)
	if err != nil {
		hubLogger(c.projectName).Warn("persist subagent relation failed root=%s child=%s err=%v", rootSessionID, event.ChildSessionID, err)
		return
	}

	switch event.Event {
	case agent.SubagentEventTurnStarted:
		turnID := strings.TrimSpace(event.ProviderTurnID)
		if turnID != "" && projection.ProviderReplay.ActiveTurnID != turnID {
			projection.ProviderReplay.ActiveTurnID = turnID
			projection.SubagentStatus = subagentStatusRunning
			child.SessionSyncJSON = sessionSyncProjectionJSON(projection)
			child.LastActiveAt = eventTime
			if err := c.store.SaveSession(ctx, child); err != nil {
				hubLogger(c.projectName).Warn("persist subagent turn start failed child=%s err=%v", child.ID, err)
				return
			}
			prompt := firstNonEmpty(strings.TrimSpace(event.Prompt), strings.TrimSpace(projection.SubagentName), "Subagent task")
			if err := c.sessionRecorder.RecordEvent(ctx, SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: child.ID,
				Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
					"params": acp.SessionPromptParams{
						SessionID: child.ID,
						Prompt:    []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: prompt}},
					},
				}),
				UpdatedAt: eventTime,
			}); err != nil {
				hubLogger(c.projectName).Warn("record subagent prompt failed child=%s err=%v", child.ID, err)
			}
		}
	case agent.SubagentEventCompleted:
		turnID := strings.TrimSpace(event.ProviderTurnID)
		if projection.ProviderReplay.ActiveTurnID == "" || turnID == "" || projection.ProviderReplay.ActiveTurnID == turnID {
			stopReason := firstNonEmpty(strings.TrimSpace(event.StopReason), acp.StopReasonEndTurn)
			if err := c.sessionRecorder.RecordEvent(ctx, SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: child.ID,
				Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
					"result": acp.SessionTurnPromptResult{StopReason: stopReason, Message: strings.TrimSpace(event.Message)},
				}),
				UpdatedAt: eventTime,
			}); err != nil {
				hubLogger(c.projectName).Warn("record subagent completion failed child=%s err=%v", child.ID, err)
				return
			}
			child, err = c.store.LoadSession(ctx, c.projectName, child.ID)
			if err != nil || child == nil {
				return
			}
			projection = sessionSyncProjectionFromJSON(child.SessionSyncJSON)
			projection.ProviderReplay.ActiveTurnID = ""
			if turnID != "" {
				projection.ProviderReplay.LastCompletedTurnID = turnID
			}
			projection.SubagentStatus = transitionSubagentStatus(projection.SubagentStatus, normalizeSubagentStatus(event.Status))
			child.SessionSyncJSON = sessionSyncProjectionJSON(projection)
			child.LastActiveAt = eventTime
			if err := c.store.SaveSession(ctx, child); err != nil {
				hubLogger(c.projectName).Warn("persist subagent completion failed child=%s err=%v", child.ID, err)
				return
			}
		}
	}
	c.publishSubagentSummary(ctx, child.ID)
}

func (c *Client) loadRootSessionGroup(ctx context.Context, rootSessionID string) ([]SessionRecord, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("session store is required")
	}
	rootSessionID = strings.TrimSpace(rootSessionID)
	root, err := c.store.LoadSession(ctx, c.projectName, rootSessionID)
	if err != nil {
		return nil, err
	}
	if root == nil {
		return nil, fmt.Errorf("session not found: %s", rootSessionID)
	}
	rootProjection := sessionSyncProjectionFromJSON(root.SessionSyncJSON)
	if rootProjection.SessionKind == sessionKindSubagent {
		return nil, fmt.Errorf("subagent session %s cannot be managed independently", rootSessionID)
	}
	records, err := c.store.ListSessions(ctx, c.projectName)
	if err != nil {
		return nil, err
	}
	children := make([]SessionRecord, 0)
	for _, record := range records {
		projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
		if projection.SessionKind == sessionKindSubagent && projection.RootSessionID == rootSessionID {
			children = append(children, record)
		}
	}
	sort.Slice(children, func(i, j int) bool {
		left := sessionSyncProjectionFromJSON(children[i].SessionSyncJSON).SpawnSequence
		right := sessionSyncProjectionFromJSON(children[j].SessionSyncJSON).SpawnSequence
		if left == right {
			return children[i].ID < children[j].ID
		}
		return left < right
	})
	group := make([]SessionRecord, 0, len(children)+1)
	group = append(group, *root)
	group = append(group, children...)
	return group, nil
}

func (c *Client) activeSessionGroupMember(group []SessionRecord) string {
	for _, record := range group {
		if c.sessionIsRunning(record.ID) {
			return record.ID
		}
		projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
		switch projection.SubagentStatus {
		case subagentStatusInitializing, subagentStatusRunning, subagentStatusWaitingApproval:
			return record.ID
		}
	}
	return ""
}

func (c *Client) upsertSubagentRelationLocked(
	ctx context.Context,
	rootSessionID string,
	rootAgentType string,
	event agent.SubagentEvent,
) (*SessionRecord, sessionSyncProjection, time.Time, error) {
	childSessionID := strings.TrimSpace(event.ChildSessionID)
	eventTime := parseSubagentEventTime(event.OccurredAt)
	rootRecord, err := c.store.LoadSession(ctx, c.projectName, rootSessionID)
	if err != nil {
		return nil, sessionSyncProjection{}, eventTime, err
	}
	if rootRecord == nil {
		return nil, sessionSyncProjection{}, eventTime, fmt.Errorf("root session not found: %s", rootSessionID)
	}
	rootProjection := sessionSyncProjectionFromJSON(rootRecord.SessionSyncJSON)
	if rootProjection.NextSubagentSequence <= 0 {
		rootProjection.NextSubagentSequence = 1
	}

	child, err := c.store.LoadSession(ctx, c.projectName, childSessionID)
	if err != nil {
		return nil, sessionSyncProjection{}, eventTime, err
	}
	projection := sessionSyncProjection{}
	if child != nil {
		projection = sessionSyncProjectionFromJSON(child.SessionSyncJSON)
		if projection.SessionKind != "" && projection.SessionKind != sessionKindSubagent {
			return nil, sessionSyncProjection{}, eventTime, fmt.Errorf("session %s is not a subagent", childSessionID)
		}
		if projection.RootSessionID != "" && projection.RootSessionID != rootSessionID {
			return nil, sessionSyncProjection{}, eventTime, fmt.Errorf("subagent %s belongs to root %s", childSessionID, projection.RootSessionID)
		}
	}
	if projection.SpawnSequence <= 0 {
		records, listErr := c.store.ListSessions(ctx, c.projectName)
		if listErr != nil {
			return nil, sessionSyncProjection{}, eventTime, listErr
		}
		for _, record := range records {
			relation := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
			if relation.RootSessionID == rootSessionID && relation.SpawnSequence >= rootProjection.NextSubagentSequence {
				rootProjection.NextSubagentSequence = relation.SpawnSequence + 1
			}
		}
		projection.SpawnSequence = rootProjection.NextSubagentSequence
		rootProjection.NextSubagentSequence++
		rootRecord.SessionSyncJSON = sessionSyncProjectionJSON(rootProjection)
		if err := c.store.SaveSession(ctx, rootRecord); err != nil {
			return nil, sessionSyncProjection{}, eventTime, err
		}
	}

	if child == nil {
		child = &SessionRecord{
			ID:           childSessionID,
			ProjectName:  c.projectName,
			Status:       SessionPersisted,
			AgentType:    rootAgentType,
			CreatedAt:    eventTime,
			LastActiveAt: eventTime,
		}
	}
	projection.SessionKind = sessionKindSubagent
	projection.ParentSessionID = firstNonEmpty(strings.TrimSpace(event.ParentSessionID), projection.ParentSessionID, rootSessionID)
	projection.RootSessionID = rootSessionID
	projection.ProviderThreadID = firstNonEmpty(strings.TrimSpace(event.ProviderThreadID), projection.ProviderThreadID)
	projection.ParentProviderThreadID = firstNonEmpty(strings.TrimSpace(event.ParentProviderThreadID), projection.ParentProviderThreadID)
	projection.SpawnItemID = firstNonEmpty(strings.TrimSpace(event.SpawnItemID), projection.SpawnItemID)
	projection.SubagentPrompt = firstNonEmpty(strings.TrimSpace(event.Prompt), projection.SubagentPrompt)
	projection.SubagentName = firstNonEmpty(strings.TrimSpace(event.Name), projection.SubagentName, strings.TrimSpace(event.Role), "Subagent")
	projection.SubagentRole = firstNonEmpty(strings.TrimSpace(event.Role), projection.SubagentRole)
	projection.SubagentStatus = transitionSubagentStatus(projection.SubagentStatus, normalizeSubagentStatus(event.Status))
	projection.ReadOnly = true
	if projection.SpawnedAt == "" {
		projection.SpawnedAt = eventTime.Format(time.RFC3339Nano)
	}
	child.AgentType = firstNonEmpty(strings.TrimSpace(child.AgentType), rootAgentType)
	child.Title = firstNonEmpty(strings.TrimSpace(child.Title), projection.SubagentName)
	child.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	child.LastActiveAt = eventTime
	if child.CreatedAt.IsZero() {
		child.CreatedAt = eventTime
	}
	if err := c.store.SaveSession(ctx, child); err != nil {
		return nil, sessionSyncProjection{}, eventTime, err
	}
	return child, projection, eventTime, nil
}

func (c *Client) recordSubagentAgentEvent(ctx context.Context, rootSessionID string, event acp.AgentEvent) {
	if c == nil || c.store == nil || c.sessionRecorder == nil {
		return
	}
	childSessionID := strings.TrimSpace(event.SessionID)
	record, err := c.store.LoadSession(ctx, c.projectName, childSessionID)
	if err != nil || record == nil {
		return
	}
	projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
	if projection.SessionKind != sessionKindSubagent || projection.RootSessionID != strings.TrimSpace(rootSessionID) {
		return
	}
	params, err := event.LegacySessionUpdate()
	if err != nil {
		return
	}
	if err := c.sessionRecorder.RecordEvent(ctx, SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: childSessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
			"params": params,
		}),
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		hubLogger(c.projectName).Warn("record subagent update failed child=%s err=%v", childSessionID, err)
	}
}

func (c *Client) publishSubagentSummary(ctx context.Context, sessionID string) {
	if c == nil || c.sessionRecorder == nil {
		return
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, sessionID)
	if err == nil {
		c.sessionRecorder.publishSessionUpdated(summary)
	}
}

func parseSubagentEventTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Now().UTC()
}

func normalizeSubagentStatus(value string) subagentStatus {
	switch subagentStatus(strings.TrimSpace(value)) {
	case subagentStatusInitializing, subagentStatusRunning, subagentStatusWaitingApproval,
		subagentStatusCompleted, subagentStatusFailed, subagentStatusInterrupted:
		return subagentStatus(strings.TrimSpace(value))
	default:
		return ""
	}
}

func transitionSubagentStatus(current, next subagentStatus) subagentStatus {
	if next == "" {
		if current == "" {
			return subagentStatusInitializing
		}
		return current
	}
	if next == subagentStatusRunning || next == subagentStatusWaitingApproval {
		return next
	}
	if current == subagentStatusCompleted && next == subagentStatusInterrupted {
		return current
	}
	return next
}

func (c *Client) isSubagentOfRoot(ctx context.Context, childSessionID, rootSessionID string) bool {
	if c == nil || c.store == nil {
		return false
	}
	record, err := c.store.LoadSession(ctx, c.projectName, strings.TrimSpace(childSessionID))
	if err != nil || record == nil {
		return false
	}
	projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
	return projection.SessionKind == sessionKindSubagent && projection.RootSessionID == strings.TrimSpace(rootSessionID)
}

func (c *Client) setSubagentPermissionStatus(ctx context.Context, childSessionID string, waiting bool) {
	if c == nil || c.store == nil {
		return
	}
	c.subagentMu.Lock()
	defer c.subagentMu.Unlock()
	record, err := c.store.LoadSession(ctx, c.projectName, strings.TrimSpace(childSessionID))
	if err != nil || record == nil {
		return
	}
	projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
	if projection.SessionKind != sessionKindSubagent {
		return
	}
	status := subagentStatusRunning
	if waiting {
		status = subagentStatusWaitingApproval
	}
	projection.SubagentStatus = transitionSubagentStatus(projection.SubagentStatus, status)
	record.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	record.LastActiveAt = time.Now().UTC()
	if c.store.SaveSession(ctx, record) == nil {
		c.publishSubagentSummary(ctx, record.ID)
	}
}

func (c *Client) persistedSubagentBindings(ctx context.Context, rootSessionID string) ([]agent.SubagentBinding, error) {
	if c == nil || c.store == nil {
		return nil, nil
	}
	records, err := c.store.ListSessions(ctx, c.projectName)
	if err != nil {
		return nil, err
	}
	bindings := make([]agent.SubagentBinding, 0)
	for index := range records {
		record := &records[index]
		projection := sessionSyncProjectionFromJSON(record.SessionSyncJSON)
		if projection.SessionKind != sessionKindSubagent || projection.RootSessionID != strings.TrimSpace(rootSessionID) || projection.ProviderThreadID == "" {
			continue
		}
		bindings = append(bindings, agent.SubagentBinding{
			ChildSessionID:         record.ID,
			ParentSessionID:        projection.ParentSessionID,
			RootSessionID:          projection.RootSessionID,
			ProviderThreadID:       projection.ProviderThreadID,
			ParentProviderThreadID: projection.ParentProviderThreadID,
			SpawnItemID:            projection.SpawnItemID,
			Prompt:                 projection.SubagentPrompt,
			Name:                   projection.SubagentName,
			Role:                   projection.SubagentRole,
			Status:                 string(projection.SubagentStatus),
			LastCompletedTurnID:    projection.ProviderReplay.LastCompletedTurnID,
		})
		if projection.ProviderReplay.ActiveTurnID != "" {
			// Live prompt state is intentionally not durable. Clearing this marker
			// lets provider thread/read reconstruct the active turn exactly once.
			projection.ProviderReplay.ActiveTurnID = ""
			record.SessionSyncJSON = sessionSyncProjectionJSON(projection)
			if err := c.store.SaveSession(ctx, record); err != nil {
				return nil, err
			}
		}
	}
	return bindings, nil
}
