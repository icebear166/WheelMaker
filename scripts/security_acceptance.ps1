Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverRoot = Join-Path $repoRoot 'server'
$appRoot = Join-Path $repoRoot 'app'
$androidRoot = Join-Path $repoRoot 'mobile\android'
$deferredDependencyPath = Join-Path $repoRoot 'docs/security-dependency-deferred.md'

function Write-Gate([string]$Name) {
    Write-Host "`n==> $Name"
}

function Assert-ExitCode([string]$Name, [int]$ExitCode) {
    if ($ExitCode -ne 0) {
        throw "$Name failed with exit code $ExitCode"
    }
}

function Assert-AuditLedger([object]$Audit, [string]$DeferredDocument) {
    if ($null -eq $Audit.metadata -or $null -eq $Audit.metadata.vulnerabilities) {
        throw 'npm audit returned an unsupported JSON schema'
    }
    $counts = $Audit.metadata.vulnerabilities
    if ([int]$counts.high -gt 0 -or [int]$counts.critical -gt 0) {
        throw 'complete dependency tree contains a high or critical advisory'
    }
    foreach ($property in $Audit.vulnerabilities.PSObject.Properties) {
        $finding = $property.Value
        if ($finding.severity -notin @('low', 'moderate')) {
            continue
        }
        $majorOnly = $finding.fixAvailable -is [pscustomobject] -and $finding.fixAvailable.isSemVerMajor -eq $true
        $marker = '`' + $property.Name + '`'
        if (-not $majorOnly -or -not $DeferredDocument.Contains($marker)) {
            throw "unapproved low/moderate npm advisory remains for $($property.Name)"
        }
    }
}

function Assert-NoProductionMatches([string]$Label, [string]$Pattern, [string[]]$ExtraGlobs = @()) {
    $arguments = @(
        '-n', '--hidden',
        '--glob', '!**/*_test.go',
        '--glob', '!**/__tests__/**',
        '--glob', '!**/test/**',
        '--glob', '!**/security/token.go'
    )
    foreach ($glob in $ExtraGlobs) {
        $arguments += @('--glob', $glob)
    }
    $arguments += @(
        '-e', $Pattern,
        'server',
        'app/web/src',
        'mobile/android/app/src/main'
    )
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & rg @arguments *> $null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -eq 0) {
        throw "$Label found a forbidden production source pattern"
    }
    if ($exitCode -ne 1) {
        throw "$Label could not complete rg scan (exit $exitCode)"
    }
}

Set-Location $repoRoot

Write-Gate 'Gitleaks current tree'
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & gitleaks dir --redact --no-banner . *> $null
    $gitleaksExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
}
Assert-ExitCode 'gitleaks current tree' $gitleaksExitCode

Write-Gate 'Baseline security regressions'
Push-Location $serverRoot
try {
    & go test ./internal/security -run 'Test(NewRegistryToken|ValidateRegistryToken|RequireLoopbackAddress|ForwardedHeaders)'
    Assert-ExitCode 'security token and proxy regressions' $LASTEXITCODE
    & go test ./internal/shared -run 'Test(WriteConfigFileAtomicallyReplacesContent|SecureConfigFileRestrictsWindowsDACL)'
    Assert-ExitCode 'private atomic config regressions' $LASTEXITCODE
    & go test ./internal/registry ./internal/portrelay -run 'Test(SecurityE2E|RunRejectsNonLoopbackAddress|RelayListenerBindsLoopbackOnly|RelayEnableAllowsOnlyExactLoopbackTargetHost|RelayForwardedHeadersRequireLoopbackPeer)'
    Assert-ExitCode 'listener and proxy regressions' $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Gate 'Go full tests'
Push-Location $serverRoot
try {
    & go test ./...
    Assert-ExitCode 'go test ./...' $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Gate 'Web Jest'
Push-Location $appRoot
try {
    & npm test -- --runInBand
    Assert-ExitCode 'npm test -- --runInBand' $LASTEXITCODE

    Write-Gate 'Web typecheck'
    & npm run tsc:web
    Assert-ExitCode 'npm run tsc:web' $LASTEXITCODE

    Write-Gate 'Web release build'
    & npm run build:web:release
    Assert-ExitCode 'npm run build:web:release' $LASTEXITCODE

    Write-Gate 'Production npm audit'
    $productionAuditRaw = & npm audit --omit=dev --audit-level=moderate --json 2>$null
    $productionAuditExit = $LASTEXITCODE
    Assert-ExitCode 'production npm audit' $productionAuditExit

    Write-Gate 'Complete npm audit'
    $completeAuditRaw = & npm audit --audit-level=high --json 2>$null
    $completeAuditExit = $LASTEXITCODE
    Assert-ExitCode 'complete npm audit' $completeAuditExit
    try {
        $completeAudit = ($completeAuditRaw -join "`n") | ConvertFrom-Json
    } catch {
        throw 'complete npm audit returned invalid JSON'
    }
    $deferredDependencies = Get-Content -Raw -Encoding UTF8 -LiteralPath $deferredDependencyPath
    Assert-AuditLedger $completeAudit $deferredDependencies
} finally {
    Pop-Location
}

Write-Gate 'Android JVM tests and lint'
Push-Location $androidRoot
try {
    & gradle test lint
    Assert-ExitCode 'gradle test lint' $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Gate 'Node release and deployment tests'
$nodeTests = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts\release') -Filter '*.test.mjs' -File
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts\deploy') -Filter '*.test.mjs' -File
) | ForEach-Object { $_.FullName }
& node --test @nodeTests
Assert-ExitCode 'Node release and deployment tests' $LASTEXITCODE

Write-Gate 'Publish and deployment script tests'
$powerShellExecutable = (Get-Process -Id $PID).Path
$scriptTests = @(
    'scripts/test_deploy_bat.ps1',
    'scripts/test_deploy_sh.ps1',
    'scripts/test_android_project_ps1.ps1',
    'scripts/test_android_release_signing.ps1',
    'scripts/test_security_hooks.ps1',
    'scripts/test_security_docs.ps1',
    'scripts/test_security_acceptance_ps1.ps1'
)
foreach ($relativePath in $scriptTests) {
    & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot $relativePath)
    Assert-ExitCode $relativePath $LASTEXITCODE
}

Write-Gate 'Forbidden production source gate'
Assert-NoProductionMatches 'legacy default token' 'wheelmaker-local-token'
Assert-NoProductionMatches 'retired interfaces' 'LOCAL_TOKEN_KEY|LocalHubRead|addJavascriptInterface|RegistryRoleMonitor|registry\.monitor|monitor\.(listHub|status|log|db|action|restart)|:9632|InsecureSkipVerify'
Assert-NoProductionMatches 'retired backend key migration' 'migrateLegacyBackendSecrets|extractLegacyBackendSecrets|getLegacyBackendSecrets|clearLegacyBackendSecret|retryBackendSecretMigration|config\.json.{0,80}secrets'
Assert-NoProductionMatches 'Android Server Data key persistence' '(SharedPreferences|DataStore|Room|SQLite|FileOutputStream).{0,120}(accessToken|speechCredential|volcengine)|(accessToken|speechCredential|volcengine).{0,120}(SharedPreferences|DataStore|Room|SQLite|FileOutputStream)'
$debugSigningFallback = 'signingConfigs.getByName("debug")'
$androidBuildScript = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $androidRoot 'app\build.gradle.kts')
if ($androidBuildScript.Contains($debugSigningFallback)) {
    throw 'Android release build contains a debug signing fallback'
}

Write-Gate 'Working tree whitespace check'
& git diff --check
Assert-ExitCode 'git diff --check' $LASTEXITCODE

Write-Host "`nSecurity acceptance: PASS"
