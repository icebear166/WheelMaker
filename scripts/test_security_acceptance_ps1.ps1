Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Read-RequiredFile([string]$RelativePath) {
    $path = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "missing security acceptance file: $RelativePath"
    }
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $path
}

function Assert-Contains([string]$Label, [string]$Text, [string]$Needle) {
    if (-not $Text.Contains($Needle)) {
        throw "$Label missing required gate: $Needle"
    }
}

function Assert-NotContains([string]$Label, [string]$Text, [string]$Needle) {
    if ($Text.Contains($Needle)) {
        throw "$Label contains forbidden behavior: $Needle"
    }
}

function Assert-InOrder([string]$Label, [string]$Text, [string[]]$Needles) {
    $cursor = -1
    foreach ($needle in $Needles) {
        $index = $Text.IndexOf($needle, $cursor + 1, [StringComparison]::Ordinal)
        if ($index -lt 0) {
            throw "$Label missing or misordered gate: $needle"
        }
        $cursor = $index
    }
}

$powershell = Read-RequiredFile 'scripts/security_acceptance.ps1'
$shell = Read-RequiredFile 'scripts/security_acceptance.sh'
$checklist = Read-RequiredFile 'docs/security-staging-checklist.md'

$orderedPowerShellGates = @(
    'gitleaks dir --redact --no-banner .',
    'Baseline security regressions',
    'go test ./...',
    'npm test -- --runInBand',
    'npm run tsc:web',
    'npm run build:web:release',
    'npm audit --omit=dev --audit-level=moderate --json',
    'npm audit --audit-level=high --json',
    'gradle test lint',
    'Publish and deployment script tests',
    'Forbidden production source gate',
    'git diff --check'
)
Assert-InOrder 'security_acceptance.ps1' $powershell $orderedPowerShellGates

$orderedShellGates = @(
    'gitleaks dir --redact --no-banner .',
    'Baseline security regressions',
    'go test ./...',
    'npm test -- --runInBand',
    'npm run tsc:web',
    'npm run build:web:release',
    'npm audit --omit=dev --audit-level=moderate --json',
    'npm audit --audit-level=high --json',
    'gradle test lint',
    'Publish and deployment script tests',
    'Forbidden production source gate',
    'git diff --check'
)
Assert-InOrder 'security_acceptance.sh' $shell $orderedShellGates

foreach ($source in @($powershell, $shell)) {
    Assert-Contains 'acceptance entry' $source 'docs/security-dependency-deferred.md'
    Assert-Contains 'acceptance entry' $source 'LOCAL_TOKEN_KEY'
    Assert-Contains 'acceptance entry' $source 'LocalHubRead'
    Assert-Contains 'acceptance entry' $source 'addJavascriptInterface'
    Assert-Contains 'acceptance entry' $source 'RegistryRoleMonitor'
    Assert-Contains 'acceptance entry' $source '9632'
    Assert-Contains 'acceptance entry' $source 'InsecureSkipVerify'
    Assert-Contains 'acceptance entry' $source 'signingConfigs.getByName("debug")'
    Assert-NotContains 'acceptance entry' $source 'continue-on-error'
    Assert-NotContains 'acceptance entry' $source 'Get-ChildItem Env:'
    Assert-NotContains 'acceptance entry' $source 'set -x'
}

foreach ($needle in @(
    'Root path',
    '/wheelmaker/',
    '180-day clock',
    'Desktop',
    'Android',
    'Origin',
    'Base Path',
    'APK size/hash/package/version/signature',
    'Relay',
    'CSP',
    '127.0.0.1',
    'wildcard/LAN',
    'PASS/FAIL',
    'Evidence'
)) {
    Assert-Contains 'staging checklist' $checklist $needle
}

Write-Host 'security acceptance source checks: PASS'
