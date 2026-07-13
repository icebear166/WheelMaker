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

$requiredSecurityPatterns = [ordered]@{
    'single-user and single-token scope' = '(?is)single.user.*single.token'
    '256-bit generated token and short custom token risk' = '(?is)256.bit.*short custom'
    'loopback and Nginx boundary' = '(?is)loopback.*Nginx'
    'Base URL behavior' = '(?i)Base URL'
    '180-day sliding browser session' = '(?is)180.day.*sliding'
    'device revocation' = '(?i)device revocation'
    'set-only backend secrets' = '(?is)set.only.*backend secret'
    'six-digit Relay online boundary' = '(?is)six.digit.*Relay|Relay.*six.digit'
    'Native Bridge boundary' = '(?i)Native Bridge'
    'Junction trust semantics' = '(?i)Junction'
    'LocalHubRead retirement' = '(?is)LocalHubRead.*(deleted|removed|retired)'
    'security report location' = '(?i)security-reports'
    'credential rotation procedure' = '(?i)credential rotation'
    'private vulnerability reporting' = '(?i)vulnerability report'
}
foreach ($entry in $requiredSecurityPatterns.GetEnumerator()) {
    if ($security -notmatch $entry.Value) {
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

Write-Host 'security documentation consistency: PASS'
