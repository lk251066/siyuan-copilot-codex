# 2026-02-16 进度：Git Auto Sync dry-run 回归脚本

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 分支：`main`
- 目标：为 Git Auto Sync dry-run 增加可执行回归，覆盖“开关持久化 + 预演日志断言”核心路径。

## 改动内容
- 新增脚本：`scripts/test_git_autosync_dryrun_regression.mjs`
- 新增 npm 命令：`npm run test:git-dryrun`

脚本检查点：
1. 开关状态与持久化字段存在（`gitAutoSyncDryRun` / `codexGitAutoSyncDryRun`）
2. 环境变量接入（`SIYUAN_CODEX_GIT_DRY_RUN`）
3. `runGitAutoSync` dry-run 分支与日志标识存在
4. 写操作预演日志断言存在：
   - `skip write: pull`
   - `skip write: add`
   - `skip write: commit`
   - `skip write: push`
5. UI 文案键存在（dry-run 提示与按钮文本）

## 最小回归验证
```bash
npm run test:git-dryrun
```
- 结果：通过（exit code 0）
- 关键输出：
  - `Git Auto Sync dry-run regression: PASS`
  - `checks=toggle+persistence+dryrun-log+write-skip+ui-label`

## 风险与边界
- 当前脚本属于“源码行为约束回归”（静态断言），用于防止关键路径被误删。
- 不替代真实 UI 点击流（可后续补充 Playwright 端到端回归）。

## 后续行动项
- [ ] 若后续引入 Playwright 回归框架，可把本脚本升级为真实 UI 自动化断言。
