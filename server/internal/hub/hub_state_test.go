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
