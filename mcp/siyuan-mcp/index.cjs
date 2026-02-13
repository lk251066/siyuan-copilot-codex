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
// - siyuan_import_image_urls
// - siyuan_extract_page_images
// - siyuan_capture_webpage_screenshot
// - siyuan_insert_images_to_note

const readline = require('node:readline');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const path = require('node:path');
const crypto = require('node:crypto');

const SIYUAN_API_URL = (process.env.SIYUAN_API_URL || 'http://127.0.0.1:6806').replace(/\/+$/, '');
const SIYUAN_API_TOKEN = process.env.SIYUAN_API_TOKEN || '';
const SIYUAN_MCP_READ_ONLY = (() => {
    const raw = String(process.env.SIYUAN_MCP_READ_ONLY || '1').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();
const DEFAULT_IMAGE_LIMIT = 12;
const MAX_IMAGE_BYTES = Number.parseInt(process.env.SIYUAN_MCP_MAX_IMAGE_BYTES || '', 10) || 15 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.SIYUAN_MCP_REMOTE_TIMEOUT_MS || '', 10) || 30000;
const REMOTE_USER_AGENT =
    process.env.SIYUAN_MCP_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

function stripKramdownIdMarkers(markdown) {
    return String(markdown || '').replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();
}

async function getBlockKramdownById(id) {
    const data = await siyuanFetch('/api/block/getBlockKramdown', { id, mode: 'textmark' });
    return data?.kramdown || '';
}

async function getBlockMarkdownById(id) {
    const data = await siyuanFetch('/api/export/exportMdContent', {
        id,
        yfm: false,
        assets: false,
        merge: 2,
        ref: 0,
        pdf: false,
    });
    return data?.content || '';
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

function sqlQuote(raw) {
    return String(raw || '').replace(/'/g, "''");
}

function sanitizeFileName(name) {
    const trimmed = String(name || '').trim();
    const safe = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, ' ');
    const normalized = safe.replace(/\.+$/g, '').slice(0, 120);
    return normalized || `image-${Date.now()}`;
}

function guessExtensionFromMime(mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (!mime) return '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('bmp')) return 'bmp';
    if (mime.includes('svg')) return 'svg';
    if (mime.includes('avif')) return 'avif';
    return '';
}

function guessMimeTypeFromName(fileName) {
    const ext = path.extname(String(fileName || '')).toLowerCase().replace('.', '');
    if (!ext) return 'application/octet-stream';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'avif') return 'image/avif';
    return 'application/octet-stream';
}

function ensureFileExt(fileName, mimeType) {
    const base = sanitizeFileName(fileName);
    const currentExt = path.extname(base).replace('.', '').toLowerCase();
    if (currentExt) return base;
    const inferredExt = guessExtensionFromMime(mimeType) || 'png';
    return `${base}.${inferredExt}`;
}

function normalizeAssetPath(assetPath) {
    const raw = String(assetPath || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/')) return raw;
    return `/${raw}`;
}

function normalizeDocFilePath(box, docPath) {
    const notebook = String(box || '').trim();
    const p = String(docPath || '').trim().replace(/^\/+/, '');
    if (!notebook || !p) return '';
    return `${notebook}/${p}`;
}

function normalizeDocDisplayPath(box, hpath) {
    const notebook = String(box || '').trim();
    const p = String(hpath || '').trim().replace(/^\/+/, '');
    if (!notebook || !p) return '';
    return `${notebook}/${p}`;
}

function isLikelyPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase().trim();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.local')) return true;
    if (host === '0.0.0.0') return true;
    if (host === '::1') return true;
    if (/^127\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    const m172 = host.match(/^172\.(\d{1,3})\./);
    if (m172) {
        const second = Number.parseInt(m172[1], 10);
        if (second >= 16 && second <= 31) return true;
    }
    return false;
}

function validateRemoteUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        throw new Error(`无效 URL: ${rawUrl}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`仅支持 http/https URL: ${rawUrl}`);
    }
    if (isLikelyPrivateHost(parsed.hostname)) {
        throw new Error(`出于安全限制，不允许访问内网地址: ${parsed.hostname}`);
    }
    return parsed;
}

function resolveAbsoluteUrl(baseUrl, candidate) {
    const raw = String(candidate || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:')) return '';
    if (raw.startsWith('//')) {
        const base = new URL(baseUrl);
        return `${base.protocol}${raw}`;
    }
    try {
        return new URL(raw, baseUrl).href;
    } catch {
        return '';
    }
}

async function httpRequestRaw(params) {
    const targetUrl = params?.url;
    const method = String(params?.method || 'GET').toUpperCase();
    const headers = { ...(params?.headers || {}) };
    const body = params?.body;
    const redirects = Number.isFinite(params?.redirects) ? Number(params.redirects) : 3;
    const timeoutMs = Number.isFinite(params?.timeoutMs)
        ? Number(params.timeoutMs)
        : REMOTE_FETCH_TIMEOUT_MS;
    if (!targetUrl) throw new Error('缺少请求 URL');
    const url = new URL(targetUrl);
    const useHttps = url.protocol === 'https:';
    const mod = useHttps ? https : http;

    return await new Promise((resolve, reject) => {
        const req = mod.request(
            {
                method,
                hostname: url.hostname,
                port: url.port ? Number(url.port) : useHttps ? 443 : 80,
                path: `${url.pathname}${url.search}`,
                headers,
            },
            (res) => {
                const status = res.statusCode || 0;
                const location = res.headers?.location;
                if (
                    [301, 302, 303, 307, 308].includes(status) &&
                    location &&
                    redirects > 0
                ) {
                    const nextUrl = new URL(location, targetUrl).href;
                    res.resume();
                    httpRequestRaw({
                        ...params,
                        url: nextUrl,
                        redirects: redirects - 1,
                        method: status === 303 ? 'GET' : method,
                        body: status === 303 ? undefined : body,
                    })
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                const chunks = [];
                let total = 0;
                res.on('data', (chunk) => {
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    chunks.push(buf);
                    total += buf.length;
                    if (total > MAX_IMAGE_BYTES + 1024 * 1024) {
                        req.destroy(new Error(`响应过大，超过限制 ${MAX_IMAGE_BYTES} bytes`));
                    }
                });
                res.on('end', () => {
                    resolve({
                        statusCode: status,
                        headers: res.headers || {},
                        body: Buffer.concat(chunks),
                    });
                });
            }
        );
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`请求超时（${timeoutMs}ms）`));
        });
        if (body) req.write(body);
        req.end();
    });
}

async function fetchRemoteText(url) {
    const res = await httpRequestRaw({
        url,
        method: 'GET',
        headers: {
            'User-Agent': REMOTE_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirects: 4,
    });
    const status = Number(res.statusCode || 0);
    if (status < 200 || status >= 300) {
        throw new Error(`拉取网页失败: HTTP ${status}`);
    }
    return String(res.body || Buffer.alloc(0)).toString('utf8');
}

async function fetchRemoteBinary(url) {
    const parsed = validateRemoteUrl(url);
    const res = await httpRequestRaw({
        url: parsed.href,
        method: 'GET',
        headers: {
            'User-Agent': REMOTE_USER_AGENT,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            Referer: `${parsed.protocol}//${parsed.host}/`,
        },
        redirects: 4,
    });
    const status = Number(res.statusCode || 0);
    if (status < 200 || status >= 300) {
        throw new Error(`下载图片失败: HTTP ${status}`);
    }
    const body = Buffer.from(res.body || Buffer.alloc(0));
    if (!body.length) throw new Error('下载图片失败：空响应');
    if (body.length > MAX_IMAGE_BYTES) {
        throw new Error(`图片过大，超过限制 ${MAX_IMAGE_BYTES} bytes`);
    }
    const contentType = String(res.headers?.['content-type'] || '').split(';')[0].trim();
    return { body, contentType };
}

function extractImageUrlsFromHtml(pageUrl, html, limit) {
    const collected = [];
    const seen = new Set();
    const pushCandidate = (raw) => {
        const absolute = resolveAbsoluteUrl(pageUrl, raw);
        if (!absolute) return;
        try {
            const parsed = validateRemoteUrl(absolute);
            const href = parsed.href;
            if (seen.has(href)) return;
            seen.add(href);
            collected.push(href);
        } catch {
            // ignore invalid/private urls
        }
    };

    const metaRegex =
        /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image(?::src)?)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let metaMatch;
    while ((metaMatch = metaRegex.exec(html)) !== null) {
        pushCandidate(metaMatch[1]);
    }

    const imgTagRegex = /<img\b[^>]*>/gi;
    let imgTagMatch;
    while ((imgTagMatch = imgTagRegex.exec(html)) !== null) {
        const tag = imgTagMatch[0];
        const srcSetMatch = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
        if (srcSetMatch?.[1]) {
            const srcSetFirst = srcSetMatch[1].split(',')[0]?.trim()?.split(/\s+/)[0];
            if (srcSetFirst) pushCandidate(srcSetFirst);
        }
        const attrMatch =
            tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) ||
            tag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i) ||
            tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (attrMatch?.[1]) pushCandidate(attrMatch[1]);
    }

    const max = Number.isFinite(limit) ? Math.max(1, Math.min(Number(limit), 50)) : DEFAULT_IMAGE_LIMIT;
    return collected.slice(0, max);
}

function buildImageMarkdown(assets, altPrefix = 'image') {
    const lines = [];
    for (let i = 0; i < assets.length; i += 1) {
        const asset = assets[i];
        const pathText = normalizeAssetPath(asset?.assetPath || asset?.path || '');
        if (!pathText) continue;
        const alt = String(asset?.alt || `${altPrefix} ${i + 1}`).trim();
        lines.push(`![${alt}](${pathText})`);
    }
    return lines.join('\n\n');
}

async function uploadImageBufferToSiyuan({ fileName, mimeType, fileBuffer, assetsDirPath = '' }) {
    const finalName = ensureFileExt(fileName, mimeType);
    const finalMime = String(mimeType || '').trim() || guessMimeTypeFromName(finalName);
    const boundary = `----siyuan-mcp-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

    const head = Buffer.from(
        `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="assetsDirPath"\r\n\r\n` +
            `${String(assetsDirPath || '')}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file[]"; filename="${finalName}"\r\n` +
            `Content-Type: ${finalMime}\r\n\r\n`,
        'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const payload = Buffer.concat([head, fileBuffer, tail]);

    const url = new URL(`${SIYUAN_API_URL}/api/asset/upload`);
    const useHttps = url.protocol === 'https:';
    const mod = useHttps ? https : http;
    const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
    };
    if (SIYUAN_API_TOKEN) headers.Authorization = `Token ${SIYUAN_API_TOKEN}`;

    const responseText = await new Promise((resolve, reject) => {
        const req = mod.request(
            {
                method: 'POST',
                hostname: url.hostname,
                port: url.port ? Number(url.port) : useHttps ? 443 : 80,
                path: `${url.pathname}${url.search}`,
                headers,
            },
            (res) => {
                const status = res.statusCode || 0;
                const chunks = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    if (status < 200 || status >= 300) {
                        reject(new Error(`上传图片失败 HTTP ${status}`));
                        return;
                    }
                    resolve(raw);
                });
            }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });

    let json;
    try {
        json = JSON.parse(responseText);
    } catch {
        throw new Error('上传图片失败：返回非 JSON 数据');
    }
    if (!json || typeof json !== 'object' || json.code !== 0) {
        throw new Error(json?.msg || '上传图片失败');
    }
    const data = json.data || {};
    const succMap = data.succMap && typeof data.succMap === 'object' ? data.succMap : {};
    const firstPath = Object.values(succMap)[0];
    if (!firstPath) throw new Error('上传图片失败：未返回资源路径');
    return {
        assetPath: normalizeAssetPath(String(firstPath)),
        rawData: data,
    };
}

async function resolveDocInfoByBlockId(blockId) {
    const id = String(blockId || '').trim();
    if (!id) throw new Error('缺少 noteBlockId');
    const rows = await siyuanFetch('/api/query/sql', {
        stmt: `select id, type, root_id, box, path, hpath, content from blocks where id='${sqlQuote(id)}' limit 1`,
    });
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`块不存在: ${id}`);
    }
    const block = rows[0];
    const docId = String(block.type || '').toLowerCase() === 'd' ? String(block.id || '') : String(block.root_id || '');
    if (!docId) throw new Error(`无法解析文档ID: ${id}`);
    if (docId === String(block.id || '')) {
        return {
            docId,
            box: String(block.box || ''),
            path: String(block.path || ''),
            hpath: String(block.hpath || ''),
            title: String(block.content || ''),
        };
    }
    const docs = await siyuanFetch('/api/query/sql', {
        stmt: `select id, box, path, hpath, content from blocks where id='${sqlQuote(docId)}' limit 1`,
    });
    const doc = Array.isArray(docs) && docs[0] ? docs[0] : {};
    return {
        docId,
        box: String(doc.box || block.box || ''),
        path: String(doc.path || block.path || ''),
        hpath: String(doc.hpath || block.hpath || ''),
        title: String(doc.content || ''),
    };
}

async function insertAssetsToNote(params) {
    const noteBlockId = String(params?.noteBlockId || '').trim();
    if (!noteBlockId) throw new Error('缺少参数 noteBlockId');
    const assets = Array.isArray(params?.assets) ? params.assets : [];
    if (!assets.length) throw new Error('缺少参数 assets');
    const mode = String(params?.mode || 'append').toLowerCase() === 'prepend' ? 'prepend' : 'append';
    const altPrefix = String(params?.altPrefix || 'image').trim() || 'image';

    const docInfo = await resolveDocInfoByBlockId(noteBlockId);
    const oldContent = await getBlockKramdownById(docInfo.docId);
    const oldContentForDisplay = await getBlockMarkdownById(docInfo.docId);
    const imageMarkdown = buildImageMarkdown(assets, altPrefix);
    if (!imageMarkdown.trim()) throw new Error('无可写入的图片资源');

    const result =
        mode === 'prepend'
            ? await siyuanFetch('/api/block/prependBlock', {
                  dataType: 'markdown',
                  data: imageMarkdown,
                  parentID: docInfo.docId,
              })
            : await siyuanFetch('/api/block/appendBlock', {
                  dataType: 'markdown',
                  data: imageMarkdown,
                  parentID: docInfo.docId,
              });

    const newContent = await getBlockKramdownById(docInfo.docId);
    const newContentForDisplay = await getBlockMarkdownById(docInfo.docId);
    const filePath =
        normalizeDocDisplayPath(docInfo.box, docInfo.hpath) ||
        normalizeDocFilePath(docInfo.box, docInfo.path) ||
        docInfo.docId;

    const operation = {
        kind: 'note_image_insert',
        operationType: 'update',
        blockId: docInfo.docId,
        filePath,
        oldContent,
        oldContentForDisplay,
        newContent,
        newContentForDisplay,
        status: 'applied',
    };

    return {
        note: {
            docId: docInfo.docId,
            title: docInfo.title || path.basename(filePath || docInfo.docId),
            filePath,
        },
        imageMarkdown,
        result,
        operation,
    };
}

async function importImageFromUrl(params) {
    const sourceUrl = String(params?.url || '').trim();
    if (!sourceUrl) throw new Error('缺少图片 URL');
    const urlObj = validateRemoteUrl(sourceUrl);
    const downloaded = await fetchRemoteBinary(urlObj.href);
    const mimeType =
        String(params?.mimeType || '').trim() ||
        String(downloaded.contentType || '').trim() ||
        guessMimeTypeFromName(urlObj.pathname);
    const rawName = params?.fileName
        ? String(params.fileName)
        : decodeURIComponent(path.basename(urlObj.pathname || '') || `image-${Date.now()}`);
    const finalName = ensureFileExt(rawName, mimeType);
    const uploaded = await uploadImageBufferToSiyuan({
        fileName: finalName,
        mimeType,
        fileBuffer: downloaded.body,
        assetsDirPath: String(params?.assetsDirPath || ''),
    });
    return {
        sourceUrl: urlObj.href,
        fileName: finalName,
        mimeType: mimeType || guessMimeTypeFromName(finalName),
        size: downloaded.body.length,
        sha256: crypto.createHash('sha256').update(downloaded.body).digest('hex'),
        assetPath: uploaded.assetPath,
        uploadedRaw: uploaded.rawData,
    };
}

function normalizeUrlsInput(args) {
    if (Array.isArray(args?.urls)) {
        return args.urls.map((u) => String(u || '').trim()).filter(Boolean);
    }
    if (typeof args?.url === 'string' && args.url.trim()) {
        return [args.url.trim()];
    }
    return [];
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
        return await getBlockKramdownById(id);
    }
    return await getBlockMarkdownById(id);
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

    let result;
    if (appendParentID) {
        result = await siyuanFetch('/api/block/appendBlock', {
            dataType,
            data,
            parentID: appendParentID,
        });
    } else {
        result = await siyuanFetch('/api/block/insertBlock', {
            dataType,
            data,
            parentID,
            previousID,
            nextID,
        });
    }

    // Return a normalized operation payload for downstream diff UI.
    const referenceBlockId =
        String(nextID || previousID || parentID || appendParentID || '').trim() || 'unknown';
    const position = nextID ? 'before' : 'after';
    const operation = {
        kind: 'block_insert',
        operationType: 'insert',
        blockId: referenceBlockId,
        position,
        oldContent: '',
        oldContentForDisplay: '',
        newContent: data,
        newContentForDisplay: stripKramdownIdMarkers(data),
        status: 'applied',
    };

    return {
        ok: true,
        tool: 'siyuan_insert_block',
        operation,
        result,
    };
}

async function tool_siyuan_update_block(args) {
    assertWriteAllowed('siyuan_update_block');
    const dataType = String(args?.dataType || 'markdown');
    const data = String(args?.data ?? '');
    const id = String(args?.id || '').trim();
    if (!id) throw new Error('缺少参数 id');
    if (!data) throw new Error('缺少参数 data');

    let oldContent = '';
    let oldContentForDisplay = '';
    try {
        oldContent = await getBlockKramdownById(id);
    } catch {
        oldContent = '';
    }
    try {
        oldContentForDisplay = await getBlockMarkdownById(id);
    } catch {
        oldContentForDisplay = '';
    }

    const result = await siyuanFetch('/api/block/updateBlock', { dataType, data, id });

    const operation = {
        kind: 'block_update',
        operationType: 'update',
        blockId: id,
        oldContent,
        oldContentForDisplay,
        newContent: data,
        newContentForDisplay: stripKramdownIdMarkers(data),
        status: 'applied',
    };

    return {
        ok: true,
        tool: 'siyuan_update_block',
        operation,
        result,
    };
}

async function tool_siyuan_create_document(args) {
    assertWriteAllowed('siyuan_create_document');
    const notebook = String(args?.notebook || '').trim();
    const path = String(args?.path || '').trim();
    const markdown = String(args?.markdown ?? '');
    if (!notebook) throw new Error('缺少参数 notebook');
    if (!path) throw new Error('缺少参数 path');
    const result = await siyuanFetch('/api/filetree/createDocWithMd', { notebook, path, markdown });
    const operation = {
        kind: 'document_create',
        operationType: 'insert',
        blockId: `${notebook}:${path}`,
        position: 'after',
        oldContent: '',
        oldContentForDisplay: '',
        newContent: markdown,
        newContentForDisplay: stripKramdownIdMarkers(markdown),
        status: 'applied',
    };
    return {
        ok: true,
        tool: 'siyuan_create_document',
        operation,
        result,
    };
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

async function tool_siyuan_import_image_urls(args) {
    assertWriteAllowed('siyuan_import_image_urls');
    const urls = normalizeUrlsInput(args);
    if (!urls.length) throw new Error('缺少参数 urls 或 url');
    const limit = Number.isFinite(Number(args?.limit))
        ? Math.max(1, Math.min(Number(args.limit), 30))
        : DEFAULT_IMAGE_LIMIT;
    const selected = urls.slice(0, limit);
    const imported = [];
    for (const url of selected) {
        imported.push(
            await importImageFromUrl({
                url,
                fileName: args?.fileName,
                assetsDirPath: args?.assetsDirPath,
            })
        );
    }

    const noteBlockId = String(args?.noteBlockId || '').trim();
    if (!noteBlockId) {
        return {
            ok: true,
            tool: 'siyuan_import_image_urls',
            count: imported.length,
            assets: imported,
        };
    }

    const inserted = await insertAssetsToNote({
        noteBlockId,
        assets: imported,
        mode: args?.mode,
        altPrefix: args?.altPrefix,
    });
    return {
        ok: true,
        tool: 'siyuan_import_image_urls',
        count: imported.length,
        assets: imported,
        note: inserted.note,
        operation: inserted.operation,
        result: inserted.result,
        imageMarkdown: inserted.imageMarkdown,
    };
}

async function tool_siyuan_extract_page_images(args) {
    const pageUrl = String(args?.url || '').trim();
    if (!pageUrl) throw new Error('缺少参数 url');
    const download = args?.download !== false;
    const noteBlockId = String(args?.noteBlockId || '').trim();
    const limit = Number.isFinite(Number(args?.limit))
        ? Math.max(1, Math.min(Number(args.limit), 50))
        : DEFAULT_IMAGE_LIMIT;

    const page = validateRemoteUrl(pageUrl);
    const html = await fetchRemoteText(page.href);
    const imageUrls = extractImageUrlsFromHtml(page.href, html, limit);
    if (!download) {
        return {
            ok: true,
            tool: 'siyuan_extract_page_images',
            url: page.href,
            count: imageUrls.length,
            imageUrls,
        };
    }

    assertWriteAllowed('siyuan_extract_page_images');
    const imported = [];
    for (const imageUrl of imageUrls) {
        try {
            imported.push(
                await importImageFromUrl({
                    url: imageUrl,
                    assetsDirPath: args?.assetsDirPath,
                })
            );
        } catch (err) {
            imported.push({
                sourceUrl: imageUrl,
                error: err && err.message ? err.message : String(err),
            });
        }
    }
    const successAssets = imported.filter((item) => item && item.assetPath);

    if (!noteBlockId) {
        return {
            ok: true,
            tool: 'siyuan_extract_page_images',
            url: page.href,
            count: successAssets.length,
            assets: successAssets,
            failures: imported.filter((item) => item && item.error),
        };
    }

    if (!successAssets.length) {
        throw new Error('页面图片抓取完成，但无可写入的图片资源');
    }

    const inserted = await insertAssetsToNote({
        noteBlockId,
        assets: successAssets,
        mode: args?.mode,
        altPrefix: args?.altPrefix,
    });
    return {
        ok: true,
        tool: 'siyuan_extract_page_images',
        url: page.href,
        count: successAssets.length,
        assets: successAssets,
        failures: imported.filter((item) => item && item.error),
        note: inserted.note,
        operation: inserted.operation,
        result: inserted.result,
        imageMarkdown: inserted.imageMarkdown,
    };
}

async function tool_siyuan_capture_webpage_screenshot(args) {
    assertWriteAllowed('siyuan_capture_webpage_screenshot');
    const pageUrl = String(args?.url || '').trim();
    if (!pageUrl) throw new Error('缺少参数 url');
    const page = validateRemoteUrl(pageUrl);
    const width = Number.isFinite(Number(args?.width))
        ? Math.max(320, Math.min(Number(args.width), 2560))
        : 1440;
    const fullPage = args?.fullPage !== false;

    const candidates = [
        `https://s.wordpress.com/mshots/v1/${encodeURIComponent(page.href)}?w=${width}`,
        fullPage
            ? `https://image.thum.io/get/fullpage/${encodeURIComponent(page.href)}`
            : `https://image.thum.io/get/width/${width}/${encodeURIComponent(page.href)}`,
    ];

    let imported = null;
    let lastErr = null;
    for (const candidate of candidates) {
        try {
            imported = await importImageFromUrl({
                url: candidate,
                fileName: `screenshot-${Date.now()}.png`,
                assetsDirPath: args?.assetsDirPath,
            });
            imported.sourcePage = page.href;
            imported.captureProviderUrl = candidate;
            break;
        } catch (err) {
            lastErr = err;
        }
    }
    if (!imported) {
        throw new Error(
            `页面截图失败: ${lastErr && lastErr.message ? lastErr.message : String(lastErr)}`
        );
    }

    const noteBlockId = String(args?.noteBlockId || '').trim();
    if (!noteBlockId) {
        return {
            ok: true,
            tool: 'siyuan_capture_webpage_screenshot',
            url: page.href,
            asset: imported,
        };
    }

    const inserted = await insertAssetsToNote({
        noteBlockId,
        assets: [imported],
        mode: args?.mode,
        altPrefix: args?.altPrefix || 'screenshot',
    });
    return {
        ok: true,
        tool: 'siyuan_capture_webpage_screenshot',
        url: page.href,
        asset: imported,
        note: inserted.note,
        operation: inserted.operation,
        result: inserted.result,
        imageMarkdown: inserted.imageMarkdown,
    };
}

async function tool_siyuan_insert_images_to_note(args) {
    assertWriteAllowed('siyuan_insert_images_to_note');
    const noteBlockId = String(args?.noteBlockId || '').trim();
    if (!noteBlockId) throw new Error('缺少参数 noteBlockId');
    const sourceAssets = Array.isArray(args?.assets) ? args.assets : [];
    if (!sourceAssets.length) throw new Error('缺少参数 assets');

    const normalizedAssets = sourceAssets
        .map((item, index) => {
            if (typeof item === 'string') {
                return {
                    assetPath: normalizeAssetPath(item),
                    alt: `image ${index + 1}`,
                };
            }
            if (!item || typeof item !== 'object') return null;
            const p = normalizeAssetPath(item.assetPath || item.path || '');
            if (!p) return null;
            return {
                assetPath: p,
                alt: String(item.alt || '').trim() || `image ${index + 1}`,
            };
        })
        .filter(Boolean);
    if (!normalizedAssets.length) throw new Error('assets 中没有有效图片路径');

    const inserted = await insertAssetsToNote({
        noteBlockId,
        assets: normalizedAssets,
        mode: args?.mode,
        altPrefix: args?.altPrefix,
    });
    return {
        ok: true,
        tool: 'siyuan_insert_images_to_note',
        count: normalizedAssets.length,
        assets: normalizedAssets,
        note: inserted.note,
        operation: inserted.operation,
        result: inserted.result,
        imageMarkdown: inserted.imageMarkdown,
    };
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
        name: 'siyuan_import_image_urls',
        description:
            '下载图片 URL 并导入思源资源，可选直接写入笔记。参数：{ urls|string, limit?, noteBlockId?, mode?, altPrefix?, assetsDirPath? }',
        inputSchema: {
            type: 'object',
            properties: {
                urls: { type: 'array', items: { type: 'string' } },
                url: { type: 'string' },
                limit: { type: 'number' },
                noteBlockId: { type: 'string' },
                mode: { type: 'string', enum: ['append', 'prepend'] },
                altPrefix: { type: 'string' },
                assetsDirPath: { type: 'string' },
            },
        },
        handler: tool_siyuan_import_image_urls,
    },
    {
        name: 'siyuan_extract_page_images',
        description:
            '抓取网页图片（og:image/img/srcset），可只返回URL或直接下载并写入笔记。参数：{ url, download?, limit?, noteBlockId?, mode?, altPrefix?, assetsDirPath? }',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                download: { type: 'boolean' },
                limit: { type: 'number' },
                noteBlockId: { type: 'string' },
                mode: { type: 'string', enum: ['append', 'prepend'] },
                altPrefix: { type: 'string' },
                assetsDirPath: { type: 'string' },
            },
            required: ['url'],
        },
        handler: tool_siyuan_extract_page_images,
    },
    {
        name: 'siyuan_capture_webpage_screenshot',
        description:
            '对网页做远程截图并导入思源资源，可选直接写入笔记。参数：{ url, width?, fullPage?, noteBlockId?, mode?, altPrefix?, assetsDirPath? }',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                width: { type: 'number' },
                fullPage: { type: 'boolean' },
                noteBlockId: { type: 'string' },
                mode: { type: 'string', enum: ['append', 'prepend'] },
                altPrefix: { type: 'string' },
                assetsDirPath: { type: 'string' },
            },
            required: ['url'],
        },
        handler: tool_siyuan_capture_webpage_screenshot,
    },
    {
        name: 'siyuan_insert_images_to_note',
        description:
            '将已有图片资源路径写入笔记。参数：{ noteBlockId, assets, mode?, altPrefix? }，assets 支持 string[] 或 {assetPath|path, alt}[]',
        inputSchema: {
            type: 'object',
            properties: {
                noteBlockId: { type: 'string' },
                assets: {
                    type: 'array',
                    items: {
                        anyOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                properties: {
                                    assetPath: { type: 'string' },
                                    path: { type: 'string' },
                                    alt: { type: 'string' },
                                },
                            },
                        ],
                    },
                },
                mode: { type: 'string', enum: ['append', 'prepend'] },
                altPrefix: { type: 'string' },
            },
            required: ['noteBlockId', 'assets'],
        },
        handler: tool_siyuan_insert_images_to_note,
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
