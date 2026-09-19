# 参考实现（reference/src）

这份实现不是演示的一部分，它的用途写在种子 README 里：

1. **证明判据可满足**——`test/domains/experiment-cbb-seed.test.ts` 把它贴进临时项目，
   跑 `node tests/acceptance.mjs` 全 18 条，必须全绿；规格与判据漂移时这个用例会先红。
2. **演示兜底**——现场没有可用 Agent 或时间不够时：

   ```bash
   cp -r <cometflow 仓库>/experiments/cbb-emergency-access/reference/src .
   cometflow daemon start . --agent mock
   ```

   因为判据已经能过，daemon 会把 8 个任务依次跑成 delivered（mock 不做实现，只走状态机）。
3. **可对照的接缝写法**——转发器适配器、注入时钟、append-only 审计、响应包络。

默认演示路径**不用**它：`src/` 应当由 Agent 依据 `specs/` 产出，否则「人类只写契约」这个前提就不成立了。

结构：

```text
reference/src/
├─ server.mjs            # 服务入口：路由 / 认证 / 来源收敛 / 包络（protocol.md）
├─ store.mjs             # SQLite 实体表 + append-only 审计（models.md）
├─ access/index.mjs      # 申请 / 审批 / 吊销 / 状态
├─ tunnel/index.mjs      # 通道建立与回收
├─ tunnel/forwarder.mjs  # 默认（演练）转发器适配器
├─ guard/index.mjs       # 回收扫描
└─ audit/index.mjs       # 审计导出
```
