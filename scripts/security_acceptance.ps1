Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverRoot = Join-Path $repoRoot 'server'
$appRoot = Join-Path $repoRoot 'app'
$androidRoot = Join-Path $repoRoot 'mobile\android'
$wikiKitRoot = Join-Path $repoRoot 'personal-wiki-kit'
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
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts\release-server') -Filter '*.test.mjs' -File
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts\release') -Filter '*.test.mjs' -File
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts\deploy') -Filter '*.test.mjs' -File
    Get-Item -LiteralPath (Join-Path $repoRoot 'scripts\disable-nginx.test.mjs')
    Get-Item -LiteralPath (Join-Path $repoRoot 'scripts\personal-wiki-kit-release.test.mjs')
) | ForEach-Object { $_.FullName }
& node --test @nodeTests
Assert-ExitCode 'Node release and deployment tests' $LASTEXITCODE

Write-Gate 'Personal Wiki Kit security'
Push-Location $wikiKitRoot
try {
    & npm test
    Assert-ExitCode 'Personal Wiki Kit tests' $LASTEXITCODE
    & npm run typecheck
    Assert-ExitCode 'Personal Wiki Kit typecheck' $LASTEXITCODE
    & npm run build
    Assert-ExitCode 'Personal Wiki Kit build' $LASTEXITCODE
    & npm run check:public
    Assert-ExitCode 'Personal Wiki Kit public boundary' $LASTEXITCODE
    Push-Location (Join-Path $wikiKitRoot 'server')
    try {
        & go test ./...
        Assert-ExitCode 'Personal Wiki Kit server tests' $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}

Write-Gate 'Publish and deployment script tests'
$powerShellExecutable = (Get-Process -Id $PID).Path
$scriptTests = @(
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

$retiredReleasePattern = 'raw\.githubusercontent\.com/swm8023/wheelmaker-release|api\.github\.com/repos/swm8023/wheelmaker-release|github\.com/swm8023/wheelmaker-release/releases|WHEELMAKER_RELEASE_APP_ID|WHEELMAKER_RELEASE_INSTALLATION_ID|WHEELMAKER_RELEASE_APP_PRIVATE_KEY'
$retiredReleasePaths = @(
    'README.md', 'INSTALL.md', 'CLAUDE.md', 'server/CLAUDE.md', '.github',
    'scripts/release', 'scripts/deploy', 'scripts/release-server',
    'app/web/src', 'app/web/webpack.config.js', 'mobile/android/app/src/main'
)
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & rg -n --glob '!**/*.test.mjs' --glob '!**/__tests__/**' -e $retiredReleasePattern @retiredReleasePaths *> $null
    $retiredReleaseExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
}
if ($retiredReleaseExitCode -eq 0) {
    throw 'retired GitHub release hosting or App credentials remain in active sources'
}
if ($retiredReleaseExitCode -ne 1) {
    throw "retired release source scan failed with exit $retiredReleaseExitCode"
}

$releaseDeploy = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'scripts\release-server\deploy.mjs')
$remoteInstall = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'scripts\release-server\remote-install.mjs')
$publisherConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'scripts\release\publisher-config.mjs')
if (-not $remoteInstall.Contains('"listen":"127.0.0.1:9680"')) {
    throw 'release service deployment does not bind the application listener to loopback'
}
if (-not $remoteInstall.Contains('$deploy_home/.wheelmaker/release-server')) {
    throw 'release deployment is not rooted in the SSH login Home'
}
if (-not $remoteInstall.Contains('gateway_config_path="$gateway_home/config.json"')) {
    throw 'release deployment does not use the Gateway config'
}
if (-not $remoteInstall.Contains('configure-public-url --config "$gateway_config_candidate"')) {
    throw 'release deployment does not update the Gateway release section'
}
if (-not $remoteInstall.Contains('systemctl --user')) {
    throw 'release deployment does not use a user service'
}
if ($remoteInstall.Contains('gateway/sites') -or $remoteInstall.Contains('release-server.json')) {
    throw 'release deployment still writes the retired Gateway site file'
}
if (-not $publisherConfig.Contains('$HOME/.wheelmaker/gateway/config.json') -or $publisherConfig.Contains('$HOME/.wheelmaker/release-server/config.json')) {
    throw 'publisher token provisioning does not target the Gateway release section'
}
$retiredRootTarget = 'root@release.' + 'wheelmaker.top'
$retiredGatewayHome = '/etc/' + 'wheelmaker-gateway/home'
$retiredGatewayData = '/srv/wheelmaker-release/' + 'gateway'
$retiredLegacyFlag = '--legacy-' + 'nginx'
$retiredBootstrap = 'bootstrap-release-' + 'gateway'
$retiredAdmin = '127.0.0.1:2019/' + 'load'
$retiredBridgePattern = "$retiredRootTarget|$retiredGatewayHome|$retiredGatewayData|$retiredLegacyFlag|$retiredBootstrap|gateway_binary.*(validate|render)|$retiredAdmin|systemctl\s+(start|stop|restart|enable|disable)\s+(nginx|caddy)"
if ("$releaseDeploy`n$remoteInstall" -match $retiredBridgePattern) {
    throw 'release server deployment contains a retired bridge or proxy lifecycle action'
}
if (-not $publisherConfig.Contains("join(homeDirectory, '.wheelmaker')")) {
    throw 'publisher Token config is not rooted below the publisher user home'
}
$uploadListStart = $releaseDeploy.IndexOf('const files = [', [StringComparison]::Ordinal)
if ($uploadListStart -lt 0) {
    throw 'release server deployment upload list is missing'
}
$uploadListEnd = $releaseDeploy.IndexOf('];', $uploadListStart, [StringComparison]::Ordinal)
if ($uploadListEnd -le $uploadListStart) {
    throw 'release server deployment upload list is malformed'
}
$uploadList = $releaseDeploy.Substring($uploadListStart, $uploadListEnd - $uploadListStart)
if ($uploadList -match '(release-server\.json|WHEELMAKER_RELEASE_TOKEN|identityFile)') {
    throw 'release server deployment upload list contains a publishing credential or SSH private key'
}
$debugSigningFallback = 'signingConfigs.getByName("debug")'
$androidBuildScript = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $androidRoot 'app\build.gradle.kts')
if ($androidBuildScript.Contains($debugSigningFallback)) {
    throw 'Android release build contains a debug signing fallback'
}

Write-Gate 'Working tree whitespace check'
& git diff --check
Assert-ExitCode 'git diff --check' $LASTEXITCODE

Write-Host "`nSecurity acceptance: PASS"
