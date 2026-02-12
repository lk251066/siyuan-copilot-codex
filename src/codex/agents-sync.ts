export const CODEX_LOCAL_AGENTS_FILE = 'AGENTS.md';

const LEGACY_DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

export interface AgentsSyncResult {
    settings: any;
    changed: boolean;
    filePath: string | null;
    reason:
        | 'disabled'
        | 'no_working_dir'
        | 'created_from_template'
        | 'created_from_settings'
        | 'pulled_from_file'
        | 'pushed_to_file'
        | 'external_file_changed'
        | 'unchanged';
}

const DEFAULT_CODEX_AGENTS_PROMPT = `# AGENTS

## Scope
- 本文件仅作用于当前 SiYuan Copilot 配置的 \`codexWorkingDir\`。
- 不读取、不写入全局 AGENTS 文件。
- 默认目标：把每次问答沉淀为可追溯的研究记录、知识笔记和行动项。

## Output Rules
- 每轮必须输出：
  - \`进度百分比\`
  - \`剩余工作量估算\`（步数或分钟）
- 关键改动必须附：
  - \`最小回归验证\`
  - \`可执行验证结果\`（通过/失败 + 关键输出）

## Core Loop
1. 澄清目标与边界（输入、产出、限制）。
2. 并行收集证据与上下文（代码、文档、数据源）。
3. 产出可执行方案（含风险与回滚点）。
4. 最小改动实施。
5. 执行验证并记录结果。
6. 回写笔记并沉淀可复用知识。

## Skills-driven Workflows

### 1) 调研流程（research + source-management）
- 至少双来源交叉验证，优先官方文档和一手资料。
- 每条结论记录来源：标题、链接、日期、可信度。
- 不确定结论必须标注“待验证”，并给出下一步验证方案。

### 2) 知识沉淀（knowledge-management + memory-management）
- 每次任务结束输出：
  - 背景
  - 结论
  - 决策及理由
  - 风险与边界
  - 后续行动项（owner、截止时间、状态）
- 维护“当前工作记忆”：目标、已完成、阻塞、下一步，避免会话漂移。

### 3) 原子笔记（zettelkasten-note-creation）
- 一条笔记只表达一个核心结论。
- 标题包含关键术语，便于检索。
- 明确双向关联：上游来源、下游应用。
- 新结论优先关联已有笔记，避免重复沉淀。

### 4) 会议纪要（meeting-notes-and-actions / meeting-minutes-taker）
- 会议输出固定结构：
  - 主题与时间
  - 关键讨论点
  - 决策列表
  - 行动项（owner、截止时间、状态）
- 未确认事项标记为“待确认”，禁止写成已决策。

### 5) 文档治理（docs-cleaner）
- 先去重，再合并，再归档。
- 合并后保留原文链接与版本信息，防止溯源丢失。

### 6) 项目可复原记录（必须）
- 调研中出现的外部链接/地址必须保留原始 URL。
- 涉及代码仓库时，必须记录：仓库地址、分支、提交 SHA、关键文件路径。
- 关键步骤不能只贴链接，必须在笔记中保留可执行信息：命令、参数、输入输出示例、依赖版本。
- 关键配置不能只引用外部页面，必须在笔记中落地最小可用配置片段。
- 涉及下载文件时，必须记录：保存路径、文件名、版本、校验值（如 SHA256）。
- 单条调研结论需要同时包含：
  - 来源链接
  - 摘要结论
  - 复现步骤
  - 验证结果
- 目标标准：仅凭笔记内容可还原项目，不需要再回原页面或原仓库找关键信息。

## SiYuan-Specific Rules
- 操作前先确认 \`BlockID\` 和范围，禁止编造 ID。
- 优先块级精确更新，避免整文覆盖。
- 修改后在同一文档补充：改了什么、为什么改、如何验证。
- 跨文档引用时，写明来源文档与 \`BlockID\`。
- 涉及脚本/API 写入时，优先给最小影响方案（可先 dry-run）。

## Quality Gate
- 是否给出可点击的来源链接？
- 是否包含最小回归与执行结果？
- 是否生成可复用知识条目和行动项？
- 是否满足 SiYuan 块级更新规范？
- 是否仅靠笔记即可还原项目（不依赖再次访问外部页面）？
`;

function nodeRequire<T = any>(id: string): T {
    const w = globalThis as any;
    if (w?.require && typeof w.require === 'function') return w.require(id);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
}

function nowIso(): string {
    return new Date().toISOString();
}

function normalizePromptText(input: string): string {
    const text = String(input || '').replace(/\r\n/g, '\n').trim();
    return text;
}

function normalizePromptFileText(input: string): string {
    const text = normalizePromptText(input);
    return text ? `${text}\n` : '';
}

function getHash(content: string): string {
    const crypto = nodeRequire<typeof import('crypto')>('crypto');
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function cloneSettings(settings: any): any {
    return {
        ...settings,
        codexPromptSyncEnabled: settings?.codexPromptSyncEnabled !== false,
        codexPromptSyncFileName: CODEX_LOCAL_AGENTS_FILE,
    };
}

function resolveAgentsFilePath(codexWorkingDir: string): string | null {
    const dir = String(codexWorkingDir || '').trim();
    if (!dir) return null;
    const path = nodeRequire<typeof import('path')>('path');
    const resolvedDir = path.resolve(dir);
    return path.join(resolvedDir, CODEX_LOCAL_AGENTS_FILE);
}

function readAgentsFile(filePath: string): { exists: boolean; content: string } {
    const fs = nodeRequire<typeof import('fs')>('fs');
    if (!fs.existsSync(filePath)) return { exists: false, content: '' };
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { exists: true, content };
    } catch {
        return { exists: false, content: '' };
    }
}

function writeAgentsFile(filePath: string, content: string): void {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const path = nodeRequire<typeof import('path')>('path');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, normalizePromptFileText(content), 'utf8');
}

function pickInitialAgentsPrompt(settings: any): string {
    const currentPrompt = normalizePromptText(String(settings?.aiSystemPrompt || ''));
    if (!currentPrompt || currentPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT) {
        return DEFAULT_CODEX_AGENTS_PROMPT;
    }
    return currentPrompt;
}

function finalizeSyncMetadata(settings: any, prompt: string): any {
    const text = normalizePromptText(prompt);
    const hash = getHash(text);
    return {
        ...settings,
        aiSystemPrompt: text,
        codexPromptLastSyncedHash: hash,
        codexPromptLastSyncedAt: nowIso(),
        codexPromptSyncFileName: CODEX_LOCAL_AGENTS_FILE,
    };
}

export function pullPromptFromWorkingDirAgentsFile(settings: any): AgentsSyncResult {
    const base = cloneSettings(settings);
    if (base.codexPromptSyncEnabled === false) {
        return {
            settings: base,
            changed: false,
            filePath: null,
            reason: 'disabled',
        };
    }

    const filePath = resolveAgentsFilePath(base.codexWorkingDir);
    if (!filePath) {
        return {
            settings: base,
            changed: false,
            filePath: null,
            reason: 'no_working_dir',
        };
    }

    const currentFile = readAgentsFile(filePath);
    if (!currentFile.exists || !normalizePromptText(currentFile.content)) {
        const initial = pickInitialAgentsPrompt(base);
        writeAgentsFile(filePath, initial);
        const next = finalizeSyncMetadata(base, initial);
        const changed =
            normalizePromptText(base.aiSystemPrompt || '') !== normalizePromptText(initial) ||
            String(base.codexPromptLastSyncedHash || '') !== String(next.codexPromptLastSyncedHash || '');
        return {
            settings: next,
            changed,
            filePath,
            reason: normalizePromptText(base.aiSystemPrompt || '') ? 'created_from_settings' : 'created_from_template',
        };
    }

    const filePrompt = normalizePromptText(currentFile.content);
    const next = finalizeSyncMetadata(base, filePrompt);
    const changed =
        normalizePromptText(base.aiSystemPrompt || '') !== filePrompt ||
        String(base.codexPromptLastSyncedHash || '') !== String(next.codexPromptLastSyncedHash || '');
    return {
        settings: next,
        changed,
        filePath,
        reason: changed ? 'pulled_from_file' : 'unchanged',
    };
}

export function bidirectionalSyncPromptWithWorkingDirAgentsFile(settings: any): AgentsSyncResult {
    const base = cloneSettings(settings);
    if (base.codexPromptSyncEnabled === false) {
        return {
            settings: base,
            changed: false,
            filePath: null,
            reason: 'disabled',
        };
    }

    const filePath = resolveAgentsFilePath(base.codexWorkingDir);
    if (!filePath) {
        return {
            settings: base,
            changed: false,
            filePath: null,
            reason: 'no_working_dir',
        };
    }

    const currentFile = readAgentsFile(filePath);
    const settingPrompt = normalizePromptText(base.aiSystemPrompt || '');

    if (!currentFile.exists || !normalizePromptText(currentFile.content)) {
        const nextPrompt = settingPrompt || pickInitialAgentsPrompt(base);
        writeAgentsFile(filePath, nextPrompt);
        const next = finalizeSyncMetadata(base, nextPrompt);
        const changed =
            settingPrompt !== normalizePromptText(nextPrompt) ||
            String(base.codexPromptLastSyncedHash || '') !== String(next.codexPromptLastSyncedHash || '');
        return {
            settings: next,
            changed,
            filePath,
            reason: settingPrompt ? 'created_from_settings' : 'created_from_template',
        };
    }

    const filePrompt = normalizePromptText(currentFile.content);
    const fileHash = getHash(filePrompt);
    const settingHash = getHash(settingPrompt);
    const lastHash = String(base.codexPromptLastSyncedHash || '');

    if (fileHash !== lastHash && fileHash !== settingHash) {
        const next = finalizeSyncMetadata(base, filePrompt);
        const changed =
            normalizePromptText(base.aiSystemPrompt || '') !== filePrompt ||
            String(base.codexPromptLastSyncedHash || '') !== fileHash;
        return {
            settings: next,
            changed,
            filePath,
            reason: 'external_file_changed',
        };
    }

    if (settingHash !== fileHash && settingPrompt) {
        writeAgentsFile(filePath, settingPrompt);
        const next = finalizeSyncMetadata(base, settingPrompt);
        const changed =
            normalizePromptText(base.aiSystemPrompt || '') !== settingPrompt ||
            String(base.codexPromptLastSyncedHash || '') !== String(next.codexPromptLastSyncedHash || '');
        return {
            settings: next,
            changed,
            filePath,
            reason: 'pushed_to_file',
        };
    }

    const next = finalizeSyncMetadata(base, filePrompt);
    const changed =
        normalizePromptText(base.aiSystemPrompt || '') !== filePrompt ||
        String(base.codexPromptLastSyncedHash || '') !== fileHash;
    return {
        settings: next,
        changed,
        filePath,
        reason: changed ? 'pulled_from_file' : 'unchanged',
    };
}
