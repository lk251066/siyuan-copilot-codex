# 2026-02-16 进度：剩余功能项收敛（MCP dry-run/定位插入 + Git dry-run + 可执行自检）

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 分支：`main`
- 基线提交：`6c295e73ec0d37e4cfb7fb019b11e257c50c8ee9`
- 目标：继续完成上一轮遗留功能项并补齐可执行验证。

## 本轮改动

### 1) MCP 图片工具：支持 `dryRun` 与 `anchorBlockId` 定位插入
- 文件：`mcp/siyuan-mcp/index.cjs`
- 核心改动：
  1. `insertAssetsToNote` 新增参数：
     - `dryRun`：仅返回预览，不执行写入
     - `anchorBlockId`：指定定位锚点
     - `mode` 扩展为 `append/prepend/after/before`（默认：有锚点时 `after`，否则 `append`）
  2. 新增校验：
     - `mode=after/before` 时必须提供 `anchorBlockId`
     - 锚点必须与目标文档同属一个文档
  3. `dryRun=true` 时返回 `operation.status=pending` 与预览信息，不调用写入 API。
  4. 四个图片工具 schema 同步升级：
     - `siyuan_import_image_urls`
     - `siyuan_extract_page_images`
     - `siyuan_capture_webpage_screenshot`
     - `siyuan_insert_images_to_note`

### 2) Git Auto Sync：新增 dry-run 模式
- 文件：`src/ai-sidebar.svelte`
- 核心改动：
  1. 新增 `gitAutoSyncDryRun` 配置（支持 UI 勾选与设置持久化）。
  2. 支持环境变量 `SIYUAN_CODEX_GIT_DRY_RUN=1`。
  3. `runGitAutoSync` 增加 dry-run 路径：
     - 保留只读检查（version/repo/status/upstream 等）
     - 对 `remote add / pull / add / commit / push` 仅打印预演命令，不实际执行
     - 日志明确标记 `[dry-run]`，结束提示“未执行写操作”。

### 3) 工具自检：从“列清单”升级为“可执行自检”
- 文件：`src/ai-sidebar.svelte`
- 核心改动：
  1. 保留 `tools/list` 清单。
  2. 新增只读可执行探测：
     - `siyuan_list_notebooks`
     - `siyuan_sql_query`（`select id from blocks limit 1`）
     - `siyuan_get_doc_tree`（当可获取 notebook 时）
  3. 自检结果新增：
     - 成功/失败数
     - 每项耗时（ms）
     - 每项结果摘要或错误信息

## 最小回归验证

### 验证 1：构建
```bash
npm run build
```
- 结果：通过（exit code 0）
- 关键输出：
  - `✓ 65 modules transformed.`
  - `dist/index.js 641.89 kB | gzip: 187.67 kB`

### 验证 2：MCP schema（可执行）
```bash
node mcp/siyuan-mcp/index.cjs
# 通过 JSON-RPC 调用 tools/list 验证图片工具 schema
```
- 结果：通过
- 关键输出（4 个图片工具一致）：
  - `mode=["append","prepend","after","before"]`
  - `anchorBlockId=true`
  - `dryRun=true`

## 风险与边界
1. `siyuan_import_image_urls` / `extract_page_images` / `capture_webpage_screenshot` 在 `dryRun=true` 且需要下载导入资源时，仍会有“资源导入”行为；`dryRun` 主要保证“不写入笔记块”。
2. 可执行自检采用只读样例调用，属于健康检查，不覆盖所有工具分支。

## 后续行动项
- [ ] 网页截图本地 fallback（外网截图服务不可用时自动降级）
- [ ] 针对 Git dry-run 补一条 UI 交互回归脚本（开关持久化 + 日志断言）
- [ ] 针对 MCP `after/before` 增加端到端回归样例
