# 2026-02-17 进度：按 git 历史复查 settings 重置根因（第 9 轮）

## 用户反馈
- 仍存在“插件开关后配置重置”的问题。
- 要求：回看之前实现，并结合 git 记录定位。

## 团队执行（$team）证据
- Team started: `team-task`
- tmux target: `codex:0`
- worker panes: `%169`, `%170`
- leader mailbox: `.omx/state/team/team-task/mailbox/leader-fixed.json`（含 ACK）
- 最终状态：`pending=0 in_progress=0 completed=2 failed=0`
- shutdown：`Team shutdown complete: team-task`

## git 记录复查结论
重点提交：
- `b0a02d6`（codex-only/persist settings）
- `6397120`（移除设置面板加载后强制保存 + 恢复机制）
- `77e52d5`（保存防重置写入 + 输入防抖自动保存）

复查后结论：
1. 重置问题不是单一“某个字段默认值”导致，而是**保存链路中可能出现“重置态对象写入”**；
2. 当写入对象带空字段时，旧逻辑会覆盖已有磁盘配置；
3. 若当下磁盘也已被写成重置态，则仅靠“persisted 合并”不足，需要再走备份恢复。

## 本轮新增修复
1. **saveSettings 再加一层备份恢复**
   - 文件：`src/index.ts`
   - 改动：`saveSettings()` 在最终 merge 前调用 `recoverResetSettingsIfNeeded(baseSettings)`。
   - 作用：即便当前磁盘已是重置态，保存时仍可从备份自动回填关键配置。

2. **回归脚本补充**
   - 文件：`scripts/test_settings_default_merge_regression.mjs`
   - 新增检查：saveSettings 中包含“保存前恢复”逻辑。

## 最小回归验证
1) 设置回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (14 checks)`

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
- 输出：`dist/index.js 655.38 kB`

4) 部署
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 部署时间：`2026-02-17 09:30`
