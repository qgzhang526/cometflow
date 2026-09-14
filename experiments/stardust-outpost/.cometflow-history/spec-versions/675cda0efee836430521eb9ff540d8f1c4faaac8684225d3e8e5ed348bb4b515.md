# 后台进程

常驻后台进程：production-tick 是游戏的心脏，每 tick 结算产量/消耗/库存。

## 进程：production-tick

- 触发条件：服务启动后按 tick.intervalMs 周期触发
- 输入：当前殖民地状态（Colony、Resource、Building）
- 处理逻辑：对每个 running 建筑按类型结算产量与消耗，更新 Resource.amount，Colony.tick += 1
- 输出：更新后的资源库存与 tick 计数
- 异常处理：库存/上限越界时回滚本次 tick 并记录
- 配置键：tick.intervalMs
- 模型：Colony
- 模型：Resource
- 模型：Building
