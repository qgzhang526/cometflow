# 项目使命

todoscan：一个零依赖的命令行小工具，扫描指定目录里的 TODO / FIXME / HACK 注释并汇总输出，供代码评审和 CI 使用。

## 技术栈

| 维度 | 值 |
|------|-----|
| 前端 | 无 |
| 后端 | Node.js |
| 数据库 | 无 |
| 缓存 | 无 |
| 测试框架 | node --test |
| 构建工具 | 无（纯 ESM，零依赖） |

## 运行环境

| 维度 | 值 |
|------|-----|
| 操作系统 | 跨平台 |
| 部署方式 | 本地 CLI |
| 语言版本 | Node 22+ |

## 模块归属

每个 capability 的实现限定在各自 `specs/<capability>/spec.md` front-matter 声明的 `module` 内。
以下路径是跨 capability 共享的，允许在模块之外改动：

| 共享路径 | 说明 |
|----------|------|
| bin | CLI 入口，跨 capability 共享 |
| tests | 夹具与验收执行器，不属于任何 capability 模块 |
| package.json | 依赖清单与脚本 |

## 任务目标

### G1：todoscan 命令行扫描器
- 目标：实现一个零依赖的 Node CLI，递归扫描目录中的 TODO/FIXME/HACK 注释并输出报告
- 范围：scan, report, settings
- 成功标准：
  - `node bin/todoscan.mjs <dir>` 能输出全部命中项，且顺序稳定
  - `--json` 输出可被程序解析
  - 配置文件与命令行参数的优先级明确且可测
- 非目标：
  - 不做语法解析（按行匹配注释文本即可）
  - 不做增量缓存、不做常驻进程
  - 不做网络请求
