package protocol

import (
	"encoding/json"
	"strings"
)

// Session action names are provider-neutral capabilities exposed in session summaries.
const (
	SessionActionStatus  = "status"
	SessionActionCompact = "compact"
	SessionActionSteer   = "steer"
	SessionActionFork    = "fork"
	SessionActionGoal    = "goal"

	SessionOperationTypeCompact = "compact"
	SessionOperationTypeFork    = "fork"

	SessionOperationStatusQueued    = "queued"
	SessionOperationStatusStarted   = "started"
	SessionOperationStatusCompleted = "completed"
	SessionOperationStatusFailed    = "failed"

	SessionTurnMethodOperation = "session_operation"

	SessionSteerOutcomeSteered = "steered"
	SessionSteerOutcomeSent    = "sent"

	SessionGoalStatusActive        = "active"
	SessionGoalStatusPaused        = "paused"
	SessionGoalStatusBlocked       = "blocked"
	SessionGoalStatusUsageLimited  = "usageLimited"
	SessionGoalStatusBudgetLimited = "budgetLimited"
	SessionGoalStatusComplete      = "complete"
)

type SessionForkPoint struct {
	Provider string `json:"provider"`
	Ref      string `json:"ref"`
}

type SessionForkPrompt struct {
	DoneTurnIndex int64          `json:"doneTurnIndex"`
	ContentBlocks []ContentBlock `json:"contentBlocks"`
}

type SessionForkResult struct {
	SessionID     string
	Title         string
	ForkPoints    map[int64]SessionForkPoint
	ConfigOptions []ConfigOption
}

type SessionForkOrigin struct {
	SessionID string `json:"sessionId"`
	TurnIndex int64  `json:"turnIndex"`
	Title     string `json:"title,omitempty"`
}

type SessionActionCapability struct {
	Supported      bool   `json:"supported"`
	Reason         string `json:"reason,omitempty"`
	CurrentSession bool   `json:"currentSession,omitempty"`
	HistoricalTurn bool   `json:"historicalTurn,omitempty"`
}

type SessionActionCapabilities struct {
	Status  SessionActionCapability `json:"status"`
	Compact SessionActionCapability `json:"compact"`
	Steer   SessionActionCapability `json:"steer"`
	Fork    SessionActionCapability `json:"fork"`
	Goal    SessionActionCapability `json:"goal"`
}

type SessionFeatureVersion struct {
	Version int `json:"version"`
}

type SessionFeatures struct {
	MessageLifecycle *SessionFeatureVersion `json:"messageLifecycle,omitempty"`
}

// SessionCapabilityState is the complete capability snapshot persisted for a
// session. AgentCapabilities contains standard ACP capabilities, while
// InitializeMeta contains top-level initialize metadata such as Claude's
// steering declaration. WMActions is retained as a derived field so callers
// loading an old snapshot do not need to renegotiate private extensions.
type SessionCapabilityState struct {
	AgentCapabilities AgentCapabilities
	InitializeMeta    json.RawMessage
	Commands          []AvailableCommand
	WMActions         WMSessionActionCapabilities
}

func SessionFeaturesFromAgentCapabilities(capabilities AgentCapabilities) *SessionFeatures {
	negotiated := NegotiateWMExtensions(BuildWMClientCapabilitiesMeta(nil), capabilities.Meta)
	if !negotiated.MessageLifecycle {
		return nil
	}
	return &SessionFeatures{MessageLifecycle: &SessionFeatureVersion{Version: WMExtensionVersion}}
}

// SessionActionsFromAgentCapabilities projects only capabilities negotiated
// through the WheelMaker ACP extension. Status is implemented locally by the
// Hub and therefore does not require an Agent extension.
func SessionActionsFromAgentCapabilities(capabilities AgentCapabilities) SessionActionCapabilities {
	return SessionActionsFromState(SessionCapabilityState{AgentCapabilities: capabilities})
}

// SessionActionsFromState projects standard ACP capabilities and negotiated
// WheelMaker capabilities into the product-neutral session action contract.
func SessionActionsFromState(state SessionCapabilityState) SessionActionCapabilities {
	const unsupported = "Current Agent does not support this action."
	negotiated := NegotiateWMExtensions(BuildWMClientCapabilitiesMeta(nil), state.AgentCapabilities.Meta)
	actions := state.WMActions
	if actions.Version == 0 {
		actions = negotiated.SessionActions
	}
	capability := func(supported bool, current, historical bool) SessionActionCapability {
		if supported {
			return SessionActionCapability{Supported: true, CurrentSession: current, HistoricalTurn: historical}
		}
		return SessionActionCapability{Reason: unsupported}
	}
	standardFork := state.AgentCapabilities.SessionCapabilities != nil && state.AgentCapabilities.SessionCapabilities.Fork != nil
	nativeSteering := InitializeSteeringSupported(state.InitializeMeta)
	_, commandCompact := SessionCompactCommand(state.Commands)
	currentFork := standardFork && state.AgentCapabilities.LoadSession
	historicalFork := actions.Fork || actions.HistoricalTurn
	return SessionActionCapabilities{
		Status:  SessionActionCapability{Supported: true},
		Compact: capability(actions.Compact || commandCompact, false, false),
		Steer:   capability(actions.Steer || nativeSteering, false, false),
		Fork:    capability(currentFork || historicalFork, currentFork, historicalFork),
		Goal:    capability(actions.Goal, false, false),
	}
}

// SessionCompactCommand returns the provider command used to compact context.
// ACP advertises command names both with and without the leading slash.
func SessionCompactCommand(commands []AvailableCommand) (string, bool) {
	for _, command := range commands {
		name := strings.TrimSpace(command.Name)
		if strings.EqualFold(strings.TrimPrefix(name, "/"), SessionActionCompact) {
			return "/" + strings.TrimPrefix(name, "/"), true
		}
	}
	return "", false
}

func InitializeSteeringSupported(meta json.RawMessage) bool {
	var envelope struct {
		Steering struct {
			Supported bool `json:"supported"`
		} `json:"steering"`
	}
	return json.Unmarshal(meta, &envelope) == nil && envelope.Steering.Supported
}

type SessionGoal struct {
	SessionID       string `json:"sessionId"`
	Objective       string `json:"objective"`
	Status          string `json:"status"`
	TokenBudget     *int64 `json:"tokenBudget"`
	TokensUsed      int64  `json:"tokensUsed"`
	TimeUsedSeconds int64  `json:"timeUsedSeconds"`
	CreatedAt       int64  `json:"createdAt"`
	UpdatedAt       int64  `json:"updatedAt"`
}

// OptionalInt64 preserves the difference between an omitted patch field and
// an explicit JSON null.
type OptionalInt64 struct {
	Present bool
	Value   *int64
}

type SessionGoalSetParams struct {
	SessionID   string
	Objective   *string
	Status      *string
	TokenBudget OptionalInt64
}

type SessionActionStatusContext struct {
	Used      int64  `json:"used"`
	Size      *int64 `json:"size,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type SessionActionRateLimit struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	UsedPercent        int    `json:"usedPercent"`
	RemainingPercent   int    `json:"remainingPercent"`
	WindowDurationMins *int64 `json:"windowDurationMins,omitempty"`
	ResetsAt           string `json:"resetsAt,omitempty"`
}

type SessionActionCredits struct {
	HasCredits bool    `json:"hasCredits"`
	Unlimited  bool    `json:"unlimited"`
	Balance    *string `json:"balance,omitempty"`
}

type SessionActionIndividualLimit struct {
	Limit            string `json:"limit"`
	Used             string `json:"used"`
	RemainingPercent int    `json:"remainingPercent"`
	ResetsAt         string `json:"resetsAt,omitempty"`
}

type SessionActionResetCredits struct {
	AvailableCount int64 `json:"availableCount"`
}

type SessionActionStatusAccount struct {
	PlanType              string                        `json:"planType,omitempty"`
	Credits               *SessionActionCredits         `json:"credits,omitempty"`
	IndividualLimit       *SessionActionIndividualLimit `json:"individualLimit,omitempty"`
	RateLimitReachedType  string                        `json:"rateLimitReachedType,omitempty"`
	RateLimitResetCredits *SessionActionResetCredits    `json:"rateLimitResetCredits,omitempty"`
}

type SessionActionStatusResult struct {
	OK        bool                        `json:"ok"`
	SessionID string                      `json:"sessionId"`
	AgentType string                      `json:"agentType,omitempty"`
	Context   *SessionActionStatusContext `json:"context,omitempty"`
	Limits    []SessionActionRateLimit    `json:"limits"`
	Account   *SessionActionStatusAccount `json:"account,omitempty"`
	UpdatedAt string                      `json:"updatedAt"`
}

type SessionCompactAccepted struct {
	OK          bool   `json:"ok"`
	Accepted    bool   `json:"accepted"`
	SessionID   string `json:"sessionId"`
	OperationID string `json:"operationId"`
}

type SessionSteerParams struct {
	SessionID       string         `json:"sessionId"`
	ClientMessageID string         `json:"clientMessageId"`
	Blocks          []ContentBlock `json:"blocks"`
}

type SessionSteerAccepted struct {
	OK              bool   `json:"ok"`
	Accepted        bool   `json:"accepted"`
	SessionID       string `json:"sessionId"`
	ClientMessageID string `json:"clientMessageId"`
	Outcome         string `json:"outcome"`
}

type SessionOperationPayload struct {
	OperationID string             `json:"operationId"`
	Type        string             `json:"type"`
	Status      string             `json:"status"`
	StartedAt   string             `json:"startedAt,omitempty"`
	CompletedAt string             `json:"completedAt,omitempty"`
	Message     string             `json:"message,omitempty"`
	ForkedFrom  *SessionForkOrigin `json:"forkedFrom,omitempty"`
}
