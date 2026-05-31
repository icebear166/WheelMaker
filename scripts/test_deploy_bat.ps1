$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$deployBatPath = Join-Path $repoRoot "deploy.bat"
$deployPs1Path = Join-Path $repoRoot "scripts\deploy-windows.ps1"
$deployBat = Get-Content -LiteralPath $deployBatPath -Raw
if (-not (Test-Path $deployPs1Path)) {
  throw "scripts\deploy-windows.ps1 is missing"
}
$deployPs1 = Get-Content -LiteralPath $deployPs1Path -Raw

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

Assert-Contains -Text $deployBat -Needle "scripts\deploy-windows.ps1"
Assert-Contains -Text $deployBat -Needle "powershell.exe"
Assert-NotContains -Text $deployBat -Needle "set "
Assert-NotContains -Text $deployBat -Needle "Start-Process"
Assert-NotContains -Text $deployBat -Needle "cmd.exe"
Assert-NotContains -Text $deployBat -Needle "EnableDelayedExpansion"

Assert-Contains -Text $deployPs1 -Needle "WheelMaker All-in-One Deploy"
Assert-Contains -Text $deployPs1 -Needle "wheelmaker-deploy.exe"
Assert-Contains -Text $deployPs1 -Needle ".wheelmaker\build\bootstrap"
Assert-Contains -Text $deployPs1 -Needle ".wheelmaker\log\deploy.bat.log"
Assert-Contains -Text $deployPs1 -Needle "Windows service deployment requires Administrator privileges"
Assert-Contains -Text $deployPs1 -Needle "Start-Process"
Assert-Contains -Text $deployPs1 -Needle "Verb RunAs"
Assert-Contains -Text $deployPs1 -Needle "WHEELMAKER_DEPLOY_NO_PAUSE"
Assert-Contains -Text $deployPs1 -Needle "WHEELMAKER_DEPLOY_FORCE_NOT_ADMIN"
Assert-Contains -Text $deployPs1 -Needle "WHEELMAKER_DEPLOY_ELEVATE_DRY_RUN"
Assert-Contains -Text $deployPs1 -Needle "Dry-run administrator relaunch command"
Assert-Contains -Text $deployPs1 -Needle "go build"
Assert-Contains -Text $deployPs1 -Needle "Running wheelmaker-deploy deploy"
Assert-NotContains -Text $deployBat -Needle 'scripts\refresh_server.ps1'
Assert-NotContains -Text $deployBat -Needle 'pushd "%~dp0app"'
Assert-NotContains -Text $deployBat -Needle "npm run build:web:release"
Assert-NotContains -Text $deployBat -Needle "[FAILED] web publish exited with code"
Assert-NotContains -Text $deployBat -Needle "call npm ci --include=dev"
Assert-NotContains -Text $deployBat -Needle "syncing app Web dependencies"
Assert-NotContains -Text $deployBat -Needle "publish_desktop.ps1"
Assert-NotContains -Text $deployBat -Needle "publish-desktop.bat"
Assert-NoBatchIfBlocks -Text $deployBat

Write-Host "deploy.bat deploy-cli wrapper checks passed"
