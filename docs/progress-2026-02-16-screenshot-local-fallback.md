# 2026-02-16 进度：网页截图本地 fallback（MCP）

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 分支：`main`
- 基线提交：`795bd18`
- 目标：当远程截图服务不可用时，`siyuan_capture_webpage_screenshot` 自动回退到本地截图方案，避免直接失败。

## 改动内容
- 文件：`mcp/siyuan-mcp/index.cjs`

### 1) 新增本地截图 fallback 开关与参数
- `SIYUAN_MCP_LOCAL_SCREENSHOT_FALLBACK`（默认开启）
- `SIYUAN_MCP_LOCAL_SCREENSHOT_TIMEOUT_MS`
- `SIYUAN_MCP_LOCAL_SCREENSHOT_HEIGHT`
- `SIYUAN_MCP_CHROME_BIN`（可显式指定本地浏览器路径）

### 2) 新增本地截图执行链路
- 远程截图失败后，依次尝试本地命令：
  - Chromium/Chrome/Edge headless
  - `wkhtmltoimage`
  - `npx playwright screenshot`
- 成功后读取本地 PNG 并上传到思源资源，返回 `assetPath`。
- 返回字段新增：
  - `localFallbackUsed`
  - `warnings`（远程失败与本地尝试失败摘要）

### 3) schema 描述补充
- `siyuan_capture_webpage_screenshot` 描述中明确“远程失败会自动尝试本地 fallback”。

## 最小回归验证

### 验证 1：语法检查
```bash
node --check mcp/siyuan-mcp/index.cjs
```
- 结果：通过（exit code 0）

### 验证 2：构建
```bash
npm run build
```
- 结果：通过（exit code 0）
- 关键输出：`✓ 65 modules transformed`，`dist/index.js 641.89 kB`

### 验证 3：tools/list 元数据
```bash
node mcp/siyuan-mcp/index.cjs
# JSON-RPC 调用 tools/list
```
- 结果：通过
- 关键输出：截图工具描述包含 `fallback`，并保留
  - `mode=["append","prepend","after","before"]`
  - `anchorBlockId=true`
  - `dryRun=true`

### 验证 4：自动化回归脚本（远程失败 -> 本地 fallback）
```bash
npm run test:mcp-fallback
```
- 结果：通过（exit code 0）
- 关键输出：
  - `MCP fallback regression: PASS`
  - `uploadCount=1`
  - `captureProvider=local:.../fake-chrome.js`

## 风险与边界
- 本地 fallback 依赖系统可用命令（浏览器/wkhtmltoimage/playwright），若都不可用会汇总失败原因并返回错误。
- 在受限环境中（无 GUI/无可执行浏览器）可能依然失败，但失败信息会比之前更明确。

## 后续行动项
- [ ] 在 CI 环境补一条“有真实浏览器时”的截图 fallback 回归，替换当前 fake chrome 脚本场景。
