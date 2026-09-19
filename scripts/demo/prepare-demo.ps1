<#
.SYNOPSIS
  准备 CometFlow 汇报演示环境（现场主仓库 + 预跑兜底仓库）。

.DESCRIPTION
  默认用 Go 版种子（experiments/cbb-emergency-access-go）：

    cbb-emergency-access       现场主演示：3 个目标已冻结 / 工单停在构建阶段 / 无实现
    cbb-emergency-access-done  预跑兜底：8 条全部交付 / 18 条判据通过 / gate check PASS

  可重复执行：已存在的目录会被改名备份为 <name>.bak-<时间戳>，不删除任何东西。
  录屏之后想把主仓库恢复成"上台前"的样子，再跑一次本脚本加 -Force。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/demo/prepare-demo.ps1 -Force

.EXAMPLE
  # 用 Node 版种子（旧演示路径）
  powershell -ExecutionPolicy Bypass -File scripts/demo/prepare-demo.ps1 -Force -Seed node
#>
[CmdletBinding()]
param(
  [string]$DemoRoot = 'D:\zqg\demos',
  [ValidateSet('go', 'node')]
  [string]$Seed = 'go',
  [string]$SeedPath,
  [switch]$Force,
  [switch]$SkipFallback
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$manifestTemplate = Join-Path $scriptDir 'assets\init-manifest.cbb.yaml'
if (-not $SeedPath) {
  $SeedPath = if ($Seed -eq 'go') {
    Join-Path $repoRoot 'experiments\cbb-emergency-access-go'
  } else {
    Join-Path $repoRoot 'experiments\cbb-emergency-access'
  }
}
$isGo = Test-Path -LiteralPath (Join-Path $SeedPath 'go.mod')

$mainPath = Join-Path $DemoRoot 'cbb-emergency-access'
$donePath = Join-Path $DemoRoot 'cbb-emergency-access-done'

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Die([string]$Text) { Write-Host "FAILED: $Text" -ForegroundColor Red; exit 1 }

function Backup-Existing([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    if (-not $Force) {
      Die "$Path 已存在。加 -Force 备份后重建（原目录会改名为 <name>.bak-<时间戳>）。"
    }
    $backup = "$Path.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    Move-Item -LiteralPath $Path -Destination $backup
    Write-Host "已备份 $Path -> $backup"
  }
}

# 把种子里"属于项目"的文件贴进演示仓库：契约与判据，不含参考实现。
function Copy-SeedProject([string]$Path) {
  Copy-Item -LiteralPath (Join-Path $SeedPath 'COMETFLOW.md') -Destination $Path -Force
  Copy-Item -LiteralPath (Join-Path $SeedPath 'specs') -Destination $Path -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $SeedPath 'tests') -Destination $Path -Recurse -Force
  if ($isGo) {
    Copy-Item -LiteralPath (Join-Path $SeedPath 'go.mod') -Destination $Path -Force
    Copy-Item -LiteralPath (Join-Path $SeedPath 'go.sum') -Destination $Path -Force
    Copy-Item -LiteralPath (Join-Path $SeedPath 'internal') -Destination $Path -Recurse -Force
  }
}

# 把参考实现贴进演示仓库。Go 的参考实现放在 _reference/（Go 工具链忽略下划线开头的目录）。
function Copy-SeedReference([string]$Path) {
  if ($isGo) {
    Copy-Item -LiteralPath (Join-Path $SeedPath '_reference\internal') -Destination $Path -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $SeedPath '_reference\cmd') -Destination $Path -Recurse -Force
  } else {
    Copy-Item -LiteralPath (Join-Path $SeedPath 'reference\src') -Destination $Path -Recurse -Force
  }
}

function New-DemoProject([string]$Path) {
  Backup-Existing $Path
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  Push-Location $Path
  try {
    cometflow init . | Out-Null
    # 12-kind 裁剪结果：等价于在真实终端里跑 init --interactive 并回答十个问题
    Copy-Item -LiteralPath $manifestTemplate -Destination (Join-Path $Path '.cometflow\init-manifest.yaml') -Force
    Copy-SeedProject $Path
    # plan_review 默认 high-risk，而高风险识别规则尚未实现，会打印一句"按 human 兜底"的提示；
    # 显式写 human，提示语更干净，语义完全一致（都停在 draft 等人批准）。
    $configPath = Join-Path $Path '.cometflow\config.yaml'
    (Get-Content -LiteralPath $configPath -Raw) -replace 'plan_review:\s*\S+', 'plan_review: human' |
      Set-Content -LiteralPath $configPath -NoNewline

    cometflow context sync . | Out-Null
    cometflow goal sync . | Out-Null
    cometflow spec validate .
    cometflow spec lock . | Out-Null
    cometflow spec index . | Out-Null

    foreach ($goal in @('G1', 'G2', 'G3')) {
      cometflow plan generate $goal . | Out-Null
      cometflow plan validate $goal .
      cometflow plan approve $goal . | Out-Null
      cometflow plan freeze $goal . | Out-Null
    }

    cometflow daemon queue rebuild .
  }
  finally { Pop-Location }
}

Step '前置条件'
if (-not (Get-Command cometflow -ErrorAction SilentlyContinue)) {
  Die 'PATH 上找不到 cometflow。先在仓库根目录执行：npm link'
}
if (-not (Test-Path -LiteralPath $SeedPath)) { Die "找不到演示种子：$SeedPath" }
Write-Host "cometflow  : $((Get-Command cometflow).Source)"
Write-Host "seed       : $SeedPath ($(if ($isGo) { 'Go' } else { 'Node' }))"
Write-Host "demo root  : $DemoRoot"

if ($isGo) {
  if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Die 'PATH 上找不到 go。Go 版种子的判据用 go test 执行，演示前必须先装 Go 1.25+。'
  }
  $goVersion = (& go version)
  Write-Host "go         : $goVersion"
} else {
  $nodeVersion = (& node -p "process.versions.node")
  Write-Host "node       : $nodeVersion"
  if ([int]($nodeVersion.Split('.')[0]) -lt 24) {
    Die "CBB 判据用 Node 24 内置的 node:sqlite，当前是 Node $nodeVersion。"
  }
}

Step "生成现场主仓库 $mainPath"
New-DemoProject $mainPath

if (-not $SkipFallback) {
  Step "生成预跑兜底仓库 $donePath"
  # 注意：目标目录必须先不存在，Copy-Item 才会把源目录复制成同名目标目录；
  # 目标已存在时它会把源目录塞成子目录（历史上踩过一次）。
  Backup-Existing $donePath
  Copy-Item -LiteralPath $mainPath -Destination $donePath -Recurse -Force
  # 参考实现必须在 change new 之前放进项目，否则会被判定为越界写入
  Copy-SeedReference $donePath
  Push-Location $donePath
  try {
    # mock 只走状态机不写代码；判据仍然真跑，实现来自参考实现
    cometflow daemon start . --agent mock --budget 1800000 --interval 200
    cometflow gate check . --update-baseline | Out-Null
    cometflow gate check .
    if ($isGo) {
      & go test ./tests/acceptance -count=1 | Select-Object -Last 1
    } else {
      node tests/acceptance.mjs | Select-Object -Last 1
    }
  }
  finally { Pop-Location }
}

# 现场工单必须在兜底仓库复制之后才建：先建的话，兜底仓库里那条任务会被判定成
# 「已有人在飞」，mock 调度器不会再去跑它，最后只能交付 7 条。
Step "给主仓库建现场工单 $mainPath"
Push-Location $mainPath
try {
  # 等价于界面上的「新建」+「确认验收」，都已实测。
  cometflow change new access-request --goal G1 --task T1 --path . | Out-Null
  cometflow change transition access-request confirm-acceptance . | Out-Null
  cometflow daemon queue rebuild .
}
finally { Pop-Location }

Step '完成'
Write-Host "现场主演示：$mainPath"
Write-Host "  · 3 个目标已冻结、工单 access-request 停在构建阶段、无实现（判据此刻是红的）"
if (-not $SkipFallback) {
  Write-Host "预跑兜底  ：$donePath"
  Write-Host "  · 8 条全部交付、18/18 判据通过、gate check PASS"
}
Write-Host ''
Write-Host '演示前先跑一遍自检：powershell -ExecutionPolicy Bypass -File scripts/demo/preflight.ps1'
