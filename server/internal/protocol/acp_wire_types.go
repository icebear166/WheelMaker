package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

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
			if err := decodeStrict(entry, &group); err != nil {
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
		if err := decodeStrict(entry, &option); err != nil {
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
		if err := decodeStrict(raw, &option); err != nil {
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
		if err := decodeStrict(raw, &option); err != nil {
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
		if err := decodeStrict(raw, &wire); err != nil {
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
		if err := decodeStrict(raw, &wire); err != nil {
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

func DecodeSetSessionConfigOptionResponse(raw json.RawMessage) (SetSessionConfigOptionResponse, error) {
	var response SetSessionConfigOptionResponse
	if err := decodeStrict(raw, &response); err != nil {
		return SetSessionConfigOptionResponse{}, err
	}
	if response.ConfigOptions == nil {
		return SetSessionConfigOptionResponse{}, errors.New("configOptions is required")
	}
	return response, nil
}

func (i *AvailableCommandInput) UnmarshalJSON(raw []byte) error {
	type wire AvailableCommandInput
	var value wire
	if err := decodeStrict(raw, &value); err != nil {
		return err
	}
	*i = AvailableCommandInput(value)
	return nil
}

func (c *AvailableCommand) UnmarshalJSON(raw []byte) error {
	type wire AvailableCommand
	var value wire
	if err := decodeStrict(raw, &value); err != nil {
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
