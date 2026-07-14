package registry

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	maxRegistryMessageBytes    = 16 * 1024 * 1024
	maxSpeechChunkPayloadBytes = 8 * 1024 * 1024
	codePayloadTooLarge        = "payload_too_large"
)

var errRegistryInputTooLarge = errors.New("registry input too large")

type rawRegistryEnvelope struct {
	RequestID json.RawMessage `json:"requestId,omitempty"`
	Type      string          `json:"type"`
	Method    string          `json:"method,omitempty"`
	HubID     string          `json:"hubId,omitempty"`
	ProjectID string          `json:"projectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

func validateRegistryInput(messageBytes int) error {
	if messageBytes > maxRegistryMessageBytes {
		return fmt.Errorf("%w: wire message exceeds %d bytes", errRegistryInputTooLarge, maxRegistryMessageBytes)
	}
	return nil
}

func decodeEnvelopeMessage(message []byte) (envelope, bool, error) {
	if err := validateRegistryInput(len(message)); err != nil {
		return envelope{}, false, err
	}
	var raw rawRegistryEnvelope
	if err := json.Unmarshal(message, &raw); err != nil {
		return envelope{}, false, err
	}
	out := envelope{
		Type:      raw.Type,
		Method:    raw.Method,
		HubID:     raw.HubID,
		ProjectID: raw.ProjectID,
		Payload:   raw.Payload,
	}
	invalidRequestID := false
	if len(raw.RequestID) > 0 && strings.TrimSpace(string(raw.RequestID)) != "null" {
		if err := json.Unmarshal(raw.RequestID, &out.RequestID); err != nil {
			invalidRequestID = true
		}
	}
	return out, invalidRequestID, nil
}
