import { t } from "./utils/i18n";
import type { ThinkingEffort } from "./ai-chat";

export interface ModelConfig {
    id: string;
    name: string;
    temperature: number;
    maxTokens: number;
    customBody?: string; // 自定义请求体参数 (JSON string)
    capabilities?: {
        thinking?: boolean; // 是否支持思考模式
        vision?: boolean;   // 是否支持视觉
        imageGeneration?: boolean; // 是否支持生图
        toolCalling?: boolean; // 是否支持工具调用
        webSearch?: boolean; // 是否支持联网搜索
    };
    thinkingEnabled?: boolean; // 用户是否开启思考模式（仅当支持思考时有效）
    thinkingEffort?: ThinkingEffort; // 思考努力程度（low/medium/high/auto）
    webSearchEnabled?: boolean; // 用户是否开启联网搜索（仅当支持联网时有效）
    webSearchMaxUses?: number; // 联网搜索最大次数（默认5次）
};

export interface ProviderConfig {
    apiKey: string;
    customApiUrl: string;
    models: ModelConfig[];
    advancedConfig?: {
        customModelsUrl?: string; // 自定义模型列表 URL
        customChatUrl?: string;   // 自定义对话 URL
    };
}

export interface CustomProviderConfig extends ProviderConfig {
    id: string;
    name: string;
}

export const getDefaultSettings = () => ({
    textinput: t('settings.textinput.value'),
    slider: 0.5,
    checkbox: false,
    textarea: t('settings.textarea.value'),
    select: 'option1',

    // AI 设置 - 新的多平台多模型结构
    aiProviders: {
        gemini: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        deepseek: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        openai: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        moonshot: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        volcano: {
            apiKey: '',
            customApiUrl: '',
            models: []
        },
        customProviders: [] as CustomProviderConfig[]
    } as Record<string, any>,
    selectedProviderId: 'openai' as string,  // 设置面板中选中的平台
    currentProvider: 'openai' as string,      // 对话中当前使用的平台
    currentModelId: '' as string,
    aiSystemPrompt: 'You are a helpful AI assistant.',

    // 操作设置
    sendMessageShortcut: 'ctrl+enter' as 'ctrl+enter' | 'enter', // 发送消息的快捷键
    // 搜索引擎选择，支持 'google' 或 'bing'
    searchEngine: 'google' as 'google' | 'bing',

    // 显示设置
    messageFontSize: 14 as number, // 消息字体大小
    multiModelViewMode: 'tab' as 'tab' | 'card', // 多模型回答样式：tab (页签视图) | card (卡片视图)

    // 多模型设置
    selectedMultiModels: [] as Array<{ provider: string; modelId: string }>, // 选中的多模型列表

    // 笔记导出设置
    exportNotebook: '' as string,  // 导出笔记本ID
    exportDefaultPath: '' as string,  // 全局保存文档位置（支持sprig语法）
    exportLastPath: '' as string,  // 上次保存的路径
    exportLastNotebook: '' as string,  // 上次保存的笔记本ID

    // 会话自动重命名设置
    autoRenameSession: false as boolean,  // 是否启用会话自动重命名
    autoRenameModelId: '' as string,  // 自动重命名使用的模型ID
    autoRenameReasoningEffort: 'low' as 'low' | 'medium' | 'high' | 'xhigh',
    autoRenamePrompt: '请根据以下用户消息生成一个简洁的会话标题（不超过20个字，不要使用引号，标题前添加一个合适的emoji）：\n\n{message}' as string,  // 自动重命名提示词模板

    // 小程序设置
    webApps: [] as Array<{
        id: string;
        name: string;
        url: string;
        icon?: string; // icon 文件名（存储在 data/storage/petal/siyuan-plugin-copilot/webappIcon/ 下）
        createdAt: number;
        updatedAt: number;
    }>,

    // WebApp 相关设置
    openLinksInWebView: true, // 是否在 webview 中打开外部链接

    // Codex CLI（本地）设置
    codexEnabled: false as boolean,
    codexCliPath: '' as string, // Windows: C:\\Users\\<you>\\AppData\\Roaming\\npm\\codex.cmd
    codexWorkingDir: '' as string, // Codex --cd / -C
    codexPromptSyncEnabled: true as boolean, // 是否与 codexWorkingDir/AGENTS.md 双向同步
    codexPromptSyncFileName: 'AGENTS.md' as string, // 仅允许工作目录下 AGENTS.md
    codexPromptLastSyncedHash: '' as string,
    codexPromptLastSyncedAt: '' as string,
    codexSkipGitRepoCheck: true as boolean,
    codexChatMode: 'ask' as 'ask' | 'agent',
    codexModelOverride: '' as string,
    codexReasoningEffort: '' as '' | 'low' | 'medium' | 'high' | 'xhigh',
    codexRunMode: 'read_only' as 'read_only' | 'workspace_write' | 'fully_open',
    // Siyuan API（用于 codex 注入的 siyuan-mcp 工具）
    siyuanApiUrl: 'http://127.0.0.1:6806' as string,
    siyuanApiToken: '' as string,

    // 数据迁移标志
    dataTransfer: {
        sessionData: false,
        autoSetModelCapabilities: false, // 是否已自动设置模型能力
    },

    // 保留旧设置以便兼容升级
    aiProvider: 'openai',
    aiApiKey: '',
    aiModel: '',
    aiCustomApiUrl: '',
    aiTemperature: 1,
    aiMaxTokens: 2000,
});
