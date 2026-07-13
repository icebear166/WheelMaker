package registry

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	maxJSONPayloadBytes        = 64 * 1024
	maxEnvelopeBytes           = 1 * 1024 * 1024
	maxSpeechChunkPayloadBytes = 8 * 1024 * 1024
	maxWireMessageBytes        = maxSpeechChunkPayloadBytes + 64*1024
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

func validateRegistryInput(method string, messageBytes int, payloadBytes int) error {
	if messageBytes > maxWireMessageBytes {
		return fmt.Errorf("%w: wire message exceeds %d bytes", errRegistryInputTooLarge, maxWireMessageBytes)
	}
	if method == speechMethodChunk || method == rp.RegistryMethodSessionRead {
		if payloadBytes > maxSpeechChunkPayloadBytes {
			return fmt.Errorf("%w: %s payload exceeds %d bytes", errRegistryInputTooLarge, method, maxSpeechChunkPayloadBytes)
		}
		return nil
	}
	if messageBytes > maxEnvelopeBytes {
		return fmt.Errorf("%w: envelope exceeds %d bytes", errRegistryInputTooLarge, maxEnvelopeBytes)
	}
	if payloadBytes > maxJSONPayloadBytes {
		return fmt.Errorf("%w: payload exceeds %d bytes", errRegistryInputTooLarge, maxJSONPayloadBytes)
	}
	return nil
}

func decodeEnvelopeMessage(message []byte) (envelope, bool, error) {
	if len(message) > maxWireMessageBytes {
		return envelope{}, false, fmt.Errorf("%w: wire message exceeds %d bytes", errRegistryInputTooLarge, maxWireMessageBytes)
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
	if err := validateRegistryInput(out.Method, len(message), len(raw.Payload)); err != nil {
		return out, invalidRequestID, err
	}
	return out, invalidRequestID, nil
}
