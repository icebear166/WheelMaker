package protocol

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestNegotiateWMExtensionsRequiresVersionIntersection(t *testing.T) {
	client := BuildWMClientCapabilitiesMeta(json.RawMessage(`{"vendor":{"keep":true}}`))
	agent := BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		MessageLifecycle: true,
		GoalLifecycle:    true,
		SessionActions: WMSessionActionCapabilities{
			Steer: true, Compact: true, Goal: true, Fork: true, Archive: true,
		},
	})
	got := NegotiateWMExtensions(client, agent)
	if !got.MessageLifecycle || !got.GoalLifecycle || !got.SessionActions.Steer || !got.SessionActions.Archive {
		t.Fatalf("negotiated=%#v", got)
	}
	if got := NegotiateWMExtensions(nil, agent); got.MessageLifecycle || got.SessionActions.Steer {
		t.Fatalf("agent-only capabilities negotiated: %#v", got)
	}
}

func TestWMActionRPCErrorCarriesStableDataCode(t *testing.T) {
	err := NewWMActionRPCError(WMActionErrorBusy, "turn already running")
	code, ok := WMActionErrorCode(err)
	if !ok || code != WMActionErrorBusy {
		t.Fatalf("WMActionErrorCode() = %q, %v", code, ok)
	}
	var data WMActionErrorData
	if decodeErr := json.Unmarshal(err.Data, &data); decodeErr != nil || data.Message != "turn already running" {
		t.Fatalf("error data = %s, err=%v", err.Data, decodeErr)
	}
}

func TestSessionActionsProjectOnlyNegotiatedAgentCapabilities(t *testing.T) {
	capabilities := AgentCapabilities{Meta: BuildWMAgentCapabilitiesMeta(nil, WMAgentExtensionCapabilities{
		SessionActions: WMSessionActionCapabilities{Compact: true, Goal: true},
	})}
	actions := SessionActionsFromAgentCapabilities(capabilities)
	if !actions.Status.Supported || !actions.Compact.Supported || !actions.Goal.Supported {
		t.Fatalf("negotiated actions=%#v", actions)
	}
	if actions.Steer.Supported || actions.Fork.Supported {
		t.Fatalf("unadvertised actions=%#v", actions)
	}
	unnegotiated := SessionActionsFromAgentCapabilities(AgentCapabilities{})
	if !unnegotiated.Status.Supported || unnegotiated.Compact.Supported || unnegotiated.Goal.Supported {
		t.Fatalf("unnegotiated actions=%#v", unnegotiated)
	}
}

func TestDecodeWMGoalNotificationValidatesEventShape(t *testing.T) {
	valid := []string{
		`{"sessionId":"s1","event":"updated","goal":{"sessionId":"s1","objective":"ship","status":"active","tokenBudget":null,"tokensUsed":0,"timeUsedSeconds":0,"createdAt":1,"updatedAt":1},"_meta":{"vendor":{"keep":true}}}`,
		`{"sessionId":"s1","event":"cleared"}`,
		`{"sessionId":"s1","event":"turn_started","turnId":"t1"}`,
		`{"sessionId":"s1","event":"turn_completed","turnId":"t1"}`,
	}
	for _, raw := range valid {
		if _, err := DecodeWMGoalNotification(json.RawMessage(raw)); err != nil {
			t.Fatalf("valid %s: %v", raw, err)
		}
	}
	invalid := []string{
		`{"sessionId":"s1","event":"updated"}`,
		`{"sessionId":"s1","event":"cleared","goal":{"sessionId":"s1"}}`,
		`{"sessionId":"s1","event":"turn_started"}`,
		`{"sessionId":"s1","event":"future"}`,
		`{"sessionId":"s1","event":"cleared","private":true}`,
	}
	for _, raw := range invalid {
		if _, err := DecodeWMGoalNotification(json.RawMessage(raw)); err == nil {
			t.Fatalf("invalid %s accepted", raw)
		}
	}
}

func TestWMExtensionMethodsUseReservedNamespace(t *testing.T) {
	methods := []string{
		MethodWMSessionSteer, MethodWMSessionCompact, MethodWMSessionGoalSet,
		MethodWMSessionGoalGet, MethodWMSessionGoalClear, MethodWMSessionForkResolve,
		MethodWMSessionFork, MethodWMSessionArchive, MethodWMSessionGoal,
	}
	for _, method := range methods {
		if len(method) < 4 || method[:4] != "_wm/" {
			t.Fatalf("method=%q", method)
		}
	}
}

func TestWMSessionForkExtensionUsesStablePromptFieldNames(t *testing.T) {
	turnIndex := int64(7)
	meta := BuildWMSessionForkMeta(nil, WMSessionForkExtension{
		Ref:       "turn-7",
		TurnIndex: &turnIndex,
		Prompts: []SessionForkPrompt{{
			DoneTurnIndex: 7,
			ContentBlocks: []ContentBlock{{Type: ContentBlockTypeText, Text: "follow up"}},
		}},
	})
	if !bytes.Contains(meta, []byte(`"doneTurnIndex":7`)) || !bytes.Contains(meta, []byte(`"contentBlocks"`)) {
		t.Fatalf("fork metadata=%s, want stable prompt field names", meta)
	}
	decoded, ok := WMSessionForkExtensionFromMeta(meta)
	if !ok || decoded.Ref != "turn-7" || decoded.TurnIndex == nil || *decoded.TurnIndex != 7 || len(decoded.Prompts) != 1 {
		t.Fatalf("decoded fork extension=%#v, ok=%v", decoded, ok)
	}
	if decoded.Prompts[0].DoneTurnIndex != 7 || len(decoded.Prompts[0].ContentBlocks) != 1 {
		t.Fatalf("decoded prompts=%#v", decoded.Prompts)
	}
}
