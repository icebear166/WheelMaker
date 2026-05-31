param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$DeployArgs
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

function Quote-CommandArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Wait-ForExit {
  if ($env:WHEELMAKER_DEPLOY_NO_PAUSE) {
    return
  }
  Write-Host
  Read-Host "Press Enter to close"
}

function Invoke-ElevatedSelf {
  param([string[]]$ArgsToForward)

  Write-Deploy "Windows service deployment requires Administrator privileges."
  Write-Deploy "Relaunching deploy-windows.ps1 as Administrator..."

  $quoted = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Quote-CommandArgument $PSCommandPath)
  )
  foreach ($arg in $ArgsToForward) {
    $quoted += Quote-CommandArgument $arg
  }
  $argumentLine = $quoted -join " "

  if ($env:WHEELMAKER_DEPLOY_ELEVATE_DRY_RUN) {
    Write-Deploy "Dry-run administrator relaunch command:"
    Write-Host "powershell.exe $argumentLine"
    return 0
  }

  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru
  return $proc.ExitCode
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

function Test-ArgPresent {
  param(
    [string[]]$ArgsToSearch,
    [string]$Name
  )
  return $ArgsToSearch -contains $Name
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$homeDir = [Environment]::GetFolderPath("UserProfile")
$logDir = Join-Path $homeDir ".wheelmaker\log"
$logFile = Join-Path $homeDir ".wheelmaker\log\deploy.bat.log"

try {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $logFile -Value ("[{0}] deploy-windows.ps1 entered args={1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), ($DeployArgs -join " "))

  Write-Host "============================================"
  Write-Host "  WheelMaker All-in-One Deploy"
  Write-Host "============================================"
  Write-Host
  Write-Host "  wheelmaker-deploy deploy: update + build + install + configure + publish web"
  Write-Host
  Write-Host "============================================"
  Write-Host

  $needsAdmin = -not (Test-ArgPresent -ArgsToSearch $DeployArgs -Name "--no-config")
  if ($env:WHEELMAKER_DEPLOY_FORCE_NOT_ADMIN) {
    $isAdmin = $false
  } else {
    $isAdmin = Test-IsAdministrator
  }
  if ($needsAdmin -and -not $isAdmin) {
    $exitCode = Invoke-ElevatedSelf -ArgsToForward $DeployArgs
    if ($exitCode -ne 0) {
      throw "administrator relaunch exited with code $exitCode"
    }
    exit 0
  }

  $bootstrapDir = Join-Path $homeDir ".wheelmaker\build\bootstrap"
  $deployExe = Join-Path $bootstrapDir "wheelmaker-deploy.exe"

  Write-Deploy "Building bootstrap wheelmaker-deploy.exe..."
  if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go is required to build wheelmaker-deploy.exe"
  }
  New-Item -ItemType Directory -Force -Path $bootstrapDir | Out-Null
  Write-Deploy "Running go build for wheelmaker-deploy.exe"
  Invoke-Checked -FilePath "go" -Arguments @("build", "-o", $deployExe, ".\cmd\wheelmaker-deploy") -WorkingDirectory (Join-Path $repoRoot "server")

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
