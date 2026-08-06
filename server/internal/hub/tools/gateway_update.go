package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	gatewayInstallStatePath = "gateway/state/release.json"
	gatewayUpdateDir        = "gateway/update"
	gatewayUpdateStatusFile = "status.json"
	// staleGatewayUpdateThreshold prevents a crashed Hub or updater from
	// leaving the Gateway update action permanently disabled.
	staleGatewayUpdateThreshold = 2 * time.Hour
)

type gatewayInstalledRelease struct {
	SchemaVersion int    `json:"schemaVersion"`
	Version       string `json:"version"`
	SourceSHA     string `json:"sourceSha"`
	ManifestSHA   string `json:"manifestSha256"`
	InstalledAt   string `json:"installedAt"`
}

type gatewayUpdateJobStatus struct {
	Schema    int    `json:"schema"`
	JobID     string `json:"jobId"`
	State     string `json:"state"`
	StartedAt string `json:"startedAt"`
	UpdatedAt string `json:"updatedAt"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type gatewayUpdateCommandResponse struct {
	OK         bool                     `json:"ok"`
	Accepted   bool                     `json:"accepted,omitempty"`
	JobID      string                   `json:"jobId,omitempty"`
	Status     string                   `json:"status"`
	HubID      string                   `json:"hubId"`
	Installed  *gatewayInstalledRelease `json:"installed,omitempty"`
	Job        *gatewayUpdateJobStatus  `json:"job,omitempty"`
	CanRequest bool                     `json:"canRequestUpdate"`
	ErrorCode  string                   `json:"errorCode,omitempty"`
}

type gatewayUpdateResponse = gatewayUpdateCommandResponse

type gatewayUpdateCommandPayload struct {
	Action string `json:"action"`
	HubID  string `json:"hubId"`
}

type gatewayUpdateRunner interface {
	Run(context.Context, string) error
}

type execGatewayUpdateRunner struct{}

func (execGatewayUpdateRunner) Run(ctx context.Context, stateDir string) error {
	command := exec.CommandContext(ctx, "node", filepath.Join(stateDir, "deploy.mjs"), "gateway")
	command.Dir = stateDir
	shared.ConfigureBackgroundCommand(command)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	return command.Run()
}

type GatewayUpdateCommand struct {
	baseDir         string
	runner          gatewayUpdateRunner
	now             func() time.Time
	onOperationDone func()
	mu              sync.Mutex
}

func NewGatewayUpdateCommand(baseDir string) *GatewayUpdateCommand {
	return newGatewayUpdateCommandWithDependencies(baseDir, execGatewayUpdateRunner{})
}

func newGatewayUpdateCommandWithDependencies(baseDir string, runner gatewayUpdateRunner) *GatewayUpdateCommand {
	if runner == nil {
		runner = execGatewayUpdateRunner{}
	}
	return &GatewayUpdateCommand{
		baseDir: filepath.Clean(baseDir),
		runner:  runner,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

func (c *GatewayUpdateCommand) setOperationDoneHandler(handler func()) {
	c.mu.Lock()
	c.onOperationDone = handler
	c.mu.Unlock()
}

func (c *GatewayUpdateCommand) Handle(ctx context.Context, raw json.RawMessage) (any, *updateCommandError) {
	var payload gatewayUpdateCommandPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.gatewayUpdate payload"}
	}
	payload.Action = strings.TrimSpace(payload.Action)
	payload.HubID = strings.TrimSpace(payload.HubID)
	if payload.HubID == "" {
		return nil, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "hubId is required"}
	}
	switch payload.Action {
	case "query":
		return c.query(payload.HubID), nil
	case "request":
		response, err := c.request(ctx, payload.HubID)
		if err != nil {
			return nil, err
		}
		return response, nil
	default:
		return nil, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.gatewayUpdate action"}
	}
}

func (c *GatewayUpdateCommand) query(hubID string) gatewayUpdateCommandResponse {
	c.mu.Lock()
	job := c.reapStaleJobLocked(c.readJobStatus())
	c.mu.Unlock()
	if activeGatewayUpdateState(jobState(job)) {
		return gatewayUpdateCommandResponse{
			OK: true, Status: "update_pending", HubID: hubID, Job: job, CanRequest: false,
		}
	}
	installed, err := c.readInstalledRelease()
	if errors.Is(err, os.ErrNotExist) {
		return gatewayUpdateCommandResponse{
			OK: true, Status: "not_installed", HubID: hubID, Job: job, CanRequest: false,
		}
	}
	if err != nil {
		return gatewayUpdateCommandResponse{
			OK: false, Status: "checking_failed", HubID: hubID, Job: job, CanRequest: false,
			ErrorCode: "gateway_release_invalid",
		}
	}
	return gatewayUpdateCommandResponse{
		OK: true, Status: "installed", HubID: hubID, Installed: installed, Job: job, CanRequest: true,
	}
}

func (c *GatewayUpdateCommand) request(ctx context.Context, hubID string) (gatewayUpdateCommandResponse, *updateCommandError) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if job := c.reapStaleJobLocked(c.readJobStatus()); activeGatewayUpdateState(jobState(job)) {
		return gatewayQueuedResponse(hubID, job), nil
	}
	if _, err := c.readInstalledRelease(); errors.Is(err, os.ErrNotExist) {
		return gatewayUpdateCommandResponse{}, &updateCommandError{Code: rp.CodeNotFound, Message: "Gateway is not installed"}
	} else if err != nil {
		return gatewayUpdateCommandResponse{}, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "Gateway release metadata is invalid"}
	}
	jobID, err := newUpdateJobID()
	if err != nil {
		return gatewayUpdateCommandResponse{}, internalUpdateError("failed to allocate Gateway update job")
	}
	now := c.now().UTC().Format(time.RFC3339Nano)
	job := &gatewayUpdateJobStatus{Schema: 1, JobID: jobID, State: "queued", StartedAt: now, UpdatedAt: now}
	if err := c.writeJobStatus(job); err != nil {
		return gatewayUpdateCommandResponse{}, internalUpdateError("failed to write Gateway update status")
	}
	// The request context belongs to the short-lived Hub RPC. Gateway
	// installation must continue after that RPC returns or is cancelled.
	go c.run(context.WithoutCancel(ctx), job)
	return gatewayQueuedResponse(hubID, job), nil
}

func gatewayQueuedResponse(hubID string, job *gatewayUpdateJobStatus) gatewayUpdateCommandResponse {
	if job == nil {
		return gatewayUpdateCommandResponse{OK: false, Status: "checking_failed", HubID: hubID, CanRequest: false, ErrorCode: "gateway_job_missing"}
	}
	return gatewayUpdateCommandResponse{OK: true, Accepted: true, JobID: job.JobID, Status: "update_pending", HubID: hubID, Job: cloneGatewayUpdateJob(job), CanRequest: false}
}

func (c *GatewayUpdateCommand) run(ctx context.Context, job *gatewayUpdateJobStatus) {
	c.setJobState(job.JobID, "downloading", "")
	err := c.runner.Run(ctx, c.baseDir)
	if err != nil {
		c.setJobState(job.JobID, "failed", "gateway_update_failed")
	} else {
		c.setJobState(job.JobID, "succeeded", "")
	}
	c.mu.Lock()
	handler := c.onOperationDone
	c.mu.Unlock()
	if handler != nil {
		handler()
	}
}

func (c *GatewayUpdateCommand) setJobState(jobID, state, errorCode string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	job := c.readJobStatus()
	if job == nil || job.JobID != jobID {
		return
	}
	job.State = state
	job.ErrorCode = errorCode
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	_ = c.writeJobStatus(job)
}

func (c *GatewayUpdateCommand) readInstalledRelease() (*gatewayInstalledRelease, error) {
	raw, err := os.ReadFile(filepath.Join(c.baseDir, gatewayInstallStatePath))
	if err != nil {
		return nil, err
	}
	var release gatewayInstalledRelease
	if err := json.Unmarshal(raw, &release); err != nil || release.SchemaVersion != 1 || release.Version == "" || release.InstalledAt == "" || !validHexDigest(release.SourceSHA, 40) || !validHexDigest(release.ManifestSHA, 64) {
		return nil, errors.New("invalid Gateway release metadata")
	}
	if _, err := releaseSequence(release.Version); err != nil {
		return nil, err
	}
	return &release, nil
}

func (c *GatewayUpdateCommand) readJobStatus() *gatewayUpdateJobStatus {
	raw, err := os.ReadFile(filepath.Join(c.baseDir, gatewayUpdateDir, gatewayUpdateStatusFile))
	if err != nil {
		return nil
	}
	var job gatewayUpdateJobStatus
	if err := json.Unmarshal(raw, &job); err != nil || job.Schema != 1 || job.JobID == "" || job.State == "" {
		return nil
	}
	return &job
}

// reapStaleJobLocked marks an active job as failed when its last state update
// is older than the shared updater lease threshold. The caller must hold c.mu.
func (c *GatewayUpdateCommand) reapStaleJobLocked(job *gatewayUpdateJobStatus) *gatewayUpdateJobStatus {
	if job == nil || !activeGatewayUpdateState(job.State) {
		return job
	}
	updatedAt := job.UpdatedAt
	if updatedAt == "" {
		updatedAt = job.StartedAt
	}
	at, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err == nil && c.now().Sub(at) <= staleGatewayUpdateThreshold {
		return job
	}
	job.State = "failed"
	job.ErrorCode = "gateway_updater_stalled"
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	_ = c.writeJobStatus(job)
	return job
}

func (c *GatewayUpdateCommand) writeJobStatus(job *gatewayUpdateJobStatus) error {
	if job == nil {
		return errors.New("Gateway update job is nil")
	}
	raw, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return replaceUpdateFile(filepath.Join(c.baseDir, gatewayUpdateDir, gatewayUpdateStatusFile), append(raw, '\n'), 0o600)
}

func cloneGatewayUpdateJob(job *gatewayUpdateJobStatus) *gatewayUpdateJobStatus {
	if job == nil {
		return nil
	}
	copy := *job
	return &copy
}

func jobState(job *gatewayUpdateJobStatus) string {
	if job == nil {
		return ""
	}
	return job.State
}

func activeGatewayUpdateState(state string) bool {
	switch state {
	case "queued", "downloading", "verifying", "applying", "restarting":
		return true
	default:
		return false
	}
}

func (c *GatewayUpdateCommand) String() string {
	return fmt.Sprintf("GatewayUpdateCommand(%s)", c.baseDir)
}
