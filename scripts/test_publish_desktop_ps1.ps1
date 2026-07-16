$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $repoRoot "scripts\publish_desktop.ps1"
$batPath = Join-Path $repoRoot "publish-desktop.bat"

if (-not (Test-Path $scriptPath)) { throw "publish_desktop.ps1 is missing" }
if (-not (Test-Path $batPath)) { throw "publish-desktop.bat is missing" }

$script = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
$bat = Get-Content -LiteralPath $batPath -Raw -Encoding UTF8

function Assert-Contains {
  param([string]$Label, [string]$Text, [string]$Needle)
  if (-not $Text.Contains($Needle)) {
    throw "$Label does not contain expected text: $Needle"
  }
}

function Assert-NotContains {
  param([string]$Label, [string]$Text, [string]$Needle)
  if ($Text.Contains($Needle)) {
    throw "$Label should not contain text: $Needle"
  }
}

Assert-Contains "publish_desktop.ps1" $script "scripts\release.mjs"
Assert-Contains "publish_desktop.ps1" $script '"build", "--with-desktop"'
Assert-Contains "publish_desktop.ps1" $script ".release-out"
Assert-Contains "publish_desktop.ps1" $script "Copy-Item"
Assert-Contains "publish_desktop.ps1" $script "WheelMakerDesktop.exe"
Assert-Contains "publish_desktop.ps1" $script "Assert-RemoteOnlyDesktopBinary"
Assert-Contains "publish_desktop.ps1" $script '$shortcut.IconLocation = $script:DesktopExe'
Assert-Contains "publish_desktop.ps1" $script "CreateShortcut"
Assert-Contains "publish_desktop.ps1" $script "Desktop"
Assert-NotContains "publish_desktop.ps1" $script "go build"
Assert-NotContains "publish_desktop.ps1" $script "go-winres"
Assert-NotContains "publish_desktop.ps1" $script "desktop_windows.syso"
Assert-NotContains "publish_desktop.ps1" $script "npm ci"
Assert-NotContains "publish_desktop.ps1" $script "build:web:release"
Assert-Contains "publish-desktop.bat" $bat "scripts\publish_desktop.ps1"

$desktopIconPath = Join-Path $repoRoot "server\cmd\wheelmaker-desktop\winres\icon.png"
if (-not (Test-Path -LiteralPath $desktopIconPath)) { throw "desktop pre-rendered icon is missing" }
if ((Get-Item -LiteralPath $desktopIconPath).Length -le 0) { throw "desktop pre-rendered icon is empty" }

Write-Host "desktop publish script checks passed"
