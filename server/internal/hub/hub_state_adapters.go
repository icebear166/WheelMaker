package hub

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/swm8023/wheelmaker/internal/hub/tools"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	hubToolMethodNPM           = "cmd.npm"
	hubToolMethodUpdate        = "cmd.update"
	hubToolMethodGatewayUpdate = "cmd.gatewayUpdate"
	hubToolMethodSkills        = "cmd.skills"
	hubToolMethodRelease       = "cmd.release"
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
		hubStateSectionGatewayUpdate: {
			Refresh: r.refreshHubStateGatewayUpdate,
			Action:  r.actionHubStateGatewayUpdate,
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
		hubStateSectionMCP: {
			Refresh: r.refreshHubStateMCP,
		},
	}
}

func (r *Reporter) refreshHubStateMCP(_ context.Context, _ hubStateRefreshInput) (any, error) {
	configs, err := r.ensureHubConfigStore().MCPServers()
	if err != nil {
		return nil, err
	}
	return r.ensureMCPStatusStore().Sync(configs), nil
}

func (r *Reporter) refreshHubStateFlickerBridge(ctx context.Context, _ hubStateRefreshInput) (any, error) {
	return r.flickerBridge.Status(ctx), nil
}

func (r *Reporter) actionHubStateFlickerBridge(ctx context.Context, action string, params map[string]any) (any, error) {
	var (
		result any
		err    error
	)
	switch action {
	case "start":
		result, err = r.flickerBridge.Start(ctx)
	case "stop":
		result, err = r.flickerBridge.Stop(ctx)
	case "restart":
		result, err = r.flickerBridge.Restart(ctx)
	case "switchMode":
		mode, ok := params["mode"].(string)
		if !ok || mode == "" {
			return nil, fmt.Errorf("%s switchMode requires mode", hubStateSectionFlickerBridge)
		}
		result, err = r.flickerBridge.SwitchMode(ctx, flickerBridgeMode(mode))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionFlickerBridge, action)
	}
	if err == nil {
		r.refreshHubStateSectionAfterAction(hubStateSectionFlickerBridge)
	}
	return result, err
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
	var (
		result any
		err    error
	)
	switch action {
	case "install":
		result, err = r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "install", params))
	case "installMany":
		result, err = r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "install_many", params))
	case "uninstall":
		result, err = r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "uninstall", params))
	case "reinstall":
		result, err = r.runHubStateTool(ctx, hubToolMethodNPM, hubStateToolPayload(r.cfg.HubID, "reinstall", params))
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionAgentPackages, action)
	}
	if err == nil {
		r.refreshHubStateSectionAfterAction(hubStateSectionAgentPackages)
	}
	return result, err
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
		result, err := r.runHubStateTool(ctx, hubToolMethodUpdate, hubStateToolPayload(r.cfg.HubID, "request", params))
		if err == nil {
			r.refreshHubStateSectionAfterAction(hubStateSectionWheelmakerUpdate)
		}
		return result, err
	case "restart":
		if r.restartRuntime == nil {
			return nil, fmt.Errorf("managed runtime restart is unavailable")
		}
		return map[string]any{
			"ok":       true,
			"accepted": true,
			"status":   "restart_pending",
			"hubId":    r.cfg.HubID,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionWheelmakerUpdate, action)
	}
}

func (r *Reporter) refreshHubStateGatewayUpdate(ctx context.Context, input hubStateRefreshInput) (any, error) {
	return r.runHubStateTool(ctx, hubToolMethodGatewayUpdate, map[string]any{
		"action": "query",
		"hubId":  input.HubID,
	})
}

func (r *Reporter) actionHubStateGatewayUpdate(ctx context.Context, action string, params map[string]any) (any, error) {
	if action != "requestUpdate" {
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionGatewayUpdate, action)
	}
	result, err := r.runHubStateTool(ctx, hubToolMethodGatewayUpdate, hubStateToolPayload(r.cfg.HubID, "request", params))
	if err == nil {
		r.refreshHubStateSectionAfterAction(hubStateSectionGatewayUpdate)
	}
	return result, err
}

func (r *Reporter) refreshHubStateSkills(ctx context.Context, _ hubStateRefreshInput) (any, error) {
	return r.ensureSkillsStateCoordinator().RefreshAll(ctx)
}

func (r *Reporter) actionHubStateSkills(ctx context.Context, action string, params map[string]any) (any, error) {
	switch action {
	case "reindex":
		result, err := r.ensureHubStateManager().enqueueRefresh(
			[]string{hubStateSectionSkills},
			true,
		)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"ok":       true,
			"accepted": result.Accepted,
			"hubId":    r.cfg.HubID,
		}, nil
	case "inspectRepo", "detail", "operation":
		return r.runHubStateTool(ctx, hubToolMethodSkills, hubStateToolPayload(r.cfg.HubID, action, params))
	case "addRepo", "refreshRepo", "updateRepo", "install", "installAll", "uninstall", "removeRepo":
		return r.runSkillsStateAction(ctx, action, params)
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionSkills, action)
	}
}

func (r *Reporter) runSkillsStateAction(ctx context.Context, action string, params map[string]any) (any, error) {
	result, err := r.runHubStateTool(
		ctx,
		hubToolMethodSkills,
		hubStateToolPayload(r.cfg.HubID, action, params),
	)
	if err != nil {
		return nil, err
	}
	operation := skillsOperationFromResult(result)
	if operation != nil {
		coordinator := r.ensureSkillsStateCoordinator()
		coordinator.SetOperation(operation)
		r.ensureHubStateManager().notify(
			hubStateSectionSkills,
			coordinator.Snapshot(),
			rp.HubStateAvailabilityReady,
			"",
			"skills.operation.started",
		)
	}
	return result, nil
}

func skillsOperationFromResult(result any) *tools.SkillsOperationSnapshot {
	raw, err := json.Marshal(result)
	if err != nil {
		return nil
	}
	var response struct {
		Operation *tools.SkillsOperationSnapshot `json:"operation"`
	}
	if json.Unmarshal(raw, &response) != nil {
		return nil
	}
	return response.Operation
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
		result := r.ensureFileIndexManager().startRebuild(ctx, project)
		r.refreshHubStateSectionAfterAction(hubStateSectionFileIndex)
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported %s action %q", hubStateSectionFileIndex, action)
	}
}

func (r *Reporter) refreshHubStateSectionAfterAction(section string) {
	_, _ = r.ensureHubStateManager().enqueueRefresh([]string{section}, true)
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
