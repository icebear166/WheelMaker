package protocol

import (
	"bytes"
	"encoding/json"
	"strings"
)

const (
	SessionMessagePhaseCommentary  = "commentary"
	SessionMessagePhaseFinalAnswer = "final_answer"
)

type sessionUpdateWheelMakerMeta struct {
	MessagePhase string `json:"messagePhase,omitempty"`
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
	phase = NormalizeSessionMessagePhase(phase)
	if phase == "" {
		return nil
	}
	raw, err := json.Marshal(sessionUpdateMetaEnvelope{
		WheelMaker: sessionUpdateWheelMakerMeta{MessagePhase: phase},
	})
	if err != nil {
		return nil
	}
	return raw
}

func SessionUpdateMetaMessagePhase(meta json.RawMessage) string {
	if len(meta) == 0 {
		return ""
	}
	var envelope sessionUpdateMetaEnvelope
	if json.Unmarshal(meta, &envelope) != nil {
		return ""
	}
	return NormalizeSessionMessagePhase(envelope.WheelMaker.MessagePhase)
}

func CloneSessionUpdateMeta(meta json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), meta...)
}

func EqualSessionUpdateMeta(left, right json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(left), bytes.TrimSpace(right))
}
