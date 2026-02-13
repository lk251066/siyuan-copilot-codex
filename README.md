# SiYuan Copilot Codex

> 个人自用，随缘更新。  
> 仓库地址：<https://github.com/lk251066/siyuan-plugin-copilot>  
> 致敬原项目：<https://github.com/Achuan-2/siyuan-plugin-copilot>

## 项目说明

- 仅保留 `Codex CLI` 工作流（`ask` / `agent`）。
- 模型列表读取本地 `~/.codex/config.toml`，不依赖第三方模型接口。
- 支持会话管理、引用上下文、附件上传、MCP 工具自检。
- 系统提示词可与当前工作目录 `AGENTS.md` 同步（仅当前工作目录，不是全局）。

## 安装

1. 在思源插件市场安装 `siyuan-copilot-codex`，或手动安装到 `data/plugins/siyuan-copilot-codex`。
2. 本机可执行 `codex` 命令。
3. 在插件设置中启用 `Codex CLI`，并配置工作目录（`--cd`）。

## 使用要点

- 聊天区顶部可切换模式、模型、思考长度。
- 点击“拉取模型”会从本地 Codex 配置读取模型列表。
- 点击“工具自检”可快速检查当前可用工具。

## 开发

```bash
npm install
npm run dev
npm run build
```

构建产物目录：`dist/`

## 更新日志

<https://github.com/lk251066/siyuan-plugin-copilot/blob/main/CHANGELOG.md>

## 许可证

GPL-3.0

## 致谢

- SiYuan 官方插件模板：<https://github.com/siyuan-note/plugin-sample-vite-svelte>
- sy-f-misc：<https://github.com/frostime/sy-f-misc>
- Cherry Studio：<https://github.com/CherryHQ/cherry-studio>
