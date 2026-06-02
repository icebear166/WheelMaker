param(
  [string]$CliPath = $env:MYFLICKER_CLI_MJS,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-MyFlickerCliPath {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $candidates = @()
  $cmd = Get-Command myflicker -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    $baseDir = Split-Path -Parent $cmd.Source
    $candidates += Join-Path $baseDir "node_modules\@myflicker\cli\dist\cli.mjs"
  }

  if ($env:APPDATA) {
    $candidates += Join-Path $env:APPDATA "npm\node_modules\@myflicker\cli\dist\cli.mjs"
  }
  if ($env:USERPROFILE) {
    $candidates += Join-Path $env:USERPROFILE "scoop\apps\nodejs\current\bin\node_modules\@myflicker\cli\dist\cli.mjs"
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Could not locate @myflicker/cli/dist/cli.mjs. Pass -CliPath or set MYFLICKER_CLI_MJS."
}

function Replace-Once {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Before,
    [Parameter(Mandatory = $true)][string]$After,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ($Text.Contains($After)) {
    return @{ Text = $Text; Changed = $false; AlreadyPatched = $true }
  }
  if (-not $Text.Contains($Before)) {
    throw "Patch anchor not found: $Label"
  }

  $index = $Text.IndexOf($Before, [StringComparison]::Ordinal)
  $nextIndex = $Text.IndexOf($Before, $index + $Before.Length, [StringComparison]::Ordinal)
  if ($nextIndex -ge 0) {
    throw "Patch anchor is not unique: $Label"
  }

  $patched = $Text.Substring(0, $index) + $After + $Text.Substring($index + $Before.Length)
  return @{ Text = $patched; Changed = $true; AlreadyPatched = $false }
}

$path = Resolve-MyFlickerCliPath -ExplicitPath $CliPath
$text = Get-Content -LiteralPath $path -Raw -Encoding UTF8

$patches = @(
  @{
    Label = "ACP loadSession capability"
    Before = '{protocolVersion:n01,agentCapabilities:{}}'
    After = '{protocolVersion:n01,agentCapabilities:{loadSession:!0}}'
  },
  @{
    Label = "ACP session init source"
    Before = 'constructor(A,Q,B,D){this.id=A;this.messageBus=Q;this.connection=B;this.clientFsCapabilities=D}async init(){await this.messageBus.request("session.initialize",{cwd:this.defaultCwd,sessionId:this.id,source:"startup"}),this.listenChunkEvent(),this.initPermission(),setTimeout(()=>{this.initSlashCommand()},0)}'
    After = 'constructor(A,Q,B,D){this.id=A;this.messageBus=Q;this.connection=B;this.clientFsCapabilities=D}async init(A="startup"){await this.messageBus.request("session.initialize",{cwd:this.defaultCwd,sessionId:this.id,source:A}),this.listenChunkEvent(),this.initPermission(),setTimeout(()=>{this.initSlashCommand()},0)}'
  },
  @{
    Label = "ACP loadSession implementation"
    Before = 'return this.sessions.set(Q,D),await D.init(),jK("Session created successfully:",Q),{sessionId:Q,models:B||void 0}}loadSession(A){throw Error("Method not implemented.")}unstable_forkSession(A){throw Error("Method not implemented.")}unstable_listSessions(A){throw Error("Method not implemented.")}unstable_resumeSession(A){throw Error("Method not implemented.")}'
    After = 'return this.sessions.set(Q,D),await D.init("startup"),jK("Session created successfully:",Q),{sessionId:Q,models:B||void 0}}async loadSession(A){if(!this.messageBus)throw Error("Agent not initialized");let Q=A.sessionId;if(!Q)throw Error("sessionId is required");jK("Loading session:",Q),Q80("Load params: %O",A);let B=await this.getCanUseModels(),D=new A80(Q,this.messageBus,this.connection,this.clientFsCapabilities);return this.sessions.set(Q,D),await D.init("resume"),jK("Session loaded successfully:",Q),{sessionId:Q,models:B||void 0}}unstable_forkSession(A){throw Error("Method not implemented.")}unstable_listSessions(A){throw Error("Method not implemented.")}unstable_resumeSession(A){return this.loadSession(A)}'
  }
)

$changed = $false
foreach ($patch in $patches) {
  $result = Replace-Once -Text $text -Before $patch.Before -After $patch.After -Label $patch.Label
  $text = $result.Text
  if ($result.Changed) {
    $changed = $true
    Write-Host "Prepared patch: $($patch.Label)"
  } elseif ($result.AlreadyPatched) {
    Write-Host "Already patched: $($patch.Label)"
  }
}

if (-not $changed) {
  Write-Host "MyFlicker ACP resume patch already applied: $path"
  exit 0
}

if ($DryRun) {
  Write-Host "Dry run only; no files written: $path"
  exit 0
}

$backupPath = "$path.wheelmaker-acp-resume.bak"
if (-not (Test-Path -LiteralPath $backupPath)) {
  Copy-Item -LiteralPath $path -Destination $backupPath
  Write-Host "Backup written: $backupPath"
} else {
  Write-Host "Backup already exists: $backupPath"
}

Set-Content -LiteralPath $path -Value $text -Encoding UTF8 -NoNewline
Write-Host "MyFlicker ACP resume patch applied: $path"
