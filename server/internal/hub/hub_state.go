package hub

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type hubStateStatus string

const (
	hubStateStatusEmpty      hubStateStatus = "empty"
	hubStateStatusReady      hubStateStatus = "ready"
	hubStateStatusRefreshing hubStateStatus = "refreshing"
	hubStateStatusPartial    hubStateStatus = "partial"
	hubStateStatusError      hubStateStatus = "error"
)

type hubStateSectionStatus string

const (
	hubStateSectionStatusEmpty      hubStateSectionStatus = "empty"
	hubStateSectionStatusReady      hubStateSectionStatus = "ready"
	hubStateSectionStatusRefreshing hubStateSectionStatus = "refreshing"
	hubStateSectionStatusError      hubStateSectionStatus = "error"
)

type hubStateActionStatus string

const (
	hubStateActionStatusRunning   hubStateActionStatus = "running"
	hubStateActionStatusSucceeded hubStateActionStatus = "succeeded"
	hubStateActionStatusFailed    hubStateActionStatus = "failed"
)

const (
	hubStateSectionAgentPackages    = "agentPackages"
	hubStateSectionWheelmakerUpdate = "wheelmakerUpdate"
	hubStateSectionSkills           = "skills"
	hubStateSectionTokenStats       = "tokenStats"
	hubStateSectionFileIndex        = "fileIndex"
)

type hubState struct {
	HubID     string                     `json:"hubId"`
	Status    hubStateStatus             `json:"status"`
	UpdatedAt string                     `json:"updatedAt,omitempty"`
	Sections  map[string]hubStateSection `json:"sections"`
}

type hubStateSection struct {
	Status    hubStateSectionStatus `json:"status"`
	UpdatedAt string                `json:"updatedAt,omitempty"`
	StartedAt string                `json:"startedAt,omitempty"`
	Error     string                `json:"error,omitempty"`
	Data      any                   `json:"data,omitempty"`
	Action    *hubStateAction       `json:"action,omitempty"`
}

type hubStateAction struct {
	ID         string               `json:"id"`
	Name       string               `json:"name"`
	Status     hubStateActionStatus `json:"status"`
	StartedAt  string               `json:"startedAt,omitempty"`
	FinishedAt string               `json:"finishedAt,omitempty"`
	Error      string               `json:"error,omitempty"`
	Params     map[string]any       `json:"params,omitempty"`
	Result     any                  `json:"result,omitempty"`
}

type hubStateRefreshInput struct {
	HubID  string
	Force  bool
	Now    time.Time
	State  hubState
	Params map[string]any
}

type hubStateSectionHandler struct {
	Refresh func(context.Context, hubStateRefreshInput) (any, error)
	Action  func(context.Context, string, map[string]any) (any, error)
}

type HubStateManager struct {
	mu       sync.Mutex
	hubID    string
	state    hubState
	handlers map[string]hubStateSectionHandler
	now      func() time.Time
}

func newHubStateManager(hubID string, handlers map[string]hubStateSectionHandler) *HubStateManager {
	hubID = strings.TrimSpace(hubID)
	if hubID == "" {
		hubID = "wheelmaker-hub"
	}
	handlerCopy := make(map[string]hubStateSectionHandler, len(handlers))
	for name, handler := range handlers {
		handlerCopy[name] = handler
	}
	return &HubStateManager{
		hubID: hubID,
		state: hubState{
			HubID:    hubID,
			Status:   hubStateStatusEmpty,
			Sections: map[string]hubStateSection{},
		},
		handlers: handlerCopy,
		now:      time.Now,
	}
}

func (m *HubStateManager) get(sections []string) hubState {
	sectionNames := normalizeHubStateSections(sections)
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked(sectionNames)
}

func (m *HubStateManager) refresh(ctx context.Context, sections []string, force bool) (hubState, error) {
	sectionNames := normalizeHubStateSections(sections)
	if len(sectionNames) == 0 {
		return hubState{}, errors.New("refresh requires at least one section")
	}
	for _, sectionName := range sectionNames {
		if m.handlers[sectionName].Refresh == nil {
			return hubState{}, fmt.Errorf("section %q does not support refresh", sectionName)
		}
	}

	for _, sectionName := range sectionNames {
		handler := m.handlers[sectionName]
		startedAt := m.now().UTC()
		m.mu.Lock()
		section := m.state.Sections[sectionName]
		section.Status = hubStateSectionStatusRefreshing
		section.StartedAt = formatHubStateTime(startedAt)
		section.Error = ""
		m.state.Sections[sectionName] = section
		inputState := m.snapshotLocked(nil)
		m.mu.Unlock()

		data, err := handler.Refresh(ctx, hubStateRefreshInput{
			HubID: m.hubID,
			Force: force,
			Now:   startedAt,
			State: inputState,
		})

		finishedAt := m.now().UTC()
		m.mu.Lock()
		section = m.state.Sections[sectionName]
		if err != nil {
			section.Status = hubStateSectionStatusError
			section.Error = err.Error()
		} else {
			section.Status = hubStateSectionStatusReady
			section.Error = ""
			section.Data = data
			section.UpdatedAt = formatHubStateTime(finishedAt)
		}
		m.state.Sections[sectionName] = section
		m.mu.Unlock()
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked(nil), nil
}

func (m *HubStateManager) action(ctx context.Context, sectionName string, actionName string, params map[string]any) (hubState, error) {
	sectionName = strings.TrimSpace(sectionName)
	actionName = strings.TrimSpace(actionName)
	if sectionName == "" {
		return hubState{}, errors.New("action requires section")
	}
	if actionName == "" {
		return hubState{}, errors.New("action requires action name")
	}
	handler := m.handlers[sectionName]
	if handler.Action == nil {
		return hubState{}, fmt.Errorf("section %q does not support actions", sectionName)
	}

	startedAt := m.now().UTC()
	paramsCopy := cloneHubStateParams(params)
	action := hubStateAction{
		ID:        fmt.Sprintf("%s:%s:%d", sectionName, actionName, startedAt.UnixNano()),
		Name:      actionName,
		Status:    hubStateActionStatusRunning,
		StartedAt: formatHubStateTime(startedAt),
		Params:    cloneHubStateParams(paramsCopy),
	}

	m.mu.Lock()
	section := m.state.Sections[sectionName]
	section.Status = hubStateSectionStatusRefreshing
	section.StartedAt = action.StartedAt
	section.Error = ""
	section.Action = cloneHubStateAction(&action)
	m.state.Sections[sectionName] = section
	m.mu.Unlock()

	result, err := handler.Action(ctx, actionName, paramsCopy)

	finishedAt := m.now().UTC()
	m.mu.Lock()
	section = m.state.Sections[sectionName]
	if section.Action == nil {
		section.Action = cloneHubStateAction(&action)
	}
	section.Action.FinishedAt = formatHubStateTime(finishedAt)
	if err != nil {
		section.Action.Status = hubStateActionStatusFailed
		section.Action.Error = err.Error()
		section.Status = hubStateSectionStatusError
		section.Error = err.Error()
	} else {
		section.Action.Status = hubStateActionStatusSucceeded
		section.Action.Error = ""
		section.Action.Result = result
		section.Status = hubStateSectionStatusReady
		section.Error = ""
		section.UpdatedAt = formatHubStateTime(finishedAt)
		if result != nil {
			section.Data = result
		}
	}
	m.state.Sections[sectionName] = section
	state := m.snapshotLocked(nil)
	m.mu.Unlock()
	return state, nil
}

func (m *HubStateManager) snapshotLocked(sections []string) hubState {
	snapshot := hubState{
		HubID:    m.hubID,
		Status:   hubStateStatusEmpty,
		Sections: map[string]hubStateSection{},
	}
	if len(sections) == 0 {
		for name, section := range m.state.Sections {
			snapshot.Sections[name] = cloneHubStateSection(section)
		}
	} else {
		for _, name := range sections {
			if section, ok := m.state.Sections[name]; ok {
				snapshot.Sections[name] = cloneHubStateSection(section)
			}
		}
	}
	snapshot.Status = aggregateHubStateStatus(snapshot.Sections)
	snapshot.UpdatedAt = newestHubStateUpdatedAt(snapshot.Sections)
	return snapshot
}

func aggregateHubStateStatus(sections map[string]hubStateSection) hubStateStatus {
	if len(sections) == 0 {
		return hubStateStatusEmpty
	}
	readyCount := 0
	errorCount := 0
	for _, section := range sections {
		if section.Status == hubStateSectionStatusRefreshing || (section.Action != nil && section.Action.Status == hubStateActionStatusRunning) {
			return hubStateStatusRefreshing
		}
		switch section.Status {
		case hubStateSectionStatusReady:
			readyCount++
		case hubStateSectionStatusError:
			errorCount++
		}
	}
	if readyCount == len(sections) {
		return hubStateStatusReady
	}
	if errorCount == len(sections) {
		return hubStateStatusError
	}
	if readyCount > 0 && errorCount > 0 {
		return hubStateStatusPartial
	}
	return hubStateStatusEmpty
}

func newestHubStateUpdatedAt(sections map[string]hubStateSection) string {
	var newest time.Time
	for _, section := range sections {
		updatedAt, err := time.Parse(time.RFC3339, section.UpdatedAt)
		if err != nil {
			continue
		}
		if updatedAt.After(newest) {
			newest = updatedAt
		}
	}
	if newest.IsZero() {
		return ""
	}
	return newest.Format(time.RFC3339)
}

func normalizeHubStateSections(sections []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(sections))
	for _, section := range sections {
		name := strings.TrimSpace(section)
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

func cloneHubStateSection(section hubStateSection) hubStateSection {
	section.Action = cloneHubStateAction(section.Action)
	return section
}

func cloneHubStateAction(action *hubStateAction) *hubStateAction {
	if action == nil {
		return nil
	}
	clone := *action
	clone.Params = cloneHubStateParams(action.Params)
	return &clone
}

func cloneHubStateParams(params map[string]any) map[string]any {
	if params == nil {
		return nil
	}
	clone := make(map[string]any, len(params))
	for key, value := range params {
		clone[key] = value
	}
	return clone
}

func formatHubStateTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
