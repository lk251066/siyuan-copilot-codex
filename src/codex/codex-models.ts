export interface FetchCodexModelsOptions {
    workingDir?: string;
    configPath?: string;
}

export function resolveCodexModelApiKeyFromSettings(settings: any): string {
    return String(settings?.aiProviders?.openai?.apiKey || '').trim();
}

function nodeRequire<T = any>(id: string): T {
    const w = globalThis as any;
    const runtimeRequire =
        (w?.require && typeof w.require === 'function' && w.require) ||
        (typeof require === 'function' ? require : null);
    if (runtimeRequire) {
        return runtimeRequire(id);
    }
    throw new Error('当前环境不支持 Node require');
}

function normalizeModelId(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim();
}

function removeTomlInlineComment(rawLine: string): string {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < rawLine.length; i++) {
        const ch = rawLine[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (!inSingle && ch === '"') {
            inDouble = !inDouble;
            continue;
        }
        if (!inDouble && ch === "'") {
            // TOML literal string escapes single quote by doubled single quote.
            if (inSingle && rawLine[i + 1] === "'") {
                i += 1;
                continue;
            }
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && !inDouble && ch === '#') {
            return rawLine.slice(0, i).trimEnd();
        }
    }
    return rawLine.trimEnd();
}

function parseTomlStringValue(rawValue: string): string {
    const value = rawValue.trim().replace(/,$/, '').trim();
    if (!value) return '';
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        try {
            return JSON.parse(value);
        } catch {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return '';
}

function isLikelyModelId(value: string): boolean {
    if (!value) return false;
    if (/\s/.test(value)) return false;
    return /[a-zA-Z0-9]/.test(value);
}

function collectModelsFromToml(content: string): string[] {
    const models = new Set<string>();
    const lines = content.split(/\r?\n/);
    let currentSection = '';

    for (const rawLine of lines) {
        const line = removeTomlInlineComment(rawLine).trim();
        if (!line) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1].trim();
            continue;
        }

        const modelMatch = line.match(/^model\s*=\s*(.+)$/);
        if (modelMatch) {
            const modelId = normalizeModelId(parseTomlStringValue(modelMatch[1]));
            if (isLikelyModelId(modelId)) {
                models.add(modelId);
            }
            continue;
        }

        if (currentSection === 'notice.model_migrations') {
            const pairMatch = line.match(/^(.+?)\s*=\s*(.+)$/);
            if (!pairMatch) continue;
            const fromModel = normalizeModelId(parseTomlStringValue(pairMatch[1]));
            const toModel = normalizeModelId(parseTomlStringValue(pairMatch[2]));
            if (isLikelyModelId(fromModel)) models.add(fromModel);
            if (isLikelyModelId(toModel)) models.add(toModel);
        }
    }

    return Array.from(models);
}

function resolveCodexConfigCandidates(options: FetchCodexModelsOptions = {}): string[] {
    const path = nodeRequire<typeof import('path')>('path');
    const os = nodeRequire<typeof import('os')>('os');
    const procEnv = (globalThis as any)?.process?.env || {};

    const candidates: string[] = [];
    const explicitPath = String(options.configPath || '').trim();
    if (explicitPath) {
        candidates.push(explicitPath);
    }

    const workingDir = String(options.workingDir || '').trim();
    if (workingDir) {
        candidates.push(path.join(workingDir, '.codex', 'config.toml'));
    }

    const codexHome = String(procEnv.CODEX_HOME || '').trim();
    if (codexHome) {
        candidates.push(path.join(codexHome, 'config.toml'));
    }

    const homeDir = String(procEnv.USERPROFILE || procEnv.HOME || os.homedir?.() || '').trim();
    if (homeDir) {
        candidates.push(path.join(homeDir, '.codex', 'config.toml'));
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const item of candidates) {
        const normalized = normalizeModelId(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(normalized);
    }
    return deduped;
}

export function resolveCodexLocalConfigPaths(options: FetchCodexModelsOptions = {}): string[] {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const matches: string[] = [];
    for (const candidate of resolveCodexConfigCandidates(options)) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                matches.push(candidate);
            }
        } catch {
            // ignore invalid paths
        }
    }
    return matches;
}

export async function fetchCodexModels(options: FetchCodexModelsOptions = {}): Promise<string[]> {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const configPaths = resolveCodexLocalConfigPaths(options);

    if (configPaths.length === 0) {
        throw new Error('未找到本地 Codex 配置文件（~/.codex/config.toml）');
    }

    const allModels = new Set<string>();
    for (const configPath of configPaths) {
        try {
            const content = String(fs.readFileSync(configPath, 'utf8') || '');
            const models = collectModelsFromToml(content);
            for (const model of models) {
                allModels.add(model);
            }
        } catch (error) {
            throw new Error(`读取本地 Codex 配置失败：${configPath} (${(error as Error).message})`);
        }
    }

    const modelList = Array.from(allModels).sort((a, b) => a.localeCompare(b));
    if (modelList.length === 0) {
        throw new Error('本地 Codex 配置中未找到模型，请在 config.toml 配置 model 或 profiles.*.model');
    }
    return modelList;
}
