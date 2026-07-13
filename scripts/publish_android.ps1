param(
  [string]$RepoRoot = "",
  [string]$OutputDir = (Join-Path -Path $HOME -ChildPath ".wheelmaker\mobile\android"),
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

function New-CleanDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  $root = [System.IO.Path]::GetFullPath($script:BuildRoot)
  if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $root = $root + [System.IO.Path]::DirectorySeparatorChar
  }
  $target = [System.IO.Path]::GetFullPath($resolved)
  if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw ("refusing to clean path outside Android build root: {0}" -f $target)
  }
  if ($WhatIf) {
    Write-Host ("[whatif] clean directory {0}" -f $target)
    return
  }
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
}

function New-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  if ($WhatIf) {
    Write-Host ("[whatif] create directory {0}" -f $resolved)
    return
  }
  New-Item -ItemType Directory -Path $resolved -Force | Out-Null
}

function Get-AndroidBuildRoot {
  $homeBuildRoot = [System.IO.Path]::GetFullPath((Join-Path $script:WheelMakerHome "build\mobile\android"))
  $repoRootPath = [System.IO.Path]::GetFullPath($script:RepoRoot)
  $homePathRoot = [System.IO.Path]::GetPathRoot($homeBuildRoot)
  $repoPathRoot = [System.IO.Path]::GetPathRoot($repoRootPath)
  if ($homePathRoot.Equals($repoPathRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $homeBuildRoot
  }
  return [System.IO.Path]::GetFullPath((Join-Path $repoPathRoot ".wheelmaker\build\mobile\android"))
}

function Copy-AndroidBootstrap {
  New-CleanDirectory -Path $script:BootstrapAssetsRoot
  $targetDir = Split-Path -Parent $script:BootstrapTarget
  New-Directory -Path $targetDir
  Write-Step "copy shared Android Bootstrap"
  if ($WhatIf) {
    Write-Host ("[whatif] copy {0} -> {1}" -f $script:BootstrapSource, $script:BootstrapTarget)
    return
  }
  Copy-Item -LiteralPath $script:BootstrapSource -Destination $script:BootstrapTarget -Force
}

function Build-AndroidApk {
  if (-not $WhatIf) {
    Assert-Command -Name "gradle" -Hint "Install Gradle or use Android Studio's Gradle command in PATH."
  }
  New-CleanDirectory -Path $script:GradleBuildRoot
  New-Directory -Path $script:GradleCacheDir
  New-Directory -Path $script:GradleHomeDir

  Push-Location $script:AndroidRoot
  try {
    Write-Step "build WheelMakerAndroid APK"
    $args = @(
      "assembleRelease",
      "--project-cache-dir", $script:GradleCacheDir,
      "-g", $script:GradleHomeDir,
      "-Dorg.gradle.jvmargs=-Djava.net.preferIPv4Stack=true -Dhttps.protocols=TLSv1.2",
      "-PwheelmakerBuildRoot=$script:GradleBuildRoot",
      "-Pkotlin.project.persistent.dir=$script:KotlinPersistentDir",
      "-PwheelmakerWebAssetsDir=$script:BootstrapAssetsRoot"
    )
    if ($WhatIf) {
      Write-Host ("[whatif] gradle {0}" -f ($args -join " "))
      return
    }
    New-Item -ItemType Directory -Path $script:OutputDir -Force | Out-Null
    Invoke-Checked -FilePath "gradle" -Arguments $args -FailureMessage "Android APK build failed"
  } finally {
    Pop-Location
  }
}

function Copy-AndroidOutputs {
  $apk = Get-ChildItem -LiteralPath $script:GradleBuildRoot -Recurse -Filter "*.apk" |
    Where-Object { $_.FullName -match "\\outputs\\apk\\release\\" } |
    Select-Object -First 1
  if ($null -eq $apk) {
    throw ("release APK was not produced under {0}" -f $script:GradleBuildRoot)
  }
  $target = Join-Path $script:OutputDir "WheelMakerAndroid.apk"
  Write-Step ("copy APK: {0}" -f $target)
  if ($WhatIf) {
    Write-Host ("[whatif] copy {0} -> {1}" -f $apk.FullName, $target)
    return
  }
  Copy-Item -LiteralPath $apk.FullName -Destination $target -Force
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha256.ComputeHash($stream)
      return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Write-AndroidReleaseManifest {
  Assert-Command -Name "git" -Hint "Install Git and ensure git.exe is available."
  $apkPath = Join-Path $script:OutputDir "WheelMakerAndroid.apk"
  $apkHash = ""
  $apkSize = 0
  if (-not $WhatIf -and (Test-Path -LiteralPath $apkPath)) {
    $apkHash = Get-FileSha256 -Path $apkPath
    $apkSize = (Get-Item -LiteralPath $apkPath).Length
  }
  $manifest = [ordered]@{
    "schemaVersion" = 1
    "platform" = "android"
    "repo" = $script:RepoRoot
    "branch" = Get-GitValue -Arguments @("branch", "--show-current")
    "sha" = Get-GitValue -Arguments @("rev-parse", "HEAD")
    "builtAt" = (Get-Date).ToUniversalTime().ToString("o")
    "apk" = [ordered]@{
      "fileName" = "WheelMakerAndroid.apk"
      "path" = $apkPath
      "sha256" = $apkHash
      "size" = $apkSize
    }
    "embeddedAsset" = "bootstrap/index.html"
    "gradleBuildRoot" = $script:GradleBuildRoot
  }
  if ($WhatIf) {
    Write-Host ("[whatif] write {0}" -f $script:ManifestPath)
    return
  }
  New-Item -ItemType Directory -Path $script:OutputDir -Force | Out-Null
  $json = $manifest | ConvertTo-Json -Depth 8
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($script:ManifestPath, $json, $utf8NoBom)
}

$script:RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path } else { (Resolve-Path $RepoRoot).Path }
$script:AndroidRoot = Join-Path $script:RepoRoot "mobile\android"
$script:WheelMakerHome = Join-Path $HOME ".wheelmaker"
$script:BuildRoot = Get-AndroidBuildRoot
$script:BootstrapSource = Join-Path $script:RepoRoot "server\cmd\wheelmaker-desktop\bootstrap\index.html"
$script:BootstrapAssetsRoot = Join-Path $script:BuildRoot "app\src\main\assets"
$script:BootstrapTarget = Join-Path $script:BuildRoot "app\src\main\assets\bootstrap\index.html"
$script:GradleBuildRoot = Join-Path $script:BuildRoot "gradle-build"
$script:KotlinPersistentDir = Join-Path $script:GradleBuildRoot "kotlin-persistent"
$script:GradleCacheDir = Join-Path $script:BuildRoot "gradle-cache"
$script:GradleHomeDir = Join-Path $script:BuildRoot "gradle-home"
$script:OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
$script:ManifestPath = Join-Path $script:OutputDir "android-release.json"

Copy-AndroidBootstrap
Build-AndroidApk
if ($WhatIf) {
  $target = Join-Path $script:OutputDir "WheelMakerAndroid.apk"
  Write-Step ("copy APK: {0}" -f $target)
  Write-Host ("[whatif] copy release APK from {0} -> {1}" -f $script:GradleBuildRoot, $target)
} else {
  Copy-AndroidOutputs
}
Write-AndroidReleaseManifest
Write-Step "Android APK publish complete"
