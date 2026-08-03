package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	MethodWMSessionSteer       = "_wm/session/steer"
	MethodWMSessionCompact     = "_wm/session/compact"
	MethodWMSessionGoalSet     = "_wm/session/goal/set"
	MethodWMSessionGoalGet     = "_wm/session/goal/get"
	MethodWMSessionGoalClear   = "_wm/session/goal/clear"
	MethodWMSessionForkResolve = "_wm/session/fork/resolve"
	MethodWMSessionFork        = "_wm/session/fork"
	MethodWMSessionArchive     = "_wm/session/archive"
	MethodWMSessionGoal        = "_wm/session/goal"

	WMExtensionVersion = 1

	WMGoalEventUpdated       = "updated"
	WMGoalEventCleared       = "cleared"
	WMGoalEventTurnStarted   = "turn_started"
	WMGoalEventTurnCompleted = "turn_completed"

	WMActionErrorInactive    = "inactive"
	WMActionErrorBusy        = "busy"
	WMActionErrorUnavailable = "unavailable"
	WMActionErrorUnsupported = "unsupported"
	WMActionErrorInvalid     = "invalid"

	wmActionRPCErrorCode = -32010
)

func IsWMExtensionMethod(method string) bool {
	return strings.HasPrefix(strings.TrimSpace(method), "_wm/")
}

// DecodeWMJSON strictly decodes a negotiated WheelMaker-private extension
// object. Unlike standard ACP objects, private extension shapes are versioned
// and controlled by WheelMaker.
func DecodeWMJSON(raw json.RawMessage, target any) error {
	return decodeStrict(raw, target)
}

type WMActionErrorData struct {
	Code    string `json:"code"`
	Message string `json:"message,omitempty"`
}

func NewWMActionRPCError(code, message string) *ACPRPCError {
	data, _ := json.Marshal(WMActionErrorData{Code: strings.TrimSpace(code), Message: strings.TrimSpace(message)})
	return &ACPRPCError{Code: wmActionRPCErrorCode, Message: "WheelMaker session action failed", Data: data}
}

func WMActionErrorCode(err error) (string, bool) {
	var rpcErr *ACPRPCError
	if !errors.As(err, &rpcErr) {
		return "", false
	}
	var data WMActionErrorData
	if json.Unmarshal(rpcErr.Data, &data) != nil {
		return "", false
	}
	switch data.Code {
	case WMActionErrorInactive, WMActionErrorBusy, WMActionErrorUnavailable, WMActionErrorUnsupported, WMActionErrorInvalid:
		return data.Code, true
	default:
		return "", false
	}
}

type WMSessionActionCapabilities struct {
	Version int  `json:"version,omitempty"`
	Steer   bool `json:"steer,omitempty"`
	Compact bool `json:"compact,omitempty"`
	Goal    bool `json:"goal,omitempty"`
	Fork    bool `json:"fork,omitempty"`
	Archive bool `json:"archive,omitempty"`
}

type WMAgentExtensionCapabilities struct {
	MessageLifecycle bool
	GoalLifecycle    bool
	SessionActions   WMSessionActionCapabilities
}

type WMNegotiatedExtensions struct {
	MessageLifecycle bool
	GoalLifecycle    bool
	SessionActions   WMSessionActionCapabilities
}

type wmClientCapabilityVersion struct {
	Versions []int `json:"versions"`
}

type wmClientCapabilities struct {
	MessageLifecycle *wmClientCapabilityVersion `json:"messageLifecycle,omitempty"`
	GoalLifecycle    *wmClientCapabilityVersion `json:"goalLifecycle,omitempty"`
	SessionActions   *wmClientCapabilityVersion `json:"sessionActions,omitempty"`
}

type wmAgentMessageLifecycle struct {
	Version    int      `json:"version"`
	Phases     []string `json:"phases,omitempty"`
	Completion bool     `json:"completion,omitempty"`
	Steered    bool     `json:"steered,omitempty"`
}

type wmAgentGoalLifecycle struct {
	Version      int    `json:"version"`
	Notification string `json:"notification"`
}

type wmAgentCapabilities struct {
	MessageLifecycle *wmAgentMessageLifecycle     `json:"messageLifecycle,omitempty"`
	GoalLifecycle    *wmAgentGoalLifecycle        `json:"goalLifecycle,omitempty"`
	SessionActions   *WMSessionActionCapabilities `json:"sessionActions,omitempty"`
}

type wmClientMetaEnvelope struct {
	WM wmClientCapabilities `json:"wm"`
}

type wmAgentMetaEnvelope struct {
	WM wmAgentCapabilities `json:"wm"`
}

func BuildWMClientCapabilitiesMeta(base json.RawMessage) json.RawMessage {
	version := &wmClientCapabilityVersion{Versions: []int{WMExtensionVersion}}
	addition, _ := json.Marshal(wmClientMetaEnvelope{WM: wmClientCapabilities{
		MessageLifecycle: version,
		GoalLifecycle:    version,
		SessionActions:   version,
	}})
	merged, err := MergeSessionUpdateMeta(base, addition)
	if err != nil {
		return addition
	}
	return merged
}

func BuildWMAgentCapabilitiesMeta(base json.RawMessage, capabilities WMAgentExtensionCapabilities) json.RawMessage {
	var wm wmAgentCapabilities
	if capabilities.MessageLifecycle {
		wm.MessageLifecycle = &wmAgentMessageLifecycle{
			Version: WMExtensionVersion, Phases: []string{SessionMessagePhaseCommentary, SessionMessagePhaseFinalAnswer}, Completion: true, Steered: true,
		}
	}
	if capabilities.GoalLifecycle {
		wm.GoalLifecycle = &wmAgentGoalLifecycle{Version: WMExtensionVersion, Notification: MethodWMSessionGoal}
	}
	actions := capabilities.SessionActions
	if actions.Steer || actions.Compact || actions.Goal || actions.Fork || actions.Archive {
		actions.Version = WMExtensionVersion
		wm.SessionActions = &actions
	}
	addition, _ := json.Marshal(wmAgentMetaEnvelope{WM: wm})
	merged, err := MergeSessionUpdateMeta(base, addition)
	if err != nil {
		return addition
	}
	return merged
}

func NegotiateWMExtensions(clientMeta, agentMeta json.RawMessage) WMNegotiatedExtensions {
	var client wmClientMetaEnvelope
	var agent wmAgentMetaEnvelope
	if json.Unmarshal(clientMeta, &client) != nil || json.Unmarshal(agentMeta, &agent) != nil {
		return WMNegotiatedExtensions{}
	}
	message := supportsWMVersion(client.WM.MessageLifecycle)
	goal := supportsWMVersion(client.WM.GoalLifecycle)
	actions := supportsWMVersion(client.WM.SessionActions)
	negotiated := WMNegotiatedExtensions{
		MessageLifecycle: message && agent.WM.MessageLifecycle != nil && agent.WM.MessageLifecycle.Version == WMExtensionVersion,
		GoalLifecycle:    goal && agent.WM.GoalLifecycle != nil && agent.WM.GoalLifecycle.Version == WMExtensionVersion && agent.WM.GoalLifecycle.Notification == MethodWMSessionGoal,
	}
	if actions && agent.WM.SessionActions != nil && agent.WM.SessionActions.Version == WMExtensionVersion {
		negotiated.SessionActions = *agent.WM.SessionActions
	}
	return negotiated
}

func supportsWMVersion(capability *wmClientCapabilityVersion) bool {
	if capability == nil {
		return false
	}
	for _, version := range capability.Versions {
		if version == WMExtensionVersion {
			return true
		}
	}
	return false
}

func BuildWMPromptResultMeta(base json.RawMessage, message string) json.RawMessage {
	message = strings.TrimSpace(message)
	if message == "" {
		return CloneSessionUpdateMeta(base)
	}
	addition, _ := json.Marshal(map[string]any{"wm": map[string]any{"message": message}})
	merged, err := MergeSessionUpdateMeta(base, addition)
	if err != nil {
		return addition
	}
	return merged
}

func WMPromptResultMetaMessage(meta json.RawMessage) string {
	var envelope struct {
		WM struct {
			Message string `json:"message"`
		} `json:"wm"`
	}
	if json.Unmarshal(meta, &envelope) != nil {
		return ""
	}
	return strings.TrimSpace(envelope.WM.Message)
}

type WMSessionSteerParams struct {
	SessionID string          `json:"sessionId"`
	MessageID string          `json:"messageId"`
	Prompt    []ContentBlock  `json:"prompt"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionSteerResult struct {
	TurnID string          `json:"turnId,omitempty"`
	Meta   json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionCompactParams struct {
	SessionID string          `json:"sessionId"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionCompactResult struct {
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionGoalSetParams struct {
	SessionID   string
	Objective   *string
	Status      *string
	TokenBudget OptionalInt64
	Meta        json.RawMessage
}

func (p WMSessionGoalSetParams) MarshalJSON() ([]byte, error) {
	fields := map[string]any{"sessionId": p.SessionID}
	if p.Objective != nil {
		fields["objective"] = *p.Objective
	}
	if p.Status != nil {
		fields["status"] = *p.Status
	}
	if p.TokenBudget.Present {
		fields["tokenBudget"] = p.TokenBudget.Value
	}
	if len(p.Meta) > 0 {
		fields["_meta"] = json.RawMessage(p.Meta)
	}
	return json.Marshal(fields)
}

func (p *WMSessionGoalSetParams) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for key := range fields {
		switch key {
		case "sessionId", "objective", "status", "tokenBudget", "_meta":
		default:
			return fmt.Errorf("unknown field %q", key)
		}
	}
	if err := json.Unmarshal(fields["sessionId"], &p.SessionID); err != nil {
		return err
	}
	if value, ok := fields["objective"]; ok {
		p.Objective = new(string)
		if err := json.Unmarshal(value, p.Objective); err != nil {
			return err
		}
	}
	if value, ok := fields["status"]; ok {
		p.Status = new(string)
		if err := json.Unmarshal(value, p.Status); err != nil {
			return err
		}
	}
	if value, ok := fields["tokenBudget"]; ok {
		p.TokenBudget.Present = true
		if !bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			p.TokenBudget.Value = new(int64)
			if err := json.Unmarshal(value, p.TokenBudget.Value); err != nil {
				return err
			}
		}
	}
	p.Meta = cloneRaw(fields["_meta"])
	return requireWMSessionID(p.SessionID)
}

type WMSessionGoalResult struct {
	Goal *SessionGoal    `json:"goal,omitempty"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionGoalParams struct {
	SessionID string          `json:"sessionId"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionOKResult struct {
	OK   bool            `json:"ok"`
	Meta json.RawMessage `json:"_meta,omitempty"`
}

type WMSessionForkResolveParams struct {
	SessionID string              `json:"sessionId"`
	Prompts   []SessionForkPrompt `json:"prompts"`
	Meta      json.RawMessage     `json:"_meta,omitempty"`
}

type WMSessionForkResolveResult struct {
	ForkPoints map[int64]SessionForkPoint `json:"forkPoints"`
	Meta       json.RawMessage            `json:"_meta,omitempty"`
}

type WMSessionForkParams struct {
	SessionID string              `json:"sessionId"`
	Ref       string              `json:"ref"`
	Prompts   []SessionForkPrompt `json:"prompts"`
	Meta      json.RawMessage     `json:"_meta,omitempty"`
}

type WMSessionForkResult struct {
	SessionID  string                     `json:"sessionId"`
	Title      string                     `json:"title,omitempty"`
	ForkPoints map[int64]SessionForkPoint `json:"forkPoints,omitempty"`
	Meta       json.RawMessage            `json:"_meta,omitempty"`
}

type WMSessionArchiveParams struct {
	SessionID string          `json:"sessionId"`
	Archived  bool            `json:"archived"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

type WMGoalNotification struct {
	SessionID string          `json:"sessionId"`
	Event     string          `json:"event"`
	Goal      *SessionGoal    `json:"goal,omitempty"`
	TurnID    string          `json:"turnId,omitempty"`
	Meta      json.RawMessage `json:"_meta,omitempty"`
}

func DecodeWMGoalNotification(raw json.RawMessage) (WMGoalNotification, error) {
	var notification WMGoalNotification
	if err := decodeStrict(raw, &notification); err != nil {
		return WMGoalNotification{}, err
	}
	if err := requireWMSessionID(notification.SessionID); err != nil {
		return WMGoalNotification{}, err
	}
	switch notification.Event {
	case WMGoalEventUpdated:
		if notification.Goal == nil || strings.TrimSpace(notification.Goal.SessionID) == "" || strings.TrimSpace(notification.Goal.Objective) == "" || strings.TrimSpace(notification.Goal.Status) == "" {
			return WMGoalNotification{}, errors.New("updated Goal requires a complete goal snapshot")
		}
		if notification.Goal.SessionID != notification.SessionID || strings.TrimSpace(notification.TurnID) != "" {
			return WMGoalNotification{}, errors.New("updated Goal shape is invalid")
		}
	case WMGoalEventCleared:
		if notification.Goal != nil || strings.TrimSpace(notification.TurnID) != "" {
			return WMGoalNotification{}, errors.New("cleared Goal must not include goal or turnId")
		}
	case WMGoalEventTurnStarted, WMGoalEventTurnCompleted:
		if strings.TrimSpace(notification.TurnID) == "" || notification.Goal != nil {
			return WMGoalNotification{}, errors.New("Goal turn event requires turnId and no goal")
		}
	default:
		return WMGoalNotification{}, fmt.Errorf("unsupported Goal event %q", notification.Event)
	}
	return notification, nil
}

func requireWMSessionID(sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return errors.New("sessionId is required")
	}
	return nil
}
