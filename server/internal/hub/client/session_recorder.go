package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

type SessionViewEventType string

const (
	SessionViewEventTypeSystem SessionViewEventType = "system"
	SessionViewEventTypeACP    SessionViewEventType = "acp"
)

type SessionViewEvent struct {
	Type      SessionViewEventType
	SessionID string
	Content   string
	Artifacts []acp.SessionPromptArtifactPayload

	SourceChannel string
	SourceChatID  string
	UpdatedAt     time.Time
}

type SessionViewSink interface {
	RecordEvent(ctx context.Context, event SessionViewEvent) error
	RecordSessionOperation(ctx context.Context, sessionID string, payload acp.SessionOperationPayload) error
	RecordPermissionRequest(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionRequest) (int64, error)
	RecordPermissionResponse(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionResponse) (int64, error)
}

type sessionViewSummary struct {
	SessionID              string                        `json:"sessionId"`
	Title                  string                        `json:"title"`
	UpdatedAt              string                        `json:"updatedAt"`
	AgentType              string                        `json:"agentType,omitempty"`
	CreateRequestID        string                        `json:"createRequestId,omitempty"`
	LatestTurnIndex        int64                         `json:"latestTurnIndex"`
	Running                bool                          `json:"running"`
	LastDoneTurnIndex      int64                         `json:"lastDoneTurnIndex"`
	LastDoneSuccess        bool                          `json:"lastDoneSuccess"`
	LastReadTurnIndex      int64                         `json:"lastReadTurnIndex"`
	ConfigOptions          []acp.ConfigOption            `json:"configOptions,omitempty"`
	Usage                  *acp.SessionUsage             `json:"usage,omitempty"`
	SessionActions         acp.SessionActionCapabilities `json:"sessionActions"`
	PendingPermissionCount int                           `json:"pendingPermissionCount"`
}

type sessionTitleFacts struct {
	First  string `json:"first"`
	Last   string `json:"last"`
	Manual string `json:"manual,omitempty"`
}

type sessionSyncProjection struct {
	LatestPersistedTurnIndex int64 `json:"latestPersistedTurnIndex"`
	LastDoneTurnIndex        int64 `json:"lastDoneTurnIndex,omitempty"`
	LastDoneSuccess          *bool `json:"lastDoneSuccess,omitempty"`
	LastReadTurnIndex        int64 `json:"lastReadTurnIndex,omitempty"`
}

type sessionTurnMessage struct {
	sessionID string
	method    string
	payload   any
	turnIndex int64
	finished  bool
}

const sessionThoughtPublishInterval = 60 * time.Second

type sessionThoughtPublishState struct {
	turnIndex       int64
	lastPublishedAt time.Time
}

type sessionPromptState struct {
	nextTurnIndex int64

	turns          []sessionTurnMessage
	turnIndexByKey map[string]int64
}

type sessionViewSessionNewParams struct {
	SessionID string `json:"sessionId,omitempty"`
	AgentType string `json:"agentType,omitempty"`
	Title     string `json:"title,omitempty"`
}

type parsedSessionViewEvent struct {
	raw               SessionViewEvent
	bMessage          bool
	method            string
	payload           any
	artifacts         []acp.SessionPromptArtifactPayload
	acpMethod         string
	turnKey           string
	sessionInfoUpdate bool
	sessionInfoTitle  string
	usageUpdate       bool
}

type SessionRecorder struct {
	projectName   string
	store         Store
	turnStore     *fileSessionTurnStore
	artifactStore *fileSessionArtifactStore
	listSessions  func(context.Context) ([]SessionRecord, error)

	mu      sync.Mutex
	publish func(method string, payload any) error

	writeMu          sync.Mutex
	promptState      map[string]*sessionPromptState
	nextTurnIndex    map[string]int64
	finishedTurns    map[string][]sessionViewTurn
	activeOperations map[string]map[string]struct{}
	thoughtPublish   map[string]sessionThoughtPublishState
	now              func() time.Time

	modelLookup  func(sessionID string) string
	actionLookup func(agentType string) acp.SessionActionCapabilities
}

func newSessionRecorder(projectName string, store Store, listSessions func(context.Context) ([]SessionRecord, error)) *SessionRecorder {
	return &SessionRecorder{
		projectName:      projectName,
		store:            store,
		listSessions:     listSessions,
		promptState:      map[string]*sessionPromptState{},
		nextTurnIndex:    map[string]int64{},
		finishedTurns:    map[string][]sessionViewTurn{},
		activeOperations: map[string]map[string]struct{}{},
		thoughtPublish:   map[string]sessionThoughtPublishState{},
		now:              time.Now,
	}
}

func (r *SessionRecorder) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.publish = nil
	r.mu.Unlock()
	r.writeMu.Lock()
	r.promptState = map[string]*sessionPromptState{}
	r.nextTurnIndex = map[string]int64{}
	r.finishedTurns = map[string][]sessionViewTurn{}
	r.activeOperations = map[string]map[string]struct{}{}
	r.thoughtPublish = map[string]sessionThoughtPublishState{}
	r.writeMu.Unlock()
}

func (r *SessionRecorder) ResetPromptState() {
	if r == nil {
		return
	}
	r.writeMu.Lock()
	r.promptState = map[string]*sessionPromptState{}
	r.nextTurnIndex = map[string]int64{}
	r.finishedTurns = map[string][]sessionViewTurn{}
	r.activeOperations = map[string]map[string]struct{}{}
	r.thoughtPublish = map[string]sessionThoughtPublishState{}
	r.writeMu.Unlock()
}

func (r *SessionRecorder) RemovePromptState(sessionID string) {
	if r == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	r.writeMu.Lock()
	delete(r.promptState, sessionID)
	delete(r.nextTurnIndex, sessionID)
	delete(r.finishedTurns, sessionID)
	delete(r.activeOperations, sessionID)
	delete(r.thoughtPublish, sessionID)
	r.writeMu.Unlock()
}

func (r *SessionRecorder) ResetSessionTurns(ctx context.Context, sessionID string) error {
	if r == nil {
		return nil
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil
	}
	r.RemovePromptState(sessionID)
	if r.turnStore != nil {
		if err := r.turnStore.DeleteTurns(ctx, r.projectName, sessionID); err != nil {
			return err
		}
	}
	if r.artifactStore != nil {
		if err := r.artifactStore.DeleteArtifacts(ctx, r.projectName, sessionID); err != nil {
			return err
		}
	}
	return nil
}

func (r *SessionRecorder) DeleteSessionData(ctx context.Context, sessionID string) error {
	if r == nil {
		return nil
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil
	}
	r.RemovePromptState(sessionID)
	r.writeMu.Lock()
	delete(r.activeOperations, sessionID)
	r.writeMu.Unlock()
	if r.turnStore != nil {
		if err := r.turnStore.DeleteSession(ctx, r.projectName, sessionID); err != nil {
			return err
		}
	}
	if r.artifactStore != nil {
		if err := r.artifactStore.DeleteArtifacts(ctx, r.projectName, sessionID); err != nil {
			return err
		}
	}
	return nil
}

func (r *SessionRecorder) RecordSessionOperation(ctx context.Context, sessionID string, payload acp.SessionOperationPayload) error {
	if r == nil {
		return fmt.Errorf("session recorder is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	payload.OperationID = strings.TrimSpace(payload.OperationID)
	payload.Type = strings.TrimSpace(payload.Type)
	payload.Status = strings.TrimSpace(payload.Status)
	if sessionID == "" || payload.OperationID == "" || payload.Type == "" {
		return fmt.Errorf("session operation identity is required")
	}
	switch payload.Status {
	case acp.SessionOperationStatusStarted, acp.SessionOperationStatusCompleted, acp.SessionOperationStatusFailed:
	default:
		return fmt.Errorf("unsupported session operation status: %s", payload.Status)
	}

	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return err
	}
	if rec == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	turnIndex := projection.LatestPersistedTurnIndex + 1
	content := buildSessionTurnContentJSON(acp.SessionTurnMethodOperation, payload)
	if r.turnStore != nil {
		latest, err := r.turnStore.WriteTurns(ctx, r.projectName, sessionID, turnIndex, []string{content})
		if err != nil {
			return err
		}
		turnIndex = latest
	} else {
		r.finishedTurns[sessionID] = append(r.finishedTurns[sessionID], sessionViewTurn{
			TurnIndex: turnIndex,
			Content:   content,
			Finished:  true,
		})
	}
	if r.activeOperations[sessionID] == nil {
		r.activeOperations[sessionID] = map[string]struct{}{}
	}
	if payload.Status == acp.SessionOperationStatusStarted {
		r.activeOperations[sessionID][payload.OperationID] = struct{}{}
	} else {
		delete(r.activeOperations[sessionID], payload.OperationID)
		if len(r.activeOperations[sessionID]) == 0 {
			delete(r.activeOperations, sessionID)
		}
	}
	projection.LatestPersistedTurnIndex = turnIndex
	rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	// Session operations (e.g. compact) are not prompt activity and must not
	// advance LastActiveAt; only session create, prompt start and prompt done do.
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return err
	}
	r.nextTurnIndex[sessionID] = turnIndex + 1
	turn := sessionTurnMessage{
		sessionID: sessionID,
		method:    acp.SessionTurnMethodOperation,
		payload:   payload,
		turnIndex: turnIndex,
		finished:  true,
	}
	r.publishSessionTurn(turn, content)
	r.publishSessionUpdated(r.sessionViewSummaryFromRecordLocked(*rec))
	return nil
}

func (r *SessionRecorder) HasUnfinishedPrompt(sessionID string) bool {
	if r == nil {
		return false
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	state := r.promptState[sessionID]
	return state != nil && len(state.turns) > 0 && !sessionPromptStateTerminal(state)
}

func (r *SessionRecorder) ReadPersistedTurnContentsForArchive(ctx context.Context, sessionID string, latestTurnIndex int64) ([]string, int, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	if r == nil {
		return nil, 0, fmt.Errorf("session recorder is required")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, 0, fmt.Errorf("session id is required")
	}
	if latestTurnIndex <= 0 {
		return nil, 0, nil
	}

	contents := make([]string, 0, latestTurnIndex)
	gapCount := 0
	if r.turnStore != nil {
		for turnIndex := int64(1); turnIndex <= latestTurnIndex; turnIndex++ {
			if err := ctx.Err(); err != nil {
				return nil, 0, err
			}
			content, err := r.turnStore.readTurn(ctx, r.projectName, sessionID, turnIndex)
			if err != nil || len(content) == 0 {
				contents = append(contents, archiveGapTurnJSON())
				gapCount++
				continue
			}
			contents = append(contents, discardSessionTurnArtifactsForArchive(string(content)))
		}
		return contents, gapCount, nil
	}

	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	byIndex := map[int64]string{}
	for _, turn := range r.finishedTurns[sessionID] {
		if turn.TurnIndex > 0 && turn.TurnIndex <= latestTurnIndex && strings.TrimSpace(turn.Content) != "" {
			byIndex[turn.TurnIndex] = turn.Content
		}
	}
	for turnIndex := int64(1); turnIndex <= latestTurnIndex; turnIndex++ {
		content := byIndex[turnIndex]
		if strings.TrimSpace(content) == "" {
			contents = append(contents, archiveGapTurnJSON())
			gapCount++
			continue
		}
		contents = append(contents, discardSessionTurnArtifactsForArchive(content))
	}
	return contents, gapCount, nil
}

func discardSessionTurnArtifactsForArchive(content string) string {
	var msg acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(content), &msg); err != nil {
		return content
	}
	if strings.TrimSpace(msg.Method) != acp.SessionTurnMethodPromptDone || len(msg.Param) == 0 {
		return content
	}
	payload := map[string]json.RawMessage{}
	if err := json.Unmarshal(msg.Param, &payload); err != nil {
		return content
	}
	if _, ok := payload["artifacts"]; !ok {
		return content
	}
	delete(payload, "artifacts")
	return buildSessionTurnContentJSON(msg.Method, payload)
}

func (r *SessionRecorder) SetEventPublisher(publish func(method string, payload any) error) {
	r.mu.Lock()
	r.publish = publish
	r.mu.Unlock()
}

func (r *SessionRecorder) eventPublisher() func(method string, payload any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.publish
}

func (r *SessionRecorder) RecordEvent(ctx context.Context, event SessionViewEvent) error {
	if event.SessionID == "" {
		return nil
	}

	parsed, err := parseSessionViewEvent(event)
	if err != nil {
		return err
	}

	r.writeMu.Lock()
	defer r.writeMu.Unlock()

	if parsed.bMessage {
		return r.handleSessionTurnMessage(ctx, parsed)
	}

	switch parsed.acpMethod {
	case acp.MethodSessionNew:
		title := ""
		agentType := ""
		jsonDecodeAt(json.RawMessage(parsed.raw.Content), "params.title", &title)
		jsonDecodeAt(json.RawMessage(parsed.raw.Content), "params.agentType", &agentType)
		title = strings.TrimSpace(title)
		return r.upsertSessionProjection(ctx, parsed.raw.SessionID, normalizeAgentType(agentType), title, parsed.raw.UpdatedAt, false)
	case acp.MethodSessionUpdate:
		if parsed.sessionInfoUpdate {
			return r.handleSessionInfoUpdateLocked(ctx, parsed)
		}
		if parsed.usageUpdate {
			return r.handleSessionUsageUpdateLocked(ctx, parsed)
		}
		return nil
	default:
		return nil
	}
}

func (r *SessionRecorder) RecordPermissionRequest(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionRequest) (int64, error) {
	if r == nil {
		return 0, fmt.Errorf("session recorder is required")
	}
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(payload.PermissionID) == "" {
		return 0, fmt.Errorf("permission request identity is required")
	}
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	state, err := r.currentPromptStateLocked(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	if state == nil || sessionPromptStateTerminal(state) {
		return 0, fmt.Errorf("session %s has no active prompt", sessionID)
	}
	for _, existing := range state.turns {
		if request, ok := existing.payload.(acp.SessionTurnPermissionRequest); ok && request.PermissionID == payload.PermissionID {
			return 0, fmt.Errorf("permission request already exists: %s", payload.PermissionID)
		}
	}
	rec, err := r.loadSessionForSummaryLocked(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	turn := sessionTurnMessage{
		sessionID: sessionID,
		method:    acp.SessionTurnMethodPermissionRequest,
		payload:   payload,
		turnIndex: state.nextTurnIndex,
		finished:  true,
	}
	r.publishOpenTextTurnDone(state)
	state.updateTurn(turn, "")
	r.publishSessionTurn(turn, buildSessionTurnContentJSON(turn.method, turn.payload))
	r.publishSessionUpdated(r.sessionViewSummaryFromRecordLocked(*rec))
	return turn.turnIndex, nil
}

func (r *SessionRecorder) RecordPermissionResponse(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionResponse) (int64, error) {
	if r == nil {
		return 0, fmt.Errorf("session recorder is required")
	}
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(payload.PermissionID) == "" || payload.RequestTurnIndex <= 0 {
		return 0, fmt.Errorf("permission response identity is required")
	}
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	state, err := r.currentPromptStateLocked(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	if state == nil || sessionPromptStateTerminal(state) {
		return 0, fmt.Errorf("session %s has no active prompt", sessionID)
	}
	requestFound := false
	for _, existing := range state.turns {
		switch value := existing.payload.(type) {
		case acp.SessionTurnPermissionRequest:
			if existing.turnIndex == payload.RequestTurnIndex && value.PermissionID == payload.PermissionID {
				requestFound = true
			}
		case acp.SessionTurnPermissionResponse:
			if value.PermissionID == payload.PermissionID {
				return 0, fmt.Errorf("permission response already exists: %s", payload.PermissionID)
			}
		}
	}
	if !requestFound {
		return 0, fmt.Errorf("permission request not found: %s", payload.PermissionID)
	}
	rec, err := r.loadSessionForSummaryLocked(ctx, sessionID)
	if err != nil {
		return 0, err
	}
	turn := sessionTurnMessage{
		sessionID: sessionID,
		method:    acp.SessionTurnMethodPermissionResponse,
		payload:   payload,
		turnIndex: state.nextTurnIndex,
		finished:  true,
	}
	r.publishOpenTextTurnDone(state)
	state.updateTurn(turn, "")
	r.publishSessionTurn(turn, buildSessionTurnContentJSON(turn.method, turn.payload))
	r.publishSessionUpdated(r.sessionViewSummaryFromRecordLocked(*rec))
	return turn.turnIndex, nil
}

func (r *SessionRecorder) loadSessionForSummaryLocked(ctx context.Context, sessionID string) (*SessionRecord, error) {
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return nil, err
	}
	if rec == nil {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}
	return rec, nil
}

func (r *SessionRecorder) handleSessionInfoUpdateLocked(ctx context.Context, event parsedSessionViewEvent) error {
	title := strings.TrimSpace(event.sessionInfoTitle)
	if title == "" {
		return nil
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, event.raw.SessionID)
	if err != nil {
		return err
	}
	if rec == nil {
		return nil
	}
	rec.Title = updateSessionFirstTitleFacts(rec.Title, title)
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return err
	}
	r.publishSessionUpdated(r.sessionViewSummaryFromRecordLocked(*rec))
	return nil
}

func (r *SessionRecorder) handleSessionUsageUpdateLocked(ctx context.Context, event parsedSessionViewEvent) error {
	rec, err := r.store.LoadSession(ctx, r.projectName, event.raw.SessionID)
	if err != nil {
		return err
	}
	if rec == nil {
		return nil
	}
	r.publishSessionUpdated(r.sessionViewSummaryFromRecordLocked(*rec))
	return nil
}

func (r *SessionRecorder) handleSessionTurnMessage(ctx context.Context, event parsedSessionViewEvent) error {
	method := event.method
	if method == "" {
		return nil
	}

	switch method {
	case acp.SessionTurnMethodPromptRequest:
		if event.payload != nil {
			return r.handlePromptStartedLocked(ctx, event)
		}
		return nil
	case acp.SessionTurnMethodPromptDone:
		if event.payload != nil {
			return r.handlePromptFinishedLocked(ctx, event)
		}
		return nil

	case acp.SessionTurnMethodSystem, acp.SessionTurnMethodAgentThought, acp.SessionTurnMethodAgentMessage, acp.SessionUpdateUserMessageChunk, acp.SessionTurnMethodAgentPlan, acp.SessionTurnMethodToolCall:
		return r.handleUpdateMessageLocked(ctx, event)
	default:
		return nil
	}
}

func (e *parsedSessionViewEvent) setJSONMessage(method string, payload any, turnKey string) {
	e.bMessage = true
	e.method = method
	e.payload = payload
	e.turnKey = turnKey
}

func (r *SessionRecorder) ListSessionViews(ctx context.Context) ([]sessionViewSummary, error) {
	entries, err := r.listSessions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]sessionViewSummary, 0, len(entries))
	for _, entry := range entries {
		out = append(out, r.sessionViewSummaryFromRecord(entry))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out, nil
}

func (r *SessionRecorder) ReadSessionSummary(ctx context.Context, sessionID string) (sessionViewSummary, error) {
	sessionID = strings.TrimSpace(sessionID)
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if rec == nil {
		return sessionViewSummary{}, fmt.Errorf("session not found: %s", sessionID)
	}
	return r.sessionViewSummaryFromRecord(*rec), nil
}

func (r *SessionRecorder) ReadSessionTurns(ctx context.Context, sessionID string, afterTurnIndex int64) (int64, []sessionViewTurn, error) {
	sessionID = strings.TrimSpace(sessionID)
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return 0, nil, err
	}
	if rec == nil {
		return 0, nil, fmt.Errorf("session not found: %s", sessionID)
	}
	if afterTurnIndex < 0 {
		afterTurnIndex = 0
	}
	persistedLatest := sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON)
	turns := []sessionViewTurn{}
	if persistedLatest > afterTurnIndex {
		if r.turnStore != nil {
			readTurns, err := r.turnStore.ReadTurns(ctx, r.projectName, sessionID, afterTurnIndex, persistedLatest)
			if err != nil {
				return 0, nil, err
			}
			turns = append(turns, readTurns...)
		} else {
			r.writeMu.Lock()
			for _, turn := range r.finishedTurns[sessionID] {
				if turn.TurnIndex > afterTurnIndex && turn.TurnIndex <= persistedLatest {
					turns = append(turns, turn)
				}
			}
			r.writeMu.Unlock()
		}
	}
	latestTurnIndex := persistedLatest
	r.writeMu.Lock()
	if state := r.promptState[sessionID]; state != nil {
		for _, turn := range sortedSessionTurns(state.turns) {
			if turn.turnIndex > latestTurnIndex {
				latestTurnIndex = turn.turnIndex
			}
			if turn.turnIndex <= afterTurnIndex || turn.turnIndex <= persistedLatest {
				continue
			}
			turns = append(turns, sessionViewTurn{
				TurnIndex: turn.turnIndex,
				Content:   buildSessionTurnContentJSON(turn.method, turn.payload),
				Finished:  turn.finished,
			})
		}
	}
	r.writeMu.Unlock()
	sort.Slice(turns, func(i, j int) bool {
		return turns[i].TurnIndex < turns[j].TurnIndex
	})
	return latestTurnIndex, turns, nil
}

func (r *SessionRecorder) MarkSessionRead(ctx context.Context, sessionID string, lastReadTurnIndex int64) (sessionViewSummary, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionViewSummary{}, fmt.Errorf("sessionId is required")
	}
	if lastReadTurnIndex < 0 {
		lastReadTurnIndex = 0
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if rec == nil {
		return sessionViewSummary{}, fmt.Errorf("session not found: %s", sessionID)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	if projection.LastDoneTurnIndex > 0 && lastReadTurnIndex > projection.LastDoneTurnIndex {
		lastReadTurnIndex = projection.LastDoneTurnIndex
	}
	if lastReadTurnIndex > projection.LastReadTurnIndex {
		projection.LastReadTurnIndex = lastReadTurnIndex
		rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
		if err := r.store.SaveSession(ctx, rec); err != nil {
			return sessionViewSummary{}, err
		}
		summary := r.sessionViewSummaryFromRecord(*rec)
		r.publishSessionUpdated(summary)
		return summary, nil
	}
	return r.sessionViewSummaryFromRecord(*rec), nil
}

func (r *SessionRecorder) RenameSessionTitle(ctx context.Context, sessionID string, title string) (sessionViewSummary, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return sessionViewSummary{}, fmt.Errorf("sessionId is required")
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if rec == nil {
		return sessionViewSummary{}, fmt.Errorf("session not found: %s", sessionID)
	}
	rec.Title = updateSessionManualTitleFacts(rec.Title, title)
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return sessionViewSummary{}, err
	}
	summary := r.sessionViewSummaryFromRecord(*rec)
	r.publishSessionUpdated(summary)
	return summary, nil
}

func (r *SessionRecorder) handlePromptStartedLocked(ctx context.Context, event parsedSessionViewEvent) error {
	rawEvent := event.raw
	request, ok := event.payload.(acp.SessionTurnPromptRequest)
	if !ok {
		return fmt.Errorf("decode prompt request: unexpected payload type %T", event.payload)
	}

	state, err := r.nextPromptStateLocked(ctx, rawEvent.SessionID, rawEvent.UpdatedAt)
	if err != nil {
		return err
	}
	promptTitle := strings.TrimSpace(promptTitleFromBlocks(request.ContentBlocks))
	modelName := ""
	if r.modelLookup != nil {
		modelName = strings.TrimSpace(r.modelLookup(rawEvent.SessionID))
	}
	request.ModelName = modelName
	request.CreatedAt = rawEvent.UpdatedAt.UTC().Format(time.RFC3339Nano)
	event.payload = request
	if err := r.addMessageTurn(state, event); err != nil {
		return err
	}
	r.promptState[rawEvent.SessionID] = state
	if err := r.upsertSessionProjection(ctx, rawEvent.SessionID, "", promptTitle, rawEvent.UpdatedAt, false); err != nil {
		return err
	}
	return nil
}

func (r *SessionRecorder) handleUpdateMessageLocked(ctx context.Context, event parsedSessionViewEvent) error {
	state, err := r.currentPromptStateLocked(ctx, event.raw.SessionID)
	if err != nil {
		return err
	}
	if state == nil {
		return nil
	}
	return r.addMessageTurn(state, event)
}

func (r *SessionRecorder) addMessageTurn(state *sessionPromptState, event parsedSessionViewEvent) error {
	if state == nil {
		return fmt.Errorf("prompt state is required")
	}
	state.ensureMaps()

	turn := sessionTurnMessage{
		sessionID: event.raw.SessionID,
		method:    event.method,
		payload:   event.payload,
		finished:  !isSessionTextTurnMethod(event.method),
	}

	mergedTurnIndex := int64(0)
	switch event.method {
	case acp.SessionTurnMethodToolCall:
		if event.turnKey != "" {
			mergedTurnIndex = state.turnIndexByKey[event.turnKey]
		}
	case acp.SessionTurnMethodAgentPlan:
		for _, existing := range state.turns {
			if existing.method == event.method {
				mergedTurnIndex = existing.turnIndex
				break
			}
		}
	case acp.SessionTurnMethodAgentMessage, acp.SessionTurnMethodAgentThought:
		if len(state.turns) > 0 {
			if existing := state.turns[len(state.turns)-1]; existing.method == event.method {
				mergedTurnIndex = existing.turnIndex
			}
		}
	}
	if mergedTurnIndex > 0 {
		for _, existingTurn := range state.turns {
			if existingTurn.turnIndex == mergedTurnIndex {
				turn.turnIndex = mergedTurnIndex
				turn = mergeTurnMessage(existingTurn, turn, mergedTurnIndex)
				break
			}
		}
	}

	if turn.turnIndex <= 0 {
		r.publishOpenTextTurnDone(state)
		turn.turnIndex = state.nextTurnIndex
	}

	updateJSON := buildSessionTurnContentJSON(turn.method, turn.payload)
	r.publishLiveSessionTurn(turn, updateJSON)
	state.updateTurn(turn, event.turnKey)
	return nil
}

func (r *SessionRecorder) publishOpenTextTurnDone(state *sessionPromptState) {
	if state == nil || len(state.turns) == 0 {
		return
	}
	idx := len(state.turns) - 1
	turn := state.turns[idx]
	if turn.finished || !isSessionTextTurnMethod(turn.method) {
		return
	}
	turn.finished = true
	state.turns[idx] = turn
	r.publishSessionTurn(turn, buildSessionTurnContentJSON(turn.method, turn.payload))
	if turn.method == acp.SessionTurnMethodAgentThought {
		delete(r.thoughtPublish, turn.sessionID)
	}
}

func (r *SessionRecorder) handlePromptFinishedLocked(ctx context.Context, parsedEvent parsedSessionViewEvent) error {
	event := parsedEvent.raw
	result, ok := parsedEvent.payload.(acp.SessionTurnPromptResult)
	if !ok {
		return fmt.Errorf("decode prompt result: unexpected payload type %T", parsedEvent.payload)
	}
	stopReason := strings.TrimSpace(result.StopReason)

	alreadyFinished, err := r.latestPromptFinishedWithoutLiveStateLocked(ctx, event.SessionID)
	if err != nil {
		return err
	}
	if alreadyFinished {
		return nil
	}

	state, err := r.ensurePromptStateLocked(ctx, event.SessionID)
	if err != nil {
		return err
	}
	return r.finishPromptStateLocked(ctx, event.SessionID, state, stopReason, strings.TrimSpace(result.Message), parsedEvent.artifacts, event.UpdatedAt, true)
}

func (r *SessionRecorder) finishPromptStateLocked(ctx context.Context, sessionID string, state *sessionPromptState, stopReason string, message string, artifacts []acp.SessionPromptArtifactPayload, updatedAt time.Time, publishDone bool) error {
	if state == nil {
		return nil
	}
	stopReason = strings.TrimSpace(stopReason)
	message = strings.TrimSpace(message)
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	needsPromptDone := !sessionPromptStateTerminal(state)
	r.publishOpenTextTurnDone(state)

	artifactMetadata, err := r.writePromptArtifactsLocked(ctx, sessionID, artifacts)
	if err != nil {
		return err
	}

	var doneTurn sessionTurnMessage
	if needsPromptDone {
		doneTurn = sessionTurnMessage{
			sessionID: sessionID,
			method:    acp.SessionTurnMethodPromptDone,
			payload: acp.SessionTurnPromptResult{
				StopReason:  stopReason,
				CompletedAt: updatedAt.UTC().Format(time.RFC3339Nano),
				Message:     message,
				Artifacts:   artifactMetadata,
			},
			turnIndex: state.nextTurnIndex,
			finished:  true,
		}
		state.updateTurn(doneTurn, "")
	}

	if err := r.persistSessionStateTurnsLocked(ctx, sessionID, state, updatedAt); err != nil {
		return err
	}
	summary, err := r.upsertSessionProjectionWithPublish(ctx, sessionID, "", "", updatedAt, true, false)
	if err != nil {
		return err
	}
	if publishDone && needsPromptDone {
		r.publishSessionTurn(doneTurn, buildSessionTurnContentJSON(doneTurn.method, doneTurn.payload))
	}
	r.publishSessionUpdated(summary)
	r.nextTurnIndex[sessionID] = state.nextTurnIndex
	delete(r.promptState, sessionID)
	return nil
}

func (r *SessionRecorder) writePromptArtifactsLocked(ctx context.Context, sessionID string, artifacts []acp.SessionPromptArtifactPayload) ([]acp.SessionTurnPromptArtifact, error) {
	if len(artifacts) == 0 {
		return nil, nil
	}
	if r.artifactStore == nil {
		return nil, fmt.Errorf("session artifact store is required")
	}
	out := make([]acp.SessionTurnPromptArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if strings.TrimSpace(artifact.Type) != sessionArtifactTypeDiff || strings.TrimSpace(artifact.Format) != sessionArtifactFormatDiff || artifact.Content == "" {
			continue
		}
		meta, err := r.artifactStore.WriteDiffArtifact(ctx, r.projectName, sessionID, artifact.Content)
		if err != nil {
			return nil, err
		}
		out = append(out, meta)
	}
	return out, nil
}

func (r *SessionRecorder) latestPromptFinishedWithoutLiveStateLocked(ctx context.Context, sessionID string) (bool, error) {
	if state, ok := r.promptState[sessionID]; ok && state != nil {
		return false, nil
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return false, err
	}
	if rec == nil {
		return false, nil
	}
	return sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON) > 0, nil
}

func (r *SessionRecorder) publishSessionTurn(turn sessionTurnMessage, updateJSON string) {
	publish := r.eventPublisher()
	if publish == nil {
		return
	}
	_ = publish(acp.RegistryMethodSessionMessage, map[string]any{
		"sessionId": turn.sessionID,
		"turn": map[string]any{
			"turnIndex": turn.turnIndex,
			"content":   updateJSON,
			"finished":  turn.finished,
		},
	})
}

func (r *SessionRecorder) publishLiveSessionTurn(turn sessionTurnMessage, updateJSON string) {
	if turn.method != acp.SessionTurnMethodAgentThought || turn.finished {
		r.publishSessionTurn(turn, updateJSON)
		return
	}
	now := r.now().UTC()
	last, ok := r.thoughtPublish[turn.sessionID]
	if ok && last.turnIndex == turn.turnIndex && now.Sub(last.lastPublishedAt) < sessionThoughtPublishInterval {
		return
	}
	r.publishSessionTurn(turn, updateJSON)
	r.thoughtPublish[turn.sessionID] = sessionThoughtPublishState{
		turnIndex:       turn.turnIndex,
		lastPublishedAt: now,
	}
}

func (r *SessionRecorder) upsertSessionProjection(ctx context.Context, sessionID, agentType, title string, updatedAt time.Time, titleIfEmptyOnly bool) error {
	_, err := r.upsertSessionProjectionWithPublish(ctx, sessionID, agentType, title, updatedAt, titleIfEmptyOnly, true)
	return err
}

func (r *SessionRecorder) upsertSessionProjectionWithPublish(ctx context.Context, sessionID, agentType, title string, updatedAt time.Time, titleIfEmptyOnly bool, publish bool) (sessionViewSummary, error) {
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return sessionViewSummary{}, err
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	if rec == nil {
		agentType = normalizeAgentType(agentType)
		if agentType == "" {
			return sessionViewSummary{}, fmt.Errorf("session agent type is required")
		}
		rec = &SessionRecord{ID: sessionID, ProjectName: r.projectName, Status: SessionActive, AgentType: agentType, CreatedAt: updatedAt, LastActiveAt: updatedAt}
	} else if strings.TrimSpace(rec.AgentType) == "" && strings.TrimSpace(agentType) != "" {
		rec.AgentType = normalizeAgentType(agentType)
	}
	if strings.TrimSpace(rec.AgentType) == "" {
		return sessionViewSummary{}, fmt.Errorf("session agent type is required")
	}
	title = strings.TrimSpace(title)
	if title != "" {
		if !titleIfEmptyOnly || strings.TrimSpace(rec.Title) == "" {
			rec.Title = updateSessionTitleFacts(rec.Title, title)
		}
	}
	rec.LastActiveAt = updatedAt
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return sessionViewSummary{}, err
	}
	summary := r.sessionViewSummaryFromRecordLocked(*rec)
	if publish {
		r.publishSessionUpdated(summary)
	}
	return summary, nil
}

func (r *SessionRecorder) sessionViewSummaryFromRecord(rec SessionRecord) sessionViewSummary {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	return r.sessionViewSummaryFromRecordLocked(rec)
}

func (r *SessionRecorder) sessionViewSummaryFromRecordLocked(rec SessionRecord) sessionViewSummary {
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	latestTurnIndex := projection.LatestPersistedTurnIndex
	running := false
	if state := r.promptState[rec.ID]; state != nil {
		for _, turn := range state.turns {
			if turn.turnIndex > latestTurnIndex {
				latestTurnIndex = turn.turnIndex
			}
		}
		running = !sessionPromptStateTerminal(state)
	}
	if len(r.activeOperations[rec.ID]) > 0 {
		running = true
	}
	for _, turn := range r.finishedTurns[rec.ID] {
		if turn.TurnIndex > latestTurnIndex {
			latestTurnIndex = turn.TurnIndex
		}
	}
	summary := buildSessionViewSummary(
		rec.ID,
		rec.Title,
		rec.LastActiveAt,
		rec.AgentType,
		latestTurnIndex,
		running,
		projection.LastDoneTurnIndex,
		projection.LastDoneSuccess != nil && *projection.LastDoneSuccess,
		projection.LastReadTurnIndex,
	)
	var agentState SessionAgentState
	if strings.TrimSpace(rec.AgentJSON) != "" && json.Unmarshal([]byte(rec.AgentJSON), &agentState) == nil {
		summary.CreateRequestID = agentState.CreateRequestID
		if agentState.Usage != nil {
			usage := *agentState.Usage
			summary.Usage = &usage
		}
	}
	if r.actionLookup != nil {
		summary.SessionActions = r.actionLookup(summary.AgentType)
	}
	summary.PendingPermissionCount = pendingPermissionCountFromPromptState(r.promptState[rec.ID])
	return summary
}

func pendingPermissionCountFromPromptState(state *sessionPromptState) int {
	if state == nil || sessionPromptStateTerminal(state) {
		return 0
	}
	pending := map[string]struct{}{}
	for _, turn := range sortedSessionTurns(state.turns) {
		switch value := turn.payload.(type) {
		case acp.SessionTurnPermissionRequest:
			if value.PermissionID != "" {
				pending[value.PermissionID] = struct{}{}
			}
		case acp.SessionTurnPermissionResponse:
			delete(pending, value.PermissionID)
		}
	}
	return len(pending)
}

func (r *SessionRecorder) publishSessionUpdated(summary sessionViewSummary) {
	publish := r.eventPublisher()
	if publish == nil {
		return
	}
	_ = publish(acp.RegistryMethodSessionUpdated, map[string]any{"session": summary})
}

func buildSessionViewSummary(
	sessionID, title string,
	lastActiveAt time.Time,
	agentType string,
	latestTurnIndex int64,
	running bool,
	lastDoneTurnIndex int64,
	lastDoneSuccess bool,
	lastReadTurnIndex int64,
) sessionViewSummary {
	return sessionViewSummary{
		SessionID:         strings.TrimSpace(sessionID),
		Title:             strings.TrimSpace(title),
		UpdatedAt:         lastActiveAt.UTC().Format(time.RFC3339),
		AgentType:         normalizeAgentType(agentType),
		LatestTurnIndex:   maxInt64(0, latestTurnIndex),
		Running:           running,
		LastDoneTurnIndex: maxInt64(0, lastDoneTurnIndex),
		LastDoneSuccess:   lastDoneSuccess,
		LastReadTurnIndex: maxInt64(0, lastReadTurnIndex),
	}
}

func (r *SessionRecorder) persistSessionStateTurnsLocked(ctx context.Context, sessionID string, state *sessionPromptState, updatedAt time.Time) error {
	if state == nil || len(state.turns) == 0 {
		return nil
	}
	rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
	if err != nil {
		return err
	}
	if rec == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	persistedLatest := sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON)
	ordered := sortedSessionTurns(state.turns)
	contents := make([]string, 0, len(ordered))
	startTurnIndex := int64(0)
	latestTurnIndex := persistedLatest
	lastDoneTurnIndex := int64(0)
	lastDoneSuccess := false
	for _, turn := range ordered {
		if turn.turnIndex <= persistedLatest {
			continue
		}
		if startTurnIndex == 0 {
			startTurnIndex = turn.turnIndex
		}
		contents = append(contents, buildSessionTurnContentJSON(turn.method, turn.payload))
		latestTurnIndex = turn.turnIndex
		if turn.method == acp.SessionTurnMethodPromptDone {
			lastDoneTurnIndex = turn.turnIndex
			lastDoneSuccess = sessionDoneTurnSuccess(turn)
		}
	}
	if len(contents) == 0 {
		return nil
	}
	if startTurnIndex != persistedLatest+1 {
		return fmt.Errorf("session %s turn persistence gap: start=%d latest=%d", sessionID, startTurnIndex, persistedLatest)
	}
	if r.turnStore != nil {
		latest, err := r.turnStore.WriteTurns(ctx, r.projectName, sessionID, startTurnIndex, contents)
		if err != nil {
			return err
		}
		latestTurnIndex = latest
	} else {
		for i, content := range contents {
			r.finishedTurns[sessionID] = append(r.finishedTurns[sessionID], sessionViewTurn{
				TurnIndex: startTurnIndex + int64(i),
				Content:   normalizeJSONDoc(content, "{}"),
				Finished:  true,
			})
		}
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	projection.LatestPersistedTurnIndex = latestTurnIndex
	if lastDoneTurnIndex > 0 {
		projection.LastDoneTurnIndex = lastDoneTurnIndex
		projection.LastDoneSuccess = boolPtr(lastDoneSuccess)
	}
	rec.SessionSyncJSON = sessionSyncProjectionJSON(projection)
	rec.LastActiveAt = updatedAt
	if err := r.store.SaveSession(ctx, rec); err != nil {
		return err
	}
	return nil
}

func sessionSyncLatestPersistedTurnIndex(raw string) int64 {
	return sessionSyncProjectionFromJSON(raw).LatestPersistedTurnIndex
}

func sessionSyncJSON(latestPersistedTurnIndex int64) string {
	if latestPersistedTurnIndex < 0 {
		latestPersistedTurnIndex = 0
	}
	raw, err := json.Marshal(sessionSyncProjection{LatestPersistedTurnIndex: latestPersistedTurnIndex})
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func updateSessionTitleFacts(rawTitle, promptTitle string) string {
	promptTitle = strings.TrimSpace(promptTitle)
	if promptTitle == "" {
		return strings.TrimSpace(rawTitle)
	}
	facts, ok := sessionTitleFactsFromJSON(rawTitle)
	if !ok {
		legacyTitle := strings.TrimSpace(rawTitle)
		facts = sessionTitleFacts{
			First: legacyTitle,
			Last:  legacyTitle,
		}
	}
	if strings.TrimSpace(facts.First) == "" {
		facts.First = promptTitle
	}
	facts.Last = promptTitle
	return sessionTitleFactsJSON(facts)
}

func updateSessionFirstTitleFacts(rawTitle, firstTitle string) string {
	firstTitle = strings.TrimSpace(firstTitle)
	if firstTitle == "" {
		return strings.TrimSpace(rawTitle)
	}
	facts, ok := sessionTitleFactsFromJSON(rawTitle)
	if !ok {
		legacyTitle := strings.TrimSpace(rawTitle)
		facts = sessionTitleFacts{
			First: legacyTitle,
			Last:  legacyTitle,
		}
	}
	facts.First = firstTitle
	return sessionTitleFactsJSON(facts)
}

func updateSessionManualTitleFacts(rawTitle, manualTitle string) string {
	facts, ok := sessionTitleFactsFromJSON(rawTitle)
	if !ok {
		legacyTitle := strings.TrimSpace(rawTitle)
		facts = sessionTitleFacts{
			First: legacyTitle,
			Last:  legacyTitle,
		}
	}
	facts.Manual = normalizeManualSessionTitle(manualTitle)
	return sessionTitleFactsJSON(facts)
}

func normalizeManualSessionTitle(title string) string {
	title = strings.NewReplacer("\r\n", " ", "\r", " ", "\n", " ").Replace(title)
	title = strings.TrimSpace(title)
	runes := []rune(title)
	if len(runes) > 200 {
		title = string(runes[:200])
	}
	return title
}

func sessionTitleFactsFromJSON(rawTitle string) (sessionTitleFacts, bool) {
	rawTitle = strings.TrimSpace(rawTitle)
	if rawTitle == "" || !strings.HasPrefix(rawTitle, "{") {
		return sessionTitleFacts{}, false
	}
	var facts sessionTitleFacts
	if err := json.Unmarshal([]byte(rawTitle), &facts); err != nil {
		return sessionTitleFacts{}, false
	}
	facts.First = strings.TrimSpace(facts.First)
	facts.Last = strings.TrimSpace(facts.Last)
	facts.Manual = normalizeManualSessionTitle(facts.Manual)
	return facts, true
}

func sessionTitleFactsJSON(facts sessionTitleFacts) string {
	facts.First = strings.TrimSpace(facts.First)
	facts.Last = strings.TrimSpace(facts.Last)
	facts.Manual = normalizeManualSessionTitle(facts.Manual)
	raw, err := json.Marshal(facts)
	if err != nil {
		return ""
	}
	return string(raw)
}

func sessionSyncProjectionFromJSON(raw string) sessionSyncProjection {
	var sync sessionSyncProjection
	if err := json.Unmarshal([]byte(firstNonEmpty(strings.TrimSpace(raw), "{}")), &sync); err != nil {
		return sessionSyncProjection{}
	}
	return normalizeSessionSyncProjection(sync)
}

func normalizeSessionSyncProjection(sync sessionSyncProjection) sessionSyncProjection {
	if sync.LatestPersistedTurnIndex < 0 {
		sync.LatestPersistedTurnIndex = 0
	}
	if sync.LastDoneTurnIndex < 0 {
		sync.LastDoneTurnIndex = 0
	}
	if sync.LastReadTurnIndex < 0 {
		sync.LastReadTurnIndex = 0
	}
	return sync
}

func sessionSyncProjectionJSON(sync sessionSyncProjection) string {
	sync = normalizeSessionSyncProjection(sync)
	raw, err := json.Marshal(sync)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func sessionDoneTurnSuccess(turn sessionTurnMessage) bool {
	result, ok := turn.payload.(acp.SessionTurnPromptResult)
	if !ok {
		return true
	}
	return strings.TrimSpace(result.StopReason) != acp.StopReasonFailed
}

func boolPtr(value bool) *bool {
	return &value
}

func sortedSessionTurns(turns []sessionTurnMessage) []sessionTurnMessage {
	out := append([]sessionTurnMessage(nil), turns...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].turnIndex < out[j].turnIndex
	})
	return out
}

func newSessionPromptState(nextTurnIndex int64) sessionPromptState {
	if nextTurnIndex <= 0 {
		nextTurnIndex = 1
	}
	return sessionPromptState{
		nextTurnIndex:  nextTurnIndex,
		turns:          make([]sessionTurnMessage, 0),
		turnIndexByKey: map[string]int64{},
	}
}

func (s *sessionPromptState) ensureMaps() {
	if s.turns == nil {
		s.turns = make([]sessionTurnMessage, 0)
	}
	if s.turnIndexByKey == nil {
		s.turnIndexByKey = map[string]int64{}
	}
	if s.nextTurnIndex <= 0 {
		s.nextTurnIndex = 1
	}
}

func (s *sessionPromptState) updateTurn(turn sessionTurnMessage, turnKey string) {
	s.ensureMaps()
	if turn.turnIndex <= 0 {
		turn.turnIndex = s.nextTurnIndex
	}
	replaced := false
	for i := range s.turns {
		if s.turns[i].turnIndex == turn.turnIndex {
			s.turns[i] = turn
			replaced = true
			break
		}
	}
	if !replaced {
		s.turns = append(s.turns, turn)
	}
	s.nextTurnIndex = maxInt64(s.nextTurnIndex, turn.turnIndex+1)
	if turnKey != "" {
		s.turnIndexByKey[turnKey] = turn.turnIndex
	}
}

func (r *SessionRecorder) nextPromptStateLocked(ctx context.Context, sessionID string, updatedAt time.Time) (*sessionPromptState, error) {
	state, err := r.currentPromptStateLocked(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if state == nil {
		nextTurnIndex, err := r.nextSessionTurnIndexLocked(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		created := newSessionPromptState(nextTurnIndex)
		return &created, nil
	}
	if len(state.turns) == 0 {
		nextTurnIndex, err := r.nextSessionTurnIndexLocked(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		created := newSessionPromptState(nextTurnIndex)
		return &created, nil
	}
	if len(state.turns) > 0 && !sessionPromptStateTerminal(state) {
		if err := r.finishPromptStateLocked(ctx, sessionID, state, "interrupted", "", nil, updatedAt, true); err != nil {
			return nil, err
		}
	}
	nextTurnIndex, err := r.nextSessionTurnIndexLocked(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	next := newSessionPromptState(maxInt64(state.nextTurnIndex, nextTurnIndex))
	return &next, nil
}

func sessionPromptStateTerminal(state *sessionPromptState) bool {
	if state == nil || len(state.turns) == 0 {
		return false
	}
	return strings.TrimSpace(state.turns[len(state.turns)-1].method) == acp.SessionTurnMethodPromptDone
}

func (r *SessionRecorder) ensurePromptStateLocked(ctx context.Context, sessionID string) (*sessionPromptState, error) {
	state, err := r.currentPromptStateLocked(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if state != nil {
		return state, nil
	}
	nextTurnIndex, err := r.nextSessionTurnIndexLocked(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	created := newSessionPromptState(nextTurnIndex)
	r.promptState[sessionID] = &created
	return &created, nil
}

func (r *SessionRecorder) nextSessionTurnIndexLocked(ctx context.Context, sessionID string) (int64, error) {
	next := r.nextTurnIndex[sessionID]
	if next <= 0 {
		rec, err := r.store.LoadSession(ctx, r.projectName, sessionID)
		if err != nil {
			return 0, err
		}
		if rec != nil {
			next = sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON) + 1
		}
	}
	if next <= 0 {
		next = 1
	}
	return next, nil
}

func (r *SessionRecorder) currentPromptStateLocked(ctx context.Context, sessionID string) (*sessionPromptState, error) {
	return r.cachedPromptStateLocked(ctx, sessionID)
}

func (r *SessionRecorder) cachedPromptStateLocked(ctx context.Context, sessionID string) (*sessionPromptState, error) {
	state, ok := r.promptState[sessionID]
	if !ok || state == nil {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state.ensureMaps()
	return state, nil
}

func jsonGet(raw json.RawMessage, key string) (json.RawMessage, bool) {
	raw = json.RawMessage(bytes.TrimSpace(raw))
	key = strings.TrimSpace(key)
	if len(raw) == 0 || key == "" {
		return nil, false
	}
	obj := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, false
	}
	value, ok := obj[key]
	if !ok {
		return nil, false
	}
	value = json.RawMessage(bytes.TrimSpace(value))
	if len(value) == 0 {
		return nil, false
	}
	return value, true
}

func jsonDecodeAt(raw json.RawMessage, path string, out any) bool {
	if out == nil {
		return false
	}
	path = strings.TrimSpace(path)
	if path == "" {
		raw = json.RawMessage(bytes.TrimSpace(raw))
		if len(raw) == 0 {
			return false
		}
		return json.Unmarshal(raw, out) == nil
	}
	key, child, hasChild := strings.Cut(path, ".")
	if hasChild && strings.Contains(child, ".") {
		return false
	}
	value, ok := jsonGet(raw, key)
	if !ok {
		return false
	}
	if hasChild {
		value, ok = jsonGet(value, child)
		if !ok {
			return false
		}
	}
	if err := json.Unmarshal(value, out); err != nil {
		return false
	}
	return true
}

func extractUpdateText(raw json.RawMessage) string {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	block := struct {
		Text string `json:"text,omitempty"`
	}{}
	if err := json.Unmarshal(raw, &block); err == nil {
		return block.Text
	}
	return ""
}

func parseSessionViewEvent(event SessionViewEvent) (parsedSessionViewEvent, error) {
	parsed := parsedSessionViewEvent{
		raw:       event,
		artifacts: cloneSessionPromptArtifactPayloads(event.Artifacts),
	}
	parsed.raw.SessionID = strings.TrimSpace(parsed.raw.SessionID)
	parsed.raw.Content = strings.TrimSpace(parsed.raw.Content)
	if parsed.raw.SessionID == "" {
		return parsed, nil
	}
	if parsed.raw.UpdatedAt.IsZero() {
		parsed.raw.UpdatedAt = time.Now().UTC()
	}

	eventType := strings.TrimSpace(string(parsed.raw.Type))
	if strings.EqualFold(eventType, string(SessionViewEventTypeACP)) {
		contentRaw := json.RawMessage(parsed.raw.Content)
		jsonDecodeAt(contentRaw, "method", &parsed.acpMethod)
		parsed.acpMethod = strings.TrimSpace(parsed.acpMethod)
		if parsed.acpMethod == "" {
			return parsedSessionViewEvent{}, fmt.Errorf("decode acp event content: %w", fmt.Errorf("session event method is required"))
		}
		switch parsed.acpMethod {
		case acp.MethodSessionNew:
			return parsed, nil
		case acp.MethodSessionPrompt:
			promptResult := acp.SessionPromptResult{}
			ok := jsonDecodeAt(contentRaw, "result", &promptResult)
			if ok {
				parsed.setJSONMessage(acp.SessionTurnMethodPromptDone, acp.SessionTurnPromptResult{
					StopReason: strings.TrimSpace(promptResult.StopReason),
					Message:    strings.TrimSpace(promptResult.Message),
				}, "")
				return parsed, nil
			}
			params := acp.SessionPromptParams{}
			jsonDecodeAt(contentRaw, "params", &params)
			parsed.setJSONMessage(acp.SessionTurnMethodPromptRequest, acp.SessionTurnPromptRequest{ContentBlocks: cloneJSON(params.Prompt)}, "")
		case acp.MethodSessionUpdate:
			params := acp.SessionUpdateParams{}
			jsonDecodeAt(contentRaw, "params", &params)
			method := strings.TrimSpace(params.Update.SessionUpdate)
			if method == "" {
				return parsed, nil
			}
			switch method {
			case acp.SessionUpdateAgentMessageChunk, acp.SessionUpdateAgentThoughtChunk, acp.SessionUpdateUserMessageChunk:
				text := extractUpdateText(params.Update.Content)
				if method == acp.SessionUpdateAgentThoughtChunk && strings.TrimSpace(text) == "" {
					return parsed, nil
				}
				parsed.setJSONMessage(method, acp.SessionTurnTextResult{Text: text}, "")
			case acp.SessionUpdateToolCall, acp.SessionUpdateToolCallUpdate:
				parsed.setJSONMessage(acp.SessionTurnMethodToolCall, acp.SessionTurnToolResult{
					Cmd:    strings.TrimSpace(params.Update.Title),
					Kind:   strings.TrimSpace(params.Update.Kind),
					Status: strings.TrimSpace(params.Update.Status),
				}, strings.TrimSpace(params.Update.ToolCallID))
			case acp.SessionUpdatePlan:
				entries := make([]acp.SessionTurnPlanResult, 0, len(params.Update.Entries))
				for _, entry := range params.Update.Entries {
					entries = append(entries, acp.SessionTurnPlanResult{Content: strings.TrimSpace(entry.Content), Status: strings.TrimSpace(entry.Status)})
				}
				parsed.setJSONMessage(acp.SessionTurnMethodAgentPlan, acp.SessionTurnPlanPayload{Entries: entries}, "")
			case acp.SessionUpdateSessionInfoUpdate:
				parsed.sessionInfoUpdate = true
				parsed.sessionInfoTitle = strings.TrimSpace(params.Update.Title)
			case acp.SessionUpdateUsageUpdate:
				parsed.usageUpdate = true
			default:
				return parsedSessionViewEvent{}, fmt.Errorf("unsupported session update type: %s", method)
			}
		default:
		}
	} else if strings.EqualFold(eventType, string(SessionViewEventTypeSystem)) {
		text := strings.TrimSpace(parsed.raw.Content)
		if text == "" {
			return parsed, nil
		}
		parsed.setJSONMessage(acp.SessionTurnMethodSystem, acp.SessionTurnTextResult{Text: text}, "")
	}

	return parsed, nil
}

func cloneSessionPromptArtifactPayloads(in []acp.SessionPromptArtifactPayload) []acp.SessionPromptArtifactPayload {
	if len(in) == 0 {
		return nil
	}
	out := make([]acp.SessionPromptArtifactPayload, len(in))
	copy(out, in)
	return out
}

func mergeTurnMessage(existing, incoming sessionTurnMessage, turnIndex int64) sessionTurnMessage {
	existing.sessionID = firstNonEmpty(existing.sessionID, incoming.sessionID)
	existing.method = firstNonEmpty(incoming.method, existing.method)
	existing.turnIndex = maxInt64(turnIndex, existing.turnIndex)
	switch incoming.method {
	case acp.SessionTurnMethodToolCall:
		base := existing.payload.(acp.SessionTurnToolResult)
		inc := incoming.payload.(acp.SessionTurnToolResult)
		if inc.Cmd == "" {
			inc.Cmd = base.Cmd
		}
		if inc.Kind == "" {
			inc.Kind = base.Kind
		}
		if inc.Status == "" {
			inc.Status = base.Status
		}
		existing.payload = inc
	case acp.SessionTurnMethodAgentMessage, acp.SessionTurnMethodAgentThought:
		base := existing.payload.(acp.SessionTurnTextResult)
		inc := incoming.payload.(acp.SessionTurnTextResult)
		inc.Text = base.Text + inc.Text
		if inc.Text == "" {
			inc.Text = base.Text
		}
		existing.payload = inc
	default:
		existing.payload = incoming.payload
	}
	return existing
}

func isSessionTextTurnMethod(method string) bool {
	switch strings.TrimSpace(method) {
	case acp.SessionTurnMethodAgentMessage, acp.SessionTurnMethodAgentThought:
		return true
	default:
		return false
	}
}

func buildSessionTurnContentJSON(method string, payload any) string {
	message := acp.SessionTurnMessage{Method: method}
	if payload != nil {
		message.Param = mustJSONRaw(payload)
	}
	raw, _ := json.Marshal(message)
	return string(raw)
}

func mustJSONRaw(value any) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Errorf("marshal message payload: %w", err))
	}
	return json.RawMessage(raw)
}
