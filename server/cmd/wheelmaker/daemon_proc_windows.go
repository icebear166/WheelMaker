//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/swm8023/wheelmaker/internal/shared"
	"golang.org/x/sys/windows"
)

const stillActiveProcessExitCode = 259 // Windows STILL_ACTIVE

func workerProcessAlive(pid int, exePath string) (bool, error) {
	if pid <= 0 || strings.TrimSpace(exePath) == "" {
		return false, nil
	}

	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(handle)

	var exitCode uint32
	if err := windows.GetExitCodeProcess(handle, &exitCode); err != nil {
		return false, err
	}
	if exitCode != stillActiveProcessExitCode {
		return false, nil
	}

	buffer := make([]uint16, 32*1024)
	length := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &length); err != nil {
		return false, err
	}

	actualPath := filepath.Clean(windows.UTF16ToString(buffer[:length]))
	expectedPath := filepath.Clean(exePath)
	return strings.EqualFold(actualPath, expectedPath), nil
}

func listWorkerProcesses(exeName, markerFlag string) ([]daemonProcess, error) {
	exeName = strings.TrimSpace(exeName)
	if exeName == "" {
		return nil, nil
	}
	markerFlag = strings.TrimSpace(markerFlag)
	if markerFlag == "" {
		markerFlag = daemonWorkerArg
	}
	script := fmt.Sprintf(`$p = Get-CimInstance Win32_Process -Filter "Name='%s'" | Where-Object { $_.CommandLine -match '%s' } | Select-Object ProcessId; if ($null -eq $p) { '[]' } else { $p | ConvertTo-Json -Compress }`, exeName, markerFlag)
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	shared.ConfigureBackgroundCommand(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("list workers: %w", err)
	}
	raw := strings.TrimSpace(string(out))
	if raw == "" || raw == "null" || raw == "[]" {
		return nil, nil
	}

	type row struct {
		ProcessID int `json:"ProcessId"`
	}
	var one row
	if json.Unmarshal([]byte(raw), &one) == nil && one.ProcessID > 0 {
		return []daemonProcess{{PID: one.ProcessID}}, nil
	}
	var many []row
	if err := json.Unmarshal([]byte(raw), &many); err != nil {
		return nil, fmt.Errorf("decode workers: %w", err)
	}
	procs := make([]daemonProcess, 0, len(many))
	for _, r := range many {
		if r.ProcessID <= 0 {
			continue
		}
		procs = append(procs, daemonProcess{PID: r.ProcessID})
	}
	return procs, nil
}
