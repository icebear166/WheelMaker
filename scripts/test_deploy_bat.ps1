$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$deployBatPath = Join-Path $repoRoot "deploy.bat"
$deployPs1Path = Join-Path $repoRoot "scripts\deploy-windows.ps1"
$deployBat = Get-Content -LiteralPath $deployBatPath -Raw
if (Test-Path $deployPs1Path) {
  throw "scripts\deploy-windows.ps1 should not exist; Windows deploy must be contained in deploy.bat"
}

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
  $markerIndex = [Array]::IndexOf($lines, "# POWERSHELL")
  if ($markerIndex -ge 0) {
    $lines = $lines[0..($markerIndex - 1)]
  }
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

Assert-Contains -Text $deployBat -Needle "powershell.exe"
Assert-NotContains -Text $deployBat -Needle "Start-Process"
Assert-NotContains -Text $deployBat -Needle "cmd.exe"
Assert-NotContains -Text $deployBat -Needle "EnableDelayedExpansion"

Assert-Contains -Text $deployBat -Needle "WheelMaker All-in-One Deploy"
Assert-Contains -Text $deployBat -Needle "scripts\deploy\deploy.mjs"
Assert-Contains -Text $deployBat -Needle ".wheelmaker\deploy.mjs"
Assert-Contains -Text $deployBat -Needle ".wheelmaker\log\deploy.bat.log"
Assert-Contains -Text $deployBat -Needle "WHEELMAKER_DEPLOY_NO_PAUSE"
Assert-Contains -Text $deployBat -Needle "Get-Command node"
Assert-Contains -Text $deployBat -Needle "Node.js 22 or newer"
Assert-Contains -Text $deployBat -Needle "Copy-Item"
Assert-Contains -Text $deployBat -Needle "migrate-uninstall"
Assert-Contains -Text $deployBat -Needle 'Invoke-Checked -FilePath $nodeCommand.Source -Arguments @($deployPath)'
Assert-NotContains -Text $deployBat -Needle "wheelmaker-deploy"
Assert-NotContains -Text $deployBat -Needle ".wheelmaker\build\bootstrap"
Assert-NotContains -Text $deployBat -Needle "go build"
Assert-NotContains -Text $deployBat -Needle "npm"
Assert-NotContains -Text $deployBat -Needle "git"
Assert-NotContains -Text $deployBat -Needle "Verb RunAs"
Assert-NotContains -Text $deployBat -Needle "Windows service deployment requires Administrator privileges"
Assert-NotContains -Text $deployBat -Needle 'scripts\refresh_server.ps1'
Assert-NotContains -Text $deployBat -Needle 'scripts\deploy-windows.ps1'
Assert-NotContains -Text $deployBat -Needle 'pushd "%~dp0app"'
Assert-NotContains -Text $deployBat -Needle "npm run build:web:release"
Assert-NotContains -Text $deployBat -Needle "[FAILED] web publish exited with code"
Assert-NotContains -Text $deployBat -Needle "call npm ci --include=dev"
Assert-NotContains -Text $deployBat -Needle "syncing app Web dependencies"
Assert-NoBatchIfBlocks -Text $deployBat

Write-Host "deploy.bat Node migration wrapper checks passed"
