<#
.SYNOPSIS
  演示项目的接口冒烟测试：编译 → 起服务 → 打三条 API → 断言 → 停服务。

.DESCRIPTION
  验的是一条完整的业务链路（一台机器、一个人、三个身份帽子）：
    1. requester 发起申请              → code=0 且返回 request_id
    2. 同一个人换审批角色去批自己      → HTTP 403 且 code=E_SELF_APPROVAL
    3. 换 ops-lead 审批                → code=0 且返回一次性令牌

  退出码 0 表示全过；任何一条不符就非 0，并打印实际响应。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\smoke-api.ps1
#>
[CmdletBinding()]
param(
  [string]$Project = 'D:\zqg\demos\cbb-emergency-access-done',
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$Project = (Resolve-Path -LiteralPath $Project).Path
$demoDir = Join-Path $Project 'demo'
New-Item -ItemType Directory -Force -Path $demoDir | Out-Null

$failures = @()
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host "  ok   $Name" -ForegroundColor Green }
  else { Write-Host "  FAIL $Name $Detail" -ForegroundColor Red; $script:failures += $Name }
}

function Wait-Port([int]$Port, [int]$Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $client.Connect('127.0.0.1', $Port)
      $client.Close()
      return $true
    }
    catch { Start-Sleep -Milliseconds 300 }
  }
  return $false
}

function Post([string]$Path, [hashtable]$Headers, [string]$Body, [string]$Tag) {
  # body 走文件：PowerShell 调原生命令时会把参数里的双引号吃掉，
  # 直接 -d '{"a":"b"}' 传到 curl 会变成 {a:b}，服务端解析失败、字段全空。
  $bodyFile = Join-Path $demoDir "body-$Tag.json"
  $respFile = Join-Path $demoDir "resp-$Tag.json"
  [System.IO.File]::WriteAllText($bodyFile, $Body, (New-Object System.Text.UTF8Encoding($false)))
  $args = @('-s', '-o', $respFile, '-w', '%{http_code}', '-X', 'POST', "http://127.0.0.1:$Port$Path")
  foreach ($k in $Headers.Keys) { $args += @('-H', "$k`: $($Headers[$k])") }
  $args += @('-H', 'content-type: application/json', '--data-binary', "@$bodyFile")
  $status = & curl.exe @args
  $raw = if (Test-Path -LiteralPath $respFile) {
    [System.IO.File]::ReadAllText($respFile, (New-Object System.Text.UTF8Encoding($false)))
  } else { '' }
  $json = $null
  if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { } }
  return [pscustomobject]@{ Status = [int]$status; Raw = $raw; Json = $json }
}

Write-Host "build  : go build -o demo/server.exe ./cmd/server" -ForegroundColor Cyan
& go -C $Project build -o (Join-Path $demoDir 'server.exe') ./cmd/server
if ($LASTEXITCODE -ne 0) { throw 'go build 失败' }

# 配置由脚本自己写：不依赖 run-server.ps1 先跑过。键与 specs/config.md 一一对应。
$config = [ordered]@{
  auth    = [ordered]@{ mode = 'header' }
  store   = [ordered]@{ file = 'demo/state.db' }
  targets = [ordered]@{ file = 'tests/acceptance/testdata/server-targets.json' }
  access  = [ordered]@{
    max_duration_minutes    = 30
    idle_timeout_minutes    = 5
    require_second_approver = $false
    allowed_source_cidrs    = @('127.0.0.0/8', '10.0.0.0/8')
    reject_limit_per_hour   = 3
    circuit_break_minutes   = 30
  }
  tunnel  = [ordered]@{ listen_port = 22022; forward_to_port = 22; forwarder = 'memory' }
  guard   = [ordered]@{ tick_seconds = 10; teardown_retries = 1; now = '' }
  audit   = [ordered]@{ export_dir = 'demo/export'; retention_days = 180 }
  alert   = [ordered]@{ webhook_url = 'http://127.0.0.1:9/unused'; notify_on = @('request_created', 'request_approved') }
}
[System.IO.File]::WriteAllText(
  (Join-Path $demoDir 'config.json'),
  ($config | ConvertTo-Json -Depth 6),
  (New-Object System.Text.UTF8Encoding($false))
)

# 每次跑都从干净的库开始，免得 request_id 与令牌串场
Remove-Item -LiteralPath (Join-Path $demoDir 'state.db') -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $demoDir -Filter 'resp-*.json' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$outLog = Join-Path $demoDir 'server.out.log'
$errLog = Join-Path $demoDir 'server.err.log'
$proc = Start-Process -FilePath (Join-Path $demoDir 'server.exe') `
  -ArgumentList '--config', 'demo/config.json', '--port', "$Port" `
  -WorkingDirectory $Project -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

try {
  if (-not (Wait-Port -Port $Port -Seconds 30)) {
    Write-Host '  FAIL 服务没起来' -ForegroundColor Red
    Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue | Out-String | Write-Host
    Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue | Out-String | Write-Host
    exit 1
  }
  Write-Host "  ok   服务就绪：http://127.0.0.1:$Port" -ForegroundColor Green

  $actorRequester = @{ 'x-actor-id' = 'ops-on-call'; 'x-actor-roles' = 'requester'; 'x-forwarded-for' = '10.0.0.8' }
  $actorApprover = @{ 'x-actor-id' = 'ops-lead'; 'x-actor-roles' = 'approver'; 'x-forwarded-for' = '10.0.0.8' }
  $selfApprover = @{ 'x-actor-id' = 'ops-on-call'; 'x-actor-roles' = 'approver'; 'x-forwarded-for' = '10.0.0.8' }

  Write-Host '== A1 发起申请' -ForegroundColor Cyan
  $created = Post '/api/emergency/access/request' $actorRequester `
    '{"server_id":"srv-prod-01","reason":"磁盘告警","duration_minutes":15}' 'request'
  Check 'HTTP 200' ($created.Status -eq 200) "实际 $($created.Status)"
  Check 'code=0' ($created.Json.code -eq '0') "实际 $($created.Json.code)"
  Check '返回 request_id' ([bool]$created.Json.data.request_id) $created.Raw
  Check '状态 pending' ($created.Json.data.status -eq 'pending')
  $requestId = $created.Json.data.request_id

  Write-Host '== A5 自己批自己' -ForegroundColor Cyan
  $self = Post '/api/emergency/access/approve' $selfApprover `
    ('{"request_id":"' + $requestId + '","decision":"approve","comment":"自己批自己"}') 'self'
  Check 'HTTP 403' ($self.Status -eq 403) "实际 $($self.Status)"
  Check 'code=E_SELF_APPROVAL' ($self.Json.code -eq 'E_SELF_APPROVAL') "实际 $($self.Json.code)"

  Write-Host '== A4 换人审批' -ForegroundColor Cyan
  $approved = Post '/api/emergency/access/approve' $actorApprover `
    ('{"request_id":"' + $requestId + '","decision":"approve","comment":"同意"}') 'approve'
  Check 'HTTP 200' ($approved.Status -eq 200) "实际 $($approved.Status)"
  Check 'code=0' ($approved.Json.code -eq '0') "实际 $($approved.Json.code)"
  Check '状态 approved' ($approved.Json.data.status -eq 'approved')
  Check '发放一次性令牌' ([bool]$approved.Json.data.grant.token) $approved.Raw
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}

if ($failures.Count -gt 0) {
  Write-Host "smoke-api: FAIL（$($failures -join '、')）" -ForegroundColor Red
  exit 1
}
Write-Host 'smoke-api: OK —— 编译、起服务、三条接口全部符合契约' -ForegroundColor Green
