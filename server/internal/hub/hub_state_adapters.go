package hub

import (
	"context"
	"encoding/json"
	"fmt"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
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
	}
}

func (r *Reporter) refreshHubStateAgentPackages(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, map[string]any{
		"action": "scan",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateAgentPackages(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "install":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, hubStateToolPayload(r.cfg.HubID, "install", params))
	case "installMany":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, hubStateToolPayload(r.cfg.HubID, "install_many", params))
	case "uninstall":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdNPM, hubStateToolPayload(r.cfg.HubID, "uninstall", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionAgentPackages, action)
	}
}

func (r *Reporter) refreshHubStateWheelmakerUpdate(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdUpdate, map[string]any{
		"action": "query",
		"hubId":  input.HubID,
		"force":  input.Force,
	})
}

func (r *Reporter) actionHubStateWheelmakerUpdate(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "updatePublish":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdUpdate, hubStateToolPayload(r.cfg.HubID, "update-publish", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionWheelmakerUpdate, action)
	}
}

func (r *Reporter) refreshHubStateSkills(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, map[string]any{
		"action": "scan",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateSkills(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "listSource":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, hubStateToolPayload(r.cfg.HubID, "list", params))
	case "install":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, hubStateToolPayload(r.cfg.HubID, "install", params))
	case "uninstall":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, hubStateToolPayload(r.cfg.HubID, "uninstall", params))
	case "update":
		return r.runHubStateTool(ctx, rp.RegistryMethodCmdSkills, hubStateToolPayload(r.cfg.HubID, "update", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionSkills, action)
	}
}

func (r *Reporter) refreshHubStateTokenStats(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, rp.RegistryMethodCmdToken, map[string]any{
		"action": "scan",
		"hubId":  input.HubID,
	})
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
