//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsRuntimeTasksRunAsInteractiveUser(t *testing.T) {
	h := newDeployHarness(t)
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsTaskRegisterContains(t, events, windowsHubService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "Interactive", "Limited", "-d", "--dir", stateDir)
	assertWindowsTaskRegisterContains(t, events, windowsMonitorService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "Interactive", "Limited", "--dir", stateDir)
	assertWindowsTaskRegisterContains(t, events, windowsUpdaterService, "Register-ScheduledTask", "New-ScheduledTaskPrincipal", "Interactive", "Limited", "--repo", h.cfg.RepoRoot, "--install-dir", h.cfg.InstallDir)
	assertEventsDoNotContain(t, events, "sc.exe create")
}

func TestWindowsRuntimeActionsUseScheduledTasks(t *testing.T) {
	h := newDeployHarness(t)
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
	assertEventsDoNotContain(t, events, "Get-Service")
}

func assertWindowsTaskRegisterContains(t *testing.T, events []string, taskName string, needles ...string) {
	t.Helper()
	prefix := "powershell -NoProfile -ExecutionPolicy Bypass -Command "
	for _, event := range events {
		if !strings.Contains(event, prefix) || !strings.Contains(event, taskName) || !strings.Contains(event, "Register-ScheduledTask") {
			continue
		}
		for _, needle := range needles {
			if !strings.Contains(event, needle) {
				t.Fatalf("task register for %s missing %q:\n%s", taskName, needle, event)
			}
		}
		return
	}
	t.Fatalf("missing task register event for %s in %#v", taskName, events)
}
