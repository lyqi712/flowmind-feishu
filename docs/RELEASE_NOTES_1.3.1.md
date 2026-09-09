# FlowMind 1.3.1

Windows x64 安装包和免安装便携版。源码在仓库里，完整安装器只放这一页。

## 安装

到 [Releases](https://github.com/lyqi712/flowmind-feishu/releases/latest) 下载其中一个：

| 文件 | 用途 |
| --- | --- |
| `FlowMind-Setup-1.3.1-x64.exe` | 常规安装 |
| `FlowMind-Feishu-AI-Workspace-1.3.1-x64-portable.zip` | 解压即用 |

按向导安装或解压后运行 `FlowMind.exe`。不会清空你已有的本地知识库。

- 安装包 SHA256：`603ADFA6268014FCC2A62B3746FAF9EB0C83E084D3E33C7DBEAC44A7F1D36395`（约 160 MB）
- 便携版 SHA256：`8519BE82388A00F33A10938DAB307F790B3874783789524FD1C5C3B9D2F2CC17`（约 229 MB）

Windows 安装包未做代码签名。SmartScreen 可能提示「未知发布者」，选择「仍要运行」即可。

## 这一版

- 笔记、阅读器和写作共用同一套页面：AI 只有「问」和「改」两个动作，结果可以替换选区、插在后面，或写成问题记录
- 飞书导入失败可重试；向导不会停在半截状态
- 网页剪藏只接受公网地址，并保留来源引用
- 备份恢复走事务，避免写出半截库
- 同时发布 NSIS 安装包和便携 zip

1.3.0 已有的能力保留：空检索拒答、流式问答、MCP、飞书密钥和模型 Key 只在本机加密保存。

## 发布前检查（2026-09-09）

本机跑过后再打包装到 Release：

- `cd app && npm.cmd run check`：单测 + 生产构建
- `npm.cmd run mcp:smoke`：MCP stdio
- `npm.cmd run desktop:pack` / `desktop:portable`：生成上述两个包
