package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	flickrDefaultApprovalPreset  = "yolo"
	flickrDefaultReasoningEffort = "xhigh"
	flickrMethodSetModel         = "session/set_model"
)

type flickrAgent struct {
	core *instance

	mu      sync.Mutex
	options []protocol.ConfigOption
}

type flickrSessionNewResult struct {
	SessionID string       `json:"sessionId"`
	Models    flickrModels `json:"models,omitempty"`
}

type flickrModels struct {
	AvailableModels []flickrModel `json:"availableModels,omitempty"`
	CurrentModelID  string        `json:"currentModelId,omitempty"`
}

type flickrModel struct {
	ModelID string `json:"modelId"`
	Name    string `json:"name,omitempty"`
}

type flickrSetModelParams struct {
	SessionID string `json:"sessionId"`
	ModelID   string `json:"modelId"`
}

var _ Instance = (*flickrAgent)(nil)

func flickrAgentInstanceCreator(provider ACPProvider) InstanceCreator {
	return func(_ context.Context, cwd string) (Instance, error) {
		conn, err := NewOwnedProviderConn(provider, cwd)
		if err != nil {
			return nil, fmt.Errorf("connect %q: %w", provider.Name(), err)
		}
		return newFlickrAgentInstance(conn), nil
	}
}

func newFlickrAgentInstance(conn Conn) Instance {
	core, _ := NewInstance(FlickerACPProviderPreset.Name, conn).(*instance)
	return &flickrAgent{core: core}
}

func (a *flickrAgent) Name() string { return a.core.Name() }

func (a *flickrAgent) SetCallbacks(callbacks Callbacks) {
	a.core.SetCallbacks(callbacks)
}

func (a *flickrAgent) HandleACPRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error) {
	return a.core.HandleACPRequest(ctx, requestID, method, params)
}

func (a *flickrAgent) HandleACPResponse(ctx context.Context, method string, params json.RawMessage) {
	a.core.HandleACPResponse(ctx, method, params)
}

func (a *flickrAgent) Initialize(ctx context.Context, p protocol.InitializeParams) (protocol.InitializeResult, error) {
	return a.core.Initialize(ctx, p)
}

func (a *flickrAgent) SessionNew(ctx context.Context, p protocol.SessionNewParams) (protocol.SessionNewResult, error) {
	if err := a.core.ensureConn(); err != nil {
		return protocol.SessionNewResult{}, err
	}

	var raw flickrSessionNewResult
	if err := a.core.conn.Send(ctx, protocol.MethodSessionNew, p, &raw); err != nil {
		return protocol.SessionNewResult{}, err
	}
	a.core.bindSessionID(raw.SessionID)

	options := flickrOptions(raw.Models)
	a.setOptions(options)
	return protocol.SessionNewResult{
		SessionID:     raw.SessionID,
		ConfigOptions: options,
	}, nil
}

func (a *flickrAgent) SessionLoad(ctx context.Context, p protocol.SessionLoadParams) (protocol.SessionLoadResult, error) {
	return a.core.SessionLoad(ctx, p)
}

func (a *flickrAgent) SessionList(ctx context.Context, p protocol.SessionListParams) (protocol.SessionListResult, error) {
	return a.core.SessionList(ctx, p)
}

func (a *flickrAgent) SessionPrompt(ctx context.Context, p protocol.SessionPromptParams) (protocol.SessionPromptResult, error) {
	return a.core.SessionPrompt(ctx, p)
}

func (a *flickrAgent) SessionCancel(acpSessionID string) error {
	return a.core.SessionCancel(acpSessionID)
}

func (a *flickrAgent) SessionSetConfigOption(ctx context.Context, p protocol.SessionSetConfigOptionParams) ([]protocol.ConfigOption, error) {
	configID := strings.TrimSpace(p.ConfigID)
	value := strings.TrimSpace(p.Value)
	switch configID {
	case protocol.ConfigOptionIDModel:
		return a.setModel(ctx, p.SessionID, value)
	case protocol.ConfigOptionIDApprovalPreset, protocol.ConfigOptionCategoryApprovalPreset:
		if value != flickrDefaultApprovalPreset {
			return nil, fmt.Errorf("flicker cannot hot-switch access; restart flicker with approval preset %q", value)
		}
		return a.currentOptions(), nil
	case protocol.ConfigOptionIDReasoningEffort, protocol.ConfigOptionCategoryThoughtLv:
		if value != flickrDefaultReasoningEffort {
			return nil, fmt.Errorf("flicker cannot hot-switch reasoning effort; restart flicker with effort %q", value)
		}
		return a.currentOptions(), nil
	default:
		return nil, fmt.Errorf("unsupported flicker config option %q", p.ConfigID)
	}
}

func (a *flickrAgent) ListSkills(ctx context.Context, cwd string) ([]SkillDescriptor, error) {
	return a.core.ListSkills(ctx, cwd)
}

func (a *flickrAgent) Close() error {
	return a.core.Close()
}

func (a *flickrAgent) setModel(ctx context.Context, sessionID, modelID string) ([]protocol.ConfigOption, error) {
	if modelID == "" {
		return nil, fmt.Errorf("model is required")
	}
	if !flickrModelAllowed(a.currentOptions(), modelID) {
		return nil, fmt.Errorf("invalid flicker model %q", modelID)
	}
	if strings.TrimSpace(sessionID) == "" {
		a.core.mu.RLock()
		sessionID = a.core.acpSessionID
		a.core.mu.RUnlock()
	}
	if strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("acp session id is required")
	}

	var out json.RawMessage
	if err := a.core.conn.Send(ctx, flickrMethodSetModel, flickrSetModelParams{
		SessionID: sessionID,
		ModelID:   modelID,
	}, &out); err != nil {
		return nil, err
	}

	options := flickrSetCurrentValue(a.currentOptions(), protocol.ConfigOptionIDModel, modelID)
	a.setOptions(options)
	return options, nil
}

func (a *flickrAgent) currentOptions() []protocol.ConfigOption {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]protocol.ConfigOption(nil), a.options...)
}

func (a *flickrAgent) setOptions(options []protocol.ConfigOption) {
	a.mu.Lock()
	a.options = append([]protocol.ConfigOption(nil), options...)
	a.mu.Unlock()
}

func flickrOptions(models flickrModels) []protocol.ConfigOption {
	options := []protocol.ConfigOption{
		{
			ID:           protocol.ConfigOptionIDApprovalPreset,
			Name:         "Access",
			Category:     protocol.ConfigOptionCategoryApprovalPreset,
			Type:         "select",
			CurrentValue: flickrDefaultApprovalPreset,
			Options: []protocol.ConfigOptionValue{
				{Value: "default", Name: "Default"},
				{Value: "autoEdit", Name: "Auto Edit"},
				{Value: "yolo", Name: "YOLO"},
			},
		},
		{
			ID:           protocol.ConfigOptionIDReasoningEffort,
			Name:         "Reasoning Effort",
			Category:     protocol.ConfigOptionCategoryThoughtLv,
			Type:         "select",
			CurrentValue: flickrDefaultReasoningEffort,
			Options: []protocol.ConfigOptionValue{
				{Value: "low", Name: "Low"},
				{Value: "medium", Name: "Medium"},
				{Value: "high", Name: "High"},
				{Value: "max", Name: "Max"},
				{Value: "xhigh", Name: "X High"},
				{Value: "maxOrXhigh", Name: "Max or X High"},
			},
		},
	}
	if len(models.AvailableModels) == 0 && strings.TrimSpace(models.CurrentModelID) == "" {
		return options
	}
	modelOption := protocol.ConfigOption{
		ID:           protocol.ConfigOptionIDModel,
		Name:         "Model",
		Category:     protocol.ConfigOptionCategoryModel,
		Type:         "select",
		CurrentValue: strings.TrimSpace(models.CurrentModelID),
		Options:      flickrModelOptions(models.AvailableModels),
	}
	options = append(options, modelOption)
	return options
}

func flickrModelOptions(models []flickrModel) []protocol.ConfigOptionValue {
	out := make([]protocol.ConfigOptionValue, 0, len(models))
	for _, model := range models {
		modelID := strings.TrimSpace(model.ModelID)
		if modelID == "" {
			continue
		}
		name := strings.TrimSpace(model.Name)
		if name == "" {
			name = modelID
		}
		out = append(out, protocol.ConfigOptionValue{Value: modelID, Name: name})
	}
	return out
}

func flickrModelAllowed(options []protocol.ConfigOption, modelID string) bool {
	for _, opt := range options {
		if opt.ID != protocol.ConfigOptionIDModel {
			continue
		}
		if len(opt.Options) == 0 {
			return true
		}
		for _, value := range opt.Options {
			if value.Value == modelID {
				return true
			}
		}
		return false
	}
	return true
}

func flickrSetCurrentValue(options []protocol.ConfigOption, id, value string) []protocol.ConfigOption {
	out := append([]protocol.ConfigOption(nil), options...)
	for i := range out {
		if out[i].ID == id {
			out[i].CurrentValue = value
			return out
		}
	}
	out = append(out, protocol.ConfigOption{ID: id, CurrentValue: value})
	return out
}
