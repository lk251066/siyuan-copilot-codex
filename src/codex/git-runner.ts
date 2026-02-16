export type GitDiffLineType = 'removed' | 'added' | 'unchanged';

export type GitDiffLine = {
    type: GitDiffLineType;
    line: string;
};

export interface RunGitCommandOptions {
    cliPath?: string;
    cwd: string;
    args: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
    acceptExitCodes?: number[];
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
}

export interface RunGitCommandResult {
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

export interface RunGitCommandHandle {
    abort: () => void;
    completed: Promise<RunGitCommandResult>;
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

function appendLinesFromChunk(
    buffer: string,
    chunk: Buffer,
    onLine?: (line: string) => void
): { buffer: string; linesText: string } {
    let nextBuf = buffer + chunk.toString('utf8');
    let linesText = '';
    while (true) {
        const idx = nextBuf.indexOf('\n');
        if (idx === -1) break;
        const line = nextBuf.slice(0, idx).replace(/\r$/, '');
        nextBuf = nextBuf.slice(idx + 1);
        if (!line) continue;
        linesText += line + '\n';
        onLine?.(line);
    }
    return { buffer: nextBuf, linesText };
}

function flushBufferedLine(buffer: string, onLine?: (line: string) => void): string {
    const line = buffer.replace(/\r$/, '');
    if (!line) return '';
    onLine?.(line);
    return line + '\n';
}

export function runGitCommand(options: RunGitCommandOptions): RunGitCommandHandle {
    const childProcess = nodeRequire<typeof import('child_process')>('child_process');
    const cliPath = (options.cliPath || '').trim() || 'git';

    const env: Record<string, string> = {
        ...(globalThis as any)?.process?.env,
        ...(options.env || {}),
    };
    if (!('GIT_TERMINAL_PROMPT' in env)) {
        env.GIT_TERMINAL_PROMPT = '0';
    }

    const acceptExitCodes =
        Array.isArray(options.acceptExitCodes) && options.acceptExitCodes.length > 0
            ? options.acceptExitCodes
            : [0];

    // On Windows, avoid `shell: true` for `.exe` paths (especially those containing spaces),
    // otherwise the command may be split by `cmd.exe` and fail to execute.
    // Only `.cmd/.bat` scripts require a shell.
    const needsShell = isWindows() && /\.(cmd|bat)$/i.test(cliPath);

    const child = childProcess.spawn(cliPath, options.args, {
        cwd: options.cwd,
        env,
        shell: needsShell,
        windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;
    let settled = false;

    const completed = new Promise<RunGitCommandResult>(resolve => {
        const finish = (exitCode: number | null, signal: string | null) => {
            if (settled) return;
            settled = true;
            stdout += flushBufferedLine(stdoutBuf, options.onStdoutLine);
            stderr += flushBufferedLine(stderrBuf, options.onStderrLine);
            resolve({ exitCode, signal, stdout, stderr, timedOut });
        };

        child.stdout?.on('data', (chunk: Buffer) => {
            const res = appendLinesFromChunk(stdoutBuf, chunk, options.onStdoutLine);
            stdoutBuf = res.buffer;
            stdout += res.linesText;
        });

        child.stderr?.on('data', (chunk: Buffer) => {
            const res = appendLinesFromChunk(stderrBuf, chunk, options.onStderrLine);
            stderrBuf = res.buffer;
            stderr += res.linesText;
        });

        child.on('close', (exitCode: number | null, signal: string | null) => {
            finish(exitCode, signal);
        });

        child.on('error', (err: any) => {
            const msg = err?.message || String(err);
            stderr += msg + '\n';
            options.onStderrLine?.(msg);
            finish(127, 'error');
        });

        if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
            globalThis.setTimeout(() => {
                if (settled) return;
                timedOut = true;
                try {
                    child.kill();
                } catch {
                    // ignore
                }
            }, options.timeoutMs);
        }
    }).then(result => {
        if (result.exitCode !== null && acceptExitCodes.includes(result.exitCode)) {
            return result;
        }
        return result;
    });

    return {
        abort: () => {
            try {
                child.kill();
            } catch {
                // ignore
            }
        },
        completed,
    };
}

function normalizeTmpFileName(label: string): string {
    const base = label
        .replace(/[\\/]+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
    return base || 'content';
}

export async function runGitDiffNoIndex(options: {
    cliPath?: string;
    cwd?: string;
    oldText: string;
    newText: string;
    label?: string;
    timeoutMs?: number;
}): Promise<RunGitCommandResult> {
    const fs = nodeRequire<typeof import('fs')>('fs');
    const path = nodeRequire<typeof import('path')>('path');
    const os = nodeRequire<typeof import('os')>('os');

    const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'siyuan-codex-diff-'));
    const base = normalizeTmpFileName(String(options.label || '').trim());
    const oldFileName = `a_${base}.txt`;
    const newFileName = `b_${base}.txt`;
    const oldPath = path.join(tmpRoot, oldFileName);
    const newPath = path.join(tmpRoot, newFileName);

    try {
        await fs.promises.writeFile(oldPath, String(options.oldText || ''), 'utf8');
        await fs.promises.writeFile(newPath, String(options.newText || ''), 'utf8');

        const handle = runGitCommand({
            cliPath: options.cliPath,
            cwd: options.cwd || tmpRoot,
            timeoutMs: options.timeoutMs ?? 5000,
            // git diff: 0 = no diff, 1 = has diff, >1 = error
            acceptExitCodes: [0, 1],
            args: ['diff', '--no-index', '--no-color', '--text', '--', oldFileName, newFileName],
        });
        return await handle.completed;
    } finally {
        try {
            await fs.promises.rm(tmpRoot, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
}

export function parseUnifiedDiffToLines(unifiedDiff: string): GitDiffLine[] {
    const result: GitDiffLine[] = [];
    const lines = String(unifiedDiff || '').split(/\r?\n/);

    for (const rawLine of lines) {
        if (!rawLine) continue;
        if (
            rawLine.startsWith('diff --git') ||
            rawLine.startsWith('index ') ||
            rawLine.startsWith('--- ') ||
            rawLine.startsWith('+++ ') ||
            rawLine.startsWith('@@') ||
            rawLine.startsWith('new file mode') ||
            rawLine.startsWith('deleted file mode') ||
            rawLine.startsWith('similarity index') ||
            rawLine.startsWith('rename from') ||
            rawLine.startsWith('rename to') ||
            rawLine.startsWith('\\ No newline at end of file')
        ) {
            continue;
        }

        const marker = rawLine[0];
        if (marker === '+') {
            result.push({ type: 'added', line: rawLine.slice(1) });
            continue;
        }
        if (marker === '-') {
            result.push({ type: 'removed', line: rawLine.slice(1) });
            continue;
        }
        if (marker === ' ') {
            result.push({ type: 'unchanged', line: rawLine.slice(1) });
        }
    }

    return result;
}
