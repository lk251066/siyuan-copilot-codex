import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ONE_BY_ONE_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5w0f8AAAAASUVORK5CYII=';

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to bind fake SiYuan server'));
                return;
            }
            resolve(addr.port);
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
    });
}

function createRpcClient(child) {
    let nextId = 1;
    const pending = new Map();
    let stdoutBuf = '';

    child.stdout.on('data', (chunk) => {
        stdoutBuf += String(chunk);
        while (true) {
            const idx = stdoutBuf.indexOf('\n');
            if (idx < 0) break;
            const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line.trim()) continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }
            if (msg?.id === undefined || msg?.id === null) continue;
            const ticket = pending.get(msg.id);
            if (!ticket) continue;
            pending.delete(msg.id);
            if (msg.error) {
                ticket.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
                ticket.resolve(msg.result);
            }
        }
    });

    child.on('error', (error) => {
        for (const ticket of pending.values()) {
            ticket.reject(error);
        }
        pending.clear();
    });

    child.on('exit', (code, signal) => {
        if (!pending.size) return;
        const err = new Error(`MCP process exited unexpectedly: code=${code} signal=${signal}`);
        for (const ticket of pending.values()) {
            ticket.reject(err);
        }
        pending.clear();
    });

    const call = (method, params, timeoutMs = 15000) => {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`RPC timeout: ${method}`));
            }, timeoutMs);
            pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })}\n`);
        });
    };

    return { call };
}

function parseToolCallPayload(result) {
    const content = Array.isArray(result?.content) ? result.content : [];
    const textPart = content.find((item) => item && item.type === 'text');
    const raw = String(textPart?.text || '').trim();
    if (!raw) return null;
    return JSON.parse(raw);
}

async function main() {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'mcp-fallback-test-'));
    const fakeChromePath = path.join(tempRoot, 'fake-chrome.js');

    writeFileSync(
        fakeChromePath,
        `#!/usr/bin/env node\n` +
            `const fs = require('node:fs');\n` +
            `const path = require('node:path');\n` +
            `const outArg = process.argv.find(a => a.startsWith('--screenshot='));\n` +
            `if (!outArg) process.exit(2);\n` +
            `const out = outArg.slice('--screenshot='.length);\n` +
            `fs.mkdirSync(path.dirname(out), { recursive: true });\n` +
            `const png = Buffer.from('${ONE_BY_ONE_PNG_BASE64}', 'base64');\n` +
            `fs.writeFileSync(out, png);\n` +
            `process.exit(0);\n`,
        'utf8'
    );
    chmodSync(fakeChromePath, 0o755);

    let uploadCount = 0;
    const fakeAssetPath = '/assets/fallback-test.png';
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/asset/upload') {
            uploadCount += 1;
            req.on('data', () => {});
            req.on('end', () => {
                const body = {
                    code: 0,
                    msg: '',
                    data: {
                        succMap: {
                            'file[]': fakeAssetPath,
                        },
                    },
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: -1, msg: `Unhandled path: ${req.method} ${req.url}` }));
    });

    let child = null;
    try {
        const port = await listen(server);
        const apiUrl = `http://127.0.0.1:${port}`;

        child = spawn('node', ['mcp/siyuan-mcp/index.cjs'], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                SIYUAN_API_URL: apiUrl,
                SIYUAN_MCP_READ_ONLY: '0',
                SIYUAN_MCP_REMOTE_TIMEOUT_MS: '200',
                SIYUAN_MCP_REMOTE_MAX_RETRIES: '0',
                SIYUAN_MCP_LOCAL_SCREENSHOT_FALLBACK: '1',
                SIYUAN_MCP_CHROME_BIN: fakeChromePath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stderr.on('data', (chunk) => {
            const text = String(chunk || '').trim();
            if (text) {
                process.stderr.write(`[mcp-stderr] ${text}\n`);
            }
        });

        const rpc = createRpcClient(child);

        await rpc.call('initialize', { protocolVersion: '2024-11-05' }, 5000);
        const toolsListResult = await rpc.call('tools/list', {}, 5000);
        const tools = Array.isArray(toolsListResult?.tools) ? toolsListResult.tools : [];
        const screenshotTool = tools.find((tool) => tool?.name === 'siyuan_capture_webpage_screenshot');

        assert.ok(screenshotTool, 'missing siyuan_capture_webpage_screenshot tool');
        const modeEnum = screenshotTool?.inputSchema?.properties?.mode?.enum || [];
        assert.deepEqual(modeEnum, ['append', 'prepend', 'after', 'before']);
        assert.equal(!!screenshotTool?.inputSchema?.properties?.anchorBlockId, true);
        assert.equal(!!screenshotTool?.inputSchema?.properties?.dryRun, true);
        assert.equal(String(screenshotTool?.description || '').includes('fallback'), true);

        const screenshotCall = await rpc.call(
            'tools/call',
            {
                name: 'siyuan_capture_webpage_screenshot',
                arguments: {
                    url: 'https://example.invalid/fallback-target',
                    width: 1024,
                    fullPage: false,
                },
            },
            30000
        );

        assert.equal(screenshotCall?.isError === true, false, 'tools/call should succeed');
        const payload = parseToolCallPayload(screenshotCall);
        assert.ok(payload && typeof payload === 'object', 'invalid screenshot payload');
        assert.equal(payload.ok, true, 'payload.ok must be true');
        assert.equal(payload.localFallbackUsed, true, 'local fallback should be used');
        assert.equal(String(payload?.asset?.assetPath || ''), fakeAssetPath, 'assetPath mismatch');
        assert.equal(String(payload?.asset?.captureProviderUrl || '').includes('local'), true);
        assert.equal(Array.isArray(payload?.warnings), true);
        assert.ok(uploadCount >= 1, 'fake upload endpoint was not called');

        console.log('MCP fallback regression: PASS');
        console.log(`uploadCount=${uploadCount}`);
        console.log(`assetPath=${payload.asset.assetPath}`);
        console.log(`captureProvider=${payload.asset.captureProviderUrl}`);
    } finally {
        if (child && !child.killed) {
            try {
                child.kill();
            } catch {
                // ignore
            }
        }
        await closeServer(server);
        try {
            rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
