# 2026-02-16 进度：设置恢复与防止“字段被清空”修复

## 背景
- 用户反馈：插件覆盖后，插件设置和 Git 设置被清空。
- 目标：定位清空原因、恢复用户设置、增加防护避免再次发生。

## 定位结果
在 `siyuan-copilot-codex` 配置目录发现：
- 当前文件：`/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json`（字段已被回落为空值）
- 历史备份：`settings.json.bak-20260216-093354`（包含完整 Git 配置与 WebApp 配置）

对比确认丢失项（示例）：
- `codexGitRepoDir`
- `codexGitRemoteUrl`
- `codexGitBranch`
- `codexGitAutoSyncEnabled`
- `codexGitAutoCommitMessage`
- `webApps`

## 本轮修复
1. **恢复用户设置（已执行）**
   - 从 `settings.json.bak-20260216-093354` 向当前 `settings.json` 回填“当前为空但备份非空”的字段。
   - 额外生成本轮恢复前备份：
     - `settings.json.pre-restore-20260216-223819`

2. **代码防护：保存时先合并已落盘配置，避免部分对象覆盖**
   - 文件：`src/index.ts`
   - 改动：`saveSettings()` 先读取持久化配置并与传入设置合并后再保存：
     - `persistedSettings + incoming settings -> mergeSettingsWithDefaults -> save`
   - 目的：即使调用方传的是部分设置对象，也不会把原有字段冲掉。

3. **回归脚本补充**
   - 文件：`scripts/test_settings_default_merge_regression.mjs`
   - 新增断言：`saveSettings` 包含持久化配置合并逻辑。

## 可执行验证结果

1) Queue 回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (9 checks)`

2) 设置合并回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 输出：`[settings-merge-regression] OK (8 checks)`

3) 构建验证
```bash
npm run build
```
- 结果：通过
- 输出：
  - `✓ 65 modules transformed.`
  - `dist/index.js   645.87 kB │ gzip: 189.09 kB`

4) 插件目录同步
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 输出：安装目录 `index.js` 已更新（`2026-02-16 22:40`）

5) 设置恢复结果检查
```bash
python3 - <<'PY'
import json
p='/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json'
d=json.load(open(p,encoding='utf-8'))
print(d.get('codexGitRepoDir'))
print(d.get('codexGitRemoteUrl'))
print(d.get('codexGitBranch'))
print(d.get('codexGitAutoSyncEnabled'))
print(d.get('codexGitAutoCommitMessage'))
print('webApps_len=', len(d.get('webApps') or []))
PY
```
- 结果：通过
- 关键输出：
  - `D:\\SIYUAN\\data`
  - `../git-remotes/siyuan-notes.git`
  - `main`
  - `True`
  - `chore(notes): sync {ts}`
  - `webApps_len= 7`
