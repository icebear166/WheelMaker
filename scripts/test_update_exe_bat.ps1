$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $repoRoot 'update_exe.bat'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw 'update_exe.bat is missing'
}

$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
if (-not $source.Contains('node "%USERPROFILE%\.wheelmaker\deploy.mjs" desktop-update')) {
    throw 'update_exe.bat must delegate Desktop update to the installed deploy launcher'
}
foreach ($forbidden in @('taskkill', 'Stop-Process', 'MoveFileEx', 'PendingFileRenameOperations')) {
    if ($source.Contains($forbidden)) {
        throw "update_exe.bat contains forbidden process or delayed replacement logic: $forbidden"
    }
}

Write-Host 'update_exe.bat wrapper checks passed'
