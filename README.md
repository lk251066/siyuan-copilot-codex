# SiYuan Copilot Codex

> 个人自用 Codex 版插件（仅保留 Codex CLI 工作流）  
> 仓库：<https://github.com/lk251066/siyuan-copilot-codex>  
> 原项目：<https://github.com/Achuan-2/siyuan-plugin-copilot>

## 概览

- 当前版本：`v1.6.37`（2026-02-16）
- 仅支持 Codex CLI（`ask` / `agent`）
- 模型列表读取本地配置：`CODEX_HOME/config.toml`（回退 `~/.codex/config.toml`）
- 保留高频能力：会话管理、引用上下文、附件上传、MCP 工具自检
- 支持与当前工作目录 `AGENTS.md` 同步系统提示词（仅当前工作目录）

## 核心功能

- **聊天与上下文**：支持模式/模型/思考强度切换，支持右键“提交给 Codex”快速注入上下文
- **Git 同步面板**：`status / init / add / commit / pull / push` 一体化操作
- **同步范围控制**：支持“仅笔记内容（.sy + assets）/整个仓库”
- **Pull 安全策略**：rebase pull 默认开启自动暂存（autostash），降低本地改动冲突风险
- **图片工作流**：支持抓图、导图、截图并直接写回笔记（走 MCP 工具链）

## 安装

1. 在思源插件市场安装 `siyuan-copilot-codex`，或手动复制到 `data/plugins/siyuan-copilot-codex`
2. 确保本机可执行 `codex` 命令
3. 在插件设置中启用 `Codex CLI` 并设置工作目录（`--cd`）

## 使用

- 聊天区顶部可切换模式、模型、思考长度
- “拉取模型”从本地 Codex 配置读取模型列表
- “工具自检”可检查当前可用工具
- 右键菜单支持“提交给 Codex”，将选中文本/块加入引用上下文

## Git 同步

### 环境变量（可选）

- `SIYUAN_CODEX_GIT_CLI_PATH`：Git 可执行路径
- `SIYUAN_CODEX_GIT_REPO_DIR`：仓库目录
- `SIYUAN_CODEX_GIT_REMOTE_NAME`：远端名（默认 `origin`）
- `SIYUAN_CODEX_GIT_REMOTE_URL`：远端地址
- `SIYUAN_CODEX_GIT_BRANCH`：分支名
- `SIYUAN_CODEX_GIT_PULL_REBASE=1`：pull 使用 rebase
- `SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1`：rebase pull 自动暂存（默认开启）
- `SIYUAN_CODEX_GIT_SYNC_SCOPE=notes|repo`：同步范围（`notes`=仅笔记）
- `SIYUAN_CODEX_GIT_AUTO_SYNC=1`：打开 Git 面板后自动执行 Auto Sync
- `SIYUAN_CODEX_GIT_COMMIT_MESSAGE`：自动提交信息

> 说明：插件默认禁用交互式鉴权，建议使用 SSH 或系统凭据管理器。

## Codex 图片工作流

推荐按下面顺序调用：

1. `siyuan_extract_page_images`（抓取网页图片 URL）
2. `siyuan_import_image_urls`（批量导入图片）
3. `siyuan_capture_webpage_screenshot`（网页截图入库）
4. `siyuan_insert_images_to_note`（写入指定笔记）

若 MCP 为只读模式，需先调整写权限。

## 最近版本摘要

- **v1.6.37**：引入 `copilot-tokens.scss`，统一聊天卡片与 Diff 弹窗核心样式 token（颜色/边框/圆角/间距/阴影）
- **v1.6.36**：Diff 弹窗增强（Split/Unified、行号、换行切换、上下文折叠、大 diff 性能优化）并补齐键盘可达性
- **v1.6.34**：新增“新消息提示 / 回到底部按钮”，并优化流式渲染阶段性能

完整变更请看 `CHANGELOG.md`。

## 开发与打包

```bash
npm install
npm run dev
npm run build
npm run make-install
```

- 构建目录：`dist/`
- 发布包：`package.zip`

## 更新日志

<https://github.com/lk251066/siyuan-copilot-codex/blob/main/CHANGELOG.md>

## 许可证

GPL-3.0

## 致谢

- SiYuan 插件模板：<https://github.com/siyuan-note/plugin-sample-vite-svelte>
- sy-f-misc：<https://github.com/frostime/sy-f-misc>
- Cherry Studio：<https://github.com/CherryHQ/cherry-studio>
