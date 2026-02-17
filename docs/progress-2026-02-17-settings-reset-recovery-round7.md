# 2026-02-17 进度：重载后设置被清空问题定位与修复（第 7 轮）

## 问题现象
- 用户反馈：插件每次重载后，设置会被“清空”（尤其 Git 设置与插件个性设置）。

## 定位结论
1. 存在历史命名空间差异：
   - `siyuan-copilot-codex`
   - `siyuan-plugin-copilot`
2. 当前 `settings.json` 处于“接近默认值”状态时，缺少自动回填机制，导致历史有效配置（备份中的 Git/WebApp 等）无法恢复。
3. 设置面板 `runload()` 末尾存在“加载后立即 save”行为，会放大错误状态：一旦载入的是异常/降级配置，容易被再次固化。

## 本轮修复
1. **新增设置恢复机制（自动）**
   - 文件：`src/index.ts`
   - 新增逻辑：
     - 检测“疑似被重置”的配置状态；
     - 自动从可用来源恢复关键设置：当前命名空间备份、当前设置文件、历史命名空间设置/备份；
     - 采用“优先保留当前有值字段，空值由备份补齐”的合并策略；
     - 增加 `dataTransfer.settingsRecoveryApplied` 标记，避免重复恢复覆盖用户后续主动修改。

2. **移除设置面板加载后强制保存**
   - 文件：`src/SettingsPannel.svelte`
   - 删除 `runload()` 尾部 `await saveSettings()`，避免将异常载入状态立即回写磁盘。

3. **默认配置补充恢复标记字段**
   - 文件：`src/defaultSettings.ts`
   - 新增：`dataTransfer.settingsRecoveryApplied: 0`

4. **文案补充**
   - 文件：`i18n/zh_CN.json`、`i18n/en_US.json`
   - 新增：`migration.settingsRecovered`

5. **回归脚本增强**
   - 文件：`scripts/test_settings_default_merge_regression.mjs`
   - 校验项从 8 -> 11，新增：
     - recovery 标记字段存在
     - loadSettings 有恢复流程
     - settings 面板不再 onMount 强制保存

## 可执行验证结果

1) 设置回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (11 checks)`

2) 队列回归（防止副作用）
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
- 输出：
  - `dist/index.css 118.03 kB`
  - `dist/index.js 654.47 kB`

4) 部署覆盖
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 关键时间：`index.js/index.css = 2026-02-17 09:10`

5) 本地设置恢复结果（已落地）
- 目标文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`
- 关键字段恢复：
  - `codexGitCliPath = C:\Program Files\Git\cmd\git.exe`
  - `codexGitRepoDir = D:\SIYUAN\data`
  - `codexGitRemoteUrl = ../git-remotes/siyuan-notes.git`
  - `codexGitBranch = main`
  - `codexGitAutoSyncEnabled = true`
  - `webApps_len = 7`

