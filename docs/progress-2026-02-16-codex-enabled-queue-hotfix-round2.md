# 2026-02-16 进度：Codex 启用误判与 Queue UI 热修复（第 2 轮）

## 背景
- 用户反馈：UI 仍提示“请先在设置中启用 Codex”，queue 功能不可见。
- 目标：定位真实生效配置来源，修复“误判未启用”与“queue 按钮不出现”。

## 根因
1. `settings.json` 中 `codexEnabled` 被写回为 `false`，发送前会触发“未启用 Codex”阻断。
2. 旧逻辑先执行较长初始化，再执行 `enforceCodexOnlySettings()`；若中途异常，可能来不及把 `codexEnabled` 强制写回 `true`。
3. 设置页允许手动关闭 `codexEnabled`，会反复把该值写回 `false`。

## 本轮改动
1. **默认与合并阶段强制 Codex 启用**
   - `src/defaultSettings.ts`
   - `codexEnabled` 默认值改为 `true`
   - `mergeSettingsWithDefaults()` 中强制 `merged.codexEnabled = true`

2. **保存设置阶段兜底强制启用**
   - `src/index.ts`
   - `saveSettings()` 改为先走 `mergeSettingsWithDefaults(settings)` 再保存，防止外部传入 `false` 落盘。

3. **侧栏初始化提前强制写回**
   - `src/ai-sidebar.svelte`
   - `onMount` 中加载设置后立即执行 `enforceCodexOnlySettings()`，避免后续步骤异常导致漏写。

4. **发送时去掉“硬失败”并自愈**
   - `src/ai-sidebar.svelte`
   - 发送前若读到 `codexEnabled !== true`，自动改为 `true` 并尝试保存，不再直接弹“未启用”错误阻断。

5. **设置页禁用 Codex 开关**
   - `src/SettingsPannel.svelte`
   - `codexEnabled` 开关改为固定勾选且不可编辑，文案提示“Codex-only 固定启用”。

6. **i18n 文案**
   - `i18n/zh_CN.json`
   - `i18n/en_US.json`
   - 新增 `settings.codex.enabled.fixed`

## 可执行验证结果

1) 队列回归
```bash
npm run test:codex-queue
```
- 结果：通过
- 输出：`[queue-regression] OK (8 checks)`

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
- 关键输出：
  - `✓ 65 modules transformed.`
  - `dist/index.js   643.70 kB │ gzip: 188.65 kB`

4) 部署同步
```bash
rsync -a --delete dist/ /mnt/d/SIYUAN/data/plugins/siyuan-copilot-codex/
```
- 结果：通过
- 关键输出：安装目录 `index.js` 已更新到 `2026-02-16 22:23`

5) 运行时配置确认
```bash
python3 - <<'PY'
import json
p='/mnt/d/SIYUAN/data/storage/petal/siyuan-copilot-codex/settings.json'
d=json.load(open(p,encoding='utf-8'))
print('codexEnabled=',d.get('codexEnabled'))
PY
```
- 结果：通过
- 输出：`codexEnabled= True`

## 备注
- 本轮主要修复 `codexEnabled` 被写回 `false` 导致的误判阻断；该问题修复后，queue UI 才能在“运行中 + 有草稿”场景正常出现。
