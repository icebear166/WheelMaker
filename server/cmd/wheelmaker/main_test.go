package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/swm8023/wheelmaker/internal/serverdata"
	"github.com/swm8023/wheelmaker/internal/shared"
)

func TestWheelmakerLogDir(t *testing.T) {
	home := filepath.Clean(`C:\Users\swm`)
	got := wheelmakerLogDir(home)
	want := filepath.Join(home, ".wheelmaker", "log")
	if got != want {
		t.Fatalf("wheelmakerLogDir()=%q, want %q", got, want)
	}
}

func TestDefaultRegistryListenAddressIsLoopback(t *testing.T) {
	if defaultRegistryAddr != "127.0.0.1:9630" {
		t.Fatalf("defaultRegistryAddr=%q, want loopback", defaultRegistryAddr)
	}
}

func TestRunFlickerBridgeSelfTestMode(t *testing.T) {
	originalArgs := os.Args
	t.Cleanup(func() { os.Args = originalArgs })
	os.Args = []string{"wheelmaker", "--flicker-bridge", "--self-test=settings-defaults"}
	if err := run(); err != nil {
		t.Fatalf("run flicker bridge self-test mode: %v", err)
	}
}

func TestRunFlickerBridgeV2SelfTestMode(t *testing.T) {
	originalArgs := os.Args
	t.Cleanup(func() { os.Args = originalArgs })
	os.Args = []string{"wheelmaker", "--flicker-bridge-v2", "--self-test=settings"}
	if err := run(); err != nil {
		t.Fatalf("run Flicker Bridge V2 self-test mode: %v", err)
	}
}

func TestLoadValidatedRuntimeConfigRejectsUnsafeRegistryToken(t *testing.T) {
	for _, token := range []string{"", "wheelmaker-local-token"} {
		t.Run(token, func(t *testing.T) {
			baseDir := t.TempDir()
			writeRuntimeConfigForTest(t, baseDir, token)
			_, err := loadValidatedRuntimeConfig(baseDir)
			if err == nil || !strings.Contains(err.Error(), "registry.token") {
				t.Fatalf("loadValidatedRuntimeConfig() error=%v, want registry.token rejection", err)
			}
		})
	}
}

func TestLoadValidatedRuntimeConfigAcceptsCustomRegistryToken(t *testing.T) {
	baseDir := t.TempDir()
	writeRuntimeConfigForTest(t, baseDir, "user-supplied-random-token")
	cfg, err := loadValidatedRuntimeConfig(baseDir)
	if err != nil {
		t.Fatalf("loadValidatedRuntimeConfig(): %v", err)
	}
	if cfg.Registry.Token != "user-supplied-random-token" {
		t.Fatalf("registry.token=%q", cfg.Registry.Token)
	}
}

func TestRunRegistryConfigIncludesStateDir(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), ".wheelmaker")
	userHome := filepath.Join(t.TempDir(), "home")
	cfg := registryServerConfig("127.0.0.1:9630", "token", stateDir, userHome)
	if cfg.Addr != "127.0.0.1:9630" || cfg.Token != "token" || cfg.StateDir != stateDir || cfg.LogDir != filepath.Join(stateDir, "log") || cfg.ServerData == nil {
		t.Fatalf("registryServerConfig()=%+v", cfg)
	}
	wantGatewayConfig := filepath.Join(userHome, ".wheelmaker", "gateway", "config.json")
	if cfg.GatewayConfigPath != wantGatewayConfig {
		t.Fatalf("GatewayConfigPath=%q, want %q", cfg.GatewayConfigPath, wantGatewayConfig)
	}
	if err := cfg.ServerData.UpdateSecret(serverdata.SecretDeepSeek, "set", "short", time.Now()); err != nil {
		t.Fatalf("ServerData.UpdateSecret(): %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "db", "server-data.json")); err != nil {
		t.Fatalf("server data path: %v", err)
	}
}

func writeRuntimeConfigForTest(t *testing.T, baseDir string, token string) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"projects": []any{},
		"registry": map[string]any{"token": token},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "config.json"), raw, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
}

func TestSanitizeWorkerArgs(t *testing.T) {
	in := []string{"-d", "--daemon-worker", "--hub-worker", "--registry-worker", "--foo", "bar"}
	got := sanitizeWorkerArgs(in)
	if len(got) != 2 || got[0] != "--foo" || got[1] != "bar" {
		t.Fatalf("sanitizeWorkerArgs()=%v", got)
	}
}

func TestWorkerArgsWithStateDirAddsExplicitDir(t *testing.T) {
	got := workerArgsWithStateDir([]string{"--foo", "bar"}, `C:\Users\me\.wheelmaker`)
	want := []string{"--foo", "bar", "--dir", `C:\Users\me\.wheelmaker`}
	if len(got) != len(want) {
		t.Fatalf("workerArgsWithStateDir()=%v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("workerArgsWithStateDir()=%v, want %v", got, want)
		}
	}
}

func TestGuardianWorkerSpecsSkipRegistryWorkerWhenRegistryListenDisabled(t *testing.T) {
	cfg := shared.RegistryConfig{
		Listen: false,
		Server: "wss://registry.example/ws",
		Port:   28800,
	}
	specs := guardianWorkerSpecs([]string{"--foo", "bar"}, cfg, false)

	if len(specs) != 1 {
		t.Fatalf("guardianWorkerSpecs() len=%d want 1 specs=%v", len(specs), specs)
	}
	if specs[0].markerFlag != hubWorkerArg {
		t.Fatalf("guardianWorkerSpecs()[0].markerFlag=%q want %q", specs[0].markerFlag, hubWorkerArg)
	}
}

func TestGuardianWorkerSpecsForceLocalRegistryForLocalDev(t *testing.T) {
	cfg := shared.RegistryConfig{
		Listen: false,
		Server: "wss://registry.example/ws",
		Port:   28800,
	}
	specs := guardianWorkerSpecs([]string{"--dir", `C:\Users\me\.wheelmaker`}, cfg, true)

	if len(specs) != 2 {
		t.Fatalf("guardianWorkerSpecs() len=%d want 2 specs=%v", len(specs), specs)
	}
	for _, spec := range specs {
		if !slices.Contains(spec.args, localDevArg) {
			t.Fatalf("guardianWorkerSpecs() args=%v missing %q", spec.args, localDevArg)
		}
	}
	if specs[1].markerFlag != registryWorkerArg {
		t.Fatalf("guardianWorkerSpecs()[1].markerFlag=%q want %q", specs[1].markerFlag, registryWorkerArg)
	}
}

func TestLocalDevRuntimeConfigUsesFormalDataWithLoopbackRegistry(t *testing.T) {
	original := &shared.AppConfig{Registry: shared.RegistryConfig{
		Listen: false,
		Server: "wss://registry.example/ws",
		Port:   28800,
		Token:  "formal-token",
		HubID:  "formal-hub",
	}}

	got := localDevRuntimeConfig(original)

	if got == original {
		t.Fatal("localDevRuntimeConfig() mutated the loaded formal config")
	}
	if got.Registry.Server != "127.0.0.1" || got.Registry.Port != 9630 || !got.Registry.Listen {
		t.Fatalf("localDevRuntimeConfig().Registry=%+v", got.Registry)
	}
	if got.Registry.Token != "formal-token" || got.Registry.HubID != "formal-hub" {
		t.Fatalf("localDevRuntimeConfig() did not preserve formal identity: %+v", got.Registry)
	}
	if original.Registry.Server != "wss://registry.example/ws" || original.Registry.Listen {
		t.Fatalf("formal config was mutated: %+v", original.Registry)
	}
}

func TestChooseKeepPID(t *testing.T) {
	workers := []daemonProcess{{PID: 42}, {PID: 17}, {PID: 29}}
	if got := chooseKeepPID(workers, 29); got != 29 {
		t.Fatalf("chooseKeepPID preferred mismatch: got=%d want=29", got)
	}
	if got := chooseKeepPID(workers, 999); got != 17 {
		t.Fatalf("chooseKeepPID fallback mismatch: got=%d want=17", got)
	}
}

func TestParseWorkerProcessesFromPSAcceptsPathComm(t *testing.T) {
	out := []byte(`123 /Users/me/.wheelmaker/bin/wheelmaker /Users/me/.wheelmaker/bin/wheelmaker --hub-worker
124 /Users/me/.wheelmaker/bin/wheelmaker /Users/me/.wheelmaker/bin/wheelmaker --registry-worker
125 /usr/bin/node /usr/bin/node /Users/me/.wheelmaker/deploy.mjs update
126 bash bash -lc wheelmaker --hub-worker
`)

	workers, err := parseWorkerProcessesFromPS(out, "wheelmaker", "--hub-worker")
	if err != nil {
		t.Fatalf("parseWorkerProcessesFromPS() error = %v", err)
	}
	if len(workers) != 1 || workers[0].PID != 123 {
		t.Fatalf("workers=%#v, want only pid 123", workers)
	}
}

func TestParseWorkerProcessesFromPSAcceptsTruncatedDarwinComm(t *testing.T) {
	out := []byte(`123 /Users/me/.whe /Users/me/.wheelmaker/bin/wheelmaker --hub-worker
124 /Users/me/.whe /Users/me/.wheelmaker/bin/wheelmaker --registry-worker
125 /usr/bin/nod /usr/bin/node /Users/me/.wheelmaker/deploy.mjs update
126 bash bash -lc wheelmaker --hub-worker
`)

	workers, err := parseWorkerProcessesFromPS(out, "wheelmaker", "--hub-worker")
	if err != nil {
		t.Fatalf("parseWorkerProcessesFromPS() error = %v", err)
	}
	if len(workers) != 1 || workers[0].PID != 123 {
		t.Fatalf("workers=%#v, want only pid 123", workers)
	}
}

func TestConfigureWorkerCommandIOToDevNull(t *testing.T) {
	cmd := exec.Command("wheelmaker.exe", "--hub-worker")
	restore, err := configureWorkerCommandIO(cmd)
	if err != nil {
		t.Fatalf("configureWorkerCommandIO() error = %v", err)
	}
	defer restore()

	stdoutFile, ok := cmd.Stdout.(*os.File)
	if !ok {
		t.Fatalf("stdout sink type = %T, want *os.File", cmd.Stdout)
	}
	stderrFile, ok := cmd.Stderr.(*os.File)
	if !ok {
		t.Fatalf("stderr sink type = %T, want *os.File", cmd.Stderr)
	}
	if stdoutFile.Name() != os.DevNull {
		t.Fatalf("stdout sink = %q, want %q", stdoutFile.Name(), os.DevNull)
	}
	if stderrFile.Name() != os.DevNull {
		t.Fatalf("stderr sink = %q, want %q", stderrFile.Name(), os.DevNull)
	}
}

func TestStartManagedRuntimeRestartStartsDetachedNodeCommand(t *testing.T) {
	originalStart := startManagedRuntimeRestartCommand
	originalRelease := releaseManagedRuntimeRestartProcess
	t.Cleanup(func() {
		startManagedRuntimeRestartCommand = originalStart
		releaseManagedRuntimeRestartProcess = originalRelease
	})

	var started *exec.Cmd
	process := &os.Process{}
	startManagedRuntimeRestartCommand = func(cmd *exec.Cmd) error {
		started = cmd
		cmd.Process = process
		return nil
	}
	var released *os.Process
	releaseManagedRuntimeRestartProcess = func(candidate *os.Process) error {
		released = candidate
		return nil
	}

	stateDir := filepath.Join(t.TempDir(), ".wheelmaker")
	if err := startManagedRuntimeRestart(stateDir); err != nil {
		t.Fatalf("startManagedRuntimeRestart() error = %v", err)
	}
	if started == nil {
		t.Fatal("runtime restart command was not started")
	}
	wantArgs := []string{"node", filepath.Join(stateDir, "deploy.mjs"), "runtime", "restart"}
	if !slices.Equal(started.Args, wantArgs) {
		t.Fatalf("command args = %v, want %v", started.Args, wantArgs)
	}
	if started.Dir != stateDir {
		t.Fatalf("command dir = %q, want %q", started.Dir, stateDir)
	}
	stdoutFile, ok := started.Stdout.(*os.File)
	if !ok || stdoutFile.Name() != os.DevNull {
		t.Fatalf("stdout = %#v, want %q sink", started.Stdout, os.DevNull)
	}
	stderrFile, ok := started.Stderr.(*os.File)
	if !ok || stderrFile.Name() != os.DevNull {
		t.Fatalf("stderr = %#v, want %q sink", started.Stderr, os.DevNull)
	}
	if released != process {
		t.Fatalf("released process = %p, want %p", released, process)
	}
}

func TestRedirectProcessStdioToDevNull(t *testing.T) {
	oldStdout := os.Stdout
	oldStderr := os.Stderr

	restore, err := redirectProcessStdioToDevNull()
	if err != nil {
		t.Fatalf("redirectProcessStdioToDevNull() error = %v", err)
	}
	if os.Stdout == oldStdout {
		t.Fatalf("stdout file was not replaced")
	}
	if os.Stderr == oldStderr {
		t.Fatalf("stderr file was not replaced")
	}
	if os.Stdout.Name() != os.DevNull {
		t.Fatalf("stdout sink = %q, want %q", os.Stdout.Name(), os.DevNull)
	}
	if os.Stderr.Name() != os.DevNull {
		t.Fatalf("stderr sink = %q, want %q", os.Stderr.Name(), os.DevNull)
	}

	restore()
	if os.Stdout != oldStdout {
		t.Fatalf("stdout not restored")
	}
	if os.Stderr != oldStderr {
		t.Fatalf("stderr not restored")
	}
}
