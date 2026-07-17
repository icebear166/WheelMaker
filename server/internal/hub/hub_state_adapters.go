package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/swm8023/wheelmaker/internal/hub/tools"
)

const (
	hubToolMethodNPM    = "cmd.npm"
	hubToolMethodUpdate = "cmd.update"
	hubToolMethodSkills = "cmd.skills"
	hubToolMethodToken  = "cmd.token"
)

func (r *Reporter) hubStateSectionHandlers() map[string]hubStateSectionHandler {
	return map[string]hubStateSectionHandler{
		hubStateSectionAgentPackages: {
			Refresh: r.refreshHubStateAgentPackages,
			Action:  r.actionHubStateAgentPackages,
		},
		hubStateSectionWheelmakerUpdate: {
			Refresh: r.refreshHubStateWheelmakerUpdate,
			Action:  r.actionHubStateWheelmakerUpdate,
		},
		hubStateSectionSkills: {
			Refresh: r.refreshHubStateSkills,
			Action:  r.actionHubStateSkills,
		},
		hubStateSectionTokenStats: {
			Refresh: r.refreshHubStateTokenStats,
			Action:  r.actionHubStateTokenStats,
		},
		hubStateSectionFileIndex: {
			Refresh: r.refreshHubStateFileIndex,
			Action:  r.actionHubStateFileIndex,
		},
	}
}

func (r *Reporter) refreshHubStateAgentPackages(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, hubToolMethodNPM, map[string]any{
		"action": "scan",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateAgentPackages(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "install":
		return r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "install", params))
	case "installMany":
		return r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "install_many", params))
	case "uninstall":
		return r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "uninstall", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionAgentPackages, action)
	}
}

func (r *Reporter) refreshHubStateWheelmakerUpdate(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, hubToolMethodUpdate, map[string]any{
		"action": "query",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateWheelmakerUpdate(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "requestUpdate":
		return r.runHubStateTool(ctx, hubToolMethodUpdate, hubStateToolPayload(r.cfg.HubID, "request", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionWheelmakerUpdate, action)
	}
}

func (r *Reporter) refreshHubStateSkills(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, hubToolMethodSkills, map[string]any{
		"action": "scan",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateSkills(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "listSource":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, "list", params))
	case "install":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, "install", params))
	case "uninstall":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, "uninstall", params))
	case "update":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, "update", params))
	case "detail":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, "detail", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionSkills, action)
	}
}

func (r *Reporter) refreshHubStateTokenStats(_ context.Context, input hubStateRefreshInput) (any, error) {
	go r.runTokenStatsStream()
	return map[string]any{"ok": true, "hubId": input.HubID, "streaming": true}, nil
}

// runTokenStatsStream runs the parallel scan with a streaming publish callback
// that pushes each completed provider result as a tokenStats.update event.
func (r *Reporter) runTokenStatsStream() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	publish := func(v any) { _ = r.PublishTokenStatsEvent(v) }
	_, _ = tools.ScanTokenStatsWithPublisher(ctx, publish)
}

func (r *Reporter) actionHubStateTokenStats(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "providers":
		return r.runHubStateTool(ctx, hubToolMethodToken, hubStateToolPayload(r.cfg.HubID, "providers", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionTokenStats, action)
	}
}

func (r *Reporter) refreshHubStateFileIndex(_ context.Context, input hubStateRefreshInput) (any, error) {
	resp := r.ensureFileIndexManager().status(r.projectFileIndexProjects())
	resp.HubID = input.HubID
	return resp, nil
}

func (r *Reporter) actionHubStateFileIndex(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "rebuild":
		projectID, _ := params["projectId"].(string)
		project, err := r.projectFileIndexProject(projectID)
		if err != nil {
			return nil, err
		}
		return r.ensureFileIndexManager().startRebuild(ctx, project), nil
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionFileIndex, action)
	}
}

func (r *Reporter) runHubStateTool(ctx context.Context, method string, payload map[string]any) (any, error) {
	r.toolHandlerMu.Lock()
	defer r.toolHandlerMu.Unlock()

	handler := r.ensureToolHandler()
	handler.SetProjects(r.projectsSnapshot())
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal hub state tool payload: %w", err)
	}
	resp, cmdErr := handler.Handle(ctx, method, raw)
	if cmdErr != nil {
		return nil, cmdErr
	}
	return resp, nil
}

func hubStateToolPayload(hubID string, action string, params map[string]any) map[string]any {
	payload := make(map[string]any, len(params)+2)
	for key, value := range params {
		payload[key] = value
	}
	payload["action"] = action
	payload["hubId"] = hubID
	return payload
}
