# 前端页面

前端由 cometflow Web 面板承担；游戏本身不另做画布。

## 页面：殖民地总览

- 路由：/#/project/{id}/overview
- 交互：展示资源库存、建筑列表、tick 计数
- 状态：经 SSE 实时刷新

## 页面：建造面板

- 路由：/#/project/{id}/changes
- 交互：下达建造 → run → verify → archive
- 状态：job 进度 + 日志
