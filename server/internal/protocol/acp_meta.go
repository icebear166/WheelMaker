package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	SessionMessagePhaseCommentary  = "commentary"
	SessionMessagePhaseFinalAnswer = "final_answer"
)

type sessionUpdateWheelMakerMeta struct {
	MessagePhase    string `json:"messagePhase,omitempty"`
	MessageComplete bool   `json:"messageComplete,omitempty"`
	Steered         bool   `json:"steered,omitempty"`
}

type sessionUpdateMetaEnvelope struct {
	WheelMaker sessionUpdateWheelMakerMeta `json:"wm"`
}

func NormalizeSessionMessagePhase(phase string) string {
	switch strings.TrimSpace(phase) {
	case SessionMessagePhaseCommentary:
		return SessionMessagePhaseCommentary
	case SessionMessagePhaseFinalAnswer:
		return SessionMessagePhaseFinalAnswer
	default:
		return ""
	}
}

func BuildSessionUpdateMetaMessagePhase(phase string) json.RawMessage {
	return BuildSessionUpdateMetaLifecycle(phase, false, false)
}

func BuildSessionUpdateMetaLifecycle(phase string, complete bool, steered bool) json.RawMessage {
	phase = NormalizeSessionMessagePhase(phase)
	if phase == "" && !complete && !steered {
		return nil
	}
	raw, err := json.Marshal(sessionUpdateMetaEnvelope{
		WheelMaker: sessionUpdateWheelMakerMeta{MessagePhase: phase, MessageComplete: complete, Steered: steered},
	})
	if err != nil {
		return nil
	}
	return raw
}

func SessionUpdateMetaMessageComplete(meta json.RawMessage) bool {
	return decodeSessionUpdateMeta(meta).MessageComplete
}

func SessionUpdateMetaSteered(meta json.RawMessage) bool {
	return decodeSessionUpdateMeta(meta).Steered
}

func decodeSessionUpdateMeta(meta json.RawMessage) sessionUpdateWheelMakerMeta {
	if len(meta) == 0 {
		return sessionUpdateWheelMakerMeta{}
	}
	var envelope sessionUpdateMetaEnvelope
	if json.Unmarshal(meta, &envelope) != nil {
		return sessionUpdateWheelMakerMeta{}
	}
	envelope.WheelMaker.MessagePhase = NormalizeSessionMessagePhase(envelope.WheelMaker.MessagePhase)
	return envelope.WheelMaker
}

func SessionUpdateMetaMessagePhase(meta json.RawMessage) string {
	return decodeSessionUpdateMeta(meta).MessagePhase
}

// MergeSessionUpdateMeta deep-merges JSON metadata objects. Incoming object
// values recurse; incoming arrays and scalars replace the prior value.
func MergeSessionUpdateMeta(base, incoming json.RawMessage) (json.RawMessage, error) {
	base = json.RawMessage(bytes.TrimSpace(base))
	incoming = json.RawMessage(bytes.TrimSpace(incoming))
	if len(base) == 0 {
		if len(incoming) == 0 {
			return nil, nil
		}
		if _, err := decodeMetaObject(incoming); err != nil {
			return nil, err
		}
		return CloneSessionUpdateMeta(incoming), nil
	}
	if len(incoming) == 0 {
		if _, err := decodeMetaObject(base); err != nil {
			return nil, err
		}
		return CloneSessionUpdateMeta(base), nil
	}
	baseObject, err := decodeMetaObject(base)
	if err != nil {
		return nil, err
	}
	incomingObject, err := decodeMetaObject(incoming)
	if err != nil {
		return nil, err
	}
	merged, err := mergeRawObjects(baseObject, incomingObject)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("encode merged metadata: %w", err)
	}
	return raw, nil
}

func decodeMetaObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, fmt.Errorf("metadata must be a JSON object: %w", err)
	}
	if object == nil {
		return nil, fmt.Errorf("metadata must be a JSON object")
	}
	return object, nil
}

func mergeRawObjects(base, incoming map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	merged := make(map[string]json.RawMessage, len(base)+len(incoming))
	for key, value := range base {
		merged[key] = cloneRaw(value)
	}
	for key, value := range incoming {
		baseValue, exists := merged[key]
		if !exists {
			merged[key] = cloneRaw(value)
			continue
		}
		baseObject, baseOK := rawJSONObject(baseValue)
		incomingObject, incomingOK := rawJSONObject(value)
		if !baseOK || !incomingOK {
			merged[key] = cloneRaw(value)
			continue
		}
		nested, err := mergeRawObjects(baseObject, incomingObject)
		if err != nil {
			return nil, err
		}
		nestedRaw, err := json.Marshal(nested)
		if err != nil {
			return nil, err
		}
		merged[key] = nestedRaw
	}
	return merged, nil
}

func rawJSONObject(raw json.RawMessage) (map[string]json.RawMessage, bool) {
	raw = json.RawMessage(bytes.TrimSpace(raw))
	if len(raw) == 0 || raw[0] != '{' {
		return nil, false
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return nil, false
	}
	return object, true
}

func CloneSessionUpdateMeta(meta json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), meta...)
}

func EqualSessionUpdateMeta(left, right json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(left), bytes.TrimSpace(right))
}
