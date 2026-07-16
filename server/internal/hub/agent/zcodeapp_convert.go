package agent

import (
	"encoding/json"
	"fmt"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// This file holds the ZCode Protocol JSON-RPC envelope types and the ACP↔ZCode
// field conversions. The wire protocol is JSON-RPC 2.0 in semantics but frames
// MUST OMIT the "jsonrpc":"2.0" key (sending it is rejected by the server as an
// unrecognized key). See docs/zcode-app-server-acp-bridge.zh-CN.md.

// --- RPC envelope types (mirror codexapp envelope shapes, zcode-prefixed) ---

type zcodeappRPCRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params any             `json:"params"`
}

type zcodeappRPCNotification struct {
	Method string `json:"method"`
	Params any    `json:"params"`
}

// zcodeappRPCServerResponse is a client→server reply to a server-initiated
// request (interaction/requestPermission etc.). ID echoes the request id.
type zcodeappRPCServerResponse struct {
	ID     json.RawMessage   `json:"id"`
	Result any               `json:"result,omitempty"`
	Error  *zcodeappRPCError `json:"error,omitempty"`
}

// zcodeappRPCEnvelope is the inbound frame the runtime parses to classify a
// message as response (id + no method), notification (method + no id), or
// server request (method + id).
type zcodeappRPCEnvelope struct {
	ID     json.RawMessage   `json:"id,omitempty"`
	Method string            `json:"method,omitempty"`
	Params json.RawMessage   `json:"params,omitempty"`
	Result json.RawMessage   `json:"result,omitempty"`
	Error  *zcodeappRPCError `json:"error,omitempty"`
}

// zcodeappRPCResponse is the internal transport type for a matched response.
type zcodeappRPCResponse struct {
	Result json.RawMessage
	Error  *zcodeappRPCError
}

type zcodeappRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *zcodeappRPCError) Error() string {
	return fmt.Sprintf("zcode: %d %s", e.Code, e.Message)
}

// zcodeappParams normalizes nil params to {} so empty-param requests marshal
// correctly (the server rejects missing params keys for some methods).
func zcodeappParams(params any) any {
	if params == nil {
		return map[string]any{}
	}
	return params
}

// --- session/create ---

type zcodeWorkspace struct {
	WorkspacePath string `json:"workspacePath"`
	WorkspaceKey  string `json:"workspaceKey"`
}

type zcodeSessionCreateParams struct {
	Workspace zcodeWorkspace `json:"workspace"`
	Mode      string         `json:"mode,omitempty"`
	Model     string         `json:"model,omitempty"`
}

// zcodeSessionSnapshot is the shared response shape of session/create,
// session/setMode and session/read/resume. Fields not needed for routing are
// kept as RawMessage to avoid over-constraining decode.
type zcodeSessionSnapshot struct {
	Protocol    json.RawMessage      `json:"protocol,omitempty"`
	Session     zcodeSessionInfo     `json:"session"`
	Projection  json.RawMessage      `json:"projection,omitempty"`
	Runtime     zcodeRuntimeState    `json:"runtime,omitempty"`
	Settings    zcodeSettings        `json:"settings,omitempty"`
	Messages    []zcodeMessage       `json:"messages"`
	SlashJSON   json.RawMessage      `json:"slashCommands,omitempty"`
	Todos       json.RawMessage      `json:"todos,omitempty"`
	TodoGroups  json.RawMessage      `json:"todoGroups,omitempty"`
}

type zcodeSessionInfo struct {
	SessionID   string        `json:"sessionId"`
	Title       string        `json:"title,omitempty"`
	Mode        string        `json:"mode,omitempty"`
	Status      string        `json:"status,omitempty"`
	Kind        string        `json:"sessionKind,omitempty"`
	Workspace   zcodeWorkspace `json:"workspace,omitempty"`
	CreatedAt   int64         `json:"createdAt,omitempty"`
	UpdatedAt   int64         `json:"updatedAt,omitempty"`
}

type zcodeRuntimeState struct {
	EventSeq       int64    `json:"eventSeq,omitempty"`
	StateRevision  int64    `json:"stateRevision,omitempty"`
	PendingIDs     []string `json:"pendingRequestIds,omitempty"`
}

type zcodeSettings struct {
	Mode         zcodeModeSetting    `json:"mode,omitempty"`
	Model        zcodeModelSetting   `json:"model,omitempty"`
	Permission   zcodePermission     `json:"permission,omitempty"`
	ThoughtLevel zcodeThoughtSetting `json:"thoughtLevel,omitempty"`
}

type zcodeModeSetting struct {
	Current string `json:"current,omitempty"`
}

type zcodeModelSetting struct {
	Available []zcodeModelRef `json:"available,omitempty"`
	Current   zcodeModelRef   `json:"current,omitempty"`
	LastUsed  zcodeModelRef   `json:"lastUsed,omitempty"`
}

type zcodeModelRef struct {
	ProviderID string `json:"providerId,omitempty"`
	ModelID    string `json:"modelId,omitempty"`
	Label      string `json:"label,omitempty"`
}

func (r zcodeModelRef) String() string {
	if r.ProviderID == "" {
		return r.ModelID
	}
	return r.ProviderID + "/" + r.ModelID
}

type zcodePermission struct {
	Mode string `json:"mode,omitempty"`
}

type zcodeThoughtSetting struct {
	Available []zcodeThoughtOption `json:"available,omitempty"`
	Current   string               `json:"current,omitempty"`
	Enabled   bool                 `json:"enabled,omitempty"`
}

type zcodeThoughtOption struct {
	Label string `json:"label,omitempty"`
	Value string `json:"value,omitempty"`
}

// --- session/send ---

type zcodeSessionSendParams struct {
	SessionID string `json:"sessionId"`
	Content   string `json:"content"`
}

type zcodeSessionSendResult struct {
	Accepted      bool   `json:"accepted"`
	SessionID     string `json:"sessionId"`
	StateRevision int64  `json:"stateRevision"`
}

// --- session/list ---

type zcodeSessionListResult struct {
	Sessions []zcodeSessionInfo `json:"sessions"`
}

// --- session/subscribe / session/events ---

type zcodeSubscribeParams struct {
	SessionID    string `json:"sessionId"`
	DeliveryKind string `json:"deliveryKind"`
}

type zcodeSubscribeResult struct {
	SessionID string `json:"sessionId"`
	EventSeq  int64  `json:"eventSeq"`
	Events    []json.RawMessage `json:"events"`
}

// --- session/stop / setMode / setModel / steer / rewind ---

type zcodeSessionTargetParams struct {
	SessionID string `json:"sessionId"`
}

type zcodeSetModeParams struct {
	SessionID string `json:"sessionId"`
	Mode      string `json:"mode"`
}

type zcodeSetModelParams struct {
	SessionID string `json:"sessionId"`
	Model     zcodeModelRef `json:"model"`
}

// --- inbound event/notification payloads ---

// zcodeEventEnvelope is the params of a session/event notification.
type zcodeEventEnvelope struct {
	Type         string          `json:"type"`
	SessionID    string          `json:"sessionId"`
	TurnID       string          `json:"turnId,omitempty"`
	Seq          int64           `json:"seq,omitempty"`
	EventID      string          `json:"eventId,omitempty"`
	DeliveryKind string          `json:"deliveryKind,omitempty"`
	Payload      json.RawMessage `json:"payload,omitempty"`
}

// zcodeStateUpdateParams is the params of a state.updated notification.
type zcodeStateUpdateParams struct {
	Type      string          `json:"type"`
	Scope     string          `json:"scope,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Revision  int64           `json:"revision,omitempty"`
	Reason    string          `json:"reason,omitempty"`
	Patch     json.RawMessage `json:"patch,omitempty"`
}

// zcodeStreamingPayload is the payload of a model.streaming event.
type zcodeStreamingPayload struct {
	Kind             string `json:"kind"`
	Delta            string `json:"delta"`
	Done             bool   `json:"done,omitempty"`
	AssistantMessage string `json:"assistantMessageId,omitempty"`
}

// zcodeToolUpdatePayload is the payload of a tool.updated event.
type zcodeToolUpdatePayload struct {
	ToolCallID string          `json:"toolCallId,omitempty"`
	ToolName   string          `json:"toolName,omitempty"`
	Kind       string          `json:"kind,omitempty"`
	Result     *zcodeToolResult `json:"result,omitempty"`
}

type zcodeToolResult struct {
	Success bool            `json:"success"`
	Content json.RawMessage `json:"content,omitempty"`
}

// zcodeCompletedPayload is the payload of a turn.completed event.
type zcodeCompletedPayload struct {
	ResultType   string         `json:"resultType,omitempty"`
	Response     string         `json:"response,omitempty"`
	ToolCallCount int           `json:"toolCallCount,omitempty"`
	Usage        zcodeUsage     `json:"usage,omitempty"`
}

type zcodeUsage struct {
	InputTokens    int64 `json:"inputTokens,omitempty"`
	OutputTokens   int64 `json:"outputTokens,omitempty"`
	TotalTokens    int64 `json:"totalTokens,omitempty"`
}

// zcodeFailedPayload is the payload of a turn.failed event.
type zcodeFailedPayload struct {
	Error zcodeErrorBody `json:"error"`
}

type zcodeErrorBody struct {
	Type    string `json:"type,omitempty"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// --- message parts (session/read / session/resume replay) ---

type zcodeMessage struct {
	Info  zcodeMessageInfo `json:"info"`
	Parts []zcodePart      `json:"parts"`
}

type zcodeMessageInfo struct {
	Role      string        `json:"role"`
	MessageID string        `json:"messageId,omitempty"`
	Model     zcodeModelRef `json:"model,omitempty"`
}

type zcodePart struct {
	Type    string          `json:"type"`
	Text    string          `json:"text,omitempty"`
	CallID  string          `json:"callId,omitempty"`
	Tool    string          `json:"tool,omitempty"`
	State   *zcodeToolState `json:"state,omitempty"`
	Reason  string          `json:"reason,omitempty"`
	Tokens  zcodeUsage      `json:"tokens,omitempty"`
}

type zcodeToolState struct {
	Input       json.RawMessage `json:"input,omitempty"`
	Output      json.RawMessage `json:"output,omitempty"`
	CompletedAt int64           `json:"completedAt,omitempty"`
}

// --- permission (interaction/requestPermission) ---

type zcodePermissionRequestParams struct {
	RequestID   string                 `json:"requestId"`
	SessionID   string                 `json:"sessionId"`
	TurnID      string                 `json:"turnId,omitempty"`
	ToolCallID  string                 `json:"toolCallId"`
	ToolName    string                 `json:"toolName"`
	Reason      string                 `json:"reason"`
	RiskLevel   string                 `json:"riskLevel"`
	Input       json.RawMessage        `json:"input,omitempty"`
	Options     []zcodePermissionOption `json:"options"`
}

type zcodePermissionOption struct {
	OptionID string                `json:"optionId"`
	Kind     string                `json:"kind"`
	Name     string                `json:"name,omitempty"`
	Response zcodePermissionReply  `json:"response"`
}

type zcodePermissionReply struct {
	Decision string `json:"decision"`
	Reason   string `json:"reason,omitempty"`
}

// --- ACP↔ZCode conversions ---

// zcodeContentToText extracts plain text from ACP prompt content blocks.
// Phase 1 supports text only; non-text blocks are rejected.
func zcodeContentToText(prompt []protocol.ContentBlock) (string, error) {
	var text string
	for _, b := range prompt {
		switch b.Type {
		case protocol.ContentBlockTypeText:
			text += b.Text
		default:
			return "", fmt.Errorf("zcode: unsupported prompt content type %q (text only in phase 1)", b.Type)
		}
	}
	return text, nil
}

// zcodePermissionKind maps a ZCode tool name to an ACP tool kind for permission
// requests. Mirrors codex's risk classification.
func zcodePermissionKind(toolName string) string {
	switch toolName {
	case "Bash":
		return protocol.ToolKindExecute
	case "Write", "Edit", "ApplyPatch":
		return protocol.ToolKindWrite
	case "Read", "Glob", "Grep", "WebSearch", "WebFetch":
		return protocol.ToolKindRead
	default:
		return protocol.ToolKindOther
	}
}

// zcodePermissionTitle builds a human-readable title from the tool input. The
// raw input shape depends on toolName; we decode common fields best-effort.
func zcodePermissionTitle(toolName string, input json.RawMessage) string {
	if len(input) == 0 {
		return toolName
	}
	var generic map[string]json.RawMessage
	if json.Unmarshal(input, &generic) != nil {
		return toolName
	}
	for _, key := range []string{"command", "file_path", "path", "pattern", "query"} {
		if raw, ok := generic[key]; ok {
			var s string
			if json.Unmarshal(raw, &s) == nil && s != "" {
				return s
			}
		}
	}
	return toolName
}

// zcodePermissionOutcome maps an ACP permission outcome to a ZCode decision.
// ACP outcome values: allow_once/allow_always/reject_once/reject_always/reject_session.
func zcodePermissionDecision(outcome string) string {
	switch outcome {
	case "allow_once":
		return "allow"
	case "allow_always":
		return "allow"
	case "reject_once", "reject_always", "reject_session":
		return "deny"
	default:
		return "deny"
	}
}

// zcodeStopReason maps a turn result type to an ACP stop reason.
func zcodeStopReason(resultType string) string {
	switch resultType {
	case "success":
		return protocol.StopReasonEndTurn
	case "cancelled", "interrupted":
		return protocol.StopReasonCancelled
	default:
		return protocol.StopReasonRefusal
	}
}

// zcodeToolStatus maps a ZCode tool.updated kind to an ACP tool call status.
func zcodeToolStatus(kind string) string {
	switch kind {
	case "scheduled":
		return protocol.ToolCallStatusPending
	case "started":
		return protocol.ToolCallStatusInProgress
	case "result", "batch":
		return protocol.ToolCallStatusCompleted
	default:
		return protocol.ToolCallStatusInProgress
	}
}
