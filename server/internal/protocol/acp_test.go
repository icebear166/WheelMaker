package protocol

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestACPImplementedTypesPreserveMeta(t *testing.T) {
	types := []any{
		&InitializeParams{}, &InitializeResult{}, &ClientCapabilities{}, &FSCapabilities{},
		&AgentCapabilities{}, &PromptCapabilities{}, &MCPCapabilities{}, &SessionCapabilities{},
		&SessionListCapability{}, &SessionForkCapability{}, &SessionLifecycleCapability{},
		&AgentInfo{}, &AuthMethodVar{}, &AuthMethod{}, &AvailableCommand{}, &AvailableCommandInput{},
		&SessionNewParams{}, &SessionLoadParams{}, &EnvVariable{}, &HttpHeader{},
		&SessionPromptParams{}, &SessionCancelParams{},
		&SessionForkParams{}, &SessionForkResponse{}, &SessionDeleteParams{}, &SessionDeleteResult{},
		&SessionSteeringParams{}, &SessionSteeringResponse{},
		&PlanEntry{}, &ToolCallLocation{}, &EmbeddedResource{},
		&ToolCallRef{}, &PermissionRequestParams{}, &PermissionOption{},
		&PermissionResult{}, &PermissionResponse{}, &SessionLoadResult{},
		&FSReadTextFileParams{}, &FSReadTextFileResult{}, &FSWriteTextFileParams{},
		&TerminalCreateParams{}, &TerminalCreateResult{}, &TerminalOutputParams{}, &TerminalExitStatus{},
		&TerminalOutputResult{}, &TerminalWaitForExitParams{}, &TerminalWaitForExitResult{},
		&TerminalKillParams{}, &TerminalReleaseParams{}, &SessionListParams{}, &SessionInfo{}, &SessionListResult{},
	}
	for name, test := range map[string]struct {
		raw    string
		target any
	}{
		"SessionNewResult":    {`{"sessionId":"s1","_meta":{"future":{"value":7}}}`, &SessionNewResult{}},
		"SessionPromptResult": {`{"stopReason":"end_turn","_meta":{"future":{"value":7}}}`, &SessionPromptResult{}},
		"MCPServer":           {`{"type":"stdio","name":"local","command":"server","_meta":{"future":{"value":7}}}`, &MCPServer{}},
		"ContentBlock":        {`{"type":"text","text":"hello","_meta":{"future":{"value":7}}}`, &ContentBlock{}},
		"ToolCallContent":     {`{"type":"content","content":{"type":"text","text":"hello"},"_meta":{"future":{"value":7}}}`, &ToolCallContent{}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(test.raw), test.target); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(test.target)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"_meta":{"future":{"value":7}}`)) {
				t.Fatalf("%T dropped metadata: %s", test.target, raw)
			}
		})
	}
	for _, target := range types {
		t.Run(reflect.TypeOf(target).Elem().Name(), func(t *testing.T) {
			if err := json.Unmarshal([]byte(`{"_meta":{"future":{"value":7}}}`), target); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(target)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Contains(raw, []byte(`"_meta":{"future":{"value":7}}`)) {
				t.Fatalf("%T dropped metadata: %s", target, raw)
			}
		})
	}
}

func TestCXDeepSeekProviderIdentity(t *testing.T) {
	provider, ok := ParseACPProvider(" CX-DeepSeek ")
	if !ok || provider != ACPProviderCXDeepSeek {
		t.Fatalf("ParseACPProvider() = (%q, %v), want (%q, true)", provider, ok, ACPProviderCXDeepSeek)
	}

	count := 0
	for _, name := range ACPProviderNames() {
		if name == string(ACPProviderCXDeepSeek) {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("ACPProviderNames() = %v, want one %q", ACPProviderNames(), ACPProviderCXDeepSeek)
	}
}

func TestSessionUpdateParams_JSONParity(t *testing.T) {
	in := SessionUpdateParams{SessionID: "s1"}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out SessionUpdateParams
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.SessionID != "s1" {
		t.Fatalf("session id = %q", out.SessionID)
	}
}

func TestSessionUpdate_UsageUpdateFields(t *testing.T) {
	raw := []byte(`{
		"sessionId":"s1",
		"update":{
			"sessionUpdate":"usage_update",
			"size":258400,
			"used":183223
		}
	}`)

	var out SessionUpdateParams
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Update.SessionUpdate != SessionUpdateUsageUpdate {
		t.Fatalf("sessionUpdate=%q, want %q", out.Update.SessionUpdate, SessionUpdateUsageUpdate)
	}
	if out.Update.Size == nil || *out.Update.Size != 258400 {
		t.Fatalf("size=%v, want 258400", out.Update.Size)
	}
	if out.Update.Used == nil || *out.Update.Used != 183223 {
		t.Fatalf("used=%v, want 183223", out.Update.Used)
	}
}

func TestPermissionRequestParamsDecodeToolCallTextContent(t *testing.T) {
	raw := []byte(`{
		"sessionId":"sess-1",
		"toolCall":{
			"toolCallId":"call-1",
			"title":"Choose how to continue",
			"content":[
				{"type":"content","content":{"type":"text","text":"Which path should I take?"}},
				{"type":"diff","path":"secret.txt","newText":"do not retain"}
			],
			"rawInput":{"provider":"private"},
			"rawOutput":{"answer":"private"}
		},
		"options":[{"optionId":"continue","name":"Continue","kind":"allow_once"}]
	}`)

	var params PermissionRequestParams
	if err := json.Unmarshal(raw, &params); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if params.SessionID != "sess-1" || params.ToolCall.ToolCallID != "call-1" {
		t.Fatalf("permission identity = %#v", params)
	}
	if len(params.ToolCall.Content) != 2 {
		t.Fatalf("content count = %d, want 2", len(params.ToolCall.Content))
	}
	text := params.ToolCall.Content[0].Content
	if text == nil || text.Type != ContentBlockTypeText || text.Text != "Which path should I take?" {
		t.Fatalf("text content = %#v", text)
	}
	encoded, err := json.Marshal(params.ToolCall)
	if err != nil {
		t.Fatalf("marshal toolCall: %v", err)
	}
	if string(encoded) == "" || containsAny(string(encoded), "rawInput", "rawOutput", "provider", "answer") {
		t.Fatalf("toolCall retained private raw fields: %s", encoded)
	}
}

func TestPermissionTurnPayloadSerialization(t *testing.T) {
	requestJSON, err := json.Marshal(SessionTurnPermissionRequest{
		PermissionID: "perm-1",
		Title:        "Choose",
		DetailsText:  "Details",
		Options: []SessionTurnPermissionOption{{
			OptionID: "continue",
			Name:     "Continue",
			Kind:     "allow_once",
		}},
		CreatedAt: "2026-07-21T10:00:00Z",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	for _, want := range []string{`"permissionId":"perm-1"`, `"detailsText":"Details"`, `"optionId":"continue"`} {
		if !containsAny(string(requestJSON), want) {
			t.Fatalf("request JSON %s missing %s", requestJSON, want)
		}
	}

	responseJSON, err := json.Marshal(SessionTurnPermissionResponse{
		PermissionID:     "perm-1",
		RequestTurnIndex: 20,
		Outcome:          "selected",
		OptionID:         "continue",
		OptionName:       "Continue",
		RespondedAt:      "2026-07-21T10:01:00Z",
	})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	for _, forbidden := range []string{"detailsText", "options", `"title"`} {
		if containsAny(string(responseJSON), forbidden) {
			t.Fatalf("response JSON retained request field %q: %s", forbidden, responseJSON)
		}
	}
}

func TestSessionUpdateMetaMessagePhase(t *testing.T) {
	for _, phase := range []string{SessionMessagePhaseCommentary, SessionMessagePhaseFinalAnswer} {
		meta := BuildSessionUpdateMetaMessagePhase(phase)
		if got := SessionUpdateMetaMessagePhase(meta); got != phase {
			t.Fatalf("phase = %q, want %q; meta=%s", got, phase, meta)
		}
	}
	if meta := BuildSessionUpdateMetaMessagePhase("future_phase"); len(meta) != 0 {
		t.Fatalf("unknown phase meta = %s, want empty", meta)
	}
	if got := SessionUpdateMetaMessagePhase(json.RawMessage(`{"wm":{"messagePhase":"future_phase"}}`)); got != "" {
		t.Fatalf("unknown phase = %q, want empty", got)
	}
}

func TestSessionUpdateMetaRoundTripPreservesUnknownFields(t *testing.T) {
	original := json.RawMessage(`{"wm":{"messagePhase":"commentary"},"thirdParty":{"trace":"opaque"}}`)
	raw, err := json.Marshal(SessionUpdate{
		SessionUpdate: SessionUpdateAgentMessageChunk,
		Meta:          original,
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded SessionUpdate
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	var want, got any
	if err := json.Unmarshal(original, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(decoded.Meta, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("meta = %#v, want %#v", got, want)
	}
}

func TestMergeSessionUpdateMetaDeepMergesLifecycleAndUnknownFields(t *testing.T) {
	base := json.RawMessage(`{"wm":{"messagePhase":"commentary","nested":{"left":1}},"vendor":{"trace":"keep","array":[1]}}`)
	incoming := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"right":2}},"vendor":{"array":[2]}}`)
	merged, err := MergeSessionUpdateMeta(base, incoming)
	if err != nil {
		t.Fatal(err)
	}
	want := json.RawMessage(`{"wm":{"messagePhase":"final_answer","messageComplete":true,"nested":{"left":1,"right":2}},"vendor":{"trace":"keep","array":[2]}}`)
	if !jsonEqual(merged, want) {
		t.Fatalf("merged=%s, want %s", merged, want)
	}
	if phase := SessionUpdateMetaMessagePhase(merged); phase != SessionMessagePhaseFinalAnswer {
		t.Fatalf("phase=%q", phase)
	}
	if !SessionUpdateMetaMessageComplete(merged) {
		t.Fatal("messageComplete=false")
	}
}

func TestBuildSessionUpdateMetaLifecyclePreservesSteered(t *testing.T) {
	meta := BuildSessionUpdateMetaLifecycle("", true, true)
	if SessionUpdateMetaMessagePhase(meta) != "" || !SessionUpdateMetaMessageComplete(meta) || !SessionUpdateMetaSteered(meta) {
		t.Fatalf("meta=%s", meta)
	}
}

func TestWithoutSessionUpdateLifecyclePreservesOtherMetadata(t *testing.T) {
	meta := json.RawMessage(`{"wm":{"messagePhase":"commentary","messageComplete":true,"steered":true,"future":7},"vendor":{"trace":"keep"}}`)
	got := WithoutSessionUpdateLifecycle(meta)
	want := json.RawMessage(`{"wm":{"future":7},"vendor":{"trace":"keep"}}`)
	if !jsonEqual(got, want) {
		t.Fatalf("metadata=%s, want %s", got, want)
	}
}

func TestSessionCapabilitiesRoundTripPreservesStandardLifecycleFields(t *testing.T) {
	raw := []byte(`{"sessionCapabilities":{"fork":{},"delete":{},"resume":{},"close":{},"additionalDirectories":{}}}`)
	var capabilities AgentCapabilities
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(capabilities)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"\"fork\"", "\"delete\"", "\"resume\"", "\"close\"", "\"additionalDirectories\""} {
		if !bytes.Contains(encoded, []byte(field)) {
			t.Fatalf("encoded capabilities=%s, missing %s", encoded, field)
		}
	}
}

func TestAgentCapabilitiesRoundTripPreservesUnknownFields(t *testing.T) {
	raw := []byte(`{"loadSession":true,"providers":{"list":{}},"sessionCapabilities":{"fork":{},"futureLifecycle":{"mode":"future"}}}`)
	var capabilities AgentCapabilities
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(capabilities)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"\"providers\"", "\"futureLifecycle\""} {
		if !bytes.Contains(encoded, []byte(field)) {
			t.Fatalf("encoded capabilities=%s, missing %s", encoded, field)
		}
	}
}

func TestSessionActionsRequireVerifiedCurrentForkAndExposeLegacyHistoricalFork(t *testing.T) {
	var standard AgentCapabilities
	if err := json.Unmarshal([]byte(`{"sessionCapabilities":{"fork":{}}}`), &standard); err != nil {
		t.Fatal(err)
	}
	standard.LoadSession = true
	standardActions := SessionActionsFromAgentCapabilities(standard)
	if standardActions.Fork.Supported || standardActions.Fork.CurrentSession {
		t.Fatalf("unverified standard fork actions=%#v, want hidden", standardActions.Fork)
	}

	verified := standard
	verified.Meta = BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{CurrentSession: true},
	})
	verifiedActions := SessionActionsFromAgentCapabilities(verified)
	if !verifiedActions.Fork.Supported || !verifiedActions.Fork.CurrentSession || verifiedActions.Fork.HistoricalTurn {
		t.Fatalf("verified standard fork actions=%#v, want current-only", verifiedActions.Fork)
	}

	codex := AgentCapabilities{
		LoadSession:         true,
		SessionCapabilities: &SessionCapabilities{Fork: &SessionForkCapability{}},
		Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
			SessionActions: WMSessionActionCapabilities{Fork: true},
		}),
	}
	codexActions := SessionActionsFromAgentCapabilities(codex)
	if !codexActions.Fork.Supported || codexActions.Fork.CurrentSession || !codexActions.Fork.HistoricalTurn {
		t.Fatalf("codex fork actions=%#v, want historical-only", codexActions.Fork)
	}

	legacy := AgentCapabilities{Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{Fork: true},
	})}
	legacyJSON, err := json.Marshal(SessionActionsFromAgentCapabilities(legacy))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(legacyJSON, []byte(`"historicalTurn":true`)) {
		t.Fatalf("legacy fork actions=%s, want historicalTurn=true", legacyJSON)
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if len(needle) > 0 && len(value) >= len(needle) {
			for index := 0; index+len(needle) <= len(value); index++ {
				if value[index:index+len(needle)] == needle {
					return true
				}
			}
		}
	}
	return false
}
