<#
.SYNOPSIS
  CometFlow 汇报演示前的自检：环境、Agent、两个演示仓库的状态。

.DESCRIPTION
  逐项断言"上台时依赖的东西现在是什么样"，任何一项不对都会以退出码 1 结束。
  -CheckAgents 会真的调用两个 Agent（各约 10 秒，会消耗少量 API 额度）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/demo/preflight.ps1 -CheckAgents
#>
[CmdletBinding()]
param(
  [string]$DemoRoot = 'D:\zqg\demos',
  [switch]$CheckAgents
)

$ErrorActionPreference = 'Stop'
$failures = 0

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "  ok   $Text" -ForegroundColor Green }
function Bad([string]$Text) { Write-Host "  FAIL $Text" -ForegroundColor Red; $script:failures++ }
function Info([string]$Text) { Write-Host "  info $Text" }

$mainPath = Join-Path $DemoRoot 'cbb-emergency-access'
$donePath = Join-Path $DemoRoot 'cbb-emergency-access-done'

Step '运行环境'
$cf = Get-Command cometflow -ErrorAction SilentlyContinue
if ($cf) { Ok "cometflow $(& cometflow --version) ($($cf.Source))" }
else { Bad 'PATH 上找不到 cometflow；先在仓库根目录执行 npm link' }

# 判据用哪个工具链取决于演示项目是哪种种子（有 go.mod 就是 Go 版）。
$mainIsGo = Test-Path -LiteralPath (Join-Path $mainPath 'go.mod')
if ($mainIsGo) {
  if (Get-Command go -ErrorAction SilentlyContinue) { Ok "go $(& go version)" }
  else { Bad 'PATH 上找不到 go；Go 版种子的判据用 go test 执行' }
}
else {
  $nodeVersion = & node -p "process.versions.node"
  if ([int]($nodeVersion.Split('.')[0]) -ge 24) { Ok "node $nodeVersion" }
  else { Bad "node $nodeVersion 太老；CBB 判据用 node:sqlite，需要 Node 24+" }
}

if (Get-Command opencode -ErrorAction SilentlyContinue) { Ok 'opencode 在 PATH 上' }
else { Bad 'PATH 上找不到 opencode；现场只能走 mock / 录屏兜底' }
if (Get-Command claude -ErrorAction SilentlyContinue) { Ok 'claude 在 PATH 上' }
else { Info 'PATH 上没有 claude；不影响（演示用 opencode）' }

Step 'Agent 适配器'
$agents = & cometflow agent list 2>&1
$agents | ForEach-Object { Info $_ }
if ($agents -match 'opencode\s+available') { Ok 'opencode: available' } else { Bad 'opencode 不是 available' }

if ($CheckAgents) {
  Step 'Agent 真实连通性（会消耗少量 API 额度）'
  Push-Location $env:TEMP
  try {
    $out = & opencode run 'reply with exactly: OK' 2>&1 | Out-String
    if ($out -match 'OK') { Ok 'opencode 连通' } else { Bad "opencode 没回复 OK：$out" }
  }
  finally { Pop-Location }
}

Step "现场主仓库 $mainPath"
if (-not (Test-Path -LiteralPath $mainPath)) {
  Bad '不存在；先跑 scripts/demo/prepare-demo.ps1'
}
else {
  $status = (& cometflow status $mainPath | Out-String) | ConvertFrom-Json
  $frozen = @($status.plans | Where-Object { $_.status -eq 'frozen' }).Count
  if ($frozen -eq 3) { Ok '3 个目标都已冻结' } else { Bad "冻结计划数=$frozen，应为 3" }
  $active = @($status.changes | Where-Object { -not $_.archived })
  if ($active.Count -eq 1 -and $active[0].name -eq 'access-request' -and $active[0].phase -eq 'build') {
    Ok '演示工单就位：access-request 停在构建阶段'
  }
  else {
    Bad "演示工单状态不对（期望 1 个 access-request 且 phase=build，实际 $($active.Count) 个）"
  }
  if (Test-Path -LiteralPath (Join-Path $mainPath 'src')) { Bad 'src/ 已存在；现场演不出"判据先红"' }
  else { Ok '无 src/（判据此刻是红的，符合预期）' }

  $queue = & cometflow daemon queue rebuild $mainPath 2>&1 | Out-String
  if ($queue -match 'queued=7\s+running=1\s+done=0\s+failed=0') { Ok '队列：7 条待办 + 1 条在飞（就是那个演示工单）' }
  else { Bad "队列状态不符合预期：`n$queue" }

  # 幂等性回归：rebuild 连跑两次不该多出行来。曾经因为 mergeTodoView 少一句 overlayById.delete
  # 而在这里重复，界面上会看到同一条任务两行。
  $again = & cometflow daemon queue rebuild $mainPath 2>&1 | Out-String
  $rows = ([regex]::Matches($again, '(?m)^\s+#\d+ ')).Count
  if ($again -match 'queued=7\s+running=1\s+' -and $rows -eq 8) { Ok '队列幂等：连续 rebuild 仍是 8 行' }
  else { Bad "队列 rebuild 不幂等（$rows 行）：`n$again" }

  $validate = & cometflow spec validate $mainPath 2>&1 | Out-String
  if ($validate -match 'spec validate: OK') { Ok 'spec validate: OK' } else { Bad "spec validate 不是 OK：`n$validate" }
  $warnCount = ([regex]::Matches($validate, 'WARNING')).Count
  Info ("spec validate 带 $warnCount 条 warning（想清零见方案文档的『已知瑕疵』一节）")
}

Step "预跑兜底仓库 $donePath"
if (-not (Test-Path -LiteralPath $donePath)) {
  Bad '不存在；先跑 scripts/demo/prepare-demo.ps1'
}
else {
  Push-Location $donePath
  try {
    if (Test-Path -LiteralPath (Join-Path $donePath 'go.mod')) {
      $acceptance = & go test ./tests/acceptance -count=1 2>&1 | Select-Object -Last 1
      if ($acceptance -match '^ok\s') { Ok "18/18 判据通过（$acceptance）" } else { Bad "go test 没有全绿：$acceptance" }
    }
    else {
      $acceptance = & node tests/acceptance.mjs 2>&1 | Select-Object -Last 1
      if ($acceptance -match 'acceptance: OK \(18/18\)') { Ok '18/18 判据通过' } else { Bad "判据不是 18/18：$acceptance" }
    }

    $list = & cometflow change list --all $donePath 2>&1 | Out-String
    $archived = ([regex]::Matches($list, 'archive done archived')).Count
    if ($archived -eq 8) { Ok '8 个 change 全部归档' } else { Bad "归档数=$archived，应为 8" }

    $gate = & cometflow gate check $donePath 2>&1 | Out-String
    if ($gate -match 'gate check: PASS') { Ok 'gate check: PASS' } else { Bad "gate check 不是 PASS：`n$gate" }
  }
  finally { Pop-Location }
}

Step '结论'
if ($failures -eq 0) {
  Write-Host '  preflight: OK —— 可以上台' -ForegroundColor Green
  exit 0
}
Write-Host "  preflight: $failures 项不通过，先修好再上台" -ForegroundColor Red
exit 1
