param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$knownNames = @('nginx', 'nginx-service')
$services = @(Get-Service -Name $knownNames -ErrorAction SilentlyContinue)
if ($services.Count -eq 0) {
  [Console]::Error.WriteLine('No known nginx service was detected. No changes were made; inspect the service manager manually.')
  exit 2
}

foreach ($service in $services) {
  if ($DryRun) {
    Write-Output "Would stop and disable $($service.Name)"
    continue
  }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $service.Name -Force -ErrorAction Stop
  }
  Set-Service -Name $service.Name -StartupType Disabled
  Write-Output "Stopped and disabled $($service.Name). Package, configuration, and certificates were left untouched."
}
