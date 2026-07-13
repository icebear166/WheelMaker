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

$script:AndroidSigningPasswordNames = @(
  "WHEELMAKER_ANDROID_STORE_PASSWORD",
  "WHEELMAKER_ANDROID_KEY_ALIAS",
  "WHEELMAKER_ANDROID_KEY_PASSWORD"
)

function Get-AndroidSigningEnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  if (-not $WhatIf) {
    [Environment]::SetEnvironmentVariable($Name, $value, "Process")
  }
  return $value
}

function Set-AndroidSigningEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )
  if ($WhatIf) { return }
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
}

function New-AndroidSigningPassword {
  $bytes = [byte[]]::new(36)
  try {
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").Replace("=", "")
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Get-AndroidReleaseSigningConfiguration {
  $keystorePath = $script:ReleaseKeystorePath
  if (Test-Path -LiteralPath $keystorePath) {
    $missing = @($script:AndroidSigningPasswordNames | Where-Object {
      [string]::IsNullOrWhiteSpace((Get-AndroidSigningEnvironmentValue -Name $_))
    })
    if ($missing.Count -gt 0) {
      throw ("Android release keystore exists but signing settings are missing: {0}" -f ($missing -join ", "))
    }
    Write-Step ("use Android release keystore: {0}" -f $keystorePath)
    Set-AndroidSigningEnvironmentValue -Name "WHEELMAKER_ANDROID_KEYSTORE" -Value $keystorePath
    return
  }

  if ($WhatIf) {
    Write-Host ("[whatif] create Android release keystore: {0}" -f $keystorePath)
    Write-Host "[whatif] configure Android release signing environment"
    return
  }

  Assert-Command -Name "keytool" -Hint "Install a JDK that provides keytool to create the Android release certificate."
  New-Item -ItemType Directory -Path (Split-Path -Parent $keystorePath) -Force | Out-Null
  $password = New-AndroidSigningPassword
  try {
    Write-Step ("create Android release keystore: {0}" -f $keystorePath)
    $keytool = (Get-Command "keytool").Source
    & $keytool -genkeypair -v -keystore $keystorePath -storetype PKCS12 -storepass $password -alias "wheelmaker" -keypass $password -keyalg RSA -keysize 4096 -validity 9125 -dname "CN=WheelMaker Android Release, OU=WheelMaker, O=WheelMaker, L=Shanghai, ST=Shanghai, C=CN"
    if ($LASTEXITCODE -ne 0) { throw ("keytool release keystore creation failed (exit={0})" -f $LASTEXITCODE) }
    Set-AndroidSigningEnvironmentValue -Name "WHEELMAKER_ANDROID_KEYSTORE" -Value $keystorePath
    Set-AndroidSigningEnvironmentValue -Name "WHEELMAKER_ANDROID_STORE_PASSWORD" -Value $password
    Set-AndroidSigningEnvironmentValue -Name "WHEELMAKER_ANDROID_KEY_ALIAS" -Value "wheelmaker"
    Set-AndroidSigningEnvironmentValue -Name "WHEELMAKER_ANDROID_KEY_PASSWORD" -Value $password
  } finally {
    $password = $null
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

function Get-ApkSignerCommand {
  $fromPath = Get-Command "apksigner" -ErrorAction SilentlyContinue
  if ($null -ne $fromPath) { return $fromPath.Source }
  foreach ($sdkRoot in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if ([string]::IsNullOrWhiteSpace($sdkRoot)) { continue }
    $buildToolsRoot = Join-Path $sdkRoot "build-tools"
    if (-not (Test-Path -LiteralPath $buildToolsRoot)) { continue }
    $candidate = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
      Sort-Object -Property Name -Descending |
      ForEach-Object { Join-Path $_.FullName "apksigner.bat" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
    if ($null -ne $candidate) { return $candidate }
  }
  throw "apksigner was not found; install Android SDK Build Tools or add apksigner to PATH"
}

function Get-ApkSigningCertificateSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $apksigner = Get-ApkSignerCommand
  $output = & $apksigner verify --print-certs $Path 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed"
  }
  $digests = @($output | ForEach-Object {
    if ([string]$_ -match 'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})') {
      $Matches[1].ToLowerInvariant()
    }
  } | Select-Object -Unique)
  if ($digests.Count -eq 0) {
    throw "APK signer certificate SHA-256 was not reported"
  }
  return $digests
}

function Write-AndroidReleaseManifest {
  Assert-Command -Name "git" -Hint "Install Git and ensure git.exe is available."
  $apkPath = Join-Path $script:OutputDir "WheelMakerAndroid.apk"
  $apkHash = ""
  $apkSize = 0
	$certificateSha256 = @()
  if (-not $WhatIf -and (Test-Path -LiteralPath $apkPath)) {
    $apkHash = Get-FileSha256 -Path $apkPath
    $apkSize = (Get-Item -LiteralPath $apkPath).Length
	$certificateSha256 = @(Get-ApkSigningCertificateSha256 -Path $apkPath)
  }
	$keystoreFileName = if ([string]::IsNullOrWhiteSpace($env:WHEELMAKER_ANDROID_KEYSTORE)) {
		""
	} else {
		Split-Path -Leaf $env:WHEELMAKER_ANDROID_KEYSTORE
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
	"signing" = [ordered]@{
		"keystoreFileName" = $keystoreFileName
		"certificateSha256" = $certificateSha256
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
$script:ReleaseKeystorePath = Join-Path $script:OutputDir "wheelmaker-android-release.p12"

Get-AndroidReleaseSigningConfiguration
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
