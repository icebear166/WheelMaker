Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidRoot = Join-Path $repoRoot "mobile\android"
$buildScriptPath = Join-Path $androidRoot "app\build.gradle.kts"
$examplePath = Join-Path $androidRoot "release-signing.properties.example"
$required = @(
  "WHEELMAKER_ANDROID_KEYSTORE",
  "WHEELMAKER_ANDROID_STORE_PASSWORD",
  "WHEELMAKER_ANDROID_KEY_ALIAS",
  "WHEELMAKER_ANDROID_KEY_PASSWORD"
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
foreach ($name in $required) {
  if (-not $buildScript.Contains($name)) {
    throw "build script is missing required signing input: $name"
  }
}
if (-not (Test-Path -LiteralPath $examplePath)) {
  throw "release signing example is missing"
}

$original = @{}
foreach ($name in $required) {
  $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  foreach ($name in $required) {
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  Push-Location $androidRoot
  try {
	$debugExitCode = Invoke-GradleForExitCode -Arguments @(':app:tasks', '--quiet')
	if ($debugExitCode -ne 0) {
      throw "debug/non-release Gradle configuration unexpectedly requires release signing secrets"
    }

    foreach ($missing in $required) {
      foreach ($name in $required) {
        [Environment]::SetEnvironmentVariable($name, "test-value", "Process")
      }
      [Environment]::SetEnvironmentVariable($missing, $null, "Process")
		$releaseExitCode = Invoke-GradleForExitCode -Arguments @(':app:assembleRelease', '--dry-run')
		if ($releaseExitCode -eq 0) {
        throw "release configuration unexpectedly succeeded without $missing"
      }
    }
  } finally {
    Pop-Location
  }
} finally {
  foreach ($name in $required) {
    [Environment]::SetEnvironmentVariable($name, $original[$name], "Process")
  }
}

Write-Host "Android release signing checks passed"
