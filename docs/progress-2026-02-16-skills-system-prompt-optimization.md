# 2026-02-16 进度：Skills 与系统提示词优化

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 目标：优化插件内置 skills 组织方式，以及默认系统提示词的可执行性和稳定性。

## 本次改动

### 1) 默认系统提示词优化（更聚焦执行）
- 文件：`src/defaultSettings.ts`
- 调整点：
  - 将默认提示词改为更清晰的“执行策略 + 输出要求”；
  - 增加“需求不清晰时先提一个澄清问题”的规则；
  - 保留“进度百分比 / 剩余工作量 / 回归验证”硬约束。

### 2) AGENTS 模板优化（减少冗余、强化流程）
- 文件：`src/codex/agents-sync.ts`
- 调整点：
  - 精简默认 AGENTS 模板，去掉重复与过长描述；
  - 保留关键结构：Scope / Output Rules / Execution Flow / Local Skills / SiYuan Rules / Quality Gate；
  - 强化“先读上下文文档、再最小改动、再验证回写”的闭环。

### 3) Skills 注入提示优化（减 token + 提升稳定性）
- 文件：`src/codex/workspace-skills.ts`
- 调整点：
  - 技能目录遍历增加排序，保证输出稳定；
  - skill 名称与描述标准化（去多余空白）；
  - skill 描述自动截断，防止长描述撑爆系统提示词；
  - skills 列表从三行结构压缩为单行结构，降低上下文占用。

### 4) skills 注入上限优化
- 文件：`src/ai-sidebar.svelte`
- 调整点：
  - `maxSkills` 从 `100` 调整为 `40`，避免超长 prompt 导致模型注意力分散。

### 5) 本地 skills 索引优化
- 文件：`skills/INDEX.md`
- 调整点：
  - 重排为“使用顺序 + 适用场景”结构；
  - 补齐 `worker` skill，避免团队模式下遗漏。

### 6) worker skill 协议优化
- 文件：`skills/worker/SKILL.md`
- 调整点：
  - 新增完成清单（改动摘要/验证结果/进度与剩余工作）；
  - 新增 anti-stall 规则（超时主动提问、权限失败上报、任务完成即收尾）。

## 最小回归验证
1. 构建验证
   - 命令：`npm run build`
   - 结果：通过（exit code 0）

2. Skills 提示生成验证
   - 命令：
     ```bash
     node --loader ts-node/esm -e "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url); const m = await import('./src/codex/workspace-skills.ts'); const p = m.buildWorkspaceSkillsPrompt(process.cwd(),{maxSkills:40}); console.log('chars', p.length); console.log('lines', p.split(/\\n/).length);"
     ```
   - 结果：通过（`chars 1072`，`lines 14`）

3. 关键配置落地验证
   - 命令：
     ```bash
     rg -n "Execution policy|Available skills \(|maxSkills: 40|Local Skills（优先）" src/defaultSettings.ts src/codex/agents-sync.ts src/codex/workspace-skills.ts src/ai-sidebar.svelte
     ```
   - 结果：通过（四处关键变更均命中）

## 结论
- 已完成“skills + 系统提示词”双侧优化：
  - 更短、更稳、更可执行；
  - 仍保留项目要求的进度、验证和可追溯约束。
