# 2026-02-16 进度：Queue UI 可见提示与功能确认（第 3 轮）

## 背景
- 用户反馈：仍看不到 queue 功能，怀疑 UI 没有提示、功能未正确加上。
- 目标：补充明显 UI 提示，并确认“运行中发送=入队”链路真实生效。

## 本轮改动
1. **新增可见的 Queue 提示文案（运行中）**
   - 文件：`src/ai-sidebar.svelte`
   - 在输入框下新增提示区（`ai-sidebar__queue-hint`）：
     - 有草稿时：提示“点击发送将加入队列，不中断当前任务”
     - 无草稿时：提示“先输入再发送可入队；空输入发送是停止当前任务”

2. **新增 Queue 提示样式**
   - 文件：`src/ai-sidebar.svelte`（样式区）
   - 新增 `ai-sidebar__queue-hint` 样式（灰底虚线框，12px 文案）。

3. **i18n 文案补齐**
   - 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
   - 新增：
     - `aiSidebar.codex.queue.readyHint`
     - `aiSidebar.codex.queue.emptyHint`

4. **回归脚本补充 UI 提示检查**
   - 文件：`scripts/test_codex_send_queue_regression.mjs`
   - 新增断言：运行中 Queue 提示块和对应 i18n key 在源码中存在。

## 可执行验证结果

1) Queue 回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (9 checks)`

2) 默认配置合并回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (7 checks)`

3) 构建验证
```bash
npm run build
```
- 结果：通过
- 输出：
  - `✓ 65 modules transformed.`
  - `dist/index.css  115.49 kB`
  - `dist/index.js   645.82 kB`

4) 部署同步
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 输出：安装目录时间戳已更新到 `2026-02-16 22:33`

5) 安装产物关键标记校验
```bash
python3 - <<'PY'
import pathlib
p=pathlib.Path('/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/index.js')
t=p.read_text(encoding='utf-8',errors='ignore')
print('queue_ready_hint_key', 'aiSidebar.codex.queue.readyHint' in t)
print('queue_empty_hint_key', 'aiSidebar.codex.queue.emptyHint' in t)
print('queue_hint_class', 'ai-sidebar__queue-hint' in t)
print('queue_branch_loading_enqueue', 'if(f){_l();return}' in t or 'if(f){po();return}' in t)
print('queue_toast', 'aiSidebar.codex.queue.enqueued' in t)
PY
```
- 结果：通过
- 输出：
  - `queue_ready_hint_key True`
  - `queue_empty_hint_key True`
  - `queue_hint_class True`
  - `queue_branch_loading_enqueue True`
  - `queue_toast True`

## 结论
- 现在 UI 上已经有明确 queue 提示，不再只靠按钮图标/tooltip 隐式表达。
- 功能链路确认存在：运行中且有草稿时，发送走入队分支；入队后有提示文案和队列数徽标。
