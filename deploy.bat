@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$bat, [string]$repo) $lines=Get-Content -LiteralPath $bat; $idx=[Array]::IndexOf($lines, '# POWERSHELL'); if($idx -lt 0){ throw 'deploy.bat payload marker missing' }; $script=($lines[($idx + 1)..($lines.Count - 1)] -join [Environment]::NewLine); & ([ScriptBlock]::Create($script)) -RepoRoot $repo }" "%~f0" "%~dp0."
exit /b %ERRORLEVEL%
# POWERSHELL
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Deploy {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[INFO] $Message"
}

function Write-Fail {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[FAILED] $Message" -ForegroundColor Red
}

function Wait-ForExit {
  if ($env:WHEELMAKER_DEPLOY_NO_PAUSE) {
    return
  }
  Write-Host
  Read-Host "Press Enter to close" | Out-Null
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory
  )

  $oldLocation = Get-Location
  try {
    if ($WorkingDirectory) {
      Set-Location -LiteralPath $WorkingDirectory
    }
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath exited with code $LASTEXITCODE"
    }
  } finally {
    Set-Location -LiteralPath $oldLocation
  }
}

$repoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$homeDir = [Environment]::GetFolderPath("UserProfile")
$logDir = Join-Path $homeDir ".wheelmaker\log"
$logFile = Join-Path $homeDir ".wheelmaker\log\deploy.bat.log"

try {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $logFile -Value ("[{0}] deploy.bat entered" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

  Write-Host "============================================"
  Write-Host "  WheelMaker All-in-One Deploy"
  Write-Host "============================================"
  Write-Host
  Write-Host "  migrate legacy runtime, then install the signed stable release"
  Write-Host
  Write-Host "============================================"
  Write-Host

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js 22 or newer is required"
  }
  $nodeVersionText = & $nodeCommand.Source --version
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to determine the installed Node.js version"
  }
  $nodeVersion = [Version]$nodeVersionText.TrimStart("v")
  if ($nodeVersion.Major -lt 22) {
    throw "Node.js 22 or newer is required; found $nodeVersionText"
  }

  $sourceDeploy = Join-Path $repoRoot "scripts\deploy\deploy.mjs"
  if (-not (Test-Path -LiteralPath $sourceDeploy -PathType Leaf)) {
    throw "Deployment launcher is missing: $sourceDeploy"
  }
  $installDir = Join-Path $homeDir ".wheelmaker"
  $deployPath = Join-Path $homeDir ".wheelmaker\deploy.mjs"
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Copy-Item -LiteralPath $sourceDeploy -Destination $deployPath -Force

  Write-Deploy "Removing the legacy runtime..."
  Invoke-Checked -FilePath $nodeCommand.Source -Arguments @($deployPath, "migrate-uninstall")
  Write-Deploy "Installing the signed stable release..."
  Invoke-Checked -FilePath $nodeCommand.Source -Arguments @($deployPath)

  Write-Host
  Write-Host "[OK] deploy complete"
  Wait-ForExit
  exit 0
} catch {
  Add-Content -LiteralPath $logFile -Value ("[{0}] failed: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message)
  Write-Host
  Write-Fail $_.Exception.Message
  Wait-ForExit
  exit 1
}
