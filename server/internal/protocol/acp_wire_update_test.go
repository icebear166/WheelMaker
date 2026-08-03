package protocol

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDecodeSessionUpdateIgnoresUnknownRootFields(t *testing.T) {
	for _, raw := range []string{
		`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"contentBlocks":[]}`,
		`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"},"clientMessageId":"m1"}`,
		`{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"},"steered":true}`,
		`{"sessionUpdate":"tool_call_update","toolCallId":"c","toolCallContent":[]}`,
		`{"sessionUpdate":"usage_update","size":10,"used":2,"updatedAt":"2026-08-02T00:00:00Z"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := DecodeSessionUpdate(json.RawMessage(raw)); err != nil {
				t.Fatalf("DecodeSessionUpdate(%s): %v", raw, err)
			}
		})
	}
	if _, err := DecodeSessionUpdate(json.RawMessage(`{"sessionUpdate":"current_mode_update","modeId":"plan"}`)); err == nil {
		t.Fatal("legacy mode update without currentModeId succeeded")
	}
}

func TestDecodeSessionUpdateUsesStrictVariants(t *testing.T) {
	tests := []struct {
		raw      string
		wantType any
	}{
		{`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}`, MessageChunkUpdate{}},
		{`{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"thinking"}}`, MessageChunkUpdate{}},
		{`{"sessionUpdate":"tool_call","toolCallId":"c1","title":"Read","kind":"read","status":"pending","content":[],"locations":[],"rawInput":{},"rawOutput":{}}`, ToolCallUpdate{}},
		{`{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"done"}}]}`, ToolCallUpdate{}},
		{`{"sessionUpdate":"current_mode_update","currentModeId":"code"}`, CurrentModeUpdate{}},
		{`{"sessionUpdate":"usage_update","size":128000,"used":42}`, UsageUpdate{}},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, err := DecodeSessionUpdate(json.RawMessage(tt.raw))
			if err != nil {
				t.Fatal(err)
			}
			if reflect.TypeOf(got) != reflect.TypeOf(tt.wantType) {
				t.Fatalf("type=%T, want %T", got, tt.wantType)
			}
		})
	}
}

func TestSessionUpdateVariantMetaRoundTripPreservesUnknownFields(t *testing.T) {
	original := json.RawMessage(`{"wm":{"messagePhase":"commentary","future":{"flag":true}},"thirdParty":{"trace":"opaque"}}`)
	update := MessageChunkUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
		MessageID:     "m1",
		Meta:          original,
	}
	raw, err := json.Marshal(update)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeSessionUpdate(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := decoded.(MessageChunkUpdate).Meta
	var wantValue, gotValue any
	if err := json.Unmarshal(original, &wantValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("meta=%s, want %s", got, original)
	}
}

func TestSessionUpdateParamsWireMarshalsACPFieldNames(t *testing.T) {
	raw, err := json.Marshal(SessionUpdateParamsWire{
		SessionID: "s1",
		Update: MessageChunkUpdate{
			SessionUpdate: SessionUpdateAgentMessageChunk,
			Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
			MessageID:     "m1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"},"messageId":"m1"}}` {
		t.Fatalf("raw=%s", raw)
	}
	if _, err := DecodeSessionUpdateParams(raw); err != nil {
		t.Fatalf("strict decode: %v", err)
	}
}

func TestSessionPromptResultIgnoresUnknownFieldsAndRejectsInvalidStopReason(t *testing.T) {
	var result SessionPromptResult
	if err := json.Unmarshal([]byte(`{"stopReason":"end_turn","message":"private"}`), &result); err != nil {
		t.Fatalf("forward-compatible result: %v", err)
	}
	if result.StopReason != "end_turn" {
		t.Fatalf("stopReason=%q, want end_turn", result.StopReason)
	}
	if err := json.Unmarshal([]byte(`{"stopReason":"failed"}`), &result); err == nil {
		t.Fatal("invalid failed stopReason succeeded")
	}
	var outcome PromptOutcome
	if err := json.Unmarshal([]byte(`{"stopReason":"refusal","_meta":{"wm":{"message":"declined"}}}`), &outcome); err != nil {
		t.Fatal(err)
	}
	if outcome.Message != "declined" {
		t.Fatalf("message=%q", outcome.Message)
	}
}

func TestStrictNestedUnionsRejectCrossVariantFields(t *testing.T) {
	contentCases := []string{
		`{"type":"text","text":"hello","data":"not-text"}`,
		`{"type":"image","mimeType":"image/png","data":"abc","text":"not-image"}`,
		`{"type":"resource_link","uri":"file:///x","name":"x","resource":{"uri":"file:///x","text":"x"}}`,
	}
	for _, raw := range contentCases {
		if err := ValidateContentBlockJSON(json.RawMessage(raw)); err == nil {
			t.Fatalf("ValidateContentBlockJSON(%s) succeeded", raw)
		}
	}
	toolCases := []string{
		`{"type":"content","content":{"type":"text","text":"x"},"path":"x"}`,
		`{"type":"diff","path":"x","newText":"y","terminalId":"term"}`,
	}
	for _, raw := range toolCases {
		if err := ValidateToolCallContentJSON(json.RawMessage(raw)); err == nil {
			t.Fatalf("ValidateToolCallContentJSON(%s) succeeded", raw)
		}
	}
	if _, err := json.Marshal(ContentBlock{Type: ContentBlockTypeText, Text: "hello", Data: "not-text"}); err == nil {
		t.Fatal("invalid ContentBlock marshal succeeded")
	}
	if _, err := json.Marshal(ToolCallContent{Type: "terminal", TerminalID: "term", Path: "not-terminal"}); err == nil {
		t.Fatal("invalid ToolCallContent marshal succeeded")
	}
}

func TestInboundNestedUnionsIgnoreUnknownFields(t *testing.T) {
	var content ContentBlock
	if err := json.Unmarshal([]byte(`{"type":"text","text":"hello","data":"not-text","future":true}`), &content); err != nil {
		t.Fatalf("content: %v", err)
	}
	if content.Type != ContentBlockTypeText || content.Text != "hello" || content.Data != "" {
		t.Fatalf("content=%#v", content)
	}

	var toolContent ToolCallContent
	if err := json.Unmarshal([]byte(`{"type":"content","content":{"type":"text","text":"done"},"path":"ignored","future":true}`), &toolContent); err != nil {
		t.Fatalf("tool content: %v", err)
	}
	if toolContent.Type != "content" || toolContent.Content == nil || toolContent.Path != "" {
		t.Fatalf("toolContent=%#v", toolContent)
	}

	var server MCPServer
	if err := json.Unmarshal([]byte(`{"type":"stdio","name":"local","command":"server","args":[],"env":[],"url":"https://ignored.example","future":true}`), &server); err != nil {
		t.Fatalf("mcp server: %v", err)
	}
	if server.Type != "stdio" || server.Command != "server" || server.URL != "" {
		t.Fatalf("server=%#v", server)
	}
}

func TestSessionUpdateVariantMarshalHasExactRootFields(t *testing.T) {
	raw, err := json.Marshal(MessageChunkUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Content:       ContentBlock{Type: ContentBlockTypeText, Text: "hello"},
		MessageID:     "m1",
		Meta:          json.RawMessage(`{"wm":{"messageComplete":true}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"sessionUpdate": true, "content": true, "messageId": true, "_meta": true}
	for key := range object {
		if !allowed[key] {
			t.Fatalf("unexpected root field %q in %s", key, raw)
		}
	}
}

func TestSessionConfigOptionStrictVariants(t *testing.T) {
	selectRaw := json.RawMessage(`{"id":"model","name":"Model","category":"model","type":"select","currentValue":"fast","options":[{"value":"fast","name":"Fast","_meta":{"vendor":1}}],"_meta":{"wm":{"x":1}}}`)
	option, err := DecodeSessionConfigOption(selectRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := option.Variant.(SessionConfigSelect); !ok {
		t.Fatalf("variant=%T, want SessionConfigSelect", option.Variant)
	}
	encoded, err := json.Marshal(option)
	if err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(encoded, selectRaw) {
		t.Fatalf("encoded=%s, want %s", encoded, selectRaw)
	}

	booleanRaw := json.RawMessage(`{"id":"fast","name":"Fast mode","type":"boolean","currentValue":true}`)
	option, err = DecodeSessionConfigOption(booleanRaw)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := option.Variant.(SessionConfigBoolean); !ok {
		t.Fatalf("variant=%T, want SessionConfigBoolean", option.Variant)
	}
	option, err = DecodeSessionConfigOption(json.RawMessage(`{"id":"fast","name":"Fast mode","type":"boolean","currentValue":true,"options":[],"future":true}`))
	if err != nil {
		t.Fatalf("forward-compatible boolean option: %v", err)
	}

	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"id":"bad","name":"Bad","type":"select","currentValue":"x"}`),
		json.RawMessage(`{"id":"bad","name":"Bad","type":"future","currentValue":"x"}`),
	} {
		if _, err := DecodeSessionConfigOption(raw); err == nil {
			t.Fatalf("DecodeSessionConfigOption(%s) succeeded", raw)
		}
	}
}

func TestSetSessionConfigOptionStrictValueAndWrappedResponse(t *testing.T) {
	valueID, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"model","value":"fast","_meta":{"trace":1}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := valueID.Variant.(SetSessionConfigValueID); !ok {
		t.Fatalf("variant=%T, want SetSessionConfigValueID", valueID.Variant)
	}
	boolean, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"fast","type":"boolean","value":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := boolean.Variant.(SetSessionConfigBoolean); !ok {
		t.Fatalf("variant=%T, want SetSessionConfigBoolean", boolean.Variant)
	}
	if _, err := DecodeSetSessionConfigOptionRequest(json.RawMessage(`{"sessionId":"s1","configId":"fast","value":true}`)); err == nil {
		t.Fatal("boolean value without type succeeded")
	}
	if _, err := DecodeSetSessionConfigOptionResponse(json.RawMessage(`[]`)); err == nil {
		t.Fatal("bare config option array response succeeded")
	}
	if _, err := DecodeSetSessionConfigOptionResponse(json.RawMessage(`{"configOptions":[],"future":true}`)); err != nil {
		t.Fatal(err)
	}
}

func TestAvailableCommandInputUsesHintShape(t *testing.T) {
	valid := json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"review","description":"Review changes","input":{"hint":"path","_meta":{"x":1}}}]}`)
	if _, err := DecodeSessionUpdate(valid); err != nil {
		t.Fatal(err)
	}
	forwardCompatible := json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"review","description":"Review changes","input":{"hint":"path","type":"future"}}]}`)
	if _, err := DecodeSessionUpdate(forwardCompatible); err != nil {
		t.Fatalf("forward-compatible command input: %v", err)
	}
}

func TestMCPServerStrictVariants(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"stdio","name":"local","command":"server","args":[],"env":[]}`),
		json.RawMessage(`{"type":"http","name":"remote","url":"https://example.test/mcp","headers":[]}`),
		json.RawMessage(`{"type":"sse","name":"events","url":"https://example.test/sse","headers":[]}`),
	} {
		if err := ValidateMCPServerJSON(raw); err != nil {
			t.Fatalf("ValidateMCPServerJSON(%s): %v", raw, err)
		}
	}
	if err := ValidateMCPServerJSON(json.RawMessage(`{"type":"stdio","name":"bad","command":"server","args":[],"env":[],"url":"https://example.test"}`)); err == nil {
		t.Fatal("cross-variant MCP fields succeeded")
	}
	if _, err := json.Marshal(MCPServer{Type: "stdio", Name: "bad", Command: "server", URL: "https://example.test"}); err == nil {
		t.Fatal("cross-variant MCP marshal succeeded")
	}
}

func jsonEqual(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}
