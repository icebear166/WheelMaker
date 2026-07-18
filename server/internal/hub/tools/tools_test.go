package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestManagerRoutesToolCommands(t *testing.T) {
	manager := NewManager(ManagerConfig{HubID: "hub-a", StateDir: t.TempDir()})

	resp, cmdErr := manager.Handle(context.Background(), "cmd.update", rawToolPayload(t, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle cmd.update error=%v", cmdErr)
	}
	body := resp.(updateCommandResponse)
	if !body.OK || body.HubID != "hub-a" || body.Status != "not_installed" {
		t.Fatalf("cmd.update response=%#v", body)
	}

	_, cmdErr = manager.Handle(context.Background(), "cmd.unknown", rawToolPayload(t, map[string]any{}))
	if cmdErr == nil || cmdErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("unknown command error=%#v, want INVALID_ARGUMENT", cmdErr)
	}
}

func rawToolPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

type fakeNPMRunner struct {
	mu        sync.Mutex
	calls     []npmCommandCall
	results   map[string]npmCommandResult
	blockKeys map[string]chan struct{}
}

func newFakeNPMRunner() *fakeNPMRunner {
	return &fakeNPMRunner{
		results:   map[string]npmCommandResult{},
		blockKeys: map[string]chan struct{}{},
	}
}

func (f *fakeNPMRunner) Run(ctx context.Context, name string, args ...string) npmCommandResult {
	key := npmCallKey(name, args...)
	f.mu.Lock()
	f.calls = append(f.calls, npmCommandCall{Name: name, Args: append([]string(nil), args...)})
	block := f.blockKeys[key]
	result, ok := f.results[key]
	f.mu.Unlock()
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return npmCommandResult{ExitCode: -1, Err: ctx.Err()}
		}
	}
	if ok {
		return result
	}
	if name == "npm" && len(args) == 3 && args[0] == "view" && args[2] == "version" {
		return npmCommandResult{Stdout: "9.9.9\n", ExitCode: 0}
	}
	return npmCommandResult{Stdout: "", ExitCode: 0}
}

func (f *fakeNPMRunner) set(name string, args []string, result npmCommandResult) {
	f.mu.Lock()
	f.results[npmCallKey(name, args...)] = result
	f.mu.Unlock()
}

func (f *fakeNPMRunner) block(name string, args []string) chan struct{} {
	ch := make(chan struct{})
	f.mu.Lock()
	f.blockKeys[npmCallKey(name, args...)] = ch
	f.mu.Unlock()
	return ch
}

func (f *fakeNPMRunner) hasCall(name string, args ...string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := npmCommandCall{Name: name, Args: args}
	for _, call := range f.calls {
		if reflect.DeepEqual(call, want) {
			return true
		}
	}
	return false
}

func npmCallKey(name string, args ...string) string {
	return name + "\x00" + strings.Join(args, "\x00")
}

func TestNPMCommandScanReturnsRuntimeAndDeprecatedPackageRows(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@openai/codex":{"version":"0.129.0"},"@zed-industries/claude-agent-acp":{"version":"0.13.0"}}}`,
		ExitCode: 0,
	})
	runner.set("npm", []string{"view", "@openai/codex", "version"}, npmCommandResult{Stdout: "0.130.0\n", ExitCode: 0})

	cmd := newNPMCommandWithRunner(runner)
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.OK || body.Hub.HubID != "hub-a" {
		t.Fatalf("response=%#v", body)
	}
	if body.Operation == nil || body.Operation.Action != "scan_latest" || !body.Operation.Running {
		t.Fatalf("operation=%#v, want running scan_latest", body.Operation)
	}
	if runner.hasCall("node", "--version") || runner.hasCall("npm", "--version") || runner.hasCall("npm", "prefix", "-g") {
		t.Fatalf("scan should not call hidden metadata commands: %#v", runner.calls)
	}

	codex := findNPMTestPackage(t, body.Hub.Packages, "@openai/codex")
	if codex.Status != "checking_latest" || codex.InstalledVersion != "0.129.0" || codex.LatestVersion != "" {
		t.Fatalf("codex package before latest=%#v", codex)
	}
	if !reflect.DeepEqual(codex.AgentTypes, []string{"codex"}) {
		t.Fatalf("@openai/codex agentTypes=%v, want [codex]", codex.AgentTypes)
	}
	if codex.CanInstall || codex.CanUpdate || codex.CanUninstall {
		t.Fatalf("codex action flags should be disabled while latest is checking: %#v", codex)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	codex = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if codex.Status != "update_available" || codex.InstalledVersion != "0.129.0" || codex.LatestVersion != "0.130.0" {
		t.Fatalf("codex package=%#v", codex)
	}
	if !codex.CanUpdate || codex.CanUninstall {
		t.Fatalf("codex action flags=%#v", codex)
	}

	deprecated := findNPMTestPackage(t, body.Hub.Packages, "@zed-industries/claude-agent-acp")
	if deprecated.Kind != "deprecated" || deprecated.Status != "deprecated" || !deprecated.CanUninstall {
		t.Fatalf("deprecated package=%#v", deprecated)
	}
}

func TestNPMCommandScanExcludesMyFlickerFromUpdateList(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@myflicker/cli":{"version":"1.0.0"},"@openai/codex":{"version":"0.129.0"}}}`,
		ExitCode: 0,
	})
	runner.set("npm", []string{"view", "@openai/codex", "version"}, npmCommandResult{Stdout: "0.130.0\n", ExitCode: 0})

	cmd := newNPMCommandWithRunner(runner)
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if hasNPMTestPackage(body.Hub.Packages, "@myflicker/cli") {
		t.Fatalf("scan packages include @myflicker/cli: %#v", body.Hub.Packages)
	}

	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	if hasNPMTestPackage(resp.(npmCommandResponse).Hub.Packages, "@myflicker/cli") {
		t.Fatalf("second scan packages include @myflicker/cli: %#v", resp.(npmCommandResponse).Hub.Packages)
	}
	if runner.hasCall("npm", "view", "@myflicker/cli", "version") {
		t.Fatalf("scan should not query latest for @myflicker/cli: %#v", runner.calls)
	}
}

func TestNPMCommandScanDeprecatedCodexACPUsesEmptyAgentTypes(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{"@zed-industries/codex-acp":{"version":"0.1.0"}}}`,
		ExitCode: 0,
	})

	cmd := newNPMCommandWithRunner(runner)
	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	deprecatedCodex := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@zed-industries/codex-acp")
	if deprecatedCodex.AgentTypes == nil {
		t.Fatalf("deprecated codex-acp agentTypes is nil; UI requires an empty array")
	}
	if len(deprecatedCodex.AgentTypes) != 0 {
		t.Fatalf("deprecated codex-acp agentTypes=%v, want empty", deprecatedCodex.AgentTypes)
	}
}

func TestNPMCommandScanListFailureReturnsHubError(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stderr:   "npm list exploded\n",
		ExitCode: 1,
		Err:      errors.New("exit status 1"),
	})
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if body.OK || body.Hub.Error == "" || len(body.Hub.Packages) != 0 {
		t.Fatalf("body=%#v, want hub-level scan error with empty packages", body)
	}
}

func TestNPMCommandScanMarksMissingPackageViewFailureAsCheckingFailed(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"list", "-g", "--depth=0", "--json"}, npmCommandResult{
		Stdout:   `{"dependencies":{}}`,
		ExitCode: 0,
	})
	runner.set("npm", []string{"view", "@openai/codex", "version"}, npmCommandResult{
		Stderr:   "registry unavailable\n",
		ExitCode: 1,
		Err:      errors.New("exit status 1"),
	})
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	pkg := findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "checking_latest" || pkg.CanInstall || pkg.CanUpdate || pkg.Error != "" {
		t.Fatalf("pkg=%#v, want checking_latest package without actions while latest query runs", pkg)
	}
	waitForNPMTestOperation(t, cmd)
	resp, cmdErr = cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle second scan error: %#v", cmdErr)
	}
	pkg = findNPMTestPackage(t, resp.(npmCommandResponse).Hub.Packages, "@openai/codex")
	if pkg.Status != "latest_unknown" || pkg.CanInstall || pkg.CanUpdate || pkg.Error == "" {
		t.Fatalf("pkg=%#v, want latest_unknown package without actions after latest failure", pkg)
	}
}

func TestNPMCommandAcceptsRuntimeInstallAndDeprecatedUninstall(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	installResp, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
		"version":     "latest",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	installBody := installResp.(npmCommandResponse)
	if installBody.Operation == nil || installBody.Operation.Action != "install" || installBody.Operation.PackageName != "@openai/codex" {
		t.Fatalf("install operation=%#v", installBody.Operation)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("install call not found: %#v", runner.calls)
	}

	uninstallResp, uninstallErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "uninstall",
		"hubId":       "hub-a",
		"packageName": "@zed-industries/claude-agent-acp",
	}))
	if uninstallErr != nil {
		t.Fatalf("uninstall error: %#v", uninstallErr)
	}
	uninstallBody := uninstallResp.(npmCommandResponse)
	if uninstallBody.Operation == nil || uninstallBody.Operation.Action != "uninstall" || uninstallBody.Operation.PackageName != "@zed-industries/claude-agent-acp" {
		t.Fatalf("uninstall operation=%#v", uninstallBody.Operation)
	}
	waitForNPMTestOperation(t, cmd)
	if !runner.hasCall("npm", "uninstall", "-g", "@zed-industries/claude-agent-acp") {
		t.Fatalf("uninstall call not found: %#v", runner.calls)
	}
}

func TestNPMCommandAcceptsBulkRuntimeInstallAsSingleOperation(t *testing.T) {
	runner := newFakeNPMRunner()
	cmd := newNPMCommandWithRunner(runner)

	resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":       "install_many",
		"hubId":        "hub-a",
		"packageNames": []string{"@openai/codex", "@anthropic-ai/claude-code"},
		"version":      "latest",
	}))
	if cmdErr != nil {
		t.Fatalf("bulk install error: %#v", cmdErr)
	}
	body := resp.(npmCommandResponse)
	if !body.Accepted || body.Operation == nil || body.Operation.Action != "install_many" {
		t.Fatalf("response=%#v, want accepted install_many operation", body)
	}
	if !reflect.DeepEqual(body.Operation.PackageNames, []string{"@openai/codex", "@anthropic-ai/claude-code"}) {
		t.Fatalf("package names=%#v", body.Operation.PackageNames)
	}

	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "succeeded" || !strings.Contains(operation.Message, "Installed 2 npm packages") {
		t.Fatalf("operation=%#v, want succeeded bulk install", operation)
	}
	if !runner.hasCall("npm", "install", "-g", "@openai/codex@latest") {
		t.Fatalf("codex install call not found: %#v", runner.calls)
	}
	if !runner.hasCall("npm", "install", "-g", "@anthropic-ai/claude-code@latest") {
		t.Fatalf("claude install call not found: %#v", runner.calls)
	}
}

func TestNPMCommandRejectsUnsupportedPackagePolicy(t *testing.T) {
	cmd := newNPMCommandWithRunner(newFakeNPMRunner())
	cases := []struct {
		name    string
		payload map[string]any
		code    string
	}{
		{
			name: "unsupported install package",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "left-pad",
			},
			code: rp.CodeForbidden,
		},
		{
			name: "deprecated install package",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "@zed-industries/claude-agent-acp",
			},
			code: rp.CodeForbidden,
		},
		{
			name: "runtime uninstall package",
			payload: map[string]any{
				"action":      "uninstall",
				"hubId":       "hub-a",
				"packageName": "@openai/codex",
			},
			code: rp.CodeForbidden,
		},
		{
			name: "unsupported version",
			payload: map[string]any{
				"action":      "install",
				"hubId":       "hub-a",
				"packageName": "@openai/codex",
				"version":     "0.130.0",
			},
			code: rp.CodeInvalidArgument,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, tc.payload))
			if cmdErr == nil || cmdErr.Code != tc.code {
				t.Fatalf("cmdErr=%#v, want code %s", cmdErr, tc.code)
			}
		})
	}
}

func TestNPMCommandRejectsConcurrentOperationsAndQueryIsUnsupported(t *testing.T) {
	runner := newFakeNPMRunner()
	block := runner.block("npm", []string{"install", "-g", "@openai/codex@latest"})
	cmd := newNPMCommandWithRunner(runner)

	_, queryErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	}))
	if queryErr == nil || queryErr.Code != rp.CodeInvalidArgument {
		t.Fatalf("queryErr=%#v, want INVALID_ARGUMENT", queryErr)
	}

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("first install error: %#v", installErr)
	}
	_, conflictErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@agentclientprotocol/claude-agent-acp",
	}))
	if conflictErr == nil || conflictErr.Code != rp.CodeConflict {
		t.Fatalf("conflictErr=%#v, want CONFLICT", conflictErr)
	}
	close(block)
	waitForNPMTestOperation(t, cmd)
}

func TestNPMCommandFailedTaskSummarizesLastStderrSegment(t *testing.T) {
	longTail := strings.Repeat("x", 650)
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"install", "-g", "@openai/codex@latest"}, npmCommandResult{
		Stderr:   "first failure\n\n" + longTail,
		ExitCode: 7,
		Err:      errors.New("exit status 7"),
	})
	cmd := newNPMCommandWithRunner(runner)

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "failed" || operation.ExitCode == nil || *operation.ExitCode != 7 {
		t.Fatalf("operation=%#v, want failed exit 7", operation)
	}
	if !strings.Contains(operation.ErrorSummary, "exit code 7") {
		t.Fatalf("summary=%q, want exit code", operation.ErrorSummary)
	}
	if strings.Contains(operation.ErrorSummary, "first failure") {
		t.Fatalf("summary=%q should use last non-empty stderr segment", operation.ErrorSummary)
	}
	if len(operation.ErrorSummary) > len("exit code 7: ")+500 {
		t.Fatalf("summary length=%d, want truncated to 500 char segment", len(operation.ErrorSummary))
	}
}

func TestNPMCommandFailedTaskIncludesExecErrorWhenOutputEmpty(t *testing.T) {
	runner := newFakeNPMRunner()
	runner.set("npm", []string{"install", "-g", "@openai/codex@latest"}, npmCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "npm": executable file not found in $PATH`),
	})
	cmd := newNPMCommandWithRunner(runner)

	_, installErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"packageName": "@openai/codex",
	}))
	if installErr != nil {
		t.Fatalf("install error: %#v", installErr)
	}
	operation := waitForNPMTestOperation(t, cmd)
	if operation.Status != "failed" || operation.ExitCode == nil || *operation.ExitCode != -1 {
		t.Fatalf("operation=%#v, want failed exit -1", operation)
	}
	if !strings.Contains(operation.ErrorSummary, `exec: "npm"`) {
		t.Fatalf("summary=%q, want exec error", operation.ErrorSummary)
	}
}

func rawNPMCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func findNPMTestPackage(t *testing.T, packages []npmPackageStatus, name string) npmPackageStatus {
	t.Helper()
	for _, pkg := range packages {
		if pkg.PackageName == name {
			return pkg
		}
	}
	t.Fatalf("package %s not found in %#v", name, packages)
	return npmPackageStatus{}
}

func hasNPMTestPackage(packages []npmPackageStatus, name string) bool {
	for _, pkg := range packages {
		if pkg.PackageName == name {
			return true
		}
	}
	return false
}

func waitForNPMTestOperation(t *testing.T, cmd *NPMCommand) *npmOperationSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, cmdErr := cmd.Handle(context.Background(), rawNPMCommandPayload(t, map[string]any{
			"action": "scan",
			"hubId":  "hub-a",
		}))
		if cmdErr != nil {
			t.Fatalf("scan operation: %#v", cmdErr)
		}
		operation := resp.(npmCommandResponse).Operation
		if operation != nil && !operation.Running {
			return operation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("operation did not finish")
	return nil
}

type fakeSkillsRunner struct {
	mu      sync.Mutex
	calls   []skillsCommandCall
	results map[string]skillsCommandResult
	blocks  map[string]chan struct{}
}

func newFakeSkillsRunner() *fakeSkillsRunner {
	return &fakeSkillsRunner{results: map[string]skillsCommandResult{}, blocks: map[string]chan struct{}{}}
}

func (f *fakeSkillsRunner) Run(_ context.Context, dir string, name string, args ...string) skillsCommandResult {
	key := skillsCallKey(dir, name, args...)
	f.mu.Lock()
	call := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	f.calls = append(f.calls, call)
	result, ok := f.results[key]
	block := f.blocks[key]
	f.mu.Unlock()
	if block != nil {
		<-block
	}
	if ok {
		return result
	}
	return skillsCommandResult{ExitCode: 0, Stdout: "[]"}
}

func (f *fakeSkillsRunner) set(dir string, name string, args []string, result skillsCommandResult) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.results[skillsCallKey(dir, name, args...)] = result
}

func (f *fakeSkillsRunner) block(dir string, name string, args ...string) chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	ch := make(chan struct{})
	f.blocks[skillsCallKey(dir, name, args...)] = ch
	return ch
}

func (f *fakeSkillsRunner) hasCall(dir string, name string, args ...string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	want := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	for _, call := range f.calls {
		if reflect.DeepEqual(call, want) {
			return true
		}
	}
	return false
}

func skillsCallKey(dir string, name string, args ...string) string {
	return dir + "\x00" + name + "\x00" + strings.Join(args, "\x00")
}

func waitForSkillsCall(t *testing.T, runner *fakeSkillsRunner, dir string, name string, args ...string) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if runner.hasCall(dir, name, args...) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("call not found: dir=%q name=%q args=%#v calls=%#v", dir, name, args, runner.calls)
}

func waitForSkillsOperationDone(t *testing.T, cmd *SkillsCommand) *skillsOperationSnapshot {
	t.Helper()
	var operation *skillsOperationSnapshot
	for i := 0; i < 100; i++ {
		operation = cmd.currentOperationSnapshot()
		if operation != nil && !operation.Running {
			return operation
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("operation still running: %#v", operation)
	return operation
}

func countSkillsCalls(runner *fakeSkillsRunner, dir string, name string, args ...string) int {
	runner.mu.Lock()
	defer runner.mu.Unlock()
	want := skillsCommandCall{Dir: dir, Name: name, Args: append([]string(nil), args...)}
	count := 0
	for _, call := range runner.calls {
		if reflect.DeepEqual(call, want) {
			count++
		}
	}
	return count
}

func assertDirExists(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if !info.IsDir() {
		t.Fatalf("%s is not a directory", path)
	}
}

func TestSkillsCommandInstallsMissingSkillsCLIBeforeRunningCommand(t *testing.T) {
	runner := newFakeSkillsRunner()
	lookPath := func(name string) (string, error) {
		if name == "skills" && runner.hasCall("", "npm", "install", "-g", "skills") {
			return "C:/npm/skills.cmd", nil
		}
		return "", errors.New("not found")
	}
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:    "hub-a",
		LookPath: lookPath,
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK {
		t.Fatalf("response=%#v, want successful scan", body)
	}
	runner.mu.Lock()
	calls := append([]skillsCommandCall(nil), runner.calls...)
	runner.mu.Unlock()
	if len(calls) < 2 {
		t.Fatalf("calls=%#v, want install then skills list", calls)
	}
	if !reflect.DeepEqual(calls[0], skillsCommandCall{Dir: "", Name: "npm", Args: []string{"install", "-g", "skills"}}) {
		t.Fatalf("first call=%#v, want npm install -g skills", calls[0])
	}
	if !reflect.DeepEqual(calls[1], skillsCommandCall{Dir: "", Name: "skills", Args: []string{"list", "-g", "--json"}}) {
		t.Fatalf("second call=%#v, want skills list -g --json", calls[1])
	}
	if runner.hasCall("", "npx", "--yes", "skills", "list", "-g", "--json") {
		t.Fatalf("npx fallback should not run after install succeeds: %#v", calls)
	}
}

func TestSkillsCommandFallsBackToNpxWhenAutoInstallFailsOnce(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	runner := newFakeSkillsRunner()
	runner.set("", "npm", []string{"install", "-g", "skills"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "npm install failed",
		Err:      errors.New("exit status 1"),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:    "hub-a",
		LookPath: func(string) (string, error) { return "", errors.New("not found") },
		Projects: []ProjectInfo{{
			Name:   "WheelMaker",
			Path:   projectRoot,
			Online: true,
		}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK {
		t.Fatalf("response=%#v, want npx fallback scan to succeed", body)
	}
	if got := countSkillsCalls(runner, "", "npm", "install", "-g", "skills"); got != 1 {
		t.Fatalf("npm install calls=%d, want 1", got)
	}
	if !runner.hasCall("", "npx", "--yes", "skills", "list", "-g", "--json") {
		t.Fatalf("global npx fallback not called: %#v", runner.calls)
	}
	if !runner.hasCall(projectRoot, "npx", "--yes", "skills", "list", "--json") {
		t.Fatalf("project npx fallback not called: %#v", runner.calls)
	}
}

func TestSkillsCommandScanReturnsHubAndProjectSkillsWithCategories(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeSkillsLockForTest(t, globalLock, map[string]string{"tdd": "mattpocock-skills"})
	writeSkillsLockForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock-skills"})

	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"tdd","path":"C:/skills/tdd","scope":"global","agents":["Codex"]},{"name":"manual-global","path":"C:/skills/manual-global","scope":"global","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"diagnose","path":"C:/skills/diagnose","scope":"project","agents":["Codex","Claude Code"]},{"name":"manual-project","path":"C:/skills/manual-project","scope":"project","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		GlobalLockPath: globalLock,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: projectRoot, Online: true}},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "scan",
		"hubId":  "hub-a",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle scan error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || body.HubID != "hub-a" || body.HubSkills.Scope != "hub" {
		t.Fatalf("response=%#v", body)
	}
	if len(body.HubSkills.Skills) != 2 || body.HubSkills.Skills[0].Name != "tdd" || body.HubSkills.Skills[1].Name != "manual-global" {
		t.Fatalf("hub skills=%#v", body.HubSkills.Skills)
	}
	if body.HubSkills.Skills[0].Category != "Mattpocock Skills" || body.HubSkills.Skills[0].CategoryKey != "mattpocock-skills" {
		t.Fatalf("hub skill category=%#v", body.HubSkills.Skills[0])
	}
	if body.HubSkills.Skills[1].Category != "General" || body.HubSkills.Skills[1].CategoryKey != "general" {
		t.Fatalf("unlocked hub skill category=%#v", body.HubSkills.Skills[1])
	}
	hubManaged := skillManagedFlagsForTest(t, body.HubSkills.Skills)
	if !hubManaged["tdd"] || hubManaged["manual-global"] {
		t.Fatalf("hub managed flags=%#v", hubManaged)
	}
	if len(body.Projects) != 1 || body.Projects[0].ProjectName != "WheelMaker" || len(body.Projects[0].Skills) != 2 {
		t.Fatalf("projects=%#v", body.Projects)
	}
	if body.Projects[0].Skills[0].Name != "diagnose" || body.Projects[0].Skills[0].Category != "Mattpocock Skills" {
		t.Fatalf("project skill=%#v", body.Projects[0].Skills[0])
	}
	projectManaged := skillManagedFlagsForTest(t, body.Projects[0].Skills)
	if !projectManaged["diagnose"] || projectManaged["manual-project"] {
		t.Fatalf("project managed flags=%#v", projectManaged)
	}
}

func TestSkillsCommandListParsesGroupedSourceOutput(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		Stdout: `Source: mattpocock/skills

Available Skills

Mattpocock Skills
  tdd
    Practice test-driven development
  diagnose
    Debug with a disciplined loop
`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("Handle list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || len(body.Candidates) != 2 {
		t.Fatalf("response=%#v, want two candidates", body)
	}
	if body.Candidates[0].Name != "tdd" || body.Candidates[0].Category != "Mattpocock Skills" || body.Candidates[0].CategoryKey != "mattpocock-skills" {
		t.Fatalf("first candidate=%#v", body.Candidates[0])
	}
	if body.Candidates[1].Name != "diagnose" || !strings.Contains(body.Candidates[1].Description, "Debug") {
		t.Fatalf("second candidate=%#v", body.Candidates[1])
	}
}

func TestSkillsCommandInstallUsesGlobalSymlinkAndProjectCopy(t *testing.T) {
	baseDir := t.TempDir()
	homeRoot := filepath.Join(baseDir, "home")
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(homeRoot, ".claude"))
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:   "hub-a",
		HomeDir: homeRoot,
		Projects: []ProjectInfo{{
			Name:   "WheelMaker",
			Path:   projectRoot,
			Online: true,
		}},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "install",
		"hubId":  "hub-a",
		"scope":  "hub",
		"source": "mattpocock/skills",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("hub install error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	assertDirExists(t, filepath.Join(homeRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(homeRoot, ".claude", "skills"))
	if operation := waitForSkillsOperationDone(t, cmd); operation.Status != "succeeded" {
		t.Fatalf("operation=%#v, want succeeded", operation)
	}
	if runner.hasCall("", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "--copy", "-y") {
		t.Fatalf("global install should not request copy mode: %#v", runner.calls)
	}

	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "WheelMaker",
		"source":      "mattpocock/skills",
		"skills":      []string{"diagnose"},
	}))
	if cmdErr != nil {
		t.Fatalf("project install error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y")
	assertDirExists(t, filepath.Join(projectRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(projectRoot, ".claude", "skills"))
}

func TestSkillsCommandUninstallRemovesAllLinkedAgents(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("uninstall error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y")
}

func TestSkillsCommandUpdateUsesHubAndProjectScopes(t *testing.T) {
	baseDir := t.TempDir()
	homeRoot := filepath.Join(baseDir, "home")
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeSkillsLockSourcesForTest(t, globalLock, map[string]string{"tdd": "mattpocock/skills"})
	writeSkillsLockSourcesForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock/skills"})
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(homeRoot, ".claude"))
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		HomeDir:        homeRoot,
		GlobalLockPath: globalLock,
		Projects:       []ProjectInfo{{Name: "WheelMaker", Path: projectRoot, Online: true}},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "update",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr != nil {
		t.Fatalf("hub update error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	assertDirExists(t, filepath.Join(homeRoot, ".agents", "skills"))
	assertDirExists(t, filepath.Join(homeRoot, ".claude", "skills"))
	waitForSkillsOperationDone(t, cmd)
	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "update",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "WheelMaker",
	}))
	if cmdErr != nil {
		t.Fatalf("project update error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y")
}

func TestSkillsCommandWriteActionsReturnAcceptedOperation(t *testing.T) {
	runner := newFakeSkillsRunner()
	block := runner.block("", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y")
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("uninstall error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || !body.Accepted || body.Operation == nil || !body.Operation.Running {
		t.Fatalf("response=%#v, want accepted running operation", body)
	}
	if body.Operation.Action != "uninstall" || body.Operation.Scope != "hub" || body.Operation.Status != "running" {
		t.Fatalf("operation=%#v, want uninstall hub running", body.Operation)
	}
	close(block)
	waitForSkillsOperationDone(t, cmd)
}

func TestSkillsCommandOnOperationDoneCalledAfterSuccess(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})
	runner.set(projectRoot, "skills", []string{"list", "--json"}, skillsCommandResult{Stdout: "[]", ExitCode: 0})

	callbackDone := make(chan struct{})
	var callbackScope, callbackProject string
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a",
		Projects: []ProjectInfo{{
			Name: "proj",
			Path: projectRoot,
		}},
		OnOperationDone: func(scope, projectName string) {
			callbackScope = scope
			callbackProject = projectName
			close(callbackDone)
		},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "install",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "proj",
		"source":      "mattpocock/skills",
		"skills":      []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}

	select {
	case <-callbackDone:
	case <-time.After(5 * time.Second):
		t.Fatal("OnOperationDone callback not called within timeout")
	}
	if callbackScope != "project" {
		t.Fatalf("callback scope = %q, want %q", callbackScope, "project")
	}
	if callbackProject != "proj" {
		t.Fatalf("callback projectName = %q, want %q", callbackProject, "proj")
	}
}

func TestSkillsCommandOnOperationDoneNotCalledOnFailure(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "install failed",
	})
	runner.set("", "npx", []string{"--yes", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y"}, skillsCommandResult{
		ExitCode: 1,
		Stderr:   "install failed",
	})

	callbackCalled := make(chan struct{}, 1)
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID: "hub-a",
		OnOperationDone: func(scope, projectName string) {
			callbackCalled <- struct{}{}
		},
	})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "install",
		"hubId":  "hub-a",
		"scope":  "hub",
		"source": "mattpocock/skills",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("install error: %#v", cmdErr)
	}

	waitForSkillsOperationDone(t, cmd)

	select {
	case <-callbackCalled:
		t.Fatal("OnOperationDone should not be called on failure")
	case <-time.After(200 * time.Millisecond):
	}
}

func TestSkillsCommandRejectsConcurrentWriteOperations(t *testing.T) {
	runner := newFakeSkillsRunner()
	block := runner.block("", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y")
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "uninstall",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("first uninstall error: %#v", cmdErr)
	}
	waitForSkillsCall(t, runner, "", "skills", "remove", "-g", "--skill", "tdd", "--agent", "codex", "claude-code", "opencode", "github-copilot", "-y")
	_, cmdErr = cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "update",
		"hubId":  "hub-a",
		"scope":  "hub",
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeConflict {
		t.Fatalf("cmdErr=%#v, want CONFLICT", cmdErr)
	}
	close(block)
	waitForSkillsOperationDone(t, cmd)
}

func TestSkillsCommandUpdateCanIncludeOnlineProjectsInOneOperation(t *testing.T) {
	baseDir := t.TempDir()
	projectRoot := filepath.Join(baseDir, "project")
	globalLock := filepath.Join(baseDir, "global-lock.json")
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	writeSkillsLockSourcesForTest(t, globalLock, map[string]string{"tdd": "mattpocock/skills"})
	writeSkillsLockSourcesForTest(t, filepath.Join(projectRoot, "skills-lock.json"), map[string]string{"diagnose": "mattpocock/skills"})
	runner := newFakeSkillsRunner()
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		HomeDir:        filepath.Join(baseDir, "home"),
		GlobalLockPath: globalLock,
		Projects: []ProjectInfo{
			{Name: "WheelMaker", Path: projectRoot, Online: true},
			{Name: "Offline", Path: t.TempDir(), Online: false},
		},
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":          "update",
		"hubId":           "hub-a",
		"scope":           "hub",
		"includeProjects": true,
	}))
	if cmdErr != nil {
		t.Fatalf("update all error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || !body.Accepted || body.Operation == nil || !body.Operation.IncludeProjects {
		t.Fatalf("response=%#v, want accepted includeProjects operation", body)
	}
	waitForSkillsCall(t, runner, "", "skills", "add", "mattpocock/skills", "-g", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "tdd", "-y")
	waitForSkillsCall(t, runner, projectRoot, "skills", "add", "mattpocock/skills", "--agent", "codex", "claude-code", "opencode", "github-copilot", "--skill", "diagnose", "--copy", "-y")
	operation := waitForSkillsOperationDone(t, cmd)
	if operation.Status != "succeeded" || !strings.Contains(operation.Message, "Updated skills") {
		t.Fatalf("operation=%#v, want succeeded update operation", operation)
	}
}

func TestSkillsCommandDetailReturnsSkillContentAndInstallMetadata(t *testing.T) {
	baseDir := t.TempDir()
	skillRoot := filepath.Join(baseDir, "skills", "tdd")
	if err := os.MkdirAll(filepath.Join(skillRoot, "references"), 0o755); err != nil {
		t.Fatalf("mkdir skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte("---\nname: tdd\n---\n# TDD\nPractice test-driven development.\n"), 0o644); err != nil {
		t.Fatalf("write skill md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillRoot, "references", "checklist.md"), []byte("red green refactor"), 0o644); err != nil {
		t.Fatalf("write support file: %v", err)
	}
	globalLock := filepath.Join(baseDir, "global-lock.json")
	writeDetailedSkillsLockForTest(t, globalLock, map[string]detailedLockSkillForTest{
		"tdd": {
			Source:      "mattpocock/skills",
			SourceURL:   "https://github.com/mattpocock/skills.git",
			SourceType:  "github",
			Ref:         "main",
			SkillPath:   "skills/tdd/SKILL.md",
			PluginName:  "mattpocock-skills",
			InstalledAt: "2026-06-01T00:00:00Z",
			UpdatedAt:   "2026-06-02T00:00:00Z",
		},
	})
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{
		Stdout:   fmt.Sprintf(`[{"name":"tdd","path":%q,"scope":"global","agents":["Codex"]}]`, skillRoot),
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{
		HubID:          "hub-a",
		GlobalLockPath: globalLock,
	})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "detail",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"tdd"},
	}))
	if cmdErr != nil {
		t.Fatalf("detail error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if !body.OK || body.Detail == nil {
		t.Fatalf("response=%#v, want detail", body)
	}
	if body.Detail.Name != "tdd" || !strings.Contains(body.Detail.SkillMarkdown, "Practice test-driven development.") {
		t.Fatalf("detail=%#v, want skill content", body.Detail)
	}
	if body.Detail.Source != "mattpocock/skills" || body.Detail.SkillPath != "skills/tdd/SKILL.md" || body.Detail.InstalledAt == "" {
		t.Fatalf("detail metadata=%#v", body.Detail)
	}
	if len(body.Detail.SupportingFiles) != 1 || body.Detail.SupportingFiles[0].RelativePath != "references/checklist.md" {
		t.Fatalf("supporting files=%#v", body.Detail.SupportingFiles)
	}
}

func TestSkillsCommandDetailReturnsNotFoundForUnknownSkill(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"list", "-g", "--json"}, skillsCommandResult{
		Stdout:   `[{"name":"tdd","path":"C:/skills/tdd","scope":"global","agents":["Codex"]}]`,
		ExitCode: 0,
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "detail",
		"hubId":  "hub-a",
		"scope":  "hub",
		"skills": []string{"missing"},
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeNotFound {
		t.Fatalf("cmdErr=%#v, want NOT_FOUND", cmdErr)
	}
}

func TestSkillsCommandRejectsUnsupportedSources(t *testing.T) {
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})
	for _, source := range []string{"../local", "git@github.com:a/b.git", "https://example.com/repo.git"} {
		t.Run(source, func(t *testing.T) {
			_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
				"action": "list",
				"hubId":  "hub-a",
				"source": source,
			}))
			if cmdErr == nil || cmdErr.Code != rp.CodeForbidden {
				t.Fatalf("cmdErr=%#v, want FORBIDDEN", cmdErr)
			}
		})
	}
}

func TestSkillsCommandFailureReturnsStructuredSummary(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		Stderr:   "first problem\n\n" + strings.Repeat("x", 650),
		ExitCode: 7,
		Err:      errors.New("exit status 7"),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if body.OK || !strings.Contains(body.ErrorSummary, "exit code 7") {
		t.Fatalf("response=%#v, want failed summary", body)
	}
	if strings.Contains(body.ErrorSummary, "first problem") {
		t.Fatalf("summary=%q should use last non-empty stderr segment", body.ErrorSummary)
	}
	if len(body.ErrorSummary) > len("exit code 7: ")+500 {
		t.Fatalf("summary length=%d, want truncated segment", len(body.ErrorSummary))
	}
}

func TestSkillsCommandFailureIncludesNpxExecErrorWhenFallbackOutputEmpty(t *testing.T) {
	runner := newFakeSkillsRunner()
	runner.set("", "skills", []string{"add", "mattpocock/skills", "--list"}, skillsCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "skills": executable file not found in $PATH`),
	})
	runner.set("", "npx", []string{"--yes", "skills", "add", "mattpocock/skills", "--list"}, skillsCommandResult{
		ExitCode: -1,
		Err:      errors.New(`exec: "npx": executable file not found in $PATH`),
	})
	cmd := newSkillsCommandWithRunner(runner, skillsCommandConfig{HubID: "hub-a"})

	resp, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action": "list",
		"hubId":  "hub-a",
		"source": "mattpocock/skills",
	}))
	if cmdErr != nil {
		t.Fatalf("list error: %#v", cmdErr)
	}
	body := resp.(skillsCommandResponse)
	if body.OK {
		t.Fatalf("response=%#v, want failed response", body)
	}
	if !strings.Contains(body.ErrorSummary, `exec: "npx"`) {
		t.Fatalf("summary=%q, want npx exec error", body.ErrorSummary)
	}
}

func TestSkillsCommandUnknownProjectReturnsNotFound(t *testing.T) {
	cmd := newSkillsCommandWithRunner(newFakeSkillsRunner(), skillsCommandConfig{HubID: "hub-a"})

	_, cmdErr := cmd.Handle(context.Background(), rawSkillsCommandPayload(t, map[string]any{
		"action":      "update",
		"hubId":       "hub-a",
		"scope":       "project",
		"projectName": "Missing",
	}))
	if cmdErr == nil || cmdErr.Code != rp.CodeNotFound {
		t.Fatalf("cmdErr=%#v, want NOT_FOUND", cmdErr)
	}
}

func rawSkillsCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func writeSkillsLockForTest(t *testing.T, path string, plugins map[string]string) {
	t.Helper()
	type lockSkill struct {
		PluginName string `json:"pluginName"`
	}
	body := struct {
		Version int                  `json:"version"`
		Skills  map[string]lockSkill `json:"skills"`
	}{
		Version: 1,
		Skills:  map[string]lockSkill{},
	}
	for name, pluginName := range plugins {
		body.Skills[name] = lockSkill{PluginName: pluginName}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write lock: %v", err)
	}
}

func skillManagedFlagsForTest(t *testing.T, skills []skillsSkillSnapshot) map[string]bool {
	t.Helper()
	raw, err := json.Marshal(skills)
	if err != nil {
		t.Fatalf("marshal skills: %v", err)
	}
	var items []struct {
		Name    string `json:"name"`
		Managed *bool  `json:"managed"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("unmarshal skills: %v", err)
	}
	out := make(map[string]bool, len(items))
	for _, item := range items {
		if item.Managed == nil {
			t.Fatalf("skill %q is missing managed flag in %s", item.Name, string(raw))
		}
		out[item.Name] = *item.Managed
	}
	return out
}

func writeSkillsLockSourcesForTest(t *testing.T, path string, sources map[string]string) {
	t.Helper()
	type lockSkill struct {
		Source     string `json:"source"`
		SourceType string `json:"sourceType"`
	}
	body := struct {
		Version int                  `json:"version"`
		Skills  map[string]lockSkill `json:"skills"`
	}{
		Version: 1,
		Skills:  map[string]lockSkill{},
	}
	for name, source := range sources {
		body.Skills[name] = lockSkill{Source: source, SourceType: "github"}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write lock: %v", err)
	}
}

type detailedLockSkillForTest struct {
	Source      string `json:"source"`
	SourceURL   string `json:"sourceUrl"`
	SourceType  string `json:"sourceType"`
	Ref         string `json:"ref"`
	SkillPath   string `json:"skillPath"`
	PluginName  string `json:"pluginName"`
	InstalledAt string `json:"installedAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func writeDetailedSkillsLockForTest(t *testing.T, path string, skills map[string]detailedLockSkillForTest) {
	t.Helper()
	body := struct {
		Version int                                 `json:"version"`
		Skills  map[string]detailedLockSkillForTest `json:"skills"`
	}{
		Version: 3,
		Skills:  skills,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal detailed lock: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write detailed lock: %v", err)
	}
}

func TestUpdateQueryReadsOnlyInstalledReleaseAndLocalJobState(t *testing.T) {
	baseDir := t.TempDir()
	installed := installedRelease{
		SchemaVersion: 2,
		Version:       "v1.22",
		PublishedAt:   "2026-07-15T09:00:00Z",
		SourceSHA:     strings.Repeat("a", 40),
		ManifestSHA:   strings.Repeat("c", 64),
		InstalledAt:   "2026-07-15T09:05:00Z",
	}
	writeInstalledReleaseForTest(t, baseDir, installed)
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})
	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})

	if got.Status != "installed" || got.Installed == nil || got.Installed.Version != "v1.22" {
		t.Fatalf("response=%+v", got)
	}
	if !got.OK || !got.CanRequest {
		t.Fatalf("response=%+v, want installed requestable Hub", got)
	}
	if got.Stable != nil || got.PublishStatus != nil {
		t.Fatalf("response includes global metadata: %+v", got)
	}
}

func TestUpdateQueryRejectsInvalidInstalledRelease(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "release.json"), []byte("{\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := newUpdateCommandWithDependencies(baseDir, &fakeUpdateTrigger{})

	got := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if got.Status != "checking_failed" || got.ErrorCode != "installed_release_invalid" {
		t.Fatalf("response=%+v", got)
	}
	if got.CanRequest {
		t.Fatalf("canRequestUpdate=true for invalid installed release")
	}
}

func TestUpdateRequestCreatesOneQueuedJob(t *testing.T) {
	baseDir := t.TempDir()
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)
	cmd.now = func() time.Time {
		return time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC)
	}

	first := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	second := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	if first.JobID == "" || first.JobID != second.JobID || trigger.Calls() != 1 {
		t.Fatalf("first=%+v second=%+v calls=%d", first, second, trigger.Calls())
	}
	if !first.Accepted || first.Job == nil || first.Job.State != "queued" {
		t.Fatalf("first=%+v, want accepted queued job", first)
	}

	lockRaw, err := os.ReadFile(filepath.Join(baseDir, "staging", "lock.json"))
	if err != nil {
		t.Fatalf("read lock: %v", err)
	}
	var lock updateLease
	if err := json.Unmarshal(lockRaw, &lock); err != nil {
		t.Fatalf("parse lock: %v", err)
	}
	if lock.JobID != first.JobID || lock.Owner != "web" || lock.State != "queued" {
		t.Fatalf("lock=%+v", lock)
	}
	statusRaw, err := os.ReadFile(filepath.Join(baseDir, "staging", "status.json"))
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	var status updateJobStatus
	if err := json.Unmarshal(statusRaw, &status); err != nil {
		t.Fatalf("parse status: %v", err)
	}
	if status.JobID != first.JobID || status.State != "queued" {
		t.Fatalf("status=%+v", status)
	}
}

func TestUpdateQueryReportsActiveJobWithoutRetriggering(t *testing.T) {
	baseDir := t.TempDir()
	writeInstalledReleaseForTest(t, baseDir, installedRelease{
		SchemaVersion: 2,
		Version:       "v1.22",
		PublishedAt:   "2026-07-15T09:00:00Z",
		SourceSHA:     strings.Repeat("a", 40),
		ManifestSHA:   strings.Repeat("c", 64),
		InstalledAt:   "2026-07-15T09:05:00Z",
	})
	trigger := &fakeUpdateTrigger{}
	cmd := newUpdateCommandWithDependencies(baseDir, trigger)

	requested := handleUpdateForTest(t, cmd, map[string]any{
		"action": "request",
		"hubId":  "hub-a",
	})
	queried := handleUpdateForTest(t, cmd, map[string]any{
		"action": "query",
		"hubId":  "hub-a",
	})
	if queried.Job == nil || queried.Job.JobID != requested.JobID || queried.Job.State != "queued" {
		t.Fatalf("requested=%+v queried=%+v", requested, queried)
	}
	if queried.CanRequest {
		t.Fatalf("canRequestUpdate=true while job is active")
	}
	if trigger.Calls() != 1 {
		t.Fatalf("trigger calls=%d, want 1", trigger.Calls())
	}
}

func TestUpdaterTriggerSpecUsesKnownCurrentUserRuntime(t *testing.T) {
	windows := updaterTriggerSpec("windows", "501")
	if windows.Name != "powershell" || !strings.Contains(strings.Join(windows.Args, " "), "Start-ScheduledTask") || !strings.Contains(strings.Join(windows.Args, " "), "WheelMakerUpdater") {
		t.Fatalf("windows spec=%+v", windows)
	}
	linux := updaterTriggerSpec("linux", "501")
	if linux.Name != "systemctl" || !reflect.DeepEqual(linux.Args, []string{"--user", "--no-block", "start", "wheelmaker-updater.service"}) {
		t.Fatalf("linux spec=%+v", linux)
	}
	darwin := updaterTriggerSpec("darwin", "501")
	if darwin.Name != "launchctl" || !strings.Contains(strings.Join(darwin.Args, " "), "gui/501/com.wheelmaker.updater") {
		t.Fatalf("darwin spec=%+v", darwin)
	}
}

const ()

func handleUpdateForTest(t *testing.T, cmd *UpdateCommand, payload map[string]any) updateCommandResponse {
	t.Helper()
	resp, cmdErr := cmd.Handle(context.Background(), rawUpdateCommandPayload(t, payload))
	if cmdErr != nil {
		t.Fatalf("Handle update: %v", cmdErr)
	}
	out, ok := resp.(updateCommandResponse)
	if !ok {
		t.Fatalf("response=%T, want updateCommandResponse", resp)
	}
	return out
}

func rawUpdateCommandPayload(t *testing.T, payload map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func writeInstalledReleaseForTest(t *testing.T, baseDir string, release installedRelease) {
	t.Helper()
	raw, err := json.Marshal(release)
	if err != nil {
		t.Fatalf("marshal installed release: %v", err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "release.json"), append(raw, '\n'), 0o644); err != nil {
		t.Fatalf("write installed release: %v", err)
	}
}

type fakeUpdateTrigger struct {
	mu    sync.Mutex
	calls int
	err   error
}

func (f *fakeUpdateTrigger) Trigger(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.err
}

func (f *fakeUpdateTrigger) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}
