package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/swm8023/wheelmaker/internal/hub/agent"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

var (
	skillSourceRepoPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	skillSourceSlugPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
	skillNamePattern         = regexp.MustCompile(`^[@A-Za-z0-9][@A-Za-z0-9_.:-]*$`)
	ansiEscapePattern        = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	skillSourceSecretPattern = regexp.MustCompile(`(?i)(token|access_token|auth|password|key)=([^&\s]+)`)
)

var fixedSkillAgents = []string{"codex", "claude"}

type skillsCommandCall struct {
	Dir  string
	Name string
	Args []string
}

type skillsCommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

type skillsCommandRunner interface {
	Run(ctx context.Context, dir string, name string, args ...string) skillsCommandResult
}

type skillsCommandPathResolver interface {
	LookPath(name string) (string, error)
}

type execSkillsCommandRunner struct{}

func (execSkillsCommandRunner) Run(ctx context.Context, dir string, name string, args ...string) skillsCommandResult {
	cmd := exec.CommandContext(ctx, name, args...)
	shared.ConfigureBackgroundCommand(cmd)
	if strings.TrimSpace(dir) != "" {
		cmd.Dir = dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	return skillsCommandResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
		Err:      err,
	}
}

func (execSkillsCommandRunner) LookPath(name string) (string, error) {
	return exec.LookPath(name)
}

type skillsCommandConfig struct {
	HubID           string
	Projects        []ProjectInfo
	GlobalLockPath  string
	HomeDir         string
	OnOperationDone func(scope, projectName string, operation SkillsOperationSnapshot)
	LookPath        func(name string) (string, error)
	ResolveSource   func(context.Context, skillSourceSnapshot) (skillSourceSnapshot, error)
}

type SkillsCommand struct {
	runner          skillsCommandRunner
	lookPath        func(name string) (string, error)
	now             func() time.Time
	hubID           string
	globalLockPath  string
	homeDir         string
	onOperationDone func(scope, projectName string, operation SkillsOperationSnapshot)
	resolveSource   func(context.Context, skillSourceSnapshot) (skillSourceSnapshot, error)
	store           *skillSourceStore

	mu               sync.RWMutex
	projects         []ProjectInfo
	operation        *skillsOperationSnapshot
	previews         map[string]skillsStoredSourcePreview
	sourceErrors     map[string]map[string]string
	previewCounter   uint64
	operationCounter uint64
}

func NewSkillsCommand(config skillsCommandConfig) *SkillsCommand {
	return newSkillsCommandWithRunner(execSkillsCommandRunner{}, config)
}

func newSkillsCommandWithRunner(runner skillsCommandRunner, config skillsCommandConfig) *SkillsCommand {
	if runner == nil {
		runner = execSkillsCommandRunner{}
	}
	lookPath := config.LookPath
	if lookPath == nil {
		if resolver, ok := runner.(skillsCommandPathResolver); ok {
			lookPath = resolver.LookPath
		} else {
			lookPath = func(name string) (string, error) {
				return name, nil
			}
		}
	}
	cmd := &SkillsCommand{
		runner:          runner,
		lookPath:        lookPath,
		hubID:           strings.TrimSpace(config.HubID),
		globalLockPath:  strings.TrimSpace(config.GlobalLockPath),
		homeDir:         strings.TrimSpace(config.HomeDir),
		store:           newSkillSourceStore(config.HomeDir),
		onOperationDone: config.OnOperationDone,
		resolveSource:   config.ResolveSource,
		previews:        map[string]skillsStoredSourcePreview{},
		sourceErrors:    map[string]map[string]string{},
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
	if cmd.resolveSource == nil {
		cmd.resolveSource = newSkillSourceResolver("").Resolve
	}
	cmd.SetProjects(config.Projects)
	return cmd
}

func (c *SkillsCommand) SetProjects(projects []ProjectInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.projects = append([]ProjectInfo(nil), projects...)
}

func (c *SkillsCommand) SkillSourceErrors(scope, projectName string) map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	stored := c.sourceErrors[skillSourceErrorScopeKey(scope, projectName)]
	if len(stored) == 0 {
		return nil
	}
	result := make(map[string]string, len(stored))
	for sourceKey, message := range stored {
		result[sourceKey] = message
	}
	return result
}

func (c *SkillsCommand) setSkillSourceError(target skillsCommandTarget, sourceKey, message string) {
	scopeKey := skillSourceErrorScopeKey(target.scope, target.projectName)
	sourceKey = skillSourceKeyMapKey(sourceKey)
	message = strings.TrimSpace(message)
	if sourceKey == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if message == "" {
		if stored := c.sourceErrors[scopeKey]; stored != nil {
			delete(stored, sourceKey)
			if len(stored) == 0 {
				delete(c.sourceErrors, scopeKey)
			}
		}
		return
	}
	if c.sourceErrors[scopeKey] == nil {
		c.sourceErrors[scopeKey] = map[string]string{}
	}
	c.sourceErrors[scopeKey][sourceKey] = message
}

func skillSourceErrorScopeKey(scope, projectName string) string {
	return strings.ToLower(strings.TrimSpace(scope)) + "\x00" + strings.TrimSpace(projectName)
}

type skillsCommandPayload struct {
	Action      string   `json:"action"`
	HubID       string   `json:"hubId"`
	Scope       string   `json:"scope,omitempty"`
	ProjectName string   `json:"projectName,omitempty"`
	Source      string   `json:"source,omitempty"`
	SkillName   string   `json:"skillName,omitempty"`
	Skills      []string `json:"skills,omitempty"`
	PreviewID   string   `json:"previewId,omitempty"`
}

type skillsCommandResponse struct {
	OK           bool                       `json:"ok"`
	Accepted     bool                       `json:"accepted,omitempty"`
	HubID        string                     `json:"hubId"`
	UpdatedAt    string                     `json:"updatedAt,omitempty"`
	Source       string                     `json:"source,omitempty"`
	Scope        string                     `json:"scope,omitempty"`
	ProjectName  string                     `json:"projectName,omitempty"`
	HubSkills    skillsScopeSnapshot        `json:"hubSkills,omitempty"`
	Projects     []skillsProjectSnapshot    `json:"projects,omitempty"`
	Skills       []skillsSkillSnapshot      `json:"skills,omitempty"`
	Detail       *skillsSkillDetailSnapshot `json:"detail,omitempty"`
	Candidates   []skillsSourceCandidate    `json:"candidates,omitempty"`
	Operation    *skillsOperationSnapshot   `json:"operation,omitempty"`
	Message      string                     `json:"message,omitempty"`
	ErrorSummary string                     `json:"errorSummary,omitempty"`
	Preview      *skillsSourcePreview       `json:"preview,omitempty"`
	Repo         *skillsRepoSnapshot        `json:"repo,omitempty"`
}

type skillsRepoSnapshot struct {
	Source          string                     `json:"source"`
	SourceKey       string                     `json:"sourceKey"`
	Branch          string                     `json:"branch,omitempty"`
	Commit          string                     `json:"commit,omitempty"`
	RemoteCommit    string                     `json:"remoteCommit,omitempty"`
	UpdateAvailable bool                       `json:"updateAvailable"`
	Skills          []skillSourceSkillSnapshot `json:"skills"`
}

type skillsSourcePreview struct {
	ID              string                     `json:"id"`
	Kind            string                     `json:"kind"`
	Scope           string                     `json:"scope"`
	ProjectName     string                     `json:"projectName,omitempty"`
	Source          string                     `json:"source"`
	SourceKey       string                     `json:"sourceKey"`
	ResolvedCommit  string                     `json:"resolvedCommit"`
	SkillList       []skillSourceSkillSnapshot `json:"skillList"`
	Skills          []string                   `json:"skills,omitempty"`
	OverwritesLocal bool                       `json:"overwritesLocal,omitempty"`
	CreatedAt       string                     `json:"createdAt"`
}

type skillsStoredSourcePreview struct {
	preview          skillsSourcePreview
	target           skillsCommandTarget
	lockPath         string
	expectedRevision string
	updatedLock      skillSourceLock
	runs             []skillsOperationRun
	initialResults   []skillsOperationItemResult
	deleteSource     bool
}

type skillsOperationSnapshot struct {
	ID           string                      `json:"id"`
	Running      bool                        `json:"running"`
	Action       string                      `json:"action"`
	Scope        string                      `json:"scope,omitempty"`
	ProjectName  string                      `json:"projectName,omitempty"`
	Source       string                      `json:"source,omitempty"`
	Skills       []string                    `json:"skills,omitempty"`
	Status       string                      `json:"status"`
	StartedAt    string                      `json:"startedAt"`
	FinishedAt   string                      `json:"finishedAt,omitempty"`
	ExitCode     *int                        `json:"exitCode"`
	ErrorSummary string                      `json:"errorSummary,omitempty"`
	Message      string                      `json:"message,omitempty"`
	Results      []skillsOperationItemResult `json:"results,omitempty"`
}

type skillsOperationItemResult struct {
	Skill        string `json:"skill"`
	Action       string `json:"action"`
	Status       string `json:"status"`
	ErrorSummary string `json:"errorSummary,omitempty"`
}

type SkillsOperationSnapshot = skillsOperationSnapshot

type skillsScopeSnapshot struct {
	Scope  string                `json:"scope"`
	Skills []skillsSkillSnapshot `json:"skills"`
}

type skillsProjectSnapshot struct {
	ProjectName string                `json:"projectName"`
	ProjectID   string                `json:"projectId"`
	Path        string                `json:"path"`
	Skills      []skillsSkillSnapshot `json:"skills"`
	Error       string                `json:"error,omitempty"`
}

type skillsSkillSnapshot struct {
	Name        string   `json:"name"`
	Path        string   `json:"path,omitempty"`
	Category    string   `json:"category"`
	CategoryKey string   `json:"categoryKey"`
	Managed     bool     `json:"managed"`
	Agents      []string `json:"agents,omitempty"`
}

type skillsSkillDetailSnapshot struct {
	Name            string                 `json:"name"`
	Scope           string                 `json:"scope"`
	ProjectName     string                 `json:"projectName,omitempty"`
	Path            string                 `json:"path,omitempty"`
	Category        string                 `json:"category"`
	CategoryKey     string                 `json:"categoryKey"`
	Managed         bool                   `json:"managed"`
	Agents          []string               `json:"agents,omitempty"`
	Source          string                 `json:"source,omitempty"`
	SourceURL       string                 `json:"sourceUrl,omitempty"`
	SourceType      string                 `json:"sourceType,omitempty"`
	SkillPath       string                 `json:"skillPath,omitempty"`
	PluginName      string                 `json:"pluginName,omitempty"`
	InstalledAt     string                 `json:"installedAt,omitempty"`
	UpdatedAt       string                 `json:"updatedAt,omitempty"`
	SkillMarkdown   string                 `json:"skillMarkdown"`
	SupportingFiles []skillsSupportingFile `json:"supportingFiles"`
}

type skillsSupportingFile struct {
	RelativePath string `json:"relativePath"`
	Size         int64  `json:"size,omitempty"`
	Directory    bool   `json:"directory,omitempty"`
}

type skillsSourceCandidate struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category"`
	CategoryKey string `json:"categoryKey"`
}

type skillsCommandError struct {
	Code    string
	Message string
}

func (e *skillsCommandError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == "" {
		return e.Message
	}
	return e.Code + ": " + e.Message
}

func (c *SkillsCommand) Handle(ctx context.Context, raw json.RawMessage) (any, *skillsCommandError) {
	var rawFields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &rawFields); err != nil {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.skills payload"}
	}
	if _, exists := rawFields["ref"]; exists {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill source refs are unsupported; use the repository default branch"}
	}
	var payload skillsCommandPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.skills payload"}
	}
	payload.Action = strings.TrimSpace(payload.Action)
	payload.HubID = strings.TrimSpace(payload.HubID)
	payload.Scope = strings.TrimSpace(payload.Scope)
	payload.ProjectName = strings.TrimSpace(payload.ProjectName)
	payload.Source = strings.TrimSpace(payload.Source)
	payload.PreviewID = strings.TrimSpace(payload.PreviewID)
	payload.SkillName = strings.TrimSpace(payload.SkillName)
	payload.Skills = normalizeSkillNames(payload.Skills)
	if payload.SkillName != "" && len(payload.Skills) == 0 {
		payload.Skills = []string{payload.SkillName}
	}
	if payload.HubID == "" {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "hubId is required"}
	}
	if c.hubID != "" && payload.HubID != c.hubID {
		return nil, &skillsCommandError{Code: rp.CodeForbidden, Message: "hubId does not match this hub"}
	}
	if payload.Source != "" {
		if err := validateSkillSourceHasNoExplicitRef(payload.Source); err != nil {
			return nil, err
		}
	}

	switch payload.Action {
	case "reindex":
		return c.nativeScan(ctx, payload.HubID), nil
	case "inspectRepo":
		return c.inspectNativeRepo(ctx, payload)
	case "addRepo":
		return c.startNativeAddRepo(payload)
	case "refreshRepo":
		return c.startNativeRefreshRepo(payload)
	case "updateRepo":
		return c.startNativeUpdateRepo(payload)
	case "updateScope":
		return c.startNativeScopeOperation(payload, false)
	case "installAll":
		return c.startNativeInstall(payload, true)
	case "installAllScope":
		return c.startNativeScopeOperation(payload, true)
	case "removeRepo":
		return c.startNativeRemoveRepo(payload)
	case "operation":
		return skillsCommandResponse{OK: true, HubID: payload.HubID, UpdatedAt: c.now().Format(time.RFC3339), Operation: c.currentOperationSnapshot()}, nil
	case "detail":
		return c.nativeDetail(ctx, payload)
	case "install":
		return c.startNativeInstall(payload, false)
	case "uninstall":
		return c.startNativeUninstall(payload)
	default:
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.skills action"}
	}
}

func (c *SkillsCommand) detail(ctx context.Context, payload skillsCommandPayload) (skillsCommandResponse, *skillsCommandError) {
	skillName := payload.SkillName
	if skillName == "" {
		if len(payload.Skills) != 1 {
			return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "exactly one skillName is required"}
		}
		skillName = payload.Skills[0]
	}
	if err := validateSkillNames([]string{skillName}); err != nil {
		return skillsCommandResponse{}, err
	}
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}

	skill, detailErr := c.discoverSkillForDetail(ctx, target, skillName)
	if detailErr != nil {
		return skillsCommandResponse{}, detailErr
	}
	detail, detailErr := c.skillDetailFromSnapshot(target, skill)
	if detailErr != nil {
		return skillsCommandResponse{}, detailErr
	}
	return skillsCommandResponse{
		OK:          true,
		HubID:       payload.HubID,
		UpdatedAt:   c.now().Format(time.RFC3339),
		Scope:       target.scope,
		ProjectName: target.projectName,
		Detail:      detail,
	}, nil
}

func (c *SkillsCommand) scan(ctx context.Context, hubID string) skillsCommandResponse {
	updatedAt := c.now().Format(time.RFC3339)
	hubSkills, hubErr := c.scanHubSkills(ctx)
	resp := skillsCommandResponse{
		OK:        hubErr == "",
		HubID:     hubID,
		UpdatedAt: updatedAt,
		HubSkills: skillsScopeSnapshot{
			Scope:  "hub",
			Skills: hubSkills,
		},
		Projects:  []skillsProjectSnapshot{},
		Operation: c.currentOperationSnapshot(),
	}
	if hubErr != "" {
		resp.ErrorSummary = hubErr
	}

	for _, project := range c.projectSnapshot() {
		projectName := strings.TrimSpace(project.Name)
		snapshot := skillsProjectSnapshot{
			ProjectName: projectName,
			ProjectID:   rp.ProjectID(hubID, projectName),
			Path:        strings.TrimSpace(project.Path),
			Skills:      []skillsSkillSnapshot{},
		}
		if snapshot.Path == "" {
			snapshot.Error = "project path is empty"
			resp.Projects = append(resp.Projects, snapshot)
			continue
		}
		skills, errSummary := c.scanProjectSkills(ctx, project)
		snapshot.Skills = skills
		snapshot.Error = errSummary
		resp.Projects = append(resp.Projects, snapshot)
	}
	return resp
}

func (c *SkillsCommand) listSource(ctx context.Context, payload skillsCommandPayload) (skillsCommandResponse, *skillsCommandError) {
	if err := validateRemoteSkillSource(payload.Source); err != nil {
		return skillsCommandResponse{}, err
	}
	result := c.runSkills(ctx, "", "add", payload.Source, "--list")
	if skillsCommandFailed(result) {
		return skillsCommandResponse{
			OK:           false,
			HubID:        payload.HubID,
			UpdatedAt:    c.now().Format(time.RFC3339),
			Source:       payload.Source,
			ErrorSummary: skillsResultSummary(result),
		}, nil
	}
	candidates := parseSkillsSourceCandidates(result.Stdout)
	if len(candidates) == 0 {
		return skillsCommandResponse{
			OK:           false,
			HubID:        payload.HubID,
			UpdatedAt:    c.now().Format(time.RFC3339),
			Source:       payload.Source,
			ErrorSummary: "skills list output did not include any installable skills",
		}, nil
	}
	return skillsCommandResponse{
		OK:         true,
		HubID:      payload.HubID,
		UpdatedAt:  c.now().Format(time.RFC3339),
		Source:     payload.Source,
		Candidates: candidates,
	}, nil
}

func (c *SkillsCommand) previewSource(ctx context.Context, payload skillsCommandPayload) (skillsCommandResponse, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	normalizedSource, sourceKey, err := normalizeSkillGitSource(payload.Source)
	if err != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeForbidden, Message: err.Error()}
	}
	lockPath := c.sourceLockFile(target)
	migration, err := readOrMigrateSkillSourceLock(c.skillsLockFile(target), lockPath)
	if err != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	lock := migration.Lock
	existingIndex := -1
	for index, source := range lock.Sources {
		if skillSourceKeysEqual(source.SourceKey, sourceKey) {
			existingIndex = index
			if source.Source != normalizedSource {
				return skillsCommandResponse{}, &skillsCommandError{
					Code: rp.CodeConflict, Message: "repository already exists in this scope with a different immutable address",
				}
			}
			break
		}
	}
	candidate := skillSourceSnapshot{Source: normalizedSource, SourceKey: sourceKey, SkillList: []skillSourceSkillSnapshot{}}
	resolved, err := c.resolveSource(ctx, candidate)
	if err != nil {
		message := sanitizeSkillSourceError(err.Error(), payload.Source)
		if existingIndex >= 0 {
			c.setSkillSourceError(target, sourceKey, message)
		}
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: message}
	}
	if resolved.Source == "" {
		resolved.Source = normalizedSource
	}
	if resolved.SourceKey == "" {
		resolved.SourceKey = sourceKey
	}
	validation := newSkillSourceLock()
	validation.Sources = []skillSourceSnapshot{resolved}
	if err := validateSkillSourceLock(validation); err != nil {
		if existingIndex >= 0 {
			c.setSkillSourceError(target, sourceKey, err.Error())
		}
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	c.setSkillSourceError(target, sourceKey, "")
	if existingIndex >= 0 {
		lock.Sources[existingIndex] = resolved
	} else {
		lock.Sources = append(lock.Sources, resolved)
	}
	sortSkillSourceLock(&lock)

	selectedSkills := []string{}
	if payload.Action == "previewInstall" {
		if len(payload.Skills) == 0 {
			return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skills are required"}
		}
		if err := validateSkillNames(payload.Skills); err != nil {
			return skillsCommandResponse{}, err
		}
		remoteNames := make(map[string]string, len(resolved.SkillList))
		for _, skill := range resolved.SkillList {
			remoteNames[strings.ToLower(skill.Name)] = skill.Name
		}
		for _, requested := range payload.Skills {
			name, exists := remoteNames[strings.ToLower(requested)]
			if !exists {
				return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeNotFound, Message: "skill not found in refreshed source: " + requested}
			}
			selectedSkills = append(selectedSkills, name)
		}
		native := readNativeSkillSourceEntries(c.skillsLockFile(target))
		installed, installErr := c.installedSnapshotsForTarget(target, native)
		if installErr != nil {
			return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: installErr.Error()}
		}
		catalog := composeSkillSourceCatalog(lock, native, installed, nil)
		eligible := map[string]bool{}
		for _, source := range catalog.Sources {
			if !skillSourceKeysEqual(source.SourceKey, sourceKey) {
				continue
			}
			for _, row := range source.Skills {
				eligible[strings.ToLower(row.Name)] = row.CanInstall
			}
		}
		for _, skill := range selectedSkills {
			if !eligible[strings.ToLower(skill)] {
				return skillsCommandResponse{}, &skillsCommandError{
					Code: rp.CodeConflict, Message: "skill is already installed or conflicts with another source: " + skill,
				}
			}
		}
	}
	preview := skillsSourcePreview{
		Kind: payload.Action, Scope: target.scope, ProjectName: target.projectName,
		Source: resolved.Source, SourceKey: resolved.SourceKey,
		ResolvedCommit: resolved.ResolvedCommit,
		SkillList:      append([]skillSourceSkillSnapshot(nil), resolved.SkillList...),
		Skills:         append([]string(nil), selectedSkills...),
		CreatedAt:      c.now().Format(time.RFC3339),
	}
	runs := []skillsOperationRun{}
	if payload.Action == "previewInstall" {
		for _, skill := range selectedSkills {
			runs = append(runs, skillsOperationRun{
				target: target, args: skillsAddArgs(target, skillSourceAddress(resolved), []string{skill}),
				skill: skill, action: "install", message: "Installed skills.", prepareInstallDirs: true,
			})
		}
	}
	stored := skillsStoredSourcePreview{
		preview: preview, target: target, lockPath: lockPath,
		expectedRevision: migration.Revision, updatedLock: lock, runs: runs,
	}
	if cmdErr := c.storeSourcePreview(&stored); cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	return skillsCommandResponse{
		OK: true, HubID: payload.HubID, UpdatedAt: preview.CreatedAt,
		Source: resolved.Source, Scope: target.scope, ProjectName: target.projectName,
		Preview: cloneSkillsSourcePreview(&stored.preview),
	}, nil
}

func (c *SkillsCommand) previewUpdate(ctx context.Context, payload skillsCommandPayload) (skillsCommandResponse, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	if err := validateSkillNames(payload.Skills); err != nil {
		return skillsCommandResponse{}, err
	}
	lockPath := c.sourceLockFile(target)
	migration, err := readOrMigrateSkillSourceLock(c.skillsLockFile(target), lockPath)
	if err != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	lock := migration.Lock
	selectedKey := ""
	if payload.Source != "" {
		_, selectedKey, err = normalizeSkillGitSource(payload.Source)
		if err != nil {
			return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeForbidden, Message: err.Error()}
		}
	}
	resolvedByKey := map[string]skillSourceSnapshot{}
	selectedCount := 0
	var firstResolveError *skillsCommandError
	for index, source := range lock.Sources {
		if selectedKey != "" && !skillSourceKeysEqual(source.SourceKey, selectedKey) {
			continue
		}
		selectedCount++
		resolved, resolveErr := c.resolveSource(ctx, source)
		if resolveErr != nil {
			message := sanitizeSkillSourceError(resolveErr.Error(), source.Source)
			c.setSkillSourceError(target, source.SourceKey, message)
			if selectedKey != "" {
				return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: message}
			}
			if firstResolveError == nil {
				firstResolveError = &skillsCommandError{Code: rp.CodeInternal, Message: message}
			}
			continue
		}
		validation := newSkillSourceLock()
		validation.Sources = []skillSourceSnapshot{resolved}
		if err := validateSkillSourceLock(validation); err != nil {
			c.setSkillSourceError(target, source.SourceKey, err.Error())
			if selectedKey != "" {
				return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
			}
			if firstResolveError == nil {
				firstResolveError = &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
			}
			continue
		}
		c.setSkillSourceError(target, source.SourceKey, "")
		lock.Sources[index] = resolved
		resolvedByKey[skillSourceKeyMapKey(resolved.SourceKey)] = resolved
	}
	if selectedCount == 0 {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeNotFound, Message: "skill source not found"}
	}
	if len(resolvedByKey) == 0 && firstResolveError != nil {
		return skillsCommandResponse{}, firstResolveError
	}
	native := readNativeSkillSourceEntries(c.skillsLockFile(target))
	installed, installErr := c.installedSnapshotsForTarget(target, native)
	if installErr != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: installErr.Error()}
	}
	catalog := composeSkillSourceCatalog(lock, native, installed, c.SkillSourceErrors(target.scope, target.projectName))
	requested := map[string]struct{}{}
	for _, name := range payload.Skills {
		requested[strings.ToLower(name)] = struct{}{}
	}
	var selectedSkills []string
	var runs []skillsOperationRun
	var initialResults []skillsOperationItemResult
	var previewSource skillSourceSnapshot
	for _, source := range catalog.Sources {
		resolved, refreshed := resolvedByKey[skillSourceKeyMapKey(source.SourceKey)]
		if !refreshed {
			if selectedKey == "" {
				for _, row := range source.Skills {
					if row.Installed {
						initialResults = append(initialResults, skillsOperationItemResult{
							Skill: row.Name, Action: "update", Status: "skipped",
							ErrorSummary: "Source refresh failed: " + source.Error,
						})
					}
				}
			}
			continue
		}
		previewSource = resolved
		for _, row := range source.Skills {
			if !row.CanUpdate {
				if len(requested) == 0 {
					if result, include := skillUpdateNonActionResult(row); include {
						initialResults = append(initialResults, result)
					}
				}
				continue
			}
			if len(requested) > 0 {
				if _, exists := requested[strings.ToLower(row.Name)]; !exists {
					continue
				}
			}
			selectedSkills = append(selectedSkills, row.Name)
			runs = append(runs, skillsOperationRun{
				target: target, args: skillsAddArgs(target, skillSourceAddress(resolved), []string{row.Name}),
				skill: row.Name, action: "update", message: "Updated skills.", prepareInstallDirs: true,
			})
		}
	}
	if len(requested) > 0 && len(selectedSkills) != len(requested) {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeConflict, Message: "one or more requested skills are not eligible for update after refresh"}
	}
	sort.Slice(runs, func(i, j int) bool { return strings.ToLower(runs[i].skill) < strings.ToLower(runs[j].skill) })
	sort.Slice(selectedSkills, func(i, j int) bool { return strings.ToLower(selectedSkills[i]) < strings.ToLower(selectedSkills[j]) })
	sort.Slice(initialResults, func(i, j int) bool {
		return strings.ToLower(initialResults[i].Skill) < strings.ToLower(initialResults[j].Skill)
	})
	preview := skillsSourcePreview{
		Kind: "previewUpdate", Scope: target.scope, ProjectName: target.projectName,
		Skills: append([]string(nil), selectedSkills...), OverwritesLocal: len(selectedSkills) > 0,
		CreatedAt: c.now().Format(time.RFC3339),
	}
	if selectedCount == 1 {
		preview.Source = previewSource.Source
		preview.SourceKey = previewSource.SourceKey
		preview.ResolvedCommit = previewSource.ResolvedCommit
		preview.SkillList = append([]skillSourceSkillSnapshot(nil), previewSource.SkillList...)
	}
	stored := skillsStoredSourcePreview{
		preview: preview, target: target, lockPath: lockPath,
		expectedRevision: migration.Revision, updatedLock: lock, runs: runs, initialResults: initialResults,
	}
	if cmdErr := c.storeSourcePreview(&stored); cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	return skillsCommandResponse{
		OK: true, HubID: payload.HubID, UpdatedAt: preview.CreatedAt,
		Source: preview.Source, Scope: target.scope, ProjectName: target.projectName,
		Preview: cloneSkillsSourcePreview(&stored.preview),
	}, nil
}

func (c *SkillsCommand) previewDeleteSource(payload skillsCommandPayload) (skillsCommandResponse, *skillsCommandError) {
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	normalizedSource, sourceKey, err := normalizeSkillGitSource(payload.Source)
	if err != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeForbidden, Message: err.Error()}
	}
	lockPath := c.sourceLockFile(target)
	migration, err := readOrMigrateSkillSourceLock(c.skillsLockFile(target), lockPath)
	if err != nil {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	lock := migration.Lock
	found := false
	var source skillSourceSnapshot
	nextSources := make([]skillSourceSnapshot, 0, len(lock.Sources))
	for _, candidate := range lock.Sources {
		if skillSourceKeysEqual(candidate.SourceKey, sourceKey) {
			found = true
			source = candidate
			continue
		}
		nextSources = append(nextSources, candidate)
	}
	var skills []string
	for _, entry := range readNativeSkillSourceEntries(c.skillsLockFile(target)) {
		address := entry.SourceURL
		if address == "" {
			address = entry.Source
		}
		_, ownerKey, normalizeErr := normalizeSkillGitSource(address)
		if normalizeErr == nil && skillSourceKeysEqual(ownerKey, sourceKey) {
			skills = append(skills, entry.Name)
		}
	}
	if !found && len(skills) == 0 {
		return skillsCommandResponse{}, &skillsCommandError{Code: rp.CodeNotFound, Message: "skill source not found"}
	}
	if !found {
		source = skillSourceSnapshot{Source: normalizedSource, SourceKey: sourceKey, SkillList: []skillSourceSkillSnapshot{}}
	}
	lock.Sources = nextSources
	sort.Slice(skills, func(i, j int) bool { return strings.ToLower(skills[i]) < strings.ToLower(skills[j]) })
	runs := make([]skillsOperationRun, 0, len(skills))
	for _, skill := range skills {
		runs = append(runs, skillsOperationRun{
			target: target, skill: skill, action: "uninstall", message: "Uninstalled source skills.",
			removeSkillDirectories: true, removeSkills: []string{skill},
		})
	}
	preview := skillsSourcePreview{
		Kind: "previewDeleteSource", Scope: target.scope, ProjectName: target.projectName,
		Source: source.Source, SourceKey: source.SourceKey,
		ResolvedCommit: source.ResolvedCommit, SkillList: append([]skillSourceSkillSnapshot(nil), source.SkillList...),
		Skills: append([]string(nil), skills...), CreatedAt: c.now().Format(time.RFC3339),
	}
	stored := skillsStoredSourcePreview{
		preview: preview, target: target, lockPath: lockPath,
		expectedRevision: migration.Revision, updatedLock: lock, runs: runs, deleteSource: true,
	}
	if cmdErr := c.storeSourcePreview(&stored); cmdErr != nil {
		return skillsCommandResponse{}, cmdErr
	}
	return skillsCommandResponse{
		OK: true, HubID: payload.HubID, UpdatedAt: preview.CreatedAt,
		Source: source.Source, Scope: target.scope, ProjectName: target.projectName,
		Preview: cloneSkillsSourcePreview(&stored.preview),
	}, nil
}

func (c *SkillsCommand) installedSnapshotsForTarget(target skillsCommandTarget, native []nativeSkillSourceEntry) ([]skillSourceInstalledSnapshot, error) {
	directories, err := c.skillsInstallDirs(target)
	if err != nil {
		return nil, err
	}
	installedByName := map[string]*skillSourceInstalledSnapshot{}
	for _, entry := range native {
		if entry.Name == "" || validateSkillNames([]string{entry.Name}) != nil {
			continue
		}
		locations := make([]string, 0, len(directories))
		for _, directory := range directories {
			locations = append(locations, filepath.Join(directory, entry.Name, "SKILL.md"))
		}
		item := &skillSourceInstalledSnapshot{Name: entry.Name, Managed: true, Locations: locations}
		installedByName[strings.ToLower(entry.Name)] = item
	}
	for _, directory := range directories {
		entries, readErr := os.ReadDir(directory)
		if errors.Is(readErr, os.ErrNotExist) {
			continue
		}
		if readErr != nil {
			return nil, readErr
		}
		for _, entry := range entries {
			root := filepath.Join(directory, entry.Name())
			info, statErr := os.Stat(root)
			if statErr != nil || !info.IsDir() {
				continue
			}
			skillFile := filepath.Join(root, "SKILL.md")
			if info, statErr = os.Stat(skillFile); statErr != nil || info.IsDir() {
				continue
			}
			key := strings.ToLower(entry.Name())
			item := installedByName[key]
			if item == nil {
				item = &skillSourceInstalledSnapshot{Name: entry.Name()}
				installedByName[key] = item
			}
			if !item.Managed {
				item.Locations = append(item.Locations, skillFile)
			}
		}
	}
	keys := make([]string, 0, len(installedByName))
	for key := range installedByName {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	installed := make([]skillSourceInstalledSnapshot, 0, len(keys))
	for _, key := range keys {
		installed = append(installed, *installedByName[key])
	}
	return installed, nil
}

func (c *SkillsCommand) storeSourcePreview(stored *skillsStoredSourcePreview) *skillsCommandError {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation != nil && c.operation.Running {
		return &skillsCommandError{Code: rp.CodeConflict, Message: "skills operation already running"}
	}
	c.previewCounter++
	stored.preview.ID = fmt.Sprintf("skills-preview-%d", c.previewCounter)
	c.previews[stored.preview.ID] = *stored
	return nil
}

func (c *SkillsCommand) applySourcePreview(payload skillsCommandPayload) (any, *skillsCommandError) {
	if payload.PreviewID == "" {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "previewId is required"}
	}
	c.mu.RLock()
	stored, exists := c.previews[payload.PreviewID]
	c.mu.RUnlock()
	if !exists {
		return nil, &skillsCommandError{Code: rp.CodeNotFound, Message: "skills preview not found or expired"}
	}
	operationPayload := payload
	operationPayload.Action = stored.preview.Kind
	operationPayload.Scope = stored.target.scope
	operationPayload.ProjectName = stored.target.projectName
	operationPayload.Source = stored.preview.Source
	operationPayload.Skills = append([]string(nil), stored.preview.Skills...)
	operation, cmdErr := c.acceptOperation(operationPayload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	c.mu.Lock()
	delete(c.previews, payload.PreviewID)
	c.mu.Unlock()
	accepted := cloneSkillsOperation(operation)
	go c.runSkillsSourcePreviewOperation(operation, stored)
	return skillsCommandResponse{
		OK: true, Accepted: true, HubID: payload.HubID, UpdatedAt: operation.StartedAt,
		Source: stored.preview.Source, Scope: stored.target.scope, ProjectName: stored.target.projectName,
		Operation: accepted,
	}, nil
}

func (c *SkillsCommand) runSkillsSourcePreviewOperation(operation *skillsOperationSnapshot, stored skillsStoredSourcePreview) {
	if !stored.deleteSource {
		if _, err := writeSkillSourceLockFile(stored.lockPath, stored.expectedRevision, stored.updatedLock); err != nil {
			exitCode := -1
			c.finishOperation(operation, "failed", &exitCode, err.Error(), "")
			return
		}
	}
	failed := 0
	var lastExitCode *int
	for _, result := range stored.initialResults {
		c.appendSkillsOperationResult(operation, result)
	}
	for _, run := range stored.runs {
		if run.removeSkillDirectories {
			removeSkills := run.removeSkills
			if len(removeSkills) == 0 && run.skill != "" {
				removeSkills = []string{run.skill}
			}
			if err := c.removeSkillDirectories(run.target, removeSkills); err != nil {
				failed++
				code := -1
				lastExitCode = &code
				c.appendSkillsOperationResult(operation, skillsOperationItemResult{
					Skill: run.skill, Action: run.action, Status: "failed", ErrorSummary: err.Error(),
				})
				continue
			}
			c.appendSkillsOperationResult(operation, skillsOperationItemResult{
				Skill: run.skill, Action: run.action, Status: "succeeded",
			})
			continue
		}
		if run.prepareInstallDirs {
			if err := c.prepareSkillsInstallDirs(run.target); err != nil {
				failed++
				code := -1
				lastExitCode = &code
				c.appendSkillsOperationResult(operation, skillsOperationItemResult{
					Skill: run.skill, Action: run.action, Status: "failed", ErrorSummary: err.Error(),
				})
				continue
			}
		}
		result := c.runSkills(context.Background(), run.target.dir, run.args...)
		if skillsCommandFailed(result) {
			failed++
			code := result.ExitCode
			lastExitCode = &code
			c.appendSkillsOperationResult(operation, skillsOperationItemResult{
				Skill: run.skill, Action: run.action, Status: "failed", ErrorSummary: skillsResultSummary(result),
			})
			continue
		}
		c.appendSkillsOperationResult(operation, skillsOperationItemResult{
			Skill: run.skill, Action: run.action, Status: "succeeded",
		})
	}
	if stored.deleteSource && failed == 0 {
		if _, err := writeSkillSourceLockFile(stored.lockPath, stored.expectedRevision, stored.updatedLock); err != nil {
			exitCode := -1
			c.finishOperation(operation, "failed", &exitCode, err.Error(), "")
			return
		}
	}
	if failed > 0 {
		status := "partial"
		if failed == len(stored.runs) {
			status = "failed"
		}
		c.finishOperation(operation, status, lastExitCode, fmt.Sprintf("%d skill operation(s) failed", failed), "Skills operation completed with item failures.")
		return
	}
	c.finishOperation(operation, "succeeded", nil, "", "Skills operation completed.")
}

func skillUpdateNonActionResult(row SkillsSourceCatalogSkillSnapshot) (skillsOperationItemResult, bool) {
	result := skillsOperationItemResult{Skill: row.Name, Action: "update"}
	switch {
	case row.Conflict || row.Status == "conflict":
		result.Status = "conflict"
		result.ErrorSummary = row.Error
	case row.Status == "uninstalled":
		result.Status = "skipped"
		result.ErrorSummary = "Not installed; Update All does not install new skills."
	case row.Status == "removed_upstream":
		result.Status = "skipped"
		result.ErrorSummary = "Removed upstream; manual uninstall is required."
	case row.Status == "up_to_date":
		result.Status = "skipped"
		result.ErrorSummary = "Already up to date."
	case row.Status == "error":
		result.Status = "skipped"
		result.ErrorSummary = row.Error
	default:
		return skillsOperationItemResult{}, false
	}
	return result, true
}

func (c *SkillsCommand) appendSkillsOperationResult(operation *skillsOperationSnapshot, result skillsOperationItemResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation == operation {
		operation.Results = append(operation.Results, result)
	}
}

func (c *SkillsCommand) sourceLockFile(target skillsCommandTarget) string {
	return skillSourceLockPath(target.dir, c.globalLockFile(), c.homeDir)
}

func skillSourceAddress(source skillSourceSnapshot) string {
	return source.Source
}

func sanitizeSkillSourceError(message, source string) string {
	if source = strings.TrimSpace(source); source != "" {
		message = strings.ReplaceAll(message, source, "[skill source]")
	}
	message = skillSourceSecretPattern.ReplaceAllString(message, "$1=[redacted]")
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func cloneSkillsSourcePreview(preview *skillsSourcePreview) *skillsSourcePreview {
	if preview == nil {
		return nil
	}
	clone := *preview
	clone.SkillList = append([]skillSourceSkillSnapshot(nil), preview.SkillList...)
	clone.Skills = append([]string(nil), preview.Skills...)
	return &clone
}

func (c *SkillsCommand) startInstall(payload skillsCommandPayload) (any, *skillsCommandError) {
	if err := validateRemoteSkillSource(payload.Source); err != nil {
		return nil, err
	}
	if len(payload.Skills) == 0 {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skills are required"}
	}
	if err := validateSkillNames(payload.Skills); err != nil {
		return nil, err
	}
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	args := skillsAddArgs(target, payload.Source, payload.Skills)
	return c.startOperation(payload, []skillsOperationRun{{
		target:             target,
		args:               args,
		message:            "Installed skills.",
		prepareInstallDirs: true,
	}})
}

func (c *SkillsCommand) startUninstall(payload skillsCommandPayload) (any, *skillsCommandError) {
	if len(payload.Skills) == 0 {
		return nil, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skills are required"}
	}
	if err := validateSkillNames(payload.Skills); err != nil {
		return nil, err
	}
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	return c.startOperation(payload, []skillsOperationRun{{
		target: target, message: "Uninstalled skills.",
		removeSkillDirectories: true, removeSkills: append([]string(nil), payload.Skills...),
	}})
}

func (c *SkillsCommand) startUpdate(payload skillsCommandPayload) (any, *skillsCommandError) {
	if err := validateSkillNames(payload.Skills); err != nil {
		return nil, err
	}
	target, cmdErr := c.resolveTarget(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	runs, err := c.updateRuns(target, payload.Skills)
	if err != nil {
		return nil, err
	}
	return c.startOperation(payload, runs)
}

type skillsOperationRun struct {
	target                 skillsCommandTarget
	args                   []string
	skill                  string
	action                 string
	message                string
	prepareInstallDirs     bool
	removeSkillDirectories bool
	removeSkills           []string
}

func (c *SkillsCommand) startOperation(payload skillsCommandPayload, runs []skillsOperationRun) (any, *skillsCommandError) {
	operation, cmdErr := c.acceptOperation(payload)
	if cmdErr != nil {
		return nil, cmdErr
	}
	accepted := cloneSkillsOperation(operation)
	go c.runSkillsOperation(operation, runs)
	return skillsCommandResponse{
		OK:          true,
		Accepted:    true,
		HubID:       payload.HubID,
		UpdatedAt:   operation.StartedAt,
		Source:      payload.Source,
		Scope:       payload.Scope,
		ProjectName: payload.ProjectName,
		Operation:   accepted,
	}, nil
}

func (c *SkillsCommand) acceptOperation(payload skillsCommandPayload) (*skillsOperationSnapshot, *skillsCommandError) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation != nil && c.operation.Running {
		return nil, &skillsCommandError{Code: rp.CodeConflict, Message: "skills operation already running"}
	}
	c.operationCounter++
	operation := &skillsOperationSnapshot{
		ID:          fmt.Sprintf("skills-operation-%d", c.operationCounter),
		Running:     true,
		Action:      payload.Action,
		Scope:       payload.Scope,
		ProjectName: payload.ProjectName,
		Source:      payload.Source,
		Skills:      append([]string(nil), payload.Skills...),
		Status:      "running",
		StartedAt:   c.now().Format(time.RFC3339),
	}
	c.operation = operation
	return operation, nil
}

func (c *SkillsCommand) runSkillsOperation(operation *skillsOperationSnapshot, runs []skillsOperationRun) {
	messages := make([]string, 0, len(runs))
	for _, run := range runs {
		if run.removeSkillDirectories {
			removeSkills := run.removeSkills
			if len(removeSkills) == 0 && run.skill != "" {
				removeSkills = []string{run.skill}
			}
			if err := c.removeSkillDirectories(run.target, removeSkills); err != nil {
				exitCode := -1
				c.finishOperation(operation, "failed", &exitCode, err.Error(), "")
				return
			}
			if run.message != "" {
				messages = append(messages, run.message)
			}
			continue
		}
		if run.prepareInstallDirs {
			if err := c.prepareSkillsInstallDirs(run.target); err != nil {
				exitCode := -1
				c.finishOperation(operation, "failed", &exitCode, err.Error(), "")
				return
			}
		}
		result := c.runSkills(context.Background(), run.target.dir, run.args...)
		exitCode := result.ExitCode
		if skillsCommandFailed(result) {
			c.finishOperation(operation, "failed", &exitCode, skillsResultSummary(result), "")
			return
		}
		if run.message != "" {
			messages = append(messages, run.message)
		}
	}
	message := "Skills operation completed."
	if len(messages) > 0 {
		message = messages[0]
	}
	c.finishOperation(operation, "succeeded", nil, "", message)
}

func (c *SkillsCommand) finishOperation(operation *skillsOperationSnapshot, status string, exitCode *int, errorSummary string, message string) {
	c.mu.Lock()
	if c.operation != operation {
		c.mu.Unlock()
		return
	}
	operation.Running = false
	operation.Status = status
	operation.FinishedAt = c.now().Format(time.RFC3339)
	if exitCode != nil {
		code := *exitCode
		operation.ExitCode = &code
	}
	operation.ErrorSummary = errorSummary
	operation.Message = message
	scope := operation.Scope
	projectName := operation.ProjectName
	done := c.onOperationDone
	c.mu.Unlock()

	if done != nil {
		done(scope, projectName, *cloneSkillsOperation(operation))
	}
}

func (c *SkillsCommand) currentOperationSnapshot() *skillsOperationSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return cloneSkillsOperation(c.operation)
}

func cloneSkillsOperation(operation *skillsOperationSnapshot) *skillsOperationSnapshot {
	if operation == nil {
		return nil
	}
	clone := *operation
	clone.Skills = append([]string(nil), operation.Skills...)
	clone.Results = append([]skillsOperationItemResult(nil), operation.Results...)
	if operation.ExitCode != nil {
		code := *operation.ExitCode
		clone.ExitCode = &code
	}
	return &clone
}

func skillsAddArgs(target skillsCommandTarget, source string, skills []string) []string {
	args := []string{"add", source}
	if target.scope == "hub" {
		args = append(args, "-g")
	}
	args = append(args, "--agent")
	args = append(args, fixedSkillAgents...)
	args = append(args, "--skill")
	args = append(args, skills...)
	if target.scope == "project" {
		args = append(args, "--copy")
	}
	return append(args, "-y")
}

func (c *SkillsCommand) updateRuns(target skillsCommandTarget, requestedSkills []string) ([]skillsOperationRun, *skillsCommandError) {
	lockPath := c.skillsLockFile(target)
	groups := readSkillsLockInstallGroups(lockPath)
	if len(requestedSkills) > 0 {
		filtered := make([]skillsLockInstallGroup, 0, len(groups))
		for _, group := range groups {
			group.Skills = filterRequestedSkills(group.Skills, requestedSkills)
			if len(group.Skills) > 0 {
				filtered = append(filtered, group)
			}
		}
		groups = filtered
	}
	if len(groups) == 0 {
		return []skillsOperationRun{{
			target:             target,
			args:               fallbackSkillsUpdateArgs(target, requestedSkills),
			message:            "Updated skills.",
			prepareInstallDirs: target.scope == "hub",
		}}, nil
	}
	runs := make([]skillsOperationRun, 0, len(groups))
	for _, group := range groups {
		runs = append(runs, skillsOperationRun{
			target:             target,
			args:               skillsAddArgs(target, group.Source, group.Skills),
			message:            "Updated skills.",
			prepareInstallDirs: target.scope == "hub",
		})
	}
	return runs, nil
}

func fallbackSkillsUpdateArgs(target skillsCommandTarget, skills []string) []string {
	args := append([]string{"update"}, skills...)
	if target.scope == "hub" {
		args = append(args, "-g")
	} else {
		args = append(args, "-p")
	}
	return append(args, "-y")
}

func filterRequestedSkills(skills []string, requested []string) []string {
	out := make([]string, 0, len(skills))
	for _, skill := range skills {
		for _, candidate := range requested {
			if strings.EqualFold(skill, candidate) {
				out = append(out, skill)
				break
			}
		}
	}
	return out
}

func (c *SkillsCommand) prepareSkillsInstallDirs(target skillsCommandTarget) error {
	dirs, err := c.skillsInstallDirs(target)
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("prepare skills directory %s: %w", dir, err)
		}
	}
	return nil
}

func (c *SkillsCommand) removeSkillDirectories(target skillsCommandTarget, skills []string) error {
	if len(skills) == 0 {
		return fmt.Errorf("skills are required")
	}
	if err := validateSkillNames(skills); err != nil {
		return err
	}
	dirs, err := c.skillsInstallDirs(target)
	if err != nil {
		return err
	}
	for _, directory := range dirs {
		root, err := filepath.Abs(directory)
		if err != nil {
			return fmt.Errorf("resolve skills directory %s: %w", directory, err)
		}
		for _, skill := range skills {
			path := filepath.Join(root, skill)
			relative, err := filepath.Rel(root, path)
			if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
				return fmt.Errorf("skill path escapes skills directory: %s", skill)
			}
			if err := os.RemoveAll(path); err != nil {
				return fmt.Errorf("remove skill directory %s: %w", path, err)
			}
		}
	}
	return removeNativeSkillLockEntries(c.skillsLockFile(target), skills)
}

func removeNativeSkillLockEntries(path string, names []string) error {
	path = strings.TrimSpace(path)
	if path == "" || len(names) == 0 {
		return nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read native skill lock: %w", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		return fmt.Errorf("decode native skill lock: %w", err)
	}
	skillsRaw, exists := document["skills"]
	if !exists {
		return nil
	}
	var skills map[string]json.RawMessage
	if err := json.Unmarshal(skillsRaw, &skills); err != nil {
		return fmt.Errorf("decode native skill lock skills: %w", err)
	}
	wanted := make(map[string]struct{}, len(names))
	for _, name := range names {
		wanted[strings.ToLower(name)] = struct{}{}
	}
	changed := false
	for name := range skills {
		if _, remove := wanted[strings.ToLower(name)]; remove {
			delete(skills, name)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	updatedSkills, err := json.Marshal(skills)
	if err != nil {
		return fmt.Errorf("encode native skill lock skills: %w", err)
	}
	document["skills"] = updatedSkills
	updated, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode native skill lock: %w", err)
	}
	updated = append(updated, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create native skill lock directory: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".skills-lock-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary native skill lock: %w", err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("secure temporary native skill lock: %w", err)
	}
	if _, err := temporary.Write(updated); err != nil {
		return fmt.Errorf("write temporary native skill lock: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("flush temporary native skill lock: %w", err)
	}
	if err := temporary.Close(); err != nil {
		closed = true
		return fmt.Errorf("close temporary native skill lock: %w", err)
	}
	closed = true
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace native skill lock: %w", err)
	}
	return nil
}

func (c *SkillsCommand) skillsInstallDirs(target skillsCommandTarget) ([]string, error) {
	var directories []string
	switch target.scope {
	case "hub":
		home, err := c.skillsHomeDir()
		if err != nil {
			return nil, err
		}
		directories = []string{
			filepath.Join(home, ".agents", "skills"),
			filepath.Join(home, ".claude", "skills"),
		}
	case "project":
		if strings.TrimSpace(target.dir) == "" {
			return nil, fmt.Errorf("project path is empty")
		}
		info, err := os.Stat(target.dir)
		if err != nil {
			return nil, fmt.Errorf("stat project path %s: %w", target.dir, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("project path is not a directory: %s", target.dir)
		}
		directories = []string{
			filepath.Join(target.dir, ".agents", "skills"),
			filepath.Join(target.dir, ".claude", "skills"),
		}
	default:
		return nil, fmt.Errorf("unsupported skills scope: %s", target.scope)
	}
	return directories, nil
}

func (c *SkillsCommand) skillsLockFile(target skillsCommandTarget) string {
	if target.scope == "hub" {
		return c.globalLockFile()
	}
	if strings.TrimSpace(target.dir) == "" {
		return ""
	}
	return filepath.Join(target.dir, "skills-lock.json")
}

func (c *SkillsCommand) skillsHomeDir() (string, error) {
	if c.homeDir != "" {
		return filepath.Abs(c.homeDir)
	}
	return os.UserHomeDir()
}

type skillsCommandTarget struct {
	scope       string
	projectName string
	project     ProjectInfo
	dir         string
}

func (c *SkillsCommand) resolveTarget(payload skillsCommandPayload) (skillsCommandTarget, *skillsCommandError) {
	scope := strings.TrimSpace(payload.Scope)
	if scope != "hub" && scope != "project" {
		return skillsCommandTarget{}, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "scope must be hub or project"}
	}
	if scope == "hub" {
		return skillsCommandTarget{scope: "hub"}, nil
	}
	if payload.ProjectName == "" {
		return skillsCommandTarget{}, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "projectName is required"}
	}
	project, ok := c.findProject(payload.HubID, payload.ProjectName)
	if !ok {
		return skillsCommandTarget{}, &skillsCommandError{Code: rp.CodeNotFound, Message: "project not found"}
	}
	dir := strings.TrimSpace(project.Path)
	if dir == "" {
		return skillsCommandTarget{}, &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "project path is empty"}
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return skillsCommandTarget{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return skillsCommandTarget{scope: "project", projectName: strings.TrimSpace(project.Name), project: project, dir: abs}, nil
}

func (c *SkillsCommand) scanHubSkills(ctx context.Context) ([]skillsSkillSnapshot, string) {
	lockMetadata := readSkillsLockScanMetadata(c.globalLockFile())
	result := c.runSkills(ctx, "", "list", "-g", "--json")
	if skillsCommandFailed(result) {
		return []skillsSkillSnapshot{}, skillsResultSummary(result)
	}
	skills, err := parseSkillsListJSON(result.Stdout, lockMetadata.PluginNames, lockMetadata.Managed)
	if err != nil {
		return []skillsSkillSnapshot{}, err.Error()
	}
	return skills, ""
}

func (c *SkillsCommand) scanProjectSkills(ctx context.Context, project ProjectInfo) ([]skillsSkillSnapshot, string) {
	dir := strings.TrimSpace(project.Path)
	if dir == "" {
		return []skillsSkillSnapshot{}, "project path is empty"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return []skillsSkillSnapshot{}, err.Error()
	}
	lockMetadata := readSkillsLockScanMetadata(filepath.Join(abs, "skills-lock.json"))
	result := c.runSkills(ctx, abs, "list", "--json")
	if skillsCommandFailed(result) {
		return []skillsSkillSnapshot{}, skillsResultSummary(result)
	}
	skills, err := parseSkillsListJSON(result.Stdout, lockMetadata.PluginNames, lockMetadata.Managed)
	if err != nil {
		return []skillsSkillSnapshot{}, err.Error()
	}
	return skills, ""
}

func (c *SkillsCommand) discoverSkillForDetail(
	ctx context.Context,
	target skillsCommandTarget,
	skillName string,
) (skillsSkillSnapshot, *skillsCommandError) {
	providers, cwd, scope := c.detailDiscoveryTarget(target)
	discovered, err := agent.ListSkillsForProviders(ctx, providers, cwd, scope)
	if err != nil {
		return skillsSkillSnapshot{}, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	var selected *agent.ProviderSkillDescriptor
	var visibleAgents []string
	for index := range discovered {
		candidate := &discovered[index]
		if !strings.EqualFold(candidate.Skill.Name, skillName) {
			continue
		}
		visibleAgents = appendUniqueFoldStrings(visibleAgents, candidate.Provider...)
		if selected == nil || skillDetailLocationPriority(candidate.Locations) < skillDetailLocationPriority(selected.Locations) {
			selected = candidate
		}
	}
	if selected == nil {
		return skillsSkillSnapshot{}, &skillsCommandError{Code: rp.CodeNotFound, Message: "skill not found"}
	}
	lockMetadata := readSkillsLockScanMetadata(c.skillsLockFile(target))
	pluginName := lockMetadata.PluginNames[selected.Skill.Name]
	categoryKey, category := skillCategory(pluginName)
	return skillsSkillSnapshot{
		Name:        selected.Skill.Name,
		Path:        selected.Skill.Path,
		Category:    category,
		CategoryKey: categoryKey,
		Managed:     lockMetadata.Managed[selected.Skill.Name],
		Agents:      visibleAgents,
	}, nil
}

func (c *SkillsCommand) detailDiscoveryTarget(target skillsCommandTarget) ([]string, string, agent.SkillScanScope) {
	if target.scope == "project" {
		return append([]string(nil), target.project.Agents...), target.dir, agent.SkillScanScopeProject
	}
	var providers []string
	for _, project := range c.projectSnapshot() {
		providers = appendUniqueFoldStrings(providers, project.Agents...)
	}
	return providers, "", agent.SkillScanScopeUser
}

func appendUniqueFoldStrings(values []string, candidates ...string) []string {
	for _, candidate := range candidates {
		found := false
		for _, value := range values {
			if strings.EqualFold(value, candidate) {
				found = true
				break
			}
		}
		if !found {
			values = append(values, candidate)
		}
	}
	return values
}

func skillDetailLocationPriority(locations []string) int {
	priority := 5
	for _, location := range locations {
		switch strings.ToLower(location) {
		case "agents":
			return 0
		case "claude":
			if priority > 1 {
				priority = 1
			}
		case "codebuddy":
			if priority > 2 {
				priority = 2
			}
		case "mimo":
			if priority > 3 {
				priority = 3
			}
		case "qoder":
			if priority > 4 {
				priority = 4
			}
		}
	}
	return priority
}

func (c *SkillsCommand) skillDetailFromSnapshot(target skillsCommandTarget, skill skillsSkillSnapshot) (*skillsSkillDetailSnapshot, *skillsCommandError) {
	root, cmdErr := skillRootFromPath(skill.Path)
	if cmdErr != nil {
		return nil, cmdErr
	}
	markdown, cmdErr := readSkillMarkdown(root)
	if cmdErr != nil {
		return nil, cmdErr
	}
	supportingFiles, cmdErr := listSkillSupportingFiles(root)
	if cmdErr != nil {
		return nil, cmdErr
	}
	lockMetadata := readSkillsLockScanMetadata(c.skillsLockFile(target))
	lockDetail := lockMetadata.Details[skill.Name]
	category := skill.Category
	categoryKey := skill.CategoryKey
	if lockDetail.PluginName != "" {
		categoryKey, category = skillCategory(lockDetail.PluginName)
	}
	if category == "" || categoryKey == "" {
		categoryKey, category = skillCategory("")
	}
	return &skillsSkillDetailSnapshot{
		Name:            skill.Name,
		Scope:           target.scope,
		ProjectName:     target.projectName,
		Path:            skill.Path,
		Category:        category,
		CategoryKey:     categoryKey,
		Managed:         skill.Managed,
		Agents:          append([]string(nil), skill.Agents...),
		Source:          lockDetail.Source,
		SourceURL:       lockDetail.SourceURL,
		SourceType:      lockDetail.SourceType,
		SkillPath:       lockDetail.SkillPath,
		PluginName:      lockDetail.PluginName,
		InstalledAt:     lockDetail.InstalledAt,
		UpdatedAt:       lockDetail.UpdatedAt,
		SkillMarkdown:   markdown,
		SupportingFiles: supportingFiles,
	}, nil
}

func skillRootFromPath(path string) (string, *skillsCommandError) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill path is empty"}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	if strings.EqualFold(filepath.Base(abs), "SKILL.md") {
		abs = filepath.Dir(abs)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", &skillsCommandError{Code: rp.CodeNotFound, Message: "skill path not found"}
	}
	if !info.IsDir() {
		return "", &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill path is not a directory"}
	}
	return abs, nil
}

func readSkillMarkdown(root string) (string, *skillsCommandError) {
	skillFile := filepath.Join(root, "SKILL.md")
	realRoot, realFile, cmdErr := containedRealPaths(root, skillFile)
	if cmdErr != nil {
		return "", cmdErr
	}
	if _, ok := safeSkillRelativePath(realRoot, realFile); !ok {
		return "", &skillsCommandError{Code: rp.CodeForbidden, Message: "skill file resolves outside skill directory"}
	}
	info, err := os.Stat(realFile)
	if err != nil {
		return "", &skillsCommandError{Code: rp.CodeNotFound, Message: "SKILL.md not found"}
	}
	if info.IsDir() {
		return "", &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "SKILL.md is a directory"}
	}
	raw, err := os.ReadFile(realFile)
	if err != nil {
		return "", &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return string(raw), nil
}

func listSkillSupportingFiles(root string) ([]skillsSupportingFile, *skillsCommandError) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	files := []skillsSupportingFile{}
	err = filepath.WalkDir(absRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == absRoot {
			return nil
		}
		rel, ok := safeSkillRelativePath(absRoot, path)
		if !ok {
			return fmt.Errorf("supporting file resolves outside skill directory")
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if rel == "SKILL.md" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files = append(files, skillsSupportingFile{
			RelativePath: rel,
			Size:         info.Size(),
		})
		return nil
	})
	if err != nil {
		return nil, &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return files, nil
}

func containedRealPaths(root string, path string) (string, string, *skillsCommandError) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", "", &skillsCommandError{Code: rp.CodeNotFound, Message: "skill path not found"}
	}
	realFile, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", "", &skillsCommandError{Code: rp.CodeNotFound, Message: "SKILL.md not found"}
	}
	realRoot, err = filepath.Abs(realRoot)
	if err != nil {
		return "", "", &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	realFile, err = filepath.Abs(realFile)
	if err != nil {
		return "", "", &skillsCommandError{Code: rp.CodeInternal, Message: err.Error()}
	}
	return realRoot, realFile, nil
}

func safeSkillRelativePath(root string, path string) (string, bool) {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}

func (c *SkillsCommand) runSkills(ctx context.Context, dir string, args ...string) skillsCommandResult {
	_ = ctx
	_ = dir
	_ = args
	return skillsCommandResult{
		Stderr:   "legacy Skills CLI actions are no longer supported",
		ExitCode: 1,
		Err:      errors.New("legacy Skills CLI actions are no longer supported"),
	}
}

func (c *SkillsCommand) projectSnapshot() []ProjectInfo {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return append([]ProjectInfo(nil), c.projects...)
}

func (c *SkillsCommand) findProject(hubID string, nameOrID string) (ProjectInfo, bool) {
	nameOrID = strings.TrimSpace(nameOrID)
	for _, project := range c.projectSnapshot() {
		projectName := strings.TrimSpace(project.Name)
		if projectName == nameOrID || rp.ProjectID(hubID, projectName) == nameOrID {
			return project, true
		}
	}
	return ProjectInfo{}, false
}

func (c *SkillsCommand) globalLockFile() string {
	if strings.TrimSpace(c.globalLockPath) != "" {
		return c.globalLockPath
	}
	if homeDir := strings.TrimSpace(c.homeDir); homeDir != "" {
		return filepath.Join(homeDir, ".agents", ".skill-lock.json")
	}
	if stateHome := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); stateHome != "" {
		return filepath.Join(stateHome, "skills", ".skill-lock.json")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".agents", ".skill-lock.json")
	}
	return ""
}

func parseSkillsListJSON(raw string, pluginNames map[string]string, managed map[string]bool) ([]skillsSkillSnapshot, error) {
	var items []struct {
		Name       string   `json:"name"`
		Path       string   `json:"path"`
		Scope      string   `json:"scope"`
		Agents     []string `json:"agents"`
		PluginName string   `json:"pluginName"`
	}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		var wrapped struct {
			Skills []struct {
				Name       string   `json:"name"`
				Path       string   `json:"path"`
				Scope      string   `json:"scope"`
				Agents     []string `json:"agents"`
				PluginName string   `json:"pluginName"`
			} `json:"skills"`
		}
		if wrappedErr := json.Unmarshal([]byte(raw), &wrapped); wrappedErr != nil {
			return nil, fmt.Errorf("invalid skills list json: %w", err)
		}
		for _, item := range wrapped.Skills {
			items = append(items, struct {
				Name       string   `json:"name"`
				Path       string   `json:"path"`
				Scope      string   `json:"scope"`
				Agents     []string `json:"agents"`
				PluginName string   `json:"pluginName"`
			}(item))
		}
	}
	out := make([]skillsSkillSnapshot, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		pluginName := strings.TrimSpace(item.PluginName)
		if pluginName == "" {
			pluginName = pluginNames[name]
		}
		categoryKey, category := skillCategory(pluginName)
		out = append(out, skillsSkillSnapshot{
			Name:        name,
			Path:        strings.TrimSpace(item.Path),
			Category:    category,
			CategoryKey: categoryKey,
			Managed:     managed[name],
			Agents:      append([]string(nil), item.Agents...),
		})
	}
	return out, nil
}

type skillsLockScanMetadata struct {
	PluginNames map[string]string
	Managed     map[string]bool
	Details     map[string]skillsLockDetailMetadata
}

type skillsLockDetailMetadata struct {
	Source      string
	SourceURL   string
	SourceType  string
	SkillPath   string
	PluginName  string
	InstalledAt string
	UpdatedAt   string
}

func readSkillsLockScanMetadata(path string) skillsLockScanMetadata {
	out := skillsLockScanMetadata{
		PluginNames: map[string]string{},
		Managed:     map[string]bool{},
		Details:     map[string]skillsLockDetailMetadata{},
	}
	if strings.TrimSpace(path) == "" {
		return out
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var body struct {
		Skills map[string]struct {
			Source      string `json:"source"`
			SourceURL   string `json:"sourceUrl"`
			SourceType  string `json:"sourceType"`
			SkillPath   string `json:"skillPath"`
			PluginName  string `json:"pluginName"`
			InstalledAt string `json:"installedAt"`
			UpdatedAt   string `json:"updatedAt"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return out
	}
	for name, skill := range body.Skills {
		skillName := strings.TrimSpace(name)
		if skillName == "" {
			continue
		}
		out.Managed[skillName] = true
		pluginName := strings.TrimSpace(skill.PluginName)
		if pluginName != "" {
			out.PluginNames[skillName] = pluginName
		}
		out.Details[skillName] = skillsLockDetailMetadata{
			Source:      strings.TrimSpace(skill.Source),
			SourceURL:   strings.TrimSpace(skill.SourceURL),
			SourceType:  strings.TrimSpace(skill.SourceType),
			SkillPath:   strings.TrimSpace(skill.SkillPath),
			PluginName:  pluginName,
			InstalledAt: strings.TrimSpace(skill.InstalledAt),
			UpdatedAt:   strings.TrimSpace(skill.UpdatedAt),
		}
	}
	return out
}

type skillsLockInstallGroup struct {
	Source string
	Skills []string
}

func readSkillsLockInstallGroups(path string) []skillsLockInstallGroup {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var body struct {
		Skills map[string]struct {
			Source     string `json:"source"`
			SourceURL  string `json:"sourceUrl"`
			SourceType string `json:"sourceType"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil
	}
	names := make([]string, 0, len(body.Skills))
	for name := range body.Skills {
		names = append(names, name)
	}
	sort.Strings(names)

	grouped := map[string][]string{}
	var sources []string
	for _, name := range names {
		skillName := strings.TrimSpace(name)
		if skillName == "" {
			continue
		}
		entry := body.Skills[name]
		sourceType := strings.ToLower(strings.TrimSpace(entry.SourceType))
		if sourceType == "local" || sourceType == "node_modules" {
			continue
		}
		source := strings.TrimSpace(entry.Source)
		if source == "" {
			source = strings.TrimSpace(entry.SourceURL)
		}
		if source == "" {
			continue
		}
		if _, ok := grouped[source]; !ok {
			sources = append(sources, source)
		}
		grouped[source] = append(grouped[source], skillName)
	}
	sort.Strings(sources)

	groups := make([]skillsLockInstallGroup, 0, len(sources))
	for _, source := range sources {
		groups = append(groups, skillsLockInstallGroup{
			Source: source,
			Skills: grouped[source],
		})
	}
	return groups
}

func parseSkillsSourceCandidates(raw string) []skillsSourceCandidate {
	currentCategoryKey, currentCategory := skillCategory("")
	var candidates []skillsSourceCandidate
	var current *skillsSourceCandidate
	for _, rawLine := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		line := cleanSkillsOutputLine(rawLine)
		if line == "" {
			current = nil
			continue
		}
		if shouldSkipSkillsOutputLine(line) {
			continue
		}
		if name, desc, ok := parseSkillsCandidateLine(line); ok {
			categoryKey := currentCategoryKey
			category := currentCategory
			candidates = append(candidates, skillsSourceCandidate{
				Name:        name,
				Description: desc,
				Category:    category,
				CategoryKey: categoryKey,
			})
			current = &candidates[len(candidates)-1]
			continue
		}
		if current != nil {
			if current.Description == "" {
				current.Description = line
			} else {
				current.Description += " " + line
			}
			continue
		}
		currentCategoryKey = categoryKeyFromTitle(line)
		currentCategory = line
	}
	return candidates
}

func cleanSkillsOutputLine(line string) string {
	line = ansiEscapePattern.ReplaceAllString(line, "")
	line = strings.TrimSpace(strings.ReplaceAll(line, "\r", ""))
	for index, r := range line {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '@' || r == '_' || r == '-' || r == '.' || r == ':' {
			return strings.TrimSpace(line[index:])
		}
	}
	return ""
}

func shouldSkipSkillsOutputLine(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	if lower == "" {
		return true
	}
	switch lower {
	case "available skills", "global skills", "project skills", "skills":
		return true
	}
	return strings.HasPrefix(lower, "source:") ||
		strings.HasPrefix(lower, "fetching ") ||
		strings.HasPrefix(lower, "cloning ") ||
		strings.HasPrefix(lower, "found ") ||
		strings.HasPrefix(lower, "use --skill") ||
		strings.HasPrefix(lower, "run ")
}

func parseSkillsCandidateLine(line string) (string, string, bool) {
	for _, separator := range []string{" - ", ": "} {
		index := strings.Index(line, separator)
		if index <= 0 {
			continue
		}
		name := strings.TrimSpace(line[:index])
		if skillNamePattern.MatchString(name) {
			return name, strings.TrimSpace(line[index+len(separator):]), true
		}
	}
	if skillNamePattern.MatchString(line) {
		return line, "", true
	}
	return "", "", false
}

func skillCategory(pluginName string) (string, string) {
	key := strings.TrimSpace(pluginName)
	if key == "" {
		return "general", "General"
	}
	return key, categoryTitleFromKey(key)
}

func categoryKeyFromTitle(title string) string {
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(title)))
	if len(parts) == 0 {
		return "general"
	}
	for i, part := range parts {
		parts[i] = strings.Trim(part, "_-")
	}
	return strings.Join(parts, "-")
}

func categoryTitleFromKey(key string) string {
	parts := strings.FieldsFunc(strings.TrimSpace(key), func(r rune) bool {
		return r == '-' || r == '_' || unicode.IsSpace(r)
	})
	if len(parts) == 0 {
		return "General"
	}
	for i, part := range parts {
		part = strings.ToLower(part)
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func validateSkillSourceHasNoExplicitRef(source string) *skillsCommandError {
	if strings.Contains(source, "#") {
		return &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill source refs are unsupported; use the repository default branch"}
	}
	parsed, err := url.Parse(source)
	if err == nil && (strings.EqualFold(parsed.Hostname(), "github.com") || strings.EqualFold(parsed.Hostname(), "www.github.com")) {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) >= 4 && strings.EqualFold(parts[2], "tree") {
			return &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "GitHub tree URLs with refs are unsupported; use the repository URL"}
		}
	}
	return nil
}

func validateRemoteSkillSource(source string) *skillsCommandError {
	source = strings.TrimSpace(source)
	if source == "" {
		return &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "source is required"}
	}
	lower := strings.ToLower(source)
	if strings.Contains(source, `\`) || strings.Contains(source, "..") ||
		strings.HasPrefix(source, "/") || regexp.MustCompile(`^[A-Za-z]:`).MatchString(source) ||
		strings.HasPrefix(lower, "git@") || strings.HasPrefix(lower, "ssh://") || strings.HasPrefix(lower, "file://") {
		return &skillsCommandError{Code: rp.CodeForbidden, Message: "source is not an allowed remote skill source"}
	}
	if skillSourceRepoPattern.MatchString(source) {
		parts := strings.Split(source, "/")
		if skillSourceSlugPattern.MatchString(parts[0]) && skillSourceSlugPattern.MatchString(parts[1]) {
			return nil
		}
	}
	parsed, err := url.Parse(source)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return &skillsCommandError{Code: rp.CodeForbidden, Message: "source is not an allowed remote skill source"}
	}
	host := strings.ToLower(parsed.Host)
	if host == "github.com" || host == "www.github.com" {
		path := strings.Trim(strings.TrimSuffix(parsed.EscapedPath(), ".git"), "/")
		parts := strings.Split(path, "/")
		if len(parts) == 2 && skillSourceSlugPattern.MatchString(parts[0]) && skillSourceSlugPattern.MatchString(parts[1]) {
			return nil
		}
	}
	if strings.Contains(parsed.EscapedPath(), "/.well-known/agent-skills") || strings.Contains(parsed.EscapedPath(), "/.well-known/skills") {
		return nil
	}
	return &skillsCommandError{Code: rp.CodeForbidden, Message: "source is not an allowed remote skill source"}
}

func normalizeSkillNames(skills []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(skills))
	for _, skill := range skills {
		name := strings.TrimSpace(skill)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func validateSkillNames(skills []string) *skillsCommandError {
	for _, skill := range skills {
		if !skillNamePattern.MatchString(skill) {
			return &skillsCommandError{Code: rp.CodeInvalidArgument, Message: "skill name is invalid"}
		}
	}
	return nil
}

func skillsCommandFailed(result skillsCommandResult) bool {
	return result.Err != nil || result.ExitCode != 0
}

func skillsCommandUnavailable(result skillsCommandResult) bool {
	if result.Err == nil {
		return false
	}
	if errors.Is(result.Err, exec.ErrNotFound) {
		return true
	}
	lower := strings.ToLower(result.Err.Error())
	return strings.Contains(lower, "executable file not found") ||
		strings.Contains(lower, "file not found") ||
		strings.Contains(lower, "not found in %path%")
}

func skillsResultSummary(result skillsCommandResult) string {
	segment := lastNonEmptySegment(result.Stderr)
	if segment == "" {
		segment = lastNonEmptySegment(result.Stdout)
	}
	if segment == "" {
		if result.Err != nil {
			return fmt.Sprintf("skills command failed with exit code %d: %s", result.ExitCode, truncateRunes(result.Err.Error(), 500))
		}
		return fmt.Sprintf("skills command failed with exit code %d", result.ExitCode)
	}
	return fmt.Sprintf("exit code %d: %s", result.ExitCode, truncateRunes(segment, 500))
}
