# CometFlow Regression Fixture

本夹具是 CometFlow 平台能力的**长期回归验收清单**。

## 规则

每实现一个新的平台能力，必须同步做两件事：

1. 给平台补单元测试。
2. 在本夹具中增加一个或多个回归场景，并更新 `run-regression.sh`。

未出现在本清单中的能力，视为没有长期回归保障。

## 运行

```bash
cd experiments/regression-fixture
bash run-regression.sh
```

## 当前验收清单

| 能力 | 回归场景 | 状态 |
|---|---|---|
| 项目初始化 | `cometflow init` 单元测试 | ✅ |
| 技术栈/运行环境上下文 | `context sync` + `spec validate` 检查 | ✅ |
| goal sync | `goal sync` + fixture goals | ✅ |
| spec validate | `spec validate .` | ✅ |
| spec lock/diff/drift | `spec drift .` | ✅ |
| plan generate/validate/freeze | 临时副本中执行 | ✅ |
| change list/resume/transition | `change list --all .` | ✅ |
| Native change run/verify/archive | 临时副本 + mock agent | ✅ |
| 科学评估 Pass@k/Pass^k | `eval .` | ✅ |
| evolve verify/review-list | `evolve review-list .` | ✅ |
| skill add/list/import 风险扫描 | 临时副本 | ✅ |
| bundle compile/distribute | 临时副本 opencode | ✅ |
| scheduler queue/safety snapshot | daemon manual 临时副本 | ✅ |
| doctor | `doctor .` | ✅ |
| status/dashboard JSON | `status .` | ✅ |
| Hook/Guard 写保护 | `hook check` 预期拒绝场景 | ✅ |
| Builder/Verifier 分离 | 独立 `verification.yaml` 覆盖验收 | ✅ |
| Dashboard 基础可视化 | `dashboard-smoke.ts` 检查 HTML 与 /api/status | ✅ |
| 多平台 Skill/Bundle 分发 | `bundle distribute` opencode/claude-code/codex | ✅ |
| Classic 工作流 | `classic new/status/transition` 五阶段 | ✅ |

## 待实现能力与未来回归场景

| 待实现能力 | 未来回归场景 | 前置条件 |
|---|---|---|
| 完整 Builder/Verifier 分离 | 已实现独立 verification 文档，见当前清单 | ✅ |
| Hook/Guard 写保护 | 已实现，见当前验收清单 | ✅ |
| Classic 工作流 | 已实现基础五阶段，见当前清单 | ✅ |
| 多平台 Skill/Bundle 分发 | 已实现，见当前清单 | ✅ |
| Dashboard 可视化 | 已实现基础页面，见当前清单 | ✅ |
| LLM judge / LangSmith | 契约测试 + 真实网络集成测试 | 平台实现科学评估增强 |
| npm 发布/安装 | `package-e2e` + 干净环境安装测试 | 平台发布流程 |

## 维护规则

- 新能力未加入本清单前，不允许声称“已具备长期回归保障”。
- 回归失败必须修复平台或夹具，不允许跳过。
- 夹具状态文件（.cometflow/）作为测试基线提交，不参与平台运行时生成物清理。
