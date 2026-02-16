# SiYuan Copilot Codex

> 个人自用，随缘更新。  
> 仓库地址：<https://github.com/lk251066/siyuan-copilot-codex>  
> 致敬原项目：<https://github.com/Achuan-2/siyuan-plugin-copilot>

## 项目说明

- 当前版本：`v1.6.37`（2026-02-16）
- 仅保留 `Codex CLI` 工作流（`ask` / `agent`）。
- 模型列表读取本地 `CODEX_HOME/config.toml`（未设置时回退 `~/.codex/config.toml`），不依赖第三方模型接口。
- 支持会话管理、引用上下文、附件上传、MCP 工具自检。
- 系统提示词可与当前工作目录 `AGENTS.md` 同步（仅当前工作目录，不是全局）。
- 新增 Codex 图片工作流：可通过 MCP 工具完成“抓取网页图片 / 导入图片 URL / 网页截图 / 写入笔记”。

## 与原项目功能差异

对比原项目 <https://github.com/Achuan-2/siyuan-plugin-copilot>，本项目主要差异如下：

- 引擎策略：仅保留 Codex CLI，不再作为多平台 AI 聚合入口使用。
- 模型来源：模型列表来自本地 Codex 配置（`CODEX_HOME/config.toml` 或 `~/.codex/config.toml`），不再依赖外部模型列表接口。
- 设置侧重点：设置页围绕 Codex 使用流程精简，平台管理默认关闭，仅保留兼容字段。
- 提示词联动：支持与当前工作目录 `AGENTS.md` 同步，便于项目级规范落地。
- 交互增强：右键菜单支持“提交给 Codex”，可将选中文本/块快速加入聊天引用上下文。
- 功能取舍：保留会话管理、引用上下文、附件上传、工具自检等高频功能；不再维护旧的小程序/翻译等入口。
- 聊天区操作调整：已移除“保存到笔记”“编辑消息”按钮，改为统一走工具调用流程。

## 安装

1. 在思源插件市场安装 `siyuan-copilot-codex`，或手动安装到 `data/plugins/siyuan-copilot-codex`。
2. 本机可执行 `codex` 命令。
3. 在插件设置中启用 `Codex CLI`，并配置工作目录（`--cd`）。

## 使用要点

- 聊天区顶部可切换模式、模型、思考长度。
- 点击“拉取模型”会从本地 Codex 配置读取模型列表。
- 点击“工具自检”可快速检查当前可用工具。
- 图片相关建议直接用工具调用：
  - `siyuan_extract_page_images`
  - `siyuan_import_image_urls`
  - `siyuan_capture_webpage_screenshot`
  - `siyuan_insert_images_to_note`

## 最新改动映射（2026-02-16）

- 发布 `v1.6.37`：P4（对标 VSCode Copilot Chat）— 新增 `copilot-tokens.scss`，并将聊天消息卡片与 Diff 弹窗核心样式迁移到 token（颜色/边框/圆角/间距/阴影），保持交互行为不变
- 发布 `v1.6.36`：P3（对标 VSCode Copilot Chat）— Diff 弹窗增强（Split/Unified 切换、行号、默认 no-wrap + 横向滚动、wrap 切换、上下文折叠/展开、大 diff 性能优化）；并补齐弹层键盘支持（Esc 关闭、Tab 焦点可见）
- 发布 `v1.6.35`：P2（对标 VSCode Copilot Chat）— 代码块工具条增强：语言标签（非空才显示）、复制、换行切换、长代码折叠/展开
- 发布 `v1.6.34`：P1（对标 VSCode Copilot Chat）— 新消息提示/回到底部按钮、选区保护、流式性能优化（减少流式阶段 DOM 全量扫描）
- 发布 `v1.6.33`：修复 Windows 下 Git 路径包含空格时可能提示“未检测到 git”的问题（`git --version` 执行失败）
- 发布 `v1.6.32`：Git 同步范围新增“仅笔记内容（.sy + assets）/整个仓库”切换；仅笔记模式下 Auto Sync/Add/Commit 不再 `git add -A` 全仓库

## 最新改动映射（2026-02-15）

- 发布 `v1.6.31`：Diff 弹窗优先使用 `git diff --no-index`（失败回退内置 diff），并支持一键复制 patch
- 新增 Git 同步对话框：status/init/add/commit/pull/push，支持配置仓库目录/remote/分支并展示执行日志
- 修复聊天滚动与删除消息组：向上滚动时暂停自动滚动，流式结束后补一次收尾滚动；删除消息组时连带删除 tool 消息

## Git 同步（环境变量）

不想在设置里手填时，可用环境变量自动填充（优先级低于“对话框/设置”）：

- `SIYUAN_CODEX_GIT_CLI_PATH`：Git 可执行路径（可选）
- `SIYUAN_CODEX_GIT_REPO_DIR`：Git 仓库目录
- `SIYUAN_CODEX_GIT_REMOTE_NAME`：remote 名称（默认 origin）
- `SIYUAN_CODEX_GIT_REMOTE_URL`：remote URL（GitHub/Gitee）
- `SIYUAN_CODEX_GIT_BRANCH`：分支名（可选）
- `SIYUAN_CODEX_GIT_PULL_REBASE=1`：pull 使用 rebase（可选）
- `SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1`：rebase pull 自动暂存本地改动（默认开启）
- `SIYUAN_CODEX_GIT_SYNC_SCOPE=notes|repo`：同步范围（notes=仅笔记内容）
- `SIYUAN_CODEX_GIT_AUTO_SYNC=1`：打开 Git 同步窗口自动执行 Auto Sync
- `SIYUAN_CODEX_GIT_COMMIT_MESSAGE`：自动提交信息（可选）

说明：插件默认禁用交互式鉴权（避免卡住），推荐使用 SSH remote 或系统凭据管理器；失败时会在日志里给可执行的排查指引。

## 最新改动映射（2026-02-14）

- 发布 `v1.6.30`：补齐卸载清理逻辑，删除插件配置与存储残留（含历史命名目录）。
- i18n 全量核对：中英文递归键数量一致（`zh_CN=612`、`en_US=612`），无缺失键。
- 时间线按真实顺序展示：`思考 -> 搜索 -> 工具调用 -> Diff`，并支持展开/收起。
- 子代理（sub-agent）输出仅显示在执行时间线，不再混入最终回答正文。
- `Diff` 在时间线中作为独立条目显示，视觉样式与思考/工具分离。
- 工具调用下支持内联差异预览；最终差异区按“笔记文件”聚合，仅展示文件与增删统计。
- 一次答复结束后会自动刷新当前笔记页面，避免界面停留旧内容。
- 聊天区已移除“保存到笔记 / 编辑消息”按钮，统一通过工具调用写回笔记。

## Codex 图片工作流

- 目标：让 Codex 直接完成图片抓取、导入、截图、写入笔记，尽量不依赖手动操作。
- 推荐流程：
  - 从网页提取图片 URL：`siyuan_extract_page_images`
  - 批量导入外部图片：`siyuan_import_image_urls`
  - 网页截图后入库：`siyuan_capture_webpage_screenshot`
  - 将资源写入指定笔记：`siyuan_insert_images_to_note`
- 写入安全：MCP 默认可配置只读，若出现 “read-only 模式下不允许写入” 需先调整写权限配置。

## 右键提交上下文

- 支持在选中文本、块、文档树节点时，右键选择“提交给 Codex”。
- 内容会自动加入聊天输入区的引用上下文，减少手工复制粘贴。

## 开发

```bash
npm install
npm run dev
npm run build
```

构建产物目录：`dist/`

## 更新日志

<https://github.com/lk251066/siyuan-copilot-codex/blob/main/CHANGELOG.md>

## 许可证

GPL-3.0

## 致谢

- SiYuan 官方插件模板：<https://github.com/siyuan-note/plugin-sample-vite-svelte>
- sy-f-misc：<https://github.com/frostime/sy-f-misc>
- Cherry Studio：<https://github.com/CherryHQ/cherry-studio>
