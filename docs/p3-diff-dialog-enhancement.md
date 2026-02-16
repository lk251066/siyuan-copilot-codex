# P3 Diff 弹窗增强（对标 VSCode Copilot Chat）计划与验收

> 记录目的：把本次 P3（Diff 弹窗）改动的目标、范围、文案与最小验收标准固化，方便后续回归与对照 VSCode Copilot Chat。

## 背景

当前 Diff 弹窗存在以下痛点：

- 仅有分栏视图，无法切换 Unified / Split。
- 长行默认换行，难以对齐；或需要手动横向滚动的能力（no-wrap + 横向滚动）。
- 使用 `compactTraceDiffLines(...).slice(...)` 截断大 diff，用户无法展开查看上下文。
- 大 diff 渲染容易卡顿/冻结。
- 弹层键盘可用性不足：Esc 关闭、Tab 焦点可见等。

## 目标（P3）

Diff 弹窗支持：

1. **Split / Unified 切换**
2. **行号显示**
3. **默认 no-wrap + 横向滚动**，并支持 **wrap 切换**
4. **上下文折叠/展开**：替代 “slice 截断”，允许用户展开查看更多
5. **大 diff 不冻结 UI**：渲染/计算做分段或懒处理
6. 继续保留：
   - `git diff --no-index` 优先（失败回退内置 diff）
   - 一键复制 unified patch（Copy Patch）

## 目标（P1：键盘可用性）

对话框/弹层（至少包含 Diff/GitSync/WebLink）：

- **Esc** 可关闭弹层
- **Tab** 可聚焦可交互元素，且焦点样式可见（focus-visible）

## i18n 文案约定（建议）

新增/复用的文案键（zh_CN/en_US 需要保持一致）：

- `aiSidebar.diff.modeUnified` / `aiSidebar.diff.modeSplit`（已存在）
- `aiSidebar.diff.wrapOn` / `aiSidebar.diff.wrapOff`
- `aiSidebar.diff.expandContext` / `aiSidebar.diff.collapseContext`
- `aiSidebar.diff.collapsedLines`（示例：`… {count} lines collapsed`）

## 最小回归验收

1. 打开任意 Diff 弹窗：可切换 Split/Unified
2. 默认不换行且可横向滚动；点击按钮可切换换行
3. 大 diff 仍可交互，UI 不冻结（滚动/切换/关闭均正常）
4. Esc 可关闭 Diff/GitSync/WebLink 弹层
5. Tab 可以在弹层中循环聚焦按钮/输入框，焦点可见

