package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

const acpClientProtocolVersion = 1

var acpClientInfo = &acp.AgentInfo{Name: "wheelmaker", Version: "0.1"}

var cleanupSessionArtifacts = agent.CleanupSessionArtifacts

type promptState struct {
	ctx       context.Context
	cancel    context.CancelFunc
	updatesCh chan<- acp.SessionUpdateParams
	currentCh <-chan promptStreamEvent // tracked for prompt lifecycle cleanup
}

type promptStreamEvent struct {
	update *acp.SessionUpdateParams
	result *acp.SessionPromptResult
	err    error
}

type sessionForkPointCacheEntry struct {
	latestTurnIndex int64
	points          map[int64]acp.SessionForkPoint
}

// Client is the top-level coordinator for a single WheelMaker project.
// Agent initialization is lazy: the first incoming message triggers ensureInstance(),
// which connects the active agent and creates the ACP forwarder.
type Client struct {
	projectName string
	cwd         string
	stateDir    string

	registry *agent.ACPFactory

	store Store

	mu sync.Mutex

	forkPointMu    sync.Mutex
	forkPointCache map[string]sessionForkPointCacheEntry

	// sessions maps session IDs to Session objects.
	sessions map[string]*Session

	// suspendTimeout is how long a Suspended session stays in memory before
	// being persisted to SQLite and evicted. Default: 5 minutes.
	suspendTimeout time.Duration
	stopPersistCh  chan struct{} // closed to stop the persist timer goroutine

	sessionRecorder *SessionRecorder
	archiveStore    *sessionArchiveStore
	sessionSearch   *sessionSearchManager
	attachments     *attachmentManager
	viewSink        SessionViewSink
}

// RuntimeConfig binds Hub-scoped runtime dependencies to one Client.
type RuntimeConfig struct {
	AgentFactory *agent.ACPFactory
	StateDir     string
}

// New creates a Client for the given project.
func New(store Store, projectName string, cwd string) *Client {
	return NewWithRuntime(store, projectName, cwd, RuntimeConfig{
		AgentFactory: agent.DefaultACPFactory(),
		StateDir:     defaultClientStateDir(),
	})
}

// NewWithRuntime creates a Client with an explicit Hub runtime configuration.
func NewWithRuntime(store Store, projectName string, cwd string, runtime RuntimeConfig) *Client {
	if runtime.AgentFactory == nil {
		runtime.AgentFactory = agent.DefaultACPFactory()
	}
	stateDir := ""
	if strings.TrimSpace(runtime.StateDir) != "" {
		stateDir = filepath.Clean(runtime.StateDir)
	}
	c := &Client{
		projectName:    projectName,
		cwd:            cwd,
		stateDir:       stateDir,
		registry:       runtime.AgentFactory,
		store:          store,
		sessions:       make(map[string]*Session),
		forkPointCache: make(map[string]sessionForkPointCacheEntry),
		suspendTimeout: 5 * time.Minute,
		stopPersistCh:  make(chan struct{}),
		attachments:    newAttachmentManager(),
	}
	c.sessionRecorder = newSessionRecorder(projectName, store, func(ctx context.Context) ([]SessionRecord, error) {
		return c.ListSessions(ctx)
	})
	c.sessionSearch = newSessionSearchManager(c)
	c.sessionRecorder.modelLookup = func(sessionID string) string {
		options := c.sessionConfigOptions(context.Background(), sessionID)
		for _, opt := range options {
			if opt.ID == acp.ConfigOptionIDModel {
				for _, value := range opt.Options {
					if value.Value == opt.CurrentValue && value.Name != "" {
						return value.Name
					}
				}
				return opt.CurrentValue
			}
		}
		return ""
	}
	c.sessionRecorder.actionLookup = func(agentType string) acp.SessionActionCapabilities {
		provider, ok := acp.ParseACPProvider(agentType)
		if !ok || c.registry == nil {
			return unsupportedSessionActions("Current Agent does not support this action.")
		}
		support := c.registry.SessionActions(provider)
		return acp.SessionActionCapabilities{
			Status: acp.SessionActionCapability{
				Supported: support.Status,
				Reason:    unsupportedSessionActionReason(support.Status),
			},
			Compact: acp.SessionActionCapability{
				Supported: support.Compact,
				Reason:    unsupportedSessionActionReason(support.Compact),
			},
		}
	}
	c.viewSink = c.sessionRecorder
	return c
}

func defaultClientStateDir() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".wheelmaker")
}

func unsupportedSessionActionReason(supported bool) string {
	if supported {
		return ""
	}
	return "Current Agent does not support this action."
}

func unsupportedSessionActions(reason string) acp.SessionActionCapabilities {
	return acp.SessionActionCapabilities{
		Status:  acp.SessionActionCapability{Supported: false, Reason: reason},
		Compact: acp.SessionActionCapability{Supported: false, Reason: reason},
	}
}

func (c *Client) ProjectName() string {
	return c.projectName
}

func (c *Client) SetSessionHistoryRoot(root string) {
	if c == nil || c.sessionRecorder == nil {
		return
	}
	root = strings.TrimSpace(root)
	if root == "" {
		c.sessionRecorder.turnStore = nil
		c.sessionRecorder.artifactStore = nil
		c.archiveStore = nil
		return
	}
	c.sessionRecorder.turnStore = newFileSessionTurnStore(root)
	c.sessionRecorder.artifactStore = newFileSessionArtifactStore(root)
	c.archiveStore = newSessionArchiveStore(filepath.Join(filepath.Dir(root), "session-archive"))
}

// Start loads persisted state.
// Agent initialization is deferred until a session prompt needs an agent (lazy init).
func (c *Client) Start(ctx context.Context) error {
	if err := c.store.SaveProjectDefaultAgent(ctx, c.projectName, ""); err != nil {
		return fmt.Errorf("client: ensure project row: %w", err)
	}
	go c.persistLoop()
	return nil
}

// Run blocks until ctx is cancelled.
func (c *Client) Run(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

// Close persists all in-memory sessions and shuts down active agents.
func (c *Client) Close() error {
	// Stop the persist timer goroutine.
	select {
	case <-c.stopPersistCh:
	default:
		close(c.stopPersistCh)
	}
	if c.sessionSearch != nil {
		c.sessionSearch.Close()
	}

	c.mu.Lock()
	sessions := make([]*Session, 0, len(c.sessions))
	for _, sess := range c.sessions {
		sessions = append(sessions, sess)
	}
	store := c.store
	c.mu.Unlock()

	ctx := context.Background()
	for _, sess := range sessions {
		sess.mu.Lock()
		inst := sess.instance
		sess.mu.Unlock()
		if inst != nil {
			if err := sess.Suspend(ctx); err != nil {
				hubLogger(c.projectName).Warn("suspend session during close session=%s err=%v", sess.acpSessionID, err)
			}
			continue
		}
		if err := sess.persistSession(ctx); err != nil {
			hubLogger(c.projectName).Warn("persist session during close session=%s err=%v", sess.acpSessionID, err)
		}
	}
	if c.sessionRecorder != nil {
		c.sessionRecorder.Close()
	}
	if store != nil {
		return store.Close()
	}
	return nil
}

func loadProjectAgentPreferenceState(store Store, projectName string, agentName string) PreferenceState {
	if store == nil || strings.TrimSpace(agentName) == "" {
		return PreferenceState{}
	}
	rec, err := store.LoadAgentPreference(context.Background(), projectName, strings.TrimSpace(agentName))
	if err != nil || rec == nil || strings.TrimSpace(rec.PreferenceJSON) == "" {
		return PreferenceState{}
	}
	var pref PreferenceState
	if err := json.Unmarshal([]byte(rec.PreferenceJSON), &pref); err != nil {
		hubLogger(projectName).Warn("decode agent preference failed agent=%s err=%v", agentName, err)
		return PreferenceState{}
	}
	pref.ConfigOptions = normalizeStoredConfigPreferences(agentName, sanitizePreferenceConfigOptions(pref.ConfigOptions))
	return pref
}

func sanitizePreferenceConfigOptions(options []PreferenceConfigOption) []PreferenceConfigOption {
	if len(options) == 0 {
		return nil
	}
	out := make([]PreferenceConfigOption, 0, len(options))
	seen := make(map[string]struct{}, len(options))
	for _, opt := range options {
		id := strings.TrimSpace(opt.ID)
		if id == "" {
			continue
		}
		key := strings.ToLower(id)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, PreferenceConfigOption{
			ID:           id,
			CurrentValue: opt.CurrentValue,
		})
	}
	return out
}

func configPreferencesWithAgentDefaults(
	agentName string,
	current []acp.ConfigOption,
	stored []PreferenceConfigOption,
) []PreferenceConfigOption {
	resolved := append([]PreferenceConfigOption(nil), stored...)
	defaultEffort := ""
	switch strings.ToLower(strings.TrimSpace(agentName)) {
	case string(acp.ACPProviderCCDeepSeek), string(acp.ACPProviderCCGLM):
		defaultEffort = "max"
	case string(acp.ACPProviderCCKimi):
		defaultEffort = "high"
	}
	if defaultEffort == "" || hasStoredThoughtPreference(stored) {
		return resolved
	}
	for _, option := range current {
		if !isThoughtConfigOption(option.ID, option.Category) {
			continue
		}
		resolved = append(resolved, PreferenceConfigOption{
			ID:           option.ID,
			CurrentValue: defaultEffort,
		})
		break
	}
	return resolved
}

func hasStoredThoughtPreference(options []PreferenceConfigOption) bool {
	for _, option := range options {
		if isThoughtConfigOption(option.ID, "") {
			return true
		}
	}
	return false
}

func isThoughtConfigOption(id, category string) bool {
	for _, value := range []string{id, category} {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "effort", acp.ConfigOptionIDThoughtLevel, acp.ConfigOptionIDReasoningEffort:
			return true
		}
	}
	return false
}

func (c *Client) createSessionState(ctx context.Context, agentType, title, createRequestID string) (*createdSessionState, error) {
	agentType = normalizeAgentType(agentType)
	if _, ok := acp.ParseACPProvider(agentType); !ok {
		return nil, fmt.Errorf("no agent registered for %q", agentType)
	}
	creator := c.registry.CreatorByName(agentType)
	if creator == nil {
		// The agent name is valid but no creator is registered, meaning its CLI is
		// not installed/launchable on this hub. Fail loudly instead of silently
		// falling back to another provider: the old fallback turned a requested
		// "codex" session into a "claude" session and even overwrote the project's
		// persisted default agent. This matches the resume/prompt path
		// (Session.ensureInstance), which already errors the same way.
		available := ""
		if c.registry != nil {
			available = strings.Join(c.registry.Names(), ", ")
		}
		return nil, fmt.Errorf("agent %q is not available on this hub (available: %s); install its CLI and ensure it is on PATH, or pick an available agent", agentType, available)
	}

	inst, err := creator(agent.WithProjectName(ctx, c.projectName), c.cwd)
	if err != nil {
		return nil, fmt.Errorf("create session instance: %w", err)
	}
	closeOnErr := true
	defer func() {
		if closeOnErr {
			_ = inst.Close()
		}
	}()

	clientCaps := acp.ClientCapabilities{
		FS: &acp.FSCapabilities{
			ReadTextFile:  true,
			WriteTextFile: true,
		},
		Terminal: true,
	}
	initResult, err := inst.Initialize(ctx, acp.InitializeParams{
		ProtocolVersion:    acpClientProtocolVersion,
		ClientCapabilities: clientCaps,
		ClientInfo:         acpClientInfo,
	})
	if err != nil {
		return nil, fmt.Errorf("create session initialize: %w", err)
	}

	preference := loadProjectAgentPreferenceState(c.store, c.projectName, agentType)

	newResult, err := inst.SessionNew(ctx, acp.SessionNewParams{
		CWD:        c.cwd,
		MCPServers: emptyMCPServers(),
	})
	if err != nil {
		return nil, fmt.Errorf("create session new: %w", err)
	}
	sessionID := strings.TrimSpace(newResult.SessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("create session new: empty session id")
	}

	resolved := normalizeAgentConfigOptions(agentType, newResult.ConfigOptions)
	targetConfig := configPreferencesWithAgentDefaults(agentType, resolved, preference.ConfigOptions)
	if len(targetConfig) > 0 {
		resolved = applyStoredConfigOptions(ctx, c.projectName, inst, sessionID, resolved, targetConfig)
	}
	resolved = normalizeAgentConfigOptions(agentType, resolved)

	sessionTitle := strings.TrimSpace(newResult.Title)
	if sessionTitle == "" {
		sessionTitle = strings.TrimSpace(title)
	}

	state := SessionAgentState{
		ConfigOptions:     append([]acp.ConfigOption(nil), resolved...),
		Commands:          []acp.AvailableCommand{},
		Title:             sessionTitle,
		CreateRequestID:   createRequestID,
		AgentCapabilities: initResult.AgentCapabilities,
		AgentInfo:         cloneAgentInfo(initResult.AgentInfo),
		AuthMethods:       append([]acp.AuthMethod(nil), initResult.AuthMethods...),
	}

	closeOnErr = false
	return &createdSessionState{
		sessionID: sessionID,
		agentType: agentType,
		state:     state,
		instance:  inst,
		createdAt: time.Now(),
	}, nil
}

func (c *Client) CreateSession(ctx context.Context, agentType, title string) (*Session, error) {
	return c.createSession(ctx, agentType, title, "")
}

func (c *Client) createSession(ctx context.Context, agentType, title, createRequestID string) (*Session, error) {
	agentType = normalizeAgentType(agentType)
	if agentType == "" {
		return nil, fmt.Errorf("agent type is required")
	}
	created, err := c.createSessionState(ctx, agentType, title, createRequestID)
	if err != nil {
		return nil, err
	}
	sess, err := c.newWiredSession(created.sessionID, created.agentType)
	if err != nil {
		_ = created.instance.Close()
		return nil, err
	}
	sess.mu.Lock()
	sess.instance = created.instance
	sess.agentState = created.state
	sess.createdAt = created.createdAt
	// New sessions already completed initialize + session/new before Session construction,
	// so they start ready without re-entering ensureReady.
	sess.initialized = true
	sess.ready = true
	sess.mu.Unlock()
	created.instance.SetCallbacks(sess)
	sess.persistAgentPreferenceState(created.agentType, created.state.ConfigOptions)
	if err := sess.persistSession(ctx); err != nil {
		sess.mu.Lock()
		sess.instance = nil
		sess.initialized = false
		sess.ready = false
		sess.initializing = false
		sess.loading = false
		sess.mu.Unlock()
		_ = created.instance.Close()
		return nil, fmt.Errorf("save session: %w", err)
	}
	c.mu.Lock()
	c.sessions[sess.acpSessionID] = sess
	c.mu.Unlock()
	return sess, nil
}

func (c *Client) SessionByID(ctx context.Context, sessionID string) (*Session, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	c.mu.Lock()
	if sess := c.sessions[sessionID]; sess != nil {
		c.mu.Unlock()
		return sess, nil
	}
	store := c.store
	c.mu.Unlock()

	rec, err := store.LoadSession(ctx, c.projectName, sessionID)
	if err != nil {
		return nil, fmt.Errorf("load session %q: %w", sessionID, err)
	}
	if rec == nil {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	restored, err := sessionFromRecord(rec, c.cwd)
	if err != nil {
		return nil, err
	}
	c.wireSession(restored)
	restored.Status = SessionActive
	c.mu.Lock()
	c.sessions[restored.acpSessionID] = restored
	c.mu.Unlock()
	return restored, nil
}

func (c *Client) PromptToSession(ctx context.Context, sessionID string, blocks []acp.ContentBlock) error {
	sess, err := c.SessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	return sess.handlePromptBlocks(blocks)
}

func promptTitleFromBlocks(blocks []acp.ContentBlock) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if strings.TrimSpace(block.Type) == acp.ContentBlockTypeText && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, strings.TrimSpace(block.Text))
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, "\n")
	}
	for _, block := range blocks {
		if strings.TrimSpace(block.Type) == acp.ContentBlockTypeImage {
			return "Sent an image"
		}
	}
	return ""
}

func cloneSessionContentBlocks(blocks []acp.ContentBlock) []acp.ContentBlock {
	if len(blocks) == 0 {
		return nil
	}
	return cloneJSON(blocks)
}

func cloneSessionPermissionOptions(options []acp.PermissionOption) []acp.PermissionOption {
	if len(options) == 0 {
		return nil
	}
	return cloneJSON(options)
}

func cloneJSON[T any](value T) T {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Errorf("clone JSON: %w", err))
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		panic(fmt.Errorf("clone JSON: %w", err))
	}
	return out
}

func (c *Client) SetSessionViewSink(sink SessionViewSink) {
	if sink == nil {
		sink = c.sessionRecorder
	}
	c.mu.Lock()
	c.viewSink = sink
	for _, sess := range c.sessions {
		sess.viewSink = sink
	}
	c.mu.Unlock()
}

func (c *Client) SetSessionEventPublisher(publish func(method string, payload any) error) {
	c.sessionRecorder.SetEventPublisher(publish)
}

func (c *Client) ResetSessionPromptState() {
	if c == nil || c.sessionRecorder == nil {
		return
	}
	c.sessionRecorder.ResetPromptState()
}

func (c *Client) RecordEvent(ctx context.Context, event SessionViewEvent) error {
	return c.sessionRecorder.RecordEvent(ctx, event)
}

func (c *Client) RecordSessionOperation(ctx context.Context, sessionID string, payload acp.SessionOperationPayload) error {
	return c.sessionRecorder.RecordSessionOperation(ctx, sessionID, payload)
}

func (c *Client) RecordPermissionRequest(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionRequest) (int64, error) {
	return c.sessionRecorder.RecordPermissionRequest(ctx, sessionID, payload)
}

func (c *Client) RecordPermissionResponse(ctx context.Context, sessionID string, payload acp.SessionTurnPermissionResponse) (int64, error) {
	return c.sessionRecorder.RecordPermissionResponse(ctx, sessionID, payload)
}

func (c *Client) HandleSessionRequest(ctx context.Context, method string, projectID string, payload json.RawMessage) (any, error) {
	switch strings.TrimSpace(method) {
	case acp.RegistryMethodSessionList:
		sessions, err := c.sessionRecorder.ListSessionViews(ctx)
		if err != nil {
			return nil, err
		}
		for i := range sessions {
			sessions[i].ConfigOptions = c.sessionConfigOptions(ctx, sessions[i].SessionID)
		}
		return map[string]any{"sessions": sessions}, nil
	case acp.RegistryMethodSessionRead:
		var req struct {
			SessionID      string `json:"sessionId"`
			AfterTurnIndex int64  `json:"afterTurnIndex,omitempty"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.read payload: %w", err)
		}
		sessionID := strings.TrimSpace(req.SessionID)
		afterTurnIndex := req.AfterTurnIndex
		if afterTurnIndex < 0 {
			afterTurnIndex = 0
		}
		log := hubLogger(c.projectName)
		if log.VerboseEnabled() {
			log.Verbose("session.read request sessionId=%s afterTurnIndex=%d", sessionID, afterTurnIndex)
		}
		latestTurnIndex, turns, err := c.sessionRecorder.ReadSessionTurns(ctx, sessionID, afterTurnIndex)
		if err != nil {
			if log.VerboseEnabled() {
				log.Verbose("session.read error sessionId=%s afterTurnIndex=%d error=%s", sessionID, afterTurnIndex, err)
			}
			return nil, err
		}
		summary, err := c.sessionRecorder.ReadSessionSummary(ctx, sessionID)
		if err != nil {
			if log.VerboseEnabled() {
				log.Verbose("session.read error sessionId=%s afterTurnIndex=%d latestTurnIndex=%d turnCount=%d error=%s", sessionID, afterTurnIndex, latestTurnIndex, len(turns), err)
			}
			return nil, err
		}
		if strings.EqualFold(summary.AgentType, string(acp.ACPProviderCodex)) {
			enriched, enrichErr := c.enrichLegacySessionForkPoints(ctx, sessionID, latestTurnIndex, turns)
			if enrichErr == nil {
				turns = enriched
			} else {
				hubLogger(c.projectName).Warn("resolve legacy fork points failed session=%s err=%v", sessionID, enrichErr)
			}
		}
		if log.VerboseEnabled() {
			log.Verbose("session.read result sessionId=%s afterTurnIndex=%d latestTurnIndex=%d turnCount=%d lastDoneTurnIndex=%d lastReadTurnIndex=%d lastDoneSuccess=%t running=%t", sessionID, afterTurnIndex, latestTurnIndex, len(turns), summary.LastDoneTurnIndex, summary.LastReadTurnIndex, summary.LastDoneSuccess, summary.Running)
		}
		return map[string]any{"sessionId": sessionID, "latestTurnIndex": latestTurnIndex, "session": summary, "turns": turns}, nil
	case acp.RegistryMethodSessionSearch:
		if c.sessionSearch == nil {
			c.sessionSearch = newSessionSearchManager(c)
		}
		return c.sessionSearch.Handle(ctx, projectID, payload)
	case acp.RegistryMethodSessionMarkRead:
		var req struct {
			SessionID         string `json:"sessionId"`
			LastReadTurnIndex int64  `json:"lastReadTurnIndex,omitempty"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.markRead payload: %w", err)
		}
		summary, err := c.sessionRecorder.MarkSessionRead(ctx, req.SessionID, req.LastReadTurnIndex)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "session": summary}, nil
	case acp.RegistryMethodSessionPin:
		var req struct {
			SessionID string `json:"sessionId"`
			Pinned    bool   `json:"pinned"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.pin payload: %w", err)
		}
		summary, err := c.sessionRecorder.SetSessionPinned(ctx, req.SessionID, req.Pinned)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": summary.SessionID, "session": summary}, nil
	case acp.RegistryMethodSessionMark:
		var req struct {
			SessionID string  `json:"sessionId"`
			MarkColor *string `json:"markColor"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.mark payload: %w", err)
		}
		if req.MarkColor == nil {
			return nil, fmt.Errorf("markColor is required")
		}
		summary, err := c.sessionRecorder.SetSessionMarkColor(ctx, req.SessionID, *req.MarkColor)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": summary.SessionID, "session": summary}, nil
	case acp.RegistryMethodSessionRename:
		var req struct {
			SessionID string `json:"sessionId"`
			Title     string `json:"title"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.rename payload: %w", err)
		}
		summary, err := c.sessionRecorder.RenameSessionTitle(ctx, req.SessionID, req.Title)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": summary.SessionID, "session": summary}, nil
	case acp.RegistryMethodSessionCreate:
		var req struct {
			AgentType       string `json:"agentType"`
			Title           string `json:"title,omitempty"`
			CreateRequestID string `json:"createRequestId,omitempty"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.create payload: %w", err)
		}
		if strings.TrimSpace(req.AgentType) == "" {
			return nil, fmt.Errorf("agentType is required")
		}
		sess, err := c.createSession(ctx, req.AgentType, req.Title, strings.TrimSpace(req.CreateRequestID))
		if err != nil {
			return nil, err
		}
		if c.store != nil {
			if err := c.store.SaveProjectDefaultAgent(ctx, c.projectName, sess.agentType); err != nil {
				hubLogger(c.projectName).Warn("save project default agent failed agent=%s err=%v", sess.agentType, err)
			}
		}
		sessionTitle := strings.TrimSpace(sess.agentState.Title)
		if sessionTitle == "" {
			sessionTitle = strings.TrimSpace(req.Title)
		}
		if err := c.RecordEvent(ctx, SessionViewEvent{
			Type:      SessionViewEventTypeACP,
			SessionID: sess.acpSessionID,
			Content: acp.BuildACPContentJSON(acp.MethodSessionNew, map[string]any{
				"params": sessionViewSessionNewParams{
					SessionID: sess.acpSessionID,
					AgentType: sess.agentType,
					Title:     sessionTitle,
				},
			}),
		}); err != nil {
			return nil, err
		}
		summary, err := c.sessionRecorder.ReadSessionSummary(ctx, sess.acpSessionID)
		if err != nil {
			return nil, err
		}
		summary.ConfigOptions = sess.CurrentConfigOptions()
		return map[string]any{"ok": true, "session": summary}, nil
	case acp.RegistryMethodSessionResumeList:
		var req struct {
			AgentType string `json:"agentType"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.resume.list payload: %w", err)
		}
		return c.recovery().ListResumableSessions(ctx, req.AgentType)
	case acp.RegistryMethodSessionResumeImport:
		var req struct {
			SessionID string `json:"sessionId"`
			AgentType string `json:"agentType"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.resume.import payload: %w", err)
		}
		return c.recovery().ImportResumableSession(ctx, req.AgentType, req.SessionID)
	case acp.RegistryMethodSessionReload:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.reload payload: %w", err)
		}
		return c.recovery().ReloadSession(ctx, req.SessionID)
	case acp.RegistryMethodSessionArchive:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.archive payload: %w", err)
		}
		warning, err := c.archiveSession(ctx, req.SessionID)
		if err != nil {
			return nil, err
		}
		resp := map[string]any{"ok": true, "sessionId": strings.TrimSpace(req.SessionID)}
		if warning != "" {
			resp["warning"] = warning
		}
		return resp, nil
	case acp.RegistryMethodSessionArchiveList:
		return c.ListArchivedSessions(ctx)
	case acp.RegistryMethodSessionArchiveRead:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.archive.read payload: %w", err)
		}
		return c.ReadArchivedSession(ctx, req.SessionID)
	case acp.RegistryMethodSessionArchiveRestore:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.archive.restore payload: %w", err)
		}
		return c.RestoreArchivedSession(ctx, req.SessionID)
	case acp.RegistryMethodSessionArtifactRead:
		var req struct {
			SessionID  string `json:"sessionId"`
			ArtifactID string `json:"artifactId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.artifact.read payload: %w", err)
		}
		return c.ReadSessionArtifact(ctx, req.SessionID, req.ArtifactID)
	case acp.RegistryMethodSessionDelete:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.delete payload: %w", err)
		}
		if err := c.DeleteSession(ctx, req.SessionID); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": strings.TrimSpace(req.SessionID)}, nil
	case acp.RegistryMethodSessionAttachmentStart:
		return c.handleSessionAttachmentStart(ctx, payload)
	case acp.RegistryMethodSessionAttachmentChunk:
		return c.handleSessionAttachmentChunk(ctx, payload)
	case acp.RegistryMethodSessionAttachmentFinish:
		return c.handleSessionAttachmentFinish(ctx, payload)
	case acp.RegistryMethodSessionAttachmentCancel:
		return c.handleSessionAttachmentCancel(ctx, payload)
	case acp.RegistryMethodSessionAttachmentDelete:
		return c.handleSessionAttachmentDelete(ctx, payload)
	case acp.RegistryMethodSessionAttachmentThumbnail:
		return c.handleSessionAttachmentThumbnail(ctx, payload)
	case acp.RegistryMethodSessionAttachmentRead:
		return c.handleSessionAttachmentRead(ctx, payload)
	case acp.RegistryMethodSessionConfig:
		var req struct {
			SessionID string `json:"sessionId"`
			ConfigID  string `json:"configId"`
			Value     string `json:"value"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.config payload: %w", err)
		}
		sess, err := c.SessionByID(ctx, req.SessionID)
		if err != nil {
			return nil, err
		}
		options, err := sess.SetConfigOption(ctx, req.ConfigID, req.Value)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"ok":            true,
			"sessionId":     sess.acpSessionID,
			"configOptions": options,
		}, nil
	case acp.RegistryMethodSessionStatus:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.status payload: %w", err)
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, fmt.Errorf("sessionId is required")
		}
		sess, err := c.SessionByID(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		if !c.sessionSupportsAction(sess, acp.SessionActionStatus) {
			return nil, fmt.Errorf("%w: status", agent.ErrSessionActionUnsupported)
		}
		return sess.SessionStatus(ctx)
	case acp.RegistryMethodSessionCompact:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.compact payload: %w", err)
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, fmt.Errorf("sessionId is required")
		}
		sess, err := c.SessionByID(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		if !c.sessionSupportsAction(sess, acp.SessionActionCompact) {
			return nil, fmt.Errorf("%w: compact", agent.ErrSessionActionUnsupported)
		}
		operationID := uuid.NewString()
		if err := sess.StartCompaction(ctx, operationID); err != nil {
			return nil, err
		}
		return acp.SessionCompactAccepted{
			OK:          true,
			Accepted:    true,
			SessionID:   sessionID,
			OperationID: operationID,
		}, nil
	case acp.RegistryMethodSessionFork:
		var req struct {
			SessionID string `json:"sessionId"`
			TurnIndex int64  `json:"turnIndex"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.fork payload: %w", err)
		}
		return c.forkSessionAtTurn(ctx, req.SessionID, req.TurnIndex)
	case acp.RegistryMethodSessionSend:
		var req struct {
			SessionID string             `json:"sessionId"`
			Text      string             `json:"text,omitempty"`
			Blocks    []acp.ContentBlock `json:"blocks,omitempty"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.send payload: %w", err)
		}
		blocks := req.Blocks
		if len(blocks) == 0 && strings.TrimSpace(req.Text) != "" {
			blocks = []acp.ContentBlock{{Type: acp.ContentBlockTypeText, Text: req.Text}}
		}
		if strings.TrimSpace(req.SessionID) == "" {
			return nil, fmt.Errorf("sessionId is required")
		}
		if len(blocks) == 0 {
			return nil, fmt.Errorf("session prompt is empty")
		}
		blocks, attachmentRefs, err := c.prepareSessionPromptBlocks(ctx, req.SessionID, blocks)
		if err != nil {
			return nil, err
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if err := c.PromptToSession(ctx, sessionID, blocks); err != nil {
			return nil, err
		}
		if err := c.markSessionAttachmentsSent(attachmentRefs); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": strings.TrimSpace(req.SessionID)}, nil
	case acp.RegistryMethodSessionCancel:
		var req struct {
			SessionID string `json:"sessionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid session.cancel payload: %w", err)
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" {
			return nil, fmt.Errorf("sessionId is required")
		}
		sess, err := c.SessionByID(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		if err := sess.cancelPrompt(); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "sessionId": sessionID}, nil
	case acp.RegistryMethodSessionPermissionRespond:
		var req struct {
			SessionID    string `json:"sessionId"`
			PermissionID string `json:"permissionId"`
			OptionID     string `json:"optionId"`
		}
		if err := decodeSessionRequestPayload(payload, &req); err != nil {
			return nil, &acp.RegistryRequestError{Code: acp.CodeInvalidArgument, Message: "invalid session.permission.respond payload"}
		}
		sessionID := strings.TrimSpace(req.SessionID)
		if sessionID == "" || req.PermissionID == "" || req.OptionID == "" {
			return nil, &acp.RegistryRequestError{Code: acp.CodeInvalidArgument, Message: "sessionId, permissionId and optionId are required"}
		}
		c.mu.Lock()
		sess := c.sessions[sessionID]
		c.mu.Unlock()
		if sess == nil {
			return nil, &acp.RegistryRequestError{Code: acp.CodeNotFound, Message: "live permission session not found"}
		}
		result, err := sess.RespondPermission(ctx, req.PermissionID, req.OptionID)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"accepted":     true,
			"permissionId": req.PermissionID,
			"outcome":      result.Outcome,
			"optionId":     result.OptionID,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported session method: %s", method)
	}
}

func (c *Client) enrichLegacySessionForkPoints(ctx context.Context, sessionID string, latestTurnIndex int64, turns []sessionViewTurn) ([]sessionViewTurn, error) {
	if !sessionTurnsNeedForkPoint(turns) {
		return turns, nil
	}
	c.forkPointMu.Lock()
	cached, ok := c.forkPointCache[sessionID]
	c.forkPointMu.Unlock()
	if ok && cached.latestTurnIndex == latestTurnIndex {
		return applySessionForkPointsToTurns(turns, cached.points), nil
	}
	_, fullTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, sessionID, 0)
	if err != nil {
		return turns, err
	}
	prompts := sessionForkPromptsFromTurns(fullTurns)
	if len(prompts) == 0 {
		return turns, nil
	}
	sess, err := c.SessionByID(ctx, sessionID)
	if err != nil {
		return turns, err
	}
	points, err := sess.ResolveForkPoints(ctx, prompts)
	if err != nil {
		return turns, err
	}
	copied := cloneSessionForkPointMap(points)
	c.forkPointMu.Lock()
	c.forkPointCache[sessionID] = sessionForkPointCacheEntry{
		latestTurnIndex: latestTurnIndex,
		points:          copied,
	}
	c.forkPointMu.Unlock()
	return applySessionForkPointsToTurns(turns, copied), nil
}

func sessionTurnsNeedForkPoint(turns []sessionViewTurn) bool {
	for _, turn := range turns {
		var message acp.SessionTurnMessage
		if json.Unmarshal([]byte(turn.Content), &message) != nil || message.Method != acp.SessionTurnMethodPromptDone {
			continue
		}
		var result acp.SessionTurnPromptResult
		if json.Unmarshal(message.Param, &result) == nil && cloneSessionForkPoint(result.ForkPoint) == nil {
			return true
		}
	}
	return false
}

func sessionForkPromptsFromTurns(turns []sessionViewTurn) []acp.SessionForkPrompt {
	var pending []acp.ContentBlock
	out := make([]acp.SessionForkPrompt, 0)
	for _, turn := range turns {
		var message acp.SessionTurnMessage
		if json.Unmarshal([]byte(turn.Content), &message) != nil {
			continue
		}
		switch message.Method {
		case acp.SessionTurnMethodPromptRequest:
			var request acp.SessionTurnPromptRequest
			if json.Unmarshal(message.Param, &request) != nil {
				pending = nil
				continue
			}
			pending = cloneSessionContentBlocks(request.ContentBlocks)
		case acp.SessionUpdateUserMessageChunk:
			var userMessage acp.SessionTurnUserMessage
			if json.Unmarshal(message.Param, &userMessage) != nil || !userMessage.Steered || pending == nil {
				continue
			}
			pending = append(pending, cloneSessionContentBlocks(userMessage.ContentBlocks)...)
		case acp.SessionTurnMethodPromptDone:
			if pending == nil || turn.TurnIndex <= 0 {
				continue
			}
			out = append(out, acp.SessionForkPrompt{
				DoneTurnIndex: turn.TurnIndex,
				ContentBlocks: cloneSessionContentBlocks(pending),
			})
			pending = nil
		}
	}
	return out
}

func applySessionForkPointsToTurns(turns []sessionViewTurn, points map[int64]acp.SessionForkPoint) []sessionViewTurn {
	if len(points) == 0 {
		return turns
	}
	out := append([]sessionViewTurn(nil), turns...)
	for index := range out {
		point, ok := points[out[index].TurnIndex]
		if !ok || cloneSessionForkPoint(&point) == nil {
			continue
		}
		var envelope map[string]any
		if json.Unmarshal([]byte(out[index].Content), &envelope) != nil {
			continue
		}
		method, _ := envelope["method"].(string)
		param, _ := envelope["param"].(map[string]any)
		if method != acp.SessionTurnMethodPromptDone || param == nil {
			continue
		}
		if existing, exists := param["forkPoint"]; exists && existing != nil {
			continue
		}
		param["forkPoint"] = point
		raw, err := json.Marshal(envelope)
		if err != nil {
			continue
		}
		out[index].Content = string(raw)
	}
	return out
}

func cloneSessionForkPointMap(points map[int64]acp.SessionForkPoint) map[int64]acp.SessionForkPoint {
	out := make(map[int64]acp.SessionForkPoint, len(points))
	for turnIndex, point := range points {
		cloned := cloneSessionForkPoint(&point)
		if turnIndex > 0 && cloned != nil {
			out[turnIndex] = *cloned
		}
	}
	return out
}

func (c *Client) forkSessionAtTurn(ctx context.Context, sourceSessionID string, turnIndex int64) (any, error) {
	sourceSessionID = strings.TrimSpace(sourceSessionID)
	if sourceSessionID == "" || turnIndex <= 0 {
		return nil, fmt.Errorf("sessionId and positive turnIndex are required")
	}
	latestTurnIndex, sourceTurns, err := c.sessionRecorder.ReadSessionTurns(ctx, sourceSessionID, 0)
	if err != nil {
		return nil, err
	}
	if turnIndex > latestTurnIndex {
		return nil, fmt.Errorf("fork turn %d exceeds latest turn %d", turnIndex, latestTurnIndex)
	}
	sourceSummary, err := c.sessionRecorder.ReadSessionSummary(ctx, sourceSessionID)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(sourceSummary.AgentType, string(acp.ACPProviderCodex)) {
		return nil, fmt.Errorf("%w: fork", agent.ErrSessionActionUnsupported)
	}
	sourceTurns, err = c.enrichLegacySessionForkPoints(ctx, sourceSessionID, latestTurnIndex, sourceTurns)
	if err != nil {
		return nil, err
	}
	selectedPoint := sessionForkPointAtTurn(sourceTurns, turnIndex)
	if selectedPoint == nil {
		return nil, fmt.Errorf("fork point is not available for turn %d", turnIndex)
	}
	if !strings.EqualFold(selectedPoint.Provider, string(acp.ACPProviderCodex)) {
		return nil, fmt.Errorf("unsupported fork point provider: %s", selectedPoint.Provider)
	}
	prompts := mappedSessionForkPromptsThroughTurn(sourceTurns, turnIndex)
	if len(prompts) == 0 {
		return nil, fmt.Errorf("fork source prompts are not available")
	}
	sourceSession, err := c.SessionByID(ctx, sourceSessionID)
	if err != nil {
		return nil, err
	}
	forkResult, err := sourceSession.ForkSession(ctx, selectedPoint.Ref, prompts)
	if err != nil {
		return nil, err
	}
	targetSessionID := strings.TrimSpace(forkResult.SessionID)
	if targetSessionID == "" || targetSessionID == sourceSessionID {
		return nil, fmt.Errorf("provider returned invalid forked session id")
	}
	localTargetCreated := false
	cleanupTarget := func() {
		if localTargetCreated {
			_ = c.deleteActiveSession(context.Background(), targetSessionID, false)
		}
		_ = sourceSession.ArchiveForkTarget(context.Background(), targetSessionID)
	}
	existing, err := c.store.LoadSession(ctx, c.projectName, targetSessionID)
	if err != nil {
		_ = sourceSession.ArchiveForkTarget(context.Background(), targetSessionID)
		return nil, err
	}
	if existing != nil {
		cleanupTarget()
		return nil, fmt.Errorf("forked session already exists: %s", targetSessionID)
	}
	sourceRecord, err := c.store.LoadSession(ctx, c.projectName, sourceSessionID)
	if err != nil || sourceRecord == nil {
		cleanupTarget()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("source session not found: %s", sourceSessionID)
	}
	targetSession, err := c.newForkTargetSession(sourceSession, targetSessionID, forkResult.Title)
	if err != nil {
		cleanupTarget()
		return nil, err
	}
	localTargetCreated = true
	if err := targetSession.persistSession(ctx); err != nil {
		cleanupTarget()
		return nil, err
	}
	contents, err := c.buildForkHistoryContents(ctx, sourceSessionID, targetSessionID, turnIndex, sourceTurns, forkResult.ForkPoints)
	if err != nil {
		cleanupTarget()
		return nil, err
	}
	origin := acp.SessionForkOrigin{
		SessionID: sourceSessionID,
		TurnIndex: turnIndex,
		Title:     sessionForkOriginTitle(sourceRecord.Title),
	}
	now := time.Now().UTC()
	if err := c.sessionRecorder.InitializeForkedSession(ctx, targetSessionID, contents, sourceRecord.Title, origin, now); err != nil {
		cleanupTarget()
		return nil, err
	}
	if err := c.sessionRecorder.RecordSessionOperation(ctx, targetSessionID, acp.SessionOperationPayload{
		OperationID: uuid.NewString(),
		Type:        acp.SessionOperationTypeFork,
		Status:      acp.SessionOperationStatusCompleted,
		CompletedAt: now.Format(time.RFC3339),
		ForkedFrom:  &origin,
	}); err != nil {
		cleanupTarget()
		return nil, err
	}
	c.mu.Lock()
	c.sessions[targetSessionID] = targetSession
	c.mu.Unlock()
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, targetSessionID)
	if err != nil {
		cleanupTarget()
		return nil, err
	}
	summary.ConfigOptions = targetSession.CurrentConfigOptions()
	return map[string]any{"ok": true, "session": summary}, nil
}

func (c *Client) newForkTargetSession(source *Session, targetSessionID, providerTitle string) (*Session, error) {
	source.mu.Lock()
	agentType := source.agentType
	state := cloneSessionAgentState(&source.agentState)
	source.mu.Unlock()
	target, err := c.newWiredSession(targetSessionID, agentType)
	if err != nil {
		return nil, err
	}
	if state != nil {
		target.agentState = *state
	}
	if title := strings.TrimSpace(providerTitle); title != "" {
		target.agentState.Title = title
	}
	target.Status = SessionActive
	target.createdAt = time.Now()
	return target, nil
}

func mappedSessionForkPromptsThroughTurn(turns []sessionViewTurn, throughTurnIndex int64) []acp.SessionForkPrompt {
	all := sessionForkPromptsFromTurns(turns)
	out := make([]acp.SessionForkPrompt, 0, len(all))
	for _, prompt := range all {
		if prompt.DoneTurnIndex > throughTurnIndex || sessionForkPointAtTurn(turns, prompt.DoneTurnIndex) == nil {
			continue
		}
		out = append(out, prompt)
	}
	return out
}

func sessionForkPointAtTurn(turns []sessionViewTurn, turnIndex int64) *acp.SessionForkPoint {
	for _, turn := range turns {
		if turn.TurnIndex != turnIndex {
			continue
		}
		var message acp.SessionTurnMessage
		if json.Unmarshal([]byte(turn.Content), &message) != nil || message.Method != acp.SessionTurnMethodPromptDone {
			return nil
		}
		var result acp.SessionTurnPromptResult
		if json.Unmarshal(message.Param, &result) != nil {
			return nil
		}
		return cloneSessionForkPoint(result.ForkPoint)
	}
	return nil
}

func (c *Client) buildForkHistoryContents(
	ctx context.Context,
	sourceSessionID string,
	targetSessionID string,
	throughTurnIndex int64,
	sourceTurns []sessionViewTurn,
	targetForkPoints map[int64]acp.SessionForkPoint,
) ([]string, error) {
	contents := make([]string, 0, throughTurnIndex)
	for _, turn := range sourceTurns {
		if turn.TurnIndex > throughTurnIndex {
			break
		}
		if turn.TurnIndex != int64(len(contents)+1) {
			return nil, fmt.Errorf("fork source history has a gap at turn %d", turn.TurnIndex)
		}
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
			return nil, fmt.Errorf("decode fork source turn %d: %w", turn.TurnIndex, err)
		}
		content := turn.Content
		switch message.Method {
		case acp.SessionTurnMethodPromptRequest:
			var request acp.SessionTurnPromptRequest
			if err := json.Unmarshal(message.Param, &request); err != nil {
				return nil, fmt.Errorf("decode fork prompt request %d: %w", turn.TurnIndex, err)
			}
			for index := range request.ContentBlocks {
				block := &request.ContentBlocks[index]
				if !c.sessionURIWithinAttachmentRoot(sourceSessionID, block.URI) {
					continue
				}
				targetURI, err := c.copyForkAttachment(ctx, sourceSessionID, targetSessionID, block.URI)
				if err != nil {
					return nil, err
				}
				block.URI = targetURI
			}
			content = buildSessionTurnContentJSON(message.Method, request)
		case acp.SessionUpdateUserMessageChunk:
			var userMessage acp.SessionTurnUserMessage
			if err := json.Unmarshal(message.Param, &userMessage); err != nil {
				return nil, fmt.Errorf("decode fork user message %d: %w", turn.TurnIndex, err)
			}
			for index := range userMessage.ContentBlocks {
				block := &userMessage.ContentBlocks[index]
				if !c.sessionURIWithinAttachmentRoot(sourceSessionID, block.URI) {
					continue
				}
				targetURI, err := c.copyForkAttachment(ctx, sourceSessionID, targetSessionID, block.URI)
				if err != nil {
					return nil, err
				}
				block.URI = targetURI
			}
			content = buildSessionTurnContentJSON(message.Method, userMessage)
		case acp.SessionTurnMethodPromptDone:
			var result acp.SessionTurnPromptResult
			if err := json.Unmarshal(message.Param, &result); err != nil {
				return nil, fmt.Errorf("decode fork prompt done %d: %w", turn.TurnIndex, err)
			}
			if cloneSessionForkPoint(result.ForkPoint) != nil {
				targetPoint, ok := targetForkPoints[turn.TurnIndex]
				if !ok || cloneSessionForkPoint(&targetPoint) == nil {
					return nil, fmt.Errorf("target fork point is missing for turn %d", turn.TurnIndex)
				}
				result.ForkPoint = cloneSessionForkPoint(&targetPoint)
			}
			if len(result.Artifacts) > 0 {
				copiedArtifacts := make([]acp.SessionTurnPromptArtifact, 0, len(result.Artifacts))
				for _, artifact := range result.Artifacts {
					body, err := c.sessionRecorder.artifactStore.ReadArtifact(ctx, c.projectName, sourceSessionID, artifact.ArtifactID)
					if err != nil {
						return nil, err
					}
					copied, err := c.sessionRecorder.artifactStore.WriteDiffArtifact(ctx, c.projectName, targetSessionID, body.Content)
					if err != nil {
						return nil, err
					}
					copiedArtifacts = append(copiedArtifacts, copied)
				}
				result.Artifacts = copiedArtifacts
			}
			content = buildSessionTurnContentJSON(message.Method, result)
		}
		contents = append(contents, content)
	}
	if int64(len(contents)) != throughTurnIndex {
		return nil, fmt.Errorf("fork source history ended at %d, want %d", len(contents), throughTurnIndex)
	}
	return contents, nil
}

func (c *Client) sessionURIWithinAttachmentRoot(sessionID, uri string) bool {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return false
	}
	parsed, err := url.Parse(uri)
	if err != nil || !strings.EqualFold(parsed.Scheme, "file") {
		return false
	}
	root, err := c.sessionAttachmentRoot(sessionID)
	if err != nil {
		return false
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	pathAbs, err := filepath.Abs(attachmentFileURIPath(parsed))
	return err == nil && pathWithinRoot(rootAbs, pathAbs)
}

func sessionForkOriginTitle(rawTitle string) string {
	if facts, ok := sessionTitleFactsFromJSON(rawTitle); ok {
		return firstNonEmpty(facts.Manual, facts.First, facts.Last)
	}
	return strings.TrimSpace(rawTitle)
}

func (c *Client) sessionSupportsAction(sess *Session, action string) bool {
	if c == nil || c.registry == nil || sess == nil {
		return false
	}
	sess.mu.Lock()
	agentType := sess.agentType
	sess.mu.Unlock()
	provider, ok := acp.ParseACPProvider(agentType)
	if !ok {
		return false
	}
	support := c.registry.SessionActions(provider)
	switch strings.TrimSpace(action) {
	case acp.SessionActionStatus:
		return support.Status
	case acp.SessionActionCompact:
		return support.Compact
	default:
		return false
	}
}

func (c *Client) ReadSessionArtifact(ctx context.Context, sessionID string, artifactID string) (sessionArtifactReadResult, error) {
	sessionID = strings.TrimSpace(sessionID)
	artifactID = strings.TrimSpace(artifactID)
	if sessionID == "" {
		return sessionArtifactReadResult{}, fmt.Errorf("sessionId is required")
	}
	if artifactID == "" {
		return sessionArtifactReadResult{}, fmt.Errorf("artifactId is required")
	}
	if c == nil || c.sessionRecorder == nil || c.sessionRecorder.artifactStore == nil {
		return sessionArtifactReadResult{}, fmt.Errorf("session artifact store is required")
	}
	return c.sessionRecorder.artifactStore.ReadArtifact(ctx, c.projectName, sessionID, artifactID)
}

func (c *Client) listSessionViews(ctx context.Context) ([]sessionViewSummary, error) {
	return c.sessionRecorder.ListSessionViews(ctx)
}

func (c *Client) sessionConfigOptions(ctx context.Context, sessionID string) []acp.ConfigOption {
	sess, err := c.SessionByID(ctx, sessionID)
	if err != nil {
		return nil
	}
	options := sess.CurrentConfigOptions()
	if len(options) > 0 {
		return options
	}

	sess.mu.Lock()
	agentType := strings.TrimSpace(sess.agentType)
	sess.mu.Unlock()
	if agentType == "" {
		return options
	}

	preference := loadProjectAgentPreferenceState(c.store, c.projectName, agentType)
	if len(preference.ConfigOptions) == 0 {
		return options
	}
	fallback := make([]acp.ConfigOption, 0, len(preference.ConfigOptions))
	for _, pref := range preference.ConfigOptions {
		id := strings.TrimSpace(pref.ID)
		if id == "" {
			continue
		}
		fallback = append(fallback, acp.ConfigOption{
			ID:           id,
			CurrentValue: strings.TrimSpace(pref.CurrentValue),
		})
	}
	return fallback
}

// --- internal ---

// newWiredSession creates a Session with all Client back-references wired.
// Does NOT add it to c.sessions. Caller may hold c.mu.
func (c *Client) newWiredSession(id, agentType string) (*Session, error) {
	sess, err := newSession(id, c.cwd, agentType)
	if err != nil {
		return nil, err
	}
	c.wireSession(sess)
	return sess, nil
}

func (c *Client) wireSession(sess *Session) {
	sess.projectName = c.projectName
	sess.registry = c.registry
	sess.viewSink = c.viewSink
	sess.store = c.store
}

// clientListSessions returns a merged list of in-memory and persisted sessions,
// sorted by last active time (most recent first). Duplicates are deduplicated
// favoring in-memory sessions.
func (c *Client) ListSessions(ctx context.Context) ([]SessionRecord, error) {
	c.mu.Lock()
	memEntries := make([]SessionRecord, 0, len(c.sessions))
	memIDs := make(map[string]bool, len(c.sessions))
	for _, sess := range c.sessions {
		sess.mu.Lock()
		agentType := sess.agentType
		title := ""
		title = sess.agentState.Title
		e := SessionRecord{
			ID:           sess.acpSessionID,
			ProjectName:  c.projectName,
			AgentType:    agentType,
			Agent:        agentType,
			Title:        title,
			Status:       sess.Status,
			CreatedAt:    sess.createdAt,
			LastActiveAt: sess.lastActiveAt,
			InMemory:     true,
		}
		sess.mu.Unlock()
		memEntries = append(memEntries, e)
		memIDs[sess.acpSessionID] = true
	}
	store := c.store
	c.mu.Unlock()

	entries := memEntries

	stored, err := store.ListSessions(ctx, c.projectName)
	if err != nil {
		return nil, fmt.Errorf("list persisted sessions: %w", err)
	}
	storedByID := make(map[string]SessionRecord, len(stored))
	for _, s := range stored {
		storedByID[s.ID] = s
	}
	for i := range entries {
		storedEntry, ok := storedByID[entries[i].ID]
		if !ok {
			continue
		}
		if entries[i].Agent == "" {
			entries[i].Agent = storedEntry.Agent
		}
		if strings.TrimSpace(storedEntry.Title) != "" {
			entries[i].Title = storedEntry.Title
		}
		if strings.TrimSpace(storedEntry.AgentJSON) != "" {
			entries[i].AgentJSON = storedEntry.AgentJSON
		}
		if strings.TrimSpace(storedEntry.SessionSyncJSON) != "" {
			entries[i].SessionSyncJSON = storedEntry.SessionSyncJSON
		}
		if !storedEntry.LastActiveAt.IsZero() {
			entries[i].LastActiveAt = storedEntry.LastActiveAt
		}
	}
	for _, s := range stored {
		if memIDs[s.ID] {
			continue
		}
		s.InMemory = false
		s.Status = SessionPersisted
		entries = append(entries, s)
	}

	sort.Slice(entries, func(i, j int) bool {
		left := entries[i].LastActiveAt
		right := entries[j].LastActiveAt
		if left.Equal(right) {
			return entries[i].CreatedAt.After(entries[j].CreatedAt)
		}
		return left.After(right)
	})
	return entries, nil
}

func (c *Client) DeleteSession(ctx context.Context, sessionID string) error {
	return c.deleteActiveSession(ctx, sessionID, true)
}

func (c *Client) deleteActiveSession(ctx context.Context, sessionID string, rejectRunning bool) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	if rejectRunning && c.sessionIsRunning(sessionID) {
		return fmt.Errorf("session %s is running", sessionID)
	}

	c.mu.Lock()
	sess := c.sessions[sessionID]
	delete(c.sessions, sessionID)
	store := c.store
	c.mu.Unlock()

	agentType := ""
	if sess != nil {
		sess.mu.Lock()
		agentType = sess.agentType
		inst := sess.instance
		sess.instance = nil
		sess.initialized = false
		sess.ready = false
		sess.initializing = false
		sess.loading = false
		sess.Status = SessionSuspended
		sess.mu.Unlock()
		if inst != nil {
			_ = inst.Close()
		}
	}
	if agentType == "" && store != nil {
		rec, err := store.LoadSession(ctx, c.projectName, sessionID)
		if err != nil {
			hubLogger(c.projectName).Warn("load session before artifact cleanup failed session=%s err=%v", sessionID, err)
		} else if rec != nil {
			agentType = rec.AgentType
		}
	}
	if store != nil {
		if err := store.DeleteSession(ctx, c.projectName, sessionID); err != nil {
			return err
		}
	}
	if c.sessionRecorder != nil {
		if err := c.sessionRecorder.DeleteSessionData(ctx, sessionID); err != nil {
			return fmt.Errorf("delete session data: %w", err)
		}
	}
	if cleanupSessionArtifacts != nil {
		if err := cleanupSessionArtifacts(c.projectName, agentType, sessionID); err != nil {
			hubLogger(c.projectName).Warn("cleanup session artifacts failed agent=%s session=%s err=%v", agentType, sessionID, err)
		}
	}
	return nil
}

func (c *Client) ArchiveSession(ctx context.Context, sessionID string) error {
	_, err := c.archiveSession(ctx, sessionID)
	return err
}

func (c *Client) archiveSession(ctx context.Context, sessionID string) (string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return "", fmt.Errorf("session id is required")
	}
	if c.sessionIsRunning(sessionID) {
		return "", fmt.Errorf("session %s is running", sessionID)
	}

	rec, err := c.store.LoadSession(ctx, c.projectName, sessionID)
	if err != nil {
		return "", fmt.Errorf("load session: %w", err)
	}
	if rec == nil {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	latestTurnIndex := sessionSyncLatestPersistedTurnIndex(rec.SessionSyncJSON)
	if latestTurnIndex < 3 {
		return "", c.deleteActiveSession(ctx, sessionID, false)
	}
	if c.archiveStore == nil {
		return "", fmt.Errorf("session archive store is required")
	}
	alreadyArchived, err := c.archiveStore.HasSession(ctx, c.projectName, sessionID)
	if err != nil {
		return "", err
	}
	if alreadyArchived {
		if err := c.archiveStore.DeleteProjectArtifacts(ctx, c.projectName); err != nil {
			return "", err
		}
		return "", c.deleteActiveSession(ctx, sessionID, false)
	}
	contents, gapCount, err := c.sessionRecorder.ReadPersistedTurnContentsForArchive(ctx, sessionID, latestTurnIndex)
	if err != nil {
		return "", err
	}
	contents = sanitizeArchiveTurnContents(contents)
	if _, _, err := c.archiveStore.AppendSession(ctx, *rec, contents, gapCount); err != nil {
		return "", err
	}
	if err := c.archiveStore.DeleteProjectArtifacts(ctx, c.projectName); err != nil {
		return "", err
	}
	nativeUpdate := c.syncNativeArchiveState(ctx, rec.AgentType, sessionID, true)
	if nativeUpdate.NativeArchivedAt != "" || nativeUpdate.NativeSyncWarning != "" {
		if err := c.archiveStore.UpdateNativeSync(ctx, c.projectName, sessionID, nativeUpdate); err != nil {
			hubLogger(c.projectName).Warn("update native archive sync failed session=%s err=%v", sessionID, err)
		}
	}
	return nativeUpdate.NativeSyncWarning, c.deleteActiveSession(ctx, sessionID, false)
}

func (c *Client) ListArchivedSessions(ctx context.Context) (map[string]any, error) {
	if c.archiveStore == nil {
		return nil, fmt.Errorf("session archive store is required")
	}
	if err := c.archiveStore.DeleteProjectArtifacts(ctx, c.projectName); err != nil {
		return nil, err
	}
	entries, err := c.archiveStore.ListSessions(ctx, c.projectName)
	if err != nil {
		return nil, err
	}
	sessions := make([]sessionArchiveSummary, 0, len(entries))
	for _, entry := range entries {
		sessions = append(sessions, archiveSummaryFromEntry(entry))
	}
	return map[string]any{"sessions": sessions}, nil
}

func (c *Client) ReadArchivedSession(ctx context.Context, sessionID string) (map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	if c.archiveStore == nil {
		return nil, fmt.Errorf("session archive store is required")
	}
	if err := c.archiveStore.DeleteProjectArtifacts(ctx, c.projectName); err != nil {
		return nil, err
	}
	entry, contents, err := c.archiveStore.ReadSession(ctx, c.projectName, sessionID)
	if err != nil {
		return nil, err
	}
	turns := archiveTurnsFromContents(contents)
	return map[string]any{
		"sessionId":       sessionID,
		"session":         archiveSummaryFromEntry(entry),
		"turns":           turns,
		"messages":        []any{},
		"latestTurnIndex": int64(len(turns)),
		"readOnly":        true,
	}, nil
}

func (c *Client) RestoreArchivedSession(ctx context.Context, sessionID string) (map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	if c.archiveStore == nil {
		return nil, fmt.Errorf("session archive store is required")
	}
	if c.store == nil {
		return nil, fmt.Errorf("session store is required")
	}
	if c.sessionRecorder == nil || c.sessionRecorder.turnStore == nil {
		return nil, fmt.Errorf("session turn store is required")
	}
	if err := c.archiveStore.DeleteProjectArtifacts(ctx, c.projectName); err != nil {
		return nil, err
	}

	entry, contents, err := c.archiveStore.ReadSession(ctx, c.projectName, sessionID)
	if err != nil {
		return nil, err
	}
	existing, err := c.store.LoadSession(ctx, c.projectName, sessionID)
	if err != nil {
		return nil, fmt.Errorf("load session: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("session already exists: %s", sessionID)
	}
	if err := c.sessionRecorder.DeleteSessionData(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("reset restored session data: %w", err)
	}
	contents = discardSessionTurnArtifactsForArchiveContents(contents)
	if _, err := WriteSessionTurnFiles(ctx, c.sessionRecorder.turnStore.root, c.projectName, sessionID, 1, contents); err != nil {
		return nil, fmt.Errorf("restore session turns: %w", err)
	}

	createdAt := parseArchiveEntryTime(entry.CreatedAt, entry.ArchivedAt)
	updatedAt := parseArchiveEntryTime(entry.UpdatedAt, entry.ArchivedAt)
	rec := &SessionRecord{
		ID:          sessionID,
		ProjectName: c.projectName,
		Status:      SessionPersisted,
		AgentType:   normalizeAgentType(entry.AgentType),
		Title:       strings.TrimSpace(entry.Title),
		SessionSyncJSON: sessionSyncProjectionJSON(sessionSyncProjection{
			LatestPersistedTurnIndex: int64(len(contents)),
			ForkedFrom:               cloneSessionForkOrigin(entry.ForkedFrom),
		}),
		CreatedAt:    createdAt,
		LastActiveAt: updatedAt,
	}
	if err := c.store.SaveSession(ctx, rec); err != nil {
		_ = c.sessionRecorder.DeleteSessionData(context.Background(), sessionID)
		return nil, fmt.Errorf("save restored session: %w", err)
	}

	nativeUpdate := c.syncNativeArchiveState(ctx, entry.AgentType, sessionID, false)
	restoredAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := c.archiveStore.MarkRestored(ctx, c.projectName, sessionID, restoredAt, nativeUpdate); err != nil {
		_ = c.store.DeleteSession(context.Background(), c.projectName, sessionID)
		_ = c.sessionRecorder.DeleteSessionData(context.Background(), sessionID)
		return nil, fmt.Errorf("mark archive restored: %w", err)
	}
	summary, err := c.sessionRecorder.ReadSessionSummary(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	resp := map[string]any{"ok": true, "sessionId": sessionID, "session": summary}
	if nativeUpdate.NativeSyncWarning != "" {
		resp["warning"] = nativeUpdate.NativeSyncWarning
	}
	return resp, nil
}

func archiveSummaryFromEntry(entry sessionArchiveManifestEntry) sessionArchiveSummary {
	return sessionArchiveSummary{
		SessionID:          strings.TrimSpace(entry.SessionID),
		ProjectName:        strings.TrimSpace(entry.ProjectName),
		Title:              strings.TrimSpace(entry.Title),
		AgentType:          normalizeAgentType(entry.AgentType),
		CreatedAt:          strings.TrimSpace(entry.CreatedAt),
		UpdatedAt:          strings.TrimSpace(entry.UpdatedAt),
		ArchivedAt:         strings.TrimSpace(entry.ArchivedAt),
		RestoredAt:         strings.TrimSpace(entry.RestoredAt),
		TurnCount:          entry.TurnCount,
		GapCount:           entry.GapCount,
		NativeArchivedAt:   strings.TrimSpace(entry.NativeArchivedAt),
		NativeUnarchivedAt: strings.TrimSpace(entry.NativeUnarchivedAt),
		NativeSyncWarning:  strings.TrimSpace(entry.NativeSyncWarning),
		ForkedFrom:         cloneSessionForkOrigin(entry.ForkedFrom),
	}
}

func archiveTurnsFromContents(contents []string) []sessionViewTurn {
	turns := make([]sessionViewTurn, 0, len(contents))
	for index, content := range contents {
		turns = append(turns, sessionViewTurn{
			TurnIndex: int64(index + 1),
			Content:   discardSessionTurnArtifactsForArchive(content),
			Finished:  true,
		})
	}
	return turns
}

func discardSessionTurnArtifactsForArchiveContents(contents []string) []string {
	out := make([]string, 0, len(contents))
	for _, content := range contents {
		out = append(out, discardSessionTurnArtifactsForArchive(content))
	}
	return out
}

func parseArchiveEntryTime(values ...string) time.Time {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if parsed, err := time.Parse(time.RFC3339, value); err == nil {
			return parsed.UTC()
		}
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Now().UTC()
}

func (c *Client) syncNativeArchiveState(ctx context.Context, agentType, sessionID string, archived bool) sessionArchiveNativeSyncUpdate {
	update := sessionArchiveNativeSyncUpdate{}
	agentType = normalizeAgentType(agentType)
	sessionID = strings.TrimSpace(sessionID)
	if agentType == "" || sessionID == "" || c == nil || c.registry == nil {
		return update
	}
	if agentType != string(acp.ACPProviderCodex) {
		return update
	}
	creator := c.registry.CreatorByName(agentType)
	if creator == nil {
		return update
	}
	inst, err := creator(agent.WithProjectName(ctx, c.projectName), c.cwd)
	if err != nil {
		update.NativeSyncWarning = nativeArchiveWarning(archived, err)
		return update
	}
	defer func() { _ = inst.Close() }()

	clientCaps := acp.ClientCapabilities{
		FS: &acp.FSCapabilities{
			ReadTextFile:  true,
			WriteTextFile: true,
		},
		Terminal: true,
	}
	if _, err := inst.Initialize(ctx, acp.InitializeParams{
		ProtocolVersion:    acpClientProtocolVersion,
		ClientCapabilities: clientCaps,
		ClientInfo:         acpClientInfo,
	}); err != nil {
		update.NativeSyncWarning = nativeArchiveWarning(archived, err)
		return update
	}
	archiver, ok := inst.(agent.SessionArchiver)
	if !ok {
		return update
	}
	if archived {
		err = archiver.ArchiveSession(ctx, sessionID)
	} else {
		err = archiver.UnarchiveSession(ctx, sessionID)
	}
	if errors.Is(err, agent.ErrSessionArchiveUnsupported) {
		return update
	}
	if err != nil {
		update.NativeSyncWarning = nativeArchiveWarning(archived, err)
		return update
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if archived {
		update.NativeArchivedAt = now
	} else {
		update.NativeUnarchivedAt = now
	}
	return update
}

func nativeArchiveWarning(archived bool, err error) string {
	if err == nil {
		return ""
	}
	action := "archive"
	if !archived {
		action = "unarchive"
	}
	return fmt.Sprintf("native %s sync failed: %v", action, err)
}

func (c *Client) sessionIsRunning(sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}
	c.mu.Lock()
	sess := c.sessions[sessionID]
	c.mu.Unlock()
	if sess != nil && sess.isRunning() {
		return true
	}
	return c.sessionRecorder != nil && c.sessionRecorder.HasUnfinishedPrompt(sessionID)
}

func (c *Client) clientListSessions() ([]SessionRecord, error) {
	return c.ListSessions(context.Background())
}

// persistLoop periodically scans for Suspended sessions and evicts old ones from memory.
func (c *Client) persistLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-c.stopPersistCh:
			return
		case <-ticker.C:
			c.evictSuspendedSessions()
		}
	}
}

// evictSuspendedSessions finds Suspended sessions that have exceeded the
// suspend timeout, persists them to SQLite, and removes them from memory.
func (c *Client) evictSuspendedSessions() {
	c.mu.Lock()
	timeout := c.suspendTimeout

	var toEvict []*Session
	for _, sess := range c.sessions {
		sess.mu.Lock()
		if sess.Status == SessionSuspended && time.Since(sess.lastActiveAt) > timeout {
			toEvict = append(toEvict, sess)
		}
		sess.mu.Unlock()
	}
	c.mu.Unlock()

	for _, sess := range toEvict {
		if err := sess.persistSession(context.Background()); err != nil {
			hubLogger(c.projectName).Warn("persist session failed session=%s err=%v", sess.acpSessionID, err)
			continue
		}

		c.mu.Lock()
		sess.mu.Lock()
		sess.Status = SessionPersisted
		sess.mu.Unlock()

		delete(c.sessions, sess.acpSessionID)
		c.mu.Unlock()

		hubLogger(c.projectName).Info("evicted suspended session to sqlite session=%s", sess.acpSessionID)
	}
}

func decodeSessionRequestPayload(raw json.RawMessage, out any) error {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func formatConfigOptionUpdateMessage(raw []byte) string {
	if len(raw) == 0 {
		return "Config options updated."
	}
	var u acp.SessionUpdate
	var opts []acp.ConfigOption
	if err := json.Unmarshal(raw, &u); err == nil {
		opts = u.ConfigOptions
	}
	if len(opts) == 0 {
		return "Config options updated."
	}
	mode := ""
	model := ""
	for _, opt := range opts {
		if mode == "" && (opt.ID == acp.ConfigOptionIDMode || strings.EqualFold(opt.Category, acp.ConfigOptionCategoryMode)) {
			mode = strings.TrimSpace(opt.CurrentValue)
		}
		if model == "" && (opt.ID == acp.ConfigOptionIDModel || strings.EqualFold(opt.Category, acp.ConfigOptionCategoryModel)) {
			model = strings.TrimSpace(opt.CurrentValue)
		}
	}
	if mode == "" && model == "" {
		return "Config options updated."
	}
	return fmt.Sprintf("Config options updated: mode=%s model=%s", renderUnknown(mode), renderUnknown(model))
}
