package protocol

// Session action names are provider-neutral capabilities exposed in session summaries.
const (
	SessionActionStatus  = "status"
	SessionActionCompact = "compact"

	SessionOperationTypeCompact = "compact"
	SessionOperationTypeFork    = "fork"

	SessionOperationStatusQueued    = "queued"
	SessionOperationStatusStarted   = "started"
	SessionOperationStatusCompleted = "completed"
	SessionOperationStatusFailed    = "failed"

	SessionTurnMethodOperation = "session_operation"
)

type SessionForkPoint struct {
	Provider string `json:"provider"`
	Ref      string `json:"ref"`
}

type SessionForkPrompt struct {
	DoneTurnIndex int64
	ContentBlocks []ContentBlock
}

type SessionForkResult struct {
	SessionID  string
	Title      string
	ForkPoints map[int64]SessionForkPoint
}

type SessionForkOrigin struct {
	SessionID string `json:"sessionId"`
	TurnIndex int64  `json:"turnIndex"`
	Title     string `json:"title,omitempty"`
}

type SessionActionCapability struct {
	Supported bool   `json:"supported"`
	Reason    string `json:"reason,omitempty"`
}

type SessionActionCapabilities struct {
	Status  SessionActionCapability `json:"status"`
	Compact SessionActionCapability `json:"compact"`
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

type SessionOperationPayload struct {
	OperationID string             `json:"operationId"`
	Type        string             `json:"type"`
	Status      string             `json:"status"`
	StartedAt   string             `json:"startedAt,omitempty"`
	CompletedAt string             `json:"completedAt,omitempty"`
	Message     string             `json:"message,omitempty"`
	ForkedFrom  *SessionForkOrigin `json:"forkedFrom,omitempty"`
}
