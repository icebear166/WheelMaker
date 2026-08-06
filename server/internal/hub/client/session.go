package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

// SessionStatus defines the lifecycle state of a Session.
type SessionStatus int

const (
	// SessionActive means the session is accepting messages.
	SessionActive SessionStatus = iota
	// SessionSuspended means the session is idle but still in memory.
	SessionSuspended
	// SessionPersisted means the session has been saved to disk and released from memory.
	SessionPersisted
)

// SessionAgentState holds all persisted per-agent metadata within one Session.
type SessionAgentState struct {
	ConfigOptions     []acp.ConfigOption     `json:"configOptions,omitempty"`
	Commands          []acp.AvailableCommand `json:"commands,omitempty"`
	Title             string                 `json:"title,omitempty"`
	CreateRequestID   string                 `json:"createRequestId,omitempty"`
	UpdatedAt         string                 `json:"updatedAt,omitempty"`
	Usage             *acp.SessionUsage      `json:"usage,omitempty"`
	AgentCapabilities acp.AgentCapabilities  `json:"agentCapabilities,omitempty"`
	AgentInfo         *acp.AgentInfo         `json:"agentInfo,omitempty"`
	AuthMethods       []acp.AuthMethod       `json:"authMethods,omitempty"`
	Goal              *acp.SessionGoal       `json:"goal,omitempty"`
}

type createdSessionState struct {
	sessionID string
	agentType string
	state     SessionAgentState
	instance  agent.Instance
	createdAt time.Time
}

// Session is the business session object that owns ACP session state,
// prompt lifecycle and callback handling.
// A Client holds multiple Sessions.
type Session struct {
	Status SessionStatus

	// instance is the agent runtime bound to this Session.
	// Created lazily by ensureInstance(). Nil means no agent connected yet.
	instance   agent.Instance
	agentType  string
	agentState SessionAgentState

	// Runtime ACP session state (moved from Client.session / Client.sessionMeta / Client.initMeta).
	acpSessionID string
	initialized  bool
	ready        bool
	initializing bool
	loading      bool
	closing      bool

	prompt   promptState
	initCond *sync.Cond

	// Back-references to Client-owned resources needed by Session methods.
	projectName string
	cwd         string
	registry    *agent.ACPFactory
	store       Store
	viewSink    SessionViewSink

	createdAt    time.Time
	lastActiveAt time.Time

	mu              sync.Mutex
	promptMu        sync.Mutex
	steerMu         sync.Mutex
	queueOpMu       sync.Mutex
	queueMu         sync.Mutex
	queueDrainWG    sync.WaitGroup
	queueClosing    bool
	executionKind   string
	executionLocked bool
	steerState      sessionSteerState
	queue           sessionQueueState
	goal            sessionGoalState
	permissions     sessionPermissionState
}

// newSession creates a Session with sensible defaults.
// id, cwd, and agentType are all required and immutable after creation.
func newSession(id, cwd, agentType string) (*Session, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("session id is required")
	}
	agentType = normalizeAgentType(agentType)
	if agentType == "" {
		return nil, fmt.Errorf("agent type is required")
	}
	s := &Session{
		acpSessionID: id,
		agentType:    agentType,
		Status:       SessionActive,
		cwd:          cwd,
		createdAt:    time.Now(),
		prompt:       promptState{},
		queue:        newSessionQueueState(),
	}
	s.initCond = sync.NewCond(&s.mu)
	return s, nil
}

func cloneAgentInfo(src *acp.AgentInfo) *acp.AgentInfo {
	if src == nil {
		return nil
	}
	cp := *src
	return &cp
}

func cloneSessionAgentState(src *SessionAgentState) *SessionAgentState {
	if src == nil {
		return nil
	}
	cp := *src
	cp.ConfigOptions = append([]acp.ConfigOption(nil), src.ConfigOptions...)
	cp.Commands = append([]acp.AvailableCommand(nil), src.Commands...)
	cp.AuthMethods = append([]acp.AuthMethod(nil), src.AuthMethods...)
	cp.AgentInfo = cloneAgentInfo(src.AgentInfo)
	if src.Usage != nil {
		usage := *src.Usage
		cp.Usage = &usage
	}
	if src.Goal != nil {
		goal := *src.Goal
		if src.Goal.TokenBudget != nil {
			budget := *src.Goal.TokenBudget
			goal.TokenBudget = &budget
		}
		cp.Goal = &goal
	}
	return &cp
}

// shortSessionID returns a compact display form of a session ID.
// e.g. "sess-12345678-1234-1234-1234-123456789012" -> "sess-12345678"
func shortSessionID(id string) string {
	const prefix = "sess-"
	if strings.HasPrefix(id, prefix) {
		rest := id[len(prefix):]
		if idx := strings.Index(rest, "-"); idx > 0 {
			return prefix + rest[:idx]
		}
	}
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// sessionInfoLine returns a multi-line summary of the current session state.
func (s *Session) sessionInfoLine() string {
	s.mu.Lock()
	agentType := s.agentType
	clientSID := s.acpSessionID
	configOpts := append([]acp.ConfigOption(nil), s.agentState.ConfigOptions...)
	s.mu.Unlock()

	sid := shortSessionID(clientSID)
	if sid == "" {
		sid = "none"
	}
	mode := configValueByID(configOpts, acp.ConfigOptionIDMode)
	model := configValueByID(configOpts, acp.ConfigOptionIDModel)
	return fmt.Sprintf("session: %s\nagent: %s\nmode: %s\nmodel: %s",
		sid,
		renderUnknown(agentType),
		renderUnknown(mode),
		renderUnknown(model),
	)
}

func configValueByID(options []acp.ConfigOption, targetID string) string {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return ""
	}
	for _, opt := range options {
		if strings.EqualFold(strings.TrimSpace(opt.ID), targetID) {
			return strings.TrimSpace(opt.CurrentValue)
		}
	}
	return ""
}

func (s *Session) CurrentConfigOptions() []acp.ConfigOption {
	s.mu.Lock()
	defer s.mu.Unlock()
	return normalizeAgentConfigOptions(s.agentType, s.agentState.ConfigOptions)
}

func (s *Session) SetConfigOption(ctx context.Context, configID, value string) ([]acp.ConfigOption, error) {
	configID = strings.TrimSpace(configID)
	value = strings.TrimSpace(value)
	if configID == "" {
		return nil, fmt.Errorf("config id is required")
	}
	if value == "" {
		return nil, fmt.Errorf("config value is required")
	}

	s.promptMu.Lock()
	defer func() {
		s.promptMu.Unlock()
		s.scheduleQueueDrain()
	}()

	if err := s.ensureInstance(ctx); err != nil {
		return nil, err
	}
	if err := s.ensureReady(ctx); err != nil {
		return nil, err
	}

	s.mu.Lock()
	sessionID := s.acpSessionID
	agentType := s.agentType
	current := append([]acp.ConfigOption(nil), s.agentState.ConfigOptions...)
	s.mu.Unlock()

	configID = resolveConfigOptionID(current, configID)
	if claudeCompatibleEffortValues(agentType) != nil && isThoughtConfigOption(configID, "") {
		value = normalizeClaudeCompatibleEffortValue(agentType, value)
	}
	updated, err := s.instance.SessionSetConfigOption(ctx, acp.SessionSetConfigOptionParams{
		SessionID: sessionID,
		ConfigID:  configID,
		Value:     value,
	})
	if err != nil {
		return nil, err
	}

	next := current
	if len(updated) > 0 {
		next = append([]acp.ConfigOption(nil), updated...)
	} else {
		next = mergeConfigOptions(current, []acp.ConfigOption{{
			ID:           configID,
			CurrentValue: value,
		}})
	}
	next = normalizeAgentConfigOptions(agentType, next)

	s.mu.Lock()
	s.agentState.ConfigOptions = append([]acp.ConfigOption(nil), next...)
	s.mu.Unlock()

	s.persistAgentPreferenceState(agentType, next)
	s.persistSessionBestEffort()
	return append([]acp.ConfigOption(nil), next...), nil
}

// reply records a system response for the session view.
func (s *Session) reply(text string) {
	s.replyWithTitle("", text)
}

// replyWithTitle sends a system message with an optional card title.
func (s *Session) replyWithTitle(title, body string) {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	var messageText string
	switch {
	case title != "" && body != "":
		messageText = title + "\n" + body
	case title != "":
		messageText = title
	default:
		messageText = body
	}
	delivered := false
	if messageText != "" {
		delivered = s.recordSessionViewEvent(SessionViewEvent{
			Type:    SessionViewEventTypeSystem,
			Content: messageText,
		})
	}
	if delivered {
		return
	}
	if title != "" {
		fmt.Println(title)
	}
	fmt.Println(body)
}

func (s *Session) recordSessionViewEvent(event SessionViewEvent) bool {
	if strings.TrimSpace(event.SessionID) == "" {
		event.SessionID = s.acpSessionID
	}
	if event.UpdatedAt.IsZero() {
		event.UpdatedAt = time.Now().UTC()
	}
	s.mu.Lock()
	s.lastActiveAt = maxTime(s.lastActiveAt, event.UpdatedAt)
	s.mu.Unlock()
	if s.viewSink != nil {
		if err := s.viewSink.RecordEvent(context.Background(), event); err != nil {
			hubLogger(s.projectName).Warn("record session view event failed session=%s type=%s err=%v", event.SessionID, event.Type, err)
		}
		return true
	}
	return false
}

// ensureInstance connects the active agent via AgentFactory and sets up the
// runtime instance if not already running. Connect is executed outside s.mu.
func (s *Session) ensureInstance(ctx context.Context) error {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return errors.New("session is closing")
	}
	if s.instance != nil {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	creator := s.registry.CreatorByName(s.agentType)
	if creator == nil {
		return fmt.Errorf("no agent registered for %q", s.agentType)
	}
	inst, err := creator(agent.WithProjectName(ctx, s.projectName), s.cwd)
	if err != nil {
		return err
	}
	inst.SetCallbacks(s)

	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		_ = inst.Close()
		return errors.New("session is closing")
	}
	if s.instance != nil {
		s.mu.Unlock()
		_ = inst.Close()
		return nil
	}
	s.instance = inst
	s.initialized = false
	s.ready = false
	s.mu.Unlock()
	return nil
}

// emptyMCPServers returns an empty MCP server list for session/new and session/load calls.
// Replace this helper when MCP config support is added.
func emptyMCPServers() []acp.MCPServer {
	return []acp.MCPServer{}
}

func (s *Session) ensureInitialized(ctx context.Context) (acp.InitializeResult, error) {
	s.mu.Lock()
	for s.initializing {
		s.initCond.Wait()
	}
	if s.initialized {
		result := acp.InitializeResult{
			ProtocolVersion:   json.Number("1"),
			AgentCapabilities: s.agentState.AgentCapabilities,
			AgentInfo:         cloneAgentInfo(s.agentState.AgentInfo),
			AuthMethods:       append([]acp.AuthMethod(nil), s.agentState.AuthMethods...),
		}
		s.mu.Unlock()
		return result, nil
	}
	s.initializing = true
	inst := s.instance
	if inst == nil {
		s.initializing = false
		s.mu.Unlock()
		s.initCond.Broadcast()
		return acp.InitializeResult{}, errors.New("ensureInitialized: instance is nil")
	}
	s.mu.Unlock()

	finish := func() {
		s.mu.Lock()
		s.initializing = false
		s.mu.Unlock()
		s.initCond.Broadcast()
	}

	clientCaps := acp.ClientCapabilities{
		FS: &acp.FSCapabilities{
			ReadTextFile:  true,
			WriteTextFile: true,
		},
		Terminal: true,
		Meta:     acp.BuildWMClientCapabilitiesMeta(nil),
	}
	initResult, err := inst.Initialize(ctx, acp.InitializeParams{
		ProtocolVersion:    acpClientProtocolVersion,
		ClientCapabilities: clientCaps,
		ClientInfo:         acpClientInfo,
	})
	if err != nil {
		finish()
		return acp.InitializeResult{}, fmt.Errorf("ensureInitialized: initialize: %w", err)
	}

	s.mu.Lock()
	s.agentState.AgentCapabilities = initResult.AgentCapabilities
	s.agentState.AgentInfo = cloneAgentInfo(initResult.AgentInfo)
	s.agentState.AuthMethods = append([]acp.AuthMethod(nil), initResult.AuthMethods...)
	s.initialized = true
	s.initializing = false
	s.mu.Unlock()
	s.initCond.Broadcast()
	return initResult, nil
}

// ensureReady performs ACP initialize + session/load for an existing ACP session ID.
func (s *Session) ensureReady(ctx context.Context) error {
	s.mu.Lock()
	if s.ready {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	initResult, err := s.ensureInitialized(ctx)
	if err != nil {
		return err
	}

	s.mu.Lock()
	for s.loading {
		s.initCond.Wait()
	}
	if s.ready {
		s.mu.Unlock()
		return nil
	}
	s.loading = true
	inst := s.instance
	agentName := s.agentType
	savedSID := s.acpSessionID
	cwd := s.cwd
	persistedConfigOptions := normalizeAgentConfigOptions(agentName, s.agentState.ConfigOptions)
	persistedCommands := append([]acp.AvailableCommand(nil), s.agentState.Commands...)
	s.mu.Unlock()

	finishLoad := func() {
		s.mu.Lock()
		s.loading = false
		s.mu.Unlock()
		s.initCond.Broadcast()
	}

	if savedSID == "" {
		finishLoad()
		return errors.New("ensureReady: session id is required")
	}
	if !initResult.AgentCapabilities.LoadSession {
		finishLoad()
		return fmt.Errorf("ensureReady: agent %q does not support session/load", agentName)
	}

	loadResult, loadErr := inst.SessionLoad(ctx, acp.SessionLoadParams{
		SessionID:  savedSID,
		CWD:        cwd,
		MCPServers: emptyMCPServers(),
	})
	if loadErr != nil {
		finishLoad()
		return fmt.Errorf("ensureReady: session/load: %w", loadErr)
	}

	resolved := normalizeAgentConfigOptions(agentName, loadResult.ConfigOptions)
	persistedConfigOptions = filterACPConfigOptionsForAgent(agentName, initResult.AgentInfo, persistedConfigOptions)
	targetConfig := configPreferenceFromACPOptions(persistedConfigOptions)
	targetConfig = filterStoredConfigOptionsForAgent(agentName, initResult.AgentInfo, targetConfig)
	if len(resolved) > 0 {
		if len(targetConfig) > 0 {
			resolved = applyStoredConfigOptions(ctx, s.projectName, inst, savedSID, resolved, targetConfig)
		}
	} else if len(persistedConfigOptions) > 0 {
		resolved = append([]acp.ConfigOption(nil), persistedConfigOptions...)
	}
	resolved = normalizeAgentConfigOptions(agentName, resolved)
	resolvedCommands := append([]acp.AvailableCommand(nil), persistedCommands...)

	s.mu.Lock()
	state := &s.agentState
	if len(resolved) > 0 {
		state.ConfigOptions = append([]acp.ConfigOption(nil), resolved...)
	}
	state.Commands = append([]acp.AvailableCommand(nil), resolvedCommands...)
	state.AgentCapabilities = initResult.AgentCapabilities
	state.AgentInfo = cloneAgentInfo(initResult.AgentInfo)
	state.AuthMethods = initResult.AuthMethods
	s.ready = true
	s.loading = false
	s.mu.Unlock()
	s.initCond.Broadcast()

	s.persistAgentPreferenceState(agentName, resolved)
	hubLogger(s.projectName).Info("connected agent=%s session=%s resumed", inst.Name(), savedSID)
	return nil
}

func (s *Session) SessionStatus(_ context.Context) (acp.SessionActionStatusResult, error) {
	s.mu.Lock()
	sessionID := s.acpSessionID
	agentType := s.agentType
	var usage *acp.SessionUsage
	if s.agentState.Usage != nil {
		value := *s.agentState.Usage
		usage = &value
	}
	s.mu.Unlock()

	result := acp.SessionActionStatusResult{
		OK:        true,
		SessionID: sessionID,
		AgentType: agentType,
		Limits:    []acp.SessionActionRateLimit{},
	}
	if usage == nil {
		return result, nil
	}
	result.Context = &acp.SessionActionStatusContext{
		Used:      usage.Used,
		UpdatedAt: usage.UpdatedAt,
	}
	if usage.Size > 0 {
		size := usage.Size
		result.Context.Size = &size
	}
	return result, nil
}

func (s *Session) ResolveForkPoints(ctx context.Context, prompts []acp.SessionForkPrompt) (map[int64]acp.SessionForkPoint, error) {
	if !s.promptMu.TryLock() {
		return nil, agent.ErrSessionBusy
	}
	defer s.promptMu.Unlock()
	if err := s.ensureInstance(ctx); err != nil {
		return nil, err
	}
	if _, err := s.ensureInitialized(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	inst := s.instance
	sessionID := s.acpSessionID
	s.mu.Unlock()
	forker, ok := inst.(agent.SessionForker)
	if !ok {
		return nil, agent.ErrSessionActionUnsupported
	}
	return forker.ResolveForkPoints(ctx, sessionID, prompts)
}

func (s *Session) ForkSession(ctx context.Context, lastTurnID string, prompts []acp.SessionForkPrompt) (acp.SessionForkResult, error) {
	if err := s.beginExecution(acp.SessionOperationTypeFork); err != nil {
		return acp.SessionForkResult{}, err
	}
	defer s.endExecution()
	if err := s.ensureInstance(ctx); err != nil {
		return acp.SessionForkResult{}, err
	}
	if _, err := s.ensureInitialized(ctx); err != nil {
		return acp.SessionForkResult{}, err
	}
	s.mu.Lock()
	inst := s.instance
	sessionID := s.acpSessionID
	s.mu.Unlock()
	forker, ok := inst.(agent.SessionForker)
	if !ok {
		return acp.SessionForkResult{}, agent.ErrSessionActionUnsupported
	}
	return forker.ForkSession(ctx, sessionID, lastTurnID, prompts)
}

func (s *Session) ArchiveForkTarget(ctx context.Context, sessionID string) error {
	s.mu.Lock()
	inst := s.instance
	s.mu.Unlock()
	archiver, ok := inst.(agent.SessionArchiver)
	if !ok {
		return agent.ErrSessionArchiveUnsupported
	}
	return archiver.ArchiveSession(ctx, sessionID)
}

func (s *Session) beginExecution(kind string) error {
	if !s.promptMu.TryLock() {
		return agent.ErrSessionBusy
	}
	s.mu.Lock()
	s.executionKind = strings.TrimSpace(kind)
	s.executionLocked = true
	s.mu.Unlock()
	return nil
}

func (s *Session) endExecution() {
	s.mu.Lock()
	if !s.executionLocked {
		s.executionKind = ""
		s.mu.Unlock()
		s.scheduleQueueDrain()
		return
	}
	s.executionKind = ""
	s.executionLocked = false
	s.mu.Unlock()
	s.promptMu.Unlock()
	s.scheduleQueueDrain()
}

func (s *Session) StartCompaction(ctx context.Context, operationID string) error {
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return fmt.Errorf("operationId is required")
	}
	if err := s.beginExecution(acp.SessionOperationTypeCompact); err != nil {
		return err
	}
	go func() {
		outcome := s.runCompactionExecution(ctx, operationID)
		if outcome.err != nil {
			hubLogger(s.projectName).Warn("session compaction failed session=%s operation=%s err=%v", s.acpSessionID, operationID, outcome.err)
		}
		s.endExecution()
	}()
	return nil
}

func (s *Session) runCompactionExecution(ctx context.Context, operationID string) sessionExecutionOutcome {
	if err := s.ensureInstance(ctx); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	if err := s.ensureReadyAndNotify(ctx); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}

	s.mu.Lock()
	inst := s.instance
	sessionID := s.acpSessionID
	s.mu.Unlock()
	compactor, ok := inst.(agent.SessionCompactor)
	if !ok {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: agent.ErrSessionActionUnsupported}
	}
	recorder := s.viewSink
	if recorder == nil {
		err := errors.New("session operation recorder is required")
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	started := acp.SessionOperationPayload{
		OperationID: operationID,
		Type:        acp.SessionOperationTypeCompact,
		Status:      acp.SessionOperationStatusStarted,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	if err := recorder.RecordSessionOperation(ctx, sessionID, started); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	fail := func(err error) sessionExecutionOutcome {
		failed := started
		failed.Status = acp.SessionOperationStatusFailed
		failed.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		failed.Message = err.Error()
		_ = recorder.RecordSessionOperation(context.Background(), sessionID, failed)
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	done, err := compactor.CompactSession(ctx, sessionID)
	if err != nil {
		return fail(err)
	}
	if done == nil {
		return fail(errors.New("session compactor returned no completion channel"))
	}
	result, open := <-done
	if !open {
		return fail(errors.New("session compaction ended without a result"))
	}
	if result.Err != nil {
		return fail(result.Err)
	}
	completed := started
	completed.Status = acp.SessionOperationStatusCompleted
	completed.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	if err := recorder.RecordSessionOperation(context.Background(), sessionID, completed); err != nil {
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	return sessionExecutionOutcome{status: sessionExecutionCompleted}
}
func configPreferenceFromACPOptions(options []acp.ConfigOption) []PreferenceConfigOption {
	out := make([]PreferenceConfigOption, 0, len(options))
	seen := make(map[string]struct{}, len(options))
	for _, opt := range options {
		optID := strings.TrimSpace(opt.ID)
		if optID == "" {
			continue
		}
		key := strings.ToLower(optID)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, PreferenceConfigOption{
			ID:           optID,
			CurrentValue: opt.CurrentValue,
		})
	}
	return out
}

func normalizeStoredConfigPreferences(agentName string, options []PreferenceConfigOption) []PreferenceConfigOption {
	normalized := append([]PreferenceConfigOption(nil), options...)
	if claudeCompatibleEffortValues(agentName) != nil {
		for index := range normalized {
			if isThoughtConfigOption(normalized[index].ID, "") {
				normalized[index].CurrentValue = normalizeClaudeCompatibleEffortValue(agentName, normalized[index].CurrentValue)
			}
		}
		return normalized
	}
	if !strings.EqualFold(strings.TrimSpace(agentName), string(acp.ACPProviderFlicker)) {
		return normalized
	}
	for index := range normalized {
		option := &normalized[index]
		if !strings.EqualFold(strings.TrimSpace(option.ID), "effort") {
			continue
		}
		option.ID = "thought_level"
		if strings.EqualFold(option.CurrentValue, "maxOrXhigh") {
			option.CurrentValue = "xhigh"
		}
	}
	return normalized
}

// Existing native Kimi sessions persist 0.27.0's boolean thinking values.
// Newer Kimi Code ACP versions expose effort levels instead.
const kimiCodeLegacyThinkingVersion = "0.27.0"

func filterStoredConfigOptionsForAgent(agentName string, agentInfo *acp.AgentInfo, options []PreferenceConfigOption) []PreferenceConfigOption {
	normalized := append([]PreferenceConfigOption(nil), options...)
	if !isNewKimiCodeVersion(agentName, agentInfo) {
		return normalized
	}
	filtered := normalized[:0]
	for _, option := range normalized {
		if shouldSkipKimiLegacyThinkingOption(agentName, agentInfo, option.ID, option.CurrentValue) {
			continue
		}
		filtered = append(filtered, option)
	}
	return filtered
}

func filterACPConfigOptionsForAgent(agentName string, agentInfo *acp.AgentInfo, options []acp.ConfigOption) []acp.ConfigOption {
	normalized := append([]acp.ConfigOption(nil), options...)
	if !isNewKimiCodeVersion(agentName, agentInfo) {
		return normalized
	}
	filtered := normalized[:0]
	for _, option := range normalized {
		if shouldSkipKimiLegacyThinkingOption(agentName, agentInfo, option.ID, option.CurrentValue) {
			continue
		}
		filtered = append(filtered, option)
	}
	return filtered
}

func shouldSkipKimiLegacyThinkingOption(agentName string, agentInfo *acp.AgentInfo, optionID, value string) bool {
	return isNewKimiCodeVersion(agentName, agentInfo) &&
		strings.EqualFold(strings.TrimSpace(optionID), "thinking") &&
		(strings.EqualFold(strings.TrimSpace(value), "on") || strings.EqualFold(strings.TrimSpace(value), "off"))
}

func isNewKimiCodeVersion(agentName string, agentInfo *acp.AgentInfo) bool {
	if !strings.EqualFold(strings.TrimSpace(agentName), string(acp.ACPProviderKimi)) || agentInfo == nil {
		return false
	}
	return compareKimiCodeVersions(agentInfo.Version, kimiCodeLegacyThinkingVersion) > 0
}

func compareKimiCodeVersions(left, right string) int {
	leftParts, leftOK := kimiCodeVersionParts(left)
	rightParts, rightOK := kimiCodeVersionParts(right)
	if !leftOK || !rightOK {
		return 0
	}
	for index := range leftParts {
		if leftParts[index] != rightParts[index] {
			if leftParts[index] < rightParts[index] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func kimiCodeVersionParts(value string) ([]int, bool) {
	parts := make([]int, 0, 3)
	for index := 0; index < len(value) && len(parts) < 3; {
		for index < len(value) && (value[index] < '0' || value[index] > '9') {
			index++
		}
		if index == len(value) {
			break
		}
		start := index
		for index < len(value) && value[index] >= '0' && value[index] <= '9' {
			index++
		}
		part, err := strconv.Atoi(value[start:index])
		if err != nil {
			return nil, false
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return nil, false
	}
	for len(parts) < 3 {
		parts = append(parts, 0)
	}
	return parts, true
}

func normalizeAgentConfigOptions(agentName string, options []acp.ConfigOption) []acp.ConfigOption {
	normalized := append([]acp.ConfigOption(nil), options...)
	for index := range normalized {
		// Copy and dedup each option's selectable values by Value. Some agents
		// (e.g. cc-flicker) surface the same model both as a tier default and in
		// the discovered catalog; without this the picker shows it twice. Keep
		// the first occurrence so the tier-provided display name is preserved.
		src := normalized[index].Options
		seen := make(map[string]struct{}, len(src))
		deduped := make([]acp.ConfigOptionValue, 0, len(src))
		for _, value := range src {
			key := strings.TrimSpace(value.Value)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			deduped = append(deduped, value)
		}
		normalized[index].Options = deduped
	}
	actualValues := claudeCompatibleEffortValues(agentName)
	if actualValues == nil {
		return normalized
	}
	allowed := make(map[string]struct{}, len(actualValues))
	for _, value := range actualValues {
		allowed[value] = struct{}{}
	}
	for index := range normalized {
		option := &normalized[index]
		if !isThoughtConfigOption(option.ID, option.Category) {
			continue
		}
		option.CurrentValue = normalizeClaudeCompatibleEffortValue(agentName, option.CurrentValue)
		if len(option.Options) == 0 {
			continue
		}
		actual := make([]acp.ConfigOptionValue, 0, len(actualValues))
		for _, value := range option.Options {
			if _, ok := allowed[strings.ToLower(strings.TrimSpace(value.Value))]; ok {
				actual = append(actual, value)
			}
		}
		option.Options = actual
	}
	return normalized
}

func claudeCompatibleEffortValues(agentName string) []string {
	switch strings.ToLower(strings.TrimSpace(agentName)) {
	case string(acp.ACPProviderCCKimi):
		return []string{"low", "high", "max"}
	case string(acp.ACPProviderCCDeepSeek), string(acp.ACPProviderCCGLM):
		return []string{"high", "max"}
	default:
		return nil
	}
}

func normalizeClaudeCompatibleEffortValue(agentName, value string) string {
	normalizedValue := strings.ToLower(strings.TrimSpace(value))
	switch strings.ToLower(strings.TrimSpace(agentName)) {
	case string(acp.ACPProviderCCKimi):
		switch normalizedValue {
		case "default", "auto", "medium", "high":
			return "high"
		case "xhigh", "max", "ultracode":
			return "max"
		case "low":
			return "low"
		}
	case string(acp.ACPProviderCCDeepSeek), string(acp.ACPProviderCCGLM):
		switch normalizedValue {
		case "default", "auto", "low", "medium", "high":
			return "high"
		case "xhigh", "max", "ultracode":
			return "max"
		}
	}
	return value
}

func mergeConfigOptions(current []acp.ConfigOption, updated []acp.ConfigOption) []acp.ConfigOption {
	if len(updated) == 0 {
		return append([]acp.ConfigOption(nil), current...)
	}
	merged := append([]acp.ConfigOption(nil), current...)
	for _, next := range updated {
		nextID := strings.TrimSpace(next.ID)
		nextCategory := strings.TrimSpace(next.Category)
		replaced := false
		for i, existing := range merged {
			existingID := strings.TrimSpace(existing.ID)
			sameID := nextID != "" && strings.EqualFold(existingID, nextID)
			sameCategory := nextID == "" && nextCategory != "" && strings.EqualFold(strings.TrimSpace(existing.Category), nextCategory)
			if sameID || sameCategory {
				merged[i] = next
				replaced = true
				break
			}
		}
		if !replaced {
			merged = append(merged, next)
		}
	}
	return merged
}

func applyStoredConfigOptions(
	ctx context.Context,
	projectName string,
	inst agent.Instance,
	sessionID string,
	current []acp.ConfigOption,
	target []PreferenceConfigOption,
) []acp.ConfigOption {
	options := append([]acp.ConfigOption(nil), current...)
	for _, next := range target {
		targetID := strings.TrimSpace(next.ID)
		if targetID == "" {
			continue
		}
		configID := ""
		currentValue := ""
		resolvedID := resolveConfigOptionID(options, targetID)
		for _, opt := range options {
			optID := strings.TrimSpace(opt.ID)
			if optID == "" || !strings.EqualFold(optID, resolvedID) {
				continue
			}
			configID = optID
			currentValue = opt.CurrentValue
			break
		}
		if configID == "" {
			hubLogger(projectName).Warn("skip reapply config id=%s: config option not found", targetID)
			continue
		}
		if currentValue == next.CurrentValue {
			continue
		}
		updated, err := inst.SessionSetConfigOption(ctx, acp.SessionSetConfigOptionParams{
			SessionID: sessionID,
			ConfigID:  configID,
			Value:     next.CurrentValue,
		})
		if err != nil {
			hubLogger(projectName).Warn("reapply config failed session=%s id=%s value=%s err=%v",
				sessionID, configID, next.CurrentValue, err)
			continue
		}
		if len(updated) > 0 {
			options = mergeConfigOptions(options, updated)
		}
	}
	return options
}

func resolveConfigOptionID(options []acp.ConfigOption, requestedID string) string {
	requestedID = strings.TrimSpace(requestedID)
	if requestedID == "" {
		return ""
	}
	for _, opt := range options {
		if strings.EqualFold(strings.TrimSpace(opt.ID), requestedID) {
			return strings.TrimSpace(opt.ID)
		}
	}
	for _, opt := range options {
		if strings.EqualFold(strings.TrimSpace(opt.Category), requestedID) && strings.TrimSpace(opt.ID) != "" {
			return strings.TrimSpace(opt.ID)
		}
	}
	return requestedID
}

// ensureReadyAndNotify calls ensureReady and persists the session when
// transitioning from not-ready to ready.
func (s *Session) ensureReadyAndNotify(ctx context.Context) error {
	s.mu.Lock()
	wasReady := s.ready
	s.mu.Unlock()

	if err := s.ensureReady(ctx); err != nil {
		return err
	}

	if !wasReady {
		s.persistSessionBestEffort()
	}
	return nil
}

// promptStream sends a prompt and returns a channel of streaming updates.
func (s *Session) promptStream(ctx context.Context, blocks []acp.ContentBlock) (<-chan promptStreamEvent, error) {
	if err := s.ensureReady(ctx); err != nil {
		return nil, err
	}

	s.mu.Lock()
	sessID := s.acpSessionID
	promptCtx, promptCancel := context.WithCancel(ctx)
	s.prompt.ctx = promptCtx
	s.prompt.cancel = promptCancel
	s.mu.Unlock()

	updates := make(chan promptStreamEvent, 32)
	interceptCh := make(chan acp.SessionUpdateParams, 32)

	s.mu.Lock()
	s.prompt.updatesCh = interceptCh
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			s.prompt.ctx = nil
			s.prompt.cancel = nil
			s.prompt.updatesCh = nil
			s.mu.Unlock()
			promptCancel()
		}()

		type promptResult struct {
			result acp.PromptOutcome
			err    error
		}
		resultCh := make(chan promptResult, 1)
		go func() {
			res, err := s.instance.SessionPrompt(promptCtx, acp.SessionPromptParams{
				SessionID: sessID,
				Prompt:    blocks,
			})
			resultCh <- promptResult{result: res, err: err}
		}()

		drain := func(params acp.SessionUpdateParams) bool {
			copied := params
			select {
			case updates <- promptStreamEvent{update: &copied}:
				return true
			case <-ctx.Done():
				return false
			}
		}

		pr := promptResult{}
		for {
			select {
			case u := <-interceptCh:
				if !drain(u) {
					pr.err = ctx.Err()
					goto done
				}
			case pr = <-resultCh:
				s.mu.Lock()
				if s.prompt.updatesCh == interceptCh {
					s.prompt.updatesCh = nil
				}
				s.mu.Unlock()
				for {
					select {
					case u := <-interceptCh:
						if !drain(u) {
							pr.err = ctx.Err()
							goto done
						}
					default:
						goto drained
					}
				}
			drained:
				goto done
			}
		}

	done:
		result, err := pr.result, pr.err

		if err != nil {
			updates <- promptStreamEvent{err: err}
		} else {
			final := result
			updates <- promptStreamEvent{result: &final}
		}
		close(updates)
	}()

	return updates, nil
}

// cancelPrompt emits tool_call_cancelled updates then sends session/cancel.

func (s *Session) cancelPrompt() error {
	s.cancelAllPendingPermissions()
	s.mu.Lock()
	sessID := s.acpSessionID
	ready := s.ready
	cancel := s.prompt.cancel
	inst := s.instance
	s.mu.Unlock()

	var err error
	if sessID != "" && ready && inst != nil {
		err = inst.SessionCancel(sessID)
	}
	if cancel != nil {
		cancel()
	}
	return err
}

func (s *Session) recordPromptDone(stopReason string, message string) {
	s.cancelAllPendingPermissions()
	s.recordSessionViewEvent(SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: s.acpSessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"result": acp.SessionTurnPromptResult{
				StopReason: strings.TrimSpace(stopReason),
				Message:    strings.TrimSpace(message),
			},
		}),
	})
}

func (s *Session) recordPromptFailed(message string) {
	s.recordPromptDone(acp.SessionTurnStopReasonFailed, message)
}

func (s *Session) toRecord() (*SessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.agentType == "" {
		return nil, fmt.Errorf("session agent type is required")
	}

	state := cloneSessionAgentState(&s.agentState)

	agentJSON := "{}"
	if state != nil {
		raw, err := json.Marshal(state)
		if err != nil {
			return nil, fmt.Errorf("marshal agent_json: %w", err)
		}
		agentJSON = string(raw)
	}

	return &SessionRecord{
		ID:          s.acpSessionID,
		ProjectName: s.projectName,
		Status:      s.Status,
		AgentType:   s.agentType,
		AgentJSON:   agentJSON,
		// Session title is owned by SessionRecorder projection (latest prompt title).
		// Keep snapshot writes title-neutral so runtime state does not overwrite recorder title.
		Title: "",
		// LastActiveAt is owned by the SessionRecorder projection (last prompt
		// start/done). Runtime snapshots leave it zero so SaveSession keeps the
		// stored value instead of advancing it with per-turn activity.
		CreatedAt: s.createdAt,
	}, nil
}

func sessionFromRecord(rec *SessionRecord, cwd string) (*Session, error) {
	s, err := newSession(rec.ID, cwd, rec.AgentType)
	if err != nil {
		return nil, fmt.Errorf("session %q: %w", rec.ID, err)
	}
	s.Status = rec.Status
	s.createdAt = rec.CreatedAt
	s.lastActiveAt = rec.LastActiveAt
	if strings.TrimSpace(rec.AgentJSON) != "" {
		if err := json.Unmarshal([]byte(rec.AgentJSON), &s.agentState); err != nil {
			return nil, fmt.Errorf("unmarshal agent_json: %w", err)
		}
	}
	if strings.TrimSpace(rec.Title) != "" {
		if strings.TrimSpace(s.agentState.Title) == "" {
			state := &s.agentState
			state.Title = strings.TrimSpace(rec.Title)
		}
	}
	return s, nil
}

func (s *Session) persistSession(ctx context.Context) error {
	if s.store == nil {
		return nil
	}
	rec, err := s.toRecord()
	if err != nil {
		return err
	}
	return s.store.SaveSession(ctx, rec)
}

func (s *Session) persistSessionBestEffort() {
	if err := s.persistSession(context.Background()); err != nil {
		hubLogger(s.projectName).Warn("persist session failed session=%s err=%v", s.acpSessionID, err)
	}
}

func (s *Session) persistAgentPreferenceState(agentName string, options []acp.ConfigOption) {
	if s.store == nil || strings.TrimSpace(agentName) == "" {
		return
	}
	configOptions := configPreferenceFromACPOptions(options)
	next := PreferenceState{
		ConfigOptions: configOptions,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, err := json.Marshal(next)
	if err != nil {
		hubLogger(s.projectName).Warn("encode agent preference failed agent=%s err=%v", agentName, err)
		return
	}
	if err := s.store.SaveAgentPreference(context.Background(), AgentPreferenceRecord{
		ProjectName:    s.projectName,
		AgentType:      strings.TrimSpace(agentName),
		PreferenceJSON: string(raw),
	}); err != nil {
		hubLogger(s.projectName).Warn("save agent preference failed agent=%s err=%v", agentName, err)
	}
}

// Suspend cancels any in-progress prompt, closes the agent, and marks
// this session as suspended.
func (s *Session) Suspend(ctx context.Context) error {
	_ = s.cancelPrompt()

	s.mu.Lock()
	inst := s.instance
	s.instance = nil
	s.initialized = false
	s.ready = false
	s.initializing = false
	s.loading = false
	s.Status = SessionSuspended
	s.clearSteerStateLocked()
	s.mu.Unlock()

	if inst != nil {
		_ = inst.Close()
	}
	return s.persistSession(ctx)
}

func (s *Session) isRunning() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.executionKind != "" || s.prompt.ctx != nil || s.prompt.cancel != nil || s.prompt.updatesCh != nil || s.prompt.currentCh != nil
}

// SessionUpdate receives session/update notifications from the agent.
func (s *Session) AgentEvent(event acp.AgentEvent) {
	if update, ok := event.Update.(acp.AgentMessageEvent); ok &&
		event.MessageLifecycle &&
		update.Kind == acp.SessionUpdateUserMessageChunk &&
		acp.SessionUpdateMetaSteered(update.Meta) &&
		acp.SessionUpdateMetaMessageComplete(update.Meta) &&
		strings.TrimSpace(update.MessageID) != "" {
		s.completeSteeredQueueItem(update.MessageID)
	}
	params, err := event.LegacySessionUpdate()
	if err != nil {
		return
	}
	s.SessionUpdate(params)
}

// SessionUpdate consumes WheelMaker's normalized WMT2 update shape. Real ACP
// notifications enter through AgentEvent after strict decoding in Instance.
func (s *Session) SessionUpdate(params acp.SessionUpdateParams) {
	s.mu.Lock()
	sessID := s.acpSessionID
	ch := s.prompt.updatesCh
	promptCtx := s.prompt.ctx
	s.mu.Unlock()

	if params.SessionID != sessID {
		return
	}

	update := params.Update
	if update.SessionUpdate == acp.SessionUpdateUserMessageChunk &&
		update.Steered && strings.TrimSpace(update.ClientMessageID) != "" {
		s.completeSteeredQueueItem(update.ClientMessageID)
	}
	if isGoalLifecycleUpdate(update.SessionUpdate) {
		s.handleGoalLifecycleUpdate(update)
		return
	}

	changed := false
	if update.SessionUpdate == acp.SessionUpdateAvailableCommandsUpdate ||
		update.SessionUpdate == acp.SessionUpdateConfigOptionUpdate ||
		update.SessionUpdate == acp.SessionUpdateSessionInfoUpdate ||
		update.SessionUpdate == acp.SessionUpdateUsageUpdate {
		s.mu.Lock()
		state := &s.agentState
		switch update.SessionUpdate {
		case acp.SessionUpdateAvailableCommandsUpdate:
			if len(update.AvailableCommands) > 0 {
				state.Commands = update.AvailableCommands
				changed = true
			}
		case acp.SessionUpdateConfigOptionUpdate:
			if len(update.ConfigOptions) > 0 {
				state.ConfigOptions = normalizeAgentConfigOptions(s.agentType, update.ConfigOptions)
				changed = true
			}
		case acp.SessionUpdateSessionInfoUpdate:
			if update.Title != "" {
				state.Title = update.Title
				changed = true
			}
			if update.UpdatedAt != "" {
				state.UpdatedAt = update.UpdatedAt
				changed = true
			}
		case acp.SessionUpdateUsageUpdate:
			if update.Used != nil || update.Size != nil || strings.TrimSpace(update.UpdatedAt) != "" {
				next := acp.SessionUsage{}
				if state.Usage != nil {
					next = *state.Usage
				}
				if update.Used != nil {
					next.Used = *update.Used
				}
				if update.Size != nil {
					next.Size = *update.Size
				}
				if updatedAt := strings.TrimSpace(update.UpdatedAt); updatedAt != "" {
					next.UpdatedAt = updatedAt
				} else {
					next.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
				}
				state.Usage = &next
				changed = true
			}
		}
		s.mu.Unlock()
	}
	if changed {
		s.mu.Lock()
		agentType := s.agentType
		state := cloneSessionAgentState(&s.agentState)
		s.mu.Unlock()
		if state != nil {
			s.persistAgentPreferenceState(agentType, state.ConfigOptions)
		}
		s.persistSessionBestEffort()
	}

	if update.SessionUpdate == acp.SessionUpdateSessionInfoUpdate && ch == nil {
		s.recordSessionViewEvent(SessionViewEvent{
			Type:      SessionViewEventTypeACP,
			SessionID: sessID,
			Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
				"params": params,
			}),
		})
	}

	if update.SessionUpdate == acp.SessionUpdateUsageUpdate {
		s.recordSessionViewEvent(SessionViewEvent{
			Type:      SessionViewEventTypeACP,
			SessionID: sessID,
			Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
				"params": params,
			}),
		})
		return
	}

	if ch == nil {
		s.mu.Lock()
		goalOwned := s.executionKind == sessionGoalExecutionKind
		s.mu.Unlock()
		if goalOwned {
			s.recordSessionViewEvent(SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: sessID,
				Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
					"params": params,
				}),
			})
		}
		return
	}
	if promptCtx == nil {
		select {
		case ch <- params:
		default:
		}
		return
	}
	select {
	case ch <- params:
	case <-promptCtx.Done():
	}
}

// handlePrompt sends text to the active (or lazily initialized) session and streams the reply.
// promptMu is held for the full duration, serializing with switchAgent.
func (s *Session) handlePrompt(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	_ = s.handlePromptBlocks([]acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: text}})
}

// handlePromptBlocks sends content blocks to the active (or lazily initialized) session.
// promptMu is held for the full duration, serializing with switchAgent.
func (s *Session) handlePromptBlocks(blocks []acp.ContentBlock) error {
	if len(blocks) == 0 {
		return nil
	}
	if err := s.beginExecution("prompt"); err != nil {
		return err
	}
	return s.runPromptExecution(blocks)
}

func (s *Session) runPromptExecution(initial []acp.ContentBlock) error {
	defer func() {
		s.mu.Lock()
		goalOwned := s.executionKind == sessionGoalExecutionKind
		s.mu.Unlock()
		if !goalOwned {
			s.endExecution()
		}
	}()
	return s.runPromptTurn(cloneSessionContentBlocks(initial)).err
}

func (s *Session) runPromptTurn(blocks []acp.ContentBlock) sessionExecutionOutcome {
	return s.runPromptTurnWithContext(context.Background(), blocks, "")
}

func (s *Session) runPromptTurnWithContext(
	ctx context.Context,
	blocks []acp.ContentBlock,
	clientMessageID string,
) sessionExecutionOutcome {
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	generation := s.beginPromptGenerationLocked()
	s.mu.Unlock()

	outcome := s.runPromptBlocks(ctx, blocks, clientMessageID)

	s.mu.Lock()
	generation.completed = true
	resolvePromptGenerationLocked(generation)
	resolved := generation.resolved
	s.mu.Unlock()
	<-resolved

	s.mu.Lock()
	if s.steerState.active == generation {
		s.steerState.active = nil
	}
	s.mu.Unlock()
	return outcome
}

// runPromptBlocks executes one provider turn while promptMu is already owned.
func (s *Session) runPromptBlocks(
	ctx context.Context,
	blocks []acp.ContentBlock,
	clientMessageID string,
) sessionExecutionOutcome {
	recordedParams := map[string]any{
		"sessionId": s.acpSessionID,
		"prompt":    cloneSessionContentBlocks(blocks),
	}
	if clientMessageID != "" {
		recordedParams["clientMessageId"] = clientMessageID
	}
	s.recordSessionViewEvent(SessionViewEvent{
		Type:      SessionViewEventTypeACP,
		SessionID: s.acpSessionID,
		Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
			"params": recordedParams,
		}),
	})
	if err := s.ensureInstance(ctx); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			s.recordPromptDone(acp.StopReasonCancelled, "")
			return sessionExecutionOutcome{status: sessionExecutionCancelled}
		}
		s.recordPromptFailed(fmt.Sprintf("No active session: %v. %s", err, s.connectHint()))
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}

	if err := s.ensureReadyAndNotify(ctx); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			s.recordPromptDone(acp.StopReasonCancelled, "")
			return sessionExecutionOutcome{status: sessionExecutionCancelled}
		}
		s.recordPromptFailed(fmt.Sprintf("No active session: %v. %s", err, s.connectHint()))
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}

	promptBlocks, err := s.promptBlocksForAgent(blocks)
	if err != nil {
		s.recordPromptFailed(fmt.Sprintf("Prompt error: %v", err))
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}
	if err := ctx.Err(); err != nil {
		s.recordPromptDone(acp.StopReasonCancelled, "")
		return sessionExecutionOutcome{status: sessionExecutionCancelled}
	}

	updates, err := s.promptStream(ctx, promptBlocks)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			s.recordPromptDone(acp.StopReasonCancelled, "")
			return sessionExecutionOutcome{status: sessionExecutionCancelled}
		}
		if isAgentExitError(err) && !s.agentProcessAlive() {
			_ = s.resetDeadConnection(err)
		}
		s.recordPromptFailed(fmt.Sprintf("Prompt error: %v", err))
		return sessionExecutionOutcome{status: sessionExecutionFailed, err: err}
	}

	s.mu.Lock()
	s.prompt.currentCh = updates
	s.mu.Unlock()

	var buf strings.Builder
	streamDone := false
	for !streamDone {
		ev, ok := <-updates
		if !ok {
			streamDone = true
			break
		}
		if ev.err != nil {
			if errors.Is(ev.err, context.Canceled) {
				s.recordPromptDone(acp.StopReasonCancelled, "")
				s.mu.Lock()
				s.prompt.currentCh = nil
				s.mu.Unlock()
				return sessionExecutionOutcome{status: sessionExecutionCancelled}
			}
			recovered := false
			if !s.agentProcessAlive() && s.resetDeadConnection(ev.err) {
				if recErr := s.ensureInstance(ctx); recErr == nil {
					_ = s.ensureReadyAndNotify(ctx)
					recovered = true
				}
			}
			if recovered {
				s.recordPromptFailed("Agent process exited and was reconnected. Please resend if this reply was interrupted.")
			} else {
				s.recordPromptFailed(fmt.Sprintf("Agent error: %v", ev.err))
			}
			s.mu.Lock()
			s.prompt.currentCh = nil
			s.mu.Unlock()
			return sessionExecutionOutcome{status: sessionExecutionFailed, err: ev.err}
		}
		if ev.update != nil {
			params := *ev.update
			s.recordSessionViewEvent(SessionViewEvent{
				Type:      SessionViewEventTypeACP,
				SessionID: s.acpSessionID,
				Content: acp.BuildACPContentJSON(acp.MethodSessionUpdate, map[string]any{
					"params": params,
				}),
			})
			if params.Update.SessionUpdate == acp.SessionUpdateAgentMessageChunk {
				text := extractTextChunk(params.Update.Content)
				if strings.TrimSpace(text) != "" {
					buf.WriteString(text)
				}
			}
			if params.Update.SessionUpdate == acp.SessionUpdateConfigOptionUpdate {
				raw, _ := json.Marshal(params.Update)
				s.reply(formatConfigOptionUpdateMessage(raw))
				s.persistSessionBestEffort()
			}
		}
		if ev.result != nil {
			s.mu.Lock()
			suppressPromptResult := s.goal.suppressPromptResult
			if suppressPromptResult {
				s.goal.suppressPromptResult = false
			}
			s.mu.Unlock()
			if !suppressPromptResult {
				s.recordSessionViewEvent(SessionViewEvent{
					Type:      SessionViewEventTypeACP,
					SessionID: s.acpSessionID,
					Content: acp.BuildACPContentJSON(acp.MethodSessionPrompt, map[string]any{
						"result": acp.SessionTurnPromptResult{
							StopReason: ev.result.StopReason,
							Message:    firstNonEmpty(strings.TrimSpace(ev.result.Message), acp.WMPromptResultMetaMessage(ev.result.Meta)),
						},
					}),
					Artifacts: cloneSessionPromptArtifactPayloads(ev.result.Artifacts),
					ForkPoint: cloneSessionForkPoint(ev.result.ForkPoint),
				})
			}
			if ev.result.StopReason == acp.StopReasonCancelled {
				s.mu.Lock()
				s.prompt.currentCh = nil
				s.mu.Unlock()
				return sessionExecutionOutcome{status: sessionExecutionCancelled}
			}
			if ev.result.StopReason == acp.SessionTurnStopReasonFailed {
				message := firstNonEmpty(strings.TrimSpace(ev.result.Message), acp.WMPromptResultMetaMessage(ev.result.Meta))
				if message == "" {
					message = "prompt failed"
				}
				s.mu.Lock()
				s.prompt.currentCh = nil
				s.mu.Unlock()
				return sessionExecutionOutcome{status: sessionExecutionFailed, err: errors.New(message)}
			}
			streamDone = true
		}
	}

	s.mu.Lock()
	s.prompt.currentCh = nil
	s.mu.Unlock()

	s.persistSessionBestEffort()

	if buf.Len() > 0 {
		s.reply(buf.String())
	}
	return sessionExecutionOutcome{status: sessionExecutionCompleted}
}

func extractTextChunk(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var anyValue any
	if err := json.Unmarshal(raw, &anyValue); err != nil {
		return ""
	}
	return extractTextFromAny(anyValue)
}

func extractTextFromAny(v any) string {
	switch value := v.(type) {
	case string:
		return value
	case map[string]any:
		if text, ok := value["text"].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
		if delta, ok := value["delta"].(string); ok && strings.TrimSpace(delta) != "" {
			return delta
		}
		if content, ok := value["content"]; ok {
			if text := extractTextFromAny(content); strings.TrimSpace(text) != "" {
				return text
			}
		}
		if resource, ok := value["resource"]; ok {
			if text := extractTextFromAny(resource); strings.TrimSpace(text) != "" {
				return text
			}
		}
		return ""
	case []any:
		var builder strings.Builder
		for _, item := range value {
			builder.WriteString(extractTextFromAny(item))
		}
		return builder.String()
	default:
		return ""
	}
}

func renderUnknown(v string) string {
	if strings.TrimSpace(v) == "" {
		return "unknown"
	}
	return v
}

func (s *Session) connectHint() string {
	s.mu.Lock()
	agentName := strings.TrimSpace(s.agentType)
	s.mu.Unlock()
	if agentName == "" && s.registry != nil {
		agentName = strings.TrimSpace(s.registry.PreferredName())
	}
	if agentName == "" {
		if s.registry != nil {
			names := s.registry.Names()
			if len(names) > 0 {
				return fmt.Sprintf("Create a session in the app to connect an agent. Available: %s", strings.Join(names, ", "))
			}
		}
		return "No available ACP provider. Check environment and restart wheelmaker."
	}
	return fmt.Sprintf("Create or select a session in the app to connect agent %s.", agentName)
}

type instanceLivenessProbe interface {
	Alive() bool
}

func (s *Session) agentProcessAlive() bool {
	s.mu.Lock()
	inst := s.instance
	s.mu.Unlock()
	if inst == nil {
		return false
	}
	probe, ok := inst.(instanceLivenessProbe)
	if !ok {
		return true
	}
	return probe.Alive()
}

func isAgentExitError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(strings.TrimSpace(err.Error()))
	if s == "" {
		return false
	}
	if strings.Contains(s, "tls handshake eof") {
		return false
	}
	if s == "eof" || strings.HasSuffix(s, ": eof") {
		return true
	}
	return strings.Contains(s, "agent process exited") ||
		strings.Contains(s, "process exited") ||
		strings.Contains(s, "conn is closed") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "process stdout closed") ||
		strings.Contains(s, "codexapp runtime stopped")
}

func (s *Session) resetDeadConnection(err error) bool {
	if !isAgentExitError(err) {
		return false
	}
	s.mu.Lock()
	old := s.instance
	s.instance = nil
	s.initialized = false
	s.ready = false
	s.initializing = false
	s.loading = false
	s.prompt.ctx = nil
	s.prompt.cancel = nil
	s.prompt.updatesCh = nil
	s.prompt.currentCh = nil
	s.clearSteerStateLocked()
	s.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return true
}
