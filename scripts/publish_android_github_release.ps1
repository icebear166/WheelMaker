param(
  [string]$RepoRoot = "",
  [string]$OutputDir = (Join-Path -Path $HOME -ChildPath ".wheelmaker\mobile\android"),
  [string]$Tag = "",
  [string]$Title = "",
  [string]$Notes = "",
  [switch]$SkipBuild,
  [switch]$Draft,
  [switch]$Prerelease,
  [switch]$AllowDirty,
  [switch]$AllowUnpushed,
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

function Get-GitLines {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  Push-Location $script:RepoRoot
  try {
    $lines = @(& git @Arguments)
    if ($LASTEXITCODE -ne 0) { throw ("git {0} failed (exit={1})" -f ($Arguments -join " "), $LASTEXITCODE) }
    return $lines
  } finally {
    Pop-Location
  }
}

function Convert-RemoteUrlToSlug {
  param([Parameter(Mandatory = $true)][string]$RemoteUrl)
  $value = $RemoteUrl.Trim()
  if ($value -match '^git@github\.com:(?<slug>[^/]+/[^/]+?)(\.git)?$') {
    return $Matches.slug
  }
  if ($value -match '^https://github\.com/(?<slug>[^/]+/[^/]+?)(\.git)?$') {
    return $Matches.slug
  }
  throw ("cannot infer GitHub owner/repo from origin remote: {0}" -f $RemoteUrl)
}

function Get-DefaultTag {
  return "android-v{0}" -f (Get-Date).ToString("yyyyMMdd-HHmmss")
}

function Assert-CleanWorkingTree {
  if ($AllowDirty) { return }
  if ($WhatIf) {
    Write-Host "[whatif] git status --porcelain"
    return
  }
  $status = @(Get-GitLines -Arguments @("status", "--porcelain"))
  if ($status.Count -eq 0) { return }
  throw "working tree has uncommitted changes. Commit first, or pass -AllowDirty to publish a non-reproducible local build."
}

function Assert-BranchPushed {
  if ($AllowUnpushed) { return }
  $branch = Get-GitValue -Arguments @("branch", "--show-current")
  if ([string]::IsNullOrWhiteSpace($branch)) {
    throw "cannot verify pushed state from detached HEAD. Check out a branch, or pass -AllowUnpushed."
  }
  if ($WhatIf) {
    Write-Host ("[whatif] git fetch origin {0}" -f $branch)
    Write-Host ("[whatif] verify HEAD matches origin/{0}" -f $branch)
    return
  }
  Invoke-Checked -FilePath "git" -Arguments @("fetch", "origin", $branch) -FailureMessage "failed to fetch origin branch before GitHub release"
  $localSha = Get-GitValue -Arguments @("rev-parse", "HEAD")
  $remoteSha = Get-GitValue -Arguments @("rev-parse", "origin/$branch")
  if ($localSha -eq $remoteSha) { return }
  throw ("local HEAD {0} does not match origin/{1} {2}. Push first, or pass -AllowUnpushed." -f $localSha, $branch, $remoteSha)
}

function Assert-GitHubCli {
  Assert-Command -Name "gh" -Hint "Install GitHub CLI and run gh auth login."
  if ($WhatIf) {
    Write-Host "[whatif] gh auth status"
    return
  }
  Invoke-Checked -FilePath "gh" -Arguments @("auth", "status") -FailureMessage "GitHub CLI is not authenticated. Run gh auth login first."
}

function Invoke-AndroidBuild {
  if ($SkipBuild) {
    if ($WhatIf) {
      Write-Host "[whatif] skip Android APK build"
    } else {
      Write-Step "skip Android APK build"
    }
    return
  }
  $args = @("-RepoRoot", $script:RepoRoot, "-OutputDir", $script:OutputDir)
  if ($WhatIf) {
    $args += "-WhatIf"
  }
  Invoke-Checked -FilePath "powershell" -Arguments (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script:AndroidPublishScript) + $args) -FailureMessage "Android APK build/publish failed"
}

function Assert-AndroidOutputs {
  if (-not (Test-Path -LiteralPath $script:ApkPath)) {
    throw ("missing Android APK output: {0}. Run publish-android.bat first or omit -SkipBuild." -f $script:ApkPath)
  }
  if (-not (Test-Path -LiteralPath $script:ManifestPath)) {
    throw ("missing Android release manifest: {0}. Run publish-android.bat first or omit -SkipBuild." -f $script:ManifestPath)
  }
}

function Assert-ReleaseDoesNotExist {
  if ($WhatIf) {
    Write-Host ("[whatif] gh release view {0} --repo {1}" -f $script:Tag, $script:RepoSlug)
    return
  }
  & gh release view $script:Tag --repo $script:RepoSlug *> $null
  if ($LASTEXITCODE -ne 0) { return }
  throw ("GitHub release already exists for tag: {0}" -f $script:Tag)
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

function Get-ReleaseNotes {
  if (-not [string]::IsNullOrWhiteSpace($Notes)) {
    return $Notes
  }
  $apkHash = Get-FileSha256 -Path $script:ApkPath
  $apkSize = (Get-Item -LiteralPath $script:ApkPath).Length
  return @"
Android APK build

Commit: $script:Sha
APK SHA-256: $apkHash
APK size: $apkSize bytes
"@
}

function Publish-GitHubRelease {
  $apkAsset = "{0}#WheelMakerAndroid.apk" -f $script:ApkPath
  $manifestAsset = "{0}#android-release.json" -f $script:ManifestPath
  $releaseTitle = if ([string]::IsNullOrWhiteSpace($Title)) { "WheelMaker Android $script:Tag" } else { $Title }
  $releaseNotes = Get-ReleaseNotes
  $args = @(
    "release", "create", $script:Tag,
    $apkAsset,
    $manifestAsset,
    "--repo", $script:RepoSlug,
    "--target", $script:Sha,
    "--title", $releaseTitle,
    "--notes", $releaseNotes
  )
  if ($Draft) {
    $args += "--draft"
  }
  if ($Prerelease) {
    $args += "--prerelease"
  }
  if ($WhatIf) {
    Write-Host ("[whatif] gh release create {0} {1} {2} --repo {3} --target {4} --title ""{5}"" --notes <generated>" -f $script:Tag, $apkAsset, $manifestAsset, $script:RepoSlug, $script:Sha, $releaseTitle)
    return
  }
  Invoke-Checked -FilePath "gh" -Arguments $args -FailureMessage "GitHub Android release creation failed"
}

function Write-ReleaseUrls {
  $downloadUrl = "https://github.com/{0}/releases/download/{1}/WheelMakerAndroid.apk" -f $script:RepoSlug, $script:Tag
  $latestUrl = "https://github.com/{0}/releases/latest/download/WheelMakerAndroid.apk" -f $script:RepoSlug
  Write-Host ("APK download URL: {0}" -f $downloadUrl)
  Write-Host ("Latest APK URL: {0}" -f $latestUrl)
}

Assert-Command -Name "git" -Hint "Install Git and ensure git.exe is available."

$script:RepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path } else { (Resolve-Path $RepoRoot).Path }
$script:OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
$script:AndroidPublishScript = Join-Path $script:RepoRoot "scripts\publish_android.ps1"
$script:ApkPath = Join-Path $script:OutputDir "WheelMakerAndroid.apk"
$script:ManifestPath = Join-Path $script:OutputDir "android-release.json"
$script:Tag = if ([string]::IsNullOrWhiteSpace($Tag)) { Get-DefaultTag } else { $Tag }
$script:Sha = Get-GitValue -Arguments @("rev-parse", "HEAD")
$script:RepoSlug = Convert-RemoteUrlToSlug -RemoteUrl (Get-GitValue -Arguments @("remote", "get-url", "origin"))

Assert-CleanWorkingTree
Assert-BranchPushed
Assert-GitHubCli
Assert-ReleaseDoesNotExist
Invoke-AndroidBuild
Assert-AndroidOutputs
Publish-GitHubRelease
Write-ReleaseUrls
Write-Step "GitHub Android APK release complete"
