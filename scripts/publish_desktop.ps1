param(
  [string]$RepoRoot = "",
  [string]$OutputDir = (Join-Path -Path $HOME -ChildPath ".wheelmaker\desktop"),
  [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Text)
  Write-Host ("==> {0}" -f $Text)
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name, [string]$Hint = "")
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if ([string]::IsNullOrWhiteSpace($Hint)) { throw ("required command not found in PATH: {0}" -f $Name) }
  throw ("required command not found in PATH: {0}. {1}" -f $Name, $Hint)
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$FailureMessage = ""
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -eq 0) { return }
  if ([string]::IsNullOrWhiteSpace($FailureMessage)) {
    throw ("command failed: {0} {1} (exit={2})" -f $FilePath, ($Arguments -join " "), $LASTEXITCODE)
  }
  throw ("{0} (exit={1})" -f $FailureMessage, $LASTEXITCODE)
}

function Get-GitValue {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  Push-Location $script:RepoRoot
  try {
    $value = ((& git @Arguments) | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0) { throw ("git {0} failed (exit={1})" -f ($Arguments -join " "), $LASTEXITCODE) }
    return ([string]$value).Trim()
  } finally {
    Pop-Location
  }
}

function Build-DesktopResource {
  Assert-Command -Name "go" -Hint "Install Go 1.26+."
  if (-not (Test-Path -LiteralPath $script:DesktopIconPng)) {
    throw ("desktop icon PNG is missing: {0}" -f $script:DesktopIconPng)
  }
  Write-Step "generate desktop exe icon resource"
  if ($WhatIf) {
    Write-Host ("[whatif] go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64 --out {0} --no-suffix --manifest gui --icon {1}" -f $script:DesktopSyso, $script:DesktopIconPng)
    return
  }
  Push-Location (Join-Path $script:RepoRoot "server\cmd\wheelmaker-desktop")
  try {
    Invoke-Checked -FilePath "go" -Arguments @(
      "run", "github.com/tc-hib/go-winres@v0.3.3", "simply",
      "--arch", "amd64", "--out", $script:DesktopSyso, "--no-suffix",
      "--manifest", "gui", "--icon", $script:DesktopIconPng,
      "--file-description", "WheelMaker Desktop",
      "--product-name", "WheelMaker Desktop",
      "--original-filename", "WheelMakerDesktop.exe"
    ) -FailureMessage "desktop Windows resource generation failed"
  } finally {
    Pop-Location
  }
}

function Build-DesktopBinary {
  Assert-Command -Name "go" -Hint "Install Go 1.26+."
  Push-Location $script:ServerRoot
  try {
    Write-Step ("build WheelMakerDesktop.exe: {0}" -f $script:DesktopExe)
    $buildArgs = @("build", "-ldflags", "-H windowsgui", "-o", $script:DesktopExe, "./cmd/wheelmaker-desktop/")
    if ($WhatIf) {
      Write-Host ("[whatif] go build -ldflags -H windowsgui -o {0} ./cmd/wheelmaker-desktop/" -f $script:DesktopExe)
      return
    }
    New-Item -ItemType Directory -Path $script:OutputDir -Force | Out-Null
    Invoke-Checked -FilePath "go" -Arguments $buildArgs -FailureMessage "desktop binary build failed"
  } finally {
    Pop-Location
  }
}

function Assert-RemoteOnlyDesktopBinary {
  if ($WhatIf) { return }
  $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($script:DesktopExe))
  foreach ($needle in @("service-worker.js", "manifest.webmanifest", ":9632")) {
    if ($text.Contains($needle)) {
      throw ("desktop binary contains legacy Workspace asset marker: {0}" -f $needle)
    }
  }
}

function Write-DesktopReleaseManifest {
  Assert-Command -Name "git" -Hint "Install Git and ensure git.exe is available."
  $manifest = [ordered]@{
    "schemaVersion" = 1
    "repo" = $script:RepoRoot
    "branch" = Get-GitValue -Arguments @("branch", "--show-current")
    "sha" = Get-GitValue -Arguments @("rev-parse", "HEAD")
    "builtAt" = (Get-Date).ToUniversalTime().ToString("o")
    "desktopExe" = $script:DesktopExe
    "webMode" = "remote-only"
    "embeddedAsset" = "bootstrap/index.html"
  }
  if ($WhatIf) { Write-Host ("[whatif] write {0}" -f $script:ManifestPath); return }
  New-Item -ItemType Directory -Path $script:OutputDir -Force | Out-Null
  $json = $manifest | ConvertTo-Json -Depth 4
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($script:ManifestPath, $json, $utf8NoBom)
}

function New-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "WheelMaker Desktop.lnk"
  Write-Step ("create desktop shortcut: {0}" -f $shortcutPath)
  if ($WhatIf) { Write-Host ("[whatif] CreateShortcut {0} -> {1}" -f $shortcutPath, $script:DesktopExe); return }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $script:DesktopExe
  $shortcut.WorkingDirectory = $script:OutputDir
  $shortcut.IconLocation = $script:DesktopExe
  $shortcut.Save()
}

$script:RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path } else { (Resolve-Path $RepoRoot).Path }
$script:ServerRoot = Join-Path $script:RepoRoot "server"
$script:DesktopSyso = Join-Path $script:RepoRoot "server\cmd\wheelmaker-desktop\desktop_windows.syso"
$script:OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
$script:DesktopIconPng = Join-Path $script:RepoRoot "server\cmd\wheelmaker-desktop\winres\icon.png"
$script:DesktopExe = Join-Path $script:OutputDir "WheelMakerDesktop.exe"
$script:ManifestPath = Join-Path $script:OutputDir "desktop-release.json"

Build-DesktopResource
Build-DesktopBinary
Assert-RemoteOnlyDesktopBinary
Write-DesktopReleaseManifest
New-DesktopShortcut
Write-Step "desktop publish complete"
