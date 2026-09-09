# FlowMind 飞书 AI 工作台

本地优先的知识工作台：把飞书文档和本地文件同步到这台电脑，在当前工作面里问、读、记下容易忘的点。答案必须带出处；库里没有的，直接说没有，不编。

当前版本 **1.3.1**（Windows x64）。

[![Release](https://img.shields.io/github/v/release/lyqi712/flowmind-feishu)](https://github.com/lyqi712/flowmind-feishu/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src="docs/screenshots/home.png" alt="FlowMind 首页：收集、知识库、笔记和问答在同一侧栏" width="920" />
</p>

<p align="center">
  <b>下载 Windows 安装包 / 便携版</b> →
  <a href="https://github.com/lyqi712/flowmind-feishu/releases/latest">GitHub Releases</a>
</p>

---

## 它长什么样

| 问答带引用 | 问题记录，只记容易忘的点 |
| --- | --- |
| <img src="docs/screenshots/chat.png" alt="知识问答：流式回答与来源" /> | <img src="docs/screenshots/notes.png" alt="笔记与问题记录" /> |

<p align="center">
  <img src="docs/screenshots/settings.png" alt="设置：模型、飞书与 MCP" width="920" />
</p>

## 你能用它做什么

- **飞书知识进本地库**：粘贴 Docx / Wiki / Sheet / Bitable / Folder 链接，自动发现空间；同步失败可以重试，不会把半截结果写进库。
- **问库里的事实**：流式回答、可点击引用、空检索拒答。寒暄和「下次记得…」不必等模型。
- **问题记录**：独立笔记类型，记坑不记百科。网页剪藏只接受公网地址，并带上 `sourceRefs`。
- **一页里问和改**：笔记、阅读器和写作共用同一套页面；AI 可以提问或改写，结果写回原文，或另存成问题记录。
- **MCP**：设置里复制一段提示词发给 Claude / ChatGPT / Cursor，即可检索本机知识库；没有出处不许编。
- **本地文件**：PDF、图片 OCR、音频转写和附件都可以进同一套检索。密钥和知识库只存在这台电脑上。

## 安装

打开 [Releases](https://github.com/lyqi712/flowmind-feishu/releases/latest)，按需要下载其中一个：

| 文件 | 用途 |
| --- | --- |
| `FlowMind-Setup-1.3.1-x64.exe` | 常规安装，带开始菜单和桌面快捷方式 |
| `FlowMind-Feishu-AI-Workspace-1.3.1-x64-portable.zip` | 免安装，解压后运行 `FlowMind.exe` |

安装或解压都不会清空你已经同步过的本地知识库。卸载时默认也保留用户数据。

源码可以自己编译；完整安装包只放在 Release，避免把 180MB+ 安装器塞进 Git。

Windows 安装包未做代码签名。第一次打开时，SmartScreen 可能提示「未知发布者」，选择「仍要运行」即可。

## 从源码运行

需要 **Node.js 22+**（Windows x64）。

```powershell
cd app
npm.cmd install
npm.cmd run dev
```

常用命令：

```powershell
npm.cmd run check            # 单测 + 生产构建
npm.cmd run mcp:smoke        # MCP stdio 协议
npm.cmd run desktop:pack     # Windows NSIS 安装包
npm.cmd run desktop:portable # 免安装便携版 zip
```

开发时 API 默认在本机回环地址，不会对公网开放。飞书 App ID / Secret 和模型 Key 只在服务端加密保存。

## 接到 Claude / Codex

最快的接入方式：打开 FlowMind → 设置 → 模型与 Provider → **复制给其他 AI 的提示词**，把那段话发给 Claude / ChatGPT / Cursor。

仓库里也有配置模板（把路径换成你本机的 `app` 目录）：

- [`app/mcp/claude-desktop.example.json`](app/mcp/claude-desktop.example.json)
- [`app/mcp/codex.example.toml`](app/mcp/codex.example.toml)

工具包括 `search_knowledge`、`ask_knowledge`（无证据则拒答）、`run_skill`、`feishu_sync` 等。MCP 不会返回飞书或模型密钥。

## 1.3.1 相对 1.3.0

- 笔记按一页文档来用：可以问、可以改，结果能写回原文或记成问题记录
- 飞书导入和向导失败可恢复，避免卡在半截同步
- 网页剪藏只读公网地址，不碰内网
- 备份恢复按事务落盘
- 同时提供安装包和免安装便携版

更细的说明见 [`docs/RELEASE_NOTES_1.3.1.md`](docs/RELEASE_NOTES_1.3.1.md)。

## 原则

1. 没有命中证据就不编事实。
2. 飞书 Secret 和模型 Key 只在服务端加密保存。
3. 不重置用户数据。
4. 不做成广场、博客、生图或 PPT 产品。

## 许可

MIT。见 [LICENSE](LICENSE)。
