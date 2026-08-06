package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// Callbacks defines business callback handlers owned by instance users.
type Callbacks interface {
	AgentEvent(event protocol.AgentEvent)
	SessionRequestPermission(ctx context.Context, requestID int64, params protocol.PermissionRequestParams) (protocol.PermissionResult, error)
}

// Instance is the only ACP-typed runtime interface exposed to Session.
type Instance interface {
	Name() string
	SetCallbacks(callbacks Callbacks)
	HandleACPRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error)
	HandleACPResponse(ctx context.Context, method string, params json.RawMessage)
	Initialize(ctx context.Context, p protocol.InitializeParams) (protocol.InitializeResult, error)
	SessionNew(ctx context.Context, p protocol.SessionNewParams) (protocol.SessionNewResult, error)
	SessionLoad(ctx context.Context, p protocol.SessionLoadParams) (protocol.SessionLoadResult, error)
	SessionList(ctx context.Context, p protocol.SessionListParams) (protocol.SessionListResult, error)
	SessionPrompt(ctx context.Context, p protocol.SessionPromptParams) (protocol.PromptOutcome, error)
	SessionCancel(acpSessionID string) error
	SessionSetConfigOption(ctx context.Context, p protocol.SessionSetConfigOptionParams) ([]protocol.ConfigOption, error)
	ListSkills(ctx context.Context, cwd string) ([]SkillDescriptor, error)
	Close() error
}

var ErrSessionArchiveUnsupported = errors.New("session archive unsupported")

var (
	ErrSessionActionUnsupported = errors.New("session action unsupported")
	ErrSessionBusy              = errors.New("session is busy")
	ErrSessionSteerInactive     = errors.New("session steer target is inactive")
	ErrSessionSteerUnavailable  = errors.New("session steer is unavailable")
	ErrSessionActionInvalid     = errors.New("session action invalid")
)

type SessionSteerResult struct {
	ProviderTurnID string
	Outcome        string
}

type SessionSteerer interface {
	SteerSession(
		ctx context.Context,
		sessionID string,
		clientMessageID string,
		blocks []protocol.ContentBlock,
	) (SessionSteerResult, error)
}

type SessionCompactResult struct {
	Err error
}

type SessionCompactor interface {
	CompactSession(ctx context.Context, sessionID string) (<-chan SessionCompactResult, error)
}

type SessionGoalController interface {
	SessionGoalSet(context.Context, protocol.SessionGoalSetParams) (protocol.SessionGoal, error)
	SessionGoalGet(context.Context, string) (*protocol.SessionGoal, error)
	SessionGoalClear(context.Context, string) error
}

func (i *instance) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []protocol.ContentBlock,
) (SessionSteerResult, error) {
	if err := i.ensureConn(); err != nil {
		return SessionSteerResult{}, err
	}
	if i.nativeSteeringSupported() {
		if len(blocks) == 0 {
			// Claude's native request requires at least one prompt block. Keep
			// the legacy WM path permissive, but never send an invalid standard
			// ACP request.
			return SessionSteerResult{}, ErrSessionActionInvalid
		}
		i.mu.Lock()
		if i.nativeSteer != nil {
			i.mu.Unlock()
			return SessionSteerResult{}, ErrSessionBusy
		}
		i.nativeSteer = &nativeSteerCorrelation{sessionID: sessionID, clientMessageID: clientMessageID}
		i.mu.Unlock()
		var out protocol.SessionSteeringResponse
		if err := i.conn.Send(ctx, protocol.MethodSessionSteering, protocol.SessionSteeringParams{
			SessionID: sessionID,
			Prompt:    blocks,
			Meta:      protocol.BuildWMSessionSteeringMeta(protocol.BuildSessionSteeringPromptRequiredMeta(nil), clientMessageID),
		}, &out); err != nil {
			i.clearNativeSteerCorrelation(sessionID, clientMessageID)
			return SessionSteerResult{}, err
		}
		switch out.Outcome {
		case protocol.SessionSteeringOutcomePromptRequired:
			i.clearNativeSteerCorrelation(sessionID, clientMessageID)
			return SessionSteerResult{}, ErrSessionSteerInactive
		case protocol.SessionSteeringOutcomeInjected, protocol.SessionSteeringOutcomeStartedNewTurn:
			return SessionSteerResult{ProviderTurnID: out.ProviderTurnID, Outcome: out.Outcome}, nil
		default:
			i.clearNativeSteerCorrelation(sessionID, clientMessageID)
			return SessionSteerResult{}, fmt.Errorf("%w: unknown steering outcome %q", ErrSessionSteerUnavailable, out.Outcome)
		}
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Steer }) {
		return SessionSteerResult{}, ErrSessionActionUnsupported
	}
	var out protocol.WMSessionSteerResult
	if err := i.conn.Send(ctx, protocol.MethodWMSessionSteer, protocol.WMSessionSteerParams{
		SessionID: sessionID, MessageID: clientMessageID, Prompt: blocks,
	}, &out); err != nil {
		return SessionSteerResult{}, classifyWMSessionActionError(err)
	}
	return SessionSteerResult{ProviderTurnID: out.TurnID, Outcome: protocol.SessionSteeringOutcomeInjected}, nil
}

type SessionForker interface {
	ResolveForkPoints(ctx context.Context, sessionID string, prompts []protocol.SessionForkPrompt) (map[int64]protocol.SessionForkPoint, error)
	ForkSession(ctx context.Context, sessionID string, lastTurnID string, prompts []protocol.SessionForkPrompt) (protocol.SessionForkResult, error)
}

// SessionCurrentForker is the standard ACP current-session fork facade. The
// cwd is explicit because session/fork requires it on Claude-compatible ACP.
type SessionCurrentForker interface {
	ForkCurrentSession(ctx context.Context, sessionID string, cwd string) (protocol.SessionForkResult, error)
}

// SessionForkWithCWDer is the standard ACP historical-fork adapter used by
// Codex. It keeps the old SessionForker interface available for legacy calls.
type SessionForkWithCWDer interface {
	ForkSessionWithCWD(ctx context.Context, sessionID string, cwd string, lastTurnID string, prompts []protocol.SessionForkPrompt) (protocol.SessionForkResult, error)
}

type SessionArchiver interface {
	ArchiveSession(ctx context.Context, sessionID string) error
	UnarchiveSession(ctx context.Context, sessionID string) error
}

type SessionDeleter interface {
	DeleteSession(ctx context.Context, sessionID string) error
}

type instance struct {
	name      string
	conn      Conn
	callbacks Callbacks
	tools     *instanceTools

	mu              sync.RWMutex
	dispatchMu      sync.Mutex
	acpSessionReady bool
	acpSessionID    string
	initResult      protocol.InitializeResult
	wmExtensions    protocol.WMNegotiatedExtensions
	nativeSteer     *nativeSteerCorrelation
	pendingEvents   []protocol.AgentEvent
	closed          bool
}

type nativeSteerCorrelation struct {
	sessionID       string
	clientMessageID string
}

var _ Instance = (*instance)(nil)

// NewInstance creates an agent instance and wires conn inbound routing.
func NewInstance(name string, conn Conn) Instance {
	inst := &instance{
		name:  strings.TrimSpace(name),
		conn:  conn,
		tools: newInstanceTools(),
	}
	if conn != nil {
		conn.OnACPRequest(inst.HandleACPRequest)
		conn.OnACPResponse(inst.HandleACPResponse)
	}
	return inst
}

func (i *instance) Name() string { return i.name }

func (i *instance) ListSkills(ctx context.Context, cwd string) ([]SkillDescriptor, error) {
	_ = ctx
	preset, ok := providerPresetByName(i.name)
	if !ok {
		return nil, fmt.Errorf("skills: unknown provider %q", i.name)
	}
	return listSkillsForPreset(ctx, preset, cwd)
}

// Alive reports whether the underlying ACP connection appears alive.
func (i *instance) Alive() bool {
	if i == nil || i.conn == nil {
		return false
	}
	if probe, ok := i.conn.(interface{ Alive() bool }); ok {
		return probe.Alive()
	}
	return true
}

func (i *instance) SetCallbacks(callbacks Callbacks) {
	i.dispatchMu.Lock()
	defer i.dispatchMu.Unlock()
	i.mu.Lock()
	i.callbacks = callbacks
	pending := append([]protocol.AgentEvent(nil), i.pendingEvents...)
	i.pendingEvents = nil
	i.mu.Unlock()
	if callbacks == nil {
		return
	}
	for _, event := range pending {
		callbacks.AgentEvent(event)
	}
}

func (i *instance) Initialize(ctx context.Context, p protocol.InitializeParams) (protocol.InitializeResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.InitializeResult{}, err
	}

	var out protocol.InitializeResult
	if err := i.conn.Send(ctx, protocol.MethodInitialize, p, &out); err != nil {
		return protocol.InitializeResult{}, err
	}

	i.mu.Lock()
	i.initResult = out
	i.wmExtensions = protocol.NegotiateWMExtensions(p.ClientCapabilities.Meta, out.AgentCapabilities.Meta)
	i.nativeSteer = nil
	i.mu.Unlock()
	return out, nil
}

func (i *instance) SessionNew(ctx context.Context, p protocol.SessionNewParams) (protocol.SessionNewResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionNewResult{}, err
	}

	var out protocol.SessionNewResult
	if err := i.conn.Send(ctx, protocol.MethodSessionNew, p, &out); err != nil {
		return protocol.SessionNewResult{}, err
	}

	if sid := strings.TrimSpace(out.SessionID); sid != "" {
		if binder, ok := i.conn.(sessionBinder); ok {
			binder.BindSessionID(sid)
		}
		i.mu.Lock()
		i.acpSessionID = sid
		i.acpSessionReady = true
		i.mu.Unlock()
	}
	return out, nil
}

func (i *instance) SessionLoad(ctx context.Context, p protocol.SessionLoadParams) (protocol.SessionLoadResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionLoadResult{}, err
	}
	if strings.TrimSpace(p.SessionID) == "" {
		return protocol.SessionLoadResult{}, errors.New("acp session id is required")
	}

	var out protocol.SessionLoadResult
	if err := i.conn.Send(ctx, protocol.MethodSessionLoad, p, &out); err != nil {
		return protocol.SessionLoadResult{}, err
	}

	if binder, ok := i.conn.(sessionBinder); ok {
		binder.BindSessionID(p.SessionID)
	}
	i.mu.Lock()
	i.acpSessionID = p.SessionID
	i.acpSessionReady = true
	i.mu.Unlock()
	return out, nil
}

func (i *instance) SessionList(ctx context.Context, p protocol.SessionListParams) (protocol.SessionListResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionListResult{}, err
	}
	var out protocol.SessionListResult
	if err := i.conn.Send(ctx, protocol.MethodSessionList, p, &out); err != nil {
		return protocol.SessionListResult{}, err
	}
	return out, nil
}

func (i *instance) SessionPrompt(ctx context.Context, p protocol.SessionPromptParams) (protocol.PromptOutcome, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.PromptOutcome{}, err
	}

	if strings.TrimSpace(p.SessionID) == "" {
		i.mu.RLock()
		sid := i.acpSessionID
		ready := i.acpSessionReady
		i.mu.RUnlock()
		if !ready || strings.TrimSpace(sid) == "" {
			return protocol.PromptOutcome{}, errors.New("acp session is not ready")
		}
		p.SessionID = sid
	}

	var out protocol.PromptOutcome
	if err := i.conn.Send(ctx, protocol.MethodSessionPrompt, p, &out); err != nil {
		return protocol.PromptOutcome{}, err
	}
	if out.Err != nil {
		return protocol.PromptOutcome{}, out.Err
	}
	if !protocol.IsACPStopReason(out.StopReason) {
		return protocol.PromptOutcome{}, fmt.Errorf("unsupported ACP stopReason %q", out.StopReason)
	}
	out.Message = firstNonEmptyString(out.Message, protocol.WMPromptResultMetaMessage(out.Meta))
	return out, nil
}

func (i *instance) SessionCancel(acpSessionID string) error {
	if err := i.ensureConn(); err != nil {
		return err
	}
	sid := strings.TrimSpace(acpSessionID)
	if sid == "" {
		i.mu.RLock()
		sid = strings.TrimSpace(i.acpSessionID)
		i.mu.RUnlock()
	}
	if sid == "" {
		return errors.New("acp session id is required")
	}
	return i.conn.Notify(protocol.MethodSessionCancel, protocol.SessionCancelParams{SessionID: sid})
}

func (i *instance) SessionSetConfigOption(ctx context.Context, p protocol.SessionSetConfigOptionParams) ([]protocol.ConfigOption, error) {
	if err := i.ensureConn(); err != nil {
		return nil, err
	}

	request := protocol.SetSessionConfigOptionRequest{
		SessionID: p.SessionID,
		ConfigID:  p.ConfigID,
		Variant:   protocol.SetSessionConfigValueID{Type: "value_id", Value: p.Value},
		Meta:      protocol.CloneSessionUpdateMeta(p.Meta),
	}
	var response protocol.SetSessionConfigOptionResponse
	if err := i.conn.Send(ctx, protocol.MethodSetConfigOption, request, &response); err != nil {
		return nil, err
	}
	return protocol.NormalizeSessionConfigOptions(response.ConfigOptions)
}

func (i *instance) ArchiveSession(ctx context.Context, sessionID string) error {
	if err := i.ensureConn(); err != nil {
		return err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Archive }) {
		return ErrSessionArchiveUnsupported
	}
	var out protocol.WMSessionOKResult
	err := classifyWMSessionActionError(i.conn.Send(ctx, protocol.MethodWMSessionArchive, protocol.WMSessionArchiveParams{SessionID: sessionID, Archived: true}, &out))
	if errors.Is(err, ErrSessionActionUnsupported) {
		return ErrSessionArchiveUnsupported
	}
	return err
}

func (i *instance) DeleteSession(ctx context.Context, sessionID string) error {
	if err := i.ensureConn(); err != nil {
		return err
	}
	i.mu.RLock()
	capabilities := i.initResult.AgentCapabilities.SessionCapabilities
	i.mu.RUnlock()
	if capabilities == nil || capabilities.Delete == nil {
		return ErrSessionActionUnsupported
	}
	var out protocol.SessionDeleteResult
	return i.conn.Send(ctx, protocol.MethodSessionDelete, protocol.SessionDeleteParams{SessionID: sessionID}, &out)
}

func (i *instance) UnarchiveSession(ctx context.Context, sessionID string) error {
	if err := i.ensureConn(); err != nil {
		return err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Archive }) {
		return ErrSessionArchiveUnsupported
	}
	var out protocol.WMSessionOKResult
	err := classifyWMSessionActionError(i.conn.Send(ctx, protocol.MethodWMSessionArchive, protocol.WMSessionArchiveParams{SessionID: sessionID, Archived: false}, &out))
	if errors.Is(err, ErrSessionActionUnsupported) {
		return ErrSessionArchiveUnsupported
	}
	return err
}

func (i *instance) CompactSession(ctx context.Context, sessionID string) (<-chan SessionCompactResult, error) {
	if err := i.ensureConn(); err != nil {
		return nil, err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Compact }) {
		return nil, ErrSessionActionUnsupported
	}
	done := make(chan SessionCompactResult, 1)
	go func() {
		var out protocol.WMSessionCompactResult
		err := classifyWMSessionActionError(i.conn.Send(ctx, protocol.MethodWMSessionCompact, protocol.WMSessionCompactParams{SessionID: sessionID}, &out))
		done <- SessionCompactResult{Err: err}
		close(done)
	}()
	return done, nil
}

func (i *instance) SessionGoalSet(ctx context.Context, params protocol.SessionGoalSetParams) (protocol.SessionGoal, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionGoal{}, err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Goal }) {
		return protocol.SessionGoal{}, ErrSessionActionUnsupported
	}
	var out protocol.WMSessionGoalResult
	err := i.conn.Send(ctx, protocol.MethodWMSessionGoalSet, protocol.WMSessionGoalSetParams{
		SessionID: params.SessionID, Objective: params.Objective, Status: params.Status, TokenBudget: params.TokenBudget,
	}, &out)
	if err != nil {
		return protocol.SessionGoal{}, classifyWMSessionActionError(err)
	}
	if out.Goal == nil {
		return protocol.SessionGoal{}, errors.New("Goal set returned no snapshot")
	}
	return *out.Goal, nil
}

func (i *instance) SessionGoalGet(ctx context.Context, sessionID string) (*protocol.SessionGoal, error) {
	if err := i.ensureConn(); err != nil {
		return nil, err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Goal }) {
		return nil, ErrSessionActionUnsupported
	}
	var out protocol.WMSessionGoalResult
	if err := i.conn.Send(ctx, protocol.MethodWMSessionGoalGet, protocol.WMSessionGoalParams{SessionID: sessionID}, &out); err != nil {
		return nil, classifyWMSessionActionError(err)
	}
	return out.Goal, nil
}

func (i *instance) SessionGoalClear(ctx context.Context, sessionID string) error {
	if err := i.ensureConn(); err != nil {
		return err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Goal }) {
		return ErrSessionActionUnsupported
	}
	var out protocol.WMSessionOKResult
	return classifyWMSessionActionError(i.conn.Send(ctx, protocol.MethodWMSessionGoalClear, protocol.WMSessionGoalParams{SessionID: sessionID}, &out))
}

func (i *instance) ResolveForkPoints(ctx context.Context, sessionID string, prompts []protocol.SessionForkPrompt) (map[int64]protocol.SessionForkPoint, error) {
	if err := i.ensureConn(); err != nil {
		return nil, err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Fork }) {
		return nil, ErrSessionActionUnsupported
	}
	var out protocol.WMSessionForkResolveResult
	if err := i.conn.Send(ctx, protocol.MethodWMSessionForkResolve, protocol.WMSessionForkResolveParams{SessionID: sessionID, Prompts: prompts}, &out); err != nil {
		return nil, classifyWMSessionActionError(err)
	}
	return out.ForkPoints, nil
}

func (i *instance) ForkSession(ctx context.Context, sessionID string, lastTurnID string, prompts []protocol.SessionForkPrompt) (protocol.SessionForkResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionForkResult{}, err
	}
	if !i.wmActionSupported(func(actions protocol.WMSessionActionCapabilities) bool { return actions.Fork }) {
		return protocol.SessionForkResult{}, ErrSessionActionUnsupported
	}
	var out protocol.WMSessionForkResult
	if err := i.conn.Send(ctx, protocol.MethodWMSessionFork, protocol.WMSessionForkParams{SessionID: sessionID, Ref: lastTurnID, Prompts: prompts}, &out); err != nil {
		return protocol.SessionForkResult{}, classifyWMSessionActionError(err)
	}
	return protocol.SessionForkResult{SessionID: out.SessionID, Title: out.Title, ForkPoints: out.ForkPoints}, nil
}

func (i *instance) ForkCurrentSession(ctx context.Context, sessionID string, cwd string) (protocol.SessionForkResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionForkResult{}, err
	}
	if !i.standardForkSupported() {
		return protocol.SessionForkResult{}, ErrSessionActionUnsupported
	}
	if strings.TrimSpace(cwd) == "" {
		return protocol.SessionForkResult{}, ErrSessionActionInvalid
	}
	var out protocol.SessionForkResponse
	if err := i.conn.Send(ctx, protocol.MethodSessionFork, protocol.SessionForkParams{
		SessionID: sessionID,
		CWD:       cwd,
	}, &out); err != nil {
		return protocol.SessionForkResult{}, err
	}
	return protocol.SessionForkResult{
		SessionID:     out.SessionID,
		ConfigOptions: append([]protocol.ConfigOption(nil), out.ConfigOptions...),
	}, nil
}

func (i *instance) ForkSessionWithCWD(ctx context.Context, sessionID string, cwd string, lastTurnID string, prompts []protocol.SessionForkPrompt) (protocol.SessionForkResult, error) {
	if err := i.ensureConn(); err != nil {
		return protocol.SessionForkResult{}, err
	}
	if !i.standardForkSupported() {
		return i.ForkSession(ctx, sessionID, lastTurnID, prompts)
	}
	if strings.TrimSpace(cwd) == "" || strings.TrimSpace(lastTurnID) == "" {
		return protocol.SessionForkResult{}, ErrSessionActionInvalid
	}
	var out protocol.SessionForkResponse
	meta := protocol.BuildWMSessionForkMeta(nil, protocol.WMSessionForkExtension{
		Ref:     lastTurnID,
		Prompts: prompts,
	})
	if err := i.conn.Send(ctx, protocol.MethodSessionFork, protocol.SessionForkParams{
		SessionID: sessionID,
		CWD:       cwd,
		Meta:      meta,
	}, &out); err != nil {
		return protocol.SessionForkResult{}, err
	}
	return protocol.SessionForkResult{
		SessionID:     out.SessionID,
		ConfigOptions: append([]protocol.ConfigOption(nil), out.ConfigOptions...),
	}, nil
}

func (i *instance) nativeSteeringSupported() bool {
	i.mu.RLock()
	meta := i.initResult.Meta
	i.mu.RUnlock()
	return protocol.InitializeSteeringSupported(meta)
}

func (i *instance) standardForkSupported() bool {
	i.mu.RLock()
	capabilities := i.initResult.AgentCapabilities.SessionCapabilities
	i.mu.RUnlock()
	return capabilities != nil && capabilities.Fork != nil
}

func (i *instance) wmActionSupported(supported func(protocol.WMSessionActionCapabilities) bool) bool {
	i.mu.RLock()
	actions := i.wmExtensions.SessionActions
	i.mu.RUnlock()
	return actions.Version == protocol.WMExtensionVersion && supported(actions)
}

func classifyWMSessionActionError(err error) error {
	if err == nil {
		return nil
	}
	code, ok := protocol.WMActionErrorCode(err)
	if !ok {
		return err
	}
	var classified error
	switch code {
	case protocol.WMActionErrorInactive:
		classified = ErrSessionSteerInactive
	case protocol.WMActionErrorBusy:
		classified = ErrSessionBusy
	case protocol.WMActionErrorUnavailable:
		classified = ErrSessionSteerUnavailable
	case protocol.WMActionErrorUnsupported:
		classified = ErrSessionActionUnsupported
	case protocol.WMActionErrorInvalid:
		classified = ErrSessionActionInvalid
	}
	if classified == nil {
		return err
	}
	return fmt.Errorf("%w: %v", classified, err)
}

func (i *instance) HandleACPResponse(_ context.Context, method string, params json.RawMessage) {
	if method == protocol.MethodSessionUpdate {
		wire, err := protocol.DecodeSessionUpdateParams(params)
		if err != nil {
			return
		}
		event, err := protocol.ProjectSessionUpdate(wire, time.Now().UTC())
		if err != nil {
			return
		}
		if message, ok := event.Update.(protocol.AgentMessageEvent); ok && message.Kind == protocol.SessionUpdateUserMessageChunk && strings.TrimSpace(message.MessageID) != "" {
			i.mu.Lock()
			correlation := i.nativeSteer
			if correlation != nil && strings.TrimSpace(correlation.sessionID) == strings.TrimSpace(event.SessionID) {
				// ACP steering responses do not carry a request-to-message
				// identifier. A provider messageId is therefore the minimum
				// evidence that this is the injected user echo; never consume
				// the pending correlation on an unidentifiable chunk.
				i.nativeSteer = nil
				message.ClientMessageID = correlation.clientMessageID
				message.Steered = true
				event.Update = message
			}
			i.mu.Unlock()
		}
		i.mu.RLock()
		event.MessageLifecycle = i.wmExtensions.MessageLifecycle
		i.mu.RUnlock()
		i.dispatchAgentEvent(event)
		return
	}
	if method == protocol.MethodWMSessionGoal {
		i.mu.RLock()
		supported := i.wmExtensions.GoalLifecycle
		i.mu.RUnlock()
		if !supported {
			return
		}
		notification, err := protocol.DecodeWMGoalNotification(params)
		if err != nil {
			var diagnostic struct {
				SessionID string `json:"sessionId"`
			}
			_ = json.Unmarshal(params, &diagnostic)
			agentLogger().Warn("ignore invalid Goal notification session=%s err=%v", strings.TrimSpace(diagnostic.SessionID), err)
			return
		}
		i.dispatchAgentEvent(protocol.AgentEvent{
			SessionID: notification.SessionID,
			Update: protocol.AgentGoalEvent{
				Event: notification.Event, Goal: notification.Goal, TurnID: notification.TurnID,
				Meta: protocol.CloneSessionUpdateMeta(notification.Meta), ReceivedAt: time.Now().UTC(),
			},
		})
	}
}

func (i *instance) clearNativeSteerCorrelation(sessionID, clientMessageID string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.nativeSteer == nil {
		return
	}
	if strings.TrimSpace(i.nativeSteer.sessionID) == strings.TrimSpace(sessionID) &&
		strings.TrimSpace(i.nativeSteer.clientMessageID) == strings.TrimSpace(clientMessageID) {
		i.nativeSteer = nil
	}
}

const maxPendingAgentEvents = 256

func (i *instance) dispatchAgentEvent(event protocol.AgentEvent) {
	i.dispatchMu.Lock()
	defer i.dispatchMu.Unlock()
	i.mu.Lock()
	if i.closed {
		i.mu.Unlock()
		return
	}
	callbacks := i.callbacks
	if callbacks == nil {
		if len(i.pendingEvents) == maxPendingAgentEvents {
			copy(i.pendingEvents, i.pendingEvents[1:])
			i.pendingEvents[len(i.pendingEvents)-1] = event
		} else {
			i.pendingEvents = append(i.pendingEvents, event)
		}
		i.mu.Unlock()
		return
	}
	i.mu.Unlock()
	callbacks.AgentEvent(event)
}

func (i *instance) HandleACPRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error) {
	switch method {
	case protocol.MethodRequestPermission:
		return i.onPermissionRequest(ctx, requestID, method, params)
	case protocol.MethodFSRead:
		var p protocol.FSReadTextFileParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return i.tools.FSRead(p)
	case protocol.MethodFSWrite:
		var p protocol.FSWriteTextFileParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return nil, i.tools.FSWrite(p)
	case protocol.MethodTerminalCreate:
		var p protocol.TerminalCreateParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return i.tools.TerminalCreate(p)
	case protocol.MethodTerminalOutput:
		var p protocol.TerminalOutputParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return i.tools.TerminalOutput(p)
	case protocol.MethodTerminalWaitExit:
		var p protocol.TerminalWaitForExitParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return i.tools.TerminalWaitForExit(p)
	case protocol.MethodTerminalKill:
		var p protocol.TerminalKillParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return nil, i.tools.TerminalKill(p)
	case protocol.MethodTerminalRelease:
		var p protocol.TerminalReleaseParams
		if err := decodeACPParams(method, params, &p); err != nil {
			return nil, err
		}
		return nil, i.tools.TerminalRelease(p)
	default:
		return nil, fmt.Errorf("unsupported method: %s", method)
	}
}

func (i *instance) Close() error {
	i.dispatchMu.Lock()
	i.mu.Lock()
	i.closed = true
	i.pendingEvents = nil
	i.callbacks = nil
	i.nativeSteer = nil
	i.mu.Unlock()
	i.dispatchMu.Unlock()
	if i.tools != nil {
		i.tools.Close()
	}
	if i.conn == nil {
		return nil
	}
	return i.conn.Close()
}

func (i *instance) ensureConn() error {
	if i.conn == nil {
		return errors.New("agent instance: conn is nil")
	}
	return nil
}

func (i *instance) onPermissionRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error) {
	cb := i.currentCallbacks()
	if cb == nil {
		return protocol.PermissionResponse{Outcome: protocol.PermissionResult{Outcome: "cancelled"}}, nil
	}
	var p protocol.PermissionRequestParams
	if err := decodeACPParams(method, params, &p); err != nil {
		return nil, err
	}
	result, err := cb.SessionRequestPermission(ctx, requestID, p)
	if err != nil {
		return nil, err
	}
	return protocol.PermissionResponse{Outcome: result}, nil
}

func (i *instance) currentCallbacks() Callbacks {
	i.mu.RLock()
	cb := i.callbacks
	i.mu.RUnlock()
	return cb
}

func decodeACPParams(method string, params json.RawMessage, out any) error {
	if err := protocol.DecodeACPJSON(params, out); err != nil {
		return fmt.Errorf("%s: unmarshal: %w", method, err)
	}
	return nil
}
