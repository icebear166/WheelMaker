Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidRoot = Join-Path $repoRoot "mobile\android"
$buildScriptPath = Join-Path $androidRoot "app\build.gradle.kts"
$signingRoot = Join-Path $androidRoot "signing"
$propertiesPath = Join-Path $signingRoot "signing.properties"
$retiredExamplePath = Join-Path $androidRoot "release-signing.properties.example"
$required = @(
  "storeFile",
  "storePassword",
  "keyAlias",
  "keyPassword"
)

function Invoke-GradleForExitCode {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & gradle @Arguments *> $null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

$buildScript = Get-Content -LiteralPath $buildScriptPath -Raw
if ($buildScript.Contains('signingConfigs.getByName("debug")')) {
  throw "release build must not fall back to the debug signing key"
}
if (-not $buildScript.Contains('signing/signing.properties')) {
  throw "release build must load repository-owned signing properties"
}
foreach ($name in $required) {
  if (-not $buildScript.Contains($name)) {
    throw "build script is missing required signing input: $name"
  }
}
if (-not (Test-Path -LiteralPath $propertiesPath -PathType Leaf)) {
  throw "release signing properties are missing"
}
if (Test-Path -LiteralPath $retiredExamplePath) {
  throw "retired environment-variable signing example still exists"
}

$properties = @{}
foreach ($line in Get-Content -LiteralPath $propertiesPath) {
  if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
    continue
  }
  $parts = $line.Split('=', 2)
  if ($parts.Length -eq 2) {
    $properties[$parts[0].Trim()] = $parts[1].Trim()
  }
}
foreach ($name in $required) {
  if (-not $properties.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($properties[$name])) {
    throw "release signing properties are missing: $name"
  }
}
$keystorePath = Join-Path $signingRoot $properties['storeFile']
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
  throw "release signing keystore is missing"
}

foreach ($relativePath in @(
  'mobile/android/signing/signing.properties',
  'mobile/android/signing/release.p12'
)) {
  & git -C $repoRoot ls-files --error-unmatch -- $relativePath *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "release signing input is not tracked: $relativePath"
  }
}

Push-Location $androidRoot
try {
  $tasksExitCode = Invoke-GradleForExitCode -Arguments @(':app:tasks', '--quiet')
  if ($tasksExitCode -ne 0) {
    throw "debug/non-release Gradle configuration unexpectedly requires release signing"
  }
  $releaseExitCode = Invoke-GradleForExitCode -Arguments @(
    ':app:assembleRelease',
    '--dry-run',
    '-PwheelmakerReleaseVersionName=1.1',
    '-PwheelmakerReleaseVersionCode=1'
  )
  if ($releaseExitCode -ne 0) {
    throw "release configuration could not load the committed signing identity"
  }
} finally {
  Pop-Location
}

Write-Host "Android release signing checks passed"
