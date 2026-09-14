# 运行时配置

运行时配置契约：键 → 类型 → 默认值 → 必填 → 敏感。平衡参数集中于此，改动即热更新。

## 配置项

| 键 | 类型 | 默认值 | 必填 | 敏感 | 说明 |
|----|------|--------|------|------|------|
| tick.intervalMs | integer | 1000 | 否 | 否 | 生产 tick 间隔（毫秒） |
| energy.initial | integer | 100 | 否 | 否 | 初始能量 |
| energy.buildCost | integer | 50 | 否 | 否 | 建造基础能量成本 |
| energy.upgradeCost | integer | 80 | 否 | 否 | 升级基础能量成本 |
| mine.outputPerTick | integer | 2 | 否 | 否 | 采矿站每 tick 矿石产量 |
| power.outputPerTick | integer | 3 | 否 | 否 | 发电站每 tick 能量产量 |
| factory.inputPerTick | integer | 1 | 否 | 否 | 工厂每 tick 矿石消耗 |
| factory.outputPerTick | integer | 1 | 否 | 否 | 工厂每 tick 零件产量 |
| build.maxCount | integer | 10 | 否 | 否 | 建筑数量上限 |
