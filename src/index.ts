import {
    Plugin,
    showMessage,
    confirm,
    Dialog,
    Menu,
    openTab,
    adaptHotkey,
    getFrontend,
    getBackend,
    IModel,
    Protyle,
    openWindow,
    Constants,
    openMobileFileById,
    lockScreen,
    ICard,
    ICardData
} from "siyuan";

import { appendBlock, deleteBlock, setBlockAttrs, getBlockAttrs, pushMsg, pushErrMsg, sql, renderSprig, getChildBlocks, insertBlock, renameDocByID, prependBlock, updateBlock, createDocWithMd, getBlockKramdown, getBlockDOM, putFile, getFileBlob, readDir, removeFile } from "./api";

import SettingPanel from "./SettingsPannel.svelte";
import { getDefaultSettings, mergeSettingsWithDefaults } from "./defaultSettings";
import { setPluginInstance, t, getCurrentLanguage } from "./utils/i18n";
import AISidebar from "./ai-sidebar.svelte";
import ChatDialog from "./components/ChatDialog.svelte";
import { updateSettings, getSettings } from "./stores/settings";
import { getModelCapabilities } from "./utils/modelCapabilities";
import { matchHotKey, getCustomHotKey } from "./utils/hotkey";
import {
    bidirectionalSyncPromptWithWorkingDirAgentsFile,
    pullPromptFromWorkingDirAgentsFile,
} from "./codex/agents-sync";

const SETTINGS_FILE = "settings.json";
const WEBVIEW_HISTORY_FILE = "webview-history.json";
const WEBAPP_ICON_DIR = "/data/storage/petal/siyuan-plugin-copilot/webappIcon";
const MAX_HISTORY_COUNT = 200;
const DEFAULT_PLUGIN_NAMESPACE = "siyuan-copilot-codex";
const LEGACY_PLUGIN_NAMESPACE = "siyuan-plugin-copilot";
const ADD_CHAT_CONTEXT_EVENT_SUFFIX = "add-chat-context";
const DOCK_ICON_ID = "iconCode";
const ICON_COPILOT_ID = "iconCopilotCodex";
const ICON_MODEL_SETTING_ID = "iconModelSettingCodex";
const ICON_TRANSLATE_ID = "iconTranslateCodex";
const ICON_WEBAPP_ID = "iconCopilotWebAppCodex";
const SETTINGS_RECOVERY_VERSION = 1;

const AI_SIDEBAR_TYPE = "codex-ai-chat-sidebar";
const AI_TAB_TYPE = "codex-ai-chat-tab";
const WEBAPP_TAB_TYPE = "codex-webapp-tab";

type AddChatContextEventDetail =
    | {
        kind: "selection";
        requestId: string;
        markdown: string;
        plainText?: string;
        source?: string;
    }
    | {
        kind: "doc";
        requestId: string;
        docId: string;
        source?: string;
    }
    | {
        kind: "block";
        requestId: string;
        blockId: string;
        source?: string;
    };

interface WebViewHistory {
    url: string;
    title: string;
    timestamp: number;
    visitCount: number;
}



export default class PluginSample extends Plugin {
    private aiSidebarApp: AISidebar;
    private chatDialogs: Map<string, { dialog: Dialog; app: ChatDialog }> = new Map();
    private webApps: Map<string, any> = new Map(); // 存储待打开的小程序数据
    private webViewHistory: WebViewHistory[] = []; // WebView 历史记录
    private domainIconMap: Map<string, string> = new Map(); // 缓存域名与图标文件名的映射
    private menuEventBus: any = null;
    private menuEventBuses: any[] = [];
    private menuDomObserver: MutationObserver | null = null;
    private domContextMenuBound = false;
    private linkClickListenerBound = false;
    private lastContextMenuTarget: EventTarget | null = null;
    private lastContextMenuAt = 0;
    private get pluginNamespace(): string {
        const raw = String(this.name || DEFAULT_PLUGIN_NAMESPACE).toLowerCase().trim();
        return raw.replace(/[^a-z0-9_-]/g, "-") || DEFAULT_PLUGIN_NAMESPACE;
    }

    private getAddChatContextEventName(): string {
        return `${this.pluginNamespace}:${ADD_CHAT_CONTEXT_EVENT_SUFFIX}`;
    }

    private get domMenuItemDataAttr(): string {
        return `data-${this.pluginNamespace}-submit-menu-item`;
    }

    private getMenuEventDetail(eventOrDetail: any) {
        if (!eventOrDetail) return null;
        if (typeof eventOrDetail === "object" && "detail" in eventOrDetail && eventOrDetail.detail) {
            return eventOrDetail.detail;
        }
        return eventOrDetail;
    }

    private readonly onOpenMenuContent = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        const range: Range | undefined = detail?.range;
        const hasSelection = !!range && !range.collapsed;
        const savedRange = hasSelection ? range!.cloneRange() : null;
        const blockId =
            this.extractBlockIdFromElement(detail?.element) ||
            this.extractBlockIdFromElement(detail?.protyle?.element) ||
            this.pickValidBlockId([detail?.protyle?.block?.id, detail?.protyle?.options?.blockId]);
        if (!menu) return;
        this.addSubmitToCodexMenu(menu, () => {
            if (savedRange) {
                const { markdown, plainText } = this.extractRangeContent(savedRange);
                const content = (markdown || plainText || "").trim();
                if (!content) {
                    showMessage(t("toolbar.submitToCodexEmpty"));
                    return;
                }
                this.dispatchAddChatContext({
                    kind: "selection",
                    markdown: content,
                    plainText,
                    source: "open-menu-content",
                });
                showMessage(t("toolbar.submitToCodexSuccess"));
                return;
            }
            if (blockId) {
                this.dispatchAddChatContext({
                    kind: "block",
                    blockId,
                    source: "open-menu-content",
                });
                showMessage(t("toolbar.submitToCodexSuccess"));
                return;
            }
            showMessage(t("toolbar.submitToCodexEmpty"));
        });
    };
    private readonly onOpenMenuDocTree = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        const type = detail?.type;
        if (!menu || (type !== "doc" && type !== "docs")) return;
        this.addSubmitToCodexMenu(menu, () => {
            const elements = Array.from((detail?.elements || []) as NodeListOf<HTMLElement>);
            const docIds = Array.from(
                new Set(elements.map(el => this.extractBlockIdFromElement(el)).filter(Boolean))
            ) as string[];
            if (docIds.length === 0) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            for (const docId of docIds) {
                this.dispatchAddChatContext({
                    kind: "doc",
                    docId,
                    source: "open-menu-doctree",
                });
            }
            showMessage(t("toolbar.submitToCodexSuccess"));
        });
    };
    private readonly onOpenMenuBlockRef = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        if (!menu) return;
        this.addSubmitToCodexMenu(menu, () => {
            const blockId =
                this.extractBlockIdFromElement(detail?.element) ||
                this.extractBlockIdFromElement(detail?.protyle?.element) ||
                this.pickValidBlockId([detail?.protyle?.block?.id, detail?.protyle?.options?.blockId]);
            if (!blockId) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            this.dispatchAddChatContext({
                kind: "block",
                blockId,
                source: "open-menu-blockref",
            });
            showMessage(t("toolbar.submitToCodexSuccess"));
        });
    };
    private readonly onOpenMenuFileAnnotationRef = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        if (!menu) return;
        this.addSubmitToCodexMenu(menu, () => {
            const blockId =
                this.extractBlockIdFromElement(detail?.element) ||
                this.extractBlockIdFromElement(detail?.protyle?.element) ||
                this.pickValidBlockId([detail?.protyle?.block?.id, detail?.protyle?.options?.blockId]);
            if (!blockId) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            this.dispatchAddChatContext({
                kind: "block",
                blockId,
                source: "open-menu-fileannotationref",
            });
            showMessage(t("toolbar.submitToCodexSuccess"));
        });
    };
    private readonly onClickBlockIcon = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        if (!menu) return;
        this.addSubmitToCodexMenu(menu, () => {
            const blockElements = Array.from((detail?.blockElements || []) as HTMLElement[]);
            const blockIds = Array.from(
                new Set(blockElements.map(el => this.extractBlockIdFromElement(el)).filter(Boolean))
            ) as string[];
            if (blockIds.length === 0) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            for (const blockId of blockIds) {
                this.dispatchAddChatContext({
                    kind: "block",
                    blockId,
                    source: "click-blockicon",
                });
            }
            showMessage(t("toolbar.submitToCodexSuccess"));
        });
    };
    private readonly onClickEditorTitleIcon = (eventOrDetail: any) => {
        const detail = this.getMenuEventDetail(eventOrDetail);
        const menu = detail?.menu;
        if (!menu) return;
        this.addSubmitToCodexMenu(menu, () => {
            const docId = this.pickValidBlockId([detail?.data?.id, detail?.data?.rootID]);
            if (!docId) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            this.dispatchAddChatContext({
                kind: "doc",
                docId,
                source: "click-editortitleicon",
            });
            showMessage(t("toolbar.submitToCodexSuccess"));
        });
    };
    private readonly onDocumentContextMenu = (event: MouseEvent) => {
        this.lastContextMenuTarget = event.target;
        this.lastContextMenuAt = Date.now();
        setTimeout(() => this.injectDomFallbackMenuItem(), 0);
    };

    private normalizeTargetElement(target: EventTarget | null): HTMLElement | null {
        if (!target) return null;
        if (target instanceof HTMLElement) return target;
        if (target instanceof Text) return target.parentElement;
        return null;
    }

    private collectDocTreeSelectedIds(): string[] {
        const selectors = [
            ".file-tree li[data-node-id].b3-list-item--focus",
            ".file-tree li[data-node-id][aria-selected='true']",
            ".file-tree li[data-node-id].b3-list-item--select",
        ];
        const ids = new Set<string>();
        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            for (const node of nodes) {
                const id = this.pickValidBlockId([
                    node.getAttribute("data-node-id"),
                    node.getAttribute("data-id"),
                ]);
                if (id) {
                    ids.add(id);
                }
            }
        }
        return Array.from(ids);
    }

    private getContextFromLatestDomState(): {
        markdown?: string;
        plainText?: string;
        blockId?: string;
        docIds?: string[];
    } {
        const context: {
            markdown?: string;
            plainText?: string;
            blockId?: string;
            docIds?: string[];
        } = {};
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (!range.collapsed) {
                const { markdown, plainText } = this.extractRangeContent(range.cloneRange());
                if ((markdown || plainText || "").trim()) {
                    context.markdown = markdown;
                    context.plainText = plainText;
                    return context;
                }
            }
        }
        const targetElement = this.normalizeTargetElement(this.lastContextMenuTarget);
        if (targetElement) {
            const blockId = this.extractBlockIdFromElement(targetElement);
            if (blockId) {
                context.blockId = blockId;
                return context;
            }
        }
        const docIds = this.collectDocTreeSelectedIds();
        if (docIds.length > 0) {
            context.docIds = docIds;
        }
        return context;
    }

    private submitContextFromDomFallback() {
        const context = this.getContextFromLatestDomState();
        if (context.markdown || context.plainText) {
            const content = (context.markdown || context.plainText || "").trim();
            if (!content) {
                showMessage(t("toolbar.submitToCodexEmpty"));
                return;
            }
            this.dispatchAddChatContext({
                kind: "selection",
                markdown: content,
                plainText: context.plainText,
                source: "dom-fallback-selection",
            });
            showMessage(t("toolbar.submitToCodexSuccess"));
            return;
        }
        if (context.blockId) {
            this.dispatchAddChatContext({
                kind: "block",
                blockId: context.blockId,
                source: "dom-fallback-block",
            });
            showMessage(t("toolbar.submitToCodexSuccess"));
            return;
        }
        if (context.docIds && context.docIds.length > 0) {
            for (const docId of context.docIds) {
                this.dispatchAddChatContext({
                    kind: "doc",
                    docId,
                    source: "dom-fallback-doctree",
                });
            }
            showMessage(t("toolbar.submitToCodexSuccess"));
            return;
        }
        showMessage(t("toolbar.submitToCodexEmpty"));
    }

    private createDomFallbackMenuItem(): HTMLButtonElement {
        const button = document.createElement("button");
        button.className = "b3-menu__item";
        button.setAttribute(this.domMenuItemDataAttr, "1");
        button.type = "button";
        const label = t("toolbar.submitToCodex") || "提交给 Codex";
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("class", "b3-menu__icon");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${ICON_COPILOT_ID}`);
        icon.appendChild(use);
        const span = document.createElement("span");
        span.className = "b3-menu__label";
        span.textContent = label;
        button.appendChild(icon);
        button.appendChild(span);
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.submitContextFromDomFallback();
        });
        return button;
    }

    private isVisibleMenu(menu: HTMLElement): boolean {
        if (!menu) return false;
        const style = window.getComputedStyle(menu);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = menu.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    private getDomFallbackMenuContainer(menu: HTMLElement): HTMLElement | null {
        if (!menu) return null;
        if (menu.classList.contains("b3-menu__items")) return menu;
        const nestedContainer = menu.querySelector(".b3-menu__items");
        if (nestedContainer instanceof HTMLElement) return nestedContainer;
        return null;
    }

    private injectDomFallbackMenuItem() {
        if (Date.now() - this.lastContextMenuAt > 1500) return;
        const menus = Array.from(document.querySelectorAll(".b3-menu")) as HTMLElement[];
        if (menus.length === 0) return;
        const visibleMenus = menus.filter((menu) => this.isVisibleMenu(menu));
        if (visibleMenus.length === 0) return;
        const menu = visibleMenus[visibleMenus.length - 1];
        const context = this.getContextFromLatestDomState();
        const hasContext =
            !!(context.markdown || context.plainText || context.blockId) ||
            !!(context.docIds && context.docIds.length > 0);
        if (!hasContext) return;
        const label = (t("toolbar.submitToCodex") || "提交给 Codex").trim();
        const container = this.getDomFallbackMenuContainer(menu);
        if (!container) return;
        const hasExistingLabel = Array.from(container.querySelectorAll(".b3-menu__label")).some((el) => {
            return (el.textContent || "").trim() === label;
        });
        if (container.querySelector(`[${this.domMenuItemDataAttr}]`) || hasExistingLabel) return;
        container.appendChild(this.createDomFallbackMenuItem());
    }

    private setupDomMenuFallback() {
        if (!this.domContextMenuBound) {
            document.addEventListener("contextmenu", this.onDocumentContextMenu, true);
            this.domContextMenuBound = true;
        }
        if (this.menuDomObserver) return;
        this.menuDomObserver = new MutationObserver(() => {
            this.injectDomFallbackMenuItem();
        });
        this.menuDomObserver.observe(document.body, { childList: true, subtree: true });
    }

    private teardownDomMenuFallback() {
        if (this.domContextMenuBound) {
            document.removeEventListener("contextmenu", this.onDocumentContextMenu, true);
            this.domContextMenuBound = false;
        }
        if (this.menuDomObserver) {
            this.menuDomObserver.disconnect();
            this.menuDomObserver = null;
        }
    }

    private isValidBlockId(id: string | null | undefined): id is string {
        return typeof id === "string" && /^\d{14}-[a-z0-9]{7}$/i.test(id.trim());
    }

    private pickValidBlockId(candidates: Array<string | null | undefined>): string | null {
        for (const raw of candidates) {
            const id = typeof raw === "string" ? raw.trim() : "";
            if (this.isValidBlockId(id)) {
                return id;
            }
        }
        return null;
    }

    private extractBlockIdFromElement(element: HTMLElement | null | undefined): string | null {
        if (!element) return null;
        const candidates = [
            element.getAttribute("data-node-id"),
            element.getAttribute("data-id"),
            element.dataset?.nodeId,
            element.dataset?.id,
            element.closest<HTMLElement>("[data-node-id]")?.getAttribute("data-node-id"),
            element.closest<HTMLElement>("[data-id]")?.getAttribute("data-id"),
        ];
        const fromAttrs = this.pickValidBlockId(candidates);
        if (fromAttrs) return fromAttrs;
        const text = element.textContent || "";
        const match = text.match(/\d{14}-[a-z0-9]{7}/i);
        return match ? match[0] : null;
    }

    private extractRangeContent(range: Range): { markdown: string; plainText: string } {
        const plainText = range.toString().trim();
        let markdown = "";
        try {
            const div = document.createElement("div");
            div.appendChild(range.cloneContents());
            const selectedHtml = div.innerHTML;
            if (selectedHtml && typeof window !== "undefined" && (window as any).Lute) {
                const lute = (window as any).Lute.New();
                markdown = (lute.HTML2Md(selectedHtml) || "").trim();
            }
        } catch (e) {
            console.warn("Extract range markdown failed:", e);
        }
        if (!markdown) {
            markdown = plainText;
        }
        return { markdown, plainText };
    }

    private dispatchAddChatContext(
        detail: Omit<AddChatContextEventDetail, "requestId">
    ) {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        window.dispatchEvent(
            new CustomEvent<AddChatContextEventDetail>(this.getAddChatContextEventName(), {
                detail: { ...detail, requestId } as AddChatContextEventDetail,
            })
        );
    }

    private addSubmitToCodexMenu(menu: any, onClick: () => void) {
        if (!menu || typeof menu.addItem !== "function") return;
        menu.addItem({
            icon: ICON_COPILOT_ID,
            label: t("toolbar.submitToCodex") || "提交给 Codex",
            id: `${this.pluginNamespace}-submit-codex`,
            click: () => {
                onClick();
                return false;
            },
        });
    }

    private registerAddChatContextMenuHandlers() {
        const candidates = [
            (this as any).eventBus,
            (this.app as any)?.eventBus,
            (window as any)?.siyuan?.eventBus,
        ].filter(Boolean);
        const uniqueBuses: any[] = [];
        for (const bus of candidates) {
            if (!bus || typeof bus.on !== "function" || typeof bus.off !== "function") continue;
            if (uniqueBuses.includes(bus)) continue;
            uniqueBuses.push(bus);
        }
        if (this.menuEventBuses.length > 0) {
            this.unregisterAddChatContextMenuHandlers();
        }
        if (uniqueBuses.length === 0) return;
        this.menuEventBuses = uniqueBuses;
        this.menuEventBus = uniqueBuses[0];
        for (const bus of uniqueBuses) {
            bus.on("open-menu-content", this.onOpenMenuContent);
            bus.on("open-menu-doctree", this.onOpenMenuDocTree);
            bus.on("open-menu-blockref", this.onOpenMenuBlockRef);
            bus.on("open-menu-fileannotationref", this.onOpenMenuFileAnnotationRef);
            bus.on("click-blockicon", this.onClickBlockIcon);
            bus.on("click-editortitleicon", this.onClickEditorTitleIcon);
        }
    }

    private unregisterAddChatContextMenuHandlers() {
        for (const bus of this.menuEventBuses) {
            bus.off("open-menu-content", this.onOpenMenuContent);
            bus.off("open-menu-doctree", this.onOpenMenuDocTree);
            bus.off("open-menu-blockref", this.onOpenMenuBlockRef);
            bus.off("open-menu-fileannotationref", this.onOpenMenuFileAnnotationRef);
            bus.off("click-blockicon", this.onClickBlockIcon);
            bus.off("click-editortitleicon", this.onClickEditorTitleIcon);
        }
        this.menuEventBuses = [];
        this.menuEventBus = null;
    }

    /**
     * 加载 WebView 历史记录
     */
    private async loadWebViewHistory(): Promise<WebViewHistory[]> {
        try {
            const history = await this.loadData(WEBVIEW_HISTORY_FILE);
            return Array.isArray(history) ? history : [];
        } catch (e) {
            console.error('Failed to load webview history:', e);
            return [];
        }
    }

    /**
     * 保存 WebView 历史记录
     */
    private async saveWebViewHistory() {
        try {
            // 限制历史记录数量
            if (this.webViewHistory.length > MAX_HISTORY_COUNT) {
                this.webViewHistory = this.webViewHistory
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, MAX_HISTORY_COUNT);
            }
            await this.saveData(WEBVIEW_HISTORY_FILE, this.webViewHistory);
        } catch (e) {
            console.error('Failed to save webview history:', e);
        }
    }

    /**
     * 添加到历史记录
     */
    private async addToWebViewHistory(url: string, title: string) {
        if (!url) return;

        // 查找是否已存在
        const existingIndex = this.webViewHistory.findIndex(h => h.url === url);

        if (existingIndex >= 0) {
            // 更新现有记录
            this.webViewHistory[existingIndex].title = title || url;
            this.webViewHistory[existingIndex].timestamp = Date.now();
            this.webViewHistory[existingIndex].visitCount++;
        } else {
            // 添加新记录
            this.webViewHistory.unshift({
                url,
                title: title || url,
                timestamp: Date.now(),
                visitCount: 1
            });
        }

        await this.saveWebViewHistory();
    }

    /**
     * 搜索历史记录
     * 支持空格分隔的多个关键词（AND 搜索）
     */
    private searchWebViewHistory(query: string): WebViewHistory[] {
        if (!query.trim()) {
            // 返回最近访问的记录
            return this.webViewHistory
                .slice(0, 10)
                .sort((a, b) => b.timestamp - a.timestamp);
        }

        // 分割搜索关键词
        const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);

        // 过滤匹配所有关键词的记录
        const filtered = this.webViewHistory.filter(item => {
            const searchText = `${item.title} ${item.url}`.toLowerCase();
            return keywords.every(keyword => searchText.includes(keyword));
        });

        // 按访问次数和时间排序
        return filtered
            .sort((a, b) => {
                // 优先按访问次数排序
                const countDiff = b.visitCount - a.visitCount;
                if (countDiff !== 0) return countDiff;
                // 其次按时间排序
                return b.timestamp - a.timestamp;
            })
            .slice(0, 10);
    }



    /**
     * 注册小程序图标
     */
    registerWebAppIcon(appId: string, iconBase64: string) {
        try {
            if (!iconBase64 || !iconBase64.startsWith('data:image')) {
                return;
            }

            const iconId = `iconWebApp_${appId}`;

            // 从base64中提取图片数据
            const base64Data = iconBase64;

            // 创建SVG中的image元素
            const svgContent = `<image href="${base64Data}" width="32" height="32"/>`;

            this.addIcons(`
                <symbol id="${iconId}" viewBox="0 0 32 32">
                    ${svgContent}
                </symbol>
            `);
        } catch (e) {
            console.error(`Failed to register icon for webapp ${appId}:`, e);
        }
    }

    /**
     * 获取小程序的图标ID
     */
    getWebAppIconId(appId: string): string {
        return `iconWebApp_${appId}`;
    }

    // 将 Blob 转为 data URL
    private blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result as string);
                };
                reader.onerror = (e) => reject(e);
                reader.readAsDataURL(blob);
            } catch (e) {
                reject(e);
            }
        });
    }

    // 从 URL 中提取域名
    private getDomainFromUrl(url: string): string {
        try {
            const u = new URL(url);
            return u.hostname;
        } catch (e) {
            return '';
        }
    }

    // 判断输入是否很可能是一个 URL（支持不带协议的域名如 example.com）
    private isLikelyUrl(input: string): boolean {
        if (!input) return false;
        const s = input.trim();
        // 含空格的通常不是 URL，例如搜索词
        if (s.indexOf(' ') >= 0) return false;
        // 以协议开头明显是 URL
        if (/^[a-zA-Z][a-zA-Z0-9+-.]*:\/\//.test(s)) return true;
        // 包含点号且不以@开头(排除邮箱)，通常是域名或网址
        if (/\./.test(s) && !/^@/.test(s)) return true;
        return false;
    }

    // 依次尝试多个 favicon 源，遇到第一个成功的就返回 data:image...
    private async tryFetchFavicon(domain: string): Promise<string | null> {
        if (!domain) return null;

        const sources = [
            // FaviconIm (尝试常见的路径)
            `https://favicon.im/${domain}`,
            `https://favicon.im/favicon/${domain}`,
            // Google Favicons
            `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
            // Unavatar
            `https://unavatar.io/${domain}`,
            // DuckDuckGo
            `https://icons.duckduckgo.com/ip3/${domain}.ico`
        ];

        for (const src of sources) {
            try {
                const resp = await fetch(src, { mode: 'cors' });
                if (!resp.ok) continue;
                const ct = (resp.headers.get('content-type') || '').toLowerCase();
                if (ct.startsWith('image') || src.endsWith('.ico')) {
                    const blob = await resp.blob();
                    if (!blob || blob.size === 0) continue;
                    try {
                        const dataUrl = await this.blobToDataURL(blob);
                        if (dataUrl && dataUrl.startsWith('data:image')) {
                            return dataUrl;
                        }
                    } catch (e) {
                        // 转换失败，继续下一源
                        console.warn('favicon 转换失败', e);
                        continue;
                    }
                }
            } catch (e) {
                // 网络或 CORS 错误，尝试下一个
                console.warn('尝试 favicon 源失败:', src, e);
                continue;
            }
        }

        return null;
    }

    private getExtensionFromMime(mime: string): string {
        if (!mime) return 'png';
        mime = mime.toLowerCase();
        if (mime.includes('png')) return 'png';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if (mime.includes('gif')) return 'gif';
        if (mime.includes('svg')) return 'svg';
        if (mime.includes('icon') || mime.includes('ico')) return 'ico';
        if (mime.includes('webp')) return 'webp';
        return 'png';
    }

    private dataURItoBlob(dataURI: string): Blob | null {
        try {
            // convert base64/URLEncoded data component to raw binary data held in a string
            let byteString;
            if (dataURI.split(',')[0].indexOf('base64') >= 0)
                byteString = atob(dataURI.split(',')[1]);
            else
                byteString = decodeURI(dataURI.split(',')[1]);

            // separate out the mime component
            let mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

            // write the bytes of the string to a typed array
            let ia = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }

            return new Blob([ia], { type: mimeString });
        } catch (e) {
            console.error('dataURItoBlob failed', e);
            return null;
        }
    }

    // 为域名获取或创建图标并返回可用于 openTab 的 icon id
    private async getOrCreateIconForDomain(url: string): Promise<string> {
        try {
            const domain = this.getDomainFromUrl(url);
            if (!domain) return ICON_WEBAPP_ID;

            // 优先检查是否有已配置的 WebApp 使用此域名
            // 这样用户自定义的图标优先级最高
            if (this.data && this.data.webApps && Array.isArray(this.data.webApps)) {
                const matchedApp = this.data.webApps.find((app: any) => {
                    try {
                        return this.getDomainFromUrl(app.url) === domain;
                    } catch (e) { return false; }
                });

                if (matchedApp && matchedApp.icon && !matchedApp.icon.startsWith('data:')) {
                    const iconFilename = matchedApp.icon;
                    // 如果内存映射中没有，或者映射的文件名不同（虽然按我们的逻辑应该是一样的，但为了安全），尝试加载
                    // 注意：如果文件名相同但文件内容变了，这里无法检测，需要由 Save 动作触发重载，或者这里不缓存 DataUrl
                    // 但为了性能，我们假设 index.ts 加载后文件内容不变。

                    if (!this.domainIconMap.has(domain) || this.domainIconMap.get(domain) !== iconFilename) {
                        const iconPath = `${WEBAPP_ICON_DIR}/${iconFilename}`;
                        try {
                            const blob = await getFileBlob(iconPath);
                            if (blob) {
                                // 检查是否是旧格式 (.icon 文本文件)
                                if (iconFilename.endsWith('.icon')) {
                                    const iconData = await blob.text();
                                    if (iconData && iconData.startsWith('data:image')) {
                                        this.registerWebAppIcon(domain, iconData);
                                        this.domainIconMap.set(domain, iconFilename);
                                        return this.getWebAppIconId(domain);
                                    }
                                } else {
                                    // 图片文件
                                    const iconData = await this.blobToDataURL(blob);
                                    if (iconData) {
                                        this.registerWebAppIcon(domain, iconData);
                                        this.domainIconMap.set(domain, iconFilename);
                                        return this.getWebAppIconId(domain);
                                    }
                                }
                            }
                        } catch (e) {
                            // quiet fail, fall through to fetch
                        }
                    } else {
                        // 映射已存在且一致，确实已注册
                        return this.getWebAppIconId(domain);
                    }
                }
            }

            // 检查缓存 Map
            if (this.domainIconMap.has(domain)) {
                // 如果已有缓存文件，尝试注册（如果尚未注册，这里假设已经注册或注册失败不影响获取 ID）
                // 实际上我们应该确保它被注册。
                // 如果 onload 成功，它应该被注册了。
                // 如果是本次 session 新添加的，它也被注册了。
                return this.getWebAppIconId(domain);
            }

            // 否则尝试抓取
            const fetchedDataUri = await this.tryFetchFavicon(domain);
            if (fetchedDataUri) {
                // 解析 mime
                let mime = 'image/png';
                try {
                    const match = fetchedDataUri.match(/data:([^;]+);/);
                    if (match) mime = match[1];
                } catch (e) { }

                const ext = this.getExtensionFromMime(mime);
                const filename = `${domain}.${ext}`;
                const savePath = `${WEBAPP_ICON_DIR}/${filename}`;

                // 转换为 Blob
                const blob = this.dataURItoBlob(fetchedDataUri);

                if (blob) {
                    // 保存到独立文件（图片格式）
                    try {
                        await putFile(savePath, false, blob);
                        this.domainIconMap.set(domain, filename);
                    } catch (e) {
                        console.warn('保存 favicon 到文件失败:', e);
                    }
                }

                try {
                    this.registerWebAppIcon(domain, fetchedDataUri);
                    return this.getWebAppIconId(domain);
                } catch (e) {
                    console.warn('注册抓取到的 favicon 失败:', e);
                }
            }
        } catch (e) {
            console.warn('getOrCreateIconForDomain 出错:', e);
        }

        return ICON_WEBAPP_ID;
    }

    async onload() {
        // 插件被启用时会自动调用这个函数
        // 设置i18n插件实例
        setPluginInstance(this);
        this.registerAddChatContextMenuHandlers();
        this.setupDomMenuFallback();



        // 加载历史记录
        this.webViewHistory = await this.loadWebViewHistory();

        // 加载设置
        await this.loadSettings();
        this.addIcons(`
    <symbol id="${ICON_COPILOT_ID}" viewBox="0 0 1024 1024">
    <path d="M369.579 617.984a42.71 42.71 0 1 1 85.461 0v85.205a42.71 42.71 0 1 1-85.461 0v-85.205z m284.8 0a42.71 42.71 0 1 0-85.462 0v85.205a42.71 42.71 0 1 0 85.462 0v-85.205zM511.957 171.861c-36.053-52.01-110.848-55.893-168.32-50.688-65.834 6.571-121.301 29.227-152.49 62.464-54.102 59.136-56.576 183.083-30.507 251.307-2.603 11.69-5.12 23.51-6.912 36.053C105.515 483.67 56.32 551.98 56.32 600.832v92.245c0 25.6 11.947 48.982 33.067 64.939 120.49 89.515 270.677 158.89 422.613 158.89 151.893 0 302.08-69.375 422.57-158.89a80.64 80.64 0 0 0 33.067-64.896v-92.288c0-48.853-49.194-117.163-97.408-129.835-1.792-12.544-4.266-24.32-6.912-36.01 26.07-68.267 23.552-192.214-30.506-251.307-31.19-33.28-86.614-55.893-152.491-62.507-57.472-5.162-132.267-1.28-168.363 50.688z m284.8 574.294c-65.493 36.437-174.293 85.333-284.8 85.333S292.693 782.592 227.2 746.155V498.73c105.685 40.96 227.285 19.84 284.715-75.008H512c57.43 94.848 179.03 115.925 284.715 75.008v247.381z m-341.76-454.827c0 67.67-20.48 141.312-113.92 141.312s-111.189-22.357-111.189-85.205c0-99.67 15.19-142.336 141.483-142.336 72.96 0 83.626 23.466 83.626 86.272z m113.92 0c0-62.805 10.667-86.187 83.67-86.187 126.293 0 141.482 42.667 141.482 142.294 0 62.848-17.792 85.205-111.232 85.205s-113.92-73.643-113.92-141.27z" p-id="5384"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="${ICON_MODEL_SETTING_ID}" viewBox="0 0 1024 1024">
    <path d="M1165.18 856.258H444.69c-15.086-57.882-67.556-100.843-130.03-100.843-73.95 0-134.292 60.178-134.292 134.293 0 73.95 60.178 134.292 134.293 134.292 62.473 0 115.107-42.796 130.029-100.678h720.653c18.529 0 33.614-15.086 33.614-33.614-0.164-18.53-15.25-33.45-33.778-33.45zM314.66 956.936c-37.057 0-67.064-30.17-67.064-67.064 0-37.058 30.171-67.065 67.065-67.065s67.064 30.171 67.064 67.065c0 36.893-30.17 67.064-67.064 67.064z m851.175-478.468H1062.37c-14.921-57.882-67.556-100.678-130.029-100.678s-115.108 42.796-130.029 100.678H218.246c-18.53 0-33.614 15.085-33.614 33.614 0 18.529 15.085 33.614 33.614 33.614H802.31c14.921 57.882 67.556 100.678 130.03 100.678 62.472 0 115.107-42.796 130.028-100.678h103.466c18.529 0 33.614-15.085 33.614-33.614 0-18.693-15.085-33.614-33.614-33.614zM932.34 579.146c-37.057 0-67.064-30.17-67.064-67.064s30.17-67.064 67.064-67.064c37.058 0 67.064 30.17 67.064 67.064s-30.006 67.064-67.064 67.064zM314.66 268.421c62.474 0 115.108-42.797 130.03-100.678h720.653c18.529 0 33.614-15.086 33.614-33.615 0-18.528-15.085-33.614-33.614-33.614H444.69C429.604 42.796 377.134 0 314.66 0c-74.114 0-134.292 60.177-134.292 134.292 0 73.951 60.178 134.129 134.293 134.129z m0-201.357c37.058 0 67.065 30.17 67.065 67.064 0 37.058-30.17 67.065-67.064 67.065s-67.065-30.171-67.065-67.065c-0.163-36.893 30.007-67.064 67.065-67.064z m0 0" p-id="4685"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="${ICON_TRANSLATE_ID}" viewBox="0 0 1024 1024">
<path d="M608 416h288c35.36 0 64 28.48 64 64v416c0 35.36-28.48 64-64 64H480c-35.36 0-64-28.48-64-64v-288H128c-35.36 0-64-28.48-64-64V128c0-35.36 28.48-64 64-64h416c35.36 0 64 28.48 64 64v288z m0 64v64c0 35.36-28.48 64-64 64h-64v256.032c0 17.664 14.304 31.968 31.968 31.968H864a31.968 31.968 0 0 0 31.968-31.968V512a31.968 31.968 0 0 0-31.968-31.968H608zM128 159.968V512c0 17.664 14.304 31.968 31.968 31.968H512a31.968 31.968 0 0 0 31.968-31.968V160A31.968 31.968 0 0 0 512.032 128H160A31.968 31.968 0 0 0 128 159.968z m64 244.288V243.36h112.736V176h46.752c6.4 0.928 9.632 1.824 9.632 2.752a10.56 10.56 0 0 1-1.376 4.128c-2.752 7.328-4.128 16.032-4.128 26.112v34.368h119.648v156.768h-50.88v-20.64h-68.768v118.272H306.112v-118.272H238.752v24.768H192z m46.72-122.368v60.48h67.392V281.92H238.752z m185.664 60.48V281.92h-68.768v60.48h68.768z m203.84 488H576L668.128 576h64.64l89.344 254.4h-54.976l-19.264-53.664h-100.384l-19.232 53.632z m33.024-96.256h72.864l-34.368-108.608h-1.376l-37.12 108.608zM896 320h-64a128 128 0 0 0-128-128V128a192 192 0 0 1 192 192zM128 704h64a128 128 0 0 0 128 128v64a192 192 0 0 1-192-192z" p-id="5072"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="${ICON_WEBAPP_ID}" viewBox="0 0 1024 1024">
<path d="M878.159424 565.40635l-327.396585 0c-11.307533 0-20.466124 9.168824-20.466124 20.466124l0 327.396585c0 11.307533 9.15859 20.466124 20.466124 20.466124l327.396585 0c11.2973 0 20.466124-9.15859 20.466124-20.466124l0-327.396585C898.625548 574.575174 889.456724 565.40635 878.159424 565.40635zM857.6933 892.802936l-286.464337 0 0-286.464337 286.464337 0L857.6933 892.802936z" p-id="7151"></path><path d="M430.606225 565.40635l-327.396585 0c-11.2973 0-20.466124 9.168824-20.466124 20.466124l0 327.396585c0 11.307533 9.168824 20.466124 20.466124 20.466124l327.396585 0c11.307533 0 20.466124-9.15859 20.466124-20.466124l0-327.396585C451.072349 574.575174 441.913758 565.40635 430.606225 565.40635zM410.140101 892.802936l-286.464337 0 0-286.464337 286.464337 0L410.140101 892.802936z" p-id="7152"></path><path d="M430.606225 115.601878l-327.396585 0c-11.2973 0-20.466124 9.15859-20.466124 20.466124l0 327.386352c0 11.307533 9.168824 20.466124 20.466124 20.466124l327.396585 0c11.307533 0 20.466124-9.15859 20.466124-20.466124l0-327.386352C451.072349 124.760468 441.913758 115.601878 430.606225 115.601878zM410.140101 442.98823l-286.464337 0 0-286.454104 286.464337 0L410.140101 442.98823z" p-id="7153"></path><path d="M965.529307 277.744745l-214.433814-214.433814c-3.837398-3.837398-9.046027-5.996574-14.46955-5.996574-5.433756 0-10.632151 2.159176-14.479783 5.996574l-214.433814 214.433814c-7.992021 7.992021-7.992021 20.957311 0 28.949332l214.433814 214.433814c4.001127 3.990894 9.240455 5.996574 14.479783 5.996574 5.229095 0 10.468422-2.00568 14.46955-5.996574l214.433814-214.433814c3.837398-3.837398 5.996574-9.046027 5.996574-14.46955C971.525881 286.790772 969.366705 281.582143 965.529307 277.744745zM736.625944 477.709009l-185.494715-185.484482 185.494715-185.494715 185.484482 185.494715L736.625944 477.709009z" p-id="7154"></path>
    </symbol>
    `);
        // 注册AI标签页类型
        const pluginInstance = this;
        this.addTab({
            type: AI_TAB_TYPE,
            init() {
                const element = this.element as HTMLElement;
                element.style.display = 'flex';
                element.style.flexDirection = 'column';
                element.style.height = '100%';
                // 创建AI聊天界面
                new AISidebar({
                    target: element,
                    props: {
                        plugin: pluginInstance,
                        addChatContextEvent: pluginInstance.getAddChatContextEventName(),
                    }
                });
            },
            destroy() {
                // Svelte组件会自动清理
            }
        });
        // 注册小程序标签页类型
        this.addTab({
            type: WEBAPP_TAB_TYPE,
            init() {
                const element = this.element as HTMLElement;
                element.style.display = 'flex';
                element.style.flexDirection = 'column';
                element.style.height = '100%';
                element.tabIndex = 0; // 允许元素获取焦点以接收键盘事件

                // 从 this.data 中获取 app 信息
                const app = this.data?.app;
                if (app) {
                    // 创建 webview 容器
                    const container = document.createElement('div');
                    container.className = 'fn__flex-1 fn__flex-column';
                    container.style.height = '100%';
                    container.style.width = '100%';
                    container.style.display = 'flex';
                    container.style.flexDirection = 'column';
                    container.style.transition = 'all 0.3s ease';
                    container.tabIndex = 0; // 允许容器获取焦点

                    // 创建顶部导航栏（类似浏览器）
                    const navbar = document.createElement('div');
                    navbar.style.display = 'flex';
                    navbar.style.alignItems = 'center';
                    navbar.style.padding = '4px 8px';
                    navbar.style.gap = '4px';
                    navbar.style.background = 'var(--b3-theme-surface)';
                    navbar.style.borderBottom = '1px solid var(--b3-border-color)';
                    navbar.style.flexShrink = '0';

                    // 后退按钮
                    const backBtn = document.createElement('button');
                    backBtn.className = 'b3-button b3-button--text';
                    backBtn.title = t("webview.actions.back") || t("common.back") || "Back";
                    backBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconLeft"></use></svg>';
                    backBtn.disabled = true;
                    navbar.appendChild(backBtn);

                    // 前进按钮
                    const forwardBtn = document.createElement('button');
                    forwardBtn.className = 'b3-button b3-button--text';
                    forwardBtn.title = t("webview.actions.forward") || "Forward";
                    forwardBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRight"></use></svg>';
                    forwardBtn.disabled = true;
                    navbar.appendChild(forwardBtn);

                    // 刷新按钮
                    const refreshBtn = document.createElement('button');
                    refreshBtn.className = 'b3-button b3-button--text';
                    refreshBtn.title = t("webview.actions.refresh") || "Refresh";
                    refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
                    navbar.appendChild(refreshBtn);

                    // URL 输入框容器（包含输入框和建议列表）
                    const urlInputWrapper = document.createElement('div');
                    urlInputWrapper.style.flex = '1';
                    urlInputWrapper.style.position = 'relative';

                    // URL 显示框
                    const urlInput = document.createElement('input');
                    urlInput.type = 'text';
                    urlInput.value = app.url;
                    urlInput.className = 'b3-text-field';
                    urlInput.style.width = '100%';
                    urlInput.style.fontSize = '13px';
                    urlInput.spellcheck = false;
                    urlInput.autocomplete = 'off';
                    urlInput.placeholder = t("webview.urlPlaceholder") || "Enter URL or search history...";

                    // 建议列表容器
                    const suggestionList = document.createElement('div');
                    suggestionList.style.position = 'absolute';
                    suggestionList.style.top = '100%';
                    suggestionList.style.left = '0';
                    suggestionList.style.right = '0';
                    suggestionList.style.maxHeight = '400px';
                    suggestionList.style.overflowY = 'auto';
                    suggestionList.style.background = 'var(--b3-theme-surface)';
                    suggestionList.style.border = '1px solid var(--b3-border-color)';
                    suggestionList.style.borderTop = 'none';
                    suggestionList.style.borderRadius = '0 0 4px 4px';
                    suggestionList.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                    suggestionList.style.display = 'none';
                    suggestionList.style.zIndex = '1000';

                    // 选中的建议索引
                    let selectedSuggestionIndex = -1;
                    let currentSuggestions: WebViewHistory[] = [];

                    // 渲染建议列表
                    const renderSuggestions = (suggestions: WebViewHistory[]) => {
                        currentSuggestions = suggestions;
                        selectedSuggestionIndex = -1;
                        suggestionList.innerHTML = '';

                        if (suggestions.length === 0) {
                            suggestionList.style.display = 'none';
                            return;
                        }

                        suggestions.forEach((item, index) => {
                            const suggestionItem = document.createElement('div');
                            suggestionItem.style.padding = '8px 12px';
                            suggestionItem.style.cursor = 'pointer';
                            suggestionItem.style.display = 'flex';
                            suggestionItem.style.flexDirection = 'column';
                            suggestionItem.style.gap = '4px';
                            suggestionItem.style.borderBottom = '1px solid var(--b3-border-color)';
                            suggestionItem.dataset.index = String(index);

                            // 标题
                            const titleDiv = document.createElement('div');
                            titleDiv.style.fontSize = '13px';
                            titleDiv.style.color = 'var(--b3-theme-on-surface)';
                            titleDiv.style.fontWeight = '500';
                            titleDiv.textContent = item.title;
                            suggestionItem.appendChild(titleDiv);

                            // URL
                            const urlDiv = document.createElement('div');
                            urlDiv.style.fontSize = '12px';
                            urlDiv.style.color = 'var(--b3-theme-on-surface-light)';
                            urlDiv.style.overflow = 'hidden';
                            urlDiv.style.textOverflow = 'ellipsis';
                            urlDiv.style.whiteSpace = 'nowrap';
                            urlDiv.textContent = item.url;
                            suggestionItem.appendChild(urlDiv);

                            // 鼠标悬停效果
                            suggestionItem.addEventListener('mouseenter', () => {
                                // 清除其他选中状态
                                suggestionList.querySelectorAll('div[data-index]').forEach(el => {
                                    (el as HTMLElement).style.background = '';
                                    (el as HTMLElement).style.boxShadow = '';
                                });
                                suggestionItem.style.background = 'var(--b3-list-hover)';
                                suggestionItem.style.boxShadow = 'inset 0 0 0 1px var(--b3-theme-primary)';
                                selectedSuggestionIndex = index;
                            });

                            suggestionItem.addEventListener('mouseleave', () => {
                                suggestionItem.style.background = '';
                                suggestionItem.style.boxShadow = '';
                            });

                            // 点击选择
                            suggestionItem.addEventListener('mousedown', (e) => {
                                e.preventDefault(); // 防止失去焦点
                                urlInput.value = item.url;
                                suggestionList.style.display = 'none';
                                // 导航到选中的 URL
                                redirectCount = 0;
                                lastUrl = item.url;
                                webview.src = item.url;
                                urlInput.blur();
                            });

                            suggestionList.appendChild(suggestionItem);
                        });

                        suggestionList.style.display = 'block';
                    };

                    // 更新选中项的视觉效果
                    const updateSelectedSuggestion = () => {
                        suggestionList.querySelectorAll('div[data-index]').forEach((el, index) => {
                            if (index === selectedSuggestionIndex) {
                                (el as HTMLElement).style.background = 'var(--b3-list-hover)';
                                (el as HTMLElement).style.boxShadow = 'inset 0 0 0 1px var(--b3-theme-primary)';
                                // 滚动到可见位置
                                el.scrollIntoView({ block: 'nearest' });
                            } else {
                                (el as HTMLElement).style.background = '';
                                (el as HTMLElement).style.boxShadow = '';
                            }
                        });
                    };

                    // 输入事件 - 搜索历史
                    let searchTimeout: NodeJS.Timeout;
                    urlInput.addEventListener('input', () => {
                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(() => {
                            const query = urlInput.value.trim();
                            const results = pluginInstance.searchWebViewHistory(query);
                            renderSuggestions(results);
                        }, 150); // 防抖
                    });

                    // 获得焦点 - 显示建议
                    urlInput.addEventListener('focus', () => {
                        const query = urlInput.value.trim();
                        const results = pluginInstance.searchWebViewHistory(query);
                        renderSuggestions(results);
                    });

                    // 失去焦点 - 隐藏建议
                    urlInput.addEventListener('blur', () => {
                        // 延迟隐藏，以便点击事件能够触发
                        setTimeout(() => {
                            suggestionList.style.display = 'none';
                        }, 200);
                    });

                    // 键盘导航
                    urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
                        // 阻止冒泡，防止触发全局快捷键
                        e.stopPropagation();

                        if (e.key === 'ArrowDown') {
                            // 向下选择
                            e.preventDefault();
                            if (currentSuggestions.length > 0) {
                                selectedSuggestionIndex = Math.min(
                                    selectedSuggestionIndex + 1,
                                    currentSuggestions.length - 1
                                );
                                updateSelectedSuggestion();
                            }
                        } else if (e.key === 'ArrowUp') {
                            // 向上选择
                            e.preventDefault();
                            if (currentSuggestions.length > 0) {
                                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                                if (selectedSuggestionIndex === -1) {
                                    // 返回输入框
                                    suggestionList.querySelectorAll('div[data-index]').forEach(el => {
                                        (el as HTMLElement).style.background = '';
                                        (el as HTMLElement).style.boxShadow = '';
                                    });
                                } else {
                                    updateSelectedSuggestion();
                                }
                            }
                        } else if (e.key === 'Enter') {
                            e.preventDefault();

                            // 如果有选中的建议，使用建议
                            if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < currentSuggestions.length) {
                                const selected = currentSuggestions[selectedSuggestionIndex];
                                urlInput.value = selected.url;
                                suggestionList.style.display = 'none';
                                redirectCount = 0;
                                lastUrl = selected.url;
                                webview.src = selected.url;
                                // 尝试更新标签图标
                                (async () => {
                                    try {
                                        const iconId = await pluginInstance.getOrCreateIconForDomain(selected.url);
                                        try { if (this.tab) (this.tab as any).icon = iconId; } catch (e) { }
                                        // DOM 回退：根据标签标题查找并替换 svg use
                                        try {
                                            const headers = document.querySelectorAll('li[data-type="tab-header"]');
                                            for (const h of Array.from(headers)) {
                                                const textEl = h.querySelector('.item__text');
                                                if (textEl && textEl.textContent && textEl.textContent.indexOf(initialTitle) !== -1) {
                                                    const useEl = h.querySelector('svg use');
                                                    if (useEl) useEl.setAttribute('xlink:href', `#${iconId}`);
                                                    break;
                                                }
                                            }
                                        } catch (e) { }
                                    } catch (e) { }
                                })();
                                urlInput.blur();
                            } else {
                                // 否则使用输入的内容：如果看起来不是网址，则使用 Google 搜索
                                const raw = urlInput.value.trim();
                                if (raw) {
                                    let targetUrl = '';

                                    if (pluginInstance.isLikelyUrl(raw)) {
                                        // 把可能的域名或网址补全协议
                                        targetUrl = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
                                    } else {
                                        // 作为搜索关键词，使用用户设置的搜索引擎
                                        getSettings().then((s: any) => {
                                            const engine = (s && s.searchEngine) ? s.searchEngine : 'google';
                                            if (engine === 'bing') {
                                                targetUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(raw);
                                            } else {
                                                targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
                                            }

                                            suggestionList.style.display = 'none';
                                            redirectCount = 0;
                                            lastUrl = targetUrl;
                                            webview.src = targetUrl;

                                            // 更新标签图标（对搜索结果使用默认或尝试抓取）
                                            (async () => {
                                                try {
                                                    const iconId = await pluginInstance.getOrCreateIconForDomain(targetUrl);
                                                    try { if (this.tab) (this.tab as any).icon = iconId; } catch (e) { }
                                                    try {
                                                        const headers = document.querySelectorAll('li[data-type="tab-header"]');
                                                        for (const h of Array.from(headers)) {
                                                            const textEl = h.querySelector('.item__text');
                                                            if (textEl && textEl.textContent && textEl.textContent.indexOf(initialTitle) !== -1) {
                                                                const useEl = h.querySelector('svg use');
                                                                if (useEl) useEl.setAttribute('xlink:href', `#${iconId}`);
                                                                break;
                                                            }
                                                        }
                                                    } catch (e) { }
                                                } catch (e) { }
                                            })();
                                            urlInput.blur();
                                        }).catch(() => {
                                            // 回退到 Google
                                            targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
                                            suggestionList.style.display = 'none';
                                            redirectCount = 0;
                                            lastUrl = targetUrl;
                                            webview.src = targetUrl;
                                            urlInput.blur();
                                        });
                                    }
                                }
                            }
                        } else if (e.key === 'Escape') {
                            // ESC 关闭建议列表
                            e.preventDefault();
                            suggestionList.style.display = 'none';
                            selectedSuggestionIndex = -1;
                        }
                    });

                    urlInputWrapper.appendChild(urlInput);
                    urlInputWrapper.appendChild(suggestionList);
                    navbar.appendChild(urlInputWrapper);

                    // 在默认浏览器打开按钮
                    const openInBrowserBtn = document.createElement('button');
                    openInBrowserBtn.className = 'b3-button b3-button--text';
                    openInBrowserBtn.title =
                        t("webview.actions.openInBrowser") || "Open in default browser";
                    openInBrowserBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconOpenWindow"></use></svg>';
                    navbar.appendChild(openInBrowserBtn);

                    // 复制标签页按钮
                    const duplicateTabBtn = document.createElement('button');
                    duplicateTabBtn.className = 'b3-button b3-button--text';
                    duplicateTabBtn.title = t("webview.actions.openInNewTab") || "Open in new tab";
                    duplicateTabBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
                    navbar.appendChild(duplicateTabBtn);

                    // 全屏按钮
                    const fullscreenBtn = document.createElement('button');
                    fullscreenBtn.className = 'b3-button b3-button--text';
                    fullscreenBtn.title = t("webview.actions.fullscreen") || "Fullscreen (Alt+Y)";
                    fullscreenBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconFullscreen"></use></svg>';
                    navbar.appendChild(fullscreenBtn);

                    // 打开开发者工具按钮
                    const devtoolsBtn = document.createElement('button');
                    devtoolsBtn.className = 'b3-button b3-button--text';
                    devtoolsBtn.title =
                        t("webview.actions.openDevtools") || "Open developer tools";
                    devtoolsBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCode"></use></svg>';

                    devtoolsBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            if (webview && typeof webview.openDevTools === 'function') {
                                webview.openDevTools();
                            } else if (webview && typeof (webview.getWebContents) === 'function') {
                                const wc = webview.getWebContents();
                                if (wc && typeof wc.openDevTools === 'function') wc.openDevTools();
                            } else {
                                console.warn('webview.openDevTools not available in this environment.');
                            }
                        } catch (err) {
                            console.warn('打开开发者工具失败:', err);
                        }
                    });
                    navbar.appendChild(devtoolsBtn);

                    container.appendChild(navbar);

                    // 创建 webview 容器包装
                    const webviewWrapper = document.createElement('div');
                    webviewWrapper.style.flex = '1';
                    webviewWrapper.style.position = 'relative';
                    webviewWrapper.style.overflow = 'hidden';

                    // ----------------- 搜索栏开始 -----------------
                    const searchBar = document.createElement('div');
                    searchBar.style.position = 'absolute';
                    searchBar.style.top = '0';
                    searchBar.style.right = '20px';
                    searchBar.style.background = 'var(--b3-theme-surface)';
                    searchBar.style.border = '1px solid var(--b3-border-color)';
                    searchBar.style.borderTop = 'none';
                    searchBar.style.borderRadius = '0 0 4px 4px';
                    searchBar.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                    searchBar.style.zIndex = '100';
                    searchBar.style.display = 'none';
                    searchBar.style.alignItems = 'center';
                    searchBar.style.padding = '4px 8px';
                    searchBar.style.gap = '4px';

                    const searchInput = document.createElement('input');
                    searchInput.className = 'b3-text-field';
                    searchInput.placeholder = t("webview.search.placeholder") || "Find...";
                    searchInput.style.fontSize = '12px';
                    searchInput.style.padding = '2px 4px';
                    searchInput.style.width = '160px';
                    searchInput.style.height = '24px';

                    const searchCount = document.createElement('span');
                    searchCount.style.fontSize = '12px';
                    searchCount.style.color = 'var(--b3-theme-on-surface-light)';
                    searchCount.style.minWidth = '40px';
                    searchCount.style.textAlign = 'center';
                    searchCount.innerText = '0/0';

                    const createSearchBtn = (iconId: string, title: string) => {
                        const btn = document.createElement('button');
                        btn.className = 'b3-button b3-button--text';
                        btn.style.width = '24px';
                        btn.style.height = '24px';
                        btn.style.padding = '4px';
                        btn.title = title;
                        btn.innerHTML = `<svg class="b3-button__icon" style="width:14px;height:14px;"><use xlink:href="#${iconId}"></use></svg>`;
                        return btn;
                    };

                    const prevBtn = createSearchBtn(
                        'iconUp',
                        t("webview.search.prev") || "Previous"
                    );
                    const nextBtn = createSearchBtn(
                        'iconDown',
                        t("webview.search.next") || "Next"
                    );
                    const closeSearchBtn = createSearchBtn(
                        'iconClose',
                        t("webview.search.close") || t("common.close") || "Close"
                    );

                    searchBar.appendChild(searchInput);
                    searchBar.appendChild(searchCount);
                    searchBar.appendChild(prevBtn);
                    searchBar.appendChild(nextBtn);
                    searchBar.appendChild(closeSearchBtn);

                    webviewWrapper.appendChild(searchBar);
                    // ----------------- 搜索栏结束 -----------------

                    // 创建 webview 元素
                    const webview = document.createElement('webview') as any;
                    webview.style.width = '100%';
                    webview.style.height = '100%';
                    webview.style.border = 'none';

                    // 生成干净的 User-Agent（移除 Electron、SiYuan 及其相关 URL 标记）
                    const generateCleanUserAgent = (url: string) => {
                        const originUA = navigator.userAgent || '';

                        // 对于 Google 域名，直接返回原始 UA，不进行清理
                        // Google 的服务可能对 User-Agent 有特殊检测机制，保留原始 UA 可以避免兼容性问题
                        try {
                            const urlObj = new URL(url);
                            if (urlObj.hostname.includes('google.com') || urlObj.hostname.includes('google.')) {
                                return originUA;
                            }
                        } catch (e) {
                            // URL 解析失败，继续清理流程
                        }

                        // 目标：清理任何形式的 SiYuan 标识（例如 "SiYuan/3.5.4"、"SiYuan 3.5.4"、以及伴随的 URL 如 https://b3log.org/siyuan）
                        // 同时移除 Electron 标识，但保留 Mozilla/5.0
                        let cleanUA = originUA
                            // 移除 SiYuan/xxx
                            .replace(/SiYuan\/[0-9A-Za-z.\-]+\s*/gi, '')
                            // 移除独立的 SiYuan 词（带或不带版本号）
                            .replace(/\bSiYuan\b\s*[0-9A-Za-z.\-]*\s*/gi, '')
                            // 移除 SiYuan 相关的 URL（如 b3log.org/siyuan）
                            .replace(/https?:\/\/[^\s]*b3log\.org[^\s]*/gi, '')
                            .replace(/https?:\/\/[^\s]*siyuan[^\s]*/gi, '')
                            // 移除 Electron/xxx
                            .replace(/Electron\/\S+\s*/gi, '')
                            // 移除独立的 Electron 词（但保留 Mozilla/5.0 和其他正常内容）
                            .replace(/\bElectron\b\s*/gi, '')
                            // 合并多余空白并修剪
                            .replace(/\s+/g, ' ')
                            .trim();

                        // 确保 UA 以 Mozilla/5.0 开头（标准浏览器 UA 格式）
                        if (!cleanUA.startsWith('Mozilla/5.0')) {
                            cleanUA = 'Mozilla/5.0 ' + cleanUA;
                        }

                        // 如果清理后的 UA 仍然异常（太短或缺少关键标识），回退为标准 Chrome UA
                        if (cleanUA.length < 50 || !/Chrome\//i.test(cleanUA)) {
                            cleanUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0';
                        }


                        return cleanUA;
                    };

                    // 配置 webview 属性（必须在设置 src 之前设置 partition）
                    webview.setAttribute('allowpopups', 'true');


                    // 所有 webapp 使用同一个 partition，这样可以在不同标签页和跨域导航时共享登录状态
                    // 这解决了在一个标签页登录后，新标签页或跨域跳转时需要重新登录的问题
                    const partitionName = 'persist:siyuan-copilot-codex-webapp-shared';
                    webview.setAttribute('partition', partitionName);

                    // 设置清理后的 User-Agent，移除 Electron 标识以避免被网站检测和限制
                    // 对于 Google 域名保留原始 UA，避免兼容性问题
                    const userAgent = generateCleanUserAgent(app.url);
                    webview.setAttribute('useragent', userAgent);

                    // 设置 Accept-Language，使 webview 请求携带插件当前语言优先级
                    webview.setAttribute('accept-language', `en,en-GB;q=0.9,en-US;q=0.8,zh-CN;q=0.7,zh;q=0.6`);


                    // 最后设置 src，因为 partition 等属性必须在加载 URL 之前设置
                    webview.src = app.url;

                    webviewWrapper.appendChild(webview);
                    container.appendChild(webviewWrapper);
                    element.appendChild(container);

                    // webview 是否已准备好
                    let webviewReady = false;
                    // 重定向计数器，防止无限重定向
                    let redirectCount = 0;
                    let lastUrl = app.url;
                    const MAX_REDIRECTS = 20; // 最大重定向次数

                    // 更新导航按钮状态
                    const updateNavigationButtons = () => {
                        if (!webviewReady) {
                            return; // webview 未准备好，跳过更新
                        }
                        try {
                            backBtn.disabled = !webview.canGoBack();
                            forwardBtn.disabled = !webview.canGoForward();
                        } catch (err) {
                            console.warn('更新导航按钮状态失败:', err);
                        }
                    };

                    // 后退按钮点击事件
                    backBtn.addEventListener('click', () => {
                        try {
                            if (webview.canGoBack()) {
                                // 后退时重置重定向计数器
                                redirectCount = 0;
                                webview.goBack();
                            }
                        } catch (err) {
                            console.warn('后退失败:', err);
                        }
                    });

                    // 前进按钮点击事件
                    forwardBtn.addEventListener('click', () => {
                        try {
                            if (webview.canGoForward()) {
                                // 前进时重置重定向计数器
                                redirectCount = 0;
                                webview.goForward();
                            }
                        } catch (err) {
                            console.warn('前进失败:', err);
                        }
                    });

                    // 刷新按钮点击事件
                    refreshBtn.addEventListener('click', () => {
                        try {
                            // 刷新时重置重定向计数器
                            redirectCount = 0;
                            webview.reload();
                        } catch (err) {
                            console.warn('刷新失败:', err);
                        }
                    });

                    const openUrlInNewTab = (url: string) => {
                        if (!url) return;
                        // 从URL中提取域名作为初始标题
                        let initialTitle = 'Web Link';
                        try {
                            const urlObj = new URL(url);
                            initialTitle = urlObj.hostname || initialTitle;
                        } catch (e) {
                            console.warn('Failed to parse URL:', e);
                        }

                        // 异步获取域名图标（会缓存），获取失败则回退默认图标
                        try {
                            // 立即打开标签页，避免等待网络请求。后台异步检查本地缓存并更新图标（如果存在）
                            const tabPromise = openTab({
                                app: pluginInstance.app,
                                custom: {
                                    icon: ICON_WEBAPP_ID,
                                    title: initialTitle,
                                    data: {
                                        app: {
                                            url: url,
                                            name: initialTitle,
                                            id: "weblink_" + Date.now()
                                        }
                                    },
                                    id: pluginInstance.name + WEBAPP_TAB_TYPE
                                }
                            });

                            (async () => {
                                try {
                                    const domain = pluginInstance.getDomainFromUrl(url);
                                    if (!domain) return;

                                    if (pluginInstance.domainIconMap.has(domain)) {
                                        try {
                                            tabPromise.then((tp: any) => { try { tp.icon = pluginInstance.getWebAppIconId(domain); } catch (e) { } });
                                        } catch (e) { }
                                    }
                                } catch (e) {
                                    // 忽略错误
                                }
                            })();
                        } catch (e) {
                            console.warn('打开外部链接时图标获取异常，使用默认图标:', e);
                            openTab({
                                app: pluginInstance.app,
                                custom: {
                                    icon: ICON_WEBAPP_ID,
                                    title: initialTitle,
                                    data: {
                                        app: {
                                            url: url,
                                            name: initialTitle,
                                            id: "weblink_" + Date.now()
                                        }
                                    },
                                    id: pluginInstance.name + WEBAPP_TAB_TYPE
                                }
                            });
                        }
                    };

                    // ----------------- 搜索功能逻辑 -----------------
                    const performSearch = (forward = true, findNext = false) => {
                        const query = searchInput.value;
                        if (!query) {
                            webview.stopFindInPage('clearSelection');
                            searchCount.innerText = '0/0';
                            return;
                        }
                        webview.findInPage(query, { forward, findNext });
                    };

                    const showSearchBar = () => {
                        searchBar.style.display = 'flex';
                        searchInput.focus();
                        searchInput.select();
                        // 延迟一下再搜索，确保 UI 渲染完成
                        setTimeout(() => {
                            if (searchInput.value) {
                                performSearch(true, false);
                            }
                        }, 50);
                    };

                    const hideSearchBar = () => {
                        searchBar.style.display = 'none';
                        webview.stopFindInPage('clearSelection');
                        webview.focus();
                    };

                    searchInput.addEventListener('input', () => {
                        performSearch(true, false);
                    });

                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            performSearch(!e.shiftKey, true);
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            hideSearchBar();
                        }
                    });

                    prevBtn.addEventListener('click', () => performSearch(false, true));
                    nextBtn.addEventListener('click', () => performSearch(true, true));
                    closeSearchBtn.addEventListener('click', hideSearchBar);

                    webview.addEventListener('found-in-page', (e: any) => {
                        if (e.result) {
                            searchCount.innerText = `${e.result.activeMatchOrdinal}/${e.result.matches}`;
                        }
                    });

                    // 绑定容器的 Ctrl+F (当焦点在 webview 外部时)
                    container.addEventListener('keydown', (e: KeyboardEvent) => {
                        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                            e.preventDefault();
                            e.stopPropagation();
                            showSearchBar();
                        }
                    });
                    // ----------------- 搜索功能逻辑结束 -----------------

                    // 监听 webview 导航事件
                    webview.addEventListener('did-navigate', (event: any) => {
                        const newUrl = event.url || webview.getURL();

                        // 检测重定向循环
                        if (newUrl === lastUrl) {
                            redirectCount++;
                            if (redirectCount > MAX_REDIRECTS) {
                                console.error('检测到重定向循环，停止加载:', newUrl);
                                webview.stop();
                                pushErrMsg(
                                    t("webview.errors.redirectLoop") ||
                                    "Too many page redirects; possible redirect loop."
                                );
                                return;
                            }
                        } else {
                            redirectCount = 0;
                            lastUrl = newUrl;
                        }

                        urlInput.value = newUrl;
                        updateNavigationButtons();

                        // 添加到历史记录（先使用 URL 作为标题，等标题更新时再更新）
                        pluginInstance.addToWebViewHistory(newUrl, newUrl);

                        // 导航后尝试更新标签图标（域名发生变化时）
                        (async () => {
                            try {
                                const iconId = await pluginInstance.getOrCreateIconForDomain(newUrl);
                                try { if (this.tab) (this.tab as any).icon = iconId; } catch (e) { }
                                try {
                                    // 根据当前标签页标题尝试更新 tab header 的 svg
                                    const titleText = (this.tab && this.tab.title) ? this.tab.title : '';
                                    const headers = document.querySelectorAll('li[data-type="tab-header"]');
                                    for (const h of Array.from(headers)) {
                                        const textEl = h.querySelector('.item__text');
                                        if (textEl && textEl.textContent && titleText && textEl.textContent.indexOf(titleText) !== -1) {
                                            const useEl = h.querySelector('svg use');
                                            if (useEl) useEl.setAttribute('xlink:href', `#${iconId}`);
                                            break;
                                        }
                                    }
                                } catch (e) { }
                            } catch (e) { }
                        })();
                    });

                    webview.addEventListener('did-navigate-in-page', (event: any) => {
                        const newUrl = event.url || webview.getURL();
                        urlInput.value = newUrl;
                        updateNavigationButtons();
                    });

                    webview.addEventListener('did-start-loading', () => {
                        updateNavigationButtons();
                    });

                    webview.addEventListener('did-stop-loading', () => {
                        // 加载完成后重置重定向计数器
                        redirectCount = 0;
                        updateNavigationButtons();
                    });

                    // 监听新窗口打开事件 (拦截 target="_blank" 或 window.open)
                    webview.addEventListener('new-window', (e: any) => {
                        e.preventDefault();
                        const url = e.url;
                        if (url) {
                            openUrlInNewTab(url);
                        }
                    });

                    // 监听加载失败事件
                    webview.addEventListener('did-fail-load', (event: any) => {
                        // errorCode -3 是 ERR_ABORTED，通常是正常的页面跳转，不需要报错
                        if (event.errorCode !== -3 && event.errorCode !== 0) {
                            console.error('Webview 加载失败:', event);
                            const errorTemplate =
                                t("webview.errors.loadFailed") ||
                                "Page load failed (error code: {code}): {detail}";
                            const unknownError = t("webview.errors.unknown") || "Unknown error";
                            pushErrMsg(
                                errorTemplate
                                    .replace("{code}", String(event.errorCode))
                                    .replace("{detail}", String(event.errorDescription || unknownError))
                            );
                        }
                    });

                    // 监听页面标题更新事件，动态更新标签页标题
                    webview.addEventListener('page-title-updated', (event: any) => {
                        const newTitle = event.title;
                        if (newTitle && this.tab && typeof this.tab.updateTitle === 'function') {
                            this.tab.updateTitle(newTitle);
                        }

                        // 更新历史记录的标题
                        const currentUrl = webview.getURL();
                        if (currentUrl && newTitle) {
                            pluginInstance.addToWebViewHistory(currentUrl, newTitle);
                        }
                    });

                    // 全屏状态标志
                    let isFullscreen = false;

                    // 切换全屏函数
                    const toggleFullscreen = () => {
                        isFullscreen = !isFullscreen;

                        if (isFullscreen) {
                            // 进入全屏
                            container.style.position = 'fixed';
                            container.style.top = '0';
                            container.style.left = '0';
                            container.style.right = '0';
                            container.style.bottom = '0';
                            container.style.width = '100vw';
                            container.style.height = '100vh';
                            container.style.zIndex = '9999';
                            container.style.background = 'var(--b3-theme-background)';
                            fullscreenBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconContract"></use></svg>';
                            fullscreenBtn.title = t("webview.actions.exitFullscreen") || "Exit fullscreen (Esc or Alt+Y)";
                        } else {
                            // 退出全屏
                            container.style.position = '';
                            container.style.top = '';
                            container.style.left = '';
                            container.style.right = '';
                            container.style.bottom = '';
                            container.style.width = '';
                            container.style.height = '';
                            container.style.zIndex = '';
                            container.style.background = '';
                            fullscreenBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconFullscreen"></use></svg>';
                            fullscreenBtn.title = t("webview.actions.fullscreen") || "Fullscreen (Alt+Y)";
                        }
                    };

                    // 全屏按钮点击事件
                    fullscreenBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFullscreen();
                    });

                    // 在默认浏览器中打开按钮点击事件
                    const openInDefaultBrowser = () => {
                        try {
                            const currentUrl = urlInput.value || app.url;
                            // 尝试通过后端接口打开（如果可用）
                            const backend = typeof getBackend === 'function' ? (getBackend() as any) : null;
                            if (backend && typeof backend.openExternal === 'function') {
                                backend.openExternal(currentUrl);
                                return;
                            }

                            // 尝试使用 window.siyuan 提供的方法（不同环境可能暴露不同接口）
                            if ((window as any).siyuan && typeof (window as any).siyuan.openExternal === 'function') {
                                (window as any).siyuan.openExternal(currentUrl);
                                return;
                            }

                            // 回退到 window.open
                            window.open(currentUrl, '_blank', 'noopener');
                        } catch (err) {
                            console.warn('打开外部链接失败，使用 window.open 回退：', err);
                            const currentUrl = urlInput.value || app.url;
                            window.open(currentUrl, '_blank', 'noopener');
                        }
                    };

                    openInBrowserBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openInDefaultBrowser();
                    });

                    // 复制标签页按钮点击事件
                    duplicateTabBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const currentUrl = urlInput.value || app.url;

                        // 从URL中提取域名作为初始标题
                        let initialTitle = 'Web Link';
                        try {
                            const urlObj = new URL(currentUrl);
                            initialTitle = urlObj.hostname || initialTitle;
                        } catch (err) {
                            console.warn('Failed to parse URL:', err);
                        }

                        // 使用当前 Tab 的 icon，如果没有则使用默认 icon
                        const currentIcon = this.tab?.icon || ICON_WEBAPP_ID;

                        openTab({
                            app: pluginInstance.app,
                            custom: {
                                icon: currentIcon,
                                title: initialTitle,
                                data: {
                                    app: {
                                        url: currentUrl,
                                        name: initialTitle,
                                        id: "weblink_" + Date.now()
                                    }
                                },
                                id: pluginInstance.name + WEBAPP_TAB_TYPE
                            }
                        });
                    });

                    // 监听 console 消息处理 webview 内部的快捷键和链接点击
                    webview.addEventListener('console-message', (e: any) => {
                        const msg = e.message || '';

                        // 处理快捷键消息
                        if (msg.startsWith('__SIYUAN_COPILOT_HOTKEY__:')) {
                            const key = msg.substring('__SIYUAN_COPILOT_HOTKEY__:'.length);

                            if (key === 'alt-left') {
                                // Alt+← 后退
                                try {
                                    if (webview.canGoBack()) {
                                        redirectCount = 0;
                                        webview.goBack();
                                    }
                                } catch (err) {
                                    console.warn('后退失败:', err);
                                }
                            } else if (key === 'alt-right') {
                                // Alt+→ 前进
                                try {
                                    if (webview.canGoForward()) {
                                        redirectCount = 0;
                                        webview.goForward();
                                    }
                                } catch (err) {
                                    console.warn('前进失败:', err);
                                }
                            } else if (key === 'alt-y') {
                                // Alt+Y 切换全屏
                                toggleFullscreen();
                            } else if (key === 'ctrl-f') {
                                // Ctrl+F 搜索
                                showSearchBar();
                            } else if (key === 'escape') {
                                // Esc 退出全屏 或 关闭搜索
                                if (searchBar.style.display !== 'none') {
                                    hideSearchBar();
                                } else if (isFullscreen) {
                                    toggleFullscreen();
                                }
                            }
                            return;
                        }

                        // 处理链接打开消息
                        if (msg.startsWith('__SIYUAN_COPILOT_LINK__:')) {
                            const url = msg.substring('__SIYUAN_COPILOT_LINK__:'.length);
                            if (url) {
                                openUrlInNewTab(url);
                            }
                        }
                    });

                    // 注入脚本函数：监听键盘事件和点击事件
                    const injectScript = () => {
                        try {
                            const script = `
                                (function() {
                                    // 注入一次即可，防止重复 (使用新标记 v3 避免缓存问题)
                                    if (window.__siyuan_copilot_injected_v3) return;
                                    window.__siyuan_copilot_injected_v3 = true;

                                    // 键盘事件监听
                                    document.addEventListener('keydown', function(e) {
                                        // Alt+← 后退
                                        if (e.altKey && e.key === 'ArrowLeft') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:alt-left');
                                            return false;
                                        }
                                        // Alt+→ 前进
                                        if (e.altKey && e.key === 'ArrowRight') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:alt-right');
                                            return false;
                                        }
                                        // Alt+Y 全屏
                                        if (e.altKey && (e.key === 'y' || e.key === 'Y')) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:alt-y');
                                            return false;
                                        }
                                        // Esc 退出全屏 或 关闭搜索
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:escape');
                                            return false;
                                        }
                                        // Ctrl+F OR Cmd+F 搜索
                                        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:ctrl-f');
                                            return false;
                                        }
                                    }, true);

                                    // 链接点击处理函数
                                    const handleLinkClick = function(e) {
                                        var target = e.target;
                                        // 查找最近的 a 标签
                                        while (target && target.tagName !== 'A' && target !== document) {
                                            target = target.parentNode;
                                        }
                                        
                                        if (target && target.tagName === 'A') {
                                            // 检查是否为中键点击 (button === 1)
                                            var isMiddleClick = e.button === 1;

                                            // 处理 target="_blank" 或 Ctrl+Click (Windows/Linux) 或 Cmd+Click (Mac) 或中键点击
                                            // 显式检查 'target' 属性是否为 '_blank'
                                            var hasBlankTarget = target.getAttribute('target') === '_blank';
                                            
                                            var shouldOpenInNewTab = hasBlankTarget || 
                                                                      e.ctrlKey || 
                                                                      e.metaKey || 
                                                                      isMiddleClick;
                                            
                                            if (shouldOpenInNewTab && target.href) {
                                                // 极力阻止默认行为
                                                e.preventDefault();
                                                e.stopPropagation();
                                                e.stopImmediatePropagation();
                                                
                                                // 使用 console.log 传递消息
                                                console.log('__SIYUAN_COPILOT_LINK__:' + target.href);
                                                return false;
                                            }
                                        }
                                    };

                                    // 监听点击事件 (捕获阶段)
                                    document.addEventListener('click', handleLinkClick, true);
                                    // 监听辅助点击事件 (如中键)
                                    document.addEventListener('auxclick', handleLinkClick, true);
                                })();
                            `;
                            webview.executeJavaScript(script);
                        } catch (err) {
                            console.warn('无法注入监听脚本:', err);
                        }
                    };

                    // 尝试在 webview 加载完成后注入键盘监听和点击拦截
                    webview.addEventListener('dom-ready', () => {
                        webviewReady = true; // 标记 webview 已准备好

                        // 尝试移除可能的 CSP 限制 (仅作为防御性编程，可能在某些 Electron 环境不起作用)
                        // webview.executeJavaScript... 

                        injectScript();
                        updateNavigationButtons(); // 初始化导航按钮状态
                    });

                    // 在页面开始加载时也尝试注入 (针对部分已存在内容的页面或 SPA 切换)
                    webview.addEventListener('did-start-loading', () => {
                        // 此时注入可能因为页面刷新而被冲掉，但对于 SPA 路由跳转有效
                        updateNavigationButtons();
                    });

                    // 在导航完成后再次注入，确保万无一失
                    webview.addEventListener('did-navigate', () => {
                        injectScript();
                    });

                }
            },
            beforeDestroy() {
            },
            destroy() {
                // 清理工作（如果需要）
            }
        });

    }

    async onLayoutReady() {
        //布局加载完成的时候,会自动调用这个函数
        this.registerAddChatContextMenuHandlers();
        this.setupDomMenuFallback();
        // 注册AI侧栏
        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 400, height: 0 },
                icon: DOCK_ICON_ID,
                title: t("aiSidebar.title") || "Codex",
                show: true,
            },
            data: {
                text: t("aiSidebar.title") || "Codex"
            },
            type: AI_SIDEBAR_TYPE,
            init: (dock) => {
                this.aiSidebarApp = new AISidebar({
                    target: dock.element,
                    props: {
                        plugin: this,
                        addChatContextEvent: this.getAddChatContextEventName(),
                    }
                });
            },
            destroy: () => {
                if (this.aiSidebarApp) {
                    this.aiSidebarApp.$destroy();
                }
            }
        });
        // 注册已保存的小程序图标
        // 优先复用 onload() 已同步到 store 的设置，避免重复 loadSettings() 的磁盘读写
        try {
            const currentSettings = await getSettings();
            const settings =
                currentSettings && Object.keys(currentSettings).length > 0
                    ? currentSettings
                    : await this.loadSettings();
            if (settings?.webApps && Array.isArray(settings.webApps)) {
                for (const app of settings.webApps) {
                    if (app.icon && app.icon.startsWith('data:image')) {
                        this.registerWebAppIcon(app.id, app.icon);
                    }
                }
            }

            // 注册已缓存的域名 favicon（如果有），从独立的缓存文件加载
            this.domainIconMap.clear();
            try {
                // 读取 webappIcon 目录下的所有图标
                const files = await readDir(WEBAPP_ICON_DIR);
                if (files && Array.isArray(files)) {
                    for (const file of files) {
                        if (file.isDir) continue;

                        // 支持的后缀
                        const supportedExts = ['.icon', '.png', '.ico', '.svg', '.jpg', '.jpeg', '.gif', '.webp'];
                        const ext = supportedExts.find(e => file.name.toLowerCase().endsWith(e));

                        if (ext) {
                            // 移除后缀得到域名
                            const domain = file.name.substring(0, file.name.length - ext.length);
                            this.domainIconMap.set(domain, file.name);

                            // 异步加载并注册，不阻塞主流程
                            getFileBlob(`${WEBAPP_ICON_DIR}/${file.name}`).then(async (blob) => {
                                if (blob) {
                                    // 对于图片文件，转换为 dataURL
                                    try {
                                        const iconData = await this.blobToDataURL(blob);
                                        if (iconData) {
                                            this.registerWebAppIcon(domain, iconData);
                                        }
                                    } catch (e) {
                                        // ignore
                                    }
                                }
                            }).catch(() => { });
                        }
                    }
                }
            } catch (e) {
                // 目录可能不存在，尝试创建
                try {
                    await putFile(WEBAPP_ICON_DIR, true, new Blob([]));
                } catch (err) {
                    // ignore
                }
            }

            // 监听链接点击事件（始终只注册一次；是否拦截由当前设置决定）
            this.setupLinkClickListener();
        } catch (e) {
            console.error('Failed to register webapp icons:', e);
        }
    }

    /**
     * 设置链接点击监听器
     * 根据设置决定是否在 webview 中打开外部链接
     * 直接监听 div.protyle-wysiwyg 下的 span[data-type="a"] 链接点击
     */
    private readonly onProtyleLinkClick = async (e: MouseEvent) => {
        const eventTarget = e.target;
        if (!(eventTarget instanceof HTMLElement)) return;

        const linkElement = eventTarget.closest('span[data-type="a"]') as HTMLElement | null;
        if (!linkElement) return;

        const href = linkElement.getAttribute('data-href');
        if (!href || !href.startsWith('https://')) return;

        if (!linkElement.closest('.protyle-wysiwyg')) return;

        let settings: any = null;
        try {
            settings = await getSettings();
        } catch (err) {
            console.warn('[Link Click] 读取 settings store 失败，回退 loadSettings:', err);
            settings = await this.loadSettings();
        }

        if (!settings?.openLinksInWebView) {
            return;
        }

        // 仅在确认需要 webview 接管时阻止默认行为
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log('[Link Click] 在 webview 中打开:', href);

        // 提取链接标题
        const linkTitle = linkElement.textContent?.trim() || href;

        // 在新的 webview 标签页中打开
        const appData = {
            id: `link-${Date.now()}`,
            name: linkTitle.length > 50 ? linkTitle.substring(0, 50) + '...' : linkTitle,
            url: href,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // 存储到待打开列表
        this.webApps.set(appData.id, appData);

        // 立即打开标签页，避免等待网络请求。后台异步检查本地缓存并更新图标（如果存在）
        const tabPromise = openTab({
            app: this.app,
            custom: {
                icon: ICON_WEBAPP_ID,
                title: appData.name,
                data: {
                    app: appData
                },
                id: this.name + WEBAPP_TAB_TYPE
            }
        });

        // 后台检查本地 favicon 缓存（不触发网络请求）；若存在则注册并更新标签图标
        (async () => {
            try {
                const domain = this.getDomainFromUrl(href);
                if (!domain) return;

                if (this.domainIconMap.has(domain)) {
                    try {
                        tabPromise.then((tp: any) => { try { tp.icon = this.getWebAppIconId(domain); } catch (e) { } });
                    } catch (e) { }
                }
            } catch (e) {
                // 忽略错误，不影响打开体验
            }
        })();

        return false;
    };

    private setupLinkClickListener() {
        if (this.linkClickListenerBound) return;
        // 使用事件委托，监听所有 protyle 编辑器容器
        document.addEventListener('click', this.onProtyleLinkClick, true);
        this.linkClickListenerBound = true;
    }

    private teardownLinkClickListener() {
        if (!this.linkClickListenerBound) return;
        document.removeEventListener('click', this.onProtyleLinkClick, true);
        this.linkClickListenerBound = false;
    }

    /**
     * 自定义编辑器工具栏
     */
    updateProtyleToolbar(toolbar: Array<string | any>) {
        toolbar.push("|");
        toolbar.push({
            name: "ai-chat-with-selection",
            icon: ICON_COPILOT_ID,
            hotkey: "⌥⌘C",
            tipPosition: "n",
            tip: t("toolbar.aiChat") || "AI Chat",
            click: (protyle: any) => {
                this.openChatDialog(protyle);
            }
        });
        return toolbar;
    }

    /**
     * 打开AI聊天对话框
     */
    private async openChatDialog(protyle: any) {
        // 获取选中的内容（优先获取HTML，然后转换为Markdown）
        let selectedMarkdown = '';

        try {
            // 尝试获取选中的内容
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (!range.collapsed) {
                    const { markdown } = this.extractRangeContent(range);
                    selectedMarkdown = markdown;
                }
            }

            // 如果没有选中内容或转换失败，尝试获取光标所在块的内容
            if (!selectedMarkdown && protyle?.wysiwyg?.element) {
                const focusElement = protyle.wysiwyg.element.querySelector('.protyle-wysiwyg--hl');
                if (focusElement) {
                    // 获取整个块的HTML并转换为Markdown
                    const blockHtml = focusElement.innerHTML;
                    if (typeof window !== 'undefined' && (window as any).Lute) {
                        const lute = (window as any).Lute.New();
                        selectedMarkdown = lute.HTML2Md(blockHtml);
                    } else {
                        selectedMarkdown = focusElement.textContent || '';
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get selected content:', error);
        }

        // 生成唯一的对话框ID
        const dialogId = `chat-dialog-${Date.now()}`;

        // 创建对话框
        const dialog = new Dialog({
            title: t("toolbar.aiChatDialog"),
            content: `<div id="${dialogId}" style="height: 100%;"></div>`,
            width: "800px",
            height: "700px",
            destroyCallback: () => {
                // 清理对话框实例
                const dialogData = this.chatDialogs.get(dialogId);
                if (dialogData?.app) {
                    dialogData.app.$destroy();
                }
                this.chatDialogs.delete(dialogId);
            }
        });

        // 创建聊天组件
        const chatApp = new ChatDialog({
            target: dialog.element.querySelector(`#${dialogId}`),
            props: {
                plugin: this,
                initialMessage: selectedMarkdown ? `> ${selectedMarkdown}\n\n` : ''
            }
        });

        // 保存对话框实例
        this.chatDialogs.set(dialogId, { dialog, app: chatApp });
    }

    async onunload() {
        //当插件被禁用的时候，会自动调用这个函数
        this.unregisterAddChatContextMenuHandlers();
        this.teardownDomMenuFallback();
        this.teardownLinkClickListener();
        console.log("Codex onunload");
    }

    private async removeStoragePathRecursive(path: string): Promise<void> {
        try {
            const entries = await readDir(path);
            if (Array.isArray(entries)) {
                for (const entry of entries) {
                    await this.removeStoragePathRecursive(`${path}/${entry.name}`);
                }
            }
        } catch (_) {
            // ignore readDir failures for non-existent paths
        }

        try {
            await removeFile(path);
        } catch (_) {
            // ignore remove failures for non-existent paths
        }
    }

    async uninstall() {
        //当插件被卸载的时候，会自动调用这个函数
        console.log("Codex uninstall");
        // 删除配置文件
        await this.removeData(SETTINGS_FILE);
        await this.removeData(WEBVIEW_HISTORY_FILE);
        await this.removeData("chat-sessions.json");
        await this.removeData("prompts.json");
        await this.removeData("agent-tools-config.json");

        // 清理插件存储目录（包含历史命名目录，避免卸载残留）
        const namespaces = Array.from(
            new Set([
                String(this.name || "").trim(),
                DEFAULT_PLUGIN_NAMESPACE,
                LEGACY_PLUGIN_NAMESPACE,
            ].filter(Boolean))
        );

        for (const namespace of namespaces) {
            const baseDir = `/data/storage/petal/${namespace}`;
            await this.removeStoragePathRecursive(`${baseDir}/sessions`);
            await this.removeStoragePathRecursive(`${baseDir}/assets`);
            await this.removeStoragePathRecursive(`${baseDir}/webappIcon`);
        }
    }

    /**
     * 打开设置对话框
     */
    // 重写 openSetting 方法
    async openSetting() {
        let dialog = new Dialog({
            title: t("settings.settingsPanel"),
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "800px",
            height: "700px",
            destroyCallback: () => {
                pannel.$destroy();
            }
        });

        let pannel = new SettingPanel({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    private detectCodexCliPath(): string {
        try {
            const nodeRequire = (globalThis as any).require || require;
            const childProcess = nodeRequire('child_process') as typeof import('child_process');
            const isWin = (globalThis as any)?.process?.platform === 'win32';
            const result = isWin
                ? childProcess.spawnSync('cmd.exe', ['/d', '/s', '/c', 'where codex'], {
                    windowsHide: true,
                    shell: true,
                    encoding: 'utf8',
                })
                : childProcess.spawnSync('which', ['codex'], { encoding: 'utf8' });
            const out = String(result?.stdout || '');
            const lines = out
                .split(/\r?\n/)
                .map((s: string) => s.trim())
                .filter(Boolean);
            return lines[0] || '';
        } catch (e) {
            console.warn('Detect codex path failed:', e);
            return '';
        }
    }

    private getSiyuanConfig(): any {
        return (globalThis as any)?.window?.siyuan?.config || (globalThis as any)?.siyuan?.config || {};
    }

    private detectCodexWorkingDir(): string {
        const cfg = this.getSiyuanConfig();
        const candidates = [cfg?.system?.workspaceDir, cfg?.system?.workspace, cfg?.workspaceDir];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) return c.trim();
        }
        try {
            const cwd = (globalThis as any)?.process?.cwd?.();
            if (typeof cwd === 'string' && cwd.trim()) return cwd.trim();
        } catch (e) {
            console.warn('Detect codex working dir failed:', e);
        }
        return '';
    }

    private detectSiyuanApiToken(): string {
        const cfg = this.getSiyuanConfig();
        const candidates = [cfg?.api?.token, cfg?.token];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) return c.trim();
        }
        return '';
    }

    private nodeRequireForPlugin<T = any>(id: string): T {
        const w = globalThis as any;
        if (w?.require && typeof w.require === 'function') return w.require(id);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(id);
    }

    private isPlainObjectValue(value: any): value is Record<string, any> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private cloneJsonValue<T>(value: T): T {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    }

    private isMeaningfulSettingValue(value: any): boolean {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (this.isPlainObjectValue(value)) return Object.keys(value).length > 0;
        return true;
    }

    private mergePreferCurrentMeaningful(current: any, fallback: any): any {
        if (this.isPlainObjectValue(current) && this.isPlainObjectValue(fallback)) {
            const next: Record<string, any> = this.cloneJsonValue(fallback);
            for (const [key, currentValue] of Object.entries(current)) {
                const fallbackValue = (fallback as Record<string, any>)[key];
                next[key] = this.mergePreferCurrentMeaningful(currentValue, fallbackValue);
            }
            return next;
        }

        if (Array.isArray(current)) {
            if (current.length > 0) return this.cloneJsonValue(current);
            if (Array.isArray(fallback) && fallback.length > 0) return this.cloneJsonValue(fallback);
            return this.cloneJsonValue(current);
        }

        if (this.isMeaningfulSettingValue(current)) return this.cloneJsonValue(current);
        if (this.isMeaningfulSettingValue(fallback)) return this.cloneJsonValue(fallback);
        return this.cloneJsonValue(current ?? fallback);
    }

    private readJsonFileSafe(filePath: string): any | null {
        try {
            const fs = this.nodeRequireForPlugin<typeof import('fs')>('fs');
            if (!fs.existsSync(filePath)) return null;
            const raw = String(fs.readFileSync(filePath, 'utf8') || '').trim();
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return this.isPlainObjectValue(parsed) ? parsed : null;
        } catch (error) {
            console.warn('Read settings JSON failed:', filePath, error);
            return null;
        }
    }

    private readLatestSettingsBackup(namespace: string): { path: string; settings: any } | null {
        try {
            const fs = this.nodeRequireForPlugin<typeof import('fs')>('fs');
            const path = this.nodeRequireForPlugin<typeof import('path')>('path');
            const dir = path.join('/data/storage/petal', namespace);
            if (!fs.existsSync(dir)) return null;
            const files = fs
                .readdirSync(dir)
                .filter(
                    (name: string) =>
                        /^settings\.json\.bak-\d{8}-\d{6}$/.test(name) ||
                        /^settings\.json\.pre-restore-\d{8}-\d{6}$/.test(name)
                )
                .sort((a: string, b: string) => {
                    const am = fs.statSync(path.join(dir, a)).mtimeMs || 0;
                    const bm = fs.statSync(path.join(dir, b)).mtimeMs || 0;
                    return bm - am;
                });
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const settings = this.readJsonFileSafe(fullPath);
                if (settings) {
                    return { path: fullPath, settings };
                }
            }
            return null;
        } catch (error) {
            console.warn('Read settings backup failed:', namespace, error);
            return null;
        }
    }

    private looksLikeResetSettings(settings: any): boolean {
        const webAppsCount = Array.isArray(settings?.webApps) ? settings.webApps.length : 0;
        const gitFieldsEmpty =
            !String(settings?.codexGitCliPath || '').trim() &&
            !String(settings?.codexGitRepoDir || '').trim() &&
            !String(settings?.codexGitRemoteUrl || '').trim() &&
            !String(settings?.codexGitBranch || '').trim() &&
            settings?.codexGitAutoSyncEnabled !== true;
        const codexBaselineExists =
            !!String(settings?.codexCliPath || '').trim() || !!String(settings?.codexWorkingDir || '').trim();
        return codexBaselineExists && gitFieldsEmpty && webAppsCount === 0;
    }

    private hasUsefulRecoveryData(settings: any): boolean {
        if (!this.isPlainObjectValue(settings)) return false;
        const webAppsCount = Array.isArray(settings?.webApps) ? settings.webApps.length : 0;
        const hasGitSignal =
            !!String(settings?.codexGitCliPath || '').trim() ||
            !!String(settings?.codexGitRepoDir || '').trim() ||
            !!String(settings?.codexGitRemoteUrl || '').trim() ||
            !!String(settings?.codexGitBranch || '').trim() ||
            settings?.codexGitAutoSyncEnabled === true;
        return webAppsCount > 0 || hasGitSignal;
    }

    private recoverResetSettingsIfNeeded(rawSettings: any): {
        settings: any;
        changed: boolean;
        source: string;
    } {
        const current = this.isPlainObjectValue(rawSettings) ? rawSettings : {};
        const looksReset = this.looksLikeResetSettings(current);
        if (!looksReset) {
            return { settings: current, changed: false, source: '' };
        }
        // 即使已打过恢复标记，只要再次检测到“重置态”，仍允许再次恢复。
        // 这样可覆盖“被异常流程重复写空”的场景。

        const namespaces = Array.from(
            new Set([
                String(this.name || '').trim(),
                DEFAULT_PLUGIN_NAMESPACE,
                LEGACY_PLUGIN_NAMESPACE,
            ].filter(Boolean))
        );

        const candidates: Array<{ source: string; settings: any }> = [];
        for (const namespace of namespaces) {
            const settingsPath = `/data/storage/petal/${namespace}/${SETTINGS_FILE}`;
            const settings = this.readJsonFileSafe(settingsPath);
            if (settings) {
                candidates.push({
                    source: settingsPath,
                    settings,
                });
            }
            const backup = this.readLatestSettingsBackup(namespace);
            if (backup) {
                candidates.push({
                    source: backup.path,
                    settings: backup.settings,
                });
            }
        }

        for (const candidate of candidates) {
            if (!this.hasUsefulRecoveryData(candidate.settings)) continue;
            const merged = this.mergePreferCurrentMeaningful(current, candidate.settings);
            const next = {
                ...merged,
                dataTransfer: {
                    ...(this.isPlainObjectValue(merged?.dataTransfer) ? merged.dataTransfer : {}),
                    settingsRecoveryApplied: SETTINGS_RECOVERY_VERSION,
                },
            };
            return { settings: next, changed: true, source: candidate.source };
        }

        return { settings: current, changed: false, source: '' };
    }

    private applyCodexAutoSettings(rawSettings: any, mergedSettings: any): { changed: boolean; autoEnabled: boolean } {
        let changed = false;
        let autoEnabled = false;
        const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(rawSettings || {}, key);

        if (!String(mergedSettings.codexCliPath || '').trim()) {
            const detectedPath = this.detectCodexCliPath();
            if (detectedPath) {
                mergedSettings.codexCliPath = detectedPath;
                changed = true;
            }
        }

        if (!String(mergedSettings.codexWorkingDir || '').trim()) {
            const detectedWorkingDir = this.detectCodexWorkingDir();
            if (detectedWorkingDir) {
                mergedSettings.codexWorkingDir = detectedWorkingDir;
                changed = true;
            }
        }

        if (!String(mergedSettings.siyuanApiToken || '').trim()) {
            const detectedToken = this.detectSiyuanApiToken();
            if (detectedToken) {
                mergedSettings.siyuanApiToken = detectedToken;
                changed = true;
            }
        }

        // 旧用户升级到含 Codex 功能版本时，若未显式配置 codexEnabled，则自动开启。
        if (!hasOwn('codexEnabled') && mergedSettings.codexEnabled !== true) {
            const hasCliPath = !!String(mergedSettings.codexCliPath || '').trim();
            const hasWorkingDir = !!String(mergedSettings.codexWorkingDir || '').trim();
            if (hasCliPath && hasWorkingDir) {
                mergedSettings.codexEnabled = true;
                changed = true;
                autoEnabled = true;
            }
        }

        // 为自动启用的场景提供可写能力，便于在思源中执行编辑/创建文档。
        if (!hasOwn('codexRunMode') && autoEnabled) {
            mergedSettings.codexRunMode = 'workspace_write';
            changed = true;
        }

        return { changed, autoEnabled };
    }
    /**
     * 加载设置
     */
    async loadSettings() {
        const loadedSettings = (await this.loadData(SETTINGS_FILE)) || {};
        let migratedSettingsChanged = false;
        const recoveryResult = this.recoverResetSettingsIfNeeded(loadedSettings);
        const settings = recoveryResult.settings;
        if (recoveryResult.changed) {
            migratedSettingsChanged = true;
            pushMsg(
                (t("migration.settingsRecovered") ||
                    "检测到设置被重置，已自动从备份恢复关键配置").replace(
                    "{source}",
                    recoveryResult.source
                )
            );
        }

        // 迁移：如果存在旧的 aiProviders.v3 配置，迁移为自定义平台（customProviders）
        try {
            if (settings.aiProviders && settings.aiProviders.v3) {
                if (!settings.aiProviders.customProviders || !Array.isArray(settings.aiProviders.customProviders)) {
                    settings.aiProviders.customProviders = [];
                }

                const legacy = settings.aiProviders.v3;
                const newId = `v3`;
                const newPlatform = {
                    id: newId,
                    name: legacy.name || 'V3 API',
                    apiKey: legacy.apiKey || settings.aiApiKey || '',
                    customApiUrl: legacy.customApiUrl || 'https://api.gpt.ge',
                    models: legacy.models || []
                };

                settings.aiProviders.customProviders.push(newPlatform);

                // 如果用户选中了旧的 v3 平台，切换到新创建的自定义平台
                if (settings.selectedProviderId === 'v3') {
                    settings.selectedProviderId = newId;
                }
                if (settings.currentProvider === 'v3') {
                    settings.currentProvider = newId;
                }

                // 删除旧配置以避免重复使用
                delete settings.aiProviders.v3;

                // 如果存在老的单个平台字段，也一并清理（兼容旧版本）
                if (settings.aiProvider === 'v3') delete settings.aiProvider;

                migratedSettingsChanged = true;
                pushMsg(
                    t("migration.v3Migrated") ||
                    "Legacy V3 configuration detected and migrated to a custom provider"
                );
            }
        } catch (e) {
            console.error('Settings migration failed:', e);
        }

        // 迁移：自动为已有模型设置能力
        try {
            // 检查是否已经执行过迁移
            if (!settings.dataTransfer) {
                settings.dataTransfer = {};
                migratedSettingsChanged = true;
            }

            // 迁移：移除 Achuan 内置平台后，旧配置回落到 OpenAI
            if (settings.aiProviders && Object.prototype.hasOwnProperty.call(settings.aiProviders, 'Achuan')) {
                delete settings.aiProviders.Achuan;
                migratedSettingsChanged = true;
            }
            if (settings.currentProvider === 'Achuan') {
                settings.currentProvider = 'openai';
                settings.currentModelId = '';
                migratedSettingsChanged = true;
                pushMsg(
                    t("migration.achuanFallback") ||
                    "Legacy Achuan provider detected; switched to OpenAI automatically"
                );
            }
            if (settings.selectedProviderId === 'Achuan') {
                settings.selectedProviderId = 'openai';
                migratedSettingsChanged = true;
            }

            if (settings.dataTransfer.autoSetModelCapabilities) {
            } else if (settings.aiProviders) {
                // 内置平台列表
                const builtInProviders = ['gemini', 'deepseek', 'openai', 'moonshot', 'volcano'];

                // 处理内置平台
                for (const providerId of builtInProviders) {
                    const providerConfig = settings.aiProviders[providerId];
                    if (providerConfig && Array.isArray(providerConfig.models)) {
                        for (const model of providerConfig.models) {
                            model.capabilities = getModelCapabilities(model.id);
                        }
                    }
                }

                // 处理自定义平台
                if (Array.isArray(settings.aiProviders.customProviders)) {
                    for (const customProvider of settings.aiProviders.customProviders) {
                        if (Array.isArray(customProvider.models)) {
                            for (const model of customProvider.models) {
                                model.capabilities = getModelCapabilities(model.id);
                            }
                        }
                    }
                }

                settings.dataTransfer.autoSetModelCapabilities = true;
                migratedSettingsChanged = true;
                pushMsg(
                    t("migration.autoSetModelCapabilities") ||
                    "Model capabilities were auto-initialized for existing models"
                );
            }
        } catch (e) {
            console.error('Auto set model capabilities failed:', e);
        }

        const defaultSettings = getDefaultSettings();
        let mergedSettings = mergeSettingsWithDefaults(settings);
        const codexAutoResult = this.applyCodexAutoSettings(settings, mergedSettings);
        const removedKeysOnUpgrade = [
            'autoRenameProvider',
            'codexProfile',
            'codexInjectSkillsOnThreadStart',
            'codexSelectedSkills',
            'codexSkillsEnabled',
            'codexSkillsIncludePlugin',
            'codexSkillsMaxCount',
            'codexModelApiKey',
            'modelPresets',
            'selectedModelPresetId',
            'translateProvider',
            'translateModelId',
            'translateInputLanguage',
            'translateOutputLanguage',
            'translateTemperature',
            'translatePrompt',
        ];
        let removedLegacySetting = false;
        for (const key of removedKeysOnUpgrade) {
            if (Object.prototype.hasOwnProperty.call(mergedSettings, key)) {
                delete (mergedSettings as any)[key];
                removedLegacySetting = true;
            }
        }
        const promptPullSyncResult = pullPromptFromWorkingDirAgentsFile(mergedSettings);
        mergedSettings = promptPullSyncResult.settings;

        // 检测是否需要保存设置
        let needsSave = false;

        // 如果是首次安装（settings.json 不存在或为空），需要保存
        const isFirstInstall = !settings || Object.keys(settings).length === 0;
        if (isFirstInstall) {
            needsSave = true;
        }

        if (codexAutoResult.changed) {
            needsSave = true;
            if (codexAutoResult.autoEnabled) {
                pushMsg(
                    t("migration.codexAutoConfigured") ||
                    "Codex CLI baseline configuration was auto-completed"
                );
            }
        }

        if (removedLegacySetting) {
            needsSave = true;
        }
        if (promptPullSyncResult.changed) {
            needsSave = true;
        }
        if (migratedSettingsChanged) {
            needsSave = true;
        }

        // 如果是升级场景：settings 存在但没有 webApps，或 webApps 为空
        // 需要从默认设置中补充内置 webApps
        if (settings && (!settings.webApps || !Array.isArray(settings.webApps) || settings.webApps.length === 0)) {
            // 从默认设置中获取内置 webApps
            if (defaultSettings.webApps && Array.isArray(defaultSettings.webApps) && defaultSettings.webApps.length > 0) {
                mergedSettings.webApps = defaultSettings.webApps;
                needsSave = true;
            }
        }

        // 保存合并后的设置，确保内置 webApps 能在 onLayoutReady 中正确注册
        if (needsSave) {
            await this.saveData(SETTINGS_FILE, mergedSettings);
        }

        // 更新 store
        updateSettings(mergedSettings);
        return mergedSettings;
    }

    /**
     * 保存设置
     */
    async saveSettings(settings: any) {
        const persistedSettings = (await this.loadData(SETTINGS_FILE)) || {};
        const incomingSettings = this.isPlainObjectValue(settings) ? settings : {};
        const shouldGuardResetWrite =
            this.looksLikeResetSettings(incomingSettings) &&
            this.hasUsefulRecoveryData(persistedSettings);

        let baseSettings = shouldGuardResetWrite
            ? this.mergePreferCurrentMeaningful(incomingSettings, persistedSettings)
            : {
                  ...persistedSettings,
                  ...incomingSettings,
              };

        const saveRecoveryResult = this.recoverResetSettingsIfNeeded(baseSettings);
        if (saveRecoveryResult.changed) {
            baseSettings = saveRecoveryResult.settings;
            pushMsg(
                (t("migration.settingsRecovered") ||
                    "检测到设置被重置，已自动从备份恢复关键配置（来源：{source}）").replace(
                    "{source}",
                    saveRecoveryResult.source
                )
            );
        }

        let nextSettings = mergeSettingsWithDefaults(baseSettings);
        if (shouldGuardResetWrite) {
            nextSettings = {
                ...nextSettings,
                dataTransfer: {
                    ...(this.isPlainObjectValue(nextSettings?.dataTransfer)
                        ? nextSettings.dataTransfer
                        : {}),
                    settingsRecoveryApplied: SETTINGS_RECOVERY_VERSION,
                },
            };
            pushMsg(
                t("migration.settingsGuarded") ||
                    "检测到疑似重置写入，已自动保留已有关键设置"
            );
        }
        try {
            const syncResult = bidirectionalSyncPromptWithWorkingDirAgentsFile(nextSettings);
            nextSettings = syncResult.settings;
            if (syncResult.reason === 'external_file_changed' && syncResult.changed) {
                pushMsg(
                    t("migration.agentsPromptSynced") ||
                    "Detected AGENTS.md update in working directory; system prompt has been synced"
                );
            }
        } catch (e) {
            console.error('Sync AGENTS.md failed:', e);
        }
        await this.saveData(SETTINGS_FILE, nextSettings);
        // 更新 store，通知所有订阅者
        updateSettings(nextSettings);
    }

    async syncSystemPromptFromWorkingDirAgentsFile() {
        const settings = (await this.loadData(SETTINGS_FILE)) || {};
        const mergedSettings = mergeSettingsWithDefaults(settings);
        const syncResult = pullPromptFromWorkingDirAgentsFile(mergedSettings);
        if (syncResult.changed) {
            await this.saveData(SETTINGS_FILE, syncResult.settings);
            updateSettings(syncResult.settings);
        }
        return syncResult.settings;
    }

    /**
     * 打开AI标签页
     */
    openAITab() {
        const tabId = this.name + AI_TAB_TYPE;
        openTab({
            app: this.app,
            custom: {
                title: t("aiSidebar.title") || "Codex",
                icon: DOCK_ICON_ID,
                id: tabId,
                data: {
                    time: Date.now()
                }
            }
        });
    }

    /**
     * 在新窗口打开AI
     */
    async openAIWindow() {
        const tabId = this.name + AI_TAB_TYPE;
        const tab = openTab({
            app: this.app,
            custom: {
                title: t("aiSidebar.title") || "Codex",
                icon: DOCK_ICON_ID,
                id: tabId,
            }
        });

        openWindow({
            height: 600,
            width: 800,
            tab: await tab,
        });
    }

}
