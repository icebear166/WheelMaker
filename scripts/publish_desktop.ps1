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
  if ([string]::IsNullOrWhiteSpace($Hint)) {
    throw ("required command not found in PATH: {0}" -f $Name)
  }
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

function Get-SourceShortSha {
  $value = (& git -C $script:RepoRoot rev-parse --short=12 HEAD | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) {
    throw ("git rev-parse failed (exit={0})" -f $LASTEXITCODE)
  }
  $sha = ([string]$value).Trim()
  if ($sha -notmatch "^[0-9a-f]{12}$") {
    throw ("unexpected source SHA: {0}" -f $sha)
  }
  return $sha
}

function Build-And-CopyDesktop {
  $releaseScript = Join-Path $script:RepoRoot "scripts\release.mjs"
  $releaseArgs = @("build", "--with-desktop")
  Write-Step "build Desktop through the release pipeline"
  if ($WhatIf) {
    Write-Host ("[whatif] node {0} {1}" -f $releaseScript, ($releaseArgs -join " "))
    Write-Host ("[whatif] Copy-Item {0} -> {1}" -f $script:BuiltDesktopExe, $script:DesktopExe)
    return
  }

  Push-Location $script:RepoRoot
  try {
    Invoke-Checked -FilePath "node" -Arguments (@($releaseScript) + $releaseArgs) -FailureMessage "release build failed"
  } finally {
    Pop-Location
  }
  if (-not (Test-Path -LiteralPath $script:BuiltDesktopExe)) {
    throw ("release build did not create Desktop executable: {0}" -f $script:BuiltDesktopExe)
  }
  New-Item -ItemType Directory -Path $script:OutputDir -Force | Out-Null
  Copy-Item -LiteralPath $script:BuiltDesktopExe -Destination $script:DesktopExe -Force
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

function New-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "WheelMaker Desktop.lnk"
  Write-Step ("create desktop shortcut: {0}" -f $shortcutPath)
  if ($WhatIf) {
    Write-Host ("[whatif] CreateShortcut {0} -> {1}" -f $shortcutPath, $script:DesktopExe)
    return
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $script:DesktopExe
  $shortcut.WorkingDirectory = $script:OutputDir
  $shortcut.IconLocation = $script:DesktopExe
  $shortcut.Save()
}

Assert-Command -Name "node" -Hint "Install Node.js 22+."
Assert-Command -Name "git" -Hint "Install Git for source builds."

$script:RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  (Resolve-Path $RepoRoot).Path
}
$script:OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
$script:DesktopExe = Join-Path $script:OutputDir "WheelMakerDesktop.exe"
$sourceShortSha = Get-SourceShortSha
$script:BuiltDesktopExe = Join-Path $script:RepoRoot ".release-out\local-$sourceShortSha\desktop\WheelMakerDesktop.exe"

Build-And-CopyDesktop
Assert-RemoteOnlyDesktopBinary
New-DesktopShortcut
Write-Step "desktop publish complete"
