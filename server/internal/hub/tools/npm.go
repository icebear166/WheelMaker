package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/shared"
)

type npmCommandCall struct {
	Name string
	Args []string
}

type npmCommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

type npmCommandRunner interface {
	Run(ctx context.Context, name string, args ...string) npmCommandResult
}

type execNPMCommandRunner struct{}

func (execNPMCommandRunner) Run(ctx context.Context, name string, args ...string) npmCommandResult {
	cmd := exec.CommandContext(ctx, name, args...)
	shared.ConfigureBackgroundCommand(cmd)
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
	return npmCommandResult{
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
		Err:      err,
	}
}

type NPMCommand struct {
	runner       npmCommandRunner
	now          func() time.Time
	lookPath     func(string) (string, error)
	flickerProbe func(context.Context) bool
	flickerOnce  sync.Once
	flickerReady bool

	mu            sync.Mutex
	operation     *npmOperationSnapshot
	latestCache   map[string]npmLatestCacheEntry
	operationDone func()
}

func NewNPMCommand() *NPMCommand {
	return newNPMCommandWithRunnerAndProbe(execNPMCommandRunner{}, probeMyFlickerRegistry)
}

func newNPMCommandWithRunner(runner npmCommandRunner) *NPMCommand {
	return newNPMCommandWithRunnerAndProbe(runner, func(context.Context) bool { return true })
}

func newNPMCommandWithRunnerAndProbe(runner npmCommandRunner, flickerProbe func(context.Context) bool) *NPMCommand {
	if runner == nil {
		runner = execNPMCommandRunner{}
	}
	if flickerProbe == nil {
		flickerProbe = probeMyFlickerRegistry
	}
	return &NPMCommand{
		runner:       runner,
		now:          func() time.Time { return time.Now().UTC() },
		lookPath:     exec.LookPath,
		flickerProbe: flickerProbe,
		latestCache:  map[string]npmLatestCacheEntry{},
	}
}

const (
	myFlickerPackageName         = "@myflicker/cli"
	myFlickerRegistry            = "https://npm.corp.kuaishou.com"
	myFlickerRegistryMetadataURL = myFlickerRegistry + "/@myflicker%2fcli"
	myFlickerProbeTimeout        = 5 * time.Second
)

type npmRegistryPackageMetadata struct {
	Name     string            `json:"name"`
	DistTags map[string]string `json:"dist-tags"`
}

func probeMyFlickerRegistry(ctx context.Context) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	probeCtx, cancel := context.WithTimeout(ctx, myFlickerProbeTimeout)
	defer cancel()
	return probeNPMRegistryPackage(probeCtx, http.DefaultClient, myFlickerRegistryMetadataURL, myFlickerPackageName)
}

func probeNPMRegistryPackage(ctx context.Context, client *http.Client, metadataURL, packageName string) bool {
	if ctx == nil {
		ctx = context.Background()
	}
	if client == nil {
		client = http.DefaultClient
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, metadataURL, nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return false
	}
	var metadata npmRegistryPackageMetadata
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&metadata); err != nil {
		return false
	}
	return metadata.Name == packageName && strings.TrimSpace(metadata.DistTags["latest"]) != ""
}

func (c *NPMCommand) myFlickerRegistryAvailable() bool {
	c.flickerOnce.Do(func() {
		probe := c.flickerProbe
		if probe == nil {
			probe = probeMyFlickerRegistry
		}
		c.flickerReady = probe(context.Background())
	})
	return c.flickerReady
}

func (c *NPMCommand) setOperationDoneHandler(handler func()) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.operationDone = handler
	c.mu.Unlock()
}

func (c *NPMCommand) notifyOperationDone(handler func()) {
	if handler != nil {
		handler()
	}
}

// resolveLookPath returns the configured LookPath, falling back to exec.LookPath.
func (c *NPMCommand) resolveLookPath() func(string) (string, error) {
	if c != nil && c.lookPath != nil {
		return c.lookPath
	}
	return exec.LookPath
}

// npmPackageBinaryName returns the CLI binary name a runtime package provides
// (e.g. @openai/codex -> codex), or "" if the package is not a known runtime
// package with a resolvable binary.
func npmPackageBinaryName(packageName string) string {
	for _, pkg := range runtimeNPMPackages {
		if pkg.PackageName != packageName {
			continue
		}
		if pkg.BinaryName != "" {
			return pkg.BinaryName
		}
		if len(pkg.AgentTypes) > 0 {
			return pkg.AgentTypes[0]
		}
	}
	return ""
}

// installSuccessMessage describes a finished single-package install. Runtime
// packages are probed via LookPath so the message tells the user whether the CLI
// is immediately usable or whether a restart is required (e.g. when the hub's
// PATH has not yet been augmented with npm's global bin).
func (c *NPMCommand) installSuccessMessage(packageName, version string) string {
	base := fmt.Sprintf("Installed %s@%s.", packageName, version)
	binary := npmPackageBinaryName(packageName)
	if binary == "" {
		return base + " Restart WheelMaker or start a new agent session for the change to take effect."
	}
	if _, err := c.resolveLookPath()(binary); err == nil {
		return base + fmt.Sprintf(" `%s` is now on PATH and ready to use.", binary)
	}
	return base + fmt.Sprintf(" Restart WheelMaker so `%s` is picked up from PATH (not found on the current PATH yet).", binary)
}

// installManySuccessMessage describes a finished multi-package install, reporting
// which installed CLI binaries are immediately usable versus need a restart.
func (c *NPMCommand) installManySuccessMessage(packageNames []string) string {
	lookPath := c.resolveLookPath()
	var ready, missing []string
	for _, name := range packageNames {
		binary := npmPackageBinaryName(name)
		if binary == "" {
			continue
		}
		if _, err := lookPath(binary); err == nil {
			ready = append(ready, binary)
		} else {
			missing = append(missing, binary)
		}
	}
	base := fmt.Sprintf("Installed %d npm %s.", len(packageNames), pluralNoun(len(packageNames), "package", "packages"))
	if len(ready) == 0 && len(missing) == 0 {
		return base + " Restart WheelMaker or start a new agent session for the change to take effect."
	}
	if len(missing) == 0 {
		return base + fmt.Sprintf(" All installed CLIs (%s) are now on PATH and ready to use.", strings.Join(ready, ", "))
	}
	return base + fmt.Sprintf(" Restart WheelMaker so the following CLIs are picked up from PATH (not found yet): %s.", strings.Join(missing, ", "))
}

type npmCommandPayload struct {
	Action       string   `json:"action"`
	HubID        string   `json:"hubId"`
	PackageName  string   `json:"packageName,omitempty"`
	PackageNames []string `json:"packageNames,omitempty"`
	Version      string   `json:"version,omitempty"`
}

type npmCommandResponse struct {
	OK        bool                  `json:"ok"`
	Accepted  bool                  `json:"accepted,omitempty"`
	UpdatedAt string                `json:"updatedAt,omitempty"`
	Hub       npmHubSnapshot        `json:"hub,omitempty"`
	Operation *npmOperationSnapshot `json:"operation"`
}

type npmHubSnapshot struct {
	HubID       string             `json:"hubId"`
	NodeVersion string             `json:"nodeVersion"`
	NPMVersion  string             `json:"npmVersion"`
	NPMPrefix   string             `json:"npmPrefix"`
	Warning     string             `json:"warning"`
	Error       string             `json:"error"`
	Packages    []npmPackageStatus `json:"packages"`
}

type npmPackageStatus struct {
	PackageName      string   `json:"packageName"`
	DisplayName      string   `json:"displayName"`
	AgentTypes       []string `json:"agentTypes"`
	Kind             string   `json:"kind"`
	Installed        bool     `json:"installed"`
	InstalledVersion string   `json:"installedVersion"`
	LatestVersion    string   `json:"latestVersion"`
	Status           string   `json:"status"`
	Error            string   `json:"error"`
	CanInstall       bool     `json:"canInstall"`
	CanUpdate        bool     `json:"canUpdate"`
	CanUninstall     bool     `json:"canUninstall"`
}

type npmOperationSnapshot struct {
	Running      bool     `json:"running"`
	Action       string   `json:"action"`
	PackageName  string   `json:"packageName"`
	PackageNames []string `json:"packageNames,omitempty"`
	Version      string   `json:"version"`
	Status       string   `json:"status"`
	StartedAt    string   `json:"startedAt"`
	FinishedAt   string   `json:"finishedAt"`
	ExitCode     *int     `json:"exitCode"`
	ErrorSummary string   `json:"errorSummary"`
	Message      string   `json:"message,omitempty"`
}

type npmCommandError struct {
	Code    string
	Message string
}

func (e *npmCommandError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == "" {
		return e.Message
	}
	return e.Code + ": " + e.Message
}

func (e *npmCommandError) commandCode() string {
	if e == nil {
		return ""
	}
	return e.Code
}

func (e *npmCommandError) commandMessage() string {
	if e == nil {
		return ""
	}
	return e.Message
}

type npmPackagePolicy struct {
	PackageName string
	DisplayName string
	AgentTypes  []string
	BinaryName  string
	Kind        string
}

var runtimeNPMPackages = []npmPackagePolicy{
	{PackageName: "@agentclientprotocol/claude-agent-acp", DisplayName: "Claude ACP", AgentTypes: []string{"claude"}, Kind: "runtime"},
	{PackageName: "@anthropic-ai/claude-code", DisplayName: "Claude CLI", AgentTypes: []string{"claude"}, Kind: "runtime"},
	{PackageName: "@openai/codex", DisplayName: "Codex CLI", AgentTypes: []string{"codex"}, Kind: "runtime"},
	{PackageName: "@github/copilot", DisplayName: "Copilot CLI", AgentTypes: []string{"copilot"}, Kind: "runtime"},
	{PackageName: "opencode-ai", DisplayName: "OpenCode CLI", AgentTypes: []string{"opencode"}, Kind: "runtime"},
	{PackageName: "@tencent-ai/codebuddy-code", DisplayName: "CodeBuddy CLI", AgentTypes: []string{"codebuddy"}, Kind: "runtime"},
	{PackageName: myFlickerPackageName, DisplayName: "MyFlicker CLI", AgentTypes: []string{"flicker"}, BinaryName: "myflicker", Kind: "runtime"},
}

var deprecatedNPMPackages = []npmPackagePolicy{
	{PackageName: "@zed-industries/codex-acp", DisplayName: "Deprecated Codex ACP", Kind: "deprecated"},
	{PackageName: "@zed-industries/claude-agent-acp", DisplayName: "Deprecated Claude ACP", AgentTypes: []string{"claude"}, Kind: "deprecated"},
}

func (c *NPMCommand) Handle(ctx context.Context, raw json.RawMessage) (any, *npmCommandError) {
	var payload npmCommandPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "invalid cmd.npm payload"}
	}
	payload.Action = strings.TrimSpace(payload.Action)
	payload.HubID = strings.TrimSpace(payload.HubID)
	payload.PackageName = strings.TrimSpace(payload.PackageName)
	payload.PackageNames = normalizeNPMPackageNames(payload.PackageNames)
	payload.Version = strings.TrimSpace(payload.Version)
	if payload.HubID == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "hubId is required"}
	}

	switch payload.Action {
	case "scan":
		return c.scan(ctx, payload.HubID), nil
	case "install":
		return c.startInstall(payload)
	case "install_many":
		return c.startInstallMany(payload)
	case "uninstall":
		return c.startUninstall(payload)
	case "reinstall":
		return c.startReinstall(payload)
	default:
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "unsupported cmd.npm action"}
	}
}

func (c *NPMCommand) scan(ctx context.Context, hubID string) npmCommandResponse {
	now := c.now()
	updatedAt := now.Format(time.RFC3339)
	flickerAvailable := c.myFlickerRegistryAvailable()
	hub := npmHubSnapshot{
		HubID:    hubID,
		Packages: []npmPackageStatus{},
	}

	listResult := c.runner.Run(ctx, "npm", "list", "-g", "--depth=0", "--json")
	if commandFailed(listResult) {
		hub.Error = "npm list failed: " + npmResultSummary(listResult)
		return npmCommandResponse{OK: false, UpdatedAt: updatedAt, Hub: hub, Operation: c.currentOperationSnapshot()}
	}
	installed, err := parseNPMListDependencies(listResult.Stdout)
	if err != nil {
		hub.Error = "npm list failed: " + err.Error()
		return npmCommandResponse{OK: false, UpdatedAt: updatedAt, Hub: hub, Operation: c.currentOperationSnapshot()}
	}

	latest, missingLatest := c.latestResultsForScan(now, flickerAvailable)
	operation := c.currentOperationSnapshot()
	if len(missingLatest) > 0 && (operation == nil || !operation.Running) {
		started, cmdErr := c.acceptOperation("scan_latest", "", "", nil)
		if cmdErr == nil {
			operation = cloneNPMOperation(started)
			go c.runLatestOperation(started, missingLatest)
		}
	}
	for _, policy := range runtimeNPMPackagesForScan(flickerAvailable) {
		installedVersion := installed[policy.PackageName]
		row := npmPackageStatus{
			PackageName:      policy.PackageName,
			DisplayName:      policy.DisplayName,
			AgentTypes:       cloneNPMStringSlice(policy.AgentTypes),
			Kind:             policy.Kind,
			Installed:        installedVersion != "",
			InstalledVersion: installedVersion,
			CanUninstall:     installedVersion != "",
		}
		latestResult, hasLatest := latest[policy.PackageName]
		if hasLatest {
			row.LatestVersion = latestResult.version
			row.Error = latestResult.errorSummary
			row.Status, row.CanInstall, row.CanUpdate = runtimePackageStatus(row.Installed, row.InstalledVersion, row.LatestVersion, row.Error)
		} else {
			row.Status = "checking_latest"
		}
		hub.Packages = append(hub.Packages, row)
	}
	for _, policy := range deprecatedNPMPackages {
		installedVersion := installed[policy.PackageName]
		if installedVersion == "" {
			continue
		}
		hub.Packages = append(hub.Packages, npmPackageStatus{
			PackageName:      policy.PackageName,
			DisplayName:      policy.DisplayName,
			AgentTypes:       cloneNPMStringSlice(policy.AgentTypes),
			Kind:             policy.Kind,
			Installed:        true,
			InstalledVersion: installedVersion,
			Status:           "deprecated",
			CanUninstall:     true,
		})
	}
	return npmCommandResponse{OK: true, UpdatedAt: updatedAt, Hub: hub, Operation: operation}
}

func cloneNPMStringSlice(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

func runtimeNPMPackagesForScan(flickerAvailable bool) []npmPackagePolicy {
	out := make([]npmPackagePolicy, 0, len(runtimeNPMPackages))
	for _, policy := range runtimeNPMPackages {
		if policy.PackageName == myFlickerPackageName && !flickerAvailable {
			continue
		}
		out = append(out, policy)
	}
	return out
}

func normalizeNPMPackageNames(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		packageName := strings.TrimSpace(value)
		if packageName == "" {
			continue
		}
		if _, ok := seen[packageName]; ok {
			continue
		}
		seen[packageName] = struct{}{}
		out = append(out, packageName)
	}
	return out
}

type npmLatestResult struct {
	version      string
	errorSummary string
}

type npmLatestCacheEntry struct {
	result    npmLatestResult
	fetchedAt time.Time
}

const (
	npmLatestSuccessTTL = time.Hour
	npmLatestFailureTTL = 5 * time.Minute
)

func npmRegistryArgs(packageName string) []string {
	if packageName == myFlickerPackageName {
		return []string{"--registry=" + myFlickerRegistry}
	}
	return nil
}

func npmViewArgs(packageName string) []string {
	args := []string{"view", packageName, "version"}
	return append(args, npmRegistryArgs(packageName)...)
}

func npmInstallArgs(packageName, version string) []string {
	args := []string{"install", "-g", packageName + "@" + version}
	return append(args, npmRegistryArgs(packageName)...)
}

func (c *NPMCommand) lookupLatestVersions(ctx context.Context, packageNames []string) map[string]npmLatestResult {
	out := make(map[string]npmLatestResult, len(packageNames))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, packageName := range packageNames {
		packageName := packageName
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := c.runner.Run(ctx, "npm", npmViewArgs(packageName)...)
			next := npmLatestResult{version: firstNonEmptyLine(result.Stdout)}
			if commandFailed(result) || next.version == "" {
				next.version = ""
				next.errorSummary = npmResultSummary(result)
			}
			mu.Lock()
			out[packageName] = next
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

func (c *NPMCommand) latestResultsForScan(now time.Time, flickerAvailable bool) (map[string]npmLatestResult, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	packages := runtimeNPMPackagesForScan(flickerAvailable)
	out := make(map[string]npmLatestResult, len(packages))
	var missing []string
	for _, policy := range packages {
		entry, ok := c.latestCache[policy.PackageName]
		if !ok || !npmLatestCacheValid(entry, now) {
			missing = append(missing, policy.PackageName)
			continue
		}
		out[policy.PackageName] = entry.result
	}
	return out, missing
}

func npmLatestCacheValid(entry npmLatestCacheEntry, now time.Time) bool {
	if entry.fetchedAt.IsZero() {
		return false
	}
	ttl := npmLatestFailureTTL
	if entry.result.version != "" && entry.result.errorSummary == "" {
		ttl = npmLatestSuccessTTL
	}
	return now.Sub(entry.fetchedAt) < ttl
}

func (c *NPMCommand) runLatestOperation(operation *npmOperationSnapshot, packageNames []string) {
	results := c.lookupLatestVersions(context.Background(), packageNames)
	finished := c.now()
	finishedAt := finished.Format(time.RFC3339)
	var failed []string

	c.mu.Lock()
	defer c.mu.Unlock()
	for _, packageName := range packageNames {
		result := results[packageName]
		c.latestCache[packageName] = npmLatestCacheEntry{
			result:    result,
			fetchedAt: finished,
		}
		if result.errorSummary != "" {
			failed = append(failed, packageName)
		}
	}
	if c.operation != operation {
		return
	}
	operation.Running = false
	operation.FinishedAt = finishedAt
	if len(failed) > 0 {
		operation.Status = "failed"
		operation.ErrorSummary = fmt.Sprintf("latest version check failed for %s", strings.Join(failed, ", "))
		return
	}
	operation.Status = "succeeded"
	operation.Message = "Latest package versions refreshed."
}

func (c *NPMCommand) startInstall(payload npmCommandPayload) (any, *npmCommandError) {
	if payload.PackageName == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageName is required"}
	}
	version := payload.Version
	if version == "" {
		version = "latest"
	}
	if version != "latest" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "version must be latest"}
	}
	if !runtimePackageAllowed(payload.PackageName) {
		return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not installable"}
	}
	operation, cmdErr := c.acceptOperation("install", payload.PackageName, version, nil)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runCommandOperation(operation, "npm", npmInstallArgs(payload.PackageName, version)...)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}

func (c *NPMCommand) startInstallMany(payload npmCommandPayload) (any, *npmCommandError) {
	if len(payload.PackageNames) == 0 {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageNames is required"}
	}
	version := payload.Version
	if version == "" {
		version = "latest"
	}
	if version != "latest" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "version must be latest"}
	}
	for _, packageName := range payload.PackageNames {
		if !runtimePackageAllowed(packageName) {
			return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not installable"}
		}
	}
	operation, cmdErr := c.acceptOperation("install_many", "", version, payload.PackageNames)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runInstallManyOperation(operation, payload.PackageNames, version)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}

func (c *NPMCommand) startUninstall(payload npmCommandPayload) (any, *npmCommandError) {
	if payload.PackageName == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageName is required"}
	}
	if !packageUninstallable(payload.PackageName) {
		return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not uninstallable"}
	}
	operation, cmdErr := c.acceptOperation("uninstall", payload.PackageName, "", nil)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runCommandOperation(operation, "npm", "uninstall", "-g", payload.PackageName)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}

func (c *NPMCommand) startReinstall(payload npmCommandPayload) (any, *npmCommandError) {
	if payload.PackageName == "" {
		return nil, &npmCommandError{Code: rp.CodeInvalidArgument, Message: "packageName is required"}
	}
	if !packageUninstallable(payload.PackageName) {
		return nil, &npmCommandError{Code: rp.CodeForbidden, Message: "package is not reinstallable"}
	}
	operation, cmdErr := c.acceptOperation("reinstall", payload.PackageName, "latest", nil)
	if cmdErr != nil {
		return nil, cmdErr
	}
	go c.runReinstallOperation(operation, payload.PackageName)
	return npmCommandResponse{OK: true, Accepted: true, Operation: cloneNPMOperation(operation)}, nil
}

func (c *NPMCommand) runReinstallOperation(operation *npmOperationSnapshot, packageName string) {
	uninstallResult := c.runner.Run(context.Background(), "npm", "uninstall", "-g", packageName)
	if commandFailed(uninstallResult) {
		exitCode := uninstallResult.ExitCode
		c.mu.Lock()
		if c.operation != operation {
			c.mu.Unlock()
			return
		}
		operation.Running = false
		operation.FinishedAt = c.now().Format(time.RFC3339)
		operation.ExitCode = &exitCode
		operation.Status = "failed"
		operation.ErrorSummary = formatNPMTaskErrorSummary(uninstallResult.ExitCode, uninstallResult.Stdout, uninstallResult.Stderr, uninstallResult.Err)
		done := c.operationDone
		c.mu.Unlock()
		c.notifyOperationDone(done)
		return
	}
	installResult := c.runner.Run(context.Background(), "npm", npmInstallArgs(packageName, "latest")...)
	exitCode := installResult.ExitCode
	c.mu.Lock()
	if c.operation != operation {
		c.mu.Unlock()
		return
	}
	operation.Running = false
	operation.FinishedAt = c.now().Format(time.RFC3339)
	operation.ExitCode = &exitCode
	if commandFailed(installResult) {
		operation.Status = "failed"
		operation.ErrorSummary = formatNPMTaskErrorSummary(installResult.ExitCode, installResult.Stdout, installResult.Stderr, installResult.Err)
		done := c.operationDone
		c.mu.Unlock()
		c.notifyOperationDone(done)
		return
	}
	operation.Status = "succeeded"
	operation.Message = c.installSuccessMessage(packageName, "latest")
	done := c.operationDone
	c.mu.Unlock()
	c.notifyOperationDone(done)
}

func (c *NPMCommand) acceptOperation(action string, packageName string, version string, packageNames []string) (*npmOperationSnapshot, *npmCommandError) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.operation != nil && c.operation.Running {
		return nil, &npmCommandError{Code: rp.CodeConflict, Message: "npm operation already running"}
	}
	status := "running"
	if action == "scan_latest" {
		status = "checking_latest"
	}
	operation := &npmOperationSnapshot{
		Running:      true,
		Action:       action,
		PackageName:  packageName,
		PackageNames: cloneNPMStringSlice(packageNames),
		Version:      version,
		Status:       status,
		StartedAt:    c.now().Format(time.RFC3339),
	}
	c.operation = operation
	return operation, nil
}

func (c *NPMCommand) runCommandOperation(operation *npmOperationSnapshot, name string, args ...string) {
	result := c.runner.Run(context.Background(), name, args...)
	exitCode := result.ExitCode
	finishedAt := c.now().Format(time.RFC3339)

	c.mu.Lock()
	if c.operation != operation {
		c.mu.Unlock()
		return
	}
	operation.Running = false
	operation.FinishedAt = finishedAt
	operation.ExitCode = &exitCode
	if commandFailed(result) {
		operation.Status = "failed"
		operation.ErrorSummary = formatNPMTaskErrorSummary(exitCode, result.Stdout, result.Stderr, result.Err)
		done := c.operationDone
		c.mu.Unlock()
		c.notifyOperationDone(done)
		return
	}
	operation.Status = "succeeded"
	if operation.Action == "uninstall" {
		operation.Message = fmt.Sprintf("Uninstalled %s. Agent availability is refreshing.", operation.PackageName)
	} else {
		operation.Message = c.installSuccessMessage(operation.PackageName, operation.Version)
	}
	done := c.operationDone
	c.mu.Unlock()
	c.notifyOperationDone(done)
}

func (c *NPMCommand) runInstallManyOperation(operation *npmOperationSnapshot, packageNames []string, version string) {
	var failed []string
	var exitCode *int
	for _, packageName := range packageNames {
		result := c.runner.Run(context.Background(), "npm", npmInstallArgs(packageName, version)...)
		if commandFailed(result) {
			code := result.ExitCode
			exitCode = &code
			failed = append(failed, packageName+": "+formatNPMTaskErrorSummary(result.ExitCode, result.Stdout, result.Stderr, result.Err))
		}
	}
	finishedAt := c.now().Format(time.RFC3339)

	c.mu.Lock()
	if c.operation != operation {
		c.mu.Unlock()
		return
	}
	operation.Running = false
	operation.FinishedAt = finishedAt
	if exitCode != nil {
		code := *exitCode
		operation.ExitCode = &code
	}
	if len(failed) > 0 {
		operation.Status = "failed"
		operation.ErrorSummary = "Failed npm package installs: " + strings.Join(failed, "; ")
		done := c.operationDone
		c.mu.Unlock()
		c.notifyOperationDone(done)
		return
	}
	operation.Status = "succeeded"
	operation.Message = c.installManySuccessMessage(packageNames)
	done := c.operationDone
	c.mu.Unlock()
	c.notifyOperationDone(done)
}

func (c *NPMCommand) currentOperationSnapshot() *npmOperationSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneNPMOperation(c.operation)
}

func parseNPMListDependencies(raw string) (map[string]string, error) {
	var body struct {
		Dependencies map[string]struct {
			Version string `json:"version"`
		} `json:"dependencies"`
	}
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		return nil, fmt.Errorf("invalid npm list json: %w", err)
	}
	out := make(map[string]string, len(body.Dependencies))
	for name, dep := range body.Dependencies {
		version := strings.TrimSpace(dep.Version)
		if version != "" {
			out[name] = version
		}
	}
	return out, nil
}

func runtimePackageStatus(installed bool, installedVersion string, latestVersion string, latestError string) (string, bool, bool) {
	if latestError != "" {
		return "latest_unknown", false, false
	}
	if !installed {
		return "not_installed", true, false
	}
	if latestVersion == "" {
		return "checking_failed", false, false
	}
	if installedVersion == latestVersion {
		return "up_to_date", false, false
	}
	return "update_available", false, true
}

func runtimePackageAllowed(packageName string) bool {
	for _, policy := range runtimeNPMPackages {
		if policy.PackageName == packageName {
			return true
		}
	}
	return false
}

func deprecatedPackageAllowed(packageName string) bool {
	for _, policy := range deprecatedNPMPackages {
		if policy.PackageName == packageName {
			return true
		}
	}
	return false
}

func packageUninstallable(packageName string) bool {
	return runtimePackageAllowed(packageName) || deprecatedPackageAllowed(packageName)
}

func commandFailed(result npmCommandResult) bool {
	return result.Err != nil || result.ExitCode != 0
}

func npmResultSummary(result npmCommandResult) string {
	return formatNPMTaskErrorSummary(result.ExitCode, result.Stdout, result.Stderr, result.Err)
}

func formatNPMTaskErrorSummary(exitCode int, stdout string, stderr string, err error) string {
	segment := lastNonEmptySegment(stderr)
	if segment == "" {
		segment = lastNonEmptySegment(stdout)
	}
	if segment == "" {
		if err != nil {
			return fmt.Sprintf("npm command failed with exit code %d: %s", exitCode, truncateRunes(err.Error(), 500))
		}
		return fmt.Sprintf("npm command failed with exit code %d", exitCode)
	}
	return fmt.Sprintf("exit code %d: %s", exitCode, truncateRunes(segment, 500))
}

func lastNonEmptySegment(raw string) string {
	clean := strings.ReplaceAll(raw, "\r\n", "\n")
	paragraphs := strings.Split(clean, "\n\n")
	for i := len(paragraphs) - 1; i >= 0; i-- {
		segment := strings.TrimSpace(paragraphs[i])
		if segment != "" {
			return segment
		}
	}
	lines := strings.Split(clean, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" {
			return line
		}
	}
	return ""
}

func firstNonEmptyLine(raw string) string {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 || utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

func cloneNPMOperation(operation *npmOperationSnapshot) *npmOperationSnapshot {
	if operation == nil {
		return nil
	}
	cp := *operation
	cp.PackageNames = cloneNPMStringSlice(operation.PackageNames)
	if operation.ExitCode != nil {
		exitCode := *operation.ExitCode
		cp.ExitCode = &exitCode
	}
	return &cp
}

func pluralNoun(count int, singular string, plural string) string {
	if count == 1 {
		return singular
	}
	return plural
}
