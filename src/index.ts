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

import { appendBlock, deleteBlock, setBlockAttrs, getBlockAttrs, pushMsg, pushErrMsg, sql, renderSprig, getChildBlocks, insertBlock, renameDocByID, prependBlock, updateBlock, createDocWithMd, getBlockKramdown, getBlockDOM } from "./api";
import "@/index.scss";

import SettingPanel from "./SettingsPannel.svelte";
import { getDefaultSettings } from "./defaultSettings";
import { setPluginInstance, t } from "./utils/i18n";
import AISidebar from "./ai-sidebar.svelte";
import ChatDialog from "./components/ChatDialog.svelte";
import { updateSettings } from "./stores/settings";
import { getModelCapabilities } from "./utils/modelCapabilities";
import { matchHotKey, getCustomHotKey } from "./utils/hotkey";

export const SETTINGS_FILE = "settings.json";

const AI_SIDEBAR_TYPE = "ai-chat-sidebar";
export const AI_TAB_TYPE = "ai-chat-tab";
export const WEBAPP_TAB_TYPE = "copilot-webapp";



export default class PluginSample extends Plugin {
    private aiSidebarApp: AISidebar;
    private chatDialogs: Map<string, { dialog: Dialog; app: ChatDialog }> = new Map();
    private webApps: Map<string, any> = new Map(); // 存储待打开的小程序数据

    /**
     * 初始化 WebView Session 配置
     * 设置 User-Agent 和请求拦截，解决 Google 等网站的登录问题
     */
    private initWebViewSession() {
        try {
            // 检查是否可以访问 require
            if (typeof (window as any).require !== 'function') {
                console.warn('[WebApp Session] 当前环境不支持 require，无法配置 session，将仅在 webview 层面设置 UA');
                return;
            }

            // 尝试访问 Electron 的 session API
            const { session } = (window as any).require('electron');
            if (!session) {
                console.warn('[WebApp Session] 无法加载 Electron session 模块');
                return;
            }

            const partitionName = 'persist:siyuan-copilot-webapp-shared';
            const webSession = session.fromPartition(partitionName);

            // 获取原始 User-Agent
            const originUA = webSession.getUserAgent();

            // 生成清理后的 User-Agent（移除 Electron 等标识）
            let cleanUA = originUA
                .replace(/Electron\/\S+\s?/gi, '')
                .replace(/SiYuan\/\S+\s?/gi, '')
                .replace(/\s+/g, ' ')
                .trim();

            // 如果清理后的 UA 为空或太短，使用标准的 Chrome UA
            if (!cleanUA || cleanUA.length < 50) {
                cleanUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            }


            // 设置默认 User-Agent
            webSession.setUserAgent(cleanUA);

            // 拦截请求头，对 Google 使用原始 UA，其他网站使用清理后的 UA
            webSession.webRequest.onBeforeSendHeaders((details: any, callback: any) => {
                const isGoogle = details.url.includes('google.com') || details.url.includes('googleapis.com') || details.url.includes('gstatic.com');
                const headers = {
                    ...details.requestHeaders,
                    'User-Agent': isGoogle ? originUA : cleanUA,
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7'
                };
                callback({ requestHeaders: headers });
            });

        } catch (error) {
            console.warn('[WebApp Session] Session 初始化失败，将仅在 webview 层面设置 UA:', error);
        }
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

    async onload() {
        // 插件被启用时会自动调用这个函数
        // 设置i18n插件实例
        setPluginInstance(this);

        // 初始化 WebView Session 配置
        this.initWebViewSession();

        // 加载设置
        await this.loadSettings();
        this.addIcons(`
    <symbol id="iconCopilot" viewBox="0 0 1024 1024">
    <path d="M369.579 617.984a42.71 42.71 0 1 1 85.461 0v85.205a42.71 42.71 0 1 1-85.461 0v-85.205z m284.8 0a42.71 42.71 0 1 0-85.462 0v85.205a42.71 42.71 0 1 0 85.462 0v-85.205zM511.957 171.861c-36.053-52.01-110.848-55.893-168.32-50.688-65.834 6.571-121.301 29.227-152.49 62.464-54.102 59.136-56.576 183.083-30.507 251.307-2.603 11.69-5.12 23.51-6.912 36.053C105.515 483.67 56.32 551.98 56.32 600.832v92.245c0 25.6 11.947 48.982 33.067 64.939 120.49 89.515 270.677 158.89 422.613 158.89 151.893 0 302.08-69.375 422.57-158.89a80.64 80.64 0 0 0 33.067-64.896v-92.288c0-48.853-49.194-117.163-97.408-129.835-1.792-12.544-4.266-24.32-6.912-36.01 26.07-68.267 23.552-192.214-30.506-251.307-31.19-33.28-86.614-55.893-152.491-62.507-57.472-5.162-132.267-1.28-168.363 50.688z m284.8 574.294c-65.493 36.437-174.293 85.333-284.8 85.333S292.693 782.592 227.2 746.155V498.73c105.685 40.96 227.285 19.84 284.715-75.008H512c57.43 94.848 179.03 115.925 284.715 75.008v247.381z m-341.76-454.827c0 67.67-20.48 141.312-113.92 141.312s-111.189-22.357-111.189-85.205c0-99.67 15.19-142.336 141.483-142.336 72.96 0 83.626 23.466 83.626 86.272z m113.92 0c0-62.805 10.667-86.187 83.67-86.187 126.293 0 141.482 42.667 141.482 142.294 0 62.848-17.792 85.205-111.232 85.205s-113.92-73.643-113.92-141.27z" p-id="5384"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="iconModelSetting" viewBox="0 0 1024 1024">
    <path d="M1165.18 856.258H444.69c-15.086-57.882-67.556-100.843-130.03-100.843-73.95 0-134.292 60.178-134.292 134.293 0 73.95 60.178 134.292 134.293 134.292 62.473 0 115.107-42.796 130.029-100.678h720.653c18.529 0 33.614-15.086 33.614-33.614-0.164-18.53-15.25-33.45-33.778-33.45zM314.66 956.936c-37.057 0-67.064-30.17-67.064-67.064 0-37.058 30.171-67.065 67.065-67.065s67.064 30.171 67.064 67.065c0 36.893-30.17 67.064-67.064 67.064z m851.175-478.468H1062.37c-14.921-57.882-67.556-100.678-130.029-100.678s-115.108 42.796-130.029 100.678H218.246c-18.53 0-33.614 15.085-33.614 33.614 0 18.529 15.085 33.614 33.614 33.614H802.31c14.921 57.882 67.556 100.678 130.03 100.678 62.472 0 115.107-42.796 130.028-100.678h103.466c18.529 0 33.614-15.085 33.614-33.614 0-18.693-15.085-33.614-33.614-33.614zM932.34 579.146c-37.057 0-67.064-30.17-67.064-67.064s30.17-67.064 67.064-67.064c37.058 0 67.064 30.17 67.064 67.064s-30.006 67.064-67.064 67.064zM314.66 268.421c62.474 0 115.108-42.797 130.03-100.678h720.653c18.529 0 33.614-15.086 33.614-33.615 0-18.528-15.085-33.614-33.614-33.614H444.69C429.604 42.796 377.134 0 314.66 0c-74.114 0-134.292 60.177-134.292 134.292 0 73.951 60.178 134.129 134.293 134.129z m0-201.357c37.058 0 67.065 30.17 67.065 67.064 0 37.058-30.17 67.065-67.064 67.065s-67.065-30.171-67.065-67.065c-0.163-36.893 30.007-67.064 67.065-67.064z m0 0" p-id="4685"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="iconTranslate" viewBox="0 0 1024 1024">
<path d="M608 416h288c35.36 0 64 28.48 64 64v416c0 35.36-28.48 64-64 64H480c-35.36 0-64-28.48-64-64v-288H128c-35.36 0-64-28.48-64-64V128c0-35.36 28.48-64 64-64h416c35.36 0 64 28.48 64 64v288z m0 64v64c0 35.36-28.48 64-64 64h-64v256.032c0 17.664 14.304 31.968 31.968 31.968H864a31.968 31.968 0 0 0 31.968-31.968V512a31.968 31.968 0 0 0-31.968-31.968H608zM128 159.968V512c0 17.664 14.304 31.968 31.968 31.968H512a31.968 31.968 0 0 0 31.968-31.968V160A31.968 31.968 0 0 0 512.032 128H160A31.968 31.968 0 0 0 128 159.968z m64 244.288V243.36h112.736V176h46.752c6.4 0.928 9.632 1.824 9.632 2.752a10.56 10.56 0 0 1-1.376 4.128c-2.752 7.328-4.128 16.032-4.128 26.112v34.368h119.648v156.768h-50.88v-20.64h-68.768v118.272H306.112v-118.272H238.752v24.768H192z m46.72-122.368v60.48h67.392V281.92H238.752z m185.664 60.48V281.92h-68.768v60.48h68.768z m203.84 488H576L668.128 576h64.64l89.344 254.4h-54.976l-19.264-53.664h-100.384l-19.232 53.632z m33.024-96.256h72.864l-34.368-108.608h-1.376l-37.12 108.608zM896 320h-64a128 128 0 0 0-128-128V128a192 192 0 0 1 192 192zM128 704h64a128 128 0 0 0 128 128v64a192 192 0 0 1-192-192z" p-id="5072"></path>
    </symbol>
    `);
        this.addIcons(`
    <symbol id="iconCopilotWebApp" viewBox="0 0 1024 1024">
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
                        plugin: pluginInstance
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
                    backBtn.title = '后退';
                    backBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconLeft"></use></svg>';
                    backBtn.disabled = true;
                    navbar.appendChild(backBtn);

                    // 前进按钮
                    const forwardBtn = document.createElement('button');
                    forwardBtn.className = 'b3-button b3-button--text';
                    forwardBtn.title = '前进';
                    forwardBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRight"></use></svg>';
                    forwardBtn.disabled = true;
                    navbar.appendChild(forwardBtn);

                    // 刷新按钮
                    const refreshBtn = document.createElement('button');
                    refreshBtn.className = 'b3-button b3-button--text';
                    refreshBtn.title = '刷新';
                    refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
                    navbar.appendChild(refreshBtn);

                    // URL 显示框
                    const urlInput = document.createElement('input');
                    urlInput.type = 'text';
                    urlInput.value = app.url;
                    urlInput.className = 'b3-text-field';
                    urlInput.style.flex = '1';
                    urlInput.style.fontSize = '13px';
                    urlInput.spellcheck = false;

                    urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
                        // 阻止冒泡，防止触发全局快捷键
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            let url = urlInput.value.trim();
                            if (url) {
                                if (!/^https?:\/\//i.test(url)) {
                                    url = 'https://' + url;
                                }
                                // 手动导航时重置重定向计数器
                                redirectCount = 0;
                                lastUrl = url;
                                webview.src = url;
                                urlInput.blur();
                            }
                        }
                    });
                    navbar.appendChild(urlInput);

                    // 在默认浏览器打开按钮
                    const openInBrowserBtn = document.createElement('button');
                    openInBrowserBtn.className = 'b3-button b3-button--text';
                    openInBrowserBtn.title = '在默认浏览器打开';
                    openInBrowserBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconOpenWindow"></use></svg>';
                    navbar.appendChild(openInBrowserBtn);

                    // 复制标签页按钮
                    const duplicateTabBtn = document.createElement('button');
                    duplicateTabBtn.className = 'b3-button b3-button--text';
                    duplicateTabBtn.title = '在新标签页打开';
                    duplicateTabBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
                    navbar.appendChild(duplicateTabBtn);

                    // 全屏按钮
                    const fullscreenBtn = document.createElement('button');
                    fullscreenBtn.className = 'b3-button b3-button--text';
                    fullscreenBtn.title = '全屏 (Alt+Y)';
                    fullscreenBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconFullscreen"></use></svg>';
                    navbar.appendChild(fullscreenBtn);

                    container.appendChild(navbar);

                    // 创建 webview 容器包装
                    const webviewWrapper = document.createElement('div');
                    webviewWrapper.style.flex = '1';
                    webviewWrapper.style.position = 'relative';
                    webviewWrapper.style.overflow = 'hidden';

                    // 创建 webview 元素
                    const webview = document.createElement('webview') as any;
                    webview.style.width = '100%';
                    webview.style.height = '100%';
                    webview.style.border = 'none';

                    // 生成干净的 User-Agent（移除 Electron 等标识）
                    const generateCleanUserAgent = () => {
                        // 获取当前的 User-Agent
                        const originUA = navigator.userAgent;
                        // 移除 Electron 和相关标识，使其看起来像普通的 Chrome 浏览器
                        let cleanUA = originUA
                            .replace(/Electron\/\S+\s?/gi, '')
                            .replace(/SiYuan\/\S+\s?/gi, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        // 如果清理后的 UA 为空或太短，使用标准的 Chrome UA
                        if (!cleanUA || cleanUA.length < 50) {
                            cleanUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                        }


                        return cleanUA;
                    };

                    // 配置 webview 属性（必须在设置 src 之前设置 partition）
                    webview.setAttribute('allowpopups', 'true');
                    // 所有 webapp 使用同一个 partition，这样可以在不同标签页和跨域导航时共享登录状态
                    // 这解决了在一个标签页登录后，新标签页或跨域跳转时需要重新登录的问题
                    const partitionName = 'persist:siyuan-copilot-webapp-shared';
                    webview.setAttribute('partition', partitionName);
                    // 禁用 node integration 以提高安全性
                    webview.setAttribute('nodeintegration', 'false');
                    // 设置清理后的 User-Agent，移除 Electron 标识以避免被网站检测和限制
                    const userAgent = generateCleanUserAgent();
                    webview.setAttribute('useragent', userAgent);
                    // 设置 webpreferences，启用现代 Web 功能
                    // contextIsolation=yes: 启用上下文隔离以提高安全性
                    // webSecurity=yes: 启用 Web 安全策略
                    webview.setAttribute('webpreferences', 'contextIsolation=yes, webSecurity=yes');

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

                    // 监听 webview 导航事件
                    webview.addEventListener('did-navigate', (event: any) => {
                        const newUrl = event.url || webview.getURL();

                        // 检测重定向循环
                        if (newUrl === lastUrl) {
                            redirectCount++;
                            if (redirectCount > MAX_REDIRECTS) {
                                console.error('检测到重定向循环，停止加载:', newUrl);
                                webview.stop();
                                pushErrMsg(`页面重定向次数过多，可能存在循环重定向问题`);
                                return;
                            }
                        } else {
                            redirectCount = 0;
                            lastUrl = newUrl;
                        }

                        urlInput.value = newUrl;
                        updateNavigationButtons();
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

                    // 监听加载失败事件
                    webview.addEventListener('did-fail-load', (event: any) => {
                        // errorCode -3 是 ERR_ABORTED，通常是正常的页面跳转，不需要报错
                        if (event.errorCode !== -3 && event.errorCode !== 0) {
                            console.error('Webview 加载失败:', event);
                            pushErrMsg(`页面加载失败 (错误代码: ${event.errorCode}): ${event.errorDescription || '未知错误'}`);
                        }
                    });

                    // 监听页面标题更新事件，动态更新标签页标题
                    webview.addEventListener('page-title-updated', (event: any) => {
                        const newTitle = event.title;
                        if (newTitle && this.tab && typeof this.tab.updateTitle === 'function') {
                            this.tab.updateTitle(newTitle);
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
                            fullscreenBtn.title = '退出全屏 (Esc 或 Alt+Y)';
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
                            fullscreenBtn.title = '全屏 (Alt+Y)';
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
                        const currentIcon = this.tab?.icon || "iconCopilotWebApp";

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
                            } else if (key === 'escape') {
                                // Esc 退出全屏
                                if (isFullscreen) {
                                    toggleFullscreen();
                                }
                            }
                            return;
                        }

                        // 处理链接打开消息
                        if (msg.startsWith('__SIYUAN_COPILOT_LINK__:')) {
                            const url = msg.substring('__SIYUAN_COPILOT_LINK__:'.length);
                            if (url) {
                                // 从URL中提取域名作为初始标题
                                let initialTitle = 'Web Link';
                                try {
                                    const urlObj = new URL(url);
                                    initialTitle = urlObj.hostname || initialTitle;
                                } catch (e) {
                                    console.warn('Failed to parse URL:', e);
                                }

                                // 使用当前 Tab 的 icon，如果没有则使用默认 icon
                                const currentIcon = this.tab?.icon || "iconCopilotWebApp";

                                openTab({
                                    app: pluginInstance.app,
                                    custom: {
                                        icon: currentIcon,
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
                        }
                    });

                    // 尝试在 webview 加载完成后注入键盘监听和点击拦截
                    webview.addEventListener('dom-ready', () => {
                        webviewReady = true; // 标记 webview 已准备好
                        updateNavigationButtons(); // 初始化导航按钮状态

                        try {
                            // 注入脚本来监听 webview 内部的键盘事件和点击事件
                            const script = `
                                (function() {
                                    // 注入一次即可，防止重复
                                    if (window.__siyuan_copilot_injected) return;
                                    window.__siyuan_copilot_injected = true;

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
                                        // Esc 退出全屏
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            console.log('__SIYUAN_COPILOT_HOTKEY__:escape');
                                            return false;
                                        }
                                    }, true);

                                    // 监听点击事件，拦截 target="_blank" 和 Ctrl+Click
                                    document.addEventListener('click', function(e) {
                                        var target = e.target;
                                        // 查找最近的 a 标签
                                        while (target && target.tagName !== 'A' && target !== document) {
                                            target = target.parentNode;
                                        }
                                        
                                        if (target && target.tagName === 'A') {
                                            // 处理 target="_blank" 或 Ctrl+Click (Windows/Linux) 或 Cmd+Click (Mac)
                                            var shouldOpenInNewTab = target.getAttribute('target') === '_blank' || 
                                                                      e.ctrlKey || 
                                                                      e.metaKey;
                                            
                                            if (shouldOpenInNewTab && target.href) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                // 使用 console.log 传递消息，这在 Electron webview 中通常更可靠
                                                console.log('__SIYUAN_COPILOT_LINK__:' + target.href);
                                            }
                                        }
                                    }, true);
                                })();
                            `;
                            webview.executeJavaScript(script);
                        } catch (err) {
                            console.warn('无法注入键盘监听脚本:', err);
                        }
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
        // 注册AI侧栏
        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 400, height: 0 },
                icon: "iconCopilot",
                title: "Copilot",
            },
            data: {
                text: "Copilot"
            },
            type: AI_SIDEBAR_TYPE,
            init: (dock) => {
                this.aiSidebarApp = new AISidebar({
                    target: dock.element,
                    props: {
                        plugin: this
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
        // 由于 onload() 中已经调用了 loadSettings()，
        // 这里直接再次调用 loadSettings() 以获取合并后的设置（包含默认的内置 webApps）
        try {
            const settings = await this.loadSettings();
            if (settings?.webApps && Array.isArray(settings.webApps)) {
                for (const app of settings.webApps) {
                    if (app.icon && app.icon.startsWith('data:image')) {
                        this.registerWebAppIcon(app.id, app.icon);
                    }
                }
            }

            // 监听链接点击事件（仅在启用时）
            if (settings?.openLinksInWebView) {
                this.setupLinkClickListener();
            }
        } catch (e) {
            console.error('Failed to register webapp icons:', e);
        }
    }

    /**
     * 设置链接点击监听器
     * 根据设置决定是否在 webview 中打开外部链接
     * 直接监听 div.protyle-wysiwyg 下的 span[data-type="a"] 链接点击
     */
    private setupLinkClickListener() {
        // 使用事件委托，监听所有 protyle 编辑器容器
        document.addEventListener('click', async (e: MouseEvent) => {
            const target = e.target as HTMLElement;

            // 检查点击的是否为思源链接: span[data-type="a"]
            if (target.tagName === 'SPAN' && target.getAttribute('data-type') === 'a') {
                const href = target.getAttribute('data-href');

                // 只处理 https 开头的链接
                if (href && href.startsWith('https://')) {
                    // 检查是否在 protyle-wysiwyg 容器内
                    if (target.closest('.protyle-wysiwyg')) {
                        // 立即阻止默认行为（必须在异步操作之前）
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        const settings = await this.loadSettings();

                        // 如果未启用 webview 打开链接功能，在外部浏览器打开
                        if (!settings.openLinksInWebView) {
                            window.open(href, '_blank', 'noopener,noreferrer');
                            return false;
                        }

                        console.log('[Link Click] 在 webview 中打开:', href);

                        // 提取链接标题
                        const linkTitle = target.textContent?.trim() || href;

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

                        // 打开标签页
                        openTab({
                            app: this.app,
                            custom: {
                                icon: "iconCopilotWebApp",
                                title: appData.name,
                                data: {
                                    app: appData
                                },
                                id: this.name + WEBAPP_TAB_TYPE
                            }
                        });

                        return false;
                    }
                }
            }
        }, true); // 使用捕获阶段，确保能先于其他处理器执行
    }

    /**
     * 自定义编辑器工具栏
     */
    updateProtyleToolbar(toolbar: Array<string | any>) {
        toolbar.push("|");
        toolbar.push({
            name: "ai-chat-with-selection",
            icon: "iconCopilot",
            hotkey: "⌥⌘C",
            tipPosition: "n",
            tip: "AI 问答",
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
                    // 如果有选区，获取选中的HTML内容
                    const div = document.createElement('div');
                    div.appendChild(range.cloneContents());
                    const selectedHtml = div.innerHTML;

                    // 使用Lute将HTML转换为Markdown
                    if (typeof window !== 'undefined' && (window as any).Lute) {
                        const lute = (window as any).Lute.New();
                        selectedMarkdown = lute.HTML2Md(selectedHtml);
                    } else {
                        // 如果Lute不可用，使用纯文本作为降级方案
                        selectedMarkdown = selection.toString().trim();
                    }
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
        console.log("Copilot onunload");
    }

    async uninstall() {
        //当插件被卸载的时候，会自动调用这个函数
        console.log("Copilot uninstall");
        // 删除配置文件
        await this.removeData(SETTINGS_FILE);
        await this.removeData("chat-sessions.json");
        await this.removeData("prompts.json");
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
    /**
     * 加载设置
     */
    async loadSettings() {
        const settings = (await this.loadData(SETTINGS_FILE)) || {};

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

                // 持久化迁移结果
                await this.saveData(SETTINGS_FILE, settings);
                pushMsg('检测到旧的 V3 配置，已迁移为自定义平台');
            }
        } catch (e) {
            console.error('Settings migration failed:', e);
        }

        // 迁移：自动为已有模型设置能力
        try {
            // 检查是否已经执行过迁移
            if (!settings.dataTransfer) {
                settings.dataTransfer = {};
            }

            if (settings.dataTransfer.autoSetModelCapabilities) {
            } else if (settings.aiProviders) {
                // 内置平台列表
                const builtInProviders = ['Achuan', 'gemini', 'deepseek', 'openai', 'moonshot', 'volcano'];

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
                await this.saveData(SETTINGS_FILE, settings);
                pushMsg('已自动为现有模型设置能力');
            }
        } catch (e) {
            console.error('Auto set model capabilities failed:', e);
        }

        const defaultSettings = getDefaultSettings();
        const mergedSettings = { ...defaultSettings, ...settings };

        // 检测是否需要保存设置
        let needsSave = false;

        // 如果是首次安装（settings.json 不存在或为空），需要保存
        const isFirstInstall = !settings || Object.keys(settings).length === 0;
        if (isFirstInstall) {
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
        await this.saveData(SETTINGS_FILE, settings);
        // 更新 store，通知所有订阅者
        updateSettings(settings);
    }

    /**
     * 打开AI标签页
     */
    openAITab() {
        const tabId = this.name + AI_TAB_TYPE;
        openTab({
            app: this.app,
            custom: {
                title: 'Siyuan Copilot',
                icon: 'iconCopilot',
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
                title: 'Siyuan Copilot',
                icon: 'iconCopilot',
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
