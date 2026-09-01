# web capability

网页版 2048：与终端版共用同一引擎与 AI，浏览器直接可玩。

## FR-WEB-001 页面与交互

双击 web/index.html 无需服务器即可游玩（单文件 IIFE，无模块依赖）；支持 WASD / 方向键 / 触屏滑动；R 键或按钮重开。

## 验收

- A501：web/index.html 直接打开可渲染棋盘（file:// 可用，无顶层 import/export）
- A502：WASD / 方向键 / 触屏滑动均能驱动移动
- A503：R 键或按钮可重开一局

## FR-WEB-002 计分与持久化

实时展示分数与最高分；最高分保存在浏览器 localStorage。

## 验收

- A510：分数与最高分随对局实时更新
- A511：重开或刷新后最高分仍保留（localStorage）

## FR-WEB-003 AI 提示与构建

「AI 提示」按钮给出建议方向（复用 src/ai）；构建脚本产出单文件 web/2048.js。

## 验收

- A520：AI 提示返回合法方向
- A521：node scripts/build-web.mjs 可复现产出 web/2048.js（无顶层 import/export）

## FR-WEB-004 引擎一致性

与终端版共用 src/core 与 src/ai，不复制逻辑。

## 验收

- A530：web 实现仅新增 src/web/ui.ts 视图层，引擎/AI 源码零复制
- A531：主项目测试套件全部通过（含 web 冒烟用例）
