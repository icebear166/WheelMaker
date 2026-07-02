//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsLegacyServiceRuntimeConfiguresHKCURun(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "service"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsHubService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker.exe", "-d", "--dir", stateDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsMonitorService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker-monitor.exe", "--dir", stateDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsUpdaterService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker-updater.exe", "--repo", h.cfg.RepoRoot, "--install-dir", h.cfg.InstallDir, "--runtime", "asuser")
	assertEventsDoNotContain(t, events, "Register-ScheduledTask")
	assertEventsDoNotContain(t, events, "New-ScheduledTaskPrincipal")
	assertEventsDoNotContain(t, events, "New-Service")
}

func TestWindowsAsUserConfiguresHKCURunAndRemovesLegacyRuntime(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsHubService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker.exe", "-d", "--dir", stateDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsMonitorService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker-monitor.exe", "--dir", stateDir)
	assertWindowsHKCURunConfigureContains(t, events, windowsUpdaterService, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Set-ItemProperty", "wheelmaker-updater.exe", "--repo", h.cfg.RepoRoot, "--install-dir", h.cfg.InstallDir, "--runtime", "asuser")
	assertEventsDoNotContain(t, events, "Register-ScheduledTask")
	assertEventsDoNotContain(t, events, "New-ScheduledTaskPrincipal")
	assertEventsDoNotContain(t, events, "Get-Credential")
	assertEventsDoNotContain(t, events, "New-Service")
	assertEventsDoNotContain(t, events, "LeastPrivilege")
}

func TestWindowsAsUserConfigSkipsUpdaterWhenUpdaterInstallSkipped(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	h.cfg.NoUpdater = true
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	assertEventsDoNotContain(t, events, "wheelmaker-updater.exe")
}

func TestWindowsLegacyServiceRuntimeActionsUseProcesses(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "service"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Start(context.Background(), true); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := manager.Stop(context.Background(), true); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := manager.Status(context.Background()); err != nil {
		t.Fatalf("Status: %v", err)
	}

	for _, needle := range []string{"Start-Process", "wheelmaker.exe", "wheelmaker-monitor.exe", "wheelmaker-updater.exe", "Stop-Process", "Get-CimInstance Win32_Process"} {
		assertEventsContainInOrder(t, events, needle)
	}
	assertEventsDoNotContain(t, events, "Start-ScheduledTask")
	assertEventsDoNotContain(t, events, "Stop-ScheduledTask")
	assertEventsDoNotContain(t, events, "Get-ScheduledTask")
	assertEventsDoNotContain(t, events, "Start-Service")
	assertEventsDoNotContain(t, events, "Stop-Service")
	assertEventsDoNotContain(t, events, "Get-CimInstance Win32_Service")
}

func TestWindowsAsUserRuntimeActionsUseProcesses(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Start(context.Background(), true); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := manager.Stop(context.Background(), true); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := manager.Status(context.Background()); err != nil {
		t.Fatalf("Status: %v", err)
	}

	for _, needle := range []string{"Start-Process", "wheelmaker.exe", "wheelmaker-monitor.exe", "wheelmaker-updater.exe", "Stop-Process", "Get-CimInstance Win32_Process"} {
		assertEventsContainInOrder(t, events, needle)
	}
	assertEventsDoNotContain(t, events, "Start-ScheduledTask")
	assertEventsDoNotContain(t, events, "Stop-ScheduledTask")
	assertEventsDoNotContain(t, events, "Get-ScheduledTask")
	assertEventsDoNotContain(t, events, "Start-Service")
	assertEventsDoNotContain(t, events, "Stop-Service")
	assertEventsDoNotContain(t, events, "Get-CimInstance Win32_Service")
}

func TestWindowsAsUserUpdateStartExcludesUpdaterProcess(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Start(context.Background(), false); err != nil {
		t.Fatalf("Start: %v", err)
	}

	assertEventsContainInOrder(t, events, "Start-Process")
	assertEventsContainInOrder(t, events, "wheelmaker.exe")
	assertEventsContainInOrder(t, events, "wheelmaker-monitor.exe")
	assertEventsDoNotContain(t, events, "wheelmaker-updater.exe")
}

func TestWindowsPrepareInstallCleansServicesTasksAndProcesses(t *testing.T) {
	for _, runtimeMode := range []string{"asuser", "service"} {
		t.Run(runtimeMode, func(t *testing.T) {
			h := newDeployHarness(t)
			h.cfg.RuntimeMode = runtimeMode
			events := []string{}
			runner := testRunner{events: &events}
			manager := newServiceManager(h.cfg, runner)

			if err := manager.PrepareInstall(context.Background(), true); err != nil {
				t.Fatalf("PrepareInstall: %v", err)
			}

			assertEventsContainInOrder(t, events, "Stop-ScheduledTask")
			assertEventsContainInOrder(t, events, "Unregister-ScheduledTask")
			assertEventsContainInOrder(t, events, "Stop-Service")
			assertEventsContainInOrder(t, events, "sc.exe delete")
			assertEventsContainInOrder(t, events, "Get-CimInstance Win32_Process")
			assertEventsContainInOrder(t, events, "Stop-Process")
			for _, needle := range []string{"wheelmaker.exe", "wheelmaker-monitor.exe", "wheelmaker-updater.exe"} {
				assertEventsContainInOrder(t, events, needle)
			}
		})
	}
}

func TestWindowsPrepareInstallRequiresLegacyRegistrationCleanup(t *testing.T) {
	script := windowsPrepareInstallScript(windowsRuntimeNames(), windowsRuntimeProcessNames(), `C:\Users\me\.wheelmaker\bin`, true)
	for _, bad := range []string{
		"Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue",
		"Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue",
		"Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue",
	} {
		if strings.Contains(script, bad) {
			t.Fatalf("prepare install script must not hide cleanup failure %q:\n%s", bad, script)
		}
	}
	for _, needle := range []string{
		"Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop",
		"Stop-ScheduledTask -TaskName $name -ErrorAction Stop",
		"Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop",
	} {
		if !strings.Contains(script, needle) {
			t.Fatalf("prepare install script missing strict cleanup %q:\n%s", needle, script)
		}
	}
}

func TestWindowsPrepareInstallTreatsUninspectableRuntimeProcessAsManaged(t *testing.T) {
	script := windowsPrepareInstallScript(windowsRuntimeNames(), windowsRuntimeProcessNames(), `C:\Users\me\.wheelmaker\bin`, true)
	for _, needle := range []string{
		"[string]::IsNullOrWhiteSpace($exe) -and [string]::IsNullOrWhiteSpace($cmd)",
		"return $processNames -contains $process.Name",
	} {
		if !strings.Contains(script, needle) {
			t.Fatalf("prepare install script missing %q:\n%s", needle, script)
		}
	}
}

func TestWindowsPrepareInstallFindsRuntimeProcessesByInstallPath(t *testing.T) {
	script := windowsPrepareInstallScript(windowsRuntimeNames(), windowsRuntimeProcessNames(), `C:\Users\me\.wheelmaker\bin`, true)
	needle := "($processNames -contains $_.Name) -or (Test-WheelMakerInstallProcess $_)"
	if !strings.Contains(script, needle) {
		t.Fatalf("prepare install script should match processes by install path for short 8.3 names, missing %q:\n%s", needle, script)
	}
}

func TestWindowsUpdatePrepareInstallDoesNotMatchEveryInstallDirProcess(t *testing.T) {
	script := windowsPrepareInstallScript(
		[]string{windowsHubService, windowsMonitorService},
		[]string{"wheelmaker.exe", "wheelmaker-monitor.exe"},
		`C:\Users\me\.wheelmaker\bin`,
		false,
	)
	forbidden := "return -not [string]::IsNullOrWhiteSpace($cmd) -and $cmd.ToLowerInvariant().Contains($install)"
	if strings.Contains(script, forbidden) {
		t.Fatalf("update prepare install must not stop updater/deploy processes only because they run from install dir:\n%s", script)
	}
	for _, needle := range []string{
		"Test-WheelMakerTargetProcessPath $exe",
		"$cmdLower.Contains($install + $targetProcessName)",
	} {
		if !strings.Contains(script, needle) {
			t.Fatalf("prepare install script missing selected process guard %q:\n%s", needle, script)
		}
	}
}

func TestWindowsDeployPrerequisitesRelaunchesUnelevatedLegacyServiceCleanup(t *testing.T) {
	h := newDeployHarness(t)
	events := []string{}
	runner := windowsServiceInstalledRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	oldIsElevated := windowsIsElevated
	oldRelaunchElevated := windowsRelaunchElevated
	t.Cleanup(func() {
		windowsIsElevated = oldIsElevated
		windowsRelaunchElevated = oldRelaunchElevated
	})
	windowsIsElevated = func() (bool, error) { return false, nil }
	windowsRelaunchElevated = func() error {
		events = append(events, "relaunch elevated")
		return errElevatedChildCompleted
	}

	err := manager.CheckDeployPrerequisites(context.Background())
	if err != errElevatedChildCompleted {
		t.Fatalf("CheckDeployPrerequisites err=%v, want errElevatedChildCompleted", err)
	}
	assertEventsContainInOrder(t, events, "relaunch elevated")
}

func TestWindowsDeployPrerequisitesSkipsElevationWhenServiceWorkDisabled(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.NoConfig = true
	h.cfg.NoRestart = true
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	oldIsElevated := windowsIsElevated
	oldRelaunchElevated := windowsRelaunchElevated
	t.Cleanup(func() {
		windowsIsElevated = oldIsElevated
		windowsRelaunchElevated = oldRelaunchElevated
	})
	windowsIsElevated = func() (bool, error) {
		t.Fatal("windowsIsElevated should not be called when service work is disabled")
		return false, nil
	}
	windowsRelaunchElevated = func() error {
		t.Fatal("windowsRelaunchElevated should not be called when service work is disabled")
		return nil
	}

	if err := manager.CheckDeployPrerequisites(context.Background()); err != nil {
		t.Fatalf("CheckDeployPrerequisites: %v", err)
	}
}

func TestWindowsDeployPrerequisitesSkipsElevationForAsUserRuntime(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	oldIsElevated := windowsIsElevated
	oldRelaunchElevated := windowsRelaunchElevated
	t.Cleanup(func() {
		windowsIsElevated = oldIsElevated
		windowsRelaunchElevated = oldRelaunchElevated
	})
	windowsIsElevated = func() (bool, error) {
		t.Fatal("windowsIsElevated should not be called for asuser runtime")
		return false, nil
	}
	windowsRelaunchElevated = func() error {
		t.Fatal("windowsRelaunchElevated should not be called for asuser runtime")
		return nil
	}

	if err := manager.CheckDeployPrerequisites(context.Background()); err != nil {
		t.Fatalf("CheckDeployPrerequisites: %v", err)
	}
}

func TestWindowsElevatedRelaunchScriptKeepsChildOutputVisible(t *testing.T) {
	script := windowsElevatedRelaunchScript(`C:\bin\wheelmaker-deploy.exe`, []string{"deploy", "--repo", `C:\repo dir`})
	for _, needle := range []string{
		"Start-Process",
		"-Verb RunAs",
		"-Wait",
		"Read-Host",
		"WHEELMAKER_DEPLOY_NO_PAUSE",
		`'C:\bin\wheelmaker-deploy.exe'`,
		`'C:\repo dir'`,
	} {
		if !strings.Contains(script, needle) {
			t.Fatalf("relaunch script missing %q:\n%s", needle, script)
		}
	}
}

func assertWindowsServiceConfigureContains(t *testing.T, events []string, serviceName string, needles ...string) {
	t.Helper()
	prefix := "powershell -NoProfile -ExecutionPolicy Bypass -Command "
	for _, event := range events {
		if !strings.Contains(event, prefix) || !strings.Contains(event, serviceName) || !strings.Contains(event, "New-Service") {
			continue
		}
		for _, needle := range needles {
			if !strings.Contains(event, needle) {
				t.Fatalf("service configure for %s missing %q:\n%s", serviceName, needle, event)
			}
		}
		return
	}
	t.Fatalf("missing service configure event for %s in %#v", serviceName, events)
}

func assertWindowsTaskConfigureContains(t *testing.T, events []string, taskName string, needles ...string) {
	t.Helper()
	prefix := "powershell -NoProfile -ExecutionPolicy Bypass -Command "
	for _, event := range events {
		if !strings.Contains(event, prefix) || !strings.Contains(event, taskName) || !strings.Contains(event, "Register-ScheduledTask") {
			continue
		}
		for _, needle := range needles {
			if !strings.Contains(event, needle) {
				t.Fatalf("task configure for %s missing %q:\n%s", taskName, needle, event)
			}
		}
		return
	}
	t.Fatalf("missing task configure event for %s in %#v", taskName, events)
}

func assertWindowsHKCURunConfigureContains(t *testing.T, events []string, valueName string, needles ...string) {
	t.Helper()
	prefix := "powershell -NoProfile -ExecutionPolicy Bypass -Command "
	for _, event := range events {
		if !strings.Contains(event, prefix) || !strings.Contains(event, valueName) || !strings.Contains(event, "Set-ItemProperty") {
			continue
		}
		for _, needle := range needles {
			if !strings.Contains(event, needle) {
				t.Fatalf("HKCU Run configure for %s missing %q:\n%s", valueName, needle, event)
			}
		}
		return
	}
	t.Fatalf("missing HKCU Run configure event for %s in %#v", valueName, events)
}

type windowsServiceInstalledRunner struct {
	events *[]string
}

func (r windowsServiceInstalledRunner) Run(_ context.Context, dir string, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	*r.events = append(*r.events, dir+"|"+line)
	if name == "powershell" && strings.Contains(strings.Join(args, " "), "Get-Service -Name") {
		return "true", nil
	}
	return "", nil
}
