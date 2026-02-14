export interface WorkspaceSkillMeta {
    key: string;
    name: string;
    description: string;
    filePath: string;
    relativePath: string;
    source: 'workspace' | 'plugin';
}

export interface WorkspaceSkillOverride {
    name?: string;
    description?: string;
}

export interface WorkspaceSkillsOptions {
    includePlugin?: boolean;
    maxSkills?: number;
    skillOverrides?: Record<string, WorkspaceSkillOverride>;
}

function nodeRequire<T = any>(id: string): T {
    const w = globalThis as any;
    if (w?.require && typeof w.require === 'function') return w.require(id);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
}

function parseSkillFrontmatter(content: string): { name: string; description: string } {
    const text = String(content || '');
    if (!text.startsWith('---')) {
        return { name: '', description: '' };
    }
    const lines = text.split(/\r?\n/);
    if (!lines.length || lines[0].trim() !== '---') {
        return { name: '', description: '' };
    }

    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
            end = i;
            break;
        }
    }
    if (end <= 1) {
        return { name: '', description: '' };
    }

    let name = '';
    let description = '';
    for (let i = 1; i < end; i += 1) {
        const line = lines[i];
        const match = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
        if (!match) continue;
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim().replace(/^['"]|['"]$/g, '');
        if (key === 'name') name = value;
        if (key === 'description') description = value;
    }
    return { name, description };
}

function toPosixPath(input: string): string {
    return String(input || '').replace(/\\/g, '/');
}

function getSiyuanWorkspaceDir(): string {
    try {
        const cfg =
            (globalThis as any)?.window?.siyuan?.config || (globalThis as any)?.siyuan?.config || {};
        const candidates = [cfg?.system?.workspaceDir, cfg?.system?.workspace, cfg?.workspaceDir];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
    } catch {
        // ignore
    }
    return '';
}

function getPluginRootDir(): string {
    try {
        // eslint-disable-next-line no-undef
        if (typeof __dirname === 'string' && __dirname) return __dirname;
    } catch {
        // ignore
    }
    return (globalThis as any)?.process?.cwd?.() || '.';
}

function resolveSkillsDir(baseDir: string): string | null {
    const dir = String(baseDir || '').trim();
    if (!dir) return null;
    const fs = nodeRequire<typeof import('fs')>('fs');
    const path = nodeRequire<typeof import('path')>('path');
    const resolved = path.resolve(dir, 'skills');
    if (!fs.existsSync(resolved)) return null;
    try {
        if (!fs.statSync(resolved).isDirectory()) return null;
    } catch {
        return null;
    }
    return resolved;
}

function resolveAbsoluteSkillsDir(absoluteSkillsDir: string): string | null {
    const dir = String(absoluteSkillsDir || '').trim();
    if (!dir) return null;
    const fs = nodeRequire<typeof import('fs')>('fs');
    const path = nodeRequire<typeof import('path')>('path');
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) return null;
    try {
        if (!fs.statSync(resolved).isDirectory()) return null;
    } catch {
        return null;
    }
    return resolved;
}

function resolveSkillSearchRoots(
    workingDir: string,
    includePlugin = true
): Array<{ source: 'workspace' | 'plugin'; dir: string }> {
    const path = nodeRequire<typeof import('path')>('path');
    const roots: Array<{ source: 'workspace' | 'plugin'; dir: string }> = [];
    const dedupe = new Set<string>();
    const addRoot = (source: 'workspace' | 'plugin', dir: string | null) => {
        if (!dir) return;
        const normalized = path.resolve(dir);
        if (dedupe.has(normalized)) return;
        dedupe.add(normalized);
        roots.push({ source, dir: normalized });
    };

    const workspaceSkillsDir = resolveSkillsDir(workingDir);
    addRoot('workspace', workspaceSkillsDir);

    const siyuanWorkspaceDir = getSiyuanWorkspaceDir();
    addRoot('workspace', resolveSkillsDir(siyuanWorkspaceDir));

    if (!includePlugin) {
        return roots;
    }

    addRoot('plugin', resolveSkillsDir(getPluginRootDir()));

    const pluginCandidates = new Set<string>();
    if (workingDir) {
        pluginCandidates.add(path.join(workingDir, 'data', 'plugins', 'siyuan-copilot-codex', 'skills'));
        pluginCandidates.add(path.join(workingDir, 'data', 'plugins', 'siyuan-plugin-copilot', 'skills'));
    }
    if (siyuanWorkspaceDir) {
        pluginCandidates.add(
            path.join(siyuanWorkspaceDir, 'data', 'plugins', 'siyuan-copilot-codex', 'skills')
        );
        pluginCandidates.add(
            path.join(siyuanWorkspaceDir, 'data', 'plugins', 'siyuan-plugin-copilot', 'skills')
        );
    }
    for (const candidate of pluginCandidates) {
        addRoot('plugin', resolveAbsoluteSkillsDir(candidate));
    }

    return roots;
}

function normalizeMaxSkills(value: number | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 30;
    const normalized = Math.floor(parsed);
    if (normalized < 1) return 1;
    if (normalized > 100) return 100;
    return normalized;
}

export function listWorkspaceSkills(
    workingDir: string,
    options: WorkspaceSkillsOptions = {}
): WorkspaceSkillMeta[] {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const path = nodeRequire<typeof import('path')>('path');
    const maxSkills = normalizeMaxSkills(options.maxSkills);
    const roots = resolveSkillSearchRoots(workingDir, options.includePlugin !== false);
    if (!roots.length) return [];

    const result: WorkspaceSkillMeta[] = [];
    const visited = new Set<string>();
    const dedupeByFile = new Set<string>();

    for (const root of roots) {
        if (result.length >= maxSkills) break;

        const queue: string[] = [root.dir];
        while (queue.length > 0 && result.length < maxSkills) {
            const current = queue.shift() as string;
            if (visited.has(current)) continue;
            visited.add(current);

            let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (result.length >= maxSkills) break;
                if (!entry.isDirectory()) continue;
                const full = path.join(current, entry.name);
                const skillFile = path.join(full, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    const normalizedSkillFile = path.resolve(skillFile);
                    if (dedupeByFile.has(normalizedSkillFile)) continue;
                    dedupeByFile.add(normalizedSkillFile);

                    let content = '';
                    try {
                        content = fs.readFileSync(skillFile, 'utf8');
                    } catch {
                        content = '';
                    }
                    const parsed = parseSkillFrontmatter(content);
                    const relativeToRoot = toPosixPath(path.relative(root.dir, skillFile));
                    const relativePath =
                        root.source === 'workspace'
                            ? `skills/${relativeToRoot}`
                            : `plugin/skills/${relativeToRoot}`;
                    const key = relativePath;
                    const override = options.skillOverrides?.[key];
                    result.push({
                        key,
                        name: String(override?.name || '').trim() || parsed.name || entry.name,
                        description:
                            String(override?.description || '').trim() ||
                            parsed.description ||
                            'No description',
                        filePath: skillFile,
                        relativePath,
                        source: root.source,
                    });
                    continue;
                }
                queue.push(full);
            }
        }
    }

    return result;
}

export function buildWorkspaceSkillsPrompt(
    workingDir: string,
    options: WorkspaceSkillsOptions = {}
): string {
    const skills = listWorkspaceSkills(workingDir, options);
    if (!skills.length) return '';

    const lines: string[] = [
        '## Local Skills',
        '- 先查看 `skills/INDEX.md`，再读取命中的 `SKILL.md`。',
        '- 用户显式提到 `$skill-name` 时，必须启用该 skill。',
        '- 任务语义匹配 skill 名称或描述时，优先使用本地 skill。',
        '- 优先使用工作目录 `skills/`；缺失时再使用 `plugin/skills/`。',
        '- 若技能文件缺失或不可读，需说明原因并降级到通用流程。',
        '',
        'Available skills:',
    ];

    skills.forEach((skill, idx) => {
        const sourceLabel = skill.source === 'workspace' ? 'workspace' : 'plugin';
        lines.push(
            `${idx + 1}. ${skill.name}: ${skill.description}`,
            `   source: ${sourceLabel}`,
            `   file: ${skill.relativePath}`
        );
    });

    return lines.join('\n');
}
