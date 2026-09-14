# ADR 0017：change 绑定 git 来源，漂移时阻断

状态：已批准
日期：2026-09-14

## 背景

change 是「基于某个代码状态开工」的承诺：spec 版本、acceptance、实现范围基线都是围绕那个状态冻结的。
但代码状态本身没有被记录——如果开工后历史被回退（`reset --hard`）或切到与之无关的分支，
change 会继续在**错误的基础上**接受验证、写回 spec，而且没有任何提示。

## 决策

1. `change new` 记录 `base_commit`（`git rev-parse HEAD`）与 `base_branch`。
2. `change run` / `verify` / `archive` 推进前校验来源，`doctor` 汇总报告。
3. 判定只看**祖先关系**，不看分支名：
   - 当前 HEAD 就是基准，或基准仍是当前 HEAD 的祖先 → 放行（分支切换、正常提交都属此类）；
   - 当前 HEAD 是基准的祖先 → `head-rewound`（历史被回退）；
   - 两者互不为祖先 → `diverged`（分叉或切到无关历史）。
4. 非 git 仓库、老 change 未记录基准、基准对象不存在（浅克隆/换机器）→ **降级为提示，不阻断**。
5. 显式放行有两条路径：CLI `--allow-drift` 或项目配置 `git.allow_drift: true`；放行会写入审核流水。

## 理由

- 只看祖先关系是唯一不需要猜作者意图的判据：在 main 上提交、基于 main 开分支、在分支上继续提交，都属于「HEAD 在基准之后」。
- 把「分支名变了」当成错误会误伤最常见的开发方式；因此分支名只用于报告，不参与阻断。
- 非 git 场景必须能用（沙箱、CI 临时 checkout、导出包），所以一切「拿不到信息」的情况都不能变成硬失败。
- 放行必须是显式的、留痕的：忽略来源漂移是一个有后果的决定，不能默认发生。

## 后果

- `comet-state.yaml` 增加 `base_commit` / `base_branch`；老 change 缺字段时按未绑定处理。
- `change status` 多一行 `git: <status>`；漂移时 `doctor` 报 `git-provenance-drift` 错误。
- `change run/verify/archive` 新增 `--allow-drift`；放行会记录 `git-drift-overridden` 事件，含来源与判定结果。
- 在浅克隆或导出的仓库里工作不会受阻，但也拿不到来源保护——这是刻意的取舍。
