package tools

import (
	"context"
	"encoding/json"
	"strings"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type ProjectInfo = rp.ProjectInfo

type ManagerConfig struct {
	HubID                  string
	Projects               []ProjectInfo
	StateDir               string
	GlobalLockPath         string
	HomeDir                string
	OnNPMOperationDone     func()
	OnNPMMetadataChanged   func()
	OnUpdateOperationDone  func()
	OnGatewayOperationDone func()
	OnSkillsOperationDone  func(scope, projectName string, operation SkillsOperationSnapshot)
	OnReleaseJobUpdated    func(ReleasePublishJob)
	ReleaseCommand         *ReleaseCommand
	ReleaseNotifier        ReleaseNotifier
}

func (m *Manager) ApplyRelease(ctx context.Context, kind, _ string) (ReleaseTargetStatus, *CommandError) {
	switch kind {
	case "version":
		if m.updateCommand == nil {
			m.updateCommand = NewUpdateCommand(m.cfg.StateDir)
			m.updateCommand.setOperationDoneHandler(m.cfg.OnUpdateOperationDone)
		}
		raw, _ := json.Marshal(map[string]string{"action": "request", "hubId": m.cfg.HubID})
		_, err := m.updateCommand.Handle(ctx, raw)
		if err != nil {
			return ReleaseTargetStatus{Status: "failed", ErrorCode: err.Code}, updateErr(err)
		}
		return ReleaseTargetStatus{Status: "accepted"}, nil
	default:
		return ReleaseTargetStatus{Status: "failed", ErrorCode: "invalid_release_kind"}, &CommandError{Code: rp.CodeInvalidArgument, Message: "unsupported release kind"}
	}
}

type CommandError struct {
	Code    string
	Message string
}

func (e *CommandError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == "" {
		return e.Message
	}
	return e.Code + ": " + e.Message
}

type Manager struct {
	cfg ManagerConfig

	npmCommand       *NPMCommand
	updateCommand    *UpdateCommand
	gatewayCommand   *GatewayUpdateCommand
	skillsCommand    *SkillsCommand
	releaseCommand   *ReleaseCommand
	debugWebReceiver *debugWebTransferReceiver
}

func NewManager(config ManagerConfig) *Manager {
	config.HubID = strings.TrimSpace(config.HubID)
	if config.HubID == "" {
		config.HubID = "wheelmaker-hub"
	}
	config.StateDir = strings.TrimSpace(config.StateDir)
	config.GlobalLockPath = strings.TrimSpace(config.GlobalLockPath)
	config.HomeDir = strings.TrimSpace(config.HomeDir)
	config.Projects = append([]ProjectInfo(nil), config.Projects...)
	npmCommand := NewNPMCommand()
	npmCommand.setOperationDoneHandler(config.OnNPMOperationDone)
	npmCommand.setMetadataChangedHandler(config.OnNPMMetadataChanged)
	updateCommand := NewUpdateCommand(config.StateDir)
	updateCommand.setOperationDoneHandler(config.OnUpdateOperationDone)
	gatewayCommand := NewGatewayUpdateCommand(config.StateDir)
	gatewayCommand.setOperationDoneHandler(config.OnGatewayOperationDone)
	if config.ReleaseCommand != nil {
		config.ReleaseCommand.SetJobUpdatedHandler(config.OnReleaseJobUpdated)
	}
	return &Manager{
		cfg:            config,
		npmCommand:     npmCommand,
		updateCommand:  updateCommand,
		gatewayCommand: gatewayCommand,
		skillsCommand: NewSkillsCommand(skillsCommandConfig{
			HubID:           config.HubID,
			Projects:        config.Projects,
			GlobalLockPath:  config.GlobalLockPath,
			HomeDir:         config.HomeDir,
			OnOperationDone: config.OnSkillsOperationDone,
		}),
		releaseCommand:   config.ReleaseCommand,
		debugWebReceiver: newDebugWebTransferReceiver(config.StateDir),
	}
}

func (m *Manager) HandleDebugWebTransfer(method string, payload json.RawMessage) (ReleaseTargetStatus, *CommandError) {
	if m.debugWebReceiver == nil {
		m.debugWebReceiver = newDebugWebTransferReceiver(m.cfg.StateDir)
	}
	return m.debugWebReceiver.Handle(method, payload)
}

func (m *Manager) SetProjects(projects []ProjectInfo) {
	if m == nil {
		return
	}
	m.cfg.Projects = append([]ProjectInfo(nil), projects...)
	if m.skillsCommand != nil {
		m.skillsCommand.SetProjects(m.cfg.Projects)
	}
}

func (m *Manager) Handle(ctx context.Context, method string, payload json.RawMessage) (any, *CommandError) {
	if m == nil {
		return nil, &CommandError{Code: rp.CodeInternal, Message: "tools manager is not configured"}
	}
	switch strings.TrimSpace(method) {
	case "cmd.npm":
		if m.npmCommand == nil {
			m.npmCommand = NewNPMCommand()
			m.npmCommand.setOperationDoneHandler(m.cfg.OnNPMOperationDone)
			m.npmCommand.setMetadataChangedHandler(m.cfg.OnNPMMetadataChanged)
		}
		out, err := m.npmCommand.Handle(ctx, payload)
		return out, npmErr(err)
	case "cmd.update":
		if m.updateCommand == nil {
			m.updateCommand = NewUpdateCommand(m.cfg.StateDir)
			m.updateCommand.setOperationDoneHandler(m.cfg.OnUpdateOperationDone)
		}
		out, err := m.updateCommand.Handle(ctx, payload)
		return out, updateErr(err)
	case "cmd.gatewayUpdate":
		if m.gatewayCommand == nil {
			m.gatewayCommand = NewGatewayUpdateCommand(m.cfg.StateDir)
			m.gatewayCommand.setOperationDoneHandler(m.cfg.OnGatewayOperationDone)
		}
		out, err := m.gatewayCommand.Handle(ctx, payload)
		return out, updateErr(err)
	case "cmd.skills":
		if m.skillsCommand == nil {
			m.skillsCommand = NewSkillsCommand(skillsCommandConfig{
				HubID:           m.cfg.HubID,
				Projects:        m.cfg.Projects,
				GlobalLockPath:  m.cfg.GlobalLockPath,
				HomeDir:         m.cfg.HomeDir,
				OnOperationDone: m.cfg.OnSkillsOperationDone,
			})
		}
		m.skillsCommand.SetProjects(m.cfg.Projects)
		out, err := m.skillsCommand.Handle(ctx, payload)
		return out, skillsErr(err)
	case "cmd.release":
		if m.releaseCommand == nil {
			m.releaseCommand = newReleaseCommandWithDependencies(m.cfg.StateDir, execReleaseRunner{}, m.cfg.ReleaseNotifier)
			m.releaseCommand.SetJobUpdatedHandler(m.cfg.OnReleaseJobUpdated)
		}
		out, err := m.releaseCommand.Handle(ctx, payload)
		return out, releaseErr(err)
	default:
		return nil, &CommandError{Code: rp.CodeInvalidArgument, Message: "unsupported tools command"}
	}
}

func npmErr(err *npmCommandError) *CommandError {
	if err == nil {
		return nil
	}
	return &CommandError{Code: err.Code, Message: err.Message}
}

func updateErr(err *updateCommandError) *CommandError {
	if err == nil {
		return nil
	}
	return &CommandError{Code: err.Code, Message: err.Message}
}

func skillsErr(err *skillsCommandError) *CommandError {
	if err == nil {
		return nil
	}
	return &CommandError{Code: err.Code, Message: err.Message}
}

func releaseErr(err *releaseCommandError) *CommandError {
	if err == nil {
		return nil
	}
	return &CommandError{Code: err.Code, Message: err.Message}
}
