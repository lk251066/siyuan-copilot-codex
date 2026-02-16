# 2026-02-16 进度：发送队列可视化与管理能力（第 6 轮）

## 背景
- 用户要求“继续添加功能”。
- 结合前面队列反馈，本轮补充“可见可管”的队列能力，减少误操作和残留困惑。

## 本轮新增功能
1. **队列面板（可视化）**
   - 文件：`src/ai-sidebar.svelte`
   - 行为：当队列中有待发送草稿时，输入框下方显示“发送队列（N）”面板。
   - 展示：每条队列消息显示顺序号、文本预览、附件/上下文数量。

2. **队列管理操作**
   - 文件：`src/ai-sidebar.svelte`
   - 新增：
     - 一键清空队列（面板右上按钮）
     - 单条移除队列项（每条右侧关闭按钮）
   - 保留：取消当前任务（暂停按钮）仍会清空队列。

3. **文案与国际化补充**
   - 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
   - 新增 key：
     - `aiSidebar.codex.queue.panelTitle`
     - `aiSidebar.codex.queue.clearAll`
     - `aiSidebar.codex.queue.removeItem`
     - `aiSidebar.codex.queue.removed`
     - `aiSidebar.codex.queue.nonTextDraft`
     - `aiSidebar.codex.queue.attachmentsMeta`
     - `aiSidebar.codex.queue.contextDocsMeta`

4. **回归脚本增强**
   - 文件：`scripts/test_codex_send_queue_regression.mjs`
   - 校验数从 12 -> 14，新增检查：
     - 单条移除 helper 存在
     - 队列面板具备“清空/移除”操作入口

## 最小回归验证

1) Queue 回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (14 checks)`

2) 设置合并回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (8 checks)`

3) 构建
```bash
npm run build
```
- 结果：通过
- 输出：
  - `dist/index.css  118.03 kB`
  - `dist/index.js   650.66 kB`

4) 插件目录覆盖
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 关键时间：`index.js/index.css = 2026-02-16 23:02`

5) 安装包关键标记检查
```bash
python3 - <<'PY'
import pathlib
p=pathlib.Path('/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/index.js')
t=p.read_text(encoding='utf-8',errors='ignore')
for s in ['ai-sidebar__queue-panel','ai-sidebar__queue-clear-btn','ai-sidebar__queue-remove-btn']:
 print(s, s in t)
PY
```
- 结果：通过
