package protocol

import (
	"encoding/json"
	"testing"
)

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
