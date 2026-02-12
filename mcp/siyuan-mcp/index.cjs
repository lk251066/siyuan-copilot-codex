/* eslint-disable no-console */
// Minimal MCP stdio server for SiYuan API (newline-delimited JSON-RPC 2.0)
//
// Tools exposed:
// - siyuan_sql_query
// - siyuan_get_block_content
// - siyuan_insert_block
// - siyuan_update_block
// - siyuan_create_document
// - siyuan_list_notebooks
// - siyuan_create_notebook
// - siyuan_get_doc_tree
// - siyuan_rename_document
// - siyuan_move_documents
// - siyuan_get_block_attrs
// - siyuan_set_block_attrs
// - siyuan_database

const readline = require('node:readline');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const SIYUAN_API_URL = (process.env.SIYUAN_API_URL || 'http://127.0.0.1:6806').replace(/\/+$/, '');
const SIYUAN_API_TOKEN = process.env.SIYUAN_API_TOKEN || '';
const SIYUAN_MCP_READ_ONLY = (() => {
    const raw = String(process.env.SIYUAN_MCP_READ_ONLY || '1').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();

function assertWriteAllowed(toolName) {
    if (!SIYUAN_MCP_READ_ONLY) return;
    throw new Error(`read-only 模式下不允许写入：${toolName}`);
}

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    send({ jsonrpc: '2.0', id, error });
}

function toolOk(text) {
    return { content: [{ type: 'text', text: String(text ?? '') }] };
}

function toolError(text) {
    return { isError: true, content: [{ type: 'text', text: String(text ?? '') }] };
}

async function siyuanFetch(path, body) {
    const url = new URL(`${SIYUAN_API_URL}${path}`);
    const payload = JSON.stringify(body ?? {});

    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    };
    if (SIYUAN_API_TOKEN) headers.Authorization = `Token ${SIYUAN_API_TOKEN}`;

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers,
    };

    const text = await new Promise((resolve, reject) => {
        const req = mod.request(options, (res) => {
            res.setEncoding('utf8');
            let buf = '';
            res.on('data', (chunk) => {
                buf += chunk;
            });
            res.on('end', () => {
                const status = res.statusCode || 0;
                if (status < 200 || status >= 300) {
                    reject(new Error(`HTTP ${status} ${res.statusMessage || ''}`.trim()));
                    return;
                }
                resolve(buf);
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });

    const json = (() => {
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    })();

    if (!json || typeof json !== 'object') throw new Error('Invalid SiYuan response');
    if (json.code !== 0) throw new Error(json.msg || `SiYuan error code=${json.code}`);
    return json.data;
}

function clampLimitSql(sql) {
    if (typeof sql !== 'string') return '';
    const trimmed = sql.trim();
    if (!trimmed) return '';
    if (/\\blimit\\b/i.test(trimmed)) return trimmed;
    return `${trimmed} LIMIT 1000`;
}

function generateNodeId() {
    const d = new Date();
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let rand = '';
    for (let i = 0; i < 7; i += 1) {
        rand += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${stamp}-${rand}`;
}

async function tool_siyuan_sql_query(args) {
    const sql = clampLimitSql(args?.sql);
    if (!sql) throw new Error('缺少参数 sql');
    return await siyuanFetch('/api/query/sql', { stmt: sql });
}

async function tool_siyuan_get_block_content(args) {
    const id = String(args?.id || '').trim();
    const format = String(args?.format || 'markdown');
    if (!id) throw new Error('缺少参数 id');
    if (format === 'kramdown') {
        const data = await siyuanFetch('/api/block/getBlockKramdown', { id, mode: 'textmark' });
        return data?.kramdown || '';
    }
    const data = await siyuanFetch('/api/export/exportMdContent', {
        id,
        // align with plugin usage
        yfm: false,
        assets: false,
        merge: 2,
        ref: 0,
        pdf: false,
    });
    return data?.content || '';
}

async function tool_siyuan_insert_block(args) {
    assertWriteAllowed('siyuan_insert_block');
    const dataType = String(args?.dataType || 'markdown');
    const data = String(args?.data ?? '');
    const parentID = args?.parentID ? String(args.parentID) : undefined;
    const appendParentID = args?.appendParentID ? String(args.appendParentID) : undefined;
    const previousID = args?.previousID ? String(args.previousID) : undefined;
    const nextID = args?.nextID ? String(args.nextID) : undefined;

    if (!data) throw new Error('缺少参数 data');
    if (!parentID && !appendParentID && !previousID && !nextID) {
        throw new Error('必须至少指定一个位置参数：parentID、appendParentID、previousID 或 nextID');
    }

    if (appendParentID) {
        return await siyuanFetch('/api/block/appendBlock', {
            dataType,
            data,
            parentID: appendParentID,
        });
    }

    return await siyuanFetch('/api/block/insertBlock', {
        dataType,
        data,
        parentID,
        previousID,
        nextID,
    });
}

async function tool_siyuan_update_block(args) {
    assertWriteAllowed('siyuan_update_block');
    const dataType = String(args?.dataType || 'markdown');
    const data = String(args?.data ?? '');
    const id = String(args?.id || '').trim();
    if (!id) throw new Error('缺少参数 id');
    if (!data) throw new Error('缺少参数 data');
    return await siyuanFetch('/api/block/updateBlock', { dataType, data, id });
}

async function tool_siyuan_create_document(args) {
    assertWriteAllowed('siyuan_create_document');
    const notebook = String(args?.notebook || '').trim();
    const path = String(args?.path || '').trim();
    const markdown = String(args?.markdown ?? '');
    if (!notebook) throw new Error('缺少参数 notebook');
    if (!path) throw new Error('缺少参数 path');
    return await siyuanFetch('/api/filetree/createDocWithMd', { notebook, path, markdown });
}

async function tool_siyuan_list_notebooks() {
    return await siyuanFetch('/api/notebook/lsNotebooks', {});
}

async function tool_siyuan_create_notebook(args) {
    assertWriteAllowed('siyuan_create_notebook');
    const name = String(args?.name || '').trim();
    if (!name) throw new Error('缺少参数 name');
    return await siyuanFetch('/api/notebook/createNotebook', { name });
}

async function tool_siyuan_get_doc_tree(args) {
    const notebook = String(args?.notebook || '').trim();
    const startPath = String(args?.path || '/');
    const sort = args?.sortMode ?? 15;
    if (!notebook) throw new Error('缺少参数 notebook');

    async function listPath(p) {
        const res = await siyuanFetch('/api/filetree/listDocsByPath', {
            notebook,
            path: p,
            sort,
            showHidden: false,
            maxListCount: 10000,
        });
        return res?.files || [];
    }

    async function walk(p) {
        const files = await listPath(p);
        const nodes = [];
        for (const f of files) {
            const node = { ...f };
            if (f?.subFileCount > 0) {
                node.children = await walk(f.path);
            }
            nodes.push(node);
        }
        return nodes;
    }

    return await walk(startPath);
}

async function tool_siyuan_rename_document(args) {
    assertWriteAllowed('siyuan_rename_document');
    const id = String(args?.id || '').trim();
    const title = String(args?.title || '').trim();
    if (!id) throw new Error('缺少参数 id');
    if (!title) throw new Error('缺少参数 title');
    return await siyuanFetch('/api/filetree/renameDocByID', { id, title });
}

async function tool_siyuan_move_documents(args) {
    assertWriteAllowed('siyuan_move_documents');
    const fromIDs = Array.isArray(args?.fromIDs) ? args.fromIDs.map(String) : [];
    const toID = String(args?.toID || '').trim();
    if (fromIDs.length === 0) throw new Error('缺少参数 fromIDs');
    if (!toID) throw new Error('缺少参数 toID');
    return await siyuanFetch('/api/filetree/moveDocsByID', { fromIDs, toID });
}

async function tool_siyuan_get_block_attrs(args) {
    const id = String(args?.id || '').trim();
    if (!id) throw new Error('缺少参数 id');
    return await siyuanFetch('/api/attr/getBlockAttrs', { id });
}

async function tool_siyuan_set_block_attrs(args) {
    assertWriteAllowed('siyuan_set_block_attrs');
    const id = String(args?.id || '').trim();
    const attrs = args?.attrs;
    if (!id) throw new Error('缺少参数 id');
    if (!attrs || typeof attrs !== 'object') throw new Error('缺少参数 attrs');
    return await siyuanFetch('/api/attr/setBlockAttrs', { id, attrs });
}

async function tool_siyuan_database(args) {
    const operation = String(args?.operation || '').trim();
    if (!operation) throw new Error('缺少参数 operation');

    switch (operation) {
        case 'searchDatabase': {
            const keyword = String(args?.keyword || '').trim();
            const avID = args?.avID ? String(args.avID).trim() : '';
            if (!keyword) throw new Error('keyword参数是必需的');
            const payload = avID ? { keyword, avID } : { keyword };
            return await siyuanFetch('/api/av/searchAttributeView', payload);
        }
        case 'getColumns': {
            const avID = String(args?.avID || '').trim();
            if (!avID) throw new Error('avID参数是必需的');
            return await siyuanFetch('/api/av/getAttributeViewKeysByAvID', { avID });
        }
        case 'renderDatabase': {
            const avID = String(args?.avID || '').trim();
            const viewID = String(args?.viewID || '').trim();
            if (!avID || !viewID) throw new Error('avID和viewID参数是必需的');
            const pageSize = Number.isFinite(Number(args?.pageSize)) ? Number(args.pageSize) : 9999999;
            const page = Number.isFinite(Number(args?.page)) ? Number(args.page) : 1;
            return await siyuanFetch('/api/av/renderAttributeView', {
                id: avID,
                viewID,
                pageSize,
                page,
            });
        }
        case 'addDetachedRows': {
            assertWriteAllowed('siyuan_database.addDetachedRows');
            const avID = String(args?.avID || '').trim();
            const blocksValues = args?.blocksValues;
            if (!avID || !blocksValues) throw new Error('avID和blocksValues参数是必需的');
            return await siyuanFetch('/api/av/appendAttributeViewDetachedBlocksWithValues', {
                avID,
                blocksValues,
            });
        }
        case 'addBoundBlocks': {
            assertWriteAllowed('siyuan_database.addBoundBlocks');
            const avID = String(args?.avID || '').trim();
            const blockIDs = Array.isArray(args?.blockIDs) ? args.blockIDs.map((v) => String(v)) : [];
            const itemIDs = Array.isArray(args?.itemIDs) ? args.itemIDs.map((v) => String(v)) : [];
            if (!avID || blockIDs.length === 0) throw new Error('avID和blockIDs参数是必需的');
            const srcs = blockIDs.map((id, index) => ({
                id,
                isDetached: false,
                itemID: itemIDs[index] || id,
            }));
            return await siyuanFetch('/api/av/addAttributeViewBlocks', { avID, srcs });
        }
        case 'setAttribute': {
            assertWriteAllowed('siyuan_database.setAttribute');
            const avID = String(args?.avID || '').trim();
            const keyID = String(args?.keyID || '').trim();
            const itemID = String(args?.itemID || '').trim();
            const value = args?.value;
            if (!avID || !keyID || !itemID || !value) {
                throw new Error('avID、keyID、itemID和value参数是必需的');
            }
            return await siyuanFetch('/api/av/setAttributeViewBlockAttr', { avID, keyID, itemID, value });
        }
        case 'batchSetAttributes': {
            assertWriteAllowed('siyuan_database.batchSetAttributes');
            const avID = String(args?.avID || '').trim();
            const values = args?.values;
            if (!avID || !values) throw new Error('avID和values参数是必需的');
            return await siyuanFetch('/api/av/batchSetAttributeViewBlockAttrs', { avID, values });
        }
        case 'getDatabasesForBlock': {
            const blockID = String(args?.blockID || '').trim();
            if (!blockID) throw new Error('blockID参数是必需的');
            return await siyuanFetch('/api/av/getAttributeViewKeys', { id: blockID });
        }
        case 'getItemIDsByBlockIDs': {
            const avID = String(args?.avID || '').trim();
            const blockIDs = Array.isArray(args?.blockIDs) ? args.blockIDs.map((v) => String(v)) : [];
            if (!avID || blockIDs.length === 0) throw new Error('avID和blockIDs参数是必需的');
            return await siyuanFetch('/api/av/getAttributeViewItemIDsByBoundIDs', { avID, blockIDs });
        }
        case 'getBlockIDsByItemIDs': {
            const avID = String(args?.avID || '').trim();
            const itemIDs = Array.isArray(args?.itemIDs) ? args.itemIDs.map((v) => String(v)) : [];
            if (!avID || itemIDs.length === 0) throw new Error('avID和itemIDs参数是必需的');
            return await siyuanFetch('/api/av/getAttributeViewBoundBlockIDsByItemIDs', { avID, itemIDs });
        }
        case 'addColumn': {
            assertWriteAllowed('siyuan_database.addColumn');
            const avID = String(args?.avID || '').trim();
            const keyName = String(args?.keyName || '').trim();
            const keyType = String(args?.keyType || '').trim();
            const keyIcon = String(args?.keyIcon || '');
            const previousKeyID = String(args?.previousKeyID || '').trim();
            const keyID = String(args?.keyID || '').trim() || generateNodeId();
            if (!avID || !keyName || !keyType || !previousKeyID) {
                throw new Error('avID、keyName、keyType和previousKeyID参数是必需的');
            }
            return await siyuanFetch('/api/av/addAttributeViewKey', {
                avID,
                keyID,
                keyName,
                keyType,
                keyIcon,
                previousKeyID,
            });
        }
        case 'removeColumn': {
            assertWriteAllowed('siyuan_database.removeColumn');
            const avID = String(args?.avID || '').trim();
            const keyID = String(args?.keyID || '').trim();
            if (!avID || !keyID) throw new Error('avID和keyID参数是必需的');
            return await siyuanFetch('/api/av/removeAttributeViewKey', { avID, keyID });
        }
        case 'removeRows': {
            assertWriteAllowed('siyuan_database.removeRows');
            const avID = String(args?.avID || '').trim();
            const srcIDs = Array.isArray(args?.srcIDs) ? args.srcIDs.map((v) => String(v)) : [];
            if (!avID || srcIDs.length === 0) throw new Error('avID和srcIDs参数是必需的');
            return await siyuanFetch('/api/av/removeAttributeViewBlocks', { avID, srcIDs });
        }
        default:
            throw new Error(`未知的操作类型: ${operation}`);
    }
}

const TOOLS = [
    {
        name: 'siyuan_sql_query',
        description: '执行思源笔记 SQLite SQL 查询（建议带 LIMIT）。参数：{ sql }',
        inputSchema: {
            type: 'object',
            properties: { sql: { type: 'string' } },
            required: ['sql'],
        },
        handler: tool_siyuan_sql_query,
    },
    {
        name: 'siyuan_get_block_content',
        description: '获取块内容。参数：{ id, format: "markdown"|"kramdown" }',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                format: { type: 'string', enum: ['markdown', 'kramdown'] },
            },
            required: ['id'],
        },
        handler: tool_siyuan_get_block_content,
    },
    {
        name: 'siyuan_insert_block',
        description:
            '插入块。参数：{ dataType, data, parentID?, appendParentID?, previousID?, nextID? }',
        inputSchema: {
            type: 'object',
            properties: {
                dataType: { type: 'string', enum: ['markdown', 'dom'] },
                data: { type: 'string' },
                parentID: { type: 'string' },
                appendParentID: { type: 'string' },
                previousID: { type: 'string' },
                nextID: { type: 'string' },
            },
            required: ['data'],
        },
        handler: tool_siyuan_insert_block,
    },
    {
        name: 'siyuan_update_block',
        description: '更新块内容。参数：{ dataType, data, id }',
        inputSchema: {
            type: 'object',
            properties: {
                dataType: { type: 'string', enum: ['markdown', 'dom'] },
                data: { type: 'string' },
                id: { type: 'string' },
            },
            required: ['id', 'data'],
        },
        handler: tool_siyuan_update_block,
    },
    {
        name: 'siyuan_create_document',
        description: '创建文档。参数：{ notebook, path, markdown }',
        inputSchema: {
            type: 'object',
            properties: {
                notebook: { type: 'string' },
                path: { type: 'string' },
                markdown: { type: 'string' },
            },
            required: ['notebook', 'path', 'markdown'],
        },
        handler: tool_siyuan_create_document,
    },
    {
        name: 'siyuan_list_notebooks',
        description: '列出笔记本',
        inputSchema: { type: 'object', properties: {} },
        handler: tool_siyuan_list_notebooks,
    },
    {
        name: 'siyuan_create_notebook',
        description: '创建笔记本。参数：{ name }',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
        },
        handler: tool_siyuan_create_notebook,
    },
    {
        name: 'siyuan_get_doc_tree',
        description: '获取文档树。参数：{ notebook, path?, sortMode? }',
        inputSchema: {
            type: 'object',
            properties: {
                notebook: { type: 'string' },
                path: { type: 'string' },
                sortMode: { type: 'number' },
            },
            required: ['notebook'],
        },
        handler: tool_siyuan_get_doc_tree,
    },
    {
        name: 'siyuan_rename_document',
        description: '重命名文档。参数：{ id, title }',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' } },
            required: ['id', 'title'],
        },
        handler: tool_siyuan_rename_document,
    },
    {
        name: 'siyuan_move_documents',
        description: '移动文档。参数：{ fromIDs: string[], toID: string }',
        inputSchema: {
            type: 'object',
            properties: {
                fromIDs: { type: 'array', items: { type: 'string' } },
                toID: { type: 'string' },
            },
            required: ['fromIDs', 'toID'],
        },
        handler: tool_siyuan_move_documents,
    },
    {
        name: 'siyuan_get_block_attrs',
        description: '获取块属性。参数：{ id }',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
        handler: tool_siyuan_get_block_attrs,
    },
    {
        name: 'siyuan_set_block_attrs',
        description: '设置块属性。参数：{ id, attrs }',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                attrs: { type: 'object' },
            },
            required: ['id', 'attrs'],
        },
        handler: tool_siyuan_set_block_attrs,
    },
    {
        name: 'siyuan_database',
        description:
            '思源数据库操作。参数：{ operation, ... }，支持 searchDatabase/getColumns/renderDatabase/addDetachedRows/addBoundBlocks/setAttribute/batchSetAttributes/getDatabasesForBlock/getItemIDsByBlockIDs/getBlockIDsByItemIDs/addColumn/removeColumn/removeRows',
        inputSchema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: [
                        'searchDatabase',
                        'getColumns',
                        'renderDatabase',
                        'addDetachedRows',
                        'addBoundBlocks',
                        'setAttribute',
                        'batchSetAttributes',
                        'getDatabasesForBlock',
                        'getItemIDsByBlockIDs',
                        'getBlockIDsByItemIDs',
                        'addColumn',
                        'removeColumn',
                        'removeRows',
                    ],
                },
                keyword: { type: 'string' },
                avID: { type: 'string' },
                viewID: { type: 'string' },
                pageSize: { type: 'number' },
                page: { type: 'number' },
                blocksValues: { type: 'array' },
                blockIDs: { type: 'array', items: { type: 'string' } },
                itemIDs: { type: 'array', items: { type: 'string' } },
                keyID: { type: 'string' },
                itemID: { type: 'string' },
                value: { type: 'object' },
                values: { type: 'array' },
                blockID: { type: 'string' },
                keyName: { type: 'string' },
                keyType: { type: 'string' },
                keyIcon: { type: 'string' },
                previousKeyID: { type: 'string' },
                srcIDs: { type: 'array', items: { type: 'string' } },
            },
            required: ['operation'],
        },
        handler: tool_siyuan_database,
    },
];

function listToolsResult() {
    return {
        tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    };
}

async function callToolResult(params) {
    const name = params?.name;
    const args = params?.arguments || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
        return toolError(`Unknown tool: ${name}`);
    }
    try {
        const result = await tool.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
        return toolError((e && e.message) ? e.message : String(e));
    }
}

async function handleRequest(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
        const protocolVersion = params?.protocolVersion || '2024-11-05';
        return sendResult(id, {
            protocolVersion,
            serverInfo: { name: 'siyuan-mcp', version: '0.1.0' },
            capabilities: { tools: {} },
        });
    }

    if (method === 'ping') {
        return sendResult(id, {});
    }

    if (method === 'tools/list') {
        return sendResult(id, listToolsResult());
    }

    if (method === 'tools/call') {
        const result = await callToolResult(params);
        return sendResult(id, result);
    }

    // Optional methods (return empty)
    if (method === 'resources/list') return sendResult(id, { resources: [] });
    if (method === 'prompts/list') return sendResult(id, { prompts: [] });

    return sendError(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();

rl.on('line', (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    chain = chain
        .then(async () => {
            let msg;
            try {
                msg = JSON.parse(trimmed);
            } catch (e) {
                console.error('Invalid JSON:', e);
                return;
            }
            if (!msg || msg.jsonrpc !== '2.0' || !msg.method) return;
            if (msg.id === undefined || msg.id === null) {
                // notification: ignore
                return;
            }
            await handleRequest(msg);
        })
        .catch((e) => {
            console.error('Unhandled error:', e);
        });
});

rl.on('close', () => {
    process.exit(0);
});
