package hub

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func TestHubStateRefreshReturnsBeforeUpdaterCompletesAndCoalesces(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var calls atomic.Int32
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"skills": []string{"scope"}}, nil
			},
		},
	}, nil)

	first, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false)
	if err != nil || !first.Accepted {
		t.Fatalf("first refresh = %#v, %v", first, err)
	}
	waitSignal(t, started)
	second, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.Updates[0].UpdateID != second.Updates[0].UpdateID {
		t.Fatalf("duplicate refresh was not coalesced: %#v %#v", first, second)
	}
	close(release)
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
}

func TestHubStateForceDuringRunSchedulesOnlyOneRerun(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{}, 2)
	var calls atomic.Int32
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				run := calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"run": run}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	waitSignal(t, started)
	for range 2 {
		if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, true); err != nil {
			t.Fatal(err)
		}
	}
	release <- struct{}{}
	waitSignal(t, started)
	release <- struct{}{}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	if calls.Load() != 2 {
		t.Fatalf("calls = %d, want 2", calls.Load())
	}
}

func TestHubStateNotificationWinsOverOlderScan(t *testing.T) {
	started := make(chan struct{}, 2)
	release := make(chan struct{}, 2)
	var calls atomic.Int32
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				run := calls.Add(1)
				started <- struct{}{}
				<-release
				return map[string]any{"source": "scan", "run": run}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	waitSignal(t, started)
	manager.notify(
		hubStateSectionSkills,
		map[string]any{"source": "notification"},
		rp.HubStateAvailabilityReady,
		"",
		"skills-files-changed",
	)
	release <- struct{}{}
	waitSignal(t, started)
	duringRerun := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got := duringRerun.Data.(map[string]any)["source"]; got != "notification" {
		t.Fatalf("data during rerun = %#v", duringRerun.Data)
	}
	release <- struct{}{}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	final := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got := final.Data.(map[string]any)["run"]; got != int32(2) {
		t.Fatalf("final data = %#v", final.Data)
	}
}

func TestHubStateRefreshFailureRetainsCommittedData(t *testing.T) {
	var fail atomic.Bool
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				if fail.Load() {
					return nil, errors.New("scan failed")
				}
				return map[string]any{"version": 1}, nil
			},
		},
	}, nil)

	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, false); err != nil {
		t.Fatal(err)
	}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	fail.Store(true)
	if _, err := manager.enqueueRefresh([]string{hubStateSectionSkills}, true); err != nil {
		t.Fatal(err)
	}
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	got := manager.get([]string{hubStateSectionSkills}).Sections[hubStateSectionSkills]
	if got.Availability != rp.HubStateAvailabilityReady ||
		got.UpdateStatus != rp.HubStateUpdateIdle ||
		got.LastError != "scan failed" {
		t.Fatalf("failed refresh state = %#v", got)
	}
	if got.Data.(map[string]any)["version"] != 1 {
		t.Fatalf("committed data was cleared: %#v", got.Data)
	}
}

func TestHubStateDifferentSectionsRunConcurrently(t *testing.T) {
	started := make(chan string, 2)
	release := make(chan struct{})
	handler := func(section string) hubStateSectionHandler {
		return hubStateSectionHandler{
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				started <- section
				<-release
				return map[string]any{"section": section}, nil
			},
		}
	}
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills:    handler(hubStateSectionSkills),
		hubStateSectionFileIndex: handler(hubStateSectionFileIndex),
	}, nil)

	if _, err := manager.enqueueRefresh(
		[]string{hubStateSectionSkills, hubStateSectionFileIndex},
		false,
	); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{
		waitValue(t, started): true,
		waitValue(t, started): true,
	}
	if !got[hubStateSectionSkills] || !got[hubStateSectionFileIndex] {
		t.Fatalf("started sections = %v", got)
	}
	close(release)
	waitHubStateSectionIdle(t, manager, hubStateSectionSkills)
	waitHubStateSectionIdle(t, manager, hubStateSectionFileIndex)
}

func TestHubStateActionDoesNotReplaceSectionData(t *testing.T) {
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Action: func(context.Context, string, map[string]any) (any, error) {
				return map[string]any{"operationId": "npm-1"}, nil
			},
		},
	}, nil)
	manager.notify(
		hubStateSectionAgentPackages,
		map[string]any{"packages": []string{"existing"}},
		rp.HubStateAvailabilityReady,
		"",
		"seed",
	)

	response, err := manager.action(
		context.Background(),
		hubStateSectionAgentPackages,
		"install",
		map[string]any{"packageName": "@openai/codex"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Result.(map[string]any)["operationId"] != "npm-1" {
		t.Fatalf("action response = %#v", response)
	}
	data := manager.get(nil).Sections[hubStateSectionAgentPackages].Data
	if !reflect.DeepEqual(data, map[string]any{"packages": []string{"existing"}}) {
		t.Fatalf("action replaced committed data: %#v", data)
	}
}

func TestHubStateSnapshotMutationDoesNotAlterCommittedData(t *testing.T) {
	manager := newHubStateManager("hub-a", "instance-a", map[string]hubStateSectionHandler{
		hubStateSectionSkills: {},
	}, nil)
	manager.notify(
		hubStateSectionSkills,
		map[string]any{"skills": []any{map[string]any{"name": "scope"}}},
		rp.HubStateAvailabilityReady,
		"",
		"seed",
	)

	first := manager.get(nil)
	first.Sections[hubStateSectionSkills].Data.(map[string]any)["skills"].([]any)[0].(map[string]any)["name"] = "mutated"

	second := manager.get(nil)
	got := second.Sections[hubStateSectionSkills].Data.(map[string]any)["skills"].([]any)[0].(map[string]any)["name"]
	if got != "scope" {
		t.Fatalf("committed data mutated through snapshot: %v", got)
	}
}

func waitHubStateSectionIdle(t *testing.T, manager *HubStateManager, section string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := manager.waitForIdle(ctx, section); err != nil {
		t.Fatal(err)
	}
}

func waitSignal(t *testing.T, values <-chan struct{}) {
	t.Helper()
	select {
	case <-values:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for signal")
	}
}

func waitValue[T any](t *testing.T, values <-chan T) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(5 * time.Second):
		var zero T
		t.Fatal("timed out waiting for value")
		return zero
	}
}
