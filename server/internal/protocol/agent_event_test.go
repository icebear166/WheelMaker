package protocol

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectACPUpdateProducesTypedAgentEvent(t *testing.T) {
	receivedAt := time.Date(2026, 8, 2, 1, 2, 3, 0, time.UTC)
	params, err := DecodeSessionUpdateParams(json.RawMessage(`{
		"sessionId":"s1",
		"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1","_meta":{"wm":{"messagePhase":"commentary"},"vendor":{"trace":1}}},
		"_meta":{"envelope":{"sequence":9}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	event, err := ProjectSessionUpdate(params, receivedAt)
	if err != nil {
		t.Fatal(err)
	}
	message, ok := event.Update.(AgentMessageEvent)
	if !ok {
		t.Fatalf("update=%T, want AgentMessageEvent", event.Update)
	}
	if event.SessionID != "s1" || message.MessageID != "m1" || message.Content.Text != "hello" || !message.ReceivedAt.Equal(receivedAt) {
		t.Fatalf("event=%#v", event)
	}
	if string(message.Meta) != `{"wm":{"messagePhase":"commentary"},"vendor":{"trace":1}}` {
		t.Fatalf("meta=%s", message.Meta)
	}
}

func TestDecodeSessionUpdateParamsIgnoresUnknownEnvelopeAndRejectsInvalidUpdate(t *testing.T) {
	valid := json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"status":"streaming"},"private":true}`)
	if _, err := DecodeSessionUpdateParams(valid); err != nil {
		t.Fatalf("forward-compatible update: %v", err)
	}
	invalid := json.RawMessage(`{"sessionId":"s1","update":{"sessionUpdate":"future_update"}}`)
	if _, err := DecodeSessionUpdateParams(invalid); err == nil {
		t.Fatalf("DecodeSessionUpdateParams(%s) succeeded", invalid)
	}
}

func TestProjectToolUpdatePreservesRichFields(t *testing.T) {
	params, err := DecodeSessionUpdateParams(json.RawMessage(`{
		"sessionId":"s1",
		"update":{
			"sessionUpdate":"tool_call_update",
			"toolCallId":"call-1",
			"title":"Run",
			"kind":"execute",
			"status":"completed",
			"content":[{"type":"terminal","terminalId":"term-1","_meta":{"vendor":1}}],
			"locations":[{"path":"main.go","line":4,"_meta":{"vendor":2}}],
			"rawInput":{"command":"go test"},
			"rawOutput":{"exitCode":0},
			"_meta":{"vendor":{"trace":"abc"}}
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	event, err := ProjectSessionUpdate(params, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	tool, ok := event.Update.(AgentToolEvent)
	if !ok {
		t.Fatalf("update=%T, want AgentToolEvent", event.Update)
	}
	if len(tool.Content) != 1 || len(tool.Locations) != 1 || len(tool.RawInput) == 0 || len(tool.RawOutput) == 0 || len(tool.Meta) == 0 {
		t.Fatalf("tool=%#v", tool)
	}
}
