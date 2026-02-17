# 2026-02-17 进度：settings 备份选择策略热修（第 10 轮）

## 新发现问题
- 复核时发现：`settings.json` 仍会回到重置态。
- 根因补充：恢复逻辑此前只读取“最新一份备份文件”；若最新备份恰好是无效/空值快照，会导致恢复失效。

## 本轮修复
1. **恢复逻辑改为遍历全部备份（按时间倒序）**
   - 文件：`src/index.ts`
   - 改动：
     - `readLatestSettingsBackup` -> `readSettingsBackups`
     - 在 `recoverResetSettingsIfNeeded` 中遍历所有备份候选，而非只用最新一份。

2. **回归脚本补充**
   - 文件：`scripts/test_settings_default_merge_regression.mjs`
   - 新增检查：存在 `const backups = this.readSettingsBackups(namespace);`。

3. **本地设置再次恢复**
   - 文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
   - 从历史有效备份回填 Git/WebApps 关键字段。

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
- 时间：`2026-02-17 09:36`
