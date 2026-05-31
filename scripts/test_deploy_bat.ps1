$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$deployBatPath = Join-Path $repoRoot "deploy.bat"
$deployBat = Get-Content -LiteralPath $deployBatPath -Raw

function Assert-Contains {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Needle
  )

  if (-not $Text.Contains($Needle)) {
    throw "deploy.bat does not contain expected text: $Needle"
  }
}

function Assert-NotContains {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Needle
  )

  if ($Text.Contains($Needle)) {
    throw "deploy.bat should not contain text: $Needle"
  }
}

function Assert-NoBatchIfBlocks {
  param([string]$Text)

  $lines = $Text -split "`r?`n"
  $bad = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '^\s*if\b.*\(\s*$' -or $line -match '^\s*\)\s*$') {
      $bad += ("{0}: {1}" -f ($i + 1), $line)
    }
  }
  if ($bad.Count -gt 0) {
    throw "deploy.bat should not use parenthesized batch if blocks:`n$($bad -join "`n")"
  }
}

Assert-Contains -Text $deployBat -Needle "WheelMaker All-in-One Deploy"
Assert-Contains -Text $deployBat -Needle "wheelmaker-deploy.exe"
Assert-Contains -Text $deployBat -Needle ".wheelmaker\build\bootstrap"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_STAY_OPEN"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_LAUNCH_DRY_RUN"
Assert-Contains -Text $deployBat -Needle "Dry-run stable window command"
Assert-Contains -Text $deployBat -Needle ":LaunchStableWindow"
Assert-Contains -Text $deployBat -Needle "goto StableWindowReady"
Assert-Contains -Text $deployBat -Needle ":StableWindowReady"
Assert-Contains -Text $deployBat -Needle 'start "WheelMaker Deploy" "%ComSpec%" /k call "%~f0" %*'
Assert-Contains -Text $deployBat -Needle ".wheelmaker\log\deploy.bat.log"
Assert-Contains -Text $deployBat -Needle "Windows service deployment requires Administrator privileges"
Assert-Contains -Text $deployBat -Needle "Start-Process"
Assert-Contains -Text $deployBat -Needle "cmd.exe"
Assert-Contains -Text $deployBat -Needle "/k"
Assert-Contains -Text $deployBat -Needle "Verb RunAs"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_ELEVATED"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_NO_PAUSE"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_FORCE_NOT_ADMIN"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_ELEVATE_DRY_RUN"
Assert-Contains -Text $deployBat -Needle "Dry-run administrator relaunch command"
Assert-Contains -Text $deployBat -Needle "administrator relaunch exited with code"
Assert-Contains -Text $deployBat -Needle "EnableDelayedExpansion"
Assert-Contains -Text $deployBat -Needle "!_ELEVATE_EXIT!"
Assert-Contains -Text $deployBat -Needle "pause"
Assert-Contains -Text $deployBat -Needle "go build"
Assert-Contains -Text $deployBat -Needle "[INFO] Running wheelmaker-deploy deploy"
Assert-Contains -Text $deployBat -Needle " deploy "
Assert-NotContains -Text $deployBat -Needle 'scripts\refresh_server.ps1'
Assert-NotContains -Text $deployBat -Needle 'pushd "%~dp0app"'
Assert-NotContains -Text $deployBat -Needle "npm run build:web:release"
Assert-NotContains -Text $deployBat -Needle "[FAILED] web publish exited with code"
Assert-NotContains -Text $deployBat -Needle "call npm ci --include=dev"
Assert-NotContains -Text $deployBat -Needle "syncing app Web dependencies"
Assert-NotContains -Text $deployBat -Needle "publish_desktop.ps1"
Assert-NotContains -Text $deployBat -Needle "publish-desktop.bat"
Assert-NotContains -Text $deployBat -Needle "if not defined WHEELMAKER_DEPLOY_STAY_OPEN if not defined WHEELMAKER_DEPLOY_NO_PAUSE ("
Assert-NoBatchIfBlocks -Text $deployBat

Write-Host "deploy.bat deploy-cli wrapper checks passed"
