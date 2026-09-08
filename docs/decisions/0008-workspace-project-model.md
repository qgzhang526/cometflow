# 0008 serve 采用工作区 + 项目注册表模型

状态：提议（2026-09-07）
关联：008-client-visualization.md、ADR 0007

## 背景

用户要求应用打开后有项目选择页：新建项目（选择本地路径 + 创建，对应 `cometflow init`）、打开已有项目、最近项目列表。原 008 草案假设 serve 启动时绑定单一项目，无法支持「新建/切换项目」的页面需求。

## 决策

1. `cometflow serve` 引入工作区（workspace）概念：启动时指定 `--workspace <dir>`（默认 `~/.cometflow/workspace`），工作区维护 `workspace.json` 项目注册表。
2. 项目注册表字段：`id`（注册表内唯一，服务端生成）、`name`、`path`（项目真实本地路径）、`lastOpenedAt`、`createdAt`。
3. 新建项目 = 在用户选择的本地路径执行 `init` 并注册；打开已有项目 = 扫描该路径存在 `COMETFLOW.md` 后注册。注册表只存引用，不复制、不迁移项目文件。
4. 项目内端点按 `/api/projects/{projectId}/...` 路由；服务端把 projectId 解析为 path，前端不直接接触绝对路径。
5. CLI 保持单项目直连（`cometflow <cmd> [path]`），不受工作区影响；workspace.json 仅服务 serve/UI。

## 后果

正面：

- 网页可管理多个项目、提供最近项目与项目摘要。
- projectId 间接寻址，避免绝对路径进 URL，也便于未来做访问控制。

负面：

- 所有项目内端点多一层 projectId 路由与路径解析。
- 需要注册表读写、projectId→path 校验（防止越界到工作区外路径）。
