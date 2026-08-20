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
	"strings"
	"sync"
	"time"
	"unicode"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

var (
	skillSourceRepoPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
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
	// GlobalLockPath is retained for callers compiled against the pre-2.0
	// adapter. Native skills lock files are ignored by SkillsCommand.
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
	homeDir         string
	onOperationDone func(scope, projectName string, operation SkillsOperationSnapshot)
	resolveSource   func(context.Context, skillSourceSnapshot) (skillSourceSnapshot, error)
	store           *skillSourceStore

	mu               sync.RWMutex
	projects         []ProjectInfo
	operation        *skillsOperationSnapshot
	sourceErrors     map[string]map[string]string
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
		homeDir:         strings.TrimSpace(config.HomeDir),
		store:           newSkillSourceStore(config.HomeDir),
		onOperationDone: config.OnOperationDone,
		resolveSource:   config.ResolveSource,
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
	// Candidates and Preview are retained only for response compatibility with
	// clients that may still decode historical 1.x responses. The 2.0 command
	// surface does not produce either field.
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

// skillsSourceCandidate and skillsSourcePreview are legacy wire shapes kept
// so old callers can continue to decode a response while the corresponding
// preview/list actions remain removed from the 2.0 implementation.
type skillsSourceCandidate struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category"`
	CategoryKey string `json:"categoryKey"`
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

func (c *SkillsCommand) appendSkillsOperationResult(operation *skillsOperationSnapshot, result skillsOperationItemResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation == operation {
		operation.Results = append(operation.Results, result)
	}
}

func (c *SkillsCommand) sourceLockFile(target skillsCommandTarget) string {
	return skillSourceLockPath(target.dir, c.homeDir)
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
