<script lang="ts">
    import { afterUpdate, onDestroy, onMount, tick } from 'svelte';
    import {
        chat,
        type Message,
        type MessageAttachment,
        type EditOperation,
        type ToolCall,
        type ContextDocument,
        type ThinkingEffort,
        type CodexTraceCall,
        isSupportedThinkingGeminiModel,
        isSupportedThinkingClaudeModel,
        isGemini3Model,
    } from './ai-chat';
    import type { MessageContent } from './ai-chat';
    import { getActiveEditor } from 'siyuan';
    import {
        refreshSql,
        pushMsg,
        pushErrMsg,
        sql,
        exportMdContent,
        openBlock,
        updateBlock,
        insertBlock,
        getBlockDOM,
        getBlockKramdown,
        getBlockByID,
        getFileBlob,
        putFile,
        removeFile,
    } from './api';
    import { saveAsset, loadAsset, base64ToBlob, readAssetAsText } from './utils/assets';
    import { parseMultipleWebPages } from './utils/webParser';
    import SessionManager from './components/SessionManager.svelte';
    import ToolSelector, { type ToolConfig } from './components/ToolSelector.svelte';
    import {
        getDefaultSettings,
        mergeSettingsWithDefaults,
        type ProviderConfig,
    } from './defaultSettings';
    import { settingsStore } from './stores/settings';
    import {
        parseUnifiedDiffToLines,
        runGitCommand,
        runGitDiffNoIndex,
        type GitDiffLine,
    } from './codex/git-runner';
    import { confirm, Constants } from 'siyuan';
    import { t } from './utils/i18n';
    import { AVAILABLE_TOOLS, executeToolCall } from './tools';
    import {
        runCodexExec,
        type CodexExecEvent,
        getDefaultSiyuanMcpScriptPath,
    } from './codex/codex-runner';
    import { fetchCodexModels } from './codex/codex-models';
    import { buildWorkspaceSkillsPrompt } from './codex/workspace-skills';

    export let plugin: any;
    export let initialMessage: string = ''; // 初始消息
    export let mode: 'sidebar' | 'dialog' = 'sidebar'; // 使用模式：sidebar或dialog
    export let addChatContextEvent: string = 'siyuan-copilot-codex:add-chat-context';
    const addChatContextHandledRequests = new Set<string>();

    type AddChatContextEventDetail =
        | {
              kind: 'selection';
              requestId: string;
              markdown: string;
              plainText?: string;
              source?: string;
          }
        | {
              kind: 'doc';
              requestId: string;
              docId: string;
              source?: string;
          }
        | {
              kind: 'block';
              requestId: string;
              blockId: string;
              source?: string;
          };

    interface ChatSession {
        id: string;
        title: string;
        messages?: Message[]; // 可选，元数据模式下不包含消息
        createdAt: number;
        updatedAt: number;
        messageCount?: number; // 消息数量
        pinned?: boolean; // 是否钉住
        codexThreadId?: string; // Codex CLI thread id（用于续聊）
    }

    interface QueuedCodexSendDraft {
        id: string;
        userContent: string;
        attachments: MessageAttachment[];
        contextDocuments: ContextDocument[];
        queuedAt: number;
    }

    let messages: Message[] = [];
    let currentInput = '';
    let isLoading = false;
    let streamingMessage = '';
    let streamingThinking = ''; // 流式思考内容
    let streamingCodexTimeline: CodexTraceCall[] = []; // Codex 流式时间线（按真实顺序）
    let streamingToolCalls: CodexTraceCall[] = []; // 流式工具调用轨道
    let streamingSearchCalls: CodexTraceCall[] = []; // 流式搜索轨道
    let isThinkingPhase = false; // 是否在思考阶段
    let streamingThinkingExpanded = false;
    let streamingCodexTimelineExpanded = true;
    let streamingToolCallsExpanded = true;
    let streamingSearchCallsExpanded = true;
    let settings: any = getDefaultSettings();
    let messagesContainer: HTMLElement;
    let textareaElement: HTMLTextAreaElement;
    let inputContainer: HTMLElement;
    let fileInputElement: HTMLInputElement;

    // 思考过程折叠状态管理
    let thinkingCollapsed: Record<number, boolean> = {};

    // 右键菜单状态
    let contextMenuVisible = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuMessageIndex: number | null = null;
    let contextMenuMessageCount = 1;
    let contextMenuMessageType: 'user' | 'assistant' | null = null;
    let contextMenuIsMultiModel = false;
    // 选区相关（用于右键时判断是否对选中的文本进行复制）
    let selectionInMessage = false;
    let selectionHtml = '';
    let selectionText = '';

    // 附件管理
    let currentAttachments: MessageAttachment[] = [];
    let isUploadingFile = false;

    // 网页链接功能
    let isWebLinkDialogOpen = false;
    let webLinkDialogCloseButton: HTMLButtonElement;
    let webLinkDialogTextareaElement: HTMLTextAreaElement;
    let webLinkInput = '';
    let isFetchingWebContent = false;

    // 中断控制
    let abortController: AbortController | null = null;
    let isAborted = false; // 标记是否已中断，防止中断后 onComplete 重复添加消息
    let queuedCodexSendDrafts: QueuedCodexSendDraft[] = [];
    let isProcessingQueuedCodexSend = false;

    // 自动滚动控制
    let autoScroll = true;
    let lastScrollTop = 0;
    // autoScroll 被用户打断（或选区保护拦截）后，标记“底部有新内容”，用于显示“回到底部/新消息”按钮
    let hasUnreadMessagesBelow = false;
    // 选区保护：messagesContainer 内存在选区时，不自动滚动，避免滚动抢占导致选区丢失
    let selectionActiveInMessagesContainer = false;

    // 上下文文档
    let contextDocuments: ContextDocument[] = [];
    let isSearchDialogOpen = false;
    let searchDialogInputElement: HTMLInputElement;
    let searchKeyword = '';
    let searchResults: any[] = [];
    let isSearching = false;
    let isDragOver = false;
    let searchTimeout: number | null = null;

    // 会话管理
    let sessions: ChatSession[] = [];
    let currentSessionId: string = '';
    let isSessionManagerOpen = false;
    let hasUnsavedChanges = false;

    // 在新窗口打开菜单
    let showOpenWindowMenu = false;
    let openWindowMenuButton: HTMLButtonElement;

    // 全屏模式
    let isFullscreen = false;
    let sidebarContainer: HTMLElement;

    // 当前选中的提供商和模型
    let currentProvider = '';
    let currentModelId = '';
    let providers: Record<string, ProviderConfig> = {};
    let isCodexMode = false;
    let isCheckingCodexTools = false;
    let codexModelOptions: string[] = [];
    let isLoadingCodexModels = false;
    let codexModelLoadError = '';
    let codexNativeContextPercent: number | null = null;
    let codexNativeContextSource = '';
    let lastCodexModelConfigFingerprint = '';
    $: isCodexMode = settings?.codexEnabled === true;
    $: {
        const workingDir = String(settings?.codexWorkingDir || '').trim();
        const fingerprint = workingDir || '__default__';
        if (settings && fingerprint !== lastCodexModelConfigFingerprint) {
            lastCodexModelConfigFingerprint = fingerprint;
            void refreshCodexModelOptions(false);
        }
    }

    // 显示设置
    let messageFontSize = 12;
    let multiModelViewMode: 'tab' | 'card' = 'tab'; // 多模型回答样式

    // 编辑模式
    type ChatMode = 'ask' | 'edit' | 'agent';
    const CODEX_CHAT_MODES: ChatMode[] = ['ask', 'agent'];
    const normalizeChatModeForCodex = (mode: ChatMode): ChatMode =>
        mode === 'edit' ? 'agent' : mode;
    const resolveSavedCodexChatMode = (mode: unknown): ChatMode => {
        const rawMode = String(mode || '').trim();
        if (rawMode === 'agent' || rawMode === 'edit') {
            return 'agent';
        }
        return 'ask';
    };

    // 模型临时设置
    let tempModelSettings = {
        contextCount: 10,
        temperature: 1,
        temperatureEnabled: true,
        systemPrompt: '',
        modelSelectionEnabled: false,
        selectedModels: [] as Array<{
            provider: string;
            modelId: string;
            thinkingEnabled?: boolean;
            thinkingEffort?: ThinkingEffort;
        }>,
        enableMultiModel: false,
        chatMode: 'ask' as ChatMode,
    };

    let chatMode: ChatMode = 'ask';
    let autoApproveEdit = false; // 自动批准编辑操作
    let isDiffDialogOpen = false;
    let currentDiffOperation: EditOperation | null = null;
    let diffDialogLines: GitDiffLine[] = [];
    let diffDialogEngine: 'git' | 'lcs' = 'lcs';
    let isDiffDialogLinesLoading = false;
    let diffDialogGitError = '';
    let diffDialogUnifiedPatch = '';
    let diffDialogLoadToken = 0;
    let diffDialogStats = { added: 0, removed: 0 };
    let diffDialogViewMode: 'split' | 'unified' = 'split';
    let diffDialogWrapEnabled = false;
    let diffDialogRenderLimit = 800;
    let diffDialogExpandedFoldIds = new Set<string>();
    let diffDialogCloseButton: HTMLButtonElement;

    // Git 同步对话框
    let isGitSyncDialogOpen = false;
    let gitSyncDialogCloseButton: HTMLButtonElement;
    let gitSyncRepoInputElement: HTMLInputElement;
    let gitRepoDir = '';
    let gitRemoteName = 'origin';
    let gitRemoteUrl = '';
    let gitBranch = '';
    let gitSyncScope: 'notes' | 'repo' = 'notes';
    let gitAutoSyncDryRun = false;
    let gitCommitMessage = '';
    let gitLog = '';
    let gitIsRunning = false;
    let gitLastExitCode: number | null = null;
    let gitAbortCurrent: null | (() => void) = null;
    $: if (isCodexMode && chatMode === 'edit') {
        chatMode = 'agent';
    }
    $: if (isCodexMode && tempModelSettings.chatMode === 'edit') {
        tempModelSettings = { ...tempModelSettings, chatMode: 'agent' };
    }

    // 图片查看器
    let isImageViewerOpen = false;
    let currentImageSrc = '';
    let currentImageName = '';

    $: diffDialogStats = getDiffLineStatsFromLines(diffDialogLines);

    // 消息内容显示缓存（存储每个消息的显示内容，键为content的哈希）
    const messageDisplayCache = new Map<string, { loading: boolean; content: string }>();

    // 获取content的简单哈希（用作缓存键）
    function getContentHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 获取用于显示的消息内容（将 assets 路径替换为 blob URL）
    function getDisplayContent(content: string | MessageContent[]): string {
        const textContent = typeof content === 'string' ? content : getMessageText(content);

        // 检查是否包含 assets 路径
        if (!textContent.includes('/data/storage/petal/siyuan-plugin-copilot/assets/')) {
            return formatMessage(textContent);
        }

        // 使用content本身的哈希作为缓存键
        const cacheKey = getContentHash(textContent);

        // 如果缓存中存在且已加载完成，直接返回
        const cached = messageDisplayCache.get(cacheKey);
        if (cached && !cached.loading) {
            return cached.content;
        }

        // 如果正在加载，返回原始内容
        if (cached && cached.loading) {
            return formatMessage(textContent);
        }

        // 标记为加载中
        messageDisplayCache.set(cacheKey, { loading: true, content: '' });

        // 异步加载assets图片
        replaceAssetPathsWithBlob(textContent).then(processedContent => {
            const formattedContent = formatMessage(processedContent);
            messageDisplayCache.set(cacheKey, { loading: false, content: formattedContent });
            // 触发重新渲染
            messages = [...messages];
        });

        // 先返回原始内容
        return formatMessage(textContent);
    }

    // 思考内容里常见的转义换行（例如 "\\n"）在展示前还原成真实换行
    function normalizeThinkingText(content: string | null | undefined): string {
        const raw = String(content || '');
        if (!raw) return '';
        return raw
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\n')
            .replace(/\\t/g, '\t');
    }

    function getThinkingDisplayContent(content: string | null | undefined): string {
        return getDisplayContent(normalizeThinkingText(content));
    }

    // 打开图片查看器
    function openImageViewer(src: string, name: string) {
        currentImageSrc = src;
        currentImageName = name;
        isImageViewerOpen = true;
    }

    // 关闭图片查看器
    function closeImageViewer() {
        isImageViewerOpen = false;
        currentImageSrc = '';
        currentImageName = '';
    }

    // 下载图片
    async function downloadImage(src: string, filename: string) {
        try {
            const link = document.createElement('a');
            link.href = src;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            pushMsg(t('aiSidebar.success.imageDownloadSuccess') || 'Image downloaded');
        } catch (error) {
            console.error('下载图片失败:', error);
            pushErrMsg(t('aiSidebar.errors.imageDownloadFailed') || 'Image download failed');
        }
    }

    // 复制图片为PNG
    async function copyImageAsPng(src: string) {
        try {
            const response = await fetch(src);
            const blob = await response.blob();

            // 如果已经是 image/png，直接复制
            if (blob.type === 'image/png') {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': blob,
                    }),
                ]);
            } else {
                // 否则转换为 PNG
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = URL.createObjectURL(blob);
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });

                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Failed to create canvas context');
                ctx.drawImage(img, 0, 0);

                const pngBlob = await new Promise<Blob | null>(resolve =>
                    canvas.toBlob(resolve, 'image/png')
                );
                if (!pngBlob) throw new Error('Failed to convert image to PNG');

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': pngBlob,
                    }),
                ]);
                URL.revokeObjectURL(img.src);
            }

            pushMsg(t('aiSidebar.success.imageCopiedToClipboard') || 'Image copied to clipboard');
        } catch (error) {
            console.error('复制图片失败:', error);
            pushErrMsg(
                t('aiSidebar.errors.imageCopyFailed') ||
                    'Image copy failed, try downloading the file first'
            );
        }
    }

    // 当模式切换时，更新已添加的上下文文档内容
    $: if (chatMode) {
        updateContextDocumentsForMode();
    }

    async function updateCodexInlineSetting(
        field: 'codexModelOverride' | 'codexReasoningEffort',
        value: string
    ) {
        const nextValue = value.trim();
        const currentValue = String(settings?.[field] || '').trim();
        if (currentValue === nextValue) return;
        settings = { ...settings, [field]: nextValue };
        await plugin.saveSettings(settings);
    }

    async function updateChatModeSetting(mode: string) {
        const nextMode = resolveSavedCodexChatMode(mode);
        if (chatMode !== nextMode) {
            chatMode = nextMode;
        }
        if (tempModelSettings.chatMode !== nextMode) {
            tempModelSettings = { ...tempModelSettings, chatMode: nextMode };
        }
        const savedMode = resolveSavedCodexChatMode(settings?.codexChatMode);
        if (savedMode === nextMode && String(settings?.codexChatMode || '').trim() === nextMode) {
            return;
        }
        settings = { ...settings, codexChatMode: nextMode };
        await plugin.saveSettings(settings);
    }

    async function refreshCodexModelOptions(showToast = false) {
        if (isLoadingCodexModels) return;
        isLoadingCodexModels = true;
        codexModelLoadError = '';
        try {
            codexModelOptions = await fetchCodexModels({
                workingDir: String(settings?.codexWorkingDir || '').trim(),
            });
            if (showToast) {
                pushMsg(
                    (t('aiSidebar.codex.modelsRefreshed') || 'Codex local models updated ({count})')
                        .replace('{count}', String(codexModelOptions.length))
                );
            }
        } catch (error) {
            codexModelOptions = [];
            codexModelLoadError = (error as Error).message || String(error);
            if (showToast) {
                pushErrMsg(
                    (t('aiSidebar.codex.refreshModelsFailed') || 'Failed to refresh Codex models: {error}')
                        .replace('{error}', codexModelLoadError)
                );
            }
        } finally {
            isLoadingCodexModels = false;
        }
    }

    function nodeRequireForSidebar<T = any>(id: string): T {
        const w = globalThis as any;
        if (w?.require && typeof w.require === 'function') {
            return w.require(id);
        }
        throw new Error('当前环境不支持 Node require');
    }

    function getSiyuanConfigForSidebar(): any {
        return (globalThis as any)?.window?.siyuan?.config || (globalThis as any)?.siyuan?.config || {};
    }

    function isWindowsPlatform(): boolean {
        return (globalThis as any)?.process?.platform === 'win32';
    }

    function resolveSiyuanMcpScriptPath(): { scriptPath: string; candidates: string[] } {
        const path = nodeRequireForSidebar<any>('path');
        const fs = nodeRequireForSidebar<any>('fs');
        const candidates: string[] = [];
        const pluginName = String(plugin?.name || 'siyuan-plugin-copilot').trim();

        const cfg = getSiyuanConfigForSidebar();
        const workspaceCandidates = [cfg?.system?.workspaceDir, cfg?.system?.workspace, cfg?.workspaceDir]
            .filter((v: any) => typeof v === 'string' && v.trim())
            .map((v: string) => v.trim());
        const dataDirCandidates = [cfg?.system?.dataDir, cfg?.dataDir]
            .filter((v: any) => typeof v === 'string' && v.trim())
            .map((v: string) => v.trim());

        const pluginPathCandidates = [
            (plugin as any)?.selfPath,
            (plugin as any)?.path,
            (plugin as any)?.pluginPath,
            (plugin as any)?.basePath,
        ]
            .filter(v => typeof v === 'string' && String(v).trim())
            .map(v => String(v).trim());

        for (const p of pluginPathCandidates) {
            candidates.push(path.join(p, 'mcp', 'siyuan-mcp', 'index.cjs'));
        }

        for (const ws of workspaceCandidates) {
            candidates.push(path.join(ws, 'data', 'plugins', pluginName, 'mcp', 'siyuan-mcp', 'index.cjs'));
        }

        for (const dd of dataDirCandidates) {
            candidates.push(path.join(dd, 'plugins', pluginName, 'mcp', 'siyuan-mcp', 'index.cjs'));
        }

        const fallbackPath = getDefaultSiyuanMcpScriptPath();
        candidates.push(fallbackPath);

        const normalizedUnique = Array.from(
            new Set(
                candidates
                    .map((p: string) => String(p || '').trim())
                    .filter(Boolean)
                    .map((p: string) => p.replace(/[\\/]+/g, path.sep))
            )
        );

        const found = normalizedUnique.find((p: string) => fs.existsSync(p));
        return {
            scriptPath: found || normalizedUnique[0] || fallbackPath,
            candidates: normalizedUnique,
        };
    }

    async function listSiyuanMcpToolsFromPlugin(): Promise<Array<{ name: string; description?: string }>> {
        const childProcess = nodeRequireForSidebar<any>('child_process');
        const fs = nodeRequireForSidebar<any>('fs');
        const { scriptPath, candidates } = resolveSiyuanMcpScriptPath();
        if (!fs.existsSync(scriptPath)) {
            const details = candidates.slice(0, 5).join(' | ');
            throw new Error(`未找到 MCP 脚本：${scriptPath}${details ? `（尝试路径：${details}）` : ''}`);
        }

        const env: Record<string, string> = { ...(globalThis as any)?.process?.env };
        if (settings?.siyuanApiUrl) {
            env.SIYUAN_API_URL = String(settings.siyuanApiUrl).trim();
        }
        if (settings?.siyuanApiToken) {
            env.SIYUAN_API_TOKEN = String(settings.siyuanApiToken).trim();
        }
        env.SIYUAN_MCP_READ_ONLY = '1';

        return await new Promise((resolve, reject) => {
            const child = childProcess.spawn('node', [scriptPath], {
                env,
                shell: isWindowsPlatform(),
                windowsHide: true,
            });

            const stderrLines: string[] = [];
            let stdoutBuf = '';
            let settled = false;
            let timeout: any = null;

            const finish = (error?: Error, tools?: Array<{ name: string; description?: string }>) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                try {
                    child.kill();
                } catch {
                    // ignore
                }
                if (error) {
                    reject(error);
                } else {
                    resolve(tools || []);
                }
            };

            const onJsonLine = (line: string) => {
                if (!line.trim()) return;
                let msg: any = null;
                try {
                    msg = JSON.parse(line);
                } catch {
                    return;
                }

                if (msg?.id === 2) {
                    if (msg.error) {
                        finish(
                            new Error(
                                msg.error?.message ||
                                    `tools/list 失败${stderrLines.length ? `: ${stderrLines.join(' | ')}` : ''}`
                            )
                        );
                        return;
                    }
                    const tools = Array.isArray(msg?.result?.tools) ? msg.result.tools : [];
                    finish(undefined, tools.map((t: any) => ({ name: t.name, description: t.description })));
                }
            };

            child.on('error', (err: Error) => finish(new Error(`启动 MCP 进程失败：${err.message}`)));

            child.stdout?.on('data', (chunk: any) => {
                stdoutBuf += String(chunk);
                while (true) {
                    const idx = stdoutBuf.indexOf('\n');
                    if (idx < 0) break;
                    const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
                    stdoutBuf = stdoutBuf.slice(idx + 1);
                    onJsonLine(line);
                }
            });

            child.stderr?.on('data', (chunk: any) => {
                const lines = String(chunk)
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean);
                stderrLines.push(...lines);
            });

            timeout = setTimeout(() => {
                finish(
                    new Error(
                        `工具自检超时${
                            stderrLines.length > 0 ? `: ${stderrLines.slice(-3).join(' | ')}` : ''
                        }`
                    )
                );
            }, 6000);

            try {
                child.stdin?.write(
                    `${JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: { protocolVersion: '2024-11-05' },
                    })}\n`
                );
                child.stdin?.write(
                    `${JSON.stringify({
                        jsonrpc: '2.0',
                        id: 2,
                        method: 'tools/list',
                        params: {},
                    })}\n`
                );
                child.stdin?.end();
            } catch (e) {
                finish(new Error(`向 MCP 进程发送请求失败：${(e as Error).message}`));
            }
        });
    }

    function parseSiyuanMcpToolCallPayload(result: any): any {
        const content = Array.isArray(result?.content) ? result.content : [];
        const textPart = content.find(
            (item: any) => item && item.type === 'text' && typeof item.text === 'string'
        );
        const rawText = String(textPart?.text || '').trim();
        if (!rawText) return null;
        try {
            return JSON.parse(rawText);
        } catch {
            return rawText;
        }
    }

    function extractNotebookIdFromPayload(payload: any): string {
        const candidates: any[] = [];
        if (Array.isArray(payload)) {
            candidates.push(...payload);
        } else if (payload && typeof payload === 'object') {
            if (Array.isArray(payload.notebooks)) {
                candidates.push(...payload.notebooks);
            }
            if (Array.isArray(payload.data?.notebooks)) {
                candidates.push(...payload.data.notebooks);
            }
            if (Array.isArray(payload.data)) {
                candidates.push(...payload.data);
            }
        }
        for (const item of candidates) {
            const id =
                String(item?.id || item?.notebook || item?.box || item?.notebookID || '').trim();
            if (id) return id;
        }
        return '';
    }

    function summarizeSiyuanMcpPayload(payload: any): string {
        if (payload === null || payload === undefined) return 'ok';
        if (typeof payload === 'string') {
            return payload.length > 80 ? `${payload.slice(0, 80)}...` : payload;
        }
        if (Array.isArray(payload)) {
            return `array(${payload.length})`;
        }
        if (typeof payload === 'object') {
            const keys = Object.keys(payload);
            if (Array.isArray((payload as any).notebooks)) {
                return `notebooks=${(payload as any).notebooks.length}`;
            }
            if (Array.isArray((payload as any).data?.notebooks)) {
                return `notebooks=${(payload as any).data.notebooks.length}`;
            }
            if (Array.isArray((payload as any).data)) {
                return `data=${(payload as any).data.length}`;
            }
            return keys.length ? `keys:${keys.slice(0, 4).join(',')}` : 'object';
        }
        return String(payload);
    }

    async function callSiyuanMcpToolFromPlugin(
        name: string,
        args: Record<string, any>,
        timeoutMs = 8000
    ): Promise<{ ok: boolean; durationMs: number; payload?: any; error?: string }> {
        const begin = Date.now();
        const childProcess = nodeRequireForSidebar<any>('child_process');
        const fs = nodeRequireForSidebar<any>('fs');
        const { scriptPath, candidates } = resolveSiyuanMcpScriptPath();
        if (!fs.existsSync(scriptPath)) {
            const details = candidates.slice(0, 5).join(' | ');
            throw new Error(`未找到 MCP 脚本：${scriptPath}${details ? `（尝试路径：${details}）` : ''}`);
        }

        const env: Record<string, string> = { ...(globalThis as any)?.process?.env };
        if (settings?.siyuanApiUrl) {
            env.SIYUAN_API_URL = String(settings.siyuanApiUrl).trim();
        }
        if (settings?.siyuanApiToken) {
            env.SIYUAN_API_TOKEN = String(settings.siyuanApiToken).trim();
        }
        env.SIYUAN_MCP_READ_ONLY = '1';

        try {
            const payload = await new Promise<any>((resolve, reject) => {
                const child = childProcess.spawn('node', [scriptPath], {
                    env,
                    shell: isWindowsPlatform(),
                    windowsHide: true,
                });

                const stderrLines: string[] = [];
                let stdoutBuf = '';
                let settled = false;
                let timeout: any = null;

                const finish = (error?: Error, value?: any) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    try {
                        child.kill();
                    } catch {
                        // ignore
                    }
                    if (error) reject(error);
                    else resolve(value);
                };

                const onJsonLine = (line: string) => {
                    if (!line.trim()) return;
                    let msg: any = null;
                    try {
                        msg = JSON.parse(line);
                    } catch {
                        return;
                    }
                    if (msg?.id !== 2) return;
                    if (msg.error) {
                        finish(
                            new Error(
                                msg.error?.message ||
                                    `${name} 执行失败${stderrLines.length ? `: ${stderrLines.join(' | ')}` : ''}`
                            )
                        );
                        return;
                    }
                    finish(undefined, parseSiyuanMcpToolCallPayload(msg.result));
                };

                child.on('error', (err: Error) =>
                    finish(new Error(`启动 MCP 进程失败：${err.message}`))
                );

                child.stdout?.on('data', (chunk: any) => {
                    stdoutBuf += String(chunk);
                    while (true) {
                        const idx = stdoutBuf.indexOf('\n');
                        if (idx < 0) break;
                        const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
                        stdoutBuf = stdoutBuf.slice(idx + 1);
                        onJsonLine(line);
                    }
                });

                child.stderr?.on('data', (chunk: any) => {
                    const lines = String(chunk)
                        .split(/\r?\n/)
                        .map(s => s.trim())
                        .filter(Boolean);
                    stderrLines.push(...lines);
                });

                timeout = setTimeout(() => {
                    finish(
                        new Error(
                            `${name} 调用超时${
                                stderrLines.length > 0 ? `: ${stderrLines.slice(-3).join(' | ')}` : ''
                            }`
                        )
                    );
                }, timeoutMs);

                try {
                    child.stdin?.write(
                        `${JSON.stringify({
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'initialize',
                            params: { protocolVersion: '2024-11-05' },
                        })}\n`
                    );
                    child.stdin?.write(
                        `${JSON.stringify({
                            jsonrpc: '2.0',
                            id: 2,
                            method: 'tools/call',
                            params: { name, arguments: args || {} },
                        })}\n`
                    );
                    child.stdin?.end();
                } catch (e) {
                    finish(new Error(`向 MCP 进程发送请求失败：${(e as Error).message}`));
                }
            });
            return { ok: true, durationMs: Date.now() - begin, payload };
        } catch (error) {
            return {
                ok: false,
                durationMs: Date.now() - begin,
                error: (error as Error)?.message || String(error),
            };
        }
    }

    async function runCodexToolSelfCheck() {
        if (isCheckingCodexTools) return;
        isCheckingCodexTools = true;

        try {
            const tools = await listSiyuanMcpToolsFromPlugin();
            const names = tools
                .map(tool => String(tool.name || '').trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
            const nameSet = new Set(names);

            type ExecutableCheckItem = {
                name: string;
                ok: boolean;
                durationMs: number;
                summary: string;
            };
            const executableChecks: ExecutableCheckItem[] = [];
            let notebookId = '';

            if (nameSet.has('siyuan_list_notebooks')) {
                const check = await callSiyuanMcpToolFromPlugin('siyuan_list_notebooks', {});
                if (check.ok) {
                    notebookId = extractNotebookIdFromPayload(check.payload);
                }
                executableChecks.push({
                    name: 'siyuan_list_notebooks',
                    ok: check.ok,
                    durationMs: check.durationMs,
                    summary: check.ok
                        ? summarizeSiyuanMcpPayload(check.payload)
                        : String(check.error || 'unknown error'),
                });
            }

            if (nameSet.has('siyuan_sql_query')) {
                const check = await callSiyuanMcpToolFromPlugin('siyuan_sql_query', {
                    sql: 'select id from blocks limit 1',
                });
                executableChecks.push({
                    name: 'siyuan_sql_query',
                    ok: check.ok,
                    durationMs: check.durationMs,
                    summary: check.ok
                        ? summarizeSiyuanMcpPayload(check.payload)
                        : String(check.error || 'unknown error'),
                });
            }

            if (notebookId && nameSet.has('siyuan_get_doc_tree')) {
                const check = await callSiyuanMcpToolFromPlugin('siyuan_get_doc_tree', {
                    notebook: notebookId,
                });
                executableChecks.push({
                    name: 'siyuan_get_doc_tree',
                    ok: check.ok,
                    durationMs: check.durationMs,
                    summary: check.ok
                        ? summarizeSiyuanMcpPayload(check.payload)
                        : String(check.error || 'unknown error'),
                });
            }

            const checksPassed = executableChecks.filter(item => item.ok).length;
            const checksTotal = executableChecks.length;
            const totalCheckCostMs = executableChecks.reduce(
                (sum, item) => sum + Number(item.durationMs || 0),
                0
            );
            const statusText =
                checksTotal === 0
                    ? t('aiSidebar.codex.toolCheckPassed') || '通过'
                    : checksPassed === checksTotal
                    ? t('aiSidebar.codex.toolCheckPassed') || '通过'
                    : checksPassed > 0
                    ? t('aiSidebar.codex.toolCheckPartial') || '部分通过'
                    : t('aiSidebar.codex.toolCheckFailedShort') || '失败';

            const reportLines = [
                `### ${t('aiSidebar.codex.toolCheckReportTitle') || 'Codex 工具自检'}`,
                `- 状态：${statusText}`,
                `- ${t('aiSidebar.codex.toolCount') || '工具数量'}：${names.length}`,
                `- 可执行检查：${checksPassed}/${checksTotal}`,
                checksTotal > 0 ? `- 可执行检查总耗时：${totalCheckCostMs} ms` : '',
                '',
                ...(checksTotal > 0
                    ? [
                          '#### 可执行检查明细',
                          ...executableChecks.map(item => {
                              const flag = item.ok ? '✅' : '❌';
                              return `- ${flag} \`${item.name}\` · ${item.durationMs} ms · ${item.summary}`;
                          }),
                          '',
                      ]
                    : []),
                '#### tools/list 清单',
                ...names.map(name => `- \`${name}\``),
            ].filter(Boolean);

            messages = [...messages, { role: 'assistant', content: reportLines.join('\n') }];
            hasUnsavedChanges = true;
            await saveCurrentSession(true);

            pushMsg(
                checksTotal > 0
                    ? `Codex 工具自检完成：可执行检查 ${checksPassed}/${checksTotal}，工具数 ${names.length}`
                    : (t('aiSidebar.codex.toolCheckSuccess') || 'Codex 工具自检完成，共 {count} 个工具').replace(
                          '{count}',
                          String(names.length)
                      )
            );
        } catch (error) {
            const detail = (error as Error)?.message || String(error);
            messages = [
                ...messages,
                {
                    role: 'assistant',
                    content: `### ${t('aiSidebar.codex.toolCheckReportTitle') || 'Codex 工具自检'}\n- 状态：${
                        t('aiSidebar.codex.toolCheckFailedShort') || '失败'
                    }\n- 错误：${detail}`,
                },
            ];
            hasUnsavedChanges = true;
            await saveCurrentSession(true);

            pushErrMsg(
                (t('aiSidebar.codex.toolCheckFailed') || 'Codex 工具自检失败：{error}').replace(
                    '{error}',
                    detail
                )
            );
        } finally {
            isCheckingCodexTools = false;
        }
    }

    // 更新上下文文档内容以匹配当前模式
    async function updateContextDocumentsForMode() {
        if (contextDocuments.length === 0) return;

        const updatedDocs: ContextDocument[] = [];
        for (const doc of contextDocuments) {
            try {
                let content: string;

                if (chatMode === 'agent') {
                    // agent模式：文档只保留ID，块获取kramdown
                    if (doc.type === 'doc') {
                        content = ''; // 文档不保存内容，只保留ID
                    } else {
                        // 块获取kramdown格式
                        const blockData = await getBlockKramdown(doc.id);
                        if (blockData && blockData.kramdown) {
                            content = blockData.kramdown;
                        } else {
                            content = doc.content; // 保留原内容
                        }
                    }
                } else if (chatMode === 'edit') {
                    // edit模式：获取kramdown格式
                    const blockData = await getBlockKramdown(doc.id);
                    if (blockData && blockData.kramdown) {
                        content = blockData.kramdown;
                    } else {
                        content = doc.content; // 保留原内容
                    }
                } else {
                    // ask模式：获取Markdown格式
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        content = data.content;
                    } else {
                        content = doc.content; // 保留原内容
                    }
                }

                updatedDocs.push({
                    id: doc.id,
                    title: doc.title,
                    content: content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to update content for block ${doc.id}:`, error);
                // 出错时保留原内容
                updatedDocs.push(doc);
            }
        }

        contextDocuments = updatedDocs;
    }

    // 重新生成单个多模型响应（在多模型选择阶段使用）
    async function regenerateModelResponse(index: number) {
        const response = multiModelResponses[index];
        if (!response) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        // 如果目标模型正在加载中，则拒绝重复触发
        if (response.isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(t('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(t('aiSidebar.errors.noApiKey'));
            return;
        }

        // 标记为加载中并清空内容/错误
        multiModelResponses[index] = {
            ...multiModelResponses[index],
            isLoading: true,
            error: undefined,
            content: '',
            thinking: '',
            thinkingCollapsed: false,
        };
        multiModelResponses = [...multiModelResponses];

        // 获取最后一条用户消息并准备上下文
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            multiModelResponses[index].isLoading = false;
            multiModelResponses = [...multiModelResponses];
            return;
        }

        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;
                if (chatMode === 'edit') {
                    const blockData = await getBlockKramdown(doc.id);
                    content = (blockData && blockData.kramdown) || doc.content;
                } else {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    content = (data && data.content) || doc.content;
                }
                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        const userContent =
            typeof lastUserMessage.content === 'string'
                ? lastUserMessage.content
                : getMessageText(lastUserMessage.content);
        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: lastUserMessage.attachments,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? contextDocumentsWithLatestContent
                    : undefined,
        };

        const messagesToSend = await prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage
        );

        // 本次请求的 AbortController（用于单个模型的中断）
        const localAbort = new AbortController();

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                multiModelResponses[index].error = '自定义参数 JSON 格式错误';
                multiModelResponses[index].isLoading = false;
                multiModelResponses = [...multiModelResponses];
                return;
            }
        }

        try {
            let fullText = '';
            let thinking = '';

            await chat(
                response.provider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : modelConfig.temperature,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: localAbort.signal,
                    customBody,
                    enableThinking: modelConfig.capabilities?.thinking || false,
                    reasoningEffort: modelConfig.thinkingEffort || 'low',
                    onThinkingChunk: async (chunk: string) => {
                        thinking += chunk;
                        if (multiModelResponses[index]) {
                            multiModelResponses[index].thinking = thinking;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onThinkingComplete: () => {
                        if (multiModelResponses[index] && multiModelResponses[index].thinking) {
                            multiModelResponses[index].thinkingCollapsed = true;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onChunk: async (chunk: string) => {
                        fullText += chunk;
                        if (multiModelResponses[index]) {
                            multiModelResponses[index].content = fullText;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onComplete: async (text: string) => {
                        if (multiModelResponses[index]) {
                            const convertedText = convertLatexToMarkdown(text);
                            // 处理content中的base64图片，保存为assets文件
                            const processedContent = await saveBase64ImagesInContent(convertedText);
                            multiModelResponses[index].content = processedContent;
                            multiModelResponses[index].thinking = thinking;
                            multiModelResponses[index].isLoading = false;
                            if (thinking && !multiModelResponses[index].thinkingCollapsed) {
                                multiModelResponses[index].thinkingCollapsed = true;
                            }
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted' && multiModelResponses[index]) {
                            multiModelResponses[index].error = error.message;
                            multiModelResponses[index].isLoading = false;
                            multiModelResponses = [...multiModelResponses];
                        }
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            if ((error as Error).message !== 'Request aborted' && multiModelResponses[index]) {
                multiModelResponses[index].error = (error as Error).message;
                multiModelResponses[index].isLoading = false;
                multiModelResponses = [...multiModelResponses];
            }
        }
    }

    // 重新生成历史消息中的单个多模型响应（history message.multiModelResponses）
    async function regenerateHistoryModelResponse(absMessageIndex: number, responseIndex: number) {
        const msg = messages[absMessageIndex];
        if (!msg || !msg.multiModelResponses) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        const response = msg.multiModelResponses[responseIndex];
        if (!response) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        if (response.isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const config = getProviderAndModelConfig(response.provider, response.modelId);
        if (!config) {
            pushErrMsg(t('aiSidebar.info.noValidModel') || '无效的模型');
            return;
        }

        const { providerConfig, modelConfig } = config;
        if (!providerConfig || !providerConfig.apiKey) {
            pushErrMsg(t('aiSidebar.errors.noApiKey'));
            return;
        }

        // 标记为加载中并清空内容/错误
        msg.multiModelResponses[responseIndex] = {
            ...msg.multiModelResponses[responseIndex],
            isLoading: true,
            error: undefined,
            content: '',
            thinking: '',
            thinkingCollapsed: false,
        };
        messages = [...messages];

        // 找到该 assistant 消息之前最近的 user 消息作为上下文
        let lastUserMessage: Message | undefined;
        for (let i = absMessageIndex - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUserMessage = messages[i];
                break;
            }
        }

        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            msg.multiModelResponses[responseIndex].isLoading = false;
            messages = [...messages];
            return;
        }

        // 获取用户消息的上下文文档最新内容（如果有）
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;
                if (chatMode === 'edit') {
                    const blockData = await getBlockKramdown(doc.id);
                    content = (blockData && blockData.kramdown) || doc.content;
                } else {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    content = (data && data.content) || doc.content;
                }
                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        const userContent =
            typeof lastUserMessage.content === 'string'
                ? lastUserMessage.content
                : getMessageText(lastUserMessage.content);
        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: lastUserMessage.attachments,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? contextDocumentsWithLatestContent
                    : undefined,
        };

        const messagesToSend = await prepareMessagesForAI(
            messages,
            contextDocumentsWithLatestContent,
            userContent,
            userMessage
        );

        const localAbort = new AbortController();

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                msg.multiModelResponses[responseIndex].error = '自定义参数 JSON 格式错误';
                msg.multiModelResponses[responseIndex].isLoading = false;
                messages = [...messages];
                return;
            }
        }

        try {
            let fullText = '';
            let thinking = '';

            await chat(
                response.provider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : modelConfig.temperature,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: localAbort.signal,
                    customBody,
                    enableThinking:
                        modelConfig.capabilities?.thinking &&
                        (modelConfig.thinkingEnabled || false),
                    reasoningEffort: modelConfig.thinkingEffort || 'low',
                    onThinkingChunk: async (chunk: string) => {
                        thinking += chunk;
                        msg.multiModelResponses[responseIndex].thinking = thinking;
                        messages = [...messages];
                    },
                    onThinkingComplete: () => {
                        if (msg.multiModelResponses[responseIndex].thinking) {
                            msg.multiModelResponses[responseIndex].thinkingCollapsed = true;
                            messages = [...messages];
                        }
                    },
                    onChunk: async (chunk: string) => {
                        fullText += chunk;
                        msg.multiModelResponses[responseIndex].content = fullText;
                        messages = [...messages];
                    },
                    onComplete: async (text: string) => {
                        const convertedText = convertLatexToMarkdown(text);
                        // 处理content中的base64图片，保存为assets文件
                        const processedContent = await saveBase64ImagesInContent(convertedText);
                        msg.multiModelResponses[responseIndex].content = processedContent;
                        msg.multiModelResponses[responseIndex].thinking = thinking;
                        msg.multiModelResponses[responseIndex].isLoading = false;
                        if (thinking && !msg.multiModelResponses[responseIndex].thinkingCollapsed) {
                            msg.multiModelResponses[responseIndex].thinkingCollapsed = true;
                        }
                        messages = [...messages];
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted') {
                            msg.multiModelResponses[responseIndex].error = error.message;
                            msg.multiModelResponses[responseIndex].isLoading = false;
                            messages = [...messages];
                        }
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            if ((error as Error).message !== 'Request aborted') {
                msg.multiModelResponses[responseIndex].error = (error as Error).message;
                msg.multiModelResponses[responseIndex].isLoading = false;
                messages = [...messages];
            }
        }
    }

    // Agent 模式
    let isToolSelectorOpen = false;
    let selectedTools: ToolConfig[] = []; // 选中的工具配置列表
    let toolCallsInProgress: Set<string> = new Set(); // 正在执行的工具调用ID
    let toolCallsExpanded: Record<string, boolean> = {}; // 工具调用是否展开，默认折叠
    let toolCallResultsExpanded: Record<string, boolean> = {}; // 工具结果是否展开，默认折叠
    let codexTraceExpanded: Record<string, boolean> = {}; // Codex 轨道明细折叠状态
    let pendingToolCall: ToolCall | null = null; // 待批准的工具调用
    let isToolApprovalDialogOpen = false; // 工具批准对话框是否打开
    let isToolConfigLoaded = false; // 标记工具配置是否已加载

    // 多模型对话
    let enableMultiModel = false; // 是否启用多模型模式
    let selectedMultiModels: Array<{
        provider: string;
        modelId: string;
        thinkingEnabled?: boolean;
        thinkingEffort?: ThinkingEffort;
    }> = []; // 选中的多个模型

    let multiModelResponses: Array<{
        provider: string;
        modelId: string;
        modelName: string;
        content: string;
        thinking?: string;
        isLoading: boolean;
        error?: string;
        thinkingCollapsed?: boolean;
        thinkingEnabled?: boolean; // 用户是否开启思考模式（从 provider 配置获取）
    }> = []; // 多模型响应
    let isWaitingForAnswerSelection = false; // 是否在等待用户选择答案
    let selectedAnswerIndex: number | null = null; // 用户选择的答案索引
    let multiModelLayout: 'card' | 'tab' = 'tab'; // 多模型布局模式：card 或 tab（会在初始化时从设置读取）
    let selectedTabIndex: number = 0; // 当前选中的页签索引

    // 订阅设置变化
    let unsubscribe: () => void;

    async function enforceCodexOnlySettings() {
        let changed = false;
        if (settings.codexEnabled !== true) {
            settings = { ...settings, codexEnabled: true };
            changed = true;
        }
        if (Array.isArray(settings.selectedMultiModels) && settings.selectedMultiModels.length > 0) {
            settings = { ...settings, selectedMultiModels: [] };
            changed = true;
        }
        enableMultiModel = false;
        selectedMultiModels = [];
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        const normalizedChatMode = resolveSavedCodexChatMode(settings?.codexChatMode);
        if (chatMode !== normalizedChatMode) {
            chatMode = normalizedChatMode;
        }
        if (tempModelSettings.chatMode !== normalizedChatMode) {
            tempModelSettings = { ...tempModelSettings, chatMode: normalizedChatMode };
        }
        if (String(settings?.codexChatMode || '').trim() !== normalizedChatMode) {
            settings = { ...settings, codexChatMode: normalizedChatMode };
            changed = true;
        }
        if (changed) {
            await plugin.saveSettings(settings);
        }
    }

    function formatContextSelectionFileName() {
        const now = new Date();
        const pad = (value: number) => value.toString().padStart(2, '0');
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `selection-${ts}.md`;
    }

    function markAddChatContextHandled(requestId: string): boolean {
        if (!requestId) return false;
        if (addChatContextHandledRequests.has(requestId)) return false;
        addChatContextHandledRequests.add(requestId);
        if (addChatContextHandledRequests.size > 200) {
            const oldestKey = addChatContextHandledRequests.values().next().value;
            if (oldestKey) {
                addChatContextHandledRequests.delete(oldestKey);
            }
        }
        return true;
    }

    async function handleAddChatContextEvent(event: Event) {
        const detail = (event as CustomEvent<AddChatContextEventDetail | undefined>).detail;
        if (!detail || !markAddChatContextHandled(detail.requestId)) {
            return;
        }

        try {
            if (detail.kind === 'selection') {
                const content = (detail.markdown || detail.plainText || '').replace(/\r\n?/g, '\n').trim();
                if (!content) {
                    pushErrMsg(t('aiSidebar.errors.addSelectionFailed'));
                    return;
                }
                const beforeCount = currentAttachments.length;
                const fileName = formatContextSelectionFileName();
                const file = new File([content], fileName, { type: 'text/markdown' });
                await addFileAttachment(file);
                if (currentAttachments.length > beforeCount) {
                    pushMsg(t('aiSidebar.success.submittedToCodex'));
                }
                await tick();
                textareaElement?.focus();
                return;
            }

            if (detail.kind === 'doc') {
                const beforeCount = contextDocuments.length;
                await addItemByBlockId(detail.docId, false);
                if (contextDocuments.length > beforeCount) {
                    pushMsg(t('aiSidebar.success.submittedToCodex'));
                }
                await tick();
                textareaElement?.focus();
                return;
            }

            if (detail.kind === 'block') {
                const beforeCount = contextDocuments.length;
                await addItemByBlockId(detail.blockId, false);
                if (contextDocuments.length > beforeCount) {
                    pushMsg(t('aiSidebar.success.submittedToCodex'));
                }
                await tick();
                textareaElement?.focus();
            }
        } catch (error) {
            console.error('Add chat context event error:', error);
            pushErrMsg(t('aiSidebar.errors.addToCodexContextFailed'));
        }
    }

    function onAddChatContextEvent(event: Event) {
        void handleAddChatContextEvent(event);
    }

    onMount(async () => {
        settings = mergeSettingsWithDefaults(await plugin.loadSettings());
        // 优先强制写回 Codex-only，避免后续初始化中途异常导致 codexEnabled 仍为 false
        await enforceCodexOnlySettings();
        chatMode = resolveSavedCodexChatMode(settings?.codexChatMode);
        tempModelSettings = { ...tempModelSettings, chatMode };

        // 迁移旧设置到新结构
        migrateOldSettings();

        // 初始化提供商和模型信息
        providers = settings.aiProviders || {};
        currentProvider = settings.currentProvider || '';
        currentModelId = settings.currentModelId || '';

        // 确保必要的存储目录存在
        try {
            const emptyBlob = new Blob([''], { type: 'text/plain' });
            await putFile('/data/storage/petal/siyuan-plugin-copilot/sessions', true, emptyBlob);
            await putFile('/data/storage/petal/siyuan-plugin-copilot/assets', true, emptyBlob);
        } catch (e) {
            // 目录可能已存在
        }

        // 初始化多模型选择，过滤掉无效的模型
        selectedMultiModels = (settings.selectedMultiModels || []).filter(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return config !== null; // 只保留有效的模型
        });

        // 如果过滤后的模型列表与原列表不同，保存更新后的列表
        if (selectedMultiModels.length !== (settings.selectedMultiModels || []).length) {
            settings.selectedMultiModels = selectedMultiModels;
            await plugin.saveSettings(settings);
        }

        // 初始化字体大小设置
        messageFontSize = settings.messageFontSize || 12;

        // 初始化多模型视图样式设置
        multiModelViewMode = settings.multiModelViewMode || 'tab';
        multiModelLayout = multiModelViewMode; // 同时初始化多模型布局

        // 加载历史会话
        await loadSessions();

        // 仅保留 Codex 工作流
        await enforceCodexOnlySettings();
        await refreshCodexModelOptions(false);

        // 加载 Agent 模式的工具配置
        await loadToolsConfig();

        // 如果有系统提示词，添加到消息列表
        if (settings.aiSystemPrompt) {
            messages = [{ role: 'system', content: settings.aiSystemPrompt }];
        }

        // 如果有初始消息，自动填充到输入框
        if (initialMessage) {
            currentInput = initialMessage;
            // 在dialog模式下，自动聚焦输入框
            if (mode === 'dialog') {
                await tick();
                textareaElement?.focus();
            }
        }

        // 订阅设置变化
        unsubscribe = settingsStore.subscribe(newSettings => {
            if (newSettings && Object.keys(newSettings).length > 0) {
                // 更新本地设置（强制 Codex only）
                const incoming = mergeSettingsWithDefaults(newSettings);
                const needForceCodex = incoming.codexEnabled !== true;
                const hasMultiModels =
                    Array.isArray(incoming.selectedMultiModels) &&
                    incoming.selectedMultiModels.length > 0;
                if (needForceCodex || hasMultiModels) {
                    incoming.codexEnabled = true;
                    incoming.selectedMultiModels = [];
                    settings = incoming;
                    plugin.saveSettings(incoming).catch(err => {
                        console.error('Failed to enforce codex-only settings:', err);
                    });
                } else {
                    settings = incoming;
                }

                // 更新提供商信息
                if (newSettings.aiProviders) {
                    providers = newSettings.aiProviders;
                }

                // 更新当前选择（如果设置中有保存）
                if (newSettings.currentProvider) {
                    currentProvider = newSettings.currentProvider;
                }
                if (newSettings.currentModelId) {
                    currentModelId = newSettings.currentModelId;
                }
                const nextChatMode = resolveSavedCodexChatMode(newSettings.codexChatMode);
                if (chatMode !== nextChatMode) {
                    chatMode = nextChatMode;
                }
                if (tempModelSettings.chatMode !== nextChatMode) {
                    tempModelSettings = { ...tempModelSettings, chatMode: nextChatMode };
                }

                // 更新多模型选择，过滤掉无效的模型
                if (settings.selectedMultiModels !== undefined) {
                    const validModels = settings.selectedMultiModels.filter(model => {
                        const config = getProviderAndModelConfig(model.provider, model.modelId);
                        return config !== null;
                    });
                    selectedMultiModels = [];

                    // 如果过滤后的模型列表与原列表不同，更新设置
                    if (validModels.length !== settings.selectedMultiModels.length) {
                        settings.selectedMultiModels = [];
                        // 异步保存设置
                        plugin.saveSettings(settings).catch(err => {
                            console.error('Failed to save filtered multi-models:', err);
                        });
                    }
                }

                // 实时更新字体大小设置
                if (newSettings.messageFontSize !== undefined) {
                    messageFontSize = newSettings.messageFontSize;
                }

                // 实时更新多模型视图样式设置
                if (newSettings.multiModelViewMode !== undefined) {
                    multiModelViewMode = newSettings.multiModelViewMode;
                    multiModelLayout = newSettings.multiModelViewMode; // 同步更新多模型布局
                }

                // 更新系统提示词
                if (settings.aiSystemPrompt && messages.length === 0) {
                    messages = [{ role: 'system', content: settings.aiSystemPrompt }];
                } else if (settings.aiSystemPrompt && messages[0]?.role === 'system') {
                    messages[0].content = settings.aiSystemPrompt;
                }

                // console.debug('AI Sidebar: ' + t('common.configComplete'));
            }
        });

        // 添加全局点击事件监听器
        document.addEventListener('click', handleClickOutside);
        // 弹层键盘支持：Esc 关闭弹层并恢复焦点，Tab 可聚焦可见元素（由浏览器原生处理）
        document.addEventListener('keydown', handleGlobalKeydownForDialogs, true);
        // 添加全局滚动事件监听器以关闭右键菜单
        document.addEventListener('scroll', closeContextMenu, true);
        // 添加全局复制事件监听器
        document.addEventListener('copy', handleCopyEvent);
        // 选区保护：有选区时不自动滚动
        document.addEventListener('selectionchange', handleSelectionChangeForAutoScroll);
        window.addEventListener(addChatContextEvent, onAddChatContextEvent);
    });

    onDestroy(async () => {
        // 取消订阅
        if (unsubscribe) {
            unsubscribe();
        }

        // 移除全局点击事件监听器
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleGlobalKeydownForDialogs, true);
        // 移除全局滚动事件监听器
        document.removeEventListener('scroll', closeContextMenu, true);
        // 移除全局复制事件监听器
        document.removeEventListener('copy', handleCopyEvent);
        document.removeEventListener('selectionchange', handleSelectionChangeForAutoScroll);
        window.removeEventListener(addChatContextEvent, onAddChatContextEvent);

        // 保存工具配置
        if (isToolConfigLoaded) {
            await saveToolsConfig();
        }

        // 如果有未保存的更改，自动保存当前会话
        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            await saveCurrentSession(true); // 静默保存，不显示提示
        }
    });

    // 迁移旧设置到新结构
    function migrateOldSettings() {
        if (!settings.aiProviders && settings.aiProvider && settings.aiApiKey) {
            // 创建新的提供商结构
            if (!settings.aiProviders) {
                settings.aiProviders = {
                    gemini: { apiKey: '', customApiUrl: '', models: [] },
                    deepseek: { apiKey: '', customApiUrl: '', models: [] },
                    openai: { apiKey: '', customApiUrl: '', models: [] },
                    volcano: { apiKey: '', customApiUrl: '', models: [] },
                    customProviders: [],
                };
            }

            // 迁移旧的设置
            const oldProvider = settings.aiProvider;
            if (settings.aiProviders[oldProvider]) {
                settings.aiProviders[oldProvider].apiKey = settings.aiApiKey || '';
                settings.aiProviders[oldProvider].customApiUrl = settings.aiCustomApiUrl || '';

                // 如果有模型，添加到列表
                if (settings.aiModel) {
                    settings.aiProviders[oldProvider].models = [
                        {
                            id: settings.aiModel,
                            name: settings.aiModel,
                            temperature: settings.aiTemperature || 1,
                            maxTokens: settings.aiMaxTokens || -1,
                        },
                    ];
                    settings.currentProvider = oldProvider;
                    settings.currentModelId = settings.aiModel;
                }
            }

            // 保存迁移后的设置
            plugin.saveSettings(settings);
        }

        // 确保 customProviders 数组存在
        if (settings.aiProviders && !settings.aiProviders.customProviders) {
            settings.aiProviders.customProviders = [];
        }
    }

    // 自动调整textarea高度
    function autoResizeTextarea() {
        if (textareaElement) {
            textareaElement.style.height = 'auto';
            textareaElement.style.height = Math.min(textareaElement.scrollHeight, 200) + 'px';
        }
    }

    // 监听输入变化
    $: {
        currentInput;
        tick().then(autoResizeTextarea);
    }

    // DOM 后处理（代码高亮 / 公式渲染 / 引用链接 / 图片点击等）
    // 注意：流式阶段会高频更新，必须避免每 chunk 扫描 messagesContainer
    let messagesContainerPostProcessScheduled = false;
    let messagesContainerPostProcessPending = false;
    let messagesContainerPostProcessDeferredWhileLoading = false;

    function scheduleMessagesContainerPostProcess() {
        if (isLoading) {
            messagesContainerPostProcessDeferredWhileLoading = true;
            return;
        }

        // 若之前因为流式被延后，这里确保只补一次
        messagesContainerPostProcessDeferredWhileLoading = false;

        if (messagesContainerPostProcessScheduled) {
            messagesContainerPostProcessPending = true;
            return;
        }

        messagesContainerPostProcessScheduled = true;
        window.setTimeout(async () => {
            try {
                // 等待 DOM 完全更新后再处理
                await tick();
                await tick();
                const container = messagesContainer;
                if (!container) return;
                highlightCodeBlocks(container);
                cleanupCodeBlocks(container);
                renderMathFormulas(container);
                setupBlockRefLinks(container);
                setupImageClickHandlers(container);
            } finally {
                messagesContainerPostProcessScheduled = false;
                if (messagesContainerPostProcessPending) {
                    messagesContainerPostProcessPending = false;
                    scheduleMessagesContainerPostProcess();
                }
            }
        }, 0);
    }

    // 当消息、多模型响应或选择页签/答案变化时，触发 DOM 后处理（流式阶段仅标记 deferred）
    $: {
        // 保持对变量的引用以便 Svelte 触发依赖
        messages;
        multiModelResponses;
        selectedTabIndex;
        selectedAnswerIndex;
        thinkingCollapsed;
        isLoading;

        scheduleMessagesContainerPostProcess();
    }

    $: if (!streamingThinking) {
        streamingThinkingExpanded = false;
    }
    $: if (!streamingCodexTimeline.length) {
        streamingCodexTimelineExpanded = false;
    }
    $: if (!streamingToolCalls.length) {
        streamingToolCallsExpanded = false;
    }
    $: if (!streamingSearchCalls.length) {
        streamingSearchCallsExpanded = false;
    }

    // 处理粘贴事件
    async function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // 处理图片
            if (item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await addImageAttachment(file);
                }
                return;
            }

            // 处理文件
            if (item.kind === 'file') {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await addFileAttachment(file);
                }
                return;
            }
        }
    }

    // 添加图片附件
    async function addImageAttachment(file: File) {
        if (!file.type.startsWith('image/')) {
            pushErrMsg(t('aiSidebar.errors.imageOnly'));
            return;
        }

        try {
            isUploadingFile = true;

            // 保存为 SiYuan 资源
            const assetPath = await saveAsset(file, file.name);
            // 本地预览使用 Blob URL
            const blobUrl = URL.createObjectURL(file);

            currentAttachments = [
                ...currentAttachments,
                {
                    type: 'image',
                    name: file.name,
                    data: blobUrl,
                    path: assetPath,
                    mimeType: file.type,
                },
            ];
        } catch (error) {
            console.error('Add image error:', error);
            pushErrMsg(t('aiSidebar.errors.addImageFailed'));
        } finally {
            isUploadingFile = false;
        }
    }

    // 添加文件附件
    async function addFileAttachment(file: File) {
        // 只支持文本文件和图片
        const isText =
            file.type.startsWith('text/') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.json') ||
            file.name.endsWith('.xml') ||
            file.name.endsWith('.csv');

        const isImage = file.type.startsWith('image/');

        if (!isText && !isImage) {
            pushErrMsg(t('aiSidebar.errors.textAndImageOnly'));
            return;
        }

        // 检查文件大小 (文本文件最大 5MB，图片最大 10MB)
        const maxSize = isImage ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxSize) {
            pushErrMsg(t('aiSidebar.errors.fileTooLarge'));
            return;
        }

        try {
            isUploadingFile = true;

            if (isImage) {
                await addImageAttachment(file);
            } else {
                // 读取文本文件内容
                const content = await file.text();
                // 保存为 SiYuan 资源
                const assetPath = await saveAsset(
                    new Blob([content], { type: file.type }),
                    file.name
                );

                currentAttachments = [
                    ...currentAttachments,
                    {
                        type: 'file',
                        name: file.name,
                        data: content, // 内存中保持 content 方便立即发送给 AI
                        path: assetPath,
                        mimeType: file.type,
                    },
                ];
            }
        } catch (error) {
            console.error('Add file error:', error);
            pushErrMsg(t('aiSidebar.errors.addFileFailed'));
        } finally {
            isUploadingFile = false;
        }
    }

    // 文件转 base64
    function fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // 触发文件选择
    function triggerFileUpload() {
        fileInputElement?.click();
    }

    // 处理文件选择
    async function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = input.files;

        if (!files || files.length === 0) return;

        for (let i = 0; i < files.length; i++) {
            await addFileAttachment(files[i]);
        }

        // 清空 input，允许重复选择同一文件
        input.value = '';
    }

    // 移除附件
    function removeAttachment(index: number) {
        currentAttachments = currentAttachments.filter((_, i) => i !== index);
    }

    // 打开网页链接对话框
    function openWebLinkDialog() {
        isWebLinkDialogOpen = true;
        webLinkInput = '';
        tick().then(() => webLinkDialogTextareaElement?.focus());
    }

    // 关闭网页链接对话框
    function closeWebLinkDialog() {
        isWebLinkDialogOpen = false;
        webLinkInput = '';
        // 恢复焦点到输入框
        tick().then(() => textareaElement?.focus());
    }

    function closeSearchDialog() {
        isSearchDialogOpen = false;
        tick().then(() => textareaElement?.focus());
    }

    function toggleSearchDialog() {
        if (isSearchDialogOpen) {
            closeSearchDialog();
            return;
        }
        isSearchDialogOpen = true;
        if (!searchKeyword.trim()) {
            searchDocuments();
        }
        tick().then(() => searchDialogInputElement?.focus());
    }

    // 爬取网页内容并转换为Markdown
    async function fetchWebPages() {
        if (!webLinkInput.trim()) {
            pushErrMsg('请输入至少一个链接');
            return;
        }

        // 解析多个链接（按换行符分割）
        const links = webLinkInput
            .split('\n')
            .map(link => link.trim())
            .filter(link => link.length > 0);

        if (links.length === 0) {
            pushErrMsg('请输入有效的链接');
            return;
        }

        isFetchingWebContent = true;
        let successCount = 0;

        try {
            // 使用工具函数批量解析网页
            const results = await parseMultipleWebPages(links, (current, total, url, success) => {
                if (success) {
                    pushMsg(`正在获取 (${current}/${total}): ${url}`);
                }
            });

            // 处理解析结果
            for (const result of results) {
                if (result.success) {
                    // 从 URL 中提取文件名
                    const urlObj = new URL(result.url);
                    const fileName = `${urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.md`;

                    // 保存为 SiYuan 资源
                    const assetPath = await saveAsset(
                        new Blob([result.markdown], { type: 'text/markdown' }),
                        fileName
                    );

                    // 添加到附件列表，标记为网页类型
                    currentAttachments = [
                        ...currentAttachments,
                        {
                            type: 'file',
                            name: result.url,
                            data: result.markdown,
                            path: assetPath,
                            mimeType: 'text/markdown',
                            isWebPage: true, // 标记为网页附件
                            url: result.url, // 保存原始URL
                        },
                    ];

                    successCount++;
                    pushMsg(`✓ 成功获取: ${result.title || result.url}`);
                } else {
                    // 处理错误
                    if (
                        result.error?.includes('CORS') ||
                        result.error?.includes('Failed to fetch')
                    ) {
                        pushErrMsg(`✗ CORS 限制: ${result.url} - 该网站不允许跨域访问`);
                    } else {
                        pushErrMsg(`✗ 获取失败: ${result.url} - ${result.error}`);
                    }
                }
            }

            // 如果有成功的结果，关闭弹窗
            if (successCount > 0) {
                closeWebLinkDialog();
            }
        } catch (error) {
            console.error('Fetch web pages error:', error);
            pushErrMsg('获取网页内容失败');
        } finally {
            isFetchingWebContent = false;
        }
    }

    function updateSelectionActiveInMessagesContainer() {
        const container = messagesContainer;
        if (!container) {
            selectionActiveInMessagesContainer = false;
            return;
        }

        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed) {
            selectionActiveInMessagesContainer = false;
            return;
        }

        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !focusNode) {
            selectionActiveInMessagesContainer = false;
            return;
        }

        selectionActiveInMessagesContainer =
            container.contains(anchorNode) && container.contains(focusNode);
    }

    function handleSelectionChangeForAutoScroll() {
        const wasActive = selectionActiveInMessagesContainer;
        updateSelectionActiveInMessagesContainer();

        // 若选区刚结束且仍处于 autoScroll=true，则“追一下”底部内容（避免选区保护期间错过的消息）
        if (wasActive && !selectionActiveInMessagesContainer && autoScroll && hasUnreadMessagesBelow) {
            scheduleScrollToBottom();
        }
    }

    // 检查是否在底部
    function isAtBottom() {
        if (!messagesContainer) return true;
        const threshold = 24; // 24px 的阈值，避免轻微上滑仍被视作“在底部”
        const scrollBottom =
            messagesContainer.scrollHeight -
            messagesContainer.scrollTop -
            messagesContainer.clientHeight;
        return scrollBottom < threshold;
    }

    // 处理滚动事件
    function handleScroll() {
        if (!messagesContainer) return;

        const currentScrollTop = messagesContainer.scrollTop;
        const scrolledUp = currentScrollTop < lastScrollTop - 2;
        const scrolledDown = currentScrollTop > lastScrollTop + 2;
        lastScrollTop = currentScrollTop;

        const atBottom = isAtBottom();

        // 用户手动滚动（向上，或向下但尚未到底）优先视为“我要暂停自动滚动”
        if (scrolledUp || (scrolledDown && !atBottom)) {
            autoScroll = false;
            return;
        }

        // 如果用户滚动到底部附近，恢复自动滚动
        if (atBottom) {
            autoScroll = true;
            hasUnreadMessagesBelow = false;
        } else if (isLoading) {
            // 如果正在加载且用户滚动离开底部，停止自动滚动
            autoScroll = false;
        }
    }

    // 全屏切换
    function toggleFullscreen() {
        if (!sidebarContainer) return;
        isFullscreen = !isFullscreen;
    }

    // 滚动到底部
    async function scrollToBottom(force = false) {
        await tick();
        if (!messagesContainer) return;

        // 选区保护：自动滚动时不抢占用户选区
        if (!force && selectionActiveInMessagesContainer) {
            hasUnreadMessagesBelow = true;
            return;
        }

        if (force || autoScroll) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            lastScrollTop = messagesContainer.scrollTop;
            hasUnreadMessagesBelow = false;
        }
    }

    // 高频流式输出时，合并滚动请求以减少抖动
    let scrollToBottomScheduled = false;
    let scrollToBottomPending = false;

    function scheduleScrollToBottom() {
        if (!messagesContainer) return;

        // 用户滚动打断 / 选区保护：不抢占滚动；改为提示“底部有新内容”
        if (!autoScroll || selectionActiveInMessagesContainer) {
            hasUnreadMessagesBelow = true;
            return;
        }

        if (scrollToBottomScheduled) {
            scrollToBottomPending = true;
            return;
        }
        scrollToBottomScheduled = true;
        window.setTimeout(async () => {
            try {
                await scrollToBottom();
            } finally {
                scrollToBottomScheduled = false;
                if (scrollToBottomPending) {
                    scrollToBottomPending = false;
                    scheduleScrollToBottom();
                }
            }
        }, 0);
    }

    async function jumpToBottom() {
        autoScroll = true;
        hasUnreadMessagesBelow = false;
        await scrollToBottom(true);
    }

    // 图片/视频加载后内容高度变化：自动跟随到底部（仅当 autoScroll=true）
    function autoScrollOnMediaLoad(node: HTMLElement) {
        const handler = (event: Event) => {
            if (!autoScroll) return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName ? target.tagName.toUpperCase() : '';
            if (tag !== 'IMG' && tag !== 'VIDEO') return;
            scheduleScrollToBottom();
        };

        node.addEventListener('load', handler, true);
        node.addEventListener('error', handler, true);

        return {
            destroy() {
                node.removeEventListener('load', handler, true);
                node.removeEventListener('error', handler, true);
            },
        };
    }

    let wasLoadingForScroll = false;

    afterUpdate(() => {
        if (wasLoadingForScroll && !isLoading) {
            void scrollToBottom();
        }
        wasLoadingForScroll = isLoading;
    });

    // 滚动到顶部
    async function scrollToTop() {
        await tick();
        if (messagesContainer) {
            messagesContainer.scrollTop = 0;
        }
    }

    // 切换模型
    function handleModelSelect(event: CustomEvent<{ provider: string; modelId: string }>) {
        const { provider, modelId } = event.detail;
        currentProvider = provider;
        currentModelId = modelId;

        // 保存选择
        settings.currentProvider = provider;
        settings.currentModelId = modelId;
        plugin.saveSettings(settings);
    }

    // 处理多模型选择变化
    function handleMultiModelChange(
        event: CustomEvent<Array<{ provider: string; modelId: string }>>
    ) {
        selectedMultiModels = event.detail;

        // 保存到设置中
        settings.selectedMultiModels = event.detail;
        plugin.saveSettings(settings);
    }

    // 处理多模型开关切换
    function handleToggleMultiModel(event: CustomEvent<boolean>) {
        enableMultiModel = event.detail;

        // 如果禁用多模型,清除相关状态
        if (!enableMultiModel) {
            multiModelResponses = [];
            isWaitingForAnswerSelection = false;
            selectedAnswerIndex = null;
        }
    }

    // 处理多模型中模型的思考模式切换
    function handleToggleModelThinking(
        event: CustomEvent<{ provider: string; modelId: string; enabled: boolean }>
    ) {
        const { provider, modelId, enabled } = event.detail;

        // 查找并更新 provider 中对应模型的 thinkingEnabled 设置
        let providerConfig: any = null;

        // 检查是否是内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 检查是否是自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            if (model) {
                model.thinkingEnabled = enabled;
                // 触发响应式更新
                providers = { ...providers };
                // 保存设置
                settings.aiProviders = providers;
                plugin.saveSettings(settings);
            }
        }
    }

    // 处理模型设置应用
    async function handleApplyModelSettings(
        event: CustomEvent<{
            contextCount: number;
            temperature: number;
            temperatureEnabled: boolean;
            systemPrompt: string;
            modelSelectionEnabled?: boolean;
            selectedModels?: Array<{
                provider: string;
                modelId: string;
                thinkingEnabled?: boolean;
                thinkingEffort?: ThinkingEffort;
            }>;
            enableMultiModel?: boolean;
            chatMode?: 'ask' | 'edit' | 'agent';
        }>
    ) {
        const newSettings = event.detail;
        const requestedChatMode = (newSettings.chatMode ?? 'ask') as ChatMode;
        const nextChatMode = isCodexMode
            ? normalizeChatModeForCodex(requestedChatMode)
            : requestedChatMode;

        // 更新tempModelSettings，保持所有字段的状态
        tempModelSettings = {
            contextCount: newSettings.contextCount,
            temperature: newSettings.temperature,
            temperatureEnabled: newSettings.temperatureEnabled,
            systemPrompt: newSettings.systemPrompt,
            modelSelectionEnabled: newSettings.modelSelectionEnabled ?? false,
            selectedModels: newSettings.selectedModels || [],
            enableMultiModel: newSettings.enableMultiModel ?? false,
            chatMode: nextChatMode,
        };

        // 应用聊天模式
        if (newSettings.chatMode) {
            await updateChatModeSetting(nextChatMode);
        }

        // 如果启用了模型选择
        if (
            newSettings.modelSelectionEnabled &&
            newSettings.selectedModels &&
            newSettings.selectedModels.length > 0
        ) {
            // 只有ask模式才能启用多模型
            if (newSettings.enableMultiModel && nextChatMode === 'ask') {
                // 多模型模式
                enableMultiModel = true;

                // 先更新设置对象
                settings.selectedMultiModels = [...newSettings.selectedModels];

                // 然后更新本地变量
                selectedMultiModels = [...newSettings.selectedModels];

                // 最后保存设置
                await plugin.saveSettings(settings);
            } else {
                // 单模型模式
                enableMultiModel = false;
                const selectedModel = newSettings.selectedModels[0];
                if (selectedModel) {
                    // 先更新设置对象（包括selectedProviderId）
                    settings.selectedProviderId = selectedModel.provider;
                    settings.currentProvider = selectedModel.provider;
                    settings.currentModelId = selectedModel.modelId;

                    // 然后更新本地变量
                    currentProvider = selectedModel.provider;
                    currentModelId = selectedModel.modelId;

                    // 最后保存设置
                    await plugin.saveSettings(settings);
                }
            }
        } else {
            // 如果未启用模型选择，确保禁用多模型模式
            enableMultiModel = false;
        }
    }

    // 获取当前提供商配置
    function getCurrentProviderConfig() {
        if (!currentProvider) return null;

        // 检查是否是内置平台
        if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
            return providers[currentProvider];
        }

        // 检查是否是自定义平台
        if (providers.customProviders && Array.isArray(providers.customProviders)) {
            return providers.customProviders.find((p: any) => p.id === currentProvider);
        }

        return null;
    }

    // 获取当前模型配置
    function getCurrentModelConfig() {
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig || !currentModelId) {
            return null;
        }
        return providerConfig.models.find((m: any) => m.id === currentModelId);
    }

    // 思考模式状态（响应式）
    // 确保追踪 currentProvider、currentModelId 和 providers 的变化
    $: isThinkingModeEnabled = (() => {
        // 确保读取最新的 providers 数据
        if (!currentProvider || !currentModelId) {
            return false;
        }

        // 从 settings 中读取最新的配置，确保数据是最新的
        const providerConfig = (() => {
            // 检查是否是自定义平台
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            // 检查是否是内置平台
            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            // 回退到 providers 对象
            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        // 只有当模型支持思考能力时，才返回 thinkingEnabled 的值
        return modelConfig?.capabilities?.thinking ? modelConfig.thinkingEnabled || false : false;
    })();

    // 联网模式状态（响应式）
    $: isWebSearchModeEnabled = (() => {
        if (!currentProvider || !currentModelId) {
            return false;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return modelConfig?.capabilities?.webSearch ? modelConfig.webSearchEnabled || false : false;
    })();

    // 是否显示思考模式按钮（只有支持思考的模型才显示）
    $: showThinkingToggle = (() => {
        if (!currentProvider || !currentModelId) {
            return false;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return modelConfig?.capabilities?.thinking || false;
    })();

    // 是否显示联网模式按钮（只有 Gemini 模型支持联网）
    $: showWebSearchToggle = (() => {
        if (!currentProvider || !currentModelId) {
            return false;
        }

        // 只有模型名称以 gemini 开头的模型显示联网搜索按钮
        if (!currentModelId.toLowerCase().startsWith('gemini')) {
            return false;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return false;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return modelConfig?.capabilities?.webSearch || false;
    })();

    // 是否显示思考程度选择器（只有 Gemini 和 Claude 模型在启用思考模式时才显示）
    $: showThinkingEffortSelector = (() => {
        if (!isThinkingModeEnabled || !currentModelId) {
            return false;
        }
        // 检查是否是支持思考程度设置的模型（Gemini 或 Claude）
        return (
            isSupportedThinkingGeminiModel(currentModelId) ||
            isSupportedThinkingClaudeModel(currentModelId)
        );
    })();

    // 当前模型是否是 Gemini 模型（用于决定是否显示"默认"选项）
    $: isCurrentModelGemini = currentModelId
        ? isSupportedThinkingGeminiModel(currentModelId)
        : false;

    // 当前模型是否是 Gemini 3 系列（用于限制思考程度选项）
    $: isCurrentModelGemini3 = currentModelId ? isGemini3Model(currentModelId) : false;

    // 当前思考程度设置
    $: currentThinkingEffort = (() => {
        if (!currentProvider || !currentModelId) {
            return 'low' as ThinkingEffort;
        }

        const providerConfig = (() => {
            const customProvider = settings.aiProviders?.customProviders?.find(
                (p: any) => p.id === currentProvider
            );
            if (customProvider) {
                return customProvider;
            }

            if (settings.aiProviders?.[currentProvider]) {
                return settings.aiProviders[currentProvider];
            }

            if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
                return providers[currentProvider];
            }

            if (providers.customProviders && Array.isArray(providers.customProviders)) {
                return providers.customProviders.find((p: any) => p.id === currentProvider);
            }

            return null;
        })();

        if (!providerConfig) {
            return 'low' as ThinkingEffort;
        }

        const modelConfig = providerConfig.models?.find((m: any) => m.id === currentModelId);
        return (modelConfig?.thinkingEffort || 'low') as ThinkingEffort;
    })();

    // 更新思考程度
    async function updateThinkingEffort(effort: ThinkingEffort) {
        if (!currentProvider || !currentModelId) {
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            return;
        }

        modelConfig.thinkingEffort = effort;

        // 获取提供商配置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            return;
        }

        // 找到模型在数组中的索引并更新
        const modelIndex = providerConfig.models.findIndex((m: any) => m.id === currentModelId);
        if (modelIndex !== -1) {
            providerConfig.models[modelIndex] = { ...modelConfig };
            providerConfig.models = [...providerConfig.models];
        }

        // 更新 settings 并保存
        const isCustomProvider =
            settings.aiProviders.customProviders?.some((p: any) => p.id === currentProvider) ||
            false;

        if (isCustomProvider) {
            const customProviders = settings.aiProviders.customProviders || [];
            const customProviderIndex = customProviders.findIndex(
                (p: any) => p.id === currentProvider
            );
            if (customProviderIndex !== -1) {
                customProviders[customProviderIndex] = { ...providerConfig };
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        customProviders: [...customProviders],
                    },
                };
            }
        } else {
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [currentProvider]: providerConfig,
                },
            };
        }

        providers = {
            ...providers,
            [currentProvider]: providerConfig,
        };

        await plugin.saveSettings(settings);
    }

    // 处理思考程度选择器变化
    function handleThinkingEffortChange(event: Event) {
        const target = event.currentTarget as HTMLSelectElement;
        updateThinkingEffort(target.value as ThinkingEffort);
    }

    // 切换思考模式
    async function toggleThinkingMode() {
        if (!currentProvider || !currentModelId) {
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            return;
        }

        // 确保 capabilities 对象存在
        if (!modelConfig.capabilities) {
            modelConfig.capabilities = {};
        }

        // 只有当模型支持思考能力时，才能切换
        if (!modelConfig.capabilities.thinking) {
            return;
        }

        // 切换思考模式启用状态
        modelConfig.thinkingEnabled = !modelConfig.thinkingEnabled;

        // 获取提供商配置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            return;
        }

        // 找到模型在数组中的索引并更新
        const modelIndex = providerConfig.models.findIndex((m: any) => m.id === currentModelId);
        if (modelIndex !== -1) {
            providerConfig.models[modelIndex] = { ...modelConfig };
            providerConfig.models = [...providerConfig.models];
        }

        // 更新 settings 并保存
        // 检查是否是自定义平台（通过检查 customProviders 数组）
        const isCustomProvider =
            settings.aiProviders.customProviders?.some((p: any) => p.id === currentProvider) ||
            false;

        if (isCustomProvider) {
            // 自定义平台：更新 customProviders 数组
            const customProviders = settings.aiProviders.customProviders || [];
            const customProviderIndex = customProviders.findIndex(
                (p: any) => p.id === currentProvider
            );
            if (customProviderIndex !== -1) {
                customProviders[customProviderIndex] = { ...providerConfig };
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        customProviders: [...customProviders],
                    },
                };
            }
        } else {
            // 内置平台：直接更新
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [currentProvider]: providerConfig,
                },
            };
        }

        // 更新 providers 对象以触发响应式更新
        providers = {
            ...providers,
            [currentProvider]: providerConfig,
        };

        // 保存设置（settings 已经在上面更新过了）
        await plugin.saveSettings(settings);
    }

    // 切换联网模式
    async function toggleWebSearchMode() {
        if (!currentProvider || !currentModelId) {
            return;
        }

        const modelConfig = getCurrentModelConfig();
        if (!modelConfig) {
            return;
        }

        // 确保 capabilities 对象存在
        if (!modelConfig.capabilities) {
            modelConfig.capabilities = {};
        }

        // 只有当模型支持联网能力时，才能切换
        if (!modelConfig.capabilities.webSearch) {
            return;
        }

        // 切换联网模式启用状态
        modelConfig.webSearchEnabled = !modelConfig.webSearchEnabled;

        // 获取提供商配置
        const providerConfig = getCurrentProviderConfig();
        if (!providerConfig) {
            return;
        }

        // 找到模型在数组中的索引并更新
        const modelIndex = providerConfig.models.findIndex((m: any) => m.id === currentModelId);
        if (modelIndex !== -1) {
            providerConfig.models[modelIndex] = { ...modelConfig };
            providerConfig.models = [...providerConfig.models];
        }

        // 更新 settings 并保存
        const isCustomProvider =
            settings.aiProviders.customProviders?.some((p: any) => p.id === currentProvider) ||
            false;

        if (isCustomProvider) {
            const customProviders = settings.aiProviders.customProviders || [];
            const customProviderIndex = customProviders.findIndex(
                (p: any) => p.id === currentProvider
            );
            if (customProviderIndex !== -1) {
                customProviders[customProviderIndex] = { ...providerConfig };
                settings = {
                    ...settings,
                    aiProviders: {
                        ...settings.aiProviders,
                        customProviders: [...customProviders],
                    },
                };
            }
        } else {
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    [currentProvider]: providerConfig,
                },
            };
        }

        providers = {
            ...providers,
            [currentProvider]: providerConfig,
        };

        await plugin.saveSettings(settings);
    }

    // 获取指定提供商和模型的配置
    function getProviderAndModelConfig(provider: string, modelId: string) {
        let providerConfig: any = null;

        // 检查是否是内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 检查是否是自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (!providerConfig) return null;

        const modelConfig = providerConfig.models.find((m: any) => m.id === modelId);
        return { providerConfig, modelConfig };
    }

    // 多模型发送消息
    async function sendMultiModelMessage() {
        // 保存用户输入和附件
        const userContent = currentInput.trim();
        const userAttachments = [...currentAttachments];
        const userContextDocuments = [...contextDocuments];

        // 获取所有上下文文档的最新内容
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        if (userContextDocuments.length > 0) {
            for (const doc of userContextDocuments) {
                try {
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        contextDocumentsWithLatestContent.push({
                            id: doc.id,
                            title: doc.title,
                            content: data.content,
                            type: doc.type,
                        });
                    } else {
                        contextDocumentsWithLatestContent.push(doc);
                    }
                } catch (error) {
                    console.error(`Failed to get latest content for block ${doc.id}:`, error);
                    contextDocumentsWithLatestContent.push(doc);
                }
            }
        }

        // 检查最后一条消息是否已经是用户消息（重新生成的情况）
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isRegenerate = lastMessage && lastMessage.role === 'user' && !userContent;

        // 只有在不是重新生成的情况下才创建新的用户消息
        if (!isRegenerate) {
            // 创建用户消息
            const userMessage: Message = {
                role: 'user',
                content: userContent,
                attachments: userAttachments.length > 0 ? userAttachments : undefined,
                contextDocuments:
                    contextDocumentsWithLatestContent.length > 0
                        ? contextDocumentsWithLatestContent
                        : undefined,
            };

            messages = [...messages, userMessage];
        }
        currentInput = '';
        currentAttachments = [];
        contextDocuments = [];
        isLoading = true;
        isWaitingForAnswerSelection = true;
        selectedAnswerIndex = null; // 重置选择的答案索引，因为这是新的多模型对话
        hasUnsavedChanges = true;
        autoScroll = true;
        isAborted = false; // 重置中断标志

        await scrollToBottom(true);

        // 如果是第一条用户消息且没有会话ID，立即创建会话
        // 只有在非重新生成的情况下才执行
        if (!isRegenerate) {
            const userMessages = messages.filter(m => m.role === 'user');
            if (userMessages.length === 1 && !currentSessionId) {
                const now = Date.now();
                const newSession: ChatSession = {
                    id: `session_${now}`,
                    title: generateSessionTitleFromText(userContent) || generateSessionTitle(),
                    messages: [...messages],
                    createdAt: now,
                    updatedAt: now,
                };
                sessions = [newSession, ...sessions];
                currentSessionId = newSession.id;
                await saveSessions();

                // 立即执行自动重命名
                autoRenameSession(userContent);
            }
        }

        await scrollToBottom(true);

        // 获取最后一条用户消息（用于 prepareMessagesForAI）
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            isLoading = false;
            return;
        }

        // 准备消息数组（包含上下文）
        // 对于重新生成的情况，使用已有的上下文；对于新消息，使用新获取的上下文
        const contextToUse =
            isRegenerate && lastUserMessage.contextDocuments
                ? lastUserMessage.contextDocuments
                : contextDocumentsWithLatestContent;

        const messagesToSend = await prepareMessagesForAI(
            messages,
            contextToUse,
            lastUserMessage.content as string,
            lastUserMessage
        );

        // 过滤掉无效的模型并初始化多模型响应数组
        const validModels = selectedMultiModels.filter(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return config !== null;
        });

        // 如果有无效模型，给出提示
        if (validModels.length < selectedMultiModels.length) {
            const invalidCount = selectedMultiModels.length - validModels.length;
            pushMsg(
                `有 ${invalidCount} 个模型已从配置中删除，将使用剩余的 ${validModels.length} 个模型`
            );
        }

        // 如果没有有效模型，退回到单模型
        if (validModels.length === 0) {
            pushErrMsg('所选的多模型已全部失效，请重新选择模型');
            enableMultiModel = false;
            return;
        }

        multiModelResponses = validModels.map(model => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            return {
                provider: model.provider,
                modelId: model.modelId,
                modelName: config?.modelConfig?.name || model.modelId,
                content: '',
                thinking: '',
                isLoading: true,
                thinkingCollapsed: false,
                // 使用模型实例的 thinkingEnabled 值，如果没有则使用 modelConfig 中的默认值
                thinkingEnabled:
                    model.thinkingEnabled ?? config?.modelConfig?.thinkingEnabled ?? false,
            };
        });

        // 创建新的 AbortController
        abortController = new AbortController();

        // 标记是否已经创建了助手消息（用于多模型第一次返回时保存会话）
        let assistantMessageCreated = false;
        let assistantMessageIndex = -1;

        // 并发请求所有有效模型
        const promises = validModels.map(async (model, index) => {
            const config = getProviderAndModelConfig(model.provider, model.modelId);
            if (!config) return;

            const { providerConfig, modelConfig } = config;
            if (!providerConfig.apiKey) return;

            // 解析自定义参数
            let customBody = {};
            if (modelConfig.customBody) {
                try {
                    customBody = JSON.parse(modelConfig.customBody);
                } catch (e) {
                    console.error('Failed to parse custom body:', e);
                    multiModelResponses[index].error = '自定义参数 JSON 格式错误';
                    multiModelResponses[index].isLoading = false;
                    multiModelResponses = [...multiModelResponses];
                    return;
                }
            }

            try {
                let fullText = '';
                let thinking = '';

                // 准备联网搜索工具（如果启用）
                let webSearchTools: any[] | undefined = undefined;
                if (modelConfig.capabilities?.webSearch && modelConfig.webSearchEnabled) {
                    const modelIdLower = modelConfig.id.toLowerCase();

                    if (modelIdLower.includes('gemini')) {
                        webSearchTools = [
                            {
                                type: 'function',
                                function: {
                                    name: 'googleSearch',
                                },
                            },
                        ];
                    } else if (modelIdLower.includes('claude')) {
                        // webSearchTools = [
                        //     {
                        //         type: 'web_search_20250305',
                        //         name: 'web_search',
                        //         max_uses: modelConfig.webSearchMaxUses || 5,
                        //     },
                        // ];
                    }
                }

                await chat(
                    model.provider,
                    {
                        apiKey: providerConfig.apiKey,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : modelConfig.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        // 使用模型实例的 thinkingEnabled 值
                        enableThinking:
                            modelConfig.capabilities?.thinking &&
                            (model.thinkingEnabled ?? modelConfig.thinkingEnabled ?? false),
                        // 使用模型实例的 thinkingEffort 值，如果没有则使用 modelConfig 中的默认值
                        reasoningEffort:
                            model.thinkingEffort ?? modelConfig.thinkingEffort ?? 'low',
                        tools: webSearchTools, // 传递联网搜索工具
                        customBody, // 传递自定义参数
                        onThinkingChunk: async (chunk: string) => {
                            thinking += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].thinking = thinking;
                                multiModelResponses = [...multiModelResponses];
                            }
                            scheduleScrollToBottom();
                        },
                        onThinkingComplete: () => {
                            if (multiModelResponses[index] && multiModelResponses[index].thinking) {
                                multiModelResponses[index].thinkingCollapsed = true;
                                multiModelResponses = [...multiModelResponses];
                            }
                        },
                        onChunk: async (chunk: string) => {
                            fullText += chunk;
                            if (multiModelResponses[index]) {
                                multiModelResponses[index].content = fullText;
                                multiModelResponses = [...multiModelResponses];
                            }
                            scheduleScrollToBottom();
                        },
                        onComplete: async (text: string) => {
                            // 如果已经中断，不再处理完成回调
                            if (isAborted) {
                                return;
                            }
                            if (multiModelResponses[index]) {
                                const convertedText = convertLatexToMarkdown(text);
                                // 处理content中的base64图片，保存为assets文件
                                const processedContent =
                                    await saveBase64ImagesInContent(convertedText);
                                multiModelResponses[index].content = processedContent;
                                multiModelResponses[index].thinking = thinking;
                                multiModelResponses[index].isLoading = false;
                                if (thinking && !multiModelResponses[index].thinkingCollapsed) {
                                    multiModelResponses[index].thinkingCollapsed = true;
                                }
                                multiModelResponses = [...multiModelResponses];

                                // 【修复】第一个模型完成时立即保存会话
                                if (!assistantMessageCreated) {
                                    assistantMessageCreated = true;
                                    // 创建包含多模型响应的助手消息
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: '', // 暂时为空，等用户选择后填充
                                        multiModelResponses: [...multiModelResponses],
                                    };
                                    messages = [...messages, assistantMessage];
                                    assistantMessageIndex = messages.length - 1;
                                    hasUnsavedChanges = true;

                                    // 立即保存会话文件
                                    await saveCurrentSession(true);
                                } else if (assistantMessageIndex >= 0) {
                                    // 后续模型完成时更新助手消息的 multiModelResponses
                                    messages[assistantMessageIndex].multiModelResponses = [
                                        ...multiModelResponses,
                                    ];
                                    messages = [...messages];

                                    // 保存更新后的会话
                                    await saveCurrentSession(true);
                                }
                            }
                        },
                        onError: (error: Error) => {
                            // 如果是主动中断，不显示错误
                            if (error.message !== 'Request aborted' && multiModelResponses[index]) {
                                multiModelResponses[index].error = error.message;
                                multiModelResponses[index].isLoading = false;
                                multiModelResponses = [...multiModelResponses];

                                // 【修复】模型出错时也保存会话
                                if (!assistantMessageCreated) {
                                    assistantMessageCreated = true;
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: '',
                                        multiModelResponses: [...multiModelResponses],
                                    };
                                    messages = [...messages, assistantMessage];
                                    assistantMessageIndex = messages.length - 1;
                                    hasUnsavedChanges = true;
                                    saveCurrentSession(true);
                                } else if (assistantMessageIndex >= 0) {
                                    messages[assistantMessageIndex].multiModelResponses = [
                                        ...multiModelResponses,
                                    ];
                                    messages = [...messages];
                                    saveCurrentSession(true);
                                }
                            }
                        },
                    },
                    providerConfig.customApiUrl,
                    providerConfig.advancedConfig
                );
            } catch (error) {
                // 如果是主动中断，不显示错误
                if ((error as Error).message !== 'Request aborted' && multiModelResponses[index]) {
                    multiModelResponses[index].error = (error as Error).message;
                    multiModelResponses[index].isLoading = false;
                    multiModelResponses = [...multiModelResponses];

                    // 【修复】catch 块中也保存会话
                    if (!assistantMessageCreated) {
                        assistantMessageCreated = true;
                        const assistantMessage: Message = {
                            role: 'assistant',
                            content: '',
                            multiModelResponses: [...multiModelResponses],
                        };
                        messages = [...messages, assistantMessage];
                        assistantMessageIndex = messages.length - 1;
                        hasUnsavedChanges = true;
                        saveCurrentSession(true);
                    } else if (assistantMessageIndex >= 0) {
                        messages[assistantMessageIndex].multiModelResponses = [
                            ...multiModelResponses,
                        ];
                        messages = [...messages];
                        saveCurrentSession(true);
                    }
                }
            }
        });

        // 等待所有请求完成
        await Promise.all(promises);

        isLoading = false;
        abortController = null;
    }

    // 准备发送给AI的消息（提取为独立函数以便复用）
    async function prepareMessagesForAI(
        messages: Message[],
        contextDocumentsWithLatestContent: ContextDocument[],
        userContent: string,
        lastUserMessage: Message
    ) {
        // 过滤掉空的 assistant 消息，防止某些 Provider（例如 Kimi）报错
        // 但保留有生图的 assistant 消息
        let messagesToSend = messages
            .filter(msg => {
                if (msg.role === 'system') return false;
                if (msg.role === 'assistant') {
                    const text =
                        typeof msg.content === 'string'
                            ? msg.content
                            : getMessageText(msg.content || []);
                    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
                    const hasReasoning = !!msg.reasoning_content;
                    const hasGeneratedImages =
                        msg.generatedImages && msg.generatedImages.length > 0;
                    // 保留有 tool_calls、reasoning_content 或 generatedImages 的 assistant 消息，即便正文为空
                    return (
                        (text && text.toString().trim() !== '') ||
                        hasToolCalls ||
                        hasReasoning ||
                        hasGeneratedImages
                    );
                }
                return true;
            })
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';

                            // agent模式：文档块只传递ID，不传递内容
                            if (chatMode === 'agent' && doc.type === 'doc') {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }

                            // 其他情况：传递完整内容
                            if (doc.content) {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            } else {
                                // 如果没有内容（agent模式下的文档），只传递ID
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }
                        })
                        .join('\n\n---\n\n');

                    if (hasImages) {
                        const contentParts: any[] = [];
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        let enhancedContent = originalContent;

                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        // 从路径加载图片并转换为 blob URL
                        previousGeneratedImages = await Promise.all(
                            lastAssistantMsg.generatedImages.map(async img => {
                                let imageUrl = '';
                                if (img.path) {
                                    // 从路径加载图片
                                    imageUrl = (await loadAsset(img.path)) || '';
                                } else if (img.data) {
                                    // 兼容旧数据（base64格式）
                                    imageUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
                                }
                                return {
                                    type: 'image_url',
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        // 从附件中获取图片
                        const imageAttachments = lastAssistantMsg.attachments.filter(
                            att => att.type === 'image'
                        );
                        previousGeneratedImages = await Promise.all(
                            imageAttachments.map(async att => {
                                let imageUrl = att.data;
                                // 如果附件有路径且当前data不可用，从路径重新加载
                                if (att.path && (!imageUrl || !imageUrl.startsWith('blob:'))) {
                                    imageUrl = (await loadAsset(att.path)) || att.data;
                                }
                                return {
                                    type: 'image_url',
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url',
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url',
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                if (hasImages || previousGeneratedImages.length > 0) {
                    const contentParts: any[] = [];
                    let textContent = userContent;

                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加用户上传的图片附件
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
                    });

                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    let enhancedContent = userContent;

                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        // 添加系统提示词
        if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 使用临时系统提示词（如果设置了）
        if (tempModelSettings.systemPrompt.trim()) {
            // 如果已有系统提示词，替换它；否则添加新的
            const systemMsgIndex = messagesToSend.findIndex(msg => msg.role === 'system');
            if (systemMsgIndex !== -1) {
                messagesToSend[systemMsgIndex].content = tempModelSettings.systemPrompt;
            } else {
                messagesToSend.unshift({ role: 'system', content: tempModelSettings.systemPrompt });
            }
        }

        // 限制上下文消息数量
        const systemMessages = messagesToSend.filter(msg => msg.role === 'system');
        const otherMessages = messagesToSend.filter(msg => msg.role !== 'system');
        const limitedMessages = otherMessages.slice(-tempModelSettings.contextCount);

        // 建立 tool_call_id => tool 消息的索引，便于补全被截断的链条
        const toolResultById = new Map<string, Message>();
        for (const msg of otherMessages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                toolResultById.set(msg.tool_call_id, msg);
            }
        }

        const limitedMessagesWithToolFix: Message[] = [];
        const includedToolCallIds = new Set<string>();

        for (const msg of limitedMessages) {
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                // 先推入 assistant
                limitedMessagesWithToolFix.push(msg);

                // 紧跟补全每一个 tool_call 的结果，保持顺序
                for (const tc of msg.tool_calls) {
                    const toolMsg = toolResultById.get(tc.id);
                    if (toolMsg && !includedToolCallIds.has(tc.id)) {
                        limitedMessagesWithToolFix.push(toolMsg);
                        includedToolCallIds.add(tc.id);
                    }
                }
                continue;
            }

            if (msg.role === 'tool') {
                // 仅在前一条是对应的 assistant 且未加入过时保留，避免孤立 tool
                const prev = limitedMessagesWithToolFix[limitedMessagesWithToolFix.length - 1];
                if (
                    prev &&
                    prev.role === 'assistant' &&
                    prev.tool_calls?.some(tc => tc.id === msg.tool_call_id) &&
                    msg.tool_call_id &&
                    !includedToolCallIds.has(msg.tool_call_id)
                ) {
                    limitedMessagesWithToolFix.push(msg);
                    includedToolCallIds.add(msg.tool_call_id);
                }
                continue;
            }

            // 其他消息正常保留
            limitedMessagesWithToolFix.push(msg);
        }

        messagesToSend = [...systemMessages, ...limitedMessagesWithToolFix];

        return messagesToSend;
    }

    // 选择多模型答案
    function selectMultiModelAnswer(index: number) {
        const selectedResponse = multiModelResponses[index];
        if (!selectedResponse || selectedResponse.isLoading) return;

        // 不再强制重置布局，保持用户选择的布局样式
        // multiModelLayout = 'tab';

        // 【修复】更新已存在的助手消息，而不是创建新消息
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.multiModelResponses) {
            // 更新已有的助手消息
            lastMessage.content = selectedResponse.content; // 设置为选择的答案内容
            lastMessage.thinking = selectedResponse.thinking || ''; // 保存思考内容
            lastMessage.multiModelResponses = multiModelResponses.map((response, i) => ({
                ...response,
                isSelected: i === index, // 标记哪个被选择
                modelName: i === index ? ' ✅' + response.modelName : response.modelName, // 选择的模型名添加✅
            }));
            messages = [...messages];
        } else {
            // 如果没有找到助手消息（不应该发生），创建新消息
            const assistantMessage: Message = {
                role: 'assistant',
                content: selectedResponse.content,
                thinking: selectedResponse.thinking || '',
                multiModelResponses: multiModelResponses.map((response, i) => ({
                    ...response,
                    isSelected: i === index,
                    modelName: i === index ? ' ✅' + response.modelName : response.modelName,
                })),
            };
            messages = [...messages, assistantMessage];
        }

        // 清除多模型状态（全局多模型响应清除），但记录已选索引用于UI
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = index;
        hasUnsavedChanges = true;

        // 自动保存会话
        saveCurrentSession(true);
    }

    // 自动重命名会话
    async function autoRenameSession(content: string) {
        // 检查是否启用自动重命名
        if (!settings.autoRenameSession) {
            console.log('Auto-rename disabled');
            return;
        }

        // 检查是否配置了重命名模型
        if (!settings.autoRenameModelId) {
            console.log('Auto-rename model not configured');
            return;
        }

        const workingDir = String(settings.codexWorkingDir || '').trim();
        if (!workingDir) {
            console.log('Auto-rename codex workingDir not configured');
            return;
        }

        const modelId = String(settings.autoRenameModelId || '').trim();
        if (!modelId) {
            console.log('Auto-rename model id empty after trim');
            return;
        }
        const renameReasoningRaw = String(settings.autoRenameReasoningEffort || '')
            .trim()
            .toLowerCase();
        const renameReasoningEffort =
            renameReasoningRaw === 'medium' ||
            renameReasoningRaw === 'high' ||
            renameReasoningRaw === 'xhigh'
                ? renameReasoningRaw
                : 'low';
        const targetSessionId = currentSessionId;
        if (!targetSessionId) {
            console.log('Auto-rename skipped: no active session');
            return;
        }

        console.log('Starting auto-rename for session:', targetSessionId);

        try {
            // 使用自定义提示词模板，替换 {message} 占位符
            const promptTemplate =
                settings.autoRenamePrompt ||
                '请根据以下内容生成一个简洁的会话标题（不超过20个字，不要使用引号）：\n\n{message}';
            const promptBody = promptTemplate.replace('{message}', content);
            const prompt = [
                '# Task',
                '请根据用户消息生成一个简洁会话标题。',
                '',
                '# Output Rules',
                '- 仅输出标题本身',
                '- 不要解释',
                '- 不要使用引号',
                '- 不要输出 Markdown 或列表符号',
                '- 标题长度控制在 20 个汉字以内',
                '',
                '# Input',
                promptBody,
            ].join('\n');

            const stderrLines: string[] = [];
            let generatedTitle = '';
            const appendTitle = (chunk: string) => {
                const text = String(chunk || '');
                if (!text.trim()) return;
                generatedTitle += text;
            };

            const fs = nodeRequireForSidebar<any>('fs');
            const mcpResolved = resolveSiyuanMcpScriptPath();
            if (!fs.existsSync(mcpResolved.scriptPath)) {
                console.error('Auto-rename skipped: MCP script missing', mcpResolved.scriptPath);
                return;
            }

            const handle = runCodexExec({
                cliPath: settings.codexCliPath,
                workingDir,
                prompt,
                mcpScriptPath: mcpResolved.scriptPath,
                skipGitRepoCheck: settings.codexSkipGitRepoCheck !== false,
                modelOverride: modelId,
                reasoningEffort: renameReasoningEffort as 'low' | 'medium' | 'high' | 'xhigh',
                runMode: 'read_only',
                siyuanApiUrl: settings.siyuanApiUrl,
                siyuanApiToken: settings.siyuanApiToken,
                onEvent: (event: CodexExecEvent) => {
                    const type = String(event?.type || '');
                    const typeLower = type.toLowerCase();
                    const item = (event as any)?.item;
                    if (
                        item &&
                        (type === 'item.delta' || type === 'item.completed' || type === 'item.started')
                    ) {
                        const itemType = String(item?.type || '').toLowerCase();
                        const itemText = typeof item?.text === 'string' ? item.text : '';

                        if (itemType.includes('reasoning') || itemType.includes('thinking')) return;
                        if (
                            itemType.includes('tool') ||
                            itemType.includes('mcp') ||
                            itemType.includes('function') ||
                            itemType === 'command_execution'
                        ) {
                            return;
                        }
                        if (itemType === 'assistant_message' || itemType === 'agent_message') {
                            appendTitle(itemText);
                            return;
                        }
                        if (itemText && type !== 'item.started') {
                            appendTitle(itemText);
                            return;
                        }
                    }

                    const delta =
                        typeof (event as any)?.delta === 'string'
                            ? (event as any).delta
                            : typeof (event as any)?.text === 'string'
                              ? (event as any).text
                              : '';
                    if (!delta) return;
                    if (
                        typeLower.includes('reasoning') ||
                        typeLower.includes('thinking') ||
                        typeLower.includes('tool') ||
                        typeLower.includes('mcp')
                    ) {
                        return;
                    }
                    appendTitle(delta);
                },
                onStdErr: (line: string) => {
                    if (line.includes('state db missing rollout path')) return;
                    stderrLines.push(line);
                },
            });

            const result = await handle.completed;

            if (result.exitCode !== 0 && !generatedTitle.trim()) {
                console.error(
                    'Auto-rename codex failed:',
                    stderrLines.slice(-5).join(' | ') || `exit=${result.exitCode}`
                );
                return;
            }

            const titleCandidate = String(generatedTitle || '')
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map(line => line.trim())
                .find(Boolean) || '';

            const cleanTitle = normalizeSessionTitle(
                titleCandidate
                    .replace(/^[-*#>\d\.\)\s]+/, '')
                    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
                    .trim(),
                50
            );

            if (!cleanTitle) {
                console.log('Auto-rename skipped: empty title from codex');
                return;
            }

            const session = sessions.find(s => s.id === targetSessionId);
            if (!session) {
                console.error('Session not found for auto-rename:', targetSessionId);
                return;
            }

            session.title = cleanTitle;
            sessions = [...sessions];
            await saveSessions();
            console.log('Auto-renamed session to:', cleanTitle);
        } catch (error) {
            console.error('Auto-rename session error:', error);
            // 静默失败
        }
    }

    function getCurrentSessionMeta(): ChatSession | undefined {
        if (!currentSessionId) return undefined;
        return sessions.find(s => s.id === currentSessionId);
    }

    function getCurrentSessionCodexThreadId(): string | undefined {
        return getCurrentSessionMeta()?.codexThreadId;
    }

    async function setCurrentSessionCodexThreadId(threadId: string) {
        const tid = String(threadId || '').trim();
        if (!tid || !currentSessionId) return;
        const idx = sessions.findIndex(s => s.id === currentSessionId);
        if (idx === -1) return;
        if (sessions[idx].codexThreadId === tid) return;
        sessions[idx] = { ...sessions[idx], codexThreadId: tid, updatedAt: Date.now() };
        await saveSessions();
    }

    function buildContextTextForPrompt(docs: ContextDocument[]): string {
        if (!docs || docs.length === 0) return '';
        return docs
            .map(doc => {
                const label = doc.type === 'doc' ? '文档' : '块';
                if (doc.content) {
                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                }
                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
            })
            .join('\n\n---\n\n');
    }

    function buildAttachmentTextForPrompt(attachments: MessageAttachment[] | undefined): string {
        if (!attachments || attachments.length === 0) return '';

        const chunks: string[] = [];

        for (const att of attachments) {
            if (att.type === 'file') {
                const title = att.isWebPage ? `网页: ${att.url || att.name}` : `文件: ${att.name}`;
                chunks.push(`## ${title}\n\n\`\`\`\n${att.data || ''}\n\`\`\``);
                continue;
            }

            if (att.type === 'image') {
                const ref =
                    att.path ||
                    (att.data && (att.data.startsWith('http://') || att.data.startsWith('https://'))
                        ? att.data
                        : '');
                if (ref) {
                    chunks.push(`## 图片: ${att.name}\n\n${ref}`);
                } else {
                    chunks.push(`## 图片: ${att.name}\n\n(图片数据已省略)`);
                }
            }
        }

        return chunks.join('\n\n---\n\n');
    }

    function buildUserPromptForCodex(params: {
        userContent: string;
        attachments?: MessageAttachment[];
        contextDocs: ContextDocument[];
    }): string {
        let prompt = params.userContent || '';

        const attachmentText = buildAttachmentTextForPrompt(params.attachments);
        if (attachmentText) {
            prompt += `\n\n---\n\n以下是附件内容：\n\n${attachmentText}`;
        }

        const contextText = buildContextTextForPrompt(params.contextDocs);
        if (contextText) {
            prompt += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
        }

        return prompt.trim();
    }

    function buildCodexModePreamble(mode: ChatMode, runMode: string): string {
        const m = String(runMode || 'read_only');
        const writeBlocked = m === 'read_only';
        const effectiveMode = normalizeChatModeForCodex(mode);
        if (effectiveMode === 'agent') {
            const lines = [
                '你在 SiYuan 笔记中工作，可以通过 MCP 工具操作笔记内容。',
                '当需要读取/修改/创建笔记时，优先调用 `siyuan_*` 工具；不要编造块内容或 ID。',
                '如果用户提供了上下文，其中会包含 `BlockID`；需要操作时请使用这些 ID。',
            ];
            if (writeBlocked) {
                lines.push('注意：当前为只读模式，`siyuan_*` 的写入操作会被拒绝。');
            }
            return lines.join('\n');
        }
        return [
            '当前为问答模式，请先直接回答用户问题。',
            '不要主动修改笔记；只有用户明确要求改动时才调用 `siyuan_*` 工具。',
        ].join('\n');
    }

    function parseNativePercentValue(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
            return value;
        }
        if (typeof value === 'string') {
            const numeric = Number.parseFloat(value.trim());
            if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) {
                return numeric;
            }
        }
        return null;
    }

    function getNestedValue(obj: unknown, path: string[]): unknown {
        let current: any = obj;
        for (const key of path) {
            if (!current || typeof current !== 'object' || !(key in current)) return undefined;
            current = current[key];
        }
        return current;
    }

    function extractCodexNativeContextPercent(event: CodexExecEvent): number | null {
        const candidatePaths = [
            ['context_window_percent'],
            ['context_percent'],
            ['usage', 'context_window_percent'],
            ['usage', 'context_percent'],
            ['metrics', 'context_window_percent'],
            ['metrics', 'context_percent'],
            ['item', 'context_window_percent'],
            ['item', 'context_percent'],
            ['item', 'usage', 'context_window_percent'],
            ['item', 'usage', 'context_percent'],
        ];

        for (const path of candidatePaths) {
            const parsed = parseNativePercentValue(getNestedValue(event, path));
            if (parsed !== null) return parsed;
        }
        return null;
    }

    function stripKramdownIdMarkersForDisplay(content: string): string {
        return String(content || '').replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();
    }

    function normalizeEditOperationFilePath(rawPath: unknown): string {
        const raw = String(rawPath || '').trim();
        if (!raw) return '';
        return raw.replace(/\\/g, '/');
    }

    function safeJsonParse(raw: unknown): any | null {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
            if (fenced && fenced[1]) {
                try {
                    return JSON.parse(fenced[1].trim());
                } catch {
                    return null;
                }
            }
            return null;
        }
    }

    function normalizeCodexToolPayload(rawOutput: unknown): any {
        let payload: any = rawOutput;
        if (typeof payload === 'string') {
            payload = safeJsonParse(payload) ?? payload;
        }
        if (payload && typeof payload === 'object' && Array.isArray(payload.content)) {
            const textItem = payload.content.find((item: any) => item?.type === 'text');
            if (textItem && typeof textItem.text === 'string') {
                const inner = safeJsonParse(textItem.text);
                if (inner && typeof inner === 'object') {
                    payload = inner;
                }
            }
        }
        return payload;
    }

    function normalizeCodexToolArgs(rawArgs: unknown): Record<string, any> {
        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
            return rawArgs as Record<string, any>;
        }
        const parsed = safeJsonParse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, any>;
        }
        return {};
    }

    function firstNonEmptyString(...values: unknown[]): string {
        for (const value of values) {
            const text = String(value || '').trim();
            if (text) return text;
        }
        return '';
    }

    function normalizeToolNameCandidate(raw: unknown): string {
        const text = String(raw || '').trim();
        if (!text) return '';
        const siyuanMatch = text.match(/\bsiyuan_[a-z0-9_]+\b/i);
        if (siyuanMatch?.[0]) return siyuanMatch[0].toLowerCase();
        return text;
    }

    function isGenericToolName(name: string): boolean {
        const normalized = String(name || '').trim().toLowerCase();
        if (!normalized) return true;
        return (
            normalized === 'tool' ||
            normalized === 'search' ||
            normalized === 'function' ||
            normalized === 'mcp' ||
            normalized === 'mcp_tool' ||
            normalized === 'tool_call' ||
            normalized === 'function_call' ||
            normalized === 'mcp_tool_call' ||
            normalized === 'mcp_tool_result' ||
            normalized === 'call_tool'
        );
    }

    function extractMcpServerNameFromUnknown(value: any): string {
        if (!value || typeof value !== 'object') return '';
        return firstNonEmptyString(
            value.server,
            value.server_name,
            value.serverName,
            value.mcp_server,
            value.mcpServer,
            value.mcp?.server,
            value.mcp?.server_name,
            value.item?.server,
            value.item?.server_name,
            value.item?.serverName,
            value.item?.mcp_server,
            value.item?.mcpServer,
            value.item?.mcp?.server,
            value.item?.mcp?.server_name
        );
    }

    function extractSiyuanToolNameFromStructuredData(value: any): string {
        if (!value || typeof value !== 'object') return '';
        const candidate = normalizeToolNameCandidate(
            firstNonEmptyString(
                value.tool,
                value.tool_name,
                value.toolName,
                value.mcp_tool_name,
                value.server_tool_name,
                value.mcp?.tool_name,
                value.mcp?.toolName,
                value.operation?.tool,
                value.operation?.tool_name,
                value.operation?.name,
                value.params?.tool,
                value.params?.tool_name,
                value.params?.name,
                value.arguments?.tool,
                value.arguments?.tool_name,
                value.arguments?.name,
                value.result?.tool,
                value.result?.tool_name,
                value.result?.operation?.tool,
                value.output?.tool,
                value.output?.tool_name,
                value.output?.operation?.tool,
                value.item?.tool,
                value.item?.tool_name,
                value.item?.toolName,
                value.item?.mcp_tool_name,
                value.item?.server_tool_name,
                value.item?.mcp?.tool_name,
                value.item?.mcp?.toolName,
                value.item?.operation?.tool,
                value.item?.operation?.tool_name,
                value.item?.operation?.name
            )
        );
        return candidate.startsWith('siyuan_') ? candidate : '';
    }

    function extractSiyuanToolNameByRegex(value: unknown): string {
        const text = stringifyCodexTraceValue(value, 12000);
        if (!text) return '';
        const match = text.match(/\bsiyuan_[a-z0-9_]+\b/i);
        return match?.[0] ? match[0].toLowerCase() : '';
    }

    function extractToolNameFromUnknown(value: any): string {
        if (!value || typeof value !== 'object') return '';
        const directName = normalizeToolNameCandidate(
            firstNonEmptyString(
                value.tool_name,
                value.toolName,
                value.mcp_tool_name,
                value.server_tool_name,
                value.mcp?.tool_name,
                value.mcp?.toolName,
                value.name,
                value.function?.name,
                value.tool,
                value.tool?.name,
                value.tool?.function?.name,
                value.call?.name,
                value.item?.tool_name,
                value.item?.toolName,
                value.item?.mcp_tool_name,
                value.item?.server_tool_name,
                value.item?.mcp?.tool_name,
                value.item?.mcp?.toolName,
                value.item?.name,
                value.item?.function?.name,
                value.item?.tool,
                value.item?.tool?.name,
                value.item?.tool?.function?.name,
                value.item?.call?.name
            )
        );
        if (directName.startsWith('siyuan_')) return directName;
        if (directName && !isGenericToolName(directName)) return directName;

        const argsRaw = extractToolArgsFromUnknown(value);
        const outputRaw = extractToolOutputFromUnknown(value);
        const normalizedArgs = normalizeCodexToolArgs(argsRaw);
        const normalizedOutput = normalizeCodexToolPayload(outputRaw);
        const serverName = String(extractMcpServerNameFromUnknown(value)).toLowerCase();
        const eventType = firstNonEmptyString(value.type, value.item?.type).toLowerCase();
        const likelyMcp = serverName.includes('mcp') || eventType.includes('mcp');
        const likelySiyuan =
            serverName.includes('siyuan') ||
            extractSiyuanToolNameFromStructuredData(value).startsWith('siyuan_') ||
            extractSiyuanToolNameFromStructuredData(value.item).startsWith('siyuan_');

        const structuredToolName = firstNonEmptyString(
            extractSiyuanToolNameFromStructuredData(value),
            extractSiyuanToolNameFromStructuredData(value.item),
            extractSiyuanToolNameFromStructuredData(normalizedArgs),
            extractSiyuanToolNameFromStructuredData(normalizedOutput)
        );
        if (structuredToolName && (likelySiyuan || likelyMcp || isGenericToolName(directName))) {
            return structuredToolName;
        }

        const regexToolName = firstNonEmptyString(
            extractSiyuanToolNameByRegex(argsRaw),
            extractSiyuanToolNameByRegex(outputRaw),
            extractSiyuanToolNameByRegex(value),
            extractSiyuanToolNameByRegex(value.item)
        );
        if (regexToolName && (likelySiyuan || likelyMcp || isGenericToolName(directName))) {
            return regexToolName;
        }

        return directName;
    }

    function extractToolArgsFromUnknown(value: any): unknown {
        if (!value || typeof value !== 'object') return undefined;
        return (
            value.arguments ??
            value.args ??
            value.input ??
            value.query ??
            value.function?.arguments ??
            value.tool?.arguments ??
            value.tool?.function?.arguments ??
            value.call?.arguments ??
            value.item?.arguments ??
            value.item?.args ??
            value.item?.input ??
            value.item?.query ??
            value.item?.function?.arguments ??
            value.item?.tool?.arguments ??
            value.item?.tool?.function?.arguments ??
            value.item?.call?.arguments
        );
    }

    function extractToolOutputFromUnknown(value: any): unknown {
        if (!value || typeof value !== 'object') return undefined;
        return value.output ?? value.result ?? value.content ?? value.item?.output ?? value.item?.result;
    }

    function extractToolCallIdFromUnknown(value: any): string {
        if (!value || typeof value !== 'object') return '';
        return firstNonEmptyString(
            value.call_id,
            value.callId,
            value.tool_call_id,
            value.toolCallId,
            value.id,
            value.item?.call_id,
            value.item?.callId,
            value.item?.tool_call_id,
            value.item?.toolCallId,
            value.item?.id
        );
    }

    function stringifyCodexTraceValue(value: unknown, maxLen = 4000): string {
        if (value === undefined || value === null) return '';
        let text = '';
        if (typeof value === 'string') {
            text = value;
        } else {
            try {
                text = JSON.stringify(value, null, 2);
            } catch {
                text = String(value);
            }
        }
        const normalized = normalizeThinkingText(text).trim();
        if (!normalized) return '';
        if (normalized.length <= maxLen) return normalized;
        return `${normalized.slice(0, maxLen)}\n...(truncated)...`;
    }

    function extractCodexSearchQuery(argsRaw: unknown): string {
        const args = normalizeCodexToolArgs(argsRaw);
        const query = firstNonEmptyString(
            args.q,
            args.query,
            args.keyword,
            args.keywords,
            args.search,
            args.searchTerm,
            args.text,
            args.term,
            args.pattern
        );
        if (query) return query;
        if (typeof argsRaw === 'string') {
            const compact = normalizeThinkingText(argsRaw).trim();
            if (compact.length > 0 && compact.length <= 240) return compact;
        }
        return '';
    }

    function isCodexSearchTrace(params: {
        toolName?: string;
        eventType?: string;
        itemType?: string;
        argsRaw?: unknown;
    }): boolean {
        const toolName = String(params.toolName || '').toLowerCase();
        const eventType = String(params.eventType || '').toLowerCase();
        const itemType = String(params.itemType || '').toLowerCase();
        const hints = `${toolName} ${eventType} ${itemType}`;
        const hasSearchHint =
            hints.includes('web_search') ||
            hints.includes('search') ||
            hints.includes('grep') ||
            hints.includes('ripgrep') ||
            hints.includes('lookup') ||
            hints.includes('find');
        if (!hasSearchHint) return false;
        const hasWriteHint =
            hints.includes('insert') ||
            hints.includes('update') ||
            hints.includes('create') ||
            hints.includes('append') ||
            hints.includes('delete') ||
            hints.includes('remove') ||
            hints.includes('write') ||
            hints.includes('edit');
        if (!hasWriteHint) return true;
        return !!extractCodexSearchQuery(params.argsRaw);
    }

    function getCodexTraceStatusText(status: CodexTraceCall['status']): string {
        if (status === 'completed') return 'done';
        if (status === 'error') return 'error';
        return 'running';
    }

    function getCodexTimelineTypeLabel(kind: CodexTraceCall['kind']): string {
        if (kind === 'thinking') return 'Thought';
        if (kind === 'search') return 'Search';
        if (kind === 'diff') return 'Diff';
        return 'Tool';
    }

    function getCodexTimelineEntryName(trace: CodexTraceCall): string {
        if (trace.kind === 'thinking') return 'Thought';
        if (trace.kind === 'diff') return '';
        const fallback =
            trace.kind === 'search' ? 'Search' : trace.kind === 'diff' ? 'Diff' : 'Tool';
        return String(trace.name || '').trim() || fallback;
    }

    function cloneEditOperation(operation: EditOperation): EditOperation {
        return { ...operation };
    }

    function cloneCodexTraceCall(trace: CodexTraceCall): CodexTraceCall {
        return {
            ...trace,
            editOperations: trace.editOperations?.map(cloneEditOperation),
        };
    }

    function mergeTraceEditOperations(
        prevOps?: EditOperation[],
        nextOps?: EditOperation[]
    ): EditOperation[] | undefined {
        const prev = (prevOps || []).map(cloneEditOperation);
        const next = (nextOps || []).map(cloneEditOperation);
        if (!prev.length && !next.length) return undefined;
        if (!next.length) return prev;
        const merged = [...prev];
        const keyIndex = new Map<string, number>();
        merged.forEach((op, idx) => keyIndex.set(buildEditOperationFingerprint(op), idx));
        for (const op of next) {
            const key = buildEditOperationFingerprint(op);
            const existingIdx = keyIndex.get(key);
            if (existingIdx === undefined) {
                keyIndex.set(key, merged.length);
                merged.push(op);
                continue;
            }
            merged[existingIdx] = {
                ...merged[existingIdx],
                ...op,
            };
        }
        return merged;
    }

    function buildEditOperationFingerprint(operation: EditOperation): string {
        const blockId = String(operation.blockId || '').trim();
        const filePath = normalizeEditOperationFilePath(operation.filePath);
        const opType = operation.operationType || 'update';
        const position = operation.position || '';
        const content = String(operation.newContent || '');
        return `${opType}|${position}|${filePath}|${blockId}|${content.length}|${content.slice(0, 200)}`;
    }

    function toAppliedEditOperation(rawOperation: any): EditOperation | null {
        if (!rawOperation || typeof rawOperation !== 'object') return null;
        const operationType = rawOperation.operationType === 'insert' ? 'insert' : 'update';
        const blockId = String(rawOperation.blockId || rawOperation.id || '').trim() || 'unknown';
        const newContent = String(rawOperation.newContent || '').trim();
        if (!newContent) return null;

        const nextOperation: EditOperation = {
            operationType,
            blockId,
            filePath: normalizeEditOperationFilePath(
                rawOperation.filePath || rawOperation.path || rawOperation.file || ''
            ),
            newContent,
            oldContent: String(rawOperation.oldContent || ''),
            oldContentForDisplay: String(rawOperation.oldContentForDisplay || ''),
            newContentForDisplay:
                String(rawOperation.newContentForDisplay || '').trim() ||
                stripKramdownIdMarkersForDisplay(newContent),
            status: 'applied',
        };
        if (operationType === 'insert') {
            nextOperation.position = rawOperation.position === 'before' ? 'before' : 'after';
        }
        return nextOperation;
    }

    function extractFilesystemEditOperationsFromToolEvent(params: {
        toolName: string;
        argsRaw: unknown;
        outputRaw: unknown;
    }): EditOperation[] {
        const toolName = String(params.toolName || '').toLowerCase();
        if (!toolName.includes('filesystem')) return [];
        const args = normalizeCodexToolArgs(params.argsRaw);
        const output = normalizeCodexToolPayload(params.outputRaw);
        const filePath = normalizeEditOperationFilePath(
            firstNonEmptyString(args.path, args.filePath, args.file, args.destination, args.source)
        );

        if (toolName.includes('edit_file')) {
            const edits = Array.isArray(args.edits) ? args.edits : [];
            const operations: EditOperation[] = [];
            for (const edit of edits) {
                if (!edit || typeof edit !== 'object') continue;
                const oldText = String((edit as any).oldText || '');
                const newText = String((edit as any).newText || '');
                if (!oldText && !newText) continue;
                const effectivePath =
                    normalizeEditOperationFilePath((edit as any).path || (edit as any).filePath) ||
                    filePath ||
                    'unknown';
                operations.push({
                    operationType: 'update',
                    blockId: effectivePath,
                    filePath: effectivePath,
                    newContent: newText,
                    oldContent: oldText,
                    oldContentForDisplay: oldText,
                    newContentForDisplay: newText,
                    status: 'applied',
                });
            }
            if (operations.length > 0) return operations;

            const outputText = stringifyCodexTraceValue(output, 12000);
            if (outputText && filePath) {
                return [
                    {
                        operationType: 'update',
                        blockId: filePath,
                        filePath,
                        newContent: outputText,
                        oldContent: '',
                        oldContentForDisplay: '',
                        newContentForDisplay: outputText,
                        status: 'applied',
                    },
                ];
            }
            return [];
        }

        if (toolName.includes('write_file')) {
            const content = String(args.content || '');
            if (!content || !filePath) return [];
            return [
                {
                    operationType: 'insert',
                    blockId: filePath,
                    filePath,
                    position: 'after',
                    newContent: content,
                    oldContent: '',
                    oldContentForDisplay: '',
                    newContentForDisplay: content,
                    status: 'applied',
                },
            ];
        }

        return [];
    }

    function extractEditOperationsFromCodexToolEvent(params: {
        toolName: string;
        argsRaw: unknown;
        outputRaw: unknown;
    }): EditOperation[] {
        const toolName = String(params.toolName || '').trim();
        const filesystemOperations = extractFilesystemEditOperationsFromToolEvent(params);
        if (filesystemOperations.length > 0) return filesystemOperations;
        if (!toolName.startsWith('siyuan_')) return [];

        const args = normalizeCodexToolArgs(params.argsRaw);
        const payload = normalizeCodexToolPayload(params.outputRaw);
        const normalizedPayload =
            payload && typeof payload === 'object' && payload.result && payload.operation
                ? payload
                : payload && typeof payload === 'object'
                  ? payload
                  : {};

        const fromOperation = toAppliedEditOperation((normalizedPayload as any).operation);
        if (fromOperation) return [fromOperation];

        if (toolName === 'siyuan_update_block') {
            const blockId = String(args.id || '').trim();
            const newContent = String(args.data || '').trim();
            if (!blockId || !newContent) return [];
            return [
                {
                    operationType: 'update',
                    blockId,
                    filePath: '',
                    newContent,
                    oldContent: '',
                    oldContentForDisplay: '',
                    newContentForDisplay: stripKramdownIdMarkersForDisplay(newContent),
                    status: 'applied',
                },
            ];
        }

        if (toolName === 'siyuan_insert_block') {
            const newContent = String(args.data || '').trim();
            if (!newContent) return [];
            const blockId =
                String(
                    args.nextID || args.previousID || args.parentID || args.appendParentID || ''
                ).trim() || 'unknown';
            const position = args.nextID ? 'before' : 'after';
            return [
                {
                    operationType: 'insert',
                    blockId,
                    filePath: '',
                    position,
                    newContent,
                    oldContent: '',
                    oldContentForDisplay: '',
                    newContentForDisplay: stripKramdownIdMarkersForDisplay(newContent),
                    status: 'applied',
                },
            ];
        }

        if (toolName === 'siyuan_create_document') {
            const markdown = String(args.markdown || '').trim();
            if (!markdown) return [];
            const notebook = String(args.notebook || '').trim();
            const path = String(args.path || '').trim();
            const blockId = notebook && path ? `${notebook}:${path}` : 'unknown';
            const filePath = notebook && path ? `${notebook}/${path.replace(/^\/+/, '')}` : '';
            return [
                {
                    operationType: 'insert',
                    blockId,
                    filePath,
                    position: 'after',
                    newContent: markdown,
                    oldContent: '',
                    oldContentForDisplay: '',
                    newContentForDisplay: stripKramdownIdMarkersForDisplay(markdown),
                    status: 'applied',
                },
            ];
        }

        return [];
    }

    async function sendMessageWithCodex(params: {
        userContent: string;
        attachments?: MessageAttachment[];
        contextDocs: ContextDocument[];
    }) {
        const workingDir = String(settings.codexWorkingDir || '').trim();
        if (!workingDir) throw new Error('请在设置中填写 Codex 工作目录（Codex CLI -> 工作目录）');

        const existingThreadId = getCurrentSessionCodexThreadId();
        codexNativeContextPercent = null;
        codexNativeContextSource = '';

        const modePreamble = buildCodexModePreamble(chatMode, settings.codexRunMode || 'read_only');
        const userPrompt = buildUserPromptForCodex(params);

        const promptParts: string[] = [];

        const baseSystemPrompt =
            (tempModelSettings.systemPrompt || '').trim() || String(settings.aiSystemPrompt || '').trim();
        const skillsPrompt = buildWorkspaceSkillsPrompt(workingDir, {
            maxSkills: 40,
            skillOverrides:
                settings.codexSkillOverrides && typeof settings.codexSkillOverrides === 'object'
                    ? settings.codexSkillOverrides
                    : {},
        });
        const effectiveSystemPrompt = [baseSystemPrompt, skillsPrompt].filter(Boolean).join('\n\n');
        if (effectiveSystemPrompt) {
            promptParts.push(`# System\n${effectiveSystemPrompt}`);
        }
        if (modePreamble) {
            promptParts.push(`# Mode\n${modePreamble}`);
        }
        promptParts.push(`# User\n${userPrompt}`);

        const prompt = promptParts.join('\n\n---\n\n');

        const stderrLines: string[] = [];
        const codexToolEditOperations: EditOperation[] = [];
        const codexToolEditOperationKeys = new Set<string>();
        const codexToolEditOperationPending = new Map<string, EditOperation>();
        const codexToolSnapshotTasks = new Map<string, Promise<void>>();
        let codexTraceSeq = 0;
        let activeThinkingTraceId = '';
        const codexTraceKeyByCallId = new Map<string, string>();
        let scrollScheduled = false;
        let scrollPending = false;
        const scheduleScroll = () => {
            if (scrollScheduled) {
                scrollPending = true;
                return;
            }
            scrollScheduled = true;
            window.setTimeout(async () => {
                try {
                    if (autoScroll) {
                        await scrollToBottom();
                    }
                } finally {
                    scrollScheduled = false;
                    if (scrollPending) {
                        scrollPending = false;
                        scheduleScroll();
                    }
                }
            }, 0);
        };

        const mergeTraceStatus = (
            prev: CodexTraceCall['status'],
            next: CodexTraceCall['status']
        ): CodexTraceCall['status'] => {
            const rank: Record<CodexTraceCall['status'], number> = {
                running: 1,
                completed: 2,
                error: 3,
            };
            return rank[next] >= rank[prev] ? next : prev;
        };

        const upsertStreamingTrace = (
            kind: 'tool' | 'search',
            patch: Partial<CodexTraceCall> & { id: string; name: string }
        ) => {
            const nextEntry: CodexTraceCall = {
                id: patch.id,
                kind,
                name: patch.name || (kind === 'search' ? '搜索' : '工具'),
                status: patch.status || 'running',
                eventType: patch.eventType || '',
                input: patch.input || '',
                output: patch.output || '',
                query: patch.query || '',
                editOperations: patch.editOperations?.map(cloneEditOperation),
            };
            const list = kind === 'search' ? streamingSearchCalls : streamingToolCalls;
            const index = list.findIndex(item => item.id === nextEntry.id);
            if (index === -1) {
                if (kind === 'search') {
                    streamingSearchCalls = [...streamingSearchCalls, nextEntry];
                    streamingSearchCallsExpanded = true;
                } else {
                    streamingToolCalls = [...streamingToolCalls, nextEntry];
                    streamingToolCallsExpanded = true;
                }
                return;
            }
            const merged: CodexTraceCall = {
                ...list[index],
                ...nextEntry,
                status: mergeTraceStatus(list[index].status, nextEntry.status),
                // 避免 started 阶段把已有 output 覆盖为空字符串
                output: nextEntry.output || list[index].output || '',
                input: nextEntry.input || list[index].input || '',
                query: nextEntry.query || list[index].query || '',
                editOperations: mergeTraceEditOperations(
                    list[index].editOperations,
                    nextEntry.editOperations
                ),
            };
            const nextList = [...list];
            nextList[index] = merged;
            if (kind === 'search') {
                streamingSearchCalls = nextList;
            } else {
                streamingToolCalls = nextList;
            }
        };

        const upsertStreamingTimeline = (
            patch: Partial<CodexTraceCall> & { id: string; kind: CodexTraceCall['kind'] }
        ) => {
            const nextEntry: CodexTraceCall = {
                id: patch.id,
                kind: patch.kind,
                name: patch.name || '',
                status: patch.status || (patch.kind === 'thinking' ? 'completed' : 'running'),
                eventType: patch.eventType || '',
                input: patch.input || '',
                output: patch.output || '',
                query: patch.query || '',
                text: patch.text || '',
                editOperations: patch.editOperations?.map(cloneEditOperation),
            };
            const index = streamingCodexTimeline.findIndex(item => item.id === nextEntry.id);
            if (index === -1) {
                streamingCodexTimeline = [...streamingCodexTimeline, nextEntry];
                streamingCodexTimelineExpanded = true;
                return;
            }
            const prev = streamingCodexTimeline[index];
            const merged: CodexTraceCall = {
                ...prev,
                ...nextEntry,
                name: nextEntry.name || prev.name || '',
                status: mergeTraceStatus(prev.status, nextEntry.status),
                input: nextEntry.input || prev.input || '',
                output: nextEntry.output || prev.output || '',
                query: nextEntry.query || prev.query || '',
                text: nextEntry.text || prev.text || '',
                editOperations: mergeTraceEditOperations(prev.editOperations, nextEntry.editOperations),
            };
            const nextList = [...streamingCodexTimeline];
            nextList[index] = merged;
            streamingCodexTimeline = nextList;
        };

        const markThinkingTimelineCompleted = () => {
            if (!streamingCodexTimeline.length) return;
            let changed = false;
            const next = streamingCodexTimeline.map(item => {
                if (item.kind === 'thinking' && item.status !== 'completed') {
                    changed = true;
                    return { ...item, status: 'completed' };
                }
                return item;
            });
            if (changed) {
                streamingCodexTimeline = next;
            }
        };

        const finishActiveThinkingSegment = () => {
            if (!activeThinkingTraceId) return;
            upsertStreamingTimeline({
                id: activeThinkingTraceId,
                kind: 'thinking',
                name: 'Thought',
                eventType: 'thinking',
                status: 'completed',
            });
            activeThinkingTraceId = '';
        };

        const appendTraceFromToolEvent = (params: {
            phase: 'started' | 'completed';
            toolName: string;
            itemType?: string;
            eventType?: string;
            callId?: string;
            argsRaw?: unknown;
            outputRaw?: unknown;
            status?: CodexTraceCall['status'];
            editOperations?: EditOperation[];
        }) => {
            // Any tool/search event marks the end of the current thinking segment.
            finishActiveThinkingSegment();
            const displayName =
                String(params.toolName || '').trim() ||
                (params.phase === 'started' ? '工具调用' : '工具结果');
            const traceKind: 'search' | 'tool' = isCodexSearchTrace({
                toolName: displayName,
                eventType: params.eventType,
                itemType: params.itemType,
                argsRaw: params.argsRaw,
            })
                ? 'search'
                : 'tool';
            const normalizedInput = stringifyCodexTraceValue(params.argsRaw);
            const normalizedOutput = stringifyCodexTraceValue(params.outputRaw);
            const query = traceKind === 'search' ? extractCodexSearchQuery(params.argsRaw) : '';
            const callId = String(params.callId || '').trim();
            let traceId = '';
            if (callId) {
                const baseKey = `${traceKind}:${callId}`;
                traceId = codexTraceKeyByCallId.get(baseKey) || '';
                if (!traceId) {
                    codexTraceSeq += 1;
                    traceId = `${baseKey}:${codexTraceSeq}`;
                    codexTraceKeyByCallId.set(baseKey, traceId);
                }
            } else if (params.phase === 'completed') {
                const pending = [...streamingCodexTimeline]
                    .reverse()
                    .find(
                        item =>
                            item.kind === traceKind &&
                            String(item.name || '').trim() === displayName &&
                            item.status === 'running'
                    );
                if (pending?.id) {
                    traceId = pending.id;
                }
            }
            if (!traceId) {
                codexTraceSeq += 1;
                traceId = `${traceKind}:${displayName}:${codexTraceSeq}`;
            }
            upsertStreamingTrace(traceKind, {
                id: traceId,
                name: displayName,
                eventType: String(params.eventType || params.itemType || ''),
                status: params.status || (params.phase === 'completed' ? 'completed' : 'running'),
                input: normalizedInput,
                output: normalizedOutput,
                query,
                editOperations: params.editOperations,
            });
            upsertStreamingTimeline({
                id: traceId,
                kind: traceKind,
                name: displayName,
                eventType: String(params.eventType || params.itemType || ''),
                status: params.status || (params.phase === 'completed' ? 'completed' : 'running'),
                input: normalizedInput,
                output: normalizedOutput,
                query,
                editOperations: params.editOperations,
            });
            if (
                traceKind === 'tool' &&
                params.phase === 'completed' &&
                params.editOperations &&
                params.editOperations.length > 0
            ) {
                upsertStreamingTimeline({
                    id: `${traceId}:diff`,
                    kind: 'diff',
                    name: `${displayName} diff`,
                    eventType: 'edit.diff',
                    status: params.status === 'error' ? 'error' : 'completed',
                    editOperations: params.editOperations,
                });
            }
            scheduleScroll();
        };

        // Create AbortController for unified abort handling.
        abortController = new AbortController();
        const fs = nodeRequireForSidebar<any>('fs');
        const mcpResolved = resolveSiyuanMcpScriptPath();
        if (!fs.existsSync(mcpResolved.scriptPath)) {
            throw new Error(`未找到 MCP 脚本：${mcpResolved.scriptPath}`);
        }

        const handle = runCodexExec({
            cliPath: settings.codexCliPath,
            workingDir,
            prompt,
            mcpScriptPath: mcpResolved.scriptPath,
            threadId: existingThreadId,
            skipGitRepoCheck: settings.codexSkipGitRepoCheck !== false,
            modelOverride: settings.codexModelOverride,
            reasoningEffort: settings.codexReasoningEffort,
            runMode: settings.codexRunMode,
            siyuanApiUrl: settings.siyuanApiUrl,
            siyuanApiToken: settings.siyuanApiToken,
            onEvent: (event: CodexExecEvent) => {
                if (isAborted) return;

                const type = String(event?.type || '');
                const typeLower = type.toLowerCase();
                const nativeContextPercent = extractCodexNativeContextPercent(event);
                if (nativeContextPercent !== null) {
                    codexNativeContextPercent = nativeContextPercent;
                    codexNativeContextSource = type || 'event';
                }

                const maybeThreadId = (event as any)?.thread_id || (event as any)?.threadId;
                if (type === 'thread.started' && typeof maybeThreadId === 'string') {
                    void setCurrentSessionCodexThreadId(maybeThreadId);
                }

                const ensureBeforeContentSnapshot = (operation: EditOperation) => {
                    if (!operation.blockId || operation.blockId === 'unknown') return;
                    const snapshotKey = buildEditOperationFingerprint(operation);
                    if (codexToolSnapshotTasks.has(snapshotKey)) return;
                    const task = (async () => {
                        try {
                            await ensureEditOperationFilePath(operation);
                        } catch {
                            // ignore
                        }
                        if (operation.operationType !== 'update') return;
                        if (
                            String(operation.oldContent || '').trim() &&
                            String(operation.oldContentForDisplay || '').trim()
                        ) {
                            return;
                        }
                        try {
                            if (!String(operation.oldContent || '').trim()) {
                                const blockData = await getBlockKramdown(operation.blockId);
                                if (blockData?.kramdown) {
                                    operation.oldContent = blockData.kramdown;
                                }
                            }
                        } catch {
                            // ignore
                        }
                        try {
                            if (!String(operation.oldContentForDisplay || '').trim()) {
                                const mdData = await exportMdContent(
                                    operation.blockId,
                                    false,
                                    false,
                                    2,
                                    0,
                                    false
                                );
                                if (mdData?.content) {
                                    operation.oldContentForDisplay = mdData.content;
                                }
                            }
                        } catch {
                            // ignore
                        }
                    })();
                    codexToolSnapshotTasks.set(snapshotKey, task);
                };

                const appendCodexToolEditOperations = (
                    toolName: string,
                    argsRaw: unknown,
                    outputRaw: unknown,
                    phase: 'started' | 'completed' = 'completed'
                ): EditOperation[] => {
                    const traceOperations: EditOperation[] = [];
                    const operations = extractEditOperationsFromCodexToolEvent({
                        toolName,
                        argsRaw,
                        outputRaw,
                    });
                    if (!operations.length) return traceOperations;
                    for (const operation of operations) {
                        const fingerprint = buildEditOperationFingerprint(operation);
                        const existing = codexToolEditOperationPending.get(fingerprint);
                        const target = existing || operation;
                        if (!existing) {
                            codexToolEditOperationPending.set(fingerprint, target);
                        } else {
                            if (!existing.oldContent && operation.oldContent) {
                                existing.oldContent = operation.oldContent;
                            }
                            if (!existing.oldContentForDisplay && operation.oldContentForDisplay) {
                                existing.oldContentForDisplay = operation.oldContentForDisplay;
                            }
                            if (!existing.newContentForDisplay && operation.newContentForDisplay) {
                                existing.newContentForDisplay = operation.newContentForDisplay;
                            }
                        }
                        if (phase === 'started') {
                            ensureBeforeContentSnapshot(target);
                            continue;
                        }
                        ensureBeforeContentSnapshot(target);
                        if (codexToolEditOperationKeys.has(fingerprint)) continue;
                        codexToolEditOperationKeys.add(fingerprint);
                        const appliedOperation: EditOperation = target;
                        appliedOperation.status = 'applied';
                        codexToolEditOperations.push(appliedOperation);
                        traceOperations.push(appliedOperation);
                    }
                    return traceOperations;
                };

                const normalizeStreamingChunk = (text: string) =>
                    String(text ?? '')
                        .replace(/\r\n/g, '\n')
                        .replace(/[ \t]+\n/g, '\n')
                        .trim();

                const appendThinking = (text: string) => {
                    const raw = normalizeStreamingChunk(text);
                    if (!raw) return;
                    streamingThinking = streamingThinking ? `${streamingThinking}\n${raw}` : raw;
                    isThinkingPhase = true;
                    const currentThinking =
                        activeThinkingTraceId &&
                        streamingCodexTimeline.find(
                            item => item.id === activeThinkingTraceId && item.kind === 'thinking'
                        );
                    if (!activeThinkingTraceId || !currentThinking || currentThinking.status === 'completed') {
                        codexTraceSeq += 1;
                        activeThinkingTraceId = `thinking:${codexTraceSeq}`;
                    }
                    upsertStreamingTimeline({
                        id: activeThinkingTraceId,
                        kind: 'thinking',
                        name: 'Thought',
                        eventType: 'thinking',
                        status: 'running',
                        text: currentThinking?.text ? `${currentThinking.text}\n${raw}` : raw,
                    });
                    scheduleScroll();
                };

                const appendAssistant = (text: string) => {
                    const raw = String(text ?? '');
                    if (!raw.trim()) return;
                    finishActiveThinkingSegment();
                    if (streamingMessage && !streamingMessage.endsWith('\n')) {
                        streamingMessage += '\n';
                    }
                    streamingMessage += raw;
                    // Once assistant output starts, treat thinking as completed.
                    isThinkingPhase = false;
                    markThinkingTimelineCompleted();
                    scheduleScroll();
                };

                const appendSubAgentTrace = (
                    text: string,
                    status: CodexTraceCall['status'],
                    payload: any,
                    eventType: string,
                    itemType: string
                ) => {
                    const raw = String(text ?? '');
                    if (!raw.trim() && status !== 'completed') return;
                    const subAgentId = firstNonEmptyString(
                        payload?.agent_id,
                        payload?.agentId,
                        payload?.subagent_id,
                        payload?.subagentId,
                        payload?.delegate_id,
                        payload?.delegateId
                    );
                    const subAgentName = firstNonEmptyString(
                        payload?.agent_name,
                        payload?.agentName,
                        payload?.subagent_name,
                        payload?.subagentName,
                        payload?.delegate_name,
                        payload?.delegateName,
                        subAgentId
                    );
                    const callId =
                        extractToolCallIdFromUnknown(payload) || (subAgentId ? `sub-agent:${subAgentId}` : '');
                    appendTraceFromToolEvent({
                        phase: status === 'completed' ? 'completed' : 'started',
                        toolName: subAgentName ? `sub-agent: ${subAgentName}` : 'sub-agent',
                        itemType,
                        eventType,
                        callId,
                        argsRaw: subAgentId ? { agentId: subAgentId } : undefined,
                        outputRaw: raw || undefined,
                        status,
                    });
                };

                // Codex --json output is primarily item-based.
                const item = (event as any)?.item;
                if (
                    item &&
                    (type === 'item.started' || type === 'item.completed' || type === 'item.delta')
                ) {
                    const itemType = String(item?.type || '');
                    const itemTypeLower = itemType.toLowerCase();
                    const itemText = typeof item?.text === 'string' ? item.text : '';

                    if (itemTypeLower.includes('reasoning') || itemTypeLower.includes('thinking')) {
                        appendThinking(itemText);
                        return;
                    }
                    // Non-thinking items start a new chronological phase.
                    finishActiveThinkingSegment();

                    if (
                        itemTypeLower.includes('agent_message') &&
                        !itemTypeLower.includes('assistant')
                    ) {
                        appendSubAgentTrace(
                            itemText,
                            type === 'item.completed' ? 'completed' : 'running',
                            item,
                            type,
                            itemType
                        );
                        return;
                    }

                    if (itemTypeLower === 'assistant_message') {
                        appendAssistant(itemText);
                        return;
                    }

                    if (itemTypeLower.includes('search')) {
                        const input = extractToolArgsFromUnknown(item);
                        const output = extractToolOutputFromUnknown(item);
                        appendTraceFromToolEvent({
                            phase: type === 'item.completed' ? 'completed' : 'started',
                            toolName: extractToolNameFromUnknown(item) || itemType || 'search',
                            itemType,
                            eventType: type,
                            callId: extractToolCallIdFromUnknown(item),
                            argsRaw: input,
                            outputRaw: output,
                            status: type === 'item.completed' ? 'completed' : 'running',
                        });
                        return;
                    }

                    if (itemTypeLower === 'command_execution') {
                        const command = String(item?.command || '').trim();
                        if (type === 'item.started') {
                            appendTraceFromToolEvent({
                                phase: 'started',
                                toolName: command ? `shell: ${command}` : 'shell',
                                itemType,
                                eventType: type,
                                callId: extractToolCallIdFromUnknown(item),
                                argsRaw: command ? { command } : undefined,
                                status: 'running',
                            });
                            return;
                        }
                        if (type === 'item.completed') {
                            const exitCode = item?.exit_code;
                            const aggregated = typeof item?.aggregated_output === 'string'
                                ? item.aggregated_output
                                : '';
                            appendTraceFromToolEvent({
                                phase: 'completed',
                                toolName: command ? `shell: ${command}` : 'shell',
                                itemType,
                                eventType: type,
                                callId: extractToolCallIdFromUnknown(item),
                                argsRaw: command ? { command } : undefined,
                                outputRaw:
                                    exitCode === undefined
                                        ? aggregated
                                        : {
                                              exitCode,
                                              output: aggregated,
                                          },
                                status: Number(exitCode) === 0 ? 'completed' : 'error',
                            });
                            return;
                        }
                    }

                    // Generic tool-like items (MCP, function, etc.) -> append to dedicated tracks.
                    if (
                        itemTypeLower.includes('tool') ||
                        itemTypeLower.includes('mcp') ||
                        itemTypeLower.includes('function')
                    ) {
                        const name = extractToolNameFromUnknown(item);
                        const input = extractToolArgsFromUnknown(item);
                        const output = extractToolOutputFromUnknown(item);
                        if (type === 'item.started') {
                            appendCodexToolEditOperations(name, input, output, 'started');
                            appendTraceFromToolEvent({
                                phase: 'started',
                                toolName: name || itemType || 'tool',
                                itemType,
                                eventType: type,
                                callId: extractToolCallIdFromUnknown(item),
                                argsRaw: input,
                                outputRaw: output,
                                status: 'running',
                            });
                        }
                        if (type === 'item.completed') {
                            const traceEditOperations = appendCodexToolEditOperations(
                                name,
                                input,
                                output,
                                'completed'
                            );
                            appendTraceFromToolEvent({
                                phase: 'completed',
                                toolName: name || itemType || 'tool',
                                itemType,
                                eventType: type,
                                callId: extractToolCallIdFromUnknown(item),
                                argsRaw: input,
                                outputRaw: output,
                                status: 'completed',
                                editOperations: traceEditOperations,
                            });
                        }
                        return;
                    }

                    // Fallback: if item has text, prefer showing it as assistant content.
                    if (itemText) {
                        const itemRole = String(item?.role || item?.author || '').toLowerCase();
                        if (itemRole.includes('agent') && !itemRole.includes('assistant')) {
                            appendSubAgentTrace(itemText, 'running', item, type, itemType);
                            return;
                        }
                        appendAssistant(itemText);
                        return;
                    }
                }

                // Tool / MCP / Search events -> append to dedicated tracks
                if (typeLower.includes('tool') || typeLower.includes('mcp') || typeLower.includes('search')) {
                    finishActiveThinkingSegment();
                    const toolName = extractToolNameFromUnknown(event);
                    const args = extractToolArgsFromUnknown(event);
                    const output = extractToolOutputFromUnknown(event);
                    const maybeDone =
                        typeLower.includes('completed') ||
                        typeLower.includes('done') ||
                        typeLower.includes('result');
                    const maybeStarted =
                        typeLower.includes('started') ||
                        typeLower.includes('start') ||
                        typeLower.includes('begin');
                    if (maybeStarted) {
                        appendCodexToolEditOperations(String(toolName || ''), args, undefined, 'started');
                        appendTraceFromToolEvent({
                            phase: 'started',
                            toolName: String(toolName || type || 'tool'),
                            itemType: '',
                            eventType: type,
                            callId: extractToolCallIdFromUnknown(event),
                            argsRaw: args,
                            outputRaw: output,
                            status: 'running',
                        });
                    }
                    if (maybeDone) {
                        const traceEditOperations = appendCodexToolEditOperations(
                            String(toolName || ''),
                            args,
                            output,
                            'completed'
                        );
                        appendTraceFromToolEvent({
                            phase: 'completed',
                            toolName: String(toolName || type || 'tool'),
                            itemType: '',
                            eventType: type,
                            callId: extractToolCallIdFromUnknown(event),
                            argsRaw: args,
                            outputRaw: output,
                            status: 'completed',
                            editOperations: traceEditOperations,
                        });
                    }
                    if (!maybeStarted && !maybeDone) {
                        appendTraceFromToolEvent({
                            phase: 'started',
                            toolName: String(toolName || type || 'tool'),
                            itemType: '',
                            eventType: type,
                            callId: extractToolCallIdFromUnknown(event),
                            argsRaw: args,
                            outputRaw: output,
                            status: 'running',
                        });
                    }
                    return;
                }

                const delta =
                    typeof (event as any)?.delta === 'string'
                        ? (event as any).delta
                        : typeof (event as any)?.text === 'string'
                          ? (event as any).text
                          : '';

                if (!delta) return;

                // Reasoning / thinking events
                if (typeLower.includes('reasoning') || typeLower.includes('thinking')) {
                    appendThinking(delta);
                    return;
                }

                const isSubAgentEvent =
                    !typeLower.includes('assistant_message') &&
                    (typeLower.includes('agent_message') ||
                        typeLower.includes('subagent') ||
                        typeLower.includes('sub_agent'));
                if (isSubAgentEvent) {
                    const status: CodexTraceCall['status'] =
                        typeLower.includes('completed') || typeLower.includes('done')
                            ? 'completed'
                            : 'running';
                    appendSubAgentTrace(delta, status, event, type, type);
                    return;
                }

                // Default: treat as assistant output
                appendAssistant(delta);
            },
            onStdErr: (line: string) => {
                // Filter noisy internal logs that are not actionable for users
                if (line.includes('state db missing rollout path')) return;

                stderrLines.push(line);
                // Surface a small amount of stderr in tool track to help debugging.
                if (stderrLines.length <= 5) {
                    appendTraceFromToolEvent({
                        phase: 'completed',
                        toolName: 'stderr',
                        itemType: 'stderr',
                        eventType: 'stderr',
                        callId: `stderr-${stderrLines.length}`,
                        outputRaw: line,
                        status: 'error',
                    });
                }
            },
        });

        abortController.signal.addEventListener(
            'abort',
            () => {
                handle.abort();
            },
            { once: true }
        );

        const result = await handle.completed;
        if (result.threadId) {
            await setCurrentSessionCodexThreadId(result.threadId);
        }

        if (isAborted) return;

        if (codexToolSnapshotTasks.size > 0) {
            await Promise.allSettled(Array.from(codexToolSnapshotTasks.values()));
        }
        await ensureEditOperationFilePaths(codexToolEditOperations);
        await ensureTraceEditOperationFilePaths(streamingCodexTimeline);
        await ensureTraceEditOperationFilePaths(streamingToolCalls);
        await ensureTraceEditOperationFilePaths(streamingSearchCalls);
        finishActiveThinkingSegment();
        markThinkingTimelineCompleted();

        const resolveSubAgentFallbackText = (): string => {
            const traces = [...streamingCodexTimeline, ...streamingToolCalls];
            for (let i = traces.length - 1; i >= 0; i -= 1) {
                const trace = traces[i];
                if (trace?.kind !== 'tool') continue;
                if (!/sub-agent/i.test(String(trace?.name || ''))) continue;
                const output = stringifyCodexTraceValue(trace?.output);
                if (output.trim()) return output;
            }
            return '';
        };

        const primaryText = String(streamingMessage || '').trim();
        const fallbackSubAgentText = primaryText ? '' : resolveSubAgentFallbackText();
        const finalText = convertLatexToMarkdown(primaryText || fallbackSubAgentText);

        if (!finalText.trim() && stderrLines.length > 0) {
            throw new Error(stderrLines.slice(-10).join('\n'));
        }

        const assistantMessage: Message = {
            role: 'assistant',
            content: finalText || '(no output)',
        };

        if (streamingThinking) assistantMessage.thinking = streamingThinking;
        if (streamingCodexTimeline.length > 0) {
            assistantMessage.codexTimeline = streamingCodexTimeline.map(cloneCodexTraceCall);
        }
        if (streamingSearchCalls.length > 0) {
            assistantMessage.codexSearchCalls = streamingSearchCalls.map(cloneCodexTraceCall);
        }
        if (streamingToolCalls.length > 0) {
            assistantMessage.codexToolCalls = streamingToolCalls.map(cloneCodexTraceCall);
        }
        if (codexToolEditOperations.length > 0) {
            assistantMessage.editOperations = codexToolEditOperations;
        }

        messages = [...messages, assistantMessage];
        streamingMessage = '';
        streamingThinking = '';
        streamingCodexTimeline = [];
        streamingSearchCalls = [];
        streamingToolCalls = [];
        isThinkingPhase = false;
        isLoading = false;
        abortController = null;
        hasUnsavedChanges = true;

        await saveCurrentSession(true);
        refreshCurrentNotePageAfterReply();
    }

    function hasComposedPayloadForSend(): boolean {
        return !!currentInput.trim() || currentAttachments.length > 0;
    }

    function cloneAttachment(attachment: MessageAttachment): MessageAttachment {
        return { ...attachment };
    }

    function cloneContextDoc(doc: ContextDocument): ContextDocument {
        return { ...doc };
    }

    function enqueueCurrentDraftForCodex(): boolean {
        const userContent = currentInput.trim();
        if (!userContent && currentAttachments.length === 0) return false;
        const nextIndex = queuedCodexSendDrafts.length + 1;
        const draft: QueuedCodexSendDraft = {
            id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userContent,
            attachments: currentAttachments.map(cloneAttachment),
            contextDocuments: contextDocuments.map(cloneContextDoc),
            queuedAt: Date.now(),
        };
        queuedCodexSendDrafts = [...queuedCodexSendDrafts, draft];
        currentInput = '';
        currentAttachments = [];
        contextDocuments = [];
        hasUnsavedChanges = true;
        pushMsg(
            (t('aiSidebar.codex.queue.enqueued') || '已加入发送队列（第 {index} 条）').replace(
                '{index}',
                String(nextIndex)
            )
        );
        return true;
    }

    function clearQueuedCodexSendDrafts(notify = false): number {
        const removedCount = queuedCodexSendDrafts.length;
        if (removedCount === 0) return 0;
        queuedCodexSendDrafts = [];
        if (notify) {
            pushMsg(
                (t('aiSidebar.codex.queue.cleared') || '已清空发送队列（{count} 条）').replace(
                    '{count}',
                    String(removedCount)
                )
            );
        }
        return removedCount;
    }

    async function processQueuedCodexSends() {
        if (isLoading) return;
        if (isProcessingQueuedCodexSend) return;
        if (queuedCodexSendDrafts.length === 0) return;

        isProcessingQueuedCodexSend = true;
        try {
            while (!isLoading && queuedCodexSendDrafts.length > 0) {
                const [nextDraft, ...rest] = queuedCodexSendDrafts;
                queuedCodexSendDrafts = rest;
                currentInput = nextDraft.userContent;
                currentAttachments = nextDraft.attachments.map(cloneAttachment);
                contextDocuments = nextDraft.contextDocuments.map(cloneContextDoc);
                await tick();
                await sendMessage();
            }
        } finally {
            isProcessingQueuedCodexSend = false;
        }
    }

    function shouldQueueCurrentDraft(): boolean {
        return isLoading && hasComposedPayloadForSend();
    }

    function handleSendButtonClick() {
        if (isLoading) {
            if (!hasComposedPayloadForSend()) {
                pushMsg(
                    t('aiSidebar.codex.queue.emptyHint') ||
                        '当前任务运行中：先输入新内容再点发送可加入队列；若要停止请点右侧暂停按钮'
                );
                return;
            }
            void sendMessage();
            return;
        }
        void sendMessage();
    }

    // 发送消息
    async function sendMessage() {
        if (isLoading) {
            if (!hasComposedPayloadForSend()) {
                pushMsg(
                    t('aiSidebar.codex.queue.emptyHint') ||
                        '当前任务运行中：先输入新内容再点发送可加入队列；若要停止请点右侧暂停按钮'
                );
                return;
            }
            enqueueCurrentDraftForCodex();
            return;
        }

        if (!hasComposedPayloadForSend()) return;

        let codexEnabled = settings?.codexEnabled === true;
        if (!codexEnabled && typeof plugin?.loadSettings === 'function') {
            try {
                const refreshedSettings = await plugin.loadSettings();
                if (refreshedSettings && typeof refreshedSettings === 'object') {
                    settings = mergeSettingsWithDefaults({ ...settings, ...refreshedSettings });
                    codexEnabled = settings?.codexEnabled === true;
                }
            } catch (error) {
                console.warn('Reload settings before send failed:', error);
            }
        }

        // 如果处于等待选择答案状态，阻止发送
        if (isWaitingForAnswerSelection) {
            pushErrMsg(t('multiModel.waitingSelection'));
            return;
        }

        if (!codexEnabled) {
            settings = mergeSettingsWithDefaults({ ...settings, codexEnabled: true });
            codexEnabled = true;
            if (typeof plugin?.saveSettings === 'function') {
                try {
                    await plugin.saveSettings(settings);
                } catch (error) {
                    console.warn('Force enable codex before send failed:', error);
                }
            }
        }

        // 发送前轻量回拉一次工作目录 AGENTS.md（仅当前 codexWorkingDir）
        if (codexEnabled && typeof plugin?.syncSystemPromptFromWorkingDirAgentsFile === 'function') {
            try {
                const syncedSettings = await plugin.syncSystemPromptFromWorkingDirAgentsFile();
                if (syncedSettings && typeof syncedSettings === 'object') {
                    settings = { ...settings, ...syncedSettings };
                }
            } catch (e) {
                console.warn('Sync system prompt from working dir AGENTS.md failed:', e);
            }
        }

        // Codex 模式：发送前做最小校验（避免无效配置下仍写入会话消息）
        if (codexEnabled) {
            const workingDir = String(settings.codexWorkingDir || '').trim();
            if (!workingDir) {
                pushErrMsg('请先在设置中填写 Codex 工作目录');
                return;
            }
            try {
                const fs = nodeRequireForSidebar<any>('fs');
                const mcpResolved = resolveSiyuanMcpScriptPath();
                if (!fs.existsSync(mcpResolved.scriptPath)) {
                    pushErrMsg(`未找到 MCP 脚本：${mcpResolved.scriptPath}`);
                    return;
                }
            } catch (e) {
                pushErrMsg(`检查 MCP 脚本失败：${(e as Error).message}`);
                return;
            }
        }

        // 检查设置（非 Codex 模式才需要）
        let providerConfig: ProviderConfig | null = null;
        let modelConfig: any = null;
        let customBody: any = {};

        if (!codexEnabled) {
            providerConfig = getCurrentProviderConfig();
            if (!providerConfig) {
                pushErrMsg(t('aiSidebar.errors.noProvider'));
                return;
            }

            if (!providerConfig.apiKey) {
                pushErrMsg(t('aiSidebar.errors.noApiKey'));
                return;
            }

            modelConfig = getCurrentModelConfig();
            if (!modelConfig) {
                pushErrMsg(t('aiSidebar.errors.noModel'));
                return;
            }

            // 解析自定义参数
            if (modelConfig.customBody) {
                try {
                    customBody = JSON.parse(modelConfig.customBody);
                } catch (e) {
                    console.error('Failed to parse custom body:', e);
                    pushErrMsg('自定义参数 JSON 格式错误');
                    return;
                }
            }

            // 如果启用了多模型模式且在问答模式
            if (enableMultiModel && chatMode === 'ask' && selectedMultiModels.length > 0) {
                await sendMultiModelMessage();
                return;
            }
        }

        // 获取所有上下文文档的最新内容
        // ask模式：使用 exportMdContent 获取 Markdown 格式
        // edit模式：使用 getBlockKramdown 获取 kramdown 格式（包含块ID信息）
        // agent模式：文档块只传递ID，普通块获取kramdown
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        if (contextDocuments.length > 0) {
            for (const doc of contextDocuments) {
                try {
                    let content: string;

                    if (chatMode === 'agent') {
                        // agent模式：文档只传递ID，块获取kramdown
                        if (doc.type === 'doc') {
                            // 文档块只传递ID，不需要获取内容
                            content = '';
                        } else {
                            // 普通块获取kramdown格式
                            const blockData = await getBlockKramdown(doc.id);
                            if (blockData && blockData.kramdown) {
                                content = blockData.kramdown;
                            } else {
                                // 降级使用缓存内容
                                content = doc.content;
                            }
                        }
                    } else if (chatMode === 'edit') {
                        // 编辑模式：获取kramdown格式，保留块ID结构
                        const blockData = await getBlockKramdown(doc.id);
                        if (blockData && blockData.kramdown) {
                            content = blockData.kramdown;
                        } else {
                            // 降级使用缓存内容
                            content = doc.content;
                        }
                    } else {
                        // ask模式：获取Markdown格式
                        const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                        if (data && data.content) {
                            content = data.content;
                        } else {
                            // 降级使用缓存内容
                            content = doc.content;
                        }
                    }

                    contextDocumentsWithLatestContent.push({
                        id: doc.id,
                        title: doc.title,
                        content: content,
                        type: doc.type, // 保留类型信息
                    });
                } catch (error) {
                    console.error(`Failed to get latest content for block ${doc.id}:`, error);
                    // 出错时使用缓存的内容
                    contextDocumentsWithLatestContent.push(doc);
                }
            }
        }

        // 用户消息只保存原始输入（不包含文档内容）
        const userContent = currentInput.trim();

        const userMessage: Message = {
            role: 'user',
            content: userContent,
            attachments: currentAttachments.length > 0 ? [...currentAttachments] : undefined,
            contextDocuments:
                contextDocumentsWithLatestContent.length > 0
                    ? [...contextDocumentsWithLatestContent]
                    : undefined,
        };

        messages = [...messages, userMessage];
        currentInput = '';
        currentAttachments = [];
        contextDocuments = []; // 发送后清空全局上下文
        isLoading = true;
        isAborted = false; // 重置中断标志
        streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
        streamingSearchCalls = [];
        streamingToolCallsExpanded = false;
        streamingSearchCallsExpanded = false;
        isThinkingPhase = false;
        hasUnsavedChanges = true;
        autoScroll = true; // 发送新消息时启用自动滚动

        await scrollToBottom(true);

        // 如果是第一条用户消息且没有会话ID，立即创建会话
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length === 1 && !currentSessionId) {
            const now = Date.now();
            const newSession: ChatSession = {
                id: `session_${now}`,
                title: generateSessionTitleFromText(userContent) || generateSessionTitle(),
                messages: [...messages],
                createdAt: now,
                updatedAt: now,
            };
            sessions = [newSession, ...sessions];
            currentSessionId = newSession.id;
            await saveSessions();

            // 立即执行自动重命名
            autoRenameSession(userContent);
        }

        await scrollToBottom(true);

        // DeepSeek 思考模式：开启新一轮对话前清理历史消息中的 reasoning_content，保留工具调用链
        if (chatMode === 'agent' && currentProvider === 'deepseek') {
            messages = messages.map(msg => {
                if (msg.role === 'assistant' && msg.reasoning_content) {
                    const { reasoning_content, ...rest } = msg as any;
                    return rest as Message;
                }
                return msg;
            });
        }

        if (codexEnabled) {
            try {
                await sendMessageWithCodex({
                    userContent,
                    attachments: userMessage.attachments,
                    contextDocs: contextDocumentsWithLatestContent,
                });
            } catch (error) {
                if (!isAborted) {
                    const errorMessage: Message = {
                        role: 'assistant',
                        content: `❌ **Codex 运行失败**\n\n${(error as Error).message}`,
                    };
                    messages = [...messages, errorMessage];
                    hasUnsavedChanges = true;
                }
                isLoading = false;
                streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                streamingSearchCalls = [];
                isThinkingPhase = false;
                abortController = null;
            } finally {
                void processQueuedCodexSends();
            }
            return;
        }

        const isDeepseekThinkingAgent =
            chatMode === 'agent' &&
            currentProvider === 'deepseek' &&
            modelConfig.capabilities?.thinking &&
            (modelConfig.thinkingEnabled || false);

        // 准备发送给AI的消息（包含系统提示词和上下文文档）
        // 深拷贝消息数组，避免修改原始消息
        // 保留工具调用相关字段（如果存在），以便在 Agent 模式下正确处理历史工具调用
        // 过滤掉空的 assistant 消息，防止部分 Provider（例如 Kimi）返回错误
        let messagesToSend = messages
            .filter(msg => {
                if (msg.role === 'system') return false;
                if (msg.role === 'assistant') {
                    const text =
                        typeof msg.content === 'string'
                            ? msg.content
                            : getMessageText(msg.content || []);
                    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
                    const hasReasoning = !!msg.reasoning_content;
                    // 保留有 tool_calls 或 reasoning_content 的 assistant 消息，即便正文为空
                    return (text && text.toString().trim() !== '') || hasToolCalls || hasReasoning;
                }
                return true;
            })
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                // 只在字段存在时才包含，避免传递 undefined 字段给 API
                if (msg.tool_calls) {
                    baseMsg.tool_calls = msg.tool_calls;
                }
                if (msg.tool_call_id) {
                    baseMsg.tool_call_id = msg.tool_call_id;
                    baseMsg.name = msg.name;
                }

                if (isDeepseekThinkingAgent && msg.reasoning_content) {
                    baseMsg.reasoning_content = msg.reasoning_content;
                }

                // 只处理历史用户消息的上下文（不是最后一条消息）
                // 最后一条消息将在后面用最新内容处理
                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');

                    // 获取原始消息内容
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    // 构建上下文文本（agent模式下，文档块只传递ID）
                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';

                            // agent模式：文档块只传递ID，不传递内容
                            if (chatMode === 'agent' && doc.type === 'doc') {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }

                            // 其他情况：传递完整内容
                            if (doc.content) {
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            } else {
                                // 如果没有内容（agent模式下的文档），只传递ID
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                            }
                        })
                        .join('\n\n---\n\n');

                    // 如果有图片附件，使用多模态格式
                    if (hasImages) {
                        const contentParts: any[] = [];

                        // 添加文本内容和上下文
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        // 添加图片
                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        // 添加文本文件内容
                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        // 纯文本格式
                        let enhancedContent = originalContent;

                        // 添加文本文件附件
                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        // 添加上下文文档
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;

                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息，添加附件和上下文文档
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const lastUserMessage = messages[messages.length - 1];
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        previousGeneratedImages = lastAssistantMsg.generatedImages.map(img => ({
                            type: 'image_url' as const,
                            image_url: {
                                url: `data:${img.mimeType || 'image/png'};base64,${img.data}`,
                            },
                        }));
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        previousGeneratedImages = lastAssistantMsg.attachments
                            .filter(att => att.type === 'image')
                            .map(att => ({
                                type: 'image_url' as const,
                                image_url: { url: att.data },
                            }));
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url' as const,
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url' as const,
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                // 如果有图片附件或上一条有生成的图片，使用多模态格式
                if (hasImages || previousGeneratedImages.length > 0) {
                    const contentParts: any[] = [];

                    // 先添加用户输入
                    let textContent = userContent;

                    // 然后添加上下文文档（如果有）
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加用户上传的图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
                    });

                    // 添加文本文件内容
                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    // 纯文本格式
                    let enhancedContent = userContent;

                    // 添加文本文件附件
                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    // 添加上下文文档
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';

                                // agent模式：文档块只传递ID，不传递内容
                                if (chatMode === 'agent' && doc.type === 'doc') {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }

                                // 其他情况：传递完整内容
                                if (doc.content) {
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                                } else {
                                    // 如果没有内容（agent模式下的文档），只传递ID
                                    return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\``;
                                }
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        // 根据模式添加系统提示词
        if (chatMode === 'edit') {
            // 编辑模式的特殊系统提示词
            const editModePrompt = `你是一个专业的笔记编辑助手。当用户要求修改内容时，你必须返回JSON格式的编辑指令。

**关于上下文格式**：
用户提供的上下文将以以下格式呈现：

## 文档: 文档标题
或
## 块: 块内容预览

**BlockID**: \`20240101120000-abc123\`

\`\`\`markdown
这里是kramdown格式的内容，包含块ID信息：
段落内容
{: id="20240101120100-def456"}

* 列表项
  {: id="20240101120200-ghi789"}
\`\`\`

**关于BlockID和kramdown格式**：
- **顶层BlockID**：位于 \`\`\`markdown 代码块之前，格式为 **BlockID**: \`xxxxxxxxxx-xxxxxxx\`
- **子块ID标记**：在markdown代码块内，格式为 {: id="20240101120100-def456"}
- 段落块会有 {: id="..."} 标记
- 列表项会有 {: id="..."} 标记  
- 标题、代码块等各种块都有ID标记

你可以编辑任何包含ID标记的块，包括：
- 顶层文档/块（使用代码块外的BlockID）
- 文档内的任何子块（使用代码块内的 {: id="xxx"}）

**提取BlockID的方法**：
- 从 **BlockID**: \`xxxxx\` 获取顶层块ID
- 从 {: id="xxxxx"} 获取子块ID
- BlockID格式通常为：时间戳-字符串，如 20240101120000-abc123

编辑指令格式（必须严格遵循）：
\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",  // 操作类型："update"=更新块（默认），"insert"=插入新块
      "blockId": "要编辑的块ID（可以是顶层块或子块的ID）",
      "newContent": "修改后的内容（kramdown格式，保留必要的ID标记）"
    },
    {
      "operationType": "insert",  // 插入新块
      "blockId": "参考块的ID（在此块前后插入）",
      "position": "after",  // "before"=在参考块之前插入，"after"=在参考块之后插入（默认）
      "newContent": "新插入的内容（kramdown格式）"
    }
  ]
}
\`\`\`

重要规则：
1. **必须返回JSON格式**：使用上述JSON结构，包裹在 \`\`\`json 代码块中
2. **blockId 必须来自上下文**：从 [BlockID: xxx] 或 {: id="xxx"} 中提取
3. **可以编辑任何有ID的块**：不限于顶层块，子块也可以精确编辑
4. **可以插入新块**：使用 operationType: "insert" 在指定块前后插入新内容
5. **newContent格式**：应该是kramdown格式，如果编辑子块，内容要包含该块的ID标记；插入新块时不需要ID标记
6. **可以批量编辑**：在 editOperations 数组中包含多个编辑操作
7. 思源笔记kramdown格式如果要添加颜色：应该是<span data-type="text">添加颜色的文字1</span>{: style="color: var(--b3-font-color1);"}，优先使用以下颜色变量：
  - --b3-font-color1: 红色
  - --b3-font-color2: 橙色
  - --b3-font-color3: 蓝色
  - --b3-font-color4: 绿色
  - --b3-font-color5: 灰色
8. **添加说明**：在JSON代码块之外，添加文字说明你的修改

示例1 - 编辑顶层块：
好的，我会帮你改进这段内容：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120000-abc123",
      "newContent": "这是修改后的整个文档内容\\n{: id=\\"20240101120000-abc123\\"}"
    }
  ]
}
\`\`\`

示例2 - 编辑子块（推荐）：
我会针对性地修改第二段和第三个列表项：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120100-def456",
      "newContent": "这是修改后的第二段内容，表达更专业。\\n{: id=\\"20240101120100-def456\\"}"
    },
    {
      "operationType": "update",
      "blockId": "20240101120200-ghi789",
      "newContent": "* 这是修改后的列表项\\n  {: id=\\"20240101120200-ghi789\\"}"
    }
  ]
}
\`\`\`

我针对需要改进的具体段落和列表项进行了精确修改。

示例3 - 插入新块：
我会在第二段后面插入一段补充说明：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "insert",
      "blockId": "20240101120100-def456",
      "position": "after",
      "newContent": "这是新插入的补充段落，提供更多细节信息。"
    }
  ]
}
\`\`\`

我在指定的段落后面添加了补充内容。

示例4 - 混合操作：
我会修改第一段并在其后插入新内容：

\`\`\`json
{
  "editOperations": [
    {
      "operationType": "update",
      "blockId": "20240101120100-def456",
      "newContent": "这是修改后的段落内容。\\n{: id=\\"20240101120100-def456\\"}"
    },
    {
      "operationType": "insert",
      "blockId": "20240101120100-def456",
      "position": "after",
      "newContent": "这是紧跟在修改段落后的新增内容。"
    }
  ]
}
\`\`\`

我修改了原段落并在其后添加了补充信息。

注意：
- 优先编辑子块而不是整个文档，这样更精确且不会影响其他内容
- 只有在用户明确要求修改内容时才返回JSON编辑指令
- 如果只是回答问题，则正常回复即可，不要返回JSON
- 确保JSON格式正确，可以被解析
- 确保blockId来自上下文中的ID标记（**BlockID**: \`xxx\` 或 {: id="xxx"}）
- newContent应保留kramdown的ID标记
- **重要**：newContent中只包含修改后的正文内容，不要包含"## 文档"、"## 块"或"**BlockID**:"这样的上下文标识，这些只是用于你理解上下文的`;

            // 先添加用户的系统提示词（如果有）
            if (settings.aiSystemPrompt) {
                messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
            }
            // 再添加编辑模式的提示词
            messagesToSend.unshift({ role: 'system', content: editModePrompt });
        } else if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 使用临时系统提示词（如果设置了）
        if (tempModelSettings.systemPrompt.trim()) {
            // 如果已有系统提示词，替换它；否则添加新的
            const systemMsgIndex = messagesToSend.findIndex(msg => msg.role === 'system');
            if (systemMsgIndex !== -1) {
                messagesToSend[systemMsgIndex].content = tempModelSettings.systemPrompt;
            } else {
                messagesToSend.unshift({ role: 'system', content: tempModelSettings.systemPrompt });
            }
        }

        // 限制上下文消息数量
        const systemMessages = messagesToSend.filter(msg => msg.role === 'system');
        const otherMessages = messagesToSend.filter(msg => msg.role !== 'system');
        const limitedMessages = otherMessages.slice(-tempModelSettings.contextCount);

        // 建立 tool_call_id => tool 消息的索引，便于补全被截断的链条
        const toolResultById = new Map<string, Message>();
        for (const msg of otherMessages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                toolResultById.set(msg.tool_call_id, msg);
            }
        }

        const limitedMessagesWithToolFix: Message[] = [];
        const includedToolCallIds = new Set<string>();

        for (const msg of limitedMessages) {
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                // 先推入 assistant
                limitedMessagesWithToolFix.push(msg);

                // 紧跟补全每一个 tool_call 的结果，保持顺序
                for (const tc of msg.tool_calls) {
                    const toolMsg = toolResultById.get(tc.id);
                    if (toolMsg && !includedToolCallIds.has(tc.id)) {
                        limitedMessagesWithToolFix.push(toolMsg);
                        includedToolCallIds.add(tc.id);
                    }
                }
                continue;
            }

            if (msg.role === 'tool') {
                // 仅在前一条是对应的 assistant 且未加入过时保留，避免孤立 tool
                const prev = limitedMessagesWithToolFix[limitedMessagesWithToolFix.length - 1];
                if (
                    prev &&
                    prev.role === 'assistant' &&
                    prev.tool_calls?.some(tc => tc.id === msg.tool_call_id) &&
                    msg.tool_call_id &&
                    !includedToolCallIds.has(msg.tool_call_id)
                ) {
                    limitedMessagesWithToolFix.push(msg);
                    includedToolCallIds.add(msg.tool_call_id);
                }
                continue;
            }

            // 其他消息正常保留
            limitedMessagesWithToolFix.push(msg);
        }

        messagesToSend = [...systemMessages, ...limitedMessagesWithToolFix];

        // 创建新的 AbortController
        abortController = new AbortController();

        try {
            // 检查是否启用思考模式
            const enableThinking =
                modelConfig.capabilities?.thinking && (modelConfig.thinkingEnabled || false);

            // 准备 Agent 模式的工具列表
            let toolsForAgent: any[] | undefined = undefined;
            if (chatMode === 'agent' && selectedTools.length > 0) {
                // 根据选中的工具名称筛选出对应的工具定义
                toolsForAgent = AVAILABLE_TOOLS.filter(tool =>
                    selectedTools.some(t => t.name === tool.function.name)
                );
            }

            // 准备联网搜索工具（如果启用）
            let webSearchTools: any[] | undefined = undefined;
            if (
                modelConfig.capabilities?.webSearch &&
                modelConfig.webSearchEnabled &&
                chatMode !== 'agent'
            ) {
                // 根据模型类型构建不同的联网工具配置
                const modelIdLower = modelConfig.id.toLowerCase();

                if (modelIdLower.includes('gemini')) {
                    // Gemini 模型使用 googleSearch 函数
                    webSearchTools = [
                        {
                            type: 'function',
                            function: {
                                name: 'googleSearch',
                            },
                        },
                    ];
                } else if (modelIdLower.includes('claude')) {
                    // Claude 模型使用 web_search 工具
                    // webSearchTools = [
                    //     {
                    //         type: 'web_search_20250305',
                    //         name: 'web_search',
                    //         max_uses: modelConfig.webSearchMaxUses || 5,
                    //     },
                    // ];
                }
            }

            // Agent 模式使用循环调用
            if (chatMode === 'agent' && toolsForAgent && toolsForAgent.length > 0) {
                let shouldContinue = true;
                // 记录第一次工具调用后创建的assistant消息索引
                let firstToolCallMessageIndex: number | null = null;

                while (shouldContinue && !abortController.signal.aborted) {
                    // 标记是否收到工具调用
                    let receivedToolCalls = false;
                    // 用于等待工具执行完成的 Promise
                    let toolExecutionComplete: (() => void) | null = null;
                    const toolExecutionPromise = new Promise<void>(resolve => {
                        toolExecutionComplete = resolve;
                    });

                    await chat(
                        currentProvider,
                        {
                            apiKey: providerConfig.apiKey,
                            model: modelConfig.id,
                            messages: messagesToSend,
                            temperature: tempModelSettings.temperatureEnabled
                                ? tempModelSettings.temperature
                                : modelConfig.temperature,
                            maxTokens:
                                modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                            stream: true,
                            signal: abortController.signal,
                            enableThinking,
                            reasoningEffort: modelConfig.thinkingEffort || 'low',
                            tools: toolsForAgent,
                            customBody, // 传递自定义参数
                            onThinkingChunk: enableThinking
                                ? (chunk: string) => {
                                      isThinkingPhase = true;
                                      streamingThinking += chunk;
                                      scheduleScrollToBottom();
                                  }
                                : undefined,
                            onThinkingComplete: enableThinking
                                ? (thinking: string) => {
                                      isThinkingPhase = false;
                                      thinkingCollapsed = {
                                          ...thinkingCollapsed,
                                          [messages.length]: true,
                                      };
                                  }
                                : undefined,
                            onToolCallComplete: async (toolCalls: ToolCall[]) => {
                                console.log('Tool calls received:', toolCalls);
                                receivedToolCalls = true;

                                // 如果是第一次工具调用，创建新的assistant消息
                                if (firstToolCallMessageIndex === null) {
                                    const assistantMessage: Message = {
                                        role: 'assistant',
                                        content: streamingMessage || '',
                                        tool_calls: toolCalls,
                                    };

                                    if (isDeepseekThinkingAgent && streamingThinking) {
                                        assistantMessage.reasoning_content = streamingThinking;
                                        assistantMessage.thinking = streamingThinking;
                                    }
                                    messages = [...messages, assistantMessage];
                                    firstToolCallMessageIndex = messages.length - 1;
                                } else {
                                    // 如果不是第一次，更新现有消息的tool_calls（合并工具调用）
                                    const existingMessage = messages[firstToolCallMessageIndex];
                                    existingMessage.tool_calls = [
                                        ...(existingMessage.tool_calls || []),
                                        ...toolCalls,
                                    ];

                                    if (isDeepseekThinkingAgent && streamingThinking) {
                                        existingMessage.reasoning_content = streamingThinking;
                                        existingMessage.thinking = streamingThinking;
                                    }
                                    messages = [...messages];
                                }
                                streamingMessage = '';

                                // 处理每个工具调用
                                for (const toolCall of toolCalls) {
                                    const toolConfig = selectedTools.find(
                                        t => t.name === toolCall.function.name
                                    );
                                    const autoApprove = toolConfig?.autoApprove || false;

                                    try {
                                        let toolResult: string;

                                        if (autoApprove) {
                                            // 自动批准：直接执行工具
                                            console.log(
                                                `Auto-approving tool call: ${toolCall.function.name}`
                                            );
                                            toolResult = await executeToolCall(toolCall);

                                            // 添加工具结果消息
                                            const toolResultMessage: Message = {
                                                role: 'tool',
                                                tool_call_id: toolCall.id,
                                                name: toolCall.function.name,
                                                content: toolResult,
                                            };
                                            messages = [...messages, toolResultMessage];
                                        } else {
                                            // 需要手动批准：显示批准对话框
                                            console.log(
                                                `Tool call requires approval: ${toolCall.function.name}`
                                            );

                                            // 显示批准对话框
                                            pendingToolCall = toolCall;
                                            isToolApprovalDialogOpen = true;

                                            // 等待用户批准或拒绝
                                            const approved = await new Promise<boolean>(resolve => {
                                                // 临时保存 resolve 函数
                                                (window as any).__toolApprovalResolve = resolve;
                                            });

                                            if (approved) {
                                                toolResult = await executeToolCall(toolCall);

                                                // 添加工具结果消息
                                                const toolResultMessage: Message = {
                                                    role: 'tool',
                                                    tool_call_id: toolCall.id,
                                                    name: toolCall.function.name,
                                                    content: toolResult,
                                                };
                                                messages = [...messages, toolResultMessage];
                                            } else {
                                                // 用户拒绝
                                                const toolResultMessage: Message = {
                                                    role: 'tool',
                                                    tool_call_id: toolCall.id,
                                                    name: toolCall.function.name,
                                                    content: `用户拒绝执行工具 ${toolCall.function.name}`,
                                                };
                                                messages = [...messages, toolResultMessage];
                                            }
                                        }
                                    } catch (error) {
                                        console.error(
                                            `Tool execution failed: ${toolCall.function.name}`,
                                            error
                                        );
                                        const errorMessage: Message = {
                                            role: 'tool',
                                            tool_call_id: toolCall.id,
                                            name: toolCall.function.name,
                                            content: `工具执行失败: ${(error as Error).message}`,
                                        };
                                        messages = [...messages, errorMessage];
                                    }
                                }

                                hasUnsavedChanges = true;

                                // 更新 messagesToSend，准备下一次循环
                                // 只在字段存在时才包含，避免传递 undefined 字段给 API
                                messagesToSend = messages.map(msg => {
                                    const baseMsg: any = {
                                        role: msg.role,
                                        content: msg.content,
                                    };

                                    // 只在有工具调用相关字段时才包含
                                    if (msg.tool_calls) {
                                        baseMsg.tool_calls = msg.tool_calls;
                                    }
                                    if (msg.tool_call_id) {
                                        baseMsg.tool_call_id = msg.tool_call_id;
                                        baseMsg.name = msg.name;
                                    }

                                    if (isDeepseekThinkingAgent && msg.reasoning_content) {
                                        baseMsg.reasoning_content = msg.reasoning_content;
                                    }

                                    return baseMsg;
                                });

                                // 通知工具执行完成
                                toolExecutionComplete?.();
                            },
                            onChunk: (chunk: string) => {
                                streamingMessage += chunk;
                                scheduleScrollToBottom();
                            },
                            onComplete: async (fullText: string) => {
                                // 如果已经中断，不再添加消息（避免重复）
                                if (isAborted) {
                                    shouldContinue = false;
                                    toolExecutionComplete?.();
                                    return;
                                }

                                // 如果没有收到工具调用，说明对话结束
                                if (!receivedToolCalls) {
                                    shouldContinue = false;

                                    const convertedText = convertLatexToMarkdown(fullText);

                                    // 处理content中的base64图片，保存为assets文件
                                    const processedContent =
                                        await saveBase64ImagesInContent(convertedText);

                                    // 如果之前有工具调用，将最终回复存储到 finalReply 字段
                                    if (
                                        firstToolCallMessageIndex !== null &&
                                        processedContent.trim()
                                    ) {
                                        const existingMessage = messages[firstToolCallMessageIndex];
                                        // 将AI的最终回复存储到 finalReply 字段
                                        existingMessage.finalReply = processedContent;

                                        if (isDeepseekThinkingAgent && streamingThinking) {
                                            existingMessage.reasoning_content = streamingThinking;
                                        }

                                        // 添加思考内容（如果有）
                                        if (enableThinking && streamingThinking) {
                                            existingMessage.thinking = streamingThinking;
                                        }

                                        messages = [...messages];
                                    } else {
                                        // 如果没有工具调用，创建新的assistant消息
                                        const assistantMessage: Message = {
                                            role: 'assistant',
                                            content: convertedText,
                                        };

                                        if (enableThinking && streamingThinking) {
                                            assistantMessage.thinking = streamingThinking;
                                            if (isDeepseekThinkingAgent) {
                                                assistantMessage.reasoning_content =
                                                    streamingThinking;
                                            }
                                        }

                                        messages = [...messages, assistantMessage];
                                    }

                                    streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                                    streamingSearchCalls = [];
                                    isThinkingPhase = false;
                                    isLoading = false;
                                    abortController = null;
                                    hasUnsavedChanges = true;

                                    await saveCurrentSession(true);

                                    // 通知完成（即使没有工具调用）
                                    toolExecutionComplete?.();
                                } else {
                                    // 如果有工具调用，onComplete 不做任何事，等待 onToolCallComplete 完成
                                    // 不调用 toolExecutionComplete，因为工具还在执行中
                                }
                            },
                            onError: (error: Error) => {
                                shouldContinue = false;
                                if (error.message !== 'Request aborted') {
                                    const errorMessage: Message = {
                                        role: 'assistant',
                                        content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                                    };
                                    messages = [...messages, errorMessage];
                                    hasUnsavedChanges = true;
                                }
                                isLoading = false;
                                streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                                streamingSearchCalls = [];
                                isThinkingPhase = false;
                                abortController = null;

                                // 通知完成（错误时也要结束等待）
                                toolExecutionComplete?.();
                            },
                        },
                        providerConfig.customApiUrl,
                        providerConfig.advancedConfig
                    );

                    // 等待工具执行完成后再继续循环
                    await toolExecutionPromise;
                }
            } else {
                // 非 Agent 模式或没有工具，使用原来的逻辑

                // 检查是否启用图片生成
                const enableImageGeneration = modelConfig.capabilities?.imageGeneration || false;
                // 用于保存生成的图片
                let generatedImages: any[] = [];

                await chat(
                    currentProvider,
                    {
                        apiKey: providerConfig.apiKey,
                        model: modelConfig.id,
                        messages: messagesToSend,
                        temperature: tempModelSettings.temperatureEnabled
                            ? tempModelSettings.temperature
                            : modelConfig.temperature,
                        maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                        stream: true,
                        signal: abortController.signal,
                        enableThinking,
                        reasoningEffort: modelConfig.thinkingEffort || 'low',
                        tools: webSearchTools, // 传递联网搜索工具
                        customBody, // 传递自定义参数
                        enableImageGeneration,
                        onImageGenerated: async (images: any[]) => {
                            // 立即保存生成的图片到 SiYuan 资源文件夹并转换为 blob URL
                            generatedImages = await Promise.all(
                                images.map(async (img, idx) => {
                                    const blob = base64ToBlob(
                                        img.data,
                                        img.mimeType || 'image/png'
                                    );
                                    const name = `generated-image-${Date.now()}-${idx + 1}.${
                                        img.mimeType?.split('/')[1] || 'png'
                                    }`;
                                    const assetPath = await saveAsset(blob, name);
                                    return {
                                        ...img,
                                        path: assetPath,
                                        // 给前端显示用的 blob url
                                        previewUrl: URL.createObjectURL(blob),
                                    };
                                })
                            );
                        },
                        onThinkingChunk: enableThinking
                            ? (chunk: string) => {
                                  isThinkingPhase = true;
                                  streamingThinking += chunk;
                                  scheduleScrollToBottom();
                              }
                            : undefined,
                        onThinkingComplete: enableThinking
                            ? (thinking: string) => {
                                  isThinkingPhase = false;
                                  thinkingCollapsed = {
                                      ...thinkingCollapsed,
                                      [messages.length]: true,
                                  };
                              }
                            : undefined,
                        onChunk: (chunk: string) => {
                            streamingMessage += chunk;
                            scheduleScrollToBottom();
                        },
                        onComplete: async (fullText: string) => {
                            // 如果已经中断，不再添加消息（避免重复）
                            if (isAborted) {
                                return;
                            }

                            // 转换 LaTeX 数学公式格式为 Markdown 格式
                            const convertedText = convertLatexToMarkdown(fullText);

                            // 处理content中的base64图片，保存为assets文件
                            const processedContent = await saveBase64ImagesInContent(convertedText);

                            const assistantMessage: Message = {
                                role: 'assistant',
                                content: processedContent,
                            };

                            // 如果有思考内容，添加到消息中
                            if (enableThinking && streamingThinking) {
                                assistantMessage.thinking = streamingThinking;
                            }

                            // 如果是编辑模式，解析编辑操作
                            if (chatMode === 'edit') {
                                const editOperations = parseEditOperations(convertedText);
                                if (editOperations.length > 0) {
                                    // 异步获取每个块的旧内容（kramdown格式和Markdown格式）
                                    for (const op of editOperations) {
                                        try {
                                            // 获取kramdown格式（用于应用编辑）
                                            const blockData = await getBlockKramdown(op.blockId);
                                            if (blockData && blockData.kramdown) {
                                                op.oldContent = blockData.kramdown;
                                            }

                                            // 获取Markdown格式（用于显示差异）
                                            const mdData = await exportMdContent(
                                                op.blockId,
                                                false,
                                                false,
                                                2,
                                                0,
                                                false
                                            );
                                            if (mdData && mdData.content) {
                                                op.oldContentForDisplay = mdData.content;
                                            }

                                            // 处理newContent用于显示（移除kramdown ID标记）
                                            op.newContentForDisplay = op.newContent
                                                .replace(/\{:\s*id="[^"]+"\s*\}/g, '')
                                                .trim();
                                        } catch (error) {
                                            console.error(`获取块 ${op.blockId} 内容失败:`, error);
                                        }
                                    }
                                    assistantMessage.editOperations = editOperations;

                                    // 如果启用了自动批准，则自动应用所有编辑操作
                                    if (autoApproveEdit) {
                                        messages = [...messages, assistantMessage];
                                        const currentMessageIndex = messages.length - 1;

                                        for (const op of editOperations) {
                                            await applyEditOperation(op, currentMessageIndex);
                                        }

                                        // 更新消息状态
                                        messages = [...messages];
                                    }
                                }
                            }

                            // 如果有生成的图片，保存到消息中
                            if (generatedImages.length > 0) {
                                // 保存图片信息（不包含base64数据，只保存路径）
                                assistantMessage.generatedImages = generatedImages.map(img => ({
                                    mimeType: img.mimeType,
                                    data: '', // 不保存base64数据，节省空间
                                    path: img.path,
                                }));

                                // 添加为附件以便显示（使用blob URL）
                                assistantMessage.attachments = generatedImages.map((img, idx) => ({
                                    type: 'image' as const,
                                    name: `generated-image-${idx + 1}.${
                                        img.mimeType?.split('/')[1] || 'png'
                                    }`,
                                    data: img.previewUrl, // 使用 blob URL 显示
                                    path: img.path, // 保存路径用于持久化
                                    mimeType: img.mimeType || 'image/png',
                                }));
                            }

                            if (
                                !autoApproveEdit ||
                                chatMode !== 'edit' ||
                                !assistantMessage.editOperations?.length
                            ) {
                                messages = [...messages, assistantMessage];
                            }
                            streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                            streamingSearchCalls = [];
                            isThinkingPhase = false;
                            isLoading = false;
                            abortController = null;
                            hasUnsavedChanges = true;

                            // AI 回复完成后，自动保存当前会话
                            await saveCurrentSession(true);

                            // 根据AI回答自动重命名会话标题（仅在非编辑模式下）
                            if (chatMode !== 'edit') {
                                autoRenameSession(convertedText);
                            }
                        },
                        onError: (error: Error) => {
                            // 如果是主动中断，不显示错误
                            if (error.message !== 'Request aborted') {
                                // 将错误消息作为一条 assistant 消息添加
                                const errorMessage: Message = {
                                    role: 'assistant',
                                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                                };
                                messages = [...messages, errorMessage];
                                hasUnsavedChanges = true;
                            }
                            isLoading = false;
                            streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                            streamingSearchCalls = [];
                            isThinkingPhase = false;
                            abortController = null;
                        },
                    },
                    providerConfig.customApiUrl,
                    providerConfig.advancedConfig
                );
            }
        } catch (error) {
            console.error('Send message error:', error);
            // onError 回调已经处理了错误消息的添加，这里不需要重复添加
            // 只需要在 onError 没有被调用的情况下（比如网络错误导致的异常）清理状态
            if ((error as Error).name === 'AbortError') {
                // 中断错误已经在 abortMessage 中处理
            } else if (!isLoading) {
                // 如果 isLoading 已经是 false，说明 onError 已经被调用并处理了
                // 不需要做任何事情
            } else {
                // 如果 isLoading 还是 true，说明 onError 没有被调用
                // 这种情况下才需要添加错误消息（比如网络请求失败）
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
                isLoading = false;
                streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                streamingSearchCalls = [];
                isThinkingPhase = false;
            }
            abortController = null;
        }
    }

    // 中断消息生成
    function abortMessage() {
        clearQueuedCodexSendDrafts(true);
        if (abortController) {
            abortController.abort();
            isAborted = true; // 设置中断标志，防止 onComplete 再次添加消息

            // 如果是多模型模式且正在等待选择答案
            if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
                // 找到第一个成功的响应作为默认选择
                const firstSuccessIndex = multiModelResponses.findIndex(
                    r => !r.error && !r.isLoading
                );

                if (firstSuccessIndex !== -1) {
                    const selectedResponse = multiModelResponses[firstSuccessIndex];
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: selectedResponse.content || '',
                        thinking: selectedResponse.thinking,
                        multiModelResponses: multiModelResponses.map((response, i) => ({
                            ...response,
                            isSelected: i === firstSuccessIndex,
                            modelName:
                                i === firstSuccessIndex
                                    ? ' ✅' + response.modelName
                                    : response.modelName, // 选择的模型名添加✅
                        })),
                    };

                    messages = [...messages, assistantMessage];
                    hasUnsavedChanges = true;
                }

                // 清除多模型状态
                multiModelResponses = [];
                isWaitingForAnswerSelection = false;
                selectedAnswerIndex = null;
                selectedTabIndex = 0;
                isLoading = false;
                abortController = null;
                return;
            }

            // 单模型模式：如果有已生成的部分，将其保存为消息
            if (
                streamingMessage ||
                streamingThinking ||
                streamingCodexTimeline.length > 0 ||
                streamingToolCalls.length > 0 ||
                streamingSearchCalls.length > 0
            ) {
                // 先保存到临时变量
                const tempStreamingMessage = streamingMessage;
                const tempStreamingThinking = streamingThinking;
                const tempStreamingTimeline = streamingCodexTimeline.map(cloneCodexTraceCall);
                const tempStreamingToolCalls = streamingToolCalls.map(cloneCodexTraceCall);
                const tempStreamingSearchCalls = streamingSearchCalls.map(cloneCodexTraceCall);

                // 立即清空流式消息和状态，避免重复渲染
                streamingMessage = '';
                streamingThinking = '';
                streamingCodexTimeline = [];
                streamingToolCalls = [];
                streamingSearchCalls = [];
                isThinkingPhase = false;
                isLoading = false;

                // 转换 LaTeX 数学公式格式为 Markdown 格式
                const convertedMessage = convertLatexToMarkdown(tempStreamingMessage);

                const message: Message = {
                    role: 'assistant',
                    content: convertedMessage + '\n\n' + t('aiSidebar.messages.interrupted'),
                };
                if (tempStreamingThinking) {
                    message.thinking = tempStreamingThinking;
                }
                if (tempStreamingTimeline.length > 0) {
                    message.codexTimeline = tempStreamingTimeline;
                }
                if (tempStreamingToolCalls.length > 0) {
                    message.codexToolCalls = tempStreamingToolCalls;
                }
                if (tempStreamingSearchCalls.length > 0) {
                    message.codexSearchCalls = tempStreamingSearchCalls;
                }
                messages = [...messages, message];
                hasUnsavedChanges = true;
            } else {
                streamingMessage = '';
                streamingThinking = '';
                streamingCodexTimeline = [];
                streamingToolCalls = [];
                streamingSearchCalls = [];
                isThinkingPhase = false;
                isLoading = false;
            }
            abortController = null;
        } else if (isLoading) {
            isLoading = false;
            isThinkingPhase = false;
            streamingMessage = '';
            streamingThinking = '';
            streamingCodexTimeline = [];
            streamingToolCalls = [];
            streamingSearchCalls = [];
        }
    }

    // 复制对话为Markdown
    function copyAsMarkdown() {
        const markdown = messages
            .filter(msg => msg.role !== 'system')
            .map(msg => {
                const role = msg.role === 'user' ? '👤 **User**' : '🤖 **Assistant**';
                // 获取实际内容（包括多模型响应）
                const content = getActualMessageContent(msg);
                return `${role}\n\n${content}\n`;
            })
            .join('\n---\n\n');

        navigator.clipboard
            .writeText(markdown)
            .then(() => {
                pushMsg(t('aiSidebar.success.copyMarkdownSuccess'));
            })
            .catch(err => {
                pushErrMsg(t('aiSidebar.errors.copyFailed'));
                console.error('Copy failed:', err);
            });
    }

    // 清空对话
    function clearChat() {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，先保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                const selectedResponse = multiModelResponses[firstSuccessIndex];
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: selectedResponse.content || '',
                    thinking: selectedResponse.thinking,
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex,
                        modelName:
                            i === firstSuccessIndex
                                ? ' ✅' + response.modelName
                                : response.modelName, // 选择的模型名添加✅
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            confirm(
                t('aiSidebar.confirm.clearChat.title'),
                t('aiSidebar.confirm.clearChat.message'),
                () => {
                    doClearChat();
                }
            );
        } else {
            doClearChat();
        }
    }

    function doClearChat() {
        messages = settings.aiSystemPrompt
            ? [{ role: 'system', content: settings.aiSystemPrompt }]
            : [];
        contextDocuments = [];
        clearQueuedCodexSendDrafts(false);
        streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
        streamingSearchCalls = [];
        streamingToolCallsExpanded = false;
        streamingSearchCallsExpanded = false;
        isThinkingPhase = false;
        thinkingCollapsed = {};
        currentSessionId = '';
        hasUnsavedChanges = false;

        // 清除多模型状态
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = null;
        selectedTabIndex = 0;

        pushMsg(t('aiSidebar.success.clearSuccess'));
    }

    // 处理键盘事件
    function handleKeydown(e: KeyboardEvent) {
        const sendMode = settings.sendMessageShortcut || 'ctrl+enter';

        if (sendMode === 'ctrl+enter') {
            // Ctrl+Enter 发送模式
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handleSendButtonClick();
                return;
            }
        } else {
            // Enter 发送模式（Shift+Enter 换行）
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendButtonClick();
                return;
            }
        }
    }

    function handleGlobalKeydownForDialogs(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        if (e.defaultPrevented) return;

        if (isDiffDialogOpen) {
            e.preventDefault();
            closeDiffDialog();
            return;
        }
        if (isGitSyncDialogOpen) {
            e.preventDefault();
            closeGitSyncDialog();
            return;
        }
        if (isWebLinkDialogOpen) {
            e.preventDefault();
            closeWebLinkDialog();
            return;
        }
        if (isSearchDialogOpen) {
            e.preventDefault();
            closeSearchDialog();
        }
    }

    // 使用思源内置的Lute渲染markdown为HTML
    // 将消息内容转换为字符串
    function getMessageText(content: string | MessageContent[]): string {
        if (typeof content === 'string') {
            return content;
        }
        // 对于多模态内容，只提取文本部分
        return content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('\n');
    }

    // 获取消息的实际内容（处理多模型响应）
    function getActualMessageContent(message: Message): string {
        // 如果有多模型响应，返回被选中的模型的内容
        if (message.multiModelResponses && message.multiModelResponses.length > 0) {
            const selectedResponse = message.multiModelResponses.find(r => r.isSelected);
            if (selectedResponse && selectedResponse.content) {
                return getMessageText(selectedResponse.content);
            }
            // 如果没有选中的，返回第一个有内容的
            const firstWithContent = message.multiModelResponses.find(r => r.content);
            if (firstWithContent) {
                return getMessageText(firstWithContent.content);
            }
        }
        // 否则返回常规内容
        return getMessageText(message.content);
    }

    // 将 LaTeX 数学公式格式转换为 Markdown 格式（永久转换）
    function convertLatexToMarkdown(text: string): string {
        // 将 LaTeX 块级数学公式 \[...\] 转换为 $$...$$
        text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => {
            const trimmedFormula = formula.trim();
            return `\n\n$$\n${trimmedFormula}\n$$\n\n`;
        });

        // 将 LaTeX 行内数学公式 \(...\) 转换为 $...$
        text = text.replace(/\\\((.*?)\\\)/g, (_match, formula) => {
            return `$${formula}$`;
        });

        return text;
    }

    // 将消息内容中的 base64 图片保存为 assets 文件并替换为路径
    async function saveBase64ImagesInContent(content: string): Promise<string> {
        // 匹配 Markdown 图片语法中的 base64 数据
        const base64ImageRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
        const matches = Array.from(content.matchAll(base64ImageRegex));

        if (matches.length === 0) {
            return content;
        }

        let result = content;
        for (const match of matches) {
            const fullMatch = match[0];
            const altText = match[1];
            const dataUrl = match[2];

            try {
                // 解析 data URL
                const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (!dataUrlMatch) continue;

                const mimeType = dataUrlMatch[1];
                const base64Data = dataUrlMatch[2];

                // 保存到 assets
                const blob = base64ToBlob(base64Data, mimeType);
                const ext = mimeType.split('/')[1] || 'png';
                const assetPath = await saveAsset(blob, `image-${Date.now()}.${ext}`);

                // 替换为 assets 路径
                result = result.replace(fullMatch, `![${altText}](${assetPath})`);

                console.log(`Saved generated image to assets: ${assetPath}`);
            } catch (error) {
                console.error('Failed to save base64 image:', error);
            }
        }

        return result;
    }

    // 将消息内容中的 assets 路径替换为 blob URL（用于显示）
    async function replaceAssetPathsWithBlob(content: string): Promise<string> {
        // 匹配 Markdown 图片语法中的 assets 路径
        const assetImageRegex =
            /!\[([^\]]*)\]\((\/data\/storage\/petal\/siyuan-plugin-copilot\/assets\/[^)]+)\)/g;
        const matches = Array.from(content.matchAll(assetImageRegex));

        if (matches.length === 0) {
            return content;
        }

        let result = content;
        for (const match of matches) {
            const fullMatch = match[0];
            const altText = match[1];
            const assetPath = match[2];

            try {
                const blobUrl = await loadAsset(assetPath);
                if (blobUrl) {
                    result = result.replace(fullMatch, `![${altText}](${blobUrl})`);
                }
            } catch (error) {
                console.error('Failed to load asset for display:', error);
            }
        }

        return result;
    }

    function formatMessage(content: string | MessageContent[]): string {
        let textContent = getMessageText(content);

        try {
            // 检查window.Lute是否存在
            if (typeof window !== 'undefined' && (window as any).Lute) {
                const lute = (window as any).Lute.New();
                // 启用行内数学公式支持，将 $...$ 解析为 <span class="language-math">...</span>
                lute.SetInlineMath(true);
                // 允许 $ 后面紧跟数字，如 $7.24 s$
                lute.SetInlineMathAllowDigitAfterOpenMarker(true);
                // 使用Md2HTML将markdown转换为HTML，而不是Md2BlockDOM
                // Md2HTML不会生成带data-node-id的块级结构，可以正常跨块选择文本
                const html = lute.Md2HTML(textContent);
                return html;
            }
            // 如果Lute不可用，回退到简单渲染
            return textContent
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(
                    /```(\w+)?\n([\s\S]*?)```/g,
                    '<pre><code class="language-$1">$2</code></pre>'
                )
                .replace(/\n/g, '<br>');
        } catch (error) {
            console.error('Format message error:', error);
            return textContent;
        }
    }

    // 高亮代码块
    function highlightCodeBlocks(element: HTMLElement) {
        if (!element) return;

        // 使用 tick 确保 DOM 已更新
        tick().then(async () => {
            try {
                // 确保 highlight.js 已加载
                if (!(window as any).hljs) {
                    const loaded = await initHljs();
                    if (!loaded) {
                        console.error('Failed to initialize highlight.js');
                        return;
                    }
                }

                const hljs = (window as any).hljs;

                const codeBlocks = element.querySelectorAll('pre > code:not([data-highlighted])');
                codeBlocks.forEach((block: HTMLElement) => {
                    try {
                        const code = block.textContent || '';

                        // 尝试提取语言：data-language -> class(language-xxx) -> pre(data-language/data-subtype)
                        let language = (block.getAttribute('data-language') || '').trim();
                        if (!language) {
                            const match = (block.className || '').match(
                                /(?:^|\s)language-([a-zA-Z0-9_-]+)/
                            );
                            if (match && match[1]) language = match[1];
                        }
                        if (!language) {
                            const pre = block.parentElement as HTMLElement | null;
                            language = (
                                pre?.getAttribute('data-language') ||
                                pre?.getAttribute('data-subtype') ||
                                ''
                            ).trim();
                        }

                        let highlighted: any;
                        if (language && hljs.getLanguage?.(language)) {
                            highlighted = hljs.highlight(code, { language, ignoreIllegals: true });
                            block.setAttribute('data-language', language);
                        } else {
                            highlighted = hljs.highlightAuto(code);
                            if (highlighted?.language) {
                                block.setAttribute('data-language', highlighted.language);
                            }
                        }

                        if (highlighted && typeof highlighted.value === 'string') {
                            block.innerHTML = highlighted.value;
                        } else {
                            // 回退到纯文本，避免 innerHTML 注入风险
                            block.textContent = code;
                        }
                        block.classList.add('hljs');
                        block.setAttribute('data-highlighted', 'true');
                    } catch (error) {
                        console.error('Highlight code block error:', error);
                    }
                });
            } catch (error) {
                console.error('Highlight code blocks error:', error);
            }
        });
    }

    // 初始化 KaTeX
    export const initKatex = async () => {
        if (window.katex) return true;
        // https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/render/mathRender.ts
        const cdn = Constants.PROTYLE_CDN;
        addStyle(`${cdn}/js/katex/katex.min.css`, 'protyleKatexStyle');
        await addScript(`${cdn}/js/katex/katex.min.js`, 'protyleKatexScript');
        return window.katex !== undefined && window.katex !== null;
    };

    // 初始化 highlight.js
    export const initHljs = async () => {
        if ((window as any).hljs) return;

        const setCodeTheme = (cdn = Constants.PROTYLE_CDN) => {
            const protyleHljsStyle = document.getElementById('protyleHljsStyle') as HTMLLinkElement;
            let css;
            if ((window as any).siyuan.config.appearance.mode === 0) {
                css = (window as any).siyuan.config.appearance.codeBlockThemeLight;
                if (!Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE.includes(css)) {
                    css = 'default';
                }
            } else {
                css = (window as any).siyuan.config.appearance.codeBlockThemeDark;
                if (!Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE.includes(css)) {
                    css = 'github-dark';
                }
            }
            const href = `${cdn}/js/highlight.js/styles/${css}.min.css`;
            if (!protyleHljsStyle) {
                addStyle(href, 'protyleHljsStyle');
            } else if (!protyleHljsStyle.href.includes(href)) {
                protyleHljsStyle.remove();
                addStyle(href, 'protyleHljsStyle');
            }
        };

        const cdn = Constants.PROTYLE_CDN;
        setCodeTheme(cdn);
        await addScript(`${cdn}/js/highlight.js/highlight.min.js`, 'protyleHljsScript');
        await addScript(`${cdn}/js/highlight.js/third-languages.js`, 'protyleHljsThirdScript');
        return (window as any).hljs !== undefined && (window as any).hljs !== null;
    };

    // 辅助：添加样式链接
    const addStyle = (href: string, id: string) => {
        if (document.getElementById(id)) return;
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    };

    // https://github.com/siyuan-note/siyuan/blob/master/app/src/protyle/util/addScript.ts
    export const addScript = (path: string, id: string) => {
        return new Promise(resolve => {
            if (document.getElementById(id)) {
                // 脚本加载后再次调用直接返回
                resolve(false);
                return false;
            }
            const scriptElement = document.createElement('script');
            scriptElement.src = path;
            scriptElement.async = true;
            // 循环调用时 Chrome 不会重复请求 js
            document.head.appendChild(scriptElement);
            scriptElement.onload = () => {
                if (document.getElementById(id)) {
                    // 循环调用需清除 DOM 中的 script 标签
                    scriptElement.remove();
                    resolve(false);
                    return false;
                }
                scriptElement.id = id;
                resolve(true);
            };
        });
    };

    // 渲染单个数学公式块
    function renderMathBlock(element: HTMLElement) {
        try {
            const formula = element.textContent || '';
            if (!formula.trim()) {
                return;
            }

            const isBlock = element.tagName.toUpperCase() === 'DIV';

            // 使用 KaTeX 渲染公式
            const katex = (window as any).katex;
            const html = katex.renderToString(formula, {
                throwOnError: false, // 发生错误时不抛出异常
                displayMode: isBlock, // 使用显示模式（居中显示）
                strict: (errorCode: string) =>
                    errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                trust: true,
            });

            // 清空原始内容并插入渲染后的内容
            element.innerHTML = html;

            // 标记已渲染
            element.setAttribute('data-math-rendered', 'true');
        } catch (error) {
            console.error('Error rendering math formula:', error);
            element.innerHTML = `<span style="color: red;">公式渲染错误</span>`;
            element.setAttribute('data-math-rendered', 'true');
        }
    }

    // 渲染数学公式
    async function renderMathFormulas(element: HTMLElement) {
        if (!element) return;

        // 使用 tick 确保 DOM 已更新
        await tick();

        try {
            // 确保 KaTeX 已加载
            if (!(window as any).katex) {
                const loaded = await initKatex();
                if (!loaded) {
                    console.error('Failed to initialize KaTeX');
                    return;
                }
            }

            const katex = (window as any).katex;

            // 处理新格式的行内数学公式 span.language-math
            const inlineMathElements = element.querySelectorAll(
                'span.language-math:not([data-math-rendered])'
            );

            inlineMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容（从 textContent 获取）
                    const mathContent = mathElement.textContent?.trim();
                    if (mathContent) {
                        // 保存原始内容，用于复制时还原
                        if (!mathElement.hasAttribute('data-content')) {
                            mathElement.setAttribute('data-content', mathContent);
                        }

                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: false,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render inline math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 处理新格式的块级数学公式 div.language-math
            const blockMathElements = element.querySelectorAll(
                'div.language-math:not([data-math-rendered])'
            );

            blockMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容（从 textContent 获取）
                    const mathContent = mathElement.textContent?.trim();
                    if (mathContent) {
                        // 保存原始内容，用于复制时还原
                        if (!mathElement.hasAttribute('data-content')) {
                            mathElement.setAttribute('data-content', mathContent);
                        }

                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: true,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render block math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 Lute 渲染的数学公式元素（带 data-subtype="math" 属性）
            const oldMathElements = element.querySelectorAll(
                '[data-subtype="math"]:not([data-math-rendered])'
            );

            oldMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    // 获取数学公式内容
                    const mathContent = mathElement.getAttribute('data-content');
                    if (!mathContent) {
                        return;
                    }

                    // 临时设置文本内容用于渲染
                    mathElement.textContent = mathContent;

                    // 渲染公式
                    renderMathBlock(mathElement);
                } catch (error) {
                    console.error('Render math formula error:', error, mathElement);
                    // 即使渲染失败也标记，避免重复尝试
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 span.katex
            const oldInlineMathElements = element.querySelectorAll(
                'span.katex:not([data-math-rendered])'
            );

            oldInlineMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    const mathContent = mathElement.getAttribute('data-content');
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: false,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render inline math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });

            // 兼容旧格式：处理 div.katex
            const oldBlockMathElements = element.querySelectorAll(
                'div.katex:not([data-math-rendered])'
            );

            oldBlockMathElements.forEach((mathElement: HTMLElement) => {
                try {
                    const mathContent = mathElement.getAttribute('data-content');
                    if (mathContent) {
                        const html = katex.renderToString(mathContent, {
                            throwOnError: false,
                            displayMode: true,
                            strict: (errorCode: string) =>
                                errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn',
                            trust: true,
                        });
                        mathElement.innerHTML = html;
                        mathElement.setAttribute('data-math-rendered', 'true');
                    }
                } catch (error) {
                    console.error('Render block math error:', error, mathElement);
                    mathElement.setAttribute('data-math-rendered', 'true');
                }
            });
        } catch (error) {
            console.error('Render math formulas error:', error);
        }
    }

    // 清理代码块中不需要的元素并添加语言标签和复制按钮
    function cleanupCodeBlocks(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 删除 .protyle-action__menu 元素
                const menuElements = element.querySelectorAll('.protyle-action__menu');
                menuElements.forEach((menu: HTMLElement) => {
                    menu.remove();
                });

                // 删除 .protyle-action__copy 元素上的 b3-tooltips__nw 和 b3-tooltips 类
                const copyButtons = element.querySelectorAll('.protyle-action__copy');
                copyButtons.forEach((btn: HTMLElement) => {
                    btn.classList.remove('b3-tooltips__nw', 'b3-tooltips');
                });

                // 为代码块添加语言标签和复制按钮
                const codeBlocks = element.querySelectorAll('pre > code');
                codeBlocks.forEach((codeElement: HTMLElement) => {
                    const pre = codeElement.parentElement;
                    if (!pre) return;
                    // 避免重复插入工具条（属性 + DOM 双重判定）
                    if (
                        pre.hasAttribute('data-code-toolbar-added') ||
                        pre.querySelector(':scope > .code-block-toolbar')
                    ) {
                        pre.setAttribute('data-code-toolbar-added', 'true');
                        return;
                    }

                    // 尝试从 data-language 或 class 中提取语言名称
                    let language = (codeElement.getAttribute('data-language') as string) || '';
                    if (!language) {
                        const classes = codeElement.className.split(' ');
                        for (const cls of classes) {
                            if (cls.startsWith('language-')) {
                                language = cls.replace('language-', '');
                                break;
                            }
                        }
                    }

                    // 标记已处理
                    pre.setAttribute('data-code-toolbar-added', 'true');

                    // 创建工具栏容器
                    const toolbar = document.createElement('div');
                    toolbar.className = 'code-block-toolbar';

                    const left = document.createElement('div');
                    left.className = 'code-block-toolbar__left';
                    const right = document.createElement('div');
                    right.className = 'code-block-toolbar__right';

                    // 语言标签（非空才显示）
                    if (language && language.trim()) {
                        const langLabel = document.createElement('div');
                        langLabel.className = 'code-block-lang-label';
                        langLabel.textContent = language.trim();
                        left.appendChild(langLabel);
                    }

                    // 创建复制按钮
                    const copyButton = document.createElement('button');
                    copyButton.className = 'code-block-toolbar-btn code-block-copy-btn';
                    copyButton.innerHTML = '<svg><use xlink:href="#iconCopy"></use></svg>';
                    copyButton.title = t('aiSidebar.codeBlock.copyCode') || '复制代码';

                    // 添加复制功能
                    copyButton.addEventListener('click', () => {
                        const code = codeElement.textContent || '';
                        navigator.clipboard
                            .writeText(code)
                            .then(() => {
                                // 显示复制成功提示
                                pushMsg(t('aiSidebar.success.copySuccess') || '已复制');
                                // 更新按钮图标
                                copyButton.innerHTML =
                                    '<svg><use xlink:href="#iconCheck"></use></svg>';
                                copyButton.classList.add('copied');
                                setTimeout(() => {
                                    copyButton.innerHTML =
                                        '<svg><use xlink:href="#iconCopy"></use></svg>';
                                    copyButton.classList.remove('copied');
                                }, 2000);
                            })
                            .catch(err => {
                                console.error('Copy failed:', err);
                                pushErrMsg(t('aiSidebar.errors.copyFailed') || '复制失败');
                            });
                    });

                    // 换行切换（wrap）
                    const wrapButton = document.createElement('button');
                    wrapButton.className = 'code-block-toolbar-btn code-block-wrap-btn';
                    wrapButton.title = t('aiSidebar.codeBlock.wrapOn') || '开启换行';
                    wrapButton.textContent = '↵';
                    wrapButton.addEventListener('click', () => {
                        const wrapped = pre.classList.toggle('code-block--wrap');
                        wrapButton.classList.toggle('active', wrapped);
                        wrapButton.title = wrapped
                            ? t('aiSidebar.codeBlock.wrapOff') || '关闭换行'
                            : t('aiSidebar.codeBlock.wrapOn') || '开启换行';
                    });

                    // 长代码折叠/展开（仅长代码显示）
                    const codeText = codeElement.textContent || '';
                    const lineCount = codeText.split('\n').length;
                    const isLongCode = lineCount >= 80 || codeText.length >= 4000;
                    let foldButton: HTMLButtonElement | null = null;
                    if (isLongCode) {
                        pre.classList.add('code-block--foldable', 'code-block--collapsed');
                        foldButton = document.createElement('button');
                        foldButton.className = 'code-block-toolbar-btn code-block-fold-btn';
                        foldButton.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
                        foldButton.title = t('aiSidebar.codeBlock.expand') || '展开';
                        foldButton.addEventListener('click', () => {
                            const isCollapsed = pre.classList.contains('code-block--collapsed');
                            pre.classList.toggle('code-block--collapsed', !isCollapsed);
                            pre.classList.toggle('code-block--expanded', isCollapsed);
                            if (foldButton) {
                                foldButton.classList.toggle('active', isCollapsed);
                                foldButton.innerHTML = isCollapsed
                                    ? '<svg><use xlink:href="#iconUp"></use></svg>'
                                    : '<svg><use xlink:href="#iconDown"></use></svg>';
                                foldButton.title = isCollapsed
                                    ? t('aiSidebar.codeBlock.collapse') || '收起'
                                    : t('aiSidebar.codeBlock.expand') || '展开';
                            }
                        });
                    }

                    // 组装工具栏：左(语言) + 右(按钮组)
                    right.appendChild(wrapButton);
                    if (foldButton) right.appendChild(foldButton);
                    right.appendChild(copyButton);
                    toolbar.appendChild(left);
                    toolbar.appendChild(right);

                    // 设置 pre 为相对定位
                    pre.style.position = 'relative';

                    // 将工具栏插入到 pre 的开头
                    pre.insertBefore(toolbar, pre.firstChild);
                });
            } catch (error) {
                console.error('Cleanup code blocks error:', error);
            }
        });
    }

    // 为思源块引用链接添加点击事件
    function setupBlockRefLinks(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 查找所有思源块引用链接 a[href^="siyuan://blocks/"]
                const blockRefLinks = element.querySelectorAll('a[href^="siyuan://blocks/"]');

                blockRefLinks.forEach((link: HTMLElement) => {
                    // 检查是否已经添加过监听器
                    if (link.hasAttribute('data-block-ref-listener')) {
                        return;
                    }

                    // 标记已添加监听器
                    link.setAttribute('data-block-ref-listener', 'true');
                    link.style.cursor = 'pointer';

                    // 添加点击事件监听器
                    link.addEventListener('click', async (event: Event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        const href = link.getAttribute('href');
                        if (!href) return;

                        // 提取块ID：siyuan://blocks/20251107164532-zmaydt9
                        const match = href.match(/siyuan:\/\/blocks\/(.+)/);
                        if (match && match[1]) {
                            const blockId = match[1];
                            try {
                                await openBlock(blockId);
                            } catch (error) {
                                console.error('Open block error:', error);
                                pushErrMsg(`打开块失败: ${(error as Error).message}`);
                            }
                        }
                    });
                });
            } catch (error) {
                console.error('Setup block ref links error:', error);
            }
        });
    }

    // 为消息中的图片添加点击事件，调用图片查看器
    function setupImageClickHandlers(element: HTMLElement) {
        if (!element) return;

        tick().then(() => {
            try {
                // 查找所有图片 img
                const images = element.querySelectorAll(
                    '.ai-message__content img, .ai-message__thinking-content img'
                );

                images.forEach((img: HTMLImageElement) => {
                    // 检查是否已经添加过监听器
                    if (img.hasAttribute('data-image-viewer-listener')) {
                        return;
                    }

                    // 标记已添加监听器
                    img.setAttribute('data-image-viewer-listener', 'true');
                    img.style.cursor = 'zoom-in';

                    // 添加点击事件监听器
                    img.addEventListener('click', (event: Event) => {
                        event.preventDefault();
                        event.stopPropagation();

                        const src = img.getAttribute('src');
                        const alt = img.getAttribute('alt') || 'image';
                        if (src) {
                            openImageViewer(src, alt);
                        }
                    });
                });
            } catch (error) {
                console.error('Setup image click handlers error:', error);
            }
        });
    }

    // 复制单条消息
    function copyMessage(content: string | MessageContent[]) {
        const textContent = typeof content === 'string' ? content : getMessageText(content);
        navigator.clipboard
            .writeText(textContent)
            .then(() => {
                pushMsg(t('aiSidebar.success.copySuccess'));
            })
            .catch(err => {
                pushErrMsg(t('aiSidebar.errors.copyFailed'));
                console.error('Copy failed:', err);
            });
    }

    // 处理复制事件，将选中的HTML内容转换为Markdown
    function handleCopyEvent(event: ClipboardEvent) {
        // 获取选区
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            return; // 没有选中内容，不处理
        }

        // 检查选区是否在消息容器内
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;

        // 只在插件本身的消息容器内处理复制，避免影响思源全局的复制行为。
        // messagesContainer 在组件中已被声明并用于渲染消息列表。
        // 我们要求选区既位于 messagesContainer 的子节点内，且在消息内容元素（.b3-typography）内。
        const messagesContainerEl = (messagesContainer as HTMLElement) || null;
        if (!messagesContainerEl) {
            // 没有消息容器引用，则不处理，保留默认复制行为
            return;
        }

        // 查找选区最近的元素节点起点
        let element: HTMLElement | null =
            container.nodeType === Node.ELEMENT_NODE
                ? (container as HTMLElement)
                : (container.parentElement as HTMLElement | null);

        let isInPluginContainer = false;
        let isInMessageContent = false;

        while (element) {
            if (element === messagesContainerEl) {
                isInPluginContainer = true;
            }
            if (element.classList && element.classList.contains('b3-typography')) {
                isInMessageContent = true;
            }
            // 如果同时满足在容器内且位于消息内容，则可处理
            if (isInPluginContainer && isInMessageContent) break;

            element = element.parentElement;
        }

        // 只有当选区在本插件的 messagesContainer 且在 .b3-typography 内，才处理转换
        if (!(isInPluginContainer && isInMessageContent)) {
            return;
        }

        // 阻止默认复制行为
        event.preventDefault();

        try {
            // 获取选中内容的HTML
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());

            // 检查选区是否包含代码块或 code 元素
            // 使用更可靠的方式：检查选区开始/结束节点的祖先是否包含 code/pre
            const startContainer = range.startContainer as Node | null;
            const endContainer = range.endContainer as Node | null;
            const startElem =
                startContainer && startContainer.nodeType === Node.ELEMENT_NODE
                    ? (startContainer as Element)
                    : (startContainer?.parentElement as Element | null);
            const endElem =
                endContainer && endContainer.nodeType === Node.ELEMENT_NODE
                    ? (endContainer as Element)
                    : (endContainer?.parentElement as Element | null);

            // 检查是否包含公式元素
            const containsMath = !!div.querySelector(
                '.language-math, [data-subtype="math"], .katex'
            );

            // 检查是否在纯代码块内（开始和结束都在代码块内，且不包含公式）
            let isPureCodeBlock = false;
            if (!containsMath) {
                const startInCode = startElem && !!startElem.closest('pre, code');
                const endInCode = endElem && !!endElem.closest('pre, code');
                isPureCodeBlock = startInCode && endInCode;
            }

            // 如果是纯代码块选择（不包含公式），使用纯文本复制
            if (isPureCodeBlock) {
                const text = selection.toString();
                event.clipboardData?.setData('text/plain', text);
            } else {
                // 包含公式或混合内容，使用占位符方式处理
                const { html, placeholders } = extractMathFormulasToPlaceholders(div);

                // 使用思源的 Lute 将 HTML 转换为 Markdown
                if (window.Lute) {
                    const lute = window.Lute.New();
                    let markdown = lute.HTML2Md(html);

                    // 将占位符还原为公式
                    markdown = restorePlaceholdersToFormulas(markdown, placeholders);

                    // 将Markdown写入剪贴板
                    event.clipboardData?.setData('text/plain', markdown);
                } else {
                    // 降级：如果Lute不可用，使用纯文本
                    const text = selection.toString();
                    event.clipboardData?.setData('text/plain', text);
                }
            }
        } catch (error) {
            console.error('Copy event handler error:', error);
            // 出错时使用默认行为（纯文本）
            const text = selection.toString();
            event.clipboardData?.setData('text/plain', text);
        }
    }

    // 提取公式并替换为占位符，避免被 Lute 转义
    function extractMathFormulasToPlaceholders(container: HTMLElement): {
        html: string;
        placeholders: Map<string, string>;
    } {
        const placeholders = new Map<string, string>();
        let placeholderIndex = 0;

        // 生成唯一的占位符ID
        const generatePlaceholder = (formula: string, isBlock: boolean): string => {
            const id = `MATHFORMULA${placeholderIndex}ENDMATHFORMULA`;
            placeholderIndex++;
            placeholders.set(id, isBlock ? `\n$$\n${formula}\n$$\n` : `$${formula}$`);
            return id;
        };

        // 处理新格式的行内公式 span.language-math
        const inlineMathElements = Array.from(container.querySelectorAll('span.language-math'));
        inlineMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (!originalContent) {
                // 尝试从未渲染的元素中提取
                const mathSpans = mathElement.querySelectorAll('span.katex-mathml');
                if (mathSpans.length > 0) {
                    const annotation = mathSpans[0].querySelector(
                        'annotation[encoding="application/x-tex"]'
                    );
                    if (annotation) {
                        originalContent = annotation.textContent?.trim() || '';
                    }
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, false);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理新格式的块级公式 div.language-math
        const blockMathElements = Array.from(container.querySelectorAll('div.language-math'));
        blockMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (!originalContent) {
                const mathSpans = mathElement.querySelectorAll('span.katex-mathml');
                if (mathSpans.length > 0) {
                    const annotation = mathSpans[0].querySelector(
                        'annotation[encoding="application/x-tex"]'
                    );
                    if (annotation) {
                        originalContent = annotation.textContent?.trim() || '';
                    }
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, true);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理旧格式的公式元素（带 data-subtype="math" 属性）
        const oldMathElements = Array.from(container.querySelectorAll('[data-subtype="math"]'));
        oldMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                const placeholder = generatePlaceholder(originalContent, false);
                const textNode = document.createTextNode(placeholder);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理所有 KaTeX 渲染后的元素
        const katexElements = Array.from(container.querySelectorAll('.katex'));
        katexElements.forEach((katexElement: HTMLElement) => {
            // 检查是否已被处理
            if (!katexElement.parentNode) {
                return;
            }

            let originalContent = '';

            // 首先尝试从 KaTeX 的 MathML annotation 中获取
            const annotation = katexElement.querySelector(
                'annotation[encoding="application/x-tex"]'
            );
            if (annotation) {
                originalContent = annotation.textContent?.trim() || '';
            }

            // 如果没有，尝试从父元素的 data-content 获取
            if (!originalContent) {
                const parent = katexElement.parentElement;
                if (parent) {
                    originalContent = parent.getAttribute('data-content') || '';
                }
            }

            if (originalContent) {
                const isDisplay = katexElement.classList.contains('katex-display');
                const placeholder = generatePlaceholder(originalContent, isDisplay);
                const textNode = document.createTextNode(placeholder);
                katexElement.parentNode?.replaceChild(textNode, katexElement);
            }
        });

        return { html: container.innerHTML, placeholders };
    }

    // 将占位符还原为公式
    function restorePlaceholdersToFormulas(
        markdown: string,
        placeholders: Map<string, string>
    ): string {
        let result = markdown;

        // 按照占位符ID排序，确保按顺序替换
        const sortedPlaceholders = Array.from(placeholders.entries()).sort((a, b) => {
            const aNum = parseInt(a[0].match(/\d+/)?.[0] || '0');
            const bNum = parseInt(b[0].match(/\d+/)?.[0] || '0');
            return aNum - bNum;
        });

        sortedPlaceholders.forEach(([placeholder, formula]) => {
            // 使用全局替换，处理可能被 Lute 转义的情况
            result = result.split(placeholder).join(formula);
            // 也处理可能被转义的版本
            result = result.split(placeholder.replace(/\$/g, '\\$')).join(formula);
        });

        return result;
    }

    // 将渲染后的公式元素还原为 Markdown 格式（已弃用，保留以防需要）
    function restoreMathFormulasToMarkdown(container: HTMLElement) {
        // 处理新格式的行内公式 span.language-math
        const inlineMathElements = container.querySelectorAll('span.language-math');
        inlineMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            // 如果没有 data-content 属性，尝试从 KaTeX annotation 获取
            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            // 如果还是没有，尝试从原始 textContent 获取（渲染前的状态）
            if (!originalContent) {
                originalContent = mathElement.textContent?.trim() || '';
            }

            if (originalContent) {
                // 还原为行内公式格式 $...$
                const textNode = document.createTextNode(`$${originalContent}$`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理新格式的块级公式 div.language-math
        const blockMathElements = container.querySelectorAll('div.language-math');
        blockMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            // 如果没有 data-content 属性，尝试从 KaTeX annotation 获取
            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            // 如果还是没有，尝试从原始 textContent 获取
            if (!originalContent) {
                originalContent = mathElement.textContent?.trim() || '';
            }

            if (originalContent) {
                // 还原为块级公式格式 $$...$$
                const textNode = document.createTextNode(`\n$$\n${originalContent}\n$$\n`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理旧格式的公式元素（带 data-subtype="math" 属性）
        const oldMathElements = container.querySelectorAll('[data-subtype="math"]');
        oldMathElements.forEach((mathElement: HTMLElement) => {
            let originalContent = mathElement.getAttribute('data-content');

            if (!originalContent) {
                const annotation = mathElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                const textNode = document.createTextNode(`$${originalContent}$`);
                mathElement.parentNode?.replaceChild(textNode, mathElement);
            }
        });

        // 处理 KaTeX 渲染后的元素（包含 .katex class），这是最通用的处理方式
        const katexElements = container.querySelectorAll('.katex');
        katexElements.forEach((katexElement: HTMLElement) => {
            // 避免重复处理已经被上面逻辑处理过的元素
            if (!katexElement.parentNode) {
                return;
            }

            let originalContent = '';

            // 首先尝试从父元素的 data-content 获取
            const parent = katexElement.parentElement;
            if (parent) {
                originalContent = parent.getAttribute('data-content') || '';
            }

            // 如果没有，尝试从 annotation 标签中获取原始 LaTeX（KaTeX 渲染时会添加）
            if (!originalContent) {
                const annotation = katexElement.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );
                if (annotation) {
                    originalContent = annotation.textContent?.trim() || '';
                }
            }

            if (originalContent) {
                // 判断是行内还是块级公式
                const isDisplay = katexElement.classList.contains('katex-display');
                const textNode = isDisplay
                    ? document.createTextNode(`\n$$\n${originalContent}\n$$\n`)
                    : document.createTextNode(`$${originalContent}$`);

                // 如果父元素有特殊标记（如 language-math），替换父元素，否则替换 katex 元素本身
                if (
                    parent &&
                    (parent.classList.contains('language-math') ||
                        parent.hasAttribute('data-subtype'))
                ) {
                    parent.parentNode?.replaceChild(textNode, parent);
                } else {
                    katexElement.parentNode?.replaceChild(textNode, katexElement);
                }
            }
        });
    }

    // 处理消息框右键菜单
    function handleContextMenu(
        event: MouseEvent,
        messageIndex: number,
        messageType: 'user' | 'assistant',
        isMultiModel = false,
        messageCount = 1
    ) {
        event.preventDefault();
        event.stopPropagation();

        // 设置菜单位置
        contextMenuX = event.clientX;
        contextMenuY = event.clientY;
        contextMenuMessageIndex = messageIndex;
        contextMenuMessageCount = Math.max(1, Number(messageCount || 1));
        contextMenuMessageType = messageType;
        contextMenuIsMultiModel = !!isMultiModel;
        // 判断当前是否有选区，且选区位于当前消息元素内
        try {
            const sel = window.getSelection();
            selectionInMessage = false;
            selectionHtml = '';
            selectionText = '';

            if (sel && !sel.isCollapsed) {
                const currentTarget = event.currentTarget as HTMLElement | null;
                if (currentTarget) {
                    const anchorNode = sel.anchorNode;
                    const focusNode = sel.focusNode;
                    if (anchorNode && focusNode) {
                        const anchorEl = (anchorNode as Node).parentElement;
                        const focusEl = (focusNode as Node).parentElement;
                        if (
                            anchorEl &&
                            focusEl &&
                            currentTarget.contains(anchorEl) &&
                            currentTarget.contains(focusEl)
                        ) {
                            selectionInMessage = true;
                            // 获取选区的 HTML
                            const range = sel.getRangeAt(0);
                            const div = document.createElement('div');
                            div.appendChild(range.cloneContents());
                            selectionHtml = div.innerHTML;
                            selectionText = sel.toString();
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Context menu selection detection failed:', err);
            selectionInMessage = false;
            selectionHtml = '';
            selectionText = '';
        }

        contextMenuVisible = true;
    }

    // 关闭右键菜单
    function closeContextMenu() {
        contextMenuVisible = false;
        contextMenuMessageIndex = null;
        contextMenuMessageCount = 1;
        contextMenuMessageType = null;
    }

    // 处理右键菜单项点击
    async function handleContextMenuAction(
        action:
            | 'copy'
            | 'copy_md'
            | 'copy_plain'
            | 'copy_html'
            | 'edit'
            | 'delete'
            | 'regenerate'
            | 'save'
    ) {
        if (contextMenuMessageIndex === null) return;

        const messageIndex = contextMenuMessageIndex;
        closeContextMenu();

        switch (action) {
            case 'copy': {
                // 旧行为：复制整条消息文本（或多模型整条响应）
                if (contextMenuIsMultiModel) {
                    try {
                        const el = document.elementFromPoint(
                            contextMenuX,
                            contextMenuY
                        ) as HTMLElement | null;
                        const container = el?.closest(
                            '.ai-sidebar__multi-model-card-content, .ai-sidebar__multi-model-tab-panel-content'
                        ) as HTMLElement | null;
                        const text = container
                            ? container.innerText
                            : multiModelResponses[messageIndex]?.content || '';
                        await navigator.clipboard.writeText(text);
                        pushMsg(t('aiSidebar.success.copySuccess'));
                    } catch (err) {
                        console.error('Copy multi-model response failed:', err);
                        pushErrMsg(t('aiSidebar.errors.copyFailed'));
                    }
                } else {
                    const message = messages[messageIndex];
                    if (message) {
                        copyMessage(message.content);
                    }
                }
                break;
            }
            case 'copy_md':
            case 'copy_plain':
            case 'copy_html': {
                // 如果有选区且选区属于消息，按类型复制选区
                if (selectionInMessage && selectionText) {
                    try {
                        if (action === 'copy_md') {
                            // Markdown: 尝试使用 Lute 转换 HTML->Markdown
                            if (window.Lute) {
                                const lute = window.Lute.New();
                                const md = lute.HTML2Md(selectionHtml || selectionText);
                                await navigator.clipboard.writeText(md);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else {
                                // 降级为纯文本
                                await navigator.clipboard.writeText(selectionText);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        } else if (action === 'copy_plain') {
                            await navigator.clipboard.writeText(selectionText);
                            pushMsg(t('aiSidebar.success.copySuccess'));
                        } else if (action === 'copy_html') {
                            // 尝试写入富文本（text/html + text/plain）
                            if (navigator.clipboard && (navigator.clipboard as any).write) {
                                const blobPlain = new Blob([selectionText], { type: 'text/plain' });
                                const blobHtml = new Blob([selectionHtml || selectionText], {
                                    type: 'text/html',
                                });
                                const item: any = new ClipboardItem({
                                    'text/plain': blobPlain,
                                    'text/html': blobHtml,
                                });
                                await (navigator.clipboard as any).write([item]);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else {
                                // 回退到纯文本
                                await navigator.clipboard.writeText(selectionText);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        }
                    } catch (err) {
                        console.error('Copy selection failed:', err);
                        pushErrMsg(t('aiSidebar.errors.copyFailed'));
                    }
                } else {
                    // 如果是多模型区域且没有选区，复制整个多模型响应内容
                    if (contextMenuIsMultiModel) {
                        try {
                            const el = document.elementFromPoint(
                                contextMenuX,
                                contextMenuY
                            ) as HTMLElement | null;
                            const container = el?.closest(
                                '.ai-sidebar__multi-model-card-content, .ai-sidebar__multi-model-tab-panel-content'
                            ) as HTMLElement | null;
                            const html = container
                                ? container.innerHTML
                                : multiModelResponses[messageIndex]?.content || '';
                            const text = container
                                ? container.innerText
                                : multiModelResponses[messageIndex]?.content || '';

                            if (action === 'copy_md') {
                                if (window.Lute) {
                                    const lute = window.Lute.New();
                                    const md = lute.HTML2Md(html || text);
                                    await navigator.clipboard.writeText(md);
                                } else {
                                    await navigator.clipboard.writeText(text);
                                }
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else if (action === 'copy_plain') {
                                await navigator.clipboard.writeText(text);
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            } else if (action === 'copy_html') {
                                if (navigator.clipboard && (navigator.clipboard as any).write) {
                                    const blobPlain = new Blob([text], { type: 'text/plain' });
                                    const blobHtml = new Blob([html || text], {
                                        type: 'text/html',
                                    });
                                    const item: any = new ClipboardItem({
                                        'text/plain': blobPlain,
                                        'text/html': blobHtml,
                                    });
                                    await (navigator.clipboard as any).write([item]);
                                } else {
                                    await navigator.clipboard.writeText(text);
                                }
                                pushMsg(t('aiSidebar.success.copySuccess'));
                            }
                        } catch (err) {
                            console.error('Copy multi-model content failed:', err);
                            pushErrMsg(t('aiSidebar.errors.copyFailed'));
                        }
                    } else {
                        pushErrMsg(t('aiSidebar.errors.noSelection'));
                    }
                }

                // 清理选区状态
                selectionInMessage = false;
                selectionHtml = '';
                selectionText = '';
                break;
            }
            case 'delete':
                deleteMessage(messageIndex, contextMenuMessageCount);
                break;
            case 'regenerate':
                regenerateMessage(messageIndex);
                break;
        }
    }

    // 搜索文档
    async function searchDocuments() {
        isSearching = true;
        try {
            // 如果没有输入关键词，显示当前文档
            if (!searchKeyword.trim()) {
                const currentProtyle = getActiveEditor(false)?.protyle;
                const blockId = currentProtyle?.block?.id;

                if (blockId) {
                    // 获取当前文档信息
                    const blocks = await sql(
                        `SELECT * FROM blocks WHERE id = '${blockId}' OR root_id = '${blockId}'`
                    );
                    if (blocks && blocks.length > 0) {
                        // 查找文档块
                        const docBlock = blocks.find(b => b.type === 'd');
                        if (docBlock) {
                            searchResults = [docBlock];
                        } else {
                            // 如果当前块不是文档块，获取所属文档
                            const rootId = blocks[0].root_id;
                            const rootBlocks = await sql(
                                `SELECT * FROM blocks WHERE id = '${rootId}' AND type = 'd'`
                            );
                            searchResults = rootBlocks || [];
                        }
                    } else {
                        searchResults = [];
                    }
                } else {
                    searchResults = [];
                }
                isSearching = false;
                return;
            }

            // 将空格分隔的关键词转换为 SQL LIKE 查询
            // 转义单引号以防止SQL注入
            const keywords = searchKeyword
                .trim()
                .split(/\s+/)
                .map(kw => kw.replace(/'/g, "''"));
            const conditions = keywords.map(kw => `content LIKE '%${kw}%'`).join(' AND ');
            const sqlQuery = `SELECT * FROM blocks WHERE ${conditions} AND type = 'd' ORDER BY updated DESC LIMIT 20`;

            const results = await sql(sqlQuery);
            searchResults = results || [];
        } catch (error) {
            console.error('Search error:', error);
            searchResults = [];
        } finally {
            isSearching = false;
        }
    }

    // 自动搜索（带防抖）
    function autoSearch() {
        // 清除之前的定时器
        if (searchTimeout !== null) {
            clearTimeout(searchTimeout);
        }

        // 设置新的定时器，500ms后执行搜索
        searchTimeout = window.setTimeout(() => {
            searchDocuments();
        }, 500);
    }

    // 监听搜索关键词变化
    $: {
        if (isSearchDialogOpen && searchKeyword !== undefined) {
            autoSearch();
        }
    }

    // 监听对话框关闭，清理搜索状态
    $: {
        if (!isSearchDialogOpen) {
            if (searchTimeout !== null) {
                clearTimeout(searchTimeout);
                searchTimeout = null;
            }
            // 不清空 searchKeyword 和 searchResults，保留用户的搜索历史
        }
    }

    // 添加文档到上下文
    async function addDocumentToContext(docId: string, docTitle: string) {
        // 检查是否已存在
        if (contextDocuments.find(doc => doc.id === docId)) {
            pushMsg(t('aiSidebar.success.documentExists'));
            return;
        }

        try {
            // agent模式下，文档只存储块ID，不获取内容
            if (chatMode === 'agent') {
                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: docId,
                        title: docTitle,
                        content: '', // agent模式下不存储内容，只存储ID
                        type: 'doc',
                    },
                ];
                closeSearchDialog();
                searchKeyword = '';
                searchResults = [];
                return;
            }

            // 非agent模式：获取文档内容
            const data = await exportMdContent(docId, false, false, 2, 0, false);
            if (data && data.content) {
                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: docId,
                        title: docTitle,
                        content: data.content,
                        type: 'doc',
                    },
                ];
                closeSearchDialog();
                searchKeyword = '';
                searchResults = [];
            }
        } catch (error) {
            console.error('Add document error:', error);
            pushErrMsg(t('aiSidebar.errors.addDocumentFailed'));
        }
    }

    // 获取当前聚焦的编辑器
    function getProtyle() {
        return getActiveEditor(false)?.protyle;
    }

    function refreshCurrentNotePageAfterReply() {
        try {
            const currentProtyle = getProtyle();
            if (!currentProtyle?.getInstance) return;
            setTimeout(() => {
                try {
                    currentProtyle.getInstance()?.reload(false);
                } catch (error) {
                    console.warn('刷新当前笔记页面失败:', error);
                }
            }, 0);
        } catch (error) {
            console.warn('刷新当前笔记页面失败:', error);
        }
    }

    // 获取当前聚焦的块ID
    function getFocusedBlockId(): string | null {
        const protyle = getProtyle();
        if (!protyle) return null;

        // 获取ID：当有聚焦块时获取聚焦块ID，否则获取文档ID
        return protyle.block?.id || protyle.options?.blockId || protyle.block?.parentID || null;
    }

    // 通过块ID添加文档
    async function addItemByBlockId(blockId: string, forceFocusedBlock: boolean = false) {
        try {
            // 如果是从拖放操作且有聚焦块，则使用聚焦块
            let targetBlockId = blockId;
            if (forceFocusedBlock) {
                const focusedId = getFocusedBlockId();
                if (focusedId) {
                    targetBlockId = focusedId;
                }
            }

            const blocks = await sql(`SELECT * FROM blocks WHERE id = '${targetBlockId}'`);
            if (blocks && blocks.length > 0) {
                const block = blocks[0];
                let docId = targetBlockId;
                let docTitle = t('common.untitled');

                // 如果是文档块，直接添加
                if (block.type === 'd') {
                    docTitle = block.content || t('common.untitled');
                    await addDocumentToContext(docId, docTitle);
                } else {
                    // 如果是普通块，获取所属文档的标题
                    const rootBlocks = await sql(
                        `SELECT content FROM blocks WHERE id = '${block.root_id}' AND type = 'd'`
                    );
                    if (rootBlocks && rootBlocks.length > 0) {
                        docTitle = rootBlocks[0].content || '未命名文档';
                    }
                    // 添加该块的内容
                    await addBlockToContext(targetBlockId, docTitle);
                }
            }
        } catch (error) {
            console.error('Add block error:', error);
            pushErrMsg(t('aiSidebar.errors.addBlockFailed'));
        }
    }

    // 添加块到上下文（而不是整个文档）
    async function addBlockToContext(blockId: string, blockTitle: string) {
        // 检查是否已存在
        if (contextDocuments.find(doc => doc.id === blockId)) {
            pushMsg(t('aiSidebar.success.blockExists'));
            return;
        }

        try {
            // 获取块信息以判断类型
            const blockInfo = await getBlockByID(blockId);
            const isDoc = blockInfo?.type === 'd'; // 'd' 表示文档块

            // agent模式和edit模式：获取kramdown格式（用于AI），但使用Markdown生成显示标题
            if (chatMode === 'agent' || chatMode === 'edit') {
                const blockData = await getBlockKramdown(blockId);
                if (blockData && blockData.kramdown) {
                    // 获取Markdown格式用于生成友好的显示标题
                    let displayTitle = '块内容';
                    try {
                        const mdData = await exportMdContent(blockId, false, false, 2, 0, false);
                        if (mdData && mdData.content) {
                            const contentPreview = mdData.content.replace(/\n/g, ' ').trim();
                            displayTitle =
                                contentPreview.length > 20
                                    ? contentPreview.substring(0, 20) + '...'
                                    : contentPreview || (isDoc ? '文档内容' : '块内容');
                        }
                    } catch (error) {
                        console.warn('获取Markdown预览失败，使用kramdown生成标题:', error);
                        // 降级使用kramdown生成标题
                        const contentPreview = blockData.kramdown.replace(/\n/g, ' ').trim();
                        displayTitle =
                            contentPreview.length > 20
                                ? contentPreview.substring(0, 20) + '...'
                                : contentPreview || (isDoc ? '文档内容' : '块内容');
                    }

                    contextDocuments = [
                        ...contextDocuments,
                        {
                            id: blockId,
                            title: displayTitle,
                            content: blockData.kramdown, // 存储kramdown格式用于AI
                            type: isDoc ? 'doc' : 'block',
                        },
                    ];
                }
                return;
            }

            // ask模式：获取块的Markdown内容
            const data = await exportMdContent(blockId, false, false, 2, 0, false);
            if (data && data.content) {
                // 检查是否为纯图片块（只包含图片Markdown语法）
                const content = data.content.trim();
                const imageRegex = /^!\[([^\]]*)\]\(([^)]+)\)$/;
                const match = content.match(imageRegex);

                if (match) {
                    // 这是一个纯图片块，自动上传图片
                    const imagePath = match[2]; // 图片路径，如 assets/xxx.png
                    const imageName = match[1] || '图片'; // 图片名称

                    try {
                        // 使用思源 API 获取图片文件
                        // 思源笔记的图片路径格式：assets/xxx-xxxxx.png
                        const blob = await getFileBlob(`/data/${imagePath}`);

                        if (blob) {
                            // 从文件路径提取文件名作为默认名称
                            const fileName = imagePath.split('/').pop() || 'image.png';
                            const file = new File([blob], imageName || fileName, {
                                type: blob.type,
                            });

                            // 使用统一的图片附件添加逻辑（包含保存到资源目录）
                            await addImageAttachment(file);

                            pushMsg(t('aiSidebar.success.imageAutoUploaded'));
                            return; // 图片已作为附件添加，不需要再添加为上下文文档
                        } else {
                            console.warn('无法加载图片，将作为普通块处理');
                        }
                    } catch (error) {
                        console.error('自动上传图片失败:', error);
                        pushErrMsg(t('aiSidebar.errors.autoUploadImageFailed'));
                        // 失败时继续作为普通块处理
                    }
                }

                // 不是纯图片块或上传失败，按照原有逻辑处理
                // 从块内容中提取前20个字作为显示标题
                const contentPreview = data.content.replace(/\n/g, ' ').trim();
                const displayTitle =
                    contentPreview.length > 20
                        ? contentPreview.substring(0, 20) + '...'
                        : contentPreview || (isDoc ? '文档内容' : '块内容');

                contextDocuments = [
                    ...contextDocuments,
                    {
                        id: blockId,
                        title: displayTitle,
                        content: data.content,
                        type: isDoc ? 'doc' : 'block',
                    },
                ];
            }
        } catch (error) {
            console.error('Add block error:', error);
            pushErrMsg(t('aiSidebar.errors.addBlockContentFailed'));
        }
    }

    // 删除上下文文档
    function removeContextDocument(docId: string) {
        contextDocuments = contextDocuments.filter(doc => doc.id !== docId);
    }

    // 打开文档
    async function openDocument(docId: string) {
        try {
            await openBlock(docId);
        } catch (error) {
            console.error('Open document error:', error);
            pushErrMsg(t('aiSidebar.errors.openDocumentFailed'));
        }
    }

    // 处理拖放
    function handleDragOver(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        isDragOver = true;
    }

    function handleDragLeave(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        // 只在真正离开容器时才设置为false
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        if (
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom
        ) {
            isDragOver = false;
        }
    }

    async function handleDrop(event: DragEvent) {
        if (event.dataTransfer.types.includes('application/multi-model-sort')) {
            return;
        }
        event.preventDefault();
        isDragOver = false;

        // 处理标准文件拖放
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                await addFileAttachment(files[i]);
            }
            return;
        }

        const type = event.dataTransfer.types[0];
        if (!type) return;

        if (type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
            const meta = type.replace(Constants.SIYUAN_DROP_GUTTER, '');
            const info = meta.split(Constants.ZWSP);
            console.log('Dropped gutter info:', info);
            const blockIdStr = info[2];
            const blockIds = blockIdStr
                .split(',')
                .map(id => id.trim())
                .filter(id => id && id !== '/');
            // 批量添加到上下文
            if (blockIds.length > 0) {
                for (const blockid of blockIds) {
                    await addItemByBlockId(blockid, false);
                }
            }
        } else if (type.startsWith(Constants.SIYUAN_DROP_FILE)) {
            // 支持单选和多选拖放
            const ele: HTMLElement = (window as any).siyuan?.dragElement;
            if (ele && ele.innerText) {
                // 获取块ID字符串，可能是单个ID或逗号分隔的多个ID
                const blockIdStr = ele.innerText;

                // 分割成多个块ID（多选时用逗号分隔）
                const blockIds = blockIdStr
                    .split(',')
                    .map(id => id.trim())
                    .filter(id => id && id !== '/');

                // 批量添加到上下文
                if (blockIds.length > 0) {
                    for (const blockid of blockIds) {
                        await addItemByBlockId(blockid, false);
                        // 恢复文档树节点的透明度
                        const item: HTMLElement = document.querySelector(
                            `.file-tree.sy__tree li[data-node-id="${blockid}"]`
                        );
                        if (item) {
                            item.style.opacity = '1';
                        }
                    }
                }

                (window as any).siyuan.dragElement = undefined;
            }
        } else if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
            const data = event.dataTransfer.getData(Constants.SIYUAN_DROP_TAB);
            const payload = JSON.parse(data);
            const rootId = payload?.children?.rootId;
            if (rootId) {
                // 拖放页签时：使用拖拽的文档ID，不应覆盖为当前聚焦的块ID
                // 之前传入了 true 来使用聚焦块，这会导致插件错误地使用当前已打开的文档
                // 而不是拖动的文档。改为 false 以使用拖动的文档 ID。
                await addItemByBlockId(rootId, false);
            }
            const tab = document.querySelector(
                `li[data-type="tab-header"][data-id="${payload.id}"]`
            ) as HTMLElement;
            if (tab) {
                tab.style.opacity = 'unset';
            }
        }
    }

    // 会话管理函数
    async function loadSessions() {
        try {
            const data = await plugin.loadData('chat-sessions.json');
            sessions = data?.sessions || [];

            // 检查是否需要迁移
            if (!settings.dataTransfer?.sessionData) {
                await migrateSessions();
            }
        } catch (error) {
            console.error('Load sessions error:', error);
            sessions = [];
        }
    }

    // 迁移旧会话到独立文件
    async function migrateSessions() {
        console.log('Starting session storage migration...');
        // 确保会话目录存在
        try {
            await putFile('/data/storage/petal/siyuan-plugin-copilot/sessions', true, null);
        } catch (e) {
            // 目录可能已存在
        }
        let migratedCount = 0;

        for (let i = 0; i < sessions.length; i++) {
            const session = sessions[i];
            // 如果 messages 存在且不为空，说明是旧版全量存储，需要迁移
            if (session.messages && session.messages.length > 0) {
                try {
                    // 先处理消息中的资源（提取 base64 到 SiYuan 存储）
                    const processedMessages = await Promise.all(
                        session.messages.map(async msg => {
                            const newAttachments = msg.attachments
                                ? await Promise.all(
                                      msg.attachments.map(async att => {
                                          // 如果有 data 且没有 path，尝试保存为资源
                                          if (
                                              att.data &&
                                              att.data.startsWith('data:') &&
                                              !att.path
                                          ) {
                                              try {
                                                  const blob = base64ToBlob(
                                                      att.data,
                                                      att.mimeType || 'image/png'
                                                  );
                                                  const assetPath = await saveAsset(blob, att.name);
                                                  return { ...att, data: '', path: assetPath };
                                              } catch (e) {
                                                  console.error('Failed to migrate attachment:', e);
                                                  return att;
                                              }
                                          }
                                          return att;
                                      })
                                  )
                                : undefined;

                            const newGeneratedImages = msg.generatedImages
                                ? await Promise.all(
                                      msg.generatedImages.map(async img => {
                                          if (img.data && img.data.length > 50 && !img.path) {
                                              try {
                                                  const blob = base64ToBlob(
                                                      img.data,
                                                      img.mimeType || 'image/png'
                                                  );
                                                  const assetPath = await saveAsset(
                                                      blob,
                                                      'generated-image.png'
                                                  );
                                                  return { ...img, data: '', path: assetPath };
                                              } catch (e) {
                                                  console.error(
                                                      'Failed to migrate generated image:',
                                                      e
                                                  );
                                                  return img;
                                              }
                                          }
                                          return img;
                                      })
                                  )
                                : undefined;

                            return {
                                ...msg,
                                attachments: newAttachments,
                                generatedImages: newGeneratedImages,
                            };
                        })
                    );

                    // 保存完整内容到 individual 文件
                    const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${session.id}.json`;
                    const content = JSON.stringify({ messages: processedMessages }, null, 2);
                    const blob = new Blob([content], { type: 'application/json' });
                    await putFile(path, false, blob);

                    // 更新 metadata
                    session.messageCount = session.messages.filter(m => m.role !== 'system').length;
                    delete session.messages;
                    migratedCount++;
                } catch (e) {
                    console.error(`Failed to migrate session ${session.id}:`, e);
                }
            }
        }

        if (migratedCount > 0) {
            await saveSessions();
            console.log(`Successfully migrated ${migratedCount} sessions.`);
        }

        // 更新配置中的迁移标志
        if (!settings.dataTransfer) {
            settings.dataTransfer = { sessionData: true };
        } else {
            settings.dataTransfer.sessionData = true;
        }
        await plugin.saveSettings(settings);
    }

    async function saveSessions() {
        try {
            // 只保存 metadata 到 chat-sessions.json
            const metadata = sessions.map(s => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { messages, ...rest } = s;
                return {
                    ...rest,
                    messageCount:
                        s.messageCount ||
                        (messages ? messages.filter(m => m.role !== 'system').length : 0),
                };
            });
            await plugin.saveData('chat-sessions.json', { sessions: metadata });
        } catch (error) {
            console.error('Save sessions error:', error);
            pushErrMsg(t('aiSidebar.errors.saveSessionFailed'));
        }
    }

    function normalizeSessionTitle(raw: string, maxLength = 30): string {
        const normalized = String(raw || '')
            .replace(/\r\n/g, '\n')
            .replace(/\s+/g, ' ')
            .trim();
        if (!normalized) return '';
        return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
    }

    function generateSessionTitleFromText(content: string | MessageContent[]): string {
        return normalizeSessionTitle(getMessageText(content));
    }

    function generateSessionTitle(): string {
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length > 0) {
            const firstMessageTitle = generateSessionTitleFromText(userMessages[0].content);
            if (firstMessageTitle) return firstMessageTitle;
        }
        return t('aiSidebar.session.new');
    }

    async function saveCurrentSession(silent: boolean = false) {
        if (messages.filter(m => m.role !== 'system').length === 0) {
            if (!silent) {
                pushErrMsg(t('aiSidebar.errors.emptySession'));
            }
            return;
        }

        const now = Date.now();

        // 【修复】在保存前重新加载最新的会话列表，避免多页签覆盖问题
        await loadSessions();

        if (currentSessionId) {
            // 更新现有会话
            const session = sessions.find(s => s.id === currentSessionId);
            if (session) {
                session.updatedAt = now;
                session.messageCount = messages.filter(m => m.role !== 'system').length;

                // 1. 保存 metadata 列表
                await saveSessions();

                // 2. 将消息中的 Blob URL 转换为 path 以便永久存储
                const messagesToSave = messages.map(msg => ({
                    ...msg,
                    attachments: msg.attachments?.map(att => ({
                        ...att,
                        data: att.path ? '' : att.data, // 如果有 path，清空 data
                    })),
                    generatedImages: msg.generatedImages?.map(img => ({
                        ...img,
                        data: '', // 不再这里存 base64
                    })),
                }));

                // 3. 保存完整内容到独立文件
                const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${currentSessionId}.json`;
                const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
                const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
                await putFile(sessionPath, false, sessionBlob);
            } else {
                // 如果会话不存在，创建为新会话
                const userContent = messages.find(m => m.role === 'user')?.content || '';
                const newSession: ChatSession = {
                    id: currentSessionId,
                    title:
                        typeof userContent === 'string'
                            ? generateSessionTitleFromText(userContent) || generateSessionTitle()
                            : generateSessionTitle(),
                    messageCount: messages.filter(m => m.role !== 'system').length,
                    createdAt: now,
                    updatedAt: now,
                };
                sessions = [newSession, ...sessions];
                await saveSessions();

                // 保存完整内容
                const messagesToSave = messages.map(msg => ({
                    ...msg,
                    attachments: msg.attachments?.map(att => ({
                        ...att,
                        data: att.path ? '' : att.data,
                    })),
                    generatedImages: msg.generatedImages?.map(img => ({
                        ...img,
                        data: '',
                    })),
                }));
                const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${currentSessionId}.json`;
                const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
                const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
                await putFile(sessionPath, false, sessionBlob);
            }
        } else {
            // 创建新会话
            const userContent = messages.find(m => m.role === 'user')?.content || '';
            const newSession: ChatSession = {
                id: `session_${now}`,
                title:
                    typeof userContent === 'string'
                        ? generateSessionTitleFromText(userContent) || generateSessionTitle()
                        : generateSessionTitle(),
                messageCount: messages.filter(m => m.role !== 'system').length,
                createdAt: now,
                updatedAt: now,
            };
            sessions = [newSession, ...sessions];
            currentSessionId = newSession.id;
            await saveSessions();

            // 保存完整内容
            const messagesToSave = messages.map(msg => ({
                ...msg,
                attachments: msg.attachments?.map(att => ({
                    ...att,
                    data: att.path ? '' : att.data,
                })),
                generatedImages: msg.generatedImages?.map(img => ({
                    ...img,
                    data: '',
                })),
            }));
            const sessionPath = `/data/storage/petal/siyuan-plugin-copilot/sessions/${newSession.id}.json`;
            const sessionContent = JSON.stringify({ messages: messagesToSave }, null, 2);
            const sessionBlob = new Blob([sessionContent], { type: 'application/json' });
            await putFile(sessionPath, false, sessionBlob);
        }
        hasUnsavedChanges = false;

        if (!silent) {
            pushMsg(t('aiSidebar.success.saveSessionSuccess'));
        }
    }

    async function loadSessionMessagesForExport(sessionId: string): Promise<Message[]> {
        if (sessionId === currentSessionId && messages.length > 0) {
            return [...messages];
        }

        const sessionMetadata = sessions.find(s => s.id === sessionId);
        if (sessionMetadata?.messages && sessionMetadata.messages.length > 0) {
            return sessionMetadata.messages;
        }

        try {
            const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`;
            const blob = await getFileBlob(path);
            if (!blob) {
                return [];
            }
            const text = await blob.text();
            const sessionData = JSON.parse(text);
            return Array.isArray(sessionData?.messages) ? sessionData.messages : [];
        } catch (error) {
            console.error('Failed to load session messages for export:', error);
            return [];
        }
    }

    async function loadSession(sessionId: string) {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，先保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                const selectedResponse = multiModelResponses[firstSuccessIndex];
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: selectedResponse.content || '',
                    thinking: selectedResponse.thinking,
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex,
                        modelName:
                            i === firstSuccessIndex
                                ? '✅' + response.modelName
                                : response.modelName,
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        if (hasUnsavedChanges) {
            confirm(
                t('aiSidebar.confirm.switchSession.title'),
                t('aiSidebar.confirm.switchSession.message'),
                async () => {
                    await saveCurrentSession();
                    await doLoadSession(sessionId);
                },
                async () => {
                    await doLoadSession(sessionId);
                }
            );
        } else {
            await doLoadSession(sessionId);
        }
    }

    async function doLoadSession(sessionId: string) {
        const sessionMetadata = sessions.find(s => s.id === sessionId);
        if (sessionMetadata) {
            try {
                // 加载完整内容 (使用 getFileBlob 因为 saveData 路径不一致，或者由于前缀问题)
                // 或者继续使用 loadData 但它是相对的。
                // 如果我们用 putFile 存了，我们也应该用对应的 read 方式。
                const path = `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`;
                const blob = await getFileBlob(path);
                if (!blob) throw new Error('File not found');
                const text = await blob.text();
                const sessionData = JSON.parse(text);
                const loadedMessages = sessionData?.messages || [];
                let sessionModified = false; // 标记会话是否被修改（需要重新保存）

                // 还原图片数据 (从 path 还原为 blob url) 和文本附件数据
                // 同时处理旧的 base64 格式图片，自动保存到 assets
                for (const msg of loadedMessages) {
                    // 处理 content 中的 Markdown 格式 base64 图片
                    if (typeof msg.content === 'string' && msg.content.includes('data:image')) {
                        const base64ImageRegex =
                            /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
                        let match;
                        const imagesToProcess: Array<{
                            fullMatch: string;
                            altText: string;
                            dataUrl: string;
                        }> = [];

                        // 收集所有需要处理的图片
                        while ((match = base64ImageRegex.exec(msg.content)) !== null) {
                            imagesToProcess.push({
                                fullMatch: match[0],
                                altText: match[1] || 'image',
                                dataUrl: match[2],
                            });
                        }

                        // 处理每个图片
                        if (imagesToProcess.length > 0) {
                            let newContent = msg.content;

                            for (const imageInfo of imagesToProcess) {
                                try {
                                    // 解析 data URL
                                    const matches = imageInfo.dataUrl.match(
                                        /^data:([^;]+);base64,(.+)$/
                                    );
                                    if (!matches) continue;

                                    const mimeType = matches[1];
                                    const base64Data = matches[2];

                                    // 保存到 assets
                                    const blob = base64ToBlob(base64Data, mimeType);
                                    const ext = mimeType.split('/')[1] || 'png';
                                    const assetPath = await saveAsset(
                                        blob,
                                        `image-${Date.now()}.${ext}`
                                    );

                                    // 替换为 assets 路径，保持 Markdown 格式
                                    newContent = newContent.replace(
                                        imageInfo.fullMatch,
                                        `![${imageInfo.altText}](${assetPath})`
                                    );

                                    sessionModified = true;
                                    console.log(
                                        `Migrated content base64 image to assets: ${assetPath}`
                                    );
                                } catch (error) {
                                    console.error('Failed to migrate content base64 image:', error);
                                }
                            }

                            // 更新消息内容
                            if (sessionModified) {
                                msg.content = newContent;
                            }
                        }
                    }

                    if (msg.attachments) {
                        for (const att of msg.attachments) {
                            if (att.type === 'image') {
                                if (att.path) {
                                    // 从路径加载图片
                                    att.data = (await loadAsset(att.path)) || '';
                                } else if (
                                    att.data &&
                                    (att.data.startsWith('data:image') || att.data.length > 1000)
                                ) {
                                    // 旧格式：有 base64 数据但没有 path，自动迁移到 assets
                                    try {
                                        let base64Data = att.data;
                                        let mimeType = att.mimeType || 'image/png';

                                        // 如果是 data URL，提取 mime type 和数据
                                        if (base64Data.startsWith('data:')) {
                                            const matches = base64Data.match(
                                                /^data:([^;]+);base64,(.+)$/
                                            );
                                            if (matches) {
                                                mimeType = matches[1];
                                                base64Data = matches[2];
                                            }
                                        }

                                        const blob = base64ToBlob(base64Data, mimeType);
                                        const ext = mimeType.split('/')[1] || 'png';
                                        const name = att.name || `image-${Date.now()}.${ext}`;
                                        const assetPath = await saveAsset(blob, name);

                                        // 更新附件信息
                                        att.path = assetPath;
                                        att.data = URL.createObjectURL(blob); // 设置为 blob URL
                                        att.mimeType = mimeType;

                                        sessionModified = true;
                                        console.log(
                                            `Migrated attachment base64 image to assets: ${assetPath}`
                                        );
                                    } catch (error) {
                                        console.error(
                                            'Failed to migrate attachment base64 image:',
                                            error
                                        );
                                    }
                                }
                            } else if (att.path) {
                                // 还原文本附件内容
                                att.data = (await readAssetAsText(att.path)) || '';
                            }
                        }
                    }

                    if (msg.generatedImages) {
                        for (const img of msg.generatedImages) {
                            if (img.path) {
                                // 从路径加载图片
                                img.previewUrl = (await loadAsset(img.path)) || '';
                            } else if (img.data && img.data.length > 0) {
                                // 旧格式：有 base64 数据但没有 path，自动迁移到 assets
                                try {
                                    const blob = base64ToBlob(
                                        img.data,
                                        img.mimeType || 'image/png'
                                    );
                                    const ext =
                                        (img.mimeType || 'image/png').split('/')[1] || 'png';
                                    const name = `generated-image-${Date.now()}.${ext}`;
                                    const assetPath = await saveAsset(blob, name);

                                    // 更新图片信息
                                    img.path = assetPath;
                                    img.data = ''; // 清空 base64 数据
                                    img.previewUrl = URL.createObjectURL(blob);

                                    // 同时更新 attachments（如果存在）
                                    if (msg.attachments) {
                                        const attIndex = msg.attachments.findIndex(
                                            a => a.type === 'image' && !a.path
                                        );
                                        if (attIndex !== -1) {
                                            msg.attachments[attIndex].path = assetPath;
                                            msg.attachments[attIndex].data =
                                                URL.createObjectURL(blob);
                                        }
                                    }

                                    sessionModified = true;
                                    console.log(`Migrated generated image to assets: ${assetPath}`);
                                } catch (error) {
                                    console.error('Failed to migrate generated image:', error);
                                }
                            }
                        }
                    }
                }

                messages = [...loadedMessages];
                const filePathResolved = await ensureMessagesEditOperationFilePaths(messages);
                if (filePathResolved) {
                    messages = [...messages];
                    sessionModified = true;
                }

                // 【修复】检查多模型响应是否缺少选择，自动设置第一个非错误模型为选中
                for (const msg of messages) {
                    if (
                        msg.role === 'assistant' &&
                        msg.multiModelResponses &&
                        msg.multiModelResponses.length > 0
                    ) {
                        const hasSelected = msg.multiModelResponses.some(r => r.isSelected);
                        if (!hasSelected) {
                            // 找到第一个没有错误的响应
                            const firstSuccessIndex = msg.multiModelResponses.findIndex(
                                r => !r.error && r.content
                            );
                            if (firstSuccessIndex !== -1) {
                                // 设置第一个成功的模型为选中
                                msg.multiModelResponses.forEach((response, i) => {
                                    response.isSelected = i === firstSuccessIndex;
                                    if (i === firstSuccessIndex) {
                                        // 更新主 content 为选中的内容
                                        msg.content = response.content || '';
                                        msg.thinking = response.thinking || '';
                                        // 添加 ✅ 标记（如果还没有）
                                        if (!response.modelName.startsWith('✅')) {
                                            response.modelName = '✅' + response.modelName;
                                        }
                                    }
                                });
                                sessionModified = true;
                                console.log(
                                    `Auto-selected first successful model (index ${firstSuccessIndex}) for message`
                                );
                            }
                        }
                    }
                }

                // 清空全局上下文文档（上下文现在存储在各个消息中）
                contextDocuments = [];
                // 确保系统提示词存在且是最新的
                if (settings.aiSystemPrompt) {
                    const systemMsgIndex = messages.findIndex(m => m.role === 'system');
                    if (systemMsgIndex >= 0) {
                        messages[systemMsgIndex].content = settings.aiSystemPrompt;
                    } else {
                        messages.unshift({ role: 'system', content: settings.aiSystemPrompt });
                    }
                }
                currentSessionId = sessionId;
                hasUnsavedChanges = false;

                // 如果会话被修改（迁移了 base64 图片或自动选择了模型），自动保存
                if (sessionModified) {
                    console.log('Session was modified during load, saving...');
                    await saveCurrentSession(true); // 静默保存
                }

                // 清除多模型状态
                multiModelResponses = [];
                isWaitingForAnswerSelection = false;
                selectedAnswerIndex = null;
                selectedTabIndex = 0;

                // 切换到历史会话时默认显示最开头（最早消息）而不是底部
                await scrollToTop();
            } catch (e) {
                console.error('Failed to load session content:', e);
                pushErrMsg('加载会话失败');
            }
        }
    }

    async function newSession() {
        // 如果消息正在生成，先中断
        if (isLoading && abortController) {
            abortMessage();
        }

        // 如果有未选择的多模型响应，保存它们
        if (isWaitingForAnswerSelection && multiModelResponses.length > 0) {
            // 找到第一个成功的响应作为默认选择（如果所有都失败则不保存）
            const firstSuccessIndex = multiModelResponses.findIndex(r => !r.error && !r.isLoading);

            if (firstSuccessIndex !== -1) {
                // 创建assistant消息，保存所有多模型响应
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: '', // 不显示单独的内容
                    multiModelResponses: multiModelResponses.map((response, i) => ({
                        ...response,
                        isSelected: i === firstSuccessIndex, // 标记第一个成功的为默认选择
                        modelName:
                            i === firstSuccessIndex
                                ? '✅' + response.modelName
                                : response.modelName,
                    })),
                };

                messages = [...messages, assistantMessage];
                hasUnsavedChanges = true;
            }
        }

        // 如果有未保存的更改，自动保存当前会话
        if (hasUnsavedChanges && messages.filter(m => m.role !== 'system').length > 0) {
            await saveCurrentSession();
        }
        doNewSession();
    }

    function doNewSession() {
        messages = settings.aiSystemPrompt
            ? [{ role: 'system', content: settings.aiSystemPrompt }]
            : [];
        contextDocuments = [];
        currentSessionId = '';
        hasUnsavedChanges = false;

        // 清除多模型状态
        multiModelResponses = [];
        isWaitingForAnswerSelection = false;
        selectedAnswerIndex = null;
        selectedTabIndex = 0;
    }

    async function deleteSession(sessionId: string) {
        confirm(
            t('aiSidebar.confirm.deleteSession.title'),
            t('aiSidebar.confirm.deleteSession.message'),
            async () => {
                // 【修复】删除前重新加载最新的会话列表，避免多页签覆盖问题
                await loadSessions();
                sessions = sessions.filter(s => s.id !== sessionId);
                await saveSessions();

                // 删除独立会话文件 (SiYuan removeFile 路径相对于 workspace root)
                try {
                    await removeFile(
                        `/data/storage/petal/siyuan-plugin-copilot/sessions/${sessionId}.json`
                    );
                } catch (e) {
                    // 忽略错误
                }

                if (currentSessionId === sessionId) {
                    doNewSession();
                }
            }
        );
    }

    // 批量删除会话
    async function batchDeleteSessions(sessionIds: string[]) {
        if (!sessionIds || sessionIds.length === 0) {
            return;
        }

        const count = sessionIds.length;
        confirm(
            '批量删除会话',
            `确定要删除选中的 ${count} 个会话吗？此操作不可恢复。`,
            async () => {
                // 【修复】删除前重新加载最新的会话列表，避免多页签覆盖问题
                await loadSessions();

                // 过滤掉要删除的会话
                sessions = sessions.filter(s => !sessionIds.includes(s.id));
                await saveSessions();

                // 批量删除独立会话文件
                for (const id of sessionIds) {
                    try {
                        await removeFile(
                            `/data/storage/petal/siyuan-plugin-copilot/sessions/${id}.json`
                        );
                    } catch (e) {
                        // 忽略错误
                    }
                }

                // 如果当前会话被删除，创建新会话
                if (sessionIds.includes(currentSessionId)) {
                    doNewSession();
                }

                pushMsg(`成功删除 ${count} 个会话`);
            }
        );
    }

    // 处理会话更新（如钉住状态变化）
    async function handleSessionUpdate(updatedSessions: ChatSession[]) {
        // 【修复】更新前重新加载最新的会话列表，避免多页签覆盖问题
        await loadSessions();

        // 找到被更新的会话，只更新这些会话的数据
        for (const updatedSession of updatedSessions) {
            const index = sessions.findIndex(s => s.id === updatedSession.id);
            if (index >= 0) {
                // 只更新会话的属性，保留其他实例可能修改的 messages
                sessions[index] = {
                    ...sessions[index],
                    ...updatedSession,
                };
            }
        }

        await saveSessions();
    }

    // 打开插件设置
    function openSettings() {
        plugin.openSetting();
    }

    // 切换在新窗口打开菜单
    function toggleOpenWindowMenu(event: MouseEvent) {
        event.stopPropagation();
        showOpenWindowMenu = !showOpenWindowMenu;
    }

    // 在页签打开
    function openInTab() {
        plugin.openAITab();
        showOpenWindowMenu = false;
    }

    // 在新窗口打开
    function openInNewWindow() {
        plugin.openAIWindow();
        showOpenWindowMenu = false;
    }

    // 工具配置管理
    async function loadToolsConfig() {
        try {
            const data = await plugin.loadData('agent-tools-config.json');
            if (data?.selectedTools && Array.isArray(data.selectedTools)) {
                selectedTools = data.selectedTools;
            } else {
                selectedTools = [];
            }
        } catch (error) {
            console.error('[ToolConfig] Load error:', error);
            selectedTools = [];
        } finally {
            // 标记配置已加载完成，此后才允许自动保存
            isToolConfigLoaded = true;
        }
    }

    async function saveToolsConfig() {
        // 只在配置加载完成后才保存，避免初始化时覆盖已保存的配置
        if (!isToolConfigLoaded) {
            return;
        }
        try {
            await plugin.saveData('agent-tools-config.json', { selectedTools });
        } catch (error) {
            console.error('[ToolConfig] Save error:', error);
        }
    }

    // 监听工具选择变化，自动保存
    $: {
        // 只在配置加载完成后，且确实有变化时才保存
        if (isToolConfigLoaded && selectedTools) {
            // 使用 tick 确保在下一个事件循环保存，避免频繁保存
            tick().then(() => {
                saveToolsConfig();
            });
        }
    }

    // 获取工具的显示名称
    function getToolDisplayName(toolName: string): string {
        const key = `tools.${toolName}.name`;
        const name = t(key);
        return name === key ? toolName : name;
    }

    function getToolCallNameSummary(
        toolCalls: Array<ToolCall> | undefined,
        maxNames = 3
    ): string {
        if (!toolCalls || toolCalls.length === 0) return '';
        const names = toolCalls
            .map(call => getToolDisplayName(call?.function?.name || 'tool'))
            .filter(Boolean);
        const uniqueNames = Array.from(new Set(names));
        if (uniqueNames.length === 0) return '';
        const head = uniqueNames.slice(0, maxNames).join('、');
        return uniqueNames.length > maxNames ? `${head}...` : head;
    }

    function getCodexTraceNameSummary(
        traceCalls: Array<CodexTraceCall> | undefined,
        maxNames = 3
    ): string {
        if (!traceCalls || traceCalls.length === 0) return '';
        const names = traceCalls.map(item => String(item?.name || '').trim()).filter(Boolean);
        const uniqueNames = Array.from(new Set(names));
        if (uniqueNames.length === 0) return '';
        const head = uniqueNames.slice(0, maxNames).join('、');
        return uniqueNames.length > maxNames ? `${head}...` : head;
    }

    // 批准工具调用
    function approveToolCall() {
        if ((window as any).__toolApprovalResolve) {
            (window as any).__toolApprovalResolve(true);
            delete (window as any).__toolApprovalResolve;
        }
        isToolApprovalDialogOpen = false;
        pendingToolCall = null;
    }

    // 拒绝工具调用
    function rejectToolCall() {
        if ((window as any).__toolApprovalResolve) {
            (window as any).__toolApprovalResolve(false);
            delete (window as any).__toolApprovalResolve;
        }
        isToolApprovalDialogOpen = false;
        pendingToolCall = null;
    }

    // 点击外部关闭提示词选择器
    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;

        // 关闭右键菜单
        if (contextMenuVisible && !target.closest('.ai-sidebar__context-menu')) {
            closeContextMenu();
        }

        // 关闭打开窗口菜单
        if (showOpenWindowMenu && !target.closest('.ai-sidebar__open-window-menu-container')) {
            showOpenWindowMenu = false;
        }

        // 关闭图片查看器
        if (isImageViewerOpen && !target.closest('.image-viewer')) {
            // 确保不是点击了触发开启图片的元素
            if (
                !target.closest('.ai-message__content img') &&
                !target.closest('.ai-message__thinking-content img') &&
                !target.closest('.ai-message__attachment-image')
            ) {
                closeImageViewer();
            }
        }
    }

    // 编辑模式相关函数
    // 解析AI返回的编辑操作（JSON格式）
    function parseEditOperations(content: string): EditOperation[] {
        const operations: EditOperation[] = [];

        try {
            // 尝试匹配JSON代码块: ```json\n{...}\n```
            const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/gi;
            let match = jsonBlockRegex.exec(content);

            if (match) {
                const jsonStr = match[1].trim();
                const data = JSON.parse(jsonStr);

                if (data.editOperations && Array.isArray(data.editOperations)) {
                    for (const op of data.editOperations) {
                        if (op.blockId && op.newContent !== undefined) {
                            operations.push({
                                operationType: op.operationType || 'update', // 默认为update
                                blockId: op.blockId,
                                filePath: normalizeEditOperationFilePath(
                                    op.filePath || op.path || op.file || ''
                                ),
                                newContent: op.newContent,
                                oldContent: undefined, // 稍后获取
                                status: 'pending',
                                position: op.position || 'after', // 默认在后面插入
                            });
                        }
                    }
                }
            } else {
                // 尝试直接解析JSON（不在代码块中）
                const data = JSON.parse(content);
                if (data.editOperations && Array.isArray(data.editOperations)) {
                    for (const op of data.editOperations) {
                        if (op.blockId && op.newContent !== undefined) {
                            operations.push({
                                operationType: op.operationType || 'update', // 默认为update
                                blockId: op.blockId,
                                filePath: normalizeEditOperationFilePath(
                                    op.filePath || op.path || op.file || ''
                                ),
                                newContent: op.newContent,
                                oldContent: undefined,
                                status: 'pending',
                                position: op.position || 'after', // 默认在后面插入
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('解析编辑操作失败:', error);
        }

        return operations;
    }

    // 应用编辑操作
    async function applyEditOperation(operation: EditOperation, messageIndex: number) {
        try {
            const operationType = operation.operationType || 'update';

            if (operationType === 'insert') {
                // 插入新块
                const position = operation.position || 'after';

                // 根据位置确定参数
                let nextID: string | null;
                let previousID: string | null;

                if (position === 'before') {
                    // 在指定块之前插入
                    nextID = operation.blockId;
                } else {
                    // 在指定块之后插入（默认）
                    previousID = operation.blockId;
                }
                let lute = window.Lute.New();
                let newBlockDom = lute.Md2BlockDOM(operation.newContent);
                let newBlockId = newBlockDom.match(/data-node-id="([^"]*)"/)[1];

                // 创建可撤回的事务
                if (newBlockId) {
                    try {
                        const currentProtyle = getProtyle();
                        if (currentProtyle) {
                            // 获取父块ID
                            const block = await getBlockByID(operation.blockId);
                            const parentID = block?.root_id || currentProtyle.block.id;
                            const doOperations = [];
                            if (nextID) {
                                doOperations.push({
                                    action: 'insert',
                                    id: newBlockId,
                                    data: newBlockDom,
                                    parentID: parentID,
                                    nextID: nextID,
                                });
                            } else {
                                doOperations.push({
                                    action: 'insert',
                                    id: newBlockId,
                                    data: newBlockDom,
                                    parentID: parentID,
                                    previousID: previousID,
                                });
                            }

                            const undoOperations = [
                                {
                                    action: 'delete',
                                    id: newBlockId,
                                    data: null,
                                },
                            ];

                            // 执行事务以支持撤回
                            currentProtyle.getInstance().transaction(doOperations, undoOperations);
                            setTimeout(() => {
                                currentProtyle.getInstance()?.reload(false);
                            }, 500);
                        }
                    } catch (transactionError) {
                        console.warn('创建撤回事务失败，但块已插入:', transactionError);
                    }
                }

                // 更新操作状态
                const message = messages[messageIndex];
                if (message.editOperations) {
                    const op = message.editOperations.find(
                        o =>
                            o.blockId === operation.blockId && o.newContent === operation.newContent
                    );
                    if (op) {
                        op.status = 'applied';
                    }
                }
                messages = [...messages];
                hasUnsavedChanges = true;

                pushMsg(t('aiSidebar.success.insertBlockSuccess'));
            } else {
                // 更新现有块
                // 获取当前块内容
                const blockData = await getBlockKramdown(operation.blockId);
                if (!blockData || !blockData.kramdown) {
                    pushErrMsg(t('aiSidebar.errors.getBlockFailed'));
                    return;
                }

                // 保存旧内容用于显示（如果还没有保存）
                if (!operation.oldContent) {
                    operation.oldContent = blockData.kramdown;
                }

                // 保存旧的DOM用于撤回操作
                const oldBlockDomRes = await getBlockDOM(operation.blockId);

                // 使用 updateBlock API 更新块内容
                await updateBlock('markdown', operation.newContent, operation.blockId);
                await refreshSql();
                // 获取当前编辑器实例并创建可撤回的事务
                try {
                    const currentProtyle = getProtyle();
                    if (currentProtyle) {
                        await refreshSql();
                        const oldBlockDom = oldBlockDomRes?.dom;
                        const newBlockDomRes = await getBlockDOM(operation.blockId);
                        const newBlockDom = newBlockDomRes?.dom;
                        currentProtyle
                            .getInstance()
                            .updateTransaction(operation.blockId, newBlockDom, oldBlockDom);
                    }
                } catch (transactionError) {
                    console.warn('创建撤回事务失败，但块内容已更新:', transactionError);
                }

                // 更新操作状态
                const message = messages[messageIndex];
                if (message.editOperations) {
                    const op = message.editOperations.find(o => o.blockId === operation.blockId);
                    if (op) {
                        op.status = 'applied';
                    }
                }
                messages = [...messages];
                hasUnsavedChanges = true;

                pushMsg(t('aiSidebar.success.applyEditSuccess'));
            }
        } catch (error) {
            console.error('应用编辑失败:', error);
            pushErrMsg(t('aiSidebar.errors.applyEditFailed'));
        }
    }

    // 拒绝编辑操作
    function rejectEditOperation(operation: EditOperation, messageIndex: number) {
        const message = messages[messageIndex];
        if (message.editOperations) {
            const op = message.editOperations.find(o => o.blockId === operation.blockId);
            if (op) {
                op.status = 'rejected';
            }
        }
        messages = [...messages];
        hasUnsavedChanges = true;
        pushMsg(t('aiSidebar.success.rejectEditSuccess'));
    }

    // 查看差异
    async function viewDiff(operation: EditOperation) {
        await ensureEditOperationFilePath(operation);
        const operationType = operation.operationType || 'update';

        if (operationType === 'insert') {
            // 插入操作：旧内容为空，新内容为要插入的内容
            const newMdContent =
                operation.newContentForDisplay ||
                operation.newContent.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();

            currentDiffOperation = {
                ...operation,
                oldContent: '', // 插入操作没有旧内容
                newContent: operation.newContentForDisplay || newMdContent,
            };
        } else {
            // 更新操作
            // 使用保存的Markdown格式内容来显示差异
            // 这样可以看到真正的修改前内容，即使块已经被修改了
            const oldMdContent = operation.oldContentForDisplay || operation.oldContent || '';
            const newMdContent =
                operation.newContentForDisplay ||
                operation.newContent.replace(/\{:\s*id="[^"]+"\s*\}/g, '').trim();

            // 如果没有保存的显示内容（兼容旧数据），尝试实时获取
            if (!operation.oldContentForDisplay) {
                try {
                    const oldMdData = await exportMdContent(
                        operation.blockId,
                        false,
                        false,
                        2,
                        0,
                        false
                    );
                    if (oldMdData?.content) {
                        operation.oldContentForDisplay = oldMdData.content;
                    }
                } catch (error) {
                    console.error('获取块内容失败:', error);
                }
            }

            // 创建用于显示的临时operation对象
            currentDiffOperation = {
                ...operation,
                oldContent: operation.oldContentForDisplay || oldMdContent,
                newContent: operation.newContentForDisplay || newMdContent,
            };
        }

        resetDiffDialogViewState();
        isDiffDialogOpen = true;
        await tick();
        diffDialogCloseButton?.focus();
        if (currentDiffOperation) {
            void loadDiffDialogPreferredLines(currentDiffOperation);
        }
    }

    // 关闭差异对话框
    function closeDiffDialog() {
        isDiffDialogOpen = false;
        currentDiffOperation = null;
        diffDialogLoadToken += 1;
        diffDialogLines = [];
        diffDialogEngine = 'lcs';
        isDiffDialogLinesLoading = false;
        diffDialogGitError = '';
        diffDialogUnifiedPatch = '';
        resetDiffDialogViewState();
        tick().then(() => textareaElement?.focus());
    }

    const DIFF_DIALOG_RENDER_LIMIT_INITIAL = 800;
    const DIFF_DIALOG_RENDER_LIMIT_STEP = 600;
    const DIFF_DIALOG_FOLD_CONTEXT_LINES = 3;
    const DIFF_DIALOG_FOLD_THRESHOLD = 12;

    type DiffDialogNumberedLine = GitDiffLine & {
        oldNo: number | null;
        newNo: number | null;
    };

    type DiffDialogLineToken = {
        kind: 'line';
        type: GitDiffLine['type'];
        line: string;
        oldNo: number | null;
        newNo: number | null;
    };

    type DiffDialogFoldToken = {
        kind: 'fold';
        id: string;
        startIndex: number;
        endIndex: number;
        hiddenCount: number;
        oldStartNo: number | null;
        newStartNo: number | null;
        oldEndNo: number | null;
        newEndNo: number | null;
    };

    type DiffDialogToken = DiffDialogLineToken | DiffDialogFoldToken;

    type DiffDialogSplitRow =
        | {
              kind: 'fold';
              id: string;
              hiddenCount: number;
              oldStartNo: number | null;
              newStartNo: number | null;
              oldEndNo: number | null;
              newEndNo: number | null;
          }
        | {
              kind: 'line';
              leftLine: string;
              rightLine: string;
              leftType: 'removed' | 'unchanged' | 'empty';
              rightType: 'added' | 'unchanged' | 'empty';
              leftNo: number | null;
              rightNo: number | null;
          };

    let diffDialogNumberedLines: DiffDialogNumberedLine[] = [];
    let diffDialogTokens: DiffDialogToken[] = [];
    let diffDialogVisibleTokens: DiffDialogToken[] = [];
    let diffDialogHasMoreTokens = false;
    let diffDialogSplitRows: DiffDialogSplitRow[] = [];
    let diffDialogVisibleSplitRows: DiffDialogSplitRow[] = [];
    let diffDialogHasMoreSplitRows = false;

    function resetDiffDialogViewState() {
        diffDialogViewMode = 'split';
        diffDialogWrapEnabled = false;
        diffDialogRenderLimit = DIFF_DIALOG_RENDER_LIMIT_INITIAL;
        diffDialogExpandedFoldIds = new Set<string>();
    }

    function loadMoreDiffDialogLines() {
        diffDialogRenderLimit += DIFF_DIALOG_RENDER_LIMIT_STEP;
    }

    function expandDiffDialogFold(id: string) {
        const next = new Set(diffDialogExpandedFoldIds);
        next.add(id);
        diffDialogExpandedFoldIds = next;
    }

    function formatDiffDialogCollapsedLines(hiddenCount: number): string {
        const template = t('aiSidebar.diff.collapsedLines') || '… {count} lines collapsed';
        return String(template).replace(/\{count\}|\$\{count\}/g, String(hiddenCount));
    }

    function buildSequentialNumberedDiffLines(
        lines: GitDiffLine[] | null | undefined,
        isInsertOperation: boolean
    ): DiffDialogNumberedLine[] {
        const source = Array.isArray(lines) ? lines : [];
        const out: DiffDialogNumberedLine[] = [];
        let oldNo = 1;
        let newNo = 1;

        for (const item of source) {
            if (item.type === 'removed') {
                out.push({
                    type: 'removed',
                    line: item.line,
                    oldNo: isInsertOperation ? null : oldNo,
                    newNo: null,
                });
                if (!isInsertOperation) oldNo += 1;
                continue;
            }

            if (item.type === 'added') {
                out.push({ type: 'added', line: item.line, oldNo: null, newNo });
                newNo += 1;
                continue;
            }

            out.push({
                type: 'unchanged',
                line: item.line,
                oldNo: isInsertOperation ? null : oldNo,
                newNo,
            });
            if (!isInsertOperation) oldNo += 1;
            newNo += 1;
        }

        return out;
    }

    function parseGitUnifiedDiffToNumberedLines(unifiedDiff: string): DiffDialogNumberedLine[] {
        const out: DiffDialogNumberedLine[] = [];
        const lines = String(unifiedDiff || '').split(/\r?\n/);

        let oldNo = 0;
        let newNo = 0;
        let inHunk = false;

        for (const rawLine of lines) {
            if (!rawLine) continue;

            if (rawLine.startsWith('@@')) {
                const match = rawLine.match(
                    /^@@\s+\-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/
                );
                if (match) {
                    oldNo = Number(match[1]);
                    newNo = Number(match[2]);
                    inHunk = true;
                }
                continue;
            }

            if (!inHunk) continue;

            const marker = rawLine[0];
            if (marker === ' ') {
                out.push({ type: 'unchanged', line: rawLine.slice(1), oldNo, newNo });
                oldNo += 1;
                newNo += 1;
                continue;
            }
            if (marker === '-') {
                out.push({ type: 'removed', line: rawLine.slice(1), oldNo, newNo: null });
                oldNo += 1;
                continue;
            }
            if (marker === '+') {
                out.push({ type: 'added', line: rawLine.slice(1), oldNo: null, newNo });
                newNo += 1;
            }
        }

        return out;
    }

    function buildDiffDialogTokens(
        numberedLines: DiffDialogNumberedLine[],
        expandedFoldIds: Set<string>
    ): DiffDialogToken[] {
        const out: DiffDialogToken[] = [];
        if (!Array.isArray(numberedLines) || numberedLines.length === 0) return out;
        if (expandedFoldIds.has('__all__')) {
            for (const item of numberedLines) {
                out.push({
                    kind: 'line',
                    type: item.type,
                    line: item.line,
                    oldNo: item.oldNo,
                    newNo: item.newNo,
                });
            }
            return out;
        }

        const context = DIFF_DIALOG_FOLD_CONTEXT_LINES;
        const threshold = DIFF_DIALOG_FOLD_THRESHOLD;
        const expandAll = expandedFoldIds.has('__all__');

        let i = 0;
        while (i < numberedLines.length) {
            const line = numberedLines[i];
            if (line.type !== 'unchanged') {
                out.push({
                    kind: 'line',
                    type: line.type,
                    line: line.line,
                    oldNo: line.oldNo,
                    newNo: line.newNo,
                });
                i += 1;
                continue;
            }

            let j = i;
            while (j < numberedLines.length && numberedLines[j].type === 'unchanged') {
                j += 1;
            }
            const runStart = i;
            const runEnd = j - 1;
            const runLen = j - i;

            if (runLen <= threshold) {
                for (let k = runStart; k <= runEnd; k += 1) {
                    const item = numberedLines[k];
                    out.push({
                        kind: 'line',
                        type: item.type,
                        line: item.line,
                        oldNo: item.oldNo,
                        newNo: item.newNo,
                    });
                }
                i = j;
                continue;
            }

            const prefixCount = Math.min(context, runLen);
            const suffixCount = Math.min(context, Math.max(0, runLen - prefixCount));
            const hiddenStart = runStart + prefixCount;
            const hiddenEnd = runEnd - suffixCount;

            if (hiddenStart > hiddenEnd) {
                for (let k = runStart; k <= runEnd; k += 1) {
                    const item = numberedLines[k];
                    out.push({
                        kind: 'line',
                        type: item.type,
                        line: item.line,
                        oldNo: item.oldNo,
                        newNo: item.newNo,
                    });
                }
                i = j;
                continue;
            }

            const foldId = `fold-${hiddenStart}-${hiddenEnd}`;
            if (expandAll || expandedFoldIds.has(foldId)) {
                for (let k = runStart; k <= runEnd; k += 1) {
                    const item = numberedLines[k];
                    out.push({
                        kind: 'line',
                        type: item.type,
                        line: item.line,
                        oldNo: item.oldNo,
                        newNo: item.newNo,
                    });
                }
                i = j;
                continue;
            }

            for (let k = runStart; k < hiddenStart; k += 1) {
                const item = numberedLines[k];
                out.push({
                    kind: 'line',
                    type: item.type,
                    line: item.line,
                    oldNo: item.oldNo,
                    newNo: item.newNo,
                });
            }

            const firstHidden = numberedLines[hiddenStart];
            const lastHidden = numberedLines[hiddenEnd];
            out.push({
                kind: 'fold',
                id: foldId,
                startIndex: hiddenStart,
                endIndex: hiddenEnd,
                hiddenCount: hiddenEnd - hiddenStart + 1,
                oldStartNo: firstHidden?.oldNo ?? null,
                newStartNo: firstHidden?.newNo ?? null,
                oldEndNo: lastHidden?.oldNo ?? null,
                newEndNo: lastHidden?.newNo ?? null,
            });

            for (let k = hiddenEnd + 1; k <= runEnd; k += 1) {
                const item = numberedLines[k];
                out.push({
                    kind: 'line',
                    type: item.type,
                    line: item.line,
                    oldNo: item.oldNo,
                    newNo: item.newNo,
                });
            }

            i = j;
        }

        return out;
    }

    function buildSplitRowsFromDiffDialogTokens(tokens: DiffDialogToken[]): DiffDialogSplitRow[] {
        const rows: DiffDialogSplitRow[] = [];
        const source = Array.isArray(tokens) ? tokens : [];
        for (let i = 0; i < source.length; i += 1) {
            const token = source[i];
            if (!token) continue;

            if (token.kind === 'fold') {
                rows.push({
                    kind: 'fold',
                    id: token.id,
                    hiddenCount: token.hiddenCount,
                    oldStartNo: token.oldStartNo,
                    newStartNo: token.newStartNo,
                    oldEndNo: token.oldEndNo,
                    newEndNo: token.newEndNo,
                });
                continue;
            }

            if (token.type === 'unchanged') {
                rows.push({
                    kind: 'line',
                    leftLine: token.line,
                    rightLine: token.line,
                    leftType: 'unchanged',
                    rightType: 'unchanged',
                    leftNo: token.oldNo,
                    rightNo: token.newNo,
                });
                continue;
            }

            if (token.type === 'removed') {
                const next = source[i + 1];
                if (next && next.kind === 'line' && next.type === 'added') {
                    rows.push({
                        kind: 'line',
                        leftLine: token.line,
                        rightLine: next.line,
                        leftType: 'removed',
                        rightType: 'added',
                        leftNo: token.oldNo,
                        rightNo: next.newNo,
                    });
                    i += 1;
                    continue;
                }

                rows.push({
                    kind: 'line',
                    leftLine: token.line,
                    rightLine: '',
                    leftType: 'removed',
                    rightType: 'empty',
                    leftNo: token.oldNo,
                    rightNo: null,
                });
                continue;
            }

            rows.push({
                kind: 'line',
                leftLine: '',
                rightLine: token.line,
                leftType: 'empty',
                rightType: 'added',
                leftNo: null,
                rightNo: token.newNo,
            });
        }

        return rows;
    }

    $: {
        const isInsertOperation = currentDiffOperation?.operationType === 'insert';
        if (diffDialogEngine === 'git' && diffDialogUnifiedPatch) {
            diffDialogNumberedLines = parseGitUnifiedDiffToNumberedLines(diffDialogUnifiedPatch);
        } else {
            diffDialogNumberedLines = buildSequentialNumberedDiffLines(
                diffDialogLines,
                Boolean(isInsertOperation)
            );
        }
    }

    $: diffDialogTokens = buildDiffDialogTokens(diffDialogNumberedLines, diffDialogExpandedFoldIds);

    $: {
        diffDialogVisibleTokens = diffDialogTokens.slice(0, diffDialogRenderLimit);
        diffDialogHasMoreTokens = diffDialogTokens.length > diffDialogRenderLimit;
    }

    $: diffDialogSplitRows = buildSplitRowsFromDiffDialogTokens(diffDialogTokens);

    $: {
        diffDialogVisibleSplitRows = diffDialogSplitRows.slice(0, diffDialogRenderLimit);
        diffDialogHasMoreSplitRows = diffDialogSplitRows.length > diffDialogRenderLimit;
    }

    function getDiffLineStatsFromLines(lines: GitDiffLine[] | null | undefined): {
        added: number;
        removed: number;
    } {
        const source = Array.isArray(lines) ? lines : [];
        let added = 0;
        let removed = 0;
        for (const line of source) {
            if (line.type === 'added') added += 1;
            if (line.type === 'removed') removed += 1;
        }
        return { added, removed };
    }

    // 简单的差异高亮（按行对比）
    function generateSimpleDiff(
        oldText: string,
        newText: string
    ): { type: 'removed' | 'added' | 'unchanged'; line: string }[] {
        const oldLines = String(oldText || '').split('\n');
        const newLines = String(newText || '').split('\n');
        const result: { type: 'removed' | 'added' | 'unchanged'; line: string }[] = [];

        // LCS 行级对比，效果更接近 git diff
        const oldLen = oldLines.length;
        const newLen = newLines.length;
        const maxLcsCells = 2_000_000;
        if (oldLen * newLen > maxLcsCells) {
            if (String(oldText || '') === String(newText || '')) {
                for (const line of oldLines) {
                    result.push({ type: 'unchanged', line });
                }
                return result;
            }
            for (const line of oldLines) {
                result.push({ type: 'removed', line });
            }
            result.push({ type: 'unchanged', line: '...' });
            for (const line of newLines) {
                result.push({ type: 'added', line });
            }
            return result;
        }
        const lcs: number[][] = Array.from({ length: oldLen + 1 }, () =>
            new Array<number>(newLen + 1).fill(0)
        );

        for (let i = oldLen - 1; i >= 0; i -= 1) {
            for (let j = newLen - 1; j >= 0; j -= 1) {
                if (oldLines[i] === newLines[j]) {
                    lcs[i][j] = lcs[i + 1][j + 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
                }
            }
        }

        let i = 0;
        let j = 0;
        while (i < oldLen && j < newLen) {
            if (oldLines[i] === newLines[j]) {
                result.push({ type: 'unchanged', line: oldLines[i] });
                i += 1;
                j += 1;
                continue;
            }
            if (lcs[i + 1][j] >= lcs[i][j + 1]) {
                result.push({ type: 'removed', line: oldLines[i] });
                i += 1;
            } else {
                result.push({ type: 'added', line: newLines[j] });
                j += 1;
            }
        }

        while (i < oldLen) {
            result.push({ type: 'removed', line: oldLines[i] });
            i += 1;
        }
        while (j < newLen) {
            result.push({ type: 'added', line: newLines[j] });
            j += 1;
        }

        return result;
    }

    async function loadDiffDialogPreferredLines(operation: EditOperation) {
        const token = (diffDialogLoadToken += 1);
        const oldText =
            operation.operationType === 'insert' ? '' : String(operation.oldContent || '');
        const newText = String(operation.newContent || '');
        diffDialogGitError = '';
        diffDialogUnifiedPatch = '';

        const preferGit = settings?.codexDiffPreferGit !== false;
        if (operation.operationType === 'insert') {
            diffDialogLines = String(newText || '')
                .split('\n')
                .map(line => ({ type: 'added', line }));
            diffDialogEngine = 'lcs';
            return;
        }
        if (!preferGit || typeof (globalThis as any)?.require !== 'function') {
            diffDialogLines = generateSimpleDiff(oldText, newText);
            diffDialogEngine = 'lcs';
            return;
        }

        isDiffDialogLinesLoading = true;
        diffDialogEngine = 'git';
        diffDialogLines = [];
        const gitCliPath = resolveGitCliPath();
        const label = String(operation.filePath || operation.blockId || '').trim();

        try {
            const res = await runGitDiffNoIndex({
                cliPath: gitCliPath,
                oldText,
                newText,
                label,
                timeoutMs: 4000,
            });

            if (res.timedOut) {
                diffDialogGitError = 'git diff timeout';
                return;
            }

            if (res.exitCode !== null && res.exitCode > 1) {
                diffDialogGitError = (res.stderr || '').trim() || `git diff exit ${res.exitCode}`;
                diffDialogLines = generateSimpleDiff(oldText, newText);
                diffDialogEngine = 'lcs';
                return;
            }

            const gitLines = parseUnifiedDiffToLines(res.stdout || '');
            if (token !== diffDialogLoadToken) return;
            if (gitLines.length > 0) {
                diffDialogLines = gitLines;
            } else {
                diffDialogLines = String(oldText || '')
                    .split('\n')
                    .map(line => ({ type: 'unchanged', line }));
            }
            diffDialogUnifiedPatch = String(res.stdout || '').trimEnd();
        } catch (error) {
            if (token !== diffDialogLoadToken) return;
            diffDialogGitError = (error as Error).message || String(error);
            diffDialogLines = generateSimpleDiff(oldText, newText);
            diffDialogEngine = 'lcs';
        } finally {
            if (token !== diffDialogLoadToken) return;
            isDiffDialogLinesLoading = false;
        }
    }

    type SplitDiffRow = {
        leftLine: string;
        rightLine: string;
        leftType: 'removed' | 'unchanged' | 'empty';
        rightType: 'added' | 'unchanged' | 'empty';
    };

    function generateSplitDiffRowsFromLines(
        fullLines: { type: 'removed' | 'added' | 'unchanged'; line: string }[],
        maxLines = 120
    ): SplitDiffRow[] {
        const lines = compactTraceDiffLines(fullLines, maxLines);
        const rows: SplitDiffRow[] = [];
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (!line) continue;
            if (line.type === 'unchanged') {
                rows.push({
                    leftLine: line.line,
                    rightLine: line.line,
                    leftType: 'unchanged',
                    rightType: 'unchanged',
                });
                continue;
            }
            if (line.type === 'removed') {
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.type === 'added') {
                    rows.push({
                        leftLine: line.line,
                        rightLine: nextLine.line,
                        leftType: 'removed',
                        rightType: 'added',
                    });
                    i += 1;
                    continue;
                }
                rows.push({
                    leftLine: line.line,
                    rightLine: '',
                    leftType: 'removed',
                    rightType: 'empty',
                });
                continue;
            }
            rows.push({
                leftLine: '',
                rightLine: line.line,
                leftType: 'empty',
                rightType: 'added',
            });
        }
        return rows;
    }

    function appendGitLogLine(line: string) {
        const next = (gitLog ? gitLog + '\n' : '') + String(line || '');
        const maxLen = 24000;
        gitLog = next.length > maxLen ? next.slice(next.length - maxLen) : next;
    }

    function resolveGitRepoDir(): string {
        const fromDialog = String(gitRepoDir || '').trim();
        const explicit = String((settings as any)?.codexGitRepoDir || '').trim();
        const envRepo = getEnvFirst([
            'SIYUAN_CODEX_GIT_REPO_DIR',
            'SIYUAN_CODEX_GIT_REPO',
            'SIYUAN_GIT_REPO_DIR',
        ]);
        const working = String(settings?.codexWorkingDir || '').trim();
        return fromDialog || explicit || envRepo || working;
    }

    async function updateGitSettingsPatch(patch: Record<string, any>) {
        settings = { ...settings, ...patch };
        await plugin.saveSettings(settings);
    }

    function getEnvFirst(keys: string[]): string {
        const env = (globalThis as any)?.process?.env || {};
        for (const key of keys) {
            const v = String(env?.[key] || '').trim();
            if (v) return v;
        }
        return '';
    }

    function parseEnvBool(value: string): boolean | null {
        const v = String(value || '').trim().toLowerCase();
        if (!v) return null;
        if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
        if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
        return null;
    }

    type GitSyncScope = 'notes' | 'repo';

    function normalizeGitSyncScope(value: string): GitSyncScope | '' {
        const v = String(value || '').trim().toLowerCase();
        if (!v) return '';
        if (v === 'notes' || v === 'note' || v === 'notes_only' || v === 'notes-only') return 'notes';
        if (v === 'repo' || v === 'all' || v === 'full') return 'repo';
        return '';
    }

    function resolveGitSyncScope(): GitSyncScope {
        const fromDialog = normalizeGitSyncScope(String(gitSyncScope || ''));
        if (fromDialog) return fromDialog;
        const fromSettings = normalizeGitSyncScope(String((settings as any)?.codexGitSyncScope || ''));
        return fromSettings || 'notes';
    }

    function isNotesOnlyGitSync(): boolean {
        return resolveGitSyncScope() === 'notes';
    }

    function normalizeGitPath(path: string): string {
        return String(path || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\.\/+/, '');
    }

    function extractGitPorcelainPaths(porcelain: string): string[] {
        const paths: string[] = [];
        const lines = String(porcelain || '').split(/\r?\n/);
        for (const line of lines) {
            if (!line) continue;
            if (line.length < 4) continue;
            const raw = line.slice(3).trim();
            if (!raw) continue;
            if (raw.includes(' -> ')) {
                const parts = raw.split(' -> ').map(s => s.trim()).filter(Boolean);
                if (parts[0]) paths.push(parts[0]);
                if (parts.length > 1) paths.push(parts[parts.length - 1]);
                continue;
            }
            paths.push(raw);
        }
        return paths;
    }

    function isNoteContentGitPath(path: string): boolean {
        const p = normalizeGitPath(path).toLowerCase();
        if (!p) return false;
        if (p.endsWith('.sy')) return true;
        if (p.startsWith('assets/')) return true;
        if (p.startsWith('data/assets/')) return true;
        return false;
    }

    function filterNoteContentGitPaths(paths: string[]): string[] {
        return (Array.isArray(paths) ? paths : []).filter(p => isNoteContentGitPath(p));
    }

    function buildNoteScopePathspecs(notePaths: string[]): string[] {
        const specs: string[] = [];
        const normalized = (Array.isArray(notePaths) ? notePaths : []).map(normalizeGitPath);
        const hasSy = normalized.some(p => p.toLowerCase().endsWith('.sy'));
        const hasAssets = normalized.some(p => p.startsWith('assets/'));
        const hasDataAssets = normalized.some(p => p.startsWith('data/assets/'));
        if (hasSy) specs.push('**/*.sy');
        if (hasAssets) specs.push('assets');
        if (hasDataAssets) specs.push('data/assets');
        return Array.from(new Set(specs));
    }

    function resolveGitCliPath(): string {
        const fromSettings = String((settings as any)?.codexGitCliPath || '').trim();
        if (fromSettings) return fromSettings;
        const fromEnv = getEnvFirst([
            'SIYUAN_CODEX_GIT_CLI_PATH',
            'SIYUAN_CODEX_GIT_CLI',
            'SIYUAN_GIT_CLI_PATH',
        ]);
        return fromEnv;
    }

    function buildGitEnvHints(): string[] {
        return [
            '可用环境变量：',
            '- SIYUAN_CODEX_GIT_CLI_PATH：Git 可执行路径（可选）',
            '- SIYUAN_CODEX_GIT_REPO_DIR：Git 仓库目录',
            '- SIYUAN_CODEX_GIT_REMOTE_NAME：remote 名称（默认 origin）',
            '- SIYUAN_CODEX_GIT_REMOTE_URL：remote URL（GitHub/Gitee）',
            '- SIYUAN_CODEX_GIT_BRANCH：分支名（可选）',
            '- SIYUAN_CODEX_GIT_PULL_REBASE=1：pull 使用 rebase（可选）',
            '- SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1：rebase pull 自动暂存本地改动（默认开启）',
            '- SIYUAN_CODEX_GIT_SYNC_SCOPE=notes|repo：同步范围（notes=仅笔记）',
            '- SIYUAN_CODEX_GIT_NOTES_ONLY=1：只同步笔记（等价于 SYNC_SCOPE=notes）',
            '- SIYUAN_CODEX_GIT_DRY_RUN=1：自动同步以 dry-run 预览模式运行（不写操作）',
            '- SIYUAN_CODEX_GIT_AUTO_SYNC=1：打开对话框自动同步',
            '- SIYUAN_CODEX_GIT_COMMIT_MESSAGE：自动提交信息',
        ];
    }

    function buildGitTroubleshootHints(output: string): string[] {
        const text = String(output || '');
        const lower = text.toLowerCase();

        if (
            lower.includes('enoent') ||
            lower.includes('command not found') ||
            lower.includes('is not recognized') ||
            lower.includes('spawn git')
        ) {
            return [
                '未找到 Git：',
                '1) 安装 Git，并确保命令行可执行 git',
                '2) 或在设置里填写“Git 路径”（也可用环境变量 SIYUAN_CODEX_GIT_CLI_PATH）',
            ];
        }
        if (lower.includes('not a git repository') || lower.includes('inside-work-tree')) {
            return [
                '未检测到 Git 仓库：',
                '1) 在设置里填写“Git 仓库目录”，或设置环境变量 SIYUAN_CODEX_GIT_REPO_DIR',
                '2) 确认该目录存在 .git；否则在该目录执行 git init',
            ];
        }
        if (lower.includes('no such remote') || (lower.includes('remote') && lower.includes('does not exist'))) {
            return [
                'remote 未配置或名称不对：',
                '1) 执行 git remote -v 查看现有 remote',
                '2) 在对话框填写 Remote/Remote URL，或执行 git remote add origin <url>',
            ];
        }
        if (lower.includes('author identity unknown') || lower.includes('please tell me who you are')) {
            return [
                '缺少 Git 身份信息（user.name/user.email）：',
                '执行：git config --global user.name \"Your Name\"',
                '执行：git config --global user.email \"you@example.com\"',
            ];
        }
        if (lower.includes('index.lock') || lower.includes('another git process seems to be running')) {
            return [
                'Git 仓库被锁（index.lock）：',
                '1) 确认没有其他 git 进程在运行',
                '2) 删除锁文件：rm -f .git/index.lock',
            ];
        }
        if (lower.includes('your local changes would be overwritten')) {
            return [
                'pull 会覆盖本地修改：',
                '1) 先提交：git add -A && git commit -m \"wip\"',
                '2) 或暂存：git stash -u，然后再 pull',
            ];
        }
        if (lower.includes('cannot pull with rebase') && lower.includes('unstaged changes')) {
            return [
                'rebase pull 被未暂存改动阻止：',
                '1) 推荐开启“Pull 自动暂存本地改动”（或设置 SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1）',
                '2) 或手动执行：git pull --rebase --autostash',
                '3) 若不想自动暂存，可先 commit/stash 再 pull',
            ];
        }
        if (lower.includes('permission denied (publickey)') || lower.includes('publickey')) {
            return [
                'SSH 鉴权失败：',
                '1) 建议改用 SSH remote（git@...）',
                '2) 确认 ssh-agent 可用并已加载私钥',
                '3) 在 GitHub/Gitee 添加公钥后重试 push',
            ];
        }
        if (
            lower.includes('authentication failed') ||
            lower.includes('could not read username') ||
            lower.includes('fatal: authentication') ||
            lower.includes('password authentication is no longer supported')
        ) {
            return [
                '鉴权失败：',
                '1) 推荐使用 SSH remote（git@...）或系统凭据管理器（credential helper）',
                '2) HTTPS remote 可能需要 Token（PAT），不要把 Token 写进日志/URL',
            ];
        }
        if (
            lower.includes('failed to push some refs') ||
            lower.includes('non-fast-forward') ||
            lower.includes('fetch first') ||
            lower.includes('remote contains work')
        ) {
            return [
                'push 被拒绝（远端有新提交）：',
                '1) 先拉取：git pull --rebase',
                '2) 再推送：git push',
            ];
        }
        if (lower.includes('has no upstream branch') || lower.includes('set upstream')) {
            return [
                '当前分支未设置上游：',
                '执行：git push -u origin <branch>',
                '或在对话框里填写 Branch，再点 Push',
            ];
        }
        if (lower.includes('conflict') || lower.includes('merge conflict')) {
            return [
                '存在冲突：',
                '1) 先在本地解决冲突并提交',
                '2) 再重新执行 push',
            ];
        }
        if (
            lower.includes('repository not found') ||
            lower.includes('fatal: repository') ||
            lower.includes('http 404')
        ) {
            return [
                '远端仓库不存在或无权限：',
                '1) 检查 remote URL 是否正确',
                '2) 确认当前账号对仓库有权限',
            ];
        }
        if (
            lower.includes('could not resolve host') ||
            lower.includes('network is unreachable') ||
            lower.includes('connection timed out') ||
            lower.includes('operation timed out')
        ) {
            return [
                '网络连接失败：',
                '1) 检查网络/代理/防火墙',
                '2) 确认 remote URL 可访问后再重试',
            ];
        }
        return [...buildGitEnvHints()];
    }

    function appendGitHintsIfNeeded(output: string) {
        const hints = buildGitTroubleshootHints(output);
        if (!hints.length) return;
        appendGitLogLine('---');
        for (const line of hints) appendGitLogLine(line);
    }

    async function hydrateGitSettingsFromEnv() {
        const patch: Record<string, any> = {};

        const envGitCli = getEnvFirst(['SIYUAN_CODEX_GIT_CLI_PATH', 'SIYUAN_CODEX_GIT_CLI']);
        if (!String((settings as any)?.codexGitCliPath || '').trim() && envGitCli) {
            patch.codexGitCliPath = envGitCli;
        }

        const envRepo = getEnvFirst(['SIYUAN_CODEX_GIT_REPO_DIR', 'SIYUAN_CODEX_GIT_REPO']);
        if (!String((settings as any)?.codexGitRepoDir || '').trim() && envRepo) {
            patch.codexGitRepoDir = envRepo;
        }

        const envRemoteName = getEnvFirst(['SIYUAN_CODEX_GIT_REMOTE_NAME']);
        if (!String((settings as any)?.codexGitRemoteName || '').trim() && envRemoteName) {
            patch.codexGitRemoteName = envRemoteName;
        }

        const envRemoteUrl = getEnvFirst(['SIYUAN_CODEX_GIT_REMOTE_URL']);
        if (!String((settings as any)?.codexGitRemoteUrl || '').trim() && envRemoteUrl) {
            patch.codexGitRemoteUrl = envRemoteUrl;
        }

        const envBranch = getEnvFirst(['SIYUAN_CODEX_GIT_BRANCH']);
        if (!String((settings as any)?.codexGitBranch || '').trim() && envBranch) {
            patch.codexGitBranch = envBranch;
        }

        const envScope = getEnvFirst(['SIYUAN_CODEX_GIT_SYNC_SCOPE']);
        const normalizedScope = normalizeGitSyncScope(envScope);
        if (normalizedScope) {
            patch.codexGitSyncScope = normalizedScope;
        }

        const envNotesOnly = getEnvFirst(['SIYUAN_CODEX_GIT_NOTES_ONLY']);
        const parsedNotesOnly = parseEnvBool(envNotesOnly);
        if (parsedNotesOnly !== null) {
            patch.codexGitSyncScope = parsedNotesOnly ? 'notes' : 'repo';
        }

        const envRebase = getEnvFirst(['SIYUAN_CODEX_GIT_PULL_REBASE']);
        const parsedRebase = parseEnvBool(envRebase);
        if (parsedRebase !== null) {
            patch.codexGitPullRebase = parsedRebase;
        }

        const envPullAutostash = getEnvFirst(['SIYUAN_CODEX_GIT_PULL_AUTOSTASH']);
        const parsedPullAutostash = parseEnvBool(envPullAutostash);
        if (parsedPullAutostash !== null) {
            patch.codexGitPullAutostash = parsedPullAutostash;
        }

        const envAutoSync = getEnvFirst(['SIYUAN_CODEX_GIT_AUTO_SYNC']);
        const parsedAutoSync = parseEnvBool(envAutoSync);
        if (parsedAutoSync !== null) {
            patch.codexGitAutoSyncEnabled = parsedAutoSync;
        }

        const envDryRun = getEnvFirst(['SIYUAN_CODEX_GIT_DRY_RUN']);
        const parsedDryRun = parseEnvBool(envDryRun);
        if (parsedDryRun !== null) {
            patch.codexGitAutoSyncDryRun = parsedDryRun;
        }

        const envCommitMessage = getEnvFirst(['SIYUAN_CODEX_GIT_COMMIT_MESSAGE']);
        if (!String((settings as any)?.codexGitAutoCommitMessage || '').trim() && envCommitMessage) {
            patch.codexGitAutoCommitMessage = envCommitMessage;
        }

        if (Object.keys(patch).length > 0) {
            await updateGitSettingsPatch(patch);
        }
    }

    async function autoDetectGitRepoMeta() {
        if (gitIsRunning) return;
        const cwd = String(settings?.codexWorkingDir || '').trim();
        if (!cwd) return;

        try {
            const handle = runGitCommand({
                cliPath: resolveGitCliPath(),
                cwd,
                args: ['rev-parse', '--show-toplevel'],
                timeoutMs: 8000,
                acceptExitCodes: [0],
            });
            const res = await handle.completed;
            const top = String(res.stdout || '').trim();
            if (!top) return;

            const current = String((settings as any)?.codexGitRepoDir || '').trim();
            if (!current) {
                await updateGitSettingsPatch({ codexGitRepoDir: top });
            }
        } catch {
            // ignore
        }
    }

    async function openGitSyncDialog() {
        await hydrateGitSettingsFromEnv();
        isGitSyncDialogOpen = true;
        gitRepoDir = String((settings as any)?.codexGitRepoDir || '').trim();
        gitRemoteName = String((settings as any)?.codexGitRemoteName || 'origin').trim() || 'origin';
        gitRemoteUrl = String((settings as any)?.codexGitRemoteUrl || '').trim();
        gitBranch = String((settings as any)?.codexGitBranch || '').trim();
        gitSyncScope =
            normalizeGitSyncScope(String((settings as any)?.codexGitSyncScope || '')) || 'notes';
        gitAutoSyncDryRun = (settings as any)?.codexGitAutoSyncDryRun === true;
        gitCommitMessage = '';
        gitLog = '';
        gitLastExitCode = null;
        await tick();
        gitSyncRepoInputElement?.focus();
        void autoDetectGitRepoMeta();
        if ((settings as any)?.codexGitAutoSyncEnabled === true) {
            void runGitAutoSync();
        } else {
            void runGitStatus();
        }
    }

    function closeGitSyncDialog() {
        try {
            gitAbortCurrent?.();
        } catch {
            // ignore
        }
        isGitSyncDialogOpen = false;
        gitIsRunning = false;
        gitAbortCurrent = null;
        tick().then(() => textareaElement?.focus());
    }

    async function runGitSingleCommand(
        args: string[],
        options?: { timeoutMs?: number; acceptExitCodes?: number[] }
    ) {
        if (gitIsRunning) {
            pushErrMsg('Git 正在运行中，请稍后再试');
            return;
        }
        const cwd = resolveGitRepoDir();
        if (!cwd) {
            pushErrMsg('未设置 Git 仓库目录：请先配置 Codex 工作目录或 Git 仓库目录');
            return;
        }

        gitIsRunning = true;
        gitLastExitCode = null;

        const cliPath = resolveGitCliPath();
        appendGitLogLine(`$ ${(cliPath || 'git')} ${args.join(' ')}`);

        try {
            const handle = runGitCommand({
                cliPath,
                cwd,
                args,
                timeoutMs: options?.timeoutMs ?? 60000,
                acceptExitCodes: options?.acceptExitCodes ?? [0],
                onStdoutLine: line => appendGitLogLine(line),
                onStderrLine: line => appendGitLogLine(line),
            });
            gitAbortCurrent = handle.abort;
            const res = await handle.completed;
            gitLastExitCode = res.exitCode;
            if (res.timedOut) {
                appendGitLogLine('[timeout]');
            }
            if (
                res.exitCode !== null &&
                (options?.acceptExitCodes ?? [0]).includes(res.exitCode) === false
            ) {
                appendGitLogLine(`(exit ${res.exitCode})`);
                appendGitHintsIfNeeded(res.stderr || res.stdout || '');
            }
        } catch (error) {
            appendGitLogLine((error as Error).message || String(error));
        } finally {
            gitIsRunning = false;
            gitAbortCurrent = null;
        }
    }

    async function runGitStatus() {
        await runGitSingleCommand(['status', '--porcelain=v1', '-b'], { timeoutMs: 15000 });
    }

    async function runGitInit() {
        await runGitSingleCommand(['init'], { timeoutMs: 15000 });
    }

    async function runGitNotesOnlyAdd() {
        if (gitIsRunning) {
            pushErrMsg('Git 正在运行中，请稍后再试');
            return;
        }
        const cwd = resolveGitRepoDir();
        if (!cwd) {
            pushErrMsg('未设置 Git 仓库目录：请先配置 Codex 工作目录或 Git 仓库目录');
            return;
        }

        gitIsRunning = true;
        gitLastExitCode = null;

        const cliPath = resolveGitCliPath();
        const accept0 = [0];

        const run = async (
            args: string[],
            options?: { timeoutMs?: number; acceptExitCodes?: number[] }
        ) => {
            appendGitLogLine(`$ ${(cliPath || 'git')} ${args.join(' ')}`);
            const handle = runGitCommand({
                cliPath,
                cwd,
                args,
                timeoutMs: options?.timeoutMs ?? 60000,
                acceptExitCodes: options?.acceptExitCodes ?? accept0,
                onStdoutLine: line => appendGitLogLine(line),
                onStderrLine: line => appendGitLogLine(line),
            });
            gitAbortCurrent = handle.abort;
            const res = await handle.completed;
            gitLastExitCode = res.exitCode;
            const ok =
                res.exitCode !== null &&
                (options?.acceptExitCodes ?? accept0).includes(res.exitCode) &&
                !res.timedOut;
            if (!ok) {
                appendGitLogLine(res.timedOut ? '[timeout]' : `(exit ${res.exitCode ?? 'null'})`);
                appendGitHintsIfNeeded(res.stderr || res.stdout || '');
            }
            return { ok, res };
        };

        try {
            appendGitLogLine('== Add Notes ==');
            const status = await run(['status', '--porcelain=v1'], {
                timeoutMs: 15000,
                acceptExitCodes: [0],
            });
            if (!status.ok) return;

            const notePaths = filterNoteContentGitPaths(
                extractGitPorcelainPaths(status.res.stdout || '')
            );
            const specs = buildNoteScopePathspecs(notePaths);
            if (specs.length === 0) {
                appendGitLogLine('(no note changes)');
                return;
            }

            await run(['add', '-A', '--', ...specs], { timeoutMs: 60000, acceptExitCodes: [0] });
        } catch (error) {
            appendGitLogLine((error as Error).message || String(error));
            appendGitHintsIfNeeded((error as Error).message || String(error));
        } finally {
            gitIsRunning = false;
            gitAbortCurrent = null;
        }
    }

    async function runGitNotesOnlyCommit(message: string) {
        if (gitIsRunning) {
            pushErrMsg('Git 正在运行中，请稍后再试');
            return;
        }
        const cwd = resolveGitRepoDir();
        if (!cwd) {
            pushErrMsg('未设置 Git 仓库目录：请先配置 Codex 工作目录或 Git 仓库目录');
            return;
        }

        gitIsRunning = true;
        gitLastExitCode = null;

        const cliPath = resolveGitCliPath();
        const accept0 = [0];

        const run = async (
            args: string[],
            options?: { timeoutMs?: number; acceptExitCodes?: number[] }
        ) => {
            appendGitLogLine(`$ ${(cliPath || 'git')} ${args.join(' ')}`);
            const handle = runGitCommand({
                cliPath,
                cwd,
                args,
                timeoutMs: options?.timeoutMs ?? 60000,
                acceptExitCodes: options?.acceptExitCodes ?? accept0,
                onStdoutLine: line => appendGitLogLine(line),
                onStderrLine: line => appendGitLogLine(line),
            });
            gitAbortCurrent = handle.abort;
            const res = await handle.completed;
            gitLastExitCode = res.exitCode;
            const ok =
                res.exitCode !== null &&
                (options?.acceptExitCodes ?? accept0).includes(res.exitCode) &&
                !res.timedOut;
            if (!ok) {
                appendGitLogLine(res.timedOut ? '[timeout]' : `(exit ${res.exitCode ?? 'null'})`);
                appendGitHintsIfNeeded(res.stderr || res.stdout || '');
            }
            return { ok, res };
        };

        try {
            appendGitLogLine('== Commit Notes ==');
            const status = await run(['status', '--porcelain=v1'], {
                timeoutMs: 15000,
                acceptExitCodes: [0],
            });
            if (!status.ok) return;

            const notePaths = filterNoteContentGitPaths(
                extractGitPorcelainPaths(status.res.stdout || '')
            );
            const specs = buildNoteScopePathspecs(notePaths);
            if (specs.length === 0) {
                appendGitLogLine('(no note changes)');
                return;
            }

            const add = await run(['add', '-A', '--', ...specs], {
                timeoutMs: 60000,
                acceptExitCodes: [0],
            });
            if (!add.ok) return;

            const commit = await run(['commit', '-m', message, '--', ...specs], {
                timeoutMs: 60000,
                acceptExitCodes: [0, 1],
            });
            if (!commit.ok && commit.res.exitCode !== 1) {
                pushErrMsg('git commit 失败');
                return;
            }
        } catch (error) {
            appendGitLogLine((error as Error).message || String(error));
            appendGitHintsIfNeeded((error as Error).message || String(error));
        } finally {
            gitIsRunning = false;
            gitAbortCurrent = null;
        }
    }

    async function runGitAddAll() {
        if (isNotesOnlyGitSync()) {
            await runGitNotesOnlyAdd();
            return;
        }
        await runGitSingleCommand(['add', '-A'], { timeoutMs: 30000 });
    }

    async function runGitCommit() {
        const message = String(gitCommitMessage || '').trim();
        if (!message) {
            pushErrMsg('请输入 commit message');
            return;
        }
        if (isNotesOnlyGitSync()) {
            await runGitNotesOnlyCommit(message);
            return;
        }
        await runGitSingleCommand(['commit', '-m', message], { timeoutMs: 60000 });
    }

    function appendGitPullArgs(args: string[]) {
        const rebase = (settings as any)?.codexGitPullRebase !== false;
        if (!rebase) return;
        args.push('--rebase');
        if ((settings as any)?.codexGitPullAutostash !== false) {
            args.push('--autostash');
        }
    }

    async function runGitPull() {
        const branch = String(gitBranch || '').trim();
        const args = ['pull'];
        appendGitPullArgs(args);
        if (branch) {
            const remote = String(gitRemoteName || '').trim() || 'origin';
            args.push(remote, branch);
        }
        await runGitSingleCommand(args, { timeoutMs: 120000 });
    }

    async function runGitPush() {
        const branch = String(gitBranch || '').trim();
        const args = ['push'];
        if (branch) {
            const remote = String(gitRemoteName || '').trim() || 'origin';
            args.push('-u', remote, branch);
        }
        await runGitSingleCommand(args, { timeoutMs: 120000 });
    }

    async function runGitSetRemote() {
        const remote = String(gitRemoteName || '').trim() || 'origin';
        const url = String(gitRemoteUrl || '').trim();
        if (!url) {
            pushErrMsg('请输入 remote URL');
            return;
        }

        // 尝试 set-url，若 remote 不存在则 add
        await runGitSingleCommand(['remote', 'set-url', remote, url], { timeoutMs: 15000 });
        if (gitLastExitCode !== 0) {
            await runGitSingleCommand(['remote', 'add', remote, url], { timeoutMs: 15000 });
        }
    }

    let gitAutoSyncToken = 0;

    function buildAutoCommitMessage(): string {
        const tpl =
            String(gitCommitMessage || '').trim() ||
            String((settings as any)?.codexGitAutoCommitMessage || '').trim() ||
            getEnvFirst(['SIYUAN_CODEX_GIT_COMMIT_MESSAGE']);
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
            now.getHours()
        )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        if (!tpl) return `Codex auto-sync ${ts}`;
        return tpl.replace('{ts}', ts).replace('{time}', ts);
    }

    function formatGitCommandArgsForLog(args: string[]): string {
        return (Array.isArray(args) ? args : [])
            .map(arg => {
                const value = String(arg ?? '');
                return /[\s"']/g.test(value) ? JSON.stringify(value) : value;
            })
            .join(' ');
    }

    async function runGitAutoSync(options?: { dryRun?: boolean }) {
        if (gitIsRunning) {
            pushErrMsg('Git 正在运行中，请稍后再试');
            return;
        }

        const token = (gitAutoSyncToken += 1);
        const cwd = resolveGitRepoDir();
        if (!cwd) {
            appendGitLogLine('未设置 Git 仓库目录，无法自动同步。');
            appendGitHintsIfNeeded('not a git repository');
            pushErrMsg('未设置 Git 仓库目录');
            return;
        }

        gitIsRunning = true;
        gitLastExitCode = null;
        const dryRun = options?.dryRun ?? gitAutoSyncDryRun === true;
        appendGitLogLine(dryRun ? '== Auto Sync (Dry Run) ==' : '== Auto Sync ==');
        appendGitLogLine(`(scope: ${resolveGitSyncScope()}${dryRun ? ', dry-run' : ''})`);

        const cliPath = resolveGitCliPath();
        const cliLabel = cliPath || 'git';
        const accept0 = [0];

        const runStep = async (
            args: string[],
            options?: { timeoutMs?: number; acceptExitCodes?: number[] }
        ) => {
            appendGitLogLine(`$ ${cliLabel} ${args.join(' ')}`);
            const handle = runGitCommand({
                cliPath,
                cwd,
                args,
                timeoutMs: options?.timeoutMs ?? 60000,
                acceptExitCodes: options?.acceptExitCodes ?? accept0,
                onStdoutLine: line => appendGitLogLine(line),
                onStderrLine: line => appendGitLogLine(line),
            });
            gitAbortCurrent = handle.abort;
            const res = await handle.completed;
            gitLastExitCode = res.exitCode;
            if (token !== gitAutoSyncToken) return { ok: false, aborted: true, res };
            const ok =
                res.exitCode !== null &&
                (options?.acceptExitCodes ?? accept0).includes(res.exitCode) &&
                !res.timedOut;
            if (!ok) {
                appendGitLogLine(res.timedOut ? '[timeout]' : `(exit ${res.exitCode ?? 'null'})`);
                appendGitHintsIfNeeded(res.stderr || res.stdout || '');
            }
            return { ok, aborted: false, res };
        };
        const previewWriteStep = (args: string[], note?: string) => {
            appendGitLogLine(`[dry-run] $ ${cliLabel} ${formatGitCommandArgsForLog(args)}`);
            if (note) appendGitLogLine(`[dry-run] ${note}`);
        };

        try {
            const ver = await runStep(['--version'], { timeoutMs: 8000, acceptExitCodes: [0] });
            if (!ver.ok) {
                pushErrMsg('未检测到 git，请先安装 git 或在设置里填写 Git 路径');
                return;
            }

            const inside = await runStep(['rev-parse', '--is-inside-work-tree'], {
                timeoutMs: 8000,
                acceptExitCodes: [0],
            });
            if (!inside.ok) {
                pushErrMsg('当前目录不是 Git 仓库');
                return;
            }

            // 尝试补齐 repo root（用于下次默认）
            const top = await runStep(['rev-parse', '--show-toplevel'], {
                timeoutMs: 8000,
                acceptExitCodes: [0],
            });
            const topDir = String(top.res.stdout || '').trim();
            if (top.ok && topDir) {
                if (!String(gitRepoDir || '').trim()) {
                    gitRepoDir = topDir;
                }
                if (!String((settings as any)?.codexGitRepoDir || '').trim()) {
                    await updateGitSettingsPatch({ codexGitRepoDir: topDir });
                }
            }

            // remote / branch / upstream（仅用于本次同步）
            const remotes = await runStep(['remote'], { timeoutMs: 8000, acceptExitCodes: [0] });
            const remoteList = String(remotes.res.stdout || '')
                .split(/\r?\n/)
                .map(s => s.trim())
                .filter(Boolean);

            let hasRemote = remoteList.length > 0;
            const preferredRemote = String(gitRemoteName || 'origin').trim() || 'origin';
            if (hasRemote) {
                if (!remoteList.includes(preferredRemote)) {
                    gitRemoteName = remoteList.includes('origin') ? 'origin' : remoteList[0] || 'origin';
                } else {
                    gitRemoteName = preferredRemote;
                }
            } else {
                const url = String(gitRemoteUrl || '').trim();
                if (url) {
                    if (dryRun) {
                        previewWriteStep(
                            ['remote', 'add', preferredRemote, url],
                            'skip write: add remote'
                        );
                    } else {
                        const addRemote = await runStep(['remote', 'add', preferredRemote, url], {
                            timeoutMs: 15000,
                            acceptExitCodes: [0],
                        });
                        if (!addRemote.ok) {
                            pushErrMsg('remote 配置失败');
                            return;
                        }
                    }
                    gitRemoteName = preferredRemote;
                    hasRemote = true;
                } else {
                    appendGitLogLine('(no remote configured; will skip pull/push)');
                    appendGitLogLine(
                        '提示：请在设置里填写 Git Remote URL，或设置环境变量 SIYUAN_CODEX_GIT_REMOTE_URL'
                    );
                }
            }

            if (!gitRemoteUrl && hasRemote) {
                const remote = String(gitRemoteName || 'origin').trim() || 'origin';
                const urlRes = await runStep(['config', '--get', `remote.${remote}.url`], {
                    timeoutMs: 8000,
                    acceptExitCodes: [0, 1],
                });
                const url = String(urlRes.res.stdout || '').trim();
                if (url) gitRemoteUrl = url;
            }

            if (!gitBranch) {
                const branchRes = await runStep(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
                    timeoutMs: 8000,
                    acceptExitCodes: [0],
                });
                const branch = String(branchRes.res.stdout || '').trim();
                if (branch) gitBranch = branch;
            }

            const upstreamRes = await runStep(
                ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
                {
                    timeoutMs: 8000,
                    acceptExitCodes: [0, 128],
                }
            );
            const hasUpstream = upstreamRes.ok && String(upstreamRes.res.stdout || '').trim().length > 0;

            // pull（有 upstream 优先；否则尝试 remote+branch）
            if (hasUpstream) {
                const pullArgs = ['pull'];
                appendGitPullArgs(pullArgs);
                if (dryRun) {
                    previewWriteStep(pullArgs, 'skip write: pull');
                } else {
                    const pull = await runStep(pullArgs, { timeoutMs: 120000, acceptExitCodes: [0] });
                    if (!pull.ok) {
                        pushErrMsg('git pull 失败');
                        return;
                    }
                }
            } else if (hasRemote && String(gitBranch || '').trim()) {
                const remote = String(gitRemoteName || 'origin').trim() || 'origin';
                const branch = String(gitBranch || '').trim();
                const pullArgs = ['pull'];
                appendGitPullArgs(pullArgs);
                pullArgs.push(remote, branch);
                if (dryRun) {
                    previewWriteStep(pullArgs, 'skip write: pull');
                } else {
                    const pull = await runStep(pullArgs, { timeoutMs: 120000, acceptExitCodes: [0] });
                    if (!pull.ok) {
                        pushErrMsg('git pull 失败');
                        return;
                    }
                }
            } else {
                appendGitLogLine('(skip pull: no upstream)');
            }

            // 是否需要提交
            const status = await runStep(['status', '--porcelain=v1'], {
                timeoutMs: 15000,
                acceptExitCodes: [0],
            });
            if (!status.ok) return;
            const porcelain = String(status.res.stdout || '');
            const hasAnyChanges = porcelain.trim().length > 0;
            const scope = resolveGitSyncScope();

            if (!hasAnyChanges) {
                appendGitLogLine('(no changes)');
            } else if (scope === 'notes') {
                const allPaths = extractGitPorcelainPaths(porcelain);
                const notePaths = filterNoteContentGitPaths(allPaths);
                const specs = buildNoteScopePathspecs(notePaths);

                if (specs.length === 0) {
                    appendGitLogLine('(skip commit: no note changes)');
                } else {
                    appendGitLogLine(`(notes-only: ${notePaths.length} paths)`);
                    const msg = buildAutoCommitMessage();
                    if (dryRun) {
                        previewWriteStep(['add', '-A', '--', ...specs], 'skip write: add');
                        previewWriteStep(
                            ['commit', '-m', msg, '--', ...specs],
                            'skip write: commit'
                        );
                    } else {
                        const add = await runStep(['add', '-A', '--', ...specs], {
                            timeoutMs: 60000,
                            acceptExitCodes: [0],
                        });
                        if (!add.ok) return;

                        const commit = await runStep(['commit', '-m', msg, '--', ...specs], {
                            timeoutMs: 60000,
                            // 1: nothing to commit
                            acceptExitCodes: [0, 1],
                        });
                        if (!commit.ok && commit.res.exitCode !== 1) {
                            pushErrMsg('git commit 失败');
                            return;
                        }
                    }
                }
            } else {
                const msg = buildAutoCommitMessage();
                if (dryRun) {
                    previewWriteStep(['add', '-A'], 'skip write: add');
                    previewWriteStep(['commit', '-m', msg], 'skip write: commit');
                } else {
                    const add = await runStep(['add', '-A'], { timeoutMs: 30000, acceptExitCodes: [0] });
                    if (!add.ok) return;

                    const commit = await runStep(['commit', '-m', msg], {
                        timeoutMs: 60000,
                        // 1: nothing to commit
                        acceptExitCodes: [0, 1],
                    });
                    if (!commit.ok && commit.res.exitCode !== 1) {
                        pushErrMsg('git commit 失败');
                        return;
                    }
                }
            }

            // push（优先 upstream；否则 remote+branch；否则跳过）
            if (hasUpstream) {
                if (dryRun) {
                    previewWriteStep(['push'], 'skip write: push');
                } else {
                    const push = await runStep(['push'], { timeoutMs: 120000, acceptExitCodes: [0] });
                    if (!push.ok) {
                        pushErrMsg('git push 失败');
                        return;
                    }
                }
            } else if (hasRemote && String(gitBranch || '').trim()) {
                const remote = String(gitRemoteName || 'origin').trim() || 'origin';
                const branch = String(gitBranch || '').trim();
                if (dryRun) {
                    previewWriteStep(['push', '-u', remote, branch], 'skip write: push');
                } else {
                    const push = await runStep(['push', '-u', remote, branch], {
                        timeoutMs: 120000,
                        acceptExitCodes: [0],
                    });
                    if (!push.ok) {
                        pushErrMsg('git push 失败');
                        return;
                    }
                }
            } else {
                appendGitLogLine('(skip push: no upstream/remote/branch)');
            }

            appendGitLogLine(dryRun ? '== Auto Sync Dry-run Done ==' : '== Auto Sync Done ==');
            if (dryRun) {
                pushMsg('Dry-run 预览完成，未执行写操作');
            } else {
                pushMsg(t('aiSidebar.git.autoSyncDone') || '同步完成');
            }
        } catch (error) {
            appendGitLogLine((error as Error).message || String(error));
            appendGitHintsIfNeeded((error as Error).message || String(error));
            pushErrMsg(
                dryRun
                    ? 'Dry-run 预览失败'
                    : t('aiSidebar.git.autoSyncFailed') || '同步失败'
            );
        } finally {
            if (token === gitAutoSyncToken) {
                gitIsRunning = false;
                gitAbortCurrent = null;
            }
        }
    }

    // 消息操作函数
    // 在历史消息的多模型响应中选择某个模型的答案（支持切换并保留手动编辑）
    function selectHistoryMultiModelAnswer(absMessageIndex: number, responseIndex: number) {
        const msg = messages[absMessageIndex];
        if (!msg || !msg.multiModelResponses || msg.multiModelResponses.length === 0) return;

        const prevSelected = msg.multiModelResponses.findIndex(r => r.isSelected);
        if (prevSelected === responseIndex) return;

        // 保存当前显示内容到编辑缓存（如果有）
        msg._editedSelections = msg._editedSelections || {};
        if (prevSelected !== -1) {
            msg._editedSelections[prevSelected] = msg.content;
        }

        // 更新选中标记并优化名称显示
        msg.multiModelResponses = msg.multiModelResponses.map((r, i) => {
            const cleanName = (r.modelName || '').toString().replace(/^ ✅/, '');
            return {
                ...r,
                isSelected: i === responseIndex,
                modelName: i === responseIndex ? ' ✅' + cleanName : cleanName,
            };
        });

        // 如果之前对目标答案有手动编辑，则恢复编辑内容，否则使用模型原始内容
        const edited = msg._editedSelections[responseIndex];
        msg.content = edited ?? msg.multiModelResponses[responseIndex].content;

        messages = [...messages];
        hasUnsavedChanges = true;
        // 保存会话状态
        saveCurrentSession(true);
    }

    // 删除消息
    function deleteMessage(index: number, count = 1) {
        confirm(
            t('aiSidebar.confirm.deleteMessage.title'),
            t('aiSidebar.confirm.deleteMessage.message'),
            () => {
                const safeCount = Math.max(1, Math.floor(Number(count || 1)));
                messages = messages.filter((_, i) => i < index || i >= index + safeCount);
                hasUnsavedChanges = true;
            }
        );
    }

    // 重新生成AI回复
    async function regenerateMessage(index: number) {
        if (isLoading) {
            pushErrMsg(t('aiSidebar.errors.generating'));
            return;
        }

        const targetMessage = messages[index];
        if (!targetMessage) {
            pushErrMsg(t('aiSidebar.errors.noMessage'));
            return;
        }

        // 检查目标消息或后续消息是否包含多模型响应
        let useMultiModel = false;
        let previousMultiModels: Array<{ provider: string; modelId: string }> = [];

        if (targetMessage.role === 'assistant' && targetMessage.multiModelResponses) {
            useMultiModel = true;
            // 提取之前使用的模型列表
            previousMultiModels = targetMessage.multiModelResponses.map(r => ({
                provider: r.provider,
                modelId: r.modelId,
            }));
        }

        // 如果是用户消息，删除该消息及之后的所有消息，然后重新发送
        // 如果是AI消息，删除该消息及之后的所有消息，然后重新请求
        if (targetMessage.role === 'user') {
            // 检查下一条消息是否是多模型响应
            const nextMessage = messages[index + 1];
            if (
                nextMessage &&
                nextMessage.role === 'assistant' &&
                nextMessage.multiModelResponses
            ) {
                useMultiModel = true;
                previousMultiModels = nextMessage.multiModelResponses.map(r => ({
                    provider: r.provider,
                    modelId: r.modelId,
                }));
            }

            // 删除该用户消息及之后的所有消息
            messages = messages.slice(0, index);
            hasUnsavedChanges = true;

            // 重新添加该用户消息
            const userMessage: Message = {
                role: 'user',
                content: targetMessage.content,
                attachments: targetMessage.attachments,
                contextDocuments: targetMessage.contextDocuments,
            };
            messages = [...messages, userMessage];
        } else {
            // AI消息：删除从此消息开始的所有后续消息
            messages = messages.slice(0, index);
            hasUnsavedChanges = true;
        }

        // 获取最后一条用户消息
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            pushErrMsg(t('aiSidebar.errors.noUserMessage'));
            return;
        }

        // 处理多模型重新生成的逻辑
        // 情况1：之前使用了多模型，且用户当前启用了多模型，优先使用当前用户设置的模型列表
        // 情况2：用户当前启用了多模型，使用当前选择的多模型
        // 情况3：用户关闭了多模型，使用单模型
        if (chatMode === 'ask') {
            // 检查是否应该使用多模型
            let shouldUseMultiModel = false;
            let modelsToUse: Array<{ provider: string; modelId: string }> = [];

            // 只有当用户当前启用了多模型时，才考虑使用多模型
            if (enableMultiModel && selectedMultiModels.length > 0) {
                // 优先使用当前用户设置的模型列表
                const validCurrentModels = selectedMultiModels.filter(model => {
                    const config = getProviderAndModelConfig(model.provider, model.modelId);
                    return config !== null;
                });

                if (validCurrentModels.length > 0) {
                    // 使用当前有效的模型
                    shouldUseMultiModel = true;
                    modelsToUse = validCurrentModels;
                } else {
                    // 当前设置的模型都无效，检查是否之前有使用多模型
                    if (useMultiModel && previousMultiModels.length > 0) {
                        const validPreviousModels = previousMultiModels.filter(model => {
                            const config = getProviderAndModelConfig(model.provider, model.modelId);
                            return config !== null;
                        });

                        if (validPreviousModels.length > 0) {
                            pushMsg('当前选择的多模型无效，将使用之前的模型重新生成');
                            shouldUseMultiModel = true;
                            modelsToUse = validPreviousModels;
                        }
                    }
                }
            }
            // 情况3：用户关闭了多模型，不使用多模型（继续执行后续单模型逻辑）

            // 如果应该使用多模型，则调用多模型发送
            if (shouldUseMultiModel && modelsToUse.length > 0) {
                // 临时保存当前的多模型选择
                const originalMultiModels = [...selectedMultiModels];
                const originalEnableMultiModel = enableMultiModel;

                // 设置为要使用的模型
                selectedMultiModels = modelsToUse;
                enableMultiModel = true;

                // 调用多模型发送
                await sendMultiModelMessage();

                // 恢复原来的设置
                selectedMultiModels = originalMultiModels;
                enableMultiModel = originalEnableMultiModel;

                return; // 多模型发送完成，直接返回
            }
        }

        // 重新发送请求
        isLoading = true;
        isAborted = false; // 重置中断标志
        streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
        streamingSearchCalls = [];
        isThinkingPhase = false;
        autoScroll = true; // 重新生成时启用自动滚动

        await scrollToBottom(true);

        // 获取最后一条用户消息关联的上下文文档，并获取最新内容
        const contextDocumentsWithLatestContent: ContextDocument[] = [];
        const userContextDocs = lastUserMessage.contextDocuments || [];
        for (const doc of userContextDocs) {
            try {
                let content: string;

                if (chatMode === 'edit') {
                    // 编辑模式：获取kramdown格式，保留块ID结构
                    const blockData = await getBlockKramdown(doc.id);
                    if (blockData && blockData.kramdown) {
                        content = blockData.kramdown;
                    } else {
                        // 降级使用缓存内容
                        content = doc.content;
                    }
                } else {
                    // 问答模式：获取Markdown格式
                    const data = await exportMdContent(doc.id, false, false, 2, 0, false);
                    if (data && data.content) {
                        content = data.content;
                    } else {
                        // 降级使用缓存内容
                        content = doc.content;
                    }
                }

                contextDocumentsWithLatestContent.push({
                    id: doc.id,
                    title: doc.title,
                    content: content,
                    type: doc.type,
                });
            } catch (error) {
                console.error(`Failed to fetch latest content for block ${doc.id}:`, error);
                // 如果获取失败，使用原有内容
                contextDocumentsWithLatestContent.push(doc);
            }
        }

        // 准备发送给AI的消息（包含系统提示词和上下文文档）
        // 深拷贝消息数组，避免修改原始消息
        const messagesToSend = messages
            .filter(msg => msg.role !== 'system')
            .map((msg, index, array) => {
                const baseMsg: any = {
                    role: msg.role,
                    content: msg.content,
                };

                // 只处理历史用户消息的上下文（不是最后一条消息）
                // 最后一条消息将在后面用最新内容处理
                const isLastMessage = index === array.length - 1;
                if (
                    !isLastMessage &&
                    msg.role === 'user' &&
                    msg.contextDocuments &&
                    msg.contextDocuments.length > 0
                ) {
                    const hasImages = msg.attachments?.some(att => att.type === 'image');

                    // 获取原始消息内容
                    const originalContent =
                        typeof msg.content === 'string' ? msg.content : getMessageText(msg.content);

                    // 构建上下文文本
                    const contextText = msg.contextDocuments
                        .map(doc => {
                            const label = doc.type === 'doc' ? '文档' : '块';
                            return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                        })
                        .join('\n\n---\n\n');

                    // 如果有图片附件，使用多模态格式
                    if (hasImages) {
                        const contentParts: any[] = [];

                        // 添加文本内容和上下文
                        let textContent = originalContent;
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                        contentParts.push({ type: 'text', text: textContent });

                        // 添加图片
                        msg.attachments?.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data },
                                });
                            }
                        });

                        // 添加文本文件内容
                        const fileTexts = msg.attachments
                            ?.filter(att => att.type === 'file')
                            .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                            .join('\n\n---\n\n');

                        if (fileTexts) {
                            contentParts.push({
                                type: 'text',
                                text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                            });
                        }

                        baseMsg.content = contentParts;
                    } else {
                        // 纯文本格式
                        let enhancedContent = originalContent;

                        // 添加文本文件附件
                        if (msg.attachments && msg.attachments.length > 0) {
                            const attachmentTexts = msg.attachments
                                .map(att => {
                                    if (att.type === 'file') {
                                        return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                    }
                                    return '';
                                })
                                .filter(Boolean)
                                .join('\n\n---\n\n');

                            if (attachmentTexts) {
                                enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                            }
                        }

                        // 添加上下文文档
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;

                        baseMsg.content = enhancedContent;
                    }
                }

                return baseMsg;
            });

        // 处理最后一条用户消息，添加附件和上下文文档
        if (messagesToSend.length > 0) {
            const lastMessage = messagesToSend[messagesToSend.length - 1];
            if (lastMessage.role === 'user') {
                const lastUserMessage = messages[messages.length - 1];
                const hasImages = lastUserMessage.attachments?.some(att => att.type === 'image');

                // 查找上一条assistant消息是否有生成的图片（用于图片编辑）
                let previousGeneratedImages: any[] = [];
                const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                    // 检查generatedImages或attachments中的图片
                    if (
                        lastAssistantMsg.generatedImages &&
                        lastAssistantMsg.generatedImages.length > 0
                    ) {
                        // 从路径加载图片并转换为 blob URL
                        previousGeneratedImages = await Promise.all(
                            lastAssistantMsg.generatedImages.map(async img => {
                                let imageUrl = '';
                                if (img.path) {
                                    // 从路径加载图片
                                    imageUrl = (await loadAsset(img.path)) || '';
                                } else if (img.data) {
                                    // 兼容旧数据（base64格式）
                                    imageUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
                                }
                                return {
                                    type: 'image_url' as const,
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (
                        lastAssistantMsg.attachments &&
                        lastAssistantMsg.attachments.length > 0
                    ) {
                        // 从附件中获取图片
                        const imageAttachments = lastAssistantMsg.attachments.filter(
                            att => att.type === 'image'
                        );
                        previousGeneratedImages = await Promise.all(
                            imageAttachments.map(async att => {
                                let imageUrl = att.data;
                                // 如果附件有路径且当前data不可用，从路径重新加载
                                if (att.path && (!imageUrl || !imageUrl.startsWith('blob:'))) {
                                    imageUrl = (await loadAsset(att.path)) || att.data;
                                }
                                return {
                                    type: 'image_url' as const,
                                    image_url: { url: imageUrl },
                                };
                            })
                        );
                    } else if (typeof lastAssistantMsg.content === 'string') {
                        // 从Markdown内容中提取图片 ![alt](url)
                        const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
                        const content = lastAssistantMsg.content;
                        let match;
                        while ((match = imageRegex.exec(content)) !== null) {
                            const url = match[1];
                            // 处理 assets 路径的图片
                            if (
                                url.startsWith('/data/storage/petal/siyuan-plugin-copilot/assets/')
                            ) {
                                try {
                                    const blobUrl = await loadAsset(url);
                                    if (blobUrl) {
                                        previousGeneratedImages.push({
                                            type: 'image_url' as const,
                                            image_url: { url: blobUrl },
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to load asset image:', error);
                                }
                            } else if (url.startsWith('http://') || url.startsWith('https://')) {
                                // HTTP/HTTPS URL 直接使用
                                previousGeneratedImages.push({
                                    type: 'image_url' as const,
                                    image_url: { url: url },
                                });
                            }
                        }
                    }
                }

                // 如果有图片附件或上一条有生成的图片，使用多模态格式
                if (hasImages || previousGeneratedImages.length > 0) {
                    const contentParts: any[] = [];

                    // 先添加用户输入
                    let textContent =
                        typeof lastUserMessage.content === 'string'
                            ? lastUserMessage.content
                            : getMessageText(lastUserMessage.content);

                    // 然后添加上下文文档（如果有）
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        textContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    contentParts.push({ type: 'text', text: textContent });

                    // 添加用户上传的图片
                    lastUserMessage.attachments?.forEach(att => {
                        if (att.type === 'image') {
                            contentParts.push({
                                type: 'image_url',
                                image_url: { url: att.data },
                            });
                        }
                    });

                    // 添加上一次生成的图片（用于图片编辑）
                    previousGeneratedImages.forEach(img => {
                        contentParts.push(img);
                    });

                    // 添加文本文件内容
                    const fileTexts = lastUserMessage.attachments
                        ?.filter(att => att.type === 'file')
                        .map(att => `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`)
                        .join('\n\n---\n\n');

                    if (fileTexts) {
                        contentParts.push({
                            type: 'text',
                            text: `\n\n以下是附件文件内容：\n\n${fileTexts}`,
                        });
                    }

                    lastMessage.content = contentParts;
                } else {
                    // 纯文本格式
                    let enhancedContent =
                        typeof lastUserMessage.content === 'string'
                            ? lastUserMessage.content
                            : getMessageText(lastUserMessage.content);

                    // 添加文本文件附件
                    if (lastUserMessage.attachments && lastUserMessage.attachments.length > 0) {
                        const attachmentTexts = lastUserMessage.attachments
                            .map(att => {
                                if (att.type === 'file') {
                                    return `## 文件: ${att.name}\n\n\`\`\`\n${att.data}\n\`\`\`\n`;
                                }
                                return '';
                            })
                            .filter(Boolean)
                            .join('\n\n---\n\n');

                        if (attachmentTexts) {
                            enhancedContent += `\n\n---\n\n以下是附件内容：\n\n${attachmentTexts}`;
                        }
                    }

                    // 添加上下文文档
                    if (contextDocumentsWithLatestContent.length > 0) {
                        const contextText = contextDocumentsWithLatestContent
                            .map(doc => {
                                const label = doc.type === 'doc' ? '文档' : '块';
                                return `## ${label}: ${doc.title}\n\n**BlockID**: \`${doc.id}\`\n\n\`\`\`markdown\n${doc.content}\n\`\`\``;
                            })
                            .join('\n\n---\n\n');
                        enhancedContent += `\n\n---\n\n以下是相关内容作为上下文：\n\n${contextText}`;
                    }

                    lastMessage.content = enhancedContent;
                }
            }
        }

        if (settings.aiSystemPrompt) {
            messagesToSend.unshift({ role: 'system', content: settings.aiSystemPrompt });
        }

        // 使用临时系统提示词（如果设置了）
        if (tempModelSettings.systemPrompt.trim()) {
            // 如果已有系统提示词，替换它；否则添加新的
            const systemMsgIndex = messagesToSend.findIndex(msg => msg.role === 'system');
            if (systemMsgIndex !== -1) {
                messagesToSend[systemMsgIndex].content = tempModelSettings.systemPrompt;
            } else {
                messagesToSend.unshift({ role: 'system', content: tempModelSettings.systemPrompt });
            }
        }

        // 创建新的 AbortController
        abortController = new AbortController();

        const providerConfig = getCurrentProviderConfig();
        const modelConfig = getCurrentModelConfig();

        if (!providerConfig || !modelConfig) {
            pushErrMsg(t('aiSidebar.errors.noProvider'));
            isLoading = false;
            return;
        }

        // 解析自定义参数
        let customBody = {};
        if (modelConfig.customBody) {
            try {
                customBody = JSON.parse(modelConfig.customBody);
            } catch (e) {
                console.error('Failed to parse custom body:', e);
                pushErrMsg('自定义参数 JSON 格式错误');
                isLoading = false;
                return;
            }
        }

        try {
            const enableThinking =
                modelConfig.capabilities?.thinking && (modelConfig.thinkingEnabled || false);

            // 检查是否启用图片生成
            const enableImageGeneration = modelConfig.capabilities?.imageGeneration || false;

            // 用于保存生成的图片
            let generatedImages: any[] = [];

            await chat(
                currentProvider,
                {
                    apiKey: providerConfig.apiKey,
                    model: modelConfig.id,
                    messages: messagesToSend,
                    temperature: tempModelSettings.temperatureEnabled
                        ? tempModelSettings.temperature
                        : modelConfig.temperature,
                    maxTokens: modelConfig.maxTokens > 0 ? modelConfig.maxTokens : undefined,
                    stream: true,
                    signal: abortController.signal,
                    customBody,
                    enableThinking,
                    reasoningEffort: modelConfig.thinkingEffort || 'low',
                    enableImageGeneration,
                    onThinkingChunk: enableThinking
                        ? (chunk: string) => {
                              isThinkingPhase = true;
                              streamingThinking += chunk;
                              scheduleScrollToBottom();
                          }
                        : undefined,
                    onThinkingComplete: enableThinking
                        ? (thinking: string) => {
                              isThinkingPhase = false;
                              thinkingCollapsed[messages.length] = true;
                          }
                        : undefined,
                    onImageGenerated: async (images: any[]) => {
                        // 立即保存生成的图片到 SiYuan 资源文件夹并转换为 blob URL
                        generatedImages = await Promise.all(
                            images.map(async (img, idx) => {
                                const blob = base64ToBlob(img.data, img.mimeType || 'image/png');
                                const name = `generated-image-${Date.now()}-${idx + 1}.${
                                    img.mimeType?.split('/')[1] || 'png'
                                }`;
                                const assetPath = await saveAsset(blob, name);
                                return {
                                    ...img,
                                    path: assetPath,
                                    // 给前端显示用的 blob url
                                    previewUrl: URL.createObjectURL(blob),
                                };
                            })
                        );
                    },
                    onChunk: (chunk: string) => {
                        streamingMessage += chunk;
                        scheduleScrollToBottom();
                    },
                    onComplete: async (fullText: string) => {
                        // 如果已经中断，不再添加消息（避免重复）
                        if (isAborted) {
                            return;
                        }

                        // 转换 LaTeX 数学公式格式为 Markdown 格式
                        const convertedText = convertLatexToMarkdown(fullText);

                        // 处理content中的base64图片，保存为assets文件
                        const processedContent = await saveBase64ImagesInContent(convertedText);

                        const assistantMessage: Message = {
                            role: 'assistant',
                            content: processedContent,
                        };

                        if (enableThinking && streamingThinking) {
                            assistantMessage.thinking = streamingThinking;
                        }

                        // 如果有生成的图片，保存到消息中
                        if (generatedImages.length > 0) {
                            // 保存图片信息（不包含base64数据，只保存路径）
                            assistantMessage.generatedImages = generatedImages.map(img => ({
                                mimeType: img.mimeType,
                                data: '', // 不保存base64数据，节省空间
                                path: img.path,
                            }));

                            // 添加为附件以便显示（使用blob URL）
                            assistantMessage.attachments = generatedImages.map((img, idx) => ({
                                type: 'image' as const,
                                name: `generated-image-${idx + 1}.${
                                    img.mimeType?.split('/')[1] || 'png'
                                }`,
                                data: img.previewUrl, // 使用 blob URL 显示
                                path: img.path, // 保存路径用于持久化
                                mimeType: img.mimeType || 'image/png',
                            }));
                        }

                        messages = [...messages, assistantMessage];
                        streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                        streamingSearchCalls = [];
                        isThinkingPhase = false;
                        isLoading = false;
                        abortController = null;
                        hasUnsavedChanges = true;

                        // AI 回复完成后，自动保存当前会话
                        await saveCurrentSession(true);
                    },
                    onError: (error: Error) => {
                        if (error.message !== 'Request aborted') {
                            // 将错误消息作为一条 assistant 消息添加
                            const errorMessage: Message = {
                                role: 'assistant',
                                content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${error.message}`,
                            };
                            messages = [...messages, errorMessage];
                            hasUnsavedChanges = true;
                        }
                        isLoading = false;
                        streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                        streamingSearchCalls = [];
                        isThinkingPhase = false;
                        abortController = null;
                    },
                },
                providerConfig.customApiUrl,
                providerConfig.advancedConfig
            );
        } catch (error) {
            console.error('Regenerate message error:', error);
            // onError 回调已经处理了错误消息的添加，这里不需要重复添加
            if ((error as Error).name === 'AbortError') {
                // 中断错误已经在 abortMessage 中处理
            } else if (!isLoading) {
                // 如果 isLoading 已经是 false，说明 onError 已经被调用并处理了
                // 不需要做任何事情
            } else {
                // 如果 isLoading 还是 true，说明 onError 没有被调用
                // 这种情况下才需要添加错误消息
                const errorMessage: Message = {
                    role: 'assistant',
                    content: `❌ **${t('aiSidebar.errors.requestFailed')}**\n\n${(error as Error).message}`,
                };
                messages = [...messages, errorMessage];
                hasUnsavedChanges = true;
                isLoading = false;
                streamingMessage = '';
 streamingThinking = '';
 streamingCodexTimeline = [];
 streamingToolCalls = [];
                streamingSearchCalls = [];
                isThinkingPhase = false;
            }
            abortController = null;
        }
    }

    // 将消息数组分组，合并连续的 AI 相关消息
    interface MessageGroup {
        type: 'user' | 'assistant';
        messages: Message[];
        startIndex: number; // 原始消息数组中的起始索引
    }

    let messageGroups: MessageGroup[] = [];
    let groupedMessagesSnapshot: Message[] = [];

    function groupMessages(messages: Message[]): MessageGroup[] {
        const groups: MessageGroup[] = [];
        let currentGroup: MessageGroup | null = null;

        messages.forEach((message, index) => {
            // 跳过 system 消息
            if (message.role === 'system') {
                return;
            }

            if (message.role === 'user') {
                // 用户消息：结束当前组，开始新的用户组
                if (currentGroup) {
                    groups.push(currentGroup);
                }
                currentGroup = {
                    type: 'user',
                    messages: [message],
                    startIndex: index,
                };
            } else if (message.role === 'assistant' || message.role === 'tool') {
                // AI 或工具消息
                if (!currentGroup || currentGroup.type === 'user') {
                    // 如果没有当前组或当前组是用户组，结束当前组并开始新的 AI 组
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        type: 'assistant',
                        messages: [message],
                        startIndex: index,
                    };
                } else {
                    // 继续添加到当前 AI 组
                    currentGroup.messages.push(message);
                }
            }
        });

        // 添加最后一个组
        if (currentGroup) {
            groups.push(currentGroup);
        }

        return groups;
    }

    function getMessageGroupType(message: Message): MessageGroup['type'] | null {
        if (message.role === 'system') return null;
        if (message.role === 'user') return 'user';
        if (message.role === 'assistant' || message.role === 'tool') return 'assistant';
        return null;
    }

    function appendGroupedMessage(
        groups: MessageGroup[],
        message: Message,
        index: number
    ): MessageGroup[] {
        const type = getMessageGroupType(message);
        if (!type) return groups;

        if (!groups.length) {
            return [{ type, messages: [message], startIndex: index }];
        }

        const lastGroup = groups[groups.length - 1];
        // 与原有 groupMessages 行为保持一致：user 永远单独成组；assistant/tool 连续合并
        if (type === 'assistant' && lastGroup.type === 'assistant') {
            return [
                ...groups.slice(0, -1),
                {
                    ...lastGroup,
                    messages: [...lastGroup.messages, message],
                },
            ];
        }

        return [...groups, { type, messages: [message], startIndex: index }];
    }

    function computeMessageGroups(nextMessages: Message[]): MessageGroup[] {
        const previousMessages = groupedMessagesSnapshot;
        const previousGroups = messageGroups;
        const prevLen = previousMessages.length;
        const nextLen = nextMessages.length;
        const commonLen = Math.min(prevLen, nextLen);

        let divergedAt = commonLen;
        for (let i = 0; i < commonLen; i++) {
            if (previousMessages[i] !== nextMessages[i]) {
                divergedAt = i;
                break;
            }
        }

        // 仅触发了 messages = [...messages] 这类浅拷贝时，直接复用已有分组，避免全量重算
        if (divergedAt === commonLen && prevLen === nextLen) {
            groupedMessagesSnapshot = nextMessages;
            return previousGroups;
        }

        // append-only 场景增量补分组，避免每次新增消息都全量 groupMessages
        if (divergedAt === prevLen && nextLen > prevLen) {
            let nextGroups = previousGroups;
            for (let i = prevLen; i < nextLen; i++) {
                nextGroups = appendGroupedMessage(nextGroups, nextMessages[i], i);
            }
            groupedMessagesSnapshot = nextMessages;
            return nextGroups;
        }

        // 其余场景（中间编辑/删除/重排）回退全量分组，保证行为正确
        const regrouped = groupMessages(nextMessages);
        groupedMessagesSnapshot = nextMessages;
        return regrouped;
    }

    function getCodexTraceText(
        text: string | null | undefined,
        maxLines = 24,
        maxChars = 2400
    ): string {
        void maxLines;
        void maxChars;
        return normalizeThinkingText(String(text || '')).replace(/\r\n/g, '\n');
    }

    function getEditOperationDisplayTexts(operation: EditOperation): {
        oldText: string;
        newText: string;
    } {
        const operationType = operation.operationType || 'update';
        const oldText =
            operationType === 'insert'
                ? ''
                : String(operation.oldContentForDisplay || operation.oldContent || '');
        const newText = String(
            operation.newContentForDisplay ||
                stripKramdownIdMarkersForDisplay(operation.newContent || '')
        );
        return { oldText, newText };
    }

    const SIYUAN_BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]+$/i;
    const editOperationBlockFilePathCache = new Map<string, string>();
    const editOperationBlockFilePathTasks = new Map<string, Promise<string>>();

    function normalizeDocFilePath(notebook: string, path: string): string {
        const box = String(notebook || '').trim();
        const rawPath = String(path || '').trim().replace(/^\/+/, '');
        if (!box || !rawPath) return '';
        return `${box}/${rawPath}`;
    }

    function normalizeDocDisplayPath(notebook: string, hpath: string): string {
        const box = String(notebook || '').trim();
        const rawPath = String(hpath || '').trim().replace(/^\/+/, '');
        if (!box || !rawPath) return '';
        return `${box}/${rawPath}`;
    }

    async function resolveDocFilePathFromBlockId(rawBlockId: unknown): Promise<string> {
        const blockId = String(rawBlockId || '').trim();
        if (!blockId) return '';

        if (blockId.includes(':') && !SIYUAN_BLOCK_ID_PATTERN.test(blockId)) {
            const sepIdx = blockId.indexOf(':');
            if (sepIdx > 0) {
                const notebook = blockId.slice(0, sepIdx).trim();
                const path = blockId.slice(sepIdx + 1).trim();
                return normalizeDocFilePath(notebook, path);
            }
        }

        if (!SIYUAN_BLOCK_ID_PATTERN.test(blockId)) return '';

        const cachedPath = editOperationBlockFilePathCache.get(blockId);
        if (cachedPath) return cachedPath;

        const existingTask = editOperationBlockFilePathTasks.get(blockId);
        if (existingTask) return existingTask;

        const task = (async () => {
            try {
                const block = await getBlockByID(blockId);
                if (!block) return '';
                const docId =
                    String(block.type || '').toLowerCase() === 'd'
                        ? String(block.id || '').trim()
                        : String(block.root_id || '').trim();
                if (!docId) return '';

                let docBlock = block;
                if (
                    String(docBlock.id || '').trim() !== docId ||
                    String(docBlock.type || '').toLowerCase() !== 'd'
                ) {
                    const root = await getBlockByID(docId);
                    if (root) docBlock = root;
                }

                const resolvedPath = normalizeDocFilePath(
                    String(docBlock.box || block.box || ''),
                    String(docBlock.path || block.path || '')
                );
                const displayPath = normalizeDocDisplayPath(
                    String(docBlock.box || block.box || ''),
                    String(docBlock.hpath || block.hpath || '')
                );
                const finalPath = displayPath || resolvedPath;
                if (finalPath) {
                    editOperationBlockFilePathCache.set(blockId, finalPath);
                }
                return finalPath;
            } catch {
                return '';
            } finally {
                editOperationBlockFilePathTasks.delete(blockId);
            }
        })();

        editOperationBlockFilePathTasks.set(blockId, task);
        return task;
    }

    async function ensureEditOperationFilePath(operation: EditOperation | null | undefined): Promise<void> {
        if (!operation) return;
        const explicitPath = normalizeEditOperationFilePath(operation.filePath);
        if (explicitPath) {
            operation.filePath = explicitPath;
            return;
        }
        const resolvedPath = await resolveDocFilePathFromBlockId(operation.blockId);
        if (resolvedPath) {
            operation.filePath = resolvedPath;
        }
    }

    async function ensureEditOperationFilePaths(
        operations: EditOperation[] | null | undefined
    ): Promise<void> {
        if (!Array.isArray(operations) || operations.length === 0) return;
        await Promise.allSettled(operations.map(operation => ensureEditOperationFilePath(operation)));
    }

    async function ensureTraceEditOperationFilePaths(
        traces: CodexTraceCall[] | null | undefined
    ): Promise<void> {
        if (!Array.isArray(traces) || traces.length === 0) return;
        const tasks: Promise<void>[] = [];
        for (const trace of traces) {
            if (trace?.editOperations?.length) {
                tasks.push(ensureEditOperationFilePaths(trace.editOperations));
            }
        }
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }

    function collectMessageEditOperations(message: Message | null | undefined): EditOperation[] {
        if (!message || typeof message !== 'object') return [];
        const operations: EditOperation[] = [];
        if (Array.isArray(message.editOperations)) {
            operations.push(...message.editOperations);
        }
        const traceCollections: Array<CodexTraceCall[] | undefined> = [
            message.codexTimeline,
            message.codexSearchCalls,
            message.codexToolCalls,
        ];
        for (const traces of traceCollections) {
            if (!Array.isArray(traces)) continue;
            for (const trace of traces) {
                if (Array.isArray(trace?.editOperations)) {
                    operations.push(...trace.editOperations);
                }
            }
        }
        return operations;
    }

    function countMissingEditOperationFilePaths(
        operations: EditOperation[] | null | undefined
    ): number {
        if (!Array.isArray(operations) || operations.length === 0) return 0;
        return operations.reduce((count, operation) => {
            return normalizeEditOperationFilePath(operation?.filePath) ? count : count + 1;
        }, 0);
    }

    async function ensureMessagesEditOperationFilePaths(
        sourceMessages: Message[] | null | undefined
    ): Promise<boolean> {
        if (!Array.isArray(sourceMessages) || sourceMessages.length === 0) return false;
        const allOperations = sourceMessages.flatMap(message => collectMessageEditOperations(message));
        if (allOperations.length === 0) return false;
        const missingBefore = countMissingEditOperationFilePaths(allOperations);
        if (missingBefore === 0) return false;
        await ensureEditOperationFilePaths(allOperations);
        const missingAfter = countMissingEditOperationFilePaths(allOperations);
        return missingAfter < missingBefore;
    }

    type EditOperationFileGroup = {
        fileKey: string;
        fileLabel: string;
        operations: EditOperation[];
        oldCombined: string;
        newCombined: string;
        added: number;
        removed: number;
        pendingCount: number;
        appliedCount: number;
        rejectedCount: number;
    };

    function getEditOperationFileKey(operation: EditOperation): string {
        const explicitPath = normalizeEditOperationFilePath(operation.filePath);
        if (explicitPath) return explicitPath;
        const rawBlockId = String(operation.blockId || '').trim();
        if (!rawBlockId) return 'note/unknown';
        const cachedFilePath = editOperationBlockFilePathCache.get(rawBlockId);
        if (cachedFilePath) return cachedFilePath;
        if (rawBlockId.includes(':') && !/^\d{14}-[a-z0-9]+$/i.test(rawBlockId)) {
            return rawBlockId.replace(':', '/');
        }
        if (/^\d{14}-[a-z0-9]+$/i.test(rawBlockId)) {
            return `note/${rawBlockId}`;
        }
        return 'note/unknown';
    }

    function extractMarkdownTitleFromText(rawText: string): string {
        const text = String(rawText || '').trim();
        if (!text) return '';
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const heading = trimmed.match(/^#\s+(.+)$/);
            if (heading?.[1]) {
                return heading[1].trim();
            }
            break;
        }
        return '';
    }

    function getEditOperationFileLabel(fileKey: string, operations: EditOperation[]): string {
        for (const operation of operations) {
            const { oldText, newText } = getEditOperationDisplayTexts(operation);
            const title = extractMarkdownTitleFromText(newText) || extractMarkdownTitleFromText(oldText);
            if (title) return title;
        }

        const normalized = normalizeEditOperationFilePath(fileKey);
        if (normalized && normalized !== 'note/unknown') {
            const slashIdx = normalized.indexOf('/');
            if (slashIdx > -1 && slashIdx < normalized.length - 1) {
                const tail = normalized.slice(slashIdx + 1).replace(/\.sy$/i, '');
                const segs = tail.split('/').filter(Boolean);
                return segs.length > 0 ? segs[segs.length - 1] : tail;
            }
            const cleaned = normalized.replace(/\.sy$/i, '');
            const segs = cleaned.split('/').filter(Boolean);
            return segs.length > 0 ? segs[segs.length - 1] : cleaned;
        }

        const blockId = operations
            .map(operation => String(operation.blockId || '').trim())
            .find(id => !!id && id !== 'unknown');
        if (blockId) return blockId;
        return 'note/unknown';
    }

    function getTraceDiffFileNameSummary(
        operations: EditOperation[] | null | undefined,
        maxNames = 2
    ): string {
        const source = Array.isArray(operations) ? operations : [];
        if (!source.length) return '';
        const grouped = new Map<string, EditOperation[]>();
        for (const operation of source) {
            const key = getEditOperationFileKey(operation);
            const list = grouped.get(key) || [];
            list.push(operation);
            grouped.set(key, list);
        }
        const labels = Array.from(grouped.entries())
            .map(([key, groupOps]) => getEditOperationFileLabel(key, groupOps))
            .filter(Boolean);
        const uniqueLabels = Array.from(new Set(labels));
        if (!uniqueLabels.length) return '';
        const head = uniqueLabels.slice(0, maxNames).join('、');
        return uniqueLabels.length > maxNames ? `${head}...` : head;
    }

    type FocusedDiffTexts = {
        oldText: string;
        newText: string;
        added: number;
        removed: number;
    };

    function buildFocusedDiffTexts(
        oldText: string,
        newText: string,
        maxLines = 64
    ): FocusedDiffTexts {
        const allLines = generateSimpleDiff(String(oldText || ''), String(newText || ''));
        let added = 0;
        let removed = 0;
        for (const line of allLines) {
            if (line.type === 'added') added += 1;
            else if (line.type === 'removed') removed += 1;
        }
        const focusedLines = compactTraceDiffLines(allLines, maxLines);
        const oldFocused: string[] = [];
        const newFocused: string[] = [];
        for (const line of focusedLines) {
            if (line.type === 'removed') {
                oldFocused.push(line.line);
                continue;
            }
            if (line.type === 'added') {
                newFocused.push(line.line);
                continue;
            }
            oldFocused.push(line.line);
            newFocused.push(line.line);
        }
        return {
            oldText: oldFocused.join('\n').trimEnd(),
            newText: newFocused.join('\n').trimEnd(),
            added,
            removed,
        };
    }

    function buildEditOperationAggregationKey(operation: EditOperation): string {
        const fileKey = getEditOperationFileKey(operation);
        const operationType = operation.operationType || 'update';
        const blockId = String(operation.blockId || '').trim() || 'unknown';
        const position = String(operation.position || '');
        if (operationType === 'insert') {
            const content = String(operation.newContentForDisplay || operation.newContent || '');
            return `${fileKey}|${operationType}|${position}|${blockId}|${content.length}|${content.slice(0, 160)}`;
        }
        return `${fileKey}|${operationType}|${position}|${blockId}`;
    }

    function mergeEditOperationsForDiff(operations: EditOperation[]): EditOperation[] {
        if (!operations.length) return [];
        const merged: EditOperation[] = [];
        const keyToIndex = new Map<string, number>();
        for (const operation of operations) {
            const key = buildEditOperationAggregationKey(operation);
            const existingIndex = keyToIndex.get(key);
            if (existingIndex === undefined) {
                merged.push(cloneEditOperation(operation));
                keyToIndex.set(key, merged.length - 1);
                continue;
            }

            const existing = merged[existingIndex];
            if (!String(existing.oldContent || '').trim() && String(operation.oldContent || '').trim()) {
                existing.oldContent = operation.oldContent;
            }
            if (
                !String(existing.oldContentForDisplay || '').trim() &&
                String(operation.oldContentForDisplay || '').trim()
            ) {
                existing.oldContentForDisplay = operation.oldContentForDisplay;
            }

            if (String(operation.newContent || '').trim()) {
                existing.newContent = operation.newContent;
            }
            if (String(operation.newContentForDisplay || '').trim()) {
                existing.newContentForDisplay = operation.newContentForDisplay;
            }

            if (operation.operationType === 'insert' && operation.position) {
                existing.position = operation.position;
            }
        }
        return merged;
    }

    function buildMergedEditOperationTexts(operations: EditOperation[]): {
        oldText: string;
        newText: string;
        added: number;
        removed: number;
    } {
        if (!operations.length) return { oldText: '', newText: '', added: 0, removed: 0 };

        const mergedOperations = mergeEditOperationsForDiff(operations);
        const focusedSummaries = mergedOperations
            .map(operation => {
                const { oldText, newText } = getEditOperationDisplayTexts(operation);
                return buildFocusedDiffTexts(oldText, newText, 64);
            })
            .filter(summary => {
                return (
                    summary.added > 0 ||
                    summary.removed > 0 ||
                    String(summary.oldText || '').trim() ||
                    String(summary.newText || '').trim()
                );
            });

        if (!focusedSummaries.length) {
            return { oldText: '', newText: '', added: 0, removed: 0 };
        }

        if (focusedSummaries.length === 1) {
            const only = focusedSummaries[0];
            return {
                oldText: only.oldText,
                newText: only.newText,
                added: only.added,
                removed: only.removed,
            };
        }

        const oldParts: string[] = [];
        const newParts: string[] = [];
        let added = 0;
        let removed = 0;
        focusedSummaries.forEach((summary, index) => {
            const sectionTitle = `@@ change ${index + 1} @@`;
            oldParts.push(sectionTitle);
            newParts.push(sectionTitle);
            oldParts.push(summary.oldText || '');
            newParts.push(summary.newText || '');
            added += summary.added;
            removed += summary.removed;
        });

        return {
            oldText: oldParts.join('\n\n').trim(),
            newText: newParts.join('\n\n').trim(),
            added,
            removed,
        };
    }

    function compactTraceDiffLines(
        lines: { type: 'removed' | 'added' | 'unchanged'; line: string }[],
        maxLines: number
    ): { type: 'removed' | 'added' | 'unchanged'; line: string }[] {
        if (!Array.isArray(lines) || lines.length === 0) return [];
        if (maxLines <= 0 || lines.length <= maxLines) return lines;

        const changedIndices: number[] = [];
        for (let i = 0; i < lines.length; i += 1) {
            if (lines[i].type !== 'unchanged') changedIndices.push(i);
        }
        if (!changedIndices.length) {
            return lines.slice(0, maxLines);
        }

        const context = 1;
        const picked = new Set<number>();
        for (const idx of changedIndices) {
            for (
                let cursor = Math.max(0, idx - context);
                cursor <= Math.min(lines.length - 1, idx + context);
                cursor += 1
            ) {
                picked.add(cursor);
            }
        }

        const sorted = Array.from(picked).sort((a, b) => a - b);
        const compacted: { type: 'removed' | 'added' | 'unchanged'; line: string }[] = [];
        let prev = -2;
        for (const idx of sorted) {
            if (idx - prev > 1) {
                compacted.push({ type: 'unchanged', line: '...' });
            }
            compacted.push(lines[idx]);
            prev = idx;
        }

        if (compacted.length <= maxLines) return compacted;
        return compacted.slice(0, maxLines);
    }

    function buildEditOperationFileGroups(
        operations: EditOperation[] | null | undefined
    ): EditOperationFileGroup[] {
        const source = Array.isArray(operations) ? operations : [];
        if (!source.length) return [];
        const grouped = new Map<string, EditOperationFileGroup>();
        for (const operation of source) {
            const fileKey = getEditOperationFileKey(operation);
            const fileLabel = fileKey || 'unknown';
            let group = grouped.get(fileKey);
            if (!group) {
                group = {
                    fileKey,
                    fileLabel,
                    operations: [],
                    oldCombined: '',
                    newCombined: '',
                    added: 0,
                    removed: 0,
                    pendingCount: 0,
                    appliedCount: 0,
                    rejectedCount: 0,
                };
                grouped.set(fileKey, group);
            }
            group.operations.push(operation);
            if (operation.status === 'applied') group.appliedCount += 1;
            else if (operation.status === 'rejected') group.rejectedCount += 1;
            else group.pendingCount += 1;
        }
        for (const group of grouped.values()) {
            group.fileLabel = getEditOperationFileLabel(group.fileKey, group.operations);
            const mergedTexts = buildMergedEditOperationTexts(group.operations);
            group.oldCombined = mergedTexts.oldText;
            group.newCombined = mergedTexts.newText;
            group.added = mergedTexts.added;
            group.removed = mergedTexts.removed;
        }
        return Array.from(grouped.values());
    }

    function getEditOperationFileGroupStatus(
        group: EditOperationFileGroup
    ): 'pending' | 'applied' | 'rejected' | 'mixed' {
        if (group.pendingCount > 0 && group.appliedCount === 0 && group.rejectedCount === 0)
            return 'pending';
        if (group.appliedCount > 0 && group.pendingCount === 0 && group.rejectedCount === 0)
            return 'applied';
        if (group.rejectedCount > 0 && group.pendingCount === 0 && group.appliedCount === 0)
            return 'rejected';
        return 'mixed';
    }

    async function applyEditOperationFileGroup(group: EditOperationFileGroup, messageIndex: number) {
        for (const operation of group.operations) {
            if (operation.status !== 'pending') continue;
            await applyEditOperation(operation, messageIndex);
        }
    }

    function rejectEditOperationFileGroup(group: EditOperationFileGroup, messageIndex: number) {
        for (const operation of group.operations) {
            if (operation.status !== 'pending') continue;
            rejectEditOperation(operation, messageIndex);
        }
    }

    function viewEditOperationFileGroupDiff(group: EditOperationFileGroup) {
        if (!group.operations.length) return;
        const first = group.operations[0];
        const hasOld = String(group.oldCombined || '').trim().length > 0;
        const hasNew = String(group.newCombined || '').trim().length > 0;
        const operationType: 'update' | 'insert' = hasOld || !hasNew ? 'update' : 'insert';
        currentDiffOperation = {
            ...first,
            operationType,
            blockId: first.blockId || group.fileLabel || 'unknown',
            filePath: group.fileLabel,
            status: first.status,
            oldContent: group.oldCombined,
            oldContentForDisplay: group.oldCombined,
            newContent: group.newCombined,
            newContentForDisplay: group.newCombined,
        };
        resetDiffDialogViewState();
        isDiffDialogOpen = true;
        tick().then(() => diffDialogCloseButton?.focus());
        if (currentDiffOperation) {
            void loadDiffDialogPreferredLines(currentDiffOperation);
        }
    }

    function getTraceEditFileGroupLines(
        group: EditOperationFileGroup,
        maxLines = 14
    ): { type: 'removed' | 'added' | 'unchanged'; line: string }[] {
        const lines = generateSimpleDiff(String(group.oldCombined || ''), String(group.newCombined || ''));
        return compactTraceDiffLines(lines, maxLines);
    }

    function getTraceEditOperationStats(
        operations: EditOperation[] | null | undefined
    ): { added: number; removed: number; changed: number } {
        const fileGroups = buildEditOperationFileGroups(operations);
        if (!fileGroups.length) {
            return { added: 0, removed: 0, changed: 0 };
        }
        let added = 0;
        let removed = 0;
        for (const group of fileGroups) {
            added += Number(group.added || 0);
            removed += Number(group.removed || 0);
        }
        return { added, removed, changed: added + removed };
    }

    function buildCodexTraceKeyPart(trace: CodexTraceCall, traceIdx: number): string {
        const raw = firstNonEmptyString(trace.id, trace.name, trace.eventType, String(traceIdx));
        return raw.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 140);
    }

    function buildHistoryCodexTraceExpandKey(
        section: 'timeline' | 'search' | 'tool',
        messageSequence: number,
        trace: CodexTraceCall,
        traceIdx: number
    ): string {
        return `history_${section}_${messageSequence}_${trace.kind || 'tool'}_${buildCodexTraceKeyPart(trace, traceIdx)}_${traceIdx}`;
    }

    function buildStreamingCodexTraceExpandKey(
        section: 'timeline' | 'search' | 'tool',
        trace: CodexTraceCall,
        traceIdx: number
    ): string {
        return `stream_${section}_${trace.kind || 'tool'}_${buildCodexTraceKeyPart(trace, traceIdx)}_${traceIdx}`;
    }

    function toggleCodexTraceExpanded(key: string) {
        if (!key) return;
        const currentState = codexTraceExpanded[key] ?? false;
        codexTraceExpanded = {
            ...codexTraceExpanded,
            [key]: !currentState,
        };
    }

    // 响应式计算消息组（append-only 和浅拷贝场景走增量/复用）
    $: messageGroups = computeMessageGroups(messages);
</script>

<div class="ai-sidebar" class:ai-sidebar--fullscreen={isFullscreen} bind:this={sidebarContainer}>
    <div class="ai-sidebar__header">
        <h3 class="ai-sidebar__title">
            <span>Codex</span>
            {#if hasUnsavedChanges}
                <span class="ai-sidebar__unsaved" title={t('aiSidebar.unsavedChanges')}>●</span>
            {/if}
        </h3>

        <div class="ai-sidebar__actions">
            <button
                class="b3-button b3-button--text"
                on:click={newSession}
                title={t('aiSidebar.session.new')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
            </button>
            <SessionManager
                bind:sessions
                bind:currentSessionId
                bind:isOpen={isSessionManagerOpen}
                loadSessionMessages={loadSessionMessagesForExport}
                on:refresh={loadSessions}
                on:load={e => loadSession(e.detail.sessionId)}
                on:delete={e => deleteSession(e.detail.sessionId)}
                on:batchDelete={e => batchDeleteSessions(e.detail.sessionIds)}
                on:new={newSession}
                on:update={e => handleSessionUpdate(e.detail.sessions)}
            />
            <button
                class="b3-button b3-button--text"
                on:click={copyAsMarkdown}
                title={t('aiSidebar.actions.copyAllChat')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={clearChat}
                title={t('aiSidebar.actions.clear')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <div class="ai-sidebar__open-window-menu-container" style="position: relative;">
                <button
                    class="b3-button b3-button--text"
                    bind:this={openWindowMenuButton}
                    on:click={toggleOpenWindowMenu}
                    title={t('aiSidebar.actions.openInNewWindow')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconOpenWindow"></use></svg>
                </button>
                {#if showOpenWindowMenu}
                    <div class="ai-sidebar__open-window-menu">
                        <button class="b3-menu__item" on:click={openInTab}>
                            <svg class="b3-menu__icon">
                                <use xlink:href="#iconOpenWindow"></use>
                            </svg>
                            <span class="b3-menu__label">{t('aiSidebar.actions.openInTab')}</span>
                        </button>
                        <button class="b3-menu__item" on:click={openInNewWindow}>
                            <svg class="b3-menu__icon">
                                <use xlink:href="#iconOpenWindow"></use>
                            </svg>
                            <span class="b3-menu__label">
                                {t('aiSidebar.actions.openInNewWindow')}
                            </span>
                        </button>
                    </div>
                {/if}
            </div>
            <button
                class="b3-button b3-button--text"
                on:click={toggleFullscreen}
                title={isFullscreen ? t('fullscreen.exit') : t('fullscreen.title')}
            >
                <svg class="b3-button__icon">
                    <use
                        xlink:href={isFullscreen ? '#iconFullscreenExit' : '#iconFullscreen'}
                    ></use>
                </svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={openGitSyncDialog}
                title={t('aiSidebar.actions.gitSync') || 'Git Sync'}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text"
                on:click={openSettings}
                title={t('aiSidebar.actions.settings')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
            </button>
        </div>
    </div>

    <div
        class="ai-sidebar__messages"
        bind:this={messagesContainer}
        on:scroll={handleScroll}
        use:autoScrollOnMediaLoad
    >
        {#each messageGroups as group (group.startIndex)}
            {@const firstMessage = group.messages[0]}
            {@const messageIndex = group.startIndex}
            <div
                class="ai-message ai-message--{group.type}"
                on:contextmenu={e =>
                    handleContextMenu(e, messageIndex, group.type, false, group.messages.length)}
            >
                <div class="ai-message__header">
                    <span class="ai-message__role">
                        {group.type === 'user' ? '👤 User' : '🤖 AI'}
                    </span>
                </div>

                <!-- 遍历组内的所有消息 -->
                {#each group.messages as message, msgIndex}
                    <!-- 跳过 tool 角色的消息，因为它们已经在工具调用区域显示 -->
                    {#if message.role === 'tool'}
                        <!-- 不渲染 tool 消息 -->
                    {:else}
                        <!-- 显示思考过程 -->
                        {#if message.role === 'assistant' && message.thinking && !(message.multiModelResponses && message.multiModelResponses.length > 0) && !(message.codexTimeline && message.codexTimeline.length > 0)}
                            {@const thinkingIndex = messageIndex + msgIndex}
                            {@const isCollapsed = thinkingCollapsed[thinkingIndex] ?? true}
                            <div class="ai-message__thinking">
                                <div
                                    class="ai-message__thinking-header"
                                    on:click={() => {
                                        thinkingCollapsed[thinkingIndex] = !isCollapsed;
                                        thinkingCollapsed = { ...thinkingCollapsed };
                                    }}
                                >
                                    <svg
                                        class="ai-message__thinking-icon"
                                        class:collapsed={isCollapsed}
                                    >
                                        <use xlink:href="#iconRight"></use>
                                    </svg>
                                    <span class="ai-message__thinking-title">
                                        💭 {t('aiSidebar.messages.thinking')}
                                    </span>
                                </div>
                                {#if !isCollapsed}
                                    {@const thinkDisplay = getThinkingDisplayContent(
                                        message.thinking
                                    )}
                                    <div class="ai-message__thinking-content b3-typography">
                                        {@html thinkDisplay}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        {#if message.role === 'assistant' && message.codexTimeline && message.codexTimeline.length > 0}
                            <div class="ai-message__trace ai-message__trace--timeline">
                                <div class="ai-message__trace-title">
                                    Execution ({message.codexTimeline.length})
                                </div>
                                {#each message.codexTimeline as trace, traceIdx}
                                    {@const traceKey = buildHistoryCodexTraceExpandKey(
                                        'timeline',
                                        messageIndex + msgIndex,
                                        trace,
                                        traceIdx
                                    )}
                                    {@const traceExpanded = codexTraceExpanded[traceKey] ?? false}
                                    {@const traceDiffTarget = trace.kind === 'diff'
                                        ? getTraceDiffFileNameSummary(trace.editOperations, 1)
                                        : ''}
                                    {@const traceDiffStats = getTraceEditOperationStats(
                                        trace.editOperations
                                    )}
                                    <div
                                        class="ai-message__trace-item"
                                        class:ai-message__trace-item--diff={trace.kind === 'diff'}
                                    >
                                        <div
                                            class="ai-message__trace-item-header"
                                            class:ai-message__trace-item-header--diff={trace.kind === 'diff'}
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(traceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!traceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span
                                                class="ai-message__trace-item-kind"
                                                class:ai-message__trace-item-kind--diff={trace.kind === 'diff'}
                                            >
                                                {getCodexTimelineTypeLabel(trace.kind)}
                                            </span>
                                            {#if getCodexTimelineEntryName(trace)}
                                                <span
                                                    class="ai-message__trace-item-name"
                                                    class:ai-message__trace-item-name--diff={trace.kind === 'diff'}
                                                >
                                                    {getCodexTimelineEntryName(trace)}
                                                </span>
                                            {/if}
                                            {#if trace.kind === 'diff' && traceDiffTarget}
                                                <span
                                                    class="ai-message__trace-item-target"
                                                    title={traceDiffTarget}
                                                >
                                                    {traceDiffTarget}
                                                </span>
                                            {/if}
                                            {#if trace.kind === 'diff'}
                                                <span class="ai-message__trace-item-diff-stats">
                                                    +{traceDiffStats.added} -{traceDiffStats.removed}
                                                </span>
                                            {/if}
                                            {#if trace.kind !== 'thinking'}
                                                <span
                                                    class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                                    class:ai-message__trace-item-status--with-target={trace.kind ===
                                                        'diff' &&
                                                        !!traceDiffTarget}
                                                >
                                                    {getCodexTraceStatusText(trace.status)}
                                                </span>
                                            {/if}
                                        </div>
                                        {#if traceExpanded}
                                            <div
                                                class="ai-message__trace-item-body"
                                                class:ai-message__trace-item-body--diff={trace.kind === 'diff'}
                                            >
                                                {#if trace.kind === 'thinking'}
                                                    {#if trace.text}
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.text, 18, 3200)}</pre>
                                                    {/if}
                                                {:else if trace.kind === 'diff'}
                                                    {#if trace.editOperations && trace.editOperations.length > 0}
                                                        {@const traceFileGroups = buildEditOperationFileGroups(
                                                            trace.editOperations
                                                        )}
                                                        <div class="ai-message__trace-tool-diffs">
                                                            {#each traceFileGroups as fileGroup}
                                                                <div class="ai-message__trace-tool-diff ai-message__trace-tool-diff--flat">
                                                                    <div class="ai-message__trace-tool-diff-header ai-message__trace-tool-diff-header--flat">
                                                                        <span class="ai-message__trace-tool-diff-title">
                                                                            {fileGroup.fileLabel}
                                                                        </span>
                                                                        <span class="ai-message__trace-tool-diff-stats">
                                                                            +{fileGroup.added}
                                                                            -{fileGroup.removed}
                                                                        </span>
                                                                        <button
                                                                            class="b3-button b3-button--text b3-button--small ai-message__trace-tool-diff-open"
                                                                            on:click|stopPropagation={() =>
                                                                                viewEditOperationFileGroupDiff(
                                                                                    fileGroup
                                                                                )}
                                                                            title={t(
                                                                                'aiSidebar.actions.viewDiff'
                                                                            )}
                                                                        >
                                                                            Diff
                                                                        </button>
                                                                    </div>
                                                                    <div class="ai-message__trace-tool-diff-body">
                                                                        {#each getTraceEditFileGroupLines(fileGroup, 12) as line}
                                                                            <div
                                                                                class="ai-message__trace-tool-diff-line ai-message__trace-tool-diff-line--{line.type}"
                                                                            >
                                                                                <span class="ai-message__trace-tool-diff-marker">
                                                                                    {line.type === 'removed'
                                                                                        ? '-'
                                                                                        : line.type === 'added'
                                                                                          ? '+'
                                                                                          : '·'}
                                                                                </span>
                                                                                <span class="ai-message__trace-tool-diff-text">
                                                                                    {line.line}
                                                                                </span>
                                                                            </div>
                                                                        {/each}
                                                                    </div>
                                                                </div>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                {:else}
                                                    {#if trace.query}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                Query
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.query, 10, 1600)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if trace.input && trace.input !== trace.query}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                输入
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.input, 12, 2200)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if trace.output}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                {trace.kind === 'search'
                                                                    ? '结果'
                                                                    : '输出'}
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.output, 18, 3200)}</pre>
                                                        </div>
                                                    {/if}
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        {#if message.role === 'assistant' && !(message.codexTimeline && message.codexTimeline.length > 0) && message.codexSearchCalls && message.codexSearchCalls.length > 0}
                            <div class="ai-message__trace ai-message__trace--search">
                                <div class="ai-message__trace-title">
                                    Search ({message.codexSearchCalls.length})
                                </div>
                                {#each message.codexSearchCalls as trace, traceIdx}
                                    {@const traceKey = buildHistoryCodexTraceExpandKey(
                                        'search',
                                        messageIndex + msgIndex,
                                        trace,
                                        traceIdx
                                    )}
                                    {@const traceExpanded = codexTraceExpanded[traceKey] ?? false}
                                    <div class="ai-message__trace-item">
                                        <div
                                            class="ai-message__trace-item-header"
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(traceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!traceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__trace-item-name">
                                                {trace.name || 'Search'}
                                            </span>
                                            <span
                                                class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                            >
                                                {getCodexTraceStatusText(trace.status)}
                                            </span>
                                        </div>
                                        {#if traceExpanded}
                                            <div class="ai-message__trace-item-body">
                                                {#if trace.query}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            Query
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.query, 10, 1600)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.input && trace.input !== trace.query}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            输入
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.input, 12, 2200)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.output}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            结果
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.output, 18, 3200)}</pre>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        {#if message.role === 'assistant' && !(message.codexTimeline && message.codexTimeline.length > 0) && message.codexToolCalls && message.codexToolCalls.length > 0}
                            {@const codexToolSummary = getCodexTraceNameSummary(message.codexToolCalls)}
                            <div class="ai-message__trace ai-message__trace--tool">
                                <div class="ai-message__trace-title">
                                    Tool Calls ({message.codexToolCalls.length})
                                    {#if codexToolSummary}
                                        <span class="ai-message__trace-title-summary">
                                            {codexToolSummary}
                                        </span>
                                    {/if}
                                </div>
                                {#each message.codexToolCalls as trace, traceIdx}
                                    {@const traceKey = buildHistoryCodexTraceExpandKey(
                                        'tool',
                                        messageIndex + msgIndex,
                                        trace,
                                        traceIdx
                                    )}
                                    {@const traceExpanded = codexTraceExpanded[traceKey] ?? false}
                                    {@const traceDiffStats = getTraceEditOperationStats(
                                        trace.editOperations
                                    )}
                                    <div class="ai-message__trace-item">
                                        <div
                                            class="ai-message__trace-item-header"
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(traceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!traceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__trace-item-name">
                                                {trace.name || 'Tool'}
                                            </span>
                                            {#if trace.editOperations && trace.editOperations.length > 0}
                                                <span class="ai-message__trace-item-diff-stats">
                                                    +{traceDiffStats.added} -{traceDiffStats.removed}
                                                </span>
                                            {/if}
                                            <span
                                                class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                            >
                                                {getCodexTraceStatusText(trace.status)}
                                            </span>
                                        </div>
                                        {#if traceExpanded}
                                            <div class="ai-message__trace-item-body">
                                                {#if trace.input}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            参数
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.input, 12, 2200)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.output}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            输出
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.output, 18, 3200)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.editOperations && trace.editOperations.length > 0}
                                                    {@const traceFileGroups = buildEditOperationFileGroups(
                                                        trace.editOperations
                                                    )}
                                                    <div class="ai-message__trace-tool-diffs">
                                                        {#each traceFileGroups as fileGroup}
                                                            <div class="ai-message__trace-tool-diff ai-message__trace-tool-diff--flat">
                                                                <div class="ai-message__trace-tool-diff-header ai-message__trace-tool-diff-header--flat">
                                                                    <span class="ai-message__trace-tool-diff-title">
                                                                        {fileGroup.fileLabel}
                                                                    </span>
                                                                    <span class="ai-message__trace-tool-diff-stats">
                                                                        +{fileGroup.added} -{fileGroup.removed}
                                                                    </span>
                                                                    <button
                                                                        class="b3-button b3-button--text b3-button--small ai-message__trace-tool-diff-open"
                                                                        on:click|stopPropagation={() =>
                                                                            viewEditOperationFileGroupDiff(
                                                                                fileGroup
                                                                            )}
                                                                        title={t(
                                                                            'aiSidebar.actions.viewDiff'
                                                                        )}
                                                                    >
                                                                        Diff
                                                                    </button>
                                                                </div>
                                                                <div class="ai-message__trace-tool-diff-body">
                                                                    {#each getTraceEditFileGroupLines(fileGroup, 12) as line}
                                                                        <div
                                                                            class="ai-message__trace-tool-diff-line ai-message__trace-tool-diff-line--{line.type}"
                                                                        >
                                                                            <span class="ai-message__trace-tool-diff-marker">
                                                                                {line.type === 'removed'
                                                                                    ? '-'
                                                                                    : line.type === 'added'
                                                                                      ? '+'
                                                                                      : '·'}
                                                                            </span>
                                                                            <span class="ai-message__trace-tool-diff-text">
                                                                                {line.line}
                                                                            </span>
                                                                        </div>
                                                                    {/each}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- 显示消息内容（只有在有实际内容时才显示，且没有多模型响应时才显示） -->
                        {#if message.content && message.content
                                .toString()
                                .trim() && !(message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0)}
                            {@const displayContent = getDisplayContent(message.content)}
                            <div
                                class="ai-message__content b3-typography"
                                style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                            >
                                {@html displayContent}
                            </div>
                        {/if}

                        <!-- 显示多模型响应（历史消息） - 仅在用户已选择答案后显示 -->
                        {#if !isCodexMode && message.role === 'assistant' && message.multiModelResponses && message.multiModelResponses.length > 0 && message.multiModelResponses.some(r => r.isSelected)}
                            {@const layoutKey = `history_layout_${messageIndex}_${msgIndex}`}
                            {@const currentLayout =
                                thinkingCollapsed[layoutKey] || multiModelViewMode}
                            <div class="ai-message__multi-model-responses">
                                <div class="ai-message__multi-model-header">
                                    <div class="ai-message__multi-model-header-top">
                                        <h4>🤖 多模型响应</h4>
                                        <div class="ai-message__multi-model-layout-selector">
                                            <button
                                                class="b3-button b3-button--text b3-button--small"
                                                class:b3-button--primary={currentLayout === 'card'}
                                                on:click={() => {
                                                    thinkingCollapsed[layoutKey] = 'card';
                                                    thinkingCollapsed = { ...thinkingCollapsed };
                                                }}
                                                title={t('multiModel.layout.card')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconSplitLR"></use>
                                                </svg>
                                                {t('multiModel.layout.card')}
                                            </button>
                                            <button
                                                class="b3-button b3-button--text b3-button--small"
                                                class:b3-button--primary={currentLayout === 'tab'}
                                                on:click={() => {
                                                    thinkingCollapsed[layoutKey] = 'tab';
                                                    thinkingCollapsed = { ...thinkingCollapsed };
                                                }}
                                                title={t('multiModel.layout.tab')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconSplitTB"></use>
                                                </svg>
                                                {t('multiModel.layout.tab')}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {#if currentLayout === 'card'}
                                    <!-- 卡片视图 -->
                                    <div class="ai-sidebar__multi-model-cards">
                                        {#each message.multiModelResponses as response, index}
                                            <div
                                                class="ai-sidebar__multi-model-card"
                                                class:ai-sidebar__multi-model-card--selected={response.isSelected}
                                            >
                                                <div class="ai-sidebar__multi-model-card-header">
                                                    <div class="ai-sidebar__multi-model-card-title">
                                                        <span
                                                            class="ai-sidebar__multi-model-card-model-name"
                                                        >
                                                            {response.modelName}
                                                        </span>
                                                        {#if response.error}
                                                            <span
                                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--error"
                                                            >
                                                                ❌ {t('multiModel.error')}
                                                            </span>
                                                        {/if}
                                                    </div>
                                                    <div
                                                        class="ai-sidebar__multi-model-card-actions"
                                                    >
                                                        {#if !response.error && response.content}
                                                            <button
                                                                class="b3-button b3-button--text"
                                                                on:click={() =>
                                                                    regenerateHistoryModelResponse(
                                                                        messageIndex + msgIndex,
                                                                        index
                                                                    )}
                                                                title={t(
                                                                    'aiSidebar.actions.regenerate'
                                                                )}
                                                            >
                                                                <svg class="b3-button__icon">
                                                                    <use
                                                                        xlink:href="#iconRefresh"
                                                                    ></use>
                                                                </svg>
                                                            </button>
                                                            <button
                                                                class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                                on:click={() =>
                                                                    copyMessage(
                                                                        response.content || ''
                                                                    )}
                                                                title={t(
                                                                    'aiSidebar.actions.copyMessage'
                                                                )}
                                                            >
                                                                <svg class="b3-button__icon">
                                                                    <use
                                                                        xlink:href="#iconCopy"
                                                                    ></use>
                                                                </svg>
                                                            </button>
                                                            <button
                                                                class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                                class:ai-sidebar__multi-model-select-btn--selected={response.isSelected}
                                                                on:click={() =>
                                                                    selectHistoryMultiModelAnswer(
                                                                        messageIndex + msgIndex,
                                                                        index
                                                                    )}
                                                            >
                                                                {response.isSelected
                                                                    ? t('multiModel.answerSelected')
                                                                    : t('multiModel.selectAnswer')}
                                                            </button>
                                                        {/if}
                                                    </div>
                                                </div>

                                                <!-- 思考过程 -->
                                                {#if response.thinking}
                                                    {@const isCollapsed =
                                                        response.thinkingCollapsed ?? true}
                                                    <div class="ai-message__thinking">
                                                        <div
                                                            class="ai-message__thinking-header"
                                                            on:click={() => {
                                                                message.multiModelResponses[
                                                                    index
                                                                ].thinkingCollapsed = !isCollapsed;
                                                                messages = [...messages];
                                                            }}
                                                        >
                                                            <svg
                                                                class="ai-message__thinking-icon"
                                                                class:collapsed={isCollapsed}
                                                            >
                                                                <use xlink:href="#iconRight"></use>
                                                            </svg>
                                                            <span
                                                                class="ai-message__thinking-title"
                                                            >
                                                                💭 {t(
                                                                    'aiSidebar.messages.thinking'
                                                                )}
                                                            </span>
                                                        </div>
                                                        {#if !isCollapsed}
                                                            {@const thinkingDisplay =
                                                                getThinkingDisplayContent(
                                                                    response.thinking
                                                                )}
                                                            <div
                                                                class="ai-message__thinking-content b3-typography"
                                                            >
                                                                {@html thinkingDisplay}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                {/if}

                                                <div
                                                    class="ai-sidebar__multi-model-card-content b3-typography"
                                                    style={messageFontSize
                                                        ? `font-size: ${messageFontSize}px;`
                                                        : ''}
                                                    on:contextmenu={e =>
                                                        handleContextMenu(
                                                            e,
                                                            messageIndex + msgIndex,
                                                            'assistant'
                                                        )}
                                                >
                                                    {#if response.error}
                                                        <div
                                                            class="ai-sidebar__multi-model-card-error"
                                                        >
                                                            {response.error}
                                                        </div>
                                                    {:else if response.content}
                                                        {@const contentDisplay = getDisplayContent(
                                                            response.content
                                                        )}
                                                        {@html contentDisplay}
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {:else}
                                    <!-- 页签视图 -->
                                    <div class="ai-message__multi-model-tabs">
                                        <div class="ai-message__multi-model-tab-headers">
                                            {#each message.multiModelResponses as response, index}
                                                {@const tabKey = `history_multi_${messageIndex}_${msgIndex}`}
                                                {@const currentTabIndex =
                                                    thinkingCollapsed[`${tabKey}_selectedTab`] ??
                                                    message.multiModelResponses.findIndex(
                                                        r => r.isSelected
                                                    ) ??
                                                    0}
                                                <button
                                                    class="ai-message__multi-model-tab-header"
                                                    class:ai-message__multi-model-tab-header--active={currentTabIndex ===
                                                        index}
                                                    on:click={() => {
                                                        thinkingCollapsed[`${tabKey}_selectedTab`] =
                                                            index;
                                                        thinkingCollapsed = {
                                                            ...thinkingCollapsed,
                                                        };
                                                    }}
                                                >
                                                    <span class="ai-message__multi-model-tab-title">
                                                        {response.modelName}
                                                    </span>
                                                    {#if response.error}
                                                        <span
                                                            class="ai-message__multi-model-tab-status ai-message__multi-model-tab-status--error"
                                                        >
                                                            ❌
                                                        </span>
                                                    {/if}
                                                </button>
                                            {/each}
                                        </div>
                                        <div class="ai-message__multi-model-tab-content">
                                            {#each message.multiModelResponses as response, index}
                                                {@const tabKey = `history_multi_${messageIndex}_${msgIndex}`}
                                                {@const currentTabIndex =
                                                    thinkingCollapsed[`${tabKey}_selectedTab`] ??
                                                    message.multiModelResponses.findIndex(
                                                        r => r.isSelected
                                                    ) ??
                                                    0}
                                                {#if currentTabIndex === index}
                                                    <div class="ai-message__multi-model-tab-panel">
                                                        <!-- 添加面板头部，包含复制按钮 -->
                                                        <div
                                                            class="ai-message__multi-model-tab-panel-header"
                                                        >
                                                            <div
                                                                class="ai-message__multi-model-tab-panel-title"
                                                            >
                                                                <span
                                                                    class="ai-message__multi-model-tab-panel-model-name"
                                                                >
                                                                    {response.modelName}
                                                                </span>
                                                            </div>
                                                            <div
                                                                class="ai-message__multi-model-tab-panel-actions"
                                                            >
                                                                {#if !response.error && response.content}
                                                                    <button
                                                                        class="b3-button b3-button--text"
                                                                        on:click={() =>
                                                                            regenerateHistoryModelResponse(
                                                                                messageIndex +
                                                                                    msgIndex,
                                                                                index
                                                                            )}
                                                                        title={t(
                                                                            'aiSidebar.actions.regenerate'
                                                                        )}
                                                                    >
                                                                        <svg
                                                                            class="b3-button__icon"
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconRefresh"
                                                                            ></use>
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                                        on:click={() =>
                                                                            copyMessage(
                                                                                response.content ||
                                                                                    ''
                                                                            )}
                                                                        title={t(
                                                                            'aiSidebar.actions.copyMessage'
                                                                        )}
                                                                    >
                                                                        <svg
                                                                            class="b3-button__icon"
                                                                        >
                                                                            <use
                                                                                xlink:href="#iconCopy"
                                                                            ></use>
                                                                        </svg>
                                                                    </button>
                                                                {/if}
                                                            </div>
                                                        </div>

                                                        {#if response.thinking}
                                                            {@const isCollapsed =
                                                                response.thinkingCollapsed ?? true}
                                                            <div class="ai-message__thinking">
                                                                <div
                                                                    class="ai-message__thinking-header"
                                                                    on:click={() => {
                                                                        message.multiModelResponses[
                                                                            index
                                                                        ].thinkingCollapsed =
                                                                            !isCollapsed;
                                                                        messages = [...messages];
                                                                    }}
                                                                >
                                                                    <svg
                                                                        class="ai-message__thinking-icon"
                                                                        class:collapsed={isCollapsed}
                                                                    >
                                                                        <use
                                                                            xlink:href="#iconRight"
                                                                        ></use>
                                                                    </svg>
                                                                    <span
                                                                        class="ai-message__thinking-title"
                                                                    >
                                                                        💭 {t('aiSidebar.messages.thinking')}
                                                                    </span>
                                                                </div>
                                                                {#if !isCollapsed}
                                                                    {@const thinkingDisplay =
                                                                        getThinkingDisplayContent(
                                                                            response.thinking
                                                                        )}
                                                                    <div
                                                                        class="ai-message__thinking-content b3-typography"
                                                                    >
                                                                        {@html thinkingDisplay}
                                                                    </div>
                                                                {/if}
                                                            </div>
                                                        {/if}

                                                        <div
                                                            class="ai-message__multi-model-tab-panel-content b3-typography"
                                                            style={messageFontSize
                                                                ? `font-size: ${messageFontSize}px;`
                                                                : ''}
                                                            on:contextmenu={e =>
                                                                handleContextMenu(
                                                                    e,
                                                                    messageIndex + msgIndex,
                                                                    'assistant'
                                                                )}
                                                        >
                                                            {#if response.error}
                                                                <div
                                                                    class="ai-message__multi-model-tab-panel-error"
                                                                >
                                                                    {response.error}
                                                                </div>
                                                            {:else if response.content}
                                                                {@const contentDisplay =
                                                                    getDisplayContent(
                                                                        response.content
                                                                    )}
                                                                {@html contentDisplay}
                                                            {/if}
                                                        </div>
                                                    </div>
                                                {/if}
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <!-- 显示上下文文档和附件 -->
                        {#if (message.contextDocuments && message.contextDocuments.length > 0) || (message.attachments && message.attachments.length > 0)}
                            {@const contextCount =
                                (message.contextDocuments?.length || 0) +
                                (message.attachments?.length || 0)}
                            <div class="ai-message__context-docs">
                                <div class="ai-message__context-docs-title">
                                    📎 {t('aiSidebar.context.content')} ({contextCount})
                                </div>

                                <!-- 显示附件 -->
                                {#if message.attachments && message.attachments.length > 0}
                                    <div class="ai-message__context-docs-list">
                                        {#each message.attachments as attachment}
                                            <div class="ai-message__attachment">
                                                {#if attachment.type === 'image'}
                                                    <img
                                                        src={attachment.data}
                                                        alt={attachment.name}
                                                        class="ai-message__attachment-image"
                                                        on:click={() =>
                                                            openImageViewer(
                                                                attachment.data,
                                                                attachment.name
                                                            )}
                                                        title={t('aiSidebar.actions.viewImage') || 'View image'}
                                                    />
                                                    <button
                                                        class="b3-button b3-button--text ai-message__attachment-copy"
                                                        on:click={() => {
                                                            navigator.clipboard.writeText(
                                                                attachment.data
                                                            );
                                                            pushMsg(
                                                                t('aiSidebar.success.copyImageUrl') ||
                                                                    'Image URL copied'
                                                            );
                                                        }}
                                                        title={
                                                            t('aiSidebar.actions.copyImageUrl') ||
                                                            'Copy image URL'
                                                        }
                                                    >
                                                        <svg class="b3-button__icon">
                                                            <use xlink:href="#iconCopy"></use>
                                                        </svg>
                                                    </button>
                                                    <span class="ai-message__attachment-name">
                                                        {attachment.name}
                                                    </span>
                                                {:else}
                                                    <div class="ai-message__attachment-file">
                                                        {#if attachment.isWebPage}
                                                            <span
                                                                class="ai-message__attachment-icon-emoji"
                                                            >
                                                                🔗
                                                            </span>
                                                        {:else}
                                                            <svg
                                                                class="ai-message__attachment-icon"
                                                            >
                                                                <use xlink:href="#iconFile"></use>
                                                            </svg>
                                                        {/if}
                                                        <span class="ai-message__attachment-name">
                                                            {attachment.name}
                                                        </span>
                                                        <button
                                                            class="b3-button b3-button--text ai-message__attachment-copy"
                                                            on:click={() => {
                                                                navigator.clipboard.writeText(
                                                                    attachment.data
                                                                );
                                                                pushMsg(
                                                                    attachment.isWebPage
                                                                        ? t(
                                                                              'aiSidebar.success.copyWebMarkdown'
                                                                          ) ||
                                                                              'Web page markdown copied'
                                                                        : t('aiSidebar.success.copyFileContent') ||
                                                                              'File content copied'
                                                                );
                                                            }}
                                                            title={attachment.isWebPage
                                                                ? t(
                                                                      'aiSidebar.actions.copyWebMarkdown'
                                                                  ) || 'Copy web page markdown'
                                                                : t('aiSidebar.actions.copyFileContent') ||
                                                                      'Copy file content'}
                                                        >
                                                            <svg class="b3-button__icon">
                                                                <use xlink:href="#iconCopy"></use>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}

                                <!-- 显示上下文文档链接 -->
                                {#if message.contextDocuments && message.contextDocuments.length > 0}
                                    <div class="ai-message__context-docs-list">
                                        {#each message.contextDocuments as doc}
                                            <div class="ai-sidebar__context-doc-item">
                                                <button
                                                    class="ai-sidebar__context-doc-link"
                                                    on:click={() => openDocument(doc.id)}
                                                    title={doc.title}
                                                >
                                                    {doc.type === 'doc' ? '📄' : '📝'}
                                                    {doc.title}
                                                </button>
                                                <button
                                                    class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                                    on:click|stopPropagation={() =>
                                                        copyMessage(doc.content || '')}
                                                    title={t('aiSidebar.actions.copyMessage')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconCopy"></use>
                                                    </svg>
                                                </button>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        <!-- 显示工具调用 -->
                        {#if message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0}
                            {@const toolCallSummary = getToolCallNameSummary(message.tool_calls)}
                            <div class="ai-message__tool-calls">
                                <div class="ai-message__tool-calls-title">
                                    🔧 {t('tools.calling')} ({message.tool_calls.length})
                                    {#if toolCallSummary}
                                        <span class="ai-message__tool-calls-summary">
                                            {toolCallSummary}
                                        </span>
                                    {/if}
                                </div>
                                {#each message.tool_calls as toolCall}
                                    {@const toolResult = group.messages
                                        .slice(msgIndex + 1)
                                        .find(
                                            m => m.role === 'tool' && m.tool_call_id === toolCall.id
                                        )}
                                    {@const toolName = toolCall.function.name}
                                    {@const toolDisplayName = getToolDisplayName(toolName)}
                                    {@const isCompleted = !!toolResult}
                                    {@const toolCallCollapsed = !toolCallsExpanded[toolCall.id]}

                                    <div class="ai-message__tool-call">
                                        <div
                                            class="ai-message__tool-call-header"
                                            on:click={() => {
                                                toolCallsExpanded[toolCall.id] =
                                                    !toolCallsExpanded[toolCall.id];
                                                toolCallsExpanded = { ...toolCallsExpanded };
                                            }}
                                        >
                                            <div class="ai-message__tool-call-name">
                                                <svg
                                                    class="ai-message__tool-call-icon"
                                                    class:collapsed={toolCallCollapsed}
                                                >
                                                    <use xlink:href="#iconRight"></use>
                                                </svg>
                                                <span>{toolDisplayName}</span>
                                                {#if isCompleted}
                                                    <span class="ai-message__tool-call-status">
                                                        ✅
                                                    </span>
                                                {:else}
                                                    <span class="ai-message__tool-call-status">
                                                        ⏳
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>

                                        {#if !toolCallCollapsed}
                                            {@const paramsKey = `${toolCall.id}_params`}
                                            {@const paramsExpanded =
                                                toolCallResultsExpanded[paramsKey] !== false}
                                            {@const resultKey = `${toolCall.id}_result`}
                                            {@const resultExpanded =
                                                toolCallResultsExpanded[resultKey] !== false}
                                            <div class="ai-message__tool-call-details">
                                                <!-- 工具参数 -->
                                                <div class="ai-message__tool-call-params">
                                                    <div
                                                        class="ai-message__tool-call-section-header"
                                                        on:click={() => {
                                                            toolCallResultsExpanded[paramsKey] =
                                                                !paramsExpanded;
                                                            toolCallResultsExpanded = {
                                                                ...toolCallResultsExpanded,
                                                            };
                                                        }}
                                                    >
                                                        <svg
                                                            class="ai-message__tool-call-icon"
                                                            class:collapsed={!paramsExpanded}
                                                        >
                                                            <use xlink:href="#iconRight"></use>
                                                        </svg>
                                                        <strong>
                                                            {t('tools.selector.parameters')}
                                                        </strong>
                                                    </div>
                                                    {#if paramsExpanded}
                                                        <pre
                                                            class="ai-message__tool-call-code">{toolCall
                                                                .function.arguments}</pre>
                                                    {/if}
                                                </div>

                                                <!-- 工具结果 -->
                                                {#if toolResult}
                                                    <div class="ai-message__tool-call-result">
                                                        <div
                                                            class="ai-message__tool-call-section-header"
                                                            on:click={() => {
                                                                toolCallResultsExpanded[resultKey] =
                                                                    !resultExpanded;
                                                                toolCallResultsExpanded = {
                                                                    ...toolCallResultsExpanded,
                                                                };
                                                            }}
                                                        >
                                                            <svg
                                                                class="ai-message__tool-call-icon"
                                                                class:collapsed={!resultExpanded}
                                                            >
                                                                <use xlink:href="#iconRight"></use>
                                                            </svg>
                                                            <strong>{t('tools.result')}</strong>
                                                        </div>
                                                        {#if resultExpanded}
                                                            <pre
                                                                class="ai-message__tool-call-code">{toolResult.content}</pre>
                                                        {/if}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- 显示工具调用后的最终回复 -->
                        {#if message.role === 'assistant' && message.finalReply}
                            {@const finalReplyDisplay = getDisplayContent(message.finalReply)}
                            <div
                                class="ai-message__content ai-message__final-reply b3-typography"
                                style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                            >
                                {@html finalReplyDisplay}
                            </div>
                        {/if}

                        <!-- 显示编辑差异（按文件分组） -->
                        {#if message.role === 'assistant' && message.editOperations && message.editOperations.length > 0}
                            {@const editFileGroups = buildEditOperationFileGroups(message.editOperations)}
                            {#if editFileGroups.length > 0}
                                <div class="ai-message__edit-operations">
                                    {#each editFileGroups as fileGroup}
                                        {@const fileStatus = getEditOperationFileGroupStatus(fileGroup)}
                                        <div
                                            class="ai-message__edit-file-group ai-message__edit-file-group--{fileStatus}"
                                        >
                                            <div class="ai-message__edit-file-header">
                                                <span class="ai-message__edit-file-path">
                                                    {fileGroup.fileLabel}
                                                </span>
                                                <span class="ai-message__edit-file-stats">
                                                    Δ{fileGroup.added + fileGroup.removed} (+{fileGroup.added} -{fileGroup.removed})
                                                </span>
                                                <span class="ai-message__edit-file-status">
                                                    {#if fileStatus === 'applied'}
                                                        ✓ 已应用
                                                    {:else if fileStatus === 'rejected'}
                                                        ✗ 已拒绝
                                                    {:else if fileStatus === 'pending'}
                                                        ⏳ 待处理
                                                    {:else}
                                                        • 混合
                                                    {/if}
                                                </span>
                                            </div>
                                            <div class="ai-message__edit-file-actions">
                                                <button
                                                    class="b3-button b3-button--text b3-button--small"
                                                    on:click|stopPropagation={() =>
                                                        viewEditOperationFileGroupDiff(fileGroup)}
                                                    title={t('aiSidebar.actions.viewDiff')}
                                                >
                                                    Diff
                                                </button>
                                                {#if fileGroup.pendingCount > 0}
                                                    <button
                                                        class="b3-button b3-button--outline b3-button--small"
                                                        on:click|stopPropagation={() =>
                                                            applyEditOperationFileGroup(
                                                                fileGroup,
                                                                messageIndex + msgIndex
                                                            )}
                                                        title={t('aiSidebar.actions.applyEdit')}
                                                    >
                                                        应用该文件
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text b3-button--small"
                                                        on:click|stopPropagation={() =>
                                                            rejectEditOperationFileGroup(
                                                                fileGroup,
                                                                messageIndex + msgIndex
                                                            )}
                                                        title={t('aiSidebar.actions.rejectEdit')}
                                                    >
                                                        拒绝该文件
                                                    </button>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        {/if}
                    {/if}
                {/each}

                <!-- 消息操作按钮（组级别，只显示一次） -->
                <!-- 如果存在多模型响应且未选择答案，则不显示操作按钮 -->
                {#if isCodexMode || !firstMessage.multiModelResponses || (firstMessage.multiModelResponses && firstMessage.multiModelResponses.some(r => r.isSelected))}
                    <div class="ai-message__actions">
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => copyMessage(getActualMessageContent(firstMessage))}
                            title={t('aiSidebar.actions.copyMessage')}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => deleteMessage(messageIndex, group.messages.length)}
                            title={t('aiSidebar.actions.deleteMessage')}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconTrashcan"></use>
                            </svg>
                        </button>
                        <button
                            class="b3-button b3-button--text ai-message__action"
                            on:click={() => regenerateMessage(messageIndex)}
                            title={group.type === 'user'
                                ? t('aiSidebar.actions.resend')
                                : t('aiSidebar.actions.regenerate')}
                        >
                            <svg class="b3-button__icon">
                                <use xlink:href="#iconRefresh"></use>
                            </svg>
                        </button>
                    </div>
                {/if}
            </div>
        {/each}

        {#if isLoading && !(enableMultiModel && chatMode === 'ask' && selectedMultiModels.length > 0)}
            <div
                class="ai-message ai-message--assistant ai-message--streaming"
                on:contextmenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                <div class="ai-message__header">
                    <span class="ai-message__role">🤖 AI</span>
                </div>

                <!-- 显示流式思考过程 -->
                {#if streamingThinking && streamingCodexTimeline.length === 0}
                    <div class="ai-message__thinking ai-message__thinking--streaming">
                        <div
                            class="ai-message__thinking-header"
                            on:click={() => (streamingThinkingExpanded = !streamingThinkingExpanded)}
                        >
                            <svg
                                class="ai-message__thinking-icon"
                                class:collapsed={!streamingThinkingExpanded}
                            >
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            <span class="ai-message__thinking-title">
                                💭 思考中{isThinkingPhase ? '...' : ' (已完成)'}
                            </span>
                            <span class="ai-message__thinking-status">
                                {streamingThinkingExpanded ? '点击收起' : '点击展开'}
                            </span>
                        </div>
                        {#if streamingThinkingExpanded}
                            <pre
                                class="ai-message__thinking-plain"
                                class:ai-message__thinking-plain--streaming={isThinkingPhase}
                            >{getCodexTraceText(streamingThinking)}</pre>
                        {/if}
                    </div>
                {/if}

                {#if streamingCodexTimeline.length > 0}
                    <div class="ai-message__trace ai-message__trace--timeline ai-message__trace--streaming">
                        <div
                            class="ai-message__trace-title"
                            on:click|stopPropagation={() =>
                                (streamingCodexTimelineExpanded = !streamingCodexTimelineExpanded)}
                        >
                            <svg
                                class="ai-message__trace-item-icon"
                                class:collapsed={!streamingCodexTimelineExpanded}
                            >
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            Execution ({streamingCodexTimeline.length})
                        </div>
                        {#if streamingCodexTimelineExpanded}
                            <div class="ai-message__trace-stream-list">
                                {#each streamingCodexTimeline as trace, traceIdx}
                                    {@const streamTraceKey = buildStreamingCodexTraceExpandKey(
                                        'timeline',
                                        trace,
                                        traceIdx
                                    )}
                                    {@const streamTraceExpanded =
                                        codexTraceExpanded[streamTraceKey] ?? false}
                                    {@const traceDiffTarget = trace.kind === 'diff'
                                        ? getTraceDiffFileNameSummary(trace.editOperations, 1)
                                        : ''}
                                    {@const traceDiffStats = getTraceEditOperationStats(
                                        trace.editOperations
                                    )}
                                    <div
                                        class="ai-message__trace-stream-item"
                                        class:ai-message__trace-stream-item--diff={trace.kind === 'diff'}
                                    >
                                        <div
                                            class="ai-message__trace-item-header"
                                            class:ai-message__trace-item-header--diff={trace.kind === 'diff'}
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(streamTraceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!streamTraceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span
                                                class="ai-message__trace-item-kind"
                                                class:ai-message__trace-item-kind--diff={trace.kind === 'diff'}
                                            >
                                                {getCodexTimelineTypeLabel(trace.kind)}
                                            </span>
                                            {#if getCodexTimelineEntryName(trace)}
                                                <span
                                                    class="ai-message__trace-item-name"
                                                    class:ai-message__trace-item-name--diff={trace.kind === 'diff'}
                                                >
                                                    {getCodexTimelineEntryName(trace)}
                                                </span>
                                            {/if}
                                            {#if trace.kind === 'diff' && traceDiffTarget}
                                                <span
                                                    class="ai-message__trace-item-target"
                                                    title={traceDiffTarget}
                                                >
                                                    {traceDiffTarget}
                                                </span>
                                            {/if}
                                            {#if trace.kind === 'diff'}
                                                <span class="ai-message__trace-item-diff-stats">
                                                    +{traceDiffStats.added} -{traceDiffStats.removed}
                                                </span>
                                            {/if}
                                            {#if trace.kind !== 'thinking'}
                                                <span
                                                    class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                                    class:ai-message__trace-item-status--with-target={trace.kind ===
                                                        'diff' &&
                                                        !!traceDiffTarget}
                                                >
                                                    {getCodexTraceStatusText(trace.status)}
                                                </span>
                                            {/if}
                                        </div>
                                        {#if streamTraceExpanded}
                                            <div
                                                class="ai-message__trace-item-body"
                                                class:ai-message__trace-item-body--diff={trace.kind === 'diff'}
                                            >
                                                {#if trace.kind === 'thinking'}
                                                    {#if trace.text}
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.text, 14, 2600)}</pre>
                                                    {/if}
                                                {:else if trace.kind === 'diff'}
                                                    {#if trace.editOperations && trace.editOperations.length > 0}
                                                        {@const traceFileGroups = buildEditOperationFileGroups(
                                                            trace.editOperations
                                                        )}
                                                        <div class="ai-message__trace-tool-diffs">
                                                            {#each traceFileGroups as fileGroup}
                                                                <div class="ai-message__trace-tool-diff ai-message__trace-tool-diff--flat">
                                                                    <div class="ai-message__trace-tool-diff-header ai-message__trace-tool-diff-header--flat">
                                                                        <span class="ai-message__trace-tool-diff-title">
                                                                            {fileGroup.fileLabel}
                                                                        </span>
                                                                        <span class="ai-message__trace-tool-diff-stats">
                                                                            +{fileGroup.added}
                                                                            -{fileGroup.removed}
                                                                        </span>
                                                                        <button
                                                                            class="b3-button b3-button--text b3-button--small ai-message__trace-tool-diff-open"
                                                                            on:click|stopPropagation={() =>
                                                                                viewEditOperationFileGroupDiff(
                                                                                    fileGroup
                                                                                )}
                                                                            title={t(
                                                                                'aiSidebar.actions.viewDiff'
                                                                            )}
                                                                        >
                                                                            Diff
                                                                        </button>
                                                                    </div>
                                                                    <div class="ai-message__trace-tool-diff-body">
                                                                        {#each getTraceEditFileGroupLines(fileGroup, 10) as line}
                                                                            <div
                                                                                class="ai-message__trace-tool-diff-line ai-message__trace-tool-diff-line--{line.type}"
                                                                            >
                                                                                <span class="ai-message__trace-tool-diff-marker">
                                                                                    {line.type === 'removed'
                                                                                        ? '-'
                                                                                        : line.type === 'added'
                                                                                          ? '+'
                                                                                          : '·'}
                                                                                </span>
                                                                                <span class="ai-message__trace-tool-diff-text">
                                                                                    {line.line}
                                                                                </span>
                                                                            </div>
                                                                        {/each}
                                                                    </div>
                                                                </div>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                {:else}
                                                    {#if trace.query}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                Query
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.query, 8, 1400)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if trace.input && trace.input !== trace.query}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                输入
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.input, 8, 1400)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if trace.output}
                                                        <div class="ai-message__trace-field">
                                                            <div class="ai-message__trace-field-label">
                                                                {trace.kind === 'search'
                                                                    ? '结果'
                                                                    : '输出'}
                                                            </div>
                                                            <pre class="ai-message__trace-pre"
                                                                >{getCodexTraceText(trace.output, 12, 2200)}</pre>
                                                        </div>
                                                    {/if}
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}

                {#if streamingCodexTimeline.length === 0 && streamingSearchCalls.length > 0}
                    <div class="ai-message__trace ai-message__trace--search ai-message__trace--streaming">
                        <div
                            class="ai-message__trace-title"
                            on:click|stopPropagation={() =>
                                (streamingSearchCallsExpanded = !streamingSearchCallsExpanded)}
                        >
                            <svg
                                class="ai-message__trace-item-icon"
                                class:collapsed={!streamingSearchCallsExpanded}
                            >
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            Search ({streamingSearchCalls.length})
                        </div>
                        {#if streamingSearchCallsExpanded}
                            <div class="ai-message__trace-stream-list">
                                {#each streamingSearchCalls as trace, traceIdx}
                                    {@const streamTraceKey = buildStreamingCodexTraceExpandKey(
                                        'search',
                                        trace,
                                        traceIdx
                                    )}
                                    {@const streamTraceExpanded =
                                        codexTraceExpanded[streamTraceKey] ?? false}
                                    <div class="ai-message__trace-stream-item">
                                        <div
                                            class="ai-message__trace-item-header"
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(streamTraceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!streamTraceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__trace-item-name">
                                                {trace.name || 'Search'}
                                            </span>
                                            <span
                                                class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                            >
                                                {getCodexTraceStatusText(trace.status)}
                                            </span>
                                        </div>
                                        {#if streamTraceExpanded}
                                            <div class="ai-message__trace-item-body">
                                                {#if trace.query}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            Query
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.query, 8, 1400)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.input && trace.input !== trace.query}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            输入
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.input, 8, 1400)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.output}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            结果
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.output, 12, 2200)}</pre>
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}

                {#if streamingCodexTimeline.length === 0 && streamingToolCalls.length > 0}
                    {@const streamToolSummary = getCodexTraceNameSummary(streamingToolCalls)}
                    <div class="ai-message__trace ai-message__trace--tool ai-message__trace--streaming">
                        <div
                            class="ai-message__trace-title"
                            on:click|stopPropagation={() =>
                                (streamingToolCallsExpanded = !streamingToolCallsExpanded)}
                        >
                            <svg
                                class="ai-message__trace-item-icon"
                                class:collapsed={!streamingToolCallsExpanded}
                            >
                                <use xlink:href="#iconRight"></use>
                            </svg>
                            Tool Calls ({streamingToolCalls.length})
                            {#if streamToolSummary}
                                <span class="ai-message__trace-title-summary">
                                    {streamToolSummary}
                                </span>
                            {/if}
                        </div>
                        {#if streamingToolCallsExpanded}
                            <div class="ai-message__trace-stream-list">
                                {#each streamingToolCalls as trace, traceIdx}
                                    {@const streamTraceKey = buildStreamingCodexTraceExpandKey(
                                        'tool',
                                        trace,
                                        traceIdx
                                    )}
                                    {@const streamTraceExpanded =
                                        codexTraceExpanded[streamTraceKey] ?? false}
                                    {@const traceDiffStats = getTraceEditOperationStats(
                                        trace.editOperations
                                    )}
                                    <div class="ai-message__trace-stream-item">
                                        <div
                                            class="ai-message__trace-item-header"
                                            on:click|stopPropagation={() =>
                                                toggleCodexTraceExpanded(streamTraceKey)}
                                        >
                                            <svg
                                                class="ai-message__trace-item-icon"
                                                class:collapsed={!streamTraceExpanded}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__trace-item-name">
                                                {trace.name || 'Tool'}
                                            </span>
                                            {#if trace.editOperations && trace.editOperations.length > 0}
                                                <span class="ai-message__trace-item-diff-stats">
                                                    +{traceDiffStats.added} -{traceDiffStats.removed}
                                                </span>
                                            {/if}
                                            <span
                                                class="ai-message__trace-item-status ai-message__trace-item-status--{trace.status || 'running'}"
                                            >
                                                {getCodexTraceStatusText(trace.status)}
                                            </span>
                                        </div>
                                        {#if streamTraceExpanded}
                                            <div class="ai-message__trace-item-body">
                                                {#if trace.input}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            参数
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.input, 8, 1400)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.output}
                                                    <div class="ai-message__trace-field">
                                                        <div class="ai-message__trace-field-label">
                                                            输出
                                                        </div>
                                                        <pre class="ai-message__trace-pre"
                                                            >{getCodexTraceText(trace.output, 12, 2200)}</pre>
                                                    </div>
                                                {/if}
                                                {#if trace.editOperations && trace.editOperations.length > 0}
                                                    {@const traceFileGroups = buildEditOperationFileGroups(
                                                        trace.editOperations
                                                    )}
                                                    <div class="ai-message__trace-tool-diffs">
                                                        {#each traceFileGroups as fileGroup}
                                                            <div class="ai-message__trace-tool-diff ai-message__trace-tool-diff--flat">
                                                                <div class="ai-message__trace-tool-diff-header ai-message__trace-tool-diff-header--flat">
                                                                    <span class="ai-message__trace-tool-diff-title">
                                                                        {fileGroup.fileLabel}
                                                                    </span>
                                                                    <span class="ai-message__trace-tool-diff-stats">
                                                                        +{fileGroup.added} -{fileGroup.removed}
                                                                    </span>
                                                                    <button
                                                                        class="b3-button b3-button--text b3-button--small ai-message__trace-tool-diff-open"
                                                                        on:click|stopPropagation={() =>
                                                                            viewEditOperationFileGroupDiff(
                                                                                fileGroup
                                                                            )}
                                                                        title={t(
                                                                            'aiSidebar.actions.viewDiff'
                                                                        )}
                                                                    >
                                                                        Diff
                                                                    </button>
                                                                </div>
                                                                <div class="ai-message__trace-tool-diff-body">
                                                                    {#each getTraceEditFileGroupLines(fileGroup, 12) as line}
                                                                        <div
                                                                            class="ai-message__trace-tool-diff-line ai-message__trace-tool-diff-line--{line.type}"
                                                                        >
                                                                            <span class="ai-message__trace-tool-diff-marker">
                                                                                {line.type === 'removed'
                                                                                    ? '-'
                                                                                    : line.type === 'added'
                                                                                      ? '+'
                                                                                      : '·'}
                                                                            </span>
                                                                            <span class="ai-message__trace-tool-diff-text">
                                                                                {line.line}
                                                                            </span>
                                                                        </div>
                                                                    {/each}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}

                {#if streamingMessage}
                    {@const streamMsgDisplay = getDisplayContent(streamingMessage)}
                    <div
                        class="ai-message__content b3-typography"
                        style={messageFontSize ? `font-size: ${messageFontSize}px;` : ''}
                    >
                        {@html streamMsgDisplay}
                    </div>
                {/if}

                <div class="ai-message__running-indicator" aria-live="polite">
                    <span class="jumping-dots jumping-dots--small">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                    </span>
                    <span class="ai-message__running-text">运行中...</span>
                </div>
            </div>
        {/if}

        <!-- 多模型响应 -->
        {#if !isCodexMode && multiModelResponses.length > 0}
            <div class="ai-sidebar__multi-model-responses">
                <div class="ai-sidebar__multi-model-header">
                    <div class="ai-sidebar__multi-model-header-top">
                        <h3>{t('multiModel.responses')}</h3>
                        <div class="ai-sidebar__multi-model-layout-selector">
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'card'}
                                on:click={() => (multiModelLayout = 'card')}
                                title={t('multiModel.layout.card')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconSplitLR"></use>
                                </svg>
                                {t('multiModel.layout.card')}
                            </button>
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                class:b3-button--primary={multiModelLayout === 'tab'}
                                on:click={() => (multiModelLayout = 'tab')}
                                title={t('multiModel.layout.tab')}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconSplitTB"></use>
                                </svg>
                                {t('multiModel.layout.tab')}
                            </button>
                        </div>
                    </div>
                    {#if isWaitingForAnswerSelection}
                        <div class="ai-sidebar__multi-model-hint">
                            {t('multiModel.waitingSelection')}
                        </div>
                    {/if}
                </div>
                {#if multiModelLayout === 'card'}
                    <div class="ai-sidebar__multi-model-cards">
                        {#each multiModelResponses as response, index}
                            <div
                                class="ai-sidebar__multi-model-card"
                                class:ai-sidebar__multi-model-card--selected={selectedAnswerIndex ===
                                    index}
                            >
                                <div class="ai-sidebar__multi-model-card-header">
                                    <div class="ai-sidebar__multi-model-card-title">
                                        <span class="ai-sidebar__multi-model-card-model-name">
                                            {response.modelName}
                                            {#if selectedAnswerIndex === index}
                                                <span
                                                    class="ai-sidebar__multi-model-selected-indicator"
                                                >
                                                    ✅
                                                </span>
                                            {/if}
                                        </span>
                                        {#if response.isLoading}
                                            <span
                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--loading"
                                            >
                                                ⏳ {t('multiModel.loading')}
                                            </span>
                                        {:else if response.error}
                                            <span
                                                class="ai-sidebar__multi-model-card-status ai-sidebar__multi-model-card-status--error"
                                            >
                                                ❌ {t('multiModel.error')}
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="ai-sidebar__multi-model-card-actions">
                                        {#if !response.isLoading && !response.error}
                                            <button
                                                class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                on:click={() => copyMessage(response.content || '')}
                                                title={t('aiSidebar.actions.copyMessage')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconCopy"></use>
                                                </svg>
                                            </button>
                                        {/if}
                                        {#if !response.isLoading && isWaitingForAnswerSelection}
                                            <button
                                                class="b3-button b3-button--text"
                                                on:click={() => regenerateModelResponse(index)}
                                                title={t('aiSidebar.actions.regenerate')}
                                            >
                                                <svg class="b3-button__icon">
                                                    <use xlink:href="#iconRefresh"></use>
                                                </svg>
                                            </button>
                                            <button
                                                class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                class:ai-sidebar__multi-model-select-btn--selected={selectedAnswerIndex ===
                                                    index}
                                                on:click={() => selectMultiModelAnswer(index)}
                                            >
                                                {selectedAnswerIndex === index
                                                    ? t('multiModel.answerSelected')
                                                    : t('multiModel.selectAnswer')}
                                            </button>
                                        {/if}
                                    </div>
                                </div>

                                <!-- 思考过程 -->
                                {#if response.thinking}
                                    <div class="ai-message__thinking">
                                        <div
                                            class="ai-message__thinking-header"
                                            on:click={() => {
                                                multiModelResponses[index].thinkingCollapsed =
                                                    !multiModelResponses[index].thinkingCollapsed;
                                                multiModelResponses = [...multiModelResponses];
                                            }}
                                        >
                                            <svg
                                                class="ai-message__thinking-icon"
                                                class:collapsed={response.thinkingCollapsed}
                                            >
                                                <use xlink:href="#iconRight"></use>
                                            </svg>
                                            <span class="ai-message__thinking-title">
                                                💭 {t('aiSidebar.messages.thinking')}
                                            </span>
                                        </div>
                                        {#if !response.thinkingCollapsed}
                                            {@const streamCardThink = getThinkingDisplayContent(
                                                response.thinking
                                            )}
                                            <div class="ai-message__thinking-content b3-typography">
                                                {@html streamCardThink}
                                            </div>
                                        {/if}
                                    </div>
                                {/if}

                                <div
                                    class="ai-sidebar__multi-model-card-content b3-typography"
                                    style={messageFontSize
                                        ? `font-size: ${messageFontSize}px;`
                                        : ''}
                                    on:contextmenu={e =>
                                        handleContextMenu(e, index, 'assistant', true)}
                                >
                                    {#if response.error}
                                        <div class="ai-sidebar__multi-model-card-error">
                                            {response.error}
                                        </div>
                                    {:else if response.content}
                                        {@const streamCardContent = getDisplayContent(
                                            response.content
                                        )}
                                        {@html streamCardContent}
                                    {:else if response.isLoading}
                                        <div class="ai-sidebar__multi-model-card-loading">
                                            <span class="jumping-dots">
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                            </span>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="ai-sidebar__multi-model-tabs">
                        <div class="ai-sidebar__multi-model-tab-headers">
                            {#each multiModelResponses as response, index}
                                <button
                                    class="ai-sidebar__multi-model-tab-header"
                                    class:ai-sidebar__multi-model-tab-header--active={selectedTabIndex ===
                                        index}
                                    on:click={() => (selectedTabIndex = index)}
                                >
                                    <span class="ai-sidebar__multi-model-tab-title">
                                        {response.modelName}
                                        {#if selectedAnswerIndex === index}
                                            <span
                                                class="ai-sidebar__multi-model-selected-indicator"
                                            >
                                                ✅
                                            </span>
                                        {/if}
                                    </span>
                                    {#if response.isLoading}
                                        <span
                                            class="ai-sidebar__multi-model-tab-status ai-sidebar__multi-model-tab-status--loading"
                                        >
                                            <span class="jumping-dots jumping-dots--small">
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                                <span class="dot"></span>
                                            </span>
                                        </span>
                                    {:else if response.error}
                                        <span
                                            class="ai-sidebar__multi-model-tab-status ai-sidebar__multi-model-tab-status--error"
                                        >
                                            ❌
                                        </span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                        <div class="ai-sidebar__multi-model-tab-content">
                            {#if multiModelResponses[selectedTabIndex]}
                                {@const response = multiModelResponses[selectedTabIndex]}
                                <div class="ai-sidebar__multi-model-tab-panel">
                                    <div class="ai-sidebar__multi-model-tab-panel-header">
                                        <div class="ai-sidebar__multi-model-tab-panel-title">
                                            <span
                                                class="ai-sidebar__multi-model-tab-panel-model-name"
                                            >
                                                {response.modelName}
                                                {#if selectedAnswerIndex === selectedTabIndex}
                                                    <span
                                                        class="ai-sidebar__multi-model-selected-indicator"
                                                    >
                                                        ✅
                                                    </span>
                                                {/if}
                                            </span>
                                            {#if response.isLoading}
                                                <span
                                                    class="ai-sidebar__multi-model-tab-panel-status ai-sidebar__multi-model-tab-panel-status--loading"
                                                >
                                                    <span class="jumping-dots jumping-dots--small">
                                                        <span class="dot"></span>
                                                        <span class="dot"></span>
                                                        <span class="dot"></span>
                                                    </span>
                                                </span>
                                            {:else if response.error}
                                                <span
                                                    class="ai-sidebar__multi-model-tab-panel-status ai-sidebar__multi-model-tab-panel-status--error"
                                                >
                                                    ❌ {t('multiModel.error')}
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="ai-sidebar__multi-model-tab-panel-actions">
                                            {#if !response.isLoading && !response.error}
                                                <button
                                                    class="b3-button b3-button--text ai-sidebar__multi-model-copy-btn"
                                                    on:click={() =>
                                                        copyMessage(response.content || '')}
                                                    title={t('aiSidebar.actions.copyMessage')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconCopy"></use>
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#if !response.isLoading && isWaitingForAnswerSelection}
                                                <button
                                                    class="b3-button b3-button--text"
                                                    on:click={() =>
                                                        regenerateModelResponse(selectedTabIndex)}
                                                    title={t('aiSidebar.actions.regenerate')}
                                                >
                                                    <svg class="b3-button__icon">
                                                        <use xlink:href="#iconRefresh"></use>
                                                    </svg>
                                                </button>
                                                <button
                                                    class="b3-button b3-button--primary ai-sidebar__multi-model-select-btn"
                                                    class:ai-sidebar__multi-model-select-btn--selected={selectedAnswerIndex ===
                                                        selectedTabIndex}
                                                    on:click={() =>
                                                        selectMultiModelAnswer(selectedTabIndex)}
                                                >
                                                    {selectedAnswerIndex === selectedTabIndex
                                                        ? t('multiModel.answerSelected')
                                                        : t('multiModel.selectAnswer')}
                                                </button>
                                            {/if}
                                        </div>
                                    </div>

                                    {#if response.thinking}
                                        <div class="ai-message__thinking">
                                            <div
                                                class="ai-message__thinking-header"
                                                on:click={() => {
                                                    multiModelResponses[
                                                        selectedTabIndex
                                                    ].thinkingCollapsed =
                                                        !multiModelResponses[selectedTabIndex]
                                                            .thinkingCollapsed;
                                                    multiModelResponses = [...multiModelResponses];
                                                }}
                                            >
                                                <svg
                                                    class="ai-message__thinking-icon"
                                                    class:collapsed={response.thinkingCollapsed}
                                                >
                                                    <use xlink:href="#iconRight"></use>
                                                </svg>
                                                <span class="ai-message__thinking-title">
                                                    💭 {t('aiSidebar.messages.thinking')}
                                                </span>
                                            </div>
                                            {#if !response.thinkingCollapsed}
                                                {@const streamTabThink = getThinkingDisplayContent(
                                                    response.thinking
                                                )}
                                                <div
                                                    class="ai-message__thinking-content b3-typography"
                                                >
                                                    {@html streamTabThink}
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}

                                    <div
                                        class="ai-sidebar__multi-model-tab-panel-content b3-typography"
                                        style={messageFontSize
                                            ? `font-size: ${messageFontSize}px;`
                                            : ''}
                                        on:contextmenu={e =>
                                            handleContextMenu(
                                                e,
                                                selectedTabIndex,
                                                'assistant',
                                                true
                                            )}
                                    >
                                        {#if response.error}
                                            <div class="ai-sidebar__multi-model-tab-panel-error">
                                                {response.error}
                                            </div>
                                        {:else if response.content}
                                            {@const streamTabContent = getDisplayContent(
                                                response.content
                                            )}
                                            {@html streamTabContent}
                                        {:else if response.isLoading}
                                            <div class="ai-sidebar__multi-model-tab-panel-loading">
                                                {t('multiModel.loading')}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        {#if !autoScroll || hasUnreadMessagesBelow}
            <div class="ai-sidebar__scroll-to-bottom">
                <button
                    class="b3-button b3-button--primary b3-button--small ai-sidebar__scroll-to-bottom-btn"
                    on:click={jumpToBottom}
                    title={t('aiSidebar.actions.scrollToBottom')}
                >
                    <span class="ai-sidebar__scroll-to-bottom-text">
                        {t('aiSidebar.actions.scrollToBottom')}
                    </span>
                    {#if hasUnreadMessagesBelow}
                        <span class="ai-sidebar__scroll-to-bottom-badge">
                            {t('aiSidebar.messages.newMessages') || '●'}
                        </span>
                    {/if}
                </button>
            </div>
        {/if}

        {#if messages.filter(msg => msg.role !== 'system').length === 0 && !isLoading}
            <div class="ai-sidebar__empty">
                <div class="ai-sidebar__empty-icon">💬</div>
                <p>{t('aiSidebar.empty.greeting')}</p>
            </div>
        {/if}
    </div>

    <!-- 上下文文档和附件列表 -->
    {#if contextDocuments.length > 0 || currentAttachments.length > 0}
        <div
            class="ai-sidebar__context-docs"
            class:ai-sidebar__context-docs--drag-over={isDragOver && contextDocuments.length > 0}
            on:dragover={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
        >
            <div class="ai-sidebar__context-docs-title">📎 {t('aiSidebar.context.content')}</div>
            <div class="ai-sidebar__context-docs-list">
                <!-- 显示上下文文档 -->
                {#each contextDocuments as doc (doc.id)}
                    <div class="ai-sidebar__context-doc-item">
                        <button
                            class="ai-sidebar__context-doc-remove"
                            on:click={() => removeContextDocument(doc.id)}
                            title={t('aiSidebar.context.remove') || 'Remove'}
                        >
                            ×
                        </button>
                        <button
                            class="ai-sidebar__context-doc-link"
                            on:click={() => openDocument(doc.id)}
                            title={t('aiSidebar.context.open') || 'Open'}
                        >
                            📄 {doc.title}
                        </button>
                        <button
                            class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                            on:click|stopPropagation={() => copyMessage(doc.content || '')}
                            title={t('aiSidebar.actions.copyMessage')}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        </button>
                    </div>
                {/each}

                <!-- 显示当前附件 -->
                {#each currentAttachments as attachment, index}
                    <div class="ai-sidebar__context-doc-item">
                        <button
                            class="ai-sidebar__context-doc-remove"
                            on:click={() => removeAttachment(index)}
                            title={t('aiSidebar.attachment.remove') || 'Remove attachment'}
                        >
                            ×
                        </button>
                        {#if attachment.type === 'image'}
                            <img
                                src={attachment.data}
                                alt={attachment.name}
                                class="ai-sidebar__context-attachment-preview"
                                title={attachment.name}
                            />
                            <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                🖼️ {attachment.name}
                            </span>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    navigator.clipboard.writeText(attachment.data);
                                    pushMsg(t('aiSidebar.success.copyImageUrl') || 'Image URL copied');
                                }}
                                title={t('aiSidebar.actions.copyImageUrl') || 'Copy image URL'}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {:else if attachment.isWebPage}
                            <span class="ai-sidebar__context-attachment-icon-emoji">🔗</span>
                            <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                {attachment.name}
                            </span>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    navigator.clipboard.writeText(attachment.data);
                                    pushMsg(
                                        t('aiSidebar.success.copyWebMarkdown') ||
                                            'Web page markdown copied'
                                    );
                                }}
                                title={
                                    t('aiSidebar.actions.copyWebMarkdown') ||
                                    'Copy web page markdown'
                                }
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {:else}
                            <svg class="ai-sidebar__context-attachment-icon">
                                <use xlink:href="#iconFile"></use>
                            </svg>
                            <span class="ai-sidebar__context-doc-name" title={attachment.name}>
                                📄 {attachment.name}
                            </span>
                            <button
                                class="b3-button b3-button--text ai-sidebar__context-doc-copy"
                                on:click|stopPropagation={() => {
                                    navigator.clipboard.writeText(attachment.data);
                                    pushMsg(
                                        t('aiSidebar.success.copyFileContent') || 'File content copied'
                                    );
                                }}
                                title={t('aiSidebar.actions.copyFileContent') || 'Copy file content'}
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                            </button>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    {/if}
    <div
        class="ai-sidebar__input-container"
        class:ai-sidebar__input-container--drag-over={isDragOver && contextDocuments.length === 0}
        bind:this={inputContainer}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:drop={handleDrop}
    >
        <!-- 模式选择 -->
        <div class="ai-sidebar__mode-selector">
            <label for="chat-mode-select" class="ai-sidebar__mode-label">
                {t('aiSidebar.mode.label')}:
            </label>
            <select
                id="chat-mode-select"
                class="b3-select ai-sidebar__mode-select"
                bind:value={chatMode}
                on:change={e => void updateChatModeSetting(e.target.value)}
            >
                {#each CODEX_CHAT_MODES as modeOption}
                    <option value={modeOption}>
                        {t(`aiSidebar.mode.${modeOption}`)}
                    </option>
                {/each}
            </select>
            <div class="ai-sidebar__codex-inline-controls">
                <label class="ai-sidebar__codex-field">
                    <span>{t('aiSidebar.codex.modelOverride') || '模型'}</span>
                    <select
                        class="b3-select ai-sidebar__codex-input"
                        value={settings?.codexModelOverride || ''}
                        on:change={e =>
                            updateCodexInlineSetting('codexModelOverride', e.target.value)}
                    >
                        <option value="">
                            {t('aiSidebar.codex.modelOverridePlaceholder') || '默认'}
                        </option>
                        {#if settings?.codexModelOverride &&
                            !codexModelOptions.includes(settings.codexModelOverride)}
                            <option value={settings?.codexModelOverride}>
                                {settings?.codexModelOverride}
                            </option>
                        {/if}
                        {#each codexModelOptions as model}
                            <option value={model}>{model}</option>
                        {/each}
                    </select>
                </label>
                <label class="ai-sidebar__codex-field">
                    <span>{t('settings.codex.reasoningEffort.title') || '思考'}</span>
                    <select
                        class="b3-select ai-sidebar__codex-input"
                        value={settings?.codexReasoningEffort || ''}
                        on:change={e =>
                            updateCodexInlineSetting('codexReasoningEffort', e.target.value)}
                    >
                        <option value="">
                            {t('settings.codex.reasoningEffort.options.default') || '默认'}
                        </option>
                        <option value="low">
                            {t('settings.codex.reasoningEffort.options.low') || 'low'}
                        </option>
                        <option value="medium">
                            {t('settings.codex.reasoningEffort.options.medium') || 'medium'}
                        </option>
                        <option value="high">
                            {t('settings.codex.reasoningEffort.options.high') || 'high'}
                        </option>
                        <option value="xhigh">
                            {t('settings.codex.reasoningEffort.options.xhigh') || 'xhigh'}
                        </option>
                    </select>
                </label>
                <button
                    class="b3-button b3-button--text ai-sidebar__codex-toolcheck-btn"
                    on:click={() => refreshCodexModelOptions(true)}
                    disabled={isLoadingCodexModels}
                    title={t('aiSidebar.codex.refreshModels') || 'Refresh models'}
                >
                    {isLoadingCodexModels
                        ? t('aiSidebar.codex.refreshModelsLoading') || 'Refreshing...'
                        : t('aiSidebar.codex.refreshModels') || 'Refresh'}
                </button>
                {#if codexNativeContextPercent !== null}
                    <span
                        class="ai-sidebar__codex-context-usage"
                        title={(t('aiSidebar.codex.nativeContextUsageTitle') ||
                            'Codex 原生返回的上下文占用：{source}').replace(
                            '{source}',
                            codexNativeContextSource || 'event'
                        )}
                    >
                        {(t('aiSidebar.codex.nativeContextUsage') || '上下文 {percent}%（原生）').replace(
                            '{percent}',
                            (Math.round(codexNativeContextPercent * 10) / 10)
                                .toFixed(1)
                                .replace(/\.0$/, '')
                        )}
                    </span>
                {/if}
            </div>
            {#if codexModelLoadError}
                <span class="ai-sidebar__codex-error">
                    {(t('aiSidebar.codex.modelLoadError') || 'Local model load error: {error}').replace(
                        '{error}',
                        codexModelLoadError
                    )}
                </span>
            {/if}
        </div>
        <div class="ai-sidebar__input-row">
            <div class="ai-sidebar__input-wrapper">
                <textarea
                    bind:this={textareaElement}
                    bind:value={currentInput}
                    on:keydown={handleKeydown}
                    on:paste={handlePaste}
                    placeholder={t('aiSidebar.input.placeholder')}
                    class="ai-sidebar__input"
                    rows="1"
                    spellcheck="false"
                ></textarea>
                <button
                    class="ai-sidebar__send-btn"
                    on:click={handleSendButtonClick}
                    disabled={
                        (!isLoading && !currentInput.trim() && currentAttachments.length === 0) ||
                        (isLoading && !hasComposedPayloadForSend())
                    }
                    title={shouldQueueCurrentDraft()
                        ? t('aiSidebar.actions.queue')
                        : isLoading
                          ? t('aiSidebar.actions.queue')
                          : t('aiSidebar.actions.send')}
                    aria-label={shouldQueueCurrentDraft()
                        ? t('aiSidebar.actions.queue')
                        : isLoading
                          ? t('aiSidebar.actions.queue')
                          : t('aiSidebar.actions.send')}
                >
                    {#if shouldQueueCurrentDraft()}
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconAdd"></use>
                        </svg>
                    {:else if isLoading}
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconAdd"></use>
                        </svg>
                    {:else}
                        <svg class="b3-button__icon"><use xlink:href="#iconUp"></use></svg>
                    {/if}
                    {#if queuedCodexSendDrafts.length > 0}
                        <span class="ai-sidebar__send-queue-badge">{queuedCodexSendDrafts.length}</span>
                    {/if}
                </button>
            </div>
        </div>
        {#if isLoading}
            <div class="ai-sidebar__queue-hint" role="status" aria-live="polite">
                <span>
                    {#if shouldQueueCurrentDraft()}
                        {t('aiSidebar.codex.queue.readyHint') ||
                            '检测到新草稿：点击发送将加入队列（不会中断当前任务）'}
                    {:else}
                        {t('aiSidebar.codex.queue.emptyHint') ||
                            '当前任务运行中：先输入新内容再点发送可加入队列；若要停止请点右侧暂停按钮'}
                    {/if}
                </span>
                <button
                    class="b3-button b3-button--text ai-sidebar__queue-stop-btn"
                    on:click={abortMessage}
                    title={t('aiSidebar.actions.stop')}
                    aria-label={t('aiSidebar.actions.stop')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconPause"></use></svg>
                </button>
            </div>
        {/if}

        <!-- 隐藏的文件上传 input -->
        <input
            type="file"
            bind:this={fileInputElement}
            on:change={handleFileSelect}
            accept="image/*,.txt,.md,.json,.xml,.csv,text/*"
            multiple
            style="display: none;"
        />
        <div class="ai-sidebar__bottom-row">
            <button
                class="b3-button b3-button--text ai-sidebar__upload-btn"
                on:click={triggerFileUpload}
                disabled={isUploadingFile || isLoading}
                title={t('aiSidebar.actions.upload')}
            >
                {#if isUploadingFile}
                    <svg class="b3-button__icon ai-sidebar__loading-icon">
                        <use xlink:href="#iconRefresh"></use>
                    </svg>
                {:else}
                    <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>
                {/if}
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__weblink-btn"
                on:click={openWebLinkDialog}
                disabled={isFetchingWebContent || isLoading}
                title={t('aiSidebar.actions.addWebLink')}
            >
                {#if isFetchingWebContent}
                    <svg class="b3-button__icon ai-sidebar__loading-icon">
                        <use xlink:href="#iconRefresh"></use>
                    </svg>
                {:else}
                    <svg class="b3-button__icon"><use xlink:href="#iconLink"></use></svg>
                {/if}
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__search-btn"
                on:click={toggleSearchDialog}
                title={t('aiSidebar.actions.search')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSearch"></use></svg>
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__codex-toolcheck-btn ai-sidebar__bottom-action-btn"
                on:click={runCodexToolSelfCheck}
                disabled={isCheckingCodexTools || isLoading}
                title={t('aiSidebar.codex.toolCheck') || '工具自检'}
            >
                {#if isCheckingCodexTools}
                    {t('aiSidebar.codex.toolCheckRunning') || '自检中...'}
                {:else}
                    {t('aiSidebar.codex.toolCheck') || '自检'}
                {/if}
            </button>
            <button
                class="b3-button b3-button--text ai-sidebar__codex-settings-btn ai-sidebar__bottom-action-btn"
                on:click={openSettings}
                disabled={isLoading}
                title={t('aiSidebar.actions.settings')}
            >
                <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
            </button>
        </div>
    </div>

    <!-- 网页链接对话框 -->
    {#if isWebLinkDialogOpen}
        <div class="ai-sidebar__prompt-dialog">
            <div class="ai-sidebar__prompt-dialog-overlay" on:click={closeWebLinkDialog}></div>
            <div class="ai-sidebar__prompt-dialog-content" role="dialog" aria-modal="true">
                <div class="ai-sidebar__prompt-dialog-header">
                    <h4>{t('aiSidebar.webLink.title')}</h4>
                    <button
                        bind:this={webLinkDialogCloseButton}
                        class="b3-button b3-button--text"
                        on:click={closeWebLinkDialog}
                        aria-label={t('common.close') || 'Close'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__prompt-dialog-body">
                    <div class="ai-sidebar__prompt-form">
                        <div class="ai-sidebar__prompt-form-field">
                            <div class="ai-sidebar__prompt-form-label">
                                {t('aiSidebar.webLink.label')}
                            </div>
                            <textarea
                                bind:this={webLinkDialogTextareaElement}
                                bind:value={webLinkInput}
                                placeholder={t('aiSidebar.webLink.placeholder')}
                                class="b3-text-field ai-sidebar__prompt-textarea"
                                rows="10"
                                disabled={isFetchingWebContent}
                            ></textarea>
                            <div
                                style="margin-top: 8px; font-size: 12px; color: var(--b3-theme-on-surface-light);"
                            >
                                💡 {t('aiSidebar.webLink.hintTitle')}
                                <ul style="margin: 4px 0; padding-left: 20px;">
                                    <li>{t('aiSidebar.webLink.hintCors')}</li>
                                </ul>
                            </div>
                        </div>
                        <div class="ai-sidebar__prompt-form-actions">
                            <button
                                class="b3-button b3-button--cancel"
                                on:click={closeWebLinkDialog}
                                disabled={isFetchingWebContent}
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                class="b3-button b3-button--primary"
                                on:click={fetchWebPages}
                                disabled={isFetchingWebContent || !webLinkInput.trim()}
                            >
                                {isFetchingWebContent
                                    ? t('aiSidebar.webLink.fetching')
                                    : t('aiSidebar.webLink.fetch')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- 搜索对话框 -->
    {#if isSearchDialogOpen}
        <div class="ai-sidebar__search-dialog">
            <div
                class="ai-sidebar__search-dialog-overlay"
                on:click={closeSearchDialog}
            ></div>
            <div class="ai-sidebar__search-dialog-content" role="dialog" aria-modal="true">
                <div class="ai-sidebar__search-dialog-header">
                    <h4>{t('aiSidebar.search.title')}</h4>
                    <button
                        class="b3-button b3-button--text"
                        on:click={closeSearchDialog}
                        aria-label={t('common.close') || 'Close'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__search-dialog-body">
                    <div class="ai-sidebar__search-input-row">
                        <input
                            type="text"
                            bind:this={searchDialogInputElement}
                            bind:value={searchKeyword}
                            on:input={autoSearch}
                            on:paste={autoSearch}
                            placeholder={t('aiSidebar.search.placeholder')}
                            class="b3-text-field"
                        />
                        {#if isSearching}
                            <div class="ai-sidebar__search-loading">
                                <svg class="b3-button__icon ai-sidebar__loading-icon">
                                    <use xlink:href="#iconRefresh"></use>
                                </svg>
                            </div>
                        {/if}
                    </div>
                    <div class="ai-sidebar__search-results">
                        {#if searchResults.length > 0}
                            {#each searchResults as result (result.id)}
                                <div class="ai-sidebar__search-result-item">
                                    <div class="ai-sidebar__search-result-title">
                                        {result.content || t('common.untitled')}
                                        {#if !searchKeyword.trim()}
                                            <span class="ai-sidebar__search-current-doc-badge">
                                                {t('aiSidebar.search.currentDoc')}
                                            </span>
                                        {/if}
                                    </div>
                                    <button
                                        class="b3-button b3-button--text"
                                        on:click={() =>
                                            addDocumentToContext(
                                                result.id,
                                                result.content || t('common.untitled')
                                            )}
                                    >
                                        {t('aiSidebar.search.add')}
                                    </button>
                                </div>
                            {/each}
                        {:else if !isSearching && searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {t('aiSidebar.search.noResults')}
                            </div>
                        {:else if !isSearching && !searchKeyword}
                            <div class="ai-sidebar__search-empty">
                                {t('aiSidebar.search.noCurrentDoc')}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- 差异对比对话框 -->
    {#if isDiffDialogOpen && currentDiffOperation}
        <div class="ai-sidebar__diff-dialog">
            <div class="ai-sidebar__diff-dialog-overlay" on:click={closeDiffDialog}></div>
            <div
                class="ai-sidebar__diff-dialog-content"
                class:ai-sidebar__diff-dialog-content--wrap={diffDialogWrapEnabled}
                role="dialog"
                aria-modal="true"
            >
                <div class="ai-sidebar__diff-dialog-header">
                    <h3>
                        {#if currentDiffOperation.operationType === 'insert'}
                            {t('aiSidebar.edit.insertBlock')} - {t('aiSidebar.actions.viewDiff')}
                        {:else}
                            {t('aiSidebar.actions.viewDiff')}
                        {/if}
                    </h3>
                    <button
                        bind:this={diffDialogCloseButton}
                        class="b3-button b3-button--cancel"
                        type="button"
                        on:click={closeDiffDialog}
                        aria-label={t('common.close') || 'Close'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
                <div class="ai-sidebar__diff-dialog-body">
                    <div class="ai-sidebar__diff-info">
                        {#if currentDiffOperation.filePath}
                            <strong>File:</strong>
                            {currentDiffOperation.filePath}
                            <br />
                        {:else}
                            <strong>Target:</strong>
                            {currentDiffOperation.blockId}
                            <br />
                        {/if}
                        <strong>Diff:</strong>
                        +{diffDialogStats.added}
                        -{diffDialogStats.removed}
                        <span class="ai-sidebar__diff-engine-badge" title={diffDialogGitError || ''}>
                            {diffDialogEngine === 'git' ? 'git' : 'lcs'}
                            {#if isDiffDialogLinesLoading}
                                · {t('common.loading')}
                            {/if}
                        </span>
                        <br />
                        {#if currentDiffOperation.operationType === 'insert'}
                            <strong>{t('aiSidebar.edit.insertBlock')}:</strong>
                            {currentDiffOperation.position === 'before'
                                ? t('aiSidebar.edit.before')
                                : t('aiSidebar.edit.after')}
                        {/if}
                    </div>
                    <div class="ai-sidebar__diff-toolbar">
                        <div class="ai-sidebar__diff-toolbar-left">
                            <div class="ai-sidebar__diff-toolbar-group">
                                <button
                                    class="b3-button b3-button--outline b3-button--small"
                                    class:ai-sidebar__diff-toolbar-btn--active={diffDialogViewMode ===
                                        'split'}
                                    on:click={() => (diffDialogViewMode = 'split')}
                                    type="button"
                                >
                                    {t('aiSidebar.diff.modeSplit') || 'Split'}
                                </button>
                                <button
                                    class="b3-button b3-button--outline b3-button--small"
                                    class:ai-sidebar__diff-toolbar-btn--active={diffDialogViewMode ===
                                        'unified'}
                                    on:click={() => (diffDialogViewMode = 'unified')}
                                    type="button"
                                >
                                    {t('aiSidebar.diff.modeUnified') || 'Unified'}
                                </button>
                            </div>

                            <button
                                class="b3-button b3-button--outline b3-button--small"
                                on:click={() => (diffDialogWrapEnabled = !diffDialogWrapEnabled)}
                                type="button"
                            >
                                {diffDialogWrapEnabled
                                    ? t('aiSidebar.diff.wrapOff') || 'Disable wrapping'
                                    : t('aiSidebar.diff.wrapOn') || 'Wrap lines'}
                            </button>

                            <button
                                class="b3-button b3-button--outline b3-button--small"
                                on:click={() => {
                                    diffDialogExpandedFoldIds = diffDialogExpandedFoldIds.has(
                                        '__all__'
                                    )
                                        ? new Set()
                                        : new Set(['__all__']);
                                }}
                                type="button"
                            >
                                {diffDialogExpandedFoldIds.has('__all__')
                                    ? t('aiSidebar.diff.collapseContext') || 'Collapse context'
                                    : t('aiSidebar.diff.expandContext') || 'Expand context'}
                            </button>
                        </div>

                        <div class="ai-sidebar__diff-toolbar-right">
                            {#if currentDiffOperation.operationType !== 'insert' &&
                                String(currentDiffOperation.oldContent || '').trim()}
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        navigator.clipboard.writeText(currentDiffOperation.oldContent);
                                        pushMsg(t('aiSidebar.success.copySuccess'));
                                    }}
                                    title={t('aiSidebar.actions.copyOldContent')}
                                    type="button"
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {t('aiSidebar.actions.copyBefore')}
                                </button>
                            {/if}
                            <button
                                class="b3-button b3-button--text b3-button--small"
                                on:click={() => {
                                    navigator.clipboard.writeText(currentDiffOperation.newContent);
                                    pushMsg(t('aiSidebar.success.copySuccess'));
                                }}
                                title={t('aiSidebar.actions.copyNewContent')}
                                type="button"
                            >
                                <svg class="b3-button__icon">
                                    <use xlink:href="#iconCopy"></use>
                                </svg>
                                {currentDiffOperation.operationType === 'insert'
                                    ? t('aiSidebar.actions.copy')
                                    : t('aiSidebar.actions.copyAfter')}
                            </button>
                            {#if diffDialogEngine === 'git' && diffDialogUnifiedPatch}
                                <button
                                    class="b3-button b3-button--text b3-button--small"
                                    on:click={() => {
                                        navigator.clipboard.writeText(diffDialogUnifiedPatch);
                                        pushMsg(t('aiSidebar.success.copySuccess'));
                                    }}
                                    title={t('aiSidebar.actions.copyPatch') || 'Copy patch'}
                                    type="button"
                                >
                                    <svg class="b3-button__icon">
                                        <use xlink:href="#iconCopy"></use>
                                    </svg>
                                    {t('aiSidebar.actions.copyPatch') || 'Patch'}
                                </button>
                            {/if}
                        </div>
                    </div>

                    {#if isDiffDialogLinesLoading && diffDialogLines.length === 0}
                        <div class="ai-sidebar__diff-loading">
                            {t('common.loading')}
                        </div>
                    {:else}
                        {#if diffDialogViewMode === 'unified'}
                            <div
                                class="ai-sidebar__diff-unified-content"
                                class:ai-sidebar__diff-wrap={diffDialogWrapEnabled}
                                class:ai-sidebar__diff-nowrap={!diffDialogWrapEnabled}
                            >
                                {#each diffDialogVisibleTokens as token}
                                    {#if token.kind === 'fold'}
                                        <button
                                            class="ai-sidebar__diff-fold-row"
                                            on:click={() => expandDiffDialogFold(token.id)}
                                            title={t('aiSidebar.diff.expandContext') || 'Expand context'}
                                            type="button"
                                        >
                                            {formatDiffDialogCollapsedLines(token.hiddenCount)}
                                        </button>
                                    {:else}
                                        <div
                                            class="ai-sidebar__diff-unified-line ai-sidebar__diff-unified-line--{token.type}"
                                        >
                                            <span
                                                class="ai-sidebar__diff-lineno"
                                                title={t('aiSidebar.diff.lineNumbers') || 'Line numbers'}
                                            >
                                                {token.oldNo ?? ''}
                                            </span>
                                            <span
                                                class="ai-sidebar__diff-lineno"
                                                title={t('aiSidebar.diff.lineNumbers') || 'Line numbers'}
                                            >
                                                {token.newNo ?? ''}
                                            </span>
                                            <span class="ai-sidebar__diff-marker">
                                                {token.type === 'added'
                                                    ? '+'
                                                    : token.type === 'removed'
                                                      ? '-'
                                                      : '·'}
                                            </span>
                                            <span class="ai-sidebar__diff-text">{token.line}</span>
                                        </div>
                                    {/if}
                                {/each}
                            </div>
                        {:else}
                            <div class="ai-sidebar__diff-split ai-sidebar__diff-split--with-diff">
                                <div class="ai-sidebar__diff-split-column">
                                    <div class="ai-sidebar__diff-split-header">
                                        <span>{t('aiSidebar.edit.before')}</span>
                                    </div>
                                    <div
                                        class="ai-sidebar__diff-split-content ai-sidebar__diff-split-content--diff"
                                        class:ai-sidebar__diff-wrap={diffDialogWrapEnabled}
                                        class:ai-sidebar__diff-nowrap={!diffDialogWrapEnabled}
                                    >
                                        {#each diffDialogVisibleSplitRows as row}
                                            {#if row.kind === 'fold'}
                                                <button
                                                    class="ai-sidebar__diff-fold-row"
                                                    on:click={() => expandDiffDialogFold(row.id)}
                                                    title={t('aiSidebar.diff.expandContext') ||
                                                        'Expand context'}
                                                    type="button"
                                                >
                                                    {formatDiffDialogCollapsedLines(row.hiddenCount)}
                                                </button>
                                            {:else}
                                                <div
                                                    class="ai-sidebar__diff-split-line ai-sidebar__diff-split-line--{row.leftType}"
                                                >
                                                    <span
                                                        class="ai-sidebar__diff-lineno"
                                                        title={t('aiSidebar.diff.lineNumbers') ||
                                                            'Line numbers'}
                                                    >
                                                        {row.leftNo ?? ''}
                                                    </span>
                                                    <span class="ai-sidebar__diff-marker">
                                                        {row.leftType === 'removed'
                                                            ? '-'
                                                            : row.leftType === 'unchanged'
                                                              ? '·'
                                                              : ''}
                                                    </span>
                                                    <span class="ai-sidebar__diff-text"
                                                        >{row.leftLine}</span
                                                    >
                                                </div>
                                            {/if}
                                        {/each}
                                    </div>
                                </div>
                                <div class="ai-sidebar__diff-split-column">
                                    <div class="ai-sidebar__diff-split-header">
                                        <span>{t('aiSidebar.edit.after')}</span>
                                    </div>
                                    <div
                                        class="ai-sidebar__diff-split-content ai-sidebar__diff-split-content--diff"
                                        class:ai-sidebar__diff-wrap={diffDialogWrapEnabled}
                                        class:ai-sidebar__diff-nowrap={!diffDialogWrapEnabled}
                                    >
                                        {#each diffDialogVisibleSplitRows as row}
                                            {#if row.kind === 'fold'}
                                                <button
                                                    class="ai-sidebar__diff-fold-row"
                                                    on:click={() => expandDiffDialogFold(row.id)}
                                                    title={t('aiSidebar.diff.expandContext') ||
                                                        'Expand context'}
                                                    type="button"
                                                >
                                                    {formatDiffDialogCollapsedLines(row.hiddenCount)}
                                                </button>
                                            {:else}
                                                <div
                                                    class="ai-sidebar__diff-split-line ai-sidebar__diff-split-line--{row.rightType}"
                                                >
                                                    <span
                                                        class="ai-sidebar__diff-lineno"
                                                        title={t('aiSidebar.diff.lineNumbers') ||
                                                            'Line numbers'}
                                                    >
                                                        {row.rightNo ?? ''}
                                                    </span>
                                                    <span class="ai-sidebar__diff-marker">
                                                        {row.rightType === 'added'
                                                            ? '+'
                                                            : row.rightType === 'unchanged'
                                                              ? '·'
                                                              : ''}
                                                    </span>
                                                    <span class="ai-sidebar__diff-text"
                                                        >{row.rightLine}</span
                                                    >
                                                </div>
                                            {/if}
                                        {/each}
                                    </div>
                                </div>
                            </div>
                        {/if}

                        {#if (diffDialogViewMode === 'unified'
                            ? diffDialogHasMoreTokens
                            : diffDialogHasMoreSplitRows) ||
                            diffDialogRenderLimit > DIFF_DIALOG_RENDER_LIMIT_INITIAL}
                            <div class="ai-sidebar__diff-pagination">
                                {#if diffDialogViewMode === 'unified'
                                    ? diffDialogHasMoreTokens
                                    : diffDialogHasMoreSplitRows}
                                    <button
                                        class="b3-button b3-button--outline b3-button--small"
                                        on:click={loadMoreDiffDialogLines}
                                        type="button"
                                    >
                                        {t('aiSidebar.diff.showMore') || 'Show more'}
                                    </button>
                                {/if}
                                {#if diffDialogRenderLimit > DIFF_DIALOG_RENDER_LIMIT_INITIAL}
                                    <button
                                        class="b3-button b3-button--text b3-button--small"
                                        on:click={() =>
                                            (diffDialogRenderLimit =
                                                DIFF_DIALOG_RENDER_LIMIT_INITIAL)}
                                        type="button"
                                    >
                                        {t('aiSidebar.diff.showLess') || 'Show less'}
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    {/if}
                </div>
                <div class="ai-sidebar__diff-dialog-footer">
                    <button class="b3-button b3-button--cancel" on:click={closeDiffDialog}>
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Git 同步对话框 -->
    {#if isGitSyncDialogOpen}
        <div class="ai-sidebar__git-dialog">
            <div class="ai-sidebar__git-dialog-overlay" on:click={closeGitSyncDialog}></div>
            <div class="ai-sidebar__git-dialog-content" role="dialog" aria-modal="true">
                <div class="ai-sidebar__git-dialog-header">
                    <h3>{t('aiSidebar.git.title') || 'Git 同步'}</h3>
                    <button
                        bind:this={gitSyncDialogCloseButton}
                        class="b3-button b3-button--cancel"
                        on:click={closeGitSyncDialog}
                        aria-label={t('common.close') || 'Close'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>

                <div class="ai-sidebar__git-dialog-body">
                    <div class="ai-sidebar__git-tip">
                        {t('aiSidebar.git.authTip') ||
                            '建议使用 SSH remote（git@...）或系统凭据管理器，避免把 Token 写进 URL。'}
                    </div>

                    <div class="ai-sidebar__git-form">
                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">Repo</div>
                            <input
                                bind:this={gitSyncRepoInputElement}
                                class="b3-text-field fn__flex-1"
                                type="text"
                                value={gitRepoDir}
                                placeholder={settings?.codexWorkingDir || ''}
                                on:change={async e => {
                                    gitRepoDir = e.target.value;
                                    await updateGitSettingsPatch({ codexGitRepoDir: gitRepoDir });
                                }}
                            />
                            <button
                                class="b3-button b3-button--outline"
                                on:click={async () => {
                                    gitRepoDir = '';
                                    await updateGitSettingsPatch({ codexGitRepoDir: '' });
                                }}
                                type="button"
                                disabled={gitIsRunning}
                            >
                                {t('aiSidebar.git.useWorkingDir') || '用工作目录'}
                            </button>
                        </div>

                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">Remote</div>
                            <input
                                class="b3-text-field ai-sidebar__git-remote-name"
                                type="text"
                                value={gitRemoteName}
                                placeholder="origin"
                                on:change={async e => {
                                    gitRemoteName = e.target.value;
                                    await updateGitSettingsPatch({
                                        codexGitRemoteName: gitRemoteName,
                                    });
                                }}
                            />
                            <input
                                class="b3-text-field fn__flex-1"
                                type="text"
                                value={gitRemoteUrl}
                                placeholder="git@github.com:user/repo.git"
                                on:change={async e => {
                                    gitRemoteUrl = e.target.value;
                                    await updateGitSettingsPatch({
                                        codexGitRemoteUrl: gitRemoteUrl,
                                    });
                                }}
                            />
                            <button
                                class="b3-button b3-button--outline"
                                on:click={runGitSetRemote}
                                type="button"
                                disabled={gitIsRunning}
                            >
                                {t('aiSidebar.git.setRemote') || '设置 Remote'}
                            </button>
                        </div>

                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">Branch</div>
                            <input
                                class="b3-text-field fn__flex-1"
                                type="text"
                                value={gitBranch}
                                placeholder={t('aiSidebar.git.branchOptional') || '可选，留空用当前分支'}
                                on:change={async e => {
                                    gitBranch = e.target.value;
                                    await updateGitSettingsPatch({
                                        codexGitBranch: gitBranch,
                                    });
                                }}
                            />
                        </div>

                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">
                                {t('aiSidebar.git.scope') || 'Scope'}
                            </div>
                            <select
                                class="b3-select fn__flex-1"
                                value={gitSyncScope}
                                on:change={async e => {
                                    const next = normalizeGitSyncScope(e.target.value) || 'notes';
                                    gitSyncScope = next;
                                    await updateGitSettingsPatch({
                                        codexGitSyncScope: next,
                                    });
                                }}
                            >
                                <option value="notes">
                                    {t('settings.codex.git.syncScope.options.notes') ||
                                        '仅笔记内容（.sy + assets）'}
                                </option>
                                <option value="repo">
                                    {t('settings.codex.git.syncScope.options.repo') ||
                                        '整个仓库（git add -A）'}
                                </option>
                            </select>
                        </div>

                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">Dry-run</div>
                            <label class="fn__flex-1" style="display:flex;align-items:center;gap:8px;">
                                <input
                                    type="checkbox"
                                    checked={gitAutoSyncDryRun}
                                    on:change={async e => {
                                        gitAutoSyncDryRun = !!e.target.checked;
                                        await updateGitSettingsPatch({
                                            codexGitAutoSyncDryRun: gitAutoSyncDryRun,
                                        });
                                    }}
                                />
                                <span style="font-size:12px;opacity:.8;">
                                    {t('aiSidebar.git.dryRunHint') ||
                                        '仅预览命令，不执行 pull/add/commit/push 等写操作'}
                                </span>
                            </label>
                        </div>

                        <div class="ai-sidebar__git-row">
                            <div class="ai-sidebar__git-label">
                                {t('aiSidebar.git.commitMessage') || 'Commit'}
                            </div>
                            <input
                                class="b3-text-field fn__flex-1"
                                type="text"
                                value={gitCommitMessage}
                                placeholder={t('aiSidebar.git.commitPlaceholder') || '输入 commit message'}
                                on:change={e => {
                                    gitCommitMessage = e.target.value;
                                }}
                            />
                        </div>
                    </div>

                    <div class="ai-sidebar__git-actions">
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitAutoSync}
                            disabled={gitIsRunning}
                        >
                            {gitIsRunning
                                ? t('aiSidebar.git.autoSyncRunning') || '同步中...'
                                : gitAutoSyncDryRun
                                ? t('aiSidebar.git.autoSyncDryRun') || '一键预演'
                                : t('aiSidebar.git.autoSync') || '一键同步'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitStatus}
                            disabled={gitIsRunning}
                        >
                            {t('aiSidebar.git.status') || 'Status'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitInit}
                            disabled={gitIsRunning}
                        >
                            {t('aiSidebar.git.init') || 'Init'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitAddAll}
                            disabled={gitIsRunning}
                        >
                            {isNotesOnlyGitSync()
                                ? t('aiSidebar.git.addNotes') || 'Add Notes'
                                : t('aiSidebar.git.addAll') || 'Add -A'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitCommit}
                            disabled={gitIsRunning}
                        >
                            {t('aiSidebar.git.commit') || 'Commit'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitPull}
                            disabled={gitIsRunning}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                            {t('aiSidebar.git.pull') || 'Pull'}
                        </button>
                        <button
                            class="b3-button b3-button--outline"
                            on:click={runGitPush}
                            disabled={gitIsRunning}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconUpload"></use></svg>
                            {t('aiSidebar.git.push') || 'Push'}
                        </button>
                        {#if gitIsRunning}
                            <button
                                class="b3-button b3-button--cancel"
                                on:click={() => gitAbortCurrent?.()}
                            >
                                {t('common.cancel') || 'Cancel'}
                            </button>
                        {/if}
                        <button
                            class="b3-button b3-button--text"
                            on:click={() => {
                                gitLog = '';
                                gitLastExitCode = null;
                            }}
                            disabled={gitIsRunning}
                        >
                            {t('aiSidebar.git.clearLog') || 'Clear'}
                        </button>
                        {#if gitLastExitCode !== null}
                            <span class="ai-sidebar__git-exitcode">exit {gitLastExitCode}</span>
                        {/if}
                    </div>

                    <pre class="ai-sidebar__git-log">
                        {gitLog || (t('aiSidebar.git.noLog') || '')}
                    </pre>
                </div>

                <div class="ai-sidebar__git-dialog-footer">
                    <button class="b3-button b3-button--cancel" on:click={closeGitSyncDialog}>
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- 右键菜单 -->
    {#if contextMenuVisible}
        <div
            class="ai-sidebar__context-menu"
            style="left: {contextMenuX}px; top: {contextMenuY}px;"
        >
            {#if contextMenuIsMultiModel}
                {#if selectionInMessage}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyMarkdownDefault')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyPlainText')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyRichText')}</span>
                    </button>
                {:else}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyMarkdownDefault')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyPlainText')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyRichText')}</span>
                    </button>
                {/if}
            {:else}
                {#if selectionInMessage}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_md')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyMarkdownDefault')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_plain')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyPlainText')}</span>
                    </button>
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy_html')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyRichText')}</span>
                    </button>
                {:else}
                    <button
                        class="ai-sidebar__context-menu-item"
                        on:click={() => handleContextMenuAction('copy')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copyMessage')}</span>
                    </button>
                {/if}

                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('delete')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                    <span>{t('aiSidebar.actions.deleteMessage')}</span>
                </button>
                <button
                    class="ai-sidebar__context-menu-item"
                    on:click={() => handleContextMenuAction('regenerate')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                    <span>
                        {contextMenuMessageType === 'user'
                            ? t('aiSidebar.actions.resend')
                            : t('aiSidebar.actions.regenerate')}
                    </span>
                </button>
            {/if}
        </div>
    {/if}

    <!-- 工具选择器对话框 -->
    {#if isToolSelectorOpen && !isCodexMode}
        <ToolSelector bind:selectedTools on:close={() => (isToolSelectorOpen = false)} />
    {/if}

    <!-- 工具批准对话框 -->
    {#if isToolApprovalDialogOpen && pendingToolCall}
        <div class="tool-approval-dialog__overlay" on:click={rejectToolCall}></div>
        <div class="tool-approval-dialog">
            <div class="tool-approval-dialog__header">
                <h3>{t('tools.waitingApproval')}</h3>
                <button
                    class="b3-button b3-button--text"
                    on:click={rejectToolCall}
                    title={t('common.close')}
                >
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                </button>
            </div>

            <div class="tool-approval-dialog__content">
                <div class="tool-approval-dialog__tool-info">
                    <div class="tool-approval-dialog__tool-name">
                        <svg class="b3-button__icon">
                            <use xlink:href="#iconSettings"></use>
                        </svg>
                        <strong>{getToolDisplayName(pendingToolCall.function.name)}</strong>
                    </div>
                    <div class="tool-approval-dialog__tool-id">
                        ID: {pendingToolCall.id}
                    </div>
                </div>

                <div class="tool-approval-dialog__params">
                    <div class="tool-approval-dialog__section-title">
                        {t('tools.selector.parameters')}:
                    </div>
                    <pre class="tool-approval-dialog__code">{pendingToolCall.function
                            .arguments}</pre>
                </div>

                <div class="tool-approval-dialog__warning">
                    <svg class="b3-button__icon"><use xlink:href="#iconInfo"></use></svg>
                    <span>{t('tools.approvalWarning')}</span>
                </div>
            </div>

            <div class="tool-approval-dialog__footer">
                <button class="b3-button b3-button--cancel" on:click={rejectToolCall}>
                    <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    {t('tools.reject')}
                </button>
                <button class="b3-button b3-button--primary" on:click={approveToolCall}>
                    <svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg>
                    {t('tools.approve')}
                </button>
            </div>
        </div>
    {/if}

    <!-- 图片查看器 -->
    {#if isImageViewerOpen}
        <div class="image-viewer">
            <div class="image-viewer__header">
                <h3 class="image-viewer__title">
                    {currentImageName || t('aiSidebar.attachment.previewTitle') || 'Image preview'}
                </h3>
                <div class="image-viewer__actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={() => copyImageAsPng(currentImageSrc)}
                        title={t('aiSidebar.actions.copyImage') || 'Copy image'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg>
                        <span>{t('aiSidebar.actions.copy') || 'Copy'}</span>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={() =>
                            downloadImage(currentImageSrc, currentImageName || 'image.png')}
                        title={t('aiSidebar.actions.downloadImage') || 'Download image'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconDownload"></use></svg>
                        <span>{t('aiSidebar.actions.download') || 'Download'}</span>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={closeImageViewer}
                        title={t('common.close') || 'Close'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>
            <div class="image-viewer__content">
                <img src={currentImageSrc} alt={currentImageName} class="image-viewer__image" />
            </div>
        </div>
    {/if}

</div>

<style lang="scss">
    @use './styles/copilot-tokens.scss';

    .ai-sidebar {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--b3-theme-background);
        overflow: hidden;
    }

    .ai-sidebar__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
        min-width: 0; /* 允许在flex布局中缩小 */
        flex-wrap: wrap; /* 允许换行显示 */
        gap: 8px; /* 添加间距 */
    }

    .ai-sidebar__title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 1; /* 标题可以缩小 */
        min-width: 0; /* 允许标题缩小 */
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__unsaved {
        color: var(--b3-theme-primary);
        font-size: 12px;
        animation: pulse 2s ease-in-out infinite;
        flex-shrink: 0; /* 防止未保存标记被压缩 */
    }

    .ai-sidebar__actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap; /* 在窄宽度下换行 */
        justify-content: flex-end;
    }

    .ai-sidebar__open-window-menu-container {
        position: relative;
    }

    .ai-sidebar__open-window-menu {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        box-shadow: var(--b3-dialog-shadow);
        z-index: 1000;
        min-width: 150px;
        overflow: hidden;
    }

    .ai-sidebar__open-window-menu .b3-menu__item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        width: 100%;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        color: var(--b3-theme-on-background);
        font-size: 14px;
        transition: background-color 0.2s;

        &:hover {
            background: var(--b3-list-hover);
        }

        .b3-menu__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .b3-menu__label {
            flex: 1;
        }
    }

    .ai-sidebar__context-docs {
        flex-shrink: 0;
    }

    .ai-sidebar__context-docs--drag-over {
        background: var(--b3-theme-primary-lightest);
        border: 2px dashed var(--b3-theme-primary);
    }

    .ai-sidebar__input-container--drag-over {
        background: var(--b3-theme-primary-lightest);
        border: 2px dashed var(--b3-theme-primary) !important;
    }

    .ai-sidebar__context-docs-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: 8px;
    }

    .ai-sidebar__context-docs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        max-height: 250px;
        overflow: auto;
    }

    .ai-sidebar__context-doc-item {
        display: inline-flex;
        align-items: center;
        padding: 4px 4px;
        background: var(--b3-theme-background);
        border-radius: 12px;
        border: 1px solid var(--b3-border-color);
        transition: all 0.2s ease;
        cursor: pointer;
        max-width: 100%;
        position: relative;

        &:hover {
            background: var(--b3-theme-surface);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transform: translateY(-1px);

            .ai-sidebar__context-doc-copy {
                opacity: 1;
            }
        }
    }

    .ai-sidebar__context-doc-remove {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.15s ease;

        &:hover {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
            transform: scale(1.1);
        }
    }

    .ai-sidebar__context-doc-copy {
        position: absolute;
        top: 2px;
        right: 2px;
        padding: 4px;
        border: none;
        background: var(--b3-theme-surface);
        cursor: pointer;
        color: var(--b3-theme-on-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.15s ease;
        opacity: 0;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }

        &:hover {
            color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
            transform: scale(1.1);
        }
    }

    .ai-sidebar__context-doc-link {
        flex: 1;
        text-align: left;
        padding: 0 4px;
        border: none;
        background: none;
        color: var(--b3-theme-primary);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color 0.15s ease;

        &:hover {
            color: var(--b3-theme-primary);
        }
    }

    .ai-sidebar__context-doc-name {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 4px;
    }

    .ai-sidebar__context-attachment-preview {
        width: 28px;
        height: 28px;
        object-fit: cover;
        border-radius: 6px;
        flex-shrink: 0;
        border: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__context-attachment-icon {
        width: 18px;
        height: 18px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .ai-sidebar__context-attachment-icon-emoji {
        font-size: 18px;
        flex-shrink: 0;
        line-height: 1;
    }

    .ai-sidebar__messages {
        flex: 1;
        min-height: 0;
        position: relative;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: background-color 0.2s;

        &.ai-sidebar__messages--drag-over {
            background: var(--b3-theme-primary-lightest);
            border: 2px dashed var(--b3-theme-primary);
        }
    }

    .ai-sidebar__scroll-to-bottom {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 12px;
        display: flex;
        justify-content: center;
        z-index: 20;
        pointer-events: none;
    }

    .ai-sidebar__scroll-to-bottom-btn {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 6px 12px;
        height: auto;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    }

    .ai-sidebar__scroll-to-bottom-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 18px;
        padding: 0 8px;
        border-radius: 9px;
        font-size: 11px;
        font-weight: 600;
        background: var(--b3-theme-background);
        color: var(--b3-theme-primary);
        border: 1px solid var(--b3-theme-primary-light);
        white-space: nowrap;
    }

    .ai-sidebar__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--b3-theme-on-surface-light);
        text-align: center;
    }

    .ai-sidebar__empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }

    .ai-sidebar__empty-hint {
        font-size: 12px;
        margin-top: 8px;
    }

    .ai-message {
        display: flex;
        flex-direction: column;
        gap: 6px;
        animation: fadeIn 0.3s ease-in;
        cursor: context-menu;

        &:hover {
            .ai-message__content {
                box-shadow: 0 0 0 1px var(--copilot-border);
            }
        }
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .ai-message__header {
        display: flex;
        align-items: center;
        margin-bottom: 4px;
    }

    .ai-message__role {
        font-size: 12px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__actions {
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .ai-message:hover .ai-message__actions {
        opacity: 1;
    }

    .ai-message__action {
        flex-shrink: 0;
    }

    // 三个点跳动动画
    .jumping-dots {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 16px;
    }

    .jumping-dots .dot {
        width: 6px;
        height: 6px;
        background-color: var(--b3-theme-primary);
        border-radius: 50%;
        animation: jumping-dot 1.4s ease-in-out infinite both;
    }

    .jumping-dots .dot:nth-child(1) {
        animation-delay: -0.32s;
    }

    .jumping-dots .dot:nth-child(2) {
        animation-delay: -0.16s;
    }

    .jumping-dots .dot:nth-child(3) {
        animation-delay: 0s;
    }

    // 小型跳动点（用于标签页等紧凑空间）
    .jumping-dots--small {
        height: 12px;
        gap: 2px;
    }

    .jumping-dots--small .dot {
        width: 4px;
        height: 4px;
    }

    @keyframes jumping-dot {
        0%,
        80%,
        100% {
            transform: scale(0.6);
            opacity: 0.4;
        }
        40% {
            transform: scale(1);
            opacity: 1;
        }
    }

    // 思考过程样式
    .ai-message__thinking {
        margin-bottom: 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        overflow: hidden;
        background: var(--b3-theme-surface);
    }

    .ai-message__thinking-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--b3-theme-surface);
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-background);
        }
    }

    .ai-message__thinking-icon {
        width: 14px;
        height: 14px;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s;
        transform: rotate(90deg);

        &.collapsed {
            transform: rotate(0deg);
        }
    }

    .ai-message__thinking-title {
        font-size: 12px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__thinking-status {
        margin-left: auto;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__thinking-content {
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.55;
        max-height: 400px;
        overflow-y: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标

        &.ai-message__thinking-content--streaming {
            animation: fadeIn 0.3s ease-out;
        }
    }

    .ai-message__thinking-plain {
        margin: 0;
        padding: 10px 12px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.45;
        color: var(--b3-theme-on-surface-light);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 220px;
        overflow: auto;
    }

    .ai-message__thinking-plain--streaming {
        animation: fadeIn 0.2s ease-out;
    }

    .ai-message__trace {
        margin: 4px 0 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        overflow: hidden;
        background: transparent;
    }

    .ai-message__trace-title {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 500;
        color: var(--b3-theme-on-surface-light);
        background: transparent;
        border-bottom: 1px solid var(--b3-border-color);
        user-select: none;
        letter-spacing: 0.01em;
    }

    .ai-message__trace-title-summary {
        margin-left: auto;
        font-size: 11px;
        font-weight: 400;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 48%;
    }

    .ai-message__trace--streaming .ai-message__trace-title {
        cursor: pointer;
    }

    .ai-message__trace--streaming .ai-message__trace-title:hover {
        background: var(--b3-list-hover);
    }

    .ai-message__trace--search .ai-message__trace-title {
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__trace--timeline .ai-message__trace-title {
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__trace--tool .ai-message__trace-title {
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__trace-item {
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__trace-item:last-child {
        border-bottom: none;
    }

    .ai-message__trace-item-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        cursor: pointer;
        background: transparent;
    }

    .ai-message__trace-item-header:hover {
        background: var(--b3-list-hover);
    }

    .ai-message__trace-item-icon {
        width: 12px;
        height: 12px;
        color: var(--b3-theme-on-surface-light);
        transform: rotate(90deg);
        transition: transform 0.2s;
        flex-shrink: 0;
    }

    .ai-message__trace-item-icon.collapsed {
        transform: rotate(0deg);
    }

    .ai-message__trace-item-name {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        font-weight: 500;
        word-break: break-word;
        line-height: 1.35;
        flex: 1;
        min-width: 0;
    }

    .ai-message__trace-item-kind {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        font-weight: 500;
        flex-shrink: 0;
    }

    .ai-message__trace-item-status {
        margin-left: auto;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        text-transform: lowercase;
    }

    .ai-message__trace-item-diff-stats {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
        flex-shrink: 0;
    }

    .ai-message__trace-item-target {
        margin-left: auto;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 46%;
    }

    .ai-message__trace-item-status--with-target {
        margin-left: 8px;
    }

    .ai-message__trace-item-status::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: currentColor;
        opacity: 0.9;
    }

    .ai-message__trace-item-status--completed {
        color: #2f9b66;
    }

    .ai-message__trace-item-status--error {
        color: var(--b3-theme-error);
    }

    .ai-message__trace-item-status--running {
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__trace-item-body {
        padding: 2px 10px 8px 28px;
        background: transparent;
        border-top: none;
    }

    .ai-message__trace-item--diff,
    .ai-message__trace-stream-item--diff {
        border-left: 2px solid color-mix(in srgb, var(--b3-theme-primary) 42%, var(--b3-border-color));
        background: color-mix(in srgb, var(--b3-theme-primary) 4%, transparent);
    }

    .ai-message__trace-item-header--diff {
        background: color-mix(in srgb, var(--b3-theme-primary) 8%, transparent);
    }

    .ai-message__trace-item-header--diff:hover {
        background: color-mix(in srgb, var(--b3-theme-primary) 14%, transparent);
    }

    .ai-message__trace-item-kind--diff {
        padding: 1px 6px;
        border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 42%, var(--b3-border-color));
        border-radius: 999px;
        font-size: 10px;
        line-height: 1.2;
        letter-spacing: 0.01em;
        color: color-mix(in srgb, var(--b3-theme-primary) 74%, var(--b3-theme-on-surface));
        background: color-mix(in srgb, var(--b3-theme-primary) 10%, transparent);
    }

    .ai-message__trace-item-name--diff {
        font-family: var(--b3-font-family-code);
        font-size: 11px;
    }

    .ai-message__trace-item-body--diff {
        border-top: 1px dashed color-mix(in srgb, var(--b3-theme-primary) 28%, var(--b3-border-color));
        padding-left: 18px;
        background: color-mix(in srgb, var(--b3-theme-primary) 3%, transparent);
    }

    .ai-message__trace-field {
        margin-bottom: 6px;
    }

    .ai-message__trace-field:last-child {
        margin-bottom: 0;
    }

    .ai-message__trace-field-label {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 2px;
    }

    .ai-message__trace-pre {
        margin: 0;
        padding: 6px 8px;
        border: none;
        border-left: 2px solid var(--b3-border-color);
        border-radius: 0;
        background: transparent;
        font-family: var(--b3-font-family-code);
        font-size: 11px;
        line-height: 1.45;
        color: var(--b3-theme-on-surface);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 180px;
        overflow: auto;
    }

    .ai-message__trace-tool-diffs {
        margin-top: 6px;
        border-top: 1px dashed var(--b3-border-color);
        padding-top: 6px;
    }

    .ai-message__trace-tool-diff {
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        background: color-mix(in srgb, var(--b3-theme-surface) 70%, transparent);
        margin-bottom: 6px;
        overflow: hidden;
    }

    .ai-message__trace-tool-diff:last-child {
        margin-bottom: 0;
    }

    .ai-message__trace-tool-diff-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        cursor: pointer;
        background: transparent;
    }

    .ai-message__trace-tool-diff-header:hover {
        background: var(--b3-list-hover);
    }

    .ai-message__trace-tool-diff--flat .ai-message__trace-tool-diff-header {
        cursor: default;
    }

    .ai-message__trace-tool-diff-header--flat:hover {
        background: transparent;
    }

    .ai-message__trace-tool-diff-title {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        font-family: var(--b3-font-family-code);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .ai-message__trace-tool-diff-stats {
        margin-left: auto;
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
    }

    .ai-message__trace-tool-diff-open {
        padding: 0 6px;
        min-height: 20px;
        font-size: 10px;
    }

    .ai-message__trace-tool-diff-body {
        border-top: 1px solid var(--b3-border-color);
        background: transparent;
        max-height: 220px;
        overflow: auto;
    }

    .ai-message__trace-tool-diff-line {
        display: flex;
        gap: 6px;
        padding: 2px 8px;
        font-size: 11px;
        line-height: 1.4;
        font-family: var(--b3-font-family-code);
    }

    .ai-message__trace-tool-diff-line--added {
        background: color-mix(in srgb, var(--b3-theme-success-lightest) 52%, transparent);
    }

    .ai-message__trace-tool-diff-line--removed {
        background: color-mix(in srgb, var(--b3-theme-error-lightest) 45%, transparent);
    }

    .ai-message__trace-tool-diff-marker {
        width: 10px;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__trace-tool-diff-text {
        word-break: break-word;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__trace-stream-list {
        padding: 0;
        background: transparent;
    }

    .ai-message__trace-stream-item {
        border-bottom: 1px solid var(--b3-border-color);
        border-radius: 0;
        background: transparent;
        padding: 0;
        margin-bottom: 0;
    }

    .ai-message__trace-stream-item:last-child {
        border-bottom: none;
    }

    // 工具调用样式
    .ai-message__tool-calls {
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        overflow: hidden;
        background: var(--b3-theme-surface);
    }

    .ai-message__tool-calls-title {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__tool-calls-summary {
        margin-left: auto;
        font-size: 11px;
        font-weight: 400;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 48%;
    }

    .ai-message__tool-call {
        border-bottom: 1px solid var(--b3-border-color);

        &:last-child {
            border-bottom: none;
        }
    }

    .ai-message__tool-call-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        background: var(--b3-theme-background);
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-message__tool-call-name {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .ai-message__tool-call-icon {
        width: 14px;
        height: 14px;
        color: var(--b3-theme-on-surface-light);
        transition: transform 0.2s;
        transform: rotate(90deg);

        &.collapsed {
            transform: rotate(0deg);
        }
    }

    .ai-message__tool-call-status {
        font-size: 14px;
        margin-left: auto;
    }

    .ai-message__tool-call-details {
        padding: 12px;
        background: var(--b3-theme-background);
        border-top: 1px solid var(--b3-border-color);
    }

    .ai-message__tool-call-params,
    .ai-message__tool-call-result {
        margin-bottom: 12px;

        &:last-child {
            margin-bottom: 0;
        }
    }

    .ai-message__tool-call-section-header {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 4px;
        margin-bottom: 6px;
        border-radius: 4px;
        transition: background-color 0.2s;

        &:hover {
            background: var(--b3-list-hover);
        }

        strong {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        }

        .ai-message__tool-call-icon {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
            transition: transform 0.2s;
            fill: var(--b3-theme-on-surface);

            &.collapsed {
                transform: rotate(0deg);
            }

            &:not(.collapsed) {
                transform: rotate(90deg);
            }
        }
    }

    .ai-message__tool-call-code {
        margin: 0;
        padding: 8px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 4px;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface);
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标
    }

    .ai-message__tool-result-placeholder {
        display: none;
    }

    // 工具调用后的最终回复样式
    .ai-message__final-reply {
        margin-top: 12px;
        border-top: 1px solid var(--b3-border-color);
        padding-top: 12px;
    }

    .ai-message__content {
        padding: 10px 12px;
        border-radius: var(--copilot-radius-md);
        line-height: 1.55;
        word-wrap: break-word;
        overflow-wrap: anywhere;
        overflow-x: auto;
        user-select: text; // 允许鼠标选择文本进行复制
        cursor: text; // 显示文本选择光标
        box-shadow: 0 0 0 1px var(--copilot-border);
    }

    .ai-message__content :global(*:first-child),
    .ai-message__thinking-content :global(*:first-child) {
        margin-top: 0;
    }

    .ai-message__content :global(*:last-child),
    .ai-message__thinking-content :global(*:last-child) {
        margin-bottom: 0;
    }

    .ai-message__waiting-placeholder {
        display: flex;
        align-items: center;
        height: 24px;
        padding: 2px 0;
    }

    .ai-message__running-indicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        padding: 2px 0;
        color: var(--b3-theme-on-surface-light);
    }

    .ai-message__running-text {
        font-size: 11px;
        line-height: 1.2;
    }

    .ai-message--user {
        .ai-message__header {
            justify-content: flex-end;
        }

        .ai-message__content {
            background: var(--copilot-user-message-bg);
            color: var(--copilot-text-on-bg);
            margin-left: auto;
            max-width: min(88%, 820px);
        }

        .ai-message__actions {
            justify-content: flex-end;
        }
    }

    .ai-message--assistant {
        .ai-message__header {
            justify-content: flex-start;
        }

        .ai-message__content {
            background: var(--copilot-assistant-message-bg);
            color: var(--copilot-text-on-bg);
            margin-right: auto;
            max-width: min(94%, 920px);
        }

        .ai-message__actions {
            justify-content: flex-start;
        }
    }

    .ai-sidebar__input-container {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 6px 10px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background);
        flex-shrink: 0;
        position: relative;
        transition: background-color 0.2s;
    }

    .ai-sidebar__mode-selector {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 1px 0;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
    }

    .ai-sidebar__mode-label {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        font-weight: 500;
        flex-shrink: 0;
        white-space: nowrap;
    }

    .ai-sidebar__mode-select {
        flex: 0 0 auto;
        width: 86px;
        min-width: 86px;
        height: 22px;
        font-size: 11px;
        padding: 0 20px 0 6px;
        border-radius: 6px;
    }

    .ai-sidebar__auto-approve-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        user-select: none;

        span {
            white-space: nowrap;
        }
    }

    .ai-sidebar__codex-inline-controls {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 3px;
        flex-wrap: nowrap;
        justify-content: flex-end;
        flex-shrink: 0;
        min-width: 0;
    }

    .ai-sidebar__codex-error {
        margin-left: auto;
        font-size: 12px;
        color: var(--b3-theme-error);
    }

    .ai-sidebar__codex-context-usage {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        padding: 0 3px;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        white-space: nowrap;
    }

    .ai-sidebar__codex-field {
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 10px;
        color: var(--b3-theme-on-surface);
        min-width: 0;

        span {
            white-space: nowrap;
        }
    }

    .ai-sidebar__codex-input {
        width: 90px;
        height: 22px;
        font-size: 11px;
        padding: 0 20px 0 6px;
        border-radius: 6px;
    }

    .ai-sidebar__codex-toolcheck-btn {
        height: 22px;
        padding: 0 5px;
        font-size: 10px;
        white-space: nowrap;
        border-radius: 6px;
    }

    .ai-sidebar__codex-settings-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border-radius: 5px;
    }

    .ai-sidebar__tool-selector-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__multi-model-selector-wrapper {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .ai-sidebar__input-row {
        display: flex;
        gap: 0;
    }

    .ai-sidebar__queue-hint {
        margin-top: 6px;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 1.4;
        border-radius: 6px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-surface-lighter);
        border: 1px dashed var(--b3-border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .ai-sidebar__queue-stop-btn {
        flex-shrink: 0;
        height: 22px;
        min-height: 22px;
        padding: 0 6px;
        border-radius: 6px;
    }

    .ai-sidebar__queue-stop-btn .b3-button__icon {
        width: 14px;
        height: 14px;
    }

    .ai-sidebar__input-wrapper {
        flex: 1;
        position: relative;
        display: flex;
        align-items: flex-end;
        border: 1px solid var(--b3-border-color);
        border-radius: 12px;
        background: var(--b3-theme-surface);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        transition:
            border-color 0.2s,
            box-shadow 0.2s,
            background-color 0.2s;

        &:focus-within {
            border-color: var(--b3-theme-primary);
            box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
        }

        &:hover {
            border-color: var(--b3-theme-primary-light);
        }
    }

    .ai-sidebar__input {
        flex: 1;
        resize: none;
        border: none;
        border-radius: 12px;
        padding: 12px 16px;
        padding-right: 52px; /* 为发送按钮留出空间 */
        font-family: var(--b3-font-family);
        font-size: 14px;
        line-height: 1.55;
        background: transparent;
        color: var(--b3-theme-on-background);
        min-height: 46px;
        max-height: 200px;
        overflow-y: auto;

        &:focus {
            outline: none;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        &::placeholder {
            color: var(--b3-theme-on-surface-light);
        }
    }

    .ai-sidebar__bottom-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        margin-top: 3px;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: thin;
    }

    .ai-sidebar__upload-btn,
    .ai-sidebar__weblink-btn,
    .ai-sidebar__search-btn,
    .ai-sidebar__bottom-action-btn {
        flex-shrink: 0;
        height: 24px;
        min-height: 24px;
        border-radius: 6px;
        padding: 0 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__bottom-action-btn {
        font-size: 11px;
    }

    .ai-sidebar__model-selector-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        flex-shrink: 0;
    }

    .ai-sidebar__thinking-toggle-container {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__thinking-toggle {
        font-size: 12px;
        padding: 4px 8px;
        min-width: auto;
        transition: all 0.2s;
        color: var(--b3-theme-primary);
        background: transparent;
    }

    .ai-sidebar__thinking-toggle:hover:not(:disabled) {
        background: var(--b3-theme-surface);
    }

    .ai-sidebar__thinking-toggle--active {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-weight: 600;
    }

    .ai-sidebar__thinking-toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .ai-sidebar__thinking-effort-select {
        font-size: 11px;
        padding: 2px 4px;
        min-width: 50px;
        max-width: 70px;
        height: 24px;
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
            border-color: var(--b3-theme-primary);
        }

        &:focus {
            outline: none;
            border-color: var(--b3-theme-primary);
            box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__model-selector-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        /* 保证在 flex 布局中可以缩小，避免在窄宽度下溢出 */
        min-width: 0;
        max-width: 100%;

        /* 只对模型选择器按钮内的文本应用省略处理，避免影响弹窗显示 */
        :global(.model-selector__button) {
            min-width: 0;
            max-width: 100%;
        }

        :global(.model-selector__current) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    // 消息附件样式
    .ai-message__attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
    }

    .ai-message__attachment {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 200px;
        position: relative;

        &:hover .ai-message__attachment-copy {
            opacity: 1;
        }

        // 图片附件的复制按钮位置（在图片右上角）
        > .ai-message__attachment-copy {
            position: absolute;
            top: 6px;
            right: 6px;
            z-index: 1;
        }
    }

    .ai-message__attachment-image {
        width: 100%;
        max-height: 150px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
    }

    .ai-message__attachment-file {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        position: relative;

        &:hover .ai-message__attachment-copy {
            opacity: 1;
        }
    }

    .ai-message__attachment-icon {
        width: 20px;
        height: 20px;
        color: var(--b3-theme-on-surface-light);
        flex-shrink: 0;
    }

    .ai-message__attachment-icon-emoji {
        font-size: 20px;
        flex-shrink: 0;
        line-height: 1;
    }

    .ai-message__attachment-copy {
        position: absolute;
        top: 4px;
        right: 4px;
        padding: 4px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        opacity: 0;
        transition: all 0.2s;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);

        &:hover {
            background: var(--b3-theme-surface);
        }
    }

    .ai-message__attachment-name {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
    }

    // 消息上下文文档样式
    .ai-message__context-docs {
        margin-bottom: 12px;
        padding: 10px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
    }

    .ai-message__context-docs-title {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-bottom: 8px;
        font-weight: 500;
    }

    .ai-message__context-docs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .ai-message__context-doc-link {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        font-size: 12px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        border: 1px solid var(--b3-theme-primary-light);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        text-decoration: none;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        &:hover {
            background: var(--b3-theme-primary-lighter);
            border-color: var(--b3-theme-primary);
        }
    }

    // 消息编辑样式
    .ai-message__edit {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 0;
    }

    .ai-message__edit-textarea {
        width: 100%;
        min-height: 100px;
        padding: 10px 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
        font-family: var(--b3-font-family);
        font-size: 14px;
        line-height: 1.6;
        resize: vertical;

        &:focus {
            outline: none;
            border-color: var(--b3-theme-primary);
        }
    }

    .ai-message__edit-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .ai-sidebar__send-btn {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 36px;
        height: 36px;
        min-width: 36px;
        border-radius: 999px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        appearance: none;
        padding: 0;
        border: 1px solid var(--b3-theme-primary);
        background: linear-gradient(
            135deg,
            var(--b3-theme-primary) 0%,
            var(--b3-theme-primary-light) 100%
        );
        color: var(--b3-theme-background);
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
        transition:
            transform 0.18s ease,
            background-color 0.2s ease,
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            opacity 0.2s ease;

        &:focus-visible {
            outline: 2px solid var(--b3-theme-primary-light);
            outline-offset: 1px;
        }

        &:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            box-shadow: none;
            background: var(--b3-theme-surface);
            border-color: var(--b3-border-color);
            color: var(--b3-theme-on-surface-light);
        }

        &:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.16);
        }

        &:not(:disabled):active {
            transform: translateY(0);
            box-shadow: 0 2px 6px rgba(15, 23, 42, 0.14);
        }

        &.ai-sidebar__send-btn--abort {
            border-color: var(--b3-theme-error);
            background-color: var(--b3-theme-error);
            color: var(--b3-theme-background);

            &:not(:disabled):hover {
                background-color: var(--b3-theme-error);
                filter: brightness(0.95);
            }
        }

        .b3-button__icon {
            width: 17px;
            height: 17px;
        }

        .ai-sidebar__send-queue-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            border-radius: 999px;
            background: var(--b3-theme-on-surface);
            color: var(--b3-theme-surface);
            font-size: 10px;
            line-height: 16px;
            font-weight: 600;
            text-align: center;
            box-shadow: 0 0 0 1px var(--b3-theme-background);
            pointer-events: none;
        }
    }

    .ai-sidebar__loading-icon {
        animation: rotate 1s linear infinite;
    }

    @keyframes rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    // 提示词管理对话框样式
    .ai-sidebar__prompt-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__prompt-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__prompt-dialog-content {
        position: relative;
        width: 90%;
        max-width: 600px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__prompt-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
    }

    .ai-sidebar__prompt-dialog-body {
        padding: 16px;
        overflow-y: auto;
    }

    .ai-sidebar__prompt-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .ai-sidebar__prompt-form-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-sidebar__prompt-form-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__prompt-textarea {
        min-height: 120px;
        resize: vertical;
        font-family: var(--b3-font-family);
    }

    .ai-sidebar__prompt-form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .ai-sidebar__prompt-divider {
        margin: 24px 0;
        border-top: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__prompt-saved-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-sidebar__prompt-saved-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__prompt-saved-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-sidebar__prompt-saved-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__prompt-saved-info {
        flex: 1;
        min-width: 0;
    }

    .ai-sidebar__prompt-saved-item-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__prompt-saved-item-content {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.4;
        word-break: break-word;
    }

    .ai-sidebar__prompt-saved-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    // 搜索对话框样式
    .ai-sidebar__search-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__search-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__search-dialog-content {
        position: relative;
        width: 90%;
        max-width: 500px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
    }

    .ai-sidebar__search-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
    }

    .ai-sidebar__search-dialog-body {
        padding: 16px;
        overflow-y: auto;
    }

    .ai-sidebar__search-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;

        input {
            flex: 1;
        }
    }

    .ai-sidebar__search-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        color: var(--b3-theme-primary);
    }

    .ai-sidebar__search-results {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 400px;
        overflow-y: auto;
    }

    .ai-sidebar__search-result-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .ai-sidebar__search-result-title {
        flex: 1;
        font-size: 14px;
        color: var(--b3-theme-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .ai-sidebar__search-current-doc-badge {
        display: inline-block;
        padding: 2px 8px;
        font-size: 12px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .ai-sidebar__search-empty {
        text-align: center;
        padding: 32px;
        color: var(--b3-theme-on-surface-light);
    }

    // 编辑操作样式
    .ai-message__edit-operations {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .ai-message__edit-file-group {
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: transparent;
        margin-bottom: 0;
        padding: 6px 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
        flex-wrap: wrap;
    }

    .ai-message__edit-file-group:last-child {
        margin-bottom: 0;
    }

    .ai-message__edit-file-group--applied {
        border-color: color-mix(in srgb, var(--b3-theme-success) 55%, var(--b3-border-color));
    }

    .ai-message__edit-file-group--rejected {
        border-color: color-mix(in srgb, var(--b3-theme-error) 55%, var(--b3-border-color));
    }

    .ai-message__edit-file-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        background: transparent;
        flex: 1;
        min-width: 180px;
    }

    .ai-message__edit-file-path {
        font-family: var(--b3-font-family-code);
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
    }

    .ai-message__edit-file-stats {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
    }

    .ai-message__edit-file-status {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        white-space: nowrap;
    }

    .ai-message__edit-file-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        flex-wrap: wrap;
    }

    @media (max-width: 768px) {
        .ai-message__edit-file-group {
            align-items: flex-start;
        }

        .ai-message__edit-file-actions {
            width: 100%;
            margin-left: 0;
        }
    }

    // 兼容旧样式（历史数据）
    .ai-message__edit-operation {
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        margin-bottom: 8px;
    }

    .ai-message__edit-operation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 12px;
    }

    .ai-message__edit-operation-id {
        color: var(--b3-theme-on-surface);
        font-family: var(--b3-font-family-code);
    }

    .ai-message__edit-operation-status {
        font-weight: 600;

        .ai-message__edit-operation--applied & {
            color: var(--b3-theme-success);
        }

        .ai-message__edit-operation--rejected & {
            color: var(--b3-theme-error);
        }
    }

    .ai-message__edit-operation-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    // 差异对比对话框样式
    .ai-sidebar__diff-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__diff-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__diff-dialog-content {
        position: relative;
        width: 90%;
        max-width: 900px;
        background: var(--copilot-surface-1);
        border-radius: var(--copilot-radius-md);
        box-shadow: var(--copilot-shadow-md);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
        --ai-sidebar-diff-white-space: pre;
        --ai-sidebar-diff-word-break: normal;
        --ai-sidebar-diff-lineno-width: 56px;
    }

    .ai-sidebar__diff-dialog-content--wrap {
        --ai-sidebar-diff-white-space: pre-wrap;
        --ai-sidebar-diff-word-break: break-word;
    }

    .ai-sidebar__diff-dialog-content :focus-visible,
    .ai-sidebar__git-dialog-content :focus-visible,
    .ai-sidebar__prompt-dialog-content :focus-visible,
    .ai-sidebar__search-dialog-content :focus-visible {
        outline: 2px solid var(--copilot-border-strong);
        outline-offset: 2px;
    }

    .ai-sidebar__diff-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--copilot-space-4);
        border-bottom: 1px solid var(--copilot-border);
        gap: 12px;

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .b3-button {
            padding: 4px;
            min-width: auto;
        }
    }

    .ai-sidebar__diff-dialog-body {
        padding: var(--copilot-space-4);
        overflow-y: auto;
        flex: 1;
    }

    .ai-sidebar__diff-info {
        padding: var(--copilot-space-3);
        background: var(--copilot-surface-2);
        border-radius: var(--copilot-radius-sm);
        margin-bottom: var(--copilot-space-4);
        font-size: 13px;

        strong {
            color: var(--copilot-text-primary);
        }
    }

    .ai-sidebar__diff-engine-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid var(--copilot-border);
        background: var(--copilot-surface-3);
        color: var(--copilot-text-secondary);
        font-size: 12px;
        line-height: 1.4;
        vertical-align: middle;
        user-select: none;
    }

    .ai-sidebar__diff-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
    }

    .ai-sidebar__diff-toolbar-left,
    .ai-sidebar__diff-toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .ai-sidebar__diff-toolbar-group {
        display: inline-flex;
        gap: 6px;
        align-items: center;
    }

    .ai-sidebar__diff-toolbar-btn--active {
        border-color: var(--copilot-accent);
        background: color-mix(in srgb, var(--copilot-accent) 18%, transparent);
    }

    .ai-sidebar__diff-pagination {
        margin-top: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .ai-sidebar__diff-content {
        font-family: var(--b3-font-family-code);
        font-size: 13px;
        line-height: 1.6;
        background: var(--copilot-surface-2);
        border-radius: var(--copilot-radius-sm);
        border: 1px solid var(--copilot-border);
        overflow: auto;
    }

    .ai-sidebar__diff-line {
        display: flex;
        padding: 2px 12px;
        min-height: 24px;

        &--removed {
            background: var(--copilot-diff-removed-bg);
            color: var(--b3-theme-error);
        }

        &--added {
            background: var(--copilot-diff-added-bg);
            color: var(--b3-theme-success);
        }

        &--unchanged {
            color: var(--copilot-text-primary);
        }
    }

    .ai-sidebar__diff-marker {
        display: inline-block;
        width: 20px;
        flex-shrink: 0;
        font-weight: 600;
    }

    .ai-sidebar__diff-lineno {
        display: inline-block;
        width: var(--ai-sidebar-diff-lineno-width);
        flex-shrink: 0;
        text-align: right;
        font-variant-numeric: tabular-nums;
        user-select: none;
        color: var(--copilot-text-secondary);
    }

    .ai-sidebar__diff-text {
        flex: 1;
        white-space: var(--ai-sidebar-diff-white-space);
        word-break: var(--ai-sidebar-diff-word-break);
    }

    .ai-sidebar__diff-fold-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 2px 10px;
        min-height: 22px;
        border: 0;
        background: color-mix(in srgb, var(--copilot-surface-2) 82%, transparent);
        color: var(--copilot-text-secondary);
        cursor: pointer;
        text-align: left;
    }

    .ai-sidebar__diff-fold-row:hover {
        background: var(--copilot-surface-3);
        color: var(--copilot-text-primary);
    }

    .ai-sidebar__diff-unified-content {
        border: 1px solid var(--copilot-border);
        border-radius: var(--copilot-radius-sm);
        background: var(--copilot-surface-2);
        overflow: auto;
        font-family: var(--b3-font-family-code);
        font-size: 13px;
        line-height: 1.6;
    }

    .ai-sidebar__diff-unified-line {
        display: flex;
        gap: 6px;
        padding: 2px 10px;
        min-height: 22px;
    }

    .ai-sidebar__diff-unified-line--removed {
        background: var(--copilot-diff-removed-bg);
        color: var(--b3-theme-error);
    }

    .ai-sidebar__diff-unified-line--added {
        background: var(--copilot-diff-added-bg);
        color: var(--b3-theme-success);
    }

    .ai-sidebar__diff-unified-line--unchanged {
        color: var(--copilot-text-primary);
    }

    .ai-sidebar__diff-loading {
        text-align: center;
        padding: 32px;
        color: var(--copilot-text-secondary);
    }

    .ai-sidebar__diff-split {
        display: flex;
        gap: 12px;
        height: 100%;
        min-height: 400px;
    }

    .ai-sidebar__diff-split-column {
        flex: 1;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--copilot-border);
        border-radius: var(--copilot-radius-sm);
        background: var(--copilot-surface-2);
        overflow: hidden;
    }

    .ai-sidebar__diff-split-header {
        padding: 8px 12px;
        background: var(--copilot-surface-3);
        border-bottom: 1px solid var(--copilot-border);
        font-weight: 600;
        font-size: 13px;
        color: var(--copilot-text-primary);
    }

    .ai-sidebar__diff-split-content {
        flex: 1;
        margin: 0;
        padding: 12px;
        overflow: auto;
        font-family: var(--b3-font-family-code);
        font-size: 13px;
        line-height: 1.6;
        white-space: var(--ai-sidebar-diff-white-space);
        word-break: var(--ai-sidebar-diff-word-break);
        color: var(--copilot-text-primary);
    }

    .ai-sidebar__diff-split-content--diff {
        padding: 0;
    }

    .ai-sidebar__diff-split-line {
        display: flex;
        gap: 6px;
        padding: 2px 10px;
        min-height: 22px;
    }

    .ai-sidebar__diff-split-line--removed {
        background: var(--copilot-diff-removed-bg);
        color: var(--b3-theme-error);
    }

    .ai-sidebar__diff-split-line--added {
        background: var(--copilot-diff-added-bg);
        color: var(--b3-theme-success);
    }

    .ai-sidebar__diff-split-line--unchanged {
        color: var(--copilot-text-primary);
    }

    .ai-sidebar__diff-split-line--empty {
        background: color-mix(in srgb, var(--copilot-surface-2) 78%, transparent);
        color: var(--copilot-text-secondary);
    }

    .ai-sidebar__diff-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: var(--copilot-space-4);
        border-top: 1px solid var(--copilot-border);
    }

    // Git 同步对话框样式
    .ai-sidebar__git-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ai-sidebar__git-dialog-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
    }

    .ai-sidebar__git-dialog-content {
        position: relative;
        width: 90%;
        max-width: 980px;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        flex-direction: column;
        max-height: 82vh;
    }

    .ai-sidebar__git-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);
        gap: 12px;

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }

        .b3-button {
            padding: 4px;
            min-width: auto;
        }
    }

    .ai-sidebar__git-dialog-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-sidebar__git-dialog-footer {
        padding: 12px 16px;
        border-top: 1px solid var(--b3-border-color);
        display: flex;
        justify-content: flex-end;
    }

    .ai-sidebar__git-tip {
        padding: 10px 12px;
        border-radius: 6px;
        background: var(--b3-theme-surface);
        border: 1px dashed var(--b3-border-color);
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    .ai-sidebar__git-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__git-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .ai-sidebar__git-label {
        width: 64px;
        flex-shrink: 0;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
        font-weight: 600;
    }

    .ai-sidebar__git-remote-name {
        width: 140px;
        flex-shrink: 0;
    }

    .ai-sidebar__git-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }

    .ai-sidebar__git-log {
        flex: 1;
        min-height: 240px;
        max-height: 44vh;
        overflow: auto;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
    }

    .ai-sidebar__git-exitcode {
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
        padding: 0 6px;
    }

    // 工具批准对话框样式
    .tool-approval-dialog__overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
    }

    .tool-approval-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        z-index: 1000;
        overflow: hidden;
    }

    .tool-approval-dialog__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--b3-theme-on-surface);
        }
    }

    .tool-approval-dialog__content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    }

    .tool-approval-dialog__tool-info {
        margin-bottom: 16px;
        padding: 12px;
        background: var(--b3-theme-primary-lightest);
        border-radius: 6px;
        border: 1px solid var(--b3-theme-primary-lighter);
    }

    .tool-approval-dialog__tool-name {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 14px;
        color: var(--b3-theme-on-surface);

        .b3-button__icon {
            width: 18px;
            height: 18px;
            color: var(--b3-theme-primary);
        }

        strong {
            font-weight: 600;
        }
    }

    .tool-approval-dialog__tool-id {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-family: var(--b3-font-family-code);
    }

    .tool-approval-dialog__params {
        margin-bottom: 16px;
    }

    .tool-approval-dialog__section-title {
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-surface);
    }

    .tool-approval-dialog__code {
        margin: 0;
        padding: 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        font-family: var(--b3-font-family-code);
        font-size: 12px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface);
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
    }

    .tool-approval-dialog__warning {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-error-lightest);
        border: 1px solid var(--b3-theme-error-lighter);
        border-radius: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);

        .b3-button__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--b3-theme-error);
        }
    }

    .tool-approval-dialog__footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);

        .b3-button {
            min-width: 100px;
        }
    }

    // 右键菜单样式
    .ai-sidebar__context-menu {
        position: fixed;
        z-index: 10000;
        min-width: 160px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 4px;
        animation: fadeIn 0.15s ease-out;
    }

    .ai-sidebar__context-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface);
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-background);
        }

        .b3-button__icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        span {
            flex: 1;
        }
    }

    .ai-sidebar__context-menu-divider {
        height: 1px;
        margin: 4px 0;
        background: var(--b3-border-color);
    }

    // 多模型响应样式
    .ai-sidebar__multi-model-responses {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 12px 0;
        animation: fadeIn 0.3s ease-in;
    }

    .ai-sidebar__multi-model-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
    }

    .ai-sidebar__multi-model-header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .ai-sidebar__multi-model-header-top h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-hint {
        font-size: 13px;
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--b3-theme-primary-light);
        text-align: center;
        font-weight: 500;
    }

    .ai-sidebar__multi-model-cards {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding: 8px 4px;
        scroll-snap-type: x mandatory;

        &::-webkit-scrollbar {
            height: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-card {
        flex: 0 0 50%;
        max-width: 400px;
        min-width: 300px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 2px solid var(--b3-border-color);
        border-radius: 8px;
        scroll-snap-align: start;
        transition: all 0.2s ease;

        &:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            border-color: var(--b3-theme-primary-light);
        }

        &--selected {
            border-color: var(--b3-theme-primary);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
    }

    .ai-sidebar__multi-model-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
        position: sticky;
        top: 0;
        background: var(--b3-theme-background);
    }

    .ai-sidebar__multi-model-card-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-sidebar__multi-model-card-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-copy-btn {
        flex-shrink: 0;
        padding: 4px 8px;
        height: auto;

        .b3-button__icon {
            width: 14px;
            height: 14px;
        }
    }

    .ai-sidebar__multi-model-card-model-name,
    .ai-sidebar__multi-model-tab-title,
    .ai-sidebar__multi-model-tab-panel-model-name {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .ai-sidebar__multi-model-selected-indicator,
    .ai-message__multi-model-selected-indicator {
        color: var(--b3-theme-success);
        font-size: 14px;
        font-weight: 600;
    }

    .ai-sidebar__multi-model-card-status {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;

        &--loading {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        &--error {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-select-btn {
        flex-shrink: 0;
        font-size: 12px;
        padding: 4px 12px;
        height: auto;
        white-space: nowrap;
    }

    .ai-sidebar__multi-model-select-btn--selected {
        background-color: var(--b3-theme-success) !important;
        border-color: var(--b3-theme-success) !important;
    }

    .ai-sidebar__multi-model-card-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-card-loading {
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
        padding: 20px;
    }

    .ai-sidebar__multi-model-card-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    .ai-sidebar__multi-model-layout-selector {
        display: flex;
        gap: 4px;
        align-items: center;
    }

    .ai-sidebar__multi-model-tabs {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-sidebar__multi-model-tab-headers {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--b3-border-color);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--b3-theme-surface);

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .ai-sidebar__multi-model-tab-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        transition: all 0.2s;
        white-space: nowrap;
        min-width: 120px;
        justify-content: center;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .ai-sidebar__multi-model-tab-title {
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-sidebar__multi-model-tab-status {
        font-size: 10px;
        flex-shrink: 0;

        &--loading {
            color: var(--b3-theme-primary);
        }

        &--error {
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-tab-content {
        flex: 1;
        min-height: 0;
    }

    .ai-sidebar__multi-model-tab-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-sidebar__multi-model-tab-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-sidebar__multi-model-tab-panel-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-sidebar__multi-model-tab-panel-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-sidebar__multi-model-tab-panel-model-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-sidebar__multi-model-tab-panel-status {
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;

        &--loading {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
        }

        &--error {
            background: var(--b3-theme-error-lighter);
            color: var(--b3-theme-error);
        }
    }

    .ai-sidebar__multi-model-tab-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-sidebar__multi-model-tab-panel-loading {
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-style: italic;
        padding: 20px;
    }

    .ai-sidebar__multi-model-tab-panel-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    // 历史消息中的多模型响应样式
    .ai-message__multi-model-responses {
        margin-top: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-message__multi-model-header {
        margin-bottom: 12px;

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    .ai-message__multi-model-header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .ai-message__multi-model-layout-selector {
        display: flex;
        gap: 4px;
        align-items: center;
    }

    // 历史消息中的多模型页签样式
    .ai-message__multi-model-tabs {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .ai-message__multi-model-tab-headers {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--b3-border-color);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        position: sticky;
        top: 0;
        background: var(--b3-theme-surface);

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .ai-message__multi-model-tab-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        transition: all 0.2s;
        white-space: nowrap;
        min-width: 100px;
        justify-content: center;

        &:hover {
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        }

        &--active {
            background: var(--b3-theme-primary-lightest);
            color: var(--b3-theme-primary);
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .ai-message__multi-model-tab-title {
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ai-message__multi-model-tab-status {
        font-size: 10px;
        flex-shrink: 0;

        &--error {
            color: var(--b3-theme-error);
        }
    }

    .ai-message__multi-model-tab-content {
        flex: 1;
    }

    .ai-message__multi-model-tab-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
    }

    .ai-message__multi-model-tab-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .ai-message__multi-model-tab-panel-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
    }

    .ai-message__multi-model-tab-panel-model-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .ai-message__multi-model-tab-panel-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .ai-message__multi-model-tab-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        user-select: text; // 允许文本选择

        &::-webkit-scrollbar {
            width: 6px;
        }

        &::-webkit-scrollbar-track {
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        &::-webkit-scrollbar-thumb {
            background: var(--b3-theme-on-surface-light);
            border-radius: 3px;

            &:hover {
                background: var(--b3-theme-on-surface);
            }
        }
    }

    .ai-message__multi-model-tab-panel-error {
        color: var(--b3-theme-error);
        font-size: 12px;
        padding: 12px;
        background: var(--b3-theme-error-lighter);
        border-radius: 4px;
        word-break: break-word;
    }

    // 保留旧的卡片样式（如果还需要）
    .ai-message__multi-model-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ai-message__multi-model-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        transition: all 0.2s ease;

        &--selected {
            border-color: var(--b3-theme-success);
            background: var(--b3-theme-success-lightest);
        }
    }

    // 响应式布局
    @media (max-width: 768px) {
        .ai-sidebar__header {
            padding: 6px 10px;
        }

        .ai-sidebar__title {
            font-size: 14px;
        }

        .ai-sidebar__messages {
            padding: 10px;
            gap: 10px;
        }

        .ai-message--user .ai-message__content {
            max-width: 90%;
        }

        .ai-message--assistant .ai-message__content {
            max-width: 95%;
        }

        .ai-sidebar__input-container {
            padding: 6px 10px;
        }

        .ai-sidebar__mode-selector {
            gap: 4px;
            flex-wrap: wrap;
            overflow: visible;
        }

        .ai-sidebar__codex-inline-controls {
            width: 100%;
            margin-left: 0;
            justify-content: flex-start;
            gap: 4px;
            flex-wrap: wrap;
        }

        .ai-sidebar__input {
            padding: 10px 14px;
            padding-right: 50px;
        }

        .ai-sidebar__send-btn {
            width: 32px;
            height: 32px;
            min-width: 32px;
            right: 7px;
            bottom: 7px;
            border-radius: 999px;

            .b3-button__icon {
                width: 15px;
                height: 15px;
            }
        }
    }

    @media (max-width: 480px) {
        .ai-sidebar__token-count {
            font-size: 10px;
            padding: 2px 6px;
        }

        .ai-message__content {
            font-size: 13px;
            padding: 8px 10px;
        }

        .ai-sidebar__input {
            font-size: 13px;
            padding: 8px 12px;
            padding-right: 46px;
        }

        .ai-sidebar__codex-field {
            width: 100%;
            justify-content: space-between;
        }

        .ai-sidebar__codex-input {
            width: auto;
            min-width: 0;
            flex: 1;
        }

        .ai-sidebar__codex-toolcheck-btn {
            width: auto;
            justify-content: center;
        }

        .ai-sidebar__send-btn {
            width: 31px;
            height: 31px;
            min-width: 31px;
            right: 6px;
            bottom: 6px;
            border-radius: 999px;

            .b3-button__icon {
                width: 14px;
                height: 14px;
            }
        }

        // 多模型页签响应式样式
        .ai-sidebar__multi-model-tabs {
            gap: 8px;
        }

        .ai-sidebar__multi-model-tab-headers {
            gap: 1px;
        }

        .ai-sidebar__multi-model-tab-header {
            padding: 6px 10px;
            min-width: 100px;
        }

        .ai-sidebar__multi-model-tab-title {
            font-size: 11px;
        }

        .ai-sidebar__multi-model-tab-status {
            font-size: 9px;
        }

        .ai-sidebar__multi-model-tab-panel {
            padding: 12px;
        }

        .ai-sidebar__multi-model-tab-panel-title {
            font-size: 13px;
        }

        .ai-sidebar__multi-model-tab-panel-status {
            font-size: 11px;
            padding: 1px 4px;
        }

        .ai-sidebar__multi-model-tab-panel-content {
            max-height: 400px;
        }
    }

    // 代码块工具栏样式
    :global(.code-block-toolbar) {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: var(--b3-theme-surface);
        border-bottom: 1px solid var(--b3-border-color);
        z-index: 1;
        flex: 0 0 auto;
    }

    :global(.code-block-toolbar__left) {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    :global(.code-block-toolbar__right) {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    // 代码块语言标签样式（左上角）
    :global(.code-block-lang-label) {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-family: var(--b3-font-family-code);
        line-height: 1.2;
        user-select: none;
        font-weight: 500;
    }

    // 代码块工具栏按钮样式（复制 / 换行 / 折叠）
    :global(.code-block-toolbar-btn) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;
        user-select: none;
        font-size: 12px;

        svg {
            width: 14px;
            height: 14px;
        }

        &:hover {
            background: var(--b3-list-hover);
            color: var(--b3-theme-on-surface);
        }

        &.active {
            color: var(--b3-theme-primary);
        }

        &.copied {
            color: var(--b3-theme-primary);
        }
    }

    // 代码块容器样式
    :global(.ai-message__content pre),
    :global(.ai-message__thinking-content pre) {
        position: relative;
        margin: 8px 0;
        padding: 0 !important;
        border-radius: 6px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        box-shadow: var(--b3-tooltips-shadow);
        overflow: hidden;
        max-height: 600px; /* 限制代码块最大高度 */
        display: flex;
        flex-direction: column;
    }

    :global(.ai-message__content pre code),
    :global(.ai-message__thinking-content pre code) {
        display: block;
        padding: 12px !important; /* 代码内容的内边距 */
        margin: 0;
        overflow: auto; /* 启用滚动 */
        flex: 1;
        min-height: 0;
        font-family: var(--b3-font-family-code);
        font-size: 0.9em;
        line-height: 1.5;
        background: transparent !important;
    }

    // 长代码默认折叠（更小高度），点击工具栏展开
    :global(.ai-message__content pre.code-block--collapsed),
    :global(.ai-message__thinking-content pre.code-block--collapsed) {
        max-height: 260px;
    }

    :global(.ai-message__content pre.code-block--expanded),
    :global(.ai-message__thinking-content pre.code-block--expanded) {
        max-height: none;
    }

    // 换行显示（wrap）
    :global(.ai-message__content pre.code-block--wrap code),
    :global(.ai-message__thinking-content pre.code-block--wrap code) {
        white-space: pre-wrap;
        word-break: break-word;
    }

    :global(.ai-message__content pre code::-webkit-scrollbar),
    :global(.ai-message__thinking-content pre code::-webkit-scrollbar) {
        width: 8px;
        height: 8px;
    }

    :global(.ai-message__content pre code::-webkit-scrollbar-track),
    :global(.ai-message__thinking-content pre code::-webkit-scrollbar-track) {
        background: var(--b3-theme-background);
        border-radius: 4px;
    }

    :global(.ai-message__content pre code::-webkit-scrollbar-thumb),
    :global(.ai-message__thinking-content pre code::-webkit-scrollbar-thumb) {
        background: var(--b3-scroll-color);
        border-radius: 4px;
    }

    :global(.ai-message__content pre code::-webkit-scrollbar-thumb:hover),
    :global(.ai-message__thinking-content pre code::-webkit-scrollbar-thumb:hover) {
        background: var(--b3-theme-on-surface-light);
    }

    // 全屏模式样式
    .ai-sidebar--fullscreen {
        position: fixed !important;
        top: var(--b3-toolbar-height) !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        z-index: 10 !important;
        background: var(--b3-theme-background) !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        display: flex !important;
        flex-direction: column !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__header {
        background: var(--b3-theme-surface) !important;
        border-bottom: 1px solid var(--b3-border-color) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__messages {
        flex: 1 !important;
        padding: 20px !important;
        gap: 16px !important;
        max-height: calc(100vh - 140px) !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__input-container {
        background: var(--b3-theme-surface) !important;
        border-top: 1px solid var(--b3-border-color) !important;
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1) !important;
        padding: 16px 20px !important;
    }

    .ai-sidebar--fullscreen .ai-message__content {
        font-size: 15px !important;
        line-height: 1.7 !important;
        padding: 16px 18px !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__input {
        font-size: 15px !important;
        padding: 14px 18px !important;
        padding-right: 52px !important;
        min-height: 50px !important;
        max-height: 300px !important;
    }

    .ai-sidebar--fullscreen .ai-sidebar__send-btn {
        width: 42px !important;
        height: 42px !important;
        min-width: 42px !important;

        .b3-button__icon {
            width: 20px !important;
            height: 20px !important;
        }
    }

    // 图片查看器样式
    .image-viewer {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 1001;
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .image-viewer__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .image-viewer__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 300px;
    }

    .image-viewer__actions {
        display: flex;
        gap: 8px;
        align-items: center;

        .b3-button {
            display: flex;
            align-items: center;
            gap: 4px;

            span {
                font-size: 12px;
            }
        }
    }

    .image-viewer__content {
        padding: 16px;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
        max-height: calc(90vh - 80px);
    }

    .image-viewer__image {
        max-width: 100%;
        max-height: calc(90vh - 112px);
        object-fit: contain;
        border-radius: 4px;
    }

    // 让消息中的图片可点击
    .ai-message__attachment-image,
    :global(.ai-message__content img),
    :global(.ai-message__thinking-content img) {
        cursor: zoom-in;
        transition: opacity 0.2s;

        &:hover {
            opacity: 0.9;
        }
    }
</style>
