package client

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
	logger "github.com/swm8023/wheelmaker/internal/shared"
	"image"
	"image/color"
	"image/png"
	"io"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type testInjectedInstance struct {
	name           string
	sessionID      string
	alive          bool
	callbacks      agent.Callbacks
	promptFn       func(context.Context, string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error)
	lastPrompt     []acp.ContentBlock
	cancelFn       func() error
	initializeFn   func()
	initResult     acp.InitializeResult
	loadResult     acp.SessionLoadResult
	loadUpdates    []acp.SessionUpdateParams
	loadErr        error
	loadFn         func(context.Context, acp.SessionLoadParams) (acp.SessionLoadResult, error)
	newResult      *acp.SessionNewResult
	listResult     acp.SessionListResult
	listErr        error
	setConfigFn    func(context.Context, acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error)
	setCalls       []acp.SessionSetConfigOptionParams
	skills         []agent.SkillDescriptor
	skillsErr      error
	archiveErr     error
	unarchiveErr   error
	archiveCalls   []string
	unarchiveCalls []string
	initCalls      int
	loadCalls      int
	statusCalls    int
	statusResult   acp.SessionActionStatusResult
	statusErr      error
	compactDone    chan agent.SessionCompactResult
	compactErr     error
	resolveForkFn  func(context.Context, string, []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error)
	forkSessionFn  func(context.Context, string, string, []acp.SessionForkPrompt) (acp.SessionForkResult, error)
	forkCurrentFn  func(context.Context, string, string) (acp.SessionForkResult, error)
	goal           *acp.SessionGoal
	goalSetCalls   []acp.SessionGoalSetParams
	goalClearCalls []string
}

func (c *Client) InjectForwarder(agentName, sessionID string, promptFn func(context.Context, string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error), cancelFn func() error) {
	name := strings.TrimSpace(agentName)
	if name == "" {
		name = string(acp.ACPProviderClaude)
	}
	c.mu.Lock()
	sess := c.sessions[sessionID]
	if sess == nil {
		var err error
		sess, err = c.newWiredSession(sessionID, name)
		if err != nil {
			panic(err)
		}
		c.sessions[sessionID] = sess
	}
	c.mu.Unlock()

	runtime := &testInjectedInstance{
		name:      name,
		sessionID: sessionID,
		alive:     true,
		callbacks: sess,
		promptFn:  promptFn,
		cancelFn:  cancelFn,
	}
	sess.mu.Lock()
	sess.instance = runtime
	sess.acpSessionID = sessionID
	sess.ready = true
	sess.mu.Unlock()
}

func (c *Client) InjectAgentFactory(provider acp.ACPProvider, creator agent.InstanceCreator) {
	if c == nil || creator == nil {
		return
	}
	c.mu.Lock()
	if c.registry == nil {
		c.registry = agent.DefaultACPFactory().Clone()
	} else if c.registry == agent.DefaultACPFactory() {
		c.registry = c.registry.Clone()
	}
	registry := c.registry
	for _, sess := range c.sessions {
		sess.registry = registry
	}
	c.mu.Unlock()
	registry.Register(provider, creator)
}

func (c *Client) HasSessionInMemoryForTest(sessionID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.sessions[sessionID]
	return ok
}

func (c *Client) SessionForTest(sessionID string) (*Session, error) {
	return c.SessionByID(context.Background(), sessionID)
}

func mustJSON(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

func wmAgentCapabilitiesForTest(actions acp.WMSessionActionCapabilities) acp.AgentCapabilities {
	return acp.AgentCapabilities{Meta: acp.BuildWMAgentCapabilitiesMeta(nil, acp.WMAgentExtensionCapabilities{
		SessionActions: actions,
	})}
}

func setSessionWMActionsForTest(t *testing.T, c *Client, sessionID string, actions acp.WMSessionActionCapabilities) {
	t.Helper()
	sess, err := c.SessionForTest(sessionID)
	if err != nil {
		t.Fatalf("SessionForTest(%q): %v", sessionID, err)
	}
	sess.mu.Lock()
	sess.agentState.AgentCapabilities = wmAgentCapabilitiesForTest(actions)
	sess.mu.Unlock()
}

func queuePromptPayload(sessionID, itemID string, blocks []acp.ContentBlock) json.RawMessage {
	return json.RawMessage(mustJSON(map[string]any{
		"sessionId": sessionID,
		"action":    acp.SessionQueueActionEnqueue,
		"item": map[string]any{
			"itemId":    itemID,
			"kind":      acp.SessionQueueItemKindPrompt,
			"createdAt": "2026-07-31T10:00:00Z",
			"blocks":    blocks,
		},
	}))
}

func mustNewSession(t *testing.T, id, cwd, agentType string) *Session {
	t.Helper()
	sess, err := newSession(id, cwd, agentType)
	if err != nil {
		t.Fatalf("newSession(%q): %v", id, err)
	}
	return sess
}

func mustNewWiredSession(t *testing.T, c *Client, id, agentType string) *Session {
	t.Helper()
	sess, err := c.newWiredSession(id, agentType)
	if err != nil {
		t.Fatalf("newWiredSession(%q): %v", id, err)
	}
	return sess
}

func (i *testInjectedInstance) Name() string { return i.name }
func (i *testInjectedInstance) Alive() bool {
	return i.alive
}
func (i *testInjectedInstance) SetCallbacks(callbacks agent.Callbacks) {
	i.callbacks = callbacks
}
func (i *testInjectedInstance) HandleACPRequest(context.Context, int64, string, json.RawMessage) (any, error) {
	return nil, errors.New("not implemented in test injected instance")
}
func (i *testInjectedInstance) HandleACPResponse(context.Context, string, json.RawMessage) {}
func (i *testInjectedInstance) Initialize(context.Context, acp.InitializeParams) (acp.InitializeResult, error) {
	i.initCalls++
	if i.initializeFn != nil {
		i.initializeFn()
	}
	if i.initResult.ProtocolVersion != "" || i.initResult.AgentInfo != nil || i.initResult.AgentCapabilities.LoadSession {
		return i.initResult, nil
	}
	return acp.InitializeResult{
		ProtocolVersion: "0.1",
		AgentCapabilities: acp.AgentCapabilities{
			LoadSession: false,
		},
		AgentInfo: &acp.AgentInfo{Name: "test-injected-agent"},
	}, nil
}
func (i *testInjectedInstance) SessionNew(context.Context, acp.SessionNewParams) (acp.SessionNewResult, error) {
	if i.newResult != nil {
		return *i.newResult, nil
	}
	sid := strings.TrimSpace(i.sessionID)
	if sid == "" {
		sid = "sess-1"
	}
	return acp.SessionNewResult{SessionID: sid}, nil
}
func (i *testInjectedInstance) SessionLoad(ctx context.Context, params acp.SessionLoadParams) (acp.SessionLoadResult, error) {
	i.loadCalls++
	if i.loadFn != nil {
		return i.loadFn(ctx, params)
	}
	for _, params := range i.loadUpdates {
		if strings.TrimSpace(params.SessionID) == "" {
			params.SessionID = i.sessionID
		}
		if i.callbacks != nil {
			emitInjectedSessionUpdate(i.callbacks, params)
		}
	}
	return i.loadResult, i.loadErr
}
func (i *testInjectedInstance) SessionList(context.Context, acp.SessionListParams) (acp.SessionListResult, error) {
	return i.listResult, i.listErr
}
func (i *testInjectedInstance) SessionPrompt(ctx context.Context, p acp.SessionPromptParams) (acp.PromptOutcome, error) {
	i.lastPrompt = append([]acp.ContentBlock(nil), p.Prompt...)
	if i.promptFn == nil {
		return acp.PromptOutcome{StopReason: acp.StopReasonEndTurn}, nil
	}
	text := ""
	for _, b := range p.Prompt {
		if b.Type == acp.ContentBlockTypeText {
			text = b.Text
			break
		}
	}
	updates, result, err := i.promptFn(ctx, text)
	if err != nil {
		return acp.PromptOutcome{}, err
	}
	for params := range updates {
		if strings.TrimSpace(params.SessionID) == "" {
			params.SessionID = p.SessionID
		}
		if i.callbacks != nil {
			emitInjectedSessionUpdate(i.callbacks, params)
		}
	}
	if strings.TrimSpace(result.StopReason) == "" {
		result.StopReason = acp.StopReasonEndTurn
	}
	return result, nil
}

func emitInjectedSessionUpdate(callbacks agent.Callbacks, params acp.SessionUpdateParams) {
	session, ok := callbacks.(*Session)
	if !ok {
		panic(fmt.Sprintf("test callback type %T does not expose normalized session updates", callbacks))
	}
	session.SessionUpdate(params)
}
func (i *testInjectedInstance) SessionCancel(_ string) error {
	if i.cancelFn != nil {
		return i.cancelFn()
	}
	return nil
}
func (i *testInjectedInstance) SessionSetConfigOption(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
	i.setCalls = append(i.setCalls, p)
	if i.setConfigFn != nil {
		return i.setConfigFn(context.Background(), p)
	}
	return []acp.ConfigOption{{ID: p.ConfigID, CurrentValue: p.Value}}, nil
}
func (i *testInjectedInstance) ListSkills(context.Context, string) ([]agent.SkillDescriptor, error) {
	if i.skillsErr != nil {
		return nil, i.skillsErr
	}
	return append([]agent.SkillDescriptor(nil), i.skills...), nil
}

func (i *testInjectedInstance) ArchiveSession(_ context.Context, sessionID string) error {
	i.archiveCalls = append(i.archiveCalls, sessionID)
	return i.archiveErr
}

func (i *testInjectedInstance) UnarchiveSession(_ context.Context, sessionID string) error {
	i.unarchiveCalls = append(i.unarchiveCalls, sessionID)
	return i.unarchiveErr
}

func (i *testInjectedInstance) SessionStatus(context.Context) (acp.SessionActionStatusResult, error) {
	i.statusCalls++
	return i.statusResult, i.statusErr
}

func (i *testInjectedInstance) CompactSession(context.Context, string) (<-chan agent.SessionCompactResult, error) {
	return i.compactDone, i.compactErr
}

func (i *testInjectedInstance) ResolveForkPoints(ctx context.Context, sessionID string, prompts []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
	if i.resolveForkFn == nil {
		return nil, agent.ErrSessionActionUnsupported
	}
	return i.resolveForkFn(ctx, sessionID, prompts)
}

func (i *testInjectedInstance) ForkSession(ctx context.Context, sessionID string, lastTurnID string, prompts []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
	if i.forkSessionFn == nil {
		return acp.SessionForkResult{}, agent.ErrSessionActionUnsupported
	}
	return i.forkSessionFn(ctx, sessionID, lastTurnID, prompts)
}

func (i *testInjectedInstance) ForkCurrentSession(ctx context.Context, sessionID string, cwd string) (acp.SessionForkResult, error) {
	if i.forkCurrentFn == nil {
		return acp.SessionForkResult{}, agent.ErrSessionActionUnsupported
	}
	return i.forkCurrentFn(ctx, sessionID, cwd)
}

func (i *testInjectedInstance) SessionGoalSet(_ context.Context, params acp.SessionGoalSetParams) (acp.SessionGoal, error) {
	i.goalSetCalls = append(i.goalSetCalls, params)
	if i.goal == nil {
		now := time.Now().Unix()
		i.goal = &acp.SessionGoal{
			SessionID: params.SessionID,
			Status:    acp.SessionGoalStatusActive,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}
	if params.Objective != nil {
		i.goal.Objective = *params.Objective
	}
	if params.Status != nil {
		i.goal.Status = *params.Status
	}
	if params.TokenBudget.Present {
		i.goal.TokenBudget = params.TokenBudget.Value
	}
	goal := *i.goal
	return goal, nil
}

func (i *testInjectedInstance) SessionGoalGet(_ context.Context, _ string) (*acp.SessionGoal, error) {
	if i.goal == nil {
		return nil, nil
	}
	goal := *i.goal
	return &goal, nil
}

func (i *testInjectedInstance) SessionGoalClear(_ context.Context, sessionID string) error {
	i.goalClearCalls = append(i.goalClearCalls, sessionID)
	i.goal = nil
	return nil
}

func (i *testInjectedInstance) Close() error { return nil }

var _ agent.Instance = (*testInjectedInstance)(nil)
var _ agent.SessionCompactor = (*testInjectedInstance)(nil)
var _ agent.SessionForker = (*testInjectedInstance)(nil)
var _ agent.SessionGoalController = (*testInjectedInstance)(nil)

type noopStore struct{}

func (s *noopStore) LoadProjectDefaultAgent(context.Context, string) (string, error) {
	return "", nil
}
func (s *noopStore) SaveProjectDefaultAgent(context.Context, string, string) error { return nil }
func (s *noopStore) LoadSession(context.Context, string, string) (*SessionRecord, error) {
	return nil, nil
}
func (s *noopStore) SaveSession(context.Context, *SessionRecord) error { return nil }
func (s *noopStore) ListSessions(context.Context, string) ([]SessionRecord, error) {
	return nil, nil
}
func (s *noopStore) LoadAgentPreference(context.Context, string, string) (*AgentPreferenceRecord, error) {
	return nil, nil
}
func (s *noopStore) SaveAgentPreference(context.Context, AgentPreferenceRecord) error { return nil }
func (s *noopStore) DeleteSession(context.Context, string, string) error              { return nil }
func (s *noopStore) Close() error                                                     { return nil }

type failingLoadStore struct {
	Store
	err error
}

func (s *failingLoadStore) LoadSession(context.Context, string, string) (*SessionRecord, error) {
	return nil, s.err
}

func TestPermissionRecorderDoesNotAppendBeforeSummaryPrerequisitesLoad(t *testing.T) {
	loadErr := errors.New("load failed")
	recorder := newSessionRecorder("proj1", &failingLoadStore{Store: &noopStore{}, err: loadErr}, nil)
	state := &sessionPromptState{nextTurnIndex: 2}
	state.ensureMaps()
	recorder.promptState["sess-atomic"] = state

	_, err := recorder.RecordPermissionRequest(context.Background(), "sess-atomic", acp.SessionTurnPermissionRequest{
		PermissionID: "perm-atomic",
		Title:        "Choose",
		Options:      []acp.SessionTurnPermissionOption{{OptionID: "allow", Name: "Allow"}},
	})
	if !errors.Is(err, loadErr) {
		t.Fatalf("RecordPermissionRequest error=%v, want %v", err, loadErr)
	}
	if len(state.turns) != 0 || state.nextTurnIndex != 2 {
		t.Fatalf("permission turn mutated before prerequisites loaded: turns=%d next=%d", len(state.turns), state.nextTurnIndex)
	}
}

func TestIsAgentExitError(t *testing.T) {
	cases := []string{
		"acp rpc error -1: agent process exited",
		"io: broken pipe",
		"read tcp ... connection reset by peer",
		"EOF",
		"codexapp runtime stopped",
	}
	for _, c := range cases {
		if !isAgentExitError(errors.New(c)) {
			t.Fatalf("expected agent-exit match for %q", c)
		}
	}
}

func TestIsAgentExitError_TLSHandshakeEOFFalse(t *testing.T) {
	err := errors.New("failed to connect to websocket: IO error: tls handshake eof")
	if isAgentExitError(err) {
		t.Fatal("tls handshake eof should not be treated as local agent process exit")
	}
}

func TestSessionInfoLine_UsesPrimaryAgentStateWithoutLegacyAgentMap(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	s.mu.Lock()
	s.agentState.ConfigOptions = []acp.ConfigOption{
		{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
		{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
	}
	s.mu.Unlock()

	got := s.sessionInfoLine()
	if !strings.Contains(got, "agent: claude") {
		t.Fatalf("sessionInfoLine() = %q, want agent name", got)
	}
	if !strings.Contains(got, "mode: code") {
		t.Fatalf("sessionInfoLine() = %q, want mode from primary agent state", got)
	}
	if !strings.Contains(got, "model: gpt-5") {
		t.Fatalf("sessionInfoLine() = %q, want model from primary agent state", got)
	}
}

type failingSessionViewSink struct{}

func (f *failingSessionViewSink) RecordEvent(context.Context, SessionViewEvent) error {
	return errors.New("session view sink failed")
}

func (f *failingSessionViewSink) RecordSessionOperation(context.Context, string, acp.SessionOperationPayload) error {
	return errors.New("session view sink failed")
}

func (f *failingSessionViewSink) RecordPermissionRequest(context.Context, string, acp.SessionTurnPermissionRequest) (int64, error) {
	return 0, errors.New("session view sink failed")
}

func (f *failingSessionViewSink) RecordPermissionResponse(context.Context, string, acp.SessionTurnPermissionResponse) (int64, error) {
	return 0, errors.New("session view sink failed")
}

type recordingSessionViewSink struct {
	events []SessionViewEvent
}

func (s *recordingSessionViewSink) RecordEvent(_ context.Context, event SessionViewEvent) error {
	s.events = append(s.events, event)
	return nil
}

func (s *recordingSessionViewSink) RecordSessionOperation(context.Context, string, acp.SessionOperationPayload) error {
	return nil
}

func (s *recordingSessionViewSink) RecordPermissionRequest(context.Context, string, acp.SessionTurnPermissionRequest) (int64, error) {
	return 1, nil
}

func (s *recordingSessionViewSink) RecordPermissionResponse(context.Context, string, acp.SessionTurnPermissionResponse) (int64, error) {
	return 2, nil
}

type permissionCaptureSink struct {
	requests  chan acp.SessionTurnPermissionRequest
	responses chan acp.SessionTurnPermissionResponse
}

func newPermissionCaptureSink() *permissionCaptureSink {
	return &permissionCaptureSink{
		requests:  make(chan acp.SessionTurnPermissionRequest, 8),
		responses: make(chan acp.SessionTurnPermissionResponse, 8),
	}
}

func (s *permissionCaptureSink) RecordEvent(context.Context, SessionViewEvent) error { return nil }
func (s *permissionCaptureSink) RecordSessionOperation(context.Context, string, acp.SessionOperationPayload) error {
	return nil
}
func (s *permissionCaptureSink) RecordPermissionRequest(_ context.Context, _ string, payload acp.SessionTurnPermissionRequest) (int64, error) {
	s.requests <- payload
	return 2, nil
}
func (s *permissionCaptureSink) RecordPermissionResponse(_ context.Context, _ string, payload acp.SessionTurnPermissionResponse) (int64, error) {
	s.responses <- payload
	return 3, nil
}

func TestSessionRequestPermissionWaitsForUserResponse(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	resultCh := make(chan acp.PermissionResult, 1)
	errCh := make(chan error, 1)
	go func() {
		result, err := s.SessionRequestPermission(context.Background(), 1, acp.PermissionRequestParams{
			SessionID: "sess-1",
			ToolCall:  acp.ToolCallRef{ToolCallID: "call-1", Title: "Choose"},
			Options: []acp.PermissionOption{{
				OptionID: "allow",
				Name:     "Allow",
				Kind:     "allow_once",
			}},
		})
		resultCh <- result
		errCh <- err
	}()
	request := <-sink.requests
	if request.PermissionID == "" || request.Title != "Choose" {
		t.Fatalf("request=%+v", request)
	}
	select {
	case result := <-resultCh:
		t.Fatalf("permission returned before user response: %+v", result)
	default:
	}
	accepted, err := s.RespondPermission(context.Background(), request.PermissionID, "allow")
	if err != nil {
		t.Fatalf("RespondPermission: %v", err)
	}
	if accepted.Outcome != "selected" || accepted.OptionID != "allow" {
		t.Fatalf("accepted=%+v", accepted)
	}
	if response := <-sink.responses; response.RequestTurnIndex != 2 || response.OptionID != "allow" {
		t.Fatalf("response=%+v", response)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("SessionRequestPermission: %v", err)
	}
	if result := <-resultCh; !reflect.DeepEqual(result, accepted) {
		t.Fatalf("permission result=%+v, want %+v", result, accepted)
	}
}

func TestSessionRequestPermissionDoesNotAutoAllow(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resultCh := make(chan acp.PermissionResult, 1)
	go func() {
		result, _ := s.SessionRequestPermission(ctx, 1, acp.PermissionRequestParams{
			SessionID: "sess-1",
			ToolCall:  acp.ToolCallRef{ToolCallID: "call-1"},
			Options: []acp.PermissionOption{{
				OptionID: "always",
				Name:     "Always allow",
				Kind:     "allow_always",
			}},
		})
		resultCh <- result
	}()
	<-sink.requests
	select {
	case result := <-resultCh:
		t.Fatalf("permission auto-selected: %+v", result)
	default:
	}
	cancel()
	if result := <-resultCh; result.Outcome != "cancelled" {
		t.Fatalf("result=%+v, want cancelled", result)
	}
}

func TestSessionRequestPermissionNormalizesTextAndRejectsInvalidOptions(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_, _ = s.SessionRequestPermission(ctx, 1, acp.PermissionRequestParams{
			SessionID: "sess-1",
			ToolCall: acp.ToolCallRef{
				ToolCallID: "call-1",
				Content: []acp.ToolCallContent{
					{Type: "content", Content: &acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "Question text"}},
					{Type: "content", Content: &acp.ContentBlock{Type: acp.ContentBlockTypeImage, Data: "private"}},
					{Type: "diff", Path: "secret", NewText: "private"},
				},
			},
			Options: []acp.PermissionOption{{
				OptionID: "continue",
				Name:     "Continue",
				Kind:     "allow_once",
			}},
		})
	}()
	request := <-sink.requests
	if request.DetailsText != "Question text" {
		t.Fatalf("detailsText=%q", request.DetailsText)
	}
	encoded := mustJSON(request)
	if strings.Contains(string(encoded), "private") || strings.Contains(string(encoded), "secret") {
		t.Fatalf("request retained rich/private content: %s", encoded)
	}
	cancel()

	result, err := s.SessionRequestPermission(context.Background(), 2, acp.PermissionRequestParams{
		SessionID: "sess-1",
		ToolCall:  acp.ToolCallRef{ToolCallID: "call-2"},
		Options: []acp.PermissionOption{
			{OptionID: "duplicate", Name: "One"},
			{OptionID: "duplicate", Name: "Two"},
		},
	})
	if err != nil || result.Outcome != "cancelled" {
		t.Fatalf("invalid options result=%+v err=%v", result, err)
	}
}

func TestSessionPermissionRespondRequestIsFirstWinsAndIdempotent(t *testing.T) {
	c := newSessionViewTestClient(t)
	s := mustNewSession(t, "sess-route", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	c.mu.Lock()
	c.sessions["sess-route"] = s
	c.mu.Unlock()
	resultCh := make(chan acp.PermissionResult, 1)
	go func() {
		result, _ := s.SessionRequestPermission(context.Background(), 1, acp.PermissionRequestParams{
			SessionID: "sess-route",
			ToolCall:  acp.ToolCallRef{ToolCallID: "call-route", Title: "Choose"},
			Options: []acp.PermissionOption{
				{OptionID: "one", Name: "One", Kind: "allow_once"},
				{OptionID: "two", Name: "Two", Kind: "reject_once"},
			},
		})
		resultCh <- result
	}()
	request := <-sink.requests
	payload := mustJSON(map[string]any{
		"sessionId": "sess-route", "permissionId": request.PermissionID, "optionId": "one",
	})
	response, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionPermissionRespond, "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := response.(map[string]any)
	if body["accepted"] != true || body["optionId"] != "one" {
		t.Fatalf("response=%#v", body)
	}
	if result := <-resultCh; result.OptionID != "one" {
		t.Fatalf("agent result=%+v", result)
	}
	if _, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionPermissionRespond, "proj1", payload); err != nil {
		t.Fatalf("same-option retry: %v", err)
	}
	conflictPayload := mustJSON(map[string]any{
		"sessionId": "sess-route", "permissionId": request.PermissionID, "optionId": "two",
	})
	_, err = c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionPermissionRespond, "proj1", conflictPayload)
	var registryErr *acp.RegistryRequestError
	if !errors.As(err, &registryErr) || registryErr.Code != acp.CodeConflict {
		t.Fatalf("different-option error=%#v", err)
	}
}

func TestSessionPermissionRespondConcurrentChoicesHaveOneWinner(t *testing.T) {
	s := mustNewSession(t, "sess-race", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	agentResult := make(chan acp.PermissionResult, 1)
	go func() {
		result, _ := s.SessionRequestPermission(context.Background(), 1, acp.PermissionRequestParams{
			SessionID: "sess-race",
			ToolCall:  acp.ToolCallRef{ToolCallID: "call-race", Title: "Choose"},
			Options: []acp.PermissionOption{
				{OptionID: "allow", Name: "Allow", Kind: "allow_once"},
				{OptionID: "reject", Name: "Reject", Kind: "reject_once"},
			},
		})
		agentResult <- result
	}()
	request := <-sink.requests

	type choiceResult struct {
		result acp.PermissionResult
		err    error
	}
	choices := make(chan choiceResult, 2)
	for _, optionID := range []string{"allow", "reject"} {
		go func(optionID string) {
			result, err := s.RespondPermission(context.Background(), request.PermissionID, optionID)
			choices <- choiceResult{result: result, err: err}
		}(optionID)
	}

	var winner acp.PermissionResult
	conflicts := 0
	for range 2 {
		choice := <-choices
		if choice.err == nil {
			winner = choice.result
			continue
		}
		var registryErr *acp.RegistryRequestError
		if errors.As(choice.err, &registryErr) && registryErr.Code == acp.CodeConflict {
			conflicts++
			continue
		}
		t.Fatalf("unexpected choice error: %v", choice.err)
	}
	if winner.Outcome != "selected" || conflicts != 1 {
		t.Fatalf("winner=%+v conflicts=%d", winner, conflicts)
	}
	if response := <-sink.responses; response.OptionID != winner.OptionID {
		t.Fatalf("response=%+v, winner=%+v", response, winner)
	}
	select {
	case duplicate := <-sink.responses:
		t.Fatalf("unexpected duplicate response: %+v", duplicate)
	default:
	}
	if result := <-agentResult; !reflect.DeepEqual(result, winner) {
		t.Fatalf("agent result=%+v, winner=%+v", result, winner)
	}
}

func TestSessionPromptCancelEndsPermissionWithoutResponse(t *testing.T) {
	s := mustNewSession(t, "sess-cancel", "/tmp", "claude")
	sink := newPermissionCaptureSink()
	s.viewSink = sink
	promptCtx, cancelPromptContext := context.WithCancel(context.Background())
	s.mu.Lock()
	s.prompt.ctx = promptCtx
	s.prompt.cancel = cancelPromptContext
	s.mu.Unlock()
	resultCh := make(chan acp.PermissionResult, 1)
	go func() {
		result, _ := s.SessionRequestPermission(context.Background(), 1, acp.PermissionRequestParams{
			SessionID: "sess-cancel",
			ToolCall:  acp.ToolCallRef{ToolCallID: "call-cancel"},
			Options:   []acp.PermissionOption{{OptionID: "allow", Name: "Allow", Kind: "allow_once"}},
		})
		resultCh <- result
	}()
	<-sink.requests
	if err := s.cancelPrompt(); err != nil {
		t.Fatalf("cancelPrompt: %v", err)
	}
	if result := <-resultCh; result.Outcome != "cancelled" {
		t.Fatalf("result=%+v, want cancelled", result)
	}
	select {
	case response := <-sink.responses:
		t.Fatalf("cancel wrote a user response: %+v", response)
	default:
	}
}

func TestReplyWithTitleRecordsSystemEventThroughViewSink(t *testing.T) {
	sink := &recordingSessionViewSink{}
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	s.viewSink = sink

	s.replyWithTitle("Switched", "session: sess-1")

	if len(sink.events) != 1 {
		t.Fatalf("session view events len = %d, want 1", len(sink.events))
	}
	event := sink.events[0]
	if event.Type != SessionViewEventTypeSystem {
		t.Fatalf("event.Type = %q, want %q", event.Type, SessionViewEventTypeSystem)
	}
	if event.SessionID != "sess-1" {
		t.Fatalf("event.SessionID = %q, want %q", event.SessionID, "sess-1")
	}
	if strings.TrimSpace(event.Content) != "Switched\nsession: sess-1" {
		t.Fatalf("event.Content = %q, want %q", event.Content, "Switched\nsession: sess-1")
	}
	if event.SourceChannel != "" || event.SourceChatID != "" {
		t.Fatalf("event source = (%q, %q), want empty source", event.SourceChannel, event.SourceChatID)
	}
}

func TestConnectHintUsesAppSessionUIAction(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")

	got := s.connectHint()

	if strings.Contains(got, "/new") {
		t.Fatalf("connectHint() = %q, want app/session UI action without slash command", got)
	}
	if !strings.Contains(got, "app") {
		t.Fatalf("connectHint() = %q, want app/session UI action", got)
	}
}

func TestRecordSessionViewEventReturnsTrueWhenConfiguredViewSinkFails(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	s.viewSink = &failingSessionViewSink{}

	if handled := s.recordSessionViewEvent(SessionViewEvent{
		Type:    SessionViewEventTypeSystem,
		Content: "fallback please",
	}); !handled {
		t.Fatal("recordSessionViewEvent returned false for configured failed view sink, want true")
	}
}

func TestCurrentAgentNameLocked_PrefersSessionAgentType(t *testing.T) {
	s := mustNewSession(t, "sess-1", "/tmp", "claude")
	s.mu.Lock()
	s.instance = &testInjectedInstance{name: "codex"}
	got := s.agentType
	s.mu.Unlock()

	if got != "claude" {
		t.Fatalf("agentType = %q, want %q", got, "claude")
	}
}

func TestSessionByID_RestoresFromStore(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	ctx := context.Background()
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:           "restore-me",
		ProjectName:  "proj1",
		AgentType:    "claude",
		AgentJSON:    `{"title":"Persisted"}`,
		CreatedAt:    time.Now().Add(-time.Hour),
		LastActiveAt: time.Now().Add(-10 * time.Minute),
	}); err != nil {
		t.Fatalf("save session: %v", err)
	}
	if err := c.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	sess, err := c.SessionByID(ctx, "restore-me")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	if sess.acpSessionID != "restore-me" {
		t.Fatalf("resolved session ID = %q, want restore-me", sess.acpSessionID)
	}

}

func TestListSessions_DiskOnlySessionsAreMarkedPersisted(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	createdAt := time.Now().Add(-2 * time.Hour).UTC()
	lastMessageAt := time.Now().Add(-5 * time.Minute).UTC()
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:          "persisted-only",
		ProjectName: "proj1",
		Status:      SessionSuspended,
		AgentType:   "claude",
		AgentJSON:   `{"title":"Persisted Title"}`,

		CreatedAt:    createdAt,
		LastActiveAt: lastMessageAt,
	}); err != nil {
		t.Fatalf("save session: %v", err)
	}

	c := New(store, "proj1", "/tmp")
	entries, err := c.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries len = %d, want 1", len(entries))
	}
	if entries[0].Status != SessionPersisted {
		t.Fatalf("entries[0].Status = %v, want %v", entries[0].Status, SessionPersisted)
	}
	if entries[0].InMemory {
		t.Fatal("entries[0].InMemory = true, want false")
	}
}

func TestListSessions_InMemorySessionKeepsStoredProjectionMetadata(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	createdAt := time.Now().Add(-2 * time.Hour).UTC()
	lastMessageAt := time.Now().Add(-3 * time.Minute).UTC()
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:          "sess-1",
		ProjectName: "proj1",
		Status:      SessionSuspended,
		AgentType:   "claude",
		AgentJSON:   `{"title":"Persisted Title"}`,
		Title:       "Persisted Title",

		CreatedAt:    createdAt,
		LastActiveAt: lastMessageAt,
	}); err != nil {
		t.Fatalf("save session: %v", err)
	}

	c := New(store, "proj1", "/tmp")
	c.mu.Lock()
	sess := mustNewWiredSession(t, c, "sess-1", "claude")
	sess.createdAt = createdAt
	sess.lastActiveAt = time.Now().UTC()
	sess.Status = SessionActive
	sess.agentState.Title = "Runtime Title"
	c.sessions[sess.acpSessionID] = sess
	c.mu.Unlock()

	entries, err := c.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries len = %d, want 1", len(entries))
	}
	if entries[0].Title != "Persisted Title" {
		t.Fatalf("entries[0].Title = %q, want %q", entries[0].Title, "Persisted Title")
	}
	if !entries[0].LastActiveAt.Equal(lastMessageAt) {
		t.Fatalf("entries[0].LastActiveAt = %q, want %q", entries[0].LastActiveAt.Format(time.RFC3339), lastMessageAt.Format(time.RFC3339))
	}
	if entries[0].Status != SessionActive {
		t.Fatalf("entries[0].Status = %v, want %v", entries[0].Status, SessionActive)
	}
	if !entries[0].InMemory {
		t.Fatal("entries[0].InMemory = false, want true")
	}

}

func TestEnsureReady_SessionLoadKeepsPersistedConfigWhenLoadResultEmpty(t *testing.T) {
	s := mustNewSession(t, "acp-keep", "/tmp", "claude")
	s.projectName = "proj1"
	s.agentState = SessionAgentState{
		ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
		},
	}
	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return &testInjectedInstance{
			name:      "claude",
			sessionID: "acp-keep",
			initResult: acp.InitializeResult{
				ProtocolVersion: "0.1",
				AgentCapabilities: acp.AgentCapabilities{
					LoadSession: true,
				},
				AgentInfo: &acp.AgentInfo{Name: "test-injected-agent"},
			},
			loadResult: acp.SessionLoadResult{},
		}, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	if err := s.ensureReady(context.Background()); err != nil {
		t.Fatalf("ensureReady: %v", err)
	}

	s.mu.Lock()
	opts := append([]acp.ConfigOption(nil), s.agentState.ConfigOptions...)
	s.mu.Unlock()
	if got := findCurrentValue(opts, acp.ConfigOptionIDMode); got != "code" {
		t.Fatalf("mode = %q, want %q", got, "code")
	}
	if got := findCurrentValue(opts, acp.ConfigOptionIDModel); got != "gpt-5" {
		t.Fatalf("model = %q, want %q", got, "gpt-5")
	}
}

func TestEnsureReady_SessionLoadFailure_ReturnsErrorWithoutAllocatingNewSessionID(t *testing.T) {
	s := mustNewSession(t, "acp-old", "/tmp", "claude")
	s.projectName = "proj1"
	s.agentState = SessionAgentState{
		ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
		},
	}

	inst := &testInjectedInstance{
		name:      "claude",
		sessionID: "acp-new",
		initResult: acp.InitializeResult{
			ProtocolVersion: "0.1",
			AgentCapabilities: acp.AgentCapabilities{
				LoadSession: true,
			},
			AgentInfo: &acp.AgentInfo{Name: "test-injected-agent"},
		},
		loadErr: errors.New("session not found"),
	}

	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	err := s.ensureReady(context.Background())
	if err == nil {
		t.Fatal("ensureReady error = nil, want error")
	}
	if s.acpSessionID != "acp-old" {
		t.Fatalf("session ID = %q, want acp-old", s.acpSessionID)
	}
}

func TestEnsureReady_FailsWhenAgentDoesNotSupportLoadSession(t *testing.T) {
	s := mustNewSession(t, "acp-existing", "/tmp", "claude")
	s.projectName = "proj1"
	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return &testInjectedInstance{
			name:      "claude",
			sessionID: "acp-existing",
			initResult: acp.InitializeResult{
				ProtocolVersion:   "0.1",
				AgentCapabilities: acp.AgentCapabilities{LoadSession: false},
			},
		}, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	err := s.ensureReady(context.Background())
	if err == nil {
		t.Fatal("ensureReady error = nil, want error")
	}
	if !strings.Contains(err.Error(), "does not support session/load") {
		t.Fatalf("ensureReady error = %v, want unsupported load-session error", err)
	}
}

func TestEnsureReadyAndNotify_DoesNotEmitReadySystemPrompt(t *testing.T) {
	s := mustNewSession(t, "acp-1", "/tmp", "claude")
	s.projectName = "proj1"
	sink := &recordingSessionViewSink{}
	s.viewSink = sink
	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return &testInjectedInstance{
			name:      "claude",
			sessionID: "acp-1",
			initResult: acp.InitializeResult{
				ProtocolVersion:   "0.1",
				AgentCapabilities: acp.AgentCapabilities{LoadSession: true},
			},
			loadResult: acp.SessionLoadResult{},
		}, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	if err := s.ensureReadyAndNotify(context.Background()); err != nil {
		t.Fatalf("ensureReadyAndNotify(first): %v", err)
	}
	if got := len(sink.events); got != 0 {
		t.Fatalf("session view events count after first ensureReadyAndNotify = %d, want 0", got)
	}

	if err := s.ensureReadyAndNotify(context.Background()); err != nil {
		t.Fatalf("ensureReadyAndNotify(second): %v", err)
	}
	if got := len(sink.events); got != 0 {
		t.Fatalf("session view events count after second ensureReadyAndNotify = %d, want 0", got)
	}
}

func TestEvictSuspendedSessions(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	c.suspendTimeout = 0

	c.mu.Lock()
	sess := mustNewWiredSession(t, c, "evict-me", "claude")
	sess.Status = SessionSuspended
	sess.lastActiveAt = time.Now().Add(-time.Minute)
	c.sessions["evict-me"] = sess
	c.mu.Unlock()

	c.evictSuspendedSessions()

	if c.HasSessionInMemoryForTest("evict-me") {
		t.Fatal("evicted session should not remain in memory")
	}
	rec, err := store.LoadSession(context.Background(), "proj1", "evict-me")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("evicted session not persisted")
	}
}

func TestSessionUpdate_NoPromptContext_DoesNotBlockWhenChannelFull(t *testing.T) {
	s := mustNewSession(t, "sess", "/tmp", "claude")
	content, _ := json.Marshal(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "chunk"})

	ch := make(chan acp.SessionUpdateParams, 1)
	ch <- acp.SessionUpdateParams{SessionID: "acp-1", Update: acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk}}

	s.mu.Lock()
	s.acpSessionID = "acp-1"
	s.prompt.updatesCh = ch
	s.prompt.ctx = nil
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.SessionUpdate(acp.SessionUpdateParams{
			SessionID: "acp-1",
			Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       content,
			},
		})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("SessionUpdate blocked when prompt channel was full and prompt context was nil")
	}
}

func TestSessionUpdate_UsageUpdatesAgentStateWithoutPromptDelivery(t *testing.T) {
	s := mustNewSession(t, "sess", "/tmp", "claude")
	ch := make(chan acp.SessionUpdateParams, 1)
	used := int64(19000)
	size := int64(258000)

	s.mu.Lock()
	s.acpSessionID = "acp-1"
	s.prompt.updatesCh = ch
	s.prompt.ctx = nil
	s.mu.Unlock()

	s.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "acp-1",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateUsageUpdate,
			Used:          &used,
			Size:          &size,
			UpdatedAt:     "2026-07-07T08:00:00Z",
		},
	})

	select {
	case got := <-ch:
		t.Fatalf("usage update delivered to prompt channel: %+v", got.Update)
	default:
	}

	s.mu.Lock()
	raw := mustJSON(s.agentState)
	s.mu.Unlock()
	var state struct {
		Usage struct {
			Used      int64  `json:"used"`
			Size      int64  `json:"size"`
			UpdatedAt string `json:"updatedAt"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("unmarshal agent state: %v", err)
	}
	if state.Usage.Used != used || state.Usage.Size != size || state.Usage.UpdatedAt != "2026-07-07T08:00:00Z" {
		t.Fatalf("usage state = %+v, want used=%d size=%d", state.Usage, used, size)
	}
}

func findCurrentValue(options []acp.ConfigOption, id string) string {
	for _, opt := range options {
		if strings.EqualFold(opt.ID, id) {
			return strings.TrimSpace(opt.CurrentValue)
		}
	}
	return ""
}

func configOptionByID(options []acp.ConfigOption, id string) *acp.ConfigOption {
	for index := range options {
		if strings.EqualFold(options[index].ID, id) {
			return &options[index]
		}
	}
	return nil
}

func TestSessionFromRecord_RestoresSingleAgentState(t *testing.T) {
	rec := &SessionRecord{
		ID:          "sess-restored",
		ProjectName: "proj1",
		Status:      SessionPersisted,
		AgentType:   "claude",
		AgentJSON:   `{"title":"Persisted","commands":[{"name":"/status"}]}`,
		Title:       "Persisted",
	}

	sess, err := sessionFromRecord(rec, "/tmp")
	if err != nil {
		t.Fatalf("sessionFromRecord: %v", err)
	}
	if sess.acpSessionID != "sess-restored" {
		t.Fatalf("ID = %q, want sess-restored", sess.acpSessionID)
	}
	if got := sess.agentType; got != "claude" {
		t.Fatalf("agentType = %q, want claude", got)
	}
	if got := sess.agentState.Title; got != "Persisted" {
		t.Fatalf("agentState.Title = %q, want Persisted", got)
	}
}

func TestCreateSessionWithAgent_UsesACPResultAsUnifiedSessionID(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	inst := &testInjectedInstance{
		name: "claude",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{},
		},
		newResult: &acp.SessionNewResult{SessionID: "sess-from-agent"},
	}

	c := New(store, "proj1", "/tmp")
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register("claude", func(context.Context, string) (agent.Instance, error) { return inst, nil })

	sess, err := c.CreateSession(context.Background(), "claude", "hello")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if sess.acpSessionID != "sess-from-agent" {
		t.Fatalf("session ID = %q, want sess-from-agent", sess.acpSessionID)
	}
	if got := sess.agentType; got != "claude" {
		t.Fatalf("agentType = %q, want claude", got)
	}

	loaded, err := store.LoadSession(context.Background(), "proj1", "sess-from-agent")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded == nil || loaded.AgentType != "claude" {
		t.Fatalf("LoadSession = %+v, want agentType claude", loaded)
	}
}

func TestCreateSessionWithAgent_FailsWhenACPReturnsEmptySessionID(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	inst := &testInjectedInstance{
		name: "claude",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{},
		},
		newResult: &acp.SessionNewResult{SessionID: ""},
	}

	c := New(store, "proj1", "/tmp")
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register("claude", func(context.Context, string) (agent.Instance, error) { return inst, nil })

	sess, err := c.CreateSession(context.Background(), "claude", "hello")
	if err == nil {
		t.Fatalf("CreateSession error = nil, want error")
	}
	if sess != nil {
		t.Fatalf("CreateSession session = %#v, want nil", sess)
	}

	entries, err := store.ListSessions(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("ListSessions count = %d, want 0", len(entries))
	}
}

func TestCreateSessionWithAgent_ErrsWhenRequestedAgentUnavailable(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	// Deterministic registry independent of the host: only claude is available,
	// codex is a valid provider name but has no registered creator.
	c.registry = agent.NewACPFactory()
	c.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		t.Fatalf("claude creator must not be invoked when codex was requested")
		return nil, nil
	})

	sess, err := c.CreateSession(context.Background(), "codex", "hello")
	if err == nil {
		t.Fatalf("CreateSession error = nil, want error for unavailable codex")
	}
	if sess != nil {
		t.Fatalf("CreateSession session = %#v, want nil", sess)
	}
	if !strings.Contains(err.Error(), "codex") {
		t.Fatalf("error %q should mention the requested agent codex", err.Error())
	}
	if !strings.Contains(err.Error(), "claude") {
		t.Fatalf("error %q should list available agents (claude)", err.Error())
	}

	// The failed request must not silently overwrite the project default agent
	// (the old fallback persisted the fallback agent as the project default).
	defaultAgent, err := store.LoadProjectDefaultAgent(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if defaultAgent == "claude" || defaultAgent == "codex" {
		t.Fatalf("default agent = %q, should not be persisted on failed create", defaultAgent)
	}

	entries, err := store.ListSessions(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("ListSessions count = %d, want 0", len(entries))
	}
}

func TestNewSession_RequiresNonEmptyACPID(t *testing.T) {
	sess, err := newSession("   ", "/tmp", "claude")
	if err == nil {
		t.Fatalf("newSession error = nil, want error")
	}
	if sess != nil {
		t.Fatalf("newSession session = %#v, want nil", sess)
	}
}

func TestSQLiteStoreUsesSynchronousNormal(t *testing.T) {
	ctx := context.Background()
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	sqliteStore, ok := store.(*sqliteStore)
	if !ok {
		t.Fatalf("store type = %T, want *sqliteStore", store)
	}
	var synchronous int
	if err := sqliteStore.db.QueryRowContext(ctx, `PRAGMA synchronous`).Scan(&synchronous); err != nil {
		t.Fatalf("query PRAGMA synchronous: %v", err)
	}
	// 0=OFF, 1=NORMAL, 2=FULL. WAL + synchronous=NORMAL keeps commits durable
	// across normal crashes while skipping the per-commit fsync; only the last
	// transaction may be lost on power loss (no database corruption).
	if synchronous != 1 {
		t.Fatalf("PRAGMA synchronous = %d, want 1 (NORMAL)", synchronous)
	}
}

func TestSQLiteStoreMigratesCodexAppIdentityOnce(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	if _, err := db.ExecContext(ctx, sqliteSchema); err != nil {
		t.Fatalf("init raw schema: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO projects (project_name, default_agent_type, updated_at)
		VALUES ('proj1', 'codexapp', '2026-05-20T00:00:00Z');
		INSERT INTO sessions (id, project_name, status, agent_type, agent_json, session_sync_json, title, created_at, updated_at)
		VALUES
			('sess-old', 'proj1', 2, 'codexapp', '{"agentInfo":{"name":"codexapp","title":"Codex App Server"}}', '{}', 'old codexapp', '2026-05-20T00:00:00Z', '2026-05-20T00:00:00Z'),
			('sess-bad-json', 'proj1', 2, 'codexapp', '{bad json', '{}', 'bad codexapp', '2026-05-20T00:00:00Z', '2026-05-20T00:00:00Z');
		INSERT INTO agent_preferences (project_name, agent_type, preference_json)
		VALUES
			('proj1', 'codex', '{"configOptions":[{"id":"model","currentValue":"gpt-5"}]}'),
			('proj1', 'codexapp', '{"configOptions":[{"id":"model","currentValue":"legacy"}]}'),
			('proj2', 'codexapp', '{"configOptions":[{"id":"model","currentValue":"only-legacy"}]}');
	`); err != nil {
		t.Fatalf("seed codexapp rows: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw sqlite: %v", err)
	}

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore migrated: %v", err)
	}
	defer store.Close()
	sqliteStore := store.(*sqliteStore)

	var version int
	if err := sqliteStore.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("query user_version: %v", err)
	}
	if version < sqliteMigrationVersionCodexAppIdentity {
		t.Fatalf("user_version=%d, want at least %d", version, sqliteMigrationVersionCodexAppIdentity)
	}

	for _, query := range []string{
		`SELECT COUNT(*) FROM projects WHERE lower(trim(default_agent_type)) = 'codexapp'`,
		`SELECT COUNT(*) FROM sessions WHERE lower(trim(agent_type)) = 'codexapp'`,
		`SELECT COUNT(*) FROM agent_preferences WHERE lower(trim(agent_type)) = 'codexapp'`,
	} {
		var count int
		if err := sqliteStore.db.QueryRowContext(ctx, query).Scan(&count); err != nil {
			t.Fatalf("query count %q: %v", query, err)
		}
		if count != 0 {
			t.Fatalf("query %q count=%d, want 0", query, count)
		}
	}

	defaultAgent, err := store.LoadProjectDefaultAgent(ctx, "proj1")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if defaultAgent != "codex" {
		t.Fatalf("defaultAgent=%q, want codex", defaultAgent)
	}

	pref, err := store.LoadAgentPreference(ctx, "proj1", "codex")
	if err != nil {
		t.Fatalf("LoadAgentPreference: %v", err)
	}
	if pref == nil || pref.AgentType != "codex" {
		t.Fatalf("pref=%+v, want codex preference", pref)
	}

	loaded, err := store.LoadSession(ctx, "proj1", "sess-old")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded == nil || loaded.AgentType != "codex" {
		t.Fatalf("loaded=%+v, want codex session", loaded)
	}
	var agentInfoName string
	if err := sqliteStore.db.QueryRowContext(ctx, `SELECT json_extract(agent_json, '$.agentInfo.name') FROM sessions WHERE id = 'sess-old'`).Scan(&agentInfoName); err != nil {
		t.Fatalf("query migrated agent_json: %v", err)
	}
	if agentInfoName != "codex" {
		t.Fatalf("agentInfo.name=%q, want codex", agentInfoName)
	}

	entries, err := store.ListSessions(ctx, "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries=%+v, want two migrated sessions", entries)
	}
	for _, entry := range entries {
		if entry.AgentType != "codex" || entry.Agent != "codex" {
			t.Fatalf("entry=%+v, want codex session list entry", entry)
		}
	}

	var prefCount int
	if err := sqliteStore.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_preferences WHERE project_name = 'proj1'`).Scan(&prefCount); err != nil {
		t.Fatalf("query proj1 preference count: %v", err)
	}
	if prefCount != 1 {
		t.Fatalf("proj1 preference count=%d, want conflict cleanup to keep one row", prefCount)
	}
	pref, err = store.LoadAgentPreference(ctx, "proj2", "codex")
	if err != nil {
		t.Fatalf("LoadAgentPreference proj2 codex: %v", err)
	}
	if pref == nil || !strings.Contains(pref.PreferenceJSON, "only-legacy") {
		t.Fatalf("pref=%+v, want renamed legacy preference", pref)
	}
}

func TestSQLiteStoreSkipsCodexAppMigrationWhenUserVersionIsCurrent(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open raw sqlite: %v", err)
	}
	if _, err := db.ExecContext(ctx, sqliteSchema); err != nil {
		t.Fatalf("init raw schema: %v", err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, sqliteMigrationVersionCodexAppIdentity)); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO sessions (id, project_name, status, agent_type, agent_json, session_sync_json, title, created_at, updated_at)
		VALUES ('sess-sentinel', 'proj1', 2, 'codexapp', '{}', '{}', 'sentinel', '2026-05-20T00:00:00Z', '2026-05-20T00:00:00Z');
	`); err != nil {
		t.Fatalf("seed sentinel row: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw sqlite: %v", err)
	}

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore reopened: %v", err)
	}
	defer store.Close()
	sqliteStore := store.(*sqliteStore)

	var raw string
	if err := sqliteStore.db.QueryRowContext(ctx, `SELECT agent_type FROM sessions WHERE id = 'sess-sentinel'`).Scan(&raw); err != nil {
		t.Fatalf("query sentinel: %v", err)
	}
	if raw != "codexapp" {
		t.Fatalf("agent_type=%q, want skipped sentinel codexapp", raw)
	}
}

func TestCreateSession_ReappliesProjectAgentBaseline(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	if err := store.SaveAgentPreference(context.Background(), AgentPreferenceRecord{
		ProjectName: "proj1",
		AgentType:   "claude",
		PreferenceJSON: string(mustJSON(PreferenceState{ConfigOptions: []PreferenceConfigOption{
			{ID: acp.ConfigOptionIDMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, CurrentValue: "gpt-5"},
			{ID: acp.ConfigOptionIDThoughtLevel, CurrentValue: "high"},
		}})),
	}); err != nil {
		t.Fatalf("SaveAgentPreference: %v", err)
	}

	c := New(store, "proj1", "/tmp")
	inst := &testInjectedInstance{
		name: "claude",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{},
		},
		newResult: &acp.SessionNewResult{SessionID: "acp-new", ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "ask"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-4o-mini"},
			{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "low"},
		}},
	}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) { return inst, nil })

	sess, err := c.CreateSession(context.Background(), "claude", "")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := sess.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	if err := sess.ensureReady(context.Background()); err != nil {
		t.Fatalf("ensureReady: %v", err)
	}

	if got := len(inst.setCalls); got != 3 {
		t.Fatalf("set calls = %d, want 3", got)
	}

}

func TestCreateSession_AppliesClaudeCompatibleDefaultEffort(t *testing.T) {
	tests := []struct {
		agentType       acp.ACPProvider
		wantEffort      string
		wantExplicitSet bool
	}{
		{agentType: acp.ACPProviderCCDeepSeek, wantEffort: "max", wantExplicitSet: true},
		{agentType: acp.ACPProviderCCGLM, wantEffort: "max", wantExplicitSet: true},
		{agentType: acp.ACPProviderCCKimi, wantEffort: "high"},
		{agentType: acp.ACPProviderCCQwen, wantEffort: "default"},
		{agentType: acp.ACPProviderCCFlicker, wantEffort: "default"},
	}

	for _, tt := range tests {
		t.Run(string(tt.agentType), func(t *testing.T) {
			store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
			if err != nil {
				t.Fatalf("NewStore: %v", err)
			}
			defer store.Close()

			inst := &testInjectedInstance{
				name: string(tt.agentType),
				initResult: acp.InitializeResult{
					ProtocolVersion:   "0.1",
					AgentCapabilities: acp.AgentCapabilities{},
				},
				newResult: &acp.SessionNewResult{
					SessionID: "acp-new",
					ConfigOptions: []acp.ConfigOption{{
						ID:           "effort",
						Category:     acp.ConfigOptionCategoryThoughtLv,
						CurrentValue: "default",
					}},
				},
			}
			client := New(store, "proj1", t.TempDir())
			client.registry = agent.NewACPFactory()
			client.registry.Register(tt.agentType, func(context.Context, string) (agent.Instance, error) {
				return inst, nil
			})

			sess, err := client.CreateSession(context.Background(), string(tt.agentType), "")
			if err != nil {
				t.Fatalf("CreateSession: %v", err)
			}
			if got := findCurrentValue(sess.CurrentConfigOptions(), "effort"); got != tt.wantEffort {
				t.Fatalf("current effort = %q, want %q", got, tt.wantEffort)
			}
			if !tt.wantExplicitSet {
				if len(inst.setCalls) != 0 {
					t.Fatalf("set calls = %v, want none when Claude default already maps to %s", inst.setCalls, tt.wantEffort)
				}
				return
			}
			if len(inst.setCalls) != 1 {
				t.Fatalf("set calls = %v, want one effort default", inst.setCalls)
			}
			if got := inst.setCalls[0]; got.ConfigID != "effort" || got.Value != tt.wantEffort {
				t.Fatalf("set call = %+v, want effort=%s", got, tt.wantEffort)
			}
		})
	}
}

func TestNormalizeAgentConfigOptionsDedupsOptionValues(t *testing.T) {
	// A model option can carry the same value twice when an agent surfaces it
	// both as a tier default and in the discovered catalog (e.g. cc-flicker).
	// normalizeAgentConfigOptions must collapse duplicates by value, keeping the
	// first occurrence so its display name survives.
	options := []acp.ConfigOption{
		{
			ID:       acp.ConfigOptionIDModel,
			Category: acp.ConfigOptionCategoryModel,
			Options: []acp.ConfigOptionValue{
				{Value: "CLAUDE_OPUS_4_8", Name: "MF Claude Opus 4.8"},
				{Value: "CLAUDE_4_6", Name: "MF Claude Sonnet 4.6"},
				{Value: "CLAUDE_OPUS_4_8", Name: "dup opus"},
				{Value: "CLAUDE-MYFLICKER-GPT_5_4", Name: "MF GPT-5.4"},
				{Value: "CLAUDE_4_6", Name: "dup sonnet"},
			},
		},
	}
	normalized := normalizeAgentConfigOptions("cc-flicker", options)
	got := normalized[0].Options
	want := []acp.ConfigOptionValue{
		{Value: "CLAUDE_OPUS_4_8", Name: "MF Claude Opus 4.8"},
		{Value: "CLAUDE_4_6", Name: "MF Claude Sonnet 4.6"},
		{Value: "CLAUDE-MYFLICKER-GPT_5_4", Name: "MF GPT-5.4"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("deduped options = %#v, want %#v", got, want)
	}
}

func TestCreateSession_ClaudeCompatibleProvidersExposeOnlyActualEffortLevels(t *testing.T) {
	tests := []struct {
		agentType   acp.ACPProvider
		model       string
		wantCurrent string
		wantOptions []acp.ConfigOptionValue
	}{
		{
			agentType:   acp.ACPProviderCCDeepSeek,
			model:       "deepseek-v4-pro[1m]",
			wantCurrent: "max",
			wantOptions: []acp.ConfigOptionValue{{Value: "high", Name: "High"}, {Value: "max", Name: "Max"}},
		},
		{
			agentType:   acp.ACPProviderCCGLM,
			model:       "glm-5.2[1m]",
			wantCurrent: "max",
			wantOptions: []acp.ConfigOptionValue{{Value: "high", Name: "High"}, {Value: "max", Name: "Max"}},
		},
		{
			agentType:   acp.ACPProviderCCKimi,
			model:       "k3[1m]",
			wantCurrent: "high",
			wantOptions: []acp.ConfigOptionValue{
				{Value: "low", Name: "Low"},
				{Value: "high", Name: "High"},
				{Value: "max", Name: "Max"},
			},
		},
		{
			agentType:   acp.ACPProviderCCQwen,
			model:       "qwen3.8-max",
			wantCurrent: "default",
			wantOptions: []acp.ConfigOptionValue{
				{Value: "default", Name: "Default"},
				{Value: "low", Name: "Low"},
				{Value: "medium", Name: "Medium"},
				{Value: "high", Name: "High"},
				{Value: "xhigh", Name: "Xhigh"},
				{Value: "max", Name: "Max"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(string(tt.agentType), func(t *testing.T) {
			store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
			if err != nil {
				t.Fatalf("NewStore: %v", err)
			}
			defer store.Close()

			claudeEffort := acp.ConfigOption{
				ID:           "effort",
				Category:     acp.ConfigOptionCategoryThoughtLv,
				CurrentValue: "default",
				Options: []acp.ConfigOptionValue{
					{Value: "default", Name: "Default"},
					{Value: "low", Name: "Low"},
					{Value: "medium", Name: "Medium"},
					{Value: "high", Name: "High"},
					{Value: "xhigh", Name: "Xhigh"},
					{Value: "max", Name: "Max"},
				},
			}
			inst := &testInjectedInstance{
				name: string(tt.agentType),
				newResult: &acp.SessionNewResult{
					SessionID: "acp-new",
					ConfigOptions: []acp.ConfigOption{
						{
							ID:           acp.ConfigOptionIDModel,
							Category:     acp.ConfigOptionCategoryModel,
							CurrentValue: tt.model,
						},
						claudeEffort,
					},
				},
			}
			inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
				claudeEffort.CurrentValue = p.Value
				return []acp.ConfigOption{claudeEffort}, nil
			}
			client := New(store, "proj1", t.TempDir())
			client.registry = agent.NewACPFactory()
			client.registry.Register(tt.agentType, func(context.Context, string) (agent.Instance, error) {
				return inst, nil
			})

			sess, err := client.CreateSession(context.Background(), string(tt.agentType), "")
			if err != nil {
				t.Fatalf("CreateSession: %v", err)
			}
			effort := configOptionByID(sess.CurrentConfigOptions(), "effort")
			if effort == nil {
				t.Fatal("effort option is missing")
			}
			if effort.CurrentValue != tt.wantCurrent {
				t.Fatalf("effort current value = %q, want %q", effort.CurrentValue, tt.wantCurrent)
			}
			if !reflect.DeepEqual(effort.Options, tt.wantOptions) {
				t.Fatalf("effort options = %#v, want %#v", effort.Options, tt.wantOptions)
			}
		})
	}
}

func TestNormalizeStoredClaudeCompatibleEffortPreferences(t *testing.T) {
	tests := []struct {
		name      string
		agentType acp.ACPProvider
		input     string
		want      string
	}{
		{name: "deepseek low", agentType: acp.ACPProviderCCDeepSeek, input: "low", want: "high"},
		{name: "deepseek xhigh", agentType: acp.ACPProviderCCDeepSeek, input: "xhigh", want: "max"},
		{name: "glm medium", agentType: acp.ACPProviderCCGLM, input: "medium", want: "high"},
		{name: "kimi low", agentType: acp.ACPProviderCCKimi, input: "low", want: "low"},
		{name: "kimi medium", agentType: acp.ACPProviderCCKimi, input: "medium", want: "high"},
		{name: "kimi xhigh", agentType: acp.ACPProviderCCKimi, input: "xhigh", want: "max"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeStoredConfigPreferences(string(tt.agentType), []PreferenceConfigOption{{
				ID:           "effort",
				CurrentValue: tt.input,
			}})
			if len(got) != 1 || got[0].CurrentValue != tt.want {
				t.Fatalf("normalized preferences = %#v, want effort=%q", got, tt.want)
			}
		})
	}
}

func TestCreateSession_KimiSkipsLegacyThinkingForNewVersion(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	if err := store.SaveAgentPreference(context.Background(), AgentPreferenceRecord{
		ProjectName: "proj1",
		AgentType:   string(acp.ACPProviderKimi),
		PreferenceJSON: string(mustJSON(PreferenceState{ConfigOptions: []PreferenceConfigOption{{
			ID:           "thinking",
			CurrentValue: "on",
		}}})),
	}); err != nil {
		t.Fatalf("SaveAgentPreference: %v", err)
	}

	inst := &testInjectedInstance{
		name: "kimi",
		initResult: acp.InitializeResult{
			ProtocolVersion: "0.1",
			AgentInfo:       &acp.AgentInfo{Name: "kimi", Version: "0.31.1"},
		},
		newResult: &acp.SessionNewResult{
			SessionID: "acp-new",
			ConfigOptions: []acp.ConfigOption{{
				ID:           "thinking",
				Category:     acp.ConfigOptionCategoryThoughtLv,
				CurrentValue: "high",
			}},
		},
	}

	client := New(store, "proj1", t.TempDir())
	client.registry = agent.NewACPFactory()
	client.registry.Register(acp.ACPProviderKimi, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	if _, err := client.CreateSession(context.Background(), string(acp.ACPProviderKimi), ""); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if len(inst.setCalls) != 0 {
		t.Fatalf("set calls = %v, want no legacy thinking replay", inst.setCalls)
	}
}

func TestFilterStoredConfigOptionsForAgent_KimiLegacyThinkingValues(t *testing.T) {
	tests := []struct {
		name      string
		agentName string
		version   string
		value     string
		wantKept  bool
	}{
		{name: "new on", agentName: "kimi", version: "0.31.1", value: "on", wantKept: false},
		{name: "new off", agentName: "kimi", version: "0.31.1", value: "off", wantKept: false},
		{name: "legacy version", agentName: "kimi", version: "0.27.0", value: "on", wantKept: true},
		{name: "other agent", agentName: "cc-kimi", version: "0.31.1", value: "on", wantKept: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := filterStoredConfigOptionsForAgent(tt.agentName, &acp.AgentInfo{Version: tt.version}, []PreferenceConfigOption{{
				ID:           "thinking",
				CurrentValue: tt.value,
			}})
			if (len(got) == 1) != tt.wantKept {
				t.Fatalf("filtered preferences = %#v, want kept=%v", got, tt.wantKept)
			}
		})
	}
}

func TestCreateSession_CCGLMMapsStoredClaudeEffortToActualLevel(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	if err := store.SaveAgentPreference(context.Background(), AgentPreferenceRecord{
		ProjectName: "proj1",
		AgentType:   string(acp.ACPProviderCCGLM),
		PreferenceJSON: string(mustJSON(PreferenceState{ConfigOptions: []PreferenceConfigOption{{
			ID:           "effort",
			CurrentValue: "low",
		}}})),
	}); err != nil {
		t.Fatalf("SaveAgentPreference: %v", err)
	}

	inst := &testInjectedInstance{
		name: string(acp.ACPProviderCCGLM),
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{},
		},
		newResult: &acp.SessionNewResult{
			SessionID: "acp-new",
			ConfigOptions: []acp.ConfigOption{{
				ID:           "effort",
				Category:     acp.ConfigOptionCategoryThoughtLv,
				CurrentValue: "default",
			}},
		},
	}
	client := New(store, "proj1", t.TempDir())
	client.registry = agent.NewACPFactory()
	client.registry.Register(acp.ACPProviderCCGLM, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	sess, err := client.CreateSession(context.Background(), string(acp.ACPProviderCCGLM), "")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if len(inst.setCalls) != 0 {
		t.Fatalf("set calls = %v, want none when stored low and ACP default both map to GLM high", inst.setCalls)
	}
	if got := findCurrentValue(sess.CurrentConfigOptions(), "effort"); got != "high" {
		t.Fatalf("effort = %q, want normalized stored effort high", got)
	}
}

func TestCreateSession_ClaudeCompatibleDefaultEffortSkipsUnsupportedOption(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()
	inst := &testInjectedInstance{
		name: string(acp.ACPProviderCCDeepSeek),
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{},
		},
		newResult: &acp.SessionNewResult{SessionID: "acp-new"},
	}
	client := New(store, "proj1", t.TempDir())
	client.registry = agent.NewACPFactory()
	client.registry.Register(acp.ACPProviderCCDeepSeek, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	if _, err := client.CreateSession(context.Background(), string(acp.ACPProviderCCDeepSeek), ""); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if len(inst.setCalls) != 0 {
		t.Fatalf("set calls = %v, want none when effort is unsupported", inst.setCalls)
	}
}

func TestEnsureReady_SessionLoadSuccess_ReplaysStoredConfigValuesByID(t *testing.T) {
	s := mustNewSession(t, "acp-old", "/tmp", "claude")
	s.projectName = "proj1"
	s.agentState = SessionAgentState{
		ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
			{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "high"},
			{ID: "custom_toggle", CurrentValue: "persisted-custom"},
		},
	}

	inst := &testInjectedInstance{
		name:      "claude",
		sessionID: "acp-old",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{LoadSession: true},
		},
		loadResult: acp.SessionLoadResult{ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "ask"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-4o-mini"},
			{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "low"},
			{ID: "custom_toggle", CurrentValue: "agent-custom"},
		}},
	}
	inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		switch p.ConfigID {
		case acp.ConfigOptionIDMode:
			return []acp.ConfigOption{
				{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: p.Value},
				{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-4o-mini"},
				{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "low"},
				{ID: "custom_toggle", CurrentValue: "agent-custom"},
			}, nil
		case acp.ConfigOptionIDModel:
			return []acp.ConfigOption{
				{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
				{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: p.Value},
				{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "low"},
				{ID: "custom_toggle", CurrentValue: "agent-custom"},
			}, nil
		case acp.ConfigOptionIDThoughtLevel:
			return []acp.ConfigOption{
				{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
				{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
				{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: p.Value},
				{ID: "custom_toggle", CurrentValue: "agent-custom"},
			}, nil
		case "custom_toggle":
			return []acp.ConfigOption{
				{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
				{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
				{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "high"},
				{ID: "custom_toggle", CurrentValue: p.Value},
			}, nil
		default:
			return nil, errors.New("unexpected config id")
		}
	}

	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}
	if err := s.ensureReady(context.Background()); err != nil {
		t.Fatalf("ensureReady: %v", err)
	}

	s.mu.Lock()
	state := cloneSessionAgentState(&s.agentState)
	s.mu.Unlock()
	if state == nil {
		t.Fatal("currentAgentStateSnapshot returned nil state")
	}
	if findCurrentValue(state.ConfigOptions, "custom_toggle") != "persisted-custom" {
		t.Fatalf("custom_toggle should restore persisted value")
	}
	if got := len(inst.setCalls); got != 4 {
		t.Fatalf("set calls = %d, want 4", got)
	}
}
func TestCancelPrompt_DoesNotClearSessionConfig(t *testing.T) {
	s := mustNewSession(t, "cancel-keep-config", "/tmp", "claude")
	s.ready = true
	s.agentState = SessionAgentState{
		ConfigOptions: []acp.ConfigOption{
			{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, Category: acp.ConfigOptionCategoryModel, CurrentValue: "gpt-5"},
			{ID: acp.ConfigOptionIDThoughtLevel, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "high"},
		},
	}
	s.instance = &testInjectedInstance{name: "claude"}

	if err := s.cancelPrompt(); err != nil {
		t.Fatalf("cancelPrompt: %v", err)
	}

	s.mu.Lock()
	opts := append([]acp.ConfigOption(nil), s.agentState.ConfigOptions...)
	s.mu.Unlock()
	if findCurrentValue(opts, acp.ConfigOptionIDMode) != "code" ||
		findCurrentValue(opts, acp.ConfigOptionIDModel) != "gpt-5" ||
		findCurrentValue(opts, acp.ConfigOptionIDThoughtLevel) != "high" {
		t.Fatalf("config after cancel = %+v", opts)
	}
}

func TestCancelPromptSendsSessionCancelBeforeCancellingPromptContext(t *testing.T) {
	s := mustNewSession(t, "cancel-order", "/tmp", "claude")
	s.ready = true

	var mu sync.Mutex
	order := []string{}
	record := func(label string) {
		mu.Lock()
		defer mu.Unlock()
		order = append(order, label)
	}

	s.prompt.cancel = func() { record("context") }
	s.instance = &testInjectedInstance{
		name: "claude",
		cancelFn: func() error {
			record("session")
			return nil
		},
	}

	if err := s.cancelPrompt(); err != nil {
		t.Fatalf("cancelPrompt: %v", err)
	}
	mu.Lock()
	got := append([]string(nil), order...)
	mu.Unlock()
	want := []string{"session", "context"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("cancel order=%v, want %v", got, want)
	}
}

func TestEnsureReady_SessionLoadSuccess_AgentCommandsOverrideCachedCommands(t *testing.T) {
	s := mustNewSession(t, "acp-1", "/tmp", "claude")
	s.projectName = "proj1"
	s.agentState = SessionAgentState{
		Commands: []acp.AvailableCommand{{Name: "/cached"}},
	}

	inst := &testInjectedInstance{
		name:      "claude",
		sessionID: "acp-1",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{LoadSession: true},
		},
		loadResult: acp.SessionLoadResult{ConfigOptions: []acp.ConfigOption{{ID: acp.ConfigOptionIDMode, Category: acp.ConfigOptionCategoryMode, CurrentValue: "code"}}},
		loadUpdates: []acp.SessionUpdateParams{{
			SessionID: "acp-1",
			Update: acp.SessionUpdate{
				SessionUpdate:     acp.SessionUpdateAvailableCommandsUpdate,
				AvailableCommands: []acp.AvailableCommand{{Name: "/agent"}},
			},
		}},
	}

	s.registry = agent.DefaultACPFactory().Clone()
	s.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})

	if err := s.ensureInstance(context.Background()); err != nil {
		t.Fatalf("ensureInstance: %v", err)
	}

	if err := s.ensureReady(context.Background()); err != nil {
		t.Fatalf("ensureReady: %v", err)
	}

	s.mu.Lock()
	state := cloneSessionAgentState(&s.agentState)
	s.mu.Unlock()
	if state == nil {
		t.Fatal("currentAgentStateSnapshot returned nil state")
	}
	if got := len(state.Commands); got != 1 {
		t.Fatalf("commands = %d, want 1", got)
	}
	if got := state.Commands[0].Name; got != "/agent" {
		t.Fatalf("command = %q, want /agent", got)
	}
}

func TestAvailableCommandsUpdateCanClearCachedCommands(t *testing.T) {
	s := mustNewSession(t, "acp-commands-clear", "/tmp", "claude")
	s.agentState.Commands = []acp.AvailableCommand{{Name: "compact"}}
	s.SessionUpdate(acp.SessionUpdateParams{
		SessionID: s.acpSessionID,
		Update: acp.SessionUpdate{
			SessionUpdate:     acp.SessionUpdateAvailableCommandsUpdate,
			AvailableCommands: []acp.AvailableCommand{},
		},
	})
	s.mu.Lock()
	commands := append([]acp.AvailableCommand(nil), s.agentState.Commands...)
	s.mu.Unlock()
	if len(commands) != 0 {
		t.Fatalf("commands=%#v, want cleared", commands)
	}
}

func TestStoreAgentPreferenceRoundTrip(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	pref := PreferenceState{
		ConfigOptions: []PreferenceConfigOption{
			{ID: acp.ConfigOptionIDMode, CurrentValue: "code"},
			{ID: acp.ConfigOptionIDModel, CurrentValue: "gpt-5"},
			{ID: acp.ConfigOptionIDThoughtLevel, CurrentValue: "high"},
		},
		UpdatedAt: "2026-04-11T00:00:00Z",
	}
	raw, err := json.Marshal(pref)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := store.SaveAgentPreference(context.Background(), AgentPreferenceRecord{
		ProjectName:    "proj1",
		AgentType:      "codex",
		PreferenceJSON: string(raw),
	}); err != nil {
		t.Fatalf("SaveAgentPreference: %v", err)
	}

	loaded, err := store.LoadAgentPreference(context.Background(), "proj1", "codex")
	if err != nil {
		t.Fatalf("LoadAgentPreference: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadAgentPreference: nil, want preference")
	}
	var decoded PreferenceState
	if err := json.Unmarshal([]byte(loaded.PreferenceJSON), &decoded); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if got := len(decoded.ConfigOptions); got != 3 {
		t.Fatalf("decoded config option count = %d, want 3", got)
	}
	if decoded.ConfigOptions[0].ID != acp.ConfigOptionIDMode || decoded.ConfigOptions[0].CurrentValue != "code" {
		t.Fatalf("decoded config[0] = %+v", decoded.ConfigOptions[0])
	}
	if decoded.ConfigOptions[1].ID != acp.ConfigOptionIDModel || decoded.ConfigOptions[1].CurrentValue != "gpt-5" {
		t.Fatalf("decoded config[1] = %+v", decoded.ConfigOptions[1])
	}
	if decoded.ConfigOptions[2].ID != acp.ConfigOptionIDThoughtLevel || decoded.ConfigOptions[2].CurrentValue != "high" {
		t.Fatalf("decoded config[2] = %+v", decoded.ConfigOptions[2])
	}
}

func TestStoreProjectDefaultAgentRoundTrip(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	if err := store.SaveProjectDefaultAgent(context.Background(), "proj1", "claude"); err != nil {
		t.Fatalf("SaveProjectDefaultAgent: %v", err)
	}
	got, err := store.LoadProjectDefaultAgent(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if got != "claude" {
		t.Fatalf("default agent = %q, want claude", got)
	}
}

func TestApplyStoredConfigOptions_ReplaysByExactConfigID(t *testing.T) {
	inst := &testInjectedInstance{name: "agent"}
	inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		return []acp.ConfigOption{
			{ID: p.ConfigID, CurrentValue: p.Value},
		}, nil
	}

	current := []acp.ConfigOption{
		{ID: "mode", CurrentValue: "ask"},
		{ID: "custom_toggle", CurrentValue: "off"},
	}
	target := []PreferenceConfigOption{
		{ID: "mode", CurrentValue: "code"},
		{ID: "custom_toggle", CurrentValue: "on"},
	}
	updated := applyStoredConfigOptions(context.Background(), "proj1", inst, "sess-1", current, target)

	if got := len(inst.setCalls); got != 2 {
		t.Fatalf("set calls = %d, want 2", got)
	}
	if inst.setCalls[0].ConfigID != "mode" || inst.setCalls[0].Value != "code" {
		t.Fatalf("set call[0] = %+v", inst.setCalls[0])
	}
	if inst.setCalls[1].ConfigID != "custom_toggle" || inst.setCalls[1].Value != "on" {
		t.Fatalf("set call[1] = %+v", inst.setCalls[1])
	}
	if got := findCurrentValue(updated, "mode"); got != "code" {
		t.Fatalf("updated mode = %q, want %q", got, "code")
	}
	if got := findCurrentValue(updated, "custom_toggle"); got != "on" {
		t.Fatalf("updated custom_toggle = %q, want %q", got, "on")
	}
}

func TestApplyStoredConfigOptionsMigratesFlickerLegacyEffort(t *testing.T) {
	inst := &testInjectedInstance{name: "flicker"}
	inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		if p.ConfigID != "thought_level" {
			t.Fatalf("config id=%q, want thought_level", p.ConfigID)
		}
		if p.Value != "xhigh" {
			t.Fatalf("config value=%q, want xhigh", p.Value)
		}
		return []acp.ConfigOption{{ID: p.ConfigID, CurrentValue: p.Value}}, nil
	}

	current := []acp.ConfigOption{{ID: "thought_level", CurrentValue: "low"}}
	target := normalizeStoredConfigPreferences("flicker", []PreferenceConfigOption{{
		ID:           "effort",
		CurrentValue: "maxOrXhigh",
	}})
	updated := applyStoredConfigOptions(context.Background(), "proj", inst, "session-1", current, target)

	if got := findCurrentValue(updated, "thought_level"); got != "xhigh" {
		t.Fatalf("thought_level=%q, want xhigh", got)
	}
}

func TestSessionSetConfigOption_ResolvesCategoryAliasToOptionID(t *testing.T) {
	inst := &testInjectedInstance{name: "codex", alive: true}
	inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		return []acp.ConfigOption{
			{ID: acp.ConfigOptionIDReasoningEffort, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: p.Value},
		}, nil
	}
	s := mustNewSession(t, "sess-config-alias", t.TempDir(), string(acp.ACPProviderCodex))
	s.mu.Lock()
	s.instance = inst
	s.ready = true
	s.acpSessionID = "thread-1"
	s.agentState.ConfigOptions = []acp.ConfigOption{
		{ID: acp.ConfigOptionIDReasoningEffort, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "medium"},
	}
	s.mu.Unlock()

	opts, err := s.SetConfigOption(context.Background(), acp.ConfigOptionIDThoughtLevel, "high")
	if err != nil {
		t.Fatalf("SetConfigOption: %v", err)
	}
	if len(inst.setCalls) != 1 {
		t.Fatalf("set calls=%d, want 1", len(inst.setCalls))
	}
	if inst.setCalls[0].ConfigID != acp.ConfigOptionIDReasoningEffort {
		t.Fatalf("config id sent=%q, want %q", inst.setCalls[0].ConfigID, acp.ConfigOptionIDReasoningEffort)
	}
	if got := findCurrentValue(opts, acp.ConfigOptionIDReasoningEffort); got != "high" {
		t.Fatalf("reasoning_effort=%q, want high", got)
	}
}

func TestSessionSetConfigOption_ClaudeCompatibleProvidersMapEffortToActualLevel(t *testing.T) {
	tests := []struct {
		name      string
		agentType acp.ACPProvider
		input     string
		want      string
	}{
		{name: "deepseek low", agentType: acp.ACPProviderCCDeepSeek, input: "low", want: "high"},
		{name: "deepseek xhigh", agentType: acp.ACPProviderCCDeepSeek, input: "xhigh", want: "max"},
		{name: "glm xhigh", agentType: acp.ACPProviderCCGLM, input: "xhigh", want: "max"},
		{name: "kimi low", agentType: acp.ACPProviderCCKimi, input: "low", want: "low"},
		{name: "kimi medium", agentType: acp.ACPProviderCCKimi, input: "medium", want: "high"},
		{name: "kimi xhigh", agentType: acp.ACPProviderCCKimi, input: "xhigh", want: "max"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst := &testInjectedInstance{name: string(tt.agentType), alive: true}
			s := mustNewSession(t, "sess-effort", t.TempDir(), string(tt.agentType))
			s.mu.Lock()
			s.instance = inst
			s.ready = true
			s.agentState.ConfigOptions = []acp.ConfigOption{{
				ID:           "effort",
				Category:     acp.ConfigOptionCategoryThoughtLv,
				CurrentValue: "high",
			}}
			s.mu.Unlock()

			opts, err := s.SetConfigOption(context.Background(), "effort", tt.input)
			if err != nil {
				t.Fatalf("SetConfigOption: %v", err)
			}
			if len(inst.setCalls) != 1 || inst.setCalls[0].Value != tt.want {
				t.Fatalf("set calls = %+v, want effort %q", inst.setCalls, tt.want)
			}
			if got := findCurrentValue(opts, "effort"); got != tt.want {
				t.Fatalf("effort = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestApplyStoredConfigOptions_ReplaysByCategoryAlias(t *testing.T) {
	inst := &testInjectedInstance{name: "codex"}
	inst.setConfigFn = func(_ context.Context, p acp.SessionSetConfigOptionParams) ([]acp.ConfigOption, error) {
		return []acp.ConfigOption{
			{ID: p.ConfigID, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: p.Value},
		}, nil
	}

	current := []acp.ConfigOption{
		{ID: acp.ConfigOptionIDReasoningEffort, Category: acp.ConfigOptionCategoryThoughtLv, CurrentValue: "medium"},
	}
	target := []PreferenceConfigOption{
		{ID: acp.ConfigOptionIDThoughtLevel, CurrentValue: "high"},
	}
	updated := applyStoredConfigOptions(context.Background(), "proj1", inst, "thread-1", current, target)

	if got := len(inst.setCalls); got != 1 {
		t.Fatalf("set calls = %d, want 1", got)
	}
	if inst.setCalls[0].ConfigID != acp.ConfigOptionIDReasoningEffort {
		t.Fatalf("set call = %+v, want reasoning_effort", inst.setCalls[0])
	}
	if got := findCurrentValue(updated, acp.ConfigOptionIDReasoningEffort); got != "high" {
		t.Fatalf("updated reasoning_effort = %q, want high", got)
	}
}

func TestStoreProjectDefaultAgentMissingReturnsEmpty(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	got, err := store.LoadProjectDefaultAgent(context.Background(), "proj-missing")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if got != "" {
		t.Fatalf("default agent = %q, want empty", got)
	}
}

func TestCheckStoreSchemaRejectsLegacyProjectsTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")

	legacyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := legacyDB.Exec(sqliteSchema); err != nil {
		_ = legacyDB.Close()
		t.Fatalf("init schema: %v", err)
	}
	if _, err := legacyDB.Exec(`
		DROP TABLE sessions;
		DROP TABLE IF EXISTS projects;
		CREATE TABLE projects (
			project_name TEXT PRIMARY KEY,
			yolo INTEGER NOT NULL DEFAULT 0,
			agent_state_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			project_name TEXT NOT NULL,
			status INTEGER NOT NULL,
			acp_session_id TEXT NOT NULL DEFAULT '',
			agents_json TEXT NOT NULL DEFAULT '{}',
			title TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			last_active_at TEXT NOT NULL
		);
	`); err != nil {
		_ = legacyDB.Close()
		t.Fatalf("create legacy projects table: %v", err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	err = CheckStoreSchema(dbPath)
	if err == nil {
		t.Fatal("CheckStoreSchema() error = nil, want mismatch for legacy projects/sessions columns")
	}
	if !IsStoreSchemaMismatch(err) {
		t.Fatalf("IsStoreSchemaMismatch(err) = false, err=%v", err)
	}
	if !strings.Contains(err.Error(), `table "projects" columns mismatch`) && !strings.Contains(err.Error(), `table "sessions" columns mismatch`) {
		t.Fatalf("CheckStoreSchema() err = %v, want projects/session schema mismatch", err)
	}
}
func TestCheckStoreSchemaRejectsUnexpectedLegacyTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")

	legacyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := legacyDB.Exec(sqliteSchema); err != nil {
		_ = legacyDB.Close()
		t.Fatalf("init schema: %v", err)
	}
	if _, err := legacyDB.Exec(`
		CREATE TABLE session_messages (
			message_id TEXT PRIMARY KEY,
			project_name TEXT NOT NULL,
			session_id TEXT NOT NULL,
			body TEXT NOT NULL DEFAULT ''
		)
	`); err != nil {
		_ = legacyDB.Close()
		t.Fatalf("create legacy session_messages table: %v", err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	err = CheckStoreSchema(dbPath)
	if err == nil {
		t.Fatal("CheckStoreSchema() error = nil, want mismatch")
	}
	if !IsStoreSchemaMismatch(err) {
		t.Fatalf("IsStoreSchemaMismatch(err) = false, err=%v", err)
	}
	if !strings.Contains(err.Error(), `unexpected table "session_messages"`) {
		t.Fatalf("CheckStoreSchema() err = %v, want unexpected session_messages", err)
	}
}

func TestNewStoreRejectsExistingPartialSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "client.sqlite3")

	legacyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	if _, err := legacyDB.Exec(`
		CREATE TABLE route_bindings (
			project_name TEXT NOT NULL,
			route_key TEXT NOT NULL,
			session_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (project_name, route_key)
		)
	`); err != nil {
		_ = legacyDB.Close()
		t.Fatalf("create partial schema: %v", err)
	}
	if err := legacyDB.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	store, err := NewStore(dbPath)
	if err == nil {
		if store != nil {
			_ = store.Close()
		}
		t.Fatal("NewStore() error = nil, want schema mismatch")
	}
	if !IsStoreSchemaMismatch(err) {
		t.Fatalf("IsStoreSchemaMismatch(err) = false, err=%v", err)
	}
	if !strings.Contains(err.Error(), `missing table "sessions"`) {
		t.Fatalf("NewStore() err = %v, want missing sessions table", err)
	}
}

func TestStoreSessionProjectionRoundTrip(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	rec := &SessionRecord{
		ID:          "sess-1",
		ProjectName: "proj1",
		Status:      SessionActive,
		AgentType:   "claude",
		AgentJSON:   `{"title":"Fix app sessions"}`,

		CreatedAt:    time.Date(2026, 4, 12, 10, 0, 0, 0, time.UTC),
		LastActiveAt: time.Date(2026, 4, 12, 10, 5, 0, 0, time.UTC),
		Title:        "Fix app sessions",
	}

	if err := store.SaveSession(context.Background(), rec); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	loaded, err := store.LoadSession(context.Background(), "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if loaded.Title != "Fix app sessions" {
		t.Fatalf("LoadSession().Title = %q, want %q", loaded.Title, "Fix app sessions")
	}

	entries, err := store.ListSessions(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("ListSessions() len = %d, want 1", len(entries))
	}
	if entries[0].Title != "Fix app sessions" {
		t.Fatalf("ListSessions()[0].Title = %q, want %q", entries[0].Title, "Fix app sessions")
	}
}

func TestStoreSessionSyncJSONRoundTrip(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	want := `{"latestPersistedTurnIndex":4}`
	rec := &SessionRecord{
		ID:              "sess-sync",
		ProjectName:     "proj1",
		Status:          SessionActive,
		AgentType:       "claude",
		AgentJSON:       `{}`,
		SessionSyncJSON: want,
		CreatedAt:       time.Date(2026, 4, 12, 10, 0, 0, 0, time.UTC),
		LastActiveAt:    time.Date(2026, 4, 12, 10, 5, 0, 0, time.UTC),
	}

	if err := store.SaveSession(context.Background(), rec); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	loaded, err := store.LoadSession(context.Background(), "proj1", "sess-sync")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if loaded.SessionSyncJSON != want {
		t.Fatalf("LoadSession().SessionSyncJSON = %q, want %q", loaded.SessionSyncJSON, want)
	}

	entries, err := store.ListSessions(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("ListSessions() len = %d, want 1", len(entries))
	}
	if entries[0].SessionSyncJSON != want {
		t.Fatalf("ListSessions()[0].SessionSyncJSON = %q, want %q", entries[0].SessionSyncJSON, want)
	}
}

func TestStoreSessionSyncJSONSurvivesMetadataSave(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	want := `{"latestPersistedTurnIndex":4}`
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:              "sess-sync",
		ProjectName:     "proj1",
		Status:          SessionActive,
		AgentType:       "claude",
		AgentJSON:       `{}`,
		SessionSyncJSON: want,
		CreatedAt:       time.Date(2026, 4, 12, 10, 0, 0, 0, time.UTC),
		LastActiveAt:    time.Date(2026, 4, 12, 10, 5, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("SaveSession initial: %v", err)
	}

	if err := store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-sync",
		ProjectName:  "proj1",
		Status:       SessionActive,
		AgentType:    "claude",
		AgentJSON:    `{}`,
		Title:        "Updated Title",
		LastActiveAt: time.Date(2026, 4, 12, 10, 6, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("SaveSession metadata: %v", err)
	}

	loaded, err := store.LoadSession(ctx, "proj1", "sess-sync")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded.SessionSyncJSON != want {
		t.Fatalf("SessionSyncJSON = %q, want %q", loaded.SessionSyncJSON, want)
	}
}

func TestSessionReadUsesFinishedTurnCursor(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	seedPromptWithTurns(t, c, ctx, "sess-1", "hello", []acp.SessionUpdate{
		{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"})},
	})

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 1)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want 2", len(turns))
	}
	for _, turn := range turns {
		if turn.TurnIndex <= 1 {
			t.Fatalf("returned turn before cursor: %#v", turn)
		}
	}
}

func TestStartingNextPromptSynthesizesInterruptedPromptDone(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Interrupted Prompt")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "first", nil)); err != nil {
		t.Fatalf("RecordEvent first prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "second", nil)); err != nil {
		t.Fatalf("RecordEvent second prompt: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if !hasPromptDoneTurnWithStopReason(t, turns, "interrupted") {
		t.Fatalf("turns missing interrupted prompt_done: %#v", turns)
	}
}

func newSessionViewTestClient(t *testing.T) *Client {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := New(store, "proj1", t.TempDir())
	c.SetSessionViewSink(c)
	t.Cleanup(func() {
		_ = c.Close()
	})
	return c
}

func TestNewWithRuntimeUsesConfiguredFactoryAndStateDir(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	factory := agent.NewACPFactory()
	stateDir := filepath.Join(t.TempDir(), "state")
	c := NewWithRuntime(store, "proj1", t.TempDir(), RuntimeConfig{
		AgentFactory: factory,
		StateDir:     stateDir,
	})
	defer c.Close()

	if c.registry != factory {
		t.Fatalf("Client registry = %p, want configured factory %p", c.registry, factory)
	}
	if c.stateDir != stateDir {
		t.Fatalf("Client stateDir = %q, want %q", c.stateDir, stateDir)
	}
}

func addRuntimeSession(c *Client, sessionID, title, agent string, createdAt, lastActiveAt time.Time) {
	sess, err := c.newWiredSession(sessionID, agent)
	if err != nil {
		panic(err)
	}
	sess.mu.Lock()
	sess.acpSessionID = sessionID
	sess.agentState.Title = title
	sess.Status = SessionActive
	sess.createdAt = createdAt
	sess.lastActiveAt = lastActiveAt
	sess.mu.Unlock()

	c.mu.Lock()
	c.sessions[sess.acpSessionID] = sess
	c.mu.Unlock()
}

func sessionViewCreatedEvent(sessionID, title string) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionNew, map[string]any{
			"params": map[string]any{
				"sessionId": sessionID,
				"agentType": "claude",
				"title":     title,
			},
		}),
	}
}

type testSessionTitleFacts struct {
	First  string `json:"first"`
	Last   string `json:"last"`
	Manual string `json:"manual"`
}

func decodeSessionTitleFacts(t *testing.T, raw string) testSessionTitleFacts {
	t.Helper()
	var facts testSessionTitleFacts
	if err := json.Unmarshal([]byte(raw), &facts); err != nil {
		t.Fatalf("json.Unmarshal title facts %q: %v", raw, err)
	}
	return facts
}

func sessionViewPromptEvent(sessionID, text string, blocks []acp.ContentBlock) SessionViewEvent {
	params := acp.SessionPromptParams{SessionID: sessionID}
	if len(blocks) > 0 {
		params.Prompt = cloneSessionContentBlocks(blocks)
	} else {
		params.Prompt = []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: text}}
	}
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"params": params,
		}),
	}
}

func sessionViewUpdateEvent(sessionID string, update acp.SessionUpdate) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
			"params": acp.SessionUpdateParams{
				SessionID: sessionID,
				Update:    update,
			},
		}),
	}
}

func sessionViewAssistantChunkTextEvent(sessionID, text, status string) SessionViewEvent {
	update := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Status:        strings.TrimSpace(status),
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: text}),
	}
	return sessionViewUpdateEvent(sessionID, update)
}

func sessionViewToolUpdatedTextEvent(sessionID, title string) SessionViewEvent {
	update := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCallUpdate,
		ToolCallID:    "call-shared",
		Title:         title,
	}
	return sessionViewUpdateEvent(sessionID, update)
}

func sessionViewPlanUpdatedEvent(sessionID string, entries []acp.PlanEntry) SessionViewEvent {
	return sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdatePlan,
		Entries:       entries,
	})
}
func sessionViewPromptFinishedEvent(sessionID, stopReason string) SessionViewEvent {
	if strings.TrimSpace(stopReason) == "" {
		stopReason = acp.StopReasonEndTurn
	}
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"result": acp.SessionTurnPromptResult{
				StopReason: stopReason,
			},
		}),
	}
}

type testSessionSearchResponse struct {
	SearchID string                    `json:"searchId"`
	Done     bool                      `json:"done"`
	Results  []testSessionSearchResult `json:"results"`
	Errors   []testSessionSearchError  `json:"errors"`
}

type testSessionSearchResult struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId"`
	Source    string `json:"source"`
	TurnIndex int64  `json:"turnIndex,omitempty"`
}

type testSessionSearchError struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId,omitempty"`
	Message   string `json:"message"`
}

func decodeSessionSearchResponseForTest(t *testing.T, resp any) testSessionSearchResponse {
	t.Helper()
	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal session search response: %v", err)
	}
	var out testSessionSearchResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal session search response %s: %v", raw, err)
	}
	return out
}

func waitSessionSearchDoneForTest(t *testing.T, c *Client, ctx context.Context, searchID string) testSessionSearchResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	payload := func() json.RawMessage {
		return json.RawMessage(fmt.Sprintf(`{"action":"query","searchId":%q}`, searchID))
	}
	for {
		resp, err := c.HandleSessionRequest(ctx, "session.search", "proj1", payload())
		if err != nil {
			t.Fatalf("HandleSessionRequest(session.search query): %v", err)
		}
		decoded := decodeSessionSearchResponseForTest(t, resp)
		if decoded.Done {
			return decoded
		}
		if time.Now().After(deadline) {
			t.Fatalf("session search %s did not finish; last response=%#v", searchID, decoded)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func resultBySessionIDForTest(results []testSessionSearchResult, sessionID string) (testSessionSearchResult, bool) {
	for _, result := range results {
		if result.SessionID == sessionID {
			return result, true
		}
	}
	return testSessionSearchResult{}, false
}

func TestHandleSessionRequestSessionSearchFindsTitleAndNewestPrompt(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-title", "Deploy rollout")); err != nil {
		t.Fatalf("RecordEvent title session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-title", "deploy should not be scanned because title matches", nil)); err != nil {
		t.Fatalf("RecordEvent title prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-title", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent title prompt finished: %v", err)
	}

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-prompt", "Plain session")); err != nil {
		t.Fatalf("RecordEvent prompt session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-prompt", "older deploy prompt", nil)); err != nil {
		t.Fatalf("RecordEvent older prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-prompt", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent older prompt finished: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-prompt", "newest deploy prompt", nil)); err != nil {
		t.Fatalf("RecordEvent newest prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-prompt", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent newest prompt finished: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"start","searchId":"search-1","query":"DEPLOY"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.search start): %v", err)
	}
	started := decodeSessionSearchResponseForTest(t, resp)
	if started.SearchID != "search-1" || started.Done {
		t.Fatalf("start response = %#v, want searchId search-1 done=false", started)
	}

	done := waitSessionSearchDoneForTest(t, c, ctx, "search-1")
	if len(done.Errors) != 0 {
		t.Fatalf("search errors = %#v, want none", done.Errors)
	}
	titleResult, ok := resultBySessionIDForTest(done.Results, "sess-title")
	if !ok {
		t.Fatalf("results = %#v, want sess-title", done.Results)
	}
	if titleResult.ProjectID != "proj1" || titleResult.Source != "title" || titleResult.TurnIndex != 0 {
		t.Fatalf("title result = %#v, want project title hit without turnIndex", titleResult)
	}
	promptResult, ok := resultBySessionIDForTest(done.Results, "sess-prompt")
	if !ok {
		t.Fatalf("results = %#v, want sess-prompt", done.Results)
	}
	if promptResult.ProjectID != "proj1" || promptResult.Source != "prompt" || promptResult.TurnIndex != 3 {
		t.Fatalf("prompt result = %#v, want newest prompt turn 3", promptResult)
	}
}

func TestHandleSessionRequestSessionSearchIncludesLivePromptBeforePersistence(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-live", "Live session")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-live", "live search needle", nil)); err != nil {
		t.Fatalf("RecordEvent live prompt: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"start","searchId":"search-live","query":"live search needle"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.search start): %v", err)
	}
	done := waitSessionSearchDoneForTest(t, c, ctx, "search-live")
	if len(done.Errors) != 0 {
		t.Fatalf("search errors = %#v, want none for live prompt", done.Errors)
	}
	result, ok := resultBySessionIDForTest(done.Results, "sess-live")
	if !ok {
		t.Fatalf("results = %#v, want live session match", done.Results)
	}
	if result.Source != "prompt" || result.TurnIndex != 1 {
		t.Fatalf("live prompt result = %#v, want prompt turn 1", result)
	}
}

func TestHandleSessionRequestSessionSearchValidationQueryAndCancel(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"start","searchId":"bad-empty","query":"   "}`)); err == nil {
		t.Fatalf("empty search query unexpectedly succeeded")
	}
	tooLong := strings.Repeat("x", 201)
	payload, err := json.Marshal(map[string]string{"action": "start", "searchId": "bad-long", "query": tooLong})
	if err != nil {
		t.Fatalf("marshal long query payload: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", payload); err == nil {
		t.Fatalf("overlong search query unexpectedly succeeded")
	}
	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"query","searchId":"missing"}`)); err == nil {
		t.Fatalf("query for missing search id unexpectedly succeeded")
	}
	resp, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"cancel","searchId":"missing"}`))
	if err != nil {
		t.Fatalf("cancel missing search id: %v", err)
	}
	cancelled := decodeSessionSearchResponseForTest(t, resp)
	if cancelled.SearchID != "missing" || !cancelled.Done {
		t.Fatalf("cancel response = %#v, want missing done=true", cancelled)
	}
}

func TestHandleSessionRequestSessionSearchIgnoresProtocolFields(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-plain", "Plain")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-plain", "visible user text", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-plain", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"start","searchId":"search-fields","query":"contentBlocks"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.search start): %v", err)
	}
	done := waitSessionSearchDoneForTest(t, c, ctx, "search-fields")
	if len(done.Results) != 0 {
		t.Fatalf("results = %#v, want no matches for JSON protocol field", done.Results)
	}
}

func TestHandleSessionRequestSessionSearchIgnoresToolCalls(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-tool", "Plain")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-tool", "visible user text", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewToolUpdatedTextEvent("sess-tool", "deploy-secret-command")); err != nil {
		t.Fatalf("RecordEvent tool update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-tool", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.search", "proj1", json.RawMessage(`{"action":"start","searchId":"search-tools","query":"deploy-secret-command"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.search start): %v", err)
	}
	done := waitSessionSearchDoneForTest(t, c, ctx, "search-tools")
	if len(done.Results) != 0 {
		t.Fatalf("results = %#v, want no matches for tool calls", done.Results)
	}
}

type publishedSessionEvent struct {
	method  string
	payload map[string]any
}

func captureSessionMessageEvents(t *testing.T, c *Client) *[]publishedSessionEvent {
	t.Helper()
	published := []publishedSessionEvent{}
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, publishedSessionEvent{method: method, payload: body})
		return nil
	})
	return &published
}

func lastPublishedEvent(t *testing.T, published []publishedSessionEvent, method string) map[string]any {
	t.Helper()
	for i := len(published) - 1; i >= 0; i-- {
		if published[i].method == method {
			return published[i].payload
		}
	}
	t.Fatalf("no published event for %s", method)
	return nil
}

func publishedTurnMap(t *testing.T, event map[string]any) map[string]any {
	t.Helper()
	if turn, ok := event["turn"].(map[string]any); ok {
		return turn
	}
	raw, err := json.Marshal(event["turn"])
	if err != nil {
		t.Fatalf("marshal event turn: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal event turn: %v", err)
	}
	return out
}

func decodePublishedTurnMessage(t *testing.T, event map[string]any) sessionViewTurn {
	t.Helper()
	raw, err := json.Marshal(publishedTurnMap(t, event))
	if err != nil {
		t.Fatalf("marshal published turn: %v", err)
	}
	var out sessionViewTurn
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal published turn: %v", err)
	}
	return out
}

func publishedTurnsByMethod(t *testing.T, published []publishedSessionEvent, method string) []sessionViewTurn {
	t.Helper()
	turns := make([]sessionViewTurn, 0)
	for _, event := range published {
		turn := decodePublishedTurnMessage(t, event.payload)
		if decodeSessionTurnMessage(t, turn.Content).Method == method {
			turns = append(turns, turn)
		}
	}
	return turns
}

func decodeSessionTurnMessage(t *testing.T, content string) acp.SessionTurnMessage {
	t.Helper()
	var out acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(content), &out); err != nil {
		t.Fatalf("unmarshal session turn content: %v", err)
	}
	return out
}

type testSessionTurnPlanPayload struct {
	Entries []acp.SessionTurnPlanResult `json:"entries"`
}

func decodePlanPayload(t *testing.T, raw json.RawMessage) testSessionTurnPlanPayload {
	t.Helper()
	var out testSessionTurnPlanPayload
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal plan payload: %v", err)
	}
	return out
}

func sessionSummaryMap(t *testing.T, summary any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal session summary: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal session summary: %v", err)
	}
	return out
}

func writeClaudeSessionFixture(t *testing.T, homeDir, projectDirName, sessionID, cwd, title, assistant string) {
	t.Helper()
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(homeDir, ".claude", "projects"), projectDirName, sessionID, cwd, title, assistant)
}

func writeClaudeSessionFixtureAtProjectsDir(t *testing.T, projectsDir, projectDirName, sessionID, cwd, title, assistant string) {
	t.Helper()
	projectDir := filepath.Join(projectsDir, projectDirName)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", projectDir, err)
	}
	lines := []string{
		fmt.Sprintf(`{"type":"user","message":{"role":"user","content":"%s"},"cwd":%q}`, title, cwd),
		fmt.Sprintf(`{"type":"assistant","message":{"role":"assistant","content":"%s"}}`, assistant),
	}
	sessionPath := filepath.Join(projectDir, sessionID+".jsonl")
	if err := os.WriteFile(sessionPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", sessionPath, err)
	}
}

func writeCodexSessionFixture(t *testing.T, homeDir, sessionID, cwd, title, assistant string) {
	t.Helper()
	writeCodexSessionFixtureAtHome(t, filepath.Join(homeDir, ".codex"), sessionID, cwd, title, assistant)
}

func writeCodexSessionFixtureAtHome(t *testing.T, codexHome, sessionID, cwd, title, assistant string) {
	t.Helper()
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "05", "12")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", sessionDir, err)
	}
	indexLine, err := json.Marshal(map[string]any{
		"id":          sessionID,
		"thread_name": title,
		"updated_at":  "2026-05-12T08:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal codex index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "session_index.jsonl"), append(indexLine, '\n'), 0o644); err != nil {
		t.Fatalf("WriteFile codex index: %v", err)
	}

	metaLine, err := json.Marshal(map[string]any{
		"type": "session_meta",
		"payload": map[string]any{
			"id":  sessionID,
			"cwd": cwd,
		},
	})
	if err != nil {
		t.Fatalf("marshal codex meta: %v", err)
	}
	doneLine, err := json.Marshal(map[string]any{
		"type": "event_msg",
		"payload": map[string]any{
			"type":               "task_complete",
			"last_agent_message": assistant,
		},
	})
	if err != nil {
		t.Fatalf("marshal codex event: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-05-12T08-00-00-"+sessionID+".jsonl")
	content := string(metaLine) + "\n" + string(doneLine) + "\n"
	if err := os.WriteFile(sessionPath, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", sessionPath, err)
	}
}

func sessionViewPermissionRequestedEvent(sessionID, text string, requestID int64, options []acp.PermissionOption) SessionViewEvent {
	params := acp.PermissionRequestParams{
		SessionID: sessionID,
		ToolCall: acp.ToolCallRef{
			ToolCallID: fmt.Sprintf("call-%d", requestID),
			Title:      text,
		},
		Options: cloneSessionPermissionOptions(options),
	}
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodRequestPermission, map[string]any{
			"id":     requestID,
			"params": params,
		}),
	}
}

func sessionViewPermissionResolvedEvent(sessionID string, requestID int64, status string, updatedAt time.Time) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodRequestPermission, map[string]any{
			"id": requestID,
			"result": acp.PermissionResponse{
				Outcome: acp.PermissionResult{Outcome: status},
			},
		}),
		UpdatedAt: updatedAt,
	}
}

func sessionViewSystemEvent(sessionID, text string) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeSystem,
		SessionID: sessionID,
		Content:   text,
	}
}

func sessionViewACPSystemEvent(sessionID, text string) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.SessionTurnMethodSystem, map[string]any{
			"result": text,
		}),
	}
}

func TestParseSessionViewEventSessionUpdateReturnsToolTurnKey(t *testing.T) {
	event := sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCallUpdate,
		ToolCallID:    "call-1",
		Title:         "build",
		Status:        "completed",
	})
	parsed, err := parseSessionViewEvent(event)
	if err != nil {
		t.Fatalf("parseSessionViewEvent: %v", err)
	}
	if !parsed.bMessage {
		t.Fatal("parsed.bMessage = false, want true")
	}
	if parsed.method != acp.SessionTurnMethodToolCall {
		t.Fatalf("parsed.method = %q, want %q", parsed.method, acp.SessionTurnMethodToolCall)
	}
	if parsed.turnKey != "call-1" {
		t.Fatalf("parsed.turnKey = %q, want %q", parsed.turnKey, "call-1")
	}
}

func TestBuildACPContentJSONIncludesMethodAndFields(t *testing.T) {
	raw := acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
		"params": acp.SessionPromptParams{
			SessionID: "sess-1",
			Prompt:    []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "hello"}},
		},
	})

	var doc struct {
		Method string                  `json:"method"`
		Params acp.SessionPromptParams `json:"params"`
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("json.Unmarshal(buildACPContentJSON): %v", err)
	}
	if doc.Method != acp.MethodSessionPrompt {
		t.Fatalf("method = %q, want %q", doc.Method, acp.MethodSessionPrompt)
	}
	if doc.Params.SessionID != "sess-1" {
		t.Fatalf("params.sessionId = %q, want %q", doc.Params.SessionID, "sess-1")
	}
	if len(doc.Params.Prompt) != 1 || strings.TrimSpace(doc.Params.Prompt[0].Text) != "hello" {
		t.Fatalf("params.prompt = %#v, want single text block", doc.Params.Prompt)
	}
}

func TestMergeTurnMessageMergesTypedTextPayload(t *testing.T) {
	merged := mergeTurnMessage(
		sessionTurnMessage{
			sessionID: "sess-1",
			method:    acp.SessionTurnMethodAgentMessage,
			payload:   acp.SessionTurnTextResult{Text: "hello"},
			turnIndex: 2,
		},
		sessionTurnMessage{
			sessionID: "sess-1",
			method:    acp.SessionTurnMethodAgentMessage,
			payload:   acp.SessionTurnTextResult{Text: " world"},
			turnIndex: 2,
		},
		2,
	)
	result, ok := merged.payload.(acp.SessionTurnTextResult)
	if !ok {
		t.Fatalf("merged.payload type = %T, want %T", merged.payload, acp.SessionTurnTextResult{})
	}
	if result.Text != "hello world" {
		t.Fatalf("merged text = %q, want %q", result.Text, "hello world")
	}
}

func TestSessionViewPersistsCompleteTextMetaAndSplitsMetadataBoundaries(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-meta", "Meta")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-meta", "run", nil)); err != nil {
		t.Fatal(err)
	}
	commentaryMeta := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"thirdParty":{"trace":"opaque"}}`)
	finalMeta := json.RawMessage(`{"wm":{"messagePhase":"final_answer"},"other":true}`)
	for _, update := range []acp.SessionUpdate{
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "work"}),
			Meta:          commentaryMeta,
		},
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "ing"}),
			Meta:          commentaryMeta,
		},
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "done"}),
			Meta:          finalMeta,
		},
	} {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-meta", update)); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-meta", "")); err != nil {
		t.Fatal(err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-meta", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 4 {
		t.Fatalf("turns = %d, want prompt + commentary + final + done", len(turns))
	}
	decodeText := func(content string) acp.SessionTurnTextResult {
		t.Helper()
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(content), &message); err != nil {
			t.Fatal(err)
		}
		var result acp.SessionTurnTextResult
		if err := json.Unmarshal(message.Param, &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	commentary := decodeText(turns[1].Content)
	final := decodeText(turns[2].Content)
	if commentary.Text != "working" || !acp.EqualSessionUpdateMeta(commentary.Meta, commentaryMeta) {
		t.Fatalf("commentary = %#v", commentary)
	}
	if final.Text != "done" || !acp.EqualSessionUpdateMeta(final.Meta, finalMeta) {
		t.Fatalf("final = %#v", final)
	}
}

func TestParseSessionViewEventPreservesMetaForTurnProjections(t *testing.T) {
	meta := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"vendor":{"value":1}}`)
	tests := []struct {
		name   string
		update acp.SessionUpdate
		meta   func(parsed parsedSessionViewEvent) json.RawMessage
	}{
		{
			name: "user message",
			update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateUserMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "user"}),
				Meta:          meta,
			},
			meta: func(parsed parsedSessionViewEvent) json.RawMessage {
				return parsed.payload.(acp.SessionTurnUserMessage).Meta
			},
		},
		{
			name: "tool",
			update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateToolCall,
				ToolCallID:    "call-1",
				Title:         "Read",
				Meta:          meta,
			},
			meta: func(parsed parsedSessionViewEvent) json.RawMessage {
				return parsed.payload.(acp.SessionTurnToolResult).Meta
			},
		},
		{
			name: "plan",
			update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdatePlan,
				Entries:       []acp.PlanEntry{{Content: "Run", Status: "pending"}},
				Meta:          meta,
			},
			meta: func(parsed parsedSessionViewEvent) json.RawMessage {
				return parsed.payload.(acp.SessionTurnPlanPayload).Meta
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseSessionViewEvent(sessionViewUpdateEvent("sess-1", tt.update))
			if err != nil {
				t.Fatal(err)
			}
			if got := tt.meta(parsed); !acp.EqualSessionUpdateMeta(got, meta) {
				t.Fatalf("meta = %s, want %s", got, meta)
			}
		})
	}
}

func TestMergeTurnMessagePreservesEarlierMetaWhenUpdateOmitsIt(t *testing.T) {
	meta := json.RawMessage(`{"vendor":{"value":1}}`)
	tests := []struct {
		name     string
		method   string
		existing any
		incoming any
		meta     func(any) json.RawMessage
	}{
		{
			name:     "user message",
			method:   acp.SessionUpdateUserMessageChunk,
			existing: acp.SessionTurnUserMessage{Text: "first", Meta: meta},
			incoming: acp.SessionTurnUserMessage{Text: "second"},
			meta:     func(payload any) json.RawMessage { return payload.(acp.SessionTurnUserMessage).Meta },
		},
		{
			name:     "tool",
			method:   acp.SessionTurnMethodToolCall,
			existing: acp.SessionTurnToolResult{Cmd: "Read", Meta: meta},
			incoming: acp.SessionTurnToolResult{Status: "completed"},
			meta:     func(payload any) json.RawMessage { return payload.(acp.SessionTurnToolResult).Meta },
		},
		{
			name:     "plan",
			method:   acp.SessionTurnMethodAgentPlan,
			existing: acp.SessionTurnPlanPayload{Entries: []acp.SessionTurnPlanResult{{Content: "Old"}}, Meta: meta},
			incoming: acp.SessionTurnPlanPayload{Entries: []acp.SessionTurnPlanResult{{Content: "New"}}},
			meta:     func(payload any) json.RawMessage { return payload.(acp.SessionTurnPlanPayload).Meta },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			merged := mergeTurnMessage(
				sessionTurnMessage{method: tt.method, payload: tt.existing, turnIndex: 1},
				sessionTurnMessage{method: tt.method, payload: tt.incoming, turnIndex: 1},
				1,
			)
			if got := tt.meta(merged.payload); !acp.EqualSessionUpdateMeta(got, meta) {
				t.Fatalf("meta = %s, want %s", got, meta)
			}
		})
	}
}

func TestBuildSessionTurnContentJSONDoesNotTrimSessionTurnMethod(t *testing.T) {
	raw := buildSessionTurnContentJSON("  method.with.space  ", map[string]any{"k": "v"})
	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if msg.Method != "  method.with.space  " {
		t.Fatalf("msg.Method = %q, want %q", msg.Method, "  method.with.space  ")
	}
}

func TestSessionPromptStateUpdateTurnDoesNotTrimFields(t *testing.T) {
	state := newSessionPromptState(1)
	state.updateTurn(sessionTurnMessage{sessionID: "  sid  ", method: "  method  "}, "  key  ")
	if len(state.turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(state.turns))
	}
	if state.turns[0].sessionID != "  sid  " {
		t.Fatalf("turn.SessionID = %q, want %q", state.turns[0].sessionID, "  sid  ")
	}
	if state.turns[0].method != "  method  " {
		t.Fatalf("turn.method = %q, want %q", state.turns[0].method, "  method  ")
	}
	if _, ok := state.turnIndexByKey["  key  "]; !ok {
		t.Fatalf("turnIndexByKey missing exact key %q", "  key  ")
	}
}

func TestCurrentPromptStateLockedReturnsNilWhenMissing(t *testing.T) {
	c := newSessionViewTestClient(t)

	state, err := c.sessionRecorder.currentPromptStateLocked(context.Background(), "sess-missing")
	if err != nil {
		t.Fatalf("currentPromptStateLocked: %v", err)
	}
	if state != nil {
		t.Fatalf("state = %#v, want nil", *state)
	}
}

func TestCurrentPromptStateLockedIgnoresBlankSessionID(t *testing.T) {
	c := newSessionViewTestClient(t)

	state, err := c.sessionRecorder.currentPromptStateLocked(context.Background(), "   ")
	if err != nil {
		t.Fatalf("currentPromptStateLocked blank sessionID: %v", err)
	}
	if state != nil {
		t.Fatalf("state = %#v, want nil", *state)
	}
}

func TestCurrentPromptStateLockedReturnsLiveCachedState(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	c.sessionRecorder.writeMu.Lock()
	cached := newSessionPromptState(1)
	c.sessionRecorder.promptState["sess-live"] = &cached
	c.sessionRecorder.writeMu.Unlock()

	state, err := c.sessionRecorder.currentPromptStateLocked(ctx, "sess-live")
	if err != nil {
		t.Fatalf("currentPromptStateLocked first read: %v", err)
	}
	if state == nil {
		t.Fatal("currentPromptStateLocked first read = nil, want state")
	}
	state.nextTurnIndex = 7

	reloaded, err := c.sessionRecorder.currentPromptStateLocked(ctx, "sess-live")
	if err != nil {
		t.Fatalf("currentPromptStateLocked second read: %v", err)
	}
	if reloaded == nil {
		t.Fatal("currentPromptStateLocked second read = nil, want state")
	}
	if reloaded.nextTurnIndex != 7 {
		t.Fatalf("reloaded.nextTurnIndex = %d, want 7", reloaded.nextTurnIndex)
	}
}

func TestCurrentPromptStateLockedDoesNotRestorePersistedTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 29, 0, 0, 0, 0, time.UTC)

	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-no-restore",
		ProjectName:  "proj1",
		Status:       SessionActive,
		AgentType:    "claude",
		AgentJSON:    `{}`,
		CreatedAt:    now,
		LastActiveAt: now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	state, err := c.sessionRecorder.currentPromptStateLocked(ctx, "sess-no-restore")
	if err != nil {
		t.Fatalf("currentPromptStateLocked: %v", err)
	}
	if state != nil {
		t.Fatalf("state = %#v, want nil", *state)
	}
}

func TestGetTurnIndexUsesGenericTurnKeyIndex(t *testing.T) {
	state := sessionPromptState{
		nextTurnIndex: 3,
		turns: []sessionTurnMessage{
			{turnIndex: 1, method: acp.SessionTurnMethodSystem},
			{turnIndex: 2, method: acp.SessionTurnMethodToolCall},
		},
		turnIndexByKey: map[string]int64{
			"merge-key": 2,
		},
	}

	turnIndex := state.turnIndexByKey["merge-key"]
	if turnIndex != 2 {
		t.Fatalf("turnIndex = %d, want 2", turnIndex)
	}
}

func TestAddMessageTurnMutatesStateInPlace(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	parsed, err := parseSessionViewEvent(sessionViewPromptEvent("sess-1", "say hi", nil))
	if err != nil {
		t.Fatalf("parseSessionViewEvent: %v", err)
	}

	state := newSessionPromptState(1)
	if err := c.sessionRecorder.addMessageTurn(&state, parsed); err != nil {
		t.Fatalf("addMessageTurn: %v", err)
	}

	if state.nextTurnIndex != 2 {
		t.Fatalf("state.nextTurnIndex = %d, want 2", state.nextTurnIndex)
	}
	if len(state.turns) != 1 {
		t.Fatalf("len(state.turns) = %d, want 1", len(state.turns))
	}
	turn := state.turns[0]
	if turn.method != acp.SessionTurnMethodPromptRequest {
		t.Fatalf("turn method = %q, want %q", turn.method, acp.SessionTurnMethodPromptRequest)
	}
}

func TestParseSessionViewEventSeparatesControlAndMessageEvents(t *testing.T) {
	tests := []struct {
		name          string
		event         SessionViewEvent
		wantMessage   bool
		wantACPMethod string
		wantMethod    string
		wantTurnKey   string
		check         func(*testing.T, parsedSessionViewEvent)
	}{
		{
			name:          "session new stays control event",
			event:         sessionViewCreatedEvent("sess-1", "Task"),
			wantMessage:   false,
			wantACPMethod: acp.MethodSessionNew,
		},
		{
			name:          "prompt params becomes prompt message",
			event:         sessionViewPromptEvent("sess-1", "say hi", nil),
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionPrompt,
			wantMethod:    acp.SessionTurnMethodPromptRequest,
			check: func(t *testing.T, parsed parsedSessionViewEvent) {
				t.Helper()
				requestPayload, ok := parsed.payload.(acp.SessionTurnPromptRequest)
				if !ok {
					t.Fatalf("parsed.payload type = %T, want %T", parsed.payload, acp.SessionTurnPromptRequest{})
				}
				if len(requestPayload.ContentBlocks) != 1 || strings.TrimSpace(requestPayload.ContentBlocks[0].Text) != "say hi" {
					t.Fatalf("payload.ContentBlocks = %#v, want single text block", requestPayload.ContentBlocks)
				}
			},
		},
		{
			name:          "prompt result becomes prompt message",
			event:         sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn),
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionPrompt,
			wantMethod:    acp.SessionTurnMethodPromptDone,
			check: func(t *testing.T, parsed parsedSessionViewEvent) {
				t.Helper()
				resultPayload, ok := parsed.payload.(acp.SessionTurnPromptResult)
				if !ok {
					t.Fatalf("parsed.payload type = %T, want %T", parsed.payload, acp.SessionTurnPromptResult{})
				}
				if resultPayload.StopReason != acp.StopReasonEndTurn {
					t.Fatalf("payload.StopReason = %q, want %q", resultPayload.StopReason, acp.StopReasonEndTurn)
				}
			},
		},
		{
			name: "session update becomes turn message",
			event: sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateToolCallUpdate,
				ToolCallID:    "call-1",
				Title:         "build",
				Status:        acp.ToolCallStatusCompleted,
			}),
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionUpdate,
			wantMethod:    acp.SessionTurnMethodToolCall,
			wantTurnKey:   "call-1",
		},
		{
			name:          "permission stays ignored control event",
			event:         sessionViewPermissionRequestedEvent("sess-1", "allow?", 7, nil),
			wantMessage:   false,
			wantACPMethod: acp.MethodRequestPermission,
		},
		{
			name: "ACP event type matching is case-insensitive",
			event: SessionViewEvent{
				Type:      SessionViewEventType("ACP"),
				SessionID: "sess-1",
				Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
					"params": acp.SessionPromptParams{},
				}),
			},
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionPrompt,
			wantMethod:    acp.SessionTurnMethodPromptRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseSessionViewEvent(tt.event)
			if err != nil {
				t.Fatalf("parseSessionViewEvent: %v", err)
			}
			if parsed.bMessage != tt.wantMessage {
				t.Fatalf("parsed.bMessage = %v, want %v", parsed.bMessage, tt.wantMessage)
			}
			if parsed.acpMethod != tt.wantACPMethod {
				t.Fatalf("parsed.acpMethod = %q, want %q", parsed.acpMethod, tt.wantACPMethod)
			}
			if parsed.method != tt.wantMethod {
				t.Fatalf("parsed.method = %q, want %q", parsed.method, tt.wantMethod)
			}
			if parsed.turnKey != tt.wantTurnKey {
				t.Fatalf("parsed.turnKey = %q, want %q", parsed.turnKey, tt.wantTurnKey)
			}
			if tt.check != nil {
				tt.check(t, parsed)
			}
		})
	}
}

func TestParseSessionViewEventSilentlyHandlesMissingParams(t *testing.T) {
	tests := []struct {
		name          string
		event         SessionViewEvent
		wantMessage   bool
		wantACPMethod string
		wantMethod    string
		check         func(*testing.T, parsedSessionViewEvent)
	}{
		{
			name: "prompt without params becomes empty prompt message",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content:   acp.BuildACPContentJSON(acp.MethodSessionPrompt, nil),
			},
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionPrompt,
			wantMethod:    acp.SessionTurnMethodPromptRequest,
			check: func(t *testing.T, parsed parsedSessionViewEvent) {
				t.Helper()
				request, ok := parsed.payload.(acp.SessionTurnPromptRequest)
				if !ok {
					t.Fatalf("parsed.payload type = %T, want acp.SessionTurnPromptRequest", parsed.payload)
				}
				if len(request.ContentBlocks) != 0 {
					t.Fatalf("request.ContentBlocks len = %d, want 0", len(request.ContentBlocks))
				}
			},
		},
		{
			name: "prompt with malformed params becomes empty prompt message",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content:   acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{"params": "oops"}),
			},
			wantMessage:   true,
			wantACPMethod: acp.MethodSessionPrompt,
			wantMethod:    acp.SessionTurnMethodPromptRequest,
			check: func(t *testing.T, parsed parsedSessionViewEvent) {
				t.Helper()
				request, ok := parsed.payload.(acp.SessionTurnPromptRequest)
				if !ok {
					t.Fatalf("parsed.payload type = %T, want acp.SessionTurnPromptRequest", parsed.payload)
				}
				if len(request.ContentBlocks) != 0 {
					t.Fatalf("request.ContentBlocks len = %d, want 0", len(request.ContentBlocks))
				}
			},
		},
		{
			name: "session update without params is ignored without error",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content:   acp.BuildACPContentJSON(acp.MethodSessionUpdate, nil),
			},
			wantMessage:   false,
			wantACPMethod: acp.MethodSessionUpdate,
			wantMethod:    "",
		},
		{
			name: "session update with malformed params is ignored without error",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content:   acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{"params": "oops"}),
			},
			wantMessage:   false,
			wantACPMethod: acp.MethodSessionUpdate,
			wantMethod:    "",
		},
		{
			name: "ACP system without result is ignored without error",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content:   acp.BuildACPContentJSON(acp.SessionTurnMethodSystem, nil),
			},
			wantMessage:   false,
			wantACPMethod: acp.SessionTurnMethodSystem,
			wantMethod:    "",
		},
		{
			name: "ACP system with result is ignored without error",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: "sess-1",
				Content: acp.BuildACPContentJSON(acp.SessionTurnMethodSystem, map[string]any{
					"result": "ignored",
				}),
			},
			wantMessage:   false,
			wantACPMethod: acp.SessionTurnMethodSystem,
			wantMethod:    "",
		},
		{
			name: "legacy system event is ignored without error",
			event: SessionViewEvent{
				Type:      SessionViewEventTypeSystem,
				SessionID: "sess-1",
				Content:   "legacy system",
			},
			wantMessage:   true,
			wantACPMethod: "",
			wantMethod:    acp.SessionTurnMethodSystem,
			check: func(t *testing.T, parsed parsedSessionViewEvent) {
				t.Helper()
				result, ok := parsed.payload.(acp.SessionTurnTextResult)
				if !ok {
					t.Fatalf("parsed.payload type = %T, want acp.SessionTurnTextResult", parsed.payload)
				}
				if strings.TrimSpace(result.Text) != "legacy system" {
					t.Fatalf("result.Text = %q, want %q", result.Text, "legacy system")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseSessionViewEvent(tt.event)
			if err != nil {
				t.Fatalf("parseSessionViewEvent: %v", err)
			}
			if parsed.bMessage != tt.wantMessage {
				t.Fatalf("parsed.bMessage = %v, want %v", parsed.bMessage, tt.wantMessage)
			}
			if parsed.acpMethod != tt.wantACPMethod {
				t.Fatalf("parsed.acpMethod = %q, want %q", parsed.acpMethod, tt.wantACPMethod)
			}
			if parsed.method != tt.wantMethod {
				t.Fatalf("parsed.method = %q, want %q", parsed.method, tt.wantMethod)
			}
			if tt.check != nil {
				tt.check(t, parsed)
			}
		})
	}
}

func TestParseSessionViewEventSessionUpdateUnknownTypeReturnsError(t *testing.T) {
	event := sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: "session/update.unknown",
		Content:       mustJSON(map[string]any{"text": "ignored"}),
	})

	_, err := parseSessionViewEvent(event)
	if err == nil {
		t.Fatal("parseSessionViewEvent error = nil, want unsupported session update type error")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "unsupported session update type") {
		t.Fatalf("parseSessionViewEvent error = %v, want unsupported session update type", err)
	}
}

func TestJSONDecodeAtSupportsTopLevelAndSingleNestedField(t *testing.T) {
	raw := mustJSON(map[string]any{
		"method": "session.update",
		"params": map[string]any{
			"title": "hello",
			"meta":  map[string]any{"title": "too-deep"},
		},
	})

	var method string
	if !jsonDecodeAt(raw, "method", &method) {
		t.Fatal("jsonDecodeAt(method) = false, want true")
	}
	if method != "session.update" {
		t.Fatalf("method = %q, want %q", method, "session.update")
	}

	var title string
	if !jsonDecodeAt(raw, "params.title", &title) {
		t.Fatal("jsonDecodeAt(params.title) = false, want true")
	}
	if title != "hello" {
		t.Fatalf("title = %q, want %q", title, "hello")
	}

	if jsonDecodeAt(raw, "params.meta.title", &title) {
		t.Fatal("jsonDecodeAt(params.meta.title) = true, want false")
	}
}

func TestExtractUpdateTextSupportsExpectedShapes(t *testing.T) {
	if got := extractUpdateText(mustJSON("hello")); got != "hello" {
		t.Fatalf("extractUpdateText(string) = %q, want %q", got, "hello")
	}
	if got := extractUpdateText(mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"})); got != "world" {
		t.Fatalf("extractUpdateText(content block) = %q, want %q", got, "world")
	}
	if got := extractUpdateText(mustJSON(map[string]any{"text": "compat"})); got != "compat" {
		t.Fatalf("extractUpdateText(text map) = %q, want %q", got, "compat")
	}
}

type archiveManifestForTest struct {
	Version  int                                    `json:"version"`
	Sessions map[string]archiveManifestEntryForTest `json:"sessions"`
}

type archiveManifestEntryForTest struct {
	SessionID          string `json:"sessionId"`
	ProjectName        string `json:"projectName"`
	Title              string `json:"title"`
	AgentType          string `json:"agentType"`
	Storage            string `json:"storage"`
	File               string `json:"file"`
	Offset             int64  `json:"offset"`
	Length             int64  `json:"length"`
	UncompressedLength int64  `json:"uncompressedLength"`
	Codec              string `json:"codec"`
	SHA256             string `json:"sha256"`
	UncompressedSHA256 string `json:"uncompressedSha256"`
	TurnCount          int    `json:"turnCount"`
	GapCount           int    `json:"gapCount"`
	WMT2Version        int    `json:"wmt2Version"`
	ChunkSizeCode      int    `json:"chunkSizeCode"`
	ArchivedAt         string `json:"archivedAt"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
	RestoredAt         string `json:"restoredAt"`
	NativeArchivedAt   string `json:"nativeArchivedAt"`
	NativeUnarchivedAt string `json:"nativeUnarchivedAt"`
	NativeSyncWarning  string `json:"nativeSyncWarning"`
}

func readArchiveManifestForTest(t *testing.T, historyRoot, projectName string) archiveManifestForTest {
	t.Helper()
	path := filepath.Join(filepath.Dir(historyRoot), "session-archive", safeHistoryPathPart(projectName), "manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile archive manifest: %v", err)
	}
	var manifest archiveManifestForTest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("Unmarshal archive manifest: %v", err)
	}
	if manifest.Version != 1 {
		t.Fatalf("manifest version = %d, want 1", manifest.Version)
	}
	if manifest.Sessions == nil {
		t.Fatal("manifest sessions map is nil")
	}
	return manifest
}

func readArchivedSessionPayloadForTest(t *testing.T, historyRoot, projectName string, entry archiveManifestEntryForTest) ([]byte, []byte) {
	t.Helper()
	path := filepath.Join(filepath.Dir(historyRoot), "session-archive", safeHistoryPathPart(projectName), entry.File)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile archive pack: %v", err)
	}
	if entry.Offset < 0 || entry.Length <= 0 || entry.Offset+entry.Length > int64(len(raw)) {
		t.Fatalf("archive segment offset/length outside pack: offset=%d length=%d pack=%d", entry.Offset, entry.Length, len(raw))
	}
	segment := raw[entry.Offset : entry.Offset+entry.Length]
	if len(segment) < 26 {
		t.Fatalf("archive segment too short: %d", len(segment))
	}
	if string(segment[0:4]) != "WMSA" {
		t.Fatalf("archive segment magic = %q, want WMSA", string(segment[0:4]))
	}
	if version := binary.LittleEndian.Uint16(segment[4:6]); version != 1 {
		t.Fatalf("archive segment version = %d, want 1", version)
	}
	if codec := segment[6]; codec != 1 {
		t.Fatalf("archive segment codec = %d, want gzip codec 1", codec)
	}
	sessionIDLen := int(binary.LittleEndian.Uint16(segment[8:10]))
	payloadLen := int64(binary.LittleEndian.Uint64(segment[10:18]))
	uncompressedLen := int64(binary.LittleEndian.Uint64(segment[18:26]))
	payloadStart := 26 + sessionIDLen
	payloadEnd := payloadStart + int(payloadLen)
	if payloadStart > len(segment) || payloadEnd != len(segment) {
		t.Fatalf("archive segment payload bounds invalid: start=%d end=%d len=%d", payloadStart, payloadEnd, len(segment))
	}
	if gotSessionID := string(segment[26:payloadStart]); gotSessionID != entry.SessionID {
		t.Fatalf("archive segment sessionID = %q, want %q", gotSessionID, entry.SessionID)
	}
	if uncompressedLen != entry.UncompressedLength {
		t.Fatalf("archive segment uncompressedLen = %d, want %d", uncompressedLen, entry.UncompressedLength)
	}
	compressedPayload := segment[payloadStart:payloadEnd]
	reader, err := gzip.NewReader(bytes.NewReader(compressedPayload))
	if err != nil {
		t.Fatalf("NewReader gzip payload: %v", err)
	}
	defer reader.Close()
	uncompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("ReadAll gzip payload: %v", err)
	}
	if int64(len(uncompressed)) != uncompressedLen {
		t.Fatalf("uncompressed payload len = %d, want %d", len(uncompressed), uncompressedLen)
	}
	return uncompressed, segment
}

func decodeWMT2ContentsForTest(t *testing.T, raw []byte, turnCount int) []string {
	t.Helper()
	if len(raw) < 8 {
		t.Fatalf("WMT2 payload too short: %d", len(raw))
	}
	if string(raw[0:4]) != sessionTurnFileMagic {
		t.Fatalf("WMT2 magic = %q, want %s", string(raw[0:4]), sessionTurnFileMagic)
	}
	if version := binary.LittleEndian.Uint16(raw[4:6]); version != sessionTurnFileVersion {
		t.Fatalf("WMT2 version = %d, want %d", version, sessionTurnFileVersion)
	}
	code := raw[6]
	capacity := 256 << code
	if turnCount > capacity {
		t.Fatalf("turnCount = %d exceeds WMT2 capacity %d", turnCount, capacity)
	}
	headerSize := sessionTurnFilePreambleSize + capacity*sessionTurnFileMetaSize
	if len(raw) < headerSize {
		t.Fatalf("WMT2 payload len = %d, want at least header %d", len(raw), headerSize)
	}
	contents := make([]string, 0, turnCount)
	for slot := 0; slot < turnCount; slot++ {
		pos := sessionTurnFilePreambleSize + slot*sessionTurnFileMetaSize
		offset := binary.LittleEndian.Uint32(raw[pos : pos+4])
		length := binary.LittleEndian.Uint32(raw[pos+4 : pos+8])
		if offset == 0 || length == 0 {
			t.Fatalf("WMT2 slot %d is empty", slot)
		}
		end := int(offset) + int(length)
		if int(offset) < headerSize || end > len(raw) {
			t.Fatalf("WMT2 slot %d points outside payload", slot)
		}
		contents = append(contents, string(raw[int(offset):end]))
	}
	return contents
}

func archiveLongSessionForStoreTest(t *testing.T, c *Client, ctx context.Context, sessionID, title, agentType string, updatedAt time.Time, contents []string) {
	t.Helper()
	if c == nil || c.sessionRecorder == nil || c.sessionRecorder.turnStore == nil {
		t.Fatal("session test client with turn store is required")
	}
	if len(contents) < 3 {
		t.Fatalf("archiveLongSessionForStoreTest requires at least 3 turns, got %d", len(contents))
	}
	if _, err := c.sessionRecorder.turnStore.WriteTurns(ctx, c.projectName, sessionID, 1, contents); err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              sessionID,
		ProjectName:     c.projectName,
		Status:          SessionPersisted,
		AgentType:       agentType,
		Title:           title,
		SessionSyncJSON: sessionSyncJSON(int64(len(contents))),
		CreatedAt:       updatedAt.Add(-time.Hour),
		LastActiveAt:    updatedAt,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	if err := c.ArchiveSession(ctx, sessionID); err != nil {
		t.Fatalf("ArchiveSession(%s): %v", sessionID, err)
	}
}

func TestSessionViewCreatedEventSilentlyHandlesMalformedTitle(t *testing.T) {
	c := newSessionViewTestClient(t)
	event := SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: "sess-1",
		Content:   acp.BuildACPContentJSON(acp.MethodSessionNew, map[string]any{"params": map[string]any{"agentType": "claude", "title": 123}}),
	}

	if err := c.RecordEvent(context.Background(), event); err != nil {
		t.Fatalf("RecordEvent malformed session.create: %v", err)
	}

	sessions, err := c.listSessionViews(context.Background())
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if sessions[0].Title != "" {
		t.Fatalf("sessions[0].Title = %q, want empty", sessions[0].Title)
	}
}

func TestSessionViewAssistantChunksReusePreviousTurnByUpdateType(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "New Session")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "say hi", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewAssistantChunkTextEvent("sess-1", "hello", "")); err != nil {
		t.Fatalf("RecordEvent chunk1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewAssistantChunkTextEvent("sess-1", " world", "")); err != nil {
		t.Fatalf("RecordEvent chunk2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	update2 := decodeTurnSessionUpdate(t, turns[1].Content)
	if text := extractTextChunk(update2.Content); text != "hello world" {
		t.Fatalf("turns[1] text = %q, want %q", text, "hello world")
	}
}

func TestSessionViewListIncludesProjectionFields(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent first prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "latest prompt", nil)); err != nil {
		t.Fatalf("RecordEvent second prompt: %v", err)
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	titleFacts := decodeSessionTitleFacts(t, sessions[0].Title)
	if titleFacts.First != "Task" || titleFacts.Last != "latest prompt" {
		t.Fatalf("title facts = %#v, want first Task and last latest prompt", titleFacts)
	}
}

func TestSessionViewPromptTitleFactsMigrateLegacyTitle(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	addRuntimeSession(c, "sess-legacy", "Legacy Title", "claude", time.Now().UTC().Add(-time.Minute), time.Now().UTC())
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-legacy",
		ProjectName:  "proj1",
		Status:       SessionActive,
		AgentType:    "claude",
		Title:        "Legacy Title",
		CreatedAt:    time.Now().UTC().Add(-time.Minute),
		LastActiveAt: time.Now().UTC().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("SaveSession legacy: %v", err)
	}

	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-legacy", "new prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	titleFacts := decodeSessionTitleFacts(t, sessions[0].Title)
	if titleFacts.First != "Legacy Title" || titleFacts.Last != "new prompt" {
		t.Fatalf("title facts = %#v, want first legacy title and last new prompt", titleFacts)
	}
}

func TestSessionViewPersistSessionDoesNotOverrideLatestPromptTitle(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	now := time.Now().UTC()
	addRuntimeSession(c, "sess-1", "Runtime Title", "claude", now.Add(-2*time.Minute), now)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Created Title")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "latest prompt title", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	sessionsBefore, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews before persist: %v", err)
	}
	if len(sessionsBefore) != 1 {
		t.Fatalf("sessionsBefore len = %d, want 1", len(sessionsBefore))
	}
	beforeFacts := decodeSessionTitleFacts(t, sessionsBefore[0].Title)
	if beforeFacts.First != "Created Title" || beforeFacts.Last != "latest prompt title" {
		t.Fatalf("sessionsBefore title facts = %#v, want first Created Title and last latest prompt title", beforeFacts)
	}

	sess, err := c.SessionByID(ctx, "sess-1")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	sess.mu.Lock()
	sess.agentState.Title = "Stale Runtime Title"
	sess.mu.Unlock()
	if err := sess.persistSession(ctx); err != nil {
		t.Fatalf("persistSession: %v", err)
	}

	sessionsAfter, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews after persist: %v", err)
	}
	if len(sessionsAfter) != 1 {
		t.Fatalf("sessionsAfter len = %d, want 1", len(sessionsAfter))
	}
	afterFacts := decodeSessionTitleFacts(t, sessionsAfter[0].Title)
	if afterFacts.First != "Created Title" || afterFacts.Last != "latest prompt title" {
		t.Fatalf("sessionsAfter title facts = %#v, want first Created Title and last latest prompt title", afterFacts)
	}
}

func TestHandleSessionRequestRenameStoresManualTitleWithoutMovingSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	olderAt := mustRFC3339Time(t, "2026-05-22T01:00:00Z")
	newerAt := mustRFC3339Time(t, "2026-05-22T02:00:00Z")

	oldSession := sessionViewCreatedEvent("sess-old", "Original title")
	oldSession.UpdatedAt = olderAt
	if err := c.RecordEvent(ctx, oldSession); err != nil {
		t.Fatalf("RecordEvent old session: %v", err)
	}
	newSession := sessionViewCreatedEvent("sess-new", "Newer title")
	newSession.UpdatedAt = newerAt
	if err := c.RecordEvent(ctx, newSession); err != nil {
		t.Fatalf("RecordEvent new session: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", json.RawMessage(`{"sessionId":"sess-old","title":"  Manual name  "}`))
	if err != nil {
		t.Fatalf("session.rename: %v", err)
	}
	body := resp.(map[string]any)
	if got := body["ok"]; got != true {
		t.Fatalf("session.rename ok = %#v, want true", got)
	}
	if got := body["sessionId"]; got != "sess-old" {
		t.Fatalf("session.rename sessionId = %#v, want sess-old", got)
	}
	session := sessionSummaryMap(t, body["session"])
	titleFacts := decodeSessionTitleFacts(t, session["title"].(string))
	if titleFacts.Manual != "Manual name" {
		t.Fatalf("manual title = %q, want Manual name", titleFacts.Manual)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-old")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if !rec.LastActiveAt.Equal(olderAt) {
		t.Fatalf("LastActiveAt = %s, want %s", rec.LastActiveAt.Format(time.RFC3339), olderAt.Format(time.RFC3339))
	}
	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("sessions len = %d, want 2", len(sessions))
	}
	if sessions[0].SessionID != "sess-new" || sessions[1].SessionID != "sess-old" {
		t.Fatalf("session order = [%s %s], want [sess-new sess-old]", sessions[0].SessionID, sessions[1].SessionID)
	}
}

func TestSessionRenameManualTitleSurvivesLaterPromptTitle(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "First title")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", json.RawMessage(`{"sessionId":"sess-1","title":"Manual title"}`)); err != nil {
		t.Fatalf("session.rename: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "later prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-1")
	if err != nil {
		t.Fatalf("ReadSessionSummary: %v", err)
	}
	titleFacts := decodeSessionTitleFacts(t, summary.Title)
	if titleFacts.Manual != "Manual title" || titleFacts.First != "First title" || titleFacts.Last != "later prompt" {
		t.Fatalf("title facts = %#v, want manual preserved with latest prompt", titleFacts)
	}
}

func TestSessionInfoUpdateTitleUpdatesFirstTitleFact(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Initial prompt title")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "latest prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", json.RawMessage(`{"sessionId":"sess-1","title":"Manual title"}`)); err != nil {
		t.Fatalf("session.rename: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateSessionInfoUpdate,
		Title:         "Codex summary",
	})); err != nil {
		t.Fatalf("RecordEvent session info update: %v", err)
	}

	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-1")
	if err != nil {
		t.Fatalf("ReadSessionSummary: %v", err)
	}
	titleFacts := decodeSessionTitleFacts(t, summary.Title)
	if titleFacts.Manual != "Manual title" || titleFacts.First != "Codex summary" || titleFacts.Last != "latest prompt" {
		t.Fatalf("title facts = %#v, want native title as first with manual and latest prompt preserved", titleFacts)
	}
}

func TestSessionInfoUpdateCallbackUpdatesFirstTitleFactWithoutActivePrompt(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Now().UTC()
	addRuntimeSession(c, "sess-1", "Runtime title", "codex", now.Add(-time.Minute), now)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Initial prompt title")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "latest prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	sess, err := c.SessionByID(ctx, "sess-1")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}

	sess.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "sess-1",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateSessionInfoUpdate,
			Title:         "Codex summary",
		},
	})

	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-1")
	if err != nil {
		t.Fatalf("ReadSessionSummary: %v", err)
	}
	titleFacts := decodeSessionTitleFacts(t, summary.Title)
	if titleFacts.First != "Codex summary" || titleFacts.Last != "latest prompt" {
		t.Fatalf("title facts = %#v, want native title as first and latest prompt preserved", titleFacts)
	}
}

func TestHandleSessionRequestRenameClearsManualTitleAndNormalizesInput(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "First title")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", json.RawMessage(`{"sessionId":"sess-1","title":"Manual title"}`)); err != nil {
		t.Fatalf("session.rename manual: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", json.RawMessage(`{"sessionId":"sess-1","title":" \n\t "}`)); err != nil {
		t.Fatalf("session.rename clear: %v", err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-1")
	if err != nil {
		t.Fatalf("ReadSessionSummary: %v", err)
	}
	clearedFacts := decodeSessionTitleFacts(t, summary.Title)
	if clearedFacts.Manual != "" || clearedFacts.First != "First title" {
		t.Fatalf("cleared title facts = %#v, want manual cleared and first title kept", clearedFacts)
	}

	longTitle := strings.Repeat("x", 205)
	payload, err := json.Marshal(map[string]string{"sessionId": "sess-1", "title": "  alpha\r\nbeta  " + longTitle})
	if err != nil {
		t.Fatalf("Marshal payload: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, "session.rename", "proj1", payload); err != nil {
		t.Fatalf("session.rename normalized: %v", err)
	}
	renamed, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-1")
	if err != nil {
		t.Fatalf("ReadSessionSummary after normalized rename: %v", err)
	}
	renamedFacts := decodeSessionTitleFacts(t, renamed.Title)
	if strings.ContainsAny(renamedFacts.Manual, "\r\n") {
		t.Fatalf("manual title contains newline: %q", renamedFacts.Manual)
	}
	if !strings.HasPrefix(renamedFacts.Manual, "alpha beta") {
		t.Fatalf("manual title = %q, want newline replaced with space", renamedFacts.Manual)
	}
	if len([]rune(renamedFacts.Manual)) != 200 {
		t.Fatalf("manual title rune len = %d, want 200", len([]rune(renamedFacts.Manual)))
	}
}

func TestSessionViewListIncludesRuntimeClientSessions(t *testing.T) {
	c := newSessionViewTestClient(t)

	addRuntimeSession(
		c,
		"sess-runtime-1",
		"Runtime Session",
		"claude",
		mustRFC3339Time(t, "2026-04-12T10:00:00Z"),
		mustRFC3339Time(t, "2026-04-12T10:05:00Z"),
	)

	sessions, err := c.listSessionViews(context.Background())
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if sessions[0].SessionID != "sess-runtime-1" {
		t.Fatalf("sessions[0].SessionID = %q, want %q", sessions[0].SessionID, "sess-runtime-1")
	}
	if sessions[0].Title != "Runtime Session" {
		t.Fatalf("sessions[0].Title = %q, want %q", sessions[0].Title, "Runtime Session")
	}
	if sessions[0].AgentType != "claude" {
		t.Fatalf("sessions[0].AgentType = %q, want %q", sessions[0].AgentType, "claude")
	}
}

func TestSessionReadOmitsTurnIDAndLegacyCollections(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	if _, ok := body["session"]; !ok {
		t.Fatalf("session.read missing session summary")
	}
	if _, ok := body["prompts"]; ok {
		t.Fatalf("session.read unexpectedly returned prompts: %+v", body["prompts"])
	}
	if _, ok := body["messages"]; ok {
		t.Fatalf("session.read unexpectedly returned messages: %+v", body["messages"])
	}
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(turns))
	}
	if turns[0].TurnIndex != 1 {
		t.Fatalf("turns[0].TurnIndex = %d, want 1", turns[0].TurnIndex)
	}
	rawTurns, err := json.Marshal(turns)
	if err != nil {
		t.Fatalf("marshal turns: %v", err)
	}
	var encoded []map[string]any
	if err := json.Unmarshal(rawTurns, &encoded); err != nil {
		t.Fatalf("unmarshal turns: %v", err)
	}
	if _, ok := encoded[0]["turnId"]; ok {
		t.Fatalf("turn unexpectedly contains turnId: %+v", encoded[0])
	}
	if _, ok := encoded[0]["sessionId"]; ok {
		t.Fatalf("turn unexpectedly contains sessionId: %+v", encoded[0])
	}
}

func TestSessionReadReturnsTurnsEnvelopeWithLatestTurnIndex(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
	})); err != nil {
		t.Fatalf("RecordEvent answer: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent finished: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1", "afterTurnIndex": int64(1)})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	if got := body["sessionId"]; got != "sess-1" {
		t.Fatalf("sessionId = %v, want sess-1", got)
	}
	if _, ok := body["session"]; !ok {
		t.Fatalf("session.read missing session summary")
	}
	if _, ok := body["prompts"]; ok {
		t.Fatalf("session.read unexpectedly returned prompts: %+v", body["prompts"])
	}
	if _, ok := body["messages"]; ok {
		t.Fatalf("session.read unexpectedly returned messages: %+v", body["messages"])
	}
	if got := body["latestTurnIndex"]; got != int64(3) {
		t.Fatalf("latestTurnIndex = %v, want 3", got)
	}
	turns, ok := body["turns"].([]sessionViewTurn)
	if !ok {
		t.Fatalf("turns type = %T, want []sessionViewTurn", body["turns"])
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want 2", len(turns))
	}
	if turns[0].TurnIndex != 2 || turns[1].TurnIndex != 3 {
		t.Fatalf("turns = %#v, want indexes 2 and 3", turns)
	}
}

func TestSessionReadPaginationReturnsStableContiguousPages(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-page", "Paged Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	for _, prompt := range []string{"first", "second"} {
		if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-page", prompt, nil)); err != nil {
			t.Fatalf("RecordEvent prompt: %v", err)
		}
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-page", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: prompt + " answer"}),
		})); err != nil {
			t.Fatalf("RecordEvent answer: %v", err)
		}
		if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-page", acp.StopReasonEndTurn)); err != nil {
			t.Fatalf("RecordEvent prompt finished: %v", err)
		}
	}

	first, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-page","maxTurns":2,"maxBytes":1048576}`))
	if err != nil {
		t.Fatalf("first session.read: %v", err)
	}
	firstBody := first.(map[string]any)
	if got := firstBody["latestTurnIndex"]; got != int64(6) {
		t.Fatalf("first latestTurnIndex = %v, want 6", got)
	}
	if got := firstBody["hasMore"]; got != true {
		t.Fatalf("first hasMore = %v, want true", got)
	}
	if got := firstBody["nextAfterTurnIndex"]; got != int64(2) {
		t.Fatalf("first nextAfterTurnIndex = %v, want 2", got)
	}
	firstTurns := firstBody["turns"].([]sessionViewTurn)
	if len(firstTurns) != 2 || firstTurns[0].TurnIndex != 1 || firstTurns[1].TurnIndex != 2 {
		t.Fatalf("first turns = %#v, want indexes 1 and 2", firstTurns)
	}

	second, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-page","afterTurnIndex":2,"throughTurnIndex":6,"maxTurns":2,"maxBytes":1048576}`))
	if err != nil {
		t.Fatalf("second session.read: %v", err)
	}
	secondBody := second.(map[string]any)
	if got := secondBody["latestTurnIndex"]; got != int64(6) {
		t.Fatalf("second latestTurnIndex = %v, want stable snapshot 6", got)
	}
	if got := secondBody["hasMore"]; got != true {
		t.Fatalf("second hasMore = %v, want true", got)
	}
	if got := secondBody["nextAfterTurnIndex"]; got != int64(4) {
		t.Fatalf("second nextAfterTurnIndex = %v, want 4", got)
	}
	secondTurns := secondBody["turns"].([]sessionViewTurn)
	if len(secondTurns) != 2 || secondTurns[0].TurnIndex != 3 || secondTurns[1].TurnIndex != 4 {
		t.Fatalf("second turns = %#v, want indexes 3 and 4", secondTurns)
	}
}

func TestSessionReadPaginationAllows1024TurnPages(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	const sessionID = "sess-large-page"
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, "Large Page")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	for index := 0; index < 600; index++ {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "x"}),
			MessageID:     fmt.Sprintf("message-%d", index),
		})); err != nil {
			t.Fatalf("RecordEvent message %d: %v", index, err)
		}
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-large-page","maxTurns":1024,"maxBytes":14680064}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 601 {
		t.Fatalf("turns len = %d, want 601", len(turns))
	}
	if got := body["hasMore"]; got != false {
		t.Fatalf("hasMore = %v, want false", got)
	}
}

func TestSessionReadPaginationAllows14MiBPages(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	const sessionID = "sess-large-byte-page"
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, "Large Byte Page")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: strings.Repeat("x", 9*1024*1024)}),
		MessageID:     "message-large",
	})); err != nil {
		t.Fatalf("RecordEvent message: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-large-byte-page","maxTurns":1024,"maxBytes":14680064}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want prompt and message", len(turns))
	}
	if got := body["hasMore"]; got != false {
		t.Fatalf("hasMore = %v, want false", got)
	}
}

func TestSessionReadPaginationHonorsEncodedResponseByteLimit(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-bytes", "Byte Limited Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	for index := 0; index < 6; index++ {
		if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-bytes", fmt.Sprintf("prompt-%d", index), nil)); err != nil {
			t.Fatalf("RecordEvent prompt %d: %v", index, err)
		}
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-bytes", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: strings.Repeat("x", 8*1024)}),
		})); err != nil {
			t.Fatalf("RecordEvent answer %d: %v", index, err)
		}
		if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-bytes", acp.StopReasonEndTurn)); err != nil {
			t.Fatalf("RecordEvent prompt finished %d: %v", index, err)
		}
	}

	const maxBytes = 24 * 1024
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-bytes","maxTurns":128,"maxBytes":24576}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("json.Marshal(response): %v", err)
	}
	if len(encoded) > maxBytes {
		t.Fatalf("encoded response bytes = %d, want <= %d", len(encoded), maxBytes)
	}
	if got := body["hasMore"]; got != true {
		t.Fatalf("hasMore = %v, want true", got)
	}
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) == 0 || len(turns) >= 18 {
		t.Fatalf("turns len = %d, want a non-empty partial page", len(turns))
	}
	if got := body["nextAfterTurnIndex"]; got != turns[len(turns)-1].TurnIndex {
		t.Fatalf("nextAfterTurnIndex = %v, want %d", got, turns[len(turns)-1].TurnIndex)
	}
}

func TestConstrainSessionReadPageUsesLogarithmicEncodingSearch(t *testing.T) {
	turns := make([]sessionViewTurn, 1024)
	for index := range turns {
		turns[index] = sessionViewTurn{
			TurnIndex: int64(index + 1),
			Content:   strings.Repeat("x", 128),
			Finished:  true,
		}
	}
	response := map[string]any{
		"latestTurnIndex": int64(len(turns)),
		"turns":           turns,
	}
	encodeCalls := 0
	err := constrainSessionReadPageWithEncoder(response, 0, 16*1024, func(value map[string]any) ([]byte, error) {
		encodeCalls++
		return json.Marshal(value)
	})
	if err != nil {
		t.Fatalf("constrainSessionReadPageWithEncoder: %v", err)
	}
	if encodeCalls > 12 {
		t.Fatalf("encoder calls=%d, want at most 12 for 1024 turns", encodeCalls)
	}
	pageTurns := response["turns"].([]sessionViewTurn)
	if len(pageTurns) == 0 || len(pageTurns) >= len(turns) {
		t.Fatalf("page turns=%d, want a non-empty partial page", len(pageTurns))
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > 16*1024 {
		t.Fatalf("encoded bytes=%d, want <= %d", len(encoded), 16*1024)
	}
}

func TestSessionReadVerboseLogIncludesTurnCursor(t *testing.T) {
	var logs bytes.Buffer
	if err := logger.Setup(logger.LoggerConfig{Level: logger.LevelVerbose}); err != nil {
		t.Fatalf("setup logger: %v", err)
	}
	t.Cleanup(logger.Close)
	logger.SetOutput(&logs)

	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
	})); err != nil {
		t.Fatalf("RecordEvent answer: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent finished: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", json.RawMessage(`{"sessionId":"sess-1","afterTurnIndex":1}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	if body := resp.(map[string]any); body["latestTurnIndex"] != int64(3) {
		t.Fatalf("latestTurnIndex = %v, want 3", body["latestTurnIndex"])
	}

	got := logs.String()
	for _, want := range []string{
		"[Hub:proj1] session.read",
		"sessionId=sess-1",
		"afterTurnIndex=1",
		"latestTurnIndex=3",
		"turnCount=2",
		"lastDoneTurnIndex=3",
		"lastReadTurnIndex=0",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("verbose log missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "answer") {
		t.Fatalf("verbose log leaked message content:\n%s", got)
	}
}

func TestSessionMessageOmitsPromptIndex(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	last := lastPublishedEvent(t, *published, "session.message")
	if _, ok := last["promptIndex"]; ok {
		t.Fatalf("published payload unexpectedly contains promptIndex: %+v", last)
	}
}

func TestSessionMessagePublishesTopLevelSessionIDAndNestedRawTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	last := lastPublishedEvent(t, *published, "session.message")
	if got := last["sessionId"]; got != "sess-1" {
		t.Fatalf("sessionId = %v, want sess-1", got)
	}
	if _, ok := last["turnIndex"]; ok {
		t.Fatalf("published payload contains legacy top-level turnIndex: %+v", last)
	}
	turn, ok := last["turn"].(map[string]any)
	if !ok {
		t.Fatalf("turn type = %T, want map[string]any", last["turn"])
	}
	if _, ok := turn["sessionId"]; ok {
		t.Fatalf("nested turn unexpectedly contains sessionId: %+v", turn)
	}
	if got := turn["turnIndex"]; got != int64(1) {
		t.Fatalf("turn.turnIndex = %v, want 1", got)
	}
	if got := turn["finished"]; got != true {
		t.Fatalf("turn.finished = %v, want true", got)
	}
	if _, ok := turn["content"].(string); !ok {
		t.Fatalf("turn.content type = %T, want string", turn["content"])
	}
}

func TestSessionReadReturnsEnvelopeSummaryAndRawTurnsWithoutSessionID(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", []byte(`{"sessionId":"sess-1"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	if got := body["sessionId"]; got != "sess-1" {
		t.Fatalf("sessionId = %v, want sess-1", got)
	}
	if got := body["latestTurnIndex"]; got != int64(1) {
		t.Fatalf("latestTurnIndex = %v, want 1", got)
	}
	summary, ok := body["session"].(sessionViewSummary)
	if !ok {
		t.Fatalf("session type = %T, want sessionViewSummary", body["session"])
	}
	if summary.SessionID != "sess-1" || summary.LatestTurnIndex != 1 {
		t.Fatalf("session summary = %+v, want sessionId=sess-1 latestTurnIndex=1", summary)
	}
	rawTurns, err := json.Marshal(body["turns"])
	if err != nil {
		t.Fatalf("marshal turns: %v", err)
	}
	var turns []map[string]any
	if err := json.Unmarshal(rawTurns, &turns); err != nil {
		t.Fatalf("unmarshal turns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(turns))
	}
	if _, ok := turns[0]["sessionId"]; ok {
		t.Fatalf("turn unexpectedly contains sessionId: %+v", turns[0])
	}
}

func TestSessionTurnsUseSessionGlobalTurnIndexAcrossPrompts(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	seedPromptWithTurns(t, c, ctx, "sess-1", "first", []acp.SessionUpdate{{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "one"}),
	}})
	seedPromptWithTurns(t, c, ctx, "sess-1", "second", []acp.SessionUpdate{{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "two"}),
	}})

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1", "afterTurnIndex": int64(2)})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	if got := body["latestTurnIndex"]; got != int64(6) {
		t.Fatalf("latestTurnIndex = %v, want 6", got)
	}
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 4 {
		t.Fatalf("turns len = %d, want 4", len(turns))
	}
	for i, turn := range turns {
		want := int64(i + 3)
		if turn.TurnIndex != want {
			t.Fatalf("turns[%d].TurnIndex = %d, want %d", i, turn.TurnIndex, want)
		}
	}
}

func TestPromptBoundaryTurnsCarryModelDisplayNameAndTimes(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)
	addRuntimeSession(c, "sess-1", "Task", "codex", time.Time{}, time.Time{})
	sess := c.sessions["sess-1"]
	sess.mu.Lock()
	sess.agentState.ConfigOptions = []acp.ConfigOption{{
		ID:           acp.ConfigOptionIDModel,
		CurrentValue: "gpt-5.3-codex",
		Options: []acp.ConfigOptionValue{{
			Value: "gpt-5.3-codex",
			Name:  "GPT-5.3 Codex",
		}},
	}}
	sess.mu.Unlock()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	startedAt := mustRFC3339Time(t, "2026-05-14T01:02:03Z")
	prompt := sessionViewPromptEvent("sess-1", "run", nil)
	prompt.UpdatedAt = startedAt
	if err := c.RecordEvent(ctx, prompt); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	finishedAt := mustRFC3339Time(t, "2026-05-14T01:02:09Z")
	done := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	done.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, done); err != nil {
		t.Fatalf("RecordEvent finished: %v", err)
	}

	var requestContent string
	var doneContent string
	for _, event := range *published {
		content := publishedTurnMap(t, event.payload)["content"].(string)
		var msg acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(content), &msg); err != nil {
			t.Fatalf("unmarshal content: %v", err)
		}
		switch msg.Method {
		case acp.SessionTurnMethodPromptRequest:
			requestContent = content
		case acp.SessionTurnMethodPromptDone:
			doneContent = content
		}
	}
	if requestContent == "" || doneContent == "" {
		t.Fatalf("missing prompt boundary turns request=%q done=%q", requestContent, doneContent)
	}
	requestParam := decodeTurnParamMap(t, requestContent)
	if got := requestParam["modelName"]; got != "GPT-5.3 Codex" {
		t.Fatalf("prompt_request modelName = %v, want GPT-5.3 Codex", got)
	}
	if got := requestParam["createdAt"]; got != "2026-05-14T01:02:03Z" {
		t.Fatalf("prompt_request createdAt = %v, want %s", got, "2026-05-14T01:02:03Z")
	}
	doneParam := decodeTurnParamMap(t, doneContent)
	if got := doneParam["completedAt"]; got != "2026-05-14T01:02:09Z" {
		t.Fatalf("prompt_done completedAt = %v, want %s", got, "2026-05-14T01:02:09Z")
	}
}

func TestSessionViewPublishMessageOmitsTurnID(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	var published map[string]any
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		var ok bool
		published, ok = payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	if published == nil {
		t.Fatalf("expected session message event to be published")
	}
	if _, ok := published["turnId"]; ok {
		t.Fatalf("published payload unexpectedly contains turnId: %+v", published)
	}
}

func TestSessionMessagePublishesFinishedFieldInsteadOfDone(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Finished Field")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	last := lastPublishedEvent(t, *published, "session.message")
	if _, ok := last["done"]; ok {
		t.Fatalf("payload contains legacy done field: %#v", last)
	}
	turn := publishedTurnMap(t, last)
	if got := turn["finished"]; got != true {
		t.Fatalf("finished = %v, want true", got)
	}
}

func TestSessionPlanUpdatesPublishAgentPlanAndReplaceTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	if acp.SessionTurnMethodAgentPlan != "agent_plan" {
		t.Fatalf("SessionTurnMethodAgentPlan = %q, want agent_plan", acp.SessionTurnMethodAgentPlan)
	}
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-plan", "Plan Task")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-plan", "run plan", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPlanUpdatedEvent("sess-plan", []acp.PlanEntry{
		{Content: "Inspect files", Status: acp.ToolCallStatusCompleted},
		{Content: "Patch UI", Status: acp.ToolCallStatusInProgress},
	})); err != nil {
		t.Fatalf("RecordEvent first plan: %v", err)
	}

	firstPlan := decodePublishedTurnMessage(t, lastPublishedEvent(t, *published, "session.message"))
	if firstPlan.TurnIndex != 2 {
		t.Fatalf("first plan turnIndex = %d, want 2", firstPlan.TurnIndex)
	}
	firstMessage := decodeSessionTurnMessage(t, firstPlan.Content)
	if firstMessage.Method != acp.SessionTurnMethodAgentPlan {
		t.Fatalf("first plan method = %q, want %q", firstMessage.Method, acp.SessionTurnMethodAgentPlan)
	}
	firstPayload := decodePlanPayload(t, firstMessage.Param)
	if len(firstPayload.Entries) != 2 || firstPayload.Entries[1].Content != "Patch UI" || firstPayload.Entries[1].Status != acp.ToolCallStatusInProgress {
		t.Fatalf("first plan entries = %#v", firstPayload.Entries)
	}

	if err := c.RecordEvent(ctx, sessionViewPlanUpdatedEvent("sess-plan", []acp.PlanEntry{
		{Content: "Inspect files", Status: acp.ToolCallStatusCompleted},
		{Content: "Patch UI", Status: acp.ToolCallStatusCompleted},
		{Content: "Run tests", Status: acp.ToolCallStatusInProgress},
	})); err != nil {
		t.Fatalf("RecordEvent second plan: %v", err)
	}

	secondPlan := decodePublishedTurnMessage(t, lastPublishedEvent(t, *published, "session.message"))
	if secondPlan.TurnIndex != firstPlan.TurnIndex {
		t.Fatalf("second plan turnIndex = %d, want same turnIndex %d", secondPlan.TurnIndex, firstPlan.TurnIndex)
	}
	secondMessage := decodeSessionTurnMessage(t, secondPlan.Content)
	if secondMessage.Method != acp.SessionTurnMethodAgentPlan {
		t.Fatalf("second plan method = %q, want %q", secondMessage.Method, acp.SessionTurnMethodAgentPlan)
	}
	secondPayload := decodePlanPayload(t, secondMessage.Param)
	if len(secondPayload.Entries) != 3 {
		t.Fatalf("second plan entries len = %d, want 3: %#v", len(secondPayload.Entries), secondPayload.Entries)
	}
	if got := secondPayload.Entries[2]; got.Content != "Run tests" || got.Status != acp.ToolCallStatusInProgress {
		t.Fatalf("second plan final entry = %#v, want Run tests in_progress", got)
	}
}

func TestPromptDoneIsPublishedAsFinishedRealTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Done Turn")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
	})); err != nil {
		t.Fatalf("RecordEvent answer: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent done: %v", err)
	}

	last := lastPublishedEvent(t, *published, "session.message")
	turn := publishedTurnMap(t, last)
	content := turn["content"].(string)
	var msg acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(content), &msg); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if msg.Method != acp.SessionTurnMethodPromptDone {
		t.Fatalf("method = %q, want %q", msg.Method, acp.SessionTurnMethodPromptDone)
	}
	if got := turn["finished"]; got != true {
		t.Fatalf("finished = %v, want true", got)
	}
	if got := turn["turnIndex"].(int64); got != 3 {
		t.Fatalf("turnIndex = %d, want 3", got)
	}
}

func TestSessionReadReturnsPromptDoneAsFinishedTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Read Prompt Done Turn")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
	})); err != nil {
		t.Fatalf("RecordEvent answer: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	last := turns[2]
	if last.TurnIndex != 3 {
		t.Fatalf("prompt_done turnIndex = %d, want 3", last.TurnIndex)
	}
	if last.Finished != true {
		t.Fatalf("prompt_done finished = %v, want true", last.Finished)
	}
	var msg acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(last.Content), &msg); err != nil {
		t.Fatalf("unmarshal prompt_done content: %v", err)
	}
	if msg.Method != acp.SessionTurnMethodPromptDone {
		t.Fatalf("last method = %q, want %q", msg.Method, acp.SessionTurnMethodPromptDone)
	}
}

func TestDuplicatePromptDoneDoesNotOverwriteStoredTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Duplicate Prompt Done")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
	})); err != nil {
		t.Fatalf("RecordEvent answer: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent duplicate prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3; turns=%+v", len(turns), turns)
	}
	if text := strings.TrimSpace(extractTextChunk(decodeTurnSessionUpdate(t, turns[1].Content).Content)); text != "answer" {
		t.Fatalf("agent text = %q, want answer", text)
	}
	if turns[2].TurnIndex != 3 || turns[2].Finished != true {
		t.Fatalf("prompt_done turn = %#v, want turnIndex=3 finished=true", turns[2])
	}
}

func TestSessionViewPublishMessageOmitsUpdateIndexAndPublishesMergedTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	var published []map[string]any
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, body)
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Merge Publish")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "say hi", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello "}),
		Status:        "streaming",
	})); err != nil {
		t.Fatalf("RecordEvent update1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"}),
		Status:        "done",
	})); err != nil {
		t.Fatalf("RecordEvent update2: %v", err)
	}

	if len(published) < 3 {
		t.Fatalf("published len = %d, want at least 3", len(published))
	}
	last := published[len(published)-1]
	if _, ok := last["updateIndex"]; ok {
		t.Fatalf("published payload unexpectedly contains updateIndex: %+v", last)
	}
	turn := publishedTurnMap(t, last)
	if got := turn["turnIndex"].(int64); got != 2 {
		t.Fatalf("published turnIndex = %d, want 2", got)
	}
	content, _ := turn["content"].(string)
	if text := extractTextChunk(decodeTurnSessionUpdate(t, content).Content); text != "hello world" {
		t.Fatalf("published content text = %q, want %q", text, "hello world")
	}
}

func TestSessionReadWithoutCheckpointReturnsAllTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "first", nil)); err != nil {
		t.Fatalf("RecordEvent prompt #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "one"}),
	})); err != nil {
		t.Fatalf("RecordEvent update #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "second", nil)); err != nil {
		t.Fatalf("RecordEvent prompt #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "two"}),
	})); err != nil {
		t.Fatalf("RecordEvent update #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #2: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	rawMessages, err := json.Marshal(body["turns"])
	if err != nil {
		t.Fatalf("json.Marshal(turns): %v", err)
	}
	var messages []struct {
		SessionID string `json:"sessionId"`
		TurnIndex int64  `json:"turnIndex"`
		Content   string `json:"content"`
		Finished  bool   `json:"finished"`
	}
	if err := json.Unmarshal(rawMessages, &messages); err != nil {
		t.Fatalf("json.Unmarshal(turns): %v", err)
	}
	if len(messages) != 6 {
		t.Fatalf("turns len = %d, want 6", len(messages))
	}
	for i, message := range messages {
		if message.TurnIndex != int64(i+1) {
			t.Fatalf("turns[%d].TurnIndex = %d, want %d", i, message.TurnIndex, i+1)
		}
	}
}

func TestSessionRecorderStoresSteeredMessageBetweenAgentTurns(t *testing.T) {
	client := newSessionViewTestClient(t)
	ctx := context.Background()
	sessionID := "steer-order"
	events := []SessionViewEvent{
		sessionViewCreatedEvent(sessionID, "Steer ordering"),
		sessionViewPromptEvent(sessionID, "start", nil),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "before"}),
		}),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateUserMessageChunk,
			ContentBlocks: []acp.ContentBlock{
				{Type: acp.ContentBlockTypeText, Text: "change direction"},
				{Type: acp.ContentBlockTypeResourceLink, URI: "file:///tmp/input.png", Name: "input.png"},
			},
			ClientMessageID: "queued-1",
			Steered:         true,
		}),
		sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "after"}),
		}),
		sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn),
	}
	for _, event := range events {
		if err := client.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent(%s): %v", event.Type, err)
		}
	}

	_, turns, err := client.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatal(err)
	}
	wantMethods := []string{
		acp.SessionTurnMethodPromptRequest,
		acp.SessionUpdateAgentMessageChunk,
		acp.SessionUpdateUserMessageChunk,
		acp.SessionUpdateAgentMessageChunk,
		acp.SessionTurnMethodPromptDone,
	}
	if len(turns) != len(wantMethods) {
		t.Fatalf("turn count = %d, want %d: %+v", len(turns), len(wantMethods), turns)
	}
	var payload acp.SessionTurnUserMessage
	for index, turn := range turns {
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
			t.Fatalf("decode turn %d: %v", index, err)
		}
		if message.Method != wantMethods[index] {
			t.Fatalf("turn %d method = %q, want %q", index, message.Method, wantMethods[index])
		}
		if index == 2 {
			if err := json.Unmarshal(message.Param, &payload); err != nil {
				t.Fatalf("decode steered payload: %v", err)
			}
		}
	}
	if payload.ClientMessageID != "queued-1" || !payload.Steered || len(payload.ContentBlocks) != 2 {
		t.Fatalf("steered payload = %+v", payload)
	}
}

func TestSessionRecorderDeduplicatesSteeredClientMessageID(t *testing.T) {
	client := newSessionViewTestClient(t)
	ctx := context.Background()
	sessionID := "steer-dedupe"
	if err := client.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, "Steer dedupe")); err != nil {
		t.Fatal(err)
	}
	if err := client.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "start", nil)); err != nil {
		t.Fatal(err)
	}
	update := sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
		SessionUpdate:   acp.SessionUpdateUserMessageChunk,
		ContentBlocks:   []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "change"}},
		ClientMessageID: "queued-1",
		Steered:         true,
	})
	if err := client.RecordEvent(ctx, update); err != nil {
		t.Fatal(err)
	}
	if err := client.RecordEvent(ctx, update); err != nil {
		t.Fatal(err)
	}
	_, turns, err := client.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, turn := range turns {
		var message acp.SessionTurnMessage
		if json.Unmarshal([]byte(turn.Content), &message) == nil &&
			message.Method == acp.SessionUpdateUserMessageChunk {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("steered turn count = %d, want 1: %+v", count, turns)
	}
}

func TestSessionSearchVisibleTextReadsSteeredContentBlocksAndLegacyText(t *testing.T) {
	structured := buildSessionTurnContentJSON(acp.SessionUpdateUserMessageChunk, acp.SessionTurnUserMessage{
		ContentBlocks: []acp.ContentBlock{
			{Type: acp.ContentBlockTypeText, Text: "change direction"},
			{Type: acp.ContentBlockTypeResourceLink, Name: "requirements.md", URI: "file:///tmp/requirements.md"},
		},
		ClientMessageID: "queued-1",
		Steered:         true,
	})
	if got := sessionSearchTurnVisibleText(structured); got != "change direction" {
		t.Fatalf("structured visible text = %q", got)
	}

	legacy := buildSessionTurnContentJSON(acp.SessionUpdateUserMessageChunk, acp.SessionTurnTextResult{Text: "legacy steer"})
	if got := sessionSearchTurnVisibleText(legacy); got != "legacy steer" {
		t.Fatalf("legacy visible text = %q", got)
	}
}

func TestSessionSearchVisibleTextIncludesOnlyUserAndVisibleAgentContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name: "prompt request",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodPromptRequest, acp.SessionTurnPromptRequest{
				ContentBlocks: []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "user prompt"}},
			}),
			want: "user prompt",
		},
		{
			name:    "user message chunk",
			content: buildSessionTurnContentJSON(acp.SessionUpdateUserMessageChunk, acp.SessionTurnTextResult{Text: "user steer"}),
			want:    "user steer",
		},
		{
			name:    "agent message chunk",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodAgentMessage, acp.SessionTurnTextResult{Text: "visible answer"}),
			want:    "visible answer",
		},
		{
			name:    "agent thought chunk",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodAgentThought, acp.SessionTurnTextResult{Text: "private reasoning"}),
		},
		{
			name:    "tool call",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodToolCall, map[string]any{"text": "tool output"}),
		},
		{
			name: "agent plan",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodAgentPlan, acp.SessionTurnPlanPayload{
				Entries: []acp.SessionTurnPlanResult{{Content: "plan content", Status: "pending"}},
			}),
		},
		{
			name:    "system",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodSystem, acp.SessionTurnTextResult{Text: "system notice"}),
		},
		{
			name: "prompt done",
			content: buildSessionTurnContentJSON(acp.SessionTurnMethodPromptDone, acp.SessionTurnPromptResult{
				StopReason: "failed",
				Message:    "status failure",
			}),
		},
		{
			name:    "unknown generic payload",
			content: buildSessionTurnContentJSON("future_status", map[string]any{"text": "generic text", "status": "running"}),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sessionSearchTurnVisibleText(test.content); got != test.want {
				t.Fatalf("visible text = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSessionSearchWorkersBoundConcurrency(t *testing.T) {
	sessions := make([]sessionSearchSnapshot, 12)
	for index := range sessions {
		sessions[index].SessionID = fmt.Sprintf("session-%d", index)
	}
	const limit = 3
	started := make(chan struct{}, len(sessions))
	release := make(chan struct{})
	done := make(chan struct{})
	var mu sync.Mutex
	active := 0
	maxActive := 0
	processed := 0
	go func() {
		runSessionSearchWorkers(context.Background(), sessions, limit, func(_ context.Context, _ sessionSearchSnapshot) {
			mu.Lock()
			active++
			processed++
			if active > maxActive {
				maxActive = active
			}
			mu.Unlock()
			started <- struct{}{}
			<-release
			mu.Lock()
			active--
			mu.Unlock()
		})
		close(done)
	}()

	for index := 0; index < limit; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("workers did not start")
		}
	}
	select {
	case <-started:
		t.Fatal("worker limit was exceeded while the first workers were blocked")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("workers did not finish")
	}
	mu.Lock()
	defer mu.Unlock()
	if processed != len(sessions) {
		t.Fatalf("processed = %d, want %d", processed, len(sessions))
	}
	if maxActive != limit {
		t.Fatalf("max active = %d, want %d", maxActive, limit)
	}
}

func TestSessionSearchWorkersStopQueuedWorkAfterCancellation(t *testing.T) {
	sessions := make([]sessionSearchSnapshot, 10)
	ctx, cancel := context.WithCancel(context.Background())
	release := make(chan struct{})
	started := make(chan struct{}, len(sessions))
	done := make(chan struct{})
	var mu sync.Mutex
	processed := 0
	go func() {
		runSessionSearchWorkers(ctx, sessions, 2, func(_ context.Context, _ sessionSearchSnapshot) {
			mu.Lock()
			processed++
			mu.Unlock()
			started <- struct{}{}
			<-release
		})
		close(done)
	}()
	for index := 0; index < 2; index++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("workers did not start")
		}
	}
	cancel()
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled workers did not finish")
	}
	mu.Lock()
	defer mu.Unlock()
	if processed > 2 {
		t.Fatalf("processed = %d, want at most the two active sessions", processed)
	}
}

func TestSessionSearchResultDeduplicatesSessionIdentity(t *testing.T) {
	task := &sessionSearchTask{searchID: "search"}
	manager := &sessionSearchManager{tasks: map[string]*sessionSearchTask{"search": task}}
	result := sessionSearchResult{ProjectID: "project", SessionID: "session", Source: "title"}
	manager.appendResult(task, result)
	manager.appendResult(task, sessionSearchResult{
		ProjectID: "project", SessionID: "session", Source: "prompt", TurnIndex: 4,
	})
	if got := len(manager.tasks["search"].results); got != 1 {
		t.Fatalf("result count = %d, want one result per session", got)
	}
}

func TestSessionSearchReplacedTaskIgnoresStaleWorkerUpdates(t *testing.T) {
	stale := &sessionSearchTask{searchID: "search"}
	current := &sessionSearchTask{searchID: "search"}
	manager := &sessionSearchManager{tasks: map[string]*sessionSearchTask{"search": current}}

	manager.appendResult(stale, sessionSearchResult{ProjectID: "project", SessionID: "stale", Source: "title"})
	manager.appendError(stale, sessionSearchError{ProjectID: "project", Message: "stale"})
	manager.markDone(stale)

	if len(current.results) != 0 || len(current.errors) != 0 || current.done {
		t.Fatalf("replacement task was mutated by stale workers: %#v", current)
	}
}

func TestSessionSearchSnapshotStopsAtTitleHit(t *testing.T) {
	turnSearches := 0
	result, matched, err := searchSessionSnapshot(
		context.Background(),
		"project",
		sessionSearchSnapshot{SessionID: "session", Title: "Matching title", LatestTurnIndex: 9},
		"matching",
		func(context.Context, string, int64, string) (int64, bool, error) {
			turnSearches++
			return 0, false, nil
		},
	)
	if err != nil || !matched {
		t.Fatalf("search result = %#v, matched=%v, err=%v", result, matched, err)
	}
	if result.Source != "title" || turnSearches != 0 {
		t.Fatalf("result = %#v, turn searches = %d", result, turnSearches)
	}
}

func TestSessionRecoveryKeepsSteeredMessageInsideNativeTurn(t *testing.T) {
	client := newSessionViewTestClient(t)
	ctx := context.Background()
	sessionID := "steer-recovery"
	if err := client.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, "Steer recovery")); err != nil {
		t.Fatal(err)
	}
	startBlocks := []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "start"},
		{Type: acp.ContentBlockTypeResourceLink, Name: "start.png", URI: "file:///tmp/start.png"},
	}
	steerBlocks := []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "change"},
		{Type: acp.ContentBlockTypeResourceLink, Name: "change.png", URI: "file:///tmp/change.png"},
	}
	client.recovery().feedReplayToRecorder(ctx, sessionID, []acp.SessionUpdateParams{
		{
			SessionID: sessionID,
			Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateUserMessageChunk,
				Content:       mustJSON(startBlocks[0]),
				ContentBlocks: startBlocks,
			},
		},
		{
			SessionID: sessionID,
			Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "before"}),
			},
		},
		{
			SessionID: sessionID,
			Update: acp.SessionUpdate{
				SessionUpdate:   acp.SessionUpdateUserMessageChunk,
				ContentBlocks:   steerBlocks,
				ClientMessageID: "queued-1",
				Steered:         true,
			},
		},
		{
			SessionID: sessionID,
			Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "after"}),
			},
		},
	})

	_, turns, err := client.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatal(err)
	}
	wantMethods := []string{
		acp.MethodSessionPrompt,
		acp.SessionUpdateAgentMessageChunk,
		acp.SessionUpdateUserMessageChunk,
		acp.SessionUpdateAgentMessageChunk,
		acp.MethodSessionPrompt,
	}
	if len(turns) != len(wantMethods) {
		t.Fatalf("turn count = %d, want %d: %+v", len(turns), len(wantMethods), turns)
	}
	for index, turn := range turns {
		if got := decodeTurnMethod(t, turn.Content); got != wantMethods[index] {
			t.Fatalf("turn %d method = %q, want %q", index, got, wantMethods[index])
		}
	}
	if blocks := promptRequestBlocksForTest(t, turns[0]); !reflect.DeepEqual(blocks, startBlocks) {
		t.Fatalf("recovered prompt blocks = %#v, want %#v", blocks, startBlocks)
	}
}

func TestSessionForkPromptsIncludeSteeredBlocks(t *testing.T) {
	turns := []sessionViewTurn{
		{
			TurnIndex: 1,
			Content: buildSessionTurnContentJSON(acp.SessionTurnMethodPromptRequest, acp.SessionTurnPromptRequest{
				ContentBlocks: []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "start"}},
			}),
		},
		{
			TurnIndex: 2,
			Content: buildSessionTurnContentJSON(acp.SessionUpdateUserMessageChunk, acp.SessionTurnUserMessage{
				ContentBlocks: []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "change"}},
				Steered:       true,
			}),
		},
		{
			TurnIndex: 3,
			Content:   buildSessionTurnContentJSON(acp.SessionTurnMethodPromptDone, acp.SessionTurnPromptResult{}),
		},
	}

	prompts := sessionForkPromptsFromTurns(turns)
	if len(prompts) != 1 || prompts[0].DoneTurnIndex != 3 {
		t.Fatalf("fork prompts = %#v", prompts)
	}
	want := []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "start"},
		{Type: acp.ContentBlockTypeText, Text: "change"},
	}
	if !reflect.DeepEqual(prompts[0].ContentBlocks, want) {
		t.Fatalf("fork prompt blocks = %#v, want %#v", prompts[0].ContentBlocks, want)
	}
}

func TestSessionReadAfterTurnIndexReturnsLaterTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "first", nil)); err != nil {
		t.Fatalf("RecordEvent prompt #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "one"}),
	})); err != nil {
		t.Fatalf("RecordEvent update #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "second", nil)); err != nil {
		t.Fatalf("RecordEvent prompt #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "two"}),
	})); err != nil {
		t.Fatalf("RecordEvent update #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #2: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1", "afterTurnIndex": 2})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	rawMessages, err := json.Marshal(body["turns"])
	if err != nil {
		t.Fatalf("json.Marshal(turns): %v", err)
	}
	var messages []struct {
		TurnIndex int64  `json:"turnIndex"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal(rawMessages, &messages); err != nil {
		t.Fatalf("json.Unmarshal(messages): %v", err)
	}
	if len(messages) != 4 {
		t.Fatalf("turns len = %d, want 4", len(messages))
	}
	for i, message := range messages {
		want := int64(i + 3)
		if message.TurnIndex != want {
			t.Fatalf("turns[%d].TurnIndex = %d, want %d", i, message.TurnIndex, want)
		}
	}
}

func TestSessionRecorderResetPromptStateRestartsTurnIndexWhenNothingPersisted(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "first", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	c.sessionRecorder.ResetPromptState()

	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "second", nil)); err != nil {
		t.Fatalf("RecordEvent prompt after reset: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(turns))
	}
	if turns[0].TurnIndex != 1 {
		t.Fatalf("turns[0].TurnIndex = %d, want 1", turns[0].TurnIndex)
	}
}

func TestSessionRecorderPersistsOperationLifecycle(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	ctx := context.Background()
	if err := store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-operation",
		ProjectName:  "proj1",
		AgentType:    string(acp.ACPProviderCodex),
		CreatedAt:    time.Now().Add(-time.Hour),
		LastActiveAt: time.Now().Add(-time.Minute),
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	c := New(store, "proj1", t.TempDir())
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	t.Cleanup(func() { _ = c.Close() })
	published := captureSessionMessageEvents(t, c)

	startedAt := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	if err := c.sessionRecorder.RecordSessionOperation(ctx, "sess-operation", acp.SessionOperationPayload{
		OperationID: "op-1",
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusStarted,
		StartedAt:   startedAt.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("RecordSessionOperation(started): %v", err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-operation")
	if err != nil {
		t.Fatalf("ReadSessionSummary(started): %v", err)
	}
	if !summary.Running {
		t.Fatal("summary running = false after operation start")
	}

	completedAt := startedAt.Add(3 * time.Second)
	if err := c.sessionRecorder.RecordSessionOperation(ctx, "sess-operation", acp.SessionOperationPayload{
		OperationID: "op-1",
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusCompleted,
		StartedAt:   startedAt.Format(time.RFC3339),
		CompletedAt: completedAt.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("RecordSessionOperation(completed): %v", err)
	}
	summary, err = c.sessionRecorder.ReadSessionSummary(ctx, "sess-operation")
	if err != nil {
		t.Fatalf("ReadSessionSummary(completed): %v", err)
	}
	if summary.Running {
		t.Fatal("summary running = true after operation completion")
	}

	latest, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-operation", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if latest != 2 || len(turns) != 2 {
		t.Fatalf("latest=%d turns=%d", latest, len(turns))
	}
	for index, turn := range turns {
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
			t.Fatalf("decode turn %d: %v", index, err)
		}
		if message.Method != acp.SessionTurnMethodOperation {
			t.Fatalf("turn %d method = %q", index, message.Method)
		}
	}
	messageEvents := 0
	for _, event := range *published {
		if event.method == acp.RegistryMethodSessionMessage {
			messageEvents++
		}
	}
	if messageEvents != 2 {
		t.Fatalf("session.message events = %d, want 2", messageEvents)
	}
}

func TestSessionRecorderOperationDoesNotMoveSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	olderAt := mustRFC3339Time(t, "2026-05-22T01:00:00Z")
	newerAt := mustRFC3339Time(t, "2026-05-22T02:00:00Z")

	oldSession := sessionViewCreatedEvent("sess-old", "Old title")
	oldSession.UpdatedAt = olderAt
	if err := c.RecordEvent(ctx, oldSession); err != nil {
		t.Fatalf("RecordEvent old session: %v", err)
	}
	newSession := sessionViewCreatedEvent("sess-new", "Newer title")
	newSession.UpdatedAt = newerAt
	if err := c.RecordEvent(ctx, newSession); err != nil {
		t.Fatalf("RecordEvent new session: %v", err)
	}

	if err := c.sessionRecorder.RecordSessionOperation(ctx, "sess-old", acp.SessionOperationPayload{
		OperationID: "op-1",
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusStarted,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("RecordSessionOperation(started): %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-old")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(olderAt) {
		t.Fatalf("LastActiveAt = %s, want %s", rec.LastActiveAt.Format(time.RFC3339), olderAt.Format(time.RFC3339))
	}
	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("sessions len = %d, want 2", len(sessions))
	}
	if sessions[0].SessionID != "sess-new" || sessions[1].SessionID != "sess-old" {
		t.Fatalf("session order = [%s %s], want [sess-new sess-old]", sessions[0].SessionID, sessions[1].SessionID)
	}
}

func TestSessionViewListPreservesStoredProjectionMetadataForRuntimeSessions(t *testing.T) {
	c := newSessionViewTestClient(t)

	ctx := context.Background()
	lastActiveAt := mustRFC3339Time(t, "2026-04-12T10:05:00Z")
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:          "sess-runtime-1",
		ProjectName: "proj1",
		Status:      SessionSuspended,
		AgentType:   "claude",
		AgentJSON:   `{"title":"Persisted Title"}`,
		Title:       "Persisted Title",

		CreatedAt:    mustRFC3339Time(t, "2026-04-12T10:00:00Z"),
		LastActiveAt: lastActiveAt,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	runtimeLastActiveAt := time.Now().UTC()
	addRuntimeSession(
		c,
		"sess-runtime-1",
		"Runtime Session",
		"claude",
		mustRFC3339Time(t, "2026-04-12T10:00:00Z"),
		runtimeLastActiveAt,
	)

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if sessions[0].Title != "Persisted Title" {
		t.Fatalf("sessions[0].Title = %q, want %q", sessions[0].Title, "Persisted Title")
	}
	if sessions[0].UpdatedAt != lastActiveAt.Format(time.RFC3339) {
		t.Fatalf("sessions[0].UpdatedAt = %q, want %q", sessions[0].UpdatedAt, lastActiveAt.Format(time.RFC3339))
	}
}

func TestSessionViewPreservesUserImageBlocks(t *testing.T) {
	c := newSessionViewTestClient(t)

	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-1", "Images")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewPromptEvent("sess-1", "Sent an image", []acp.ContentBlock{{Type: acp.ContentBlockTypeImage, MimeType: "image/png", Data: "abc123"}})); err != nil {
		t.Fatalf("RecordEvent user image message: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(context.Background(), "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(turns))
	}

	promptMessage := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(turns[0].Content), &promptMessage); err != nil {
		t.Fatalf("unmarshal prompt message: %v", err)
	}
	var promptDoc map[string]json.RawMessage
	if err := json.Unmarshal([]byte(turns[0].Content), &promptDoc); err != nil {
		t.Fatalf("unmarshal prompt message doc: %v", err)
	}
	if strings.TrimSpace(promptMessage.Method) != acp.SessionTurnMethodPromptRequest {
		t.Fatalf("messages[0].method = %q, want %q", promptMessage.Method, acp.SessionTurnMethodPromptRequest)
	}
	if _, ok := promptDoc["session"]; ok {
		t.Fatalf("messages[0].content unexpectedly contains session field")
	}
	if _, ok := promptDoc["index"]; ok {
		t.Fatalf("messages[0].content unexpectedly contains index field")
	}
	promptRequest := acp.SessionTurnPromptRequest{}
	if err := json.Unmarshal(promptMessage.Param, &promptRequest); err != nil {
		t.Fatalf("unmarshal prompt request: %v", err)
	}
	if len(promptRequest.ContentBlocks) != 1 || promptRequest.ContentBlocks[0].Type != acp.ContentBlockTypeImage {
		t.Fatalf("messages[0].request.contentBlocks = %#v, want image block", promptRequest.ContentBlocks)
	}
}

func TestSessionRecorderPromptTimingUpdatesSessionSummaryAndDuration(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	createdAt := mustRFC3339Time(t, "2026-05-06T12:00:00Z")
	startedAt := mustRFC3339Time(t, "2026-05-06T12:01:02Z")
	finishedAt := mustRFC3339Time(t, "2026-05-06T12:01:27Z")

	created := sessionViewCreatedEvent("sess-1", "Timing")
	created.UpdatedAt = createdAt
	if err := c.RecordEvent(ctx, created); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	started := sessionViewPromptEvent("sess-1", "measure", nil)
	started.UpdatedAt = startedAt
	if err := c.RecordEvent(ctx, started); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}

	finished := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	finished.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, finished); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(finishedAt) {
		t.Fatalf("session LastActiveAt = %q, want %q", rec.LastActiveAt.Format(time.RFC3339Nano), finishedAt.Format(time.RFC3339Nano))
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if sessions[0].UpdatedAt != finishedAt.Format(time.RFC3339) {
		t.Fatalf("summary UpdatedAt = %q, want %q", sessions[0].UpdatedAt, finishedAt.Format(time.RFC3339))
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want 2", len(turns))
	}
	startParam := decodeTurnParamMap(t, turns[0])
	if got := startParam["createdAt"]; got != startedAt.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("prompt_request createdAt = %v, want %s", got, startedAt.UTC().Format(time.RFC3339Nano))
	}
	doneParam := decodeTurnParamMap(t, turns[1])
	if got := doneParam["completedAt"]; got != finishedAt.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("prompt_done completedAt = %v, want %s", got, finishedAt.UTC().Format(time.RFC3339Nano))
	}
}

func TestSessionSummaryExposesRunningDoneAndReadState(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Status")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}

	runningSessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("list running sessions: %v", err)
	}
	if len(runningSessions) != 1 {
		t.Fatalf("running sessions len = %d, want 1", len(runningSessions))
	}
	runningSummary := sessionSummaryMap(t, runningSessions[0])
	if got := runningSummary["running"]; got != true {
		t.Fatalf("running summary running = %#v, want true", got)
	}
	if got := runningSummary["lastDoneTurnIndex"]; got != float64(0) {
		t.Fatalf("running summary lastDoneTurnIndex = %#v, want 0", got)
	}
	if got := runningSummary["lastReadTurnIndex"]; got != float64(0) {
		t.Fatalf("running summary lastReadTurnIndex = %#v, want 0", got)
	}

	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "failed")); err != nil {
		t.Fatalf("RecordEvent prompt failed: %v", err)
	}

	doneSessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("list done sessions: %v", err)
	}
	doneSummary := sessionSummaryMap(t, doneSessions[0])
	if got := doneSummary["running"]; got != false {
		t.Fatalf("done summary running = %#v, want false", got)
	}
	if got := doneSummary["lastDoneTurnIndex"]; got != float64(2) {
		t.Fatalf("done summary lastDoneTurnIndex = %#v, want 2", got)
	}
	if got := doneSummary["lastDoneSuccess"]; got != false {
		t.Fatalf("done summary lastDoneSuccess = %#v, want false", got)
	}
	if got := doneSummary["lastReadTurnIndex"]; got != float64(0) {
		t.Fatalf("done summary lastReadTurnIndex = %#v, want 0", got)
	}
}

func TestSessionSummaryTreatsCancelledPromptAsUnsuccessful(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-cancelled-summary", "Cancelled Status")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-cancelled-summary", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-cancelled-summary", acp.StopReasonCancelled)); err != nil {
		t.Fatalf("RecordEvent prompt cancelled: %v", err)
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	summary := sessionSummaryMap(t, sessions[0])
	if got := summary["lastDoneSuccess"]; got != false {
		t.Fatalf("cancelled summary lastDoneSuccess = %#v, want false", got)
	}
}

func TestHandleSessionRequestMarkReadPersistsReadCursor(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Read Cursor")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "end_turn")); err != nil {
		t.Fatalf("RecordEvent finished: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.markRead", "proj1", []byte(`{"sessionId":"sess-1","lastReadTurnIndex":2}`))
	if err != nil {
		t.Fatalf("session.markRead: %v", err)
	}
	body := resp.(map[string]any)
	if got := body["ok"]; got != true {
		t.Fatalf("session.markRead ok = %#v, want true", got)
	}
	session := sessionSummaryMap(t, body["session"])
	if got := session["lastReadTurnIndex"]; got != float64(2) {
		t.Fatalf("marked summary lastReadTurnIndex = %#v, want 2", got)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.markRead", "proj1", []byte(`{"sessionId":"sess-1","lastReadTurnIndex":1}`)); err != nil {
		t.Fatalf("session.markRead lower cursor: %v", err)
	}
	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	summary := sessionSummaryMap(t, sessions[0])
	if got := summary["lastReadTurnIndex"]; got != float64(2) {
		t.Fatalf("summary lastReadTurnIndex after lower mark = %#v, want 2", got)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	var projection map[string]any
	if err := json.Unmarshal([]byte(rec.SessionSyncJSON), &projection); err != nil {
		t.Fatalf("unmarshal projection: %v", err)
	}
	if got := projection["lastReadTurnIndex"]; got != float64(2) {
		t.Fatalf("projection lastReadTurnIndex = %#v, want 2", got)
	}
}

func TestHandleSessionRequestPinPersistsSummaryWithoutPublishingUpdate(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-pin", "Pinned")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	var published []string
	c.sessionRecorder.SetEventPublisher(func(method string, _ any) error {
		published = append(published, method)
		return nil
	})
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj1", json.RawMessage(`{"sessionId":"sess-pin","pinned":true}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.pin): %v", err)
	}
	body := resp.(map[string]any)
	if body["ok"] != true || body["sessionId"] != "sess-pin" {
		t.Fatalf("session.pin response = %#v", body)
	}
	summary := sessionSummaryMap(t, body["session"])
	if summary["pinned"] != true {
		t.Fatalf("response pinned = %#v, want true", summary["pinned"])
	}
	if len(published) != 0 {
		t.Fatalf("published methods = %v, want none", published)
	}

	sessions, err := c.listSessionViews(ctx)
	if err != nil {
		t.Fatalf("listSessionViews: %v", err)
	}
	if len(sessions) != 1 || !sessions[0].Pinned {
		t.Fatalf("listed sessions = %#v, want pinned sess-pin", sessions)
	}

	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj1", json.RawMessage(`{"sessionId":"sess-pin","pinned":false}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.pin false): %v", err)
	}
	rec, err := c.store.LoadSession(ctx, "proj1", "sess-pin")
	if err != nil || rec == nil {
		t.Fatalf("LoadSession = %#v, %v", rec, err)
	}
	if sessionSyncProjectionFromJSON(rec.SessionSyncJSON).Pinned {
		t.Fatal("stored pinned = true, want false")
	}
}

func TestHandleSessionRequestMarkPersistsSummaryWithoutPublishingUpdate(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-mark", "Marked")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.sessionRecorder.SetSessionPinned(ctx, "sess-mark", true); err != nil {
		t.Fatalf("SetSessionPinned: %v", err)
	}

	var published []string
	c.sessionRecorder.SetEventPublisher(func(method string, _ any) error {
		published = append(published, method)
		return nil
	})
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-mark","markColor":"red"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.mark): %v", err)
	}
	body := resp.(map[string]any)
	summary := body["session"].(sessionViewSummary)
	if body["ok"] != true || body["sessionId"] != "sess-mark" || summary.MarkColor != "red" || !summary.Pinned {
		t.Fatalf("session.mark response = %#v", body)
	}
	if len(published) != 0 {
		t.Fatalf("published methods = %v, want none", published)
	}

	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-mark","markColor":""}`)); err != nil {
		t.Fatalf("clear session mark: %v", err)
	}
	rec, err := c.store.LoadSession(ctx, "proj1", "sess-mark")
	if err != nil || rec == nil {
		t.Fatalf("LoadSession = %#v, %v", rec, err)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	if projection.MarkColor != "" || !projection.Pinned {
		t.Fatalf("projection after clear = %#v", projection)
	}
}

func TestHandleSessionRequestMarkValidatesColorScopeAndAllowsRunningSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	for _, payload := range []json.RawMessage{
		json.RawMessage(`{"markColor":"red"}`),
		json.RawMessage(`{"sessionId":"missing","markColor":"red"}`),
		json.RawMessage(`{"sessionId":"missing","markColor":"purple"}`),
	} {
		if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", payload); err == nil {
			t.Fatalf("session.mark payload %s unexpectedly succeeded", payload)
		}
	}

	now := time.Now().UTC()
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              "same-mark-id",
		ProjectName:     "proj2",
		Status:          SessionPersisted,
		AgentType:       "claude",
		AgentJSON:       `{}`,
		SessionSyncJSON: sessionSyncJSON(0),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession other project: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj2", json.RawMessage(`{"sessionId":"same-mark-id","markColor":"blue"}`)); err == nil {
		t.Fatal("session.mark crossed the client project scope")
	}

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-running-mark", "Running")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-running-mark"}`)); err == nil {
		t.Fatal("session.mark accepted a missing markColor")
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-running-mark", "still running", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-running-mark","markColor":"green"}`))
	if err != nil {
		t.Fatalf("mark running session: %v", err)
	}
	summary := resp.(map[string]any)["session"].(sessionViewSummary)
	if !summary.Running || summary.MarkColor != "green" {
		t.Fatalf("running mark summary = %#v", summary)
	}
}

func TestHandleSessionRequestPinValidatesScopeAndAllowsRunningSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	for _, payload := range []json.RawMessage{
		json.RawMessage(`{"pinned":true}`),
		json.RawMessage(`{"sessionId":"missing","pinned":true}`),
	} {
		if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj1", payload); err == nil {
			t.Fatalf("session.pin payload %s unexpectedly succeeded", payload)
		}
	}

	now := time.Now().UTC()
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              "same-id",
		ProjectName:     "proj2",
		Status:          SessionPersisted,
		AgentType:       "claude",
		AgentJSON:       `{}`,
		SessionSyncJSON: sessionSyncJSON(0),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession other project: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj2", json.RawMessage(`{"sessionId":"same-id","pinned":true}`)); err == nil {
		t.Fatal("session.pin crossed the client project scope")
	}

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-running", "Running")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-running", "still running", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj1", json.RawMessage(`{"sessionId":"sess-running","pinned":true}`))
	if err != nil {
		t.Fatalf("pin running session: %v", err)
	}
	summary := resp.(map[string]any)["session"].(sessionViewSummary)
	if !summary.Running || !summary.Pinned {
		t.Fatalf("running pin summary = %#v, want running and pinned", summary)
	}
}

func TestSessionPinSurvivesCursorUpdatesAndRecorderRebuild(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-rebuild", "Rebuild")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionPin, "proj1", json.RawMessage(`{"sessionId":"sess-rebuild","pinned":true}`)); err != nil {
		t.Fatalf("pin session: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMark, "proj1", json.RawMessage(`{"sessionId":"sess-rebuild","markColor":"blue"}`)); err != nil {
		t.Fatalf("mark session: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-rebuild", "persist", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-rebuild", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionMarkRead, "proj1", json.RawMessage(`{"sessionId":"sess-rebuild","lastReadTurnIndex":2}`)); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-rebuild")
	if err != nil || rec == nil {
		t.Fatalf("LoadSession = %#v, %v", rec, err)
	}
	projection := sessionSyncProjectionFromJSON(rec.SessionSyncJSON)
	if !projection.Pinned || projection.MarkColor != "blue" ||
		projection.LastReadTurnIndex != 2 || projection.LatestPersistedTurnIndex != 2 {
		t.Fatalf("stored projection = %#v", projection)
	}
	rebuilt := newSessionRecorder("proj1", c.store, nil)
	summary := rebuilt.sessionViewSummaryFromRecord(*rec)
	if !summary.Pinned || summary.MarkColor != "blue" {
		t.Fatalf("rebuilt summary = %#v, want pinned and marked", summary)
	}
}

func TestSessionRecorderPromptFinishWithoutLiveStateSeedsPromptTimes(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	createdAt := mustRFC3339Time(t, "2026-05-06T13:00:00Z")
	finishedAt := mustRFC3339Time(t, "2026-05-06T13:00:12Z")

	created := sessionViewCreatedEvent("sess-1", "Timing Fallback")
	created.UpdatedAt = createdAt
	if err := c.RecordEvent(ctx, created); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	finished := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	finished.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, finished); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1", len(turns))
	}
	doneParam := decodeTurnParamMap(t, turns[0].Content)
	if got := doneParam["completedAt"]; got != finishedAt.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("prompt_done completedAt = %v, want %s", got, finishedAt.UTC().Format(time.RFC3339Nano))
	}
}

func TestSessionPersistKeepsRecorderLastActiveAtAndStoresLocalOffset(t *testing.T) {
	originalLocal := time.Local
	time.Local = time.FixedZone("UTC+8", 8*60*60)
	defer func() {
		time.Local = originalLocal
	}()

	c := newSessionViewTestClient(t)
	ctx := context.Background()

	createdAt := time.Date(2026, 5, 6, 22, 10, 33, 582878300, time.Local)
	startedAt := time.Date(2026, 5, 6, 22, 13, 35, 544978800, time.Local)
	finishedAt := time.Date(2026, 5, 6, 22, 31, 35, 451831900, time.Local)

	created := sessionViewCreatedEvent("sess-1", "Timing")
	created.UpdatedAt = createdAt
	if err := c.RecordEvent(ctx, created); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	sess, err := c.SessionByID(ctx, "sess-1")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}

	started := sessionViewPromptEvent("sess-1", "measure", nil)
	started.UpdatedAt = startedAt
	if err := c.RecordEvent(ctx, started); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}

	finished := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	finished.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, finished); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	sess.mu.Lock()
	sess.lastActiveAt = createdAt
	sess.mu.Unlock()
	if err := sess.persistSession(ctx); err != nil {
		t.Fatalf("persistSession: %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(finishedAt) {
		t.Fatalf("session LastActiveAt = %q, want %q", rec.LastActiveAt.Format(time.RFC3339Nano), finishedAt.Format(time.RFC3339Nano))
	}

	sqliteStore, ok := c.store.(*sqliteStore)
	if !ok {
		t.Fatalf("store type = %T, want *sqliteStore", c.store)
	}
	var rawLastActiveAt string
	if err := sqliteStore.db.QueryRowContext(ctx, `SELECT updated_at FROM sessions WHERE id = ?`, "sess-1").Scan(&rawLastActiveAt); err != nil {
		t.Fatalf("QueryRowContext session updated_at: %v", err)
	}
	if !strings.HasSuffix(rawLastActiveAt, "+08:00") {
		t.Fatalf("raw session last_active_at = %q, want +08:00 offset", rawLastActiveAt)
	}
}

func TestSessionPersistDoesNotAdvanceStoredLastActiveAt(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	createdAt := mustRFC3339Time(t, "2026-05-06T12:00:00Z")
	startedAt := mustRFC3339Time(t, "2026-05-06T12:01:02Z")
	finishedAt := mustRFC3339Time(t, "2026-05-06T12:01:27Z")

	created := sessionViewCreatedEvent("sess-1", "Timing")
	created.UpdatedAt = createdAt
	if err := c.RecordEvent(ctx, created); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	started := sessionViewPromptEvent("sess-1", "measure", nil)
	started.UpdatedAt = startedAt
	if err := c.RecordEvent(ctx, started); err != nil {
		t.Fatalf("RecordEvent prompt started: %v", err)
	}
	finished := sessionViewPromptFinishedEvent("sess-1", "end_turn")
	finished.UpdatedAt = finishedAt
	if err := c.RecordEvent(ctx, finished); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	sess, err := c.SessionByID(ctx, "sess-1")
	if err != nil {
		t.Fatalf("SessionByID: %v", err)
	}
	sess.mu.Lock()
	sess.lastActiveAt = finishedAt.Add(10 * time.Minute)
	sess.mu.Unlock()
	if err := sess.persistSession(ctx); err != nil {
		t.Fatalf("persistSession: %v", err)
	}

	rec, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if rec == nil {
		t.Fatal("LoadSession returned nil record")
	}
	if !rec.LastActiveAt.Equal(finishedAt) {
		t.Fatalf("session LastActiveAt = %q, want %q", rec.LastActiveAt.Format(time.RFC3339Nano), finishedAt.Format(time.RFC3339Nano))
	}
}

func TestSessionViewPersistsLegacySystemEventsButIgnoresACPSystemEvents(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "System Events")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "start", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewACPSystemEvent("sess-1", "from acp")); err != nil {
		t.Fatalf("RecordEvent acp system: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewSystemEvent("sess-1", "from legacy")); err != nil {
		t.Fatalf("RecordEvent legacy system: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3 (prompt + legacy system + prompt_done)", len(turns))
	}

	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(turns[1]), &msg); err != nil {
		t.Fatalf("unmarshal legacy system turn: %v", err)
	}
	if strings.TrimSpace(msg.Method) != acp.SessionTurnMethodSystem {
		t.Fatalf("legacy system turn method = %q, want %q", msg.Method, acp.SessionTurnMethodSystem)
	}
	result := acp.SessionTurnTextResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal legacy system result: %v", err)
	}
	if strings.TrimSpace(result.Text) != "from legacy" {
		t.Fatalf("legacy system text = %q, want %q", result.Text, "from legacy")
	}
}

func TestPromptTitleFromBlocks(t *testing.T) {
	if got := promptTitleFromBlocks([]acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: " hello "}}); got != "hello" {
		t.Fatalf("promptTitleFromBlocks(text) = %q, want %q", got, "hello")
	}
	if got := promptTitleFromBlocks([]acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: " first "}, {Type: acp.ContentBlockTypeText, Text: "second"}}); got != "first\nsecond" {
		t.Fatalf("promptTitleFromBlocks(multi-text) = %q, want %q", got, "first\nsecond")
	}
	if got := promptTitleFromBlocks([]acp.ContentBlock{{Type: acp.ContentBlockTypeImage, MimeType: "image/png", Data: "abc123"}}); got != "Sent an image" {
		t.Fatalf("promptTitleFromBlocks(image) = %q, want %q", got, "Sent an image")
	}
	if got := promptTitleFromBlocks(nil); got != "" {
		t.Fatalf("promptTitleFromBlocks(nil) = %q, want empty", got)
	}
}

func TestSessionRecorderUsesClientSessionIDWhenACPEventCarriesDifferentSessionID(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("client-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	promptEvent := SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: "client-1",
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"params": acp.SessionPromptParams{
				SessionID: "acp-1",
				Prompt:    []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "run"}},
			},
		}),
	}
	if err := c.RecordEvent(ctx, promptEvent); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	updateEvent := SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: "client-1",
		Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
			"params": acp.SessionUpdateParams{
				SessionID: "acp-1",
				Update: acp.SessionUpdate{
					SessionUpdate: acp.SessionUpdateAgentMessageChunk,
					Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
				},
			},
		}),
	}
	if err := c.RecordEvent(ctx, updateEvent); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "client-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns(client-1): %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("client turns len = %d, want 2", len(turns))
	}

	if _, _, err := c.sessionRecorder.ReadSessionTurns(ctx, "acp-1", 0); err == nil {
		t.Fatalf("ReadSessionTurns(acp-1) unexpectedly succeeded")
	}
}

func TestSessionViewToolUpdatesReuseSingleMessage(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Tools")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run build", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewToolUpdatedTextEvent("sess-1", "Running build")); err != nil {
		t.Fatalf("RecordEvent tool updated #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewToolUpdatedTextEvent("sess-1", "Build finished")); err != nil {
		t.Fatalf("RecordEvent tool updated #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	if got := decodeTurnSessionUpdate(t, turns[1]).Title; strings.TrimSpace(got) != "Build finished" {
		t.Fatalf("turns[1].title = %q, want Build finished", got)
	}
}

func TestSessionViewPersistsSessionUpdateParamsPayload(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Raw Update")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "say hi", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	updateChunk1 := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
	}
	updateChunk2 := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(map[string]any{"text": " world"}),
	}

	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", updateChunk1)); err != nil {
		t.Fatalf("RecordEvent chunk #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", updateChunk2)); err != nil {
		t.Fatalf("RecordEvent chunk #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	stored := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(stored) != 3 {
		t.Fatalf("stored len = %d, want 3", len(stored))
	}
	updateStored := decodeTurnSessionUpdate(t, stored[1])
	if strings.TrimSpace(updateStored.SessionUpdate) != acp.SessionUpdateAgentMessageChunk {
		t.Fatalf("stored assistant update kind = %q, want %q", updateStored.SessionUpdate, acp.SessionUpdateAgentMessageChunk)
	}
	if text := strings.TrimSpace(extractTextChunk(updateStored.Content)); text != "hello world" {
		t.Fatalf("stored assistant text = %q, want hello world", text)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	rawMessages, err := json.Marshal(body["turns"])
	if err != nil {
		t.Fatalf("json.Marshal(turns): %v", err)
	}
	var messages []struct {
		TurnIndex int64  `json:"turnIndex"`
		Content   string `json:"content"`
	}
	if err := json.Unmarshal(rawMessages, &messages); err != nil {
		t.Fatalf("json.Unmarshal(turns): %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("turns len = %d, want 3", len(messages))
	}
	if messages[1].TurnIndex != 2 {
		t.Fatalf("messages[1].TurnIndex = %d, want 2", messages[1].TurnIndex)
	}
	update2 := decodeTurnSessionUpdate(t, messages[1].Content)
	if strings.TrimSpace(extractTextChunk(update2.Content)) != "hello world" {
		t.Fatalf("messages[1] text = %q, want hello world", extractTextChunk(update2.Content))
	}
}

func TestSessionViewSessionUpdateMergeUsesACPUpdateType(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Merge")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	userChunk := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateUserMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "user says hi"}),
	}
	agentChunk := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "assistant says hi"}),
	}

	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", userChunk)); err != nil {
		t.Fatalf("RecordEvent user chunk: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", agentChunk)); err != nil {
		t.Fatalf("RecordEvent agent chunk: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 4 {
		t.Fatalf("turns len = %d, want 4; turns=%+v", len(turns), turns)
	}
	seen := map[string]string{}
	for _, turn := range turns {
		if decodeTurnMethod(t, turn.Content) == acp.MethodSessionPrompt {
			continue
		}
		update := decodeTurnSessionUpdate(t, turn.Content)
		seen[update.SessionUpdate] = extractTextChunk(update.Content)
	}
	if got := seen[acp.SessionUpdateUserMessageChunk]; got != "user says hi" {
		t.Fatalf("user chunk text = %q, want %q", got, "user says hi")
	}
	if got := seen[acp.SessionUpdateAgentMessageChunk]; got != "assistant says hi" {
		t.Fatalf("assistant chunk text = %q, want %q", got, "assistant says hi")
	}
}

func TestSessionViewKeepsUserMessageChunkTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "User Chunk")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateUserMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "user says hi"}),
	})); err != nil {
		t.Fatalf("RecordEvent user chunk: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3; turns=%+v", len(turns), turns)
	}
	if got := decodeTurnMethod(t, turns[1].Content); got != acp.SessionUpdateUserMessageChunk {
		t.Fatalf("turns[1] method = %q, want %q", got, acp.SessionUpdateUserMessageChunk)
	}
}

func TestParseSessionViewEventUserMessageChunkAsMessage(t *testing.T) {
	event := sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateUserMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "user says hi"}),
	})
	parsed, err := parseSessionViewEvent(event)
	if err != nil {
		t.Fatalf("parseSessionViewEvent: %v", err)
	}
	if !parsed.bMessage {
		t.Fatal("parsed.bMessage = false, want true")
	}
	if parsed.method != acp.SessionUpdateUserMessageChunk {
		t.Fatalf("parsed.method = %q, want %q", parsed.method, acp.SessionUpdateUserMessageChunk)
	}
}

func TestSessionViewSystemMessageIsNotPersisted(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "No System")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewSystemEvent("sess-1", "max_output_tokens")); err != nil {
		t.Fatalf("RecordEvent system message: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("turns len = %d, want 0", len(turns))
	}
}

func TestSessionViewUpdateWithoutPromptIsDropped(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "No Prompt")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("turns len = %d, want 0", len(turns))
	}
}

func TestSessionViewMergedTurnPublishesIncomingContentWithMergedIndices(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	var published []map[string]any
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, body)
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Merge Publish")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "say hi", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
		Status:        "streaming",
	})); err != nil {
		t.Fatalf("RecordEvent update1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"}),
		Status:        "done",
	})); err != nil {
		t.Fatalf("RecordEvent update2: %v", err)
	}

	if len(published) < 3 {
		t.Fatalf("published len = %d, want at least 3", len(published))
	}
	last := published[len(published)-1]
	turn := publishedTurnMap(t, last)
	if got := turn["turnIndex"].(int64); got != 2 {
		t.Fatalf("published turnIndex = %d, want 2", got)
	}
	if _, ok := last["updateIndex"]; ok {
		t.Fatalf("published payload unexpectedly contains updateIndex: %+v", last)
	}
	content, _ := turn["content"].(string)
	if text := extractTextChunk(decodeTurnSessionUpdate(t, content).Content); text != "helloworld" {
		t.Fatalf("published content text = %q, want helloworld", text)
	}
}

func TestSessionViewThoughtSnapshotsAreThrottledAndBoundaryFlushed(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	c.sessionRecorder.now = func() time.Time { return now }
	published := captureSessionMessageEvents(t, c)
	record := func(event SessionViewEvent) {
		t.Helper()
		if err := c.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}
	thought := func(text string) SessionViewEvent {
		return sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: text}),
			Status:        "streaming",
		})
	}

	record(sessionViewCreatedEvent("sess-1", "Thought throttle"))
	record(sessionViewPromptEvent("sess-1", "run", nil))
	record(thought("one"))
	now = now.Add(59 * time.Second)
	record(thought(" two"))
	if got := len(publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)); got != 1 {
		t.Fatalf("thought publishes before interval = %d, want 1", got)
	}

	now = now.Add(time.Second)
	record(thought(" three"))
	thoughtTurns := publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)
	if len(thoughtTurns) != 2 {
		t.Fatalf("thought publishes at interval = %d, want 2", len(thoughtTurns))
	}
	second := decodeTurnSessionUpdate(t, thoughtTurns[1].Content)
	if text := extractTextChunk(second.Content); text != "one two three" {
		t.Fatalf("second thought snapshot = %q, want latest complete text", text)
	}

	record(thought(" four"))
	record(sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCall,
		ToolCallID:    "tool-1",
		Title:         "Read files",
		Status:        "in_progress",
	}))
	thoughtTurns = publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)
	if len(thoughtTurns) != 3 || !thoughtTurns[2].Finished {
		t.Fatalf("boundary thought publishes = %+v, want final finished snapshot", thoughtTurns)
	}
	final := decodeTurnSessionUpdate(t, thoughtTurns[2].Content)
	if text := extractTextChunk(final.Content); text != "one two three four" {
		t.Fatalf("final thought snapshot = %q, want complete text", text)
	}
	lastTwo := (*published)[len(*published)-2:]
	if decodeSessionTurnMessage(t, decodePublishedTurnMessage(t, lastTwo[0].payload).Content).Method != acp.SessionTurnMethodAgentThought {
		t.Fatalf("penultimate event is not sealed thought: %+v", lastTwo[0])
	}
	if decodeSessionTurnMessage(t, decodePublishedTurnMessage(t, lastTwo[1].payload).Content).Method != acp.SessionTurnMethodToolCall {
		t.Fatalf("last event is not tool call: %+v", lastTwo[1])
	}
}

func TestSessionViewEmptyThoughtChunksAreIgnored(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	published := captureSessionMessageEvents(t, c)

	for _, event := range []SessionViewEvent{
		sessionViewCreatedEvent("sess-empty-thought", "Empty thought"),
		sessionViewPromptEvent("sess-empty-thought", "run", nil),
		sessionViewUpdateEvent("sess-empty-thought", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " \n\t"}),
			Status:        "streaming",
		}),
		sessionViewUpdateEvent("sess-empty-thought", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateToolCall,
			ToolCallID:    "tool-1",
			Title:         "Read files",
			Status:        "completed",
		}),
		sessionViewPromptFinishedEvent("sess-empty-thought", acp.StopReasonEndTurn),
	} {
		if err := c.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}

	if thoughts := publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought); len(thoughts) != 0 {
		t.Fatalf("published empty thoughts = %+v, want none", thoughts)
	}
	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-empty-thought", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	methods := make([]string, 0, len(turns))
	for _, turn := range turns {
		methods = append(methods, decodeSessionTurnMessage(t, turn.Content).Method)
	}
	want := []string{
		acp.SessionTurnMethodPromptRequest,
		acp.SessionTurnMethodToolCall,
		acp.SessionTurnMethodPromptDone,
	}
	if !reflect.DeepEqual(methods, want) {
		t.Fatalf("persisted methods = %v, want %v", methods, want)
	}
}

func TestSessionViewThoughtPromptDoneFlushesSuppressedContentAndPersistsIt(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 19, 11, 0, 0, 0, time.UTC)
	c.sessionRecorder.now = func() time.Time { return now }
	published := captureSessionMessageEvents(t, c)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Thought done")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	for _, text := range []string{"alpha", " beta", " gamma"} {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: text}),
			Status:        "streaming",
		})); err != nil {
			t.Fatalf("RecordEvent thought: %v", err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	thoughtTurns := publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)
	if len(thoughtTurns) != 2 || !thoughtTurns[1].Finished {
		t.Fatalf("published thoughts = %+v, want initial and final", thoughtTurns)
	}
	lastTwo := (*published)[len(*published)-2:]
	if decodeSessionTurnMessage(t, decodePublishedTurnMessage(t, lastTwo[0].payload).Content).Method != acp.SessionTurnMethodAgentThought {
		t.Fatalf("event before prompt_done is not thought: %+v", lastTwo[0])
	}
	if decodeSessionTurnMessage(t, decodePublishedTurnMessage(t, lastTwo[1].payload).Content).Method != acp.SessionTurnMethodPromptDone {
		t.Fatalf("last event is not prompt_done: %+v", lastTwo[1])
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	for _, turn := range turns {
		if decodeSessionTurnMessage(t, turn.Content).Method != acp.SessionTurnMethodAgentThought {
			continue
		}
		update := decodeTurnSessionUpdate(t, turn.Content)
		if text := extractTextChunk(update.Content); text != "alpha beta gamma" {
			t.Fatalf("persisted thought = %q, want all chunks", text)
		}
		return
	}
	t.Fatal("persisted thought turn not found")
}

func TestSessionViewThoughtCancellationFlushesSuppressedContentBeforePromptDone(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	c.sessionRecorder.now = func() time.Time {
		return time.Date(2026, 7, 19, 11, 30, 0, 0, time.UTC)
	}
	published := captureSessionMessageEvents(t, c)

	for _, event := range []SessionViewEvent{
		sessionViewCreatedEvent("sess-cancel", "Thought cancel"),
		sessionViewPromptEvent("sess-cancel", "run", nil),
		sessionViewUpdateEvent("sess-cancel", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "before"}),
			Status:        "streaming",
		}),
		sessionViewUpdateEvent("sess-cancel", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " cancel"}),
			Status:        "streaming",
		}),
		sessionViewPromptFinishedEvent("sess-cancel", acp.StopReasonCancelled),
	} {
		if err := c.RecordEvent(ctx, event); err != nil {
			t.Fatalf("RecordEvent: %v", err)
		}
	}

	thoughtTurns := publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)
	if len(thoughtTurns) != 2 || !thoughtTurns[1].Finished {
		t.Fatalf("published thoughts = %+v, want initial and final", thoughtTurns)
	}
	final := decodeTurnSessionUpdate(t, thoughtTurns[1].Content)
	if text := extractTextChunk(final.Content); text != "before cancel" {
		t.Fatalf("final thought snapshot = %q, want complete cancelled text", text)
	}
	lastTwo := (*published)[len(*published)-2:]
	if decodeSessionTurnMessage(t, decodePublishedTurnMessage(t, lastTwo[0].payload).Content).Method != acp.SessionTurnMethodAgentThought {
		t.Fatalf("event before cancelled prompt_done is not thought: %+v", lastTwo[0])
	}
	publishedPromptDone := decodePublishedTurnMessage(t, lastTwo[1].payload)
	promptDone := decodeSessionTurnMessage(t, publishedPromptDone.Content)
	if promptDone.Method != acp.SessionTurnMethodPromptDone || decodePromptDoneStopReason(t, publishedPromptDone.Content) != acp.StopReasonCancelled {
		t.Fatalf("last event is not cancelled prompt_done: %+v", lastTwo[1])
	}
}

func TestSessionViewThoughtThrottleIsIsolatedBySession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	c.sessionRecorder.now = func() time.Time { return now }
	published := captureSessionMessageEvents(t, c)

	for _, sessionID := range []string{"sess-1", "sess-2"} {
		if err := c.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, sessionID)); err != nil {
			t.Fatalf("RecordEvent session created: %v", err)
		}
		if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "run", nil)); err != nil {
			t.Fatalf("RecordEvent prompt: %v", err)
		}
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateAgentThoughtChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: sessionID}),
			Status:        "streaming",
		})); err != nil {
			t.Fatalf("RecordEvent thought: %v", err)
		}
	}
	thoughtTurns := publishedTurnsByMethod(t, *published, acp.SessionTurnMethodAgentThought)
	if len(thoughtTurns) != 2 {
		t.Fatalf("first thought publish count = %d, want 2", len(thoughtTurns))
	}
}

func TestSessionViewPromptFinishedPublishesPromptDoneMessage(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	var published []map[string]any
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, body)
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Done Publish")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewAssistantChunkTextEvent("sess-1", "hello", "streaming")); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if len(published) < 3 {
		t.Fatalf("published len = %d, want at least 3", len(published))
	}
	last := published[len(published)-1]
	if _, ok := last["promptIndex"]; ok {
		t.Fatalf("published payload unexpectedly contains promptIndex: %+v", last)
	}
	turn := publishedTurnMap(t, last)
	if got := turn["turnIndex"].(int64); got != 3 {
		t.Fatalf("published turnIndex = %d, want 3", got)
	}
	content, _ := turn["content"].(string)
	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(content), &msg); err != nil {
		t.Fatalf("unmarshal prompt_done content: %v", err)
	}
	if strings.TrimSpace(msg.Method) != acp.SessionTurnMethodPromptDone {
		t.Fatalf("published method = %q, want %q", msg.Method, acp.SessionTurnMethodPromptDone)
	}
	result := acp.SessionTurnPromptResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal prompt_done param: %v", err)
	}
	if strings.TrimSpace(result.StopReason) != acp.StopReasonEndTurn {
		t.Fatalf("stopReason = %q, want %q", result.StopReason, acp.StopReasonEndTurn)
	}
}

func TestSessionRecorderPromptDoneWritesDiffArtifact(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Diff Artifact")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	done := sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn)
	done.Artifacts = []acp.SessionPromptArtifactPayload{{
		Type:    "diff",
		Format:  "unified-diff",
		Content: promptDiffArtifactSampleDiff,
	}}
	if err := c.RecordEvent(ctx, done); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want prompt_request + prompt_done", len(turns))
	}
	if strings.Contains(turns[1].Content, "diff --git") {
		t.Fatalf("prompt_done content includes full diff: %s", turns[1].Content)
	}
	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(turns[1].Content), &msg); err != nil {
		t.Fatalf("unmarshal prompt_done content: %v", err)
	}
	result := acp.SessionTurnPromptResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal prompt_done param: %v", err)
	}
	if len(result.Artifacts) != 1 {
		t.Fatalf("artifacts len = %d, want 1", len(result.Artifacts))
	}
	artifact := result.Artifacts[0]
	if artifact.Type != "diff" || artifact.Format != "unified-diff" || artifact.FileCount != 3 {
		t.Fatalf("artifact metadata = %+v, want diff unified-diff with 3 files", artifact)
	}
	if len(artifact.Files) != 3 || artifact.Files[0].Path != "app/web/src/app/WorkspaceApp.tsx" {
		t.Fatalf("artifact files = %+v, want parsed file metadata", artifact.Files)
	}
	paramMap := map[string]any{}
	if err := json.Unmarshal(msg.Param, &paramMap); err != nil {
		t.Fatalf("unmarshal prompt_done param map: %v", err)
	}
	artifactMaps, ok := paramMap["artifacts"].([]any)
	if !ok || len(artifactMaps) != 1 {
		t.Fatalf("artifact maps = %#v, want one artifact", paramMap["artifacts"])
	}
	firstArtifact, ok := artifactMaps[0].(map[string]any)
	if !ok {
		t.Fatalf("artifact map type = %T", artifactMaps[0])
	}
	if _, ok := firstArtifact["content"]; ok {
		t.Fatalf("artifact metadata unexpectedly contains content: %#v", firstArtifact)
	}

	body, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, "proj1", "sess-1", artifact.ArtifactID)
	if err != nil {
		t.Fatalf("ReadArtifact: %v", err)
	}
	if body.Content != promptDiffArtifactSampleDiff {
		t.Fatalf("artifact content = %q, want original diff", body.Content)
	}
}

func TestSessionRecorderPersistsPromptForkPoint(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-fork-point", "Fork Point")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-fork-point", "fork me", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	done := sessionViewPromptFinishedEvent("sess-fork-point", acp.StopReasonEndTurn)
	done.ForkPoint = &acp.SessionForkPoint{Provider: string(acp.ACPProviderCodex), Ref: "turn-native-1"}
	if err := c.RecordEvent(ctx, done); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-fork-point", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	point := promptDoneForkPointForTest(t, turns[len(turns)-1])
	if point == nil || point.Provider != string(acp.ACPProviderCodex) || point.Ref != "turn-native-1" {
		t.Fatalf("forkPoint = %#v", point)
	}
}

func TestSessionReadEnrichesLegacyCodexPromptDoneWithoutRewritingWMT2(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sessionID := "sess-legacy-fork"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "Legacy Fork", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "legacy prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	c.InjectForwarder(string(acp.ACPProviderCodex), sessionID, nil, nil)
	runtime := c.sessions[sessionID].instance.(*testInjectedInstance)
	resolveCalls := 0
	runtime.resolveForkFn = func(_ context.Context, gotSessionID string, prompts []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
		resolveCalls++
		if gotSessionID != sessionID || len(prompts) != 1 || prompts[0].DoneTurnIndex != 2 {
			t.Fatalf("resolve input session=%q prompts=%#v", gotSessionID, prompts)
		}
		return map[int64]acp.SessionForkPoint{
			2: {Provider: string(acp.ACPProviderCodex), Ref: "turn-legacy-1"},
		}, nil
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-legacy-fork"}`))
	if err != nil {
		t.Fatalf("session.read: %v", err)
	}
	body := responseMapForTest(t, resp)
	responseTurns := responseTurnsForTest(t, body["turns"])
	point := promptDoneForkPointForTest(t, responseTurns[len(responseTurns)-1])
	if point == nil || point.Ref != "turn-legacy-1" {
		t.Fatalf("response forkPoint = %#v", point)
	}
	if resolveCalls != 1 {
		t.Fatalf("resolve calls = %d, want 1", resolveCalls)
	}

	_, storedTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns raw: %v", err)
	}
	if point := promptDoneForkPointForTest(t, storedTurns[len(storedTurns)-1]); point != nil {
		t.Fatalf("stored legacy turn was rewritten: %#v", point)
	}
}

func TestSessionTurnsNeedForkPointIgnoresCancelledPrompt(t *testing.T) {
	cancelled := []sessionViewTurn{{
		TurnIndex: 2,
		Content:   `{"method":"prompt_done","param":{"stopReason":"cancelled"}}`,
		Finished:  true,
	}}
	if sessionTurnsNeedForkPoint(cancelled) {
		t.Fatal("cancelled prompt unexpectedly requires legacy fork-point enrichment")
	}

	completed := []sessionViewTurn{{
		TurnIndex: 2,
		Content:   `{"method":"prompt_done","param":{"stopReason":"end_turn"}}`,
		Finished:  true,
	}}
	if !sessionTurnsNeedForkPoint(completed) {
		t.Fatal("completed prompt without a fork point should require legacy enrichment")
	}
}

func TestSessionReadCXDeepSeekEnrichesLegacyForkPointWithProviderIdentity(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sessionID := "sess-cx-legacy-fork"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "CX Legacy Fork", string(acp.ACPProviderCXDeepSeek))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "legacy prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	c.InjectForwarder(string(acp.ACPProviderCXDeepSeek), sessionID, nil, nil)
	runtime := c.sessions[sessionID].instance.(*testInjectedInstance)
	resolveCalls := 0
	runtime.resolveForkFn = func(_ context.Context, gotSessionID string, prompts []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
		resolveCalls++
		if gotSessionID != sessionID || len(prompts) != 1 || prompts[0].DoneTurnIndex != 2 {
			t.Fatalf("resolve input session=%q prompts=%#v", gotSessionID, prompts)
		}
		return map[int64]acp.SessionForkPoint{
			2: {Provider: string(acp.ACPProviderCXDeepSeek), Ref: "turn-cx-legacy-1"},
		}, nil
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-cx-legacy-fork"}`))
	if err != nil {
		t.Fatalf("session.read: %v", err)
	}
	body := responseMapForTest(t, resp)
	responseTurns := responseTurnsForTest(t, body["turns"])
	point := promptDoneForkPointForTest(t, responseTurns[len(responseTurns)-1])
	if point == nil || point.Provider != string(acp.ACPProviderCXDeepSeek) || point.Ref != "turn-cx-legacy-1" {
		t.Fatalf("response forkPoint = %#v", point)
	}
	if resolveCalls != 1 {
		t.Fatalf("resolve calls = %d, want 1", resolveCalls)
	}
}

func TestSessionReadLeavesLegacyPromptDoneUnforkableWhenProviderCannotMatch(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sessionID := "sess-legacy-mismatch"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "Legacy Mismatch", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "legacy prompt", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	c.InjectForwarder(string(acp.ACPProviderCodex), sessionID, nil, nil)
	c.sessions[sessionID].instance.(*testInjectedInstance).resolveForkFn = func(context.Context, string, []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
		return map[int64]acp.SessionForkPoint{}, nil
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionRead, "proj1", json.RawMessage(`{"sessionId":"sess-legacy-mismatch"}`))
	if err != nil {
		t.Fatalf("session.read: %v", err)
	}
	body := responseMapForTest(t, resp)
	responseTurns := responseTurnsForTest(t, body["turns"])
	if point := promptDoneForkPointForTest(t, responseTurns[len(responseTurns)-1]); point != nil {
		t.Fatalf("response contains guessed forkPoint: %#v", point)
	}
}

func TestHandleSessionForkCreatesIndependentTargetHistory(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sourceID := "sess-fork-source"
	targetID := "sess-fork-target"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Source title", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithForkPointForTest(t, c, sourceID, "first", "source-turn-1")
	recordPromptWithForkPointForTest(t, c, sourceID, "second", "source-turn-2")
	c.InjectForwarder(string(acp.ACPProviderCodex), sourceID, nil, nil)
	setSessionWMActionsForTest(t, c, sourceID, acp.WMSessionActionCapabilities{Fork: true})
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	runtime.forkSessionFn = func(_ context.Context, gotSessionID string, lastTurnID string, prompts []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		if gotSessionID != sourceID || lastTurnID != "source-turn-1" {
			t.Fatalf("fork input session=%q lastTurnID=%q", gotSessionID, lastTurnID)
		}
		if len(prompts) != 1 || prompts[0].DoneTurnIndex != 2 {
			t.Fatalf("fork prompts=%#v", prompts)
		}
		return acp.SessionForkResult{
			SessionID: targetID,
			Title:     "Forked title",
			ForkPoints: map[int64]acp.SessionForkPoint{
				2: {Provider: string(acp.ACPProviderCodex), Ref: "target-turn-1"},
			},
		}, nil
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-fork-source","turnIndex":2}`))
	if err != nil {
		t.Fatalf("session.fork: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("response = %#v", body)
	}
	summaryRaw, err := json.Marshal(body["session"])
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	var summary sessionViewSummary
	if err := json.Unmarshal(summaryRaw, &summary); err != nil {
		t.Fatalf("unmarshal summary: %v", err)
	}
	if summary.SessionID != targetID || summary.ForkedFrom == nil {
		t.Fatalf("summary = %#v", summary)
	}
	if summary.ForkedFrom.SessionID != sourceID || summary.ForkedFrom.TurnIndex != 2 || summary.ForkedFrom.Title != "Source title" {
		t.Fatalf("forkedFrom = %#v", summary.ForkedFrom)
	}

	_, targetTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, targetID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns target: %v", err)
	}
	if len(targetTurns) != 3 {
		t.Fatalf("target turns len = %d, want prompt_request + prompt_done + fork operation", len(targetTurns))
	}
	if point := promptDoneForkPointForTest(t, targetTurns[1]); point == nil || point.Ref != "target-turn-1" {
		t.Fatalf("target prompt_done forkPoint = %#v", point)
	}
	var operationMessage acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(targetTurns[2].Content), &operationMessage); err != nil {
		t.Fatalf("unmarshal operation: %v", err)
	}
	var operation acp.SessionOperationPayload
	if operationMessage.Method != acp.SessionTurnMethodOperation || json.Unmarshal(operationMessage.Param, &operation) != nil {
		t.Fatalf("operation message = %#v", operationMessage)
	}
	if operation.Type != acp.SessionOperationTypeFork || operation.Status != acp.SessionOperationStatusCompleted || operation.ForkedFrom == nil {
		t.Fatalf("operation = %#v", operation)
	}

	_, sourceTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, sourceID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns source: %v", err)
	}
	if len(sourceTurns) != 4 {
		t.Fatalf("source turns len = %d, want unchanged 4", len(sourceTurns))
	}
}

func TestHandleCXDeepSeekSessionForkPreservesProviderIdentity(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	c.registry = agent.NewACPFactory()
	ctx := context.Background()
	sourceID := "sess-cx-fork-source"
	targetID := "sess-cx-fork-target"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "CX Source", string(acp.ACPProviderCXDeepSeek))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithProviderForkPointForTest(t, c, sourceID, "first", string(acp.ACPProviderCXDeepSeek), "source-cx-turn-1")
	c.InjectForwarder(string(acp.ACPProviderCXDeepSeek), sourceID, nil, nil)
	setSessionWMActionsForTest(t, c, sourceID, acp.WMSessionActionCapabilities{Fork: true})
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	runtime.forkSessionFn = func(_ context.Context, gotSessionID string, lastTurnID string, prompts []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		if gotSessionID != sourceID || lastTurnID != "source-cx-turn-1" || len(prompts) != 1 {
			t.Fatalf("fork input session=%q lastTurnID=%q prompts=%#v", gotSessionID, lastTurnID, prompts)
		}
		return acp.SessionForkResult{
			SessionID: targetID,
			Title:     "CX Forked",
			ForkPoints: map[int64]acp.SessionForkPoint{
				2: {Provider: string(acp.ACPProviderCXDeepSeek), Ref: "target-cx-turn-1"},
			},
		}, nil
	}

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-cx-fork-source","turnIndex":2}`))
	if err != nil {
		t.Fatalf("session.fork: %v", err)
	}
	body := responseMapForTest(t, resp)
	summaryRaw, err := json.Marshal(body["session"])
	if err != nil {
		t.Fatal(err)
	}
	var summary sessionViewSummary
	if err := json.Unmarshal(summaryRaw, &summary); err != nil {
		t.Fatal(err)
	}
	if summary.SessionID != targetID || summary.AgentType != string(acp.ACPProviderCXDeepSeek) {
		t.Fatalf("target summary = %#v", summary)
	}
	record, err := c.store.LoadSession(ctx, c.projectName, targetID)
	if err != nil || record == nil || record.AgentType != string(acp.ACPProviderCXDeepSeek) {
		t.Fatalf("target record = %#v, err=%v", record, err)
	}
	_, targetTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, targetID, 0)
	if err != nil {
		t.Fatal(err)
	}
	point := promptDoneForkPointForTest(t, targetTurns[1])
	if point == nil || point.Provider != string(acp.ACPProviderCXDeepSeek) || point.Ref != "target-cx-turn-1" {
		t.Fatalf("target fork point = %#v", point)
	}
}

func TestHandleCXDeepSeekSessionForkRejectsMismatchedPointProvider(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	c.registry = agent.NewACPFactory()
	ctx := context.Background()
	sessionID := "sess-cx-fork-mismatch"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "CX Mismatch", string(acp.ACPProviderCXDeepSeek))); err != nil {
		t.Fatal(err)
	}
	recordPromptWithProviderForkPointForTest(t, c, sessionID, "first", string(acp.ACPProviderCodex), "wrong-provider-turn")
	c.InjectForwarder(string(acp.ACPProviderCXDeepSeek), sessionID, nil, nil)
	setSessionWMActionsForTest(t, c, sessionID, acp.WMSessionActionCapabilities{Fork: true})
	c.sessions[sessionID].instance.(*testInjectedInstance).forkSessionFn = func(context.Context, string, string, []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		t.Fatal("provider fork must not be called for mismatched fork point")
		return acp.SessionForkResult{}, nil
	}

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-cx-fork-mismatch","turnIndex":2}`))
	if err == nil || !strings.Contains(err.Error(), "does not match source agent") {
		t.Fatalf("session.fork error = %v, want provider mismatch", err)
	}
}

func TestHandleSessionForkRejectsMissingForkPoint(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sessionID := "sess-fork-missing"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "Missing", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "legacy", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent done: %v", err)
	}
	c.InjectForwarder(string(acp.ACPProviderCodex), sessionID, nil, nil)
	setSessionWMActionsForTest(t, c, sessionID, acp.WMSessionActionCapabilities{Fork: true})
	c.sessions[sessionID].instance.(*testInjectedInstance).resolveForkFn = func(context.Context, string, []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
		return map[int64]acp.SessionForkPoint{}, nil
	}

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-fork-missing","turnIndex":2}`))
	if err == nil || !strings.Contains(err.Error(), "fork point") {
		t.Fatalf("session.fork error = %v, want missing fork point", err)
	}
}

func TestHandleSessionForkRejectsUnsupportedCapabilityBeforeProviderCall(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sessionID := "sess-fork-unsupported"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sessionID, "Unsupported", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithForkPointForTest(t, c, sessionID, "first", "source-turn-1")
	c.InjectForwarder(string(acp.ACPProviderCodex), sessionID, nil, nil)
	runtime := c.sessions[sessionID].instance.(*testInjectedInstance)
	forkCalls := 0
	runtime.forkSessionFn = func(context.Context, string, string, []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		forkCalls++
		return acp.SessionForkResult{}, nil
	}

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-fork-unsupported","turnIndex":2}`))
	if err == nil || !errors.Is(err, agent.ErrSessionActionUnsupported) {
		t.Fatalf("session.fork error = %v, want unsupported action", err)
	}
	if forkCalls != 0 {
		t.Fatalf("provider fork calls = %d, want 0", forkCalls)
	}
}

func TestHandleSessionForkArchivesNativeTargetWithoutDeletingLocalConflict(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sourceID := "sess-fork-conflict-source"
	targetID := "sess-fork-conflict-target"

	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Source", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithForkPointForTest(t, c, sourceID, "first", "source-turn-1")
	now := time.Now().UTC()
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              targetID,
		ProjectName:     c.projectName,
		Status:          SessionPersisted,
		AgentType:       string(acp.ACPProviderCodex),
		Title:           "Existing local session",
		SessionSyncJSON: sessionSyncJSON(0),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession conflict: %v", err)
	}
	c.InjectForwarder(string(acp.ACPProviderCodex), sourceID, nil, nil)
	setSessionWMActionsForTest(t, c, sourceID, acp.WMSessionActionCapabilities{Fork: true})
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	runtime.forkSessionFn = func(context.Context, string, string, []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		return acp.SessionForkResult{
			SessionID: targetID,
			ForkPoints: map[int64]acp.SessionForkPoint{
				2: {Provider: string(acp.ACPProviderCodex), Ref: "target-turn-1"},
			},
		}, nil
	}

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-fork-conflict-source","turnIndex":2}`))
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("session.fork error = %v, want local conflict", err)
	}
	stored, loadErr := c.store.LoadSession(ctx, c.projectName, targetID)
	if loadErr != nil || stored == nil || stored.Title != "Existing local session" {
		t.Fatalf("local conflict after fork = %#v err=%v", stored, loadErr)
	}
	if !reflect.DeepEqual(runtime.archiveCalls, []string{targetID}) {
		t.Fatalf("archive calls = %#v, want native target cleanup", runtime.archiveCalls)
	}
}

func TestForkHistoryCopiesArtifactsAndReferencedAttachments(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-copy-source")
	ctx := context.Background()
	sourceID := "sess-copy-source"
	targetID := "sess-copy-target"
	setSessionWMActionsForTest(t, c, sourceID, acp.WMSessionActionCapabilities{Fork: true})
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Copy payloads", string(acp.ACPProviderCodex))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	block := uploadSessionAttachmentForTest(t, c, sourceID, "note.txt", "text/plain", []byte("fork attachment"))
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sourceID, "", []acp.ContentBlock{block})); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	steeredBlock := uploadSessionAttachmentForTest(t, c, sourceID, "change.txt", "text/plain", []byte("steered attachment"))
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sourceID, acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateUserMessageChunk,
		ContentBlocks: []acp.ContentBlock{
			{Type: acp.ContentBlockTypeText, Text: "use this too"},
			steeredBlock,
		},
		ClientMessageID: "queued-copy",
		Steered:         true,
	})); err != nil {
		t.Fatalf("RecordEvent steer: %v", err)
	}
	done := sessionViewPromptFinishedEvent(sourceID, acp.StopReasonEndTurn)
	done.ForkPoint = &acp.SessionForkPoint{Provider: string(acp.ACPProviderCodex), Ref: "source-copy-turn"}
	done.Artifacts = []acp.SessionPromptArtifactPayload{{
		Type:    sessionArtifactTypeDiff,
		Format:  sessionArtifactFormatDiff,
		Content: promptDiffArtifactSampleDiff,
	}}
	if err := c.RecordEvent(ctx, done); err != nil {
		t.Fatalf("RecordEvent done: %v", err)
	}
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	var forkPrompts []acp.SessionForkPrompt
	runtime.forkSessionFn = func(_ context.Context, _, _ string, prompts []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
		forkPrompts = prompts
		return acp.SessionForkResult{
			SessionID: targetID,
			Title:     "Copied target",
			ForkPoints: map[int64]acp.SessionForkPoint{
				3: {Provider: string(acp.ACPProviderCodex), Ref: "target-copy-turn"},
			},
		}, nil
	}

	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-copy-source","turnIndex":3}`)); err != nil {
		t.Fatalf("session.fork: %v", err)
	}
	if len(forkPrompts) != 1 || len(forkPrompts[0].ContentBlocks) != 3 {
		t.Fatalf("fork prompts = %#v, want prompt plus steered blocks", forkPrompts)
	}
	_, targetTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, targetID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns target: %v", err)
	}
	targetBlock := promptRequestBlocksForTest(t, targetTurns[0])[0]
	if targetBlock.URI == block.URI || !strings.Contains(targetBlock.URI, safeHistoryPathPart(targetID)) {
		t.Fatalf("target attachment uri = %q, source = %q", targetBlock.URI, block.URI)
	}
	var steeredMessage acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(targetTurns[1].Content), &steeredMessage); err != nil {
		t.Fatalf("unmarshal target steer: %v", err)
	}
	var targetSteer acp.SessionTurnUserMessage
	if err := json.Unmarshal(steeredMessage.Param, &targetSteer); err != nil || len(targetSteer.ContentBlocks) != 2 {
		t.Fatalf("target steer = %#v err=%v", targetSteer, err)
	}
	targetSteeredBlock := targetSteer.ContentBlocks[1]
	if targetSteeredBlock.URI == steeredBlock.URI || !strings.Contains(targetSteeredBlock.URI, safeHistoryPathPart(targetID)) {
		t.Fatalf("target steered attachment uri = %q, source = %q", targetSteeredBlock.URI, steeredBlock.URI)
	}
	var doneMessage acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(targetTurns[2].Content), &doneMessage); err != nil {
		t.Fatalf("unmarshal target done: %v", err)
	}
	var doneResult acp.SessionTurnPromptResult
	if err := json.Unmarshal(doneMessage.Param, &doneResult); err != nil || len(doneResult.Artifacts) != 1 {
		t.Fatalf("target artifacts = %#v err=%v", doneResult.Artifacts, err)
	}
	artifactID := doneResult.Artifacts[0].ArtifactID

	if err := c.DeleteSession(ctx, sourceID); err != nil {
		t.Fatalf("DeleteSession source: %v", err)
	}
	if _, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, "test", targetID, artifactID); err != nil {
		t.Fatalf("ReadArtifact target after source delete: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionAttachmentRead, "test", mustJSON(map[string]any{
		"sessionId": targetID,
		"uri":       targetBlock.URI,
	})); err != nil {
		t.Fatalf("read target attachment after source delete: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionAttachmentRead, "test", mustJSON(map[string]any{
		"sessionId": targetID,
		"uri":       targetSteeredBlock.URI,
	})); err != nil {
		t.Fatalf("read target steered attachment after source delete: %v", err)
	}
}

func recordPromptWithForkPointForTest(t *testing.T, c *Client, sessionID, text, nativeTurnID string) {
	t.Helper()
	recordPromptWithProviderForkPointForTest(t, c, sessionID, text, string(acp.ACPProviderCodex), nativeTurnID)
}

func recordPromptWithProviderForkPointForTest(t *testing.T, c *Client, sessionID, text, provider, nativeTurnID string) {
	t.Helper()
	if err := c.RecordEvent(context.Background(), sessionViewPromptEvent(sessionID, text, nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	done := sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)
	done.ForkPoint = &acp.SessionForkPoint{Provider: provider, Ref: nativeTurnID}
	if err := c.RecordEvent(context.Background(), done); err != nil {
		t.Fatalf("RecordEvent done: %v", err)
	}
}

func promptRequestBlocksForTest(t *testing.T, turn sessionViewTurn) []acp.ContentBlock {
	t.Helper()
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
		t.Fatalf("unmarshal prompt request: %v", err)
	}
	var request acp.SessionTurnPromptRequest
	if message.Method != acp.SessionTurnMethodPromptRequest || json.Unmarshal(message.Param, &request) != nil {
		t.Fatalf("prompt request message = %#v", message)
	}
	return request.ContentBlocks
}

func sessionViewCreatedEventWithAgent(sessionID, title, agentType string) SessionViewEvent {
	return SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: sessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionNew, map[string]any{
			"params": map[string]any{
				"sessionId": sessionID,
				"agentType": agentType,
				"title":     title,
			},
		}),
	}
}

func responseTurnsForTest(t *testing.T, value any) []sessionViewTurn {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal response turns: %v", err)
	}
	var turns []sessionViewTurn
	if err := json.Unmarshal(raw, &turns); err != nil {
		t.Fatalf("unmarshal response turns: %v", err)
	}
	return turns
}

func promptDoneForkPointForTest(t *testing.T, turn sessionViewTurn) *acp.SessionForkPoint {
	t.Helper()
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
		t.Fatalf("unmarshal turn content: %v", err)
	}
	if message.Method != acp.SessionTurnMethodPromptDone {
		return nil
	}
	var result acp.SessionTurnPromptResult
	if err := json.Unmarshal(message.Param, &result); err != nil {
		t.Fatalf("unmarshal prompt_done: %v", err)
	}
	return result.ForkPoint
}

func TestClientSessionArtifactRead(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	meta, err := c.sessionRecorder.artifactStore.WriteDiffArtifact(ctx, "proj1", "sess-1", promptDiffArtifactSampleDiff)
	if err != nil {
		t.Fatalf("WriteDiffArtifact: %v", err)
	}
	payload, err := json.Marshal(map[string]any{
		"sessionId":  "sess-1",
		"artifactId": meta.ArtifactID,
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionArtifactRead, "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.artifact.read): %v", err)
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	got := sessionArtifactReadResult{}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if got.ArtifactID != meta.ArtifactID || got.Type != "diff" || got.Format != "unified-diff" {
		t.Fatalf("artifact response = %+v, want id/type/format", got)
	}
	if got.Content != promptDiffArtifactSampleDiff {
		t.Fatalf("artifact content = %q, want original diff", got.Content)
	}

	escapePayload := json.RawMessage(`{"sessionId":"sess-1","artifactId":"../escape"}`)
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionArtifactRead, "proj1", escapePayload); err == nil {
		t.Fatal("HandleSessionRequest path traversal error = nil, want error")
	}
}

func TestSessionRecorderResetSessionTurnsDeletesArtifacts(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()

	meta, err := c.sessionRecorder.artifactStore.WriteDiffArtifact(ctx, "proj1", "sess-1", promptDiffArtifactSampleDiff)
	if err != nil {
		t.Fatalf("WriteDiffArtifact: %v", err)
	}
	if err := c.sessionRecorder.ResetSessionTurns(ctx, "sess-1"); err != nil {
		t.Fatalf("ResetSessionTurns: %v", err)
	}
	if _, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, "proj1", "sess-1", meta.ArtifactID); err == nil {
		t.Fatal("ReadArtifact after reset error = nil, want not found")
	}
}

func TestSessionViewPromptFinishedPublishesPromptDoneBeforeSessionUpdated(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	published := []publishedSessionEvent{}
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, publishedSessionEvent{method: method, payload: body})
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Done Publish Order")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewAssistantChunkTextEvent("sess-1", "hello", "streaming")); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	var finishTail []publishedSessionEvent
	for _, event := range published {
		if event.method == "session.message" {
			turn := publishedTurnMap(t, event.payload)
			content, _ := turn["content"].(string)
			if strings.Contains(content, acp.SessionTurnMethodAgentMessage) || strings.Contains(content, acp.SessionTurnMethodPromptDone) {
				finishTail = append(finishTail, event)
			}
			continue
		}
		if event.method == "session.updated" {
			finishTail = append(finishTail, event)
		}
	}
	if len(finishTail) < 3 {
		t.Fatalf("finish publish tail len = %d, want at least 3; events=%+v", len(finishTail), finishTail)
	}
	tail := finishTail[len(finishTail)-3:]
	if tail[0].method != "session.message" || !strings.Contains(publishedTurnMap(t, tail[0].payload)["content"].(string), acp.SessionTurnMethodAgentMessage) {
		t.Fatalf("tail[0] = %+v, want sealed agent message", tail[0])
	}
	if tail[1].method != "session.message" || !strings.Contains(publishedTurnMap(t, tail[1].payload)["content"].(string), acp.SessionTurnMethodPromptDone) {
		t.Fatalf("tail[1] = %+v, want prompt_done message", tail[1])
	}
	if tail[2].method != "session.updated" {
		t.Fatalf("tail[2] method = %q, want session.updated", tail[2].method)
	}
}

func TestSessionViewPromptFinishedMarksOpenTextTurnDone(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	var published []map[string]any
	c.sessionRecorder.SetEventPublisher(func(method string, payload any) error {
		if method != "session.message" {
			return nil
		}
		body, ok := payload.(map[string]any)
		if !ok {
			t.Fatalf("payload type = %T, want map[string]any", payload)
		}
		published = append(published, body)
		return nil
	})

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Done Turn")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewAssistantChunkTextEvent("sess-1", "hello", "streaming")); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if len(published) < 4 {
		t.Fatalf("published len = %d, want at least 4", len(published))
	}
	doneTurn := publishedTurnMap(t, published[len(published)-2])
	if got := doneTurn["finished"]; got != true {
		t.Fatalf("finished turn marker = %v, want true", got)
	}
	if got := doneTurn["turnIndex"].(int64); got != 2 {
		t.Fatalf("finished turnIndex = %d, want 2", got)
	}
	content, _ := doneTurn["content"].(string)
	update := decodeTurnSessionUpdate(t, content)
	if strings.TrimSpace(update.SessionUpdate) != acp.SessionUpdateAgentMessageChunk {
		t.Fatalf("finished method = %q, want %q", update.SessionUpdate, acp.SessionUpdateAgentMessageChunk)
	}
	if text := extractTextChunk(update.Content); text != "hello" {
		t.Fatalf("finished text = %q, want hello", text)
	}
}

func TestSessionViewReadSkipsPermissionRequestTurns(t *testing.T) {
	c := newSessionViewTestClient(t)

	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewPromptEvent("sess-1", "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
		Status:        "done",
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewPermissionRequestedEvent("sess-1", "Run tool?", 42, nil)); err != nil {
		t.Fatalf("RecordEvent permission requested: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(context.Background(), "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	messages := body["turns"].([]sessionViewTurn)
	if len(messages) != 2 {
		t.Fatalf("messages len = %d, want 2", len(messages))
	}
	if messages[0].TurnIndex != 1 {
		t.Fatalf("messages[0] = %#v, want turnIndex=1", messages[0])
	}
	if method := decodeTurnMethod(t, messages[1].Content); method != acp.SessionUpdateAgentMessageChunk {
		t.Fatalf("messages[1] method = %q, want %q", method, acp.SessionUpdateAgentMessageChunk)
	}
}

func TestSessionRecorderAppendsPermissionRequestAndResponseTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-permission", "Permission")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-permission", "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}

	requestIndex, err := c.RecordPermissionRequest(ctx, "sess-permission", acp.SessionTurnPermissionRequest{
		PermissionID: "perm-1",
		Title:        "Choose",
		Options:      []acp.SessionTurnPermissionOption{{OptionID: "allow", Name: "Allow", Kind: "allow_once"}},
		CreatedAt:    "2026-07-21T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("RecordPermissionRequest: %v", err)
	}
	if requestIndex != 2 {
		t.Fatalf("requestIndex=%d, want 2", requestIndex)
	}
	responseIndex, err := c.RecordPermissionResponse(ctx, "sess-permission", acp.SessionTurnPermissionResponse{
		PermissionID:     "perm-1",
		RequestTurnIndex: requestIndex,
		Outcome:          "selected",
		OptionID:         "allow",
		OptionName:       "Allow",
		RespondedAt:      "2026-07-21T10:01:00Z",
	})
	if err != nil {
		t.Fatalf("RecordPermissionResponse: %v", err)
	}
	if responseIndex != 3 {
		t.Fatalf("responseIndex=%d, want 3", responseIndex)
	}

	latest, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-permission", 1)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if latest != 3 || len(turns) != 2 {
		t.Fatalf("latest=%d turns=%#v", latest, turns)
	}
	for _, turn := range turns {
		if !turn.Finished {
			t.Fatalf("permission turn is not finished: %#v", turn)
		}
	}
	if method := decodeTurnMethod(t, turns[0].Content); method != acp.SessionTurnMethodPermissionRequest {
		t.Fatalf("request method=%q", method)
	}
	if method := decodeTurnMethod(t, turns[1].Content); method != acp.SessionTurnMethodPermissionResponse {
		t.Fatalf("response method=%q", method)
	}
}

func TestSessionRecorderLateMessageChunkDoesNotReopenPermissionSealedTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	const sessionID = "sess-permission-late-message"
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, "Permission Boundary")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	message := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
		MessageID:     "message-1",
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, message)); err != nil {
		t.Fatalf("RecordEvent message: %v", err)
	}
	if _, err := c.RecordPermissionRequest(ctx, sessionID, acp.SessionTurnPermissionRequest{
		PermissionID: "perm-1",
		Title:        "Choose",
		Options:      []acp.SessionTurnPermissionOption{{OptionID: "allow", Name: "Allow", Kind: "allow_once"}},
	}); err != nil {
		t.Fatalf("RecordPermissionRequest: %v", err)
	}
	message.Content = mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " late"})
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, message)); err != nil {
		t.Fatalf("RecordEvent late message: %v", err)
	}

	latest, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if latest != 3 || len(turns) != 3 {
		t.Fatalf("latest=%d turns=%#v", latest, turns)
	}
	if !turns[1].Finished {
		t.Fatalf("late message chunk reopened permission-sealed turn: %#v", turns[1])
	}
	if method := decodeTurnMethod(t, turns[2].Content); method != acp.SessionTurnMethodPermissionRequest {
		t.Fatalf("tail method=%q, want permission request", method)
	}
}

func TestSessionRecorderPermissionSummaryCountTracksLiveTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-count", "Permission Count")); err != nil {
		t.Fatalf("RecordEvent created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-count", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	requestIndex, err := c.RecordPermissionRequest(ctx, "sess-count", acp.SessionTurnPermissionRequest{
		PermissionID: "perm-count",
		Title:        "Choose",
		Options:      []acp.SessionTurnPermissionOption{{OptionID: "one", Name: "One", Kind: "allow_once"}},
		CreatedAt:    "2026-07-21T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("RecordPermissionRequest: %v", err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, "sess-count")
	if err != nil {
		t.Fatalf("ReadSessionSummary: %v", err)
	}
	if summary.PendingPermissionCount != 1 {
		t.Fatalf("pendingPermissionCount=%d, want 1", summary.PendingPermissionCount)
	}
	if _, err := c.RecordPermissionResponse(ctx, "sess-count", acp.SessionTurnPermissionResponse{
		PermissionID: "perm-count", RequestTurnIndex: requestIndex, Outcome: "selected", OptionID: "one", OptionName: "One",
	}); err != nil {
		t.Fatalf("RecordPermissionResponse: %v", err)
	}
	summary, err = c.sessionRecorder.ReadSessionSummary(ctx, "sess-count")
	if err != nil {
		t.Fatalf("ReadSessionSummary after response: %v", err)
	}
	if summary.PendingPermissionCount != 0 {
		t.Fatalf("pendingPermissionCount=%d, want 0", summary.PendingPermissionCount)
	}
	encodedSummary, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	if !strings.Contains(string(encodedSummary), `"pendingPermissionCount":0`) {
		t.Fatalf("zero pendingPermissionCount omitted from session summary: %s", encodedSummary)
	}
}

func TestSessionViewReadReturnsMergedStreamingTurn(t *testing.T) {
	c := newSessionViewTestClient(t)

	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-1", "Stream")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewAssistantChunkTextEvent("sess-1", "hello", "streaming")); err != nil {
		t.Fatalf("RecordEvent chunk: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(context.Background(), "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	messages := body["turns"].([]sessionViewTurn)
	if len(messages) != 2 {
		t.Fatalf("messages len = %d, want 2", len(messages))
	}
	if messages[1].TurnIndex != 2 {
		t.Fatalf("messages[1].TurnIndex = %d, want 2", messages[1].TurnIndex)
	}
	update := decodeTurnSessionUpdate(t, messages[1].Content)
	if text := strings.TrimSpace(extractTextChunk(update.Content)); text != "hello" {
		t.Fatalf("message text = %q, want hello", text)
	}
}

func TestSessionViewBufferedUpdatesReusePreviousTurnByUpdateType(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Merge Cursor")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "say hi", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}
	chunk1 := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello "}),
		Status:        "streaming",
	}
	chunk2 := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"}),
		Status:        "done",
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk1)); err != nil {
		t.Fatalf("RecordEvent chunk1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk2)); err != nil {
		t.Fatalf("RecordEvent chunk2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3 (prompt + merged assistant turn + prompt_done)", len(turns))
	}
	update2 := decodeTurnSessionUpdate(t, turns[1])
	if text := strings.TrimSpace(extractTextChunk(update2.Content)); text != "hello world" {
		t.Fatalf("assistant text = %q, want hello world", text)
	}
}

func TestSessionReadMarksCompletedTextTurnsDone(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Read Done")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}
	msg := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}), Status: "streaming"}
	thought := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentThoughtChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "reason"}), Status: "streaming"}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", msg)); err != nil {
		t.Fatalf("RecordEvent message update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", thought)); err != nil {
		t.Fatalf("RecordEvent thought update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	messages := body["turns"].([]sessionViewTurn)
	if len(messages) != 4 {
		t.Fatalf("messages len = %d, want 4", len(messages))
	}
	if messages[1].Finished != true {
		t.Fatalf("assistant finished = %v, want true", messages[1].Finished)
	}
	if messages[2].Finished != true {
		t.Fatalf("thought finished = %v, want true", messages[2].Finished)
	}
}

func TestSessionReadDerivesRoleAndKindFromACPUpdateTypes(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Role Kind")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}
	msg := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}), Status: "streaming"}
	thought := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentThoughtChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "reason"}), Status: "streaming"}
	tool := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateToolCall, ToolCallID: "call-1", Status: "in_progress", Title: "build"}

	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", msg)); err != nil {
		t.Fatalf("RecordEvent message update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", thought)); err != nil {
		t.Fatalf("RecordEvent thought update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", tool)); err != nil {
		t.Fatalf("RecordEvent tool update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	messages := body["turns"].([]sessionViewTurn)
	if len(messages) != 5 {
		t.Fatalf("messages len = %d, want 5", len(messages))
	}

	seen := map[string]bool{}
	for _, msg := range messages {
		if decodeTurnMethod(t, msg.Content) == acp.MethodSessionPrompt {
			seen["prompt"] = true
			continue
		}
		update := decodeTurnSessionUpdate(t, msg.Content)
		if strings.TrimSpace(update.SessionUpdate) != "" {
			seen[update.SessionUpdate] = true
		}
	}
	if !seen["prompt"] {
		t.Fatalf("missing prompt message, messages=%+v", messages)
	}
	if !seen[acp.SessionUpdateAgentMessageChunk] {
		t.Fatalf("missing agent message chunk, messages=%+v", messages)
	}
	if !seen[acp.SessionUpdateAgentThoughtChunk] {
		t.Fatalf("missing agent thought chunk, messages=%+v", messages)
	}
	if !seen[acp.SessionUpdateToolCallUpdate] {
		t.Fatalf("missing tool call update, messages=%+v", messages)
	}
}
func TestHandleSessionRequestMarkReadRequiresSessionID(t *testing.T) {
	c := newSessionViewTestClient(t)
	_, err := c.HandleSessionRequest(context.Background(), "session.markRead", "proj1", []byte(`{"lastReadTurnIndex":1}`))
	if err == nil {
		t.Fatalf("expected session.markRead to require sessionId")
	}
}

func TestHandleSessionRequestSessionDeleteRemovesActiveSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	oldCleanup := cleanupSessionArtifacts
	var cleanupCalls []struct{ projectName, agentType, sessionID string }
	cleanupSessionArtifacts = func(projectName, agentType, sessionID string) error {
		cleanupCalls = append(cleanupCalls, struct{ projectName, agentType, sessionID string }{projectName, agentType, sessionID})
		return nil
	}
	t.Cleanup(func() { cleanupSessionArtifacts = oldCleanup })

	now := time.Now().UTC()
	addRuntimeSession(c, "sess-1", "Delete Target", "claude", now, now)
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:          "sess-1",
		ProjectName: "proj1",
		Status:      SessionPersisted,
		AgentType:   "claude",
		AgentJSON:   `{}`,
		SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
			LatestPersistedTurnIndex: 3,
			Pinned:                   true,
			MarkColor:                "red",
		}),
		CreatedAt:    now,
		LastActiveAt: now,
		Title:        "Delete Target",
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.delete", "proj1", json.RawMessage(`{"sessionId":"sess-1"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.delete): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok || body["ok"] != true || body["sessionId"] != "sess-1" {
		t.Fatalf("unexpected session.delete response body: %#v", resp)
	}

	storedSession, err := c.store.LoadSession(ctx, "proj1", "sess-1")
	if err != nil {
		t.Fatalf("LoadSession after delete: %v", err)
	}
	if storedSession != nil {
		t.Fatalf("session still exists after delete: %+v", storedSession)
	}
	c.mu.Lock()
	_, inMemory := c.sessions["sess-1"]
	c.mu.Unlock()
	if inMemory {
		t.Fatal("session still active after delete")
	}
	if len(cleanupCalls) != 1 || cleanupCalls[0].projectName != "proj1" || cleanupCalls[0].agentType != "claude" || cleanupCalls[0].sessionID != "sess-1" {
		t.Fatalf("cleanup calls=%#v, want claude session cleanup", cleanupCalls)
	}
}

func TestHandleSessionRequestSessionArchiveShortSessionDeletesWithoutArchive(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	oldCleanup := cleanupSessionArtifacts
	var cleanupCalls []struct{ projectName, agentType, sessionID string }
	cleanupSessionArtifacts = func(projectName, agentType, sessionID string) error {
		cleanupCalls = append(cleanupCalls, struct{ projectName, agentType, sessionID string }{projectName, agentType, sessionID})
		return nil
	}
	t.Cleanup(func() { cleanupSessionArtifacts = oldCleanup })

	now := time.Date(2026, 5, 17, 10, 15, 0, 0, time.UTC)
	addRuntimeSession(c, "sess-short", "Short Archive Target", "codex", now, now)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-short", "Short Archive Target")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-short", "tiny", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-short", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-short"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok || body["ok"] != true || body["sessionId"] != "sess-short" {
		t.Fatalf("unexpected session.archive response body: %#v", resp)
	}

	if _, err := os.Stat(filepath.Join(filepath.Dir(historyRoot), "session-archive")); !os.IsNotExist(err) {
		t.Fatalf("archive root stat err = %v, want no archive written for short session", err)
	}
	storedSession, err := c.store.LoadSession(ctx, "proj1", "sess-short")
	if err != nil {
		t.Fatalf("LoadSession after short archive: %v", err)
	}
	if storedSession != nil {
		t.Fatalf("short session still exists after archive: %+v", storedSession)
	}
	c.mu.Lock()
	_, inMemory := c.sessions["sess-short"]
	c.mu.Unlock()
	if inMemory {
		t.Fatal("short session still active after archive")
	}
	if len(cleanupCalls) != 1 || cleanupCalls[0].projectName != "proj1" || cleanupCalls[0].agentType != "codex" || cleanupCalls[0].sessionID != "sess-short" {
		t.Fatalf("cleanup calls=%#v, want codex short session cleanup", cleanupCalls)
	}
}

func TestHandleSessionRequestSessionArchiveWritesPackAndDeletesActiveSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	now := time.Date(2026, 5, 17, 10, 30, 0, 0, time.UTC)
	addRuntimeSession(c, "sess-archive", "Archive Target", "claude", now, now)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-archive", "Archive Target")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-archive", "hello", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-archive", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"}),
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-archive", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
	if _, err := c.sessionRecorder.SetSessionPinned(ctx, "sess-archive", true); err != nil {
		t.Fatalf("SetSessionPinned: %v", err)
	}
	if _, err := c.sessionRecorder.SetSessionMarkColor(ctx, "sess-archive", "green"); err != nil {
		t.Fatalf("SetSessionMarkColor: %v", err)
	}

	sessionDir := filepath.Join(historyRoot, safeHistoryPathPart("proj1"), safeHistoryPathPart("sess-archive"))
	if _, err := os.Stat(sessionDir); err != nil {
		t.Fatalf("expected source session dir before archive: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-archive"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("session.archive response type = %T, want map[string]any", resp)
	}
	if body["ok"] != true || body["sessionId"] != "sess-archive" {
		t.Fatalf("unexpected session.archive response body: %#v", body)
	}

	storedSession, err := c.store.LoadSession(ctx, "proj1", "sess-archive")
	if err != nil {
		t.Fatalf("LoadSession after archive: %v", err)
	}
	if storedSession != nil {
		t.Fatalf("stored session still exists after archive: %+v", storedSession)
	}
	c.mu.Lock()
	_, inMemory := c.sessions["sess-archive"]
	c.mu.Unlock()
	if inMemory {
		t.Fatal("session still present in memory after archive")
	}
	if _, err := os.Stat(sessionDir); !os.IsNotExist(err) {
		t.Fatalf("source session dir stat err = %v, want not exist", err)
	}

	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["sess-archive"]
	titleFacts := decodeSessionTitleFacts(t, entry.Title)
	if entry.SessionID != "sess-archive" || entry.ProjectName != "proj1" ||
		titleFacts.First != "Archive Target" || titleFacts.Last != "hello" {
		t.Fatalf("unexpected manifest entry identity: %#v", entry)
	}
	if entry.Storage != "pack" || entry.File != "archive.pack" || entry.Codec != "gzip" {
		t.Fatalf("unexpected manifest storage fields: %#v", entry)
	}
	if entry.TurnCount != 3 || entry.GapCount != 0 || entry.WMT2Version != 2 || entry.ChunkSizeCode != 0 {
		t.Fatalf("unexpected manifest counters: %#v", entry)
	}

	rawWMT2, compressedSegment := readArchivedSessionPayloadForTest(t, historyRoot, "proj1", entry)
	if got := fmt.Sprintf("%x", sha256.Sum256(compressedSegment)); got != entry.SHA256 {
		t.Fatalf("compressed sha256 = %s, want %s", got, entry.SHA256)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(rawWMT2)); got != entry.UncompressedSHA256 {
		t.Fatalf("uncompressed sha256 = %s, want %s", got, entry.UncompressedSHA256)
	}
	contents := decodeWMT2ContentsForTest(t, rawWMT2, entry.TurnCount)
	if len(contents) != 3 {
		t.Fatalf("archive turn contents len = %d, want 3", len(contents))
	}
	if !strings.Contains(contents[0], acp.SessionTurnMethodPromptRequest) {
		t.Fatalf("first archived turn = %s, want prompt request", contents[0])
	}
	if !strings.Contains(contents[1], "world") {
		t.Fatalf("second archived turn = %s, want agent message", contents[1])
	}
	if !strings.Contains(contents[2], acp.SessionTurnMethodPromptDone) {
		t.Fatalf("third archived turn = %s, want prompt done", contents[2])
	}
}

func TestSessionArchiveStripsUploadedAttachmentBlocks(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	now := time.Date(2026, 5, 17, 10, 40, 0, 0, time.UTC)
	addRuntimeSession(c, "sess-archive-attachment", "Attachment Archive", "claude", now, now)
	block := uploadSessionAttachmentForTest(t, c, "sess-archive-attachment", "pixel.png", "image/png", tinyPNGForTest(t))

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-archive-attachment", "Attachment Archive")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-archive-attachment", "", []acp.ContentBlock{block})); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-archive-attachment", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "received"}),
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-archive-attachment", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-archive-attachment"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}

	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["sess-archive-attachment"]
	rawWMT2, _ := readArchivedSessionPayloadForTest(t, historyRoot, "proj1", entry)
	contents := decodeWMT2ContentsForTest(t, rawWMT2, entry.TurnCount)
	if strings.Contains(contents[0], "resource_link") || strings.Contains(contents[0], "file://") || strings.Contains(contents[0], "pixel.png") {
		t.Fatalf("first archived turn kept attachment block: %s", contents[0])
	}
	if !strings.Contains(contents[0], "Attachment removed during archive") {
		t.Fatalf("first archived turn = %s, want archive placeholder", contents[0])
	}
}

func TestSessionArchiveStripsLegacyImageDataBlocks(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	now := time.Date(2026, 5, 17, 10, 42, 0, 0, time.UTC)
	addRuntimeSession(c, "sess-archive-image-data", "Image Data Archive", "claude", now, now)
	imageBlock := acp.ContentBlock{
		Type:     acp.ContentBlockTypeImage,
		MimeType: "image/png",
		Data:     "abc123",
	}

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-archive-image-data", "Image Data Archive")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-archive-image-data", "", []acp.ContentBlock{imageBlock})); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-archive-image-data", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "received"}),
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-archive-image-data", acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-archive-image-data"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}

	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["sess-archive-image-data"]
	rawWMT2, _ := readArchivedSessionPayloadForTest(t, historyRoot, "proj1", entry)
	contents := decodeWMT2ContentsForTest(t, rawWMT2, entry.TurnCount)
	if strings.Contains(contents[0], "abc123") || strings.Contains(contents[0], "image/png") {
		t.Fatalf("first archived turn kept legacy image data: %s", contents[0])
	}
	if !strings.Contains(contents[0], "Attachment removed during archive") {
		t.Fatalf("first archived turn = %s, want archive placeholder", contents[0])
	}
}

func TestSessionArchiveDiscardsPromptDiffArtifacts(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	now := time.Date(2026, 5, 17, 10, 45, 0, 0, time.UTC)
	addRuntimeSession(c, "sess-artifact-archive", "Artifact Archive", "claude", now, now)

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-artifact-archive", "Artifact Archive")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-artifact-archive", "edit", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-artifact-archive", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "done"}),
	})); err != nil {
		t.Fatalf("RecordEvent update: %v", err)
	}
	done := sessionViewPromptFinishedEvent("sess-artifact-archive", acp.StopReasonEndTurn)
	done.Artifacts = []acp.SessionPromptArtifactPayload{{
		Type:    "diff",
		Format:  "unified-diff",
		Content: promptDiffArtifactSampleDiff,
	}}
	if err := c.RecordEvent(ctx, done); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-artifact-archive", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(turns[2].Content), &msg); err != nil {
		t.Fatalf("unmarshal prompt_done: %v", err)
	}
	result := acp.SessionTurnPromptResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal prompt_done param: %v", err)
	}
	if len(result.Artifacts) != 1 {
		t.Fatalf("artifacts len = %d, want 1", len(result.Artifacts))
	}
	artifactID := result.Artifacts[0].ArtifactID
	if _, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, "proj1", "sess-artifact-archive", artifactID); err != nil {
		t.Fatalf("ReadArtifact before archive: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-artifact-archive"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}
	archiveArtifactDir := filepath.Join(filepath.Dir(historyRoot), "session-archive", safeHistoryPathPart("proj1"), "artifacts", safeHistoryPathPart("sess-artifact-archive"))
	if err := os.MkdirAll(archiveArtifactDir, 0o755); err != nil {
		t.Fatalf("MkdirAll stale archive artifact dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(archiveArtifactDir, artifactID+".diff"), []byte(promptDiffArtifactSampleDiff), 0o644); err != nil {
		t.Fatalf("WriteFile stale archive artifact: %v", err)
	}
	archived, err := c.HandleSessionRequest(ctx, "session.archive.read", "proj1", json.RawMessage(`{"sessionId":"sess-artifact-archive"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.read): %v", err)
	}
	archivedMap, ok := archived.(map[string]any)
	if !ok {
		t.Fatalf("archive read response type = %T", archived)
	}
	archivedTurns, ok := archivedMap["turns"].([]sessionViewTurn)
	if !ok || len(archivedTurns) != 3 {
		t.Fatalf("archived turns = %#v, want 3 sessionViewTurn entries", archivedMap["turns"])
	}
	msg = acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(archivedTurns[2].Content), &msg); err != nil {
		t.Fatalf("unmarshal archived prompt_done: %v", err)
	}
	result = acp.SessionTurnPromptResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal archived prompt_done param: %v", err)
	}
	if len(result.Artifacts) != 0 {
		t.Fatalf("archived artifacts len = %d, want 0", len(result.Artifacts))
	}
	if _, err := os.Stat(archiveArtifactDir); !os.IsNotExist(err) {
		t.Fatalf("archive artifact dir stat err = %v, want not exist", err)
	}
	readPayload, err := json.Marshal(map[string]any{
		"sessionId":  "sess-artifact-archive",
		"artifactId": artifactID,
	})
	if err != nil {
		t.Fatalf("json.Marshal read payload: %v", err)
	}
	if _, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionArtifactRead, "proj1", readPayload); err == nil {
		t.Fatal("HandleSessionRequest(session.artifact.read archived) error = nil, want artifact not found")
	}

	if _, err := c.HandleSessionRequest(ctx, "session.archive.restore", "proj1", json.RawMessage(`{"sessionId":"sess-artifact-archive"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.restore): %v", err)
	}
	if _, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, "proj1", "sess-artifact-archive", artifactID); err == nil {
		t.Fatal("ReadArtifact after restore error = nil, want artifact not found")
	}
	_, restoredTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-artifact-archive", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns after restore: %v", err)
	}
	msg = acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(restoredTurns[2].Content), &msg); err != nil {
		t.Fatalf("unmarshal restored prompt_done: %v", err)
	}
	result = acp.SessionTurnPromptResult{}
	if err := json.Unmarshal(msg.Param, &result); err != nil {
		t.Fatalf("unmarshal restored prompt_done param: %v", err)
	}
	if len(result.Artifacts) != 0 {
		t.Fatalf("restored artifacts len = %d, want 0", len(result.Artifacts))
	}
}

func TestHandleSessionRequestSessionArchiveFillsMissingTurnsWithGap(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	now := time.Date(2026, 5, 17, 11, 0, 0, 0, time.UTC)
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              "sess-gap",
		ProjectName:     "proj1",
		Status:          SessionPersisted,
		AgentType:       "claude",
		Title:           "Gap Target",
		SessionSyncJSON: sessionSyncJSON(3),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	if _, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"sess-gap"}`)); err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}

	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["sess-gap"]
	if entry.TurnCount != 3 || entry.GapCount != 3 {
		t.Fatalf("manifest counters = turnCount:%d gapCount:%d, want 3/3", entry.TurnCount, entry.GapCount)
	}
	rawWMT2, _ := readArchivedSessionPayloadForTest(t, historyRoot, "proj1", entry)
	contents := decodeWMT2ContentsForTest(t, rawWMT2, entry.TurnCount)
	for i, content := range contents {
		if !strings.Contains(content, "session/archive_gap") || !strings.Contains(content, "missing_turn") {
			t.Fatalf("content[%d] = %s, want archive gap turn", i, content)
		}
	}
}

func TestSessionArchiveStoreListSessionsExcludesRestoredAndSorts(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "older", "Older", "claude", time.Date(2026, 5, 14, 10, 0, 0, 0, time.UTC), []string{"older-1", "older-2", "older-3"})
	archiveLongSessionForStoreTest(t, c, ctx, "newer", "Newer", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"newer-1", "newer-2", "newer-3"})
	archiveLongSessionForStoreTest(t, c, ctx, "restored", "Restored", "claude", time.Date(2026, 5, 16, 10, 0, 0, 0, time.UTC), []string{"restored-1", "restored-2", "restored-3"})

	if _, err := c.archiveStore.MarkRestored(ctx, "proj1", "restored", "2026-05-17T00:00:00Z", sessionArchiveNativeSyncUpdate{}); err != nil {
		t.Fatalf("MarkRestored: %v", err)
	}
	entries, err := c.archiveStore.ListSessions(ctx, "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries len = %d, want 2: %#v", len(entries), entries)
	}
	if entries[0].SessionID != "newer" || entries[1].SessionID != "older" {
		t.Fatalf("entry order = %s,%s, want newer,older", entries[0].SessionID, entries[1].SessionID)
	}
	for _, entry := range entries {
		if entry.SessionID == "restored" {
			t.Fatalf("restored entry returned in list: %#v", entry)
		}
	}
}

func TestSessionArchiveStoreReadSessionValidatesPackAndReturnsTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "readable", "Readable", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"turn-one", "turn-two", "turn-three"})

	entry, contents, err := c.archiveStore.ReadSession(ctx, "proj1", "readable")
	if err != nil {
		t.Fatalf("ReadSession: %v", err)
	}
	if entry.SessionID != "readable" {
		t.Fatalf("entry sessionID = %q, want readable", entry.SessionID)
	}
	if strings.Join(contents, "|") != "turn-one|turn-two|turn-three" {
		t.Fatalf("contents = %#v, want original turns", contents)
	}
}

func TestSessionArchiveStoreReadSessionRejectsHashMismatch(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "corrupt", "Corrupt", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"turn-one", "turn-two", "turn-three"})
	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["corrupt"]
	packPath := filepath.Join(filepath.Dir(historyRoot), "session-archive", safeHistoryPathPart("proj1"), entry.File)
	f, err := os.OpenFile(packPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatalf("OpenFile archive pack: %v", err)
	}
	if _, err := f.WriteAt([]byte{0xff}, entry.Offset+entry.Length-1); err != nil {
		_ = f.Close()
		t.Fatalf("corrupt archive pack: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close archive pack: %v", err)
	}

	_, _, err = c.archiveStore.ReadSession(ctx, "proj1", "corrupt")
	if err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("ReadSession err = %v, want sha256 mismatch", err)
	}
}

func TestSessionArchiveStoreMarkRestoredHidesEntryFromList(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "restore-marker", "Restore Marker", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"turn-one", "turn-two", "turn-three"})

	updated, err := c.archiveStore.MarkRestored(ctx, "proj1", "restore-marker", "2026-05-17T00:00:00Z", sessionArchiveNativeSyncUpdate{
		NativeUnarchivedAt: "2026-05-17T00:00:01Z",
		NativeSyncWarning:  "native warning",
	})
	if err != nil {
		t.Fatalf("MarkRestored: %v", err)
	}
	if updated.RestoredAt != "2026-05-17T00:00:00Z" || updated.NativeUnarchivedAt != "2026-05-17T00:00:01Z" || updated.NativeSyncWarning != "native warning" {
		t.Fatalf("updated entry = %#v, want restored/native fields", updated)
	}
	entries, err := c.archiveStore.ListSessions(ctx, "proj1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries len = %d, want 0 after restored marker: %#v", len(entries), entries)
	}
	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	entry := manifest.Sessions["restore-marker"]
	if entry.RestoredAt != "2026-05-17T00:00:00Z" || entry.NativeUnarchivedAt != "2026-05-17T00:00:01Z" || entry.NativeSyncWarning != "native warning" {
		t.Fatalf("manifest entry = %#v, want restored/native fields", entry)
	}
}

func TestHandleSessionRequestSessionArchiveListReturnsArchivedSessions(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "list-older", "List Older", "claude", time.Date(2026, 5, 14, 10, 0, 0, 0, time.UTC), []string{"older-1", "older-2", "older-3"})
	archiveLongSessionForStoreTest(t, c, ctx, "list-newer", "List Newer", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"newer-1", "newer-2", "newer-3"})

	resp, err := c.HandleSessionRequest(ctx, "session.archive.list", "proj1", nil)
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.list): %v", err)
	}
	body := resp.(map[string]any)
	sessions := body["sessions"].([]sessionArchiveSummary)
	if len(sessions) != 2 {
		t.Fatalf("sessions len = %d, want 2: %#v", len(sessions), sessions)
	}
	if sessions[0].SessionID != "list-newer" || sessions[1].SessionID != "list-older" {
		t.Fatalf("session order = %s,%s, want list-newer,list-older", sessions[0].SessionID, sessions[1].SessionID)
	}
	if sessions[0].TurnCount != 3 || sessions[0].GapCount != 0 || sessions[0].ArchivedAt == "" {
		t.Fatalf("session summary = %#v, want archive counters and archivedAt", sessions[0])
	}
}

func TestHandleSessionRequestSessionArchiveReadReturnsReadOnlyTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "read-protocol", "Read Protocol", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"read-1", "read-2", "read-3"})

	resp, err := c.HandleSessionRequest(ctx, "session.archive.read", "proj1", json.RawMessage(`{"sessionId":"read-protocol"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.read): %v", err)
	}
	body := resp.(map[string]any)
	if body["sessionId"] != "read-protocol" || body["readOnly"] != true || body["latestTurnIndex"] != int64(3) {
		t.Fatalf("archive read envelope = %#v, want readOnly session with latestTurnIndex 3", body)
	}
	summary := body["session"].(sessionArchiveSummary)
	if summary.SessionID != "read-protocol" || summary.TurnCount != 3 {
		t.Fatalf("archive read summary = %#v", summary)
	}
	turns := body["turns"].([]sessionViewTurn)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	if turns[0].TurnIndex != 1 || turns[2].TurnIndex != 3 || turns[1].Content != "read-2" {
		t.Fatalf("turns = %#v, want indexed archived contents", turns)
	}
	if messages, ok := body["messages"].([]any); !ok || len(messages) != 0 {
		t.Fatalf("messages = %#v, want empty []any", body["messages"])
	}
}

func TestHandleSessionRequestSessionArchiveReadRejectsRestoredSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "read-restored", "Read Restored", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"read-1", "read-2", "read-3"})
	if _, err := c.archiveStore.MarkRestored(ctx, "proj1", "read-restored", "2026-05-17T00:00:00Z", sessionArchiveNativeSyncUpdate{}); err != nil {
		t.Fatalf("MarkRestored: %v", err)
	}

	_, err := c.HandleSessionRequest(ctx, "session.archive.read", "proj1", json.RawMessage(`{"sessionId":"read-restored"}`))
	if err == nil || !strings.Contains(err.Error(), "already restored") {
		t.Fatalf("session.archive.read err = %v, want already restored", err)
	}
}

func TestHandleSessionRequestSessionArchiveRestoreRecreatesSessionAndTurns(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "restore-protocol", "Restore Protocol", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"restore-1", "restore-2", "restore-3"})

	resp, err := c.HandleSessionRequest(ctx, "session.archive.restore", "proj1", json.RawMessage(`{"sessionId":"restore-protocol"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.restore): %v", err)
	}
	body := resp.(map[string]any)
	if body["ok"] != true || body["sessionId"] != "restore-protocol" {
		t.Fatalf("restore response = %#v, want ok true", body)
	}
	summary := body["session"].(sessionViewSummary)
	if summary.SessionID != "restore-protocol" || summary.LatestTurnIndex != 3 || summary.AgentType != "claude" {
		t.Fatalf("restore summary = %#v, want restored session summary", summary)
	}
	if summary.Pinned || summary.MarkColor != "" {
		t.Fatalf("restore summary = %#v, want unpinned and unmarked", summary)
	}
	stored, err := c.store.LoadSession(ctx, "proj1", "restore-protocol")
	if err != nil {
		t.Fatalf("LoadSession after restore: %v", err)
	}
	if stored == nil {
		t.Fatal("restored session row missing")
	}
	if latest := sessionSyncLatestPersistedTurnIndex(stored.SessionSyncJSON); latest != 3 {
		t.Fatalf("latest persisted turn index = %d, want 3", latest)
	}
	readResp, err := c.HandleSessionRequest(ctx, "session.read", "proj1", json.RawMessage(`{"sessionId":"restore-protocol"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.read) after restore: %v", err)
	}
	readBody := readResp.(map[string]any)
	turns := readBody["turns"].([]sessionViewTurn)
	if len(turns) != 3 || turns[0].Content != "restore-1" || turns[2].Content != "restore-3" {
		t.Fatalf("restored turns = %#v, want archived contents", turns)
	}
	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	if manifest.Sessions["restore-protocol"].RestoredAt == "" {
		t.Fatalf("manifest restoredAt missing: %#v", manifest.Sessions["restore-protocol"])
	}
}

func TestHandleSessionRequestSessionArchiveRestorePreservesForkOrigin(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()
	sessionID := "restore-fork-origin"
	contents := []string{"restore-1", "restore-2", "restore-3"}
	if _, err := c.sessionRecorder.turnStore.WriteTurns(ctx, c.projectName, sessionID, 1, contents); err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	origin := &acp.SessionForkOrigin{
		SessionID: "source-session",
		TurnIndex: 7,
		Title:     "Source title",
	}
	now := time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC)
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:          sessionID,
		ProjectName: c.projectName,
		Status:      SessionPersisted,
		AgentType:   "claude",
		Title:       "Forked session",
		SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
			LatestPersistedTurnIndex: int64(len(contents)),
			ForkedFrom:               origin,
		}),
		CreatedAt:    now.Add(-time.Hour),
		LastActiveAt: now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	if err := c.ArchiveSession(ctx, sessionID); err != nil {
		t.Fatalf("ArchiveSession: %v", err)
	}

	listResp, err := c.HandleSessionRequest(ctx, "session.archive.list", "proj1", nil)
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.list): %v", err)
	}
	archived := listResp.(map[string]any)["sessions"].([]sessionArchiveSummary)
	if len(archived) != 1 || archived[0].ForkedFrom == nil || archived[0].ForkedFrom.SessionID != origin.SessionID {
		t.Fatalf("archived summary forkedFrom = %#v, want %#v", archived, origin)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.archive.restore", "proj1", json.RawMessage(`{"sessionId":"restore-fork-origin"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive.restore): %v", err)
	}
	summary := resp.(map[string]any)["session"].(sessionViewSummary)
	if summary.ForkedFrom == nil || *summary.ForkedFrom != *origin {
		t.Fatalf("restored forkedFrom = %#v, want %#v", summary.ForkedFrom, origin)
	}
}

func TestHandleSessionRequestSessionArchiveRestoreRejectsExistingSession(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()
	now := time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC)

	archiveLongSessionForStoreTest(t, c, ctx, "restore-existing", "Restore Existing", "claude", now, []string{"restore-1", "restore-2", "restore-3"})
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              "restore-existing",
		ProjectName:     "proj1",
		Status:          SessionPersisted,
		AgentType:       "claude",
		Title:           "Existing",
		SessionSyncJSON: sessionSyncJSON(0),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession existing: %v", err)
	}

	_, err := c.HandleSessionRequest(ctx, "session.archive.restore", "proj1", json.RawMessage(`{"sessionId":"restore-existing"}`))
	if err == nil || !strings.Contains(err.Error(), "session already exists") {
		t.Fatalf("session.archive.restore err = %v, want session already exists", err)
	}
}

func TestHandleSessionRequestSessionArchiveRestoreRejectsAlreadyRestored(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "restore-restored", "Restore Restored", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"restore-1", "restore-2", "restore-3"})
	if _, err := c.archiveStore.MarkRestored(ctx, "proj1", "restore-restored", "2026-05-17T00:00:00Z", sessionArchiveNativeSyncUpdate{}); err != nil {
		t.Fatalf("MarkRestored: %v", err)
	}

	_, err := c.HandleSessionRequest(ctx, "session.archive.restore", "proj1", json.RawMessage(`{"sessionId":"restore-restored"}`))
	if err == nil || !strings.Contains(err.Error(), "already restored") {
		t.Fatalf("session.archive.restore err = %v, want already restored", err)
	}
}

func TestArchiveSessionNativeWarningDoesNotRollbackWheelMakerArchive(t *testing.T) {
	c := newSessionViewTestClient(t)
	historyRoot := filepath.Join(t.TempDir(), "db", "session")
	c.SetSessionHistoryRoot(historyRoot)
	ctx := context.Background()
	inst := &testInjectedInstance{name: "codex", archiveErr: errors.New("native archive unavailable")}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) { return inst, nil })

	if _, err := c.sessionRecorder.turnStore.WriteTurns(ctx, c.projectName, "native-warning", 1, []string{"native-1", "native-2", "native-3"}); err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	now := time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC)
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:              "native-warning",
		ProjectName:     "proj1",
		Status:          SessionPersisted,
		AgentType:       "codex",
		Title:           "Native Warning",
		SessionSyncJSON: sessionSyncJSON(3),
		CreatedAt:       now,
		LastActiveAt:    now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.archive", "proj1", json.RawMessage(`{"sessionId":"native-warning"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.archive): %v", err)
	}
	body := resp.(map[string]any)
	if warning, _ := body["warning"].(string); !strings.Contains(warning, "native archive unavailable") {
		t.Fatalf("warning = %#v, want native archive warning", body["warning"])
	}
	if len(inst.archiveCalls) != 1 || inst.archiveCalls[0] != "native-warning" {
		t.Fatalf("archive calls = %#v, want native-warning", inst.archiveCalls)
	}
	if stored, err := c.store.LoadSession(ctx, "proj1", "native-warning"); err != nil {
		t.Fatalf("LoadSession: %v", err)
	} else if stored != nil {
		t.Fatalf("session still active after warning archive: %#v", stored)
	}
	manifest := readArchiveManifestForTest(t, historyRoot, "proj1")
	if warning := manifest.Sessions["native-warning"].NativeSyncWarning; !strings.Contains(warning, "native archive unavailable") {
		t.Fatalf("manifest native warning = %q", warning)
	}
}

func TestCXDeepSeekNativeArchiveSyncUsesCXCreator(t *testing.T) {
	for _, test := range []struct {
		name     string
		archived bool
	}{
		{name: "archive", archived: true},
		{name: "unarchive", archived: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			c := newSessionViewTestClient(t)
			factory := agent.NewACPFactory()
			inst := &testInjectedInstance{name: string(acp.ACPProviderCXDeepSeek), alive: true}
			creatorCalls := 0
			factory.Register(acp.ACPProviderCXDeepSeek, func(ctx context.Context, cwd string) (agent.Instance, error) {
				creatorCalls++
				if projectName := agent.ProjectNameFromContext(ctx); projectName != c.projectName {
					t.Fatalf("creator project = %q, want %q", projectName, c.projectName)
				}
				if cwd != c.cwd {
					t.Fatalf("creator cwd = %q, want %q", cwd, c.cwd)
				}
				return inst, nil
			})
			c.registry = factory

			update := c.syncNativeArchiveState(context.Background(), string(acp.ACPProviderCXDeepSeek), "cx-native-session", test.archived)
			if creatorCalls != 1 || update.NativeSyncWarning != "" {
				t.Fatalf("creator calls = %d, update = %#v", creatorCalls, update)
			}
			if test.archived {
				if !reflect.DeepEqual(inst.archiveCalls, []string{"cx-native-session"}) || update.NativeArchivedAt == "" {
					t.Fatalf("archive calls = %#v, update = %#v", inst.archiveCalls, update)
				}
				return
			}
			if !reflect.DeepEqual(inst.unarchiveCalls, []string{"cx-native-session"}) || update.NativeUnarchivedAt == "" {
				t.Fatalf("unarchive calls = %#v, update = %#v", inst.unarchiveCalls, update)
			}
		})
	}
}

func TestSessionResumeListExcludesArchivedUnrestoredSessions(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	ctx := context.Background()

	archiveLongSessionForStoreTest(t, c, ctx, "resume-archived", "Resume Archived", "claude", time.Date(2026, 5, 15, 10, 0, 0, 0, time.UTC), []string{"resume-1", "resume-2", "resume-3"})

	managed, err := c.recovery().managedSessionIDs(ctx)
	if err != nil {
		t.Fatalf("managedSessionIDs: %v", err)
	}
	if !managed["resume-archived"] {
		t.Fatalf("managed ids = %#v, want archived session id included", managed)
	}
	if _, err := c.archiveStore.MarkRestored(ctx, "proj1", "resume-archived", "2026-05-17T00:00:00Z", sessionArchiveNativeSyncUpdate{}); err != nil {
		t.Fatalf("MarkRestored: %v", err)
	}
	managed, err = c.recovery().managedSessionIDs(ctx)
	if err != nil {
		t.Fatalf("managedSessionIDs after restore: %v", err)
	}
	if managed["resume-archived"] {
		t.Fatalf("managed ids = %#v, want restored archive id removed", managed)
	}
}

func TestHandleSessionRequestSessionMutationsRejectRunningSession(t *testing.T) {
	for _, method := range []string{"session.archive", "session.delete", "session.reload"} {
		t.Run(method, func(t *testing.T) {
			c := newSessionViewTestClient(t)
			c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
			ctx := context.Background()
			now := time.Date(2026, 5, 17, 12, 0, 0, 0, time.UTC)
			if err := c.store.SaveSession(ctx, &SessionRecord{
				ID:              "sess-running",
				ProjectName:     "proj1",
				Status:          SessionPersisted,
				AgentType:       "claude",
				Title:           "Running Target",
				SessionSyncJSON: sessionSyncJSON(0),
				CreatedAt:       now,
				LastActiveAt:    now,
			}); err != nil {
				t.Fatalf("SaveSession: %v", err)
			}
			c.sessionRecorder.writeMu.Lock()
			state := newSessionPromptState(1)
			state.updateTurn(sessionTurnMessage{
				sessionID: "sess-running",
				method:    acp.SessionTurnMethodPromptRequest,
				payload:   acp.SessionTurnPromptRequest{ContentBlocks: []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "still running"}}},
				turnIndex: 1,
				finished:  true,
			}, "")
			c.sessionRecorder.promptState["sess-running"] = &state
			c.sessionRecorder.writeMu.Unlock()

			_, err := c.HandleSessionRequest(ctx, method, "proj1", json.RawMessage(`{"sessionId":"sess-running"}`))
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), "running") {
				t.Fatalf("HandleSessionRequest(%s) err = %v, want running rejection", method, err)
			}
			storedSession, loadErr := c.store.LoadSession(ctx, "proj1", "sess-running")
			if loadErr != nil {
				t.Fatalf("LoadSession after rejected mutation: %v", loadErr)
			}
			if storedSession == nil {
				t.Fatal("running session was deleted after rejected mutation")
			}
		})
	}
}

func TestHandleSessionRequestSessionReloadClearsPromptStateBeforeReplay(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 9, 0, 0, 0, time.UTC)
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return &testInjectedInstance{
			name:      "claude",
			sessionID: "sess-reload",
			initResult: acp.InitializeResult{
				ProtocolVersion:   "0.1",
				AgentCapabilities: acp.AgentCapabilities{LoadSession: true},
			},
			loadErr: errors.New("resource not found"),
		}, nil
	})

	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:          "sess-reload",
		ProjectName: "proj1",
		Status:      SessionPersisted,
		AgentType:   "claude",
		AgentJSON:   `{}`,
		SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
			LatestPersistedTurnIndex: 4,
			Pinned:                   true,
			MarkColor:                "yellow",
		}),
		CreatedAt:    now,
		LastActiveAt: now,
		Title:        "Reload target",
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	c.sessionRecorder.writeMu.Lock()
	cached := newSessionPromptState(9)
	c.sessionRecorder.promptState["sess-reload"] = &cached
	c.sessionRecorder.writeMu.Unlock()
	sess, err := c.SessionForTest("sess-reload")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := sess.enqueueQueueItem(promptQueueItem("reload-item", "discard me")); err != nil {
		t.Fatal(err)
	}
	queueGeneration := sess.queueSnapshot(true).Generation

	_, err = c.HandleSessionRequest(ctx, "session.reload", "proj1", json.RawMessage(`{"sessionId":"sess-reload"}`))
	if err == nil {
		t.Fatal("expected reload to fail when replay load fails")
	}
	queueAfter := sess.queueSnapshot(true)
	if queueAfter.Generation == queueGeneration || queueAfter.ActiveItem != nil || len(queueAfter.WaitingItems) != 0 {
		t.Fatalf("queue after reload = %#v", queueAfter)
	}

	c.sessionRecorder.writeMu.Lock()
	_, hasPromptState := c.sessionRecorder.promptState["sess-reload"]
	c.sessionRecorder.writeMu.Unlock()
	if hasPromptState {
		t.Fatal("prompt state still present after reload failure")
	}
	stored, loadErr := c.store.LoadSession(ctx, "proj1", "sess-reload")
	if loadErr != nil || stored == nil {
		t.Fatalf("LoadSession after reload = %#v, %v", stored, loadErr)
	}
	projection := sessionSyncProjectionFromJSON(stored.SessionSyncJSON)
	if !projection.Pinned || projection.MarkColor != "yellow" ||
		projection.LatestPersistedTurnIndex != 0 || projection.LastReadTurnIndex != 0 {
		t.Fatalf("projection after reload failure = %#v, want pin and mark only", projection)
	}
}

func TestHandleSessionRequestSessionReloadRecordsAgentOnlyReplay(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 5, 12, 8, 0, 0, 0, time.UTC)
	inst := &testInjectedInstance{
		name:      "codex",
		sessionID: "sess-codex",
		initResult: acp.InitializeResult{
			ProtocolVersion:   "0.1",
			AgentCapabilities: acp.AgentCapabilities{LoadSession: true},
		},
		loadUpdates: []acp.SessionUpdateParams{{
			SessionID: "sess-codex",
			Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "restored without user chunk"}),
			},
		}},
	}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) {
		return inst, nil
	})
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-codex",
		ProjectName:  "proj1",
		Status:       SessionPersisted,
		AgentType:    "codex",
		AgentJSON:    `{}`,
		CreatedAt:    now,
		LastActiveAt: now,
		Title:        "Codex reload",
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.reload", "proj1", json.RawMessage(`{"sessionId":"sess-codex"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.reload): %v", err)
	}
	body := resp.(map[string]any)
	if body["ok"] != true {
		t.Fatalf("reload response = %#v, want ok", body)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-codex", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want restored agent message plus prompt_done, turns=%+v", len(turns), turns)
	}
	if !strings.Contains(turns[0].Content, "restored without user chunk") {
		t.Fatalf("turn content = %s, want restored agent text", turns[0].Content)
	}
}

func TestCodexRecoveryListMatchesEquivalentWindowsCWDSeparators(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	writeCodexSessionFixture(t, homeDir, "sess-mixed-cwd", `D:\Code\WheelMaker\`, "Resume me", "assistant preview")

	items, err := (codexRecoverySource{agentType: "codex", homeDir: filepath.Join(homeDir, ".codex")}).List("D:/Code/WheelMaker/", nil)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 || items[0].SessionID != "sess-mixed-cwd" {
		t.Fatalf("items = %+v, want sess-mixed-cwd", items)
	}
}

func TestCodexFamilyRecoveryUsesIsolatedHomes(t *testing.T) {
	userDir := t.TempDir()
	stateDir := t.TempDir()
	cwd := t.TempDir()
	t.Setenv("HOME", userDir)
	t.Setenv("USERPROFILE", userDir)
	nativeHome := filepath.Join(userDir, ".codex")
	cxHome := filepath.Join(stateDir, ".data", "cx-deepseek")
	writeCodexSessionFixtureAtHome(t, nativeHome, "native-session", cwd, "Native", "native reply")
	writeCodexSessionFixtureAtHome(t, cxHome, "cx-session", cwd, "DeepSeek", "cx reply")

	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	client := NewWithRuntime(store, "project", cwd, RuntimeConfig{StateDir: stateDir})
	t.Cleanup(func() { _ = client.Close() })

	native, err := client.recovery().ListResumableSessions(context.Background(), "codex")
	if err != nil {
		t.Fatal(err)
	}
	cx, err := client.recovery().ListResumableSessions(context.Background(), "cx-deepseek")
	if err != nil {
		t.Fatal(err)
	}
	assertRecoverySessionIDs(t, native, "native-session")
	assertRecoverySessionIDs(t, cx, "cx-session")
	if sessions := cx["sessions"].([]recoverySession); sessions[0].AgentType != "cx-deepseek" {
		t.Fatalf("cx session AgentType = %q", sessions[0].AgentType)
	}

	withoutState := &sessionRecovery{client: &Client{}}
	if _, err := withoutState.sourceFor("cx-deepseek"); err == nil || !strings.Contains(err.Error(), "state directory") {
		t.Fatalf("sourceFor(cx-deepseek) error = %v, want missing state directory", err)
	}
}

func assertRecoverySessionIDs(t *testing.T, response map[string]any, want string) {
	t.Helper()
	sessions, ok := response["sessions"].([]recoverySession)
	if !ok {
		t.Fatalf("sessions = %#v, want []recoverySession", response["sessions"])
	}
	if len(sessions) != 1 || sessions[0].SessionID != want {
		t.Fatalf("sessions = %#v, want only %q", sessions, want)
	}
}

func TestClaudeFamilyRecoveryUsesIsolatedProjectsDirs(t *testing.T) {
	homeDir := t.TempDir()
	stateDir := t.TempDir()
	cwd := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(homeDir, ".claude", "projects"), "native", "sess-native", cwd, "Native Claude", "native preview")
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(stateDir, ".data", "cc-deepseek", "projects"), "deepseek", "sess-deepseek", cwd, "DeepSeek", "deepseek preview")
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(stateDir, ".data", "cc-glm", "projects"), "glm", "sess-glm", cwd, "GLM", "glm preview")
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(stateDir, ".data", "cc-kimi", "projects"), "kimi", "sess-kimi", cwd, "Kimi", "kimi preview")
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(stateDir, ".data", "cc-qwen", "projects"), "qwen", "sess-qwen", cwd, "Qwen", "qwen preview")
	writeClaudeSessionFixtureAtProjectsDir(t, filepath.Join(stateDir, ".data", "cc-flicker", "projects"), "flicker", "sess-flicker", cwd, "Flicker", "flicker preview")

	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := NewWithRuntime(store, "proj1", cwd, RuntimeConfig{StateDir: stateDir})
	defer c.Close()

	for _, testCase := range []struct {
		agentType string
		sessionID string
	}{
		{agentType: "claude", sessionID: "sess-native"},
		{agentType: "cc-deepseek", sessionID: "sess-deepseek"},
		{agentType: "cc-glm", sessionID: "sess-glm"},
		{agentType: "cc-kimi", sessionID: "sess-kimi"},
		{agentType: "cc-qwen", sessionID: "sess-qwen"},
		{agentType: "cc-flicker", sessionID: "sess-flicker"},
	} {
		t.Run(testCase.agentType, func(t *testing.T) {
			response, err := c.recovery().ListResumableSessions(context.Background(), testCase.agentType)
			if err != nil {
				t.Fatalf("ListResumableSessions(%q): %v", testCase.agentType, err)
			}
			sessions, ok := response["sessions"].([]recoverySession)
			if !ok {
				t.Fatalf("sessions response = %#v, want []recoverySession", response["sessions"])
			}
			if len(sessions) != 1 || sessions[0].SessionID != testCase.sessionID {
				t.Fatalf("sessions = %+v, want only %s", sessions, testCase.sessionID)
			}
			if sessions[0].AgentType != testCase.agentType {
				t.Fatalf("session AgentType = %q, want %q", sessions[0].AgentType, testCase.agentType)
			}
		})
	}
}

func TestDeepSeekPromptBlocksAllowText(t *testing.T) {
	s := mustNewSession(t, "sess-deepseek-text", t.TempDir(), "cc-deepseek")
	blocks := []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "inspect the repository"}}

	got, err := s.promptBlocksForAgent(blocks)
	if err != nil {
		t.Fatalf("promptBlocksForAgent(text) error = %v", err)
	}
	if !reflect.DeepEqual(got, blocks) {
		t.Fatalf("promptBlocksForAgent(text) = %#v, want %#v", got, blocks)
	}
}

func TestDeepSeekPromptBlocksRejectImages(t *testing.T) {
	tests := []struct {
		name  string
		block acp.ContentBlock
	}{
		{name: "inline image", block: acp.ContentBlock{Type: acp.ContentBlockTypeImage, MimeType: "image/png", Data: "abc123"}},
		{name: "image resource", block: acp.ContentBlock{Type: acp.ContentBlockTypeResourceLink, MimeType: "image/jpeg", URI: "file:///tmp/photo.jpg"}},
		{name: "unsupported image mime resource", block: acp.ContentBlock{Type: acp.ContentBlockTypeResourceLink, MimeType: "image/svg+xml", URI: "file:///tmp/diagram.svg"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := mustNewSession(t, "sess-deepseek-image", t.TempDir(), "cc-deepseek")
			_, err := s.promptBlocksForAgent([]acp.ContentBlock{tt.block})
			if err == nil || !strings.Contains(err.Error(), "cc-deepseek does not support image input") {
				t.Fatalf("promptBlocksForAgent(image) error = %v, want unsupported image error", err)
			}
		})
	}
}

func TestHandleSessionRequestSessionResumeRejectsCodexAppAfterMigration(t *testing.T) {
	c := newSessionViewTestClient(t)

	_, err := c.HandleSessionRequest(context.Background(), "session.resume.list", "proj1", json.RawMessage(`{"agentType":"codexapp"}`))
	if err == nil || !strings.Contains(err.Error(), "unsupported recovery agent: codexapp") {
		t.Fatalf("session.resume.list err=%v, want codexapp rejection", err)
	}
	_, err = c.HandleSessionRequest(context.Background(), "session.resume.import", "proj1", json.RawMessage(`{"agentType":"codexapp","sessionId":"sess-codex-resume"}`))
	if err == nil || !strings.Contains(err.Error(), "unsupported recovery agent: codexapp") {
		t.Fatalf("session.resume.import err=%v, want codexapp rejection", err)
	}
}

func TestHandleSessionRequestSessionResumeImportRejectsAlreadyManagedClaudeSession(t *testing.T) {
	cwd := t.TempDir()
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	writeClaudeSessionFixture(t, homeDir, "wheelmaker", "sess-dup", cwd, "Resume me", "assistant preview")

	c := newSessionViewTestClient(t)
	c.cwd = cwd
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 9, 5, 0, 0, time.UTC)

	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-dup",
		ProjectName:  "proj1",
		Status:       SessionPersisted,
		AgentType:    "claude",
		AgentJSON:    `{}`,
		CreatedAt:    now,
		LastActiveAt: now,
		Title:        "Already managed",
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	_, err := c.HandleSessionRequest(ctx, "session.resume.import", "proj1", json.RawMessage(`{"agentType":"claude","sessionId":"sess-dup"}`))
	if err == nil {
		t.Fatal("expected duplicate managed session import to fail")
	}
	if !strings.Contains(err.Error(), "already managed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHandleSessionRequest_SessionNewRequiresAgentType(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	_, err = c.HandleSessionRequest(context.Background(), "session.create", "proj1", json.RawMessage(`{"title":"hello"}`))
	if err == nil || !strings.Contains(err.Error(), "agentType is required") {
		t.Fatalf("HandleSessionRequest() err = %v, want agentType is required", err)
	}
}

func TestHandleSessionRequestSessionNewRejectsCodexAppAfterMigration(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	inst := &testInjectedInstance{name: "codex", initResult: acp.InitializeResult{ProtocolVersion: "0.1"}, newResult: &acp.SessionNewResult{SessionID: "sess-1"}}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) { return inst, nil })

	_, err = c.HandleSessionRequest(context.Background(), "session.create", "proj1", json.RawMessage(`{"agentType":"codexapp","title":"hello"}`))
	if err == nil || !strings.Contains(err.Error(), `no agent registered for "codexapp"`) {
		t.Fatalf("session.create err=%v, want codexapp rejection", err)
	}
}

func TestHandleSessionRequest_SessionNewPersistsProjectDefaultAgent(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	inst := &testInjectedInstance{name: "claude", initResult: acp.InitializeResult{ProtocolVersion: "0.1"}, newResult: &acp.SessionNewResult{SessionID: "sess-1"}}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) { return inst, nil })

	_, err = c.HandleSessionRequest(context.Background(), "session.create", "proj1", json.RawMessage(`{"agentType":"claude","title":"hello"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.create): %v", err)
	}

	got, err := store.LoadProjectDefaultAgent(context.Background(), "proj1")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if got != "claude" {
		t.Fatalf("default agent = %q, want claude", got)
	}
}

func TestHandleSessionRequestSessionCreatePersistsCreateRequestID(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj1", "/tmp")
	inst := &testInjectedInstance{name: "codex", initResult: acp.InitializeResult{ProtocolVersion: "0.1"}, newResult: &acp.SessionNewResult{SessionID: "sess-created"}}
	c.registry = agent.DefaultACPFactory().Clone()
	c.registry.Register(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) { return inst, nil })

	resp, err := c.HandleSessionRequest(
		context.Background(),
		"session.create",
		"proj1",
		json.RawMessage(`{"agentType":"codex","createRequestId":"draft-request-1"}`),
	)
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.create): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("response type = %T, want map[string]any", resp)
	}
	created, ok := body["session"].(sessionViewSummary)
	if !ok {
		t.Fatalf("response session = %#v, want sessionViewSummary", body["session"])
	}
	if created.CreateRequestID != "draft-request-1" {
		t.Fatalf("response createRequestId = %q, want draft-request-1", created.CreateRequestID)
	}

	record, err := store.LoadSession(context.Background(), "proj1", "sess-created")
	if err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if record == nil {
		t.Fatal("created session record is missing")
	}
	var state SessionAgentState
	if err := json.Unmarshal([]byte(record.AgentJSON), &state); err != nil {
		t.Fatalf("decode AgentJSON: %v", err)
	}
	if state.CreateRequestID != "draft-request-1" {
		t.Fatalf("persisted createRequestId = %q, want draft-request-1", state.CreateRequestID)
	}

	listedResp, err := c.HandleSessionRequest(context.Background(), "session.list", "proj1", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.list): %v", err)
	}
	listedBody := listedResp.(map[string]any)
	listed := listedBody["sessions"].([]sessionViewSummary)
	if len(listed) != 1 || listed[0].CreateRequestID != "draft-request-1" {
		t.Fatalf("listed sessions = %#v, want persisted createRequestId", listed)
	}
}

func TestHandleSessionRequest_SessionListIncludesConfigOptions(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 5, 10, 5, 0, 0, 0, time.UTC)

	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-1",
		ProjectName:  "proj1",
		Status:       SessionPersisted,
		AgentType:    "claude",
		AgentJSON:    `{}`,
		Title:        "Session 1",
		CreatedAt:    now,
		LastActiveAt: now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	if err := c.store.SaveAgentPreference(ctx, AgentPreferenceRecord{
		ProjectName:    "proj1",
		AgentType:      "claude",
		PreferenceJSON: `{"configOptions":[{"id":"mode","currentValue":"code"}]}`,
	}); err != nil {
		t.Fatalf("SaveAgentPreference: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.list", "proj1", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.list): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("response type = %T, want map[string]any", resp)
	}
	sessions, ok := body["sessions"].([]sessionViewSummary)
	if !ok {
		t.Fatalf("sessions type = %T, want []sessionViewSummary", body["sessions"])
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if got := len(sessions[0].ConfigOptions); got != 1 {
		t.Fatalf("configOptions len = %d, want 1", got)
	}
	if sessions[0].ConfigOptions[0].ID != "mode" || sessions[0].ConfigOptions[0].CurrentValue != "code" {
		t.Fatalf("config option = %+v", sessions[0].ConfigOptions[0])
	}
}

func TestHandleSessionRequest_SessionListIncludesUsage(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 5, 10, 5, 0, 0, 0, time.UTC)

	agentJSON, err := json.Marshal(SessionAgentState{
		Usage: &acp.SessionUsage{Used: 19000, Size: 258000, UpdatedAt: "2026-07-07T08:00:00Z"},
		AgentCapabilities: wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{
			Compact: true, Steer: true, Fork: true, Goal: true,
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-1",
		ProjectName:  "proj1",
		Status:       SessionPersisted,
		AgentType:    string(acp.ACPProviderCodex),
		AgentJSON:    string(agentJSON),
		Title:        "Session 1",
		CreatedAt:    now,
		LastActiveAt: now,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	resp, err := c.HandleSessionRequest(ctx, "session.list", "proj1", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.list): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("response type = %T, want map[string]any", resp)
	}
	sessions, ok := body["sessions"].([]sessionViewSummary)
	if !ok {
		t.Fatalf("sessions type = %T, want []sessionViewSummary", body["sessions"])
	}
	if len(sessions) != 1 {
		t.Fatalf("sessions len = %d, want 1", len(sessions))
	}
	if sessions[0].Usage == nil {
		t.Fatal("usage missing from session summary")
	}
	if sessions[0].Usage.Used != 19000 || sessions[0].Usage.Size != 258000 || sessions[0].Usage.UpdatedAt != "2026-07-07T08:00:00Z" {
		t.Fatalf("usage = %+v", sessions[0].Usage)
	}
	if !sessions[0].SessionActions.Status.Supported ||
		!sessions[0].SessionActions.Compact.Supported ||
		!sessions[0].SessionActions.Steer.Supported ||
		!sessions[0].SessionActions.Fork.Supported {
		t.Fatalf("sessionActions = %+v, want Codex status, compact, steer, and fork support", sessions[0].SessionActions)
	}
}

func TestSessionListProjectsCompactFromPersistedCommand(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 8, 0, 0, 0, time.UTC)
	agentJSON, err := json.Marshal(SessionAgentState{
		Commands: []acp.AvailableCommand{{Name: "compact"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.store.SaveSession(ctx, &SessionRecord{
		ID:           "sess-command-compact-summary",
		ProjectName:  "proj1",
		Status:       SessionPersisted,
		AgentType:    string(acp.ACPProviderClaude),
		AgentJSON:    string(agentJSON),
		Title:        "Claude compact",
		CreatedAt:    now,
		LastActiveAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	response, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionList, "proj1", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	sessions := responseMapForTest(t, response)["sessions"].([]sessionViewSummary)
	if len(sessions) != 1 || !sessions[0].SessionActions.Compact.Supported {
		t.Fatalf("sessions=%#v, want persisted compact command support", sessions)
	}
}

func TestHandleSessionRequestSessionStatusUsesPersistedStateWithoutAgent(t *testing.T) {
	for _, agentType := range []string{
		string(acp.ACPProviderCodex),
		string(acp.ACPProviderCXDeepSeek),
		string(acp.ACPProviderClaude),
		"unknown-agent",
	} {
		t.Run(agentType, func(t *testing.T) {
			store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
			if err != nil {
				t.Fatalf("NewStore: %v", err)
			}
			ctx := context.Background()
			if err := store.SaveSession(ctx, &SessionRecord{
				ID:           "sess-status",
				ProjectName:  "proj1",
				Status:       SessionPersisted,
				AgentType:    agentType,
				AgentJSON:    `{"usage":{"used":9000,"size":128000,"updatedAt":"2026-07-30T10:00:00Z"}}`,
				CreatedAt:    time.Now().Add(-time.Hour),
				LastActiveAt: time.Now().Add(-time.Minute),
			}); err != nil {
				t.Fatalf("SaveSession: %v", err)
			}

			inst := &testInjectedInstance{
				name:      agentType,
				sessionID: "sess-status",
				alive:     true,
				statusResult: acp.SessionActionStatusResult{
					OK: true,
					Limits: []acp.SessionActionRateLimit{{
						ID:               "provider-limit",
						Name:             "Must not appear",
						UsedPercent:      1,
						RemainingPercent: 99,
					}},
					Account: &acp.SessionActionStatusAccount{PlanType: "provider-plan"},
				},
			}
			creatorCalls := 0
			c := New(store, "proj1", t.TempDir())
			c.registry = agent.NewACPFactory()
			if provider, ok := acp.ParseACPProvider(agentType); ok {
				c.registry.Register(provider, func(context.Context, string) (agent.Instance, error) {
					creatorCalls++
					return inst, nil
				})
			}
			t.Cleanup(func() { _ = c.Close() })

			response, err := c.HandleSessionRequest(
				ctx,
				acp.RegistryMethodSessionStatus,
				"proj1",
				json.RawMessage(`{"sessionId":"sess-status"}`),
			)
			if err != nil {
				t.Fatalf("HandleSessionRequest(session.status): %v", err)
			}
			status, ok := response.(acp.SessionActionStatusResult)
			if !ok {
				t.Fatalf("status response type = %T", response)
			}
			if !status.OK || status.SessionID != "sess-status" || status.AgentType != agentType {
				t.Fatalf("status identity = %+v", status)
			}
			if status.Context == nil ||
				status.Context.Used != 9000 ||
				status.Context.Size == nil ||
				*status.Context.Size != 128000 ||
				status.Context.UpdatedAt != "2026-07-30T10:00:00Z" {
				t.Fatalf("status context = %+v", status.Context)
			}
			if status.Limits == nil || len(status.Limits) != 0 {
				t.Fatalf("status limits = %#v, want non-nil empty slice", status.Limits)
			}
			if status.Account != nil {
				t.Fatalf("status account = %+v, want nil", status.Account)
			}
			if creatorCalls != 0 || inst.initCalls != 0 || inst.loadCalls != 0 || inst.statusCalls != 0 {
				t.Fatalf(
					"calls creator=%d initialize=%d load=%d providerStatus=%d",
					creatorCalls,
					inst.initCalls,
					inst.loadCalls,
					inst.statusCalls,
				)
			}
			encoded, err := json.Marshal(status)
			if err != nil {
				t.Fatalf("marshal status: %v", err)
			}
			if !bytes.Contains(encoded, []byte(`"limits":[]`)) {
				t.Fatalf("status json = %s, want limits:[]", encoded)
			}
			if bytes.Contains(encoded, []byte(`"account"`)) {
				t.Fatalf("status json = %s, want account omitted", encoded)
			}
		})
	}
}

func TestSessionViewReadRepairsSameTurnOverwriteFromCheckpoint(t *testing.T) {
	c := newSessionViewTestClient(t)

	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-1", "Task")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewPromptEvent("sess-1", "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"}),
		Status:        "streaming",
	})); err != nil {
		t.Fatalf("RecordEvent update #1: %v", err)
	}
	if err := c.RecordEvent(context.Background(), sessionViewUpdateEvent("sess-1", acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " world"}),
		Status:        "done",
	})); err != nil {
		t.Fatalf("RecordEvent update #2: %v", err)
	}

	payload, err := json.Marshal(map[string]any{"sessionId": "sess-1"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	resp, err := c.HandleSessionRequest(context.Background(), "session.read", "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest: %v", err)
	}
	body := resp.(map[string]any)
	messages := body["turns"].([]sessionViewTurn)
	if len(messages) != 2 {
		t.Fatalf("messages len = %d, want 2", len(messages))
	}
	if messages[1].TurnIndex != 2 {
		t.Fatalf("messages[1].TurnIndex = %d, want 2", messages[1].TurnIndex)
	}
	if method := decodeTurnMethod(t, messages[1].Content); method != acp.SessionUpdateAgentMessageChunk {
		t.Fatalf("messages[1] method = %q, want %q", method, acp.SessionUpdateAgentMessageChunk)
	}
	if text := strings.TrimSpace(extractTextChunk(decodeTurnSessionUpdate(t, messages[1].Content).Content)); text != "hello world" {
		t.Fatalf("messages[1] text = %q, want hello world", text)
	}
}

func decodeTurnSessionUpdate(t *testing.T, raw string) acp.SessionUpdate {
	t.Helper()

	var legacy struct {
		Method string `json:"method"`
		Params struct {
			Update acp.SessionUpdate `json:"update"`
		} `json:"params"`
	}
	if err := json.Unmarshal([]byte(raw), &legacy); err == nil && strings.TrimSpace(legacy.Params.Update.SessionUpdate) != "" {
		return legacy.Params.Update
	}

	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal turn update_json: %v", err)
	}
	switch strings.TrimSpace(msg.Method) {
	case acp.SessionTurnMethodAgentMessage, acp.SessionTurnMethodAgentThought, acp.SessionUpdateUserMessageChunk:
		result := acp.SessionTurnTextResult{}
		if err := json.Unmarshal(msg.Param, &result); err != nil {
			t.Fatalf("unmarshal text result: %v", err)
		}
		return acp.SessionUpdate{SessionUpdate: strings.TrimSpace(msg.Method), Content: mustJSON(map[string]any{"text": result.Text})}
	case acp.SessionTurnMethodToolCall:
		result := acp.SessionTurnToolResult{}
		if err := json.Unmarshal(msg.Param, &result); err != nil {
			t.Fatalf("unmarshal tool result: %v", err)
		}
		return acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateToolCallUpdate,
			Title:         strings.TrimSpace(result.Cmd),
			Kind:          strings.TrimSpace(result.Kind),
			Status:        strings.TrimSpace(result.Status),
		}
	case acp.SessionTurnMethodAgentPlan:
		plan := acp.SessionTurnPlanPayload{}
		if err := json.Unmarshal(msg.Param, &plan); err != nil {
			t.Fatalf("unmarshal plan result: %v", err)
		}
		entries := make([]acp.PlanEntry, 0, len(plan.Entries))
		for _, entry := range plan.Entries {
			entries = append(entries, acp.PlanEntry{Content: entry.Content, Status: entry.Status})
		}
		return acp.SessionUpdate{SessionUpdate: acp.SessionUpdatePlan, Entries: entries}
	default:
		t.Fatalf("turn update_json has unsupported method for update decode: %s", raw)
	}
	return acp.SessionUpdate{}
}

func decodeTurnMethod(t *testing.T, raw string) string {
	t.Helper()
	msg := acp.SessionTurnMessage{}
	if err := json.Unmarshal([]byte(raw), &msg); err == nil {
		switch strings.TrimSpace(msg.Method) {
		case acp.SessionTurnMethodPromptRequest, acp.SessionTurnMethodPromptDone:
			return acp.MethodSessionPrompt
		default:
			return strings.TrimSpace(msg.Method)
		}
	}
	var doc struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("unmarshal turn method: %v", err)
	}
	return strings.TrimSpace(doc.Method)
}
func TestSessionViewToolCallAndUpdateMergeByToolCallID(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Tool Merge")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run build", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}

	toolStart := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCall,
		ToolCallID:    "call-1",
		Status:        "in_progress",
		Title:         "build",
		Kind:          acp.ToolKindExecute,
		ToolCallContent: []acp.ToolCallContent{{
			Type:    "content",
			Content: &acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "building"},
		}},
		RawInput: json.RawMessage(`{"target":"app"}`),
		Meta:     json.RawMessage(`{"vendor":{"start":true}}`),
	}
	toolDone := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateToolCallUpdate,
		ToolCallID:    "call-1",
		Status:        "completed",
		Title:         "build",
		Locations:     []acp.ToolCallLocation{{Path: "app/main.go"}},
		RawOutput:     json.RawMessage(`{"exitCode":0}`),
		Meta:          json.RawMessage(`{"vendor":{"done":true}}`),
	}

	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", toolStart)); err != nil {
		t.Fatalf("RecordEvent tool start: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", toolDone)); err != nil {
		t.Fatalf("RecordEvent tool done: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3 (prompt + merged tool turn + prompt_done)", len(turns))
	}
	toolTurn := turns[1]
	update := decodeTurnSessionUpdate(t, toolTurn)
	if update.SessionUpdate != acp.SessionUpdateToolCallUpdate {
		t.Fatalf("tool turn sessionUpdate = %q, want %q", update.SessionUpdate, acp.SessionUpdateToolCallUpdate)
	}
	if update.Status != "completed" {
		t.Fatalf("tool turn status = %q, want %q", update.Status, "completed")
	}
	var toolMessage acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(toolTurn), &toolMessage); err != nil {
		t.Fatal(err)
	}
	var toolPayload acp.SessionTurnToolResult
	if err := json.Unmarshal(toolMessage.Param, &toolPayload); err != nil {
		t.Fatal(err)
	}
	if toolPayload.Kind != acp.ToolKindExecute || len(toolPayload.Content) != 1 ||
		len(toolPayload.Locations) != 1 || string(toolPayload.RawInput) != `{"target":"app"}` ||
		string(toolPayload.RawOutput) != `{"exitCode":0}` {
		t.Fatalf("tool fidelity lost: %#v", toolPayload)
	}
	wantToolMeta := json.RawMessage(`{"vendor":{"start":true,"done":true}}`)
	if !jsonEqualForTest(toolPayload.Meta, wantToolMeta) {
		t.Fatalf("tool meta=%s, want %s", toolPayload.Meta, wantToolMeta)
	}
}

func TestSessionRecorderCompletionMarkerUpdatesMessageWithoutNewTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-message-complete", "Lifecycle")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-message-complete", "answer", nil)); err != nil {
		t.Fatal(err)
	}
	first := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
		MessageID:     "message-1",
		Meta:          json.RawMessage(`{"wm":{"messagePhase":"commentary","nested":{"left":1}},"vendor":{"trace":"keep"}}`),
	}
	completed := acp.SessionUpdate{
		SessionUpdate: acp.SessionUpdateAgentMessageChunk,
		Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: ""}),
		MessageID:     "message-1",
		Meta:          json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"right":2}}}`),
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-message-complete", first)); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-message-complete", completed)); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-message-complete", "")); err != nil {
		t.Fatal(err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-message-complete", 1)
	if len(turns) != 3 {
		t.Fatalf("turns=%d, want prompt + one message + done", len(turns))
	}
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turns[1]), &message); err != nil {
		t.Fatal(err)
	}
	var payload acp.SessionTurnTextResult
	if err := json.Unmarshal(message.Param, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Text != "answer" || payload.MessageID != "message-1" || !payload.MessageComplete {
		t.Fatalf("payload=%#v", payload)
	}
	wantMeta := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"left":1,"right":2}},"vendor":{"trace":"keep"}}`)
	if !jsonEqualForTest(payload.Meta, wantMeta) {
		t.Fatalf("meta=%s, want %s", payload.Meta, wantMeta)
	}
}

func TestSessionRecorderPreservesButDoesNotInterpretUnnegotiatedLifecycle(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-lifecycle-unnegotiated", "Lifecycle")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-lifecycle-unnegotiated", "answer", nil)); err != nil {
		t.Fatal(err)
	}
	unauthorized := false
	first := acp.SessionUpdate{
		SessionUpdate:    acp.SessionUpdateAgentMessageChunk,
		Content:          mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
		MessageID:        "message-1",
		MessageLifecycle: &unauthorized,
	}
	completionMeta := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true},"vendor":{"trace":"keep"}}`)
	completed := acp.SessionUpdate{
		SessionUpdate:    acp.SessionUpdateAgentMessageChunk,
		Content:          mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: ""}),
		MessageID:        "message-1",
		MessageLifecycle: &unauthorized,
		Meta:             completionMeta,
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-lifecycle-unnegotiated", first)); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-lifecycle-unnegotiated", completed)); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-lifecycle-unnegotiated", "")); err != nil {
		t.Fatal(err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-lifecycle-unnegotiated", 1)
	if len(turns) != 3 {
		t.Fatalf("turns=%d, want prompt + one message + done", len(turns))
	}
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turns[1]), &message); err != nil {
		t.Fatal(err)
	}
	var payload acp.SessionTurnTextResult
	if err := json.Unmarshal(message.Param, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Text != "answer" || payload.MessageComplete {
		t.Fatalf("payload=%#v", payload)
	}
	if !jsonEqualForTest(payload.Meta, completionMeta) {
		t.Fatalf("meta=%s, want %s", payload.Meta, completionMeta)
	}
}

func TestSessionRecorderCompletionPreservesValidPhaseAndIgnoresLateChunk(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-message-late", "Lifecycle")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-message-late", "answer", nil)); err != nil {
		t.Fatal(err)
	}
	updates := []acp.SessionUpdate{
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "answer"}),
			MessageID:     "message-1",
			Meta:          acp.BuildSessionUpdateMetaMessagePhase("commentary"),
		},
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: ""}),
			MessageID:     "message-1",
			Meta:          json.RawMessage(`{"wm":{"messagePhase":"future_phase","messageComplete":true}}`),
		},
		{
			SessionUpdate: acp.SessionUpdateAgentMessageChunk,
			Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: " late"}),
			MessageID:     "message-1",
		},
	}
	for _, update := range updates {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-message-late", update)); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-message-late", "")); err != nil {
		t.Fatal(err)
	}
	turns := listRecordedPromptTurns(ctx, t, c, "sess-message-late", 1)
	if len(turns) != 3 {
		t.Fatalf("turns=%d, want prompt + one message + done", len(turns))
	}
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turns[1]), &message); err != nil {
		t.Fatal(err)
	}
	var payload acp.SessionTurnTextResult
	if err := json.Unmarshal(message.Param, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Text != "answer" || !payload.MessageComplete || acp.SessionUpdateMetaMessagePhase(payload.Meta) != "commentary" {
		t.Fatalf("payload=%#v meta=%s", payload, payload.Meta)
	}
}

func TestSessionRecorderAggregatesStandardSteeredChunks(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-steer-standard", "Steer")); err != nil {
		t.Fatal(err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-steer-standard", "start", nil)); err != nil {
		t.Fatal(err)
	}
	blocks := []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "change"},
		{Type: acp.ContentBlockTypeImage, MimeType: "image/png", Data: "abc"},
		{Type: acp.ContentBlockTypeResourceLink, URI: "file:///tmp/note.txt", Name: "note.txt"},
	}
	for index, block := range blocks {
		meta := json.RawMessage(nil)
		if index == len(blocks)-1 {
			meta = acp.BuildSessionUpdateMetaLifecycle("", true, true)
		}
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-steer-standard", acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateUserMessageChunk,
			Content:       mustJSON(block),
			MessageID:     "queue-item-1",
			Meta:          meta,
		})); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-steer-standard", "")); err != nil {
		t.Fatal(err)
	}
	turns := listRecordedPromptTurns(ctx, t, c, "sess-steer-standard", 1)
	if len(turns) != 3 {
		t.Fatalf("turns=%d, want prompt + one steer + done", len(turns))
	}
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turns[1]), &message); err != nil {
		t.Fatal(err)
	}
	var payload acp.SessionTurnUserMessage
	if err := json.Unmarshal(message.Param, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ContentBlocks) != 3 || payload.ClientMessageID != "queue-item-1" || payload.MessageID != "queue-item-1" || !payload.Steered || !payload.MessageComplete {
		t.Fatalf("payload=%#v", payload)
	}
}

func TestSessionSummaryAndArchivePreserveMessageLifecycleFeature(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	state := SessionAgentState{AgentCapabilities: acp.AgentCapabilities{
		Meta: acp.BuildWMAgentCapabilitiesMeta(nil, acp.WMAgentExtensionCapabilities{MessageLifecycle: true}),
	}}
	agentJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	record := &SessionRecord{
		ID: "sess-feature", ProjectName: "proj1", AgentType: "third-party", Title: "Feature",
		AgentJSON: string(agentJSON), CreatedAt: time.Now().UTC(), LastActiveAt: time.Now().UTC(),
	}
	if err := c.store.SaveSession(ctx, record); err != nil {
		t.Fatal(err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.SessionFeatures == nil || summary.SessionFeatures.MessageLifecycle == nil || summary.SessionFeatures.MessageLifecycle.Version != 1 {
		t.Fatalf("sessionFeatures=%#v", summary.SessionFeatures)
	}
	archive := newSessionArchiveStore(t.TempDir())
	entry, created, err := archive.AppendSession(ctx, *record, nil, 0)
	if err != nil || !created {
		t.Fatalf("AppendSession created=%v err=%v", created, err)
	}
	if entry.SessionFeatures == nil || entry.SessionFeatures.MessageLifecycle == nil || entry.SessionFeatures.MessageLifecycle.Version != 1 {
		t.Fatalf("archive sessionFeatures=%#v", entry.SessionFeatures)
	}
	archivedSummary := archiveSummaryFromEntry(entry)
	if archivedSummary.SessionFeatures == nil || archivedSummary.SessionFeatures.MessageLifecycle == nil {
		t.Fatalf("archived summary sessionFeatures=%#v", archivedSummary.SessionFeatures)
	}
}

func TestOldSessionSummaryMayOmitSessionFeatures(t *testing.T) {
	c := newSessionViewTestClient(t)
	record := &SessionRecord{
		ID: "sess-old-feature", ProjectName: "proj1", AgentType: "codex", Title: "Old",
		AgentJSON: `{}`, CreatedAt: time.Now().UTC(), LastActiveAt: time.Now().UTC(),
	}
	if err := c.store.SaveSession(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.SessionFeatures != nil {
		t.Fatalf("old sessionFeatures=%#v, want nil", summary.SessionFeatures)
	}
}

func jsonEqualForTest(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func TestSessionViewBufferedUpdatesDoNotLeakAcrossPrompts(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Isolation")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "p1", nil)); err != nil {
		t.Fatalf("RecordEvent user prompt #1: %v", err)
	}
	chunk1 := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"})}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk1)); err != nil {
		t.Fatalf("RecordEvent chunk #1: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #1: %v", err)
	}

	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "p2", nil)); err != nil {
		t.Fatalf("RecordEvent user prompt #2: %v", err)
	}
	chunk2 := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"})}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk2)); err != nil {
		t.Fatalf("RecordEvent chunk #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #2: %v", err)
	}

	turnsPrompt1 := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	turnsPrompt2 := listRecordedPromptTurns(ctx, t, c, "sess-1", 2)
	if len(turnsPrompt1) != 3 || len(turnsPrompt2) != 3 {
		t.Fatalf("turn counts = (%d,%d), want (3,3)", len(turnsPrompt1), len(turnsPrompt2))
	}

	update1 := decodeTurnSessionUpdate(t, turnsPrompt1[1])
	update2 := decodeTurnSessionUpdate(t, turnsPrompt2[1])
	if text := extractTextChunk(update1.Content); text != "hello" {
		t.Fatalf("prompt1 assistant text = %q, want %q", text, "hello")
	}
	if text := extractTextChunk(update2.Content); text != "world" {
		t.Fatalf("prompt2 assistant text = %q, want %q", text, "world")
	}
}
func TestExtractTextChunkSupportsLooseShapes(t *testing.T) {
	if got := extractTextChunk(mustJSON(map[string]any{"text": "hello"})); got != "hello" {
		t.Fatalf("extractTextChunk(map text) = %q, want %q", got, "hello")
	}
	if got := extractTextChunk(mustJSON([]any{
		map[string]any{"type": "text", "text": "hello"},
		map[string]any{"text": " world"},
	})); got != "hello world" {
		t.Fatalf("extractTextChunk(array) = %q, want %q", got, "hello world")
	}
	if got := extractTextChunk(mustJSON("!")); got != "!" {
		t.Fatalf("extractTextChunk(string) = %q, want %q", got, "!")
	}
}
func TestSessionViewToolCallTerminalUpdatesRemainSingleTurn(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Tool Terminal Merge")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run task", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}

	updates := []acp.SessionUpdate{
		{SessionUpdate: acp.SessionUpdateToolCall, ToolCallID: "call-terminal", Status: acp.ToolCallStatusInProgress, Title: "task"},
		{SessionUpdate: acp.SessionUpdateToolCallUpdate, ToolCallID: "call-terminal", Status: acp.ToolCallStatusFailed, Title: "task"},
		{SessionUpdate: acp.SessionUpdateToolCallUpdate, ToolCallID: "call-terminal", Status: acp.ToolCallStatusCancelled, Title: "task"},
	}
	for i := range updates {
		u := updates[i]
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", u)); err != nil {
			t.Fatalf("RecordEvent tool update #%d: %v", i+1, err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}

	turns := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3 (prompt + merged tool turn + prompt_done)", len(turns))
	}
	toolTurn := turns[1]
	update := decodeTurnSessionUpdate(t, toolTurn)
	if update.Status != acp.ToolCallStatusCancelled {
		t.Fatalf("tool turn status = %q, want %q", update.Status, acp.ToolCallStatusCancelled)
	}
}

func TestSessionViewPermissionEventsAreIgnored(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Permission Ignored")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent user message: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPermissionRequestedEvent("sess-1", "allow?", 7, nil)); err != nil {
		t.Fatalf("RecordEvent permission requested: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPermissionResolvedEvent("sess-1", 7, "done", mustRFC3339Time(t, "2026-04-12T10:02:00Z"))); err != nil {
		t.Fatalf("RecordEvent permission resolved: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1 (prompt only)", len(turns))
	}
}
func TestSessionViewDropsOrphanPermissionResult(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Permission Orphan")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "run protected", nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPermissionResolvedEvent("sess-1", 7, "done", mustRFC3339Time(t, "2026-04-12T10:02:00Z"))); err != nil {
		t.Fatalf("RecordEvent orphan permission resolved: %v", err)
	}

	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-1", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns len = %d, want 1 (prompt only)", len(turns))
	}
}
func TestSessionViewNextPromptFlushesPreviousWithoutPromptFinished(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()

	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-1", "Prompt Carry")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "first", nil)); err != nil {
		t.Fatalf("RecordEvent user prompt #1: %v", err)
	}
	chunk1 := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "hello"})}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk1)); err != nil {
		t.Fatalf("RecordEvent chunk #1: %v", err)
	}

	if err := c.RecordEvent(ctx, sessionViewPromptEvent("sess-1", "second", nil)); err != nil {
		t.Fatalf("RecordEvent user prompt #2: %v", err)
	}
	chunk2 := acp.SessionUpdate{SessionUpdate: acp.SessionUpdateAgentMessageChunk, Content: mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "world"})}
	if err := c.RecordEvent(ctx, sessionViewUpdateEvent("sess-1", chunk2)); err != nil {
		t.Fatalf("RecordEvent chunk #2: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent("sess-1", "")); err != nil {
		t.Fatalf("RecordEvent prompt finished #2: %v", err)
	}

	turnsPrompt1 := listRecordedPromptTurns(ctx, t, c, "sess-1", 1)
	turnsPrompt2 := listRecordedPromptTurns(ctx, t, c, "sess-1", 2)
	if len(turnsPrompt1) != 3 {
		t.Fatalf("prompt1 stored turns = %d, want 3 (prompt + chunk + interrupted prompt_done)", len(turnsPrompt1))
	}
	if len(turnsPrompt2) != 3 {
		t.Fatalf("prompt2 stored turns = %d, want 3", len(turnsPrompt2))
	}
	update1 := decodeTurnSessionUpdate(t, turnsPrompt1[1])
	if text := extractTextChunk(update1.Content); text != "hello" {
		t.Fatalf("prompt1 assistant text = %q, want %q", text, "hello")
	}
	if stopReason := decodePromptDoneStopReason(t, turnsPrompt1[2]); stopReason != "interrupted" {
		t.Fatalf("prompt1 prompt_done stopReason = %q, want interrupted", stopReason)
	}
	update2 := decodeTurnSessionUpdate(t, turnsPrompt2[1])
	if text := extractTextChunk(update2.Content); text != "world" {
		t.Fatalf("prompt2 assistant text = %q, want %q", text, "world")
	}
}

func seedPromptWithTurns(t *testing.T, c *Client, ctx context.Context, sessionID, promptText string, updates []acp.SessionUpdate) {
	t.Helper()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent(sessionID, promptText)); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	if err := c.RecordEvent(ctx, sessionViewPromptEvent(sessionID, promptText, nil)); err != nil {
		t.Fatalf("RecordEvent prompt: %v", err)
	}
	for i, update := range updates {
		if err := c.RecordEvent(ctx, sessionViewUpdateEvent(sessionID, update)); err != nil {
			t.Fatalf("RecordEvent update #%d: %v", i+1, err)
		}
	}
	if err := c.RecordEvent(ctx, sessionViewPromptFinishedEvent(sessionID, acp.StopReasonEndTurn)); err != nil {
		t.Fatalf("RecordEvent prompt finished: %v", err)
	}
}

func hasPromptDoneTurnWithStopReason(t *testing.T, turns []sessionViewTurn, stopReason string) bool {
	t.Helper()
	for _, message := range turns {
		var turn acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(message.Content), &turn); err != nil {
			t.Fatalf("unmarshal turn content: %v", err)
		}
		if turn.Method != acp.SessionTurnMethodPromptDone {
			continue
		}
		var result acp.SessionTurnPromptResult
		raw, err := json.Marshal(turn.Param)
		if err != nil {
			t.Fatalf("marshal prompt_done param: %v", err)
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatalf("unmarshal prompt_done param: %v", err)
		}
		return result.StopReason == stopReason
	}
	return false
}

func decodePromptDoneStopReason(t *testing.T, raw string) string {
	t.Helper()
	var turn acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(raw), &turn); err != nil {
		t.Fatalf("unmarshal prompt_done turn: %v", err)
	}
	if turn.Method != acp.SessionTurnMethodPromptDone {
		t.Fatalf("turn method = %q, want %q", turn.Method, acp.SessionTurnMethodPromptDone)
	}
	var result acp.SessionTurnPromptResult
	if err := json.Unmarshal(turn.Param, &result); err != nil {
		t.Fatalf("unmarshal prompt_done param: %v", err)
	}
	return result.StopReason
}

func decodeTurnParamMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var turn acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(raw), &turn); err != nil {
		t.Fatalf("unmarshal turn: %v", err)
	}
	out := map[string]any{}
	if len(turn.Param) == 0 {
		return out
	}
	if err := json.Unmarshal(turn.Param, &out); err != nil {
		t.Fatalf("unmarshal turn param: %v", err)
	}
	return out
}

func listRecordedPromptTurns(ctx context.Context, t *testing.T, c *Client, sessionID string, promptOrdinal int64) []string {
	t.Helper()
	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	currentPrompt := int64(0)
	out := []string{}
	for _, turn := range turns {
		var msg acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &msg); err != nil {
			t.Fatalf("unmarshal turn content: %v", err)
		}
		if strings.TrimSpace(msg.Method) == acp.SessionTurnMethodPromptRequest || currentPrompt == 0 {
			currentPrompt++
		}
		if currentPrompt == promptOrdinal {
			out = append(out, turn.Content)
		}
	}
	return out
}

func mustRFC3339Time(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("time.Parse(%q): %v", value, err)
	}
	return parsed
}

type mockSession struct {
	promptCalls []string
	cancelCalls int
	agentName   string
	sessionID   string
	promptFn    func(string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error)
}

func newTestClient(t *testing.T, mock *mockSession) *Client {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := New(store, "test", t.TempDir())
	c.InjectForwarder(mock.agentName, mock.sessionID, func(_ context.Context, text string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error) {
		mock.promptCalls = append(mock.promptCalls, text)
		if mock.promptFn != nil {
			return mock.promptFn(text)
		}
		ch := make(chan acp.SessionUpdateParams)
		close(ch)
		return ch, acp.PromptOutcome{StopReason: acp.StopReasonEndTurn}, nil
	}, func() error {
		mock.cancelCalls++
		return nil
	})
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func newAttachmentTestClient(t *testing.T, sessionID string) *Client {
	t.Helper()
	return newAttachmentTestClientWithMock(t, &mockSession{agentName: "codex", sessionID: sessionID})
}

func newAttachmentTestClientWithMock(t *testing.T, mock *mockSession) *Client {
	t.Helper()
	c := newTestClient(t, mock)
	c.SetSessionHistoryRoot(filepath.Join(t.TempDir(), "db", "session"))
	return c
}

func TestSessionAttachmentDownloadResolverReturnsPersistedFileMetadata(t *testing.T) {
	c := newAttachmentTestClient(t, "session-download")
	block := uploadSessionAttachmentForTest(
		t,
		c,
		"session-download",
		"original report.txt",
		"text/plain",
		[]byte("attachment bytes"),
	)
	attachmentID := blockAttachmentIDForTest(t, block)

	path, fileName, mimeType, err := c.ResolveSessionAttachmentDownload(
		context.Background(),
		"session-download",
		attachmentID,
		block.URI,
	)
	if err != nil {
		t.Fatalf("ResolveSessionAttachmentDownload: %v", err)
	}
	if fileName != "original report.txt" || mimeType != "text/plain" {
		t.Fatalf("fileName=%q mimeType=%q", fileName, mimeType)
	}
	raw, err := os.ReadFile(path)
	if err != nil || string(raw) != "attachment bytes" {
		t.Fatalf("resolved bytes=%q err=%v", raw, err)
	}
	if _, _, _, err := c.ResolveSessionAttachmentDownload(context.Background(), "wrong-session", attachmentID, block.URI); err == nil {
		t.Fatal("mismatched session should be rejected")
	}
}

func uploadSessionAttachmentForTest(t *testing.T, c *Client, sessionID, name, mimeType string, data []byte) acp.ContentBlock {
	t.Helper()
	uploadID := startSessionAttachmentForTest(t, c, sessionID, name, mimeType, len(data))
	chunkSessionAttachmentForTest(t, c, sessionID, uploadID, 0, base64ForTest(data))
	sum := sha256.Sum256(data)
	payload := fmt.Sprintf(`{"sessionId":%q,"uploadId":%q,"sha256":"%x"}`, sessionID, uploadID, sum)
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.finish", "proj1", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("finish attachment: %v", err)
	}
	body := responseMapForTest(t, resp)
	raw, err := json.Marshal(body["block"])
	if err != nil {
		t.Fatalf("marshal block response: %v", err)
	}
	var block acp.ContentBlock
	if err := json.Unmarshal(raw, &block); err != nil {
		t.Fatalf("unmarshal block response: %v", err)
	}
	return block
}

func startSessionAttachmentForTest(t *testing.T, c *Client, sessionID, name, mimeType string, size int) string {
	t.Helper()
	payload := fmt.Sprintf(`{"sessionId":%q,"name":%q,"mimeType":%q,"size":%d}`, sessionID, name, mimeType, size)
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.start", "proj1", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("start attachment: %v", err)
	}
	body := responseMapForTest(t, resp)
	uploadID, _ := body["uploadId"].(string)
	if uploadID == "" {
		t.Fatalf("start response=%#v, want uploadId", body)
	}
	return uploadID
}

func chunkSessionAttachmentForTest(t *testing.T, c *Client, sessionID, uploadID string, offset int, data string) {
	t.Helper()
	payload := fmt.Sprintf(`{"sessionId":%q,"uploadId":%q,"offset":%d,"data":%q}`, sessionID, uploadID, offset, data)
	if _, err := c.HandleSessionRequest(context.Background(), "session.attachment.chunk", "proj1", json.RawMessage(payload)); err != nil {
		t.Fatalf("chunk attachment: %v", err)
	}
}

func responseMapForTest(t *testing.T, resp any) map[string]any {
	t.Helper()
	body, ok := resp.(map[string]any)
	if !ok {
		t.Fatalf("response type=%T, want map[string]any", resp)
	}
	return body
}

func attachmentFileURIPathForTest(t *testing.T, uri string) string {
	t.Helper()
	parsed, err := url.Parse(uri)
	if err != nil {
		t.Fatalf("parse uri %q: %v", uri, err)
	}
	if !strings.EqualFold(parsed.Scheme, "file") {
		t.Fatalf("uri=%q, want file scheme", uri)
	}
	path := parsed.Path
	if parsed.Host != "" {
		path = "//" + parsed.Host + path
	}
	if len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		path = path[1:]
	}
	return filepath.FromSlash(path)
}

func attachmentSidecarPathForTest(path string) string {
	return strings.TrimSuffix(path, filepath.Ext(path)) + ".json"
}

func blockAttachmentIDForTest(t *testing.T, block acp.ContentBlock) string {
	t.Helper()
	path := attachmentFileURIPathForTest(t, block.URI)
	id := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if id == "" {
		t.Fatalf("block URI %q does not contain attachment id", block.URI)
	}
	return id
}

func base64ForTest(data []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var b strings.Builder
	for i := 0; i < len(data); i += 3 {
		remain := len(data) - i
		a := data[i]
		var c1, c2 byte
		if remain > 1 {
			c1 = data[i+1]
		}
		if remain > 2 {
			c2 = data[i+2]
		}
		b.WriteByte(alphabet[a>>2])
		b.WriteByte(alphabet[((a&0x03)<<4)|(c1>>4)])
		if remain > 1 {
			b.WriteByte(alphabet[((c1&0x0f)<<2)|(c2>>6)])
		} else {
			b.WriteByte('=')
		}
		if remain > 2 {
			b.WriteByte(alphabet[c2&0x3f])
		} else {
			b.WriteByte('=')
		}
	}
	return b.String()
}

func tinyPNGForTest(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255})
	img.Set(1, 0, color.NRGBA{B: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode tiny png: %v", err)
	}
	return buf.Bytes()
}

func TestStart_CreatesProjectRowWhenMissing(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	c := New(store, "proj-a", t.TempDir())
	if err := c.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	sqliteStore, ok := store.(*sqliteStore)
	if !ok {
		t.Fatal("store type mismatch")
	}

	var rows int
	if err := sqliteStore.db.QueryRow(`SELECT COUNT(1) FROM projects WHERE project_name = ?`, "proj-a").Scan(&rows); err != nil {
		t.Fatalf("query projects row count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("projects rows = %d, want 1", rows)
	}

	got, err := store.LoadProjectDefaultAgent(context.Background(), "proj-a")
	if err != nil {
		t.Fatalf("LoadProjectDefaultAgent: %v", err)
	}
	if got != "" {
		t.Fatalf("default agent = %q, want empty", got)
	}
}

func TestHandleSessionQueueSlashTextIsPrompt(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-send-slash"}
	c := newTestClient(t, mock)
	published := captureSessionMessageEvents(t, c)

	payload := queuePromptPayload("sess-send-slash", "slash-1", []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "/skills"}})
	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.queue): %v", err)
	}
	body, ok := resp.(map[string]any)
	if !ok || body["ok"] != true {
		t.Fatalf("response = %#v, want ok=true", resp)
	}

	eventuallyQueue(t, func() bool { return len(*published) > 0 })
	first := (*published)[0].payload
	turn := publishedTurnMap(t, first)
	content, _ := turn["content"].(string)
	if !strings.Contains(content, `"/skills"`) {
		t.Fatalf("first turn content = %q, want prompt text /skills", content)
	}
	if strings.Contains(content, `"method":"system"`) {
		t.Fatalf("slash text was handled as a system command: %q", content)
	}
}

func TestSessionAttachmentUploadCompletesResourceLinkBlock(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-file")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-file", "report.pdf", "application/pdf", []byte("hello world"))

	if block.Type != acp.ContentBlockTypeResourceLink {
		t.Fatalf("block.Type=%q, want resource_link", block.Type)
	}
	if block.Name != "report.pdf" || block.MimeType != "application/pdf" || block.Size != 11 {
		t.Fatalf("block=%#v, want report.pdf metadata", block)
	}
	uriPath := attachmentFileURIPathForTest(t, block.URI)
	if !strings.Contains(filepath.ToSlash(uriPath), "/attachments/sha256-") || !strings.HasSuffix(uriPath, ".pdf") {
		t.Fatalf("uri path=%q, want attachment sha path with pdf extension", uriPath)
	}
	raw, err := os.ReadFile(uriPath)
	if err != nil {
		t.Fatalf("read attachment: %v", err)
	}
	if string(raw) != "hello world" {
		t.Fatalf("attachment content=%q, want hello world", raw)
	}
}

func TestSessionAttachmentUploadCompletesImageAsResourceLinkBlock(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-image")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-image", "pixel.png", "image/png", []byte("hello"))

	if block.Type != acp.ContentBlockTypeResourceLink {
		t.Fatalf("block.Type=%q, want resource_link", block.Type)
	}
	if block.Data != "" {
		t.Fatalf("block.Data=%q, want uploaded image to use file uri", block.Data)
	}
	if block.URI == "" || block.MimeType != "image/png" || block.Name != "pixel.png" {
		t.Fatalf("block=%#v, want image uri metadata", block)
	}
}

func TestSessionAttachmentUploadCreatesImageThumbnailSidecar(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-thumb")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-thumb", "pixel.png", "image/png", tinyPNGForTest(t))
	path := attachmentFileURIPathForTest(t, block.URI)
	sidecar, err := readAttachmentSidecar(attachmentSidecarPathForTest(path))
	if err != nil {
		t.Fatalf("read sidecar: %v", err)
	}
	if sidecar.Kind != "image" {
		t.Fatalf("sidecar.Kind=%q, want image", sidecar.Kind)
	}
	if sidecar.Thumbnail.FileName == "" {
		t.Fatal("thumbnail file name empty")
	}
	if sidecar.Thumbnail.MimeType != "image/jpeg" {
		t.Fatalf("thumbnail mime=%q, want image/jpeg", sidecar.Thumbnail.MimeType)
	}
	if sidecar.Thumbnail.Width <= 0 || sidecar.Thumbnail.Width > 128 {
		t.Fatalf("thumbnail width=%d, want 1..128", sidecar.Thumbnail.Width)
	}
	if sidecar.Thumbnail.Height <= 0 || sidecar.Thumbnail.Height > 128 {
		t.Fatalf("thumbnail height=%d, want 1..128", sidecar.Thumbnail.Height)
	}
	thumbPath := filepath.Join(filepath.Dir(path), sidecar.Thumbnail.FileName)
	if _, err := os.Stat(thumbPath); err != nil {
		t.Fatalf("thumbnail stat: %v", err)
	}
	if sidecar.Thumbnail.Size <= 0 {
		t.Fatalf("thumbnail size=%d, want positive", sidecar.Thumbnail.Size)
	}
	if sidecar.Thumbnail.SHA256 == "" {
		t.Fatal("thumbnail sha256 empty")
	}
}

func TestSessionAttachmentUploadOmitsThumbnailForNonImage(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-file-thumb")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-file-thumb", "report.pdf", "application/pdf", []byte("hello world"))
	path := attachmentFileURIPathForTest(t, block.URI)
	sidecar, err := readAttachmentSidecar(attachmentSidecarPathForTest(path))
	if err != nil {
		t.Fatalf("read sidecar: %v", err)
	}
	if sidecar.Kind != "file" {
		t.Fatalf("sidecar.Kind=%q, want file", sidecar.Kind)
	}
	if sidecar.Thumbnail.FileName != "" {
		t.Fatalf("thumbnail=%#v, want empty", sidecar.Thumbnail)
	}
}

func TestSessionAttachmentThumbnailReadsGeneratedJPEG(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-thumb-read")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-thumb-read", "pixel.png", "image/png", tinyPNGForTest(t))
	payload := mustJSON(map[string]any{
		"sessionId": "sess-attach-thumb-read",
		"uri":       block.URI,
	})
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.thumbnail", "proj1", payload)
	if err != nil {
		t.Fatalf("session.attachment.thumbnail: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true || body["sessionId"] != "sess-attach-thumb-read" {
		t.Fatalf("thumbnail response=%#v, want ok session", body)
	}
	if body["mimeType"] != "image/jpeg" || body["encoding"] != "base64" {
		t.Fatalf("thumbnail response=%#v, want jpeg base64", body)
	}
	if body["content"] == "" {
		t.Fatalf("thumbnail response=%#v, want content", body)
	}
	if body["attachmentId"] != blockAttachmentIDForTest(t, block) {
		t.Fatalf("attachmentId=%#v, want block id", body["attachmentId"])
	}
}

func TestSessionAttachmentReadReadsOriginalImage(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-original-read")
	imageBytes := tinyPNGForTest(t)
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-original-read", "pixel.png", "image/png", imageBytes)
	payload := mustJSON(map[string]any{
		"sessionId":    "sess-attach-original-read",
		"attachmentId": blockAttachmentIDForTest(t, block),
	})
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.read", "proj1", payload)
	if err != nil {
		t.Fatalf("session.attachment.read: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true || body["sessionId"] != "sess-attach-original-read" {
		t.Fatalf("read response=%#v, want ok session", body)
	}
	if body["mimeType"] != "image/png" || body["encoding"] != "base64" {
		t.Fatalf("read response=%#v, want png base64", body)
	}
	if body["content"] != base64ForTest(imageBytes) {
		t.Fatalf("read content mismatch")
	}
}

func TestSessionAttachmentThumbnailRejectsNonImage(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-file-thumb-read")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-file-thumb-read", "report.pdf", "application/pdf", []byte("hello world"))
	payload := mustJSON(map[string]any{
		"sessionId": "sess-attach-file-thumb-read",
		"uri":       block.URI,
	})
	_, err := c.HandleSessionRequest(context.Background(), "session.attachment.thumbnail", "proj1", payload)
	if err == nil || !strings.Contains(err.Error(), "not_image") {
		t.Fatalf("thumbnail err=%v, want not_image", err)
	}
}

func TestSessionQueueConvertsUploadedImageResourceLinkForImageCapableACPAgent(t *testing.T) {
	mock := &mockSession{agentName: "claude", sessionID: "sess-send-image"}
	c := newAttachmentTestClientWithMock(t, mock)
	imageBytes := []byte("hello")
	block := uploadSessionAttachmentForTest(t, c, "sess-send-image", "pixel.png", "image/png", imageBytes)

	sess, err := c.SessionForTest("sess-send-image")
	if err != nil {
		t.Fatalf("SessionForTest: %v", err)
	}
	sess.mu.Lock()
	sess.agentState.AgentCapabilities.PromptCapabilities = &acp.PromptCapabilities{Image: true}
	sess.mu.Unlock()

	payload := queuePromptPayload("sess-send-image", "image-1", []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "describe"},
		block,
	})
	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err != nil {
		t.Fatalf("session.queue: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("send response=%#v, want ok", body)
	}

	inst := sess.instance.(*testInjectedInstance)
	eventuallyQueue(t, func() bool { return len(inst.lastPrompt) == 2 })
	if len(inst.lastPrompt) != 2 {
		t.Fatalf("lastPrompt len=%d, want 2: %#v", len(inst.lastPrompt), inst.lastPrompt)
	}
	got := inst.lastPrompt[1]
	if got.Type != acp.ContentBlockTypeImage || got.MimeType != "image/png" || got.Data != base64ForTest(imageBytes) {
		t.Fatalf("lastPrompt image block=%#v, want base64 image data", got)
	}
	if got.URI != "" || got.Name != "" {
		t.Fatalf("lastPrompt image block=%#v, want no resource_link metadata in ACP image block", got)
	}
}

func TestSessionAttachmentUploadRejectsOffsetMismatch(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-offset")
	uploadID := startSessionAttachmentForTest(t, c, "sess-attach-offset", "note.txt", "text/plain", 2)
	chunkSessionAttachmentForTest(t, c, "sess-attach-offset", uploadID, 0, "YQ==")

	payload := fmt.Sprintf(`{"sessionId":"sess-attach-offset","uploadId":%q,"offset":0,"data":"Yg=="}`, uploadID)
	_, err := c.HandleSessionRequest(context.Background(), "session.attachment.chunk", "proj1", json.RawMessage(payload))
	if err == nil || !strings.Contains(err.Error(), "offset") {
		t.Fatalf("second chunk err=%v, want offset rejection", err)
	}
}

func TestSessionAttachmentUploadRejectsSHA256Mismatch(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-sha")
	uploadID := startSessionAttachmentForTest(t, c, "sess-attach-sha", "note.txt", "text/plain", 5)
	chunkSessionAttachmentForTest(t, c, "sess-attach-sha", uploadID, 0, "aGVsbG8=")

	payload := fmt.Sprintf(`{"sessionId":"sess-attach-sha","uploadId":%q,"sha256":"%064x"}`, uploadID, 0)
	_, err := c.HandleSessionRequest(context.Background(), "session.attachment.finish", "proj1", json.RawMessage(payload))
	if err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("finish err=%v, want sha256 rejection", err)
	}
}

func TestSessionAttachmentUploadExpiresIdlePartial(t *testing.T) {
	oldNow := attachmentNow
	base := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	attachmentNow = func() time.Time { return base }
	t.Cleanup(func() { attachmentNow = oldNow })

	c := newAttachmentTestClient(t, "sess-attach-expire")
	uploadID := startSessionAttachmentForTest(t, c, "sess-attach-expire", "note.txt", "text/plain", 5)
	chunkSessionAttachmentForTest(t, c, "sess-attach-expire", uploadID, 0, "aGVsbG8=")
	startedPath := c.attachments.uploadPartPathForTest(uploadID)
	if _, err := os.Stat(startedPath); err != nil {
		t.Fatalf("partial stat before expiry: %v", err)
	}

	attachmentNow = func() time.Time { return base.Add(attachmentIdleTTL + time.Second) }
	payload := fmt.Sprintf(`{"sessionId":"sess-attach-expire","uploadId":%q,"offset":5,"data":"IQ=="}`, uploadID)
	_, err := c.HandleSessionRequest(context.Background(), "session.attachment.chunk", "proj1", json.RawMessage(payload))
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired chunk err=%v, want expired rejection", err)
	}
	if _, err := os.Stat(startedPath); !os.IsNotExist(err) {
		t.Fatalf("partial stat after expiry err=%v, want removed", err)
	}
}

func TestSessionAttachmentUploadCancelRemovesPartial(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-cancel")
	uploadID := startSessionAttachmentForTest(t, c, "sess-attach-cancel", "note.txt", "text/plain", 5)
	chunkSessionAttachmentForTest(t, c, "sess-attach-cancel", uploadID, 0, "aGVsbG8=")
	startedPath := c.attachments.uploadPartPathForTest(uploadID)

	payload := fmt.Sprintf(`{"sessionId":"sess-attach-cancel","uploadId":%q}`, uploadID)
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.cancel", "proj1", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("cancel response=%#v, want ok", body)
	}
	if _, err := os.Stat(startedPath); !os.IsNotExist(err) {
		t.Fatalf("partial stat after cancel err=%v, want removed", err)
	}
}

func TestSessionAttachmentDeleteRemovesCompletedFileAndSidecar(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-delete")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-delete", "report.pdf", "application/pdf", []byte("hello world"))
	path := attachmentFileURIPathForTest(t, block.URI)
	sidecarPath := attachmentSidecarPathForTest(path)

	payload := fmt.Sprintf(`{"sessionId":"sess-attach-delete","attachmentId":"%s"}`, blockAttachmentIDForTest(t, block))
	resp, err := c.HandleSessionRequest(context.Background(), "session.attachment.delete", "proj1", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("delete response=%#v, want ok", body)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("attachment stat after delete err=%v, want removed", err)
	}
	if _, err := os.Stat(sidecarPath); !os.IsNotExist(err) {
		t.Fatalf("sidecar stat after delete err=%v, want removed", err)
	}
}

func TestSessionAttachmentDeleteRemovesCompletedImageThumbnail(t *testing.T) {
	c := newAttachmentTestClient(t, "sess-attach-delete-thumb")
	block := uploadSessionAttachmentForTest(t, c, "sess-attach-delete-thumb", "pixel.png", "image/png", tinyPNGForTest(t))
	path := attachmentFileURIPathForTest(t, block.URI)
	sidecar, err := readAttachmentSidecar(attachmentSidecarPathForTest(path))
	if err != nil {
		t.Fatalf("read sidecar: %v", err)
	}
	if sidecar.Thumbnail.FileName == "" {
		t.Fatalf("thumbnail missing in sidecar: %#v", sidecar)
	}
	thumbPath := filepath.Join(filepath.Dir(path), sidecar.Thumbnail.FileName)

	payload := fmt.Sprintf(`{"sessionId":"sess-attach-delete-thumb","attachmentId":"%s"}`, blockAttachmentIDForTest(t, block))
	if _, err := c.HandleSessionRequest(context.Background(), "session.attachment.delete", "proj1", json.RawMessage(payload)); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(thumbPath); !os.IsNotExist(err) {
		t.Fatalf("thumbnail stat after delete err=%v, want removed", err)
	}
}

func TestSessionQueueAcceptsUploadedAttachmentBlock(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-send-attachment"}
	c := newAttachmentTestClientWithMock(t, mock)
	block := uploadSessionAttachmentForTest(t, c, "sess-send-attachment", "report.pdf", "application/pdf", []byte("hello world"))
	payload := queuePromptPayload("sess-send-attachment", "attachment-1", []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "read this"},
		block,
	})

	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err != nil {
		t.Fatalf("session.queue: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("send response=%#v, want ok", body)
	}
	sess, err := c.SessionForTest("sess-send-attachment")
	if err != nil {
		t.Fatalf("SessionForTest: %v", err)
	}
	inst := sess.instance.(*testInjectedInstance)
	eventuallyQueue(t, func() bool { return len(inst.lastPrompt) == 2 })
	if len(inst.lastPrompt) != 2 || inst.lastPrompt[1].URI != block.URI || inst.lastPrompt[1].Data != "" {
		t.Fatalf("lastPrompt=%#v, want uploaded attachment block", inst.lastPrompt)
	}
	sidecar, err := readAttachmentSidecar(attachmentSidecarPathForTest(attachmentFileURIPathForTest(t, block.URI)))
	if err != nil {
		t.Fatal(err)
	}
	if !sidecar.Sent {
		t.Fatalf("attachment sidecar = %#v, want sent", sidecar)
	}
}

func TestSessionQueueAttachmentCommitFailureDoesNotCreateQueueItem(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-attachment-commit-failure"}
	c := newAttachmentTestClientWithMock(t, mock)
	block := uploadSessionAttachmentForTest(
		t,
		c,
		"sess-attachment-commit-failure",
		"report.pdf",
		"application/pdf",
		[]byte("hello world"),
	)
	c.markAttachmentsSent = func([]attachmentRef) error {
		return errors.New("sidecar write failed")
	}

	_, err := c.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionQueue,
		"proj1",
		queuePromptPayload(
			"sess-attachment-commit-failure",
			"attachment-failed",
			[]acp.ContentBlock{
				{Type: acp.ContentBlockTypeText, Text: "read this"},
				block,
			},
		),
	)
	if err == nil || !strings.Contains(err.Error(), "sidecar write failed") {
		t.Fatalf("session.queue error = %v, want sidecar failure", err)
	}

	sess, sessionErr := c.SessionForTest("sess-attachment-commit-failure")
	if sessionErr != nil {
		t.Fatal(sessionErr)
	}
	if got := sess.queueSnapshot(true); got.ActiveItem != nil || got.WaitingCount != 0 || len(got.WaitingItems) != 0 {
		t.Fatalf("queue after attachment commit failure = %#v", got)
	}
	if len(mock.promptCalls) != 0 {
		t.Fatalf("promptCalls = %v, want no execution", mock.promptCalls)
	}
}

func TestSessionQueueConvertsProjectRelativeResourceLinkToFileURI(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-send-project-file"}
	c := newAttachmentTestClientWithMock(t, mock)
	projectFile := filepath.Join(c.cwd, "src", "MobileInstance.ts")
	if err := os.MkdirAll(filepath.Dir(projectFile), 0o755); err != nil {
		t.Fatalf("mkdir project file dir: %v", err)
	}
	if err := os.WriteFile(projectFile, []byte("export const mobile = true;\n"), 0o644); err != nil {
		t.Fatalf("write project file: %v", err)
	}
	payload := queuePromptPayload("sess-send-project-file", "project-file-1", []acp.ContentBlock{
		{Type: acp.ContentBlockTypeText, Text: "use this file"},
		{Type: acp.ContentBlockTypeResourceLink, URI: "src/MobileInstance.ts", Name: "MobileInstance.ts"},
	})

	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err != nil {
		t.Fatalf("session.queue: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("send response=%#v, want ok", body)
	}
	sess, err := c.SessionForTest("sess-send-project-file")
	if err != nil {
		t.Fatalf("SessionForTest: %v", err)
	}
	inst := sess.instance.(*testInjectedInstance)
	eventuallyQueue(t, func() bool { return len(inst.lastPrompt) == 2 })
	if len(inst.lastPrompt) != 2 {
		t.Fatalf("lastPrompt=%#v, want text and resource_link", inst.lastPrompt)
	}
	got := inst.lastPrompt[1]
	if got.Type != acp.ContentBlockTypeResourceLink || got.Name != "MobileInstance.ts" {
		t.Fatalf("lastPrompt resource=%#v, want resource_link MobileInstance.ts", got)
	}
	uriPath := attachmentFileURIPathForTest(t, got.URI)
	if uriPath != projectFile {
		t.Fatalf("resource uri path=%q, want %q", uriPath, projectFile)
	}
}

func TestSessionQueueRejectsProjectRelativeResourceLinkOutsideProject(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-send-project-file-outside"}
	c := newAttachmentTestClientWithMock(t, mock)
	payload := queuePromptPayload("sess-send-project-file-outside", "outside-project-1", []acp.ContentBlock{{
		Type: acp.ContentBlockTypeResourceLink,
		URI:  "../secret.txt",
		Name: "secret.txt",
	}})

	_, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err == nil || !strings.Contains(err.Error(), "project file") {
		t.Fatalf("session.queue err=%v, want project file containment rejection", err)
	}
	if len(mock.promptCalls) != 0 {
		t.Fatalf("promptCalls=%v, want rejected before prompt", mock.promptCalls)
	}
}

func TestSessionQueueRejectsAttachmentFileURIOutsideSession(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-send-outside"}
	c := newAttachmentTestClientWithMock(t, mock)
	payload := queuePromptPayload("sess-send-outside", "outside-attachment-1", []acp.ContentBlock{{
		Type:     acp.ContentBlockTypeResourceLink,
		URI:      "file:///C:/outside/report.pdf",
		Name:     "report.pdf",
		MimeType: "application/pdf",
	}})

	_, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", payload)
	if err == nil || !strings.Contains(err.Error(), "attachment") {
		t.Fatalf("session.queue err=%v, want attachment containment rejection", err)
	}
	if len(mock.promptCalls) != 0 {
		t.Fatalf("promptCalls=%v, want rejected before prompt", mock.promptCalls)
	}
}

func TestPromptToSessionRecordsFailedPromptDoneOnAgentError(t *testing.T) {
	mock := &mockSession{
		agentName: "codex",
		sessionID: "sess-prompt-error",
		promptFn: func(string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error) {
			return nil, acp.PromptOutcome{}, errors.New("agent crashed")
		},
	}
	c := newTestClient(t, mock)
	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-prompt-error", "Prompt Error")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	if err := c.PromptToSession(context.Background(), "sess-prompt-error", []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "hello"}}); err == nil || !strings.Contains(err.Error(), "agent crashed") {
		t.Fatalf("PromptToSession error = %v, want agent crashed", err)
	}
	_, turns, err := c.sessionRecorder.ReadSessionTurns(context.Background(), "sess-prompt-error", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want prompt_request + failed prompt_done: %+v", len(turns), turns)
	}
	if stopReason := decodePromptDoneStopReason(t, turns[1].Content); stopReason != acp.SessionTurnStopReasonFailed {
		t.Fatalf("prompt_done stopReason = %q, want failed", stopReason)
	}
	param := decodeTurnParamMap(t, turns[1].Content)
	if !strings.Contains(fmt.Sprint(param["message"]), "agent crashed") {
		t.Fatalf("prompt_done message = %#v, want agent error", param["message"])
	}
}

func TestBuildPromptReplyPreview(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"collapses whitespace", "line one\n\n  line\t two", "line one line two"},
		{"strips markdown", "## Title\n- **bold** and `code`\n[link](https://x.y)", "Title bold and code link"},
		{"drops fenced code markers", "```go\nfmt.Println()\n```", "fmt.Println()"},
		{"plain short text unchanged", "Done, fixed the bug.", "Done, fixed the bug."},
		{"empty for whitespace only", " \n\t ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildPromptReplyPreview(tc.raw); got != tc.want {
				t.Fatalf("buildPromptReplyPreview(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
	t.Run("keeps the tail of long replies", func(t *testing.T) {
		got := buildPromptReplyPreview(strings.Repeat("word ", 60))
		if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "word") {
			t.Fatalf("tail preview = %q, want ellipsis prefix and tail content", got)
		}
		if n := len([]rune(got)); n > promptReplyPreviewMaxRunes+len([]rune("…")) {
			t.Fatalf("preview too long: %d runes", n)
		}
	})
}

func TestPromptDoneIncludesReplyPreview(t *testing.T) {
	mock := &mockSession{
		agentName: "codex",
		sessionID: "sess-reply-preview",
		promptFn: func(string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error) {
			ch := make(chan acp.SessionUpdateParams, 2)
			ch <- acp.SessionUpdateParams{Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "## Result\n- **Fixed** the login bug"}),
			}}
			ch <- acp.SessionUpdateParams{Update: acp.SessionUpdate{
				SessionUpdate: acp.SessionUpdateAgentMessageChunk,
				Content:       mustJSON(acp.ContentBlock{Type: acp.ContentBlockTypeText, Text: "\nand added tests."}),
			}}
			close(ch)
			return ch, acp.PromptOutcome{StopReason: acp.StopReasonEndTurn}, nil
		},
	}
	c := newTestClient(t, mock)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-reply-preview", "Reply Preview")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	if err := c.PromptToSession(ctx, "sess-reply-preview", []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "fix it"}}); err != nil {
		t.Fatalf("PromptToSession: %v", err)
	}
	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-reply-preview", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	last := turns[len(turns)-1]
	if stopReason := decodePromptDoneStopReason(t, last.Content); stopReason != acp.StopReasonEndTurn {
		t.Fatalf("prompt_done stopReason = %q, want end_turn", stopReason)
	}
	param := decodeTurnParamMap(t, last.Content)
	if got := fmt.Sprint(param["replyPreview"]); got != "Result Fixed the login bug and added tests." {
		t.Fatalf("replyPreview = %q, want cleaned assistant text", got)
	}
}

func TestPromptDoneReplyPreviewFallsBackToErrorMessage(t *testing.T) {
	mock := &mockSession{
		agentName: "codex",
		sessionID: "sess-preview-fallback",
		promptFn: func(string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error) {
			return nil, acp.PromptOutcome{}, errors.New("agent crashed")
		},
	}
	c := newTestClient(t, mock)
	ctx := context.Background()
	if err := c.RecordEvent(ctx, sessionViewCreatedEvent("sess-preview-fallback", "Preview Fallback")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	if err := c.PromptToSession(ctx, "sess-preview-fallback", []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "hello"}}); err == nil {
		t.Fatal("PromptToSession expected agent error")
	}
	_, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, "sess-preview-fallback", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	param := decodeTurnParamMap(t, turns[len(turns)-1].Content)
	if got := fmt.Sprint(param["replyPreview"]); !strings.Contains(got, "agent crashed") {
		t.Fatalf("replyPreview = %q, want fallback to error message", got)
	}
}

func TestHandleSessionQueueCancelFinishesPromptAsCancelled(t *testing.T) {
	mock := &mockSession{agentName: "codex", sessionID: "sess-cancel-running"}
	c := newTestClient(t, mock)
	if err := c.RecordEvent(context.Background(), sessionViewCreatedEvent("sess-cancel-running", "Cancel Running")); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}

	started := make(chan struct{})
	releaseUpdates := make(chan struct{})
	var cancelCalls int
	c.InjectForwarder("codex", "sess-cancel-running", func(ctx context.Context, _ string) (<-chan acp.SessionUpdateParams, acp.PromptOutcome, error) {
		ch := make(chan acp.SessionUpdateParams)
		close(started)
		go func() {
			defer close(ch)
			<-releaseUpdates
		}()
		<-ctx.Done()
		close(releaseUpdates)
		return ch, acp.PromptOutcome{}, ctx.Err()
	}, func() error {
		cancelCalls++
		return nil
	})

	_, err := c.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionQueue,
		"proj1",
		queuePromptPayload("sess-cancel-running", "cancel-item-1", []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: "please stop"}}),
	)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	<-started

	resp, err := c.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionQueue, "proj1", json.RawMessage(`{"sessionId":"sess-cancel-running","action":"cancel","itemId":"cancel-item-1"}`))
	if err != nil {
		t.Fatalf("HandleSessionRequest(session.queue cancel): %v", err)
	}
	if body, ok := resp.(map[string]any); !ok || body["ok"] != true {
		t.Fatalf("response = %#v, want ok=true", resp)
	}
	sess, err := c.SessionForTest("sess-cancel-running")
	if err != nil {
		t.Fatal(err)
	}
	eventuallyQueue(t, func() bool { return !sess.queuePinsMemory() })
	if cancelCalls != 1 {
		t.Fatalf("cancelCalls = %d, want 1", cancelCalls)
	}
	_, turns, err := c.sessionRecorder.ReadSessionTurns(context.Background(), "sess-cancel-running", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("turns len = %d, want prompt_request + cancelled prompt_done: %+v", len(turns), turns)
	}
	if stopReason := decodePromptDoneStopReason(t, turns[1].Content); stopReason != acp.StopReasonCancelled {
		t.Fatalf("prompt_done stopReason = %q, want cancelled", stopReason)
	}
}

const promptDiffArtifactSampleDiff = "diff --git a/app/web/src/app/WorkspaceApp.tsx b/app/web/src/app/WorkspaceApp.tsx\n" +
	"--- a/app/web/src/app/WorkspaceApp.tsx\n" +
	"+++ b/app/web/src/app/WorkspaceApp.tsx\n" +
	"@@ -1,2 +1,3 @@\n" +
	"-old\n" +
	"+new\n" +
	"+again\n" +
	" context\n" +
	"diff --git a/server/internal/hub/client/session_artifacts.go b/server/internal/hub/client/session_artifacts.go\n" +
	"new file mode 100644\n" +
	"--- /dev/null\n" +
	"+++ b/server/internal/hub/client/session_artifacts.go\n" +
	"@@ -0,0 +1,2 @@\n" +
	"+package client\n" +
	"+\n" +
	"diff --git a/deleted.txt b/deleted.txt\n" +
	"deleted file mode 100644\n" +
	"--- a/deleted.txt\n" +
	"+++ /dev/null\n" +
	"@@ -1 +0,0 @@\n" +
	"-removed\n"

func TestParseUnifiedDiffArtifactFiles(t *testing.T) {
	files := parseUnifiedDiffArtifactFiles(promptDiffArtifactSampleDiff)
	if len(files) != 3 {
		t.Fatalf("files len = %d, want 3", len(files))
	}
	if files[0].Path != "app/web/src/app/WorkspaceApp.tsx" || files[0].Status != "M" || files[0].Additions != 2 || files[0].Deletions != 1 {
		t.Fatalf("modified file metadata = %+v", files[0])
	}
	if files[1].Path != "server/internal/hub/client/session_artifacts.go" || files[1].Status != "A" || files[1].Additions != 2 || files[1].Deletions != 0 {
		t.Fatalf("added file metadata = %+v", files[1])
	}
	if files[2].Path != "deleted.txt" || files[2].Status != "D" || files[2].Additions != 0 || files[2].Deletions != 1 {
		t.Fatalf("deleted file metadata = %+v", files[2])
	}
}

func TestFileSessionArtifactStoreWritesReadsAndDeletesDiffArtifacts(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store := newFileSessionArtifactStore(root)

	meta, err := store.WriteDiffArtifact(ctx, "proj:one", "sess/one", promptDiffArtifactSampleDiff)
	if err != nil {
		t.Fatalf("WriteDiffArtifact: %v", err)
	}
	if meta.ArtifactID == "" {
		t.Fatal("artifact id is empty")
	}
	if meta.Type != "diff" || meta.Format != "unified-diff" || meta.FileCount != 3 {
		t.Fatalf("artifact metadata = %+v, want diff unified-diff with 3 files", meta)
	}

	body, err := store.ReadArtifact(ctx, "proj:one", "sess/one", meta.ArtifactID)
	if err != nil {
		t.Fatalf("ReadArtifact: %v", err)
	}
	if body.ArtifactID != meta.ArtifactID || body.Type != "diff" || body.Format != "unified-diff" {
		t.Fatalf("read metadata = %+v, want artifact id/type/format from write", body)
	}
	if body.Content != promptDiffArtifactSampleDiff {
		t.Fatalf("read content = %q, want original diff", body.Content)
	}

	if _, err := store.ReadArtifact(ctx, "proj:one", "sess/one", "../escape"); err == nil {
		t.Fatal("ReadArtifact path traversal error = nil, want error")
	}

	if err := store.DeleteArtifacts(ctx, "proj:one", "sess/one"); err != nil {
		t.Fatalf("DeleteArtifacts: %v", err)
	}
	artifactDir := filepath.Join(root, safeHistoryPathPart("proj:one"), safeHistoryPathPart("sess/one"), "artifacts")
	if _, err := os.Stat(artifactDir); !os.IsNotExist(err) {
		t.Fatalf("artifact dir stat err = %v, want not exist", err)
	}
}

func TestFileSessionTurnStoreWritesAndReadsTurnsAcrossChunks(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()

	contents := make([]string, 130)
	for i := range contents {
		contents[i] = fmt.Sprintf(`{"method":"system","param":{"text":"turn-%03d"}}`, i+1)
	}
	latest, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents)
	if err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	if latest != 130 {
		t.Fatalf("latest = %d, want 130", latest)
	}

	turns, err := store.ReadTurns(ctx, "proj1", "sess-1", 127, 130)
	if err != nil {
		t.Fatalf("ReadTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	for i, turn := range turns {
		wantIndex := int64(128 + i)
		if turn.TurnIndex != wantIndex {
			t.Fatalf("turn[%d].TurnIndex = %d, want %d", i, turn.TurnIndex, wantIndex)
		}
		if !turn.Finished {
			t.Fatalf("turn[%d].Finished = false, want true", i)
		}
		wantContent := contents[wantIndex-1]
		if turn.Content != wantContent {
			t.Fatalf("turn[%d].Content = %q, want %q", i, turn.Content, wantContent)
		}
	}
}

func TestFileSessionTurnStoreWritesVersion2FilesWith256Turns(t *testing.T) {
	root := t.TempDir()
	store := newFileSessionTurnStore(root)
	ctx := context.Background()

	contents := make([]string, 257)
	for i := range contents {
		contents[i] = fmt.Sprintf(`{"method":"system","param":{"text":"turn-%03d"}}`, i+1)
	}
	latest, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents)
	if err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	if latest != 257 {
		t.Fatalf("latest = %d, want 257", latest)
	}

	firstFile := filepath.Join(store.turnDir("proj1", "sess-1"), "t000000.bin")
	firstRaw, err := os.ReadFile(firstFile)
	if err != nil {
		t.Fatalf("ReadFile first turn file: %v", err)
	}
	if version := binary.LittleEndian.Uint16(firstRaw[4:6]); version != 2 {
		t.Fatalf("first turn file version = %d, want 2", version)
	}
	if code := firstRaw[6]; code != 0 {
		t.Fatalf("first turn file chunk size code = %d, want 0", code)
	}
	if reserved := firstRaw[7]; reserved != 0 {
		t.Fatalf("first turn file reserved byte = %d, want 0", reserved)
	}
	if occupied := countOccupiedTurnSlots(t, firstRaw, 256); occupied != 256 {
		t.Fatalf("first turn file occupied slots = %d, want 256", occupied)
	}

	secondFile := filepath.Join(store.turnDir("proj1", "sess-1"), "t000001.bin")
	secondRaw, err := os.ReadFile(secondFile)
	if err != nil {
		t.Fatalf("ReadFile second turn file: %v", err)
	}
	if version := binary.LittleEndian.Uint16(secondRaw[4:6]); version != 2 {
		t.Fatalf("second turn file version = %d, want 2", version)
	}
	if code := secondRaw[6]; code != 0 {
		t.Fatalf("second turn file chunk size code = %d, want 0", code)
	}
	if reserved := secondRaw[7]; reserved != 0 {
		t.Fatalf("second turn file reserved byte = %d, want 0", reserved)
	}
	if occupied := countOccupiedTurnSlots(t, secondRaw, 256); occupied != 1 {
		t.Fatalf("second turn file occupied slots = %d, want 1", occupied)
	}

	turns, err := store.ReadTurns(ctx, "proj1", "sess-1", 254, latest)
	if err != nil {
		t.Fatalf("ReadTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	for i, turn := range turns {
		wantIndex := int64(255 + i)
		if turn.TurnIndex != wantIndex {
			t.Fatalf("turn[%d].TurnIndex = %d, want %d", i, turn.TurnIndex, wantIndex)
		}
		if turn.Content != contents[wantIndex-1] {
			t.Fatalf("turn[%d].Content = %q, want %q", i, turn.Content, contents[wantIndex-1])
		}
	}
}

func TestFileSessionTurnStoreReadsOneFileRangeWithoutPerTurnFileAllocations(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()
	contents := make([]string, sessionTurnsPerFile)
	for index := range contents {
		contents[index] = fmt.Sprintf(`{"method":"system","param":{"text":"turn-%03d"}}`, index+1)
	}
	if _, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents); err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}

	var turns []sessionViewTurn
	var readErr error
	allocs := testing.AllocsPerRun(1, func() {
		turns, readErr = store.ReadTurns(ctx, "proj1", "sess-1", 0, sessionTurnsPerFile)
	})
	if readErr != nil {
		t.Fatalf("ReadTurns: %v", readErr)
	}
	if len(turns) != sessionTurnsPerFile {
		t.Fatalf("turns len = %d, want %d", len(turns), sessionTurnsPerFile)
	}
	if allocs > 400 {
		t.Fatalf("ReadTurns allocations = %.0f, want <= 400 for one turn file", allocs)
	}
}

func TestFileSessionTurnStoreRejectsLegacyVersion1Files(t *testing.T) {
	root := t.TempDir()
	store := newFileSessionTurnStore(root)
	ctx := context.Background()

	writeLegacyV1TurnFiles(t, root, "proj1", "sess-1", []string{`{"method":"system","param":{"text":"legacy"}}`})

	if _, err := store.ReadTurns(ctx, "proj1", "sess-1", 0, 1); err == nil {
		t.Fatalf("ReadTurns with legacy v1 file unexpectedly succeeded")
	}
}

func TestFileSessionTurnStoreRejectsSkippedTurnIndex(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()

	if _, err := store.WriteTurns(ctx, "proj1", "sess-1", 2, []string{`{"method":"system"}`}); err == nil {
		t.Fatalf("WriteTurns with skipped first turn unexpectedly succeeded")
	}
}

func TestFileSessionTurnStorePreservesEmptySemanticTurns(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()

	contents := []string{
		`{"method":"prompt_request","param":{"contentBlocks":[]}}`,
		`{"method":"agent_message_chunk","param":{"text":""}}`,
		`{"method":"prompt_done","param":{"stopReason":""}}`,
	}
	latest, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents)
	if err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	if latest != 3 {
		t.Fatalf("latest = %d, want 3", latest)
	}

	turns, err := store.ReadTurns(ctx, "proj1", "sess-1", 0, latest)
	if err != nil {
		t.Fatalf("ReadTurns: %v", err)
	}
	if len(turns) != len(contents) {
		t.Fatalf("turns len = %d, want %d", len(turns), len(contents))
	}
	for i, turn := range turns {
		wantIndex := int64(i + 1)
		if turn.TurnIndex != wantIndex {
			t.Fatalf("turns[%d].TurnIndex = %d, want %d", i, turn.TurnIndex, wantIndex)
		}
		if turn.Content != contents[i] {
			t.Fatalf("turns[%d].Content = %q, want %q", i, turn.Content, contents[i])
		}
	}
}

func TestFileSessionTurnStoreProjectsMissingDurableSlotAsGapTurn(t *testing.T) {
	root := t.TempDir()
	store := newFileSessionTurnStore(root)
	ctx := context.Background()

	contents := []string{
		`{"method":"prompt_request","param":{"contentBlocks":[]}}`,
		`{"method":"agent_message_chunk","param":{"text":"lost"}}`,
		`{"method":"prompt_done","param":{"stopReason":"end_turn"}}`,
	}
	if _, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents); err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}
	path, _, slot := store.turnPath("proj1", "sess-1", 2)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile turn file: %v", err)
	}
	slotOffset := sessionTurnFilePreambleSize + slot*sessionTurnFileMetaSize
	binary.LittleEndian.PutUint32(raw[slotOffset:slotOffset+4], 0)
	binary.LittleEndian.PutUint32(raw[slotOffset+4:slotOffset+8], 0)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("WriteFile corrupted turn file: %v", err)
	}

	turns, err := store.ReadTurns(ctx, "proj1", "sess-1", 0, 3)
	if err != nil {
		t.Fatalf("ReadTurns: %v", err)
	}
	if len(turns) != 3 {
		t.Fatalf("turns len = %d, want 3", len(turns))
	}
	if turns[1].TurnIndex != 2 || !turns[1].Finished {
		t.Fatalf("gap turn metadata = %+v, want turnIndex=2 finished=true", turns[1])
	}
	var msg struct {
		Method string         `json:"method"`
		Param  map[string]any `json:"param"`
	}
	if err := json.Unmarshal([]byte(turns[1].Content), &msg); err != nil {
		t.Fatalf("unmarshal gap turn: %v", err)
	}
	if msg.Method != "session/gap" {
		t.Fatalf("gap method = %q, want session/gap", msg.Method)
	}
	if got := msg.Param["turnIndex"]; got != float64(2) {
		t.Fatalf("gap param turnIndex = %v, want 2", got)
	}
}

func TestFileSessionTurnStoreRejectsMissingTurnContent(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()

	if _, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, []string{""}); err == nil {
		t.Fatalf("WriteTurns with empty content unexpectedly succeeded")
	}
}

func TestFileSessionTurnStoreSearchScansNewestFirstAndStopsOnMatch(t *testing.T) {
	store := newFileSessionTurnStore(t.TempDir())
	ctx := context.Background()

	contents := make([]string, 260)
	for i := range contents {
		contents[i] = fmt.Sprintf(`{"method":"prompt_request","param":{"contentBlocks":[{"type":"text","text":"turn-%03d"}]}}`, i+1)
	}
	contents[129] = `{"method":"prompt_request","param":{"contentBlocks":[{"type":"text","text":"older target"}]}}`
	contents[258] = `{"method":"prompt_request","param":{"contentBlocks":[{"type":"text","text":"newest target"}]}}`
	latest, err := store.WriteTurns(ctx, "proj1", "sess-1", 1, contents)
	if err != nil {
		t.Fatalf("WriteTurns: %v", err)
	}

	visited := []int64{}
	var matchedTurn int64
	err = store.scanTurnsNewestFirst(ctx, "proj1", "sess-1", latest, func(turn sessionViewTurn) (bool, error) {
		visited = append(visited, turn.TurnIndex)
		if strings.Contains(turn.Content, "target") {
			matchedTurn = turn.TurnIndex
			return true, nil
		}
		return false, nil
	})
	if err != nil {
		t.Fatalf("scanTurnsNewestFirst: %v", err)
	}
	if matchedTurn != 259 {
		t.Fatalf("matchedTurn = %d, want 259", matchedTurn)
	}
	if len(visited) == 0 || visited[0] != 260 {
		t.Fatalf("visited = %v, want newest turn first", visited)
	}
	for _, turnIndex := range visited {
		if turnIndex < 259 {
			t.Fatalf("visited older turn %d after matching turn 259; visited=%v", turnIndex, visited)
		}
	}
}

func countOccupiedTurnSlots(t *testing.T, raw []byte, capacity int) int {
	t.Helper()
	for slot := 0; slot < capacity; slot++ {
		pos := 8 + slot*8
		if len(raw) < pos+8 {
			t.Fatalf("turn file too short for slot %d", slot)
		}
		offset := binary.LittleEndian.Uint32(raw[pos : pos+4])
		length := binary.LittleEndian.Uint32(raw[pos+4 : pos+8])
		if offset == 0 || length == 0 {
			return slot
		}
	}
	return capacity
}

func writeLegacyV1TurnFiles(t *testing.T, root, projectName, sessionID string, contents []string) {
	t.Helper()
	const legacyTurnsPerFile = 128
	const legacyHeaderSize = 8 + legacyTurnsPerFile*8

	type legacyEntry struct {
		slot    int
		content []byte
	}
	groups := map[int64][]legacyEntry{}
	for i, content := range contents {
		turnIndex := int64(i + 1)
		fileNo := (turnIndex - 1) / legacyTurnsPerFile
		slot := int((turnIndex - 1) % legacyTurnsPerFile)
		groups[fileNo] = append(groups[fileNo], legacyEntry{slot: slot, content: []byte(content)})
	}

	dir := filepath.Join(root, safeHistoryPathPart(projectName), safeHistoryPathPart(sessionID), "turns")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll legacy turn dir: %v", err)
	}
	for fileNo, entries := range groups {
		raw := make([]byte, legacyHeaderSize)
		copy(raw[0:4], sessionTurnFileMagic)
		binary.LittleEndian.PutUint16(raw[4:6], 1)
		for _, entry := range entries {
			offset := len(raw)
			raw = append(raw, entry.content...)
			slotPos := 8 + entry.slot*8
			binary.LittleEndian.PutUint32(raw[slotPos:slotPos+4], uint32(offset))
			binary.LittleEndian.PutUint32(raw[slotPos+4:slotPos+8], uint32(len(entry.content)))
		}
		path := filepath.Join(dir, fmt.Sprintf("t%06d.bin", fileNo))
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatalf("WriteFile legacy turn file: %v", err)
		}
	}
}

func TestSessionStatusActionAlwaysSupported(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	c := New(store, "proj1", t.TempDir())
	t.Cleanup(func() { _ = c.Close() })

	known := acp.SessionActionsFromAgentCapabilities(wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{Compact: true}))
	if !known.Status.Supported {
		t.Fatal("negotiated Agent status should be supported")
	}
	if !known.Compact.Supported {
		t.Fatal("negotiated Agent compact support was lost")
	}

	unknown := acp.SessionActionsFromAgentCapabilities(acp.AgentCapabilities{})
	if !unknown.Status.Supported {
		t.Fatal("unnegotiated Agent status should be supported")
	}
	if unknown.Compact.Supported {
		t.Fatal("unnegotiated Agent compact should stay unsupported")
	}

	sess := &Session{agentType: "unknown-agent"}
	if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
		t.Fatal("unknown provider dispatch should allow status")
	}
	if c.sessionSupportsAction(sess, acp.SessionActionCompact) {
		t.Fatal("unknown provider dispatch should reject compact")
	}

	c.registry = nil
	if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
		t.Fatal("nil registry dispatch should still allow status")
	}
	if c.sessionSupportsAction(sess, acp.SessionActionCompact) {
		t.Fatal("nil registry dispatch should reject compact")
	}
}

func TestSessionAgentStateRoundTripPreservesInitializeMeta(t *testing.T) {
	raw := []byte(`{"initializeMeta":{"steering":{"supported":true}}}`)
	var state SessionAgentState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"initializeMeta"`)) {
		t.Fatalf("encoded agent state=%s, missing initializeMeta", encoded)
	}
}

func TestHandleSessionForkWithoutTurnIndexUsesCurrentSessionFork(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sourceID := "sess-current-fork-source"
	targetID := "sess-current-fork-target"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Current source", string(acp.ACPProviderClaude))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithProviderForkPointForTest(t, c, sourceID, "first", string(acp.ACPProviderClaude), "source-turn-1")
	c.InjectForwarder(string(acp.ACPProviderClaude), sourceID, nil, nil)
	sess := c.sessions[sourceID]
	runtime := sess.instance.(*testInjectedInstance)
	runtime.initializeFn = func() {
		recordPromptWithProviderForkPointForTest(t, c, sourceID, "second", string(acp.ACPProviderClaude), "source-turn-2")
	}
	runtime.initResult = acp.InitializeResult{
		ProtocolVersion: "1",
		AgentCapabilities: acp.AgentCapabilities{
			LoadSession:         true,
			SessionCapabilities: &acp.SessionCapabilities{Fork: &acp.SessionForkCapability{}},
		},
	}
	runtime.forkCurrentFn = func(_ context.Context, gotSessionID string, cwd string) (acp.SessionForkResult, error) {
		if gotSessionID != sourceID || cwd == "" {
			t.Fatalf("current fork input session=%q cwd=%q", gotSessionID, cwd)
		}
		return acp.SessionForkResult{SessionID: targetID, Title: "Current child"}, nil
	}
	probe := &testInjectedInstance{
		name:      string(acp.ACPProviderClaude),
		sessionID: targetID,
		alive:     true,
		initResult: acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{
			LoadSession: true,
		}},
		loadResult: acp.SessionLoadResult{ConfigOptions: []acp.ConfigOption{{ID: "model", CurrentValue: "validated-model"}}},
	}
	c.InjectAgentFactory(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		return probe, nil
	})

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-current-fork-source"}`))
	if err != nil {
		t.Fatalf("session.fork current: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true {
		t.Fatalf("response=%#v", body)
	}
	var summary sessionViewSummary
	raw, err := json.Marshal(body["session"])
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &summary); err != nil {
		t.Fatal(err)
	}
	sourceSummary, err := c.sessionRecorder.ReadSessionSummary(ctx, sourceID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.SessionID != targetID || summary.ForkedFrom == nil || summary.ForkedFrom.SessionID != sourceID || summary.ForkedFrom.TurnIndex != sourceSummary.LastDoneTurnIndex {
		t.Fatalf("summary=%#v", summary)
	}
	if probe.loadCalls != 1 {
		t.Fatalf("target validation load calls=%d, want 1", probe.loadCalls)
	}
	if len(summary.ConfigOptions) != 1 || summary.ConfigOptions[0].CurrentValue != "validated-model" {
		t.Fatalf("validated config options=%#v", summary.ConfigOptions)
	}
	target := c.sessions[targetID]
	if target == nil {
		t.Fatal("fork target runtime session is missing")
	}
	target.mu.Lock()
	targetInstance := target.instance
	targetInitialized := target.initialized
	targetReady := target.ready
	target.mu.Unlock()
	if targetInstance != probe || probe.callbacks != target || !targetInitialized || !targetReady {
		t.Fatalf("target runtime instance=%T retained=%t callbacks=%T initialized=%t ready=%t", targetInstance, targetInstance == probe, probe.callbacks, targetInitialized, targetReady)
	}
}

func TestHandleSessionForkWithoutTurnIndexRestoresColdSourceBeforeCapabilityCheck(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sourceID := "sess-cold-current-fork-source"
	targetID := "sess-cold-current-fork-target"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Cold source", string(acp.ACPProviderClaude))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	recordPromptWithProviderForkPointForTest(t, c, sourceID, "first", string(acp.ACPProviderClaude), "source-turn-1")
	source, err := c.newWiredSession(sourceID, string(acp.ACPProviderClaude))
	if err != nil {
		t.Fatalf("newWiredSession: %v", err)
	}
	if err := source.persistSession(ctx); err != nil {
		t.Fatalf("persist cold source: %v", err)
	}

	sourceRuntime := &testInjectedInstance{
		name: string(acp.ACPProviderClaude), sessionID: sourceID, alive: true,
		initResult: acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{
			LoadSession: true, SessionCapabilities: &acp.SessionCapabilities{Fork: &acp.SessionForkCapability{}},
		}},
	}
	sourceRuntime.forkCurrentFn = func(_ context.Context, gotSessionID string, cwd string) (acp.SessionForkResult, error) {
		if gotSessionID != sourceID || cwd == "" {
			t.Fatalf("current fork input session=%q cwd=%q", gotSessionID, cwd)
		}
		return acp.SessionForkResult{SessionID: targetID}, nil
	}
	targetProbe := &testInjectedInstance{
		name: string(acp.ACPProviderClaude), sessionID: targetID, alive: true,
		initResult: acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{
			LoadSession: true,
		}},
	}
	factoryCalls := 0
	c.InjectAgentFactory(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) {
		factoryCalls++
		switch factoryCalls {
		case 1:
			return sourceRuntime, nil
		case 2:
			return targetProbe, nil
		default:
			t.Fatalf("unexpected agent factory call %d", factoryCalls)
			return nil, errors.New("unexpected agent factory call")
		}
	})

	resp, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-cold-current-fork-source"}`))
	if err != nil {
		t.Fatalf("session.fork cold current: %v", err)
	}
	body := responseMapForTest(t, resp)
	if body["ok"] != true || factoryCalls != 2 || sourceRuntime.initCalls != 1 || sourceRuntime.loadCalls != 1 {
		t.Fatalf("response=%#v factoryCalls=%d source init/load=%d/%d", body, factoryCalls, sourceRuntime.initCalls, sourceRuntime.loadCalls)
	}
}

func TestCurrentSessionForkRejectsUnresumableTargetWithoutPublishingChild(t *testing.T) {
	c := newSessionViewTestClient(t)
	c.SetSessionHistoryRoot(t.TempDir())
	ctx := context.Background()
	sourceID := "sess-current-fork-load-failure-source"
	targetID := "sess-current-fork-load-failure-target"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Current source", string(acp.ACPProviderClaude))); err != nil {
		t.Fatal(err)
	}
	recordPromptWithProviderForkPointForTest(t, c, sourceID, "first", string(acp.ACPProviderClaude), "source-turn-1")
	c.InjectForwarder(string(acp.ACPProviderClaude), sourceID, nil, nil)
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	runtime.initResult = acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{
		LoadSession: true, SessionCapabilities: &acp.SessionCapabilities{Fork: &acp.SessionForkCapability{}},
		Meta: acp.BuildWMAgentCapabilitiesMeta(nil, acp.WMAgentExtensionCapabilities{
			SessionActions: acp.WMSessionActionCapabilities{CurrentSession: true},
		}),
	}}
	runtime.forkCurrentFn = func(context.Context, string, string) (acp.SessionForkResult, error) {
		return acp.SessionForkResult{SessionID: targetID}, nil
	}
	probe := &testInjectedInstance{
		name: string(acp.ACPProviderClaude), sessionID: targetID, alive: true,
		initResult: acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{LoadSession: true}},
		loadErr:    errors.New("target cannot be loaded"),
	}
	c.InjectAgentFactory(acp.ACPProviderClaude, func(context.Context, string) (agent.Instance, error) { return probe, nil })

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-current-fork-load-failure-source"}`))
	if err == nil || !strings.Contains(err.Error(), "target cannot be loaded") {
		t.Fatalf("current fork error=%v, want target load failure", err)
	}
	if probe.loadCalls != 1 {
		t.Fatalf("target validation load calls=%d, want 1", probe.loadCalls)
	}
	if c.HasSessionInMemoryForTest(targetID) {
		t.Fatal("unresumable target was published in memory")
	}
	stored, loadErr := c.store.LoadSession(ctx, "proj1", targetID)
	if loadErr != nil || stored != nil {
		t.Fatalf("unresumable target persisted: record=%#v err=%v", stored, loadErr)
	}
	if len(runtime.archiveCalls) != 1 || runtime.archiveCalls[0] != targetID {
		t.Fatalf("provider cleanup calls=%#v, want target", runtime.archiveCalls)
	}
}

func TestCurrentSessionForkRejectsEmptySourceBeforeProviderMutation(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	sourceID := "sess-current-fork-empty-source"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Empty source", string(acp.ACPProviderClaude))); err != nil {
		t.Fatal(err)
	}
	c.InjectForwarder(string(acp.ACPProviderClaude), sourceID, nil, nil)
	runtime := c.sessions[sourceID].instance.(*testInjectedInstance)
	runtime.initResult = acp.InitializeResult{ProtocolVersion: "1", AgentCapabilities: acp.AgentCapabilities{
		LoadSession: true, SessionCapabilities: &acp.SessionCapabilities{Fork: &acp.SessionForkCapability{}},
		Meta: acp.BuildWMAgentCapabilitiesMeta(nil, acp.WMAgentExtensionCapabilities{
			SessionActions: acp.WMSessionActionCapabilities{CurrentSession: true},
		}),
	}}
	forkCalls := 0
	runtime.forkCurrentFn = func(context.Context, string, string) (acp.SessionForkResult, error) {
		forkCalls++
		return acp.SessionForkResult{SessionID: "must-not-exist"}, nil
	}

	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-current-fork-empty-source"}`))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "completed turn") {
		t.Fatalf("empty current fork error=%v, want completed turn validation", err)
	}
	if forkCalls != 0 {
		t.Fatalf("provider fork calls=%d, want 0", forkCalls)
	}
}

func TestHandleSessionForkRejectsExplicitNonPositiveTurnIndex(t *testing.T) {
	c := newSessionViewTestClient(t)
	ctx := context.Background()
	sourceID := "sess-explicit-zero-fork"
	if err := c.RecordEvent(ctx, sessionViewCreatedEventWithAgent(sourceID, "Source", string(acp.ACPProviderClaude))); err != nil {
		t.Fatalf("RecordEvent session created: %v", err)
	}
	_, err := c.HandleSessionRequest(ctx, acp.RegistryMethodSessionFork, "proj1", json.RawMessage(`{"sessionId":"sess-explicit-zero-fork","turnIndex":0}`))
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "positive") {
		t.Fatalf("session.fork error=%v, want positive turnIndex validation", err)
	}
}
