# 2026-02-16 进度：Siyuan Codex 发送队列功能

## 背景
- 用户目标：在 **Siyuan 插件** 中支持 Codex 发送队列。
- 期望行为：当 Codex 正在运行时再次发送，不要直接中断，改为排队；确需中断时仍可手动停止。

## 本轮改动

### 1) 运行中再次发送 => 入队
- 文件：`src/ai-sidebar.svelte`
- 新增：`QueuedCodexSendDraft`、`queuedCodexSendDrafts`、`processQueuedCodexSends`
- 行为：
  - 运行中且有新输入（文本/附件）时，点击发送或快捷键会把消息放入队列。
  - 当前轮结束后自动取下一条继续发送。

### 2) queue / interrupt 语义分离
- 文件：`src/ai-sidebar.svelte`
- 新增：`shouldQueueCurrentDraft()`、`handleSendButtonClick()`
- 规则：
  - **有草稿 + 正在运行**：走 queue（入队）。
  - **无草稿 + 正在运行**：走 interrupt（停止当前运行）。

### 3) UI 反馈增强
- 文件：`src/ai-sidebar.svelte`
- 改动：
  - 发送按钮在 queue 场景显示“加号”图标。
  - 显示队列数量徽标。
  - tooltip/aria 在 queue 场景显示“加入队列”。
  - queue 场景不再套用停止态红色样式。

### 4) i18n 文案
- 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
- 新增：
  - `aiSidebar.actions.queue`
  - `aiSidebar.codex.queue.enqueued`

### 5) 最小回归脚本
- 文件：`scripts/test_codex_send_queue_regression.mjs`
- package 脚本：`test:codex-queue`
- 断言点：
  - 入队/出队函数存在
  - 运行中发送会进入队列分支
  - Codex 发送完成后触发队列消费
  - 按钮走统一发送/中断分发逻辑

### 6) 热修复：避免“未启用 Codex”误判
- 文件：`src/ai-sidebar.svelte`
- 场景：用户点击发送时，若本地 `settings` 尚未就绪，可能误提示“请先启用 Codex”。
- 修复：发送前若发现 `codexEnabled !== true`，先调用 `plugin.loadSettings()` 回拉一次设置再判断。
- 结果：减少初始化时机导致的误报，不影响正常关闭 Codex 的显式提示。

### 7) 热修复：queue 触发不再依赖 settings 实时值
- 文件：`src/ai-sidebar.svelte`
- 场景：运行中点击发送时，若 `settings.codexEnabled` 短暂为 false，按钮会误走“停止”而不是“加入队列”。
- 修复：
  - queue 按钮判定改为仅依赖运行态 + 有草稿 + 非等待选择状态；
  - `sendMessage` 在 `isLoading` 分支优先入队，不再先看 `codexEnabled`。
- 结果：即使 settings 短暂抖动，运行中再次发送仍稳定入队。

### 8) 本轮修复：queue UI 判定进一步收敛（消除等待状态误拦截）
- 文件：`src/ai-sidebar.svelte`
- 问题：`isWaitingForAnswerSelection` 在个别状态下会误拦截 queue 按钮，导致运行中显示“停止”而不是“加入队列”。
- 修复：
  - `shouldQueueCurrentDraft()` 改为仅依赖 `isLoading + 有草稿`；
  - `sendMessage()` 在 `isLoading` 分支统一先入队，不再受等待状态影响。
- 结果：只要运行中且输入区有内容，发送动作就稳定进入 queue。

### 9) 本轮修复：默认配置加载补强（统一深合并）
- 文件：
  - `src/defaultSettings.ts`
  - `src/index.ts`
  - `src/SettingsPannel.svelte`
  - `src/ai-sidebar.svelte`
- 问题：旧逻辑多处使用浅合并（`{...default, ...loaded}`），嵌套配置（如 `aiProviders`、`dataTransfer`）在旧配置场景会丢默认字段，导致“默认配置加载异常”。
- 修复：
  - 新增 `mergeSettingsWithDefaults()`，对关键嵌套字段做统一归一化；
  - `loadSettings`、`syncSystemPromptFromWorkingDirAgentsFile`、设置面板加载、侧栏初始化/订阅统一改为该方法。
- 结果：默认配置回填一致，旧配置升级时不再因嵌套字段缺失导致行为漂移。

### 10) 新增回归：默认配置合并
- 文件：`scripts/test_settings_default_merge_regression.mjs`
- `package.json` 新增：`test:settings-merge`
- 断言点：
  - 合并函数存在；
  - `index.ts`/`SettingsPannel.svelte`/`ai-sidebar.svelte` 均使用统一合并入口；
  - 避免回退到浅合并路径。

## 可执行验证结果

1) 队列回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 关键输出：`[queue-regression] OK (8 checks)`

2) 默认配置合并回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 关键输出：`[settings-merge-regression] OK (5 checks)`

3) 构建验证
```bash
npm run build
```
- 结果：通过
- 关键输出：
  - `✓ 65 modules transformed.`
  - `dist/index.js 643.59 kB │ gzip: 188.64 kB`

4) 关键既有回归（防止连带影响）
```bash
npm run test:git-dryrun
npm run test:mcp-fallback
```
- 结果：均通过
- 关键输出：
  - `Git Auto Sync dry-run regression: PASS`
  - `MCP fallback regression: PASS`

5) 部署目录同步校验
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
python3 - <<'PY'
import pathlib,re
p=pathlib.Path('/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/index.js')
t=p.read_text(encoding='utf-8',errors='ignore')
m=re.search(r'async function xi\\(\\)\\{.{0,220}',t)
s=m.group(0) if m else ''
print('snippet_has_loading_enqueue:', 'if(f){po();return}' in s)
print('snippet_has_waiting_gate_enqueue:', 'Nn||po()' in s)
print('has_queue_toast:', 'aiSidebar.codex.queue.enqueued' in t)
PY
```
- 结果：通过
- 关键输出：
  - 安装目录 `index.js` 与 `dist/index.js` 时间戳一致（`2026-02-16 20:07`）
  - `snippet_has_loading_enqueue: True`
  - `snippet_has_waiting_gate_enqueue: False`
  - `has_queue_toast: True`

## 备注
- 已按用户要求将本机全局 `oh-my-codex` 重新安装到发布版，撤销本轮对全局安装目录的临时改动。
