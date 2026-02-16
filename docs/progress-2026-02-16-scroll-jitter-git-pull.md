# 2026-02-16 进度：滚动抽搐修复 + `git pull --rebase` 报错处理

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 远端：
  - `origin`: https://github.com/Achuan-2/siyuan-plugin-copilot.git
  - `fork`: https://github.com/lk251066/siyuan-copilot-codex.git
- 分支：`main`
- 基线提交：`848a2eb`

## 本次改动
### 1) 滚动抽搐（顶部滑到底部时）
- 文件：`src/ai-sidebar.svelte`
- 调整点：`.ai-sidebar__scroll-to-bottom` 使用 `position: absolute`（并固定 `left: 0; right: 0;`），避免按钮显隐参与正常文档流导致滚动高度抖动。

### 2) `git pull --rebase` 报错
- 复现命令：`git pull --rebase`
- 结果：`cannot pull with rebase: You have unstaged changes`
- 根因：工作区存在未暂存/未提交修改，rebase 前置检查不通过。
- 插件修复：Git Sync 在 rebase pull 时默认追加 `--autostash`（含 Auto Sync 路径），并在设置中新增“Pull 自动暂存本地改动”开关（默认开启）。

## 可执行处理路径
1. **stash 路径（推荐）**
   ```bash
   git stash push -u -m "WIP before pull"
   git pull --rebase
   git stash pop
   ```

2. **commit 路径**
   ```bash
   git add -A
   git commit -m "chore: save local changes before pull"
   git pull --rebase
   ```

3. **丢弃路径（高风险）**
   ```bash
   git reset --hard
   git clean -fd
   git pull --rebase
   ```

## 最小回归验证与结果
1. 构建验证
   - 命令：`npm run build`
   - 结果：通过（`vite build` 成功，exit code 0）

2. Git 报错复现与修复验证
   - 命令：`git pull --rebase`
   - 结果：复现报错（exit code 128）
   - 命令：`git pull --rebase --autostash`
   - 结果：成功（自动暂存并恢复改动）

3. 打包覆盖插件目录
   - 命令：`npm run make-install`
   - 结果：通过，已自动复制到 `/mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex`
