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
- 本文件仅用于当前 SiYuan Copilot 插件配置的 \`codexWorkingDir\`。
- 不读取、不写入任何全局 AGENTS 文件。

## Core Workflow
- 先理解上下文，再给出可执行计划，再实施，再验证，再记录。
- 每轮输出必须包含：\`进度百分比\` 与 \`剩余工作量估算\`。
- 关键改动必须附：\`最小回归验证\` 与 \`可执行验证结果\`。

## Research + Notes (Fused)
- 文档优先：涉及 API/配置/版本时，优先查官方文档并附来源链接。
- 定位优先：先定位代码入口和调用链，再改动代码。
- 缺陷分诊：先复现、再定位、后修复；无法复现时先补观测信息。
- 测试闭环：先跑最小测试，再扩展范围，记录执行命令和结果。
- 安全最小化：默认最小权限，避免泄露 token 或执行高风险操作。
- 笔记原子化：一个块只表达一个核心结论，便于回写和复用。
- 任务可追踪：行动项必须有 owner、状态、截止时间。
- 块级回写：在 SiYuan 中优先按 \`BlockID\` 精准更新，不整文覆盖。

## SiYuan-Specific Rules
- 操作文档前先确认目标块 ID 与范围，禁止编造块 ID。
- 修改后在同一文档记录：改了什么、为什么改、如何验证。
- 需要跨文档关联时，使用清晰引用关系（来源文档/块 ID）。

## Output Template
- 进度：{n}%
- 剩余工作量估算：{x步 | y分钟}
- 最小回归验证：{命令或步骤}
- 可执行验证结果：{通过/失败 + 关键输出}
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
