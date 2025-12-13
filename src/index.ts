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

export const SETTINGS_FILE = "settings.json";

const AI_SIDEBAR_TYPE = "ai-chat-sidebar";
export const AI_TAB_TYPE = "ai-chat-tab";



export default class PluginSample extends Plugin {
    private aiSidebarApp: AISidebar;
    private chatDialogs: Map<string, { dialog: Dialog; app: ChatDialog }> = new Map();

    async onload() {
        // 插件被启用时会自动调用这个函数
        // 设置i18n插件实例
        setPluginInstance(this);

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
            tip: t("toolbar.aiChat"),
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
        console.log("onunload");
    }

    async uninstall() {
        //当插件被卸载的时候，会自动调用这个函数
        console.log("uninstall");
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
        const settings = await this.loadData(SETTINGS_FILE);
        const defaultSettings = getDefaultSettings();
        const mergedSettings = { ...defaultSettings, ...settings };
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
