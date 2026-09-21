# 上台前 15 分钟检查清单

> 打印这一页。按顺序打勾；任何一项没过就先处理，别带病上台。
> 配套：[Go 版演示说明（runbook）](./go-demo-runbook.md)

## T-15　起服务（全场唯一的终端操作）

- [ ] 在 cometflow 仓库根目录起服务：

  ```powershell
  cd D:\zqg\github\cometflow-enrich-ui
  cometflow serve --workspace D:\zqg\demos --port 4321
  ```

- [ ] **记下它打印的完整地址**（带 `?token=...`）。后面所有页面都用这个地址打开，不要手敲 `localhost:4321`
- [ ] 这个窗口**别关**
- [ ] 如果 serve 是昨天起的：**先关掉浏览器里的工作台页面，再按 Ctrl+C**（SSE 长连接会让 Ctrl+C 停不掉），然后重新起一次

## T-12　自检

- [ ] ```powershell
      powershell -ExecutionPolicy Bypass -File scripts\demo\preflight.ps1
      ```
      末行必须是 `preflight: OK —— 可以上台`
- [ ] 它逐项确认：G1/G2 已冻结、G3 停在 draft、工单停在构建阶段、
      **实现未产出**（判据是红的）、骨架可编译、队列 6 待办 + 1 在飞、
      13 份 spec 里 1 份草案、兜底 18/18 且 gate PASS
- [ ] 可选（会真的调 Agent，各约 10 秒）：加 `-CheckAgents`

## T-10　两个仓库各点一遍

**现场主演示 `cbb-emergency-access`：**

- [ ] 规格 → Spec 文件 → `specs/audit/spec.md` 是**橙色「草案」**（这是故意留给现场的，别提前批准）
- [ ] 计划 → G3 状态是 `draft`；G1、G2 是 `frozen`
- [ ] 变更 → `access-request` 停在**构建阶段**，「验收」按钮是**灰的**
- [ ] 调度 → 队列 **7 行**（6 条待办 + 1 条在飞）

**兜底 `cbb-emergency-access-done`（另开一个标签页）：**

- [ ] 变更里 8 条全部已归档；账本 18/18；门禁 PASS

## T-6　演示素材就位

- [ ] 记住兜底标签页在第几个（Agent 卡住就切过去）
- [ ] 四段录屏文件就绪（runbook 第 7 节）
- [ ] PPT 打开在封面；投影分辨率下确认正文字号

## T-3　环境细节

- [ ] 浏览器**只留工作台这一个标签页**（多余标签既拖慢切换，也是 Ctrl+C 停不掉 serve 的原因之一）
- [ ] 关掉会弹通知的软件（微信、邮件、系统更新）
- [ ] 电源接上，关闭睡眠

## T-1　口头确认（三句口径）

- [ ] 开场：「这套东西不解决模型能力，也不解决需求本身；它管的是从『怎么写』到『可交付』这一段」
- [ ] 被问「另一个审批人怎么演」：「**审批人是身份不是人**。演示环境用请求头 `X-Actor-Id` / `X-Actor-Roles` 换身份，
      同一台机器就能演；生产走管理平台会话。验收用例 A5 就是同一个身份证换审批帽子去批自己，403。」
- [ ] 被问「兜底是怎么来的」：「兜底是**预跑结果**（同一份种子、把流程走完），验的是流程与账本；
      Agent 真能不能做，看的是主仓库这一场。」

## 应急口令

| 情况 | 动作 |
|---|---|
| Builder 跑完判据没过 | 点「验收」→ 三行 FAILED → **再点一次「运行 Builder」**（这本身就是第 13 页要讲的事：验收不过退回构建） |
| Agent 卡住 / 网络不通 | 切兜底仓库，流程照走，判据全绿 |
| 界面出问题 | 切到提前录好的录屏 |
| 端口冲突 | 换 `--port 4400` 重起 |
| 页面白屏或 401 | 用启动时打印的完整地址（带 token）重开 |
| 想现场看代码能跑 | runbook 末尾「编译、运行与手动验证」：`scripts\demo\smoke-api.ps1` 一条命令出结论 |

## 演示结束后

- [ ] 把主仓库恢复成上台状态：

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\demo\prepare-demo.ps1 -Force
  ```
