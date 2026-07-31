$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
    'README.md',
    'INSTALL.md',
    'docs/security.md',
    'docs/security-known-risks.md'
)

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$documents = @{}
foreach ($relativePath in $requiredFiles) {
    $path = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Fail "missing security documentation: $relativePath"
    }
    $documents[$relativePath] = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
}

$security = $documents['docs/security.md']
$knownRisks = $documents['docs/security-known-risks.md']
$allDocs = ($documents.Values -join "`n")

foreach ($relativePath in @('README.md', 'INSTALL.md')) {
    $nginxDoc = $documents[$relativePath]
    foreach ($pattern in @(
        'gzip on;',
        'gzip_vary on;',
        'gzip_min_length 1024;',
        'gzip_comp_level 5;',
        'text/css',
        'application/javascript',
        'application/manifest+json',
        'image/svg+xml'
    )) {
        if (-not $nginxDoc.Contains($pattern)) {
            Fail "$relativePath Nginx template is missing: $pattern"
        }
    }
}

$requiredSecurityPatterns = [ordered]@{
    'single-user and single-token scope' = '(?is)single.user.*single.token'
    '256-bit generated token and short custom token risk' = '(?is)256.bit.*short custom'
    'loopback and Nginx boundary' = '(?is)loopback.*Nginx'
    'Base URL behavior' = '(?i)Base URL'
    '180-day sliding browser session' = '(?is)180.day.*sliding'
    'device revocation' = '(?i)device revocation'
    'set-only backend secrets' = '(?is)set.only.*backend secret'
    'private Server Data file' = '(?is)server-data\.json.*private file permissions'
    'Android direct Volcengine speech' = '(?is)Android direct speech.*Volcengine'
    'mandatory client reconfiguration' = '(?is)old clients.*mandatory reconfiguration'
    'accepted Android client-name gate' = '(?is)client-name gate.*accepted'
    'six-digit Relay online boundary' = '(?is)six.digit.*Relay|Relay.*six.digit'
    'Native Bridge boundary' = '(?i)Native Bridge'
    'Junction trust semantics' = '(?i)Junction'
    'LocalHubRead retirement' = '(?is)LocalHubRead.*(deleted|removed|retired)'
    'security report location' = '(?i)security-reports'
    'credential rotation procedure' = '(?i)credential rotation'
    'private vulnerability reporting' = '(?i)vulnerability report'
    'self-hosted publishing token boundary' = '(?is)publishing Token.*release-server\.json.*WHEELMAKER_RELEASE_TOKEN.*SHA-256'
    'stable-last self-hosted publication' = '(?is)schema 2.*stable\.json'
}
foreach ($entry in $requiredSecurityPatterns.GetEnumerator()) {
    if (-not [regex]::IsMatch([string]$security, [string]$entry.Value)) {
        Fail "docs/security.md is missing: $($entry.Key)"
    }
}

$requiredRiskPatterns = [ordered]@{
    'OS user or administrator attacker' = '(?i)OS user|administrator'
    'controlled same-origin page' = '(?i)controlled same.origin'
    'same-origin paths are not isolation' = '(?is)same.origin.*path.*not.*isolat'
    'Relay is not a permanent high-entropy key' = '(?is)Relay.*not.*permanent.*high.entropy'
    'self-signed certificates are unsupported' = '(?is)self.signed.*unsupported'
    'Go upgrade is deferred' = '(?is)Go.*upgrade.*defer'
    'major dependency upgrades are deferred' = '(?is)major.*dependenc.*defer'
    'Git history rewrite is pending' = '(?is)history rewrite.*pending'
    'single release server availability' = '(?is)single release server availability.*no automatic backup'
    'shared publisher token blast radius' = '(?is)shared publisher Token blast radius.*blast radius'
}
foreach ($entry in $requiredRiskPatterns.GetEnumerator()) {
    if ($knownRisks -notmatch $entry.Value) {
        Fail "docs/security-known-risks.md is missing: $($entry.Key)"
    }
}

$forbiddenClaims = [ordered]@{
    'browser stores the Registry token' = '(?i)browser.{0,60}(save|store|persist).{0,30}(registry\s*)?token|localStorage.{0,40}token'
    'Monitor is available' = '(?i)Monitor.{0,30}(available|enabled|supported)'
    'desktop or Android embeds the full Web app' = '(?i)(EXE|Desktop|APK|Android).{0,80}(embed|package|bundle).{0,40}(full|complete|Workspace Web snapshot)'
    'remote Registry HTTP is supported' = '(?im)registry\.server.{0,100}http://(?!127\.0\.0\.1|localhost)|remote.{0,80}http://'
    'self-signed certificate bypass is supported' = '(?i)self.signed.{0,80}(bypass|ignore|allow|is supported|are supported)'
}
foreach ($entry in $forbiddenClaims.GetEnumerator()) {
    if ($allDocs -match $entry.Value) {
        Fail "security documentation still claims: $($entry.Key)"
    }
}

$retiredReleasePattern = 'raw\.githubusercontent\.com/swm8023/wheelmaker-release|api\.github\.com/repos/swm8023/wheelmaker-release|github\.com/swm8023/wheelmaker-release/releases|WHEELMAKER_RELEASE_APP_ID|WHEELMAKER_RELEASE_INSTALLATION_ID|WHEELMAKER_RELEASE_APP_PRIVATE_KEY'
$activeReleasePaths = @(
    'README.md',
    'INSTALL.md',
    'CLAUDE.md',
    'server/CLAUDE.md',
    '.github',
    'scripts/release',
    'scripts/deploy',
    'scripts/release-server',
    'app/web/src',
    'app/web/webpack.config.js',
    'mobile/android/app/src/main'
)
$previousPreference = $ErrorActionPreference
Push-Location $repoRoot
try {
    $ErrorActionPreference = 'Continue'
    & rg -n --glob '!**/*.test.mjs' --glob '!**/__tests__/**' -e $retiredReleasePattern @activeReleasePaths *> $null
    $retiredReleaseExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
}
if ($retiredReleaseExitCode -eq 0) {
    Fail 'active release sources still reference the retired GitHub hosting or App credentials'
}
if ($retiredReleaseExitCode -ne 1) {
    Fail "retired release source scan failed with exit $retiredReleaseExitCode"
}

Write-Host 'security documentation consistency: PASS'
