# 演示种子（Go 版）：CBB 应急运维接入

这是 [`../cbb-emergency-access/`](../cbb-emergency-access/README.md) 的 **Go 变体**：契约、判据、场景完全一致，
只是后端技术栈从 Node.js 换成 Go，验收执行器从 `tests/acceptance.mjs` 换成 `go test`。

两个版本并存是有意的：Node 版是当前演示脚本用的种子（它有一份可跑的参考实现，做演示兜底），
Go 版是给真实项目用的起点。**演示仍然用 Node 版**，这一份不会进入演示路径。

## 它解决什么问题

生产服务器的 SSH 被防火墙策略封锁，只开放了配置管理页面端口。值班运维在需要紧急排障时，
失去了一条可用的接入路径。本 CBB 提供**受控的应急接入**：显式申请 → 审批 → 一次性令牌 →
限时通道 → 到期/空闲自动回收 → 全审计。

## 技术栈

| 维度 | 值 |
|------|-----|
| 后端 | Go |
| 数据库 | SQLite（`modernc.org/sqlite`，纯 Go、免 cgo） |
| 测试框架 | `go test`（标准库 `testing`） |
| 构建工具 | `go build` / `go vet` |
| 语言版本 | Go 1.25+（SQLite 驱动 `modernc.org/sqlite` v1.59 要求 1.25） |

## 目录

```text
cbb-emergency-access-go/
├─ COMETFLOW.md                  # 使命 + 技术栈 + 模块归属 + 调度顺序 + 三个目标 G1..G3
├─ go.mod                        # module cbb-emergency-access
├─ specs/                        # 13 个 spec 文件（12 类 kind 覆盖 11 类）
│  └─ <capability>/spec.md       # front-matter 声明 module: internal/<capability>
├─ internal/
│  └─ app/seam.go                # 接缝：配置、Forwarder/Clock 接口、Start/Run（当前返回 ErrNotImplemented）
├─ _reference/                   # 参考实现（不在编译路径上，见下）
│  ├─ internal/{store,access,tunnel,guard,audit,app}/
│  └─ cmd/server/main.go
└─ tests/acceptance/             # 判据执行器：TestA1..TestA18
   ├─ acceptance_test.go         # 18 条判据
   ├─ harness_test.go            # 造配置、起服务、发请求、断言
   ├─ fakes_test.go              # 转发器替身（正常 + 总是失败）
   └─ testdata/server-targets.json
```

## 怎么跑

```bash
go test ./tests/acceptance -count=1                     # 全部 18 条判据
go test ./tests/acceptance -run '^TestA9$' -count=1     # 单条判据（spec 里的 - check 就是这么调的）
go vet ./...                                            # 静态检查
```

`-count=1` 不能省：`go test` 默认会命中测试缓存，同一份代码第二次跑可能直接返回上次的 PASS，
判据就失去意义了。

**现在跑起来是红的，这是设计意图。** `internal/app.Start` 目前返回 `ErrNotImplemented`，
验收执行器会把它报成「缺少实现：internal/ 下还没有产出实现」——契约与判据先写，实现由 Agent
在 CometFlow 的 change / daemon 通道里产出。

## 参考实现（`_reference/`）

`_reference/` 是一份可跑通的参考实现，用途与 Node 版的 `reference/src` 相同：证明 18 条判据可满足，
以及在没有可用 Agent 时给演示兜底。**它不在编译路径上**——Go 工具链会忽略以 `_` 开头的目录
（Node 版不需要这条约定，因为 Node 不做目录扫描）。

把它贴进项目、跑绿全部判据：

```bash
cp -r _reference/internal/* internal/    # 覆盖接缝所在包，补上各 capability
cp -r _reference/cmd .                   # 进程形态入口
go test ./tests/acceptance -count=1      # 18 条全绿
```

## 和 Node 版的对应关系

| Node 版 | Go 版 |
|---|---|
| `src/server.mjs` 的 `createApp({ configPath })` | `internal/app.Start(app.Options{...})` → `app.Server` |
| `node tests/acceptance.mjs A9` | `go test ./tests/acceptance -run '^TestA9$' -count=1` |
| `tunnel.forwarder_module`（动态 import 一个 .mjs） | `app.Options.Forwarder` 注入 `app.Forwarder` 实现（Go 没有动态加载） |
| `guard.now`（配置里给一个时刻） | `app.Options.Now` 注入时钟，且是实现里唯一的时间源 |
| `tests/fixtures/fake-forwarder.mjs` | `tests/acceptance/fakes_test.go` 的 `newFakeForwarder()` |
| `tests/fixtures/server-targets.json` | `tests/acceptance/testdata/server-targets.json` |
| `src/<capability>/` | `internal/<capability>/` |

两个最容易踩的点写在 [specs/config.md](specs/config.md) 的「接缝」一节：时钟必须贯穿审计与过期判定，
否则假时钟下「按时间范围导出」的验收会取不到事件；A14 的「跨进程重启」要求守卫状态落盘，
只活在内存里的实现会被这条判据抓住。
