<#
.SYNOPSIS
  把演示项目编译并跑起来（Windows / PowerShell）。

.DESCRIPTION
  做三件事：
    1. 在项目里写一份可运行的配置 demo/config.json（auth.mode=header，演练与验收用）
    2. go build 出 demo/server.exe
    3. 前台启动服务，就绪后打印监听地址与几条可直接粘贴的验证命令

  默认跑兜底仓库（cbb-emergency-access-done，有完整实现）；主仓库在跑完 Builder 之后
  也可以这样跑，只是只有被实现过的那部分接口能用。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\run-server.ps1
  powershell -ExecutionPolicy Bypass -File scripts\demo\run-server.ps1 -Project D:\zqg\demos\cbb-emergency-access -Port 8090
#>
[CmdletBinding()]
param(
  [string]$Project = 'D:\zqg\demos\cbb-emergency-access-done',
  [int]$Port = 8080,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$Project = (Resolve-Path -LiteralPath $Project).Path
if (-not (Test-Path -LiteralPath (Join-Path $Project 'go.mod'))) {
  throw "不是 Go 项目：$Project"
}

$demoDir = Join-Path $Project 'demo'
New-Item -ItemType Directory -Force -Path $demoDir | Out-Null

# 配置与 specs/config.md 的键一一对应；allowed_source_cidrs 必须包含下面 curl 用的来源地址。
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
$configPath = Join-Path $demoDir 'config.json'
# 必须写成无 BOM 的 UTF-8：Go 的 json.Unmarshal 见到 BOM 会直接报错。
[System.IO.File]::WriteAllText(
  $configPath,
  ($config | ConvertTo-Json -Depth 6),
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "config : $configPath" -ForegroundColor Cyan

$exePath = Join-Path $demoDir 'server.exe'
if (-not $NoBuild) {
  Write-Host "build  : go build -o demo/server.exe ./cmd/server" -ForegroundColor Cyan
  & go -C $Project build -o $exePath ./cmd/server
  if ($LASTEXITCODE -ne 0) { throw "go build 失败" }
}
if (-not (Test-Path -LiteralPath $exePath)) { throw "没找到可执行文件：$exePath（先去掉 -NoBuild 构建一次）" }

Write-Host ''
Write-Host "服务起在 http://127.0.0.1:$Port（Ctrl+C 停）" -ForegroundColor Green
Write-Host '另一终端可以这样验：' -ForegroundColor DarkGray
Write-Host @"
  # 1) requester 发起申请
  curl.exe -s -X POST http://127.0.0.1:$Port/api/emergency/access/request ``
    -H "content-type: application/json" ``
    -H "x-actor-id: ops-on-call" -H "x-actor-roles: requester" ``
    -H "x-forwarded-for: 10.0.0.8" ``
    -d "{\"server_id\":\"srv-prod-01\",\"reason\":\"磁盘告警\",\"duration_minutes\":15}"

  # 2) 同一个人换审批角色去批自己 → 403 E_SELF_APPROVAL
  # 3) 换 ops-lead 审批 → 200 并返回一次性令牌
  #    完整三条见 docs/demo/go-demo-runbook.md 的「编译、运行与手动验证」一节
"@ -ForegroundColor DarkGray

Push-Location $Project
try {
  & $exePath --config (Join-Path 'demo' 'config.json') --port $Port
}
finally {
  Pop-Location
}
