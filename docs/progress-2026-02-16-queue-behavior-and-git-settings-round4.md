# 2026-02-16 进度：发送队列行为修正 + Git 设置落地（第 4 轮）

## 背景
- 用户反馈：发送队列仍异常；要求把插件 Git 设置配好。

## 本轮改动
1. **发送按钮行为修正（避免误中断）**
   - 文件：`src/ai-sidebar.svelte`
   - 调整：
     - 运行中点击发送时，不再走“无草稿即中断”逻辑；
     - 无草稿时给提示，不中断；
     - 有草稿时才入队。

2. **停止操作从“发送按钮”分离**
   - 文件：`src/ai-sidebar.svelte`
   - 新增运行中提示区右侧“暂停按钮”（显式停止当前任务）。
   - 发送按钮在运行中仅保留 queue 语义。

3. **运行中按钮禁用规则调整**
   - 文件：`src/ai-sidebar.svelte`
   - 运行中无草稿时发送按钮禁用，避免误触造成语义混淆。

4. **i18n 文案更新**
   - 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
   - 更新 `aiSidebar.codex.queue.emptyHint`，明确“停止请点暂停按钮”。

5. **Queue 回归脚本更新**
   - 文件：`scripts/test_codex_send_queue_regression.mjs`
   - 新增断言：
     - 运行中提示区存在；
     - 停止按钮存在；
     - 运行中无草稿发送按钮禁用条件存在。

6. **Git 设置落地**
   - 文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
   - 已设置（来自你历史有效配置）：
     - `codexGitCliPath = C:\\Program Files\\Git\\cmd\\git.exe`
     - `codexGitRepoDir = D:\\SIYUAN\\data`
     - `codexGitRemoteName = origin`
     - `codexGitRemoteUrl = ../git-remotes/siyuan-notes.git`
     - `codexGitBranch = main`
     - `codexGitSyncScope = notes`
     - `codexGitAutoSyncEnabled = true`
     - `codexGitAutoCommitMessage = chore(notes): sync {ts}`

## 可执行验证结果

1) Queue 回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (10 checks)`

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
  - `dist/index.css  115.82 kB`
  - `dist/index.js   646.19 kB`

4) 部署同步
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 输出：安装目录 `index.js` 时间 `2026-02-16 22:46`

5) 安装包关键标记校验
```bash
python3 - <<'PY'
import pathlib
t=pathlib.Path('/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/index.js').read_text(encoding='utf-8',errors='ignore')
print('queue_hint_class', 'ai-sidebar__queue-hint' in t)
print('queue_stop_btn_class', 'ai-sidebar__queue-stop-btn' in t)
print('queue_ready_hint_key', 'aiSidebar.codex.queue.readyHint' in t)
print('queue_empty_hint_key', 'aiSidebar.codex.queue.emptyHint' in t)
PY
```
- 结果：通过
- 输出：
  - `queue_hint_class True`
  - `queue_stop_btn_class True`
  - `queue_ready_hint_key True`
  - `queue_empty_hint_key True`
