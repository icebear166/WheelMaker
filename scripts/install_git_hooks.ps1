Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

& go install github.com/zricethezav/gitleaks/v8@v8.28.0
if ($LASTEXITCODE -ne 0) { throw "gitleaks installation failed" }

Push-Location $repoRoot
try {
  & git config core.hooksPath .githooks
  if ($LASTEXITCODE -ne 0) { throw "failed to configure repository hooks path" }
  & gitleaks version
  if ($LASTEXITCODE -ne 0) { throw "gitleaks is not available in PATH after installation" }
} finally {
  Pop-Location
}

Write-Host "WheelMaker security hooks installed"
