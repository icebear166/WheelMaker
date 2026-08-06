package tools

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	installedReleaseName       = "release.json"
	updateStagingDirectoryName = "staging"
	updateLeaseFileName        = "lock.json"
	updateStatusFileName       = "status.json"
)

type installedRelease struct {
	SchemaVersion int    `json:"schemaVersion"`
	Version       string `json:"version"`
	PublishedAt   string `json:"publishedAt"`
	SourceSHA     string `json:"sourceSha"`
	ManifestSHA   string `json:"manifestSha256"`
	InstalledAt   string `json:"installedAt"`
}

type stableReleaseSummary struct {
	Version     string `json:"version"`
	PublishedAt string `json:"publishedAt"`
	SourceSHA   string `json:"sourceSha"`
}

type updateJobStatus struct {
	Schema    int    `json:"schema"`
	JobID     string `json:"jobId"`
	State     string `json:"state"`
	Version   string `json:"version,omitempty"`
	StartedAt string `json:"startedAt"`
	UpdatedAt string `json:"updatedAt"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type updateLease struct {
	Schema      int    `json:"schema"`
	JobID       string `json:"jobId"`
	Owner       string `json:"owner"`
	State       string `json:"state"`
	StartedAt   string `json:"startedAt"`
	HeartbeatAt string `json:"heartbeatAt"`
}

type publishStatus struct {
	Schema    int    `json:"schema"`
	State     string `json:"state"`
	Phase     string `json:"phase"`
	Version   string `json:"version,omitempty"`
	SourceSHA string `json:"sourceSha,omitempty"`
	Publisher string `json:"publisher,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type updateCommandResponse struct {
	OK            bool                  `json:"ok"`
	Accepted      bool                  `json:"accepted,omitempty"`
	JobID         string                `json:"jobId,omitempty"`
	Status        string                `json:"status"`
	HubID         string                `json:"hubId"`
	Installed     *installedRelease     `json:"installed,omitempty"`
	Stable        *stableReleaseSummary `json:"stable,omitempty"`
	Job           *updateJobStatus      `json:"job,omitempty"`
	PublishStatus *publishStatus        `json:"publishStatus,omitempty"`
	CanRequest    bool                  `json:"canRequestUpdate"`
	ErrorCode     string                `json:"errorCode,omitempty"`
}

type updateCommandPayload struct {
	Action string `json:"action"`
	HubID  string `json:"hubId"`
}

type updateCommandError struct {
	Code    string
	Message string
}

func (e *updateCommandError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == "" {
		return e.Message
	}
	return e.Code + ": " + e.Message
}

type updateTrigger interface {
	Trigger(context.Context) error
}

type UpdateCommand struct {
	baseDir         string
	trigger         updateTrigger
	completionMu    sync.Mutex
	onOperationDone func()
	watchedJobs     map[string]struct{}
}

func NewUpdateCommand(baseDir string) *UpdateCommand {
	return newUpdateCommandWithDependencies(baseDir, execUpdateTrigger{})
}

func newUpdateCommandWithDependencies(baseDir string, trigger updateTrigger) *UpdateCommand {
	if trigger == nil {
		trigger = execUpdateTrigger{}
	}
	return &UpdateCommand{
		baseDir:     filepath.Clean(baseDir),
		trigger:     trigger,
		watchedJobs: make(map[string]struct{}),
	}
}

func (c *UpdateCommand) setOperationDoneHandler(handler func()) {
	c.completionMu.Lock()
	c.onOperationDone = handler
	c.completionMu.Unlock()
}

func (c *UpdateCommand) Handle(ctx context.Context, raw json.RawMessage) (any, *updateCommandError) {
	var payload updateCommandPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.update payload"}
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
		return nil, &updateCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.update action"}
	}
}

func (c *UpdateCommand) query(hubID string) updateCommandResponse {
	job, activeJob := c.readJobState()
	if activeJob && job != nil {
		c.watchCompletion(job.JobID)
	}
	installed, err := c.readInstalledRelease()
	if errors.Is(err, os.ErrNotExist) {
		return updateCommandResponse{
			OK:         true,
			Status:     "not_installed",
			HubID:      hubID,
			Job:        job,
			CanRequest: false,
		}
	}
	if err != nil {
		response := updateQueryFailure(hubID, "installed_release_invalid")
		response.Job = job
		return response
	}

	status := "installed"
	canRequest := true
	if activeJob {
		status = "update_pending"
		canRequest = false
	}
	return updateCommandResponse{
		OK:         true,
		Status:     status,
		HubID:      hubID,
		Installed:  installed,
		Job:        job,
		CanRequest: canRequest,
	}
}

func updateQueryFailure(hubID string, errorCode string) updateCommandResponse {
	return updateCommandResponse{
		OK:         false,
		Status:     "checking_failed",
		HubID:      hubID,
		CanRequest: false,
		ErrorCode:  errorCode,
	}
}

func (c *UpdateCommand) request(ctx context.Context, hubID string) (updateCommandResponse, *updateCommandError) {
	if job, active := c.readJobState(); active && job != nil {
		c.watchCompletion(job.JobID)
		return queuedUpdateResponse(hubID, job.JobID, job), nil
	}
	if err := c.trigger.Trigger(ctx); err != nil {
		return updateCommandResponse{}, internalUpdateError("failed to trigger updater runtime")
	}
	// The updater owns lease creation. It may have written the initial state
	// before the trigger returns, so expose it when it is already observable;
	// otherwise the caller can discover it through the next query/monitor tick.
	if job, active := c.readJobState(); active && job != nil {
		c.watchCompletion(job.JobID)
		return queuedUpdateResponse(hubID, job.JobID, job), nil
	}
	return pendingUpdateResponse(hubID), nil
}

func (c *UpdateCommand) watchCompletion(jobID string) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return
	}
	c.completionMu.Lock()
	if c.onOperationDone == nil {
		c.completionMu.Unlock()
		return
	}
	if _, ok := c.watchedJobs[jobID]; ok {
		c.completionMu.Unlock()
		return
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		c.completionMu.Unlock()
		return
	}
	stagingDir := filepath.Join(c.baseDir, updateStagingDirectoryName)
	if err := watcher.Add(stagingDir); err != nil {
		c.completionMu.Unlock()
		_ = watcher.Close()
		return
	}
	c.watchedJobs[jobID] = struct{}{}
	c.completionMu.Unlock()

	finish := func(notify bool) {
		c.completionMu.Lock()
		delete(c.watchedJobs, jobID)
		handler := c.onOperationDone
		c.completionMu.Unlock()
		_ = watcher.Close()
		if notify && handler != nil {
			handler()
		}
	}
	isTerminal := func() bool {
		status := c.readJobStatus()
		return status != nil && status.JobID == jobID && terminalUpdateState(status.State)
	}
	if isTerminal() {
		go finish(true)
		return
	}
	go func() {
		timeout := time.NewTimer(30 * time.Minute)
		defer timeout.Stop()
		var settleTimer *time.Timer
		var settle <-chan time.Time
		defer func() {
			if settleTimer != nil {
				settleTimer.Stop()
			}
		}()
		for {
			select {
			case _, ok := <-watcher.Events:
				if !ok {
					finish(false)
					return
				}
				if settleTimer == nil {
					settleTimer = time.NewTimer(25 * time.Millisecond)
				} else {
					if !settleTimer.Stop() {
						select {
						case <-settleTimer.C:
						default:
						}
					}
					settleTimer.Reset(25 * time.Millisecond)
				}
				settle = settleTimer.C
			case <-settle:
				settle = nil
				if isTerminal() {
					finish(true)
					return
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					finish(false)
					return
				}
			case <-timeout.C:
				finish(false)
				return
			}
		}
	}()
}

func queuedUpdateResponse(hubID string, jobID string, job *updateJobStatus) updateCommandResponse {
	return updateCommandResponse{
		OK:         true,
		Accepted:   true,
		JobID:      jobID,
		Status:     "update_pending",
		HubID:      hubID,
		Job:        job,
		CanRequest: false,
	}
}

func pendingUpdateResponse(hubID string) updateCommandResponse {
	return updateCommandResponse{
		OK:         true,
		Accepted:   true,
		Status:     "update_pending",
		HubID:      hubID,
		CanRequest: false,
	}
}

func internalUpdateError(message string) *updateCommandError {
	return &updateCommandError{Code: rp.CodeInternal, Message: message}
}

func (c *UpdateCommand) readInstalledRelease() (*installedRelease, error) {
	raw, err := os.ReadFile(filepath.Join(c.baseDir, installedReleaseName))
	if err != nil {
		return nil, err
	}
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	var release installedRelease
	if err := json.Unmarshal(raw, &release); err != nil {
		return nil, err
	}
	if release.SchemaVersion != 2 || release.PublishedAt == "" || release.InstalledAt == "" {
		return nil, errors.New("invalid installed release metadata")
	}
	if _, err := releaseSequence(release.Version); err != nil {
		return nil, err
	}
	if !validHexDigest(release.SourceSHA, 40) || !validHexDigest(release.ManifestSHA, 64) {
		return nil, errors.New("invalid installed release digest")
	}
	return &release, nil
}

func (c *UpdateCommand) readJobStatus() *updateJobStatus {
	raw, err := os.ReadFile(filepath.Join(c.baseDir, updateStagingDirectoryName, updateStatusFileName))
	if err != nil {
		return nil
	}
	var status updateJobStatus
	if err := json.Unmarshal(raw, &status); err != nil || status.Schema != 1 || status.JobID == "" || status.State == "" {
		return nil
	}
	return &status
}

func (c *UpdateCommand) readJobState() (*updateJobStatus, bool) {
	job := c.readJobStatus()
	raw, err := os.ReadFile(filepath.Join(c.baseDir, updateStagingDirectoryName, updateLeaseFileName))
	if err != nil {
		return job, false
	}
	var lease updateLease
	if err := json.Unmarshal(raw, &lease); err != nil || lease.Schema != 1 || lease.JobID == "" {
		return job, false
	}
	if job == nil || job.JobID != lease.JobID {
		job = &updateJobStatus{
			Schema:    1,
			JobID:     lease.JobID,
			State:     lease.State,
			StartedAt: lease.StartedAt,
			UpdatedAt: lease.HeartbeatAt,
		}
	}
	return job, activeUpdateState(job.State)
}

func releaseSequence(version string) (int, error) {
	if !strings.HasPrefix(version, "v1.") || len(version) <= len("v1.") {
		return 0, errors.New("invalid v1 release version")
	}
	sequence, err := strconv.Atoi(version[len("v1."):])
	if err != nil || sequence < 1 || strconv.Itoa(sequence) != version[len("v1."):] {
		return 0, errors.New("invalid v1 release version")
	}
	return sequence, nil
}

func validHexDigest(value string, length int) bool {
	if len(value) != length {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func activeUpdateState(state string) bool {
	switch state {
	case "queued", "downloading", "verifying", "applying", "restarting":
		return true
	default:
		return false
	}
}

func terminalUpdateState(state string) bool {
	return state == "succeeded" || state == "failed"
}

type updateTriggerCommand struct {
	Name string
	Args []string
}

func updaterTriggerSpec(goos string, uid string) updateTriggerCommand {
	switch goos {
	case "windows":
		return updateTriggerCommand{
			Name: "powershell",
			Args: []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Start-ScheduledTask -TaskName 'WheelMakerUpdater' -ErrorAction Stop"},
		}
	case "linux":
		return updateTriggerCommand{Name: "systemctl", Args: []string{"--user", "--no-block", "start", "wheelmaker-updater.service"}}
	case "darwin":
		return updateTriggerCommand{Name: "launchctl", Args: []string{"kickstart", "gui/" + uid + "/com.wheelmaker.updater"}}
	default:
		return updateTriggerCommand{}
	}
}

type execUpdateTrigger struct{}

func (execUpdateTrigger) Trigger(ctx context.Context) error {
	uid := ""
	if current, err := user.Current(); err == nil {
		uid = current.Uid
	}
	if runtime.GOOS == "darwin" && uid == "" {
		return errors.New("current user id is unavailable")
	}
	spec := updaterTriggerSpec(runtime.GOOS, uid)
	if spec.Name == "" {
		return fmt.Errorf("unsupported updater runtime platform: %s", runtime.GOOS)
	}
	command := exec.CommandContext(ctx, spec.Name, spec.Args...)
	shared.ConfigureBackgroundCommand(command)
	if err := command.Run(); err != nil {
		return fmt.Errorf("trigger updater runtime: %w", err)
	}
	return nil
}
