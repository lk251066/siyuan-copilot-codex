# SiYuan Copilot（Codex 版）

> 面向 Codex CLI 的独立插件分支。  
> 目标：在思源笔记中稳定使用 Codex CLI，不再维护多模型并行、小程序、翻译等旧入口。
> 当前仓库：`https://github.com/lk251066/siyuan-plugin-copilot`（仓库重命名后请同步更新 `plugin.json.url`）。

## 项目定位

- 仅保留 Codex 工作流，界面和设置都围绕 Codex 使用场景简化。
- 系统提示词可与工作目录下 `AGENTS.md` 同步，方便按项目管理规则。
- 使用“平台管理 -> OpenAI”的 API Key 拉取 Codex 模型列表。
- 保留会话管理、拖拽上下文、附件上传、工具自检等高频能力。

## 当前主要功能

- Codex 聊天：`ask`、`agent` 两种模式。
- 会话能力：自动生成标题、手动重命名、历史会话管理。
- 思考展示优化：默认更紧凑，支持展开查看，修复字面量 `\\n` 的换行显示。
- 模型选择优化：设置页和聊天栏均为下拉框，不再使用搜索输入。
- MCP 工具自检：可直接查看当前挂载工具，便于排查连通性。
- 系统提示词文件同步：与 `codexWorkingDir/AGENTS.md` 双向同步（仅当前工作目录）。

## 快速开始

### 1. 前置条件

- 已安装思源笔记。
- 已安装 Codex CLI，并可在终端执行 `codex`。
- 已在插件“平台管理 -> OpenAI”填写可用 API Key。

### 2. 安装插件

- 方式一：在思源插件市场安装（若已发布该分支版本）。
- 方式二：手动安装：将构建产物放入 `data/plugins/siyuan-copilot-codex`。

### 3. 推荐配置

在插件设置的 `Codex CLI` 分组中：

- `启用 Codex CLI`：开启。
- `Codex 路径`：填写 `codex` 或绝对路径（可点“自动探测”）。
- `工作目录（--cd）`：设为你的实际项目目录。
- `执行权限`：建议先用 `read_only`，确认稳定后再改更高权限。
- `模型覆盖（可选）`：可留空；需要固定模型时再选择。
- `系统提示词`：建议开启与 `AGENTS.md` 同步。

### 4. 聊天区使用

- 顶部可直接切换聊天模式和模型。
- 右上有“拉取模型”“工具自检”“设置”入口。
- 发送按钮在右下角；生成中会自动切换为“终止”状态。

## MCP 与工具自检

工具自检用于快速确认插件内 MCP 是否可调用。

- 点击聊天区顶部“工具自检”。
- 成功时会返回当前工具清单。
若失败，优先检查：
- `Codex 路径` 是否正确。
- 插件目录下 `mcp/siyuan-mcp/index.cjs` 是否存在。
- 工作目录和权限模式是否与当前任务匹配。

## 常见问题

### 模型列表为空或拉取失败

- 确认已在“平台管理 -> OpenAI”填写 API Key。
- 模型列表接口为 `https://www.right.codes/codex/v1/models`。
- 网络异常时可稍后重试“拉取模型”。

### 聊天区显示异常（空白过多、思考换行不正确）

- 已在本分支做过对应修复。
- 如未生效，请重载插件并确认插件目录已更新为最新构建产物。

### Codex 无法调用工具

- 先跑一次“工具自检”。
- 再检查工作目录是否有访问权限，以及执行权限模式是否过低。

## 开发与打包

```bash
npm install
npm run dev
npm run build
```

构建产物在 `dist/`，可直接覆盖到思源插件目录。

## 更新日志

- 详细版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

- GPL-3.0

## 致谢

- [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte)
- [sy-f-misc](https://github.com/frostime/sy-f-misc)
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio)
