Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Read-RequiredFile {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $path = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $path)) {
    throw "missing security hook file: $RelativePath"
  }
  return Get-Content -LiteralPath $path -Raw
}

function Assert-Contains {
  param([string]$Label, [string]$Text, [string]$Needle)
  if (-not $Text.Contains($Needle)) { throw "$Label missing: $Needle" }
}

function Assert-NotContains {
  param([string]$Label, [string]$Text, [string]$Needle)
  if ($Text.Contains($Needle)) { throw "$Label must not contain: $Needle" }
}

$hook = Read-RequiredFile ".githooks\pre-commit"
$installer = Read-RequiredFile "scripts\install_git_hooks.ps1"
$workflow = Read-RequiredFile ".github\workflows\security.yml"
$config = Read-RequiredFile ".gitleaks.toml"

Assert-Contains "pre-commit" $hook "gitleaks git --staged --redact --no-banner"
Assert-Contains "pre-commit" $hook "go install github.com/zricethezav/gitleaks/v8@v8.28.0"
Assert-Contains "pre-commit" $hook "exit 1"
Assert-Contains "hook installer" $installer "go install github.com/zricethezav/gitleaks/v8@v8.28.0"
Assert-Contains "hook installer" $installer "git config core.hooksPath .githooks"
Assert-Contains "hook installer" $installer "gitleaks version"
Assert-Contains "security workflow" $workflow "fetch-depth: 0"
Assert-Contains "security workflow" $workflow "go run github.com/zricethezav/gitleaks/v8@v8.28.0 dir --redact --no-banner ."
Assert-Contains "security workflow" $workflow "go run github.com/zricethezav/gitleaks/v8@v8.28.0 git --redact --no-banner"
Assert-NotContains "security workflow" $workflow "continue-on-error"
Assert-NotContains "gitleaks config" $config "regex = '.*secret.*'"
Assert-NotContains "gitleaks config" $config "paths = ['app/__tests__'"
Assert-NotContains "gitleaks config" $config "paths = ['docs'"

Write-Host "security hook checks passed"
