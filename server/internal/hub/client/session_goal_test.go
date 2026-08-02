package client

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

func newGoalTestClient(t *testing.T, sessionID string) (*Client, *Session, *testInjectedInstance) {
	t.Helper()
	client := newTestClient(t, &mockSession{agentName: string(acp.ACPProviderCodex), sessionID: sessionID})
	session, err := client.SessionForTest(sessionID)
	if err != nil {
		t.Fatalf("SessionForTest(): %v", err)
	}
	session.mu.Lock()
	session.agentState.AgentCapabilities = wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{
		Compact: true, Steer: true, Fork: true, Goal: true,
	})
	session.mu.Unlock()
	session.mu.Lock()
	runtime, ok := session.instance.(*testInjectedInstance)
	session.mu.Unlock()
	if !ok {
		t.Fatalf("runtime type = %T", session.instance)
	}
	return client, session, runtime
}

func TestSessionGoalCreateRecordsCommandWithoutPromptingAgent(t *testing.T) {
	client, session, runtime := newGoalTestClient(t, "session-goal-command")
	raw := "/goal Ship release"
	_, err := client.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionGoalCreate, "test", json.RawMessage(mustJSON(map[string]any{
		"sessionId": "session-goal-command",
		"objective": "Ship release",
	})))
	if err != nil {
		t.Fatalf("session.goal.create: %v", err)
	}
	if len(runtime.goalSetCalls) != 1 {
		t.Fatalf("goal set calls = %d", len(runtime.goalSetCalls))
	}
	if len(runtime.lastPrompt) != 0 {
		t.Fatalf("goal command reached SessionPrompt: %#v", runtime.lastPrompt)
	}
	if !session.isRunning() {
		t.Fatal("active goal did not retain Session ownership")
	}

	_, turns, err := client.sessionRecorder.ReadSessionTurns(context.Background(), "session-goal-command", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns(): %v", err)
	}
	if len(turns) != 1 {
		t.Fatalf("turns = %#v", turns)
	}
	var message acp.SessionTurnMessage
	if err := json.Unmarshal([]byte(turns[0].Content), &message); err != nil {
		t.Fatal(err)
	}
	if message.Method != acp.SessionTurnMethodPromptRequest || !strings.Contains(string(message.Param), raw) {
		t.Fatalf("raw prompt turn = %s", turns[0].Content)
	}
}

func TestSessionGoalCreateRejectsNonPositiveBudget(t *testing.T) {
	client, _, runtime := newGoalTestClient(t, "session-goal-invalid-budget")
	_, err := client.HandleSessionRequest(
		context.Background(),
		acp.RegistryMethodSessionGoalCreate,
		"test",
		json.RawMessage(mustJSON(map[string]any{
			"sessionId":   "session-goal-invalid-budget",
			"objective":   "Ship release",
			"tokenBudget": -1,
		})),
	)
	if err == nil || !strings.Contains(err.Error(), "positive") {
		t.Fatalf("session.goal.create error = %v", err)
	}
	if len(runtime.goalSetCalls) != 0 {
		t.Fatalf("invalid budget reached provider: %#v", runtime.goalSetCalls)
	}
}

func TestSessionGoalDoesNotBecomeIdleBetweenNativeTurns(t *testing.T) {
	client, session, _ := newGoalTestClient(t, "session-goal-turns")
	_, err := client.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionGoalCreate, "test", json.RawMessage(mustJSON(map[string]any{
		"sessionId": "session-goal-turns",
		"objective": "ship",
	})))
	if err != nil {
		t.Fatalf("session.goal.create: %v", err)
	}

	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-turns",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalTurnStarted,
			TurnID:        "turn-1",
		},
	})
	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-turns",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalTurnCompleted,
			TurnID:        "turn-1",
		},
	})
	if !session.isRunning() {
		t.Fatal("active goal became idle between turns")
	}

	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-turns",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalTurnStarted,
			TurnID:        "turn-2",
		},
	})
	complete := *runtimeGoalForTest(t, session)
	complete.Status = acp.SessionGoalStatusComplete
	complete.UpdatedAt = time.Now().Unix()
	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-turns",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalUpdated,
			Goal:          &complete,
		},
	})
	if !session.isRunning() {
		t.Fatal("goal released before its physical turn completed")
	}
	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-turns",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalTurnCompleted,
			TurnID:        "turn-2",
		},
	})
	if session.isRunning() {
		t.Fatal("completed goal retained Session ownership")
	}

	_, turns, err := client.sessionRecorder.ReadSessionTurns(context.Background(), "session-goal-turns", 0)
	if err != nil {
		t.Fatalf("ReadSessionTurns(): %v", err)
	}
	methods := make([]string, 0, len(turns))
	for _, turn := range turns {
		var message acp.SessionTurnMessage
		if err := json.Unmarshal([]byte(turn.Content), &message); err != nil {
			t.Fatal(err)
		}
		methods = append(methods, message.Method)
	}
	if strings.Join(methods, ",") != "prompt_request,system,prompt_done" {
		t.Fatalf("turn methods = %v", methods)
	}
}

func TestSessionGoalResumeUpgradesOrdinaryPromptOwnership(t *testing.T) {
	_, session, runtime := newGoalTestClient(t, "session-goal-upgrade")
	paused := &acp.SessionGoal{
		SessionID: "session-goal-upgrade",
		Objective: "ship",
		Status:    acp.SessionGoalStatusPaused,
		CreatedAt: 10,
		UpdatedAt: 11,
	}
	session.mu.Lock()
	session.agentState.Goal = paused
	runtime.goal = paused
	session.mu.Unlock()
	if err := session.beginExecution("prompt"); err != nil {
		t.Fatalf("beginExecution(): %v", err)
	}
	active := acp.SessionGoalStatusActive
	if _, err := session.UpdateGoal(context.Background(), acp.SessionGoalSetParams{Status: &active}); err != nil {
		t.Fatalf("UpdateGoal(): %v", err)
	}
	session.mu.Lock()
	kind := session.executionKind
	session.mu.Unlock()
	if kind != "goal" {
		t.Fatalf("execution kind = %q, want goal", kind)
	}

	complete := *runtime.goal
	complete.Status = acp.SessionGoalStatusComplete
	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "session-goal-upgrade",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalUpdated,
			Goal:          &complete,
		},
	})
}

func TestClientStartRestoresOnlyActiveGoals(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "client.sqlite3"))
	if err != nil {
		t.Fatalf("NewStore(): %v", err)
	}
	if err := store.SaveProjectDefaultAgent(context.Background(), "project-goal-restore", ""); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		id     string
		status string
	}{
		{id: "goal-active", status: acp.SessionGoalStatusActive},
		{id: "goal-paused", status: acp.SessionGoalStatusPaused},
		{id: "goal-complete", status: acp.SessionGoalStatusComplete},
	} {
		state, marshalErr := json.Marshal(SessionAgentState{AgentCapabilities: wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{Goal: true}), Goal: &acp.SessionGoal{
			SessionID: item.id,
			Objective: "ship",
			Status:    item.status,
			CreatedAt: 10,
			UpdatedAt: 11,
		}})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if err := store.SaveSession(context.Background(), &SessionRecord{
			ID:          item.id,
			ProjectName: "project-goal-restore",
			AgentType:   string(acp.ACPProviderCodex),
			AgentJSON:   string(state),
			Status:      SessionPersisted,
			CreatedAt:   time.Now(),
		}); err != nil {
			t.Fatal(err)
		}
	}

	var mu sync.Mutex
	loads := make([]string, 0)
	factory := agent.NewACPFactory()
	factory.Register(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) {
		runtime := &testInjectedInstance{
			name:  string(acp.ACPProviderCodex),
			alive: true,
			initResult: acp.InitializeResult{
				ProtocolVersion: "1",
				AgentCapabilities: acp.AgentCapabilities{
					LoadSession: true,
					Meta:        wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{Goal: true}).Meta,
				},
			},
		}
		runtime.loadUpdates = nil
		runtime.loadResult = acp.SessionLoadResult{}
		originalLoad := runtime.loadCalls
		_ = originalLoad
		return &goalRestoreCountingInstance{
			testInjectedInstance: runtime,
			onLoad: func(sessionID string) {
				mu.Lock()
				loads = append(loads, sessionID)
				mu.Unlock()
			},
		}, nil
	})
	client := NewWithRuntime(store, "project-goal-restore", t.TempDir(), RuntimeConfig{AgentFactory: factory})
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start(): %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(loads, ",") != "goal-active" {
		t.Fatalf("loaded sessions = %v", loads)
	}
	if !client.HasSessionInMemoryForTest("goal-active") ||
		client.HasSessionInMemoryForTest("goal-paused") ||
		client.HasSessionInMemoryForTest("goal-complete") {
		t.Fatal("restore materialized the wrong Goal sessions")
	}
}

func TestClientRecoversActiveGoalAfterAgentRuntimeStops(t *testing.T) {
	client, session, stoppedRuntime := newGoalTestClient(t, "goal-runtime-reconnect")
	_, err := client.HandleSessionRequest(context.Background(), acp.RegistryMethodSessionGoalCreate, "test", json.RawMessage(mustJSON(map[string]any{
		"sessionId": "goal-runtime-reconnect",
		"objective": "ship",
	})))
	if err != nil {
		t.Fatalf("session.goal.create: %v", err)
	}
	session.SessionUpdate(acp.SessionUpdateParams{
		SessionID: "goal-runtime-reconnect",
		Update: acp.SessionUpdate{
			SessionUpdate: acp.SessionUpdateGoalTurnStarted,
			TurnID:        "stopped-turn",
		},
	})

	reloaded := make(chan struct{}, 1)
	replacement := &testInjectedInstance{
		name:  string(acp.ACPProviderCodex),
		alive: true,
		initResult: acp.InitializeResult{
			ProtocolVersion: "1",
			AgentCapabilities: acp.AgentCapabilities{
				LoadSession: true,
				Meta:        wmAgentCapabilitiesForTest(acp.WMSessionActionCapabilities{Goal: true}).Meta,
			},
		},
		goal: runtimeGoalForTest(t, session),
	}
	client.InjectAgentFactory(acp.ACPProviderCodex, func(context.Context, string) (agent.Instance, error) {
		return &goalRestoreCountingInstance{
			testInjectedInstance: replacement,
			onLoad: func(sessionID string) {
				if sessionID != "goal-runtime-reconnect" {
					t.Errorf("SessionLoad session ID = %q", sessionID)
				}
				reloaded <- struct{}{}
			},
		}, nil
	})

	stoppedRuntime.alive = false
	client.recoverActiveGoals(context.Background())

	select {
	case <-reloaded:
	default:
		t.Fatal("active Goal runtime was not reloaded")
	}
	session.mu.Lock()
	current := session.instance
	status := session.agentState.Goal.Status
	kind := session.executionKind
	turnActive := session.goal.turnActive
	session.mu.Unlock()
	if current == stoppedRuntime {
		t.Fatal("stopped runtime remained attached")
	}
	if status != acp.SessionGoalStatusActive || kind != sessionGoalExecutionKind {
		t.Fatalf("recovered Goal status=%q execution=%q", status, kind)
	}
	if turnActive {
		t.Fatal("stopped runtime left its physical Goal turn active")
	}
}

func TestForkDoesNotCopyGoalSnapshot(t *testing.T) {
	client, source, _ := newGoalTestClient(t, "goal-fork-source")
	source.mu.Lock()
	source.agentState.Goal = &acp.SessionGoal{
		SessionID: source.acpSessionID,
		Objective: "ship",
		Status:    acp.SessionGoalStatusActive,
	}
	source.mu.Unlock()
	target, err := client.newForkTargetSession(source, "goal-fork-target", "Fork")
	if err != nil {
		t.Fatalf("newForkTargetSession(): %v", err)
	}
	if target.agentState.Goal != nil {
		t.Fatalf("fork inherited Goal: %#v", target.agentState.Goal)
	}
}

type goalRestoreCountingInstance struct {
	*testInjectedInstance
	onLoad func(string)
}

func (i *goalRestoreCountingInstance) SessionLoad(ctx context.Context, params acp.SessionLoadParams) (acp.SessionLoadResult, error) {
	if i.onLoad != nil {
		i.onLoad(params.SessionID)
	}
	return i.testInjectedInstance.SessionLoad(ctx, params)
}

func runtimeGoalForTest(t *testing.T, session *Session) *acp.SessionGoal {
	t.Helper()
	session.mu.Lock()
	defer session.mu.Unlock()
	if session.agentState.Goal == nil {
		t.Fatal("session goal is nil")
	}
	goal := *session.agentState.Goal
	return &goal
}
