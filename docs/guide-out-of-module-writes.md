# 实现越界（unattributed changes）：判定、影响与处理

这份说明记录一次真实排查：**Agent 把不属于本工单模块的文件也改了，验收被拦、工单停机**。
以后再遇到同类现象，照第 4、5 节处理即可。

---

## 1. 现象长什么样

验收不通过，但**判据本身是全绿的**——失败原因不是行为不对，而是"动了不该动的地方"：

```text
verify-result passed=false
  verdicts=["A12:passed@check","A13:passed@check"]
  violations=["implementation escaped module internal/tunnel:
               internal/access/config.go, internal/access/model.go,
               internal/access/server.go, internal/access/service.go"]
  repair_attempts=3  stalled=true
```

界面上的对应现象：

- 工单状态变成 **blocked**，页面提示「连续得到相同失败结论，已停机等待人工介入（repair_attempts=3）」，并给出「解除停机」按钮；
- 「范围」页签顶部出现「越界改动（既不在 spec 声明的模块内，也不在 allow 列表里）」区块，逐条列出文件；
- 命令行 `cometflow change scope <name> .` 会打印每条改动的归属，并在有越界时**退出码为 1**。

---

## 2. 判定规则

### 2.1 归属只分四种

`attributionFor(相对路径, module, allow)` 的判定顺序是：

1. 在**允许清单**里（精确匹配，或目录前缀匹配）→ `allow-list`
2. 等于本工单声明的 module → `module`
3. 在本工单 module 目录之下 → `module-prefix`
4. 其余 → `unattributed`（越界）

注意 **允许清单优先级高于模块**：一个路径只要在清单里，就永远算 `allow-list`。

### 2.2 module 是"能力"，不是"接口"

capability spec 的 front-matter 写的是 `module: internal/access`——**一个目录**。
所以把同一个 capability 的多个接口一起实现（`internal/access/server.go`、`service.go`…）
属于 `module-prefix`，**不算越界**；写进 `internal/tunnel/` 才算。

任务边界（一个 anchor 一个任务）是**拆解与验收的口径**，不是写权限的边界，两者别混。

### 2.3 允许清单在哪

两个来源，取并集：

| 来源 | 位置 | 生效方式 |
|---|---|---|
| 契约（权威） | `COMETFLOW.md` 的 `## 模块归属` 表第一列 | 需要 `cometflow context sync .` 投影到 `.cometflow/project-context.yaml` 的 `shared_paths` 才生效 |
| 配置覆盖 | `.cometflow/config.yaml` 的 `scope.allow` | 立即可用，不走投影 |

> **改了 `COMETFLOW.md` 却没生效**，九成是漏了 `context sync`。

### 2.4 范围报告是"相对基线的实时差异"，不是工单账本

基线在 `change new` 时采集，存在 `.cometflow/runtime/changes/<name>/impl-baseline.json`，
每条记录只有 `{hash, size}`。报告 = **基线快照 vs 当前工作区**。

由此推出两个容易误判的现象：

- **工单活久了，报告会被别人写的文件污染**。同一个工单，验收当时干净，几天后再看范围报告，
  可能报出一堆后来别人写的文件——那不是它写的，只是相对它的基线新增了。
- **归档之后再回头看范围报告没有意义**。要看"当时干了什么"，看「流水」（journal）与验收结论。

反过来说，这也意味着：**把改动内容恢复成与基线一致，越界条目就会自动消失**（因为不再是差异）。

---

## 3. 为什么越界必须被拦住

越界不会立刻让程序出错，但它会让三件事同时失效：

| 保证 | 正常情况 | 越界之后 |
|---|---|---|
| **验收背书的范围** | 验收通过 ⇒ 本次改动被这几条判据覆盖过 | 越界那部分零覆盖，却挂着同一张验收单 |
| **回滚的粒度** | 回滚这个工单，正好撤掉它引入的改动 | 越界文件属于别的能力，回滚会带走不属于它的东西 |
| **并发的安全** | 两个任务动不同模块，可以并行 | 并发排除按**声明的 module** 判定，越界正好落在盲区里，表现为偶发覆盖 |

还有两个次生影响：**追溯链断裂**（从被改的 spec 出发找不到"谁实现的它"），
以及**后续工单变得不可判定**（判据没变，但它要验的对象已经被别人改过了）。

---

## 4. 处理：先分流，再动手

### 第 0 步：看清改了什么

```bash
cometflow change scope <name> .        # 逐条归属；退出码 1 = 有越界
cometflow change journal <name> .      # 看 validate 的 violations 与 repair_attempts
git diff --stat <越界目录>              # 确认真的是内容改动，不是只碰了时间戳
```

### 情形 A：本工单其实不需要改那个目录

```bash
git restore <越界目录>/                 # 内容恢复到与基线一致
cometflow change scope <name> .        # 应变成 unattributed: 0
```

### 情形 B：确实需要那份共享能力 → 分成两个工单

顺序是**先下沉、后使用**：

1. `git restore <越界目录>/` 先撤掉越界改动；
2. 在**拥有该目录的能力**的工单里，把共享的实体与查询**下沉到允许清单里的共享路径**
   （Go 项目就是 `internal/store`；`specs/models.md` 里 store 本来就是实体的 owner）；
3. 回到原工单，让它只改自己的模块 + 共享路径：

```bash
cometflow change unblock <name> . --note "共享查询已下沉到 internal/store，本工单不再改 access"
cometflow change run <name> --agent opencode .
cometflow change scope <name> .        # 应只剩自己的模块 + 共享路径
cometflow change verify <name> .
cometflow change archive <name> .
```

**顺序不能反**：先解封、什么都不改就验收，只会再撞一次同样的结论，很快重新进入停机
（连续三次相同 fingerprint 就停）。

### 让 Agent 做对这件事

Builder 的提示词里已经含冻结的规格段落与 acceptance，人类唯一的输入面是 `changes/<name>/brief.md`。
写清三件事——**目标 / 边界 / DoD**：

```markdown
## 目标
把 tunnel 关闭通道时需要的实体与查询，从 internal/access 下沉到 internal/store；
access 只保留业务逻辑，改为调用 store 的公开接口。行为不变。

## 边界
- 允许改：internal/store、internal/access
- 不要改：internal/tunnel（那是另一个工单的事）

## DoD
- access 现有验收全绿
- store 提供 tunnel 需要的查询
```

---

## 5. 两条"捷径"不要走

| 做法 | 后果 |
|---|---|
| 点「范围」页签的**重新采集**（把当前工作区当新基线） | 红字消失，但等于**承认这次越界合法**：这个工单以后可以随便改那个目录，也不再提醒。它只适用于"基线本身采错了"（如采集时目录读不到） |
| 把越界目录**加进 `COMETFLOW.md` 的模块归属** | 等于永久拆掉这个能力的边界。判断标准只有一条：**"任何一个能力的工单都可能碰到它吗？"** 是 → 共享路径；否 → 不是加清单，而是把共享面收窄到 store |

---

## 6. 验收标准（怎么算处理完了）

1. `cometflow change scope <name> .` → `unattributed: 0`，且每条改动的归属是 `module` / `module-prefix` / `allow-list`；
2. 该工单的验收判据全绿（`[check]` 来源）；
3. 若做过下沉：跨模块那一侧的新工单只改自己的模块 + 共享路径；
4. 全量判据仍全绿（搬家没有改坏既有行为）。

---

## 7. 相关代码位置

| 关注点 | 位置 |
|---|---|
| 归属判定与范围采集 | `domains/workflow/implementation-scope.ts`（`attributionFor` / `collectImplementationScope` / `resolveScopeAllow`） |
| 验收里怎么用范围 | `domains/workflow/change-execution.ts`（越界进 `violations` → `passed=false`） |
| 独立 Verifier 的输入 | `domains/workflow/change-verifier.ts`（把越界清单写进 Verifier 提示词） |
| 停机与解封 | 连续相同结论（相同 fingerprint）达上限 → `stalled` → `blocked`；`cometflow change unblock` |
| 允许清单来源 | `COMETFLOW.md` 的 `## 模块归属` + `.cometflow/config.yaml` 的 `scope.allow` |
