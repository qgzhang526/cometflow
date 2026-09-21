<#
.SYNOPSIS
  完整流程验证：把汇报要走的每一步跑一遍，重复 N 轮，出一张结果表。

.DESCRIPTION
  每轮做这些事（顺序与上台一致）：
    1. prepare-demo.ps1 -Force        重建两个演示仓库
    2. preflight.ps1                  自检（期望 preflight: OK）
    3. G3 现场链路                     批准定稿 → 计划 校验/评审/批准/冻结 → 队列补齐到 8 行
    4. access-request 工单             跑 Builder → 验收 → 归档
    5. 范围报告                        期望 unattributed: 0（没有越界）
    6. 兜底仓库                        18/18 判据 + gate check（preflight 里已覆盖）
    7. 接口冒烟                        smoke-api.ps1：编译 → 起服务 → 三条 API

  任一步不符即记为该轮失败，继续跑完剩下的轮次，最后统一汇总。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\demo\validate-flow.ps1 -Rounds 10
  powershell -ExecutionPolicy Bypass -File scripts\demo\validate-flow.ps1 -Rounds 1 -Agent opencode
#>
[CmdletBinding()]
param(
  [int]$Rounds = 10,
  [ValidateSet('mock', 'opencode', 'claude-code')][string]$Agent = 'mock',
  [string]$DemoRoot = 'D:\zqg\demos',
  [int]$MainPort = 8080
)

$ErrorActionPreference = 'Stop'
# 日志与结论里全是中文；把输出编码固定成 UTF-8，便于重定向到文件后阅读。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainPath = Join-Path $DemoRoot 'cbb-emergency-access'
$donePath = Join-Path $DemoRoot 'cbb-emergency-access-done'

function Run([string]$Exe, [string[]]$Arguments) {
  # 原生命令往 stderr 写东西时，$ErrorActionPreference='Stop' 会把它当成终止错误；
  # 这里临时降级成 Continue，靠退出码判断成败。
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $Exe @Arguments 2>&1 | Out-String }
  finally { $ErrorActionPreference = $prev }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

$results = @()
for ($round = 1; $round -le $Rounds; $round++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $steps = [ordered]@{}
  Write-Host ''
  Write-Host "================= 第 $round / $Rounds 轮（agent=$Agent） =================" -ForegroundColor White
  try {

  # 1) 重建
  $r = Run 'powershell' @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scriptDir 'prepare-demo.ps1'), '-Force')
  $steps['重建演示仓库'] = ($r.Code -eq 0)

  # 2) 自检
  $r = Run 'powershell' @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scriptDir 'preflight.ps1'))
  $ok = $r.Code -eq 0 -and $r.Out -match 'preflight: OK'
  $steps['preflight 自检'] = $ok
  if (-not $ok) { Write-Host $r.Out -ForegroundColor DarkGray }

  # 3) G3 现场链路
  $r = Run 'cometflow' @('spec', 'approve', 'specs/audit/spec.md', $mainPath)
  $steps['G3 批准定稿'] = ($r.Code -eq 0)
  foreach ($cmd in @('validate', 'review', 'approve', 'freeze')) {
    $r = Run 'cometflow' @('plan', $cmd, 'G3', $mainPath)
    $steps["G3 plan $cmd"] = ($r.Code -eq 0)
  }
  $r = Run 'cometflow' @('daemon', 'queue', 'rebuild', $mainPath)
  $steps['队列补齐到 8 行'] = ($r.Out -match 'queued=7\s+running=1')

  # 4) 工单：跑 Builder → 验收 → 归档。
  #    mock 不写任何代码，主仓库（还没实现）跑不出绿——这是预期行为，所以 mock 轮跳过这一步；
  #    要验"Agent 真能把任务做完"，用 -Agent opencode。
  if ($Agent -eq 'mock') {
    Write-Host '  --   mock 不写代码，跳过主仓库的 Builder 步骤（兜底仓库仍会全量验证）' -ForegroundColor DarkGray
  }
  else {
    $r = Run 'cometflow' @('change', 'run', 'access-request', $mainPath, '--agent', $Agent)
    $steps["跑 Builder（$Agent）"] = ($r.Code -eq 0)
    $r = Run 'cometflow' @('change', 'verify', 'access-request', $mainPath)
    $steps['验收 PASSED'] = ($r.Out -match 'reportPassed=true')
    if (-not $steps['验收 PASSED']) {
      # 验收没过时把结论留下来：多数情况是 Agent 这一轮没写全，重跑一次即可
      Write-Host '  --   验收输出（末 12 行）：' -ForegroundColor DarkGray
      ($r.Out -split "`n" | Select-Object -Last 12) | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
    }
    $r = Run 'cometflow' @('change', 'archive', 'access-request', $mainPath)
    $steps['归档'] = ($r.Code -eq 0)

    # 5) 范围报告
    $r = Run 'cometflow' @('change', 'scope', 'access-request', $mainPath)
    $steps['范围报告 0 越界'] = ($r.Out -match 'unattributed: 0')
    if ($r.Out -notmatch 'unattributed: 0') { Write-Host $r.Out -ForegroundColor DarkGray }
  }

  # 6) 兜底仓库判据
  $r = Run 'go' @('-C', $donePath, 'test', './tests/acceptance', '-count=1')
  $steps['兜底 18/18 判据'] = ($r.Code -eq 0)

  # 7) 接口冒烟（编译 + 起服务 + 三条 API）
  $r = Run 'powershell' @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scriptDir 'smoke-api.ps1'), '-Project', $donePath, '-Port', "$MainPort")
  $steps['接口冒烟（编译/起服务/三条 API）'] = ($r.Code -eq 0 -and $r.Out -match 'smoke-api: OK')
  if ($r.Out -notmatch 'smoke-api: OK') { Write-Host $r.Out -ForegroundColor DarkGray }

  $sw.Stop()
  $failed = @($steps.Keys | Where-Object { -not $steps[$_] })
  foreach ($k in $steps.Keys) {
    if ($steps[$k]) { Write-Host ("  ok   {0}" -f $k) -ForegroundColor Green }
    else { Write-Host ("  FAIL {0}" -f $k) -ForegroundColor Red }
  }
  Write-Host ("  轮耗时 {0:N0} 秒；失败 {1} 项" -f $sw.Elapsed.TotalSeconds, $failed.Count) -ForegroundColor Cyan
  $results += [pscustomobject]@{ Round = $round; Seconds = [int]$sw.Elapsed.TotalSeconds; Failed = ($failed -join '、') }
  }
  catch {
    $sw.Stop()
    Write-Host ("  第 {0} 轮异常中止：{1}" -f $round, $_.Exception.Message) -ForegroundColor Red
    $results += [pscustomobject]@{ Round = $round; Seconds = [int]$sw.Elapsed.TotalSeconds; Failed = ('异常：' + $_.Exception.Message) }
  }
}

Write-Host ''
Write-Host '================= 汇总 =================' -ForegroundColor White
$results | Format-Table -AutoSize | Out-String -Width 160 | Write-Host
$bad = @($results | Where-Object { $_.Failed })
if ($bad.Count -gt 0) {
  Write-Host ("validate-flow: FAIL —— {0}/{1} 轮有失败" -f $bad.Count, $Rounds) -ForegroundColor Red
  exit 1
}
Write-Host ("validate-flow: OK —— {0} 轮全过（agent={1}，含主项目与兜底项目）" -f $Rounds, $Agent) -ForegroundColor Green
