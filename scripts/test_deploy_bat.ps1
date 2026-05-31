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

Assert-Contains -Text $deployBat -Needle "WheelMaker All-in-One Deploy"
Assert-Contains -Text $deployBat -Needle "wheelmaker-deploy.exe"
Assert-Contains -Text $deployBat -Needle ".wheelmaker\build\bootstrap"
Assert-Contains -Text $deployBat -Needle "Windows service deployment requires Administrator privileges"
Assert-Contains -Text $deployBat -Needle "Start-Process"
Assert-Contains -Text $deployBat -Needle "Verb RunAs"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_ELEVATED"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_NO_PAUSE"
Assert-Contains -Text $deployBat -Needle "administrator relaunch exited with code"
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

Write-Host "deploy.bat deploy-cli wrapper checks passed"
