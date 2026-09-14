# 建造设施流程

一次性场景：从下达建造到设施投产的端到端流程。

## 前置条件

- 殖民地已初始化
- 能量库存 ≥ energy.buildCost
- 模型：Building

## 步骤

### 步骤1 创建建造任务

- 调用 POST /buildings
- 模型：Building

### 步骤2 施工

- 调用 GET /state 轮询施工进度
- 模型：ProductionTask

### 步骤3 投产

- 施工完成，Building.status 转为 running，纳入 production-tick 结算
- 模型：Building

## 后置条件

- 新增建筑状态为 running
- 能量库存已扣除建造成本
