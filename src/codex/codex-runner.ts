export type CodexRunMode = 'read_only' | 'workspace_write' | 'fully_open';
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface CodexExecEvent {
    type: string;
    [key: string]: any;
}

export interface RunCodexExecOptions {
    cliPath?: string;
    workingDir: string;
    prompt: string;
    mcpScriptPath?: string;
    threadId?: string;
    skipGitRepoCheck?: boolean;
    modelOverride?: string;
    reasoningEffort?: CodexReasoningEffort | '';
    runMode?: CodexRunMode;
    siyuanApiUrl?: string;
    siyuanApiToken?: string;
    onEvent?: (event: CodexExecEvent) => void;
    onStdErr?: (line: string) => void;
}

export interface RunCodexExecHandle {
    abort: () => void;
    completed: Promise<{ exitCode: number | null; signal: string | null; threadId?: string }>;
}

function nodeRequire<T = any>(id: string): T {
    const w = globalThis as any;
    if (w?.require && typeof w.require === 'function') {
        return w.require(id);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
}

function isWindows(): boolean {
    const p = (globalThis as any)?.process?.platform;
    return p === 'win32';
}

function getPluginRootDir(): string {
    try {
        // In SiYuan plugin runtime (CJS), this usually points to the plugin directory.
        // eslint-disable-next-line no-undef
        if (typeof __dirname === 'string' && __dirname) return __dirname;
    } catch {
        // ignore
    }
    return (globalThis as any)?.process?.cwd?.() || '.';
}

export function getDefaultSiyuanMcpScriptPath(): string {
    const path = nodeRequire<typeof import('path')>('path');
    return path.join(getPluginRootDir(), 'mcp', 'siyuan-mcp', 'index.cjs');
}

function escapeTomlLiteralString(value: string): string {
    // TOML literal string: single quotes; escape single quote by doubling it.
    return value.replace(/'/g, "''");
}

function buildMcpOverrides(siyuanMcpScriptPath: string): string[] {
    const scriptLiteral = escapeTomlLiteralString(siyuanMcpScriptPath);
    const nodeCmd = isWindows() ? 'node.exe' : 'node';
    return [
        // Transport
        'mcp_servers.siyuan.type=stdio',
        `mcp_servers.siyuan.command=${nodeCmd}`,
        // args is TOML array of literal strings to avoid backslash escaping
        `mcp_servers.siyuan.args=['${scriptLiteral}']`,
        // pass sensitive values via env var names (value stays in env, not CLI args)
        `mcp_servers.siyuan.env_vars=['SIYUAN_API_URL','SIYUAN_API_TOKEN','SIYUAN_MCP_READ_ONLY']`,
        'mcp_servers.siyuan.startup_timeout_sec=30',
        'mcp_servers.siyuan.enabled=true',
    ];
}

function buildRunModeArgs(runMode: CodexRunMode | undefined): string[] {
    const mode = runMode || 'read_only';
    if (mode === 'fully_open') {
        return ['--dangerously-bypass-approvals-and-sandbox'];
    }
    if (mode === 'workspace_write') {
        return ['--full-auto'];
    }
    return ['-s', 'read-only'];
}

function normalizeReasoningEffort(value: unknown): CodexReasoningEffort | '' {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh') {
        return v as CodexReasoningEffort;
    }
    return '';
}

function buildReasoningEffortOverrides(effortRaw: unknown): string[] {
    const effort = normalizeReasoningEffort(effortRaw);
    if (!effort) return [];
    const effortLiteral = escapeTomlLiteralString(effort);
    return [`model_reasoning_effort='${effortLiteral}'`];
}

export function runCodexExec(options: RunCodexExecOptions): RunCodexExecHandle {
    const childProcess = nodeRequire<typeof import('child_process')>('child_process');

    const cliPath = (options.cliPath || '').trim() || 'codex';
    const skipGitRepoCheck = options.skipGitRepoCheck !== false;
    const runModeArgs = buildRunModeArgs(options.runMode);
    const reasoningOverrides = buildReasoningEffortOverrides(options.reasoningEffort);

    const siyuanMcpScriptPath =
        (options.mcpScriptPath || '').trim() || getDefaultSiyuanMcpScriptPath();
    const overrides = buildMcpOverrides(siyuanMcpScriptPath);

    const args: string[] = ['exec', '--json'];
    if (skipGitRepoCheck) args.push('--skip-git-repo-check');
    args.push('-C', options.workingDir);

    if (options.modelOverride && options.modelOverride.trim()) {
        args.push('--model', options.modelOverride.trim());
    }

    args.push(...runModeArgs);

    for (const o of [...overrides, ...reasoningOverrides]) {
        args.push('-c', o);
    }

    // Use stdin for prompt to avoid Windows command line length limits.
    if (options.threadId && options.threadId.trim()) {
        args.push('resume', options.threadId.trim(), '-');
    } else {
        args.push('-');
    }

    const env: Record<string, string> = { ...(globalThis as any)?.process?.env };
    if (options.siyuanApiUrl && options.siyuanApiUrl.trim()) {
        env.SIYUAN_API_URL = options.siyuanApiUrl.trim();
    }
    if (options.siyuanApiToken && options.siyuanApiToken.trim()) {
        env.SIYUAN_API_TOKEN = options.siyuanApiToken.trim();
    }
    env.SIYUAN_MCP_READ_ONLY = (options.runMode || 'read_only') === 'read_only' ? '1' : '0';

    const child = childProcess.spawn(cliPath, args, {
        cwd: options.workingDir,
        env,
        shell: isWindows() || /\.(cmd|bat)$/i.test(cliPath),
        windowsHide: true,
    });

    let stdoutBuf = '';
    let capturedThreadId: string | undefined = undefined;
    let aborted = false;

    const emitEvent = (ev: CodexExecEvent) => {
        try {
            if (ev?.type === 'thread.started') {
                capturedThreadId = ev.thread_id || ev.threadId || capturedThreadId;
            }
            options.onEvent?.(ev);
        } catch (e) {
            console.warn('Codex event handler failed:', e);
        }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
        while (true) {
            const idx = stdoutBuf.indexOf('\n');
            if (idx === -1) break;
            const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line.trim()) continue;
            try {
                const ev = JSON.parse(line) as CodexExecEvent;
                emitEvent(ev);
            } catch {
                // Non-JSON lines (warnings) should still be surfaced for debugging.
                options.onStdErr?.(line);
            }
        }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) options.onStdErr?.(line);
    });

    // Write prompt to stdin.
    try {
        child.stdin?.write(options.prompt);
        child.stdin?.write('\n');
        child.stdin?.end();
    } catch (e) {
        options.onStdErr?.(`Failed to write prompt to codex stdin: ${(e as Error).message}`);
    }

    const abort = () => {
        if (aborted) return;
        aborted = true;
        try {
            if (isWindows() && child.pid) {
                // Kill process tree on Windows.
                childProcess.spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
                    windowsHide: true,
                    shell: true,
                });
            }
        } catch {
            // ignore
        }
        try {
            child.kill();
        } catch {
            // ignore
        }
    };

    const completed = new Promise<{ exitCode: number | null; signal: string | null; threadId?: string }>(
        (resolve) => {
            child.on('close', (code: number | null, signal: string | null) => {
                resolve({ exitCode: code, signal, threadId: capturedThreadId });
            });
            child.on('error', (err: Error) => {
                if (!aborted) {
                    options.onStdErr?.(`Codex process error: ${err.message}`);
                }
                resolve({ exitCode: null, signal: null, threadId: capturedThreadId });
            });
        }
    );

    return { abort, completed };
}
