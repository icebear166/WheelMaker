package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unicode/utf16"
)

func parseDeployArgsForTest(t *testing.T, args []string) deployConfig {
	t.Helper()
	cfg, err := parseArgs(args)
	if err != nil {
		t.Fatalf("parseArgs(%v): %v", args, err)
	}
	return cfg
}

func runDeployCLIForTest(t *testing.T, args []string) error {
	t.Helper()
	return run(context.Background(), args)
}

func TestParseDeployDefaults(t *testing.T) {
	cfg := parseDeployArgsForTest(t, []string{"deploy", "--repo", "C:/repo", "--bin", "C:/bin", "--time", "04:30"})
	if cfg.Mode != modeDeploy || cfg.RepoRoot != "C:/repo" || cfg.InstallDir != "C:/bin" || cfg.UpdaterTime != "04:30" {
		t.Fatalf("cfg=%+v", cfg)
	}
	if cfg.NoPull || cfg.NoNPM || cfg.NoBuild || cfg.NoInstall || cfg.NoRestart || cfg.NoConfig || cfg.NoWeb || cfg.NoUpdater {
		t.Fatalf("deploy defaults disabled work: %+v", cfg)
	}
}

func TestParseRuntimeFlag(t *testing.T) {
	cfg := parseDeployArgsForTest(t, []string{"deploy", "--runtime", "service"})
	if cfg.RuntimeMode != "service" {
		t.Fatalf("runtime=%q, want service", cfg.RuntimeMode)
	}
	cfg = parseDeployArgsForTest(t, []string{"service", "--runtime", "asuser", "restart"})
	if cfg.RuntimeMode != "asuser" || cfg.ServiceAction != "restart" {
		t.Fatalf("cfg=%+v, want asuser runtime restart action", cfg)
	}
}

func TestParseRejectsInvalidRuntimeFlag(t *testing.T) {
	_, err := parseArgs([]string{"deploy", "--runtime", "daemon"})
	if err == nil || !strings.Contains(err.Error(), "runtime") {
		t.Fatalf("parse invalid runtime err=%v, want runtime error", err)
	}
}

func TestParseUpdateDefaults(t *testing.T) {
	cfg := parseDeployArgsForTest(t, []string{"update"})
	if cfg.Mode != modeUpdate {
		t.Fatalf("mode=%v", cfg.Mode)
	}
	if !cfg.NoPull || !cfg.NoConfig || !cfg.NoUpdater {
		t.Fatalf("update should imply no pull/config/updater: %+v", cfg)
	}
}

func TestParseBootstrapUpdatePublishesWebByDefault(t *testing.T) {
	cfg := parseDeployArgsForTest(t, []string{"bootstrap-update"})
	if cfg.Mode != modeBootstrapUpdate {
		t.Fatalf("mode=%v", cfg.Mode)
	}
	if cfg.NoWeb {
		t.Fatalf("bootstrap-update should publish web by default: %+v", cfg)
	}
	explicitNoWeb := parseDeployArgsForTest(t, []string{"bootstrap-update", "--no-web"})
	if !explicitNoWeb.NoWeb {
		t.Fatalf("bootstrap-update --no-web should disable web publish: %+v", explicitNoWeb)
	}
}

func TestReservedCommandsReturnNotImplemented(t *testing.T) {
	for _, args := range [][]string{{"upgrade-updater"}, {"service", "uninstall"}} {
		err := runDeployCLIForTest(t, args)
		if err == nil || !strings.Contains(err.Error(), "not implemented") {
			t.Fatalf("%v err=%v, want not implemented", args, err)
		}
	}
}

type testRunner struct {
	events    *[]string
	gitStatus string
}

func (r testRunner) Run(_ context.Context, dir string, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	switch {
	case name == "git" && strings.Join(args, " ") == "branch --show-current":
		return "main", nil
	case name == "git" && strings.Join(args, " ") == "rev-parse HEAD":
		return "abc123", nil
	case name == "git" && strings.Join(args, " ") == "status --porcelain":
		if r.gitStatus != "" {
			*r.events = append(*r.events, "git "+strings.Join(args, " "))
		}
		return r.gitStatus, nil
	case name == "git" && len(args) >= 1 && args[0] == "stash":
		*r.events = append(*r.events, "git "+strings.Join(args, " "))
	case name == "git" && len(args) >= 1 && args[0] == "pull":
		*r.events = append(*r.events, "git "+strings.Join(args, " "))
	case name == "npm":
		*r.events = append(*r.events, "npm "+strings.Join(args, " "))
	case name == "powershell" && strings.Contains(strings.Join(args, " "), "-NonInteractive") && strings.Contains(strings.Join(args, " "), legacyWindowsMonitorService):
		return "", nil
	case name == "go" && len(args) >= 4 && args[0] == "build":
		out := goBuildOutputArgForTest(args)
		*r.events = append(*r.events, "go build "+buildLabelFromOutput(out))
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(out, []byte(buildLabelFromOutput(out)), 0o755); err != nil {
			return "", err
		}
	case strings.Contains(filepath.Base(name), "wheelmaker-deploy-next"):
		*r.events = append(*r.events, "run wheelmaker-deploy-next "+strings.Join(args, " "))
	case name == "exec":
		*r.events = append(*r.events, "exec "+strings.Join(args, " "))
	default:
		*r.events = append(*r.events, dir+"|"+line)
	}
	return "", nil
}

type testServices struct {
	events *[]string
}

func (s testServices) CheckDeployPrerequisites(context.Context) error { return nil }
func (s testServices) Configure(context.Context) error {
	*s.events = append(*s.events, "service configure")
	return nil
}
func (s testServices) Start(_ context.Context, includeUpdater bool) error {
	if includeUpdater {
		*s.events = append(*s.events, "service start all")
	} else {
		*s.events = append(*s.events, "service start hub-monitor")
	}
	return nil
}
func (s testServices) Stop(_ context.Context, includeUpdater bool) error {
	if includeUpdater {
		*s.events = append(*s.events, "service stop all")
	} else {
		*s.events = append(*s.events, "service stop hub-monitor")
	}
	return nil
}
func (s testServices) PrepareInstall(_ context.Context, includeUpdater bool) error {
	if includeUpdater {
		*s.events = append(*s.events, "service prepare install all")
	} else {
		*s.events = append(*s.events, "service prepare install hub-monitor")
	}
	return nil
}
func (s testServices) Restart(context.Context, bool) error { return nil }
func (s testServices) Status(context.Context) error        { return nil }

type capturedCommand struct {
	name string
	args []string
}

type legacyMonitorRunner struct {
	calls  []capturedCommand
	err    error
	output string
}

func (r *legacyMonitorRunner) Run(_ context.Context, _ string, name string, args ...string) (string, error) {
	r.calls = append(r.calls, capturedCommand{name: name, args: append([]string(nil), args...)})
	if r.err != nil {
		return "", r.err
	}
	return r.output, nil
}

type legacyElevationTestRunner struct {
	testRunner
}

func (r legacyElevationTestRunner) Run(ctx context.Context, dir string, name string, args ...string) (string, error) {
	if name == "powershell" && strings.Contains(strings.Join(args, " "), legacyWindowsMonitorService) {
		return "legacy monitor cleanup requires elevation", nil
	}
	return r.testRunner.Run(ctx, dir, name, args...)
}

func TestMigrateLegacyMonitorConfigRemovesOnlyTopLevelMonitor(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	raw := []byte("{\n  \"projects\": [],\n  \"registry\": {\"token\": \"custom-short\"},\n  \"monitor\": {\"server\": \"127.0.0.1\", \"port\": 9631, \"legacy\": true},\n  \"log\": {\"level\": \"warn\"}\n}\n")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	changed, err := migrateLegacyMonitorConfig(path)
	if err != nil || !changed {
		t.Fatalf("migrate changed=%v err=%v", changed, err)
	}
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(first, &root); err != nil {
		t.Fatal(err)
	}
	if _, ok := root["monitor"]; ok {
		t.Fatalf("migrated config still contains monitor: %s", first)
	}
	for _, key := range []string{"projects", "registry", "log"} {
		if _, ok := root[key]; !ok {
			t.Fatalf("migrated config lost %q: %s", key, first)
		}
	}
	var registry struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(root["registry"], &registry); err != nil || registry.Token != "custom-short" {
		t.Fatalf("registry=%+v err=%v", registry, err)
	}

	changed, err = migrateLegacyMonitorConfig(path)
	if err != nil || changed {
		t.Fatalf("second migrate changed=%v err=%v", changed, err)
	}
	second, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != string(first) {
		t.Fatalf("second migration changed bytes\nfirst=%q\nsecond=%q", first, second)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("config mode=%o, want 600", got)
		}
	}
}

func TestMigrateLegacyMonitorConfigDoesNotOverwriteMalformedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	raw := []byte(`{"monitor":`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if changed, err := migrateLegacyMonitorConfig(path); err == nil || changed {
		t.Fatalf("migrate malformed changed=%v err=%v", changed, err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(raw) {
		t.Fatalf("malformed config overwritten: %q", got)
	}
}

func TestCleanupLegacyMonitorCommandsAndFiles(t *testing.T) {
	for _, platform := range []string{"windows", "linux", "darwin"} {
		t.Run(platform, func(t *testing.T) {
			root := t.TempDir()
			cfg := deployConfig{
				HomeDir:    filepath.Join(root, "home"),
				InstallDir: filepath.Join(root, "home", ".wheelmaker", "bin"),
			}
			if err := os.MkdirAll(cfg.InstallDir, 0o755); err != nil {
				t.Fatal(err)
			}
			binary := filepath.Join(cfg.InstallDir, legacyMonitorBinaryName(platform))
			if err := os.WriteFile(binary, []byte("legacy"), 0o755); err != nil {
				t.Fatal(err)
			}
			runner := &legacyMonitorRunner{}
			if err := cleanupLegacyMonitor(context.Background(), cfg, runner, platform); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
			if _, err := os.Stat(binary); !os.IsNotExist(err) {
				t.Fatalf("legacy binary remains: %v", err)
			}
			joined := ""
			for _, call := range runner.calls {
				joined += call.name + " " + strings.Join(call.args, " ") + "\n"
			}
			switch platform {
			case "windows":
				for _, needle := range []string{"powershell", "WheelMakerMonitor", "Stop-Service", "sc.exe delete"} {
					if !strings.Contains(joined, needle) {
						t.Fatalf("windows cleanup missing %q:\n%s", needle, joined)
					}
				}
			case "linux":
				for _, needle := range []string{"systemctl --user disable --now wheelmaker-monitor.service", "systemctl --user daemon-reload"} {
					if !strings.Contains(joined, needle) {
						t.Fatalf("linux cleanup missing %q:\n%s", needle, joined)
					}
				}
			case "darwin":
				if !strings.Contains(joined, "launchctl bootout") || !strings.Contains(joined, "com.wheelmaker.monitor") {
					t.Fatalf("darwin cleanup commands:\n%s", joined)
				}
			}
			if err := cleanupLegacyMonitor(context.Background(), cfg, runner, platform); err != nil {
				t.Fatalf("second cleanup: %v", err)
			}
		})
	}
}

func TestCleanupLegacyMonitorPreservesBinaryWhenWindowsServiceRequiresElevation(t *testing.T) {
	root := t.TempDir()
	cfg := deployConfig{
		HomeDir:    filepath.Join(root, "home"),
		InstallDir: filepath.Join(root, "home", ".wheelmaker", "bin"),
	}
	if err := os.MkdirAll(cfg.InstallDir, 0o755); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(cfg.InstallDir, legacyMonitorBinaryName("windows"))
	if err := os.WriteFile(binary, []byte("legacy"), 0o755); err != nil {
		t.Fatal(err)
	}
	runner := &legacyMonitorRunner{output: "legacy monitor cleanup requires elevation"}

	err := cleanupLegacyMonitor(context.Background(), cfg, runner, "windows")
	if err == nil || err.Error() != "legacy monitor cleanup requires elevation" {
		t.Fatalf("cleanup err=%v, want elevation requirement", err)
	}
	if _, err := os.Stat(binary); err != nil {
		t.Fatalf("legacy binary should be preserved: %v", err)
	}
}

func TestCleanupLegacyMonitorRejectsBinaryOutsideInstallDirectory(t *testing.T) {
	root := t.TempDir()
	cfg := deployConfig{HomeDir: root, InstallDir: filepath.Join(root, "bin")}
	if err := os.MkdirAll(cfg.InstallDir, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside")
	if err := os.WriteFile(outside, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removeLegacyMonitorBinary(cfg.InstallDir, outside); err == nil {
		t.Fatal("outside binary removal succeeded")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("outside file changed: %v", err)
	}
}

type captureBuildRunner struct {
	calls *[]capturedCommand
}

func (r captureBuildRunner) Run(_ context.Context, _ string, name string, args ...string) (string, error) {
	*r.calls = append(*r.calls, capturedCommand{name: name, args: append([]string(nil), args...)})
	return "", nil
}

type deployHarness struct {
	home   string
	cfg    deployConfig
	deps   deployDeps
	events *[]string
}

func newDeployHarness(t *testing.T) *deployHarness {
	t.Helper()
	root := t.TempDir()
	home := filepath.Join(root, "home")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(repo, "server", "cmd"), 0o755); err != nil {
		t.Fatalf("mkdir repo: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(repo, "app"), 0o755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	events := []string{}
	cfg := deployConfig{
		Mode:        modeDeploy,
		RepoRoot:    repo,
		HomeDir:     home,
		InstallDir:  filepath.Join(home, ".wheelmaker", "bin"),
		UpdaterTime: "03:00",
	}
	return &deployHarness{
		home:   home,
		cfg:    cfg,
		events: &events,
		deps: deployDeps{
			Runner:   testRunner{events: &events},
			Services: testServices{events: &events},
			Now:      func() time.Time { return time.Date(2026, 5, 30, 1, 2, 3, 0, time.UTC) },
			Record:   func(event string) { events = append(events, event) },
		},
	}
}

func TestDeployPipelineOrder(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeDeploy
	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}
	want := []string{
		"git pull --ff-only origin main",
		"npm ci --include=dev",
		"go build wheelmaker",
		"go build wheelmaker-updater",
		"go build wheelmaker-deploy",
		"npm run build:web:release",
		"service prepare install all",
		"install wheelmaker",
		"install wheelmaker-updater",
		"install wheelmaker-deploy",
		"write config",
		"write wrappers",
		"service configure",
		"service start all",
		"write release",
		"cleanup artifacts",
	}
	if diff := cmpStringSlices(*h.events, want); diff != "" {
		t.Fatal(diff)
	}
	for _, name := range []string{"wheelmaker", "wheelmaker-updater", "wheelmaker-deploy"} {
		assertFileContains(t, filepath.Join(h.cfg.InstallDir, binaryName(name)), name)
	}
	assertFileMissing(t, filepath.Join(h.cfg.InstallDir, binaryName("wheelmaker-monitor")))
}

func TestDeployPreparesInstallWhenRestartIsSkipped(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeDeploy
	h.cfg.NoRestart = true

	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}

	assertEventsContainInOrder(t, *h.events,
		"service prepare install all",
		"install wheelmaker",
	)
	assertEventsDoNotContain(t, *h.events, "service start all")
}

func TestDeploySkipsWebWhenExistingConfigDoesNotListen(t *testing.T) {
	h := newDeployHarness(t)
	writeRegistryListenConfig(t, h.cfg, false)

	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}

	assertEventsDoNotContain(t, *h.events, "npm ci")
	assertEventsDoNotContain(t, *h.events, "npm run build:web:release")
}

func TestDeployPublishesWebWhenExistingConfigListens(t *testing.T) {
	h := newDeployHarness(t)
	writeRegistryListenConfig(t, h.cfg, true)

	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}

	assertEventsContainInOrder(t, *h.events, "npm ci --include=dev", "npm run build:web:release")
}

func TestDeployPublishesWebWhenConfigIsMissing(t *testing.T) {
	h := newDeployHarness(t)

	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}

	assertEventsContainInOrder(t, *h.events, "npm ci --include=dev", "npm run build:web:release")
}

func TestDeployRejectsMalformedExistingConfigWithoutOverwritingIt(t *testing.T) {
	h := newDeployHarness(t)
	path := filepath.Join(wheelMakerHome(h.cfg), "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	if err := os.WriteFile(path, []byte("{"), 0o644); err != nil {
		t.Fatalf("write invalid config: %v", err)
	}

	err := runDeployWithDeps(context.Background(), h.cfg, h.deps)
	if err == nil || !strings.Contains(err.Error(), "legacy monitor migration") {
		t.Fatalf("runDeployWithDeps err=%v, want migration parse error", err)
	}
	assertEventsDoNotContain(t, *h.events, "npm ci")
	got, readErr := os.ReadFile(path)
	if readErr != nil || string(got) != "{" {
		t.Fatalf("malformed config changed: %q err=%v", got, readErr)
	}
}

func TestUpdateSkipsWebWhenExistingConfigDoesNotListen(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeUpdate
	writeRegistryListenConfig(t, h.cfg, false)

	if err := runUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runUpdateWithDeps: %v", err)
	}

	assertEventsDoNotContain(t, *h.events, "npm ci")
	assertEventsDoNotContain(t, *h.events, "npm run build:web:release")
}

func TestUpdateContinuesWhenLegacyMonitorCleanupRequiresElevation(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeUpdate
	h.cfg.NoPull = true
	h.cfg.NoWeb = true
	h.deps.Runner = legacyElevationTestRunner{testRunner{events: h.events}}
	reports := []string{}
	h.deps.Report = func(message string) { reports = append(reports, message) }

	if err := runUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runUpdateWithDeps: %v", err)
	}
	if !strings.Contains(strings.Join(reports, "\n"), "legacy monitor cleanup requires elevation") {
		t.Fatalf("reports=%q, want elevation warning", reports)
	}
	assertEventsContainInOrder(t, *h.events, "go build wheelmaker", "write release")
}

func TestUpdateWritesReleaseManifestWhenWebPublishIsSkipped(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeUpdate
	writeRegistryListenConfig(t, h.cfg, false)

	if err := runUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runUpdateWithDeps: %v", err)
	}

	assertEventsDoNotContain(t, *h.events, "npm run build:web:release")
	assertEventsContainInOrder(t, *h.events, "write release", "cleanup artifacts")
	raw, err := os.ReadFile(filepath.Join(wheelMakerHome(h.cfg), "release.json"))
	if err != nil {
		t.Fatalf("read release manifest: %v", err)
	}
	var manifest struct {
		Repo        string `json:"repo"`
		Branch      string `json:"branch"`
		SHA         string `json:"sha"`
		PublishedAt string `json:"publishedAt"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode release manifest: %v", err)
	}
	if manifest.Repo != h.cfg.RepoRoot || manifest.Branch != "main" || manifest.SHA != "abc123" || manifest.PublishedAt != "2026-05-30T01:02:03Z" {
		t.Fatalf("manifest=%+v", manifest)
	}
}

func TestDeployReportsBuildProgress(t *testing.T) {
	h := newDeployHarness(t)
	var progress []string
	h.deps.Report = func(message string) {
		progress = append(progress, message)
	}
	if err := runDeployWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runDeployWithDeps: %v", err)
	}
	assertEventsContainInOrder(t, progress,
		"checking deploy prerequisites",
		"pulling latest source",
		"syncing Web dependencies",
		"building wheelmaker",
		"building wheelmaker-updater",
		"building wheelmaker-deploy",
		"publishing Web",
		"installing wheelmaker",
		"configuring services",
		"starting services",
		"cleaning deploy artifacts",
	)
}

func TestWindowsRuntimeBinariesBuildWithoutConsoleWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows subsystem flags only apply on Windows")
	}
	h := newDeployHarness(t)
	var calls []capturedCommand
	deps := h.deps
	deps.Runner = captureBuildRunner{calls: &calls}

	if err := buildBinaries(context.Background(), h.cfg, deps, true); err != nil {
		t.Fatalf("buildBinaries: %v", err)
	}

	for _, label := range []string{"wheelmaker", "wheelmaker-updater"} {
		args := findBuildArgsForLabel(t, calls, label)
		assertStringSliceContains(t, args, "-ldflags")
		assertStringSliceContains(t, args, "-H windowsgui")
	}
	assertBuildLabelMissing(t, calls, "wheelmaker-monitor")
	deployArgs := findBuildArgsForLabel(t, calls, "wheelmaker-deploy")
	assertStringSliceDoesNotContain(t, deployArgs, "-H windowsgui")
}

func TestWindowsCommandManifestsRequestAsInvoker(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows manifest resources only apply on Windows")
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	serverRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	for _, rel := range []string{
		filepath.Join("cmd", "wheelmaker", "wheelmaker_windows_amd64.syso"),
		filepath.Join("cmd", "wheelmaker-updater", "wheelmaker_updater_windows_amd64.syso"),
		filepath.Join("cmd", "wheelmaker-deploy", "wheelmaker_deploy_windows_amd64.syso"),
	} {
		path := filepath.Join(serverRoot, rel)
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read manifest resource %s: %v", path, err)
		}
		text := string(raw) + utf16LEString(raw)
		for _, needle := range []string{"requestedExecutionLevel", "asInvoker", `uiAccess="false"`} {
			if !strings.Contains(text, needle) {
				t.Fatalf("%s missing manifest needle %q", path, needle)
			}
		}
	}
}

func TestUpdatePipelineSkipsUpdaterAndConfig(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeUpdate
	h.cfg.NoPull = true
	h.cfg.NoConfig = true
	h.cfg.NoUpdater = true
	if err := runUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("runUpdateWithDeps: %v", err)
	}
	assertEventsDoNotContain(t, *h.events, "wheelmaker-updater")
	assertEventsDoNotContain(t, *h.events, "service configure")
	assertEventsContainInOrder(t, *h.events, "cleanup artifacts")
}

func TestEnsureConfigWritesRunnableWheelMakerDefault(t *testing.T) {
	h := newDeployHarness(t)
	if _, err := ensureConfig(h.cfg, h.deps); err != nil {
		t.Fatalf("ensureConfig: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(h.home, ".wheelmaker", "config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	text := string(raw)
	for _, needle := range []string{
		`"name": "WheelMaker"`,
		`"listen": true`,
		`"server": "127.0.0.1"`,
		`"hubId": "local-hub"`,
	} {
		if !strings.Contains(text, needle) {
			t.Fatalf("config missing %s: %s", needle, text)
		}
	}
	if !strings.Contains(text, h.cfg.RepoRoot) {
		var parsed struct {
			Projects []struct {
				Path string `json:"path"`
			} `json:"projects"`
		}
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatalf("parse generated config: %v", err)
		}
		if len(parsed.Projects) != 1 || parsed.Projects[0].Path != h.cfg.RepoRoot {
			t.Fatalf("project path=%#v want %q", parsed.Projects, h.cfg.RepoRoot)
		}
	}
	var parsed struct {
		Registry struct {
			Token string `json:"token"`
		} `json:"registry"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse generated config: %v", err)
	}
	if len(parsed.Registry.Token) != 43 || parsed.Registry.Token == "wheelmaker-local-token" {
		t.Fatalf("registry.token=%q, want unique 256-bit Base64URL token", parsed.Registry.Token)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		t.Fatalf("parse generated config root: %v", err)
	}
	if _, exists := root["monitor"]; exists {
		t.Fatalf("generated config still contains retired monitor: %s", raw)
	}
}

func TestEnsureConfigGeneratesIndependentRegistryTokens(t *testing.T) {
	first := newDeployHarness(t)
	second := newDeployHarness(t)
	if _, err := ensureConfig(first.cfg, first.deps); err != nil {
		t.Fatalf("ensureConfig(first): %v", err)
	}
	if _, err := ensureConfig(second.cfg, second.deps); err != nil {
		t.Fatalf("ensureConfig(second): %v", err)
	}
	firstToken := readGeneratedRegistryToken(t, first.cfg)
	secondToken := readGeneratedRegistryToken(t, second.cfg)
	if firstToken == secondToken {
		t.Fatalf("independent installs share registry token %q", firstToken)
	}
}

func TestEnsureConfigRotatesLegacyRegistryToken(t *testing.T) {
	h := newDeployHarness(t)
	writeExistingRegistryTokenConfig(t, h.cfg, "wheelmaker-local-token")
	if changed, err := ensureConfig(h.cfg, h.deps); err != nil {
		t.Fatalf("ensureConfig(): %v", err)
	} else if !changed {
		t.Fatal("ensureConfig() changed=false, want legacy token migration")
	}
	got := readGeneratedRegistryToken(t, h.cfg)
	if got == "wheelmaker-local-token" || len(got) != 43 {
		t.Fatalf("migrated registry.token=%q, want generated token", got)
	}
}

func TestEnsureConfigPreservesCustomRegistryToken(t *testing.T) {
	h := newDeployHarness(t)
	const custom = "user-supplied-random-token"
	writeExistingRegistryTokenConfig(t, h.cfg, custom)
	if changed, err := ensureConfig(h.cfg, h.deps); err != nil {
		t.Fatalf("ensureConfig(): %v", err)
	} else if changed {
		t.Fatal("ensureConfig() changed=true, want custom token preserved")
	}
	if got := readGeneratedRegistryToken(t, h.cfg); got != custom {
		t.Fatalf("registry.token=%q, want %q", got, custom)
	}
}

func writeExistingRegistryTokenConfig(t *testing.T, cfg deployConfig, token string) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"projects": []map[string]string{{"name": "WheelMaker", "path": cfg.RepoRoot}},
		"registry": map[string]any{
			"listen": true,
			"server": "127.0.0.1",
			"port":   9630,
			"token":  token,
			"hubId":  "local-hub",
		},
	})
	if err != nil {
		t.Fatalf("marshal existing config: %v", err)
	}
	path := filepath.Join(wheelMakerHome(cfg), "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
		t.Fatalf("write existing config: %v", err)
	}
}

func readGeneratedRegistryToken(t *testing.T, cfg deployConfig) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(wheelMakerHome(cfg), "config.json"))
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	var parsed struct {
		Registry struct {
			Token string `json:"token"`
		} `json:"registry"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse generated config: %v", err)
	}
	return parsed.Registry.Token
}

func TestWriteHelperWrappers(t *testing.T) {
	h := newDeployHarness(t)
	wheelMakerHome := filepath.Join(h.home, ".wheelmaker")
	if err := os.MkdirAll(wheelMakerHome, 0o755); err != nil {
		t.Fatalf("mkdir wheelmaker home: %v", err)
	}
	for _, stale := range []string{"start.bat", "stop.bat", "restart.bat", "status.bat", "start.sh", "stop.sh", "restart.sh", "status.sh"} {
		if err := os.WriteFile(filepath.Join(wheelMakerHome, stale), []byte("stale"), 0o644); err != nil {
			t.Fatalf("write stale wrapper: %v", err)
		}
	}
	if err := writeHelperWrappers(h.cfg, h.deps); err != nil {
		t.Fatalf("writeHelperWrappers: %v", err)
	}
	if runtime.GOOS == "windows" {
		assertFileContains(t, filepath.Join(wheelMakerHome, "start.bat"), "wheelmaker-deploy.exe")
		assertFileContains(t, filepath.Join(wheelMakerHome, "start.bat"), "service --runtime asuser start")
		assertFileContains(t, filepath.Join(wheelMakerHome, "stop.bat"), "service --runtime asuser stop")
		assertFileContains(t, filepath.Join(wheelMakerHome, "restart.bat"), "service --runtime asuser restart")
		assertFileContains(t, filepath.Join(wheelMakerHome, "status.bat"), "service --runtime asuser status")
		assertFileMissing(t, filepath.Join(wheelMakerHome, "start.sh"))
		assertFileMissing(t, filepath.Join(wheelMakerHome, "stop.sh"))
		assertFileMissing(t, filepath.Join(wheelMakerHome, "restart.sh"))
		assertFileMissing(t, filepath.Join(wheelMakerHome, "status.sh"))
		return
	}
	assertFileContains(t, filepath.Join(wheelMakerHome, "start.sh"), "wheelmaker-deploy")
	assertFileContains(t, filepath.Join(wheelMakerHome, "start.sh"), "service start")
	assertFileContains(t, filepath.Join(wheelMakerHome, "stop.sh"), "service stop")
	assertFileContains(t, filepath.Join(wheelMakerHome, "restart.sh"), "service restart")
	assertFileContains(t, filepath.Join(wheelMakerHome, "status.sh"), "service status")
	assertFileMissing(t, filepath.Join(wheelMakerHome, "start.bat"))
	assertFileMissing(t, filepath.Join(wheelMakerHome, "stop.bat"))
	assertFileMissing(t, filepath.Join(wheelMakerHome, "restart.bat"))
	assertFileMissing(t, filepath.Join(wheelMakerHome, "status.bat"))
}

func TestCleanupDeployArtifactsPrunesRegenerableFiles(t *testing.T) {
	h := newDeployHarness(t)
	home := filepath.Join(h.home, ".wheelmaker")
	for _, path := range []string{
		filepath.Join(home, "build", "mobile", "android", "probe-with-jvmargs", "gradle-home", "cache.bin"),
		filepath.Join(home, "build", "mobile", "android", "probe-no-jvmargs", "gradle-home", "cache.bin"),
		filepath.Join(home, "cache", "go-build", "cache.bin"),
		filepath.Join(home, "tmp", "apk-download", "payload.apk"),
		filepath.Join(home, "web-dev.log"),
		filepath.Join(home, "web-dev-8083.log"),
		filepath.Join(home, "web-dev.err.log"),
		filepath.Join(home, "refresh_server.ps1"),
		filepath.Join(home, "refresh_server.sh"),
		filepath.Join(home, "refresh_server_linux.sh"),
		filepath.Join(home, "logs", "20260501_030000", "web-dev.log"),
		filepath.Join(home, "logs", "20260502_030000", "web-dev.log"),
		filepath.Join(home, "logs", "20260503_030000", "web-dev.log"),
		filepath.Join(home, "logs", "20260504_030000", "web-dev.log"),
	} {
		writeTestFile(t, path, "garbage")
	}
	for _, path := range []string{
		filepath.Join(home, "config.json"),
		filepath.Join(home, "db", "client.sqlite3"),
		filepath.Join(home, "web", "index.html"),
		filepath.Join(home, "mobile", "android", "WheelMakerAndroid.apk"),
		filepath.Join(home, "desktop", "WheelMakerDesktop.exe"),
		filepath.Join(home, "build", runtime.GOOS+"_"+runtime.GOARCH, binaryName("wheelmaker")),
		filepath.Join(home, "build", "mobile", "android", "gradle-home", "cache.bin"),
		filepath.Join(home, "log", "hub.log"),
	} {
		writeTestFile(t, path, "keep")
	}
	for _, name := range platformStaleWrapperNames() {
		writeTestFile(t, filepath.Join(home, name), "stale wrapper")
	}
	for _, name := range platformCurrentWrapperNames() {
		writeTestFile(t, filepath.Join(home, name), "keep")
	}

	if err := cleanupDeployArtifacts(h.cfg, h.deps); err != nil {
		t.Fatalf("cleanupDeployArtifacts: %v", err)
	}

	for _, path := range []string{
		filepath.Join(home, "build", "mobile", "android", "probe-with-jvmargs"),
		filepath.Join(home, "build", "mobile", "android", "probe-no-jvmargs"),
		filepath.Join(home, "cache", "go-build"),
		filepath.Join(home, "tmp"),
		filepath.Join(home, "web-dev.log"),
		filepath.Join(home, "web-dev-8083.log"),
		filepath.Join(home, "web-dev.err.log"),
		filepath.Join(home, "refresh_server.ps1"),
		filepath.Join(home, "refresh_server.sh"),
		filepath.Join(home, "refresh_server_linux.sh"),
		filepath.Join(home, "logs", "20260501_030000"),
	} {
		assertFileMissing(t, path)
	}
	for _, name := range platformStaleWrapperNames() {
		assertFileMissing(t, filepath.Join(home, name))
	}
	for _, path := range []string{
		filepath.Join(home, "logs", "20260502_030000"),
		filepath.Join(home, "logs", "20260503_030000"),
		filepath.Join(home, "logs", "20260504_030000"),
	} {
		assertPathExists(t, path)
	}
	for _, path := range []string{
		filepath.Join(home, "config.json"),
		filepath.Join(home, "db", "client.sqlite3"),
		filepath.Join(home, "web", "index.html"),
		filepath.Join(home, "mobile", "android", "WheelMakerAndroid.apk"),
		filepath.Join(home, "desktop", "WheelMakerDesktop.exe"),
		filepath.Join(home, "build", runtime.GOOS+"_"+runtime.GOARCH, binaryName("wheelmaker")),
		filepath.Join(home, "build", "mobile", "android", "gradle-home", "cache.bin"),
		filepath.Join(home, "log", "hub.log"),
	} {
		assertFileContains(t, path, "keep")
	}
	for _, name := range platformCurrentWrapperNames() {
		assertFileContains(t, filepath.Join(home, name), "keep")
	}
	assertEventsContainInOrder(t, *h.events, "cleanup artifacts")
}

func TestRootWebDevLogCleanupIgnoresWindowsFileInUse(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows sharing violation only applies on Windows")
	}
	err := fmt.Errorf("remove log: %w", &os.PathError{
		Op:   "remove",
		Path: filepath.Join("home", "web-dev-8081.log"),
		Err:  syscall.Errno(32),
	})
	if !shouldIgnoreRootWebDevLogCleanupError(err) {
		t.Fatalf("expected Windows sharing violation to be ignored: %v", err)
	}
}

func TestBootstrapBuildsTempDeployAndExecsUpdate(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeBootstrapUpdate
	if err := runBootstrapUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	assertEventsContainInOrder(t, *h.events,
		"git pull --ff-only origin main",
		"go build wheelmaker-deploy-next",
		"run wheelmaker-deploy-next update",
	)
}

func TestBootstrapStashesLocalChangesBeforePull(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeBootstrapUpdate
	h.deps.Runner = testRunner{events: h.events, gitStatus: " M server/cmd/wheelmaker-deploy/main.go\n?? scratch.txt\n"}
	if err := runBootstrapUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	assertEventsContainInOrder(t, *h.events,
		"git status --porcelain",
		"git stash push --include-untracked -m WheelMaker auto-stash before update",
		"git pull --ff-only origin main",
		"git stash pop --index",
		"go build wheelmaker-deploy-next",
		"run wheelmaker-deploy-next update",
	)
}

func TestBootstrapPassesNoWebToUpdate(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeBootstrapUpdate
	h.cfg.NoWeb = true
	if err := runBootstrapUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	for _, event := range *h.events {
		if strings.Contains(event, "run wheelmaker-deploy-next update") && strings.Contains(event, "--no-web") {
			return
		}
	}
	t.Fatalf("bootstrap update command did not include --no-web: %#v", *h.events)
}

func TestBootstrapPassesNoWebToUpdateWhenExistingConfigDoesNotListen(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.Mode = modeBootstrapUpdate
	writeRegistryListenConfig(t, h.cfg, false)
	if err := runBootstrapUpdateWithDeps(context.Background(), h.cfg, h.deps); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	for _, event := range *h.events {
		if strings.Contains(event, "run wheelmaker-deploy-next update") && strings.Contains(event, "--no-web") {
			return
		}
	}
	t.Fatalf("bootstrap update command did not include --no-web: %#v", *h.events)
}

func TestLinuxUnitContentRequiresRestartAlways(t *testing.T) {
	unit := linuxUnitContent("WheelMaker Hub", "/repo", "/home/user/.wheelmaker/systemd.env", "/home/user/.wheelmaker/bin/wheelmaker", "-d")
	for _, needle := range []string{"Restart=always", "EnvironmentFile=", "ExecStart=", "WantedBy=default.target"} {
		if !strings.Contains(unit, needle) {
			t.Fatalf("unit missing %s:\n%s", needle, unit)
		}
	}
}

func TestMacOSPlistContent(t *testing.T) {
	t.Setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
	t.Setenv("HOME", "/Users/me")

	plist := launchAgentPlistContent("com.wheelmaker.hub", "/repo", "/Users/me/.wheelmaker/bin/wheelmaker", []string{"-d"})
	for _, needle := range []string{
		"com.wheelmaker.hub",
		"<key>ProgramArguments</key>",
		"<string>-d</string>",
		"<key>KeepAlive</key>",
		"<key>EnvironmentVariables</key>",
		"<key>PATH</key>",
		"<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>",
		"<key>HOME</key>",
		"<string>/Users/me</string>",
	} {
		if !strings.Contains(plist, needle) {
			t.Fatalf("plist missing %s:\n%s", needle, plist)
		}
	}
}

func TestMacOSPlistContentAugmentsSparsePathForNodeTools(t *testing.T) {
	t.Setenv("PATH", "/custom/bin")
	t.Setenv("HOME", "/Users/me")

	plist := launchAgentPlistContent("com.wheelmaker.hub", "/repo", "/Users/me/.wheelmaker/bin/wheelmaker", []string{"-d"})
	wantPath := "<string>/custom/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>"
	if !strings.Contains(plist, wantPath) {
		t.Fatalf("plist PATH missing common node locations, want %s:\n%s", wantPath, plist)
	}
}

func TestWindowsUpdaterServiceArgumentsUseDeployCLIPathFlags(t *testing.T) {
	got := windowsUpdaterArgs(`C:\repo`, `C:\Users\me\.wheelmaker\bin`, "03:00", "asuser")
	for _, needle := range []string{`--repo "C:\repo"`, `--install-dir "C:\Users\me\.wheelmaker\bin"`, `--time "03:00"`, `--runtime "asuser"`} {
		if !strings.Contains(got, needle) {
			t.Fatalf("args=%s missing %s", got, needle)
		}
	}
}

func buildLabelFromOutput(out string) string {
	base := filepath.Base(out)
	base = strings.TrimSuffix(base, ".exe")
	if strings.Contains(base, "wheelmaker-deploy-next") {
		return "wheelmaker-deploy-next"
	}
	return base
}

func goBuildOutputArgForTest(args []string) string {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-o" {
			return args[i+1]
		}
	}
	return ""
}

func findBuildArgsForLabel(t *testing.T, calls []capturedCommand, label string) []string {
	t.Helper()
	for _, call := range calls {
		if call.name != "go" || len(call.args) == 0 || call.args[0] != "build" {
			continue
		}
		out := goBuildOutputArgForTest(call.args)
		if out != "" && buildLabelFromOutput(out) == label {
			return call.args
		}
	}
	t.Fatalf("missing go build for %s in %#v", label, calls)
	return nil
}

func assertBuildLabelMissing(t *testing.T, calls []capturedCommand, label string) {
	t.Helper()
	for _, call := range calls {
		if call.name != "go" || len(call.args) == 0 || call.args[0] != "build" {
			continue
		}
		out := goBuildOutputArgForTest(call.args)
		if out != "" && buildLabelFromOutput(out) == label {
			t.Fatalf("unexpected go build for %s in %#v", label, calls)
		}
	}
}

func writeRegistryListenConfig(t *testing.T, cfg deployConfig, listen bool) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"registry": map[string]any{
			"listen": listen,
			"server": "wss://wheelmaker.top/ws",
		},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	path := filepath.Join(wheelMakerHome(cfg), "config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
}

func assertStringSliceContains(t *testing.T, values []string, needle string) {
	t.Helper()
	for _, value := range values {
		if value == needle {
			return
		}
	}
	t.Fatalf("%#v missing %q", values, needle)
}

func assertStringSliceDoesNotContain(t *testing.T, values []string, needle string) {
	t.Helper()
	for _, value := range values {
		if value == needle {
			t.Fatalf("%#v should not contain %q", values, needle)
		}
	}
}

func cmpStringSlices(got []string, want []string) string {
	if len(got) != len(want) {
		return "events length mismatch\n got: " + strings.Join(got, "\n  ") + "\nwant: " + strings.Join(want, "\n  ")
	}
	for i := range got {
		if got[i] != want[i] {
			return "event mismatch at index " + string(rune('0'+i)) + "\n got: " + strings.Join(got, "\n  ") + "\nwant: " + strings.Join(want, "\n  ")
		}
	}
	return ""
}

func assertEventsDoNotContain(t *testing.T, events []string, needle string) {
	t.Helper()
	for _, event := range events {
		if strings.Contains(event, needle) {
			t.Fatalf("events should not contain %q: %#v", needle, events)
		}
	}
}

func assertEventsContainInOrder(t *testing.T, events []string, needles ...string) {
	t.Helper()
	index := 0
	for _, event := range events {
		if index < len(needles) && strings.Contains(event, needles[index]) {
			index++
		}
	}
	if index != len(needles) {
		t.Fatalf("events missing ordered needles %#v in %#v", needles, events)
	}
}

func assertFileContains(t *testing.T, path string, needle string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !strings.Contains(string(raw), needle) {
		t.Fatalf("%s missing %q:\n%s", path, needle, string(raw))
	}
}

func assertFileMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err == nil {
		t.Fatalf("%s should not exist", path)
	} else if !os.IsNotExist(err) {
		t.Fatalf("stat %s: %v", path, err)
	}
}

func assertPathExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("%s should exist: %v", path, err)
	}
}

func writeTestFile(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func utf16LEString(raw []byte) string {
	if len(raw) < 2 {
		return ""
	}
	units := make([]uint16, 0, len(raw)/2)
	for i := 0; i+1 < len(raw); i += 2 {
		units = append(units, uint16(raw[i])|uint16(raw[i+1])<<8)
	}
	return string(utf16.Decode(units))
}

func platformStaleWrapperNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"start.sh", "stop.sh", "restart.sh", "status.sh"}
	}
	return []string{"start.bat", "stop.bat", "restart.bat", "status.bat"}
}

func platformCurrentWrapperNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"start.bat", "stop.bat", "restart.bat", "status.bat"}
	}
	return []string{"start.sh", "stop.sh", "restart.sh", "status.sh"}
}
