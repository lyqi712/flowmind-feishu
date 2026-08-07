# Contributing to FlowMind

感谢参与 FlowMind。请先在本地确认问题能够复现，再提交范围清晰的改动。

## 开发流程

1. Fork 仓库并创建功能分支。
2. 在 `app` 目录运行 `npm.cmd install` 和 `npm.cmd run dev`。
3. 修改服务端行为时补充 Node/API 回归测试；修改界面时补充 UI 或浏览器验收。
4. 提交前运行 `npm.cmd run check`，并确认 `git diff --check` 没有输出。
5. Pull request 中说明用户场景、行为变化、测试命令和已知限制。

## 边界

不要提交 `.env.local`、API 密钥、飞书真实资料、`runtime-data/`、SQLite 数据库、浏览器 profile、构建目录或本地安装包。测试应使用临时目录和确定性 fixture。

## 代码风格

优先复用现有模块和工具契约，保持引用来源和权限边界。任何写入、外部调用或不可逆动作都必须保留显式确认和可审计反馈。
