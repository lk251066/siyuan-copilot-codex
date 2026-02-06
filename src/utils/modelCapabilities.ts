/**
 * 模型能力检测工具
 * 根据模型名称自动判断模型具备的能力
 */

export interface ModelCapabilities {
    thinking?: boolean;        // 是否支持思考模式
    vision?: boolean;          // 是否支持视觉
    imageGeneration?: boolean; // 是否支持生图
    toolCalling?: boolean;     // 是否支持工具调用
    webSearch?: boolean;       // 是否支持联网搜索
}

/**
 * 根据模型名称判断是否支持思考模式（Reasoning）
 */
function isThinkingModel(modelId: string): boolean {
    const id = modelId.toLowerCase();

    // OpenAI o 系列
    if (/\bo[1-4](?:-[\w-]+)?/.test(id)) return true;

    // 包含 reasoning/reasoner/thinking/think 关键词
    if (/\b(reasoning|reasoner|thinking|think)\b/.test(id)) return true;

    // DeepSeek R1 系列
    if (/deepseek-r1/.test(id)) return true;

    // QwQ 系列
    if (/\bqwq\b/.test(id)) return true;

    // Kimi 思考模型
    if (/kimi.*thinking/.test(id)) return true;

    // Gemini 2/3 系列（部分支持）
    if (/gemini-[23]/.test(id)) return true;

    // Claude Sonnet 4 系列
    if (/claude.*sonnet-4/.test(id)) return true;

    // GLM zero preview
    if (/glm-zero/.test(id)) return true;

    // 混元 T1
    if (/hunyuan-t1/.test(id)) return true;

    // Grok 3-4 系列
    if (/grok-[34]/.test(id)) return true;

    // GPT-5 系列
    if (/gpt-5/.test(id)) return true;

    return false;
}

/**
 * 根据模型名称判断是否支持视觉能力（Vision）
 */
function isVisionModel(modelId: string): boolean {
    const id = modelId.toLowerCase();

    // 显式包含 vision 关键词
    if (/\bvision\b/.test(id)) return true;

    // GPT-4 系列（除了部分不支持的）
    if (/gpt-4/.test(id)) {
        // 排除不支持视觉的模型
        if (/gpt-4(-\d+)?(-preview)?$/.test(id)) return false;
        if (/gpt-4-32k/.test(id)) return false;
        return true;
    }

    // GPT-4o, GPT-5 系列
    if (/gpt-(4o|4\.5|5)/.test(id)) return true;

    // ChatGPT 4o
    if (/chatgpt-4o/.test(id)) return true;

    // o1, o3, o4 系列（排除 mini 和 preview）
    if (/o[134]/.test(id) && !/mini|preview/.test(id)) return true;

    // Claude 3/4 系列
    if (/claude-[34]/.test(id)) return true;
    if (/claude-(haiku|sonnet|opus)-4/.test(id)) return true;

    // Gemini 1.5+ 系列
    if (/gemini-(1\.5|2|3)/.test(id)) return true;

    // Qwen VL 系列
    if (/qwen.*-vl/.test(id)) return true;
    if (/qwen.*-omni/.test(id)) return true;
    if (/qvq/.test(id)) return true;

    // GLM-4V 系列
    if (/glm-4.*v/.test(id)) return true;

    // DeepSeek VL
    if (/deepseek-vl/.test(id)) return true;

    // Kimi K2.5/latest/VL
    if (/kimi-(k2\.5|latest|vl)/.test(id)) return true;

    // Grok vision/4 系列
    if (/grok-(vision|4)/.test(id)) return true;

    // Pixtral
    if (/pixtral/.test(id)) return true;

    // Doubao Seed
    if (/doubao-seed/.test(id)) return true;

    // Llama 4
    if (/llama-4/.test(id)) return true;

    // Step 系列
    if (/step-1[ov]/.test(id)) return true;

    // Mistral Large/Medium/Small
    if (/mistral-(large|medium|small)/.test(id)) return true;

    return false;
}

/**
 * 根据模型名称判断是否支持图像生成（Image Generation）
 */
function isImageGenerationModel(modelId: string): boolean {
    const id = modelId.toLowerCase();

    // 专用图像生成模型
    if (/dall-e/.test(id)) return true;
    if (/gpt-image/.test(id)) return true;
    if (/stable-?diffusion/.test(id)) return true;
    if (/flux/.test(id)) return true;
    if (/midjourney/.test(id)) return true;
    if (/cogview/.test(id)) return true;
    if (/imagen/.test(id)) return true;
    if (/nanobanana/.test(id)) return true;

    // Gemini 图像生成模型
    if (/gemini.*-image/.test(id)) return true;
    if (/gemini-2\.0-flash-preview-image-generation/.test(id)) return true;

    // Grok 图像模型
    if (/grok-2-image/.test(id)) return true;

    return false;
}

/**
 * 根据模型名称判断是否支持工具调用（Tool Calling）
 */
function isToolCallingModel(modelId: string): boolean {
    const id = modelId.toLowerCase();

    // GPT 系列
    if (/gpt-(4|4o|4\.5|5)/.test(id)) return true;

    // o1, o3, o4 系列
    if (/o[134]/.test(id)) return true;

    // Claude 系列
    if (/claude/.test(id)) return true;

    // Gemini 系列（排除图像生成模型）
    if (/gemini/.test(id) && !/image/.test(id)) return true;

    // Qwen 系列（排除 MT）
    if (/qwen(?!-mt)/.test(id)) return true;

    // DeepSeek 系列
    if (/deepseek/.test(id)) return true;

    // GLM 系列
    if (/glm-4/.test(id) && !/4\.5v/.test(id)) return true;

    // 混元系列
    if (/hunyuan/.test(id)) return true;

    // Doubao Seed
    if (/doubao-seed/.test(id)) return true;

    // Kimi K2 系列
    if (/kimi-k2/.test(id)) return true;

    // Grok 3 系列
    if (/grok-3/.test(id)) return true;

    // Minimax
    if (/minimax-m2/.test(id)) return true;

    // MIMO
    if (/mimo-v2/.test(id)) return true;

    return false;
}

/**
 * 根据模型名称判断是否支持联网搜索（Web Search）
 */
function isWebSearchModel(modelId: string): boolean {
    const id = modelId.toLowerCase();

    // Perplexity 系列
    if (/sonar/.test(id)) return true;

    // Gemini 2/3 系列
    if (/gemini-[23]/.test(id) && !/image/.test(id)) return true;

    // Claude 3.5/3.7/4 系列
    if (/claude-3\.(5|7)-sonnet/.test(id)) return true;
    if (/claude-3\.5-haiku/.test(id)) return true;
    if (/claude-(haiku|sonnet|opus)-4/.test(id)) return true;

    // OpenAI 部分模型
    if (/gpt-4o/.test(id)) return true;

    // 混元系列（除了 lite）
    if (/hunyuan/.test(id) && !/lite/.test(id)) return true;

    // GLM-4 系列
    if (/glm-4-/.test(id)) return true;

    // Qwen 部分模型
    if (/qwen-(turbo|max|plus|flash)/.test(id)) return true;
    if (/qwq/.test(id)) return true;

    // Grok 系列
    if (/grok/.test(id)) return true;

    return false;
}

/**
 * 获取模型的所有能力
 * @param modelId 模型ID或名称
 * @returns 模型能力对象
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
    const capabilities: ModelCapabilities = {};

    // 检测各项能力
    if (isThinkingModel(modelId)) {
        capabilities.thinking = true;
    }

    if (isVisionModel(modelId)) {
        capabilities.vision = true;
    }

    if (isImageGenerationModel(modelId)) {
        capabilities.imageGeneration = true;
    }

    if (isToolCallingModel(modelId)) {
        capabilities.toolCalling = true;
    }

    if (isWebSearchModel(modelId)) {
        capabilities.webSearch = true;
    }

    return capabilities;
}
