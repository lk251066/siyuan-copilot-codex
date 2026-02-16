# 2026-02-16 进度：队列取消行为（Cursor 风格）收口修复（第 5 轮）

## 背景
- 用户反馈：发送队列体验差，尤其“取消发送后队列仍保留”。
- 目标：对齐 Cursor 风格——发送与停止分离，停止时清空队列，避免残留任务继续执行。

## 本轮完成
1. **取消发送即清空队列（已生效）**
   - 文件：`src/ai-sidebar.svelte`
   - 关键点：`abortMessage()` 首行调用 `clearQueuedCodexSendDrafts(true)`。

2. **运行中发送按钮只做 Queue，不再兼任停止（已生效）**
   - 文件：`src/ai-sidebar.svelte`
   - 关键点：
     - `isLoading` 且有草稿：点击发送 => 入队。
     - `isLoading` 且无草稿：发送按钮禁用并给提示。
     - 停止动作走提示条右侧独立暂停按钮（`ai-sidebar__queue-stop-btn`）。

3. **提示文案统一**
   - 文件：`src/ai-sidebar.svelte`
   - 将 fallback 提示统一为“若要停止请点右侧暂停按钮”，避免“下方停止按钮”造成误导。

4. **插件目录已重新打包并覆盖同步**
   - 目标目录：`/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/`
   - 最新时间：`2026-02-16 22:55`

## 最小回归验证

1) 发送队列回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 关键输出：`[queue-regression] OK (12 checks)`

2) 设置合并回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 关键输出：`[settings-merge-regression] OK (8 checks)`

3) 构建验证
```bash
npm run build
```
- 结果：通过
- 关键输出：
  - `dist/index.css  115.82 kB`
  - `dist/index.js   646.44 kB`

4) 部署同步验证
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
ls -l /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/index.js
```
- 结果：通过
- 关键输出：`index.js` 时间为 `Feb 16 22:55`

## 用户侧复测建议（1 分钟）
1. 发起一条长任务；
2. 在运行中输入第二条并点发送（应显示入队）；
3. 点击提示条右侧暂停按钮；
4. 预期：当前任务停止 + 队列被清空，不再自动发送后续排队草稿。
