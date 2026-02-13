# SiYuan Copilot Codex

> 个人自用，随缘更新。  
> 仓库地址：<https://github.com/lk251066/siyuan-copilot-codex>  
> 致敬原项目：<https://github.com/Achuan-2/siyuan-plugin-copilot>

## 项目说明

- 仅保留 `Codex CLI` 工作流（`ask` / `agent`）。
- 模型列表读取本地 `~/.codex/config.toml`，不依赖第三方模型接口。
- 支持会话管理、引用上下文、附件上传、MCP 工具自检。
- 系统提示词可与当前工作目录 `AGENTS.md` 同步（仅当前工作目录，不是全局）。
- 新增 Codex 图片工作流：可通过 MCP 工具完成“抓取网页图片 / 导入图片 URL / 网页截图 / 写入笔记”。

## 与原项目功能差异

对比原项目 <https://github.com/Achuan-2/siyuan-plugin-copilot>，本项目主要差异如下：

- 引擎策略：仅保留 Codex CLI，不再作为多平台 AI 聚合入口使用。
- 模型来源：模型列表来自本地 `~/.codex/config.toml`，不再依赖外部模型列表接口。
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

## 最新改动映射（2026-02-13）

- 时间线按真实顺序展示：`思考 -> 搜索 -> 工具调用 -> Diff`，并支持展开/收起。
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
