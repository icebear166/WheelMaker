package tools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const releaseJobDirectoryName = "release-jobs"

var releaseLogSecretPattern = regexp.MustCompile(`(?i)(authorization:\s*bearer\s+|"token"\s*:\s*")[^\s"]+`)

type releaseRunner interface {
	Run(ctx context.Context, workingDir string, args []string, log func(string)) error
}

type ReleaseTargetStatus struct {
	Status    string `json:"status"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type ReleaseNotifier interface {
	NotifyRelease(ctx context.Context, targetHubID, kind, baseURL string) (ReleaseTargetStatus, error)
	TransferDebugWeb(ctx context.Context, targetHubID, transferID, archivePath string, size int64, sha256 string) (ReleaseTargetStatus, error)
}

type execReleaseRunner struct{}

func (execReleaseRunner) Run(ctx context.Context, workingDir string, args []string, log func(string)) error {
	command := exec.CommandContext(ctx, "node", args...)
	command.Dir = workingDir
	shared.ConfigureBackgroundCommand(command)
	writer := releaseLogWriter{write: log}
	command.Stdout = writer
	command.Stderr = writer
	return command.Run()
}

type releaseLogWriter struct{ write func(string) }

func (w releaseLogWriter) Write(raw []byte) (int, error) {
	if w.write != nil {
		w.write(string(raw))
	}
	return len(raw), nil
}

type releaseCommandPayload struct {
	Action      string `json:"action"`
	HubID       string `json:"hubId"`
	JobID       string `json:"jobId,omitempty"`
	Kind        string `json:"kind,omitempty"`
	SourcePath  string `json:"sourcePath,omitempty"`
	BaseURL     string `json:"baseUrl,omitempty"`
	Desktop     bool   `json:"desktop,omitempty"`
	Android     bool   `json:"android,omitempty"`
	TargetHubID string `json:"targetHubId,omitempty"`
	WebHubID    string `json:"webHubId,omitempty"`
	AutoPull    bool   `json:"autoPull,omitempty"`
}

type releasePublishJob struct {
	Schema      int    `json:"schema"`
	ID          string `json:"id"`
	HubID       string `json:"hubId"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	StartedAt   string `json:"startedAt"`
	UpdatedAt   string `json:"updatedAt"`
	FinishedAt  string `json:"finishedAt,omitempty"`
	ErrorCode   string `json:"errorCode,omitempty"`
	Log         string `json:"log,omitempty"`
	TargetState string `json:"targetState,omitempty"`
}

type releaseCommandResponse struct {
	OK       bool               `json:"ok"`
	Accepted bool               `json:"accepted,omitempty"`
	Status   string             `json:"status"`
	Job      *releasePublishJob `json:"job,omitempty"`
}

type releaseCommandError struct {
	Code    string
	Message string
}

func (e *releaseCommandError) Error() string { return e.Code + ": " + e.Message }

type ReleaseCommand struct {
	stateDir string
	runner   releaseRunner
	notifier ReleaseNotifier
	now      func() time.Time

	mu      sync.Mutex
	buildMu sync.Mutex
	jobs    map[string]*releasePublishJob
}

func NewReleaseCommand(stateDir string) *ReleaseCommand {
	return newReleaseCommandWithDependencies(stateDir, execReleaseRunner{}, nil)
}

func newReleaseCommandWithDependencies(stateDir string, runner releaseRunner, notifier ReleaseNotifier) *ReleaseCommand {
	if runner == nil {
		runner = execReleaseRunner{}
	}
	return &ReleaseCommand{
		stateDir: filepath.Clean(stateDir),
		runner:   runner,
		notifier: notifier,
		now:      func() time.Time { return time.Now().UTC() },
		jobs:     map[string]*releasePublishJob{},
	}
}

func (c *ReleaseCommand) Handle(_ context.Context, raw json.RawMessage) (any, *releaseCommandError) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.release payload"}
	}
	if _, hasToken := fields["token"]; hasToken {
		return nil, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "release token is managed by the publishing hub"}
	}
	var payload releaseCommandPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.release payload"}
	}
	payload.Action = strings.TrimSpace(payload.Action)
	payload.HubID = strings.TrimSpace(payload.HubID)
	if payload.HubID == "" {
		return nil, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "hubId is required"}
	}
	switch payload.Action {
	case "start":
		return c.start(payload)
	case "status":
		return c.status(payload)
	default:
		return nil, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.release action"}
	}
}

func (c *ReleaseCommand) start(payload releaseCommandPayload) (releaseCommandResponse, *releaseCommandError) {
	payload.Kind = strings.TrimSpace(payload.Kind)
	if payload.Kind != "version" && payload.Kind != "debugWeb" {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "kind must be version or debugWeb"}
	}
	sourcePath, err := releaseSourcePath(payload.SourcePath, payload.Kind)
	if err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: err.Error()}
	}
	if payload.Kind == "version" {
		if _, err := cleanReleaseHTTPSOrigin(payload.BaseURL); err != nil {
			return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "baseUrl must be a clean HTTPS origin"}
		}
	} else {
		payload.WebHubID = strings.TrimSpace(payload.WebHubID)
		if payload.WebHubID == "" {
			return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "webHubId is required for debugWeb"}
		}
	}
	jobID, err := newUpdateJobID()
	if err != nil {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInternal, Message: "failed to allocate release job"}
	}
	now := c.now().UTC().Format(time.RFC3339Nano)
	job := &releasePublishJob{Schema: 1, ID: jobID, HubID: payload.HubID, Kind: payload.Kind, Status: "running", StartedAt: now, UpdatedAt: now}
	c.mu.Lock()
	c.jobs[jobID] = job
	if err := c.writeJobLocked(job); err != nil {
		delete(c.jobs, jobID)
		c.mu.Unlock()
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInternal, Message: "failed to persist release job"}
	}
	c.mu.Unlock()
	go c.run(jobID, payload, sourcePath)
	return releaseCommandResponse{OK: true, Accepted: true, Status: "running", Job: cloneReleaseJob(job)}, nil
}

func (c *ReleaseCommand) status(payload releaseCommandPayload) (releaseCommandResponse, *releaseCommandError) {
	jobID := strings.TrimSpace(payload.JobID)
	if jobID == "" {
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeInvalidArgument, Message: "jobId is required"}
	}
	c.mu.Lock()
	job := c.jobs[jobID]
	if job == nil {
		loaded, err := c.readJobLocked(jobID)
		if err != nil {
			c.mu.Unlock()
			return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeNotFound, Message: "release job not found"}
		}
		job = loaded
		c.jobs[jobID] = job
	}
	if job.HubID != payload.HubID {
		c.mu.Unlock()
		return releaseCommandResponse{}, &releaseCommandError{Code: rp.CodeForbidden, Message: "release job belongs to another hub"}
	}
	response := releaseCommandResponse{OK: true, Status: job.Status, Job: cloneReleaseJob(job)}
	c.mu.Unlock()
	return response, nil
}

func (c *ReleaseCommand) run(jobID string, payload releaseCommandPayload, sourcePath string) {
	c.buildMu.Lock()
	defer c.buildMu.Unlock()
	args := []string{"scripts/release.mjs"}
	if payload.Kind == "debugWeb" {
		args = []string{"scripts/release/debug-web.mjs", "--output", c.debugWebArchivePath(jobID)}
	} else {
		args = append(args, "--publish")
		if payload.Desktop {
			args = append(args, "--with-desktop")
		}
		if payload.Android {
			args = append(args, "--with-android")
		}
	}
	err := c.runner.Run(context.Background(), sourcePath, args, func(text string) { c.appendLog(jobID, text) })
	if payload.Kind == "debugWeb" {
		c.completeDebugWeb(jobID, payload, err)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	job := c.jobs[jobID]
	if job == nil {
		return
	}
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	job.FinishedAt = job.UpdatedAt
	if err != nil {
		job.Status = "failed"
		job.ErrorCode = "publish_failed"
		c.appendLogLocked(job, err.Error()+"\n")
	} else {
		job.Status = "success"
		if payload.AutoPull && strings.TrimSpace(payload.TargetHubID) != "" && c.notifier != nil {
			job.Status = "notifying"
			_ = c.writeJobLocked(job)
			c.mu.Unlock()
			target, notifyErr := c.notifier.NotifyRelease(context.Background(), strings.TrimSpace(payload.TargetHubID), payload.Kind, strings.TrimSpace(payload.BaseURL))
			c.mu.Lock()
			job = c.jobs[jobID]
			if job == nil {
				return
			}
			if notifyErr != nil {
				job.TargetState = "failed"
				c.appendLogLocked(job, "target hub notification failed\n")
			} else {
				job.TargetState = target.Status
			}
			job.Status = "success"
		}
	}
	_ = c.writeJobLocked(job)
}

func (c *ReleaseCommand) completeDebugWeb(jobID string, payload releaseCommandPayload, buildErr error) {
	if buildErr != nil {
		c.finishDebugWebJob(jobID, "failed", "publish_failed", "failed", buildErr.Error()+"\n")
		return
	}
	archivePath := c.debugWebArchivePath(jobID)
	size, digest, err := inspectDebugWebArchive(archivePath)
	if err != nil {
		c.finishDebugWebJob(jobID, "failed", "debug_web_artifact_invalid", "failed", err.Error()+"\n")
		return
	}
	c.mu.Lock()
	job := c.jobs[jobID]
	if job == nil {
		c.mu.Unlock()
		return
	}
	job.Status = "transferring"
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	c.appendLogLocked(job, "transferring debug web to "+payload.WebHubID+"\n")
	_ = c.writeJobLocked(job)
	c.mu.Unlock()
	if c.notifier == nil {
		c.finishDebugWebJob(jobID, "failed", "debug_web_transfer_unavailable", "failed", "registry transfer is unavailable\n")
		return
	}
	target, transferErr := c.notifier.TransferDebugWeb(context.Background(), payload.WebHubID, jobID, archivePath, size, digest)
	if transferErr != nil || target.Status != "success" {
		errorCode := target.ErrorCode
		if errorCode == "" {
			errorCode = "debug_web_transfer_failed"
		}
		message := "debug web transfer failed\n"
		if transferErr != nil {
			message = transferErr.Error() + "\n"
		}
		c.finishDebugWebJob(jobID, "failed", errorCode, "failed", message)
		return
	}
	c.finishDebugWebJob(jobID, "success", "", "success", "debug web applied\n")
}

func (c *ReleaseCommand) finishDebugWebJob(jobID, status, errorCode, targetState, log string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	job := c.jobs[jobID]
	if job == nil {
		return
	}
	job.Status = status
	job.ErrorCode = errorCode
	job.TargetState = targetState
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	job.FinishedAt = job.UpdatedAt
	c.appendLogLocked(job, log)
	_ = c.writeJobLocked(job)
}

func (c *ReleaseCommand) debugWebArchivePath(jobID string) string {
	return filepath.Join(c.stateDir, releaseJobDirectoryName, jobID, "debug-web.zip")
}

func inspectDebugWebArchive(path string) (int64, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer file.Close()
	hasher := sha256.New()
	size, err := io.Copy(hasher, io.LimitReader(file, maxDebugWebArchiveBytes+1))
	if err != nil || size <= 0 || size > maxDebugWebArchiveBytes {
		return 0, "", errors.New("invalid debug web artifact")
	}
	return size, hex.EncodeToString(hasher.Sum(nil)), nil
}

func releaseSourcePath(raw, kind string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", errors.New("sourcePath is required")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", errors.New("sourcePath is invalid")
	}
	entry := filepath.Join(abs, "scripts", "release.mjs")
	if kind == "debugWeb" {
		entry = filepath.Join(abs, "scripts", "release", "debug-web.mjs")
	}
	info, err := os.Stat(entry)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("sourcePath does not contain %s", filepath.ToSlash(filepath.Join("scripts", strings.TrimPrefix(entry, abs+string(filepath.Separator)))))
	}
	return abs, nil
}

func cleanReleaseHTTPSOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("not a clean HTTPS origin")
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

func (c *ReleaseCommand) appendLog(jobID, text string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	job := c.jobs[jobID]
	if job == nil {
		return
	}
	c.appendLogLocked(job, text)
	job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
	_ = c.writeJobLocked(job)
}

func (c *ReleaseCommand) appendLogLocked(job *releasePublishJob, text string) {
	text = releaseLogSecretPattern.ReplaceAllString(text, "$1[REDACTED]")
	job.Log += text
	if len(job.Log) > 48*1024 {
		job.Log = job.Log[len(job.Log)-48*1024:]
	}
}

func (c *ReleaseCommand) jobPath(jobID string) string {
	return filepath.Join(c.stateDir, releaseJobDirectoryName, jobID+".json")
}

func (c *ReleaseCommand) writeJobLocked(job *releasePublishJob) error {
	raw, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return replaceUpdateFile(c.jobPath(job.ID), append(raw, '\n'), 0o600)
}

func (c *ReleaseCommand) readJobLocked(jobID string) (*releasePublishJob, error) {
	raw, err := os.ReadFile(c.jobPath(jobID))
	if err != nil {
		return nil, err
	}
	var job releasePublishJob
	if err := json.Unmarshal(raw, &job); err != nil || job.Schema != 1 || job.ID != jobID || job.HubID == "" || job.Status == "" {
		return nil, errors.New("invalid release job")
	}
	return &job, nil
}

func cloneReleaseJob(job *releasePublishJob) *releasePublishJob {
	if job == nil {
		return nil
	}
	copy := *job
	return &copy
}
