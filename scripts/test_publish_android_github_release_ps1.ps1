Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $repoRoot "scripts\publish_android_github_release.ps1"
$batPath = Join-Path $repoRoot "publish-android-github.bat"

function Assert-Contains {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Needle
  )
  if (-not $Text.Contains($Needle)) {
    throw "$Label missing expected text: $Needle"
  }
}

function Assert-NotContains {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Needle
  )
  if ($Text.Contains($Needle)) {
    throw "$Label should not contain text: $Needle"
  }
}

if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "publish_android_github_release.ps1 is missing"
}
if (-not (Test-Path -LiteralPath $batPath)) {
  throw "publish-android-github.bat is missing"
}

$script = Get-Content -LiteralPath $scriptPath -Raw
$bat = Get-Content -LiteralPath $batPath -Raw

Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "publish_android.ps1"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "WheelMakerAndroid.apk"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "android-release.json"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "gh auth status"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "gh release create"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "gh release view"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "git status --porcelain"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle '$status = @(Get-GitLines'
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "git fetch origin"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "SHA256"
Assert-NotContains -Label "publish_android_github_release.ps1" -Text $script -Needle "Get-FileHash"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "--target"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "releases/download"
Assert-Contains -Label "publish_android_github_release.ps1" -Text $script -Needle "releases/latest/download"

Assert-Contains -Label "publish-android-github.bat" -Text $bat -Needle "scripts\publish_android_github_release.ps1"
Assert-Contains -Label "publish-android-github.bat" -Text $bat -Needle "powershell"

$tempOutput = Join-Path ([System.IO.Path]::GetTempPath()) ("wheelmaker-android-release-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempOutput -Force | Out-Null
try {
  Set-Content -LiteralPath (Join-Path $tempOutput "WheelMakerAndroid.apk") -Value "fake apk" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $tempOutput "android-release.json") -Value "{}" -Encoding ASCII

  $whatIfOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -WhatIf -SkipBuild -Tag "android-test-release" -OutputDir $tempOutput 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "publish_android_github_release.ps1 -WhatIf failed: $whatIfOutput"
  }
  $joined = $whatIfOutput -join [Environment]::NewLine
  Assert-Contains -Label "publish_android_github_release.ps1 -WhatIf" -Text $joined -Needle "[whatif] skip Android APK build"
  Assert-Contains -Label "publish_android_github_release.ps1 -WhatIf" -Text $joined -Needle "gh release create android-test-release"
  Assert-Contains -Label "publish_android_github_release.ps1 -WhatIf" -Text $joined -Needle "WheelMakerAndroid.apk#WheelMakerAndroid.apk"
  Assert-Contains -Label "publish_android_github_release.ps1 -WhatIf" -Text $joined -Needle "android-release.json#android-release.json"
  Assert-Contains -Label "publish_android_github_release.ps1 -WhatIf" -Text $joined -Needle "releases/download/android-test-release/WheelMakerAndroid.apk"
} finally {
  if (Test-Path -LiteralPath $tempOutput) {
    Remove-Item -LiteralPath $tempOutput -Recurse -Force
  }
}

Write-Host "publish_android_github_release.ps1 checks passed"
