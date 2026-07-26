package client

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	acp "github.com/swm8023/wheelmaker/internal/protocol"
)

type steerTestCall struct {
	sessionID       string
	clientMessageID string
	blocks          []acp.ContentBlock
}

type steerTestInstance struct {
	*testInjectedInstance

	promptStarted chan string
	promptRelease chan struct{}
	releaseOnce   sync.Once

	mu         sync.Mutex
	steerCalls []steerTestCall
	steerFn    func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error)
}

func newSteerTestInstance() *steerTestInstance {
	instance := &steerTestInstance{
		promptStarted: make(chan string, 16),
		promptRelease: make(chan struct{}),
	}
	instance.testInjectedInstance = &testInjectedInstance{
		name:      string(acp.ACPProviderCodex),
		sessionID: "sess-steer",
		alive:     true,
		promptFn: func(_ context.Context, text string) (<-chan acp.SessionUpdateParams, acp.SessionPromptResult, error) {
			instance.promptStarted <- text
			if text == "initial" {
				<-instance.promptRelease
			}
			updates := make(chan acp.SessionUpdateParams)
			close(updates)
			return updates, acp.SessionPromptResult{StopReason: acp.StopReasonEndTurn}, nil
		},
	}
	return instance
}

func (i *steerTestInstance) SteerSession(
	ctx context.Context,
	sessionID string,
	clientMessageID string,
	blocks []acp.ContentBlock,
) (agent.SessionSteerResult, error) {
	i.mu.Lock()
	i.steerCalls = append(i.steerCalls, steerTestCall{
		sessionID:       sessionID,
		clientMessageID: clientMessageID,
		blocks:          cloneSessionContentBlocks(blocks),
	})
	fn := i.steerFn
	i.mu.Unlock()
	if fn != nil {
		return fn(ctx, sessionID, clientMessageID, blocks)
	}
	return agent.SessionSteerResult{ProviderTurnID: "turn-1"}, nil
}

func (i *steerTestInstance) waitForPromptStart(t *testing.T) string {
	t.Helper()
	select {
	case text := <-i.promptStarted:
		return text
	case <-time.After(time.Second):
		t.Fatal("prompt did not start")
		return ""
	}
}

func (i *steerTestInstance) finishPrompt() {
	i.releaseOnce.Do(func() { close(i.promptRelease) })
}

func (i *steerTestInstance) calls() []steerTestCall {
	i.mu.Lock()
	defer i.mu.Unlock()
	out := make([]steerTestCall, len(i.steerCalls))
	copy(out, i.steerCalls)
	return out
}

func newReadySteerTestSession(t *testing.T, instance *steerTestInstance) *Session {
	t.Helper()
	session := mustNewSession(t, "sess-steer", t.TempDir(), string(acp.ACPProviderCodex))
	session.mu.Lock()
	session.instance = instance
	session.acpSessionID = "sess-steer"
	session.initialized = true
	session.ready = true
	session.Status = SessionActive
	session.mu.Unlock()
	instance.SetCallbacks(session)
	t.Cleanup(instance.finishPrompt)
	return session
}

func steerTextParams(clientMessageID, text string) acp.SessionSteerParams {
	return acp.SessionSteerParams{
		SessionID:       "sess-steer",
		ClientMessageID: clientMessageID,
		Blocks: []acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: text,
		}},
	}
}

func startBlockingSteerPrompt(t *testing.T, session *Session, instance *steerTestInstance) <-chan error {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- session.handlePromptBlocks([]acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: "initial",
		}})
	}()
	if got := instance.waitForPromptStart(t); got != "initial" {
		t.Fatalf("first prompt = %q, want initial", got)
	}
	return done
}

func waitSteerPromptDone(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("prompt did not finish")
	}
}

func TestSessionSteerRunsWhilePromptOwnsExecutionLock(t *testing.T) {
	instance := newSteerTestInstance()
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)

	result, err := session.Steer(context.Background(), steerTextParams("queued-1", "steer"))
	if err != nil {
		t.Fatalf("Steer(): %v", err)
	}
	if result.Outcome != acp.SessionSteerOutcomeSteered {
		t.Fatalf("outcome = %q", result.Outcome)
	}

	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)
}

func TestSessionSteerSerializesRequestsByCallOrder(t *testing.T) {
	instance := newSteerTestInstance()
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)
	entered := make(chan string, 2)
	releaseFirst := make(chan struct{})
	instance.steerFn = func(_ context.Context, _ string, clientMessageID string, _ []acp.ContentBlock) (agent.SessionSteerResult, error) {
		entered <- clientMessageID
		if clientMessageID == "queued-1" {
			<-releaseFirst
		}
		return agent.SessionSteerResult{ProviderTurnID: "turn-1"}, nil
	}

	results := make(chan error, 2)
	go func() {
		_, err := session.Steer(context.Background(), steerTextParams("queued-1", "first"))
		results <- err
	}()
	if got := <-entered; got != "queued-1" {
		t.Fatalf("first steer = %q", got)
	}
	go func() {
		_, err := session.Steer(context.Background(), steerTextParams("queued-2", "second"))
		results <- err
	}()
	select {
	case got := <-entered:
		t.Fatalf("second steer entered before first completed: %q", got)
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseFirst)
	if got := <-entered; got != "queued-2" {
		t.Fatalf("second steer = %q", got)
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)

	calls := instance.calls()
	if got := []string{calls[0].clientMessageID, calls[1].clientMessageID}; !reflect.DeepEqual(got, []string{"queued-1", "queued-2"}) {
		t.Fatalf("steer call order = %#v", got)
	}
}

func TestSessionSteerInactiveBecomesPriorityPrompt(t *testing.T) {
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, agent.ErrSessionSteerInactive
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)

	result, err := session.Steer(context.Background(), steerTextParams("queued-1", "fallback"))
	if err != nil {
		t.Fatalf("Steer(): %v", err)
	}
	if result.Outcome != acp.SessionSteerOutcomeSent {
		t.Fatalf("outcome = %q", result.Outcome)
	}

	instance.finishPrompt()
	if got := instance.waitForPromptStart(t); got != "fallback" {
		t.Fatalf("fallback prompt = %q", got)
	}
	waitSteerPromptDone(t, promptDone)
}

func TestSessionSteerNonHeadFallbackRunsBeforeNormalSend(t *testing.T) {
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, agent.ErrSessionSteerInactive
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)
	if _, err := session.Steer(context.Background(), steerTextParams("queued-1", "priority")); err != nil {
		t.Fatal(err)
	}

	normalResult := make(chan error, 1)
	go func() {
		normalResult <- session.handlePromptBlocks([]acp.ContentBlock{{
			Type: acp.ContentBlockTypeText,
			Text: "normal",
		}})
	}()
	if err := <-normalResult; !errors.Is(err, agent.ErrSessionBusy) {
		t.Fatalf("normal prompt error = %v, want busy while fallback is owned", err)
	}
	instance.finishPrompt()
	if got := instance.waitForPromptStart(t); got != "priority" {
		t.Fatalf("next prompt = %q, want priority", got)
	}
	waitSteerPromptDone(t, promptDone)
}

func TestSessionSteerMultipleFallbacksKeepClickOrder(t *testing.T) {
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, agent.ErrSessionSteerInactive
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)

	for index, text := range []string{"fallback-1", "fallback-2", "fallback-3"} {
		result, err := session.Steer(context.Background(), steerTextParams("queued-"+string(rune('1'+index)), text))
		if err != nil || result.Outcome != acp.SessionSteerOutcomeSent {
			t.Fatalf("Steer(%q) = %#v, %v", text, result, err)
		}
	}
	instance.finishPrompt()
	for _, want := range []string{"fallback-1", "fallback-2", "fallback-3"} {
		if got := instance.waitForPromptStart(t); got != want {
			t.Fatalf("fallback prompt = %q, want %q", got, want)
		}
	}
	waitSteerPromptDone(t, promptDone)
}

func TestSessionSteerUnavailableDoesNotTakeOwnership(t *testing.T) {
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, agent.ErrSessionSteerUnavailable
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)

	if _, err := session.Steer(context.Background(), steerTextParams("queued-1", "do not send")); !errors.Is(err, agent.ErrSessionSteerUnavailable) {
		t.Fatalf("Steer() error = %v", err)
	}
	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)
	select {
	case got := <-instance.promptStarted:
		t.Fatalf("unexpected fallback prompt %q", got)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSessionSteerProviderFailureDoesNotTakeOwnership(t *testing.T) {
	providerErr := errors.New("provider disconnected")
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, providerErr
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)

	if _, err := session.Steer(context.Background(), steerTextParams("queued-1", "do not send")); !errors.Is(err, providerErr) {
		t.Fatalf("Steer() error = %v", err)
	}
	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)
	select {
	case got := <-instance.promptStarted:
		t.Fatalf("unexpected fallback prompt %q", got)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSessionSteerDuplicateClientMessageReturnsCachedOutcome(t *testing.T) {
	instance := newSteerTestInstance()
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)
	params := steerTextParams("queued-1", "once")

	first, err := session.Steer(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	second, err := session.Steer(context.Background(), params)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("duplicate result = %#v, want %#v", second, first)
	}
	if calls := instance.calls(); len(calls) != 1 {
		t.Fatalf("steer calls = %d, want 1", len(calls))
	}
	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)
}

func TestSessionSteerIdleStartsPromptBeforeAccepting(t *testing.T) {
	instance := newSteerTestInstance()
	session := newReadySteerTestSession(t, instance)

	result, err := session.Steer(context.Background(), steerTextParams("queued-1", "idle fallback"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != acp.SessionSteerOutcomeSent {
		t.Fatalf("outcome = %q", result.Outcome)
	}
	if got := instance.waitForPromptStart(t); got != "idle fallback" {
		t.Fatalf("idle fallback prompt = %q", got)
	}
}

func TestSessionSteerStateClearedOnSuspendAndConnectionReset(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		reset func(*Session)
	}{
		{
			name: "suspend",
			reset: func(session *Session) {
				if err := session.Suspend(context.Background()); err != nil {
					t.Fatalf("Suspend(): %v", err)
				}
			},
		},
		{
			name: "dead connection",
			reset: func(session *Session) {
				if !session.resetDeadConnection(errors.New("agent process exited")) {
					t.Fatal("resetDeadConnection() = false")
				}
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			instance := newSteerTestInstance()
			session := newReadySteerTestSession(t, instance)
			session.mu.Lock()
			session.steerState = sessionSteerState{
				nextGeneration:     7,
				active:             &sessionPromptGeneration{},
				acceptingFallbacks: true,
				priority:           []sessionPriorityPrompt{{clientMessageID: "queued-1"}},
				outcomes: map[string]acp.SessionSteerAccepted{
					"queued-1": {ClientMessageID: "queued-1"},
				},
				outcomeOrder: []string{"queued-1"},
			}
			session.mu.Unlock()

			testCase.reset(session)

			session.mu.Lock()
			state := session.steerState
			session.mu.Unlock()
			if state.nextGeneration != 0 || state.active != nil || state.acceptingFallbacks ||
				len(state.priority) != 0 || len(state.outcomes) != 0 || len(state.outcomeOrder) != 0 {
				t.Fatalf("steer state after reset = %#v", state)
			}
		})
	}
}

func TestSessionSteerSuspendDiscardsAcceptedFallback(t *testing.T) {
	instance := newSteerTestInstance()
	instance.steerFn = func(context.Context, string, string, []acp.ContentBlock) (agent.SessionSteerResult, error) {
		return agent.SessionSteerResult{}, agent.ErrSessionSteerInactive
	}
	session := newReadySteerTestSession(t, instance)
	promptDone := startBlockingSteerPrompt(t, session, instance)
	result, err := session.Steer(context.Background(), steerTextParams("queued-1", "discard after suspend"))
	if err != nil || result.Outcome != acp.SessionSteerOutcomeSent {
		t.Fatalf("Steer() = %#v, %v", result, err)
	}
	if err := session.Suspend(context.Background()); err != nil {
		t.Fatal(err)
	}

	instance.finishPrompt()
	waitSteerPromptDone(t, promptDone)
	session.mu.Lock()
	state := session.steerState
	session.mu.Unlock()
	if state.nextGeneration != 0 || state.active != nil || state.acceptingFallbacks || len(state.priority) != 0 {
		t.Fatalf("steer state restarted after suspend = %#v", state)
	}
}
