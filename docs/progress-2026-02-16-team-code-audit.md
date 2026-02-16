# 2026-02-16 进度：`$team` 并行代码审查（优化项 + 可新增功能）

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 分支：`main`
- 提交：`c3be9b86f6397e950d996499a007b321aff237d2`
- 目标：审查当前插件代码，输出可落地优化项和可新增功能（含证据与最小验证方案）。

## 执行方式（Team 并行）
1. 启动：`omx team 3:executor "审查当前插件代码..."`
   - 输出：`Team started: 1-2-3`
   - `tmux target: codex:0`
2. 运行中状态：`omx team status 1-2-3`
   - 最终：`tasks: total=3 pending=0 in_progress=0 completed=3 failed=0`
3. ACK 证据：`.omx/state/team/1-2-3/mailbox/leader-fixed.json`
   - `worker-1/2/3` 均有 ACK 与最终结果消息。
4. 关闭：`omx team shutdown 1-2-3`
   - 输出：`Team shutdown complete: 1-2-3`
   - 后验：`No team state found for 1-2-3`

## 结论（按收益/复杂度）

### A. 优化项
1. **skills 提示词构建加缓存（高收益/中复杂）**
   - 状态：✅ 已完成（`a1053b7`）
   - 证据：
     - `src/ai-sidebar.svelte:4438-4444` 每次发送都调用 `buildWorkspaceSkillsPrompt`。
     - `src/codex/workspace-skills.ts:204-233` 使用 `readdirSync/readFileSync` 全盘扫描与读文件。
   - 最小验证：对同一工作目录连续发送 50 次，比较平均耗时；保证提示词文本一致。

2. **修复链接点击监听的生命周期与重复读配置（高收益/低复杂）**
   - 状态：✅ 已完成（`a1053b7`）
   - 证据：
     - `src/index.ts:2201` 注册匿名 `document.addEventListener('click', ...)`。
     - `src/index.ts:2217` 每次点击都 `await this.loadSettings()`。
     - `src/index.ts:2364-2368` `onunload` 未移除该监听。
   - 最小验证：插件重载 3 次后，点击一次链接只触发一次；无重复打开标签。

3. **合并 `loadSettings` 内多次写盘（高收益/中复杂）**
   - 状态：✅ 已完成（worker-1，2026-02-16）
   - 证据：`src/index.ts:2580/2600/2605/2613/2643/2722` 多处 `saveData`。
   - 最小验证：在加载设置路径增加计数日志，写盘次数下降且迁移逻辑保持正确。

4. **长会话渲染性能优化（中收益/中复杂）**
   - 状态：✅ 已完成（worker-2，2026-02-16）
   - 证据：
     - `src/ai-sidebar.svelte:12171-12216` 每次都全量 `groupMessages(messages)`。
     - `src/ai-sidebar.svelte:12840` 响应式全量重算。
     - `src/ai-sidebar.svelte:12947` 全量 `#each messageGroups` 渲染。
   - 最小验证：构造 1000+ 消息会话，比较输入延迟与滚动卡顿。

5. **构建告警清理（中收益/低复杂）**
   - 状态：✅ 已完成（worker-3，2026-02-16）
   - 证据（`npm run build`）：
     - 多次 `Sass legacy JS API is deprecated`。
     - `src/index.ts` 同时 named + default 导出告警。
   - 最小验证：构建日志不再出现上述告警，插件仍可加载。

### B. 可新增功能
1. **会话导出前自动读取完整消息（高收益/低复杂）**
   - 状态：✅ 已完成（`a1053b7`）
   - 证据：
     - `src/components/SessionManager.svelte:266-272` 直接从 `session.messages` 导出。
     - `src/ai-sidebar.svelte:8833-8844` 保存会话列表时会去掉 `messages`，仅留 metadata。
   - 最小验证：导出“未预先加载”的历史会话，导出文件应包含完整消息。

2. **图片相关 MCP 工具增加 `dryRun` 与定位插入（高收益/中复杂）**
   - 状态：✅ 已完成（2026-02-16）
   - 证据：
     - `mcp/siyuan-mcp/index.cjs:847-867` 仅 `append/prepend` 且写入 doc 根。
     - `mcp/siyuan-mcp/index.cjs:1711/1729/1748/1780` schema 只支持 `append|prepend`。
   - 最小验证：`dryRun=true` 时只返回预览不写入；`after+anchorBlockId` 可写到指定块后。

3. **网页截图增加本地 fallback（中收益/中复杂）**
   - 状态：✅ 已完成（2026-02-16）
   - 证据：`mcp/siyuan-mcp/index.cjs:1324-1329` 仅依赖远程截图服务。
   - 最小验证：禁用外网截图源时，仍可通过本地方案生成截图资源并插入笔记。

4. **Git Auto Sync 增加 dry-run（中收益/中复杂）**
   - 状态：✅ 已完成（2026-02-16）
   - 证据：`src/ai-sidebar.svelte:11189-11437` 直接执行 pull/add/commit/push。
   - 最小验证：dry-run 仅输出计划命令与文件清单，不产生写操作。

5. **工具自检从“列清单”升级为“可执行自检”（中收益/中复杂）**
   - 状态：✅ 已完成（2026-02-16）
   - 证据：`src/ai-sidebar.svelte:683-700` 当前仅 `tools/list` 并展示名字数量。
   - 最小验证：增加只读样例调用，输出每项耗时与成功率。

## 可执行验证结果
1. 构建验证
   - 命令：`npm run build`
   - 结果：通过（exit code 0）
   - 关键输出：`dist/index.js 641.89 kB`，构建通过。

2. MCP 图片工具 schema 验证
   - 命令：`node mcp/siyuan-mcp/index.cjs` + `tools/list`（JSON-RPC）
   - 结果：通过
   - 关键输出：4 个图片工具均包含：
     - `mode=["append","prepend","after","before"]`
     - `anchorBlockId=true`
     - `dryRun=true`

3. Team 生命周期验证
   - 启动：`Team started: 1-2-3`
   - 完成：`pending=0 in_progress=0 completed=3 failed=0`
   - 关闭：`Team shutdown complete: 1-2-3` + `No team state found`

## 后续行动项
- [x] 补回归：MCP `after/before` + `dryRun` 增加端到端样例（`npm run test:mcp-fallback`）
- [ ] 补回归：Git Auto Sync dry-run UI 行为（开关持久化 + 日志断言）

## 状态更新（2026-02-16，worker-3，C 项）
### 本轮完成项
1. `vite.config.ts` 增加：
   - `css.preprocessorOptions.scss.silenceDeprecations = ["legacy-js-api"]`
   - `build.rollupOptions.output.exports = "named"`
2. 清理未使用导入：移除 `loadEnv`。

### 最小回归与可执行结果
- 命令：`npm run build > /tmp/task3-build.log 2>&1`
- 结果：通过（exit code 0）
- 关键输出：
  - `legacy_js_api_count=0`
  - `mixed_exports_warning_count=0`
  - `✓ built in 11.01s`

### 边界与下一步
- 当前是“在现有工具链上消除构建告警输出”，不是从根源替换掉上游 legacy API 调用路径。
- 下一步建议：在不影响插件构建产物前提下，评估升级 Vite/Svelte/Sass 组合以彻底移除对 legacy API 的依赖。
