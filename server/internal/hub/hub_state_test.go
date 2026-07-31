package hub

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
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

func TestReporterBootstrapRefreshesOperationalSectionsOnce(t *testing.T) {
	var calls sync.Map
	handlers := map[string]hubStateSectionHandler{}
	for _, section := range append(
		append([]string(nil), bootstrapHubStateSections...),
		hubStateSectionTokenStats,
	) {
		name := section
		handlers[name] = hubStateSectionHandler{
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				counter, _ := calls.LoadOrStore(name, &atomic.Int32{})
				counter.(*atomic.Int32).Add(1)
				return map[string]any{"section": name}, nil
			},
		}
	}
	reporter := &Reporter{cfg: ReporterConfig{HubID: "hub-a"}}
	reporter.hubStateManager = newHubStateManager(
		"hub-a",
		"instance-a",
		handlers,
		nil,
	)

	reporter.bootstrapHubState(context.Background())

	for _, section := range bootstrapHubStateSections {
		value, ok := calls.Load(section)
		if !ok || value.(*atomic.Int32).Load() != 1 {
			t.Fatalf("%s calls = %v, want 1", section, value)
		}
	}
	if value, ok := calls.Load(hubStateSectionTokenStats); ok && value.(*atomic.Int32).Load() != 0 {
		t.Fatalf("tokenStats bootstrap calls = %d, want 0", value.(*atomic.Int32).Load())
	}
}

func TestProjectTopologyChangeRefreshesSkillsAndFileIndex(t *testing.T) {
	var refreshed sync.Map
	handler := func(name string) hubStateSectionHandler {
		return hubStateSectionHandler{
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				counter, _ := refreshed.LoadOrStore(name, &atomic.Int32{})
				counter.(*atomic.Int32).Add(1)
				return map[string]any{"section": name}, nil
			},
		}
	}
	reporter := &Reporter{
		cfg:          ReporterConfig{HubID: "hub-a"},
		projectsByID: map[string]ProjectInfo{},
	}
	reporter.hubStateManager = newHubStateManager(
		"hub-a",
		"instance-a",
		map[string]hubStateSectionHandler{
			hubStateSectionSkills:    handler(hubStateSectionSkills),
			hubStateSectionFileIndex: handler(hubStateSectionFileIndex),
		},
		nil,
	)
	assertRefreshes := func(label string, skills, fileIndex int32) {
		t.Helper()
		waitHubStateSectionIdle(t, reporter.hubStateManager, hubStateSectionSkills)
		waitHubStateSectionIdle(t, reporter.hubStateManager, hubStateSectionFileIndex)
		for name, want := range map[string]int32{
			hubStateSectionSkills:    skills,
			hubStateSectionFileIndex: fileIndex,
		} {
			value, _ := refreshed.LoadOrStore(name, &atomic.Int32{})
			if got := value.(*atomic.Int32).Load(); got != want {
				t.Fatalf("%s %s refreshes = %d, want %d", label, name, got, want)
			}
		}
	}

	reporter.replaceProjects([]ProjectInfo{{Name: "project", Path: t.TempDir()}})
	assertRefreshes("add", 1, 1)
	reporter.replaceProjects([]ProjectInfo{{Name: "project", Path: t.TempDir()}})
	assertRefreshes("path", 2, 2)
	reporter.replaceProjects(nil)
	assertRefreshes("remove", 3, 3)
}

func TestUpdateProjectPathRefreshesSkillsAndFileIndex(t *testing.T) {
	started := make(chan string, 2)
	reporter := &Reporter{
		cfg: ReporterConfig{HubID: "hub-a"},
		projects: []ProjectInfo{{
			Name: "project",
			Path: "old",
		}},
		projectsByID: map[string]ProjectInfo{
			"project":       {Name: "project", Path: "old"},
			"hub-a:project": {Name: "project", Path: "old"},
		},
	}
	handler := func(name string) hubStateSectionHandler {
		return hubStateSectionHandler{
			Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
				started <- name
				return map[string]any{"section": name}, nil
			},
		}
	}
	reporter.hubStateManager = newHubStateManager(
		"hub-a",
		"instance-a",
		map[string]hubStateSectionHandler{
			hubStateSectionSkills:    handler(hubStateSectionSkills),
			hubStateSectionFileIndex: handler(hubStateSectionFileIndex),
		},
		nil,
	)

	if err := reporter.UpdateProject(ProjectInfo{Name: "project", Path: "new"}); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{
		waitValue(t, started): true,
		waitValue(t, started): true,
	}
	if !got[hubStateSectionSkills] || !got[hubStateSectionFileIndex] {
		t.Fatalf("refreshed sections = %v", got)
	}
}

func TestReporterPublishesCurrentSnapshotWithoutRefreshing(t *testing.T) {
	var refreshes atomic.Int32
	reporter := &Reporter{
		cfg:          ReporterConfig{HubID: "hub-a"},
		projectsByID: map[string]ProjectInfo{},
		hubEventSink: newHubEventSink(),
	}
	reporter.hubStateManager = newHubStateManager(
		"hub-a",
		"instance-a",
		map[string]hubStateSectionHandler{
			hubStateSectionSkills: {
				Refresh: func(context.Context, hubStateRefreshInput) (any, error) {
					refreshes.Add(1)
					return nil, nil
				},
			},
		},
		nil,
	)
	reporter.hubStateManager.notify(
		hubStateSectionSkills,
		map[string]any{"name": "scope"},
		rp.HubStateAvailabilityReady,
		"",
		"seed",
	)

	reporter.publishCurrentHubState("reconnect")

	event := waitValue(t, reporter.hubEventSink.events)
	var payload struct {
		InstanceID string                        `json:"instanceId"`
		Sections   map[string]rp.HubStateSection `json:"sections"`
		Reason     string                        `json:"reason"`
	}
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.InstanceID != "instance-a" || payload.Reason != "reconnect" {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.Sections[hubStateSectionSkills].Revision != 1 {
		t.Fatalf("skills section = %#v", payload.Sections[hubStateSectionSkills])
	}
	if refreshes.Load() != 0 {
		t.Fatalf("snapshot publish invoked %d refreshes", refreshes.Load())
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
