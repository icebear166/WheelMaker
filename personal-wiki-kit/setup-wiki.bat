@echo off
setlocal
chcp 65001 >nul
set "PERSONAL_WIKI_SETUP_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:PERSONAL_WIKI_SETUP_SELF,[Text.Encoding]::UTF8); $marker=('# PERSONAL_WIKI_'+'SETUP_POWERSHELL'); $index=$raw.IndexOf($marker); if($index -lt 0){throw 'Personal Wiki Setup payload is missing'}; & ([ScriptBlock]::Create($raw.Substring($index)))"
set "PERSONAL_WIKI_SETUP_EXIT=%ERRORLEVEL%"
exit /b %PERSONAL_WIKI_SETUP_EXIT%

# PERSONAL_WIKI_SETUP_POWERSHELL
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ReleaseBase = 'https://release.wheelmaker.top'
$StableUrl = 'https://release.wheelmaker.top/personal-wiki-kit/stable.json'
$PersonalWikiHome = Join-Path $env:USERPROFILE '.personal-wiki'
$ActiveFile = Join-Path $PersonalWikiHome 'kit\active-version.txt'
$Launcher = Join-Path $PersonalWikiHome 'bin\personal-wiki.cmd'

function Read-CompleteInstallation {
  if (-not (Test-Path -LiteralPath $PersonalWikiHome -PathType Container)) { return $null }
  $ConfigPath = Join-Path $PersonalWikiHome 'config.json'
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $ActiveFile -PathType Leaf) -or
      -not (Test-Path -LiteralPath $Launcher -PathType Leaf)) { return $null }
  try {
    $Version = ([IO.File]::ReadAllText($ActiveFile, [Text.Encoding]::UTF8)).Trim()
    if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$') { return $null }
    $KitRoot = Join-Path $PersonalWikiHome "kit\versions\$Version"
    $Config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$Config.repositoryPath)) { return $null }
    $Repository = [IO.Path]::GetFullPath([string]$Config.repositoryPath)
    foreach ($Required in @(
      (Join-Path $KitRoot 'kit.json'),
      (Join-Path $KitRoot 'runtime\node.exe'),
      (Join-Path $KitRoot 'src\cli.mjs'),
      (Join-Path $Repository 'wiki-kit.lock.json'),
      (Join-Path $Repository 'open-wiki.bat'),
      (Join-Path $Repository 'publish-wiki.bat'),
      (Join-Path $Repository 'update-wiki-kit.bat')
    )) {
      if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { return $null }
    }
    return [PSCustomObject]@{ Version = $Version; Repository = $Repository }
  } catch {
    return $null
  }
}

function Assert-SafeStable($Stable) {
  if ($Stable.schema -ne 1 -or [string]$Stable.version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$') {
    throw 'Personal Wiki Kit stable.json 无效。'
  }
  $Artifact = $Stable.artifacts.'windows-x64'
  $ExpectedName = "personal-wiki-kit-v$($Stable.version)-windows-x64.zip"
  $ExpectedPath = "/personal-wiki-kit/releases/v$($Stable.version)/$ExpectedName"
  if ($null -eq $Artifact -or [string]$Artifact.path -cne $ExpectedPath -or
      [long]$Artifact.size -le 0 -or [string]$Artifact.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Personal Wiki Kit Windows 稳定版本指针无效。'
  }
  $ArtifactUrl = [Uri]::new([Uri]$ReleaseBase, [string]$Artifact.path)
  if ($ArtifactUrl.Scheme -ne 'https' -or $ArtifactUrl.Host -ne ([Uri]$ReleaseBase).Host) {
    throw 'Personal Wiki Kit 下载地址不安全。'
  }
  return [PSCustomObject]@{
    Version = [string]$Stable.version
    Name = $ExpectedName
    Url = $ArtifactUrl.AbsoluteUri
    Size = [long]$Artifact.size
    Sha256 = [string]$Artifact.sha256
  }
}

try {
  $Existing = Read-CompleteInstallation
  if ($null -ne $Existing) {
    Write-Host "检测到现有 Personal Wiki：$($Existing.Repository)"
    Write-Host "当前 Kit：$($Existing.Version)"
    $Choice = (Read-Host '输入 U 检查更新，或按 Enter 退出').Trim()
    if ($Choice -match '^[Uu]$') {
      & $Launcher update --repository $Existing.Repository
      exit $LASTEXITCODE
    }
    Write-Host '未做修改。'
    exit 0
  }

  if (Test-Path -LiteralPath $PersonalWikiHome) {
    $Items = @(Get-ChildItem -LiteralPath $PersonalWikiHome -Force -ErrorAction Stop)
    if ($Items.Count -gt 0) {
      throw "检测到残缺的 Personal Wiki 安装：$PersonalWikiHome。为保护现有数据，安装器拒绝覆盖或删除，请先人工检查。"
    }
  }

  Write-Host '正在读取 Personal Wiki Kit 稳定版本...'
  $Stable = Invoke-RestMethod -UseBasicParsing -Uri $StableUrl -Headers @{'Cache-Control'='no-cache'}
  $Artifact = Assert-SafeStable $Stable
  $Temporary = Join-Path ([IO.Path]::GetTempPath()) ("personal-wiki-setup-" + [Guid]::NewGuid().ToString('N'))
  $Archive = Join-Path $Temporary $Artifact.Name
  $Extracted = Join-Path $Temporary 'extracted'
  New-Item -ItemType Directory -Path $Extracted -Force | Out-Null
  try {
    Write-Host "正在下载 Personal Wiki Kit $($Artifact.Version)..."
    Invoke-WebRequest -UseBasicParsing -Uri $Artifact.Url -OutFile $Archive -Headers @{'Cache-Control'='no-cache'}
    $ActualSize = (Get-Item -LiteralPath $Archive).Length
    if ($ActualSize -ne $Artifact.Size) {
      throw "下载大小不匹配：期望 $($Artifact.Size)，实际 $ActualSize。"
    }
    $ActualSha256 = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualSha256 -cne $Artifact.Sha256) {
      throw '下载的 Personal Wiki Kit SHA-256 不匹配。'
    }
    Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted -Force
    $Candidate = Join-Path $Extracted "personal-wiki-kit-v$($Artifact.Version)-windows-x64"
    $CandidateManifest = Join-Path $Candidate 'kit.json'
    $CandidateNode = Join-Path $Candidate 'runtime\node.exe'
    $CandidateCli = Join-Path $Candidate 'src\cli.mjs'
    if (-not (Test-Path -LiteralPath $CandidateManifest -PathType Leaf) -or
        -not (Test-Path -LiteralPath $CandidateNode -PathType Leaf) -or
        -not (Test-Path -LiteralPath $CandidateCli -PathType Leaf)) {
      throw '解压后的 Personal Wiki Kit 不完整。'
    }
    $Manifest = [IO.File]::ReadAllText($CandidateManifest, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ([string]$Manifest.version -cne $Artifact.Version) {
      throw '解压后的 Kit 版本与 stable.json 不一致。'
    }
    $VersionsRoot = Join-Path $PersonalWikiHome 'kit\versions'
    $Destination = Join-Path $VersionsRoot $Artifact.Version
    if (Test-Path -LiteralPath $Destination) {
      throw "目标 Kit 版本目录已存在，拒绝覆盖：$Destination"
    }
    New-Item -ItemType Directory -Path $VersionsRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $PersonalWikiHome 'bin') -Force | Out-Null
    Move-Item -LiteralPath $Candidate -Destination $Destination
    [IO.File]::WriteAllText($ActiveFile, "$($Artifact.Version)`n", [Text.UTF8Encoding]::new($false))
    Write-Host 'Kit 已校验。现在开始创建独立的私人 Wiki 仓库。'
    & (Join-Path $Destination 'runtime\node.exe') (Join-Path $Destination 'src\cli.mjs') setup --kit-source $Artifact.Url --kit-sha256 $Artifact.Sha256
    if ($LASTEXITCODE -ne 0) { throw "Personal Wiki 设置向导退出码：$LASTEXITCODE" }
    Write-Host 'Personal Wiki 安装完成。仓库中的 open-wiki.bat、publish-wiki.bat 和 update-wiki-kit.bat 可以直接使用。'
  } finally {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
} catch {
  Write-Host "Personal Wiki 安装失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
