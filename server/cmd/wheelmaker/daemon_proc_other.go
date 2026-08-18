//go:build !windows

package main

import (
	"fmt"
	"os/exec"
)

// Keep the existing process-table scan on Unix-like systems; the native fast
// path is intentionally limited to Windows, where PowerShell is the problem.
func workerProcessAlive(int, string) (bool, error) { return false, nil }

func listWorkerProcesses(exeName, markerFlag string) ([]daemonProcess, error) {
	// On Unix-like systems, scan the process table and match both executable
	// name and daemon worker marker so we only supervise daemon-managed workers.
	cmd := exec.Command("ps", "-eo", "pid=,comm=,args=")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("list workers: %w", err)
	}
	return parseWorkerProcessesFromPS(out, exeName, markerFlag)
}
