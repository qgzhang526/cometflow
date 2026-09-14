# 错误码目录

全局错误码：code → 语义 → 触发接口。

## 错误码

| code | 语义 | 触发接口 |
|------|------|----------|
| E_BUILD_NO_ENERGY | 能量不足，无法建造 | POST /buildings |
| E_BUILD_CAP_REACHED | 建筑数量已达上限 | POST /buildings |
| E_TASK_CONFLICT | 同一目标已有进行中的任务 | POST /buildings |
| E_BUILDING_UNKNOWN | 未知建筑实例 | POST /buildings |
| E_RES_UNKNOWN | 未知资源编码 | GET /state |
