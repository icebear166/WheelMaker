package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// SessionUpdateVariant is a strict ACP v1 session/update body. Concrete
// variants contain only fields allowed for their sessionUpdate discriminator.
type SessionUpdateVariant interface {
	SessionUpdateKind() string
	Metadata() json.RawMessage
}

// SessionUpdateParamsWire is the strict ACP v1 session/update notification.
type SessionUpdateParamsWire struct {
	SessionID string
	Update    SessionUpdateVariant
	Meta      json.RawMessage
}

func DecodeSessionUpdateParams(raw json.RawMessage) (SessionUpdateParamsWire, error) {
	var wire struct {
		SessionID string          `json:"sessionId"`
		Update    json.RawMessage `json:"update"`
		Meta      json.RawMessage `json:"_meta,omitempty"`
	}
	if err := decodeStrict(raw, &wire); err != nil {
		return SessionUpdateParamsWire{}, err
	}
	if strings.TrimSpace(wire.SessionID) == "" {
		return SessionUpdateParamsWire{}, errors.New("sessionId is required")
	}
	update, err := DecodeSessionUpdate(wire.Update)
	if err != nil {
		return SessionUpdateParamsWire{}, fmt.Errorf("update: %w", err)
	}
	return SessionUpdateParamsWire{SessionID: wire.SessionID, Update: update, Meta: cloneRaw(wire.Meta)}, nil
}

// MessageChunkUpdate represents agent_message_chunk, agent_thought_chunk, or
// user_message_chunk.
type MessageChunkUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	Content       ContentBlock    `json:"content"`
	MessageID     string          `json:"messageId,omitempty"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

func (u MessageChunkUpdate) SessionUpdateKind() string    { return u.SessionUpdate }
func (u MessageChunkUpdate) Metadata() json.RawMessage    { return CloneSessionUpdateMeta(u.Meta) }
func (u MessageChunkUpdate) MarshalJSON() ([]byte, error) { return marshalMessageChunkUpdate(u) }

// ToolCallUpdate represents both the initial tool_call snapshot and subsequent
// tool_call_update patches. The discriminator controls required fields.
type ToolCallUpdate struct {
	SessionUpdate string             `json:"sessionUpdate"`
	ToolCallID    string             `json:"toolCallId"`
	Title         string             `json:"title,omitempty"`
	Kind          string             `json:"kind,omitempty"`
	Status        string             `json:"status,omitempty"`
	Content       []ToolCallContent  `json:"content,omitempty"`
	Locations     []ToolCallLocation `json:"locations,omitempty"`
	RawInput      json.RawMessage    `json:"rawInput,omitempty"`
	RawOutput     json.RawMessage    `json:"rawOutput,omitempty"`
	Meta          json.RawMessage    `json:"_meta,omitempty"`
}

func (u ToolCallUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u ToolCallUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type PlanUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	Entries       []PlanEntry     `json:"entries"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

func (u PlanUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u PlanUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type AvailableCommandsUpdate struct {
	SessionUpdate     string             `json:"sessionUpdate"`
	AvailableCommands []AvailableCommand `json:"availableCommands"`
	Meta              json.RawMessage    `json:"_meta,omitempty"`
}

func (u AvailableCommandsUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u AvailableCommandsUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type CurrentModeUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	CurrentModeID string          `json:"currentModeId"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

func (u CurrentModeUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u CurrentModeUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type ConfigOptionUpdate struct {
	SessionUpdate string                `json:"sessionUpdate"`
	ConfigOptions []SessionConfigOption `json:"configOptions"`
	Meta          json.RawMessage       `json:"_meta,omitempty"`
}

func (u ConfigOptionUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u ConfigOptionUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type SessionInfoUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	Title         *string         `json:"title,omitempty"`
	UpdatedAt     *string         `json:"updatedAt,omitempty"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

func (u SessionInfoUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u SessionInfoUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

type UsageUpdate struct {
	SessionUpdate string          `json:"sessionUpdate"`
	Size          uint64          `json:"size"`
	Used          uint64          `json:"used"`
	Cost          json.RawMessage `json:"cost,omitempty"`
	Meta          json.RawMessage `json:"_meta,omitempty"`
}

func (u UsageUpdate) SessionUpdateKind() string { return u.SessionUpdate }
func (u UsageUpdate) Metadata() json.RawMessage { return CloneSessionUpdateMeta(u.Meta) }

func marshalMessageChunkUpdate(update MessageChunkUpdate) ([]byte, error) {
	if !isMessageUpdateKind(update.SessionUpdate) {
		return nil, fmt.Errorf("invalid message sessionUpdate %q", update.SessionUpdate)
	}
	content, err := json.Marshal(update.Content)
	if err != nil {
		return nil, err
	}
	if err := ValidateContentBlockJSON(content); err != nil {
		return nil, fmt.Errorf("content: %w", err)
	}
	type wire MessageChunkUpdate
	return json.Marshal(wire(update))
}

// DecodeSessionUpdate validates and decodes one official ACP v1 update
// variant. Unknown root fields are rejected; extension data belongs in _meta.
func DecodeSessionUpdate(raw json.RawMessage) (SessionUpdateVariant, error) {
	var head struct {
		SessionUpdate string `json:"sessionUpdate"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, fmt.Errorf("decode session update discriminator: %w", err)
	}
	switch head.SessionUpdate {
	case SessionUpdateAgentMessageChunk, SessionUpdateUserMessageChunk, SessionUpdateAgentThoughtChunk:
		var wire struct {
			SessionUpdate string          `json:"sessionUpdate"`
			Content       json.RawMessage `json:"content"`
			MessageID     string          `json:"messageId,omitempty"`
			Meta          json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeStrict(raw, &wire); err != nil {
			return nil, err
		}
		if err := ValidateContentBlockJSON(wire.Content); err != nil {
			return nil, fmt.Errorf("content: %w", err)
		}
		var content ContentBlock
		if err := json.Unmarshal(wire.Content, &content); err != nil {
			return nil, err
		}
		return MessageChunkUpdate{SessionUpdate: wire.SessionUpdate, Content: content, MessageID: wire.MessageID, Meta: cloneRaw(wire.Meta)}, nil
	case SessionUpdateToolCall, SessionUpdateToolCallUpdate:
		var wire struct {
			SessionUpdate string             `json:"sessionUpdate"`
			ToolCallID    string             `json:"toolCallId"`
			Title         string             `json:"title,omitempty"`
			Kind          string             `json:"kind,omitempty"`
			Status        string             `json:"status,omitempty"`
			Content       []json.RawMessage  `json:"content,omitempty"`
			Locations     []ToolCallLocation `json:"locations,omitempty"`
			RawInput      json.RawMessage    `json:"rawInput,omitempty"`
			RawOutput     json.RawMessage    `json:"rawOutput,omitempty"`
			Meta          json.RawMessage    `json:"_meta,omitempty"`
		}
		if err := decodeStrict(raw, &wire); err != nil {
			return nil, err
		}
		if strings.TrimSpace(wire.ToolCallID) == "" {
			return nil, errors.New("toolCallId is required")
		}
		content := make([]ToolCallContent, 0, len(wire.Content))
		for index, item := range wire.Content {
			if err := ValidateToolCallContentJSON(item); err != nil {
				return nil, fmt.Errorf("content[%d]: %w", index, err)
			}
			var decoded ToolCallContent
			if err := json.Unmarshal(item, &decoded); err != nil {
				return nil, err
			}
			content = append(content, decoded)
		}
		return ToolCallUpdate{SessionUpdate: wire.SessionUpdate, ToolCallID: wire.ToolCallID, Title: wire.Title, Kind: wire.Kind, Status: wire.Status, Content: content, Locations: wire.Locations, RawInput: cloneRaw(wire.RawInput), RawOutput: cloneRaw(wire.RawOutput), Meta: cloneRaw(wire.Meta)}, nil
	case SessionUpdatePlan:
		var update PlanUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		return update, nil
	case SessionUpdateAvailableCommandsUpdate:
		var update AvailableCommandsUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		return update, nil
	case SessionUpdateCurrentModeUpdate:
		var update CurrentModeUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		if strings.TrimSpace(update.CurrentModeID) == "" {
			return nil, errors.New("currentModeId is required")
		}
		return update, nil
	case SessionUpdateConfigOptionUpdate:
		var update ConfigOptionUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		return update, nil
	case SessionUpdateSessionInfoUpdate:
		var update SessionInfoUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		return update, nil
	case SessionUpdateUsageUpdate:
		var update UsageUpdate
		if err := decodeStrict(raw, &update); err != nil {
			return nil, err
		}
		return update, nil
	default:
		return nil, fmt.Errorf("unsupported sessionUpdate %q", head.SessionUpdate)
	}
}

func ValidateContentBlockJSON(raw json.RawMessage) error {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	switch head.Type {
	case ContentBlockTypeText:
		var value struct {
			Type        string          `json:"type"`
			Text        string          `json:"text"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	case ContentBlockTypeImage, ContentBlockTypeAudio:
		var value struct {
			Type        string          `json:"type"`
			Data        string          `json:"data"`
			MimeType    string          `json:"mimeType"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	case ContentBlockTypeResource:
		var value struct {
			Type        string          `json:"type"`
			Resource    json.RawMessage `json:"resource"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeStrict(raw, &value); err != nil {
			return err
		}
		return validateEmbeddedResourceJSON(value.Resource)
	case ContentBlockTypeResourceLink:
		var value struct {
			Type        string          `json:"type"`
			URI         string          `json:"uri"`
			Name        string          `json:"name"`
			MimeType    string          `json:"mimeType,omitempty"`
			Size        int             `json:"size,omitempty"`
			Title       string          `json:"title,omitempty"`
			Description string          `json:"description,omitempty"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	default:
		return fmt.Errorf("unsupported content block type %q", head.Type)
	}
}

func validateEmbeddedResourceJSON(raw json.RawMessage) error {
	var value struct {
		URI      string          `json:"uri"`
		MimeType string          `json:"mimeType,omitempty"`
		Text     *string         `json:"text,omitempty"`
		Blob     *string         `json:"blob,omitempty"`
		Meta     json.RawMessage `json:"_meta,omitempty"`
	}
	if err := decodeStrict(raw, &value); err != nil {
		return err
	}
	if (value.Text == nil) == (value.Blob == nil) {
		return errors.New("resource must contain exactly one of text or blob")
	}
	return nil
}

func ValidateToolCallContentJSON(raw json.RawMessage) error {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	switch head.Type {
	case "content":
		var value struct {
			Type    string          `json:"type"`
			Content json.RawMessage `json:"content"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeStrict(raw, &value); err != nil {
			return err
		}
		return ValidateContentBlockJSON(value.Content)
	case "diff":
		var value struct {
			Type    string          `json:"type"`
			Path    string          `json:"path"`
			OldText *string         `json:"oldText"`
			NewText string          `json:"newText"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	case "terminal":
		var value struct {
			Type       string          `json:"type"`
			TerminalID string          `json:"terminalId"`
			Meta       json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	default:
		return fmt.Errorf("unsupported tool call content type %q", head.Type)
	}
}

func decodeStrict(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func isMessageUpdateKind(kind string) bool {
	switch kind {
	case SessionUpdateAgentMessageChunk, SessionUpdateUserMessageChunk, SessionUpdateAgentThoughtChunk:
		return true
	default:
		return false
	}
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), raw...)
}
