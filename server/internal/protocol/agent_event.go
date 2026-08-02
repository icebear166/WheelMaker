package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// AgentEvent is the provider-neutral event consumed by Session. It is an
// internal model and is never marshaled as ACP.
type AgentEvent struct {
	SessionID string
	Update    AgentUpdate
}

type AgentUpdate interface {
	agentUpdate()
}

type AgentMessageEvent struct {
	Kind       string
	Content    ContentBlock
	MessageID  string
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentMessageEvent) agentUpdate() {}

type AgentToolEvent struct {
	Kind       string
	ToolCallID string
	Title      string
	ToolKind   string
	Status     string
	Content    []ToolCallContent
	Locations  []ToolCallLocation
	RawInput   json.RawMessage
	RawOutput  json.RawMessage
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentToolEvent) agentUpdate() {}

type AgentPlanEvent struct {
	Entries    []PlanEntry
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentPlanEvent) agentUpdate() {}

type AgentAvailableCommandsEvent struct {
	Commands   []AvailableCommand
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentAvailableCommandsEvent) agentUpdate() {}

type AgentCurrentModeEvent struct {
	CurrentModeID string
	Meta          json.RawMessage
	ReceivedAt    time.Time
}

func (AgentCurrentModeEvent) agentUpdate() {}

type AgentConfigOptionsEvent struct {
	ConfigOptions []ConfigOption
	Meta          json.RawMessage
	ReceivedAt    time.Time
}

func (AgentConfigOptionsEvent) agentUpdate() {}

type AgentSessionInfoEvent struct {
	Title      *string
	UpdatedAt  *string
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentSessionInfoEvent) agentUpdate() {}

type AgentUsageEvent struct {
	Size       int64
	Used       int64
	Cost       json.RawMessage
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentUsageEvent) agentUpdate() {}

type AgentGoalEvent struct {
	Event      string
	Goal       *SessionGoal
	TurnID     string
	Meta       json.RawMessage
	ReceivedAt time.Time
}

func (AgentGoalEvent) agentUpdate() {}

func ProjectSessionUpdate(params SessionUpdateParamsWire, receivedAt time.Time) (AgentEvent, error) {
	event := AgentEvent{SessionID: params.SessionID}
	switch update := params.Update.(type) {
	case MessageChunkUpdate:
		event.Update = AgentMessageEvent{Kind: update.SessionUpdate, Content: cloneContentBlock(update.Content), MessageID: update.MessageID, Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case ToolCallUpdate:
		event.Update = AgentToolEvent{Kind: update.SessionUpdate, ToolCallID: update.ToolCallID, Title: update.Title, ToolKind: update.Kind, Status: update.Status, Content: cloneToolCallContent(update.Content), Locations: cloneToolCallLocations(update.Locations), RawInput: cloneRaw(update.RawInput), RawOutput: cloneRaw(update.RawOutput), Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case PlanUpdate:
		event.Update = AgentPlanEvent{Entries: append([]PlanEntry(nil), update.Entries...), Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case AvailableCommandsUpdate:
		event.Update = AgentAvailableCommandsEvent{Commands: append([]AvailableCommand(nil), update.AvailableCommands...), Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case CurrentModeUpdate:
		event.Update = AgentCurrentModeEvent{CurrentModeID: update.CurrentModeID, Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case ConfigOptionUpdate:
		options, err := NormalizeSessionConfigOptions(update.ConfigOptions)
		if err != nil {
			return AgentEvent{}, err
		}
		event.Update = AgentConfigOptionsEvent{ConfigOptions: options, Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case SessionInfoUpdate:
		event.Update = AgentSessionInfoEvent{Title: cloneString(update.Title), UpdatedAt: cloneString(update.UpdatedAt), Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	case UsageUpdate:
		if update.Size > math.MaxInt64 || update.Used > math.MaxInt64 {
			return AgentEvent{}, errors.New("usage token count exceeds int64")
		}
		event.Update = AgentUsageEvent{Size: int64(update.Size), Used: int64(update.Used), Cost: cloneRaw(update.Cost), Meta: cloneRaw(update.Meta), ReceivedAt: receivedAt}
	default:
		return AgentEvent{}, fmt.Errorf("unsupported session update variant %T", params.Update)
	}
	return event, nil
}

// LegacySessionUpdate projects the typed event into the current WMT2
// normalized update shape. It does not decode or emit ACP wire JSON.
func (event AgentEvent) LegacySessionUpdate() (SessionUpdateParams, error) {
	params := SessionUpdateParams{SessionID: event.SessionID}
	switch update := event.Update.(type) {
	case AgentMessageEvent:
		content, err := json.Marshal(update.Content)
		if err != nil {
			return SessionUpdateParams{}, err
		}
		params.Update = SessionUpdate{SessionUpdate: update.Kind, Content: content, MessageID: update.MessageID, Meta: cloneRaw(update.Meta)}
	case AgentToolEvent:
		params.Update = SessionUpdate{SessionUpdate: update.Kind, ToolCallID: update.ToolCallID, Title: update.Title, Kind: update.ToolKind, Status: update.Status, ToolCallContent: cloneToolCallContent(update.Content), Locations: cloneToolCallLocations(update.Locations), RawInput: cloneRaw(update.RawInput), RawOutput: cloneRaw(update.RawOutput), Meta: cloneRaw(update.Meta)}
	case AgentPlanEvent:
		params.Update = SessionUpdate{SessionUpdate: SessionUpdatePlan, Entries: append([]PlanEntry(nil), update.Entries...), Meta: cloneRaw(update.Meta)}
	case AgentAvailableCommandsEvent:
		params.Update = SessionUpdate{SessionUpdate: SessionUpdateAvailableCommandsUpdate, AvailableCommands: append([]AvailableCommand(nil), update.Commands...), Meta: cloneRaw(update.Meta)}
	case AgentCurrentModeEvent:
		params.Update = SessionUpdate{SessionUpdate: SessionUpdateCurrentModeUpdate, ModeID: update.CurrentModeID, Meta: cloneRaw(update.Meta)}
	case AgentConfigOptionsEvent:
		params.Update = SessionUpdate{SessionUpdate: SessionUpdateConfigOptionUpdate, ConfigOptions: append([]ConfigOption(nil), update.ConfigOptions...), Meta: cloneRaw(update.Meta)}
	case AgentSessionInfoEvent:
		params.Update = SessionUpdate{SessionUpdate: SessionUpdateSessionInfoUpdate, Meta: cloneRaw(update.Meta)}
		if update.Title != nil {
			params.Update.Title = *update.Title
		}
		if update.UpdatedAt != nil {
			params.Update.UpdatedAt = *update.UpdatedAt
		}
	case AgentUsageEvent:
		size, used := update.Size, update.Used
		params.Update = SessionUpdate{SessionUpdate: SessionUpdateUsageUpdate, Size: &size, Used: &used, Meta: cloneRaw(update.Meta)}
	case AgentGoalEvent:
		params.Update.Meta = cloneRaw(update.Meta)
		switch update.Event {
		case WMGoalEventUpdated:
			params.Update.SessionUpdate = SessionUpdateGoalUpdated
			if update.Goal != nil {
				goal := *update.Goal
				params.Update.Goal = &goal
			}
		case WMGoalEventCleared:
			params.Update.SessionUpdate = SessionUpdateGoalCleared
		case WMGoalEventTurnStarted:
			params.Update.SessionUpdate = SessionUpdateGoalTurnStarted
			params.Update.TurnID = update.TurnID
		case WMGoalEventTurnCompleted:
			params.Update.SessionUpdate = SessionUpdateGoalTurnCompleted
			params.Update.TurnID = update.TurnID
		default:
			return SessionUpdateParams{}, fmt.Errorf("unsupported Goal event %q", update.Event)
		}
	default:
		return SessionUpdateParams{}, fmt.Errorf("unsupported agent event %T", event.Update)
	}
	return params, nil
}

func NormalizeSessionConfigOptions(options []SessionConfigOption) ([]ConfigOption, error) {
	normalized := make([]ConfigOption, 0, len(options))
	for _, wrapped := range options {
		switch option := wrapped.Variant.(type) {
		case SessionConfigSelect:
			values := append([]SessionConfigSelectOption(nil), option.Options.Ungrouped...)
			for _, group := range option.Options.Grouped {
				values = append(values, group.Options...)
			}
			legacyValues := make([]ConfigOptionValue, 0, len(values))
			for _, value := range values {
				legacyValues = append(legacyValues, ConfigOptionValue{Value: value.Value, Name: value.Name, Description: value.Description, Meta: cloneRaw(value.Meta)})
			}
			normalized = append(normalized, ConfigOption{ID: option.ID, Name: option.Name, Description: option.Description, Category: option.Category, Type: option.Type, CurrentValue: option.CurrentValue, Options: legacyValues, Meta: cloneRaw(option.Meta)})
		case SessionConfigBoolean:
			normalized = append(normalized, ConfigOption{ID: option.ID, Name: option.Name, Description: option.Description, Category: option.Category, Type: option.Type, CurrentValue: strconv.FormatBool(option.CurrentValue), Meta: cloneRaw(option.Meta)})
		default:
			return nil, fmt.Errorf("unsupported config option variant %T", wrapped.Variant)
		}
	}
	return normalized, nil
}

func WireSessionConfigOptions(options []ConfigOption) []SessionConfigOption {
	out := make([]SessionConfigOption, 0, len(options))
	for _, option := range options {
		name := firstNonEmptyProtocolString(option.Name, option.ID)
		if option.Type == "boolean" {
			out = append(out, SessionConfigOption{Variant: SessionConfigBoolean{
				ID: option.ID, Name: name, Description: option.Description, Category: option.Category,
				Type: "boolean", CurrentValue: strings.EqualFold(option.CurrentValue, "true"), Meta: CloneSessionUpdateMeta(option.Meta),
			}})
			continue
		}
		values := make([]SessionConfigSelectOption, 0, len(option.Options))
		for _, value := range option.Options {
			values = append(values, SessionConfigSelectOption{
				Value: value.Value, Name: firstNonEmptyProtocolString(value.Name, value.Value), Description: value.Description, Meta: CloneSessionUpdateMeta(value.Meta),
			})
		}
		out = append(out, SessionConfigOption{Variant: SessionConfigSelect{
			ID: option.ID, Name: name, Description: option.Description, Category: option.Category,
			Type: "select", CurrentValue: option.CurrentValue,
			Options: SessionConfigSelectOptions{Ungrouped: values}, Meta: CloneSessionUpdateMeta(option.Meta),
		}})
	}
	return out
}

func firstNonEmptyProtocolString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func cloneContentBlock(block ContentBlock) ContentBlock {
	block.Annotations = cloneRaw(block.Annotations)
	block.Meta = cloneRaw(block.Meta)
	if block.Resource != nil {
		resource := *block.Resource
		resource.Meta = cloneRaw(resource.Meta)
		block.Resource = &resource
	}
	return block
}

func cloneToolCallContent(content []ToolCallContent) []ToolCallContent {
	out := make([]ToolCallContent, len(content))
	for index, item := range content {
		out[index] = item
		out[index].Meta = cloneRaw(item.Meta)
		if item.Content != nil {
			block := cloneContentBlock(*item.Content)
			out[index].Content = &block
		}
		if item.OldText != nil {
			oldText := *item.OldText
			out[index].OldText = &oldText
		}
	}
	return out
}

func cloneToolCallLocations(locations []ToolCallLocation) []ToolCallLocation {
	out := append([]ToolCallLocation(nil), locations...)
	for index := range out {
		out[index].Meta = cloneRaw(out[index].Meta)
		if out[index].Line != nil {
			line := *out[index].Line
			out[index].Line = &line
		}
	}
	return out
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
