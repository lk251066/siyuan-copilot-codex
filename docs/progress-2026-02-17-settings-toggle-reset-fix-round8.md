# 2026-02-17 进度：插件开关后设置重置问题二次修复（第 8 轮）

## 用户反馈
- 现象：设置“看起来没保存”，插件开关后又恢复为空。

## 二次定位结论（本轮）
1. **现场证据确认确实发生“重置态写回”**
   - 文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
   - 本轮检查到该文件在 `2026-02-17 09:13` 被写成重置态（Git 字段为空、`webApps_len=0`）。
2. **保存触发点不稳定会放大问题**
   - 多处输入框使用 `on:change`，若用户输入后未失焦就关闭面板/插件，可能不触发保存。
   - 一旦有“重置态对象”被保存，就会覆盖到磁盘。
3. **需要双保险**
   - 保险 A：输入时自动保存（避免仅靠 blur/change）；
   - 保险 B：保存时识别“疑似重置写入”，自动保留已有关键设置。

## 本轮修复

### 1) 保存层防重置写入（核心）
- 文件：`src/index.ts`
- 改动：`saveSettings()` 新增防护：
  - 当 incoming 呈现“重置态”且磁盘已有有效配置时，走“有值优先”合并，避免空值覆盖。
  - 命中防护时写提示：`migration.settingsGuarded`。

### 2) 恢复逻辑增强
- 文件：`src/index.ts`
- 改动：
  - `recoverResetSettingsIfNeeded()` 在再次出现重置态时允许再次恢复（不被历史恢复标记阻断）。

### 3) 设置页输入改为“输入即自动保存（防抖）”
- 文件：`src/SettingsPannel.svelte`
- 改动：
  - 增加 `setSettingDebounced()`；
  - 将 Codex/Git 关键文本项改为 `on:input` + 防抖保存：
    - `codexCliPath`
    - `codexWorkingDir`
    - `codexGitCliPath`
    - `codexGitRepoDir`
    - `codexGitRemoteName`
    - `codexGitRemoteUrl`
    - `codexGitBranch`
    - `codexGitAutoCommitMessage`

### 4) Git 同步弹窗文本项改为输入即保存（防抖）
- 文件：`src/ai-sidebar.svelte`
- 改动：
  - 新增 `scheduleGitSettingsPatchSave()`；
  - Repo/Remote/Branch 改为 `on:input`，减少“未失焦不保存”问题。

### 5) i18n 与回归脚本更新
- 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
  - 新增：`migration.settingsGuarded`
- 文件：`scripts/test_settings_default_merge_regression.mjs`
  - 校验项增加到 13 项，新增：
    - 保存层防重置写入逻辑存在
    - 设置页防抖自动保存逻辑存在

## 最小回归验证

1) 设置回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (13 checks)`

2) 队列回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (14 checks)`

3) 构建
```bash
npm run build
```
- 结果：通过
- 输出：`dist/index.js 655.20 kB`

4) 覆盖部署
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 安装目录时间：`2026-02-17 09:21`

## 本地设置恢复结果（已执行）
- 文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
- 当前关键字段：
  - `codexGitCliPath = C:\Program Files\Git\cmd\git.exe`
  - `codexGitRepoDir = D:\SIYUAN\data`
  - `codexGitRemoteUrl = ../git-remotes/siyuan-notes.git`
  - `codexGitBranch = main`
  - `codexGitAutoSyncEnabled = true`
  - `webApps_len = 7`
