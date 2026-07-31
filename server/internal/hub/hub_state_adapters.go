package hub

import (
	"context"
	"encoding/json"
	"fmt"
)

const (
	hubToolMethodNPM     = "cmd.npm"
	hubToolMethodUpdate  = "cmd.update"
	hubToolMethodSkills  = "cmd.skills"
	hubToolMethodRelease = "cmd.release"
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
		},
		hubStateSectionFileIndex: {
			Refresh: r.refreshHubStateFileIndex,
			Action:  r.actionHubStateFileIndex,
		},
		hubStateSectionFlickerBridge: {
			Refresh: r.refreshHubStateFlickerBridge,
			Action:  r.actionHubStateFlickerBridge,
		},
	}
}

func (r *Reporter) refreshHubStateFlickerBridge(ctx context.Context, _ hubStateRefreshInput) (any, error) {
	return r.flickerBridge.Status(ctx), nil
}

func (r *Reporter) actionHubStateFlickerBridge(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "start":
		return r.flickerBridge.Start(ctx)
	case "stop":
		return r.flickerBridge.Stop(ctx)
	case "restart":
		return r.flickerBridge.Restart(ctx)
	case "switchMode":
		mode, ok := params["mode"].(string)
		if !ok || mode == "" {
			return nil, fmt.Errorf("%s switchMode requires mode", hubStateSectionFlickerBridge)
		}
		return r.flickerBridge.SwitchMode(ctx, flickerBridgeMode(mode))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionFlickerBridge, action)
	}
}

func (r *Reporter) refreshHubStateTokenStats(ctx context.Context, _ hubStateRefreshInput) (any, error) {
	if r.usageService == nil {
		return nil, fmt.Errorf("limits service is unavailable")
	}
	return r.usageService.Refresh(ctx)
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
	case "reinstall":
		return r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "reinstall", params))
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

func (r *Reporter) refreshHubStateSkills(ctx context.Context, _ hubStateRefreshInput) (any, error) {
	return r.ensureSkillsStateCoordinator().RefreshAll(ctx)
}

func (r *Reporter) actionHubStateSkills(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "reindex":
		result, err := r.runHubStateTool(ctx, hubToolMethodSkills, map[string]any{
			"action": "scan",
			"hubId":  r.cfg.HubID,
		})
		if err != nil {
			return nil, err
		}
		return result, nil
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
	mu := r.toolMutexFor(method)
	mu.Lock()
	defer mu.Unlock()

	handler := r.ensureToolHandler()
	if method == hubToolMethodSkills {
		handler.SetProjects(r.projectsSnapshot())
	}
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
