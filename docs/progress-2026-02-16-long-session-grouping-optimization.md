# 2026-02-16 进度：长会话分组渲染优化（减少 `groupMessages` 全量重算）

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 分支：`main`
- 基线提交：`a1053b75be3a4f2759359573c171fec9f0060cba`
- 目标：在不改变现有功能行为前提下，减少长会话中 `groupMessages(messages)` 的不必要全量重算与渲染压力。

## 改动内容（最小改动）
- 文件：`src/ai-sidebar.svelte`
1. 新增 `computeMessageGroups`：
   - **浅拷贝无结构变化**（如 `messages = [...messages]`）时直接复用已有分组。
   - **append-only**（末尾新增消息）时仅增量补分组，不再全量 `groupMessages`。
   - 其他场景（中间编辑/删除/重排）回退全量分组，确保正确性。
2. 新增 `appendGroupedMessage` / `getMessageGroupType`，保持原分组语义：
   - `user` 始终独立成组；
   - 连续 `assistant/tool` 合并为 AI 组。
3. 列表 key 由 `groupIndex` 改为 `group.startIndex`，减少 append 场景下不必要的重渲染扰动。

## 决策与理由
- 选择“增量 + 回退”而非重构渲染架构（如虚拟列表），理由：
  - 改动面小，风险可控；
  - 对当前瓶颈（大量 append + 频繁浅拷贝触发重算）直接有效；
  - 保留全量回退路径，避免功能回归。

## 风险与边界
- 风险：如果未来出现特殊消息变更模式（同长度但中间大范围替换），会走全量回退，不影响正确性但优化收益会下降。
- 边界：本次仅优化“分组计算与列表 key”；未引入虚拟滚动、未改消息内容渲染逻辑。

## 最小回归验证
1. 构建验证
- 命令：`npm run build`
- 结果：通过（exit code 0）
- 关键输出：
  - `✓ 65 modules transformed.`
  - `dist/index.js   635.54 kB │ gzip: 185.69 kB`
  - `✓ built in 11.64s`

## 可执行验证结果
- 状态：**通过**
- 说明：改动后项目可正常完成生产构建，未引入编译错误。

## 后续行动项
- [ ] 在真实超长会话（1000+ 消息）补充交互对比数据（输入延迟/滚动流畅度）
  - owner: worker-2
  - 截止：2026-02-17
  - 状态：待执行
