# 领域规则

领域不变量；不描述常驻进程（进程归 processes.md），不重述字段（字段归 models.md）。

## 规则：建造能量前提

- 语义：任何建造/升级在投产前必须满足能量成本校验，否则任务失败
- 模型：Building
- 错误码：E_BUILD_NO_ENERGY

## 规则：建筑数量上限

- 语义：殖民地建筑总数不得超过 build.maxCount
- 模型：Building
- 配置键：build.maxCount
- 错误码：E_BUILD_CAP_REACHED

## 规则：单目标单任务

- 语义：同一建筑/科技同一时刻至多一个进行中的任务
- 模型：ProductionTask
- 错误码：E_TASK_CONFLICT
