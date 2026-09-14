# ADR 0018：多 change 并存时按 current-change 指针路由写入

状态：已批准
日期：2026-09-14

## 背景

hook guard 之前只有一种处理多 change 的方式：**只要同时存在两个活跃 change，就拒绝所有写入**。
这在无人值守场景里是安全的，但在日常开发里几乎不可用——只要开了第二个 change，所有写操作都被卡死，
而且拒绝理由只说明「有多个 change」，不说明「该怎么办」。

真正缺的不是更强的限制，而是**归属信息**：一次写入属于哪个 change。这个信息只有人能提供。

## 决策

1. 引入 `.cometflow/current-change.json` 指针，记录「当前 change」及其来源（`auto` / `manual`）。
2. `change new` 自动把新建的 change 设为当前（`auto`）；`change archive` 归档后自动摘除指针。
3. `change select <name>` 手动指定；`change select <name> --clear` 清除。
4. hook 路由规则：
   - 0 个活跃 change → 放行（与之前一致）；
   - 1 个活跃 change → 直接用它（无歧义，不需要指针，行为与之前一致）；
   - 多个活跃 change + 指针有效 → **按指针那个 change** 的 phase 与 module 判定；
   - 多个活跃 change + 无指针 → 拒绝（`multiple-active-changes`），提示运行 `change select`；
   - 指针指向不存在或已归档的 change → 拒绝（`stale-current-change`），提示重新指定。
5. 指针写入走原子路径；指针文件损坏等同于「没有指针」，即 fail closed。
6. `doctor` 在多 change 且有有效指针时降级为 info，无指针时保持 warning 并给出命令。

## 理由

- 归属是人的决定，不是推断出来的：agent 与 hook 都无法从「写 src/auth/x.ts」反推出它属于哪个 change。
- 指针缺失时**拒绝而不是猜**：猜错归属会把代码写进错误的 change 边界，比拒绝写入危险得多。
- 单个活跃 change 时保持旧行为，避免为常见情况引入额外步骤。
- 指针必须是原子写入的，否则会引入新的「半写状态」——这类不可判定状态正是 H1 在消除的东西。

## 后果

- 多 change 并存的工作流从「完全不可用」变成「先 select 再干活」。
- `.cometflow/current-change.json` 是新增的机器状态；它进 `.cometflow/`（被 gitignore），不随仓库分发。
- `change status` 会打印 `current-change:` 行；`hook check` 的拒绝理由带上可执行的修复建议。
- 关闭指针（`--clear`）会退回 fail-closed 行为，便于验证「归属未定义时确实会被拦」。
