package tools

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	installedReleaseName       = "release.json"
	updateStagingDirectoryName = "staging"
	updateLeaseFileName        = "lock.json"
	updateStatusFileName       = "status.json"
	defaultStableURL           = "https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/stable.json"
	defaultPublishStatusURL    = "https://raw.githubusercontent.com/swm8023/wheelmaker-release/main/publish-status.json"
	maxUpdateMetadataBytes     = 1024 * 1024
)

type installedRelease struct {
	SchemaVersion int    `json:"schemaVersion"`
	Version       string `json:"version"`
	PublishedAt   string `json:"publishedAt"`
	SourceSHA     string `json:"sourceSha"`
	ManifestSHA   string `json:"manifestSha256"`
	InstalledAt   string `json:"installedAt"`
}

type stableRelease struct {
	Schema      int    `json:"schema"`
	Version     string `json:"version"`
	PublishedAt string `json:"publishedAt"`
	SourceSHA   string `json:"sourceSha"`
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

func (e *updateCommandError) commandCode() string {
	if e == nil {
		return ""
	}
	return e.Code
}

func (e *updateCommandError) commandMessage() string {
	if e == nil {
		return ""
	}
	return e.Message
}

type updateHTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

type updateTrigger interface {
	Trigger(context.Context) error
}

type UpdateCommand struct {
	baseDir          string
	httpClient       updateHTTPClient
	trigger          updateTrigger
	now              func() time.Time
	stableURL        string
	publishStatusURL string
}

func NewUpdateCommand(baseDir string) *UpdateCommand {
	return newUpdateCommandWithDependencies(baseDir, newUpdateHTTPClient(), execUpdateTrigger{})
}

func newUpdateCommandWithDependencies(baseDir string, client updateHTTPClient, trigger updateTrigger) *UpdateCommand {
	if client == nil {
		client = newUpdateHTTPClient()
	}
	if trigger == nil {
		trigger = execUpdateTrigger{}
	}
	return &UpdateCommand{
		baseDir:          filepath.Clean(baseDir),
		httpClient:       client,
		trigger:          trigger,
		now:              func() time.Time { return time.Now().UTC() },
		stableURL:        defaultStableURL,
		publishStatusURL: defaultPublishStatusURL,
	}
}

func newUpdateHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return errors.New("update metadata redirect must use HTTPS")
			}
			return nil
		},
	}
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
		return c.query(ctx, payload.HubID), nil
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

func (c *UpdateCommand) query(ctx context.Context, hubID string) updateCommandResponse {
	installed, err := c.readInstalledRelease()
	if errors.Is(err, os.ErrNotExist) {
		return updateCommandResponse{
			OK:         true,
			Status:     "not_installed",
			HubID:      hubID,
			Job:        c.readJobStatus(),
			CanRequest: false,
		}
	}
	if err != nil {
		return updateQueryFailure(hubID, "installed_release_invalid")
	}

	stable, errorCode := c.readStable(ctx)
	if errorCode != "" {
		response := updateQueryFailure(hubID, errorCode)
		response.Installed = installed
		response.Job = c.readJobStatus()
		return response
	}

	installedSequence, err := releaseSequence(installed.Version)
	if err != nil {
		response := updateQueryFailure(hubID, "installed_release_invalid")
		response.Installed = installed
		return response
	}
	stableSequence, err := releaseSequence(stable.Version)
	if err != nil {
		response := updateQueryFailure(hubID, "stable_metadata_invalid")
		response.Installed = installed
		return response
	}

	status := "up_to_date"
	canRequest := false
	switch {
	case stableSequence > installedSequence:
		status = "update_available"
		canRequest = true
	case stableSequence < installedSequence:
		status = "local_newer"
	}
	job := c.readJobStatus()
	if job != nil && activeUpdateState(job.State) {
		status = "update_pending"
		canRequest = false
	}
	return updateCommandResponse{
		OK:        true,
		Status:    status,
		HubID:     hubID,
		Installed: installed,
		Stable: &stableReleaseSummary{
			Version:     stable.Version,
			PublishedAt: stable.PublishedAt,
			SourceSHA:   stable.SourceSHA,
		},
		Job:           job,
		PublishStatus: c.readPublishStatus(ctx),
		CanRequest:    canRequest,
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
	stagingDir := filepath.Join(c.baseDir, updateStagingDirectoryName)
	if err := os.MkdirAll(stagingDir, 0o700); err != nil {
		return updateCommandResponse{}, internalUpdateError("failed to create update staging directory")
	}
	leasePath := filepath.Join(stagingDir, updateLeaseFileName)
	now := c.now().UTC().Format(time.RFC3339Nano)
	jobID, err := newUpdateJobID()
	if err != nil {
		return updateCommandResponse{}, internalUpdateError("failed to allocate update job")
	}
	lease := updateLease{
		Schema:      1,
		JobID:       jobID,
		Owner:       "web",
		State:       "queued",
		StartedAt:   now,
		HeartbeatAt: now,
	}
	created, existing, err := createUpdateLease(leasePath, lease)
	if err != nil {
		return updateCommandResponse{}, internalUpdateError("failed to create update lease")
	}
	if !created {
		job := c.readJobStatus()
		if job == nil || job.JobID != existing.JobID {
			job = &updateJobStatus{
				Schema:    1,
				JobID:     existing.JobID,
				State:     existing.State,
				StartedAt: existing.StartedAt,
				UpdatedAt: existing.HeartbeatAt,
			}
		}
		return queuedUpdateResponse(hubID, existing.JobID, job), nil
	}

	job := &updateJobStatus{
		Schema:    1,
		JobID:     jobID,
		State:     "queued",
		StartedAt: now,
		UpdatedAt: now,
	}
	if err := c.writeJobStatus(*job); err != nil {
		_ = os.Remove(leasePath)
		return updateCommandResponse{}, internalUpdateError("failed to write update status")
	}
	if err := c.trigger.Trigger(ctx); err != nil {
		job.State = "failed"
		job.ErrorCode = "updater_trigger_failed"
		job.UpdatedAt = c.now().UTC().Format(time.RFC3339Nano)
		_ = c.writeJobStatus(*job)
		_ = os.Remove(leasePath)
		return updateCommandResponse{}, internalUpdateError("failed to trigger updater runtime")
	}
	return queuedUpdateResponse(hubID, jobID, job), nil
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

func (c *UpdateCommand) readStable(ctx context.Context) (*stableRelease, string) {
	raw, err := c.fetchBytes(ctx, c.stableURL)
	if err != nil {
		return nil, "stable_download_failed"
	}
	var stable stableRelease
	if err := json.Unmarshal(raw, &stable); err != nil {
		return nil, "stable_metadata_invalid"
	}
	if stable.Schema != 1 || stable.PublishedAt == "" || !validHexDigest(stable.SourceSHA, 40) {
		return nil, "stable_metadata_invalid"
	}
	if _, err := releaseSequence(stable.Version); err != nil {
		return nil, "stable_metadata_invalid"
	}
	return &stable, ""
}

func (c *UpdateCommand) readPublishStatus(ctx context.Context) *publishStatus {
	raw, err := c.fetchBytes(ctx, c.publishStatusURL)
	if err != nil {
		return nil
	}
	var status publishStatus
	if err := json.Unmarshal(raw, &status); err != nil || status.Schema != 1 || status.State == "" || status.Phase == "" {
		return nil
	}
	return &status
}

func (c *UpdateCommand) fetchBytes(ctx context.Context, rawURL string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("update metadata URL must use HTTPS")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected HTTP status %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxUpdateMetadataBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxUpdateMetadataBytes {
		return nil, errors.New("update metadata exceeds size limit")
	}
	return raw, nil
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

func (c *UpdateCommand) writeJobStatus(status updateJobStatus) error {
	raw, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	path := filepath.Join(c.baseDir, updateStagingDirectoryName, updateStatusFileName)
	return replaceUpdateFile(path, raw, 0o600)
}

func createUpdateLease(path string, lease updateLease) (bool, updateLease, error) {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return false, updateLease{}, readErr
		}
		var existing updateLease
		if jsonErr := json.Unmarshal(raw, &existing); jsonErr != nil || existing.Schema != 1 || existing.JobID == "" {
			return false, updateLease{}, errors.New("invalid existing update lease")
		}
		return false, existing, nil
	}
	if err != nil {
		return false, updateLease{}, err
	}
	raw, err := json.MarshalIndent(lease, "", "  ")
	if err == nil {
		raw = append(raw, '\n')
		_, err = file.Write(raw)
	}
	if syncErr := file.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return false, updateLease{}, err
	}
	return true, lease, nil
}

func replaceUpdateFile(path string, raw []byte, mode os.FileMode) (retErr error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".update-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err == nil {
		return nil
	}
	backupPath := path + ".previous"
	_ = os.Remove(backupPath)
	if err := os.Rename(path, backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Rename(backupPath, path)
		return err
	}
	_ = os.Remove(backupPath)
	return nil
}

func newUpdateJobID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
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
		return updateTriggerCommand{Name: "systemctl", Args: []string{"--user", "start", "wheelmaker-updater.service"}}
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
