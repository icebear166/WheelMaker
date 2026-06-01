@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "& { param([string]$bat, [string]$repo, [Parameter(ValueFromRemainingArguments=$true)][string[]]$deployArgs) $lines=Get-Content -LiteralPath $bat; $idx=[Array]::IndexOf($lines, '# POWERSHELL'); if($idx -lt 0){ throw 'deploy.bat payload marker missing' }; $script=($lines[($idx + 1)..($lines.Count - 1)] -join [Environment]::NewLine); & ([ScriptBlock]::Create($script)) -RepoRoot $repo -DeployArgs $deployArgs }" "%~f0" "%~dp0." %*
exit /b %ERRORLEVEL%
# POWERSHELL
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [string[]]$DeployArgs = @()
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
  Add-Content -LiteralPath $logFile -Value ("[{0}] deploy.bat entered args={1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), ($DeployArgs -join " "))

  Write-Host "============================================"
  Write-Host "  WheelMaker All-in-One Deploy"
  Write-Host "============================================"
  Write-Host
  Write-Host "  wheelmaker-deploy deploy: update + build + install + configure + publish web"
  Write-Host
  Write-Host "============================================"
  Write-Host

  $bootstrapDir = Join-Path $homeDir ".wheelmaker\build\bootstrap"
  $deployExe = Join-Path $bootstrapDir "wheelmaker-deploy.exe"
  $deploySourceDir = Join-Path $repoRoot "server\cmd\wheelmaker-deploy"
  $goCommand = Get-Command go -ErrorAction SilentlyContinue

  if ($goCommand -and (Test-Path -LiteralPath $deploySourceDir)) {
    Write-Deploy "Building bootstrap wheelmaker-deploy.exe..."
    New-Item -ItemType Directory -Force -Path $bootstrapDir | Out-Null
    Write-Deploy "Running go build for wheelmaker-deploy.exe"
    Invoke-Checked -FilePath "go" -Arguments @("build", "-o", $deployExe, ".\cmd\wheelmaker-deploy") -WorkingDirectory (Join-Path $repoRoot "server")
  } elseif (Test-Path -LiteralPath $deployExe) {
    Write-Deploy "Using existing bootstrap wheelmaker-deploy.exe: $deployExe"
  } else {
    throw "No existing wheelmaker-deploy.exe and Go/source are unavailable to build it"
  }

  Write-Deploy "Running wheelmaker-deploy deploy..."
  Write-Deploy "Bootstrap CLI: $deployExe"
  Invoke-Checked -FilePath $deployExe -Arguments (@("deploy", "--repo", $repoRoot) + $DeployArgs)

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
