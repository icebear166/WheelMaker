$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $repoRoot "deploy.sh"

if (-not (Test-Path $scriptPath)) {
  throw "deploy.sh is missing"
}

$text = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8

function Assert-Contains {
  param([string]$Needle)
  if (-not $text.Contains($Needle)) {
    throw "deploy.sh does not contain expected text: $Needle"
  }
}

function Assert-NotContains {
  param([string]$Needle)
  if ($text.Contains($Needle)) {
    throw "deploy.sh should not contain text: $Needle"
  }
}

Assert-Contains "WheelMaker All-in-One Deploy"
Assert-Contains "supports macOS and Linux"
Assert-Contains "scripts/deploy/deploy.mjs"
Assert-Contains 'deploy_script="${install_dir}/deploy.mjs"'
Assert-Contains "command -v node"
Assert-Contains "Node.js 22 or newer"
Assert-Contains 'cp "$source_deploy" "$deploy_script"'
Assert-Contains 'node "$deploy_script" migrate-uninstall'
Assert-Contains 'node "$deploy_script"'
Assert-Contains "deploy.sh supports macOS and Linux"
Assert-Contains "deploy.bat on Windows"
Assert-NotContains "wheelmaker-deploy"
Assert-NotContains ".wheelmaker/build/bootstrap"
Assert-NotContains "go build"
Assert-NotContains "npm"
Assert-NotContains "git"
Assert-NotContains "scripts/refresh_server.sh"
Assert-NotContains "scripts/refresh_server_linux.sh"
Assert-NotContains 'bash "$refresh_script" "$@"'
Assert-NotContains "deploy.sh is macOS-only"
Assert-NotContains "app/node_modules/.bin/webpack"

Write-Host "deploy.sh Node migration wrapper checks passed"
