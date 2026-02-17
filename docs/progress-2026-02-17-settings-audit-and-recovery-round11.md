# 2026-02-17 进度：设置重置三次复发加固（第 11 轮）

## 现象
- 用户反馈：关闭/打开插件后配置依然被清空。

## 本轮结论
- 仅靠“最新备份恢复”与“一次性恢复”不够，必须：
  1) 保存时也做恢复兜底；
  2) 记录每次 save/load 的审计信息，定位是谁写入了重置态。

## 本轮改动
1. **新增 settings 写入审计日志**
   - 文件：`src/index.ts`
   - 新增：`settings-write-audit.ndjson`
   - 记录事件：
     - `load_settings`
     - `load_settings_saved`
     - `save_settings_prepare`
     - `save_settings_committed`
   - 路径：`/data/storage/petal/siyuan-copilot-codex/settings-write-audit.ndjson`

2. **saveSettings 再次兜底恢复（保存前）**
   - 文件：`src/index.ts`
   - 在 save 路径中增加：`recoverResetSettingsIfNeeded(baseSettings)`。
   - 作用：即使当前磁盘已被写成重置态，保存时仍可从备份回填关键字段。

3. **回归脚本增强**
   - 文件：`scripts/test_settings_default_merge_regression.mjs`
   - 校验项提升到 15 项，新增：审计钩子存在检查。

4. **本地设置再恢复**
   - 文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
   - 已从有效备份回填 Git/WebApps。

## 最小回归验证

1) 设置回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (15 checks)`

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
- 输出：`dist/index.js 657.39 kB`

4) 部署
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 安装目录时间：`2026-02-17 10:36`

## 复现追踪说明
- 若仍复发，直接读取：
  - `/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings-write-audit.ndjson`
- 可精确看到是哪次 load/save 把配置写成重置态。
