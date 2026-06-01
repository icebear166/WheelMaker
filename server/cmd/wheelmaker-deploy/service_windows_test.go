//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsServicesPassStateDirToHubAndMonitor(t *testing.T) {
	h := newDeployHarness(t)
	events := []string{}
	runner := testRunner{events: &events}
	manager := newServiceManager(h.cfg, runner)

	if err := manager.Configure(context.Background()); err != nil {
		t.Fatalf("Configure: %v", err)
	}

	stateDir := filepath.Dir(h.cfg.InstallDir)
	assertWindowsServiceCreateContains(t, events, windowsHubService, "--dir", stateDir)
	assertWindowsServiceCreateContains(t, events, windowsMonitorService, "--dir", stateDir)
}

func assertWindowsServiceCreateContains(t *testing.T, events []string, serviceName string, needles ...string) {
	t.Helper()
	prefix := "sc.exe create " + serviceName + " "
	for _, event := range events {
		if !strings.Contains(event, prefix) {
			continue
		}
		for _, needle := range needles {
			if !strings.Contains(event, needle) {
				t.Fatalf("service create for %s missing %q:\n%s", serviceName, needle, event)
			}
		}
		return
	}
	t.Fatalf("missing sc create event for %s in %#v", serviceName, events)
}
