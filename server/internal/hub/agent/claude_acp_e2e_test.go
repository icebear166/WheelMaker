package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	claudeACPE2EEnabledEnv  = "WHEELMAKER_CLAUDE_ACP_E2E"
	claudeACPE2ESettingsEnv = "WHEELMAKER_CLAUDE_ACP_E2E_SETTINGS"
)

// TestClaudeACPLifecycleE2E is intentionally opt-in because it starts the
// installed claude-agent-acp and sends real model requests. The settings file
// is copied into a temporary CLAUDE_CONFIG_DIR so the fixture never mutates the
// caller's Claude configuration or session history.
func TestClaudeACPLifecycleE2E(t *testing.T) {
	if os.Getenv(claudeACPE2EEnabledEnv) != "1" {
		t.Skipf("set %s=1 to run the live Claude ACP lifecycle fixture", claudeACPE2EEnabledEnv)
	}
	settingsPath := strings.TrimSpace(os.Getenv(claudeACPE2ESettingsEnv))
	if settingsPath == "" {
		t.Fatalf("%s must name a usable Claude settings.json", claudeACPE2ESettingsEnv)
	}
	settings, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("read Claude settings: %v", err)
	}
	configDir := filepath.Join(t.TempDir(), ".claude")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create isolated Claude config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), settings, 0o600); err != nil {
		t.Fatalf("copy isolated Claude settings: %v", err)
	}
	t.Setenv("CLAUDE_CONFIG_DIR", configDir)

	projectDir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	provider := NewClaudeProvider()
	instanceCreator := claudeACPInstanceCreator(provider)

	newInstance := func(label string) (Instance, *claudeACPE2ECallbacks) {
		t.Helper()
		inst, err := instanceCreator(WithProjectName(ctx, "claude-acp-e2e"), projectDir)
		if err != nil {
			t.Fatalf("%s: start claude-agent-acp: %v", label, err)
		}
		callbacks := newClaudeACPE2ECallbacks()
		inst.SetCallbacks(callbacks)
		return inst, callbacks
	}
	initialize := func(label string, inst Instance) protocol.InitializeResult {
		t.Helper()
		result, err := inst.Initialize(ctx, protocol.InitializeParams{
			ProtocolVersion: 1,
			ClientCapabilities: protocol.ClientCapabilities{
				FS:       &protocol.FSCapabilities{ReadTextFile: true, WriteTextFile: true},
				Terminal: true,
				Meta:     protocol.BuildWMClientCapabilitiesMeta(nil),
			},
			ClientInfo: &protocol.AgentInfo{Name: "wheelmaker-e2e", Title: "WheelMaker E2E"},
		})
		if err != nil {
			t.Fatalf("%s: initialize: %v", label, err)
		}
		return result
	}

	source, sourceCallbacks := newInstance("source")
	initResult := initialize("source", source)
	requireClaudeACPLifecycleCapabilities(t, initResult)
	created, err := source.SessionNew(ctx, protocol.SessionNewParams{CWD: projectDir, MCPServers: []protocol.MCPServer{}})
	if err != nil {
		_ = source.Close()
		t.Fatalf("session/new: %v", err)
	}
	sourceID := strings.TrimSpace(created.SessionID)
	if sourceID == "" {
		_ = source.Close()
		t.Fatal("session/new returned an empty session ID")
	}
	sourceEvents := runClaudeACPE2EPrompt(t, ctx, source, sourceCallbacks, sourceID,
		"Reply with exactly SOURCE_READY and nothing else.")
	if !strings.Contains(agentTextForE2E(sourceEvents), "SOURCE_READY") {
		_ = source.Close()
		t.Fatalf("source prompt did not produce SOURCE_READY: %q", agentTextForE2E(sourceEvents))
	}
	defer func() { _ = source.Close() }()
	drainClaudeACPE2EEvents(sourceCallbacks)
	defer deleteClaudeACPE2ESession(t, ctx, source, sourceID)

	forker, ok := source.(SessionCurrentForker)
	if !ok {
		t.Fatalf("Claude instance %T does not implement current session fork", source)
	}
	forked, err := forker.ForkCurrentSession(ctx, sourceID, projectDir)
	if err != nil {
		t.Fatalf("current session fork: %v", err)
	}
	targetID := strings.TrimSpace(forked.SessionID)
	if targetID == "" || targetID == sourceID {
		t.Fatalf("fork target ID %q is not an independent child of %q", targetID, sourceID)
	}
	defer deleteClaudeACPE2ESession(t, ctx, source, targetID)

	target, targetCallbacks := newInstance("target loader")
	initialize("target loader", target)
	defer func() { _ = target.Close() }()
	if _, err := target.SessionLoad(ctx, protocol.SessionLoadParams{
		SessionID: targetID, CWD: projectDir, MCPServers: []protocol.MCPServer{},
	}); err != nil {
		t.Fatalf("load fork target: %v", err)
	}
	drainClaudeACPE2EEvents(targetCallbacks)

	targetEvents := runClaudeACPE2EPrompt(t, ctx, target, targetCallbacks, targetID,
		"Reply with exactly CHILD_READY and nothing else.")
	if !strings.Contains(agentTextForE2E(targetEvents), "CHILD_READY") {
		t.Fatalf("fork target prompt did not produce CHILD_READY: %q", agentTextForE2E(targetEvents))
	}

	runClaudeACPNativeSteeringBeforeFirstMessageE2E(t, ctx, target, targetCallbacks, targetID)

	sourceEvents = runClaudeACPE2EPrompt(t, ctx, source, sourceCallbacks, sourceID,
		"Reply with exactly SOURCE_STILL_READY and nothing else.")
	if !strings.Contains(agentTextForE2E(sourceEvents), "SOURCE_STILL_READY") {
		t.Fatalf("source was unusable after child activity: %q", agentTextForE2E(sourceEvents))
	}
}

type claudeACPE2ECallbacks struct {
	events chan protocol.AgentEvent
}

func newClaudeACPE2ECallbacks() *claudeACPE2ECallbacks {
	return &claudeACPE2ECallbacks{events: make(chan protocol.AgentEvent, 2048)}
}

func (c *claudeACPE2ECallbacks) AgentEvent(event protocol.AgentEvent) {
	c.events <- event
}

func (c *claudeACPE2ECallbacks) SessionRequestPermission(
	_ context.Context,
	_ int64,
	params protocol.PermissionRequestParams,
) (protocol.PermissionResult, error) {
	for _, option := range params.Options {
		if strings.HasPrefix(option.Kind, "allow") {
			return protocol.PermissionResult{Outcome: "selected", OptionID: option.OptionID}, nil
		}
	}
	return protocol.PermissionResult{Outcome: "cancelled"}, nil
}

func requireClaudeACPLifecycleCapabilities(t *testing.T, result protocol.InitializeResult) {
	t.Helper()
	capabilities := result.AgentCapabilities
	if !capabilities.LoadSession || capabilities.SessionCapabilities == nil ||
		capabilities.SessionCapabilities.Fork == nil || capabilities.SessionCapabilities.Delete == nil {
		t.Fatalf("Claude ACP lifecycle capabilities are incomplete: %#v", capabilities)
	}
	if !protocol.InitializeSteeringSupported(result.Meta) {
		t.Fatalf("Claude ACP native steering is not advertised: %s", result.Meta)
	}
	if result.AgentInfo != nil {
		t.Logf("Claude ACP fixture agent=%s version=%s", result.AgentInfo.Name, result.AgentInfo.Version)
	}
}

func runClaudeACPE2EPrompt(
	t *testing.T,
	ctx context.Context,
	inst Instance,
	callbacks *claudeACPE2ECallbacks,
	sessionID string,
	prompt string,
) []protocol.AgentEvent {
	t.Helper()
	drainClaudeACPE2EEvents(callbacks)
	type promptResult struct {
		outcome protocol.PromptOutcome
		err     error
	}
	done := make(chan promptResult, 1)
	go func() {
		outcome, err := inst.SessionPrompt(ctx, protocol.SessionPromptParams{
			SessionID: sessionID,
			Prompt:    []protocol.ContentBlock{{Type: protocol.ContentBlockTypeText, Text: prompt}},
		})
		done <- promptResult{outcome: outcome, err: err}
	}()

	var events []protocol.AgentEvent
	for {
		select {
		case event := <-callbacks.events:
			events = append(events, event)
		case result := <-done:
			if result.err != nil {
				t.Fatalf("session/prompt: %v", result.err)
			}
			if result.outcome.StopReason == "" {
				t.Fatal("session/prompt returned an empty stop reason")
			}
			return append(events, drainClaudeACPE2EEvents(callbacks)...)
		case <-ctx.Done():
			t.Fatalf("session/prompt timed out: %v", ctx.Err())
		}
	}
}

func runClaudeACPNativeSteeringBeforeFirstMessageE2E(
	t *testing.T,
	ctx context.Context,
	inst Instance,
	callbacks *claudeACPE2ECallbacks,
	sessionID string,
) {
	t.Helper()
	drainClaudeACPE2EEvents(callbacks)
	promptDone := make(chan error, 1)
	go func() {
		_, err := inst.SessionPrompt(ctx, protocol.SessionPromptParams{
			SessionID: sessionID,
			Prompt: []protocol.ContentBlock{{
				Type: protocol.ContentBlockTypeText,
				Text: "Without using tools, think carefully about how to construct a very long numbered list from 1 through 5000, then write it one item per line.",
			}},
		})
		promptDone <- err
	}()

	var events []protocol.AgentEvent
	for !containsAgentThoughtForE2E(events) {
		select {
		case event := <-callbacks.events:
			events = append(events, event)
			if containsAgentMessageForE2E(events) {
				t.Fatalf("long prompt emitted an agent message before the pre-output steering window")
			}
		case err := <-promptDone:
			t.Fatalf("long prompt completed before steering (err=%v)", err)
		case <-ctx.Done():
			t.Fatalf("wait for pre-output Claude thought: %v", ctx.Err())
		}
	}

	const clientMessageID = "claude-acp-e2e-steer"
	steerer, ok := inst.(SessionSteerer)
	if !ok {
		t.Fatalf("Claude instance %T does not implement native steering", inst)
	}
	steered, err := steerer.SteerSession(ctx, sessionID, clientMessageID, []protocol.ContentBlock{{
		Type: protocol.ContentBlockTypeText,
		Text: "Stop the list now and reply with exactly STEERED_READY.",
	}})
	if err != nil {
		t.Fatalf("native session/steering: %v", err)
	}
	if steered.Outcome != protocol.SessionSteeringOutcomeInjected &&
		steered.Outcome != protocol.SessionSteeringOutcomeStartedNewTurn {
		t.Fatalf("native steering outcome=%q", steered.Outcome)
	}
	if !steered.AcceptedInput {
		t.Fatalf("native steering result=%#v, want accepted input acknowledgement", steered)
	}

	for {
		select {
		case event := <-callbacks.events:
			events = append(events, event)
		case err := <-promptDone:
			if err != nil {
				t.Fatalf("steered prompt: %v", err)
			}
			events = append(events, drainClaudeACPE2EEvents(callbacks)...)
			if !strings.Contains(agentTextForE2E(events), "STEERED_READY") {
				t.Fatalf("steered prompt did not produce STEERED_READY: %q", agentTextForE2E(events))
			}
			return
		case <-ctx.Done():
			t.Fatalf("native steering timed out: %v", ctx.Err())
		}
	}
}

func deleteClaudeACPE2ESession(t *testing.T, ctx context.Context, inst Instance, sessionID string) {
	t.Helper()
	deleter, ok := inst.(SessionDeleter)
	if !ok {
		t.Errorf("Claude instance %T does not implement session/delete for %s", inst, sessionID)
		return
	}
	if err := deleter.DeleteSession(ctx, sessionID); err != nil {
		t.Errorf("delete Claude ACP E2E session %s: %v", sessionID, err)
	}
}

func drainClaudeACPE2EEvents(callbacks *claudeACPE2ECallbacks) []protocol.AgentEvent {
	var events []protocol.AgentEvent
	for {
		select {
		case event := <-callbacks.events:
			events = append(events, event)
		default:
			return events
		}
	}
}

func containsAgentMessageForE2E(events []protocol.AgentEvent) bool {
	for _, event := range events {
		if message, ok := event.Update.(protocol.AgentMessageEvent); ok &&
			message.Kind == protocol.SessionUpdateAgentMessageChunk && strings.TrimSpace(message.Content.Text) != "" {
			return true
		}
	}
	return false
}

func containsAgentThoughtForE2E(events []protocol.AgentEvent) bool {
	for _, event := range events {
		if message, ok := event.Update.(protocol.AgentMessageEvent); ok &&
			message.Kind == protocol.SessionUpdateAgentThoughtChunk && strings.TrimSpace(message.Content.Text) != "" {
			return true
		}
	}
	return false
}

func agentTextForE2E(events []protocol.AgentEvent) string {
	var text strings.Builder
	for _, event := range events {
		message, ok := event.Update.(protocol.AgentMessageEvent)
		if !ok || message.Kind != protocol.SessionUpdateAgentMessageChunk {
			continue
		}
		text.WriteString(message.Content.Text)
	}
	return text.String()
}
