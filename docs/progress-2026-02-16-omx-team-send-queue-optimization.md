# 2026-02-16 进度：OMX Team 发送策略优化（queue / interrupt 自动判断）

## 背景
- 目标：修复 `$team` 场景中“指令停留在输入框、未真正提交”的稳定性问题。
- 现象：worker 正在执行任务时，`send-keys + Enter` 有概率未按预期提交。
- 路径：`/home/lk251066/.npm-global/lib/node_modules/oh-my-codex/dist/team/tmux-session.js`

## 本次改动
### 1) 新增“worker 正在忙”的识别
- 位置：`dist/team/tmux-session.js:267-281`
- 新增 `paneHasActiveTask(captured)`：通过 `esc to interrupt` / `background terminal running` 等特征判断当前 pane 是否处于执行态。

### 2) 新增发送策略开关（环境变量）
- 位置：`dist/team/tmux-session.js:282-290`
- 新增 `OMX_TEAM_SEND_STRATEGY`，支持：
  - `auto`（默认）：忙时优先 queue，空闲时直接提交
  - `queue`：始终先走 queue
  - `interrupt`：先 `Ctrl+C` 再提交

### 3) `sendToWorker` 提交链路优化
- 位置：`dist/team/tmux-session.js:357-417`
- 改动点：
  - 先读取策略并判断 pane 是否忙。
  - `auto + 忙` 时，首轮用 `Tab + Enter`（queue）。
  - 若首轮未生效，回退原有 `Enter` 重试链路，保持兼容。
  - `interrupt` 模式下先发 `C-c`，用于“立刻打断并切任务”的场景。

## 最小回归验证
1. 团队会话发送模块单测
```bash
cd /home/lk251066/.npm-global/lib/node_modules/oh-my-codex
node --test dist/team/__tests__/tmux-session.test.js
```
- 结果：通过（18/18）

2. team runtime 单测
```bash
node --test dist/team/__tests__/runtime.test.js
```
- 结果：通过（20/20）

3. 队列通信单测
```bash
node --test dist/team/__tests__/mcp-comm.test.js
```
- 结果：通过（3/3）

4. CLI 冒烟
```bash
omx team status no-such-team-for-check
```
- 结果：正常返回 `No team state found ...`

## 可执行验证结果
- 结论：本次改动未破坏 team 相关核心测试；`sendToWorker` 已支持“根据执行状态自动选择 queue/interrupt”的策略基础。
- 兼容性：默认 `auto`，不设置环境变量时可平滑升级。

## 风险与边界
- 该改动在 **全局 npm 安装目录**，后续 `npm i -g oh-my-codex` 可能覆盖；如需持久化建议同步到 OMX 源仓库并发布。

## 后续行动项
- [ ] 增加一条集成测试：模拟 worker 忙状态时，验证首轮发送使用 `Tab + Enter`。
- [ ] 在 `team` skill 文档中补充 `OMX_TEAM_SEND_STRATEGY` 使用示例。
