export interface PromptTemplate {
    id: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

const PROMPT_TEMPLATES_FILE = 'prompt-templates.json';

let templates: PromptTemplate[] = [];
let loaded = false;
let loadPromise: Promise<PromptTemplate[]> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const subscribers = new Set<(value: PromptTemplate[]) => void>();

export function normalizePromptTemplates(value: unknown): PromptTemplate[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(item => item && typeof item === 'object')
        .map((item: any, index) => {
            const now = Date.now();
            return {
                id: String(item.id || `prompt-${index + 1}`),
                title: String(item.title || '').trim(),
                content: String(item.content || '').trim(),
                createdAt:
                    typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
                        ? item.createdAt
                        : now,
                updatedAt:
                    typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
                        ? item.updatedAt
                        : now,
            };
        })
        .filter(prompt => prompt.title && prompt.content)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

function publish(next: PromptTemplate[]) {
    templates = next;
    for (const subscriber of subscribers) subscriber(templates);
}

export function subscribePromptTemplates(subscriber: (value: PromptTemplate[]) => void): () => void {
    subscribers.add(subscriber);
    subscriber(templates);
    return () => subscribers.delete(subscriber);
}

export async function loadPromptTemplates(
    plugin: any,
    legacyPrompts: unknown = []
): Promise<PromptTemplate[]> {
    if (loaded) return templates;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const data = await plugin.loadData(PROMPT_TEMPLATES_FILE);
        // An explicit prompts array, including [], is authoritative. This preserves a user's
        // intentional "delete all" action and prevents old settings from being migrated again.
        if (data && Array.isArray(data.prompts)) {
            publish(normalizePromptTemplates(data.prompts));
            loaded = true;
            return templates;
        }

        const migrated = normalizePromptTemplates(legacyPrompts);
        await plugin.saveData(PROMPT_TEMPLATES_FILE, { prompts: migrated });
        publish(migrated);
        loaded = true;
        return templates;
    })().finally(() => {
        loadPromise = null;
    });

    return loadPromise;
}

export async function updatePromptTemplates(
    plugin: any,
    update: (current: PromptTemplate[]) => PromptTemplate[],
    legacyPrompts: unknown = []
): Promise<PromptTemplate[]> {
    const operation = writeQueue.then(async () => {
        await loadPromptTemplates(plugin, legacyPrompts);
        const next = normalizePromptTemplates(update(templates));
        await plugin.saveData(PROMPT_TEMPLATES_FILE, { prompts: next });
        publish(next);
        return next;
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
}
