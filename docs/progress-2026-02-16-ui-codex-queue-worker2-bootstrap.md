# 2026-02-16 进度：UI 提示“未启用 Codex”排查与 queue/默认配置回归（worker-2）

## 背景
- 任务来源：`.omx/state/team/ui-codex-queue/tasks/task-2.json`
- 目标：排查“UI 仍提示未启用 Codex”，定位实际生效插件与配置来源，并校验 queue 与默认配置加载链路。
- 仓库信息：
  - 仓库：<https://github.com/Achuan-2/siyuan-plugin-copilot>
  - 分支：`main`
  - 基线提交：`0257d1ecb8e8b1d9139a8a782b34f242fc95d2cc`

## 结论
1. **实际生效插件来源**：由 `plugin.json` 的 `name` 决定，当前为 `siyuan-copilot-codex`，设置文件读取入口是 `loadData("settings.json")`。
2. **配置实际读取来源**：设置读取路径对应插件命名空间，即 `/data/storage/petal/siyuan-copilot-codex/settings.json`（通过 `loadData(SETTINGS_FILE)` 间接访问）。
3. **queue 与默认配置链路当前可用**：
   - queue 回归脚本通过（8 项检查）；
   - 默认配置合并回归脚本通过（5 项检查）；
   - 构建通过，且构建产物中 `codexEnabled` 默认值为 `true`，并保留“发送前回拉 loadSettings”逻辑。

## 关键证据（来源 + 链接 + 日期 + 可信度）
1. 插件名与入口配置（高）
   - 来源：`plugin.json`
   - 链接：<https://github.com/Achuan-2/siyuan-plugin-copilot/blob/main/plugin.json>
   - 日期：2026-02-16
2. 设置加载入口（高）
   - 来源：`src/index.ts`（`SETTINGS_FILE` + `loadSettings()`）
   - 链接：<https://github.com/Achuan-2/siyuan-plugin-copilot/blob/main/src/index.ts>
   - 日期：2026-02-16
3. 默认配置与 merge 兜底（高）
   - 来源：`src/defaultSettings.ts`
   - 链接：<https://github.com/Achuan-2/siyuan-plugin-copilot/blob/main/src/defaultSettings.ts>
   - 日期：2026-02-16
4. queue 发送逻辑（高）
   - 来源：`src/ai-sidebar.svelte`
   - 链接：<https://github.com/Achuan-2/siyuan-plugin-copilot/blob/main/src/ai-sidebar.svelte>
   - 日期：2026-02-16

## 复现与验证步骤
```bash
# 1) queue 回归
npm run test:codex-queue

# 2) 默认配置合并回归
npm run test:settings-merge

# 3) 构建
npm run build

# 4) 校验“插件名 + 设置来源”
node --no-warnings - <<'NODE'
const fs=require('fs');
const plugin=JSON.parse(fs.readFileSync('plugin.json','utf8'));
const src=fs.readFileSync('src/index.ts','utf8');
console.log('plugin.name =', plugin.name);
console.log('expected settings storage =', `/data/storage/petal/${plugin.name}/settings.json`);
console.log('uses loadData(SETTINGS_FILE):', src.includes("const settings = (await this.loadData(SETTINGS_FILE)) || {};"));
NODE

# 5) 校验构建产物默认值与回拉逻辑存在
python3 - <<'PY'
from pathlib import Path
text = Path('dist/index.js').read_text(encoding='utf-8', errors='ignore')
print('default codexEnabled true:', 'codexEnabled:!0' in text)
print('merge forces codex true:', 'i.codexEnabled=!0' in text)
print('has loadSettings retry log:', 'Reload settings before send failed:' in text)
PY
```

## 可执行验证结果
- `npm run test:codex-queue`：**通过**
  - 输出：`[queue-regression] OK (8 checks)`
- `npm run test:settings-merge`：**通过**
  - 输出：`[settings-merge-regression] OK (5 checks)`
- `npm run build`：**通过**
  - 输出：`✓ 65 modules transformed.`
  - 输出：`dist/index.js   643.70 kB │ gzip: 188.65 kB`
- 插件名/设置来源校验：**通过**
  - 输出：`plugin.name = siyuan-copilot-codex`
  - 输出：`expected settings storage = /data/storage/petal/siyuan-copilot-codex/settings.json`
  - 输出：`uses loadData(SETTINGS_FILE): true`
- 构建产物检查：**通过**
  - 输出：`default codexEnabled true: True`
  - 输出：`merge forces codex true: True`
  - 输出：`has loadSettings retry log: True`

## 决策与理由
- 先做“源码 + 构建产物 + 回归脚本”三段式验证，避免只看源码导致误判。
- 先确认“生效插件名 + 设置命名空间”，解决“改了代码但 UI 仍旧异常”这类常见定位偏差。

## 风险与边界
- 当前验证是“代码结构 + 构建产物 + 脚本回归”，**未覆盖真实 SiYuan UI 点击流端到端演练**。
- 代码中仍存在部分历史资源路径使用 `/data/storage/petal/siyuan-plugin-copilot/...`，虽不直接影响 `settings.json` 命名空间，但建议后续统一清理，避免跨版本目录混用。

## 后续行动项
- [ ] owner: leader-fixed，截止：2026-02-18，状态：pending  
      增加一条 Playwright/UI 手工链路回归：在 SiYuan 真实界面验证“运行中发送 => 入队”与“不会再提示未启用 Codex”。
- [ ] owner: leader-fixed，截止：2026-02-18，状态：pending  
      评估并统一历史硬编码资源目录（`siyuan-plugin-copilot` -> `siyuan-copilot-codex`）以减少目录分裂风险。
