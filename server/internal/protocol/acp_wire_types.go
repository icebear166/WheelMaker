package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func (s MCPServer) MarshalJSON() ([]byte, error) {
	type wire MCPServer
	raw, err := json.Marshal(wire(s))
	if err != nil {
		return nil, err
	}
	if err := ValidateMCPServerJSON(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (s *MCPServer) UnmarshalJSON(raw []byte) error {
	decoded, err := decodeMCPServer(raw)
	if err != nil {
		return err
	}
	*s = decoded
	return nil
}

func decodeMCPServer(raw json.RawMessage) (MCPServer, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := decodeACP(raw, &head); err != nil {
		return MCPServer{}, err
	}
	switch head.Type {
	case "stdio":
		var value struct {
			Type    string          `json:"type"`
			Name    string          `json:"name"`
			Command string          `json:"command"`
			Args    []string        `json:"args"`
			Env     []EnvVariable   `json:"env"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return MCPServer{}, err
		}
		return MCPServer{Type: value.Type, Name: value.Name, Command: value.Command, Args: value.Args, Env: value.Env, Meta: cloneRaw(value.Meta)}, nil
	case "http", "sse":
		var value struct {
			Type    string          `json:"type"`
			Name    string          `json:"name"`
			URL     string          `json:"url"`
			Headers []HttpHeader    `json:"headers"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return MCPServer{}, err
		}
		return MCPServer{Type: value.Type, Name: value.Name, URL: value.URL, Headers: value.Headers, Meta: cloneRaw(value.Meta)}, nil
	default:
		return MCPServer{}, fmt.Errorf("unsupported MCP server type %q", head.Type)
	}
}

func (b ContentBlock) MarshalJSON() ([]byte, error) {
	type wire ContentBlock
	raw, err := json.Marshal(wire(b))
	if err != nil {
		return nil, err
	}
	if err := ValidateContentBlockJSON(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (b *ContentBlock) UnmarshalJSON(raw []byte) error {
	decoded, err := decodeContentBlock(raw)
	if err != nil {
		return err
	}
	*b = decoded
	return nil
}

func decodeContentBlock(raw json.RawMessage) (ContentBlock, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := decodeACP(raw, &head); err != nil {
		return ContentBlock{}, err
	}
	switch head.Type {
	case ContentBlockTypeText:
		var value struct {
			Type        string          `json:"type"`
			Text        string          `json:"text"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ContentBlock{}, err
		}
		return ContentBlock{Type: value.Type, Text: value.Text, Annotations: cloneRaw(value.Annotations), Meta: cloneRaw(value.Meta)}, nil
	case ContentBlockTypeImage, ContentBlockTypeAudio:
		var value struct {
			Type        string          `json:"type"`
			Data        string          `json:"data"`
			MimeType    string          `json:"mimeType"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ContentBlock{}, err
		}
		return ContentBlock{Type: value.Type, Data: value.Data, MimeType: value.MimeType, Annotations: cloneRaw(value.Annotations), Meta: cloneRaw(value.Meta)}, nil
	case ContentBlockTypeResource:
		var value struct {
			Type        string          `json:"type"`
			Resource    json.RawMessage `json:"resource"`
			Annotations json.RawMessage `json:"annotations,omitempty"`
			Meta        json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ContentBlock{}, err
		}
		resource, err := decodeEmbeddedResource(value.Resource)
		if err != nil {
			return ContentBlock{}, err
		}
		return ContentBlock{Type: value.Type, Resource: &resource, Annotations: cloneRaw(value.Annotations), Meta: cloneRaw(value.Meta)}, nil
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
		if err := decodeACP(raw, &value); err != nil {
			return ContentBlock{}, err
		}
		return ContentBlock{
			Type: value.Type, URI: value.URI, Name: value.Name, MimeType: value.MimeType,
			Size: value.Size, Title: value.Title, Description: value.Description,
			Annotations: cloneRaw(value.Annotations), Meta: cloneRaw(value.Meta),
		}, nil
	default:
		return ContentBlock{}, fmt.Errorf("unsupported content block type %q", head.Type)
	}
}

func decodeEmbeddedResource(raw json.RawMessage) (EmbeddedResource, error) {
	var value struct {
		URI      string          `json:"uri"`
		MimeType string          `json:"mimeType,omitempty"`
		Text     *string         `json:"text,omitempty"`
		Blob     *string         `json:"blob,omitempty"`
		Meta     json.RawMessage `json:"_meta,omitempty"`
	}
	if err := decodeACP(raw, &value); err != nil {
		return EmbeddedResource{}, err
	}
	if (value.Text == nil) == (value.Blob == nil) {
		return EmbeddedResource{}, errors.New("resource must contain exactly one of text or blob")
	}
	resource := EmbeddedResource{URI: value.URI, MimeType: value.MimeType, Meta: cloneRaw(value.Meta)}
	if value.Text != nil {
		resource.Text = *value.Text
	} else {
		resource.Blob = *value.Blob
	}
	return resource, nil
}

func (c ToolCallContent) MarshalJSON() ([]byte, error) {
	type wire ToolCallContent
	raw, err := json.Marshal(wire(c))
	if err != nil {
		return nil, err
	}
	if err := ValidateToolCallContentJSON(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (c *ToolCallContent) UnmarshalJSON(raw []byte) error {
	decoded, err := decodeToolCallContent(raw)
	if err != nil {
		return err
	}
	*c = decoded
	return nil
}

func decodeToolCallContent(raw json.RawMessage) (ToolCallContent, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := decodeACP(raw, &head); err != nil {
		return ToolCallContent{}, err
	}
	switch head.Type {
	case "content":
		var value struct {
			Type    string          `json:"type"`
			Content json.RawMessage `json:"content"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ToolCallContent{}, err
		}
		content, err := decodeContentBlock(value.Content)
		if err != nil {
			return ToolCallContent{}, err
		}
		return ToolCallContent{Type: value.Type, Content: &content, Meta: cloneRaw(value.Meta)}, nil
	case "diff":
		var value struct {
			Type    string          `json:"type"`
			Path    string          `json:"path"`
			OldText *string         `json:"oldText"`
			NewText string          `json:"newText"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ToolCallContent{}, err
		}
		return ToolCallContent{Type: value.Type, Path: value.Path, OldText: value.OldText, NewText: value.NewText, Meta: cloneRaw(value.Meta)}, nil
	case "terminal":
		var value struct {
			Type       string          `json:"type"`
			TerminalID string          `json:"terminalId"`
			Meta       json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &value); err != nil {
			return ToolCallContent{}, err
		}
		return ToolCallContent{Type: value.Type, TerminalID: value.TerminalID, Meta: cloneRaw(value.Meta)}, nil
	default:
		return ToolCallContent{}, fmt.Errorf("unsupported tool call content type %q", head.Type)
	}
}

func (r SessionPromptResult) MarshalJSON() ([]byte, error) {
	if !IsACPStopReason(r.StopReason) {
		return nil, fmt.Errorf("unsupported ACP stopReason %q", r.StopReason)
	}
	type wire struct {
		StopReason string          `json:"stopReason"`
		Meta       json.RawMessage `json:"_meta,omitempty"`
	}
	return json.Marshal(wire{StopReason: r.StopReason, Meta: CloneSessionUpdateMeta(r.Meta)})
}

func (r *SessionPromptResult) UnmarshalJSON(raw []byte) error {
	var wire struct {
		StopReason string          `json:"stopReason"`
		Meta       json.RawMessage `json:"_meta,omitempty"`
	}
	if err := decodeACP(raw, &wire); err != nil {
		return err
	}
	if !IsACPStopReason(wire.StopReason) {
		return fmt.Errorf("unsupported ACP stopReason %q", wire.StopReason)
	}
	r.StopReason = wire.StopReason
	r.Meta = CloneSessionUpdateMeta(wire.Meta)
	return nil
}

func (r SessionNewResult) MarshalJSON() ([]byte, error) {
	type wire struct {
		SessionID     string                `json:"sessionId"`
		ConfigOptions []SessionConfigOption `json:"configOptions,omitempty"`
		Meta          json.RawMessage       `json:"_meta,omitempty"`
	}
	return json.Marshal(wire{SessionID: r.SessionID, ConfigOptions: WireSessionConfigOptions(r.ConfigOptions), Meta: CloneSessionUpdateMeta(r.Meta)})
}

func (r *SessionNewResult) UnmarshalJSON(raw []byte) error {
	var wire struct {
		SessionID     string                `json:"sessionId"`
		ConfigOptions []SessionConfigOption `json:"configOptions,omitempty"`
		Meta          json.RawMessage       `json:"_meta,omitempty"`
	}
	if err := decodeACP(raw, &wire); err != nil {
		return err
	}
	if strings.TrimSpace(wire.SessionID) == "" {
		return errors.New("sessionId is required")
	}
	options, err := NormalizeSessionConfigOptions(wire.ConfigOptions)
	if err != nil {
		return err
	}
	r.SessionID = wire.SessionID
	r.ConfigOptions = options
	r.Meta = CloneSessionUpdateMeta(wire.Meta)
	return nil
}

func (r SessionLoadResult) MarshalJSON() ([]byte, error) {
	type wire struct {
		ConfigOptions []SessionConfigOption `json:"configOptions,omitempty"`
		Meta          json.RawMessage       `json:"_meta,omitempty"`
	}
	return json.Marshal(wire{ConfigOptions: WireSessionConfigOptions(r.ConfigOptions), Meta: CloneSessionUpdateMeta(r.Meta)})
}

func (r *SessionLoadResult) UnmarshalJSON(raw []byte) error {
	var wire struct {
		ConfigOptions []SessionConfigOption `json:"configOptions,omitempty"`
		Meta          json.RawMessage       `json:"_meta,omitempty"`
	}
	if err := decodeACP(raw, &wire); err != nil {
		return err
	}
	options, err := NormalizeSessionConfigOptions(wire.ConfigOptions)
	if err != nil {
		return err
	}
	r.ConfigOptions = options
	r.Meta = CloneSessionUpdateMeta(wire.Meta)
	return nil
}

type SessionConfigOptionVariant interface {
	sessionConfigOptionVariant()
}

// SessionConfigOption wraps the ACP v1 select/boolean discriminated union.
type SessionConfigOption struct {
	Variant SessionConfigOptionVariant
}

type SessionConfigSelect struct {
	ID           string                     `json:"id"`
	Name         string                     `json:"name"`
	Description  string                     `json:"description,omitempty"`
	Category     string                     `json:"category,omitempty"`
	Type         string                     `json:"type"`
	CurrentValue string                     `json:"currentValue"`
	Options      SessionConfigSelectOptions `json:"options"`
	Meta         json.RawMessage            `json:"_meta,omitempty"`
}

func (SessionConfigSelect) sessionConfigOptionVariant() {}

type SessionConfigBoolean struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	Category     string          `json:"category,omitempty"`
	Type         string          `json:"type"`
	CurrentValue bool            `json:"currentValue"`
	Meta         json.RawMessage `json:"_meta,omitempty"`
}

func (SessionConfigBoolean) sessionConfigOptionVariant() {}

type SessionConfigSelectOption struct {
	Value       string          `json:"value"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Meta        json.RawMessage `json:"_meta,omitempty"`
}

type SessionConfigSelectGroup struct {
	Group   string                      `json:"group"`
	Name    string                      `json:"name"`
	Options []SessionConfigSelectOption `json:"options"`
	Meta    json.RawMessage             `json:"_meta,omitempty"`
}

type SessionConfigSelectOptions struct {
	Ungrouped []SessionConfigSelectOption
	Grouped   []SessionConfigSelectGroup
}

func (o SessionConfigSelectOptions) MarshalJSON() ([]byte, error) {
	if o.Grouped != nil {
		return json.Marshal(o.Grouped)
	}
	if o.Ungrouped == nil {
		return []byte("[]"), nil
	}
	return json.Marshal(o.Ungrouped)
}

func (o *SessionConfigSelectOptions) UnmarshalJSON(raw []byte) error {
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return err
	}
	if len(entries) == 0 {
		o.Ungrouped = []SessionConfigSelectOption{}
		o.Grouped = nil
		return nil
	}
	var head struct {
		Group *string `json:"group"`
	}
	if err := json.Unmarshal(entries[0], &head); err != nil {
		return err
	}
	if head.Group != nil {
		groups := make([]SessionConfigSelectGroup, 0, len(entries))
		for index, entry := range entries {
			var group SessionConfigSelectGroup
			if err := decodeACP(entry, &group); err != nil {
				return fmt.Errorf("group[%d]: %w", index, err)
			}
			groups = append(groups, group)
		}
		o.Grouped = groups
		o.Ungrouped = nil
		return nil
	}
	options := make([]SessionConfigSelectOption, 0, len(entries))
	for index, entry := range entries {
		var option SessionConfigSelectOption
		if err := decodeACP(entry, &option); err != nil {
			return fmt.Errorf("option[%d]: %w", index, err)
		}
		options = append(options, option)
	}
	o.Ungrouped = options
	o.Grouped = nil
	return nil
}

func (o SessionConfigOption) MarshalJSON() ([]byte, error) {
	if o.Variant == nil {
		return nil, errors.New("session config option variant is required")
	}
	return json.Marshal(o.Variant)
}

func (o *SessionConfigOption) UnmarshalJSON(raw []byte) error {
	decoded, err := DecodeSessionConfigOption(raw)
	if err != nil {
		return err
	}
	o.Variant = decoded.Variant
	return nil
}

func DecodeSessionConfigOption(raw json.RawMessage) (SessionConfigOption, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return SessionConfigOption{}, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return SessionConfigOption{}, err
	}
	switch head.Type {
	case "select":
		if _, ok := fields["options"]; !ok {
			return SessionConfigOption{}, errors.New("select config options are required")
		}
		if _, ok := fields["currentValue"]; !ok {
			return SessionConfigOption{}, errors.New("select config currentValue is required")
		}
		var option SessionConfigSelect
		if err := decodeACP(raw, &option); err != nil {
			return SessionConfigOption{}, err
		}
		if strings.TrimSpace(option.ID) == "" || strings.TrimSpace(option.Name) == "" {
			return SessionConfigOption{}, errors.New("select config id and name are required")
		}
		return SessionConfigOption{Variant: option}, nil
	case "boolean":
		if _, ok := fields["currentValue"]; !ok {
			return SessionConfigOption{}, errors.New("boolean config currentValue is required")
		}
		var option SessionConfigBoolean
		if err := decodeACP(raw, &option); err != nil {
			return SessionConfigOption{}, err
		}
		if strings.TrimSpace(option.ID) == "" || strings.TrimSpace(option.Name) == "" {
			return SessionConfigOption{}, errors.New("boolean config id and name are required")
		}
		return SessionConfigOption{Variant: option}, nil
	default:
		return SessionConfigOption{}, fmt.Errorf("unsupported session config option type %q", head.Type)
	}
}

type SetSessionConfigOptionVariant interface {
	setSessionConfigOptionVariant()
}

type SetSessionConfigValueID struct {
	Type  string
	Value string
}

func (SetSessionConfigValueID) setSessionConfigOptionVariant() {}

type SetSessionConfigBoolean struct {
	Value bool
}

func (SetSessionConfigBoolean) setSessionConfigOptionVariant() {}

type SetSessionConfigOptionRequest struct {
	SessionID string
	ConfigID  string
	Variant   SetSessionConfigOptionVariant
	Meta      json.RawMessage
}

func (r SetSessionConfigOptionRequest) MarshalJSON() ([]byte, error) {
	switch value := r.Variant.(type) {
	case SetSessionConfigValueID:
		return json.Marshal(struct {
			SessionID string          `json:"sessionId"`
			ConfigID  string          `json:"configId"`
			Type      string          `json:"type,omitempty"`
			Value     string          `json:"value"`
			Meta      json.RawMessage `json:"_meta,omitempty"`
		}{r.SessionID, r.ConfigID, value.Type, value.Value, CloneSessionUpdateMeta(r.Meta)})
	case SetSessionConfigBoolean:
		return json.Marshal(struct {
			SessionID string          `json:"sessionId"`
			ConfigID  string          `json:"configId"`
			Type      string          `json:"type"`
			Value     bool            `json:"value"`
			Meta      json.RawMessage `json:"_meta,omitempty"`
		}{r.SessionID, r.ConfigID, "boolean", value.Value, CloneSessionUpdateMeta(r.Meta)})
	default:
		return nil, fmt.Errorf("unsupported set config variant %T", r.Variant)
	}
}

func (r *SetSessionConfigOptionRequest) UnmarshalJSON(raw []byte) error {
	decoded, err := DecodeSetSessionConfigOptionRequest(raw)
	if err != nil {
		return err
	}
	*r = decoded
	return nil
}

func DecodeSetSessionConfigOptionRequest(raw json.RawMessage) (SetSessionConfigOptionRequest, error) {
	var head struct {
		Type  string          `json:"type,omitempty"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return SetSessionConfigOptionRequest{}, err
	}
	switch head.Type {
	case "boolean":
		var wire struct {
			SessionID string          `json:"sessionId"`
			ConfigID  string          `json:"configId"`
			Type      string          `json:"type"`
			Value     bool            `json:"value"`
			Meta      json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &wire); err != nil {
			return SetSessionConfigOptionRequest{}, err
		}
		return SetSessionConfigOptionRequest{SessionID: wire.SessionID, ConfigID: wire.ConfigID, Variant: SetSessionConfigBoolean{Value: wire.Value}, Meta: cloneRaw(wire.Meta)}, nil
	case "", "value_id":
		var wire struct {
			SessionID string          `json:"sessionId"`
			ConfigID  string          `json:"configId"`
			Type      string          `json:"type,omitempty"`
			Value     string          `json:"value"`
			Meta      json.RawMessage `json:"_meta,omitempty"`
		}
		if err := decodeACP(raw, &wire); err != nil {
			return SetSessionConfigOptionRequest{}, err
		}
		return SetSessionConfigOptionRequest{SessionID: wire.SessionID, ConfigID: wire.ConfigID, Variant: SetSessionConfigValueID{Type: wire.Type, Value: wire.Value}, Meta: cloneRaw(wire.Meta)}, nil
	default:
		return SetSessionConfigOptionRequest{}, fmt.Errorf("unsupported set config value type %q", head.Type)
	}
}

type SetSessionConfigOptionResponse struct {
	ConfigOptions []SessionConfigOption `json:"configOptions"`
	Meta          json.RawMessage       `json:"_meta,omitempty"`
}

func (r *SetSessionConfigOptionResponse) UnmarshalJSON(raw []byte) error {
	decoded, err := DecodeSetSessionConfigOptionResponse(raw)
	if err != nil {
		return err
	}
	*r = decoded
	return nil
}

func DecodeSetSessionConfigOptionResponse(raw json.RawMessage) (SetSessionConfigOptionResponse, error) {
	var wire struct {
		ConfigOptions []SessionConfigOption `json:"configOptions"`
		Meta          json.RawMessage       `json:"_meta,omitempty"`
	}
	if err := decodeACP(raw, &wire); err != nil {
		return SetSessionConfigOptionResponse{}, err
	}
	if wire.ConfigOptions == nil {
		return SetSessionConfigOptionResponse{}, errors.New("configOptions is required")
	}
	return SetSessionConfigOptionResponse{ConfigOptions: wire.ConfigOptions, Meta: CloneSessionUpdateMeta(wire.Meta)}, nil
}

func (i *AvailableCommandInput) UnmarshalJSON(raw []byte) error {
	type wire AvailableCommandInput
	var value wire
	if err := decodeACP(raw, &value); err != nil {
		return err
	}
	*i = AvailableCommandInput(value)
	return nil
}

func (c *AvailableCommand) UnmarshalJSON(raw []byte) error {
	type wire AvailableCommand
	var value wire
	if err := decodeACP(raw, &value); err != nil {
		return err
	}
	*c = AvailableCommand(value)
	return nil
}

func ValidateMCPServerJSON(raw json.RawMessage) error {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	switch head.Type {
	case "stdio":
		var value struct {
			Type    string          `json:"type"`
			Name    string          `json:"name"`
			Command string          `json:"command"`
			Args    []string        `json:"args"`
			Env     []EnvVariable   `json:"env"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	case "http", "sse":
		var value struct {
			Type    string          `json:"type"`
			Name    string          `json:"name"`
			URL     string          `json:"url"`
			Headers []HttpHeader    `json:"headers"`
			Meta    json.RawMessage `json:"_meta,omitempty"`
		}
		return decodeStrict(raw, &value)
	default:
		return fmt.Errorf("unsupported MCP server type %q", head.Type)
	}
}
