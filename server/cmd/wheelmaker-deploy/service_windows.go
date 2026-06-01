//go:build windows

package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	windowsHubService     = "WheelMaker"
	windowsMonitorService = "WheelMakerMonitor"
	windowsUpdaterService = "WheelMakerUpdater"
)

type serviceManager struct {
	cfg    deployConfig
	runner commandRunner
}

func newServiceManager(cfg deployConfig, runner commandRunner) serviceManager {
	return serviceManager{cfg: resolveDefaults(cfg), runner: runner}
}

func (m serviceManager) CheckDeployPrerequisites(ctx context.Context) error {
	return nil
}

func (m serviceManager) Configure(ctx context.Context) error {
	stateDir := filepath.Dir(m.cfg.InstallDir)
	if err := m.ensureRuntimeTask(ctx, windowsHubService, filepath.Join(m.cfg.InstallDir, "wheelmaker.exe"), "-d "+windowsStateDirArgs(stateDir)); err != nil {
		return err
	}
	if err := m.ensureRuntimeTask(ctx, windowsMonitorService, filepath.Join(m.cfg.InstallDir, "wheelmaker-monitor.exe"), windowsStateDirArgs(stateDir)); err != nil {
		return err
	}
	if !m.cfg.NoUpdater {
		if err := m.ensureRuntimeTask(ctx, windowsUpdaterService, filepath.Join(m.cfg.InstallDir, "wheelmaker-updater.exe"), windowsUpdaterArgs(m.cfg.RepoRoot, m.cfg.InstallDir, m.cfg.UpdaterTime)); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) Start(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Start-ScheduledTask -TaskName %s -ErrorAction Stop", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) Stop(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("$task=Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue; if ($null -ne $task) { Stop-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue }", psQuote(name), psQuote(name)))
	}
	return nil
}

func (m serviceManager) Restart(ctx context.Context, includeUpdater bool) error {
	if err := m.Stop(ctx, includeUpdater); err != nil {
		return err
	}
	return m.Start(ctx, includeUpdater)
}

func (m serviceManager) Status(ctx context.Context) error {
	for _, name := range []string{windowsHubService, windowsMonitorService, windowsUpdaterService} {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue | Format-Table -AutoSize", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) ensureRuntimeTask(ctx context.Context, name string, binary string, args string) error {
	_ = m.Stop(ctx, name == windowsUpdaterService)
	_ = m.removeLegacyService(ctx, name)
	_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Unregister-ScheduledTask -TaskName %s -Confirm:$false -ErrorAction SilentlyContinue", psQuote(name)))

	script := fmt.Sprintf(`$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute %s -Argument %s -WorkingDirectory %s
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DisallowStartIfOnBatteries:$false -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName %s -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force`, psQuote(binary), psQuote(strings.TrimSpace(args)), psQuote(filepath.Dir(binary)), psQuote(name))

	if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script); err != nil {
		return fmt.Errorf("register task %s: %w", name, err)
	}
	return nil
}

func (m serviceManager) removeLegacyService(ctx context.Context, name string) error {
	_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("$svc=Get-Service -Name %s -ErrorAction SilentlyContinue; if ($null -ne $svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name %s -Force -ErrorAction SilentlyContinue }", psQuote(name), psQuote(name)))
	_, _ = m.runner.Run(ctx, "", "sc.exe", "delete", name)
	return nil
}

func (m serviceManager) serviceNames(includeUpdater bool) []string {
	names := []string{windowsHubService, windowsMonitorService}
	if includeUpdater && !m.cfg.NoUpdater {
		names = append(names, windowsUpdaterService)
	}
	return names
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func windowsStateDirArgs(stateDir string) string {
	return fmt.Sprintf(`--dir "%s"`, strings.ReplaceAll(stateDir, `"`, `\"`))
}
