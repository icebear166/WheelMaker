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
	windowsHubService         = "WheelMaker"
	windowsMonitorService     = "WheelMakerMonitor"
	windowsUpdaterService     = "WheelMakerUpdater"
	windowsRuntimeAsUser      = "asuser"
	windowsRuntimeServiceMode = "service"
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

type windowsRuntimeProgram struct {
	Name        string
	DisplayName string
	Binary      string
	Args        string
	WorkingDir  string
}

var windowsIsElevated = windowsCurrentProcessElevated
var windowsRelaunchElevated = windowsRelaunchCurrentProcessElevated

func newServiceManager(cfg deployConfig, runner commandRunner) serviceManager {
	return serviceManager{cfg: resolveDefaults(cfg), runner: runner}
}

func (m serviceManager) CheckDeployPrerequisites(ctx context.Context) error {
	needAdmin, err := m.requiresAdministrator(ctx)
	if err != nil {
		return err
	}
	if !needAdmin {
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
	if m.runtimeMode() == windowsRuntimeAsUser {
		return m.configureScheduledTasks(ctx)
	}
	return m.configureServices(ctx)
}

func (m serviceManager) configureServices(ctx context.Context) error {
	stateDir := filepath.Dir(m.cfg.InstallDir)
	services := []windowsRuntimeService{
		windowsServiceSpec(windowsHubService, filepath.Join(m.cfg.InstallDir, "wheelmaker.exe"), "-d "+windowsStateDirArgs(stateDir)),
		windowsServiceSpec(windowsMonitorService, filepath.Join(m.cfg.InstallDir, "wheelmaker-monitor.exe"), windowsStateDirArgs(stateDir)),
	}
	if !m.cfg.NoUpdater {
		services = append(services, windowsServiceSpec(windowsUpdaterService, filepath.Join(m.cfg.InstallDir, "wheelmaker-updater.exe"), windowsUpdaterArgs(m.cfg.RepoRoot, m.cfg.InstallDir, m.cfg.UpdaterTime, m.runtimeMode())))
	}
	return m.ensureRuntimeServices(ctx, services)
}

func (m serviceManager) Start(ctx context.Context, includeUpdater bool) error {
	if m.runtimeMode() == windowsRuntimeAsUser {
		return m.startScheduledTasks(ctx, includeUpdater)
	}
	for _, name := range m.serviceNames(includeUpdater) {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Start-Service -Name %s -ErrorAction Stop", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) Stop(ctx context.Context, includeUpdater bool) error {
	if m.runtimeMode() == windowsRuntimeAsUser {
		return m.stopScheduledTasks(ctx, includeUpdater)
	}
	for _, name := range m.serviceNames(includeUpdater) {
		_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("$svc=Get-Service -Name %s -ErrorAction SilentlyContinue; if ($null -ne $svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name %s -Force -ErrorAction SilentlyContinue }", psQuote(name), psQuote(name)))
	}
	return nil
}

func (m serviceManager) PrepareInstall(ctx context.Context, includeUpdater bool) error {
	deleteRegistrations := !m.cfg.NoConfig
	names := windowsRuntimeNames()
	processNames := windowsRuntimeProcessNames()
	if !deleteRegistrations {
		names = m.serviceNames(includeUpdater)
		processNames = windowsRuntimeProcessNamesForServices(names)
	}
	script := windowsPrepareInstallScript(names, processNames, m.cfg.InstallDir, deleteRegistrations)
	if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script); err != nil {
		return fmt.Errorf("prepare Windows install: %w", err)
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
	if m.runtimeMode() == windowsRuntimeAsUser {
		return m.statusScheduledTasks(ctx)
	}
	for _, name := range []string{windowsHubService, windowsMonitorService, windowsUpdaterService} {
		filter := fmt.Sprintf("Name='%s'", name)
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Get-CimInstance Win32_Service -Filter %s -ErrorAction SilentlyContinue | Select-Object Name,State,StartMode,StartName,PathName | Format-Table -AutoSize", psQuote(filter))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) requiresAdministrator(ctx context.Context) (bool, error) {
	if m.runtimeMode() == windowsRuntimeAsUser {
		if m.cfg.NoConfig {
			return false, nil
		}
		installed, err := m.anyWindowsServicesInstalled(ctx)
		if err != nil {
			return false, err
		}
		return installed, nil
	}
	if m.cfg.Mode == modeService {
		return true, nil
	}
	return !m.cfg.NoConfig || !m.cfg.NoRestart, nil
}

func (m serviceManager) runtimeMode() string {
	mode := strings.ToLower(strings.TrimSpace(m.cfg.RuntimeMode))
	switch mode {
	case windowsRuntimeServiceMode:
		return windowsRuntimeServiceMode
	default:
		return windowsRuntimeAsUser
	}
}

func (m serviceManager) anyWindowsServicesInstalled(ctx context.Context) (bool, error) {
	names := windowsRuntimeNames()
	quoted := make([]string, 0, len(names))
	for _, name := range names {
		quoted = append(quoted, psQuote(name))
	}
	script := fmt.Sprintf(`$names = @(%s); foreach ($name in $names) { if ($null -ne (Get-Service -Name $name -ErrorAction SilentlyContinue)) { Write-Output 'true'; exit 0 } }; Write-Output 'false'`, strings.Join(quoted, ", "))
	out, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)
	if err != nil {
		return false, err
	}
	return strings.Contains(strings.ToLower(out), "true"), nil
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
	allNames := windowsPSStringArray(windowsRuntimeNames())

	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$localUser = ".\$env:USERNAME"
$services = %s
$allNames = %s

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
foreach ($name in $allNames) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}

foreach ($definition in $services) {
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
}`, defs.String(), allNames)

	if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script); err != nil {
		return fmt.Errorf("configure Windows services: %w", err)
	}
	return nil
}

func (m serviceManager) configureScheduledTasks(ctx context.Context) error {
	programs := m.runtimePrograms(m.runtimeMode())
	var defs strings.Builder
	defs.WriteString("@(\n")
	for _, program := range programs {
		defs.WriteString(fmt.Sprintf("  @{ Name = %s; DisplayName = %s; Binary = %s; Args = %s; WorkingDir = %s }\n", psQuote(program.Name), psQuote(program.DisplayName), psQuote(program.Binary), psQuote(program.Args), psQuote(program.WorkingDir)))
	}
	defs.WriteString(")")
	allNames := windowsPSStringArray(windowsRuntimeNames())

	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$definitions = %s
$allNames = %s

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

foreach ($name in $allNames) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Remove-WheelMakerService $name
}

foreach ($definition in $definitions) {
  $actionArgs = @{
    Execute = $definition.Binary
  }
  if (-not [string]::IsNullOrWhiteSpace($definition.Args)) {
    $actionArgs.Argument = $definition.Args
  }
  if (-not [string]::IsNullOrWhiteSpace($definition.WorkingDir)) {
    $actionArgs.WorkingDirectory = $definition.WorkingDir
  }
  $action = New-ScheduledTaskAction @actionArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel LeastPrivilege
  Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger $trigger -Principal $principal -Description $definition.DisplayName -Force | Out-Null
}`, defs.String(), allNames)

	if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script); err != nil {
		return fmt.Errorf("configure Windows scheduled tasks: %w", err)
	}
	return nil
}

func (m serviceManager) startScheduledTasks(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Start-ScheduledTask -TaskName %s -ErrorAction Stop", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) stopScheduledTasks(ctx context.Context, includeUpdater bool) error {
	for _, name := range m.serviceNames(includeUpdater) {
		_, _ = m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("$task=Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue; if ($null -ne $task) { Stop-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue }", psQuote(name), psQuote(name)))
	}
	return nil
}

func (m serviceManager) statusScheduledTasks(ctx context.Context) error {
	for _, name := range []string{windowsHubService, windowsMonitorService, windowsUpdaterService} {
		if _, err := m.runner.Run(ctx, "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", fmt.Sprintf("Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue | Select-Object TaskName,State,TaskPath | Format-Table -AutoSize", psQuote(name))); err != nil {
			return err
		}
	}
	return nil
}

func (m serviceManager) runtimePrograms(runtimeMode string) []windowsRuntimeProgram {
	stateDir := filepath.Dir(m.cfg.InstallDir)
	programs := []windowsRuntimeProgram{
		{
			Name:        windowsHubService,
			DisplayName: windowsHubService,
			Binary:      filepath.Join(m.cfg.InstallDir, "wheelmaker.exe"),
			Args:        "-d " + windowsStateDirArgs(stateDir),
			WorkingDir:  m.cfg.RepoRoot,
		},
		{
			Name:        windowsMonitorService,
			DisplayName: windowsMonitorService,
			Binary:      filepath.Join(m.cfg.InstallDir, "wheelmaker-monitor.exe"),
			Args:        windowsStateDirArgs(stateDir),
			WorkingDir:  m.cfg.RepoRoot,
		},
	}
	if !m.cfg.NoUpdater {
		programs = append(programs, windowsRuntimeProgram{
			Name:        windowsUpdaterService,
			DisplayName: windowsUpdaterService,
			Binary:      filepath.Join(m.cfg.InstallDir, "wheelmaker-updater.exe"),
			Args:        windowsUpdaterArgs(m.cfg.RepoRoot, m.cfg.InstallDir, m.cfg.UpdaterTime, runtimeMode),
			WorkingDir:  m.cfg.RepoRoot,
		})
	}
	return programs
}

func (m serviceManager) serviceNames(includeUpdater bool) []string {
	names := []string{windowsHubService, windowsMonitorService}
	if includeUpdater && !m.cfg.NoUpdater {
		names = append(names, windowsUpdaterService)
	}
	return names
}

func windowsRuntimeNames() []string {
	return []string{windowsHubService, windowsMonitorService, windowsUpdaterService}
}

func windowsRuntimeProcessNames() []string {
	return []string{"wheelmaker.exe", "wheelmaker-monitor.exe", "wheelmaker-updater.exe"}
}

func windowsRuntimeProcessNamesForServices(serviceNames []string) []string {
	out := make([]string, 0, len(serviceNames))
	for _, name := range serviceNames {
		switch name {
		case windowsHubService:
			out = append(out, "wheelmaker.exe")
		case windowsMonitorService:
			out = append(out, "wheelmaker-monitor.exe")
		case windowsUpdaterService:
			out = append(out, "wheelmaker-updater.exe")
		}
	}
	return out
}

func windowsPSStringArray(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, psQuote(value))
	}
	return "@(" + strings.Join(quoted, ", ") + ")"
}

func windowsPrepareInstallScript(serviceNames []string, processNames []string, installDir string, deleteRegistrations bool) string {
	return fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$names = %s
$processNames = %s
$installDir = %s
$deleteRegistrations = %s

function Test-WheelMakerInstallProcess($process) {
  $install = [string]$installDir
  if ([string]::IsNullOrWhiteSpace($install)) {
    return $false
  }
  $install = ($install.TrimEnd('\') + '\').ToLowerInvariant()
  $exe = [string]$process.ExecutablePath
  if (-not [string]::IsNullOrWhiteSpace($exe) -and $exe.ToLowerInvariant().StartsWith($install)) {
    return $true
  }
  $cmd = [string]$process.CommandLine
  return -not [string]::IsNullOrWhiteSpace($cmd) -and $cmd.ToLowerInvariant().Contains($install)
}

function Remove-WheelMakerService([string]$name) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $name -Force -ErrorAction Stop
  }
  if (-not $deleteRegistrations) {
    return
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

foreach ($name in $names) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($deleteRegistrations) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  }
  Remove-WheelMakerService $name
}

$procs = @(Get-CimInstance Win32_Process | Where-Object { $processNames -contains $_.Name -and (Test-WheelMakerInstallProcess $_) })
foreach ($proc in $procs) {
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $remaining = @(Get-CimInstance Win32_Process | Where-Object { $processNames -contains $_.Name -and (Test-WheelMakerInstallProcess $_) })
  if ($remaining.Count -eq 0) {
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
throw "Timed out stopping WheelMaker runtime processes"`, windowsPSStringArray(serviceNames), windowsPSStringArray(processNames), psQuote(filepath.Clean(installDir)), windowsPSBool(deleteRegistrations))
}

func windowsPSBool(value bool) string {
	if value {
		return "$true"
	}
	return "$false"
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func windowsStateDirArgs(stateDir string) string {
	return fmt.Sprintf(`--dir "%s"`, strings.ReplaceAll(stateDir, `"`, `\"`))
}
