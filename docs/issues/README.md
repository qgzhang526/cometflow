# Issue 归档（GitHub → 内网 GitLab 迁移）

这个目录是 GitHub 上 issue 的**离线归档**。仓库要从 `qgzhang526/cometflow` 迁到内网 GitLab，
而 `git clone/push` 只搬运提交、分支和 tag——issue 正文、评论、PR 讨论都不会跟着走，
所以把迁移时仍在跟踪的 issue 落成文件，跟代码一起进版本库。

导出时间 2026-09-22（迁移当天），导出时两个 issue 都是 OPEN。

| # | 标题 | 状态 | 归档文件 | 原始链接 |
|---|---|---|---|---|
| 3 | N4: 并发 spec 写入从 warn 切到 fail（到期约 2026-10-14） | OPEN | [0003-n4-concurrency-warn-to-fail.md](./0003-n4-concurrency-warn-to-fail.md) | https://github.com/qgzhang526/cometflow/issues/3 |
| 30 | 实现越界（unattributed）导致 change 停机：判定、影响与处理 | OPEN | [0030-out-of-module-writes-blocked.md](./0030-out-of-module-writes-blocked.md) | https://github.com/qgzhang526/cometflow/issues/30 |

约定：

- 归档文件是**快照**，不是持续同步的镜像。迁移之后的新讨论在内网 GitLab 上进行，
  结论需要长期留存时回写到对应文件。
- 正文逐字保留、不做事后改写；本次归档过程中的补充说明一律写在文末的「迁移备注」里。
- 文件名用四位 issue 号前缀，便于排序与检索；只归档迁移时仍在跟踪的 issue，
  已关闭的历史 issue 不追溯补齐。
