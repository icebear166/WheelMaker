package hub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	hubStateSectionAgentPackages    = "agentPackages"
	hubStateSectionWheelmakerUpdate = "wheelmakerUpdate"
	hubStateSectionGatewayUpdate    = "gatewayUpdate"
	hubStateSectionSkills           = "skills"
	hubStateSectionTokenStats       = "tokenStats"
	hubStateSectionFileIndex        = "fileIndex"
	hubStateSectionFlickerBridge    = "flickerBridge"
	hubStateSectionMCP              = "mcp"
)

type hubStateRefreshInput struct {
	HubID  string
	Force  bool
	Now    time.Time
	State  rp.HubState
	Params map[string]any
}

type hubStateSectionHandler struct {
	Refresh func(context.Context, hubStateRefreshInput) (any, error)
	Action  func(context.Context, string, map[string]any) (any, error)
}

type hubStateUpdate struct {
	id           string
	baseRevision uint64
	force        bool
}

type hubStateSectionController struct {
	mu           sync.Mutex
	section      rp.HubStateSection
	active       *hubStateUpdate
	pendingRerun bool
	forceRerun   bool
	nextUpdateID uint64
	handler      hubStateSectionHandler
	changed      chan struct{}
}

type HubStateManager struct {
	hubID      string
	instanceID string
	sections   map[string]*hubStateSectionController
	now        func() time.Time
	publish    func(reason string, sections map[string]rp.HubStateSection)
}

func newHubStateManager(
	hubID string,
	instanceID string,
	handlers map[string]hubStateSectionHandler,
	publish func(reason string, sections map[string]rp.HubStateSection),
) *HubStateManager {
	hubID = strings.TrimSpace(hubID)
	if hubID == "" {
		hubID = "wheelmaker-hub"
	}
	if instanceID == "" {
		instanceID = newHubStateInstanceID()
	}
	sections := make(map[string]*hubStateSectionController, len(handlers))
	for name, handler := range handlers {
		sections[name] = &hubStateSectionController{
			section: rp.HubStateSection{
				Availability: rp.HubStateAvailabilityEmpty,
				UpdateStatus: rp.HubStateUpdateIdle,
			},
			handler: handler,
			changed: make(chan struct{}),
		}
	}
	return &HubStateManager{
		hubID:      hubID,
		instanceID: instanceID,
		sections:   sections,
		now:        time.Now,
		publish:    publish,
	}
}

func (m *HubStateManager) get(sections []string) rp.HubState {
	names := normalizeHubStateSections(sections)
	if len(names) == 0 {
		names = make([]string, 0, len(m.sections))
		for name := range m.sections {
			names = append(names, name)
		}
	}
	snapshot := rp.HubState{
		HubID:      m.hubID,
		InstanceID: m.instanceID,
		Sections:   make(map[string]rp.HubStateSection, len(names)),
	}
	for _, name := range names {
		controller, ok := m.sections[name]
		if !ok {
			continue
		}
		controller.mu.Lock()
		section := cloneHubStateSection(controller.section)
		if name != hubStateSectionTokenStats && controller.active != nil {
			section.UpdateStatus = rp.HubStateUpdateIdle
		}
		snapshot.Sections[name] = section
		controller.mu.Unlock()
	}
	return snapshot
}

func (m *HubStateManager) enqueueRefresh(
	sections []string,
	force bool,
) (rp.HubStateRefreshResponse, error) {
	names := normalizeHubStateSections(sections)
	if len(names) == 0 {
		return rp.HubStateRefreshResponse{}, errors.New("refresh requires at least one section")
	}
	for _, name := range names {
		controller, ok := m.sections[name]
		if !ok || controller.handler.Refresh == nil {
			return rp.HubStateRefreshResponse{}, fmt.Errorf("section %q does not support refresh", name)
		}
	}

	updates := make([]rp.HubStateUpdateAck, 0, len(names))
	start := make([]string, 0, len(names))
	for _, name := range names {
		controller := m.sections[name]
		controller.mu.Lock()
		if controller.active != nil {
			if force {
				controller.pendingRerun = true
				controller.forceRerun = true
			}
			status := string(controller.section.UpdateStatus)
			if force {
				status = string(rp.HubStateUpdateQueued)
			}
			updates = append(updates, rp.HubStateUpdateAck{
				Section: name, UpdateID: controller.active.id, Status: status,
			})
			controller.mu.Unlock()
			continue
		}
		controller.nextUpdateID++
		update := &hubStateUpdate{
			id:           fmt.Sprintf("%s:%d", name, controller.nextUpdateID),
			baseRevision: controller.section.Revision,
			force:        force,
		}
		controller.active = update
		controller.section.UpdateStatus = rp.HubStateUpdateQueued
		controller.section.LastAttemptAt = formatHubStateTime(m.now())
		controller.signalLocked()
		updates = append(updates, rp.HubStateUpdateAck{
			Section: name, UpdateID: update.id, Status: string(rp.HubStateUpdateQueued),
		})
		start = append(start, name)
		controller.mu.Unlock()
	}
	response := rp.HubStateRefreshResponse{
		Accepted: true,
		Updates:  updates,
		State:    m.get(nil),
	}
	for _, name := range start {
		go m.runUpdate(name)
	}
	return response, nil
}

func (m *HubStateManager) runUpdate(name string) {
	controller := m.sections[name]
	controller.mu.Lock()
	update := controller.active
	if update == nil {
		controller.mu.Unlock()
		return
	}
	controller.section.UpdateStatus = rp.HubStateUpdateUpdating
	controller.signalLocked()
	handler := controller.handler.Refresh
	now := m.now().UTC()
	controller.mu.Unlock()

	data, updateErr := handler(context.Background(), hubStateRefreshInput{
		HubID: m.hubID,
		Force: update.force,
		Now:   now,
		State: m.get(nil),
	})

	finishedAt := m.now().UTC()
	var published *rp.HubStateSection
	var startRerun bool
	controller.mu.Lock()
	if controller.active != update {
		controller.mu.Unlock()
		return
	}
	stale := controller.section.Revision != update.baseRevision
	if stale {
		controller.pendingRerun = true
	}
	if !stale {
		if updateErr != nil {
			controller.section.LastError = updateErr.Error()
			controller.section.Revision++
			snapshot := cloneHubStateSection(controller.section)
			published = &snapshot
		} else {
			nextData := cloneHubStateValue(data)
			changed := controller.section.Availability != rp.HubStateAvailabilityReady ||
				controller.section.LastError != "" ||
				!reflect.DeepEqual(controller.section.Data, nextData)
			if changed {
				controller.section.Availability = rp.HubStateAvailabilityReady
				controller.section.LastError = ""
				controller.section.Data = nextData
				controller.section.UpdatedAt = formatHubStateTime(finishedAt)
				controller.section.Revision++
				snapshot := cloneHubStateSection(controller.section)
				published = &snapshot
			}
		}
	}
	if controller.pendingRerun {
		controller.nextUpdateID++
		controller.active = &hubStateUpdate{
			id:           fmt.Sprintf("%s:%d", name, controller.nextUpdateID),
			baseRevision: controller.section.Revision,
			force:        controller.forceRerun,
		}
		controller.pendingRerun = false
		controller.forceRerun = false
		controller.section.UpdateStatus = rp.HubStateUpdateQueued
		controller.section.LastAttemptAt = formatHubStateTime(finishedAt)
		startRerun = true
	} else {
		controller.active = nil
		controller.section.UpdateStatus = rp.HubStateUpdateIdle
	}
	if published != nil {
		published.UpdateStatus = controller.section.UpdateStatus
	}
	controller.signalLocked()
	controller.mu.Unlock()

	if published != nil {
		m.publishSections("refresh.completed", map[string]rp.HubStateSection{name: *published})
	}
	if startRerun {
		go m.runUpdate(name)
	}
}

func (m *HubStateManager) notify(
	name string,
	data any,
	availability rp.HubStateAvailability,
	lastError string,
	reason string,
) rp.HubState {
	return m.notifyWithStatus(
		name,
		data,
		availability,
		rp.HubStateUpdateIdle,
		lastError,
		reason,
	)
}

func (m *HubStateManager) notifyWithStatus(
	name string,
	data any,
	availability rp.HubStateAvailability,
	updateStatus rp.HubStateUpdateStatus,
	lastError string,
	reason string,
) rp.HubState {
	return m.notifySection(
		name,
		data,
		availability,
		updateStatus,
		lastError,
		reason,
		false,
	)
}

func (m *HubStateManager) notifyRefreshProgress(
	name string,
	data any,
	availability rp.HubStateAvailability,
	updateStatus rp.HubStateUpdateStatus,
	lastError string,
	reason string,
) rp.HubState {
	// Refresh-owned snapshots advance the active update instead of invalidating
	// it. External notifications still use notifyWithStatus and schedule a rerun.
	return m.notifySection(
		name,
		data,
		availability,
		updateStatus,
		lastError,
		reason,
		true,
	)
}

func (m *HubStateManager) notifySection(
	name string,
	data any,
	availability rp.HubStateAvailability,
	updateStatus rp.HubStateUpdateStatus,
	lastError string,
	reason string,
	refreshProgress bool,
) rp.HubState {
	controller, ok := m.sections[name]
	if !ok {
		return m.get(nil)
	}
	nextData := cloneHubStateValue(data)
	controller.mu.Lock()
	changed := controller.section.Availability != availability ||
		controller.section.UpdateStatus != updateStatus ||
		controller.section.LastError != lastError ||
		!reflect.DeepEqual(controller.section.Data, nextData)
	if changed {
		controller.section.Availability = availability
		controller.section.LastError = lastError
		controller.section.Data = nextData
		controller.section.Revision++
		now := m.now().UTC()
		controller.section.LastAttemptAt = formatHubStateTime(now)
		if availability == rp.HubStateAvailabilityReady {
			controller.section.UpdatedAt = formatHubStateTime(now)
		}
		if controller.active == nil || refreshProgress {
			controller.section.UpdateStatus = updateStatus
		} else {
			controller.pendingRerun = true
		}
		if refreshProgress && controller.active != nil {
			controller.active.baseRevision = controller.section.Revision
		}
		controller.signalLocked()
	}
	section := cloneHubStateSection(controller.section)
	controller.mu.Unlock()
	if changed {
		m.publishSections(reason, map[string]rp.HubStateSection{name: section})
	}
	return m.get(nil)
}

func (m *HubStateManager) action(
	ctx context.Context,
	sectionName string,
	actionName string,
	params map[string]any,
) (rp.HubStateActionResponse, error) {
	sectionName = strings.TrimSpace(sectionName)
	actionName = strings.TrimSpace(actionName)
	if sectionName == "" {
		return rp.HubStateActionResponse{}, errors.New("action requires section")
	}
	if actionName == "" {
		return rp.HubStateActionResponse{}, errors.New("action requires action name")
	}
	controller, ok := m.sections[sectionName]
	if !ok || controller.handler.Action == nil {
		return rp.HubStateActionResponse{}, fmt.Errorf("section %q does not support actions", sectionName)
	}
	result, err := controller.handler.Action(ctx, actionName, cloneHubStateParams(params))
	if err != nil {
		return rp.HubStateActionResponse{}, err
	}
	return rp.HubStateActionResponse{Accepted: true, Result: cloneHubStateValue(result)}, nil
}

func (m *HubStateManager) waitForIdle(ctx context.Context, name string) error {
	controller, ok := m.sections[name]
	if !ok {
		return fmt.Errorf("unknown HubState section %q", name)
	}
	for {
		controller.mu.Lock()
		if controller.active == nil && controller.section.UpdateStatus == rp.HubStateUpdateIdle {
			controller.mu.Unlock()
			return nil
		}
		changed := controller.changed
		controller.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}

func (m *HubStateManager) publishSections(reason string, sections map[string]rp.HubStateSection) {
	if m.publish == nil {
		return
	}
	cloned := make(map[string]rp.HubStateSection, len(sections))
	for name, section := range sections {
		section = cloneHubStateSection(section)
		if name != hubStateSectionTokenStats &&
			(section.UpdateStatus == rp.HubStateUpdateQueued ||
				section.UpdateStatus == rp.HubStateUpdateUpdating) {
			section.UpdateStatus = rp.HubStateUpdateIdle
		}
		cloned[name] = section
	}
	m.publish(reason, cloned)
}

func (c *hubStateSectionController) signalLocked() {
	close(c.changed)
	c.changed = make(chan struct{})
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

func cloneHubStateSection(section rp.HubStateSection) rp.HubStateSection {
	section.Data = cloneHubStateValue(section.Data)
	return section
}

func cloneHubStateParams(params map[string]any) map[string]any {
	if params == nil {
		return nil
	}
	clone := make(map[string]any, len(params))
	for key, value := range params {
		clone[key] = cloneHubStateValue(value)
	}
	return clone
}

func cloneHubStateValue(value any) any {
	if value == nil {
		return nil
	}
	return cloneHubStateReflectValue(reflect.ValueOf(value)).Interface()
}

func cloneHubStateReflectValue(value reflect.Value) reflect.Value {
	if !value.IsValid() {
		return value
	}
	switch value.Kind() {
	case reflect.Interface:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		cloned := cloneHubStateReflectValue(value.Elem())
		out := reflect.New(value.Type()).Elem()
		out.Set(cloned)
		return out
	case reflect.Map:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		clone := reflect.MakeMapWithSize(value.Type(), value.Len())
		iter := value.MapRange()
		for iter.Next() {
			clone.SetMapIndex(
				iter.Key(),
				cloneHubStateReflectValue(iter.Value()),
			)
		}
		return clone
	case reflect.Ptr:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		clone := reflect.New(value.Type().Elem())
		clone.Elem().Set(cloneHubStateReflectValue(value.Elem()))
		return clone
	case reflect.Slice:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		clone := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		for i := 0; i < value.Len(); i++ {
			clone.Index(i).Set(cloneHubStateReflectValue(value.Index(i)))
		}
		return clone
	case reflect.Array:
		clone := reflect.New(value.Type()).Elem()
		for i := 0; i < value.Len(); i++ {
			clone.Index(i).Set(cloneHubStateReflectValue(value.Index(i)))
		}
		return clone
	case reflect.Struct:
		clone := reflect.New(value.Type()).Elem()
		clone.Set(value)
		for i := 0; i < value.NumField(); i++ {
			if clone.Field(i).CanSet() && value.Field(i).CanInterface() {
				clone.Field(i).Set(cloneHubStateReflectValue(value.Field(i)))
			}
		}
		return clone
	default:
		return value
	}
}

func formatHubStateTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func newHubStateInstanceID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return fmt.Sprintf("hub-state-%d", time.Now().UTC().UnixNano())
}
