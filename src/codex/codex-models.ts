export interface FetchCodexModelsOptions {
    apiKey?: string;
    endpoint?: string;
    timeoutMs?: number;
}

const DEFAULT_CODEX_MODEL_ENDPOINT = 'https://www.right.codes/codex/v1/models';

export function resolveCodexModelApiKeyFromSettings(settings: any): string {
    return String(settings?.aiProviders?.openai?.apiKey || '').trim();
}

function normalizeModelId(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim();
}

function collectModelIds(payload: any): string[] {
    const source =
        (Array.isArray(payload?.data) && payload.data) ||
        (Array.isArray(payload?.models) && payload.models) ||
        (Array.isArray(payload) && payload) ||
        [];

    const ids: string[] = [];
    for (const item of source) {
        if (typeof item === 'string') {
            const id = normalizeModelId(item);
            if (id) ids.push(id);
            continue;
        }
        if (item && typeof item === 'object') {
            const id =
                normalizeModelId(item.id) ||
                normalizeModelId(item.model) ||
                normalizeModelId(item.name);
            if (id) ids.push(id);
        }
    }
    return Array.from(new Set(ids));
}

export async function fetchCodexModels(options: FetchCodexModelsOptions = {}): Promise<string[]> {
    const endpoint = String(options.endpoint || DEFAULT_CODEX_MODEL_ENDPOINT).trim();
    const apiKey = String(options.apiKey || '').trim();
    const timeoutMs = Math.max(3000, Number(options.timeoutMs || 15000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = {
            Accept: 'application/json',
        };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
            headers['X-Api-Key'] = apiKey;
            headers['X-Goog-Api-Key'] = apiKey;
        }

        const response = await fetch(endpoint, {
            method: 'GET',
            headers,
            signal: controller.signal,
            cache: 'no-store',
        });

        let payload: any = null;
        let text = '';
        try {
            payload = await response.json();
        } catch {
            try {
                text = await response.text();
            } catch {
                text = '';
            }
        }

        if (!response.ok) {
            const detail =
                String(payload?.error || '').trim() ||
                String(payload?.message || '').trim() ||
                text.trim() ||
                `HTTP ${response.status}`;
            throw new Error(detail);
        }

        const models = collectModelIds(payload);
        if (models.length === 0) {
            throw new Error('模型接口未返回可用模型');
        }
        return models.sort((a, b) => a.localeCompare(b));
    } finally {
        clearTimeout(timer);
    }
}
