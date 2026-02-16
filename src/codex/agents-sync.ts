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
- 只同步当前目录 \`AGENTS.md\`，不读取/写入全局 AGENTS 文件。
- 目标：每次任务都能留下可复现证据与可追溯记录。

## Output Rules
- 每轮必须输出：
  - \`进度百分比\`
  - \`剩余工作量估算\`（步数或分钟）
- 关键改动必须附：
  - \`最小回归验证\`
  - \`可执行验证结果\`（通过/失败 + 关键输出）

## Execution Flow
1. 先确认目标、输入/输出和边界。
2. 先读取项目上下文/进度文档，再开始实施。
3. 优先最小改动；高风险步骤先声明回滚点。
4. 改动后执行最小验证，并记录命令与关键输出。
5. 更新进度记录：做了什么、结果如何、后续行动项。

## Local Skills（优先）
- 优先使用当前工作目录 \`skills/\` 下的本地 skills。
- 先看 \`skills/INDEX.md\`，再只读取命中的 \`SKILL.md\`。
- 用户显式提到技能名（如 \`$skill-name\`）时，必须启用该 skill。
- 任务语义明显匹配 skill 名称或描述时，默认启用该 skill。
- 若技能文件缺失或不可读，必须说明原因并降级到通用流程。
- 输出中注明“本轮使用 skills：...”。

## SiYuan Rules
- 操作前先确认 \`BlockID\` 和修改范围，禁止编造 ID。
- 优先块级精确更新，避免整文覆盖。
- 外部结论必须保留来源链接，关键步骤必须给可执行命令。
- 写回笔记后补充：改了什么、为什么改、如何验证。

## Quality Gate
- 是否保留了来源链接与关键证据？
- 是否包含最小回归与可执行验证结果？
- 是否更新了进度与后续行动项，且可追溯？
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
