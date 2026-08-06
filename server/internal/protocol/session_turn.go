package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ConfigOption and ConfigOptionValue are the normalized internal session
// representation. ACP wire uses SessionConfigOption discriminated variants.
type ConfigOptionValue struct {
	Value       string          `json:"value"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Meta        json.RawMessage `json:"_meta,omitempty"`
}

type ConfigOption struct {
	ID           string              `json:"id"`
	Name         string              `json:"name,omitempty"`
	Description  string              `json:"description,omitempty"`
	Category     string              `json:"category,omitempty"`
	Type         string              `json:"type,omitempty"`
	CurrentValue string              `json:"currentValue,omitempty"`
	Options      []ConfigOptionValue `json:"options,omitempty"`
	Meta         json.RawMessage     `json:"_meta,omitempty"`
}

// SessionUsage is the internal Registry/session snapshot. ACP usage_update
// uses UsageUpdate and never carries updatedAt at the wire root.
type SessionUsage struct {
	Used      int64           `json:"used"`
	Size      int64           `json:"size,omitempty"`
	UpdatedAt string          `json:"updatedAt,omitempty"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

const (
	SessionTurnStopReasonFailed    = "failed"
	SessionUpdateGoalUpdated       = "goal_updated"
	SessionUpdateGoalCleared       = "goal_cleared"
	SessionUpdateGoalTurnStarted   = "goal_turn_started"
	SessionUpdateGoalTurnCompleted = "goal_turn_completed"

	// Shared inbound/outbound methods.
	SessionTurnMethodPromptRequest = "prompt_request"
	SessionTurnMethodPromptDone    = "prompt_done"
	SessionTurnMethodSystem        = "system"
	SessionTurnMethodSessionInfo   = "session_info"

	// Outbound session update methods.
	SessionTurnMethodAgentMessage       = SessionUpdateAgentMessageChunk
	SessionTurnMethodAgentThought       = SessionUpdateAgentThoughtChunk
	SessionTurnMethodAgentPlan          = "agent_plan"
	SessionTurnMethodToolCall           = SessionUpdateToolCall
	SessionTurnMethodPermissionRequest  = "permission_request"
	SessionTurnMethodPermissionResponse = "permission_response"
)

// SessionUpdateParams and SessionUpdate are WheelMaker's normalized WMT2
// compatibility model. They are never decoded directly from ACP wire; strict
// ACP updates enter through SessionUpdateParamsWire and AgentEvent.
type SessionUpdateParams struct {
	SessionID string          `json:"sessionId"`
	Update    SessionUpdate   `json:"update"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

type SessionUpdate struct {
	SessionUpdate     string             `json:"sessionUpdate"`
	Content           json.RawMessage    `json:"content,omitempty"`
	MessageID         string             `json:"messageId,omitempty"`
	Meta              json.RawMessage    `json:"_meta,omitempty"`
	ContentBlocks     []ContentBlock     `json:"contentBlocks,omitempty"`
	ClientMessageID   string             `json:"clientMessageId,omitempty"`
	Steered           bool               `json:"steered,omitempty"`
	MessageLifecycle  *bool              `json:"messageLifecycle,omitempty"`
	AvailableCommands []AvailableCommand `json:"availableCommands,omitempty"`
	ToolCallID        string             `json:"toolCallId,omitempty"`
	Title             string             `json:"title,omitempty"`
	Kind              string             `json:"kind,omitempty"`
	Status            string             `json:"status,omitempty"`
	Entries           []PlanEntry        `json:"entries,omitempty"`
	Locations         []ToolCallLocation `json:"locations,omitempty"`
	RawInput          json.RawMessage    `json:"rawInput,omitempty"`
	RawOutput         json.RawMessage    `json:"rawOutput,omitempty"`
	ToolCallContent   []ToolCallContent  `json:"toolCallContent,omitempty"`
	ModeID            string             `json:"modeId,omitempty"`
	ConfigOptions     []ConfigOption     `json:"configOptions,omitempty"`
	Size              *int64             `json:"size,omitempty"`
	Used              *int64             `json:"used,omitempty"`
	UpdatedAt         string             `json:"updatedAt,omitempty"`
	Goal              *SessionGoal       `json:"goal,omitempty"`
	TurnID            string             `json:"turnId,omitempty"`
}

// SessionSetConfigOptionParams is Session's normalized config mutation.
// Instance converts it to the strict ACP discriminated request.
type SessionSetConfigOptionParams struct {
	SessionID string
	ConfigID  string
	Value     string
	Meta      json.RawMessage
}

// PromptOutcome is the provider-neutral completion consumed by Session. Only
// StopReason and Meta correspond to ACP response fields; the remaining values
// are internal side-band state and are never marshaled as ACP.
type PromptOutcome struct {
	StopReason string
	Meta       json.RawMessage
	Message    string
	Artifacts  []SessionPromptArtifactPayload
	ForkPoint  *SessionForkPoint
	Err        error
}

func (o PromptOutcome) MarshalJSON() ([]byte, error) {
	return json.Marshal(SessionPromptResult{StopReason: o.StopReason, Meta: BuildWMPromptResultMeta(o.Meta, o.Message)})
}

func (o *PromptOutcome) UnmarshalJSON(raw []byte) error {
	var result SessionPromptResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return err
	}
	if !IsACPStopReason(result.StopReason) {
		return fmt.Errorf("unsupported ACP stopReason %q", result.StopReason)
	}
	o.StopReason = result.StopReason
	o.Meta = CloneSessionUpdateMeta(result.Meta)
	o.Message = WMPromptResultMetaMessage(result.Meta)
	return nil
}

func IsACPStopReason(reason string) bool {
	switch strings.TrimSpace(reason) {
	case StopReasonEndTurn, StopReasonMaxTokens, StopReasonMaxTurnRequests, StopReasonRefusal, StopReasonCancelled:
		return true
	default:
		return false
	}
}

type SessionPromptArtifactPayload struct {
	Type    string `json:"type"`
	Format  string `json:"format"`
	Content string `json:"-"`
}

// SessionTurnMessage is the persisted session event payload.
//
// This protocol uses method-driven payload typing:
//   - method=prompt_request:
//     param is SessionTurnPromptRequest
//   - method=prompt_done:
//     param is SessionTurnPromptResult
//   - method=agent_message_chunk / agent_thought_chunk:
//     param is SessionTurnTextResult
//   - method=user_message_chunk:
//     param is SessionTurnUserMessage
//   - method=tool_call:
//     param is SessionTurnToolResult
//   - method=agent_plan:
//     param is SessionTurnPlanPayload
//
// Payload is inlined in Param (no extra type wrapper map).
// Ordering metadata lives in the outer transport or persistence envelope.
type SessionTurnMessage struct {
	Method string          `json:"method"`
	Param  json.RawMessage `json:"param,omitempty"`
}

type SessionTurnPromptRequest struct {
	ContentBlocks   []ContentBlock `json:"contentBlocks,omitempty"`
	ModelName       string         `json:"modelName,omitempty"`
	CreatedAt       string         `json:"createdAt,omitempty"`
	ClientMessageID string         `json:"clientMessageId,omitempty"`
}

type SessionTurnPromptResult struct {
	StopReason  string                      `json:"stopReason"`
	CompletedAt string                      `json:"completedAt,omitempty"`
	Message     string                      `json:"message,omitempty"`
	Artifacts   []SessionTurnPromptArtifact `json:"artifacts,omitempty"`
	ForkPoint   *SessionForkPoint           `json:"forkPoint,omitempty"`
}

type SessionTurnPromptArtifact struct {
	ArtifactID string                          `json:"artifactId"`
	Type       string                          `json:"type"`
	Format     string                          `json:"format"`
	FileCount  int                             `json:"fileCount"`
	Files      []SessionTurnPromptArtifactFile `json:"files,omitempty"`
}

type SessionTurnPromptArtifactFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type SessionTurnTextResult struct {
	Text            string          `json:"text"`
	MessageID       string          `json:"messageId,omitempty"`
	MessageComplete bool            `json:"messageComplete,omitempty"`
	Meta            json.RawMessage `json:"_meta,omitempty"`
}

type SessionTurnUserMessage struct {
	Text            string          `json:"text,omitempty"`
	ContentBlocks   []ContentBlock  `json:"contentBlocks,omitempty"`
	ClientMessageID string          `json:"clientMessageId,omitempty"`
	MessageID       string          `json:"messageId,omitempty"`
	MessageComplete bool            `json:"messageComplete,omitempty"`
	Steered         bool            `json:"steered,omitempty"`
	Meta            json.RawMessage `json:"_meta,omitempty"`
}

type SessionTurnToolResult struct {
	Cmd       string             `json:"cmd,omitempty"`
	Kind      string             `json:"kind,omitempty"`
	Status    string             `json:"status,omitempty"`
	Content   []ToolCallContent  `json:"content,omitempty"`
	Locations []ToolCallLocation `json:"locations,omitempty"`
	RawInput  json.RawMessage    `json:"rawInput,omitempty"`
	RawOutput json.RawMessage    `json:"rawOutput,omitempty"`
	Meta      json.RawMessage    `json:"_meta,omitempty"`
}

type SessionTurnPlanPayload struct {
	Entries []SessionTurnPlanResult `json:"entries"`
	Meta    json.RawMessage         `json:"_meta,omitempty"`
}

type SessionTurnPlanResult struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

type SessionTurnPermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}

type SessionTurnPermissionRequest struct {
	PermissionID string                        `json:"permissionId"`
	Title        string                        `json:"title"`
	DetailsText  string                        `json:"detailsText,omitempty"`
	Options      []SessionTurnPermissionOption `json:"options"`
	CreatedAt    string                        `json:"createdAt"`
}

type SessionTurnPermissionResponse struct {
	PermissionID     string `json:"permissionId"`
	RequestTurnIndex int64  `json:"requestTurnIndex"`
	Outcome          string `json:"outcome"`
	OptionID         string `json:"optionId"`
	OptionName       string `json:"optionName"`
	RespondedAt      string `json:"respondedAt"`
}
