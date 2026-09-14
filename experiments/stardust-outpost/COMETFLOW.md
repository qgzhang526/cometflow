# 项目使命

用 CometFlow 自身（spec 驱动 + 自动拆解 + 真实 Agent + eval 门禁 + evolve 进化）开发一款「放置经营」类太空殖民地小游戏 **星尘前哨 Stardust Outpost**，并把游戏作为 cometflow Web 前端（serve + 面板 UI）的功能验证靶子：每一个游戏操作驱动一个前端面板，每一类游戏实体对应一个 spec kind。

## 技术栈

| 维度 | 值 |
|------|-----|
| 前端 | TypeScript 引擎 + CometFlow Web 面板 |
| 后端 | Node.js + CometFlow serve |
| 数据库 | 无（纯内存 + YAML 存档） |
| 缓存 | 无（纯内存） |
| 测试框架 | vitest |
| 构建工具 | tsc |

## 运行环境

| 维度 | 值 |
|------|-----|
| 操作系统 | Windows / Linux |
| 部署方式 | 单机 + cometflow serve |
| 语言版本 | Node.js ≥ 22 |

## 任务目标

### G1：游戏引擎与数据模型
- 目标：以纯 TypeScript 实现资源、建筑、生产 tick 与殖民地状态的核心引擎
- 范围：engine, models
- 成功标准：
  - 资源库存、建筑状态机、生产 tick 的确定性单测通过
  - 随机源可注入，固定种子可复现
  - 引擎不依赖渲染与输入，可被 serve 与测试直接调用
- 非目标：
  - 不做图形界面（前端由 cometflow Web 面板承担）
  - 不做 AI 决策

### G2：建造工作流
- 目标：将「下达建造 → 施工 → 验收 → 投产」接入 change 工作流，施工为异步 job
- 范围：build
- 成功标准：
  - 建造任务经 change run→verify→archive 完整流转，verify-fail 可回退
  - 施工进度经 SSE 实时推送，job 日志可轮询
  - 投产前校验能量/上限等规则，不满足即失败
- 非目标：
  - 不做建筑拆除（见后续 G）
  - 不做多人协作

### G3：目标与计划拆解
- 目标：殖民地阶段目标可自动拆解为建造/生产计划并冻结
- 范围：goals, plan
- 成功标准：
  - plan generate 将目标拆为任务并覆盖全部 spec_ref，validate 无 missing-coverage
  - plan approve/freeze 后任务不可漂移
  - 目标与计划在前端 Goals/Plans 面板可完整操作
- 非目标：
  - 不做 LLM 智能拆解（先用确定性拆解）
  - 不做计划回滚

### G4：科技树与进化
- 目标：科研点驱动科技研究，经 evolve 提案→门禁→批准解锁新建筑/新资源
- 范围：research, evolve
- 成功标准：
  - 科技提案经 evolve verify 门禁（typecheck/test/eval）后 approve
  - 解锁后新建筑/资源在引擎中可用
  - 未批准提案不产生解锁效果
- 非目标：
  - 不做科技回退
  - 不做在线多人科技共享

### G5：自动化评估与平衡
- 目标：以 eval.yaml 断言产量曲线与资源平衡，产出可复现的平衡性评估
- 范围：eval
- 成功标准：
  - 采样 N 局断言产量/库存上限/解锁节奏全部通过
  - rubric 对平衡性给出可复现评分
  - 评估结果经 job 返回并在 Eval 面板展示
- 非目标：
  - 不做真实 LLM judge（先用 mock/断言）
  - 不做在线排行榜
