package hub

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestHubStateManagerGetStartsEmpty(t *testing.T) {
	manager := newHubStateManager("hub-a", nil)

	state := manager.get(nil)

	if state.HubID != "hub-a" {
		t.Fatalf("HubID = %q, want %q", state.HubID, "hub-a")
	}
	if state.Status != hubStateStatusEmpty {
		t.Fatalf("Status = %q, want %q", state.Status, hubStateStatusEmpty)
	}
	if len(state.Sections) != 0 {
		t.Fatalf("Sections length = %d, want 0", len(state.Sections))
	}
}

func TestHubStateManagerRefreshUpdatesOneSection(t *testing.T) {
	fixedNow := time.Date(2026, 6, 5, 10, 11, 12, 0, time.UTC)
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]any{"ok": true, "providers": []any{}}, nil
			},
		},
	})
	manager.now = func() time.Time { return fixedNow }

	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("refresh returned error: %v", err)
	}

	if state.Status != hubStateStatusReady {
		t.Fatalf("Status = %q, want %q", state.Status, hubStateStatusReady)
	}
	section := state.Sections[hubStateSectionTokenStats]
	if section.Status != hubStateSectionStatusReady {
		t.Fatalf("Section status = %q, want %q", section.Status, hubStateSectionStatusReady)
	}
	if section.Data == nil {
		t.Fatal("Section Data is nil, want non-nil")
	}
	if section.UpdatedAt != fixedNow.Format(time.RFC3339) {
		t.Fatalf("Section UpdatedAt = %q, want %q", section.UpdatedAt, fixedNow.Format(time.RFC3339))
	}
}

func TestHubStateManagerRefreshFailureKeepsPreviousData(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]any{"ok": true}, nil
			},
		},
	})

	_, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("first refresh returned error: %v", err)
	}

	manager.handlers[hubStateSectionTokenStats] = hubStateSectionHandler{
		Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
			return nil, errors.New("token scan failed")
		},
	}

	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("second refresh returned error: %v", err)
	}

	section := state.Sections[hubStateSectionTokenStats]
	if section.Status != hubStateSectionStatusError {
		t.Fatalf("Section status = %q, want %q", section.Status, hubStateSectionStatusError)
	}
	if section.Data == nil {
		t.Fatal("Section Data is nil, want previous data retained")
	}
	if section.Error != "token scan failed" {
		t.Fatalf("Section Error = %q, want %q", section.Error, "token scan failed")
	}
}

func TestHubStateManagerActionStoresActionResult(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(ctx context.Context, actionName string, params map[string]any) (any, error) {
				if actionName != "install" {
					t.Fatalf("actionName = %q, want %q", actionName, "install")
				}
				if params["packageName"] != "@openai/codex" {
					t.Fatalf("packageName = %v, want %q", params["packageName"], "@openai/codex")
				}
				return map[string]any{"installed": true}, nil
			},
		},
	})

	state, err := manager.action(context.Background(), hubStateSectionAgentPackages, "install", map[string]any{"packageName": "@openai/codex"})
	if err != nil {
		t.Fatalf("action returned error: %v", err)
	}

	action := state.Sections[hubStateSectionAgentPackages].Action
	if action == nil {
		t.Fatal("Action is nil, want stored action result")
	}
	if action.Name != "install" {
		t.Fatalf("Action name = %q, want %q", action.Name, "install")
	}
	if action.Status != hubStateActionStatusSucceeded {
		t.Fatalf("Action status = %q, want %q", action.Status, hubStateActionStatusSucceeded)
	}
	if action.Result == nil {
		t.Fatal("Action Result is nil, want non-nil")
	}
}

func TestHubStateManagerConcurrentActionCompletionKeepsLatestAction(t *testing.T) {
	slowStarted := make(chan struct{})
	releaseSlow := make(chan struct{})
	slowDone := make(chan struct{})
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(ctx context.Context, actionName string, params map[string]any) (any, error) {
				if actionName == "slow" {
					close(slowStarted)
					<-releaseSlow
					return map[string]any{"action": "slow"}, nil
				}
				return map[string]any{"action": "fast"}, nil
			},
		},
	})

	go func() {
		defer close(slowDone)
		if _, err := manager.action(context.Background(), hubStateSectionAgentPackages, "slow", nil); err != nil {
			t.Errorf("slow action returned error: %v", err)
		}
	}()
	<-slowStarted

	state, err := manager.action(context.Background(), hubStateSectionAgentPackages, "fast", nil)
	if err != nil {
		t.Fatalf("fast action returned error: %v", err)
	}
	if got := state.Sections[hubStateSectionAgentPackages].Action.Name; got != "fast" {
		t.Fatalf("action name after fast = %q, want fast", got)
	}

	close(releaseSlow)
	<-slowDone

	state = manager.get(nil)
	action := state.Sections[hubStateSectionAgentPackages].Action
	if action == nil {
		t.Fatal("Action is nil, want fast action retained")
	}
	if action.Name != "fast" {
		t.Fatalf("Action name = %q, want fast", action.Name)
	}
	result, ok := action.Result.(map[string]any)
	if !ok {
		t.Fatalf("Action Result = %#v, want map", action.Result)
	}
	if result["action"] != "fast" {
		t.Fatalf("Action Result action = %v, want fast", result["action"])
	}
}

func TestHubStateManagerSnapshotDataMutationDoesNotAlterState(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]any{
					"ok":        true,
					"providers": []any{map[string]any{"name": "codex"}},
				}, nil
			},
		},
	})

	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("refresh returned error: %v", err)
	}
	data := state.Sections[hubStateSectionTokenStats].Data.(map[string]any)
	data["ok"] = false
	data["new"] = "mutated"
	providers := data["providers"].([]any)
	providers[0].(map[string]any)["name"] = "mutated"
	data["providers"] = append(providers, "extra")

	state = manager.get(nil)
	data = state.Sections[hubStateSectionTokenStats].Data.(map[string]any)
	if data["ok"] != true {
		t.Fatalf("ok = %v, want true", data["ok"])
	}
	if _, exists := data["new"]; exists {
		t.Fatalf("new key exists in manager state: %#v", data)
	}
	providers = data["providers"].([]any)
	if len(providers) != 1 {
		t.Fatalf("providers length = %d, want 1", len(providers))
	}
	if providers[0].(map[string]any)["name"] != "codex" {
		t.Fatalf("provider name = %v, want codex", providers[0].(map[string]any)["name"])
	}
}

func TestHubStateManagerSnapshotActionResultMutationDoesNotAlterState(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(context.Context, string, map[string]any) (any, error) {
				return map[string]any{"packages": []any{map[string]any{"name": "@openai/codex"}}}, nil
			},
		},
	})

	state, err := manager.action(context.Background(), hubStateSectionAgentPackages, "install", map[string]any{
		"packageName": "@openai/codex",
	})
	if err != nil {
		t.Fatalf("action returned error: %v", err)
	}
	result := state.Sections[hubStateSectionAgentPackages].Action.Result.(map[string]any)
	result["packages"].([]any)[0].(map[string]any)["name"] = "mutated"
	result["new"] = "mutated"

	state = manager.get(nil)
	result = state.Sections[hubStateSectionAgentPackages].Action.Result.(map[string]any)
	if _, exists := result["new"]; exists {
		t.Fatalf("new key exists in manager action result: %#v", result)
	}
	packages := result["packages"].([]any)
	if packages[0].(map[string]any)["name"] != "@openai/codex" {
		t.Fatalf("package name = %v, want @openai/codex", packages[0].(map[string]any)["name"])
	}
}

func TestHubStateManagerSnapshotTypedContainersDoNotAlterState(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionTokenStats: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				return map[string]string{"provider": "codex"}, nil
			},
		},
	})

	state, err := manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("refresh returned error: %v", err)
	}
	data := state.Sections[hubStateSectionTokenStats].Data.(map[string]string)
	data["provider"] = "mutated"

	state = manager.get(nil)
	data = state.Sections[hubStateSectionTokenStats].Data.(map[string]string)
	if data["provider"] != "codex" {
		t.Fatalf("provider = %q, want codex", data["provider"])
	}

	manager.handlers[hubStateSectionTokenStats] = hubStateSectionHandler{
		Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
			return []string{"codex"}, nil
		},
	}
	state, err = manager.refresh(context.Background(), []string{hubStateSectionTokenStats}, false)
	if err != nil {
		t.Fatalf("second refresh returned error: %v", err)
	}
	labels := state.Sections[hubStateSectionTokenStats].Data.([]string)
	labels[0] = "mutated"

	state = manager.get(nil)
	labels = state.Sections[hubStateSectionTokenStats].Data.([]string)
	if labels[0] != "codex" {
		t.Fatalf("label = %q, want codex", labels[0])
	}
}

func TestHubStateManagerSnapshotNestedTypedContainersDoNotAlterState(t *testing.T) {
	manager := newHubStateManager("hub-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(context.Context, string, map[string]any) (any, error) {
				return []map[string]any{{"labels": []string{"a"}}}, nil
			},
		},
	})

	params := map[string]any{"metadata": map[string]any{"labels": []string{"a"}}}
	state, err := manager.action(context.Background(), hubStateSectionAgentPackages, "install", params)
	if err != nil {
		t.Fatalf("action returned error: %v", err)
	}
	action := state.Sections[hubStateSectionAgentPackages].Action
	action.Params["metadata"].(map[string]any)["labels"].([]string)[0] = "mutated"
	action.Result.([]map[string]any)[0]["labels"].([]string)[0] = "mutated"

	state = manager.get(nil)
	action = state.Sections[hubStateSectionAgentPackages].Action
	if got := action.Params["metadata"].(map[string]any)["labels"].([]string)[0]; got != "a" {
		t.Fatalf("param label = %q, want a", got)
	}
	if got := action.Result.([]map[string]any)[0]["labels"].([]string)[0]; got != "a" {
		t.Fatalf("result label = %q, want a", got)
	}
}
