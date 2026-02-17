# 2026-02-17 进度：配置反复清空修复（第 12 轮）

## 背景
- 用户持续反馈：插件关闭/打开后，配置仍会被清空。
- 现网现象：`settings.json` 常回到“只剩基础字段”的状态，Git 远端/分支等关键字段丢失。

## 根因结论
1. 备份恢复与审计逻辑使用 `fs + /data/storage/petal/...` 绝对路径；在 Windows Desktop 下该路径可能不是工作区真实路径，导致备份读取/审计写入失效。
2. “重置态”识别过窄：仅当 `codexGitCliPath` 也为空才触发；而现实里该值常被自动探测填充，导致误判为“非重置态”。
3. 空对象 `{}` 未被当作异常重置输入，可能被当成首次安装并写回默认配置。

## 本轮改动

### 1) 修复 fs 路径解析（按工作区 data 路径）
- 文件：`src/index.ts`
- 新增：
  - `resolveWorkspaceDataRootForFs()`
  - `resolvePetalStorageDirForFs(namespace)`
- 将以下逻辑改为基于新 helper：
  - `appendSettingsAuditEvent`
  - `readSettingsBackups`
  - `recoverResetSettingsIfNeeded` 中的 `settingsPath`

### 2) 扩大“重置态”识别范围
- 文件：`src/index.ts`
- `looksLikeResetSettings`：
  - 新增空对象判定：`{}` 直接视为疑似重置。
  - Git 判定不再依赖 `codexGitCliPath` 是否为空（避免被自动探测值干扰）。
- `hasUsefulRecoveryData`：
  - 不再把 `codexGitCliPath` 单独当作可恢复信号，优先看 repo/remote/branch/autoSync/webApps。

### 3) 恢复合并时减少“默认值覆盖”
- 文件：`src/index.ts`
- `isMeaningfulSettingValue` 调整：
  - `boolean` 仅 `true` 视为“强信号”；
  - `number` 仅非 `0` 视为“强信号”；
- 作用：疑似重置恢复时，更倾向保留已有有效配置，降低默认值回写覆盖概率。

### 4) 回归脚本补强
- 文件：`scripts/test_settings_default_merge_regression.mjs`
- 新增检查项：
  - fs 路径 helper 存在且被调用；
  - 空对象重置识别存在；
  - 重置识别不再依赖 `codexGitCliPath` 为空。

## 最小回归验证

1) 设置回归
```bash
npm run test:settings-merge
```
- 结果：通过
- 关键输出：`[settings-merge-regression] OK (17 checks)`

2) 队列回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 关键输出：`[queue-regression] OK (14 checks)`

3) 构建验证
```bash
npm run build
```
- 结果：通过
- 关键输出：`dist/index.js 658.06 kB`

## 下一步
1. 同步插件到安装目录后，请用户执行一次“关闭插件 -> 打开插件”，再检查：
   - `settings.json` 是否保留 Git 配置；
   - `settings-write-audit.ndjson` 是否开始生成。
2. 若仍异常，基于 audit 文件定位具体写入事件再做定点修复。
