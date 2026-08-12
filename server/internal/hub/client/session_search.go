package client

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	sessionSearchIdleTTL      = 10 * time.Minute
	sessionSearchMaxTasks     = 8
	sessionSearchMaxQuerySize = 200
	sessionSearchIdleForCap   = 30 * time.Second
	sessionSearchWorkerLimit  = 4
)

type sessionSearchRequest struct {
	Action   string `json:"action"`
	SearchID string `json:"searchId"`
	Query    string `json:"query,omitempty"`
}

type sessionSearchResponse struct {
	SearchID string                `json:"searchId"`
	Done     bool                  `json:"done"`
	Results  []sessionSearchResult `json:"results,omitempty"`
	Errors   []sessionSearchError  `json:"errors,omitempty"`
}

type sessionSearchResult struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId"`
	Source    string `json:"source"`
	TurnIndex int64  `json:"turnIndex,omitempty"`
}

type sessionSearchError struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId,omitempty"`
	Message   string `json:"message"`
}

type sessionSearchSnapshot struct {
	SessionID       string
	Title           string
	LatestTurnIndex int64
}

type sessionSearchTask struct {
	searchID    string
	projectID   string
	query       string
	queryFold   string
	sessions    []sessionSearchSnapshot
	ctx         context.Context
	cancel      context.CancelFunc
	results     []sessionSearchResult
	resultIDs   map[string]struct{}
	errors      []sessionSearchError
	done        bool
	lastTouched time.Time
	startedAt   time.Time
}

type sessionSearchManager struct {
	client *Client
	now    func() time.Time

	mu    sync.Mutex
	tasks map[string]*sessionSearchTask
}

func newSessionSearchManager(client *Client) *sessionSearchManager {
	return &sessionSearchManager{
		client: client,
		now: func() time.Time {
			return time.Now().UTC()
		},
		tasks: map[string]*sessionSearchTask{},
	}
}

func (m *sessionSearchManager) Close() {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, task := range m.tasks {
		task.cancel()
		delete(m.tasks, id)
	}
}

func (m *sessionSearchManager) Handle(ctx context.Context, projectID string, payload json.RawMessage) (sessionSearchResponse, error) {
	var req sessionSearchRequest
	if err := decodeSessionRequestPayload(payload, &req); err != nil {
		return sessionSearchResponse{}, fmt.Errorf("invalid session.search payload: %w", err)
	}
	req.Action = strings.TrimSpace(req.Action)
	req.SearchID = strings.TrimSpace(req.SearchID)
	if req.SearchID == "" {
		return sessionSearchResponse{}, fmt.Errorf("searchId is required")
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" && m != nil && m.client != nil {
		projectID = m.client.projectName
	}

	switch req.Action {
	case "start":
		return m.start(ctx, projectID, req.SearchID, req.Query)
	case "query":
		return m.query(req.SearchID)
	case "cancel":
		return m.cancel(req.SearchID), nil
	default:
		return sessionSearchResponse{}, fmt.Errorf("unsupported session.search action: %s", req.Action)
	}
}

func (m *sessionSearchManager) start(ctx context.Context, projectID, searchID, query string) (sessionSearchResponse, error) {
	if m == nil || m.client == nil || m.client.sessionRecorder == nil {
		return sessionSearchResponse{}, fmt.Errorf("session search manager is required")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return sessionSearchResponse{}, fmt.Errorf("query is required")
	}
	if len([]rune(query)) > sessionSearchMaxQuerySize {
		return sessionSearchResponse{}, fmt.Errorf("query is too long")
	}
	sessions, err := m.client.sessionRecorder.ListSessionViews(ctx)
	if err != nil {
		return sessionSearchResponse{}, err
	}
	snapshot := make([]sessionSearchSnapshot, 0, len(sessions))
	for _, session := range sessions {
		sessionID := strings.TrimSpace(session.SessionID)
		if sessionID == "" {
			continue
		}
		snapshot = append(snapshot, sessionSearchSnapshot{
			SessionID:       sessionID,
			Title:           session.Title,
			LatestTurnIndex: session.LatestTurnIndex,
		})
	}

	taskCtx, cancel := context.WithCancel(context.Background())
	now := m.now()
	task := &sessionSearchTask{
		searchID:    searchID,
		projectID:   projectID,
		query:       query,
		queryFold:   strings.ToLower(query),
		sessions:    snapshot,
		ctx:         taskCtx,
		cancel:      cancel,
		results:     []sessionSearchResult{},
		resultIDs:   map[string]struct{}{},
		errors:      []sessionSearchError{},
		lastTouched: now,
		startedAt:   now,
	}

	m.mu.Lock()
	m.cleanupLocked(now)
	if existing := m.tasks[searchID]; existing != nil {
		existing.cancel()
		delete(m.tasks, searchID)
	}
	if err := m.ensureTaskCapacityLocked(now); err != nil {
		m.mu.Unlock()
		cancel()
		return sessionSearchResponse{}, err
	}
	m.tasks[searchID] = task
	m.mu.Unlock()

	go m.run(task)
	return sessionSearchResponse{SearchID: searchID, Done: false}, nil
}

func (m *sessionSearchManager) query(searchID string) (sessionSearchResponse, error) {
	if m == nil {
		return sessionSearchResponse{}, fmt.Errorf("session search manager is required")
	}
	now := m.now()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked(now)
	task := m.tasks[searchID]
	if task == nil {
		return sessionSearchResponse{}, fmt.Errorf("session search not found or expired: %s", searchID)
	}
	task.lastTouched = now
	return sessionSearchResponse{
		SearchID: task.searchID,
		Done:     task.done,
		Results:  append([]sessionSearchResult(nil), task.results...),
		Errors:   append([]sessionSearchError(nil), task.errors...),
	}, nil
}

func (m *sessionSearchManager) cancel(searchID string) sessionSearchResponse {
	if m == nil {
		return sessionSearchResponse{SearchID: searchID, Done: true}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if task := m.tasks[searchID]; task != nil {
		task.cancel()
		delete(m.tasks, searchID)
	}
	return sessionSearchResponse{SearchID: searchID, Done: true}
}

func (m *sessionSearchManager) run(task *sessionSearchTask) {
	defer m.markDone(task)
	runSessionSearchWorkers(task.ctx, task.sessions, sessionSearchWorkerLimit, func(ctx context.Context, session sessionSearchSnapshot) {
		result, matched, err := searchSessionSnapshot(
			ctx,
			task.projectID,
			session,
			task.queryFold,
			m.searchPromptTurns,
		)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			m.appendError(task, sessionSearchError{
				ProjectID: task.projectID,
				SessionID: session.SessionID,
				Message:   err.Error(),
			})
			return
		}
		if matched {
			m.appendResult(task, result)
		}
	})
}

func runSessionSearchWorkers(
	ctx context.Context,
	sessions []sessionSearchSnapshot,
	workerLimit int,
	search func(context.Context, sessionSearchSnapshot),
) {
	if len(sessions) == 0 || workerLimit <= 0 || search == nil || ctx.Err() != nil {
		return
	}
	if workerLimit > len(sessions) {
		workerLimit = len(sessions)
	}
	jobs := make(chan sessionSearchSnapshot)
	var workers sync.WaitGroup
	workers.Add(workerLimit)
	for index := 0; index < workerLimit; index++ {
		go func() {
			defer workers.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case session, ok := <-jobs:
					if !ok || ctx.Err() != nil {
						return
					}
					search(ctx, session)
				}
			}
		}()
	}

	for _, session := range sessions {
		select {
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return
		case jobs <- session:
		}
	}
	close(jobs)
	workers.Wait()
}

func searchSessionSnapshot(
	ctx context.Context,
	projectID string,
	session sessionSearchSnapshot,
	queryFold string,
	searchTurns func(context.Context, string, int64, string) (int64, bool, error),
) (sessionSearchResult, bool, error) {
	if err := ctx.Err(); err != nil {
		return sessionSearchResult{}, false, err
	}
	if sessionSearchContains(resolveSessionSearchTitle(session.Title), queryFold) {
		return sessionSearchResult{
			ProjectID: projectID,
			SessionID: session.SessionID,
			Source:    "title",
		}, true, nil
	}
	turnIndex, matched, err := searchTurns(ctx, session.SessionID, session.LatestTurnIndex, queryFold)
	if err != nil || !matched {
		return sessionSearchResult{}, false, err
	}
	return sessionSearchResult{
		ProjectID: projectID,
		SessionID: session.SessionID,
		Source:    "prompt",
		TurnIndex: turnIndex,
	}, true, nil
}

func (m *sessionSearchManager) searchPromptTurns(ctx context.Context, sessionID string, latestTurnIndex int64, queryFold string) (int64, bool, error) {
	if m == nil || m.client == nil || m.client.sessionRecorder == nil {
		return 0, false, fmt.Errorf("session recorder is required")
	}
	recorder := m.client.sessionRecorder
	if recorder.store == nil {
		return 0, false, fmt.Errorf("session store is required")
	}
	rec, err := recorder.store.LoadSession(ctx, recorder.projectName, sessionID)
	if err != nil {
		return 0, false, err
	}
	if rec == nil {
		return 0, false, fmt.Errorf("session not found: %s", sessionID)
	}
	persistedLatest := sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON)

	// A running prompt is kept in memory until prompt_done. Search the live
	// turns first, then read only the persisted range. The summary snapshot can
	// include those live turns, but the turn files cannot, so passing the full
	// latest index to scanTurnsNewestFirst would report a false missing-file
	// error for every still-running session.
	recorder.writeMu.Lock()
	liveTurns := []sessionViewTurn{}
	if state := recorder.promptState[sessionID]; state != nil {
		for _, turn := range sortedSessionTurns(state.turns) {
			if turn.turnIndex <= persistedLatest || (latestTurnIndex > 0 && turn.turnIndex > latestTurnIndex) {
				continue
			}
			liveTurns = append(liveTurns, sessionViewTurn{
				TurnIndex: turn.turnIndex,
				Content:   buildSessionTurnContentJSON(turn.method, turn.payload),
				Finished:  turn.finished,
			})
		}
	}
	recorder.writeMu.Unlock()
	for index := len(liveTurns) - 1; index >= 0; index-- {
		if err := ctx.Err(); err != nil {
			return 0, false, err
		}
		turn := liveTurns[index]
		if sessionSearchContains(sessionSearchTurnVisibleText(turn.Content), queryFold) {
			return turn.TurnIndex, true, nil
		}
	}

	if recorder.turnStore != nil {
		persistedSearchLatest := persistedLatest
		if latestTurnIndex > 0 && latestTurnIndex < persistedSearchLatest {
			persistedSearchLatest = latestTurnIndex
		}
		var matchedTurn int64
		err := recorder.turnStore.scanTurnsNewestFirst(ctx, recorder.projectName, sessionID, persistedSearchLatest, func(turn sessionViewTurn) (bool, error) {
			if sessionSearchContains(sessionSearchTurnVisibleText(turn.Content), queryFold) {
				matchedTurn = turn.TurnIndex
				return true, nil
			}
			return false, nil
		})
		if err != nil {
			return 0, false, err
		}
		return matchedTurn, matchedTurn > 0, nil
	}

	_, turns, err := recorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		return 0, false, err
	}
	for index := len(turns) - 1; index >= 0; index-- {
		turn := turns[index]
		if latestTurnIndex > 0 && turn.TurnIndex > latestTurnIndex {
			continue
		}
		if sessionSearchContains(sessionSearchTurnVisibleText(turn.Content), queryFold) {
			return turn.TurnIndex, true, nil
		}
	}
	return 0, false, nil
}

func (m *sessionSearchManager) appendResult(task *sessionSearchTask, result sessionSearchResult) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.tasks[task.searchID]
	if current != task {
		return
	}
	if current.resultIDs == nil {
		current.resultIDs = map[string]struct{}{}
	}
	if _, exists := current.resultIDs[result.SessionID]; exists {
		return
	}
	current.resultIDs[result.SessionID] = struct{}{}
	current.results = append(current.results, result)
}

func (m *sessionSearchManager) appendError(task *sessionSearchTask, searchErr sessionSearchError) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current := m.tasks[task.searchID]; current == task {
		current.errors = append(current.errors, searchErr)
	}
}

func (m *sessionSearchManager) markDone(task *sessionSearchTask) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current := m.tasks[task.searchID]; current == task {
		current.done = true
	}
}

func (m *sessionSearchManager) cleanupLocked(now time.Time) {
	for id, task := range m.tasks {
		if now.Sub(task.lastTouched) >= sessionSearchIdleTTL {
			task.cancel()
			delete(m.tasks, id)
		}
	}
}

func (m *sessionSearchManager) ensureTaskCapacityLocked(now time.Time) error {
	if len(m.tasks) < sessionSearchMaxTasks {
		return nil
	}
	if id, ok := oldestSearchTaskID(m.tasks, func(task *sessionSearchTask) bool {
		return task.done
	}); ok {
		m.tasks[id].cancel()
		delete(m.tasks, id)
		return nil
	}
	if id, ok := oldestSearchTaskID(m.tasks, func(task *sessionSearchTask) bool {
		return now.Sub(task.lastTouched) >= sessionSearchIdleForCap
	}); ok {
		m.tasks[id].cancel()
		delete(m.tasks, id)
		return nil
	}
	return fmt.Errorf("too many active session searches")
}

func oldestSearchTaskID(tasks map[string]*sessionSearchTask, include func(*sessionSearchTask) bool) (string, bool) {
	type candidate struct {
		id          string
		lastTouched time.Time
	}
	candidates := []candidate{}
	for id, task := range tasks {
		if include(task) {
			candidates = append(candidates, candidate{id: id, lastTouched: task.lastTouched})
		}
	}
	if len(candidates) == 0 {
		return "", false
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].lastTouched.Before(candidates[j].lastTouched)
	})
	return candidates[0].id, true
}

func sessionSearchContains(text, queryFold string) bool {
	text = strings.TrimSpace(text)
	if text == "" || queryFold == "" {
		return false
	}
	return strings.Contains(strings.ToLower(text), queryFold)
}

func resolveSessionSearchTitle(rawTitle string) string {
	rawTitle = strings.TrimSpace(rawTitle)
	if !strings.HasPrefix(rawTitle, "{") {
		return rawTitle
	}
	var facts sessionTitleFacts
	if err := json.Unmarshal([]byte(rawTitle), &facts); err != nil {
		return rawTitle
	}
	first := strings.TrimSpace(facts.First)
	last := strings.TrimSpace(facts.Last)
	manual := strings.TrimSpace(facts.Manual)
	if manual != "" {
		return manual
	}
	if first != "" {
		return first
	}
	if last != "" {
		return last
	}
	return rawTitle
}

func sessionSearchTurnVisibleText(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	var turn acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(content), &turn); err != nil {
		return ""
	}
	method := strings.TrimSpace(turn.Method)
	switch method {
	case acp.SessionTurnMethodPromptRequest:
		var payload acp.SessionTurnPromptRequest
		if err := json.Unmarshal(turn.Param, &payload); err != nil {
			return ""
		}
		return sessionSearchContentBlockText(payload.ContentBlocks)
	case acp.SessionUpdateUserMessageChunk:
		var payload acp.SessionTurnUserMessage
		if err := json.Unmarshal(turn.Param, &payload); err != nil {
			return ""
		}
		if text := sessionSearchContentBlockText(payload.ContentBlocks); text != "" {
			return text
		}
		return strings.TrimSpace(payload.Text)
	case acp.SessionTurnMethodAgentMessage:
		var payload acp.SessionTurnTextResult
		if err := json.Unmarshal(turn.Param, &payload); err != nil {
			return ""
		}
		return strings.TrimSpace(payload.Text)
	default:
		return ""
	}
}

func sessionSearchContentBlockText(blocks []acp.ContentBlock) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if strings.TrimSpace(block.Type) == acp.ContentBlockTypeText {
			parts = append(parts, strings.TrimSpace(block.Text))
		}
	}
	return strings.Join(nonEmptySessionSearchParts(parts...), "\n")
}

func nonEmptySessionSearchParts(parts ...string) []string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
