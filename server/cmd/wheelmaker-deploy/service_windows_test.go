//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsConfiguresCurrentUserServices(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "service"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsServiceConfigureContains(t, events, windowsHubService, "Unregister-ScheduledTask", "Get-Credential", "New-Service", "StartName", "-d", "--dir", stateDir)
	assertWindowsServiceConfigureContains(t, events, windowsMonitorService, "Get-Credential", "New-Service", "StartName", "--dir", stateDir)
	assertWindowsServiceConfigureContains(t, events, windowsUpdaterService, "Get-Credential", "New-Service", "StartName", "--repo", h.cfg.RepoRoot, "--install-dir", h.cfg.InstallDir, "--runtime", "service")
	assertEventsDoNotContain(t, events, "Register-ScheduledTask")
	assertEventsDoNotContain(t, events, "New-ScheduledTaskPrincipal")
}

func TestWindowsAsUserConfiguresLogonTasksAndRemovesServices(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsTaskConfigureContains(t, events, windowsHubService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "AtLogOn", "Interactive", "-RunLevel Limited", "-d", "--dir", stateDir)
	assertWindowsTaskConfigureContains(t, events, windowsMonitorService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "AtLogOn", "Interactive", "-RunLevel Limited", "--dir", stateDir)
	assertWindowsTaskConfigureContains(t, events, windowsUpdaterService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "AtLogOn", "Interactive", "-RunLevel Limited", "--repo", h.cfg.RepoRoot, "--install-dir", h.cfg.InstallDir, "--runtime", "asuser")
	assertWindowsTaskConfigureContains(t, events, windowsUpdaterService, "New-ScheduledTaskSettingsSet", "ExecutionTimeLimit", "New-TimeSpan -Seconds 0")
	assertEventsContainInOrder(t, events, "Stop-Service")
	assertEventsContainInOrder(t, events, "sc.exe delete")
	assertEventsDoNotContain(t, events, "Get-Credential")
	assertEventsDoNotContain(t, events, "New-Service")
	assertEventsDoNotContain(t, events, "LeastPrivilege")
}

func TestWindowsAsUserCleanupIncludesUpdaterWhenUpdaterInstallSkipped(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "asuser"
	h.cfg.NoUpdater = true
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	assertEventsContainInOrder(t, events, windowsUpdaterService)
	assertEventsContainInOrder(t, events, "sc.exe delete")
	assertEventsDoNotContain(t, events, "wheelmaker-updater.exe")
}

func TestWindowsServiceCleanupIncludesUpdaterTaskWhenUpdaterInstallSkipped(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "service"
	h.cfg.NoUpdater = true
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	assertEventsContainInOrder(t, events, windowsUpdaterService)
	assertEventsContainInOrder(t, events, "Unregister-ScheduledTask")
	assertEventsDoNotContain(t, events, "wheelmaker-updater.exe")
}

func TestWindowsRuntimeActionsUseServices(t *testing.T) {
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

	assertEventsContainInOrder(t, events,
		"Start-Service",
		"Stop-Service",
		"Get-CimInstance Win32_Service",
	)
	assertEventsDoNotContain(t, events, "Start-ScheduledTask")
	assertEventsDoNotContain(t, events, "Stop-ScheduledTask")
	assertEventsDoNotContain(t, events, "Get-ScheduledTask")
}

func TestWindowsAsUserRuntimeActionsUseScheduledTasks(t *testing.T) {
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

	assertEventsContainInOrder(t, events,
		"Start-ScheduledTask",
		"Stop-ScheduledTask",
		"Get-ScheduledTask",
	)
	assertEventsDoNotContain(t, events, "Start-Service")
	assertEventsDoNotContain(t, events, "Stop-Service")
	assertEventsDoNotContain(t, events, "Get-CimInstance Win32_Service")
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

func TestWindowsDeployPrerequisitesRelaunchesUnelevatedServiceWork(t *testing.T) {
	h := newDeployHarness(t)
	h.cfg.RuntimeMode = "service"
	events := []string{}
	runner := testRunner{events: &events}
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
	h.cfg.RuntimeMode = "service"
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
