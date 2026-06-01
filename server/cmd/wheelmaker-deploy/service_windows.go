//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
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

type windowsRuntimeService struct {
	Name        string
	DisplayName string
	BinaryPath  string
}

var windowsIsElevated = windowsCurrentProcessElevated
var windowsRelaunchElevated = windowsRelaunchCurrentProcessElevated

func newServiceManager(cfg deployConfig, runner commandRunner) serviceManager {
	return serviceManager{cfg: resolveDefaults(cfg), runner: runner}
}

func (m serviceManager) CheckDeployPrerequisites(ctx context.Context) error {
	if !m.requiresAdministrator() {
		return nil
	}
	elevated, err := windowsIsElevated()
	if err != nil {
		return err
	}
	if elevated {
		return nil
	}
	_ = ctx
	return windowsRelaunchElevated()
}

func (m serviceManager) Configure(ctx context.Context) error {
	stateDir := filepath.Dir(m.cfg.InstallDir)
	services := []windowsRuntimeService{
		windowsServiceSpec(windowsHubService, filepath.Join(m.cfg.InstallDir, "wheelmaker.exe"), "-d "+windowsStateDirArgs(stateDir)),
		windowsServiceSpec(windowsMonitorService, filepath.Join(m.cfg.InstallDir, "wheelmaker-monitor.exe"), windowsStateDirArgs(stateDir)),
	}
	if !m.cfg.NoUpdater {
		services = append(services, windowsServiceSpec(windowsUpdaterService, filepath.Join(m.cfg.InstallDir, "wheelmaker-updater.exe"), windowsUpdaterArgs(m.cfg.RepoRoot, m.cfg.InstallDir, m.cfg.UpdaterTime)))
	}
	return m.ensureRuntimeServices(ctx, services)
}

func (m serviceManager) Start(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Start-Service -Name %s -ErrorAction Stop", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) Stop(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("$svc=Get-Service -Name %s -ErrorAction SilentlyContinue; if ($null -ne $svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name %s -Force -ErrorAction SilentlyContinue }", psQuote(name), psQuote(name)))
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
		filter := fmt.Sprintf("Name='%s'", name)
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Get-CimInstance Win32_Service -Filter %s -ErrorAction SilentlyContinue | Select-Object Name,State,StartMode,StartName,PathName | Format-Table -AutoSize", psQuote(filter))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) requiresAdministrator() bool {
	if m.cfg.Mode == modeService {
		return true
	}
	return !m.cfg.NoConfig || !m.cfg.NoRestart
}

func windowsCurrentProcessElevated() (bool, error) {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return false, fmt.Errorf("open process token: %w", err)
	}
	defer token.Close()
	return token.IsElevated(), nil
}

func windowsRelaunchCurrentProcessElevated() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}
	script := windowsElevatedRelaunchScript(exe, os.Args[1:])
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run elevated wheelmaker-deploy: %w", err)
	}
	return errElevatedChildCompleted
}

func windowsElevatedRelaunchScript(exe string, args []string) string {
	childCommand := psInvokeCommand(exe, args) + `; $code = $global:LASTEXITCODE; if ($null -eq $code) { $code = 0 }; if (-not $env:WHEELMAKER_DEPLOY_NO_PAUSE) { Write-Host ''; Read-Host 'Press Enter to close elevated deploy' | Out-Null }; exit $code`
	return fmt.Sprintf(`$p = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', %s) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`, psQuote(childCommand))
}

func psInvokeCommand(exe string, args []string) string {
	parts := []string{"&", psQuote(exe)}
	for _, arg := range args {
		parts = append(parts, psQuote(arg))
	}
	return strings.Join(parts, " ")
}

func windowsServiceSpec(name string, binary string, args string) windowsRuntimeService {
	return windowsRuntimeService{
		Name:        name,
		DisplayName: name,
		BinaryPath:  windowsServiceBinaryPath(binary, args),
	}
}

func windowsServiceBinaryPath(binary string, args string) string {
	path := `"` + strings.ReplaceAll(binary, `"`, `\"`) + `"`
	if strings.TrimSpace(args) != "" {
		path += " " + strings.TrimSpace(args)
	}
	return path
}

func (m serviceManager) ensureRuntimeServices(ctx context.Context, services []windowsRuntimeService) error {
	var defs strings.Builder
	defs.WriteString("@(\n")
	for _, service := range services {
		defs.WriteString(fmt.Sprintf("  @{ Name = %s; DisplayName = %s; BinaryPath = %s }\n", psQuote(service.Name), psQuote(service.DisplayName), psQuote(service.BinaryPath)))
	}
	defs.WriteString(")")

	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$localUser = ".\$env:USERNAME"
$services = %s

function Get-WheelMakerServiceInfo([string]$name) {
  Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue
}

function Test-CurrentUserService($serviceInfo) {
  if ($null -eq $serviceInfo) {
    return $false
  }
  $startName = [string]$serviceInfo.StartName
  return $startName -ieq $currentUser -or $startName -ieq $localUser
}

function Remove-WheelMakerService([string]$name) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
  }
  sc.exe delete $name | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if ($null -eq (Get-Service -Name $name -ErrorAction SilentlyContinue)) {
      return
    }
  }
  throw "Timed out deleting service $name"
}

$needCredential = $false
foreach ($definition in $services) {
  Unregister-ScheduledTask -TaskName $definition.Name -Confirm:$false -ErrorAction SilentlyContinue
  $serviceInfo = Get-WheelMakerServiceInfo $definition.Name
  if (-not (Test-CurrentUserService $serviceInfo)) {
    $needCredential = $true
  }
}

$credential = $null
if ($needCredential) {
  $credential = Get-Credential -UserName $currentUser -Message 'WheelMaker service account password'
}

foreach ($definition in $services) {
  $serviceInfo = Get-WheelMakerServiceInfo $definition.Name
  if (Test-CurrentUserService $serviceInfo) {
    $service = Get-Service -Name $definition.Name -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne 'Stopped') {
      Stop-Service -Name $definition.Name -Force -ErrorAction SilentlyContinue
    }
    Set-ItemProperty -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Services\{0}" -f $definition.Name) -Name ImagePath -Value $definition.BinaryPath
    sc.exe config $definition.Name start= auto | Out-Null
  } else {
    Remove-WheelMakerService $definition.Name
    New-Service -Name $definition.Name -DisplayName $definition.DisplayName -BinaryPathName $definition.BinaryPath -StartupType Automatic -Credential $credential | Out-Null
  }
  sc.exe failure $definition.Name reset= 300 actions= restart/5000/restart/5000/restart/5000 | Out-Null
}`, defs.String())

	if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script); err != nil {
		return fmt.Errorf("configure Windows services: %w", err)
	}
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
